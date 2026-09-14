import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import s from './CheckupTimeline.module.css'

const SERVER = 'http://localhost:3001'
const MIN_CLIP_SEC = 0.2
const DEFAULT_PX_PER_SEC = 50
const PX_PER_SEC_RANGE = [10, 300]
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
const RULER_MIN_LABEL_PX = 60

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const cloneClips = (clips) => clips.map(c => ({ ...c }))
const fmtTime = (sec) => {
  const m = Math.floor(sec / 60), ss = Math.floor(sec % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

// 파형 전용 행(waveRow)에 그리는 오디오 파형 — 클립 썸네일과 겹치면 거의 안 보인다는
// 피드백(2026-09-13)으로 클립 블록과 분리된 독립 라인으로 옮김. 배경/막대 색을 뚜렷한
// 대비색으로 줘서 한눈에 구분되게 한다. peaks는 sourceCutNo(원본 파일) 전체 기준 배열이라,
// trimIn/trimOut 비율로 슬라이스해서 그린다.
function WaveformCanvas({ peaks, trimInSec, trimOutSec, sourceDurationSec, widthPx, heightPx }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || widthPx <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, widthPx * dpr)
    canvas.height = Math.max(1, heightPx * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, widthPx, heightPx)
    if (!peaks?.length) return
    const total = sourceDurationSec || (trimOutSec - trimInSec) || 1
    const startIdx = Math.max(0, Math.floor((trimInSec / total) * peaks.length))
    const endIdx = Math.min(peaks.length, Math.ceil((trimOutSec / total) * peaks.length))
    const slice = peaks.slice(startIdx, endIdx)
    if (!slice.length) return
    ctx.fillStyle = '#22d3ee'   // 밝은 청록 — 어두운 파형 라인 배경 위에서 뚜렷이 대비
    const mid = heightPx / 2
    const barW = widthPx / slice.length
    slice.forEach((v, i) => {
      const h = Math.max(1.5, v * heightPx)
      ctx.fillRect(i * barW, mid - h / 2, Math.max(1, barW - 0.4), h)
    })
  }, [peaks, trimInSec, trimOutSec, sourceDurationSec, widthPx, heightPx])
  return <canvas ref={canvasRef} className={s.waveCanvas} style={{ width: widthPx, height: heightPx }} />
}

// 클립 안에 실제 영상 스틸컷을 1초 간격으로 나열 — startFrame(이미지 1장)을 늘려서 배경으로
// 쓰면 클립이 넓을수록 장면 변화를 구별할 수 없다는 피드백(2026-09-13)으로 추가. frames는
// sourceCutNo 전체 기준 1초 간격 프레임 URL 배열이라, trimIn/trimOut 비율로 슬라이스해서
// 그 구간에 해당하는 프레임만 균등폭으로 나열한다.
function FilmstripThumbs({ frames, trimInSec, trimOutSec, sourceDurationSec, fallbackImage }) {
  if (!frames?.length) {
    return fallbackImage ? <div className={s.filmstripFallback} style={{ backgroundImage: `url(${fallbackImage})` }} /> : null
  }
  const total = sourceDurationSec || trimOutSec || frames.length
  const frameDur = total / frames.length
  const startIdx = clamp(Math.floor(trimInSec / frameDur), 0, frames.length - 1)
  const endIdx = clamp(Math.ceil(trimOutSec / frameDur), startIdx + 1, frames.length)
  const slice = frames.slice(startIdx, endIdx)
  if (!slice.length) return null
  return (
    <div className={s.filmstrip}>
      {slice.map((url, i) => <img key={i} src={url} className={s.filmstripImg} draggable={false} alt="" />)}
    </div>
  )
}

