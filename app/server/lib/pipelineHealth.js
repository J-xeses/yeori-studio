// 파이프라인 점검판(모니터 탭 "회로도") 실측 판정 — 2026-11-11. ★ LLM 호출 없음: 파일 읽기 + ffprobe/ffmpeg 만 ★
//
// 배경(11/9 SF_E01·E02): 06_publishing/cut_NN_final.mp4 가 오디오 스트림 자체가 없는 채로 이틀 넘게
// 방치됐는데 화면엔 계속 "✅ 완료"였다. 승인 플래그(G포인트)와 "실제 파일이 그 상태를 만족하는가"가
// 따로 놀았고, 그 간극은 매번 사람이 ffprobe 로 파일을 열어봐야만 드러났다.
//
// 원칙(성준님 확정): 노드의 상태색(ok/warn/fail)은 선언된 플래그가 아니라 "파일을 열어본 결과"로만 정한다.
// 플래그(gp)는 "완료라고 주장했는데 파일이 없다"를 잡는 대조용으로만 쓴다.
//
// 이 모듈은 읽기 전용이다 — 어떤 미디어 파일도 쓰거나 지우지 않는다.
// 검사 방식은 pipeline-selftest.js(N3 의 오디오 스트림 수 세기)·gatePolicy.js(probe/volume)와 같은 ffprobe 호출.
// 폴링 엔드포인트에서 서버를 막지 않도록 비동기(execFile)로 부르고, 경로+mtime+size 키로 메모리 캐시한다.

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as mp from './mediaPaths.js'
import { hasVoiceNarration, checkFinalStale } from './reelFinalize.js'

const STATE_PATH = path.join(mp.MEDIA_ROOT, 'app', 'studio-state.json')
const MAKING_TYPES = ['GRAPHIC', 'BROLL', 'CAPCUT']
// reelFinalize.js 의 LEGACY_AUTOCOPY_WINDOW_MS 와 같은 값 — 옛 "입히기" 자동복사 흔적 판정(그쪽 주석 참고).
const LEGACY_AUTOCOPY_WINDOW_MS = 10000

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return fb } }
const pad = (n) => String(n).padStart(2, '0')
const has = (s) => !!String(s || '').replace(/^\s*(없음|-)\s*$/, '').trim()
const statOf = (f) => { try { return fs.statSync(f) } catch { return null } }
const listDir = (d) => { try { return fs.readdirSync(d) } catch { return [] } }
const nums = (arr) => arr.join('·')

// ── ffprobe / ffmpeg (비동기 + 캐시) ────────────────────────────────
const cache = new Map()
function run(bin, args, timeout) {
  return new Promise((resolve) => {
    execFile(bin, args, { encoding: 'utf-8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }))
  })
}
async function cached(kind, file, fn) {
  const st = statOf(file)
  if (!st) return null
  const key = `${kind}|${file}|${st.mtimeMs}|${st.size}`
  if (!cache.has(key)) {
    if (cache.size > 3000) cache.clear()
    cache.set(key, fn())   // Promise 를 넣어 동시 폴링이 같은 파일을 두 번 열지 않게
  }
  return cache.get(key)
}
// 스트림 구성 실측 — { ok, video(개수), audio(개수), duration(초) }. 파일이 깨졌으면 ok:false.
export function probeStreams(file) {
  return cached('probe', file, async () => {
    const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], 20000)
    try {
      const j = JSON.parse(r.stdout)
      const streams = j.streams || []
      if (!streams.length) return { ok: false, video: 0, audio: 0, duration: 0 }
      return {
        ok: true,
        video: streams.filter(s => s.codec_type === 'video').length,
        audio: streams.filter(s => s.codec_type === 'audio').length,
        duration: Number(j.format?.duration) || 0,
      }
    } catch { return { ok: false, video: 0, audio: 0, duration: 0 } }
  })
}
// 평균 음량(dB) — 오디오 스트림은 있는데 통째로 무음인 최종본을 잡는다. 측정 실패는 null.
export function meanVolume(file) {
  return cached('vol', file, async () => {
    const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], 90000)
    const m = r.stderr.match(/mean_volume:\s*(-?[0-9.]+|-inf)/)
    return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null
  })
}

