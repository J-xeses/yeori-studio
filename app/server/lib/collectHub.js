// ── 수집함(Collect Hub) — 벤치마킹 자료 일원화(2026-11-06, 성준님 설계) ─────────────────────────────
// 성준님이 각 플랫폼에 로그인해서 "미리 지정한 저장 목록"(인스타 저장 컬렉션 / 유튜브 '벤치마킹 영상' 재생목록 /
// 핀터레스트 보드)을 열고 📥 북마클릿을 누르면, 화면에 보이는 목록이 통째로 여기 담긴다.
// 처음 한 번 담은 뒤로는 로그인 없이 읽히는 경로(핀터레스트 보드 RSS + 계정 피드, 유튜브 일부공개 재생목록)를
// 3시간 틱마다 다시 읽어 새 항목만 추가한다. 인스타는 로그인 필요 + 자동 크롤링 금지 원칙이라 북마클릿 경로만.
//
// 담긴 항목은 Haiku 가 한 번에 정리(개요·키워드·용도/기법)하고 네 곳에 나눠 보여준다:
//   ① 퍼블리싱 탭 키워드 후보 칩  ② 인스타/유튜브 운영실 수집함 칸  ③ 스토리 아카이브 연출기법(자동 추가)
//   ④ 레퍼런스 보드 부가기능 영역 왼쪽 리스트 → "레퍼런스 등록"
// 저장소는 이 파일 하나(downloads/_shared/collect/inbox.json) — 화면들은 읽기만 해서 두 기록이 갈라지지 않게 한다.
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'
import { apiKey, parseArray } from './seedDiscovery.js'
import { saveEntry } from './storyArchive.js'
import { taxonomyPrompt, cleanClass } from './refTaxonomy.js'

const DIR = path.join(mp.DOWNLOADS, '_shared', 'collect')
const INBOX = path.join(DIR, 'inbox.json')
const SOURCES = path.join(DIR, 'sources.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return d } }
const writeJson = (p, v) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)) }

// 기본 소스(성준님 2026-11-06 지정). 유튜브 재생목록은 북마클릿을 재생목록 화면에서 처음 누를 때 자동 등록된다.
// 대상 한정(성준님 11/6): 핀터레스트는 이 세 보드만, 유튜브는 '벤치마킹 영상' 재생목록만. 나머지 보드(건축 등)·보드 없이
// 저장한 핀·다른 재생목록은 자동 갱신에서도, 북마클릿 목록 담기에서도 받지 않는다(단일 핀/영상 화면에서 하나만 담는 건 허용).
const DEFAULT_SOURCES = {
  pinterest: [{ user: 'won566800', boards: ['연출 기법', '모션 그래픽', '주목할 영상'] }],
  instagram: [{ url: 'https://www.instagram.com/jun9320027/saved/_/2253931955462918/', note: '북마클릿 전용(로그인 필요)' }],
  youtube: [],
  youtubeAllow: ['벤치마킹 영상'],
}
export function loadSources() {
  const s = { ...DEFAULT_SOURCES, ...readJson(SOURCES, {}) }
  // 예전에 저장된 sources.json(보드 목록 없음)이 대상 한정을 덮어쓰지 않게 기본값으로 채움
  s.pinterest = (s.pinterest || []).map((p) => ({ ...p, boards: p.boards || DEFAULT_SOURCES.pinterest.find((d) => d.user === p.user)?.boards }))
  s.youtubeAllow = s.youtubeAllow || DEFAULT_SOURCES.youtubeAllow
  return s
}
// 유튜브 재생목록의 진짜 이름 — 북마클릿이 화면에서 읽은 이름은 "YouTube"처럼 틀릴 때가 있어서(11/6 실측) 서버가 직접 확인
async function playlistTitle(listId) {
  try { return (( await getText(`https://www.youtube.com/playlist?list=${listId}`)).match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '' } catch { return '' }
}
// 북마클릿 입구용 — 유튜브 재생목록이면 진짜 이름으로 바꾼 뒤 담기
export async function ingestFromBookmarklet(body = {}) {
  try {
    const u = new URL(body.listUrl || '')
    const id = u.searchParams.get('list')
    if (/youtube\.com/.test(u.hostname) && id && u.pathname === '/playlist') {
      const t = await playlistTitle(id)
      if (t) { body.list = t; for (const it of body.items || []) it.list = t }
    }
  } catch { /* listUrl 없음 */ }
  return ingest(body)
}
const nameKey = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[\s\-_·.]+/g, '')
const allowedBoard = (name, s = loadSources()) => (s.pinterest || []).some((p) => !p.boards || p.boards.some((b) => nameKey(b) === nameKey(name)))
const allowedPlaylist = (name, s = loadSources()) => !(s.youtubeAllow || []).length || s.youtubeAllow.some((b) => nameKey(b) === nameKey(name))

