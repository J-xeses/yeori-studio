// Google Flow(flow.google.com) 화면 조작 모듈 — 스튜디오의 프롬프트/시작 프레임을 Flow에 "입력"하고
// 생성 직전 상태를 검증하는 데 쓴다(2026-09-20 신규, 무료 경로 반자동화의 기반).
//
// 이 모듈은 2026-09-20 실측(Chrome 153, Flow 화면)에서 확인한 구조에 맞춰 만들었다:
//  - 프롬프트 창 오른쪽의 "설정 요약 버튼"(예: "동영상 · 720p · 8초 crop_16_9 x1")을 누르면 팝업이 열린다.
//  - 팝업: 상위 모드(이미지/동영상) → 서브모드(프레임/소재) → 비율 → 모델 드롭다운 → (Omni만) 해상도·길이 → 개수 → "생성 시 N 크레딧" 줄.
//  - 모델: Omni 1.1 Flash / Veo 3.1 - Lite / Fast / Quality. Veo 모델에서는 길이·해상도 선택 줄이 없다.
//  - 버튼 텍스트에 Material 아이콘 이름이 접두사로 붙는다(crop_free프레임, chrome_extension소재, volume_upOmni…, crop_16_916:9).
// 화면이 바뀌면 깨질 수 있으므로 모든 동작은 "다시 읽어서 확인"하고, 실패하면 예외를 던진다 — 호출자는
// 예외 시 수동 경로(프롬프트 복사 + 도구 열기)로 넘어가야 한다.
//
// ⚠️ 안전: 이 모듈은 Enter 키를 절대 누르지 않는다(Flow는 Enter = 제출). 전송은 submit()의 버튼 클릭뿐이고,
//    submit()은 verifyGate()가 통과한 뒤에만 호출하는 것이 규칙이다.

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export const MODELS = ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality']
const TARGET_SEL = 'button, [role="tab"], [role="menuitem"], [role="radio"]'

export async function attachFlow({ port = 9222 } = {}) {
  const browser = await puppeteer.connect({ browserURL: `http://localhost:${port}`, defaultViewport: null })
  const page = (await browser.pages()).find(p => p.url().includes('flow.google.com/project'))
  if (!page) { browser.disconnect(); throw new Error('Flow 프로젝트 탭을 찾지 못했습니다(전용 Chrome에서 Flow 프로젝트를 열어두세요)') }

  // 창이 작으면(실측: 높이 208px에서 설정 팝업이 화면 밖으로 밀려 클릭이 빗나감) 뷰포트를 임시로 키우고, release()에서 원복한다.
  // 창 자체의 크기는 건드리지 않는 CDP 에뮬레이션이라 사용자의 창 배치에는 영향이 없다.
  const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  let cdp = null
  if (size.h < 800 || size.w < 1200) {
    cdp = await page.createCDPSession()
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
  }
  const release = async () => {
    try { if (cdp) await cdp.send('Emulation.clearDeviceMetricsOverride') } catch { /* noop */ }
    try { browser.disconnect() } catch { /* noop */ }
  }
  return { browser, page, release, emulated: !!cdp, originalViewport: size }
}

