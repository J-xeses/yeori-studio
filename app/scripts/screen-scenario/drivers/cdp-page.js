// ── CdpPageDriver ───────────────────────────────────────────────────
// puppeteer 를 거치지 않고 "대상 탭 하나"의 CDP WebSocket 에만 직접 붙는다.
//   ws://127.0.0.1:9222/devtools/page/<targetId>
// puppeteer.connect() 는 브라우저 전체에 attach 하면서 Flow/ElevenLabs 의 수많은
// service_worker·stripe/recaptcha OOPIF 에 붙으려다 수 분씩 멈추는 사례가 있었다.
// 여기서는 페이지 레벨 CDP 도메인(Page/Runtime/Input/DOM)만 쓰므로 그 문제가 원천 차단된다.
//
// 지원 액션: goto, wait/sleep, waitFor, type, setValue, click, hover, scroll, key, screenshot
// 자체 녹화: Page.startScreencast 기반 (nativeRecorder)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Driver, sleep, humanType } from './base.js'

const DEBUG_PORT = 9222

// 도구 별칭 → 접속 URL + 기존 탭 판별 (puppeteer.js 의 TOOLS 와 동일 규칙)
const TOOLS = {
  flow: { url: 'https://labs.google/fx/ko/tools/flow', match: (u) => /labs\.google\/(fx|flow)/i.test(u) },
  elevenlabs: { url: 'https://elevenlabs.io/app/speech-synthesis', match: (u) => /elevenlabs\.io\/(app|sign)/i.test(u) },
}

