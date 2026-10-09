// ── 클립별 영상 프롬프트 (세그/다중 클립 컷) ─────────────────────────────
// 2026-09-25 (성준님: "프롬프트가 생성 도구에 정확하게 들어갈 수 있게 잘 분리"). 롱폼 LF_T01 점검에서 세그 컷 11개 중
// 10개가 [Clip k/N] 표기가 없어, 제출 코드가 VP 전체(모든 클립의 동작·대사)를 클립마다 통째로 넣고 있었다.
// 원칙: ① 이 클립에서 "보일 것"만 ② 이 클립에서 "말할 것"만(DL 의 || 조각) ③ 2번째 클립부터 이어짐 명시
//       ④ 화면 서술을 못 찾으면 VP 전체를 넣지 않고 멈춘다(fail-closed).
import fs from 'node:fs'
import { splitSpeakerSegments } from './ttsText.js'
import * as mp from './mediaPaths.js'

// 목소리 고정 문구(characters.json voicePrompt) — Flow 는 목소리 ID 입력이 없어, 말하는 인물마다 같은 묘사를 매번 넣어
// 컷 사이 흔들림을 줄인다(보장은 아님 — 9/25 실측 공식 목소리 대비 0.48~0.74). 화자: 대사 표기 > 서술 속 이름 > 컷 CH > 주인공
export function speakerIdsFor(cut, speakers) {
  let chars = {}
  try { chars = JSON.parse(fs.readFileSync(mp.charactersJsonPath(), 'utf-8')) } catch { return [] }
  const EN = { 'Seo Yeori': 'yeori', 'Han Jia': 'jia', Jiyu: 'jiyu' }
  const find = (name) => {
    if (!name) return null
    if (EN[name] && chars[EN[name]]) return EN[name]
    const hit = Object.entries(chars).find(([id, c]) => c && typeof c === 'object' && (id === name || c.name === name || (c.aliases || []).map(a => String(a).toUpperCase()).includes(String(name).toUpperCase())))
    return hit ? hit[0] : null
  }
  let ids = speakers.map(find).filter(Boolean)
  if (!ids.length) {
    const tokens = String(cut.masterCode?.ch || cut.ch || '').split(/[+,/·]|\s{2,}/).map(t => t.trim()).filter(Boolean)
    const first = tokens.map(find).find(Boolean)
    ids = first ? [first] : Object.entries(chars).filter(([, c]) => c?.primary).map(([id]) => id).slice(0, 1)
  }
  return [...new Set(ids)]
}
function voiceAnchors(cut, speakers) {
  let chars = {}
  try { chars = JSON.parse(fs.readFileSync(mp.charactersJsonPath(), 'utf-8')) } catch { return [] }
  return speakerIdsFor(cut, speakers).map(id => chars[id]?.voicePrompt).filter(Boolean)
}

const CHAR_EN = { 서여리: 'Seo Yeori', 여리: 'Seo Yeori', 한지아: 'Han Jia', 지아: 'Han Jia', 지유: 'Jiyu' }
const norm = (t) => String(t || '').replace(/[^가-힣a-zA-Z0-9]/g, '')

