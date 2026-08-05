/**
 * 여리 스튜디오 - PixVerse 크레딧 확인 (디스커버리 전용, Flow의 --check-credits와 동일 계열)
 *
 * 사용법:
 *   npm run pixverse -- --check-credits                  # 서브 계정(포트 9223, 기본)
 *   npm run pixverse -- --check-credits --profile=main    # 메인 계정으로 확인
 *
 * 사전 준비: 전용 Chrome(포트 9223, --user-data-dir=downloads/flow/chrome-profile-sub)에
 * app.pixverse.ai로 미리 로그인해둘 것. Flow와 같은 크롬 프로필을 공유한다
 * (계정당 도구 2개 매핑: 서브 계정 → Flow + PixVerse).
 *
 * ⚠️ 크롬 136+ 부터 --remote-debugging-port는 기본 프로필에서 무시되므로,
 * 반드시 --user-data-dir로 비-기본 폴더를 지정해서 Chrome을 띄워야 함.
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'

const MEDIA_ROOT = 'C:\\yeori-studio'
const CODE_ROOT = 'C:\\yeori-studio\\app'

const PROFILE_PORTS = { main: 9222, sub: 9223 }
const args = parseArgs()
const activeProfile = args.profile === 'main' ? 'main' : 'sub'

const CONFIG = {
  debuggingPort: PROFILE_PORTS[activeProfile],
  // Flow와 동일한 프로필 폴더를 재사용 — 계정당 도구 2개(Flow+Qwen / Flow+PixVerse) 매핑이라
  // 같은 구글 계정으로 로그인된 같은 크롬 창에서 PixVerse도 같이 로그인해두면 됨.
  userDataDir:  path.join(MEDIA_ROOT, 'downloads', 'flow', `chrome-profile-${activeProfile}`),
  chromeExe:    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  downloadDir:  path.join(MEDIA_ROOT, 'downloads', 'pixverse'),
  pixverseUrl:  'https://app.pixverse.ai',
}

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
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) }

async function connectBrowser() {
  const wsUrl = `http://127.0.0.1:${CONFIG.debuggingPort}/json/version`
  let version
  try {
    const res = await fetch(wsUrl)
    version = await res.json()
  } catch {
    console.error('\n' + '═'.repeat(56))
    console.error(`  Chrome에 연결할 수 없습니다. (프로필: ${activeProfile})`)
    console.error('  Chrome을 먼저 아래 명령으로 실행해주세요:')
    console.error(`\n  "${CONFIG.chromeExe}" --remote-debugging-port=${CONFIG.debuggingPort} --user-data-dir="${CONFIG.userDataDir}"`)
    console.error(`\n  (이 폴더는 Flow와 공유하는 ${activeProfile === 'main' ? '메인' : '서브'} 계정 전용 프로필 — 이미 Flow용으로 로그인해뒀다면 PixVerse만 추가로 로그인하면 됨)`)
    console.error('  다른 크롬이 하나라도 떠 있으면 먼저 taskkill /F /IM chrome.exe 로 전부 종료 후 실행하세요.')
    console.error('═'.repeat(56) + '\n')
    throw new Error(`Chrome remote debugging 포트(${CONFIG.debuggingPort})에 연결 실패`)
  }
  log('info', `Chrome 연결 완료 (${version.Browser})`)
  return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl, defaultViewport: null })
}

async function setupPage(browser) {
  const pages = await browser.pages()
  const existing = pages.find(p => p.url().includes('pixverse.ai'))
  if (existing) {
    log('info', `기존 PixVerse 탭 재사용: ${existing.url().slice(0, 70)}`)
    return existing
  }
  log('info', '기존 PixVerse 탭 없음 → 새 탭 생성')
  return browser.newPage()
}

async function navigateToPixverse(page) {
  if (page.url().includes('pixverse.ai')) {
    log('ok', 'PixVerse 화면 준비 완료 (기존 탭)')
    return
  }
  log('info', `PixVerse 접속 중: ${CONFIG.pixverseUrl}`)
  await page.goto(CONFIG.pixverseUrl, { waitUntil: 'networkidle2', timeout: 30000 })
  await sleep(2000)
  log('ok', 'PixVerse 화면 준비 완료')
}

// "60 credits", "60/90", "크레딧 60" 등 숫자+크레딧 관련 텍스트를 폭넓게 탐지
async function scanForCreditText(page) {
  return page.evaluate(() => {
    function deepLeaves(root, list = []) {
      for (const el of root.querySelectorAll('*')) {
        if (el.children.length === 0) list.push(el)
        if (el.shadowRoot) deepLeaves(el.shadowRoot, list)
      }
      return list
    }
    const found = []
    for (const el of deepLeaves(document)) {
      const txt = (el.textContent || '').trim()
      if (!txt) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      // 순수 숫자만 있고 화면 상단(헤더 영역)에 있으면 배지형 크레딧 표시일 가능성이 높음
      // (프로모션 문구 속 "8,888" 같은 콤마 포함 숫자는 이 정규식에 안 걸림)
      const isHeaderNumber = /^\d{1,6}$/.test(txt) && r.top < window.innerHeight * 0.15
      const isCreditWord = txt.length <= 60 && (/(크레딧|credit)/i.test(txt) || /^\d{1,5}\s*\/\s*\d{1,5}$/.test(txt))
      if (!isHeaderNumber && !isCreditWord) continue
      found.push({
        txt, aria: el.getAttribute('aria-label') || '',
        x: Math.round(r.left), y: Math.round(r.top),
        type: isHeaderNumber ? 'headerNumber' : 'creditWord',
      })
    }
    return found
  })
}

async function checkPixverseCredits(page) {
  log('info', `PixVerse 크레딧 표시 탐색 중… (프로필: ${activeProfile})`)
  await sleep(1500)

  // 실측 결과: PixVerse는 Flow와 달리 상단 탭에 크레딧 숫자가 바로 보임(클릭 불필요).
  // 아바타 클릭은 오히려 "크레딧 획득" 프로모션 패널을 열어 노이즈만 늘려서 생략한다.
  const matches = await scanForCreditText(page)
  const shotPath = path.join(CONFIG.downloadDir, `debug_credits_dashboard_${activeProfile}.png`)
  await page.screenshot({ path: shotPath, fullPage: true })

  // 헤더의 순수 숫자 배지를 최우선 신뢰 — 프로모션 문구 속 숫자보다 정확함
  let remaining = null
  const headerMatch = matches.find(m => m.type === 'headerNumber')
  if (headerMatch) {
    remaining = parseInt(headerMatch.txt, 10)
  } else {
    const leadingNumber = matches.map(m => m.txt.match(/^(\d+)\s/)).find(Boolean)
    if (leadingNumber) remaining = parseInt(leadingNumber[1], 10)
  }

  if (matches.length) {
    log('ok', `크레딧 관련 후보 ${matches.length}개 발견:`)
    matches.forEach(m => log('info', `  [${m.type}] "${m.txt}" aria="${m.aria}" @ (${m.x},${m.y})`))
  } else {
    log('warn', '크레딧 표시를 못 찾았습니다 — debug_credits_dashboard 스크린샷을 직접 확인해주세요.')
  }
  if (remaining != null) log('ok', `잔여 크레딧 파싱 결과: ${remaining}`)
  else log('warn', '숫자 패턴을 못 찾아 자동 파싱 실패 — 후보 텍스트를 확인해주세요.')

  log('info', `대시보드 스크린샷: ${path.relative(CODE_ROOT, shotPath)}`)

  console.log(`CREDIT_RESULT:${JSON.stringify({ tool: 'pixverse', profile: activeProfile, remaining, checkedAt: new Date().toISOString() })}`)
}

async function main() {
  ensureDir(CONFIG.downloadDir)

  if (!args['check-credits']) {
    log('warn', '--check-credits 옵션이 필요합니다. 예) npm run pixverse -- --check-credits')
    return
  }

  const browser = await connectBrowser()
  const page = await setupPage(browser)
  await navigateToPixverse(page)
  await checkPixverseCredits(page)

  // puppeteer.connect() 세션은 disconnect() 없이는 프로세스가 안 끝남 (Flow 쪽에서 겪은 버그와 동일)
  await browser.disconnect()
  process.exit(0)
}

main().catch(err => {
  console.error(`[pixverse] 치명적 오류: ${err.message}`)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
