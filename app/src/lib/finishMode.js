// ── 최종 조립 방식 ────────────────────────────────────────────────
// 'assemble' — assemble_making_film(ffmpeg concat)로 컷을 이어붙여 바로 완성.
//              인스타 릴스·틱톡처럼 빠른 전개가 핵심이고 정밀 연출이 소모적인 콘텐츠.
// 'cutter'   — 서여리 에피소드 시리즈처럼 서사 비중이 큰 콘텐츠(값 이름은 하위호환으로 유지).
//              2026-11-16(성준님 결정) 이전엔 cutter_input.json → CapCut 데스크톱에서
//              수동 마무리(켄번스·트랜지션·색보정)했으나, 오류·실패 반복 + 메이킹/체크업 탭이
//              사실상 그 역할을 대신하게 돼 CapCut 연동을 폐지 — 이제 'assemble'과 마찬가지로
//              EditMetaTab이 바로 최종 영상 조립(reelFinalize)까지 끝낸다. 정밀한 추가 편집이
//              필요하면 체크업 탭(타임라인 편집기)에서. send-to-cutter/run-cutter.js/CapCut
//              연동 코드 자체는 남아있지만 이 흐름에서 더 이상 호출되지 않는다.
//
// 에피소드에 finishMode가 명시돼 있으면 그 값, 없으면 contentType으로 유추:
//   LF(YouTube 롱폼) → 'cutter'  (서사 시리즈 홈)
//   그 외             → 'assemble'

export const FINISH_MODES = [
  { value: 'assemble', label: '빠른 조립 (ffmpeg)' },
  { value: 'cutter',   label: '최종 영상 조립 (서사형, CapCut 폐지)' },
]

export function resolveFinishMode(episode = {}) {
  if (episode.finishMode === 'assemble' || episode.finishMode === 'cutter') {
    return episode.finishMode
  }
  return (episode.contentType || '').toUpperCase() === 'LF' ? 'cutter' : 'assemble'
}
