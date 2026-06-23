import { createContext, useContext, useReducer, useEffect, useRef, useState } from 'react'

const SERVER = 'http://localhost:3001'

const AppContext = createContext(null)
const STORAGE_KEY = 'yeori-studio-v2'

const makeCuts = (n) => Array.from({ length: n }, (_, i) => ({
  id: `cut-${i + 1}`, no: i + 1,
  scene: '', action: '', character: '서여리',
  dialogue: '', narration: '', imagePrompt: '',
  duration: 5, cutType: 'NORMAL',
}))

// 새 에피소드 기본값 생성
const makeEpisode = (id, number) => ({
  id,
  episode: {
    number,
    title: '',
    location: '카페',
    mood: '감성',
    cutCount: 7,
    character: '서여리 - 20대 초반 한국 여성, 긴 웨이비 다크 브라운 헤어, 자연스러운 피부결, 골드 목걸이, K-모델 포스, 차분하지만 가끔은 엉뚱한 반전매력, AI 크리에이터',
  },
  cuts: makeCuts(7),
  scriptRaw: '',
  createdAt: new Date().toISOString(),
})

const defaultEpisodeId = 'ep_1'

const defaultState = {
  activeTab: 'script',
  apiKeys: { claude: '', elevenLabs: '', gemini: '' },
  vertexAI: false,
  elevenLabsStatus: { connected: false, remainingChars: 0 },

  // ── 멀티 에피소드 구조 ──────────────────────────────────
  activeEpisodeId: defaultEpisodeId,
  openTabIds: [defaultEpisodeId],   // 탭 바에 표시할 에피소드 ID 목록
  episodes: {
    [defaultEpisodeId]: makeEpisode(defaultEpisodeId, 1),
  },

  // 하위 호환: 현재 에피소드 직접 접근용 (기존 탭들 그대로 작동)
  episode: { number: 1, title: '', location: '카페', mood: '감성', cutCount: 7, character: '서여리 - 20대 초반 한국 여성, 긴 웨이비 다크 브라운 헤어, 자연스러운 피부결, 골드 목걸이, K-모델 포스, 차분하지만 가끔은 엉뚱한 반전매력, AI 크리에이터' },
  cuts: makeCuts(7),
  scriptRaw: '',

  ttsSettings: { voiceId: 'RmYuvmCbqOMBJxDLW4k8', emotion: 35, tone: 75, speed: 1.0,
    trackDefaults: {
      dialogue:  { speed: 0.9,  stability: 30, similarity: 75 },
      narration: { speed: 0.85, stability: 55, similarity: 75 },
    }
  },
  videoSettings: { subtitleEnabled: true, font: 'Apple SD Gothic Neo', fontSize: 32, color: '#ffffff', bgStyle: 'semi', boxColor: '#000000' },
  renderProgress: { current: 0, total: 0, isRendering: false },
  thumbnail: { text: '', fontSize: 48, color: '#ffffff', shadowColor: '#000000', bold: true, textY: 70 },
  dashboard: { flowCredits: 100, klingCredits: 50, elevenlabsChars: 10000, monthBudget: 50000, spent: 0 },
  projectName: '새 프로젝트',
  savedAt: null,
  videoTabState: { videoClips: {}, g4Approved: {}, selectedCutId: null, subtitles: {} },
  ttsTabState: { audioUrls: {}, audioTexts: {}, g3Confirmed: {} },
}

