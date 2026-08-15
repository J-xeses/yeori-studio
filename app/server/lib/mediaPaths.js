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

// 대본 원문(v3 텍스트) 저장 위치 — 지금까지는 사람이 임의 위치에 .txt로 두고
// studio_upload_script에 경로를 직접 넘기는 방식뿐이라 "정식 저장 경로"가 없었음.
// 서버 전용(클라이언트는 대본 파일에 직접 접근할 일이 없어 src/lib/mediaPaths.js엔 안 둠).
export function scriptDir(code) {
  return path.join(MEDIA_ROOT, 'downloads', 'script', String(code))
}

// cut 번호를 2자리로 zero-pad한 파일명 (예: cutFile(3, 'jpg') -> "cut_03.jpg")
export function cutFile(no, ext) {
  const padded = String(no).padStart(2, '0')
  return `cut_${padded}.${ext}`
}

export function paddedCutNo(no) {
  return String(no).padStart(2, '0')
}

// ── 인스타그램 콘텐츠(FD/RL/PT/ST) 경로 — episode.number 기반이 아니라
// 사용자가 직접 붙이는 "인스타 번호"(P01/RL03/PT01/ST01) 기준. RL만 하위폴더가
// 없다(대사 촬영/화면녹화 위주라 Flow 생성 이미지를 따로 raw 폴더에 모을 일이 적음).
export const INSTA_SUBDIR = { FD: 'raw', PT: 'raw', ST: 'raw', RL: null }
export const INSTA_RATIO  = { FD: '1:1', PT: '1:1', RL: '9:16', ST: '9:16' }

// kind 생략 시 콘텐츠 루트(downloads/insta/{content}/{num}/), 지정 시 그 하위(raw/txt/final)
export function instaDir(content, num, kind) {
  const base = path.join(MEDIA_ROOT, 'downloads', 'insta', String(content), String(num))
  return kind ? path.join(base, kind) : base
}

export function instaRatio(content) {
  return INSTA_RATIO[content] || null
}
