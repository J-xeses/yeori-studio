import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import { setGPoints, setGPoint, loadGPoints } from '../lib/gpoints'
import { formatEpisodeCode, displayEpisodeCode, resolveEpisodeCode } from '../lib/episodeCode'
import { FINISH_MODES, resolveFinishMode } from '../lib/finishMode'
import { ensureDialogueInVP, parseSegTiming } from '../lib/vpDialogue'
import TabToolbar from '../components/TabToolbar'
import SfxPicker from '../components/SfxPicker'
import s from './ScriptGenTab.module.css'

const LOCATIONS = ['카페', '공원', '집 (방)', '도서관', '학교', '회사', '해변', '산', '거리', '기타']
const MOODS = ['감성', '유머', '정보', '힐링', '동기부여', '일상', '여행', 'K문화', '공감', '치명']

const CONTENT_TYPES = [
  { value: 'LF',   label: 'LF — YouTube 롱폼' },
  { value: 'SF',   label: 'SF — YouTube 숏폼' },
  { value: 'IG_R', label: 'IG_R — Instagram 릴스' },
  { value: 'IG_P', label: 'IG_P — Instagram 피드' },
  { value: 'IG_S', label: 'IG_S — Instagram 스토리' },
  { value: 'TK',   label: 'TK — TikTok' },
]

const TOPIC_CODES = [
  { value: 'PSY', label: 'PSY — 심리' },
  { value: 'SOC', label: 'SOC — 사회' },
  { value: 'LIF', label: 'LIF — 라이프스타일' },
  { value: 'REL', label: 'REL — 관계' },
  { value: 'TRD', label: 'TRD — 트렌드' },
]

const SCN_CODES = [
  { value: 'DOC',  label: 'DOC — 다큐' },
  { value: 'MYS',  label: 'MYS — 미스터리' },
  { value: 'NEWS', label: 'NEWS — 뉴스' },
  { value: 'EDU',  label: 'EDU — 교육' },
  { value: 'ENT',  label: 'ENT — 엔터테인먼트' },
  { value: 'REL',  label: 'REL — 릴레이션십' },
]

const CUT_TYPES = [
  { value: 'YEORI',   label: 'YEORI',   color: '#a78bfa', border: 'rgba(167,139,250,0.45)' },
  { value: 'BROLL',   label: 'B-ROLL',  color: '#60a5fa', border: 'rgba(96,165,250,0.45)'  },
  { value: 'PIP',     label: 'PIP',     color: '#34d399', border: 'rgba(52,211,153,0.45)'  },
  { value: 'GRAPHIC', label: 'GRAPHIC', color: '#fb923c', border: 'rgba(251,146,60,0.45)'  },
  { value: 'CAPCUT',  label: 'CAPCUT',  color: '#9ca3af', border: 'rgba(156,163,175,0.45)' },
]
const PIPE_TYPES = new Set(['YEORI', 'BROLL', 'PIP', 'GRAPHIC', 'CAPCUT'])

function getRunFlags(cut) {
  switch (cut.cutType || 'YEORI') {
    case 'BROLL':
      return { run_g2:true, run_g3:true, g3_track:'나레이션', run_g4:true, run_g5:true }
    case 'PIP': {
      const f = { run_g2:true, run_g3:true, g3_track:'대사', run_g4:true, run_g5:true }
      const t = parseInt(cut.pipTarget)
      if (!isNaN(t) && t > 0) f.pip_target = t
      return f
    }
    case 'GRAPHIC': {
      const f = { run_g2:false, run_g3:true, g3_track:'나레이션', run_g4:false, run_g5:true, g5_tool:'browser_record' }
      if (cut.graphicTool) f.graphic_tool = cut.graphicTool
      return f
    }
    case 'CAPCUT':
      return { run_g2:false, run_g3:false, run_g4:false, run_g5:true, g5_tool:'capcut_only' }
    default: // YEORI
      return { run_g2:true, run_g3:true, g3_track:'대사', run_g4:true, g4_mode:'lipsync', run_g5:true }
  }
}

function cleanMarkdown(text) {
  return text
    .replace(/\*\*/g, '')     // ** 굵은 글씨 제거
    .replace(/\*/g, '')       // * 이탤릭 제거
    .replace(/^#+\s/gm, '')   // # 헤더 제거
    .replace(/^---+$/gm, '')  // --- 구분선 제거
    .replace(/^>\s/gm, '')    // > 인용 제거
    .replace(/`/g, '')        // ` 코드 제거
    .trim()
}

// 나레이션·대사에 혼입된 촬영 지시어 제거
function stripShotDirective(text) {
  if (!text) return text
  return text
    .replace(/\n?샷\s*타입[:：]\s*(CLOSEUP|FULLBODY|클로즈업|풀바디)[^\n]*/gi, '')
    .replace(/^(CLOSEUP|FULLBODY)\s*(SHOT)?\s*[-—]?\s*/i, '')
    .trim()
}

function parseCuts(raw, n) {
  // 마크다운 정리
  const cleaned = cleanMarkdown(raw)
  const cuts = []
  const blocks = cleaned.split(/\[CUT\s*(\d+)\]/i).filter(Boolean)
  let cur = null

  for (const block of blocks) {
    if (/^\d+$/.test(block.trim())) {
      if (cur) cuts.push(cur)
      cur = {
        id: `cut-${block.trim()}`,
        no: parseInt(block.trim()),
        scene: '', action: '', character: '서여리',
        dialogue: '', narration: '', subtitle: '', imagePrompt: '', duration: 5
      }
    } else if (cur) {
      // 멀티라인 파싱 (다음 필드 키워드가 나올 때까지 수집)
      const getField = (startRegex) => {
        const m = block.match(startRegex)
        if (!m) return ''
        const startIdx = block.indexOf(m[0]) + m[0].length
        const rest = block.slice(startIdx)
        // 다음 필드 키워드 전까지 (샷 타입, 컷 길이, 컷 타입, PIP_TARGET, 그래픽 도구 포함)
        const nextField = rest.search(/\n(씬|액션|캐릭터|대사|나레이션|자막|샷\s*타입|이미지 프롬프트|컷 길이|컷 타입|PIP_TARGET|그래픽 도구)[:：]/)
        const content = nextField > -1 ? rest.slice(0, nextField) : rest
        return content.replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/^없음$/i, '')
      }

      cur.scene      = getField(/씬[:：]\s*/) || getField(/장면[:：]\s*/)
      cur.action     = getField(/액션[:：]\s*/) || getField(/행동[:：]\s*/)
      cur.character  = getField(/캐릭터[:：]\s*/) || '서여리'
      cur.dialogue   = stripShotDirective(getField(/대사[:：]\s*/))
      cur.narration  = stripShotDirective(getField(/나레이션[:：](?:\s*\(VO\))?\s*/) || getField(/나레이션[:：]\s*/))
      cur.subtitle   = getField(/자막[:：]\s*/) || getField(/CP[:：]\s*/)
      const rawShot = (getField(/샷 타입[:：]\s*/) || '').trim().toUpperCase()
      cur.shotType = rawShot.includes('CLOSE') ? 'CLOSEUP' : 'FULLBODY'
      // cutType: "컷 타입:" 필드 우선, 없으면 "샷 타입:" 값이 파이프라인 타입인지 체크
      const rawCutTypeField = (getField(/컷 타입[:：]\s*/) || '').trim().toUpperCase()
      cur.cutType = PIPE_TYPES.has(rawCutTypeField)
        ? rawCutTypeField
        : (PIPE_TYPES.has(rawShot) ? rawShot : 'YEORI')
      cur.pipTarget    = getField(/PIP_TARGET[:：]\s*/) || ''
      cur.graphicTool  = getField(/그래픽 도구[:：]\s*/) || ''
      cur.imagePrompt = getField(/이미지 프롬프트[:：]\s*/) || getField(/프롬프트[:：]\s*/)

      // 룰셋 통과 표시 제거 (UI에서 별도 표시)
      cur.imagePrompt = cur.imagePrompt
        .replace(/✅\s*룰셋\s*통과/g, '')
        .replace(/⚠️.*확인 필요/g, '')
        .trim()

      // duration: 파일에 "컷 길이:" 값이 있으면 우선 사용, 없으면 글자수 자동 계산
      const fileDuration = parseInt(getField(/컷 길이[:：]\s*/))
      const text = (cur.dialogue || '') + (cur.narration || '')
      const chars = text.replace(/\s/g, '').length
      cur.duration = (!isNaN(fileDuration) && fileDuration > 0)
        ? fileDuration
        : (chars > 0 ? Math.min(20, Math.max(4, Math.round(chars / 5) + 2)) : 5)
    }
  }
  if (cur) cuts.push(cur)
  if (cuts.length === 0) {
    return Array.from({ length: n }, (_, i) => ({
      id: `cut-${i+1}`, no: i+1, scene: '', action: '', character: '서여리',
      dialogue: '', narration: '', subtitle: '', imagePrompt: '', duration: 5,
    }))
  }
  return cuts
}

// 마스터 코드 파이프라인(prompts.json)의 컷을 AppContext cuts 스키마로 변환
const MASTER_CLOSEUP_SHOTS = new Set(['SH_ECU', 'SH_CU', 'SH_MCU'])

function mapPromptsCutsToAppCuts(promptsCuts) {
  return (promptsCuts || []).map(pc => {
    const firstSh = (pc.sh || '').split('→')[0].trim()
    return {
      id: `cut-${pc.no}`,
      no: parseInt(pc.no, 10) || pc.no,
      scene: pc.sc || '',
      action: pc.kr?.at || '',
      character: '서여리',
      dialogue: pc.dl || '',
      narration: pc.nr || '',
      subtitle: pc.cp || pc.subtitle || '',
      imagePrompt: pc.imagePrompt || '',
      videoPrompt: pc.videoPrompt || '',
      duration: pc.du || 8,
      shotType: MASTER_CLOSEUP_SHOTS.has(firstSh) ? 'CLOSEUP' : 'FULLBODY',
      cutType: 'YEORI',
      masterCode: {
        sp: pc.sp || '', pl: pc.pl || '', ch: '', sh: pc.sh || '', ca: pc.ca || '',
        md: pc.md || '', ac: pc.at || '', lookId: '', du: pc.du || 8,
        audio: { bgm: '', voice: '', sfx: '', ambience: '' },
        kr: {
          sp: pc.kr?.sp || '', ch: pc.kr?.ch || '', sh: pc.kr?.sh || '',
          ca: pc.kr?.ca || '', ac: pc.kr?.at || '', md: pc.kr?.md || '',
        },
      },
    }
  })
}

// ── v3 표준 포맷(SF_E01_SHOE_v3.txt 기준) 대본 파서 ──────────────────────
// script_generator.py/script_to_prompts.py가 만드는 단순 포맷([C01] 헤더,
// 구분선 없이 SC:~DU: 곧바로 이어짐)과 달리, v3.1 수기 표준 포맷은
// "[CUT N]  제목 / N초" 헤더 + ━ 구분선 + SC~DU/오디오 + KR/IP/VP 3개
// 섹션으로 구성된다. 구분선 개수에 의존하지 않고 섹션 제목 줄로 상태를
// 전환하는 방식이라 구분선 스타일이 조금 달라져도 안전하게 파싱된다.
const V3_SEP_LINE_RE = /^[━=]{6,}$/
const V3_CUT_HEADER_RE = /^\[CUT\s+(\d+)\]\s*(.*)$/
// HTML/SRC/BQ/URL/MOTION 는 메이킹 탭 자동실행용 컷별 소스 지정 필드(2026-09-08 추가)
// GTPL: GRAPHIC/CAPCUT 컷 HTML 자동 생성 지시 — 서버 scriptParserV3.js 와 반드시 동일 (2026-09-09)
// SEG: 발화 컷 세그먼트 조합("8+8+10", Veo 고정 생성단위) — app/docs/vp-dialogue-seg-spec.md §2-1
// SEGT: 세그별 발화 구간("2-8,0-3", 세그 안에서 몇 초부터 몇 초까지 말하는지) — 2026-09-12 추가,
// buildSegmentedSpokenBlock(vpDialogue.js)이 SPEAKS 줄에 "[Xs-Ys]" 구간으로 반영
// SEGP: 세그별 영문 비주얼 프롬프트("prompt1 ||| prompt2", 줄바꿈은 ⏎로 치환해 한 줄 유지) —
// 2026-09-12 추가. 있으면 ensureDialogueInVP이 세그별로 비주얼+발화를 인터리브해서 재구성.
const V3_MAIN_FIELD_RE = /^(SC|SP|PL|CH|DL|NR|CP|CT|SH|CA|MD|AC|LOOK_ID|DU|SEG|SEGT|SEGP|HTML|SRC|BQ|URL|CLIP|MOTION|GTPL):\s?(.*)$/

// "8+8+10" → [8,10] 단위로만 구성된 배열(2개 이상). 형식이 안 맞거나 "auto"/빈값이면 null.
// server/lib/scriptParserV3.js 의 동일 함수와 반드시 함께 유지.
function parseSegCombo(raw) {
  const combo = String(raw || '').split('+').map(v => parseInt(v.trim(), 10)).filter(n => n === 8 || n === 10)
  return combo.length > 1 ? combo : null
}

// "prompt1 ||| prompt2"(줄바꿈은 ⏎로 치환됨) → 세그별 영문 비주얼 프롬프트 배열. 세그 개수와
// 안 맞으면 null. server/lib/scriptParserV3.js 의 동일 함수와 반드시 함께 유지.
function parseSegPrompts(raw, segCount) {
  if (!raw) return null
  const parts = String(raw).split('|||').map(s => s.trim().replace(/⏎/g, '\n'))
  if (segCount != null && parts.length !== segCount) return null
  return parts.some(p => p) ? parts : null
}
function formatSegPrompts(arr) {
  return arr.map(p => String(p || '').replace(/\n/g, '⏎')).join(' ||| ')
}

// "CLIP: <url> [@ <mm:ss|초>] [+<초>]" → { url, seekSec, durationSec }
// server/lib/scriptParserV3.js 의 parseClipField 와 동일하게 유지.
function parseClipField(raw) {
  let rest = String(raw || '').trim()
  if (!rest) return null
  let durationSec = 0, seekSec = 0
  const dm = rest.match(/\s\+\s*(\d+(?:\.\d+)?)\s*$/)
  if (dm) { durationSec = Number(dm[1]); rest = rest.slice(0, dm.index).trim() }
  const sm = rest.match(/\s@\s*(\d{1,2}(?::\d{2}){1,2}|\d+(?:\.\d+)?)\s*$/)
  if (sm) {
    const t = sm[1]
    seekSec = t.includes(':') ? t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0) : Number(t)
    rest = rest.slice(0, sm.index).trim()
  }
  const url = rest.trim()
  return /^https?:\/\//i.test(url) ? { url, seekSec, durationSec } : null
}
const V3_KR_FIELD_RE = /^([A-Z]+)\(([^)]*)\):\s*(.*)$/
const V3_AUDIO_SUBFIELD_RE = /^\s+(BGM|음성|효과음|앰비언스):\s*(.*)$/
const V3_AUDIO_KEY_MAP = { BGM: 'bgm', 음성: 'voice', 효과음: 'sfx', 앰비언스: 'ambience' }

