// RFC 8414 — /.well-known/oauth-authorization-server (vercel.json rewrite로 매핑됨)
// claude.ai 커스텀 커넥터가 이 메타데이터를 보고 OAuth 엔드포인트를 찾는다.
export default function handler(_req, res) {
  const origin = 'https://yeori-studio.vercel.app'
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
