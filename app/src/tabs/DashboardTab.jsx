import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { getGPointSummary } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './DashboardTab.module.css'

const CYCLE = [
  { step: 1, label: '대본 생성', icon: '📝', tab: 'script' },
  { step: 2, label: '이미지 프롬프트', icon: '🎬', tab: 'studio' },
  { step: 3, label: 'TTS 음성', icon: '🔊', tab: 'tts' },
  { step: 4, label: '내 음성 삽입', icon: '🎙️', tab: 'voice' },
  { step: 5, label: '자막/영상 편집', icon: '🎞️', tab: 'video' },
  { step: 6, label: '퍼블리싱', icon: '🚀', tab: 'publishing' },
]

const G_STEPS = [
  { key: 'g1', label: 'G1 대본', color: '#a78bfa' },
  { key: 'g2', label: 'G2 이미지', color: '#3b82f6' },
  { key: 'g3', label: 'G3 음성', color: '#22c55e' },
  { key: 'g4', label: 'G4 영상', color: '#f97316' },
  { key: 'g5', label: 'G5 편집', color: '#eab308' },
]

function GStepBar({ label, count, total, color }) {
  const pct = total > 0 ? Math.min(100, (count / total) * 100) : 0
  return (
    <div className={s.credit}>
      <div className={s.creditTop}>
        <span className={s.creditLabel}>{label}</span>
        <span className={s.creditVal} style={{ color }}>{count} <span className={s.creditUnit}>/ {total}</span></span>
      </div>
      <div className={s.creditBar}>
        <div className={s.creditFill} style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

const CUT_TYPE_COLOR = { GRAPHIC: '#a78bfa', BROLL: '#22c55e', CAPCUT: '#f97316' }

export default function DashboardTab() {
  const { state, dispatch } = useApp()
  const { dashboard, cuts, episode, apiKeys } = state
  const [spent, setSpent] = useState(dashboard.spent || 0)

  // 메이킹(GRAPHIC/BROLL/CAPCUT) 컷 제작 현황 — 5초마다 갱신
  const [making, setMaking] = useState(null)
  useEffect(() => {
    if (!episode?.number) { setMaking(null); return }
    let alive = true
    const load = () => {
      fetch(`http://localhost:3001/api/episode-making-status?epNum=${episode.number}`)
        .then(r => r.json())
        .then(d => { if (alive && !d.error) setMaking(d) })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 5000)
    return () => { alive = false; clearInterval(id) }
  }, [episode?.number])

  const go = (tab) => { if (tab) dispatch({ type: 'SET_TAB', p: tab }) }

  const cutsTotal = cuts.length
  const epCode = resolveEpisodeCode(episode)
  const gSummary = getGPointSummary(epCode, cutsTotal)
  const gAvg = cutsTotal > 0
    ? G_STEPS.reduce((sum, g) => sum + gSummary[g.key], 0) / (G_STEPS.length * cutsTotal) * 100
    : 0
  const progress = Math.round(gAvg)

  const apiStatus = [
    { name: 'Claude', connected: !!apiKeys.claude, color: '#a78bfa' },
    { name: 'ElevenLabs', connected: state.elevenLabsStatus.connected, color: '#22c55e' },
    { name: 'Gemini', connected: !!apiKeys.gemini, color: '#3b82f6' },
    { name: 'Vertex AI', connected: state.vertexAI, color: '#f97316' },
  ]

  return (
    <div className={s.page}>
      <TabToolbar />
      <div className={s.root}>
        <EpisodeInfoSidebar maxStage={0} />
        <div className={s.main}>
        <div className={s.scrollBody}>
        <div className={s.content}>
      <div className={s.topRow}>
        {/* Episode progress */}
        <div className={s.card} style={{ flex: 2 }}>
          <div className={s.cardTitle}>에피소드 {episode.number} 진행률</div>
          <div className={s.epInfo}>{episode.title || '제목 없음'} · {episode.location} · {episode.mood} · 총 {cutsTotal}컷</div>
          <div className={s.bigProgress}>
            <div className={s.bigBar}><div className={s.bigFill} style={{ width: `${progress}%` }} /></div>
            <span className={s.bigPct}>{progress}%</span>
          </div>
          <div className={s.credits}>
            {G_STEPS.map(g => (
              <GStepBar key={g.key} label={g.label} count={gSummary[g.key]} total={cutsTotal} color={g.color} />
            ))}
          </div>
        </div>

        {/* API Status */}
        <div className={s.card}>
          <div className={s.cardTitle}>API 연결 상태</div>
          <div className={s.apiList}>
            {apiStatus.map(a => (
              <div key={a.name} className={s.apiItem}>
                <span className={s.apiDot} style={{ background: a.connected ? a.color : '#374151', boxShadow: a.connected ? `0 0 6px ${a.color}` : 'none' }} />
                <span className={s.apiName}>{a.name}</span>
                <span className={s.apiStatus} style={{ color: a.connected ? a.color : 'var(--text-3)' }}>
                  {a.connected ? '연결됨' : '미연결'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Making cut progress */}
      {making && making.total > 0 && (
        <div className={s.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div className={s.cardTitle}>메이킹 컷 (그래픽·B롤·캡컷)</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              완료 <b style={{ color: 'var(--green)' }}>{making.done}</b> / {making.total}
              {making.overlay > 0 && <span> · 손글씨 {making.overlay}</span>}
              {making.dirty > 0 && <span style={{ color: 'var(--yellow)' }}> · 재조립 필요 {making.dirty}</span>}
            </div>
          </div>
          <div className={s.creditBar}>
            <div className={s.creditFill}
              style={{ width: `${(making.done / making.total) * 100}%`, background: 'var(--green)' }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {making.cuts.map(c => {
              const col = CUT_TYPE_COLOR[(c.cutType || '').toUpperCase()] || 'var(--text-3)'
              return (
                <div key={c.no} title={[
                  `CUT ${c.no} · ${c.cutType}`,
                  c.hasVideo ? '제작 완료' : '미제작',
                  c.method && `방식: ${c.method}`,
                  c.motion && c.motion !== 'none' && `모션: ${c.motion}`,
                  c.overlay && '손글씨 적용',
                  c.dirtyVsAssemble && '조립본보다 최신 — 재조립 필요',
                ].filter(Boolean).join('\n')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 11.5, padding: '3px 8px', borderRadius: 6,
                    border: `1px solid ${c.hasVideo ? col : 'var(--border)'}`,
                    background: c.hasVideo ? `${col}1a` : 'var(--bg-input)',
                    color: c.hasVideo ? 'var(--text)' : 'var(--text-3)',
                    opacity: c.hasVideo ? 1 : 0.6,
                  }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  {c.no}
                  {c.overlay && <span title="손글씨">✍</span>}
                  {c.dirtyVsAssemble && <span style={{ color: 'var(--yellow)' }} title="재조립 필요">↻</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className={s.midRow}>
        {/* Monthly cost */}
        <div className={s.card} style={{ flex: 1 }}>
          <div className={s.cardTitle}>이번 달 비용</div>
          <div className={s.costBig}>
            <span className={s.costNum}>₩{spent.toLocaleString()}</span>
            <span className={s.costLabel}>/ ₩{dashboard.monthBudget.toLocaleString()} 예산</span>
          </div>
          <div className={s.costBar}>
            <div className={s.costFill} style={{ width: `${Math.min(100, (spent / dashboard.monthBudget) * 100)}%` }} />
          </div>
          <div className={s.costInputs}>
            <div className={s.editRow}>
              <span>지출 (원)</span>
              <input type="number" value={spent} onChange={e => { const v = parseInt(e.target.value) || 0; setSpent(v); dispatch({ type: 'SET_DASH', p: { spent: v } }) }} />
            </div>
            <div className={s.editRow}>
              <span>예산 (원)</span>
              <input type="number" value={dashboard.monthBudget}
                onChange={e => dispatch({ type: 'SET_DASH', p: { monthBudget: parseInt(e.target.value) || 0 } })} />
            </div>
          </div>
        </div>
      </div>

      {/* Weekly cycle */}
      <div className={s.card}>
        <div className={s.cardTitle}>주간 제작 사이클</div>
        <div className={s.cycle}>
          {CYCLE.map((item, i) => (
            <div key={item.step} className={s.cycleItem} onClick={() => go(item.tab)}>
              <div className={`${s.cycleIcon} ${item.tab ? s.clickable : s.done}`}>{item.icon}</div>
              <div className={s.cycleLabel}>{item.label}</div>
              {i < CYCLE.length - 1 && <div className={s.cycleArrow}>→</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className={s.card}>
        <div className={s.cardTitle}>빠른 실행</div>
        <div className={s.quickBtns}>
          {CYCLE.filter(c => c.tab).map(c => (
            <button key={c.tab} className={s.quickBtn} onClick={() => go(c.tab)}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>
        </div>
        </div>
        </div>
      </div>
    </div>
  )
}
