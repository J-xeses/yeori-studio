// 마스터 허브 "🔄 자동 갱신 — 현재 상태" 블록을 코드로 갱신한다(2026-09-21). ★ AI(LLM) 호출 없음 — 토큰 소모 0 ★
//
// 데이터 원천(전부 로컬 파일): studio-state.json(에피소드·컷·영상 클립·크레딧), downloads/state/gpoints.json(G 진행),
// paid-usage.json(유료 영상 API 장부), STATUS.md(최신 절 날짜). 결과를 허브 페이지의 callout 블록 1개에 덮어쓴다.
//
// 호출 지점(전부 기존 훅 재사용, 새 스케줄러 없음):
//   1) statusMirror.syncLatestStatusToNotion() 맨 앞 — update_status_md(MCP 실시간) 와 git-auto-sync 매 사이클(mirror-status-notion.js) 둘 다 지나감
//   2) scripts/hub-refresh.js — 수동 실행/규칙 검토일 기록(--mark-reviewed)
// 내용(타임스탬프 제외)이 직전과 같으면 Notion 에 쓰지 않는다(쓰기 최소화).
//
// 경고 자동 표시: STATUS.md 최신 절이 3일 이상 묵었을 때, 허브 "확정 규칙" 검토가 14일 이상 묵었을 때.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { getNotionToken, latestSection, STATUS_PATH } from './statusMirror.js'
import { summarizeMonth } from './paidUsage.js'

const CODE_ROOT = 'C:\\yeori-studio\\app'
const DOWNLOADS = 'C:\\yeori-studio\\downloads'
const STATE_FILE = path.join(DOWNLOADS, 'state', '.hub-snapshot.json')   // { blockId, lastHash, rulesReviewedAt }
const STATUS_STALE_DAYS = 3
const RULES_STALE_DAYS = 14

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return fb } }
export const readSnapState = () => readJson(STATE_FILE, {})
const writeSnapState = (patch) => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readSnapState(), ...patch }, null, 2), 'utf-8')
}
export function markRulesReviewed(dateStr = kstDate()) { writeSnapState({ rulesReviewedAt: dateStr }); return dateStr }

const kst = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(d).replace('T', ' ')
function kstDate(d = new Date()) { return kst(d).slice(0, 10) }
const daysBetween = (a, b) => Math.floor((Date.parse(b + 'T00:00:00+09:00') - Date.parse(a + 'T00:00:00+09:00')) / 86400000)

// 승인 게이트 현황 한 줄 — scripts/gate-eval.js(결정론적 검수)를 자식 프로세스로 실행(ffmpeg 를 쓰므로 서버를 막지 않게).
// 결과는 디스크 캐시(.gate-cache.json)를 써서 파일이 안 바뀌면 거의 즉시 끝난다. 실패하면 null(줄 생략).
export function approvalLine() {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(process.execPath, [path.join(CODE_ROOT, 'scripts', 'gate-eval.js'), 'all', '--json'], { cwd: CODE_ROOT, windowsHide: true })
    const timer = setTimeout(() => { try { child.kill() } catch { /* noop */ } resolve(null) }, 120000)
    child.stdout.on('data', d => { out += d })
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve(null)
      try {
        const res = JSON.parse(out), by = (g) => res.find(r => r.gate === g)?.tally || {}
        const wait = (g) => (by(g).auto_ok || 0) + (by(g).recommend || 0)
        const blocked = (by('G3').blocked || 0) + (by('G4').blocked || 0)
        const notReady = by('G4').not_ready || 0
        resolve(`승인 현황(검수 기준): G4 승인 대기 ${wait('G4')}컷 · G3 승인 대기 ${wait('G3')}컷 · 검수 실패(막힘) ${blocked}컷${notReady ? ` · G4 산출물 없음 ${notReady}컷` : ''}`)
      } catch { resolve(null) }
    })
  })
}

