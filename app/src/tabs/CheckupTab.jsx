import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './CheckupTab.module.css'

const SERVER = 'http://localhost:3001'
const FALLBACK_DUR = 8 // duration 필드가 없는 컷의 타임라인 폭 계산용 추정치(초)

// 체크업 탭 — 메이킹/영상 탭을 거쳐 완성된 컷들을 순서대로 이어재생하며 업로드 전까지
// 수시로 검토하는 상시 도구 (2026-09-12, 사용자 요청). G5 최종 concat과는 별개 —
// 한 파일로 합치지 않고 "순서대로 배열해서 연속재생"만 한다. 완성 안 된 컷은 헤더+
// 상태만 표시(재생 시도 안 함) — /api/episode-video-checklist 의 hasVideo/videoUrl 그대로 재사용.
//
// 하단 타임라인(필름스트립) — 각 컷의 길이(duration, 추정치)에 비례한 폭으로 배열 +
// 재생헤드(현재 위치 표시, 클릭/드래그로 탐색). 여러 컷이 각각 별개 mp4 파일이라
// "진짜 하나의 타임라인"은 아니고, 폭·재생헤드 위치는 duration 추정치 기반 근사치.
export default function CheckupTab() {
  const { state } = useApp()
  const epNum = state.episode?.number
  const [cuts, setCuts] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeCutNo, setActiveCutNo] = useState(null)
  const [elapsedInActive, setElapsedInActive] = useState(0)
  const videoRef = useRef(null)
  const stripRef = useRef(null)
  const pendingSeekRef = useRef(null) // src 교체 후 loadedmetadata에서 적용할 목표 초

  const load = useCallback(async () => {
    if (epNum == null) return
    setLoading(true)
    try {
      const r = await fetch(`${SERVER}/api/episode-video-checklist?epNum=${epNum}`)
      const d = await r.json()
      setCuts((d.cuts || []).slice().sort((a, b) => a.no - b.no))
    } catch {
      // 조용히 무시 — 새로고침 버튼으로 재시도
    } finally {
      setLoading(false)
    }
  }, [epNum])

  useEffect(() => { load() }, [load])

  const playable = cuts.filter(c => c.hasVideo && c.videoUrl)
  const activeIdx = playable.findIndex(c => c.no === activeCutNo)

  // 타임라인 배치 — duration 추정치로 각 컷의 시작 오프셋·폭(비율)을 계산
  const timeline = useMemo(() => {
    const total = cuts.reduce((sum, c) => sum + (c.duration || FALLBACK_DUR), 0) || 1
    let offset = 0
    const items = cuts.map(c => {
      const dur = c.duration || FALLBACK_DUR
      const item = { cut: c, start: offset, dur, startPct: (offset / total) * 100, widthPct: (dur / total) * 100 }
      offset += dur
      return item
    })
    return { items, total }
  }, [cuts])

  const playheadPct = useMemo(() => {
    const it = timeline.items.find(x => x.cut.no === activeCutNo)
    if (!it) return null
    return ((it.start + Math.min(elapsedInActive, it.dur)) / timeline.total) * 100
  }, [timeline, activeCutNo, elapsedInActive])

  const seekTo = useCallback((cutNo, localTime) => {
    const cut = playable.find(c => c.no === cutNo)
    if (!cut || !videoRef.current) return
    const v = videoRef.current
    if (activeCutNo === cutNo && v.src === cut.videoUrl) {
      v.currentTime = localTime
      v.play().catch(() => {})
    } else {
      pendingSeekRef.current = localTime
      setActiveCutNo(cutNo)
    }
  }, [activeCutNo, playable])

  useEffect(() => {
    const cut = playable.find(c => c.no === activeCutNo)
    if (!cut || !videoRef.current) return
    const v = videoRef.current
    if (v.src !== cut.videoUrl) {
      v.src = cut.videoUrl
    }
    const applyPending = () => {
      if (pendingSeekRef.current != null) {
        v.currentTime = pendingSeekRef.current
        pendingSeekRef.current = null
      }
      v.play().catch(() => {})
    }
    if (v.readyState >= 1) applyPending()
    else v.addEventListener('loadedmetadata', applyPending, { once: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCutNo])

  const playFrom = (cutNo) => seekTo(cutNo, 0)
  const playAll = () => { if (playable.length) seekTo(playable[0].no, 0) }
  const handleEnded = () => {
    const next = playable[activeIdx + 1]
    if (next) seekTo(next.no, 0)
  }
  const handleTimeUpdate = () => {
    if (videoRef.current) setElapsedInActive(videoRef.current.currentTime)
  }

  const handleStripClick = (e) => {
    const el = stripRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const targetSec = frac * timeline.total
    const hit = timeline.items.find(it => targetSec >= it.start && targetSec < it.start + it.dur) || timeline.items[timeline.items.length - 1]
    if (!hit || !hit.cut.hasVideo) return
    seekTo(hit.cut.no, Math.max(0, targetSec - hit.start))
  }

  return (
    <div className={s.appOuter}>
      <TabToolbar />
      <div className={s.pageOuter}>
        <EpisodeInfoSidebar maxStage={0} />
        <div className={s.page}>
          <div className={s.header}>
            <div className={s.headerTitle}>
              ✅ 체크업
              <span className={s.hint}>메이킹·영상 탭에서 완성된 컷을 순서대로 이어서 검토 — 업로드 전까지 수시로</span>
            </div>
            <div className={s.headerActions}>
              <span className={s.progress}>{playable.length}/{cuts.length}컷 완성</span>
              <button className={s.refreshBtn} onClick={load} disabled={loading}>
                {loading ? '불러오는 중…' : '🔄 새로고침'}
              </button>
              <button className={s.playAllBtn} onClick={playAll} disabled={!playable.length}>
                ▶ 전체 이어보기
              </button>
            </div>
          </div>

          <div className={s.playerWrap}>
            <video ref={videoRef} controls className={s.player}
              onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} />
            {activeCutNo != null && <div className={s.nowPlaying}>재생 중: CUT {activeCutNo}</div>}
            {!playable.length && <div className={s.playerEmpty}>아직 완성된 컷이 없습니다 — 메이킹/영상 탭에서 컷을 만들면 여기 누적됩니다.</div>}
          </div>

          <div className={s.timelineWrap}>
            <div className={s.timelineStrip} ref={stripRef} onClick={handleStripClick}>
              {timeline.items.map(it => (
                <div key={it.cut.no}
                  className={`${s.tlSeg} ${it.cut.hasVideo ? s.tlDone : s.tlPending} ${activeCutNo === it.cut.no ? s.tlActive : ''}`}
                  style={{
                    left: `${it.startPct}%`, width: `${it.widthPct}%`,
                    backgroundImage: it.cut.startFrame ? `url(${it.cut.startFrame})` : undefined,
                  }}
                  title={it.cut.hasVideo ? `CUT ${it.cut.no} — 클릭해서 재생` : `CUT ${it.cut.no} — 아직 제작 안 됨`}>
                  <span className={s.tlLabel}>CUT {it.cut.no}</span>
                  {!it.cut.hasVideo && <span className={s.tlPendingDot}>⬜</span>}
                </div>
              ))}
              {playheadPct != null && (
                <div className={s.playhead} style={{ left: `${playheadPct}%` }} />
              )}
            </div>
            {!cuts.length && <div className={s.empty}>컷 정보가 없습니다.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
