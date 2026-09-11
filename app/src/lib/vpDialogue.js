// 발화 컷 VP(영상 프롬프트) 증강 — 영상 프롬프트에 실제 대사/나레이션 텍스트를 명시한다.
//
// 배경 (2026-09-10, LF_T01 v10 검토): 발화 컷의 VP 가 동작·표정·타임라인만 있고
// "무엇을 말하는지"가 없다. LF=video-first 정책상 대사 컷은 Veo(사람 수동 제작).
//
// 음성 처리 방침 (사용자 확정, 2026-09-10):
//   DL(대사) — Veo 가 이 대사를 "말하도록" 생성. 립싱크와 음성을 함께 만들어야 입모양이 맞는다.
//              이후 STS 파이프라인(이미 구현·테스트됨, 2026-06-23):
//                demucs 대사/배경 분리 → ElevenLabs /v1/speech-to-speech (eleven_multilingual_sts_v2)
//                → 서여리 음성 → FFmpeg 3트랙 합성(영상+서여리음성+배경음) → cut_NN_final.mp4.
//              실행: node scripts/test-sts.js --ep=<N> --cut=<N>  (video-automation.js runStsPostProcess 에도 있음)
//   NR(나레이션) — 보이스오버. 인물은 입을 움직이지 않음(립싱크 금지). 음성은 ElevenLabs 서여리 나레이션 직접.
//
// 1단계 스코프: VP 텍스트 끝에 "발화 (한국어)" 블록을 append (멱등). 파서 변경 없음.
// 세그먼트(SEG) 기반 분할은 2단계 — 여기 SEG_MAX_SEC / segCountForDuration 만 미리 둔다.
//
// server(proxy.js) 와 client(ScriptGenTab.jsx) 양쪽에서 import 하는 순수 함수
// (src/lib/videoPolicy.js 와 같은 병행 구조).

export const SEG_MAX_SEC = 8

// ── 2단계 (2026-09-11) — SEG 필드 = "생성단위 조합 + 트림" 모델 ──────────────
// Veo 는 임의 길이가 아니라 8초 또는 10초, 이 두 고정 모드로만 생성된다.
// 20~25초 컷은 이 단위를 이어붙여 만들고, 남는 길이는 처음/끝에서 트림한다.
// 상세: app/docs/vp-dialogue-seg-spec.md §2-1/2-1b/2-1c
export const SEG_UNITS = [8, 10]

// SEG 필드 원문("8+8+10" 또는 "auto") + DU(초) → 세그별 [{ sec, trimStart, trimEnd }].
// "auto"/빈 값/파싱 실패 시 null (호출부가 computeSegmentPlans 1위 후보로 대체해야 함).
export function parseSegField(raw, duration) {
  const s = String(raw || '').trim()
  if (!s || /^auto$/i.test(s)) return null
  const combo = s.split('+').map(v => parseInt(v.trim(), 10)).filter(n => SEG_UNITS.includes(n))
  if (!combo.length) return null
  const DU = Number(duration) || 0
  const genTotal = combo.reduce((a, b) => a + b, 0)
  const trimTotal = Math.max(0, genTotal - DU)
  const trimStart = Math.floor(trimTotal / 2)
  const trimEnd = Math.ceil(trimTotal / 2)
  return combo.map((sec, i) => ({
    sec,
    trimStart: i === 0 ? trimStart : 0,
    trimEnd: i === combo.length - 1 ? trimEnd : 0,
  }))
}

// DU(초) → 트림 최소순 후보 조합들. Field Gate 비교 UI 가 이 배열을 나란히 보여준다.
// 순서가 다른 동일 길이-집합(8+8+10 / 10+8+8 / 8+10+8)은 각각 별개 후보로 남긴다 —
// 트림량은 같아도 대사가 실리는 위치가 달라 편집 결과가 다르기 때문.
export function computeSegmentPlans(duration, units = SEG_UNITS, maxSegs = 3) {
  const DU = Number(duration) || 0
  if (DU <= 0) return []
  const plans = []
  const seen = new Set()
  const build = (combo) => {
    const genTotal = combo.reduce((a, b) => a + b, 0)
    if (genTotal < DU) return
    const key = combo.join('+')
    if (seen.has(key)) return
    seen.add(key)
    const trimTotal = genTotal - DU
    plans.push({
      combo: [...combo], genTotal, trimTotal,
      trimStart: Math.floor(trimTotal / 2), trimEnd: Math.ceil(trimTotal / 2),
    })
  }
  const recurse = (combo, depth) => {
    if (depth > 0) build(combo)
    if (depth >= maxSegs) return
    for (const u of units) recurse([...combo, u], depth + 1)
  }
  recurse([], 0)
  plans.sort((a, b) => a.trimTotal - b.trimTotal || a.combo.length - b.combo.length)
  return plans
}

