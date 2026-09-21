/**
 * 음성 검수 CLI (2026-09-21) — 클립의 대사 발음·애드립을 음성 인식으로 대본과 비교한다. 로직은 server/lib/voiceQa.js.
 *
 * 사용법
 *   node scripts/voice-qa.js --file=<영상/음성 경로> --expected="대본 대사"     (단일 파일 시험 — 대사를 비우면 "말하지 않아야 하는 컷"으로 검사)
 *   node scripts/voice-qa.js --ep=IG_R04 [--cut=2] [--diarize]                   (에피소드 클립 일괄: 04_making/raw/cut_NN_clip_K.mp4 ↔ 컷 대사)
 * 결과는 downloads/state/voice-qa.json 에 저장(에피소드 일괄일 때). 크레딧: 클립당 음성 인식 1회.
 */
import fs from 'fs'
import path from 'path'
import * as mp from '../server/lib/mediaPaths.js'
import { checkClip, loadQa, saveQa } from '../server/lib/voiceQa.js'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(0, i).replace(/^--/, ''), a.slice(i + 1)] }))
const SERVER = 'http://localhost:3001'
const QA_PATH = mp.statePath('voice-qa.json')
const apiKey = process.env.ELEVENLABS_API_KEY || (() => { try { return JSON.parse(fs.readFileSync(path.join(mp.DOWNLOADS, '..', 'app', 'studio-secrets.json'), 'utf-8')).apiKeys?.elevenLabs } catch { return '' } })()

const icon = { ok: '✅', warn: '⚠️', fail: '❌' }
function show(name, r) {
  console.log(`${icon[r.verdict] || '?'} ${name}  [${r.verdict}]  일치율 ${(r.ratio * 100).toFixed(0)}%`)
  console.log(`   대본: ${r.expected || '(대사 없음)'}`)
  console.log(`   들림: ${r.heard || '(없음)'}`)
  for (const f of r.flags) console.log(`   · [${f.severity}] ${f.message}`)
}

// 음색 일관성: 대사가 있는 컷의 원본 음성끼리 화자 임베딩 유사도를 잰다(scripts/voice_embed.py). 기준(서여리 TTS) 대비도 함께 본다.
// 초깃값: 다른 컷들과의 평균 유사도가 0.75 미만이면 "음색이 튀는 컷"으로 표시(2026-09-21 실측: Veo 원본끼리 0.83, Veo↔서여리 TTS 0.60~0.75).
const CONSISTENCY_MIN = 0.75   // 2026-09-21 귀 확인: R04 컷1·2·3(유사도 0.79~0.83)은 "거의 같은 목소리"로 들림 → 0.80은 과하게 엄격해 0.75로 낮춤
function consistency(epCode, byCut, rawDir, ep) {
  const items = []
  for (const cut of ep.cuts || []) {
    if (!String(cut.dialogue || '').trim()) continue
    const c = (byCut[cut.no] || []).sort((a, b) => a.k - b.k)[0]
    if (c) items.push({ name: `컷${cut.no}`, path: path.join(rawDir, c.f) })
  }
  if (items.length < 2) { console.log('음색 일관성: 비교할 대사 컷이 2개 미만입니다'); return }
  const ref = String(args.ref || '').split(',').map(s => s.trim()).filter(Boolean)
  const refs = ref.length ? ref : ['01', '03', '10', '20'].map(n => path.join(mp.DOWNLOADS, 'seoyeori', 'YU', 'LF_T', 'LF_T01', '03_audio', `cut_${n}.mp3`)).filter(f => fs.existsSync(f))
  const cfgPath = path.join(mp.runtimeDir(), `voice_embed_${Date.now()}.json`)
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
  fs.writeFileSync(cfgPath, JSON.stringify({ items, reference: refs }), 'utf-8')
  const r = spawnSync('python', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'voice_embed.py'), cfgPath], { encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  try { fs.unlinkSync(cfgPath) } catch { /* noop */ }
  const line = String(r.stdout || '').trim().split(/\r?\n/).filter(l => l.startsWith('{')).pop()
  if (!line) { console.log('음색 일관성 측정 실패:', String(r.stderr || '').slice(-300)); return }
  const d = JSON.parse(line)
  console.log('')
  console.log('음색 일관성(1.0에 가까울수록 같은 화자):')
  console.log('        ' + d.names.map(n => n.padStart(6)).join(' ') + '   기준(서여리 TTS)')
  d.names.forEach((n, i) => {
    const others = d.matrix[i].filter((_, j) => j !== i)
    const mean = others.reduce((a, b) => a + b, 0) / others.length
    console.log(n.padEnd(7) + d.matrix[i].map(v => v.toFixed(2).padStart(6)).join(' ') + `   ${d.vsReference ? d.vsReference[i].toFixed(2) : '-'}   평균 ${mean.toFixed(2)}${mean < CONSISTENCY_MIN ? '  ⚠ 음색이 튐' : ''}`)
  })
}

async function main() {
  if (args.file) {
    const r = await checkClip({ videoPath: path.resolve(args.file), expected: args.expected === true ? '' : String(args.expected || ''), apiKey, diarize: !!args.diarize })
    show(path.basename(args.file), r)
    return
  }
  if (!args.ep) { console.error('--file 또는 --ep 필요'); process.exit(2) }
  const st = await (await fetch(`${SERVER}/api/studio-state`)).json()
  const S = st.d || st
  const ep = Object.values(S.episodes || {}).find(e => e.episode?.code === args.ep)
  if (!ep) throw new Error(`에피소드 ${args.ep} 없음`)
  const rawDir = path.join(mp.makingDir(args.ep), 'raw')
  const files = fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : []
  const byCut = {}
  for (const f of files) { const m = f.match(/^cut_(\d+)_clip_(\d+)\.mp4$/i); if (m) (byCut[Number(m[1])] ||= []).push({ f, k: Number(m[2]) }) }
  const qa = loadQa(QA_PATH)
  qa[args.ep] ||= {}
  for (const cut of ep.cuts || []) {
    if (args.cut && Number(args.cut) !== cut.no) continue
    const clips = (byCut[cut.no] || []).sort((a, b) => a.k - b.k)
    // 같은 내용의 복사본(크기가 같은 파일)은 한 번만 검사
    const seen = new Set()
    const uniq = clips.filter(c => { const sz = fs.statSync(path.join(rawDir, c.f)).size; if (seen.has(sz)) return false; seen.add(sz); return true })
    for (const c of uniq) {
      const r = await checkClip({ videoPath: path.join(rawDir, c.f), expected: cut.dialogue || '', apiKey, diarize: !!args.diarize, partial: uniq.length > 1 })
      ;(qa[args.ep][cut.no] ||= {})[c.f] = r
      show(`${args.ep} 컷${cut.no} ${c.f}`, r)
    }
  }
  saveQa(QA_PATH, qa)
  if (args.consistency) consistency(args.ep, byCut, rawDir, ep)
  console.log(`\n저장: ${QA_PATH}`)
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
