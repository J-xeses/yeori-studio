import { AppProvider, useApp } from './context/AppContext'
import NavBar from './components/NavBar'
import ApiBar from './components/ApiBar'
import ScriptGenTab from './tabs/ScriptGenTab'
import StudioTab from './tabs/StudioTab'
import TTSTab from './tabs/TTSTab'
import VoiceTab from './tabs/VoiceTab'
import ExtractTab from './tabs/ExtractTab'
import VideoTab from './tabs/VideoTab'
import ThumbnailTab from './tabs/ThumbnailTab'
import DashboardTab from './tabs/DashboardTab'
import RetentionHookTab from './tabs/RetentionHookTab'
import EditMetaTab from './tabs/EditMetaTab'
import StoryArchiveTab from './tabs/StoryArchiveTab'
import s from './App.module.css'

const TAB_MAP = {
    script: ScriptGenTab,
    studio: StudioTab,
    tts: TTSTab,
    voice: VoiceTab,
    extract: ExtractTab,
    video: VideoTab,
    thumbnail: ThumbnailTab,
    dashboard: DashboardTab,
    retention: RetentionHookTab,
    editmeta: EditMetaTab,
    storyarchive: StoryArchiveTab,
}

// ── 에피소드 탭 바 ─────────────────────────────────────────────
function EpisodeBar() {
    const { state, dispatch } = useApp()
    const { episodes, activeEpisodeId } = state
    const epList = Object.values(episodes).sort((a, b) =>
        new Date(a.createdAt) - new Date(b.createdAt)
    )

    const handleAdd = () => {
        if (Object.keys(episodes).length >= 10) {
            alert('에피소드는 최대 10개까지 만들 수 있어요.')
            return
        }
        dispatch({ type: 'ADD_EPISODE' })
    }

    const handleDelete = (e, id) => {
        e.stopPropagation()
        if (Object.keys(episodes).length <= 1) return
        if (!confirm('이 에피소드를 삭제할까요?')) return
        dispatch({ type: 'DELETE_EPISODE', id })
    }

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '0 16px', background: 'var(--bg2)',
            borderBottom: '1px solid var(--border)',
            overflowX: 'auto', flexShrink: 0, minHeight: 36,
        }}>
            {epList.map((ep) => {
                const isActive = ep.id === activeEpisodeId
                const label = ep.episode.title
                    ? `EP${ep.episode.number} ${ep.episode.title.slice(0, 12)}${ep.episode.title.length > 12 ? '…' : ''}`
                    : `EP${ep.episode.number}`
                return (
                    <div
                        key={ep.id}
                        onClick={() => dispatch({ type: 'SWITCH_EPISODE', id: ep.id })}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 6,
                            background: isActive ? 'var(--purple)' : 'transparent',
                            color: isActive ? '#fff' : 'var(--text3)',
                            fontSize: 11, fontWeight: isActive ? 700 : 400,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                            border: isActive ? '1px solid var(--purple)' : '1px solid transparent',
                            transition: 'all 0.15s',
                            userSelect: 'none',
                        }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text)' }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text3)' }}
                    >
                        {label}
                        {Object.keys(episodes).length > 1 && (
                            <span
                                onClick={(e) => handleDelete(e, ep.id)}
                                style={{
                                    marginLeft: 2, fontSize: 10,
                                    color: isActive ? 'rgba(255,255,255,0.6)' : 'var(--text3)',
                                    cursor: 'pointer', lineHeight: 1,
                                }}
                                title="삭제"
                            >✕</span>
                        )}
                    </div>
                )
            })}
            <button
                onClick={handleAdd}
                style={{
                    padding: '3px 10px', borderRadius: 6,
                    background: 'transparent',
                    border: '1px dashed var(--border2)',
                    color: 'var(--text3)', fontSize: 11,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--purple)'; e.currentTarget.style.borderColor = 'var(--purple)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border2)' }}
                title="새 에피소드 추가"
            >+ 새 에피소드</button>
        </div>
    )
}

function Layout() {
    const { state } = useApp()
    const Tab = TAB_MAP[state.activeTab] || ScriptGenTab
    return (
        <div className={s.app}>
            <NavBar />
            <ApiBar />
            <EpisodeBar />
            <div className={s.content}>
                <Tab />
            </div>
        </div>
    )
}

export default function App() {
    return (
        <AppProvider>
            <Layout />
        </AppProvider>
    )
}
