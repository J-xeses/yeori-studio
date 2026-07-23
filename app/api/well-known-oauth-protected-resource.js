// RFC 9728 — /.well-known/oauth-protected-resource (vercel.json rewrite로 매핑됨)
export default function handler(_req, res) {
  const origin = 'https://yeori-studio.vercel.app'
  res.status(200).json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
  })
}
