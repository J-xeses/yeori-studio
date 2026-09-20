// 승인 게이트(G1~G5) 정책 + 결정론적 검수 — 2026-09-21. ★ LLM 호출 없음(토큰 0): 파일 읽기 + ffprobe/ffmpeg 만 사용 ★
//
// 승인(gpoints g1~g5) = "이 산출물을 다음 단계 입력으로 써도 된다"는 확정 신호. 파일이 있다고 승인된 것이 아니다.
// 이 모듈은 컷·게이트별로 "지금 승인해도 되는가"를 계산해 판정(verdict)만 돌려준다 — 승인 자체는 하지 않는다.
// 사람(스튜디오 UI/MCP)과 에이전트 리더(pipeline-leader.js, Notion "에이전트 자동승인" 위임 스테이지만)가 같은 기준을 쓴다.
//
// 판정(verdict):
//   approved   이미 승인됨
//   not_ready  산출물 없음(승인할 대상이 아직 없음)
//   blocked    하드 검사 실패 — 승인하면 안 됨(사유 포함)
//   recommend  하드 검사 통과 — 사람 1클릭 승인 권고(정책이 사람 전용이거나 소프트 경고/수동 확인 항목이 있음)
//   auto_ok    하드·소프트 전부 통과 + 정책이 위임 가능 — 리더가 위임받았다면 자동 승인 가능
// 검사 수준(level): hard(필수 통과) · soft(경고, 있으면 auto_ok 불가) · manual(사람 판단 필요 — 있으면 auto_ok 불가)

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as mp from './mediaPaths.js'

const STATE_PATH = 'C:\\yeori-studio\\app\\studio-state.json'
const MAKING_TYPES = ['GRAPHIC', 'BROLL', 'CAPCUT']

// 게이트별 위임 정책 — 코드가 곧 문서(docs/gate-approval-policy.md 와 동기)
export const GATE_POLICY = {
  G1: { delegable: false, why: '대본 승인은 창작 판단 — 사람만' },
  G2: { delegable: false, why: '이미지 선택은 시각 판단(얼굴 일관성·신발·배경 인물 등) — 비전 QC(P4) 전까지 사람만' },
  G3: { delegable: true, why: '음성은 길이·무음·대본 최신성을 결정론적으로 검사 가능' },
  G4: { delegable: 'making-only', why: '메이킹 컷(GRAPHIC/BROLL/CAPCUT)은 위임 가능, 서여리(YEORI) 컷은 립싱크·연기 품질이 시각 판단이라 사람 1클릭' },
  G5: { delegable: false, why: '최종 편집 승인은 사람만' },
}

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return fb } }
const pad = (n) => String(n).padStart(2, '0')
const has = (s) => !!String(s || '').replace(/^없음$/, '').trim()
const chk = (id, label, level, ok, detail = '') => ({ id, label, level, ok, detail })

