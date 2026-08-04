// 에피소드 코드 기준 산출물 URL을 한 곳에서만 만드는 헬퍼 — 클라이언트용.
// StudioTab.jsx/VideoTab.jsx/ExtractTab.jsx 등이 각자 `ep${episode.number}` 문자열을
// 직접 조립하던 것을 이 모듈을 거치도록 바꾸는 게 목표(4차 범위). 이번 라운드에서는
// 신규 추가만 하고 기존 호출부는 아직 안 건드린다 — `code` 자리에 임시로 숫자 문자열이
// 들어와도 그대로 동작한다(에피소드 코드 도입 전까지의 과도기 호환).
//
// server/lib/mediaPaths.js와 반드시 동일한 로직을 유지할 것.

const YEORI_SERVER = 'http://localhost:3001'

export function paddedCutNo(no) {
  return String(no).padStart(2, '0')
}

export function cutFile(no, ext) {
  return `cut_${paddedCutNo(no)}.${ext}`
}

export function flowUrl(code, no, ext, suffix = '') {
  return `${YEORI_SERVER}/downloads/flow/${code}/cut_${paddedCutNo(no)}${suffix}.${ext}`
}

export function videoUrl(code, no, ext = 'mp4') {
  return `${YEORI_SERVER}/downloads/video/${code}/cut_${paddedCutNo(no)}.${ext}`
}

export function audioUrl(code, no, ext = 'mp3') {
  return `${YEORI_SERVER}/downloads/audio/${code}/cut_${paddedCutNo(no)}.${ext}`
}
