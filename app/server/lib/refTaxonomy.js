// ── 레퍼런스 분류표(2026-11-06, 성준님 승인 초안) ─────────────────────────────
// 두 축으로 나눈다: 용도(어디에 쓰나) × 기법(어떻게 하나 = 대분류 → 세부).
// 기법 이름은 우리가 이미 가진 제작 도구(트랙매트·체인지 생성기·PIP·불릿타임)와 같은 말로 맞춰 둬서,
// 2단계(메인 파이프라인 연결) 때 "이 레퍼런스 → 이 도구"를 바로 이을 수 있게 한다.
// ref-grab.mjs(레퍼런스 보드)와 collectHub.js(수집함)가 같이 쓴다 — 바꿀 땐 여기 한 곳만.

export const USAGES = [
  '오프닝 훅·티저',
  '썸네일·후킹카드',
  '본편 컷 연출',
  '전환',
  '자막·타이포',
  '엔딩·CTA',
  '캐릭터 룩(의상·헤어)',
  '배경·공간',
  '프롬프트 레시피',
]

export const TECHNIQUES = {
  '카메라': ['오빗', '돌리', '줌', '탑뷰'],
  '타이포': ['키네틱 리빌', '손글씨', '스트레치 슬램'],
  '전환': ['매치컷', '휩팬', '트랙매트 마스크', '모핑'],
  '시간': ['불릿타임', '스피드램프', '루프'],
  '라이팅·컬러': ['네온', '골든아워', '컬러 그레이딩'],
  '합성·구도': ['PIP', '분할화면', '피규어화', '네거티브 스페이스'],
  'AI 전용': ['변신·체인지', '스타일 변환', '불가능한 물리'],
  '사운드': ['비트싱크', '무음 대비'],
}

// AI 프롬프트에 넣을 한 덩어리 설명
export function taxonomyPrompt() {
  return `용도(하나): ${USAGES.join(' / ')}\n` +
    `기법 대분류(하나) → 세부(하나, 목록에 없으면 짧게 새로 지어도 됨):\n` +
    Object.entries(TECHNIQUES).map(([k, v]) => `- ${k}: ${v.join(', ')}`).join('\n')
}

// AI 응답 값 정리. AI 가 "AI 전용 - 스타일"·"카메라 / 타이포"처럼 섞어 쓰는 경우가 있어서(11/6 실측) 필터가 쪼개지지 않게
// 목록에 있는 이름이 들어 있으면 그 이름(첫 번째)으로 맞춘다. 목록에 없는 값만 그대로 둔다(새 분류 발견 신호).
export function cleanClass(r = {}) {
  const s = (v, n) => String(v || '').trim().slice(0, n)
  const pick = (v, list) => { const t = String(v || ''); return list.map((x) => [x, t.indexOf(x)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0]?.[0] || '' }
  const rawT = String(r.technique || '')
  const technique = pick(rawT, Object.keys(TECHNIQUES)) || s(rawT, 12)
  let detail = s(r.detail ?? r.techDetail, 20)
  if (!detail && technique && rawT.length > technique.length) detail = s(rawT.replace(technique, '').replace(/^[\s\-–/›>,]+/, ''), 20)
  return { usage: pick(r.usage, USAGES) || s(r.usage, 20), technique, techDetail: detail }
}
