// api/gemini.js — Gemini 이미지 생성 프록시
// Vercel 서버(미국)를 통해 Google API 호출
// → 한국 네트워크 차단 우회!

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { prompt, apiKey } = req.body

  if (!prompt || !apiKey) {
    return res.status(400).json({ error: 'prompt와 apiKey가 필요합니다' })
  }

  // 모델 순서대로 시도
  const models = [
    'gemini-2.5-flash-image',          // Nano Banana (500장/일)
    'gemini-3.1-flash-image-preview',  // Nano Banana 2
    'gemini-3-pro-image-preview',      // Nano Banana Pro
  ]

  let lastError = null

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
          }),
        }
      )

      if (!response.ok) {
        const err = await response.json()
        lastError = err.error?.message || `API 오류 ${response.status}`
        console.log(`모델 ${model} 실패:`, lastError)
        continue // 다음 모델 시도
      }

      const data = await response.json()
      const parts = data.candidates?.[0]?.content?.parts || []
      const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'))

      if (!imgPart) {
        lastError = '이미지 데이터 없음'
        continue
      }

      // 성공!
      return res.status(200).json({
        success: true,
        model,
        imageData: imgPart.inlineData.data,
        mimeType: imgPart.inlineData.mimeType,
      })

    } catch (e) {
      lastError = e.message
      console.log(`모델 ${model} 예외:`, e.message)
    }
  }

  // 모든 모델 실패
  return res.status(500).json({
    success: false,
    error: lastError || '모든 모델 시도 실패',
  })
}