function isV3Format(raw) {
  return /KR\s*\(한글\s*컨펌본\)/.test(raw) && /^\s*SP:/m.test(raw) && /^\s*PL:/m.test(raw)
}

function parseCutHeaderMeta(headerRest) {
  const lipsync = /★\s*립싱크/.test(headerRest)
  let rest = headerRest.replace(/★\s*립싱크/g, '').trim()
  // 컷 타입 키워드는 구분자 앞([CUT N]  GRAPHIC — 훅 / 5초, v3.0 포맷) 또는
  // 뒤([CUT N] — GRAPHIC | 인트로 | 3s, v7 포맷) 어느 쪽에도 올 수 있다. 둘 다 지원한다.
  // server/lib/scriptParserV3.js의 parseCutHeaderMeta()와 반드시 동일하게 유지.
  const CUT_TYPE_RE = /^(GRAPHIC|CAPCUT|BROLL|YEORI|PIP)\b/i
  const typeBefore = rest.match(CUT_TYPE_RE)
  const emDashIdx = rest.search(/[—–-]/)
  if (emDashIdx > -1) rest = rest.slice(emDashIdx + 1).trim()
  const typeAfter = rest.match(CUT_TYPE_RE)
  const typeM = typeBefore || typeAfter
  const headerType = typeM ? typeM[1].toUpperCase() : ''

  let cutTitle
  if (rest.includes('|')) {
    // v7/v8 헤더: "<타입|라벨> | <설명> | <길이>[ | <샷노트>]"
    // 타입 키워드·순수 길이(3s, 5초) 세그먼트는 버리고 남은 것 중 가장 긴 세그먼트를 제목으로.
    const isType = (s) => /^(GRAPHIC|CAPCUT|BROLL|YEORI|PIP)$/i.test(s)
    const isDur = (s) => /^\d+\s*(s|sec|초)$/i.test(s)
    const segs = rest.split('|').map((s) => s.trim()).filter((s) => s && !isType(s) && !isDur(s))
    cutTitle = segs.slice().sort((a, b) => b.length - a.length)[0] || rest.trim()
  } else {
    const slashIdx = rest.lastIndexOf('/')
    cutTitle = (slashIdx > -1 ? rest.slice(0, slashIdx) : rest).trim()
  }
  return { cutTitle, lipsync, headerType }
}