// ── 두 사람 프레임 — 좌/우 위치·외형 태그 (2026-09-28, IG_R06 컷3 실측) ────────────
// Veo가 여러 시도에서 누구 대사인지 헷갈려했는데, 성준님이 캐릭터 이름 옆에 좌/우를 직접
// 적어주자 해결됨. 대본에 이미 좌/우 힌트가 있으면 그대로 쓰고, 없으면 CH: 필드에 적힌
// 이름 순서(먼저 나온 사람 = LEFT)로 결정적으로 정한다 — 추측(LLM) 없음.
const EN_TO_CHAR_ID = { 'Seo Yeori': 'yeori', 'Han Jia': 'jia', Jiyu: 'jiyu' }
// characters.json에 lookTag가 있으면 그걸 우선 쓴다(선택 필드) — 없으면 이 기본값.
const DEFAULT_LOOK_TAGS = {
  yeori: 'long wavy dark brown hair, warm smile',
  yeori_nt: 'dark brown hair tied back, warm smile',
  jia: 'short wavy black bob with curtain bangs',
  jiyu: 'very long straight black hair with full bangs',
}
function lookTagFor(charId) {
  if (!charId) return ''
  let chars = {}
  try { chars = JSON.parse(fs.readFileSync(mp.charactersJsonPath(), 'utf-8')) } catch { return DEFAULT_LOOK_TAGS[charId] || '' }
  return (chars[charId] && chars[charId].lookTag) || DEFAULT_LOOK_TAGS[charId] || ''
}
const LEFT_HINT_RE = /(왼쪽|좌측|\bLEFT\b)/i
const RIGHT_HINT_RE = /(오른쪽|우측|\bRIGHT\b)/i
const NAME_VARIANTS_FOR_POS = {
  'Seo Yeori': ['서여리', '여리', 'Seo Yeori', 'Yeori'],
  'Han Jia': ['한지아', '지아', 'Han Jia', 'Jia'],
  Jiyu: ['지유', 'Jiyu'],
}
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 이름 바로 뒤(괄호 포함, 최대 14자)에서 좌/우 힌트를 찾는다 — "Seo Yeori(right)", "지유(왼쪽)" 둘 다 인식.
function detectPositionHint(haystack, en) {
  if (!haystack) return null
  for (const nm of (NAME_VARIANTS_FOR_POS[en] || [en])) {
    const re = new RegExp(`${escapeRe(nm)}\\s*[(（]?\\s*([^)\\n,.;]{0,14})`, 'i')
    const m = haystack.match(re)
    if (!m) continue
    if (LEFT_HINT_RE.test(m[1])) return 'LEFT'
    if (RIGHT_HINT_RE.test(m[1])) return 'RIGHT'
  }
  return null
}
// speakerNamesKo(대본 화자 표기, 예 ['여리','지유']) → { 'Seo Yeori': 'LEFT', Jiyu: 'RIGHT' } 같은 위치 맵.
export function resolvePositions(cut, speakerNamesKo) {
  const ens = [...new Set((speakerNamesKo || []).map(nm => CHAR_EN[nm] || nm))]
  const haystack = [cut.masterCode?.ch, cut.masterCode?.ac, cut.masterCode?.kr?.ac, cut.videoPrompt].filter(Boolean).join('\n')
  const positions = {}
  for (const en of ens) {
    const hint = detectPositionHint(haystack, en)
    if (hint) positions[en] = hint
  }
  const missing = ens.filter(en => !positions[en])
  if (missing.length) {
    const chTokens = String(cut.masterCode?.ch || '').split(/[+,/·]|\s{2,}/).map(t => t.trim()).filter(Boolean)
    const chOrderEn = chTokens.map(t => CHAR_EN[t] || t)
    const takenSides = new Set(Object.values(positions))
    const sides = ['LEFT', 'RIGHT'].filter(sd => !takenSides.has(sd))
    let i = 0
    for (const en of chOrderEn) {
      if (!missing.includes(en) || positions[en]) continue
      if (i < sides.length) { positions[en] = sides[i]; i++ }
    }
  }
  return positions
}
function speakerLabel(en, side) {
  const look = lookTagFor(EN_TO_CHAR_ID[en])
  const tag = [side ? `on the ${side}` : '', look].filter(Boolean).join(', ')
  return tag ? `${en} (${tag})` : en
}

// ── 오디오 문단 — Veo에 "이 장면 안에서 나는 소리"를 명시한다(2026-09-28, IG_R06 컷2 실측:
// 대사도 나레이션도 없는 컷은 오디오 지시가 아예 안 들어가 비트 없는 클립이 나왔음).
// 후반 합성 BGM(bgmSelect.js)은 여기 넣지 않는다 — Veo가 장면 안 소리처럼 임의로 음악을 깔면
// 후반 BGM과 겹친다. "영상 속"/"현장"/"폰 스피커"/"틀어놓은"/"라디오" 같은 문구로 대본에서
// 명시적으로 "장면 안 소리"라고 한 BGM만 예외로 포함한다.
const IN_SCENE_BGM_RE = /(영상\s*속|현장|폰\s*스피커|스피커\s*질감|틀어\s*놓|라디오)/
const NONE_RE = /^(없음|무|no|none)$/i

