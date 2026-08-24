/**
 * capcut-hairline-reveal.js
 * CapCut 웹 - Reshape > Hairline 파라미터를 구간별로 다르게 적용해
 * "헤어라인 변화" 연출 영상을 자동 생성한다.
 *
 * 배경:
 *   CapCut 웹의 Reshape(리셰이프) 파라미터(Hairline 포함)는 키프레임(◇) 아이콘을
 *   지원하지 않는다 — Basic 탭의 Scale/Position/Rotate/Opacity에만 키프레임이 있다.
 *   따라서 "이마 슬라이더 + 키프레임"을 문자 그대로는 구현할 수 없고,
 *   대신 클립을 여러 구간으로 분할(split) → 구간마다 다른 Hairline 값을 적용
 *   → 구간 사이에 트랜지션을 넣어 변화하는 것처럼 보이게 연출한다.
 *
 * 흐름:
 *  1. CDP로 열려있는 CapCut 에디터 탭에 연결 (--editorUrl 지정 시 그 URL로 이동)
 *  2. 타임라인의 대상 클립 선택 (기본: 첫 번째 클립)
 *  3. --points로 지정한 시간 지점마다 분할(Ctrl+B)
 *  4. 각 구간을 선택 → Smart tools > Retouch > Reshape(Face) > Hairline 값 적용
 *  5. (--transition 지정 시) 구간 사이에 트랜지션 삽입 시도
 *
 * 사용법:
 *   node scripts/capcut-hairline-reveal.js --points="0:0,1.7:50,3.3:100"
 *   node scripts/capcut-hairline-reveal.js --editorUrl=https://www.capcut.com/editor/xxx --points="0:0,2:100" --transition=Dissolve
 *
 * 전제조건:
 *   chrome.exe --remote-debugging-port=9222  (capcut.com 로그인 상태)
 *   대상 프로젝트 에디터가 열려 있고, 타임라인에 편집할 클립이 이미 올라가 있어야 함
 *   (업로드 자체는 capcut-web-automation.js의 step4_uploadVideo 참고)
 */

import puppeteer from 'puppeteer-core'

// ── CONFIG ───────────────────────────────────────────────────────────
const CONFIG = {
  debuggingPort: 9222,
  navTimeout: 30000,
}

// ── 헬퍼 (capcut-web-automation.js와 동일 패턴) ─────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
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

async function robustClick(page, locate, label = '', retries = 5, retryDelayMs = 500) {
  let el = null
  for (let i = 0; i < retries; i++) {
    el = await locate()
    if (el) break
    await sleep(retryDelayMs)
  }
  if (!el) return false
  await page.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }), el).catch(() => {})
  await sleep(150)
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

