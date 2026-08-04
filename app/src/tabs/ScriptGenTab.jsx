import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import { setGPoints, setGPoint, loadGPoints } from '../lib/gpoints'
import { formatEpisodeCode, displayEpisodeCode, resolveEpisodeCode } from '../lib/episodeCode'
import TabToolbar from '../components/TabToolbar'
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

const EP_GROUPS = [
  { id: 'youtube',   label: '📺 YouTube',   types: ['LF', 'SF'] },
  { id: 'instagram', label: '📷 Instagram', types: ['IG_R', 'IG_P', 'IG_S'] },
  { id: 'tiktok',    label: '🎵 TikTok',    types: ['TK'] },
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
        dialogue: '', narration: '', imagePrompt: '', duration: 5
      }
    } else if (cur) {
      // 멀티라인 파싱 (다음 필드 키워드가 나올 때까지 수집)
      const getField = (startRegex) => {
        const m = block.match(startRegex)
        if (!m) return ''
        const startIdx = block.indexOf(m[0]) + m[0].length
        const rest = block.slice(startIdx)
        // 다음 필드 키워드 전까지 (샷 타입, 컷 길이, 컷 타입, PIP_TARGET, 그래픽 도구 포함)
        const nextField = rest.search(/\n(씬|액션|캐릭터|대사|나레이션|샷\s*타입|이미지 프롬프트|컷 길이|컷 타입|PIP_TARGET|그래픽 도구)[:：]/)
        const content = nextField > -1 ? rest.slice(0, nextField) : rest
        return content.replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/^없음$/i, '')
      }

      cur.scene      = getField(/씬[:：]\s*/) || getField(/장면[:：]\s*/)
      cur.action     = getField(/액션[:：]\s*/) || getField(/행동[:：]\s*/)
      cur.character  = getField(/캐릭터[:：]\s*/) || '서여리'
      cur.dialogue   = stripShotDirective(getField(/대사[:：]\s*/))
      cur.narration  = stripShotDirective(getField(/나레이션[:：](?:\s*\(VO\))?\s*/) || getField(/나레이션[:：]\s*/))
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
      dialogue: '', narration: '', imagePrompt: '', duration: 5,
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
      action: pc.kr?.ac || '',
      character: '서여리',
      dialogue: pc.dl || '',
      narration: pc.nr || '',
      imagePrompt: pc.imagePrompt || '',
      videoPrompt: pc.videoPrompt || '',
      duration: pc.du || 8,
      shotType: MASTER_CLOSEUP_SHOTS.has(firstSh) ? 'CLOSEUP' : 'FULLBODY',
      cutType: 'YEORI',
      masterCode: {
        sp: pc.sp || '', pl: pc.pl || '', ch: '', sh: pc.sh || '', ca: pc.ca || '',
        md: pc.md || '', ac: pc.ac || '', lookId: '', du: pc.du || 8,
        audio: { bgm: '', voice: '', sfx: '', ambience: '' },
        kr: {
          sp: pc.kr?.sp || '', ch: pc.kr?.ch || '', sh: pc.kr?.sh || '',
          ca: pc.kr?.ca || '', ac: pc.kr?.ac || '', md: pc.kr?.md || '',
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
const V3_SEP_LINE_RE = /^━{6,}$/
const V3_CUT_HEADER_RE = /^\[CUT\s+(\d+)\]\s*(.*)$/
const V3_MAIN_FIELD_RE = /^(SC|SP|PL|CH|DL|NR|SH|CA|MD|AC|LOOK_ID|DU):\s?(.*)$/
const V3_KR_FIELD_RE = /^([A-Z]+)\(([^)]*)\):\s*(.*)$/
const V3_AUDIO_SUBFIELD_RE = /^\s+(BGM|음성|효과음|앰비언스):\s*(.*)$/
const V3_AUDIO_KEY_MAP = { BGM: 'bgm', 음성: 'voice', 효과음: 'sfx', 앰비언스: 'ambience' }

function isV3Format(raw) {
  return /KR\s*\(한글\s*컨펌본\)/.test(raw) && /^\s*SP:/m.test(raw) && /^\s*PL:/m.test(raw)
}

function parseCutHeaderMeta(headerRest) {
  const lipsync = /★\s*립싱크/.test(headerRest)
  let rest = headerRest.replace(/★\s*립싱크/g, '').trim()
  const emDashIdx = rest.search(/[—-]/)
  if (emDashIdx > -1) rest = rest.slice(emDashIdx + 1).trim()
  const slashIdx = rest.lastIndexOf('/')
  const cutTitle = (slashIdx > -1 ? rest.slice(0, slashIdx) : rest).trim()
  return { cutTitle, lipsync }
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
      const { cutTitle, lipsync } = parseCutHeaderMeta(headerM[2] || '')
      cur = { no: parseInt(headerM[1], 10), cutTitle, lipsync, mainLines: [], krLines: [], ipLines: [], vpLines: [] }
      section = 'main'
      continue
    }
    if (!cur) continue // [CUT N] 등장 전(마스터 코드/EP.HEADER 영역)은 별도 파서에서 처리

    const trimmed = line.trim()
    if (trimmed === 'KR (한글 컨펌본)') { section = 'kr'; continue }
    if (trimmed === 'IP (이미지 프롬프트)') { section = 'ip'; continue }
    if (trimmed === 'VP (영상 프롬프트)') { section = 'vp'; continue }

    if (section === 'main') cur.mainLines.push(line)
    else if (section === 'kr') cur.krLines.push(line)
    else if (section === 'ip') cur.ipLines.push(line)
    else if (section === 'vp') cur.vpLines.push(line)
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
  return 'YEORI' // YR_VD, YR_IM 등
}

