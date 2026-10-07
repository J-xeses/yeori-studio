#!/usr/bin/env node
// 코드 표기 정리(2026-10-07 성준님 결정) — 초안이 지어 쓴 코드를 레퍼런스(codebook) 표기로 바꾼다.
//   SH_TEXT → SH_TXT
//   IN.BK / GR.BK(검정 배경) → GR.BLK   (BK 는 장소 "은행")
//   IN.PK(파스텔 배경) → GR.PST          (PK 는 장소 "공원")
//   IN.DM → GR.DM · IN.SC → GR.SCR
// 대상: studio-state.json 의 컷 masterCode(sp·sh) + scriptRaw, 각 에피소드 01_script 의 최신 대본 txt.
// 기본은 미리보기(무엇이 바뀌는지만 출력). 실제 적용은 --apply (studio-state 백업 후 저장 — 앱 탭을 닫고 실행).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APPLY = process.argv.includes('--apply')
const STATE = path.join(APP, 'studio-state.json')

// 장소 코드로 쓰인 것만 바꾼다(OT.PK = 실제 공원은 그대로). 뒤에 붙은 "(검정 배경)" 같은 풀이는 유지.
const RULES = [
  [/\bSH_TEXT\b/g, 'SH_TXT'],
  [/\b(?:IN|GR)\.BK\b/g, 'GR.BLK'],
  [/\bIN\.PK\b/g, 'GR.PST'],
  [/\bIN\.DM\b/g, 'GR.DM'],
  [/\bIN\.SC\b/g, 'GR.SCR'],
  // IN.IN = 장소 특정 없는 실내를 임시로 적은 것 → IN.RM(실내 일반) + 조명(자연광이면 창가 자연광, 아니면 따뜻한 빛)
  [/\bIN\.IN\b(?=\s*\([^)]*자연광)/g, 'IN.RM.LT_WD'],
  [/\bIN\.IN\b/g, 'IN.RM.LT_WM'],
]
const fix = (v) => RULES.reduce((s, [re, to]) => s.replace(re, to), String(v))

const st = JSON.parse(fs.readFileSync(STATE, 'utf-8'))
let cutChanges = 0, rawChanges = 0
const scriptFiles = new Set()
const touch = (cuts, epCode, where) => {
  for (const c of cuts || []) {
    const mc = c.masterCode
    if (!mc) continue
    for (const k of ['sp', 'sh']) {
      if (mc[k] == null) continue
      const next = fix(mc[k])
      if (next !== mc[k]) { console.log(`${epCode} 컷${c.no} ${k.toUpperCase()}: ${mc[k]} → ${next}${where}`); mc[k] = next; cutChanges++ }
    }
  }
}
for (const ep of Object.values(st.episodes || {})) {
  const code = ep.episode?.code || '?'
  touch(ep.cuts, code, '')
  if (typeof ep.scriptRaw === 'string') { const n = fix(ep.scriptRaw); if (n !== ep.scriptRaw) { ep.scriptRaw = n; rawChanges++; console.log(`${code} 저장된 대본 원문`) } }
}
// 활성 에피소드는 최상위(state.cuts/scriptRaw)에도 같은 내용이 있다
touch(st.cuts, '(지금 열린 에피소드)', '')
if (typeof st.scriptRaw === 'string') { const n = fix(st.scriptRaw); if (n !== st.scriptRaw) { st.scriptRaw = n; rawChanges++ } }

// 01_script 의 최신 txt (에피소드별 1개)
const DL = path.resolve(APP, '..', 'downloads', 'seoyeori')
const walk = (dir, depth = 0) => {
  if (depth > 4 || !fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue
    const full = path.join(dir, e.name)
    if (e.name === '01_script') {
      const txts = fs.readdirSync(full).filter(f => /\.txt$/i.test(f)).map(f => path.join(full, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      if (txts[0]) { const raw = fs.readFileSync(txts[0], 'utf-8'); if (fix(raw) !== raw) scriptFiles.add(txts[0]) }
    } else walk(full, depth + 1)
  }
}
walk(DL)
for (const f of scriptFiles) console.log(`대본 파일: ${path.relative(DL, f)}`)

console.log(`\n컷 코드 ${cutChanges}곳 · 저장된 대본 원문 ${rawChanges}개 · 대본 파일 ${scriptFiles.size}개`)
if (!APPLY) { console.log('미리보기만 했습니다. 적용: node scripts/migrate-codes-20261007.js --apply'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
const bdir = path.join(APP, 'downloads', 'state'); fs.mkdirSync(bdir, { recursive: true })
fs.copyFileSync(STATE, path.join(bdir, `_studio-state.backup_${stamp}_before-code-migrate.json`))
fs.writeFileSync(STATE, JSON.stringify(st, null, 2), 'utf-8')
for (const f of scriptFiles) { fs.copyFileSync(f, f + `.bak_${stamp}`); fs.writeFileSync(f, fix(fs.readFileSync(f, 'utf-8')), 'utf-8') }
console.log('적용 완료 (백업: downloads/state/_studio-state.backup_' + stamp + '_before-code-migrate.json)')
