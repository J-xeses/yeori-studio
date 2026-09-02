// ── 여리 스튜디오 산출물 경로 단일 소스 ───────────────────────────────
// proxy.js / scripts/*.js 전체의 downloads 경로 조립을 여기 한 곳으로 모은다.
//
// 구조: downloads/
//   {BRAND}/{platform}/{series}/{code}/{01_script..07_output}/   콘텐츠
//   {BRAND}/characters/  {BRAND}/hw_stills/                       브랜드별
//   _shared/{sfx,bgm,hooks}/                                      공용
//   runtime/  state/  flow/chrome-profile-*  insta/               전역
//
// 클라이언트 src/lib/mediaPaths.js와 경로 규칙을 반드시 동기화할 것.

import fs from 'fs'
import path from 'path'

export const MEDIA_ROOT = 'C:\\yeori-studio'
export const DOWNLOADS = path.join(MEDIA_ROOT, 'downloads')

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
// 브랜드 래퍼 — 지금은 서여리 단일. 두 번째 브랜드가 생기면 여기에 폴더 추가 +
// (그때) studio-state.json/gpoints 상태 계층도 브랜드로 나눠야 함. 현재 상태는 전역.
export const BRAND = 'seoyeori'

// 코드 형식: {SF|LF|IG|TK}_{E|T|P|R|S}{2자리+ 숫자}[_{슬러그}]
//   SF_E01 → seoyeori/YU/SF_E/SF_E01     LF_T01 → seoyeori/YU/LF_T/LF_T01
//   IG_R02 → seoyeori/IG/IG_R/IG_R02
// 안 맞는 코드(ep3, TEST_OVERLAY, IG_RL_E02 …)는 전부 seoyeori/_etc/{code}/.
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

// 브랜드 콘텐츠 루트
export function brandDir(sub = '') { return path.join(DOWNLOADS, BRAND, sub) }

// 인스턴스 폴더 (downloads/seoyeori/{platform}/{series}/{code}/  또는  seoyeori/_etc/{code}/)
export function instanceDir(epRef) {
  const code = resolveCode(epRef)
  const p = parseCode(code)
  return p ? path.join(DOWNLOADS, BRAND, p.platform, p.series, code)
           : path.join(DOWNLOADS, BRAND, '_etc', code)
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

// 손글씨 스틸 캐시 — 브랜드별(캐릭터 이미지에서 파생)
export function hwStillsDir() { return path.join(DOWNLOADS, BRAND, 'hw_stills') }
// /api/run-video(DEPRECATED)가 쓰는 video-prompts.json
export function videoPromptsPath() { return path.join(DOWNLOADS, 'runtime', 'video-prompts.json') }

// ── 공용 라이브러리 (브랜드 무관) — downloads/_shared/ ────────────────
export function sfxDir(sub = '')   { return path.join(DOWNLOADS, '_shared', 'sfx', sub) }
// "sfx/.."(구 카탈로그) · "library/sfx/.."·"_shared/sfx/.."(현재/과거 구조값) · "whoosh/x.wav" 모두 처리
export function sfxFile(rel) {
  const r = String(rel).replace(/\\/g, '/')
  if (r.startsWith('_shared/sfx/')) return path.join(DOWNLOADS, r)
  return sfxDir(r.replace(/^(library\/)?sfx\//, ''))
}
export function bgmDir(sub = '')   { return path.join(DOWNLOADS, '_shared', 'bgm', sub) }
export function bgmFile(rel) {
  const r = String(rel).replace(/\\/g, '/')
  if (r.startsWith('_shared/bgm/')) return path.join(DOWNLOADS, r)
  return bgmDir(r.replace(/^(library\/)?bgm\//, ''))
}
export function hooksDir(sub = '') { return path.join(DOWNLOADS, '_shared', 'hooks', sub) }

// ── 캐릭터 레퍼런스 — 브랜드별 (downloads/seoyeori/characters/) ────────
export function charactersDir(sub = '') { return path.join(DOWNLOADS, BRAND, 'characters', sub) }
export function charactersJsonPath()    { return path.join(DOWNLOADS, BRAND, 'characters', 'characters.json') }

// ── 런타임 (Flow 실행·프롬프트) — downloads/runtime/ (전역, 브랜드 무관) ──
export function runtimeDir(sub = '') { return path.join(DOWNLOADS, 'runtime', sub) }
export function promptsJsonPath()   { return path.join(DOWNLOADS, 'runtime', 'prompts.json') }
// Chrome 프로필은 flow/에 유지 — 실행 중 잠겨있고 사용자 실행 단축키의 --user-data-dir와 묶임.
export function flowProfileDir(profile) { return path.join(DOWNLOADS, 'flow', `chrome-profile-${profile}`) }
export function flowDownloadDir()   { return path.join(DOWNLOADS, 'runtime', 'flow-downloads') }
// 구 flow 루트의 느슨한 레퍼런스 이미지 → 브랜드 characters/
export function flowLooseRefsDir()  { return charactersDir() }

// ── 앱 상태 (전역 JSON) — downloads/state/ ──────────────────────────
// gpoints, trend_episodes, trend_candidates, code-task-queue, credit-usage-today,
// codi_gen_handoff, pipeline_export, yeori_edit_meta, capcut_config, capcut_exe_path.txt
// ⚠️ 지금은 단일 브랜드라 전역. 멀티브랜드 시 브랜드별로 나눠야 함.
export function statePath(name)    { return path.join(DOWNLOADS, 'state', name) }
export function editMetaPath()     { return statePath('yeori_edit_meta.json') }
export function capcutConfigPath() { return statePath('capcut_config.json') }
export function capcutExePath()    { return statePath('capcut_exe_path.txt') }

// ── 절대경로 → /downloads/... URL ──────────────────────────────────
export function toMediaUrl(abs) {
  return '/downloads/' + path.relative(DOWNLOADS, abs).replace(/\\/g, '/')
}

// ── cut 파일명 ─────────────────────────────────────────────────────
export function paddedCutNo(no) { return String(no).padStart(2, '0') }
export function cutFile(no, ext) { return `cut_${paddedCutNo(no)}.${ext}` }

// ── 인스타그램 콘텐츠(FD/RL/PT/ST) — episode.number가 아니라 사용자가 직접 붙이는
// "인스타 번호"(P01/RL03/PT01/ST01) 기준. RL만 raw 하위폴더 없음. 이번 개편에서 안 건드림(별도 체계).
export const INSTA_SUBDIR = { FD: 'raw', PT: 'raw', ST: 'raw', RL: null }
export const INSTA_RATIO  = { FD: '1:1', PT: '1:1', RL: '9:16', ST: '9:16' }

export function instaDir(content, num, kind) {
  const base = path.join(DOWNLOADS, 'insta', String(content), String(num))
  return kind ? path.join(base, kind) : base
}
export function instaRatio(content) {
  return INSTA_RATIO[content] || null
}
