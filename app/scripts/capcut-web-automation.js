/**
 * capcut-web-automation.js
 * CapCut 웹버전(capcut.com) 신규 프로젝트 생성 자동화
 *
 * 흐름:
 *  1. capcut.com/recent-list 접속 확인
 *  2. "새로 만들기" 버튼 클릭 → 드롭다운 → 9:16 선택 (새 탭 오픈)
 *  3. 에디터 탭으로 전환 후 로딩 확인
 *  4. ep{N}_raw.mp4 업로드
 *  5. 타임라인에 추가
 *  6. 켄번스 효과 적용 (capcut_spec.json 기반, ops 있을 때만)
 *  7. SRT 자막 삽입
 *  8. BGM 업로드 + 삽입
 *  9. 색보정(warm 필터) 적용
 * 10. 내보내기 자동 실행
 * 11. 프로젝트 URL → capcut_web_ep{N}_url.txt 저장
 *
 * 사용법:
 *   node scripts/capcut-web-automation.js --ep=2
 *
 * 전제조건:
 *   chrome.exe --remote-debugging-port=9222  (capcut.com 로그인 상태)
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── ROOT 자동 감지 ──────────────────────────────────────────────────────
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
  console.error('[ERROR] CODE_ROOT를 찾을 수 없습니다.'); process.exit(1)
})()

const MEDIA_ROOT = 'C:\\yeori-studio'

const CONFIG = {
  debuggingPort: 9222,
  capcutRecent:  'https://www.capcut.com/recent-list',
  navTimeout:    30000,
  uploadTimeout: 120000, // 2분 (대용량 mp4)
  exportTimeout: 300000, // 5분
}

// ── 헬퍼 ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// puppeteer-core v22+: $x 제거 → ::-p-xpath() 사용
const xsel = (xpath) => `::-p-xpath(${xpath})`

async function findFirst(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el) return el
    } catch {}
  }
  return null
}

async function findFirstXP(page, xpaths) {
  for (const xp of xpaths) {
    try {
      const el = await page.$(xsel(xp))
      if (el) return el
    } catch {}
  }
  return null
}

// stale element 방지: 클릭 직전 요소를 locate()로 재탐색 → 화면 중앙으로
// scrollIntoView → 일반 클릭 시도 → 실패 시 page.evaluate()로 직접 클릭
async function robustClick(page, locate, label = '') {
  const el = await locate()
  if (!el) return false
  await page.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }), el).catch(() => {})
  await sleep(200)
  try {
    await el.click()
    return true
  } catch (e) {
    console.warn(`[click] 일반 클릭 실패 (${label}): ${e.message} — evaluate 클릭 시도`)
    try {
      await page.evaluate(node => node.click(), el)
      return true
    } catch (e2) {
      console.warn(`[click] evaluate 클릭도 실패 (${label}): ${e2.message}`)
      return false
    }
  }
}

// 파일 선택 다이얼로그 처리 (puppeteer v22+)
async function pickFile(page, triggerFn, filePaths, timeoutMs = 30000) {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() =>
      reject(new Error('파일 선택 다이얼로그 타임아웃')),
      timeoutMs
    )
    page.once('filechooser', async (chooser) => {
      clearTimeout(timer)
      try { await chooser.accept(filePaths); resolve() }
      catch (e) { reject(e) }
    })
    await triggerFn()
  })
}

// 다운로드 파일 완료 감지
async function waitForDownload(dir, beforeFiles, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const cur = fs.readdirSync(dir)
    const done = cur.filter(f =>
      /\.(mp4|webm|mov)$/i.test(f) &&
      !f.endsWith('.crdownload') &&
      !f.endsWith('.tmp') &&
      !beforeFiles.has(f)
    )
    if (done.length > 0) {
      const fp = path.join(dir, done[0])
      const s1 = fs.statSync(fp).size
      await sleep(2000)
      const s2 = fs.statSync(fp).size
      if (s1 > 0 && s1 === s2) return fp
    }
    await sleep(2000)
  }
  throw new Error(`다운로드 타임아웃 (${timeoutMs / 1000}초)`)
}

// ── STEP 1: capcut.com/recent-list 접속 확인 ──────────────────────────
// 이미 에디터가 열려있거나 캐시된 프로젝트 URL이 있으면 그 에디터를 재사용하고,
// 새 프로젝트 생성(step2)을 건너뛸 수 있도록 재사용 가능한 page를 반환한다.
// 반환값: 재사용 가능한 에디터 page (step2 스킵) 또는 null (step2 진행 필요)
async function step1_navigate(page, urlCache) {
  const url = page.url()
  // 이미 에디터에 있으면 그대로 사용 — 새 프로젝트 생성 스킵
  if (url.includes('capcut.com/editor')) {
    console.log(`[1] 이미 에디터 열림 — 재사용: ${url}`)
    return page
  }

  // 캐시된 프로젝트 URL이 있으면 그 URL로 이동 — 새 프로젝트 생성 스킵
  if (urlCache && fs.existsSync(urlCache)) {
    const cachedUrl = fs.readFileSync(urlCache, 'utf-8').trim()
    if (cachedUrl) {
      console.log(`[1] 캐시된 프로젝트 URL 발견 — 이동: ${cachedUrl}`)
      try {
        await page.goto(cachedUrl, { waitUntil: 'networkidle2', timeout: CONFIG.navTimeout })
        if (page.url().includes('capcut.com/editor')) {
          console.log(`[1] 캐시 URL로 에디터 재사용: ${page.url()}`)
          return page
        }
        console.warn('[1] ⚠ 캐시 URL 이동 후 에디터가 아님 — 새 프로젝트 생성으로 진행')
      } catch (e) {
        console.warn(`[1] ⚠ 캐시 URL 이동 실패 (${e.message}) — 새 프로젝트 생성으로 진행`)
      }
    }
  }

  if (url.includes('capcut.com/recent-list')) {
    console.log(`[1] capcut.com/recent-list 이미 열림`)
    await sleep(2000)
    return null
  }
  console.log('[1] capcut.com/recent-list 이동...')
  await page.goto(CONFIG.capcutRecent, { waitUntil: 'networkidle2', timeout: CONFIG.navTimeout })
  const cur = page.url()
  if (cur.includes('login') || cur.includes('signin')) {
    throw new Error('capcut.com 로그인이 필요합니다. Chrome에서 수동으로 로그인 후 다시 실행하세요.')
  }
  console.log(`[1] capcut.com 접속 완료: ${cur}`)
  await sleep(3000)
  return null
}

// ── STEP 2: 새로 만들기 → 9:16 선택 (새 탭 오픈) ──────────────────────
// browser 파라미터 추가 — 새 탭을 감지하기 위해 필요
// 반환값: 에디터가 열린 page 객체 (새 탭 또는 기존 탭)
async function step2_createProject(page, browser) {
  console.log('[2] 새로 만들기 버튼 찾는 중...')
  await sleep(2000)

  // CapCut 실제 DOM에서 확인된 클래스: createNewButton-ZpdJYk
  const createBtn = await findFirst(page, [
    '[class*="createNewButton"]',
    '[class*="create-new-button"]',
    '[class*="new-project"]',
    '[data-testid="create-project-btn"]',
  ]) || await findFirstXP(page, [
    '//button[contains(., "Create new")]',
    '//button[contains(., "새로 만들기")]',
    '//button[contains(., "새 프로젝트")]',
    '//*[@role="button" and contains(., "Create new")]',
  ])

  if (!createBtn) {
    throw new Error('"새로 만들기" 버튼을 찾을 수 없습니다. capcut.com/recent-list 로그인 상태를 확인하세요.')
  }

  console.log('[2] 새로 만들기 클릭 → 드롭다운 열기')
  await createBtn.click()
  await sleep(1500)

  // 드롭다운에서 9:16 선택 — 클릭 시 NEW TAB으로 에디터 오픈
  const btn916 = await findFirst(page, [
    '[data-value="9:16"]',
    '[aria-label*="9:16"]',
  ]) || await findFirstXP(page, [
    '//button[contains(., "9:16")]',
    '//*[@role="menuitem" and contains(., "9:16")]',
    '//*[@role="option" and contains(., "9:16")]',
    '//*[normalize-space(text())="9:16"]',
    '//*[contains(@class, "ratio") and contains(., "9:16")]',
  ])

  if (!btn916) {
    throw new Error('9:16 비율 옵션을 찾을 수 없습니다. 드롭다운이 열렸는지 확인하세요.')
  }

  // 클릭 전 현재 탭 스냅샷 (새 탭 감지용)
  const pagesBefore = await browser.pages()
  const urlsBefore  = new Set(pagesBefore.map(p => p.url()))

  console.log('[2] 9:16 클릭 → 에디터 탭 오픈 대기...')
  await btn916.click()

  // 새 탭 감지 (최대 15초 폴링)
  let editorPage = null
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    const pagesNow = await browser.pages()
    const newPages = pagesNow.filter(p => !urlsBefore.has(p.url()) && p.url() !== 'about:blank')
    if (newPages.length > 0) {
      editorPage = newPages[0]
      console.log(`[2] 새 탭 감지: ${editorPage.url()}`)
      break
    }
    // about:blank인 새 탭 확인 (URL 변경 전)
    const blankPages = pagesNow.filter(p => !pagesBefore.includes(p))
    if (blankPages.length > 0) {
      editorPage = blankPages[0]
      console.log('[2] 새 탭 (about:blank) 감지, URL 로딩 대기...')
      break
    }
  }

  if (!editorPage) {
    // 새 탭이 없으면 현재 탭이 에디터로 이동했는지 확인
    await sleep(3000)
    if (page.url().includes('editor')) {
      console.log('[2] 현재 탭이 에디터로 이동됨')
      return page
    }
    throw new Error('에디터 탭이 열리지 않았습니다. 9:16 클릭 후 새 탭 또는 URL 변경이 없었습니다.')
  }

  // 에디터 URL 로딩 대기
  try {
    await editorPage.waitForFunction(
      () => window.location.href.includes('editor') || window.location.href.includes('capcut.com'),
      { timeout: 30000 }
    )
  } catch {}
  await sleep(5000) // 에디터 초기 UI 렌더링 대기

  const editorUrl = editorPage.url()
  console.log(`[2] 에디터 준비됨: ${editorUrl}`)
  return editorPage
}

// ── STEP 3: 에디터 로딩 확인 ──────────────────────────────────────────
// step2에서 9:16로 이미 비율 설정 — 별도 다이얼로그 없음
async function step3_confirmEditor(page) {
  console.log('[3] 에디터 로딩 확인 중...')
  // 업로드 버튼 또는 타임라인이 나타날 때까지 대기
  await page.waitForFunction(
    () =>
      !!document.querySelector('button[class*="upload"], [class*="upload-btn"], [class*="uploadBtn"]') ||
      !!document.querySelector('[class*="timeline"], [class*="track"]'),
    { timeout: 30000 }
  ).catch(() => console.warn('[3] ⚠ 에디터 UI 감지 타임아웃 — 계속 진행'))
  await sleep(2000)
  console.log(`[3] 에디터 URL: ${page.url()}`)
}

// ── STEP 4: ep{N}_raw.mp4 업로드 ─────────────────────────────────────
async function step4_uploadVideo(page, videoPath) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`영상 파일 없음: ${videoPath}`)
  }
  const mb = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(1)
  console.log(`[4] 영상 업로드: ${path.basename(videoPath)} (${mb} MB)`)

  // 방법 A: 실제 DOM에서 확인된 숨겨진 video file input 직접 사용
  const videoInput = await page.$('input[type="file"][accept*="mp4"]') ||
                     await page.$('input[type="file"][accept*="video"]')
  if (videoInput) {
    console.log('[4] input[accept*="mp4"] 직접 uploadFile 시도')
    try {
      await videoInput.uploadFile(videoPath)
      console.log('[4] uploadFile 성공')
      await sleep(3000)
      // 업로드 진행 완료 대기
      await page.waitForFunction(
        () => !document.querySelector('[class*="progress"]:not([style*="display: none"]), [class*="uploading"]'),
        { timeout: CONFIG.uploadTimeout }
      ).catch(() => console.warn('[4] ⚠ 업로드 완료 감지 타임아웃'))
      await sleep(2000)
      console.log('[4] 업로드 완료')
      return
    } catch (e) {
      console.log(`[4] uploadFile 실패 (${e.message}) — Upload 버튼 방식 시도`)
    }
  }

  // 방법 B: 실제 DOM에서 확인된 Upload 버튼 클릭 → filechooser
  // 실제 클래스: "lv-btn lv-btn-secondary lv-btn-size-default lv-btn-shape-square upload"
  const uploadBtn = await findFirst(page, [
    'button[class*=" upload"]',
    'button[class*="upload"]',
    '[class*="upload-btn"]',
    '[class*="uploadBtn"]',
    '[aria-label*="Upload"]',
    '[aria-label*="업로드"]',
  ]) || await findFirstXP(page, [
    '//button[normalize-space(.)="Upload"]',
    '//button[contains(., "업로드")]',
    '//button[contains(., "Import")]',
    '//*[@role="button" and normalize-space(.)="Upload"]',
  ])

  if (!uploadBtn) {
    throw new Error('업로드 버튼을 찾을 수 없습니다. 에디터가 완전히 로딩되었는지 확인하세요.')
  }

  console.log('[4] Upload 버튼 클릭 → filechooser')
  await pickFile(page, () => uploadBtn.click(), [videoPath], CONFIG.uploadTimeout)

  console.log('[4] 업로드 진행 중...')
  await sleep(5000)
  await page.waitForFunction(
    () => !document.querySelector('[class*="progress"]:not([style*="display: none"]), [class*="uploading"]'),
    { timeout: CONFIG.uploadTimeout }
  ).catch(() => console.warn('[4] ⚠ 업로드 완료 감지 타임아웃'))
  await sleep(3000)
  console.log('[4] 업로드 완료')
}

// ── STEP 4b: "자료 리소스" 업로드 확인 팝업 처리 ──────────────────────
async function step4b_handleResourcePopup(page) {
  console.log('[4b] 자료 리소스 팝업 확인 중...')
  await sleep(1000)

  const hasPopupText = await page.evaluate(() => document.body.innerText.includes('자료 리소스'))
  const nextBtn = await findFirstXP(page, [
    '//button[contains(., "다음")]',
    '//*[@role="button" and contains(., "다음")]',
  ])

  if (!hasPopupText && !nextBtn) {
    console.log('[4b] 팝업 없음 — 진행')
    return
  }

  if (nextBtn) {
    console.log('[4b] "자료 리소스" 팝업 감지 — "다음" 버튼 클릭')
    await nextBtn.click()
    await sleep(1500)
  } else {
    console.warn('[4b] "자료 리소스" 텍스트는 감지됐지만 "다음" 버튼을 찾지 못함')
  }
}

// ── STEP 5: 타임라인에 영상 추가 ─────────────────────────────────────
// 실제 DOM 조사 결과 (2026-07-02): 업로드 시 자동으로 타임라인에 추가되는
// 경우가 있어 ".badge-added"로 먼저 확인. 아니면 "타임라인에 추가" 버튼 →
// 미디어 카드(.card-item) 더블클릭 → 카드를 타임라인(.timeline-drop)으로
// 드래그 순으로 시도.
async function step5_addToTimeline(page) {
  console.log('[5] 영상을 타임라인에 추가 중...')
  await sleep(1500)

  // 업로드 시 이미 자동으로 타임라인에 추가된 경우
  const alreadyAdded = await page.$('[class*="badge-added"]')
  if (alreadyAdded) {
    console.log('[5] 이미 타임라인에 추가됨 (업로드 시 자동 반영) — 건너뜀')
    return
  }

  // 방법 A: "타임라인에 추가" 텍스트를 가진 버튼
  const addBtn = await findFirstXP(page, [
    '//button[contains(., "타임라인에 추가")]',
    '//button[contains(., "Add to timeline")]',
    '//*[@role="button" and contains(., "타임라인에 추가")]',
    '//button[@aria-label="Add to timeline"]',
  ])
  if (addBtn) {
    console.log('[5] "타임라인에 추가" 버튼 클릭')
    await addBtn.click()
    await sleep(2000)
    return
  }

  // 방법 B: 미디어 패널의 첫 번째 카드(.card-item) 더블클릭
  const card = await findFirst(page, [
    '[class*="card-item"]:first-child',
    '[class*="card-item"]',
  ])
  if (card) {
    console.log('[5] 미디어 카드 더블클릭으로 타임라인 추가')
    await card.dblclick()
    await sleep(2000)
    if (await page.$('[class*="badge-added"]')) {
      console.log('[5] 타임라인 추가 확인됨')
      return
    }

    // 방법 C: 카드를 타임라인 드롭 영역(.timeline-drop)으로 드래그
    const timelineDrop = await findFirst(page, ['[class*="timeline-drop"]'])
    const cardBox = await card.boundingBox()
    const dropBox = timelineDrop ? await timelineDrop.boundingBox() : null
    if (cardBox && dropBox) {
      console.log('[5] 미디어 카드를 타임라인으로 드래그')
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
      await page.mouse.down()
      await sleep(200)
      await page.mouse.move(dropBox.x + 50, dropBox.y + dropBox.height / 2, { steps: 15 })
      await sleep(200)
      await page.mouse.up()
      await sleep(2000)
      return
    }
  }

  console.warn('[5] ⚠ 타임라인 추가 방법을 찾지 못함 — 수동 추가가 필요할 수 있습니다')
}

// ── STEP 6: 켄번스 효과 적용 (ops 있을 때만) ─────────────────────────
async function step6_kenBurns(page, specOps) {
  const kbOps = specOps.filter(o => o.op === 'keyframe')
  if (kbOps.length === 0) {
    console.log('[6] 켄번스 ops 없음 — 건너뜀')
    return
  }
  console.log(`[6] 켄번스 효과 적용 시도 (ops: ${kbOps.length}개)...`)

  const clip = await findFirst(page, [
    '[class*="timeline-clip"]:first-child',
    '[class*="video-segment"]:first-child',
    '[class*="track-item"]:first-child',
    '[class*="trackItem"]:first-child',
  ])
  if (clip) { await clip.click(); await sleep(1000) }

  const motionPanel = await findFirst(page, [
    '[data-testid="motion-tab"]',
    '[data-testid="animation-tab"]',
    '[aria-label*="Motion"]',
    '[aria-label*="Animation"]',
    '[aria-label*="움직임"]',
  ]) || await findFirstXP(page, [
    '//*[@role="tab" and (contains(., "Motion") or contains(., "Animation") or contains(., "모션") or contains(., "애니메이션"))]',
    '//button[contains(., "모션") or contains(., "Motion")]',
  ])

  if (!motionPanel) {
    console.warn('[6] ⚠ Motion/Animation 패널 미발견 — 켄번스 건너뜀')
    return
  }
  await motionPanel.click()
  await sleep(1500)

  const zoomPreset = await findFirstXP(page, [
    '//*[contains(text(), "Zoom in") or contains(text(), "줌인") or contains(text(), "Ken Burns")]',
    '//*[@aria-label*="Zoom in"]',
    '//*[contains(@class, "zoom-in") or contains(@class, "zoomIn")]',
  ])
  if (zoomPreset) {
    await zoomPreset.click()
    console.log('[6] 켄번스(줌인) 프리셋 적용')
  } else {
    console.warn('[6] ⚠ 줌인 프리셋 미발견')
  }
  await sleep(1000)
}

// ── STEP 7: SRT 자막 삽입 ─────────────────────────────────────────────
// 실제 DOM 조사 결과 (2026-07-02): 좌측 사이드바 "캡션" 탭(.siderMenuCaption-menu)
// 안에 SRT 전용 hidden input(accept=".srt,.ass,.lrc")이 있어 버튼 클릭 없이
// uploadFile()로 바로 업로드 가능.
async function step7_insertSubtitles(page, srtPath) {
  if (!fs.existsSync(srtPath)) {
    console.log(`[7] SRT 파일 없음: ${srtPath} — 건너뜀`)
    return
  }
  console.log(`[7] SRT 자막 삽입: ${path.basename(srtPath)}`)

  const captionTab = await page.$('.siderMenuCaption-menu') || await findFirstXP(page, [
    '//*[@role="menuitem" and (contains(., "캡션") or contains(., "Captions"))]',
  ])
  if (!captionTab) {
    console.warn('[7] ⚠ 캡션 탭 미발견 — 자막 건너뜀')
    return
  }
  await captionTab.click()
  await sleep(1500)

  const srtInput = await page.$('input[type="file"][accept*=".srt"]')
  if (!srtInput) {
    console.warn('[7] ⚠ SRT 업로드 input 미발견 — 자막 건너뜀')
    return
  }

  console.log('[7] SRT 파일 업로드')
  await srtInput.uploadFile(srtPath)
  await sleep(3000)
  console.log('[7] SRT 자막 삽입 완료')
}

// ── STEP 8: BGM 업로드 + 삽입 ────────────────────────────────────────
async function step8_bgm(page, bgmPath) {
  if (!bgmPath || !fs.existsSync(bgmPath)) {
    console.log('[8] BGM 파일 없음 — 건너뜀')
    return
  }
  console.log(`[8] BGM 업로드: ${path.basename(bgmPath)}`)

  const audioTab = await findFirst(page, [
    '[data-testid="audio-tab"]',
    '[data-testid="music-tab"]',
    '[aria-label="Audio"]',
    '[aria-label="오디오"]',
    '[aria-label="Music"]',
  ]) || await findFirstXP(page, [
    '//*[@role="tab" and (contains(., "Audio") or contains(., "오디오") or contains(., "Music"))]',
    '//button[contains(., "오디오") or contains(., "Audio") or contains(., "Music")]',
  ])

  if (!audioTab) {
    console.warn('[8] ⚠ Audio 탭 미발견 — BGM 건너뜀')
    return
  }
  await audioTab.click()
  await sleep(2000)

  // audio/mp3 를 받는 file input 직접 시도
  const audioInput = await page.$('input[type="file"][accept*="audio"]') ||
                     await page.$('input[type="file"][accept*="mp3"]')
  if (audioInput) {
    console.log('[8] audio file input 직접 사용')
    try {
      await audioInput.uploadFile(bgmPath)
      await sleep(3000)
      console.log('[8] BGM 업로드 완료')
      // 업로드된 BGM 더블클릭으로 타임라인에 추가
      const audioClip = await findFirst(page, [
        '[class*="audio-item"]:first-child',
        '[class*="music-item"]:first-child',
        '[class*="local-item"]:first-child',
        '[class*="local-music-item"]:first-child',
      ])
      if (audioClip) { await audioClip.dblclick(); console.log('[8] BGM 타임라인 추가') }
      return
    } catch {}
  }

  const uploadAudio = await findFirst(page, [
    '[data-testid="upload-audio"]',
    '[class*="local-music"]',
    '[class*="upload-audio"]',
    '[aria-label*="Upload audio"]',
    '[aria-label*="로컬 음악"]',
  ]) || await findFirstXP(page, [
    '//button[contains(., "로컬 음악") or contains(., "Local music") or contains(., "Upload audio")]',
    '//button[contains(., "파일 업로드") and ancestor::*[contains(@class, "audio")]]',
    '//*[contains(., "로컬 음악") and @role="button"]',
  ])

  if (!uploadAudio) {
    console.warn('[8] ⚠ 오디오 업로드 버튼 미발견 — BGM 건너뜀')
    return
  }

  await pickFile(page, () => uploadAudio.click(), [bgmPath], 30000)
  await sleep(3000)

  const audioClip = await findFirst(page, [
    '[class*="audio-item"]:first-child',
    '[class*="music-item"]:first-child',
    '[class*="local-item"]:first-child',
  ])
  if (audioClip) {
    await audioClip.dblclick()
    console.log('[8] BGM 타임라인 추가 완료')
  } else {
    console.warn('[8] ⚠ 업로드된 오디오 클립 미발견 — 수동 추가 필요')
  }
  await sleep(1500)
}

// ── STEP 9: 색보정 (warm 필터) 적용 ─────────────────────────────────
async function step9_colorCorrection(page, specOps) {
  const filterOp = specOps.find(o => o.op === 'filter')
  if (!filterOp) {
    console.log('[9] 색보정 ops 없음 — 건너뜀')
    return
  }
  console.log(`[9] 색보정 적용: ${filterOp.slug} (intensity: ${filterOp.intensity})`)

  const clip = await findFirst(page, [
    '[class*="timeline-clip"]:first-child',
    '[class*="video-segment"]:first-child',
    '[class*="track-item"]:first-child',
    '[class*="trackItem"]:first-child',
  ])
  if (clip) { await clip.click(); await sleep(1000) }

  const filterTab = await findFirst(page, [
    '[data-testid="filter-tab"]',
    '[data-testid="effects-tab"]',
    '[aria-label="Filter"]',
    '[aria-label="필터"]',
    '[aria-label="Effects"]',
    '[aria-label="효과"]',
  ]) || await findFirstXP(page, [
    '//*[@role="tab" and (contains(., "Filter") or contains(., "필터") or contains(., "Effects") or contains(., "효과"))]',
    '//button[contains(., "필터") or contains(., "Filter")]',
  ])

  if (!filterTab) {
    const adjustBtn = await findFirstXP(page, [
      '//button[contains(., "Adjust") or contains(., "조정") or contains(., "Color")]',
    ])
    if (adjustBtn) {
      await adjustBtn.click()
      await sleep(1000)
    } else {
      console.warn('[9] ⚠ Filter/Effects 탭 미발견 — 색보정 건너뜀')
      return
    }
  } else {
    await filterTab.click()
    await sleep(1500)
  }

  const warmFilter = await findFirstXP(page, [
    '//*[translate(normalize-space(.), "WARM", "warm")="warm" and (@role="button" or contains(@class, "filter"))]',
    '//*[contains(text(), "Warm") or contains(text(), "warm") or contains(text(), "따뜻")]',
    '//*[@aria-label="Warm" or @aria-label="warm" or @title="Warm"]',
  ])

  if (warmFilter) {
    await warmFilter.click()
    console.log('[9] Warm 필터 적용')
    await sleep(1000)

    const slider = await findFirst(page, [
      'input[type="range"]',
      '[class*="slider"]',
      '[role="slider"]',
    ])
    if (slider) {
      const intensity = Math.round((filterOp.intensity || 0.3) * 100)
      await page.evaluate((el, val) => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        nativeInputValueSetter.call(el, val)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, slider, intensity)
      console.log(`[9] 필터 강도: ${intensity}%`)
    }
  } else {
    console.warn('[9] ⚠ Warm 필터 미발견 — 색보정 건너뜀')
  }
  await sleep(1000)
}

// ── STEP 10: 내보내기 ─────────────────────────────────────────────────
// 실제 DOM 조사 결과 (2026-07-02) — 4단계로 구성됨:
//  ① 상단 "내보내기" 버튼(.export-vid) 클릭 → 공유 패널이 열림
//     (프로젝트당 최초 1회, 안내 툴팁(.guide-confirm-button)이 대신 뜨면
//      닫고 "내보내기" 버튼을 다시 클릭해야 공유 패널이 열림)
//  ② 공유 패널의 "다운로드" 행 클릭 → 내보내기 설정 패널이 열림
//  ③ 해상도 드롭다운(.lv-select-view-selector)에서 1080p 선택 후
//     설정 패널의 최종 "내보내기" 버튼(.lv-btn-long) 클릭 → 인코딩 시작
//  ④ 진행률 100%("내보냄" 텍스트) 도달 후 뜨는 최종 "다운로드" 버튼
//     (.downloadButton) 클릭 → 로컬로 실제 파일 다운로드
async function step10_export(page) {
  await page.waitForNetworkIdle({ idleTime: 2000, timeout: 15000 }).catch(() => {})
  await sleep(2000)

  // ① 내보내기 버튼 클릭 → 공유 패널
  console.log('[10] ① 내보내기 버튼 클릭...')
  const locateExportBtn = async () => (await findFirst(page, [
    'button[class*="export-vid"]',
    '[class*="export-vid"]',
    'button[aria-label="내보내기"]',
  ])) || (await findFirstXP(page, [
    '//button[normalize-space(.)="Export"]',
    '//button[contains(., "내보내기")]',
  ]))

  if (!(await robustClick(page, locateExportBtn, '내보내기 버튼'))) {
    throw new Error('내보내기 버튼을 찾을 수 없습니다.')
  }
  await sleep(1500)

  // 최초 1회성 안내 툴팁이 뜨면 닫고 내보내기 버튼을 다시 클릭
  const guideTooltip = await page.$('.guide-confirm-button')
  if (guideTooltip) {
    console.log('[10] 안내 툴팁 감지 — 닫고 재클릭')
    await robustClick(page, () => page.$('.guide-confirm-button'), '안내 툴팁 확인')
    await sleep(500)
    if (!(await robustClick(page, locateExportBtn, '내보내기 버튼(재클릭)'))) {
      throw new Error('안내 툴팁을 닫은 후 내보내기 버튼을 다시 찾을 수 없습니다.')
    }
    await sleep(1500)
  }

  // ② 공유 패널의 "다운로드" 행 클릭 → 내보내기 설정 패널
  console.log('[10] ② "다운로드" 행 클릭...')
  const locateDownloadRow = async () => await findFirstXP(page, [
    '//button[normalize-space(.)="다운로드"]',
  ])
  if (!(await robustClick(page, locateDownloadRow, '다운로드 행'))) {
    throw new Error('공유 패널의 "다운로드" 행을 찾을 수 없습니다.')
  }
  await sleep(1500)

  // ③ 해상도 1080p 선택
  console.log('[10] ③ 해상도 1080p 선택...')
  const selectOpened = await robustClick(page, () => page.$('.lv-select-view-selector'), '해상도 드롭다운')
  if (selectOpened) {
    await sleep(500)
    const locate1080 = async () => await findFirstXP(page, [
      '//li[contains(@class, "material-export-modal-option") and starts-with(normalize-space(.), "1080p")]',
    ])
    if (await robustClick(page, locate1080, '1080p 옵션')) {
      console.log('[10] ③ 1080p 선택 완료')
    } else {
      console.warn('[10] ⚠ 1080p 옵션 미발견 — 기본 해상도로 진행')
    }
  } else {
    console.warn('[10] ⚠ 해상도 드롭다운 미발견 — 기본 해상도로 진행')
  }

  // ③ 설정 패널의 최종 "내보내기" 버튼 클릭 → 인코딩 시작
  const locateFinalExportBtn = async () => await findFirstXP(page, [
    '//button[contains(@class, "lv-btn-long") and normalize-space(.)="내보내기"]',
  ])
  if (!(await robustClick(page, locateFinalExportBtn, '최종 내보내기 버튼'))) {
    throw new Error('내보내기 설정 패널의 최종 내보내기 버튼을 찾을 수 없습니다.')
  }
  console.log('[10] ③ 최종 내보내기 버튼 클릭 완료 — 인코딩 시작')

  // ④ 진행률 100% 대기 후 "다운로드" 팝업의 다운로드 버튼 클릭
  // 팝업 구조: 제목 "다운로드" / 완료 텍스트 "내보냄" 또는
  // "동영상을 장치에 다운로드할 수 있습니다" / 파란색(primary) "다운로드" 버튼
  // (하단에 "데스크톱 앱에서 다운로드" 같은 보조 링크가 별도로 있을 수 있어
  // 텍스트만으로는 모호함 — 알려진 클래스 우선, 없으면 primary 스타일로 판별)
  console.log('[10] ④ 내보내기 완료 대기 중...')
  await page.waitForFunction(
    () => document.body.innerText.includes('내보냄') ||
          document.body.innerText.includes('동영상을 장치에 다운로드할 수 있습니다') ||
          !!document.querySelector('[class*="downloadButton"]'),
    { timeout: CONFIG.exportTimeout }
  ).catch(() => console.warn('[10] ⚠ 내보내기 완료 감지 타임아웃'))
  await sleep(1000)

  const locateFinalDownloadBtn = async () => (await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    // 1순위: 실제 DOM에서 확인된 클래스
    let btn = btns.find(b => b.className.includes('downloadButton'))
    if (btn) return btn
    // 2순위: 텍스트가 "다운로드"인 버튼 중 primary(파란색) 스타일인 것
    //        (하단 "데스크톱 앱에서 다운로드" 보조 링크는 제외)
    btn = btns.find(b => {
      if (b.textContent.trim() !== '다운로드') return false
      if (b.className.includes('primary')) return true
      const bg = getComputedStyle(b).backgroundColor
      return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
    })
    return btn || null
  })).asElement()

  if (await robustClick(page, locateFinalDownloadBtn, '최종 다운로드 버튼')) {
    console.log('[10] ④ 다운로드 버튼 클릭 완료')
  } else {
    console.warn('[10] ⚠ 최종 다운로드 버튼을 찾지 못함 — 수동으로 다운로드하세요')
  }
}

// ── MAIN ─────────────────────────────────────────────────────────────
async function main() {
  const epArg = process.argv.find(a => a.startsWith('--ep='))
  const epNum = epArg ? epArg.replace('--ep=', '').trim() : null

  if (!epNum) {
    console.error('❌ 사용법: node scripts/capcut-web-automation.js --ep=N')
    process.exit(1)
  }

  console.log(`\n🎬 CapCut 웹 자동화 시작 — ep${epNum}\n`)

  // ── 경로 설정 ─────────────────────────────────────────────────────
  const videoPath = path.join(MEDIA_ROOT, 'downloads', 'output',  `ep${epNum}`, `ep${epNum}_raw.mp4`)
  const srtPath   = path.join(MEDIA_ROOT, 'downloads', 'audio',   `ep${epNum}`, `ep${epNum}.srt`)
  const bgmCandidates = [
    path.join(MEDIA_ROOT, 'downloads', 'bgm', 'bgm_default.mp3'),
    path.join(MEDIA_ROOT, 'downloads', 'bgm', 'bgm.mp3'),
  ]
  const bgmPath   = bgmCandidates.find(p => fs.existsSync(p)) || null
  const specPath  = path.join(MEDIA_ROOT, 'downloads', 'capcut_spec.json')
  const destDir   = path.join(MEDIA_ROOT, 'downloads', 'video',   `ep${epNum}`)
  const destFile  = path.join(destDir, `ep${epNum}_final.mp4`)
  const tempDir   = path.join(MEDIA_ROOT, 'downloads', 'temp_capcut')
  const urlCache  = path.join(MEDIA_ROOT, `capcut_web_ep${epNum}_url.txt`)

  fs.mkdirSync(destDir, { recursive: true })
  fs.mkdirSync(tempDir, { recursive: true })

  // capcut_spec.json 로드
  let specOps = []
  if (fs.existsSync(specPath)) {
    try {
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'))
      specOps = Array.isArray(spec.operations) ? spec.operations : []
      console.log(`[spec] operations: ${specOps.length}개`)
    } catch {}
  }

  console.log(`[경로] 영상   : ${videoPath} (${fs.existsSync(videoPath) ? '✅' : '❌ 없음'})`)
  console.log(`[경로] SRT    : ${srtPath} (${fs.existsSync(srtPath) ? '✅' : '없음'})`)
  console.log(`[경로] BGM    : ${bgmPath || '없음'} (${bgmPath ? '✅' : '건너뜀'})`)
  console.log(`[경로] 출력   : ${destFile}\n`)

  // ── Chrome 연결 ───────────────────────────────────────────────────
  console.log(`[Chrome] port ${CONFIG.debuggingPort} 연결 중...`)
  let browser
  try {
    browser = await puppeteer.connect({
      browserURL:      `http://localhost:${CONFIG.debuggingPort}`,
      defaultViewport: null,
    })
  } catch (err) {
    console.error(`❌ Chrome 연결 실패: ${err.message}`)
    console.error(`   → "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${CONFIG.debuggingPort}`)
    process.exit(1)
  }
  console.log('[Chrome] 연결 성공\n')

  // 첫 번째 capcut 탭 (또는 새 탭) 선택
  const allPages = await browser.pages()
  let page = allPages.find(p => p.url().includes('capcut.com')) || await browser.newPage()

  // 다운로드 디렉토리 설정 (CDP) — 초기 탭용
  const setupDownload = async (pg) => {
    const client = await pg.createCDPSession()
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tempDir })
    return client
  }
  await setupDownload(page)

  const beforeFiles = new Set(fs.readdirSync(tempDir).filter(f => /\.(mp4|webm|mov)$/i.test(f)))

  // ── 파이프라인 실행 ───────────────────────────────────────────────
  try {
    let editorPage = await step1_navigate(page, urlCache)

    if (!editorPage) {
      // step2는 browser도 필요, 반환값이 새 에디터 page일 수 있음
      editorPage = await step2_createProject(page, browser)
    } else {
      console.log('[2] 새 프로젝트 생성 건너뜀')
    }
    if (editorPage !== page) {
      page = editorPage
      // 새 탭에도 다운로드 설정 적용
      await setupDownload(page)
    }

    await step3_confirmEditor(page)
    await step4_uploadVideo(page, videoPath)
    await step4b_handleResourcePopup(page)
    await step5_addToTimeline(page)
    await step6_kenBurns(page, specOps)
    await step7_insertSubtitles(page, srtPath)
    await step8_bgm(page, bgmPath)
    await step9_colorCorrection(page, specOps)

    // 에디터 URL 저장 (내보내기 전)
    const editorUrl = page.url()
    if (editorUrl.includes('capcut.com') && editorUrl.length > 40) {
      fs.writeFileSync(urlCache, editorUrl, 'utf-8')
      console.log(`\n[URL 저장] ${urlCache}`)
    }

    await step10_export(page)

    // ── 다운로드 완료 대기 ────────────────────────────────────────
    console.log(`\n[다운로드] 완료 대기 중... (최대 ${CONFIG.exportTimeout / 60000}분)`)
    const downloaded = await waitForDownload(tempDir, beforeFiles, CONFIG.exportTimeout)

    if (fs.existsSync(destFile)) fs.unlinkSync(destFile)
    fs.renameSync(downloaded, destFile)

    const sizeMB = (fs.statSync(destFile).size / 1024 / 1024).toFixed(1)
    console.log(`\n✅ ep${epNum} 완료!`)
    console.log(`   → ${destFile} (${sizeMB} MB)\n`)

  } catch (err) {
    console.error(`\n❌ 오류: ${err.message}\n`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err.message)
  process.exit(1)
})
