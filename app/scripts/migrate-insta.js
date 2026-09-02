// ── downloads/insta/{content}/{num}/ → seoyeori/IG/{series}/{code}/ (1회성) ──
//   FD/PT(피드) → IG_P   ·   RL(릴스) → IG_R   ·   ST(스토리) → IG_S
//   num의 숫자만 뽑아 IG_{K}{NN}. 파일: *.txt·*.html → 01_script/, 나머지 → 02_images/
//   (project_url.txt만 예외로 02_images/)
//
//   node scripts/migrate-insta.js         # dry-run
//   node scripts/migrate-insta.js --go
//   node scripts/migrate-insta.js --undo

import fs from 'node:fs'
import path from 'node:path'

const DL = path.join('C:\\yeori-studio', 'downloads')
const INSTA = path.join(DL, 'insta')
const GO = process.argv.includes('--go')
const UNDO = process.argv.includes('--undo')
const MANIFEST = path.join(DL, 'state', 'migrate-insta-manifest.json')
const ARCHIVE = path.join(DL, '_archive', '2026-09-02', 'insta-residue')

const K = { FD: 'P', PT: 'P', RL: 'R', ST: 'S' }
const has = (p) => fs.existsSync(p)
const list = (p) => { try { return fs.readdirSync(p) } catch { return [] } }
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }

const used = new Set()   // IG_P01 중복(FD P01 + PT PT01) 방지
function instaCode(content, num) {
  const digits = (String(num).match(/\d+/) || ['1'])[0].padStart(2, '0')
  let code = `IG_${K[content] || 'P'}${digits}`
  while (used.has(code)) code = `IG_${K[content] || 'P'}${String(+code.match(/\d+/)[0] + 1).padStart(2, '0')}`
  used.add(code)
  return code
}
function subFor(name) {
  if (name === 'project_url.txt') return '02_images'
  if (/\.(txt|html?)$/i.test(name)) return '01_script'
  return '02_images'
}

const moves = []
for (const content of list(INSTA)) {
  const cdir = path.join(INSTA, content)
  if (!isDir(cdir)) continue
  for (const num of list(cdir)) {
    const ndir = path.join(cdir, num)
    if (!isDir(ndir)) continue
    const code = instaCode(content, num)
    const dest = path.join(DL, 'seoyeori', 'IG', `IG_${K[content] || 'P'}`, code)
    const walk = (rel = '') => {
      for (const f of list(path.join(ndir, rel))) {
        const src = path.join(ndir, rel, f)
        if (isDir(src)) { walk(path.join(rel, f)); continue }
        if (/\.old$/i.test(f)) { moves.push({ from: src, to: path.join(ARCHIVE, content, num, rel, f) }); continue }
        moves.push({ from: src, to: path.join(dest, subFor(f), f) })
      }
    }
    walk()
  }
}

function mv(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (has(to)) {
    // 대상에 본 파이프라인 버전이 이미 있으면 insta 쪽은 아카이브 (본 버전이 우선)
    const arch = path.join(ARCHIVE, '_dup', path.basename(from))
    fs.mkdirSync(path.dirname(arch), { recursive: true })
    fs.renameSync(from, has(arch) ? arch + '.' + Date.now() : arch)
    console.warn(`  ⚠ 대상 존재 → insta본 아카이브: ${path.basename(from)}`)
    return
  }
  fs.renameSync(from, to)
}

if (UNDO) {
  if (!has(MANIFEST)) { console.error('manifest 없음'); process.exit(1) }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'))
  for (const { from, to } of [...m.moves].reverse()) {
    if (has(to) && !has(from)) { fs.mkdirSync(path.dirname(from), { recursive: true }); fs.renameSync(to, from); console.log(`  ← ${path.relative(DL, to)}`) }
  }
  process.exit(0)
}

console.log(`${GO ? '실행' : 'DRY-RUN'} — ${moves.length}건\n`)
for (const { from, to } of moves) console.log(`  ${path.relative(DL, from)}  →  ${path.relative(DL, to)}`)
if (!GO) { console.log('\n--go 로 실제 이동.'); process.exit(0) }

let done = 0
for (const { from, to } of moves) { try { mv(from, to); done++ } catch (e) { console.error(`  ✗ ${e.message}`) } }
// 빈 insta/ 정리
const rmEmpty = (d) => { for (const f of list(d)) { const p = path.join(d, f); if (isDir(p)) rmEmpty(p) } try { fs.rmdirSync(d) } catch { /* not empty */ } }
rmEmpty(INSTA)
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true })
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), moves }, null, 2))
console.log(`\n완료 ${done}/${moves.length}. manifest: ${path.relative(DL, MANIFEST)}`)
