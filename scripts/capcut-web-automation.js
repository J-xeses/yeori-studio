/**
 * capcut-web-automation.js
 * CapCut 웹버전(capcut.com) 자동화 — 프로젝트 열기 + 내보내기 + mp4 저장
 *
 * 사용법:
 *   node scripts/capcut-web-automation.js --ep=3
 *
 * 전제조건:
 *   Chrome을 remote debugging 모드로 실행:
 *     chrome.exe --remote-debugging-port=9222
 *   capcut.com에 로그인된 상태여야 합니다.
 *
 * 프로젝트 URL 캐시:
 *   C:\yeori-studio\capcut_web_ep{N}_url.txt 에 URL이 있으면 직접 이동합니다.
 *   없으면 capcut.com 홈에서 "ep{N}_shorts" 프로젝트를 검색합니다.
 *
 * 출력:
 *   C:\yeori-studio\downloads\video\ep{N}\ep{N}_final.mp4
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CANDIDATES = [
  { label: '회사 PC', p: 'C:\\Users\\won56\\OneDrive - CTEC\\문서\\GitHub\\yeori-studio\\yeori-studio' },
  { label: '집 PC',   p: 'C:\\Users\\user\\Desktop\\yeori-studio\\yeori-studio' },
]
const CODE_ROOT = (() => {
  for (const { label, p } of CANDIDATES) {
    if (
      fs.existsSync(p) &&
      fs.existsSync(path.join(p, 'node_modules')) &&
      fs.existsSync(path.join(p, 'package.json'))
    ) {
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
  capcutHome:    'https://www.capcut.com/home',
  navTimeout:    30000,
  exportTimeout: 300000, // 5분
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 다운로드 완료 감지 ─────────────────────────────────────────────────
async function waitForDownload(dir, beforeFiles, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = fs.readdirSync(dir)
    const finished = current.filter(f =>
      /\.(mp4|webm|mov)$/i.test(f) &&
      !f.endsWith('.crdownload') &&
      !f.endsWith('.tmp') &&
      !beforeFiles.has(f)
    )
    if (finished.length > 0) {
      // 파일이 완전히 닫혔는지 크기 안정화 확인 (2초 간격 x2)
      const fp = path.join(dir, finished[0])
      const size1 = fs.statSync(fp).size
      await sleep(2000)
      const size2 = fs.statSync(fp).size
      if (size1 > 0 && size1 === size2) return fp
    }
    await sleep(2000)
  }
  throw new Error(`다운로드 타임아웃 (${timeoutMs / 1000}초 초과)`)
}

// ── 프로젝트 카드 클릭 ────────────────────────────────────────────────
async function openProject(page, projectName) {
  console.log(`[capcut-web] 프로젝트 "${projectName}" 찾는 중...`)

  // 홈 페이지 로딩 대기
  await sleep(3000)

  // 1) title 속성으로 찾기
  const byTitle = await page.$(`[title="${projectName}"]`).catch(() => null)
  if (byTitle) { await byTitle.click(); return }

  // 2) aria-label 속성으로 찾기
  const byAria = await page.$(`[aria-label="${projectName}"]`).catch(() => null)
  if (byAria) { await byAria.click(); return }

  // 3) XPath: 텍스트 포함 요소 클릭 (카드 제목)
  const [byText] = await page.$x(
    `//*[normalize-space(text())="${projectName}" or @title="${projectName}" or @data-title="${projectName}"]`
  )
  if (byText) { await byText.click(); return }

  // 4) 스크롤하며 검색
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => window.scrollBy(0, 600))
    await sleep(1000)

    const [el] = await page.$x(`//*[contains(text(), "${projectName}")]`)
    if (el) {
      await el.click()
      console.log(`[capcut-web] 스크롤 후 프로젝트 발견`)
      return
    }
  }

  throw new Error(
    `프로젝트 "${projectName}"를 찾을 수 없습니다.\n` +
    `capcut.com에서 수동으로 프로젝트를 열고 URL을 ` +
    `C:\\yeori-studio\\capcut_web_ep${projectName.replace(/\D/g,'')}_url.txt 에 저장하세요.`
  )
}

// ── 내보내기 버튼 클릭 ────────────────────────────────────────────────
async function clickExport(page) {
  console.log('[capcut-web] 내보내기 버튼 대기 중...')

  // 에디터 완전 로딩 대기
  await page.waitForNetworkIdle({ idleTime: 2000, timeout: 20000 }).catch(() => {})
  await sleep(4000)

  // 후보 선택자 순서대로 시도
  const selectors = [
    '[data-testid="export-button"]',
    '[class*="export-btn"]',
    '[class*="exportBtn"]',
    '[class*="export_btn"]',
    'button[aria-label="Export"]',
    'button[aria-label="내보내기"]',
    'button[aria-label="导出"]',
  ]

  for (const sel of selectors) {
    const el = await page.$(sel).catch(() => null)
    if (el) {
      console.log(`[capcut-web] 내보내기 버튼 클릭: ${sel}`)
      await el.click()
      return
    }
  }

  // XPath: 버튼 텍스트로 찾기
  const xpaths = [
    '//button[contains(., "내보내기")]',
    '//button[contains(., "Export")]',
    '//button[contains(., "导出")]',
    '//*[@role="button" and contains(., "내보내기")]',
    '//*[@role="button" and contains(., "Export")]',
  ]

  for (const xp of xpaths) {
    const [btn] = await page.$x(xp)
    if (btn) {
      console.log(`[capcut-web] 내보내기 버튼 클릭 (xpath): ${xp}`)
      await btn.click()
      return
    }
  }

  // 최후 수단: 상단 헤더 영역 오른쪽 버튼들 중 마지막 버튼
  const headerBtns = await page.$$('header button, [class*="topbar"] button, [class*="header"] button')
  if (headerBtns.length > 0) {
    const last = headerBtns[headerBtns.length - 1]
    console.log(`[capcut-web] 헤더 마지막 버튼 클릭 (fallback)`)
    await last.click()
    return
  }

  throw new Error('내보내기 버튼을 찾을 수 없습니다. 에디터가 완전히 로딩되었는지 확인하세요.')
}

// ── 내보내기 다이얼로그 처리 (해상도 선택 + 확인) ──────────────────────
async function handleExportDialog(page) {
  console.log('[capcut-web] 내보내기 다이얼로그 처리 중...')
  await sleep(2000)

  // 1080p 선택 시도
  const qualitySelectors = [
    '[data-value="1080p"]',
    'input[value="1080"]',
    '[aria-label="1080p"]',
    '[class*="quality"][value*="1080"]',
  ]
  for (const sel of qualitySelectors) {
    const el = await page.$(sel).catch(() => null)
    if (el) {
      await el.click()
      console.log(`[capcut-web] 1080p 선택: ${sel}`)
      await sleep(500)
      break
    }
  }

  const [q1080] = await page.$x('//*[contains(text(), "1080") and (@role="option" or @role="radio" or contains(@class, "quality"))]')
  if (q1080) {
    await q1080.click()
    console.log('[capcut-web] 1080p 선택 (xpath)')
    await sleep(500)
  }

  // 확인/다운로드 버튼 클릭
  const confirmSelectors = [
    '[data-testid="export-confirm-btn"]',
    '[class*="export-dialog"] button[class*="primary"]',
    '[class*="export-modal"] button[class*="primary"]',
    '[class*="download-btn"]',
  ]

  for (const sel of confirmSelectors) {
    const el = await page.$(sel).catch(() => null)
    if (el) {
      console.log(`[capcut-web] 다운로드 확인 클릭: ${sel}`)
      await el.click()
      return
    }
  }

  const confirmXPaths = [
    '//button[contains(., "내보내기") and (contains(@class, "primary") or contains(@class, "confirm"))]',
    '//button[contains(., "Export") and (contains(@class, "primary") or contains(@class, "confirm"))]',
    '//button[contains(., "Download")]',
    '//button[contains(., "다운로드")]',
    '//*[@role="dialog"]//button[last()]',
  ]

  for (const xp of confirmXPaths) {
    const [btn] = await page.$x(xp)
    if (btn) {
      console.log(`[capcut-web] 다운로드 확인 클릭 (xpath): ${xp}`)
      await btn.click()
      return
    }
  }

  console.warn('[capcut-web] ⚠ 다이얼로그 확인 버튼을 찾지 못했습니다. 수동으로 확인하세요.')
}

// ── 메인 ─────────────────────────────────────────────────────────────
async function main() {
  const epArg = process.argv.find(a => a.startsWith('--ep='))
  const epNum = epArg ? epArg.replace('--ep=', '').trim() : null

  if (!epNum) {
    console.error('❌ 사용법: node scripts/capcut-web-automation.js --ep=N')
    process.exit(1)
  }

  console.log(`\n🎬 CapCut 웹 자동화 시작 — ep${epNum}\n`)

  // ── 경로 설정 ─────────────────────────────────────────────────────
  const destDir  = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`)
  const destFile = path.join(destDir, `ep${epNum}_final.mp4`)
  const tempDir  = path.join(MEDIA_ROOT, 'downloads', 'temp_capcut')
  fs.mkdirSync(destDir, { recursive: true })
  fs.mkdirSync(tempDir, { recursive: true })

  // ── 프로젝트 이름/URL 결정 ────────────────────────────────────────
  const specPath = path.join(MEDIA_ROOT, 'downloads', 'capcut_spec.json')
  let projectName = `ep${epNum}_shorts`
  let projectUrl  = null

  if (fs.existsSync(specPath)) {
    try {
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'))
      if (spec.name) projectName = spec.name
    } catch {}
  }

  // ① 저장된 에피소드별 URL 확인
  const urlCachePath = path.join(MEDIA_ROOT, `capcut_web_ep${epNum}_url.txt`)
  if (fs.existsSync(urlCachePath)) {
    projectUrl = fs.readFileSync(urlCachePath, 'utf-8').trim()
    console.log(`[capcut-web] 캐시된 URL 사용: ${projectUrl}`)
  }

  // ② draft_content.json에서 webUrl / projectUrl 확인
  if (!projectUrl) {
    const draftPath = path.join(MEDIA_ROOT, 'downloads', 'draft_content.json')
    if (fs.existsSync(draftPath)) {
      try {
        const draft = JSON.parse(fs.readFileSync(draftPath, 'utf-8'))
        projectUrl = draft.projectUrl || draft.webUrl || null
        if (projectUrl) console.log(`[capcut-web] draft_content.json URL 사용: ${projectUrl}`)
      } catch {}
    }
  }

  console.log(`[capcut-web] 프로젝트명: ${projectName}`)
  console.log(`[capcut-web] 저장 경로: ${destFile}`)

  // ── Chrome 연결 ───────────────────────────────────────────────────
  console.log(`\n[capcut-web] Chrome 연결 중 (port ${CONFIG.debuggingPort})...`)
  let browser
  try {
    browser = await puppeteer.connect({
      browserURL:      `http://localhost:${CONFIG.debuggingPort}`,
      defaultViewport: null,
    })
  } catch (err) {
    console.error(`❌ Chrome 연결 실패: ${err.message}`)
    console.error(`   → 아래 명령으로 Chrome을 실행한 후 다시 시도하세요:`)
    console.error(`   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${CONFIG.debuggingPort}`)
    process.exit(1)
  }

  // capcut.com 탭 찾기 또는 새 탭 생성
  const allPages = await browser.pages()
  let page = allPages.find(p => p.url().includes('capcut.com'))
  if (!page) {
    page = await browser.newPage()
  }

  // ── 다운로드 디렉토리 설정 (CDP) ─────────────────────────────────
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', {
    behavior:     'allow',
    downloadPath: tempDir,
  })

  // 다운로드 전 파일 목록 스냅샷
  const beforeFiles = new Set(
    fs.readdirSync(tempDir).filter(f => /\.(mp4|webm|mov)$/i.test(f))
  )

  try {
    // ── 프로젝트 열기 ───────────────────────────────────────────────
    if (projectUrl) {
      console.log(`[capcut-web] 프로젝트 URL로 직접 이동...`)
      await page.goto(projectUrl, {
        waitUntil: 'networkidle2',
        timeout:   CONFIG.navTimeout,
      })
    } else {
      if (!page.url().includes('capcut.com')) {
        console.log(`[capcut-web] capcut.com 홈으로 이동...`)
        await page.goto(CONFIG.capcutHome, {
          waitUntil: 'networkidle2',
          timeout:   CONFIG.navTimeout,
        })
      }
      await openProject(page, projectName)
      // 프로젝트 클릭 후 에디터로 이동 대기
      await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout:   CONFIG.navTimeout,
      }).catch(() => {})
    }

    // 현재 URL 저장 (에디터 URL)
    const editorUrl = page.url()
    if (editorUrl.includes('capcut.com') && editorUrl.length > 40) {
      fs.writeFileSync(urlCachePath, editorUrl, 'utf-8')
      console.log(`[capcut-web] URL 캐시 저장: ${urlCachePath}`)
    }

    // ── 내보내기 클릭 ────────────────────────────────────────────────
    await clickExport(page)
    await sleep(1500)

    // ── 내보내기 다이얼로그 처리 ─────────────────────────────────────
    await handleExportDialog(page)

    // ── 다운로드 완료 대기 ───────────────────────────────────────────
    console.log(`\n[capcut-web] 내보내기 완료 대기 중... (최대 ${CONFIG.exportTimeout / 60000}분)`)
    const downloadedFile = await waitForDownload(tempDir, beforeFiles, CONFIG.exportTimeout)

    // ── 최종 경로로 이동 ─────────────────────────────────────────────
    fs.mkdirSync(destDir, { recursive: true })
    if (fs.existsSync(destFile)) fs.unlinkSync(destFile)
    fs.renameSync(downloadedFile, destFile)

    console.log(`\n✅ ep${epNum} 내보내기 완료!`)
    console.log(`   → ${destFile}`)
    console.log(`   크기: ${(fs.statSync(destFile).size / 1024 / 1024).toFixed(1)} MB\n`)

  } catch (err) {
    console.error(`\n❌ 오류: ${err.message}\n`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err.message)
  process.exit(1)
})
