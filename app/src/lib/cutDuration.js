// ── 컷 길이 단일 규칙 ──────────────────────────────────────────────
// 메이킹 탭(cut_NN.mp4 만들 때 -t 값)과 편집 메타(타임라인·SRT 계산)가 같은 값을
// 쓰도록 한 곳에 모은다. 예전엔 메이킹 탭이 `cut.duration || 5`, 편집 메타가
// `cut.sec || cut.duration || estimateDuration(script)` 라 DU 필드가 비면 두 단계가
// 서로 다른 길이를 가정해 자막이 밀렸다.

// 대본 글자 수 → 초 (한국어 낭독 ≈ 300자/분). 최소 4초.
export function estimateDuration(text = '') {
  const chars = String(text).replace(/\s/g, '').length
  return Math.max(4, Math.round((chars / 300) * 60))
}

// 컷의 확정 길이(초). 우선순위: 명시 sec → 명시 duration → 대본 추정 → 5초.
export function cutDuration(cut = {}) {
  const explicit = Number(cut.sec) || Number(cut.duration)
  if (explicit > 0) return explicit
  const script = cut.script || cut.text || cut.narration || cut.dialogue || ''
  return script ? estimateDuration(script) : 5
}
