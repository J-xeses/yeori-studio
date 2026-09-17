// src/tabs/ScriptGenTab.jsx의 v3 표준 포맷 파서를 서버(proxy.js MCP 엔드포인트)에서도
// 쓸 수 있도록 그대로 이식한 순수 함수 버전. 클라이언트 파서와 동작이 어긋나지 않도록
// 정규식/필드명을 절대 임의로 바꾸지 말 것 — 수정 시 ScriptGenTab.jsx도 함께 갱신해야 함.

const MASTER_CLOSEUP_SHOTS = new Set(['SH_ECU', 'SH_CU', 'SH_MCU'])
const V3_SEP_LINE_RE = /^[━=]{6,}$/
const V3_CUT_HEADER_RE = /^\[CUT\s+(\d+)\]\s*(.*)$/
// HTML/SRC/BQ/URL/CLIP/MOTION 는 메이킹 탭 자동실행용 컷별 소스 지정 필드(2026-09-08 추가)
// GTPL 은 GRAPHIC/CAPCUT 컷의 HTML 자동 생성 지시(서브라인 3-1, 2026-09-09 추가):
//   GTPL: text-card/minimal  |  GTPL: cards-3col/yeori  |  GTPL: ai  |  GTPL: ai:relation/yeori
// SEG: 발화 컷 세그먼트 조합("8+8+10", Veo 고정 생성단위) — app/docs/vp-dialogue-seg-spec.md §2-1
// SEGT: 세그별 발화 구간("2-8,0-3") — 2026-09-12 추가, src/lib/vpDialogue.js 의 동일 함수와 함께 유지
// SEGP: 세그별 영문 비주얼 프롬프트("p1 ||| p2", 줄바꿈은 ⏎) — 2026-09-12 추가, src/tabs/ScriptGenTab.jsx 와 함께 유지
// CPP: 세그별 화면 자막("자막1 ||| 자막2", 줄바꿈은 ⏎) — 2026-09-15 추가, 필드게이트 세그 분할 탭에서
// 세그(=클립) 슬롯마다 다른 자막을 지정할 때 씀. src/tabs/ScriptGenTab.jsx 와 함께 유지.
const V3_MAIN_FIELD_RE = /^(SC|SP|PL|CH|DL|NR|CP|CPP|CT|SH|CA|MD|AC|LOOK_ID|DU|SEG|SEGT|SEGP|HTML|SRC|BQ|URL|CLIP|MOTION|GTPL):\s?(.*)$/

// "8+8+10" → [8,10] 단위로만 구성된 배열(2개 이상). 형식이 안 맞거나 "auto"/빈값이면 null.
// src/tabs/ScriptGenTab.jsx 의 동일 함수와 반드시 함께 유지.
function parseSegCombo(raw) {
  const combo = String(raw || '').split('+').map(v => parseInt(v.trim(), 10)).filter(n => n === 8 || n === 10)
  return combo.length > 1 ? combo : null
}

// "2-8,0-3" → [[2,8],[0,3]] (세그 개수와 맞아야 유효). src/lib/vpDialogue.js 의 동일 함수와 함께 유지.
function parseSegTiming(raw, segCount) {
  if (!raw) return null
  const out = String(raw).split(',').map(s => s.trim()).map(p => {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/)
    if (!m) return null
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10)
    return (Number.isFinite(a) && Number.isFinite(b) && b > a) ? [a, b] : null
  })
  if (segCount != null && out.length !== segCount) return null
  return out.some(x => x) ? out : null
}

// "p1 ||| p2"(줄바꿈은 ⏎로 치환됨) → 세그별 영문 비주얼 프롬프트 배열. src/tabs/ScriptGenTab.jsx 의
// 동일 함수와 반드시 함께 유지.
function parseSegPrompts(raw, segCount) {
  if (!raw) return null
  const parts = String(raw).split('|||').map(s => s.trim().replace(/⏎/g, '\n'))
  if (segCount != null && parts.length !== segCount) return null
  return parts.some(p => p) ? parts : null
}

