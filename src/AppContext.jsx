import { createContext, useContext, useReducer, useEffect } from 'react'

const AppContext = createContext(null)
const STORAGE_KEY = 'yeori-studio-v2'

const makeCuts = (n) => Array.from({ length: n }, (_, i) => ({
  id: `cut-${i + 1}`, no: i + 1,
  scene: '', action: '', character: '서여리',
  dialogue: '', narration: '', imagePrompt: '',
  duration: 5,
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
    character: '서여리 - 20대 중반 한국 여성, 긴 웨이비 다크 브라운 헤어, 오른쪽 볼 매력점, 골드 목걸이, AI 크리에이터',
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
  episodes: {
    [defaultEpisodeId]: makeEpisode(defaultEpisodeId, 1),
  },

  // 하위 호환: 현재 에피소드 직접 접근용 (기존 탭들 그대로 작동)
  episode: { number: 1, title: '', location: '카페', mood: '감성', cutCount: 7, character: '서여리 - 20대 중반 한국 여성, 긴 웨이비 다크 브라운 헤어, 오른쪽 볼 매력점, 골드 목걸이, AI 크리에이터' },
  cuts: makeCuts(7),
  scriptRaw: '',

  ttsSettings: { voiceId: '21m00Tcm4TlvDq8ikWAM', emotion: 50, tone: 50, speed: 1.0 },
  videoSettings: { subtitleEnabled: true, font: 'Apple SD Gothic Neo', fontSize: 32, color: '#ffffff', bgStyle: 'semi' },
  renderProgress: { current: 0, total: 0, isRendering: false },
  thumbnail: { text: '', fontSize: 48, color: '#ffffff', shadowColor: '#000000', bold: true, textY: 70 },
  dashboard: { flowCredits: 100, klingCredits: 50, elevenlabsChars: 10000, monthBudget: 50000, spent: 0 },
  projectName: '새 프로젝트',
  savedAt: null,
}

function reducer(state, action) {
  switch (action.type) {

    // ── 에피소드 전환 ────────────────────────────────────────
    case 'SWITCH_EPISODE': {
      const ep = state.episodes[action.id]
      if (!ep) return state
      return {
        ...state,
        activeEpisodeId: action.id,
        episode: ep.episode,
        cuts: ep.cuts,
        scriptRaw: ep.scriptRaw || '',
      }
    }

    // ── 새 에피소드 추가 ─────────────────────────────────────
    case 'ADD_EPISODE': {
      const epCount = Object.keys(state.episodes).length
      const newId = `ep_${Date.now()}`
      const newEp = makeEpisode(newId, epCount + 1)
      return {
        ...state,
        episodes: { ...state.episodes, [newId]: newEp },
        activeEpisodeId: newId,
        episode: newEp.episode,
        cuts: newEp.cuts,
        scriptRaw: '',
      }
    }

    // ── 에피소드 삭제 ────────────────────────────────────────
    case 'DELETE_EPISODE': {
      if (Object.keys(state.episodes).length <= 1) return state // 마지막 에피소드 삭제 금지
      const newEpisodes = { ...state.episodes }
      delete newEpisodes[action.id]
      const firstId = Object.keys(newEpisodes)[0]
      const firstEp = newEpisodes[firstId]
      return {
        ...state,
        episodes: newEpisodes,
        activeEpisodeId: firstId,
        episode: firstEp.episode,
        cuts: firstEp.cuts,
        scriptRaw: firstEp.scriptRaw || '',
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

    case 'LOAD': return { ...defaultState, ...action.p, savedAt: new Date().toISOString() }
    default: return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, defaultState, (init) => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s) {
        const saved = JSON.parse(s)
        // 기존 데이터 마이그레이션 (episodes 없는 구버전 호환)
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
        return { ...init, ...saved }
      }
    } catch {}
    return init
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}
export const useApp = () => useContext(AppContext)
