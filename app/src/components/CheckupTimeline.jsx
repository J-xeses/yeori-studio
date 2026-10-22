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
export default function CheckupTimeline({ epNum, cutsByNo, subtitleSegmentsByNo, activeCutNo, elapsedInActive, onSeek, onSelectCut, onDurationCommit, onDurationCommitUndo, onCaptionSegCommit, onEditingChange }) {
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
  // 트림/재배치 드래그 중엔 뒤 클립들이 실시간으로 밀리면서 positioned가 매 프레임
  // 재계산되는데, 재생 바늘 위치도 그 positioned를 따라 계산되다 보니 편집 중인 클립이
  // 아니어도 같이 흔들렸다(2026-10-14, 성준님 지적: "재생 바늘은 컷 편집시, 움직이지
  // 말아야 한다"). 드래그가 끝날 때까지 드래그 시작 시점의 바늘 위치로 고정한다.
  const [isDragging, setIsDragging] = useState(false)
  const frozenPlayheadRef = useRef(null)
  // 트림 커밋(실제 ffmpeg 재인코딩) 진행 중인 클립 — 끝날 때까지 해당 클립에 "반영 중…" 표시.
  const [committingClipId, setCommittingClipId] = useState(null)
  // 트림 드래그 중 "잘려 나갈 구간" 어둡게 표시 + 시간 표시(2026-10-22 4차 보완 — 11번 추가
  // 요청: "자르는 위치 표시(시간계산 포함) — 표시 기준으로 잘라야 할 구간 살짝 어둡게").
  const [trimPreview, setTrimPreview] = useState(null) // { clipId, edge, orig }
  // 자막 세그먼트 드래그 중 로컬 미리보기(2026-10-14, 성준님 요청: "자막도 자르는 기능") —
  // subtitleSegmentsByNo는 부모(state.cuts) 기반 props라 직접 못 바꾸므로, 드래그 중엔 이
  // 로컬 state로 그 컷 하나만 덮어써서 즉각적인 시각 피드백을 주고, 손을 떼면
  // onCaptionSegCommit으로 실제 반영(cut.captionSegTiming)한다. 세그먼트 각각 독립적으로
  // 늘리거나 줄일 수 있고(이웃과 안 맞물림 — 자막 사이 공백은 정상), 중간에 새 분할점을
  // 만드는 기능은 없다(성준님: "중간구간 자르기는... 지금은 적용하지 말기로 하자").
  const [captionDrag, setCaptionDrag] = useState(null) // { cutNo, segs }

  useEffect(() => { latestClipsRef.current = clips }, [clips])

  // staleInfo: 저장된 편집본이 지금 실제 컷 파일들과 어긋났는지 — 2026-10-10, LF_T01 실측
  // (9/15 저장 스냅샷이 23컷 중 13개를 빼먹고 길이도 그때 그대로라 타임라인이 실제 내용과
  // 안 맞아 보이던 신고의 원인). 서버가 매 GET마다 계산해서 내려준다.
  const [staleInfo, setStaleInfo] = useState(null)
  const load = useCallback(async (force = false) => {
    if (epNum == null) return
    setLoading(true)
    try {
      const r = await fetch(`${SERVER}/api/checkup-timeline?epNum=${epNum}${force ? '&force=1' : ''}`)
      const d = await r.json()
      setClips((d.clips || []).slice().sort((a, b) => a.order - b.order))
      setStaleInfo(d.stale ? { missingCuts: d.missingCuts || [], durDriftCuts: d.durDriftCuts || [], updatedAt: d.updatedAt } : null)
      setUndoStack([])
      setUndoMetaStack([])
      setRedoStack([])
    } catch {
      // 조용히 무시 — 참고용 미리보기 레이어
    } finally {
      setLoading(false)
    }
  }, [epNum])
  useEffect(() => { load() }, [load])
  const rebuildFromCurrent = useCallback(() => load(true), [load])

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

  // undoMetaStack: undoStack과 같은 인덱스로 나란히 쌓는다 — 그 단계가 실제 cut_NN.mp4까지
  // 커밋한 트림이었으면 {cutNo}를, 미리보기 전용 편집(재배치/분할/삭제)이었으면 null을 넣는다.
  // 실제 파일 백업은 cut_NN_prev.mp4 슬롯 하나뿐(누적 안 됨)이라, 실행취소가 실제 파일까지
  // 되돌릴 수 있는 건 "가장 최근 트림 커밋 1단계"뿐이다(2026-10-14, 성준님 요청).
  const [undoMetaStack, setUndoMetaStack] = useState([])
  const pushUndo = useCallback((snapshot, meta = null) => {
    setUndoStack(prev => [...prev.slice(-29), snapshot])
    setUndoMetaStack(prev => [...prev.slice(-29), meta])
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

  const undo = useCallback(async () => {
    if (!undoStack.length) return
    const snapshot = undoStack[undoStack.length - 1]
    const meta = undoMetaStack[undoMetaStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setUndoMetaStack(prev => prev.slice(0, -1))
    setRedoStack(prev => [...prev.slice(-29), latestClipsRef.current])
    setClips(snapshot)
    scheduleSave(snapshot)
    // 그 단계가 실제 파일까지 트림한 거였으면 백업(_manual_work/cut_NN_prev.mp4)에서 같이
    // 복구 — 백업은 한 슬롯뿐이라 더 이전 단계를 undo할 땐 실제 파일 복구는 안 됨(조용히 무시).
    if (meta?.cutNo != null && onDurationCommitUndo) {
      try { await onDurationCommitUndo(meta.cutNo) } catch { /* 백업 없음 등 — 미리보기만 되돌림 */ }
    }
  }, [undoStack, undoMetaStack, scheduleSave, onDurationCommitUndo])

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
  // 드래그 중엔 고정값, 드래그가 아니면 실시간 값 — 드래그 시작/종료는 startTrim/startMove에서 관리.
  const displayPlayheadSec = isDragging ? frozenPlayheadRef.current : playheadSec

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
  // 드래그 중 실시간 트림 값 — trimPreview(state)와 같은 값이지만, mouseup 핸들러가 React
  // state 업데이트를 기다리지 않고 "방금 그 값"을 바로 읽으려고 ref로도 따로 들고 있는다.
  const trimLiveRef = useRef(null)
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
    frozenPlayheadRef.current = playheadSec
    setIsDragging(true)
    // 2026-10-22 4차 보완 버그수정: "컷 편집시 멈춤 안됨" 재신고 — 재생 바늘 위치는 이전에
    // 고정했지만(frozenPlayheadRef), 실제 <video> 재생 자체는 CheckupTab 쪽이라 여기선 멈출
    // 수단이 없었다. 부모에 알려서 편집 시작 시 비디오를 일시정지하게 한다.
    onEditingChange?.(true)
    const origVal = edge === 'L' ? startIn : startOut
    trimLiveRef.current = origVal
    setTrimPreview({ clipId, edge, orig: origVal, cur: origVal })
    // 2026-10-22 재점검(성준님: "컷 라인 길이 유지된 채, 자르려는 부분 어둡게 표시되어야
    // 함 → 자른 뒤 길이 축소!") — 드래그 중엔 clips(실제 폭·이웃 배치의 근거)를 전혀
    // 건드리지 않는다. trimPreview/trimLiveRef에만 진행값을 쌓아 어둡게 칠할 구간과 시간
    // 라벨을 그리고, 실제 길이 변경(폭 축소 + 이웃 재배치)은 손을 뗀 뒤(onUp) 한 번에 반영한다.
    const onMove = (ev) => {
      dragMovedRef.current = true
      const deltaSec = (ev.clientX - startX) / pxPerSec
      const next = edge === 'L'
        ? clamp(startIn + deltaSec, 0, startOut - MIN_CLIP_SEC)
        : clamp(startOut + deltaSec, startIn + MIN_CLIP_SEC, maxDur)
      trimLiveRef.current = next
      setTrimPreview(p => (p && p.clipId === clipId ? { ...p, cur: next } : p))
    }
    const onUp = async () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setIsDragging(false)
      onEditingChange?.(false)
      setTrimPreview(null)
      const finalVal = trimLiveRef.current
      trimLiveRef.current = null
      // 여기서 처음으로 clips에 실제 반영 — 폭이 줄어들고 뒤 클립들이 그만큼 당겨진다.
      const after = preDrag.map(c => c.clipId === clipId
        ? (edge === 'L' ? { ...c, trimInSec: finalVal } : { ...c, trimOutSec: finalVal })
        : c)
      setClips(after)
      // 좌우 트림 모두 실제 cut_NN.mp4 파일 자체를 다시 잘라 반영한다(2026-10-14 재설계 —
      // cut.duration만 바꾸는 방식은 finalizeReel이 파일 실측 길이로 항상 덮어써서 실제
      // 발행 영상엔 전혀 반영이 안 됐던 걸 발견). 분할 안 된 컷(이 클립 하나가 그 컷 전체를
      // 대표)일 때만 커밋 — 분할된 조각은 여전히 미리보기 전용(파일 하나를 조각낼 방법이
      // 아직 없음).
      const updated = after.find(c => c.clipId === clipId)
      const siblingCount = after.filter(c => c.sourceCutNo === updated?.sourceCutNo).length
      const changed = edge === 'L' ? Math.abs(updated.trimInSec - startIn) > 0.05 : Math.abs(updated.trimOutSec - startOut) > 0.05
      if (updated && siblingCount === 1 && changed && onDurationCommit) {
        setCommittingClipId(clipId)
        try {
          const actualDur = await onDurationCommit(updated.sourceCutNo, updated.trimInSec, updated.trimOutSec)
          // 파일이 [0, actualDur]로 다시 만들어졌으므로 이 클립 하나만 그 틀에 맞춘다 — 전체
          // rebuildFromCurrent(force)를 부르면 다른 컷들의 순서/분할까지 통째로 날아간다.
          const patched = after.map(c => c.clipId === clipId ? { ...c, trimInSec: 0, trimOutSec: actualDur ?? (updated.trimOutSec - updated.trimInSec) } : c)
          setClips(patched)
          scheduleSave(patched)
          // 실제 파일 커밋이 일어난 뒤에야 undo 스택에 넣는다(undo 시 실제 파일도 같이
          // 복구해야 하므로 meta에 cutNo를 함께 기록).
          pushUndo(preDrag, { cutNo: updated.sourceCutNo })
        } finally {
          setCommittingClipId(null)
        }
      } else {
        pushUndo(preDrag)
        scheduleSave(after)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── 자막 세그먼트 트림(좌/우 끝) ───────────────────────────────────
  const startCaptionTrim = (e, cutNo, segIndex, edge, cutDur, widthPx) => {
    e.stopPropagation()
    e.preventDefault()
    const baseSegs = (subtitleSegmentsByNo?.[cutNo] || []).map(s => ({ ...s }))
    const startSeg = baseSegs[segIndex]
    if (!startSeg) return
    const startX = e.clientX
    const startStart = startSeg.start
    const startEnd = startSeg.end
    setCaptionDrag({ cutNo, segs: baseSegs })
    onEditingChange?.(true)
    const onMove = (ev) => {
      const deltaSec = ((ev.clientX - startX) / widthPx) * cutDur
      setCaptionDrag(prev => {
        if (!prev || prev.cutNo !== cutNo) return prev
        const next = prev.segs.map((s, i) => {
          if (i !== segIndex) return s
          if (edge === 'L') return { ...s, start: clamp(startStart + deltaSec, 0, s.end - MIN_CLIP_SEC) }
          return { ...s, end: clamp(startEnd + deltaSec, s.start + MIN_CLIP_SEC, cutDur) }
        })
        return { cutNo, segs: next }
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onEditingChange?.(false)
      setCaptionDrag(curr => {
        if (curr && curr.cutNo === cutNo) onCaptionSegCommit?.(cutNo, curr.segs)
        return null
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── 자막 세그먼트 "위치 이동"(양끝 트림이 아니라 길이 그대로 통째로 좌우 이동) ──────
  // 2026-10-22 4차 보완 — "자막 바 위치 이동 기능 아직 미반영" 신고. startCaptionTrim은
  // 양 끝만 늘리고 줄이는 거라 바 전체를 좌우로 옮기는 방법이 없었다 — 길이(segDur)는
  // 고정한 채 start/end를 같은 양만큼 이동시킨다.
  const startCaptionMove = (e, cutNo, segIndex, cutDur, widthPx) => {
    e.stopPropagation()
    e.preventDefault()
    const baseSegs = (subtitleSegmentsByNo?.[cutNo] || []).map(s => ({ ...s }))
    const seg = baseSegs[segIndex]
    if (!seg) return
    const segDur = seg.end - seg.start
    const startX = e.clientX
    const startStart = seg.start
    setCaptionDrag({ cutNo, segs: baseSegs })
    onEditingChange?.(true)
    const onMove = (ev) => {
      const deltaSec = ((ev.clientX - startX) / widthPx) * cutDur
      setCaptionDrag(prev => {
        if (!prev || prev.cutNo !== cutNo) return prev
        const next = prev.segs.map((s, i) => {
          if (i !== segIndex) return s
          const newStart = clamp(startStart + deltaSec, 0, Math.max(0, cutDur - segDur))
          return { ...s, start: newStart, end: newStart + segDur }
        })
        return { cutNo, segs: next }
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onEditingChange?.(false)
      setCaptionDrag(curr => {
        if (curr && curr.cutNo === cutNo) onCaptionSegCommit?.(cutNo, curr.segs)
        return null
      })
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
    frozenPlayheadRef.current = playheadSec
    setIsDragging(true)
    onEditingChange?.(true)
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
      setIsDragging(false)
      onEditingChange?.(false)
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

  // 2026-10-22 4차 보완 — 타임라인 아이콘 추가요청 4건 반영.
  // ① 클립 복제 — 같은 컷을 바로 뒤에 한 번 더 배치(반복 연출 등).
  const duplicateSelected = useCallback(() => {
    if (!selectedClip) return
    commit(prev => {
      const idx = prev.findIndex(c => c.clipId === selectedClip.clipId)
      if (idx === -1) return prev
      const copy = { ...prev[idx], clipId: `${prev[idx].clipId}-dup${Date.now().toString(36)}` }
      const arr = prev.slice()
      arr.splice(idx + 1, 0, copy)
      return arr.map((c, i) => ({ ...c, order: i }))
    })
  }, [selectedClip, commit])

  // ② 선택 컷 트림 초기화 — 전체 Undo 스택과 무관하게, 이 클립 하나만 실제 파일 백업
  // (_manual_work/cut_NN_prev.mp4, 한 슬롯)에서 복구해 원래 길이로 되돌린다. 백업이 없으면
  // (한 번도 트림한 적 없는 컷 등) 조용히 실패 — 되돌릴 게 없다는 뜻.
  const resetSelectedTrim = useCallback(async () => {
    if (!selectedClip || !onDurationCommitUndo) return
    const { clipId, sourceCutNo } = selectedClip
    setCommittingClipId(clipId)
    try {
      const restoredDur = await onDurationCommitUndo(sourceCutNo)
      commit(prev => prev.map(c => c.clipId === clipId
        ? { ...c, trimInSec: 0, trimOutSec: restoredDur ?? c.trimOutSec }
        : c))
    } catch {
      // 백업 없음 — 복구할 원본이 없다는 뜻, 조용히 무시
    } finally {
      setCommittingClipId(null)
    }
  }, [selectedClip, onDurationCommitUndo, commit])

  // ③ 자막 트랙 표시/숨김
  const [subtitleTrackVisible, setSubtitleTrackVisible] = useState(true)

  // ④ 다음/이전 컷 경계로 재생헤드 점프(←/→)
  const jumpToBoundary = useCallback((dir) => {
    if (!positioned.length) return
    const cur = positioned.find(it => it.sourceCutNo === activeCutNo && elapsedInActive >= it.trimInSec && elapsedInActive < it.trimOutSec + 0.05)
    const curAbs = cur ? cur.start + (elapsedInActive - cur.trimInSec) : 0
    const boundaries = positioned.map(it => it.start)
    const last = positioned[positioned.length - 1]
    if (last) boundaries.push(last.start + last.dur)
    const target = dir > 0
      ? boundaries.find(b => b > curAbs + 0.05)
      : [...boundaries].reverse().find(b => b < curAbs - 0.05)
    if (target == null) return
    const hit = positioned.find(it => target >= it.start && target < it.start + it.dur) || last
    if (!hit) return
    onSeek?.(hit.sourceCutNo, Math.max(0, Math.min(hit.trimInSec + (target - hit.start), hit.trimOutSec)))
  }, [positioned, activeCutNo, elapsedInActive, onSeek])

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
      else if (k === 'arrowright' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); jumpToBoundary(1) }
      else if (k === 'arrowleft' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); jumpToBoundary(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, splitAtPlayhead, deleteSelected, selectedClip, jumpToBoundary])

  const zoomIn = () => setPxPerSec(p => clamp(p * 1.25, PX_PER_SEC_RANGE[0], PX_PER_SEC_RANGE[1]))
  const zoomOut = () => setPxPerSec(p => clamp(p / 1.25, PX_PER_SEC_RANGE[0], PX_PER_SEC_RANGE[1]))
  const zoomToFit = () => {
    const w = stripRef.current?.clientWidth || 800
    setPxPerSec(clamp(w / totalSec, PX_PER_SEC_RANGE[0], PX_PER_SEC_RANGE[1]))
  }

  return (
    <div className={s.wrap}>
      {staleInfo && (
        <div className={s.staleBanner}>
          <span>
            ⚠️ 저장된 편집본({staleInfo.updatedAt ? new Date(staleInfo.updatedAt).toLocaleDateString('ko-KR') : '?'})이 지금 컷 파일과 어긋났습니다
            {staleInfo.missingCuts.length > 0 && ` — 누락된 컷 ${staleInfo.missingCuts.join(',')}`}
            {staleInfo.durDriftCuts.length > 0 && ` · 길이 어긋난 컷 ${staleInfo.durDriftCuts.join(',')}`}
            . 타임라인 위치가 실제 영상과 안 맞게 보일 수 있습니다.
          </span>
          <button className={s.staleRebuildBtn} onClick={rebuildFromCurrent} disabled={loading}>
            🔄 지금 컷 기준으로 새로 생성
          </button>
        </div>
      )}
      <div className={s.toolbar}>
        <div className={s.toolbarGroup}>
          <button className={s.iconBtn} onClick={undo} disabled={!undoStack.length} title="실행취소 (Ctrl+Z)">↩</button>
          <button className={s.iconBtn} onClick={redo} disabled={!redoStack.length} title="재실행 (Ctrl+Shift+Z)">↪</button>
          <span className={s.divider} />
          <button className={s.iconBtn} onClick={splitAtPlayhead} disabled={!canSplit} title="선택한 클립을 재생헤드 위치에서 분할 (단축키 S)">✂</button>
          <button className={s.iconBtn} onClick={deleteSelected} disabled={!selectedClip} title="선택한 클립 삭제 (Delete)">🗑</button>
          <button className={s.iconBtn} onClick={duplicateSelected} disabled={!selectedClip} title="선택한 클립 복제(바로 뒤에 추가)">⧉</button>
          <button className={s.iconBtn} onClick={resetSelectedTrim} disabled={!selectedClip || !onDurationCommitUndo} title="선택한 클립의 트림을 원래 길이로 초기화(백업이 있을 때만)">⟲</button>
          <span className={s.divider} />
          <button className={s.iconBtn} onClick={() => jumpToBoundary(-1)} disabled={!positioned.length} title="이전 컷 경계로 (←)">⏮</button>
          <button className={s.iconBtn} onClick={() => jumpToBoundary(1)} disabled={!positioned.length} title="다음 컷 경계로 (→)">⏭</button>
          <button className={`${s.iconBtn} ${subtitleTrackVisible ? s.active : ''}`} onClick={() => setSubtitleTrackVisible(v => !v)} title="자막 트랙 표시/숨김">💬</button>
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
                    {it.clipId === committingClipId && <span className={s.clipCommitting}>반영 중…</span>}
                    {trimPreview?.clipId === it.clipId && (() => {
                      // it.trimInSec/trimOutSec은 드래그 중엔 그대로(폭 고정) — 진행 중인 값은
                      // trimPreview.cur에서 읽는다(성준님: "컷 라인 길이 유지된 채, 자르려는
                      // 부분 어둡게 표시 → 자른 뒤 길이 축소").
                      const removedSec = trimPreview.edge === 'L'
                        ? Math.max(0, trimPreview.cur - trimPreview.orig)
                        : Math.max(0, trimPreview.orig - trimPreview.cur)
                      if (removedSec <= 0) return null
                      const removedPx = removedSec * pxPerSec
                      const remainingSec = Math.max(0, it.dur - removedSec)
                      return (
                        <>
                          <div className={s.trimShadow}
                            style={trimPreview.edge === 'L' ? { left: 0, width: removedPx } : { right: 0, width: removedPx }} />
                          <div className={s.trimTimeLabel} style={trimPreview.edge === 'L' ? { left: 4 } : { right: 4 }}>
                            −{removedSec.toFixed(1)}s (남음 {remainingSec.toFixed(1)}s)
                          </div>
                        </>
                      )
                    })()}
                    <div className={`${s.trimHandle} ${s.trimHandleL}`} onMouseDown={(e) => startTrim(e, it.clipId, 'L')}
                      title="시작점 트림 — 분할 안 된 컷이면 끝났을 때 실제 영상 파일을 다시 잘라 반영합니다(앞부분 버림)" />
                    <div className={`${s.trimHandle} ${s.trimHandleR}`} onMouseDown={(e) => startTrim(e, it.clipId, 'R')}
                      title="길이 조절 — 분할 안 된 컷이면 끝났을 때 실제 영상 파일을 다시 잘라 반영합니다(뒷부분 버림)" />
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
            {/* 자막 트랙(2026-10-14) — CUT별 실제 번인 자막(cut.subtitle=CP, finalizeReel이 직접
                읽는 필드)을 그 컷의 편집 길이 기준 비율로 클립 폭 안에 배치. 각 세그먼트 양끝을
                드래그해 시작/끝을 늘리거나 줄일 수 있다(성준님 요청) — commitCaptionSegTiming이
                cut.captionSegTiming에 그대로 써서 실제 최종본에 반영됨(파일 재인코딩 불필요,
                메타데이터만으로 충분). 세그먼트 사이 새 분할점을 만드는 기능은 없음(성준님:
                "중간구간 자르기는 지금은 적용하지 말기로 하자") — 세그먼트 개수는 cut.subtitle의
                "/" 구분 그대로, 끝점 이동만 가능. */}
            {subtitleTrackVisible && <div className={s.subtitleRow}>
              {positioned.map((it) => {
                const info = cutsByNo?.[it.sourceCutNo] || {}
                const isDraggingThis = captionDrag?.cutNo === it.sourceCutNo
                const segs = isDraggingThis ? captionDrag.segs : (subtitleSegmentsByNo?.[it.sourceCutNo] || [])
                const cutDur = info.duration || (it.trimOutSec - it.trimInSec) || 1
                const widthPx = it.dur * pxPerSec
                return (
                  <div key={it.clipId} className={s.subtitleBlock} style={{ left: `${it.start * pxPerSec}px`, width: `${widthPx}px` }}>
                    {segs.filter(seg => seg.text).map((seg, i) => {
                      const segLeftPx = clamp((seg.start / cutDur) * widthPx, 0, widthPx)
                      const segWidthPx = Math.max(10, Math.min(widthPx - segLeftPx, ((seg.end - seg.start) / cutDur) * widthPx))
                      return (
                        <span key={i} className={s.subtitleSeg}
                          style={{ left: `${segLeftPx}px`, width: `${segWidthPx}px` }}
                          title={`${seg.text} · ${seg.start.toFixed(1)}s~${seg.end.toFixed(1)}s — 가운데를 끌면 통째로 이동`}
                          onMouseDown={(e) => startCaptionMove(e, it.sourceCutNo, i, cutDur, widthPx)}>
                          {seg.text}
                          <span className={s.subtitleHandle} style={{ left: 0 }}
                            onMouseDown={(e) => startCaptionTrim(e, it.sourceCutNo, i, 'L', cutDur, widthPx)} />
                          <span className={s.subtitleHandle} style={{ right: 0, left: 'auto' }}
                            onMouseDown={(e) => startCaptionTrim(e, it.sourceCutNo, i, 'R', cutDur, widthPx)} />
                        </span>
                      )
                    })}
                  </div>
                )
              })}
            </div>}
            {displayPlayheadSec != null && <div className={s.playhead} style={{ left: `${displayPlayheadSec * pxPerSec}px` }} />}
          </div>
        </div>
      )}
    </div>
  )
}