// ── 노드 결과 조립 ─────────────────────────────────────────────────
// issues: [{ cut, level:'fail'|'warn', msg }] → state 는 가장 나쁜 수준. 문제 없고 검증한 파일이 있으면 ok, 없으면 null(아직 볼 게 없음).
function finish({ issues, verified, total, okText, emptyText, extra = {} }) {
  const fails = issues.filter(i => i.level === 'fail'), warns = issues.filter(i => i.level === 'warn')
  const state = fails.length ? 'fail' : warns.length ? 'warn' : verified > 0 ? 'ok' : null
  const fmt = (list) => list.slice(0, 3).map(i => (i.cut != null ? `컷${i.cut} ` : '') + i.msg).join(' / ') + (list.length > 3 ? ` 외 ${list.length - 3}건` : '')
  const evidence = fails.length ? fmt(fails) : warns.length ? fmt(warns) : verified > 0 ? okText : emptyText
  return { state, evidence, verified, total, complete: total > 0 && verified >= total, issues, ...extra }
}

// 이미지(02_images) — 컷마다 후보 이미지가 실제로 있는가, 승인(G2) 때 고른 선택본이 그 컷 파일로 남아 있는가
function checkImages({ cuts, gp, dirs }) {
  const files = listDir(dirs.images)
  const issues = []; let verified = 0, total = 0
  for (const cut of cuts) {
    const own = files.filter(f => new RegExp(`^cut_${pad(cut.no)}(_[a-z0-9]{1,2})?\\.(jpg|jpeg|png|webp)$`, 'i').test(f) && (statOf(path.join(dirs.images, f))?.size || 0) > 0)
    const g = gp[`cut_${cut.no}`] || {}
    if (!own.length) {
      if (MAKING_TYPES.includes(cut.cutType)) continue   // 메이킹 컷은 Flow 이미지가 필요 없다
      total++
      if (g.g2) issues.push({ cut: cut.no, level: 'fail', msg: 'G2 승인인데 이미지 파일 없음' })
      continue
    }
    total++
    if (g.g2 && g.selectedImage && !files.includes(g.selectedImage)) issues.push({ cut: cut.no, level: 'fail', msg: `선택본 ${g.selectedImage} 파일 없음` })
    else if (g.g2 && g.selectedImage && !own.includes(g.selectedImage)) issues.push({ cut: cut.no, level: 'warn', msg: `선택본이 다른 컷 파일(${g.selectedImage})` })
    else verified++
  }
  return finish({ issues, verified, total, okText: `이미지 ${verified}/${total}컷 파일 확인`, emptyText: '이미지 파일 없음' })
}

// TTS(03_audio) — 최종본이 믹스할 나레이션 음성이 실제로 재생 가능한 파일인가 (reelFinalize 의 nrFile 선택 규칙과 동일)
async function checkTts({ cuts, gp, dirs }) {
  const issues = []; let verified = 0, total = 0
  for (const cut of cuts) {
    if (!hasVoiceNarration(cut)) continue
    total++
    const hasDl = has(cut.dialogue)
    const cands = [`cut_${pad(cut.no)}_nr.mp3`, ...(hasDl ? [] : [`cut_${pad(cut.no)}.mp3`])].map(f => path.join(dirs.audio, f))
    const f = cands.find(x => fs.existsSync(x))
    if (!f) { if (gp[`cut_${cut.no}`]?.g3) issues.push({ cut: cut.no, level: 'fail', msg: `G3 승인인데 나레이션 음성(${path.basename(cands[0])}) 없음` }); continue }
    const p = await probeStreams(f)
    if (!p?.ok || p.audio < 1 || p.duration <= 0.3) { issues.push({ cut: cut.no, level: 'fail', msg: `음성 파일 손상(오디오 ${p?.audio ?? 0}개 · ${(p?.duration || 0).toFixed(1)}초)` }); continue }
    if (Number(cut.duration) > 0 && p.duration > Number(cut.duration) + 0.5) issues.push({ cut: cut.no, level: 'warn', msg: `음성 ${p.duration.toFixed(1)}초가 컷 ${cut.duration}초보다 김` })
    verified++
  }
  return finish({ issues, verified, total, okText: `나레이션 음성 ${verified}/${total}컷 재생 가능`, emptyText: total ? '나레이션 음성 아직 없음' : '나레이션 컷 없음' })
}

