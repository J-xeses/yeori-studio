import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { loadGPoints } from '../lib/gpoints'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './CreditsTab.module.css'

const FLOW_VIDEO_MODELS = [
  { key: 'veo_lite_8s', label: 'Veo 3.1 lite (8s)', cost: 10 },
  { key: 'veo_fast_8s', label: 'Veo 3.1 fast (8s)', cost: 20 },
  { key: 'omni_6s',     label: 'Omni Flash (6s)',   cost: 10 },
  { key: 'omni_8s',     label: 'Omni Flash (8s)',   cost: 12 },
  { key: 'omni_10s',    label: 'Omni Flash (10s)',  cost: 15 },
]

const PLAN_ACCOUNTS = [
  { key: 'main', label: '메인' },
  { key: 'sub',  label: '부' },
]

function CreditBar({ label, remaining, total, color }) {
  const used = total - remaining
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className={s.credit}>
      <div className={s.creditTop}>
        <span className={s.creditLabel}>{label}</span>
        <span className={s.creditVal} style={{ color }}>{remaining.toLocaleString()} <span className={s.creditUnit}>/ {total.toLocaleString()} 남음</span></span>
      </div>
      <div className={s.creditBar}>
        <div className={s.creditFill} style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function CreditsTab() {
  const { state, dispatch } = useApp()
  const { creditTracker, cuts } = state
  const [gData, setGData] = useState(() => loadGPoints())
  const [planRows, setPlanRows] = useState([])
  const [checking, setChecking] = useState({ main: false, sub: false })
  const [checkMsg, setCheckMsg] = useState({ main: null, sub: null })

  useEffect(() => {
    const id = setInterval(() => setGData(loadGPoints()), 2000)
    return () => clearInterval(id)
  }, [])

  const setTool = (account, tool, field, value) => {
    dispatch({ type: 'SET_CREDIT_TOOL', p: { account, tool, patch: { [field]: value } } })
  }

  const resetDaily = () => dispatch({ type: 'RESET_CREDITS_DAILY' })

  const checkFlowCredits = async (account) => {
    setChecking(prev => ({ ...prev, [account]: true }))
    setCheckMsg(prev => ({ ...prev, [account]: null }))
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 50000) // 서버 타임아웃(45s)보다 여유있게
      const res = await fetch('http://localhost:3001/api/check-flow-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: account }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      if (data.ok && data.remaining != null) {
        setTool(account, 'flow', 'remaining', data.remaining)
        setCheckMsg(prev => ({ ...prev, [account]: `✅ ${data.remaining} 확인됨 (${new Date(data.checkedAt).toLocaleTimeString('ko-KR')})` }))
      } else {
        setCheckMsg(prev => ({ ...prev, [account]: `❌ ${data.error || '확인 실패'}` }))
      }
    } catch (e) {
      const msg = e.name === 'AbortError' ? '50초 넘게 응답이 없어 중단했습니다' : `서버 연결 실패: ${e.message} (전용 Chrome이 떠 있는지 확인)`
      setCheckMsg(prev => ({ ...prev, [account]: `❌ ${msg}` }))
    } finally {
      setChecking(prev => ({ ...prev, [account]: false }))
    }
  }

  const flowMainCuts = Math.floor(creditTracker.main.flow.remaining / creditTracker.main.flow.costPerCut)
  const flowSubCuts  = Math.floor(creditTracker.sub.flow.remaining / creditTracker.sub.flow.costPerCut)

  // 사이드바 컷 목록 기준: G2(이미지) 승인 안 된 컷 = 아직 시그/별도 컷으로 보완할 여지가 있는 컷
  const pendingCutNos = (cuts || []).filter(c => !gData[`cut_${c.no}`]?.g2).map(c => c.no)

  const addPlanRow = () => {
    const usedLabels = new Set(planRows.map(r => r.label))
    const nextPending = pendingCutNos.find(no => !usedLabels.has(`C${String(no).padStart(2, '0')}`))
    const label = nextPending != null
      ? `C${String(nextPending).padStart(2, '0')}`
      : `C${String(planRows.length + 1).padStart(2, '0')}`
    setPlanRows([...planRows, { id: Date.now(), label, account: 'main', modelKey: FLOW_VIDEO_MODELS[0].key }])
  }
  const updatePlanRow = (id, field, value) => {
    setPlanRows(planRows.map(r => r.id === id ? { ...r, [field]: value } : r))
  }
  const removePlanRow = (id) => setPlanRows(planRows.filter(r => r.id !== id))

  const planTotals = PLAN_ACCOUNTS.map(acc => {
    const used = planRows
      .filter(r => r.account === acc.key)
      .reduce((sum, r) => sum + (FLOW_VIDEO_MODELS.find(m => m.key === r.modelKey)?.cost || 0), 0)
    const remaining = creditTracker[acc.key].flow.remaining
    return { ...acc, used, remaining, left: remaining - used }
  })

  return (
    <div className={s.page}>
      <TabToolbar
        actions={[
          { key: 'reset', variant: 'green', label: '🔄 오늘자 리셋 (전부 최대치로)', onClick: resetDaily },
        ]}
      />
      <div className={s.root}>
        <EpisodeInfoSidebar />
        <div className={s.main}>
        <div className={s.scrollBody}>
        <div className={s.content}>

      <div className={s.header}>
        <div>
          <div className={s.title}>일일 무료 크레딧 모니터링</div>
          <div className={s.subtitle}>
            Flow는 "자동 확인" 버튼으로 크레딧을 읽어올 수 있습니다(전용 Chrome 프로필이 떠 있어야 함). Qwen/PixVerse는 아직 직접 입력만 지원합니다.
            {creditTracker.lastCheckedAt && (
              <> 마지막 리셋: {new Date(creditTracker.lastCheckedAt).toLocaleString('ko-KR')}</>
            )}
          </div>
        </div>
      </div>

      <div className={s.accountRow}>
        {/* 메인 계정: Flow + Qwen */}
        <div className={s.card}>
          <div className={s.cardTitle}>메인 계정 — Flow + Qwen</div>

          <CreditBar label="Flow (Omni 8s 기준)" remaining={creditTracker.main.flow.remaining} total={creditTracker.main.flow.dailyTotal} color="#a78bfa" />
          <div className={s.editRow}>
            <span>Flow 잔여 크레딧</span>
            <div className={s.checkRow}>
              <input type="number" value={creditTracker.main.flow.remaining}
                onChange={e => setTool('main', 'flow', 'remaining', parseInt(e.target.value) || 0)} />
              <button className={s.checkBtn} onClick={() => checkFlowCredits('main')} disabled={checking.main}>
                {checking.main ? '⏳' : '🔄 자동 확인'}
              </button>
            </div>
          </div>
          {checkMsg.main && <div className={s.estimate}>{checkMsg.main}</div>}
          <div className={s.estimate}>Omni 8s(12크레딧) 기준 약 {flowMainCuts}컷 더 가능</div>

          <div className={s.divider} />

          <div className={s.creditTop}>
            <span className={s.creditLabel}>Qwen 오늘 생성 컷</span>
            <span className={s.creditVal} style={{ color: '#22c55e' }}>
              {creditTracker.main.qwen.countToday} <span className={s.creditUnit}>/ 목표 {creditTracker.main.qwen.targetMin}~{creditTracker.main.qwen.targetMax}</span>
            </span>
          </div>
          <div className={s.editRow}>
            <span>Qwen 생성 횟수</span>
            <div className={s.counterBtns}>
              <button onClick={() => setTool('main', 'qwen', 'countToday', Math.max(0, creditTracker.main.qwen.countToday - 1))}>-</button>
              <input type="number" value={creditTracker.main.qwen.countToday}
                onChange={e => setTool('main', 'qwen', 'countToday', parseInt(e.target.value) || 0)} />
              <button onClick={() => setTool('main', 'qwen', 'countToday', creditTracker.main.qwen.countToday + 1)}>+</button>
            </div>
          </div>
          <div className={s.estimate}>공식 하드리밋 없음(1080p 5s 기준 소프트 제한) — 매일 컷 수만 기록</div>
        </div>

        {/* 서브 계정: Flow + PixVerse */}
        <div className={s.card}>
          <div className={s.cardTitle}>서브 계정 — Flow + PixVerse</div>

          <CreditBar label="Flow (Omni 8s 기준)" remaining={creditTracker.sub.flow.remaining} total={creditTracker.sub.flow.dailyTotal} color="#a78bfa" />
          <div className={s.editRow}>
            <span>Flow 잔여 크레딧</span>
            <div className={s.checkRow}>
              <input type="number" value={creditTracker.sub.flow.remaining}
                onChange={e => setTool('sub', 'flow', 'remaining', parseInt(e.target.value) || 0)} />
              <button className={s.checkBtn} onClick={() => checkFlowCredits('sub')} disabled={checking.sub}>
                {checking.sub ? '⏳' : '🔄 자동 확인'}
              </button>
            </div>
          </div>
          {checkMsg.sub && <div className={s.estimate}>{checkMsg.sub}</div>}
          <div className={s.estimate}>Omni 8s(12크레딧) 기준 약 {flowSubCuts}컷 더 가능</div>

          <div className={s.divider} />

          <CreditBar label="PixVerse" remaining={creditTracker.sub.pixverse.remaining} total={creditTracker.sub.pixverse.dailyTotal} color="#3b82f6" />
          <div className={s.editRow}>
            <span>PixVerse 잔여 크레딧</span>
            <input type="number" value={creditTracker.sub.pixverse.remaining}
              onChange={e => setTool('sub', 'pixverse', 'remaining', parseInt(e.target.value) || 0)} />
          </div>
          <div className={s.estimate}>설정(해상도/오디오)에 따라 소모가 달라 고정 컷수는 계산하지 않음 — 여유분으로만 참고</div>
        </div>
      </div>

      {/* 크레딧 사용 계획 시뮬레이션 — 컷별 Flow 모델 배정 */}
      <div className={s.card}>
        <div className={s.cardTitle}>컷별 모델 배정 시뮬레이션 (Flow)</div>
        <div className={s.simNote}>
          컷마다 계정과 영상 모델을 골라보면서 오늘 크레딧으로 감당되는지 확인하세요.
          "+ 컷 추가" 시 사이드바 컷 목록에서 G2 미승인인 컷 번호를 자동으로 채워줍니다.
        </div>

        <table className={s.planTable}>
          <thead>
            <tr><th>컷</th><th>계정</th><th>모델</th><th>크레딧</th><th /></tr>
          </thead>
          <tbody>
            {planRows.map(row => {
              const model = FLOW_VIDEO_MODELS.find(m => m.key === row.modelKey)
              return (
                <tr key={row.id}>
                  <td><input value={row.label} onChange={e => updatePlanRow(row.id, 'label', e.target.value)} /></td>
                  <td>
                    <select value={row.account} onChange={e => updatePlanRow(row.id, 'account', e.target.value)}>
                      {PLAN_ACCOUNTS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={row.modelKey} onChange={e => updatePlanRow(row.id, 'modelKey', e.target.value)}>
                      {FLOW_VIDEO_MODELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </td>
                  <td className={s.planCost}>{model?.cost}</td>
                  <td><button className={s.planRemoveBtn} onClick={() => removePlanRow(row.id)}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <button className={s.addRowBtn} onClick={addPlanRow}>+ 컷 추가</button>

        <div className={s.planSummary}>
          {planTotals.map(t => (
            <div key={t.key} className={`${s.planSummaryRow} ${t.left < 0 ? s.over : ''}`}>
              <span>{t.label} 계정 누적</span>
              <span>{t.used} / {t.remaining} (잔여 {t.left})</span>
            </div>
          ))}
        </div>
      </div>

      <div className={s.estimate}>
        참고: Flow 잔여 크레딧 기준 대략치 — 메인 Omni8s 환산 약 {flowMainCuts}컷 / 서브 약 {flowSubCuts}컷 더 가능(단일 모델 가정).
      </div>

      <div className={s.note}>
        시그 컷·별도 활용 컷 생성용 보조 도구 모니터링입니다. 본편 컷 생산은 기존 스튜디오/영상 탭 파이프라인을 그대로 사용합니다.
      </div>

        </div>
        </div>
        </div>
      </div>
    </div>
  )
}
