// Vercel Serverless Function — 모바일 상황실(/mobile) 리버스 프록시
// 실제 페이지/데이터는 성준님 PC의 proxy.js(server/proxy.js, server/pages/mobile.html)에
// 있고, 이 함수는 api/mcp.js와 똑같은 방식(Edge Config → Cloudflare Tunnel)으로 중계만 한다.
// vercel.json 의 rewrite("/mobile", "/mobile/:path*")가 이 함수로 들어오게 해준다.

const EDGE_CONFIG = process.env.EDGE_CONFIG || ''
const ENV_BRIDGE_URL = process.env.MCP_BRIDGE_URL || ''
const ACCESS_CODE = process.env.MOBILE_ACCESS_CODE || ''

// api/mcp.js 의 resolveBridgeUrl()과 동일 로직(의도적 중복 — mcp.js는 손대지 않음).
let _bridgeCache = { url: '', at: 0 }
async function resolveBridgeUrl() {
  const now = Date.now()
  if (_bridgeCache.url && now - _bridgeCache.at < 5000) return _bridgeCache.url
  if (EDGE_CONFIG) {
    try {
      const u = new URL(EDGE_CONFIG)
      const r = await fetch(`${u.origin}${u.pathname}/item/mcpBridgeUrl${u.search}`, {
        signal: AbortSignal.timeout(3000),
      })
      if (r.ok) {
        const val = await r.json()
        if (typeof val === 'string' && val) {
          _bridgeCache = { url: val, at: now }
          return val
        }
      }
    } catch { /* Edge Config 실패 → env 폴백 */ }
  }
  return ENV_BRIDGE_URL
}

const PIN_PAGE = (wrong) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>모바일 상황실</title>
<style>body{font-family:system-ui;background:#111;color:#eee;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0}form{text-align:center}input{font-size:18px;padding:10px;
border-radius:8px;border:1px solid #444;background:#222;color:#eee}button{font-size:18px;padding:10px 16px;
margin-left:8px;border-radius:8px;border:none;background:#4a7;color:#fff}p{color:#f66}</style></head>
<body><form id="f"><div>🔒 PIN 입력</div>${wrong ? '<p>틀렸습니다</p>' : ''}
<input id="p" type="password" inputmode="numeric" autofocus><button>입장</button></div></form>
<script>
document.getElementById('f').onsubmit = (e) => {
  e.preventDefault()
  const pin = document.getElementById('p').value
  sessionStorage.setItem('mobilePin', pin)
  location.href = '/mobile?pin=' + encodeURIComponent(pin)
}
</script></body></html>`

export default async function handler(req, res) {
  if (ACCESS_CODE) {
    const given = req.query.pin || (req.headers['x-mobile-pin'] || '')
    if (given !== ACCESS_CODE) {
      res.status(401).setHeader('content-type', 'text/html; charset=utf-8')
      return res.send(PIN_PAGE(!!given))
    }
  }

  const bridgeUrl = await resolveBridgeUrl()
  if (!bridgeUrl) {
    return res.status(503).json({ error: '여리 스튜디오 로컬 서버에 연결하지 못했습니다 (터널 재연결 중일 수 있음, 30~60초 후 재시도)' })
  }

  // Vercel의 [[...path]].js 는 동적 세그먼트를 req.query.path 가 아니라
  // 리터럴 키 "[...path]" 로 넘긴다(일반 Functions 라우팅의 비표준 동작, 실측 확인함
  // 2026-10-11). 세그먼트가 0개인 요청(바로 /mobile)은 Vercel이 함수 호출 전에 404 처리해
  // 아예 안 들어오므로, vercel.json 이 그 경우를 synthetic 세그먼트 "page"로 보내준다.
  const raw = req.query['[...path]']
  const seg = Array.isArray(raw) ? raw.join('/') : (raw || '')
  const search = new URLSearchParams(req.query)
  search.delete('[...path]')
  search.delete('pin')
  const qs = search.toString()
  const targetPath = (seg === '' || seg === 'page') ? '/mobile' : `/mobile/${seg}`
  const target = `${bridgeUrl}${targetPath}${qs ? `?${qs}` : ''}`

  try {
    const r = await fetch(target, {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] || 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(20000),
    })
    const buf = Buffer.from(await r.arrayBuffer())
    res.status(r.status)
    const ct = r.headers.get('content-type')
    if (ct) res.setHeader('content-type', ct)
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: `중계 실패 (터널 재연결 중일 수 있음): ${e.message}` })
  }
}