// "CLIP: <url> [@ <mm:ss|초>] [+<초>]" → { url, seekSec, durationSec }
export function parseClipField(raw) {
  let rest = String(raw || '').trim()
  if (!rest) return null
  let durationSec = 0, seekSec = 0
  const dm = rest.match(/\s\+\s*(\d+(?:\.\d+)?)\s*$/)
  if (dm) { durationSec = Number(dm[1]); rest = rest.slice(0, dm.index).trim() }
  const sm = rest.match(/\s@\s*(\d{1,2}(?::\d{2}){1,2}|\d+(?:\.\d+)?)\s*$/)
  if (sm) {
    const t = sm[1]
    seekSec = t.includes(':')
      ? t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0)
      : Number(t)
    rest = rest.slice(0, sm.index).trim()
  }
  const url = rest.trim()
  return /^https?:\/\//i.test(url) ? { url, seekSec, durationSec } : null
}
const V3_KR_FIELD_RE = /^([A-Z]+)\(([^)]*)\):\s*(.*)$/
const V3_AUDIO_SUBFIELD_RE = /^\s+(BGM|음성|효과음|앰비언스):\s*(.*)$/
const V3_AUDIO_KEY_MAP = { BGM: 'bgm', 음성: 'voice', 효과음: 'sfx', 앰비언스: 'ambience' }

export function isV3Format(raw) {
  return /KR\s*\(한글\s*컨펌본\)/.test(raw) && /^\s*SP:/m.test(raw) && /^\s*PL:/m.test(raw)
}

function parseCutHeaderMeta(headerRest) {
  const lipsync = /★\s*립싱크/.test(headerRest)
  let rest = headerRest.replace(/★\s*립싱크/g, '').trim()
  // 컷 타입 키워드는 구분자 앞([CUT N]  GRAPHIC — 훅 / 5초, v3.0 포맷) 또는
  // 뒤([CUT N] — GRAPHIC | 인트로 | 3s, v7 포맷) 어느 쪽에도 올 수 있다. 둘 다 지원한다.
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
    if (!cur) continue

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
  return 'YEORI'
}

// IG_RL 등 인스타 콘텐츠는 PL이 항상 "IG_RL" 하나로 뭉뚱그려져 있어(BR_/GR_/CC_ 접두사가
// 아예 안 씀) PL만으로는 CapCut 직접제작 컷(텍스트 훅/DM 목업 등, 이미지 생성 자체가 불필요)을
// 구분할 수 없다 — 그 결과 studio_run_g2가 imagePrompt가 비어있지 않다는 이유만으로 이런 컷까지
// Flow 생성 대상에 넣어버리는 문제를 2026-08-15 실측(IG_RL_E02)으로 확인함. IP 섹션에 "이미지
// 생성 불필요"라고 명시된 경우는 PL 코드보다 이 마커를 우선해 CAPCUT으로 분류한다.
function inferCutType(plCode, ip, headerType, ctField) {
  const TYPES = ['GRAPHIC', 'CAPCUT', 'BROLL', 'YEORI', 'PIP']
  // 1순위: 컷 헤더에 타입 명시 ([CUT N] — GRAPHIC | …  또는  [CUT N]  GRAPHIC — …)
  if (TYPES.includes(headerType)) return headerType
  // 2순위: CT: 필드 명시 (v7 포맷은 컷마다 CT: 로 타입을 박아준다)
  const ct = String(ctField || '').trim().toUpperCase()
  if (TYPES.includes(ct)) return ct
  // 3순위: IP 섹션 마커 — "GRAPHIC 타입 — …" / "CAPCUT 타입 — …" / "이미지 생성 불필요"
  const ipM = String(ip || '').match(/\b(GRAPHIC|CAPCUT|BROLL)\s*타입\b/i)
  if (ipM) return ipM[1].toUpperCase()
  if (/이미지\s*생성\s*불필요/.test(ip || '')) return 'CAPCUT'
  // 4순위: PL 코드 접두사 (BR_/GR_/CC_/PIP_), 그 외 YEORI
  return pipelineCodeToCutType(plCode)
}

// PL이 인스타그램 콘텐츠 코드(IG_FD/IG_RL/IG_PT/IG_ST)면 어느 downloads/insta/{content}/
// 하위로 라우팅할지 반환. 이건 cutType(위 함수, G2~G5 실행여부를 좌우)과는 완전히 별개 축 —
// 저장 경로·생성 비율만 결정하고 G-단계 스킵 여부에는 관여하지 않는다.
export function pipelineCodeToInstaContent(plCode) {
  const map = { IG_FD: 'FD', IG_RL: 'RL', IG_PT: 'PT', IG_ST: 'ST' }
  return map[(plCode || '').toUpperCase()] || null
}

