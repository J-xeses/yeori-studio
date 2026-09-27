// ── 서여리 감정이입 시스템 P1·P2 (2026-09-27, 설계 app/docs/yeori-empathy-system.md) ──────────
// P1 checkScriptVoice: 대본이 감성 코어를 따르는지(여운 엔딩·시청자 대상 존댓말·말버릇 과다) — 규칙, 토큰 0
// P2 computeMood: 날씨·날짜·기념일·채널 성과·최근 게시물 → 오늘의 여리(mood·mask·energy·topic·callback·캡션 한 줄) — 규칙, 토큰 0
import fs from 'node:fs'
import * as mp from './mediaPaths.js'
import { loadOps } from './instaOps.js'

const persona = () => { try { return JSON.parse(fs.readFileSync(mp.charactersJsonPath(), 'utf-8')).yeori?.persona || {} } catch { return {} } }

// ── P1 대본 점검 ──
const POLITE_END = /(요|니다|니까|죠|세요|까요|래요|네요|군요|어요|아요|해요|예요|에요)[.!?~…"”\s]*$/
export function checkScriptVoice(cuts) {
  const warns = []
  const yeoriCuts = (cuts || []).filter(c => c.cutType === 'YEORI' || !c.cutType)
  const last = yeoriCuts[yeoriCuts.length - 1]
  if (last) {
    const beats = String(last.videoPrompt || '').split('\n').filter(l => /^\[\d/.test(l.trim()))
    const tail = beats[beats.length - 1] || ''
    if (/says?|speaks?|"[^"]*[가-힣]/.test(tail)) warns.push(`여운 엔딩 없음 — 마지막 컷 ${last.no} 의 마지막 구간이 대사로 끝남(대사 뒤 2~3초 침묵·시선·소품 권장)`)
  }
  const habits = persona().speech?.habits || ['음…', '그러니까…', '근데 있잖아요']
  for (const c of cuts || []) {
    const dl = String(c.dialogue || '')
    if (!dl) continue
    const yeoriParts = dl.split(/\s\/\s/).filter(x => !/^(지아|지유|한지아)\b/.test(x.trim()))
    const vpText = `${c.videoPrompt || ''} ${c.action || ''}`
    // 혼잣말("to herself", "not to the camera")은 시청자 대상이 아님 — IG_R05 컷3 오탐(9/27)
    const toViewer = /to the camera|viewer|카메라 보며|카메라를 보며/i.test(vpText) && !/to herself|not to the camera|혼잣말/i.test(vpText)
    const friendScene = /지아|지유|JY|HJ/.test(String(c.masterCode?.ch || ''))
    for (const part of yeoriParts) {
      const line = part.replace(/^(여리|서여리)\s*/, '').replace(/^["“]|["”]$/g, '').trim()
      const lastSentence = line.split(/(?<=[.!?])\s+/).filter(Boolean).pop() || line
      if (toViewer && !friendScene && lastSentence && !POLITE_END.test(lastSentence)) warns.push(`컷 ${c.no}: 시청자에게 하는 말인데 존댓말이 아님 — "${lastSentence}"`)
      const n = habits.filter(h => line.includes(h.replace('…', ''))).length
      if (n > 1) warns.push(`컷 ${c.no}: 말버릇 ${n}개 — 한 번에 1개까지`)
    }
  }
  return warns
}

// ── P2 오늘의 여리 ──
const HOLIDAYS = { '01-01': '새해', '02-14': '밸런타인데이', '03-14': '화이트데이', '05-05': '어린이날', '10-09': '한글날', '10-31': '할로윈', '11-11': '빼빼로데이', '12-24': '크리스마스이브', '12-25': '크리스마스', '12-31': '한 해의 마지막 날' }
const WMO = (code) => code == null ? null : code >= 71 && code <= 77 ? '눈' : (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95 ? '비' : code >= 45 && code <= 48 ? '안개' : code >= 2 ? '흐림' : '맑음'

async function weatherSeoul() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000)
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m,weather_code&timezone=Asia%2FSeoul', { signal: ctl.signal })
    clearTimeout(t)
    const j = await r.json()
    return { sky: WMO(j.current?.weather_code), temp: j.current?.temperature_2m }
  } catch { return { sky: null, temp: null } }
}

