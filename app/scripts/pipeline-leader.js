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
if (!args.episode) {
  console.error('[pipeline-leader] --episode=<episodeId> 필요 (studio_set_episode로 미리 활성화해둘 것)')
  process.exit(1)
}
const EPISODE_ID = args.episode
const INTERVAL_MS = (parseInt(args.interval, 10) || 30) * 1000
const RUN_ONCE = !!args.once

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

// 해당 단계가 전체 컷에 대해 이미 gpoints 기준으로 완료됐는지 — /api/mcp/studio-status가
// 내려주는 cuts[].g1~g5는 서버가 gpoints.json을 그대로 병합해 넣어주는 값이라, 이 스크립트
// 안에서 gpoints.json을 따로 읽을 필요 없이 이 필드만 보면 된다. 프로세스를 재시작하면
// g5Triggered 같은 메모리 플래그는 초기화되지만 이 값은 항상 서버의 실제 기록을 반영한다.
function isStageComplete(cuts, stage) {
  return cuts.length > 0 && cuts.every(c => c[stage])
}

// G3(TTS)만 예외 — 대사/나레이션이 없는 컷(B-roll 등)은 애초에 TTS 대상이 아니라서
// g3가 영원히 false로 남는다. isStageComplete(cuts,'g3')로는 그런 컷이 하나라도 있으면
// 절대 완료 판정이 안 나서 매 사이클 재시도하던 문제(2026-08-17 실측 발견) — "대사/
// 나레이션이 있는 컷"만 걸러서 그 컷들만 기준으로 완료 여부를 본다. 대상 컷이 아예
// 없는 에피소드(전부 B-roll 등)도 완료로 취급.
function isG3Complete(cuts) {
  const g3Targets = cuts.filter(c => c.dialogue?.trim() || c.narration?.trim())
  return g3Targets.length === 0 || g3Targets.every(c => c.g3 === true)
}

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

// ── 승인 정책 — 지금은 항상 사람(스튜디오 UI) 대기, 자동 승인 안 함. 나중에
// "에이전트 리더"가 실제 산출물(이미지/영상)을 평가해서 자동 승인하게 하려면
// 이 함수의 반환값만 실제 판단 로직으로 바꾸면 된다. 지금은 호출부가 없고
// 정책 자리만 표시해두는 용도.
// eslint-disable-next-line no-unused-vars
async function shouldAutoApprove(stage, cutStatus) {
  return false
}

// G2/G4는 Flow/Veo 브라우저 자동화라 Chrome 세션(CDP 디버깅 포트)을 하나만 공유한다.
// 컷별로 승인 시점이 달라 매 폴링 사이클마다 "방금 승인된 컷"만 골라 개별 호출하면,
// 이전 컷 처리가 아직 끝나지 않은 상태에서 새 run-g2/g4가 겹쳐서 같은 브라우저에
// 중복 탭을 열고 서로 조작을 방해하는 사고가 실제로 발생했다(중복 탭 5개 + Google이
// 봇 행동으로 감지해 reCAPTCHA를 띄우는 사태까지 이어짐, 2026-08-09 실측 테스트에서
// 확인). 그래서 G2/G4는 "에피소드 단위" 1개 요청만 동시에 허용하고, 그 사이 새로
// 승인된 컷은 지금 진행 중인 요청이 끝난 뒤 다음 사이클에서 한꺼번에 처리한다
// (studio-run-g2/g4 자체가 여러 cutIds를 한 번에 배치 처리하도록 이미 설계되어 있음).
let g2InFlight = false
let g5Triggered = false
let g2StartedAt = 0
// g4InFlight/g4StartedAt 제거 — G4(영상)는 더 이상 자동 트리거 안 함(2026-09-02, 수동 전환)

