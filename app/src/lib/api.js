// Vite 媛쒕컻 ?쒕쾭媛 /api/* ?붿껌???몃? API濡??꾨줉?쒗빀?덈떎 (vite.config.js)
// 蹂꾨룄 ?쒕쾭 ?놁씠 ?곷? 寃쎈줈留??ъ슜?섎㈃ ?⑸땲??

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

// GET /v1/user ??{ subscription: { character_count, character_limit, ... } }
export const elUser = (apiKey) =>
  fetch('/api/elevenlabs/user', {
    headers: { 'xi-api-key': apiKey },
  })

export const elVoices = (apiKey) =>
  fetch('/api/elevenlabs/voices', {
    headers: { 'xi-api-key': apiKey },
  })

export const elTTS = (apiKey, voiceId, body) =>
  fetch(`/api/elevenlabs/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
