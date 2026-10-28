// CA_BANK 아카데미 시도 로그 (3단계) — downloads/seoyeori/ca_bank/attempts.jsonl (append-only).
// 확정 레지스트리(characters/)와 일부러 분리된 폴더 — 진행 중 시도는 거기 섞이지 않는다(성준님 결정).
//
// 룩 키 = <이니셜2자>_LK## (예: 지아 → JA_LK01). 이니셜은 characters.json 의 name(한글)에서 뽑는다:
// 성을 뗀 이름 끝 2음절의 로마자 첫 글자(지아→J,A / 지유→J,Y / 서여리→Y,R). 기존 별칭(YR/JY)과 일치.
// 변형 캐릭터(personaOf, 예: yeori_nt)는 원본 캐릭터의 이니셜·번호를 공유한다.
// 같은 lookKey 로 다시 쓰면 "결과 갱신" 줄 — 읽는 쪽은 lookKey 별 마지막 줄만 현재 상태로 본다.

import fs from 'fs'
import path from 'path'

export const RESULTS = ['kept', 'discarded', 'pending']

// 시도 카테고리 — look 은 서버가 <이니셜>_LK## 를 발급, turnaround/expr 은 고정 슬롯 키를 그대로 lookKey 로 쓴다.
// 승격 대상: look → characters[c].looks, turnaround → .turnaround, expr → .expressions
export const CATEGORIES = ['look', 'turnaround', 'expr']
export const SLOT_KEYS = {
  turnaround: ['front', 'side', 'back'],
  expr: ['neutral', 'smile', 'surprise', 'sad', 'flustered'],   // code_generator_v1.html CAB_EXPR_LABEL 과 동일
}
const TARGET_FIELD = { look: 'looks', turnaround: 'turnaround', expr: 'expressions' }
// category 필드가 없는 옛 줄(3단계 이전 기록)은 look 으로 본다
const catOf = (a) => a.category || 'look'
// 같은 키라도 캐릭터·카테고리가 다르면 다른 시도 (front 가 캐릭터마다·카테고리마다 존재)
const idOf = (a) => `${a.character}|${catOf(a)}|${a.lookKey}`

const CHOSEONG = ['G', 'G', 'N', 'D', 'D', 'R', 'M', 'B', 'B', 'S', 'S', '', 'J', 'J', 'C', 'K', 'T', 'P', 'H']
// 초성이 ㅇ(없음)일 때는 모음의 로마자 첫 글자 — 아 A, 여 Y(yeo), 유 Y(yu), 이 I, 우 U, 은 E(eun) …
const JUNGSEONG = ['A', 'A', 'Y', 'Y', 'E', 'E', 'Y', 'Y', 'O', 'W', 'W', 'O', 'Y', 'U', 'W', 'W', 'W', 'Y', 'E', 'U', 'I']

function syllableInitial(ch) {
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return /[A-Za-z]/.test(ch) ? ch.toUpperCase() : ''
  return CHOSEONG[Math.floor(code / 588)] || JUNGSEONG[Math.floor((code % 588) / 28)]
}

// characters: characters.json 객체, id: 캐릭터 id. 이니셜 2글자(대문자) 반환.
export function lookInitials(characters, id) {
  let c = characters?.[id]
  if (c?.personaOf && characters[c.personaOf]) c = characters[c.personaOf]
  const name = String(c?.name || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '')
  const given = [...name].filter((ch) => /[가-힣]/.test(ch)).slice(-2)
  let ini = given.map(syllableInitial).join('')
  if (ini.length < 2) ini = String(id || 'XX').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
  return ini.padEnd(2, 'X')
}

export function readAttempts(dir) {
  const file = path.join(dir, 'attempts.jsonl')
  if (!fs.existsSync(file)) return []
  const out = []
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 깨진 줄은 건너뜀 */ }
  }
  return out
}

// lookKey 별 마지막 줄 = 현재 상태
export function latestByLookKey(attempts) {
  const m = new Map()
  for (const a of attempts) if (a.lookKey) m.set(idOf(a), a)
  return [...m.values()]
}

