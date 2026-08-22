// 정식 에피소드 코드(예: "SF_E01_SHOE") 형식 검증/분해.
// 형식: {CONTENT_TYPE}_E{2자리 회차}[_{슬러그}]
//   - CONTENT_TYPE: 대문자/숫자/언더스코어 (SF, LF, IG_R, IG_P, IG_S, TK 등 콘텐츠 유형 접두사 —
//     IG_R처럼 자체에 언더스코어가 있는 유형도 있어 "맨 마지막 _E{숫자}" 앞부분을 통째로 잡는다)
//   - 회차: E01, E02... (2자리 이상 숫자)
//   - 슬러그: 선택, 대문자/숫자만 (예: SHOE)
// 이 정규식/파싱 로직은 src/lib/episodeCode.js(클라이언트)와 반드시 동일하게 유지할 것.

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

// code에서 { contentType, number, slug } 분해. 형식이 안 맞으면 null.
export function parseEpisodeCode(code) {
  const m = typeof code === 'string' ? code.match(EPISODE_CODE_RE) : null
  if (!m) return null
  return {
    contentType: m[1],
    number: parseInt(m[2], 10),
    slug: m[3] || '',
  }
}

// gpoints/MCP에서 실제 키로 쓸 코드를 결정 — episode.code(3차 정식 필드) 우선,
// 없으면(레거시 에피소드, 예 ep4) 기존 과도기 방식(String(number))으로, 그마저 없으면 episodeId로.
export function resolveEpisodeCode(episode, fallbackId) {
  return episode?.code || String(episode?.number ?? fallbackId)
}
