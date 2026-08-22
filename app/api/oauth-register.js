// RFC 7591 — Dynamic Client Registration (/register, vercel.json rewrite로 매핑됨)
// 단일 사용자 개인 서버라 클라이언트를 영속 저장하지 않고 매 요청마다 client_id만
// 새로 발급해 그대로 에코한다. 실제 접근 통제는 /authorize 단계의 비밀키 확인이 담당.
import crypto from 'crypto'

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const body = req.body || {}
  res.status(201).json({
    client_id: crypto.randomBytes(16).toString('hex'),
    client_name: body.client_name || 'yeori-studio client',
    redirect_uris: body.redirect_uris || [],
    grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
    response_types: body.response_types || ['code'],
    token_endpoint_auth_method: 'none',
  })
}
