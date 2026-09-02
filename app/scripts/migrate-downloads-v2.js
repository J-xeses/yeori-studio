// ── downloads/episodes/{code}/{sub} → {platform}/{series}/{code}/{NN_sub} (v2, 1회성) ──
//
//   node scripts/migrate-downloads-v2.js         # dry-run
//   node scripts/migrate-downloads-v2.js --go     # 실제 이동
//   node scripts/migrate-downloads-v2.js --undo   # 되돌리기 (state/migrate-v2-manifest.json)
//
// v1 마이그레이션(episodes/{code}/) 이후 상태에서 실행. mediaPaths.js는 이미 v2 경로를
// 반환하도록 되어 있음(플래그 없음) — 이 스크립트는 파일만 옮긴다.

import fs from 'node:fs'
import path from 'node:path'

const MEDIA_ROOT = 'C:\\yeori-studio'
const DL = path.join(MEDIA_ROOT, 'downloads')
const EPISODES = path.join(DL, 'episodes')
const GO = process.argv.includes('--go')
const UNDO = process.argv.includes('--undo')
const MANIFEST = path.join(DL, 'state', 'migrate-v2-manifest.json')

const PLATFORM = { SF: 'YU', LF: 'YU', IG: 'IG', TK: 'TK' }
const CODE_RE = /^(SF|LF|IG|TK)_([A-Z])(\d{2,})(?:_[A-Z0-9]+)?$/
function instanceDirFor(code) {
  const m = String(code).toUpperCase().match(CODE_RE)
  return m ? path.join(DL, PLATFORM[m[1]], `${m[1]}_${m[2]}`, code)
           : path.join(DL, '_etc', code)
}
const SUBDIR = {
  script: '01_script', images: '02_images', audio: '03_audio', making: '04_making',
  video: '05_video', output: '06_publishing', final: '07_output',
  deliverables: path.join('06_publishing', 'deliverables'),
  'voice-insert': path.join('03_audio', 'voice-insert'),
}

const has = (p) => fs.existsSync(p)
const list = (p) => { try { return fs.readdirSync(p) } catch { return [] } }
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }

const moves = []
if (isDir(EPISODES)) {
  for (const code of list(EPISODES)) {
    const src = path.join(EPISODES, code)
    if (!isDir(src)) continue
    const destInst = instanceDirFor(code)
    for (const sub of list(src)) {
      const subSrc = path.join(src, sub)
      const mapped = SUBDIR[sub] || sub   // 모르는 하위폴더는 이름 유지
      moves.push({ from: subSrc, to: path.join(destInst, mapped) })
    }
  }
}
// TK/ 자리만 만들어 둠
const mkTK = path.join(DL, 'TK')

function mv(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (has(to)) {
    if (isDir(from) && isDir(to)) {
      for (const c of list(from)) mv(path.join(from, c), path.join(to, c))
      try { fs.rmdirSync(from) } catch { /* not empty */ }
      return
    }
    console.warn(`  ⚠ 대상 존재, 스킵: ${path.relative(DL, to)}`)
    return
  }
  fs.renameSync(from, to)
}

if (UNDO) {
  if (!has(MANIFEST)) { console.error('manifest 없음:', MANIFEST); process.exit(1) }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'))
  for (const { from, to } of [...m.moves].reverse()) {
    if (has(to) && !has(from)) { fs.mkdirSync(path.dirname(from), { recursive: true }); fs.renameSync(to, from); console.log(`  ← ${path.relative(DL, to)}`) }
  }
  console.log('완료. mediaPaths.js를 v1(episodes/{code}/) 버전으로 되돌릴 것.')
  process.exit(0)
}

console.log(`${GO ? '실행' : 'DRY-RUN'} — 이동 ${moves.length}건\n`)
for (const { from, to } of moves) console.log(`  ${path.relative(DL, from)}  →  ${path.relative(DL, to)}`)
if (!GO) { console.log('\n--go 로 실제 이동.'); process.exit(0) }

let done = 0
for (const { from, to } of moves) {
  try { mv(from, to); done++ } catch (e) { console.error(`  ✗ ${path.relative(DL, from)}: ${e.message}`) }
}
// 빈 episodes/{code}/ 와 episodes/ 정리
for (const code of list(EPISODES)) { try { fs.rmdirSync(path.join(EPISODES, code)) } catch { /* not empty */ } }
try { fs.rmdirSync(EPISODES) } catch { /* not empty */ }
fs.mkdirSync(mkTK, { recursive: true })

fs.mkdirSync(path.dirname(MANIFEST), { recursive: true })
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), moves }, null, 2))
console.log(`\n완료 ${done}/${moves.length}. manifest: ${path.relative(DL, MANIFEST)}`)
console.log('다음: npm run build → proxy 재시작.')
