// OAuth 스텁 서버가 공유하는 서명/검증 유틸.
// 상태를 서버에 저장하지 않고(Vercel 서버리스는 인스턴스 간 메모리 공유 불가),
// authorization code 자체에 필요한 정보를 담아 HMAC 서명해 무상태로 검증한다.
import crypto from 'crypto'

const SIGNING_SECRET = process.env.MCP_BRIDGE_SECRET || process.env.MCP_PUBLIC_SECRET || 'yeori-oauth-fallback'

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function signAuthCode(payload) {
  const data = base64url(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const sig = base64url(crypto.createHmac('sha256', SIGNING_SECRET).update(data).digest())
  return `${data}.${sig}`
}

export function verifyAuthCode(code) {
  const [data, sig] = String(code || '').split('.')
  if (!data || !sig) return null
  const expected = base64url(crypto.createHmac('sha256', SIGNING_SECRET).update(data).digest())
  if (sig !== expected) return null
  try {
    const json = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const payload = JSON.parse(json)
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export function verifyPkce(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false
  const hash = base64url(crypto.createHash('sha256').update(codeVerifier).digest())
  return hash === codeChallenge
}