// 목록 담기(북마클릿)가 대상 목록에서 온 건지 — 핀터레스트 보드/유튜브 재생목록 화면일 때만 검사
export function listAllowed(listUrl, list) {
  try {
    const u = new URL(listUrl)
    if (/pinterest\./.test(u.hostname) && !/\/pin\//.test(u.pathname)) {
      const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean)[1] || '')
      return allowedBoard(slug) || allowedBoard(list)
    }
    if (/youtube\.com/.test(u.hostname) && u.searchParams.get('list') && u.pathname === '/playlist') return allowedPlaylist(list)
  } catch { /* 주소 해석 실패 = 검사 안 함 */ }
  return true
}
function saveSources(s) { writeJson(SOURCES, s) }
export function loadInbox() { return readJson(INBOX, []) }
function saveInbox(list) { writeJson(INBOX, list) }

// 같은 자료를 두 번 안 담도록 주소를 한 모양으로 맞춘다
export function normUrl(u) {
  try {
    const x = new URL(String(u).trim())
    const host = x.hostname.replace(/^(www\.|kr\.|m\.)/, '')
    if (/pinterest\./.test(host)) { const id = x.pathname.match(/\/pin\/([\w-]+)/)?.[1]; if (id) return `https://www.pinterest.com/pin/${id}/` }
    if (/youtube\.com$/.test(host) || host === 'youtu.be') {
      const v = x.searchParams.get('v') || x.pathname.match(/\/shorts\/([\w-]{11})/)?.[1] || (host === 'youtu.be' ? x.pathname.slice(1, 12) : '')
      if (v) return `https://www.youtube.com/watch?v=${v}`
    }
    if (/instagram\.com$/.test(host)) { const m = x.pathname.match(/\/(p|reel|reels|tv)\/([\w-]+)/); if (m) return `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/` }
    return `${x.protocol}//${host}${x.pathname}`.replace(/\/$/, '')
  } catch { return String(u || '').trim() }
}
const platformOf = (u) => /pinterest\./.test(u) ? 'pinterest' : /youtube\.com|youtu\.be/.test(u) ? 'youtube' : /instagram\.com/.test(u) ? 'instagram' : 'web'

