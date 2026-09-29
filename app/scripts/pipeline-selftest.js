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

// ── 1b2. Veo 클립 프롬프트 오디오 문단 + 좌우 위치 태그(2026-09-28, IG_R06 현장 실측 2건) ──
// 컷2: 대사 없는 컷의 대본 오디오 지시(BGM/웃음소리)가 Veo에 전혀 안 전달돼 비트 없는 클립이 나왔음.
// 컷3: 두 사람이 나오는데 Veo가 여러 시도에서 누구 대사인지 헷갈려함 — 이름 옆 좌/우 표기로 해결.
const r06Dir = (() => { try { return mp.scriptDir('IG_R06') } catch { return null } })()
const r06ScriptFile = r06Dir && fs.existsSync(r06Dir)
  ? fs.readdirSync(r06Dir).filter(f => /_script\.txt$|^script_v3\.txt$/.test(f)).sort((a, b) => (a === 'script_v3.txt') - (b === 'script_v3.txt'))[0]
  : null
const r06Cuts = r06ScriptFile ? parseCutsV3(fs.readFileSync(path.join(r06Dir, r06ScriptFile), 'utf-8')) : null

await check('P4', 'Veo 클립 프롬프트 — 오디오 문단(대사 없는 컷도 현장음 전달, IG_R06 컷2)', async () => {
  if (!r06Cuts) return { skip: true, evidence: 'IG_R06 대본 없음' }
  const cut2 = r06Cuts.find(c => c.no === 2)
  if (!cut2) return { skip: true, evidence: 'IG_R06 컷2 없음' }
  const { buildClipPrompt } = await import('../server/lib/clipPrompt.js')
  const r = buildClipPrompt({ ...cut2 }, 1, 1)
  const hasBeat = /폰\s*스피커|phone speaker/i.test(r.prompt)
  const hasLaughter = /웃음소리|laugh/i.test(r.prompt)
  const noSubtitleGuard = /No on-screen subtitle text or captions/.test(r.prompt)
  // 현장 BGM(폰 스피커 비트)이라 "후반 BGM 없음" 가드 문구는 안 붙어야 함(장면 안 소리는 살려야 하므로).
  const noGenericGuard = !/No background music score unless stated as in-scene\./.test(r.prompt)
  return {
    ok: hasBeat && hasLaughter && noSubtitleGuard && noGenericGuard,
    evidence: `현장 비트 언급 ${hasBeat} · 웃음소리 언급 ${hasLaughter} · 자막 금지 문구 ${noSubtitleGuard} · 일반 BGM 가드 불필요(현장음이라) ${noGenericGuard}`,
  }
})