// 대사/나레이션 텍스트를 세그 개수만큼 문장·호흡 단위로 나눈다(쉼표/마침표/느낌표/물음표/
// 말줄임표 뒤). 이미 " || " 로 수동 분할돼 있고 개수가 맞으면 그걸 그대로 존중한다.
// opts.segSecs — 세그별 실사용 길이(트림 반영) 비율로 배분하고 싶을 때 [8,8,9] 처럼 넘김.
export function splitDialogueBySeg(text, segCount, opts = {}) {
  const t = String(text || '').trim()
  const n = Math.max(1, Math.round(segCount) || 1)
  if (!t) return Array(n).fill('')
  if (n <= 1) return [t]

  if (t.includes('||')) {
    const manual = t.split('||').map(s => s.trim())
    if (manual.length === n) return manual
  }

  const chunks = (t.match(/[^,.!?…]+[,.!?…]*/g) || [t]).map(s => s.trim()).filter(Boolean)
  const weights = Array.isArray(opts.segSecs) && opts.segSecs.length === n ? opts.segSecs : Array(n).fill(1)
  const totalW = weights.reduce((a, b) => a + b, 0) || 1
  const totalLen = chunks.reduce((a, c) => a + c.length, 0)

  const result = Array(n).fill('')
  let ci = 0
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1
    const target = isLast ? Infinity : totalLen * (weights[i] / totalW)
    let acc = ''
    while (ci < chunks.length) {
      if (!isLast && acc && acc.length + chunks[ci].length > target * 1.15) break
      acc += (acc ? ' ' : '') + chunks[ci]
      ci++
      if (!isLast && acc.length >= target) break
    }
    result[i] = acc.trim()
  }
  if (ci < chunks.length) result[n - 1] = `${result[n - 1]} ${chunks.slice(ci).join(' ')}`.trim()
  return result
}

// DU(초) → 필요한 Veo 클립(세그먼트) 수. 8초 이하는 1.
// ⚠️ 1단계 잔존 함수 — 2단계부터는 computeSegmentPlans 가 정확한 생성단위를 계산하므로
// 이건 "몇 개로 나눠야 하는지"만 대충 알고 싶을 때(1단계 안내 문구 등)만 쓴다.
export function segCountForDuration(dur) {
  const d = Number(dur) || 0
  return d > SEG_MAX_SEC ? Math.ceil(d / SEG_MAX_SEC) : 1
}

// VP 에 발화 블록이 이미 있는지 판정하는 마커 (멱등성)
// ⚠️ 2단계 작업 중 실수로 지워졌다가 복구함(2026-09-11) — 이게 없으면 ensureDialogueInVP
// 호출 시 ReferenceError 로 /api/episode-video-checklist 등이 전부 깨진다.
const VP_SPOKEN_MARKER = /발화\s*\(한국어\)|LIP-SYNC\s*\(KO\)|SPOKEN LINES/i

