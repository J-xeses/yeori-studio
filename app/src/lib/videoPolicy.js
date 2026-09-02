// ── 영상 정책 ─────────────────────────────────────────────────────
// 컷을 어떻게 "움직이게" 만들지 결정.
//   'veo'    — 진짜 영상 생성 (Veo/Flow) — 수동 제작 후 업로드
//   'motion' — 이미지 + 메이킹 탭 모션(줌/팬/켄번스, 그래픽 애니)
//   'still'  — 정지 이미지 그대로
//
// contentType로 기본 정책을 깔고(finishMode.js와 같은 축), 에피소드/컷 단위로 override.
//   LF (서여리 에피소드 시리즈) → 영상 중심: 대부분 컷 veo
//   SF (유튜브 숏폼)            → 혼합
//   IG_R (릴스)                → 이미지+모션 중심: 빠른 전개, veo 최소
//   IG_P/IG_S (피드/스토리)     → 거의 정지

export const VIDEO_MODES = [
  { value: 'veo',    label: '영상 생성 (Veo/Flow, 수동)' },
  { value: 'motion', label: '이미지 + 모션 (메이킹 탭)' },
  { value: 'still',  label: '정지 이미지' },
]

// 에피소드의 기본 영상 비중 — 'video-first' | 'mixed' | 'image-first'
export function resolveVideoPolicy(episode = {}) {
  if (episode.videoPolicy) return episode.videoPolicy
  const ct = (episode.contentType || '').toUpperCase()
  if (ct === 'LF') return 'video-first'
  if (ct === 'SF') return 'mixed'
  return 'image-first'   // IG_R, IG_P, IG_S, TK …
}

// 컷의 최종 영상 방식. 우선순위: 컷 명시(cut.videoMode) > 유형(그래픽/캡컷은 항상 motion/still) > 정책
export function resolveCutVideoMode(cut = {}, episode = {}) {
  if (cut.videoMode === 'veo' || cut.videoMode === 'motion' || cut.videoMode === 'still') {
    return cut.videoMode
  }
  const cutType = (cut.cutType || 'YEORI').toUpperCase()
  if (cutType === 'GRAPHIC' || cutType === 'CAPCUT') return 'motion'  // 그래픽/목업은 영상생성 대상 아님
  if (cutType === 'BROLL') return 'motion'                            // B롤은 스톡/화면녹화

  const policy = resolveVideoPolicy(episode)
  // 대사 없는 컷은 정책이 video-first여도 굳이 veo 안 씀(설정샷 등) — motion으로.
  const hasSpeech = !!(String(cut.dialogue || '').trim() || String(cut.narration || '').trim())
  if (policy === 'video-first') return hasSpeech ? 'veo' : 'motion'
  if (policy === 'mixed')       return hasSpeech ? 'veo' : 'still'
  return hasSpeech ? 'motion' : 'still'  // image-first: 대사 있어도 모션까지만
}

// 이 컷이 "수동 Veo 제작 대상"인가 (VideoTab 영상 체크리스트에 뜰지)
export function needsManualVideo(cut, episode) {
  return resolveCutVideoMode(cut, episode) === 'veo'
}