// ── 실내 거주공간 신발 자동 배제 "장치" (2026-09-15) ────────────────────
// src/tabs/ScriptGenTab.jsx와 동일하게 유지. 룰셋 문구만으로는 Claude가 매번 지키리라는
// 보장이 없어(실측: 룰셋에 지시 없던 시절 생성된 컷에 "white low-top sneakers"가 직접
// 명시됨) 대본 파싱 직후 결정적으로 검사·보정한다. 캐릭터 LOOK 프롬프트 자체는 다른 컷
// 일관성을 깨뜨릴 위험이 있어 건드리지 않음(사용자 판단, 2026-09-15).
const INDOOR_HOME_RE = /집|소파|거실|침실|침대|원룸|자취방|욕실|화장실|주방|부엌/
const INTENTIONAL_SHOE_RE = /신발|하이힐|구두|부츠|슬리퍼|운동화|스니커즈|페르소나/
const SHOE_KEYWORD_EN_RE = /\b(sneakers?|shoes?|heels?|boots?|loafers?|sandals?|flats?|Converse|Chuck Taylor|stilettos?)\b/i
const BAREFOOT_ADDENDUM = 'Barefoot or socks only, no shoes worn (indoor home setting).'

// videoPrompt는 인물 묘사가 한 줄짜리 문단("Seo Yeori (right): ..., sneakers.")이라 줄 전체를
// 지우면 다른 의상 묘사까지 다 날아간다 — 줄 안에서 쉼표 단위 절(clause)만 걸러내고 나머지는
// 그대로 이어붙인다("(left, entering):" 같은 괄호 안 쉼표도 걸러지지 않은 절이라 자동으로 보존됨).
function stripShoeClausesFromLine(line) {
  const endsWithPeriod = /\.\s*$/.test(line)
  const core = line.replace(/\.\s*$/, '')
  const parts = core.split(/,\s*/).filter(part => !SHOE_KEYWORD_EN_RE.test(part))
  if (!parts.length || (parts.length === 1 && !parts[0].trim())) return ''
  return parts.join(', ') + (endsWithPeriod ? '.' : '')
}

function applyIndoorBarefootGuard(sceneKr, actionKr, ip, vp) {
  const koreanText = `${sceneKr || ''} ${actionKr || ''}`
  if (!INDOOR_HOME_RE.test(koreanText) || INTENTIONAL_SHOE_RE.test(koreanText)) return { ip, vp }
  const finish = (text) => {
    if (!text) return text
    // 멱등성 가드 — BAREFOOT_ADDENDUM 자체에 "shoes"가 들어있어서, 이미 적용된 텍스트를
    // 다시 검사하면 그 문구가 신발 키워드로 오탐돼 절이 제거되고 addendum이 중복 추가되는
    // 버그가 있었음(2026-09-15 실측: "Barefoot or socks only. Barefoot or socks only,
    // no shoes worn..." 처럼 중복됨). 이미 붙어있으면 그대로 반환.
    if (text.includes(BAREFOOT_ADDENDUM)) return text
    const stripped = text.split('\n').map(stripShoeClausesFromLine).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (SHOE_KEYWORD_EN_RE.test(stripped)) return text // 못 지운 잔여 표현 있으면 과잉수정 방지로 원본 유지
    const sep = /[.!?]$/.test(stripped) ? ' ' : ', '
    return `${stripped}${sep}${BAREFOOT_ADDENDUM}`
  }
  return { ip: finish(ip), vp: finish(vp) }
}

