import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import TabToolbar from '../components/TabToolbar'
import CheckupTimeline from '../components/CheckupTimeline'
import CheckupSidebar from '../components/CheckupSidebar'
import { contentRatio } from '../lib/videoPolicy'
import s from './CheckupTab.module.css'

const SERVER = 'http://localhost:3001'

// VideoTab.jsx의 stripMeta/hexToRgba와 동일 — 이 코드베이스의 기존 관례대로 작은 순수함수는
// 탭마다 그대로 복제해서 씀. 자막 텍스트/스타일을 VideoTab에서 입력한 것과 동일하게 재사용하려면
// 같은 정제 로직이 필요하다(2026-09-13, 사용자 확인: "자막은 영상~편집메타 과정에서 입력됨").
function stripMeta(text) {
  if (!text) return text
  return text
    .replace(/\n?샷\s*타입[:：][^\n]*/gi, '')
    .replace(/^(CLOSEUP|FULLBODY)\s*(SHOT)?\s*[-—]?\s*/i, '')
    .trim()
}
function hexToRgba(hex, alpha) {
  const h = (hex || '#000000').replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
const fmtTime = (sec) => {
  if (!Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60), ss = Math.floor(sec % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

// VideoTab.jsx의 toSegments와 동일(클립별 구간 타이밍 자막, 2026-09-13) — subtitles[cutId]는
// 클립 1개 이하인 컷은 문자열 하나, 여러 개인 컷은 [{start,end,text}] 배열.
function toSegments(value, fallbackText, totalDur) {
  if (Array.isArray(value)) return value
  const text = value ?? fallbackText ?? ''
  return text ? [{ start: 0, end: totalDur, text }] : []
}

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
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const videoRef = useRef(null)
  const pendingSeekRef = useRef(null) // src 교체 후 loadedmetadata에서 적용할 목표 초
  const ratio = contentRatio(state.episode)

  // 자막 — VideoTab에서 이미 입력하는 데이터(state.videoTabState.subtitles[cutId], 없으면
  // dialogue/narration 폴백)를 그대로 재사용. 체크업 탭에서 새로 입력받지 않음(2026-09-13,
  // 사용자 확인: "자막은 영상~편집메타 과정에서 입력될 수 있지 않나?" — 맞음, 여기선 표시만).
  const { subtitleEnabled, font, fontSize, color, bgStyle, boxColor } = state.videoSettings || {}
  const subtitlesMap = state.videoTabState?.subtitles || {}
  const activeCut = state.cuts?.find(c => c.no === activeCutNo)
  // 클립이 여러 개인 컷은 세그먼트 배열이므로 지금 재생 위치(elapsedInActive)가 속한 구간의
  // 텍스트를 골라 보여준다 — 재생 중 자동으로 자막이 전환됨(2026-09-13).
  const activeCutSegs = activeCut
    ? toSegments(subtitlesMap[activeCut.id], stripMeta(activeCut.dialogue || activeCut.narration || ''), activeCut.duration || 0)
    : []
  const captionText = activeCutSegs.find(seg => elapsedInActive >= seg.start && elapsedInActive < seg.end)?.text
    ?? activeCutSegs[activeCutSegs.length - 1]?.text ?? ''

  const load = useCallback(async (silent = false) => {
    if (epNum == null) return
    if (!silent) setLoading(true)
    try {
      const r = await fetch(`${SERVER}/api/episode-video-checklist?epNum=${epNum}`)
      const d = await r.json()
      setCuts((d.cuts || []).slice().sort((a, b) => (a.order ?? a.no) - (b.order ?? b.no)))
    } catch {
      // 조용히 무시 — 새로고침 버튼(또는 다음 폴링)으로 재시도
    } finally {
      if (!silent) setLoading(false)
    }
  }, [epNum])

  useEffect(() => { load() }, [load])

  // 컷이 생성되는 대로 자동으로 반영되도록 백그라운드 폴링(2026-09-14, 사용자 확정 —
  // 컷타입마다 완료 시점이 서로 다른 G단계에 걸쳐있어 특정 이벤트에 훅을 거는 대신,
  // 다른 탭(스튜디오/메이킹)이 이미 쓰는 단순 폴링 방식을 그대로 적용). silent=true라
  // "불러오는 중…" 표시가 매번 깜빡이지 않음 — 수동 새로고침 버튼만 로딩 표시를 씀.
  useEffect(() => {
    const id = setInterval(() => load(true), 5000)
    return () => clearInterval(id)
  }, [load])

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

  // 네이티브 <video controls>를 끄고 화면 아래로 분리한 커스텀 컨트롤바(2026-09-13,
  // 사용자 지적: 자막이 들어가면 네이티브 컨트롤바와 겹칠 수 있음 — 아예 영상 프레임
  // 밖으로 분리해서 자막 오버레이와 절대 안 겹치게 함).
  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }
  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }
  const handleSeekBar = (e) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Number(e.target.value)
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
          { key: 'refresh', label: loading ? '불러오는 중…' : '🔄 새로고침', onClick: () => load(false), disabled: loading },
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
                  <video ref={videoRef} className={s.player}
                    onEnded={handleEnded} onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                    onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
                  {subtitleEnabled && captionText && (
                    <div className={`${s.captionOverlay} ${bgStyle === '그림자' ? s.captionShadow : ''}`}
                      style={{
                        color: color || '#fff', fontFamily: font ? `"${font}",sans-serif` : undefined,
                        fontSize: fontSize ? `${fontSize * 0.6}px` : '18px',
                        background: bgStyle === '반투명 직각 박스' ? hexToRgba(boxColor || '#000000', 0.68) : 'transparent',
                      }}>
                      {captionText}
                    </div>
                  )}
                </div>
              </div>
              {playable.length > 0 && (
                <div className={s.customControls}>
                  <button className={s.ctrlBtn} onClick={togglePlay} title={isPlaying ? '일시정지' : '재생'}>{isPlaying ? '⏸' : '▶'}</button>
                  <span className={s.ctrlTime}>{fmtTime(elapsedInActive)} / {fmtTime(duration)}</span>
                  <input type="range" className={s.ctrlSeek} min={0} max={duration || 0} step={0.1}
                    value={Math.min(elapsedInActive, duration || 0)} onChange={handleSeekBar} />
                  <button className={s.ctrlBtn} onClick={toggleMute} title={muted ? '음소거 해제' : '음소거'}>{muted ? '🔇' : '🔊'}</button>
                </div>
              )}
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
