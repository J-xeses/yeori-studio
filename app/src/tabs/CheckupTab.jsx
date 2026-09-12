import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../context/AppContext'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './CheckupTab.module.css'

const SERVER = 'http://localhost:3001'

// 체크업 탭 — 메이킹/영상 탭을 거쳐 완성된 컷들을 순서대로 이어재생하며 업로드 전까지
// 수시로 검토하는 상시 도구 (2026-09-12, 사용자 요청). G5 최종 concat과는 별개 —
// 한 파일로 합치지 않고 "순서대로 배열해서 연속재생"만 한다. 완성 안 된 컷은 헤더+
// 상태만 표시(재생 시도 안 함) — /api/episode-video-checklist 의 hasVideo/videoUrl 그대로 재사용.
export default function CheckupTab() {
  const { state } = useApp()
  const epNum = state.episode?.number
  const [cuts, setCuts] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeCutNo, setActiveCutNo] = useState(null)
  const videoRef = useRef(null)

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

  useEffect(() => {
    const cut = playable.find(c => c.no === activeCutNo)
    if (!cut || !videoRef.current) return
    videoRef.current.src = cut.videoUrl
    videoRef.current.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCutNo])

  const playFrom = (cutNo) => setActiveCutNo(cutNo)
  const playAll = () => { if (playable.length) setActiveCutNo(playable[0].no) }
  const handleEnded = () => {
    const next = playable[activeIdx + 1]
    if (next) setActiveCutNo(next.no)
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
            <video ref={videoRef} controls className={s.player} onEnded={handleEnded} />
            {activeCutNo != null && <div className={s.nowPlaying}>재생 중: CUT {activeCutNo}</div>}
            {!playable.length && <div className={s.playerEmpty}>아직 완성된 컷이 없습니다 — 메이킹/영상 탭에서 컷을 만들면 여기 누적됩니다.</div>}
          </div>

          <div className={s.cutStrip}>
            {cuts.map(c => (
              <button key={c.no}
                className={`${s.cutChip} ${c.hasVideo ? s.done : s.pending} ${activeCutNo === c.no ? s.active : ''}`}
                disabled={!c.hasVideo}
                onClick={() => playFrom(c.no)}
                title={c.hasVideo ? `CUT ${c.no} 재생` : `CUT ${c.no} — 아직 제작 안 됨`}>
                <span className={s.cutNo}>CUT {c.no}</span>
                <span className={s.cutStatusDot}>{c.hasVideo ? '✅' : '⬜'}</span>
              </button>
            ))}
            {!cuts.length && <div className={s.empty}>컷 정보가 없습니다.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
