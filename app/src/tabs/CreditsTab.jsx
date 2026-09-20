import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { loadGPoints } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
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

// 유료 영상 API 후보 — 초당 USD 단가(2026-09-20 기준). Veo는 Gemini API 공식 가격표(오디오 포함),
// Kling은 서드파티 글의 추정치라 실제 결제 전에 공식 가격을 다시 확인할 것. 단가가 바뀌면 여기만 고친다.
const PAID_VIDEO_MODELS = [
  { key: 'veo_fast_720',  label: 'Veo 3.1 Fast 720p (공식 $0.10/초)',  usdPerSec: 0.10 },
  { key: 'veo_fast_1080', label: 'Veo 3.1 Fast 1080p (공식 $0.12/초)', usdPerSec: 0.12 },
  { key: 'veo_lite_720',  label: 'Veo 3.1 Lite 720p (공식 $0.05/초)',  usdPerSec: 0.05 },
  { key: 'veo_lite_1080', label: 'Veo 3.1 Lite 1080p (공식 $0.08/초)', usdPerSec: 0.08 },
  { key: 'veo_std',       label: 'Veo 3.1 Standard (공식 $0.40/초)',   usdPerSec: 0.40 },
  { key: 'kling_est',     label: 'Kling 3.0 (추정 $0.10/초)',           usdPerSec: 0.10 },
]