function parseCutsV3(raw) {
  const rawCuts = splitV3Cuts(raw)
  if (!rawCuts.length) return []

  return rawCuts.map(rc => {
    const { fields, audio } = parseV3MainBlock(rc.mainLines)
    const kr = parseV3KrBlock(rc.krLines)
    const ip = joinTrimmedLines(rc.ipLines)
    const vp = joinTrimmedLines(rc.vpLines)

    const shCode = fields.SH || ''
    const firstSh = shCode.split(/[→>]/)[0].trim()
    const dl = fields.DL && fields.DL !== '없음' ? fields.DL : ''
    const nr = fields.NR && fields.NR !== '없음' ? fields.NR : ''

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
      imagePrompt: ip,
      videoPrompt: vp,
      duration: parseInt(fields.DU, 10) || 8,
      shotType: MASTER_CLOSEUP_SHOTS.has(firstSh) ? 'CLOSEUP' : 'FULLBODY',
      cutType: pipelineCodeToCutType(fields.PL),
      cutMark: 'NORMAL',
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
      `SH: ${mc.sh || ''}`,
      `CA: ${mc.ca || ''}`,
      `MD: ${mc.md || ''}`,
      `AC: ${mc.ac || ''}`,
      `LOOK_ID: ${mc.lookId || ''}`,
      `DU: ${c.duration || 8}`,
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
      '',
      sep,
      'IP (이미지 프롬프트)',
      sep,
      c.imagePrompt || '',
      '',
      sep,
      'VP (영상 프롬프트)',
      sep,
      c.videoPrompt || '',
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
  // 과도기 코드: 정식 episode.code 도입 전까지 임시로 번호를 코드 자리에 사용(1~2차 라운드).
  // 활성 에피소드 하나만 다루는 곳은 이 값을 쓰고, 에피소드 목록처럼 여러 에피소드를
  // 동시에 순회하는 곳(아래 epCuts 관련 두 군데)은 반드시 각 ep 자신의 번호를 써야 함 —
  // 안 그러면 다른 에피소드끼리 같은 컷 번호의 G1 상태를 서로 덮어써서 보여주는 버그가 남.
  const episodeCode = resolveEpisodeCode(episode)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [activeCut, setActiveCut] = useState(0)
  const [numError, setNumError] = useState('')
  const [flowRunning, setFlowRunning] = useState(false)
  const [flowLogs, setFlowLogs] = useState([])
  const [flowDone, setFlowDone] = useState(false)
  const [episodeOpen, setEpisodeOpen] = useState(true)
  const [episodeListOpen, setEpisodeListOpen] = useState(false)
  const [gData, setGData] = useState(() => loadGPoints())
  const [revisionInput, setRevisionInput] = useState('')
  const [revisionLoading, setRevisionLoading] = useState(false)
  const [revisionHistory, setRevisionHistory] = useState([])
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [viewMode, setViewMode] = useState('detail') // 'list' | 'detail'

  // ── 마스터 코드 대본 생성 (script_generator.py + script_to_prompts.py) ──
  const [masterCodeOpen, setMasterCodeOpen] = useState(true)
  const [masterCode, setMasterCode] = useState('')
  const [mcLoading, setMcLoading] = useState(false)
  const [mcError, setMcError] = useState('')
  const [mcPreview, setMcPreview] = useState(null) // 생성된 prompts.json ({ episode, cuts })
  const [mcMeta, setMcMeta] = useState(null) // script.txt SCRIPT META 헤더 ({ episode, version, date, status, changes, cuts })
  const [showChangesModal, setShowChangesModal] = useState(false)
  const [changesInput, setChangesInput] = useState('')

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
      return !!updated[`cut_${c.no}`]?.g1
    })
    console.log('[G1] cutNo:', cutNo, 'allDone:', allDone, 'cuts:', cuts.map(c=>c.no), 'updated:', updated)
    if (allDone) {
      console.log('[G1] 전체 승인 완료 → 스튜디오 탭으로 이동')
      setTimeout(() => dispatch({ type: 'SET_TAB', p: 'studio' }), 1000)
    }
  }
  const revokeG1  = (cutNo) => { setGPoint(episodeCode, cutNo, 'g1', false); setGData(loadGPoints()) }
  const approveAllG1 = () => {
    cuts.forEach(c => setGPoint(episodeCode, c.no, 'g1', true))
    const updated = loadGPoints()
    setGData(updated)
    setTimeout(() => dispatch({ type: 'SET_TAB', p: 'studio' }), 1000)
  }
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

    const currentScript = cuts.map(c =>
      `[CUT ${c.no}]\n씬: ${c.scene}\n액션: ${c.action}\n캐릭터: 서여리\n대사: ${c.dialogue || '없음'}\n나레이션: ${c.narration || ''}\n샷 타입: ${c.shotType || 'FULLBODY'}\n이미지 프롬프트: ${c.imagePrompt || ''}\n컷 길이: ${c.duration || 5}`
    ).join('\n\n')

    const prompt = `당신은 한국 유튜브 숏폼 대본 편집 전문가입니다.
아래는 현재 작성된 대본 전체입니다.

${YEORI_RULESET}

=== 현재 대본 ===
${currentScript}
=== 대본 끝 ===

아래 수정 요청을 처리해주세요:
"${revisionInput}"

수정 규칙:
1. 요청한 컷만 수정, 나머지는 그대로 유지
2. 수정된 컷은 반드시 아래 형식으로 출력 (그대로 파싱에 사용됨):
[CUT N]
씬: ...
액션: ...
캐릭터: 서여리
대사: ...
나레이션: ...
샷 타입: CLOSEUP 또는 FULLBODY
이미지 프롬프트: ...

3. 수정 안 된 컷은 출력하지 말 것
4. 마크다운 ** ## --- 절대 금지
5. 수정 완료 후 마지막에 한 줄: "=== 수정 완료 ===" 추가
6. 컷 길이를 수정하는 요청이 있으면 반드시 해당 컷의 "컷 길이: N" 필드 값을 변경해서 출력할 것`

    try {
      const res = await claudeMessages(apiKeys.claude, {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      if (!res.ok) throw new Error('Claude API 오류')
      const data = await res.json()
      const raw = data.content[0].text

      const revisedCuts = parseCuts(raw, cuts.length)
      revisedCuts.forEach(revised => {
        const original = cuts.find(c => c.no === revised.no)
        if (original) {
          dispatch({ type: 'UPDATE_CUT', id: original.id, p: {
            scene:       revised.scene       || original.scene,
            action:      revised.action      || original.action,
            dialogue:    revised.dialogue    !== undefined ? revised.dialogue : original.dialogue,
            narration:   revised.narration   || original.narration,
            imagePrompt: revised.imagePrompt || original.imagePrompt,
            shotType:    revised.shotType    || original.shotType,
            duration:    revised.duration    || original.duration,
          }})
        }
      })

      setRevisionHistory(prev => [...prev, {
        id: Date.now(),
        request: revisionInput.slice(0, 40) + (revisionInput.length > 40 ? '…' : ''),
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

  const handleCutCountChange = (n) => {
    const count = Math.max(1, Math.min(20, parseInt(n) || 7))
    dispatch({ type: 'RESET_CUTS', n: count })
  }

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

        {/* 에피소드 설정 - 접기/펼치기 */}
        <div className={s.epSection}>
          <button className={s.epToggle} onClick={() => setEpisodeOpen(o => !o)}>
            <span className={s.sideTitle}>에피소드 설정</span>
            <span className={s.toggleIcon}>{episodeOpen ? '▲' : '▼'}</span>
          </button>
          {episodeOpen && (
            <div className={s.epBody}>
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
              <div className={s.field}>
                <label>컷 수</label>
                <div className={s.cutCountRow}>
                  <input type="number" min="1" max="20" value={episode.cutCount}
                    onChange={e => handleCutCountChange(e.target.value)} />
                  <span className={s.cutHint}>컷 (최대 20)</span>
                </div>
              </div>
              <div className={s.field}>
                <label>캐릭터 설정</label>
                <textarea rows={3} value={episode.character}
                  onChange={e => dispatch({ type: 'SET_EPISODE', p: { character: e.target.value } })} />
              </div>
            </div>
          )}
        </div>

        {/* 에피소드 목록 패널 */}
        <div className={s.epSection}>
          <button className={s.epToggle} onClick={() => setEpisodeListOpen(o => !o)}>
            <span className={s.sideTitle}>📋 에피소드 목록</span>
            <span className={s.toggleIcon}>{episodeListOpen ? '▲' : '▼'}</span>
          </button>
          {episodeListOpen && (
            <div className={s.epListBody}>
              {EP_GROUPS.map(group => {
                const groupEps = Object.values(episodes || {}).filter(ep =>
                  ep.episode?.contentType && group.types.includes(ep.episode.contentType)
                )
                if (groupEps.length === 0) return null
                const isCollapsed = collapsedGroups[group.id]
                return (
                  <div key={group.id} className={s.epGroup}>
                    <button className={s.epGroupHeader}
                      onClick={() => setCollapsedGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }))}>
                      <span className={s.epGroupLabel}>{group.label}</span>
                      <span className={s.epGroupCount}>{groupEps.length}</span>
                      <span className={s.toggleIcon}>{isCollapsed ? '▶' : '▼'}</span>
                    </button>
                    {!isCollapsed && groupEps.map(ep => {
                      const epCuts = ep.cuts || []
                      const epGpKey = resolveEpisodeCode(ep.episode)
                      const epG1 = epCuts.filter(c => gData[epGpKey]?.[`cut_${c.no}`]?.g1).length
                      const epTotal = epCuts.length
                      const epAllDone = epTotal > 0 && epG1 === epTotal
                      const isActive = ep.id === activeEpisodeId
                      const epCode = displayEpisodeCode(ep.episode)
                      return (
                        <div key={ep.id} className={`${s.epListItem} ${isActive ? s.epListItemActive : ''}`}>
                          <div className={s.epListHeader}
                            onClick={() => dispatch({ type: 'SWITCH_EPISODE', id: ep.id })}>
                            <span className={s.epTypeBadge}>{epCode}</span>
                            <span className={s.epListTitle}>{ep.episode?.title || '(제목 없음)'}</span>
                            {epAllDone && <span className={s.epG1Badge}>G1 ✅</span>}
                          </div>
                          {epTotal > 0 && (
                            <div className={s.epG1Bar}>
                              <div className={s.epG1BarTrack}>
                                <div className={s.epG1BarFill} style={{ width: `${(epG1/epTotal)*100}%` }} />
                              </div>
                              <span className={s.epG1Count}>{epG1}/{epTotal}</span>
                            </div>
                          )}
                          {isActive && epTotal > 0 && !epAllDone && (
                            <button className={s.epApproveBtn} onClick={approveAllG1}>
                              ✅ 전체 G1 승인
                            </button>
                          )}
                          {isActive && epAllDone && (
                            <button className={s.epApproveBtn} style={{background:'rgba(34,197,94,.2)',borderColor:'rgba(34,197,94,.4)',color:'#4ade80'}}
                              onClick={() => dispatch({ type: 'SET_TAB', p: 'studio' })}>
                              🎬 스튜디오 탭으로 →
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              {/* 기타 그룹: contentType 없는 레거시 에피소드 */}
              {(() => {
                const knownTypes = EP_GROUPS.flatMap(g => g.types)
                const otherEps = Object.values(episodes || {}).filter(ep =>
                  !ep.episode?.contentType || !knownTypes.includes(ep.episode.contentType)
                )
                if (otherEps.length === 0) return null
                const isCollapsed = collapsedGroups['other']
                return (
                  <div className={s.epGroup}>
                    <button className={s.epGroupHeader}
                      onClick={() => setCollapsedGroups(prev => ({ ...prev, other: !prev.other }))}>
                      <span className={s.epGroupLabel}>📁 기타</span>
                      <span className={s.epGroupCount}>{otherEps.length}</span>
                      <span className={s.toggleIcon}>{isCollapsed ? '▶' : '▼'}</span>
                    </button>
                    {!isCollapsed && otherEps.map(ep => {
                      const epCuts = ep.cuts || []
                      const epGpKey = resolveEpisodeCode(ep.episode)
                      const epG1 = epCuts.filter(c => gData[epGpKey]?.[`cut_${c.no}`]?.g1).length
                      const epTotal = epCuts.length
                      const epAllDone = epTotal > 0 && epG1 === epTotal
                      const isActive = ep.id === activeEpisodeId
                      const epCode = `EP${String(ep.episode?.number || '?').padStart(2, '0')}`
                      return (
                        <div key={ep.id} className={`${s.epListItem} ${isActive ? s.epListItemActive : ''}`}>
                          <div className={s.epListHeader}
                            onClick={() => dispatch({ type: 'SWITCH_EPISODE', id: ep.id })}>
                            <span className={s.epTypeBadge}>{epCode}</span>
                            <span className={s.epListTitle}>{ep.episode?.title || '(제목 없음)'}</span>
                            {epAllDone && <span className={s.epG1Badge}>G1 ✅</span>}
                          </div>
                          {epTotal > 0 && (
                            <div className={s.epG1Bar}>
                              <div className={s.epG1BarTrack}>
                                <div className={s.epG1BarFill} style={{ width: `${(epG1/epTotal)*100}%` }} />
                              </div>
                              <span className={s.epG1Count}>{epG1}/{epTotal}</span>
                            </div>
                          )}
                          {isActive && epTotal > 0 && !epAllDone && (
                            <button className={s.epApproveBtn} onClick={approveAllG1}>
                              ✅ 전체 G1 승인
                            </button>
                          )}
                          {isActive && epAllDone && (
                            <button className={s.epApproveBtn} style={{background:'rgba(34,197,94,.2)',borderColor:'rgba(34,197,94,.4)',color:'#4ade80'}}
                              onClick={() => dispatch({ type: 'SET_TAB', p: 'studio' })}>
                              🎬 스튜디오 탭으로 →
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* 마스터 코드 대본 생성 (script_generator.py + script_to_prompts.py) */}
        <div className={s.epSection}>
          <button className={s.epToggle} onClick={() => setMasterCodeOpen(o => !o)}>
            <span className={s.sideTitle}>🔤 마스터 코드 대본 생성</span>
            <span className={s.toggleIcon}>{masterCodeOpen ? '▲' : '▼'}</span>
          </button>
          {masterCodeOpen && (
            <div className={s.epBody}>
              {/* ① 마스터 코드 입력창 */}
              <div className={s.field}>
                <label>마스터 코드</label>
                <textarea
                  rows={4}
                  placeholder={'SF_E01_SHOE :: YR_VD :: OT.CF.TZ_AF.LT_WM :: LK_CS.TOP_CRP.BTM_SHT.SH_HHL :: SH_CU CA_PS MD_JOY AT_SD_01'}
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
                    {hasDial ? c.dialogue.slice(0, 42) + (c.dialogue.length > 42 ? '…' : '') : <span style={{color:'var(--text-3)'}}>—</span>}
                  </span>
                  <span className={s.cutListVo}>
                    {hasVo ? c.narration.slice(0, 42) + (c.narration.length > 42 ? '…' : '') : <span style={{color:'var(--text-3)'}}>—</span>}
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
                        <input placeholder="힐 소리" value={audio.sfx || ''} onChange={e => audioField('sfx', e.target.value)} />
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
                    <div className={s.v3CardHint}>※ DL/NR은 좌측 "씬 설명"의 DL/NR과 자동으로 같은 값을 사용해요.</div>
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
            placeholder={"예) CUT 2 대사 더 가볍고 재미있게 수정해줘\n예) 전체 이미지 프롬프트에 골드 목걸이 디테일 추가해줘\n예) CUT 3 나레이션 감성적으로 다시 써줘"}
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
                  <span className={s.revisionHistStatus}>✅</span>
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
