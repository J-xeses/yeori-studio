// src/tabs/ScriptGenTab.jsx의 v3 표준 포맷 파서를 서버(proxy.js MCP 엔드포인트)에서도
// 쓸 수 있도록 그대로 이식한 순수 함수 버전. 클라이언트 파서와 동작이 어긋나지 않도록
// 정규식/필드명을 절대 임의로 바꾸지 말 것 — 수정 시 ScriptGenTab.jsx도 함께 갱신해야 함.

const MASTER_CLOSEUP_SHOTS = new Set(['SH_ECU', 'SH_CU', 'SH_MCU'])
const V3_SEP_LINE_RE = /^━{6,}$/
const V3_CUT_HEADER_RE = /^\[CUT\s+(\d+)\]\s*(.*)$/
const V3_MAIN_FIELD_RE = /^(SC|SP|PL|CH|DL|NR|SH|CA|MD|AC|LOOK_ID|DU):\s?(.*)$/
const V3_KR_FIELD_RE = /^([A-Z]+)\(([^)]*)\):\s*(.*)$/
const V3_AUDIO_SUBFIELD_RE = /^\s+(BGM|음성|효과음|앰비언스):\s*(.*)$/
const V3_AUDIO_KEY_MAP = { BGM: 'bgm', 음성: 'voice', 효과음: 'sfx', 앰비언스: 'ambience' }

export function isV3Format(raw) {
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
    if (!cur) continue

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
  if (p.startsWith('PIP_')) return 'PIP'
  return 'YEORI'
}

// IG_RL 등 인스타 콘텐츠는 PL이 항상 "IG_RL" 하나로 뭉뚱그려져 있어(BR_/GR_/CC_ 접두사가
// 아예 안 씀) PL만으로는 CapCut 직접제작 컷(텍스트 훅/DM 목업 등, 이미지 생성 자체가 불필요)을
// 구분할 수 없다 — 그 결과 studio_run_g2가 imagePrompt가 비어있지 않다는 이유만으로 이런 컷까지
// Flow 생성 대상에 넣어버리는 문제를 2026-08-15 실측(IG_RL_E02)으로 확인함. IP 섹션에 "이미지
// 생성 불필요"라고 명시된 경우는 PL 코드보다 이 마커를 우선해 CAPCUT으로 분류한다.
function inferCutType(plCode, ip) {
  if (/이미지\s*생성\s*불필요/.test(ip || '')) return 'CAPCUT'
  return pipelineCodeToCutType(plCode)
}

// PL이 인스타그램 콘텐츠 코드(IG_FD/IG_RL/IG_PT/IG_ST)면 어느 downloads/insta/{content}/
// 하위로 라우팅할지 반환. 이건 cutType(위 함수, G2~G5 실행여부를 좌우)과는 완전히 별개 축 —
// 저장 경로·생성 비율만 결정하고 G-단계 스킵 여부에는 관여하지 않는다.
export function pipelineCodeToInstaContent(plCode) {
  const map = { IG_FD: 'FD', IG_RL: 'RL', IG_PT: 'PT', IG_ST: 'ST' }
  return map[(plCode || '').toUpperCase()] || null
}

export function parseCutsV3(raw) {
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
    const cutType = inferCutType(fields.PL, ip)

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
      cutType,
      cutMark: 'NORMAL',
      // PIP_VD(codebook PL) 컷 전용 필드 — YEORI 컷 위에 합성할 BROLL 컷 번호/레이아웃/크기.
      // pipTargetCut은 대본 텍스트만으로는 알 수 없어(사람이 지정) null로 시작, 나머지는
      // codebook 기본값(bottom_right / 0.35)으로 채워 둠.
      ...(cutType === 'PIP' ? { pipTargetCut: null, pipLayout: 'bottom_right', pipScale: 0.35 } : {}),
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

export function parseV3GlobalHeader(raw) {
  const mcMatch = raw.match(/마스터\s*코드\s*\n([^\n=][^\n]*)/)
  const masterCode = mcMatch ? mcMatch[1].trim() : ''
  const headerMatch = raw.match(/EP\.HEADER\s*\n={10,}\s*\n([\s\S]*?)\n={10,}/)
  const epHeaderRaw = headerMatch ? headerMatch[1].trim() : ''
  return { masterCode, epHeaderRaw }
}
