/**
 * 여리 스튜디오 - Google Veo 3.1 영상 자동화
 *
 * 사용법:
 *   npm run video                          # downloads/video/video-prompts.json 기반 실행
 *   npm run video -- --ep=1              # 에피소드 1만 처리
 *   npm run video -- --cut=3             # CUT 3만 처리
 *   npm run video -- --dry               # 실제 생성 없이 목록 출력
 *   npm run video -- --prompts=my.json  # 외부 프롬프트 파일 지정
 *
 * 입력:  downloads/flow/ep{N}/cut_NN.jpg  (Flow 생성 이미지)
 * 출력:  downloads/video/ep{N}/cut_NN.mp4
 *
 * 사전 준비:
 *   Chrome을 아래 명령으로 실행하세요:
 *   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── ROOT 자동 감지 ──────────────────────────────────────────────────────
const COMPANY_PATH = 'C:\\yeori-studio'
const HOME_PATH    = 'C:\\Users\\user\\Desktop\\yeori-studio\\yeori-studio'
const ROOT = (() => {
  if (fs.existsSync(COMPANY_PATH)) { console.log('[ROOT] 회사 PC'); return COMPANY_PATH }
  if (fs.existsSync(HOME_PATH))    { console.log('[ROOT] 집 PC');   return HOME_PATH    }
  console.error('[ERROR] ROOT 경로를 찾을 수 없습니다.')
  process.exit(1)
})()

// .env / .env.local 로드
;['.env', '.env.local'].forEach(name => {
  const envPath = path.join(ROOT, name)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '')
  })
})

// ── 설정 ─────────────────────────────────────────────────────────────────
const CONFIG = {
  debuggingPort: 9222,
  chromeExe:     'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  flowDir:       path.join(ROOT, 'downloads', 'flow'),
  downloadDir:   path.join(ROOT, 'downloads', 'video'),
  veoUrl:        'https://labs.google/fx/ko/tools/veo',
  delayMs:       5000,    // 컷 사이 대기 (레이트 리밋 방지)
  timeoutMs:     300000,  // 5분 — 영상 생성은 이미지보다 오래 걸림
  retryCount:    1,
}

// ── 진입점 ────────────────────────────────────────────────────────────────
const args = parseArgs()

main().catch(err => {
  console.error(`[video] 치명적 오류: ${err.message}`)
  if (err.stack) console.error(err.stack)
  log('error', `치명적 오류: ${err.message}`)
  process.exit(1)
})

// ── 유틸리티 ─────────────────────────────────────────────────────────────

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

// ── 프롬프트 로드 ─────────────────────────────────────────────────────────
// 우선순위: --prompts 인자 > downloads/video/video-prompts.json > downloads/flow/prompts.json
function loadPrompts() {
  let file
  if (args.prompts) {
    file = path.resolve(args.prompts)
  } else {
    const videoFile = path.join(CONFIG.downloadDir, 'video-prompts.json')
    const flowFile  = path.join(CONFIG.flowDir, 'prompts.json')
    if (fs.existsSync(videoFile)) {
      file = videoFile
    } else if (fs.existsSync(flowFile)) {
      file = flowFile
      log('info', 'video-prompts.json 없음 → flow/prompts.json 사용')
    } else {
      log('warn', '입력 파일 없음. video-prompts.json 또는 flow/prompts.json이 필요합니다.')
      log('info', '여리 스튜디오 → 영상 탭 → "영상 프롬프트 JSON 내보내기" 버튼을 먼저 실행하세요.')
      process.exit(0)
    }
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const episode = raw.episode ?? null

  const cuts = (Array.isArray(raw) ? raw : raw.cuts ?? [])
    .filter(c => c.imagePrompt?.trim() || c.videoPrompt?.trim() || c.narration?.trim())
    .filter(c => !args.ep  || String(c.episode ?? episode) === String(args.ep))
    .filter(c => !args.cut || String(c.no) === String(args.cut))

  return { episode, cuts }
}

// ── 브라우저 연결 ─────────────────────────────────────────────────────────

async function connectBrowser() {
  const wsUrl = `http://127.0.0.1:${CONFIG.debuggingPort}/json/version`
  let version
  try {
    const res = await fetch(wsUrl)
    version = await res.json()
  } catch {
    console.error('\n' + '═'.repeat(56))
    console.error('  Chrome에 연결할 수 없습니다.')
    console.error('  아래 명령으로 Chrome을 먼저 실행해주세요:')
    console.error(`\n  "${CONFIG.chromeExe}" --remote-debugging-port=${CONFIG.debuggingPort}`)
    console.error('\n  (실행 중인 Chrome이 있으면 완전히 종료 후 위 명령 사용)')
    console.error('═'.repeat(56) + '\n')
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
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', {
    behavior:     'allow',
    downloadPath: CONFIG.downloadDir,
  })
  page._cdpClient = client
  return page
}

// ── Veo 3.1 접속 ──────────────────────────────────────────────────────────

async function navigateToVeo(page) {
  log('info', `Veo 접속 중: ${CONFIG.veoUrl}`)
  await page.goto(CONFIG.veoUrl, { waitUntil: 'networkidle2', timeout: 30000 })

  const needsLogin = () => {
    const u = page.url()
    return u.includes('accounts.google.com') || u.includes('signin') ||
           u.includes('#pricing') || u.includes('/pricing')
  }

  if (needsLogin()) {
    log('warn', 'Google 로그인이 필요합니다.')
    console.log('\n브라우저에서 Google 계정으로 로그인 후 Enter를 눌러주세요.')
    await new Promise(resolve => process.stdin.once('data', resolve))
    await page.goto(CONFIG.veoUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    if (needsLogin()) throw new Error('로그인 후에도 pricing 페이지로 리다이렉트됩니다. 로그인 상태를 확인하세요.')
  }

  // 쿠키 동의 처리
  const hadCookie = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const agree = btns.find(b => /^(agree|동의)$/i.test(b.textContent.trim()))
    if (agree) { agree.click(); return true }
    return false
  })
  if (hadCookie) await sleep(500)

  log('ok', 'Veo 준비 완료')
}

// ── 입력창 위치 탐색 (Shadow DOM 포함) ───────────────────────────────────

async function findPromptInputPos(page) {
  const found = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll(
        '[role="textbox"], [role="combobox"], textarea, input[type="text"], [contenteditable="true"]'
      )) {
        if (el.classList.contains('g-recaptcha-response')) continue
        const r = el.getBoundingClientRect()
        if (r.width > 100 && r.top > window.innerHeight * 0.4) {
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
  return { x: vp.w * 0.48, y: vp.h * 0.87 }
}

// ── 시작 프레임 이미지 업로드 ─────────────────────────────────────────────

async function uploadStartFrame(page, imagePath) {
  if (!fs.existsSync(imagePath)) {
    log('warn', `시작 프레임 없음: ${path.relative(ROOT, imagePath)}`)
    return false
  }

  // 전략 1: file input 직접 탐색 (Shadow DOM 포함)
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
  if (fileInput) {
    await page.evaluate(el => {
      el.style.display    = 'block'
      el.style.visibility = 'visible'
      el.style.opacity    = '1'
      el.style.position   = 'fixed'
      el.style.top = '0'; el.style.left = '0'
      el.style.zIndex     = '99999'
    }, fileInput)
    await fileInput.uploadFile(imagePath)
    log('info', `시작 프레임 업로드: ${path.basename(imagePath)}`)
    await sleep(2000)
    await fileInputHandle.dispose()
    return true
  }
  await fileInputHandle.dispose()

  // 전략 2: 업로드 트리거 버튼 클릭 후 file input 재탐색
  const triggered = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('button, [role="button"], label')) {
        const txt   = (el.textContent || '').trim().toLowerCase()
        const label = (el.getAttribute('aria-label') || '').toLowerCase()
        const combined = txt + ' ' + label
        if (/(이미지|사진|upload|add photo|add image|reference|시작 프레임|start frame|image to video)/i.test(combined)
            && el.getBoundingClientRect().width > 0) {
          el.click(); return combined.slice(0, 40)
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return null
    }
    return search(document)
  })

  if (triggered) {
    log('info', `업로드 트리거 클릭: "${triggered}"`)
    await sleep(800)
    const fileInputHandle2 = await page.evaluateHandle(() => {
      function search(root) {
        for (const el of root.querySelectorAll('input[type="file"]')) return el
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const f = search(el.shadowRoot); if (f) return f }
        }
        return null
      }
      return search(document)
    })
    const fi2 = fileInputHandle2.asElement()
    if (fi2) {
      await fi2.uploadFile(imagePath)
      log('info', `시작 프레임 업로드 (트리거 후): ${path.basename(imagePath)}`)
      await sleep(2000)
      await fileInputHandle2.dispose()
      return true
    }
    await fileInputHandle2.dispose()
  }

  log('warn', '시작 프레임 업로드 실패 — 텍스트 프롬프트만으로 진행합니다')
  return false
}

// ── 영상 프롬프트 입력 ────────────────────────────────────────────────────

async function typeVideoPrompt(page, prompt) {
  const pos = await findPromptInputPos(page)
  await page.mouse.click(pos.x, pos.y)
  await sleep(300)
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(100)
  await page.keyboard.type(prompt, { delay: 15 })
  log('info', `프롬프트: ${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}`)
  await sleep(500)
}

// ── 생성 버튼 클릭 ────────────────────────────────────────────────────────

async function clickGenerate(page) {
  const rect = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('button')) {
        if (el.disabled) continue
        const r = el.getBoundingClientRect()
        if (r.top < window.innerHeight * 0.5 || r.width < 1) continue
        const txt   = el.textContent.trim()
        const label = (el.getAttribute('aria-label') || '').toLowerCase()
        if (txt === '→' || txt === '▶' ||
            label.includes('send') || label.includes('전송') || label.includes('보내기') ||
            label.includes('generate') || label.includes('생성')) {
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

// ── 영상 생성 대기 + 저장 ────────────────────────────────────────────────

async function waitAndSaveVideo(page, outPath) {
  log('step', `영상 생성 대기 중… (최대 ${CONFIG.timeoutMs / 60000}분)`)
  const epDir = path.dirname(outPath)
  ensureDir(epDir)

  // 생성 전 다운로드 폴더 스냅샷
  const beforeFiles = new Set(
    fs.existsSync(CONFIG.downloadDir)
      ? fs.readdirSync(CONFIG.downloadDir).filter(f => /\.(mp4|webm|mov)$/i.test(f))
      : []
  )

  // video 태그에 src가 생길 때까지 대기
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
    // 타임아웃 — 다운로드 버튼이 먼저 나타났을 수도 있음
    log('warn', '영상 태그 대기 타임아웃 → 다운로드 버튼 시도')
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_video_timeout.png'), fullPage: true })
  }
  await sleep(1000)

  // 방법 A: 다운로드 버튼 클릭
  const dlClicked = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('button, a')) {
        const txt   = (el.textContent || '').toLowerCase()
        const label = (el.getAttribute('aria-label') || '').toLowerCase()
        if (/(다운로드|download)/i.test(txt + label) && el.getBoundingClientRect().width > 0) {
          el.click(); return true
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && search(el.shadowRoot)) return true
      }
      return false
    }
    return search(document)
  })

  if (dlClicked) {
    log('info', '다운로드 버튼 클릭 — 파일 대기 중…')
    // 최대 30초 동안 새 파일 폴링
    for (let i = 0; i < 30; i++) {
      await sleep(1000)
      const after = fs.readdirSync(CONFIG.downloadDir).filter(f => /\.(mp4|webm|mov)$/i.test(f))
      const newFile = after.find(f => !beforeFiles.has(f) && !f.endsWith('.crdownload'))
      if (newFile) {
        fs.renameSync(path.join(CONFIG.downloadDir, newFile), outPath)
        log('ok', `영상 저장: ${path.relative(ROOT, outPath)}`)
        return outPath
      }
    }
    log('warn', '다운로드 파일이 감지되지 않음 → video src 직접 저장 시도')
  }

  // 방법 B: video src를 페이지 컨텍스트에서 직접 fetch
  const videoSrc = await page.evaluate(() => {
    function search(root) {
      for (const v of root.querySelectorAll('video')) {
        const src = v.src || v.querySelector('source')?.src || ''
        if (src && !src.includes('poster') && src.length > 10) return src
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return null
    }
    return search(document)
  })

  if (videoSrc) {
    log('info', `video src 직접 저장: ${videoSrc.slice(0, 80)}…`)
    const data = await page.evaluate(async (src) => {
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        return Array.from(new Uint8Array(buf))
      } catch { return null }
    }, videoSrc)

    if (data) {
      fs.writeFileSync(outPath, Buffer.from(data))
      log('ok', `영상 저장: ${path.relative(ROOT, outPath)}`)
      return outPath
    }
  }

  // 방법 C: 스크린샷 남기고 실패
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_video_save_fail.png'), fullPage: true })
  throw new Error('영상을 저장할 수 없습니다 (debug_video_save_fail.png 확인)')
}

// ── 컷 1개 처리 ──────────────────────────────────────────────────────────

async function processCut(page, cut, episode) {
  const ep     = cut.episode ?? episode ?? 'x'
  const padded = String(cut.no).padStart(2, '0')
  const imgPath = path.join(CONFIG.flowDir, `ep${ep}`, `cut_${padded}.jpg`)
  const outPath = path.join(CONFIG.downloadDir, `ep${ep}`, `cut_${padded}.mp4`)

  if (fs.existsSync(outPath)) {
    log('ok', `CUT ${cut.no} 이미 존재 → 스킵`)
    return outPath
  }

  // 시작 프레임 업로드 (jpg 있을 때만)
  await uploadStartFrame(page, imgPath)

  // 영상 프롬프트 우선순위: videoPrompt > narration 첫 줄 > imagePrompt 앞 200자
  const videoPrompt = (
    cut.videoPrompt?.trim()
    || cut.narration?.split('\n')[0]?.replace(/샷\s*타입[:\s].*$/i, '').trim()
    || cut.imagePrompt?.slice(0, 200).trim()
    || 'Cinematic shot, subtle camera movement, photorealistic'
  )

  await typeVideoPrompt(page, videoPrompt)
  await clickGenerate(page)
  return waitAndSaveVideo(page, outPath)
}

// ── 메인 ─────────────────────────────────────────────────────────────────

async function main() {
  ensureDir(CONFIG.downloadDir)
  const { episode, cuts } = loadPrompts()

  if (!cuts.length) {
    log('warn', '처리할 컷이 없습니다. --ep / --cut 조건을 확인하세요.')
    return
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  🎬 여리 스튜디오 — Google Veo 3.1 자동화')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  if (episode) console.log(`  에피소드: ${episode}`)
  console.log(`  처리 컷 수: ${cuts.length}개`)
  console.log(`  저장 위치: downloads/video/`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (args.dry) {
    cuts.forEach((c, i) => {
      const prompt = c.videoPrompt
        || c.narration?.split('\n')[0]
        || c.imagePrompt?.slice(0, 80)
      console.log(`  [${i + 1}] CUT ${c.no}: ${prompt}`)
    })
    return
  }

  let browser
  try {
    browser = await connectBrowser()
  } catch {
    process.exit(1)
  }

  const page = await setupPage(browser)
  await navigateToVeo(page)

  let ok = 0, fail = 0
  const results = []

  for (let i = 0; i < cuts.length; i++) {
    const cut   = cuts[i]
    const label = `[${i + 1}/${cuts.length}] CUT ${cut.no}`
    log('step', `${label} 생성 중…`)

    for (let attempt = 0; attempt <= CONFIG.retryCount; attempt++) {
      try {
        const savedPath = await processCut(page, cut, episode)
        log('ok', `${label} → ${path.relative(ROOT, savedPath)}`)
        results.push({ cutNo: cut.no, status: 'ok', file: savedPath })
        ok++; break
      } catch (err) {
        if (attempt < CONFIG.retryCount) {
          log('warn', `${label} 재시도 ${attempt + 1}/${CONFIG.retryCount}: ${err.message}`)
          await sleep(2000)
        } else {
          log('error', `${label} 실패: ${err.message}`)
          results.push({ cutNo: cut.no, status: 'fail', reason: err.message })
          fail++
        }
      }
    }

    if (i < cuts.length - 1) {
      process.stdout.write(`   ${CONFIG.delayMs / 1000}초 대기 중…`)
      await sleep(CONFIG.delayMs)
      process.stdout.write('\r' + ' '.repeat(30) + '\r')
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  완료: ✅ ${ok}개 성공 / ❌ ${fail}개 실패`)
  if (fail > 0) {
    results.filter(r => r.status === 'fail')
      .forEach(r => console.log(`    CUT ${r.cutNo}: ${r.reason}`))
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const reportPath = path.join(CONFIG.downloadDir, `report_ep${episode ?? 'x'}_${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(), episode, results,
  }, null, 2))
  log('info', `리포트: ${path.relative(ROOT, reportPath)}`)
}
