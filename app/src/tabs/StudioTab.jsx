import { useState, useRef, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { setGPoints, loadGPoints } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { contentRatio } from '../lib/videoPolicy'
import { instaUrl, cutMediaUrl } from '../lib/mediaPaths'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './StudioTab.module.css'

const TOOLS = ['Flow', 'Imagen', 'Midjourney', 'DALL-E 3', 'Stable Diffusion']

// PL이 인스타그램 콘텐츠 코드(IG_FD/IG_RL/IG_PT/IG_ST)면 어느 downloads/insta/{content}/
// 하위로 라우팅할지 반환. server/lib/scriptParserV3.js·ScriptGenTab.jsx에 있는 것과 동일 로직
// (이 코드베이스의 기존 관례대로 작은 순수함수라 탭마다 그대로 복제해서 씀).
function pipelineCodeToInstaContent(plCode) {
  const map = { IG_FD: 'FD', IG_RL: 'RL', IG_PT: 'PT', IG_ST: 'ST' }
  return map[(plCode || '').toUpperCase()] || null
}

// 컷마다 masterCode.pl이 없는 경우(구/미완성 데이터)를 위한 폴백 — episode.contentType
// (IG_R/IG_F/IG_P/IG_S, App.jsx의 에피소드 유형 선택값) 기준으로도 같은 콘텐츠 코드를 유추한다.
function episodeContentTypeToInsta(contentType) {
  const map = { IG_R: 'RL', IG_F: 'FD', IG_P: 'PT', IG_S: 'ST' }
  return map[(contentType || '').toUpperCase()] || null
}

// ScriptGenTab.jsx의 needsImage 판정과 반드시 동일하게 유지할 것 — GRAPHIC/CAPCUT은
// 화면 녹화·HTML 캡처로 메이킹 탭에서 직접 제작하는 컷이라 이 탭의 Flow 이미지 생성/G2
// 승인 대상이 애초에 아니다.
function needsFlowImage(cutType) {
  return !['GRAPHIC', 'CAPCUT'].includes(cutType || 'YEORI')
}

// ScriptGenTab.jsx의 getRunFlags()와 반드시 동일하게 유지 — 컷 타입별로 이미지(G2)/영상(G4)이
// 실제 어떤 도구를 거치는지 텍스트로 미리 보여준다. G2 승인 전에 이걸 사람이 직접 확인해두면
// G3(TTS)/G4(영상)에서 같은 컷을 서로 다르게 취급하는 불일치(오늘 발견한 CAPCUT 전체실행
// 오염 같은 사고)를 승인 시점에 미리 눈으로 걸러낼 수 있다.
const CUT_TYPE_INFO = {
  YEORI:   { label: 'YEORI',   image: 'Flow 생성 필요',           video: 'Flow+Veo3(립싱크) 필요' },
  BROLL:   { label: 'B-ROLL',  image: 'Flow 생성 필요',           video: 'Flow+Veo3 필요' },
  PIP:     { label: 'PIP',     image: 'Flow 생성 필요',           video: 'Flow+Veo3(PIP) 필요' },
  GRAPHIC: { label: 'GRAPHIC', image: '불필요 (HTML 캡처)',        video: '불필요 — 메이킹 탭에서 캡처' },
  CAPCUT:  { label: 'CAPCUT',  image: '불필요 (CapCut 직접 제작)', video: '불필요 — 메이킹 탭에서 녹화' },
}
function cutTypeInfo(cutType) {
  return CUT_TYPE_INFO[cutType || 'YEORI'] || CUT_TYPE_INFO.YEORI
}

// G2 승인 전 체크리스트 — 2026-10-15: 단순 체크(있다/없다)에서 항목별 가중치×3단계 점수로
// 전환(성준님 선택: "가중치 점수형"), "외모(캐릭터 일관성)" + "연출 의도 일치"(그 컷의
// masterCode AC/CA/SH/MD/SP와 실제 이미지가 맞는지) 두 그룹으로 확장(성준님 요청: "컷 연출
// 의도(동작·샷유형·카메라·감정·TREND)까지 추가 편성"). targetKey가 있으면 그 컷에 실제로
// 적힌 코드값+한글설명을 같이 보여줘서 "원래 뭘 하려던 거였는지"와 바로 비교하며 채점할 수
// 있다. face는 hardBlock — 룰셋 §① "캐릭터 일관성 최우선"을 반영해 다른 항목 점수로
// 상쇄되지 않게 막는다. 점수·메모는 gpoints.json에 영구 저장(setGPoints의 g2Checklist 필드)
// — "서여리 얼굴·외형 판단 근거를 기록해 쌓아가면서 공감대를 맞춰가자"는 요청 반영.
const CHECKLIST_ITEMS = [
  { key: 'face',       group: '외모', label: '얼굴 (identity)',    weight: 5, hardBlock: true },
  { key: 'outfit',     group: '외모', label: '의상',                weight: 3 },
  { key: 'proportion', group: '외모', label: '신체비율 (슬림/모델)', weight: 3 },
  { key: 'hair',       group: '외모', label: '헤어',                weight: 2 },
  { key: 'action',     group: '연출', label: '동작(AC)',            weight: 3, targetKey: 'ac' },
  { key: 'mood',       group: '연출', label: '감정(MD)',            weight: 3, targetKey: 'md' },
  { key: 'shot',       group: '연출', label: '샷유형(SH)',          weight: 2, targetKey: 'sh' },
  { key: 'camera',     group: '연출', label: '카메라(CA)',          weight: 2, targetKey: 'ca' },
  { key: 'background', group: '연출', label: '배경(SP)',            weight: 2, targetKey: 'sp' },
  { key: 'trend',      group: '연출', label: '트렌드 반영',         weight: 2 },
]
const SCORE_LEVELS = [
  { value: 0, label: '✕ 문제', color: '#f87171' },
  { value: 1, label: '△ 보통', color: '#fbbf24' },
  { value: 2, label: '✓ 좋음', color: '#4ade80' },
]
const CHECKLIST_MAX = CHECKLIST_ITEMS.reduce((sum, it) => sum + it.weight * 2, 0)
const PASS_THRESHOLD = 70 // 가중 평균 70% 이상 + hardBlock 없어야 G2 승인용으로 통과
function computeChecklistScore(scores) {
  let sum = 0, scoredCount = 0, hardBlocked = false
  for (const item of CHECKLIST_ITEMS) {
    const v = scores?.[item.key]
    if (v == null) continue
    scoredCount++
    sum += v * item.weight
    if (item.hardBlock && v === 0) hardBlocked = true
  }
  const total = Math.round((sum / CHECKLIST_MAX) * 100)
  return { total, hardBlocked, scoredCount, allScored: scoredCount === CHECKLIST_ITEMS.length }
}
// targetKey가 가리키는 그 컷의 연출 코드값 + 한글 설명(있으면, masterCode.kr.*) — 채점 화면에서
// "원래 의도"를 바로 대조할 수 있게.
function targetRefText(cut, targetKey) {
  const mc = cut?.masterCode || {}
  const code = mc[targetKey]
  const kr = mc.kr?.[targetKey]
  if (!code && !kr) return null
  return [code, kr].filter(Boolean).join(' — ')
}

// G2 승인 시 선택된 이미지의 실제 서버 파일명 추출 (gpoints.json selectedImage용).
// blob:/data: URL(업로드/Gemini 생성 직후, 아직 디스크에 저장 안 됨)은 실제 파일이
// 아니므로 video-automation.js가 참조할 수 없어 null 반환 — /api/scan-media로 스캔된
// Flow 생성 이미지(cut_NN_a.jpg 등)만 파일명을 얻을 수 있다.
function extractImageFilename(url) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null
  try {
    const clean = url.split('?')[0]
    return clean.split('/').pop() || null
  } catch {
    return null
  }
}

// ── Gemini 이미지 생성 (Vercel 프록시 경유) ───────────────────
// 한국 네트워크 차단 우회: 브라우저 → Vercel(미국) → Google API
async function generateImageWithGemini(prompt, apiKey) {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, apiKey }),
  })

  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error || `프록시 오류 ${response.status}`)
  }

  const data = await response.json()
  if (!data.success) throw new Error(data.error || '이미지 생성 실패')

  return `data:${data.mimeType};base64,${data.imageData}`
}