export function flowKit(page) {
  // 화면에서 조건에 맞는 요소의 중심 좌표를 찾는다. match: exact | includes | startsWith | pill
  const rectOf = (text, match = 'exact', sel = TARGET_SEL) => page.evaluate((text, match, sel) => {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      const t = (el.textContent || '').trim()
      const ok = match === 'exact' ? t === text : match === 'includes' ? t.includes(text) : match === 'startsWith' ? t.startsWith(text) : (/x[1-4]$/.test(t) && t.length < 60)
      if (ok) return { x: r.left + r.width / 2, y: r.top + r.height / 2, t }
    }
    return null
  }, text, match, sel)

  const clickAt = async (pos) => { await page.mouse.click(pos.x, pos.y); await sleep(900) }
  const click = async (text, match = 'exact', sel) => {
    const pos = await rectOf(text, match, sel)
    if (!pos) throw new Error(`Flow 화면에서 "${text}" 요소를 찾지 못했습니다`)
    await clickAt(pos); return pos.t
  }
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()

  // ⚠️ 안전 규칙(2026-09-20 사고): 포커스가 입력칸이 아닌 상태에서 Ctrl+A → Backspace를 누르면 Flow가 "전체 미디어 선택 → 삭제"로
  // 받아들여 프로젝트의 모든 항목이 휴지통으로 간다(실제로 66개가 이동됨, 실행취소로 복구). 그래서 Ctrl+A/Backspace/타이핑은
  // 반드시 아래 함수로만 하고, 포커스가 입력칸(input/textarea/contenteditable)이 아니면 예외를 던져 아무 키도 누르지 않는다.
  const editableFocused = () => page.evaluate(() => {
    const a = document.activeElement
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable === true || a.getAttribute('role') === 'textbox')
  })
  const requireEditableFocus = async (what) => { if (!(await editableFocused())) throw new Error(`${what}: 입력칸에 포커스가 없어 키 입력을 중단했습니다(오삭제 방지)`) }
  const selectAllAndDelete = async (what) => {
    await requireEditableFocus(what)
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
    await requireEditableFocus(what)          // 선택 직후에도 여전히 입력칸인지 재확인
    await page.keyboard.press('Backspace')
  }
  const typeInto = async (text, what) => { await requireEditableFocus(what); await page.keyboard.type(text, { delay: 8 }) }

  const kit = {
    rectOf, click,

    // ── 읽기 ────────────────────────────────────────────────────────
    async pill() { const p = await rectOf('', 'pill', 'button'); return p ? norm(p.t) : null },
    async costLine() { return page.evaluate(() => (document.body.innerText.match(/생성 시[^\n]*크레딧[^\n]*/) || [''])[0].replace(/\s+/g, ' ').trim()) },
    async credits() { const m = (await this.costLine()).match(/([0-9]+)\s*크레딧/); return m ? Number(m[1]) : null },
    async popupOpen() { return !!(await rectOf('crop_free', 'includes', 'button')) },
    async modelLabel() {
      const p = await rectOf('arrow_drop_down', 'includes', 'button')
      return p ? norm(p.t).replace('arrow_drop_down', '').trim() : null
    },
    async promptText() {
      return page.evaluate(() => { const el = [...document.querySelectorAll('[role="textbox"], [contenteditable="true"], textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 0 && r.top > innerHeight * 0.4 }).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; return el ? (el.innerText || el.value || '') : null })
    },

    // ── 팝업 조작 ───────────────────────────────────────────────────
    async openPopup() {
      for (let i = 0; i < 3; i++) {
        if (await this.popupOpen()) return
        const p = await rectOf('', 'pill', 'button')
        if (!p) throw new Error('설정 요약 버튼을 찾지 못했습니다')
        await page.mouse.click(p.x, p.y); await sleep(1800)
      }
      if (!(await this.popupOpen())) throw new Error('설정 팝업이 열리지 않습니다')
    },
    async closePopup() { if (await this.popupOpen()) { await page.keyboard.press('Escape'); await sleep(600) } },

    async setSubMode(kind) { // 'frame' | 'ingredients'
      await this.openPopup()
      await click(kind === 'frame' ? 'crop_free프레임' : 'chrome_extension소재')
    },
    async setRatio(r) { await this.openPopup(); await click(r === '9:16' ? 'crop_9_169:16' : 'crop_16_916:9') },
    async setCount(n = 1) { await this.openPopup(); await click(`x${n}`) },
    async setModel(name) {
      if (!MODELS.includes(name)) throw new Error(`알 수 없는 모델: ${name}`)
      await this.openPopup()
      if ((await this.modelLabel()) === name) return
      const dd = await rectOf('arrow_drop_down', 'includes', 'button')
      if (!dd) throw new Error('모델 드롭다운을 찾지 못했습니다')
      await clickAt(dd)
      await click('volume_up' + name, 'exact', '[role="menuitem"]')
      if ((await this.modelLabel()) !== name) throw new Error(`모델 선택 실패(현재: ${await this.modelLabel()})`)
    },
    // 길이·해상도는 Omni 모델에서만 선택 가능
    async setDuration(sec) {
      await this.openPopup()
      if (!(await rectOf(`${sec}초`, 'exact'))) throw new Error(`이 모델에는 ${sec}초 선택 줄이 없습니다(Veo 모델은 8초 고정으로 보임)`)
      await click(`${sec}초`)
    },
    async setResolution(res = '720p') { await this.openPopup(); await click(res) },

    // ── 프롬프트 ────────────────────────────────────────────────────
    // 줄바꿈은 Enter(=제출)로 처리되므로 공백으로 바꿔 한 줄로 넣는다(2026-08-10 사고 이력). 넣은 뒤 읽어서 검증한다.
    async fillPrompt(text) {
      const one = norm(String(text).replace(/\s*\n+\s*/g, ' '))
      await this.closePopup()
      const box = await page.evaluate(() => { const el = [...document.querySelectorAll('[role="textbox"], [contenteditable="true"], textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 0 && r.top > innerHeight * 0.4 }).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
      if (!box) throw new Error('프롬프트 입력창을 찾지 못했습니다')
      await page.mouse.click(box.x, box.y); await sleep(300)
      await selectAllAndDelete('프롬프트 입력'); await sleep(200)
      await typeInto(one, '프롬프트 입력'); await sleep(500)
      const got = norm(await this.promptText())
      if (got !== one) throw new Error(`프롬프트 입력 검증 실패(입력 ${one.length}자 / 읽힌 값 ${got.length}자)`)
      return one
    },
    async clearPrompt() {
      const box = await page.evaluate(() => { const el = [...document.querySelectorAll('[role="textbox"], [contenteditable="true"], textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 0 && r.top > innerHeight * 0.4 }).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
      if (!box) return
      await page.mouse.click(box.x, box.y); await sleep(200)
      await selectAllAndDelete('프롬프트 지우기'); await sleep(300)
    },

    // ── 시작 프레임 ─────────────────────────────────────────────────
    // 실측(2026-09-20): 프레임 모드의 "시작" 슬롯은 파일 선택창이 아니라 "프레임 이미지 선택" 패널(프로젝트에 이미
    // 올라간 이미지 목록 + 검색창)을 연다. 그래서 ① 이미지를 프로젝트에 업로드(상단 + → 업로드) ② 패널에서 파일명으로
    // 검색해 클릭 — 이 순서. 업로드된 이미지는 파일명이 그대로 라벨로 남는다.
    // ⚠️ 같은 파일명으로 다시 만든 이미지가 옛 이미지로 잘못 선택되지 않게, 업로드 이름에 내용 지문(sha1 앞 8자)을 붙인다.
    async startFrameFilled() { return !(await rectOf('시작', 'exact', 'button, [role="button"], div')) },

    async _uploadToProject(filePath) {
      let up = await rectOf('upload업로드', 'exact', 'button, [role="menuitem"]')
      if (!up) {
        const plus = await rectOf('add', 'exact', 'button')
        if (!plus) throw new Error('상단 + 버튼을 찾지 못했습니다')
        await page.mouse.click(plus.x, plus.y); await sleep(1200)
        up = await rectOf('upload업로드', 'exact', 'button, [role="menuitem"]')
      }
      if (!up) throw new Error('업로드 메뉴를 찾지 못했습니다')
      let chooser = null
      const waiter = page.waitForFileChooser({ timeout: 8000 }).then(c => { chooser = c }).catch(() => {})
      await page.mouse.click(up.x, up.y); await waiter
      if (!chooser) throw new Error('파일 선택창이 열리지 않았습니다')
      await chooser.accept([filePath])
    },

    // 슬롯을 열고 이름으로 검색해 그 항목이 있으면 클릭한다. 반환: 선택했으면 true
    async _searchAndPick(name) {
      const slot = await rectOf('시작', 'exact', 'button, [role="button"], div')
      if (!slot) throw new Error('시작 슬롯을 찾지 못했습니다(프레임 모드가 아니거나 이미 채워짐)')
      await page.mouse.click(slot.x, slot.y); await sleep(1500)
      // 검색창이 열려 포커스를 받았는지 먼저 확인한다(안 받았으면 키를 누르지 않고 닫는다). 검색창은 열릴 때 비어 있으므로
      // Ctrl+A/Backspace는 쓰지 않고 그대로 타이핑한다.
      if (!(await editableFocused())) { await page.keyboard.press('Escape'); await sleep(700); throw new Error('프레임 패널 검색창에 포커스가 없습니다') }
      await page.keyboard.type(name, { delay: 25 }); await sleep(1800)
      const hit = await page.evaluate((name) => {
        for (const e of document.querySelectorAll('[role="listbox"] [role="option"], [role="listbox"] button, [role="option"]')) {
          const r = e.getBoundingClientRect()
          if (r.width > 0 && (e.innerText || '').includes(name)) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }
        return null
      }, name)
      if (!hit) { await page.keyboard.press('Escape'); await sleep(700); return false }
      await page.mouse.click(hit.x, hit.y)
      // 선택이 먹었으면 "프레임 이미지 선택" 패널이 닫힌다. 업로드 처리가 덜 끝난 이미지는 목록엔 보여도 선택이 안 되므로,
      // 패널이 그대로 열려 있으면 실패로 보고 호출자가 나중에 다시 시도한다.
      for (let i = 0; i < 8; i++) {
        await sleep(500)
        if (!(await page.evaluate(() => document.body.innerText.includes('프레임 이미지 선택')))) return true
      }
      await page.keyboard.press('Escape'); await sleep(700)
      return false
    },

    // 시작 프레임 지정. filePath의 내용 지문으로 만든 고유 이름으로 올린 뒤 선택한다. 반환: 프로젝트 내 자산 이름
    async attachStartFrame(filePath) {
      const buf = fs.readFileSync(filePath)
      const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)
      const ext = path.extname(filePath) || '.jpg'
      const uniqueName = `${path.basename(filePath, ext)}__${hash}${ext}`
      const tmp = path.join(os.tmpdir(), uniqueName)
      if (!fs.existsSync(tmp)) fs.writeFileSync(tmp, buf)

      await this.setSubMode('frame'); await this.closePopup()
      // 프레임 모드 전환 직후에는 슬롯이 그려지기까지 시간이 걸린다 — 나타날 때까지 기다린다. 끝내 안 보이면
      // 이미 썸네일로 채워진 상태일 수 있으니 비운 뒤 다시 기다린다.
      const waitSlot = async () => { for (let i = 0; i < 10; i++) { if (await rectOf('시작', 'exact', 'button, [role="button"], div')) return true; await sleep(500) } return false }
      if (!(await waitSlot())) {
        await this.clearStartFrame()
        if (!(await waitSlot())) throw new Error('프레임 모드의 시작 슬롯이 나타나지 않습니다')
      }
      let picked = await this._searchAndPick(uniqueName)     // 이미 올려둔 같은 내용이면 재업로드 없이 사용
      if (!picked) {
        await this._uploadToProject(tmp)
        for (let i = 0; i < 8 && !picked; i++) { await sleep(3000); picked = await this._searchAndPick(uniqueName) }
      }
      if (!picked) throw new Error(`업로드한 이미지(${uniqueName})를 프레임 패널에서 찾지 못했습니다`)
      // 화면 갱신(라벨 "시작" → 썸네일)을 최대 6초 기다리며 확인
      let filled = false
      for (let i = 0; i < 12 && !filled; i++) { filled = await this.startFrameFilled(); if (!filled) await sleep(500) }
      if (!filled) throw new Error('시작 프레임 지정 검증 실패(슬롯이 채워지지 않음)')
      return uniqueName
    },
    async clearStartFrame() {
      const x = await rectOf('close', 'exact', 'button')
      if (x) { await page.mouse.click(x.x, x.y); await sleep(900) }
    },

    // ── 생성 직전 검증 관문 ─────────────────────────────────────────
    // expect: { model, ratio?, durationSec?, maxCredits, prompt }. 문제 목록을 돌려준다(빈 배열 = 통과).
    async verifyGate(expect) {
      const problems = []
      // "생성 시 N 크레딧" 줄은 설정 팝업이 열려 있을 때만 화면에 있으므로, 열어둔 채로 모델·크레딧을 함께 읽는다.
      await this.openPopup()
      const model = await this.modelLabel()
      const credits = await this.credits().catch(() => null)
      await this.closePopup()
      const pill = await this.pill()
      if (model !== expect.model) problems.push(`모델 불일치: 기대 ${expect.model} / 현재 ${model}`)
      if (!pill || !pill.includes('동영상')) problems.push(`동영상 모드가 아님: ${pill}`)
      if (expect.ratio && pill && !pill.includes(expect.ratio === '9:16' ? 'crop_9_16' : 'crop_16_9')) problems.push(`비율 불일치: 기대 ${expect.ratio} / ${pill}`)
      if (expect.durationSec && pill && !pill.includes(`${expect.durationSec}초`)) problems.push(`길이 불일치: 기대 ${expect.durationSec}초 / ${pill}`)
      if (pill && !/x1$/.test(pill)) problems.push(`생성 개수가 x1이 아님: ${pill}`)
      if (expect.startFrame && !(await this.startFrameFilled())) problems.push('시작 프레임이 지정되지 않음(프레임 모드 슬롯이 비어 있음)')
      if (credits == null) problems.push('예상 크레딧을 읽지 못함')
      else if (expect.maxCredits != null && credits > expect.maxCredits) problems.push(`예상 크레딧 초과: ${credits} > 허용 ${expect.maxCredits}`)
      if (expect.prompt != null) {
        const want = norm(String(expect.prompt).replace(/\s*\n+\s*/g, ' ')), got = norm(await this.promptText())
        if (got !== want) problems.push('프롬프트가 스튜디오 원문과 다름')
      }
      return { ok: problems.length === 0, problems, pill, model, credits }
    },

    // 전송 버튼 클릭(Enter 사용 안 함). verifyGate 통과 후에만 호출할 것.
    async submit() { await click('arrow_forward', 'exact', 'button') },

    // ── 생성 결과 감지·저장 ─────────────────────────────────────────
    // 실측(2026-09-20): 목록의 생성 결과는 <video>가 아니라 alt="생성된 동영상 썸네일" 이미지 타일이고, 실패하면 타일에
    // "죄송합니다. 동영상을 생성할 수 없습니다. 이 생성에 대한 요금이 청구되지 않았습니다." 문구가 뜬다(사유는 표시되지 않음).
    async mediaSnapshot() {
      return page.evaluate(() => ({
        thumbs: [...document.querySelectorAll('img')].filter(i => i.alt === '생성된 동영상 썸네일' && i.getBoundingClientRect().width > 0).map(i => i.currentSrc || i.src),
        fails: (document.body.innerText.match(/동영상을 생성할 수 없습니다/g) || []).length,
        progress: (document.body.innerText.match(/[0-9]+\s*%/g) || []).slice(0, 3),
      }))
    },
    // before: 전송 전 mediaSnapshot(). 결과: { status: 'done', thumbSrc } | { status: 'failed', reason } | { status: 'timeout' }
    async waitForResult(before, { timeoutMs = 6 * 60 * 1000, intervalMs = 4000, onTick, shouldStop } = {}) {
      const seen = new Set(before.thumbs)
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        const snap = await this.mediaSnapshot()
        const fresh = snap.thumbs.filter(s => !seen.has(s))
        if (onTick) onTick({ sec: Math.round((Date.now() - t0) / 1000), thumbs: snap.thumbs.length, newThumbs: fresh.length, fails: snap.fails, progress: snap.progress })
        if (shouldStop && shouldStop()) return { status: 'cancelled' }
        if (snap.fails > before.fails) return { status: 'failed', reason: '동영상을 생성할 수 없습니다(Flow가 사유를 표시하지 않음, 요금 미청구)' }
        if (fresh.length) return { status: 'done', thumbSrc: fresh[0] }
        await sleep(intervalMs)
      }
      return { status: 'timeout' }
    },
    // 새 결과 타일을 열고 뷰어의 다운로드 버튼으로 "720p 원본 크기"를 받아 outPath에 저장한다(2026-09-20 실측).
    // 뷰어의 영상은 iframe 안에 있어 <video> 주소를 직접 읽을 수 없다. 다운로드 메뉴: 270p GIF / 720p 원본 크기 /
    // 1080p·4K 업스케일링(업그레이드 필요) — 항상 무료인 "720p 원본 크기"만 고른다. 임시 폴더로 받도록 다운로드 위치를
    // 잠깐 바꿨다가 반드시 원복한다. 반환: 저장 바이트 수
    async saveResult(thumbSrc, outPath, { timeoutMs = 90000 } = {}) {
      const browser = page.browser()
      const cdp = await browser.target().createCDPSession()
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowdl-'))
      let behaviorSet = false
      try {
        const pos = await page.evaluate((src) => { const i = [...document.querySelectorAll('img')].find(i => (i.currentSrc || i.src) === src); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, thumbSrc)
        if (!pos) throw new Error('결과 타일을 찾지 못했습니다')
        await page.mouse.click(pos.x, pos.y)
        let inViewer = false
        for (let i = 0; i < 15 && !inViewer; i++) { await sleep(1000); inViewer = await page.evaluate(() => document.body.innerText.includes('현재 시간')) }
        if (!inViewer) throw new Error('결과 뷰어가 열리지 않았습니다')

        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: tmpDir })
        behaviorSet = true
        const dl = await rectOf('download', 'exact', 'button')
        if (!dl) throw new Error('다운로드 버튼을 찾지 못했습니다')
        await page.mouse.click(dl.x, dl.y); await sleep(1500)
        const item = await rectOf('720p 원본 크기', 'includes', '[role="menuitem"], .mat-mdc-menu-item, button')
        if (!item) throw new Error('"720p 원본 크기" 메뉴를 찾지 못했습니다(메뉴 구조가 바뀜)')
        await page.mouse.click(item.x, item.y)

        // 다운로드 완료 대기(.crdownload가 사라지고 mp4가 생김)
        const t0 = Date.now()
        let got = null
        while (Date.now() - t0 < timeoutMs && !got) {
          await sleep(1000)
          const files = fs.readdirSync(tmpDir)
          if (files.some(f => /\.crdownload$|\.tmp$/i.test(f))) continue
          got = files.find(f => /\.mp4$/i.test(f)) || null
        }
        if (!got) throw new Error('다운로드 파일이 생기지 않았습니다')
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        fs.copyFileSync(path.join(tmpDir, got), outPath)
        return fs.statSync(outPath).size
      } finally {
        if (behaviorSet) { try { await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }) } catch { /* noop */ } }
        try { await cdp.detach() } catch { /* noop */ }
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
        // 메뉴가 열려 있으면 닫고 목록 화면으로 복귀
        try { await page.keyboard.press('Escape'); await sleep(500) } catch { /* noop */ }
        const back = await rectOf('arrow_back', 'exact', 'button')
        if (back) { await page.mouse.click(back.x, back.y); await sleep(1500) }
      }
    },
    // 브라우저(로그인 쿠키 포함) 안에서 영상 주소를 fetch해 파일로 저장한다. 반환: 저장한 바이트 수
    async saveVideo(src, outPath) {
      const b64 = await page.evaluate(async (src) => {
        const r = await fetch(src, { credentials: 'include' })
        if (!r.ok) throw new Error('영상 다운로드 HTTP ' + r.status)
        const buf = new Uint8Array(await r.arrayBuffer())
        let s = ''
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
        return btoa(s)
      }, src)
      const data = Buffer.from(b64, 'base64')
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, data)
      return data.length
    },
  }
  return kit
}
