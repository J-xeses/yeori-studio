// Vite 개발 서버가 /api/* 요청을 외부 API로 프록시합니다 (vite.config.js)
// 별도 서버 없이 상대 경로만 사용하면 됩니다.

export const claudeMessages = (apiKey, body) =>
  fetch('/api/claude/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

// GET /v1/user → { subscription: { character_count, character_limit, ... } }
export const elUser = (apiKey) =>
  fetch('/api/elevenlabs/user', {
    headers: { 'xi-api-key': apiKey },
  })

export const elTTS = (apiKey, voiceId, body) =>
  fetch(`/api/elevenlabs/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

export const elVoices = (apiKey) =>
  fetch('/api/elevenlabs/voices', {
    headers: { 'xi-api-key': apiKey },
  })