export default function StudioTab() {
  const { state, dispatch } = useApp()
  const { cuts, apiKeys } = state
  // episode.code(3차 정식 필드) 우선, 레거시 에피소드는 과도기 방식(번호)으로 대체
  const episodeCode = resolveEpisodeCode(state.episode)
  const [images, setImages] = useState({})      // cut.id → [url, url, ...]
  const [selectedImage, setSelectedImage] = useState({}) // cut.id → index
  const [selected, setSelected] = useState(TOOLS[0])
  const [copiedId, setCopiedId] = useState(null)
  const [generating, setGenerating] = useState({})
  const [confirmed, setConfirmed] = useState({})
  const [g2Approved, setG2Approved] = useState({})
  const [checklist, setChecklist] = useState({})       // cut.id → { [imgIdx]: { scores:{key:0|1|2}, note } } — 이미지별 채점
  const [checklistTarget, setChecklistTarget] = useState(null) // { cutId, idx } | null — 채점 팝업이 열려있는 컷+이미지
  // 비교뷰 화면비율 — 에피소드 유형 기본값(LF/SF=16:9, 그 외=9:16), 사용자 선택은 AppContext 에 영속.
  const epRatio = contentRatio(state.episode)
  const imageRatio = state.studioTabState?.imageRatio || {}
  const ratioOf = (key) => imageRatio[key] || epRatio
  const setImageRatio = (key, r) =>
    dispatch({ type: 'SET_STUDIO_TAB_STATE', p: { imageRatio: { ...imageRatio, [key]: r } } })
  const [flowRunning, setFlowRunning] = useState(false)
  const [flowLogs, setFlowLogs] = useState([])
  const [flowDone, setFlowDone] = useState(false)
  // ── Flow 이미지 생성(신규, 2026-09-22) — 위 flowRunning/runFlowForCut(옛 puppeteer 자동화, DEPRECATED)와는
  // 별개. scripts/flow-image.js: Nano Banana 2 "소재" 모드로 서여리 얼굴+의상 레퍼런스를 붙여 컷당 2장 생성,
  // 02_images/cut_NN_<다음 빈 슬롯>.jpg 저장. 결과는 /api/scan-images 로 다시 읽어와 이 탭의 이미지 목록에 반영.
  const [flowImgBusy, setFlowImgBusy] = useState({})   // cut.id → true
  const [flowImgMsg, setFlowImgMsg] = useState({})     // cut.id → 진행 메시지
  // 2026-10-15: 서브 구글 계정 Flow(start_gen.bat이 포트 9223에 띄움) 추가 — main/sub 전부
  // 독립된 Chrome·일일 크레딧이라 동시에 쓸 수 있다. 기본은 main, 드롭다운으로 전환.
  const [flowProfile, setFlowProfile] = useState('main')
  const runFlowImageForCut = async (cut) => {
    if (!cut.imagePrompt?.trim()) { alert(`CUT ${cut.no} 프롬프트가 없어요!`); return }
    setFlowImgBusy(p => ({ ...p, [cut.id]: true }))
    setFlowImgMsg(p => ({ ...p, [cut.id]: '요청 중…' }))
    try {
      const r = await fetch('http://localhost:3001/api/flow/image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeCode, cutNos: [cut.no], count: 2, profile: flowProfile }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) throw new Error(d.error || 'Flow 이미지 요청 실패')
      const jobId = d.jobId
      let done = false
      while (!done) {
        await new Promise(res => setTimeout(res, 3000))
        const jr = await fetch(`http://localhost:3001/api/flow/job/${jobId}`)
        const jd = await jr.json()
        const last = (jd.steps || [])[jd.steps.length - 1]
        if (last) setFlowImgMsg(p => ({ ...p, [cut.id]: last.msg }))
        if (jd.state === 'done') { done = true }
        else if (jd.state === 'failed' || jd.state === 'cancelled') throw new Error(jd.error || 'Flow 작업 실패')
      }
      // 새로 저장된 파일만 이 컷에 조용히 반영(전체 알림 없이)
      const sr = await fetch(`http://localhost:3001/api/scan-images?ep=${state.episode.number}`)
      const sd = await sr.json()
      const mine = (sd.images || []).filter(img => img.cutNo === cut.no)
      setImages(p => {
        const existing = Array.isArray(p[cut.id]) ? p[cut.id] : []
        const add = mine.map(img => `http://localhost:3001${img.url}?t=${Date.now()}`).filter(u => !existing.some(e => e.split('?')[0] === u.split('?')[0]))
        return add.length ? { ...p, [cut.id]: [...existing, ...add] } : p
      })
      setFlowImgMsg(p => ({ ...p, [cut.id]: `✅ 완료(${mine.length}장)` }))
    } catch (e) {
      setFlowImgMsg(p => ({ ...p, [cut.id]: `❌ ${e.message}` }))
      alert(`CUT ${cut.no} Flow 이미지 생성 실패: ${e.message}`)
    } finally {
      setFlowImgBusy(p => ({ ...p, [cut.id]: false }))
    }
  }
  const [proxyOk, setProxyOk] = useState(null) // null=checking, true=ok, false=error
  const [gData, setGData] = useState(() => loadGPoints())
  const [activeCutId, setActiveCutId] = useState(null)
  const fileRefs = useRef({})
  const cardRefs = useRef({})

  useEffect(() => {
    const check = async () => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3000)
        await fetch('http://localhost:3001/api/health', { signal: controller.signal })
        clearTimeout(timer)
        setProxyOk(true)
      } catch {
        setProxyOk(false)
      }
    }
    check()
  }, [])

  // ── 에피소드 변경 시 미디어 자동 스캔 ──────────────────────────────
  // 컷 id는 항상 "cut-N"(N=컷 번호)라 에피소드가 달라도 그대로 재사용됨 — 그래서 아래
  // images/selectedImage/checklist 등 "cut.id 기준" 로컬 state는 에피소드를 전환해도 자동으론
  // 안 비워짐. 예전엔 재조회 트리거가 episode.number였는데, 리팩터 과도기 데이터라 ep_1/
  // IG_R_E01_AI/SF_E01처럼 서로 다른 에피소드가 전부 number:1로 겹치는 경우가 있어(2026-08-15
  // 실측 확인) 이 셋 사이를 전환하면 재조회 자체가 아예 안 일어나서 "목록은 새 에피소드인데
  // 화면(이미지·체크리스트)은 이전 에피소드 그대로"인 불일치가 발생했음. episodeCode(항상
  // 고유)로 트리거를 바꾸고, 전환 시 로컬 state를 통째로 비워서(머지가 아니라 리셋) 컷 id가
  // 겹치더라도 이전 에피소드 데이터가 새 에피소드 화면에 절대 안 남게 한다.
  useEffect(() => {
    setImages({})
    setSelectedImage({})
    setChecklist({})
    // confirmed/g2Approved는 로컬(휘발성) 상태라, 탭을 나갔다 돌아오면(App.jsx가 activeTab
    // 하나만 렌더링해서 StudioTab이 통째로 언마운트/재마운트됨) 매번 여기서 빈 값으로
    // 리셋됐었다 — gpoints.json엔 g2:true가 멀쩡히 남아있는데 화면상 G2 뱃지/버튼만
    // "미승인"으로 되돌아가 보이는 버그였음(2026-08-23 실측: G1 뱃지는 gData를 매번 라이브로
    // 읽어서 정상인데 G2만 이 리셋의 영향을 받고 있었음). 리셋 대신 저장된 gpoints에서
    // 다시 읽어와 그 상태 그대로 복원한다.
    const fresh = loadGPoints()
    const epData = fresh[episodeCode] || {}
    const hydratedConfirmed = {}
    const hydratedG2 = {}
    state.cuts.forEach(c => {
      if (epData[`cut_${c.no}`]?.g2) {
        hydratedConfirmed[c.id] = true
        hydratedG2[c.id] = true
      }
    })
    setConfirmed(hydratedConfirmed)
    setG2Approved(hydratedG2)
    setGData(fresh)
    setActiveCutId(null)
  }, [episodeCode])

  useEffect(() => {
    const epNum = state.episode?.number
    if (!epNum) return
    // 인스타 콘텐츠(IG_FD/IG_RL/IG_PT/IG_ST) 에피소드는 이미지가 downloads/flow/ep{N}/이 아니라
    // downloads/insta/{content}/{num}/에 저장돼 있으므로 서버가 그쪽을 스캔하도록 같이 알려준다
    // (안 보내면 예전처럼 ep{N} 스캔 — LF/SF 등 레거시 에피소드는 그대로 동작).
    const instaContent = state.cuts.map(c => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean)
      || episodeContentTypeToInsta(state.episode?.contentType)
    const instaNum = instaContent ? (state.episode?.instaNum?.trim() || null) : null
    fetch('http://localhost:3001/api/scan-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epNum, instaContent, instaNum, episodeCode }),
    })
      .then(r => r.json())
      .then(data => {
        const toUrl = (absPath) =>
          `http://localhost:3001/downloads/${absPath.replace(/.*downloads[\\/]/i, '').replace(/\\/g, '/')}?t=${Date.now()}`

        // 컷당 이미지가 여러 개(A/B 등) 올 수 있다 — 서버가 gpoints.json의 selectedImage를
        // 배열 맨 앞에 두고 보내주므로, 순서 그대로 밀어 넣으면 실제 승인했던 쪽이 자연히
        // selectedImage[cut.id](기본값 0번)로 화면에 유지된다.
        Object.entries(data.images || {}).forEach(([key, absPaths]) => {
          const cutNo = parseInt(key.replace('cut_', ''), 10)
          const cut = state.cuts.find(c => c.no === cutNo)
          if (!cut) return
          const list = Array.isArray(absPaths) ? absPaths : [absPaths]
          list.forEach(absPath => {
            const url = toUrl(absPath)
            const fname = absPath.split(/[\\/]/).pop()
            setImages(p => {
              const existing = Array.isArray(p[cut.id]) ? p[cut.id] : []
              if (existing.some(u => u.includes(fname))) return p
              return { ...p, [cut.id]: [...existing, url] }
            })
          })
          // 이미지 존재 = 생성 완료 신호는 hasImage(파일 확인)가 담당한다.
          // 여기서 G포인트를 자동으로 찍지 않는다 — G2는 사람이 승인 버튼을 눌러야 참.
        })
        setGData(loadGPoints())
      })
      .catch(() => {})
  }, [episodeCode])

  // confirmed/g2Approved와 같은 이유로(위 237행), g2Checklist 점수 배지도 로컬 state(checklist)에만
  // 있어서 탭 재방문·새로고침 시 gpoints.json엔 점수가 멀쩡히 남아있는데 화면엔 전부 "채점"으로
  // 되돌아가 보였다(2026-10-15 실측: 저장 직후 새로고침하니 100점 배지가 사라짐). 저장 당시의
  // 인덱스는 스캔 순서가 바뀌면(선택 이미지가 맨 앞으로 오는 정렬 등) 더 이상 같은 이미지를
  // 가리키지 않을 수 있어, 인덱스가 아니라 g2Checklist에 같이 저장해 둔 filename으로 매칭해서
  // 복원한다. 이미 로컬에 있는 항목(막 채점 중이라 아직 저장 전인 것)은 덮어쓰지 않는다.
  useEffect(() => {
    if (!episodeCode) return
    const epData = gData[episodeCode] || {}
    setChecklist(prev => {
      let changed = false
      const next = { ...prev }
      state.cuts.forEach(cut => {
        const persisted = epData[`cut_${cut.no}`]?.g2Checklist
        const imgList = images[cut.id]
        if (!persisted || !imgList?.length) return
        const existingForCut = next[cut.id] || {}
        const merged = { ...existingForCut }
        let cutChanged = false
        Object.values(persisted).forEach(rec => {
          if (!rec?.filename) return
          const idx = imgList.findIndex(u => extractImageFilename(u) === rec.filename)
          if (idx === -1 || merged[idx]) return
          merged[idx] = { scores: rec.scores, note: rec.note || '' }
          cutChanged = true
        })
        if (cutChanged) { next[cut.id] = merged; changed = true }
      })
      return changed ? next : prev
    })
  }, [images, gData, episodeCode])

  const updateCut = (id, p) => dispatch({ type: 'UPDATE_CUT', id, p })

  // 이미지 저장 위치 결정용 파라미터 — 인스타 콘텐츠면 서버가 instaDir 로 분기(scan-media 와 동일).
  const cutImageTarget = () => {
    const instaContent = state.cuts.map(c => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean)
      || episodeContentTypeToInsta(state.episode?.contentType)
    const instaNum = instaContent ? (state.episode?.instaNum?.trim() || null) : null
    return (instaContent && instaNum) ? { instaContent, instaNum } : {}
  }

  // 컷 카드의 "이미지 업로드/추가" — 예전엔 blob URL 로 화면에만 붙여서 디스크엔 저장이 안 됐고,
  // 탭 재진입 시 scan-media 가 디스크의 예전 파일로 되돌려 놓았다(2026-09-23). 드래그 배정과 같은
  // /api/upload-cut-image 로 실제 cut_NN_<a|b> 에 저장한다.
  const handleImageUpload = async (cutId, file) => {
    if (!file) return
    const cut = state.cuts.find(c => c.id === cutId)
    if (!cut) return
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg')
    const qs = new URLSearchParams({ ep: state.episode.number, cutNo: cut.no, ext, ...cutImageTarget() })
    try {
      const res = await fetch(`http://localhost:3001/api/upload-cut-image?${qs}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '업로드 실패')
      const url = `http://localhost:3001${data.url}?t=${Date.now()}`
      let newIdx = 0
      setImages(prev => {
        const existing = Array.isArray(prev[cutId]) ? prev[cutId] : (prev[cutId] ? [prev[cutId]] : [])
        newIdx = existing.length
        return { ...prev, [cutId]: [...existing, url] }
      })
      setSelectedImage(prev => ({ ...prev, [cutId]: newIdx }))
      // 선택이 새 이미지로 바뀌므로, 예전 이미지에 대해 받았던 컨펌/G2 는 무효.
      setConfirmed(p => ({ ...p, [cutId]: false }))
      setG2Approved(p => ({ ...p, [cutId]: false }))
    } catch (e) {
      alert(`CUT ${cut.no} 이미지 업로드 실패: ${e.message}`)
    } finally {
      if (fileRefs.current[cutId]) fileRefs.current[cutId].value = ''
    }
    // 업로드/생성만으로는 G포인트를 찍지 않는다 — G2는 사람이 승인 버튼을 눌러야 참.
  }

  // ✕ — 화면에서만 빼면 scan-media 가 디스크 파일을 다시 읽어와 되살아나므로 서버에서도 치운다
  // (_trash/ 로 이동, 되돌리기 가능). blob:/data: 처럼 디스크에 없는 이미지는 화면에서만 제거.
  const deleteCutImageFile = async (cut, url) => {
    const m = String(url || '').split('?')[0].match(/\/downloads\/.*\/(cut_[^/]+\.(?:jpe?g|png|webp))$/i)
    if (!m) return true
    try {
      const res = await fetch('http://localhost:3001/api/delete-cut-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep: state.episode.number, cutNo: cut.no, file: decodeURIComponent(m[1]), episodeCode, ...cutImageTarget() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || '삭제 실패')
      return true
    } catch (e) {
      alert(`CUT ${cut.no} 이미지 삭제 실패: ${e.message}`)
      return false
    }
  }

  const copyPrompt = (text, cutId) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(cutId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  // ── 단일 컷 이미지 자동 생성 ──────────────────────────────────
  const generateSingleImage = async (cut) => {
    if (!apiKeys.gemini) { alert('GEMINI API 키를 입력하세요!'); return }
    if (!cut.imagePrompt) { alert(`CUT ${cut.no} 프롬프트가 없어요!`); return }
    setGenerating(prev => ({ ...prev, [cut.id]: true }))
    try {
      const imgUrl = await generateImageWithGemini(cut.imagePrompt, apiKeys.gemini)
      setImages(prev => {
        const existing = Array.isArray(prev[cut.id]) ? prev[cut.id] : (prev[cut.id] ? [prev[cut.id]] : [])
        return { ...prev, [cut.id]: [...existing, imgUrl] }
      })
      setSelectedImage(prev => ({ ...prev, [cut.id]: 0 }))
    } catch(e) {
      alert(`CUT ${cut.no} 생성 실패: ${e.message}`)
    } finally {
      setGenerating(prev => ({ ...prev, [cut.id]: false }))
    }
  }

  // ── 단일 컷 Flow 재생성 ────────────────────────────────────────
  const runFlowForCut = async (cut) => {
    const { episode } = state
    if (!cut.imagePrompt?.trim()) { alert(`CUT ${cut.no} 프롬프트가 없어요!`); return }

    // PL이 IG_FD/IG_RL/IG_PT/IG_ST면 downloads/insta/{content}/{instaNum}/으로 라우팅.
    // 그 외(YR_VD/BR_VD 등)는 기존 downloads/flow/ep{N}/ 그대로 — 회귀 없음.
    const instaContent = pipelineCodeToInstaContent(cut.masterCode?.pl)
    if (instaContent && !episode.instaNum?.trim()) {
      alert(`이 컷의 PL(${cut.masterCode?.pl})은 인스타 콘텐츠(${instaContent})인데, 에피소드에 "인스타 번호"가 입력되어 있지 않아요.\n대본 생성 탭 → 에피소드 설정에서 먼저 입력해주세요.`)
      return
    }

    const prompts = {
      episode: episode.number,
      title: episode.title || '',
      cuts: [{
        no: cut.no,
        imagePrompt: cut.imagePrompt,
        ...(cut.narration?.trim() ? { narration: cut.narration.trim() } : {}),
        ...(cut.dialogue?.trim() && !/^없음$/i.test(cut.dialogue) ? { dialogue: cut.dialogue.trim() } : {}),
        duration: cut.duration || 5,
      }],
    }

    setGenerating(prev => ({ ...prev, [cut.id]: true }))
    setFlowLogs(prev => [...prev, { type: 'info', message: `🔄 CUT ${cut.no} Flow 재생성 중…` }])

    try {
      const res = await fetch('http://localhost:3001/api/run-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(instaContent
          ? { type: 'insta', content: instaContent, num: episode.instaNum.trim(), prompts }
          : { ep: episode.number, prompts }),
      })
      if (!res.ok) throw new Error(`서버 오류 ${res.status} — npm run proxy 실행 중인지 확인`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'cut_done') {
              const padded = String(ev.cutNo).padStart(2, '0')
              for (const suffix of ['_a', '_b', '']) {
                for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
                  const url = (instaContent
                    ? instaUrl(instaContent, episode.instaNum.trim(), ev.cutNo, ext, suffix)
                    : cutMediaUrl(episode, 'images', ev.cutNo, ext, suffix)) + `?t=${Date.now()}`
                  try {
                    const r = await fetch(url, { method: 'HEAD' })
                    if (r.ok) {
                      setImages(p => {
                        const existing = Array.isArray(p[cut.id]) ? p[cut.id] : []
                        if (existing.some(u => u.includes(`cut_${padded}${suffix}.${ext}`))) return p
                        return { ...p, [cut.id]: [...existing, url] }
                      })
                      setFlowLogs(prev => [...prev, { type: 'done', message: `✅ CUT ${cut.no} Flow 완료` }])
                    }
                  } catch {}
                }
              }
            } else if (ev.type === 'cut_image') {
              const imgUrl = `http://localhost:3001${ev.url}?t=${Date.now()}`
              setImages(p => {
                const existing = Array.isArray(p[cut.id]) ? p[cut.id] : []
                if (existing.some(u => u.includes(ev.url))) return p
                return { ...p, [cut.id]: [...existing, imgUrl] }
              })
              setFlowLogs(prev => [...prev, { type: 'done', message: `✅ CUT ${cut.no} Flow 완료` }])
            } else if (ev.type === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `❌ CUT ${cut.no} Flow 실패: ${ev.message}` }])
            } else if (ev.type === 'log' && ev.level === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `⚠️ ${ev.message}` }])
            }
          } catch {}
        }
      }
    } catch (err) {
      setFlowLogs(prev => [...prev, { type: 'error', message: `❌ CUT ${cut.no}: ${err.message}` }])
    } finally {
      setGenerating(prev => ({ ...prev, [cut.id]: false }))
    }
  }

  // ── 폴더 파일명 일괄 정리 (Flow/외부 이미지 → cut_NN_x 규격) + 재조회 ──────
  const importAndReload = async () => {
    try {
      const r = await fetch('http://localhost:3001/api/import-cut-images', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep: state.episode.number }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '정리 실패')
      const msg = [
        `📁 파일명 정리: ${d.renamed?.length || 0}개`,
        ...(d.renamed || []).map(x => `  ${x.from} → ${x.to}`),
        ...(d.skipped?.length ? ['', `⚠️ 스킵 ${d.skipped.length}개 (파일명에서 컷번호 못 찾음):`, ...d.skipped.map(x => `  ${x.file}`)] : []),
      ].join('\n')
      if ((d.renamed?.length || 0) + (d.skipped?.length || 0) > 0) alert(msg)
    } catch (err) {
      alert('파일명 정리 실패: ' + err.message)
      return
    }
    await reloadExistingImages()
  }

  // ── 기존 생성 이미지 재조회 ─────────────────────────────────────
  const reloadExistingImages = async () => {
    try {
      const res = await fetch(`http://localhost:3001/api/scan-images?ep=${state.episode.number}`)
      const data = await res.json()
      if (!data.images?.length) { alert('저장된 이미지가 없습니다.'); return }
      data.images.forEach(img => {
        const cut = state.cuts.find(c => c.no === img.cutNo)
        if (!cut) return
        const imgUrl = `http://localhost:3001${img.url}?t=${Date.now()}`
        setImages(p => {
          const existing = Array.isArray(p[cut.id]) ? p[cut.id] : []
          if (existing.some(u => u.includes(img.url))) return p
          return { ...p, [cut.id]: [...existing, imgUrl] }
        })
      })
      setGData(loadGPoints())
      alert(`✅ ${data.images.length}개 이미지 불러오기 완료`)
    } catch (err) {
      alert('불러오기 실패: ' + err.message)
    }
  }

  // ── 드래그 배정: 파일명 대신 사람이 직접 보고 컷에 배정 ──────────────
  // "폴더에서 일괄 가져오기"는 파일명에서 컷 번호를 정규식으로 추측하는데, Flow가 다운로드
  // 해주는 실제 파일명은 컷 순서와 무관한 해시/타임스탬프라 애초에 못 맞는다. 게다가 한 컷에
  // 후보가 2개(A/B) 있을 수 있어 "가장 최근 컷 다음 순번" 같은 순서 추정도 못 미덥다. 그래서
  // 사람이 파일 썸네일을 보고 어느 컷 프롬프트에 맞는지 직접 판단해서 배정하게 한다(2026-09-15).
  const [matchOpen, setMatchOpen] = useState(false)
  const [matchTray, setMatchTray] = useState([]) // [{id, file, url, ext, uploading, error}]
  const [matchSelectedId, setMatchSelectedId] = useState(null)
  const matchFileInputRef = useRef(null)

  const addMatchFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    const items = files.map(f => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      url: URL.createObjectURL(f),
      ext: (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg'),
      uploading: false,
      error: null,
    }))
    setMatchTray(prev => [...prev, ...items])
  }

  const assignMatchFile = async (item, cut) => {
    if (item.uploading) return
    setMatchTray(prev => prev.map(x => x.id === item.id ? { ...x, uploading: true, error: null } : x))
    try {
      const instaContent = state.cuts.map(c => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean)
        || episodeContentTypeToInsta(state.episode?.contentType)
      const instaNum = instaContent ? (state.episode?.instaNum?.trim() || null) : null
      const qs = new URLSearchParams({ ep: state.episode.number, cutNo: cut.no, ext: item.ext })
      if (instaContent && instaNum) { qs.set('instaContent', instaContent); qs.set('instaNum', instaNum) }
      const res = await fetch(`http://localhost:3001/api/upload-cut-image?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: item.file,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '업로드 실패')
      setImages(prev => {
        const existing = Array.isArray(prev[cut.id]) ? prev[cut.id] : []
        return { ...prev, [cut.id]: [...existing, `http://localhost:3001${data.url}?t=${Date.now()}`] }
      })
      setMatchTray(prev => {
        const target = prev.find(x => x.id === item.id)
        if (target) URL.revokeObjectURL(target.url)
        return prev.filter(x => x.id !== item.id)
      })
      setMatchSelectedId(prev => (prev === item.id ? null : prev))
    } catch (e) {
      setMatchTray(prev => prev.map(x => x.id === item.id ? { ...x, uploading: false, error: e.message } : x))
    }
  }

  const removeMatchItem = (item) => {
    URL.revokeObjectURL(item.url)
    setMatchTray(prev => prev.filter(x => x.id !== item.id))
    setMatchSelectedId(prev => (prev === item.id ? null : prev))
  }

  // ── Flow 파이프라인 실행 (prompts 저장 → npm run flow → 이미지 자동 로드) ──
  const runFlow = async () => {
    const { episode, cuts: allCuts } = state
    // GRAPHIC/CAPCUT 컷(CapCut에서 직접 제작, 텍스트 훅/DM 목업 등)은 IP에 "이미지 생성
    // 불필요" 안내문이 들어있어도 imagePrompt 자체는 비어있지 않게 파싱되므로 cutType으로도
    // 걸러야 함 — 안 그러면 "전체 이미지 자동 생성" 한 번에 이런 컷까지 Flow 생성 대상에 잡혀서
    // 크레딧이 낭비됨(server/proxy.js의 studio-run-g2와 동일한 문제, 2026-08-15 실측 발견).
    const promptCuts = allCuts.filter(c => c.imagePrompt?.trim() && !['GRAPHIC', 'CAPCUT'].includes(c.cutType))
    const prompts = {
      episode: episode.number,
      title: episode.title || '',
      cuts: promptCuts.map(c => ({
        no: c.no,
        imagePrompt: c.imagePrompt,
        ...(c.narration?.trim() ? { narration: c.narration.trim() } : {}),
        ...(c.dialogue?.trim() && !/^없음$/i.test(c.dialogue) ? { dialogue: c.dialogue.trim() } : {}),
        duration: c.duration || 5,
      })),
    }
    if (!prompts.cuts.length) { alert('이미지 프롬프트가 있는 컷이 없어요!'); return }

    // 이 에피소드의 컷들이 인스타 콘텐츠(IG_FD/IG_RL/IG_PT/IG_ST)면 그 경로로 일괄 라우팅.
    // 한 에피소드 안에서 PL이 섞여 있어도 첫 인스타 매칭 컷의 유형을 그 에피소드의 콘텐츠 유형으로 본다.
    const instaContent = promptCuts.map(c => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean) || null
    if (instaContent && !episode.instaNum?.trim()) {
      alert(`이 에피소드의 컷들이 인스타 콘텐츠(${instaContent})인데, "인스타 번호"가 입력되어 있지 않아요.\n에피소드 설정에서 먼저 입력해주세요.`)
      return
    }

    setFlowRunning(true)
    setFlowDone(false)
    setFlowLogs([{ type: 'info', message: 'prompts.json 저장 중…' }])

    try {
      const res = await fetch('http://localhost:3001/api/run-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(instaContent
          ? { type: 'insta', content: instaContent, num: episode.instaNum.trim(), prompts }
          : { ep: episode.number, prompts }),
      })
      if (!res.ok) throw new Error(`서버 오류 ${res.status} — npm run proxy 실행 중인지 확인`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'saved') {
              setFlowLogs(prev => [...prev, { type: 'ok', message: '✅ prompts.json 저장 완료' }])
            } else if (ev.type === 'progress') {
              setFlowLogs(prev => [...prev, {
                type: 'progress', cutNo: ev.cutNo,
                message: `🔄 C${String(ev.cutNo).padStart(2,'0')} 생성 중… (${ev.current}/${ev.total})`,
              }])
            } else if (ev.type === 'cut_done') {
              setFlowLogs(prev => {
                const next = [...prev]
                for (let j = next.length - 1; j >= 0; j--) {
                  if (next[j].cutNo === ev.cutNo && next[j].type === 'progress') {
                    next[j] = { type: 'done', cutNo: ev.cutNo, message: `✅ C${String(ev.cutNo).padStart(2,'0')} 완료 (${ev.current}/${ev.total})` }
                    break
                  }
                }
                return next
              })
              // fallback: cut_image 이벤트가 없을 경우 HEAD 탐색
              const padded = String(ev.cutNo).padStart(2, '0')
              const cut = allCuts.find(c => c.no === ev.cutNo)
              if (cut) {
                for (const ext of ['jpg', 'jpeg', 'png']) {
                  const url = (instaContent
                    ? instaUrl(instaContent, episode.instaNum.trim(), ev.cutNo, ext)
                    : cutMediaUrl(episode, 'images', ev.cutNo, ext)) + `?t=${Date.now()}`
                  try {
                    const r = await fetch(url, { method: 'HEAD' })
                    if (r.ok) { setImages(p => ({ ...p, [cut.id]: url })); break }
                  } catch {}
                }
              }
            } else if (ev.type === 'cut_image') {
              // 서버에서 직접 전달한 이미지 URL → 컷카드 자동 표시
              const imgUrl = `http://localhost:3001${ev.url}?t=${Date.now()}`
              const cut = allCuts.find(c => c.no === ev.cutNo)
              if (cut) {
                setImages(p => {
                  const existing = Array.isArray(p[cut.id]) ? p[cut.id] : []
                  const base = ev.url
                  if (existing.some(u => u.includes(base))) return p
                  return { ...p, [cut.id]: [...existing, imgUrl] }
                })
              }
            } else if (ev.type === 'cut_error') {
              setFlowLogs(prev => [...prev, { type: 'error', cutNo: ev.cutNo, message: `❌ C${String(ev.cutNo).padStart(2,'0')} 실패` }])
            } else if (ev.type === 'log' && ev.level === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `⚠️ ${ev.message}` }])
            } else if (ev.type === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `❌ ${ev.message}${ev.detail ? ` (${ev.detail})` : ''}` }])
            } else if (ev.type === 'complete') {
              setFlowRunning(false)
              setFlowDone(ev.success)
              if (!ev.success) {
                const reason = ev.reason ? ` — ${ev.reason}` : ''
                setFlowLogs(prev => [...prev, { type: 'error', message: `파이프라인 실패${reason} (code: ${ev.code ?? 'null'})` }])
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      setFlowLogs(prev => [...prev, { type: 'error', message: `❌ ${err.message}` }])
      setFlowRunning(false)
    }
  }

  // ── 룰셋 체크 ─────────────────────────────────────────────────
  const rulesetCheck = (prompt) => {
    const issues = []
    if (!prompt.includes('NOT short')) issues.push('헤어 이중강조')
    if (!prompt.includes('skin texture') && !prompt.includes('beauty mark')) issues.push('매력점')
    if (!prompt.includes('DO NOT change')) issues.push('캐릭터 고정')
    if (!prompt.includes('K-model') && !prompt.includes('proportions')) issues.push('K모델 비율')
    return issues
  }

  // ── 서여리 베이스 프롬프트 ────────────────────────────────────
  const YEORI_BASE = `Young Korean woman early 20s (22-23 years old), long wavy dark brown hair NOT short, natural skin texture on right cheek (subtle, not a prominent mark), delicate gold necklace, effortlessly photogenic not posing just existing beautifully, K-model proportions very small face long slim legs slender figure tall fashion model body, small head-to-body ratio DO NOT make average body proportions, appearing no older than 22-23, DO NOT change character appearance, Photorealistic 8K cinematic, natural Korean beauty`

  // 툴별 접미사 — 화면비율은 에피소드 유형 기본값(LF/SF=16:9, 그 외=9:16)
  const TOOL_SUFFIX = {
    // 2026-09-13: 실내 캐주얼 컷에 신발 신은 채 생성되고, 화면(폰/TV)에 깨진 텍스트가
    // 나타나는 문제가 실측으로 반복 확인돼 접미사에 명시적으로 추가함(yeori_ruleset_v1.md 참고).
    'Flow':             `Photorealistic 8K cinematic ${epRatio}, background people must not interact with main character, consistent character face, barefoot or socks indoors unless shoes are intentional, no legible on-screen text or UI`,
    'Imagen':           'Photorealistic 8K cinematic, semi-realistic Korean style',
    'Midjourney':       `photorealistic, 8K, cinematic lighting, --ar ${epRatio} --v 6`,
    'DALL-E 3':         `photorealistic, cinematic, high quality, ${epRatio} aspect ratio`,
    'Stable Diffusion': 'masterpiece, best quality, photorealistic, cinematic lighting, 8k uhd',
  }

  const allConfirmed = cuts.length > 0 && cuts.every(c => confirmed[c.id] && images[c.id]?.length > 0)
  const g1Count = cuts.filter(c => gData[episodeCode]?.[`cut_${c.no}`]?.g1).length
  const g3Count = cuts.filter(c => images[c.id]?.length > 0).length
  const g2Count = cuts.filter(c => confirmed[c.id]).length

  const exportPromptsJson = () => runFlow()

  const generateAllPrompts = () => {
    let failCount = 0
    cuts.forEach(c => {
      const scene = c.scene || ''
      const action = c.action || ''
      const isCloseup = action.toLowerCase().includes('close') ||
        action.includes('클로즈') || action.includes('표정') || action.includes('얼굴')
      const beautyMark = 'natural skin texture on right cheek (subtle, not a prominent mark)'
      const actionPrompt = action
        ? `First 3 seconds: ${action.split('.')[0] || action}`
        : ''
      const prompt = [
        YEORI_BASE.replace('natural skin texture on right cheek (subtle, not a prominent mark)', beautyMark),
        c.imagePrompt || '',
        scene,
        actionPrompt,
        TOOL_SUFFIX[selected] || TOOL_SUFFIX['Flow']
      ].filter(Boolean).join(', ').replace(/,\s*,/g, ',').trim()

      const issues = rulesetCheck(prompt)
      if (issues.length > 0) failCount++
      updateCut(c.id, { imagePrompt: prompt })
    })
    if (failCount > 0) {
      alert(`⚠️ ${failCount}컷에서 룰셋 미달 항목이 있어요.\n각 컷 프롬프트를 확인해주세요.`)
    } else {
      alert(`✅ ${cuts.length}컷 프롬프트 생성 완료!\n서여리 베이스 + K모델 비율 + 룰셋 통과`)
    }
  }

  return (
    <div className={s.page}>
      <TabToolbar
        toolLabel="이미지 생성 도구"
        tools={TOOLS}
        activeTool={selected}
        onToolChange={setSelected}
        right={
          <select value={flowProfile} onChange={e => setFlowProfile(e.target.value)}
            title="Flow 계정 선택 — start_gen.bat이 포트 9223에 띄운 서브 계정 Chrome을 쓰려면 '서브 계정'으로"
            style={{ fontSize: 11, background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px' }}>
            <option value="main">Flow: 메인 계정</option>
            <option value="sub">Flow: 서브 계정</option>
          </select>
        }
        actions={[
          {
            key: 'flow-json', variant: 'green', disabled: flowRunning,
            title: 'prompts.json 저장 후 Google Flow 자동 실행',
            label: flowRunning ? '⏳ Flow 실행 중…' : '📤 Flow용 JSON 내보내기',
            onClick: exportPromptsJson,
          },
          {
            key: 'flow-auto', variant: 'purple', disabled: flowRunning,
            label: flowRunning ? '🔄 Flow 실행 중…' : '🤖 전체 이미지 자동 생성',
            onClick: runFlow,
          },
          {
            key: 'import-img', variant: 'green',
            label: '📁 폴더에서 일괄 가져오기 (파일명 정리 + 불러오기)',
            onClick: importAndReload,
          },
          {
            key: 'match-img', variant: 'purple',
            label: matchOpen ? '🎯 드래그 배정 닫기' : '🎯 드래그 배정',
            onClick: () => setMatchOpen(o => !o),
          },
          {
            key: 'reload-img', variant: 'green',
            label: '🔄 다시 불러오기 (정리 없이)',
            onClick: reloadExistingImages,
          },
        ]}
      />
      <div className={s.root}>
      <EpisodeInfoSidebar
        activeCutId={activeCutId}
        maxStage={2}
        onCutClick={(cut) => {
          setActiveCutId(cut.id)
          cardRefs.current[cut.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }}
      />
      <div className={s.main}>
      <div className={s.scrollBody}>
      {/* 프록시 서버 연결 경고 */}
      {proxyOk === false && (
        <div style={{
          background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)',
          borderRadius:8, padding:'10px 16px', margin:'8px 16px 0',
          fontSize:12.5, color:'#fca5a5', fontWeight:600, flexShrink:0,
          display:'flex', alignItems:'center', gap:8,
        }}>
          ⚠️ 프록시 서버가 실행되지 않았습니다. 터미널에서 <code style={{background:'rgba(0,0,0,.3)',padding:'1px 6px',borderRadius:4,fontFamily:'monospace'}}>npm run studio</code>를 실행해주세요.
        </div>
      )}

      {/* Flow 실행 로그 */}
      {flowLogs.length > 0 && (
        <div style={{
          background:'var(--surface2)', border:'1px solid var(--border)',
          borderRadius:8, padding:'12px 16px', margin:'0 0 12px',
          fontSize:11, fontFamily:'Space Mono, monospace',
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{fontWeight:700,color:'var(--purple)'}}>🤖 Google Flow 이미지 생성</div>
            {!flowRunning && (
              <button onClick={() => { setFlowLogs([]); setFlowDone(false) }}
                style={{background:'transparent',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:11}}>✕ 닫기</button>
            )}
          </div>
          <div style={{maxHeight:100,overflowY:'auto',color:'var(--text2)',display:'flex',flexDirection:'column',gap:2}}>
            {flowLogs.map((l,i) => (
              <div key={i} style={{
                color: l.type==='done'||l.type==='ok' ? 'var(--teal)'
                     : l.type==='error' ? 'var(--red)'
                     : l.type==='progress' ? 'var(--purple)'
                     : 'var(--text3)'
              }}>{l.message}</div>
            ))}
          </div>
          {flowDone && (
            <div style={{marginTop:8,color:'var(--teal)',fontWeight:700,borderTop:'1px solid var(--border)',paddingTop:8}}>
              🎉 전체 완료!
            </div>
          )}
        </div>
      )}

      {/* 🎯 드래그 배정 — 파일명 대신 사람이 보고 컷에 직접 배정 */}
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
            Flow 등에서 받은 이미지 파일(파일명 무관)을 아래에 추가한 뒤, 썸네일을 원하는 컷 카드로 <b>드래그</b>하거나,
            썸네일을 클릭해 선택한 다음 컷 카드를 <b>클릭</b>해서 배정하세요(터치 화면 대응). 컷 하나에 A/B 최대 2개까지 배정됩니다.
          </div>
          <input ref={matchFileInputRef} type="file" accept="image/*" multiple style={{display:'none'}}
            onChange={e => { addMatchFiles(e.target.files); e.target.value = '' }} />
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
                  draggable={!item.uploading}
                  onDragStart={e => e.dataTransfer.setData('text/plain', item.id)}
                  onClick={() => !item.uploading && setMatchSelectedId(prev => prev === item.id ? null : item.id)}
                  title={item.file.name}
                  style={{
                    position:'relative', width:84, cursor: item.uploading ? 'wait' : 'grab',
                    border: matchSelectedId === item.id ? '2px solid var(--purple)' : '2px solid var(--border)',
                    borderRadius:8, overflow:'hidden', opacity: item.uploading ? 0.6 : 1,
                    background:'#000',
                  }}>
                  <img src={item.url} alt="" draggable={false} style={{width:'100%',height:84,objectFit:'cover',display:'block',pointerEvents:'none'}} />
                  <button onClick={e => { e.stopPropagation(); removeMatchItem(item) }}
                    style={{
                      position:'absolute', top:2, right:2, width:18, height:18, lineHeight:'18px',
                      background:'rgba(0,0,0,.6)', color:'#fff', border:'none', borderRadius:4,
                      fontSize:11, cursor:'pointer', padding:0,
                    }}>✕</button>
                  {item.uploading && (
                    <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#fff',background:'rgba(0,0,0,.4)'}}>업로드중…</div>
                  )}
                  {item.error && (
                    <div style={{position:'absolute',bottom:0,left:0,right:0,background:'rgba(239,68,68,.85)',color:'#fff',fontSize:9,padding:'2px 4px'}}>{item.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:10,paddingTop:10,borderTop:'1px solid var(--border)'}}>
            {cuts.map(cut => {
              const abCount = Array.isArray(images[cut.id]) ? images[cut.id].length : 0
              const promptPreview = (cut.imagePrompt || cut.scene || '').slice(0, 28)
              return (
                <div key={cut.id}
                  onDragOver={e => { if (matchTray.length) e.preventDefault() }}
                  onDrop={e => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/plain')
                    const item = matchTray.find(x => x.id === id)
                    if (item) assignMatchFile(item, cut)
                  }}
                  onClick={() => {
                    if (!matchSelectedId) return
                    const item = matchTray.find(x => x.id === matchSelectedId)
                    if (item) assignMatchFile(item, cut)
                  }}
                  style={{
                    width:120, minHeight:56, padding:'6px 8px', borderRadius:6,
                    border: matchSelectedId ? '1px dashed var(--purple)' : '1px solid var(--border)',
                    background:'var(--surface1)', cursor: matchSelectedId ? 'pointer' : 'default',
                    fontSize:10.5,
                  }}>
                  <div style={{fontWeight:700,color:'var(--text1)'}}>CUT {cut.no} {abCount >= 2 ? '(A/B 완료)' : abCount === 1 ? '(1개)' : ''}</div>
                  <div style={{color:'var(--text3)',marginTop:2,lineHeight:1.3}}>{promptPreview || '(프롬프트 없음)'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className={s.grid}>
        {cuts.map((cut) => (
          <div key={cut.id} ref={el => cardRefs.current[cut.id] = el} className={s.card}>
            {/* 왼쪽: a/b 이미지 비교 영역 — 프레임(전체 영역) 크기는 컷마다 항상 동일하게
                고정하고, 그 안에서 9:16이면 좌우 분할, 16:9가 하나라도 있으면 상하 분할 */}
            <div className={s.cardLeft}>
              {(() => {
                const cutImages = images[cut.id] || []
                const isStacked = cutImages.some((_, i) => ratioOf(`${cut.id}_${i}`) === '16:9')
                const slotStyle = isStacked
                  ? { maxWidth: '100%', maxHeight: 'calc(50% - 4px)' }
                  : { maxWidth: 'calc(50% - 4px)', maxHeight: '100%' }
                return (
              <div className={s.imageCompareRow} style={{ flexDirection: isStacked ? 'column' : 'row' }}>
                {cutImages.map((url, idx) => {
                  const isSelected = (selectedImage[cut.id] ?? 0) === idx
                  const ratioKey = `${cut.id}_${idx}`
                  const ratio = ratioOf(ratioKey)
                  return (
                    <div key={idx}
                      className={`${s.compareImg} ${isSelected ? s.compareImgSelected : ''}`}
                      style={{ aspectRatio: ratio === '16:9' ? '16/9' : '9/16', ...slotStyle }}
                      onClick={() => {
                        // 컨펌/G2는 "이 컷"이 아니라 "이 컷에서 지금 선택된 특정 이미지"를
                        // 검증했다는 뜻이어야 한다. 선택이 실제로 바뀌면(A→B 등) 예전 이미지에
                        // 대해 받았던 컨펌/G2 완료를 그대로 들고 있으면 안 됨 — 체크리스트를
                        // 한 번도 안 거친 새 이미지가 바로 "G2 승인 가능" 상태가 돼버리는
                        // 사고로 이어진다(2026-08-23, 사용자 실측 지적으로 발견).
                        const wasSelected = (selectedImage[cut.id] ?? 0) === idx
                        setSelectedImage(prev => ({ ...prev, [cut.id]: idx }))
                        if (!wasSelected) {
                          setConfirmed(p => ({ ...p, [cut.id]: false }))
                          setG2Approved(p => ({ ...p, [cut.id]: false }))
                        }
                      }}
                    >
                      <img src={url} alt="" />
                      <span className={s.compareLetter}>{String.fromCharCode(97 + idx).toUpperCase()}</span>
                      <div className={s.ratioToggle} onClick={e => e.stopPropagation()}>
                        {['9:16', '16:9'].map(r => (
                          <button key={r}
                            className={ratio === r ? s.ratioToggleActive : ''}
                            onClick={() => setImageRatio(ratioKey, r)}
                          >{r}</button>
                        ))}
                      </div>
                      {isSelected && <div className={s.selectedBadge}>✓ G2 승인용 선택됨</div>}
                      {/* 2026-10-15: A만 채점할 수 있었던 걸 이미지마다 독립적으로 채점 가능하게
                          — A/B(/C..) 전부 미리 채점해 총점을 비교한 뒤 고를 수 있게(성준님:
                          "선택근거 마련"). cut.id 기준 로컬 checklist 상태를 그대로 읽는다. */}
                      {(() => {
                        const cl = checklist[cut.id]?.[idx]
                        const sc = cl ? computeChecklistScore(cl.scores) : null
                        return (
                          <button type="button" className={s.scoreBadge}
                            onClick={e => { e.stopPropagation(); setChecklistTarget({ cutId: cut.id, idx }) }}
                            title="이 이미지 채점하기">
                            {sc
                              ? `${!sc.allScored ? '…' : sc.hardBlocked ? '⛔' : sc.total >= PASS_THRESHOLD ? '✓' : '△'} ${sc.total}점`
                              : '채점'}
                          </button>
                        )
                      })()}
                      <button className={s.compareRemove} onClick={async e => {
                        e.stopPropagation()
                        if (!(await deleteCutImageFile(cut, url))) return
                        const wasSelected = (selectedImage[cut.id] ?? 0) === idx
                        setImages(p => {
                          const arr = Array.isArray(p[cut.id]) ? p[cut.id] : []
                          const newArr = arr.filter(u => u !== url)
                          const n = { ...p }
                          if (newArr.length) n[cut.id] = newArr
                          else delete n[cut.id]
                          return n
                        })
                        setSelectedImage(prev => ({ ...prev, [cut.id]: 0 }))
                        // 지금까지 선택돼 있던(=컨펌/G2 대상이었던) 이미지가 삭제되면 남은
                        // 0번 이미지는 전혀 다른 파일일 수 있으니 컨펌/G2도 같이 초기화한다.
                        if (wasSelected) {
                          setConfirmed(p => ({ ...p, [cut.id]: false }))
                          setG2Approved(p => ({ ...p, [cut.id]: false }))
                        }
                      }}>✕</button>
                    </div>
                  )
                })}
                {cutImages.length < 2 && (
                  <div className={s.compareEmpty} style={{ ...slotStyle, aspectRatio: isStacked ? '16/9' : '9/16' }}
                    onClick={() => !generating[cut.id] && fileRefs.current[cut.id]?.click()}>
                    {generating[cut.id] ? (
                      <>
                        <span style={{ fontSize: 24, animation: 'spin 1s linear infinite' }}>⟳</span>
                        <span style={{ fontSize: 11, color: 'var(--purple)' }}>{selected === 'Flow' ? 'Flow 생성 중...' : 'Gemini 생성 중...'}</span>
                      </>
                    ) : (
                      <>
                        <span className={s.uploadIcon}>{cutImages.length ? '➕' : '🖼️'}</span>
                        <span>{cutImages.length ? '이미지 추가' : '이미지 업로드'}</span>
                        <span className={s.uploadSub}>클릭하여 선택</span>
                      </>
                    )}
                  </div>
                )}
                <input ref={el => fileRefs.current[cut.id] = el} type="file" accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => handleImageUpload(cut.id, e.target.files[0])} />
              </div>
                )
              })()}
              {(images[cut.id]?.length || 0) >= 2 && (
                <div className={s.addMoreRow} onClick={() => fileRefs.current[cut.id]?.click()}>
                  + 이미지 추가
                </div>
              )}
              {apiKeys.gemini && cut.imagePrompt && !images[cut.id]?.length && (
                <button
                  onClick={() => generateSingleImage(cut)}
                  disabled={generating[cut.id]}
                  className={s.autoGenBtn}
                >
                  {generating[cut.id] ? '⟳ 생성 중...' : '🤖 자동 생성'}
                </button>
              )}
              {cut.imagePrompt && (
                <button
                  onClick={() => runFlowImageForCut(cut)}
                  disabled={flowImgBusy[cut.id]}
                  className={s.autoGenBtn}
                  title="Google Flow(Nano Banana 2)로 서여리 얼굴·의상 레퍼런스를 붙여 2장 생성 — 하루 무료 한도 내"
                  style={{ marginTop: 6 }}
                >
                  {flowImgBusy[cut.id] ? '⏳ Flow 생성 중…' : '⚡ Flow로 생성'}
                </button>
              )}
              {flowImgMsg[cut.id] && (
                <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 4, wordBreak: 'break-all' }}>{flowImgMsg[cut.id]}</div>
              )}
            </div>

            {/* 오른쪽: 정보·컨트롤 영역 */}
            <div className={s.cardRight}>
              <div className={s.cardHeader}>
                <span className={s.cutBadge}>CUT {cut.no}</span>
                {/* 2026-10-15: 대본 탭에서만 보이던 ✨SIG 표시가 여기선 안 보여서 "단계마다
                    연결이 안 된다"는 지적(성준님) — 같은 cut.cutMark를 그대로 읽어서 띄운다. */}
                {cut.cutMark === 'SIGNATURE' && <span title="시그니처 컷" style={{ fontSize: 11, fontWeight: 700, color: '#f0c040' }}>✨SIG</span>}
                <span className={s.scene}>{cut.scene || '씬 미입력'}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {gData[episodeCode]?.[`cut_${cut.no}`]?.g1 && <span className={`${s.gBadge} ${s.g1Badge}`}>G1</span>}
                  {g2Approved[cut.id] && <span className={`${s.gBadge} ${s.g2Badge}`}>G2</span>}
                  <button
                    onClick={() => {
                      setImages(p => ({ ...p, [cut.id]: [] }))
                      setSelectedImage(prev => ({ ...prev, [cut.id]: 0 }))
                      setConfirmed(p => ({ ...p, [cut.id]: false }))
                      setChecklist(p => ({ ...p, [cut.id]: {} }))
                    }}
                    style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 4,
                      background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
                      color: '#fca5a5', cursor: 'pointer',
                    }}
                  >이미지 초기화</button>
                </div>
              </div>
              {(() => {
                const info = cutTypeInfo(cut.cutType)
                return (
                  <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 12, margin: '-4px 0 8px' }}>
                    <span>🏷 {info.label}</span>
                    <span>🖼 이미지: {info.image}</span>
                    <span>🎬 G4 영상: {info.video}</span>
                  </div>
                )
              })()}

              <div className={s.promptSection}>
                <div className={s.promptHeader}>
                  <span className={s.promptLabel}>{selected} 프롬프트</span>
                  <button className={s.copyBtn} onClick={() => copyPrompt(cut.imagePrompt)}
                    title="복사">📋 복사</button>
                </div>
                <textarea
                  className={s.promptInput}
                  rows={4}
                  placeholder={`${selected}용 이미지 프롬프트를 입력하세요...`}
                  value={cut.imagePrompt || ''}
                  onChange={e => updateCut(cut.id, { imagePrompt: e.target.value })}
                />
              </div>

              <div className={s.dialoguePreview}>
                {cut.dialogue && <div className={s.dial}><span className={s.dialLabel}>대사</span>{cut.dialogue}</div>}
                {cut.narration && <div className={s.narr}><span className={s.dialLabel}>VO</span>{cut.narration}</div>}
              </div>

              <div className={s.confirmRow} style={{marginTop:'auto'}}>
                <button className={s.confirmBtn}
                  disabled={!images[cut.id]?.length || confirmed[cut.id]}
                  onClick={() => setChecklistTarget({ cutId: cut.id, idx: selectedImage[cut.id] ?? 0 })}>
                  {confirmed[cut.id] ? '✓ 컨펌' : '채점하기'}
                </button>
                <button className={s.regenBtn}
                  onClick={() => {
                    if (selected === 'Flow' && !proxyOk) {
                      alert('프록시 서버를 먼저 실행해주세요 (npm run studio)')
                      return
                    }
                    setConfirmed(p => ({ ...p, [cut.id]: false }))
                    setChecklist(p => ({ ...p, [cut.id]: {} }))
                    setImages(p => { const n = {...p}; delete n[cut.id]; return n })
                    if (selected === 'Flow') {
                      runFlowForCut(cut)
                    } else if (apiKeys.gemini && cut.imagePrompt) {
                      generateSingleImage(cut)
                    }
                  }}>
                  🔄 재생성
                </button>
                <button className={s.g2Btn}
                  disabled={!confirmed[cut.id] || g2Approved[cut.id]}
                  onClick={() => {
                    setG2Approved(p => ({ ...p, [cut.id]: true }))
                    const idx = selectedImage[cut.id] ?? 0
                    const filename = extractImageFilename((images[cut.id] || [])[idx])
                    setGPoints(episodeCode, cut.no, filename ? { g2: true, selectedImage: filename } : { g2: true })
                  }}>
                  {g2Approved[cut.id] ? '✓ G2 완료' : 'G2 승인'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* G2 전체 승인 바 */}
      {cuts.length > 0 && (
        <div className={s.g2AllBar}>
          <span className={s.g2AllCount}>
            G2 완료 {Object.values(g2Approved).filter(Boolean).length} / {cuts.length}
          </span>
          <button
            className={s.g2AllBtn}
            disabled={!cuts.every(c => !needsFlowImage(c.cutType) || g2Approved[c.id])}
            onClick={() => {
              // CAPCUT/GRAPHIC 컷은 애초에 이 탭에서 이미지를 만들지 않으므로(메이킹 탭에서
              // 직접 제작) g2를 강제로 찍지 않고 건너뛴다 — 실제로 이미지가 필요했던 컷만 기록.
              cuts.filter(c => needsFlowImage(c.cutType)).forEach(c => {
                const idx = selectedImage[c.id] ?? 0
                const filename = extractImageFilename((images[c.id] || [])[idx])
                setGPoints(episodeCode, c.no, filename ? { g2: true, selectedImage: filename } : { g2: true })
              })
              dispatch({ type: 'SET_TAB', p: 'tts' })
            }}>
            {cuts.every(c => !needsFlowImage(c.cutType) || g2Approved[c.id]) ? '🎉 G2 전체 승인 → TTS 탭' : 'G2 전체 승인'}
          </button>
        </div>
      )}
      </div>

      {/* G2 승인 전 채점 팝업 — 2026-10-15 가중치 점수형 재설계(이미지별 독립 채점) */}
      {checklistTarget && (() => {
        const { cutId, idx } = checklistTarget
        const checklistCut = cuts.find(c => c.id === cutId)
        const cl = checklist[cutId]?.[idx] || { scores: {}, note: '' }
        const sc = computeChecklistScore(cl.scores)
        const setScore = (key, value) => setChecklist(p => ({
          ...p,
          [cutId]: { ...p[cutId], [idx]: { ...cl, scores: { ...cl.scores, [key]: value } } },
        }))
        const setNote = (note) => setChecklist(p => ({
          ...p,
          [cutId]: { ...p[cutId], [idx]: { ...cl, note } },
        }))
        const letter = String.fromCharCode(97 + idx).toUpperCase()
        const groups = [...new Set(CHECKLIST_ITEMS.map(it => it.group))]
        const saveLabel = !sc.allScored
          ? `${CHECKLIST_ITEMS.length - sc.scoredCount}개 더 채점하세요`
          : sc.hardBlocked ? '⛔ 얼굴 문제 — 기록만 저장'
          : sc.total < PASS_THRESHOLD ? `△ 기준 미달(${sc.total}/${PASS_THRESHOLD}) — 기록만 저장`
          : '✓ 채점 저장 + 컨펌'
        return (
          <div className={s.checklistOverlay} onClick={() => setChecklistTarget(null)}>
            <div className={s.checklistModal} onClick={e => e.stopPropagation()}>
              <div className={s.checklistTitle}>CUT {checklistCut?.no} · {letter} 채점</div>
              <div className={s.checklistSub}>
                {sc.scoredCount}/{CHECKLIST_ITEMS.length}개 채점됨
                {sc.allScored && (
                  <span style={{ marginLeft: 8, fontWeight: 700, color: sc.hardBlocked ? '#f87171' : sc.total >= PASS_THRESHOLD ? '#4ade80' : '#fbbf24' }}>
                    총점 {sc.total}/100
                  </span>
                )}
              </div>
              {groups.map(group => (
                <div key={group}>
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 700, margin: '8px 0 2px' }}>{group}</div>
                  {CHECKLIST_ITEMS.filter(it => it.group === group).map(item => {
                    const ref = item.targetKey ? targetRefText(checklistCut, item.targetKey) : null
                    return (
                      <div key={item.key} className={s.checklistItem} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                        <span>
                          {item.label}
                          {ref && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> — {ref}</span>}
                        </span>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {SCORE_LEVELS.map(lv => (
                            <button key={lv.value} type="button" onClick={() => setScore(item.key, lv.value)}
                              style={{
                                fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                                border: cl.scores[item.key] === lv.value ? `1.5px solid ${lv.color}` : '1px solid var(--border)',
                                background: cl.scores[item.key] === lv.value ? `${lv.color}22` : 'transparent',
                                color: cl.scores[item.key] === lv.value ? lv.color : 'var(--text-3)',
                              }}>{lv.label}</button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
              {/* 2026-10-15: "서여리 얼굴·외형 판단안목을 동기화" 요청 — 점수만으론 "왜"가 안
                  남으니 짧은 메모를 같이 기록해서 쌓아간다. */}
              <textarea rows={2} placeholder="판단 이유 메모(선택) — 예: 눈매가 평소보다 날카로워 보임"
                value={cl.note || ''} onChange={e => setNote(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 11.5, padding: 6, marginTop: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-1)' }} />
              <div className={s.checklistActions}>
                <button className={s.checklistClose} onClick={() => setChecklistTarget(null)}>닫기</button>
                <button className={s.checklistDone} disabled={!sc.allScored}
                  onClick={() => {
                    // gData(마지막 로드본)를 베이스로, 이번 세션에서 채점한 이미지들을 덮어써서
                    // 저장 — 다른 이미지(A/B 등)의 예전 기록을 잃지 않으면서 방금 채점한 것만 갱신.
                    const persisted = gData[episodeCode]?.[`cut_${checklistCut.no}`]?.g2Checklist || {}
                    const localForCut = checklist[cutId] || {}
                    const merged = { ...persisted }
                    for (const [i, rec] of Object.entries(localForCut)) {
                      merged[i] = {
                        filename: extractImageFilename((images[cutId] || [])[i]),
                        scores: rec.scores, total: computeChecklistScore(rec.scores).total,
                        note: rec.note || '', scoredAt: new Date().toISOString(),
                      }
                    }
                    setGPoints(episodeCode, checklistCut.no, { g2Checklist: merged })
                    setGData(loadGPoints())
                    if (!sc.hardBlocked && sc.total >= PASS_THRESHOLD && (selectedImage[cutId] ?? 0) === idx) {
                      setConfirmed(p => ({ ...p, [cutId]: true }))
                    }
                    setChecklistTarget(null)
                  }}>
                  {saveLabel}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
      </div>
    </div>
    </div>
  )
}
