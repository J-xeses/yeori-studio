import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import TabToolbar from '../components/TabToolbar'
import CheckupTimeline from '../components/CheckupTimeline'
import CheckupSidebar from '../components/CheckupSidebar'
import DiagnosisPanel from '../components/DiagnosisPanel'
import { contentRatio } from '../lib/videoPolicy'
import { resolveEpisodeCode } from '../lib/episodeCode'
import s from './CheckupTab.module.css'

const SERVER = 'http://localhost:3001'

// PDF 13페이지 "주요 접속 사이트, 앱 확인 후 추가!" — 외부 편집 앱 연동(2026-10-21 4차 보완).
const EXTERNAL_TOOLS = [
  { name: 'CapCut', url: 'https://www.capcut.com' },
  { name: 'SellBuyMusic', url: 'https://www.sellbuymusic.com' },
]

// VideoTab.jsx의 hexToRgba와 동일 — 이 코드베이스의 기존 관례대로 작은 순수함수는 탭마다
// 그대로 복제해서 씀.
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
  const { state, dispatch } = useApp()
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
  // 2026-10-22 4차 보완 재재점검: pause()만으로는 "전체 이어보기" 체인(handleEnded가 다음
  // 컷으로 자동 전환) 때문에 편집 중에도 재생 바늘이 계속 돌았다 — 편집 중엔 자동 전환·
  // 재생 재개를 전부 막는 플래그.
  const isEditingRef = useRef(false)
  const ratio = contentRatio(state.episode)
  const episodeCode = resolveEpisodeCode(state.episode)
  // "즉석 조치: AI 검토코멘트"(2026-10-22 4차 보완) — VideoTab이 이미 쓰는 DiagnosisPanel을
  // 그대로 재사용(컷별 AI 진단·대화). 전체 흐름별 코멘트는 범위가 달라 이번엔 포함 안 함.
  const [diagCutId, setDiagCutId] = useState(null)
  const diagCut = diagCutId != null ? state.cuts?.find(c => c.id === diagCutId) : null

  // 자막 — 2026-10-14 실측으로 발견: 이전엔 dialogue/narration(TTS가 읽는 대사 원문)을
  // 보여주고 있었는데, 실제로 최종본에 번인되는 자막은 그것과 전혀 다른 cut.subtitle(CP
  // 필드, 짧은 캡션용 문구 — 예: CUT3 대사는 "(지유) 이번엔 제대로 해봐, 서여리! / (여리)
  // 보고 배워."인데 실제 CP는 "재도전 선언"이라는 완전히 다른 한 줄)이었다(reelFinalize.js
  // decideCut()이 cp.split(/\/)로 세그먼트를 만듦). 타이밍도 cut.captionSegTiming이 있으면
  // 그걸 그대로 쓰고(= 실제 최종본과 100% 동일), 없을 때만 글자수 비례로 근사 배분한다.
  const { subtitleEnabled, font, fontSize, color, bgStyle, boxColor } = state.videoSettings || {}
  const buildCaptionSegs = useCallback((cut) => {
    const cp = String(cut?.subtitle || '').trim()
    if (!cp) return []
    const segs = cp.split(/\s*\/\s*/).map(t => t.replace(/^\s*\d+\s*단계\s*[:：]\s*/, '').trim()).filter(Boolean)
    const parts = segs.length ? segs : [cp]
    const dur = cut.duration || 0
    if (Array.isArray(cut.captionSegTiming) && cut.captionSegTiming.length === parts.length) {
      return parts.map((text, i) => ({ text, start: cut.captionSegTiming[i][0], end: cut.captionSegTiming[i][1] }))
    }
    // 수동 타이밍 없을 때의 근사 폴백 — reelFinalize.js의 computeSegmentTimings(글자수 비례)와
    // 같은 발상이지만 정확히 같은 구현은 아님(서버 전용 함수라 클라에서 재현 불가, 미리보기용).
    const weights = parts.map(t => Math.max(t.replace(/\s+/g, '').length, 1))
    const totalW = weights.reduce((a, b) => a + b, 0)
    let acc = 0
    return parts.map((text, i) => {
      const start = acc
      acc += (dur * weights[i]) / totalW
      return { text, start, end: i === parts.length - 1 ? dur : acc }
    })
  }, [])
  const activeCut = state.cuts?.find(c => c.no === activeCutNo)
  // 클립이 여러 개인 컷은 세그먼트 배열이므로 지금 재생 위치(elapsedInActive)가 속한 구간의
  // 텍스트를 골라 보여준다 — 재생 중 자동으로 자막이 전환됨(2026-09-13).
  const activeCutSegs = activeCut ? buildCaptionSegs(activeCut) : []
  const captionText = activeCutSegs.find(seg => elapsedInActive >= seg.start && elapsedInActive < seg.end)?.text
    ?? activeCutSegs[activeCutSegs.length - 1]?.text ?? ''

  // 타임라인 자막 트랙(2026-10-14, 성준님 요청: "타임라인에 자막라인 추가" → "자막도 자르는
  // 기능") — 위 activeCutSegs와 같은 계산을 컷 전체에 대해 한 번에 해둔다.
  const subtitleSegmentsByNo = useMemo(() => Object.fromEntries(
    (state.cuts || []).map(c => [c.no, buildCaptionSegs(c)])
  ), [state.cuts, buildCaptionSegs])

  // 자막 세그먼트 트림(경계만 이동, 중간 분할은 안 함 — 2026-10-14 성준님: "중간구간 자르기는
  // 컷 안에서 자연스럽게 이어지지 않을 것이라 지금은 적용하지 말기로 하자"). 세그먼트 배열
  // 전체를 cut.captionSegTiming에 그대로 저장 — 영상 파일은 안 건드리므로 duration 트림과
  // 달리 즉시, 메타데이터만으로 실제 최종본에 반영된다(finalizeReel이 이 필드를 직접 읽음).
  const commitCaptionSegTiming = useCallback((cutNo, segs) => {
    const cut = state.cuts?.find(c => c.no === cutNo)
    if (!cut?.id) return
    dispatch({ type: 'UPDATE_CUT', id: cut.id, p: { captionSegTiming: segs.map(s => [s.start, s.end]) }, overrideReason: '체크업 타임라인에서 자막 트림' })
  }, [state.cuts, dispatch])

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

  // 2026-10-22 4차 보완 재재점검(실측 — 여전히 리셋 안 됨): cuts 갱신에 기대는 방식으로는
  // 안 됐다 — <video>와 <CheckupTimeline>에 key={epNum}을 줘서 에피소드가 바뀌면 두 컴포넌트를
  // 통째로 새로 마운트하게 했다(React가 내부 상태를 전부 새로 시작 — clips/undoStack/activeCutNo
  // 등 어디에 남아있는 묵은 참조든 추측할 필요 없이 확실하게 비워짐). 여기선 CheckupTab 쪽
  // 재생 상태(activeCutNo 등)만 같이 리셋한다.
  useEffect(() => {
    setActiveCutNo(null)
    setElapsedInActive(0)
    pendingSeekRef.current = null
  }, [epNum])

  // 컷이 생성되는 대로 자동으로 반영되도록 백그라운드 폴링(2026-09-14, 사용자 확정 —
  // 컷타입마다 완료 시점이 서로 다른 G단계에 걸쳐있어 특정 이벤트에 훅을 거는 대신,
  // 다른 탭(스튜디오/메이킹)이 이미 쓰는 단순 폴링 방식을 그대로 적용). silent=true라
  // "불러오는 중…" 표시가 매번 깜빡이지 않음 — 수동 새로고침 버튼만 로딩 표시를 씀.
  useEffect(() => {
    const id = setInterval(() => load(true), 5000)
    return () => clearInterval(id)
  }, [load])

  // 체크업 타임라인 트림 → 실제 cut_NN.mp4 파일 반영(2026-10-14, 성준님 요청 — "전체길이를
  // 살짝 늘리거나 줄이거나", "왼쪽/오른쪽 중 살릴 쪽 선택"). 처음엔 cut.duration만 바꾸면 되는
  // 줄 알았는데, finalizeReel()이 각 컷 길이를 cut.duration이 아니라 cut_NN.mp4를 ffprobe로
  // 실측한 값으로 항상 덮어쓴다는 걸 실측으로 발견(cut.duration=7로 고쳤는데 실제 파일은 그대로
  // 8초) — 메타데이터만 바꿔선 발행 영상에 전혀 반영이 안 됐다. 그래서 실제 파일 자체를 다시
  // 잘라야 하고, /api/checkup-trim-commit(내부적으로 render-cut-clips 재사용, 자동 백업 포함)이
  // 그 역할을 한다 — 왼쪽/오른쪽 둘 다 trimStart/trimEnd로 그대로 넘기면 되므로 "어느 쪽을
  // 살릴지"도 자연히 해결된다. 성공하면 cut.duration도 같이 갱신해 메타 테이블/SRT 타이밍이
  // 실제 파일과 어긋나지 않게 한다.
  const commitCutTrim = useCallback(async (cutNo, trimStart, trimEnd) => {
    const r = await fetch(`${SERVER}/api/checkup-trim-commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epNum, cutNo, trimStart, trimEnd }),
    })
    const d = await r.json()
    if (!r.ok || d.error) throw new Error(d.error || '트림 반영 실패')
    const actualDur = d.duration ?? (trimEnd - trimStart)
    const cut = state.cuts?.find(c => c.no === cutNo)
    if (cut?.id) {
      dispatch({ type: 'UPDATE_CUT', id: cut.id, p: { duration: Math.round(actualDur * 10) / 10 }, overrideReason: '체크업 타임라인에서 트림' })
    }
    load(true)
    return actualDur
  }, [epNum, state.cuts, dispatch, load])

  // ↩(실행취소) 버튼이 실제 파일 트림까지 같이 되돌리게(2026-10-14, 성준님 요청) —
  // /api/checkup-trim-undo가 _manual_work/cut_NN_prev.mp4(가장 최근 백업 1벌)로 복구하고
  // 실제 복원된 길이를 돌려주면, 그 값을 cut.duration에도 그대로 반영해 메타와 어긋나지 않게 한다.
  const undoCutTrim = useCallback(async (cutNo) => {
    const r = await fetch(`${SERVER}/api/checkup-trim-undo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epNum, cutNo }),
    })
    const d = await r.json()
    if (!r.ok || d.error) throw new Error(d.error || '실제 파일 복구 실패')
    const cut = state.cuts?.find(c => c.no === cutNo)
    if (cut?.id && d.duration) {
      dispatch({ type: 'UPDATE_CUT', id: cut.id, p: { duration: Math.round(d.duration * 10) / 10 }, overrideReason: '체크업 타임라인 트림 실행취소' })
    }
    await load(true)
    return d.duration // 2026-10-22 4차 보완 — "선택 컷 트림 초기화" 버튼이 복구된 실제 길이를
    // 알아야 클립의 trimOutSec을 거기 맞춰 되돌릴 수 있다(기존 undo()는 스냅샷이 이미 있어
    // 이 반환값이 필요 없었음).
  }, [epNum, state.cuts, dispatch, load])

  const playable = cuts.filter(c => c.hasVideo && c.videoUrl)
  const activeIdx = playable.findIndex(c => c.no === activeCutNo)
  const mismatchCount = cuts.filter(c => c.lengthMismatch).length
  const cutsByNo = useMemo(() => Object.fromEntries(cuts.map(c => [c.no, c])), [cuts])

  // forcePlay=true(기본) — "이 컷을 재생해줘" 의도(▶ 전체 이어보기, 컷 자동 연결, 사이드바
  // 컷 클릭)는 지금 멈춰 있어도 재생을 시작해야 맞다. 반면 타임라인을 그냥 클릭해 위치만
  // 보는 건 "재생해달라"는 뜻이 아니다 — 2026-10-22 4차 보완 세 번째 재신고("타임라인
  // 클릭해도 바늘이 쉬지 않고 계속 돌아감")의 실제 범인이 여기였다: 같은 컷 안에서 위치만
  // 바꾸는 분기가 무조건 v.play()를 불러서, 멈춰 둔 상태여도 매번 다시 재생됐다.
  // CheckupTimeline의 타임라인 클릭(handleStripClick)만 forcePlay=false로 호출한다.
  const seekTo = useCallback((cutNo, localTime, forcePlay = true) => {
    const cut = playable.find(c => c.no === cutNo)
    if (!cut || !videoRef.current) return
    const v = videoRef.current
    if (activeCutNo === cutNo && v.src === cut.videoUrl) {
      const wasPaused = v.paused
      v.currentTime = localTime
      if ((forcePlay || !wasPaused) && !isEditingRef.current) v.play().catch(() => {})
    } else {
      pendingSeekRef.current = localTime
      setActiveCutNo(cutNo)
    }
  }, [activeCutNo, playable])

  useEffect(() => {
    const cut = playable.find(c => c.no === activeCutNo)
    if (!cut || !videoRef.current) return
    const v = videoRef.current
    const srcChanged = v.src !== cut.videoUrl
    if (srcChanged) {
      v.src = cut.videoUrl
    }
    const applyPending = () => {
      if (pendingSeekRef.current != null) {
        v.currentTime = pendingSeekRef.current
        pendingSeekRef.current = null
      }
      v.play().catch(() => {})
    }
    // 2026-10-22 4차 보완 버그수정: 원래 [activeCutNo]만 의존해서, 다른 에피소드로 바꿔도
    // activeCutNo 숫자 자체(예: 3번 컷)가 안 바뀌면 이 effect가 재실행되지 않아 영상이
    // 이전 에피소드의 cut.videoUrl에 그대로 멈춰 있었다("다른 에피소드 선택 시 컷 미반영"
    // 신고 — 해당 컷 파일이 나중에 교체 완료돼도 cuts가 갱신될 때 이 effect가 다시 안 돌아
    // 여전히 안 잡혔다). cuts를 의존성에 추가해 에피소드 전환·폴링 갱신 때마다 다시 맞춘다.
    // ── 재점검(같은 날 재신고): cuts는 5초 폴링마다 새 배열로 갱신되므로 이 effect가 그때마다
    // 재실행된다 — srcChanged 가드 없이 매번 applyPending()을 부르면, 편집 중 일시정지해둔
    // 영상이 몇 초 뒤 폴링 때마다 저절로 다시 재생됐다("컷 편집시 멈춤 안됨 — 몇초후 자동
    // 재생됨"). src가 실제로 바뀌었거나 명시적 탐색(pendingSeek) 요청이 있을 때만 재생한다 —
    // 단순 폴링 갱신으로는 지금 재생 상태(일시정지 포함)를 건드리지 않는다.
    if ((srcChanged || pendingSeekRef.current != null) && !isEditingRef.current) {
      if (v.readyState >= 1) applyPending()
      else v.addEventListener('loadedmetadata', applyPending, { once: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCutNo, cuts])

  const playAll = () => { if (playable.length) seekTo(playable[0].no, 0) }
  const handleEnded = () => {
    // 2026-10-22 4차 보완 재재점검: "타임라인 클릭해도 바늘이 쉬지 않고 계속 돌아감" — "전체
    // 이어보기"로 컷이 끝날 때마다 다음 컷으로 자동 전환하는 이 체인이, 편집 중 pause()를
    // 매번 무시하고 다음 컷을 계속 재생시키고 있었다. 편집 중엔 자동 전환을 멈춘다.
    if (isEditingRef.current) return
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
        toolLabel="외부 편집 앱 연동"
        tools={EXTERNAL_TOOLS.map(t => t.name)}
        onToolChange={name => window.open(EXTERNAL_TOOLS.find(t => t.name === name)?.url, '_blank')}
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
          onSelectCut={setSelectedCutNo} onSeek={seekTo} onApplied={load}
          epNum={epNum} episodeCode={episodeCode}
          onOpenDiagnosis={(cutId) => setDiagCutId(cutId)} />
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
                  <video ref={videoRef} key={epNum} className={s.player}
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
              <CheckupTimeline key={epNum} epNum={epNum} cutsByNo={cutsByNo} subtitleSegmentsByNo={subtitleSegmentsByNo}
                activeCutNo={activeCutNo} elapsedInActive={elapsedInActive}
                onSeek={seekTo} onSelectCut={setSelectedCutNo} onDurationCommit={commitCutTrim} onDurationCommitUndo={undoCutTrim}
                onCaptionSegCommit={commitCaptionSegTiming}
                onEditingChange={(editing) => {
                  isEditingRef.current = editing
                  if (editing) videoRef.current?.pause()
                }} />
            </div>
            <BeatSummaryBar cuts={cuts} scriptCuts={state.cuts} activeCutNo={activeCutNo} elapsedInActive={elapsedInActive} />
          </div>
        </div>
      </div>
      {diagCut && <DiagnosisPanel cut={diagCut} episodeCode={episodeCode} stage="G4" onClose={() => setDiagCutId(null)} />}
    </div>
  )
}
