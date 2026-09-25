#!/usr/bin/env node
/**
 * pipeline-leader.js — G1~G5 MCP 도구(server/mcp-tools.js)를 실제로 체이닝하는 오케스트레이터.
 *
 * 배경: studio_run_g2/g3/g4/g5, studio_approve_g* 도구는 전부 잘 만들어져 있었지만
 * 이걸 순서대로 호출해서 "완료 대기 -> 다음 단계 자동 진행"까지 해주는 지휘자가
 * 없었다. content_matrix_v3.html의 "에이전트 리더" 탭은 이름만 그럴듯했지 이 MCP
 * 도구를 단 한 번도 호출하지 않는 완전히 별개의 얕은 재구현이었다(G1은 무관한 Claude
 * 제안, G2는 상태 확인만, G3는 대사 있는 첫 컷 1개만, G5는 루프에 아예 없음).
 *
 * 이 스크립트가 그 지휘자 역할을 한다. 활성 에피소드의 컷 상태를 주기적으로 조회해서
 * "다음에 뭘 실행해야 하는지" 판단하고, run(생성) 단계는 자동으로 호출한다. 단
 * approve(승인) 단계는 항상 사람이 스튜디오 UI에서 직접 눌러야 하고, 이 스크립트는
 * 승인 대기 상태를 로그로 알려주기만 한다 — shouldAutoApprove()가 그 정책의 유일한
 * 진입점이니, 나중에 "에이전트 리더가 산출물을 평가해서 자동 승인"하도록 바꾸려면
 * 거기만 고치면 된다(사용자 확인: "최초 적용은 인간이 승인하고, 곧 에이전트 리더가
 * 판단할 수 있는 조건을 만들려고 한다").
 *
 * G2(이미지)와 G3(TTS)는 둘 다 G1 승인만 있으면 되고 서로 의존관계가 없어 병렬로
 * 트리거한다(G4는 G2 승인된 이미지가 스타트 프레임으로 필요해 G2 이후로 순차).
 * G2/G4는 Flow/Veo 브라우저 자동화라 Chrome 세션을 하나만 공유하므로, 컷별로 따로
 * 승인될 때마다 개별 호출하면 이전 배치가 안 끝난 채로 새 요청이 겹쳐 같은 브라우저에
 * 중복 탭이 열리고 서로 조작을 방해한다(실측 중 실제로 발생 — Google이 봇 행동으로
 * 감지해 reCAPTCHA까지 뜸). 그래서 G2/G4는 에피소드당 동시에 1개 배치만 진행 중이도록
 * 락을 걸고, 그 사이 새로 승인된 컷은 지금 배치가 끝난 다음 사이클에서 합쳐 처리한다.
 *
 * 사용법:
 *   node scripts/pipeline-leader.js --episode=ep_1784551030896
 *   node scripts/pipeline-leader.js --episode=... --interval=20   (폴링 간격, 초. 기본 30)
 *   node scripts/pipeline-leader.js --episode=... --once          (한 사이클만 실행 후 종료)
 *   node scripts/pipeline-leader.js --episode=... --from=g2 --to=g4  (g1~g5 중 이 구간만 실행)
 *
 * server/proxy.js의 POST /api/pipeline/start가 이 스크립트를 웹에서 spawn할 때도
 * 위와 동일한 --key=value 형식의 인자를 그대로 사용한다.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as mp from '../server/lib/mediaPaths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CODE_ROOT = path.join(__dirname, '..')
const BASE_URL = 'http://localhost:3001'

// .env.local 로드 (server/mcp-server.js와 동일한 파싱 방식)
;(() => {
  const envPath = path.join(CODE_ROOT, '.env.local')
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^=\s#][^=]*)=(.*)$/)
    if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim() }
  })
})()
const MCP_BRIDGE_SECRET = process.env.MCP_BRIDGE_SECRET || ''
if (!MCP_BRIDGE_SECRET) {
  console.error('[pipeline-leader] MCP_BRIDGE_SECRET이 .env.local에 없습니다 (proxy.js의 /api/mcp/* 인증에 필요).')
  process.exit(1)
}

function parseArgs() {
  return Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] })
  )
}
const args = parseArgs()
// --episode 생략 시 studio-state.json 의 활성 에피소드를 쓴다 (start_gen.bat 단일 진입점용).
function activeEpisodeFromState() {
  for (const p of [path.join(CODE_ROOT, 'studio-state.json'), path.join(CODE_ROOT, 'downloads', 'studio-state.json')]) {
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (s.activeEpisodeId) return s.activeEpisodeId
    } catch { /* 다음 경로 */ }
  }
  return null
}
const EPISODE_ID = args.episode === true || !args.episode ? activeEpisodeFromState() : args.episode
if (!EPISODE_ID) {
  console.error('[pipeline-leader] 에피소드를 못 찾음 — --episode=<episodeId> 를 주거나 스튜디오에서 에피소드를 활성화하세요.')
  process.exit(1)
}
const INTERVAL_MS = (parseInt(args.interval, 10) || 30) * 1000
const RUN_ONCE = !!args.once

// ── 중복 실행 방지 락파일 (start_gen.bat 을 여러 번 눌러도 안전) ──
// 락의 PID 가 실제 살아있고 5분 내 갱신됐으면 중복으로 보고 종료, 아니면 뺏는다.
const LOCK_PATH = path.join(CODE_ROOT, 'downloads', 'state', `.pipeline-leader-${EPISODE_ID}.lock`)
;(() => {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const fresh = Date.now() - fs.statSync(LOCK_PATH).mtimeMs < 5 * 60 * 1000
      let alive = false
      try {
        const oldPid = parseInt(String(fs.readFileSync(LOCK_PATH, 'utf-8')).trim(), 10)
        if (oldPid && oldPid !== process.pid) { process.kill(oldPid, 0); alive = true }
      } catch { alive = false }
      if (alive && fresh) {
        console.error(`[pipeline-leader] 이미 실행 중 (PID 살아있음, 락: ${LOCK_PATH}) — 종료.`)
        process.exit(0)
      }
    }
    fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true })
    fs.writeFileSync(LOCK_PATH, String(process.pid))
  } catch { /* 락 실패해도 진행 */ }
})()
const touchLock = () => { try { fs.utimesSync(LOCK_PATH, new Date(), new Date()) } catch { /* noop */ } }
const releaseLock = () => { try { fs.rmSync(LOCK_PATH) } catch { /* noop */ } }
process.on('exit', releaseLock)
process.on('SIGINT', () => { releaseLock(); process.exit(0) })
process.on('SIGTERM', () => { releaseLock(); process.exit(0) })
// 메이킹 컷(GRAPHIC/CAPCUT/BROLL) 자동 제작 — 기본 ON, --making=off 로 비활성(로그만)
const MAKING_AUTORUN = args.making !== 'off'
// G2·G4 Flow 무료 경로 자동 실행(2026-09-25 재연결). 9/2 "수동 전환" 이후 flow-image.js / flow-submit.js 가 새로 생겼는데
// 리더에 연결되지 않아 매번 이 두 단계에서 흐름이 끊겼다. --g2=off / --g4=off 로 끌 수 있다.
const G2_AUTO = args.g2 !== 'off'
const G4_AUTO = args.g4 !== 'off'
const G4_BUDGET = Number(args['g4-budget'] || 50)          // 하루 Flow 영상 크레딧 한도(성준님 계정 일 50)
const G4_MAX_CREDITS_PER_CLIP = 15
const FLOW_DRY = !!args["flow-dry"]                      // 시험용: 영상 제출을 검증 관문까지만(전송·크레딧 없음)

