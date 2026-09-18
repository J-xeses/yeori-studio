import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import JSZip from 'jszip'
import { setGPoint, setGPoints, loadGPoints } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { resolveVideoPolicy, VIDEO_MODES, contentRatio } from '../lib/videoPolicy'
import { epMediaUrl } from '../lib/mediaPaths'
import { EpisodeOverviewBlock, CutList } from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
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

// 클립별(구간별) 타이밍 자막(2026-09-13) — subtitles[cutId]는 클립이 1개 이하인 컷은
// 지금처럼 문자열 하나, 클립이 여러 개인 컷은 [{start,end,text}] 배열. 구버전 문자열
// 데이터도 항상 세그먼트 배열로 통일해서 다루기 위한 헬퍼(체크업 탭에도 동일하게 복제).
function toSegments(value, fallbackText, totalDur) {
  if (Array.isArray(value)) return value
  const text = value ?? fallbackText ?? ''
  return text ? [{ start: 0, end: totalDur, text }] : []
}

// 로컬 오버라이드(subtitles[cutId], VideoTab에서 직접 고친 값)가 없으면 대본에 반영된 값을
// 기본값으로 쓴다 — 2026-09-15, 사용자 확정: "필드게이트 자막 설정이 영상 만들기에도 반영이
// 되어야겠다". 우선순위: 로컬 오버라이드 > CPP(세그별 자막) > CP(단일 자막) > 대사/나레이션
// 기반 기존 기본값(toSegments의 fallbackText로 처리됨, 여기선 undefined 반환).
function effectiveCaptionValue(subtitlesState, cut, clips) {
  if (!cut) return undefined
  if (subtitlesState[cut.id] !== undefined) return subtitlesState[cut.id]
  const plannedSegs = Array.isArray(cut.segments) ? cut.segments : []
  const slotCount = Math.max(clips.length, plannedSegs.length)
  if (slotCount > 0 && Array.isArray(cut.subtitleSegments) && cut.subtitleSegments.length === slotCount) {
    let acc = 0
    return cut.subtitleSegments.map((text, i) => {
      const clip = clips[i]
      const segDur = clip ? (clip.useFullDuration ? clip.duration : (clip.trimEnd - clip.trimStart)) : (plannedSegs[i] ?? ((cut.duration || 0) / slotCount))
      const start = acc
      acc += (segDur || 0)
      return { start, end: acc, text: text || '' }
    })
  }
  if (cut.subtitle && !/^없음$/.test(cut.subtitle)) return cut.subtitle
  return undefined
}

// blob: 미리보기 URL은 그 브라우저 세션에서만 유효 — 새로고침하면 무조건 끊겨서 "재생할 수
// 없습니다" 경고가 뜸(2026-09-17 실측 피드백). stagedPath(서버에 실제 저장된 경로)가 있으면
// 죽은 blob: 대신 그 서버 URL을 바로 쓰게 해서 새로고침해도 계속 재생되게 한다.
function resolveClipSrc(clip) {
  if (!clip) return ''
  if (clip.url && !clip.url.startsWith('blob:')) return clip.url
  if (clip.stagedPath) {
    const idx = clip.stagedPath.toLowerCase().indexOf('\\downloads\\')
    if (idx >= 0) {
      const rel = clip.stagedPath.slice(idx + '\\downloads\\'.length).replace(/\\/g, '/')
      return `http://localhost:3001/downloads/${rel}`
    }
  }
  return clip.url || ''
}

// 클립의 실제 생성/수정 시각(2026-09-14) — "M/D HH:MM" 형식, 오늘이면 시간만.
function formatClipTimestamp(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return time
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

// 클립 배열의 누적 시작/끝 시각 — clipTrimItem의 usedSec 계산과 같은 기준(전체사용 여부에
// 따라 duration 또는 trimEnd-trimStart)을 그대로 써서 자막 타이밍과 항상 어긋나지 않게 함.
// 세그1/3만 만들고 세그2는 비어있는 등 배열에 구멍(hole)이 있을 수 있음(2026-09-16, 세그별
// 슬롯 지정 업로드 도입) — Array.map은 구멍을 건너뛰므로 plannedSegs로 그 구간의 계획 길이를
// 채워 넣어야 뒤 세그먼트들의 시작 시각이 밀리지 않는다(effectiveCaptionValue와 동일 원칙).
function clipTimings(clips, plannedSegs = []) {
  let acc = 0
  const out = []
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const used = clip ? (clip.useFullDuration ? clip.duration : (clip.trimEnd - clip.trimStart)) : plannedSegs[i]
    const start = acc
    acc += (used || 0)
    out.push(clip ? { start, end: acc } : undefined)
  }
  return out
}

// 자막 편집창은 "Enter로 줄바꿈 가능"이라고 안내하는데, 이 함수가 공백 기준 폭 자동
// 줄바꿈만 하고 텍스트 안의 실제 개행(\n)은 그냥 무시해버려서(한 단어처럼 폭 측정에
// 섞여 들어감) 사용자가 직접 넣은 줄바꿈이 화면에 반영 안 되는 문제가 있었다(2026-09-18,
// 사용자 지적: "줄바꿈 설정대로 자막이 나타나는 기능이 안 된다"). 먼저 \n으로 문단을
// 나누고, 각 문단을 기존처럼 폭 기준 자동 줄바꿈 — 수동 개행은 항상 줄 경계로 유지되고,
// 자동 줄바꿈은 그 안에서만 동작.
function wrapCanvasText(ctx, text, maxWidth) {
  const lines = []
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(' ')
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
    lines.push(line)
  }
  return lines
}

