// 유튜브 운영실 자동 동기화(2026-11-11) — 공개 채널 페이지만 읽는다(로그인·API 키·LLM 없음).
// 문제: 유튜브 스튜디오에서 직접 올리면 운영실(ops.json)에 아무것도 돌아오지 않아, 이미 공개된 쇼츠가
// '기획'으로 남고 구독자·조회수가 마지막 수동 입력(11/5)에서 멈춰 있었음.
// 하는 일: @핸들/shorts·videos 목록 → 영상별 watch 페이지에서 조회수·게시일 → 운영실 게시물과 연결
// (이미 있는 링크의 영상 ID 우선, 없으면 제목 포함 여부) → '게시'·링크·날짜·조회수 채움 + 구독자 수.
// 프록시가 기동 3분 뒤 + 3시간마다 호출, 운영실 🔄 버튼(POST /api/yt-sync)으로도 즉시.
import { loadOps, saveOps } from './youtubeOps.js'

const UA = { 'accept-language': 'ko-KR,ko;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }
const key = (s) => String(s || '').replace(/[^0-9A-Za-z가-힣]/g, '')
const vidOf = (u) => (String(u || '').match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/) || [])[1]

async function initialData(url) {
  const h = await fetch(url, { headers: UA }).then((r) => r.text())
  const m = h.match(/var ytInitialData = (\{.*?\});<\/script>/s)
  return { html: h, data: m ? JSON.parse(m[1]) : null }
}

// 채널 목록(쇼츠+일반 영상)에서 영상 ID 수집
async function channelVideos(handle) {
  const ids = new Set(); const shorts = new Set(); let subs = null
  for (const tab of ['shorts', 'videos']) {
    const { data } = await initialData(`https://www.youtube.com/@${handle}/${tab}`)
    if (!data) continue
    const walk = (o) => {
      if (!o || typeof o !== 'object') return
      const s = o.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
      if (s) { ids.add(s); shorts.add(s) }
      if (o.videoRenderer?.videoId) ids.add(o.videoRenderer.videoId)
      if (o.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && o.lockupViewModel.contentId) ids.add(o.lockupViewModel.contentId)
      for (const k in o) walk(o[k])
    }
    walk(data)
    if (subs == null) { const m = JSON.stringify(data).match(/구독자\s*([\d.,]+)\s*(천|만)?명/); if (m) subs = Math.round(parseFloat(m[1].replace(/,/g, '')) * (m[2] === '만' ? 1e4 : m[2] === '천' ? 1e3 : 1)) }
  }
  return { ids: [...ids], shorts, subs }
}

// 영상 하나: 제목·조회수·게시일(watch 페이지의 videoDetails/microformat)
async function videoInfo(id) {
  const h = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: UA }).then((r) => r.text())
  const title = (h.match(/"videoDetails":\{[^]*?"title":"((?:[^"\\]|\\.)*)"/) || [])[1]
  const views = (h.match(/"videoDetails":\{[^]*?"viewCount":"(\d+)"/) || [])[1]
  const pub = (h.match(/"publishDate":"([^"]+)"/) || [])[1] || (h.match(/"uploadDate":"([^"]+)"/) || [])[1]
  const ok = (h.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/) || [])[1]
  return { id, title: title ? JSON.parse(`"${title}"`) : '', views: views != null ? Number(views) : null, date: pub ? pub.slice(0, 10) : '', ok }
}

export async function syncYoutube({ log = () => {} } = {}) {
  const ops0 = loadOps()
  const handle = String(ops0.settings?.handle || '').replace(/^@/, '').trim()
  if (!handle) return { ok: false, skipped: '채널 핸들 없음(계정 설정)' }
  const { ids, shorts, subs } = await channelVideos(handle)
  // 운영실에 링크만 있고 채널 목록엔 안 보이는 영상(일부공개·롱폼 탭 누락 등)도 같이 확인
  for (const p of ops0.posts) { const v = vidOf(p.link); if (v && !ids.includes(v)) ids.push(v) }
  const infos = []
  for (const id of ids) { try { const i = await videoInfo(id); if (i.ok === 'OK') infos.push(i) } catch { /* 다음 주기 */ } }
  // 네트워크를 다 끝낸 뒤 불러오기→반영→저장을 한 번에(rev 충돌 방지 — igInsights 와 같은 방식)
  const ops = loadOps()
  const now = new Date().toISOString()
  let linked = 0, updated = 0
  const unmatched = []
  for (const v of infos) {
    let post = ops.posts.find((p) => vidOf(p.link) === v.id)
    if (!post) {
      const t = key(v.title)
      post = ops.posts.filter((p) => !vidOf(p.link) && key(p.title).length >= 4 && t.includes(key(p.title)))
        .sort((a, b) => key(b.title).length - key(a.title).length)[0]
      if (post) { post.link = `https://youtu.be/${v.id}`; linked++ }
    }
    if (!post) { unmatched.push(v.title); continue }
    if (post.status !== '게시') { post.status = '게시'; post.statusHistory = [...(post.statusHistory || []), { status: '게시', at: now, by: 'yt-sync' }] }
    if (v.date && !post.date) post.date = v.date
    if (v.views != null) post.views = v.views
    updated++
  }
  // YPP 쇼츠 조회수(90일 롤링) — 최근 90일 안에 올라간 쇼츠 조회수 합(공개 페이지 기준 근사치)
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  const shortsViews90d = infos.filter((v) => shorts.has(v.id) && (!v.date || v.date >= since)).reduce((a, v) => a + (v.views || 0), 0)
  if (subs != null) ops.ypp = { ...ops.ypp, subs, shortsViews90d, uploads90d: infos.filter((v) => !v.date || v.date >= since).length, lastUpdated: now.slice(0, 10) }
  ops.channelSync = { at: now, subs, videos: infos.length, unmatched }
  saveOps(ops)
  log(`유튜브 동기화: 구독자 ${subs ?? '?'} · 영상 ${infos.length} · 연결 ${linked} · 갱신 ${updated}${unmatched.length ? ' · 운영실에 없는 영상 ' + unmatched.length : ''}`)
  return { ok: true, subs, videos: infos.length, linked, updated, unmatched }
}