// 영상 생성(04_making/raw) — Flow 원본 클립이 읽히는가. 업로드 소스로 만든 에피소드는 raw 가 없을 수 있어 "없음"은 문제가 아니다.
async function checkRaw({ dirs }) {
  const files = listDir(dirs.raw).filter(f => /^cut_\d+.*\.mp4$/i.test(f))
  const issues = []; let verified = 0
  const cutSet = new Set()
  for (const f of files) {
    const p = await probeStreams(path.join(dirs.raw, f))
    const no = Number((f.match(/^cut_(\d+)/i) || [])[1])
    if (!p?.ok || p.video < 1 || p.duration <= 0.3) { issues.push({ cut: no, level: 'warn', msg: `원본 클립 ${f} 읽기 실패` }); continue }
    verified++; cutSet.add(no)
  }
  return finish({ issues, verified, total: files.length, okText: `원본 클립 ${verified}개(컷 ${cutSet.size}개) 읽힘`, emptyText: 'Flow 원본 클립 없음' })
}

// 06_publishing 의 영상 탭 미리듣기 결과 중 최종화가 실제로 가져다 쓸 파일 — reelFinalize.js finalizeReel 의 소스 선택과 같은 규칙.
// (05_video 원본보다 최신이면 사용, 10초 이내로만 오래됐으면 옛 자동복사 흔적으로 보고 사용, 그 밖엔 무시)
function pickVideoTabResult(dirs, no, baseM) {
  const preview = path.join(dirs.publishing, `cut_${pad(no)}_preview.mp4`), final = path.join(dirs.publishing, `cut_${pad(no)}_final.mp4`)
  const m = (f) => statOf(f)?.mtimeMs ?? -1
  const pvM = m(preview), fnM = m(final)
  const fresh = (x) => x >= baseM
  const legacy = (x) => x >= 0 && x < baseM && baseM - x <= LEGACY_AUTOCOPY_WINDOW_MS
  const usable = (x) => fresh(x) || legacy(x)
  let used = null
  if (usable(pvM) && pvM >= fnM) used = { path: preview, legacy: !fresh(pvM) }
  else if (usable(fnM)) used = { path: final, legacy: !fresh(fnM) }
  return { used, files: [final, preview].filter(f => fs.existsSync(f)) }
}

// 합성(05_video/cut_NN.mp4) — 컷 영상이 실제로 재생 가능한가. 11/9: 번인 결과가 원본을 덮어써 오디오 스트림이 사라졌던 자리.
async function checkCompose({ cuts, gp, dirs }) {
  const issues = []; let verified = 0
  const silent = []; let sumDur = 0
  for (const cut of cuts) {
    const base = path.join(dirs.video, `cut_${pad(cut.no)}.mp4`)
    const st = statOf(base)
    if (!st) { if (gp[`cut_${cut.no}`]?.g4) issues.push({ cut: cut.no, level: 'fail', msg: 'G4 승인인데 컷 영상 없음' }); continue }
    const p = await probeStreams(base)
    if (!p?.ok || p.video < 1 || p.duration <= 0.3) { issues.push({ cut: cut.no, level: 'fail', msg: `영상 손상(비디오 ${p?.video ?? 0}개 · ${(p?.duration || 0).toFixed(1)}초)` }); continue }
    sumDur += p.duration
    const speaks = has(cut.dialogue)
    if (p.audio < 1 && speaks) { issues.push({ cut: cut.no, level: 'fail', msg: '대사 컷인데 오디오 0개' }); continue }
    if (p.audio < 1) silent.push(cut.no)
    if (Number(cut.duration) > 0 && Math.abs(p.duration - Number(cut.duration)) > 1.0) issues.push({ cut: cut.no, level: 'warn', msg: `길이 ${p.duration.toFixed(1)}초 ≠ DU ${cut.duration}초` })
    // 옛 "나레이션·효과음 입히기"가 원본을 덮어쓴 흔적 — 이 컷의 05_video 엔 나레이션·자막이 이미 섞여 있을 수 있다
    const vt = pickVideoTabResult(dirs, cut.no, st.mtimeMs)
    if (vt.used?.legacy) issues.push({ cut: cut.no, level: 'warn', msg: '옛 "입히기"가 원본을 덮어쓴 흔적(05_video 가 06_publishing 직후 생성)' })
    verified++
  }
  const okText = `컷 영상 ${verified}/${cuts.length}개 재생 가능${silent.length ? ` · 무음 컷 ${nums(silent)}(대사 없음)` : ''}`
  return finish({ issues, verified, total: cuts.length, okText, emptyText: '컷 영상 아직 없음', extra: { silentCuts: silent, sumDuration: Number(sumDur.toFixed(2)) } })
}

