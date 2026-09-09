// 에피소드 상태 층 — pipeline-leader 가 매 사이클 "에피소드 파이프라인" Notion DB 행을
// 갱신. 현재 게이트 · 에이전트 상태 · 다음 액션 · 블로커 · 마지막 리더 사이클.
// 사람은 같은 행의 보류/에이전트 자동승인(P3에서 읽음)을 토글. 설계: "에이전트 리더 백본" §03.
//
// 호출: proxy.js  POST /api/mcp/leader-episode-sync  →  syncEpisodeState(payload)

import fs from 'node:fs'
import path from 'node:path'

const NOTION_VERSION = '2022-06-28'
const CODE_ROOT = 'C:\\yeori-studio\\app'
const EPISODE_DB_ID = '2d093c5f-69c4-4e91-9d2d-0b997ddbe299'

const GATES = new Set(['G1 대본', 'G2 이미지', 'G3 TTS', 'G4 영상', 'G5 편집', 'G6 업로드', '완료'])
const AGENT_STATES = new Set(['돌아가는중', '사람 승인 대기', '블로커', '유휴', '보류', '완료'])

function notionToken() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, 'studio-secrets.json'), 'utf-8'))
    return s.apiKeys?.notion || ''
  } catch { return '' }
}
const headers = (t) => ({ Authorization: `Bearer ${t}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' })
const rt = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 1900) } }] : [])

// { episodeCode, episodeTitle, currentGate, agentState, nextAction, blocker, cutCount, isLong }
// 실패해도 던지지 않음 — 리더 사이클 절대 안 막음.
export async function syncEpisodeState(p = {}) {
  const token = notionToken()
  if (!token) return { ok: false, skipped: 'no-token' }
  const code = String(p.episodeCode || '').trim()
  if (!code) return { ok: false, skipped: 'no-code' }

  const props = {
    '마지막 리더 사이클': { date: { start: new Date().toISOString() } },
  }
  if (GATES.has(p.currentGate)) props['현재 게이트'] = { select: { name: p.currentGate } }
  if (AGENT_STATES.has(p.agentState)) props['에이전트 상태'] = { select: { name: p.agentState } }
  if (p.nextAction != null) props['다음 액션'] = { rich_text: rt(p.nextAction) }
  if (p.blocker != null) props['블로커'] = { rich_text: rt(p.blocker) }   // 빈 문자열 → 클리어
  if (typeof p.cutCount === 'number') props['컷 수'] = { number: p.cutCount }

  try {
    // 1) title 에 코드 포함된 행 검색 (update-script-history 와 같은 패턴)
    const q = await fetch(`https://api.notion.com/v1/databases/${EPISODE_DB_ID}/query`, {
      method: 'POST', headers: headers(token),
      body: JSON.stringify({ filter: { property: 'title', title: { contains: code } }, page_size: 1 }),
    })
    const qd = await q.json()
    if (!q.ok) return { ok: false, status: q.status, body: JSON.stringify(qd).slice(0, 300) }

    const page = qd.results?.[0]
    if (page) {
      const r = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: 'PATCH', headers: headers(token), body: JSON.stringify({ properties: props }),
      })
      return r.ok ? { ok: true, mode: 'update' } : { ok: false, status: r.status, body: (await r.text()).slice(0, 300) }
    }

    // 2) 없으면 리더용 행 생성 — 코드 기반 제목으로 (사람이 나중에 병합/개명)
    props['에피소드명'] = { title: rt(`${code}${p.episodeTitle ? ` · ${String(p.episodeTitle).trim()}` : ''}`) }
    props['채널'] = { select: { name: '서여리 채널' } }
    if (p.isLong != null) props['타입'] = { select: { name: p.isLong ? '롱폼' : '숏폼' } }
    const c = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST', headers: headers(token),
      body: JSON.stringify({ parent: { database_id: EPISODE_DB_ID }, properties: props }),
    })
    return c.ok ? { ok: true, mode: 'create' } : { ok: false, status: c.status, body: (await c.text()).slice(0, 300) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