const strip = (v) => String(v == null ? '' : v).trim()
const isNone = (v) => /^(없음|-|n\/a)$/i.test(strip(v))
const dq = (s) => (/^["'“”‘’「『]/.test(s) ? s : `"${s}"`)

// combo(예 [8,8,10]) + DU(초) → §2-1b 트림 계산. parseSegField 와 같은 로직을 공유.
function deriveTrim(combo, duration) {
  const DU = Number(duration) || 0
  const genTotal = combo.reduce((a, b) => a + b, 0)
  const trimTotal = Math.max(0, genTotal - DU)
  return { genTotal, trimTotal, trimStart: Math.floor(trimTotal / 2), trimEnd: Math.ceil(trimTotal / 2) }
}

// 다중 세그먼트 발화 블록 — app/docs/vp-dialogue-seg-spec.md §2-3 "다중 세그먼트" 형식.
// cut.segments(예 [8,8,10])가 있을 때만 호출됨. 순수 계산 — AI 호출 없음.
function buildSegmentedSpokenBlock(cut, combo, dl, nr) {
  const text = dl || nr
  const field = dl ? 'DL' : 'NR'
  const { trimStart, trimEnd } = deriveTrim(combo, cut.duration)
  const segSecs = combo.map((sec, i) => sec - (i === 0 ? trimStart : 0) - (i === combo.length - 1 ? trimEnd : 0))
  const parts = text ? splitDialogueBySeg(text, combo.length, { segSecs }) : combo.map(() => '')

  const kind = dl
    ? '대사 — 인물이 화면에서 이 대사를 말함 (립싱크)'
    : '나레이션 — 보이스오버, 인물은 입을 움직이지 않음 (립싱크 금지)'
  const lines = [
    `━━━ 발화 (한국어) · 세그먼트 ${combo.length}개 (${combo.join('+')}초, ${field}) ━━━`,
    `유형: ${kind}`,
    `전체 ${dl ? '대사' : '나레이션(VO)'}(참고용): ${dq(text)}`,
    '',
  ]
  combo.forEach((sec, i) => {
    const isFirst = i === 0, isLast = i === combo.length - 1
    const trimTag = (isFirst && trimStart) ? ` (앞 ${trimStart}초 트림 예정)`
      : (isLast && trimEnd) ? ` (끝 ${trimEnd}초 트림 예정)` : ' (트림 없음)'
    lines.push(`━━━ SEG ${i + 1}/${combo.length} · 생성 ${sec}초${trimTag} ━━━`)
    lines.push(isFirst
      ? '[시작 프레임: G2 승인 이미지]'
      : `CONTINUE FROM SEG ${i} FINAL FRAME (동일 인물·의상·헤어·조명 유지).`)
    if (parts[i]) {
      lines.push(dl
        ? `SPEAKS (KO): ${dq(parts[i])}  ← Veo 가 이 부분을 말하도록. 립싱크·음성 함께.`
        : `SPEAKS (KO, VO): ${dq(parts[i])}  ← 인물 입은 움직이지 않음, 나레이션만.`)
    }
    if (isFirst && trimStart) lines.push(`※ 앞 ${trimStart}초는 편집에서 잘려나감 — 대사는 여유 있게, 핵심 발화는 ${trimStart}초 이후에.`)
    if (isLast && trimEnd) lines.push(`※ 끝 ${trimEnd}초는 편집에서 잘려나감 — 대사는 ${sec - trimEnd}초 지점 전에 끝내고, 남는 시간은 표정 여운으로.`)
    lines.push('')
  })
  if (dl) {
    lines.push(
      '생성: Veo 가 각 세그를 순서대로, 이전 세그 마지막 프레임에서 이어지게 생성(립싱크·음성 함께).',
      '후처리(STS): 세그마다 demucs 로 대사/배경 분리 → ElevenLabs speech-to-speech(eleven_multilingual_sts_v2) ' +
      '로 서여리 음성 변환(타이밍·립싱크 보존) → 세그별 합성 후 이어붙임. ' +
      '실행: node scripts/test-sts.js --ep=<N> --cut=<N> (세그별 확장은 3단계)'
    )
  } else {
    lines.push('생성: 인물 입은 움직이지 않음. 나레이션 음성은 ElevenLabs 서여리 나레이션을 영상에 얹음(세그 이어붙인 뒤 통짜로).')
  }
  return lines.join('\n')
}

// { videoPrompt, dialogue, narration, duration, cutType, segments } → 증강된 VP 문자열 (멱등).
// 발화가 없거나 이미 블록이 있으면 원본 그대로 반환.
// segments(예 [8,8,10] — Field Gate 세그 분할 탭에서 고른 조합)가 있으면 다중 세그 블록으로,
// 없으면 1단계 그대로 단일 발화 블록으로 append.
export function ensureDialogueInVP(cut = {}) {
  const vp = String(cut.videoPrompt || '')
  const dl = isNone(cut.dialogue) ? '' : strip(cut.dialogue)
  const nr = isNone(cut.narration) ? '' : strip(cut.narration)
  if ((!dl && !nr) || VP_SPOKEN_MARKER.test(vp)) return vp

  const combo = Array.isArray(cut.segments) ? cut.segments.filter(n => SEG_UNITS.includes(n)) : null
  if (combo && combo.length > 1) {
    const block = buildSegmentedSpokenBlock(cut, combo, dl, nr)
    return `${vp.replace(/\s+$/, '')}\n\n${block}\n`
  }

  const kind = dl && nr
    ? '대사(립싱크) + 나레이션(보이스오버)'
    : dl
      ? '대사 — 인물이 화면에서 이 대사를 말함 (립싱크)'
      : '나레이션 — 보이스오버, 인물은 입을 움직이지 않음 (립싱크 금지)'

  const lines = ['━━━ 발화 (한국어) ━━━', `유형: ${kind}`]
  if (dl) lines.push(`대사: ${dq(dl)}`)
  if (nr) lines.push(`나레이션(VO): ${dq(nr)}`)

  const segN = segCountForDuration(cut.duration)
  if (segN > 1) {
    lines.push(
      `※ ${Number(cut.duration)}s — 8초 초과. Veo 클립을 이어붙여야 함 (8초 기준 최소 ${segN}개, ` +
      `각 클립은 이전 클립의 마지막 프레임에서 연속: 인물·의상·헤어·조명 유지). ` +
      `대사를 클립별로 나눠 배치 — Field Gate "세그 분할" 탭에서 정밀 조합을 고르면 이 블록이 자동으로 세그별로 재구성됨.`
    )
  }
  if (dl) {
    lines.push(
      '생성: Veo 가 이 대사를 한국어로 말하도록 — 립싱크와 음성을 함께 생성 (입모양이 대사와 맞아야 함).'
    )
    lines.push(
      '후처리(STS): demucs 로 대사/배경 분리 → ElevenLabs speech-to-speech(eleven_multilingual_sts_v2) ' +
      '로 서여리 음성 변환(타이밍·립싱크 보존) → 3트랙 합성 → cut_NN_final.mp4. ' +
      '실행: node scripts/test-sts.js --ep=<N> --cut=<N>'
    )
  }
  if (nr && !dl) {
    lines.push('생성: 인물 입은 움직이지 않음. 나레이션 음성은 ElevenLabs 서여리 나레이션(cut_NN.mp3) 을 영상에 얹음.')
  }

  return `${vp.replace(/\s+$/, '')}\n\n${lines.join('\n')}\n`
}
