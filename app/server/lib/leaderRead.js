// 에이전트 리더 상황 읽기 — Notion(에피소드 파이프라인 + 에이전트 리더 로그)에서
// "지금 무슨 일이 벌어지고 있나"를 조회. leader_status MCP 도구 / GET /api/mcp/leader-status 가 씀.
// pipeline-leader 가 쓰고(P1/P2) 에이전트가 읽는(여기) 루프의 읽기쪽.

import fs from 'node:fs'
import path from 'node:path'

const NOTION_VERSION = '2022-06-28'
const CODE_ROOT = 'C:\\yeori-studio\\app'
const EPISODE_DB_ID = '2d093c5f-69c4-4e91-9d2d-0b997ddbe299'
const LEADER_LOG_DB_ID = '4c96f9bd-bf1d-463d-b62f-041239330c15'

function notionToken() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, 'studio-secrets.json'), 'utf-8'))
    return s.apiKeys?.notion || ''
  } catch { return '' }
}
const H = (t) => ({ Authorization: `Bearer ${t}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' })
const txt = (p) => (p?.rich_text || p?.title || []).map(x => x.plain_text).join('')
const sel = (p) => p?.select?.name || ''
const msel = (p) => (p?.multi_select || []).map(x => x.name)

async function nQuery(token, dbId, body) {
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST', headers: H(token), body: JSON.stringify(body),
  })
  if (!r.ok) return { ok: false, status: r.status, results: [] }
  const d = await r.json()
  return { ok: true, results: d.results || [] }
}

// episodeCode 로 에피소드 파이프라인 행 + 최근 리더 로그 + 사람 대기 항목을 조회.
export async function getLeaderStatus(episodeCode = '', { logLimit = 12 } = {}) {
  const token = notionToken()
  if (!token) return { ok: false, error: 'Notion 토큰 없음 (studio-secrets.json apiKeys.notion)' }

  // 1) 에피소드 파이프라인 행
  let episode = null
  if (episodeCode) {
    const q = await nQuery(token, EPISODE_DB_ID, {
      filter: { property: 'title', title: { contains: episodeCode } }, page_size: 1,
    })
    const p = q.results[0]
    if (p) episode = {
      title: txt(p.properties['에피소드명']),
      currentGate: sel(p.properties['현재 게이트']),
      agentState: sel(p.properties['에이전트 상태']),
      nextAction: txt(p.properties['다음 액션']),
      blocker: txt(p.properties['블로커']),
      lastCycle: p.properties['마지막 리더 사이클']?.date?.start || '',
      hold: !!p.properties['보류']?.checkbox,
      autoApprove: msel(p.properties['에이전트 자동승인']),
      channel: sel(p.properties['채널']),
      cutCount: p.properties['컷 수']?.number ?? null,
      url: p.url,
    }
  }

  // 2) 최근 리더 로그
  const logFilter = episodeCode
    ? { property: '에피소드', rich_text: { contains: episodeCode } } : undefined
  const lq = await nQuery(token, LEADER_LOG_DB_ID, {
    ...(logFilter ? { filter: logFilter } : {}),
    sorts: [{ property: '시각', direction: 'descending' }], page_size: logLimit,
  })
  const recentLog = lq.results.map(p => ({
    at: p.properties['시각']?.created_time || p.created_time,
    episode: txt(p.properties['에피소드']),
    stage: sel(p.properties['스테이지']),
    kind: sel(p.properties['종류']),
    source: sel(p.properties['출처']),
    summary: txt(p.properties['요약']),
    result: txt(p.properties['결과']),
    humanInvolved: !!p.properties['사람 개입']?.checkbox,
  }))

  // 3) 사람 개입 대기 (전체 에피소드 — "지금 나를 기다리는 것")
  const pq = await nQuery(token, LEADER_LOG_DB_ID, {
    filter: { property: '사람 개입', checkbox: { equals: true } },
    sorts: [{ property: '시각', direction: 'descending' }], page_size: 15,
  })
  const pendingHuman = pq.results.map(p => ({
    at: p.properties['시각']?.created_time || p.created_time,
    episode: txt(p.properties['에피소드']),
    stage: sel(p.properties['스테이지']),
    kind: sel(p.properties['종류']),
    summary: txt(p.properties['요약']),
  }))

  return { ok: true, episodeCode, episode, recentLog, pendingHuman }
}

// getLeaderStatus 결과 → MCP 도구 응답용 사람이 읽는 텍스트.
export function formatLeaderStatus(d) {
  const L = []
  const e = d.episode
  if (e) {
    L.push(`■ ${e.title || d.episodeCode}  (${e.channel || '?'} · 컷 ${e.cutCount ?? '?'})`)
    L.push(`  현재 게이트: ${e.currentGate || '?'}   |   에이전트 상태: ${e.agentState || '?'}`)
    if (e.nextAction) L.push(`  다음 액션: ${e.nextAction}`)
    if (e.blocker) L.push(`  ⚠ 블로커: ${e.blocker}`)
    if (e.hold) L.push(`  ⏸ 보류됨 — 리더가 이 에피소드를 건드리지 않음`)
    if (e.autoApprove?.length) L.push(`  자동승인 위임: ${e.autoApprove.join(', ')}`)
    if (e.lastCycle) L.push(`  마지막 리더 사이클: ${e.lastCycle}`)
  } else {
    L.push(`■ ${d.episodeCode || '(활성 에피소드 없음)'} — 파이프라인 DB 행 없음 (리더가 아직 안 돌았거나 코드 불일치)`)
  }

  if (d.pendingHuman?.length) {
    L.push('', `● 사람 개입 대기 (${d.pendingHuman.length})`)
    for (const p of d.pendingHuman.slice(0, 10)) {
      L.push(`  - [${p.episode || '?'} ${p.stage || ''}] ${p.summary}  (${(p.at || '').slice(0, 16).replace('T', ' ')})`)
    }
  } else {
    L.push('', '● 사람 개입 대기: 없음')
  }

  if (d.recentLog?.length) {
    L.push('', `● 최근 리더 로그 (${d.recentLog.length})`)
    for (const r of d.recentLog) {
      const t = (r.at || '').slice(5, 16).replace('T', ' ')
      L.push(`  ${t} [${r.stage}/${r.kind}${r.source === 'genline' ? ' ·genline' : ''}] ${r.summary}${r.result ? `  → ${r.result}` : ''}`)
    }
  }
  return L.join('\n')
}
