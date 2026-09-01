// ── 최종 조립 방식 ────────────────────────────────────────────────
// 'assemble' — assemble_making_film(ffmpeg concat)로 컷을 이어붙여 바로 완성.
//              인스타 릴스·틱톡처럼 빠른 전개가 핵심이고 정밀 연출이 소모적인 콘텐츠.
// 'cutter'   — cutter_input.json → CapCut 데스크톱에서 마무리(켄번스·트랜지션·색보정).
//              서여리 에피소드 시리즈처럼 서사 비중이 큰 콘텐츠.
//
// 에피소드에 finishMode가 명시돼 있으면 그 값, 없으면 contentType으로 유추:
//   LF(YouTube 롱폼) → 'cutter'  (서사 시리즈 홈)
//   그 외             → 'assemble'

export const FINISH_MODES = [
  { value: 'assemble', label: '빠른 조립 (ffmpeg)' },
  { value: 'cutter',   label: '정밀 편집 (CapCut)' },
]

export function resolveFinishMode(episode = {}) {
  if (episode.finishMode === 'assemble' || episode.finishMode === 'cutter') {
    return episode.finishMode
  }
  return (episode.contentType || '').toUpperCase() === 'LF' ? 'cutter' : 'assemble'
}
