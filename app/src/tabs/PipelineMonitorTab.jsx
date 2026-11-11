import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { getGPointSummary } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import s from './PipelineMonitorTab.module.css'

// 파이프라인 모니터 — 대본생성→스튜디오→TTS→영상→편집→체크업/퍼블리싱을 실제 진행 상황
// (studio-state의 G1~G5 카운트 + 지금 돌고 있는 Flow 작업의 실시간 로그)으로 그리는 상시 모니터.
// 2026-10-08: "회로도가 실제 작동과정을 전달받아 화면에 펼쳐지는" 요청으로 신설. 켜져 있는 동안
// 몇 초마다 폴링해서 지금 어느 단계가 실제로 "전류가 흐르는" 중인지 보여준다.
//
// 2026-11-11: 노드 색을 "승인 플래그"가 아니라 "실제 파일을 열어본 결과"로 정하도록 확장.
// 11/9 SF_E01·E02 에서 06_publishing/cut_NN_final.mp4 가 오디오 스트림 없이 이틀 방치됐는데 화면엔 계속
// 완료로만 보였던 사고가 계기 — /api/pipeline-health(server/lib/pipelineHealth.js)가 노드별로 ffprobe 실측한
// ok/warn/fail 을 주고, fail(단선)은 플래그가 전부 완료여도 무조건 이긴다. 초록(done)은 실측 ok 일 때만 켜진다.
// 사고가 터진 두 자리(합성 05_video · G5→최종화 07_output)와 그 사이 미리듣기(06_publishing)를 별개 노드로 분리.
// gate: 그 노드 산출물을 승인하는 G포인트(카운트 표시용 보조 정보) · health: 실측 결과 키 · path: 실측 대상 폴더
const STAGES = [
  { key: 'script', no: '01', label: '대본 생성', sub: 'G1 · 대본 확정', tab: 'script', gate: 'g1', health: 'script', path: '01_script' },
  { key: 'image', no: '02', label: '이미지 생성', sub: 'G2 · 스튜디오(Flow)', tab: 'studio', gate: 'g2', health: 'image', path: '02_images' },
  { key: 'tts', no: '03', label: 'TTS', sub: 'G3 · 나레이션 음성', tab: 'tts', gate: 'g3', health: 'tts', path: '03_audio' },
  { key: 'video', no: '04', label: '영상 생성', sub: 'Flow 원본 클립', tab: 'video', health: 'video', path: '04_making/raw' },
  { key: 'compose', no: '05', label: '합성 · 컷 영상', sub: 'G4 · raw → 컷 영상', tab: 'video', gate: 'g4', health: 'compose', path: '05_video' },
  { key: 'preview', no: '06', label: '나레이션 미리듣기', sub: '영상 탭 · 나레이션+효과음', tab: 'video', health: 'preview', path: '06_publishing' },
  { key: 'finalize', no: '07', label: '최종화', sub: 'G5 · 릴스 최종본', tab: 'making', gate: 'g5', health: 'finalize', path: '07_output' },
  { key: 'checkup', no: '08', label: '체크업 · 퍼블리싱', sub: '최종본 확인·업로드', tab: 'checkup' },
]
const HEALTH_LABEL = { ok: '정상', warn: '경고', fail: '단선' }

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
  const [health, setHealth] = useState(null) // { code, checkedAt, nodes: { compose: { state, evidence, … } } } | { error }
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

  // 실파일 판정 — 파일이 안 바뀌면 서버가 캐시로 바로 답하므로(수십 ms) 15초마다 물어봐도 가볍다
  useInterval(() => {
    if (!epCode) { setHealth(null); return }
    fetch(`http://localhost:3001/api/pipeline-health?code=${encodeURIComponent(epCode)}`)
      .then(r => r.json())
      .then(d => setHealth(d.ok ? d : { error: d.error || '실측 실패' }))
      .catch(() => setHealth({ error: '서버 연결 안 됨' }))
  }, 15000, [epCode])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [activeJob?.steps?.length])

  // 지금 돌고 있는 작업 로그 메시지로 어느 스테이지가 "활성"인지 추정(컷 N / G2 vs G4 구분 키워드)
  const activeStageKey = (() => {
    if (!activeJob?.active) return null
    const lastMsgs = (activeJob.steps || []).map(st => st.msg).join(' ')
    if (/크레딧|클립|영상/.test(lastMsgs)) return 'video'
    return 'image'
  })()

  // 실측 결과가 이 에피소드 것일 때만 쓴다(에피소드를 바꾼 직후 옛 응답이 남아 있는 순간 방지)
  const healthNodes = health?.code === epCode ? health.nodes : null
  const healthOf = (st) => (st.health && healthNodes ? healthNodes[st.health] : null)

  // 플래그(G포인트) 기준 진행 단계 — 이제 "어디까지 왔나"만 알려주는 보조 정보. 초록/빨강은 여기서 정하지 않는다.
  const flagState = (st) => {
    if (cutsTotal === 0) return 'idle'
    const done = st.gate ? (gSummary[st.gate] ?? 0) : 0
    if (st.gate && done >= cutsTotal) return 'done'
    if (st.gate && done > 0) return 'partial'
    // 직전 승인 단계가 끝났으면 "대기", 아니면 "아직 멀었음"
    const prev = STAGES.slice(0, STAGES.indexOf(st)).filter(x => x.gate).pop()
    const prevDone = !prev ? true : (gSummary[prev.gate] ?? 0) >= cutsTotal
    return prevDone ? 'pending' : 'idle'
  }

  // 최종 노드 상태 = 실측 우선. fail(단선)은 플래그·진행 상태와 상관없이 무조건 이긴다.
  const stageState = (st) => {
    const h = healthOf(st)
    if (st.key === 'checkup') {
      const fin = healthNodes?.finalize?.state
      if (!fin || fin === 'fail') return 'idle'
      return fin === 'ok' && gSummary.g5 >= cutsTotal && cutsTotal > 0 ? 'done' : 'pending'
    }
    if (h?.state === 'fail') return 'fail'
    if (activeStageKey === st.key) return 'active'
    if (h?.state === 'warn') return 'warn'
    if (h?.state === 'ok') return h.complete ? 'done' : 'partial'
    // 실측할 파일이 아직 없거나(null) 실측 자체를 못 한 경우 — 플래그가 완료여도 초록을 켜지 않는다
    const f = flagState(st)
    return f === 'done' ? 'unverified' : f
  }
  const evidenceOf = (st) => {
    if (st.key === 'checkup') return null
    if (health?.error) return `실측 불가 — ${health.error} (플래그 기준 표시)`
    const h = healthOf(st)
    if (!h) return '실측 중…'
    return h.evidence
  }
  const worst = healthNodes ? ['fail', 'warn'].find(lv => Object.values(healthNodes).some(n => n.state === lv)) || 'ok' : null

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
          <span className={`${s.pill} ${worst === 'fail' ? s.pillFail : worst === 'warn' ? s.pillWarn : worst === 'ok' ? s.pillOk : s.pillNeutral}`} title={health?.checkedAt ? `실측 ${new Date(health.checkedAt).toLocaleTimeString('ko-KR', { hour12: false })}` : ''}>
            <span className={s.pillDot} />
            {worst === 'fail' ? '파일 단선' : worst === 'warn' ? '파일 경고' : worst === 'ok' ? '파일 정상' : '파일 실측 대기'}
          </span>
        </div>
      </div>

      <div className={s.board}>
        {STAGES.map((st, i) => {
          const stState = stageState(st)
          const h = healthOf(st)
          const ev = evidenceOf(st)
          const wireCls = { active: s.wireActive, done: s.wireDone, warn: s.wireWarn, fail: s.wireFail }[stState] || ''
          const issueTip = h?.issues?.length ? h.issues.map(x => (x.cut != null ? `컷${x.cut} ` : '') + x.msg).join('\n') : undefined
          return (
            <div key={st.key} className={s.row}>
              <button className={`${s.node} ${s[stState]}`} onClick={() => go(st.tab)} title={issueTip}>
                <div className={s.nodeNo}>{st.no}</div>
                <div className={s.nodeBody}>
                  <div className={s.nodeLabel}>
                    {st.label}
                    {h?.state && <span className={`${s.badge} ${s['badge_' + h.state]}`}>{HEALTH_LABEL[h.state]}</span>}
                    {stState === 'unverified' && <span className={s.badge}>파일 미확인</span>}
                  </div>
                  <div className={s.nodeSub}>{st.sub}{st.path ? ` · ${st.path}` : ''}</div>
                  {ev && <div className={s.nodeEvidence}>{ev}</div>}
                </div>
                {st.gate && (
                  <div className={s.nodeCount} title="승인 플래그(G포인트) — 보조 정보. 상태색은 파일 실측으로 정합니다.">
                    {gSummary[st.gate] ?? 0}<span className={s.nodeCountTotal}>/{cutsTotal}</span>
                    <div className={s.nodeCountCap}>{st.gate.toUpperCase()} 승인</div>
                  </div>
                )}
                <div className={s.nodeDot} />
              </button>
              {i < STAGES.length - 1 && (
                <div className={`${s.wire} ${wireCls}`}>
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
