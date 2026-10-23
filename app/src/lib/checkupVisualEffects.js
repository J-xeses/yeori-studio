// 체크업 탭 "비주얼 효과" 어휘 — server/proxy.js의 CHECKUP_COLOR_FILTERS/CHECKUP_OVERLAY_FILTERS와
// value가 동일해야 한다(값이 바뀌면 두 곳 다 같이 바꿀 것). PDF 13페이지 "마스킹 및 색상 수정 /
// 오버레이 및 이펙트(모션블러·필터링·스타일효과) / 프레임 동결(Freeze) / 역재생(Reverse)"
// 신규 구현(2026-10-23). 켄번스(kenBurnsEffects.js)는 "의도"만 저장해 CapCut 배치 때 나중에
// 적용되지만, 이 효과들은 선택 즉시 cut_NN.mp4 자체를 재인코딩한다 — CheckupEffectsSidebar 참고.
export const COLOR_MASK_EFFECTS = [
  { value: 'vignette', label: '비네트(마스킹)' },
  { value: 'bw', label: '흑백' },
  { value: 'sepia', label: '세피아' },
  { value: 'highContrast', label: '고대비' },
  { value: 'coolTone', label: '쿨톤' },
  { value: 'warmTone', label: '웜톤' },
  { value: 'vintage', label: '빈티지' },
]

export const OVERLAY_EFFECTS = [
  { value: 'motionBlur', label: '모션블러' },
  { value: 'softGlow', label: '소프트 필터' },
  { value: 'filmGrain', label: '필름 그레인' },
  { value: 'vhs', label: 'VHS 스타일' },
]
