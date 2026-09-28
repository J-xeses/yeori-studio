// ── 관심사 설계 탭 — 후보 계정 발굴 (2026-09-28, 성준님 A+C) ─────────────────────────────
// A. 버튼 발굴(9/28 자동 주간 실행 제거 — 성준님이 직접 찾는 시간을 들이도록): 분야 3개씩 돌아가며 Haiku + 웹 검색으로 인스타 계정 후보를 찾아 "후보"로 올린다.
//    팔로우·승격은 항상 성준님(운영실 후보 표의 승격/✕). 인스타 화면 긁기는 약관 위반이라 쓰지 않는다.
// C. 링크 붙여넣기: instagram.com/{handle} 링크 → 분야·요약·적용점을 자동으로 채워 후보로 추가.
// 비용: 웹 검색 분야당 최대 2회 + 짧은 답 — 1회 실행(3분야) 약 150~200원. 주 1회.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mp from './mediaPaths.js'
import { loadOps, saveOps } from './instaOps.js'

export const DISCOVERY_GROUPS = [
  { group: 'AI 인플루언서', q: '현재 활동 중인 한국·해외 AI/버추얼 인플루언서' },
  { group: 'AI 제작 도구', q: 'AI 영상·이미지·음성 생성 도구 공식 계정 또는 AI 영상 제작 크리에이터' },
  { group: '인스타툰', q: '20~30대 일상 공감 한국 인스타툰 작가' },
  { group: '일상 브이로그', q: '혼자 사는 20대 한국 일상 브이로그 릴스 크리에이터' },
  { group: '직장인 공감', q: '한국 직장인 공감·회사생활 유머 계정' },
  { group: '감성 카페·공간', q: '서울 감성 카페·공간 소개 계정' },
  { group: 'K-트렌드·밈', q: '한국 트렌드·밈 큐레이션 계정' },
  { group: '셀프케어·마음', q: '20~30대 마음챙김·셀프케어 한국 계정' },
  { group: '시네마틱 릴스', q: '시네마틱 영상 연출·편집이 뛰어난 릴스 크리에이터' },
  { group: '글로벌 K-컬처', q: '외국인이 한국 문화·일상을 소개하는 영어 계정' },
]
const PER_RUN = 3
const WEEK_MS = 7 * 24 * 3600e3
const STATE = () => mp.statePath('seed-discovery.json')
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return d } }
const HANDLE_RE = /^[A-Za-z0-9._]{2,30}$/

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY
  try {
    const env = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.local'), 'utf-8')
    return (env.match(/^(?:VITE_)?ANTHROPIC_API_KEY=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, '') || ''
  } catch { return '' }
}

async function askWithSearch(prompt, maxUses) {
  const key = apiKey(); if (!key) throw new Error('Anthropic API 키 없음')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }], messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error.message)
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
  return { text, searches: j.usage?.server_tool_use?.web_search_requests || 0 }
}
function parseArray(text) {
  const a = text.indexOf('['), b = text.lastIndexOf(']')
  if (a < 0 || b < a) return []
  try { const v = JSON.parse(text.slice(a, b + 1)); return Array.isArray(v) ? v : [] } catch { return [] }
}
function knownHandles(ops) {
  return new Set([...(ops.seeds || []).map((x) => String(x.handle).toLowerCase()), ...(ops.seedRejected || []).map((h) => String(h).toLowerCase())])
}
// 네트워크 뒤에 불러오기 → 반영 → 저장을 한 번에(rev 충돌 방지)
function commit(cands) {
  const ops = loadOps(); const known = knownHandles(ops); const today = new Date().toLocaleDateString('sv-SE')
  const added = []
  for (const c of cands) {
    const h = String(c.handle || '').replace(/^@/, '').trim()
    if (!HANDLE_RE.test(h) || known.has(h.toLowerCase())) continue
    known.add(h.toLowerCase())
    const row = { handle: h, group: c.group, why: String(c.why || '').slice(0, 120), use: String(c.use || '').slice(0, 120), day: 0, status: 'candidate', platform: 'instagram', source: c.source, evidence: c.evidence || '', addedAt: today, followedAt: '', visits: [], note: '' }
    ;(ops.seeds ||= []).push(row); added.push(row)
  }
  if (added.length) saveOps({ ...ops })
  return added
}

const SEOYEORI = '서여리 = 20~40대 일상 공감을 다루는, 막 시작한 AI 크리에이터 인스타 계정(카페·혼자인 밤·친구와의 흑역사 같은 일상 릴스, 인스타툰 캐러셀).'

