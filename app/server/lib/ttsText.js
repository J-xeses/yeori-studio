// 대본 필드(대사/나레이션)를 TTS에 넘기기 전에 정제한다.
// 그대로 읽히면 안 되는 것들: (지문)·[제작메모]·마크다운, 화자명 어트리뷰션,
// 따옴표, 대사 구분 슬래시.
//
// ⚠️ src/lib/ttsText.js 와 내용을 동일하게 유지할 것 (episodeCode.js 와 같은 병행 구조).
//    한쪽만 고치면 스튜디오 UI(클라)와 MCP 파이프라인(서버 studio-run-g3/g5)이 어긋난다.

const PAREN_RE   = /\s*[（(][^（()]*[)）]/g          // (지문) / （지문）
const BRACKET_RE = /\s*\[[^\]]*\]/g                 // [제작 메모] / [SFX ...]
const MD_RE      = /[*_`#>]/g                       // 마크다운 기호
const QUOTE_RE   = /["'‘’“”「」『』]/g

const QOPEN  = `["'‘“「『`
const QCLOSE = `"'’”」』`
const SEP    = ''   // 대사 구분(슬래시) 임시 마커 — 실제 텍스트엔 없는 제어문자

// 화자 어트리뷰션 — 이름(1~6 한글)만 제거, 대사는 남긴다:
//   선두형: 시작 / 슬래시 / 줄바꿈 뒤 + 곧바로 따옴표 또는 콜론
//   인라인형: 닫는 따옴표 뒤 + 곧바로 여는 따옴표
// 선두형: (시작|슬래시|줄바꿈) + 이름 + (따옴표 앞 공백 | 콜론)
const SPEAKER_LEAD_RE   = new RegExp(`(^|[/／\\n])[ \\t]*([가-힣]{1,6})(?:[ \\t]+(?=[${QOPEN}])|[ \\t]*[:：][ \\t]*)`, 'g')
// 인라인형: "대사" __화자__ "대사" — 닫는/여는 따옴표 사이에 공백으로 둘러싸인 이름
const SPEAKER_INLINE_RE = new RegExp(`([${QCLOSE}])[ \\t]+([가-힣]{1,6})[ \\t]+(?=[${QOPEN}])`, 'g')

function endsSentence(s) { return /[.!?…。][)"'’”」』\s]*$/.test(s) }

export function cleanForTTS(input) {
  const removed = []
  let text = String(input || '')

  text = text.replace(PAREN_RE,   (m) => { const t = m.trim(); if (t) removed.push(t); return ' ' })
  text = text.replace(BRACKET_RE, (m) => { const t = m.trim(); if (t) removed.push(t); return ' ' })
  text = text.replace(MD_RE, '')

  // 화자명 제거 (선두형) — 슬래시로 나뉜 경우만 구분 마커
  text = text.replace(SPEAKER_LEAD_RE, (m, sep, name) => {
    removed.push(`화자:${name}`)
    if (sep === '/' || sep === '／') return SEP
    if (sep === '\n') return '\n'
    return ''
  })
  // 화자명 제거 (인라인형) — "대사" 지아 "대사" 의 지아 → 두 대사 사이 구분 마커
  text = text.replace(SPEAKER_INLINE_RE, (m, q, name) => {
    removed.push(`화자:${name}`)
    return q + SEP
  })

  // 남은 대사 구분 슬래시(공백/슬래시/공백)도 마커로
  text = text.replace(/[ \t]+[/／][ \t]+/g, SEP)

  // 따옴표 제거
  text = text.replace(QUOTE_RE, '')

  // 구분 마커 → 앞이 이미 문장부호로 끝나면 공백, 아니면 마침표+공백
  text = text.replace(new RegExp(`\\s*${SEP}\\s*`, 'g'), (m, offset, str) =>
    endsSentence(str.slice(0, offset)) ? ' ' : '. '
  )

  // 공백/부호 정리 — 쉼표·마침표 앞 공백만 붙이고, ! ? … 앞 공백은 유지
  // (세그먼트 경계에서 다음 대사가 …로 시작할 때 구분 공백이 먹히는 문제)
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/\s+([,.])/g, '$1').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/([!?…])\.+/g, '$1')   // 야!. → 야!  ("..." 는 유지)
    .replace(/\.{4,}/g, '…')
    .replace(/([.?!…])\s+([.?!…])/g, '$2')
    .trim()

  return { clean: text, removed }
}

// 정제 결과가 실질적으로 비었는지 (전부 지문/메모였는지)
export function isEmptyAfterClean(input) {
  return !cleanForTTS(input).clean
}

// ── 읽기 교정 (TTS 전용) ─────────────────────────────────────────
// ElevenLabs 가 영문 고유명사를 철자로 읽는 문제("LE SSERAFIM"→"엘 이 에스에스…").
// TTS 로 넘기기 직전에만 한글 발음으로 치환. 자막(dialogueToSubtitle)에는 적용하지 않는다.
export const DEFAULT_READINGS = {
  'LE SSERAFIM': '르세라핌',
  'SSERAFIM': '세라핌',
  'ILLIT': '아일릿',
  'KATSEYE': '캣아이',
  'NewJeans': '뉴진스',
  'HYBE': '하이브',
  'SM': '에스엠',
  'JYP': '제이와이피',
  'YG': '와이지',
  'MV': '뮤비',
  'M/V': '뮤비',
  'ICONIC BY MISTAKE': '아이코닉 바이 미스테이크',
  'BY MISTAKE': '바이 미스테이크',
  'Z세대': '제트세대',
  'MZ세대': '엠지세대',
  'K-POP': '케이팝',
  'K-pop': '케이팝',
  'KPOP': '케이팝',
  'LA': '엘에이',
  'IU': '아이유',
}

export function applyReadings(input, customMap = {}) {
  const map = { ...DEFAULT_READINGS, ...(customMap || {}) }
  let out = String(input || '')
  for (const k of Object.keys(map).sort((a, b) => b.length - a.length)) {
    if (!k.trim() || !map[k]) continue
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(esc, 'gi'), map[k])
  }
  return out
}