// ── ffprobe/ffmpeg 결과 캐시(경로+mtime+size 키) — 시간별 갱신에서 반복 비용을 줄인다 ──
// 프로세스가 매번 새로 뜨는 CLI/자식 프로세스에서도 재사용되도록 디스크에도 저장한다(downloads/state/.gate-cache.json).
const CACHE_PATH = 'C:/yeori-studio/downloads/state/.gate-cache.json'
const cache = new Map(Object.entries(readJson(CACHE_PATH, {})))
let cacheDirty = false
function cached(kind, file, fn) {
  let st; try { st = fs.statSync(file) } catch { return null }
  const key = `${kind}|${file}|${st.mtimeMs}|${st.size}`
  if (!cache.has(key)) { cache.set(key, fn()); cacheDirty = true }
  return cache.get(key)
}
export function flushGateCache() {
  if (!cacheDirty) return
  try {
    const live = {}   // 너무 오래된 항목이 쌓이지 않게 최근 2000개만
    for (const [k, v] of [...cache.entries()].slice(-2000)) live[k] = v === Infinity || v === -Infinity ? null : v
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify(live), 'utf-8'); cacheDirty = false
  } catch { /* noop */ }
}
function probe(file) {
  return cached('probe', file, () => {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], { encoding: 'utf-8', timeout: 20000 })
    try {
      const j = JSON.parse(r.stdout || '{}')
      const v = (j.streams || []).find(s => s.codec_type === 'video')
      return { ok: true, width: v?.width, height: v?.height, hasVideo: !!v, hasAudio: (j.streams || []).some(s => s.codec_type === 'audio'), duration: Number(j.format?.duration) || 0 }
    } catch { return { ok: false } }
  })
}
function volume(file) {
  return cached('vol', file, () => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf-8', timeout: 60000 })
    const err = r.stderr || ''
    const mean = err.match(/mean_volume:\s*(-?[0-9.]+|-inf)/), max = err.match(/max_volume:\s*(-?[0-9.]+|-inf)/)
    const num = (m) => (m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null)
    return { mean: num(mean), max: num(max) }
  })
}
function blackSeconds(file) {
  return cached('black', file, () => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', 'blackdetect=d=0.5:pix_th=0.10', '-an', '-f', 'null', '-'], { encoding: 'utf-8', timeout: 90000 })
    let total = 0
    for (const m of (r.stderr || '').matchAll(/black_duration:([0-9.]+)/g)) total += Number(m[1])
    return total
  })
}

function episodeRatio(ep) {
  if (ep?.aspectRatio) return ep.aspectRatio
  return ['LF', 'SF'].includes(ep?.contentType) ? '16:9' : '9:16'
}
const ratioOk = (w, h, want) => { if (!w || !h) return false; const r = w / h; return want === '16:9' ? Math.abs(r - 16 / 9) < 0.03 : Math.abs(r - 9 / 16) < 0.03 }

// ── 게이트별 컷 검사 ────────────────────────────────────────────────
function checksG1(cut) {
  const c = []
  const isMaking = MAKING_TYPES.includes(cut.cutType)
  c.push(chk('duration', '길이(DU) 지정', 'hard', Number(cut.duration) > 0, `${cut.duration || '없음'}`))
  c.push(chk('type', '컷 유형(CT) 지정', 'hard', !!cut.cutType, cut.cutType || '없음'))
  if (!isMaking) c.push(chk('prompt', '이미지/영상 프롬프트', 'hard', has(cut.imagePrompt) || has(cut.videoPrompt), ''))
  if (Array.isArray(cut.segments) && cut.segments.length) {
    const okUnits = cut.segments.every(s => [4, 6, 8, 10].includes(Number(s)))
    const sum = cut.segments.reduce((a, b) => a + Number(b), 0)
    const trim = sum - Number(cut.duration || 0)
    c.push(chk('seg-units', '세그 길이가 4/6/8/10초', 'hard', okUnits, cut.segments.join('+')))
    c.push(chk('seg-sum', '세그 합계가 DU 이상(트림 0~4초)', 'soft', trim >= 0 && trim < 4, `합계 ${sum} · DU ${cut.duration} · 트림 ${trim}`))
  }
  if (cut.cutType === 'YEORI') c.push(chk('speech', '대사(DL) 또는 나레이션(NR)', 'soft', has(cut.dialogue) || has(cut.narration), ''))
  return { artifact: true, checks: c }
}

function checksG2(cut, ctx) {
  const dir = mp.imagesDir(ctx.epNum)
  const files = (() => { try { return fs.readdirSync(dir).filter(f => new RegExp(`^cut_${pad(cut.no)}(_[a-z0-9]{1,2})?\\.(jpg|jpeg|png|webp)$`, 'i').test(f)) } catch { return [] } })()
  if (!files.length) return { artifact: false, checks: [] }
  const sel = ctx.gp[`cut_${cut.no}`]?.selectedImage
  const c = [chk('selected', '선택본(selectedImage) 지정', 'hard', !!sel && files.includes(sel), sel || '미지정')]
  c.push(chk('manual-visual', '얼굴 일관성·신발·배경 인물은 사람 확인', 'manual', null, ''))
  return { artifact: true, checks: c }
}

