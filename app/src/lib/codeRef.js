// 코드 레퍼런스 — 대본 탭의 설명 요소 코드(SP/CH·LOOK/SH/CA/AC/MD/PL)를 코드북(scripts/codebook.json,
// /api/codebook) 기준으로 한글 풀이하고, 설정 점검 카드가 고를 수 있는 선택지 목록을 만든다(2026-10-07).
// 새 코드를 여기서 지어내지 않는다 — 코드북에 없는 코드는 "(?)" 로 표시만 한다.
import { useEffect, useState } from 'react'

const YEORI_SERVER = 'http://localhost:3001'

let cache = null
let promise = null
export function loadCodebook() {
  if (cache) return Promise.resolve(cache)
  if (!promise) {
    promise = fetch(`${YEORI_SERVER}/api/codebook`).then(r => r.json()).then(d => {
      if (!d.ok) throw new Error(d.error || '코드북 로드 실패')
      cache = d.codebook
      return cache
    }).catch(e => { promise = null; throw e })
  }
  return promise
}
export function useCodebook() {
  const [cb, setCb] = useState(cache)
  useEffect(() => { if (!cb) loadCodebook().then(setCb).catch(() => {}) }, [cb])
  return cb
}

// 요소 → 코드북 표. ac 는 코드북에서 AT(액션 템플릿) 표를 쓴다.
const TABLE = { sh: 'SH', ca: 'CA', md: 'MD', ac: 'AT', pl: 'PL', lookId: 'LOOK_BANK' }
// 한 칸에 여러 코드를 적을 때의 구분자(대본 표기 관례)
export const JOINER = { sh: ' → ', ca: ' → ', md: ' + ', ac: ' + ' }

// 코드북의 영어 라벨(afternoon 등)을 한글로 — 코드 자체는 코드북 것 그대로.
const SP_IO = { IN: '실내', OT: '실외' }
const SP_TIME_KO = { TZ_AF: '오후', TZ_GH: '노을', TZ_NT: '밤·저녁', TZ_DW: '새벽' }
const SP_LIGHT_KO = { LT_WM: '따뜻한 빛', LT_DK: '어두운 조명', LT_WD: '창가 자연광', LT_STD: '스튜디오 조명' }

function table(cb, kind) {
  const t = cb?.[TABLE[kind]] || {}
  return Object.fromEntries(Object.entries(t).filter(([k, v]) => !k.startsWith('_') && k !== 'making_record' && v && typeof v === 'object'))
}
export function labelOf(cb, kind, code) { return table(cb, kind)[code]?.label || null }

// 설정 점검 카드의 선택지 — 많이 쓴 순.
export function refOptions(cb, kind) {
  return Object.entries(table(cb, kind))
    .map(([code, v]) => ({ code, label: v.label || '', usage: Number(v.usage) || 0 }))
    .sort((a, b) => b.usage - a.usage)
}

// 값 안의 코드 낱말들(예: "SH_MCU → SH_CU" → [SH_MCU, SH_CU])
const TOKEN_RE = { sh: /SH_[A-Z0-9_]+/g, ca: /CA_[A-Z0-9_]+/g, md: /MD_[A-Z0-9_]+/g, ac: /AT_[A-Z0-9_]+/g, pl: /[A-Z]{2,3}_[A-Z]{2}\b/g, lookId: /LOOK[A-Z0-9_]*/g, ch: /LOOK[A-Z0-9_]*/g }
export function tokensOf(kind, value) { return String(value || '').match(TOKEN_RE[kind]) || [] }

// ── SP(장소) = 실내외.장소.시간.조명 ──
export function spLocations(cb) {
  return Object.entries(cb?.SP?._location_codes || {}).map(([code, v]) => ({ code, label: (String(v).match(/\(([^)]+)\)/) || [])[1] || String(v) }))
}
export const spTimes = (cb) => Object.keys(cb?.SP?._time_codes || {}).map(code => ({ code, label: SP_TIME_KO[code] || cb.SP._time_codes[code].label }))
export const spLights = (cb) => Object.keys(cb?.SP?._light_codes || {}).map(code => ({ code, label: SP_LIGHT_KO[code] || cb.SP._light_codes[code].label }))
export const spIos = () => Object.entries(SP_IO).map(([code, label]) => ({ code, label }))
export function spPresets(cb) {
  return Object.entries(cb?.SP?.presets || {}).map(([code, v]) => ({ code, label: v.label || '', usage: Number(v.usage) || 0 })).sort((a, b) => b.usage - a.usage)
}
export function parseSp(value) {
  const code = (String(value || '').trim().match(/^[A-Z]{2}(\.[A-Z0-9_]+)*/) || [''])[0]
  const parts = code.split('.').filter(Boolean)
  return { code, io: parts[0] || '', loc: parts[1] || '', time: parts.find(p => p.startsWith('TZ_')) || '', light: parts.find(p => p.startsWith('LT_')) || '' }
}
export const composeSp = ({ io, loc, time, light }) => [io, loc, time, light].filter(Boolean).join('.')
// SP 코드의 한글 풀이 + 코드북에 없는 조각
export function spKorean(cb, value) {
  const p = parseSp(value)
  if (!p.code) return { text: '', unknown: [] }
  const preset = cb?.SP?.presets?.[p.code]?.label
  const unknown = []
  const part = (code, map) => { if (!code) return null; if (map[code]) return map[code]; unknown.push(code); return `${code}?` }
  const locMap = Object.fromEntries(spLocations(cb).map(o => [o.code, o.label]))
  const timeMap = Object.fromEntries(spTimes(cb).map(o => [o.code, o.label]))
  const lightMap = Object.fromEntries(spLights(cb).map(o => [o.code, o.label]))
  const pieces = [part(p.io, SP_IO), part(p.loc, locMap), part(p.time, timeMap), part(p.light, lightMap)].filter(Boolean)
  return { text: preset || pieces.join(' · '), unknown: preset ? [] : unknown }
}

// 값 전체를 "코드(한글)" 로 풀어쓴 조각들 — [{text, warn}] . 화면 표시 전용(저장값은 건드리지 않는다).
export function glossParts(cb, kind, value) {
  const v = String(value || '').trim()
  if (!cb || !v) return []
  if (kind === 'sp') {
    const { code } = parseSp(v)
    if (!code) return []
    const k = spKorean(cb, v)
    return [{ text: `${code}(${k.text})`, warn: k.unknown.length > 0 }]
  }
  const lookKind = kind === 'ch' ? 'lookId' : kind
  return tokensOf(kind, v).map(tok => {
    const label = labelOf(cb, lookKind, tok)
    // PL 은 플랫폼 코드(LF_YU 등)도 섞여 쓰여서 모르는 값에 경고를 달지 않는다
    return { text: `${tok}(${label || '?'})`, warn: !label && kind !== 'pl' }
  }).filter(p => kind !== 'pl' || !/\(\?\)$/.test(p.text))
}
export const hasUnknown = (cb, kind, value) => glossParts(cb, kind, value).some(p => p.warn)

// 코드값 → KR 컨펌 문구(레퍼런스 라벨을 같은 구분자로 이은 것)
export function koreanFor(cb, kind, value) {
  if (kind === 'sp') return spKorean(cb, value).text
  return tokensOf(kind, value).map(t => labelOf(cb, kind, t) || t).join(JOINER[kind] || ' + ')
}
