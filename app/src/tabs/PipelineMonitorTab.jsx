import { useState, useEffect, useRef, useCallback, createContext, useContext, memo } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, addEdge, useNodesState, useEdgesState, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useApp } from '../context/AppContext'
import { getGPointSummary } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { PIPELINE_NODES, PORT_KINDS, buildEdges, autoLayout } from '../lib/pipelineNodes'
import { NodeIcon } from '../lib/pipelineIcons'
import s from './PipelineMonitorTab.module.css'

// 파이프라인 모니터 → "워크벤치" 캔버스.
// 2026-10-08: "회로도가 실제 작동과정을 전달받아 화면에 펼쳐지는" 요청으로 신설(세로 고정 배치).
// 2026-11-11 ①: 노드 색을 "승인 플래그"가 아니라 "실제 파일을 열어본 결과"로 정하도록 확장 — /api/pipeline-health
//   (server/lib/pipelineHealth.js)가 노드별로 ffprobe 실측한 ok/warn/fail 을 주고, fail(단선)은 플래그가 전부 완료여도 이긴다.
// 2026-11-11 ②: 성준님 피드백("스튜디오 탭 진행과정 외에 뭘 더 보여주냐") — 상태등이 아니라 각 노드의 코드·연결(입출력)·
//   변수까지 보이고 함께 조정하는 ComfyUI 식 워크벤치로 전환. React Flow(@xyflow/react) 캔버스:
//   - 노드 정의는 src/lib/pipelineNodes.js 배열(추가는 배열에 항목만 — 좌표 하드코딩 없음, 배선은 inputs[].from 에서 자동)
//   - 드래그로 옮긴 배치는 /api/pipeline-layout(downloads/state/pipeline-layout.json)에 저장돼 새로고침 뒤에도 유지
//   - 이번 단계는 "캔버스 인프라"까지: 변수 칸은 시각적 틀(로컬 상태), "Claude에게 묻기"는 자리표시, 배선 편집은 화면에서만(미저장)
// 2026-11-12: 좌측 아이콘 바 + 숨은 사이드바(성준님 요청 — "형식별 프로토타입 워크벤치"의 틀).
//   - 모드(전체/롱폼/숏폼/릴스/포스트): 실제로 작동하는 건 "전체"뿐. 나머지는 형식별 그래프 설계가 끝나지 않아 사이드바에
//     "아직 설계 전" 안내만 띄운다 — 캔버스의 노드·배선은 건드리지 않는다(작동하는 척 금지).
//   - 편집: 캔버스 위에 떠 있던 툴바(배치 저장 상태·자동 정렬·포트 색 범례)를 이리로 옮기고, 화면에서 그은 임시 배선(보라)
//     목록을 보여 주고 지울 수 있게 했다. 임시 배선 저장은 여전히 없다(범위 밖) — 그 사실을 패널에 그대로 적는다.
//   - 노드 추가 UI 는 일부러 없다: 노드의 소스 오브 트루스는 src/lib/pipelineNodes.js 배열이다.
const API = 'http://localhost:3001'
const HEALTH_LABEL = { ok: '정상', warn: '경고', fail: '단선' }
const STATE_LABEL = { active: '진행 중', unverified: '파일 미확인', pending: '대기', partial: '진행', idle: '대기', done: '정상' }
// 노드 상태 → 색(목업 토큰과 동일: ok / hold / fail / accent). 배선·미니맵에서 쓴다.
const STATE_COLOR = { done: '#4ee6a8', partial: '#4ee6a8', warn: '#ffd23f', fail: '#ff5d6c', active: '#ff7a1a' }
const IDLE_COLOR = '#3a342d'
const USER_EDGE_COLOR = '#8d6bff'

// 좌측 아이콘 바의 모드. ready:true 인 것만 실제 캔버스 모드다(지금은 "전체" 하나).
const RAIL_MODES = [
  { id: 'all', label: '전체', icon: 'railAll', ready: true, title: '전체 파이프라인' },
  { id: 'long', label: '롱폼', icon: 'railLong', title: '롱폼 워크벤치' },
  { id: 'short', label: '숏폼', icon: 'railShort', title: '숏폼 워크벤치' },
  { id: 'reel', label: '릴스', icon: 'railReel', title: '릴스 워크벤치' },
  { id: 'post', label: '포스트', icon: 'railPost', title: '포스트 워크벤치' },
]
const PORT_KIND_OF = Object.fromEntries(PIPELINE_NODES.flatMap(d => [...d.inputs, ...d.outputs].map(p => [`${d.id}.${p.port}`, p.kind])))
const NODE_LABEL_OF = Object.fromEntries(PIPELINE_NODES.map(d => [d.id, d.label]))