function hexToRgba(hex, alpha) {
  const h = (hex || '#000000').replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// 자막 외곽선 색을 글자색과 자동으로 반대로 두기 위한 밝기 판정(표준 상대 휘도 근사).
function isLightColor(hex) {
  const h = (hex || '#ffffff').replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150
}

// PL이 인스타그램 콘텐츠 코드(IG_FD/IG_RL/IG_PT/IG_ST)면 어느 downloads/insta/{content}/
// 하위로 라우팅할지 반환. StudioTab.jsx에 있는 것과 동일 로직(이 코드베이스의 기존 관례대로
// 작은 순수함수라 탭마다 그대로 복제해서 씀).
function pipelineCodeToInstaContent(plCode) {
  const map = { IG_FD: 'FD', IG_RL: 'RL', IG_PT: 'PT', IG_ST: 'ST' }
  return map[(plCode || '').toUpperCase()] || null
}

// 컷마다 masterCode.pl이 없는 경우를 위한 폴백 — episode.contentType 기준 유추.
function episodeContentTypeToInsta(contentType) {
  const map = { IG_R: 'RL', IG_F: 'FD', IG_P: 'PT', IG_S: 'ST' }
  return map[(contentType || '').toUpperCase()] || null
}

// ScriptGenTab.jsx의 getRunFlags()에서 run_g4:false인 타입(GRAPHIC/CAPCUT)과 반드시 동일하게
// 유지할 것 — 이 두 타입은 CapCut/HTML 캡처로 메이킹 탭에서 직접 제작하는 컷이라 Flow+Veo3
// 영상 생성 대상이 애초에 아니다. 이걸 안 가려내면 "전체 AI 생성"/"G4 전체"가 이 컷들까지
// 건드려서 "G2 이미지가 없습니다" 오류를 내거나 의미 없는 g4:true를 찍어버린다.
function needsFlowVideo(cutType) {
  return !['GRAPHIC', 'CAPCUT'].includes(cutType || 'YEORI')
}

export default function VideoTab() {
  const { state, dispatch } = useApp()
  const { cuts, videoSettings, renderProgress, episode } = state
  // episode.code(3차 정식 필드) 우선, 레거시 에피소드는 과도기 방식(번호)으로 대체
  const episodeCode = resolveEpisodeCode(episode)
  const { subtitleEnabled, font, fontSize, color, bgStyle, boxColor } = videoSettings
  const canvasRef = useRef(null)
  const textareaRef = useRef(null)
  const [renderLog, setRenderLog] = useState([])

  // 하드코딩된 '9:16' 기본값이 아니라 에피소드 콘텐츠 유형 기준 실제 비율로 시작
  // (LF_YU 같은 16:9 유튜브 롱폼 에피소드에서도 항상 9:16으로 뜨던 문제, 2026-09-12 발견).
  const [aspectRatio, setAspectRatio] = useState(() => contentRatio(episode))
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const { videoClips = {}, g4Approved = {}, selectedCutId = null, subtitles = {} } = state.videoTabState || {}
  const [subtitleEditMode, setSubtitleEditMode] = useState(false)
  const [subtitlePosition, setSubtitlePosition] = useState('middle')
  const [selectedClipIdx, setSelectedClipIdx] = useState(0)
  const [videoGenStatus, setVideoGenStatus] = useState({})
  const [videoGenLog, setVideoGenLog] = useState({})
  const [ffmpegStatus, setFfmpegStatus] = useState({})
  const [ffmpegLog,    setFfmpegLog]    = useState({})
  const [composeStatus, setComposeStatus] = useState({})   // 클립 합성(render-cut-clips) 진행상태
  const [composeLog,    setComposeLog]    = useState({})
  // 합성 성공 시각(cut.id → ms) — "최종 합성본" 미리보기의 캐시버스팅 키.
  // 세그 카드 미리보기(위 클립 목록)는 항상 "지금 선택된 세그 원본"만 보여줘서, 합성 후에도
  // 사용자가 최종 결과 대신 세그 원본을 최종본으로 착각하는 혼란이 반복됐다(2026-09-17,
  // "PIP에 같은 화면이 보인다"/"자막이 없다" 두 신고 모두 실제로는 이 UI 혼동이었음 — 실제
  // 서버 파일은 직접 프레임 추출로 매번 정상 확인됨). 이 state가 있는 컷은 세그 목록과는
  // 별도로, 실제 05_video/cut_NN.mp4를 명확히 라벨링해 보여준다.
  const [finalPreviewTs, setFinalPreviewTs] = useState({})
  const [batchFfmpegStatus,   setBatchFfmpegStatus]   = useState('idle') // idle | running | done | error
  const [batchFfmpegProgress, setBatchFfmpegProgress] = useState({ current: 0, total: 0 })
  const [batchFfmpegLog,      setBatchFfmpegLog]      = useState('')
  const [gData, setGData] = useState(() => loadGPoints())
  // ── 드래그 배정(2026-09-15) — 스튜디오 탭 이미지 드래그 배정과 동일한 이유: Flow/Veo가
  // 다운로드해주는 실제 파일명은 컷 순서와 무관해서 "폴더 일괄 가져오기"(파일명 정규식 추측)가
  // 못 맞는 경우가 많다. 사람이 썸네일을 보고 직접 컷에 배정. 영상은 이미지와 달리 컷당
  // 후보 개수 제한이 없으므로(videoClips는 이미 여러 클립 이어붙이기를 지원) A/B 캡 없음.
  const [matchOpen, setMatchOpen] = useState(false)
  const [matchTray, setMatchTray] = useState([])
  const [matchSelectedId, setMatchSelectedId] = useState(null)
  // 클립 URL이 가리키는 서버 파일이 (탐색기 등으로) 옮겨지거나 지워지면 <video>가 아무 안내
  // 없이 그냥 빈 화면으로만 뜬다 — "재생될 수 없는 빈 바탕"으로 보이는 문제(2026-09-16 실측:
  // 사용자가 05_video의 기존 파일을 before/로 옮긴 뒤 예전 클립칸이 빈 화면으로 보임).
  // url별로 로드 실패 여부만 기록해 명확한 안내 문구로 대체.
  const [videoLoadErrors, setVideoLoadErrors] = useState({})   // { [url]: true }
  // PIP 컷(CUT4류) 미리보기를 "배경 원본" ↔ "PIP 세그" 전환 — 별도 작은 <video>를 새로 만들면
  // 로딩이 불안정하고 깜빡인다는 실측 피드백(2026-09-17) — 기존에 이미 잘 동작하는 메인
  // 미리보기 <video>(에러처리·onLoadedData 다 갖춘)를 그대로 재사용하는 쪽으로 변경.
  const [pipPreviewMode, setPipPreviewMode] = useState({})     // { [cutId]: 'bg' | 'clip' }
  const matchFileInputRef = useRef(null)

  useEffect(() => {
    const id = setInterval(() => setGData(loadGPoints()), 2000)
    return () => clearInterval(id)
  }, [])

  // ── 영상 체크리스트 (수동 Veo 제작 대상 컷) ──────────────────────────
  const [vChk, setVChk] = useState(null)
  // VP 프롬프트 한 줄 생략(ellipsis) 미리보기 — 복붙하지 않고는 전체를 읽을 방법이 없어서
  // "프롬프트를 어디서 제대로 보나" 혼란이 있었음(2026-09-12). 클릭하면 그 컷만 전체 펼침.
  const [expandedVP, setExpandedVP] = useState({})
  const [vUpload, setVUpload] = useState({})   // { [cutNo]: { busy, keepAudio, result } }
  // loadVChk가 (StrictMode 이중 렌더 등으로) 겹쳐서 두 번 돌면 같은 컷을 동시에
  // 프록시로 불러오다가 로컬 서버가 간헐적 503을 뱉는 게 확인됨(2026-09-14) — 단일 실행 가드.
  const proxyAutoLoadInFlight = useRef(false)
  const loadVChk = useCallback(() => {
    const epNum = state.episode?.number
    if (epNum == null) { setVChk(null); return }
    fetch(`http://localhost:3001/api/episode-video-checklist?epNum=${epNum}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) return
        setVChk(d)
        // 이전 세션에서 이미 합성된 컷도(방금 이 브라우저에서 합성 안 해도) "최종 합성본"
        // 미리보기가 바로 보이게 — hasVideo인 컷마다 최초 1회 타임스탬프를 채워둔다.
        setFinalPreviewTs(p => {
          let changed = false
          const next = { ...p }
          const now = Date.now()
          for (const row of d.cuts || []) {
            const cut = (state.cuts || []).find(c => c.no === row.no)
            if (row.hasVideo && cut && next[cut.id] == null) { next[cut.id] = now; changed = true }
          }
          return changed ? next : p
        })
        // 서버엔 완성본(cut_NN.mp4)이 있는데 로컬 클립칸이 비어있으면 "프록시로 불러오기"를
        // 사람이 매번 눌러야 했다 — 폴더 후보와 같은 이유로 자동화한다(2026-09-14, 사용자
        // 재확인: "폴더에 있는 영상도 일부 만들어진 파일이 아직 업로드도 안 되고 있다").
        const currentClips = state.videoTabState?.videoClips || {}
        const toLoad = []
        for (const row of d.cuts || []) {
          if (!row.hasVideo) continue
          const cut = (state.cuts || []).find(c => c.no === row.no)
          // pipSegments가 있는 컷은 기존 cut_NN.mp4가 "세그 내용"이 아니라 PIP 배경 소스
          // 자체다(2026-09-17, CUT4류 self-composite 구조) — 자동으로 세그1 슬롯에 불러와버리면
          // 리액션 클립을 올릴 자리를 그 배경 파일이 차지해버려서 자동 로드를 건너뛴다.
          if (cut && !cut.pipSegments && !(currentClips[cut.id]?.length > 0)) toLoad.push(cut)
        }
        // 여러 컷을 동시에 프록시로 불러오면(HEAD 요청 병렬 폭주) 로컬 프록시 서버가
        // 간헐적으로 503을 뱉는 게 확인됨(2026-09-14) — 순차 + 약간의 텀 + 단일 실행 가드로 완화.
        if (toLoad.length > 0 && !proxyAutoLoadInFlight.current) {
          proxyAutoLoadInFlight.current = true
          ;(async () => {
            try {
              for (const cut of toLoad) {
                await loadFromProxy(cut, d.videoDir)
                await new Promise(r => setTimeout(r, 250))
              }
            } finally {
              proxyAutoLoadInFlight.current = false
            }
          })()
        }
      })
      .catch(() => {})
  }, [state.episode?.number, state.cuts?.length])
  useEffect(() => { loadVChk() }, [loadVChk])
  const setCutVideoMode = (cutNo, mode) => {
    const cut = (state.cuts || []).find(c => c.no === cutNo)
    if (cut?.id) dispatch({ type: 'UPDATE_CUT', id: cut.id, p: { videoMode: mode } })
    setTimeout(loadVChk, 100)
  }
  const uploadCutVideo = async (cutNo, file, keepAudio) => {
    const epNum = state.episode?.number
    if (!file || epNum == null) return
    const row = vChk?.cuts?.find(c => c.no === cutNo)
    const trimTo = row?.duration && row.duration > 0 ? `&trimTo=${row.duration}` : ''
    setVUpload(p => ({ ...p, [cutNo]: { ...p[cutNo], busy: true, result: null } }))
    try {
      const r = await fetch(
        `http://localhost:3001/api/upload-cut-video?epNum=${epNum}&cutNo=${cutNo}${trimTo}${keepAudio ? '&keepAudio=1' : ''}`,
        { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: file },
      )
      const d = await r.json()
      setVUpload(p => ({ ...p, [cutNo]: { busy: false, result: r.ok ? d : { error: d.error || '실패' } } }))
      if (r.ok) loadVChk()
    } catch (e) {
      setVUpload(p => ({ ...p, [cutNo]: { busy: false, result: { error: e.message } } }))
    }
  }

  const set = (p) => dispatch({ type: 'SET_VIDEO', p })
  // ⚠️ videoClips/g4Approved/subtitles는 항상 UPDATE_TAB_FIELD로 — 클로저(videoClips 등)에 대고
  // updater를 미리 계산해서 dispatch하면, stageClip처럼 비동기로 늦게 완료되는 콜백이 그 사이에
  // 쌓인 다른 컷/클립 갱신을 통째로 덮어써버림(2026-09-16 실측, 드래그 배정한 클립이 통째로
  // 사라지는 버그의 근본 원인). 리듀서 안에서 매번 최신 state를 보고 계산해야 이 레이스가 없다.
  const setVideoClips = (updater) => {
    if (typeof updater === 'function') dispatch({ type: 'UPDATE_TAB_FIELD', slice: 'videoTabState', field: 'videoClips', updater })
    else dispatch({ type: 'SET_VIDEO_TAB_STATE', p: { videoClips: updater } })
  }
  const setG4Approved = (updater) => {
    if (typeof updater === 'function') dispatch({ type: 'UPDATE_TAB_FIELD', slice: 'videoTabState', field: 'g4Approved', updater })
    else dispatch({ type: 'SET_VIDEO_TAB_STATE', p: { g4Approved: updater } })
  }
  const setSelectedCutId = (id) => {
    dispatch({ type: 'SET_VIDEO_TAB_STATE', p: { selectedCutId: id } })
  }
  const setSubtitles = (updater) => {
    if (typeof updater === 'function') dispatch({ type: 'UPDATE_TAB_FIELD', slice: 'videoTabState', field: 'subtitles', updater })
    else dispatch({ type: 'SET_VIDEO_TAB_STATE', p: { subtitles: updater } })
  }

  const selCutForText = cuts.find(c => c.id === selectedCutId)
  const clipsForText = selCutForText ? (videoClips[selCutForText.id] || []) : []
  const segsForText = selCutForText
    ? toSegments(effectiveCaptionValue(subtitles, selCutForText, clipsForText), stripMeta(selCutForText.dialogue || selCutForText.narration || ''), selCutForText.duration || 0)
    : []
  // 클립이 여러 개인 컷은 메인 미리보기에 지금 떠 있는 클립(selectedClipIdx)의 자막을 보여줌
  // — 클립을 바꿔 고르면 재생 영상과 자막이 같이 전환된다.
  const previewText = clipsForText.length > 1 ? (segsForText[selectedClipIdx]?.text ?? '') : (segsForText[0]?.text ?? '')
  const setPreviewText = (text) => {
    if (!selCutForText) return
    if (clipsForText.length > 1) {
      // 세그2처럼 아직 안 채운 자리는 clips에 null/구멍으로 남아있을 수 있음(2026-09-16,
      // 세그별 슬롯 지정 업로드 도입) — clipTimings가 그 자리를 undefined로 주므로 반드시
      // 폴백을 거쳐야 함. 이 폴백 없이 timings[i].start를 바로 읽으면 저장→새로고침 이후
      // null이 배열 구멍이 아니라 실제 값이 되면서 크래시로 이어짐(실측 확인).
      const plannedSegsForText = Array.isArray(selCutForText.segments) ? selCutForText.segments : []
      const timings = clipTimings(clipsForText, plannedSegsForText)
      setSubtitles(prev => {
        const cur = toSegments(effectiveCaptionValue(prev, selCutForText, clipsForText), '', selCutForText.duration || 0)
        const next = clipsForText.map((_, i) => {
          const t = timings[i] || { start: 0, end: 0 }
          return {
            start: t.start, end: t.end,
            text: i === selectedClipIdx ? text : (cur[i]?.text ?? ''),
          }
        })
        return { ...prev, [selCutForText.id]: next }
      })
    } else {
      setSubtitles(prev => ({ ...prev, [selCutForText.id]: text }))
    }
  }

  useEffect(() => {
    if (cuts.length > 0 && !selectedCutId) {
      setSelectedCutId(cuts[0].id)
    }
  }, [cuts])

  useEffect(() => { setSelectedClipIdx(0) }, [selectedCutId])

  // 화면비율은 컷/클립이 아니라 에피소드 콘텐츠 유형이 정하는 값이다(videoPolicy.js:
  // "LF/SF = 유튜브 가로(16:9), 나머지 = 세로(9:16)"). 예전엔 컷에 올라온 클립의 실제
  // 감지된 비율로 미리보기를 덮어썼는데, LF/SF 에피소드에 잘못된 비율의 클립이 올라오면
  // (감지 오류 또는 잘못된 파일 업로드) 미리보기가 그 컷을 볼 때마다 "쇼폼으로 고정"된
  // 것처럼 계속 잘못 표시되는 버그가 있었다(2026-09-13, 사용자 지적 — LF 작업라인인데
  // 컷을 옮겨다녀도 9:16에 갇혀 있었음). 컷을 바꿀 때마다 항상 에피소드 기준 비율로
  // 돌아가고, 클립 하나하나의 비율 불일치는 아래 클립 리스트의 뱃지(clipRatioBadge)로만
  // 경고한다 — 미리보기 자체를 잘못된 클립이 뒤흔들지 않게.
  useEffect(() => {
    setAspectRatio(contentRatio(episode))
  }, [selectedCutId, episode])

  const allG4Done = cuts.length > 0 && cuts.every(c => !needsFlowVideo(c.cutType) || g4Approved[c.id])

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

    // 배경이 밝거나 복잡한 화면에서도 글자가 읽히도록, 배경 스타일(박스/그림자)과 별개로
    // 항상 외곽선을 한 겹 깐다(2026-09-15, 사용자 지적: "색상 외에 글씨 외곽 테두리 효과
    // 정도는 있어야 할 것 같다"). 글자색이 밝으면 검은 테두리, 어두우면 흰 테두리로 자동 반전.
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, Math.round(fSize * 0.09))
    ctx.strokeStyle = isLightColor(color) ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)'
    ctx.fillStyle = color
    lines.forEach((l, i) => {
      const lineY = boxTop + padY + lineHeight * (i + 1) - (lineHeight - fSize) / 2
      ctx.strokeText(l, subX, lineY)
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
    cuts.forEach(c => { if (c.dialogue || c.narration) setGPoint(episodeCode, c.no, 'g3', true) })
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
      setGPoint(episodeCode, c.no, 'g3', true)
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

  const loadFromProxy = async (cut, videoDirOverride) => {
    const ep = episode?.number ?? ''
    const padded = String(cut.no).padStart(2, '0')
    for (const ext of ['mp4', 'mov', 'webm']) {
      const url = `${epMediaUrl(episode, 'video')}/cut_${padded}.${ext}?t=${Date.now()}`
      try {
        let r = await fetch(url, { method: 'HEAD' })
        // 페이지 로딩 직후엔 다른 요청(파형/필름스트립 등)이 몰려서 로컬 프록시가 간헐적으로
        // 5xx를 뱉는 게 확인됨(2026-09-14) — 존재하는 파일을 놓치지 않도록 한 번만 재시도.
        if (!r.ok && r.status >= 500) {
          await new Promise(res => setTimeout(res, 800))
          r = await fetch(url, { method: 'HEAD' })
        }
        if (r.ok) {
          const name = `cut_${padded}.${ext}`
          const lastModifiedHeader = r.headers.get('Last-Modified')
          const createdAt = lastModifiedHeader ? new Date(lastModifiedHeader).getTime() : Date.now()
          const vid = document.createElement('video')
          vid.preload = 'metadata'
          vid.onloadedmetadata = () => {
            const dur = Math.round(vid.duration * 100) / 100
            const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
            // 프록시로 불러온 클립은 이미 서버 실파일이라 재업로드 없이 stagedPath를 바로 채움
            // (2026-09-13 — "클립 합성"이 이 경로를 그대로 입력으로 씀).
            const dir = videoDirOverride || vChk?.videoDir
            const stagedPath = dir ? `${dir}\\${name}` : undefined
            const obj = { url, name, duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true, ratio, stagedPath, keepAudio: !!cut.dialogue, createdAt }
            setVideoClips(p => {
              const existing = p[cut.id] || []
              if (existing.some(c => c && c.url === url)) return p
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

  // 스튜디오 탭의 "폴더에서 일괄 가져오기"(이미지, normalizeCutImages)와 동일한 패턴을
  // 영상에도 만들어달라는 요청(2026-09-13) — 05_video/ 폴더에 느슨한 이름으로 던져둔 영상을
  // cut_NN_x.mp4로 일괄 리네임 + 컷별 후보 목록을 스캔해온다. 후보는 이미 서버 파일이라
  // stagedPath가 바로 채워짐(재업로드 불필요, "프록시"와 같은 성격).
  const [videoCandidates, setVideoCandidates] = useState({})   // { [cutNo]: [{name,url,path,slot}] }
  const loadVideoCandidates = useCallback(() => {
    const epNum = state.episode?.number
    if (epNum == null) return
    fetch(`http://localhost:3001/api/scan-cut-videos?epNum=${epNum}`)
      .then(r => r.json())
      .then(d => {
        const byCut = {}
        for (const c of d.clips || []) (byCut[c.cutNo] ??= []).push(c)
        setVideoCandidates(byCut)
        // 폴더에서 찾은 후보는 "+" 버튼을 눌러야만 클립칸에 들어갔는데, 사람이 매번 눌러줘야
        // 하는 건 원래 요청("파일명 인식해서 해당 컷에 업로드")과 다르다(2026-09-14, 사용자
        // 재확인: "그래서 아까 업로드 되도록 요청했던 것"). 이제 스캔되는 즉시 자동으로 클립칸에
        // 채운다 — addCandidateClip 내부에 이미 stagedPath 중복 방지가 있어 계속 자동
        // 호출해도 안전(이미 추가된 건 조용히 무시됨).
        // ⚠️ 컷이 이미 계획된 세그 개수(cut.segments.length)만큼 다 채워져 있으면 더 이상
        // 자동으로 안 채운다 — 안 그러면 05_video에 남아있는 옛날 단독 파일(예: cut_02_a.mp4)이
        // 스캔될 때마다 계속 "세그3"으로 끼어들어서 무한히 다시 나타나는 버그가 있었음
        // (2026-09-17 실측: "컷2는 세그3번 파일이 계속 생성된다").
        const currentClips = state.videoTabState?.videoClips || {}
        for (const c of d.clips || []) {
          const cut = (state.cuts || []).find(x => x.no === c.cutNo)
          if (!cut) continue
          const plannedLen = Array.isArray(cut.segments) ? cut.segments.length : Infinity
          const haveLen = (currentClips[cut.id] || []).filter(Boolean).length
          if (haveLen >= plannedLen) continue
          addCandidateClip(cut.id, cut.no, c)
        }
      })
      .catch(() => {})
  }, [state.episode?.number, state.cuts?.length])
  useEffect(() => { loadVideoCandidates() }, [loadVideoCandidates])

  const importVideosFromFolder = async () => {
    const epNum = state.episode?.number
    if (epNum == null) return
    try {
      const r = await fetch('http://localhost:3001/api/import-cut-videos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep: epNum }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '가져오기 실패')
      const msg = [
        `📁 영상 파일명 정리: ${d.renamed?.length || 0}개`,
        ...(d.renamed || []).map(x => `  ${x.from} → ${x.to}`),
        ...(d.skipped?.length ? ['', `⚠️ 스킵 ${d.skipped.length}개(파일명에서 컷번호 못 찾음):`, ...d.skipped.map(x => `  ${x.file}`)] : []),
      ].join('\n')
      if ((d.renamed?.length || 0) + (d.skipped?.length || 0) > 0) alert(msg)
      loadVideoCandidates()
    } catch (e) {
      alert('영상 폴더 가져오기 실패: ' + e.message)
    }
  }

  // 스캔된 후보 클립을 그 컷의 videoClips에 추가 — 이미 서버 파일이라 stagedPath를 바로 채움.
  const addCandidateClip = (cutId, cutNo, candidate) => {
    const url = `http://localhost:3001${candidate.url}?t=${Date.now()}`
    const cut = (state.cuts || []).find(c => c.id === cutId)
    const vid = document.createElement('video')
    vid.preload = 'metadata'
    vid.onloadedmetadata = () => {
      const dur = Math.round(vid.duration * 100) / 100
      const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
      const obj = {
        url, name: candidate.name, duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true,
        ratio, stagedPath: candidate.path, keepAudio: !!cut?.dialogue,
        createdAt: candidate.mtime || Date.now(),
      }
      setVideoClips(p => {
        const existing = p[cutId] || []
        if (existing.some(c => c && c.stagedPath === candidate.path)) return p
        return { ...p, [cutId]: [...existing, obj] }
      })
    }
    vid.src = url
  }

  // 로컬 업로드한 클립을 실제 서버 파일로도 스테이징(2026-09-13) — 예전엔 blob: URL만 만들고
  // 서버엔 아무것도 안 남겨서 "클립 합성"이 실제 출력을 못 만들었다. 클립을 blob URL로 식별해서
  // 스테이징 완료 시 그 클립에만 stagedPath를 채워넣는다(다른 클립 추가/삭제와 섞여도 안전).
  const stageClip = async (cutId, cutNo, idx, file, matchUrl) => {
    const epNum = state.episode?.number
    if (epNum == null) return
    try {
      const r = await fetch(`http://localhost:3001/api/stage-cut-clip?epNum=${epNum}&cutNo=${cutNo}&idx=${idx}`,
        { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: file })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '스테이징 실패')
      setVideoClips(p => {
        const arr = [...(p[cutId] || [])]
        // ⚠️ arr에 세그2처럼 빈 슬롯(null)이 섞여있을 수 있음 — 가드 없이 c.url을 읽으면
        // null 원소에서 크래시(2026-09-16 실측: "클립 업로드 순간 화면이 하얗게 죽는다"의
        // 진짜 원인 — handleVideoUpload의 targetIdx 낙관적 갱신 자체가 아니라 이 완료
        // 콜백에서 터졌음).
        const i = arr.findIndex(c => c && c.url === matchUrl)
        if (i >= 0) arr[i] = { ...arr[i], stagedPath: d.path, staging: false }
        return { ...p, [cutId]: arr }
      })
    } catch (e) {
      setVideoClips(p => {
        const arr = [...(p[cutId] || [])]
        const i = arr.findIndex(c => c && c.url === matchUrl)
        if (i >= 0) arr[i] = { ...arr[i], staging: false, stageError: e.message }
        return { ...p, [cutId]: arr }
      })
    }
  }

  // targetIdx가 주어지면(세그먼트별 빈 슬롯 업로드 버튼) 배열 끝에 append하지 않고 그 자리에
  // 바로 꽂는다 — 세그1/3만 만들고 세그2는 나중에 채울 때, append 방식으로는 세그3 파일이
  // 세그2 자리로 밀려 들어가버리는 문제가 있었음(2026-09-16, 사용자 지적). 중간이 비면 배열이
  // sparse해지는데, 렌더 쪽은 어차피 clips[idx]로 읽어서 빈 자리는 그대로 "파일 없음"으로 보임.
  const handleVideoUpload = (cutId, files, targetIdx = null) => {
    const cut = (state.cuts || []).find(c => c.id === cutId)
    Array.from(files).forEach((f) => {
      const url = URL.createObjectURL(f)
      const vid = document.createElement('video')
      vid.preload = 'metadata'
      vid.onloadedmetadata = () => {
        const dur = Math.round(vid.duration * 100) / 100
        const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
        const obj = { url, name: f.name, duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true, ratio, staging: true, keepAudio: !!cut?.dialogue, createdAt: f.lastModified || Date.now() }
        // ⚠️ setVideoClips는 이제 UPDATE_TAB_FIELD로 리듀서 안에서 나중에 계산되므로(스테일
        // 클로저 버그 수정, 2026-09-16), updater 콜백 안에서 바깥 clipIdx 변수를 대입해도
        // 그 대입은 "언젠가 리듀서가 처리할 때" 일어나지, 바로 아래 stageClip 호출 시점엔
        // 아직 실행 전이라 clipIdx가 항상 초기값(-1)인 채로 넘어가버림 — 실측 확인(2026-09-17,
        // 세그1·세그3이 둘 다 cut_NN_clip_-1.mp4로 스테이징되어 서로 덮어씀). targetIdx가
        // 있는 경우는 애초에 updater 안 거치고 바로 쓰면 되고, append(끝에 추가) 경우는
        // "existing.length"를 동기적으로 알 방법이 없으니 충돌 걱정 없는 고유값(타임스탬프)을 씀.
        const clipIdx = targetIdx != null ? targetIdx : `new${Date.now()}`
        setVideoClips(p => {
          const existing = p[cutId] || []
          if (targetIdx != null) {
            const arr = [...existing]
            arr[targetIdx] = obj
            return { ...p, [cutId]: arr }
          }
          return { ...p, [cutId]: [...existing, obj] }
        })
        if (cut) stageClip(cutId, cut.no, clipIdx, f, url)
      }
      vid.src = url
    })
  }

  // ── 드래그 배정: 트레이에 추가된 파일을 사람이 컷에 직접 배정 ─────────────
  const addMatchClips = (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('video/'))
    files.forEach((f) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const url = URL.createObjectURL(f)
      setMatchTray(prev => [...prev, { id, file: f, url, duration: null, ratio: '16:9', ready: false, error: null }])
      const vid = document.createElement('video')
      vid.preload = 'metadata'
      vid.onloadedmetadata = () => {
        const dur = Math.round(vid.duration * 100) / 100
        const ratio = vid.videoWidth >= vid.videoHeight ? '16:9' : '9:16'
        setMatchTray(prev => prev.map(x => x.id === id ? { ...x, duration: dur, ratio, ready: true } : x))
      }
      vid.onerror = () => setMatchTray(prev => prev.map(x => x.id === id ? { ...x, error: '메타데이터를 읽지 못했습니다' } : x))
      vid.src = url
    })
  }

  // 배정 즉시 videoClips에 추가하고 stageClip으로 실제 서버 파일도 만든다(로컬 업로드와 동일
  // 경로) — 스테이징 진행/실패는 그 컷 카드의 기존 클립칸 배지(⚠ 서버 미반영 등)로 보인다.
  const assignMatchClip = (item, cut) => {
    if (!item.ready) { alert('아직 이 파일의 정보를 불러오는 중입니다 — 잠시 후 다시 시도해주세요.'); return }
    const obj = {
      url: item.url, name: item.file.name, duration: item.duration, trimStart: 0, trimEnd: item.duration,
      useFullDuration: true, ratio: item.ratio, staging: true, keepAudio: !!cut.dialogue,
      createdAt: item.file.lastModified || Date.now(),
    }
    // handleVideoUpload과 동일 이유 — updater 안에서의 clipIdx 대입은 리듀서가 처리할 때까지
    // 미뤄지므로 여기서 곧장 못 읽는다. 충돌 걱정 없는 고유값(타임스탬프)을 대신 씀.
    const clipIdx = `new${Date.now()}`
    setVideoClips(p => {
      const existing = p[cut.id] || []
      return { ...p, [cut.id]: [...existing, obj] }
    })
    stageClip(cut.id, cut.no, clipIdx, item.file, item.url)
    setMatchTray(prev => prev.filter(x => x.id !== item.id))
    setMatchSelectedId(prev => (prev === item.id ? null : prev))
  }

  const removeMatchItem = (item) => {
    URL.revokeObjectURL(item.url)
    setMatchTray(prev => prev.filter(x => x.id !== item.id))
    setMatchSelectedId(prev => (prev === item.id ? null : prev))
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
    // 인스타 콘텐츠 에피소드는 G2 승인 이미지가 downloads/flow/ep{N}/이 아니라
    // downloads/insta/{content}/{num}/에 있다(StudioTab.jsx의 스캔 요청과 동일 규칙) —
    // 안 보내면 CUT4처럼 실제 이미지가 있어도 "G2 이미지가 없습니다" 오류가 난다
    // (2026-08-23 실측: /api/scan-images가 ep{N} 폴더만 봐서 IG_R02 CUT4를 못 찾던 버그).
    const instaContent = cuts.map(c => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean)
      || episodeContentTypeToInsta(episode?.contentType)
    const instaNum = instaContent ? (episode?.instaNum?.trim() || '') : ''
    const qs = new URLSearchParams({ ep, instaContent: instaContent || '', instaNum, episodeCode })
    const scanRes = await fetch(`http://localhost:3001/api/scan-images?${qs}`)
    const data = await scanRes.json()
    const match = data.images?.find(img => img.cutNo === cut.no)
    if (!match) throw new Error(`CUT ${cut.no}의 G2 이미지가 없습니다. 스튜디오 탭에서 먼저 이미지를 생성/승인하세요.`)
    const confirmRes = await fetch('http://localhost:3001/api/confirm-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // instaContent/instaNum을 같이 보내면, G2 이미지를 실제로 만든 Flow 프로젝트(project_url.txt)를
      // G4가 보는 표준 위치(downloads/flow/ep{N}/)에도 맞춰준다 — 안 그러면 G4가 레퍼런스
      // 이미지도 없는 무관한 예전 프로젝트로 연결될 수 있다(2026-08-23 실측).
      body: JSON.stringify({ ep, cutNo: cut.no, imageUrl: match.url, instaContent, instaNum }),
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
                if (existing.some(c => c && c.url === url)) return p
                return {
                  ...p,
                  [cut.id]: [...existing, {
                    url,
                    name: `AI 생성 (cut_${String(cut.no).padStart(2, '0')}.mp4)`,
                    duration: dur, trimStart: 0, trimEnd: dur, useFullDuration: true, ratio, createdAt: Date.now(),
                  }],
                }
              })
              setVideoGenStatus(p => ({ ...p, [cut.id]: 'done' }))
              setVideoGenLog(p => ({ ...p, [cut.id]: '✅ 생성 완료' }))
            } else if (ev.type === 'cut_error' && ev.cutNo === cut.no) {
              setVideoGenStatus(p => ({ ...p, [cut.id]: 'error' }))
              setVideoGenLog(p => ({ ...p, [cut.id]: '❌ 생성 실패' }))
            } else if (ev.type === 'complete') {
              // cut_video/cut_error 이벤트로 이 컷의 상태가 이미 정해졌으면 그대로 둔다.
              // 문제는 success:true인데도 이 컷에 대한 cut_video가 한 번도 안 온 경우
              // (예: video-automation.js가 "이미 완료됨"으로 보고 아무것도 안 하고 끝난
              // 경우) — 이때 상태를 안 풀어주면 "생성 중…"에 영구히 멈춰서 버튼을 다시
              // 누를 수도 없게 된다(2026-08-23 실측으로 발견).
              setVideoGenStatus(p => {
                if (p[cut.id] !== 'running') return p
                return { ...p, [cut.id]: ev.success ? undefined : 'error' }
              })
              if (ev.success) {
                setVideoGenLog(p => ({ ...p, [cut.id]: '⚠️ 완료 신호는 왔지만 이 컷의 새 영상은 확인 안 됨 — 스캔 다시 불러오거나 재시도해주세요' }))
              }
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

  // 편집메타 탭에서 고른 효과음(cut.sfxFile, downloads/ 기준 상대경로)을 이 탭이
  // 항상 써온 절대경로 관례(C:\yeori-studio\downloads\...)로 변환.
  const sfxAbsolutePath = (cut) => cut?.sfxFile ? `C:\\yeori-studio\\downloads\\${cut.sfxFile.replace(/\//g, '\\')}` : undefined

  const runFfmpegForCut = async (cut) => {
    setFfmpegStatus(p => ({ ...p, [cut.id]: 'running' }))
    setFfmpegLog(p => ({ ...p, [cut.id]: '합성 시작…' }))
    try {
      const ep = episode?.number ?? ''
      const res = await fetch('http://localhost:3001/api/run-ffmpeg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ep, cutNo: cut.no, duration: cut.duration || 8,
          sfxFile: sfxAbsolutePath(cut), sfxStart: cut.sfxStart,
        }),
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
                    duration: cut.duration || 8, trimStart: 0, trimEnd: cut.duration || 8, useFullDuration: true, ratio, createdAt: Date.now(),
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

  // 컷별 카드의 클립(videoClips)을 실제로 이어붙여 서버의 진짜 cut_NN.mp4를 만든다
  // (2026-09-13 — 로컬 클립 편집이 지금까지 미리보기용 blob: URL일 뿐이라 실제 출력에
  // 반영이 안 됐던 문제의 해결책). order 순서(배열 순서) 그대로 보냄, stagedPath 없는
  // 클립(아직 스테이징 중)이 있으면 막는다.
  const renderCutClips = async (cut) => {
    const clips = videoClips[cut.id] || []
    if (!clips.length) return
    // ⚠️ clips 배열에 구멍이 있을 수 있음(세그1/3만 채우고 세그2는 비워둔 경우, 2026-09-16
    // 세그별 슬롯 지정 업로드 도입) — some/map은 구멍을 그냥 건너뛰어서 이 체크 없이는 세그2가
    // 통째로 빠진 채(1+3만 이어붙여서) 조용히 렌더되어버린다. 렌더 전에 반드시 빈 슬롯부터 막는다.
    const plannedSegs = Array.isArray(cut.segments) ? cut.segments : []
    const slotCount = Math.max(clips.length, plannedSegs.length)
    const missingIdx = []
    for (let i = 0; i < slotCount; i++) { if (!clips[i]) missingIdx.push(i + 1) }
    if (missingIdx.length) {
      setComposeLog(p => ({ ...p, [cut.id]: `⚠️ 세그먼트 ${missingIdx.join(', ')}번이 비어있습니다 — 먼저 채워주세요` }))
      return
    }
    const notReady = clips.some(c => !c.stagedPath)
    if (notReady) {
      setComposeLog(p => ({ ...p, [cut.id]: '⚠️ 아직 서버로 올라가는 중인 클립이 있습니다 — 잠시 후 다시 시도해주세요' }))
      return
    }
    setComposeStatus(p => ({ ...p, [cut.id]: 'running' }))
    setComposeLog(p => ({ ...p, [cut.id]: '클립 합성 중…' }))
    try {
      const epNum = state.episode?.number
      // pipSegments(1-인덱스 세그번호 → {target,layout,scale}) 지정된 세그가 있으면, 이어붙이기
      // 전에 먼저 그 세그만 배경 컷 위에 PIP로 합성해서 결과 파일로 바꿔치기한다
      // ([[project_script_prompt_qc_guards]] "PIP" 설계를 실제로 구현, 2026-09-17).
      const pipSegs = cut.pipSegments || {}
      // targetSegIdx로 배경 소스로만 쓰이는 세그(예: 세그1=화면녹화)는 최종 이어붙이기에서
      // 제외 — 안 그러면 [배경 단독][배경+리액션 PIP]가 순서대로 붙어서 배경이 두 번 나온다
      // (2026-09-17, CUT3처럼 클립1/2 업로드하는 구조로 바꾸면서 새로 생긴 위험).
      const pipBgSegIndices = new Set(
        Object.values(pipSegs).filter(spec => spec.targetSegIdx != null).map(spec => Number(spec.targetSegIdx))
      )
      const clipsForRender = clips
        .map((c, i) => ({ i, c }))
        .filter(({ i }) => !pipBgSegIndices.has(i))
        .map(({ c }) => ({
          file: c.stagedPath, trimStart: c.trimStart, trimEnd: c.trimEnd,
          useFullDuration: c.useFullDuration, keepAudio: c.keepAudio,
        }))
      // 위에서 배경 세그를 걸러냈으니, 이후 pip 루프의 idx(원본 clips 인덱스)를
      // clipsForRender 인덱스로 재매핑해야 한다.
      const origToRenderIdx = {}
      { let r = 0; clips.forEach((c, i) => { if (!pipBgSegIndices.has(i)) { origToRenderIdx[i] = r; r++ } }) }
      for (const [segNoStr, spec] of Object.entries(pipSegs)) {
        const idx = Number(segNoStr) - 1
        if (idx < 0 || idx >= clips.length || origToRenderIdx[idx] == null) continue
        // 2026-09-18 재설계 — 리액션은 이제 컷3/5/7(발화 컷) 쪽 클립을 그대로 재사용한다
        // (pipSourceCutNo+pipSourceClipIdx). targetSegIdx(같은 컷 내 세그)·targetCutNo(예전
        // 자기참조 방식)는 이 컷에 남은 레거시 데이터가 있을 때만 폴백으로 지원.
        const usingPipSource = spec.pipSourceCutNo != null && spec.pipSourceClipIdx != null
        const bgLabel = usingPipSource ? `CUT${spec.pipSourceCutNo} 클립${Number(spec.pipSourceClipIdx) + 1}`
          : spec.targetSegIdx != null ? `세그${Number(spec.targetSegIdx) + 1}` : `CUT${spec.target}`
        setComposeLog(p => ({ ...p, [cut.id]: `세그${segNoStr} PIP 합성 중 (${bgLabel} 재사용)…` }))
        const pr = await fetch('http://localhost:3001/api/render-pip-composite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            epNum, cutNo: cut.no, segIdx: idx,
            pipSourceCutNo: spec.pipSourceCutNo, pipSourceClipIdx: spec.pipSourceClipIdx,
            targetSegIdx: usingPipSource ? undefined : spec.targetSegIdx,
            targetCutNo: (usingPipSource || spec.targetSegIdx != null) ? undefined : spec.target,
            layout: spec.layout, scale: spec.scale, bgVolume: spec.bgVolume,
            // 지정 안 하면 서버가 "배경 길이 - PIP 길이"로 자동 계산(=PIP가 배경 끝과 동시에
            // 끝남). 사용자가 다른 타이밍을 원하면 pipSegments[idx].pipDelay(초)로 수동 지정.
            delay: typeof spec.pipDelay === 'number' ? spec.pipDelay : undefined,
          }),
        })
        const pd = await pr.json()
        if (!pr.ok) throw new Error(`세그${segNoStr} PIP 합성 실패: ${pd.error || pr.status}`)
        // 합성 결과는 이미 PIP 클립 길이로 -t 트림돼 있으므로 그대로 전체 사용.
        clipsForRender[origToRenderIdx[idx]] = { file: pd.outputPath, useFullDuration: true, keepAudio: true }
      }
      setComposeLog(p => ({ ...p, [cut.id]: '클립 이어붙이는 중…' }))
      const r = await fetch('http://localhost:3001/api/render-cut-clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum, cutNo: cut.no, clips: clipsForRender }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '합성 실패')
      setComposeStatus(p => ({ ...p, [cut.id]: 'done' }))
      setComposeLog(p => ({ ...p, [cut.id]: `✅ 합성 완료 (${d.sizeKB}KB, ${d.duration?.toFixed(1)}s)` }))
      setFinalPreviewTs(p => ({ ...p, [cut.id]: Date.now() }))
      // 배경 세그(pipBgSegIndices)의 실제 파일은 방금 render-cut-clips 결과로 디스크에서
      // 덮어써졌는데, 그 세그의 클립 url은 예전 캐시버스팅(?t=...) 그대로라 브라우저가 계속
      // 옛 프레임(PIP 합성 전 화면)을 보여주는 문제가 있었음(2026-09-17, 사용자 지적: "PIP
      // 화면에 같은 화면이 들어간다" — 서버 파일 자체는 ffprobe로 확인해보니 정상 합성돼
      // 있었고, 브라우저 미리보기만 캐시된 옛 파일을 보여주고 있었음). 그 세그들의 url을
      // 새 타임스탬프로 강제 갱신해 즉시 재요청되게 한다.
      if (pipBgSegIndices.size > 0) {
        setVideoClips(p => {
          const arr = [...(p[cut.id] || [])]
          for (const idx of pipBgSegIndices) {
            const c = arr[idx]
            if (!c) continue
            const fresh = resolveClipSrc({ ...c, url: '' })
            if (!fresh) continue
            arr[idx] = { ...c, url: `${fresh}${fresh.includes('?') ? '&' : '?'}t=${Date.now()}` }
          }
          return { ...p, [cut.id]: arr }
        })
      }
      loadVChk()
    } catch (e) {
      setComposeStatus(p => ({ ...p, [cut.id]: 'error' }))
      setComposeLog(p => ({ ...p, [cut.id]: `❌ ${e.message}` }))
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

    const meta = cuts.map(c => ({
      cutNo: c.no,
      label: `CUT ${String(c.no).padStart(2, '0')}`,
      duration: c.duration || 8,
      sfxOnly: c.sfxOnly || false,
      sfxFile: sfxAbsolutePath(c),
      sfxStart: c.sfxStart,
    }))

    try {
      const res = await fetch('http://localhost:3001/api/ffmpeg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum: ep, meta }),
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
                const url = `${epMediaUrl(episode, 'video')}/output_final/C${padded}_final.mp4?t=${Date.now()}`
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
    <div className={s.page}>
      <TabToolbar
        actions={[
          { key: 'srt', label: '📄 SRT', onClick: exportSRT },
          { key: 'load-all', label: '🔄 불러오기', onClick: loadAllFromProxy },
          { key: 'import-videos', label: '📁 폴더에서 일괄 가져오기', onClick: importVideosFromFolder },
          {
            key: 'match-videos', variant: 'purple',
            label: matchOpen ? '🎯 드래그 배정 닫기' : '🎯 드래그 배정',
            onClick: () => setMatchOpen(o => !o),
          },
          {
            key: 'ai-all',
            disabled: cuts.some(c => videoGenStatus[c.id] === 'running'),
            label: cuts.some(c => videoGenStatus[c.id] === 'running') ? '⏳ 생성 중…' : '✨ 전체 AI 생성',
            onClick: async () => {
              // CAPCUT/GRAPHIC 컷은 Flow+Veo3 생성 대상이 아니라(메이킹 탭에서 직접 제작)
              // G2 이미지 자체가 없다 — 그냥 돌리면 매번 "G2 이미지가 없습니다" 오류만 남기고
              // 아무 의미 없이 실패 처리됨(2026-08-23 실측). 애초에 대상에서 제외한다.
              for (const c of cuts.filter(c => needsFlowVideo(c.cutType))) {
                if (videoGenStatus[c.id] === 'running') continue
                await generateVideoForCut(c)
              }
            },
          },
          {
            key: 'g4-all', done: allG4Done,
            label: allG4Done ? '전체 취소' : 'G4 전체',
            onClick: () => {
              const next = !allG4Done
              // 마찬가지로 이미지 자체가 없는 CAPCUT/GRAPHIC 컷엔 의미 없는 g4 플래그를
              // 찍지 않는다.
              cuts.filter(c => needsFlowVideo(c.cutType)).forEach(c => {
                setG4Approved(p => ({ ...p, [c.id]: next }))
                setGPoint(episodeCode, c.no, 'g4', next)
              })
            },
          },
          {
            key: 'ffmpeg-batch', done: batchFfmpegStatus === 'done',
            disabled: cuts.length === 0 || batchFfmpegStatus === 'running',
            label: batchFfmpegStatus === 'running'
              ? `⏳ 합성 중… (${batchFfmpegProgress.current}/${batchFfmpegProgress.total})`
              : '🎬 전체 일괄 합성',
            onClick: runFfmpegBatchAll,
          },
        ]}
      />
    <div className={s.root}>
      {/* Sidebar */}
      <div className={s.sidebar}>
        <EpisodeOverviewBlock />
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
              <div className={s.sidePanelRow2}>
                <div className={s.field}>
                  <label>글씨체</label>
                  <select value={font} onChange={e => set({ font: e.target.value })} disabled={!subtitleEnabled}>
                    {FONTS.map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
                <div className={s.field}>
                  <label>배경 스타일</label>
                  <select value={bgStyle} onChange={e => set({ bgStyle: e.target.value })} disabled={!subtitleEnabled}>
                    {BG_STYLES.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
              </div>
              <div className={s.field}>
                <label>글자 크기 <span className={s.val}>{fontSize}px</span></label>
                <input type="range" min="16" max="72" value={fontSize} disabled={!subtitleEnabled}
                  onChange={e => set({ fontSize: parseInt(e.target.value) })} />
              </div>
              <div className={s.sidePanelRow2}>
                <div className={s.field}>
                  <label>글자 색상</label>
                  <div className={s.colorRow}>
                    <input type="color" value={color} disabled={!subtitleEnabled}
                      onChange={e => set({ color: e.target.value })} className={s.colorPicker} />
                    <span className={s.colorVal}>{color}</span>
                  </div>
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
            </div>
          )}
        </div>

        {batchFfmpegLog && <div className={s.ffmpegLog}>{batchFfmpegLog}</div>}

        <div className={s.g4Count}>G4 완료: {Object.values(g4Approved).filter(Boolean).length} / {cuts.length}</div>

        <div className={s.cutSideList}>
          <div className={s.cutSideListHeader}>컷 목록</div>
          <CutList
            cuts={cuts} gData={gData} episodeCode={episodeCode} maxStage={4}
            activeCutId={selectedCutId}
            onCutClick={c => {
              setSelectedCutId(c.id)
              // 컷 목록 클릭 시 해당 컷 카드로 스크롤 이동(2026-09-13, 사용자 지적: "컷목록과
              // 해당화면 연동 문제 — 목록 클릭하면 해당 컷화면 영역으로 스크롤 이동기능 필요")
              document.getElementById(`video-cutcard-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            renderPreview={c => {
              const clips = videoClips[c.id] || []
              // clips[0].url을 그대로 쓰면 새로고침 후 죽은 blob: URL이라 검은 칸만 보였음
              // (컷6·8만 멀쩡했던 건 그 둘만 서버 다운로드 URL을 갖고 있었기 때문 —
              // 2026-09-18, 사용자 지적: "썸네일도 언제부터인지 누락"). 본문 미리보기와
              // 동일하게 stagedPath 기반 폴백을 쓴다.
              const thumbSrc = resolveClipSrc(clips[0])
              return thumbSrc
                ? <video src={thumbSrc} className={s.cutSideThumb} muted />
                : <div className={s.cutSideThumbEmpty}>🎬</div>
            }}
            previewText={c => {
              const clips = videoClips[c.id] || []
              const estCount = estimateClipCount(c.duration || 5)
              const statusText = clips.length > 0
                ? `영상 ${clips.length}개`
                : (estCount > 1 ? `영상 없음 · 예상 ${estCount}개 필요` : '영상 없음')
              return statusText + (g4Approved[c.id] ? ' · ✅' : '')
            }}
            renderExtra={c => (
              <>
                {videoGenStatus[c.id] === 'running' && <span className={s.sideGenBadge}>⏳생성중</span>}
                {videoGenStatus[c.id] === 'done' && <span className={s.sideGenBadgeDone}>✅완료</span>}
                {videoGenStatus[c.id] === 'error' && <span className={s.sideGenBadgeError}>❌오류</span>}
                <button
                  className={`${s.sideAiBtn} ${videoGenStatus[c.id] === 'running' ? s.sideAiBtnRunning : ''}`}
                  disabled={videoGenStatus[c.id] === 'running'}
                  onClick={() => generateVideoForCut(c)}
                  title={`CUT ${c.no} AI 영상 생성`}
                >
                  {videoGenStatus[c.id] === 'running' ? '⏳' : '✨'}
                </button>
              </>
            )}
          />
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

      <div className={s.scrollBody}>

      {/* ── "영상 체크리스트"(VP 프롬프트/완성본 업로드)와 "컷별 카드"(로컬 클립 편집)로
          이원화돼 있던 구조를 하나로 통합(2026-09-13, 사용자 지적) — VP 프롬프트/videoMode/
          완성본 업로드는 이제 각 컷 카드(mainSplitCol) 안에 들어있다. vChk 요약 배지만 남김. */}
      {vChk && (
        <div className={s.vChkSummary}>
          정책: {vChk.policy === 'video-first' ? '영상 중심(LF)' : vChk.policy === 'mixed' ? '혼합(SF)' : '이미지+모션 중심(IG)'}
          {' · '}Veo 필요 <b>{vChk.veoNeeded}</b>컷 · 완료 <b>{vChk.veoDone}</b>
          {vChk.videoDir && <span className={s.vChkDir}> · 📁 {vChk.videoDir}</span>}
        </div>
      )}

      {/* 🎯 드래그 배정 — 파일명 대신 사람이 보고 컷에 직접 배정(이미지 탭과 동일 패턴) */}
      {matchOpen && (
        <div style={{
          background:'var(--surface2)', border:'1px solid var(--border)',
          borderRadius:8, padding:'12px 16px', margin:'0 0 12px',
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{fontWeight:700,color:'var(--purple)',fontSize:13}}>🎯 드래그 배정</div>
            <button onClick={() => setMatchOpen(false)}
              style={{background:'transparent',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:11}}>✕ 닫기</button>
          </div>
          <div style={{fontSize:11.5,color:'var(--text3)',marginBottom:10,lineHeight:1.5}}>
            Flow/Veo 등에서 받은 영상 파일(파일명 무관)을 아래에 추가한 뒤, 썸네일을 원하는 컷 카드로 <b>드래그</b>하거나,
            썸네일을 클릭해 선택한 다음 컷 카드를 <b>클릭</b>해서 배정하세요(터치 화면 대응). 컷당 클립 개수 제한은 없습니다.
          </div>
          <input ref={matchFileInputRef} type="file" accept="video/*" multiple style={{display:'none'}}
            onChange={e => { addMatchClips(e.target.files); e.target.value = '' }} />
          <button onClick={() => matchFileInputRef.current?.click()}
            style={{background:'var(--purple)',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:10}}>
            + 파일 추가
          </button>
          {matchTray.length === 0 ? (
            <div style={{fontSize:11.5,color:'var(--text3)',padding:'8px 0'}}>추가된 파일이 없습니다.</div>
          ) : (
            <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:4}}>
              {matchTray.map(item => (
                <div key={item.id}
                  draggable={item.ready}
                  onDragStart={e => e.dataTransfer.setData('text/plain', item.id)}
                  onClick={() => item.ready && setMatchSelectedId(prev => prev === item.id ? null : item.id)}
                  title={item.file.name}
                  style={{
                    position:'relative', width:110, cursor: item.ready ? 'grab' : 'wait',
                    border: matchSelectedId === item.id ? '2px solid var(--purple)' : '2px solid var(--border)',
                    borderRadius:8, overflow:'hidden', opacity: item.ready ? 1 : 0.6,
                    background:'#000',
                  }}>
                  <video src={item.url} muted draggable={false} style={{width:'100%',height:66,objectFit:'cover',display:'block',pointerEvents:'none'}} />
                  <div style={{fontSize:9,color:'var(--text3)',padding:'2px 4px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {item.file.name}{item.duration != null ? ` · ${item.duration}s` : ''}
                  </div>
                  <button onClick={e => { e.stopPropagation(); removeMatchItem(item) }}
                    style={{
                      position:'absolute', top:2, right:2, width:18, height:18, lineHeight:'18px',
                      background:'rgba(0,0,0,.6)', color:'#fff', border:'none', borderRadius:4,
                      fontSize:11, cursor:'pointer', padding:0,
                    }}>✕</button>
                  {!item.ready && !item.error && (
                    <div style={{position:'absolute',inset:0,bottom:18,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#fff',background:'rgba(0,0,0,.4)'}}>불러오는 중…</div>
                  )}
                  {item.error && (
                    <div style={{position:'absolute',bottom:18,left:0,right:0,background:'rgba(239,68,68,.85)',color:'#fff',fontSize:9,padding:'2px 4px'}}>{item.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:10,paddingTop:10,borderTop:'1px solid var(--border)'}}>
            {cuts.map(cut => {
              const clipCount = (videoClips[cut.id] || []).length
              const promptPreview = (cut.videoPrompt || cut.scene || '').slice(0, 28)
              return (
                <div key={cut.id}
                  onDragOver={e => { if (matchTray.length) e.preventDefault() }}
                  onDrop={e => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/plain')
                    const item = matchTray.find(x => x.id === id)
                    // 예전엔 못 찾으면 그냥 조용히 아무 일도 안 일어났음 — "드래그는 되는데
                    // 배정이 안 된다"는 신고의 원인 후보 중 하나(2026-09-16). 원인을 바로
                    // 알 수 있게 명확한 안내로 바꿈.
                    if (item) assignMatchClip(item, cut)
                    else if (id) alert('배정 실패 — 이 파일을 트레이에서 찾을 수 없습니다. 다시 시도해주세요.')
                  }}
                  onClick={() => {
                    if (!matchSelectedId) return
                    const item = matchTray.find(x => x.id === matchSelectedId)
                    if (item) assignMatchClip(item, cut)
                  }}
                  style={{
                    width:120, minHeight:56, padding:'6px 8px', borderRadius:6,
                    border: matchSelectedId ? '1px dashed var(--purple)' : '1px solid var(--border)',
                    background:'var(--surface1)', cursor: matchSelectedId ? 'pointer' : 'default',
                    fontSize:10.5,
                  }}>
                  <div style={{fontWeight:700,color:'var(--text1)'}}>CUT {cut.no} {clipCount > 0 ? `(${clipCount}개)` : ''}</div>
                  <div style={{color:'var(--text3)',marginTop:2,lineHeight:1.3}}>{promptPreview || '(프롬프트 없음)'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className={s.mainSplit}>
        <div className={s.mainSplitCol}>
        {cuts.map(selCut => {
          const isSelected = selCut.id === selectedCutId
          const clips = videoClips[selCut.id] || []
          // 예전엔 이 정보가 위쪽 "영상 체크리스트" 섹션에만 있어서 컷 카드에서 VP 프롬프트가
          // 아예 안 보였다(2026-09-13, 사용자 지적 — 이원화 구조 통합). vChk는 이미 로드돼 있음.
          const vRow = vChk?.cuts?.find(r => r.no === selCut.no)
          const up = vUpload[selCut.no] || {}
          // 대본 SEG 조합(예: "10+8")이 있으면 실제로 몇 클립이 필요한지 이미 정해져 있다 —
          // 파일이 아직 없어도 그 개수만큼 빈 슬롯을 보여줘서 "몇 번째가 비어있는지" 바로
          // 보이게 한다(2026-09-14, 사용자 지적: "컷2는 a,b로 구분되는데 왜 다른 컷은 안 되나").
          const plannedSegs = Array.isArray(selCut.segments) ? selCut.segments : []
          const slotCount = Math.max(clips.length, plannedSegs.length)
          const cutSegs = toSegments(effectiveCaptionValue(subtitles, selCut, clips), stripMeta(selCut.dialogue || selCut.narration || ''), selCut.duration || 0)
          const captionText = cutSegs[0]?.text ?? ''
          const cutClipTimings = clips.length > 0 ? clipTimings(clips, plannedSegs) : []
          const setClipCaption = (idx, text) => {
            // setPreviewText와 동일 이유로 plannedSegs 폴백 + timings[i] undefined 가드 필요.
            const timings = clipTimings(clips, plannedSegs)
            setSubtitles(prev => {
              const cur = toSegments(effectiveCaptionValue(prev, selCut, clips), '', selCut.duration || 0)
              const next = clips.map((_, i) => {
                const t = timings[i] || { start: 0, end: 0 }
                return {
                  start: t.start, end: t.end,
                  text: i === idx ? text : (cur[i]?.text ?? ''),
                }
              })
              return { ...prev, [selCut.id]: next }
            })
          }
          const previewClip = clips[isSelected ? selectedClipIdx : 0] || clips[0]
          return (
            <div key={selCut.id} id={`video-cutcard-${selCut.id}`}
              className={`${s.selectedCutCard} ${isSelected ? s.selectedCutCardActive : ''}`}
              onClick={() => setSelectedCutId(selCut.id)}>
              <div className={s.cutCardRow}>
              {/* 컷카드 외곽 프레임 자체를 왼쪽까지 넓혀서 그 안에 영상을 넣음 — 컷카드와 영상이
                  "세트"로 같이 스크롤되게(2026-09-14, 사용자 확정: "차라리 컷카드 외곽 프레임을
                  왼쪽까지 확장하여 그안에 영상을 넣으면 세트로 움직이지 않을까?"). 자막 오버레이
                  편집(canvas/textarea ref)은 단일 ref라 선택된 컷 카드에서만 렌더링. */}
              <div className={s.cutCardVideoCol} onClick={e => e.stopPropagation()}>
                {previewClip ? (
                  // 진짜 원인 찾음(2026-09-18, 브라우저에서 실측) — .cutCardRow가
                  // align-items:stretch라 이 영상 박스가 옆 정보 패널 높이만큼 늘어나는데,
                  // 영상 자체는 object-fit:contain이라 그 늘어난 박스 안에서 위아래로
                  // 레터박스(빈 검은 여백)가 생긴다. 자막 오버레이는 "박스" 기준으로 %를
                  // 계산해서, 정보 패널이 유난히 긴 컷(컷4: VP 전체보기+PIP소스+최종합성본
                  // 등)에서 레터박스 여백까지 밀려나 "화면 밖"처럼 보였다(컷2/3은 옆 패널이
                  // 짧아서 우연히 안 튀었을 뿐, 근본 원인은 동일). aspect-ratio로 박스 자체를
                  // 영상 비율에 고정해 레터박스가 생길 여지를 없앤다 — stretch 늘어남과 무관하게
                  // 항상 실제 영상 프레임과 박스가 일치.
                  <div className={s.cutCardVideoInner} style={{ aspectRatio: aspectRatio.replace(':', '/'), height: 'auto', margin: 'auto' }}>
                    <video key={resolveClipSrc(previewClip)} src={resolveClipSrc(previewClip)} controls className={s.cutCardVideoPlayer}
                      onError={() => setVideoLoadErrors(p => ({ ...p, [previewClip.url]: true }))}
                      onLoadedData={() => setVideoLoadErrors(p => { if (!p[previewClip.url]) return p; const n = { ...p }; delete n[previewClip.url]; return n })} />
                    {videoLoadErrors[previewClip.url] && (
                      <div style={{
                        position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
                        flexDirection:'column', gap:6, padding:16, textAlign:'center',
                        background:'rgba(0,0,0,.75)', color:'#fca5a5', fontSize:12, fontWeight:600, pointerEvents:'none',
                      }}>
                        ⚠ 이 파일을 재생할 수 없습니다
                        <span style={{fontWeight:400, color:'var(--text3)', fontSize:11}}>
                          서버에서 파일이 옮겨졌거나 삭제됐을 수 있습니다 — "프록시" 또는 "폴더에서 일괄 가져오기"로 다시 불러오거나, 클립을 삭제하고 다시 배정하세요.
                        </span>
                      </div>
                    )}
                    {isSelected && subtitleEnabled && !subtitleEditMode && (
                      <div
                        className={s.subtitleDisplay}
                        onClick={() => setSubtitleEditMode(true)}
                        title="클릭하여 자막 수정"
                        // s[`pos_${subtitlePosition}`] 문자열 조합 클래스가 이 컷카드 목록
                        // (.map 안에서 매번 다시 렌더되는 위치)에서 비어버리는 경우가 실측
                        // 확인됨 — position:absolute인데 bottom이 하나도 안 붙어서 자막 박스가
                        // 문서 흐름상 원래 자리(영상 아래, 컨트롤바 위 틈)로 빠져 화면 밖처럼
                        // 보였다(2026-09-18, 사용자 스크린샷: 컷2/3은 정상, 컷4부터 틀어짐).
                        // CSS 모듈 클래스 대신 bottom%를 직접 계산해 인라인으로 고정.
                        style={{ bottom: `${subtitlePosition === 'top' ? 24 : subtitlePosition === 'middle' ? 14 : 6}%` }}
                      >
                        <canvas ref={canvasRef} width={640} height={360} className={s.overlayCanvas} />
                      </div>
                    )}
                    {isSelected && subtitleEnabled && subtitleEditMode && (
                      <div
                        className={s.subtitleEditBox}
                        style={{ bottom: `${subtitlePosition === 'top' ? 24 : subtitlePosition === 'middle' ? 14 : 6}%` }}
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
                ) : (
                  <div className={s.cutCardVideoEmpty}>
                    <span className={s.mainVideoEmptyIcon}>🎬</span>
                    <span>CUT {selCut.no} 영상 없음</span>
                  </div>
                )}
              </div>
              <div className={s.cutCardMainCol}>
              <div className={s.cutCardHeader}>
                <span className={s.cutCardTitle}>CUT {String(selCut.no).padStart(2,'0')} — {selCut.scene || '씬 미입력'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {vRow && (
                    <select value={vRow.videoMode} onClick={e => e.stopPropagation()}
                      onChange={e => setCutVideoMode(selCut.no, e.target.value)}
                      style={{ fontSize:11, background:'var(--bg-input)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, padding:'2px 4px' }}>
                      {VIDEO_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  )}
                  {vRow && (
                    <span style={{ fontSize:11, fontWeight:700, color: vRow.hasVideo ? '#4ade80' : vRow.videoMode === 'veo' ? '#fbbf24' : 'var(--text-3)' }}>
                      {vRow.hasVideo ? '✓ 업로드됨' : vRow.videoMode === 'veo' ? '· 제작 필요' : vRow.videoMode === 'motion' ? '· 메이킹 탭' : '· 정지'}
                    </span>
                  )}
                  {/* 서버엔 이미 완성본(vRow.hasVideo)이 있는데 로컬 클립 에디터만 비어있는 경우까지
                      "예상 N개 클립 필요"를 띄우면 "업로드됨"과 "필요"가 동시에 보여 모순돼 보인다
                      (2026-09-14, 사용자 지적 — 카드 표시 통일화). 실제로 아무것도 없을 때만 표시. */}
                  {clips.length === 0 && vRow?.hasVideo && (
                    <span className={s.clipEstimateBadge} title="서버에 완성본이 있지만 아직 클립 편집기에 안 불러왔습니다">
                      📥 완성본 있음 — 프록시로 불러오기
                    </span>
                  )}
                  {clips.length === 0 && !vRow?.hasVideo && (() => {
                    // 대본에 실제 SEG 조합(예: "10+8")이 있으면 그 진짜 계획을 쓰고, 없을 때만
                    // 8초 단위 추측으로 폴백(2026-09-14, 사용자 지적: "컷2는 a,b로 구분되는데
                    // 왜 다른 컷은 안 되나" — 아래 클립 슬롯 렌더링과 같은 근거로 통일).
                    const plannedCount = Array.isArray(selCut.segments) ? selCut.segments.length : 0
                    const estCount = plannedCount > 1 ? plannedCount : estimateClipCount(selCut.duration || 5)
                    return estCount > 1 ? (
                      <span className={s.clipEstimateBadge}>
                        💡 예상 {estCount}개 클립 필요 {plannedCount > 1 ? `(대본 SEG: ${selCut.segments.join('+')}초)` : '(8초 기준)'}
                      </span>
                    ) : null
                  })()}
                  {clips.length > 0 && (() => {
                    const target = selCut.duration || 5
                    const totalUsed = clips.reduce((sum, clip) => {
                      if (!clip) return sum
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
                  <div className={s.cutCardDurEdit} onClick={e => e.stopPropagation()}>
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
                {(selCut.dialogue || selCut.narration || selCut.imagePrompt) && (
                  <div className={s.cutCardPromptPreview}>
                    {stripMeta(selCut.dialogue || selCut.narration || '') || selCut.imagePrompt}
                  </div>
                )}

                {vRow?.videoMode === 'veo' && vRow.videoPrompt && (
                  <div className={s.vpRow} onClick={e => e.stopPropagation()}>
                    <button className={s.vpCopyBtn} onClick={() => navigator.clipboard.writeText(vRow.videoPrompt)}>
                      VP 복사
                    </button>
                    <button className={s.vpToggleBtn}
                      onClick={() => setExpandedVP(p => ({ ...p, [selCut.no]: !p[selCut.no] }))}
                      title="클릭해서 전체 프롬프트 펼치기/접기">
                      <span className={expandedVP[selCut.no] ? s.vpTextFull : s.vpTextClamp}>
                        {expandedVP[selCut.no] ? vRow.videoPrompt : vRow.videoPrompt.replace(/\n/g, ' ')}
                      </span>
                      {!expandedVP[selCut.no] && <span className={s.vpMore}> ▸ 전체보기</span>}
                    </button>
                    {vRow.startFrame
                      ? <a className={s.vpStartFrame} href={vRow.startFrame} download={`cut_${String(selCut.no).padStart(2,'0')}_start.jpg`}>
                          🖼 시작 프레임 저장
                        </a>
                      : <span className={s.vpNoStartFrame}>⚠ 시작 프레임 없음(G2 먼저)</span>}
                  </div>
                )}

                {/* 클립이 하나라도 있으면 아래 클립별 자막칸으로 통일 — 클립 개수(1개/여러개)에
                    따라 서로 다른 입력 UI가 보이던 비일관성을 없앰(2026-09-14, 사용자 지적:
                    "컷2번처럼 클립별 구분설정이 다른 컷들은 누락돼 보인다"). 클립이 아직
                    하나도 없을 때만 이 자유 텍스트 칸을 보여줌. */}
                {slotCount === 0 && (
                  <div className={s.field} onClick={e => e.stopPropagation()}>
                    <label>컷 자막</label>
                    <textarea rows={2} className={s.captionInput}
                      value={captionText}
                      placeholder="이 컷의 자막 텍스트..."
                      onChange={e => setSubtitles(prev => ({ ...prev, [selCut.id]: e.target.value }))} />
                  </div>
                )}

                {slotCount > 0 && (
                  <div className={s.clipList}>
                    {Array.from({ length: slotCount }, (_, idx) => {
                      const clip = clips[idx]
                      // 대본 SEG 계획은 있는데 아직 파일이 없는 슬롯 — 빈 자리를 그대로 보여준다
                      // (2026-09-14, 사용자 확정 반영: "컷2처럼 다른 컷도 구분돼야").
                      if (!clip) {
                        return (
                          <div key={idx} className={`${s.clipTrimItem} ${s.clipTrimItemEmpty}`}>
                            <div className={s.clipTrimHeader}>
                              <span className={s.clipIdx}>{['①','②','③','④','⑤'][idx] ?? idx + 1}</span>
                              <span className={s.clipName}>세그먼트 {idx + 1} — 파일 없음</span>
                              <span className={s.clipDurLabel}>목표 {plannedSegs[idx] != null ? `${plannedSegs[idx]}s` : '?'}</span>
                              <label className={s.uploadBtnSm}>
                                📁 업로드
                                <input type="file" accept="video/*" hidden
                                  onChange={e => { handleVideoUpload(selCut.id, e.target.files, idx); e.target.value = '' }} />
                              </label>
                            </div>
                          </div>
                        )
                      }
                      const usedSec = clip.useFullDuration
                        ? clip.duration
                        : (clip.trimEnd - clip.trimStart)
                      const isClipActive = isSelected && selectedClipIdx === idx
                      return (
                        <div key={idx}
                          className={`${s.clipTrimItem} ${isClipActive ? s.clipTrimItemActive : ''}`}
                          onClick={e => { e.stopPropagation(); setSelectedCutId(selCut.id); setSelectedClipIdx(idx) }}>
                          <div className={s.clipTrimHeader}>
                            <span className={s.clipIdx}>{['①','②','③','④','⑤'][idx] ?? idx+1}</span>
                            <span className={s.clipName}>
                              {clip.name || `로컬파일 ${idx+1}`}
                              <span className={s.clipLabel}> ({String.fromCharCode(97 + idx)})</span>
                            </span>
                            <span className={s.clipDurLabel}>{clip.duration != null ? `${clip.duration}s` : '?'}</span>
                            {clip.createdAt && (
                              <span className={s.clipCreatedAt} title="이 파일의 실제 생성/수정 시각">
                                {formatClipTimestamp(clip.createdAt)}
                              </span>
                            )}
                            {clip.staging && <span className={s.clipStagingBadge} title="서버에 올리는 중...">⏳ 업로드 중</span>}
                            {clip.stageError && <span className={s.clipStageErrorBadge} title={clip.stageError}>⚠ 업로드 실패</span>}
                            {!clip.staging && !clip.stageError && !clip.stagedPath && <span className={s.clipStageErrorBadge}>⚠ 서버 미반영</span>}
                            {clip.ratio && (
                              <span className={`${s.clipRatioBadge} ${clip.ratio !== aspectRatio ? s.clipRatioMismatch : ''}`}
                                title={clip.ratio !== aspectRatio ? `현재 미리보기 모드(${aspectRatio})와 다른 비율입니다` : ''}>
                                {clip.ratio}
                              </span>
                            )}
                            <button className={s.clipDel} onClick={e => { e.stopPropagation(); removeClip(selCut.id, idx) }}>✕</button>
                          </div>
                          <div className={s.clipCaptionRow} onClick={e => e.stopPropagation()}>
                            <span className={s.clipCaptionTime}>
                              {cutClipTimings[idx] ? `${cutClipTimings[idx].start.toFixed(1)}s~${cutClipTimings[idx].end.toFixed(1)}s` : ''}
                            </span>
                            <textarea rows={1} className={s.clipCaptionInput}
                              value={cutSegs[idx]?.text ?? ''}
                              placeholder="이 구간의 자막..."
                              onChange={e => setClipCaption(idx, e.target.value)} />
                          </div>
                          {isClipActive && (
                            <div className={s.clipTrimBody} onClick={e => e.stopPropagation()}>
                              <label className={s.check}>
                                <input type="checkbox"
                                  checked={clip.useFullDuration}
                                  onChange={e => updateClipTrim(selCut.id, idx, {
                                    useFullDuration: e.target.checked,
                                  })} />
                                <span>전체 사용</span>
                              </label>
                              <label className={s.check}>
                                <input type="checkbox"
                                  checked={clip.keepAudio ?? true}
                                  onChange={e => updateClipTrim(selCut.id, idx, { keepAudio: e.target.checked })} />
                                <span>오디오 유지</span>
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
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {videoCandidates[selCut.no]?.length > 0 && (
                  <div className={s.candidateRow} onClick={e => e.stopPropagation()}>
                    <span className={s.candidateLabel}>📁 폴더에서 찾음:</span>
                    {videoCandidates[selCut.no].map(cand => {
                      const already = clips.some(c => c && c.stagedPath === cand.path)
                      return (
                        <button key={cand.name} className={s.candidateBtn} disabled={already}
                          onClick={() => addCandidateClip(selCut.id, selCut.no, cand)}>
                          {already ? `✓ ${cand.name}` : `+ ${cand.name}`}
                        </button>
                      )
                    })}
                  </div>
                )}
                {selCut.pipSegments && (
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0 8px', fontSize: 11.5, color: 'var(--text3)' }}>
                    {Object.entries(selCut.pipSegments).map(([segNoStr, spec]) => {
                      const pct = Math.round((spec.bgVolume ?? 0.42) * 100)
                      // 2026-09-18 — PIP 리액션은 이제 컷3/5/7 쪽 클립을 그대로 재사용(재업로드 없음).
                      // 어느 클립을 쓸지 여기서 직접 고른다 — 소스 컷의 클립이 늘어나도(대사 추가 등)
                      // 항상 최신 목록에서 선택 가능.
                      const srcCutNo = spec.pipSourceCutNo ?? spec.target
                      const srcCut = cuts.find(c => c.no === srcCutNo)
                      const srcClips = srcCut ? (videoClips[srcCut.id] || []) : []
                      return (
                        <div key={segNoStr} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            🎬 PIP 소스 (CUT{srcCutNo})
                            <select value={spec.pipSourceClipIdx ?? ''}
                              onChange={e => {
                                const v = e.target.value === '' ? undefined : parseInt(e.target.value, 10)
                                dispatch({
                                  type: 'UPDATE_CUT', id: selCut.id,
                                  p: { pipSegments: { ...selCut.pipSegments, [segNoStr]: { ...spec, pipSourceCutNo: srcCutNo, pipSourceClipIdx: v, target: undefined, targetSegIdx: undefined } } },
                                })
                              }}>
                              <option value="" disabled>클립 선택…</option>
                              {srcClips.map((c, i) => (
                                <option key={i} value={i} disabled={!c}>
                                  {c ? `클립${i + 1} — ${c.name}` : `클립${i + 1} — 파일 없음`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            🎚 배경 음량
                            <input type="range" min={0} max={100} step={1} value={pct}
                              onChange={e => {
                                const v = parseInt(e.target.value, 10) / 100
                                dispatch({
                                  type: 'UPDATE_CUT', id: selCut.id,
                                  p: { pipSegments: { ...selCut.pipSegments, [segNoStr]: { ...spec, bgVolume: v } } },
                                })
                              }} />
                            <span style={{ minWidth: 30 }}>{pct}%</span>
                          </label>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className={s.videoEmptyBtns} onClick={e => e.stopPropagation()}>
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
                    title="Flow/Veo 자동화는 2026-09-02에 폐기됨 — 외부에서 수동 제작 후 업로드 권장"
                    onClick={() => generateVideoForCut(selCut)}>
                    {videoGenStatus[selCut.id] === 'running' ? '⏳ 생성 중…' : '✨ AI 영상 생성 (레거시)'}
                  </button>
                  <button
                    className={s.composeBtn}
                    disabled={composeStatus[selCut.id] === 'running' || !clips.length}
                    title="여기 있는 클립들을 순서/트림대로 이어붙여 실제 cut_NN.mp4를 만듭니다"
                    onClick={() => renderCutClips(selCut)}>
                    {composeStatus[selCut.id] === 'running' ? '⏳ 합성 중…' : '🎬 클립 합성'}
                  </button>
                  <button
                    className={s.ffmpegBtn}
                    disabled={ffmpegStatus[selCut.id] === 'running'}
                    title="서버에 이미 있는 cut_NN.mp4 위에 나레이션·효과음만 입힙니다"
                    onClick={() => runFfmpegForCut(selCut)}>
                    {ffmpegStatus[selCut.id] === 'running' ? '⏳ 처리 중…' : '🔊 나레이션·효과음 입히기'}
                  </button>
                  <label className={s.uploadBtn} title="외부(CapCut/Veo 등)에서 이미 완성한 파일 1개를 바로 올립니다">
                    {up.busy ? '업로드 중…' : '📤 완성본 바로 업로드'}
                    <input type="file" accept="video/mp4,video/*" hidden disabled={up.busy}
                      onChange={e => { const f = e.target.files[0]; if (f) uploadCutVideo(selCut.no, f, up.keepAudio ?? !!selCut.dialogue); e.target.value = '' }} />
                  </label>
                </div>
                {ffmpegLog[selCut.id] && (
                  <div className={s.ffmpegLog}>{ffmpegLog[selCut.id]}</div>
                )}
                {composeLog[selCut.id] && (
                  <div className={s.ffmpegLog}>{composeLog[selCut.id]}</div>
                )}
                {finalPreviewTs[selCut.id] != null && (() => {
                  const padded = String(selCut.no).padStart(2, '0')
                  const finalUrl = `${epMediaUrl(episode, 'video')}/cut_${padded}.mp4?t=${finalPreviewTs[selCut.id]}`
                  // 자막 라이브 오버레이는 뺐다(2026-09-18, 사용자 확정: "최종 합성본
                  // 미리보기에서 자막을 빼자" — 위치/크기 조정이 실제로 반영되는 것처럼
                  // 안 보여서 오히려 혼란만 줬음). 메인 화면(위 세그 카드 캔버스 오버레이)
                  // 쪽 자막은 그대로 유지 — 여긴 순수 미리보기 영상만.
                  return (
                    <div className={s.field} style={{ marginTop: 8 }}>
                      <label style={{ color: 'var(--accent, #8b5cf6)' }}>✅ 최종 합성본 — 위 세그 목록은 편집용 원본만 보여줍니다, 실제 저장되는 파일은 이것입니다</label>
                      <video key={finalUrl} src={finalUrl} controls style={{ width: '100%', maxHeight: 260, background: '#000', borderRadius: 6 }} />
                    </div>
                  )
                })()}
                {videoGenLog[selCut.id] && (
                  <div className={s.aiGenLog}>{videoGenLog[selCut.id]}</div>
                )}
                {up.result?.error && <div className={s.aiGenLog}>❌ {up.result.error}</div>}
                {up.result?.success && <div className={s.ffmpegLog}>✓ {up.result.sizeKB}KB{up.result.keptAudio ? ' · 오디오 유지' : ''}</div>}
              </div>
              <div className={s.cutCardFooter} onClick={e => e.stopPropagation()}>
                <button
                  className={`${s.g4Btn} ${g4Approved[selCut.id] ? s.g4Done : ''}`}
                  onClick={() => {
                    const next = !g4Approved[selCut.id]
                    setG4Approved(p => ({ ...p, [selCut.id]: next }))
                    setGPoint(episodeCode, selCut.no, 'g4', next)
                  }}>
                  {g4Approved[selCut.id] ? '✓ G4 취소' : 'G4 승인'}
                </button>
              </div>
              </div>
              </div>
            </div>
          )
        })}
        </div>
      </div>
      </div>
      </div>
    </div>
    </div>
  )
}
