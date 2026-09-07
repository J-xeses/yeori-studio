// 무료 TTS (MS Edge read-aloud) 보이스 — voiceId 에 'free:' 접두사를 붙여
// ElevenLabs Voice ID 와 한 필드에서 구분한다. 상태 구조를 안 바꾸려는 선택.
//   ElevenLabs : 'RmYuvmCbqOMBJxDLW4k8'
//   무료       : 'free:ko-KR-SunHiNeural'

export const FREE_PREFIX = 'free:'

export const FREE_VOICES = [
  { id: 'free:ko-KR-SunHiNeural',               name: '선희 (여)',        gender: 'female' },
  { id: 'free:ko-KR-InJoonNeural',              name: '인준 (남)',        gender: 'male' },
  { id: 'free:ko-KR-HyunsuMultilingualNeural',  name: '현수 (남·다국어)', gender: 'male' },
]

export const isFreeVoice = (id) => typeof id === 'string' && id.startsWith(FREE_PREFIX)

// 'free:ko-KR-SunHiNeural' → 'ko-KR-SunHiNeural'
export const freeVoiceName = (id) => (isFreeVoice(id) ? id.slice(FREE_PREFIX.length) : id)

export const freeVoiceLabel = (id) =>
  FREE_VOICES.find(v => v.id === id)?.name || freeVoiceName(id)

// 슬라이더 speed(0.5~2.0, 1.0=기본) → Edge rate 퍼센트(-50 ~ +100)
export const speedToRate = (speed) => Math.round(((Number(speed) || 1) - 1) * 100)
