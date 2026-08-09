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
 *
 * 사용법:
 *   node scripts/pipeline-leader.js --episodeId=ep_1784551030896
 *   node scripts/pipeline-leader.js --episodeId=... --interval=20   (폴링 간격, 초. 기본 30)
 *   node scripts/pipeline-leader.js --episodeId=... --once          (한 사이클만 실행 후 종료)
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
if (!args.episodeId) {
  console.error('[pipeline-leader] --episodeId=<episodeId> 필요 (studio_set_episode로 미리 활성화해둘 것)')
  process.exit(1)
}
const EPISODE_ID = args.episodeId
const INTERVAL_MS = (parseInt(args.interval, 10) || 30) * 1000
const RUN_ONCE = !!args.once

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

// 이 프로세스가 살아있는 동안 "이미 요청 보냄" 상태를 기억해서 같은 컷에 중복으로
// run-g2/g4를 쏘지 않는다(Flow/Veo 브라우저 자동화는 세션 1개라 동시 요청 시 충돌
// 위험 — 프로세스 재시작하면 초기화됨. 재시작 직후 실제로 아직 진행 중인 생성이
// 있었다면 중복 트리거될 수 있으니, 재시작 전엔 터미널 로그로 진행 상황을 확인할 것).
const inFlight = new Set() // `${stage}:${cutNo}`
let g5Triggered = false

async function checkAndAdvance() {
  const statusRes = await api('GET', `/api/mcp/studio-status?episodeId=${encodeURIComponent(EPISODE_ID)}`)
  if (!statusRes.ok) {
    log('상태조회', `실패 — ${statusRes.data?.error || statusRes.status}`)
    return
  }
  const { episode, cuts, summary } = statusRes.data
  log('상태', `${episode?.title || EPISODE_ID} · G1 ${summary.g1} · G2 ${summary.g2} · G3 ${summary.g3} · G4 ${summary.g4} · G5 ${summary.g5} (전체 ${cuts.length}컷)`)

  // ── 완료 감지: 이전에 요청 보낸 컷의 산출물이 도착했으면 in-flight 해제 ──
  cuts.filter(c => c.hasImage && inFlight.has(`g2:${c.no}`)).forEach(c => inFlight.delete(`g2:${c.no}`))
  cuts.filter(c => c.hasVideo && inFlight.has(`g4:${c.no}`)).forEach(c => inFlight.delete(`g4:${c.no}`))

  // ── G2 트리거: G1 승인됐고 이미지가 아직 없는 컷들을 한 번에 요청 ──
  const g2Candidates = cuts.filter(c => c.g1 && !c.hasImage && !inFlight.has(`g2:${c.no}`))
  if (g2Candidates.length) {
    const cutIds = g2Candidates.map(c => c.no)
    cutIds.forEach(no => inFlight.add(`g2:${no}`))
    log('G2', `이미지 생성 요청 → 컷 ${cutIds.join(',')}`)
    const r = await api('POST', '/api/mcp/studio-run-g2', { episodeId: EPISODE_ID, cutIds })
    if (!r.ok) { log('G2', `요청 실패 — ${r.data?.error || r.status}`); cutIds.forEach(no => inFlight.delete(`g2:${no}`)) }
  }

  // ── G3 트리거: G1 승인됐고 오디오가 아직 없는 컷들 (G2와 독립적으로 병렬 진행, 동기 완료) ──
  const g3Candidates = cuts.filter(c => c.g1 && !c.hasAudio && !inFlight.has(`g3:${c.no}`))
  if (g3Candidates.length) {
    const cutIds = g3Candidates.map(c => c.no)
    cutIds.forEach(no => inFlight.add(`g3:${no}`))
    log('G3', `TTS 생성 요청 → 컷 ${cutIds.join(',')}`)
    const r = await api('POST', '/api/mcp/studio-run-g3', { episodeId: EPISODE_ID, cutIds })
    cutIds.forEach(no => inFlight.delete(`g3:${no}`)) // 동기 완료라 응답 오면 바로 해제
    if (!r.ok) log('G3', `요청 실패 — ${r.data?.error || r.status}`)
    else log('G3', `완료 — 생성 ${r.data.generatedCount ?? '?'}건 · 실패 ${r.data.failCount ?? '?'}건 · 스킵 ${r.data.skippedCount ?? '?'}건`)
  }

  // ── G4 트리거: G2 "승인"된(사람이 이미지 선택 완료) 컷 중 영상이 아직 없는 것들 ──
  const g4Candidates = cuts.filter(c => c.g2 && !c.hasVideo && !inFlight.has(`g4:${c.no}`))
  if (g4Candidates.length) {
    const cutIds = g4Candidates.map(c => c.no)
    cutIds.forEach(no => inFlight.add(`g4:${no}`))
    log('G4', `영상 생성 요청 → 컷 ${cutIds.join(',')}`)
    const r = await api('POST', '/api/mcp/studio-run-g4', { episodeId: EPISODE_ID, cutIds })
    if (!r.ok) { log('G4', `요청 실패 — ${r.data?.error || r.status}`); cutIds.forEach(no => inFlight.delete(`g4:${no}`)) }
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
  const allG4Approved = cuts.length > 0 && cuts.every(c => c.g4)
  if (allG4Approved && !g5Triggered) {
    g5Triggered = true
    log('G5', '전체 컷 G4 승인 완료 — 편집메타/SRT/합성 실행')
    const r = await api('POST', '/api/mcp/studio-run-g5', { episodeId: EPISODE_ID })
    if (!r.ok) { log('G5', `실패 — ${r.data?.error || r.status}`); g5Triggered = false }
    else log('G5', `완료 — ${r.data.concat?.outputPath || '(출력 경로 확인 필요)'}`)
  }
}

async function main() {
  log('시작', `episodeId=${EPISODE_ID} · interval=${INTERVAL_MS / 1000}s${RUN_ONCE ? ' · 1회 실행' : ''}`)
  await checkAndAdvance()
  if (RUN_ONCE) { log('종료', '1회 실행 완료'); return }
  setInterval(() => { checkAndAdvance().catch(e => log('오류', e.message)) }, INTERVAL_MS)
}

main()
