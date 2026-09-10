// 발화 컷 VP(영상 프롬프트) 증강 — 영상 프롬프트에 실제 대사/나레이션 텍스트를 명시한다.
//
// 배경 (2026-09-10, LF_T01 v10 검토): 발화 컷의 VP 가 동작·표정·타임라인만 있고
// "무엇을 말하는지"가 없다. LF=video-first 정책상 대사 컷은 Veo(사람 수동 제작)인데
// Veo 3 는 네이티브 발화·립싱크를 생성하므로 대사 텍스트가 프롬프트에 있어야 한다.
//   DL(대사)      → 화면 속 인물이 말함 → 립싱크 필요
//   NR(나레이션)  → 보이스오버, 인물은 말 안 함 → 립싱크 금지
//
// 1단계 스코프: VP 텍스트 끝에 "발화 (한국어)" 블록을 append (멱등). 파서 변경 없음.
// 세그먼트(SEG) 기반 분할은 2단계 — 여기 SEG_MAX_SEC / segCountForDuration 만 미리 둔다.
//
// server(proxy.js) 와 client(ScriptGenTab.jsx) 양쪽에서 import 하는 순수 함수
// (src/lib/videoPolicy.js 와 같은 병행 구조).

export const SEG_MAX_SEC = 8

// VP 에 발화 블록이 이미 있는지 판정하는 마커 (멱등성)
const VP_SPOKEN_MARKER = /발화\s*\(한국어\)|LIP-SYNC\s*\(KO\)|SPOKEN LINES/i

// DU(초) → 필요한 Veo 클립(세그먼트) 수. 8초 이하는 1.
export function segCountForDuration(dur) {
  const d = Number(dur) || 0
  return d > SEG_MAX_SEC ? Math.ceil(d / SEG_MAX_SEC) : 1
}

const strip = (v) => String(v == null ? '' : v).trim()
const isNone = (v) => /^(없음|-|n\/a)$/i.test(strip(v))
const dq = (s) => (/^["'“”‘’「『]/.test(s) ? s : `"${s}"`)

// { videoPrompt, dialogue, narration, duration, cutType } → 증강된 VP 문자열 (멱등).
// 발화가 없거나 이미 블록이 있으면 원본 그대로 반환.
export function ensureDialogueInVP(cut = {}) {
  const vp = String(cut.videoPrompt || '')
  const dl = isNone(cut.dialogue) ? '' : strip(cut.dialogue)
  const nr = isNone(cut.narration) ? '' : strip(cut.narration)
  if ((!dl && !nr) || VP_SPOKEN_MARKER.test(vp)) return vp

  const kind = dl && nr
    ? '대사(립싱크) + 나레이션(보이스오버)'
    : dl
      ? '대사 — 립싱크 필요'
      : '나레이션 — 보이스오버, 립싱크 없음 (입 움직이지 않음)'

  const lines = ['━━━ 발화 (한국어) ━━━', `유형: ${kind}`]
  if (dl) lines.push(`대사: ${dq(dl)}`)
  if (nr) lines.push(`나레이션(VO): ${dq(nr)}`)

  const segN = segCountForDuration(cut.duration)
  if (segN > 1) {
    lines.push(
      `※ ${Number(cut.duration)}s — 8초 초과. Veo 클립을 이어붙여야 함 (8초 기준 최소 ${segN}개, ` +
      `각 클립은 이전 클립의 마지막 프레임에서 연속: 인물·의상·헤어·조명 유지). ` +
      `대사를 클립별로 나눠 배치 — 세그먼트 정밀 분할(SEG 필드)은 2단계.`
    )
  }
  if (dl) lines.push('SILENT — Veo 는 입모양만, 오디오 없음. 최종 음성은 ElevenLabs(cut_NN.mp3).')

  return `${vp.replace(/\s+$/, '')}\n\n${lines.join('\n')}\n`
}