// G2/G4 락 해제는 "요청 보낸 컷 전부 산출물이 생겼는지"로 판단하는데, Flow/Veo가
// 정책 거부 등으로 일부 컷 생성에 실패하면 그 컷은 영원히 hasImage/hasVideo=false로
// 남아 락이 절대 안 풀리는 버그가 있었다(실측: G4가 컷 1에서 "Google 정책 위반" 실패 후
// pipeline-leader가 에러 로그 한 줄 없이 무한 대기 상태로 멈춤, 2026-08-10). 완료 감지가
// 실패 케이스를 못 잡는 근본 원인은 안 고치더라도, 타임아웃으로 락을 강제 해제하고
// 눈에 띄게 경고를 남겨 "조용히 멈춤" 대신 "다음 사이클에 다시 시도 + 사람이 알아챌 수
// 있게" 만든다.
const G2_TIMEOUT_MS = 10 * 60 * 1000

// 반환값: 목표 단계(TO_STAGE)까지 전체 컷이 완료됐는지(true/false) — main()이 이걸로
// 더 이상 폴링할 필요가 없다고 판단해서 스스로 종료한다.
async function checkAndAdvance() {
  const statusRes = await api('GET', `/api/mcp/studio-status?episodeId=${encodeURIComponent(EPISODE_ID)}`)
  if (!statusRes.ok) {
    log('상태조회', `실패 — ${statusRes.data?.error || statusRes.status}`)
    return false
  }
  const { episode, cuts, summary } = statusRes.data
  log('상태', `${episode?.title || EPISODE_ID} · G1 ${summary.g1} · G2 ${summary.g2} · G3 ${summary.g3} · G4 ${summary.g4} · G5 ${summary.g5} (전체 ${cuts.length}컷)`)

  // ── 완료 감지: 이전에 요청 보낸 배치가 전부 산출물을 냈으면 에피소드 단위 락 해제 ──
  if (g2InFlight && cuts.filter(c => c.g1).every(c => c.hasImage)) g2InFlight = false

  // ── 타임아웃 안전장치: 일부 컷이 생성 실패해서 완료 감지가 영원히 안 되는 경우 대비 ──
  if (g2InFlight && Date.now() - g2StartedAt > G2_TIMEOUT_MS) {
    log('G2', `⚠️ ${G2_TIMEOUT_MS / 60000}분 경과했는데도 미완료 컷 있음 — 일부 실패했을 가능성, 락 강제 해제 후 다음 사이클에 재시도`)
    g2InFlight = false
  }

  // ── G1: 트리거할 게 없는 단계(사람이 스튜디오 UI에서 승인) — 완료 여부만 로그로 확인 ──
  if (stageInRange('g1') && isStageComplete(cuts, 'g1')) {
    log('G1', '이미 완료된 단계 — 스킵')
  }

  // ── G2 트리거: G1 승인됐고 이미지가 아직 없는 컷들을 한 번에 요청(에피소드당 동시 1건) ──
  if (stageInRange('g2')) {
    if (isStageComplete(cuts, 'g2')) {
      log('G2', '이미 완료된 단계 — 스킵')
    } else if (!g2InFlight) {
      const g2Candidates = cuts.filter(c => c.g1 && !c.hasImage)
      if (g2Candidates.length) {
        const cutIds = g2Candidates.map(c => c.no)
        g2InFlight = true
        g2StartedAt = Date.now()
        log('G2', `이미지 생성 요청 → 컷 ${cutIds.join(',')}`)
        const r = await api('POST', '/api/mcp/studio-run-g2', { episodeId: EPISODE_ID, cutIds })
        if (!r.ok) { log('G2', `요청 실패 — ${r.data?.error || r.status}`); g2InFlight = false }
      }
    }
  }

  // ── G3 트리거: G1 승인됐고 오디오가 아직 없는 컷들 (동기 완료라 배치 겹칠 일 없음) ──
  if (stageInRange('g3')) {
    if (isG3Complete(cuts)) {
      log('G3', '이미 완료된 단계 — 스킵')
    } else {
      const g3Candidates = cuts.filter(c => c.g1 && !c.hasAudio)
      if (g3Candidates.length) {
        const cutIds = g3Candidates.map(c => c.no)
        log('G3', `TTS 생성 요청 → 컷 ${cutIds.join(',')}`)
        const r = await api('POST', '/api/mcp/studio-run-g3', { episodeId: EPISODE_ID, cutIds })
        if (!r.ok) log('G3', `요청 실패 — ${r.data?.error || r.status}`)
        else log('G3', `완료 — 생성 ${r.data.generatedCount ?? '?'}건 · 실패 ${r.data.failCount ?? '?'}건 · 스킵 ${r.data.skippedCount ?? '?'}건`)
      }
    }
  }

  // ── G4: 영상 생성은 이제 자동 트리거하지 않음 ──────────────────────
  // Flow/Veo 브라우저 자동화(video-automation.js)는 벤더 UI 변경으로 반복적으로 깨져서
  // 파이프라인 신뢰성을 못 지켰다(2026-09-02 결정). 영상 컷은 사람이 Veo/Flow에서 직접
  // 제작 → 스튜디오 "영상 만들기" 탭 체크리스트에서 mp4 업로드하는 방식으로 전환.
  // 리더는 "어느 컷이 영상 필요한데 아직 없는지" 보고만 한다.
  if (stageInRange('g4') && !isStageComplete(cuts, 'g4')) {
    const needVideo = cuts.filter(c => c.g2 && !c.hasVideo)
    if (needVideo.length) {
      log('G4', `수동 제작 대기 — 컷 ${needVideo.map(c => c.no).join(',')} (Veo/Flow 직접 제작 후 영상 탭에서 업로드)`)
    }
  }

  // ── 승인 대기 알림 (실행은 안 함, 사람이 스튜디오 UI에서 눌러야 함) ──
  const waitingG1 = cuts.length && !cuts.some(c => c.g1) ? 'G1 승인된 컷이 아직 없음' : null
  const waitingG2 = cuts.filter(c => c.hasImage && !c.g2).map(c => c.no)
  const waitingG3 = cuts.filter(c => c.hasAudio && !c.g3).map(c => c.no)
  const waitingG4 = cuts.filter(c => c.hasVideo && !c.g4).map(c => c.no)
  if (waitingG1) log('승인대기', waitingG1)
  if (waitingG2.length) log('승인대기', `G2(이미지 선택) — 컷 ${waitingG2.join(',')}`)
  if (waitingG3.length) log('승인대기', `G3(음성) — 컷 ${waitingG3.join(',')}`)
  if (waitingG4.length) log('승인대기', `G4(영상) — 컷 ${waitingG4.join(',')}`)

  // ── G5 트리거: 모든 컷이 G4 승인 완료 상태면 한 번만 실행 ──
  // 완료 여부는 이제 gpoints 기준(isStageComplete)으로 판단 — g5Triggered 메모리 플래그만
  // 믿으면 프로세스를 재시작할 때마다 이미 끝난 SRT/concat을 또 돌리는 문제가 있었다
  // (2026-08-17 실측 확인: 완료된 SF_E01을 재실행하니 G5가 불필요하게 다시 돎).
  if (stageInRange('g5')) {
    if (isStageComplete(cuts, 'g5')) {
      log('G5', '이미 완료된 단계 — 스킵')
    } else {
      const allG4Approved = cuts.length > 0 && cuts.every(c => c.g4)
      if (allG4Approved && !g5Triggered) {
        g5Triggered = true
        log('G5', '전체 컷 G4 승인 완료 — 편집메타/SRT/합성 실행')
        const r = await api('POST', '/api/mcp/studio-run-g5', { episodeId: EPISODE_ID })
        if (!r.ok) { log('G5', `실패 — ${r.data?.error || r.status}`); g5Triggered = false }
        else log('G5', `완료 — ${r.data.concat?.outputPath || '(출력 경로 확인 필요)'}`)
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
  if (TO_STAGE === 'g3') return isG3Complete(cuts)
  return cuts.length > 0 && summary[TO_STAGE] === cuts.length
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