// 스냅샷 본문 줄 생성 — 순수 함수(파일 읽기만, 네트워크 없음)
export function buildSnapshotLines(approval = null) {
  const st = readJson(path.join(CODE_ROOT, 'studio-state.json'), {})
  const gp = readJson(path.join(DOWNLOADS, 'state', 'gpoints.json'), {})
  const ep = st.episode || {}
  const cuts = Array.isArray(st.cuts) ? st.cuts : []
  const code = ep.code || String(ep.number ?? '?')
  const lines = []

  lines.push(`에피소드: ${code} 「${String(ep.title || '').trim()}」 · ${cuts.length}컷`)

  const g = gp[code] || {}
  const cnt = (k) => cuts.filter(c => g[`cut_${c.no}`]?.[k] === true).length
  lines.push(`G 진행: G1 ${cnt('g1')}/${cuts.length} · G2 ${cnt('g2')}/${cuts.length} · G3 ${cnt('g3')}/${cuts.length} · G4 ${cnt('g4')}/${cuts.length} · G5 ${cnt('g5')}/${cuts.length}`)

  // 서여리(YEORI) 컷의 영상 클립 슬롯 채움 현황
  const vc = st.videoTabState?.videoClips || {}
  let planned = 0, filled = 0
  for (const c of cuts) {
    if (c.cutType !== 'YEORI') continue
    const n = Array.isArray(c.segments) && c.segments.length ? c.segments.length : 1
    const arr = vc[c.id] || []
    planned += n
    for (let i = 0; i < n; i++) if (arr[i]) filled++
  }
  lines.push(`영상 클립(서여리 컷): ${filled}/${planned} 슬롯 채워짐`)
  if (approval) lines.push(approval)

  const ct = st.creditTracker || {}
  const f = (a) => ct[a]?.flow ? `${ct[a].flow.remaining}/${ct[a].flow.dailyTotal}` : '?'
  lines.push(`Flow 무료 크레딧 잔여(크레딧 탭 기록 기준): 메인 ${f('main')} · 부 ${f('sub')}`)

  try {
    const p = summarizeMonth()
    const budget = Number(st.dashboard?.monthBudget) || 0
    const manual = Number(st.dashboard?.spent) || 0
    lines.push(`이번 달 비용: 직접 입력 ₩${manual.toLocaleString()} + 유료 영상 API ₩${p.totalKrw.toLocaleString()}($${p.totalUsd}) / 예산 ₩${budget.toLocaleString()}`)
  } catch { /* 장부 없으면 생략 */ }

  // STATUS.md 최신 절 — 묵으면 경고
  const today = kstDate()
  try {
    const sec = latestSection(fs.readFileSync(STATUS_PATH, 'utf-8'))
    if (sec) {
      const ago = daysBetween(sec.date, today)
      lines.push(`STATUS.md 최신 절: ${sec.date} (${ago}일 전)${ago >= STATUS_STALE_DAYS ? ` ⚠️ ${STATUS_STALE_DAYS}일 이상 미갱신 — update_status_md 필요` : ''}`)
    }
  } catch { /* noop */ }

  const reviewed = readSnapState().rulesReviewedAt
  if (reviewed) {
    const ago = daysBetween(reviewed, today)
    lines.push(`"확정 규칙" 섹션 마지막 검토: ${reviewed} (${ago}일 전)${ago >= RULES_STALE_DAYS ? ` ⚠️ ${RULES_STALE_DAYS}일 이상 — 규칙·구조가 바뀌었는지 점검` : ''}`)
  } else lines.push('"확정 규칙" 섹션 마지막 검토: 기록 없음 ⚠️')
  return lines
}

async function notion(method, url, body) {
  const r = await fetch('https://api.notion.com/v1' + url, {
    method, headers: { Authorization: `Bearer ${getNotionToken()}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${r.status} ${d.message || ''}`)
  return d
}

// force=true 면 내용이 같아도 쓴다. 반환: { ok, skipped?, changed? }
export async function refreshHubSnapshot(label = '수동', { force = false } = {}) {
  try {
    if (!getNotionToken()) return { ok: false, skipped: 'no-token' }
    const state = readSnapState()
    if (!state.blockId) return { ok: false, skipped: 'no-block-id (허브에 스냅샷 블록을 먼저 만들 것)' }
    const lines = buildSnapshotLines(await approvalLine())
    const hash = crypto.createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 16)
    if (!force && state.lastHash === hash) return { ok: true, skipped: 'unchanged' }
    const header = '🔄 자동 갱신 — 현재 상태'
    const stamp = `갱신 ${kst()} KST · 출처 ${label} · 스크립트가 기록(AI 호출 없음) — 이 블록은 손으로 고치지 마세요`
    await notion('PATCH', `/blocks/${state.blockId}`, {
      callout: { rich_text: [
        { type: 'text', text: { content: header + '\n' }, annotations: { bold: true } },
        { type: 'text', text: { content: stamp + '\n\n' + lines.join('\n') } },
      ] },
    })
    writeSnapState({ lastHash: hash, lastRefreshAt: new Date().toISOString() })
    return { ok: true, changed: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export function setSnapshotBlockId(blockId) { writeSnapState({ blockId }) }
