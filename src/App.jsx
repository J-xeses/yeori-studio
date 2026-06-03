import { useState, useEffect } from 'react'
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

// ── 에피소드 목록 사이드바 (좌측 고정 패널) ───────────────────
function EpisodeSidebar({ onClose }) {
    const { state, dispatch } = useApp()
    const { episodes, activeEpisodeId, openTabIds = [] } = state

    const epList = Object.values(episodes).sort((a, b) =>
        new Date(a.createdAt) - new Date(b.createdAt)
    )

    const handleAdd = () => {
        if (Object.keys(episodes).length >= 10) { alert('에피소드는 최대 10개까지 만들 수 있어요.'); return }
        dispatch({ type: 'ADD_EPISODE' })
    }

    const handleSwitch = (id) => {
        dispatch({ type: 'SWITCH_EPISODE', id })
    }

    const handleDelete = (e, id) => {
        e.stopPropagation()
        if (Object.keys(episodes).length <= 1) return
        if (!confirm('에피소드를 완전히 삭제할까요?\n(탭만 닫으려면 탭의 ✕ 버튼을 이용하세요)')) return
        dispatch({ type: 'DELETE_EPISODE', id })
    }

    return (
        <div style={{
            width: 240, flexShrink: 0,
            background: 'var(--bg2)',
            borderRight: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
        }}>
            {/* 헤더 */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 12px', height: 36, flexShrink: 0,
                borderBottom: '1px solid var(--border)',
            }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.05em' }}>
                    에피소드 목록 ({epList.length}/10)
                </span>
                <button
                    onClick={onClose}
                    style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                    title="사이드바 닫기"
                >✕</button>
            </div>

            {/* 에피소드 목록 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {epList.map(ep => {
                    const status = getEpStatus(ep)
                    const isActive = ep.id === activeEpisodeId
                    const isOpen = openTabIds.includes(ep.id)
                    const title = ep.episode.title || '새 에피소드'
                    return (
                        <div
                            key={ep.id}
                            onClick={() => handleSwitch(ep.id)}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: 8,
                                padding: '9px 12px', cursor: 'pointer',
                                background: isActive ? 'rgba(124,58,237,0.2)' : 'transparent',
                                borderLeft: `3px solid ${isActive ? '#a78bfa' : 'transparent'}`,
                                transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                        >
                            {/* EP번호 */}
                            <div style={{
                                fontSize: 10, fontWeight: 700, flexShrink: 0,
                                color: isActive ? '#c4b5fd' : 'var(--text3)',
                                paddingTop: 2, minWidth: 28,
                            }}>
                                EP{ep.episode.number}
                            </div>

                            {/* 제목 + 메타 */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: 12, lineHeight: 1.3,
                                    color: isActive ? '#ede9fe' : 'var(--text)',
                                    fontWeight: isActive ? 700 : 400,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {ep.episode.title || `EP${ep.episode.number} 새 에피소드`}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, display: 'flex', gap: 4, alignItems: 'center' }}>
                                    <span>{ep.cuts.length}컷</span>
                                    <span>·</span>
                                    <span>{ep.episode.location}</span>
                                    {isOpen && <span style={{ color: '#a78bfa', fontWeight: 600 }}>· 열림</span>}
                                </div>
                            </div>

                            {/* 상태 + 삭제 */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                                <span style={{
                                    fontSize: 9, padding: '1px 5px', borderRadius: 8,
                                    color: status.color,
                                    background: `${status.color}18`,
                                    border: `1px solid ${status.color}30`,
                                }}>{status.label}</span>
                                {Object.keys(episodes).length > 1 && (
                                    <span
                                        onClick={e => handleDelete(e, ep.id)}
                                        title="에피소드 삭제"
                                        style={{ fontSize: 11, color: '#4b4b5a', cursor: 'pointer', lineHeight: 1 }}
                                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                                        onMouseLeave={e => e.currentTarget.style.color = '#4b4b5a'}
                                    >🗑</span>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* 하단 추가 버튼 */}
            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
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
    )
}

// ── 에피소드 탭 바 (탭만, 사이드바 상태는 props로) ──────────────
function EpisodeBar({ showSidebar, onToggleSidebar }) {
    const { state, dispatch } = useApp()
    const { episodes, activeEpisodeId, openTabIds = [] } = state

    const openTabs = openTabIds.map(id => episodes[id]).filter(Boolean)

    const handleAdd = () => {
        if (Object.keys(episodes).length >= 10) { alert('에피소드는 최대 10개까지 만들 수 있어요.'); return }
        dispatch({ type: 'ADD_EPISODE' })
    }
    const handleClose = (e, id) => {
        e.stopPropagation()
        dispatch({ type: 'CLOSE_TAB', id })
    }

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '0 8px 0 4px', background: 'var(--bg2)',
            borderBottom: '1px solid var(--border)',
            overflowX: 'auto', flexShrink: 0, minHeight: 36,
        }}>
            {/* 목록 토글 버튼 */}
            <button
                onClick={onToggleSidebar}
                title={showSidebar ? '사이드바 닫기' : '에피소드 목록'}
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
                const rawTitle = ep.episode.title || `EP${ep.episode.number} 새 에피소드`
                const label = rawTitle.slice(0, 14) + (rawTitle.length > 14 ? '…' : '')
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
    )
}

const SIDEBAR_W = 240

function Layout() {
    const { state } = useApp()
    const Tab = TAB_MAP[state.activeTab] || ScriptGenTab
    const [showSidebar, setShowSidebar] = useState(false)

    return (
        <div className={s.app}>
            <NavBar />
            <ApiBar />
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
                {/* 사이드바 — position absolute, slide in/out */}
                <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: SIDEBAR_W,
                    transform: `translateX(${showSidebar ? '0' : `-${SIDEBAR_W}px`})`,
                    transition: 'transform 0.2s ease',
                    zIndex: 10,
                }}>
                    <EpisodeSidebar onClose={() => setShowSidebar(false)} />
                </div>

                {/* 메인 영역 — margin-left로 밀려남 */}
                <div style={{
                    display: 'flex', flexDirection: 'column', height: '100%',
                    marginLeft: showSidebar ? SIDEBAR_W : 0,
                    transition: 'margin-left 0.2s ease',
                    overflow: 'hidden',
                }}>
                    <EpisodeBar showSidebar={showSidebar} onToggleSidebar={() => setShowSidebar(v => !v)} />
                    <div className={s.content}>
                        <Tab />
                    </div>
                </div>
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
