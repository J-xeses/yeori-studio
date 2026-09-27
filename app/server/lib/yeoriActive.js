// ── 서여리 감정이입 시스템 P3·P4·P5 (2026-09-27, 설계 app/docs/yeori-empathy-system.md) ─────────────
// P3 캡션·스토리 초안: 트리거(새 게시·팔로워 이정표·저장/공유 급증) → 초안 큐
// P4 댓글 답장: 인스타 댓글(공식 API) → 답장 초안 → 사람 승인 → 게시(POST /{comment-id}/replies)
// P5 연속성: 에피소드 사건 원장(yeori-events.json) → 콜백 제안
// 원칙: 게시·답장은 항상 사람 승인 후. 초안 문장은 템플릿(토큰 0)이 기본, LLM(Haiku)은 하루 상한 안에서만(LLM_DAILY_CAP).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mp from './mediaPaths.js'
import { loadOps, saveOps } from './instaOps.js'

const LLM_DAILY_CAP = 10
const SECRETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'studio-secrets.json')
const persona = () => { try { return JSON.parse(fs.readFileSync(mp.charactersJsonPath(), 'utf-8')).yeori?.persona || {} } catch { return {} } }
const mood = () => { try { return JSON.parse(fs.readFileSync(mp.statePath('yeori-mood.json'), 'utf-8')).current || {} } catch { return {} } }
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return d } }
const isEnglish = (t) => { const s = String(t || ''); const lat = (s.match(/[A-Za-z]/g) || []).length, ko = (s.match(/[가-힣]/g) || []).length; return lat > 3 && lat > ko * 2 }
export const replyMode = (t) => RISKY.test(String(t || '')) ? '무대응' : isEnglish(t) ? 'en' : 'ko'   // 안전선·언어 판정(selftest 대상)
// 악플·링크·연락 유도 + 홍보 봇 전형 문구("Share me this post", "promote", "collab", "DM us") — 9/27 티저② 봇 댓글
const RISKY = /(씨발|병신|꺼져|죽어|fuck|shit|bitch|http[s]?:\/\/|카톡|오픈채팅|DM\s*주세요|번호\s*알려|share\s+(me\s+)?(this|your)\s+post|promot(e|ion)|collab|send\s+(us\s+)?(a\s+)?dm|dm\s+(us|me)|check\s+(my|our)\s+(bio|page)|brand\s+ambassador)/i

// ── LLM(선택, 하루 상한) ──
async function llm(prompt) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY
  if (!key) return null
  const up = mp.statePath('yeori-llm-usage.json'); const today = new Date().toLocaleDateString('sv-SE')
  const u = readJson(up, {}); if (u.date !== today) { u.date = today; u.count = 0 }
  if (u.count >= LLM_DAILY_CAP) return null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json(); const text = j.content?.[0]?.text?.trim()
    if (text) { u.count++; fs.writeFileSync(up, JSON.stringify(u)) }
    return text || null
  } catch { return null }
}
function voiceBrief() {
  const p = persona(), m = mood()
  return `너는 AI 크리에이터 "서여리"(20대 초반, 막 시작한 채널, AI임을 숨기지 않음)다. 시청자에게는 존댓말, 영어 댓글에는 영어로. ` +
    `말버릇은 한 번에 1개까지(${(p.speech?.habits || []).join(', ')}). 과한 친밀감·연애 암시·개인 연락 유도 금지. ` +
    `오늘의 기분: ${m.mood || '차분'}(${m.face || ''}), 주제: ${m.topic || ''}. 한두 문장, 이모지는 0~1개. 결과 문장만 출력.`
}

// ── 큐 ──
function pushDraft(ops, d) {
  ops.yeoriQueue ||= []
  if (ops.yeoriQueue.some(x => x.key === d.key)) return false          // 같은 트리거 중복 방지
  ops.yeoriQueue.push({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, status: '대기', createdAt: new Date().toISOString(), ...d })
  ops.yeoriQueue = ops.yeoriQueue.slice(-100)
  return true
}
// LLM 호출 동안 운영실에서 저장됐을 수 있으니(rev 409) 저장 직전에 최신본을 다시 읽어 초안만 얹는다
function commitDrafts(drafts) {
  if (!drafts.length) return 0
  const ops = loadOps(); let n = 0
  for (const d of drafts) if (pushDraft(ops, d)) n++
  if (n) saveOps({ ...ops })
  return n
}