// cleanForTTS + 읽기 교정 을 한 번에 (TTS 생성부에서 이걸 쓰면 됨)
export function ttsSpeakText(input, customMap) {
  return applyReadings(cleanForTTS(input).clean, customMap)
}

// SRT/편집메타용 자막 텍스트 — 다중 화자는 화자별 정제본을 두 칸 공백으로 이어붙임
// (화자명·따옴표 없이, 화자 전환만 시각적으로 구분). 단일이면 그냥 정제본.
export function dialogueToSubtitle(input) {
  const segs = splitSpeakerSegments(input)
  if (!segs.length) return ''
  return segs.map(s => s.text).join('  ')
}

// ── 다중 화자 대사 분리 ──────────────────────────────────────────
// `지아 "야, 봤어?" / 여리 "세 그룹이…"` 처럼 한 필드에 여러 화자 대사가 있으면
// [{speaker, text}] 로 쪼갠다. 화자별로 다른 목소리로 TTS 생성 → 합쳐 하나의 컷 오디오.
// 화자 마커가 전혀 없으면 [{speaker: null, text: <정제본>}] 하나.
//   `이름 "대사"`  ·  `이름: 대사`  ·  구분자 `/`  ·  인라인 `"대사" 이름 "대사"`

// 세그먼트: (이름) (콜론?) (따옴표대사)  |  (이름) 콜론 (따옴표없는 대사, /·줄끝까지)
const SEG_RE = new RegExp(
  `([가-힣]{1,6})[ \\t]*[:：]?[ \\t]*[${QOPEN}]([^${QCLOSE}]*)[${QCLOSE}]` +
  `|([가-힣]{1,6})[ \\t]*[:：][ \\t]*([^/／\\n${QOPEN}]+)`,
  'g',
)

export function splitSpeakerSegments(input) {
  const raw = String(input || '')
  const segs = []
  let m
  SEG_RE.lastIndex = 0
  while ((m = SEG_RE.exec(raw)) !== null) {
    const speaker = (m[1] || m[3] || '').trim() || null
    const body    = (m[2] ?? m[4] ?? '').trim()
    const clean   = cleanForTTS(body).clean
    if (clean) segs.push({ speaker, text: clean })
  }
  // 화자 마커가 하나도 안 잡혔으면 통짜 정제본 하나
  if (!segs.length) {
    const clean = cleanForTTS(raw).clean
    return clean ? [{ speaker: null, text: clean }] : []
  }
  // 같은 화자 연속 세그먼트는 병합(한 사람이 여러 문장 말한 경우)
  const merged = []
  for (const s of segs) {
    const prev = merged[merged.length - 1]
    if (prev && prev.speaker === s.speaker) prev.text += ' ' + s.text
    else merged.push({ ...s })
  }
  return merged
}
