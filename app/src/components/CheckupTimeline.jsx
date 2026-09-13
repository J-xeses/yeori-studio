import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import s from './CheckupTimeline.module.css'

const SERVER = 'http://localhost:3001'
const MIN_CLIP_SEC = 0.2
const DEFAULT_PX_PER_SEC = 50
const PX_PER_SEC_RANGE = [10, 300]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const cloneClips = (clips) => clips.map(c => ({ ...c }))

// 체크업 탭 "🎬 타임라인 편집"(Tier3, 2026-09-13) — 분할/트림/드래그 재배치/줌/실행취소를 지원하는
// 미리보기 전용 편집 타임라인. run-cutter.js/editMeta.json(cutNo 1:1, 실제 CapCut 배치용)은
// 전혀 건드리지 않고, 완전히 분리된 yeori_checkup_timeline.json(서버 /api/checkup-timeline)에만
// 저장한다 — 분할된 두 조각도 같은 sourceCutNo를 공유해서 cutNo 1:1 가정을 깨지 않는다.
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
  const [undoStack, setUndoStack] = useState([])   // 로컬 실행취소 이력 — AppContext/저장소에 절대 안 들어감
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
    } catch {
      // 조용히 무시 — 참고용 미리보기 레이어
    } finally {
      setLoading(false)
    }
  }, [epNum])
  useEffect(() => { load() }, [load])

  const pushUndo = useCallback((snapshot) => {
    setUndoStack(prev => [...prev.slice(-29), snapshot])
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
    setClips(snapshot)
    scheduleSave(snapshot)
  }, [undoStack, scheduleSave])

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

  const playheadSec = useMemo(() => {
    const hit = positioned.find(it => it.sourceCutNo === activeCutNo &&
      elapsedInActive >= it.trimInSec && elapsedInActive < it.trimOutSec + 0.05)
    if (!hit) return null
    return hit.start + Math.max(0, elapsedInActive - hit.trimInSec)
  }, [positioned, activeCutNo, elapsedInActive])

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

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) { splitAtPlayhead() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, splitAtPlayhead])

  const zoomIn = () => setPxPerSec(p => clamp(p * 1.25, PX_PER_SEC_RANGE[0], PX_PER_SEC_RANGE[1]))
  const zoomOut = () => setPxPerSec(p => clamp(p / 1.25, PX_PER_SEC_RANGE[0], PX_PER_SEC_RANGE[1]))

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <button className={s.toolbarBtn} onClick={zoomOut} disabled={pxPerSec <= PX_PER_SEC_RANGE[0]} title="축소">🔍−</button>
        <span className={s.zoomLabel}>{pxPerSec.toFixed(0)}px/s</span>
        <button className={s.toolbarBtn} onClick={zoomIn} disabled={pxPerSec >= PX_PER_SEC_RANGE[1]} title="확대">🔍+</button>
        <button className={s.toolbarBtn} onClick={splitAtPlayhead} disabled={!canSplit} title="선택한 클립을 재생헤드 위치에서 분할 (단축키 S)">✂ 분할</button>
        <button className={s.toolbarBtn} onClick={undo} disabled={!undoStack.length} title="실행취소 (Ctrl+Z)">↩ 실행취소</button>
        <span className={s.spacer} />
        {saving && <span className={s.savingDot}>저장 중…</span>}
        <span className={s.hint}>클립 본체 드래그: 순서 변경 · 좌우 끝 드래그: 자르기</span>
      </div>

      {!clips.length && !loading && <div className={s.emptyMsg}>완성된 컷이 없어 편집할 클립이 없습니다.</div>}

      {!!clips.length && (
        <div className={s.stripOuter} ref={stripRef} onClick={handleStripClick}>
          <div className={s.stripInner} style={{ width: `${totalSec * pxPerSec}px` }}>
            {positioned.map(it => {
              const info = cutsByNo?.[it.sourceCutNo] || {}
              const isActive = activeCutNo === it.sourceCutNo && elapsedInActive >= it.trimInSec && elapsedInActive < it.trimOutSec + 0.05
              return (
                <div key={it.clipId}
                  className={`${s.clip} ${it.clipId === selectedClipId ? s.selected : ''} ${isActive ? s.activeClip : ''}`}
                  style={{ left: `${it.start * pxPerSec}px`, width: `${it.dur * pxPerSec}px`, backgroundImage: info.startFrame ? `url(${info.startFrame})` : undefined }}
                  onMouseDown={(e) => { selectClip(it); startMove(e, it.clipId) }}
                  title={`CUT ${it.sourceCutNo} · ${it.trimInSec.toFixed(1)}s~${it.trimOutSec.toFixed(1)}s`}>
                  <span className={s.clipLabel}>CUT {it.sourceCutNo}</span>
                  <div className={`${s.trimHandle} ${s.trimHandleL}`} onMouseDown={(e) => startTrim(e, it.clipId, 'L')} />
                  <div className={`${s.trimHandle} ${s.trimHandleR}`} onMouseDown={(e) => startTrim(e, it.clipId, 'R')} />
                </div>
              )
            })}
            {playheadSec != null && <div className={s.playhead} style={{ left: `${playheadSec * pxPerSec}px` }} />}
          </div>
        </div>
      )}
    </div>
  )
}
