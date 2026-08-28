import { useState, useEffect } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { formatEpisodeCode, displayEpisodeCode, resolveEpisodeCode, validateEpisodeCode } from './lib/episodeCode'
import { setGPoint, loadGPoints } from './lib/gpoints'

const SIDEBAR_W = 288
import NavBar from './components/NavBar'
import ApiBar from './components/ApiBar'
import ScriptGenTab from './tabs/ScriptGenTab'
import StudioTab from './tabs/StudioTab'
import TTSTab from './tabs/TTSTab'
import VoiceTab from './tabs/VoiceTab'
import ExtractTab from './tabs/ExtractTab'
import VideoTab from './tabs/VideoTab'
import PublishingTab from './tabs/PublishingTab'
import DashboardTab from './tabs/DashboardTab'
import CreditsTab from './tabs/CreditsTab'
import RetentionHookTab from './tabs/RetentionHookTab'
import EditMetaTab from './tabs/EditMetaTab'
import StoryArchiveTab from './tabs/StoryArchiveTab'
import MakingTab from './tabs/MakingTab'
import TaskQueueTab from './tabs/TaskQueueTab'
import s from './App.module.css'

const TAB_MAP = {
    script: ScriptGenTab,
    studio: StudioTab,
    tts: TTSTab,
    voice: VoiceTab,
    extract: ExtractTab,
    video: VideoTab,
    publishing: PublishingTab,
    dashboard: DashboardTab,
    credits: CreditsTab,
    retention: RetentionHookTab,
    editmeta: EditMetaTab,
    storyarchive: StoryArchiveTab,
    making: MakingTab,
    taskqueue: TaskQueueTab,
}

// ── 에피소드 진행 상태 계산 ────────────────────────────────────
function getEpStatus(ep) {
    if (!ep.scriptRaw) return { label: '초안', color: '#6b7280' }
    const filled = ep.cuts.filter(c => c.imagePrompt?.trim()).length
    if (filled >= ep.cuts.length && ep.cuts.length > 0) return { label: '완료', color: '#22c55e' }
    if (filled > 0) return { label: '진행 중', color: '#f59e0b' }
    return { label: '생성됨', color: '#a78bfa' }
}

const SIDEBAR_EP_GROUPS = [
    { id: 'youtube',   label: '📺 YouTube',   types: ['LF', 'SF'] },
    { id: 'instagram', label: '📷 Instagram', types: ['IG_R', 'IG_P', 'IG_S'] },
    { id: 'tiktok',    label: '🎵 TikTok',    types: ['TK'] },
]
const CONTENT_TYPE_OPTIONS = [
    { value: 'LF',   label: 'LF — YouTube 롱폼' },
    { value: 'SF',   label: 'SF — YouTube 숏폼' },
    { value: 'IG_R', label: 'IG_R — Instagram 릴스' },
    { value: 'IG_P', label: 'IG_P — Instagram 피드' },
    { value: 'IG_S', label: 'IG_S — Instagram 스토리' },
    { value: 'TK',   label: 'TK — TikTok' },
]

// G1 이후(G2~G5) 단계별 "다음 탭으로" 버튼 설정 — 순서대로 검사해서 아직 다 안 끝난
// 첫 단계로 안내한다. 컷 타입별 스킵(GRAPHIC/CAPCUT 등은 G2/G4 건너뜀) 로직까지는
// 반영하지 않은 단순 카운트 비교라, 그런 컷이 섞인 에피소드는 실제로는 끝났는데도
// "아직 남음"으로 표시될 수 있음 — 그래도 "항상 스튜디오 탭"보다는 훨씬 정확하다.
const NEXT_STAGE_STEPS = [
    { gKey: 'g2', tab: 'studio',   label: '🎨 스튜디오 탭으로 →' },
    { gKey: 'g3', tab: 'tts',      label: '🔊 TTS 탭으로 →' },
    { gKey: 'g4', tab: 'video',    label: '🎬 영상 만들기 탭으로 →' },
    { gKey: 'g5', tab: 'editmeta', label: '✂️ 편집 메타 탭으로 →' },
]

