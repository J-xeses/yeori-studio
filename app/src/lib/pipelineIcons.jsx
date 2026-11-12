// 워크벤치 노드 타이틀 아이콘 — 성준님이 2026-10-08 "파이프라인 회로도" 기획 아티팩트에서
// 커스텀 제작한 라인아이콘 세트(.icoWrap: 38px 박스 + 19px stroke 아이콘, currentColor)를
// 그대로 가져와 실제 코드로 반영. 2026-11-12: 그 디자인에 "표현효과 업그레이드" 요청 —
// 원본은 정적 데모(글로우 1개 고정)였지만, 여기서는 노드별 실측 상태(ok/warn/fail/active)에
// 따라 아이콘 박스 자체가 같이 반응하도록 확장(PipelineMonitorTab.module.css 의 .icoWrap 상태 규칙).
// 노드를 추가할 때는 여기에 키 하나만 추가하고 pipelineNodes.js 의 icon 필드에서 그 키를 쓰면 된다.
const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const PIPELINE_ICON_PATHS = {
  // 대본 생성 — 접힌 모서리 문서 + 텍스트 줄(원본 "대본 파서·생성" 아이콘 그대로)
  doc: (
    <>
      <path d="M6 3h9l4 4v14H6z" {...STROKE} />
      <path d="M15 3v4h4" {...STROKE} />
      <path d="M9 13h6M9 17h6M9 9h3" {...STROKE} />
    </>
  ),
  // 이미지 생성 — 사진 프레임 + 산맥(원본 "이미지 생성" 아이콘 그대로)
  photo: (
    <>
      <rect x="3" y="4" width="18" height="15" rx="2" {...STROKE} />
      <circle cx="9" cy="10" r="2" {...STROKE} />
      <path d="M3 16l5-4 4 3 4-5 5 6" {...STROKE} />
    </>
  ),
  // TTS — 스피커 + 음파 2겹(원본 "TTS 생성" 아이콘 그대로)
  speaker: (
    <>
      <path d="M3 10v4h3l4 4V6L6 10H3z" {...STROKE} />
      <path d="M15 9a3 3 0 010 6" {...STROKE} />
      <path d="M18 7a6 6 0 010 10" {...STROKE} />
    </>
  ),
  // 영상 생성 — 프레임 + 재생 삼각형(원본 "영상 생성" 아이콘 그대로)
  clapper: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" {...STROKE} />
      <path d="M10 9l6 3-6 3z" {...STROKE} />
    </>
  ),
  // 합성 — 다이아몬드 2단(원본 "합성" 아이콘 그대로)
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" {...STROKE} />
      <path d="M3 13l9 5 9-5" {...STROKE} />
    </>
  ),
  // 나레이션 미리듣기 — 헤드폰(원본에 없던 노드라 같은 스타일로 신규 제작)
  headphones: (
    <>
      <path d="M4 14v-2a8 8 0 0116 0v2" {...STROKE} />
      <rect x="2" y="14" width="4" height="6" rx="2" {...STROKE} />
      <rect x="18" y="14" width="4" height="6" rx="2" {...STROKE} />
    </>
  ),
  // 최종화 — 원 + 상승 화살표(원본 "G5 → 최종화" 아이콘 그대로)
  rocket: (
    <>
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="M12 7l4 5h-3v5h-2v-5H8z" {...STROKE} />
    </>
  ),
  // 체크업·퍼블리싱 — 원 + 체크(원본 "체크업 · 퍼블리싱" 아이콘 그대로)
  check: (
    <>
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="M8 12l3 3 5-6" {...STROKE} />
    </>
  ),
  // 트렌드레이더(외부 앱) — 레이더 화면: 바깥 원 + 안쪽 호 + 탐지선 + 포착 점(2026-11-12 같은 스타일로 신규 제작)
  radar: (
    <>
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="M12 7a5 5 0 105 5" {...STROKE} />
      <path d="M12 12l6-6" {...STROKE} />
      <circle cx="12" cy="12" r="1" {...STROKE} />
      <circle cx="16.5" cy="15.5" r="0.6" {...STROKE} />
    </>
  ),
  // 에이전트 앱 · Field Gate(외부 앱) — 사람 검토: 눈 + 눈동자 + 우하단 승인 체크(2026-11-12 같은 스타일로 신규 제작)
  review: (
    <>
      <path d="M2 11s3.5-6 10-6 10 6 10 6-1.2 2.1-3.6 3.8" {...STROKE} />
      <path d="M2 11s3.5 6 10 6c.5 0 1-.04 1.5-.1" {...STROKE} />
      <circle cx="12" cy="11" r="2.6" {...STROKE} />
      <path d="M15 18.5l2.2 2.2 4.3-4.6" {...STROKE} />
    </>
  ),
  // 에이전트 리더(pipeline-leader.js) — 지휘체계: 위의 리더 1 → 아래 에이전트 3 으로 갈라지는 지휘선(2026-11-12 같은 스타일로 신규 제작)
  conductor: (
    <>
      <circle cx="12" cy="5" r="2.4" {...STROKE} />
      <path d="M12 7.4v9.2" {...STROKE} />
      <path d="M5 16.6v-2.4a2 2 0 012-2h10a2 2 0 012 2v2.4" {...STROKE} />
      <circle cx="5" cy="18.6" r="1.8" {...STROKE} />
      <circle cx="12" cy="18.6" r="1.8" {...STROKE} />
      <circle cx="19" cy="18.6" r="1.8" {...STROKE} />
    </>
  ),

  // ── 워크벤치 좌측 아이콘 바(2026-11-12) — 노드 아이콘과 같은 24x24 stroke 스타일 ──
  // 전체 — 노드 3개가 배선으로 이어진 그래프
  railAll: (
    <>
      <rect x="2.5" y="4" width="7" height="5.5" rx="1.5" {...STROKE} />
      <rect x="14.5" y="4" width="7" height="5.5" rx="1.5" {...STROKE} />
      <rect x="8.5" y="14.5" width="7" height="5.5" rx="1.5" {...STROKE} />
      <path d="M9.5 6.75h5" {...STROKE} />
      <path d="M18 9.5v5.75a2 2 0 01-2 2h-.5" {...STROKE} />
    </>
  ),
  // 롱폼 — 가로(16:9) 화면 + 재생
  railLong: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" {...STROKE} />
      <path d="M10 9.5l5 2.5-5 2.5z" {...STROKE} />
    </>
  ),
  // 숏폼 — 세로(9:16) 화면 + 재생
  railShort: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" {...STROKE} />
      <path d="M10.5 9.5l4 2.5-4 2.5z" {...STROKE} />
    </>
  ),
  // 릴스 — 세로 화면 + 필름 띠(상단 사선) + 재생
  railReel: (
    <>
      <rect x="5.5" y="2" width="13" height="20" rx="3" {...STROKE} />
      <path d="M5.5 7.5h13" {...STROKE} />
      <path d="M9.5 2l2 5.5M13.5 2l2 5.5" {...STROKE} />
      <path d="M10.5 11.5l4 2.5-4 2.5z" {...STROKE} />
    </>
  ),
  // 포스트 — 정사각 사진
  railPost: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" {...STROKE} />
      <circle cx="9" cy="9" r="1.5" {...STROKE} />
      <path d="M4 16l4-4 3 3 4-5 5 6" {...STROKE} />
    </>
  ),
  // 편집 — 플러그 두 개를 잇는 배선
  railWire: (
    <>
      <circle cx="5" cy="6.5" r="2.2" {...STROKE} />
      <circle cx="19" cy="17.5" r="2.2" {...STROKE} />
      <path d="M7.2 6.5H10a3 3 0 013 3v5a3 3 0 003 3h.8" {...STROKE} />
    </>
  ),
}

export function NodeIcon({ name, className }) {
  const body = PIPELINE_ICON_PATHS[name]
  if (!body) return null
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block' }}>
      {body}
    </svg>
  )
}
