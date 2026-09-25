#!/usr/bin/env node
/**
 * clip-prompts.js — 영상 생성 도구에 들어갈 "클립별 프롬프트"를 제출 전에 미리 보여 준다(크레딧 0).
 * 사용: node scripts/clip-prompts.js --ep=LF_T01 [--cut=3]
 * 결과: 콘솔 요약 + downloads/state/clip-prompts/{CODE}.md (클립마다 실제 들어갈 전문)
 * 규칙은 server/lib/clipPrompt.js (flow-submit 이 쓰는 것과 같은 함수).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as mp from '../server/lib/mediaPaths.js'
import { buildClipPrompt } from '../server/lib/clipPrompt.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const code = args.ep
if (!code) { console.error('--ep=<코드> 필요'); process.exit(2) }
const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'studio-state.json'), 'utf-8'))
const ep = Object.values(st.episodes || {}).find(e => e.episode?.code === code)
if (!ep) { console.error(`에피소드 ${code} 없음`); process.exit(2) }

const cuts = (ep.cuts || []).filter(c => c.cutType === 'YEORI' && (!args.cut || c.no === Number(args.cut)))
const md = [`# 클립별 영상 프롬프트 — ${code}`, '', `생성: ${new Date().toLocaleString('ko-KR')} · 규칙 server/lib/clipPrompt.js`, '']
let ok = 0, bad = 0
for (const c of cuts) {
  const n = Array.isArray(c.segments) && c.segments.length > 1 ? c.segments.length : 1
  md.push(`## 컷 ${c.no} — 클립 ${n}개${n > 1 ? ` (${c.segments.join('+')}초)` : ''}`, '', `대본 DL: ${c.dialogue || '(없음)'}${c.narration ? ` · NR: ${c.narration}` : ''}`, '')
  for (let k = 1; k <= n; k++) {
    try {
      const r = buildClipPrompt(c, k, n)
      ok++
      console.log(`✅ 컷${c.no} 클립${k}/${n} [${r.visualSource}] 대사: ${r.line ? `"${r.line}"` : '(말 안 함)'} · ${r.prompt.length}자`)
      md.push(`### 클립 ${k}/${n} — 화면 출처: ${r.visualSource} · 이 클립 대사: ${r.line ? `"${r.line}"` : '(말 안 함)'}`, '', '```', r.prompt, '```', '')
    } catch (e) {
      bad++
      console.log(`❌ 컷${c.no} 클립${k}/${n} — ${e.message}`)
      md.push(`### 클립 ${k}/${n} — ❌ ${e.message}`, '')
    }
  }
}
const outDir = mp.statePath('clip-prompts'); fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, `${code}.md`)
fs.writeFileSync(out, md.join('\n'), 'utf-8')
console.log(`\n클립 ${ok + bad}개 중 정상 ${ok} · 멈춤 ${bad} — 전문: ${out}`)
process.exit(bad ? 1 : 0)
