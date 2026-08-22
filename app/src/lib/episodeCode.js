// 정식 에피소드 코드(예: "SF_E01_SHOE") 형식 검증/분해 — 클라이언트용.
// server/lib/episodeCode.js와 반드시 동일한 로직을 유지할 것(정규식을 임의로 바꾸지 말 것).

export const EPISODE_CODE_RE = /^([A-Z0-9_]+)_E(\d{2,})(?:_([A-Z0-9]+))?$/

export function validateEpisodeCode(code) {
  if (typeof code !== 'string' || !code.trim()) {
    return { valid: false, error: '에피소드 코드가 비어있습니다' }
  }
  if (!EPISODE_CODE_RE.test(code)) {
    return { valid: false, error: `형식이 올바르지 않습니다 (예: SF_E01_SHOE) — 입력값: ${code}` }
  }
  return { valid: true }
}

export function parseEpisodeCode(code) {
  const m = typeof code === 'string' ? code.match(EPISODE_CODE_RE) : null
  if (!m) return null
  return {
    contentType: m[1],
    number: parseInt(m[2], 10),
    slug: m[3] || '',
  }
}

// { contentType, number, slug } → 정식 코드 문자열 조립 (예: "SF", 1, "SHOE" → "SF_E01_SHOE")
export function formatEpisodeCode(contentType, number, slug = '') {
  const n = String(number ?? 1).padStart(2, '0')
  const base = `${contentType || 'LF'}_E${n}`
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
