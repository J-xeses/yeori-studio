// ── 계정 목록 — 팔로우한 계정의 신규 소재 자동 체크 (2026-11-04, 성준님: "계정목록이 벤치마킹 신규소재를 수시로 체크·분석하는 역할") ──
// seedDiscovery.js(계정 발굴)·trendResearch.js(분야 리서치)와 같은 Haiku + 웹 검색 패턴을 재사용하되,
// 대상은 "분야"가 아니라 이미 팔로우한 활성 계정 하나하나 — 그 계정이 최근 보일 만한 주목할 콘텐츠·방향 변화를 찾아
// ops.benchmarks 에 source:'AI 발굴(계정)'로 쌓는다. 팔로워 수 등 정량 지표는 Business Discovery API 영역(별도 보류 과제).
// 주 1회(매주) — maybeWeeklyAccountWatch() 가 proxy.js 의 기존 3시간 틱에서 7일 경과를 확인해 실행.
import fs from 'node:fs'
import * as mp from './mediaPaths.js'
import { loadOps, saveOps } from './instaOps.js'
import { apiKey, askWithSearch, parseArray } from './seedDiscovery.js'

const PER_RUN = 3
const WEEK_MS = 7 * 24 * 3600e3
const STATE = () => mp.statePath('account-watch.json')
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return d } }

const SEOYEORI = '서여리 = 20~40대 일상 공감을 다루는, 막 시작한 AI 크리에이터 인스타 계정(카페·혼자인 밤·친구와의 흑역사 같은 일상 릴스, 인스타툰 캐러셀).'

function knownUrls(ops) {
  return new Set((ops.benchmarks || []).map((b) => String(b.url || '').trim().toLowerCase()).filter(Boolean))
}
// 불러오기 → 반영 → 저장을 한 번에(rev 충돌 방지, seedDiscovery.js commit()과 동일 패턴)
function commit(items) {
  const ops = loadOps(); const known = knownUrls(ops); const now = new Date().toISOString()
  const added = []
  for (const it of items) {
    const url = String(it.url || '').trim()
    if (url && known.has(url.toLowerCase())) continue
    if (url) known.add(url.toLowerCase())
    const note = String(it.note || '').slice(0, 160)
    if (!note) continue
    const row = { url, note, source: 'AI 발굴(계정)', addedAt: now }
    ;(ops.benchmarks ||= []).push(row); added.push(row)
  }
  if (added.length) saveOps({ ...ops })
  return added
}
const activeSeeds = (ops) => (ops.seeds || []).filter((x) => (x.status || 'active') === 'active')

export async function runAccountWatch({ handles, log = () => {} } = {}) {
  const pool = activeSeeds(loadOps())
  if (!pool.length) return { handles: [], found: 0, added: [], searches: 0, errors: ['팔로우한 계정이 아직 없습니다'] }
  const st = readJson(STATE(), { nextIdx: 0, runs: [] })
  const n = Math.min(PER_RUN, pool.length)
  const pick = handles?.length ? pool.filter((x) => handles.includes(x.handle)) : Array.from({ length: n }, (_, i) => pool[(st.nextIdx + i) % pool.length])
  const found = []; let searches = 0; const errors = []
  for (const x of pick) {
    try {
      const { text, searches: s } = await askWithSearch(
        `${SEOYEORI}\n인스타그램 계정 @${x.handle}(분야: ${x.group})이 최근에 올렸을 만한 주목할 게시물이나 콘텐츠 방향 변화가 있는지 웹 검색으로 확인해줘.\n` +
        `- 실제 웹 검색으로 확인되는 것만, 최대 2개. 확신이 낮으면 억지로 만들지 말고 빈 배열로.\n` +
        `- 설명 없이 JSON 배열만: [{"url":"링크(없으면 빈 문자열)","note":"무엇이고 왜 참고할만한지 한국어 한 줄(서여리에게 어떻게 적용할지 포함)"}]`, 2)
      searches += s
      for (const c of parseArray(text)) found.push(c)
      log(`[account-watch] @${x.handle}: 사례 ${parseArray(text).length}개 · 검색 ${s}회`)
    } catch (e) { errors.push(`@${x.handle}: ${e.message}`) }
  }
  const added = commit(found)
  if (!handles?.length) st.nextIdx = (st.nextIdx + n) % pool.length
  st.lastRun = new Date().toISOString()
  st.runs = [...(st.runs || []), { at: st.lastRun, handles: pick.map((x) => x.handle), found: found.length, added: added.length, searches, errors }].slice(-30)
  fs.writeFileSync(STATE(), JSON.stringify(st, null, 2))
  return { handles: pick.map((x) => x.handle), found: found.length, added: added.map((a) => a.note), searches, errors }
}

export async function maybeWeeklyAccountWatch(log) {
  if (!apiKey()) return null
  const st = readJson(STATE(), {})
  if (st.lastRun && Date.now() - Date.parse(st.lastRun) < WEEK_MS) return null
  return runAccountWatch({ log })
}

export function accountWatchStatus() {
  const pool = activeSeeds(loadOps())
  const st = readJson(STATE(), { nextIdx: 0, runs: [] })
  const month = new Date().toISOString().slice(0, 7)
  const mRuns = (st.runs || []).filter((r) => String(r.at).startsWith(month))
  const searches = mRuns.reduce((a, r) => a + (r.searches || 0), 0)
  const n = Math.min(PER_RUN, pool.length)
  const next = pool.length ? Array.from({ length: n }, (_, i) => pool[(st.nextIdx + i) % pool.length].handle) : []
  return { lastRun: st.lastRun || null, nextHandles: next, poolSize: pool.length, lastRunResult: (st.runs || []).slice(-1)[0] || null,
    month: { runs: mRuns.length, searches, estUsd: +(searches * 0.01 + mRuns.length * 3 * 0.03).toFixed(2) } }
}
