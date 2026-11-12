// 파이프라인 워크벤치(모니터 탭 캔버스) 노드 정의 — 2026-11-11.
//
// ★ 노드를 추가하려면 PIPELINE_NODES 배열에 항목 하나만 넣으면 된다. 좌표는 적지 않는다 ★
//   - 배선은 각 입력 포트의 from('노드id.출력포트id' — 어느 노드의 어느 플러그에서 받는가)에서 자동으로 만들어진다(buildEdges).
//   - 위치는 저장된 배치(downloads/state/pipeline-layout.json)가 있으면 그걸 쓰고, 없는 노드는 autoLayout 이
//     의존관계 깊이(왼쪽→오른쪽)에 맞춰 자동 배치한다. 새 노드는 처음엔 자동 위치에 나타나고, 드래그하면 저장된다.
//
// 필드
//   id      노드 키. health:true 인 노드는 server/lib/pipelineHealth.js 의 nodes 키와 같아야 한다.
//   gate    이 노드 산출물을 승인하는 G포인트(카운트 표시용 보조 정보 — 상태색은 파일 실측으로만 정한다)
//   path    실측 대상 폴더(에피소드 폴더 기준)
//   code    이 단계를 실제로 수행하는 파일들(앱 루트 기준 경로)
//   inputs  [{ port, kind, text, from? }] — 입력 플러그(카드 왼쪽 가장자리 점). from:'노드id.포트id' 가 있으면 그 출력 플러그에서 전선이 꽂힌다.
//   outputs [{ port, kind, text }] — 출력 플러그(카드 오른쪽 가장자리 점)
//           port = 플러그 이름(노드 안에서 유일, React Flow Handle id 로 그대로 쓴다) · kind = PORT_KINDS 키(점 색) · text = 실제로 오가는 것
//   vars    [{ key, label, type:'select'|'input', options?, value }] — 변수 칸. 지금은 시각적 틀만(로컬 상태, 백엔드 미반영). 없어도 된다.
//   external true  이 저장소 밖의 별도 앱(trendRadar·agentApp) — code 엔 "연결 엔드포인트"만 적는다. gate 없음 · no 는 EX/FG.
//                  헤더 알약(worst)·selftest 등 "지금 제작 파이프라인이 끊겼나" 집계에서 제외한다 — 켜져 있든 꺼져 있든,
//                  가끔 손으로 쓰는 외부 도구가 오래 안 쓰였다는 신호가 실제 제작 사고 경보와 섞이면 안 된다.
//
// 2026-11-11(2차): 성준님 지적 — ComfyUI 처럼 "전단계에서 받는 항목마다 이름 붙은 플러그에 전선이 꽂힌 모습"이어야 한다.
//   노드-노드 뭉뚱그린 선 1개 → 데이터 아이템 단위 포트(IP·VP·selectedImage·narrationMp3·rawClip·cutVideo…)로 쪼갰다.

// 플러그 점 색 = 나르는 데이터 성격. 상태색(초록·노랑·빨강)·액센트(주황)·배선편집(보라)과 겹치지 않는 3종만 쓴다.
export const PORT_KINDS = {
  text: { label: '텍스트·기록', color: '#a8a29a' },
  image: { label: '이미지', color: '#6cb6ff' },
  media: { label: '영상·음성', color: '#f58fc8' },
}