const CAPTION = {
  차분: '음… 오늘은 조용히 있고 싶은 날이었어요.',
  쓸쓸: '근데 있잖아요, 이런 밤엔 괜히 누가 보고 싶더라고요.',
  설렘: '오늘은 왠지 좋은 일이 생길 것 같은 날이에요.',
  뿌듯: '그러니까… 여기까지 와 주셔서, 진짜 고마워요.',
  장난: '솔직히 말할게요. 오늘도 계획대로 된 건 하나도 없어요.',
  지침: '오늘은 좀 지쳤어요. 그래도 여기 오면 괜찮아지더라고요.',
}

export async function computeMood({ now = new Date() } = {}) {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const mmdd = `${String(kst.getMonth() + 1).padStart(2, '0')}-${String(kst.getDate()).padStart(2, '0')}`
  const wd = kst.getDay(), hour = kst.getHours()
  const reasons = []
  let mood = '차분', mask = 0.6, energy = 0.5, topic = ''
  const w = await weatherSeoul()
  if (w.sky === '비') { mood = '차분'; mask = 0.3; energy = 0.4; topic = '비 오는 날 창가'; reasons.push('서울 비') }
  else if (w.sky === '눈') { mood = '설렘'; mask = 0.4; energy = 0.7; topic = '눈 오는 날'; reasons.push('서울 눈') }
  else if (w.sky === '맑음' && (wd === 0 || wd === 6)) { mood = '설렘'; energy = 0.7; topic = '맑은 주말'; reasons.push('맑은 주말') }
  if (wd === 5 && hour >= 20) { mood = '쓸쓸'; mask = 0.2; energy = 0.3; topic = '금요일 밤'; reasons.push('금요일 밤') }
  if (wd === 1 && hour < 12) { mood = '지침'; energy = 0.3; topic = '월요일 아침'; reasons.push('월요일') }
  if (HOLIDAYS[mmdd]) { topic = HOLIDAYS[mmdd]; mood = mood === '쓸쓸' ? '쓸쓸' : '설렘'; reasons.push(HOLIDAYS[mmdd]) }
  if (hour >= 22 || hour < 5) { mask = Math.min(mask, 0.3); reasons.push('밤 — 가면 내려놓음') }

  // 채널 신호(운영실 ops.json — 인스타 자동 수집 결과)
  let callback = null
  try {
    const ops = loadOps()
    const fl = (ops.followersLog || []).filter(x => Number.isFinite(x.followers))
    const cur = fl[fl.length - 1]?.followers
    const dayAgo = fl.filter(x => Date.parse(x.at) <= Date.now() - 20 * 3600e3).pop()?.followers
    if (cur != null && dayAgo != null && cur > dayAgo) { mood = '뿌듯'; energy = Math.max(energy, 0.7); reasons.push(`팔로워 ${dayAgo}→${cur}`) }
    if (cur >= 1 && (dayAgo == null || dayAgo === 0) && cur <= 3) { topic = topic || '첫 팔로워'; reasons.push('첫 팔로워') }
    const posted = (ops.posts || []).filter(p => p.status === '게시').sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const hit = posted.find(p => (p.metrics?.shares || 0) + (p.metrics?.saves || 0) >= 3)
    if (hit) { mood = '뿌듯'; reasons.push(`"${hit.title}" 저장·공유 ${(hit.metrics.shares || 0) + (hit.metrics.saves || 0)}`) }
    if (posted[0]) callback = `지난 게시물 "${posted[0].title}" 이야기를 이어서`
  } catch { /* ops 없음 */ }

  const state = {
    date: kst.toISOString().slice(0, 10), at: new Date().toISOString(),
    mood, mask: +mask.toFixed(1), energy: +energy.toFixed(1), topic: topic || '평범한 하루', callback,
    weather: w, reasons,
    face: mask <= 0.35 ? '카메라 밖 — 진짜 여리(차분·진심)' : '카메라 앞 — 밝은 크리에이터 모드',
    captionLine: CAPTION[mood] || CAPTION.차분,
    storyIdea: `${topic || '오늘'} × ${mood} — ${mask <= 0.35 ? '혼잣말처럼 낮은 톤 한 컷' : '밝게 인사하고 마지막에 살짝 속마음'}`,
  }
  const p = mp.statePath('yeori-mood.json')
  let hist = []
  try { hist = JSON.parse(fs.readFileSync(p, 'utf-8')).history || [] } catch { /* 처음 */ }
  hist = [...hist.filter(h => h.date !== state.date), { date: state.date, mood, mask: state.mask, topic: state.topic }].slice(-30)
  fs.writeFileSync(p, JSON.stringify({ current: state, history: hist }, null, 2))
  return state
}
