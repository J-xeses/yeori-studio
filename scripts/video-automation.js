/**
 * 여리 스튜디오 - Google Flow 영상 자동화 (Veo 3.1 통합)
 *
 * 사용법:
 *   npm run video                           # downloads/video/video-prompts.json 기반 실행
 *   npm run video -- --ep=4               # 에피소드 4만 처리
 *   npm run video -- --cut=3              # CUT 3만 처리
 *   npm run video -- --ratio=9:16         # 비율 지정 (기본 9:16)
 *   npm run video -- --dry                # 목록만 출력 (실제 생성 없음)
 *   npm run video -- --reset              # video-progress.json 초기화 후 처음부터
 *   npm run video -- --prompts=my.json   # 외부 프롬프트 파일 지정
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── ROOT 자동 감지 ──────────────────────────────────────────────────────
const COMPANY_PATH = 'C:\\yeori-studio'
const HOME_PATH = 'C:\\Users\\user\\Desktop\\yeori-studio\\yeori-studio'
const ROOT = (() => {
  if (fs.existsSync(COMPANY_PATH)) { console.log('[ROOT] 회사 PC'); return COMPANY_PATH }
  if (fs.existsSync(HOME_PATH)) { console.log('[ROOT] 집 PC'); return HOME_PATH }
  console.error('[ERROR] ROOT 경로를 찾을 수 없습니다.')
  process.exit(1)
})()

// .env 및 .env.local 로드
;['.env', '.env.local'].forEach(name => {
  const envPath = path.join(ROOT, name)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '')
  })
})

// ── 설정 ─────────────────────────────────────────────────────────────
const CONFIG = {
  debuggingPort:   9222,
  chromeExe:       'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  flowDir:         path.join(ROOT, 'downloads', 'flow'),
  videoDir:        path.join(ROOT, 'downloads', 'video'),
  characterImage:  path.join(ROOT, 'downloads', 'flow', 'character', 'yeori-face.jpg'),
  preferredModel:  'Omni Flash',
  defaultDuration: 8,
  delayMs:         6000,
  timeoutMs:       300000, // 5분 (영상 생성은 이미지보다 오래 걸림)
  retryCount:      1,
}

// ── 인자 파싱 ────────────────────────────────────────────────────────
const args = parseArgs()
const RATIO = args.ratio || '9:16'

main().catch(err => {
  console.error(`[video] 치명적 오류: ${err.message}`)
  if (err.stack) console.error(err.stack)
  log('error', `치명적 오류: ${err.message}`)
  process.exit(1)
})

// ── 유틸리티 ─────────────────────────────────────────────────────────

function parseArgs() {
  return Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] })
  )
}

function log(level, msg) {
  const prefix = { info: 'ℹ️ ', ok: '✅', warn: '⚠️ ', error: '❌', step: '⏳' }
  console.log(`${prefix[level] ?? '  '} ${msg}`)
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function promptInput(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer) })
  })
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

// ── 진행 상태 관리 (크레딧 부족 중단 → 재개) ────────────────────────

function progressPath(episode) {
  const ep = episode ?? 'x'
  return path.join(CONFIG.videoDir, `ep${ep}`, 'video-progress.json')
}

function loadProgress(episode) {
  const p = progressPath(episode)
  if (!fs.existsSync(p)) return { episode, completed: [], failed: [] }
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) }
  catch { return { episode, completed: [], failed: [] } }
}

function saveProgress(episode, progress) {
  const p = progressPath(episode)
  ensureDir(path.dirname(p))
  fs.writeFileSync(p, JSON.stringify({ ...progress, lastUpdated: new Date().toISOString() }, null, 2))
  log('info', `진행 상태 저장: ${path.relative(ROOT, p)}`)
}

// ── 프롬프트 로드 ─────────────────────────────────────────────────────

function loadPrompts() {
  let file
  if (args.prompts) {
    file = path.resolve(args.prompts)
  } else {
    const videoFile = path.join(CONFIG.videoDir, 'video-prompts.json')
    const flowFile  = path.join(CONFIG.flowDir, 'prompts.json')
    if (fs.existsSync(videoFile)) {
      file = videoFile
    } else if (fs.existsSync(flowFile)) {
      file = flowFile
      log('info', 'video-prompts.json 없음 → flow/prompts.json 사용')
    } else {
      log('warn', '프롬프트 파일 없음. video-prompts.json 또는 flow/prompts.json이 필요합니다.')
      process.exit(0)
    }
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const episode = raw.episode ?? null
  const cuts = (Array.isArray(raw) ? raw : raw.cuts ?? [])
    .filter(c => !args.ep  || String(c.episode ?? episode) === String(args.ep))
    .filter(c => !args.cut || String(c.no) === String(args.cut))

  return { episode: args.ep ?? episode, cuts }
}

// ── 크레딧 부족 감지 ──────────────────────────────────────────────────

async function detectCreditExhaustion(page) {
  return page.evaluate(() => {
    const text = document.body.innerText.toLowerCase()
    const keywords = [
      '크레딧 부족', '크레딧이 없', '크레딧을 모두', '크레딧이 소진',
      'out of credits', 'insufficient credits', 'no credits remaining',
      'upgrade your plan', '구독을 업그레이드', '한도에 도달', 'limit reached',
    ]
    return keywords.some(k => text.includes(k))
  })
}

// ── 브라우저 연결 ─────────────────────────────────────────────────────

async function connectBrowser() {
  const wsUrl = `http://127.0.0.1:${CONFIG.debuggingPort}/json/version`
  let version
  try {
    const res = await fetch(wsUrl)
    version = await res.json()
  } catch {
    console.error('\n' + '═'.repeat(60))
    console.error('  Chrome에 연결할 수 없습니다.')
    console.error('  다음 명령으로 Chrome을 먼저 실행하세요:')
    console.error(`\n  "${CONFIG.chromeExe}" --remote-debugging-port=${CONFIG.debuggingPort}`)
    console.error('\n  (실행 중인 Chrome이 있으면 완전히 종료 후 위 명령 사용)')
    console.error('═'.repeat(60) + '\n')
    throw new Error(`Chrome remote debugging 포트(${CONFIG.debuggingPort})에 연결 실패`)
  }
  log('info', `Chrome 연결 완료 (${version.Browser})`)
  return puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport:   null,
  })
}

async function setupPage(browser) {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  // 영상 다운로드 경로: downloads/video/ (에피소드별 이동은 waitAndSaveVideo에서 처리)
  ensureDir(CONFIG.videoDir)
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', {
    behavior:     'allow',
    downloadPath: CONFIG.videoDir,
  })
  page._cdpClient = client
  return page
}

// ── Flow 프로젝트 페이지 진입 ──────────────────────────────────────────

async function navigateToProject(page, episode) {
  const ep = episode ?? 'x'
  const projectMarker = path.join(CONFIG.flowDir, `ep${ep}`, 'project_url.txt')

  if (!fs.existsSync(projectMarker)) {
    log('warn', `project_url.txt 없음: ${projectMarker}`)
    const projectId = await promptInput(
      `\nEP${ep} Flow 프로젝트 ID를 입력하세요 (URL의 마지막 부분):\n예) 77a33d02-f7d7-40d7-9a1f-b9983d92fc79\n> `
    )
    const trimmedId = projectId.trim()
    if (!trimmedId) throw new Error('프로젝트 ID를 입력하지 않았습니다.')
    const projectUrl = `https://labs.google/fx/ko/tools/flow/project/${trimmedId}`
    ensureDir(path.dirname(projectMarker))
    fs.writeFileSync(projectMarker, projectUrl, 'utf-8')
    log('ok', `project_url.txt 저장: ${projectUrl}`)
  }

  const savedUrl = fs.readFileSync(projectMarker, 'utf-8').trim().split('#')[0].trim()
  log('info', `Flow 접속: ${savedUrl}`)

  // 로그인 체크
  await page.goto('https://labs.google/fx/ko/tools/flow', { waitUntil: 'networkidle2', timeout: 30000 })
  const needsLogin = () => {
    const u = page.url()
    return u.includes('accounts.google.com') || u.includes('signin') ||
           u.includes('#pricing') || u.includes('/pricing')
  }
  if (needsLogin()) {
    log('warn', 'Google 로그인이 필요합니다.')
    console.log('\n브라우저에서 로그인 후 Enter를 눌러주세요.')
    await promptInput('')
  }

  await page.goto(savedUrl, { waitUntil: 'networkidle2', timeout: 30000 })
  await sleep(2500)
  log('ok', `Flow 프로젝트 준비 완료`)
}

// ── '+' 버튼 클릭 ─────────────────────────────────────────────────────
// flow-automation.js의 clickPlusButton()과 동일

async function clickPlusButton(page) {
  const result = await page.evaluate(() => {
    function search(root) {
      // 1순위: aria-label에 add/media/미디어/추가 포함된 버튼
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase()
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.top < window.innerHeight * 0.55) continue
        if (/(add|media|미디어|추가|reference|레퍼런스|attach|첨부)/i.test(label)) {
          el.click(); return `aria:${label}`
        }
      }
      // 2순위: 텍스트가 '+', '만들기', 'add'인 버튼
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.top < window.innerHeight * 0.55) continue
        const txt = el.textContent.trim()
        if (txt === '+' || txt.includes('만들기') || txt.toLowerCase() === 'add') {
          el.click(); return `txt:${txt}`
        }
      }
      // 3순위: 하단 입력창 왼쪽(x<300, y>55%)의 소형 버튼
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.width > 80) continue
        if (r.top < window.innerHeight * 0.55 || r.left > 300) continue
        if (r.height < 60 && r.height > 10) { el.click(); return `pos:(${Math.round(r.left)},${Math.round(r.top)})` }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return null
    }
    return search(document)
  })

  if (result) log('info', `+ 버튼 클릭: "${result}"`)
  else {
    const btns = await page.evaluate(() => {
      const h = window.innerHeight
      return [...document.querySelectorAll('button, [role="button"]')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top > h * 0.5 })
        .map(el => {
          const r = el.getBoundingClientRect()
          return `txt="${el.textContent.trim().slice(0, 20)}" aria="${el.getAttribute('aria-label') || ''}" x=${Math.round(r.left)} y=${Math.round(r.top)}`
        })
    })
    log('warn', `+ 버튼 못 찾음. 하단 버튼:\n  ${btns.slice(0, 8).join('\n  ')}`)
    await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_plus_not_found.png') })
  }
  return !!result
}

// ── cut 이미지 업로드 ('+' → 미디어 패널 → file input 주입) ──────────

async function uploadCutImage(page, imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`입력 이미지 없음: ${path.relative(ROOT, imagePath)}`)
  }

  const fileName = path.basename(imagePath, path.extname(imagePath))

  if (!await clickPlusButton(page)) {
    log('warn', '[upload] + 버튼 클릭 실패 — 건너뜀')
    return false
  }
  await sleep(1200)
  await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_plus_panel.png') })

  // 업로드 전 이미지 src 스냅샷 (새 썸네일 감지용)
  const beforeSrcs = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map(img => img.src)
  )

  // file input 탐색 (전략 1: 직접)
  let fileEl = (await page.evaluateHandle(() => {
    function s(root) {
      for (const el of root.querySelectorAll('input[type="file"]')) return el
      for (const el of root.querySelectorAll('*'))
        if (el.shadowRoot) { const f = s(el.shadowRoot); if (f) return f }
      return null
    }
    return s(document)
  })).asElement()

  if (!fileEl) {
    // 전략 2: "새 미디어" / "업로드" 버튼 클릭 후 재탐색
    const clicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        const t     = (el.textContent || '').trim()
        const label = el.getAttribute('aria-label') || ''
        if (/(새 미디어|업로드|upload|add media|new media|내 기기|device)/i.test(t + label)
            && el.getBoundingClientRect().width > 0) {
          el.click(); return t || label
        }
      }
      return null
    })
    if (clicked) {
      log('info', `[upload] "${clicked}" 클릭 → file input 대기`)
      await sleep(1000)
      fileEl = (await page.evaluateHandle(() => {
        function s(root) {
          for (const el of root.querySelectorAll('input[type="file"]')) return el
          for (const el of root.querySelectorAll('*'))
            if (el.shadowRoot) { const f = s(el.shadowRoot); if (f) return f }
          return null
        }
        return s(document)
      })).asElement()
    }
  }

  if (!fileEl) {
    log('warn', '[upload] file input 없음')
    await page.keyboard.press('Escape').catch(() => {})
    return false
  }

  await fileEl.uploadFile(imagePath)
  log('info', `[upload] 업로드 완료: ${path.basename(imagePath)}`)
  await sleep(2500)

  // 업로드 후 새로 나타난 썸네일 카드 클릭 (선택 활성화)
  const thumbClicked = await page.evaluate((prevSrcs, name) => {
    function clickCard(img) {
      let el = img
      for (let i = 0; i < 8; i++) {
        if (!el) break
        const role = (el.getAttribute('role') || '').toLowerCase()
        const tag  = el.tagName.toLowerCase()
        const r    = el.getBoundingClientRect()
        if (r.width > 0 && (
          role === 'option' || role === 'button' || role === 'listitem' ||
          role === 'gridcell' || tag === 'li' || tag === 'article'
        )) { el.click(); return `<${el.tagName} role="${role}">` }
        if (r.width > 0 && tag === 'div' && el.querySelector('img') && r.width > 30 && r.height > 30 && r.height < 300) {
          el.click(); return `<DIV ${Math.round(r.width)}x${Math.round(r.height)}>`
        }
        el = el.parentElement
      }
      img.click(); return '<IMG fallback>'
    }
    // 방법 A: 파일명 텍스트 포함 요소
    const byName = [...document.querySelectorAll('*')].find(el => {
      const txt = el.textContent.trim()
      const r   = el.getBoundingClientRect()
      return txt.toLowerCase().includes(name.toLowerCase())
        && r.width > 20 && r.width < 500 && r.height > 20
    })
    if (byName) { byName.click(); return `name:${name}` }
    // 방법 B: 새로 나타난 img 요소의 카드
    const newImgs = [...document.querySelectorAll('img')].filter(img => {
      const r = img.getBoundingClientRect()
      return !prevSrcs.includes(img.src) && r.width > 20 && r.width < 400 && r.height > 20
    })
    if (newImgs.length) return clickCard(newImgs[0])
    return null
  }, beforeSrcs, fileName)

  if (thumbClicked) log('info', `[upload] 썸네일 클릭: ${thumbClicked}`)
  else log('warn', '[upload] 새 썸네일 감지 실패 — 선택 없이 진행')

  await sleep(800)
  return true
}

// ── 동영상 모드 전환 + 비율 + 모델 ─────────────────────────────────
//
// UI 구조 (debug-tabs.js 확인 결과):
//   1. 프롬프트 바 "Nano Banana" 모델 버튼 클릭 → 드롭다운 오픈
//   2. 드롭다운(role="menu" .DropdownMenuContent) 내부:
//      - role="tablist" > role="tab" .flow_tab_slider_trigger : 이미지/동영상 전환
//      - 비율 버튼 (9:16 등) 및 모델 버튼이 동일 드롭다운 내에 존재

async function switchToVideoMode(page, ratio = RATIO, modelName = CONFIG.preferredModel) {
  await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_before_toggle.png') })

  // ── 1. 모델 드롭다운 트리거 클릭 ────────────────────────────────────
  // 매칭 조건 (하나라도 만족하면 트리거로 판단):
  //   A. textContent.includes('Nano Banana')
  //   B. textContent.includes('Omni Flash')
  //   C. children.length === 2 이면서 텍스트에 모델명+배수/시간 조합 포함
  //      (예: "x1", "x2", "8s", "4s" 등 — 비율·속도 표시가 붙는 트리거 버튼)
  const TRIGGER_MODEL_KEYWORDS = ['Nano Banana', 'Omni Flash', 'Veo 3', 'Veo3']
  const TRIGGER_SUFFIX_RE = /\b(x\d|[\d]+s)\b/i

  const triggerResult = await page.evaluate((modelKws, suffixRe) => {
    const suffixRegex = new RegExp(suffixRe)
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 1 && r.height > 1
    }
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      const txt = (el.textContent || '').trim()
      const haspopup = el.getAttribute('aria-haspopup')
      const isModelTrigger = (
        modelKws.some(k => txt.includes(k)) ||               // A/B: 알려진 모델명 포함
        (el.children.length <= 2 && suffixRegex.test(txt)) || // C: children≤2 + 배수/시간 패턴
        (haspopup === 'menu' && r.top > 600)                  // D: 화면 하단(y>600) menu 트리거
      )
      if (!isModelTrigger) continue
      const txt = (el.textContent || '').trim()
      // 좌표만 반환 — 실제 클릭은 Puppeteer mouse.click()으로
      return {
        found: true,
        txt: txt.slice(0, 60),
        cx: Math.round(r.left + r.width / 2),
        cy: Math.round(r.top + r.height / 2),
        label: `${el.tagName} "${txt.slice(0, 60)}" (${Math.round(r.left)},${Math.round(r.top)})`,
        buttons: [],
      }
    }

    // 실패: 화면 내 모든 button 텍스트 수집 (진단용)
    const buttons = []
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      const txt = (el.textContent || '').trim()
      buttons.push({
        tag: el.tagName,
        txt: txt.slice(0, 80),
        children: el.children.length,
        haspopup: el.getAttribute('aria-haspopup'),
        x: Math.round(r.left),
        y: Math.round(r.top),
      })
    }
    return { found: false, buttons }
  }, TRIGGER_MODEL_KEYWORDS, TRIGGER_SUFFIX_RE.source)

  if (!triggerResult.found) {
    console.log(`[videoMode] 드롭다운 트리거 못 찾음 — 화면 내 button 전체 목록 (${triggerResult.buttons.length}개):`)
    triggerResult.buttons.forEach((b, i) =>
      console.log(`  [${i}] <${b.tag}> children=${b.children} haspopup=${b.haspopup} (${b.x},${b.y}) "${b.txt}"`)
    )
    await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_no_trigger.png') })
    throw new Error('[videoMode] 모델 드롭다운 트리거 없음 — 동영상 모드 전환 중단')
  }

  // Escape로 혹시 열려있는 드롭다운 먼저 닫기 (이전 컷 잔류 방지)
  await page.keyboard.press('Escape')
  await sleep(300)

  // 실제 마우스 클릭 (합성 click()은 React 드롭다운을 열지 못함)
  await page.mouse.click(triggerResult.cx, triggerResult.cy)
  log('ok', `[videoMode] 드롭다운 트리거 클릭: ${triggerResult.label}`)

  // ── 2. 드롭다운(DropdownMenuContent) 열릴 때까지 대기 ───────────────
  try {
    await page.waitForFunction(
      () => !!document.querySelector('[role="menu"][class*="DropdownMenuContent"]'),
      { timeout: 5000 }
    )
  } catch {
    try {
      await page.waitForFunction(() => !!document.querySelector('[role="menu"]'), { timeout: 3000 })
    } catch {
      await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_dropdown_fail.png') })
      throw new Error('[videoMode] 드롭다운이 열리지 않음 — 동영상 모드 전환 중단')
    }
  }
  log('ok', '[videoMode] 드롭다운 열림 확인')
  await sleep(400)

  // ── 3. 드롭다운 내 "동영상" 탭 클릭 (page.mouse.click으로 실제 클릭) ──
  const tabPos = await page.evaluate(() => {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      for (const btn of menu.querySelectorAll('[role="tab"]')) {
        const r = btn.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        const txt = (btn.textContent || '').trim()
        const cls = btn.className || ''
        if (txt.includes('동영상') && cls.includes('flow_tab_slider_trigger')) {
          return {
            cx: Math.round(r.left + r.width / 2),
            cy: Math.round(r.top + r.height / 2),
            label: `role=tab "${txt.slice(0, 40)}" aria-selected=${btn.getAttribute('aria-selected')} (${Math.round(r.left)},${Math.round(r.top)})`,
          }
        }
      }
    }
    return null
  })

  if (!tabPos) {
    await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_video_tab_fail.png') })
    throw new Error('[videoMode] 드롭다운 내 "동영상" 탭 없음 — 전환 중단')
  }
  await page.mouse.click(tabPos.cx, tabPos.cy)
  log('ok', `[videoMode] "동영상" 탭 클릭: ${tabPos.label}`)
  await sleep(800)

  // ── 4. 검증: "동영상" 탭 aria-selected === "true" ─────────────────
  const verified = await page.evaluate(() => {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      for (const btn of menu.querySelectorAll('[role="tab"]')) {
        const txt = (btn.textContent || '').trim()
        if (txt.includes('동영상') && btn.getAttribute('aria-selected') === 'true') return true
      }
    }
    return false
  })

  if (!verified) {
    await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_video_verify_fail.png') })
    throw new Error('[videoMode] "동영상" 탭 aria-selected=true 검증 실패 — 전환 중단')
  }
  log('ok', '[videoMode] 동영상 모드 전환 검증 성공 (aria-selected=true)')
  await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_video_tab.png') })

  // ── 5. 비율 선택 (드롭다운 내부) ─────────────────────────────────────
  const is169 = ratio === '16:9'
  const ratioKeys = is169
    ? ['16:9', '16 : 9', '가로', 'landscape']
    : ['9:16', '9 : 16', '세로', 'portrait']

  const ratioClicked = await page.evaluate((keys) => {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      for (const el of menu.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        if (el.children.length > 5) continue
        const txt = (el.textContent || '').trim()
        const label = el.getAttribute('aria-label') || el.getAttribute('title') || ''
        if (keys.some(k => `${txt} ${label}`.toLowerCase().includes(k.toLowerCase()))) {
          el.click()
          return `${el.tagName} "${txt.slice(0, 30)}" (${Math.round(r.left)},${Math.round(r.top)})`
        }
      }
    }
    return null
  }, ratioKeys)

  if (ratioClicked) log('ok', `[videoMode] ${ratio} 비율: ${ratioClicked}`)
  else log('warn', `[videoMode] ${ratio} 비율 못 찾음`)
  await sleep(400)
  await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_ratio.png') })

  // ── 6. 모델 선택 (비활성화) ──────────────────────────────────────────
  // const modelTargets = [modelName, 'Veo 3.1 Fast Light', 'Veo', 'Fast Light']
  // const modelClicked = await page.evaluate((targets) => { ... }, modelTargets)
  // if (modelClicked) log('ok', `[videoMode] 모델: ${modelClicked}`)
  // else log('warn', `[videoMode] 모델 "${modelName}" 못 찾음`)
  // await sleep(600)

  await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_after_toggle.png') })
  return true
}

// ── DOM 전체 인터랙티브 요소 덤프 (디버깅용) ──────────────────────────

async function debugDump(page, label) {
  const items = await page.evaluate(() => {
    const results = []
    function scan(root, depth = 0) {
      if (depth > 12) return
      for (const el of root.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) continue
        const txt = (el.textContent || '').trim()
        if (!txt || txt.length > 80) continue
        const isInteractive = (
          el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT' ||
          el.getAttribute('role') || el.onclick || el.getAttribute('tabindex') != null
        )
        if (isInteractive && el.children.length <= 6) {
          results.push({
            tag: el.tagName,
            role: el.getAttribute('role') || '',
            txt: txt.slice(0, 50),
            label: (el.getAttribute('aria-label') || '').slice(0, 40),
            x: Math.round(r.left), y: Math.round(r.top),
            w: Math.round(r.width), h: Math.round(r.height),
          })
        }
        if (el.shadowRoot) scan(el.shadowRoot, depth + 1)
      }
    }
    scan(document)
    return results
  })
  log('info', `[dump:${label}] ${items.length}개 요소:`)
  items.slice(0, 25).forEach(e =>
    log('info', `  <${e.tag} role="${e.role}"> "${e.txt}" aria="${e.label}" (${e.x},${e.y}) ${e.w}x${e.h}`)
  )
  await page.screenshot({ path: path.join(CONFIG.videoDir, `debug_dump_${label}.png`) })
}

// ── 비디오 모델 선택 (Omni Flash) ────────────────────────────────────
// 전체 DOM 스캔: role/tag 무관하게 텍스트 매칭 → 직접 클릭

async function selectVideoModel(page, modelName = CONFIG.preferredModel) {
  await debugDump(page, 'model')

  // 전략 1: 텍스트가 정확히 modelName/Flash/Omni를 포함하는 가장 작은 leaf 요소
  const clicked = await page.evaluate((name) => {
    const targets = [name, 'Omni Flash', 'Flash', 'Omni']
    function scan(root, depth = 0) {
      if (depth > 12) return null
      for (const target of targets) {
        for (const el of root.querySelectorAll('*')) {
          const r = el.getBoundingClientRect()
          if (r.width < 4 || r.height < 4) continue
          if (el.children.length > 8) continue          // 컨테이너 제외
          const txt = (el.textContent || '').trim()
          if (txt.includes(target) && txt.length < 60) {
            el.click()
            return `${el.tagName}:"${txt.slice(0, 40)}"`
          }
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = scan(el.shadowRoot, depth + 1); if (r) return r }
      }
      return null
    }
    return scan(document)
  }, modelName)

  if (clicked) {
    log('ok', `[model] 클릭: ${clicked}`)
    await sleep(900)
    // 드롭다운이 열렸으면 옵션 한 번 더 선택
    const option = await page.evaluate((name) => {
      const targets = [name, 'Omni Flash', 'Flash', 'Omni']
      function scan(root, depth = 0) {
        if (depth > 10) return null
        for (const target of targets) {
          for (const el of root.querySelectorAll('*')) {
            const r = el.getBoundingClientRect()
            if (r.width < 4) continue
            if (el.children.length > 8) continue
            const txt = (el.textContent || '').trim()
            if (txt.includes(target) && txt.length < 60) {
              el.click(); return `${el.tagName}:"${txt.slice(0, 40)}"`
            }
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const r = scan(el.shadowRoot, depth + 1); if (r) return r }
        }
        return null
      }
      return scan(document)
    }, modelName)
    if (option) log('ok', `[model] 드롭다운 옵션: ${option}`)
  } else {
    log('warn', `[model] ${modelName} 텍스트 없음 — debug_dump_model.png 확인`)
  }

  await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_model_after.png') })
  await sleep(400)
}

// ── 영상 길이 설정 ────────────────────────────────────────────────────
// 전체 DOM 스캔: "8초", "8s", "8", "8 sec" 등 다양한 패턴

async function setVideoDuration(page, seconds = CONFIG.defaultDuration) {
  // seconds 관련 가능한 텍스트 패턴 목록
  const patterns = [
    `${seconds}초`, `${seconds}s`, `${seconds} seconds`, `${seconds} sec`,
    `${seconds}초 동영상`, `${seconds}초짜리`,
    String(seconds),
  ]

  const set = await page.evaluate((patterns, sec) => {
    function scan(root, depth = 0) {
      if (depth > 12) return null

      // 1순위: 텍스트가 패턴과 정확히 일치하는 작은 요소
      for (const pat of patterns) {
        for (const el of root.querySelectorAll('*')) {
          const r = el.getBoundingClientRect()
          if (r.width < 4 || r.height < 4) continue
          if (el.children.length > 5) continue
          const txt = (el.textContent || '').trim()
          if (txt === pat || txt.startsWith(pat)) {
            el.click(); return `exact:"${txt}"`
          }
        }
      }

      // 2순위: duration/길이 컨텍스트 + 숫자 포함 요소
      for (const el of root.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) continue
        if (el.children.length > 5) continue
        const txt = (el.textContent || '').trim()
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase()
        if ((label.includes('duration') || label.includes('길이') || label.includes('초') || label.includes('second'))
            && txt.includes(String(sec))) {
          el.click(); return `ctx:"${txt}" aria:"${label}"`
        }
      }

      // 3순위: input 필드
      for (const el of root.querySelectorAll('input[type="number"], input[type="range"], input[type="text"]')) {
        const r = el.getBoundingClientRect()
        if (r.width < 4) continue
        const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase()
        if (label.includes('duration') || label.includes('길이') || label.includes('초') || label.includes('second')) {
          el.focus()
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          if (setter) setter.call(el, String(sec))
          else el.value = String(sec)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return `input:${sec}`
        }
      }

      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = scan(el.shadowRoot, depth + 1); if (r) return r }
      }
      return null
    }
    return scan(document)
  }, patterns, seconds)

  if (set) log('info', `[duration] ${seconds}초 설정: ${set}`)
  else log('warn', `[duration] ${seconds}초 설정 실패 — debug_dump_model.png 확인`)
  await sleep(300)
}

// ── 비율 설정 ─────────────────────────────────────────────────────────
// 9:16 = 세로(portrait), 16:9 = 가로(landscape)
// 다양한 표현: "9:16", "세로", "Portrait", aria-label, data 속성

async function setVideoRatio(page, ratio = RATIO) {
  const is169 = ratio === '16:9'

  // 비율별 검색 키워드 (한국어 포함)
  const portraitKeys  = ['9:16', '세로', 'portrait', 'Portrait', '포트레이트', 'vertical', '9 : 16']
  const landscapeKeys = ['16:9', '가로', 'landscape', 'Landscape', '랜드스케이프', 'horizontal', '16 : 9']
  const keys = is169 ? landscapeKeys : portraitKeys

  const clicked = await page.evaluate((keys, ratio) => {
    // 1순위: aria-label / data 속성
    const attrSelectors = keys.flatMap(k => [
      `[aria-label*="${k}"]`, `[data-ratio="${k}"]`, `[data-aspect="${k}"]`,
      `[title*="${k}"]`,
    ])
    for (const sel of attrSelectors) {
      try {
        const el = document.querySelector(sel)
        if (el && el.getBoundingClientRect().width > 0) { el.click(); return `attr:${sel}` }
      } catch {}
    }

    // 2순위: 전체 DOM 텍스트/aria 스캔 (Shadow DOM 포함)
    function scan(root, depth = 0) {
      if (depth > 12) return null
      for (const el of root.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) continue
        if (el.children.length > 8) continue
        const txt   = (el.textContent || '').trim()
        const label = el.getAttribute('aria-label') || el.getAttribute('title') || ''
        const combined = `${txt} ${label}`.toLowerCase()
        if (keys.some(k => combined.includes(k.toLowerCase()))) {
          el.click(); return `txt:"${txt.slice(0,30)}" (${Math.round(r.left)},${Math.round(r.top)})`
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = scan(el.shadowRoot, depth + 1); if (r) return r }
      }
      return null
    }
    return scan(document)
  }, keys, ratio)

  if (clicked) { log('info', `[ratio] ${ratio} 설정: ${clicked}`); await sleep(300) }
  else log('warn', `[ratio] ${ratio} 못 찾음 (기본값 사용) — debug_dump_model.png 확인`)
}

// ── "프롬프트에 추가" 버튼 클릭 (flow-automation.js 동일) ────────────

async function clickAddToPrompt(page) {
  try {
    const btns = await page.$x('//button[contains(normalize-space(.), "프롬프트에 추가") and not(@disabled)]')
    for (const btn of btns) {
      const clicked = await btn.evaluate(el => {
        if (el.getBoundingClientRect().width === 0) return false
        el.click(); return true
      })
      if (clicked) return true
    }
  } catch {}
  return page.evaluate(() => {
    const re = /프롬프트에 추가|add to prompt/i
    function search(root) {
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        if (re.test(el.textContent) && !el.disabled && el.getBoundingClientRect().width > 0) {
          el.click(); return true
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return false
    }
    return search(document)
  })
}

// ── '+' 패널에서 파일명으로 정확히 선택 → "프롬프트에 추가" ──────────
// 파일 없으면 즉시 Error (폴백 없음)

async function addFileToPromptByName(page, fileName) {
  const nameBase = path.basename(fileName, path.extname(fileName)).toLowerCase()

  if (!await clickPlusButton(page)) {
    throw new Error(`[addToPrompt] '+' 버튼 클릭 실패 (${fileName})`)
  }
  await sleep(1200)
  await page.screenshot({ path: path.join(CONFIG.videoDir, `debug_panel_${nameBase}.png`) })

  const clicked = await page.evaluate((nameBase) => {
    function search(root) {
      for (const el of root.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width < 10 || r.height < 10) continue
        const txt   = (el.textContent        || '').trim().toLowerCase()
        const alt   = (el.getAttribute('alt')        || '').toLowerCase()
        const title = (el.getAttribute('title')      || '').toLowerCase()
        const label = (el.getAttribute('aria-label') || '').toLowerCase()
        if (txt === nameBase || txt.includes(nameBase) ||
            alt.includes(nameBase) || title.includes(nameBase) || label.includes(nameBase)) {
          el.click()
          return `${el.tagName} "${(txt || alt || title || label).slice(0, 40)}" (${Math.round(r.left)},${Math.round(r.top)})`
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return null
    }
    return search(document)
  }, nameBase)

  if (!clicked) {
    await page.keyboard.press('Escape').catch(() => {})
    throw new Error(`[addToPrompt] 파일 없음: ${fileName}`)
  }
  log('ok', `[addToPrompt] 선택: ${clicked}`)
  await sleep(800)

  const added = await clickAddToPrompt(page)
  if (!added) throw new Error(`[addToPrompt] "프롬프트에 추가" 버튼 못 찾음 (${fileName})`)
  log('ok', `[addToPrompt] 완료: ${fileName}`)
  await sleep(800)
}

// ── 입력창 위치 탐색 ─────────────────────────────────────────────────
// flow-automation.js의 findPromptInputPos()와 동일

async function findPromptInputPos(page) {
  const found = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll(
        '[role="textbox"], [role="combobox"], textarea, input[type="text"], [contenteditable="true"]'
      )) {
        if (el.classList.contains('g-recaptcha-response')) continue
        const r = el.getBoundingClientRect()
        if (r.width > 100 && r.top > window.innerHeight * 0.5) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const res = search(el.shadowRoot); if (res) return res }
      }
      return null
    }
    return search(document)
  })
  if (found) return found
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  log('warn', '입력창 좌표 추론 (폴백)')
  return { x: vp.w * 0.48, y: vp.h * 0.895 }
}

// ── 프롬프트 입력 ─────────────────────────────────────────────────────

async function typeVideoPrompt(page, prompt) {
  const pos = await findPromptInputPos(page)
  await page.mouse.click(pos.x, pos.y)
  await sleep(300)
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(100)
  await page.keyboard.type(prompt, { delay: 15 })
  log('info', `프롬프트 입력: ${prompt.slice(0, 90)}${prompt.length > 90 ? '…' : ''}`)
  await sleep(500)
}

// ── 생성 버튼 클릭 ────────────────────────────────────────────────────
// flow-automation.js의 clickGenerate()와 동일

async function clickGenerate(page) {
  const rect = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('button')) {
        if (el.disabled) continue
        const r     = el.getBoundingClientRect()
        if (r.top < window.innerHeight * 0.6 || r.width < 1) continue
        const txt   = el.textContent.trim()
        const label = (el.getAttribute('aria-label') || '').toLowerCase()
        if (txt === '→' || txt === '▶' ||
            label.includes('send') || label.includes('전송') || label.includes('보내기') ||
            label.includes('submit') || label.includes('generate')) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const res = search(el.shadowRoot); if (res) return res }
      }
      return null
    }
    return search(document)
  })

  if (rect) {
    await page.mouse.click(rect.x, rect.y)
    log('info', `생성 버튼 클릭 (${Math.round(rect.x)}, ${Math.round(rect.y)})`)
    return
  }
  log('info', 'Enter 키로 전송 (폴백)')
  await page.keyboard.press('Enter')
}

// ── 영상 완료 대기 + 저장 ────────────────────────────────────────────

async function waitAndSaveVideo(page, outPath) {
  ensureDir(path.dirname(outPath))

  // 다운로드 폴더 기존 영상 파일 스냅샷
  const beforeFiles = new Set(
    fs.existsSync(CONFIG.videoDir)
      ? fs.readdirSync(CONFIG.videoDir).filter(f => /\.(mp4|webm|mov)$/i.test(f))
      : []
  )

  log('step', `영상 생성 대기 중… (최대 ${Math.round(CONFIG.timeoutMs / 60000)}분)`)

  // video 태그 src 생성 대기
  try {
    await page.waitForFunction(
      () => {
        function search(root) {
          for (const v of root.querySelectorAll('video')) {
            const src = v.src || v.querySelector('source')?.src || ''
            if (src && !src.includes('poster') && src.length > 10) return true
          }
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot && search(el.shadowRoot)) return true
          }
          return false
        }
        return search(document)
      },
      { timeout: CONFIG.timeoutMs }
    )
    log('ok', '영상 생성 감지')
  } catch {
    log('warn', '영상 태그 대기 타임아웃 — 다른 방법 시도')
    await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_video_timeout.png'), fullPage: true })
  }
  await sleep(2000)

  // 방법 A: video 위에 hover → 다운로드 버튼 클릭 → 파일 폴링
  const dlResult = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('button, a, [role="button"]')) {
        const txt   = (el.textContent || '').trim()
        const label = (el.getAttribute('aria-label') || '').toLowerCase()
        const r     = el.getBoundingClientRect()
        if (r.width === 0) continue
        if (/(다운로드|download)/i.test(txt + label)) { el.click(); return true }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && search(el.shadowRoot)) return true
      }
      return false
    }
    // video 요소 위 hover → 다운로드 버튼 활성화
    const video = (() => {
      function find(root) {
        for (const v of root.querySelectorAll('video')) {
          if (v.getBoundingClientRect().width > 0) return v
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const r = find(el.shadowRoot); if (r) return r }
        }
        return null
      }
      return find(document)
    })()
    if (video) {
      video.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      video.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    }
    return search(document)
  })

  if (dlResult) {
    log('info', '다운로드 버튼 클릭 — 파일 대기 중…')
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      const after   = fs.existsSync(CONFIG.videoDir) ? fs.readdirSync(CONFIG.videoDir) : []
      const newFile = after.find(f =>
        /\.(mp4|webm|mov)$/i.test(f) && !beforeFiles.has(f) && !f.endsWith('.crdownload')
      )
      if (newFile) {
        const src = path.join(CONFIG.videoDir, newFile)
        fs.renameSync(src, outPath)
        log('ok', `영상 저장 (다운로드): ${path.relative(ROOT, outPath)}`)
        return outPath
      }
    }
    log('warn', '다운로드 파일 미감지 → video src 직접 저장 시도')
  }

  // 방법 B: video src fetch
  const videoSrc = await page.evaluate(() => {
    function search(root) {
      for (const v of root.querySelectorAll('video')) {
        const src = v.src || v.querySelector('source')?.src || ''
        if (src && src.length > 10) return src
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return null
    }
    return search(document)
  })

  if (videoSrc) {
    log('info', `[방법B] video src fetch: ${videoSrc.slice(0, 80)}…`)
    const data = await page.evaluate(async (src) => {
      try {
        const res = await fetch(src)
        if (!res.ok) return null
        const buf = await res.arrayBuffer()
        return Array.from(new Uint8Array(buf))
      } catch { return null }
    }, videoSrc)

    if (data) {
      fs.writeFileSync(outPath, Buffer.from(data))
      log('ok', `영상 저장 (src fetch): ${path.relative(ROOT, outPath)}`)
      return outPath
    }

    // 방법 C: CDP anchor-click download
    if (page._cdpClient) {
      try {
        await page._cdpClient.send('Page.setDownloadBehavior', {
          behavior:     'allow',
          downloadPath: path.dirname(outPath),
        })
        await page.evaluate((src) => {
          const a = document.createElement('a')
          a.href = src
          a.download = 'video_download.mp4'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }, videoSrc)
        await sleep(5000)
        const epFiles = fs.readdirSync(path.dirname(outPath)).filter(f => /\.(mp4|webm|mov)$/i.test(f))
        const rootFiles = fs.readdirSync(CONFIG.videoDir).filter(f => /\.(mp4|webm|mov)$/i.test(f) && !beforeFiles.has(f))
        const allNew = [...epFiles.map(f => path.join(path.dirname(outPath), f)), ...rootFiles.map(f => path.join(CONFIG.videoDir, f))]
        if (allNew.length) {
          const latest = allNew
            .map(f => ({ f, t: fs.statSync(f).mtimeMs }))
            .sort((a, b) => b.t - a.t)[0]
          if (latest && !fs.existsSync(outPath)) {
            fs.renameSync(latest.f, outPath)
            log('ok', `영상 저장 (CDP): ${path.relative(ROOT, outPath)}`)
            return outPath
          } else if (fs.existsSync(outPath)) {
            return outPath
          }
        }
      } catch (e) {
        log('warn', `[방법C] CDP 다운로드 실패: ${e.message}`)
      }
    }
  }

  // 모든 방법 실패
  await page.screenshot({ path: path.join(CONFIG.videoDir, 'debug_video_save_fail.png'), fullPage: true })
  throw new Error('영상 저장 실패. debug_video_save_fail.png 확인')
}

// ── 컷 1개 처리 ──────────────────────────────────────────────────────

async function processCut(page, cut, episode, ratio) {
  const ep     = cut.episode ?? episode ?? 'x'
  const padded = String(cut.no).padStart(2, '0')
  const imgPath = path.join(CONFIG.flowDir, `ep${ep}`, `cut_${padded}.jpg`)
  const outPath = path.join(CONFIG.videoDir, `ep${ep}`, `cut_${padded}.mp4`)

  if (fs.existsSync(outPath)) {
    log('ok', `CUT ${cut.no} 이미 존재 → 스킵`)
    return { status: 'skip', outPath }
  }

  // ① 동영상 모드 전환 (탭 + 비율) — 실패 시 noRetry로 즉시 중단
  log('step', `CUT ${cut.no}: 동영상 모드 전환 (ratio=${ratio}, model=${CONFIG.preferredModel})`)
  try {
    await switchToVideoMode(page, ratio, CONFIG.preferredModel)
  } catch (err) {
    err.noRetry = true
    throw err
  }

  // ② '+' 버튼 → 미디어 패널 → input[type=file]에 cut_NN.jpg 주입
  log('step', `CUT ${cut.no}: cut_${padded}.jpg 업로드`)
  await uploadCutImage(page, imgPath)

  // ③ 영상 길이 설정
  await setVideoDuration(page, cut.duration ?? CONFIG.defaultDuration)

  // ④ '+' 패널에서 파일명으로 정확히 선택 → 프롬프트에 추가
  log('step', `CUT ${cut.no}: yeori-face.jpg → 프롬프트 추가`)
  await addFileToPromptByName(page, 'yeori-face.jpg')

  log('step', `CUT ${cut.no}: cut_${padded}.jpg → 프롬프트 추가`)
  await addFileToPromptByName(page, `cut_${padded}.jpg`)

  // ⑤ 영상 프롬프트 입력 (imagePrompt 우선)
  const videoPrompt = (
    cut.imagePrompt?.trim()
    || cut.videoPrompt?.trim()
    || 'Smooth cinematic camera motion. Character moves naturally. Photorealistic.'
  )
  await typeVideoPrompt(page, videoPrompt)

  // ⑥ 생성 버튼 클릭
  log('step', `CUT ${cut.no}: 영상 생성 요청`)
  await clickGenerate(page)

  // ⑦ 완료 대기 → downloads/video/ep{N}/cut_NN.mp4 저장
  const savedPath = await waitAndSaveVideo(page, outPath)
  return { status: 'ok', outPath: savedPath }
}

// ── 헤더 / 서머리 / 리포트 ──────────────────────────────────────────

function printHeader(episode, cuts, ratio) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  🎬 여리 스튜디오 — Google Flow 영상 자동화')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  if (episode) console.log(`  에피소드: EP${episode}`)
  console.log(`  처리 컷: ${cuts.length}개  비율: ${ratio}  모델: ${CONFIG.preferredModel}`)
  console.log(`  저장 위치: downloads/video/ep${episode ?? 'x'}/`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

function printSummary(ok, fail, results) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  완료: ✅ ${ok}개 성공 / ❌ ${fail}개 실패`)
  if (fail > 0) {
    results.filter(r => r.status === 'fail')
      .forEach(r => console.log(`    CUT ${r.cutNo}: ${r.reason}`))
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

function saveReport(episode, ratio, results) {
  ensureDir(CONFIG.videoDir)
  const reportPath = path.join(CONFIG.videoDir, `report_ep${episode ?? 'x'}_${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(), episode, ratio, results,
  }, null, 2))
  log('info', `리포트: ${path.relative(ROOT, reportPath)}`)
}

// ── 메인 ─────────────────────────────────────────────────────────────

async function main() {
  ensureDir(CONFIG.videoDir)
  const { episode, cuts } = loadPrompts()

  if (!cuts.length) {
    log('warn', '처리할 컷이 없습니다.')
    return
  }

  // 진행 상태 로드 (--reset 시 초기화)
  let progress = loadProgress(episode)
  if (args.reset) {
    progress = { episode, completed: [], failed: [] }
    saveProgress(episode, progress)
    log('info', '진행 상태 초기화 완료')
  }

  // 이미 완료된 컷 제외
  const pending = cuts.filter(c => !progress.completed.includes(c.no))

  printHeader(episode, pending, RATIO)

  if (args.dry) {
    pending.forEach((c, i) => {
      const prompt = c.imagePrompt?.slice(0, 80) || c.videoPrompt?.slice(0, 80)
      console.log(`  [${i + 1}] CUT ${c.no}: ${prompt}`)
    })
    return
  }

  if (!pending.length) {
    log('ok', '모든 컷이 이미 완료됐습니다.')
    return
  }

  if (progress.completed.length) {
    log('info', `이전 진행 이어받기: 완료 [${progress.completed.join(', ')}], 대기 ${pending.length}개`)
  }

  let browser
  try {
    browser = await connectBrowser()
  } catch {
    process.exit(1)
  }

  const page = await setupPage(browser)
  await navigateToProject(page, episode)

  let ok = 0, fail = 0
  const results = []

  for (let i = 0; i < pending.length; i++) {
    const cut   = pending[i]
    const label = `[${i + 1}/${pending.length}] CUT ${cut.no}`

    log('step', `${label} 영상 생성 중…`)

    for (let attempt = 0; attempt <= CONFIG.retryCount; attempt++) {
      try {
        const { status, outPath } = await processCut(page, cut, episode, RATIO)
        const relPath = path.relative(ROOT, outPath)
        log('ok', `${label} → ${relPath} (${status})`)
        results.push({ cutNo: cut.no, status: 'ok', file: outPath })
        progress.completed.push(cut.no)
        progress.failed = progress.failed.filter(n => n !== cut.no)
        saveProgress(episode, progress)
        ok++; break
      } catch (err) {
        const isLastAttempt = attempt >= CONFIG.retryCount
        if (err.noRetry || isLastAttempt) {
          log('error', `${label} 실패: ${err.message}`)
          results.push({ cutNo: cut.no, status: 'fail', reason: err.message })
          if (!progress.failed.includes(cut.no)) progress.failed.push(cut.no)
          saveProgress(episode, progress)
          fail++
          break
        } else {
          log('warn', `${label} 재시도 ${attempt + 1}/${CONFIG.retryCount}: ${err.message}`)
          await sleep(2000)
        }
      }
    }

    // 크레딧 부족 감지 → 진행 상태 저장 후 중단
    if (await detectCreditExhaustion(page)) {
      log('error', '크레딧 부족 감지 → 진행 상태 저장 후 중단')
      saveProgress(episode, progress)
      log('info', `재실행 명령: npm run video -- --ep=${episode ?? 'x'}`)
      break
    }

    // 컷 사이 대기 (마지막 컷 제외)
    if (i < pending.length - 1) {
      process.stdout.write(`   ${CONFIG.delayMs / 1000}초 대기 중…`)
      await sleep(CONFIG.delayMs)
      process.stdout.write('\r' + ' '.repeat(30) + '\r')
    }
  }

  printSummary(ok, fail, results)
  saveReport(episode, RATIO, results)
}