function reducer(state, action) {
  switch (action.type) {

    // ── 에피소드 전환 (탭 자동 추가) ────────────────────────────
    case 'SWITCH_EPISODE': {
      const ep = state.episodes[action.id]
      if (!ep) return state
      const openTabIds = (state.openTabIds || []).includes(action.id)
        ? state.openTabIds
        : [...(state.openTabIds || []), action.id]
      return {
        ...state,
        activeEpisodeId: action.id,
        openTabIds,
        episode: ep.episode,
        cuts: ep.cuts,
        scriptRaw: ep.scriptRaw || '',
      }
    }

    // ── 새 에피소드 추가 ─────────────────────────────────────
    case 'ADD_EPISODE': {
      const maxNum = Math.max(0, ...Object.values(state.episodes).map(e => e.episode.number))
      const newId = `ep_${Date.now()}`
      const newEp = makeEpisode(newId, maxNum + 1)
      return {
        ...state,
        episodes: { ...state.episodes, [newId]: newEp },
        openTabIds: [...(state.openTabIds || []), newId],
        activeEpisodeId: newId,
        episode: newEp.episode,
        cuts: newEp.cuts,
        scriptRaw: '',
      }
    }

    // ── 탭 닫기 (데이터는 유지) ──────────────────────────────
    case 'CLOSE_TAB': {
      const tabs = (state.openTabIds || []).filter(id => id !== action.id)
      if (!tabs.length) return state   // 마지막 탭은 닫을 수 없음
      const newActiveId = state.activeEpisodeId === action.id
        ? tabs[tabs.length - 1]
        : state.activeEpisodeId
      const ep = state.episodes[newActiveId]
      return {
        ...state,
        openTabIds: tabs,
        activeEpisodeId: newActiveId,
        episode: ep.episode,
        cuts: ep.cuts,
        scriptRaw: ep.scriptRaw || '',
      }
    }

    // ── 에피소드 삭제 ────────────────────────────────────────
    case 'DELETE_EPISODE': {
      if (Object.keys(state.episodes).length <= 1) return state
      const newEpisodes = { ...state.episodes }
      delete newEpisodes[action.id]
      const openTabIds = (state.openTabIds || []).filter(id => id !== action.id)
      const fallbackId = openTabIds.length
        ? (state.activeEpisodeId === action.id ? openTabIds[openTabIds.length - 1] : state.activeEpisodeId)
        : Object.keys(newEpisodes)[0]
      const firstEp = newEpisodes[fallbackId]
      return {
        ...state,
        episodes: newEpisodes,
        openTabIds: openTabIds.length ? openTabIds : [fallbackId],
        activeEpisodeId: fallbackId,
        episode: firstEp.episode,
        cuts: firstEp.cuts,
        scriptRaw: firstEp.scriptRaw || '',
      }
    }

    // ── 에피소드 번호 변경 (중복 시 차단) ───────────────────
    case 'RENUMBER_EPISODE': {
      const ep = state.episodes[action.id]
      if (!ep) return state
      const isDup = Object.values(state.episodes).some(
        e => e.id !== action.id && e.episode.number === action.number
      )
      if (isDup) return state   // 중복이면 변경하지 않음 (UI에서 에러 표시)
      const updated = { ...ep, episode: { ...ep.episode, number: action.number } }
      return {
        ...state,
        episodes: { ...state.episodes, [action.id]: updated },
        ...(state.activeEpisodeId === action.id ? { episode: updated.episode } : {}),
      }
    }

    // ── 에피소드 이름 변경 ───────────────────────────────────
    case 'RENAME_EPISODE': {
      const ep = state.episodes[action.id]
      if (!ep) return state
      const updated = { ...ep, episode: { ...ep.episode, title: action.title } }
      const newEpisodes = { ...state.episodes, [action.id]: updated }
      return {
        ...state,
        episodes: newEpisodes,
        ...(state.activeEpisodeId === action.id ? { episode: updated.episode } : {}),
      }
    }

    // ── 기존 액션들 (현재 에피소드에 반영 + episodes 동기화) ──
    case 'SET_TAB': return { ...state, activeTab: action.p }
    case 'SET_API_KEY': return { ...state, apiKeys: { ...state.apiKeys, [action.key]: action.val } }
    case 'TOGGLE_VERTEX': return { ...state, vertexAI: !state.vertexAI }
    case 'SET_EL_STATUS': return { ...state, elevenLabsStatus: action.p }

    case 'SET_EPISODE': {
      const newEpisode = { ...state.episode, ...action.p }
      const curEp = state.episodes[state.activeEpisodeId]
      const updatedEp = { ...curEp, episode: newEpisode }
      return {
        ...state,
        episode: newEpisode,
        episodes: { ...state.episodes, [state.activeEpisodeId]: updatedEp },
      }
    }

    case 'SET_CUTS': {
      const curEp = state.episodes[state.activeEpisodeId]
      const updatedEp = { ...curEp, cuts: action.p }
      return {
        ...state,
        cuts: action.p,
        episodes: { ...state.episodes, [state.activeEpisodeId]: updatedEp },
      }
    }

    case 'UPDATE_CUT': {
      const newCuts = state.cuts.map(c => c.id === action.id ? { ...c, ...action.p } : c)
      const curEp = state.episodes[state.activeEpisodeId]
      const updatedEp = { ...curEp, cuts: newCuts }
      return {
        ...state,
        cuts: newCuts,
        episodes: { ...state.episodes, [state.activeEpisodeId]: updatedEp },
      }
    }

    case 'SET_SCRIPT_RAW': {
      const curEp = state.episodes[state.activeEpisodeId]
      const updatedEp = { ...curEp, scriptRaw: action.p }
      return {
        ...state,
        scriptRaw: action.p,
        episodes: { ...state.episodes, [state.activeEpisodeId]: updatedEp },
      }
    }

    case 'SET_TTS': return { ...state, ttsSettings: { ...state.ttsSettings, ...action.p } }
    case 'SET_VIDEO': return { ...state, videoSettings: { ...state.videoSettings, ...action.p } }
    case 'SET_VIDEO_TAB_STATE': return { ...state, videoTabState: { ...state.videoTabState, ...action.p } }
    case 'SET_TTS_TAB_STATE': return { ...state, ttsTabState: { ...state.ttsTabState, ...action.p } }
    case 'SET_RENDER': return { ...state, renderProgress: { ...state.renderProgress, ...action.p } }
    case 'SET_THUMB': return { ...state, thumbnail: { ...state.thumbnail, ...action.p } }
    case 'SET_DASH': return { ...state, dashboard: { ...state.dashboard, ...action.p } }
    case 'SET_PROJECT': return { ...state, projectName: action.p }
    case 'MARK_SAVED': return { ...state, savedAt: new Date().toISOString() }

    case 'RESET_CUTS': {
      const newCuts = makeCuts(action.n)
      const newEpisode = { ...state.episode, cutCount: action.n }
      const curEp = state.episodes[state.activeEpisodeId]
      const updatedEp = { ...curEp, cuts: newCuts, episode: newEpisode }
      return {
        ...state,
        cuts: newCuts,
        episode: newEpisode,
        episodes: { ...state.episodes, [state.activeEpisodeId]: updatedEp },
      }
    }

    // ── 빈 에피소드 정리 (scriptRaw 없고 컷 내용 없는 것 삭제) ──
    case 'CLEANUP_EMPTY_EPISODES': {
      const isEmpty = (ep) =>
        !ep.scriptRaw &&
        ep.cuts.every(c => !c.scene && !c.action && !c.dialogue && !c.narration && !c.imagePrompt)

      const kept = Object.entries(state.episodes).filter(
        ([id, ep]) => id === state.activeEpisodeId || !isEmpty(ep)
      )
      if (kept.length === Object.keys(state.episodes).length) return state // 변화 없음

      const newEpisodes = Object.fromEntries(kept)
      const openTabIds = (state.openTabIds || []).filter(id => newEpisodes[id])
      const newActiveId = newEpisodes[state.activeEpisodeId]
        ? state.activeEpisodeId
        : Object.keys(newEpisodes)[0]
      const ep = newEpisodes[newActiveId]
      return {
        ...state,
        episodes: newEpisodes,
        openTabIds: openTabIds.length ? openTabIds : [newActiveId],
        activeEpisodeId: newActiveId,
        episode: ep.episode,
        cuts: ep.cuts,
        scriptRaw: ep.scriptRaw || '',
      }
    }

    case 'LOAD': return { ...defaultState, ...action.p, savedAt: new Date().toISOString() }
    default: return state
  }
}