// ── P5 사건 원장 ──
const EVENTS = () => mp.statePath('yeori-events.json')
export function recordEpisodeEvent({ code, title, cuts }) {
  const ev = readJson(EVENTS(), [])
  const moments = (cuts || []).map(c => String(c.subtitle || '').split('/')[0].trim()).filter(Boolean).slice(0, 4)
  const ALIAS = { JY: '지유', HJ: '지아', JA: '지아' }   // CH 코드(JY_VD 등) → 이름
  const people = [...new Set((cuts || []).flatMap(c => `${JSON.stringify(c.masterCode || '')} ${c.dialogue || ''}`.match(/지아|지유|엄마|아빠|(JY|HJ|JA)_/g) || []).map(x => ALIAS[x.replace('_', '')] || x))]
  const rest = ev.filter(e => e.code !== code)
  rest.push({ code, title, moments, people, at: new Date().toISOString() })
  fs.writeFileSync(EVENTS(), JSON.stringify(rest.slice(-60), null, 2))
}
export function suggestCallbacks(limit = 3) {
  return readJson(EVENTS(), []).slice(-6).reverse().slice(0, limit).map(e =>
    e.people?.length ? `"${e.title}" 이후 — ${e.people.join('·')}와(과) 이어지는 에피소드(예: 그때 그 일 그 후)` : `"${e.title}" 그 후 이야기 — "${e.moments?.[0] || ''}"를 다시 꺼내 보기`)
}

// ── P3 트리거 → 캡션·스토리 초안 ──
const TPL = {
  newPost: (t) => `음… "${t}" 올렸어요. 오늘 제 기분이랑 제일 닮은 영상이에요.`,
  follower: (n) => `그러니까… 벌써 ${n}분이나 와 주셨어요. 진짜로요? 고마워요.`,
  spike: (t) => `"${t}"를 저장해 주신 분들, 저 그거 다 봤어요. 근데 있잖아요, 진짜 힘이 돼요.`,
}
async function draftLine(kind, arg, ctx) {
  const tpl = TPL[kind](arg)
  const g = await llm(`${voiceBrief()}\n상황: ${ctx}\n예시 톤: ${tpl}\n서여리가 인스타 ${kind === 'follower' ? '스토리' : '캡션 끝'}에 쓸 한 줄:`)
  return { text: g || tpl, by: g ? 'LLM(Haiku)' : '템플릿' }
}
export async function runTriggers() {
  const ops = loadOps(); const out = []
  const has = (k) => (ops.yeoriQueue || []).some(x => x.key === k) || out.some(x => x.key === k)
  for (const p of (ops.posts || []).filter(x => x.status === '게시')) {
    if (!(p.metricsLog || []).length) continue
    const k = `newPost:${p.id}`
    if (!has(k)) out.push({ key: k, kind: 'caption', trigger: `게시: ${p.title}`, postId: p.id, ...await draftLine('newPost', p.title, `방금 "${p.title}" 게시물이 올라감`) })
    const ss = (p.metrics?.shares || 0) + (p.metrics?.saves || 0)
    const sk = `spike:${p.id}:${Math.floor(ss / 3)}`
    if (ss >= 3 && !has(sk)) out.push({ key: sk, kind: 'story', trigger: `저장·공유 ${ss}`, postId: p.id, ...await draftLine('spike', p.title, `"${p.title}" 저장·공유가 ${ss}회`) })
  }
  const f = ops.account?.followers
  for (const n of [1, 5, 10, 30, 50, 100, 300, 500, 1000]) {
    if (f >= n) {
      const k = `follower:${n}`
      if (!has(k)) out.push({ key: k, kind: 'story', trigger: `팔로워 ${n}명`, ...await draftLine('follower', n, `팔로워가 ${n}명이 됨`) })
    }
  }
  return commitDrafts(out)
}

