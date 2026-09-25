// ── BGM 자동 선택(2026-09-25) ────────────────────────────────────────
// 배경: 라이브러리 곡이 하위 폴더(BGM_HOOK/)에 있고 reelFinalize 는 bgm/ 최상위만 봐서 BGM 이 한 번도 자동으로 붙지 않았다.
// 흐름: 대본 BGM 문구(헤더 + 컷별) → 분위기 태그 → 라이브러리(index.json) 태그 점수 → 맞는 곡 없으면 ElevenLabs 음악 생성
//       (에피소드 길이 맞춤, 라이브러리에 태그와 함께 등록 → 재사용). 생성은 유료라 호출부가 allowGenerate 로 허용할 때만.
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

// 한국어/영어 BGM 표현 → 태그 (위에서부터, 여러 개 동시 매칭)
export const MOOD_RULES = [
  ['lofi', /로파이|lo-?fi|lofi/i],
  ['piano', /피아노|piano|rhodes/i],
  ['acoustic', /어쿠스틱|acoustic|통기타|기타\b|guitar/i],
  ['calm', /잔잔|차분|조용|느린|낮게|calm|chill|soft|mellow/i],
  ['bright', /밝|경쾌|통통|발랄|산뜻|bright|cheer|playful/i],
  ['warm', /따뜻|포근|warm|cozy/i],
  ['dreamy', /감성|몽환|아련|dreamy|emotional|sentimental/i],
  ['tension', /긴장|서스펜스|불안|tension|suspense/i],
  ['night', /밤|새벽|night|late/i],
  ['upbeat', /신나|업비트|에너지|펑키|upbeat|energetic|hook|훅/i],
  ['electronic', /일렉|전자|synth|electronic|edm/i],
]
const TAG_PROMPT = {
  lofi: 'lo-fi', piano: 'soft felt piano and warm Rhodes', acoustic: 'gentle acoustic guitar', calm: 'calm and mellow',
  bright: 'bright and light, playful bounce', warm: 'warm and cozy', dreamy: 'dreamy, emotional pads', tension: 'subtle suspense',
  night: 'late-night mood', upbeat: 'upbeat and energetic', electronic: 'light electronic synths',
}

export function tagsFromText(text) {
  const t = String(text || '')
  return MOOD_RULES.filter(([, re]) => re.test(t)).map(([tag]) => tag)
}

// 에피소드 BGM 요약: 헤더 BGM 문구 + 컷별 masterCode.audio.bgm (연출 지시 "끊김/재진입"은 태그에서 제외)
export function episodeBgmBrief(cuts, headerBgm = '') {
  const lines = [headerBgm, ...(cuts || []).map(c => c?.masterCode?.audio?.bgm || '')].map(s => String(s || '').trim()).filter(Boolean)
  const wants = lines.some(l => !/^(없음|-|n\/?a)\s*(\(|$)/i.test(l))
  const moodText = lines.join(' / ').replace(/CUT\s*\d+\s*이어서|이어서|끊김|재진입|멈춤|볼륨[^,/→]*/g, ' ')
  return { wants, text: lines.join(' / '), tags: [...new Set(tagsFromText(moodText))] }
}

function readIndex() {
  try { return JSON.parse(fs.readFileSync(mp.bgmDir('index.json'), 'utf-8')) } catch { return [] }
}
function writeIndex(list) { fs.writeFileSync(mp.bgmDir('index.json'), JSON.stringify(list, null, 2), 'utf-8') }
const trackTags = (t) => Array.isArray(t.tags) && t.tags.length ? t.tags : tagsFromText(`${t.title || ''} ${t.mood || ''} ${t.prompt || ''}`)
const USAGE = () => mp.statePath('bgm-usage.json')
function readUsage() { try { return JSON.parse(fs.readFileSync(USAGE(), 'utf-8')) } catch { return [] } }

// 라이브러리 후보 점수: 태그 겹침(장르·악기 가중 2, 분위기 1) − 최근 사용 감점. 겹침 0 이면 후보 아님.
export function rankLibrary(tags, { excludeCode } = {}) {
  const idx = readIndex().filter(t => t.file && !t.disabled && fs.existsSync(mp.bgmFile(t.file.replace(/^bgm\//, ''))))
  const recent = readUsage().filter(u => u.code !== excludeCode).slice(-5).map(u => u.file)
  const HEAVY = new Set(['lofi', 'piano', 'acoustic', 'electronic'])
  return idx.map(t => {
    const tt = trackTags(t)
    const overlap = tags.filter(x => tt.includes(x))
    const score = overlap.reduce((s, x) => s + (HEAVY.has(x) ? 2 : 1), 0) - (recent.includes(t.file) ? 1.5 : 0)
    return { track: t, tags: tt, overlap, score }
  }).filter(r => r.overlap.length).sort((a, b) => b.score - a.score)
}

export function buildMusicPrompt(tags, briefText) {
  const parts = tags.map(t => TAG_PROMPT[t]).filter(Boolean)
  return `Instrumental background music for a short vertical video: ${parts.join(', ') || 'calm, warm, gentle'}. ` +
    `Sits quietly under spoken Korean dialogue, simple and unobtrusive, steady and loopable, no vocals, no sudden drops. ` +
    `(Director note: ${String(briefText || '').replace(/\s+/g, ' ').slice(0, 200)})`
}

// ElevenLabs 음악 생성 → bgm/generated/ 저장 + index.json 등록. 반환 index 항목.
export async function generateBgm({ code, tags, briefText, durSec, apiKey }) {
  if (!apiKey) throw new Error('ElevenLabs API 키 없음')
  const ms = Math.round(Math.min(180, Math.max(10, (Number(durSec) || 30) + 2)) * 1000)
  const prompt = buildMusicPrompt(tags, briefText)
  const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, music_length_ms: ms }),
  })
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300)
    if (/music_generation/.test(body)) throw new Error('ElevenLabs API 키에 음악 생성 권한(music_generation)이 없습니다 — elevenlabs.io → Developers → API Keys 에서 켜 주세요')
    throw new Error(`ElevenLabs 음악 생성 실패 HTTP ${r.status}: ${body}`)
  }
  const buf = Buffer.from(await r.arrayBuffer())
  fs.mkdirSync(mp.bgmDir('generated'), { recursive: true })
  const name = `${code}_${tags.slice(0, 3).join('-') || 'bgm'}_${Date.now().toString(36)}.mp3`
  fs.writeFileSync(mp.bgmDir(path.join('generated', name)), buf)
  const entry = { id: Date.now(), title: `${code} ${tags.join('·')}`, mood: 'GENERATED', tags, file: `bgm/generated/${name}`, source: 'elevenlabs-music', prompt, durationMs: ms, forCode: code, createdAt: new Date().toISOString() }
  const idx = readIndex(); idx.push(entry); writeIndex(idx)
  return entry
}

