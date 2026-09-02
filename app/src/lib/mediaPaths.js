// 여리 스튜디오 산출물 URL 단일 소스 — 클라이언트용.
// server/lib/mediaPaths.js와 HIER 플래그·키 규칙을 반드시 동기화할 것.
//
// 2단계(HIER=false): /downloads/<kind>/ep<number>/... (기존 평면 구조)
// 3단계(HIER=true):  /downloads/episodes/<code>/<sub>/...  (폴더 키 = episode.code)

const YEORI_SERVER = 'http://localhost:3001'

// ⚠️ 3단계 스위치. server/lib/mediaPaths.js의 HIER과 동시에 바꿀 것.
export const HIER = false

export function paddedCutNo(no) { return String(no).padStart(2, '0') }
export function cutFile(no, ext) { return `cut_${paddedCutNo(no)}.${ext}` }

// episode 객체(또는 {code,number}) → 폴더 키
export function epKey(episode) {
  if (episode == null) return 'ep0'
  if (typeof episode === 'number' || /^\d+$/.test(String(episode))) {
    return HIER ? `ep${episode}` : `ep${episode}`   // 클라는 number→code 조회 불가, 아래 객체형 사용 권장
  }
  if (typeof episode === 'string') {
    const m = episode.match(/^ep?(\d+)$/i)
    return m ? `ep${m[1]}` : episode
  }
  const { code, number } = episode
  if (HIER && code) return code
  return `ep${number}`
}

const SUB = { flow: 'images', images: 'images', audio: 'audio', video: 'video', making: 'making', output: 'output', final: 'final' }

// 에피소드별 산출물 디렉터리 URL (서버 정적 라우트 기준)
export function epMediaUrl(episode, kind) {
  const key = epKey(episode)
  if (HIER) return `${YEORI_SERVER}/downloads/episodes/${key}/${SUB[kind] || kind}`
  const flat = kind === 'images' ? 'flow' : kind
  return `${YEORI_SERVER}/downloads/${flat}/${key}`
}

export function cutMediaUrl(episode, kind, no, ext, suffix = '') {
  return `${epMediaUrl(episode, kind)}/cut_${paddedCutNo(no)}${suffix}.${ext}`
}

// 하위호환: 기존 flowUrl/videoUrl/audioUrl (code 자리에 ep number 문자열이 오던 것)
export function flowUrl(code, no, ext, suffix = '') { return cutMediaUrl(code, 'images', no, ext, suffix) }
export function videoUrl(code, no, ext = 'mp4') { return cutMediaUrl(code, 'video', no, ext) }
export function audioUrl(code, no, ext = 'mp3') { return cutMediaUrl(code, 'audio', no, ext) }

// 인스타그램 콘텐츠(FD/RL/PT/ST) — HIER 무관(별도 체계). server/lib/mediaPaths.js와 동일 유지.
export const INSTA_SUBDIR = { FD: 'raw', PT: 'raw', ST: 'raw', RL: null }
export const INSTA_RATIO  = { FD: '1:1', PT: '1:1', RL: '9:16', ST: '9:16' }

export function instaDir(content, num, kind) {
  const base = `${YEORI_SERVER}/downloads/insta/${content}/${num}`
  return kind ? `${base}/${kind}` : base
}

// cut 파일 URL (StudioTab 등이 쓰던 시그니처 그대로)
export function instaUrl(content, num, no, ext, suffix = '') {
  const kind = INSTA_SUBDIR[content]
  return `${instaDir(content, num, kind)}/cut_${paddedCutNo(no)}${suffix}.${ext}`
}
