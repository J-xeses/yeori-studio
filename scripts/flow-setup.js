/**
 * flow-setup.js
 * Flow 프로젝트 세팅 자동화 (3단계)
 *
 * Usage:
 *   node scripts/flow-setup.js --ep=3
 *
 * 사전 조건:
 *   Chrome이 --remote-debugging-port=9222 로 실행 중이어야 함
 *   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 */
import puppeteer from 'puppeteer-core'
import fs        from 'node:fs'
import path      from 'node:path'
import readline  from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── ROOT 자동 감지 ──────────────────────────────────────────────────
const CANDIDATES = [
  { label: '회사 PC', p: 'C:\\Users\\won56\\OneDrive - CTEC\\문서\\GitHub\\yeori-studio\\yeori-studio' },
  { label: '집 PC',   p: 'C:\\Users\\user\\Desktop\\yeori-studio\\yeori-studio' },
]
const CODE_ROOT = (() => {
  for (const { label, p } of CANDIDATES) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'package.json'))) {
      console.log(`[CODE_ROOT] ${label}: ${p}`)
      return p
    }
  }
  console.error('[ERROR] CODE_ROOT 경로를 찾을 수 없습니다.')
  process.exit(1)
})()

const MEDIA_ROOT = 'C:\\yeori-studio'

const CONFIG = {
  debuggingPort: 9222,
  chromeExe:     'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  flowDashboard: 'https://labs.google/fx/ko/tools/flow',
  downloadDir:   path.join(MEDIA_ROOT, 'downloads', 'flow'),
  characterDir:  path.join(MEDIA_ROOT, 'downloads', 'flow', 'character'),
  faceImage:     path.join(MEDIA_ROOT, 'downloads', 'flow', 'character', 'yeori-face.jpg'),
  closeupImage:  path.join(MEDIA_ROOT, 'downloads', 'flow', 'character', 'yeori-closeup.jpg'),
}

// ── 유틸 ───────────────────────────────────────────────────────────
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function askEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(msg, () => { rl.close(); resolve() }))
}

// ── Step 1: Chrome 연결 + Flow 탭 확보 ─────────────────────────────
async function connectBrowser() {
  const wsUrl = `http://127.0.0.1:${CONFIG.debuggingPort}/json/version`
  let version
  try {
    const res = await fetch(wsUrl)
    version = await res.json()
  } catch {
    console.error('\n' + '═'.repeat(60))
    console.error('  Chrome에 연결할 수 없습니다.')
    console.error('  Chrome을 먼저 아래 명령으로 실행해주세요:')
    console.error(`\n  "${CONFIG.chromeExe}" --remote-debugging-port=${CONFIG.debuggingPort}`)
    console.error('\n  (실행 중인 Chrome이 있으면 완전히 종료 후 위 명령 사용)')
    console.error('═'.repeat(60) + '\n')
    throw new Error(`Chrome remote debugging 포트(${CONFIG.debuggingPort}) 연결 실패`)
  }
  log('ok', `Chrome 연결 완료 (${version.Browser})`)
  return puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport:   null,
  })
}

async function getFlowPage(browser) {
  const pages = await browser.pages()
  const existing = pages.find(p => p.url().includes('labs.google'))
  let page

  if (existing) {
    log('info', `기존 Flow 탭 재사용: ${existing.url().slice(0, 70)}`)
    page = existing
  } else {
    log('info', 'Flow 탭 없음 → 새 탭 생성')
    page = await browser.newPage()
    await page.goto(CONFIG.flowDashboard, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2000)
  }

  // 로그인 필요 여부 확인
  const url = page.url()
  if (url.includes('accounts.google.com') || url.includes('signin') || url.includes('pricing')) {
    log('warn', 'Google 로그인이 필요합니다. 브라우저에서 로그인 후 Enter를 눌러주세요.')
    await askEnter('')
    await page.goto(CONFIG.flowDashboard, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2000)
  }

  // Flow가 아닌 탭이면 대시보드로 이동
  if (!page.url().includes('labs.google')) {
    await page.goto(CONFIG.flowDashboard, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2000)
  }

  log('ok', `Flow 탭 준비 완료: ${page.url().slice(0, 70)}`)
  return page
}