await check('P5', 'Veo 클립 프롬프트 — 두 사람 프레임 좌/우 위치 태그(IG_R06 컷3)', async () => {
  if (!r06Cuts) return { skip: true, evidence: 'IG_R06 대본 없음' }
  const cut3 = r06Cuts.find(c => c.no === 3)
  if (!cut3) return { skip: true, evidence: 'IG_R06 컷3 없음' }
  const { buildClipPrompt } = await import('../server/lib/clipPrompt.js')
  const r = buildClipPrompt({ ...cut3 }, 1, 1)
  const yeoriRight = /Seo Yeori \(on the RIGHT/.test(r.prompt)
  const jiyuLeft = /Jiyu \(on the LEFT/.test(r.prompt)
  // 컷3 BGM("경쾌한 로파이 다시")은 현장 소리 문구가 없는 후반 작업 곡 — 가드 문구가 붙어야 함.
  const bgmGuard = /No background music score unless stated as in-scene\./.test(r.prompt)
  return {
    ok: yeoriRight && jiyuLeft && bgmGuard,
    evidence: `서여리 RIGHT 태그 ${yeoriRight} · 지유 LEFT 태그 ${jiyuLeft} · 후반 BGM 가드(현장음 아님) ${bgmGuard}`,
  }
})

// ── 1c. 목소리 이탈 감지 — 실측 기준 클립: LF_T01 컷13-2(다른 목소리 0.48)는 잡고, 컷19-1(0.74)은 통과시켜야 ──
await check('A1', '목소리 이탈 감지(화자 임베딩)', async () => {
  const { speakerSimilarity, VOICE_SIM_MIN } = await import('../server/lib/voiceSim.js')
  const raw = path.join(mp.makingDir('LF_T01'), 'raw'), ref = path.join(mp.DOWNLOADS, 'seoyeori', 'characters', 'voice_ref', 'yeori.mp3')
  const bad = speakerSimilarity(path.join(raw, 'cut_13_clip_2.mp4'), ref), good = speakerSimilarity(path.join(raw, 'cut_19_clip_1.mp4'), ref)
  if (bad == null || good == null) return { skip: true, evidence: '기준 클립/음성 또는 Python 임베딩 없음' }
  return { ok: bad < VOICE_SIM_MIN && good >= VOICE_SIM_MIN, evidence: `이탈 클립 13-2 ${bad.toFixed(2)} → ${bad < VOICE_SIM_MIN ? '잡음' : '놓침'} · 정상 클립 19-1 ${good.toFixed(2)} → ${good >= VOICE_SIM_MIN ? '통과' : '오탐'} (기준 ${VOICE_SIM_MIN})` }
})

// ── 1d. 영상 탭 자막 미리보기 규칙 = 최종본(handwriting_overlay.py) 규칙 — 한쪽만 바뀌면 탭과 결과가 달라진다 ──
await check('F2', '영상 탭 자막 미리보기 규칙 = 최종본 규칙', () => {
  const py = fs.readFileSync(path.join(ROOT, 'scripts', 'handwriting_overlay.py'), 'utf-8')
  const tab = fs.readFileSync(path.join(ROOT, 'src', 'tabs', 'VideoTab.jsx'), 'utf-8')
  const ov = tab.slice(tab.indexOf('function ReelCaptionOverlay'), tab.indexOf('function wrapCanvasText'))
  const rules = [
    ['기본 기준선 0.87', /"bottom_center":\s*\(0\.5,\s*0\.87\)/.test(py), /H \* 0\.87/.test(ov)],
    ['하단 안전선 0.88', /H \* 0\.88 - box_h/.test(py), /H \* 0\.88 - boxH/.test(ov)],
    ['상하 여백 52', /max\(52 \+ iy/.test(py), /52 \* k/.test(ov)],
    ['줄 간격 1.32', /line_h = font_size \* 1\.32/.test(py), /lineHeight: 1\.32/.test(ov)],
    ['상자 안쪽 여백 18', /pad_x, pad_y = 28, 18/.test(py), /18 \* k/.test(ov)],
    ['1920 기준 크기', true, /H \/ 1920/.test(ov)],
  ]
  const bad = rules.filter(([, a, b]) => !(a && b)).map(([n]) => n)
  return { ok: !bad.length && ov.length > 0, evidence: bad.length ? `어긋남: ${bad.join(', ')}` : `규칙 ${rules.length}개 일치(기준선·안전선·여백·줄간격·안쪽여백·1920 환산)` }
})

// ── 1e. 효과음 규칙 — "DM 알림음·진동" 컷에 알림음(타이핑 아님) ──
await check('S2', '효과음 규칙(알림/DM 컷 → 알림음)', async () => {
  const { decideCut, enrichCutsFromScript } = await import('../server/lib/reelFinalize.js')
  const raw = fs.readFileSync(path.join(scriptDir, scriptFile), 'utf-8')
  const cs = enrichCutsFromScript(parseCutsV3(raw), raw)
  const dm = cs.find(c => /DM|알림|진동/.test(c.masterCode?.audio?.sfx || ''))
  if (!dm) return { skip: true, evidence: '알림 효과음 컷 없음' }
  const f = decideCut(dm).sfx.map(x => x.file.split('/').pop()).join(',')
  return { ok: /message-pop/.test(f), evidence: `컷${dm.no} "${dm.masterCode.audio.sfx}" → ${f || '없음'}` }
})

// ── 1f. 게시 캡션 추출 → 운영실 ──
await check('P3', '게시 캡션 추출(대본 [게시 캡션] → 운영실)', async () => {
  const { extractPublishCaption, loadOps } = await import('../server/lib/instaOps.js')
  const cap = extractPublishCaption(fs.readFileSync(path.join(scriptDir, scriptFile), 'utf-8'))
  const post = (loadOps().posts || []).find(p => p.code === CODE)
  const tagOk = /#\S+/.test(cap), linesOk = cap.split('\n').length >= 3
  return { ok: tagOk && linesOk && !!post?.caption, evidence: `캡션 ${cap.split('\n').length}줄·해시태그 ${tagOk} · 운영실 ${post ? `${post.id} ${post.status}, 캡션 ${post.caption ? '있음' : '없음'}` : '미등록'}` }
})

// ── 1g. BGM 자동 선택 — 대본 문구 → 태그, 분위기 안 맞는 곡은 고르지 않음 ──
await check('B1', 'BGM 자동 선택(대본 문구 → 태그 → 곡/생성)', async () => {
  const { episodeBgmBrief, rankLibrary, selectBgm } = await import('../server/lib/bgmSelect.js')
  const { enrichCutsFromScript } = await import('../server/lib/reelFinalize.js')
  const raw = fs.readFileSync(path.join(scriptDir, scriptFile), 'utf-8')
  const cs = enrichCutsFromScript(parseCutsV3(raw), raw)
  const b = episodeBgmBrief(cs)
  const usageBefore = fs.existsSync(mp.statePath('bgm-usage.json')) ? fs.readFileSync(mp.statePath('bgm-usage.json'), 'utf-8') : null
  const s = await selectBgm({ code: CODE, cuts: cs, durSec: 30, allowGenerate: false })
  if (usageBefore == null) { try { fs.unlinkSync(mp.statePath('bgm-usage.json')) } catch { /* noop */ } } else fs.writeFileSync(mp.statePath('bgm-usage.json'), usageBefore)
  const wrong = s.title && /Code Switch/.test(s.title) && b.tags.includes('calm')
  return { ok: b.wants && b.tags.length > 0 && !wrong, evidence: `요청 태그 ${b.tags.join('·')} · 라이브러리 후보 ${rankLibrary(b.tags).map(r => `${r.track.title}(${r.score})`).join(', ') || '없음'} → ${s.source === 'none' ? '맞는 곡 없음(생성 대상)' : s.title} · ${s.reason}` }
})

// ── 1g2. 나레이션 오인 방지 — 메인 NR: 없음 인 컷의 "(화면 자막)…" 을 음성 나레이션으로 읽지 않는가 ──
await check('N1', '나레이션 오인 방지(화면 자막·DM 글자 ≠ 음성)', async () => {
  const { enrichCutsFromScript } = await import('../server/lib/reelFinalize.js')
  const raw = fs.readFileSync(path.join(scriptDir, scriptFile), 'utf-8')
  const cs = enrichCutsFromScript(parseCutsV3(raw), raw)
  const wrong = cs.filter(c => (c.narration || '').trim() && /^\s*NR\s*[:：]\s*없음/m.test(raw.split(/\[CUT \d+\]/)[c.no] || ''))
  return { ok: !wrong.length, evidence: wrong.length ? `오인 컷 ${wrong.map(c => c.no)}` : `메인 NR 없음 컷 ${cs.filter(c => !(c.narration || '').trim()).length}개 — 나레이션으로 안 읽음` }
})

// ── 1h. 승인 기록(G포인트) 병합 — 일부 필드만 보낸 최신 기록이 다른 승인·선택 이미지를 지우지 않는가 ──
await check('G2', '승인 기록 병합(부분 기록이 다른 승인을 지우지 않음)', async () => {
  const gp = mp.statePath('gpoints.json')
  const clean = () => { const g = JSON.parse(fs.readFileSync(gp, 'utf-8')); delete g.SELFTEST_GP; fs.writeFileSync(gp, JSON.stringify(g, null, 2)) }
  try {
    await post('/api/gpoints', { SELFTEST_GP: { cut_1: { g1: true, g2: true, selectedImage: 'x.jpg', updatedAt: '2026-01-01T00:00:00Z' } } })
    await post('/api/gpoints', { SELFTEST_GP: { cut_1: { g1: true, updatedAt: '2026-01-02T00:00:00Z' } } })
    const c = (await get('/api/gpoints')).data?.SELFTEST_GP?.cut_1 || {}
    return { ok: c.g2 === true && c.selectedImage === 'x.jpg', evidence: `G1만 담은 최신 기록 후 → g2 ${c.g2} · 선택이미지 ${c.selectedImage || '없음'}` }
  } finally { clean() }
})

// ── 1i. 인스타 성과 자동 수집(공식 API) — 토큰 있으면 실제 동기화, 없으면 건너뜀 ──
await check('I1', '인스타 성과 자동 수집(공식 API)', async () => {
  const { igConfigured, syncInsights } = await import('../server/lib/igInsights.js')
  if (!igConfigured()) return { skip: true, evidence: '토큰 미설정(studio-secrets.json apiKeys.instagram.token)' }
  const r = await syncInsights()
  return { ok: r.ok && Number.isFinite(r.followers), evidence: `팔로워 ${r.followers} · 게시물 ${r.media} · 연결 ${r.linked} · 지표 갱신 ${r.updated}` }
})

// ── 1j. 서여리 감정이입 P1(감성 코어·대본 점검)·P2(오늘의 여리) ──
await check('E1', '서여리 감성 코어 + 대본 점검(여운 엔딩·존댓말·말버릇)', async () => {
  const { checkScriptVoice } = await import('../server/lib/yeoriMood.js')
  const per = JSON.parse(fs.readFileSync(mp.charactersJsonPath(), 'utf-8')).yeori?.persona || {}
  const w = checkScriptVoice(cuts)
  const bad = checkScriptVoice([{ no: 9, cutType: 'YEORI', dialogue: '여리 "여러분 이거 봐 봐."', videoPrompt: '[0-3s] She says her line directly to the camera: "여러분 이거 봐 봐."', masterCode: { ch: '서여리' } }])
  return { ok: !!per.canon && per.speech?.toViewer?.includes('존댓말') && w.length === 0 && bad.length >= 1, evidence: `캐논·존댓말 규칙 ${per.canon ? '있음' : '없음'} · ${CODE} 대본 경고 ${w.length}건 · 시험 반말 대사 → ${bad.length}건 잡음` }
})
await check('E2', '오늘의 여리(감정 엔진, 토큰 0)', async () => {
  const { computeMood } = await import('../server/lib/yeoriMood.js')
  const m = await computeMood()
  return { ok: !!(m.mood && m.captionLine && m.face && Array.isArray(m.reasons)), evidence: `${m.mood} · ${m.face} · 주제 ${m.topic} · 근거 ${m.reasons.join('·') || '기본'} · 캡션 "${m.captionLine}"` }
})

// ── 1k. 감정이입 P3(캡션·스토리 초안)·P4(댓글 답장)·P5(사건 원장·콜백) ──
await check('E3', '여리 초안함 큐(API·중복 방지·승인 대기)', async () => {
  const q = await get('/api/yeori-queue'); if (!q.ok) return { ok: false, evidence: '/api/yeori-queue 응답 없음' }
  const list = q.data.queue || []; const keys = list.map(x => x.key)
  const dup = keys.length - new Set(keys).size
  const autoPosted = list.filter(x => x.status === '게시됨' && !x.decidedAt).length   // 승인 없이 게시된 건 = 0 이어야 함
  // 운영실 페이지 인라인 스크립트 문법(9/27 초안함 '불러오는 중' 멈춤 = 문자열 안 줄바꿈)
  const html = fs.readFileSync(new URL('../server/pages/insta-ops.html', import.meta.url), 'utf-8')
  const bad = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].filter(m => { try { new Function(m[1]); return false } catch { return true } }).length
  return { ok: dup === 0 && autoPosted === 0 && bad === 0, evidence: `운영실 스크립트 문법 오류 ${bad}개 · 초안 ${list.length}건(대기 ${list.filter(x => x.status === '대기').length}) · 중복 ${dup} · 승인 없이 게시 ${autoPosted}` }
})
await check('E4', '댓글 답장 안전선·언어 판정 + 댓글 읽기 권한', async () => {
  const { replyMode, pullComments } = await import('../server/lib/yeoriActive.js')
  const cases = [['너무 귀여워요ㅠㅠ', 'ko'], ['So cute, love this vibe!', 'en'], ['카톡 아이디 알려줘', '무대응'], ['http://spam.link 클릭', '무대응'], ['Share me this post🔥', '무대응'], ['DM us for collab', '무대응']]
  const miss = cases.filter(([t, want]) => replyMode(t) !== want)
  const { igConfigured } = await import('../server/lib/igInsights.js')
  const r = igConfigured() ? await pullComments() : { skipped: '토큰 없음' }
  return { ok: miss.length === 0 && !r.error, evidence: `판정 ${cases.length - miss.length}/${cases.length} · 댓글 읽기: ${r.error || r.skipped || `댓글 ${r.comments}건, 새 초안 ${r.drafts}${r.hidden ? ` · ⚠ 숨김 ${r.hidden}개(Meta 앱 개발 모드)` : ''}`}` }
})
await check('E5', '에피소드 사건 원장 + 콜백 제안(오늘의 여리 연결)', async () => {
  const { suggestCallbacks } = await import('../server/lib/yeoriActive.js')
  const ev = JSON.parse(fs.readFileSync(mp.statePath('yeori-events.json'), 'utf-8'))
  const cb = suggestCallbacks(); const mood = JSON.parse(fs.readFileSync(mp.statePath('yeori-mood.json'), 'utf-8')).current
  return { ok: ev.length > 0 && cb.length > 0 && mood.callback === cb[0], evidence: `원장 ${ev.length}편(${ev.map(e => e.code).join(',')}) · 콜백 "${cb[0]}" · 오늘의 여리 연결 ${mood.callback === cb[0] ? 'O' : 'X'}` }
})
// ── 1l2. Codi_Gen 에피소드 탭 ① 소스 팩(2026-09-28, codigen-brief-r4) — 후보 script [CUT NN] 대본
// 초안 파서 + [콜백: …] 코드 파서 + GET /api/yeori-events. 코디젠은 브라우저 전용 단일 HTML이라
// import가 안 돼 함수 정의만 뽑아 new Function으로 돌린다(파서는 순수 함수, DOM 접근 없음).
await check('E9', 'Codi_Gen 대본 초안 파서(①) + /api/yeori-events', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'code_generator_v1.html'), 'utf-8')
  const marker = html.indexOf("const YEORI_SERVER = 'http://localhost:3001';")
  const src = html.slice(marker, html.lastIndexOf('</script>'))
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`)
    if (start < 0) throw new Error(`${name} 정의를 code_generator_v1.html에서 못 찾음`)
    let depth = 0, end = -1
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    return src.slice(start, end)
  }
  const { parseDraftScript, parseCallbackCodes } = new Function(
    `${grab('parseDraftScript')}\n${grab('parseCallbackCodes')}\nreturn { parseDraftScript, parseCallbackCodes }`
  )()

  // E12 스타일 샘플 — 5컷, 그중 하나 6초, 한 줄에 두 화자, 나레이션 포함(지시서 검증 항목 그대로).
  const sample = [
    '**[CUT 01]** (8초)', '**씬:** 자취방, 아침', '**액션:** 알람을 끄고 겨우 일어난다',
    '**대사:** 여리 "아... 오늘도 늦잠"', '**나레이션(V.O.):** "매일 다짐하지만 소용없다"', '---',
    '**[CUT 02]** (8초)', '**씬:** 거실', '**액션:** 커피를 내린다',
    '**대사:** 여리 "커피 없인 못 살아"', '---',
    '**[CUT 03]** (8초)', '**씬:** 자취방, 지유 등장', '**액션:** 지유가 문을 벌컥 연다',
    '**대사:** 여리 "야 노크 좀 해!" / 지유 "미안 미안 급해서"', '---',
    '**[CUT 04]** (6초)', '**씬:** 클로즈업', '**액션:** 여리가 한숨을 쉰다',
    '**나레이션(V.O.):** "이게 내 일상이다"', '---',
    '**[CUT 05]** (8초)', '**씬:** 엔딩', '**액션:** 웃으며 마무리',
    '**대사:** 여리 "그래도 오늘도 화이팅"',
  ].join('\n')
  const parsed = parseDraftScript(sample)
  const durations = parsed.map(c => c.duration).join('/')
  const speakerLineCount = parsed.reduce((n, c) => n + c.lines.filter(l => l.speaker).length, 0)
  const twoSpeakerCut = parsed.find(c => c.lines.length === 2 && c.lines.every(l => l.speaker))
  const narrationCount = parsed.filter(c => c.narration).length
  const callbackCodes = parseCallbackCodes('[콜백: IG_R05 · IG_R06] 오늘은 흑역사 이야기')
  const parserOk = parsed.length === 5 && durations === '8/8/8/6/8' && speakerLineCount >= 5 && !!twoSpeakerCut
    && narrationCount === 2 && callbackCodes.join(',') === 'IG_R05,IG_R06'

  // GET /api/yeori-events — 읽기 전용, 새 엔드포인트(proxy.js). 서버 꺼져 있으면 파서 점검만으로 판단.
  let serverReachable = false, eventsOk = null, eventsLen = null
  try {
    const r = await get('/api/yeori-events')
    serverReachable = true
    eventsOk = r.ok && Array.isArray(r.data)
    eventsLen = Array.isArray(r.data) ? r.data.length : null
  } catch { /* 서버 꺼짐 — 파서 점검은 그대로 유효 */ }

  return {
    ok: parserOk && (!serverReachable || eventsOk === true),
    evidence: `컷 ${parsed.length}개 · 길이 ${durations} · 대사 화자 ${speakerLineCount}명 · 2인 동시대사 컷 ${twoSpeakerCut ? 'C' + String(twoSpeakerCut.no).padStart(2, '0') : '없음'} · 나레이션 컷 ${narrationCount}개 · 콜백 코드 [${callbackCodes.join(', ')}] · /api/yeori-events ${serverReachable ? `배열 ${eventsOk}(길이 ${eventsLen})` : '서버 꺼짐(오프라인) — 코드 파서만 검증'}`,
  }
})
// ── 1l. 자막 표시 규칙(9/28): 따옴표 없음 · 대사만 반투명 직각 바탕 · 재합성 때 BGM 유지 ──
await check('C2', '자막 역할 표시 — 대사=바탕, 나레이션·장면 자막=바탕 없음, 따옴표 없음', async () => {
  const { isDialogueSeg } = await import('../server/lib/reelFinalize.js')
  const src = fs.readFileSync(new URL('../server/lib/reelFinalize.js', import.meta.url), 'utf-8')
  const cases = [['어, 왔어요?', '어, 왔어요?', true], ['그녀는 항상 먼저 와 있었다', '어, 왔어요?', false], ['AI로 만들어요', '저 사실 이 채널… AI로 만들어요.', true], ['금요일 밤 11시.', '없음', false]]
  const miss = cases.filter(([t, d, w]) => isDialogueSeg(t, d) !== w).length
  const quoteWrap = (src.match(/`"\$\{/g) || []).length
  const keepsBgm = /이전 최종본 곡 유지/.test(src)
  return { ok: miss === 0 && quoteWrap === 0 && keepsBgm, evidence: `판정 ${cases.length - miss}/${cases.length} · 따옴표 감싸기 코드 ${quoteWrap}곳 · 재합성 BGM 유지 ${keepsBgm ? 'O' : 'X'}` }
})