// 나레이션 미리듣기(06_publishing/cut_NN_final·preview.mp4) — 11/9 사고가 터진 바로 그 파일.
// 나레이션을 섞어 만든 결과라 오디오 스트림이 없으면 무조건 고장이다. 최종화가 가져다 쓰는 파일이면 단선, 무시되는 옛 파일이면 경고.
async function checkPreview({ cuts, dirs }) {
  const issues = []; let verified = 0, total = 0, usedN = 0, ignoredN = 0
  for (const cut of cuts) {
    const baseSt = statOf(path.join(dirs.video, `cut_${pad(cut.no)}.mp4`))
    const vt = pickVideoTabResult(dirs, cut.no, baseSt?.mtimeMs ?? 0)
    if (!vt.files.length) continue
    total++
    const inUse = !!baseSt && !!vt.used
    if (inUse) usedN++; else ignoredN++
    let bad = false
    for (const f of vt.files) {
      const isUsed = inUse && vt.used.path === f
      const level = isUsed ? 'fail' : 'warn'
      const tail = isUsed ? ' — 최종본에 그대로 들어감' : ''
      const name = path.basename(f)
      const p = await probeStreams(f)
      if (!p?.ok || p.video < 1 || p.duration <= 0.3) { issues.push({ cut: cut.no, level, msg: `${name} 손상(비디오 ${p?.video ?? 0}개 · ${(p?.duration || 0).toFixed(1)}초)${tail}` }); bad = true; continue }
      if (p.audio < 1) { issues.push({ cut: cut.no, level, msg: `${name} 오디오 0개${tail}` }); bad = true; continue }
      if (p.audio > 1) { issues.push({ cut: cut.no, level: 'warn', msg: `${name} 오디오 스트림 ${p.audio}개(1개여야 함)` }); bad = true }
    }
    if (!bad) verified++
  }
  return finish({ issues, verified, total, okText: `미리듣기 ${verified}/${total}컷 오디오 정상 · 최종화 사용 ${usedN} · 무시(옛 원본 기준) ${ignoredN}`, emptyText: '미리듣기 결과 없음(최종화가 직접 믹스)', extra: { used: usedN, ignored: ignoredN } })
}

