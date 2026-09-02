// ── 여리 스튜디오 산출물 경로 단일 소스 ───────────────────────────────
// proxy.js / scripts/*.js 전체가 각자 `path.join(MEDIA_ROOT, 'downloads', 'flow',
// `ep${N}`)` 식으로 조립하던 경로를 여기 한 곳으로 모은다.
//
// 2단계(현재, HIER=false): 함수들이 기존 평면 구조를 그대로 반환 — 동작 불변.
// 3단계(HIER=true):        downloads/episodes/{code}/{images,audio,video,...} 위계로.
//                          폴더 키 = episode.code (예: LF_T01), 없으면 ep{number}.
//
// 클라이언트 src/lib/mediaPaths.js와 HIER 플래그·키 규칙을 반드시 동기화할 것.

import fs from 'fs'
import path from 'path'

export const MEDIA_ROOT = 'C:\\yeori-studio'
export const DOWNLOADS = path.join(MEDIA_ROOT, 'downloads')

// ⚠️ 3단계 스위치. 폴더 마이그레이션(scripts/migrate-downloads.js) 실행과 함께 true로.
export const HIER = false

// ── 에피소드 번호 → 코드 매핑 (studio-state.json, mtime 캐시) ──────────
const STATE_PATH = path.join(MEDIA_ROOT, 'app', 'studio-state.json')
let _stateCache = { mtime: -1, map: {} }
function numberToCodeMap() {
  try {
    const st = fs.statSync(STATE_PATH)
    if (st.mtimeMs !== _stateCache.mtime) {
      const j = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
      const map = {}
      for (const e of Object.values(j.episodes || {})) {
        const ep = e.episode || {}
        if (ep.number != null && ep.code) map[String(ep.number)] = ep.code
      }
      _stateCache = { mtime: st.mtimeMs, map }
    }
  } catch { /* 상태 파일 없거나 파싱 실패 — 이전 캐시 유지 */ }
  return _stateCache.map
}

// epRef: 숫자(1) · 번호 문자열("1") · "ep1" · 이미 코드("LF_T01") 무엇이든 폴더 키로 정규화.
export function epKey(epRef) {
  const s = String(epRef ?? '').trim()
  if (!s) return 'ep0'
  const m = s.match(/^(?:ep)?(\d+)$/i)
  const digits = m ? m[1] : null
  if (HIER) {
    if (digits) return numberToCodeMap()[digits] || `ep${digits}`
    return s                         // 이미 코드
  }
  // 2단계: 기존 규칙 그대로 (숫자 → ep{N}, 코드는 그대로)
  if (digits) return `ep${digits}`
  return s
}

// ── 에피소드별 산출물 디렉터리 ────────────────────────────────────────
function epSub(epRef, kind) {
  if (HIER) {
    const sub = kind === 'flow' ? 'images' : kind
    return path.join(DOWNLOADS, 'episodes', epKey(epRef), sub)
  }
  return path.join(DOWNLOADS, kind, epKey(epRef))
}

export function imagesDir(epRef)       { return epSub(epRef, 'flow') }   // 생성 이미지 (구 flow/ep{N})
export const flowDir = imagesDir                                         // 하위호환 별칭
export function audioDir(epRef)        { return epSub(epRef, 'audio') }
export function videoDir(epRef)        { return epSub(epRef, 'video') }
export function makingDir(epRef)       { return epSub(epRef, 'making') }
export function outputDir(epRef)       { return epSub(epRef, 'output') }
export function finalDir(epRef)        { return epSub(epRef, 'final') }
export function voiceInsertDir(epRef)  { return epSub(epRef, 'voice-insert') }

// 손글씨 스틸 캐시 (에피소드 무관 공유 — 구 downloads/making/hw_stills)
export function hwStillsDir() {
  return HIER ? path.join(DOWNLOADS, 'library', 'hw_stills') : path.join(DOWNLOADS, 'making', 'hw_stills')
}
// /api/run-video(DEPRECATED)가 쓰는 video-prompts.json (에피소드 무관 임시)
export function videoPromptsPath() {
  return HIER ? path.join(DOWNLOADS, 'runtime', 'video-prompts.json') : path.join(DOWNLOADS, 'video', 'video-prompts.json')
}

// deliverables/script는 예전부터 code 키 — HIER 여부와 무관하게 epKey가 코드 그대로 통과
export function deliverablesDir(epRef) {
  return HIER ? path.join(DOWNLOADS, 'episodes', epKey(epRef), 'deliverables')
              : path.join(DOWNLOADS, 'deliverables', epKey(epRef))
}
export function scriptDir(epRef) {
  return HIER ? path.join(DOWNLOADS, 'episodes', epKey(epRef), 'script')
              : path.join(DOWNLOADS, 'script', epKey(epRef))
}
export function episodeDir(epRef) {
  return HIER ? path.join(DOWNLOADS, 'episodes', epKey(epRef)) : DOWNLOADS
}

