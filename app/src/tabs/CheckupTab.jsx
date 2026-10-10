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
// 2026-10-10 — VideoTab에서 자막을 따로 입력 안 한 컷(subtitlesMap에 없음, LF_T01 23컷 중
// 12컷 실측)은 대사(dialogue) 원문이 그대로 자막으로 떨어지는데, 그 원문은 TTS 발화 톤을
// 위한 연기 지문 표기("진~~짜"처럼 모음 늘임, "♪" 등)가 섞여 있어 자막처럼 안 읽힌다
// (성준님 지적: "자막이 아닌 대사지문이 표시되고 있다"). CP(subtitle)도 subtitlesMap도
// 없을 때만 적용되는 최후 폴백이라, dialogue 데이터 자체(TTS가 읽는 원본)는 건드리지 않고
// 화면 표시용으로만 다듬는다 — 사람이 나중에 VideoTab에서 직접 자막을 입력하면 이 정리는
// 더 이상 안 거친다(그게 우선순위가 높으므로).
function cleanDialogueForCaptionFallback(text) {
  if (!text) return text
  return text
    .replace(/([가-힣])~+/g, '$1')        // "진~~짜" → "진짜" (모음 늘임 표기 제거)
    .replace(/[♪♬]/g, '')                 // 음표 등 연기 지문 기호
    .replace(/\s{2,}/g, ' ')
    .trim()
}
function hexToRgba(hex, alpha) {
  const h = (hex || '#000000').replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
// VideoTab.jsx의 isLightColor와 동일 — 자막 외곽선 색을 글자색과 자동으로 반대로 두기 위함.
function isLightColor(hex) {
  const h = (hex || '#ffffff').replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150
}
const fmtTime = (sec) => {
  if (!Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60), ss = Math.floor(sec % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

// VideoTab.jsx의 toSegments/splitCaptionString과 동일(클립별 구간 타이밍 자막,
// 2026-09-13 추가, 2026-09-22 VideoTab만 분리타이밍으로 고쳐지고 체크업 탭 사본은
// 안 따라가서 뒤쳐져 있었음 — 2026-10-10, LF_T01 실측: "/" 또는 "||"로 이어진 대사가
// 한 덩어리 자막으로 전체 컷 길이(24초) 내내 그대로 떠 있던 버그).
// subtitles[cutId]가 배열이면 그대로 쓰고, 문자열/미지정이면 "/" 또는 "||" 구분자로
// 쪼개서 글자수 비례로 구간을 나눈다(vpDialogue.js/ttsText.js가 쓰는 같은 구분자 2종).
function toSegments(value, fallbackText, totalDur) {
  if (Array.isArray(value)) return value
  const text = value ?? fallbackText ?? ''
  if (!text) return []
  const parts = String(text).split(/\s*(?:\|\||\/)\s*/).map((t) => t.trim()).filter(Boolean)
  if (parts.length <= 1) return [{ start: 0, end: totalDur, text: parts[0] || text }]
  const weights = parts.map((t) => Math.max(t.replace(/\s+/g, '').length, 1))
  const totalW = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  return parts.map((t, i) => {
    const start = acc
    acc += (totalDur * weights[i]) / totalW
    return { start, end: i === parts.length - 1 ? totalDur : acc, text: t }
  })
}

// EpisodeInfoSidebar.jsx의 BEAT_COLORS와 동일.
const BEAT_COLORS = { 훅: '#60a5fa', 긴장: '#fbbf24', 반전: '#f472b6', 안정: '#94a3b8', 고조: '#f97316', 결말: '#34d399', 시그: '#a78bfa' }

// 체크업 탭 타임라인 바로 밑에 배치하는 비트 요약 바(2026-10-10, 성준님 설계) — 체크업
// 타임라인(위, 편집용)과 같은 가로 축을 공유해 "타임마커 연동"처럼 보이게 하되, 구현은
// 완전히 별개(읽기 전용 — CheckupTimeline의 trim/split 편집 상태에 영향 없음). 색은 심플한
// 단색 블록, 컷 경계는 선으로만 구분, 시그 컷은 시작 경계선을 굵게/밝게 표시(아이콘 의존 X).
// 범례는 이 블록 전체에서 한 번만 보여준다.
function BeatSummaryBar({ cuts, scriptCuts, activeCutNo, elapsedInActive }) {
  const byNo = Object.fromEntries((scriptCuts || []).map((c) => [c.no, c]))
  const list = (cuts || []).slice().sort((a, b) => (a.order ?? a.no) - (b.order ?? b.no))
  const total = list.reduce((s, c) => s + (Number(c.duration) || 0), 0)
  if (!total) return null

  let offset = 0
  const positioned = list.map((c) => {
    const dur = Number(c.duration) || 0
    const item = { ...c, start: offset, dur, script: byNo[c.no] }
    offset += dur
    return item
  })
  const activeItem = positioned.find((p) => p.no === activeCutNo)
  const playheadPct = activeItem ? ((activeItem.start + Math.min(elapsedInActive, activeItem.dur)) / total) * 100 : null
  const anyBeatTagged = positioned.some((p) => p.script?.beat)

  return (
    <div className={s.beatSummaryWrap}>
      <div className={s.beatSummaryBar}>
        {positioned.map((p) => {
          const beat = p.script?.beat
          const isSig = beat === '시그'
          return (
            <div key={p.no} className={s.beatSummarySeg}
              style={{
                width: `${(p.dur / total) * 100}%`,
                background: beat ? `${BEAT_COLORS[beat]}55` : 'rgba(255,255,255,.06)',
                borderLeft: isSig ? '3px solid #a78bfa' : '1px solid rgba(255,255,255,.12)',
              }}
              title={`CUT ${p.no} · ${beat || '(비트 없음)'} · ${p.dur}s`} />
          )
        })}
        {playheadPct != null && <div className={s.beatSummaryPlayhead} style={{ left: `${playheadPct}%` }} />}
      </div>
      <div className={s.beatSummaryLabels}>
        {positioned.map((p) => (
          <div key={p.no} className={s.beatSummaryLabel} style={{ width: `${(p.dur / total) * 100}%` }}
            title={p.script?.cutTitle || p.script?.scene || ''}>
            <span className={s.beatSummaryLabelNo}>C{p.no}·{p.dur}s</span>
            <span className={s.beatSummaryLabelText}>{(p.script?.cutTitle || p.script?.scene || '').slice(0, 14)}</span>
          </div>
        ))}
      </div>
      {anyBeatTagged && (
        <div className={s.beatSummaryLegend}>
          {Object.entries(BEAT_COLORS).map(([beat, color]) => (
            <span key={beat} className={s.beatSummaryLegendItem}>
              <span className={s.beatSummaryLegendDot} style={{ background: color }} />{beat}
            </span>
          ))}
          <button type="button" className={s.beatSummaryChapterBtn} onClick={() => copyYoutubeChapters(positioned)} title="유튜브 챕터 형식(0:00부터, 구간 10초 이상)으로 타임스탬프를 만들어 클립보드에 복사합니다 — 업로드 시 설명란에 붙여넣으면 자동으로 챕터가 생깁니다. 짧은 컷은 다음 컷과 자동으로 합쳐집니다.">
            📋 유튜브 챕터 텍스트 복사
          </button>
        </div>
      )}
    </div>
  )
}

// 유튜브 챕터는 "설명란에 M:SS 타임스탬프 목록"으로만 동작한다(별도 업로드 API/설정 없음) —
// 0:00 시작·오름차순·최소 3개·구간 10초 이상이 조건(2026-10-10 리서치 확인). 짧은 컷(5~8초)이
// 많은 릴스형 에피소드는 그대로 쓰면 조건을 못 채우므로, 직전 챕터와 10초 이상 벌어질 때만
// 새 챕터를 끊고 그 전까지는 한 챕터로 묶는다.
function fmtChapterTime(sec) {
  const s = Math.floor(sec)
  const m = Math.floor(s / 60), ss = s % 60
  const h = Math.floor(m / 60), mm = m % 60
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}
function copyYoutubeChapters(positioned) {
  if (!positioned?.length) return
  const chapters = [{ t: 0, label: positioned[0].script?.cutTitle || positioned[0].script?.scene || `CUT ${positioned[0].no}` }]
  for (const p of positioned.slice(1)) {
    if (p.start - chapters[chapters.length - 1].t >= 10) {
      chapters.push({ t: p.start, label: p.script?.cutTitle || p.script?.scene || `CUT ${p.no}` })
    }
  }
  if (chapters.length < 3) { alert('챕터가 3개 미만입니다 — 유튜브는 최소 3개부터 챕터를 인식합니다(컷이 전부 너무 짧은 릴스형 에피소드는 적용 어려움).'); return }
  const text = chapters.map((c) => `${fmtChapterTime(c.t)} ${c.label}`).join('\n')
  navigator.clipboard?.writeText(text)
  alert(`챕터 ${chapters.length}개 복사됨 — 유튜브 업로드 시 설명란에 붙여넣으세요.\n\n${text}`)
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
    ? toSegments(subtitlesMap[activeCut.id], cleanDialogueForCaptionFallback(stripMeta(activeCut.dialogue || activeCut.narration || '')), activeCut.duration || 0)
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
                    // 2026-10-10 실측: 9/15에 fontSize/720 cqh로 "VideoTab 캔버스와 같은 비율"을
                    // 맞췄다고 적어뒀지만, VideoTab의 캔버스는 프레임 전체가 아니라 .subtitleDisplay
                    // (height:30%, 자막 전용 하단 띠) 안에서 object-fit:contain되는 걸 놓쳤다 —
                    // cqh를 프레임 전체(100%) 기준으로 계산해서 체크업 탭 자막이 영상 탭보다 실제로
                    // 약 1/0.3 ≈ 3.3배 크게 보였다(성준님 실측 — "영상탭보다 거의 3배"). VideoTab과
                    // 똑같이 height:30% 띠를 따로 만들고 그 안에서 cqh를 계산해 비율을 맞춘다.
                    <div className={s.captionBand} style={{ height: '30%' }}>
                      <div className={`${s.captionOverlay} ${bgStyle === '그림자' ? s.captionShadow : ''}`}
                        style={{
                          color: color || '#fff', fontFamily: font ? `"${font}",sans-serif` : undefined,
                          fontSize: fontSize ? `${(fontSize / 720) * 100}cqh` : `${(18 / 720) * 100}cqh`,
                          background: bgStyle === '반투명 직각 박스' ? hexToRgba(boxColor || '#000000', 0.68) : 'transparent',
                          // 배경 스타일과 별개로 항상 외곽선을 깔아 어떤 화면 위에서도 읽히게 함
                          // (2026-09-15, 사용자 지적: "색상 외에 글씨 외곽 테두리 효과 정도는 있어야").
                          WebkitTextStroke: `${Math.max(1, (fontSize || 18) * 0.045)}px ${isLightColor(color || '#fff') ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)'}`,
                          paintOrder: 'stroke fill',
                        }}>
                        {captionText}
                      </div>
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
            <div className={s.timelineEditorInner}>
              <CheckupTimeline epNum={epNum} cutsByNo={cutsByNo}
                activeCutNo={activeCutNo} elapsedInActive={elapsedInActive}
                onSeek={seekTo} onSelectCut={setSelectedCutNo} />
            </div>
            <BeatSummaryBar cuts={cuts} scriptCuts={state.cuts} activeCutNo={activeCutNo} elapsedInActive={elapsedInActive} />
          </div>
        </div>
      </div>
    </div>
  )
}