// G5 → 최종화(07_output/{CODE}_final.mp4) — 완성본이 실제로 소리가 나고, 지금 컷들로 만든 것인가
async function checkFinalize({ code, cuts, gp, dirs, compose, staleFn }) {
  const finalPath = path.join(dirs.final, `${code}_final.mp4`)
  const issues = []
  const g5All = cuts.length > 0 && cuts.every(c => gp[`cut_${c.no}`]?.g5)
  if (!fs.existsSync(finalPath)) {
    if (g5All) issues.push({ level: 'fail', msg: `G5 승인인데 최종본(${code}_final.mp4) 없음` })
    return finish({ issues, verified: 0, total: 1, okText: '', emptyText: '최종본 아직 없음' })
  }
  const p = await probeStreams(finalPath)
  let volText = ''
  if (!p?.ok || p.video < 1 || p.duration <= 0.3) issues.push({ level: 'fail', msg: `최종본 손상(비디오 ${p?.video ?? 0}개 · ${(p?.duration || 0).toFixed(1)}초)` })
  else if (p.audio < 1) issues.push({ level: 'fail', msg: '최종본 오디오 0개' })
  else {
    if (p.audio > 1) issues.push({ level: 'warn', msg: `최종본 오디오 스트림 ${p.audio}개(1개여야 함)` })
    const vol = await meanVolume(finalPath)
    if (vol === null) issues.push({ level: 'warn', msg: '최종본 음량 측정 실패' })
    else if (!(vol > -45)) issues.push({ level: 'fail', msg: `최종본 무음(평균 ${vol}dB)` })
    else volText = ` · 평균 ${vol}dB`
    // 지금 05_video 컷 길이 합계와 다르면 다른 컷 구성으로 만든 최종본이다
    if (compose?.complete && Math.abs(p.duration - compose.sumDuration) > 1.5) issues.push({ level: 'warn', msg: `최종본 ${p.duration.toFixed(1)}초 ≠ 현재 컷 합계 ${compose.sumDuration.toFixed(1)}초` })
    let stale = null
    try { stale = staleFn ? staleFn() : null } catch { /* 판단 보류 */ }
    if (stale?.stale) issues.push({ level: 'warn', msg: stale.reason === 'source-changed' ? `최종본 생성 뒤 컷이 바뀜 — 재생성 필요(${String(stale.detail || '').split(' · ').length}건)` : '생성 기록(_finalize.json) 없음 — 소스 일치 확인 불가' })
  }
  return finish({ issues, verified: issues.some(i => i.level === 'fail') ? 0 : 1, total: 1, okText: `최종본 ${p.duration.toFixed(1)}초 · 오디오 ${p.audio}개${volText} · 현재 컷과 일치`, emptyText: '' })
}

// ── 외부 앱 노드(2026-11-12) ────────────────────────────────────────
// 트렌드레이더·Field Gate 는 이 저장소 밖의 별도 앱이고 "가끔 손으로 쓰는" 도구다. 그래서
//   · 앱이 지금 켜져 있는지(포트 핑)는 보지 않는다 — 꺼져 있는 게 정상 운영일 수 있다.
//   · 다른 노드와 같은 원칙으로 "그 앱이 남긴 파일"만 연다. 파일이 없으면 고장이 아니라 "아직 안 씀"이므로 null(판정 없음).
//   · fail 은 내지 않는다(여기서 빨강이 켜지면 에피소드 파일 단선 신호와 섞인다).
const DAY_MS = 86400000
const ymd = (t) => new Date(t).toLocaleDateString('sv-SE')   // YYYY-MM-DD(로컬)
const daysAgo = (t, now) => Math.max(0, Math.floor((now - t) / DAY_MS))
const idle = (evidence) => ({ state: null, evidence, verified: 0, total: 0, complete: false, issues: [] })

// 트렌드레이더 — downloads/state/trend_episodes.json(트렌드 → 에피소드 후보, /api/trend-to-episode 가 기록)과
// trend_candidates.json("후보풀로 전송", /api/trend-to-candidate 가 기록)의 실존·마지막 항목 시각.
// 기준 TREND_FRESH_DAYS 는 화면 표시용 느슨한 기준이다. 대본 후보 자동 생성(proxy.js fetchTrendData)은 훨씬 엄격해서
// 48시간(TREND_STALE_HOURS) 넘은 항목을 버리고 웹검색으로 대체한다 — 그 사실을 근거 문구에 같이 적는다.
const TREND_FRESH_DAYS = 7
function checkTrendRadar({ dirs, now = Date.now() }) {
  const files = [['트렌드 후보', dirs.trendEpisodes], ['후보풀 전송', dirs.trendCandidates]].filter(([, f]) => f && statOf(f))
  if (!files.length) return idle('트렌드 파일 없음 — 아직 사용 전')
  const issues = []; const parts = []; let last = 0, entries = 0
  for (const [label, f] of files) {
    const list = readJson(f, null)
    if (!Array.isArray(list)) { issues.push({ level: 'warn', msg: `${path.basename(f)} 읽기 실패(JSON 손상)` }); continue }
    // 항목의 createdAt 이 실제 수집 시각이다. mtime 은 동기화·복사로 바뀔 수 있어 항목에 시각이 없을 때만 쓴다.
    const times = list.map(e => Date.parse(e?.createdAt || '')).filter(Number.isFinite)
    const t = times.length ? Math.max(...times) : (list.length ? statOf(f).mtimeMs : 0)
    entries += list.length
    last = Math.max(last, t)
    parts.push(`${label} ${list.length}건`)
  }
  if (!entries && !issues.length) return idle('트렌드 파일은 있지만 항목 0건')
  if (last && now - last > TREND_FRESH_DAYS * DAY_MS) {
    issues.push({ level: 'warn', msg: `마지막 트렌드 ${ymd(last)}(${daysAgo(last, now)}일 전) — 대본 후보 생성은 48시간 넘은 트렌드를 버리고 웹검색으로 대체 중` })
  }
  return finish({ issues, verified: entries, total: entries, okText: `${parts.join(' · ')} · 마지막 ${ymd(last)}(${daysAgo(last, now)}일 전)`, emptyText: '', extra: { lastAt: last ? new Date(last).toISOString() : null } })
}