// 원본 텍스트를 컷 단위로 쪼개 { no, cutTitle, lipsync, mainLines, krLines, ipLines, vpLines } 배열로 반환
function splitV3Cuts(raw) {
  const lines = raw.split('\n')
  const cuts = []
  let cur = null
  let section = null

  const flush = () => { if (cur) cuts.push(cur) }

  for (const line of lines) {
    if (V3_SEP_LINE_RE.test(line.trim())) continue

    const headerM = line.match(V3_CUT_HEADER_RE)
    if (headerM) {
      flush()
      const { cutTitle, lipsync, headerType } = parseCutHeaderMeta(headerM[2] || '')
      cur = { no: parseInt(headerM[1], 10), cutTitle, lipsync, headerType, mainLines: [], krLines: [], ipLines: [], vpLines: [], ipvpLines: [] }
      section = 'main'
      continue
    }
    if (!cur) continue // [CUT N] 등장 전(마스터 코드/EP.HEADER 영역)은 별도 파서에서 처리

    const trimmed = line.trim()
    // [CUT N] 이 아닌 대괄호 표제([제작 체크리스트] 등 에피소드 말미 블록)는 컷 본문 종료로 본다.
    // [캡션 …]은 CAPCUT 컷 imagePrompt 안의 관용 표기라 예외.
    if (/^\[/.test(trimmed) && !V3_CUT_HEADER_RE.test(trimmed) && !/^\[캡션/.test(trimmed)) { section = null; continue }
    // 섹션 헤더: "KR (한글 컨펌본)" / "IP (이미지 프롬프트)" / "VP (영상 프롬프트)" /
    // "IP / VP" (BROLL·GRAPHIC 컷은 IP·VP 를 한 섹션으로 합쳐 쓴다) 모두 인식
    if (/^KR\s*\(/.test(trimmed)) { section = 'kr'; continue }
    if (/^IP\s*\/\s*VP\b/.test(trimmed)) { section = 'ipvp'; continue }
    if (/^IP\s*\(/.test(trimmed)) { section = 'ip'; continue }
    if (/^VP\s*\(/.test(trimmed)) { section = 'vp'; continue }

    if (section === 'main') cur.mainLines.push(line)
    else if (section === 'kr') cur.krLines.push(line)
    else if (section === 'ip') cur.ipLines.push(line)
    else if (section === 'vp') cur.vpLines.push(line)
    else if (section === 'ipvp') cur.ipvpLines.push(line)
  }
  flush()
  return cuts
}

function parseV3MainBlock(mainLines) {
  const fields = {}
  const audio = { bgm: '', voice: '', sfx: '', ambience: '' }
  let inAudio = false
  for (const line of mainLines) {
    if (/^오디오:\s*$/.test(line.trim())) { inAudio = true; continue }
    if (inAudio) {
      const am = line.match(V3_AUDIO_SUBFIELD_RE)
      if (am) { audio[V3_AUDIO_KEY_MAP[am[1]]] = am[2].trim(); continue }
      if (line.trim() === '') continue
      inAudio = false
    }
    const fm = line.match(V3_MAIN_FIELD_RE)
    if (fm) fields[fm[1]] = fm[2].trim()
  }
  return { fields, audio }
}

function parseV3KrBlock(krLines) {
  const kr = {}
  for (const line of krLines) {
    const m = line.trim().match(V3_KR_FIELD_RE)
    if (m) kr[m[1]] = m[3].trim()
  }
  return kr
}

function joinTrimmedLines(lines) {
  let start = 0, end = lines.length
  while (start < end && lines[start].trim() === '') start++
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end).join('\n')
}

function pipelineCodeToCutType(plCode) {
  const p = (plCode || '').toUpperCase()
  if (p.startsWith('BR_')) return 'BROLL'
  if (p.startsWith('GR_')) return 'GRAPHIC'
  if (p.startsWith('CC_')) return 'CAPCUT'
  if (p.startsWith('PIP_')) return 'PIP'
  return 'YEORI' // YR_VD, YR_IM 등
}

// server/lib/scriptParserV3.js의 inferCutType()과 반드시 동일하게 유지할 것.
// IG_RL 등 인스타 콘텐츠는 PL이 항상 "IG_RL" 하나뿐이라 PL만으로는 CapCut 직접제작 컷(텍스트
// 훅/DM 목업 등)을 구분 못 함 — IP에 "이미지 생성 불필요"가 명시되면 PL보다 우선해 CAPCUT으로 분류.
function inferCutType(plCode, ip, headerType, ctField) {
  const TYPES = ['GRAPHIC', 'CAPCUT', 'BROLL', 'YEORI', 'PIP']
  // 1순위: 컷 헤더에 타입 명시 ([CUT N] — GRAPHIC | …  또는  [CUT N]  GRAPHIC — …)
  if (TYPES.includes(headerType)) return headerType
  // 2순위: CT: 필드 명시 (v7 포맷은 컷마다 CT: 로 타입을 박아준다)
  const ct = String(ctField || '').trim().toUpperCase()
  if (TYPES.includes(ct)) return ct
  // 3순위: IP 섹션 마커 — "GRAPHIC 타입 — …" / "이미지 생성 불필요"
  const ipM = String(ip || '').match(/\b(GRAPHIC|CAPCUT|BROLL)\s*타입\b/i)
  if (ipM) return ipM[1].toUpperCase()
  if (/이미지\s*생성\s*불필요/.test(ip || '')) return 'CAPCUT'
  // 4순위: PL 코드 접두사
  return pipelineCodeToCutType(plCode)
}

// PL이 인스타그램 콘텐츠 코드(IG_FD/IG_RL/IG_PT/IG_ST)면 어느 downloads/insta/{content}/
// 하위로 라우팅할지 반환. cutType(위 함수, G2~G5 실행여부를 좌우)과는 완전히 별개 축 —
// 저장 경로·생성 비율만 결정하고 G-단계 스킵 여부에는 관여하지 않는다.
export function pipelineCodeToInstaContent(plCode) {
  const map = { IG_FD: 'FD', IG_RL: 'RL', IG_PT: 'PT', IG_ST: 'ST' }
  return map[(plCode || '').toUpperCase()] || null
}

function parseCutsV3(raw) {
  const rawCuts = splitV3Cuts(raw)
  if (!rawCuts.length) return []

  return rawCuts.map(rc => {
    const { fields, audio } = parseV3MainBlock(rc.mainLines)
    const kr = parseV3KrBlock(rc.krLines)
    // BROLL·GRAPHIC 컷은 "IP / VP" 한 섹션에 소스 안내를 적는다 — 별도 IP/VP 가 비면 이걸 쓴다.
    const ipvp = joinTrimmedLines(rc.ipvpLines || [])
    const ip = joinTrimmedLines(rc.ipLines) || ipvp
    const vp = joinTrimmedLines(rc.vpLines) || ipvp

    // ── 메이킹 탭 자동실행용 컷별 소스 지정 (server/lib/scriptParserV3.js와 동일 유지) ──
    // 명시 필드(HTML:/SRC:/BQ:/URL:/MOTION:) 우선, 없으면 IP/VP 자유텍스트 관용 표기에서 유추
    const _ipvpText = `${ip}\n${vp}\n${ipvp}`
    const htmlFile = String(fields.HTML || '').trim()
      || (_ipvpText.match(/(?:파일|file)\s*[:：]\s*(\S+\.html?)/i)?.[1] || '')
    const sourcePath = String(fields.SRC || '').trim()
      || (_ipvpText.match(/저장\s*경로\s*[:：]\s*(\S.*?\.(?:mp4|mov|mkv|webm|m4v|png|jpg|jpeg))/i)?.[1]?.trim() || '')
    const brollQuery = String(fields.BQ || '').trim()
    const brollUrl = String(fields.URL || '').trim()
    const cutMotion = String(fields.MOTION || '').trim()
    const graphicTemplate = String(fields.GTPL || '').trim()   // 서브라인 3-1
    // CLIP: 웹 영상 한 구간을 screen-scenario 화면녹화로 (⚠️ 공정이용 전제)
    const clip = parseClipField(fields.CLIP)

    const shCode = fields.SH || ''
    const firstSh = shCode.split(/[→>]/)[0].trim()
    const dl = fields.DL && fields.DL !== '없음' ? fields.DL : ''
    const nr = fields.NR && fields.NR !== '없음' ? fields.NR : ''
    // CP(자막): 컷 대본 단계에서 정의하는 손글씨 오버레이 텍스트(순수 텍스트).
    // server/lib/scriptParserV3.js와 동일 규칙 — 반드시 함께 유지.
    const cp = fields.CP && !['없음', '(작성 필요)'].includes(fields.CP.trim()) ? fields.CP.trim() : ''
    const cutType = inferCutType(fields.PL, ip, rc.headerType, fields.CT)

    return {
      id: `cut-${rc.no}`,
      no: rc.no,
      cutTitle: rc.cutTitle || '',
      lipsync: rc.lipsync || /★/.test(audio.voice || ''),
      scene: fields.SC || '',
      action: kr.AC || '',
      character: '서여리',
      dialogue: dl,
      narration: nr,
      subtitle: cp,
      imagePrompt: ip,
      videoPrompt: vp,
      duration: parseInt(fields.DU, 10) || 8,
      shotType: MASTER_CLOSEUP_SHOTS.has(firstSh) ? 'CLOSEUP' : 'FULLBODY',
      cutType,
      cutMark: 'NORMAL',
      ...(parseSegCombo(fields.SEG) ? { segments: parseSegCombo(fields.SEG) } : {}),
      ...(fields.SEGT && parseSegTiming(fields.SEGT, (parseSegCombo(fields.SEG) || []).length) ? { segTiming: parseSegTiming(fields.SEGT, (parseSegCombo(fields.SEG) || []).length) } : {}),
      ...(fields.SEGP && parseSegPrompts(fields.SEGP, (parseSegCombo(fields.SEG) || []).length) ? { segPrompts: parseSegPrompts(fields.SEGP, (parseSegCombo(fields.SEG) || []).length) } : {}),
      // server/lib/scriptParserV3.js와 반드시 동일하게 유지 — PIP_VD 컷 전용 필드.
      // pipTarget은 이 파일의 기존 PIP 메커니즘(수동 입력 필드, cutType === 'PIP' 케이스)과
      // 같은 필드명 — 별개로 두지 않고 그대로 재사용.
      ...(cutType === 'PIP' ? { pipTarget: '', pipLayout: 'bottom_right', pipScale: 0.35 } : {}),
      // 메이킹 탭 자동실행이 읽는 컷별 소스 필드 — 값이 있을 때만 실음
      ...(htmlFile ? { htmlFile } : {}),
      ...(sourcePath ? { sourcePath } : {}),
      ...(brollQuery ? { brollQuery } : {}),
      ...(brollUrl ? { brollUrl } : {}),
      ...(cutMotion ? { motion: cutMotion } : {}),
      ...(graphicTemplate ? { graphicTemplate } : {}),
      ...(clip ? { clipUrl: clip.url, clipSeek: clip.seekSec, clipDuration: clip.durationSec } : {}),
      masterCode: {
        sp: fields.SP || '', pl: fields.PL || '', ch: fields.CH || '',
        sh: shCode, ca: fields.CA || '', md: fields.MD || '', ac: fields.AC || '',
        lookId: fields.LOOK_ID || '', du: parseInt(fields.DU, 10) || 8,
        audio,
        kr: { sp: kr.SP || '', ch: kr.CH || '', sh: kr.SH || '', ca: kr.CA || '', ac: kr.AC || '', md: kr.MD || '' },
      },
    }
  })
}

// 마스터 코드 / EP.HEADER 글로벌 블록(====으로 감싼 부분) — 컷별 파서와 별개로
// 에피소드 단위 메타로 보관해둔다(2단계 사이드바 표시용, 현재는 원문 그대로 저장만)
function parseV3GlobalHeader(raw) {
  // "마스터 코드" 제목 줄 바로 다음 줄이 코드 본문(중간에 ==== 구분선 없음),
  // EP.HEADER는 제목과 본문 사이에 ==== 구분선이 하나 더 있어 패턴이 다르다.
  const mcMatch = raw.match(/마스터\s*코드\s*\n([^\n=][^\n]*)/)
  const masterCode = mcMatch ? mcMatch[1].trim() : ''
  const headerMatch = raw.match(/EP\.HEADER\s*\n={10,}\s*\n([\s\S]*?)\n={10,}/)
  const epHeaderRaw = headerMatch ? headerMatch[1].trim() : ''
  return { masterCode, epHeaderRaw }
}

// ── Claude 수정 요청(handleRevision)용 — v3 필드 어휘로 컷 직렬화 / 응답 병합 ──
// 옛 "씬:/액션:/샷 타입:" 포맷 대신 v3 코드 필드(SP/PL/SH/CA/MD/AC)와 메이킹 소스
// 필드(CT/HTML/GTPL/SRC/URL/BQ/CLIP/MOTION)를 그대로 주고받아, 코드·자동화 필드까지
// 수정 요청으로 편집 가능하게 한다. 응답 파싱은 v3 파서(splitV3Cuts+parseV3MainBlock) 재사용.
function serializeCutForRevision(c) {
  const m = c.masterCode || {}
  const L = [`[CUT ${c.no}]${c.cutTitle ? `  ${c.cutTitle}` : ''}`]
  L.push(`SC: ${c.scene || ''}`)
  L.push(`SP: ${m.sp || ''}`)
  L.push(`PL: ${m.pl || ''}`)
  L.push(`CH: ${m.ch || c.character || '서여리'}`)
  L.push(`DL: ${c.dialogue || '없음'}`)
  L.push(`NR: ${c.narration || '없음'}`)
  L.push(`CP: ${c.subtitle || '없음'}`)
  L.push(`SH: ${m.sh || ''}`)
  L.push(`CA: ${m.ca || ''}`)
  L.push(`MD: ${m.md || ''}`)
  L.push(`AC: ${m.ac || ''}`)
  L.push(`DU: ${c.duration || 8}`)
  if (Array.isArray(c.segments) && c.segments.length > 1) {
    L.push(`SEG: ${c.segments.join('+')}`)
    if (Array.isArray(c.segTiming) && c.segTiming.length === c.segments.length) {
      L.push(`SEGT: ${c.segTiming.map(t => Array.isArray(t) ? `${t[0]}-${t[1]}` : '').join(',')}`)
    }
    if (Array.isArray(c.segPrompts) && c.segPrompts.length === c.segments.length) {
      L.push(`SEGP: ${formatSegPrompts(c.segPrompts)}`)
    }
  }
  L.push(`CT: ${c.cutType || 'YEORI'}`)
  if (c.htmlFile) L.push(`HTML: ${c.htmlFile}`)
  if (c.graphicTemplate) L.push(`GTPL: ${c.graphicTemplate}`)
  if (c.sourcePath) L.push(`SRC: ${c.sourcePath}`)
  if (c.brollUrl) L.push(`URL: ${c.brollUrl}`)
  if (c.brollQuery) L.push(`BQ: ${c.brollQuery}`)
  if (c.clipUrl) L.push(`CLIP: ${c.clipUrl}${c.clipSeek ? ` @ ${c.clipSeek}` : ''}${c.clipDuration ? ` +${c.clipDuration}` : ''}`)
  if (c.motion) L.push(`MOTION: ${c.motion}`)
  return L.join('\n')
}

// v3 메인블록 파싱 결과(fields) → dispatch UPDATE_CUT 용 patch. original 은 masterCode 병합용.
function v3RevisionPatch(fields, original) {
  const p = {}
  const mc = { ...(original.masterCode || {}) }
  let mcTouched = false
  const isBlank = (v) => v == null || String(v).trim() === ''
  const clr = (v) => /^(없음|\(작성 필요\))$/.test(String(v).trim())
  const setMc = (k, v) => { if (!isBlank(v)) { mc[k] = String(v).trim(); mcTouched = true } }

  if (fields.SC != null) p.scene = fields.SC
  if (fields.DL != null) p.dialogue = clr(fields.DL) ? '' : fields.DL
  if (fields.NR != null) p.narration = clr(fields.NR) ? '' : fields.NR
  if (fields.CP != null) p.subtitle = clr(fields.CP) ? '' : fields.CP
  if (fields.DU != null) { const d = parseInt(fields.DU, 10); if (d) p.duration = d }
  // SEG: "8+8+10" → segments 배열. 없거나 "auto"/형식불량이면 그동안 있던 세그 지정을 지운다
  // (필드가 아예 없던 컷이면 fields.SEG 도 undefined 라 이 분기 자체를 안 탐 — 기존 값 유지).
  if (fields.SEG != null) p.segments = parseSegCombo(fields.SEG) || undefined
  // SEGT: "2-8,0-3" → segTiming([[시작,끝]|null,...]). 세그 개수(방금 위에서 갱신됐거나 기존값)와
  // 맞아야 유효 — 안 맞으면 무시(구간 미지정 기본 동작으로 폴백).
  if (fields.SEGT != null) {
    const segCount = (p.segments || original.segments || []).length
    p.segTiming = parseSegTiming(fields.SEGT, segCount) || undefined
  }
  // SEGP: "prompt1 ||| prompt2" → segPrompts(세그별 영문 비주얼 프롬프트 배열).
  if (fields.SEGP != null) {
    const segCount = (p.segments || original.segments || []).length
    p.segPrompts = parseSegPrompts(fields.SEGP, segCount) || undefined
  }
  if (fields.CT != null) { const t = fields.CT.trim().toUpperCase(); if (['YEORI', 'BROLL', 'GRAPHIC', 'CAPCUT', 'PIP'].includes(t)) p.cutType = t }
  if (!isBlank(fields.SH)) {
    setMc('sh', fields.SH)
    p.shotType = MASTER_CLOSEUP_SHOTS.has(fields.SH.split(/[→>]/)[0].trim()) ? 'CLOSEUP' : 'FULLBODY'
  }
  setMc('sp', fields.SP); setMc('pl', fields.PL); setMc('ch', fields.CH)
  setMc('ca', fields.CA); setMc('md', fields.MD); setMc('ac', fields.AC); setMc('lookId', fields.LOOK_ID)
  if (!isBlank(fields.CH)) p.character = fields.CH.trim()

  if (fields.HTML != null) p.htmlFile = fields.HTML.trim()
  if (fields.GTPL != null) p.graphicTemplate = fields.GTPL.trim()
  if (fields.SRC != null) p.sourcePath = fields.SRC.trim()
  if (fields.URL != null) p.brollUrl = fields.URL.trim()
  if (fields.BQ != null) p.brollQuery = fields.BQ.trim()
  if (fields.MOTION != null) p.motion = fields.MOTION.trim()
  if (fields.CLIP != null) {
    const clip = parseClipField(fields.CLIP)
    if (clip) { p.clipUrl = clip.url; p.clipSeek = clip.seekSec; p.clipDuration = clip.durationSec }
  }
  if (mcTouched) p.masterCode = mc
  return p
}

// cuts 배열 -> v3 표준 포맷 텍스트 (다운로드용, parseCutsV3로 다시 읽을 수 있게 대칭 유지)
function buildV3ScriptText(cuts, episode) {
  const sep = '━'.repeat(24)
  const eq = '='.repeat(64)
  const blocks = cuts.map(c => {
    const mc = c.masterCode || {}
    const audio = mc.audio || {}
    const kr = mc.kr || {}
    const titlePart = c.cutTitle ? ` ${mc.pl || ''} — ${c.cutTitle} / ${c.duration || 8}초${c.lipsync ? '  ★립싱크' : ''}` : ` ${mc.pl || ''} / ${c.duration || 8}초`
    const lines = [
      sep,
      `[CUT ${c.no}] ${titlePart}`,
      sep,
      `SC: ${c.scene || ''}`,
      `SP: ${mc.sp || ''}`,
      `PL: ${mc.pl || ''}`,
      `CH: ${mc.ch || ''}`,
      `DL: ${c.dialogue || '없음'}`,
      `NR: ${c.narration || '없음'}`,
      `CP: ${c.subtitle || '없음'}`,
      `SH: ${mc.sh || ''}`,
      `CA: ${mc.ca || ''}`,
      `MD: ${mc.md || ''}`,
      `AC: ${mc.ac || ''}`,
      `LOOK_ID: ${mc.lookId || ''}`,
      `DU: ${c.duration || 8}`,
      ...(Array.isArray(c.segments) && c.segments.length > 1 ? [`SEG: ${c.segments.join('+')}`] : []),
      ...(Array.isArray(c.segments) && c.segments.length > 1 && Array.isArray(c.segTiming) && c.segTiming.length === c.segments.length
        ? [`SEGT: ${c.segTiming.map(t => Array.isArray(t) ? `${t[0]}-${t[1]}` : '').join(',')}`] : []),
      ...(Array.isArray(c.segments) && c.segments.length > 1 && Array.isArray(c.segPrompts) && c.segPrompts.length === c.segments.length
        ? [`SEGP: ${formatSegPrompts(c.segPrompts)}`] : []),
      ...(c.htmlFile ? [`HTML: ${c.htmlFile}`] : []),
      ...(c.sourcePath ? [`SRC: ${c.sourcePath}`] : []),
      ...(c.brollQuery ? [`BQ: ${c.brollQuery}`] : []),
      ...(c.brollUrl ? [`URL: ${c.brollUrl}`] : []),
      ...(c.clipUrl ? [`CLIP: ${c.clipUrl}${c.clipSeek ? ` @ ${c.clipSeek}` : ''}${c.clipDuration ? ` +${c.clipDuration}` : ''}`] : []),
      ...(c.motion ? [`MOTION: ${c.motion}`] : []),
      ...(c.graphicTemplate ? [`GTPL: ${c.graphicTemplate}`] : []),
      '오디오:',
      `  BGM: ${audio.bgm || ''}`,
      `  음성: ${audio.voice || ''}`,
      `  효과음: ${audio.sfx || ''}`,
      `  앰비언스: ${audio.ambience || ''}`,
      '',
      sep,
      'KR (한글 컨펌본)',
      sep,
      `SP(장소):     ${kr.sp || ''}`,
      `CH(캐릭터):   ${kr.ch || ''}`,
      `SH(샷):       ${kr.sh || ''}`,
      `CA(카메라):   ${kr.ca || ''}`,
      `AC(동작):     ${kr.ac || ''}`,
      `MD(감정):     ${kr.md || ''}`,
      `DL(대사):     ${c.dialogue || ''}`,
      `NR(나레이션): ${c.narration || ''}`,
      `CP(자막):     ${c.subtitle || ''}`,
      '',
      sep,
      'IP (이미지 프롬프트)',
      sep,
      c.imagePrompt || '',
      '',
      sep,
      'VP (영상 프롬프트)',
      sep,
      // 발화 컷은 VP 에 실제 대사/나레이션 텍스트를 명시(멱등) — vp-dialogue-seg-spec.md 1단계
      ensureDialogueInVP(c) || '',
      sep,
    ]
    return lines.join('\n')
  })

  const header = [
    eq,
    '마스터 코드',
    episode?.masterCode || '(미지정)',
    eq,
    'EP.HEADER',
    eq,
    episode?.epHeaderRaw || `EP    : ${episode?.title || ''}`,
    eq,
  ].join('\n')

  return `${header}\n\n\n${blocks.join('\n\n\n')}\n`
}

export default function ScriptGenTab() {
  const { state, dispatch } = useApp()
  const { episode, scriptRaw, cuts, apiKeys, episodes, activeEpisodeId } = state
  // episode.code(3차 정식 필드) 우선, 레거시 에피소드는 과도기 방식(번호)으로 대체.
  // 활성 에피소드 하나만 다루는 곳은 이 값을 쓰고, 에피소드 목록처럼 여러 에피소드를
  // 동시에 순회하는 곳(아래 epCuts 관련 두 군데)은 반드시 각 ep 자신의 코드를 써야 함 —
  // 안 그러면 다른 에피소드끼리 같은 컷 번호의 G1 상태를 서로 덮어써서 보여주는 버그가 남.
  const episodeCode = resolveEpisodeCode(episode)
  // 대본 EP.HEADER의 "EP: LF_T01" 값 — 에피소드 코드를 대본 기준으로 맞출 때 쓴다
  const epHeaderCode = (() => {
    const m = String(episode?.epHeaderRaw || '').match(/^\s*EP\s*:\s*(\S+)/mi)
    return m ? m[1].trim().toUpperCase() : ''
  })()
  const derivedCode = formatEpisodeCode(episode?.contentType || 'LF', episode?.number)

  // 에피소드 코드 입력 — 전역 유일해야 함(downloads/episodes/{code}/ 폴더 키).
  // 로컬 draft로 들고 있으면서 중복이면 경고 + dispatch는 reducer가 막음(SET_EPISODE).
  const [codeDraft, setCodeDraft] = useState(episode?.code || '')
  useEffect(() => { setCodeDraft(episode?.code || '') }, [activeEpisodeId, episode?.code])
  const codeClashEp = (() => {
    const c = codeDraft.trim().toUpperCase()
    if (!c) return null
    const hit = Object.values(episodes || {}).find(
      e => e.id !== activeEpisodeId && String(e.episode?.code || '').toUpperCase() === c
    )
    return hit ? hit.episode : null
  })()

  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [activeCut, setActiveCut] = useState(0)
  const [numError, setNumError] = useState('')
  const [flowRunning, setFlowRunning] = useState(false)
  const [flowLogs, setFlowLogs] = useState([])
  const [flowDone, setFlowDone] = useState(false)
  const [episodeOpen, setEpisodeOpen] = useState(false)
  const [gData, setGData] = useState(() => loadGPoints())
  const [revisionInput, setRevisionInput] = useState('')
  const [revisionLoading, setRevisionLoading] = useState(false)
  const [revisionHistory, setRevisionHistory] = useState([])
  const [viewMode, setViewMode] = useState('detail') // 'list' | 'detail'

  // ── 마스터 코드 대본 생성 (script_generator.py + script_to_prompts.py) ──
  const [masterCode, setMasterCode] = useState('')
  const [mcLoading, setMcLoading] = useState(false)
  const [mcError, setMcError] = useState('')
  const [mcPreview, setMcPreview] = useState(null) // 생성된 prompts.json ({ episode, cuts })
  const [mcMeta, setMcMeta] = useState(null) // script.txt SCRIPT META 헤더 ({ episode, version, date, status, changes, cuts })
  const [showChangesModal, setShowChangesModal] = useState(false)
  const [changesInput, setChangesInput] = useState('')

  // 이 탭은 에피소드를 전환해도 컴포넌트가 언마운트되지 않아서, 위 "마스터 코드로
  // 대본 생성" 입력값이 이전 에피소드 것 그대로 남아있는 문제가 있었다(예: A 에피소드의
  // 코드를 입력해두고 새 에피소드로 넘어가면 그 입력값이 그대로 남아 새 에피소드에
  // 엉뚱한 대본을 생성시킬 수 있었음). 활성 에피소드가 바뀔 때마다 이 패널을 비운다.
  useEffect(() => {
    setMasterCode('')
    setMcError('')
    setMcPreview(null)
    setMcMeta(null)
    setShowChangesModal(false)
    setChangesInput('')
  }, [activeEpisodeId])

  // Codi_GEN(code_generator_v1.html)의 "생성" 버튼이 만든 결과를 마운트 시 1회
  // 가져온다. Codi_GEN은 file://, 이 앱은 http://localhost:5173라 origin이 달라
  // localStorage를 공유할 수 없어서 서버(/api/codi-gen-handoff)를 경유한다(GET이
  // 읽음과 동시에 서버 파일을 지워 1회성 소비를 보장). 위 마스터 코드 입력 흐름과
  // 동일하게 mcPreview/mcMeta에만 반영하고 "실제 적용" 버튼을 눌러야 cuts에 반영되는
  // 안전장치는 그대로 유지 — Codi_GEN에서 왔다고 자동으로 덮어쓰지 않는다.
  //
  // ⚠️ 2026-09-11 수정 — Field Gate(yeori-genline)도 같은 큐를 씀(source:'genline',
  // {episodeCode, cutNo, revision}). 이건 "컷 하나 필드만 patch"하는 모양이라 위 mcPreview
  // (통짜 { episode, cuts:[...] } 기대)와 안 맞음 — 그대로 두면 mcPreview.cuts 가 undefined 라
  // 미리보기 렌더가 깨지고, "실제 적용"을 누르면 SET_CUTS([]) 로 전체 컷이 날아갈 뻔했다.
  // → source==='genline' 이면 별도 genlinePatch 로 갈라서, 그 컷 하나만 UPDATE_CUT 으로 병합한다.
  const [genlinePatch, setGenlinePatch] = useState(null) // { cutNo, fields:{...v3 필드}, meta, raw }
  // ⚠️ 2026-09-12 수정 — 예전엔 SEG|DL|NR 세 필드만 인식해서, genline의 diagnose()가 만드는
  // "SC:/SH:/DU:" 같은 일반 대본 수정안은 파싱 자체가 안 되고(fields가 사실상 빈 객체) 조용히
  // 버려졌음(CUT 2 사례로 실사용 중 발견 — "적용"을 눌러도 실제로 아무것도 안 바뀌는 상태였음).
  // v3RevisionPatch가 이미 아는 전체 필드 어휘(V3_MAIN_FIELD_RE)를 그대로 재사용해 파싱한다.
  const parseGenlineRevision = (raw) => {
    const fields = {}
    for (const line of String(raw || '').split('\n')) {
      const m = line.match(V3_MAIN_FIELD_RE)
      if (m) fields[m[1]] = m[2].trim()
    }
    return fields
  }
  useEffect(() => {
    fetch('http://localhost:3001/api/codi-gen-handoff')
      .then(res => res.json())
      .then(data => {
        if (!data?.ok || !data.pending) return
        if (data.prompts?.source === 'genline') {
          setGenlinePatch({
            cutNo: data.prompts.cutNo, episodeCode: data.prompts.episodeCode,
            fields: parseGenlineRevision(data.prompts.revision), meta: data.meta || null,
          })
          return
        }
        setMcPreview(data.prompts)
        setMcMeta(data.meta || null)
        setMasterCode('(Codi_GEN에서 전달받음 — 코드 확인은 생략)')
      })
      .catch(err => console.warn('[codi_gen handoff] 조회 실패(proxy.js 실행 중인지 확인):', err.message))
  }, [])

  // Field Gate 컷 단위 패치 적용 — 해당 컷만 UPDATE_CUT 으로 병합.
  // v3RevisionPatch(기존 Codi_GEN 수정요청 경로가 쓰는, 전체 v3 필드를 아는 검증된 매퍼)를
  // 그대로 재사용 — 예전엔 여기서 DL/NR/SEG 세 필드만 직접 골라 썼어서 SC/SH/DU 등은
  // 파싱은 됐어도(위 parseGenlineRevision) 적용 단계에서 그냥 버려졌다.
  const applyGenlinePatch = () => {
    if (!genlinePatch) return
    const cutNo = parseInt(genlinePatch.cutNo, 10)
    const target = cuts.find(c => c.no === cutNo)
    if (!target) { setMcError(`CUT ${cutNo} 을 찾을 수 없습니다(현재 에피소드가 다를 수 있음)`); setGenlinePatch(null); return }
    const p = v3RevisionPatch(genlinePatch.fields, target)
    dispatch({ type: 'UPDATE_CUT', id: target.id, p })
    setGenlinePatch(null)
  }

  // ── 서여리 연출 원칙 룰셋 v1.1 ─────────────────────────────
  const YEORI_RULESET = `
=== 서여리 연출 원칙 룰셋 v1.1 (반드시 준수) ===

[컷 타입 분류 — 필수]
모든 컷은 반드시 아래 5가지 중 하나로 분류하고, "컷 타입:" 필드에 명시한다:

◆ YEORI  — 서여리가 직접 등장 (대사 or 감정 연기 있음)
  → 립싱크 대사 컷, 서여리 얼굴·바디 있는 컷
  → 이미지 프롬프트: CLOSEUP SHOT 또는 FULLBODY SHOT 필수
  → G2(이미지)+G3(대사 TTS)+G4(립싱크 영상)+G5(편집) 전체 실행

◆ BROLL  — 서여리 얼굴 없는 배경/소품 영상 + 나레이션
  → 커피잔 클로즈업, 거리 풍경, 손동작, 배경 디테일
  → 이미지 프롬프트: 서여리 미등장 배경/오브젝트 묘사
  → G2(이미지)+G3(나레이션 TTS)+G4(영상)+G5(편집) 실행

◆ GRAPHIC — 그래픽·데이터·인포그래픽·자막 카드
  → 통계 차트, 텍스트 슬라이드, 인포그래픽
  → 이미지 프롬프트 불필요 (그래픽 도구로 직접 제작)
  → G3(나레이션 TTS)+G5(browser_record) 실행, G2·G4 건너뜀

◆ CAPCUT — CapCut 전용 편집 컷 (텍스트 효과·화면 분할·모션 타이틀)
  → 자막만 있는 컷, 인트로/아웃트로 모션
  → 이미지 프롬프트 불필요
  → G5(capcut_only) 실행, G2·G3·G4 건너뜀

◆ PIP    — PIP 오버레이 (메인 영상 위 서여리 클로즈업 삽입)
  → 화면 속 화면, 반응 PIP, 감정 오버레이
  → 이미지 프롬프트: CLOSEUP SHOT 필수
  → PIP_TARGET에 배경 컷 번호 반드시 기재
  → G2(이미지)+G3(대사 TTS)+G4(영상)+G5(PIP합성) 실행

[샷 타입 분류 — 필수]
모든 컷은 반드시 아래 두 가지 중 하나로 분류한다:

◆ CLOSEUP (클로즈업)
  - 얼굴·상반신 위주 컷 (표정, 눈빛, 감정 강조)
  - 서여리 레퍼런스 이미지를 직접 활용하는 컷
  - 이미지 프롬프트: "CLOSEUP SHOT —" 으로 시작
  - 얼굴 재현이 핵심이므로 프롬프트에 얼굴 특징 정밀 기술 생략 가능
    (레퍼런스 이미지가 직접 사용됨)
  - 대신 표정·감정·조명·분위기 묘사에 집중

◆ FULLBODY (풀바디/씬)
  - 전신·배경·이동·공간감 강조 컷
  - Google Flow로 생성하는 컷
  - 이미지 프롬프트: "FULLBODY SHOT —" 으로 시작
  - 얼굴이 작게 보이므로 씬·의상·체형·배경 묘사에 집중
  - K-model proportions, very small face, long slim legs 필수 포함

[캐릭터 일관성 — 절대 원칙]
- 스타트 프레임: 반드시 서여리 얼굴 있는 이미지 기준
- 헤어: long wavy dark brown hair / NOT short — 이중 강조 필수
- 시그니처: "natural skin texture on right cheek" — 아주 희미하게, 과장 금지
- 의상: DO NOT change clothing — 색상·소재·스타일 명시
- 소품: 골드 목걸이·브레이슬렛 등 디테일 명시
- 나이: "early 20s, appearing no older than 22-23" 명시
- 스타일: Photorealistic 8K cinematic, natural Korean beauty
- 체형: "K-model proportions, very small face, long slim legs, slender figure" — FULLBODY 필수 포함
- 비율: "small head-to-body ratio, DO NOT make average body proportions" — FULLBODY 필수 포함

[컷 길이 기준 — 8초 단위 (필수)]
- 1컷 기본 길이: 8초
- 8~10초: 1컷으로 처리 (10초까지 허용)
- 11초: 절대 금지 — 10초 이하로 압축하거나 12초 이상으로 늘려서 분할 처리할 것
- 12~15초: 2컷으로 분할 (전반 8초 + 후반 4~7초, 후반이 8초 미만이면 액션 필드 끝에 "편집 가이드: 후반 N초로 마무리" 메모 추가)
- 16초: 동작이 단순하면 2컷(전반 8초 + 후반 8초), 감정선이 깊거나 분위기 전환이 중요하면 3컷 롱테이크(앞 4~6초 + 메인 10초 + 뒤 4~6초)
- 17~20초: 3컷 롱테이크 (앞 도입 4~6초 + 메인 테이크 10초 + 뒤 여운 4~6초)
- 분할된 각 컷은 독립된 CUT 번호를 가지며(CUT 2, CUT 3...), "CUT 2-a" 같은 하위 표기는 절대 금지
- 분할 시 전반 컷의 마지막 동작과 후반 컷의 시작 동작이 시각적으로 끊기지 않도록 자연스럽게 재배치
- 대사는 분할하지 않고 각 컷에 자연스럽게 배분 가능

[영상 생성 원칙]
- 프롬프트에 대사 텍스트 절대 금지 (립싱크+행동 동시 발생 방지)
- 행동은 시간 단위로 분리: "First 3s / Next 3s / Final 4s"
- CLOSEUP과 FULLBODY를 스토리 흐름에 맞게 교차 편집
- 배경 인물은 허용하되 서여리 연출에 개입·간섭 금지
  → "background people must not interact with the main character"

[K감성 / 리얼리티]
- "effortlessly photogenic, not posing, just existing beautifully"
- 증명사진 느낌 NG
- 현실적 K감성 디테일 필수 (볼캡 여유감, 부츠컷 롤업 등)
- 디테일 오류 방지 (소품 중복·변형 주의)

[스토리텔링]
- 3막 구조: 사건 → 감정변화 → 선택
- 서여리 = 감성 큐레이터 (다양한 소재를 서여리 시선으로 필터링)
- 시각 요소는 반드시 대사/스토리와 연결
- 엔딩: 대사 끝 후 여운 2~3초 필수 (침묵, 컵 바라보기 등)
- BGM 대비: 감정 전환점에서 BGM 완전 중단 → 현장감 극대화

[이미지 프롬프트 생성 시 체크리스트]
□ 샷 타입 명시: "CLOSEUP SHOT —" 또는 "FULLBODY SHOT —" 으로 시작
□ long wavy dark brown hair, NOT short 이중 강조 포함
□ CLOSEUP: natural skin texture 문구 + 표정/감정/조명 묘사 집중
□ FULLBODY: K-model proportions, small face, long legs, DO NOT make average body
□ DO NOT change clothing 포함
□ 배경 인물 개입 방지 문구 포함
□ 대사 텍스트 없음
□ 행동이 시간 단위로 분리됨
□ K감성 디테일 1개 이상 포함
=== 룰셋 끝 ===`

  const generateScript = async () => {
    if (!apiKeys.claude) { alert('Claude API 키를 입력하세요 (상단 API 바)'); return }
    setLoading(true)
    setProgress('Claude에게 요청 중...')

    const prompt = `당신은 한국 유튜브 숏폼/영상 전문 대본 작가입니다.
아래 연출 원칙을 반드시 준수하여 대본과 이미지 프롬프트를 생성하세요.

${YEORI_RULESET}

위 룰셋을 완전히 내재화한 상태에서
아래 설정에 맞는 유튜브 영상 대본을 작성해주세요.
기준 장면 수는 ${episode.cutCount}개이지만, 룰셋의 [컷 길이 기준]에 따라 8초를 초과하는 장면은
여러 컷으로 자동 분할되므로 최종 컷 수는 ${episode.cutCount}개보다 많아질 수 있습니다.
각 컷은 반드시 8초 기준 분할 규칙을 따르고, 컷 길이(초)를 정확히 명시하세요.

에피소드 번호: ${episode.number}
제목: ${episode.title || '(자유 설정)'}
배경 장소: ${episode.location}
전체 분위기: ${Array.isArray(episode.mood) ? episode.mood.join(' + ') : episode.mood}
주인공 캐릭터: ${episode.character}

각 컷은 반드시 아래 형식으로 작성하세요.
⚠️ 중요: 마크다운 형식 절대 금지! ** 굵은 글씨, # 헤더, --- 구분선 사용 금지!
⚠️ 반드시 아래 키워드로 시작하는 줄 형식만 사용할 것!

[CUT 1]
씬: INT/EXT. 장소 - 시간대
액션: 주인공의 행동 묘사 — First 3s: / Next 3s: / Final 4s: 형식으로 분리
캐릭터: 서여리
대사: 실제 대사 (자연스러운 한국어, 없으면 "없음" 으로 표기)
나레이션: 보이스오버 나레이션 (감성적으로)
샷 타입: CLOSEUP 또는 FULLBODY (반드시 명시)
컷 타입: YEORI 또는 BROLL 또는 GRAPHIC 또는 CAPCUT 또는 PIP (반드시 명시)
이미지 프롬프트: 영어로 작성, "CLOSEUP SHOT —" 또는 "FULLBODY SHOT —" 으로 시작, 룰셋 체크리스트 전체 반영

[CUT 2]
씬:
액션:
캐릭터: 서여리
대사:
나레이션:
샷 타입:
컷 타입:
이미지 프롬프트:

[CUT ${episode.cutCount}]
씬:
액션:
캐릭터: 서여리
대사:
나레이션:
샷 타입:
컷 타입:
이미지 프롬프트:

※ 위는 형식 예시이며, 분할이 발생하면 [CUT N+1], [CUT N+2]... 형식으로 자연스럽게 이어서 작성하세요.

⚠️ 절대 지킬 것:
- 마크다운 ** ## --- 완전 금지
- 각 필드는 반드시 "씬:" "액션:" "캐릭터:" "대사:" "나레이션:" "샷 타입:" "컷 타입:" "이미지 프롬프트:" 로 시작
- [CUT 번호] 형식 정확히 유지
- 대사 없는 컷은 대사: 없음 으로 표기
- 컷 타입: 필드 반드시 명시 (YEORI/BROLL/GRAPHIC/CAPCUT/PIP 중 정확히 하나)
- PIP 컷에는 PIP_TARGET: [배경 컷 번호] 추가 (예: PIP_TARGET: 3)
- GRAPHIC·CAPCUT 컷은 이미지 프롬프트: 없음 으로 표기
- 이미지 프롬프트 끝에 ✅ 룰셋 통과 또는 ⚠️ [항목명] 확인 필요 표시

대사는 구어체로 자연스럽게, 나레이션은 감성적으로 작성하세요.
이미지 프롬프트는 영어로, 룰셋의 체크리스트를 모두 통과한 상태로 작성하세요.`

    try {
      const res = await claudeMessages(apiKeys.claude, {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || '오류') }
      const data = await res.json()
      const raw = data.content[0].text
      setProgress('대본 파싱 중...')
      dispatch({ type: 'SET_SCRIPT_RAW', p: raw })
      const parsed = parseCuts(raw, episode.cutCount)
      dispatch({ type: 'SET_CUTS', p: parsed })

      // ── 룰셋 자동 체크 ──────────────────────────────────
      let passCount = 0, failItems = []
      parsed.forEach(cut => {
        const p = cut.imagePrompt || ''
        const ct = cut.cutType || 'YEORI'
        const needsImage = !['GRAPHIC', 'CAPCUT'].includes(ct)

        if (!PIPE_TYPES.has(ct)) failItems.push(`CUT${cut.no}: 컷 타입 누락 또는 미인식 (현재: "${ct}")`)

        if (needsImage) {
          const isClose = cut.shotType === 'CLOSEUP'
          const isFull  = cut.shotType === 'FULLBODY'
          if (!isClose && !isFull) failItems.push(`CUT${cut.no}: 샷 타입 누락 (CLOSEUP/FULLBODY 미명시)`)
          if (!p.match(/CLOSEUP SHOT|FULLBODY SHOT/i)) failItems.push(`CUT${cut.no}: 프롬프트 샷 타입 접두어 누락`)
          if (['YEORI', 'PIP'].includes(ct)) {
            if (!p.includes('NOT short')) failItems.push(`CUT${cut.no}: 헤어 이중강조 누락`)
            if (isClose && !p.includes('skin texture') && !p.includes('beauty mark')) failItems.push(`CUT${cut.no}: CLOSEUP natural skin texture 문구 누락`)
            if (isFull && !p.match(/K-model|small face|long.*legs/i)) failItems.push(`CUT${cut.no}: FULLBODY 체형 문구 누락`)
          }
        }
        passCount++ // 의상 묘사는 형식 강제 없이 통과 처리 (2026-06-14/06-21 명령형 폐기 결정 반영)
      })

      // ── G1 포인트 자동 저장 ──────────────────────────────
      parsed.forEach(cut => {
        const hasContent = !!(cut.dialogue || cut.narration || cut.scene)
        setGPoint(episodeCode, cut.no, 'g1', hasContent)
      })

      if (failItems.length > 0) {
        setProgress(`⚠️ 룰셋 미달 ${failItems.length}항목 — 이미지 프롬프트 확인 권장`)
        console.warn('[룰셋 체크]', failItems)
      } else {
        setProgress('✅ 완료! 룰셋 통과 · G1 포인트 업데이트됨')
      }
      setTimeout(() => setProgress(''), 3000)
    } catch (err) {
      alert('오류: ' + err.message)
      setProgress('')
    } finally {
      setLoading(false)
    }
  }

  // 마스터 코드 -> /api/generate-script (script_generator.py + script_to_prompts.py 실행,
  // prompts.json 자동 갱신) -> 결과는 mcPreview에만 저장 (AppContext는 건드리지 않음 —
  // "실제 적용" 버튼을 눌러야만 cuts/저장에 반영되는 테스트 모드 안전장치)
  const generateFromMasterCode = async () => {
    if (!masterCode.trim()) { setMcError('마스터 코드를 입력하세요'); return }
    setMcLoading(true)
    setMcError('')
    setMcPreview(null)
    try {
      const res = await fetch('http://localhost:3001/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: masterCode }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `서버 오류 ${res.status}`)

      setMcPreview(data.prompts)
      setMcMeta(data.meta || null)
    } catch (err) {
      setMcError(err.message)
    } finally {
      setMcLoading(false)
    }
  }

  // 미리보기(mcPreview)를 실제로 AppContext에 반영 — 이 버튼을 눌러야만 cuts가
  // 교체되고 studio-state.json 자동저장이 트리거됨
  const applyMasterCodeResult = () => {
    if (!mcPreview) return
    const mappedCuts = mapPromptsCutsToAppCuts(mcPreview.cuts)
    dispatch({ type: 'SET_CUTS', p: mappedCuts })
    mappedCuts.forEach(c => setGPoint(episodeCode, c.no, 'g1', false)) // 새 컷은 검토 전이므로 G1 미승인 상태로 시작
    setGData(loadGPoints())
    setActiveCut(0)
    setMcPreview(null)
    setMcMeta(null)
  }

  // "실제 적용" 클릭 -> 변경 내용 입력 모달을 확인한 뒤 실제 반영 + Notion 이력 기록
  const confirmApplyMasterCode = async () => {
    const changes = changesInput.trim() || '수동 수정'
    const meta = mcMeta
    setShowChangesModal(false)
    setChangesInput('')
    applyMasterCodeResult()

    if (!meta) return // script_generator.py가 헤더를 못 남겼으면(구버전 등) 이력 기록은 건너뜀
    const cutDetail = meta.cuts > 1 ? `C01~C${String(meta.cuts).padStart(2, '0')}` : 'C01'
    try {
      const res = await fetch('http://localhost:3001/api/update-script-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeCode: meta.episode,
          version: meta.version,
          date: meta.date,
          status: meta.status,
          changes,
          cuts: meta.cuts,
          cutDetail,
        }),
      })
      const data = await res.json()
      if (!data.success) console.warn('[Notion] 스크립트 이력 업데이트 실패:', data.error)
    } catch (err) {
      console.warn('[Notion] 스크립트 이력 업데이트 실패(proxy.js 실행 중인지 확인):', err.message)
    }
  }

  const updateCut = (id, field, val) => {
    dispatch({ type: 'UPDATE_CUT', id, p: { [field]: val } })
    // 대사/나레이션/씬 입력 시 G1 자동 판단
    if (['dialogue', 'narration', 'scene'].includes(field)) {
      const cut = cuts.find(c => c.id === id)
      if (cut) {
        const updated = { ...cut, [field]: val }
        const hasContent = !!(updated.dialogue || updated.narration || updated.scene)
        setGPoint(episodeCode, cut.no, 'g1', hasContent)
        setGData(loadGPoints())
      }
    }
  }

  // 씬 설명 카드의 SP/PL/CH/SH/CA/MD/AC/LOOK_ID 코드 필드 (cut.masterCode.{key})
  const updateCutMC = (id, key, val) => {
    const cut = cuts.find(c => c.id === id)
    const mc = cut?.masterCode || {}
    dispatch({ type: 'UPDATE_CUT', id, p: { masterCode: { ...mc, [key]: val } } })
  }
  // 오디오(masterCode.audio.*) / KR 컨펌본(masterCode.kr.*) 처럼 한 단계 더 중첩된 필드
  const updateCutMCNested = (id, group, key, val) => {
    const cut = cuts.find(c => c.id === id)
    const mc = cut?.masterCode || {}
    const groupVal = mc[group] || {}
    dispatch({ type: 'UPDATE_CUT', id, p: { masterCode: { ...mc, [group]: { ...groupVal, [key]: val } } } })
  }

  // ── G1 승인/취소 ─────────────────────────────────────────────
  const approveG1 = (cutNo) => {
    setGPoint(episodeCode, cutNo, 'g1', true)
    const updated = loadGPoints()
    setGData(updated)
    // 타입 무관하게 문자열로 통일 후 비교
    const cutNoStr = String(cutNo)
    const allDone = cuts.length > 0 && cuts.every(c => {
      if (String(c.no) === cutNoStr) return true
      // gpoints v2 구조: { [episodeCode]: { cut_N: {...} } } — episodeCode 레벨을 거쳐야 함
      // (fe94711 마이그레이션에서 이 줄만 빠져 다중 컷 에피소드는 자동 이동이 안 됐음)
      return !!updated[episodeCode]?.[`cut_${c.no}`]?.g1
    })
    console.log('[G1] cutNo:', cutNo, 'allDone:', allDone, 'cuts:', cuts.map(c=>c.no), 'updated:', updated)
    if (allDone) {
      console.log('[G1] 전체 승인 완료 → 스튜디오 탭으로 이동')
      setTimeout(() => dispatch({ type: 'SET_TAB', p: 'studio' }), 1000)
    }
  }
  const revokeG1  = (cutNo) => { setGPoint(episodeCode, cutNo, 'g1', false); setGData(loadGPoints()) }
  const handleRevisionFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setRevisionInput(ev.target.result)
    reader.readAsText(file, 'utf-8')
  }

  const handleRevision = async () => {
    if (!apiKeys.claude || !revisionInput.trim() || !cuts.length) return
    setRevisionLoading(true)

    const currentScript = cuts.map(serializeCutForRevision).join('\n\n')

    const prompt = `당신은 한국 유튜브 영상 대본 편집 전문가입니다. v3 표준 코드 포맷을 다룹니다.

${YEORI_RULESET}

=== 현재 대본 (v3 필드) ===
${currentScript}
=== 대본 끝 ===

수정 요청:
"${revisionInput}"

[필드 설명]
SC 씬(한국어) · SP 공간코드 · PL 파이프라인코드 · CH 캐릭터 · DL 대사 · NR 나레이션 ·
CP 자막(손글씨 오버레이) · SH 샷타입 · CA 카메라 · MD 감정 · AC 동작 · DU 길이(초) ·
CT 컷유형(YEORI|BROLL|GRAPHIC|CAPCUT|PIP)
메이킹 소스: HTML(그래픽 목업 .html) · GTPL(HTML 자동생성: "ai" | "<템플릿>/<스타일>" | "ai:<템플릿>/<스타일>") ·
SRC(로컬 파일 "sources/x.mp4") · URL(영상 페이지) · BQ(Pexels 영어 검색어) ·
CLIP("<url> @ 0:30 +10") · MOTION(self|zoom-in|fade|type-in|rise|none)

[코드 값]
SH: SH_ECU SH_CU SH_MCU SH_MS SH_MLS SH_FS SH_WS SH_POV SH_BIRD SH_LOW
MD: MD_JOY MD_REL MD_SUR MD_INT MD_CUR MD_SAD MD_DRM MD_STR
GTPL 템플릿: text-card mv-intro stat-card info-source cards-3col relation / 스타일: minimal gradient dark-minimal yeori neon-dark bold-impact
SP·CA·AC·PL 은 코드북 값이라 임의 생성 금지 — 명시적 요청 없으면 원본 그대로 둘 것.

[출력 규칙]
1. 요청과 관련된 컷만 출력. 나머지 컷은 출력하지 말 것.
2. 각 컷은 [CUT N] 다음 줄부터 "약자: 값" 형식. 바뀐 필드 + 판단에 필요한 필드만.
3. 값을 지우려면 DL/NR/CP 는 "없음", 나머지는 필드 자체를 생략(빈 값 출력 금지 = 원본 유지로 처리됨).
4. 마크다운(** ## ---) 금지. KR/IP/VP/오디오 블록 출력하지 말 것.
5. CT 를 GRAPHIC/CAPCUT 으로 바꾸면 HTML 이나 GTPL 중 하나를 함께 제시. BROLL 이면 CLIP/SRC/URL/BQ 중 하나.
6. 마지막 줄에 "=== 수정 완료 ===" 추가.`

    try {
      const res = await claudeMessages(apiKeys.claude, {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      if (!res.ok) throw new Error('Claude API 오류')
      const data = await res.json()
      const raw = data.content[0].text

      // v3 파서 재사용 — 응답은 [CUT N] + 메인블록만이라 섹션 없이 mainLines 로 들어온다
      const revised = splitV3Cuts(raw)
      if (!revised.length) throw new Error('수정 결과에서 [CUT N] 블록을 찾지 못했습니다')
      const changed = []
      revised.forEach(rc => {
        const original = cuts.find(c => c.no === rc.no)
        if (!original) return
        const { fields } = parseV3MainBlock(rc.mainLines)
        const patch = v3RevisionPatch(fields, original)
        if (Object.keys(patch).length) { dispatch({ type: 'UPDATE_CUT', id: original.id, p: patch }); changed.push(rc.no) }
      })
      if (!changed.length) throw new Error('수정할 컷을 매칭하지 못했습니다 (컷 번호 확인)')

      setRevisionHistory(prev => [...prev, {
        id: Date.now(),
        request: revisionInput.slice(0, 40) + (revisionInput.length > 40 ? '…' : ''),
        result: `CUT ${changed.join(', ')} 수정`,
        ts: new Date().toLocaleTimeString('ko-KR'),
      }])
      setRevisionInput('')
    } catch (err) {
      alert('수정 실패: ' + err.message)
    } finally {
      setRevisionLoading(false)
    }
  }

  const downloadScript = () => {
    if (!cuts.length) { alert('컷이 없습니다. 대본을 먼저 생성하세요.'); return }
    const text = buildV3ScriptText(cuts, episode)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${displayEpisodeCode(episode)}_v3.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleScriptFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result

      // ── v3 표준 포맷(SC/SP/PL/CH/DL/NR + KR/IP/VP 섹션) 감지 ──
      if (isV3Format(text)) {
        const parsedV3 = parseCutsV3(text)
        if (!parsedV3.length) {
          alert('v3 포맷 파싱 실패: [CUT N] 헤더와 SC:/SP:/PL: 필드, KR/IP/VP 섹션을 확인해주세요.')
          return
        }
        dispatch({ type: 'SET_CUTS', p: parsedV3 })
        const { masterCode, epHeaderRaw } = parseV3GlobalHeader(text)
        if (masterCode || epHeaderRaw) dispatch({ type: 'SET_EPISODE', p: { masterCode, epHeaderRaw } })
        parsedV3.forEach(c => setGPoint(episodeCode, c.no, 'g1', !!(c.dialogue || c.narration || c.scene)))
        setGData(loadGPoints())
        setActiveCut(0)
        alert(`✅ v3 포맷 대본 ${parsedV3.length}개 컷 불러오기 완료`)
        return
      }

      // ── 기존 단순 포맷(씬:/액션:/대사:/... 한 줄 필드) ──
      const parsed = parseCuts(text, cuts.length)
      if (!parsed.length) {
        alert('파싱 실패: 형식을 확인해주세요.\n[CUT N] 블록과 필드명이 정확해야 합니다.')
        return
      }
      let updatedCount = 0
      parsed.forEach(revised => {
        const original = cuts.find(c => c.no === revised.no)
        if (!original) return
        dispatch({ type: 'UPDATE_CUT', id: original.id, p: {
          scene:       revised.scene       || original.scene,
          action:      revised.action      || original.action,
          character:   revised.character   || original.character,
          dialogue:    revised.dialogue    !== '' ? revised.dialogue : original.dialogue,
          narration:   revised.narration   || original.narration,
          subtitle:    revised.subtitle    !== undefined ? revised.subtitle : (original.subtitle || ''),
          shotType:    revised.shotType    || original.shotType,
          cutType:     revised.cutType     || original.cutType || 'YEORI',
          pipTarget:   revised.pipTarget   !== undefined ? revised.pipTarget : (original.pipTarget || ''),
          graphicTool: revised.graphicTool || original.graphicTool || '',
          imagePrompt: revised.imagePrompt || original.imagePrompt,
          duration:    revised.duration    || original.duration,
        }})
        const hasContent = !!(revised.dialogue || revised.narration || revised.scene)
        setGPoint(episodeCode, revised.no, 'g1', hasContent)
        updatedCount++
      })
      setGData(loadGPoints())
      alert(`✅ ${updatedCount}개 컷 반영 완료`)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  const g1Count = cuts.filter(c => gData[episodeCode]?.[`cut_${c.no}`]?.g1).length
  const allG1Done = cuts.length > 0 && g1Count === cuts.length


  const handlePipelineExport = async () => {
    if (!cuts.length) { alert('컷이 없습니다. 대본을 먼저 생성하세요.'); return }

    const promptsData = {
      episode: episode.number,
      title: episode.title,
      cuts: cuts.map(c => {
        const cut = { no: c.no, imagePrompt: c.imagePrompt || '', ...getRunFlags(c) }
        if (c.narration?.trim()) cut.narration = c.narration.trim()
        if (c.dialogue?.trim() && !/^없음$/i.test(c.dialogue.trim())) cut.dialogue = c.dialogue.trim()
        cut.duration = c.duration || 5
        return cut
      }),
    }

    setFlowRunning(true)
    setFlowDone(false)
    setFlowLogs([{ type: 'info', message: 'prompts.json 저장 중…' }])

    try {
      const res = await fetch('http://localhost:3001/api/run-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep: episode.number, prompts: promptsData }),
      })
      if (!res.ok) throw new Error(`서버 오류 ${res.status} — npm run proxy가 실행 중인지 확인하세요`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'saved') {
              setFlowLogs(prev => [...prev, { type: 'ok', message: '✅ prompts.json 저장 완료' }])
            } else if (ev.type === 'progress') {
              setFlowLogs(prev => [...prev, { type: 'progress', cutNo: ev.cutNo, message: `C${String(ev.cutNo).padStart(2,'0')} 생성 중… (${ev.current}/${ev.total})` }])
            } else if (ev.type === 'cut_done') {
              setFlowLogs(prev => {
                const next = [...prev]
                for (let j = next.length - 1; j >= 0; j--) {
                  if (next[j].cutNo === ev.cutNo && next[j].type === 'progress') {
                    next[j] = { type: 'done', cutNo: ev.cutNo, message: `✅ C${String(ev.cutNo).padStart(2,'0')} 완료 (${ev.current}/${ev.total})` }
                    break
                  }
                }
                return next
              })
            } else if (ev.type === 'cut_error') {
              setFlowLogs(prev => [...prev, { type: 'error', cutNo: ev.cutNo, message: `❌ C${String(ev.cutNo).padStart(2,'0')} 실패` }])
            } else if (ev.type === 'log' && ev.level === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `⚠️ ${ev.message}` }])
            } else if (ev.type === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `❌ ${ev.message}${ev.detail ? ` (${ev.detail})` : ''}` }])
            } else if (ev.type === 'complete') {
              setFlowRunning(false)
              setFlowDone(ev.success)
              if (!ev.success) {
                const reason = ev.reason ? ` — ${ev.reason}` : ''
                setFlowLogs(prev => [...prev, { type: 'error', message: `파이프라인 실패${reason} (code: ${ev.code ?? 'null'})` }])
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      setFlowLogs(prev => [...prev, { type: 'error', message: `❌ ${err.message}` }])
      setFlowRunning(false)
    }
  }

  return (
    <div className={s.page}>
      <TabToolbar
        actions={[
          {
            key: 'gen-script', variant: 'accent', disabled: loading,
            label: loading ? <><span className={s.spinner} />{progress || '생성 중...'}</> : '✨ Claude로 대본 생성',
            onClick: generateScript,
          },
          {
            key: 'pipeline-export', variant: 'green', disabled: flowRunning || !cuts.length,
            label: flowRunning ? <><span className={s.spinner} />Flow 실행 중…</> : '🚀 파이프라인 내보내기',
            onClick: handlePipelineExport,
          },
        ]}
      />
    <div className={s.root}>
      {/* Left: Settings */}
      <div className={s.sidebar}>

        {/* 에피소드 설정 - 접기/펼치기, 열렸을 때만 스크롤 영역 차지 */}
        <div className={`${s.epSection} ${episodeOpen ? s.epSectionOpen : ''}`}>
          <button className={s.epToggle} onClick={() => setEpisodeOpen(o => !o)}>
            <span className={s.sideTitle}>에피소드 설정</span>
            <span className={s.toggleIcon}>{episodeOpen ? '▲' : '▼'}</span>
          </button>
          {episodeOpen && (
            <div className={s.epBody}>
              <div className={s.fieldRow2}>
                <div className={s.field}>
                  <label>콘텐츠 유형</label>
                  <select value={episode.contentType || 'LF'}
                    onChange={e => dispatch({ type: 'SET_EPISODE', p: { contentType: e.target.value } })}>
                    {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className={s.field}>
                  <label>주제 (TOPIC)</label>
                  <select value={episode.topicCode || 'PSY'}
                    onChange={e => dispatch({ type: 'SET_EPISODE', p: { topicCode: e.target.value } })}>
                    {TOPIC_CODES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className={s.fieldRow2}>
                <div className={s.field}>
                  <label>시나리오 (SCN)</label>
                  <select value={episode.scnCode || 'DOC'}
                    onChange={e => dispatch({ type: 'SET_EPISODE', p: { scnCode: e.target.value } })}>
                    {SCN_CODES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className={s.field}>
                  <label>에피소드 번호</label>
                  <div className={s.epNumRow}>
                    <input
                      type="number" min="1" value={episode.number}
                      style={numError ? { borderColor: '#ef4444' } : {}}
                      onChange={e => {
                        const num = parseInt(e.target.value) || 1
                        const thisType = episode.contentType || 'LF'
                        const newCode = formatEpisodeCode(thisType, num)
                        const isDup = Object.values(episodes || {}).some(ep => {
                          if (ep.id === activeEpisodeId) return false
                          return formatEpisodeCode(ep.episode?.contentType || 'LF', ep.episode.number) === newCode
                        })
                        if (isDup) {
                          setNumError(`${newCode}은 이미 사용 중입니다`)
                        } else {
                          setNumError('')
                          dispatch({ type: 'RENUMBER_EPISODE', id: activeEpisodeId, number: num })
                        }
                      }}
                    />
                    <span className={s.epCodeBadge}>
                      {displayEpisodeCode(episode)}
                    </span>
                  </div>
                  {numError && (
                    <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>⚠️ {numError}</div>
                  )}
                </div>
              </div>

              {/* 에피소드 코드 — gpoints/파일경로/배지에 쓰이는 정식 식별자.
                  비우면 콘텐츠 유형+번호로 자동 조립. 대본 EP.HEADER의 EP: 값과
                  다르면 "대본 코드로 맞추기" 버튼 노출. */}
              <div className={s.field}>
                <label>에피소드 코드</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    placeholder={derivedCode}
                    value={codeDraft}
                    onChange={e => {
                      const v = e.target.value.toUpperCase()
                      setCodeDraft(v)
                      dispatch({ type: 'SET_EPISODE', p: { code: v.trim() } })
                    }}
                    style={{ flex: 1, ...(codeClashEp ? { borderColor: '#f87171' } : {}) }}
                  />
                  {epHeaderCode && epHeaderCode !== (episode?.code || '') && (
                    <button type="button"
                      onClick={() => { setCodeDraft(epHeaderCode); dispatch({ type: 'SET_EPISODE', p: { code: epHeaderCode } }) }}
                      style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: 6,
                        background: 'rgba(167,139,250,0.14)', border: '1px solid rgba(167,139,250,0.35)', color: '#c4b5fd', cursor: 'pointer' }}>
                      대본 EP: {epHeaderCode}
                    </button>
                  )}
                </div>
                {codeClashEp && (
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#f87171', marginTop: 4, lineHeight: 1.5 }}>
                    ⚠ 이미 다른 에피소드가 쓰는 코드입니다: “{codeClashEp.title || codeClashEp.number || '?'}”.
                    같은 코드면 <code>downloads/episodes/{codeDraft.trim().toUpperCase()}/</code> 폴더와
                    gpoints를 두 에피소드가 공유하게 됩니다. 이 값은 저장되지 않습니다 — 다른 코드로 바꾸세요.
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, lineHeight: 1.5 }}>
                  비우면 <code>{derivedCode}</code> 자동. gpoints·파일경로(<code>downloads/episodes/{'{code}'}/</code>)에
                  쓰이므로 전역 유일해야 함.
                  {episode?.code ? ' 바꾸면 이 에피소드의 기존 G승인 상태·산출물이 새 코드 폴더로 안 옮겨짐(재승인·재생성 필요).' : ' 처음 한 번만 정하는 게 안전.'}
                </div>
              </div>
              <div className={s.field}>
                <label>완성 방식</label>
                <select value={resolveFinishMode(episode)}
                  onChange={e => dispatch({ type: 'SET_EPISODE', p: { finishMode: e.target.value } })}>
                  {FINISH_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                  {resolveFinishMode(episode) === 'assemble'
                    ? '컷을 바로 이어붙여 완성 (인스타·틱톡용 빠른 전개).'
                    : 'CapCut에서 켄번스·트랜지션·색보정 마무리 (서여리 에피소드 시리즈).'}
                  {!episode.finishMode && ' · 콘텐츠 유형 기준 자동'}
                </div>
              </div>
              {(episode.contentType || '').startsWith('IG_') && (
                <div className={s.field}>
                  <label>인스타 번호</label>
                  <input placeholder="예: P01, RL03, PT01, ST01" value={episode.instaNum || ''}
                    onChange={e => dispatch({ type: 'SET_EPISODE', p: { instaNum: e.target.value.trim() } })} />
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                    컷의 PL이 IG_FD/IG_RL/IG_PT/IG_ST일 때 이 값으로 IG 코드(IG_R03 등)를 만들어 seoyeori/IG/ 아래 저장됩니다.
                  </div>
                </div>
              )}
              <div className={s.field}>
                <label>에피소드 제목</label>
                <input placeholder="예: 카페에서 혼자 쓰는 편지" value={episode.title}
                  onChange={e => dispatch({ type: 'SET_EPISODE', p: { title: e.target.value } })} />
              </div>
              <div className={s.field}>
                <label>배경 장소</label>
                <select value={episode.location}
                  onChange={e => dispatch({ type: 'SET_EPISODE', p: { location: e.target.value } })}>
                  {LOCATIONS.map(l => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div className={s.field}>
                <label>전체 분위기 <span style={{fontSize:10,color:'var(--text3)'}}>(최대 2개)</span></label>
                <div className={s.chips}>
                  {MOODS.map(m => {
                    const selected = Array.isArray(episode.mood)
                      ? episode.mood.includes(m)
                      : episode.mood === m
                    const moodArr = Array.isArray(episode.mood) ? episode.mood : [episode.mood]
                    return (
                      <button key={m}
                        className={`${s.chip} ${selected ? s.chipActive : ''}`}
                        onClick={() => {
                          if (selected) {
                            const next = moodArr.filter(x => x !== m)
                            dispatch({ type: 'SET_EPISODE', p: { mood: next.length ? next : moodArr } })
                          } else {
                            const next = moodArr.length >= 2 ? [moodArr[1], m] : [...moodArr, m]
                            dispatch({ type: 'SET_EPISODE', p: { mood: next } })
                          }
                        }}
                      >{m}</button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 마스터 코드 대본 생성 (script_generator.py + script_to_prompts.py) — 항상 노출, 고정 영역 */}
        <div className={s.masterCodeFixed}>
          <div className={s.sideTitle} style={{ marginBottom: 10 }}>🔤 마스터 코드 대본 생성</div>
          {/* ① 마스터 코드 입력창 */}
          <div className={s.field}>
            <label>마스터 코드</label>
            <textarea
              rows={7}
              placeholder={'예) SF_E01_SHOE :: YR_VD :: OT.CF.TZ_AF.LT_WM :: LK_CS.TOP_CRP.BTM_SHT.SH_HHL :: SH_CU CA_PS MD_JOY AT_SD_01'}
              style={{ fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
              value={masterCode}
              onChange={e => setMasterCode(e.target.value)}
            />
          </div>

          {/* ② 대본 생성 버튼 */}
          <button
            className={s.genBtn}
            onClick={generateFromMasterCode}
            disabled={mcLoading || !masterCode.trim()}
            style={{ width: '100%' }}
          >
            {mcLoading ? (<><span className={s.spinner} />생성 중...</>) : '🧬 대본 생성'}
          </button>
          {mcError && (
            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>⚠️ {mcError}</div>
          )}

          {/* Field Gate(genline) 컷 단위 패치 대기 — 세그 분할 등. 이것도 "적용" 눌러야 반영 */}
          {genlinePatch && (
            <div style={{
              marginTop: 12, padding: 10, borderRadius: 8,
              background: 'rgba(167,139,250,.08)', border: '1px solid rgba(167,139,250,.35)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>
                🎯 Field Gate 에서 CUT {genlinePatch.cutNo} 수정 제안 도착
                {genlinePatch.meta?.title ? ` — ${genlinePatch.meta.title}` : ''}
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--text2)', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                {Object.entries(genlinePatch.fields).map(([k, v]) => (
                  <div key={k}>{k}: {v}</div>
                ))}
                {Object.keys(genlinePatch.fields).length === 0 && (
                  <div style={{ color: '#ef4444' }}>⚠️ 이 수정안에서 알아본 필드가 없습니다 — 원문을 확인하세요.</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={applyGenlinePatch} style={{
                  fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--accent)',
                  border: 0, borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                }}>CUT {genlinePatch.cutNo} 에 적용</button>
                <button onClick={() => setGenlinePatch(null)} style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--text2)', background: 'rgba(255,255,255,.06)',
                  border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                }}>무시</button>
              </div>
            </div>
          )}

          {/* ③ KR 컨펌본 미리보기 — 테스트 모드: "실제 적용" 전까지 AppContext/저장에 반영 안 됨 */}
          {mcPreview && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{
                padding: '6px 10px', borderRadius: 6, background: 'rgba(234,179,8,.15)',
                border: '1px solid rgba(234,179,8,.4)', color: '#facc15', fontSize: 11, fontWeight: 700,
              }}>
                ⚠ 미리보기 상태 — 실제 적용 전까지 저장 안 됨
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>
                KR 컨펌본 미리보기 ({mcPreview.cuts.length}컷)
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {mcPreview.cuts.map(c => (
                  <div key={c.no} style={{
                    padding: 8, borderRadius: 6, background: 'var(--bg3)',
                    border: '1px solid var(--border2)', fontSize: 11, lineHeight: 1.6,
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--accent-light)', marginBottom: 4 }}>CUT {c.no}</div>
                    <div>SP(장소): {c.kr.sp}</div>
                    <div>CH(캐릭터): {c.kr.ch}</div>
                    <div>SH(샷): {c.kr.sh}</div>
                    <div>CA(카메라): {c.kr.ca}</div>
                    <div>AC(동작): {c.kr.ac}</div>
                    <div>MD(감정): {c.kr.md}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => { setMcPreview(null); setMcMeta(null) }}
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: 6, background: 'var(--bg3)',
                    border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 11,
                    fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  취소
                </button>
                <button
                  onClick={() => setShowChangesModal(true)}
                  style={{
                    flex: 2, padding: '6px 10px', borderRadius: 6, background: 'rgba(34,197,94,.15)',
                    border: '1px solid rgba(34,197,94,.4)', color: '#4ade80', fontSize: 11,
                    fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  ✅ 실제 적용 (cuts에 반영 + 저장)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ④ 변경 내용 입력 모달 — "실제 적용" 확인 후 /api/update-script-history 호출 */}
        {showChangesModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10,
              padding: 20, width: 380, display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                이번 변경 내용을 한 줄로 입력하세요 (선택)
              </div>
              <input
                autoFocus
                placeholder="예: C01-2 립싱크 구간 분할"
                value={changesInput}
                onChange={e => setChangesInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmApplyMasterCode() }}
                style={{
                  padding: '8px 10px', borderRadius: 6, background: 'var(--bg3)',
                  border: '1px solid var(--border2)', color: 'var(--text)', fontSize: 12,
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>입력하지 않으면 "수동 수정"으로 기록됩니다.</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setShowChangesModal(false); setChangesInput('') }}
                  style={{
                    padding: '6px 14px', borderRadius: 6, background: 'var(--bg3)',
                    border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  취소
                </button>
                <button
                  onClick={confirmApplyMasterCode}
                  style={{
                    padding: '6px 14px', borderRadius: 6, background: 'rgba(34,197,94,.2)',
                    border: '1px solid rgba(34,197,94,.5)', color: '#4ade80', fontSize: 12,
                    fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  확인 · 실제 적용
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 컷 목록 */}
        <div className={s.cutSection}>
          <div className={s.cutSectionTitle}>컷 목록</div>
          <div className={s.cutList}>
            {cuts.map((c, i) => (
              <button key={c.id} className={`${s.cutItem} ${activeCut === i ? s.cutActive : ''}`}
                onClick={() => setActiveCut(i)}>
                <span className={s.cutNo}>
                  CUT {c.no}
                  {c.cutMark === 'SIGNATURE' && <span className={s.sigBadge}>✨ SIG</span>}
                  {(() => {
                    const t = CUT_TYPES.find(x => x.value === (c.cutType || 'YEORI'))
                    return t ? (
                      <span style={{
                        fontSize:8, padding:'0 4px', borderRadius:3, marginLeft:2,
                        color: t.color, background: `${t.color}18`, border: `1px solid ${t.border}`,
                      }}>{t.label}</span>
                    ) : null
                  })()}
                  {gData[episodeCode]?.[`cut_${c.no}`]?.g1 && <span className={s.g1Badge}>G1</span>}
                </span>
                <span className={s.cutPreview}>{c.dialogue || c.narration || c.scene || '(비어있음)'}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 버튼 하단 고정 (생성/내보내기 버튼은 상단 툴바로 이동, 다운로드/업로드만 유지) */}
        <div className={s.sideBottom}>
          <div className={s.scriptFileRow}>
            <button className={s.scriptDownBtn} onClick={downloadScript} disabled={!cuts.length}>
              📥 대본 다운로드
            </button>
            <label className={s.scriptUpBtn}>
              📤 수정본 업로드
              <input type="file" accept=".txt" hidden onChange={handleScriptFileUpload} />
            </label>
          </div>
          {progress && !loading && <div className={s.progressMsg}>{progress}</div>}
          {flowLogs.length > 0 && (
            <div className={s.flowLog}>
              {flowLogs.map((log, i) => (
                <div key={i} className={`${s.flowLogLine} ${s[`flowLog_${log.type}`] || ''}`}>
                  {log.message}
                </div>
              ))}
              {flowDone && <div className={s.flowComplete}>🎉 G3 이미지 생성 완료!</div>}
            </div>
          )}
        </div>

      </div>

      {/* Right: Editor */}
      <div className={s.editor}>

        {/* ── 뷰 토글 + 내비게이션 바 ─────────────────────── */}
        {cuts.length > 0 && (
          <div className={s.viewToggleBar}>
            <button
              className={`${s.viewToggleBtn} ${viewMode === 'list' ? s.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode('list')}
            >☰ 전체 목록</button>
            <button
              className={`${s.viewToggleBtn} ${viewMode === 'detail' ? s.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode('detail')}
            >✏️ 상세 편집</button>
            {viewMode === 'detail' && (
              <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:8}}>
                {gData[episodeCode]?.[`cut_${cuts[activeCut]?.no}`]?.g1 ? (
                  <button onClick={() => revokeG1(cuts[activeCut].no)}
                    style={{padding:'4px 10px',borderRadius:6,background:'rgba(34,197,94,.15)',
                      border:'1px solid rgba(34,197,94,.4)',color:'#4ade80',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                    ✅ G1 승인됨 (취소)
                  </button>
                ) : (
                  <button onClick={() => approveG1(cuts[activeCut].no)}
                    style={{padding:'4px 10px',borderRadius:6,background:'rgba(167,139,250,.15)',
                      border:'1px solid rgba(167,139,250,.4)',color:'var(--accent-light)',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                    ☑ G1 승인
                  </button>
                )}
                <div className={s.editorNav}>
                  <button disabled={activeCut === 0} onClick={() => setActiveCut(i => i - 1)}>◀ 이전</button>
                  <span>{activeCut + 1} / {cuts.length}</span>
                  <button disabled={activeCut === cuts.length - 1} onClick={() => setActiveCut(i => i + 1)}>다음 ▶</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 전체 목록 뷰 ──────────────────────────────────── */}
        {viewMode === 'list' && cuts.length > 0 && (
          <div className={s.cutListView}>
            {/* 헤더 */}
            <div className={s.cutListHeader}>
              <span>CUT</span>
              <span>유형</span>
              <span>씬</span>
              <span>대사</span>
              <span>나레이션 (VO)</span>
              <span style={{textAlign:'right'}}>상태</span>
            </div>
            {cuts.map((c, i) => {
              const ct = CUT_TYPES.find(x => x.value === (c.cutType || 'YEORI'))
              const isG1 = !!gData[episodeCode]?.[`cut_${c.no}`]?.g1
              const hasDial = c.dialogue && !/^없음$/i.test(c.dialogue.trim())
              const hasVo = c.narration && !/^없음$/i.test(c.narration.trim())
              const isActive = i === activeCut
              return (
                <div
                  key={c.id}
                  className={`${s.cutListRow} ${isActive ? s.cutListRowActive : ''}`}
                  onClick={() => { setActiveCut(i); setViewMode('detail') }}
                >
                  <span className={s.cutListNo}>CUT {c.no}</span>
                  <span>
                    {ct && (
                      <span style={{
                        fontSize:10, padding:'1px 5px', borderRadius:3,
                        color:ct.color, background:`${ct.color}18`, border:`1px solid ${ct.border}`,
                        whiteSpace:'nowrap',
                      }}>{ct.label}</span>
                    )}
                  </span>
                  <span className={s.cutListScene}>{c.scene || '—'}</span>
                  <span className={s.cutListDialogue}>
                    {hasDial ? c.dialogue : <span style={{color:'var(--text-3)'}}>—</span>}
                  </span>
                  <span className={s.cutListVo}>
                    {hasVo ? c.narration : <span style={{color:'var(--text-3)'}}>—</span>}
                  </span>
                  <span className={s.cutListBadges}>
                    {isG1 && <span className={s.g1Badge}>G1</span>}
                    {c.cutMark === 'SIGNATURE' && <span className={s.sigBadge}>✨</span>}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* ── 상세 편집 뷰 (v3 포맷: 씬 설명 / KR 컨펌본 / IP / VP 4분할) ── */}
        {viewMode === 'detail' && cuts.length > 0 && (() => {
          const cut = cuts[activeCut]
          const mc = cut?.masterCode || {}
          const audio = mc.audio || {}
          const kr = mc.kr || {}
          const mcField = (key, val) => updateCutMC(cut.id, key, val)
          const audioField = (key, val) => updateCutMCNested(cut.id, 'audio', key, val)
          const krField = (key, val) => updateCutMCNested(cut.id, 'kr', key, val)

          return (
            <>
              <div className={s.editorHeader}>
                <h2>
                  CUT {cut?.no}
                  {cut?.cutTitle && <span className={s.cutTitleHint}> — {cut.cutTitle}</span>}
                  {cut?.lipsync && <span className={s.sigBadge} style={{marginLeft:8}}>★ 립싱크</span>}
                </h2>
              </div>

              <div className={s.v3Grid}>
                {/* ── 좌측: 씬 설명 + KR 컨펌본 ── */}
                <div className={s.v3Col}>

                  <div className={s.v3Card}>
                    <div className={s.v3CardTitle}>🎬 씬 설명 <span className={s.v3CardHint}>SC · SP · PL · CH · DL · NR</span></div>

                    <div className={s.v3MiniField}>
                      <label>SC (씬 설명)</label>
                      <textarea rows={2} placeholder="카페 테라스 외부 / 촬영 마무리 직전 세팅샷"
                        value={cut?.scene || ''} onChange={e => updateCut(cut.id, 'scene', e.target.value)} />
                    </div>
                    <div className={s.v3SubGrid}>
                      <div className={s.v3MiniField}>
                        <label>SP (공간코드)</label>
                        <input placeholder="OT.CF.TZ_AF.LT_WM" value={mc.sp || ''} onChange={e => mcField('sp', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>PL (파이프라인)</label>
                        <input placeholder="YR_VD" value={mc.pl || ''} onChange={e => mcField('pl', e.target.value)} />
                      </div>
                      <div className={`${s.v3MiniField} ${s.full}`}>
                        <label>CH (캐릭터·룩 코드)</label>
                        <input placeholder="서여리 / LK_CS.TOP_CRP.BTM_SHT.SH_HHL" value={mc.ch || ''} onChange={e => mcField('ch', e.target.value)} />
                      </div>
                    </div>
                    <div className={s.v3MiniField}>
                      <label>DL (대사)</label>
                      <textarea rows={2} placeholder="없음" value={cut?.dialogue || ''} onChange={e => updateCut(cut.id, 'dialogue', e.target.value)} />
                    </div>
                    <div className={s.v3MiniField}>
                      <label>NR (나레이션)</label>
                      <textarea rows={2} placeholder="없음" value={cut?.narration || ''} onChange={e => updateCut(cut.id, 'narration', e.target.value)} />
                    </div>
                    <div className={s.v3MiniField}>
                      <label>CP (자막·손글씨 오버레이)</label>
                      <textarea rows={2} placeholder="없음 — 이 컷에 손글씨 자막을 얹을 텍스트(순수 텍스트). 메이킹 탭에서 위치·말풍선·타이밍을 형성."
                        value={cut?.subtitle || ''} onChange={e => updateCut(cut.id, 'subtitle', e.target.value)} />
                    </div>

                    <div className={s.v3Divider} />

                    <div className={s.v3SubGrid}>
                      <div className={s.v3MiniField}>
                        <label>SH (샷타입)</label>
                        <input placeholder="SH_MCU → SH_CU" value={mc.sh || ''} onChange={e => mcField('sh', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>CA (카메라)</label>
                        <input placeholder="CA_ST → CA_PS" value={mc.ca || ''} onChange={e => mcField('ca', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>MD (감정)</label>
                        <input placeholder="MD_JOY" value={mc.md || ''} onChange={e => mcField('md', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>AC (동작)</label>
                        <input placeholder="AT_SD_01 + AT_EM_01" value={mc.ac || ''} onChange={e => mcField('ac', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>LOOK_ID</label>
                        <input placeholder="LOOK_CS" value={mc.lookId || ''} onChange={e => mcField('lookId', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>DU (컷 길이·초)</label>
                        <input type="number" min="1" max="60" value={cut?.duration || 8}
                          onChange={e => updateCut(cut.id, 'duration', parseInt(e.target.value) || 8)} />
                      </div>
                    </div>

                    <div className={s.v3Divider} />

                    <div className={s.v3MiniField}><label>오디오</label></div>
                    <div className={s.v3SubGrid}>
                      <div className={s.v3MiniField}>
                        <label>BGM</label>
                        <input placeholder="밝은 오프닝 BGM 잔잔하게" value={audio.bgm || ''} onChange={e => audioField('bgm', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>음성</label>
                        <input placeholder="★립싱크 여부·톤" value={audio.voice || ''} onChange={e => audioField('voice', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>효과음</label>
                        <div className={s.sfxRow}>
                          <input placeholder="힐 소리" value={audio.sfx || ''} onChange={e => audioField('sfx', e.target.value)} />
                          <SfxPicker onSelect={item => audioField('sfx', `${item.filename} — ${item.purpose}`)} />
                        </div>
                      </div>
                      <div className={s.v3MiniField}>
                        <label>앰비언스</label>
                        <input placeholder="카페 환경음" value={audio.ambience || ''} onChange={e => audioField('ambience', e.target.value)} />
                      </div>
                    </div>

                    <div className={s.v3Divider} />

                    <div className={s.v3SubGrid}>
                      <div className={s.v3MiniField}>
                        <label>시그니처 마크</label>
                        <div className={s.cutTypeBtns}>
                          {['NORMAL', 'SIGNATURE'].map(type => {
                            const active = (cut?.cutMark ?? 'NORMAL') === type
                            return (
                              <button key={type}
                                className={`${s.cutTypeBtn} ${active ? (type === 'SIGNATURE' ? s.cutTypeBtnSig : s.cutTypeBtnNormal) : ''}`}
                                onClick={() => updateCut(cut.id, 'cutMark', type)}
                              >{type === 'NORMAL' ? '⬜ NORMAL' : '✨ SIGNATURE'}</button>
                            )
                          })}
                        </div>
                      </div>
                      <div className={s.v3MiniField}>
                        <label>파이프라인 유형 (자동화 라우팅)</label>
                        <select
                          value={cut?.cutType || 'YEORI'}
                          onChange={e => updateCut(cut.id, 'cutType', e.target.value)}
                          style={{ width:'100%', padding:'6px 8px', borderRadius:6, background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text)', fontSize:12, cursor:'pointer' }}
                        >
                          {CUT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                    </div>
                    {cut?.cutType === 'PIP' && (
                      <div className={s.v3MiniField}>
                        <label>PIP 타겟 컷 번호</label>
                        <input type="number" min="1" placeholder="배경으로 쓸 컷 번호 (예: 2)"
                          value={cut?.pipTarget || ''} onChange={e => updateCut(cut.id, 'pipTarget', e.target.value)} />
                      </div>
                    )}
                    {cut?.cutType === 'GRAPHIC' && (
                      <div className={s.v3MiniField}>
                        <label>그래픽 도구</label>
                        <div className={s.cutTypeBtns}>
                          {[{v:'HTML',l:'🌐 HTML'},{v:'CANVA',l:'🎨 CANVA'}].map(({v,l}) => {
                            const active = (cut?.graphicTool || 'HTML') === v
                            return (
                              <button key={v}
                                className={`${s.cutTypeBtn} ${active ? s.cutTypeBtnNormal : ''}`}
                                onClick={() => updateCut(cut.id, 'graphicTool', v)}
                              >{l}</button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={s.v3Card}>
                    <div className={s.v3CardTitle}>✅ KR 컨펌본 <span className={s.v3CardHint}>한글 대본</span></div>
                    <div className={s.v3SubGrid}>
                      <div className={s.v3MiniField}>
                        <label>SP(장소)</label>
                        <textarea rows={2} placeholder="카페 테라스 외부 / 오후 따뜻한 햇살" value={kr.sp || ''} onChange={e => krField('sp', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>CH(캐릭터)</label>
                        <textarea rows={2} placeholder="흰색 스퀘어넥 크롭탑 + 연청 데님 숏츠" value={kr.ch || ''} onChange={e => krField('ch', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>SH(샷)</label>
                        <textarea rows={2} placeholder="와이드샷 — 테라스 전체 구도" value={kr.sh || ''} onChange={e => krField('sh', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>CA(카메라)</label>
                        <textarea rows={2} placeholder="고정 (삼각대)" value={kr.ca || ''} onChange={e => krField('ca', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>AC(동작)</label>
                        <textarea rows={2} placeholder="천천히 카메라 쪽으로 걸어옴" value={kr.ac || ''} onChange={e => krField('ac', e.target.value)} />
                      </div>
                      <div className={s.v3MiniField}>
                        <label>MD(감정)</label>
                        <textarea rows={2} placeholder="차분하고 따뜻한 일상적 분위기" value={kr.md || ''} onChange={e => krField('md', e.target.value)} />
                      </div>
                    </div>
                    <div className={s.v3Divider} />
                    <div className={s.v3KrRow}>
                      <b>DL(대사)</b>
                      <span className={s.v3KrMirror}>{cut?.dialogue || '없음'}</span>
                    </div>
                    <div className={s.v3KrRow}>
                      <b>NR(나레이션)</b>
                      <span className={s.v3KrMirror}>{cut?.narration || '없음'}</span>
                    </div>
                    <div className={s.v3KrRow}>
                      <b>CP(자막)</b>
                      <span className={s.v3KrMirror}>{cut?.subtitle || '없음'}</span>
                    </div>
                    <div className={s.v3CardHint}>※ DL/NR/CP는 좌측 "씬 설명"과 자동으로 같은 값을 사용해요.</div>
                  </div>

                </div>

                {/* ── 우측: IP + VP ── */}
                <div className={s.v3Col}>
                  <div className={s.v3Card} style={{ flex: 1 }}>
                    <div className={s.v3CardTitle}>🖼️ IP <span className={s.v3CardHint}>이미지 프롬프트</span></div>
                    <textarea rows={14}
                      placeholder="CLOSEUP SHOT — Young Korean woman early-20s, ..."
                      value={cut?.imagePrompt || ''}
                      onChange={e => updateCut(cut.id, 'imagePrompt', e.target.value)}
                      style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }} />
                  </div>
                  <div className={s.v3Card} style={{ flex: 1 }}>
                    <div className={s.v3CardTitle}>🎥 VP <span className={s.v3CardHint}>영상 프롬프트</span></div>
                    <textarea rows={14}
                      placeholder="First 0-3s: ... / Next 3-6s: ... / Final 6-8s: ..."
                      value={cut?.videoPrompt || ''}
                      onChange={e => updateCut(cut.id, 'videoPrompt', e.target.value)}
                      style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }} />
                    {/* Field Gate 세그 빌더가 채운 cut.segPrompts가 있으면, 위 원본 VP는 그대로 두고
                        실제로 Field Gate/생성기가 쓰는 "합쳐진 최종본"만 읽기 전용으로 미리보기 —
                        위 textarea를 고쳐도 이게 안 바뀐다고 오해하지 않도록(2026-09-12 실사용 혼선 발견). */}
                    {Array.isArray(cut?.segPrompts) && cut.segPrompts.length > 0 && (
                      <div style={{ marginTop: 8, width: '100%' }}>
                        <div className={s.v3CardHint} style={{ fontSize: 12.5, marginBottom: 2 }}>▾ 실제 생성용 최종본(세그별 비주얼+발화 합침, 읽기 전용 — Field Gate 세그 빌더에서 수정)</div>
                        <textarea rows={10} readOnly
                          value={ensureDialogueInVP(cut) || ''}
                          style={{
                            width: '100%', boxSizing: 'border-box', fontFamily: 'var(--mono)',
                            fontSize: 13.5, lineHeight: 1.7, cursor: 'default',
                            background: 'var(--bg3)', color: 'var(--text)', border: '1px dashed var(--border)',
                            borderRadius: 6, padding: '8px 10px',
                          }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )
        })()}

        <div className={s.revisionPanel}>
          <div className={s.revisionTitle}>💬 Claude에게 수정 요청</div>

          <textarea
            className={s.revisionInput}
            rows={3}
            placeholder={"예) CUT 2 대사 더 가볍고 재미있게\n예) CUT 3 샷을 클로즈업(SH_MCU)으로, 감정 MD_JOY 로\n예) CUT 10 을 GRAPHIC 으로 바꾸고 GTPL: ai 붙여줘\n예) CUT 5 나레이션 감성적으로 다시 써줘"}
            value={revisionInput}
            onChange={e => setRevisionInput(e.target.value)}
          />

          <div className={s.revisionActions}>
            <label className={s.fileUploadBtn}>
              📄 텍스트 파일 업로드
              <input type="file" accept=".txt" hidden onChange={handleRevisionFileUpload} />
            </label>
            <button
              className={s.revisionSendBtn}
              onClick={handleRevision}
              disabled={revisionLoading || !revisionInput.trim() || !cuts.length}
            >
              {revisionLoading
                ? <><span className={s.spinner} />수정 중…</>
                : 'Claude에게 전송 →'}
            </button>
          </div>

          {revisionHistory.length > 0 && (
            <div className={s.revisionHistory}>
              <div className={s.revisionHistTitle}>수정 이력</div>
              {revisionHistory.map((h, i) => (
                <div key={h.id} className={s.revisionHistItem}>
                  <span className={s.revisionHistNum}>#{i+1}</span>
                  <span className={s.revisionHistReq}>{h.request}</span>
                  <span className={s.revisionHistStatus}>{h.result ? `✅ ${h.result}` : '✅'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {scriptRaw && (
          <details className={s.rawSection}>
            <summary>원본 생성 텍스트 보기</summary>
            <pre className={s.rawText}>{scriptRaw}</pre>
          </details>
        )}
      </div>
    </div>
    </div>
  )
}
