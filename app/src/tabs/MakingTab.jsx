import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { resolveEpisodeCode } from '../lib/episodeCode'
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

const GRAPHIC_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1080px; height:1920px;
  background:#0a0a0a;
  display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  font-family:'Noto Sans KR', sans-serif;
  color:white;
}
.main-text {
  font-size:72px; font-weight:700;
  text-align:center; line-height:1.4;
  padding:0 80px;
}
.sub-text {
  font-size:42px; color:rgba(255,255,255,0.6);
  margin-top:40px; text-align:center;
  padding:0 80px;
}
</style>
</head>
<body>
<div class="main-text">{narration}</div>
<div class="sub-text">{scene}</div>
</body>
</html>`

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 대본의 "CP(자막)" 필드가 아직 scriptParserV3.js에서 별도 컷 필드로 파싱되지 않아서
// (2026-08-23 실측 확인 — 별도 개선 과제로 남김), CAPCUT 텍스트 컷의 실제 화면 문구를
// narration/dialogue만으론 못 찾는 경우가 있다. videoPrompt 안에 "따옴표로 감싼 문구"가
// 있으면(실제 대본 관례 — 예: `타이핑 애니메이션으로 텍스트 등장\n"AI한테 DM..."`) 그걸
// 우선 추출한다. 그래도 못 찾으면 비워두고 사람이 캡처 전에 직접 채우도록 한다(기존
// GRAPHIC 워크플로우와 동일 — 자동 채우기는 시작점일 뿐 항상 편집 가능).
function extractQuotedLine(text) {
  const m = String(text || '').match(/"([^"]+)"/)
  return m ? m[1] : ''
}

function fillTemplate(cut) {
  const mainText = extractQuotedLine(cut.videoPrompt) || cut.narration || cut.dialogue || ''
  return GRAPHIC_TEMPLATE
    .replace('{narration}', escapeHtml(mainText))
    .replace('{scene}', escapeHtml(cut.scene || ''))
}

// 이 탭에서 컷별 [제작 실행] 버튼이 붙는 타입. 그 외(YEORI/PIP 등)는 G2~G5 파이프라인이
// 자동 처리하므로 목록에는 나오되 액션 버튼 없이 "(파이프라인 자동처리)"만 표시한다.
const MANUAL_TYPES = ['GRAPHIC', 'BROLL', 'CAPCUT']

export default function MakingTab() {
  const { state } = useApp()
  const { episode, cuts } = state
  const episodeCode = resolveEpisodeCode(episode)
  const allCuts = [...(cuts || [])].sort((a, b) => a.no - b.no)

  // 컷별 cut_NN.mp4 제작완료 여부(파일 존재 기반, 별도 플래그 저장 없음) — 2초마다
  // 다시 불러와서 캡처/녹화 직후에도 뱃지가 자동으로 갱신되게 한다.
  const [videoStatus, setVideoStatus] = useState({})
  useEffect(() => {
    if (!episode?.number) return
    const load = () => {
      fetch(`${YEORI_SERVER}/api/episode-video-status?epNum=${episode.number}`)
        .then(r => r.json())
        .then(data => setVideoStatus(data.videoByCut || {}))
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [episode?.number])

  // ── 어느 컷을 펼쳐 놓았는지(한 번에 하나만). 펼치면서 타입에 맞는 기존 select 함수를
  // 호출해 htmlSource/selectedBrollCutNo/selectedCapcutCutNo 등 기존 상태를 그대로 채운다.
  const [expandedCutNo, setExpandedCutNo] = useState(null)
  const toggleCut = (cut) => {
    const willOpen = expandedCutNo !== cut.no
    setExpandedCutNo(willOpen ? cut.no : null)
    if (!willOpen) return
    if (cut.cutType === 'GRAPHIC') selectCut(cut)
    else if (cut.cutType === 'BROLL') selectBrollCut(cut)
    else if (cut.cutType === 'CAPCUT') {
      selectCapcutCut(cut)
      if (getCapcutMode(cut.no) === 'html') selectCapcutCutForHtml(cut)
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
    setHtmlSource(fillTemplate(cut))
    setPreviewHtml('')
    setCaptureResult(null)
    setDuration(cut.duration || 5)
  }

  // [제작 실행] — 서버(makeGraphicCutForMcp)가 처리한다. htmlFile 지정 시 그 목업에서
  // 이 컷만 isolate, 생략 시 서버 자동 템플릿(fillTemplateForMcp — 캡션/자막 섹션 추출
  // 등 클라이언트 fillTemplate보다 강력). MCP make_graphic_cut과 완전히 동일 경로.
  const captureGraphic = async ({ htmlFile } = {}) => {
    if (selectedCutNo == null || !episode.number) return
    setCapturing(true)
    setCaptureResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/make-graphic-cut`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum: episode.number, cutNo: selectedCutNo, ...(htmlFile ? { htmlFile } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) { setCaptureResult({ error: data.error || '제작 실패' }); return }
      setCaptureResult(data)
    } catch (e) {
      setCaptureResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setCapturing(false)
    }
  }

  // [편집본으로 캡처] — 아래 편집기에서 직접 손본 HTML을 그대로 캡처(자동 템플릿
  // 미세조정용). 서버가 .phone-wrap 다중 컷이면 이 컷만 isolate 처리한다.
  const captureEditedHtml = async () => {
    if (selectedCutNo == null || !episode.number) return
    setCapturing(true)
    setCaptureResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/graphic-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlSource, cutNo: selectedCutNo, epNum: episode.number, duration }),
      })
      const data = await res.json()
      if (!res.ok) { setCaptureResult({ error: data.error || '캡처 실패' }); return }
      setCaptureResult(data)
    } catch (e) {
      setCaptureResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setCapturing(false)
    }
  }

  // ── BROLL: 소스 = "Pexels 검색"(다운로드→FFmpeg 규격화) 또는 "화면 녹화" ─────────
  const [brollSourceMode, setBrollSourceMode] = useState({}) // { [cutNo]: 'pexels' | 'record' }, 기본 'pexels'
  const getBrollSourceMode = (n) => brollSourceMode[n] || 'pexels'

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
    setBrollTargetDuration(cut.duration || 5)
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
          duration: brollTargetDuration || cut.duration || undefined,
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
  const [capcutMode, setCapcutMode] = useState({}) // { [cutNo]: 'html' | 'record' }, 기본 'html'
  const getCapcutMode = (cutNo) => capcutMode[cutNo] || 'html'

  const [selectedCapcutCutNo, setSelectedCapcutCutNo] = useState(null)
  const [capcutStatus, setCapcutStatus] = useState(null)
  const [capcutChecking, setCapcutChecking] = useState(false)
  const [capcutTargetDuration, setCapcutTargetDuration] = useState(5)
  const [capcutTrimMode, setCapcutTrimMode] = useState('end')
  const [capcutRecording, setCapcutRecording] = useState(false)
  const [capcutBusy, setCapcutBusy] = useState(false)
  const [capcutResult, setCapcutResult] = useState(null)

  // HTML 소스 후보 목록(에피소드 폴더에 이미 있는 .html 파일들) — CUT2/CUT3의
  // RL02_DM_mockup_v3.html 같은 커스텀 목업을 찾기 위함.
  const [episodeHtmlFiles, setEpisodeHtmlFiles] = useState([])
  const [htmlFilesLoading, setHtmlFilesLoading] = useState(false)
  const [selectedHtmlFile, setSelectedHtmlFile] = useState('__auto__')

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
      setEpisodeHtmlFiles(data.files || [])
    } catch {
      setEpisodeHtmlFiles([])
    } finally {
      setHtmlFilesLoading(false)
    }
  }

  const applyHtmlFileChoice = async (fileName, cut) => {
    setSelectedHtmlFile(fileName)
    if (fileName === '__auto__') {
      setHtmlSource(fillTemplate(cut))
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

  // CAPCUT 컷을 "HTML 캡처" 모드로 선택 — GRAPHIC과 동일한 selectCut()으로 htmlSource/
  // selectedCutNo를 그대로 채우고, 이 컷의 폴더에 있는 .html 후보 목록을 같이 불러온다.
  const selectCapcutCutForHtml = (cut) => {
    selectCut(cut)
    setSelectedHtmlFile('__auto__')
    fetchEpisodeHtmlFiles()
  }

  const selectCapcutCut = (cut) => {
    setSelectedCapcutCutNo(cut.no)
    setCapcutTargetDuration(cut.duration || 5)
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

  // ────────────────────────────────────────────────────────────────────────
  // 인라인 패널 렌더러 (컷 타입별)
  // ────────────────────────────────────────────────────────────────────────
  const renderGraphicPanel = () => (
    <div className={s.subPanel}>
      <div className={s.editorActions}>
        <label className={s.durationField}>
          길이(초)
          <input type="number" min="1" value={duration}
            onChange={e => setDuration(parseInt(e.target.value) || 1)} />
        </label>
        <button className={s.captureBtn} disabled={capturing} onClick={() => captureGraphic()}>
          {capturing ? '⏳ 제작 중…' : '제작 실행'}
        </button>
      </div>
      <div className={s.settingLabel}>HTML 소스 (미세조정용)</div>
      <textarea
        className={s.htmlEditor}
        value={htmlSource}
        onChange={e => setHtmlSource(e.target.value)}
        spellCheck={false}
      />
      <div className={s.editorActions}>
        <button className={s.previewBtn} onClick={() => setPreviewHtml(htmlSource)}>미리보기</button>
        <button className={s.previewBtn} disabled={capturing} onClick={captureEditedHtml}>
          {capturing ? '⏳ 캡처 중…' : '편집본으로 캡처'}
        </button>
      </div>
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
    </div>
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
            <div className={s.settingRow}>
              <div className={s.settingGroup}>
                <div className={s.settingLabel}>URL(선택)</div>
                <div className={s.urlRow}>
                  <input className={s.urlInput} value={brollUrl} placeholder="https://..."
                    onChange={e => setBrollUrl(e.target.value)} />
                  <button className={s.previewBtn} disabled={!brollUrl}
                    onClick={() => window.open(brollUrl, '_blank', 'noopener,noreferrer')}>열기</button>
                </div>
              </div>

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
                selectCapcutCutForHtml(cut)
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
          <>
            <div className={s.settingGroup}>
              <div className={s.settingLabel}>HTML 소스 선택</div>
              <select value={selectedHtmlFile} disabled={htmlFilesLoading}
                onChange={e => applyHtmlFileChoice(e.target.value, cut)}>
                <option value="__auto__">자동 템플릿 (텍스트 채우기)</option>
                {episodeHtmlFiles.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <div className={s.emptyHint}>
                {htmlFilesLoading
                  ? 'HTML 파일 목록 불러오는 중…'
                  : selectedHtmlFile === '__auto__'
                    ? '제작 실행 시 서버 자동 템플릿으로 이 컷 문구를 채웁니다.'
                    : `제작 실행 시 ${selectedHtmlFile}에서 CUT ${cut.no} 부분만 잘라 캡처합니다.`}
              </div>
            </div>

            <div className={s.editorActions}>
              <label className={s.durationField}>
                길이(초)
                <input type="number" min="1" value={duration}
                  onChange={e => setDuration(parseInt(e.target.value) || 1)} />
              </label>
              <button className={s.captureBtn} disabled={capturing}
                onClick={() => captureGraphic({ htmlFile: selectedHtmlFile !== '__auto__' ? selectedHtmlFile : undefined })}>
                {capturing ? '⏳ 제작 중…' : '제작 실행'}
              </button>
            </div>

            <div className={s.settingLabel}>HTML 소스 (미세조정용)</div>
            <textarea
              className={s.htmlEditor}
              value={htmlSource}
              onChange={e => setHtmlSource(e.target.value)}
              spellCheck={false}
            />
            <div className={s.editorActions}>
              <button className={s.previewBtn} onClick={() => setPreviewHtml(htmlSource)}>미리보기</button>
              <button className={s.previewBtn} disabled={capturing} onClick={captureEditedHtml}>
                {capturing ? '⏳ 캡처 중…' : '편집본으로 캡처'}
              </button>
            </div>
            {previewHtml && (
              <div className={s.previewWrap}>
                <div className={s.previewBox}>
                  <iframe title="capcut-preview" srcDoc={previewHtml} className={s.previewFrame} />
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
          </>
        )}
      </div>
    )
  }

  const renderPanel = (cut) => {
    if (cut.cutType === 'GRAPHIC') return renderGraphicPanel()
    if (cut.cutType === 'BROLL') return renderBrollPanel(cut)
    if (cut.cutType === 'CAPCUT') return renderCapcutPanel(cut)
    return null
  }

  const makingUrl = episode?.number
    ? `${YEORI_SERVER}/downloads/making/ep${episode.number}/ep${episode.number}_making.mp4`
    : null

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
