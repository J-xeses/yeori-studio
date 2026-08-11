/**
 * capcut-reel-automation.js
 * CapCut 웹버전 범용 릴스 자동화 — 이미지/영상 혼합 지원
 *
 * 기존 capcut-web-automation.js와의 차이:
 *  - 단일 mp4 대신 capcut_spec.json의 items 배열을 순서대로 처리
 *  - 이미지(photo) / 영상(video) 자동 판별 후 업로드
 *  - 컷별 재생시간 설정
 *  - 자막: 교보손글씨 폰트 + typewriter/slide_up/fade_in/popup 애니메이션
 *  - 스티커: query 검색어 기반 자동 삽입 + shake/twinkle/blink/pop 루프
 *  - BGM 컷별 볼륨 키프레임
 *  - 컷 간 dissolve/fade_black 트랜지션
 *
 * 사용법:
 *   node scripts/capcut-reel-automation.js --spec=downloads/capcut_spec_IG_R01.json
 *
 * 전제조건:
 *   Chrome CDP 포트 9222 열려있고 capcut.com 로그인 상태
 *   start_yeori.bat 실행 후 사용 (⚠ /api/run-video와 동시 실행 금지)
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONFIG = {
  debuggingPort:  9222,
  capcutRecent:   'https://www.capcut.com/recent-list',
  navTimeout:     30_000,
  uploadTimeout:  60_000,
  actionDelay:    800,    // UI 조작 사이 기본 딜레이(ms)
  exportTimeout:  300_000,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const xsel  = xpath => `::-p-xpath(${xpath})`

// ── 공통 헬퍼 ────────────────────────────────────────────────────────
async function findFirst(page, selectors) {
  for (const sel of selectors) {
    try { const el = await page.$(sel); if (el) return el } catch {}
  }
  return null
}

async function findFirstXP(page, xpaths) {
  for (const xp of xpaths) {
    try { const el = await page.$(xsel(xp)); if (el) return el } catch {}
  }
  return null
}

async function robustClick(page, locate, label = '', retries = 5) {
  for (let i = 0; i < retries; i++) {
    const el = await locate()
    if (!el) { await sleep(600); continue }
    await page.evaluate(n => n.scrollIntoView({ block: 'center' }), el).catch(() => {})
    await sleep(150)
    try { await el.click(); return true } catch {
      try { await page.evaluate(n => n.click(), el); return true } catch {}
    }
  }
  console.warn(`  ⚠ [${label}] 클릭 실패`)
  return false
}

async function pickFile(page, triggerFn, filePaths, timeoutMs = 60_000) {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('파일 선택 타임아웃')), timeoutMs)
    page.once('filechooser', async chooser => {
      clearTimeout(timer)
      try { await chooser.accept(filePaths); resolve() } catch (e) { reject(e) }
    })
    await triggerFn()
  })
}

// 프로모션 모달(업그레이드 유도 등)이 열려 있으면 사이드바 클릭을 가로채므로 먼저 닫는다
async function dismissPromoModals(page) {
  const closeBtns = await page.$$('.lv-modal-close-icon, [aria-label="Close"]').catch(() => [])
  for (const btn of closeBtns) {
    try { await btn.click(); await sleep(300) } catch {}
  }
}

// CapCut의 "장치에서 업로드"는 브라우저 <input type=file>이 아니라 진짜 Windows 네이티브
// 파일 대화상자를 띄운다 — Puppeteer의 filechooser 이벤트로 감지 불가(실측 확인, 스택된
// 대화상자가 이후 클릭까지 다 막아버림). win-file-dialog-helper.ps1로 그 대화상자를 직접
// 찾아서 파일명 입력창에 경로를 써넣고 Enter를 보낸다.
function selectFilesViaNativeDialog(filePaths, timeoutMs = CONFIG.uploadTimeout) {
  const helperPath = path.join(__dirname, 'win-file-dialog-helper.ps1')
  const pathsJsonB64 = Buffer.from(JSON.stringify(filePaths), 'utf-8').toString('base64')
  const result = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', helperPath,
    '-PathsJsonB64', pathsJsonB64,
    '-TimeoutMs', String(timeoutMs),
  ], { encoding: 'utf-8' }).trim()
  if (result !== 'OK') throw new Error(`네이티브 파일 대화상자 처리 실패: ${result}`)
}

// ── STEP 1: capcut.com 접속 / 에디터 확인 ─────────────────────────────
async function step1_navigate(page) {
  const url = page.url()
  if (url.includes('capcut.com/editor')) {
    console.log('[1] 에디터 이미 열림 — 재사용')
    return
  }
  console.log('[1] capcut.com/recent-list 이동...')
  await page.goto(CONFIG.capcutRecent, { waitUntil: 'networkidle2', timeout: CONFIG.navTimeout })
  if (page.url().includes('login')) throw new Error('capcut.com 로그인 필요')
  await sleep(2000)
}

// ── STEP 2: 새 프로젝트 생성 (9:16) ──────────────────────────────────
async function step2_createProject(page, browser) {
  console.log('[2] 새 프로젝트(9:16) 생성...')
  await sleep(1500)
  await dismissPromoModals(page)

  const createBtn = await findFirst(page, ['[class*="createNewButton"]']) ||
    await findFirstXP(page, [
      '//button[contains(., "Create new")]',
      '//button[contains(., "새로 만들기")]',
    ])
  if (!createBtn) throw new Error('"새로 만들기" 버튼 없음')
  await createBtn.click()

  const locateBtn916 = () => findFirstXP(page, [
    '//button[contains(., "9:16")]',
    '//*[normalize-space(text())="9:16"]',
  ])

  // handle을 미리 캐싱하지 않고 매 재시도마다 다시 찾아서 클릭 — 패널 리렌더링으로
  // handle이 detach되는 레이스 컨디션(실측 확인: "Node is detached from document")을 피한다
  const clicked = await robustClick(page, locateBtn916, '9:16 옵션', 8)
  if (!clicked) throw new Error('9:16 옵션 클릭 실패')

  // 새 탭이 열리는지 같은 탭에서 SPA 네비게이션되는지 CapCut 쪽 동작이 일정하지 않아
  // (targetcreated 단발 이벤트가 엉뚱한 target을 먼저 잡아 null을 반환하는 것도 실측됨),
  // 두 경우 모두 대비해 에디터 URL이 뜬 페이지가 나올 때까지 직접 폴링한다
  const newPage = await (async () => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const pages = await browser.pages()
      const editorPage = pages.find(p => p.url().includes('capcut.com/editor'))
      if (editorPage) return editorPage
      await sleep(500)
    }
    return null
  })()
  if (!newPage) throw new Error('에디터 페이지를 찾지 못함 (새 프로젝트 생성 실패로 추정)')
  await newPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: CONFIG.navTimeout }).catch(() => {})
  await sleep(3000)
  console.log('[2] 에디터 오픈 완료')
  return newPage
}

// ── STEP 3: 에디터 로딩 확인 ─────────────────────────────────────────
async function step3_confirmEditor(page) {
  console.log('[3] 에디터 로딩 확인...')
  await page.waitForFunction(
    () => document.querySelector('[class*="timeline"]') ||
          document.querySelector('[class*="editor"]') ||
          document.querySelector('[class*="workspace"]'),
    { timeout: 20000 }
  ).catch(() => console.warn('  ⚠ 에디터 요소 미감지 — 계속 진행'))
  await sleep(2000)
  console.log('[3] 에디터 준비 완료')
}

// ── STEP 4: 미디어 업로드 (이미지/영상 혼합) ──────────────────────────
async function step4_uploadMedia(page, items) {
  console.log(`[4] 미디어 ${items.length}개 업로드 시작...`)

  // 유효한 파일만 필터
  const validPaths = items
    .map(item => item.path)
    .filter(p => {
      if (!fs.existsSync(p)) { console.warn(`  ⚠ 파일 없음: ${p}`); return false }
      return true
    })

  if (validPaths.length === 0) throw new Error('업로드할 파일 없음')

  // "업로드" 카드 클릭 → 드롭다운에서 "장치에서 업로드" 클릭 (2단계 메뉴, 실측 확인)
  const uploadCard = await findFirstXP(page, [
    '//button[contains(@class,"asset-import-card")]',
    '//button[contains(@class,"asset-import") and contains(., "업로드")]',
    '//button[contains(@class,"asset-import") and contains(., "Upload")]',
  ])
  if (!uploadCard) throw new Error('업로드 버튼 없음')
  await uploadCard.click()
  await sleep(700)

  const deviceClicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button[role="menuitem"]')
    for (const b of btns) {
      const t = b.textContent.trim()
      if (t.includes('장치에서 업로드') || t.includes('Upload from device')) { b.click(); return true }
    }
    return false
  })
  if (!deviceClicked) throw new Error('"장치에서 업로드" 메뉴 항목 없음')

  selectFilesViaNativeDialog(validPaths)
  console.log(`  ✅ ${validPaths.length}개 파일 업로드 요청`)
  await sleep(3000)

  // 업로드 완료 대기
  await page.waitForFunction(
    () => !document.querySelector('[class*="uploading"]') &&
          !document.querySelector('[class*="upload-progress"]'),
    { timeout: CONFIG.uploadTimeout }
  ).catch(() => console.warn('  ⚠ 업로드 완료 감지 타임아웃 — 계속 진행'))
  await sleep(2000)
  console.log('[4] 업로드 완료')
}

// ── STEP 5: 타임라인에 순서대로 추가 + 재생시간 설정 ─────────────────
async function step5_addToTimeline(page, items) {
  console.log('[5] 타임라인 구성...')

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const fname = path.basename(item.path)
    console.log(`  [5-${i+1}] ${fname} (${item.type}, ${item.duration ?? 'auto'}s)`)

    // 미디어 패널에서 파일 더블클릭 → 타임라인 추가
    const mediaThumb = await findFirstXP(page, [
      `//div[contains(@class,"media") and contains(., "${fname.replace(/\.[^.]+$/, '')}")]`,
      `//div[@title="${fname}"]`,
      `//img[@alt="${fname}"]`,
    ])

    if (mediaThumb) {
      await mediaThumb.click()
      await sleep(400)
      // "+" 버튼 또는 더블클릭으로 타임라인 추가
      const addBtn = await findFirstXP(page, [
        '//button[@aria-label="Add to timeline"]',
        '//button[contains(@class,"addToTimeline")]',
      ])
      if (addBtn) {
        await addBtn.click()
      } else {
        await mediaThumb.click({ clickCount: 2 })
      }
    } else {
      // 파일명 감지 실패 — 미디어 패널 첫 항목 사용 (순서 기반)
      console.warn(`  ⚠ ${fname} 썸네일 미감지 — 순서 기반 추가 시도`)
      const allThumbs = await page.$$('[class*="mediaItem"],[class*="media-item"]')
      if (allThumbs[i]) {
        await allThumbs[i].click({ clickCount: 2 })
      }
    }
    await sleep(CONFIG.actionDelay)

    // 이미지(photo) 컷 재생시간 설정
    if (item.type === 'photo' && item.duration) {
      await setPhotoDuration(page, item.duration)
    }
  }
  console.log('[5] 타임라인 구성 완료')
}

async function setPhotoDuration(page, durationSec) {
  // 타임라인에서 클립 선택 후 재생시간 입력
  const durationInput = await findFirst(page, [
    '[class*="durationInput"]',
    'input[class*="duration"]',
  ]) || await findFirstXP(page, [
    '//input[@placeholder="재생 시간"]',
    '//input[contains(@class,"duration")]',
  ])

  if (durationInput) {
    await durationInput.triple_click?.() || await durationInput.click({ clickCount: 3 })
    await durationInput.type(String(durationSec), { delay: 50 })
    await page.keyboard.press('Enter')
    await sleep(400)
    console.log(`    ⏱ 재생시간 ${durationSec}s 설정`)
  }
}

// ── STEP 6: 컷별 자막 삽입 ───────────────────────────────────────────
async function step6_captions(page, items) {
  console.log('[6] 자막 삽입...')
  let totalCaptions = items.reduce((s, it) => s + (it.captions?.length || 0), 0)
  if (totalCaptions === 0) { console.log('  자막 없음 — 건너뜀'); return }

  // 텍스트 탭 클릭
  const textTab = await findFirst(page, ['[class*="textTab"]', '[aria-label="Text"]']) ||
    await findFirstXP(page, [
      '//div[@role="tab" and contains(., "Text")]',
      '//div[@role="tab" and contains(., "텍스트")]',
      '//button[contains(., "텍스트")]',
    ])
  if (textTab) { await textTab.click(); await sleep(1000) }

  let globalTime = 0
  for (const item of items) {
    if (!item.captions?.length) { globalTime += item.duration ?? 0; continue }

    for (const cap of item.captions) {
      const insertTime = globalTime + (cap.start_offset ?? 0)
      console.log(`  자막: "${cap.text.replace(/\n/g, ' ')}" @ ${insertTime.toFixed(1)}s`)

      // 타임라인 해당 시점으로 이동
      await seekTimeline(page, insertTime)
      await sleep(500)

      // 텍스트 추가 버튼
      const addTextBtn = await findFirst(page, ['[class*="addText"]']) ||
        await findFirstXP(page, [
          '//button[contains(., "텍스트 추가")]',
          '//button[contains(., "Add Text")]',
          '//button[contains(., "기본 텍스트")]',
        ])
      if (addTextBtn) { await addTextBtn.click(); await sleep(800) }

      // 텍스트 입력
      const textArea = await findFirst(page, [
        'textarea[class*="textEdit"]',
        '[contenteditable="true"][class*="text"]',
        'textarea',
      ])
      if (textArea) {
        await textArea.click({ clickCount: 3 })
        await textArea.type(cap.text, { delay: 30 })
        await sleep(400)
      }

      // 폰트 설정: 교보손글씨
      await setFont(page, cap.font ?? '교보손글씨')
      await sleep(300)

      // 색상: 흰색
      await setTextColor(page, cap.color ?? '#FFFFFF')
      await sleep(300)

      // 크기
      await setFontSize(page, cap.size ?? 52)
      await sleep(300)

      // 아웃라인 (가독성)
      if (cap.outline) {
        await setTextOutline(page, cap.outline_color ?? '#000000')
        await sleep(300)
      }

      // 애니메이션
      await setTextAnimation(page, cap.animation ?? 'fade_in')
      await sleep(500)

      // ESC로 텍스트 편집 완료
      await page.keyboard.press('Escape')
      await sleep(600)
    }
    globalTime += item.duration ?? 0
  }
  console.log('[6] 자막 삽입 완료')
}

async function seekTimeline(page, timeSec) {
  // 타임라인 눈금자 클릭으로 시점 이동
  const ruler = await findFirst(page, ['[class*="timelineRuler"]', '[class*="ruler"]'])
  if (!ruler) return
  const box = await ruler.boundingBox()
  if (!box) return
  // 전체 길이 추정 (38초 기준) — spec 총 길이로 보정 가능
  const totalSec = 38
  const ratio = timeSec / totalSec
  const x = box.x + box.width * Math.min(ratio, 0.98)
  await page.mouse.click(x, box.y + box.height / 2)
  await sleep(200)
}

async function setFont(page, fontName) {
  const fontSelector = await findFirst(page, ['[class*="fontSelector"]', '[class*="font-family"]'])
  if (!fontSelector) return
  await fontSelector.click()
  await sleep(500)
  const searchInput = await findFirst(page, ['input[class*="fontSearch"]', 'input[placeholder*="폰트"]'])
  if (searchInput) {
    await searchInput.type(fontName, { delay: 50 })
    await sleep(800)
    const fontItem = await findFirstXP(page, [`//*[contains(., "${fontName}")][@role="option" or contains(@class,"fontItem")]`])
    if (fontItem) await fontItem.click()
  }
  await sleep(300)
}

async function setTextColor(page, hexColor) {
  const colorBtn = await findFirst(page, ['[class*="colorPicker"]', '[aria-label="Font color"]'])
  if (!colorBtn) return
  await colorBtn.click()
  await sleep(400)
  const hexInput = await findFirst(page, ['input[class*="hexInput"]', 'input[placeholder="#"]'])
  if (hexInput) {
    await hexInput.click({ clickCount: 3 })
    await hexInput.type(hexColor.replace('#', ''), { delay: 50 })
    await page.keyboard.press('Enter')
  }
  await page.keyboard.press('Escape')
  await sleep(300)
}

async function setFontSize(page, size) {
  const sizeInput = await findFirst(page, ['input[class*="fontSize"]', '[aria-label="Font size"]'])
  if (!sizeInput) return
  await sizeInput.click({ clickCount: 3 })
  await sizeInput.type(String(size), { delay: 50 })
  await page.keyboard.press('Enter')
  await sleep(200)
}

async function setTextOutline(page, color) {
  const outlineBtn = await findFirstXP(page, [
    '//button[contains(., "외곽선")]',
    '//button[contains(., "Stroke")]',
    '//button[contains(., "Outline")]',
  ])
  if (!outlineBtn) return
  await outlineBtn.click()
  await sleep(300)
  await setTextColor(page, color)
}

// 애니메이션 매핑
const ANIMATION_MAP = {
  typewriter: '타자',
  slide_up:   '아래에서 올라오기',
  fade_in:    '페이드인',
  popup:      '팝업',
  none:       null,
}

async function setTextAnimation(page, animKey) {
  const animName = ANIMATION_MAP[animKey]
  if (!animName) return

  const animTab = await findFirstXP(page, [
    '//div[@role="tab" and contains(., "애니메이션")]',
    '//div[@role="tab" and contains(., "Animation")]',
    '//button[contains(., "애니메이션")]',
  ])
  if (!animTab) return
  await animTab.click()
  await sleep(500)

  const animItem = await findFirstXP(page, [
    `//*[contains(., "${animName}") and (@role="button" or contains(@class,"animItem"))]`,
  ])
  if (animItem) { await animItem.click(); await sleep(300) }
}

// ── STEP 7: 스티커 삽입 ──────────────────────────────────────────────
async function step7_stickers(page, items) {
  console.log('[7] 스티커 삽입...')
  let total = items.reduce((s, it) => s + (it.stickers?.length || 0), 0)
  if (total === 0) { console.log('  스티커 없음 — 건너뜀'); return }

  // 스티커 탭 클릭
  const stickerTab = await findFirst(page, ['[class*="stickerTab"]']) ||
    await findFirstXP(page, [
      '//div[@role="tab" and contains(., "스티커")]',
      '//div[@role="tab" and contains(., "Sticker")]',
      '//button[contains(., "스티커")]',
    ])
  if (stickerTab) { await stickerTab.click(); await sleep(1000) }

  let globalTime = 0
  for (const item of items) {
    if (!item.stickers?.length) { globalTime += item.duration ?? 0; continue }

    for (const sticker of item.stickers) {
      const insertTime = globalTime + (sticker.start_offset ?? 0)
      console.log(`  스티커: "${sticker.query}" @ ${insertTime.toFixed(1)}s`)

      await seekTimeline(page, insertTime)
      await sleep(400)

      // 검색
      const searchInput = await findFirst(page, [
        'input[class*="stickerSearch"]',
        'input[placeholder*="스티커"]',
        'input[placeholder*="Search"]',
      ])
      if (searchInput) {
        await searchInput.click({ clickCount: 3 })
        await searchInput.type(sticker.query, { delay: 50 })
        await page.keyboard.press('Enter')
        await sleep(1200)
      }

      // 첫 번째 결과 더블클릭
      const firstResult = await findFirst(page, [
        '[class*="stickerItem"]:first-child',
        '[class*="sticker-item"]:first-child',
      ]) || await page.$('[class*="stickerItem"]')
      if (firstResult) {
        await firstResult.click({ clickCount: 2 })
        await sleep(600)
      }

      // 루프 애니메이션 설정
      await setStickerAnimation(page, sticker.animation)
      await sleep(400)

      // 위치 조정
      await setStickerPosition(page, sticker.position)
      await sleep(300)

      await page.keyboard.press('Escape')
      await sleep(500)
    }
    globalTime += item.duration ?? 0
  }
  console.log('[7] 스티커 삽입 완료')
}

const LOOP_ANIM_MAP = {
  shake:   '흔들기',
  twinkle: '반짝임',
  blink:   '깜빡이기',
  pop:     '팝',
}

async function setStickerAnimation(page, animKey) {
  if (!animKey || !LOOP_ANIM_MAP[animKey]) return
  const animName = LOOP_ANIM_MAP[animKey]

  const loopTab = await findFirstXP(page, [
    '//div[contains(., "루프")][@role="tab"]',
    '//button[contains(., "루프")]',
    '//div[contains(., "Loop")][@role="tab"]',
  ])
  if (!loopTab) return
  await loopTab.click()
  await sleep(400)

  const animItem = await findFirstXP(page, [
    `//*[contains(., "${animName}") and (@role="button" or contains(@class,"animItem"))]`,
  ])
  if (animItem) await animItem.click()
  await sleep(300)
}

const POSITION_MAP = {
  top_right:     { x: 0.78, y: 0.15 },
  top_left:      { x: 0.22, y: 0.15 },
  caption_right: { x: 0.82, y: 0.82 },
  caption_left:  { x: 0.18, y: 0.82 },
  bottom_center: { x: 0.50, y: 0.87 },
}

async function setStickerPosition(page, posKey) {
  if (!posKey || !POSITION_MAP[posKey]) return
  const { x: rx, y: ry } = POSITION_MAP[posKey]
  // 캔버스 영역에서 드래그로 위치 조정
  const canvas = await findFirst(page, ['[class*="canvas"]', '[class*="previewArea"]'])
  if (!canvas) return
  const box = await canvas.boundingBox()
  if (!box) return
  const tx = box.x + box.width  * rx
  const ty = box.y + box.height * ry
  // 스티커가 중앙에 배치된 상태에서 드래그
  const cx = box.x + box.width  * 0.5
  const cy = box.y + box.height * 0.5
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await sleep(200)
  await page.mouse.move(tx, ty, { steps: 10 })
  await page.mouse.up()
  await sleep(300)
}

// ── STEP 8: BGM 삽입 + 키프레임 볼륨 ────────────────────────────────
async function step8_bgm(page, bgmSpec) {
  if (!bgmSpec?.path || !fs.existsSync(bgmSpec.path)) {
    console.log('[8] BGM 없음 — 건너뜀')
    return
  }
  console.log(`[8] BGM 업로드: ${path.basename(bgmSpec.path)}`)

  // 오디오 탭 클릭
  const audioTab = await findFirstXP(page, [
    '//div[@role="tab" and contains(., "오디오")]',
    '//div[@role="tab" and contains(., "Audio")]',
    '//button[contains(., "음악")]',
  ])
  if (audioTab) { await audioTab.click(); await sleep(800) }

  // 로컬 파일 업로드
  const uploadBtn = await findFirstXP(page, [
    '//button[contains(., "로컬")]',
    '//button[contains(., "Local")]',
    '//button[contains(., "파일")]',
  ])
  if (uploadBtn) {
    await pickFile(page, () => uploadBtn.click(), [bgmSpec.path], CONFIG.uploadTimeout)
    await sleep(2000)
  }

  // 타임라인에 추가 (시작 지점 0으로)
  const addBtn = await findFirstXP(page, ['//button[contains(., "추가")]'])
  if (addBtn) { await addBtn.click(); await sleep(800) }

  // 볼륨 설정
  await setBgmVolume(page, bgmSpec.volume ?? 0.35)

  // 페이드인/아웃
  if (bgmSpec.fade_in || bgmSpec.fade_out) {
    await setBgmFade(page, bgmSpec.fade_in, bgmSpec.fade_out)
  }

  console.log('[8] BGM 설정 완료')
}

async function setBgmVolume(page, vol) {
  const volInput = await findFirst(page, ['input[class*="volume"]', '[aria-label="Volume"]'])
  if (!volInput) return
  const percent = Math.round(vol * 100)
  await volInput.click({ clickCount: 3 })
  await volInput.type(String(percent), { delay: 50 })
  await page.keyboard.press('Enter')
  await sleep(300)
}

async function setBgmFade(page, fadeIn, fadeOut) {
  if (fadeIn) {
    const fadeInBtn = await findFirstXP(page, ['//button[contains(., "페이드인")]', '//button[contains(., "Fade in")]'])
    if (fadeInBtn) { await fadeInBtn.click(); await sleep(300) }
  }
  if (fadeOut) {
    const fadeOutBtn = await findFirstXP(page, ['//button[contains(., "페이드아웃")]', '//button[contains(., "Fade out")]'])
    if (fadeOutBtn) { await fadeOutBtn.click(); await sleep(300) }
  }
}

// ── STEP 9: 트랜지션 설정 ────────────────────────────────────────────
async function step9_transition(page, transSpec) {
  if (!transSpec) { console.log('[9] 트랜지션 없음 — 건너뜀'); return }
  console.log(`[9] 트랜지션: ${transSpec.type}`)

  // 타임라인 컷 경계 클릭 → 트랜지션 패널
  const transitions = await page.$$('[class*="transitionPoint"],[class*="transition-point"]')
  for (const tp of transitions) {
    await tp.click()
    await sleep(400)

    const transItem = await findFirstXP(page, [
      `//*[contains(., "디졸브") or contains(., "Dissolve")][@role="button" or contains(@class,"transItem")]`,
    ])
    if (transItem) { await transItem.click(); await sleep(300) }
    await page.keyboard.press('Escape')
    await sleep(300)
  }
  console.log('[9] 트랜지션 설정 완료')
}

// ── MAIN ──────────────────────────────────────────────────────────────
async function main() {
  const specArg = process.argv.find(a => a.startsWith('--spec='))
  if (!specArg) {
    console.error('❌ 사용법: node scripts/capcut-reel-automation.js --spec=downloads/capcut_spec_IG_R01.json')
    process.exit(1)
  }

  const specPath = specArg.replace('--spec=', '').trim()
  if (!fs.existsSync(specPath)) {
    console.error(`❌ spec 파일 없음: ${specPath}`)
    process.exit(1)
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'))
  const items = spec.tracks?.find(t => t.name === 'main')?.items ?? []

  if (items.length === 0) { console.error('❌ tracks.main.items 없음'); process.exit(1) }

  console.log(`\n🎬 CapCut 릴스 자동화 시작 — ${spec.name}`)
  console.log(`   컷 수: ${items.length}개 | 총 길이: ${items.reduce((s,i) => s+(i.duration??0), 0)}초\n`)

  // Chrome 연결
  console.log(`[Chrome] port ${CONFIG.debuggingPort} 연결 중...`)
  let browser
  try {
    browser = await puppeteer.connect({
      browserURL:      `http://localhost:${CONFIG.debuggingPort}`,
      defaultViewport: null,
      protocolTimeout: 300_000,
    })
  } catch (err) {
    console.error(`❌ Chrome 연결 실패: ${err.message}`)
    process.exit(1)
  }

  const allPages = await browser.pages()
  // 에디터 탭이 이미 열려 있으면(이전 실행이 프로젝트 생성까지는 성공했던 경우 등)
  // recent-list보다 우선 사용 — 안 그러면 새 프로젝트를 중복 생성하게 됨
  let page = allPages.find(p => p.url().includes('capcut.com/editor')) ||
    allPages.find(p => p.url().includes('capcut.com')) ||
    await browser.newPage()

  try {
    await step1_navigate(page)

    if (!page.url().includes('capcut.com/editor')) {
      page = await step2_createProject(page, browser)
    }

    await step3_confirmEditor(page)
    await step4_uploadMedia(page, items)
    await step5_addToTimeline(page, items)
    await step6_captions(page, items)
    await step7_stickers(page, items)
    await step8_bgm(page, spec.bgm)
    await step9_transition(page, spec.transition)

    const editorUrl = page.url()
    console.log(`\n✅ 편집 세팅 완료!`)
    console.log(`   에디터 URL: ${editorUrl}`)
    console.log(`   → CapCut에서 직접 확인 후 내보내기 실행\n`)

  } catch (err) {
    console.error(`\n❌ 오류: ${err.message}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err.message)
  process.exit(1)
})