// ── 1m. 릴스 자막 줄바꿈·표시시간 수동 편집(2026-09-28): 수동 \n 보존 + 수동 타이밍이 자동 싱크에 안 덮임 ──
await check('C3', '자막 수동 줄바꿈 보존 + 수동 타이밍이 자동 싱크에 안 덮임', async () => {
  const { setOverride, applyOverrides } = await import('../server/lib/reelOverrides.js')
  const { decideCut } = await import('../server/lib/reelFinalize.js')
  const TEST_CODE = '__SELFTEST_C3__'
  const ovPath = mp.statePath(`reel-overrides/${TEST_CODE}.json`)
  try {
    // 1) 수동 줄바꿈 — 개행 앞뒤에 공백이 붙어도(Enter 직후 흔한 케이스) cleanCaption이 \n을
    // 지우면 안 된다(예전 버그: \s{2,} 통짜 collapse가 " \n "을 공백 1개로 뭉갬).
    setOverride(TEST_CODE, 1, { subtitle: '첫줄 \n 둘째줄 / 나레이션' })
    const cuts1 = applyOverrides([{ no: 1, subtitle: '원본', dialogue: '', masterCode: {} }], TEST_CODE)
    const seg0 = decideCut(cuts1[0]).caption?.segments?.[0]
    const nlOk = !!seg0 && seg0.overlay.text === '첫줄\n둘째줄'
    // 2) 수동 타이밍(captionTimingAuto 없음) — override 파일에 그대로 남아있어야 하고,
    // sync-captions 라우트(proxy.js)가 이 조합을 건드리지 않는 가드가 실제 코드에 있어야 한다.
    setOverride(TEST_CODE, 2, { captionSegTiming: [[1, 3]] })
    const cuts2 = applyOverrides([{ no: 2 }], TEST_CODE)
    const manualKept = Array.isArray(cuts2[0].captionSegTiming) && cuts2[0].captionSegTiming[0][0] === 1 && cuts2[0].captionSegTiming[0][1] === 3
    const proxySrc = fs.readFileSync(path.join(ROOT, 'server', 'proxy.js'), 'utf-8')
    const guardOk = /ov\.captionSegTiming\s*&&\s*!ov\.captionTimingAuto/.test(proxySrc)
    return {
      ok: nlOk && manualKept && guardOk,
      evidence: `세그0 텍스트 "${(seg0?.overlay.text || '').replace(/\n/g, '\\n')}" · 개행 보존 ${nlOk} · 수동 타이밍 유지 ${manualKept} · sync-captions 가드 ${guardOk}`,
    }
  } finally {
    try { fs.unlinkSync(ovPath) } catch { /* noop */ }
  }
})

