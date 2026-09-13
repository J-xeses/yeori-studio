// 켄번스 효과 어휘 — server/proxy.js의 EI_KB_ALIAS/kenBurnsEffects, scripts/run-cutter.js의
// kenBurnsEffects/KB_EFFECTS와 동일한 값이어야 한다(값이 바뀌면 세 곳 다 같이 바꿀 것).
// 체크업 탭 효과 사이드바가 여기 값을 그대로 /api/checkup-effect에 보내 editMeta.json의
// editIntent.kenburns로 저장되고, run-cutter.js가 그대로 읽어 CapCut 키프레임을 만든다.
export const KEN_BURNS_EFFECTS = [
  { value: 'none', label: '없음' },
  { value: 'zoomIn', label: '줌인' },
  { value: 'zoomOut', label: '줌아웃' },
  { value: 'leftToRight', label: '좌→우 팬' },
  { value: 'rightToLeft', label: '우→좌 팬' },
  { value: 'topToBottom', label: '상→하 팬' },
  { value: 'bottomToTop', label: '하→상 팬' },
]

export function kenBurnsLabel(value) {
  return KEN_BURNS_EFFECTS.find(e => e.value === value)?.label || value || '없음'
}