const PLAN_ACCOUNTS = [
  { key: 'main', label: '메인' },
  { key: 'sub',  label: '부' },
]
// 표에서 고를 수 있는 배정처: 무료 계정 2개 + 유료 API + 오늘은 미룸(내일 무료 크레딧으로)
const PLAN_TARGETS = [
  ...PLAN_ACCOUNTS,
  { key: 'paid',  label: '유료 API' },
  { key: 'defer', label: '내일로 미룸' },
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
  const { creditTracker, cuts, episode } = state
  const epCode = resolveEpisodeCode(episode)
  const [gData, setGData] = useState(() => loadGPoints())
  const [planRows, setPlanRows] = useState([])
  const [checking, setChecking] = useState({})
  const [checkMsg, setCheckMsg] = useState({})

  // 유료 API 장부(서버) — 이번 달 사용 요약. 대시보드 "이번 달 비용"과 같은 데이터.
  const [paid, setPaid] = useState(null)
  const [rateInput, setRateInput] = useState('')
  const [recForm, setRecForm] = useState({ provider: '', seconds: '', usd: '', note: '' })
  const [recMsg, setRecMsg] = useState('')
  const [overflow, setOverflow] = useState('defer') // 오늘 무료로 못 만드는 클립: defer(내일로) | paid(유료로)
  const loadPaid = () => fetch('http://localhost:3001/api/paid-usage/summary').then(r => r.json()).then(d => { if (d.ok) setPaid(d) }).catch(() => {})
  useEffect(() => { loadPaid(); const id = setInterval(loadPaid, 10000); return () => clearInterval(id) }, [])

  useEffect(() => {
    const id = setInterval(() => setGData(loadGPoints()), 2000)
    return () => clearInterval(id)
  }, [])

  const setTool = (account, tool, field, value) => {
    dispatch({ type: 'SET_CREDIT_TOOL', p: { account, tool, patch: { [field]: value } } })
  }

  const resetDaily = () => dispatch({ type: 'RESET_CREDITS_DAILY' })

  const checkToolCredits = async (toolName, account) => {
    const key = `${toolName}:${account}`
    setChecking(prev => ({ ...prev, [key]: true }))
    setCheckMsg(prev => ({ ...prev, [key]: null }))
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 50000) // 서버 타임아웃(45s)보다 여유있게
      const res = await fetch('http://localhost:3001/api/check-tool-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName, profile: account }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      if (data.ok && data.remaining != null) {
        setTool(account, toolName, 'remaining', data.remaining)
        setCheckMsg(prev => ({ ...prev, [key]: `✅ ${data.remaining} 확인됨 (${new Date(data.checkedAt).toLocaleTimeString('ko-KR')})` }))
      } else {
        setCheckMsg(prev => ({ ...prev, [key]: `❌ ${data.error || '확인 실패'}` }))
      }
    } catch (e) {
      const msg = e.name === 'AbortError' ? '50초 넘게 응답이 없어 중단했습니다' : `서버 연결 실패: ${e.message} (전용 Chrome이 떠 있는지 확인)`
      setCheckMsg(prev => ({ ...prev, [key]: `❌ ${msg}` }))
    } finally {
      setChecking(prev => ({ ...prev, [key]: false }))
    }
  }

  const flowMainCuts = Math.floor(creditTracker.main.flow.remaining / creditTracker.main.flow.costPerCut)
  const flowSubCuts  = Math.floor(creditTracker.sub.flow.remaining / creditTracker.sub.flow.costPerCut)

  // 사이드바 컷 목록 기준: G2(이미지) 승인 안 된 컷 = 아직 시그/별도 컷으로 보완할 여지가 있는 컷
  const pendingCutNos = (cuts || []).filter(c => !gData[epCode]?.[`cut_${c.no}`]?.g2).map(c => c.no)

  const addPlanRow = () => {
    const usedLabels = new Set(planRows.map(r => r.label))
    const nextPending = pendingCutNos.find(no => !usedLabels.has(`C${String(no).padStart(2, '0')}`))
    const label = nextPending != null
      ? `C${String(nextPending).padStart(2, '0')}`
      : `C${String(planRows.length + 1).padStart(2, '0')}`
    setPlanRows([...planRows, { id: Date.now(), label, account: 'main', modelKey: FLOW_VIDEO_MODELS[0].key, seconds: 8 }])
  }
  const updatePlanRow = (id, field, value) => {
    setPlanRows(planRows.map(r => {
      if (r.id !== id) return r
      const next = { ...r, [field]: value }
      // 배정처를 바꾸면 그 배정처에서 유효한 모델로 맞춘다(무료↔유료 모델 목록이 다름)
      if (field === 'account') {
        if (value === 'paid' && !PAID_VIDEO_MODELS.some(m => m.key === next.modelKey)) next.modelKey = PAID_VIDEO_MODELS[0].key
        if ((value === 'main' || value === 'sub') && !FLOW_VIDEO_MODELS.some(m => m.key === next.modelKey)) next.modelKey = FLOW_VIDEO_MODELS[0].key
      }
      return next
    }))
  }
  const removePlanRow = (id) => setPlanRows(planRows.filter(r => r.id !== id))

  // 한 행의 비용: 무료 계정은 크레딧, 유료는 USD(초 × 초당 단가). 미룸은 0.
  const rowFreeCredits = (r) => (r.account === 'main' || r.account === 'sub') ? (FLOW_VIDEO_MODELS.find(m => m.key === r.modelKey)?.cost || 0) : 0
  const rowPaidUsd = (r) => r.account === 'paid' ? (PAID_VIDEO_MODELS.find(m => m.key === r.modelKey)?.usdPerSec || 0) * (Number(r.seconds) || 0) : 0

  const planTotals = PLAN_ACCOUNTS.map(acc => {
    const used = planRows.filter(r => r.account === acc.key).reduce((sum, r) => sum + rowFreeCredits(r), 0)
    const remaining = creditTracker[acc.key].flow.remaining
    return { ...acc, used, remaining, left: remaining - used }
  })
  const usdKrw = paid?.usdKrw || 1400
  const planPaidUsd = planRows.reduce((sum, r) => sum + rowPaidUsd(r), 0)
  const planPaidKrw = Math.round(planPaidUsd * usdKrw)
  const planDeferred = planRows.filter(r => r.account === 'defer')
  const dailyFreeTotal = (creditTracker.main.flow.dailyTotal || 0) + (creditTracker.sub.flow.dailyTotal || 0)

  // 무료 우선 자동 배정 — 이 에피소드에서 G4(영상) 미승인인 YEORI 컷을 클립 단위(대본 SEG 조합, 없으면
  // 길이로 8/10초 분할)로 풀어서 메인 → 부 무료 크레딧 순으로 채우고, 남는 클립은 overflow 설정에 따라
  // 유료 API 또는 "내일로 미룸"으로 둔다. 표는 저장되지 않는 시뮬레이션이라 언제든 다시 돌려도 된다.
  const autoAssign = () => {
    if (planRows.length > 0 && !window.confirm('현재 표를 지우고 자동 배정으로 다시 채울까요?')) return
    const clips = []
    for (const c of (cuts || [])) {
      if (c.cutType !== 'YEORI') continue
      if (gData[epCode]?.[`cut_${c.no}`]?.g4) continue
      let segs = Array.isArray(c.segments) && c.segments.length ? c.segments : null
      if (!segs) {
        const d = Number(c.duration) || 8
        segs = d <= 8 ? [8] : d <= 10 ? [10] : Array.from({ length: Math.ceil(d / 10) }, () => 10)
      }
      // 영상 탭에서 이미 클립이 배정된 슬롯은 만들 필요가 없으니 계획에서 뺀다
      const filled = state.videoTabState?.videoClips?.[c.id] || []
      segs.forEach((len, i) => { if (!filled[i]) clips.push({ no: c.no, idx: i + 1, len: len >= 10 ? 10 : 8 }) })
    }
    let left = { main: creditTracker.main.flow.remaining, sub: creditTracker.sub.flow.remaining }
    const paidModel = PAID_VIDEO_MODELS[0]
    const rows = clips.map((cl, k) => {
      const model = cl.len >= 10 ? FLOW_VIDEO_MODELS.find(m => m.key === 'omni_10s') : FLOW_VIDEO_MODELS.find(m => m.key === 'omni_8s')
      const label = `C${String(cl.no).padStart(2, '0')}-${cl.idx}`
      const base = { id: Date.now() + k, label, seconds: cl.len }
      if (left.main >= model.cost) { left.main -= model.cost; return { ...base, account: 'main', modelKey: model.key } }
      if (left.sub >= model.cost) { left.sub -= model.cost; return { ...base, account: 'sub', modelKey: model.key } }
      return overflow === 'paid'
        ? { ...base, account: 'paid', modelKey: paidModel.key }
        : { ...base, account: 'defer', modelKey: model.key }
    })
    setPlanRows(rows)
  }

  const saveRate = async () => {
    const r = await fetch('http://localhost:3001/api/paid-usage/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usdKrw: Number(rateInput) }) }).then(x => x.json()).catch(e => ({ ok: false, error: e.message }))
    setRecMsg(r.ok ? `환율 ${r.usdKrw}원/USD 저장됨(이후 기록부터 적용)` : `❌ ${r.error}`)
    if (r.ok) { setRateInput(''); loadPaid() }
  }
  const addPaidRecord = async () => {
    const body = { provider: recForm.provider.trim(), seconds: Number(recForm.seconds) || 0, usd: Number(recForm.usd) || undefined, note: recForm.note.trim(), source: 'manual' }
    const r = await fetch('http://localhost:3001/api/paid-usage/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json()).catch(e => ({ ok: false, error: e.message }))
    setRecMsg(r.ok ? `✅ 기록됨: $${r.entry.usd} (₩${r.entry.krw.toLocaleString()})` : `❌ ${r.error}`)
    if (r.ok) { setRecForm({ provider: '', seconds: '', usd: '', note: '' }); loadPaid() }
  }

  return (
    <div className={s.page}>
      <TabToolbar
        actions={[
          { key: 'reset', variant: 'green', label: '🔄 오늘자 리셋 (전부 최대치로)', onClick: resetDaily },
        ]}
      />
      <div className={s.root}>
        <EpisodeInfoSidebar maxStage={0} />
        <div className={s.main}>
        <div className={s.scrollBody}>
        <div className={s.content}>

      <div className={s.header}>
        <div>
          <div className={s.title}>일일 무료 크레딧 모니터링</div>
          <div className={s.subtitle}>
            Flow/PixVerse는 "자동 확인" 버튼으로 크레딧을 읽어올 수 있습니다(전용 Chrome 프로필이 떠 있어야 함). Qwen은 크레딧 개념이 없어 하루 상한을 직접 카운트합니다.
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
              <button className={s.checkBtn} onClick={() => checkToolCredits('flow', 'main')} disabled={checking['flow:main']}>
                {checking['flow:main'] ? '⏳' : '🔄 자동 확인'}
              </button>
            </div>
          </div>
          {checkMsg['flow:main'] && <div className={s.estimate}>{checkMsg['flow:main']}</div>}
          <div className={s.estimate}>Omni 8s(12크레딧) 기준 약 {flowMainCuts}컷 더 가능</div>

          <div className={s.divider} />

          <div className={s.creditTop}>
            <span className={s.creditLabel}>Qwen 오늘 생성 컷</span>
            <span className={s.creditVal} style={{ color: creditTracker.main.qwen.countToday >= creditTracker.main.qwen.targetMax ? '#eab308' : '#22c55e' }}>
              {creditTracker.main.qwen.countToday} <span className={s.creditUnit}>/ 맥시멈 {creditTracker.main.qwen.targetMax}</span>
            </span>
          </div>
          <div className={s.editRow}>
            <span>Qwen 생성 횟수</span>
            <div className={s.counterBtns}>
              <button onClick={() => setTool('main', 'qwen', 'countToday', Math.max(0, creditTracker.main.qwen.countToday - 1))}>-</button>
              <input type="number" value={creditTracker.main.qwen.countToday}
                onChange={e => setTool('main', 'qwen', 'countToday', Math.min(creditTracker.main.qwen.targetMax, Math.max(0, parseInt(e.target.value) || 0)))} />
              <button onClick={() => setTool('main', 'qwen', 'countToday', Math.min(creditTracker.main.qwen.targetMax, creditTracker.main.qwen.countToday + 1))}>+</button>
            </div>
          </div>
          <div className={s.estimate}>
            5초 × {creditTracker.main.qwen.targetMax}컷 = {creditTracker.main.qwen.targetMax * 5}초 → 10초 컷 기준 약 {(creditTracker.main.qwen.targetMax * 5 / 10).toFixed(1)}컷 분량
          </div>
          <div className={s.estimate}>플랫폼 자체 하드리밋은 없지만(1080p 5s 기준 소프트 제한), 안정적 사용을 위해 하루 {creditTracker.main.qwen.targetMax}컷을 자체 상한으로 운영</div>
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
              <button className={s.checkBtn} onClick={() => checkToolCredits('flow', 'sub')} disabled={checking['flow:sub']}>
                {checking['flow:sub'] ? '⏳' : '🔄 자동 확인'}
              </button>
            </div>
          </div>
          {checkMsg['flow:sub'] && <div className={s.estimate}>{checkMsg['flow:sub']}</div>}
          <div className={s.estimate}>Omni 8s(12크레딧) 기준 약 {flowSubCuts}컷 더 가능</div>

          <div className={s.divider} />

          <CreditBar label="PixVerse" remaining={creditTracker.sub.pixverse.remaining} total={creditTracker.sub.pixverse.dailyTotal} color="#3b82f6" />
          <div className={s.editRow}>
            <span>PixVerse 잔여 크레딧</span>
            <div className={s.checkRow}>
              <input type="number" value={creditTracker.sub.pixverse.remaining}
                onChange={e => setTool('sub', 'pixverse', 'remaining', parseInt(e.target.value) || 0)} />
              <button className={s.checkBtn} onClick={() => checkToolCredits('pixverse', 'sub')} disabled={checking['pixverse:sub']}>
                {checking['pixverse:sub'] ? '⏳' : '🔄 자동 확인'}
              </button>
            </div>
          </div>
          {checkMsg['pixverse:sub'] && <div className={s.estimate}>{checkMsg['pixverse:sub']}</div>}
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
            <tr><th>컷/클립</th><th>배정처</th><th>모델</th><th>초</th><th>비용</th><th /></tr>
          </thead>
          <tbody>
            {planRows.map(row => {
              const isPaid = row.account === 'paid'
              const isDefer = row.account === 'defer'
              const models = isPaid ? PAID_VIDEO_MODELS : FLOW_VIDEO_MODELS
              return (
                <tr key={row.id} style={isDefer ? { opacity: 0.6 } : undefined}>
                  <td><input value={row.label} onChange={e => updatePlanRow(row.id, 'label', e.target.value)} /></td>
                  <td>
                    <select value={row.account} onChange={e => updatePlanRow(row.id, 'account', e.target.value)}>
                      {PLAN_TARGETS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={row.modelKey} disabled={isDefer} onChange={e => updatePlanRow(row.id, 'modelKey', e.target.value)}>
                      {models.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </td>
                  <td>{isPaid
                    ? <input type="number" min="1" max="30" style={{ width: 52 }} value={row.seconds ?? 8} onChange={e => updatePlanRow(row.id, 'seconds', e.target.value)} />
                    : (row.seconds ?? '')}</td>
                  <td className={s.planCost}>{isDefer ? '—' : isPaid ? `$${rowPaidUsd(row).toFixed(2)} (₩${Math.round(rowPaidUsd(row) * usdKrw).toLocaleString()})` : `${rowFreeCredits(row)} 크레딧`}</td>
                  <td><button className={s.planRemoveBtn} onClick={() => removePlanRow(row.id)}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <button className={s.addRowBtn} onClick={addPlanRow}>+ 컷 추가</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
          <button className={s.addRowBtn} onClick={autoAssign} title="G4 미승인 YEORI 컷을 클립 단위로 풀어 메인→부 무료 크레딧 순으로 채웁니다">🧮 무료 우선 자동 배정</button>
          <label style={{ fontSize: 12, color: 'var(--text3)' }}>무료로 못 만드는 클립은{' '}
            <select value={overflow} onChange={e => setOverflow(e.target.value)}>
              <option value="defer">내일로 미룸</option>
              <option value="paid">유료 API로</option>
            </select>
          </label>
        </div>

        <div className={s.planSummary}>
          {planTotals.map(t => (
            <div key={t.key} className={`${s.planSummaryRow} ${t.left < 0 ? s.over : ''}`}>
              <span>{t.label} 계정 누적</span>
              <span>{t.used} / {t.remaining} (잔여 {t.left})</span>
            </div>
          ))}
          <div className={`${s.planSummaryRow} ${paid && paid.leftKrw != null && paid.leftKrw - planPaidKrw < 0 ? s.over : ''}`}>
            <span>유료 API 배정</span>
            <span>${planPaidUsd.toFixed(2)} (₩{planPaidKrw.toLocaleString()}){paid && paid.leftKrw != null && <> · 월 예산 잔여 ₩{(paid.leftKrw - planPaidKrw).toLocaleString()}</>}</span>
          </div>
          {planDeferred.length > 0 && (
            <div className={s.planSummaryRow}>
              <span>내일로 미룬 클립</span>
              <span>{planDeferred.length}개 (무료 크레딧 하루 {dailyFreeTotal} 기준 약 {Math.ceil(planDeferred.reduce((sum, r) => sum + ((FLOW_VIDEO_MODELS.find(m => m.key === r.modelKey)?.cost) || 0), 0) / Math.max(1, dailyFreeTotal))}일 더)</span>
            </div>
          )}
        </div>
      </div>

      {/* 유료 영상 API 사용 장부 — 대시보드 "이번 달 비용"과 같은 데이터. 자동 생성이 붙으면 거기서 기록되고, 그 전엔 수동 기록 */}
      <div className={s.card}>
        <div className={s.cardTitle}>유료 영상 API 사용 (이번 달)</div>
        <div className={s.simNote}>
          {paid
            ? <>합계 <b>${paid.totalUsd}</b> (₩{paid.totalKrw.toLocaleString()}) · {paid.count}건 · {paid.totalSeconds}초 · 월 예산 ₩{paid.budgetKrw.toLocaleString()} 중 직접 입력 지출 ₩{paid.manualSpentKrw.toLocaleString()} 포함 잔여 ₩{(paid.leftKrw ?? 0).toLocaleString()}</>
            : '서버 장부를 불러오는 중…'}
        </div>
        {paid && Object.keys(paid.byProvider).length > 0 && (
          <div className={s.estimate}>{Object.entries(paid.byProvider).map(([k, v]) => `${k}: $${v.usd.toFixed(2)} (${v.seconds}초, ${v.count}건)`).join(' · ')}</div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
          <input placeholder="공급자(예: Kling)" value={recForm.provider} onChange={e => setRecForm({ ...recForm, provider: e.target.value })} style={{ width: 130 }} />
          <input type="number" placeholder="초" value={recForm.seconds} onChange={e => setRecForm({ ...recForm, seconds: e.target.value })} style={{ width: 70 }} />
          <input type="number" step="0.01" placeholder="금액 $" value={recForm.usd} onChange={e => setRecForm({ ...recForm, usd: e.target.value })} style={{ width: 90 }} />
          <input placeholder="메모(컷/클립)" value={recForm.note} onChange={e => setRecForm({ ...recForm, note: e.target.value })} style={{ width: 160 }} />
          <button className={s.addRowBtn} onClick={addPaidRecord}>+ 사용 기록</button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>환율 {usdKrw}원/USD</span>
          <input type="number" placeholder="새 환율" value={rateInput} onChange={e => setRateInput(e.target.value)} style={{ width: 90 }} />
          <button className={s.addRowBtn} onClick={saveRate} disabled={!rateInput}>변경</button>
        </div>
        {recMsg && <div className={s.estimate}>{recMsg}</div>}
        {paid && paid.recent.length > 0 && (
          <table className={s.planTable} style={{ marginTop: 8 }}>
            <thead><tr><th>시각</th><th>공급자</th><th>초</th><th>금액</th><th>메모</th></tr></thead>
            <tbody>{paid.recent.slice(0, 8).map((e, i) => (
              <tr key={i}><td>{new Date(e.at).toLocaleString('ko-KR')}</td><td>{e.provider}{e.model ? ` · ${e.model}` : ''}</td><td>{e.seconds}</td><td>${e.usd} (₩{e.krw.toLocaleString()})</td><td>{e.note}</td></tr>
            ))}</tbody>
          </table>
        )}
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
