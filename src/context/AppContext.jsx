import { createContext, useContext, useReducer, useEffect } from 'react'

const AppContext = createContext(null)
const STORAGE_KEY = 'yeori-studio-v2'

const makeCuts = (n) => Array.from({ length: n }, (_, i) => ({
  id: `cut-${i + 1}`, no: i + 1,
  scene: '', action: '', character: '서여리',
  dialogue: '', narration: '', imagePrompt: '',
  duration: 5, cutType: 'NORMAL',
}))

const defaultState = {
  activeTab: 'script',
  apiKeys: { claude: '', elevenLabs: '', gemini: '' },
  vertexAI: false,
  elevenLabsStatus: { connected: false, remainingChars: 0 },
  episode: { number: 1, title: '', location: '카페', mood: '감성', cutCount: 17, character: '서여리 - 20대 여성, 감성적인 유튜브 크리에이터' },
  cuts: makeCuts(17),
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
    case 'SET_TAB': return { ...state, activeTab: action.p }
    case 'SET_API_KEY': return { ...state, apiKeys: { ...state.apiKeys, [action.key]: action.val } }
    case 'TOGGLE_VERTEX': return { ...state, vertexAI: !state.vertexAI }
    case 'SET_EL_STATUS': return { ...state, elevenLabsStatus: action.p }
    case 'SET_EPISODE': return { ...state, episode: { ...state.episode, ...action.p } }
    case 'SET_CUTS': return { ...state, cuts: action.p }
    case 'UPDATE_CUT': return { ...state, cuts: state.cuts.map(c => c.id === action.id ? { ...c, ...action.p } : c) }
    case 'SET_SCRIPT_RAW': return { ...state, scriptRaw: action.p }
    case 'SET_TTS': return { ...state, ttsSettings: { ...state.ttsSettings, ...action.p } }
    case 'SET_VIDEO': return { ...state, videoSettings: { ...state.videoSettings, ...action.p } }
    case 'SET_RENDER': return { ...state, renderProgress: { ...state.renderProgress, ...action.p } }
    case 'SET_THUMB': return { ...state, thumbnail: { ...state.thumbnail, ...action.p } }
    case 'SET_DASH': return { ...state, dashboard: { ...state.dashboard, ...action.p } }
    case 'SET_PROJECT': return { ...state, projectName: action.p }
    case 'MARK_SAVED': return { ...state, savedAt: new Date().toISOString() }
    case 'RESET_CUTS': return { ...state, cuts: makeCuts(action.n), episode: { ...state.episode, cutCount: action.n } }
    case 'LOAD': return { ...defaultState, ...action.p, savedAt: new Date().toISOString() }
    default: return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, defaultState, (init) => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s) return { ...init, ...JSON.parse(s) }
    } catch {}
    return init
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

export const useApp = () => useContext(AppContext)
