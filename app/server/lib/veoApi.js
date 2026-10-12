// Veo API(Gemini API) 호출 — "급할 때만" 쓰는 유료 비상 경로. 평소엔 scripts/flow-submit.js
// (무료 Flow 웹 크레딧, 브라우저 자동화)를 그대로 쓴다. 2026-10-12, REST 사양은
// ai.google.dev/gemini-api/docs/veo 실측 확인.
//
// Google AI Pro 구독은 이 API 호출엔 적용 안 됨(Flow 웹앱 전용) — 초당 별도 과금.

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

// 가격은 모델·해상도별 공개 요율(USD/초, 720p 기준). 실제 지출 기록(paidUsage.js)의 usdPerSec로 쓰임.
export const VEO_MODELS = {
  lite: { id: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', usdPerSec: 0.05 },
  fast: { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', usdPerSec: 0.10 },
  standard: { id: 'veo-3.1-generate-preview', label: 'Veo 3.1', usdPerSec: 0.40 },
}
export const VEO_DEFAULT_TIER = 'lite'
export const VEO_ALLOWED_DURATIONS = [4, 6, 8]

const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 5 * 60_000

function headers(apiKey) {
  return { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }
}

async function submit({ apiKey, modelId, prompt, startFrameBase64, mimeType, aspectRatio, durationSec }) {
  const instance = { prompt }
  if (startFrameBase64) {
    instance.image = { inlineData: { mimeType: mimeType || 'image/jpeg', data: startFrameBase64 } }
  }
  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: aspectRatio || '9:16',
      resolution: '720p',
      durationSeconds: String(durationSec),
      personGeneration: startFrameBase64 ? 'allow_adult' : 'allow_all',
    },
  }
  const r = await fetch(`${BASE_URL}/models/${modelId}:predictLongRunning`, {
    method: 'POST', headers: headers(apiKey), body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = (await r.text()).slice(0, 400)
    throw new Error(`Veo 제출 실패 HTTP ${r.status}: ${text}`)
  }
  const d = await r.json()
  if (!d.name) throw new Error(`Veo 제출 응답에 operation name 없음: ${JSON.stringify(d).slice(0, 300)}`)
  return d.name
}

async function pollUntilDone({ apiKey, operationName }) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE_URL}/${operationName}`, { headers: headers(apiKey) })
    if (!r.ok) throw new Error(`Veo 상태 조회 실패 HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    const d = await r.json()
    if (d.error) throw new Error(`Veo 생성 실패: ${d.error.message || JSON.stringify(d.error).slice(0, 300)}`)
    if (d.done) {
      const uri = d.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      if (!uri) throw new Error(`Veo 완료 응답에 video uri 없음: ${JSON.stringify(d).slice(0, 300)}`)
      return uri
    }
    await new Promise(res => setTimeout(res, POLL_INTERVAL_MS))
  }
  throw new Error(`Veo 생성 타임아웃(${POLL_TIMEOUT_MS / 1000}초 초과) — operation은 계속 진행 중일 수 있음: ${operationName}`)
}

async function download({ apiKey, uri }) {
  const r = await fetch(uri, { headers: headers(apiKey), redirect: 'follow' })
  if (!r.ok) throw new Error(`Veo 영상 다운로드 실패 HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

// { apiKey, tier?('lite'|'fast'|'standard'), prompt, startFrameBase64?, mimeType?, aspectRatio?, durationSec }
// → { buffer, modelId, tier, seconds, usdPerSec }
export async function generateVeoVideo({ apiKey, tier = VEO_DEFAULT_TIER, prompt, startFrameBase64, mimeType, aspectRatio, durationSec }) {
  if (!apiKey) throw new Error('Gemini API 키 없음(studio-secrets.json apiKeys.gemini)')
  if (!VEO_ALLOWED_DURATIONS.includes(Number(durationSec))) {
    throw new Error(`durationSec는 ${VEO_ALLOWED_DURATIONS.join('/')}초만 지원(요청: ${durationSec}초) — 10초 세그는 이 경로 미지원`)
  }
  const m = VEO_MODELS[tier] || VEO_MODELS[VEO_DEFAULT_TIER]
  const operationName = await submit({ apiKey, modelId: m.id, prompt, startFrameBase64, mimeType, aspectRatio, durationSec })
  const uri = await pollUntilDone({ apiKey, operationName })
  const buffer = await download({ apiKey, uri })
  return { buffer, modelId: m.id, tier, seconds: Number(durationSec), usdPerSec: m.usdPerSec }
}