// A. 발굴 실행 — groups 를 안 주면 순번대로 3분야
export async function runDiscovery({ groups, log = () => {} } = {}) {
  const st = readJson(STATE(), { nextIdx: 0, runs: [] })
  const pick = groups?.length ? DISCOVERY_GROUPS.filter((g) => groups.includes(g.group)) : Array.from({ length: PER_RUN }, (_, i) => DISCOVERY_GROUPS[(st.nextIdx + i) % DISCOVERY_GROUPS.length])
  const exclude = [...knownHandles(loadOps())].slice(0, 80).join(', ')
  const found = []; let searches = 0; const errors = []
  for (const g of pick) {
    try {
      const { text, searches: s } = await askWithSearch(
        `${SEOYEORI}\n이 계정이 관심사 신호를 쌓기 위해 팔로우·관찰할 만한 인스타그램 계정을 찾아줘. 분야: ${g.q}.\n` +
        `- 웹 검색으로 실제 존재가 확인되는 계정만, 최대 4개. 2025~2026년에 활동 흔적이 있으면 좋고, 확신이 낮아도 근거 URL이 있으면 포함.\n` +
        `- 이미 있는 계정 제외: ${exclude}\n` +
        `- 설명 없이 JSON 배열만: [{"handle":"인스타 아이디(@ 없이)","why":"핵심 요약 한 줄(한국어)","use":"서여리에게 적용할 점 한 줄(한국어)","evidence":"근거 URL"}]`, 2)
      searches += s
      for (const c of parseArray(text)) found.push({ ...c, group: g.group, source: 'AI 발굴(주간)' })
      log(`[seed-discovery] ${g.group}: 후보 ${parseArray(text).length}개 · 검색 ${s}회`)
    } catch (e) { errors.push(`${g.group}: ${e.message}`) }
  }
  const added = commit(found)
  if (!groups?.length) st.nextIdx = (st.nextIdx + PER_RUN) % DISCOVERY_GROUPS.length
  st.lastRun = new Date().toISOString()
  st.runs = [...(st.runs || []), { at: st.lastRun, groups: pick.map((g) => g.group), found: found.length, added: added.length, searches, errors }].slice(-30)
  fs.writeFileSync(STATE(), JSON.stringify(st, null, 2))
  return { groups: pick.map((g) => g.group), found: found.length, added: added.map((a) => `${a.group} @${a.handle}`), searches, errors }
}

export async function maybeWeeklyDiscovery(log) {
  const st = readJson(STATE(), {})
  if (st.lastRun && Date.now() - Date.parse(st.lastRun) < WEEK_MS) return null
  return runDiscovery({ log })
}

// C. 링크(또는 @아이디) 하나 → 분야·요약·적용점 자동 채움
export async function addFromLink(input) {
  // 링크면 경로 첫 칸이 아이디. p/reel/stories 같은 게시물 링크는 계정을 알 수 없으므로 거절(9/28 게시물 번호를 아이디로 착각한 사고)
  const raw = String(input || '').trim()
  const segs = /instagram\.com/i.test(raw) ? (raw.split(/instagram\.com\//i)[1] || '').split(/[/?#]/).filter(Boolean) : [raw.replace(/^@/, '')]
  const handle = segs[0]
  if (!handle || /^(p|reel|reels|stories|explore|tv)$/i.test(handle) || !HANDLE_RE.test(handle)) throw new Error('인스타 계정 링크(instagram.com/아이디) 또는 @아이디를 넣어 주세요 — 게시물·릴스 링크는 계정을 알 수 없어요')
  if (knownHandles(loadOps()).has(handle.toLowerCase())) throw new Error(`@${handle} 은(는) 이미 목록(또는 제외 목록)에 있어요`)
  let info = {}
  try {
    const { text } = await askWithSearch(
      `${SEOYEORI}\n인스타그램 계정 @${handle} 이(가) 어떤 계정인지 웹 검색으로 확인하고 JSON 배열 하나로만 답해줘. 분류는 다음 중 하나: ${DISCOVERY_GROUPS.map((g) => g.group).join(' / ')} / 기타.\n` +
      `[{"handle":"${handle}","group":"분류","why":"핵심 요약 한 줄","use":"서여리에게 적용할 점 한 줄","evidence":"근거 URL(없으면 빈칸)"}]`, 1)
    info = parseArray(text)[0] || {}
  } catch { /* 검색 실패해도 계정은 추가 */ }
  const group = DISCOVERY_GROUPS.some((g) => g.group === info.group) ? info.group : '기타'
  const added = commit([{ handle, group, why: info.why || '', use: info.use || '', evidence: info.evidence || `https://www.instagram.com/${handle}/`, source: '링크 추가' }])
  return added[0] || null
}

export function discoveryStatus() {
  const st = readJson(STATE(), { nextIdx: 0, runs: [] })
  const month = new Date().toISOString().slice(0, 7)
  const mRuns = (st.runs || []).filter((r) => String(r.at).startsWith(month))
  const searches = mRuns.reduce((a, r) => a + (r.searches || 0), 0)
  const next = Array.from({ length: PER_RUN }, (_, i) => DISCOVERY_GROUPS[(st.nextIdx + i) % DISCOVERY_GROUPS.length].group)
  return { lastRun: st.lastRun || null, nextGroups: next, groups: DISCOVERY_GROUPS.map((g) => g.group), lastRunResult: (st.runs || []).slice(-1)[0] || null,
    // 이번 달 추정 비용(웹 검색 $10/1000회 + 1회당 토큰 약 $0.03) — 정확한 청구는 Anthropic 콘솔 사용량 화면
    month: { runs: mRuns.length, searches, estUsd: +(searches * 0.01 + mRuns.length * 3 * 0.03).toFixed(2) } }
}
