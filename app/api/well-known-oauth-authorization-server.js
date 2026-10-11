// RFC 8414 — /.well-known/oauth-authorization-server + RFC 9728 — /.well-known/oauth-protected-resource
// (둘 다 vercel.json rewrite로 이 한 함수에 매핑됨 — Hobby 플랜 서버리스 함수 12개 한도 때문에
// 2026-10-11 api/well-known-oauth-protected-resource.js 와 합침. req.url로 둘을 구분한다.)
// claude.ai 커스텀 커넥터가 이 메타데이터를 보고 OAuth 엔드포인트를 찾는다.
export default function handler(req, res) {
  const origin = 'https://yeori-studio.vercel.app'
  if (String(req.url || '').includes('protected-resource')) {
    return res.status(200).json({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
    })
  }
  res.status(200).json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
}
