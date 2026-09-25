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
  if (String(cut.dialogue || '').trim()) {
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
    } else if (!alreadyIn) {
      const said = segs.map(s => `${s.speaker ? (CHAR_EN[s.speaker] || s.speaker) : 'She'} says in Korean, lips synced: "${s.text}"`).join(' Then ')
      prompt += `\n\n${said}. Only this line is spoken in this clip. No on-screen subtitle text or captions — dialogue is spoken audio only.`
    } else {
      prompt += `\n\nOnly the quoted line above is spoken in this clip. No on-screen subtitle text or captions.`
    }
  } else if (isNarration) {
    prompt += `\n\nNO dialogue — narration is added in post; she does not move her lips to speak. No on-screen subtitle text or captions.`
  }
  const speakerIds = line ? speakerIdsFor(cut, speakers.length ? speakers : splitSpeakerSegments(line).map(x => x.speaker).filter(Boolean)) : []
  return { prompt: prompt.trim(), visualSource: vis.source, line, speakers, speakerIds }
}
