import { useState, useEffect, useRef, useCallback, createContext, useContext, memo } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, addEdge, useNodesState, useEdgesState, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useApp } from '../context/AppContext'
import { getGPointSummary } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { PIPELINE_NODES, PORT_KINDS, LAYOUT, buildEdges, autoLayout } from '../lib/pipelineNodes'
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
//   - 실제로 가동되는 노드(코드·포트·health 실측)의 소스 오브 트루스는 여전히 src/lib/pipelineNodes.js 배열이다 —
//     화면에서 "진짜" 노드를 만드는 기능은 없다.
// 2026-11-19: 편집 패널에 "노드 신설"(구상 노드) 추가 — 이름+컨셉만 입력해 캔버스에 점선 카드로 올려본다.
//   pipelineNodes.js 와는 별도 저장소(/api/pipeline-draft-nodes, downloads/state/pipeline-draft-nodes.json)라
//   진짜 노드와 절대 안 섞인다 — 실제 단계로 쓰려면 사람이 그 배열에 손으로 반영해야 한다.
// 2026-11-19(같은 날 3차, 성준님 — "평소엔 안 쓰겠지만 상황이 생기면 직접 만져보며 원리를 알아야
//   한다"): 배선을 화면에서 뗐다 다른 포트에 꽂을 수 있게(React Flow reconnect) + 구상 노드에도
//   이름만 적어 넣는 실제 포트(Handle)를 달았다. ★ 실선(코드에서 온 배선)도 이제 드래그로 캔버스
//   위에서 뗄 수 있다 — 단, 이것도 다른 임시 배선과 똑같이 "화면에서만", 떼는 순간 보라색 임시
//   배선 취급(data.user=true)으로 바뀌고 새로고침하면 pipelineNodes.js 기준으로 원래대로
//   돌아온다(절대 코드·서버에 반영 안 됨). 키보드 Delete 로 실선을 지우는 건 여전히 막혀 있다
//   (edges 의 deletable:false) — 이번에 연 건 "끝을 잡아 드래그"뿐, 실수로 선택 후 삭제키 누르는
//   사고는 그대로 방지된다. 또한:
//   - 사이드바는 이제 그 아이콘을 다시 눌러야만 닫힌다(바깥 클릭·Esc 로 안 닫힘).
//   - 상단 바 상태 알약 클릭 → 관련 노드만 캔버스에서 강조(하이라이트+자동 포커스), 다시 누르면 해제.
//   - 정상(초록) 배선을 포트 색(텍스트/이미지/영상/음성)으로 세분화 — 경고·단선 색은 그대로.
// 2026-11-19(같은 날 2차, 성준님 피드백 — "표시 간소화" + 누락 배선 감사):
//   - 노드 유형 표시를 카드 맨 위 별도 띠 → 카드 테두리 자체로(G게이트=초록·결정운영=보라·외부=회색).
//     단, 경고·단선·진행중 상태는 여전히 그 알림색이 테두리를 덮어쓴다(단선 우선 원칙 유지) —
//     "정상 실측(ok)" 신호는 이제 테두리가 아니라 배지 텍스트·icoWrap 글로우로만 표시(정보 이동,
//     소실 아님). PORT_KINDS 의 media(영상·음성 통합)를 video(초록)·audio(분홍)로 분리.
//   - 누락 배선 감사: pipelineNodes.js 의 모든 입력(from 없음)·출력(아무도 안 받음) 포트를 스캔해
//     "의도적 외부입력/종착점"과 "실제 버그"를 구분 — checkup.bgmPreview 가 bgm.decided 가 아니라
//     finalize.finalizeLog 에서 와야 한다는 실제 배선 오류를 찾아 고쳤다(/api/checkup-bgm-preview
//     코드를 직접 대조해 확인 — 체크업 미리듣기는 그 세션의 BGM 드롭다운이 아니라 "지난 최종본의
//     곡"을 먼저 본다). 나머지 미연결 포트는 전부 의도적(각 포트 옆 주석 참고).
const API = 'http://localhost:3001'
const HEALTH_LABEL = { ok: '정상', warn: '경고', fail: '단선' }
const STATE_LABEL = { active: '진행 중', unverified: '파일 미확인', pending: '대기', partial: '진행', idle: '대기', done: '정상' }
// 노드 상태 → 색(목업 토큰과 동일: ok / hold / fail / accent). 배선·미니맵에서 쓴다.
const STATE_COLOR = { done: '#4ee6a8', partial: '#4ee6a8', warn: '#ffd23f', fail: '#ff5d6c', active: '#ff7a1a' }
const IDLE_COLOR = '#3a342d'
const USER_EDGE_COLOR = '#8d6bff'
const PLANNED_EDGE_COLOR = '#6b7280'
// 2026-11-19: 노드 카드 유형 구분 — 처음엔 카드 맨 위 별도 띠로 했다가, 성준님 요청으로 "표시
// 간소화": 띠를 없애고 테두리 자체를 유형색으로(G게이트=초록·결정운영=보라·외부=회색). 그 결과
// 테두리의 "뜻"이 바뀐다 — 예전엔 ok(정상 실측)=초록이었는데, 이제 기본 테두리색은 유형(고정
// 정체성)이고, 실측 상태(ok/warn/fail/active)는 경고·단선·진행중일 때만 테두리를 덮어써서
// 보여준다(badge 텍스트·icoWrap 글로우는 여전히 실측 상태를 그대로 보여줌 — 정보가 없어진 게
// 아니라 다른 요소로 옮겨감). 분류 기준은 이미 있는 필드만 씀: G포인트가 있으면 핵심 제작 단계,
// external 이면 외부 앱, 그 둘 다 아니면(checkup·bgm) 결정·운영 단계.
const CATEGORY_OF = (def) => (def.external ? 'external' : def.gate ? 'core' : 'decision')
const CATEGORY_COLOR = { core: '#4ee6a8', decision: '#b267e0', external: '#7d8a99' }
const CATEGORY_LABEL = { core: '핵심 제작 단계(G-gate)', decision: '결정·운영 단계', external: '외부 앱' }
// 상단 바 상태 알약 클릭 → 캔버스 하이라이트("연계 활성화"). 알약 키 → 하이라이트할 노드 id 목록을
// 아래 Workbench 안에서 계산한다(실측 상태가 필요한 'worst'는 상수로 못 정함).
const HIGHLIGHT_STATIC_IDS = { flow: ['image', 'video'], leader: ['pipelineLeader'] }

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
  // 2026-11-19(성준님 — "카드 상단 색상 띠는 삭제, 테두리색으로 간소화"): 별도 띠 대신 테두리 자체를
  // 유형색(G게이트=초록/결정·운영=보라/외부=회색)으로 — 단, 경고·단선·진행중은 여전히 그 알림색이
  // 이긴다(단선 신호가 무조건 우선한다는 원칙은 안 건드림). 그래서 그 세 상태일 때만 인라인
  // 스타일을 비워 CSS의 .node.fail/.node.warn/.node.active 가 그대로 적용되게 한다.
  const category = CATEGORY_OF(def)
  const isAlertState = live.state === 'fail' || live.state === 'warn' || live.state === 'active'
  return (
    <div className={`${s.node} ${s[live.state] || ''} ${selected ? s.nodeSelected : ''} ${live.dimmed ? s.nodeDimmed : ''}`}
      style={!isAlertState ? { borderColor: CATEGORY_COLOR[category] } : undefined} title={CATEGORY_LABEL[category]}>
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
// ── 구상 노드 카드(2026-11-19, "노드 신설") — pipelineNodes.js 와 무관한 메모판 카드.
// 코드·포트·health 가 없다 — 실선 배선도 못 꽂는다(배선은 여전히 실제 포트 전용). 점선 테두리 +
// "구상 중" 배지로 실제 가동 중인 노드와 절대 혼동되지 않게 한다.
// 구상 노드의 포트는 kind(텍스트/이미지/영상/음성)가 없다 — 아직 코드가 없어 "정확히 어떤
// 데이터냐"가 안 정해졌으므로, 색은 전부 배선편집(보라)과 같은 계열로 통일해 "구상 단계"임을
// 바로 알아보게 한다. 이름만 서버에 저장되고(server/lib/pipelineDraftNodes.js), from 은 절대
// 안 생긴다 — 이 포트로 들어오고 나가는 배선은 전부 onConnect/onReconnect 가 만드는 화면 전용
// 배선(data.user=true)뿐이다.
const DraftNode = memo(function DraftNode({ data, selected }) {
  const d = data.draft
  const ins = d.inputs || [], outs = d.outputs || []
  return (
    <div className={`${s.draftNode} ${selected ? s.nodeSelected : ''}`}>
      <div className={s.draftHead}>
        <span className={s.draftBadge}>구상 중</span>
        <span className={s.draftLabel}>{d.label}</span>
      </div>
      {d.concept && <div className={s.draftConceptText}>{d.concept}</div>}
      {(ins.length > 0 || outs.length > 0) && (
        <div className={s.draftPorts}>
          {ins.map(name => (
            <div key={'i_' + name} className={`${s.draftPort} ${s.draftPortIn}`} title={`${name} · 입력(구상) · 외부/임시 배선만 가능`}>
              <Handle type="target" position={Position.Left} id={name} className={s.draftPlug} />
              <span className={s.draftPortName}>{name}</span>
            </div>
          ))}
          {outs.map(name => (
            <div key={'o_' + name} className={`${s.draftPort} ${s.draftPortOut}`} title={`${name} · 출력(구상) · 임시 배선만 가능`}>
              <Handle type="source" position={Position.Right} id={name} className={s.draftPlug} />
              <span className={s.draftPortName}>{name}</span>
            </div>
          ))}
        </div>
      )}
      <div className={s.draftFoot}>pipelineNodes.js 미반영 — 배선은 전부 화면 전용(임시)</div>
    </div>
  )
})
const nodeTypes = { pipeline: PipelineNode, draft: DraftNode }

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
  // 2026-11-19(성준님 — "배선 테스트해보니 실행 취소가 있어야겠다") — 배치·배선 되돌리기.
  // ref 로 항상 최신 nodes/edges 를 들고 있다가(state 는 액션 핸들러가 정의된 렌더 시점의 값을
  // 들고 있을 수 있어 stale closure 위험이 있음) 조작 "직전"에 pushHistory() 로 그 스냅샷을 쌓는다.
  // 구상 노드 생성·삭제는 서버 기록(/api/pipeline-draft-nodes)과 얽혀 되돌리기가 반쪽짜리가 될 수
  // 있어(되돌려도 새로고침하면 서버 기록 기준으로 되돌아옴) 범위에서 뺐다 — "지우기" 버튼 자체가
  // 그 경우의 되돌리기 역할을 한다. 여기서 다루는 건 노드 드래그(배치)·배선(연결·재배선·삭제·
  // 자동 정렬)뿐.
  const nodesRef = useRef(nodes), edgesRef = useRef(edges)
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])
  // ★ 스택 자체는 state 가 아니라 ref 에 둔다 — React 18 StrictMode(이 앱은 켜져 있다, main.jsx)는
  // setState(prev => ...) 함수형 업데이터를 "순수한지" 검증하려고 개발 모드에서 일부러 두 번
  // 호출한다. 그 안에 setNodes·setEdges·saveLayout 같은 부수효과를 넣었더니 실측으로 바로
  // 드러났다 — undo 한 번 눌렀는데 "다시 실행 (2)"가 찍힘(실행 취소 버튼으로 직접 확인). 부수효과가
  // 있는 로직은 updater 밖, 평범한 함수 본문에서 ref 를 직접 변경하는 쪽으로 옮겨야 두 번 불려도
  // 안전하다 — count 용 state 만 따로 둔다(화면 표시만 담당, 부수효과 없음).
  const HISTORY_LIMIT = 50
  const historyRef = useRef([]), futureRef = useRef([])
  const [historyCount, setHistoryCount] = useState(0)
  const [futureCount, setFutureCount] = useState(0)
  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current, { nodes: nodesRef.current, edges: edgesRef.current }].slice(-HISTORY_LIMIT)
    futureRef.current = []   // 새 조작이 일어나면 redo 스택은 버린다 — 표준 undo/redo 동작
    setHistoryCount(historyRef.current.length)
    setFutureCount(0)
  }, [])
  const [layoutReady, setLayoutReady] = useState(false)
  const [saveState, setSaveState] = useState({ kind: 'idle' }) // idle | saving | saved(at) | error(msg)
  const [resetArmed, setResetArmed] = useState(false)
  const [vars, setVars] = useState({})
  const { getNodes, fitView, screenToFlowPosition } = useReactFlow()
  // 좌측 아이콘 바: panel = 열려 있는 사이드바(null | 'mode:<id>' | 'edit'). 캔버스 모드 자체는 "전체" 고정(다른 모드는 아직 없음).
  const [panel, setPanel] = useState(null)
  const [clearArmed, setClearArmed] = useState(false)
  // 2026-11-19 "노드 신설" — pipelineNodes.js 와 무관한 구상 카드(draft). 내용은 /api/pipeline-draft-nodes,
  // 좌표는 기존 pipeline-layout.json 에 다른 노드와 똑같이 섞여 저장된다(id 문자열만 다를 뿐).
  const [draftNodes, setDraftNodes] = useState([])
  const [draftLabel, setDraftLabel] = useState('')
  const [draftConcept, setDraftConcept] = useState('')
  const [draftInputsText, setDraftInputsText] = useState('')
  const [draftOutputsText, setDraftOutputsText] = useState('')
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState('')
  // 2026-11-19 상단 바 상태 알약 클릭 → 캔버스 하이라이트("연계 활성화"). null = 필터 없음.
  const [highlightKey, setHighlightKey] = useState(null)
  const togglePillHighlight = (key) => setHighlightKey(k => (k === key ? null : key))
  const railRef = useRef(null)
  const sideRef = useRef(null)
  // 2026-11-19(성준님 요청): 전엔 바깥(캔버스 등)을 누르거나 Esc 를 누르면 사이드바가 접혔다 —
  // 이제 그 아이콘을 다시 눌러야만 닫힌다(togglePanel 의 p===key?null:key 토글이 그 역할). 다른 곳을
  // 눌러도 패널이 열린 채 유지돼, 캔버스를 조작하면서 패널 내용을 계속 참고할 수 있다.
  const togglePanel = (key) => setPanel(p => (p === key ? null : key))
  useEffect(() => {
    if (!clearArmed) return
    const t = setTimeout(() => setClearArmed(false), 3000)
    return () => clearTimeout(t)
  }, [clearArmed])

  // 저장된 배치 불러오기(없거나 서버가 안 받으면 자동 배치) + 구상 노드 목록. 저장 안 된 노드(새로
  // 추가된 노드·아직 안 드래그한 구상 노드)는 autoLayout 이 채운다. 구상 노드는 저장된 좌표가 없으면
  // 캔버스 맨 아래(기존 그래프보다 낮은 행)에 순서대로 쌓아 둔다 — 드래그하면 그 자리가 저장된다.
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`${API}/api/pipeline-layout`).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/pipeline-draft-nodes`).then(r => r.json()).catch(() => null),
    ]).then(([layoutD, draftD]) => {
      if (!alive) return
      const positions = layoutD?.positions || {}
      const drafts = Array.isArray(draftD?.drafts) ? draftD.drafts : []
      setDraftNodes(drafts)
      const real = toFlowNodes(autoLayout(PIPELINE_NODES, positions))
      const draftFlow = drafts.map((d, i) => ({
        id: d.id, type: 'draft',
        position: positions[d.id] || { x: LAYOUT.x0 + i * LAYOUT.colW, y: LAYOUT.y0 + 7 * LAYOUT.rowH },
        data: { draft: d }, deletable: false,
      }))
      setNodes([...real, ...draftFlow])
      if (layoutD?.savedAt) setSaveState({ kind: 'saved', at: layoutD.savedAt })
      if (!layoutD) setSaveState({ kind: 'error', msg: '배치 불러오기 실패 — 자동 배치로 표시' })
    }).finally(() => { if (alive) setLayoutReady(true) })
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

  // undo/redo — 스택은 ref(historyRef/futureRef)에서 직접 읽고 바꾼다(위 주석 참고). count state 는
  // 화면 표시 전용이라 StrictMode 이중호출이 일어나도 그냥 같은 값을 한 번 더 쓸 뿐 안전하다.
  const undo = useCallback(() => {
    if (!historyRef.current.length) return
    const prev = historyRef.current[historyRef.current.length - 1]
    historyRef.current = historyRef.current.slice(0, -1)
    futureRef.current = [...futureRef.current, { nodes: nodesRef.current, edges: edgesRef.current }].slice(-HISTORY_LIMIT)
    setNodes(prev.nodes)
    setEdges(prev.edges)
    saveLayout(prev.nodes)
    setHistoryCount(historyRef.current.length)
    setFutureCount(futureRef.current.length)
  }, [setNodes, setEdges, saveLayout])
  const redo = useCallback(() => {
    if (!futureRef.current.length) return
    const next = futureRef.current[futureRef.current.length - 1]
    futureRef.current = futureRef.current.slice(0, -1)
    historyRef.current = [...historyRef.current, { nodes: nodesRef.current, edges: edgesRef.current }].slice(-HISTORY_LIMIT)
    setNodes(next.nodes)
    setEdges(next.edges)
    saveLayout(next.nodes)
    setHistoryCount(historyRef.current.length)
    setFutureCount(futureRef.current.length)
  }, [setNodes, setEdges, saveLayout])
  // 키보드 단축키 — 입력칸(이름/컨셉/변수 등)에 포커스가 있을 때는 그 칸의 평소 Ctrl+Z(텍스트 되돌리기)를
  // 가로채지 않는다.
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  // 드래그를 놓는 순간 전체 노드 좌표 저장(방금 끈 노드는 이벤트가 준 최종 좌표로 덮어 확실히 반영)
  const onNodeDragStart = useCallback(() => pushHistory(), [pushHistory])
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
    pushHistory()
    // 구상 노드(draft)는 autoLayout 이 모르는 id라 — 자동 정렬에서 사라지지 않게 같은 "맨 아래 쌓기"
    // 기본 위치로 같이 다시 놓는다(불러오기 effect와 같은 규칙).
    const real = toFlowNodes(autoLayout(PIPELINE_NODES, {}))
    const draftFlow = draftNodes.map((d, i) => ({
      id: d.id, type: 'draft', position: { x: LAYOUT.x0 + i * LAYOUT.colW, y: LAYOUT.y0 + 7 * LAYOUT.rowH }, data: { draft: d }, deletable: false,
    }))
    const next = [...real, ...draftFlow]
    setNodes(next)
    saveLayout(next)
    setTimeout(() => fitView({ padding: 0.12, duration: 300 }), 50)
  }

  // 2026-11-19 "노드 신설" — 이름·컨셉만 입력해 캔버스 중앙에 구상 카드 하나를 올린다. 서버에 내용을
  // 저장하고, 위치는 지금 화면 중앙(screenToFlowPosition)으로 즉시 잡아 기존 pipeline-layout 저장
  // 경로(saveLayout)에 같이 실어 보낸다 — 드래그로 옮긴 다른 노드와 저장 방식이 완전히 같다.
  const submitDraft = async () => {
    const label = draftLabel.trim()
    if (!label || draftBusy) return
    setDraftBusy(true)
    setDraftError('')
    try {
      const inputs = draftInputsText.split(',').map(x => x.trim()).filter(Boolean)
      const outputs = draftOutputsText.split(',').map(x => x.trim()).filter(Boolean)
      const r = await fetch(`${API}/api/pipeline-draft-nodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, concept: draftConcept.trim(), inputs, outputs }),
      })
      // 2026-11-19: 이 엔드포인트는 핫리로드 대상이 아닌 server/proxy.js 쪽 — 프록시 재시작 전엔
      // 404(HTML)가 와서 .json() 이 바로 throw 한다. alert() 는 페이지를 멈춰서(네이티브 모달) 안 쓴다.
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || '생성 실패')
      const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const draftFlowNode = { id: d.node.id, type: 'draft', position: pos, data: { draft: d.node }, deletable: false }
      setDraftNodes(ds => [...ds, d.node])
      setNodes(ns => { const next = [...ns, draftFlowNode]; saveLayout(next); return next })
      setDraftLabel(''); setDraftConcept(''); setDraftInputsText(''); setDraftOutputsText('')
    } catch (e) { setDraftError(`노드 신설 실패: ${e.message} — 서버(프록시) 재시작이 필요할 수 있습니다`) } finally { setDraftBusy(false) }
  }
  const deleteDraft = async (id) => {
    setNodes(ns => ns.filter(n => n.id !== id))
    setDraftNodes(ds => ds.filter(d => d.id !== id))
    try { await fetch(`${API}/api/pipeline-draft-nodes/${id}`, { method: 'DELETE' }) } catch { /* 로컬 화면은 이미 지웠다 */ }
  }

  // 화면에서 새로 그은 배선(보라) — 이번 단계는 보여주기만, 저장·검증 없음(새로고침하면 사라진다)
  const onConnect = useCallback((conn) => { pushHistory(); setEdges(es => addEdge({ ...conn, data: { user: true } }, es)) }, [setEdges, pushHistory])
  // 임시 배선 지우기 — 저장된 게 없는 화면 전용 선이라 하나씩은 바로 지우고, "모두 지우기"만 두 번 눌러 실행
  const removeUserEdge = (id) => { pushHistory(); setEdges(es => es.filter(e => !(e.data?.user && e.id === id))) }
  const clearUserEdges = () => {
    if (!clearArmed) { setClearArmed(true); return }
    setClearArmed(false)
    pushHistory()
    setEdges(es => es.filter(e => !e.data?.user))
  }

  // 2026-11-19 배선 탈부착(React Flow reconnect) — 실선(코드에서 온 배선)도 포함해 전부 끝을 잡아
  // 다른 포트로 옮기거나 빈 캔버스에 놓아 뗄 수 있다. 공식 예제와 같은 패턴(edgeReconnectSuccessful
  // ref로 성공 여부 추적, onReconnectEnd 에서 false 로 남아있으면 빈 곳에 놓인 것 — 그 선을 지운다).
  // ★ @xyflow/system 의 reconnectEdge() 헬퍼는 안 쓴다 — 그 구현이 newConnection 에서 source·target·
  // sourceHandle·targetHandle 4개만 뽑고 나머지(내가 넣으려는 data.user=true)를 버린다(실측 확인:
  // node_modules/@xyflow/system reconnectEdge 소스, `{ ...rest, id, source, target, sourceHandle,
  // targetHandle }` — rest 는 oldEdge 에서 옴, newConnection 의 추가 필드는 무시됨). 그래서 직접
  // id 를 찾아 필드만 교체한다. 재배선 결과는 data.user=true 로 표시해 "화면 전용 임시 배선"과
  // 완전히 똑같이 취급(배선 편집 패널 목록·삭제 버튼·새로고침 시 원복 전부 공용) — 절대
  // pipelineNodes.js 나 서버에 쓰지 않는다. deletable:false(실선의 키보드 삭제 방지)는 그대로
  // 유지 — 이번에 연 건 "끝을 드래그"뿐이라 실수로 선택 후 Delete 키를 누르는 사고는 안 일어난다.
  const edgeReconnectSuccessful = useRef(true)
  const onReconnectStart = useCallback(() => { edgeReconnectSuccessful.current = false; pushHistory() }, [pushHistory])
  const onReconnect = useCallback((oldEdge, newConnection) => {
    edgeReconnectSuccessful.current = true
    setEdges(es => es.map(e => e.id !== oldEdge.id ? e : {
      ...e, planned: false,
      source: newConnection.source, sourceHandle: newConnection.sourceHandle,
      target: newConnection.target, targetHandle: newConnection.targetHandle,
      data: { ...e.data, user: true },
    }))
  }, [setEdges])
  const onReconnectEnd = useCallback((_evt, edge) => {
    if (!edgeReconnectSuccessful.current) setEdges(es => es.filter(e => e.id !== edge.id))
    edgeReconnectSuccessful.current = true
  }, [setEdges])
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
      // 2026-11-19: checkup 자체 실측(checkCheckup — BGM 곡위치·구간보정이 최종본에 반영됐는지)이
      // fail·warn 이면 그걸 우선한다 — finalize 가 ok 여도 "체크업 탭 설정이 최종본엔 안 반영"은
      // 이 노드 고유의 문제다.
      if (h?.state === 'fail') return 'fail'
      const fin = healthNodes?.finalize?.state
      if (!fin || fin === 'fail') return 'idle'
      if (h?.state === 'warn') return 'warn'
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

  // 2026-11-19 상단 바 상태 알약 클릭 → 캔버스 하이라이트("연계 활성화"). highlightKey 에 따라
  // 관련 노드 id 집합을 계산 — 'worst'(파일 단선·경고·정상 알약)만 실측 상태가 필요해 여기서 계산한다.
  const highlightIds = !highlightKey ? null
    : highlightKey === 'worst' ? new Set(healthNodes ? CORE_NODE_IDS.filter(id => healthNodes[id]?.state === worst) : [])
    : new Set(HIGHLIGHT_STATIC_IDS[highlightKey] || [])
  const highlightSig = highlightIds ? [...highlightIds].sort().join(',') : ''

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
      dimmed: !!highlightIds && !highlightIds.has(def.id),
    }
  }

  useEffect(() => {
    if (!highlightIds || highlightIds.size === 0) return
    fitView({ nodes: [...highlightIds].map(id => ({ id })), padding: 0.25, duration: 300 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey, highlightSig])

  // 배선 색 = 도착(다음) 노드의 상태. 진행 중이면 흐르는 점선, 단선이면 끊어진 빨간 점선. 화면에서 그은 임시 배선은 보라.
  // 2026-11-16: planned(아직 구현 안 된 기능의 배선 계획, pipelineNodes.js inputs[].planned)은
  // 실제 가동 중인 배선과 혼동되면 안 되므로 회색 점선 + "(계획)" 라벨로 명확히 구분한다 —
  // 상태색(STATE_COLOR)·건강검진 집계(healthOf) 대상에서도 제외(실제 코드가 없으니 당연히 제외).
  // 2026-11-19(성준님 — "녹색 배선을 성격에 따라 구분"): 지금까지 정상 배선(done·partial)은 전부
  // 같은 초록이라 뭐가 뭘 나르는지 선만 보고는 몰랐다. 경고·단선·진행 중처럼 "주의가 필요한" 색은
  // 그대로 두고, 정상 배선만 포트 색(PORT_KINDS — 텍스트/이미지/영상·음성, 이미 있는 "포트 색"
  // 범례와 같은 기준)으로 세분화한다.
  const styledEdges = edges.map(e => {
    const dim = !!highlightIds && !(highlightIds.has(e.source) || highlightIds.has(e.target))
    // reconnectable: true — 실선 포함 전부 끝을 드래그해 다른 포트로 옮기거나 뗄 수 있다(위 onReconnect* 참고).
    if (e.data?.user) return { ...e, type: 'default', reconnectable: true, style: { stroke: USER_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '2 5', opacity: dim ? 0.15 : 1 } }
    if (e.planned) return { ...e, type: 'default', reconnectable: true, label: '계획', labelStyle: { fill: PLANNED_EDGE_COLOR, fontSize: 10 }, style: { stroke: PLANNED_EDGE_COLOR, strokeWidth: 1.5, strokeDasharray: '4 4', opacity: dim ? 0.1 : 0.7 } }
    const st = byId[e.target]?.state
    // 2026-11-22 교정(IG_P05 워크벤치 실측 — 성준님: "나레이션 배선이 진행됨으로 깔려있다").
    // 나레이션이 아예 없는 캐러셀(텍스트 카드만)인데 TTS→최종화 배선이 "음성"(분홍) 색으로
    // 정상/진행 중처럼 보였다. 원인: 배선 색이 "도착 노드 상태"만 보고 정해짐 — 최종화는
    // BGM·컷영상만으로도 done이 될 수 있는데, 그 done 판정이 TTS에서 온 배선까지 전부 같은
    // 색으로 덮어썼다. 소스가 health 추적 대상인데 애초에 해당 없음(health.total===0 &&
    // verified===0, 예: "나레이션 컷 없음")이면 실제로 아무것도 안 날랐다는 뜻 — 도착 노드
    // 상태와 무관하게 무조건 대기색으로 고정한다.
    const srcHealth = byId[e.source]?.health
    const srcInapplicable = !!srcHealth && srcHealth.total === 0 && srcHealth.verified === 0
    const flowing = !srcInapplicable && (st === 'done' || st === 'partial')
    const kindColor = PORT_KINDS[PORT_KIND_OF[`${e.source}.${e.sourceHandle}`]]?.color
    const color = srcInapplicable ? IDLE_COLOR : ((flowing && kindColor) || STATE_COLOR[st] || IDLE_COLOR)
    return {
      ...e, type: 'default', reconnectable: true, animated: st === 'active',
      style: { stroke: color, strokeWidth: st === 'fail' ? 2.5 : 2, strokeDasharray: st === 'fail' ? '10 8' : undefined, opacity: dim ? 0.1 : (!srcInapplicable && STATE_COLOR[st] ? 0.9 : 1) },
    }
  })

  const userEdges = edges.filter(e => e.data?.user)
  const baseEdgeCount = edges.length - userEdges.length
  // 구상 노드는 NODE_LABEL_OF/PORT_KIND_OF(둘 다 PIPELINE_NODES 기준 상수)에 없다 — 배선 편집
  // 목록에서 구상 노드가 끝인 임시 배선도 이름·점 색이 비어 보이지 않게 폴백을 추가.
  const nodeLabelOf = (id) => NODE_LABEL_OF[id] || draftNodes.find(d => d.id === id)?.label || id
  const portDotColor = (nodeId, handle) => PORT_KINDS[PORT_KIND_OF[`${nodeId}.${handle}`]]?.color || PORT_KINDS.text.color
  const panelMode = panel?.startsWith('mode:') ? RAIL_MODES.find(m => m.id === panel.slice(5)) : null

  const saveText = saveState.kind === 'saving' ? '배치 저장 중…'
    : saveState.kind === 'saved' ? `배치 저장됨 ${new Date(saveState.at).toLocaleTimeString('ko-KR', { hour12: false })}`
    : saveState.kind === 'error' ? saveState.msg : '배치: 자동(드래그하면 저장)'

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div className={s.eyebrow}>PIPELINE WORKBENCH · {epCode || '—'}</div>
        <div className={s.statusRow}>
          {/* 2026-11-19: 알약 클릭 → 관련 노드만 캔버스에서 강조("연계 활성화"). 같은 알약을 다시 누르면 해제. */}
          <StatusPill ok={flowReady?.chrome} label="Flow Chrome" onClick={() => togglePillHighlight('flow')} active={highlightKey === 'flow'} title="클릭 — 이미지·영상 생성 노드 강조" />
          <StatusPill ok={flowReady?.flowTab} label="Flow 탭" onClick={() => togglePillHighlight('flow')} active={highlightKey === 'flow'} title="클릭 — 이미지·영상 생성 노드 강조" />
          <StatusPill ok={leaderRunning} label="지휘자" neutral={leaderRunning == null} onClick={() => togglePillHighlight('leader')} active={highlightKey === 'leader'} title="클릭 — 에이전트 리더 노드 강조" />
          <StatusPill ok={flowReady?.busy} label="작업중" warn onClick={() => togglePillHighlight('flow')} active={highlightKey === 'flow'} title="클릭 — 이미지·영상 생성 노드 강조" />
          <button type="button" className={`${s.pill} ${worst === 'fail' ? s.pillFail : worst === 'warn' ? s.pillWarn : worst === 'ok' ? s.pillOk : s.pillNeutral} ${highlightKey === 'worst' ? s.pillActive : ''}`}
            onClick={() => togglePillHighlight('worst')}
            title={(health?.checkedAt ? `실측 ${new Date(health.checkedAt).toLocaleTimeString('ko-KR', { hour12: false })} · ` : '') + '클릭 — 이 상태인 노드만 강조'}>
            <span className={s.pillDot} />
            {worst === 'fail' ? '파일 단선' : worst === 'warn' ? '파일 경고' : worst === 'ok' ? '파일 정상' : '파일 실측 대기'}
          </button>
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
                    <div className={s.sideStat}><span>구상 노드</span><b>{draftNodes.length}개</b></div>
                    <p className={s.sideNote}>실제로 가동되는 노드(코드·포트·health 실측)를 추가·수정하려면 <code>src/lib/pipelineNodes.js</code> 배열을 고칩니다 — 이건 여전히 화면에서 안 만듭니다. 컨셉만 캔버스에 올려보는 "구상 노드"는 「편집」 패널의 노드 신설에서 만들 수 있습니다.</p>
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
                  <div className={s.sideLabel}>실행 취소 <span className={s.sideLabelHint}>Ctrl+Z / Ctrl+Shift+Z</span></div>
                  <div className={s.undoRow}>
                    <button className={s.toolBtn} disabled={!historyCount} onClick={undo}>⟲ 실행 취소{historyCount ? ` (${historyCount})` : ''}</button>
                    <button className={s.toolBtn} disabled={!futureCount} onClick={redo}>⟳ 다시 실행{futureCount ? ` (${futureCount})` : ''}</button>
                  </div>
                  <p className={s.sideNote}>노드 드래그·배선 연결·재배선·삭제·자동 정렬을 되돌립니다(키보드 단축키는 입력칸 밖에서만 동작). 구상 노드의 생성·삭제는 대상이 아닙니다 — 잘못 만들었으면 그 카드의 "지우기"를 쓰세요.</p>
                </div>
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
                  <p className={s.sideNote}>정상(초록) 배선도 이제 이 색으로 세분화됩니다 — 경고·단선·진행 중 배선은 기존 색을 그대로 유지합니다.</p>
                </div>
                <div className={s.sideBlock}>
                  <div className={s.sideLabel}>노드 유형 <span className={s.sideLabelHint}>카드 테두리 기본색</span></div>
                  <div className={s.legend}>
                    {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
                      <span key={k} className={s.legendItem}><span className={s.legendDot} style={{ background: CATEGORY_COLOR[k] }} />{label}</span>
                    ))}
                  </div>
                  <p className={s.sideNote}>경고·단선·진행 중일 때만 각 상태의 알림색이 이 테두리색을 덮어씁니다 — 완료·정상 여부는 카드 배지 글자로 확인하세요.</p>
                </div>
                <div className={s.sideBlock}>
                  <div className={s.sideLabel}>노드 신설 <span className={s.sideLabelHint}>구상 노드 {draftNodes.length}개</span></div>
                  <div className={s.sideWarn}>여기서 만든 노드는 아직 코드와 연결되지 않은 "구상용" 카드입니다(점선 테두리). 실제로 쓰려면 이후 <code>pipelineNodes.js</code>에 손으로 반영해야 합니다.</div>
                  <label className={s.draftFormField}>
                    <span>이름</span>
                    <input className={`${s.varInput} nodrag nopan`} value={draftLabel} onChange={e => setDraftLabel(e.target.value)} placeholder="예: 자막 QA" maxLength={60} />
                  </label>
                  <label className={s.draftFormField}>
                    <span>컨셉</span>
                    <textarea className={`${s.draftTextarea} nodrag nopan`} value={draftConcept} onChange={e => setDraftConcept(e.target.value)} placeholder="무엇을 하는 단계인지, 왜 필요한지 적어주세요" maxLength={2000} rows={3} />
                  </label>
                  <label className={s.draftFormField}>
                    <span>입력 포트(선택, 쉼표로 구분)</span>
                    <input className={`${s.varInput} nodrag nopan`} value={draftInputsText} onChange={e => setDraftInputsText(e.target.value)} placeholder="예: 원본, 설정" maxLength={200} />
                  </label>
                  <label className={s.draftFormField}>
                    <span>출력 포트(선택, 쉼표로 구분)</span>
                    <input className={`${s.varInput} nodrag nopan`} value={draftOutputsText} onChange={e => setDraftOutputsText(e.target.value)} placeholder="예: 결과" maxLength={200} />
                  </label>
                  <p className={s.sideNote}>포트를 적으면 카드 가장자리에 점이 생겨 — 다른 노드와 똑같이 끌어서 배선을 잇거나 뗄 수 있습니다(전부 화면 전용).</p>
                  <button className={s.toolBtn} disabled={!draftLabel.trim() || draftBusy} onClick={submitDraft}>
                    {draftBusy ? '올리는 중…' : '+ 워크벤치에 업로드'}
                  </button>
                  {draftError && <div className={`${s.saveState} ${s.saveStateErr}`}>{draftError}</div>}
                  {draftNodes.length > 0 && draftNodes.map(d => (
                    <div key={d.id} className={s.wireRow}>
                      <div className={s.wireEnds}>
                        <span className={s.wireEnd} title={d.concept}>{d.label}</span>
                      </div>
                      <button className={s.wireDel} onClick={() => deleteDraft(d.id)}>지우기</button>
                    </div>
                  ))}
                </div>
                <div className={s.sideBlock}>
                  <div className={s.sideLabel}>배선 편집 <span className={s.sideLabelHint}>임시 배선 {userEdges.length}개</span></div>
                  <div className={s.sideWarn}>이 배선들은 아직 저장되지 않습니다 — 새로고침하면 사라집니다. 실제 파이프라인 동작에도 영향이 없습니다(화면 표시뿐). 실선(코드에서 온 배선) 끝을 잡아 뗀 것도 여기 같이 뜹니다 — 뗀 순간부터 이 목록·삭제 버튼의 "임시 배선"으로 취급됩니다.</div>
                  {userEdges.length === 0 ? (
                    <p className={s.sideText}>임시 배선이 없습니다. 출력 플러그(카드 오른쪽 점)에서 입력 플러그(왼쪽 점)로 끌면 보라색 점선 배선이 생기고, 여기 목록에 나타납니다. 기존 실선의 끝을 잡아 다른 포트로 옮기거나 빈 캔버스에 놓아 떼도 똑같이 여기 나타납니다.</p>
                  ) : (
                    <>
                      {userEdges.map(e => (
                        <div key={e.id} className={s.wireRow}>
                          <div className={s.wireEnds}>
                            <span className={s.wireEnd} title={nodeLabelOf(e.source)}><i style={{ background: portDotColor(e.source, e.sourceHandle) }} />{e.source}.{e.sourceHandle}</span>
                            <span className={s.wireEnd} title={nodeLabelOf(e.target)}><em>→</em><i style={{ background: portDotColor(e.target, e.targetHandle) }} />{e.target}.{e.targetHandle}</span>
                          </div>
                          <button className={s.wireDel} onClick={() => removeUserEdge(e.id)}>지우기</button>
                        </div>
                      ))}
                      <button className={`${s.toolBtn} ${clearArmed ? s.toolBtnArmed : ''}`} onClick={clearUserEdges}>
                        {clearArmed ? '한 번 더 누르면 모두 지움' : '임시 배선 모두 지우기'}
                      </button>
                    </>
                  )}
                  <p className={s.sideNote}>기본 배선 {baseEdgeCount}개는 <code>pipelineNodes.js</code> 의 입력 포트 <code>from</code> 에서 자동으로 만들어집니다 — 캔버스에서 끝을 드래그해 옮기거나 뗄 수는 있지만(위 참고), 이 목록의 삭제 버튼으로 직접 지우지는 못합니다.</p>
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
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              onReconnectStart={onReconnectStart}
              onReconnect={onReconnect}
              onReconnectEnd={onReconnectEnd}
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

function StatusPill({ ok, label, warn, neutral, onClick, active, title }) {
  const cls = neutral ? s.pillNeutral : ok ? (warn ? s.pillWarnOn : s.pillOk) : s.pillOff
  return (
    <button type="button" className={`${s.pill} ${cls} ${active ? s.pillActive : ''}`} onClick={onClick} title={title}>
      <span className={s.pillDot} />
      {label}
    </button>
  )
}