function checksG3(cut, ctx) {
  const needs = has(cut.dialogue) || has(cut.narration)
  if (!needs) return { artifact: false, na: true, checks: [] }
  const f = path.join(mp.audioDir(ctx.epNum), `cut_${pad(cut.no)}.mp3`)
  if (!fs.existsSync(f)) return { artifact: false, checks: [] }
  const c = []
  const p = probe(f)
  c.push(chk('decodes', '오디오 파일 정상', 'hard', !!p?.ok && p.duration > 0.3, p?.ok ? `${p.duration.toFixed(1)}초` : '읽기 실패'))
  if (p?.ok && Number(cut.duration) > 0) c.push(chk('fits', '컷 길이를 넘지 않음(+0.5초)', 'hard', p.duration <= Number(cut.duration) + 0.5, `${p.duration.toFixed(1)}초 / DU ${cut.duration}`))
  const v = volume(f)
  if (v) c.push(chk('audible', '무음 아님(평균 -45dB 이상)', 'hard', v.mean !== null && v.mean > -45, `평균 ${v.mean}dB`))
  if (v && v.max !== null) c.push(chk('clipping', '클리핑 없음(최대 -0.3dB 미만)', 'soft', v.max < -0.3, `최대 ${v.max}dB`))
  const used = ctx.tts?.audioTexts?.[cut.id]
  if (used != null) {
    const now = String(cut.dialogue || cut.narration || '').replace(/\s+/g, '')
    c.push(chk('fresh', 'TTS 이후 대본이 바뀌지 않음', 'soft', String(used).replace(/\s+/g, '') === now, ''))
  }
  return { artifact: true, checks: c }
}

function checksG4(cut, ctx) {
  const dir = mp.videoDir(ctx.epNum)
  const final = path.join(dir, `cut_${pad(cut.no)}_final.mp4`), base = path.join(dir, `cut_${pad(cut.no)}.mp4`)
  const f = fs.existsSync(final) ? final : (fs.existsSync(base) ? base : null)
  if (!f) return { artifact: false, checks: [] }
  const c = []
  const p = probe(f)
  c.push(chk('decodes', '영상 파일 정상(비디오 스트림)', 'hard', !!p?.ok && p.hasVideo && p.duration > 0.3, p?.ok ? `${p.duration.toFixed(1)}초 ${p.width}x${p.height}` : '읽기 실패'))
  if (p?.ok && p.hasVideo) {
    c.push(chk('ratio', `화면 비율 ${ctx.ratio}`, 'hard', ratioOk(p.width, p.height, ctx.ratio), `${p.width}x${p.height}`))
    if (Number(cut.duration) > 0) c.push(chk('duration', '길이가 DU와 ±1초 이내', 'hard', Math.abs(p.duration - Number(cut.duration)) <= 1.0, `${p.duration.toFixed(1)}초 / DU ${cut.duration}`))
    const black = blackSeconds(f)
    if (black !== null) c.push(chk('black', '검정 화면이 길이의 30% 미만', 'soft', black < p.duration * 0.3, `검정 ${black.toFixed(1)}초`))
  }
  if (Array.isArray(cut.segments) && cut.segments.length > 1) {
    const clips = (ctx.state.videoTabState?.videoClips || {})[cut.id] || []
    const filled = cut.segments.filter((_, i) => clips[i]).length
    c.push(chk('slots', '모든 세그 슬롯이 채워짐', 'hard', filled === cut.segments.length, `${filled}/${cut.segments.length}`))
  }
  const rev = ctx.review?.[String(cut.no)]?.status
  c.push(chk('not-rejected', '사람 반려 없음', 'hard', rev !== 'rejected', rev || '반려 없음'))
  const speaks = cut.cutType === 'YEORI' && has(cut.dialogue)
  if (speaks && p?.ok) {
    c.push(chk('audio-stream', '대사 컷: 오디오 스트림 있음', 'hard', p.hasAudio, p.hasAudio ? '있음' : '없음'))
    const v = volume(f)
    if (p.hasAudio && v) c.push(chk('audible', '대사 컷: 무음 아님(평균 -45dB 이상)', 'hard', v.mean !== null && v.mean > -45, `평균 ${v.mean}dB`))
  }
  if (cut.cutType === 'YEORI') c.push(chk('manual-visual', speaks ? '립싱크·연기·얼굴 품질은 사람 확인' : '연기·얼굴 품질은 사람 확인', 'manual', null, ''))
  return { artifact: true, checks: c }
}

