// ── 벤치마킹 레퍼런스 — 트렌드/콘텐츠 자동 수집 (2026-11-02, 성준님: "정보수집은 빠르고 정확한 기능활용으로 시간 세이브") ──
// seedDiscovery.js(계정 후보 발굴)와 같은 Haiku + 웹검색 패턴을 재사용하되, 대상은 "계정"이 아니라
// "지금 뜨는 콘텐츠/기법" — 결과는 ops.benchmarks 에 source:'AI 발굴'로 쌓여 벤치마킹 탭에 그대로 보인다.
// 주 1회(매주, 성준님 확정) — maybeWeeklyTrendResearch() 가 proxy.js 의 기존 3시간 틱에서 7일 경과를 확인해 실행.
// 비용: 분야당 검색 최대 2회 — 1회 실행(3분야) 약 150~200원(seedDiscovery.js와 동일 모델).
import fs from 'node:fs'
import * as mp from './mediaPaths.js'
import { loadOps, saveOps } from './instaOps.js'
import { apiKey, askWithSearch, parseArray } from './seedDiscovery.js'

export const TREND_GROUPS = [
  { group: '릴스 후킹 기법', q: '최근 조회수가 많이 나온 릴스의 오프닝 3초 연출·후킹 기법' },
  { group: 'AI 인플루언서 바이럴', q: 'AI 인플루언서 또는 가상 인플루언서 콘텐츠 중 최근 화제가 된 게시물·릴스' },
  { group: '인스타툰 인기 소재', q: '최근 반응 좋은 한국 인스타툰 소재·연출 사례' },
  { group: '숏폼 편집 트렌드', q: '최근 유행하는 숏폼 영상 편집·전환·자막 기법' },
  { group: 'AI 제작도구 신기능', q: '최근 공개된 AI 영상·이미지·음성 생성 도구 신기능 또는 활용 사례' },
]
const PER_RUN = 3
const WEEK_MS = 7 * 24 * 3600e3
const STATE = () => mp.statePath('trend-research.json')
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
    const row = { url, note, source: 'AI 발굴', addedAt: now }
    ;(ops.benchmarks ||= []).push(row); added.push(row)
  }
  if (added.length) saveOps({ ...ops })
  return added
}

export async function runTrendResearch({ groups, log = () => {} } = {}) {
  const st = readJson(STATE(), { nextIdx: 0, runs: [] })
  const pick = groups?.length ? TREND_GROUPS.filter((g) => groups.includes(g.group)) : Array.from({ length: PER_RUN }, (_, i) => TREND_GROUPS[(st.nextIdx + i) % TREND_GROUPS.length])
  const found = []; let searches = 0; const errors = []
  for (const g of pick) {
    try {
      const { text, searches: s } = await askWithSearch(
        `${SEOYEORI}\n이 계정이 콘텐츠 제작에 참고할 만한 "지금 뜨는" 사례를 찾아줘. 분야: ${g.q}.\n` +
        `- 웹 검색으로 실제 확인되는 사례만, 최대 3개. 가능하면 구체적인 게시물·영상·기사 링크로.\n` +
        `- 설명 없이 JSON 배열만: [{"url":"링크(없으면 빈 문자열)","note":"무엇이고 왜 참고할만한지 한국어 한 줄(서여리에게 어떻게 적용할지 포함)"}]`, 2)
      searches += s
      for (const c of parseArray(text)) found.push(c)
      log(`[trend-research] ${g.group}: 사례 ${parseArray(text).length}개 · 검색 ${s}회`)
    } catch (e) { errors.push(`${g.group}: ${e.message}`) }
  }
  const added = commit(found)
  if (!groups?.length) st.nextIdx = (st.nextIdx + PER_RUN) % TREND_GROUPS.length
  st.lastRun = new Date().toISOString()
  st.runs = [...(st.runs || []), { at: st.lastRun, groups: pick.map((g) => g.group), found: found.length, added: added.length, searches, errors }].slice(-30)
  fs.writeFileSync(STATE(), JSON.stringify(st, null, 2))
  return { groups: pick.map((g) => g.group), found: found.length, added: added.map((a) => a.note), searches, errors }
}

export async function maybeWeeklyTrendResearch(log) {
  if (!apiKey()) return null
  const st = readJson(STATE(), {})
  if (st.lastRun && Date.now() - Date.parse(st.lastRun) < WEEK_MS) return null
  return runTrendResearch({ log })
}

export function trendResearchStatus() {
  const st = readJson(STATE(), { nextIdx: 0, runs: [] })
  const month = new Date().toISOString().slice(0, 7)
  const mRuns = (st.runs || []).filter((r) => String(r.at).startsWith(month))
  const searches = mRuns.reduce((a, r) => a + (r.searches || 0), 0)
  const next = Array.from({ length: PER_RUN }, (_, i) => TREND_GROUPS[(st.nextIdx + i) % TREND_GROUPS.length].group)
  return { lastRun: st.lastRun || null, nextGroups: next, groups: TREND_GROUPS.map((g) => g.group), lastRunResult: (st.runs || []).slice(-1)[0] || null,
    month: { runs: mRuns.length, searches, estUsd: +(searches * 0.01 + mRuns.length * 3 * 0.03).toFixed(2) } }
}