// ── 실내 사적 공간 "배경 인물 허용" 문구 자동 무력화 (2026-09-15) ──────────────
// src/tabs/ScriptGenTab.jsx와 동일하게 유지. 룰셋의 "배경 인물은 허용하되 개입만 금지"
// boilerplate는 카페·거리 같은 공용 공간용인데 모든 컷에 무차별로 붙어, 서여리 집 소파 같은
// "지정된 인물만 있어야 하는 사적 공간"에도 그대로 붙어 모델이 불필요한 배경 인물을 만들어냄
// (사용자 실측 지적, 2026-09-15). CH 필드가 지정 캐릭터만으로 구성되고 BG/CROWD/EXTRA 같은
// 엑스트라 마커가 없는 컷이면 "배경 인물 허용" 문구를 "지정 인물만, 빈 배경" 문구로 바꿔친다.
const EXTRAS_MARKER_RE = /\bBG\b|CROWD|EXTRA|PASSERBY|행인|엑스트라|군중/i
// 뒤쪽 \s* 를 그룹으로 따로 잡아둔다 — 세그먼트 문단 사이 빈 줄("\n\n")까지 통째로 삼켜서
// 치환문구+공백 하나로 뭉개버리면 문단 구분이 사라지는 버그가 있었음(2026-09-15 실측: CUT2
// videoPrompt의 세그1/세그2 경계 빈 줄이 사라짐). 원래 있던 공백/줄바꿈 그대로 보존한다.
const BG_PEOPLE_CLAUSE_RE = /background (?:people|figures) must not (?:interact|interfere)[^,.\n]*[,.]?(\s*)/i
const NO_BG_PEOPLE_REPLACEMENT = 'No other people in background — only the named characters in frame, plain empty background.'

function applyPrivateCastGuard(sceneKr, chField, ip, vp) {
  if (!INDOOR_HOME_RE.test(sceneKr || '') || EXTRAS_MARKER_RE.test(chField || '')) return { ip, vp }
  const finish = (text) => {
    if (!text || text.includes(NO_BG_PEOPLE_REPLACEMENT)) return text // 멱등성
    if (!BG_PEOPLE_CLAUSE_RE.test(text)) return text
    return text.replace(BG_PEOPLE_CLAUSE_RE, (_m, trailingWs) => `${NO_BG_PEOPLE_REPLACEMENT}${trailingWs || ' '}`)
  }
  return { ip: finish(ip), vp: finish(vp) }
}