// 기존 lookKey 가 로그에 있으면 그대로(결과 갱신), 없거나 비어 있으면 서버가 다음 번호를 발급.
// 클라이언트가 보낸 새 키는 신뢰하지 않는다(충돌 방지).
// turnaround/expr 는 클라이언트가 보낸 슬롯 키만 허용(서버 검증) — 같은 키로 다시 쓰면 갱신 줄.
export function appendAttempt(dir, characters, { character, lookKey, prompt, result, note, category }) {
  const cat = category || 'look'
  if (!CATEGORIES.includes(cat)) throw new Error(`알 수 없는 category: ${category}`)
  const existing = readAttempts(dir)
  const prefix = lookInitials(characters, character)
  let key = typeof lookKey === 'string' ? lookKey : ''
  if (cat !== 'look') {
    if (!SLOT_KEYS[cat].includes(key)) throw new Error(`${cat} 슬롯 키가 올바르지 않아요: ${key || '(없음)'}`)
  } else if (!key || !existing.some((a) => catOf(a) === 'look' && a.lookKey === key && a.character === character)) {
    let max = 0
    const re = new RegExp(`^${prefix}_LK(\\d+)$`)
    for (const a of existing) { const m = catOf(a) === 'look' && re.exec(a.lookKey || ''); if (m) max = Math.max(max, parseInt(m[1], 10)) }
    key = `${prefix}_LK${String(max + 1).padStart(2, '0')}`
  }
  const entry = {
    character, category: cat, lookKey: key, prompt: prompt ?? '',
    result: RESULTS.includes(result) ? result : 'pending', note: note ?? '', at: new Date().toISOString(),
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, 'attempts.jsonl'), JSON.stringify(entry) + '\n', 'utf-8')
  return entry
}

// ── 4단계: 승격 + 집계 ──────────────────────────────────────────────────────
// 승격 = kept 시도의 프롬프트를 characters.json 의 기존 looks{} 구조에 그대로 편입한다.
// 기존 구조: looks = { <lookId>: { file, desc, season } } (객체, 키 = 룩 코드). 그대로 맞추고
// CA_BANK 출처 표시용 필드만 덧붙인다(promotedFrom/promotedAt/code) — 이미지가 없으니 file 은 빈 문자열
// (POST /api/characters/:id/looks 가 file 없이 등록할 때와 동일, "나중에 연결").

// 같은 character+category+lookKey 의 마지막 줄(= 현재 상태). 없으면 null.
export function findLatest(attempts, character, lookKey, category = 'look') {
  const hits = attempts.filter((a) => a.lookKey === lookKey && a.character === character && catOf(a) === category)
  return hits.length ? hits[hits.length - 1] : null
}

// characters 객체를 직접 수정한다(저장은 호출자). 실패 시 { ok:false, status, error }.
// category: look(기본) → looks{}, turnaround → turnaround{}, expr → expressions{}.
// turnaround/expr 의 값도 look 과 같은 객체 모양({file:'', desc, code, promotedFrom, promotedAt}) — 이미지는 나중에 file 에 연결.
export function promoteAttempt(dir, characters, { character, lookKey, category }) {
  const cat = category || 'look'
  if (!CATEGORIES.includes(cat)) return { ok: false, status: 400, error: `알 수 없는 category: ${category}` }
  if (!character || !lookKey) return { ok: false, status: 400, error: 'character, lookKey 필요' }
  if (cat !== 'look' && !SLOT_KEYS[cat].includes(lookKey)) return { ok: false, status: 404, error: `${cat} 슬롯 키가 올바르지 않아요: ${lookKey}` }
  const c = characters?.[character]
  if (!c || typeof c !== 'object') return { ok: false, status: 404, error: `캐릭터 없음: ${character}` }
  const a = findLatest(readAttempts(dir), character, lookKey, cat)
  if (!a) return { ok: false, status: 404, error: `시도를 찾을 수 없음: ${lookKey}` }
  if (a.result !== 'kept') return { ok: false, status: 409, error: `유지(kept) 상태만 승격할 수 있어요 — 현재 ${a.result}` }
  const field = TARGET_FIELD[cat]
  if (c[field]?.[lookKey]) return { ok: false, status: 409, error: `이미 승격됨: ${lookKey}` }
  c[field] = c[field] || {}
  c[field][lookKey] = {
    file: '', desc: a.prompt || '', ...(cat === 'look' ? { season: '' } : {}),
    code: a.note || '', promotedFrom: 'ca_bank', promotedAt: new Date().toISOString(),
  }
  return { ok: true, look: c[field][lookKey], category: cat }
}

// { [character]: { total, kept, discarded, pending, promoted } } — total = 고유 lookKey 수
export function summarize(attempts, characters) {
  const out = {}
  for (const a of latestByLookKey(attempts)) {
    const s = out[a.character] || (out[a.character] = { total: 0, kept: 0, discarded: 0, pending: 0, promoted: 0 })
    s.total++
    if (s[a.result] !== undefined) s[a.result]++
    if (characters?.[a.character]?.[TARGET_FIELD[catOf(a)]]?.[a.lookKey]) s.promoted++
  }
  return out
}