export const PIPELINE_NODES = [
  // ── 외부 앱 ① 트렌드레이더 (2026-11-12) — 이 저장소 밖의 별도 앱(Next.js, localhost:3000). 대본 생성 앞단의 기획 재료 공급원.
  //   실측(pipelineHealth.js checkTrendRadar)은 "앱이 켜져 있나"가 아니라 이 앱 계열이 남기는 상태 파일의 실존·최신성만 본다.
  {
    id: 'trendRadar', no: 'EX', icon: 'radar', label: '트렌드레이더', sub: '외부 앱 · localhost:3000', tab: 'storyarchive', health: true, external: true, path: 'state/trend_*.json',
    code: [
      'localhost:3000 (별도 앱 · 이 저장소에 코드 없음)',
      'server/proxy.js · /api/trend-to-episode · /api/trend-episodes',
      'server/proxy.js · /api/trend-to-candidate · /api/trend-candidates',
      'server/proxy.js · fetchTrendData() (48시간 넘으면 웹검색 대체)',
      'server/proxy.js · /api/bgm-search · /api/bgm-download',
    ],
    inputs: [],
    outputs: [
      { port: 'trendEpisodes', kind: 'text', text: 'state/trend_episodes.json (트렌드 → 에피소드 후보)' },
      { port: 'candidates', kind: 'text', text: 'state/trend_candidates.json (후보풀로 전송)' },
      { port: 'bgm', kind: 'media', text: '_shared/bgm/{무드}/*.mp3 (BGM 레이더 다운로드)' },
    ],
  },
  {
    id: 'script', no: '01', icon: 'doc', label: '대본 생성', sub: 'G1 · 대본 확정', tab: 'script', gate: 'g1', health: true, path: '01_script',
    code: ['src/tabs/ScriptGenTab.jsx', 'server/lib/scriptParserV3.js', 'server/lib/clipPrompt.js'],
    inputs: [
      { port: 'plan', kind: 'text', from: 'trendRadar.trendEpisodes', text: '기획·후보 풀 / 붙여넣은 대본(v8 포맷)' },
    ],
    outputs: [
      { port: 'IP', kind: 'text', text: '컷별 이미지 프롬프트' },
      { port: 'VP', kind: 'text', text: '컷별 영상 프롬프트·세그 분할' },
      { port: 'narration', kind: 'text', text: '컷별 나레이션 텍스트(대사 컷 제외)' },
      { port: 'scriptTxt', kind: 'text', text: '01_script/*.txt' },
    ],
    vars: [
      { key: 'format', label: '대본 포맷', type: 'select', options: ['v8 (CT·파이프 헤더)'], value: 'v8 (CT·파이프 헤더)' },
    ],
  },
  {
    id: 'image', no: '02', icon: 'photo', label: '이미지 생성', sub: 'G2 · 스튜디오(Flow)', tab: 'studio', gate: 'g2', health: true, path: '02_images',
    code: ['src/tabs/StudioTab.jsx', 'scripts/flow-image.js', 'scripts/lib/flowDriver.js', 'scripts/pipeline-leader.js'],
    inputs: [
      { port: 'IP', kind: 'text', from: 'script.IP', text: '컷별 이미지 프롬프트' },
      { port: 'charRef', kind: 'image', text: '캐릭터 레퍼런스(characters.json)' },
    ],
    outputs: [
      { port: 'candidates', kind: 'image', text: '02_images/cut_NN_a·b.jpg (후보)' },
      { port: 'selectedImage', kind: 'image', text: 'G2 승인 선택본' },
    ],
    vars: [
      { key: 'model', label: '모델', type: 'select', options: ['Nano Banana 2', 'Nano Banana Pro'], value: 'Nano Banana 2' },
      { key: 'count', label: '컷당 장수', type: 'input', value: '2' },
    ],
  },
  {
    id: 'tts', no: '03', icon: 'speaker', label: 'TTS', sub: 'G3 · 나레이션 음성', tab: 'tts', gate: 'g3', health: true, path: '03_audio',
    code: ['src/tabs/TTSTab.jsx', 'server/lib/ttsText.js', 'src/lib/freeTts.js', 'server/lib/voiceQa.js'],
    inputs: [
      { port: 'narration', kind: 'text', from: 'script.narration', text: '컷별 나레이션 텍스트' },
    ],
    outputs: [
      { port: 'narrationMp3', kind: 'media', text: '03_audio/cut_NN_nr.mp3' },
    ],
    vars: [
      { key: 'provider', label: '음성 엔진', type: 'select', options: ['ElevenLabs', '무료(msedge-tts)'], value: 'ElevenLabs' },
      { key: 'stability', label: '안정성 / 유사도', type: 'input', value: '45 / 75' },
    ],
  },
  {
    id: 'video', no: '04', icon: 'clapper', label: '영상 생성', sub: 'Flow 원본 클립', tab: 'video', health: true, path: '04_making/raw',
    code: ['scripts/flow-submit.js', 'scripts/lib/flowDriver.js', 'server/lib/veoApi.js', 'src/lib/videoPolicy.js'],
    inputs: [
      { port: 'startFrame', kind: 'image', from: 'image.selectedImage', text: 'G2 승인 이미지(시작 프레임)' },
      { port: 'VP', kind: 'text', from: 'script.VP', text: '컷별 영상 프롬프트·세그 분할' },
    ],
    outputs: [
      { port: 'rawClip', kind: 'media', text: '04_making/raw/cut_NN_clip_K.mp4 (Flow/Veo 원본)' },
    ],
    vars: [
      { key: 'route', label: '생성 경로', type: 'select', options: ['Flow (무료)', 'Veo API (유료·긴급)'], value: 'Flow (무료)' },
      { key: 'duration', label: '생성 단위(초)', type: 'select', options: ['8', '10'], value: '8' },
    ],
  },
  {
    id: 'compose', no: '05', icon: 'layers', label: '합성 · 컷 영상', sub: 'G4 · raw → 컷 영상', tab: 'video', gate: 'g4', health: true, path: '05_video',
    code: ['src/tabs/VideoTab.jsx', 'src/tabs/MakingTab.jsx', 'server/proxy.js · /api/run-ffmpeg', 'src/lib/cutDuration.js'],
    inputs: [
      { port: 'rawClip', kind: 'media', from: 'video.rawClip', text: '원본 클립(세그 조합·트림)' },
    ],
    outputs: [
      { port: 'cutVideo', kind: 'media', text: '05_video/cut_NN.mp4 (컷 원본 — 덮어쓰기 금지)' },
    ],
    vars: [
      { key: 'trim', label: '세그 트림', type: 'select', options: ['DU 기준 자동', '수동'], value: 'DU 기준 자동' },
    ],
  },
  {
    id: 'preview', no: '06', icon: 'headphones', label: '나레이션 미리듣기', sub: '영상 탭 · 나레이션+효과음', tab: 'video', health: true, path: '06_publishing',
    code: ['src/tabs/VideoTab.jsx', 'server/lib/subtitleBurn.js', 'server/lib/reelOverrides.js'],
    inputs: [
      { port: 'cutVideo', kind: 'media', from: 'compose.cutVideo', text: '05_video/cut_NN.mp4' },
      { port: 'narrationMp3', kind: 'media', from: 'tts.narrationMp3', text: '03_audio/cut_NN_nr.mp3' },
    ],
    outputs: [
      { port: 'previewFile', kind: 'media', text: '06_publishing/cut_NN_preview.mp4 (미리듣기 전용)' },
    ],
    vars: [
      { key: 'narrVol', label: '나레이션 음량', type: 'input', value: '100%' },
    ],
  },
  {
    id: 'finalize', no: '07', icon: 'rocket', label: '최종화', sub: 'G5 · 릴스 최종본', tab: 'making', gate: 'g5', health: true, path: '07_output',
    code: ['server/lib/reelFinalize.js', 'server/lib/bgmSelect.js', 'server/lib/reelOverrides.js', 'server/proxy.js · /api/reel-finalize'],
    inputs: [
      { port: 'cutVideo', kind: 'media', from: 'compose.cutVideo', text: '05_video 컷 영상 전체' },
      { port: 'narrationMp3', kind: 'media', from: 'tts.narrationMp3', text: '나레이션 음성(직접 믹스)' },
      { port: 'previewFile', kind: 'media', from: 'preview.previewFile', text: '미리듣기 결과(원본보다 최신일 때만 사용)' },
      { port: 'bgm', kind: 'media', from: 'trendRadar.bgm', text: '_shared/bgm 라이브러리(bgmSelect.js 자동 선곡 대상)' },
    ],
    outputs: [
      { port: 'finalOutput', kind: 'media', text: '07_output/{CODE}_final.mp4' },
      { port: 'finalizeLog', kind: 'text', text: '_finalize.json (생성 기록)' },
    ],
    vars: [
      { key: 'bgm', label: 'BGM', type: 'select', options: ['자동 선곡', '직접 지정'], value: '자동 선곡' },
      { key: 'subtitle', label: '자막 번인', type: 'select', options: ['켜기', '끄기'], value: '켜기' },
    ],
  },
  {
    id: 'checkup', no: '08', icon: 'check', label: '체크업 · 퍼블리싱', sub: '최종본 확인·업로드', tab: 'checkup',
    code: ['src/tabs/CheckupTab.jsx', 'src/tabs/PublishingTab.jsx', 'server/lib/igPublish.js', 'server/lib/publishStatus.js'],
    inputs: [
      { port: 'finalOutput', kind: 'media', from: 'finalize.finalOutput', text: '07_output 최종본' },
    ],
    outputs: [
      { port: 'published', kind: 'media', text: '게시(Instagram·YouTube)' },
      { port: 'publishStatus', kind: 'text', text: 'publish-status.json' },
    ],
    vars: [
      { key: 'platform', label: '게시 대상', type: 'select', options: ['Instagram 릴스', 'YouTube 쇼츠'], value: 'Instagram 릴스' },
    ],
  },
  // ── 외부 앱 ② 에이전트 앱 = yeori-genline "Field Gate" (2026-11-12) — C:\yeori-genline (file:// 단일 HTML, 이 저장소 밖).
  //   생산 단계가 아니라 사람이 G2 이미지·G4 영상을 대본과 대조해 판정하는 "검토 사이드 노드"다. 그래서 입력만 배선한다.
  //   ★ 이 노드의 outputs 를 다른 노드의 inputs[].from 으로 가리키지 말 것 — Field Gate 가 G2 선택본(/api/genline/select)을
  //     직접 쓰긴 하지만, 같은 포트(image.selectedImage)에 생산자가 둘이 되면 "입력 1개 = from 1개" 모델과 그래프가 헷갈려진다.
  {
    id: 'agentApp', no: 'FG', icon: 'review', label: '에이전트 앱 · Field Gate', sub: '외부 앱 · G2/G4 현장 검토', tab: 'studio', health: true, external: true, path: '01_script/.genline-review.json',
    code: [
      'C:/yeori-genline/index.html (별도 앱 · 이 저장소에 코드 없음)',
      'server/proxy.js · /api/genline/cut-files (후보 조회)',
      'server/proxy.js · /api/genline/select · /api/genline/apply-ip-prompt',
      'server/proxy.js · /api/genline/generate · /api/genline/sts',
      'server/proxy.js · /api/genline-review · /api/genline-log',
      'server/lib/leaderLog.js',
    ],
    inputs: [
      { port: 'candidates', kind: 'image', from: 'image.candidates', text: '02_images 컷별 후보 이미지(G2 검토)' },
      { port: 'cutVideo', kind: 'media', from: 'compose.cutVideo', text: '05_video 컷 영상(G4 검토·음성 변환)' },
    ],
    outputs: [
      { port: 'reviewLog', kind: 'text', text: '01_script/.genline-review.json (판정·IP 초안·대본 수정안)' },
      { port: 'leaderLog', kind: 'text', text: '에이전트 리더 로그 DB (Notion · 출처=genline)' },
    ],
  },
]