// ── Step 2: 새 프로젝트 생성 + project_url.txt 저장 ────────────────
async function createProject(page, epNum) {
  const epDir         = path.join(CONFIG.downloadDir, `ep${epNum}`)
  const projectUrlFile = path.join(epDir, 'project_url.txt')
  ensureDir(epDir)

  // 이미 있으면 스킵
  if (fs.existsSync(projectUrlFile)) {
    const existingUrl = fs.readFileSync(projectUrlFile, 'utf-8').trim()
    log('ok', `project_url.txt 이미 존재 → 스킵`)
    log('info', `  ${existingUrl}`)
    return existingUrl
  }

  log('step', `ep${epNum} 프로젝트 신규 생성 중…`)

  // Flow 대시보드로 이동 (프로젝트 페이지에 있다면)
  if (page.url().includes('/project/')) {
    await page.goto(CONFIG.flowDashboard, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2000)
  }

  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_setup_01_dashboard.png') })

  // "새 프로젝트" 버튼 클릭
  const createClicked = await page.evaluate(() => {
    const patterns = /(새 프로젝트|새프로젝트|create.{0,10}project|new project|시작하기|빈 프로젝트|blank)/i
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const txt = el.textContent.trim()
      if (patterns.test(txt) && el.getBoundingClientRect().width > 0) {
        el.click(); return txt
      }
    }
    return null
  })

  if (!createClicked) {
    log('warn', '"새 프로젝트" 버튼 못 찾음 → debug_setup_01_dashboard.png 확인')
    throw new Error('"새 프로젝트" 버튼을 찾지 못했습니다')
  }
  log('info', `"${createClicked}" 클릭`)
  await sleep(2500)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_setup_02_create_dialog.png') })

  // 프로젝트 이름 입력
  const projectName = `ep${epNum}`
  const named = await page.evaluate((name) => {
    for (const el of document.querySelectorAll('input[type="text"], input:not([type]), [contenteditable="true"]')) {
      if (el.getBoundingClientRect().width > 0) {
        el.focus()
        el.value = name
        el.dispatchEvent(new Event('input',  { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
    }
    return false
  }, projectName)

  if (named) {
    log('info', `프로젝트 이름 입력: "${projectName}"`)
  } else {
    await page.keyboard.type(projectName, { delay: 50 })
    log('info', `프로젝트 이름 키보드 타이핑: "${projectName}"`)
  }
  await sleep(400)

  // 확인/생성 버튼 클릭
  const confirmed = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button')) {
      const txt = el.textContent.trim()
      if (/(확인|생성|만들기|create|done|continue|다음|시작)/i.test(txt)
          && !el.disabled && el.getBoundingClientRect().width > 0) {
        el.click(); return txt
      }
    }
    return null
  })
  if (confirmed) log('info', `"${confirmed}" 클릭`)
  else { await page.keyboard.press('Enter'); log('info', 'Enter 키 전송') }

  // URL에 /project/ 등장할 때까지 대기
  log('step', '프로젝트 페이지 로딩 대기…')
  try {
    await page.waitForFunction(
      () => window.location.href.includes('/project/'),
      { timeout: 30000 }
    )
  } catch {
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_setup_03_waiting.png') })
    throw new Error('프로젝트 URL 감지 실패. debug_setup_03_waiting.png 확인')
  }

  await sleep(2000)
  const projectUrl = page.url().split('?')[0]
  log('ok', `프로젝트 생성 완료`)
  log('info', `  URL: ${projectUrl}`)

  fs.writeFileSync(projectUrlFile, projectUrl, 'utf-8')
  log('ok', `project_url.txt 저장: ${projectUrlFile}`)
  return projectUrl
}

