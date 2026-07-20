import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import JSZip from 'jszip'
import { setGPoint, setGPoints } from '../lib/gpoints'
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

export default function VideoTab() {
  const { state, dispatch } = useApp()
  const { cuts, videoSettings, renderProgress, episode } = state
  const { subtitleEnabled, font, fontSize, color, bgStyle, boxColor } = videoSettings
  const canvasRef = useRef(null)
  const textareaRef = useRef(null)
  const [renderLog, setRenderLog] = useState([])

  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const { videoClips = {}, g4Approved = {}, selectedCutId = null, subtitles = {} } = state.videoTabState || {}
  const [subtitleEditMode, setSubtitleEditMode] = useState(false)
  const [subtitlePosition, setSubtitlePosition] = useState('middle')
  const [selectedClipIdx, setSelectedClipIdx] = useState(0)
  const [videoGenStatus, setVideoGenStatus] = useState({})
  const [videoGenLog, setVideoGenLog] = useState({})
  const [ffmpegStatus, setFfmpegStatus] = useState({})
  const [ffmpegLog,    setFfmpegLog]    = useState({})
  const [batchFfmpegStatus,   setBatchFfmpegStatus]   = useState('idle') // idle | running | done | error
  const [batchFfmpegProgress, setBatchFfmpegProgress] = useState({ current: 0, total: 0 })
  const [batchFfmpegLog,      setBatchFfmpegLog]      = useState('')

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
  const previewText = selCutForText
    ? (subtitles[selCutForText.id] ?? stripMeta(selCutForText.dialogue || selCutForText.narration || ''))
    : ''
  const setPreviewText = (text) => {
    if (!selCutForText) return
    setSubtitles(prev => ({ ...prev, [selCutForText.id]: text }))
  }

  useEffect(() => {
    if (cuts.length > 0 && !selectedCutId) {
      setSelectedCutId(cuts[0].id)
    }
  }, [cuts])

  useEffect(() => { setSelectedClipIdx(0) }, [selectedCutId])

  // 컷을 바꾸면 그 컷에 이미 올라온 영상의 실제 비율로 미리보기 모드를 자동 전환
  // (이전 컷에서 선택한 9:16/16:9가 그대로 남아있어 다른 컷 영상이 잘못된 비율로 보이던 문제)
  useEffect(() => {
    const clips = videoClips[selectedCutId] || []
    const first = clips[0]
    if (!first) return
    if (first.ratio) { setAspectRatio(first.ratio); return }
    // 이 fix 이전에 올라온 클립처럼 ratio가 저장돼 있지 않으면 즉석에서 감지
    let cancelled = false
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      if (cancelled || !probe.videoWidth || !probe.videoHeight) return
      setAspectRatio(probe.videoWidth >= probe.videoHeight ? '16:9' : '9:16')
    }
    probe.src = first.url
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCutId])

  const allG4Done = cuts.length > 0 && cuts.every(c => g4Approved[c.id])

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
    cuts.forEach(c => { if (c.dialogue || c.narration) setGPoint(c.no, 'g3', true) })
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
      setGPoint(c.no, 'g3', true)
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
      const url = `http://localhost:3001/downloads/video/ep${ep}/cut_${padded}.${ext}?t=${Date.now()}`
      try {
        const r = await fetch(url, { method: 'HEAD' })
        if (r.ok) {
          const name = `cut_${padded}.${ext}`
          const vid = document.createElement('video')
          vid.preload = 'metadata'
          vid.onloadedmetadata = () => {
            const dur = Math.round(vid.duration * 100) / 100
            const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
            const obj = { url, name, duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true, ratio }
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

  const handleVideoUpload = (cutId, files) => {
    Array.from(files).forEach(f => {
      const url = URL.createObjectURL(f)
      const vid = document.createElement('video')
      vid.preload = 'metadata'
      vid.onloadedmetadata = () => {
        const dur = Math.round(vid.duration * 100) / 100
        const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
        const obj = { url, name: f.name, duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true, ratio }
        setVideoClips(p => ({ ...p, [cutId]: [...(p[cutId] || []), obj] }))
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
    const scanRes = await fetch(`http://localhost:3001/api/scan-images?ep=${ep}`)
    const data = await scanRes.json()
    const match = data.images?.find(img => img.cutNo === cut.no)
    if (!match) throw new Error(`CUT ${cut.no}의 G2 이미지가 없습니다. 스튜디오 탭에서 먼저 이미지를 생성/승인하세요.`)
    const confirmRes = await fetch('http://localhost:3001/api/confirm-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ep, cutNo: cut.no, imageUrl: match.url }),
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
            } else if (ev.type === 'complete' && !ev.success) {
              setVideoGenStatus(p => p[cut.id] === 'running' ? { ...p, [cut.id]: 'error' } : p)
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

  const runFfmpegForCut = async (cut) => {
    setFfmpegStatus(p => ({ ...p, [cut.id]: 'running' }))
    setFfmpegLog(p => ({ ...p, [cut.id]: '합성 시작…' }))
    try {
      const ep = episode?.number ?? ''
      const res = await fetch('http://localhost:3001/api/run-ffmpeg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep, cutNo: cut.no }),
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

    const workDir = `C:\\yeori-studio\\downloads\\video\\ep${ep}`
    const meta = cuts.map(c => ({
      cutNo: c.no,
      label: `CUT ${String(c.no).padStart(2, '0')}`,
      duration: c.duration || 8,
      audioFile: `C:\\yeori-studio\\downloads\\audio\\ep${ep}\\cut_${String(c.no).padStart(2, '0')}.mp3`,
    }))

    try {
      const res = await fetch('http://localhost:3001/api/ffmpeg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir, meta }),
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
                const url = `http://localhost:3001/downloads/video/ep${ep}/output_final/C${padded}_final.mp4?t=${Date.now()}`
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
    <div className={s.root}>
      {/* Sidebar */}
      <div className={s.sidebar}>
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
              <div className={s.field}>
                <label>글씨체</label>
                <select value={font} onChange={e => set({ font: e.target.value })} disabled={!subtitleEnabled}>
                  {FONTS.map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div className={s.field}>
                <label>글자 크기 <span className={s.val}>{fontSize}px</span></label>
                <input type="range" min="16" max="72" value={fontSize} disabled={!subtitleEnabled}
                  onChange={e => set({ fontSize: parseInt(e.target.value) })} />
              </div>
              <div className={s.field}>
                <label>글자 색상</label>
                <div className={s.colorRow}>
                  <input type="color" value={color} disabled={!subtitleEnabled}
                    onChange={e => set({ color: e.target.value })} className={s.colorPicker} />
                  <span className={s.colorVal}>{color}</span>
                </div>
              </div>
              <div className={s.field}>
                <label>배경 스타일</label>
                <select value={bgStyle} onChange={e => set({ bgStyle: e.target.value })} disabled={!subtitleEnabled}>
                  {BG_STYLES.map(b => <option key={b}>{b}</option>)}
                </select>
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
          )}
        </div>

        <div className={s.quickActions}>
          <button className={s.qaBtn} onClick={exportSRT}>📄 SRT</button>
          <button className={s.qaBtn} onClick={loadAllFromProxy}>🔄 불러오기</button>
          <button
            className={s.qaBtn}
            disabled={cuts.some(c => videoGenStatus[c.id] === 'running')}
            onClick={async () => {
              for (const c of cuts) {
                if (videoGenStatus[c.id] === 'running') continue
                await generateVideoForCut(c)
              }
            }}
          >
            {cuts.some(c => videoGenStatus[c.id] === 'running') ? '⏳ 생성 중…' : '✨ 전체 AI 생성'}
          </button>
          <button
            className={`${s.qaBtn} ${allG4Done ? s.qaBtnDone : ''}`}
            onClick={() => {
              const next = !allG4Done
              cuts.forEach(c => {
                setG4Approved(p => ({ ...p, [c.id]: next }))
                setGPoint(c.no, 'g4', next)
              })
            }}
          >
            {allG4Done ? '전체 취소' : 'G4 전체'}
          </button>
          <button
            className={`${s.qaBtn} ${batchFfmpegStatus === 'done' ? s.qaBtnDone : ''}`}
            disabled={cuts.length === 0 || batchFfmpegStatus === 'running'}
            onClick={runFfmpegBatchAll}
          >
            {batchFfmpegStatus === 'running'
              ? `⏳ 합성 중… (${batchFfmpegProgress.current}/${batchFfmpegProgress.total})`
              : '🎬 전체 일괄 합성'}
          </button>
        </div>

        {batchFfmpegLog && <div className={s.ffmpegLog}>{batchFfmpegLog}</div>}

        <div className={s.g4Count}>G4 완료: {Object.values(g4Approved).filter(Boolean).length} / {cuts.length}</div>

        <div className={s.cutSideList}>
          <div className={s.cutSideListHeader}>컷 목록</div>
          <div className={s.cutSideItems}>
            {cuts.map(c => {
              const clips = videoClips[c.id] || []
              const isSelected = selectedCutId === c.id
              const estCount = estimateClipCount(c.duration || 5)
              const statusText = clips.length > 0
                ? `영상 ${clips.length}개`
                : (estCount > 1 ? `영상 없음 · 예상 ${estCount}개 필요` : '영상 없음')
              return (
                <div key={c.id}
                  className={`${s.cutSideItem} ${isSelected ? s.cutSideItemActive : ''}`}
                  onClick={() => setSelectedCutId(c.id)}>
                  {clips[0]
                    ? <video src={clips[0]?.url} className={s.cutSideThumb} muted />
                    : <div className={s.cutSideThumbEmpty}>🎬</div>}
                  <div className={s.cutSideInfo}>
                    <div className={s.cutSideNo}>CUT {String(c.no).padStart(2,'0')}</div>
                    <div className={s.cutSideStatus}>
                      {statusText}
                      {g4Approved[c.id] ? ' · ✅' : ''}
                      {videoGenStatus[c.id] === 'running' && <span className={s.sideGenBadge}>⏳생성중</span>}
                      {videoGenStatus[c.id] === 'done' && <span className={s.sideGenBadgeDone}>✅완료</span>}
                      {videoGenStatus[c.id] === 'error' && <span className={s.sideGenBadgeError}>❌오류</span>}
                    </div>
                  </div>
                  <button
                    className={`${s.sideAiBtn} ${videoGenStatus[c.id] === 'running' ? s.sideAiBtnRunning : ''}`}
                    disabled={videoGenStatus[c.id] === 'running'}
                    onClick={e => { e.stopPropagation(); generateVideoForCut(c) }}
                    title={`CUT ${c.no} AI 영상 생성`}
                  >
                    {videoGenStatus[c.id] === 'running' ? '⏳' : '✨'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className={s.subtitleMonitor}>
          <div className={s.subtitleMonitorHeader}>전체 자막 모니터링</div>
          <div className={s.subtitleMonitorList}>
            {cuts.map(c => {
              const text = subtitles[c.id] ?? stripMeta(c.dialogue || c.narration || '')
              const isActive = selectedCutId === c.id
              return (
                <div key={c.id}
                  className={`${s.subMonItem} ${isActive ? s.subMonItemActive : ''}`}
                  onClick={() => setSelectedCutId(c.id)}>
                  <span className={s.subMonNo}>{String(c.no).padStart(2,'0')}</span>
                  <span className={s.subMonText}>{text || '(자막 없음)'}</span>
                </div>
              )
            })}
          </div>
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

        {(() => {
          const selCut = cuts.find(c => c.id === selectedCutId)
          if (!selCut) return null
          const clips = videoClips[selCut.id] || []
          return (
            <div className={s.selectedCutCard}>
              <div className={s.cutCardHeader}>
                <span className={s.cutCardTitle}>CUT {String(selCut.no).padStart(2,'0')} — {selCut.scene || '씬 미입력'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  <div className={s.cutCardDurEdit}>
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
                {clips.length > 0 && (
                  <div className={s.clipList}>
                    {clips.map((clip, idx) => {
                      const usedSec = clip.useFullDuration
                        ? clip.duration
                        : (clip.trimEnd - clip.trimStart)
                      return (
                        <div key={idx}
                          className={`${s.clipTrimItem} ${selectedClipIdx === idx ? s.clipTrimItemActive : ''}`}
                          onClick={() => setSelectedClipIdx(idx)}>
                          <div className={s.clipTrimHeader}>
                            <span className={s.clipIdx}>{['①','②','③','④','⑤'][idx] ?? idx+1}</span>
                            <span className={s.clipName}>
                              {clip.name || `로컬파일 ${idx+1}`}
                              <span className={s.clipLabel}> ({String.fromCharCode(97 + idx)})</span>
                            </span>
                            <span className={s.clipDurLabel}>{clip.duration != null ? `${clip.duration}s` : '?'}</span>
                            {clip.ratio && (
                              <span className={`${s.clipRatioBadge} ${clip.ratio !== aspectRatio ? s.clipRatioMismatch : ''}`}
                                title={clip.ratio !== aspectRatio ? `현재 미리보기 모드(${aspectRatio})와 다른 비율입니다` : ''}>
                                {clip.ratio}
                              </span>
                            )}
                            <button className={s.clipDel} onClick={e => { e.stopPropagation(); removeClip(selCut.id, idx) }}>✕</button>
                          </div>
                          <div className={s.clipTrimBody} onClick={e => e.stopPropagation()}>
                            <label className={s.check}>
                              <input type="checkbox"
                                checked={clip.useFullDuration}
                                onChange={e => updateClipTrim(selCut.id, idx, {
                                  useFullDuration: e.target.checked,
                                })} />
                              <span>전체 사용</span>
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
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className={s.videoEmptyBtns}>
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
                    onClick={() => generateVideoForCut(selCut)}>
                    {videoGenStatus[selCut.id] === 'running' ? '⏳ 생성 중…' : '✨ AI 영상 생성'}
                  </button>
                  <button
                    className={s.ffmpegBtn}
                    disabled={ffmpegStatus[selCut.id] === 'running'}
                    onClick={() => runFfmpegForCut(selCut)}>
                    {ffmpegStatus[selCut.id] === 'running' ? '⏳ 합성 중…' : '🎬 FFmpeg 합성'}
                  </button>
                </div>
                {ffmpegLog[selCut.id] && (
                  <div className={s.ffmpegLog}>{ffmpegLog[selCut.id]}</div>
                )}
                {videoGenLog[selCut.id] && (
                  <div className={s.aiGenLog}>{videoGenLog[selCut.id]}</div>
                )}
              </div>
              <div className={s.cutCardFooter}>
                <button
                  className={`${s.g4Btn} ${g4Approved[selCut.id] ? s.g4Done : ''}`}
                  onClick={() => {
                    const next = !g4Approved[selCut.id]
                    setG4Approved(p => ({ ...p, [selCut.id]: next }))
                    setGPoint(selCut.no, 'g4', next)
                  }}>
                  {g4Approved[selCut.id] ? '✓ G4 취소' : 'G4 승인'}
                </button>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
