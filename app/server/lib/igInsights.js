// ── 인스타 성과 자동 수집(Instagram API with Instagram Login, graph.instagram.com) — 2026-09-26 ──
// 토큰: app/studio-secrets.json → apiKeys.instagram = { token, userId? }  (장기 토큰 60일, 여기서 자동 갱신)
// 하는 일: 내 게시물 목록 → 운영실 게시물과 연결(링크 shortcode, 없으면 날짜) → 상태 '게시'·링크 채움 →
//          게시물 인사이트(도달·조회·좋아요·댓글·공유·저장·프로필방문·팔로우·평균시청) → post.metrics + 시점별 기록(metricsLog)
// LLM 호출 없음(토큰 0). 프록시가 기동 시 + 6시간마다 호출.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOps, saveOps } from './instaOps.js'

const SECRETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'studio-secrets.json')
const G = 'https://graph.instagram.com'
const readSecrets = () => { try { return JSON.parse(fs.readFileSync(SECRETS, 'utf-8')) } catch { return {} } }
export const igConfigured = () => !!readSecrets().apiKeys?.instagram?.token

async function gget(url) {
  const r = await fetch(url); const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`)
  return j
}

// 장기 토큰 갱신(발급 24시간 이후~만료 전). 7일에 한 번만 시도.
async function maybeRefresh(sec) {
  const ig = sec.apiKeys.instagram
  if (ig.refreshedAt && Date.now() - Date.parse(ig.refreshedAt) < 7 * 864e5) return ig.token
  try {
    const j = await gget(`${G}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(ig.token)}`)
    ig.token = j.access_token; ig.refreshedAt = new Date().toISOString(); ig.expiresIn = j.expires_in
    fs.writeFileSync(SECRETS, JSON.stringify(sec, null, 2))
  } catch { /* 발급 직후(24h 미만)면 실패 — 다음 주기에 재시도 */ }
  return ig.token
}

// 게시물 종류별로 지원 지표가 달라, 묶음 요청 실패 시 하나씩 받아 되는 것만 모은다.
async function mediaInsights(id, type, token) {
  const base = ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions']
  const want = type === 'VIDEO' || type === 'REELS' ? [...base, 'ig_reels_avg_watch_time'] : [...base, 'profile_visits', 'follows']
  const toObj = (data) => Object.fromEntries((data || []).map(m => [m.name, m.values?.[0]?.value ?? m.total_value?.value]))
  try { return toObj((await gget(`${G}/${id}/insights?metric=${want.join(',')}&access_token=${token}`)).data) } catch {
    const out = {}
    for (const m of want) { try { Object.assign(out, toObj((await gget(`${G}/${id}/insights?metric=${m}&access_token=${token}`)).data)) } catch { /* 미지원 지표 */ } }
    return out
  }
}

export async function syncInsights({ log = () => {} } = {}) {
  const sec = readSecrets()
  if (!sec.apiKeys?.instagram?.token) return { ok: false, skipped: '인스타 토큰 없음(studio-secrets.json apiKeys.instagram.token)' }
  const token = await maybeRefresh(sec)
  const me = await gget(`${G}/me?fields=user_id,username,followers_count,follows_count,media_count&access_token=${token}`)
  const media = (await gget(`${G}/me/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=50&access_token=${token}`)).data || []
  const ops = loadOps()
  const now = new Date().toISOString()
  const short = (u) => (String(u || '').match(/\/(?:p|reel)\/([^/?#]+)/) || [])[1]
  let linked = 0, updated = 0
  for (const m of media) {
    const code = short(m.permalink)
    const day = m.timestamp?.slice(0, 10)
    let post = ops.posts.find(p => short(p.link) === code)
    if (!post) post = ops.posts.find(p => !p.link && p.date === day && ['완성', '예약', '제작중'].includes(p.status))
    if (!post) continue
    if (!post.link) { post.link = m.permalink; linked++ }
    if (post.status !== '게시') post.status = '게시'
    const type = m.media_product_type === 'REELS' ? 'REELS' : m.media_type
    const ins = await mediaInsights(m.id, type, token)
    const metrics = {
      reach: ins.reach ?? null, views: ins.views ?? null, likes: ins.likes ?? m.like_count ?? null, comments: ins.comments ?? m.comments_count ?? null,
      shares: ins.shares ?? null, saves: ins.saved ?? null, visits: ins.profile_visits ?? null, follows: ins.follows ?? null,
      avgWatch: ins.ig_reels_avg_watch_time != null ? +(ins.ig_reels_avg_watch_time / 1000).toFixed(1) : null,
    }
    post.metrics = { ...(post.metrics || {}), ...Object.fromEntries(Object.entries(metrics).filter(([, v]) => v != null)) }
    const ageH = Math.round((Date.now() - Date.parse(m.timestamp)) / 36e5)
    ;(post.metricsLog ||= []).push({ at: now, ageH, ...metrics })
    post.metricsLog = post.metricsLog.slice(-40)
    updated++
  }
  ops.account = { ...(ops.account || {}), username: me.username, followers: me.followers_count, following: me.follows_count, mediaCount: me.media_count, syncedAt: now }
  ;(ops.followersLog ||= []).push({ at: now, followers: me.followers_count })
  ops.followersLog = ops.followersLog.slice(-200)
  saveOps({ ...ops })
  log(`인스타 성과 동기화: 팔로워 ${me.followers_count} · 게시물 ${media.length} · 연결 ${linked} · 지표 갱신 ${updated}`)
  return { ok: true, followers: me.followers_count, media: media.length, linked, updated }
}