// ── "+" (미디어 추가) 버튼 클릭 ────────────────────────────────────
// flow-automation.js의 3단계 전략 동일하게 적용
async function clickPlusButton(page) {
  const result = await page.evaluate(() => {
    const h = window.innerHeight

    function search(root) {
      // 1순위: aria-label/title에 add/media/미디어 포함된 하단(y>55%) 버튼
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase()
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.top < h * 0.55) continue
        if (/(add|media|미디어|추가|reference|레퍼런스|attach)/i.test(label)) {
          el.click(); return `aria:${label}`
        }
      }
      // 2순위: 텍스트가 + 또는 미디어 포함 하단 버튼
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.top < h * 0.55) continue
        const txt = el.textContent.trim()
        if (txt === '+' || txt.startsWith('+') || /^add$/i.test(txt) || /미디어|media/i.test(txt)) {
          el.click(); return `txt:${txt.slice(0, 20)}`
        }
      }
      // 3순위: 하단 입력창 왼쪽(x<300, y>55%) 소형 버튼 (위치 기반)
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.width > 80) continue
        if (r.top < h * 0.55 || r.left > 300) continue
        if (r.height > 10 && r.height < 60) { el.click(); return `pos:(${Math.round(r.left)},${Math.round(r.top)})` }
      }
      // Shadow DOM 재귀
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return null
    }
    return search(document)
  })

  if (result) {
    log('info', `+ 버튼 클릭: "${result}"`)
    return true
  }

  // 최후 수단: 하단 버튼 목록 덤프 후 스크린샷
  const btns = await page.evaluate(() => {
    const h = window.innerHeight
    return [...document.querySelectorAll('button, [role="button"]')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top > h * 0.5 })
      .map(el => {
        const r = el.getBoundingClientRect()
        return `txt="${el.textContent.trim().slice(0,20)}" aria="${el.getAttribute('aria-label')||''}" x=${Math.round(r.left)} y=${Math.round(r.top)} w=${Math.round(r.width)}`
      })
  })
  log('warn', `+ 버튼 못 찾음. 하단 버튼 목록:\n  ${btns.slice(0, 10).join('\n  ')}`)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_setup_plus_notfound.png') })
  return false
}

// ── Step 3: 레퍼런스 이미지 업로드 ────────────────────────────────
async function uploadReferenceImages(page) {
  const images = [
    { filePath: CONFIG.faceImage,    name: 'yeori-face.jpg'    },
    { filePath: CONFIG.closeupImage, name: 'yeori-closeup.jpg' },
  ]

  for (const img of images) {
    if (!fs.existsSync(img.filePath)) {
      log('warn', `파일 없음 → 건너뜀: ${img.filePath}`)
      continue
    }

    log('step', `업로드: ${img.name}`)

    // "+" 버튼 클릭
    const plusOk = await clickPlusButton(page)
    if (!plusOk) { log('warn', `+ 버튼 실패 → ${img.name} 건너뜀`); continue }
    await sleep(1800)

    await page.screenshot({ path: path.join(CONFIG.downloadDir, `debug_setup_upload_${img.name}.png`) })

    // file input 탐색 (Shadow DOM 포함)
    const fileInputHandle = await page.evaluateHandle(() => {
      function search(root) {
        for (const el of root.querySelectorAll('input[type="file"]')) return el
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const f = search(el.shadowRoot); if (f) return f }
        }
        return null
      }
      return search(document)
    })
    const fileInput = fileInputHandle.asElement()

    if (!fileInput) {
      log('warn', `file input 없음 → ${img.name} 건너뜀`)
      await page.keyboard.press('Escape').catch(() => {})
      await fileInputHandle.dispose()
      continue
    }

    // 숨겨진 input 보이게 해서 파일 주입
    await page.evaluate(el => {
      el.style.cssText = 'display:block!important;visibility:visible!important;opacity:1!important;position:fixed;top:0;left:0;z-index:99999'
    }, fileInput)

    await fileInput.uploadFile(img.filePath)
    log('info', `파일 주입 완료: ${img.name}`)
    await sleep(3500)

    // 썸네일 감지 (이름 기반 + 크기 기반)
    const thumbFound = await page.evaluate((name) => {
      const base = name.replace(/\.[^.]+$/, '').toLowerCase()
      return [...document.querySelectorAll('img')].some(el => {
        const r = el.getBoundingClientRect()
        return r.width > 30 && (el.src + el.alt).toLowerCase().includes(base)
      })
    }, img.name)

    if (thumbFound) log('ok', `${img.name} 썸네일 확인 ✓`)
    else log('warn', `${img.name} 썸네일 미확인 (업로드 됐을 수 있음)`)

    await page.keyboard.press('Escape').catch(() => {})
    await sleep(800)
  }

  log('ok', '레퍼런스 이미지 업로드 완료')
}

