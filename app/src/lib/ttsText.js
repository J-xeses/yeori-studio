// 대본 필드(대사/나레이션)를 TTS에 넘기기 전에 정제한다.
// 그대로 읽히면 안 되는 것들: (지문)·[제작메모]·마크다운, 화자명 어트리뷰션,
// 따옴표, 대사 구분 슬래시.
//
// 서버 studio-run-g3 는 proxy.js 의 stripStageDirections() 로 (...) 만 제거한다.
// 이 함수는 그 상위집합. 서버 강화 시 server/lib 로 옮겨 공유할 것.

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

  // 공백/부호 정리
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/\s+([,.!?…])/g, '$1').trim())
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