// ── 공유 라이브러리 (에피소드 무관) ──────────────────────────────────
export function sfxDir(sub = '')   { return path.join(HIER ? path.join(DOWNLOADS, 'library', 'sfx')   : path.join(DOWNLOADS, 'sfx'),   sub) }
export function bgmDir(sub = '')   { return path.join(HIER ? path.join(DOWNLOADS, 'library', 'bgm')   : path.join(DOWNLOADS, 'bgm'),   sub) }
// t.file/bgmFile 값이 "bgm/mood/x.mp3" 또는 "mood/x.mp3" 어느 쪽이든 실제 경로로
export function bgmFile(rel) { return bgmDir(String(rel).replace(/\\/g, '/').replace(/^bgm\//, '')) }
export function hooksDir(sub = '') { return path.join(HIER ? path.join(DOWNLOADS, 'library', 'hooks') : path.join(DOWNLOADS, 'hooks'), sub) }
export function charactersDir(sub = '') {
  return path.join(HIER ? path.join(DOWNLOADS, 'library', 'characters') : path.join(DOWNLOADS, 'flow', 'character'), sub)
}
export function charactersJsonPath() {
  return HIER ? path.join(DOWNLOADS, 'library', 'characters', 'characters.json')
              : path.join(DOWNLOADS, 'flow', 'characters.json')
}

// ── 런타임 (Flow 실행·프롬프트·큐) ──────────────────────────────────
export function runtimeDir(sub = '') { return path.join(HIER ? path.join(DOWNLOADS, 'runtime') : DOWNLOADS, sub) }
export function promptsJsonPath() {
  return HIER ? path.join(DOWNLOADS, 'runtime', 'prompts.json') : path.join(DOWNLOADS, 'flow', 'prompts.json')
}
export function flowProfileDir(profile) {
  return HIER ? path.join(DOWNLOADS, 'runtime', `chrome-profile-${profile}`)
              : path.join(DOWNLOADS, 'flow', `chrome-profile-${profile}`)
}
export function flowDownloadDir() {   // puppeteer 다운로드 착지점 (구 downloads/flow 루트)
  return HIER ? path.join(DOWNLOADS, 'runtime', 'flow-downloads') : path.join(DOWNLOADS, 'flow')
}
// 구 downloads/flow 루트에 흩어져 있던 느슨한 캐릭터 레퍼런스 이미지들의 새 자리
export function flowLooseRefsDir() {
  return HIER ? charactersDir() : path.join(DOWNLOADS, 'flow')
}

// ── 앱 상태 (전역 JSON) ─────────────────────────────────────────────
// gpoints.json, trend_episodes.json, trend_candidates.json, code-task-queue.json,
// credit-usage-today.json, codi_gen_handoff.json, pipeline_export.json,
// yeori_edit_meta.json, capcut_config.json, capcut_exe_path.txt, task-queue-worker.log
export function statePath(name) {
  return HIER ? path.join(DOWNLOADS, 'state', name) : path.join(DOWNLOADS, name)
}
// 구조상 downloads/video/ 에 있던 전역 파일들 (에피소드 무관, 매 실행 덮어씀)
export function editMetaPath()     { return HIER ? statePath('yeori_edit_meta.json') : path.join(DOWNLOADS, 'video', 'yeori_edit_meta.json') }
export function capcutConfigPath() { return HIER ? statePath('capcut_config.json')   : path.join(DOWNLOADS, 'video', 'capcut_config.json') }
export function capcutExePath()    { return HIER ? statePath('capcut_exe_path.txt')  : path.join(DOWNLOADS, 'video', 'capcut_exe_path.txt') }

// ── 절대경로 → /downloads/... URL ──────────────────────────────────
export function toMediaUrl(abs) {
  return '/downloads/' + path.relative(DOWNLOADS, abs).replace(/\\/g, '/')
}

// ── cut 파일명 ─────────────────────────────────────────────────────
export function paddedCutNo(no) { return String(no).padStart(2, '0') }
export function cutFile(no, ext) { return `cut_${paddedCutNo(no)}.${ext}` }

// ── 인스타그램 콘텐츠(FD/RL/PT/ST) — episode.number가 아니라 사용자가 직접 붙이는
// "인스타 번호"(P01/RL03/PT01/ST01) 기준. RL만 raw 하위폴더 없음. HIER 무관(별도 체계).
export const INSTA_SUBDIR = { FD: 'raw', PT: 'raw', ST: 'raw', RL: null }
export const INSTA_RATIO  = { FD: '1:1', PT: '1:1', RL: '9:16', ST: '9:16' }

export function instaDir(content, num, kind) {
  const base = path.join(DOWNLOADS, 'insta', String(content), String(num))
  return kind ? path.join(base, kind) : base
}
export function instaRatio(content) {
  return INSTA_RATIO[content] || null
}