// 체크업 탭 "🎬 타임라인 편집"(Tier3~4, 2026-09-13) — 분할/트림/드래그 재배치/삭제/줌/실행취소·
// 재실행 + 실시간 눈금자 + 오디오 파형을 지원하는 미리보기 전용 편집 타임라인.
// run-cutter.js/editMeta.json(cutNo 1:1, 실제 CapCut 배치용)은 전혀 건드리지 않고, 완전히
// 분리된 yeori_checkup_timeline.json(서버 /api/checkup-timeline)에만 저장한다 — 분할된 두
// 조각도 같은 sourceCutNo를 공유해서 cutNo 1:1 가정을 깨지 않는다.
//
// props:
//   epNum          — 대상 에피소드 번호
//   cutsByNo        — { [no]: { videoUrl, startFrame, actualDurationSec, cutType } } 조회용
//   activeCutNo     — 현재 재생 중인 컷 번호(CheckupTab의 재생 상태, 소스파일 기준)
//   elapsedInActive — activeCutNo 소스파일 안에서의 재생 위치(초) — 플레이헤드 계산에 씀
//   onSeek(cutNo, localTime) — 클릭/분할 시 CheckupTab의 기존 seekTo를 그대로 재사용
//   onSelectCut(cutNo)       — 선택된 클립의 원본 컷 번호를 효과 사이드바에 전달
export default function CheckupTimeline({ epNum, cutsByNo, activeCutNo, elapsedInActive, onSeek, onSelectCut }) {
  const [clips, setClips] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState(null)
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC)
  const [undoStack, setUndoStack] = useState([])   // 로컬 실행취소/재실행 이력 — AppContext/저장소에 절대 안 들어감
  const [redoStack, setRedoStack] = useState([])
  const [waveforms, setWaveforms] = useState({})   // { [sourceCutNo]: number[] } — 컷당 1번만 fetch
  const [filmstrips, setFilmstrips] = useState({}) // { [sourceCutNo]: string[] } — 1초 간격 프레임 URL, 컷당 1번만 fetch
  const latestClipsRef = useRef([])
  const stripRef = useRef(null)
  const saveTimerRef = useRef(null)
  const dragMovedRef = useRef(false)

  useEffect(() => { latestClipsRef.current = clips }, [clips])

  const load = useCallback(async () => {
    if (epNum == null) return
    setLoading(true)
    try {
      const r = await fetch(`${SERVER}/api/checkup-timeline?epNum=${epNum}`)
      const d = await r.json()
      setClips((d.clips || []).slice().sort((a, b) => a.order - b.order))
      setUndoStack([])
      setRedoStack([])
    } catch {
      // 조용히 무시 — 참고용 미리보기 레이어
    } finally {
      setLoading(false)
    }
  }, [epNum])
  useEffect(() => { load() }, [load])

  // 클립이 참조하는 소스 컷의 파형을 컷당 1번만 lazy fetch(트림은 같은 배열을 슬라이스해서 재사용)
  useEffect(() => {
    if (epNum == null) return
    const need = [...new Set(clips.map(c => c.sourceCutNo))].filter(no => !(no in waveforms))
    need.forEach(async (no) => {
      try {
        const r = await fetch(`${SERVER}/api/checkup-waveform?epNum=${epNum}&cutNo=${no}`)
        const d = await r.json()
        setWaveforms(prev => ({ ...prev, [no]: d.peaks || [] }))
      } catch {
        setWaveforms(prev => ({ ...prev, [no]: [] }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, epNum])

  // 클립이 참조하는 소스 컷의 1초 간격 스틸컷도 컷당 1번만 lazy fetch
  useEffect(() => {
    if (epNum == null) return
    const need = [...new Set(clips.map(c => c.sourceCutNo))].filter(no => !(no in filmstrips))
    need.forEach(async (no) => {
      try {
        const r = await fetch(`${SERVER}/api/checkup-filmstrip?epNum=${epNum}&cutNo=${no}`)
        const d = await r.json()
        setFilmstrips(prev => ({ ...prev, [no]: d.frames || [] }))
      } catch {
        setFilmstrips(prev => ({ ...prev, [no]: [] }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, epNum])

  const pushUndo = useCallback((snapshot) => {
    setUndoStack(prev => [...prev.slice(-29), snapshot])
    setRedoStack([])   // 새 편집이 생기면 재실행 이력은 무효
  }, [])

  const scheduleSave = useCallback((nextClips) => {
    setSaving(true)
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${SERVER}/api/checkup-timeline`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ epNum, clips: nextClips }),
        })
      } catch {
        // 조용히 무시 — 다음 편집 때 재시도
      } finally {
        setSaving(false)
      }
    }, 800)
  }, [epNum])

  const commit = useCallback((mutator) => {
    setClips(prev => {
      const before = cloneClips(prev)
      const next = mutator(cloneClips(prev))
      pushUndo(before)
      scheduleSave(next)
      return next
    })
  }, [pushUndo, scheduleSave])

  const undo = useCallback(() => {
    if (!undoStack.length) return
    const snapshot = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setRedoStack(prev => [...prev.slice(-29), latestClipsRef.current])
    setClips(snapshot)
    scheduleSave(snapshot)
  }, [undoStack, scheduleSave])

  const redo = useCallback(() => {
    if (!redoStack.length) return
    const snapshot = redoStack[redoStack.length - 1]
    setRedoStack(prev => prev.slice(0, -1))
    setUndoStack(prev => [...prev.slice(-29), latestClipsRef.current])
    setClips(snapshot)
    scheduleSave(snapshot)
  }, [redoStack, scheduleSave])

  // 타임라인 배치(순서 기준 누적 오프셋) — 갭 없이 바로 이어붙임(갭은 Tier2 CapCut 배치 전용 기능)
  const positioned = useMemo(() => {
    let offset = 0
    return clips.map(c => {
      const dur = Math.max(0, c.trimOutSec - c.trimInSec)
      const item = { ...c, start: offset, dur }
      offset += dur
      return item
    })
  }, [clips])
  const totalSec = useMemo(() => Math.max(1, positioned.reduce((sum, it) => sum + it.dur, 0)), [positioned])

  const rulerStep = useMemo(() => (
    RULER_STEPS.find(st => st * pxPerSec >= RULER_MIN_LABEL_PX) || RULER_STEPS[RULER_STEPS.length - 1]
  ), [pxPerSec])
  const rulerTicks = useMemo(() => {
    const ticks = []
    for (let t = 0; t <= totalSec; t += rulerStep) ticks.push(t)
    return ticks
  }, [rulerStep, totalSec])

  const playheadSec = useMemo(() => {
    const hit = positioned.find(it => it.sourceCutNo === activeCutNo &&
      elapsedInActive >= it.trimInSec && elapsedInActive < it.trimOutSec + 0.05)
    if (!hit) return null
    return hit.start + Math.max(0, elapsedInActive - hit.trimInSec)
  }, [positioned, activeCutNo, elapsedInActive])

  // 좌측 컷 목록을 클릭하면 activeCutNo가 바뀌는데, 그 컷이 지금 스크롤 뷰포트 밖에 있으면
  // 재생 위치(playhead)는 이동해도 화면엔 안 보여서 "눌러도 아무 반응 없다"처럼 느껴졌다
  // (2026-09-13, 사용자 지적: "체크업 탭 이동 경로 수정 필요"). 클릭한 컷의 타임라인 위치로
  // 가로 스크롤을 자동으로 맞춰준다.
  useEffect(() => {
    if (activeCutNo == null) return
    const hit = positioned.find(it => it.sourceCutNo === activeCutNo)
    const strip = stripRef.current
    if (!hit || !strip) return
    const clipStartPx = hit.start * pxPerSec
    const clipEndPx = (hit.start + hit.dur) * pxPerSec
    const viewLeft = strip.scrollLeft
    const viewRight = viewLeft + strip.clientWidth
    // 이미 보이는 범위 안이면 스크롤을 건드리지 않음(불필요한 점프 방지)
    if (clipStartPx >= viewLeft && clipEndPx <= viewRight) return
    strip.scrollTo({ left: Math.max(0, clipStartPx - strip.clientWidth * 0.2), behavior: 'smooth' })
  }, [activeCutNo, positioned, pxPerSec])

  const selectedClip = clips.find(c => c.clipId === selectedClipId) || null
  const canSplit = !!(selectedClip && activeCutNo === selectedClip.sourceCutNo &&
    elapsedInActive > selectedClip.trimInSec + MIN_CLIP_SEC &&
    elapsedInActive < selectedClip.trimOutSec - MIN_CLIP_SEC)

  const selectClip = useCallback((clip) => {
    setSelectedClipId(clip.clipId)
    onSelectCut?.(clip.sourceCutNo)
  }, [onSelectCut])

  const handleStripClick = (e) => {
    if (dragMovedRef.current) { dragMovedRef.current = false; return }
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect) return
    const xSec = (e.clientX - rect.left) / pxPerSec
    const hit = positioned.find(it => xSec >= it.start && xSec < it.start + it.dur)
    if (!hit) return
    selectClip(hit)
    onSeek?.(hit.sourceCutNo, hit.trimInSec + (xSec - hit.start))
  }

  // ── 트림(좌/우 끝 드래그) ──────────────────────────────────────────
  const startTrim = (e, clipId, edge) => {
    e.stopPropagation()
    e.preventDefault()
    const preDrag = cloneClips(latestClipsRef.current)
    const clip = preDrag.find(c => c.clipId === clipId)
    if (!clip) return
    const maxDur = cutsByNo?.[clip.sourceCutNo]?.actualDurationSec ?? (clip.trimOutSec + 9999)
    const startX = e.clientX
    const startIn = clip.trimInSec
    const startOut = clip.trimOutSec
    const onMove = (ev) => {
      dragMovedRef.current = true
      const deltaSec = (ev.clientX - startX) / pxPerSec
      setClips(prev => prev.map(c => {
        if (c.clipId !== clipId) return c
        if (edge === 'L') return { ...c, trimInSec: clamp(startIn + deltaSec, 0, c.trimOutSec - MIN_CLIP_SEC) }
        return { ...c, trimOutSec: clamp(startOut + deltaSec, c.trimInSec + MIN_CLIP_SEC, maxDur) }
      }))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      pushUndo(preDrag)
      scheduleSave(latestClipsRef.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── 드래그 재배치(이웃 중간 지점을 넘으면 자리 교체) ──────────────────
  const startMove = (e, clipId) => {
    e.preventDefault()
    const preDrag = cloneClips(latestClipsRef.current)
    let index = preDrag.findIndex(c => c.clipId === clipId)
    if (index < 0) return
    let accumDx = 0
    let lastX = e.clientX
    const onMove = (ev) => {
      const dx = ev.clientX - lastX
      lastX = ev.clientX
      accumDx += dx
      if (Math.abs(accumDx) > 3) dragMovedRef.current = true
      setClips(prev => {
        const arr = prev.slice()
        const durOf = (c) => c.trimOutSec - c.trimInSec
        if (accumDx > 0 && index < arr.length - 1) {
          const neighborPx = durOf(arr[index + 1]) * pxPerSec
          if (accumDx > neighborPx / 2) {
            ;[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]
            index += 1
            accumDx -= neighborPx
          }
        } else if (accumDx < 0 && index > 0) {
          const neighborPx = durOf(arr[index - 1]) * pxPerSec
          if (-accumDx > neighborPx / 2) {
            ;[arr[index], arr[index - 1]] = [arr[index - 1], arr[index]]
            index -= 1
            accumDx += neighborPx
          }
        }
        return arr.map((c, i) => ({ ...c, order: i }))
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (dragMovedRef.current) {
        pushUndo(preDrag)
        scheduleSave(latestClipsRef.current)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── 분할 ──────────────────────────────────────────────────────────
  const splitAtPlayhead = useCallback(() => {
    if (!selectedClip) return
    if (activeCutNo !== selectedClip.sourceCutNo) return
    const t = elapsedInActive
    if (!(t > selectedClip.trimInSec + MIN_CLIP_SEC && t < selectedClip.trimOutSec - MIN_CLIP_SEC)) return
    commit(prev => {
      const idx = prev.findIndex(c => c.clipId === selectedClip.clipId)
      if (idx === -1) return prev
      const original = prev[idx]
      const a = { ...original, trimOutSec: t }
      const b = { ...original, clipId: `${original.clipId}-${Date.now().toString(36)}`, trimInSec: t }
      const arr = prev.slice()
      arr.splice(idx, 1, a, b)
      return arr.map((c, i) => ({ ...c, order: i }))
    })
  }, [selectedClip, activeCutNo, elapsedInActive, commit])

  // ── 삭제(선택 클립 제거) ──────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    if (!selectedClip) return
    const targetId = selectedClip.clipId
    commit(prev => prev.filter(c => c.clipId !== targetId).map((c, i) => ({ ...c, order: i })))
    setSelectedClipId(null)
    onSelectCut?.(null)
  }, [selectedClip, commit, onSelectCut])

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z' && e.shiftKey) { e.preventDefault(); redo() }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo() }
      else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo() }
      else if (k === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) { splitAtPlayhead() }
      else if ((k === 'delete' || k === 'backspace') && selectedClip) { e.preventDefault(); deleteSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, splitAtPlayhead, deleteSelected, selectedClip])

  const zoomIn = () => setPxPerSec(p => clamp(p * 1.25, PX_PER_SEC_RANGE[0], PX_PER_SEC_RANGE[1]))
  const zoomOut = () => setPxPerSec(p => clamp(p / 1.25, PX_PER_SEC_RANGE[0], PX_PER_SEC_RANGE[1]))
  const zoomToFit = () => {
    const w = stripRef.current?.clientWidth || 800
    setPxPerSec(clamp(w / totalSec, PX_PER_SEC_RANGE[0], PX_PER_SEC_RANGE[1]))
  }

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className={s.toolbarGroup}>
          <button className={s.iconBtn} onClick={undo} disabled={!undoStack.length} title="실행취소 (Ctrl+Z)">↩</button>
          <button className={s.iconBtn} onClick={redo} disabled={!redoStack.length} title="재실행 (Ctrl+Shift+Z)">↪</button>
          <span className={s.divider} />
          <button className={s.iconBtn} onClick={splitAtPlayhead} disabled={!canSplit} title="선택한 클립을 재생헤드 위치에서 분할 (단축키 S)">✂</button>
          <button className={s.iconBtn} onClick={deleteSelected} disabled={!selectedClip} title="선택한 클립 삭제 (Delete)">🗑</button>
        </div>
        <span className={s.spacer} />
        {saving && <span className={s.savingDot}>저장 중…</span>}
        <div className={s.toolbarGroup}>
          <button className={s.iconBtn} onClick={zoomOut} disabled={pxPerSec <= PX_PER_SEC_RANGE[0]} title="축소">🔍−</button>
          <input type="range" className={s.zoomSlider} min={PX_PER_SEC_RANGE[0]} max={PX_PER_SEC_RANGE[1]}
            value={pxPerSec} onChange={e => setPxPerSec(Number(e.target.value))} title="줌" />
          <button className={s.iconBtn} onClick={zoomIn} disabled={pxPerSec >= PX_PER_SEC_RANGE[1]} title="확대">🔍+</button>
          <button className={s.iconBtn} onClick={zoomToFit} title="화면에 맞춤">⛶</button>
        </div>
      </div>

      {!clips.length && !loading && <div className={s.emptyMsg}>완성된 컷이 없어 편집할 클립이 없습니다.</div>}

      {!!clips.length && (
        <div className={s.stripOuter} ref={stripRef} onClick={handleStripClick}>
          <div className={s.stripInner} style={{ width: `${totalSec * pxPerSec}px` }}>
            <div className={s.ruler}>
              {rulerTicks.map(t => (
                <div key={t} className={s.rulerTick} style={{ left: `${t * pxPerSec}px` }}>
                  <span className={s.rulerLabel}>{fmtTime(t)}</span>
                </div>
              ))}
            </div>
            <div className={s.clipsRow}>
              {positioned.map(it => {
                const info = cutsByNo?.[it.sourceCutNo] || {}
                const isActive = activeCutNo === it.sourceCutNo && elapsedInActive >= it.trimInSec && elapsedInActive < it.trimOutSec + 0.05
                const widthPx = it.dur * pxPerSec
                return (
                  <div key={it.clipId}
                    className={`${s.clip} ${it.clipId === selectedClipId ? s.selected : ''} ${isActive ? s.activeClip : ''}`}
                    style={{ left: `${it.start * pxPerSec}px`, width: `${widthPx}px` }}
                    onMouseDown={(e) => { selectClip(it); startMove(e, it.clipId) }}
                    title={`CUT ${it.sourceCutNo} · ${it.trimInSec.toFixed(1)}s~${it.trimOutSec.toFixed(1)}s`}>
                    <FilmstripThumbs frames={filmstrips[it.sourceCutNo]} trimInSec={it.trimInSec} trimOutSec={it.trimOutSec}
                      sourceDurationSec={info.actualDurationSec} fallbackImage={info.startFrame} />
                    <span className={s.clipLabel}>CUT {it.sourceCutNo}</span>
                    <div className={`${s.trimHandle} ${s.trimHandleL}`} onMouseDown={(e) => startTrim(e, it.clipId, 'L')} />
                    <div className={`${s.trimHandle} ${s.trimHandleR}`} onMouseDown={(e) => startTrim(e, it.clipId, 'R')} />
                  </div>
                )
              })}
            </div>
            {/* 오디오 파형 — 클립 썸네일과 겹치면 안 보인다는 피드백으로 별도 라인으로 분리,
                컷 경계마다 배경을 교차시켜(보라/청록 틴트) 구분되게 함(2026-09-13) */}
            <div className={s.waveRow}>
              {positioned.map((it, idx) => {
                const info = cutsByNo?.[it.sourceCutNo] || {}
                const widthPx = it.dur * pxPerSec
                return (
                  <div key={it.clipId}
                    className={`${s.waveBlock} ${idx % 2 ? s.waveBlockOdd : ''} ${it.clipId === selectedClipId ? s.waveBlockSelected : ''}`}
                    style={{ left: `${it.start * pxPerSec}px`, width: `${widthPx}px` }}>
                    <WaveformCanvas peaks={waveforms[it.sourceCutNo]} trimInSec={it.trimInSec} trimOutSec={it.trimOutSec}
                      sourceDurationSec={info.actualDurationSec} widthPx={widthPx} heightPx={34} />
                  </div>
                )
              })}
            </div>
            {playheadSec != null && <div className={s.playhead} style={{ left: `${playheadSec * pxPerSec}px` }} />}
          </div>
        </div>
      )}
    </div>
  )
}
