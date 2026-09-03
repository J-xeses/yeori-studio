// ── PuppeteerDriver ─────────────────────────────────────────────────
// 두 가지 모드:
//   (A) launch  — target 이 {url}|{html} 이면 새 Chrome을 headful로 띄움(격리, 로그인 없음)
//   (B) connect — target 이 "flow"|"elevenlabs" 문자열이면 이미 떠 있는 디버깅 Chrome
//       (--remote-debugging-port=9222, 로그인된 flow-automation 프로필)에 붙어서
//       해당 도구 탭을 찾거나 새로 연다. flow-automation.js connectBrowser() 패턴 재사용.
// 자체 녹화(page.screencast) 레코더도 제공.

import puppeteer from 'puppeteer-core'
import { Driver, sleep, humanType } from './base.js'
import * as mp from '../../../server/lib/mediaPaths.js'

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

// flow-automation.js connectBrowser() 그대로 — 디버깅 포트로 붙기
async function connectDebugChrome(port, log) {
  let version
  try {
    version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
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
  log(`Chrome 연결 (${version.Browser})`)
  return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl, defaultViewport: null, protocolTimeout: 300000 })
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
      this.browser = await connectDebugChrome(this.opts.debuggingPort || DEBUG_PORT, this.log)

      const pages = await this.browser.pages()
      const existing = pages.find((p) => tool.match(p.url()))
      const wantUrl = target.url || (target.path ? new URL(target.path, tool.url).href : tool.url)

      if (existing) {
        this.log(`기존 ${key} 탭 재사용: ${existing.url().slice(0, 70)}`)
        this.page = existing
        if (target.url || target.path) {
          await this.page.goto(wantUrl, { waitUntil: target.waitUntil || 'networkidle2', timeout: target.timeout || 60000 }).catch(() => {})
        }
      } else {
        this.log(`${key} 탭 없음 → 새 탭 (${wantUrl})`)
        this.page = await this.browser.newPage()
        await this.page.goto(wantUrl, { waitUntil: target.waitUntil || 'networkidle2', timeout: target.timeout || 60000 })
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

  nativeRecorder() {
    const page = () => this.page
    return {
      async start(outPath, { fps = 30 } = {}) {
        this._rec = await page().screencast({ path: outPath, fps })
      },
      async stop() { if (this._rec) await this._rec.stop() },
    }
  }

  async windowBounds() {
    try {
      const t = await this.browser.target().createCDPSession()
      const { windowId } = await t.send('Browser.getWindowForTarget')
      const { bounds } = await t.send('Browser.getWindowBounds', { windowId })
      return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
    } catch { return null }
  }
}
