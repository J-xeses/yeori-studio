import { useState } from 'react'
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

// ── 에피소드 진행 상태 계산 ────────────────────────────────────
function getEpStatus(ep) {
    if (!ep.scriptRaw) return { label: '초안', color: '#6b7280' }
    const filled = ep.cuts.filter(c => c.imagePrompt?.trim()).length
    if (filled >= ep.cuts.length && ep.cuts.length > 0) return { label: '완료', color: '#22c55e' }
    if (filled > 0) return { label: '진행 중', color: '#f59e0b' }
    return { label: '생성됨', color: '#a78bfa' }
}

// ── 에피소드 탭 바 + 목록 사이드바 ────────────────────────────
function EpisodeBar() {
    const { state, dispatch } = useApp()
    const { episodes, activeEpisodeId, openTabIds = [] } = state
    const [showSidebar, setShowSidebar] = useState(false)

    const epList = Object.values(episodes).sort((a, b) =>
        new Date(a.createdAt) - new Date(b.createdAt)
    )
    const openTabs = openTabIds.map(id => episodes[id]).filter(Boolean)

    const handleAdd = () => {
        if (Object.keys(episodes).length >= 10) { alert('에피소드는 최대 10개까지 만들 수 있어요.'); return }
        dispatch({ type: 'ADD_EPISODE' })
        setShowSidebar(false)
    }
    const handleClose = (e, id) => {
        e.stopPropagation()
        dispatch({ type: 'CLOSE_TAB', id })
    }
    const handleDelete = (e, id) => {
        e.stopPropagation()
        if (Object.keys(episodes).length <= 1) return
        if (!confirm('에피소드를 완전히 삭제할까요?\n(탭만 닫으려면 탭의 ✕ 버튼을 이용하세요)')) return
        dispatch({ type: 'DELETE_EPISODE', id })
    }
    const handleSwitch = (id) => {
        dispatch({ type: 'SWITCH_EPISODE', id })
        setShowSidebar(false)
    }

    return (
        <div style={{ position: 'relative', flexShrink: 0 }}>
            {/* 탭 바 */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '0 8px 0 4px', background: 'var(--bg2)',
                borderBottom: '1px solid var(--border)',
                overflowX: 'auto', minHeight: 36,
            }}>
                {/* 목록 토글 버튼 */}
                <button
                    onClick={() => setShowSidebar(v => !v)}
                    title="에피소드 목록"
                    style={{
                        padding: '4px 8px', borderRadius: 6, border: 'none', flexShrink: 0,
                        background: showSidebar ? 'var(--purple)' : 'transparent',
                        color: showSidebar ? '#fff' : 'var(--text3)',
                        fontSize: 14, cursor: 'pointer', transition: 'all 0.15s',
                    }}
                >☰</button>

                {/* 열린 탭들 */}
                {openTabs.map(ep => {
                    const isActive = ep.id === activeEpisodeId
                    const title = ep.episode.title
                    const label = title
                        ? `EP${ep.episode.number} ${title.slice(0, 10)}${title.length > 10 ? '…' : ''}`
                        : `EP${ep.episode.number}`
                    return (
                        <div
                            key={ep.id}
                            onClick={() => dispatch({ type: 'SWITCH_EPISODE', id: ep.id })}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                                background: isActive ? 'var(--purple)' : 'transparent',
                                color: isActive ? '#fff' : 'var(--text3)',
                                fontSize: 11, fontWeight: isActive ? 700 : 400,
                                border: isActive ? '1px solid var(--purple)' : '1px solid transparent',
                                transition: 'all 0.15s', userSelect: 'none', whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text)' }}
                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text3)' }}
                        >
                            {label}
                            <span
                                onClick={e => handleClose(e, ep.id)}
                                title="탭 닫기 (데이터 유지)"
                                style={{
                                    marginLeft: 2, fontSize: 10, lineHeight: 1, cursor: 'pointer',
                                    color: isActive ? 'rgba(255,255,255,0.6)' : 'var(--text3)',
                                }}
                            >✕</span>
                        </div>
                    )
                })}

                <button
                    onClick={handleAdd}
                    style={{
                        padding: '3px 10px', borderRadius: 6, flexShrink: 0,
                        background: 'transparent', border: '1px dashed var(--border2)',
                        color: 'var(--text3)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--purple)'; e.currentTarget.style.borderColor = 'var(--purple)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border2)' }}
                    title="새 에피소드 추가"
                >+ 새 에피소드</button>
            </div>

            {/* 에피소드 목록 사이드바 드롭다운 */}
            {showSidebar && (
                <>
                    <div onClick={() => setShowSidebar(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                    <div style={{
                        position: 'absolute', top: '100%', left: 0, zIndex: 100,
                        width: 360, maxHeight: 480, overflowY: 'auto',
                        background: 'var(--bg2)', border: '1px solid var(--border)',
                        borderRadius: '0 0 8px 8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    }}>
                        <div style={{
                            padding: '10px 12px 8px', fontSize: 11, fontWeight: 600,
                            color: 'var(--text3)', letterSpacing: '0.05em',
                            borderBottom: '1px solid var(--border)',
                        }}>
                            전체 에피소드 ({epList.length} / 10)
                        </div>

                        {epList.map(ep => {
                            const status = getEpStatus(ep)
                            const isActive = ep.id === activeEpisodeId
                            const isOpen = openTabIds.includes(ep.id)
                            return (
                                <div
                                    key={ep.id}
                                    onClick={() => handleSwitch(ep.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '8px 12px', cursor: 'pointer',
                                        background: isActive ? 'rgba(124,58,237,0.12)' : 'transparent',
                                        borderLeft: `2px solid ${isActive ? 'var(--purple)' : 'transparent'}`,
                                        transition: 'background 0.1s',
                                    }}
                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                                >
                                    <div style={{ width: 34, fontSize: 10, fontWeight: 700, flexShrink: 0, color: isActive ? 'var(--purple)' : 'var(--text3)' }}>
                                        EP{ep.episode.number}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {ep.episode.title || '(제목 없음)'}
                                        </div>
                                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                                            {ep.cuts.length}컷 · {ep.episode.location}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                        <span style={{
                                            fontSize: 10, padding: '1px 6px', borderRadius: 10,
                                            color: status.color, background: `${status.color}18`,
                                            border: `1px solid ${status.color}40`,
                                        }}>{status.label}</span>
                                        {isOpen && <span style={{ fontSize: 9, color: 'var(--text3)' }}>열림</span>}
                                        {Object.keys(episodes).length > 1 && (
                                            <span
                                                onClick={e => handleDelete(e, ep.id)}
                                                title="에피소드 삭제"
                                                style={{ fontSize: 11, color: '#6b7280', cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1 }}
                                                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                                                onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}
                                            >🗑</span>
                                        )}
                                    </div>
                                </div>
                            )
                        })}

                        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                            <button
                                onClick={handleAdd}
                                style={{
                                    width: '100%', padding: '7px', borderRadius: 6,
                                    background: 'transparent', border: '1px dashed var(--border2)',
                                    color: 'var(--text3)', fontSize: 11, cursor: 'pointer',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--purple)'; e.currentTarget.style.borderColor = 'var(--purple)' }}
                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border2)' }}
                            >+ 새 에피소드 추가</button>
                        </div>
                    </div>
                </>
            )}
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