// voice 필드는 대사 있는 컷에선 "말투/톤" 지시(anchors가 이미 처리)라 오디오 문단엔 안 쓴다.
// 대사가 없는 컷(예: 웃음소리만)에서만 괄호 안 부가음을 뽑아 쓴다.
function nonDialogueVoiceText(cut, voiceText) {
  if (!voiceText || NONE_RE.test(voiceText.trim())) return ''
  if (String(cut.dialogue || '').trim()) return ''
  const paren = voiceText.match(/\(([^)]+)\)/)
  const extracted = (paren ? paren[1] : voiceText).trim()
  return NONE_RE.test(extracted) ? '' : extracted
}

// AU: 필드(명시 오디오 지시)가 없을 때 masterCode.audio(대본 "오디오:" 블록)에서 결정적으로
// 유도한다 — LLM 호출 없음(토큰 0 원칙). 한국어 원문 문구는 그대로 유지하고 영문 틀로 감싼다.
export function deriveAudioParagraph(cut) {
  const audio = cut.masterCode?.audio || {}
  const bgmText = String(audio.bgm || '').trim()
  const inSceneBgm = bgmText && !NONE_RE.test(bgmText) && IN_SCENE_BGM_RE.test(bgmText)
  const parts = []
  if (inSceneBgm) parts.push(`in-scene music/beat (diegetic, as if playing from a source inside the scene, not a mixed score) — ${bgmText}`)
  const sfxText = String(audio.sfx || '').trim()
  if (sfxText && !NONE_RE.test(sfxText)) parts.push(`sound effect — ${sfxText}`)
  const ambText = String(audio.ambience || '').trim()
  if (ambText && !NONE_RE.test(ambText)) parts.push(`ambience — ${ambText}`)
  const voiceExtra = nonDialogueVoiceText(cut, String(audio.voice || '').trim())
  if (voiceExtra) parts.push(`non-dialogue voice/reaction sound — ${voiceExtra}`)
  let out = parts.length ? `Audio (in-scene, not background score): ${parts.join('; ')}.` : ''
  if (bgmText && !inSceneBgm) out += `${out ? ' ' : ''}No background music score unless stated as in-scene.`
  return out
}

// AU: 필드(대본에 영문으로 직접 적은 오디오 지시)가 있으면 그대로(verbatim) 쓴다 — 컷 전체 1개
// 문자열(audioNote) 또는 클립별 "|||" 분할(audioPrompts, SEGP/CPP와 같은 관례) 지원.
export function buildAudioParagraph(cut, k) {
  if (Array.isArray(cut.audioPrompts) && cut.audioPrompts[k - 1] && cut.audioPrompts[k - 1].trim()) {
    return cut.audioPrompts[k - 1].trim()
  }
  if (cut.audioNote && String(cut.audioNote).trim()) return String(cut.audioNote).trim()
  return deriveAudioParagraph(cut)
}