// ── 에피소드 목록 사이드바 (좌측 고정 패널) ───────────────────
function EpisodeSidebar({ onClose }) {
    const { state, dispatch } = useApp()
    const { episodes, activeEpisodeId, openTabIds = [] } = state
    const [collapsed, setCollapsed] = useState({})
    const [addOpen, setAddOpen] = useState(false)
    const [newType, setNewType] = useState('LF')
    const [newSlug, setNewSlug] = useState('')
    const [addError, setAddError] = useState('')
    const [gData, setGData] = useState(() => loadGPoints())

    // 다른 탭(대본생성 탭 등)에서 G1을 승인/취소해도 이 컴포넌트의 gData는 갱신되지
    // 않아서(각자 독립된 useState라 서로 안 알려줌), 사이드바의 진행률·"스튜디오 탭으로"
    // 버튼이 그 변경을 못 따라가고 낡은 값을 계속 보여주는 문제가 있었다 — 다른 곳
    // (EpisodeInfoSidebar.jsx)과 동일한 폴링 방식으로 주기적으로 다시 읽어온다.
    useEffect(() => {
        const id = setInterval(() => setGData(loadGPoints()), 2000)
        return () => clearInterval(id)
    }, [])

    const approveAllG1 = (e, ep) => {
        e.stopPropagation()
        const epCode = resolveEpisodeCode(ep.episode)
        ;(ep.cuts || []).forEach(c => setGPoint(epCode, c.no, 'g1', true))
        setGData(loadGPoints())
        setTimeout(() => dispatch({ type: 'SET_TAB', p: 'studio' }), 600)
    }

    const allEps = Object.values(episodes).sort((a, b) =>
        (a.episode.number || 0) - (b.episode.number || 0)
    )
    const knownTypes = SIDEBAR_EP_GROUPS.flatMap(g => g.types)

    // 다음 자동 배정될 번호 — 전체 에피소드 통틀어 최댓값+1(전역 카운터). 실제 배정은
    // ADD_EPISODE reducer가 다시 계산하지만 코드 미리보기/검증용으로 여기서도 동일하게 계산해둔다.
    // 주의: episode.number는 downloads/{flow,video,audio}/ep{number}/ 파일 경로에도 그대로
    // 쓰여서, 한때(2026-08-08) 콘텐츠유형별 독립 번호로 바꿨다가 서로 다른 유형이 같은 번호를
    // 가지면서 실제로 downloads/flow/ep1/ 같은 폴더를 여러 에피소드가 공유하는 충돌이 발생함을
    // 확인(2026-08-15). 파일경로를 episode.code 기준으로 전면 교체하는 근본 해법("4차")은 범위가
    // 너무 커서 보류하고, 대신 번호를 다시 전역 유일값으로 되돌려 충돌 자체를 원천 차단한다 —
    // 트레이드오프로 코드의 "E0N" 숫자가 유형별로 1부터 시작하지 않을 수 있음(예: 두 번째로
    // 만들어진 콘텐츠유형의 첫 에피소드가 E02로 보일 수 있음).
    const nextNumber = Math.max(0, ...Object.values(episodes)
        .map(e => e.episode.number)) + 1
    const previewCode = formatEpisodeCode(newType, nextNumber, newSlug)

    const openAddForm = () => {
        if (Object.keys(episodes).length >= 10) { alert('에피소드는 최대 10개까지 만들 수 있어요.'); return }
        setNewType('LF'); setNewSlug(''); setAddError(''); setAddOpen(true)
    }

    const confirmAdd = () => {
        const code = formatEpisodeCode(newType, nextNumber, newSlug)
        const { valid, error } = validateEpisodeCode(code)
        if (!valid) { setAddError(error); return }
        const isDup = Object.values(episodes).some(e => e.episode?.code === code)
        if (isDup) { setAddError(`이미 사용 중인 코드입니다: ${code}`); return }
        dispatch({ type: 'ADD_EPISODE', contentType: newType, code })
        setAddOpen(false)
    }

    const cancelAdd = () => { setAddOpen(false); setAddError('') }

    const handleDelete = (e, id) => {
        e.stopPropagation()
        if (Object.keys(episodes).length <= 1) return
        if (!confirm('에피소드를 완전히 삭제할까요?\n(탭만 닫으려면 탭의 ✕ 버튼을 이용하세요)')) return
        dispatch({ type: 'DELETE_EPISODE', id })
    }

    const renderItem = (ep) => {
        const status = getEpStatus(ep)
        const isActive = ep.id === activeEpisodeId
        const isOpen = openTabIds.includes(ep.id)
        const epCode = ep.episode?.contentType ? displayEpisodeCode(ep.episode) : `EP${String(ep.episode.number).padStart(2, '0')}`
        const epGpKey = resolveEpisodeCode(ep.episode)
        const epCuts = ep.cuts || []
        const epG1 = epCuts.filter(c => gData[epGpKey]?.[`cut_${c.no}`]?.g1).length
        const epTotal = epCuts.length
        const epAllDone = epTotal > 0 && epG1 === epTotal
        // G1까지 끝났으면, G2~G5 중 아직 다 안 끝난 첫 단계로 안내 — 전부 끝났으면 null(완료 표시)
        const nextStage = epAllDone
            ? NEXT_STAGE_STEPS.find(step => epCuts.filter(c => gData[epGpKey]?.[`cut_${c.no}`]?.[step.gKey]).length < epTotal)
            : null
        return (
            <div
                key={ep.id}
                onClick={() => dispatch({ type: 'SWITCH_EPISODE', id: ep.id })}
                style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '8px 12px 8px 20px', cursor: 'pointer',
                    background: isActive ? 'rgba(124,58,237,0.2)' : 'transparent',
                    borderLeft: `3px solid ${isActive ? '#a78bfa' : 'transparent'}`,
                    transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? 'rgba(124,58,237,0.2)' : 'transparent' }}
            >
                {/* 코드 배지 */}
                <div style={{
                    fontSize: 9, fontWeight: 700, flexShrink: 0,
                    color: isActive ? '#c4b5fd' : 'var(--text3)',
                    paddingTop: 2, minWidth: 44,
                }}>
                    {epCode}
                </div>

                {/* 제목 + 메타 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        fontSize: 12, lineHeight: 1.3,
                        color: isActive ? '#ede9fe' : 'var(--text)',
                        fontWeight: isActive ? 700 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {ep.episode.title || '새 에피소드'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span>{ep.cuts.length}컷</span>
                        <span>·</span>
                        <span>{ep.episode.location}</span>
                        {isOpen && <span style={{ color: '#a78bfa', fontWeight: 600 }}>· 열림</span>}
                    </div>
                    {epTotal > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                            <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${(epG1 / epTotal) * 100}%`, background: epAllDone ? '#22c55e' : '#a78bfa' }} />
                            </div>
                            <span style={{ fontSize: 9, color: 'var(--text3)', flexShrink: 0 }}>G1 {epG1}/{epTotal}</span>
                        </div>
                    )}
                    {isActive && epTotal > 0 && !epAllDone && (
                        <button
                            onClick={e => approveAllG1(e, ep)}
                            style={{
                                marginTop: 6, width: '100%', padding: '4px 0', borderRadius: 5,
                                background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)',
                                color: '#c4b5fd', fontSize: 10, cursor: 'pointer',
                            }}
                        >✅ 전체 G1 승인</button>
                    )}
                    {isActive && epAllDone && nextStage && (
                        <button
                            onClick={e => { e.stopPropagation(); dispatch({ type: 'SET_TAB', p: nextStage.tab }) }}
                            style={{
                                marginTop: 6, width: '100%', padding: '4px 0', borderRadius: 5,
                                background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
                                color: '#4ade80', fontSize: 10, cursor: 'pointer',
                            }}
                        >{nextStage.label}</button>
                    )}
                    {isActive && epAllDone && !nextStage && (
                        <div style={{
                            marginTop: 6, width: '100%', padding: '4px 0', borderRadius: 5,
                            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                            color: '#4ade80', fontSize: 10, textAlign: 'center',
                        }}>🎉 G1~G5 전체 완료</div>
                    )}
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
    }

    const renderGroupHeader = (id, label, count) => (
        <div
            onClick={() => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '5px 12px', cursor: 'pointer',
                background: 'rgba(255,255,255,0.03)',
                borderBottom: '1px solid var(--border)',
                fontSize: 10, fontWeight: 600, color: 'var(--text3)',
                letterSpacing: '0.04em',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
        >
            <span>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.08)', color: 'var(--text3)',
                }}>{count}</span>
                <span style={{ fontSize: 9 }}>{collapsed[id] ? '▶' : '▼'}</span>
            </div>
        </div>
    )

    return (
        <div style={{
            width: SIDEBAR_W, flexShrink: 0, height: '100%',
            background: 'var(--bg2)',
            borderRight: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
        }}>
            {/* 헤더 */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 14px', height: 40, flexShrink: 0,
                borderBottom: '1px solid var(--border)',
            }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.05em' }}>
                    에피소드 목록 ({allEps.length}/10)
                </span>
                <button
                    onClick={onClose}
                    style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                    title="사이드바 닫기"
                >✕</button>
            </div>

            {/* 에피소드 목록 (유형별 그룹) */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {SIDEBAR_EP_GROUPS.map(group => {
                    const groupEps = allEps.filter(ep =>
                        ep.episode?.contentType && group.types.includes(ep.episode.contentType)
                    )
                    if (groupEps.length === 0) return null
                    return (
                        <div key={group.id}>
                            {renderGroupHeader(group.id, group.label, groupEps.length)}
                            {!collapsed[group.id] && groupEps.map(renderItem)}
                        </div>
                    )
                })}

                {/* 기타: contentType 없는 레거시 에피소드 */}
                {(() => {
                    const otherEps = allEps.filter(ep =>
                        !ep.episode?.contentType || !knownTypes.includes(ep.episode.contentType)
                    )
                    if (otherEps.length === 0) return null
                    return (
                        <div>
                            {renderGroupHeader('other', '📁 기타', otherEps.length)}
                            {!collapsed['other'] && otherEps.map(renderItem)}
                        </div>
                    )
                })()}
            </div>

            {/* 하단 추가 버튼 / 생성 폼 */}
            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                {!addOpen ? (
                    <button
                        onClick={openAddForm}
                        style={{
                            width: '100%', padding: '7px', borderRadius: 6,
                            background: 'transparent', border: '1px dashed var(--border2)',
                            color: 'var(--text3)', fontSize: 11, cursor: 'pointer',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--purple)'; e.currentTarget.style.borderColor = 'var(--purple)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border2)' }}
                    >+ 새 에피소드 추가</button>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <select
                            value={newType}
                            onChange={e => { setNewType(e.target.value); setAddError('') }}
                            style={{
                                width: '100%', padding: '6px 8px', borderRadius: 6,
                                background: 'var(--bg2)', border: '1px solid var(--border2)',
                                color: 'var(--text)', fontSize: 11,
                            }}
                        >
                            {CONTENT_TYPE_OPTIONS.map(o => (
                                // 일부 브라우저는 <select>의 배경/글자색을 팝업 목록에 상속하지 않고
                                // OS 기본값(밝은 배경)으로 렌더링해서, 옵션 자체에도 명시적으로
                                // 색을 지정해야 다크 테마에서 글자가 안 보이는 문제가 안 생긴다.
                                <option key={o.value} value={o.value} style={{ background: '#1a1a24', color: '#f0eeff' }}>{o.label}</option>
                            ))}
                        </select>
                        <input
                            value={newSlug}
                            onChange={e => { setNewSlug(e.target.value); setAddError('') }}
                            placeholder="슬러그 (선택, 예: SHOE)"
                            style={{
                                width: '100%', padding: '6px 8px', borderRadius: 6,
                                background: 'var(--bg2)', border: '1px solid var(--border2)',
                                color: 'var(--text)', fontSize: 11, boxSizing: 'border-box',
                            }}
                        />
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                            코드: <b style={{ color: 'var(--purple)' }}>{previewCode}</b>
                        </div>
                        {addError && (
                            <div style={{ fontSize: 11, color: '#ef4444' }}>⚠️ {addError}</div>
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button
                                onClick={confirmAdd}
                                style={{
                                    flex: 1, padding: '6px', borderRadius: 6,
                                    background: 'var(--purple)', border: 'none',
                                    color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                                }}
                            >생성</button>
                            <button
                                onClick={cancelAdd}
                                style={{
                                    flex: 1, padding: '6px', borderRadius: 6,
                                    background: 'transparent', border: '1px solid var(--border2)',
                                    color: 'var(--text3)', fontSize: 11, cursor: 'pointer',
                                }}
                            >취소</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ── 에피소드 탭 바 (활성 에피소드 제목 1개 + 목록 버튼) ──────────────
function EpisodeBar({ onOpenSidebar }) {
    const { state } = useApp()
    const { episodes, activeEpisodeId } = state

    const activeEp = episodes[activeEpisodeId]
    const title = activeEp?.episode.title || `EP${activeEp?.episode.number ?? ''} 새 에피소드`

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0 8px 0 14px', background: 'var(--bg2)',
            borderBottom: '1px solid var(--border)',
            overflowX: 'auto', flexShrink: 0, minHeight: 40,
        }}>
            <span style={{
                fontSize: 16, fontWeight: 700, color: 'var(--text)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{title}</span>

            <button
                onClick={onOpenSidebar}
                style={{
                    padding: '3px 10px', borderRadius: 6, flexShrink: 0,
                    background: 'transparent', border: '1px dashed var(--border2)',
                    color: 'var(--text3)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--purple)'; e.currentTarget.style.borderColor = 'var(--purple)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border2)' }}
                title="에피소드 목록 열기"
            >+ 에피소드 목록</button>
        </div>
    )
}

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
                    <EpisodeBar onOpenSidebar={() => setShowSidebar(true)} />
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
