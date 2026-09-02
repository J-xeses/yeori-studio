// 여리 스튜디오 산출물 URL 단일 소스 — 클라이언트용.
// server/lib/mediaPaths.js와 경로 규칙을 반드시 동기화할 것.
//
// 구조: /downloads/{BRAND}/{platform}/{series}/{code}/{NN_sub}/...
//   LF_T01 → seoyeori/YU/LF_T/LF_T01,  IG_R02 → seoyeori/IG/IG_R/IG_R02
//   패턴에 안 맞는 코드(TEST_OVERLAY 등) → seoyeori/_etc/{code}/{NN_sub}/

const YEORI_SERVER = 'http://localhost:3001'
const BRAND = 'seoyeori'   // server/lib/mediaPaths.js의 BRAND와 동기화

export function paddedCutNo(no) { return String(no).padStart(2, '0') }
export function cutFile(no, ext) { return `cut_${paddedCutNo(no)}.${ext}` }

// ── 코드 → 플랫폼/시리즈 ──────────────────────────────────────
const PLATFORM = { SF: 'YU', LF: 'YU', IG: 'IG', TK: 'TK' }
const CODE_RE = /^(SF|LF|IG|TK)_([A-Z])(\d{2,})(?:_[A-Z0-9]+)?$/
export function parseCode(code) {
  const m = String(code ?? '').trim().toUpperCase().match(CODE_RE)
  if (!m) return null
  return { content: m[1], kind: m[2], platform: PLATFORM[m[1]], series: `${m[1]}_${m[2]}` }
}

// episode 객체(또는 {code,number}, 문자열 코드) → 코드 문자열
export function resolveCode(episode) {
  if (episode == null) return 'ep0'
  if (typeof episode === 'string') return episode
  if (typeof episode === 'number') return `ep${episode}`
  return episode.code || `ep${episode.number}`
}
export const epKey = resolveCode

const SUBDIR = {
  script: '01_script', flow: '02_images', images: '02_images', audio: '03_audio',
  making: '04_making', video: '05_video',
  output: '06_publishing', publishing: '06_publishing', final: '07_output',
}

// 인스턴스 폴더 URL (서버 정적 라우트 기준)
export function instanceUrl(episode) {
  const code = resolveCode(episode)
  const p = parseCode(code)
  return p
    ? `${YEORI_SERVER}/downloads/${BRAND}/${p.platform}/${p.series}/${code}`
    : `${YEORI_SERVER}/downloads/${BRAND}/_etc/${code}`
}

// 에피소드별 산출물 디렉터리 URL
export function epMediaUrl(episode, kind) {
  return `${instanceUrl(episode)}/${SUBDIR[kind] || kind}`
}

export function cutMediaUrl(episode, kind, no, ext, suffix = '') {
  return `${epMediaUrl(episode, kind)}/cut_${paddedCutNo(no)}${suffix}.${ext}`
}

// 하위호환 별칭 (인자로 episode/code 아무거나)
export function flowUrl(ep, no, ext, suffix = '') { return cutMediaUrl(ep, 'images', no, ext, suffix) }
export function videoUrl(ep, no, ext = 'mp4') { return cutMediaUrl(ep, 'video', no, ext) }
export function audioUrl(ep, no, ext = 'mp3') { return cutMediaUrl(ep, 'audio', no, ext) }

// 인스타그램 콘텐츠(FD/RL/PT/ST) — 별도 "인스타 번호" 체계, 이번 개편에서 안 건드림.
export const INSTA_SUBDIR = { FD: 'raw', PT: 'raw', ST: 'raw', RL: null }
export const INSTA_RATIO  = { FD: '1:1', PT: '1:1', RL: '9:16', ST: '9:16' }

export function instaDir(content, num, kind) {
  const base = `${YEORI_SERVER}/downloads/insta/${content}/${num}`
  return kind ? `${base}/${kind}` : base
}
export function instaUrl(content, num, no, ext, suffix = '') {
  const kind = INSTA_SUBDIR[content]
  return `${instaDir(content, num, kind)}/cut_${paddedCutNo(no)}${suffix}.${ext}`
}