// ── preFlightCheck — 레퍼런스 썸네일 hover 감지 ────────────────────
// flow-automation.js의 preFlightCheck / findReferenceThumbs 재구현
async function preFlightCheck(page) {
  log('step', '레퍼런스 썸네일 최종 확인 중…')

  // 이미지 스트립 오른쪽으로 스크롤
  await page.evaluate(() => {
    const strip = [...document.querySelectorAll('*')].find(el => {
      const r = el.getBoundingClientRect()
      return el.scrollWidth > el.clientWidth + 50
        && r.top < window.innerHeight * 0.45
        && r.height > 50
    })
    if (strip) strip.scrollLeft = strip.scrollWidth
  })
  await sleep(600)

  // 너비 160px 이상 이미지 후보 수집 (생성된 9:16 컷 썸네일 제외)
  const candidates = await page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .map(img => {
        const r = img.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) }
      })
      .filter(p => p.w > 160 && p.x > 0 && p.y > 0)
  )

  let faceFound = false, closeupFound = false
  for (const pos of candidates) {
    if (faceFound && closeupFound) break
    await page.mouse.move(pos.x, pos.y)
    await sleep(600)
    const text = await page.evaluate(() => document.body.innerText.toLowerCase())
    if (!faceFound    && (text.includes('yeori-face')    || text.includes('yeori_face')))    { faceFound    = true; log('ok', 'yeori-face 썸네일 확인') }
    if (!closeupFound && (text.includes('yeori-closeup') || text.includes('yeori_closeup'))) { closeupFound = true; log('ok', 'yeori-closeup 썸네일 확인') }
  }

  if (!faceFound)    log('warn', 'yeori-face 썸네일 미확인')
  if (!closeupFound) log('warn', 'yeori-closeup 썸네일 미확인')
  return { faceFound, closeupFound }
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  const args  = parseArgs()
  const epNum = args.ep
  if (!epNum) {
    log('error', '--ep=N 인수가 필요합니다. 예) node scripts/flow-setup.js --ep=3')
    process.exit(1)
  }

  ensureDir(CONFIG.downloadDir)
  ensureDir(CONFIG.characterDir)

  console.log('\n' + '═'.repeat(60))
  console.log(`  🎬 Flow Setup — ep${epNum}`)
  console.log('═'.repeat(60) + '\n')

  // ① Chrome 연결 + Flow 탭 확보
  log('step', 'Step 1 — Chrome 연결 확인')
  const browser = await connectBrowser()
  const page    = await getFlowPage(browser)
  log('ok', 'Step 1 완료')

  // ② 새 프로젝트 생성 + URL 저장
  log('step', 'Step 2 — 새 프로젝트 생성')
  const projectUrl = await createProject(page, epNum)

  // 프로젝트 페이지로 이동 (생성 후 이미 이동됐을 수 있음)
  if (!page.url().includes('/project/')) {
    await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2500)
  }
  log('ok', 'Step 2 완료')

  // ③ 레퍼런스 이미지 업로드
  log('step', 'Step 3 — 레퍼런스 이미지 업로드')
  await uploadReferenceImages(page)

  // 최종 확인
  await sleep(1000)
  const { faceFound, closeupFound } = await preFlightCheck(page)

  console.log('\n' + '═'.repeat(60))
  console.log(`  세팅 완료 — ep${epNum}`)
  console.log(`  yeori-face   : ${faceFound    ? '✅ 확인' : '⚠️  미확인'}`)
  console.log(`  yeori-closeup: ${closeupFound ? '✅ 확인' : '⚠️  미확인'}`)
  console.log(`\n  다음 단계:`)
  console.log(`    node scripts/flow-automation.js --ep=${epNum}`)
  console.log('═'.repeat(60) + '\n')
}

main().catch(err => {
  console.error(`[flow-setup] 치명적 오류: ${err.message}`)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
