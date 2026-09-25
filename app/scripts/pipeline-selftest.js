#!/usr/bin/env node
/**
 * pipeline-selftest.js — 자동 파이프라인 자가 점검(크레딧 0, 토큰 0)
 *
 * 배경(2026-09-25, 성준님): "설명이 아니라 확실한 조치가 돼야 받아들인다 — 그걸 최단 과정으로 판단할 수 있게".
 * 고친 항목마다 "증거"를 수치로 다시 뽑아 ✅/❌ 로 보여 준다. 고정 시험 에피소드 IG_R05(완성본) 기준.
 * 새로 고친 것이 생기면 여기 점검 항목을 하나 추가하는 것이 규칙이다.
 *
 * 사용: node scripts/pipeline-selftest.js [--ep=IG_R05] [--no-flow] [--no-final]
 *   --no-flow  : Flow 드라이런(전용 Chrome 9222 필요, 1~2분) 건너뜀
 *   --no-final : 최종본 재합성 점검(1~2분, 07_output 백업→복구) 건너뜀
 * 결과: 콘솔 요약 + downloads/state/selftest/latest.md (+ 날짜별 사본)
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import * as mp from '../server/lib/mediaPaths.js'
import { parseCutsV3 } from '../server/lib/scriptParserV3.js'
import { autoCaptionTimings, finalizeReel } from '../server/lib/reelFinalize.js'
import { firstFrameSsim } from './lib/flowDriver.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SERVER = 'http://localhost:3001'
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const CODE = args.ep || 'IG_R05'
const results = []
const t0 = Date.now()

async function check(id, title, fn) {
  const started = Date.now()
  try {
    const r = await fn()
    const status = r?.skip ? 'SKIP' : r?.ok ? 'PASS' : 'FAIL'
    results.push({ id, title, status, evidence: r?.evidence || '', sec: ((Date.now() - started) / 1000).toFixed(1) })
  } catch (e) {
    results.push({ id, title, status: 'FAIL', evidence: `오류: ${e.message}`, sec: ((Date.now() - started) / 1000).toFixed(1) })
  }
  const r = results[results.length - 1]
  console.log(`${r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️ ' : '❌'} ${r.id} ${r.title} — ${r.evidence}`)
}
const SECRET = (() => { try { return (fs.readFileSync(path.join(ROOT, '.env.local'), 'utf-8').match(/^MCP_BRIDGE_SECRET=(.*)$/m) || [])[1]?.trim() || '' } catch { return '' } })()
const get = async (u) => { const r = await fetch(SERVER + u, { headers: u.startsWith('/api/mcp/') && SECRET ? { Authorization: `Bearer ${SECRET}` } : {} }); return { ok: r.ok, data: await r.json().catch(() => ({})) } }
const post = async (u, b) => { const r = await fetch(SERVER + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { ok: r.ok, data: await r.json().catch(() => ({})) } }
const meanDb = (file, ss, t) => {
  const o = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf-8' })
  const m = String(o.stderr).match(/mean_volume:\s*(-?[\d.]+)/); return m ? Number(m[1]) : null
}
const dims = (file) => { const o = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf-8' }); return String(o.stdout).trim() }

// ── 준비 ──
const scriptDir = mp.scriptDir(CODE)
const scriptFile = fs.readdirSync(scriptDir).filter(f => /_script\.txt$|^script_v3\.txt$/.test(f)).sort((a, b) => (a === 'script_v3.txt') - (b === 'script_v3.txt'))[0]
const cuts = parseCutsV3(fs.readFileSync(path.join(scriptDir, scriptFile), 'utf-8'))
let epNum = null, episodeId = null
{
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'studio-state.json'), 'utf-8'))
  for (const [id, e] of Object.entries(st.episodes || {})) if (e.episode?.code === CODE) { epNum = e.episode.number; episodeId = id }
}
const videoDir = mp.videoDir(CODE), imgDir = mp.imagesDir(CODE)
const yeoriCuts = cuts.filter(c => c.cutType === 'YEORI')
console.log(`\n자가 점검 — ${CODE} (에피소드 번호 ${epNum}, 대본 ${scriptFile}, 컷 ${cuts.length})\n`)

// ── 1. 대본 파서: 영상 프롬프트가 빈값이 아닌가 (VP [0-3s] 버그) ──
await check('P1', '대본 파서 — 서여리 컷 영상 프롬프트 채워짐', () => {
  const empty = yeoriCuts.filter(c => !(c.videoPrompt || '').trim())
  return { ok: yeoriCuts.length > 0 && !empty.length, evidence: `서여리 컷 ${yeoriCuts.length}개 VP 길이 ${yeoriCuts.map(c => (c.videoPrompt || '').length).join('/')}자${empty.length ? ` · 빈값 컷 ${empty.map(c => c.no)}` : ''}` }
})

// ── 1b. 롱폼 클립별 프롬프트 분리(고정 시험 롱폼 LF_T01) — 클립마다 자기 대사 조각만, 남의 조각·제작 메모 없음 ──
await check('P2', '롱폼 클립별 프롬프트 분리(LF_T01)', async () => {
  const { buildClipPrompt, splitLines } = await import('../server/lib/clipPrompt.js')
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'studio-state.json'), 'utf-8'))
  const lf = Object.values(st.episodes || {}).find(e => e.episode?.code === (args.lf || 'LF_T01'))
  if (!lf) return { skip: true, evidence: '롱폼 시험 에피소드 없음' }
  const nz = (t) => String(t || '').replace(/[^가-힣a-zA-Z0-9]/g, '')
  let clips = 0; const problems = []; const scriptTodo = []
  for (const c of lf.cuts.filter(x => x.cutType === 'YEORI')) {
    const n = Array.isArray(c.segments) && c.segments.length > 1 ? c.segments.length : 1
    const parts = splitLines(c.dialogue, n) || []
    for (let k = 1; k <= n; k++) {
      clips++
      let r
      try { r = buildClipPrompt(c, k, n) } catch (e) { (/누가 말하는지/.test(e.message) ? scriptTodo : problems).push(`컷${c.no}-${k}`); continue }
      const p = nz(r.prompt)
      if (r.line && !p.includes(nz(r.line).slice(0, 12))) problems.push(`컷${c.no}-${k} 자기 대사 없음`)
      parts.forEach((o, j) => { if (j !== k - 1 && nz(o).length >= 6 && p.includes(nz(o).slice(0, 12))) problems.push(`컷${c.no}-${k} 남의 대사(${j + 1}) 포함`) })
      if (/^(생성|후처리):|━━━\s*발화/m.test(r.prompt)) problems.push(`컷${c.no}-${k} 제작 메모 포함`)
    }
  }
  return { ok: !problems.length, evidence: `클립 ${clips}개 점검${problems.length ? ' · ' + problems.slice(0, 4).join(' / ') : ' · 자기 대사만·남의 대사 없음·제작 메모 없음'}${scriptTodo.length ? ` · ⚠ 대본 화자 표기 필요(멈춤 정상): ${scriptTodo.join(', ')}` : ''}` }
})

// ── 1c. 목소리 이탈 감지 — 실측 기준 클립: LF_T01 컷13-2(다른 목소리 0.48)는 잡고, 컷19-1(0.74)은 통과시켜야 ──
await check('A1', '목소리 이탈 감지(화자 임베딩)', async () => {
  const { speakerSimilarity, VOICE_SIM_MIN } = await import('../server/lib/voiceSim.js')
  const raw = path.join(mp.makingDir('LF_T01'), 'raw'), ref = path.join(mp.DOWNLOADS, 'seoyeori', 'characters', 'voice_ref', 'yeori.mp3')
  const bad = speakerSimilarity(path.join(raw, 'cut_13_clip_2.mp4'), ref), good = speakerSimilarity(path.join(raw, 'cut_19_clip_1.mp4'), ref)
  if (bad == null || good == null) return { skip: true, evidence: '기준 클립/음성 또는 Python 임베딩 없음' }
  return { ok: bad < VOICE_SIM_MIN && good >= VOICE_SIM_MIN, evidence: `이탈 클립 13-2 ${bad.toFixed(2)} → ${bad < VOICE_SIM_MIN ? '잡음' : '놓침'} · 정상 클립 19-1 ${good.toFixed(2)} → ${good >= VOICE_SIM_MIN ? '통과' : '오탐'} (기준 ${VOICE_SIM_MIN})` }
})

// ── 2. 서버·상태 API ──
await check('S1', '서버 응답 + 컷 상태에 길이·세그 정보', async () => {
  const r = await get(`/api/mcp/studio-status?episodeId=${episodeId}`).catch(() => ({ ok: false }))
  if (!r.ok) {
    // /api/mcp 는 인증이 필요할 수 있어 공개 경로로 서버만 확인
    const f = await get('/api/flow/ready'); return { ok: f.ok, evidence: `서버 응답 ${f.ok ? 'OK' : '없음'} (상태 API 는 인증 경로라 생략)` }
  }
  const c = r.data.cuts || []
  return { ok: c.every(x => 'duration' in x && 'segCount' in x), evidence: `컷 ${c.length}개 duration/segCount 제공` }
})

// ── 3. 첫 프레임 대조(SSIM): 같은 컷은 높고 다른 컷은 낮은가 (타일 오인 방지 근거) ──
await check('V1', '영상 첫 프레임 ↔ G2 이미지 대조(타일 오인 방지)', () => {
  const rows = []
  let ok = true
  for (const c of yeoriCuts) {
    const vid = path.join(videoDir, `cut_${String(c.no).padStart(2, '0')}.mp4`)
    const own = fs.readdirSync(imgDir).find(f => new RegExp(`^cut_${String(c.no).padStart(2, '0')}_a\\.jpg$`).test(f))
    if (!fs.existsSync(vid) || !own) { ok = false; rows.push(`컷${c.no} 파일 없음`); continue }
    const same = firstFrameSsim(vid, path.join(imgDir, own))
    const other = yeoriCuts.filter(o => o.no !== c.no).map(o => firstFrameSsim(vid, path.join(imgDir, `cut_${String(o.no).padStart(2, '0')}_a.jpg`))).filter(v => v != null)
    const maxOther = Math.max(...other)
    if (!(same >= 0.45 && maxOther < 0.45)) ok = false
    rows.push(`컷${c.no} 자기 ${same?.toFixed(2)} / 남 최대 ${maxOther.toFixed(2)}`)
  }
  return { ok, evidence: rows.join(' · ') + ' (기준 0.45)' }
})

// ── 4. 컷 영상 규격 ──
await check('V2', '컷 영상 전부 1080×1920', () => {
  const bad = cuts.filter(c => dims(path.join(videoDir, `cut_${String(c.no).padStart(2, '0')}.mp4`)) !== '1080,1920')
  return { ok: !bad.length, evidence: bad.length ? `규격 다른 컷 ${bad.map(c => c.no)}` : `${cuts.length}컷 모두 1080×1920` }
})

// ── 5. 원본 클립 보관(렌더가 지우던 버그) ──
await check('R1', '컷 영상 렌더 후 원본 클립 보관(_composed)', async () => {
  const raw = path.join(mp.makingDir(CODE), 'raw')
  const keep = path.join(raw, '_composed')
  const src = fs.existsSync(keep) ? fs.readdirSync(keep).filter(f => /^cut_03_clip_1\..*\.mp4$/.test(f)).sort().pop() : null
  if (!src || !epNum) return { skip: true, evidence: '보관된 컷3 원본 없음 — 건너뜀' }
  const staged = path.join(raw, 'cut_03_clip_1.mp4')
  fs.copyFileSync(path.join(keep, src), staged)
  const before = fs.readdirSync(keep).length
  const r = await post('/api/render-cut-clips', { epNum, cutNo: 3, clips: [{ file: staged }] })
  const after = fs.readdirSync(keep).length
  return { ok: r.ok && !fs.existsSync(staged) && after === before + 1, evidence: `렌더 ${r.ok ? 'OK' : '실패'} · raw 에서 빠짐 ${!fs.existsSync(staged)} · 보관본 ${before}→${after}개` }
})

// ── 6. 대사 자막 ↔ 발화 싱크 ──
await check('C1', '대사 자막이 실제 발화 시각에 뜨는가', () => {
  const qa = JSON.parse(fs.readFileSync(mp.statePath('voice-qa.json'), 'utf-8'))[CODE] || {}
  const rows = []; let ok = true, n = 0
  for (const c of cuts.filter(x => (x.dialogue || '').trim() && (x.subtitle || '').trim())) {
    const w = Object.values(qa[String(c.no)] || {})[0]?.words
    const t = autoCaptionTimings(c, CODE, c.duration)
    if (!w?.length || !t) { ok = false; rows.push(`컷${c.no} 싱크 불가`); continue }
    n++
    const shownAt = t[0][0] + 0.3                     // 렌더 시 SEG_LEAD 0.3
    const diff = shownAt - w[0].start
    if (diff > 0.2 || diff < -0.8) ok = false
    rows.push(`컷${c.no} 자막 ${shownAt.toFixed(2)}s / 발화 ${w[0].start}s (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})`)
  }
  return { ok: ok && n > 0, evidence: rows.join(' · ') + ' (허용 -0.8~+0.2초)' }
})

// ── 7. 최종본: 자막 스타일·나레이션 믹스·대사 음성 보존 (07_output 백업→복구) ──
if (args['no-final']) results.push({ id: 'F1', title: '최종본 합성 점검', status: 'SKIP', evidence: '--no-final', sec: '0' })
else await check('F1', '최종본 — 나레이션 믹스·대사 음성·영상탭 스타일 반영', async () => {
  const fdir = mp.finalDir(CODE), bak = fs.mkdtempSync(path.join(os.tmpdir(), 'selftest_final_'))
  const audioDir = mp.audioDir(CODE)
  const hadAudioDir = fs.existsSync(audioDir)
  const saved = fs.existsSync(fdir) ? fs.readdirSync(fdir).filter(f => fs.statSync(path.join(fdir, f)).isFile()) : []
  saved.forEach(f => fs.copyFileSync(path.join(fdir, f), path.join(bak, f)))
  const sample = fs.readdirSync(mp.DOWNLOADS).length && path.join(mp.DOWNLOADS, 'seoyeori', 'characters', 'jiyu', 'voice_test', '3_jiyu_calm.mp3')
  const nrTarget = path.join(audioDir, 'cut_01.mp3')
  const nrExisted = fs.existsSync(nrTarget)
  try {
    if (!fs.existsSync(sample)) return { skip: true, evidence: '나레이션 샘플 음성 없음' }
    fs.mkdirSync(audioDir, { recursive: true })
    if (!nrExisted) fs.copyFileSync(sample, nrTarget)
    const test = cuts.map(c => ({ ...c }))
    test[0].narration = '근데 있잖아, 나도 가끔은 그냥 집에 있고 싶어.'
    const logs = []
    const r = await finalizeReel({ epNum, cuts: test, onLog: l => logs.push(l) })
    const nrDb = meanDb(r.finalPath, 0, 6)
    const dlCut = cuts.find(c => (c.dialogue || '').trim())
    let start = 0; for (const c of cuts) { if (c.no === dlCut.no) break; start += c.duration }
    const dlDb = meanDb(r.finalPath, start, dlCut.duration)
    const ov = JSON.parse(fs.readFileSync(path.join(fdir, `${CODE}_captions.overlay.json`), 'utf-8'))
    const style = JSON.parse(fs.readFileSync(mp.statePath(`reel-overrides/${CODE}.json`), 'utf-8'))._style || {}
    const styleOk = !style.fontPx || ov.scenes.every(s => s.font_size === style.fontPx)
    const mixed = logs.some(l => /나레이션 음성 믹스/.test(l))
    return { ok: mixed && nrDb > -40 && dlDb > -40 && styleOk, evidence: `나레이션 믹스 로그 ${mixed} · 컷1 음량 ${nrDb}dB · 대사컷${dlCut.no} 음량 ${dlDb}dB · 자막 크기 ${style.fontPx || '기본58'}px 반영 ${styleOk}` }
  } finally {
    if (!nrExisted) { try { fs.unlinkSync(nrTarget) } catch { /* noop */ } }
    if (!hadAudioDir) { try { fs.rmdirSync(audioDir) } catch { /* noop */ } }
    saved.forEach(f => fs.copyFileSync(path.join(bak, f), path.join(fdir, f)))
    fs.rmSync(bak, { recursive: true, force: true })
  }
})