// 담기 — 북마클릿·RSS·재생목록 공통 입구. 새로 들어온 개수를 돌려준다.
export function ingest({ items = [], list = '', listUrl = '' } = {}) {
  if (listUrl && !listAllowed(listUrl, list)) {
    const s = loadSources()
    return { added: 0, total: items.length, rejected: `대상 목록이 아닙니다 — 핀터레스트: ${(s.pinterest[0]?.boards || []).join(', ')} / 유튜브: ${(s.youtubeAllow || []).join(', ')}` }
  }
  const inbox = loadInbox()
  // 핀터레스트 보드 RSS 의 암호화형 링크는 가져올 때마다 바뀐다(11/6 실측 — 같은 핀이 매번 새 항목으로 중복).
  // 그래서 핀터레스트는 썸네일 파일명 해시(핀마다 고정)로도 같은 항목인지 본다.
  const known = new Map()
  for (const e of inbox) { known.set(e.url, e); if (e.imgKey) known.set('img:' + e.imgKey, e) }
  let added = 0
  for (const it of items) {
    const url = normUrl(it.url); if (!url || !/^https?:/.test(url)) continue
    // 썸네일도 없고 숫자형 짝도 못 찾은 영상 핀은 "보드+핀 생성 시각"으로 같은 항목 판단
    const ik = /pinimg\.com/.test(it.thumb || '') ? imgKey(it.thumb) : (it.date && (it.list || list) ? 'd:' + (it.list || list) + '|' + it.date : '')
    const prev = known.get(url) || (ik && known.get('img:' + ik))
    if (prev && prev.url !== url && /\/pin\/\d+\//.test(url) && !/\/pin\/\d+\//.test(prev.url)) prev.url = url   // 나중에 숫자형 링크를 알게 되면 교체
    if (prev) {   // 이미 있으면 비어 있던 칸만 채운다(RSS 가 나중에 제목을 알려주는 경우 등)
      for (const k of ['title', 'text', 'thumb']) if (!prev[k] && it[k]) prev[k] = String(it[k]).slice(0, k === 'text' ? 1500 : 300)
      if (!prev.list && list) prev.list = list
      continue
    }
    const row = {
      id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      platform: it.platform || platformOf(url), url,
      title: String(it.title || '').trim().slice(0, 300), text: String(it.text || '').trim().slice(0, 1500), thumb: it.thumb || '',
      list: it.list || list || '', listUrl, addedAt: new Date().toISOString(), status: 'new', ...(ik ? { imgKey: ik } : {}),
    }
    inbox.unshift(row); known.set(url, row); if (ik) known.set('img:' + ik, row); added++
  }
  saveInbox(inbox)
  // 유튜브 재생목록 화면에서 담았으면 그 재생목록을 자동 갱신 대상으로 기억(성준님: '벤치마킹 영상' 재생목록)
  const listId = (() => { try { return new URL(listUrl).searchParams.get('list') } catch { return null } })()
  if (listId && /youtube\.com/.test(listUrl) && !/^(WL|LL)$/.test(listId)) {
    const s = loadSources()
    if (!s.youtube.some((p) => p.list === listId)) { s.youtube.push({ list: listId, name: list || '' }); saveSources(s) }
  }
  return { added, total: items.length }
}

// ── 자동 갱신(로그인 없이 읽히는 것만) ───────────────────────────────────────
async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ko,en;q=0.8' }, redirect: 'follow' })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}
const rssItems = (x) => [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
  const g = (t) => (m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || ''
  const desc = g('description').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  return { link: g('link').trim(), title: g('title').trim(), img: (desc.match(/<img src="([^"]+)"/) || [])[1] || '', text: desc.replace(/<[^>]+>/g, '').trim(), date: g('pubDate').trim() }
})
const imgKey = (u) => (String(u).match(/\/([0-9a-f]{32})\.\w+$/) || [])[1] || ''

// 핀터레스트: 보드 RSS 의 핀 링크는 암호화형이라 상세(영상·출처)를 못 읽는다(2026-11-06 실측).
// 계정 피드 RSS 는 숫자형 링크라서, 같은 썸네일 이미지(파일명 해시)끼리 짝지어 숫자형 링크로 바꿔 담는다.
async function refreshPinterest(src, log) {
  const user = src.user
  let n = 0
  const feed = rssItems(await getText(`https://www.pinterest.com/${user}/feed.rss`))
  const byImg = new Map(feed.filter((f) => f.img).map((f) => [imgKey(f.img), f.link]))
  // 영상 핀은 RSS 에 썸네일이 없어 이미지로 못 짝짓는다 → 핀 생성 시각(pubDate, 피드·보드 RSS 에서 같음)으로 짝짓기
  const byDate = new Map(feed.filter((f) => f.date).map((f) => [f.date, f.link]))
  // 대상 보드만 — 보드 주소는 이름의 띄어쓰기를 '-'로 바꾼 것(예: 연출 기법 → /연출-기법/). 비밀 보드는 RSS 가 404 라 북마클릿으로만.
  const boards = (src.boards || []).map((b) => ({ name: b, slug: String(b).trim().replace(/\s+/g, '-') }))
  for (const b of boards) {
    try {
      const items = rssItems(await getText(`https://www.pinterest.com/${user}/${encodeURIComponent(b.slug)}.rss`))
      const rows = items.map((i) => ({ url: (i.img && byImg.get(imgKey(i.img))) || byDate.get(i.date) || i.link, title: i.title, text: i.text, thumb: i.img.replace('/236x/', '/564x/'), list: b.name, date: i.date }))
      n += ingest({ items: rows, list: b.name }).added
    } catch (e) { log(`  보드 ${b.name}: ${/404/.test(e.message) ? '공개 RSS 없음(비밀 보드면 📥 담기로)' : e.message}`) }
  }
  log(`  핀터레스트 ${user}: 대상 보드 ${boards.length}개, 새 항목 ${n}`)
  return n
}

// 유튜브 재생목록(공개·일부공개): 페이지의 ytInitialData 에서 영상 ID·제목(2026-11 기준 lockupViewModel 구조)
async function refreshYoutube(pl, log) {
  const h = await getText(`https://www.youtube.com/playlist?list=${pl.list}`)
  const m = h.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/)
  if (!m) throw new Error('재생목록 데이터 없음(비공개일 수 있음 — 일부공개로 바꿔 주세요)')
  const j = JSON.parse(m[1]); const rows = []
  const title = (h.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || pl.name || ''
  ;(function walk(o) {
    if (!o || typeof o !== 'object') return
    const lv = o.lockupViewModel
    if (lv?.contentId && lv.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
      rows.push({ url: `https://www.youtube.com/watch?v=${lv.contentId}`, title: lv.metadata?.lockupMetadataViewModel?.title?.content || '', thumb: `https://i.ytimg.com/vi/${lv.contentId}/hqdefault.jpg` }); return
    }
    const pv = o.playlistVideoRenderer
    if (pv?.videoId) { rows.push({ url: `https://www.youtube.com/watch?v=${pv.videoId}`, title: pv.title?.runs?.[0]?.text || '', thumb: `https://i.ytimg.com/vi/${pv.videoId}/hqdefault.jpg` }); return }
    for (const k in o) walk(o[k])
  })(j)
  const r = ingest({ items: rows, list: title, listUrl: `https://www.youtube.com/playlist?list=${pl.list}` })
  log(`  유튜브 재생목록 ${title}: ${rows.length}개 중 새 항목 ${r.added}`)
  return r.added
}

export async function refreshSources(log = () => {}) {
  const s = loadSources(); let n = 0
  for (const p of s.pinterest || []) { try { n += await refreshPinterest(p, log) } catch (e) { log(`  핀터레스트 실패: ${e.message}`) } }
  for (const p of s.youtube || []) {
    const title = (await playlistTitle(p.list)) || p.name
    if (!allowedPlaylist(title, s)) { log(`  유튜브 재생목록 ${title || p.list}: 대상 아님 — 건너뜀`); continue }
    try { n += await refreshYoutube({ ...p, name: title }, log) } catch (e) { log(`  유튜브 실패: ${e.message}`) }
  }
  return n
}

// ── 정리(Haiku) ───────────────────────────────────────────────────────────
// 정리 전에 로그인 없이 읽히는 본문을 보충한다: 유튜브 설명, 핀터레스트 숫자형 핀의 소개글·원본 출처.
async function enrichText(e) {
  try {
    if (e.platform === 'youtube') {
      const h = await getText(e.url)
      const d = (h.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/) || [])[1]
      if (d) e.text = JSON.parse(`"${d}"`).slice(0, 1500)
      if (!e.title) e.title = (h.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || ''
      e.author = (h.match(/"ownerChannelName":"([^"]*)"/) || [])[1] || e.author || ''
    } else if (e.platform === 'pinterest' && /\/pin\/\d+\//.test(e.url)) {
      const h = await getText(e.url)
      const meta = (k) => (h.match(new RegExp(`<meta[^>]*(?:property|name)="${k}"[^>]*content="([^"]*)"`)) || [])[1] || ''
      if (!e.text) e.text = meta('og:description')
      if (!e.title) e.title = meta('og:title')
      if (!e.thumb) e.thumb = meta('og:image')   // 영상 핀은 RSS 에 썸네일이 없는 경우가 많음(11/6 실측)
      e.source = meta('og:see_also') || e.source || ''
    }
  } catch { /* 본문 보충은 실패해도 정리는 계속 */ }
}

// 썸네일을 직접 받아 base64 로 넘긴다(인스타 CDN 처럼 Anthropic 쪽에서 URL 로 못 받는 이미지가 하나라도 있으면
// 배치 전체가 실패하므로 URL 방식은 안 씀). 실패하면 그 항목은 글만으로 정리.
async function imageBlock(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA } }); if (!r.ok) return null
    const type = (r.headers.get('content-type') || '').split(';')[0]
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 3.5e6) return null
    return { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } }
  } catch { return null }
}

