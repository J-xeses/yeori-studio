// 대본 필드(대사/나레이션)를 TTS에 넘기기 전에 정제한다.
// 괄호로 섞여 들어온 지문/제작 메모, 마크다운, 대괄호 노트가 그대로 읽히는 것을 막는다.
//
// 서버 studio-run-g3 는 proxy.js 의 stripStageDirections() 로 (...) 만 제거한다.
// 이 함수는 그것 + 대괄호/마크다운/공백까지 처리하는 상위집합. 서버 쪽을 강화할 때
// 이 로직을 server/lib 로 옮겨 공유하는 게 좋다(현재는 클라이언트 전용).

const PAREN_RE = /\s*[（(][^（()]*[)）]/g   // (지문) / （지문） — 중첩 없는 한 쌍
const BRACKET_RE = /\s*\[[^\]]*\]/g          // [제작 메모] / [SFX ...]
const MD_RE = /[*_`#>]/g                     // 마크다운 강조/헤더 기호

export function cleanForTTS(input) {
  const removed = []
  let text = String(input || '')

  text = text.replace(PAREN_RE, (m) => { const t = m.trim(); if (t) removed.push(t); return ' ' })
  text = text.replace(BRACKET_RE, (m) => { const t = m.trim(); if (t) removed.push(t); return ' ' })
  text = text.replace(MD_RE, '')

  // 공백 정리: 줄 안의 연속 공백은 하나로, 3줄 이상 빈 줄은 한 줄로, 양끝 트림
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim()

  return { clean: text, removed }
}

// 정제 결과가 실질적으로 비었는지 (전부 지문/메모였는지)
export function isEmptyAfterClean(input) {
  return !cleanForTTS(input).clean
}