// 폴링으로 얻은 실시간 값(노드별 상태·근거·G카운트)과 변수 칸 로컬 상태 — 커스텀 노드가 id 로 꺼내 쓴다.
// (React Flow 의 nodes 상태에는 위치만 두고, 2초마다 바뀌는 값은 여기로 분리해 드래그 상태와 섞이지 않게 한다)
const LiveCtx = createContext({ byId: {}, cutsTotal: 0, vars: {}, setVar: () => {}, openTab: () => {} })

function useInterval(fn, ms, deps) {
  useEffect(() => {
    fn()
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// 플러그 한 줄 — ComfyUI 식: 카드 가장자리의 점(React Flow Handle, id = 포트 이름) + 바로 옆 포트 이름 + 실제로 오가는 것.
// 입력은 왼쪽 가장자리, 출력은 오른쪽 가장자리. 전선은 노드가 아니라 이 점에 꽂힌다(buildEdges 의 sourceHandle/targetHandle).
function PortRow({ side, p }) {
  const color = PORT_KINDS[p.kind]?.color || PORT_KINDS.text.color
  const isIn = side === 'in'
  return (
    <div className={`${s.port} ${isIn ? s.portIn : s.portOut}`} title={`${p.port} · ${PORT_KINDS[p.kind]?.label || ''}${isIn ? (p.from ? ` · ← ${p.from}` : ' · 외부 입력') : ''}`}>
      <Handle type={isIn ? 'target' : 'source'} position={isIn ? Position.Left : Position.Right} id={p.port} className={s.plug} style={{ background: color, borderColor: color }} />
      <span className={s.portName} style={{ color }}>{p.port}</span>
      <span className={s.portText}>{p.text}</span>
    </div>
  )
}

// ── 커스텀 노드 카드: 상단(아이콘·이름·상태배지) → 코드 → 연결(입력 플러그 / 출력 플러그 / 경고) → 변수 → 하단 버튼 ──
const PipelineNode = memo(function PipelineNode({ id, data, selected }) {
  const def = data.def
  const { byId, cutsTotal, vars, setVar, openTab } = useContext(LiveCtx)
  const live = byId[id] || { state: 'idle' }
  const [askNote, setAskNote] = useState(false)
  useEffect(() => {
    if (!askNote) return
    const t = setTimeout(() => setAskNote(false), 3000)
    return () => clearTimeout(t)
  }, [askNote])

  const problem = live.state === 'fail' || live.state === 'warn'
  const badgeText = live.health?.state ? HEALTH_LABEL[live.health.state] : STATE_LABEL[live.state] || '대기'
  const badgeKind = live.state === 'fail' ? 'fail' : live.state === 'warn' ? 'warn' : live.state === 'active' ? 'active' : (live.state === 'done' || live.state === 'partial') ? 'ok' : 'idle'
  return (
    <div className={`${s.node} ${s[live.state] || ''} ${selected ? s.nodeSelected : ''}`}>
      <div className={s.nodeHead}>
        <div className={s.icoWrap}><NodeIcon name={def.icon} className={s.icoSvg} /></div>
        <div className={s.nodeTitle}>
          <div className={s.nodeLabel}><span className={s.nodeNo}>{def.no}</span>{def.label}</div>
          <div className={s.nodeSub}>{def.sub}{def.path ? ` · ${def.path}` : ''}</div>
        </div>
        <span className={`${s.badge} ${s['badge_' + badgeKind]}`}>{badgeText}</span>
      </div>
      {live.evidence && !problem && <div className={s.nodeEvidence}>{live.evidence}</div>}

      <div className={s.section}>
        <div className={s.sectionLabel}>코드</div>
        {def.code.map(f => <code key={f} className={s.codeFile}>{f}</code>)}
      </div>

      <div className={`${s.section} ${s.portSection}`}>
        <div className={s.sectionLabel}>연결 <span className={s.sectionHint}>← 입력 플러그 · 출력 플러그 →</span></div>
        {def.inputs.map(p => <PortRow key={'i_' + p.port} side="in" p={p} />)}
        {def.outputs.map(p => <PortRow key={'o_' + p.port} side="out" p={p} />)}
        {problem && live.evidence && (
          <div className={`${s.ioWarn} ${live.state === 'fail' ? s.ioWarnFail : ''}`} title={live.issueTip}>⚠ {live.evidence}</div>
        )}
      </div>

      {def.vars?.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionLabel}>변수 <span className={s.sectionHint}>틀만 · 아직 반영 안 됨</span></div>
          {def.vars.map(v => {
            const val = vars[`${id}.${v.key}`] ?? v.value
            return (
              <label key={v.key} className={s.varRow}>
                <span className={s.varLabel}>{v.label}</span>
                {v.type === 'select' ? (
                  <select className={`${s.varInput} nodrag nopan`} value={val} onChange={e => setVar(`${id}.${v.key}`, e.target.value)}>
                    {v.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className={`${s.varInput} nodrag nopan`} value={val} onChange={e => setVar(`${id}.${v.key}`, e.target.value)} />
                )}
              </label>
            )
          })}
        </div>
      )}

      <div className={s.nodeFoot}>
        {def.tab && <button className={`${s.footBtn} nodrag nopan`} onClick={() => openTab(def.tab)}>탭 열기 ↗</button>}
        <button className={`${s.footBtn} ${s.footBtnAsk} nodrag nopan`} onClick={() => setAskNote(true)}>💬 Claude에게 묻기</button>
        {def.gate && (
          <span className={s.gateCount} title="승인 플래그(G포인트) — 보조 정보. 상태색은 파일 실측으로 정합니다.">
            {def.gate.toUpperCase()} {live.gateDone ?? 0}/{cutsTotal}
          </span>
        )}
      </div>
      {askNote && <div className={s.askNote}>다음 단계에서 연결 예정입니다 — 지금은 자리만 잡아둔 버튼입니다.</div>}
    </div>
  )
})
const nodeTypes = { pipeline: PipelineNode }

const toFlowNodes = (positions) => PIPELINE_NODES.map(def => ({ id: def.id, type: 'pipeline', position: positions[def.id], data: { def }, deletable: false }))

export default function PipelineMonitorTab() {
  return (
    <ReactFlowProvider>
      <Workbench />
    </ReactFlowProvider>
  )
}

function Workbench() {
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

  // ── 캔버스 상태: nodes 에는 위치만(실시간 값은 LiveCtx), edges 는 정의에서 자동 생성한 기본 배선 + 화면에서 그은 임시 배선 ──
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges().map(e => ({ ...e, deletable: false })))
  const [layoutReady, setLayoutReady] = useState(false)
  const [saveState, setSaveState] = useState({ kind: 'idle' }) // idle | saving | saved(at) | error(msg)
  const [resetArmed, setResetArmed] = useState(false)
  const [vars, setVars] = useState({})
  const { getNodes, fitView } = useReactFlow()
  // 좌측 아이콘 바: panel = 열려 있는 사이드바(null | 'mode:<id>' | 'edit'). 캔버스 모드 자체는 "전체" 고정(다른 모드는 아직 없음).
  const [panel, setPanel] = useState(null)
  const [clearArmed, setClearArmed] = useState(false)
  const railRef = useRef(null)
  const sideRef = useRef(null)
  const togglePanel = (key) => setPanel(p => (p === key ? null : key))
  // 바깥(캔버스 등)을 누르거나 Esc 를 누르면 접힌다
  useEffect(() => {
    if (!panel) return
    const onDown = (e) => { if (!railRef.current?.contains(e.target) && !sideRef.current?.contains(e.target)) setPanel(null) }
    const onKey = (e) => { if (e.key === 'Escape') setPanel(null) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [panel])
  useEffect(() => {
    if (!clearArmed) return
    const t = setTimeout(() => setClearArmed(false), 3000)
    return () => clearTimeout(t)
  }, [clearArmed])

  // 저장된 배치 불러오기(없거나 서버가 안 받으면 자동 배치). 저장 안 된 노드(새로 추가된 노드)는 autoLayout 이 채운다.
  useEffect(() => {
    let alive = true
    fetch(`${API}/api/pipeline-layout`).then(r => r.json())
      .then(d => { if (alive) { setNodes(toFlowNodes(autoLayout(PIPELINE_NODES, d?.positions || {}))); if (d?.savedAt) setSaveState({ kind: 'saved', at: d.savedAt }) } })
      .catch(() => { if (alive) { setNodes(toFlowNodes(autoLayout(PIPELINE_NODES, {}))); setSaveState({ kind: 'error', msg: '배치 불러오기 실패 — 자동 배치로 표시' }) } })
      .finally(() => { if (alive) setLayoutReady(true) })
    return () => { alive = false }
  }, [setNodes])

  const saveLayout = useCallback((list) => {
    const positions = Object.fromEntries(list.map(n => [n.id, { x: n.position.x, y: n.position.y }]))
    setSaveState({ kind: 'saving' })
    fetch(`${API}/api/pipeline-layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ positions }) })
      .then(r => r.json())
      .then(d => setSaveState(d.ok ? { kind: 'saved', at: d.savedAt } : { kind: 'error', msg: d.error || '저장 실패' }))
      .catch(() => setSaveState({ kind: 'error', msg: '배치 저장 실패 — 서버 연결 확인' }))
  }, [])

  // 드래그를 놓는 순간 전체 노드 좌표 저장(방금 끈 노드는 이벤트가 준 최종 좌표로 덮어 확실히 반영)
  const onNodeDragStop = useCallback((_e, _node, dragged) => {
    const moved = Object.fromEntries((dragged || []).map(n => [n.id, n]))
    saveLayout(getNodes().map(n => moved[n.id] || n))
  }, [getNodes, saveLayout])

  // 자동 정렬 — 저장된 배치를 버리는 동작이라 두 번 눌러야 실행(네이티브 confirm 은 브라우저 자동화를 멈춰서 안 씀)
  useEffect(() => {
    if (!resetArmed) return
    const t = setTimeout(() => setResetArmed(false), 3000)
    return () => clearTimeout(t)
  }, [resetArmed])
  const resetLayout = () => {
    if (!resetArmed) { setResetArmed(true); return }
    setResetArmed(false)
    const next = toFlowNodes(autoLayout(PIPELINE_NODES, {}))
    setNodes(next)
    saveLayout(next)
    setTimeout(() => fitView({ padding: 0.12, duration: 300 }), 50)
  }

  // 화면에서 새로 그은 배선(보라) — 이번 단계는 보여주기만, 저장·검증 없음(새로고침하면 사라진다)
  const onConnect = useCallback((conn) => setEdges(es => addEdge({ ...conn, data: { user: true } }, es)), [setEdges])
  // 임시 배선 지우기 — 저장된 게 없는 화면 전용 선이라 하나씩은 바로 지우고, "모두 지우기"만 두 번 눌러 실행
  const removeUserEdge = (id) => setEdges(es => es.filter(e => !(e.data?.user && e.id === id)))
  const clearUserEdges = () => {
    if (!clearArmed) { setClearArmed(true); return }
    setClearArmed(false)
    setEdges(es => es.filter(e => !e.data?.user))
  }
  const setVar = useCallback((key, value) => setVars(v => ({ ...v, [key]: value })), [])
  const openTab = useCallback((tab) => dispatch({ type: 'SET_TAB', p: tab }), [dispatch])

  // ── 폴링(기존 그대로) ──
  useInterval(() => {
    fetch(`${API}/api/flow/ready`).then(r => r.json()).then(setFlowReady).catch(() => setFlowReady(null))
  }, 6000, [])

  useInterval(() => {
    fetch(`${API}/api/flow/active`).then(r => r.json()).then(setActiveJob).catch(() => setActiveJob(null))
  }, 2000, [])

  useInterval(() => {
    fetch(`${API}/api/pipeline-leader-status`).then(r => r.json()).then(d => setLeaderRunning(!!d.running)).catch(() => setLeaderRunning(null))
  }, 10000, [])

  // 실파일 판정 — 파일이 안 바뀌면 서버가 캐시로 바로 답하므로(수십 ms) 15초마다 물어봐도 가볍다
  useInterval(() => {
    if (!epCode) { setHealth(null); return }
    fetch(`${API}/api/pipeline-health?code=${encodeURIComponent(epCode)}`)
      .then(r => r.json())
      .then(d => setHealth(d.ok ? d : { error: d.error || '실측 실패' }))
      .catch(() => setHealth({ error: '서버 연결 안 됨' }))
  }, 15000, [epCode])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [activeJob?.steps?.length])

  // 지금 돌고 있는 작업 로그 메시지로 어느 노드가 "활성"인지 추정(컷 N / G2 vs G4 구분 키워드)
  const activeStageKey = (() => {
    if (!activeJob?.active) return null
    const lastMsgs = (activeJob.steps || []).map(st => st.msg).join(' ')
    if (/크레딧|클립|영상/.test(lastMsgs)) return 'video'
    return 'image'
  })()

  // 실측 결과가 이 에피소드 것일 때만 쓴다(에피소드를 바꾼 직후 옛 응답이 남아 있는 순간 방지)
  const healthNodes = health?.code === epCode ? health.nodes : null
  const healthOf = (def) => (def.health && healthNodes ? healthNodes[def.id] : null)

  // 플래그(G포인트) 기준 진행 단계 — "어디까지 왔나"만 알려주는 보조 정보. 초록/빨강은 여기서 정하지 않는다.
  const flagState = (def) => {
    if (cutsTotal === 0) return 'idle'
    const done = def.gate ? (gSummary[def.gate] ?? 0) : 0
    if (def.gate && done >= cutsTotal) return 'done'
    if (def.gate && done > 0) return 'partial'
    // 직전 승인 단계가 끝났으면 "대기", 아니면 "아직 멀었음"
    const prev = PIPELINE_NODES.slice(0, PIPELINE_NODES.indexOf(def)).filter(x => x.gate).pop()
    const prevDone = !prev ? true : (gSummary[prev.gate] ?? 0) >= cutsTotal
    return prevDone ? 'pending' : 'idle'
  }

  // 최종 노드 상태 = 실측 우선. fail(단선)은 플래그·진행 상태와 상관없이 무조건 이긴다.
  const stageState = (def) => {
    const h = healthOf(def)
    if (def.id === 'checkup') {
      const fin = healthNodes?.finalize?.state
      if (!fin || fin === 'fail') return 'idle'
      return fin === 'ok' && gSummary.g5 >= cutsTotal && cutsTotal > 0 ? 'done' : 'pending'
    }
    if (h?.state === 'fail') return 'fail'
    if (activeStageKey === def.id) return 'active'
    if (h?.state === 'warn') return 'warn'
    if (h?.state === 'ok') return h.complete ? 'done' : 'partial'
    // 실측할 파일이 아직 없거나(null) 실측 자체를 못 한 경우 — 플래그가 완료여도 초록을 켜지 않는다
    const f = flagState(def)
    return f === 'done' ? 'unverified' : f
  }
  const evidenceOf = (def) => {
    if (!def.health) return null
    if (health?.error) return `실측 불가 — ${health.error} (플래그 기준 표시)`
    const h = healthOf(def)
    if (!h) return '실측 중…'
    return h.evidence
  }
  // 외부 앱 노드(trendRadar·agentApp)는 "가끔 손으로 쓰는 도구"라 오래 안 쓰여도 경고가 아니다 —
  // 헤더 알약은 실제 제작 파이프라인(외부 아님)만 집계해서, 그 경고 하나로 전체가 계속 "파일 경고"로 물들지 않게 한다.
  const CORE_NODE_IDS = PIPELINE_NODES.filter(d => !d.external).map(d => d.id)
  const worst = healthNodes
    ? ['fail', 'warn'].find(lv => CORE_NODE_IDS.some(id => healthNodes[id]?.state === lv)) || 'ok'
    : null

  // 노드별 실시간 값 합성 → LiveCtx 로 커스텀 노드에 전달
  const byId = {}
  for (const def of PIPELINE_NODES) {
    const h = healthOf(def)
    byId[def.id] = {
      state: stageState(def),
      health: h,
      evidence: evidenceOf(def),
      issueTip: h?.issues?.length ? h.issues.map(x => (x.cut != null ? `컷${x.cut} ` : '') + x.msg).join('\n') : undefined,
      gateDone: def.gate ? (gSummary[def.gate] ?? 0) : null,
    }
  }

  // 배선 색 = 도착(다음) 노드의 상태. 진행 중이면 흐르는 점선, 단선이면 끊어진 빨간 점선. 화면에서 그은 임시 배선은 보라.
  const styledEdges = edges.map(e => {
    if (e.data?.user) return { ...e, type: 'default', style: { stroke: USER_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '2 5' } }
    const st = byId[e.target]?.state
    const color = STATE_COLOR[st] || IDLE_COLOR
    return {
      ...e, type: 'default', animated: st === 'active',
      style: { stroke: color, strokeWidth: st === 'fail' ? 2.5 : 2, strokeDasharray: st === 'fail' ? '10 8' : undefined, opacity: STATE_COLOR[st] ? 0.9 : 1 },
    }
  })

  const userEdges = edges.filter(e => e.data?.user)
  const baseEdgeCount = edges.length - userEdges.length
  const panelMode = panel?.startsWith('mode:') ? RAIL_MODES.find(m => m.id === panel.slice(5)) : null

  const saveText = saveState.kind === 'saving' ? '배치 저장 중…'
    : saveState.kind === 'saved' ? `배치 저장됨 ${new Date(saveState.at).toLocaleTimeString('ko-KR', { hour12: false })}`
    : saveState.kind === 'error' ? saveState.msg : '배치: 자동(드래그하면 저장)'

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div className={s.eyebrow}>PIPELINE WORKBENCH · {epCode || '—'}</div>
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

      <div className={s.canvas}>
        {/* 좌측 아이콘 바 — 모드(전체만 작동) + 편집. 클릭하면 바로 오른쪽에 사이드바가 캔버스 위로 펼쳐진다 */}
        <div className={s.rail} ref={railRef}>
          {RAIL_MODES.map(m => (
            <button key={m.id} type="button" title={m.ready ? `${m.label} — 지금 보고 있는 그래프` : `${m.label} — 아직 설계 전`}
              className={`${s.railBtn} ${m.ready ? s.railBtnCurrent : s.railBtnSoon} ${panel === 'mode:' + m.id ? s.railBtnOpen : ''}`}
              aria-pressed={panel === 'mode:' + m.id} onClick={() => togglePanel('mode:' + m.id)}>
              <NodeIcon name={m.icon} className={s.railIco} />
              <span className={s.railLabel}>{m.label}</span>
            </button>
          ))}
          <div className={s.railSep} />
          <button type="button" title="편집 — 배치 · 배선" className={`${s.railBtn} ${panel === 'edit' ? s.railBtnOpen : ''}`}
            aria-pressed={panel === 'edit'} onClick={() => togglePanel('edit')}>
            <NodeIcon name="railWire" className={s.railIco} />
            <span className={s.railLabel}>편집</span>
            {userEdges.length > 0 && <span className={s.railCount} title={`저장되지 않은 임시 배선 ${userEdges.length}개`}>{userEdges.length}</span>}
          </button>
        </div>

        <div className={s.flowArea}>
          <div className={`${s.side} ${panel ? s.sideOpen : ''}`} ref={sideRef} aria-hidden={!panel}>
            {panelMode && (
              <>
                <div className={s.sideHead}>
                  <span className={s.sideTitle}>{panelMode.title}</span>
                  <span className={`${s.sideTag} ${panelMode.ready ? s.sideTagOn : ''}`}>{panelMode.ready ? '표시 중' : '아직 설계 전'}</span>
                </div>
                {panelMode.ready ? (
                  <div className={s.sideBlock}>
                    <p className={s.sideText}>지금 캔버스가 이 모드입니다. 형식(롱폼·숏폼·릴스·포스트)을 구분하지 않는 하나의 그래프입니다.</p>
                    <div className={s.sideStat}><span>노드</span><b>{PIPELINE_NODES.length}개</b></div>
                    <div className={s.sideStat}><span>기본 배선</span><b>{baseEdgeCount}개</b></div>
                    <div className={s.sideStat}><span>임시 배선(미저장)</span><b>{userEdges.length}개</b></div>
                    <p className={s.sideNote}>노드를 추가·수정하려면 <code>src/lib/pipelineNodes.js</code> 배열을 고칩니다 — 화면에서 노드를 만드는 기능은 일부러 두지 않았습니다.</p>
                  </div>
                ) : (
                  <div className={s.sideBlock}>
                    <div className={s.sidePlaceholder}>
                      <b>아직 설계 전 — 다음 단계</b>
                      {panelMode.label} 전용 그래프는 아직 없습니다. 이 아이콘을 눌러도 캔버스는 바뀌지 않고, 계속 「전체」 그래프가 그대로 보입니다.
                    </div>
                    <p className={s.sideText}>형식별 그래프를 만들기 전에 먼저 정해야 하는 것:</p>
                    <ul className={s.sideList}>
                      <li>화면 비율 처리가 코드 두 곳에서 서로 다르게 정의돼 있음 — 하나로 정리 필요</li>
                      <li>파일 실측(pipelineHealth.js)이 형식을 구분하지 않음 — 형식별 판정 기준 필요</li>
                      <li>형식마다 어떤 노드·배선이 달라지는지 정의</li>
                    </ul>
                  </div>
                )}
              </>
            )}
            {panel === 'edit' && (
              <>
                <div className={s.sideHead}><span className={s.sideTitle}>편집</span></div>
                <div className={s.sideBlock}>
                  <div className={s.sideLabel}>배치</div>
                  <div className={`${s.saveState} ${saveState.kind === 'error' ? s.saveStateErr : ''}`}>{saveText}</div>
                  <button className={`${s.toolBtn} ${resetArmed ? s.toolBtnArmed : ''}`} onClick={resetLayout}>
                    {resetArmed ? '한 번 더 누르면 배치 초기화' : '자동 정렬'}
                  </button>
                  <p className={s.sideNote}>노드를 드래그하면 그 자리에서 배치가 저장됩니다. 자동 정렬은 저장된 배치를 버리고 의존관계 순서로 다시 놓습니다.</p>
                </div>
                <div className={s.sideBlock}>
                  <div className={s.sideLabel}>포트 색</div>
                  <div className={s.legend}>
                    {Object.entries(PORT_KINDS).map(([k, v]) => (
                      <span key={k} className={s.legendItem}><span className={s.legendDot} style={{ background: v.color }} />{v.label}</span>
                    ))}
                  </div>
                </div>
                <div className={s.sideBlock}>
                  <div className={s.sideLabel}>배선 편집 <span className={s.sideLabelHint}>임시 배선 {userEdges.length}개</span></div>
                  <div className={s.sideWarn}>이 배선들은 아직 저장되지 않습니다 — 새로고침하면 사라집니다. 실제 파이프라인 동작에도 영향이 없습니다(화면 표시뿐).</div>
                  {userEdges.length === 0 ? (
                    <p className={s.sideText}>임시 배선이 없습니다. 출력 플러그(카드 오른쪽 점)에서 입력 플러그(왼쪽 점)로 끌면 보라색 점선 배선이 생기고, 여기 목록에 나타납니다.</p>
                  ) : (
                    <>
                      {userEdges.map(e => (
                        <div key={e.id} className={s.wireRow}>
                          <div className={s.wireEnds}>
                            <span className={s.wireEnd} title={NODE_LABEL_OF[e.source]}><i style={{ background: PORT_KINDS[PORT_KIND_OF[`${e.source}.${e.sourceHandle}`]]?.color }} />{e.source}.{e.sourceHandle}</span>
                            <span className={s.wireEnd} title={NODE_LABEL_OF[e.target]}><em>→</em><i style={{ background: PORT_KINDS[PORT_KIND_OF[`${e.target}.${e.targetHandle}`]]?.color }} />{e.target}.{e.targetHandle}</span>
                          </div>
                          <button className={s.wireDel} onClick={() => removeUserEdge(e.id)}>지우기</button>
                        </div>
                      ))}
                      <button className={`${s.toolBtn} ${clearArmed ? s.toolBtnArmed : ''}`} onClick={clearUserEdges}>
                        {clearArmed ? '한 번 더 누르면 모두 지움' : '임시 배선 모두 지우기'}
                      </button>
                    </>
                  )}
                  <p className={s.sideNote}>기본 배선 {baseEdgeCount}개는 <code>pipelineNodes.js</code> 의 입력 포트 <code>from</code> 에서 자동으로 만들어져 여기서 지울 수 없습니다.</p>
                </div>
              </>
            )}
          </div>
        {layoutReady && (
          <LiveCtx.Provider value={{ byId, cutsTotal, vars, setVar, openTab }}>
            <ReactFlow
              nodes={nodes}
              edges={styledEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              colorMode="dark"
              fitView
              fitViewOptions={{ padding: 0.12 }}
              minZoom={0.2}
              maxZoom={1.75}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={28} size={1} color="rgba(255,122,26,.16)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={n => STATE_COLOR[byId[n.id]?.state] || IDLE_COLOR} nodeStrokeWidth={0} maskColor="rgba(6,6,6,.72)" />
            </ReactFlow>
          </LiveCtx.Provider>
        )}
        </div>
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