// 클립 duration 텍스트("00:05:00" 등, hh:mm:ss 또는 mm:ss:ff)를 초 단위로 변환.
// CapCut 클립 라벨은 실제로 "mm:ss:ff"(프레임) 포맷을 쓰는 경우가 많아,
// 안전하게 마지막 두 구간을 초.프레임으로 취급하지 않고 콜론 개수에 따라 분기.
function parseClipDuration(label) {
  const m = label.match(/(\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const [, a, b, c] = m.map(Number)
  // CapCut는 보통 시:분:초가 아니라 분:초:프레임 형식 — 프레임은 초 단위 근사에 큰 영향 없어 버림
  return a * 60 + b + c / 30
}

// ── STEP 1: 타겟 클립 찾기 ────────────────────────────────────────────
async function findTargetClip(page, clipIndex = 0) {
  const clips = await page.$$('[class*="track-item"], [class*="trackItem"]')
  if (clips.length === 0) {
    throw new Error('타임라인에서 클립을 찾을 수 없습니다. 먼저 영상/사진을 타임라인에 추가하세요.')
  }
  if (clipIndex >= clips.length) {
    throw new Error(`clipIndex(${clipIndex})가 범위를 벗어났습니다. 타임라인 클립 수: ${clips.length}`)
  }
  return clips[clipIndex]
}

// ── STEP 2: 지정 시간에 재생헤드 이동 후 분할 ──────────────────────────
// clipEl의 boundingClientRect와 라벨의 duration으로 px/sec을 계산해
// targetTimeSec 위치로 재생헤드를 클릭 이동한 뒤 Ctrl+B로 분할한다.
async function splitClipAt(page, clipEl, targetTimeSec, clipStartSec, clipDurationSec) {
  const box = await clipEl.boundingBox()
  if (!box) throw new Error('클립의 위치를 계산할 수 없습니다 (boundingBox 없음)')

  const pxPerSec = box.width / clipDurationSec
  const offsetInClip = targetTimeSec - clipStartSec
  if (offsetInClip <= 0.05 || offsetInClip >= clipDurationSec - 0.05) {
    console.log(`[split] ${targetTimeSec}s는 클립 경계와 너무 가까움 — 분할 생략`)
    return false
  }

  const x = Math.round(box.x + offsetInClip * pxPerSec)
  const rulerY = box.y - 90 // 타임라인 룰러는 트랙 위쪽 — 실측 오프셋(대략 90px 위)

  console.log(`[split] ${targetTimeSec.toFixed(2)}s 지점으로 재생헤드 이동 (x=${x})`)
  await page.mouse.click(x, rulerY)
  await sleep(300)

  // 분할할 세그먼트를 트랙에서 다시 클릭해 확실히 선택
  await page.mouse.click(x - 5, box.y + box.height / 2)
  await sleep(300)

  console.log('[split] Ctrl+B로 분할')
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyB')
  await page.keyboard.up('Control')
  await sleep(500)
  return true
}

// ── STEP 3: 현재 선택된 클립에 Hairline 값 적용 ────────────────────────
// Smart tools(우측 사이드바) > Retouch > 3번째 탭(Reshape) > Face > Hairline
async function applyHairline(page, value) {
  // 우측 사이드바 "Smart tools" 아이콘
  const smartToolsBtn = await findFirstXP(page, [
    '//*[contains(@class,"sidebar") or contains(@class,"panel")]//*[contains(., "Smart") and contains(., "tools")]',
  ]) || await findFirst(page, ['[class*="smart-tool"]', '[class*="smartTool"]'])
  if (!(await robustClick(page, () => Promise.resolve(smartToolsBtn), 'Smart tools'))) {
    // 아이콘 텍스트 매칭 실패 시 좌표 기반 폴백은 사용하지 않음 — 명시적으로 실패 처리
    throw new Error('"Smart tools" 패널을 찾을 수 없습니다.')
  }
  await sleep(600)

  const retouchBtn = await findFirstXP(page, [
    '//*[normalize-space(text())="Retouch"]',
    '//*[contains(., "Retouch")]',
  ])
  if (!(await robustClick(page, () => Promise.resolve(retouchBtn), 'Retouch'))) {
    throw new Error('"Retouch" 메뉴를 찾을 수 없습니다.')
  }
  await sleep(600)

  // Retouch 패널 상단 4개 아이콘 탭 중 3번째 = Reshape(리셰이프)
  // 안정적인 클래스가 없어 탭 컨테이너를 찾은 뒤 3번째 자식을 클릭
  const reshapeTabClicked = await page.evaluate(() => {
    const header = [...document.querySelectorAll('div')].find(d =>
      d.textContent.trim() === 'Retouch' && d.previousElementSibling === null
    )
    // 폴백: role="tab" 그룹에서 3번째 요소
    const tabs = document.querySelectorAll('[role="tab"]')
    if (tabs.length >= 3) {
      tabs[2].click()
      return true
    }
    return false
  })
  if (!reshapeTabClicked) {
    throw new Error('Reshape 탭(3번째 아이콘)을 찾을 수 없습니다 — CapCut UI가 변경되었을 수 있습니다.')
  }
  await sleep(600)

  // "Face" 서브탭이 기본 선택되어 있지 않으면 클릭
  const faceTab = await findFirstXP(page, ['//button[normalize-space(.)="Face"]'])
  if (faceTab) { await faceTab.click(); await sleep(400) }

  // "Hairline" 라벨을 찾고, 그 다음에 오는 number input에 값 설정
  const applied = await page.evaluate((val) => {
    const label = [...document.querySelectorAll('div,span')]
      .find(el => el.children.length === 0 && el.textContent.trim() === 'Hairline')
    if (!label) return { ok: false, reason: 'label-not-found' }

    // 라벨의 조상 row 컨테이너 안에서 number input 탐색
    let row = label.parentElement
    let input = null
    for (let i = 0; i < 4 && row && !input; i++) {
      input = row.querySelector('input.lv-input, input[type="text"]')
      row = row.parentElement
    }
    if (!input) return { ok: false, reason: 'input-not-found' }

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, String(val))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.blur()
    return { ok: true, appliedTo: input.value }
  }, value)

  if (!applied.ok) {
    throw new Error(`Hairline 입력을 찾을 수 없습니다 (${applied.reason})`)
  }
  await sleep(400)
  console.log(`[hairline] 값 적용 시도: ${value} → 실제 반영값: ${applied.appliedTo}`)
  return applied.appliedTo
}

// ── STEP 4: 구간 사이 트랜지션 삽입 (best-effort) ──────────────────────
async function addTransition(page, gapX, gapY, transitionName) {
  const icon = await page.evaluateHandle((x, y) => {
    const els = [...document.querySelectorAll('[class*="transition-add-icon"]')]
    // 여러 개일 수 있어 좌표상 가장 가까운 것 선택
    let best = null, bestDist = Infinity
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const d = Math.hypot(r.x - x, r.y - y)
      if (d < bestDist) { bestDist = d; best = el }
    }
    return best
  }, gapX, gapY)

  const el = icon.asElement()
  if (!el) {
    console.warn('[transition] 삽입 아이콘을 찾지 못함 — 수동으로 추가 필요')
    return false
  }
  await el.click()
  await sleep(800)

  const target = await findFirstXP(page, [
    `//*[contains(., "${transitionName}")]`,
  ])
  if (target) {
    await target.click()
    console.log(`[transition] "${transitionName}" 적용`)
    await sleep(500)
    return true
  }
  console.warn(`[transition] "${transitionName}" 항목을 찾지 못함 — 목록 첫 항목 등 수동 확인 필요`)
  return false
}