// 최종 선택: 라이브러리 우선(점수 ≥2), 없으면 생성(허용 시). 선택 결과는 bgm-usage.json 에 기록(최근 곡 반복 방지).
export async function selectBgm({ code, cuts, headerBgm, durSec, allowGenerate = false, apiKey, onLog = () => {} }) {
  const brief = episodeBgmBrief(cuts, headerBgm)
  if (!brief.wants) return { source: 'none', reason: '대본에 BGM 요청 없음', tags: brief.tags }
  const ranked = rankLibrary(brief.tags, { excludeCode: code })
  // 이 에피소드용으로 이미 생성한 곡이 있으면 재사용(재합성마다 다시 사지 않게)
  const own = readIndex().find(t => t.forCode === code && t.file && fs.existsSync(mp.bgmFile(t.file.replace(/^bgm\//, ''))))
  let pick = own ? { track: own, reason: '이 에피소드용 생성곡 재사용' } : (ranked[0] && ranked[0].score >= 2 ? { track: ranked[0].track, reason: `라이브러리 태그 일치(${ranked[0].overlap.join('·')}, 점수 ${ranked[0].score})` } : null)
  if (!pick && allowGenerate) {
    onLog(`BGM: 라이브러리에 맞는 곡 없음(요청 태그 ${brief.tags.join('·') || '없음'}) → ElevenLabs 음악 생성 ${Math.round(durSec + 2)}초`)
    const entry = await generateBgm({ code, tags: brief.tags, briefText: brief.text, durSec, apiKey })
    pick = { track: entry, reason: 'ElevenLabs 음악 생성' }
  }
  if (!pick) return { source: 'none', reason: `라이브러리에 맞는 곡 없음(요청 ${brief.tags.join('·') || '태그 없음'})${allowGenerate ? '' : ' — 생성 꺼짐'}`, tags: brief.tags, candidates: ranked.slice(0, 3).map(r => `${r.track.title}(${r.score})`) }
  const u = readUsage(); u.push({ at: new Date().toISOString(), code, file: pick.track.file }); fs.writeFileSync(USAGE(), JSON.stringify(u.slice(-50), null, 2))
  return { source: pick.track.source === 'elevenlabs-music' ? 'generated' : 'library', file: pick.track.file.replace(/^bgm\//, ''), title: pick.track.title, reason: pick.reason, tags: brief.tags }
}
