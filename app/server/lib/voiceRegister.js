// 목소리 결(register) — 같은 서여리라도 "누구에게 말하느냐"에 따라 어조가 다르다(2026-09-21 성준님 구상).
//   viewer : 시청자 대상 · 나레이션 — 차분하고 또렷한 원본 느낌(현재 TTS 탭 서여리 값 = 안정성 45·유사도 75·속도 0.9)
//   friend : 아주 친한 친구들과의 대화 — 텐션이 올라가고 격식 없이 빠르고 생동감 있게
// 적용 지점: ① Veo 영상 프롬프트의 "Vocal delivery" 문장(scripts/flow-submit.js)  ② STS 음성 변환 설정(server/proxy.js STS 엔드포인트)
// 결 판정 규칙(cutRegister): 컷에 register 필드가 있으면 그것 → 없으면 CH 에 다른 인물(HJ/지아)이 함께 있으면 friend → 그 외 viewer.
// friend 의 수치는 기존 서여리 TTS 스타일(v1: 안정성 30 · 유사도 78, downloads/seoyeori/characters/voice_presets.json)을 바탕으로 잡은 초깃값 — 귀로 확인하며 조정한다.
export const REGISTERS = {
  viewer: {
    label: '시청자 대상·나레이션 (차분·원본 느낌)',
    delivery: 'Vocal delivery: calm, warm, composed and clear, speaking directly to the audience at a natural relaxed pace.',
    sts: null,   // null = 기존 동작(TTS 탭의 서여리 미세조정 값을 그대로 사용)
  },
  friend: {
    label: '친한 친구와의 대화 (텐션↑·격식 없음)',
    delivery: 'Vocal delivery: excited, high-energy, casual and informal, like chatting with her closest friend — quick, lively, with lots of expressive intonation and natural laughter.',
    sts: { stability: 0.30, similarity_boost: 0.75 },   // 안정성을 낮춰 억양 변화·감정 폭을 넓힘
  },
}

export function cutRegister(cut) {
  const explicit = String(cut?.register || '').toLowerCase()
  if (explicit === 'viewer' || explicit === 'friend') return explicit
  const ch = String(cut?.masterCode?.ch || '')
  const hasOther = /\b(HJ|HJ_[A-Z]+)\b|지아|JIA/i.test(ch)
  return hasOther ? 'friend' : 'viewer'
}
