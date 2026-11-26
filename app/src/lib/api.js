// Vite 媛쒕컻 ?쒕쾭媛 /api/* ?붿껌???몃? API濡??꾨줉?쒗빀?덈떎 (vite.config.js)
// 蹂꾨룄 ?쒕쾭 ?놁씠 ?곷? 寃쎈줈留??ъ슜?섎㈃ ?⑸땲??

// 2026-11-26 추가(성준님 제보 — "편집메타 'on' 실행이 '실행 중...'에서 완료되지 않고 계속
// 돈다"): 이 탭의 자동실행(runACC)은 ①단계로 이 claudeMessages를 제일 먼저 기다리는데,
// fetch엔 원래 타임아웃이 없어서 — 이 세션 중 server/proxy.js를 몇 차례 강제 재시작한 것처럼
// 요청이 떠 있는 도중 서버가 죽으면(또는 네트워크가 끊기면) 응답도 에러도 영원히 안 와서
// await가 무한히 멈춘다(버튼은 accRunning===true로 고정, catch도 안 타서 에러 메시지도
// 안 뜸). AbortController로 상한 시간을 둬서, 서버가 끊긴 경우에도 일정 시간 뒤엔 반드시
// 에러로 떨어지게 한다 — 버튼이 영원히 "실행 중..."으로 멈추는 일 자체를 막는 안전장치.
function fetchWithTimeout(url, opts = {}, ms = 45000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...opts, signal: controller.signal })
    .catch((err) => {
      if (err.name === 'AbortError') {
        throw new Error(`${Math.round(ms / 1000)}초 안에 응답이 없어 요청을 중단함(서버 재시작·네트워크 끊김 가능성)`)
      }
      throw err
    })
    .finally(() => clearTimeout(timer))
}

export const claudeMessages = (apiKey, body) =>
  fetchWithTimeout('http://localhost:3001/api/claude/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }, 45000)

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

// 컷 영상(cut_NN.mp4)의 [start,end] 구간 오디오만 새 오디오로 교체 — audioBlob: TTS 결과(mp3)
export const replaceCutAudioSegment = (epNum, cutNo, start, end, audioBlob) =>
  fetch(`http://localhost:3001/api/replace-cut-audio-segment?epNum=${epNum}&cutNo=${cutNo}&start=${start}&end=${end}`, {
    method: 'POST',
    headers: { 'content-type': audioBlob.type || 'audio/mpeg' },
    body: audioBlob,
  })
