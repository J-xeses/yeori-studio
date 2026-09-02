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
export const HIER = true

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

// ── 코드 → 플랫폼/시리즈 파싱 ────────────────────────────────────────
// 코드 형식: {SF|LF|IG|TK}_{E|T|P|R|S}{2자리+ 숫자}[_{슬러그}]
//   SF_E01 → YU/SF_E/SF_E01     LF_T01 → YU/LF_T/LF_T01
//   IG_R02 → IG/IG_R/IG_R02     IG_P01 → IG/IG_P/IG_P01
// 안 맞는 코드(ep3, TEST_OVERLAY, IG_RL_E02 …)는 전부 _etc/{code}/.
const PLATFORM = { SF: 'YU', LF: 'YU', IG: 'IG', TK: 'TK' }
const CODE_RE = /^(SF|LF|IG|TK)_([A-Z])(\d{2,})(?:_[A-Z0-9]+)?$/

export function parseCode(code) {
  const m = String(code ?? '').trim().toUpperCase().match(CODE_RE)
  if (!m) return null
  return { content: m[1], kind: m[2], platform: PLATFORM[m[1]], series: `${m[1]}_${m[2]}` }
}

// epRef: 숫자(1) · "1" · "ep1" · 코드("LF_T01") → 실제 코드 문자열
export function resolveCode(epRef) {
  const s = String(epRef ?? '').trim()
  if (!s) return 'ep0'
  const m = s.match(/^(?:ep)?(\d+)$/i)
  if (m) return numberToCodeMap()[m[1]] || `ep${m[1]}`
  return s
}
export const epKey = resolveCode   // 하위호환 별칭

// 인스턴스 폴더 (downloads/{platform}/{series}/{code}/  또는  downloads/_etc/{code}/)
export function instanceDir(epRef) {
  const code = resolveCode(epRef)
  const p = parseCode(code)
  return p ? path.join(DOWNLOADS, p.platform, p.series, code)
           : path.join(DOWNLOADS, '_etc', code)
}
export const episodeDir = instanceDir

// ── 인스턴스 안 번호 하위폴더 ────────────────────────────────────────
const SUBDIR = {
  script: '01_script', flow: '02_images', images: '02_images', audio: '03_audio',
  making: '04_making', video: '05_video',
  output: '06_publishing', publishing: '06_publishing', // 편집·CapCut·raw
  final: '07_output',                                   // 완성본·썸네일·업로드 패키지
}
function epSub(epRef, kind) {
  return path.join(instanceDir(epRef), SUBDIR[kind] || kind)
}

export function imagesDir(epRef)       { return epSub(epRef, 'flow') }
export const flowDir = imagesDir
export function audioDir(epRef)        { return epSub(epRef, 'audio') }
export function videoDir(epRef)        { return epSub(epRef, 'video') }
export function makingDir(epRef)       { return epSub(epRef, 'making') }
export function outputDir(epRef)       { return epSub(epRef, 'output') }    // 06_publishing
export function finalDir(epRef)        { return epSub(epRef, 'final') }     // 07_output
export function voiceInsertDir(epRef)  { return path.join(epSub(epRef, 'audio'), 'voice-insert') }
// 단계별 승인 확정본 모음 (구 deliverables/) — 06_publishing 아래로
export function deliverablesDir(epRef) { return path.join(epSub(epRef, 'output'), 'deliverables') }
export function scriptDir(epRef)       { return epSub(epRef, 'script') }

// 손글씨 스틸 캐시 (에피소드 무관 공유)
export function hwStillsDir() { return path.join(DOWNLOADS, 'library', 'hw_stills') }
// /api/run-video(DEPRECATED)가 쓰는 video-prompts.json
export function videoPromptsPath() { return path.join(DOWNLOADS, 'runtime', 'video-prompts.json') }

// ── 공유 라이브러리 (에피소드 무관) ──────────────────────────────────
export function sfxDir(sub = '')   { return path.join(HIER ? path.join(DOWNLOADS, 'library', 'sfx')   : path.join(DOWNLOADS, 'sfx'),   sub) }
// "sfx/whoosh/x.wav"(구 카탈로그 값) · "library/sfx/.."(현재 구조 값) · "whoosh/x.wav" 무엇이든 실제 경로로
export function sfxFile(rel) {
  const r = String(rel).replace(/\\/g, '/')
  if (r.startsWith('library/sfx/')) return path.join(DOWNLOADS, r)   // 이미 현재 구조 상대경로
  return sfxDir(r.replace(/^sfx\//, ''))                            // "sfx/.." 접두어는 논리 접두어 → 재매핑
}
export function bgmDir(sub = '')   { return path.join(HIER ? path.join(DOWNLOADS, 'library', 'bgm')   : path.join(DOWNLOADS, 'bgm'),   sub) }
// "bgm/mood/x.mp3"(구 인덱스 값) · "library/bgm/.."(현재 구조 값) · "mood/x.mp3" 무엇이든 실제 경로로
export function bgmFile(rel) {
  const r = String(rel).replace(/\\/g, '/')
  if (r.startsWith('library/bgm/')) return path.join(DOWNLOADS, r)
  return bgmDir(r.replace(/^bgm\//, ''))
}
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
// Chrome 프로필은 HIER와 무관하게 flow/에 유지 — 실행 중 잠겨있어 옮기기 위험하고
// 사용자 실행 단축키의 --user-data-dir 경로와도 묶여 있음(순수 런타임 캐시).
export function flowProfileDir(profile) {
  return path.join(DOWNLOADS, 'flow', `chrome-profile-${profile}`)
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
