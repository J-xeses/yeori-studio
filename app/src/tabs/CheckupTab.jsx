import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import TabToolbar from '../components/TabToolbar'
import CheckupTimeline from '../components/CheckupTimeline'
import CheckupSidebar from '../components/CheckupSidebar'
import { contentRatio } from '../lib/videoPolicy'
import s from './CheckupTab.module.css'

const SERVER = 'http://localhost:3001'

// 체크업 탭 — 메이킹/영상 탭을 거쳐 완성된 컷들을 순서대로 이어재생하며 업로드 전까지
// 수시로 검토·편집하는 상시 도구. 실제 편집(분할/트림/드래그 재배치/실행취소)은 전부
// CheckupTimeline(하단) 하나로 통합돼 있다 — 예전에 있던 읽기전용 필름스트립과 "배치
// 순서/간격" 카드 UI는 타임라인 안에서 그대로 할 수 있는 기능과 중복이라 삭제함
// (2026-09-13, 사용자 지적: "타임라인 안에서 구현할 수 있는데 굳이 별도로 과한 형태").
export default function CheckupTab() {
  const { state } = useApp()
  const epNum = state.episode?.number
  const [cuts, setCuts] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeCutNo, setActiveCutNo] = useState(null)
  const [elapsedInActive, setElapsedInActive] = useState(0)
  const [selectedCutNo, setSelectedCutNo] = useState(null)   // 타임라인에서 선택된 클립의 원본 컷 번호(효과 사이드바용)
  const videoRef = useRef(null)
  const pendingSeekRef = useRef(null) // src 교체 후 loadedmetadata에서 적용할 목표 초
  const ratio = contentRatio(state.episode)

  const load = useCallback(async () => {
    if (epNum == null) return
    setLoading(true)
    try {
      const r = await fetch(`${SERVER}/api/episode-video-checklist?epNum=${epNum}`)
      const d = await r.json()
      setCuts((d.cuts || []).slice().sort((a, b) => (a.order ?? a.no) - (b.order ?? b.no)))
    } catch {
      // 조용히 무시 — 새로고침 버튼으로 재시도
    } finally {
      setLoading(false)
    }
  }, [epNum])

  useEffect(() => { load() }, [load])

  const playable = cuts.filter(c => c.hasVideo && c.videoUrl)
  const activeIdx = playable.findIndex(c => c.no === activeCutNo)
  const mismatchCount = cuts.filter(c => c.lengthMismatch).length
  const cutsByNo = useMemo(() => Object.fromEntries(cuts.map(c => [c.no, c])), [cuts])

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

  const playAll = () => { if (playable.length) seekTo(playable[0].no, 0) }
  const handleEnded = () => {
    const next = playable[activeIdx + 1]
    if (next) seekTo(next.no, 0)
  }
  const handleTimeUpdate = () => {
    if (videoRef.current) setElapsedInActive(videoRef.current.currentTime)
  }

  return (
    <div className={s.appOuter}>
      <TabToolbar
        right={
          <div className={s.toolbarInfo}>
            <span className={s.toolbarTitle}>✅ 체크업</span>
            <span className={s.progress}>{playable.length}/{cuts.length}컷 완성</span>
            {mismatchCount > 0 && (
              <span className={s.warnBadge} title="대본 목표 길이보다 실제 렌더 파일이 짧은 컷 — 캡컷 배치 시 자동으로 길이가 잘립니다">
                ⚠️ 길이 보정 {mismatchCount}개
              </span>
            )}
          </div>
        }
        actions={[
          { key: 'refresh', label: loading ? '불러오는 중…' : '🔄 새로고침', onClick: load, disabled: loading },
          { key: 'play-all', label: '▶ 전체 이어보기', onClick: playAll, disabled: !playable.length, variant: 'accent' },
        ]}
      />
      <div className={s.pageOuter}>
        <CheckupSidebar cuts={state.cuts} cutsByNo={cutsByNo} selectedCutNo={selectedCutNo}
          onSelectCut={setSelectedCutNo} onSeek={seekTo} onApplied={load} />
        <div className={s.page}>
          <div className={s.mainRow}>
            {/* 라이브러리/미디어 임포트 추후반영 영역 — 목업 배치 고정(2026-09-13, 사용자 지적:
                "메인화면[플레이어]이 우측에 고정" — 카테고리별 에셋 브라우저는 나중에 여기 채움 */}
            <div className={s.futureArea}>
              <span className={s.futureAreaLabel}>추후 반영 — 효과 라이브러리 / 미디어 임포트</span>
            </div>
            <div className={s.playerWrap}>
              <div className={s.videoWrapper} style={{ aspectRatio: ratio === '9:16' ? '9/16' : '16/9' }}>
                <div className={s.videoInner}>
                  <video ref={videoRef} controls className={s.player}
                    onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} />
                </div>
              </div>
              {activeCutNo != null && <div className={s.nowPlaying}>재생 중: CUT {activeCutNo}</div>}
              {!playable.length && <div className={s.playerEmpty}>아직 완성된 컷이 없습니다 — 메이킹/영상 탭에서 컷을 만들면 여기 누적됩니다.</div>}
            </div>
          </div>

          <div className={s.timelineEditorWrap}>
            <CheckupTimeline epNum={epNum} cutsByNo={cutsByNo}
              activeCutNo={activeCutNo} elapsedInActive={elapsedInActive}
              onSeek={seekTo} onSelectCut={setSelectedCutNo} />
          </div>
        </div>
      </div>
    </div>
  )
}
