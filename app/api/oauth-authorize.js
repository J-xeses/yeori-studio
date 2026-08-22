// /authorize (vercel.json rewrite로 매핑됨)
// 실제 사용자 계정 시스템이 없는 개인용 서버이므로, MCP_PUBLIC_SECRET을 아는 사람만
// 승인할 수 있도록 간단한 비밀키 입력 폼으로 대체한다. 승인되면 PKCE code_challenge를
// 포함한 authorization code를 서명해 발급하고 redirect_uri로 되돌려보낸다.
import { signAuthCode } from './_oauthUtil.js'

const PUBLIC_SECRET = process.env.MCP_PUBLIC_SECRET || ''

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

function renderForm({ client_id, redirect_uri, state, code_challenge, error }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>여리 스튜디오 접근 승인</title>
<style>
body{font-family:system-ui,-apple-system,'Noto Sans KR',sans-serif;background:#0b0b0f;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#16161d;border:1px solid #2a2a35;border-radius:12px;padding:32px;width:360px}
h1{font-size:16px;margin:0 0 16px;font-weight:700}
input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #333;background:#0e0e13;color:#eee;margin-bottom:12px;font-size:14px}
button{width:100%;padding:10px;border-radius:8px;border:none;background:#a78bfa;color:#000;font-weight:700;cursor:pointer;font-size:14px}
.err{color:#f87171;font-size:12px;margin-bottom:12px}
</style></head>
<body><div class="card">
<h1>🔒 여리 스튜디오 MCP 접근 승인</h1>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
<form method="POST" action="/authorize">
  <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
  <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}">
  <input type="hidden" name="state" value="${escapeHtml(state)}">
  <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
  <input type="password" name="secret" placeholder="MCP_PUBLIC_SECRET 입력" required autofocus>
  <button type="submit">승인</button>
</form>
</div></body></html>`
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { client_id, redirect_uri, state, code_challenge } = req.query
    if (!redirect_uri || !code_challenge) {
      res.status(400).send('redirect_uri, code_challenge 파라미터가 필요합니다')
      return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(renderForm({ client_id, redirect_uri, state, code_challenge }))
    return
  }

  if (req.method === 'POST') {
    let body = req.body
    if (typeof body === 'string') {
      try { body = Object.fromEntries(new URLSearchParams(body)) } catch { body = {} }
    }
    body = body || {}
    const { client_id, redirect_uri, state, code_challenge, secret } = body

    if (!redirect_uri || !code_challenge) {
      res.status(400).send('redirect_uri, code_challenge 파라미터가 필요합니다')
      return
    }

    if (!PUBLIC_SECRET || secret !== PUBLIC_SECRET) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.status(401).send(renderForm({ client_id, redirect_uri, state, code_challenge, error: '비밀키가 올바르지 않습니다' }))
      return
    }

    const code = signAuthCode({
      redirect_uri, code_challenge, client_id: client_id || '',
      exp: Date.now() + 5 * 60 * 1000,
    })
    const url = new URL(redirect_uri)
    url.searchParams.set('code', code)
    if (state) url.searchParams.set('state', state)
    res.writeHead(302, { Location: url.toString() })
    res.end()
    return
  }

  res.status(405).json({ error: 'method_not_allowed' })
}
