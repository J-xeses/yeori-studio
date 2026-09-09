// 에이전트 리더 로그 — pipeline-leader / genline 의 자율 판단을 Notion DB 에 한 행씩.
// 단일 결정 원장. 개발 작업 로그(작업·버그 로그)와 분리된 런타임 오케스트레이션 전용.
// 설계: 아티팩트 "에이전트 리더 백본" §04.
//
// 호출: proxy.js  POST /api/mcp/leader-log  →  postLeaderLog(entry)
// entry: { episode, stage, kind, source, summary, rationale, result, humanInvolved }

import fs from 'node:fs'
import path from 'node:path'

const NOTION_VERSION = '2022-06-28'
const CODE_ROOT = 'C:\\yeori-studio\\app'
// "에이전트 리더 로그" DB (마스터 허브 하위). 스키마: 요약(title)·에피소드·스테이지·종류·출처·근거·결과·사람 개입·시각
export const LEADER_LOG_DB_ID = '4c96f9bd-bf1d-463d-b62f-041239330c15'

const STAGES = new Set(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'making', '사이클'])
const KINDS = new Set(['자동실행', '승인대기', '자동승인', '반려감지', '블로커', '생성시도', '재생성', '사람선택', '사이클요약'])
const SOURCES = new Set(['pipeline-leader', 'genline', '사람'])

function notionToken() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, 'studio-secrets.json'), 'utf-8'))
    return s.apiKeys?.notion || ''
  } catch { return '' }
}
const rt = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 1900) } }] : [])
const sel = (v, set, fallback) => ({ select: { name: set.has(v) ? v : fallback } })

// 실패해도 던지지 않음 — 리더/genline 사이클을 절대 막지 않는다.
export async function postLeaderLog(entry = {}) {
  const token = notionToken()
  if (!token || !LEADER_LOG_DB_ID) return { ok: false, skipped: 'no-token' }
  const {
    episode = '', stage = '사이클', kind = '사이클요약', source = 'pipeline-leader',
    summary = '(요약 없음)', rationale = '', result = '', humanInvolved = false,
  } = entry
  const properties = {
    '요약': { title: rt(summary) },
    '에피소드': { rich_text: rt(episode) },
    '스테이지': sel(stage, STAGES, '사이클'),
    '종류': sel(kind, KINDS, '사이클요약'),
    '출처': sel(source, SOURCES, 'pipeline-leader'),
    '근거': { rich_text: rt(rationale) },
    '결과': { rich_text: rt(result) },
    '사람 개입': { checkbox: !!humanInvolved },
  }
  try {
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: { database_id: LEADER_LOG_DB_ID }, properties }),
    })
    if (!r.ok) return { ok: false, status: r.status, body: (await r.text()).slice(0, 300) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