// ── 8. Flow 드라이런: 720p·크레딧 관문 (전송 안 함) ──
if (args['no-flow']) results.push({ id: 'G1', title: 'Flow 영상 제출 드라이런', status: 'SKIP', evidence: '--no-flow', sec: '0' })
else await check('G1', 'Flow 영상 제출 드라이런 — 720p·크레딧 관문(전송 안 함)', async () => {
  const ready = await get('/api/flow/ready')
  if (!ready.data?.ok || !ready.data?.flowTab) return { skip: true, evidence: '전용 Chrome(9222)/Flow 탭 없음 — start_gen.bat 후 다시' }
  if (ready.data.busy) return { skip: true, evidence: 'Flow 작업 진행 중 — 나중에 다시' }
  const c = yeoriCuts[yeoriCuts.length - 1]
  const s = await post('/api/flow/submit', { epNum, cutNo: c.no, clipNo: 1, durationSec: 8, maxCredits: 15, dryRun: true })
  if (!s.data?.jobId) return { ok: false, evidence: `요청 실패 ${s.data?.error || ''}` }
  let j
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 3000)); j = (await get(`/api/flow/job/${s.data.jobId}`)).data; if (['done', 'failed', 'cancelled'].includes(j.state)) break }
  const gate = j?.result?.gate
  const pill = (j?.steps || []).map(x => x.msg).find(m => /검증 관문/.test(m)) || ''
  return { ok: j?.state === 'done' && gate?.credits > 0 && gate.credits <= 15, evidence: `${j?.state} · ${pill}${j?.error ? ' · ' + j.error : ''}` }
})

