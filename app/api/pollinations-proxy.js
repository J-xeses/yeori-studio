// api/pollinations-proxy.js — Pollinations.ai 이미지 생성 프록시 (Vercel 서버 경유)
// 브라우저에서 image.pollinations.ai를 fetch()로 직접 호출하면 Origin 헤더가 붙어서
// 봇 차단(403)에 걸림(2026-08-07 code_generator_v1.html 스케치 기능 개발 중 실측 확인) —
// 서버 간 fetch()는 Origin 헤더가 안 붙어서 통과. api/gemini-proxy.js와 동일한 목적/구조.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { prompt, width, height, seed } = req.query || {}
  if (!prompt) return res.status(400).json({ error: 'prompt가 필요합니다' })

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${encodeURIComponent(width || '640')}&height=${encodeURIComponent(height || '832')}` +
    `&nologo=true&seed=${encodeURIComponent(seed || String(Math.floor(Math.random() * 1e6)))}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      return res.status(502).json({ error: `Pollinations 오류 HTTP ${response.status}` })
    }
    const buf = Buffer.from(await response.arrayBuffer())
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.status(200).send(buf)
  } catch (e) {
    const msg = e.name === 'AbortError' ? '45초 넘게 응답 없음 (타임아웃)' : e.message
    return res.status(500).json({ error: msg })
  } finally {
    clearTimeout(timer)
  }
}
