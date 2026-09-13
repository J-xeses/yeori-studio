import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import JSZip from 'jszip'
import { setGPoint, setGPoints, loadGPoints } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { resolveVideoPolicy, VIDEO_MODES, contentRatio } from '../lib/videoPolicy'
import { epMediaUrl } from '../lib/mediaPaths'
import { EpisodeOverviewBlock, CutList } from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './VideoTab.module.css'

const FONTS = ['Apple SD Gothic Neo', 'Noto Sans KR', 'Nanum Gothic', 'Nanum Myeongjo', 'Gothic A1', 'Arial', 'Impact']
const BG_STYLES = ['반투명 직각 박스', '없음', '그림자']
const CLIP_MAX_SEC = 8

function estimateClipCount(targetSec) {
  if (!targetSec || targetSec <= 0) return 1
  return Math.ceil(targetSec / CLIP_MAX_SEC)
}

function secondsToSrt(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(Math.floor(ss)).padStart(2,'0')},000`
}

function stripMeta(text) {
  if (!text) return text
  return text
    .replace(/\n?샷\s*타입[:：][^\n]*/gi, '')
    .replace(/^(CLOSEUP|FULLBODY)\s*(SHOT)?\s*[-—]?\s*/i, '')
    .trim()
}

// 클립별(구간별) 타이밍 자막(2026-09-13) — subtitles[cutId]는 클립이 1개 이하인 컷은
// 지금처럼 문자열 하나, 클립이 여러 개인 컷은 [{start,end,text}] 배열. 구버전 문자열
// 데이터도 항상 세그먼트 배열로 통일해서 다루기 위한 헬퍼(체크업 탭에도 동일하게 복제).
function toSegments(value, fallbackText, totalDur) {
  if (Array.isArray(value)) return value
  const text = value ?? fallbackText ?? ''
  return text ? [{ start: 0, end: totalDur, text }] : []
}

// 클립 배열의 누적 시작/끝 시각 — clipTrimItem의 usedSec 계산과 같은 기준(전체사용 여부에
// 따라 duration 또는 trimEnd-trimStart)을 그대로 써서 자막 타이밍과 항상 어긋나지 않게 함.
function clipTimings(clips) {
  let acc = 0
  return clips.map(clip => {
    const used = clip.useFullDuration ? clip.duration : (clip.trimEnd - clip.trimStart)
    const start = acc
    acc += (used || 0)
    return { start, end: acc }
  })
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxWidth && line) {
      if (ctx.measureText(word).width > maxWidth) {
        let charLine = line
        for (const ch of word) {
          const t2 = charLine + ch
          if (ctx.measureText(t2).width > maxWidth && charLine) {
            lines.push(charLine)
            charLine = ch
          } else {
            charLine = t2
          }
        }
        line = charLine
      } else {
        lines.push(line)
        line = word
      }
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function hexToRgba(hex, alpha) {
  const h = (hex || '#000000').replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// PL이 인스타그램 콘텐츠 코드(IG_FD/IG_RL/IG_PT/IG_ST)면 어느 downloads/insta/{content}/
// 하위로 라우팅할지 반환. StudioTab.jsx에 있는 것과 동일 로직(이 코드베이스의 기존 관례대로
// 작은 순수함수라 탭마다 그대로 복제해서 씀).
function pipelineCodeToInstaContent(plCode) {
  const map = { IG_FD: 'FD', IG_RL: 'RL', IG_PT: 'PT', IG_ST: 'ST' }
  return map[(plCode || '').toUpperCase()] || null
}

// 컷마다 masterCode.pl이 없는 경우를 위한 폴백 — episode.contentType 기준 유추.
function episodeContentTypeToInsta(contentType) {
  const map = { IG_R: 'RL', IG_F: 'FD', IG_P: 'PT', IG_S: 'ST' }
  return map[(contentType || '').toUpperCase()] || null
}

// ScriptGenTab.jsx의 getRunFlags()에서 run_g4:false인 타입(GRAPHIC/CAPCUT)과 반드시 동일하게
// 유지할 것 — 이 두 타입은 CapCut/HTML 캡처로 메이킹 탭에서 직접 제작하는 컷이라 Flow+Veo3
// 영상 생성 대상이 애초에 아니다. 이걸 안 가려내면 "전체 AI 생성"/"G4 전체"가 이 컷들까지
// 건드려서 "G2 이미지가 없습니다" 오류를 내거나 의미 없는 g4:true를 찍어버린다.
function needsFlowVideo(cutType) {
  return !['GRAPHIC', 'CAPCUT'].includes(cutType || 'YEORI')
}

export default function VideoTab() {
  const { state, dispatch } = useApp()
  const { cuts, videoSettings, renderProgress, episode } = state
  // episode.code(3차 정식 필드) 우선, 레거시 에피소드는 과도기 방식(번호)으로 대체
  const episodeCode = resolveEpisodeCode(episode)
  const { subtitleEnabled, font, fontSize, color, bgStyle, boxColor } = videoSettings
  const canvasRef = useRef(null)
  const textareaRef = useRef(null)
  const [renderLog, setRenderLog] = useState([])

  // 하드코딩된 '9:16' 기본값이 아니라 에피소드 콘텐츠 유형 기준 실제 비율로 시작
  // (LF_YU 같은 16:9 유튜브 롱폼 에피소드에서도 항상 9:16으로 뜨던 문제, 2026-09-12 발견).
  const [aspectRatio, setAspectRatio] = useState(() => contentRatio(episode))
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const { videoClips = {}, g4Approved = {}, selectedCutId = null, subtitles = {} } = state.videoTabState || {}
  const [subtitleEditMode, setSubtitleEditMode] = useState(false)
  const [subtitlePosition, setSubtitlePosition] = useState('middle')
  const [selectedClipIdx, setSelectedClipIdx] = useState(0)
  const [videoGenStatus, setVideoGenStatus] = useState({})
  const [videoGenLog, setVideoGenLog] = useState({})
  const [ffmpegStatus, setFfmpegStatus] = useState({})
  const [ffmpegLog,    setFfmpegLog]    = useState({})
  const [composeStatus, setComposeStatus] = useState({})   // 클립 합성(render-cut-clips) 진행상태
  const [composeLog,    setComposeLog]    = useState({})
  const [batchFfmpegStatus,   setBatchFfmpegStatus]   = useState('idle') // idle | running | done | error
  const [batchFfmpegProgress, setBatchFfmpegProgress] = useState({ current: 0, total: 0 })
  const [batchFfmpegLog,      setBatchFfmpegLog]      = useState('')
  const [gData, setGData] = useState(() => loadGPoints())

  useEffect(() => {
    const id = setInterval(() => setGData(loadGPoints()), 2000)
    return () => clearInterval(id)
  }, [])

  // ── 영상 체크리스트 (수동 Veo 제작 대상 컷) ──────────────────────────
  const [vChk, setVChk] = useState(null)
  // VP 프롬프트 한 줄 생략(ellipsis) 미리보기 — 복붙하지 않고는 전체를 읽을 방법이 없어서
  // "프롬프트를 어디서 제대로 보나" 혼란이 있었음(2026-09-12). 클릭하면 그 컷만 전체 펼침.
  const [expandedVP, setExpandedVP] = useState({})
  const [vUpload, setVUpload] = useState({})   // { [cutNo]: { busy, keepAudio, result } }
  const loadVChk = useCallback(() => {
    const epNum = state.episode?.number
    if (epNum == null) { setVChk(null); return }
    fetch(`http://localhost:3001/api/episode-video-checklist?epNum=${epNum}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setVChk(d) })
      .catch(() => {})
  }, [state.episode?.number])
  useEffect(() => { loadVChk() }, [loadVChk])
  const setCutVideoMode = (cutNo, mode) => {
    const cut = (state.cuts || []).find(c => c.no === cutNo)
    if (cut?.id) dispatch({ type: 'UPDATE_CUT', id: cut.id, p: { videoMode: mode } })
    setTimeout(loadVChk, 100)
  }
  const uploadCutVideo = async (cutNo, file, keepAudio) => {
    const epNum = state.episode?.number
    if (!file || epNum == null) return
    const row = vChk?.cuts?.find(c => c.no === cutNo)
    const trimTo = row?.duration && row.duration > 0 ? `&trimTo=${row.duration}` : ''
    setVUpload(p => ({ ...p, [cutNo]: { ...p[cutNo], busy: true, result: null } }))
    try {
      const r = await fetch(
        `http://localhost:3001/api/upload-cut-video?epNum=${epNum}&cutNo=${cutNo}${trimTo}${keepAudio ? '&keepAudio=1' : ''}`,
        { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: file },
      )
      const d = await r.json()
      setVUpload(p => ({ ...p, [cutNo]: { busy: false, result: r.ok ? d : { error: d.error || '실패' } } }))
      if (r.ok) loadVChk()
    } catch (e) {
      setVUpload(p => ({ ...p, [cutNo]: { busy: false, result: { error: e.message } } }))
    }
  }

  const set = (p) => dispatch({ type: 'SET_VIDEO', p })
  const setVideoClips = (updater) => {
    const next = typeof updater === 'function' ? updater(videoClips) : updater
    dispatch({ type: 'SET_VIDEO_TAB_STATE', p: { videoClips: next } })
  }
  const setG4Approved = (updater) => {
    const next = typeof updater === 'function' ? updater(g4Approved) : updater
    dispatch({ type: 'SET_VIDEO_TAB_STATE', p: { g4Approved: next } })
  }
  const setSelectedCutId = (id) => {
    dispatch({ type: 'SET_VIDEO_TAB_STATE', p: { selectedCutId: id } })
  }
  const setSubtitles = (updater) => {
    const next = typeof updater === 'function' ? updater(subtitles) : updater
    dispatch({ type: 'SET_VIDEO_TAB_STATE', p: { subtitles: next } })
  }

  const selCutForText = cuts.find(c => c.id === selectedCutId)
  const clipsForText = selCutForText ? (videoClips[selCutForText.id] || []) : []
  const segsForText = selCutForText
    ? toSegments(subtitles[selCutForText.id], stripMeta(selCutForText.dialogue || selCutForText.narration || ''), selCutForText.duration || 0)
    : []
  // 클립이 여러 개인 컷은 메인 미리보기에 지금 떠 있는 클립(selectedClipIdx)의 자막을 보여줌
  // — 클립을 바꿔 고르면 재생 영상과 자막이 같이 전환된다.
  const previewText = clipsForText.length > 1 ? (segsForText[selectedClipIdx]?.text ?? '') : (segsForText[0]?.text ?? '')
  const setPreviewText = (text) => {
    if (!selCutForText) return
    if (clipsForText.length > 1) {
      const timings = clipTimings(clipsForText)
      setSubtitles(prev => {
        const cur = toSegments(prev[selCutForText.id], '', selCutForText.duration || 0)
        const next = clipsForText.map((_, i) => ({
          start: timings[i].start, end: timings[i].end,
          text: i === selectedClipIdx ? text : (cur[i]?.text ?? ''),
        }))
        return { ...prev, [selCutForText.id]: next }
      })
    } else {
      setSubtitles(prev => ({ ...prev, [selCutForText.id]: text }))
    }
  }

  useEffect(() => {
    if (cuts.length > 0 && !selectedCutId) {
      setSelectedCutId(cuts[0].id)
    }
  }, [cuts])

  useEffect(() => { setSelectedClipIdx(0) }, [selectedCutId])

  // 화면비율은 컷/클립이 아니라 에피소드 콘텐츠 유형이 정하는 값이다(videoPolicy.js:
  // "LF/SF = 유튜브 가로(16:9), 나머지 = 세로(9:16)"). 예전엔 컷에 올라온 클립의 실제
  // 감지된 비율로 미리보기를 덮어썼는데, LF/SF 에피소드에 잘못된 비율의 클립이 올라오면
  // (감지 오류 또는 잘못된 파일 업로드) 미리보기가 그 컷을 볼 때마다 "쇼폼으로 고정"된
  // 것처럼 계속 잘못 표시되는 버그가 있었다(2026-09-13, 사용자 지적 — LF 작업라인인데
  // 컷을 옮겨다녀도 9:16에 갇혀 있었음). 컷을 바꿀 때마다 항상 에피소드 기준 비율로
  // 돌아가고, 클립 하나하나의 비율 불일치는 아래 클립 리스트의 뱃지(clipRatioBadge)로만
  // 경고한다 — 미리보기 자체를 잘못된 클립이 뒤흔들지 않게.
  useEffect(() => {
    setAspectRatio(contentRatio(episode))
  }, [selectedCutId, episode])

  const allG4Done = cuts.length > 0 && cuts.every(c => !needsFlowVideo(c.cutType) || g4Approved[c.id])

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    if (!subtitleEnabled) return
    const text = previewText
    const scale = H / 720
    const fSize = Math.max(10, Math.round(fontSize * scale))
    const padX = 18, padY = 10, lineGap = 1.3

    ctx.font = `${fSize}px "${font}",sans-serif`
    ctx.textAlign = 'center'

    const maxTextWidth = W * 0.86
    const lines = wrapCanvasText(ctx, text, maxTextWidth)
    const lineHeight = fSize * lineGap
    const totalTextHeight = lineHeight * lines.length

    const subX = W / 2
    const anchorY = subtitlePosition === 'top' ? H * 0.72
                 : subtitlePosition === 'middle' ? H * 0.82
                 : H * 0.90

    const boxBottom = anchorY
    let boxTop = boxBottom - totalTextHeight - padY * 2
    const boxHeight = totalTextHeight + padY * 2

    boxTop = Math.max(boxTop, 8)

    if (bgStyle === '반투명 직각 박스') {
      let maxLineWidth = 0
      lines.forEach(l => { maxLineWidth = Math.max(maxLineWidth, ctx.measureText(l).width) })
      const bw = maxLineWidth + padX * 2
      ctx.fillStyle = hexToRgba(boxColor || '#000000', 0.68)
      ctx.fillRect(subX - bw / 2, boxTop, bw, boxHeight)
    } else if (bgStyle === '그림자') {
      ctx.shadowColor = 'rgba(0,0,0,0.95)'
      ctx.shadowBlur = Math.max(4, Math.round(fSize * 0.28))
      ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1
    }

    ctx.fillStyle = color
    lines.forEach((l, i) => {
      const lineY = boxTop + padY + lineHeight * (i + 1) - (lineHeight - fSize) / 2
      ctx.fillText(l, subX, lineY)
    })
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
  }, [subtitleEnabled, font, fontSize, color, bgStyle, boxColor, previewText, subtitlePosition, selectedCutId, subtitles])

  useEffect(() => { drawPreview() }, [drawPreview, subtitleEditMode])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [previewText, subtitleEditMode, selectedCutId])

  const exportSRT = () => {
    let srt = '', t = 0
    cuts.forEach((c, i) => {
      const text = stripMeta(c.dialogue || c.narration); if (!text) return
      const dur = c.duration || 5
      srt += `${i + 1}\n${secondsToSrt(t)} --> ${secondsToSrt(t + dur)}\n${text}\n\n`
      t += dur
    })
    if (!srt) { alert('대사/나레이션이 없습니다'); return }
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'subtitles.srt'; a.click()
    URL.revokeObjectURL(url)
    setRenderLog(l => [...l, '✅ SRT 자막 파일 생성 완료'])
    cuts.forEach(c => { if (c.dialogue || c.narration) setGPoint(episodeCode, c.no, 'g3', true) })
  }

  const exportZip = async () => {
    dispatch({ type: 'SET_RENDER', p: { isRendering: true, current: 0, total: cuts.length } })
    setRenderLog(l => [...l, '📦 ZIP 패키징 시작...'])
    const zip = new JSZip()
    let srt = '', t = 0
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i]
      dispatch({ type: 'SET_RENDER', p: { current: i + 1 } })
      const text = stripMeta(c.dialogue || c.narration || ''); const dur = c.duration || 5
      if (text) { srt += `${i+1}\n${secondsToSrt(t)} --> ${secondsToSrt(t+dur)}\n${text}\n\n`; t += dur }
      const info = `씬: ${c.scene || ''}\n액션: ${c.action || ''}\n대사: ${c.dialogue || ''}\n나레이션: ${c.narration || ''}\n이미지 프롬프트: ${c.imagePrompt || ''}`
      zip.file(`cut_${c.no}/info.txt`, info)
      setRenderLog(l => [...l, `  CUT ${c.no} 처리됨`])
      setGPoint(episodeCode, c.no, 'g3', true)
    }
    if (srt) zip.file('subtitles.srt', srt)
    const readme = `여리 Script Studio - 영상 패키지\n생성일: ${new Date().toLocaleString('ko-KR')}\n\n포함 파일:\n- cut_*/info.txt: 각 컷 정보\n- subtitles.srt: SRT 자막 파일\n\n이미지, 음성은 각 탭에서 별도 다운로드하세요.`
    zip.file('README.txt', readme)
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'yeori_studio_package.zip'; a.click()
    URL.revokeObjectURL(url)
    setRenderLog(l => [...l, '✅ ZIP 패키지 다운로드 완료!'])
    dispatch({ type: 'SET_RENDER', p: { isRendering: false } })
  }

  const exportFCPXML = () => {
    let t = 0
    const clips = cuts.map(c => {
      const dur = c.duration || 5
      const clip = `    <clip name="CUT ${c.no}" offset="${t}s" duration="${dur}s">\n      <title>${c.scene || 'Scene'}</title>\n    </clip>`
      t += dur; return clip
    }).join('\n')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9">\n  <library>\n    <event name="여리 Studio">\n      <project name="Ep ${episode?.number ?? ''}">\n        <sequence duration="${t}s">\n          <spine>\n${clips}\n          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>`
    const blob = new Blob([xml], { type: 'text/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'timeline.fcpxml'; a.click()
    URL.revokeObjectURL(url)
    setRenderLog(l => [...l, '✅ Premiere Pro FCPXML 생성 완료'])
  }

  const loadFromProxy = async (cut) => {
    const ep = episode?.number ?? ''
    const padded = String(cut.no).padStart(2, '0')
    for (const ext of ['mp4', 'mov', 'webm']) {
      const url = `${epMediaUrl(episode, 'video')}/cut_${padded}.${ext}?t=${Date.now()}`
      try {
        const r = await fetch(url, { method: 'HEAD' })
        if (r.ok) {
          const name = `cut_${padded}.${ext}`
          const vid = document.createElement('video')
          vid.preload = 'metadata'
          vid.onloadedmetadata = () => {
            const dur = Math.round(vid.duration * 100) / 100
            const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
            // 프록시로 불러온 클립은 이미 서버 실파일이라 재업로드 없이 stagedPath를 바로 채움
            // (2026-09-13 — "클립 합성"이 이 경로를 그대로 입력으로 씀).
            const stagedPath = vChk?.videoDir ? `${vChk.videoDir}\\${name}` : undefined
            const obj = { url, name, duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true, ratio, stagedPath, keepAudio: !!cut.dialogue }
            setVideoClips(p => {
              const existing = p[cut.id] || []
              if (existing.some(c => c.url === url)) return p
              return { ...p, [cut.id]: [...existing, obj] }
            })
          }
          vid.src = url
          return
        }
      } catch {}
    }
    alert(`CUT ${cut.no} 영상 파일이 프록시에 없습니다.\n경로: C:\\yeori-studio\\downloads\\video\\ep${ep}\\cut_${padded}.mp4`)
  }

  const loadAllFromProxy = async () => {
    for (const cut of cuts) await loadFromProxy(cut)
  }

  // 스튜디오 탭의 "폴더에서 일괄 가져오기"(이미지, normalizeCutImages)와 동일한 패턴을
  // 영상에도 만들어달라는 요청(2026-09-13) — 05_video/ 폴더에 느슨한 이름으로 던져둔 영상을
  // cut_NN_x.mp4로 일괄 리네임 + 컷별 후보 목록을 스캔해온다. 후보는 이미 서버 파일이라
  // stagedPath가 바로 채워짐(재업로드 불필요, "프록시"와 같은 성격).
  const [videoCandidates, setVideoCandidates] = useState({})   // { [cutNo]: [{name,url,path,slot}] }
  const loadVideoCandidates = useCallback(() => {
    const epNum = state.episode?.number
    if (epNum == null) return
    fetch(`http://localhost:3001/api/scan-cut-videos?epNum=${epNum}`)
      .then(r => r.json())
      .then(d => {
        const byCut = {}
        for (const c of d.clips || []) (byCut[c.cutNo] ??= []).push(c)
        setVideoCandidates(byCut)
      })
      .catch(() => {})
  }, [state.episode?.number])
  useEffect(() => { loadVideoCandidates() }, [loadVideoCandidates])

  const importVideosFromFolder = async () => {
    const epNum = state.episode?.number
    if (epNum == null) return
    try {
      const r = await fetch('http://localhost:3001/api/import-cut-videos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep: epNum }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '가져오기 실패')
      const msg = [
        `📁 영상 파일명 정리: ${d.renamed?.length || 0}개`,
        ...(d.renamed || []).map(x => `  ${x.from} → ${x.to}`),
        ...(d.skipped?.length ? ['', `⚠️ 스킵 ${d.skipped.length}개(파일명에서 컷번호 못 찾음):`, ...d.skipped.map(x => `  ${x.file}`)] : []),
      ].join('\n')
      if ((d.renamed?.length || 0) + (d.skipped?.length || 0) > 0) alert(msg)
      loadVideoCandidates()
    } catch (e) {
      alert('영상 폴더 가져오기 실패: ' + e.message)
    }
  }

  // 스캔된 후보 클립을 그 컷의 videoClips에 추가 — 이미 서버 파일이라 stagedPath를 바로 채움.
  const addCandidateClip = (cutId, cutNo, candidate) => {
    const url = `http://localhost:3001${candidate.url}?t=${Date.now()}`
    const cut = (state.cuts || []).find(c => c.id === cutId)
    const vid = document.createElement('video')
    vid.preload = 'metadata'
    vid.onloadedmetadata = () => {
      const dur = Math.round(vid.duration * 100) / 100
      const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
      const obj = {
        url, name: candidate.name, duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true,
        ratio, stagedPath: candidate.path, keepAudio: !!cut?.dialogue,
      }
      setVideoClips(p => {
        const existing = p[cutId] || []
        if (existing.some(c => c.stagedPath === candidate.path)) return p
        return { ...p, [cutId]: [...existing, obj] }
      })
    }
    vid.src = url
  }

  // 로컬 업로드한 클립을 실제 서버 파일로도 스테이징(2026-09-13) — 예전엔 blob: URL만 만들고
  // 서버엔 아무것도 안 남겨서 "클립 합성"이 실제 출력을 못 만들었다. 클립을 blob URL로 식별해서
  // 스테이징 완료 시 그 클립에만 stagedPath를 채워넣는다(다른 클립 추가/삭제와 섞여도 안전).
  const stageClip = async (cutId, cutNo, idx, file, matchUrl) => {
    const epNum = state.episode?.number
    if (epNum == null) return
    try {
      const r = await fetch(`http://localhost:3001/api/stage-cut-clip?epNum=${epNum}&cutNo=${cutNo}&idx=${idx}`,
        { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: file })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '스테이징 실패')
      setVideoClips(p => {
        const arr = [...(p[cutId] || [])]
        const i = arr.findIndex(c => c.url === matchUrl)
        if (i >= 0) arr[i] = { ...arr[i], stagedPath: d.path, staging: false }
        return { ...p, [cutId]: arr }
      })
    } catch (e) {
      setVideoClips(p => {
        const arr = [...(p[cutId] || [])]
        const i = arr.findIndex(c => c.url === matchUrl)
        if (i >= 0) arr[i] = { ...arr[i], staging: false, stageError: e.message }
        return { ...p, [cutId]: arr }
      })
    }
  }

  const handleVideoUpload = (cutId, files) => {
    const cut = (state.cuts || []).find(c => c.id === cutId)
    Array.from(files).forEach((f) => {
      const url = URL.createObjectURL(f)
      const vid = document.createElement('video')
      vid.preload = 'metadata'
      vid.onloadedmetadata = () => {
        const dur = Math.round(vid.duration * 100) / 100
        const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
        const obj = { url, name: f.name, duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true, ratio, staging: true, keepAudio: !!cut?.dialogue }
        let clipIdx = -1
        setVideoClips(p => {
          const existing = p[cutId] || []
          clipIdx = existing.length
          return { ...p, [cutId]: [...existing, obj] }
        })
        if (cut) stageClip(cutId, cut.no, clipIdx, f, url)
      }
      vid.src = url
    })
  }

  const removeClip = (cutId, idx) => {
    setVideoClips(p => {
      const arr = [...(p[cutId] || [])]
      arr.splice(idx, 1)
      return { ...p, [cutId]: arr }
    })
  }

  const updateClipTrim = (cutId, idx, patch) => {
    setVideoClips(p => {
      const arr = [...(p[cutId] || [])]
      arr[idx] = { ...arr[idx], ...patch }
      return { ...p, [cutId]: arr }
    })
  }

  const ensureStandardImage = async (cut) => {
    const ep = episode?.number ?? ''
    // 인스타 콘텐츠 에피소드는 G2 승인 이미지가 downloads/flow/ep{N}/이 아니라
    // downloads/insta/{content}/{num}/에 있다(StudioTab.jsx의 스캔 요청과 동일 규칙) —
    // 안 보내면 CUT4처럼 실제 이미지가 있어도 "G2 이미지가 없습니다" 오류가 난다
    // (2026-08-23 실측: /api/scan-images가 ep{N} 폴더만 봐서 IG_R02 CUT4를 못 찾던 버그).
    const instaContent = cuts.map(c => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean)
      || episodeContentTypeToInsta(episode?.contentType)
    const instaNum = instaContent ? (episode?.instaNum?.trim() || '') : ''
    const qs = new URLSearchParams({ ep, instaContent: instaContent || '', instaNum, episodeCode })
    const scanRes = await fetch(`http://localhost:3001/api/scan-images?${qs}`)
    const data = await scanRes.json()
    const match = data.images?.find(img => img.cutNo === cut.no)
    if (!match) throw new Error(`CUT ${cut.no}의 G2 이미지가 없습니다. 스튜디오 탭에서 먼저 이미지를 생성/승인하세요.`)
    const confirmRes = await fetch('http://localhost:3001/api/confirm-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // instaContent/instaNum을 같이 보내면, G2 이미지를 실제로 만든 Flow 프로젝트(project_url.txt)를
      // G4가 보는 표준 위치(downloads/flow/ep{N}/)에도 맞춰준다 — 안 그러면 G4가 레퍼런스
      // 이미지도 없는 무관한 예전 프로젝트로 연결될 수 있다(2026-08-23 실측).
      body: JSON.stringify({ ep, cutNo: cut.no, imageUrl: match.url, instaContent, instaNum }),
    })
    if (!confirmRes.ok) {
      const err = await confirmRes.json().catch(() => ({}))
      throw new Error(err.error || '이미지 표준화 저장 실패')
    }
  }

  const generateVideoForCut = async (cut) => {
    setVideoGenStatus(p => ({ ...p, [cut.id]: 'running' }))
    setVideoGenLog(p => ({ ...p, [cut.id]: '이미지 확인 중…' }))
    try {
      await ensureStandardImage(cut)
      setVideoGenLog(p => ({ ...p, [cut.id]: 'Flow 영상 생성 요청 중…' }))
      const ep = episode?.number ?? ''
      const prompts = {
        episode: ep,
        cuts: [{ no: cut.no, imagePrompt: cut.imagePrompt || '', duration: cut.duration || 8 }],
      }
      const res = await fetch('http://localhost:3001/api/run-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep, ratio: aspectRatio, prompts }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'progress' || ev.type === 'saved') {
              setVideoGenLog(p => ({ ...p, [cut.id]: ev.message || `진행 중… (${ev.current ?? ''}/${ev.total ?? ''})` }))
            } else if (ev.type === 'cut_video' && ev.cutNo === cut.no) {
              const url = `http://localhost:3001${ev.url}?t=${Date.now()}`
              const tempVideo = document.createElement('video')
              tempVideo.preload = 'metadata'
              tempVideo.src = url
              await new Promise(resolve => {
                tempVideo.onloadedmetadata = resolve
                tempVideo.onerror = resolve
              })
              const dur = isFinite(tempVideo.duration) ? Math.round(tempVideo.duration * 100) / 100 : (cut.duration || 8)
              const ratio = tempVideo.videoWidth && tempVideo.videoHeight
                ? (tempVideo.videoWidth >= tempVideo.videoHeight ? '16:9' : '9:16')
                : undefined
              setVideoClips(p => {
                const existing = Array.isArray(p[cut.id]) ? p[cut.id] : []
                if (existing.some(c => c.url === url)) return p
                return {
                  ...p,
                  [cut.id]: [...existing, {
                    url,
                    name: `AI 생성 (cut_${String(cut.no).padStart(2, '0')}.mp4)`,
                    duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true, ratio,
                  }],
                }
              })
              setVideoGenStatus(p => ({ ...p, [cut.id]: 'done' }))
              setVideoGenLog(p => ({ ...p, [cut.id]: '✅ 생성 완료' }))
            } else if (ev.type === 'cut_error' && ev.cutNo === cut.no) {
              setVideoGenStatus(p => ({ ...p, [cut.id]: 'error' }))
              setVideoGenLog(p => ({ ...p, [cut.id]: '❌ 생성 실패' }))
            } else if (ev.type === 'complete') {
              // cut_video/cut_error 이벤트로 이 컷의 상태가 이미 정해졌으면 그대로 둔다.
              // 문제는 success:true인데도 이 컷에 대한 cut_video가 한 번도 안 온 경우
              // (예: video-automation.js가 "이미 완료됨"으로 보고 아무것도 안 하고 끝난
              // 경우) — 이때 상태를 안 풀어주면 "생성 중…"에 영구히 멈춰서 버튼을 다시
              // 누를 수도 없게 된다(2026-08-23 실측으로 발견).
              setVideoGenStatus(p => {
                if (p[cut.id] !== 'running') return p
                return { ...p, [cut.id]: ev.success ? undefined : 'error' }
              })
              if (ev.success) {
                setVideoGenLog(p => ({ ...p, [cut.id]: '⚠️ 완료 신호는 왔지만 이 컷의 새 영상은 확인 안 됨 — 스캔 다시 불러오거나 재시도해주세요' }))
              }
            } else if (ev.type === 'error') {
              setVideoGenStatus(p => ({ ...p, [cut.id]: 'error' }))
              setVideoGenLog(p => ({ ...p, [cut.id]: `❌ ${ev.message}` }))
            }
          } catch {}
        }
      }
    } catch (err) {
      setVideoGenStatus(p => ({ ...p, [cut.id]: 'error' }))
      setVideoGenLog(p => ({ ...p, [cut.id]: `❌ ${err.message}` }))
    }
  }

  // 편집메타 탭에서 고른 효과음(cut.sfxFile, downloads/ 기준 상대경로)을 이 탭이
  // 항상 써온 절대경로 관례(C:\yeori-studio\downloads\...)로 변환.
  const sfxAbsolutePath = (cut) => cut?.sfxFile ? `C:\\yeori-studio\\downloads\\${cut.sfxFile.replace(/\//g, '\\')}` : undefined

  const runFfmpegForCut = async (cut) => {
    setFfmpegStatus(p => ({ ...p, [cut.id]: 'running' }))
    setFfmpegLog(p => ({ ...p, [cut.id]: '합성 시작…' }))
    try {
      const ep = episode?.number ?? ''
      const res = await fetch('http://localhost:3001/api/run-ffmpeg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ep, cutNo: cut.no, duration: cut.duration || 8,
          sfxFile: sfxAbsolutePath(cut), sfxStart: cut.sfxStart,
        }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'progress') {
              setFfmpegLog(p => ({ ...p, [cut.id]: ev.message }))
            } else if (ev.type === 'complete') {
              if (ev.success) {
                setFfmpegStatus(p => ({ ...p, [cut.id]: 'done' }))
                setFfmpegLog(p => ({ ...p, [cut.id]: `✅ ${ev.message}` }))
                const url = `http://localhost:3001${ev.url}?t=${Date.now()}`
                const tempVideo = document.createElement('video')
                tempVideo.preload = 'metadata'
                tempVideo.src = url
                await new Promise(resolve => {
                  tempVideo.onloadedmetadata = resolve
                  tempVideo.onerror = resolve
                })
                const ratio = tempVideo.videoWidth && tempVideo.videoHeight
                  ? (tempVideo.videoWidth >= tempVideo.videoHeight ? '16:9' : '9:16')
                  : undefined
                setVideoClips(p => ({
                  ...p,
                  [cut.id]: [...(p[cut.id] || []), {
                    url, name: `FFmpeg 합성 (cut_${String(cut.no).padStart(2,'00')}_final.mp4)`,
                    duration: cut.duration || 8, trimStart: 0, trimEnd: cut.duration || 8, useFullDuration: true, ratio,
                  }],
                }))
              } else {
                setFfmpegStatus(p => ({ ...p, [cut.id]: 'error' }))
                setFfmpegLog(p => ({ ...p, [cut.id]: `❌ ${ev.message}` }))
              }
            } else if (ev.type === 'error') {
              setFfmpegStatus(p => ({ ...p, [cut.id]: 'error' }))
              setFfmpegLog(p => ({ ...p, [cut.id]: `❌ ${ev.message}` }))
            }
          } catch {}
        }
      }
    } catch (err) {
      setFfmpegStatus(p => ({ ...p, [cut.id]: 'error' }))
      setFfmpegLog(p => ({ ...p, [cut.id]: `❌ ${err.message}` }))
    }
  }

  // 컷별 카드의 클립(videoClips)을 실제로 이어붙여 서버의 진짜 cut_NN.mp4를 만든다
  // (2026-09-13 — 로컬 클립 편집이 지금까지 미리보기용 blob: URL일 뿐이라 실제 출력에
  // 반영이 안 됐던 문제의 해결책). order 순서(배열 순서) 그대로 보냄, stagedPath 없는
  // 클립(아직 스테이징 중)이 있으면 막는다.
  const renderCutClips = async (cut) => {
    const clips = videoClips[cut.id] || []
    if (!clips.length) return
    const notReady = clips.some(c => !c.stagedPath)
    if (notReady) {
      setComposeLog(p => ({ ...p, [cut.id]: '⚠️ 아직 서버로 올라가는 중인 클립이 있습니다 — 잠시 후 다시 시도해주세요' }))
      return
    }
    setComposeStatus(p => ({ ...p, [cut.id]: 'running' }))
    setComposeLog(p => ({ ...p, [cut.id]: '클립 합성 중…' }))
    try {
      const epNum = state.episode?.number
      const r = await fetch('http://localhost:3001/api/render-cut-clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epNum, cutNo: cut.no,
          clips: clips.map(c => ({
            file: c.stagedPath, trimStart: c.trimStart, trimEnd: c.trimEnd,
            useFullDuration: c.useFullDuration, keepAudio: c.keepAudio,
          })),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '합성 실패')
      setComposeStatus(p => ({ ...p, [cut.id]: 'done' }))
      setComposeLog(p => ({ ...p, [cut.id]: `✅ 합성 완료 (${d.sizeKB}KB, ${d.duration?.toFixed(1)}s)` }))
      loadVChk()
    } catch (e) {
      setComposeStatus(p => ({ ...p, [cut.id]: 'error' }))
      setComposeLog(p => ({ ...p, [cut.id]: `❌ ${e.message}` }))
    }
  }

  const runFfmpegBatchAll = async () => {
    if (cuts.length === 0 || batchFfmpegStatus === 'running') return
    const ep = episode?.number ?? ''
    setBatchFfmpegStatus('running')
    setBatchFfmpegProgress({ current: 0, total: cuts.length })
    setBatchFfmpegLog('일괄 합성 시작…')
    cuts.forEach(c => {
      setFfmpegStatus(p => ({ ...p, [c.id]: 'running' }))
      setFfmpegLog(p => ({ ...p, [c.id]: '일괄 합성 대기 중…' }))
    })

    const meta = cuts.map(c => ({
      cutNo: c.no,
      label: `CUT ${String(c.no).padStart(2, '0')}`,
      duration: c.duration || 8,
      sfxOnly: c.sfxOnly || false,
      sfxFile: sfxAbsolutePath(c),
      sfxStart: c.sfxStart,
    }))

    try {
      const res = await fetch('http://localhost:3001/api/ffmpeg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum: ep, meta }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'progress') {
              setBatchFfmpegProgress({ current: ev.current, total: ev.total })
              setBatchFfmpegLog(`(${ev.current}/${ev.total}) ${ev.label} 합성 중…`)
            } else if (ev.type === 'cut_done') {
              const cut = cuts.find(c => String(c.no).padStart(2, '0') === ev.cutNo)
              if (cut) {
                const padded = String(cut.no).padStart(2, '0')
                const url = `${epMediaUrl(episode, 'video')}/output_final/C${padded}_final.mp4?t=${Date.now()}`
                setFfmpegStatus(p => ({ ...p, [cut.id]: 'done' }))
                setFfmpegLog(p => ({ ...p, [cut.id]: '✅ 일괄 합성 완료' }))
                setVideoClips(p => ({
                  ...p,
                  [cut.id]: [...(p[cut.id] || []), {
                    url, name: `FFmpeg 일괄 합성 (C${padded}_final.mp4)`,
                    duration: cut.duration || 8, trimStart: 0, trimEnd: cut.duration || 8, useFullDuration: true,
                  }],
                }))
              }
            } else if (ev.type === 'cut_error') {
              const cut = cuts.find(c => String(c.no).padStart(2, '0') === ev.cutNo)
              if (cut) {
                setFfmpegStatus(p => ({ ...p, [cut.id]: 'error' }))
                setFfmpegLog(p => ({ ...p, [cut.id]: '❌ 일괄 합성 실패' }))
              }
            } else if (ev.type === 'done') {
              const errCount = (ev.results || []).filter(r => r.status === 'error').length
              setBatchFfmpegStatus(errCount > 0 ? 'error' : 'done')
              setBatchFfmpegLog(errCount > 0 ? `⚠️ 완료 (${errCount}개 실패)` : `✅ 전체 ${ev.results?.length ?? cuts.length}개 합성 완료`)
            } else if (ev.type === 'error') {
              setBatchFfmpegStatus('error')
              setBatchFfmpegLog(`❌ ${ev.message}`)
            }
          } catch {}
        }
      }
    } catch (err) {
      setBatchFfmpegStatus('error')
      setBatchFfmpegLog(`❌ ${err.message}`)
    }
  }

  return (
    <div className={s.page}>
      <TabToolbar
        actions={[
          { key: 'srt', label: '📄 SRT', onClick: exportSRT },
          { key: 'load-all', label: '🔄 불러오기', onClick: loadAllFromProxy },
          { key: 'import-videos', label: '📁 폴더에서 일괄 가져오기', onClick: importVideosFromFolder },
          {
            key: 'ai-all',
            disabled: cuts.some(c => videoGenStatus[c.id] === 'running'),
            label: cuts.some(c => videoGenStatus[c.id] === 'running') ? '⏳ 생성 중…' : '✨ 전체 AI 생성',
            onClick: async () => {
              // CAPCUT/GRAPHIC 컷은 Flow+Veo3 생성 대상이 아니라(메이킹 탭에서 직접 제작)
              // G2 이미지 자체가 없다 — 그냥 돌리면 매번 "G2 이미지가 없습니다" 오류만 남기고
              // 아무 의미 없이 실패 처리됨(2026-08-23 실측). 애초에 대상에서 제외한다.
              for (const c of cuts.filter(c => needsFlowVideo(c.cutType))) {
                if (videoGenStatus[c.id] === 'running') continue
                await generateVideoForCut(c)
              }
            },
          },
          {
            key: 'g4-all', done: allG4Done,
            label: allG4Done ? '전체 취소' : 'G4 전체',
            onClick: () => {
              const next = !allG4Done
              // 마찬가지로 이미지 자체가 없는 CAPCUT/GRAPHIC 컷엔 의미 없는 g4 플래그를
              // 찍지 않는다.
              cuts.filter(c => needsFlowVideo(c.cutType)).forEach(c => {
                setG4Approved(p => ({ ...p, [c.id]: next }))
                setGPoint(episodeCode, c.no, 'g4', next)
              })
            },
          },
          {
            key: 'ffmpeg-batch', done: batchFfmpegStatus === 'done',
            disabled: cuts.length === 0 || batchFfmpegStatus === 'running',
            label: batchFfmpegStatus === 'running'
              ? `⏳ 합성 중… (${batchFfmpegProgress.current}/${batchFfmpegProgress.total})`
              : '🎬 전체 일괄 합성',
            onClick: runFfmpegBatchAll,
          },
        ]}
      />
    <div className={s.root}>
      {/* Sidebar */}
      <div className={s.sidebar}>
        <EpisodeOverviewBlock />
        <div className={s.sidePanel}>
          <div className={s.sidePanelHeader} onClick={() => setSubtitleOpen(p => !p)}>
            자막 디자인 설정 {subtitleOpen ? '▲' : '▼'}
          </div>
          {subtitleOpen && (
            <div className={s.sidePanelBody}>
              <div className={s.row}>
                <label className={s.check}>
                  <input type="checkbox" checked={subtitleEnabled} onChange={e => set({ subtitleEnabled: e.target.checked })} />
                  <span>자막 포함</span>
                </label>
              </div>
              <div className={s.sidePanelRow2}>
                <div className={s.field}>
                  <label>글씨체</label>
                  <select value={font} onChange={e => set({ font: e.target.value })} disabled={!subtitleEnabled}>
                    {FONTS.map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
                <div className={s.field}>
                  <label>배경 스타일</label>
                  <select value={bgStyle} onChange={e => set({ bgStyle: e.target.value })} disabled={!subtitleEnabled}>
                    {BG_STYLES.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
              </div>
              <div className={s.field}>
                <label>글자 크기 <span className={s.val}>{fontSize}px</span></label>
                <input type="range" min="16" max="72" value={fontSize} disabled={!subtitleEnabled}
                  onChange={e => set({ fontSize: parseInt(e.target.value) })} />
              </div>
              <div className={s.sidePanelRow2}>
                <div className={s.field}>
                  <label>글자 색상</label>
                  <div className={s.colorRow}>
                    <input type="color" value={color} disabled={!subtitleEnabled}
                      onChange={e => set({ color: e.target.value })} className={s.colorPicker} />
                    <span className={s.colorVal}>{color}</span>
                  </div>
                </div>
                {bgStyle === '반투명 직각 박스' && (
                  <div className={s.field}>
                    <label>박스 색상</label>
                    <div className={s.colorRow}>
                      <input type="color" value={boxColor || '#000000'}
                        disabled={!subtitleEnabled}
                        onChange={e => set({ boxColor: e.target.value })}
                        className={s.colorPicker} />
                      <span className={s.colorVal}>{boxColor || '#000000'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {batchFfmpegLog && <div className={s.ffmpegLog}>{batchFfmpegLog}</div>}

        <div className={s.g4Count}>G4 완료: {Object.values(g4Approved).filter(Boolean).length} / {cuts.length}</div>

        <div className={s.cutSideList}>
          <div className={s.cutSideListHeader}>컷 목록</div>
          <CutList
            cuts={cuts} gData={gData} episodeCode={episodeCode} maxStage={4}
            activeCutId={selectedCutId}
            onCutClick={c => setSelectedCutId(c.id)}
            renderPreview={c => {
              const clips = videoClips[c.id] || []
              return clips[0]
                ? <video src={clips[0]?.url} className={s.cutSideThumb} muted />
                : <div className={s.cutSideThumbEmpty}>🎬</div>
            }}
            previewText={c => {
              const clips = videoClips[c.id] || []
              const estCount = estimateClipCount(c.duration || 5)
              const statusText = clips.length > 0
                ? `영상 ${clips.length}개`
                : (estCount > 1 ? `영상 없음 · 예상 ${estCount}개 필요` : '영상 없음')
              return statusText + (g4Approved[c.id] ? ' · ✅' : '')
            }}
            renderExtra={c => (
              <>
                {videoGenStatus[c.id] === 'running' && <span className={s.sideGenBadge}>⏳생성중</span>}
                {videoGenStatus[c.id] === 'done' && <span className={s.sideGenBadgeDone}>✅완료</span>}
                {videoGenStatus[c.id] === 'error' && <span className={s.sideGenBadgeError}>❌오류</span>}
                <button
                  className={`${s.sideAiBtn} ${videoGenStatus[c.id] === 'running' ? s.sideAiBtnRunning : ''}`}
                  disabled={videoGenStatus[c.id] === 'running'}
                  onClick={() => generateVideoForCut(c)}
                  title={`CUT ${c.no} AI 영상 생성`}
                >
                  {videoGenStatus[c.id] === 'running' ? '⏳' : '✨'}
                </button>
              </>
            )}
          />
        </div>
      </div>

      {/* Main area */}
      <div className={s.mainArea}>
      <div className={s.mainControls}>
        <div className={s.ratioToggle}>
          <button
            className={`${s.ratioBtn} ${aspectRatio === '9:16' ? s.ratioBtnActive : ''}`}
            onClick={() => setAspectRatio('9:16')}>
            9:16 숏폼
          </button>
          <button
            className={`${s.ratioBtn} ${aspectRatio === '16:9' ? s.ratioBtnActive : ''}`}
            onClick={() => setAspectRatio('16:9')}>
            16:9 롱폼
          </button>
        </div>
        <button
          className={`${s.overlayToggle} ${subtitleEnabled ? s.overlayOn : ''}`}
          onClick={() => {
            set({ subtitleEnabled: !subtitleEnabled })
            if (subtitleEnabled) setSubtitleEditMode(false)
          }}>
          💬 자막 {subtitleEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className={s.scrollBody}>

      {/* ── "영상 체크리스트"(VP 프롬프트/완성본 업로드)와 "컷별 카드"(로컬 클립 편집)로
          이원화돼 있던 구조를 하나로 통합(2026-09-13, 사용자 지적) — VP 프롬프트/videoMode/
          완성본 업로드는 이제 각 컷 카드(mainSplitCol) 안에 들어있다. vChk 요약 배지만 남김. */}
      {vChk && (
        <div className={s.vChkSummary}>
          정책: {vChk.policy === 'video-first' ? '영상 중심(LF)' : vChk.policy === 'mixed' ? '혼합(SF)' : '이미지+모션 중심(IG)'}
          {' · '}Veo 필요 <b>{vChk.veoNeeded}</b>컷 · 완료 <b>{vChk.veoDone}</b>
          {vChk.videoDir && <span className={s.vChkDir}> · 📁 {vChk.videoDir}</span>}
        </div>
      )}

      <div className={s.mainSplit}>
        <div className={s.mainSplitCol}>
        <div className={s.videoWrapper}
          style={{
            aspectRatio: aspectRatio === '9:16' ? '9/16' : '16/9',
            maxHeight: aspectRatio === '9:16' ? '78vh' : '60vh',
            maxWidth: '100%',
            margin: '0 auto',
          }}>
          <div className={s.videoInner}>
            {(() => {
              const selCut = cuts.find(c => c.id === selectedCutId)
              const clips = selCut ? (videoClips[selCut.id] || []) : []
              const activeClip = clips[selectedClipIdx] || clips[0]
              return activeClip
                ? <video key={activeClip.url} src={activeClip.url} controls className={s.mainVideo} />
                : (
                  <div className={s.mainVideoEmpty}>
                    <span className={s.mainVideoEmptyIcon}>🎬</span>
                    <span>{selCut ? `CUT ${selCut.no} 영상 없음` : '좌측에서 컷 선택'}</span>
                  </div>
                )
            })()}

            {subtitleEnabled && !subtitleEditMode && (
              <div
                className={`${s.subtitleDisplay} ${s[`pos_${subtitlePosition}`]}`}
                onClick={() => setSubtitleEditMode(true)}
                title="클릭하여 자막 수정"
              >
                <canvas ref={canvasRef} width={640} height={360} className={s.overlayCanvas} />
              </div>
            )}

            {subtitleEnabled && subtitleEditMode && (
              <div
                className={`${s.subtitleEditBox} ${s[`pos_${subtitlePosition}`]}`}
                onClick={(e) => e.stopPropagation()}>
                <textarea
                  ref={textareaRef}
                  className={s.subtitleEditInput}
                  rows={1}
                  value={previewText}
                  onChange={e => setPreviewText(e.target.value)}
                  autoFocus
                  placeholder="자막 텍스트 입력... (Enter로 줄바꿈 가능)"
                  onClick={(e) => e.stopPropagation()}
                />
                <div className={s.subtitleEditControls}>
                  <div className={s.posSelector}>
                    {['top','middle','bottom'].map(pos => (
                      <button key={pos}
                        className={`${s.posBtn} ${subtitlePosition === pos ? s.posBtnActive : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSubtitlePosition(pos) }}>
                        {pos === 'top' ? '상단' : pos === 'middle' ? '중앙' : '하단'}
                      </button>
                    ))}
                  </div>
                  <button className={s.subtitleDoneBtn} onClick={(e) => { e.stopPropagation(); setSubtitleEditMode(false) }}>
                    완료
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>

        <div className={s.mainSplitCol}>
        {cuts.map(selCut => {
          const isSelected = selCut.id === selectedCutId
          const clips = videoClips[selCut.id] || []
          // 예전엔 이 정보가 위쪽 "영상 체크리스트" 섹션에만 있어서 컷 카드에서 VP 프롬프트가
          // 아예 안 보였다(2026-09-13, 사용자 지적 — 이원화 구조 통합). vChk는 이미 로드돼 있음.
          const vRow = vChk?.cuts?.find(r => r.no === selCut.no)
          const up = vUpload[selCut.no] || {}
          const cutSegs = toSegments(subtitles[selCut.id], stripMeta(selCut.dialogue || selCut.narration || ''), selCut.duration || 0)
          const captionText = cutSegs[0]?.text ?? ''
          const cutClipTimings = clips.length > 1 ? clipTimings(clips) : []
          const setClipCaption = (idx, text) => {
            const timings = clipTimings(clips)
            setSubtitles(prev => {
              const cur = toSegments(prev[selCut.id], '', selCut.duration || 0)
              const next = clips.map((_, i) => ({
                start: timings[i].start, end: timings[i].end,
                text: i === idx ? text : (cur[i]?.text ?? ''),
              }))
              return { ...prev, [selCut.id]: next }
            })
          }
          return (
            <div key={selCut.id}
              className={`${s.selectedCutCard} ${isSelected ? s.selectedCutCardActive : ''}`}
              onClick={() => setSelectedCutId(selCut.id)}>
              <div className={s.cutCardHeader}>
                <span className={s.cutCardTitle}>CUT {String(selCut.no).padStart(2,'0')} — {selCut.scene || '씬 미입력'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {vRow && (
                    <select value={vRow.videoMode} onClick={e => e.stopPropagation()}
                      onChange={e => setCutVideoMode(selCut.no, e.target.value)}
                      style={{ fontSize:11, background:'var(--bg-input)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, padding:'2px 4px' }}>
                      {VIDEO_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  )}
                  {vRow && (
                    <span style={{ fontSize:11, fontWeight:700, color: vRow.hasVideo ? '#4ade80' : vRow.videoMode === 'veo' ? '#fbbf24' : 'var(--text-3)' }}>
                      {vRow.hasVideo ? '✓ 업로드됨' : vRow.videoMode === 'veo' ? '· 제작 필요' : vRow.videoMode === 'motion' ? '· 메이킹 탭' : '· 정지'}
                    </span>
                  )}
                  {clips.length === 0 && (() => {
                    const target = selCut.duration || 5
                    const estCount = estimateClipCount(target)
                    return estCount > 1 ? (
                      <span className={s.clipEstimateBadge}>
                        💡 예상 {estCount}개 클립 필요 (8초 기준)
                      </span>
                    ) : null
                  })()}
                  {clips.length > 0 && (() => {
                    const target = selCut.duration || 5
                    const totalUsed = clips.reduce((sum, clip) => {
                      const used = clip.useFullDuration ? clip.duration : (clip.trimEnd - clip.trimStart)
                      return sum + (used || 0)
                    }, 0)
                    const isOk = Math.abs(totalUsed - target) <= 1
                    return (
                      <span className={`${s.clipTotalLen} ${isOk ? s.clipTotalLenOk : s.clipTotalLenWarn}`}>
                        합계 {totalUsed.toFixed(1)}s / 목표 {target}s
                      </span>
                    )
                  })()}
                  <div className={s.cutCardDurEdit} onClick={e => e.stopPropagation()}>
                    <label>목표</label>
                    <input type="number" min="1" max="120" step="0.5"
                      value={selCut.duration || 5}
                      onChange={e => {
                        const newDur = parseFloat(e.target.value) || 5
                        dispatch({ type: 'UPDATE_CUT', id: selCut.id, p: { duration: newDur } })
                      }} />
                    <span>s</span>
                  </div>
                </div>
              </div>
              <div className={s.cutCardBody}>
                {(selCut.dialogue || selCut.narration || selCut.imagePrompt) && (
                  <div className={s.cutCardPromptPreview}>
                    {stripMeta(selCut.dialogue || selCut.narration || '') || selCut.imagePrompt}
                  </div>
                )}

                {vRow?.videoMode === 'veo' && vRow.videoPrompt && (
                  <div className={s.vpRow} onClick={e => e.stopPropagation()}>
                    <button className={s.vpCopyBtn} onClick={() => navigator.clipboard.writeText(vRow.videoPrompt)}>
                      VP 복사
                    </button>
                    <button className={s.vpToggleBtn}
                      onClick={() => setExpandedVP(p => ({ ...p, [selCut.no]: !p[selCut.no] }))}
                      title="클릭해서 전체 프롬프트 펼치기/접기">
                      <span className={expandedVP[selCut.no] ? s.vpTextFull : s.vpTextClamp}>
                        {expandedVP[selCut.no] ? vRow.videoPrompt : vRow.videoPrompt.replace(/\n/g, ' ')}
                      </span>
                      {!expandedVP[selCut.no] && <span className={s.vpMore}> ▸ 전체보기</span>}
                    </button>
                    {vRow.startFrame
                      ? <a className={s.vpStartFrame} href={vRow.startFrame} download={`cut_${String(selCut.no).padStart(2,'0')}_start.jpg`}>
                          🖼 시작 프레임 저장
                        </a>
                      : <span className={s.vpNoStartFrame}>⚠ 시작 프레임 없음(G2 먼저)</span>}
                  </div>
                )}

                {clips.length <= 1 && (
                  <div className={s.field} onClick={e => e.stopPropagation()}>
                    <label>컷 자막</label>
                    <textarea rows={2} className={s.captionInput}
                      value={captionText}
                      placeholder="이 컷의 자막 텍스트..."
                      onChange={e => setSubtitles(prev => ({ ...prev, [selCut.id]: e.target.value }))} />
                  </div>
                )}

                {clips.length > 0 && (
                  <div className={s.clipList}>
                    {clips.map((clip, idx) => {
                      const usedSec = clip.useFullDuration
                        ? clip.duration
                        : (clip.trimEnd - clip.trimStart)
                      const isClipActive = isSelected && selectedClipIdx === idx
                      return (
                        <div key={idx}
                          className={`${s.clipTrimItem} ${isClipActive ? s.clipTrimItemActive : ''}`}
                          onClick={e => { e.stopPropagation(); setSelectedCutId(selCut.id); setSelectedClipIdx(idx) }}>
                          <div className={s.clipTrimHeader}>
                            <span className={s.clipIdx}>{['①','②','③','④','⑤'][idx] ?? idx+1}</span>
                            <span className={s.clipName}>
                              {clip.name || `로컬파일 ${idx+1}`}
                              <span className={s.clipLabel}> ({String.fromCharCode(97 + idx)})</span>
                            </span>
                            <span className={s.clipDurLabel}>{clip.duration != null ? `${clip.duration}s` : '?'}</span>
                            {clip.staging && <span className={s.clipStagingBadge} title="서버에 올리는 중...">⏳ 업로드 중</span>}
                            {clip.stageError && <span className={s.clipStageErrorBadge} title={clip.stageError}>⚠ 업로드 실패</span>}
                            {!clip.staging && !clip.stageError && !clip.stagedPath && <span className={s.clipStageErrorBadge}>⚠ 서버 미반영</span>}
                            {clip.ratio && (
                              <span className={`${s.clipRatioBadge} ${clip.ratio !== aspectRatio ? s.clipRatioMismatch : ''}`}
                                title={clip.ratio !== aspectRatio ? `현재 미리보기 모드(${aspectRatio})와 다른 비율입니다` : ''}>
                                {clip.ratio}
                              </span>
                            )}
                            <button className={s.clipDel} onClick={e => { e.stopPropagation(); removeClip(selCut.id, idx) }}>✕</button>
                          </div>
                          {clips.length > 1 && (
                            <div className={s.clipCaptionRow} onClick={e => e.stopPropagation()}>
                              <span className={s.clipCaptionTime}>
                                {cutClipTimings[idx] ? `${cutClipTimings[idx].start.toFixed(1)}s~${cutClipTimings[idx].end.toFixed(1)}s` : ''}
                              </span>
                              <textarea rows={1} className={s.clipCaptionInput}
                                value={cutSegs[idx]?.text ?? ''}
                                placeholder="이 구간의 자막..."
                                onChange={e => setClipCaption(idx, e.target.value)} />
                            </div>
                          )}
                          {isClipActive && (
                            <div className={s.clipTrimBody} onClick={e => e.stopPropagation()}>
                              <label className={s.check}>
                                <input type="checkbox"
                                  checked={clip.useFullDuration}
                                  onChange={e => updateClipTrim(selCut.id, idx, {
                                    useFullDuration: e.target.checked,
                                  })} />
                                <span>전체 사용</span>
                              </label>
                              <label className={s.check}>
                                <input type="checkbox"
                                  checked={clip.keepAudio ?? true}
                                  onChange={e => updateClipTrim(selCut.id, idx, { keepAudio: e.target.checked })} />
                                <span>오디오 유지</span>
                              </label>
                              {!clip.useFullDuration && (
                                <div className={s.trimInputs}>
                                  <div className={s.trimField}>
                                    <label>시작</label>
                                    <input type="number" min={0} max={clip.duration || 9999} step={0.1}
                                      value={clip.trimStart}
                                      onChange={e => updateClipTrim(selCut.id, idx, { trimStart: parseFloat(e.target.value) || 0 })} />
                                    <span>s</span>
                                  </div>
                                  <div className={s.trimField}>
                                    <label>종료</label>
                                    <input type="number" min={0} max={clip.duration || 9999} step={0.1}
                                      value={clip.trimEnd}
                                      onChange={e => updateClipTrim(selCut.id, idx, { trimEnd: parseFloat(e.target.value) || 0 })} />
                                    <span>s</span>
                                  </div>
                                </div>
                              )}
                              <span className={s.clipUsedLen}>사용: {usedSec != null ? usedSec.toFixed(1) : '?'}s</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {videoCandidates[selCut.no]?.length > 0 && (
                  <div className={s.candidateRow} onClick={e => e.stopPropagation()}>
                    <span className={s.candidateLabel}>📁 폴더에서 찾음:</span>
                    {videoCandidates[selCut.no].map(cand => {
                      const already = clips.some(c => c.stagedPath === cand.path)
                      return (
                        <button key={cand.name} className={s.candidateBtn} disabled={already}
                          onClick={() => addCandidateClip(selCut.id, selCut.no, cand)}>
                          {already ? `✓ ${cand.name}` : `+ ${cand.name}`}
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className={s.videoEmptyBtns} onClick={e => e.stopPropagation()}>
                  <label className={s.uploadBtn}>
                    📁 로컬 업로드
                    <input type="file" accept="video/*" multiple hidden
                      onChange={e => handleVideoUpload(selCut.id, e.target.files)} />
                  </label>
                  <button className={s.proxyBtn} onClick={() => loadFromProxy(selCut)}>
                    🔄 프록시
                  </button>
                  <button
                    className={s.aiGenBtn}
                    disabled={videoGenStatus[selCut.id] === 'running'}
                    title="Flow/Veo 자동화는 2026-09-02에 폐기됨 — 외부에서 수동 제작 후 업로드 권장"
                    onClick={() => generateVideoForCut(selCut)}>
                    {videoGenStatus[selCut.id] === 'running' ? '⏳ 생성 중…' : '✨ AI 영상 생성 (레거시)'}
                  </button>
                  <button
                    className={s.composeBtn}
                    disabled={composeStatus[selCut.id] === 'running' || !clips.length}
                    title="여기 있는 클립들을 순서/트림대로 이어붙여 실제 cut_NN.mp4를 만듭니다"
                    onClick={() => renderCutClips(selCut)}>
                    {composeStatus[selCut.id] === 'running' ? '⏳ 합성 중…' : '🎬 클립 합성'}
                  </button>
                  <button
                    className={s.ffmpegBtn}
                    disabled={ffmpegStatus[selCut.id] === 'running'}
                    title="서버에 이미 있는 cut_NN.mp4 위에 나레이션·효과음만 입힙니다"
                    onClick={() => runFfmpegForCut(selCut)}>
                    {ffmpegStatus[selCut.id] === 'running' ? '⏳ 처리 중…' : '🔊 나레이션·효과음 입히기'}
                  </button>
                  <label className={s.uploadBtn} title="외부(CapCut/Veo 등)에서 이미 완성한 파일 1개를 바로 올립니다">
                    {up.busy ? '업로드 중…' : '📤 완성본 바로 업로드'}
                    <input type="file" accept="video/mp4,video/*" hidden disabled={up.busy}
                      onChange={e => { const f = e.target.files[0]; if (f) uploadCutVideo(selCut.no, f, up.keepAudio ?? !!selCut.dialogue); e.target.value = '' }} />
                  </label>
                </div>
                {ffmpegLog[selCut.id] && (
                  <div className={s.ffmpegLog}>{ffmpegLog[selCut.id]}</div>
                )}
                {composeLog[selCut.id] && (
                  <div className={s.ffmpegLog}>{composeLog[selCut.id]}</div>
                )}
                {videoGenLog[selCut.id] && (
                  <div className={s.aiGenLog}>{videoGenLog[selCut.id]}</div>
                )}
                {up.result?.error && <div className={s.aiGenLog}>❌ {up.result.error}</div>}
                {up.result?.success && <div className={s.ffmpegLog}>✓ {up.result.sizeKB}KB{up.result.keptAudio ? ' · 오디오 유지' : ''}</div>}
              </div>
              <div className={s.cutCardFooter} onClick={e => e.stopPropagation()}>
                <button
                  className={`${s.g4Btn} ${g4Approved[selCut.id] ? s.g4Done : ''}`}
                  onClick={() => {
                    const next = !g4Approved[selCut.id]
                    setG4Approved(p => ({ ...p, [selCut.id]: next }))
                    setGPoint(episodeCode, selCut.no, 'g4', next)
                  }}>
                  {g4Approved[selCut.id] ? '✓ G4 취소' : 'G4 승인'}
                </button>
              </div>
            </div>
          )
        })}
        </div>
      </div>
      </div>
      </div>
    </div>
    </div>
  )
}