// 'script.IP' → { node:'script', port:'IP' }
const parseFrom = (from) => {
  const i = String(from || '').indexOf('.')
  return i > 0 ? { node: from.slice(0, i), port: from.slice(i + 1) } : null
}

// 배선 — 입력 포트의 from 에서 자동 생성. 전선은 노드가 아니라 플러그(sourceHandle → targetHandle)에 꽂힌다.
// 존재하지 않는 노드·출력 포트를 가리키는 from 은 건너뛴다(오타가 엉뚱한 곳에 꽂히지 않게).
export function buildEdges(defs = PIPELINE_NODES) {
  const outPorts = new Set(defs.flatMap(d => (d.outputs || []).map(o => `${d.id}.${o.port}`)))
  const edges = []
  for (const d of defs) {
    for (const inp of d.inputs || []) {
      const src = parseFrom(inp.from)
      if (!src || src.node === d.id || !outPorts.has(inp.from)) continue
      edges.push({ id: `${inp.from}->${d.id}.${inp.port}`, source: src.node, sourceHandle: src.port, target: d.id, targetHandle: inp.port })
    }
  }
  return edges
}

// 자동 배치 — 의존관계의 최장 경로 깊이를 열(왼쪽→오른쪽)로, 같은 열 안에서는 배열 순서대로 위→아래.
// saved 에 좌표가 있는 노드는 그 좌표를 그대로 쓴다(자동 배치는 저장 안 된 노드만 채운다).
export const LAYOUT = { colW: 420, rowH: 500, x0: 40, y0: 40 }
export function autoLayout(defs = PIPELINE_NODES, saved = {}) {
  const byId = Object.fromEntries(defs.map(d => [d.id, d]))
  const depthMemo = {}
  const depth = (id, seen = new Set()) => {
    if (depthMemo[id] != null) return depthMemo[id]
    if (seen.has(id)) return 0   // 순환 방어
    seen.add(id)
    const froms = (byId[id]?.inputs || []).map(i => parseFrom(i.from)?.node).filter(f => f && byId[f] && f !== id)
    const v = froms.length ? Math.max(...froms.map(f => depth(f, seen))) + 1 : 0
    depthMemo[id] = v
    return v
  }
  const isSaved = (id) => { const s = saved?.[id]; return !!s && Number.isFinite(s.x) && Number.isFinite(s.y) }
  const anySaved = defs.some(d => isSaved(d.id))
  const rowsUsed = {}
  const out = {}
  const fresh = []   // 저장된 좌표가 없는 노드(= 새로 추가된 노드)
  for (const d of defs) {
    const col = depth(d.id)
    const row = rowsUsed[col] = (rowsUsed[col] ?? -1) + 1
    if (isSaved(d.id)) { out[d.id] = { x: saved[d.id].x, y: saved[d.id].y }; continue }
    out[d.id] = { x: LAYOUT.x0 + col * LAYOUT.colW, y: LAYOUT.y0 + row * LAYOUT.rowH }
    fresh.push(d)
  }
  // 2026-11-12: 사람이 드래그해 저장한 배치는 격자와 어긋나 있어서, 새 노드를 격자 자리에 그대로 두면 기존 카드 위에 겹쳐 뜬다
  // (실측: trendRadar 격자 자리 (40,40) ↔ 저장된 script (-72,41)). 저장된 배치가 하나라도 있으면 새 노드는 "배선으로 이어진
  // 저장된 이웃" 옆에 놓는다 — 받는 쪽(소비자)이 있으면 그 왼쪽 열, 없고 주는 쪽(공급자)만 있으면 그 오른쪽 열. 자리가 차 있으면 아래 행으로.
  // 저장된 배치가 전혀 없을 때(첫 실행·"자동 정렬")는 위의 격자 그대로다.
  if (anySaved) {
    const placed = defs.filter(d => isSaved(d.id)).map(d => out[d.id])
    for (const d of fresh) {
      const consumers = defs.filter(o => isSaved(o.id) && (o.inputs || []).some(i => parseFrom(i.from)?.node === d.id)).map(o => out[o.id])
      const sources = (d.inputs || []).map(i => parseFrom(i.from)?.node).filter(f => f && isSaved(f)).map(f => out[f])
      let pos = out[d.id]
      if (consumers.length) { const c = consumers.reduce((a, b) => (b.x < a.x ? b : a)); pos = { x: c.x - LAYOUT.colW, y: c.y } }
      else if (sources.length) { const c = sources.reduce((a, b) => (b.x > a.x ? b : a)); pos = { x: c.x + LAYOUT.colW, y: c.y } }
      const hits = (p) => placed.some(q => Math.abs(q.x - p.x) < LAYOUT.colW - 40 && Math.abs(q.y - p.y) < LAYOUT.rowH - 40)
      for (let guard = 0; hits(pos) && guard < 50; guard++) pos = { x: pos.x, y: pos.y + LAYOUT.rowH }
      out[d.id] = pos
      placed.push(pos)
    }
  }
  return out
}
