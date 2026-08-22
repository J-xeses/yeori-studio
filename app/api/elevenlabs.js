// Vercel Serverless Function
// /api/elevenlabs/[...path] → https://api.elevenlabs.io/v1/[...path]

export default async function handler(req, res) {
  const apiKey = req.headers['xi-api-key']
  if (!apiKey) {
    return res.status(400).json({ error: 'ElevenLabs API key required' })
  }

  // URL에서 /api/elevenlabs 이후 경로 추출
  const path = req.url.replace(/^\/api\/elevenlabs/, '')
  const targetUrl = `https://api.elevenlabs.io/v1${path}`

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'xi-api-key': apiKey,
        'content-type': req.headers['content-type'] || 'application/json',
      },
    }

    if (req.method !== 'GET' && req.body) {
      fetchOptions.body = JSON.stringify(req.body)
    }

    const response = await fetch(targetUrl, fetchOptions)

    // 오디오 응답 처리 (TTS)
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('audio')) {
      const buffer = await response.arrayBuffer()
      res.setHeader('content-type', contentType)
      res.setHeader('content-length', buffer.byteLength)
      return res.status(response.status).send(Buffer.from(buffer))
    }

    const data = await response.json()
    return res.status(response.status).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
