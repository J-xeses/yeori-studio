// 에피소드 코드 기준 산출물 경로를 한 곳에서만 만드는 헬퍼.
// proxy.js와 scripts/*.js 전체가 각자 `ep${epNum}` 문자열을 직접 조립하던 것을,
// 이 모듈을 거치도록 바꾸는 게 목표(4차 범위). 이번 라운드에서는 신규 추가만 하고
// 기존 호출부는 아직 안 건드린다 — 그래서 지금은 `code` 자리에 임시로 숫자 문자열
// (예: "4")이 들어와도 그대로 동작한다(에피소드 코드 도입 전까지의 과도기 호환).
//
// 이 로직은 src/lib/mediaPaths.js(클라이언트)와 반드시 동일하게 유지할 것.

import path from 'path'

export const MEDIA_ROOT = 'C:\\yeori-studio'

export function flowDir(code) {
  return path.join(MEDIA_ROOT, 'downloads', 'flow', String(code))
}

export function videoDir(code) {
  return path.join(MEDIA_ROOT, 'downloads', 'video', String(code))
}

export function audioDir(code) {
  return path.join(MEDIA_ROOT, 'downloads', 'audio', String(code))
}

export function outputDir(code) {
  return path.join(MEDIA_ROOT, 'downloads', 'output', String(code))
}

// cut 번호를 2자리로 zero-pad한 파일명 (예: cutFile(3, 'jpg') -> "cut_03.jpg")
export function cutFile(no, ext) {
  const padded = String(no).padStart(2, '0')
  return `cut_${padded}.${ext}`
}

export function paddedCutNo(no) {
  return String(no).padStart(2, '0')
}