// ── 스테이지 범위(--from/--to) — 웹 UI(에이전트 리더 탭)가 "이 구간만 실행"을
// 지정할 수 있도록 지원. 기본은 g1~g5 전체. G1은 사람이 스튜디오 UI에서 승인하는
// 단계라 이 스크립트가 트리거하는 게 없으므로(승인대기 로그만) 범위에 넣어도
// 동작에 영향 없음 — G2~G5 트리거 블록만 실제로 게이팅한다.
const STAGE_ORDER = ['g1', 'g2', 'g3', 'g4', 'g5']
const FROM_STAGE = (args.from || 'g1').toLowerCase()
const TO_STAGE = (args.to || 'g5').toLowerCase()
if (!STAGE_ORDER.includes(FROM_STAGE) || !STAGE_ORDER.includes(TO_STAGE)) {
  console.error(`[pipeline-leader] --from/--to는 ${STAGE_ORDER.join('/')} 중 하나여야 합니다 (from=${FROM_STAGE}, to=${TO_STAGE})`)
  process.exit(1)
}
function stageInRange(stage) {
  const i = STAGE_ORDER.indexOf(stage)
  return i >= STAGE_ORDER.indexOf(FROM_STAGE) && i <= STAGE_ORDER.indexOf(TO_STAGE)
}

// ── 컷 유형별 파이프라인 적용 규칙 ─────────────────────────────────
// 모든 컷이 G1~G5를 다 거치는 게 아니다:
//   GRAPHIC/CAPCUT/BROLL = 메이킹 탭에서 mp4를 직접 제작 → Flow 이미지(G2)·Veo 영상(G4) 안 씀.
//   대사/나레이션 없는 컷 = TTS(G3) 대상 아님.
// 이걸 반영 안 하면 "그런 컷이 하나라도 있는 에피소드"는 해당 단계 완료 판정이 영영 안 나서
// 매 사이클 재시도하거나(2026-08-17 G3에서 실측) 잘못된 "수동 제작 대기" 보고가 뜬다.
const MAKING_TYPES = ['GRAPHIC', 'CAPCUT', 'BROLL']
const cutTypeOf     = (c) => String(c.cutType || 'YEORI').toUpperCase()
const isMakingType  = (c) => MAKING_TYPES.includes(cutTypeOf(c))
const needsGenImage = (c) => !isMakingType(c)                    // YEORI 등 — 생성 이미지 필요
// TTS 대상. 릴스(IG_R)는 대사를 Flow 영상 음성으로 쓰므로 나레이션 컷만(2026-09-25) — IS_REEL 은 첫 사이클에서 코드로 판정
let IS_REEL = false
const needsG3       = (c) => IS_REEL ? !!c.hasNarration : !!(c.hasDialogue || c.hasNarration)

// 에피소드가 현재 걸린 게이트 — 가장 앞선 미완료 단계. 파이프라인 DB "현재 게이트" 값.
function deriveGate(cuts, summary) {
  if (!cuts.length || summary.g1 < cuts.length) return 'G1 대본'
  if (cuts.some(c => needsGenImage(c) && !c.g2 && !c.hasVideo)) return 'G2 이미지'
  if (cuts.some(c => needsG3(c) && !c.g3)) return 'G3 TTS'
  if (cuts.some(c => !c.g4)) return 'G4 영상'
  if (summary.g5 < cuts.length) return 'G5 편집'
  return '완료'
}

// 이 단계가 이 컷에 적용되는가
function stageApplies(c, stage) {
  // G2(이미지 선택)는 생성 이미지가 필요한 컷만. 단 영상을 직접 제작한 컷(text→video,
  // 시작 프레임 없이)은 이미 hasVideo라 이미지 단계가 무의미 → 제외.
  if (stage === 'g2') return needsGenImage(c) && !c.hasVideo
  if (stage === 'g3') return needsG3(c)
  return true   // g1, g4, g5 — 전체
}
// 이 컷에서 이 단계가 실질적으로 끝났는가. 메이킹 컷도 이제 g4 승인 게이트를 거친다
// (2026-09-08 — 제작 완료 ≠ 확정. mp4 존재만으로 다음 단계로 넘어가지 않음).
function cutStageDone(c, stage) {
  return !!c[stage]
}
// studio-status가 내려주는 cuts[].g1~g5는 서버가 gpoints.json을 병합해 넣은 값이라 그대로 신뢰.
function isStageComplete(cuts, stage) {
  const targets = cuts.filter(c => stageApplies(c, stage))
  return cuts.length > 0 && (targets.length === 0 || targets.every(c => cutStageDone(c, stage)))
}
const isG3Complete = (cuts) => isStageComplete(cuts, 'g3')   // 하위호환 별칭

