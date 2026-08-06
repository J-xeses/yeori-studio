// api/gemini-proxy.js — 범용 Gemini 프록시 (Vercel 서버, 미국 경유)
// → 한국 네트워크 차단 우회. api/gemini.js(이미지 전용, 응답 파싱까지 함)와 달리
// 이건 contents/generationConfig를 호출부가 그대로 넘기고, 여러 모델을 순서대로
// 시도한 뒤 성공한 원본 응답을 그대로 돌려준다 — 텍스트(JSON 스키마) 호출과
// 이미지 생성 호출 양쪽 다 이걸로 처리 가능(로컬 스토리보드 생성기 등 외부 정적
// HTML 도구가 이 도메인의 /api/gemini-proxy 를 절대경로로 호출해서 사용).

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apiKey, models, contents, generationConfig } = req.body || {}

  if (!apiKey || !contents || !Array.isArray(models) || !models.length) {
    return res.status(400).json({ error: 'apiKey, contents, models[] 가 필요합니다' })
  }

  let lastError = null

  for (const model of models) {
    // 모델 하나가 응답 없이 멈춰있는 경우(TTS 프리뷰 모델에서 실측됨) Vercel 자체 타임아웃(300초)까지
    // 그냥 기다리지 않도록 자체 타임아웃을 걸어서, 안 되면 빨리 다음 모델로 넘어간다.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents, ...(generationConfig ? { generationConfig } : {}) }),
          signal: controller.signal,
        }
      )

      const data = await response.json()

      if (!response.ok || data.error) {
        lastError = data.error?.message || `HTTP ${response.status}`
        console.log(`[gemini-proxy] 모델 ${model} 실패:`, lastError)
        continue
      }

      return res.status(200).json({ success: true, model, data })
    } catch (e) {
      lastError = e.name === 'AbortError' ? `${model} 30초 응답 없음 (타임아웃)` : e.message
      console.log(`[gemini-proxy] 모델 ${model} 예외:`, lastError)
    } finally {
      clearTimeout(timer)
    }
  }

  return res.status(500).json({ success: false, error: lastError || '모든 모델 시도 실패' })
}