// 에이전트 앱(yeori-genline Field Gate) — 이 에피소드의 01_script/.genline-review.json (/api/genline-review 가 append).
// 결정 원장(에이전트 리더 로그, 출처=genline)은 Notion DB 라 로컬 파일이 없다 — 15초 폴링마다 Notion 을 부를 수는 없으므로
// 같은 판단이 로컬에 남는 이 파일만 본다. 최근 활동이 있으면 ok, 오래됐거나 없으면 "안 쓰는 중"일 뿐이라 null(경고·단선 없음).
const REVIEW_RECENT_DAYS = 7
function checkAgentApp({ dirs, now = Date.now() }) {
  const file = path.join(dirs.script, '.genline-review.json')
  if (!statOf(file)) return idle('Field Gate 검토 기록 없음 — 이 에피소드에서 미사용')
  const store = readJson(file, null)
  if (!store || typeof store !== 'object') return { ...idle('.genline-review.json 읽기 실패(JSON 손상)'), state: 'warn', issues: [{ level: 'warn', msg: '.genline-review.json 읽기 실패(JSON 손상)' }] }
  const cutKeys = Object.keys(store).filter(k => Array.isArray(store[k]) && store[k].length)
  const all = cutKeys.flatMap(k => store[k])
  if (!all.length) return idle('Field Gate 검토 기록 0건')
  const last = Math.max(...all.map(e => Date.parse(e?.at || '')).filter(Number.isFinite), 0)
  const verdicts = all.filter(e => e?.kind === 'verdict')
  const pass = verdicts.filter(e => e.value === 'pass').length
  const summary = `검토 ${all.length}건(컷 ${cutKeys.length}개) · 판정 ${verdicts.length}건${verdicts.length ? `(통과 ${pass} · 재작업 ${verdicts.length - pass})` : ''} · 마지막 ${last ? `${ymd(last)}(${daysAgo(last, now)}일 전)` : '시각 미상'}`
  const recent = last > 0 && now - last <= REVIEW_RECENT_DAYS * DAY_MS
  if (!recent) return { ...idle(`${summary} — 최근 미사용`), lastAt: last ? new Date(last).toISOString() : null }
  return { state: 'ok', evidence: summary, verified: all.length, total: all.length, complete: true, issues: [], lastAt: new Date(last).toISOString() }
}

