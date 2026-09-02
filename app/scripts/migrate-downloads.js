// ── downloads/ 평면 구조 → episodes/{code}/ 위계 마이그레이션 (3단계, 1회성) ──
//
//   node scripts/migrate-downloads.js          # dry-run (뭘 옮길지 출력만)
//   node scripts/migrate-downloads.js --go      # 실제 이동
//
// 실행 후 downloads/state/migrate-manifest.json 에 이동 내역 기록.
// 되돌리려면: node scripts/migrate-downloads.js --undo
//
// ⚠️ mediaPaths.js의 HIER를 true로 바꾸기 직전 또는 직후에 실행. (순서 무관 — 이동만 함)

import fs from 'node:fs'
import path from 'node:path'

const MEDIA_ROOT = 'C:\\yeori-studio'
const DL = path.join(MEDIA_ROOT, 'downloads')
const GO = process.argv.includes('--go')
const UNDO = process.argv.includes('--undo')
const ARCHIVE = path.join(DL, '_archive', '2026-09-02', 'migrate-residue')
const MANIFEST = path.join(DL, 'state', 'migrate-manifest.json')

// 에피소드 번호 → 코드 (studio-state.json)
function numberToCode() {
  const map = {}
  try {
    const j = JSON.parse(fs.readFileSync(path.join(MEDIA_ROOT, 'app', 'studio-state.json'), 'utf-8'))
    for (const e of Object.values(j.episodes || {})) {
      const ep = e.episode || {}
      if (ep.number != null && ep.code) map[`ep${ep.number}`] = ep.code
    }
  } catch (e) { console.warn('studio-state.json 못읽음:', e.message) }
  return map
}
const N2C = numberToCode()
// "ep1" → "LF_T01" (코드 있으면), 아니면 그대로. 이미 코드형이면 그대로.
const epKey = (dir) => N2C[dir] || dir

const moves = []   // { from, to }
const has = (p) => fs.existsSync(p)
const list = (p) => { try { return fs.readdirSync(p) } catch { return [] } }
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }

const _planned = new Set()
function plan(from, to) {
  if (!has(from)) return
  if (_planned.has(from)) return   // 먼저 계획된 이동이 우선
  _planned.add(from)
  moves.push({ from, to })
}

// ── 1) 에피소드별 산출물 디렉터리 ──────────────────────────────
const KIND_MAP = { flow: 'images', audio: 'audio', video: 'video', making: 'making', output: 'output', final: 'final', deliverables: 'deliverables', script: 'script', 'voice-insert': 'voice-insert' }
for (const [kind, sub] of Object.entries(KIND_MAP)) {
  const base = path.join(DL, kind)
  if (!isDir(base)) continue
  for (const name of list(base)) {
    const full = path.join(base, name)
    if (!isDir(full)) continue
    if (/^(OLD|research|hw_stills|test_frames|test_hw|character|chrome-profile)/i.test(name)) continue
    if (name === 'ep99_bust_v1_backup' || /_backup$/.test(name)) { plan(full, path.join(ARCHIVE, kind, name)); continue }
    plan(full, path.join(DL, 'episodes', epKey(name), sub))
  }
}

// 1b) script/ 안의 느슨한 대본 텍스트 — 파일명 앞 코드 토큰으로 에피소드 추정
for (const name of list(path.join(DL, 'script'))) {
  const full = path.join(DL, 'script', name)
  if (isDir(full) || !/\.txt$/i.test(name)) continue
  const m = name.match(/^([A-Z0-9_]+?)_script/i) || name.match(/^([A-Z]+_?[A-Z]?_?E?\d+[A-Z0-9_]*)/)
  if (m) plan(full, path.join(DL, 'episodes', epKey(m[1]), 'script', name))
}

// ── 2) 공유 라이브러리 ────────────────────────────────────────
plan(path.join(DL, 'sfx'), path.join(DL, 'library', 'sfx'))
plan(path.join(DL, 'bgm'), path.join(DL, 'library', 'bgm'))
plan(path.join(DL, 'hooks'), path.join(DL, 'library', 'hooks'))
plan(path.join(DL, 'flow', 'character'), path.join(DL, 'library', 'characters'))
plan(path.join(DL, 'flow', 'characters.json'), path.join(DL, 'library', 'characters', 'characters.json'))
plan(path.join(DL, 'flow', 'yeori-face-cache.json'), path.join(DL, 'library', 'characters', 'yeori-face-cache.json'))
plan(path.join(DL, 'making', 'hw_stills'), path.join(DL, 'library', 'hw_stills'))