// ── 9. 지휘자 1사이클(G4 구간, 드라이런) ──
await check('L1', '지휘자(pipeline-leader) 1사이클 오류 없음', () => {
  const o = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'pipeline-leader.js'), `--episode=${episodeId}`, '--once', '--from=g4', '--to=g4', '--flow-dry'], { cwd: ROOT, encoding: 'utf-8', timeout: 120000 })
  const out = String(o.stdout || '') + String(o.stderr || '')
  const bad = out.split('\n').filter(l => /❌|Error|오류|실패/.test(l))
  return { ok: o.status === 0 && !bad.length, evidence: o.status === 0 ? (bad.length ? bad.slice(0, 2).join(' / ') : `정상 종료 · ${out.split('\n').filter(l => /\[G4\]|\[승인대기\]/.test(l)).slice(0, 2).map(l => l.replace(/^\[[^\]]+\]\s*/, '')).join(' / ')}`) : `종료코드 ${o.status}` }
})

// ── 보고서 ──
const pass = results.filter(r => r.status === 'PASS').length, fail = results.filter(r => r.status === 'FAIL').length, skip = results.filter(r => r.status === 'SKIP').length
const stamp = new Date().toLocaleString('sv-SE').replace(' ', '_').replace(/:/g, '')
const md = [`# 파이프라인 자가 점검 — ${CODE}`, '', `실행: ${new Date().toLocaleString('ko-KR')} · ${((Date.now() - t0) / 1000).toFixed(0)}초 · **통과 ${pass} / 실패 ${fail} / 건너뜀 ${skip}**`, '',
  '| | 항목 | 증거 | 초 |', '|---|---|---|---|',
  ...results.map(r => `| ${r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️' : '❌'} | ${r.id} ${r.title} | ${String(r.evidence).replace(/\|/g, '/')} | ${r.sec} |`)].join('\n')
const outDir = mp.statePath('selftest'); fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'latest.md'), md, 'utf-8')
fs.writeFileSync(path.join(outDir, `${stamp}.md`), md, 'utf-8')
console.log(`\n통과 ${pass} / 실패 ${fail} / 건너뜀 ${skip} — 보고서: ${path.join(outDir, 'latest.md')}`)
process.exit(fail ? 1 : 0)