// VP 에서 클립 k 의 화면 서술을 찾는다. 반환 { text, source } | null
// 생성 도구에 들어가면 안 되는 한국어 제작 메모 제거(명세 §2-3 발화 블록의 생성:/후처리: 안내, 헤더 줄, 대사 원문 줄 — 대사는 따로 넣는다)
export function stripProductionNotes(vp) {
  let t = String(vp || '').replace(/\r/g, '')
  const footerAt = t.search(/^생성:/m)
  if (footerAt >= 0) {
    const nextSeg = t.slice(footerAt).search(/^━+\s*SEG\s*\d+/m)        // SEG 블록 사이의 생성: 줄이면 그 줄들만 제거
    t = nextSeg > 0 ? t.slice(0, footerAt) + t.slice(footerAt + nextSeg) : t.slice(0, footerAt)
  }
  return t.replace(/^(━━━\s*발화.*|유형:.*|전체 대사\(참고용\):.*|대사:.*|나레이션\(VO\):.*|후처리:.*|※.*)$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function clipVisual(vp, segPrompts, k, n) {
  const text = stripProductionNotes(vp)
  // a) [Clip k/N …] 표기 — 마커 앞 블록 + 마커~빈줄
  const markers = [...text.matchAll(/\[Clip (\d+)\/(\d+)[^\]]*\]/g)]
  if (markers.length) {
    const m = markers.find(x => Number(x[1]) === k)
    if (m) {
      const idx = markers.indexOf(m)
      const prevEnd = idx === 0 ? 0 : (() => { const pe = text.indexOf('\n\n', markers[idx - 1].index); return pe < 0 ? 0 : pe })()
      const blank = text.indexOf('\n\n', m.index)
      const tail = text.slice(m.index, blank < 0 ? text.length : blank).trim()
      const sp = Array.isArray(segPrompts) && segPrompts[k - 1] ? String(segPrompts[k - 1]).trim() : ''
      const visual = sp || text.slice(prevEnd, m.index).trim() || text.slice(0, markers[0].index).trim()
      return { text: `${visual}\n\n${tail}`.trim(), source: '[Clip] 표기' }
    }
  }
  // b) 클립별 프롬프트(SEGP → segPrompts)
  if (Array.isArray(segPrompts) && segPrompts[k - 1] && String(segPrompts[k - 1]).trim()) {
    return { text: String(segPrompts[k - 1]).trim(), source: 'segPrompts' }
  }
  // c) ━━━ SEG k / N ━━━ 블록(명세 §2-3)
  const segHdr = [...text.matchAll(/^━+\s*SEG\s*(\d+)\s*\/\s*(\d+)[^\n]*$/gm)]
  if (segHdr.length) {
    const h = segHdr.find(x => Number(x[1]) === k)
    if (h) {
      const next = segHdr[segHdr.indexOf(h) + 1]
      return { text: text.slice(h.index + h[0].length, next ? next.index : text.length).replace(/^━+.*$/gm, '').trim(), source: 'SEG 블록' }
    }
  }
  // d) First 0-8s / Next 8-16s / Final 16-24s 블록(시간 순서대로 k 번째)
  const beat = [...text.matchAll(/^(First|Next|Then|Middle|Final|Last)\b[^\n:]*:/gim)]
  if (beat.length === n && n > 1) {
    const b = beat[k - 1], next = beat[k]
    return { text: text.slice(b.index + b[0].length, next ? next.index : text.length).trim(), source: 'First/Next/Final 블록' }
  }
  if (n <= 1) return { text: text.trim(), source: 'VP 전체(단일 클립)' }
  return null
}

// DL/NR 을 클립 수만큼 나눈다(|| 기준). 반환 string[] | null(분할 표기가 없어 나눌 수 없음)
export function splitLines(raw, n) {
  const s = String(raw || '').trim()
  if (!s) return new Array(n).fill('')
  if (n <= 1) return [s.replace(/\|\|/g, ' ').trim()]
  const parts = s.split('||').map(x => x.trim())
  if (parts.length === 1) return null
  if (parts.length > n) parts.splice(n - 1, parts.length - n + 1, parts.slice(n - 1).join(' '))
  while (parts.length < n) parts.push('')
  return parts
}

// 클립 k 의 최종 프롬프트. 반환 { prompt, visualSource, line, speakers } — 못 만들면 throw(전체 VP 를 넣지 않는다)
export function buildClipPrompt(cut, k, n) {
  const segPrompts = cut.segPrompts
  const vis = clipVisual(cut.videoPrompt || cut.vp || '', segPrompts, k, n)
  if (!vis || !vis.text) throw new Error(`컷 ${cut.no} 클립 ${k}/${n}: 이 클립의 화면 서술을 VP 에서 찾지 못했습니다([Clip k/N]·SEGP·SEG 블록·First/Next/Final 중 하나 필요) — 전체 VP 를 넣지 않고 멈춤`)
  let prompt = vis.text
  if (k > 1 && !/continu(e|ing)|previous clip|이어/i.test(prompt)) {
    prompt = `Continue directly from the previous clip's final frame — same people, outfits, hair and lighting.\n\n${prompt}`
  }
  const isNarration = !String(cut.dialogue || '').trim() && String(cut.narration || '').trim()
  let line = ''
  let speakers = []
  // 2026-10-09 발견(성준님 실측, 컷2 테스트): 대사(DL)와 나레이션(NR)이 "둘 다" 있는 단일(비세그)
  // 클립 — 예: 앞부분 대사(립싱크) → 뒷부분 나레이션(보이스오버, 입모양 없음). 원래는 dialogue 분기가
  // 걸리면 narration을 통째로 무시해서, 자동 생성 프롬프트엔 나레이션 자체가 아예 안 들어갔고
  // "립싱크 없음" 지시도 전혀 없었음 — 성준님이 수동으로 타이밍·"립싱크 삭제" 문구를 직접 써서
  // 보완했던 바로 그 증상. 세그(n>1) 컷은 SEG/"||" 메커니즘이 따로 있어 건드리지 않는다.
  if (n === 1 && String(cut.dialogue || '').trim() && String(cut.narration || '').trim()) {
    const dl = String(cut.dialogue).trim(), nr = String(cut.narration).trim()
    line = dl
    const dur = Math.max(1, Number(cut.duration) || 8)
    const totalLen = dl.length + nr.length || 1
    const dlSec = Math.min(dur - 1, Math.max(1, Math.round(dur * dl.length / totalLen)))
    const segs = splitSpeakerSegments(dl)
    speakers = segs.map(s => s.speaker).filter(Boolean)
    const said = segs.length
      ? segs.map(s => `${s.speaker ? (CHAR_EN[s.speaker] || s.speaker) : 'She'} says in Korean, lips synced: "${s.text}"`).join(' Then ')
      : `She says in Korean, lips synced: "${dl}"`
    prompt += `\n\nFirst 0-${dlSec}s (DIALOGUE, lip-synced): ${said}. Only this line is spoken here, lips move naturally in sync with these exact words.`
    prompt += `\n\nFrom ${dlSec}-${dur}s (NARRATION, voiceover added in post): she does NOT speak and her lips do NOT move — mouth stays closed or in a natural neutral/resting shape, no mouthing or mumbling. She may shift her gaze or expression slightly, but must not appear to be talking. The line "${nr}" is narration audio added afterward, not something she says on camera.`
    prompt += `\n\nNo on-screen subtitle text or captions.`
    const anchors = segs.length ? voiceAnchors(cut, speakers) : []
    if (anchors.length) prompt += `\n\n${anchors.map(a => a.replace(/\.?$/, '.')).join(' ')} Keep exactly this voice for the dialogue portion.`
  } else if (String(cut.dialogue || '').trim()) {
    const parts = splitLines(cut.dialogue, n)
    if (!parts) throw new Error(`컷 ${cut.no}: 클립 ${n}개인데 대사(DL)에 || 분할 표기가 없습니다 — 어느 클립에서 무엇을 말할지 정할 수 없어 멈춤`)
    line = parts[k - 1]
    const segs = splitSpeakerSegments(line)
    speakers = segs.map(s => s.speaker).filter(Boolean)
    // 화면 서술 안에 한국어 대사 인용이 이미 있으면(예: Han Jia … says: "야야! 이거 봤어?") 대본 DL 문구로 바꿔 한 버전만 남긴다
    // — 대본이 기준. 화자 표기가 없는 대사는 그 인용을 말하는 인물 이름을 서술에서 찾아 붙인다(두 사람 컷에서 "She" 모호 방지).
    const koQuote = /"([^"\n]*[가-힣][^"\n]*)"/
    let alreadyIn = segs.length && segs.every(s => norm(prompt).includes(norm(s.text)))
    if (!alreadyIn && segs.length === 1 && koQuote.test(prompt)) {
      const who = (prompt.match(/(Seo Yeori|Han Jia|Jiyu)\b[^.\n"]{0,200}?\b(says?|speaks?|asks?|shouts?|whispers?|exclaims?)\b[^"\n]*"[^"\n]*[가-힣]/) || [])[1]
      if (!segs[0].speaker && who) speakers = [who]
      prompt = prompt.replace(koQuote, `"${segs[0].text}"`)
      alreadyIn = true
    }
    // 두 사람 이상 나오는 클립인데 누가 말하는지 알 수 없으면 추측하지 않고 멈춘다("She says" 로 보내면 도구가 아무나 말하게 함)
    const namesInFrame = ['Seo Yeori', 'Han Jia', 'Jiyu'].filter(nm => prompt.includes(nm)).length
    const multi = namesInFrame >= 2 || /\b(two|both)\b[^.\n]{0,40}\b(women|girls|friends)\b/i.test(prompt)
    if (segs.length && multi && !speakers.length && !segs.some(x => x.speaker)) {
      throw new Error(`컷 ${cut.no} 클립 ${k}/${n}: 두 사람이 나오는데 대사 "${line}" 를 누가 말하는지 대본에 없습니다 — DL 에 '여리 "…"' / '지아 "…"' 처럼 화자를 적어 주세요(추측해서 보내지 않음)`)
    }
    const anchors = segs.length ? voiceAnchors(cut, speakers.length ? speakers : segs.map(x => x.speaker).filter(Boolean)) : []
    if (anchors.length) prompt += `\n\n${anchors.map(a => a.replace(/\.?$/, '.')).join(' ')} Keep exactly this voice.`
    if (!segs.length) {
      prompt += `\n\nNo one speaks in this clip — mouths stay closed or show only natural silent reactions. No on-screen subtitle text or captions.`
    } else if (multi) {
      // 두 사람 이상 프레임 — 대본에 대사 인용이 이미 있어도(alreadyIn) 화자 혼동을 막기 위해
      // 위치(좌/우)+외형 태그를 붙인 문장을 항상 명시한다(2026-09-28, IG_R06 컷3 실측:
      // Veo가 몇 번 시도에서 누구 대사인지 헷갈려했고, 좌/우를 직접 적어주자 해결됨).
      const positions = resolvePositions(cut, segs.map(x => x.speaker).filter(Boolean))
      const said = segs.map(sgm => {
        const en = sgm.speaker ? (CHAR_EN[sgm.speaker] || sgm.speaker) : 'She'
        const label = sgm.speaker ? speakerLabel(en, positions[en]) : en
        return `${label} says in Korean, lips synced: "${sgm.text}"`
      }).join(' Then ')
      const tail = segs.length > 1
        ? 'Only these lines are spoken in this clip, each by the character named.'
        : 'Only this line is spoken in this clip, by the character named.'
      prompt += `\n\n${said}. ${tail} No on-screen subtitle text or captions — dialogue is spoken audio only.`
    } else if (!alreadyIn) {
      const said = segs.map(s => `${s.speaker ? (CHAR_EN[s.speaker] || s.speaker) : 'She'} says in Korean, lips synced: "${s.text}"`).join(' Then ')
      prompt += `\n\n${said}. Only this line is spoken in this clip. No on-screen subtitle text or captions — dialogue is spoken audio only.`
    } else {
      prompt += `\n\nOnly the quoted line above is spoken in this clip. No on-screen subtitle text or captions.`
    }
  } else if (isNarration) {
    prompt += `\n\nNO dialogue — narration is added in post; she does not move her lips to speak. No on-screen subtitle text or captions.`
  } else {
    // 대사도 나레이션도 없는 무성 컷(예: IG_R06 컷2 춤 챌린지) — 예전엔 여기 아무 지시도 안 붙어서
    // Veo가 임의로 화면에 자막을 태우는 사고가 났다(2026-09-28 실측, 성준님 지적).
    prompt += `\n\nNo one speaks and there is no narration in this clip — mouths stay closed or show only natural silent reactions like laughing. No on-screen subtitle text or captions.`
  }
  // 오디오 문단 — 대사 유무와 무관하게 모든 클립에 공통으로 추가(2026-09-28).
  const audioParagraph = buildAudioParagraph(cut, k)
  if (audioParagraph) prompt += `\n\n${audioParagraph}`
  const speakerIds = line ? speakerIdsFor(cut, speakers.length ? speakers : splitSpeakerSegments(line).map(x => x.speaker).filter(Boolean)) : []
  return { prompt: prompt.trim(), visualSource: vis.source, line, speakers, speakerIds }
}
