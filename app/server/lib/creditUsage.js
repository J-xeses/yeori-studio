// G4(영상) 자동화가 오늘 실제로 소모한 크레딧을 서버가 자체적으로 세는 작은 파일.
//
// studio-state.json의 creditTracker.main.flow.remaining은 "사람이 마지막으로 확인/입력한
// 값"일 뿐이고, G4 실행 후에도 자동으로 안 줄어든다. 그렇다고 매 폴링 사이클마다
// /api/check-tool-credits로 실제 브라우저를 확인하는 건 느리고 사람이 쓰는 중인 Chrome을
// 건드릴 위험이 있다 — 그래서 서버가 G4를 실제로 보낼 때마다 예상 소모량만큼 여기에
// 직접 기록해두고, "사람이 마지막으로 확인한 값 - 오늘 자동화가 쓴 만큼"으로 남은 크레딧을
// 추정한다. 클라이언트(브라우저 탭)가 studio-state.json을 통째로 덮어써도(3차 병합 없음,
// gpoints.json이 예전에 겪은 것과 같은 종류의 경쟁 상태) 이 파일은 별도라 안 건드려짐.
//
// 완전한 정합(사람이 "자동 확인" 누르면 이 카운터도 즉시 리셋)은 아직 안 함 — 날짜가
// 바뀌면 자동 초기화되는 것까지만 이번 라운드 범위. (2026-08-16)

import fs from 'fs'
import path from 'path'
import { MEDIA_ROOT } from './mediaPaths.js'

const USAGE_PATH = path.join(MEDIA_ROOT, 'downloads', 'credit-usage-today.json')

function todayKey() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD, 로컬 자정 기준은 아니지만 이 용도엔 충분
}

function loadUsage() {
  if (!fs.existsSync(USAGE_PATH)) return { date: todayKey(), main: { flow: { usedCount: 0 } } }
  try {
    const raw = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf-8'))
    if (raw.date !== todayKey()) return { date: todayKey(), main: { flow: { usedCount: 0 } } }
    return raw
  } catch {
    return { date: todayKey(), main: { flow: { usedCount: 0 } } }
  }
}

function saveUsage(usage) {
  fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true })
  fs.writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2), 'utf-8')
}

// 오늘 main/flow로 이미 소모한 컷 수
export function getUsedCount(account = 'main', tool = 'flow') {
  const usage = loadUsage()
  return usage[account]?.[tool]?.usedCount || 0
}

// 실제로 컷 n개만큼 요청을 보낸 뒤 호출 — 사용량 누적
export function recordUsage(count, account = 'main', tool = 'flow') {
  const usage = loadUsage()
  if (!usage[account]) usage[account] = {}
  if (!usage[account][tool]) usage[account][tool] = { usedCount: 0 }
  usage[account][tool].usedCount += count
  saveUsage(usage)
  return usage[account][tool].usedCount
}
