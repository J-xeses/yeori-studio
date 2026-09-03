// ── PuppeteerDriver ─────────────────────────────────────────────────
// 두 가지 모드:
//   (A) launch  — target 이 {url}|{html} 이면 새 Chrome을 headful로 띄움(격리, 로그인 없음)
//   (B) connect — target 이 "flow"|"elevenlabs" 문자열이면 이미 떠 있는 디버깅 Chrome
//       (--remote-debugging-port=9222, 로그인된 flow-automation 프로필)에 붙어서
//       해당 도구 탭을 찾거나 새로 연다. flow-automation.js connectBrowser() 패턴 재사용.
// 자체 녹화(page.screencast) 레코더도 제공.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { Driver, sleep, humanType } from './base.js'
import * as mp from '../../../server/lib/mediaPaths.js'

function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-400)}`))))
  })
}

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = 9222            // flow-automation main 프로필과 동일
const PROFILE_DIR = mp.flowProfileDir('main')

// 도구 별칭 → 접속 URL + 기존 탭 판별
const TOOLS = {
  flow: {
    url: 'https://labs.google/fx/ko/tools/flow',
    match: (u) => /labs\.google\/(fx|flow)/i.test(u),
  },
  elevenlabs: {
    url: 'https://elevenlabs.io/app/speech-synthesis',
    match: (u) => /elevenlabs\.io\/(app|sign)/i.test(u),
  },
}

// flow-automation.js connectBrowser() 기반 — 디버깅 포트로 붙기.
// ★ /json/list 로 대상 탭을 먼저 찾고, targetFilter 로 puppeteer 가 그 탭 + 브라우저에만
//   CDP 세션을 붙이게 한다. 안 그러면 Flow/ElevenLabs 같은 무거운 SPA의 수많은
//   service_worker·iframe·OOPIF 타깃에 전부 attach 하느라 connect 가 수 분씩 걸린다(실측 8분+).
async function connectDebugChrome(port, tool, log) {
  let version, list
  try {
    version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  } catch {
    log('─'.repeat(52))
    log(`Chrome(디버깅 포트 ${port})에 연결 실패. 먼저 아래로 Chrome을 실행하세요:`)
    log(`  "${CHROME}" --remote-debugging-port=${port} --user-data-dir="${PROFILE_DIR}"`)
    log('  (이 프로필에 Google·ElevenLabs 계정 로그인해두면 이후 세션 유지. start_gen.bat도 이 방식)')
    log('─'.repeat(52))
    const e = new Error(`Chrome 디버깅 포트 ${port} 연결 실패`)
    e.hint = 'launch-debug-chrome'
    throw e
  }
  const pageInfo = (list || []).find((t) => t.type === 'page' && tool && tool.match(t.url || ''))
  log(`Chrome 연결 (${version.Browser})${pageInfo ? ' · 대상 탭 발견' : ' · 대상 탭 없음(새 탭 예정)'}`)
  const browser = await puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport: null,
    protocolTimeout: 60000,
    // 대상 도구 탭 + 새로 만들 빈 탭 + 브라우저만 attach. 나머지(다른 로그인 탭, 무수한
    // service_worker·iframe·OOPIF)는 제외 → connect 지연(실측 8분+) 제거. shape 은 버전따라
    // Target/TargetInfo 둘 다 올 수 있어 함수/속성 모두 대응.
    targetFilter: (t) => {
      const type = typeof t.type === 'function' ? t.type() : t.type
      if (type === 'browser') return true
      if (type !== 'page') return false
      const url = (typeof t.url === 'function' ? t.url() : t.url) || ''
      return !url || url === 'about:blank' || url.startsWith('chrome://') || (tool && tool.match(url))
    },
  })
  return { browser, pageInfo }
}

// connect 시 targetFilter 로 이미 대상 탭만 붙였으므로 pages()가 안전·빠름.
async function pickToolPage(browser, tool, pageInfo, log) {
  try {
    const pages = await Promise.race([
      browser.pages(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('pages() 20s 초과')), 20000)),
    ])
    return pages.find((x) => tool.match(x.url())) || null
  } catch (e) {
    log(`탭 조회 실패(${e.message}) → 새 탭으로`)
    return null
  }
}

export class PuppeteerDriver extends Driver {
  async setup(target = {}) {
    const vp = this.opts.viewport || { width: 1080, height: 1920 }

    // ── 모드 B: 도구 탭 접속 ──────────────────────────────────
    if (typeof target === 'string' || target.tool) {
      const key = typeof target === 'string' ? target : target.tool
      const tool = TOOLS[key]
      if (!tool) throw new Error(`모르는 target '${key}' (등록: ${Object.keys(TOOLS).join(', ')})`)
      this.connected = true
      const conn = await connectDebugChrome(this.opts.debuggingPort || DEBUG_PORT, tool, this.log)
      this.browser = conn.browser

      const existing = await pickToolPage(this.browser, tool, conn.pageInfo, this.log)
      const wantUrl = target.url || (target.path ? new URL(target.path, tool.url).href : tool.url)

      // SPA 도구(Flow·ElevenLabs)는 웹소켓/텔레메트리로 networkidle 에 거의 안 걸림 →
      // 기본 domcontentloaded. steps 앞머리의 wait/ waitFor 가 실제 준비를 보장.
      const wu = target.waitUntil || 'domcontentloaded'
      if (existing) {
        this.log(`기존 ${key} 탭 재사용: ${existing.url().slice(0, 70)}`)
        this.page = existing
        if (target.url || target.path) {
          await this.page.goto(wantUrl, { waitUntil: wu, timeout: target.timeout || 45000 }).catch((e) => this.log(`goto 경고: ${e.message.split('\n')[0]}`))
        }
      } else {
        this.log(`${key} 탭 없음 → 새 탭 (${wantUrl})`)
        this.page = await this.browser.newPage()
        await this.page.goto(wantUrl, { waitUntil: wu, timeout: target.timeout || 45000 }).catch((e) => this.log(`goto 경고: ${e.message.split('\n')[0]}`))
      }
      await this.page.bringToFront()
      await this.page.setViewport({ width: vp.width, height: vp.height }).catch(() => {})
      return
    }

    // ── 모드 A: 새 Chrome 띄우기 ──────────────────────────────
    const pos = this.opts.windowPosition || { x: 40, y: 40 }
    this.browser = await puppeteer.launch({
      executablePath: this.opts.chromePath || CHROME,
      headless: this.opts.headless ?? false,
      defaultViewport: null,
      args: [
        `--window-size=${vp.width},${vp.height}`,
        `--window-position=${pos.x},${pos.y}`,
        '--hide-scrollbars',
        ...(this.opts.userDataDir ? [`--user-data-dir=${this.opts.userDataDir}`] : []),
        ...(this.opts.chromeArgs || []),
      ],
    })
    this.page = (await this.browser.pages())[0] || await this.browser.newPage()
    await this.page.setViewport({ width: vp.width, height: vp.height })
    if (target.url) {
      this.log(`goto ${target.url}`)
      await this.page.goto(target.url, { waitUntil: target.waitUntil || 'networkidle2', timeout: target.timeout || 60000 })
    } else if (target.html) {
      await this.page.setContent(target.html, { waitUntil: 'networkidle0' })
    }
  }

  #resolve(selectors, targetKey) {
    if (!targetKey) return null
    const sel = selectors?.[targetKey]
    if (!sel) throw new Error(`selectors에 '${targetKey}' 없음`)
    if (typeof sel === 'string') return { css: sel }
    return sel   // { css } | { xpath } | { text }
  }

  async #find(loc, timeout = 15000) {
    if (loc.xpath) { await this.page.waitForSelector(`::-p-xpath(${loc.xpath})`, { timeout }); return await this.page.$(`::-p-xpath(${loc.xpath})`) }
    if (loc.text)  { const s = `::-p-text(${loc.text})`; await this.page.waitForSelector(s, { timeout }); return await this.page.$(s) }
    await this.page.waitForSelector(loc.css, { timeout })
    return await this.page.$(loc.css)
  }

  async execute(step, selectors) {
    const a = step.action
    const loc = this.#resolve(selectors, step.target)
    switch (a) {
      case 'goto':
        await this.page.goto(step.url, { waitUntil: step.waitUntil || 'networkidle2', timeout: step.timeout || 60000 })
        return
      case 'sleep':
      case 'wait':
        if (step.for === 'network-idle') { await this.page.waitForNetworkIdle({ timeout: step.timeout || 15000 }).catch(() => {}); return }
        if (step.for && selectors?.[step.for]) { await this.#find(this.#resolve(selectors, step.for), step.timeout || 20000); return }
        await sleep(step.ms ?? 500)
        return
      case 'waitFor': {
        const l = loc
        if (step.state === 'hidden') { await this.page.waitForSelector(l.css, { hidden: true, timeout: step.timeout || 20000 }) }
        else { await this.#find(l, step.timeout || 20000) }
        return
      }
      case 'type': {
        const el = await this.#find(loc)
        await el.click({ clickCount: 3 }).catch(() => {})
        await humanType((ch) => this.page.keyboard.type(ch), step.text, step.cps ?? 18)
        return
      }
      case 'setValue': {
        const el = await this.#find(loc)
        await el.evaluate((node, v) => { node.value = v; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })) }, step.value)
        return
      }
      case 'click': {
        const el = await this.#find(loc)
        await el.click({ delay: 40 })
        return
      }
      case 'hover': {
        const el = await this.#find(loc)
        await el.hover()
        return
      }
      case 'scroll': {
        const by = step.by ?? 300
        const dur = step.duration ?? 0
        const targetCss = loc?.css || null
        await this.page.evaluate(async (css, by, dur) => {
          const node = css ? document.querySelector(css) : (document.scrollingElement || document.body)
          if (!node) return
          const steps = Math.max(1, Math.round(dur / 16))
          for (let i = 0; i < steps; i++) { node.scrollBy(0, by / steps); await new Promise(r => setTimeout(r, 16)) }
          if (!dur) node.scrollBy(0, by)
        }, targetCss, by, dur)
        return
      }
      case 'key': {
        const parts = String(step.keys).split('+').map(s => s.trim())
        const mods = parts.slice(0, -1)   // Control, Alt, Shift, Meta
        const main = parts[parts.length - 1]
        for (const m of mods) await this.page.keyboard.down(m)
        await this.page.keyboard.press(main)
        for (const m of mods.reverse()) await this.page.keyboard.up(m)
        return
      }
      case 'screenshot':
        await this.page.screenshot({ path: step.path || `scenario_${step.name || Date.now()}.png` })
        return
      default:
        throw new Error(`PuppeteerDriver: 모르는 action '${a}'`)
    }
  }

  async teardown() {
    if (!this.browser) return
    // connect 모드는 사용자 Chrome이라 닫지 않고 연결만 해제
    if (this.connected) await this.browser.disconnect().catch(() => {})
    else await this.browser.close().catch(() => {})
  }

  // CDP Page.startScreencast 기반 자체 녹화.
  // ★ 렌더러가 그리는 "페이지 픽셀"을 직접 받아온다 — OS 창 z-order·포커스·다른 창(탐색기 등)이
  //   위에 겹쳐도, Chrome 창이 OS 최상위가 아니어도 무관. 탭이 자기 창에서 활성 탭이기만 하면 됨.
  //   (gdigrab 데스크톱 영역 캡처가 엉뚱한 창을 녹화하던 문제의 근본 해결책.)
  nativeRecorder() {
    const getPage = () => this.page
    return {
      async start(outPath, { fps = 30, viewport } = {}) {
        const page = getPage()
        await page.bringToFront().catch(() => {})          // 탭을 자기 창의 활성 탭으로
        this._outPath = outPath
        this._fps = fps
        this._tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpscreencast_'))
        this._frames = []
        this._n = 0
        this._t0 = Date.now()
        this._lastAt = 0
        this._session = await page.createCDPSession()
        const writeFrame = (b64) => {
          const ts = Date.now() - this._t0
          try {
            const file = path.join(this._tmp, `f_${String(++this._n).padStart(6, '0')}.jpg`)
            fs.writeFileSync(file, Buffer.from(b64, 'base64'))
            this._frames.push({ file, ts })
            this._lastAt = ts
          } catch { /* noop */ }
        }
        this._session.on('Page.screencastFrame', async (e) => {
          writeFrame(e.data)
          try { await this._session.send('Page.screencastFrameAck', { sessionId: e.sessionId }) } catch { /* noop */ }
        })
        await this._session.send('Page.startScreencast', {
          format: 'jpeg', quality: 85, everyNthFrame: 1,
          ...(viewport ? { maxWidth: viewport.width, maxHeight: viewport.height } : {}),
        })
        // 하트비트 — screencastFrame 은 화면이 바뀔 때만 온다. 정적인 wait 구간에도 최소
        // ~8fps 를 유지하도록 갭이 생기면 캡처를 강제(안 그러면 결과 영상이 실제보다 짧아짐).
        const gapMs = 130
        this._hb = setInterval(async () => {
          if (Date.now() - this._t0 - this._lastAt < gapMs) return
          try {
            const { data } = await this._session.send('Page.captureScreenshot', { format: 'jpeg', quality: 80, optimizeForSpeed: true })
            writeFrame(data)
          } catch { /* noop */ }
        }, gapMs)
      },
      async stop() {
        if (this._hb) { clearInterval(this._hb); this._hb = null }
        try { await this._session.send('Page.stopScreencast') } catch { /* noop */ }
        await sleep(400)                                    // 남은 프레임 수신 대기
        try { await this._session.detach() } catch { /* noop */ }
        const frames = this._frames || []
        if (frames.length < 2) {
          throw new Error(`CDP screencast: 프레임 ${frames.length}개 — 탭이 비활성/discarded 이거나 스크린캐스트 미지원`)
        }
        // 실제 수신 타임스탬프로 프레임별 지속시간을 만들어 concat → 고정 fps로 정규화
        const list = path.join(this._tmp, 'frames.txt')
        let body = ''
        for (let i = 0; i < frames.length; i++) {
          const dur = i + 1 < frames.length
            ? Math.max(0.016, (frames[i + 1].ts - frames[i].ts) / 1000)
            : 1 / this._fps
          const fp = frames[i].file.replace(/\\/g, '/')
          body += `file '${fp}'\nduration ${dur.toFixed(3)}\n`
        }
        body += `file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'\n`
        fs.writeFileSync(list, body)
        await ffmpegRun(['-y', '-f', 'concat', '-safe', '0', '-i', list,
          '-vf', `fps=${this._fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart', this._outPath])
        try { fs.rmSync(this._tmp, { recursive: true, force: true }) } catch { /* noop */ }
      },
    }
  }

  async windowBounds() {
    try {
      // 페이지 타깃 기준으로 창을 특정(connect 모드에서 브라우저 타깃은 엉뚱한 창을 줄 수 있음)
      const t = await this.page.target().createCDPSession()
      const targetId = this.page.target()._targetId
      const { windowId } = await t.send('Browser.getWindowForTarget', targetId ? { targetId } : {})
      const { bounds } = await t.send('Browser.getWindowBounds', { windowId })
      await t.detach().catch(() => {})
      // 클라이언트 영역만 잡도록 타이틀바/테두리 약간 보정
      return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
    } catch { return null }
  }
}