async function askPlain(content) {
  const key = apiKey(); if (!key) throw new Error('Anthropic API 키 없음')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2500, messages: [{ role: 'user', content }] }),
  })
  const j = await r.json(); if (j.error) throw new Error(j.error.message)
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
}

const SEOYEORI = '서여리 = 20~40대 일상 공감을 다루는 AI 버추얼 인플루언서 채널(인스타 릴스·인스타툰, 유튜브 쇼츠/롱폼).'

let running = false
export async function processInbox({ log = () => {}, limit = 60 } = {}) {
  if (running) return { skipped: '이미 정리 중' }
  running = true
  try {
    const todo = loadInbox().filter((e) => e.status === 'new').slice(0, limit)
    if (!todo.length) return { processed: 0 }
    for (const e of todo) await enrichText(e)
    const done = new Map()
    for (let i = 0; i < todo.length; i += 8) {
      const batch = todo.slice(i, i + 8)
      // 글 + 썸네일 이미지를 항목별로 번갈아 넣는다(제목·설명 없는 이미지 핀이 많아서 — 11/6 실측 28개 중 다수)
      const content = [{ type: 'text', text: `${SEOYEORI}\n성준님(운영자)이 벤치마킹하려고 직접 저장한 자료들이다. 각각을 정리해줘. 항목마다 썸네일 이미지가 붙어 있으면 이미지를 직접 보고 판단해.\n\n${taxonomyPrompt()}` }]
      for (const [k, e] of batch.entries()) {
        content.push({ type: 'text', text: `[${k}] 플랫폼: ${e.platform} · 저장 목록: ${e.list || '-'}\n제목: ${e.title || '-'}\n본문: ${(e.text || '-').slice(0, 700)}` })
        const img = e.thumb ? await imageBlock(e.thumb) : null
        if (img) content.push(img)
      }
      const prompt = `규칙: 글·이미지에 없는 사실은 지어내지 말 것. 글이 없으면 이미지에 보이는 것만으로. 둘 다 없으면 summary 에 "정보 부족(직접 확인 필요)".\n` +
        `- summary: 무엇을 보여주는 콘텐츠인지 1~2문장(개요)\n- keywords: 검색 노출용으로 쓸 만한 한국어 키워드 3~6개\n` +
        `- usage/technique/detail: 위 분류표에서 고른 이름만(detail 은 2~8자 짧은 이름, 설명 문장 금지)\n- isTechnique: 연출·제작 기법으로 참고할 가치가 있으면 true(단순 정보·잡담이면 false)\n- idea: 서여리에 적용할 아이디어 한 줄\n` +
        `설명 없이 JSON 배열만: [{"i":0,"summary":"","keywords":[],"usage":"","technique":"","detail":"","isTechnique":true,"idea":""}]`
      try {
        content.push({ type: 'text', text: prompt })
        for (const r of parseArray(await askPlain(content))) {
          const e = batch[r.i]; if (!e) continue
          done.set(e.id, {
            title: e.title, text: e.text, thumb: e.thumb, author: e.author, source: e.source,
            summary: String(r.summary || '').slice(0, 240), keywords: (Array.isArray(r.keywords) ? r.keywords : []).map((k) => String(k).replace(/^#/, '').trim()).filter(Boolean).slice(0, 6),
            ...cleanClass(r), isTechnique: !!r.isTechnique, idea: String(r.idea || '').slice(0, 160),
          })
        }
        // AI 가 답을 안 준 항목도 '정보 부족'으로 닫는다 — 안 그러면 3시간마다 계속 다시 보내서 비용만 듦
        for (const e of batch) if (!done.has(e.id)) done.set(e.id, { title: e.title, text: e.text, thumb: e.thumb, summary: '정보 부족(직접 확인 필요)', keywords: [] })
        log(`  정리 ${i + 1}~${i + batch.length} 완료`)
      } catch (err) { log(`  정리 실패: ${err.message}`) }
    }
    // 네트워크 뒤에 다시 읽어서 반영(그 사이 북마클릿으로 담긴 것 보존)
    const inbox = loadInbox(); let n = 0
    for (const e of inbox) {
      const d = done.get(e.id); if (!d) continue
      Object.assign(e, d, { status: 'processed', processedAt: new Date().toISOString() }); n++
      // ③ 스토리 아카이브 연출기법 — 기법으로 쓸 만한 것만 자동 추가(태그 '자동수집'으로 구분)
      if (e.isTechnique && !e.storyId) {
        try {
          e.storyId = saveEntry({
            type: 'benchmark', title: (e.techDetail || e.technique || '기법') + ' — ' + (e.title || '').slice(0, 40),
            description: [e.summary, e.idea && `적용: ${e.idea}`].filter(Boolean).join(' / '),
            source: e.url, tags: ['자동수집', e.platform, e.usage, e.technique, e.techDetail].filter(Boolean),
          }).id
        } catch { /* 아카이브 실패는 수집함 정리를 막지 않음 */ }
      }
    }
    saveInbox(inbox)
    return { processed: n }
  } finally { running = false }
}

// 갱신 + 정리 한 번에(버튼·bat·3시간 틱 공통)
export async function runCollect({ log = () => {}, refresh = true } = {}) {
  const fresh = refresh ? await refreshSources(log) : 0
  const r = await processInbox({ log })
  const at = new Date().toISOString(); writeJson(path.join(DIR, 'last-run.json'), { at, fresh, ...r })
  return { at, fresh, ...r }
}

// ① 퍼블리싱 탭 키워드 후보 — 많이 나온 순. 인스타·유튜브 벤치마킹 자료에서만 뽑는다:
// 핀터레스트 보드는 연출 레퍼런스(건축·모션그래픽 등)라 "현대건축·미니멀" 같은 말이 나와 채널 검색 키워드로 안 맞음(11/6 실측).
export function keywordCandidates() {
  const c = new Map()
  for (const e of loadInbox()) if (e.platform === 'instagram' || e.platform === 'youtube') for (const k of e.keywords || []) c.set(k, (c.get(k) || 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([word, count]) => ({ word, count }))
}

export function setItem(id, patch) {
  const inbox = loadInbox(); const e = inbox.find((x) => x.id === id); if (!e) return null
  Object.assign(e, patch); saveInbox(inbox); return e
}

export function collectStatus() {
  return { last: readJson(path.join(DIR, 'last-run.json'), null), sources: loadSources(), counts: loadInbox().reduce((a, e) => (a[e.status] = (a[e.status] || 0) + 1, a), {}) }
}

// 📥 북마클릿 — 화면에 보이는 목록을 담아 localhost 로 넘긴다. 인스타·핀터레스트는 CSP 때문에 페이지에서 localhost 로
// fetch 를 못 하므로, 새 창(#해시에 실어서 — 해시는 네트워크로 안 나감)으로 넘기고 그 창이 같은 출처로 POST 한다.
// 단일 게시물/핀/영상 화면에선 그 하나만, 목록 화면에선 보이는 항목 전부. 끝까지 스크롤한 뒤 누르면 다 담긴다.
// 유튜브 목록은 영상 하나에 링크가 여러 개(썸네일=재생시간, "모두 재생" 버튼 등)라서 영상별로 가장 긴 진짜 제목을 고른다(11/6 실측).
// 주의: javascript: 주소는 실행 전에 % 디코딩되고 # 이 끊길 수 있어서 코드 안에 % 와 # 글자를 쓰지 않는다(# → fromCharCode(35)).
export const BOOKMARKLET = `javascript:(()=>{const H=location.hostname,U=location.href,P=location.pathname,o=[],s=new Set(),M=k=>(document.querySelector('meta[property="'+k+'"]')||{}).content||'';const a=(u,t,x,i)=>{if(!u||s.has(u))return;s.add(u);o.push({url:u,title:(t||'').trim().slice(0,300),text:(x||'').trim().slice(0,500),thumb:i||''})};const one=()=>a(U,M('og:title')||document.title,M('og:description'),M('og:image'));let L=document.title;if(/instagram\\.com/.test(H)){if(/\\/(p|reel|reels|tv)\\//.test(P))one();else document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]').forEach(e=>{const i=e.querySelector('img');a(new URL(e.getAttribute('href'),U).href.split('?')[0],'',i&&i.alt,i&&i.src)});L=(document.querySelector('h1,h2')||{}).textContent||L}else if(/pinterest\\./.test(H)){if(/\\/pin\\//.test(P))one();else document.querySelectorAll('[data-test-id="pin"] a[href*="/pin/"],[data-grid-item] a[href*="/pin/"]').forEach(e=>{const m=e.href.match(/\\/pin\\/(\\d+)/);if(!m)return;const i=e.querySelector('img')||e.closest('[data-grid-item]')?.querySelector('img');a('https://www.pinterest.com/pin/'+m[1]+'/',i&&i.alt,'',i&&i.src)});L=(document.querySelector('h1')||{}).textContent||L}else if(/youtube\\.com/.test(H)){if(P==='/watch'||/^\\/shorts\\//.test(P))one();else{const T={};document.querySelectorAll('a[href*="/watch?v="],a[href*="/shorts/"]').forEach(e=>{const m=e.href.match(/[?&]v=([\\w-]{11})|shorts\\/([\\w-]{11})/);if(!m)return;const v=m[1]||m[2];let t=(e.textContent||e.getAttribute('title')||'').trim().replace(/\\s+/g,' ');if(/^\\d+:\\d+|재생$|^Play|^Shuffle/.test(t))t='';if(!(v in T)||t.length>T[v].length)T[v]=t});for(const v in T)if(T[v])a('https://www.youtube.com/watch?v='+v,T[v],'','https://i.ytimg.com/vi/'+v+'/hqdefault.jpg')}L=M('og:title')||L}else one();L=(L||'').replace(/^\\(\\d+\\)\\s*/,'').replace(/ - YouTube$/,'');if(!o.length){alert('담을 항목을 못 찾았습니다');return}window.open('http://localhost:3001/collect-in'+String.fromCharCode(35)+encodeURIComponent(JSON.stringify({list:(L||'').trim().slice(0,80),listUrl:U,items:o})),'_blank')})()`
