import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { getGPointSummary } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import s from './PipelineMonitorTab.module.css'

// 파이프라인 모니터 — 대본생성→스튜디오→TTS→영상→편집→체크업/퍼블리싱을 실제 진행 상황
// (studio-state의 G1~G5 카운트 + 지금 돌고 있는 Flow 작업의 실시간 로그)으로 그리는 상시 모니터.
// 2026-10-08: "회로도가 실제 작동과정을 전달받아 화면에 펼쳐지는" 요청으로 신설. 켜져 있는 동안
// 몇 초마다 폴링해서 지금 어느 단계가 실제로 "전류가 흐르는" 중인지 보여준다.
const STAGES = [
  { key: 'g1', no: '01', label: '대본 생성', sub: 'G1 · 대본 확정', tab: 'script' },
  { key: 'g2', no: '02', label: '스튜디오', sub: 'G2 · 이미지 생성(Flow)', tab: 'studio' },
  { key: 'g3', no: '03', label: 'TTS', sub: 'G3 · 음성 생성', tab: 'tts' },
  { key: 'g4', no: '04', label: '영상 만들기', sub: 'G4 · Flow 영상 제출', tab: 'video' },
  { key: 'g5', no: '05', label: '편집 메타', sub: 'G5 · 컷 합성', tab: 'editmeta' },
  { key: 'checkup', no: '06', label: '체크업 · 퍼블리싱', sub: '최종본 확인·업로드', tab: 'checkup' },
]

function useInterval(fn, ms, deps) {
  useEffect(() => {
    fn()
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export default function PipelineMonitorTab() {
  const { state, dispatch } = useApp()
  const { episode, cuts } = state
  const cutsTotal = cuts.length
  const epCode = resolveEpisodeCode(episode)
  const gSummary = cutsTotal > 0 ? getGPointSummary(epCode, cutsTotal) : { g1: 0, g2: 0, g3: 0, g4: 0, g5: 0, total: 0 }

  const [flowReady, setFlowReady] = useState(null) // { chrome, flowTab, busy }
  const [activeJob, setActiveJob] = useState(null) // { active, jobId, state, steps, error }
  const [leaderRunning, setLeaderRunning] = useState(null)
  const logRef = useRef(null)

  useInterval(() => {
    fetch('http://localhost:3001/api/flow/ready').then(r => r.json()).then(setFlowReady).catch(() => setFlowReady(null))
  }, 6000, [])

  useInterval(() => {
    fetch('http://localhost:3001/api/flow/active').then(r => r.json()).then(setActiveJob).catch(() => setActiveJob(null))
  }, 2000, [])

  useInterval(() => {
    fetch('http://localhost:3001/api/pipeline-leader-status').then(r => r.json()).then(d => setLeaderRunning(!!d.running)).catch(() => setLeaderRunning(null))
  }, 10000, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [activeJob?.steps?.length])

  // 지금 돌고 있는 작업 로그 메시지로 어느 스테이지가 "활성"인지 추정(컷 N / G2 vs G4 구분 키워드)
  const activeStageKey = (() => {
    if (!activeJob?.active) return null
    const lastMsgs = (activeJob.steps || []).map(st => st.msg).join(' ')
    if (/크레딧|클립|영상/.test(lastMsgs)) return 'g4'
    return 'g2'
  })()

  const stageState = (key) => {
    const done = gSummary[key] ?? 0
    if (key === 'checkup') return done >= cutsTotal && cutsTotal > 0 && gSummary.g5 >= cutsTotal ? 'done' : (gSummary.g5 > 0 ? 'pending' : 'idle')
    if (cutsTotal === 0) return 'idle'
    if (activeStageKey === key) return 'active'
    if (done >= cutsTotal) return 'done'
    if (done > 0) return 'partial'
    // 직전 단계가 끝났으면 "대기", 아니면 "아직 멀었음"
    const order = ['g1', 'g2', 'g3', 'g4', 'g5']
    const idx = order.indexOf(key)
    const prevDone = idx <= 0 ? true : (gSummary[order[idx - 1]] ?? 0) >= cutsTotal
    return prevDone ? 'pending' : 'idle'
  }

  const go = (tab) => dispatch({ type: 'SET_TAB', p: tab })

  return (
    <div className={s.page}>
      <div className={s.scanline} />
      <div className={s.header}>
        <div>
          <div className={s.eyebrow}>PIPELINE MONITOR · {epCode || '—'}</div>
          <h1 className={s.title}>{episode?.title || '에피소드 없음'}</h1>
        </div>
        <div className={s.statusRow}>
          <StatusPill ok={flowReady?.chrome} label="Flow Chrome" />
          <StatusPill ok={flowReady?.flowTab} label="Flow 탭" />
          <StatusPill ok={leaderRunning} label="지휘자" neutral={leaderRunning == null} />
          <StatusPill ok={flowReady?.busy} label="작업중" warn />
        </div>
      </div>

      <div className={s.board}>
        {STAGES.map((st, i) => {
          const stState = stageState(st.key)
          return (
            <div key={st.key} className={s.row}>
              <button className={`${s.node} ${s[stState]}`} onClick={() => go(st.tab)}>
                <div className={s.nodeNo}>{st.no}</div>
                <div className={s.nodeBody}>
                  <div className={s.nodeLabel}>{st.label}</div>
                  <div className={s.nodeSub}>{st.sub}</div>
                </div>
                {st.key !== 'checkup' && (
                  <div className={s.nodeCount}>
                    {gSummary[st.key] ?? 0}<span className={s.nodeCountTotal}>/{cutsTotal}</span>
                  </div>
                )}
                <div className={s.nodeDot} />
              </button>
              {i < STAGES.length - 1 && (
                <div className={`${s.wire} ${stState === 'active' ? s.wireActive : ''} ${stState === 'done' ? s.wireDone : ''}`}>
                  <div className={s.wireCore} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className={s.console}>
        <div className={s.consoleHead}>
          <span className={s.consoleDot} data-live={!!activeJob?.active} />
          LIVE LOG {activeJob?.jobId ? `· ${activeJob.jobId}` : ''}
        </div>
        <div className={s.consoleBody} ref={logRef}>
          {activeJob?.active ? (
            (activeJob.steps || []).map((st, i) => (
              <div key={i} className={s.logLine}>
                <span className={s.logTime}>{new Date(st.at).toLocaleTimeString('ko-KR', { hour12: false })}</span>
                <span>{st.msg}</span>
              </div>
            ))
          ) : (
            <div className={s.logIdle}>지금 돌고 있는 Flow 작업이 없습니다 — G2/G4 생성이 시작되면 여기 실시간으로 표시됩니다.</div>
          )}
          {activeJob?.error && <div className={s.logError}>⚠ {activeJob.error}</div>}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ ok, label, warn, neutral }) {
  const cls = neutral ? s.pillNeutral : ok ? (warn ? s.pillWarnOn : s.pillOk) : s.pillOff
  return (
    <span className={`${s.pill} ${cls}`}>
      <span className={s.pillDot} />
      {label}
    </span>
  )
}