// flow/ 루트의 느슨한 캐릭터 레퍼런스 이미지 → library/characters/
for (const name of list(path.join(DL, 'flow'))) {
  if (/\.(jpe?g|png|webp)$/i.test(name) && !/^(debug_|download\.)/i.test(name)) {
    plan(path.join(DL, 'flow', name), path.join(DL, 'library', 'characters', name))
  }
}

// ── 3) 런타임 ────────────────────────────────────────────────
plan(path.join(DL, 'flow', 'prompts.json'), path.join(DL, 'runtime', 'prompts.json'))
plan(path.join(DL, 'video', 'video-prompts.json'), path.join(DL, 'runtime', 'video-prompts.json'))
// flow/chrome-profile-* 와 flow/research 는 flow/에 그대로 둔다 (런타임 캐시, 실행중 잠김)

// ── 4) 앱 상태 (전역 JSON) ──────────────────────────────────
const STATE_FILES = ['gpoints.json', 'trend_episodes.json', 'trend_candidates.json', 'code-task-queue.json',
  'credit-usage-today.json', 'codi_gen_handoff.json', 'pipeline_export.json', 'capcut_spec.json']
for (const f of STATE_FILES) plan(path.join(DL, f), path.join(DL, 'state', f))
plan(path.join(DL, 'video', 'yeori_edit_meta.json'), path.join(DL, 'state', 'yeori_edit_meta.json'))
plan(path.join(DL, 'video', 'capcut_config.json'), path.join(DL, 'state', 'capcut_config.json'))
plan(path.join(DL, 'video', 'capcut_exe_path.txt'), path.join(DL, 'state', 'capcut_exe_path.txt'))

// ── 5) 잔여물(디버그·리포트·로그) → _archive ────────────────
for (const kind of ['flow', 'video', 'making', 'audio', 'output', 'script']) {
  const base = path.join(DL, kind)
  for (const name of list(base)) {
    const full = path.join(base, name)
    if (isDir(full)) {
      if (/^(test_frames|test_hw)$/.test(name)) plan(full, path.join(ARCHIVE, kind, name))
      continue
    }
    if (/\.(png|log)$/i.test(name) || /^report_.*\.json$/i.test(name) || /^_run_|^proxy_restart|^run_/i.test(name)
        || /\.(jpe?g|webp)$/i.test(name) || name === 'flow_setup_requirements.md') {
      plan(full, path.join(ARCHIVE, kind, name))
    }
  }
}

// ── 실행 ────────────────────────────────────────────────────
function mv(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (has(to)) {
    // 대상이 이미 있으면 병합(디렉터리) 또는 스킵(파일)
    if (isDir(from) && isDir(to)) {
      for (const c of list(from)) mv(path.join(from, c), path.join(to, c))
      try { fs.rmdirSync(from) } catch { /* 비어있지 않으면 남김 */ }
      return
    }
    console.warn(`  ⚠ 대상 존재, 스킵: ${to}`)
    return
  }
  fs.renameSync(from, to)
}

if (UNDO) {
  if (!has(MANIFEST)) { console.error('manifest 없음:', MANIFEST); process.exit(1) }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'))
  console.log(`되돌리기: ${m.moves.length}건`)
  for (const { from, to } of [...m.moves].reverse()) {
    if (has(to) && !has(from)) { fs.mkdirSync(path.dirname(from), { recursive: true }); fs.renameSync(to, from); console.log(`  ← ${to}`) }
  }
  console.log('완료. mediaPaths.js HIER도 false로 되돌릴 것.')
  process.exit(0)
}

console.log(`${GO ? '실행' : 'DRY-RUN'} — 이동 ${moves.length}건\n`)
for (const { from, to } of moves) {
  console.log(`  ${path.relative(DL, from)}  →  ${path.relative(DL, to)}`)
}
if (!GO) { console.log('\n--go 를 붙이면 실제 이동합니다.'); process.exit(0) }

let done = 0
for (const { from, to } of moves) {
  try { mv(from, to); done++ }
  catch (e) { console.error(`  ✗ ${from}: ${e.message}`) }
}
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true })
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), moves }, null, 2))
console.log(`\n완료 ${done}/${moves.length}. manifest: ${MANIFEST}`)
console.log('\n⚠ Chrome 프로필이 이동됐으면 실행 단축키의 --user-data-dir 경로도 바꿀 것:')
console.log(`   ${path.join(DL, 'runtime', 'chrome-profile-main')}`)