const LEGACY_CHARACTER = '서여리 - 20대 중반 한국 여성, 긴 웨이비 다크 브라운 헤어, 자연스러운 피부결, 골드 목걸이, AI 크리에이터'
const CURRENT_CHARACTER = '서여리 - 20대 초반 한국 여성, 긴 웨이비 다크 브라운 헤어, 자연스러운 피부결, 골드 목걸이, K-모델 포스, 차분하지만 가끔은 엉뚱한 반전매력, AI 크리에이터'

function upgradeCharacter(val) {
  return val === LEGACY_CHARACTER ? CURRENT_CHARACTER : val
}

function migrateState(saved, init) {
  // ttsSettings.trackDefaults 누락 시 기본값 병합
  if (saved.ttsSettings && !saved.ttsSettings.trackDefaults) {
    saved.ttsSettings = {
      ...saved.ttsSettings,
      trackDefaults: init.ttsSettings.trackDefaults,
    }
  }
  if (!saved.episodes) {
    const epId = defaultEpisodeId
    saved.episodes = {
      [epId]: {
        id: epId,
        episode: saved.episode || init.episode,
        cuts: saved.cuts || init.cuts,
        scriptRaw: saved.scriptRaw || '',
        createdAt: new Date().toISOString(),
      }
    }
    saved.activeEpisodeId = epId
  }
  // 캐릭터 기본값 구버전 → 현재버전 자동 업데이트
  if (saved.episode?.character)
    saved.episode = { ...saved.episode, character: upgradeCharacter(saved.episode.character) }
  if (saved.episodes) {
    Object.values(saved.episodes).forEach(ep => {
      if (ep.episode?.character)
        ep.episode = { ...ep.episode, character: upgradeCharacter(ep.episode.character) }
    })
  }
  if (!saved.openTabIds || !saved.openTabIds.length)
    saved.openTabIds = saved.activeEpisodeId ? [saved.activeEpisodeId] : [defaultEpisodeId]
  saved.openTabIds = saved.openTabIds.filter(id => saved.episodes[id])
  if (!saved.openTabIds.length) saved.openTabIds = [saved.activeEpisodeId || defaultEpisodeId]
  saved.videoTabState = {
    videoClips: {},
    g4Approved: {},
    selectedCutId: null,
    subtitles: {},
    ...(saved.videoTabState || {}),
  }
  saved.ttsTabState = {
    audioUrls: {},
    audioTexts: {},
    g3Confirmed: {},
    ...(saved.ttsTabState || {}),
  }
  return { ...init, ...saved }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, defaultState, (init) => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s) return migrateState(JSON.parse(s), init)
    } catch {}
    return init
  })

  const [syncStatus, setSyncStatus] = useState('idle')
  const serverChecked = useRef(false)
  const skipNextSync  = useRef(false)
  const syncTimer     = useRef(null)

  // 앱 시작 시 서버 데이터 로드 (서버 우선)
  useEffect(() => {
    ;(async () => {
      setSyncStatus('syncing')
      try {
        const controller = new AbortController()
        const tid = setTimeout(() => controller.abort(), 4000)
        const res = await fetch(`${SERVER}/api/studio-data`, { signal: controller.signal })
        clearTimeout(tid)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (data && Object.keys(data).length > 0) {
          skipNextSync.current = true
          dispatch({ type: 'LOAD', p: migrateState(data, defaultState) })
        }
        setSyncStatus('synced')
      } catch {
        setSyncStatus('offline')
      } finally {
        serverChecked.current = true
      }
    })()
  }, [])

  // 상태 변경 시 localStorage 저장 + 서버 동기화 (디바운스 1.2초)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    if (!serverChecked.current) return   // 서버 확인 전엔 동기화 보류
    if (skipNextSync.current) { skipNextSync.current = false; return }

    clearTimeout(syncTimer.current)
    setSyncStatus('syncing')
    syncTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${SERVER}/api/studio-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state),
        })
        if (!res.ok) throw new Error()
        setSyncStatus('synced')
      } catch {
        setSyncStatus('offline')
      }
    }, 1200)
  }, [state])

  return (
    <AppContext.Provider value={{ state, dispatch, syncStatus }}>
      {children}
    </AppContext.Provider>
  )
}
export const useApp = () => useContext(AppContext)