export function parseCutsV3(raw) {
  const rawCuts = splitV3Cuts(raw)
  if (!rawCuts.length) return []

  return rawCuts.map(rc => {
    const { fields, audio } = parseV3MainBlock(rc.mainLines)
    const kr = parseV3KrBlock(rc.krLines)
    // BROLL·GRAPHIC 컷은 "IP / VP" 한 섹션에 소스 안내를 적는다 — 별도 IP/VP 가 비면 이걸 쓴다.
    const ipvp = joinTrimmedLines(rc.ipvpLines || [])
    const ip = joinTrimmedLines(rc.ipLines) || ipvp
    const vp = joinTrimmedLines(rc.vpLines) || ipvp

    // ── 메이킹 탭 자동실행용 컷별 소스 지정 ──
    // 명시 필드(HTML:/SRC:/BQ:/URL:/MOTION:) 우선, 없으면 IP/VP 자유텍스트의 관용 표기에서 유추
    //   HTML: <파일>.html          GRAPHIC/CAPCUT — 이 컷 전용 HTML 목업
    //   SRC:  <경로>.mp4|...        BROLL — 로컬 소스 파일 → source-to-cut 규격화
    //   BQ:   <영문 검색어>          BROLL — Pexels 검색어 직접 지정(AI/SC 안 씀)
    //   URL:  <영상 페이지 URL>      BROLL — 헤드리스 URL 캡처
    //   MOTION: zoom-in|fade|...    캡처/이미지 소스에 얹을 모션
    const _ipvpText = `${ip}\n${vp}\n${ipvp}`
    const htmlFile = String(fields.HTML || '').trim()
      || (_ipvpText.match(/(?:파일|file)\s*[:：]\s*(\S+\.html?)/i)?.[1] || '')
    const sourcePath = String(fields.SRC || '').trim()
      || (_ipvpText.match(/저장\s*경로\s*[:：]\s*(\S.*?\.(?:mp4|mov|mkv|webm|m4v|png|jpg|jpeg))/i)?.[1]?.trim() || '')
    const brollQuery = String(fields.BQ || '').trim()
    const brollUrl = String(fields.URL || '').trim()
    const cutMotion = String(fields.MOTION || '').trim()
    const graphicTemplate = String(fields.GTPL || '').trim()   // 서브라인 3-1: HTML 자동 생성 지시
    // CLIP: <영상 페이지 URL> [@ 시크] [+ 길이] — 웹 영상의 한 구간을 화면녹화(screen-scenario)로.
    // ⚠️ 저작권: 리뷰·비평·해설 목적의 짧은 인용(공정이용) 전제. 사용 책임은 대본 작성자.
    const clip = parseClipField(fields.CLIP)

    const shCode = fields.SH || ''
    const firstSh = shCode.split(/[→>]/)[0].trim()
    const dl = fields.DL && fields.DL !== '없음' ? fields.DL : ''
    const nr = fields.NR && fields.NR !== '없음' ? fields.NR : ''
    // CP(자막): 컷 대본 단계에서 정의하는 손글씨 오버레이 텍스트(순수 텍스트).
    // "없음"/"(작성 필요)" 플레이스홀더는 빈 값으로. 메이킹 탭이 이 값이 있는 컷에만
    // 손글씨 오버레이 섹션을 노출하고, 위치/말풍선/타이밍 등 시각 상세를 형성한다.
    const cp = fields.CP && !['없음', '(작성 필요)'].includes(fields.CP.trim()) ? fields.CP.trim() : ''
    const cutType = inferCutType(fields.PL, ip, rc.headerType, fields.CT)
    // src/tabs/ScriptGenTab.jsx와 동일 유지 — SC(장면)만 보면 ECU/MCU 컷(SC="서여리 ECU...")이
    // 실내 공간 키워드를 놓친다. kr.SP(공간 확인 필드)까지 합쳐서 검사(2026-09-17, CUT7/9 실측).
    const spaceDetectionText = `${fields.SC || ''} ${kr.SP || ''}`
    const barefootGuarded = applyIndoorBarefootGuard(spaceDetectionText, kr.AC, ip, vp)
    const castGuarded = applyPrivateCastGuard(spaceDetectionText, fields.CH, barefootGuarded.ip, barefootGuarded.vp)

    return {
      id: `cut-${rc.no}`,
      no: rc.no,
      cutTitle: rc.cutTitle || '',
      lipsync: rc.lipsync || /★/.test(audio.voice || ''),
      scene: fields.SC || '',
      action: kr.AC || '',
      character: '서여리',
      dialogue: dl,
      subtitle: cp,
      narration: nr,
      imagePrompt: castGuarded.ip,
      videoPrompt: castGuarded.vp,
      duration: parseInt(fields.DU, 10) || 8,
      shotType: MASTER_CLOSEUP_SHOTS.has(firstSh) ? 'CLOSEUP' : 'FULLBODY',
      cutType,
      cutMark: 'NORMAL',
      ...(parseSegCombo(fields.SEG) ? { segments: parseSegCombo(fields.SEG) } : {}),
      ...(fields.SEGT && parseSegTiming(fields.SEGT, (parseSegCombo(fields.SEG) || []).length) ? { segTiming: parseSegTiming(fields.SEGT, (parseSegCombo(fields.SEG) || []).length) } : {}),
      ...(fields.SEGP && parseSegPrompts(fields.SEGP, (parseSegCombo(fields.SEG) || []).length) ? { segPrompts: parseSegPrompts(fields.SEGP, (parseSegCombo(fields.SEG) || []).length) } : {}),
      ...(fields.CPP && parseSegPrompts(fields.CPP, (parseSegCombo(fields.SEG) || []).length) ? { subtitleSegments: parseSegPrompts(fields.CPP, (parseSegCombo(fields.SEG) || []).length) } : {}),
      // PIP_VD(codebook PL) 컷 전용 필드 — YEORI 컷 위에 합성할 BROLL 컷 번호/레이아웃/크기.
      // pipTarget은 ScriptGenTab.jsx의 기존 PIP 메커니즘(수동 입력 필드, proxy.js가 이미
      // c.pipTarget을 읽어 pip_target으로 씀)과 이름을 맞춘 것 — 대본 텍스트만으로는 알 수
      // 없어(사람이 지정) 빈 문자열로 시작, 나머지는 codebook 기본값(bottom_right / 0.35).
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

export function parseV3GlobalHeader(raw) {
  const mcMatch = raw.match(/마스터\s*코드\s*\n([^\n=][^\n]*)/)
  const masterCode = mcMatch ? mcMatch[1].trim() : ''
  const headerMatch = raw.match(/EP\.HEADER\s*\n={10,}\s*\n([\s\S]*?)\n={10,}/)
  const epHeaderRaw = headerMatch ? headerMatch[1].trim() : ''
  return { masterCode, epHeaderRaw }
}