async function api(method, endpoint, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MCP_BRIDGE_SECRET}` },
  }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(`${BASE_URL}${endpoint}`, opts)
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}

function log(stage, msg) {
  const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false })
  console.log(`[${ts}] [${stage}] ${msg}`)
}

// 에이전트 리더 로그 (Notion "에이전트 리더 로그" DB) — 의미있는 자율 판단만 한 행씩.
// 프록시가 Notion 토큰 보유. 실패해도 사이클 절대 안 막음. (설계: "에이전트 리더 백본" §04)
let EP_LABEL = EPISODE_ID
async function leaderLog(entry) {
  try {
    await api('POST', '/api/mcp/leader-log', { episode: EP_LABEL, source: 'pipeline-leader', ...entry })
  } catch { /* noop */ }
}
// P2: 에피소드 파이프라인 DB 행 갱신 (현재 게이트·에이전트 상태·다음 액션·블로커·마지막 사이클)
async function leaderEpisodeSync(payload) {
  try {
    await api('POST', '/api/mcp/leader-episode-sync', payload)
  } catch { /* noop */ }
}

// ── P3: 사람이 Notion 에서 토글하는 정책을 매 사이클 읽는다 ──────────────
//   보류(checkbox)          → 이번 사이클 이 에피소드 전부 스킵 (생성·승인 아무것도 안 함)
//   에이전트 자동승인(multi) → 여기 든 스테이지는 shouldAutoApprove 가 산출물 검수 후 자동 승인
// 조회 실패/행 없음 → fail-open: 보류 아님·자동승인 없음(전부 사람) 으로 간주 — 안전한 기본값.
let AUTO_APPROVE = []          // ['making', 'G3', ...] — 이번 사이클 정책
let heldLoggedAt = 0          // 보류 로그 중복 방지 (해제되면 0 으로 리셋)
async function leaderContext() {
  try {
    const r = await api('GET', `/api/mcp/leader-context?episode=${encodeURIComponent(EP_LABEL)}`)
    if (r.ok && r.data?.ok) return { hold: !!r.data.hold, autoApprove: r.data.autoApprove || [] }
  } catch { /* noop */ }
  return { hold: false, autoApprove: [] }
}

// ── 승인 정책 — 기본은 사람(스튜디오/메이킹 UI) 대기. 단 사람이 Notion "에이전트 자동승인"
// 에 해당 스테이지를 넣어두면, 리더가 산출물을 기본 검수한 뒤 통과 시 자동 승인한다
// (사용자 확인: "최초 적용은 인간이 승인하고, 곧 에이전트 리더가 판단할 수 있는 조건을 만든다").
//   stage: 'making' | 'g2' | 'g3' | 'g4'  ← 호출부 인자
//   cut:   studio-status 의 컷 항목({no, cutType, hasVideo, making:{duration,method}, review, ...})
// 현재 검수 = 제작 매니페스트 유효성(길이>0)·mp4 존재·미반려. 프레임 레벨 QC(검정/빈 화면
// 감지)는 후속(P4) — 그때도 이 함수만 손대면 된다.
// 게이트 검수 판정 조회(사이클 안 캐시 60초). 실패하면 null. 승인은 하지 않고 판정만 가져온다.
const eligCache = {}
async function gateEligibility(gate) {
  const hit = eligCache[gate]
  if (hit && Date.now() - hit.at < 60000) return hit.cuts
  try {
    const r = await api('GET', `/api/mcp/gate-eligibility?gate=${gate}`)
    if (r.ok && r.data?.ok) { eligCache[gate] = { at: Date.now(), cuts: r.data.cuts }; return r.data.cuts }
  } catch { /* noop */ }
  return null
}

// G3 처럼 "위임 가능" 정책인 스테이지를 검수 통과 컷에 한해 자동 승인한다. Notion "에이전트 자동승인"에 해당 스테이지가
// 들어 있을 때만 호출된다(호출부에서 확인). blocked 컷은 사람 개입 필요로 로그(같은 컷은 프로세스당 1회만).
const blockedLogged = new Set()
async function autoApproveByPolicy(gate, endpoint) {
  const cutsEv = await gateEligibility(gate)
  if (!cutsEv) { log('정책', `${gate} 검수 조회 실패 — 자동 승인 안 함`); return [] }
  const okCuts = cutsEv.filter(c => c.verdict === 'auto_ok').map(c => c.no)
  for (const c of cutsEv.filter(c => c.verdict === 'blocked')) {
    const key = `${gate}:${c.no}`
    if (blockedLogged.has(key)) continue
    blockedLogged.add(key)
    log('정책', `${gate} CUT ${c.no} 자동 승인 불가 — ${(c.reasons || []).join(' / ')}`)
    await leaderLog({ stage: gate, kind: '블로커', summary: `CUT ${c.no} ${gate} 검수 실패 — 사람 확인 필요`, result: (c.reasons || []).join(' · '), humanInvolved: true })
  }
  if (!okCuts.length) return []
  const r = await api('POST', endpoint, { episodeId: EPISODE_ID, cutIds: okCuts })
  if (!r.ok) { log('정책', `${gate} 자동 승인 실패 — ${r.data?.error || r.status}`); return [] }
  log('정책', `${gate} 자동 승인(검수 통과) — 컷 ${okCuts.join(',')}`)
  await leaderLog({ stage: gate, kind: '자동승인', summary: `${gate} 컷 ${okCuts.join(',')} 자동 승인`, rationale: 'gatePolicy 검수 auto_ok + Notion 자동승인 위임', humanInvolved: false })
  return okCuts
}

async function shouldAutoApprove(stage, cut) {
  // Notion "에이전트 자동승인" 은 G 게이트를 대문자로 저장(G2/G3/G4/G5), 메이킹은 'making'.
  const key = stage === 'making' ? 'making' : String(stage).toUpperCase()
  if (!AUTO_APPROVE.includes(key)) return false

  if (stage === 'making') {
    const bad = []
    if (!cut.hasVideo) bad.push('mp4 없음')
    if (!(cut.making && Number(cut.making.duration) > 0)) bad.push('제작 매니페스트 무효')
    if (cut.review?.status === 'rejected') bad.push('사람 반려됨')
    // 2026-09-21: 게이트 정책 검수(server/lib/gatePolicy.js, 결정론적·AI 없음) 통과가 추가 조건 — 파일 존재 외에
    // ffprobe 해상도·길이(DU ±1초)·검정 화면·반려까지 본다. 검수기를 못 부르면 안전하게 승인하지 않는다(fail-closed).
    const ev = await gateEligibility('G4')
    const v = ev?.find(c => c.no === cut.no)
    if (!ev) bad.push('게이트 검수 조회 실패')
    else if (!v || v.verdict !== 'auto_ok') bad.push(`게이트 검수 ${v?.verdict || '없음'}${v?.reasons?.length ? ': ' + v.reasons.join(' / ') : ''}`)
    if (bad.length) {
      await leaderLog({
        stage: 'G4', kind: '블로커', summary: `CUT ${cut.no} 자동 승인 보류 — 기본 검수 실패`,
        rationale: `에이전트 자동승인=making 인데 검수 미통과`, result: bad.join(' · '), humanInvolved: true,
      })
      return false
    }
    return true
  }
  // 그 외 스테이지(g2/g3/g4)는 아직 자동승인 검수 로직 없음 — 안전하게 사람 대기.
  return false
}

// G2(이미지)·G4(영상)는 더 이상 자동 트리거하지 않는다(2026-09-02, 수동 전환).
// Flow/Veo 브라우저 자동화가 벤더 UI 변경으로 반복적으로 깨져 파이프라인 신뢰성을
// 못 지켰음. 두 단계 모두 사람이 외부 도구에서 제작 → 스튜디오에서 업로드하고,
// 리더는 "어느 컷이 아직 이미지/영상 없는지" 보고만 한다.
let g5Triggered = false

// 반환값: 목표 단계(TO_STAGE)까지 전체 컷이 완료됐는지(true/false) — main()이 이걸로
// 더 이상 폴링할 필요가 없다고 판단해서 스스로 종료한다.
async function checkAndAdvance() {
  const statusRes = await api('GET', `/api/mcp/studio-status?episodeId=${encodeURIComponent(EPISODE_ID)}`)
  if (!statusRes.ok) {
    log('상태조회', `실패 — ${statusRes.data?.error || statusRes.status}`)
    await leaderLog({ stage: '사이클', kind: '블로커', summary: '스튜디오 상태 조회 실패',
      result: String(statusRes.data?.error || statusRes.status), humanInvolved: true })
    return false
  }
  const { episode, cuts, summary } = statusRes.data
  EP_LABEL = episode?.code || episode?.title || EPISODE_ID
  IS_REEL = /^IG_R/i.test(String(episode?.code || ''))
  log('상태', `${episode?.title || EPISODE_ID} · G1 ${summary.g1} · G2 ${summary.g2} · G3 ${summary.g3} · G4 ${summary.g4} · G5 ${summary.g5} (전체 ${cuts.length}컷)`)

  // ── P3: 사람이 Notion 에서 건 정책 읽기 (보류 / 에이전트 자동승인) ──
  const ctx = await leaderContext()
  AUTO_APPROVE = ctx.autoApprove
  if (AUTO_APPROVE.length) log('정책', `에이전트 자동승인 위임: ${AUTO_APPROVE.join(', ')}`)
  if (ctx.hold) {
    log('보류', '이 에피소드는 Notion 에서 보류됨 — 이번 사이클 아무것도 실행/승인 안 함')
    if (Date.now() - heldLoggedAt > 30 * 60 * 1000) {   // 30분에 한 번만 로그
      heldLoggedAt = Date.now()
      await leaderLog({
        stage: '사이클', kind: '사이클요약', summary: '에피소드 보류 중 — 리더 대기',
        rationale: '에피소드 파이프라인 DB "보류" 체크됨', result: '사람이 보류 해제 대기', humanInvolved: true,
      })
    }
    await leaderEpisodeSync({
      episodeCode: episode?.code || EP_LABEL, episodeTitle: episode?.title,
      currentGate: deriveGate(cuts, summary), agentState: '보류',
      nextAction: '사람이 Notion 에서 보류 해제 대기', blocker: '',
      cutCount: cuts.length,
      isLong: /^LF/i.test(String(episode?.code || '')) ? true : /^SF/i.test(String(episode?.code || '')) ? false : undefined,
    })
    return false
  }
  heldLoggedAt = 0   // 보류 해제됨 — 다음에 다시 보류되면 즉시 로그

  // 이 사이클 상태 — 끝에서 에피소드 파이프라인 DB(P2)에 동기화
  let cycleBlocker = ''
  let didTrigger = false
  let makingWaiting = []

  // ── G1: 트리거할 게 없는 단계(사람이 스튜디오 UI에서 승인) — 완료 여부만 로그로 확인 ──
  if (stageInRange('g1') && isStageComplete(cuts, 'g1')) {
    log('G1', '이미 완료된 단계 — 스킵')
  }

  // ── G2: 이미지 생성 자동 트리거 안 함(수동). 생성 이미지가 필요한 컷(YEORI 등)만 보고. ──
  if (await pollActiveFlow()) { didTrigger = true; log('Flow', `진행 중 — ${flowLabel(activeFlow)}`) }
  if (stageInRange('g2') && !isStageComplete(cuts, 'g2')) {
    const needImg = cuts.filter(c => c.g1 && needsGenImage(c) && !c.hasImage && !c.hasVideo)
    const autoImg = needImg.filter(c => !flowHuman.has(`g2:${c.no}`))
    if (G2_AUTO && autoImg.length && !activeFlow) {
      if (!(await flowReady())) {
        cycleBlocker = 'Flow 전용 Chrome(9222)·Flow 프로젝트 탭이 준비되지 않음'
        log('G2', `⏸ ${cycleBlocker}`)
      } else {
        const r = await api('POST', '/api/flow/image', { episodeCode: episode?.code, cutNos: autoImg.map(c => c.no), count: 2 })
        if (r.ok && r.data?.jobId) {
          activeFlow = { kind: 'g2', jobId: r.data.jobId, cutNos: autoImg.map(c => c.no) }; didTrigger = true
          log('G2', `이미지 자동 생성 시작(Flow 무료) — 컷 ${autoImg.map(c => c.no).join(',')} · 컷당 2장`)
        } else log('G2', `이미지 생성 요청 실패 — ${r.data?.error || r.status}`)
      }
    } else if (needImg.length && !G2_AUTO) {
      log('G2', `이미지 수동 제작 대기 — 컷 ${needImg.map(c => c.no).join(',')} (--g2=off)`)
    }
  }

  // ── 메이킹 컷(GRAPHIC/CAPCUT/BROLL): Flow/Veo 안 쓰고 mp4를 직접 만든다 ──
  //   1) 제작: g1 승인 · 영상 없음 컷을 /api/mcp/run-making 으로 헤드리스 일괄 제작
  //      (대본 컷 필드 HTML:/SRC:/BQ:/URL: 로 소스 결정. 소스 못 찾는 컷은 스킵 로그)
  //   2) 승인 게이트: 제작됐지만 g4 미승인 컷은 shouldAutoApprove 정책에 따라
  //      자동 승인하거나(에이전트 리더) 사람 승인 대기 로그
  if (stageInRange('g4')) {
    const needMaking = cuts.filter(c => c.g1 && isMakingType(c) && !c.hasVideo)
    if (needMaking.length) {
      const byType = {}
      needMaking.forEach(c => { (byType[cutTypeOf(c)] ||= []).push(c.no) })
      const label = Object.entries(byType).map(([t, ns]) => `${t} 컷 ${ns.join(',')}`).join(' · ')
      if (MAKING_AUTORUN) {
        didTrigger = true
        log('제작', `메이킹 컷 자동 제작 시작 — ${label}`)
        const r = await api('POST', '/api/mcp/run-making', { episodeId: EPISODE_ID, cutIds: needMaking.map(c => c.no) })
        if (!r.ok) {
          log('제작', `run-making 실패 — ${r.data?.error || r.status}`)
          cycleBlocker = `run-making 실패: ${r.data?.error || r.status}`
          await leaderLog({ stage: 'making', kind: '블로커', summary: 'run-making 실패', rationale: label,
            result: String(r.data?.error || r.status), humanInvolved: true })
        } else {
          for (const x of (r.data.results || [])) {
            const tag = x.status === 'produced' ? '✅' : x.status === 'skipped' ? '⏭️' : '❌'
            log('제작', `${tag} CUT ${x.cutNo} (${x.type}) ${x.method || ''} ${x.reason ? `— ${x.reason}` : x.query ? `— "${x.query}"` : ''}`.trimEnd())
          }
          const P = r.data.producedCount, S = r.data.skippedCount, E = r.data.errorCount
          log('제작', `제작 ${P} · 스킵 ${S} · 실패 ${E}`)
          const skips = (r.data.results || []).filter(x => x.status !== 'produced')
            .map(x => `CUT ${x.cutNo} ${x.status}${x.reason ? ` (${x.reason})` : ''}`).join(' · ')
          if (E > 0) cycleBlocker = `메이킹 제작 실패 ${E}컷 — ${skips}`
          await leaderLog({
            stage: 'making', kind: E > 0 ? '블로커' : '자동실행',
            summary: `메이킹 컷 자동 제작 — 제작 ${P} · 스킵 ${S} · 실패 ${E}`,
            rationale: `g1 승인 + 영상 없음: ${label}`,
            result: skips || `${P}컷 제작 완료`, humanInvolved: E > 0 || S > 0,
          })
        }
      } else {
        log('제작', `메이킹 탭 제작 대기 — ${label} (--making=off, 자동 제작 꺼짐)`)
      }
    }

    // 사람이 반려한 메이킹 컷 — 재제작 대기(파라미터 조정 후 메이킹 탭에서 재실행)
    const rejected = cuts.filter(c => isMakingType(c) && c.review?.status === 'rejected')
    if (rejected.length) {
      const rlist = rejected.map(c => `${c.no}${c.review?.note ? `(${String(c.review.note).slice(0, 30)})` : ''}`).join(', ')
      log('반려', `재제작 대기 — 컷 ${rlist}`)
      await leaderLog({ stage: 'making', kind: '반려감지', summary: `메이킹 컷 반려 — 재제작 대기 (${rejected.length}컷)`,
        result: rlist, humanInvolved: true })
    }

    // 제작 완료(mp4 있음)·미반려·g4 미승인인 메이킹 컷 → 승인 게이트
    const madeUnapproved = cuts.filter(c => isMakingType(c) && c.hasVideo && !c.g4 && c.review?.status !== 'rejected')
    const autoApproved = []
    for (const c of madeUnapproved) {
      if (await shouldAutoApprove('making', c)) {
        const r = await api('POST', '/api/mcp/studio-approve-g4', { episodeId: EPISODE_ID, cutIds: [c.no] })
        if (r.ok) {
          autoApproved.push(c.no); log('제작', `CUT ${c.no} 자동 승인(에이전트 리더)`)
          await leaderLog({ stage: 'G4', kind: '자동승인', summary: `CUT ${c.no} (${cutTypeOf(c)}) 자동 승인`,
            rationale: 'shouldAutoApprove 정책 통과 (에이전트 자동승인 스테이지)', humanInvolved: false })
        } else {
          log('제작', `CUT ${c.no} 자동 승인 실패 — ${r.data?.error || r.status}`)
          await leaderLog({ stage: 'G4', kind: '블로커', summary: `CUT ${c.no} 자동 승인 실패`,
            result: String(r.data?.error || r.status), humanInvolved: true })
        }
      }
    }
    const stillWaiting = madeUnapproved.filter(c => !autoApproved.includes(c.no)).map(c => c.no)
    makingWaiting = stillWaiting
    if (stillWaiting.length) log('승인대기', `메이킹 컷 제작됨 — 검수 대기: 컷 ${stillWaiting.join(',')} (메이킹 탭 컷 리뷰)`)
  }

  // ── G3 트리거: G1 승인됐고 오디오가 아직 없는 컷들 (동기 완료라 배치 겹칠 일 없음) ──
  if (stageInRange('g3')) {
    if (isG3Complete(cuts)) {
      log('G3', '이미 완료된 단계 — 스킵')
    } else {
      const g3Candidates = cuts.filter(c => c.g1 && needsG3(c) && !c.hasAudio)
      if (g3Candidates.length) {
        const cutIds = g3Candidates.map(c => c.no)
        didTrigger = true
        log('G3', `TTS 생성 요청 → 컷 ${cutIds.join(',')}`)
        const r = await api('POST', '/api/mcp/studio-run-g3', { episodeId: EPISODE_ID, cutIds })
        if (!r.ok) {
          log('G3', `요청 실패 — ${r.data?.error || r.status}`)
          cycleBlocker = `G3 TTS 실패: ${r.data?.error || r.status}`
          await leaderLog({ stage: 'G3', kind: '블로커', summary: 'G3 TTS 생성 요청 실패',
            result: String(r.data?.error || r.status), humanInvolved: true })
        } else {
          log('G3', `완료 — 생성 ${r.data.generatedCount ?? '?'}건 · 실패 ${r.data.failCount ?? '?'}건 · 스킵 ${r.data.skippedCount ?? '?'}건`)
          await leaderLog({ stage: 'G3', kind: '자동실행', summary: `G3 TTS 자동 생성 — ${cutIds.length}컷`,
            rationale: `g1 승인 + 대사/나레이션 있음 + 오디오 없음: 컷 ${cutIds.join(',')}`,
            result: `생성 ${r.data.generatedCount ?? '?'} · 실패 ${r.data.failCount ?? '?'} · 스킵 ${r.data.skippedCount ?? '?'}`,
            humanInvolved: (r.data.failCount || 0) > 0 })
        }
      }
    }
  }

  // ── G4: 영상 생성은 이제 자동 트리거하지 않음 ──────────────────────
  // Flow/Veo 브라우저 자동화(video-automation.js)는 벤더 UI 변경으로 반복적으로 깨져서
  // 파이프라인 신뢰성을 못 지켰다(2026-09-02 결정). 영상 컷은 사람이 Veo/Flow에서 직접
  // 제작 → 스튜디오 "영상 만들기" 탭 체크리스트에서 mp4 업로드하는 방식으로 전환.
  // 리더는 "어느 컷이 영상 필요한데 아직 없는지" 보고만 한다.
  // (2026-09-25) G2 승인 = 영상 생성 진행 신호. 서여리(YEORI) 컷만 자동 — 클립 제출 → 시작 프레임 SSIM 검증 다운로드 →
  // 음성 검수 → (모든 클립 준비되면) render-cut-clips 로 05_video/cut_NN.mp4. 진행은 raw 클립 존재로 판단(재시작 안전).
  if (stageInRange('g4') && !isStageComplete(cuts, 'g4')) {
    const needVeo = cuts.filter(c => needsGenImage(c) && c.g2 && !c.hasVideo)
    const autoVeo = needVeo.filter(c => (c.cutType || 'YEORI') === 'YEORI' && !flowHuman.has(`g4:${c.no}`))
    const manualVeo = needVeo.filter(c => !autoVeo.includes(c))
    if (manualVeo.length) log('G4', `수동 제작 대기 — 컷 ${manualVeo.map(c => c.no).join(',')} (PIP·사람 확인 대상)`)
    const epNum = episode?.number
    if (G4_AUTO && autoVeo.length && !activeFlow && epNum) {
      const c = autoVeo[0]
      const n = c.segCount || 1
      const clips = Array.from({ length: n }, (_, i) => rawClipPath(epNum, c.no, i + 1))
      const k = clips.findIndex((f, i) => !findClip(epNum, c.no, i + 1)) + 1          // 0 이면 전부 있음(보관본 복구 포함)
      if (k === 0) {
        const r = await api('POST', '/api/render-cut-clips', { epNum, cutNo: c.no, clips: clips.map(file => ({ file })) })
        didTrigger = true
        if (r.ok && IS_REEL) {   // 대사 자막을 발화 시각에 맞춤 — 영상 탭 미리보기·최종본이 같은 타이밍을 쓴다
          const sc = await api('POST', '/api/reel-finalize/sync-captions', { epNum })
          const syn = (sc.data?.results || []).filter(x => x.status === 'synced').map(x => x.cutNo)
          if (syn.length) log('자막', `대사 자막 발화 싱크 — 컷 ${syn.join(',')}`)
        }
        if (r.ok) { log('G4', `컷 ${c.no} 컷 영상 렌더 완료 → G4 승인(사람) 대기`); await leaderLog({ stage: 'G4', kind: '자동실행', summary: `컷 ${c.no} 클립 ${n}개 → 컷 영상 렌더`, result: 'G4 승인 대기', humanInvolved: true }) }
        else { cycleBlocker = `컷 ${c.no} 렌더 실패: ${r.data?.error || r.status}`; log('G4', `❌ ${cycleBlocker}`) }
      } else {
        const durationSec = omniSec(c.segments ? c.segments[k - 1] : c.duration)
        const used = readVideoUsage().credits
        if (used + estCredits(durationSec) > G4_BUDGET) {
          cycleBlocker = `오늘 Flow 영상 크레딧 한도(${G4_BUDGET}) 도달 — 사용 ${used}`
          log('G4', `⏸ ${cycleBlocker}`)
        } else if (!(await flowReady())) {
          cycleBlocker = 'Flow 전용 Chrome(9222)·Flow 프로젝트 탭이 준비되지 않음'
          log('G4', `⏸ ${cycleBlocker}`)
        } else {
          const body = { epNum, cutNo: c.no, clipNo: k, durationSec, maxCredits: G4_MAX_CREDITS_PER_CLIP, dryRun: FLOW_DRY, ...(k > 1 ? { prevClipPath: clips[k - 2] } : {}) }
          const r = await api('POST', '/api/flow/submit', body)
          if (r.ok && r.data?.jobId) {
            activeFlow = { kind: 'g4', jobId: r.data.jobId, cutNo: c.no, clipNo: k }; didTrigger = true
            log('G4', `영상 자동 제출(Flow Omni 720p ${durationSec}초) — 컷 ${c.no} 클립 ${k}/${n} · 오늘 사용 ${used}/${G4_BUDGET}`)
          } else log('G4', `영상 제출 요청 실패 — ${r.data?.error || r.status}`)
        }
      }
    } else if (needVeo.length && !G4_AUTO) {
      log('G4', `영상 수동 제작 대기 — 컷 ${needVeo.map(c => c.no).join(',')} (--g4=off)`)
    }
  }

  // ── 승인 대기 알림 (실행은 안 함, 사람이 스튜디오 UI에서 눌러야 함) ──
  const waitingG1 = cuts.length && !cuts.some(c => c.g1) ? 'G1 승인된 컷이 아직 없음' : null
  const waitingG2 = cuts.filter(c => c.hasImage && !c.g2).map(c => c.no)
  const waitingG3 = cuts.filter(c => c.hasAudio && !c.g3).map(c => c.no)
  // 메이킹 유형 컷(GRAPHIC/CAPCUT/BROLL)은 g4 승인 버튼이 없다 — mp4 있으면 완료로 취급하므로 제외
  const waitingG4 = cuts.filter(c => c.hasVideo && !c.g4 && !isMakingType(c)).map(c => c.no)
  if (waitingG1) log('승인대기', waitingG1)
  if (waitingG2.length) log('승인대기', `G2(이미지 선택) — 컷 ${waitingG2.join(',')}`)
  if (waitingG3.length) log('승인대기', `G3(음성) — 컷 ${waitingG3.join(',')}`)
  if (waitingG4.length) log('승인대기', `G4(영상) — 컷 ${waitingG4.join(',')}`)

  // ── 위임된 승인(G3): Notion "에이전트 자동승인"에 G3 가 있고 검수(길이·무음·대본 최신성)를 통과한 컷만 ──
  // G1·G2·G5 와 서여리(YEORI) 컷 G4 는 정책상 사람 전용이라 위임해도 자동 승인되지 않는다(docs/gate-approval-policy.md).
  if (AUTO_APPROVE.includes('G3') && stageInRange('g3')) await autoApproveByPolicy('G3', '/api/mcp/studio-approve-g3')

  // ── G5 트리거: 모든 컷이 G4 승인 완료 상태면 한 번만 실행 ──
  // 완료 여부는 이제 gpoints 기준(isStageComplete)으로 판단 — g5Triggered 메모리 플래그만
  // 믿으면 프로세스를 재시작할 때마다 이미 끝난 SRT/concat을 또 돌리는 문제가 있었다
  // (2026-08-17 실측 확인: 완료된 SF_E01을 재실행하니 G5가 불필요하게 다시 돎).
  if (stageInRange('g5')) {
    if (isStageComplete(cuts, 'g5')) {
      log('G5', '이미 완료된 단계 — 스킵')
    } else {
      const allG4Approved = cuts.length > 0 && cuts.every(c => cutStageDone(c, 'g4'))
      if (allG4Approved && !g5Triggered) {
        g5Triggered = true; didTrigger = true
        log('G5', '전체 컷 G4 승인 완료 — 편집메타/SRT/합성 실행')
        const r = await api('POST', '/api/mcp/studio-run-g5', { episodeId: EPISODE_ID })
        if (!r.ok) {
          log('G5', `실패 — ${r.data?.error || r.status}`); g5Triggered = false
          cycleBlocker = `G5 합성 실패: ${r.data?.error || r.status}`
          await leaderLog({ stage: 'G5', kind: '블로커', summary: 'G5 합성 실행 실패',
            result: String(r.data?.error || r.status), humanInvolved: true })
        } else {
          log('G5', `완료 — ${r.data.concat?.outputPath || '(출력 경로 확인 필요)'}`)
          await leaderLog({ stage: 'G5', kind: '자동실행', summary: 'G5 편집메타/SRT/합성 자동 실행',
            rationale: '전체 컷 G4 승인 완료', result: r.data.concat?.outputPath || '완료', humanInvolved: false })
        }
      }
    }
  }

  // ── 목표 단계 완료 감지 — summary[TO_STAGE]가 전체 컷 수와 같아지면 더 할 일이 없음.
  // G5를 방금 이 사이클에서 트리거했더라도 summary는 사이클 시작 시점에 조회한 값이라
  // (gpoints 기록은 위에서 막 끝났으니) 다음 사이클에 반영돼 감지된다 — 최대 한 사이클
  // (interval초) 늦게 멈추는 정도라 실사용에 문제 없음.
  // TO_STAGE가 g3면 위의 스킵 판정(isG3Complete)과 동일하게 대사/나레이션 있는 컷만
  // 기준으로 봐야 함 — 안 그러면 B-roll 컷 있는 에피소드는 --to=g3로 걸어도 summary.g3가
  // 절대 전체 컷 수와 같아질 수 없어서 자동 종료가 영원히 안 됨(2026-08-17 발견).
  // ── P2: 에피소드 파이프라인 DB 행 동기화 ──────────────────────────
  const gate = deriveGate(cuts, summary)
  const waiting = [
    waitingG1 && 'G1',
    waitingG2.length && `G2 이미지(${waitingG2.join(',')})`,
    waitingG3.length && `G3 음성(${waitingG3.join(',')})`,
    waitingG4.length && `G4 영상(${waitingG4.join(',')})`,
    makingWaiting.length && `메이킹 검수(${makingWaiting.join(',')})`,
  ].filter(Boolean)
  const needImgManual = cuts.filter(c => c.g1 && needsGenImage(c) && !c.hasImage && !c.hasVideo).map(c => c.no)
  const needVeoManual = cuts.filter(c => needsGenImage(c) && c.g2 && !c.hasVideo).map(c => c.no)

  let agentState, nextAction
  if (cycleBlocker) { agentState = '블로커'; nextAction = cycleBlocker }
  else if (gate === '완료') { agentState = '완료'; nextAction = '완료 — 다음 단계 없음' }
  else if (waiting.length) { agentState = '사람 승인 대기'; nextAction = `승인 대기: ${waiting.join(' · ')}` }
  else if (needImgManual.length) { agentState = '사람 승인 대기'; nextAction = `CUT ${needImgManual.join(',')} 이미지 외부 생성 → 스튜디오 업로드 (genline)` }
  else if (needVeoManual.length) { agentState = '사람 승인 대기'; nextAction = `CUT ${needVeoManual.join(',')} 영상 외부 제작 → 영상 탭 업로드` }
  else if (didTrigger) { agentState = '돌아가는중'; nextAction = `${gate} 진행 중 — 완료 대기` }
  else { agentState = '유휴'; nextAction = `${gate} — 자동 트리거 조건 대기` }

  await leaderEpisodeSync({
    episodeCode: episode?.code || EP_LABEL, episodeTitle: episode?.title,
    currentGate: gate, agentState, nextAction, blocker: cycleBlocker,
    cutCount: cuts.length,
    isLong: /^LF/i.test(String(episode?.code || '')) ? true : /^SF/i.test(String(episode?.code || '')) ? false : undefined,
  })

  if (TO_STAGE === 'g3') return isG3Complete(cuts)
  return cuts.length > 0 && summary[TO_STAGE] === cuts.length
}

// ── Flow(G2 이미지 · G4 영상) 작업 추적 — 한 번에 하나(서버도 409 로 막음) ──────────────
let activeFlow = null                  // { kind:'g2'|'g4', jobId, cutNo, clipNo, cutNos }
const flowFailures = {}                // 'g2:3' / 'g4:5:1' → 실패 횟수(2번 실패하면 사람에게 넘김)
const flowHuman = new Set()            // 사람 확인으로 넘긴 컷('g2:3', 'g4:5')
const VIDEO_USAGE = path.join(mp.DOWNLOADS, 'state', 'flow-video-usage.json')
const today = () => new Date().toLocaleDateString('sv-SE')
function readVideoUsage() { try { const u = JSON.parse(fs.readFileSync(VIDEO_USAGE, 'utf-8')); return u.date === today() ? u : { date: today(), credits: 0, clips: [] } } catch { return { date: today(), credits: 0, clips: [] } } }
function addVideoUsage(credits, label) { const u = readVideoUsage(); u.credits += credits || 0; u.clips.push({ at: new Date().toISOString(), label, credits }); fs.mkdirSync(path.dirname(VIDEO_USAGE), { recursive: true }); fs.writeFileSync(VIDEO_USAGE, JSON.stringify(u, null, 2), 'utf-8') }
// Omni 길이 단위(4/6/8/10초) — 대본 DU/세그 길이를 올림해 맞춘다
const omniSec = (d) => [4, 6, 8, 10].find(x => x >= (Number(d) || 8)) || 10
const estCredits = (sec) => Math.ceil(sec * 1.5)          // 720p 실측: 8초 12크레딧
const rawClipPath = (epNum, no, k) => path.join(mp.makingDir(epNum), 'raw', `cut_${String(no).padStart(2, '0')}_clip_${k}.mp4`)
// raw 에 없으면 render-cut-clips 가 옮겨 둔 raw/_composed/ 의 가장 최근 보관본을 되살린다(크레딧 들인 원본 재생성 방지)
function findClip(epNum, no, k) {
  const f = rawClipPath(epNum, no, k)
  if (fs.existsSync(f)) return f
  const keep = path.join(path.dirname(f), "_composed")
  const base = path.basename(f, ".mp4")
  const hit = fs.existsSync(keep) ? fs.readdirSync(keep).filter(n => n.startsWith(base + ".") && n.endsWith(".mp4")).sort().pop() : null
  if (!hit) return null
  fs.copyFileSync(path.join(keep, hit), f)
  return f
}
const flowLabel = (j) => j.kind === 'g2' ? `G2 이미지 컷 ${j.cutNos.join(',')}` : `G4 컷 ${j.cutNo} 클립 ${j.clipNo}`

// 진행 중인 Flow 작업을 확인하고, 끝났으면 후처리. 반환: 아직 진행 중이면 true
async function pollActiveFlow() {
  if (!activeFlow) return false
  const r = await api('GET', `/api/flow/job/${activeFlow.jobId}`)
  const st = r.data?.state
  if (!r.ok || st === 'running' || !st) return true
  const job = activeFlow; activeFlow = null
  const tag = flowLabel(job)
  if (st === 'done') {
    if (job.kind === 'g4') {
      if (r.data.result?.dryRun) { log("G4", `🧪 ${tag} 드라이런 통과 — 예상 ${r.data.result?.gate?.credits}크레딧(전송 안 함)`); return false }
      const credits = r.data.result?.gate?.credits || 0
      addVideoUsage(credits, `${EP_LABEL} 컷${job.cutNo} 클립${job.clipNo}`)
      const qa = r.data.result?.voiceQa
      log('G4', `✅ ${tag} 생성·다운로드 완료 (${credits}크레딧${qa ? `, 음성검수 ${qa.verdict}` : ''})`)
      if (qa && qa.verdict === 'fail') {
        flowHuman.add(`g4:${job.cutNo}`)
        await leaderLog({ stage: 'G4', kind: '블로커', summary: `컷 ${job.cutNo} 음성 검수 실패 — 사람 확인`, result: (qa.flags || []).slice(0, 4).join(' / '), humanInvolved: true })
      } else {
        await leaderLog({ stage: 'G4', kind: '자동실행', summary: `${tag} Flow 자동 생성`, result: `${credits}크레딧 · 음성검수 ${qa?.verdict || '-'}`, humanInvolved: false })
      }
    } else {
      const n = (r.data.result?.cuts || []).reduce((a, c) => a + (c.files?.length || 0), 0)
      log('G2', `✅ ${tag} 이미지 ${n}장 생성 — G2 선택(사람) 대기`)
      await leaderLog({ stage: 'G2', kind: '자동실행', summary: `${tag} Flow 자동 생성 ${n}장`, result: 'G2 이미지 선택 대기', humanInvolved: true })
    }
  } else {
    const key = job.kind === 'g2' ? `g2:${job.cutNos.join(',')}` : `g4:${job.cutNo}:${job.clipNo}`
    flowFailures[key] = (flowFailures[key] || 0) + 1
    const err = r.data?.error || st
    log(job.kind.toUpperCase(), `❌ ${tag} 실패(${flowFailures[key]}회) — ${err}`)
    if (flowFailures[key] >= 2) {
      if (job.kind === 'g2') job.cutNos.forEach(n => flowHuman.add(`g2:${n}`)); else flowHuman.add(`g4:${job.cutNo}`)
      await leaderLog({ stage: job.kind.toUpperCase(), kind: '블로커', summary: `${tag} 2회 실패 — 사람 확인`, result: String(err).slice(0, 300), humanInvolved: true })
    }
  }
  return false
}
async function flowReady() {
  const r = await api('GET', '/api/flow/ready')
  return !!(r.data?.ok && r.data?.flowTab)
}

async function main() {
  log('시작', `episodeId=${EPISODE_ID} · 구간=${FROM_STAGE}~${TO_STAGE} · interval=${INTERVAL_MS / 1000}s${RUN_ONCE ? ' · 1회 실행' : ''}`)
  const firstDone = await checkAndAdvance()
  if (RUN_ONCE) { log('종료', '1회 실행 완료'); return }
  if (firstDone) {
    log('완료', `목표 단계(${TO_STAGE}) 전체 컷 완료 감지 — 자동 종료`)
    return
  }
  const timer = setInterval(async () => {
    try {
      touchLock()
      const done = await checkAndAdvance()
      if (done) {
        log('완료', `목표 단계(${TO_STAGE}) 전체 컷 완료 감지 — 자동 종료`)
        clearInterval(timer)
        process.exit(0)
      }
    } catch (e) {
      log('오류', e.message)
    }
  }, INTERVAL_MS)
}

main()
