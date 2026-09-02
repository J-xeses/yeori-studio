// ── downloads/ → 브랜드 래퍼 (v3, 1회성) ─────────────────────────────
//   YU IG TK _etc            → seoyeori/{YU,IG,TK,_etc}
//   library/characters       → seoyeori/characters
//   library/hw_stills        → seoyeori/hw_stills
//   library/sfx bgm hooks    → _shared/{sfx,bgm,hooks}
// runtime/ state/ flow/ insta/ 는 그대로.
//
//   node scripts/migrate-downloads-v3.js         # dry-run
//   node scripts/migrate-downloads-v3.js --go
//   node scripts/migrate-downloads-v3.js --undo

import fs from 'node:fs'
import path from 'node:path'

const DL = path.join('C:\\yeori-studio', 'downloads')
const BRAND = 'seoyeori'
const GO = process.argv.includes('--go')
const UNDO = process.argv.includes('--undo')
const MANIFEST = path.join(DL, 'state', 'migrate-v3-manifest.json')

const has = (p) => fs.existsSync(p)
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const list = (p) => { try { return fs.readdirSync(p) } catch { return [] } }

const moves = []
for (const d of ['YU', 'IG', 'TK', '_etc']) {
  if (has(path.join(DL, d))) moves.push({ from: path.join(DL, d), to: path.join(DL, BRAND, d) })
}
if (has(path.join(DL, 'library', 'characters'))) moves.push({ from: path.join(DL, 'library', 'characters'), to: path.join(DL, BRAND, 'characters') })
if (has(path.join(DL, 'library', 'hw_stills')))  moves.push({ from: path.join(DL, 'library', 'hw_stills'),  to: path.join(DL, BRAND, 'hw_stills') })
for (const d of ['sfx', 'bgm', 'hooks']) {
  if (has(path.join(DL, 'library', d))) moves.push({ from: path.join(DL, 'library', d), to: path.join(DL, '_shared', d) })
}

function mv(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (has(to)) {
    if (isDir(from) && isDir(to)) {
      for (const c of list(from)) mv(path.join(from, c), path.join(to, c))
      try { fs.rmdirSync(from) } catch { /* not empty */ }
      return
    }
    console.warn(`  ⚠ 대상 존재, 스킵: ${path.relative(DL, to)}`); return
  }
  fs.renameSync(from, to)
}

if (UNDO) {
  if (!has(MANIFEST)) { console.error('manifest 없음'); process.exit(1) }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'))
  for (const { from, to } of [...m.moves].reverse()) {
    if (has(to) && !has(from)) { fs.mkdirSync(path.dirname(from), { recursive: true }); fs.renameSync(to, from); console.log(`  ← ${path.relative(DL, to)}`) }
  }
  console.log('완료. mediaPaths.js를 v2(브랜드 래퍼 없음)로 되돌릴 것.')
  process.exit(0)
}

console.log(`${GO ? '실행' : 'DRY-RUN'} — 이동 ${moves.length}건\n`)
for (const { from, to } of moves) console.log(`  ${path.relative(DL, from)}  →  ${path.relative(DL, to)}`)
if (!GO) { console.log('\n--go 로 실제 이동.'); process.exit(0) }

let done = 0
for (const { from, to } of moves) {
  try { mv(from, to); done++ } catch (e) { console.error(`  ✗ ${path.relative(DL, from)}: ${e.message}`) }
}
try { fs.rmdirSync(path.join(DL, 'library')) } catch { /* not empty */ }
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true })
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), moves }, null, 2))
console.log(`\n완료 ${done}/${moves.length}. manifest: ${path.relative(DL, MANIFEST)}`)
console.log('다음: npm run build → proxy 재시작.')