function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-400)}`))))
  })
}

// ── 최소 CDP 클라이언트 (Node 전역 WebSocket) ──────────────────────
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('CDP WS 연결 15s 초과')), 15000)
      this.ws.addEventListener('open', () => { clearTimeout(to); resolve() }, { once: true })
      this.ws.addEventListener('error', (e) => { clearTimeout(to); reject(new Error('CDP WS 오류')) }, { once: true })
    })
    this.ws.addEventListener('message', (e) => this._onMessage(e.data))
    this.ws.addEventListener('close', () => { this._closed = true })
  }
  _onMessage(data) {
    let msg
    try { msg = JSON.parse(typeof data === 'string' ? data : data.toString()) } catch { return }
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id)
      clearTimeout(timer); this.pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'}`))
      else resolve(msg.result)
    } else if (msg.method) {
      for (const fn of this.handlers.get(msg.method) || []) { try { fn(msg.params) } catch { /* noop */ } }
    }
  }
  send(method, params = {}, timeoutMs = 30000) {
    if (this._closed) return Promise.reject(new Error('CDP 연결 종료됨'))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} ${timeoutMs}ms 초과`)) }
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(fn)
  }
  close() { try { this.ws.close() } catch { /* noop */ } }
}

async function fetchJson(url) {
  const r = await fetch(url)
  return r.json()
}

export class CdpPageDriver extends Driver {
  async setup(target = {}) {
    const port = this.opts.debuggingPort || DEBUG_PORT
    const key = typeof target === 'string' ? target : target.tool
    const tool = TOOLS[key]
    if (!tool) throw new Error(`CdpPageDriver: 모르는 target '${key}' (등록: ${Object.keys(TOOLS).join(', ')})`)

    // 디버깅 Chrome 확인
    let list
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`)
      list = await fetchJson(`http://127.0.0.1:${port}/json/list`)
    } catch {
      const e = new Error(`디버깅 Chrome(포트 ${port}) 연결 실패 — start_gen.bat 을 실행해 Chrome 을 띄우세요.`)
      e.hint = 'launch-debug-chrome'
      throw e
    }

    const wantUrl = target.url || (target.path ? new URL(target.path, tool.url).href : tool.url)
    let pageInfo = (list || []).find((t) => t.type === 'page' && tool.match(t.url || ''))

    if (pageInfo) {
      this.log(`기존 ${key} 탭에 CDP 직결: ${(pageInfo.url || '').slice(0, 70)}`)
    } else {
      // 새 탭 생성 (HTTP /json/new — PUT)
      this.log(`${key} 탭 없음 → 새 탭 생성 (${wantUrl})`)
      try {
        pageInfo = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(wantUrl)}`, { method: 'PUT' })).json()
      } catch {
        pageInfo = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(wantUrl)}`)).json()
      }
      await sleep(1500)
    }
    if (!pageInfo?.webSocketDebuggerUrl) throw new Error('대상 탭의 webSocketDebuggerUrl 을 못 얻음')

    this.cdp = new CDP(pageInfo.webSocketDebuggerUrl)
    await this.cdp.connect()
    this.targetId = pageInfo.id
    await this.cdp.send('Page.enable')
    await this.cdp.send('Runtime.enable')
    await this.cdp.send('DOM.enable').catch(() => {})
    await this.cdp.send('Page.bringToFront').catch(() => {})

    // device metrics 오버라이드는 하지 않는다 — 데스크톱 웹앱을 1080x1920 뷰포트로 강제하면
    // 레이아웃이 깨지고 스크린캐스트가 확대돼 잘린다. 창 크기 그대로 캡처하고 runner 의
    // normalize(scale+crop)가 컷 규격을 맞춘다.

    if (target.url || target.path) {
      const cur = pageInfo.url || ''
      if (!cur.startsWith(wantUrl.split('?')[0])) {
        await this.cdp.send('Page.navigate', { url: wantUrl })
        await this._waitLoad(target.timeout || 45000)
      }
    }
  }

  async _waitLoad(timeoutMs) {
    await Promise.race([
      new Promise((resolve) => this.cdp.on('Page.loadEventFired', resolve)),
      sleep(timeoutMs),
    ])
    await sleep(400)
  }

  // selectors 맵 → { css } | { xpath } | { text }
  #loc(selectors, key) {
    if (!key) return null
    const s = selectors?.[key]
    if (!s) throw new Error(`selectors 에 '${key}' 없음`)
    return typeof s === 'string' ? { css: s } : s
  }

  // 페이지 컨텍스트에서 함수 실행 → 결과 값 반환
  async #eval(fnBody, ...args) {
    const expr = `(${fnBody})(${args.map((a) => JSON.stringify(a)).join(',')})`
    const r = await this.cdp.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true, userGesture: true,
    })
    if (r.exceptionDetails) throw new Error(`page eval: ${r.exceptionDetails.text || r.exceptionDetails.exception?.description || 'error'}`)
    return r.result?.value
  }

  // 요소 중심 좌표 (뷰포트 기준). 없으면 null. #waitFor 와 같은 탐색 로직을 공유한다.
  async #centerOf(loc) {
    return this.#eval(function (loc) {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      let el = null
      if (loc.css) {
        // 콤마 구분 후보를 순서대로 — 먼저 보이는 것
        for (const sel of loc.css.split(',').map((s) => s.trim())) {
          const found = [...document.querySelectorAll(sel)].find((n) => n.getClientRects().length)
          if (found) { el = found; break }
        }
        el = el || document.querySelector(loc.css)
      } else if (loc.xpath) {
        el = document.evaluate(loc.xpath, document, null, 9, null).singleNodeValue
      } else if (loc.text) {
        const t = norm(loc.text)
        // 1) 클릭 가능한 요소 중 텍스트/aria 포함 → 가장 작은(구체적인) 것
        const clickables = [...document.querySelectorAll('button, a, [role="button"], [type="submit"], [type="button"]')]
          .filter((n) => n.getClientRects().length && !n.disabled)
          .filter((n) => norm(n.innerText || n.textContent || n.value).includes(t) || norm(n.getAttribute('aria-label')).includes(t))
        clickables.sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight))
        el = clickables[0]
        // 2) 없으면 텍스트를 가진 리프 → 가장 가까운 클릭 가능한 조상
        if (!el) {
          const leaf = [...document.querySelectorAll('*')].reverse()
            .find((n) => n.children.length === 0 && n.getClientRects().length && norm(n.textContent).includes(t))
          el = leaf?.closest('button, a, [role="button"], [onclick]') || leaf
        }
      }
      if (!el) return null
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return null
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, loc)
  }

  // waitFor 는 centerOf 로 통일 — "찾았다"와 "클릭할 수 있다"가 어긋나지 않게.
  async #waitFor(loc, timeoutMs = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      if (await this.#centerOf(loc)) return true
      await sleep(250)
    }
    throw new Error(`waitFor 시간초과: ${JSON.stringify(loc)}`)
  }

  async #click(loc) {
    const c = await this.#centerOf(loc)
    if (!c) throw new Error(`클릭 대상 없음/보이지 않음: ${JSON.stringify(loc)}`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type, x: c.x, y: c.y, button: 'left', clickCount: 1, buttons: 1,
      })
      await sleep(30)
    }
  }

  async execute(step, selectors) {
    const a = step.action
    const loc = this.#loc(selectors, step.target)
    switch (a) {
      case 'goto':
        await this.cdp.send('Page.navigate', { url: step.url })
        await this._waitLoad(step.timeout || 45000)
        return
      case 'sleep':
      case 'wait':
        if (step.for && selectors?.[step.for]) { await this.#waitFor(this.#loc(selectors, step.for), step.timeout || 20000); return }
        await sleep(step.ms ?? 500)
        return
      case 'waitFor':
        await this.#waitFor(loc, step.timeout || 20000)
        return
      case 'type': {
        await this.#waitFor(loc, 15000)
        // 포커스 + (옵션) 기존 내용 비우기. React 컨트롤드 입력은 .value='' 로 안 지워지므로
        // execCommand(selectAll→delete)로 실제 편집 이벤트를 발생시킨다.
        await this.#eval(function (loc, clear) {
          const el = loc.css ? document.querySelector(loc.css.split(',')[0].trim())
            : loc.xpath ? document.evaluate(loc.xpath, document, null, 9, null).singleNodeValue : null
          if (!el) return
          el.focus()
          if (typeof el.click === 'function') el.click()
          if (clear) {
            try {
              if ('setSelectionRange' in el) el.setSelectionRange(0, (el.value || '').length)
              document.execCommand('selectAll', false, null)
              document.execCommand('delete', false, null)
            } catch (e) { /* noop */ }
          }
        }, loc, step.clear !== false)
        await sleep(150)
        // 한 글자씩 입력 이벤트 발생 (React 대응)
        await humanType(async (ch) => {
          await this.cdp.send('Input.insertText', { text: ch })
        }, step.text, step.cps ?? 18)
        return
      }
      case 'setValue':
        await this.#eval(function (loc, v) {
          const el = loc.css ? document.querySelector(loc.css)
            : loc.xpath ? document.evaluate(loc.xpath, document, null, 9, null).singleNodeValue : null
          if (!el) return
          const proto = Object.getPrototypeOf(el)
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          setter ? setter.call(el, v) : (el.value = v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }, loc, step.value)
        return
      case 'click':
        await this.#waitFor(loc, step.timeout || 15000)
        await this.#click(loc)
        return
      case 'hover': {
        const c = await this.#centerOf(loc)
        if (c) await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y })
        return
      }
      case 'scroll': {
        const by = step.by ?? 300
        const dur = step.duration ?? 0
        const css = loc?.css || null
        await this.#eval(async function (css, by, dur) {
          const node = css ? document.querySelector(css) : (document.scrollingElement || document.body)
          if (!node) return
          const steps = Math.max(1, Math.round(dur / 16))
          for (let i = 0; i < steps; i++) { node.scrollBy(0, by / steps); await new Promise((r) => setTimeout(r, 16)) }
          if (!dur) node.scrollBy(0, by)
        }, css, by, dur)
        return
      }
      case 'key': {
        const parts = String(step.keys).split('+').map((s) => s.trim())
        const main = parts[parts.length - 1]
        const modMap = { Control: 2, Alt: 1, Shift: 8, Meta: 4 }
        let modifiers = 0
        for (const m of parts.slice(0, -1)) modifiers |= (modMap[m] || 0)
        const keyMap = { Enter: '\r', Tab: '\t' }
        await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: main, modifiers, text: keyMap[main] })
        await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: main, modifiers })
        return
      }
      case 'screenshot': {
        const r = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 })
        fs.writeFileSync(step.path || `scenario_${step.name || Date.now()}.jpg`, Buffer.from(r.data, 'base64'))
        return
      }
      default:
        throw new Error(`CdpPageDriver: 모르는 action '${a}'`)
    }
  }

  async teardown() {
    this.cdp?.close()   // 탭은 닫지 않음
  }

  // Page.startScreencast 기반 — 렌더러 픽셀 직접. 하트비트로 정적 구간도 프레임 유지.
  nativeRecorder() {
    const cdp = () => this.cdp
    return {
      async start(outPath, { fps = 30, viewport } = {}) {
        this._outPath = outPath
        this._fps = fps
        this._tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdppage_'))
        this._frames = []
        this._n = 0
        this._t0 = Date.now()
        this._lastAt = 0
        const write = (b64) => {
          const ts = Date.now() - this._t0
          try {
            const file = path.join(this._tmp, `f_${String(++this._n).padStart(6, '0')}.jpg`)
            fs.writeFileSync(file, Buffer.from(b64, 'base64'))
            this._frames.push({ file, ts }); this._lastAt = ts
          } catch { /* noop */ }
        }
        cdp().on('Page.screencastFrame', async (p) => {
          write(p.data)
          try { await cdp().send('Page.screencastFrameAck', { sessionId: p.sessionId }) } catch { /* noop */ }
        })
        // maxWidth/Height 를 주지 않는다 — 창 네이티브 해상도로 캡처(데스크톱 웹앱이
        // 확대·왜곡되지 않게). 컷 규격(1080x1920)은 runner.normalize 가 scale+crop 으로.
        await cdp().send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 })
        const gap = 130
        this._hb = setInterval(async () => {
          if (Date.now() - this._t0 - this._lastAt < gap) return
          try {
            const r = await cdp().send('Page.captureScreenshot', { format: 'jpeg', quality: 80, optimizeForSpeed: true }, 8000)
            write(r.data)
          } catch { /* noop */ }
        }, gap)
      },
      async stop() {
        if (this._hb) { clearInterval(this._hb); this._hb = null }
        try { await cdp().send('Page.stopScreencast') } catch { /* noop */ }
        await sleep(400)
        const frames = this._frames || []
        if (frames.length < 2) throw new Error(`CDP screencast 프레임 ${frames.length}개 — 탭 비활성/미지원`)
        const list = path.join(this._tmp, 'frames.txt')
        let body = ''
        for (let i = 0; i < frames.length; i++) {
          const dur = i + 1 < frames.length
            ? Math.max(0.016, (frames[i + 1].ts - frames[i].ts) / 1000)
            : 1 / this._fps
          body += `file '${frames[i].file.replace(/\\/g, '/')}'\nduration ${dur.toFixed(3)}\n`
        }
        body += `file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'\n`
        fs.writeFileSync(list, body)
        await ffmpegRun(['-y', '-f', 'concat', '-safe', '0', '-i', list,
          '-vf', `fps=${this._fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', this._outPath])
        try { fs.rmSync(this._tmp, { recursive: true, force: true }) } catch { /* noop */ }
      },
    }
  }

  async windowBounds() { return null }
}
