import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { cutDuration } from '../lib/cutDuration'
import { getGPoint, setGPoint } from '../lib/gpoints'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './MakingTab.module.css'

const YEORI_SERVER = 'http://localhost:3001'

// PL이 인스타그램 콘텐츠 코드(IG_FD/IG_RL/IG_PT/IG_ST)면 어느 downloads/insta/{content}/
// 하위로 라우팅할지 반환. StudioTab.jsx/VideoTab.jsx에 있는 것과 동일 로직(이 코드베이스의
// 기존 관례대로 작은 순수함수라 탭마다 그대로 복제해서 씀).
function pipelineCodeToInstaContent(plCode) {
  const map = { IG_FD: 'FD', IG_RL: 'RL', IG_PT: 'PT', IG_ST: 'ST' }
  return map[(plCode || '').toUpperCase()] || null
}

// 컷마다 masterCode.pl이 없는 경우를 위한 폴백 — episode.contentType 기준 유추.
function episodeContentTypeToInsta(contentType) {
  const map = { IG_R: 'RL', IG_F: 'FD', IG_P: 'PT', IG_S: 'ST' }
  return map[(contentType || '').toUpperCase()] || null
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── 자동 그래픽 템플릿 ──────────────────────────────────────────────
// 서버 proxy.js의 GRAPHIC_TEMPLATE_MCP / fillTemplateForMcp와 동일한 기본 스타일·텍스트
// 선택 규칙을 유지한다(반드시 동기화). 유형별 "기본 제작 스타일"에서 배경/글자색/폰트/
// 크기/굵기/정렬을 바꾸면 그 값으로 렌더한다.
const DEFAULT_GRAPHIC_STYLE = {
  bg: '#0a0a0a',
  color: '#ffffff',
  fontFamily: "'Noto Sans KR', sans-serif",
  fontSize: 80,
  fontWeight: 700,
  align: 'center',   // 가로: left | center | right
  vAlign: 'center',  // 세로: top | center | bottom
  motion: 'none',    // 정지 그래픽 기본 모션: none | zoom-in | zoom-out | fade | zoom-in-fade
}

const GRAPHIC_MOTIONS = [
  ['none', '없음(정지)'],
  ['zoom-in', '천천히 확대'], ['zoom-out', '천천히 축소'],
  ['fade', '페이드 인'], ['zoom-in-fade', '확대 + 페이드'],
  ['rise', '아래에서 떠오름 (애니)'], ['pop', '팝 인 (애니)'], ['type-in', '타이핑 (애니)'],
]
// 프레임 캡처 경로(서버 ANIMATED_MOTIONS와 동일 유지)
const ANIMATED_GRAPHIC_MOTIONS = new Set(['rise', 'pop', 'type-in', 'word-rise'])

const H_MAP = { left: 'flex-start', center: 'center', right: 'flex-end' }
const V_MAP = { top: 'flex-start', center: 'center', bottom: 'flex-end' }

function buildGraphicHtml(style, mainText) {
  const st = { ...DEFAULT_GRAPHIC_STYLE, ...(style || {}) }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1080px; height:1920px;
  background:${st.bg};
  display:flex; flex-direction:column;
  align-items:${H_MAP[st.align] || 'center'};
  justify-content:${V_MAP[st.vAlign] || 'center'};
  font-family:${st.fontFamily};
  color:${st.color};
}
.main-text {
  font-size:${st.fontSize}px; font-weight:${st.fontWeight};
  text-align:${st.align}; line-height:1.4;
  padding:0 80px;
  white-space:pre-line;
  word-break:keep-all;
}
${graphicAnimCss(st.motion)}
</style>
</head>
<body>
<div class="main-text">${escapeHtml(mainText)}</div>
</body>
</html>`
}

// 미리보기용 애니메이션 CSS (서버 animationCss와 느낌 동일). 정적 모션이면 빈 문자열.
function graphicAnimCss(motion) {
  if (motion === 'type-in') {
    return `.main-text{overflow:hidden;white-space:pre;border-right:.08em solid currentColor;width:max-content;max-width:92%;margin:0 auto;animation:hwType 1.8s steps(40,end) forwards,hwCaret .7s step-end infinite}
@keyframes hwType{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes hwCaret{50%{border-color:transparent}}`
  }
  if (motion === 'pop') {
    return `.main-text{animation:hwPop .8s cubic-bezier(.2,1.3,.4,1) forwards}
@keyframes hwPop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}`
  }
  if (motion === 'rise' || motion === 'word-rise') {
    return `.main-text{animation:hwRise 1.6s cubic-bezier(.16,1,.3,1) forwards}
@keyframes hwRise{from{opacity:0;transform:translateY(48px)}to{opacity:1;transform:translateY(0)}}`
  }
  return ''
}

// 서버 extractQuotedLineForMcp와 동일.
function extractQuotedLine(text) {
  const m = String(text || '').match(/"([^"]+)"/)
  return m ? m[1] : ''
}

// 서버 extractCaptionSectionLastLineForMcp와 동일 — CAPCUT 텍스트 컷은 실제 화면
// 문구를 imagePrompt의 "[캡션 ...]" 섹션에 자유 텍스트로 적어두는 관례가 있다.
function extractCaptionSectionLastLine(text) {
  const m = String(text || '').match(/\[캡션[^\]]*\]([\s\S]*?)(?=\n\s*\[|$)/)
  if (!m) return ''
  const lines = m[1].split('\n').map(l => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1] : ''
}

// 서버 fillTemplateForMcp와 동일한 우선순위로 화면 문구를 고른다:
// subtitle → videoPrompt 따옴표 → imagePrompt "[캡션]" 마지막 줄 → dialogue → narration → scene
function pickCutText(cut) {
  return cut.subtitle
    || extractQuotedLine(cut.videoPrompt)
    || extractCaptionSectionLastLine(cut.imagePrompt)
    || cut.dialogue || cut.narration || cut.scene || ''
}

function fillTemplate(cut, style) {
  return buildGraphicHtml(style, pickCutText(cut))
}

// ── 유형별 기본 제작 스타일 (브라우저 localStorage) ─────────────────────
// 손글씨 오버레이는 "이 컷에 자막을 얹는다"를 대본 CP(cut.subtitle)로 정의하고,
// 그 효과의 시각 스타일(위치/말풍선/색상/데코/화살표/표시 구간)은 유형별로 여기서 한 번만
// 정의한다. 컷마다 따로 편집하지 않는다 — CP 있는 컷은 제작 실행 시 이 스타일로 자동 적용.
const DEFAULT_OVERLAY = {
  enabled: false,
  position: 'top_center', bubble: 'cloud', color: 'white',
  deco: '', arrow: false, arrow_direction: 'down', underline: false,
  timing: 'full', // 'full' | 'first2' | 'first3' | 'first5'
}
const TYPE_STYLE_KEY = 'making_type_styles_v1'
const DEFAULT_TYPE_STYLES = {
  GRAPHIC: { mode: 'auto',   htmlFile: '', style: { ...DEFAULT_GRAPHIC_STYLE }, overlay: { ...DEFAULT_OVERLAY } },
  CAPCUT:  { mode: 'html',   htmlFile: '', style: { ...DEFAULT_GRAPHIC_STYLE }, overlay: { ...DEFAULT_OVERLAY } },
  BROLL:   { mode: 'pexels', htmlFile: '', brollQuery: '', style: { ...DEFAULT_GRAPHIC_STYLE }, overlay: { ...DEFAULT_OVERLAY } },
}

// 컷에서 Pexels 검색어를 뽑는다 — 자동실행에서 BROLL(pexels) 컷마다 사용.
// 우선순위: cut.brollQuery → 컷 프롬프트/장면에서 추출한 영문 키워드. typeDefault는 문맥으로 뒤에 덧붙임.
function deriveBrollKeyword(cut, typeDefault) {
  const explicit = String(cut.brollQuery || '').trim()
  if (explicit) return explicit
  const src = `${cut.videoPrompt || ''} ${cut.scene || ''} ${cut.imagePrompt || ''} ${cut.narration || ''}`
  const words = src
    .replace(/[가-힣]+/g, ' ')
    .replace(/[^a-zA-Z ]+/g, ' ')
    .trim().split(/\s+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'shot', 'cut', 'scene'].includes(w.toLowerCase()))
  const derived = words.slice(0, 4).join(' ')
  const ctx = String(typeDefault || '').trim()
  if (derived && ctx) return `${derived} ${ctx}`
  return derived || ctx || ''
}

function loadTypeStyles() {
  try {
    const raw = JSON.parse(localStorage.getItem(TYPE_STYLE_KEY) || '{}')
    const out = {}
    for (const t of Object.keys(DEFAULT_TYPE_STYLES)) {
      out[t] = {
        ...DEFAULT_TYPE_STYLES[t], ...(raw[t] || {}),
        style: { ...DEFAULT_TYPE_STYLES[t].style, ...((raw[t] || {}).style || {}) },
        overlay: { ...DEFAULT_TYPE_STYLES[t].overlay, ...((raw[t] || {}).overlay || {}) },
      }
    }
    return out
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_TYPE_STYLES))
  }
}

const OVERLAY_TIMINGS = [['full', '전체'], ['first2', '앞 2초'], ['first3', '앞 3초'], ['first5', '앞 5초']]
function overlayTimeRange(timing, duration) {
  const d = duration || 5
  if (timing === 'first2') return '0s~2s'
  if (timing === 'first3') return '0s~3s'
  if (timing === 'first5') return `0s~${Math.min(5, d)}s`
  return `0s~${d}s`
}

// 이 탭에서 컷별 [제작 실행] 버튼이 붙는 타입. 그 외(YEORI/PIP 등)는 G2~G5 파이프라인이
// 자동 처리하므로 목록에는 나오되 액션 버튼 없이 "(파이프라인 자동처리)"만 표시한다.
const MANUAL_TYPES = ['GRAPHIC', 'BROLL', 'CAPCUT']

export default function MakingTab() {
  const { state } = useApp()
  const { episode, cuts } = state
  const episodeCode = resolveEpisodeCode(episode)
  const allCuts = [...(cuts || [])].sort((a, b) => a.no - b.no)

  // ── 유형별 기본 제작 스타일(모드 + 기본 HTML 파일 + 자동 템플릿 시각 스타일) ──
  const [typeStyles, setTypeStyles] = useState(loadTypeStyles)
  const [typeStyleOpen, setTypeStyleOpen] = useState(false)
  const updateTypeStyle = (type, patch) => {
    setTypeStyles(prev => {
      const next = {
        ...prev,
        [type]: {
          ...prev[type], ...patch,
          style: { ...prev[type].style, ...(patch.style || {}) },
        },
      }
      try { localStorage.setItem(TYPE_STYLE_KEY, JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }
  const styleFor = (type) => typeStyles[type]?.style

  // 컷별 cut_NN.mp4 제작완료 여부(파일 존재 기반, 별도 플래그 저장 없음) — 2초마다
  // 다시 불러와서 캡처/녹화 직후에도 뱃지가 자동으로 갱신되게 한다.
  const [videoStatus, setVideoStatus] = useState({})
  useEffect(() => {
    if (!episode?.number) return
    const load = () => {
      fetch(`${YEORI_SERVER}/api/episode-video-status?epNum=${episode.number}`)
        .then(r => r.json())
        .then(data => {
          const next = data.videoByCut || {}
          // 값이 실제로 바뀔 때만 setState — 2초 폴링이 불필요한 리렌더/미리보기 깜빡임을 만들지 않게
          setVideoStatus(prev => {
            const pk = Object.keys(prev), nk = Object.keys(next)
            if (pk.length === nk.length && nk.every(k => prev[k] === next[k])) return prev
            return next
          })
        })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [episode?.number])

  // 메이킹 유형(GRAPHIC/BROLL/CAPCUT) 컷은 별도 승인 게이트가 없다 — cut_NN.mp4가
  // 생기면 그게 곧 "완료"다. 파일이 확인되면 G4(영상)를 자동으로 채워, 리더 대시보드
  // (getGPointSummary 기반)와 스튜디오 매트릭스가 메이킹 진행을 반영하게 한다.
  // YEORI 컷은 VideoTab에서 사람이 승인하는 게이트가 따로 있으므로 건드리지 않는다.
  useEffect(() => {
    if (!episode?.number) return
    for (const cut of (cuts || [])) {
      if (!MANUAL_TYPES.includes(cut.cutType || 'YEORI')) continue
      if (videoStatus[cut.no] && !getGPoint(episodeCode, cut.no).g4) {
        setGPoint(episodeCode, cut.no, 'g4', true)
      }
    }
  }, [videoStatus, episode?.number, episodeCode, cuts])

  // ── 어느 컷을 펼쳐 놓았는지(한 번에 하나만). 펼치면서 타입에 맞는 기존 select 함수를
  // 호출해 htmlSource/selectedBrollCutNo/selectedCapcutCutNo 등 기존 상태를 그대로 채운다.
  const [expandedCutNo, setExpandedCutNo] = useState(null)
  const toggleCut = (cut) => {
    const willOpen = expandedCutNo !== cut.no
    setExpandedCutNo(willOpen ? cut.no : null)
    if (!willOpen) return
    if (cut.cutType === 'GRAPHIC') selectHtmlCut(cut)
    else if (cut.cutType === 'BROLL') selectBrollCut(cut)
    else if (cut.cutType === 'CAPCUT') {
      selectCapcutCut(cut)
      if (getCapcutMode(cut.no) === 'html') selectHtmlCut(cut)
    }
  }

  const copyPath = (p) => { try { navigator.clipboard?.writeText(p) } catch { /* noop */ } }

  // ── 소스 검색(Pexels): BROLL 컷 인라인 패널과, 맨 아래 "직접 다운로드" 접이식
  // 카드가 공유한다. 한 번에 컷 하나만 펼쳐지므로 검색 상태를 공유해도 충돌 없음.
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceType, setSourceType] = useState('all')
  const [sourceOrientation, setSourceOrientation] = useState('portrait')
  const [sourceTargetCutNo, setSourceTargetCutNo] = useState(null)
  const [sourceSearching, setSourceSearching] = useState(false)
  const [sourceError, setSourceError] = useState(null)
  const [sourceResults, setSourceResults] = useState([])
  const [sourceDownloading, setSourceDownloading] = useState({})
  const [sourceDownloaded, setSourceDownloaded] = useState({})
  const [legacySourceOpen, setLegacySourceOpen] = useState(false)

  const searchSources = async () => {
    if (!sourceQuery.trim()) return
    setSourceSearching(true)
    setSourceError(null)
    setSourceResults([])
    try {
      const params = new URLSearchParams({
        q: sourceQuery, type: sourceType, orientation: sourceOrientation,
        page: '1', perPage: '15',
      })
      const res = await fetch(`${YEORI_SERVER}/api/source-search?${params}`)
      const data = await res.json()
      if (!res.ok) { setSourceError(data.error || '검색 실패'); return }
      setSourceResults(data.results || [])
    } catch (e) {
      setSourceError(`서버 연결 실패: ${e.message}`)
    } finally {
      setSourceSearching(false)
    }
  }

  // 맨 아래 접이식 카드 전용 — 검색 결과를 making/source/에 원본 그대로 저장(기존 동작 유지).
  const downloadSource = async (item) => {
    if (sourceTargetCutNo == null || !episode.number) return
    setSourceDownloading(prev => ({ ...prev, [item.id]: true }))
    try {
      const ext = item.type === 'video' ? 'mp4' : 'jpg'
      const filename = `${item.id}.${ext}`
      const res = await fetch(`${YEORI_SERVER}/api/source-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.downloadUrl, cutNo: sourceTargetCutNo, epNum: episode.number, filename }),
      })
      const data = await res.json()
      if (!res.ok) { setSourceDownloaded(prev => ({ ...prev, [item.id]: { error: data.error || '다운로드 실패' } })); return }
      setSourceDownloaded(prev => ({ ...prev, [item.id]: data }))
    } catch (e) {
      setSourceDownloaded(prev => ({ ...prev, [item.id]: { error: `서버 연결 실패: ${e.message}` } }))
    } finally {
      setSourceDownloading(prev => ({ ...prev, [item.id]: false }))
    }
  }

  // ── GRAPHIC(및 CAPCUT의 HTML 캡처 모드) 공용 상태 ─────────────────────────
  const [selectedCutNo, setSelectedCutNo] = useState(null)
  const [htmlSource, setHtmlSource] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [duration, setDuration] = useState(5)
  const [capturing, setCapturing] = useState(false)
  const [captureResult, setCaptureResult] = useState(null)

  const selectCut = (cut) => {
    setSelectedCutNo(cut.no)
    setHtmlSource(fillTemplate(cut, styleFor(cut.cutType)))
    setPreviewHtml('')
    setCaptureResult(null)
    setDuration(cutDuration(cut))
  }

  // [제작 실행] — 편집기의 현재 HTML을 그대로 캡처한다(/api/graphic-capture).
  // 자동 템플릿이면 fillTemplate(서버 fillTemplateForMcp와 동일 로직 + 유형별 스타일)
  // 결과가, 목업 파일을 골랐으면 그 파일 전체가 htmlSource에 들어 있고, 서버가
  // .phone-wrap 다중 컷이면 이 컷만 isolate한 뒤 캡처한다. MCP make_graphic_cut은
  // /api/make-graphic-cut(별도)로 남는다.
  const captureGraphic = async () => {
    if (selectedCutNo == null || !episode.number) return
    const cut = allCuts.find(c => c.no === selectedCutNo)
    setCapturing(true)
    setCaptureResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/graphic-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: htmlSource, cutNo: selectedCutNo, epNum: episode.number, duration,
          motion: styleFor(cut?.cutType)?.motion || 'none',
        }),
      })
      const data = await res.json()
      if (!res.ok) { setCaptureResult({ error: data.error || '제작 실패' }); return }
      setCaptureResult(data)
      // 대본 CP가 있고 유형별 손글씨 오버레이가 켜져 있으면 이어서 자동 합성.
      if (cut && cut.subtitle && typeStyles[cut.cutType]?.overlay?.enabled) {
        await runOverlay(cut)
      }
    } catch (e) {
      setCaptureResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setCapturing(false)
    }
  }

  // ── BROLL: 소스 = "Pexels 검색"(다운로드→FFmpeg 규격화) 또는 "화면 녹화" ─────────
  const [brollSourceMode, setBrollSourceMode] = useState({}) // { [cutNo]: 'pexels' | 'record' }
  const getBrollSourceMode = (n) => brollSourceMode[n] || typeStyles.BROLL.mode

  const [selectedBrollCutNo, setSelectedBrollCutNo] = useState(null)
  const [brollUrl, setBrollUrl] = useState('')
  const [brollQuality, setBrollQuality] = useState('medium')
  const [brollRegionMode, setBrollRegionMode] = useState('full')
  const [brollRegion, setBrollRegion] = useState({ x: 0, y: 0, w: 1920, h: 1080 })
  const [brollTargetDuration, setBrollTargetDuration] = useState(5)
  const [brollTrimMode, setBrollTrimMode] = useState('end')
  const [brollRecording, setBrollRecording] = useState(false)
  const [brollBusy, setBrollBusy] = useState(false)
  const [brollResult, setBrollResult] = useState(null)
  const [brollCountdown, setBrollCountdown] = useState(null)

  // Pexels 소스로 BROLL 컷 제작
  const [brollPexelsPick, setBrollPexelsPick] = useState({})       // { [cutNo]: item }
  const [brollDownloading, setBrollDownloading] = useState({})     // { [cutNo]: bool }
  const [brollDownloadResult, setBrollDownloadResult] = useState({}) // { [cutNo]: data | { error } }

  const selectBrollCut = (cut) => {
    setSelectedBrollCutNo(cut.no)
    setBrollUrl('')
    setBrollTargetDuration(cutDuration(cut))
    setBrollResult(null)
  }

  // 전체화면 모드는 녹화가 시작되는 순간 화면 맨 위에 있는 창을 그대로 찍는다.
  // 버튼을 누른 직후엔 이 브라우저 탭 자체가 최상단이므로, 곧장 gdigrab을
  // 띄우면 사람이 대상 창으로 전환하기 전에 녹화가 시작돼버린다. 그래서
  // 실제 API 호출 전에 3초 카운트다운을 넣어 전환할 시간을 준다.
  const startBrollRecording = () => {
    if (selectedBrollCutNo == null || !episode.number || brollCountdown != null) return
    setBrollResult(null)
    setBrollCountdown(3)
    let remaining = 3
    const tick = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(tick)
        setBrollCountdown(null)
        doStartBrollRecording()
      } else {
        setBrollCountdown(remaining)
      }
    }, 1000)
  }

  const doStartBrollRecording = async () => {
    setBrollBusy(true)
    setBrollResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutNo: selectedBrollCutNo,
          options: { fps: 30, quality: brollQuality, region: brollRegionMode === 'custom' ? brollRegion : null },
          broll: { epNum: episode.number, targetDuration: brollTargetDuration, trimMode: brollTrimMode },
        }),
      })
      const data = await res.json()
      if (!res.ok) { setBrollResult({ error: data.error || '녹화 시작 실패' }); return }
      setBrollRecording(true)
    } catch (e) {
      setBrollResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setBrollBusy(false)
    }
  }

  const stopBrollRecording = async () => {
    setBrollBusy(true)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/stop`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setBrollResult({ error: data.error || '녹화 종료 실패' }); return }
      setBrollResult(data)
    } catch (e) {
      setBrollResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setBrollRecording(false)
      setBrollBusy(false)
    }
  }

  // Pexels 검색 결과 하나를 골라 그 URL로 BROLL 컷을 만든다 —
  // POST /api/download-broll-cut(다운로드 → 앞부분 trim → 1080x1920 스케일+패딩 →
  // downloads/video/ep{N}/cut_{NN}.mp4). /api/mcp/download-broll-cut(원격 브리지, Bearer
  // 인증)과 동일 로직을 공유하는 무인증 로컬용 라우트.
  const runBrollDownload = async (cut) => {
    const pick = brollPexelsPick[cut.no]
    if (!pick || !episode.number) return
    setBrollDownloading(p => ({ ...p, [cut.no]: true }))
    setBrollDownloadResult(p => ({ ...p, [cut.no]: null }))
    try {
      const res = await fetch(`${YEORI_SERVER}/api/download-broll-cut`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epNum: episode.number,
          cutNo: cut.no,
          videoUrl: pick.downloadUrl,
          duration: brollTargetDuration || cutDuration(cut),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setBrollDownloadResult(p => ({ ...p, [cut.no]: { error: data.error || '다운로드 실패' } })); return }
      setBrollDownloadResult(p => ({ ...p, [cut.no]: data }))
    } catch (e) {
      setBrollDownloadResult(p => ({ ...p, [cut.no]: { error: `서버 연결 실패: ${e.message}` } }))
    } finally {
      setBrollDownloading(p => ({ ...p, [cut.no]: false }))
    }
  }

  // ── CAPCUT: 두 가지 제작 방식(HTML 캡처 / CapCut 데스크톱 녹화) ──────────────
  const [capcutMode, setCapcutMode] = useState({}) // { [cutNo]: 'html' | 'record' }
  const getCapcutMode = (cutNo) => capcutMode[cutNo] || typeStyles.CAPCUT.mode

  const [selectedCapcutCutNo, setSelectedCapcutCutNo] = useState(null)
  const [capcutStatus, setCapcutStatus] = useState(null)
  const [capcutChecking, setCapcutChecking] = useState(false)
  const [capcutTargetDuration, setCapcutTargetDuration] = useState(5)
  const [capcutTrimMode, setCapcutTrimMode] = useState('end')
  const [capcutRecording, setCapcutRecording] = useState(false)
  const [capcutBusy, setCapcutBusy] = useState(false)
  const [capcutResult, setCapcutResult] = useState(null)

  // ── CapCut 웹 세미오토 (CDP 9222 — 편집만 자동, 내보내기는 수동) ──
  const [cdpStatus, setCdpStatus] = useState(null)      // { cdpUp, editors:[{url,title}] }
  const [cdpChecking, setCdpChecking] = useState(false)
  const [semiPoints, setSemiPoints] = useState({})       // { [cutNo]: "0:0,1.7:50,3.3:100" }
  const [semiTransition, setSemiTransition] = useState({})
  const [semiBusy, setSemiBusy] = useState({})
  const [semiResult, setSemiResult] = useState({})
  const checkCdp = async () => {
    setCdpChecking(true)
    try {
      const r = await fetch(`${YEORI_SERVER}/api/capcut-cdp`)
      setCdpStatus(await r.json())
    } catch (e) {
      setCdpStatus({ cdpUp: false, error: e.message })
    } finally { setCdpChecking(false) }
  }
  // ── 스튜디오 소스 → 컷 (Flow/Higgsfield/Veo 산출물이나 임의 로컬 파일 → cut_NN.mp4) ──
  const [s2cPath, setS2cPath] = useState({})
  const [s2cFit, setS2cFit] = useState({})
  const [s2cMotion, setS2cMotion] = useState({})
  const [s2cTrimStart, setS2cTrimStart] = useState({})
  const [s2cBusy, setS2cBusy] = useState({})
  const [s2cResult, setS2cResult] = useState({})
  const [s2cScan, setS2cScan] = useState(null)
  const [s2cScanBusy, setS2cScanBusy] = useState(false)
  const scanSources = async () => {
    if (!episode?.number) return
    setS2cScanBusy(true)
    try {
      const r = await fetch(`${YEORI_SERVER}/api/source-scan?epNum=${episode.number}`)
      const d = await r.json()
      setS2cScan(Array.isArray(d.items) ? d.items : [])
    } catch { setS2cScan([]) } finally { setS2cScanBusy(false) }
  }
  const runSourceToCut = async (cut) => {
    const srcPath = String(s2cPath[cut.no] || '').trim()
    if (!srcPath || !episode?.number) return
    setS2cBusy(p => ({ ...p, [cut.no]: true }))
    setS2cResult(p => ({ ...p, [cut.no]: null }))
    try {
      const r = await fetch(`${YEORI_SERVER}/api/source-to-cut`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epNum: episode.number, cutNo: cut.no, srcPath,
          duration: cutDuration(cut),
          trimStart: s2cTrimStart[cut.no] || '',
          trimMode: 'start',
          motion: s2cMotion[cut.no] || 'none',
          fit: s2cFit[cut.no] || 'cover',
        }),
      })
      const data = await r.json()
      setS2cResult(p => ({ ...p, [cut.no]: r.ok ? data : { error: data.error || '실패' } }))
      if (r.ok && cut.subtitle && typeStyles[cut.cutType]?.overlay?.enabled) await runOverlay(cut)
    } catch (e) {
      setS2cResult(p => ({ ...p, [cut.no]: { error: `서버 연결 실패: ${e.message}` } }))
    } finally {
      setS2cBusy(p => ({ ...p, [cut.no]: false }))
    }
  }

  const renderSourceToCutPanel = (cut) => {
    const isVideoGuess = /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(s2cPath[cut.no] || '')
    return (
      <div className={s.subPanel}>
        <div className={s.settingLabel}>스튜디오 소스로 컷 만들기 (이미지·영상 → cut_{String(cut.no).padStart(2, '0')}.mp4)</div>
        <div className={s.emptyHint}>
          스튜디오에서 만든 “약간 움직이는 초상 클립”·합성 이미지나 임의 로컬 파일을 컷 규격(1080×1920)으로 확정합니다.
          영상은 트림, 이미지는 모션(줌/페이드)을 얹습니다. CP가 있으면 손글씨까지 이어집니다.
        </div>
        <div className={s.urlRow}>
          <input className={s.urlInput} value={s2cPath[cut.no] || ''}
            placeholder="파일 경로 (절대경로 또는 downloads/... 상대경로)"
            onChange={e => setS2cPath(p => ({ ...p, [cut.no]: e.target.value }))} />
          <button className={s.previewBtn} disabled={s2cScanBusy} onClick={scanSources}>
            {s2cScanBusy ? '⏳' : '소스 스캔'}
          </button>
        </div>
        {s2cScan && (
          s2cScan.length === 0
            ? <div className={s.emptyHint}>스캔된 소스 없음 (downloads/making/ep{episode?.number}/source/&#123;studio·upload·stock&#125;, flow·video/ep{episode?.number})</div>
            : (
              <div className={s.cutList} style={{ maxHeight: 150, overflow: 'auto' }}>
                {s2cScan.map((it, i) => (
                  <button key={i} className={s.previewBtn} style={{ textAlign: 'left' }}
                    onClick={() => setS2cPath(p => ({ ...p, [cut.no]: it.path }))}>
                    [{it.group}·{it.kind}] {it.name} ({it.sizeKB}KB)
                  </button>
                ))}
              </div>
            )
        )}
        <div className={s.styleRow}>
          <label className={s.styleField}>화면 맞춤
            <select value={s2cFit[cut.no] || 'cover'} onChange={e => setS2cFit(p => ({ ...p, [cut.no]: e.target.value }))}>
              <option value="cover">꽉 채우기(크롭)</option>
              <option value="contain">여백(레터박스)</option>
              <option value="blur">블러 배경</option>
            </select>
          </label>
          {isVideoGuess ? (
            <label className={s.styleField}>시작 초(선택)
              <input value={s2cTrimStart[cut.no] || ''} placeholder="예: 13"
                onChange={e => setS2cTrimStart(p => ({ ...p, [cut.no]: e.target.value }))} />
            </label>
          ) : (
            <label className={s.styleField}>이미지 모션
              <select value={s2cMotion[cut.no] || 'none'} onChange={e => setS2cMotion(p => ({ ...p, [cut.no]: e.target.value }))}>
                {GRAPHIC_MOTIONS.filter(([v]) => !ANIMATED_GRAPHIC_MOTIONS.has(v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className={s.editorActions}>
          <button className={s.captureBtn}
            disabled={s2cBusy[cut.no] || !(s2cPath[cut.no] || '').trim() || !episode?.number}
            onClick={() => runSourceToCut(cut)}>
            {s2cBusy[cut.no] ? '⏳ 제작 중…' : '이 소스로 컷 제작'}
          </button>
        </div>
        {s2cResult[cut.no] && (
          s2cResult[cut.no].error
            ? <div className={s.resultError}>❌ {s2cResult[cut.no].error}</div>
            : <div className={s.resultOk}>✅ {s2cResult[cut.no].outputPath} ({s2cResult[cut.no].sizeKB}KB · {s2cResult[cut.no].duration}초 · {s2cResult[cut.no].kind})</div>
        )}
      </div>
    )
  }

  const runCapcutSemiauto = async (cut) => {
    const points = String(semiPoints[cut.no] || '').trim()
    if (!points || !episode.number) return
    setSemiBusy(p => ({ ...p, [cut.no]: true }))
    setSemiResult(p => ({ ...p, [cut.no]: null }))
    try {
      const editorUrl = cdpStatus?.editors?.[0]?.url || ''
      const r = await fetch(`${YEORI_SERVER}/api/capcut-semiauto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epNum: episode.number, cutNo: cut.no, effect: 'hairline',
          points, editorUrl,
          transition: semiTransition[cut.no] || '',
        }),
      })
      const data = await r.json()
      setSemiResult(p => ({ ...p, [cut.no]: r.ok ? data : { error: data.error || '자동편집 실패', log: data.log } }))
    } catch (e) {
      setSemiResult(p => ({ ...p, [cut.no]: { error: `서버 연결 실패: ${e.message}` } }))
    } finally {
      setSemiBusy(p => ({ ...p, [cut.no]: false }))
    }
  }

  // HTML 소스 후보 목록(에피소드 폴더에 이미 있는 .html 파일들) — CUT2/CUT3의
  // RL02_DM_mockup_v3.html 같은 커스텀 목업을 찾기 위함.
  const [episodeHtmlFiles, setEpisodeHtmlFiles] = useState([])
  const [htmlFilesLoading, setHtmlFilesLoading] = useState(false)
  const [selectedHtmlFile, setSelectedHtmlFile] = useState('__auto__')

  // 유형별 자동 템플릿 시각 스타일을 바꾸면, 자동 템플릿으로 열려 있는 GRAPHIC/CAPCUT
  // 컷의 편집기 내용을 새 스타일로 다시 채운다(목업 파일을 고른 상태면 건드리지 않음).
  useEffect(() => {
    if (selectedCutNo == null || selectedHtmlFile !== '__auto__') return
    const cut = (cuts || []).find(c => c.no === selectedCutNo)
    if (cut && (cut.cutType === 'GRAPHIC' || cut.cutType === 'CAPCUT')) {
      setHtmlSource(fillTemplate(cut, styleFor(cut.cutType)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeStyles])

  const instaRouteParams = () => {
    const instaContent = (cuts || []).map(c => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean)
      || episodeContentTypeToInsta(episode?.contentType)
    const instaNum = instaContent ? (episode?.instaNum?.trim() || '') : ''
    return { instaContent: instaContent || '', instaNum }
  }

  const fetchEpisodeHtmlFiles = async () => {
    setHtmlFilesLoading(true)
    try {
      const { instaContent, instaNum } = instaRouteParams()
      const qs = new URLSearchParams({ instaContent, instaNum, episodeCode: episodeCode || '' })
      const res = await fetch(`${YEORI_SERVER}/api/list-episode-html?${qs}`)
      const data = await res.json()
      const files = data.files || []
      setEpisodeHtmlFiles(files)
      return files
    } catch {
      setEpisodeHtmlFiles([])
      return []
    } finally {
      setHtmlFilesLoading(false)
    }
  }

  const applyHtmlFileChoice = async (fileName, cut) => {
    setSelectedHtmlFile(fileName)
    if (fileName === '__auto__') {
      setHtmlSource(fillTemplate(cut, styleFor(cut.cutType)))
      return
    }
    try {
      const { instaContent, instaNum } = instaRouteParams()
      const qs = new URLSearchParams({ file: fileName, instaContent, instaNum, episodeCode: episodeCode || '' })
      const res = await fetch(`${YEORI_SERVER}/api/read-episode-html?${qs}`)
      const data = await res.json()
      if (res.ok) setHtmlSource(data.html)
    } catch { /* noop */ }
  }

  // GRAPHIC / CAPCUT(html 모드) 컷을 HTML 캡처용으로 선택 — selectCut()으로 htmlSource/
  // selectedCutNo를 채우고, 이 컷 폴더의 .html 후보 목록을 불러온다. 해당 유형의 기본
  // HTML 파일이 지정돼 있고 그 목록에 있으면 자동 선택한다.
  const selectHtmlCut = async (cut) => {
    selectCut(cut)
    setSelectedHtmlFile('__auto__')
    const def = typeStyles[cut.cutType]?.htmlFile
    const files = await fetchEpisodeHtmlFiles()
    if (def && files.includes(def)) applyHtmlFileChoice(def, cut)
  }

  // "유형별 기본 제작 스타일" 카드의 기본 HTML 파일 자동완성 목록용 — 컷을 펼치지
  // 않아도 목록이 채워지도록 에피소드가 바뀔 때 한 번 불러온다.
  useEffect(() => {
    fetchEpisodeHtmlFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeCode, episode?.instaNum])

  const selectCapcutCut = (cut) => {
    setSelectedCapcutCutNo(cut.no)
    setCapcutTargetDuration(cutDuration(cut))
    setCapcutResult(null)
    setCapcutStatus(null)
  }

  const checkCapcutWindow = async () => {
    setCapcutChecking(true)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/capcut-window`)
      const data = await res.json()
      setCapcutStatus(data)
    } catch (e) {
      setCapcutStatus({ running: false, error: e.message })
    } finally {
      setCapcutChecking(false)
    }
  }

  const startCapcutRecording = async () => {
    if (selectedCapcutCutNo == null || !episode.number) return
    setCapcutBusy(true)
    setCapcutResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutNo: selectedCapcutCutNo,
          options: { fps: 30, quality: 'medium' },
          capcut: { epNum: episode.number, targetDuration: capcutTargetDuration, trimMode: capcutTrimMode },
        }),
      })
      const data = await res.json()
      if (!res.ok) { setCapcutResult({ error: data.error || '녹화 시작 실패' }); return }
      setCapcutRecording(true)
    } catch (e) {
      setCapcutResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setCapcutBusy(false)
    }
  }

  const stopCapcutRecording = async () => {
    setCapcutBusy(true)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/stop`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setCapcutResult({ error: data.error || '녹화 종료 실패' }); return }
      setCapcutResult(data)
    } catch (e) {
      setCapcutResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setCapcutRecording(false)
      setCapcutBusy(false)
    }
  }

  // ── G5-M: 컷 번호 순서대로 확정된 cut_{NN}.mp4(컷타입 무관, BROLL/CAPCUT/GRAPHIC이
  // 자동편집으로 만든 것이든 YEORI의 기존 파일이든 전부 downloads/video/ep{N}/에
  // 모여 있어 그대로 이어붙이면 됨)를 메이킹 필름 하나로 조립.
  const [assembling, setAssembling] = useState(false)
  const [assembleResult, setAssembleResult] = useState(null)
  const [makingPreview, setMakingPreview] = useState(false)

  // ── BGM: TrendRadar "BGM 레이더"로 검색·다운로드한 트랙을 메이킹 필름 밑에 깐다 ──
  const BGM_MOODS = [['BGM_EMO', '감성'], ['BGM_INFO', '정보전달'], ['BGM_HOOK', '훅'], ['BGM_CALM', '차분']]
  const [bgmOpen, setBgmOpen] = useState(false)
  const [bgmLibrary, setBgmLibrary] = useState([])
  const [bgmMood, setBgmMood] = useState('BGM_EMO')
  const [bgmKeyword, setBgmKeyword] = useState('')
  const [bgmSearching, setBgmSearching] = useState(false)
  const [bgmSearchResults, setBgmSearchResults] = useState([])
  const [bgmDownloading, setBgmDownloading] = useState({})
  const [bgmPick, setBgmPick] = useState('')       // 선택한 라이브러리 트랙의 file 경로
  const [bgmVolume, setBgmVolume] = useState(0.22)
  const [bgmDuck, setBgmDuck] = useState(true)
  const [bgmBusy, setBgmBusy] = useState(false)
  const [bgmResult, setBgmResult] = useState(null)

  const loadBgmLibrary = () => {
    fetch(`${YEORI_SERVER}/api/bgm-library`).then(r => r.json())
      .then(d => setBgmLibrary(d.tracks || [])).catch(() => {})
  }
  useEffect(() => { loadBgmLibrary() }, [])

  const searchBgm = async () => {
    setBgmSearching(true); setBgmSearchResults([])
    try {
      const res = await fetch(`${YEORI_SERVER}/api/bgm-search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood: bgmMood, keywords: bgmKeyword.split(',').map(s => s.trim()).filter(Boolean) }),
      })
      const data = await res.json()
      setBgmSearchResults(res.ok ? (data.results || []) : [])
    } catch { setBgmSearchResults([]) }
    finally { setBgmSearching(false) }
  }

  const downloadBgm = async (item) => {
    setBgmDownloading(p => ({ ...p, [item.id ?? item.title]: true }))
    try {
      const filename = (item.title || 'bgm').replace(/[\\/:*?"<>|]/g, '').trim() + '.mp3'
      await fetch(`${YEORI_SERVER}/api/bgm-download`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.downloadUrl || item.url || item.detailUrl, mood: bgmMood, filename }),
      })
      loadBgmLibrary()
    } catch { /* noop */ }
    finally { setBgmDownloading(p => ({ ...p, [item.id ?? item.title]: false })) }
  }

  const applyBgm = async () => {
    if (!bgmPick || !episode.number) return
    setBgmBusy(true); setBgmResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/making-bgm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum: episode.number, bgmFile: bgmPick, volume: bgmVolume, duck: bgmDuck }),
      })
      const data = await res.json()
      if (!res.ok) { setBgmResult({ error: data.error || 'BGM 합성 실패' }); return }
      setBgmResult({ ...data, _ts: Date.now() })
    } catch (e) {
      setBgmResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setBgmBusy(false)
    }
  }

  const assembleMaking = async () => {
    setAssembling(true)
    setAssembleResult(null)
    setMakingPreview(false)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/making-assemble`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(episode.number ? { epNum: episode.number } : {}),
      })
      const data = await res.json()
      if (!res.ok) { setAssembleResult({ error: data.error || '조립 실패' }); return }
      setAssembleResult(data)
    } catch (e) {
      setAssembleResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setAssembling(false)
    }
  }

  // ── 손글씨 오버레이 ─────────────────────────────────────────────────
  // "이 컷에 자막을 얹는다"는 대본 CP(cut.subtitle)로 정의됨. 효과의 시각 스타일은
  // 유형별 기본 제작 스타일 카드에서 한 번만 설정. 컷 카드에는 편집 UI를 두지 않고,
  // CP 있는 컷의 제작 실행 시 그 스타일로 자동 합성한다(+ 재적용 버튼만 노출).
  const OVERLAY_POSITIONS = ['top_center', 'top_left', 'top_right', 'center', 'bottom_center', 'bottom_left', 'bottom_right']
  const OVERLAY_BUBBLES = [['none', '없음'], ['cloud', '구름'], ['oval', '타원'], ['arrow_box', '화살표박스']]
  const OVERLAY_COLORS = [['white', '흰색'], ['pink', '핑크'], ['lavender', '라벤더']]
  const OVERLAY_ARROW_DIRS = ['right', 'left', 'up', 'down']

  const [overlayBusy, setOverlayBusy] = useState({})     // { [cutNo]: bool }
  const [overlayResult, setOverlayResult] = useState({}) // { [cutNo]: data | { error } }

  // ── 이미지에 손글씨 (썸네일·스틸용) — 임의 이미지 + 씬별 손글씨 → 씬마다 PNG ──
  const newHwScene = () => ({
    text: '', position: 'top_center', bubble: 'cloud', color: 'white',
    deco: '', arrow: false, arrow_direction: 'down', underline: false, time: '0s~3s',
  })
  const [hwOpen, setHwOpen] = useState(false)
  const [hwImgList, setHwImgList] = useState([])
  const [hwImgPath, setHwImgPath] = useState('')
  const [hwScenes, setHwScenes] = useState([newHwScene()])
  const [hwBusy, setHwBusy] = useState(false)
  const [hwResult, setHwResult] = useState(null)

  useEffect(() => {
    fetch(`${YEORI_SERVER}/api/hw-source-images`).then(r => r.json())
      .then(d => setHwImgList(d.images || [])).catch(() => {})
  }, [])

  const patchHwScene = (i, patch) => setHwScenes(a => a.map((s, j) => j === i ? { ...s, ...patch } : s))

  const runHwImage = async () => {
    if (!hwImgPath.trim() || !hwScenes.some(s => s.text.trim())) return
    setHwBusy(true); setHwResult(null)
    try {
      const scenes = hwScenes.filter(s => s.text.trim()).map(s => ({
        text: s.text, position: s.position, bubble: s.bubble, color: s.color,
        deco: String(s.deco || '').split(',').map(x => x.trim()).filter(Boolean),
        arrow: !!s.arrow, arrow_direction: s.arrow_direction, underline: !!s.underline, time: s.time,
      }))
      const res = await fetch(`${YEORI_SERVER}/api/handwriting-overlay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputPath: hwImgPath.trim(), scenes }),
      })
      const data = await res.json()
      if (!res.ok) { setHwResult({ error: data.error || '합성 실패' }); return }
      setHwResult({ ...data, _ts: Date.now() })
    } catch (e) {
      setHwResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setHwBusy(false)
    }
  }

  // 대본 CP + 유형별 오버레이 스타일 → 씬 1개를 조립해 /api/handwriting-overlay 호출.
  const runOverlay = async (cut) => {
    const ov = typeStyles[cut.cutType]?.overlay
    if (!cut.subtitle || !ov?.enabled || !episode.number) return { ok: false, skipped: true }
    const scene = {
      text: cut.subtitle,
      position: ov.position,
      bubble: ov.bubble,
      color: ov.color,
      deco: String(ov.deco || '').split(',').map(s => s.trim()).filter(Boolean),
      arrow: !!ov.arrow,
      arrow_direction: ov.arrow_direction,
      underline: !!ov.underline,
      time: overlayTimeRange(ov.timing, cutDuration(cut)),
    }
    setOverlayBusy(p => ({ ...p, [cut.no]: true }))
    setOverlayResult(p => ({ ...p, [cut.no]: null }))
    try {
      const res = await fetch(`${YEORI_SERVER}/api/handwriting-overlay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum: episode.number, cutNo: cut.no, scenes: [scene] }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOverlayResult(p => ({ ...p, [cut.no]: { error: data.error || '오버레이 실패' } }))
        return { ok: false, error: data.error || '오버레이 실패' }
      }
      setOverlayResult(p => ({ ...p, [cut.no]: { ...data, _ts: Date.now() } }))
      return { ok: true, data }
    } catch (e) {
      setOverlayResult(p => ({ ...p, [cut.no]: { error: `서버 연결 실패: ${e.message}` } }))
      return { ok: false, error: e.message }
    } finally {
      setOverlayBusy(p => ({ ...p, [cut.no]: false }))
    }
  }

  // ── 유형별 자동실행 — MANUAL_TYPES 컷을 유형에 맞는 헤드리스 방식으로 일괄 제작 ──
  //   GRAPHIC / CAPCUT(HTML) → 자동 템플릿(또는 지정 목업) 캡처 + CP 있으면 손글씨 오버레이
  //   BROLL(Pexels)          → 컷 키워드로 Pexels 영상 검색 → 상위 결과 자동 선택 → 규격화 다운로드
  //   CAPCUT(녹화) / BROLL(화면 녹화) → 화면 캡처가 필요해 자동 불가 → 건너뜀
  const [autoOpen, setAutoOpen] = useState(false)
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoLog, setAutoLog] = useState([])
  const [autoSkipDone, setAutoSkipDone] = useState(true)
  const [autoDoOverlay, setAutoDoOverlay] = useState(true)
  const autoStopRef = useRef(false)

  const autoPush = (entry) => setAutoLog(prev => [...prev, { t: Date.now(), ...entry }])

  const autoProduceGraphicish = async (cut) => {
    const type = cut.cutType
    const cfgFile = String(typeStyles[type]?.htmlFile || '').trim()
    const dur = cutDuration(cut)
    const motion = styleFor(type)?.motion || 'none'
    let res, data
    if (cfgFile) {
      res = await fetch(`${YEORI_SERVER}/api/make-graphic-cut`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum: episode.number, cutNo: cut.no, htmlFile: cfgFile, motion }),
      })
    } else {
      res = await fetch(`${YEORI_SERVER}/api/graphic-capture`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: fillTemplate(cut, styleFor(type)), cutNo: cut.no, epNum: episode.number, duration: dur, motion }),
      })
    }
    data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '캡처 실패')
    return data
  }

  const autoProduceBroll = async (cut) => {
    const description = `${cut.scene || ''} ${cut.narration || cut.dialogue || ''} ${cut.videoPrompt || ''}`.trim()
    const res = await fetch(`${YEORI_SERVER}/api/broll-auto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epNum: episode.number, cutNo: cut.no,
        description,
        duration: cutDuration(cut),
        hint: typeStyles.BROLL.brollQuery || '',
        fallbackQuery: deriveBrollKeyword(cut, ''),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 422) { const e = new Error(data.error || 'BROLL 자동 선택 실패'); e.soft = true; throw e }
      throw new Error(data.error || 'BROLL 자동 선택 실패')
    }
    return data
  }

  // 화면 녹화 대체 — URL 영상을 헤드리스로 캡처(페이지에서 미디어 URL 추출 → ffmpeg).
  const runBrollUrlCapture = async (cut, url) => {
    const dur = brollTargetDuration || cutDuration(cut)
    const res = await fetch(`${YEORI_SERVER}/api/capture-video-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cutNo: cut.no, epNum: episode.number, duration: dur, trimMode: brollTrimMode }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'URL 캡처 실패')
    return data
  }

  // 수동 패널용 — BROLL 화면 녹화 섹션의 "URL로 헤드리스 제작"
  const [brollUrlInput, setBrollUrlInput] = useState({})   // { [cutNo]: string }
  const [brollUrlBusy, setBrollUrlBusy] = useState({})
  const [brollUrlResult, setBrollUrlResult] = useState({})
  const doBrollUrlCapture = async (cut) => {
    const url = String(brollUrlInput[cut.no] || '').trim()
    if (!url || !episode.number) return
    setBrollUrlBusy(p => ({ ...p, [cut.no]: true }))
    setBrollUrlResult(p => ({ ...p, [cut.no]: null }))
    try {
      const data = await runBrollUrlCapture(cut, url)
      setBrollUrlResult(p => ({ ...p, [cut.no]: data }))
    } catch (e) {
      setBrollUrlResult(p => ({ ...p, [cut.no]: { error: e.message } }))
    } finally {
      setBrollUrlBusy(p => ({ ...p, [cut.no]: false }))
    }
  }

  // BROLL Pexels 패널 — "AI로 자동 선택 → 제작" (자동실행과 같은 /api/broll-auto)
  const [brollAutoBusy, setBrollAutoBusy] = useState({})
  const [brollAutoResult, setBrollAutoResult] = useState({})
  const runBrollAutoManual = async (cut) => {
    if (!episode.number) return
    setBrollAutoBusy(p => ({ ...p, [cut.no]: true }))
    setBrollAutoResult(p => ({ ...p, [cut.no]: null }))
    try {
      const data = await autoProduceBroll(cut)
      setBrollAutoResult(p => ({ ...p, [cut.no]: data }))
    } catch (e) {
      setBrollAutoResult(p => ({ ...p, [cut.no]: { error: e.message } }))
    } finally {
      setBrollAutoBusy(p => ({ ...p, [cut.no]: false }))
    }
  }

  const runAutoByType = async () => {
    if (autoRunning || !episode?.number) return
    autoStopRef.current = false
    setAutoRunning(true)
    setAutoLog([])
    const targets = allCuts.filter(c => MANUAL_TYPES.includes(c.cutType || 'YEORI'))
    autoPush({ kind: 'info', msg: `대상 ${targets.length}컷 — 자동실행 시작` })
    let ok = 0, skip = 0, fail = 0
    for (const cut of targets) {
      if (autoStopRef.current) { autoPush({ kind: 'info', msg: '사용자 중단' }); break }
      const type = cut.cutType
      if (autoSkipDone && videoStatus[cut.no]) {
        skip++; autoPush({ kind: 'skip', cutNo: cut.no, type, msg: '이미 완료' }); continue
      }
      // 컷에 스튜디오 소스 파일이 지정돼 있으면 유형 무관하게 소스→컷 경로로
      const studioSrc = String(cut.sourcePath || cut.studioSource || s2cPath[cut.no] || '').trim()
      if (studioSrc) {
        autoPush({ kind: 'run', cutNo: cut.no, type, msg: '스튜디오 소스로 제작 중…' })
        try {
          const r = await fetch(`${YEORI_SERVER}/api/source-to-cut`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              epNum: episode.number, cutNo: cut.no, srcPath: studioSrc,
              duration: cutDuration(cut), trimStart: cut.trimStart ?? '', trimMode: 'start',
              motion: styleFor(type)?.motion || 'none', fit: cut.fit || 'cover',
            }),
          })
          const d = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(d.error || '소스→컷 실패')
          let extra = ''
          if (autoDoOverlay && cut.subtitle && typeStyles[type]?.overlay?.enabled) {
            const ov = await runOverlay(cut); extra = ov?.ok ? ' + 손글씨' : ''
          }
          ok++; autoPush({ kind: 'ok', cutNo: cut.no, type, msg: `완료 · 스튜디오 소스(${d.kind})${extra}` })
        } catch (e) {
          fail++; autoPush({ kind: 'error', cutNo: cut.no, type, msg: e.message })
        }
        continue
      }
      const brMode = getBrollSourceMode(cut.no)
      const ccMode = getCapcutMode(cut.no)
      const brollUrl = String(cut.brollUrl || cut.sourceUrl || '').trim()
      // BROLL 화면 녹화 방식이라도 컷에 소스 URL이 있으면 헤드리스 URL 캡처로 대체
      const brollViaUrl = type === 'BROLL' && brMode === 'record' && brollUrl
      if (((type === 'BROLL' && brMode === 'record') || (type === 'CAPCUT' && ccMode === 'record')) && !brollViaUrl) {
        skip++
        autoPush({
          kind: 'skip', cutNo: cut.no, type,
          msg: type === 'BROLL'
            ? '화면 녹화 — 컷에 소스 URL을 넣으면 자동, 아니면 수동 녹화'
            : 'CapCut 녹화 — 텍스트/모션 컷이면 제작방식 HTML + 모션(타이핑·떠오름) 으로 바꾸면 자동. 헤어라인 등은 수동/CDP 스크립트.',
        })
        continue
      }
      autoPush({ kind: 'run', cutNo: cut.no, type, msg: '제작 중…' })
      try {
        if (brollViaUrl) {
          await runBrollUrlCapture(cut, brollUrl)
          ok++; autoPush({ kind: 'ok', cutNo: cut.no, type, msg: `완료 · URL 캡처` })
        } else if (type === 'GRAPHIC' || type === 'CAPCUT') {
          await autoProduceGraphicish(cut)
          let extra = ''
          if (autoDoOverlay && cut.subtitle && typeStyles[type]?.overlay?.enabled) {
            const ov = await runOverlay(cut)
            extra = ov?.ok ? ' + 손글씨' : ov?.error ? ` (손글씨 실패: ${ov.error})` : ''
          }
          ok++; autoPush({ kind: 'ok', cutNo: cut.no, type, msg: `완료${extra}` })
        } else if (type === 'BROLL') {
          const r = await autoProduceBroll(cut)
          ok++; autoPush({ kind: 'ok', cutNo: cut.no, type, msg: `완료 · ${r.aiUsed ? 'AI검색어' : '검색어'} "${r.query}"` })
        }
      } catch (e) {
        if (e.soft) { skip++; autoPush({ kind: 'skip', cutNo: cut.no, type, msg: e.message }) }
        else { fail++; autoPush({ kind: 'error', cutNo: cut.no, type, msg: e.message }) }
      }
    }
    autoPush({ kind: 'info', msg: `끝 — 완료 ${ok} · 건너뜀 ${skip} · 실패 ${fail}` })
    setAutoRunning(false)
  }

  const renderAutoRunCard = () => {
    const targets = allCuts.filter(c => MANUAL_TYPES.includes(c.cutType || 'YEORI'))
    const byType = targets.reduce((m, c) => ((m[c.cutType] = (m[c.cutType] || 0) + 1), m), {})
    return (
      <div className={s.card}>
        <button className={s.collapseToggle} onClick={() => setAutoOpen(v => !v)}>
          {autoOpen ? '▼' : '▶'} 유형별 자동실행 — GRAPHIC · CAPCUT(HTML) · BROLL(Pexels) 일괄 제작
        </button>
        {autoOpen && (
          <>
            <div className={s.emptyHint}>
              헤드리스로 만들 수 있는 컷만 유형에 맞게 자동 제작합니다.
              GRAPHIC/CAPCUT은 유형별 스타일·<b>기본 모션</b>(줌/페이드)으로 캡처하고 CP가 있으면 손글씨까지,
              BROLL은 <b>컷 묘사 → AI 검색어</b>로 Pexels 영상을 자동 선택해 규격화합니다.
              BROLL 화면 녹화 방식이라도 <b>컷에 소스 URL(brollUrl)</b>이 있으면 헤드리스 URL 캡처로 대체합니다.
              <b> CapCut 데스크톱 녹화, 소스 URL 없는 화면 녹화 컷은 건너뜁니다</b>(수동 진행).
            </div>
            <div className={s.autoNote}>
              대상: 총 {targets.length}컷
              {Object.entries(byType).map(([k, v]) => ` · ${k} ${v}`).join('')}
              {' '}(YEORI 등 파이프라인 컷 제외)
            </div>
            <div className={s.radioRow}>
              <label className={s.radioLabel}>
                <input type="checkbox" checked={autoSkipDone} onChange={e => setAutoSkipDone(e.target.checked)} />
                이미 완료된 컷 건너뛰기
              </label>
              <label className={s.radioLabel}>
                <input type="checkbox" checked={autoDoOverlay} onChange={e => setAutoDoOverlay(e.target.checked)} />
                손글씨 오버레이도 자동
              </label>
            </div>
            <div className={s.editorActions}>
              <button className={s.captureBtn} disabled={autoRunning || !episode?.number || !targets.length}
                onClick={runAutoByType}>
                {autoRunning ? '⏳ 자동실행 중…' : '▶ 유형별 자동실행'}
              </button>
              {autoRunning && (
                <button className={s.stopBtn} onClick={() => { autoStopRef.current = true }}>중단</button>
              )}
              {!episode?.number && <span className={s.emptyHint}>활성 에피소드가 필요합니다.</span>}
            </div>
            {autoLog.length > 0 && (
              <div className={s.cutList} style={{ marginTop: 8 }}>
                {autoLog.map((l, i) => (
                  <div key={i} className={
                    l.kind === 'error' ? s.resultError : l.kind === 'ok' ? s.resultOk : s.autoNote
                  }>
                    {l.kind === 'ok' ? '✅' : l.kind === 'error' ? '❌' : l.kind === 'skip' ? '⏭' : l.kind === 'run' ? '⏳' : 'ℹ'}
                    {' '}{l.cutNo != null ? `컷 ${l.cutNo} [${l.type}] — ` : ''}{l.msg}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // 컷 카드 하단 — CP 있는 GRAPHIC/CAPCUT 컷의 오버레이 상태/재적용만.
  const renderOverlayStatus = (cut) => {
    if (!cut.subtitle) return null
    const ov = typeStyles[cut.cutType]?.overlay
    const r = overlayResult[cut.no]
    return (
      <div className={s.subPanel}>
        {!ov?.enabled ? (
          <div className={s.autoNote}>
            손글씨 오버레이: 대본 CP “{cut.subtitle}” 감지됨. “유형별 기본 제작 스타일 → {cut.cutType} → 손글씨 오버레이”를 켜면
            제작 실행 시 그 스타일로 자동 합성됩니다.
          </div>
        ) : (
          <>
            <div className={s.emptyHint}>
              손글씨 오버레이 ON — CP “{cut.subtitle}” + {cut.cutType} 스타일({ov.bubble}/{ov.position}/{OVERLAY_TIMINGS.find(([v]) => v === ov.timing)?.[1]}).
              제작 실행 시 자동 적용되며, 스타일을 바꿨으면 아래로 재적용하세요.
            </div>
            <div className={s.editorActions}>
              <button className={s.previewBtn} disabled={overlayBusy[cut.no] || !videoStatus[cut.no]} onClick={() => runOverlay(cut)}>
                {overlayBusy[cut.no] ? '⏳ 합성 중…' : '오버레이 재적용'}
              </button>
            </div>
            {r && (
              r.error ? (
                <div className={s.resultError}>❌ {r.error}</div>
              ) : (
                <div className={s.resultOk}>
                  ✅ 오버레이 적용됨 — {r.outputPath?.split(/[/\\]/).pop()} ({r.sizeKB}KB)
                  <br />
                  <video className={s.makingVideo}
                    src={`${YEORI_SERVER}/downloads/video/ep${episode.number}/${r.outputPath?.split(/[/\\]/).pop()}?t=${r._ts || 0}`}
                    controls />
                </div>
              )
            )}
          </>
        )}
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────
  // 인라인 패널 렌더러 (컷 타입별)
  // ────────────────────────────────────────────────────────────────────────
  // GRAPHIC / CAPCUT(html 모드) 공용 — HTML 소스 선택 + 편집기 + 제작.
  const renderHtmlCapturePanel = (cut) => (
    <>
      <div className={s.settingGroup}>
        <div className={s.settingLabel}>HTML 소스</div>
        <select value={selectedHtmlFile} disabled={htmlFilesLoading}
          onChange={e => applyHtmlFileChoice(e.target.value, cut)}>
          <option value="__auto__">자동 템플릿 (유형별 스타일로 채우기)</option>
          {episodeHtmlFiles.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className={s.emptyHint}>
          {htmlFilesLoading
            ? 'HTML 파일 목록 불러오는 중…'
            : selectedHtmlFile === '__auto__'
              ? `자동 템플릿: ${cut.cutType} 유형 기본 스타일로 이 컷 문구를 채웁니다.`
              : `${selectedHtmlFile}에서 CUT ${cut.no} 부분만 잘라 캡처합니다.`}
        </div>
      </div>

      <div className={s.editorActions}>
        <label className={s.durationField}>
          길이(초)
          <input type="number" min="1" value={duration}
            onChange={e => setDuration(parseInt(e.target.value) || 1)} />
        </label>
        <button className={s.previewBtn} onClick={() => setPreviewHtml(htmlSource)}>미리보기</button>
        <button className={s.captureBtn} disabled={capturing} onClick={captureGraphic}>
          {capturing ? '⏳ 제작 중…' : '제작 실행'}
        </button>
      </div>

      <div className={s.settingLabel}>HTML 소스 (미세조정용 — 이 내용 그대로 캡처됩니다)</div>
      <textarea
        className={s.htmlEditor}
        value={htmlSource}
        onChange={e => setHtmlSource(e.target.value)}
        spellCheck={false}
      />

      {previewHtml && (
        <div className={s.previewWrap}>
          <div className={s.previewBox}>
            <iframe title="graphic-preview" srcDoc={previewHtml} className={s.previewFrame} />
          </div>
        </div>
      )}
      {captureResult && (
        captureResult.error ? (
          <div className={s.resultError}>❌ {captureResult.error}</div>
        ) : (
          <div className={s.resultOk}>
            ✅ 저장됨 — 이미지: {captureResult.imagePath} · 영상: {captureResult.videoPath}
          </div>
        )
      )}
    </>
  )

  const renderGraphicPanel = (cut) => (
    <div className={s.subPanel}>{renderHtmlCapturePanel(cut)}</div>
  )

  const renderBrollPanel = (cut) => {
    const mode = getBrollSourceMode(cut.no)
    const pick = brollPexelsPick[cut.no]
    const dlResult = brollDownloadResult[cut.no]
    return (
      <div className={s.subPanel}>
        <div className={s.settingLabel}>소스 선택</div>
        <div className={s.radioRow}>
          <button
            className={mode === 'pexels' ? s.captureBtn : s.previewBtn}
            onClick={() => setBrollSourceMode(p => ({ ...p, [cut.no]: 'pexels' }))}>
            Pexels 검색
          </button>
          <button
            className={mode === 'record' ? s.captureBtn : s.previewBtn}
            onClick={() => setBrollSourceMode(p => ({ ...p, [cut.no]: 'record' }))}>
            화면 녹화
          </button>
        </div>

        {mode === 'pexels' ? (
          <>
            <div className={s.editorActions}>
              <button className={s.captureBtn}
                disabled={brollAutoBusy[cut.no] || !episode.number}
                onClick={() => runBrollAutoManual(cut)}>
                {brollAutoBusy[cut.no] ? '⏳ AI 선택 중…' : '✨ AI로 자동 선택 → 제작'}
              </button>
              <span className={s.emptyHint}>컷 묘사로 검색어를 만들어 Pexels 영상을 골라 규격화합니다.</span>
            </div>
            {brollAutoResult[cut.no] && (
              brollAutoResult[cut.no].error ? (
                <div className={s.resultError}>❌ {brollAutoResult[cut.no].error}</div>
              ) : (
                <div className={s.resultOk}>
                  ✅ {brollAutoResult[cut.no].aiUsed ? 'AI검색어' : '검색어'} “{brollAutoResult[cut.no].query}” — {brollAutoResult[cut.no].outputPath || brollAutoResult[cut.no].finalPath}
                </div>
              )
            )}
            <div className={s.urlRow}>
              <input className={s.urlInput} value={sourceQuery} placeholder="예: slot machine lever"
                onChange={e => setSourceQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchSources()} />
              <button className={s.previewBtn} disabled={sourceSearching || !sourceQuery.trim()} onClick={searchSources}>
                {sourceSearching ? '⏳' : '검색'}
              </button>
              <div className={s.radioRow}>
                {[['portrait', '세로우선'], ['landscape', '가로'], ['all', '전체']].map(([v, l]) => (
                  <label key={v} className={s.radioLabel}>
                    <input type="radio" name={`broll-orient-${cut.no}`} value={v}
                      checked={sourceOrientation === v} onChange={() => setSourceOrientation(v)} />
                    {l}
                  </label>
                ))}
              </div>
            </div>

            {sourceError && <div className={s.resultError}>❌ {sourceError}</div>}

            {sourceResults.filter(r => r.type === 'video').length > 0 && (
              <div className={s.sourceGrid}>
                {sourceResults.filter(r => r.type === 'video').map(item => (
                  <div key={item.id}
                    className={`${s.sourceCard} ${pick?.id === item.id ? s.sourceCardActive : ''}`}
                    onClick={() => setBrollPexelsPick(p => ({ ...p, [cut.no]: item }))}>
                    <img src={item.thumbnail} alt={item.title} className={s.sourceThumb} loading="lazy" />
                    <div className={s.sourceMeta}>
                      <span className={s.sourcePhotographer}>{item.photographer || '작자 미상'}</span>
                      <span className={s.sourceDuration}>{item.duration}초</span>
                    </div>
                    <div className={s.radioLabel}>
                      <input type="radio" name={`broll-pick-${cut.no}`} readOnly checked={pick?.id === item.id} />
                      {pick?.id === item.id ? '선택됨' : '선택'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className={s.editorActions}>
              <label className={s.durationField}>
                길이(초)
                <input type="number" min="1" value={brollTargetDuration}
                  onChange={e => setBrollTargetDuration(parseInt(e.target.value) || 1)} />
              </label>
              <button className={s.captureBtn}
                disabled={!pick || brollDownloading[cut.no] || !episode.number}
                onClick={() => runBrollDownload(cut)}>
                {brollDownloading[cut.no] ? '⏳ 제작 중…' : '제작 실행'}
              </button>
              {!pick && <span className={s.emptyHint}>검색 결과에서 영상을 하나 선택하세요.</span>}
            </div>

            {dlResult && (
              dlResult.error ? (
                <div className={s.resultError}>❌ {dlResult.error}</div>
              ) : (
                <div className={s.resultOk}>
                  ✅ 저장됨 — {dlResult.outputPath}
                  {dlResult.duration != null && <> ({dlResult.duration?.toFixed?.(1) ?? dlResult.duration}초)</>}
                </div>
              )
            )}

            <div className={s.pexelsCredit}>
              Videos provided by <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>
            </div>
          </>
        ) : (
          <>
            <div className={s.settingGroup}>
              <div className={s.settingLabel}>영상 URL — 헤드리스 캡처 (화면 녹화 없이)</div>
              <div className={s.urlRow}>
                <input className={s.urlInput}
                  value={brollUrlInput[cut.no] ?? brollUrl}
                  placeholder="영상 페이지 또는 mp4/webm/m3u8 URL"
                  onChange={e => setBrollUrlInput(p => ({ ...p, [cut.no]: e.target.value }))} />
                <button className={s.previewBtn}
                  disabled={!(brollUrlInput[cut.no] ?? brollUrl)}
                  onClick={() => window.open(brollUrlInput[cut.no] ?? brollUrl, '_blank', 'noopener,noreferrer')}>열기</button>
                <button className={s.captureBtn}
                  disabled={brollUrlBusy[cut.no] || !(brollUrlInput[cut.no] ?? brollUrl) || !episode.number}
                  onClick={() => doBrollUrlCapture(cut)}>
                  {brollUrlBusy[cut.no] ? '⏳ 캡처 중…' : 'URL로 제작'}
                </button>
              </div>
              <div className={s.emptyHint}>
                페이지에서 실제 미디어 URL(mp4·webm·m3u8)을 추출해 ffmpeg로 직접 받아 1080×1920로 규격화합니다.
                blob/DRM/캔버스 렌더링 영상은 추출 불가 → 아래 데스크톱 녹화를 쓰세요.
              </div>
              {brollUrlResult[cut.no] && (
                brollUrlResult[cut.no].error ? (
                  <div className={s.resultError}>❌ {brollUrlResult[cut.no].error}</div>
                ) : (
                  <div className={s.resultOk}>
                    ✅ 편집 완료 — {brollUrlResult[cut.no].finalPath}
                    {brollUrlResult[cut.no].finalDuration != null &&
                      <> ({(brollUrlResult[cut.no].finalDuration).toFixed?.(1) ?? brollUrlResult[cut.no].finalDuration}초)</>}
                    <br /><span className={s.emptyHint}>소스: {brollUrlResult[cut.no].mediaUrl}</span>
                  </div>
                )
              )}
            </div>

            <div className={s.settingLabel} style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              또는 데스크톱 화면 녹화
            </div>
            <div className={s.settingRow}>
              <div className={s.settingGroup}>
                <div className={s.settingLabel}>녹화 품질</div>
                <div className={s.radioRow}>
                  {['low', 'medium', 'high'].map(q => (
                    <label key={q} className={s.radioLabel}>
                      <input type="radio" name={`broll-quality-${cut.no}`} value={q}
                        checked={brollQuality === q} onChange={() => setBrollQuality(q)} disabled={brollRecording} />
                      {q}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className={s.settingRow}>
              <div className={s.settingGroup}>
                <div className={s.settingLabel}>녹화 영역</div>
                <div className={s.radioRow}>
                  <label className={s.radioLabel}>
                    <input type="radio" name={`broll-region-${cut.no}`} value="full"
                      checked={brollRegionMode === 'full'} onChange={() => setBrollRegionMode('full')} disabled={brollRecording} />
                    전체화면
                  </label>
                  <label className={s.radioLabel}>
                    <input type="radio" name={`broll-region-${cut.no}`} value="custom"
                      checked={brollRegionMode === 'custom'} onChange={() => setBrollRegionMode('custom')} disabled={brollRecording} />
                    특정영역
                  </label>
                  {brollRegionMode === 'custom' && (
                    <div className={s.regionInputs}>
                      {['x', 'y', 'w', 'h'].map(k => (
                        <label key={k} className={s.regionField}>
                          {k}
                          <input type="number" value={brollRegion[k]} disabled={brollRecording}
                            onChange={e => setBrollRegion(prev => ({ ...prev, [k]: parseInt(e.target.value) || 0 }))} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {brollRegionMode === 'full' && (
                  <div className={s.emptyHint}>
                    녹화 시작을 누르면 3초 뒤에 실제로 녹화가 시작됩니다 — 그 사이 대상 화면으로 전환하세요.
                  </div>
                )}
              </div>

              <div className={s.settingGroup}>
                <div className={s.settingLabel}>목표 길이(초) / 트림 위치</div>
                <div className={s.radioRow}>
                  <input type="number" min="1" value={brollTargetDuration} disabled={brollRecording}
                    onChange={e => setBrollTargetDuration(parseInt(e.target.value) || 1)}
                    className={s.durationInput} />
                  <label className={s.radioLabel}>
                    <input type="radio" name={`broll-trim-${cut.no}`} value="end"
                      checked={brollTrimMode === 'end'} onChange={() => setBrollTrimMode('end')} disabled={brollRecording} />
                    끝에서부터
                  </label>
                  <label className={s.radioLabel}>
                    <input type="radio" name={`broll-trim-${cut.no}`} value="start"
                      checked={brollTrimMode === 'start'} onChange={() => setBrollTrimMode('start')} disabled={brollRecording} />
                    처음부터
                  </label>
                </div>
              </div>
            </div>

            <div className={s.editorActions}>
              {!brollRecording ? (
                <button className={s.captureBtn} disabled={brollBusy || brollCountdown != null} onClick={startBrollRecording}>
                  {brollCountdown != null ? `${brollCountdown}초 후 시작…` : brollBusy ? '⏳' : '제작 실행 (녹화 시작)'}
                </button>
              ) : (
                <button className={s.stopBtn} disabled={brollBusy} onClick={stopBrollRecording}>
                  🔴 녹화 중... 중지
                </button>
              )}
            </div>

            {brollResult && (
              brollResult.error ? (
                <div className={s.resultError}>❌ {brollResult.error}</div>
              ) : (
                <div className={s.resultOk}>
                  ✅ 편집 완료 — 최종: {brollResult.finalPath} ({(brollResult.finalSizeBytes / 1024 / 1024).toFixed(1)}MB, {brollResult.finalDuration?.toFixed?.(1) ?? brollResult.finalDuration}초)
                  <br />원본(raw, 보관됨): {brollResult.rawPath} ({(brollResult.rawSizeBytes / 1024 / 1024).toFixed(1)}MB, {brollResult.rawDuration?.toFixed(1)}초)
                </div>
              )
            )}
          </>
        )}
      </div>
    )
  }

  const renderCapcutPanel = (cut) => {
    const mode = getCapcutMode(cut.no)
    return (
      <div className={s.subPanel}>
        <div className={s.settingLabel}>제작 방식</div>
        <div className={s.radioRow}>
          <label className={s.radioLabel}>
            <input type="radio" name={`capcut-mode-${cut.no}`} checked={mode === 'html'}
              onChange={() => {
                setCapcutMode(p => ({ ...p, [cut.no]: 'html' }))
                selectHtmlCut(cut)
              }} />
            HTML 캡처로 제작
          </label>
          <label className={s.radioLabel}>
            <input type="radio" name={`capcut-mode-${cut.no}`} checked={mode === 'record'}
              onChange={() => setCapcutMode(p => ({ ...p, [cut.no]: 'record' }))} />
            CapCut 데스크톱 녹화
          </label>
        </div>

        {mode === 'html' ? (
          renderHtmlCapturePanel(cut)
        ) : (
          <>
            <div className={s.editorActions}>
              <button className={s.previewBtn} disabled={capcutChecking} onClick={checkCapcutWindow}>
                {capcutChecking ? '⏳ 확인 중…' : 'CapCut 상태 확인'}
              </button>
            </div>

            {capcutStatus && (
              capcutStatus.running ? (
                <div className={s.resultOk}>
                  ✅ 실행 중 — {capcutStatus.windowTitle || 'CapCut'} (PID {capcutStatus.pid}, 창 {capcutStatus.region?.w}×{capcutStatus.region?.h})
                </div>
              ) : (
                <div className={s.resultError}>⚠️ CapCut을 먼저 실행해주세요.</div>
              )
            )}

            {capcutStatus?.running && (
              <>
                <div className={s.settingGroup}>
                  <div className={s.settingLabel}>목표 길이(초) / 트림 위치</div>
                  <div className={s.radioRow}>
                    <input type="number" min="1" value={capcutTargetDuration} disabled={capcutRecording}
                      onChange={e => setCapcutTargetDuration(parseInt(e.target.value) || 1)}
                      className={s.durationInput} />
                    <label className={s.radioLabel}>
                      <input type="radio" name={`capcut-trim-${cut.no}`} value="end"
                        checked={capcutTrimMode === 'end'} onChange={() => setCapcutTrimMode('end')} disabled={capcutRecording} />
                      끝에서부터
                    </label>
                    <label className={s.radioLabel}>
                      <input type="radio" name={`capcut-trim-${cut.no}`} value="start"
                        checked={capcutTrimMode === 'start'} onChange={() => setCapcutTrimMode('start')} disabled={capcutRecording} />
                      처음부터
                    </label>
                  </div>
                </div>

                <div className={s.editorActions}>
                  {!capcutRecording ? (
                    <button className={s.captureBtn} disabled={capcutBusy} onClick={startCapcutRecording}>
                      {capcutBusy ? '⏳' : '제작 실행 (녹화 시작)'}
                    </button>
                  ) : (
                    <button className={s.stopBtn} disabled={capcutBusy} onClick={stopCapcutRecording}>
                      🔴 녹화 중... 중지
                    </button>
                  )}
                </div>
              </>
            )}

            {capcutResult && (
              capcutResult.error ? (
                <div className={s.resultError}>❌ {capcutResult.error}</div>
              ) : (
                <div className={s.resultOk}>
                  ✅ 편집 완료 — 최종: {capcutResult.finalPath} ({(capcutResult.finalSizeBytes / 1024 / 1024).toFixed(1)}MB, {capcutResult.finalDuration?.toFixed?.(1) ?? capcutResult.finalDuration}초)
                  <br />원본(raw, 보관됨): {capcutResult.rawPath} ({(capcutResult.rawSizeBytes / 1024 / 1024).toFixed(1)}MB, {capcutResult.rawDuration?.toFixed(1)}초)
                </div>
              )
            )}

            <div className={s.settingLabel} style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              CapCut 자동편집 (세미오토) — 헤어라인 리셰이프
            </div>
            <div className={s.emptyHint}>
              전용 프로필 Chrome(9222)에 <b>CapCut 에디터 탭을 열고 대상 클립을 로드</b>한 상태에서 실행하면,
              구간 분할 + 헤어라인 값 적용 + 트랜지션까지 자동으로 합니다. <b>미리보기 확인·내보내기는 CapCut에서 직접</b>,
              내보낸 파일을 <code>cut_{String(cut.no).padStart(2, '0')}.mp4</code>로 저장하세요.
            </div>
            <div className={s.editorActions}>
              <button className={s.previewBtn} disabled={cdpChecking} onClick={checkCdp}>
                {cdpChecking ? '⏳' : 'CDP·에디터 탭 확인'}
              </button>
              {cdpStatus && (
                cdpStatus.cdpUp
                  ? <span className={s.emptyHint}>
                      CDP 정상 · 에디터 탭 {cdpStatus.editors?.length || 0}개
                      {cdpStatus.editors?.[0] ? ` (${cdpStatus.editors[0].title || cdpStatus.editors[0].url})` : ' — 에디터 탭을 열어주세요'}
                    </span>
                  : <span className={s.resultError} style={{ display: 'inline' }}>CDP(9222) 꺼짐 — start_yeori 전용 Chrome을 실행하세요</span>
              )}
            </div>
            <div className={s.styleRow}>
              <label className={s.styleField} style={{ flex: 2 }}>구간 (시간:헤어라인값, 쉼표)
                <input value={semiPoints[cut.no] || ''} placeholder="예: 0:0, 1.7:50, 3.3:100"
                  onChange={e => setSemiPoints(p => ({ ...p, [cut.no]: e.target.value }))} />
              </label>
              <label className={s.styleField}>트랜지션(선택)
                <input value={semiTransition[cut.no] || ''} placeholder="예: Dissolve"
                  onChange={e => setSemiTransition(p => ({ ...p, [cut.no]: e.target.value }))} />
              </label>
            </div>
            <div className={s.editorActions}>
              <button className={s.captureBtn}
                disabled={semiBusy[cut.no] || !(semiPoints[cut.no] || '').trim() || !episode.number}
                onClick={() => runCapcutSemiauto(cut)}>
                {semiBusy[cut.no] ? '⏳ 자동편집 중… (최대 4분)' : '자동편집 실행'}
              </button>
            </div>
            {semiResult[cut.no] && (
              semiResult[cut.no].error ? (
                <div className={s.resultError}>❌ {semiResult[cut.no].error}
                  {semiResult[cut.no].log && <pre className={s.emptyHint} style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{semiResult[cut.no].log}</pre>}
                </div>
              ) : (
                <div className={s.resultOk}>✅ {semiResult[cut.no].message}</div>
              )
            )}
          </>
        )}
      </div>
    )
  }

  const renderPanel = (cut) => {
    let panel = null
    if (cut.cutType === 'GRAPHIC') panel = renderGraphicPanel(cut)
    else if (cut.cutType === 'BROLL') panel = renderBrollPanel(cut)
    else if (cut.cutType === 'CAPCUT') panel = renderCapcutPanel(cut)
    return (
      <>
        {panel}
        {MANUAL_TYPES.includes(cut.cutType) && renderSourceToCutPanel(cut)}
        {(cut.cutType === 'GRAPHIC' || cut.cutType === 'CAPCUT') && renderOverlayStatus(cut)}
      </>
    )
  }

  // ── 유형별 기본 제작 스타일 카드 ────────────────────────────────────────
  const STYLE_TYPES = [
    { key: 'GRAPHIC', modes: null, hasTemplate: true, hasOverlay: true },
    { key: 'CAPCUT', modes: [['html', 'HTML 캡처'], ['record', 'CapCut 녹화']], hasTemplate: true, hasOverlay: true },
    { key: 'BROLL', modes: [['pexels', 'Pexels 검색'], ['record', '화면 녹화']], hasTemplate: false, hasOverlay: false },
  ]

  const renderTypeStyleCard = () => (
    <div className={s.card}>
      <button className={s.collapseToggle} onClick={() => setTypeStyleOpen(v => !v)}>
        {typeStyleOpen ? '▼' : '▶'} 유형별 기본 제작 스타일 (이 브라우저에 저장)
      </button>
      {typeStyleOpen && (
        <>
          <div className={s.emptyHint}>
            컷을 펼칠 때 유형별 기본 제작 방식·HTML 파일이 자동 선택되고, 자동 템플릿은 여기 스타일로 렌더됩니다.
          </div>
          <div className={s.styleGrid}>
            {STYLE_TYPES.map(t => {
              const cfg = typeStyles[t.key]
              const st = cfg.style
              const ov = cfg.overlay
              const setStyle = patch => updateTypeStyle(t.key, { style: patch })
              const setOv = patch => updateTypeStyle(t.key, { overlay: patch })
              return (
                <div key={t.key} className={s.styleCol}>
                  <span className={`${s.typeBadge} ${s['type' + t.key] || ''}`}>{t.key}</span>

                  {t.modes && (
                    <label className={s.styleField}>기본 제작 방식
                      <select value={cfg.mode} onChange={e => updateTypeStyle(t.key, { mode: e.target.value })}>
                        {t.modes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                  )}

                  {t.key === 'BROLL' && (
                    <label className={s.styleField}>자동실행 기본 검색어 (문맥 · 선택)
                      <input value={cfg.brollQuery || ''} placeholder="예: beauty salon, minimal studio"
                        onChange={e => updateTypeStyle('BROLL', { brollQuery: e.target.value })} />
                    </label>
                  )}

                  {t.hasTemplate && (
                    <>
                      <label className={s.styleField}>기본 HTML 파일
                        <input list="making-html-files" value={cfg.htmlFile} placeholder="(자동 템플릿)"
                          onChange={e => updateTypeStyle(t.key, { htmlFile: e.target.value.trim() })} />
                      </label>
                      <div className={s.styleRow}>
                        <label className={s.styleField}>배경
                          <input type="color" value={st.bg} onChange={e => setStyle({ bg: e.target.value })} />
                        </label>
                        <label className={s.styleField}>글자색
                          <input type="color" value={st.color} onChange={e => setStyle({ color: e.target.value })} />
                        </label>
                      </div>
                      <div className={s.styleRow}>
                        <label className={s.styleField}>크기(px)
                          <input type="number" min="20" max="200" value={st.fontSize}
                            onChange={e => setStyle({ fontSize: parseInt(e.target.value) || 80 })} />
                        </label>
                        <label className={s.styleField}>굵기
                          <select value={st.fontWeight} onChange={e => setStyle({ fontWeight: parseInt(e.target.value) })}>
                            <option value={400}>400</option><option value={700}>700</option><option value={900}>900</option>
                          </select>
                        </label>
                      </div>
                      <div className={s.styleRow}>
                        <label className={s.styleField}>가로 정렬
                          <select value={st.align} onChange={e => setStyle({ align: e.target.value })}>
                            <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
                          </select>
                        </label>
                        <label className={s.styleField}>세로 정렬
                          <select value={st.vAlign} onChange={e => setStyle({ vAlign: e.target.value })}>
                            <option value="top">위</option><option value="center">가운데</option><option value="bottom">아래</option>
                          </select>
                        </label>
                      </div>
                      <label className={s.styleField}>기본 모션 (정지 그래픽에 자동 적용)
                        <select value={st.motion || 'none'} onChange={e => setStyle({ motion: e.target.value })}>
                          {GRAPHIC_MOTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <div className={s.stylePreviewBox}>
                        <iframe title={`style-preview-${t.key}`} className={s.stylePreviewFrame}
                          srcDoc={buildGraphicHtml(st, '서여리\nMAKING')} />
                      </div>
                      <button className={s.previewBtn}
                        onClick={() => updateTypeStyle(t.key, { style: { ...DEFAULT_GRAPHIC_STYLE } })}>
                        스타일 기본값으로
                      </button>
                    </>
                  )}

                  {t.hasOverlay && (
                    <>
                      <div className={s.settingLabel} style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        손글씨 오버레이
                      </div>
                      <label className={s.radioLabel}>
                        <input type="checkbox" checked={ov.enabled} onChange={e => setOv({ enabled: e.target.checked })} />
                        사용 (대본 CP 있는 컷에 제작 실행 시 자동)
                      </label>
                      {ov.enabled && (
                        <>
                          <div className={s.styleRow}>
                            <label className={s.styleField}>위치
                              <select value={ov.position} onChange={e => setOv({ position: e.target.value })}>
                                {OVERLAY_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                            </label>
                            <label className={s.styleField}>말풍선
                              <select value={ov.bubble} onChange={e => setOv({ bubble: e.target.value })}>
                                {OVERLAY_BUBBLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </label>
                          </div>
                          <div className={s.styleRow}>
                            <label className={s.styleField}>색상
                              <select value={ov.color} onChange={e => setOv({ color: e.target.value })}>
                                {OVERLAY_COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </label>
                            <label className={s.styleField}>표시 구간
                              <select value={ov.timing} onChange={e => setOv({ timing: e.target.value })}>
                                {OVERLAY_TIMINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </label>
                          </div>
                          <label className={s.styleField}>데코 (쉼표 구분, 예: ✨,♡)
                            <input value={ov.deco} onChange={e => setOv({ deco: e.target.value })} />
                          </label>
                          <div className={s.radioRow}>
                            <label className={s.radioLabel}>
                              <input type="checkbox" checked={ov.arrow} onChange={e => setOv({ arrow: e.target.checked })} />
                              화살표
                            </label>
                            {ov.arrow && (
                              <label className={s.styleField}>방향
                                <select value={ov.arrow_direction} onChange={e => setOv({ arrow_direction: e.target.value })}>
                                  {OVERLAY_ARROW_DIRS.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                              </label>
                            )}
                            <label className={s.radioLabel}>
                              <input type="checkbox" checked={!!ov.underline} onChange={e => setOv({ underline: e.target.checked })} />
                              밑줄 (타이틀·말풍선 없음)
                            </label>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <datalist id="making-html-files">
            {episodeHtmlFiles.map(f => <option key={f} value={f} />)}
          </datalist>
        </>
      )}
    </div>
  )

  const makingUrl = episode?.number
    ? `${YEORI_SERVER}/downloads/making/ep${episode.number}/ep${episode.number}_making.mp4`
    : null
  const makingBgmUrl = episode?.number
    ? `${YEORI_SERVER}/downloads/making/ep${episode.number}/ep${episode.number}_making_bgm.mp4`
    : null

  const renderHwImageCard = () => (
    <div className={s.card}>
      <button className={s.collapseToggle} onClick={() => setHwOpen(v => !v)}>
        {hwOpen ? '▼' : '▶'} 이미지에 손글씨 (썸네일·스틸)
      </button>
      {hwOpen && (
        <>
          <div className={s.emptyHint}>
            서여리 얼굴 이미지 등 임의 이미지 위에 손글씨 주석을 얹습니다. 씬마다 별도 PNG로 저장됩니다
            (1080×1920, 서여리 시그니처 프레임 포함). downloads/making/hw_stills/ 에 생성.
          </div>
          <label className={s.styleField}>이미지 경로 (downloads/ 기준)
            <input list="hw-source-images" value={hwImgPath} placeholder="flow/character/yeori-closeup.jpg"
              onChange={e => setHwImgPath(e.target.value)} />
          </label>
          <datalist id="hw-source-images">
            {hwImgList.map(p => <option key={p} value={p} />)}
          </datalist>

          {hwScenes.map((sc, i) => (
            <div key={i} className={s.overlayScene}>
              <div className={s.overlaySceneHead}>
                씬 {i + 1}
                {hwScenes.length > 1 && (
                  <button className={s.linkBtn} onClick={() => setHwScenes(a => a.filter((_, j) => j !== i))}>제거</button>
                )}
              </div>
              <input className={s.urlInput} style={{ width: '100%' }} value={sc.text} placeholder="손글씨 텍스트 (줄바꿈 가능)"
                onChange={e => patchHwScene(i, { text: e.target.value })} />
              <div className={s.styleRow}>
                <label className={s.styleField}>위치
                  <select value={sc.position} onChange={e => patchHwScene(i, { position: e.target.value })}>
                    {OVERLAY_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className={s.styleField}>말풍선
                  <select value={sc.bubble} onChange={e => patchHwScene(i, { bubble: e.target.value })}>
                    {OVERLAY_BUBBLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className={s.styleField}>색상
                  <select value={sc.color} onChange={e => patchHwScene(i, { color: e.target.value })}>
                    {OVERLAY_COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <div className={s.styleRow}>
                <label className={s.styleField}>데코 (쉼표 구분)
                  <input value={sc.deco} onChange={e => patchHwScene(i, { deco: e.target.value })} />
                </label>
                <label className={s.styleField}>시간 (예: 0s~3s)
                  <input value={sc.time} onChange={e => patchHwScene(i, { time: e.target.value })} />
                </label>
              </div>
              <div className={s.radioRow}>
                <label className={s.radioLabel}>
                  <input type="checkbox" checked={sc.arrow} onChange={e => patchHwScene(i, { arrow: e.target.checked })} />
                  화살표
                </label>
                {sc.arrow && (
                  <label className={s.styleField}>방향
                    <select value={sc.arrow_direction} onChange={e => patchHwScene(i, { arrow_direction: e.target.value })}>
                      {OVERLAY_ARROW_DIRS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </label>
                )}
                <label className={s.radioLabel}>
                  <input type="checkbox" checked={!!sc.underline} onChange={e => patchHwScene(i, { underline: e.target.checked })} />
                  밑줄
                </label>
              </div>
            </div>
          ))}
          <div className={s.editorActions}>
            <button className={s.previewBtn} onClick={() => setHwScenes(a => [...a, newHwScene()])}>씬 추가 +</button>
            <button className={s.captureBtn} disabled={hwBusy || !hwImgPath.trim()} onClick={runHwImage}>
              {hwBusy ? '⏳ 합성 중…' : '손글씨 적용'}
            </button>
          </div>
          {hwResult && (
            hwResult.error ? (
              <div className={s.resultError}>❌ {hwResult.error}</div>
            ) : (
              <div className={s.resultOk}>
                ✅ {hwResult.count}개 씬 저장됨
                <div className={s.sourceGrid}>
                  {(hwResult.outputs || []).map((o, i) => (
                    <div key={i} className={s.sourceCard}>
                      <img src={`${YEORI_SERVER}${o.url}?t=${hwResult._ts || 0}`} alt={`scene ${i + 1}`} className={s.sourceThumb} />
                      <button className={s.pathCopy} onClick={() => copyPath(o.path)}>{o.path.split(/[/\\]/).pop()}</button>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  )

  const renderBgmCard = () => (
    <div className={s.card}>
      <button className={s.collapseToggle} onClick={() => setBgmOpen(v => !v)}>
        {bgmOpen ? '▼' : '▶'} BGM (배경음악) — TrendRadar 검색 · 메이킹 필름에 합성
      </button>
      {bgmOpen && (
        <>
          <div className={s.emptyHint}>
            TrendRadar “BGM 레이더”와 같은 Chosic 검색입니다. 다운로드한 트랙을 골라 조립된 메이킹 필름
            밑에 깔면 ep{episode?.number}_making_bgm.mp4가 만들어집니다(원본 보존). 덕킹 ON이면 대사·나레이션 구간에서 BGM이 자동으로 눌립니다.
          </div>

          <div className={s.urlRow}>
            <select value={bgmMood} onChange={e => setBgmMood(e.target.value)} className={s.stageSelect}>
              {BGM_MOODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className={s.urlInput} value={bgmKeyword} placeholder="키워드 (쉼표 구분, 선택)"
              onChange={e => setBgmKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchBgm()} />
            <button className={s.previewBtn} disabled={bgmSearching} onClick={searchBgm}>
              {bgmSearching ? '⏳' : '검색'}
            </button>
          </div>

          {bgmSearchResults.length > 0 && (
            <div className={s.cutList}>
              {bgmSearchResults.map((it, i) => (
                <div key={i} className={s.overlayScene}>
                  <div className={s.overlaySceneHead}>{it.title || `트랙 ${i + 1}`} · {it.artist || it.license || ''}</div>
                  {(it.previewUrl || it.mp3) && <audio controls src={it.previewUrl || it.mp3} style={{ width: '100%' }} />}
                  <button className={s.previewBtn}
                    disabled={bgmDownloading[it.id ?? it.title]}
                    onClick={() => downloadBgm(it)}>
                    {bgmDownloading[it.id ?? it.title] ? '⏳ 다운로드 중…' : '⬇ 라이브러리에 추가'}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={s.settingLabel}>다운로드된 BGM ({bgmLibrary.length})</div>
          {!bgmLibrary.length ? (
            <div className={s.emptyHint}>아직 없습니다. 위에서 검색해 라이브러리에 추가하세요.</div>
          ) : (
            <div className={s.cutList}>
              {bgmLibrary.map(t => (
                <div key={t.id} className={`${s.overlayScene} ${bgmPick === t.file ? s.sourceCardActive : ''}`}
                  onClick={() => setBgmPick(t.file)}>
                  <div className={s.overlaySceneHead}>
                    <input type="radio" readOnly checked={bgmPick === t.file} />
                    {t.title} · {t.mood}
                  </div>
                  <audio controls src={`${YEORI_SERVER}/downloads/${t.file}`} style={{ width: '100%' }} />
                </div>
              ))}
            </div>
          )}

          <div className={s.styleRow}>
            <label className={s.styleField}>BGM 볼륨 ({bgmVolume.toFixed(2)})
              <input type="range" min="0" max="0.6" step="0.02" value={bgmVolume}
                onChange={e => setBgmVolume(parseFloat(e.target.value))} />
            </label>
            <label className={s.radioLabel}>
              <input type="checkbox" checked={bgmDuck} onChange={e => setBgmDuck(e.target.checked)} />
              대사 구간 자동 덕킹
            </label>
          </div>

          <div className={s.editorActions}>
            <button className={s.captureBtn} disabled={bgmBusy || !bgmPick || !makingUrl} onClick={applyBgm}>
              {bgmBusy ? '⏳ 합성 중…' : 'BGM 적용'}
            </button>
            {!makingUrl && <span className={s.emptyHint}>먼저 전체 조립을 실행하세요.</span>}
            {!bgmPick && makingUrl && <span className={s.emptyHint}>적용할 BGM을 선택하세요.</span>}
          </div>

          {bgmResult && (
            bgmResult.error ? (
              <div className={s.resultError}>❌ {bgmResult.error}</div>
            ) : (
              <div className={s.resultOk}>
                ✅ 저장됨 — {bgmResult.outputPath} ({bgmResult.sizeKB}KB)
                <br />
                {makingBgmUrl && <video className={s.makingVideo} src={`${makingBgmUrl}?t=${bgmResult?._ts || 0}`} controls />}
              </div>
            )
          )}
        </>
      )}
    </div>
  )

  return (
    <div className={s.page}>
      <TabToolbar />
      <div className={s.root}>
        <EpisodeInfoSidebar maxStage={5} />
        <div className={s.main}>
          <div className={s.scrollBody}>
            <div className={s.content}>

              <div className={s.header}>
                <div>
                  <div className={s.title}>메이킹</div>
                  <div className={s.subtitle}>
                    에피소드의 전체 컷 목록입니다. 각 컷을 열어 타입에 맞는 방식으로 영상을 제작한 뒤,
                    맨 아래에서 메이킹 필름으로 조립합니다. YEORI 등 파이프라인 자동 처리 컷은 표시만 됩니다.
                  </div>
                </div>
              </div>

              {renderTypeStyleCard()}
              {renderAutoRunCard()}

              <div className={s.card}>
                <div className={s.cardTitle}>전체 컷 목록</div>
                {!allCuts.length ? (
                  <div className={s.emptyHint}>활성 에피소드에 컷이 없습니다.</div>
                ) : (
                  <div className={s.cutList}>
                    {allCuts.map(cut => {
                      const type = cut.cutType || 'YEORI'
                      const manual = MANUAL_TYPES.includes(type)
                      const expanded = expandedCutNo === cut.no
                      const done = !!videoStatus[cut.no]
                      return (
                        <div key={cut.id} className={`${s.cutRow} ${expanded ? s.cutRowActive : ''}`}>
                          <button
                            className={s.cutRowHead}
                            onClick={() => manual ? toggleCut(cut) : setExpandedCutNo(expanded ? null : cut.no)}>
                            <span className={s.cutNo}>#{cut.no}</span>
                            <span className={`${s.typeBadge} ${s['type' + type] || ''}`}>{type}</span>
                            <span className={s.cutSummary}>
                              {cut.narration || cut.dialogue || cut.scene || '(내용 없음)'}
                            </span>
                            {done && <span className={s.doneBadge}>완료 ✅</span>}
                            {manual && <span className={s.chevron}>{expanded ? '▲' : '▼'}</span>}
                          </button>

                          {expanded && manual && renderPanel(cut)}

                          {expanded && !manual && (
                            <div className={s.subPanel}>
                              <div className={s.autoNote}>
                                {type === 'YEORI'
                                  ? '(파이프라인 자동처리 — G2~G5에서 이미지·음성·영상이 생성됩니다)'
                                  : '(파이프라인 자동처리 컷)'}
                              </div>
                              {done && makingUrl && (
                                <video
                                  className={s.makingVideo}
                                  src={`${YEORI_SERVER}/downloads/video/ep${episode.number}/cut_${String(cut.no).padStart(2, '0')}.mp4`}
                                  controls
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className={s.card}>
                <div className={s.cardTitle}>메이킹 필름 조립 (G5-M)</div>
                <div className={s.emptyHint}>
                  위에서 확정한 BROLL/CAPCUT/GRAPHIC 컷 영상 + 기존 YEORI 컷 영상을 컷 번호 순서대로 이어붙입니다.
                </div>
                <div className={s.editorActions}>
                  <button className={s.captureBtn} disabled={assembling} onClick={assembleMaking}>
                    {assembling ? '⏳ 조립 중…' : '🎬 전체 조립 실행'}
                  </button>
                  <button className={s.previewBtn}
                    disabled={!makingUrl}
                    onClick={() => setMakingPreview(v => !v)}>
                    {makingPreview ? '미리보기 닫기' : '메이킹 미리보기'}
                  </button>
                </div>

                {makingPreview && makingUrl && (
                  <div className={s.previewWrap}>
                    <video className={s.makingVideo} src={makingUrl} controls autoPlay />
                  </div>
                )}

                {assembleResult && (
                  assembleResult.error ? (
                    <div className={s.resultError}>❌ {assembleResult.error}</div>
                  ) : (
                    <div className={s.resultOk}>
                      ✅ 조립 완료 — 포함 {assembleResult.includedCuts.length}컷(#{assembleResult.includedCuts.join(', #')})
                      {assembleResult.skippedCuts.length > 0 && <> · 스킵 {assembleResult.skippedCuts.length}컷(#{assembleResult.skippedCuts.join(', #')})</>}
                      {' '}· 총 {assembleResult.duration?.toFixed?.(1) ?? assembleResult.duration}초
                      <br />
                      <button className={s.pathCopy} onClick={() => copyPath(assembleResult.outputPath)}>
                        {assembleResult.outputPath} (클릭하여 경로 복사)
                      </button>
                    </div>
                  )
                )}
              </div>

              {renderBgmCard()}

              {renderHwImageCard()}

              <div className={s.card}>
                <button className={s.collapseToggle} onClick={() => setLegacySourceOpen(v => !v)}>
                  {legacySourceOpen ? '▼' : '▶'} 소스 검색 (직접 다운로드 · making/source/ 원본 저장)
                </button>

                {legacySourceOpen && (
                  <>
                    <div className={s.settingRow}>
                      <div className={s.settingGroup}>
                        <div className={s.settingLabel}>검색어</div>
                        <div className={s.urlRow}>
                          <input className={s.urlInput} value={sourceQuery} placeholder="예: slot machine lever"
                            onChange={e => setSourceQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && searchSources()} />
                          <button className={s.previewBtn} disabled={sourceSearching || !sourceQuery.trim()} onClick={searchSources}>
                            {sourceSearching ? '⏳' : '검색'}
                          </button>
                        </div>
                      </div>

                      <div className={s.settingGroup}>
                        <div className={s.settingLabel}>유형</div>
                        <div className={s.radioRow}>
                          {[['all', '전체'], ['video', '영상'], ['image', '이미지']].map(([v, l]) => (
                            <label key={v} className={s.radioLabel}>
                              <input type="radio" name="source-type" value={v}
                                checked={sourceType === v} onChange={() => setSourceType(v)} />
                              {l}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className={s.settingGroup}>
                        <div className={s.settingLabel}>방향</div>
                        <div className={s.radioRow}>
                          {[['portrait', '세로우선'], ['landscape', '가로'], ['all', '전체']].map(([v, l]) => (
                            <label key={v} className={s.radioLabel}>
                              <input type="radio" name="source-orientation" value={v}
                                checked={sourceOrientation === v} onChange={() => setSourceOrientation(v)} />
                              {l}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className={s.settingGroup}>
                        <div className={s.settingLabel}>대상 컷</div>
                        <select className={s.stageSelect} value={sourceTargetCutNo ?? ''}
                          onChange={e => setSourceTargetCutNo(e.target.value ? parseInt(e.target.value) : null)}>
                          <option value="">선택 안 함</option>
                          {allCuts.map(c => <option key={c.id} value={c.no}>#{c.no}</option>)}
                        </select>
                      </div>
                    </div>

                    {sourceError && <div className={s.resultError}>❌ {sourceError}</div>}

                    {sourceResults.length > 0 && (
                      <div className={s.sourceGrid}>
                        {sourceResults.map(item => {
                          const dl = sourceDownloaded[item.id]
                          const downloading = sourceDownloading[item.id]
                          return (
                            <div key={item.id} className={s.sourceCard}>
                              <img src={item.thumbnail} alt={item.title} className={s.sourceThumb} loading="lazy" />
                              <div className={s.sourceMeta}>
                                <span className={s.sourcePhotographer}>{item.photographer || '작자 미상'}</span>
                                {item.type === 'video' && <span className={s.sourceDuration}>{item.duration}초</span>}
                              </div>
                              <button className={s.previewBtn} disabled={downloading || sourceTargetCutNo == null}
                                onClick={() => downloadSource(item)}>
                                {downloading ? '⏳' : dl?.success ? '저장됨 ✅' : '다운로드'}
                              </button>
                              {dl?.error && <div className={s.resultError}>❌ {dl.error}</div>}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div className={s.pexelsCredit}>
                      Media provided by <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>
                    </div>
                  </>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