// ── P4 댓글 → 답장 초안 ──
const G = 'https://graph.instagram.com'
const token = () => readJson(SECRETS, {}).apiKeys?.instagram?.token
export async function pullComments() {
  const tk = token(); if (!tk) return { skipped: '인스타 토큰 없음' }
  const ops = loadOps(); const out = []; let seen = 0, hidden = 0
  const me = (await (await fetch(`${G}/me?fields=username&access_token=${tk}`)).json()).username
  const media = (await (await fetch(`${G}/me/media?fields=id,permalink,caption,comments_count&limit=25&access_token=${tk}`)).json()).data || []
  for (const m of media) {
    const r = await (await fetch(`${G}/${m.id}/comments?fields=id,text,username,from{id,username},timestamp,replies{username,from{username}}&access_token=${tk}`)).json()
    if (r.error) return { error: r.error.message }
    // 댓글 수는 있는데 목록이 비면 = Meta 앱 개발 모드(역할 없는 사람 댓글 숨김) — 9/27 티저② 댓글 2개가 안 보였던 원인
    hidden += Math.max(0, (m.comments_count || 0) - (r.data || []).length)
    for (const c of r.data || []) {
      seen++
      c.username = c.username || c.from?.username || '알 수 없음'   // Instagram Login API 는 from{username} 으로 줌(9/27 @undefined)
      for (const x of c.replies?.data || []) x.username = x.username || x.from?.username
      if (c.username === me || (c.replies?.data || []).some(x => x.username === me)) continue
      const k = `reply:${c.id}`
      if ((ops.yeoriQueue || []).some(x => x.key === k)) continue
      if (RISKY.test(c.text)) { out.push({ key: k, kind: 'reply', trigger: `댓글 @${c.username}`, commentId: c.id, comment: c.text, text: '', status: '무대응', by: '안전선' }); continue }
      const en = isEnglish(c.text)
      const tpl = en ? 'Thank you so much for watching! It really means a lot to me.' : '와… 봐 주셔서 고마워요. 근데 있잖아요, 이런 댓글 하나에 하루가 괜찮아져요.'
      const g = await llm(`${voiceBrief()}\n게시물 캡션(맥락): "${String(m.caption || '').slice(0, 400)}"\n참고: "여리 스튜디오(Yeori Studio)"는 실제 공간이 아니라 서여리가 AI로 콘텐츠를 만드는 채널 브랜드다. 모르는 사실은 지어내지 말 것.\n댓글(@${c.username}): "${c.text}"\n${en ? 'Reply in natural English, 1-2 sentences.' : '서여리의 답장(존댓말, 1~2문장):'}`)
      out.push({ key: k, kind: 'reply', trigger: `댓글 @${c.username}`, commentId: c.id, comment: c.text, postLink: m.permalink, text: g || tpl, by: g ? 'LLM(Haiku)' : '템플릿' })
    }
  }
  const res = { comments: seen, drafts: commitDrafts(out), hidden }
  try { fs.writeFileSync(mp.statePath('yeori-comments-last.json'), JSON.stringify({ at: new Date().toISOString(), ...res })) } catch { /* 표시용 */ }
  return res
}

// ── 승인/반려 — 답장은 승인 시 실제 게시 ──
export async function decide(id, action, editedText) {
  const q0 = (loadOps().yeoriQueue || []).find(x => x.id === id)
  if (!q0) throw new Error('초안 없음')
  if (q0.status !== '대기') throw new Error(`이미 처리됨(${q0.status})`)   // 답글 이중 게시 방지
  const text = editedText != null ? String(editedText) : q0.text
  const patch = { text, decidedAt: new Date().toISOString() }
  if (action === 'reject') patch.status = '반려'
  else if (q0.kind === 'reply') {
    const tk = token(); if (!tk) throw new Error('인스타 토큰 없음')
    const r = await (await fetch(`${G}/${q0.commentId}/replies?message=${encodeURIComponent(text)}&access_token=${tk}`, { method: 'POST' })).json()
    if (r.error) throw new Error(`답장 게시 실패: ${r.error.message}`)
    patch.replyId = r.id; patch.status = '게시됨'
  } else patch.status = '승인(직접 게시)'
  const ops = loadOps(); const q = ops.yeoriQueue.find(x => x.id === id)   // 게시 뒤 최신본에 반영(rev 충돌 방지)
  Object.assign(q, patch); saveOps({ ...ops })
  return q
}

export async function runAll() {
  const triggers = await runTriggers().catch(e => ({ error: e.message }))
  const comments = await pullComments().catch(e => ({ error: e.message }))
  return { triggers, comments, callbacks: suggestCallbacks() }
}