// 에이전트 리더(scripts/pipeline-leader.js) — 전 단계를 가로지르는 지휘 레이어. 리더 자신의 중복실행 락파일만 본다.
//   락 규칙(pipeline-leader.js 89~110행 · proxy.js /api/pipeline-leader-status 와 동일 기준):
//   · 경로: <앱 루트>/downloads/state/.pipeline-leader-<episodeId>.lock — ★ mp.statePath(C:/yeori-studio/downloads/state)가 아니라
//     앱 폴더 밑(app/downloads/state)이다. 리더가 CODE_ROOT(=app) 기준으로 쓰기 때문.
//   · <episodeId> 는 에피소드 코드(IG_R05)가 아니라 studio-state.json 의 내부 id(ep_1790322063208 — activeEpisodeId / episodes 의 키).
//   · 내용 = 리더 PID, mtime = 마지막 사이클(매 사이클 touchLock). 정상 종료하면 리더가 락을 지운다 → 남아 있는 옛 락은 창을 그냥 닫은 흔적.
//   · 실행 중 = PID 살아있음 + mtime 5분 이내.
//   판정: 실행 중이면 ok. 그 밖(락 없음·종료됨·5분 넘게 조용함)은 전부 null — 리더는 필요할 때만 켜는 도구라 꺼져 있는 게 고장이 아니다.
//   fail·warn 은 내지 않는다. Notion(에이전트 리더 로그·/api/mcp/leader-status)은 토큰·네트워크 의존이라 여기서 부르지 않고,
//   대신 리더가 로컬에 남기는 Flow 실패 기록(downloads/state/pipeline-leader-flow-state-<episodeId>.json)을 보조 문구로만 덧붙인다.
const LEADER_LOCK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'downloads', 'state')
const LEADER_FRESH_MS = 5 * 60 * 1000
const pidAlive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' } }   // EPERM = 있지만 권한 없음(=살아있음)
const agoText = (ms) => ms < 60000 ? `${Math.max(0, Math.round(ms / 1000))}초 전` : ms < 3600000 ? `${Math.floor(ms / 60000)}분 전` : ms < DAY_MS ? `${Math.floor(ms / 3600000)}시간 전` : `${Math.floor(ms / DAY_MS)}일 전`
function checkPipelineLeader({ episodeId, dirs, now = Date.now() }) {
  if (!episodeId || !dirs.leaderLocks) return idle('리더 락 조회 불가 — 에피소드 내부 id 미상')
  const lock = path.join(dirs.leaderLocks, `.pipeline-leader-${episodeId}.lock`)
  const st = statOf(lock)
  // 보조 정보(있으면 덧붙임 · 실패해도 무시): 리더가 기록한 Flow 실패 횟수·사람에게 넘긴 컷
  let extraText = ''
  try {
    const fsPath = dirs.leaderFlowState ? path.join(dirs.leaderFlowState, `pipeline-leader-flow-state-${episodeId}.json`) : null
    const flow = fsPath ? readJson(fsPath, null) : null
    if (flow) {
      const failN = Object.keys(flow.failures || {}).length, humanN = (flow.human || []).length
      if (failN || humanN) extraText = ` · Flow 실패 기록 ${failN}건 · 사람에게 넘김 ${humanN}건`
    }
  } catch { /* 보조 정보 — 없어도 된다 */ }
  if (!st) return idle(`리더 락 없음 — 이 에피소드(${episodeId})에 리더를 띄운 적 없거나 정상 종료됨${extraText}`)
  let pid = null
  try { pid = parseInt(String(fs.readFileSync(lock, 'utf-8')).trim(), 10) || null } catch { /* 못 읽으면 꺼진 것으로 */ }
  const age = now - st.mtimeMs
  const alive = !!pid && pidAlive(pid)
  const lastAt = new Date(st.mtimeMs).toISOString()
  const when = `${age >= DAY_MS ? ymd(st.mtimeMs) + ' ' : ''}${new Date(st.mtimeMs).toTimeString().slice(0, 8)}(${agoText(age)})`
  if (alive && age < LEADER_FRESH_MS) {
    return { state: 'ok', evidence: `리더 실행 중 · PID ${pid} · 마지막 사이클 ${when}${extraText}`, verified: 1, total: 1, complete: true, issues: [], running: true, pid, lastAt, episodeId }
  }
  const why = alive ? `PID ${pid} 는 살아있지만 5분 넘게 사이클 없음(유휴이거나 같은 번호의 다른 프로세스)` : `PID ${pid ?? '미상'} 종료됨`
  return { ...idle(`${alive ? '리더 유휴' : '리더 꺼짐'} — 마지막 사이클 ${when} · ${why}${extraText}`), running: false, pid, lastAt, episodeId }
}