// ── 1m. 관심사 설계 후보 발굴(9/28 A+C) — API 비용 없이 구조만 확인 ──
await check('E6', '관심사 후보 발굴 — 분야 10개·버튼 실행·월 사용량·게시물 링크 거절', async () => {
  const st = await get('/api/seed-discovery'); if (!st.ok) return { ok: false, evidence: '/api/seed-discovery 응답 없음(서버 재시작 필요?)' }
  const { addFromLink } = await import('../server/lib/seedDiscovery.js')
  let rejected = 0; for (const u of ['https://www.instagram.com/p/Dd04SFFhHjA/', 'https://www.instagram.com/reel/abc123/']) { try { await addFromLink(u) } catch { rejected++ } }
  const g = st.data.groups || []
  const auto = /runSeed|maybeWeeklyDiscovery\(/.test(fs.readFileSync(new URL('../server/proxy.js', import.meta.url), 'utf-8'))
  return { ok: g.length === 10 && rejected === 2 && !auto && !!st.data.month, evidence: `분야 ${g.length}개 · 다음 차례 ${(st.data.nextGroups || []).join(',')} · 마지막 실행 ${st.data.lastRun ? new Date(st.data.lastRun).toLocaleString('ko-KR') : '없음'} · 게시물 링크 거절 ${rejected}/2 · 자동 실행 ${auto ? '켜짐(X)' : '없음'} · 이번 달 검색 ${st.data.month?.searches ?? '?'}회` }
})

await check('E7', '기획 붙여넣기 → 후보 등록(API 없음) — 정해진 형식 파싱', async () => {
  const html = fs.readFileSync(new URL('../content_matrix_v3.html', import.meta.url), 'utf-8')
  const src = fs.readFileSync(new URL('../server/proxy.js', import.meta.url), 'utf-8')
  const s0 = html.indexOf('function parseIdeaFormat'), s1 = html.indexOf('function openIdeaCandidateModal')
  const parse = new Function(html.slice(s0, s1) + '; return parseIdeaFormat')()
  const c = parse('제목: 테스트\n유형: ig_r\n주제: 한 줄\n대본:\n**[CUT 01]** (8초)\n**대사:** 여리 "주제: 대사 속 글자"\n**[CUT 02]** (6초)')
  const ok = c.title === '테스트' && c.type === 'IG_R' && (c.script.match(/\[CUT/g) || []).length === 2 && c.script.includes('대사 속 글자')
  const noApi = !/from-idea/.test(src) && !/from-idea/.test(html)
  return { ok: ok && noApi, evidence: `형식 파싱 ${ok ? 'O' : 'X'}(제목·유형·2컷·대사 속 '주제:' 보존) · API 호출 경로 ${noApi ? '없음' : '남아 있음(X)'}` }
})

await check('E8', '코디젠 에피소드 삭제 — LIVE·없는 에피소드 거부, 휴지통 백업 경로, 후보 다시 보내기', async () => {
  const eps = await get('/api/episodes'); if (!eps.ok) return { ok: false, evidence: '/api/episodes 응답 없음' }
  const live = await fetch(SERVER + '/api/episodes/' + eps.data.activeEpisodeId + '/delete', { method: 'POST' })
  const none = await fetch(SERVER + '/api/episodes/ep_selftest_none/delete', { method: 'POST' })
  const after = await get('/api/episodes')
  const src = fs.readFileSync(new URL('../server/proxy.js', import.meta.url), 'utf-8')
  const cm = fs.readFileSync(new URL('../content_matrix_v3.html', import.meta.url), 'utf-8')
  const trash = /episode-trash/.test(src), resend = cm.includes('코디젠에 다시 보내기')
  const ok = live.status === 409 && none.status === 404 && after.data.episodes.length === eps.data.episodes.length && trash && resend
  return { ok, evidence: `LIVE 삭제 거부 ${live.status} · 없는 에피소드 ${none.status} · 개수 유지 ${after.data.episodes.length} · 휴지통 백업 ${trash ? 'O' : 'X'} · 후보 다시 보내기 ${resend ? 'O' : 'X'}` }
})

await check('C4', '대본 탭 효과음(이름만 있는 선택) → 최종본·영상 탭 반영 + 자막 위치 하단 영역 제한', async () => {
  const { decideCut } = await import('../server/lib/reelFinalize.js')
  const d = decideCut({ no: 1, cutType: 'YEORI', subtitle: '', sfxStart: 6.5, sfxVolume: 1.5, masterCode: { audio: { sfx: 'mixkit-cinematic-glass-hit-suspense-677.wav — 유리 깨지는 충격' } } })
  const s = d.sfx?.[0] || {}
  const vt = fs.readFileSync(new URL('../src/tabs/VideoTab.jsx', import.meta.url), 'utf-8')
  const autoCompose = /먼저 클립 합성 중/.test(vt) && /sfxName:/.test(vt)
  const posOk = /0\.74 : pos === 'middle' \? 0\.82/.test(vt) && /min="65" max="86"/.test(vt)
  const ok = /glass-hit-suspense-677\.wav$/.test(s.file || '') && s.atSec === 6.5 && s.gain === 1 && autoCompose && posOk
  return { ok, evidence: `효과음 ${s.file || '없음'} · ${s.atSec}초 · 음량 ${s.gain} · 합성본 없으면 자동 클립 합성 ${autoCompose ? 'O' : 'X'} · 자막 위치 상74%/중82%/하단 안전선 88% ${posOk ? 'O' : 'X'}` }
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
