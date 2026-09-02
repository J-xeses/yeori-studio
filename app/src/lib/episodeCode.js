// 정식 에피소드 코드 형식 검증/분해 — 클라이언트용.
// server/lib/episodeCode.js와 반드시 동일한 로직을 유지할 것.
//
// 형식: {SF|LF|IG|TK}_{E|T|P|R|S}{2자리+ 번호}[_{슬러그}]
//   SF_E01 (숏폼 에피소드) · LF_T01 (롱폼 트렌드) · IG_R02 (릴스) · IG_P01 (피드) …
//   폴더 경로(downloads/{platform}/{series}/{code}/)와 직결 — src/lib/mediaPaths.js parseCode 참고.
export const EPISODE_CODE_RE = /^(SF|LF|IG|TK)_([ETPRS])(\d{2,})(?:_([A-Z0-9]+))?$/
// 구 형식(IG_R_E02, X_E01…)도 당분간 허용 — 이미 만들어진 에피소드 호환용
const EPISODE_CODE_RE_LEGACY = /^([A-Z0-9_]+)_E(\d{2,})(?:_([A-Z0-9]+))?$/

export function validateEpisodeCode(code) {
  if (typeof code !== 'string' || !code.trim()) {
    return { valid: false, error: '에피소드 코드가 비어있습니다' }
  }
  if (!EPISODE_CODE_RE.test(code) && !EPISODE_CODE_RE_LEGACY.test(code)) {
    return { valid: false, error: `형식이 올바르지 않습니다 (예: SF_E01 · LF_T01 · IG_R02) — 입력값: ${code}` }
  }
  return { valid: true }
}

export function parseEpisodeCode(code) {
  const m = typeof code === 'string' ? code.toUpperCase().match(EPISODE_CODE_RE) : null
  if (m) return { contentType: m[1], kind: m[2], number: parseInt(m[3], 10), slug: m[4] || '' }
  const l = typeof code === 'string' ? code.toUpperCase().match(EPISODE_CODE_RE_LEGACY) : null
  if (l) return { contentType: l[1], kind: 'E', number: parseInt(l[2], 10), slug: l[3] || '' }
  return null
}

// { contentType, number, slug } → 정식 코드 문자열 조립 (예: "SF", 1, "SHOE" → "SF_E01_SHOE")
export function formatEpisodeCode(contentType, number, slug = '') {
  const n = String(number ?? 1).padStart(2, '0')
  const ct = contentType || 'LF'
  // contentType이 이미 종류를 담은 형태(IG_R, IG_P …)면 그대로 접두어로 → IG_R02.
  // 아니면(LF, SF) 에피소드 기본값 _E → LF_E01. (트렌드 _T 코드는 수동 입력)
  const base = /_/.test(ct) ? `${ct}${n}` : `${ct}_E${n}`
  const cleanSlug = (slug || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return cleanSlug ? `${base}_${cleanSlug}` : base
}

// UI 배지/파일명 등 "보여주기용" 코드 — episode.code가 있으면 그대로, 없으면(레거시)
// contentType+번호로 즉석 조립해서 항상 사람이 읽을 수 있는 형태로 보여준다.
export function displayEpisodeCode(episode) {
  return episode?.code || formatEpisodeCode(episode?.contentType, episode?.number)
}

// gpoints.json/MCP에서 실제 키로 쓰는 코드 — episode.code가 있으면 우선, 없으면(레거시, 예 ep4)
// 기존에 이미 gpoints.json에 기록된 과도기 키(String(number))를 그대로 써야 데이터가 안 끊긴다.
// server/lib/episodeCode.js의 resolveEpisodeCode와 동일한 우선순위를 유지할 것.
export function resolveEpisodeCode(episode, fallback = '') {
  return episode?.code || String(episode?.number ?? fallback)
}