const CHECKERS = { G1: checksG1, G2: checksG2, G3: checksG3, G4: checksG4 }

// 컷 1개 판정
export function evaluateCut(gate, cut, ctx) {
  const G = String(gate).toUpperCase()
  const approved = ctx.gp[`cut_${cut.no}`]?.[G.toLowerCase()] === true
  const base = { no: cut.no, cutType: cut.cutType, gate: G }
  if (G === 'G5') return { ...base, verdict: approved ? 'approved' : 'recommend', checks: [], note: '최종 편집 승인은 사람만' }
  const r = CHECKERS[G](cut, ctx)
  if (r.na) return { ...base, verdict: 'n/a', checks: [] }
  if (approved) return { ...base, verdict: 'approved', checks: r.checks }
  if (!r.artifact && G !== 'G1') return { ...base, verdict: 'not_ready', checks: [] }
  const hardFail = r.checks.filter(x => x.level === 'hard' && x.ok === false)
  if (hardFail.length) return { ...base, verdict: 'blocked', checks: r.checks, reasons: hardFail.map(x => `${x.label}: ${x.detail}`) }
  const pol = GATE_POLICY[G]
  const delegable = pol.delegable === true || (pol.delegable === 'making-only' && MAKING_TYPES.includes(cut.cutType))
  const softOrManual = r.checks.filter(x => (x.level === 'soft' && x.ok === false) || x.level === 'manual')
  const verdict = delegable && !softOrManual.length ? 'auto_ok' : 'recommend'
  const why = softOrManual.map(x => `${x.label}${x.detail ? ': ' + x.detail : ''}`)
  return { ...base, verdict, checks: r.checks, reasons: verdict === 'auto_ok' ? [] : (why.length ? why : [pol.why]) }
}

// 활성 에피소드 전체 컷 판정. epNum 이 활성 에피소드와 다르면 예외.
export function evaluateEpisode(gate, { epNum } = {}) {
  const state = readJson(STATE_PATH, {})
  const ep = state.episode || {}
  if (epNum != null && Number(epNum) !== Number(ep.number)) throw new Error(`활성 에피소드(${ep.number})와 다릅니다 — 다른 에피소드는 먼저 활성화하세요`)
  const code = ep.code || String(ep.number)
  const gp = readJson('C:\\yeori-studio\\downloads\\state\\gpoints.json', {})[code] || {}
  const ctx = {
    state, epNum: ep.number, gp, ratio: episodeRatio(ep), tts: state.ttsTabState || {},
    review: readJson(path.join(mp.videoDir(ep.number), '.making-review.json'), {}),
  }
  const cuts = (state.cuts || []).map(c => evaluateCut(gate, c, ctx))
  const tally = {}
  cuts.forEach(c => { tally[c.verdict] = (tally[c.verdict] || 0) + 1 })
  flushGateCache()
  return { gate: String(gate).toUpperCase(), episode: code, policy: GATE_POLICY[String(gate).toUpperCase()], tally, cuts }
}