// ── MAIN ─────────────────────────────────────────────────────────────
async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
      const [k, ...v] = a.replace(/^--/, '').split('=')
      return [k, v.join('=')]
    })
  )

  const pointsArg = args.points
  if (!pointsArg) {
    console.error('❌ 사용법: node scripts/capcut-hairline-reveal.js --points="0:0,1.7:50,3.3:100" [--editorUrl=...] [--clip=0] [--transition=Dissolve]')
    process.exit(1)
  }

  const points = pointsArg.split(',').map(s => {
    const [t, v] = s.split(':').map(Number)
    return { t, v }
  }).sort((a, b) => a.t - b.t)

  const clipIndex = args.clip ? Number(args.clip) : 0
  const transitionName = args.transition || null

  console.log(`\n🎬 CapCut Hairline Reveal 자동화\n`)
  console.log(`[구간] ${points.map(p => `${p.t}s→${p.v}`).join('  ')}`)
  console.log(`[클립 인덱스] ${clipIndex}`)
  console.log(`[트랜지션] ${transitionName || '없음'}\n`)

  let browser
  try {
    browser = await puppeteer.connect({
      browserURL: `http://localhost:${CONFIG.debuggingPort}`,
      defaultViewport: null,
      protocolTimeout: 300000,
    })
  } catch (err) {
    console.error(`❌ Chrome 연결 실패: ${err.message}`)
    console.error(`   → "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${CONFIG.debuggingPort}`)
    process.exit(1)
  }

  const allPages = await browser.pages()
  let page = allPages.find(p => p.url().includes('capcut.com/editor'))
  if (args.editorUrl) {
    page = page || await browser.newPage()
    await page.goto(args.editorUrl, { waitUntil: 'networkidle2', timeout: CONFIG.navTimeout })
    await sleep(3000)
  }
  if (!page) {
    console.error('❌ 열려있는 CapCut 에디터 탭을 찾을 수 없습니다. --editorUrl을 지정하세요.')
    process.exit(1)
  }

  try {
    // 1) 대상 클립 찾기 + 선택 + duration 파싱
    let clip = await findTargetClip(page, clipIndex)
    await clip.click()
    await sleep(500)

    const label = await page.evaluate(el => el.textContent, clip)
    const durationSec = parseClipDuration(label)
    if (!durationSec) {
      throw new Error(`클립 duration을 라벨("${label}")에서 파싱하지 못했습니다.`)
    }
    console.log(`[클립] "${label.trim()}" — duration ≈ ${durationSec.toFixed(2)}s`)

    // 2) 분할 지점들(첫 지점 제외) 순서대로 분할
    //    분할할 때마다 대상 클립을 다시 찾아야 함 (분할로 DOM 요소가 늘어남)
    const splitPoints = points.slice(1).map(p => p.t)
    for (const t of splitPoints) {
      clip = await findTargetClip(page, clipIndex === 0 ? 0 : clipIndex) // 재탐색은 아래에서 보정
      // 분할 대상은 t가 속한 세그먼트 — 현재 누적된 세그먼트 중 t를 포함하는 것을 찾는다
      const clips = await page.$$('[class*="track-item"], [class*="trackItem"]')
      let acc = 0
      let target = null, startSec = 0
      for (const c of clips) {
        const lbl = await page.evaluate(el => el.textContent, c)
        const dur = parseClipDuration(lbl) || 0
        if (t > acc && t < acc + dur) { target = c; startSec = acc; break }
        acc += dur
      }
      if (!target) {
        console.warn(`[split] ${t}s를 포함하는 세그먼트를 찾지 못함 — 건너뜀`)
        continue
      }
      const segLabel = await page.evaluate(el => el.textContent, target)
      const segDur = parseClipDuration(segLabel) || (durationSec - startSec)
      await splitClipAt(page, target, t, startSec, segDur)
    }

    // 3) 구간별로 Hairline 적용 (왼쪽→오른쪽 순서, 각 세그먼트 클릭 후 적용)
    const segments = await page.$$('[class*="track-item"], [class*="trackItem"]')
    console.log(`\n[세그먼트] 총 ${segments.length}개 — points(${points.length}개)와 순서대로 매칭\n`)
    for (let i = 0; i < segments.length && i < points.length; i++) {
      const seg = segments[i]
      await seg.click()
      await sleep(400)
      await applyHairline(page, points[i].v)
    }

    // 4) 트랜지션 (best-effort)
    if (transitionName) {
      const segs2 = await page.$$('[class*="track-item"], [class*="trackItem"]')
      for (let i = 0; i < segs2.length - 1; i++) {
        const box = await segs2[i].boundingBox()
        if (!box) continue
        const gapX = box.x + box.width
        const gapY = box.y + box.height / 2
        await addTransition(page, gapX, gapY, transitionName)
      }
    }

    console.log('\n✅ Hairline reveal 구간 적용 완료 — CapCut 에디터에서 결과를 확인하세요.\n')
  } catch (err) {
    console.error(`\n❌ 오류: ${err.message}\n`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err.message)
  process.exit(1)
})
