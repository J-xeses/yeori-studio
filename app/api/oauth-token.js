// /token (vercel.json rewrite로 매핑됨)
// authorization_code: PKCE(code_verifier ↔ code_challenge) 검증 후 access_token 발급.
// 발급하는 access_token은 별도 토큰 체계 없이 MCP_PUBLIC_SECRET 그 자체를 재사용한다
// (api/mcp.js가 Authorization: Bearer 헤더로 이 값을 받으면 통과시킴).
import { verifyAuthCode, verifyPkce } from './_oauthUtil.js'

const PUBLIC_SECRET = process.env.MCP_PUBLIC_SECRET || ''

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  let body = req.body
  if (typeof body === 'string') {
    try { body = Object.fromEntries(new URLSearchParams(body)) } catch { body = {} }
  }
  body = body || {}

  if (body.grant_type === 'refresh_token') {
    return res.status(200).json({ access_token: PUBLIC_SECRET, token_type: 'Bearer', expires_in: 31536000 })
  }

  if (body.grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' })
  }

  const payload = verifyAuthCode(body.code)
  if (!payload) {
    return res.status(400).json({ error: 'invalid_grant', error_description: '인증 코드가 유효하지 않거나 만료됨' })
  }
  if (payload.redirect_uri !== body.redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri 불일치' })
  }
  if (!verifyPkce(body.code_verifier, payload.code_challenge)) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE 검증 실패' })
  }

  res.status(200).json({ access_token: PUBLIC_SECRET, token_type: 'Bearer', expires_in: 31536000 })
}