// ── 에피소드 전체 판정 ─────────────────────────────────────────────
// dirs 를 넘기면 그 폴더만 본다(단위 테스트: 오염 파일 "복사본"을 임시 폴더에 두고 검증 — production 경로를 건드리지 않는다).
export function defaultDirs(code) {
  return {
    script: mp.scriptDir(code), images: mp.imagesDir(code), audio: mp.audioDir(code), raw: path.join(mp.makingDir(code), 'raw'),
    video: mp.videoDir(code), publishing: mp.outputDir(code), final: mp.finalDir(code),
    // 외부 앱(트렌드레이더)이 남기는 전역 상태 파일 — 에피소드와 무관. 테스트용 dirs 에 없으면 판정 없음(null)으로 나온다.
    trendEpisodes: mp.statePath('trend_episodes.json'), trendCandidates: mp.statePath('trend_candidates.json'),
    // 에이전트 리더 락(app/downloads/state)과 Flow 실패 기록(downloads/state) — 위 checkPipelineLeader 주석 참고
    leaderLocks: LEADER_LOCK_DIR, leaderFlowState: path.join(mp.DOWNLOADS, 'state'),
  }
}
export async function evaluatePipelineHealth({ code, cuts = [], gp = {}, dirs, staleFn, episodeId } = {}) {
  const d = dirs || defaultDirs(code)
  const ctx = { code, cuts, gp, dirs: d, episodeId }
  const scriptFiles = listDir(d.script).filter(f => /\.txt$/i.test(f))
  const script = cuts.length
    ? { state: 'ok', evidence: `컷 ${cuts.length}개 파싱됨 · 대본 파일 ${scriptFiles.length}개`, verified: cuts.length, total: cuts.length, complete: true, issues: [] }
    : { state: null, evidence: '컷 없음', verified: 0, total: 0, complete: false, issues: [] }
  const [image, tts, video, compose, preview] = await Promise.all([checkImages(ctx), checkTts(ctx), checkRaw(ctx), checkCompose(ctx), checkPreview(ctx)])
  const finalize = await checkFinalize({ ...ctx, compose, staleFn: staleFn !== undefined ? staleFn : (dirs ? null : () => checkFinalStale(code)) })
  // 외부 앱 노드는 실패해도 에피소드 판정을 막지 않는다
  const safe = (fn) => { try { return fn(ctx) } catch (e) { return idle(`실측 실패 — ${e.message}`) } }
  const trendRadar = safe(checkTrendRadar), agentApp = safe(checkAgentApp), pipelineLeader = safe(checkPipelineLeader)
  return { code, checkedAt: new Date().toISOString(), nodes: { script, image, tts, video, compose, preview, finalize, trendRadar, agentApp, pipelineLeader } }
}

// studio-state.json 에서 코드에 해당하는 컷 목록(활성 에피소드는 최상위, 그 밖엔 episodes 보관본). code 생략 = 활성 에피소드.
export function resolveEpisodeCuts(code) {
  const state = readJson(STATE_PATH, {})
  const activeCode = state.episode?.code || (state.episode?.number != null ? mp.resolveCode(state.episode.number) : null)
  // episodeId = 내부 id(ep_…) — 에이전트 리더 락파일 이름에 쓰인다(활성: activeEpisodeId, 보관본: episodes 의 키)
  if (!code || code === activeCode) return { code: activeCode, cuts: state.cuts || [], active: true, episodeId: state.activeEpisodeId || null }
  const hit = Object.entries(state.episodes || {}).find(([, e]) => e.episode?.code === code)
  return hit ? { code, cuts: hit[1].cuts || [], active: false, episodeId: hit[0] } : null
}
export async function pipelineHealthFor(code) {
  const ep = resolveEpisodeCuts(code)
  if (!ep?.code) return null
  const gp = readJson(mp.statePath('gpoints.json'), {})[ep.code] || {}
  return { ...(await evaluatePipelineHealth({ code: ep.code, cuts: ep.cuts, gp, episodeId: ep.episodeId })), active: ep.active }
}
