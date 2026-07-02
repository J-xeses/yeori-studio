import { useState } from 'react'
import { useApp } from '../context/AppContext'
import s from './DashboardTab.module.css'

const CYCLE = [
  { step: 1, label: '대본 생성', icon: '📝', tab: 'script' },
  { step: 2, label: '이미지 프롬프트', icon: '🎬', tab: 'studio' },
  { step: 3, label: 'TTS 음성', icon: '🔊', tab: 'tts' },
  { step: 4, label: '내 음성 삽입', icon: '🎙️', tab: 'voice' },
  { step: 5, label: '자막/영상 편집', icon: '🎞️', tab: 'video' },
  { step: 6, label: '썸네일 제작', icon: '🖼️', tab: 'thumbnail' },
  { step: 7, label: '업로드', icon: '🚀', tab: null },
]

function CreditBar({ label, used, total, color }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className={s.credit}>
      <div className={s.creditTop}>
        <span className={s.creditLabel}>{label}</span>
        <span className={s.creditVal} style={{ color }}>{(total - used).toLocaleString()} <span className={s.creditUnit}>남음</span></span>
      </div>
      <div className={s.creditBar}>
        <div className={s.creditFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className={s.creditMeta}>{used.toLocaleString()} 사용 / {total.toLocaleString()} 전체</div>
    </div>
  )
}

export default function DashboardTab() {
  const { state, dispatch } = useApp()
  const { dashboard, cuts, episode, apiKeys } = state
  const [spent, setSpent] = useState(dashboard.spent || 0)

  const go = (tab) => { if (tab) dispatch({ type: 'SET_TAB', p: tab }) }

  const cutsTotal = cuts.length
  const cutsWithDialogue = cuts.filter(c => c.dialogue || c.narration).length
  const cutsWithPrompt = cuts.filter(c => c.imagePrompt).length
  const progress = cutsTotal > 0 ? Math.round(((cutsWithDialogue + cutsWithPrompt) / (cutsTotal * 2)) * 100) : 0

  const apiStatus = [
    { name: 'Claude', connected: !!apiKeys.claude, color: '#a78bfa' },
    { name: 'ElevenLabs', connected: state.elevenLabsStatus.connected, color: '#22c55e' },
    { name: 'Gemini', connected: !!apiKeys.gemini, color: '#3b82f6' },
    { name: 'Vertex AI', connected: state.vertexAI, color: '#f97316' },
  ]

  return (
    <div className={s.root}>
      <div className={s.topRow}>
        {/* Episode progress */}
        <div className={s.card} style={{ flex: 2 }}>
          <div className={s.cardTitle}>에피소드 {episode.number} 진행률</div>
          <div className={s.epInfo}>{episode.title || '제목 없음'} · {episode.location} · {episode.mood}</div>
          <div className={s.bigProgress}>
            <div className={s.bigBar}><div className={s.bigFill} style={{ width: `${progress}%` }} /></div>
            <span className={s.bigPct}>{progress}%</span>
          </div>
          <div className={s.epStats}>
            <div className={s.epStat}><span>{cutsTotal}</span><span>총 컷</span></div>
            <div className={s.epStat}><span className={s.green}>{cutsWithDialogue}</span><span>대사 완료</span></div>
            <div className={s.epStat}><span className={s.purple}>{cutsWithPrompt}</span><span>프롬프트</span></div>
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

      <div className={s.midRow}>
        {/* Credits */}
        <div className={s.card} style={{ flex: 1.5 }}>
          <div className={s.cardTitle}>플랫폼 크레딧 현황</div>
          <div className={s.credits}>
            <CreditBar label="Flow (이미지)" used={200 - dashboard.flowCredits} total={200} color="#a78bfa" />
            <CreditBar label="Kling (영상)" used={100 - dashboard.klingCredits} total={100} color="#3b82f6" />
            <CreditBar label="ElevenLabs (TTS)" used={50000 - dashboard.elevenlabsChars} total={50000} color="#22c55e" />
          </div>
          <div className={s.creditEdit}>
            {[
              { key: 'flowCredits', label: 'Flow 잔여' },
              { key: 'klingCredits', label: 'Kling 잔여' },
              { key: 'elevenlabsChars', label: 'EL 잔여 글자' },
            ].map(({ key, label }) => (
              <div key={key} className={s.editRow}>
                <span>{label}</span>
                <input type="number" value={dashboard[key]}
                  onChange={e => dispatch({ type: 'SET_DASH', p: { [key]: parseInt(e.target.value) || 0 } })} />
              </div>
            ))}
          </div>
        </div>

        {/* Monthly cost */}
        <div className={s.card}>
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
  )
}
