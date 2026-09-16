// Vite 媛쒕컻 ?쒕쾭媛 /api/* ?붿껌???몃? API濡??꾨줉?쒗빀?덈떎 (vite.config.js)
// 蹂꾨룄 ?쒕쾭 ?놁씠 ?곷? 寃쎈줈留??ъ슜?섎㈃ ?⑸땲??

export const claudeMessages = (apiKey, body) =>
  fetch('http://localhost:3001/api/claude/v1/messages', {
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
  fetch('http://localhost:3001/api/elevenlabs/user', {
    headers: { 'xi-api-key': apiKey },
  })

export const elVoices = (apiKey) =>
  fetch('http://localhost:3001/api/elevenlabs/voices', {
    headers: { 'xi-api-key': apiKey },
  })

export const elTTS = (apiKey, voiceId, body) =>
  fetch(`http://localhost:3001/api/elevenlabs/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// 무료 TTS (MS Edge read-aloud). voiceId 는 'ko-KR-SunHiNeural' 형태(접두사 없이).
// ElevenLabs 와 동일하게 audio/mpeg Response 를 돌려준다.
export const freeTTS = (voiceId, text, rate = 0) =>
  fetch('http://localhost:3001/api/free-tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voiceId, text, rate }),
  })

// ── ElevenLabs 부가기능 5종 (2026-09-16) ──────────────────────────────
// Instant Voice Cloning — audioFile(오디오 샘플) → { voice_id, requires_verification }
export const elCloneVoice = (apiKey, name, audioFile) =>
  fetch(`http://localhost:3001/api/elevenlabs/voices/add?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': audioFile.type || 'audio/mpeg' },
    body: audioFile,
  })

// Sound Effects 생성 — 텍스트 설명 → audio/mpeg Response
export const elSoundEffect = (apiKey, { text, duration_seconds, loop, prompt_influence }) =>
  fetch('http://localhost:3001/api/elevenlabs/sound-effects', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ text, duration_seconds, loop, prompt_influence }),
  })

// 생성된 SFX blob을 라이브러리(_shared/sfx/_generated/)에 저장
export const saveGeneratedSfx = (blob, filename) =>
  fetch(`http://localhost:3001/api/save-generated-sfx?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/mpeg' },
    body: blob,
  })

// Voice Isolator — audioFile/blob(잡음 섞인 원본) → audio/mpeg Response(정리된 오디오)
export const elIsolateVoice = (apiKey, audioFile) =>
  fetch('http://localhost:3001/api/elevenlabs/audio-isolation', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': audioFile.type || 'audio/mpeg' },
    body: audioFile,
  })

// Speech-to-Text — audioFile/blob → { text, words[], language_code, ... }
export const elSpeechToText = (apiKey, audioFile) =>
  fetch('http://localhost:3001/api/elevenlabs/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': audioFile.type || 'audio/mpeg' },
    body: audioFile,
  })
