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
//   vars    [{ key, label, type:'select'|'input', options?, value }] — 변수 칸. 지금은 시각적 틀만(로컬 상태, 백엔드 미반영).
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
  {
    id: 'script', no: '01', icon: '📝', label: '대본 생성', sub: 'G1 · 대본 확정', tab: 'script', gate: 'g1', health: true, path: '01_script',
    code: ['src/tabs/ScriptGenTab.jsx', 'server/lib/scriptParserV3.js', 'server/lib/clipPrompt.js'],
    inputs: [
      { port: 'plan', kind: 'text', text: '기획·후보 풀 / 붙여넣은 대본(v8 포맷)' },
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
    id: 'image', no: '02', icon: '🖼️', label: '이미지 생성', sub: 'G2 · 스튜디오(Flow)', tab: 'studio', gate: 'g2', health: true, path: '02_images',
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
    id: 'tts', no: '03', icon: '🎙️', label: 'TTS', sub: 'G3 · 나레이션 음성', tab: 'tts', gate: 'g3', health: true, path: '03_audio',
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
    id: 'video', no: '04', icon: '🎬', label: '영상 생성', sub: 'Flow 원본 클립', tab: 'video', health: true, path: '04_making/raw',
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
    id: 'compose', no: '05', icon: '🧩', label: '합성 · 컷 영상', sub: 'G4 · raw → 컷 영상', tab: 'video', gate: 'g4', health: true, path: '05_video',
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
    id: 'preview', no: '06', icon: '🎧', label: '나레이션 미리듣기', sub: '영상 탭 · 나레이션+효과음', tab: 'video', health: true, path: '06_publishing',
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
    id: 'finalize', no: '07', icon: '🏁', label: '최종화', sub: 'G5 · 릴스 최종본', tab: 'making', gate: 'g5', health: true, path: '07_output',
    code: ['server/lib/reelFinalize.js', 'server/lib/bgmSelect.js', 'server/lib/reelOverrides.js', 'server/proxy.js · /api/reel-finalize'],
    inputs: [
      { port: 'cutVideo', kind: 'media', from: 'compose.cutVideo', text: '05_video 컷 영상 전체' },
      { port: 'narrationMp3', kind: 'media', from: 'tts.narrationMp3', text: '나레이션 음성(직접 믹스)' },
      { port: 'previewFile', kind: 'media', from: 'preview.previewFile', text: '미리듣기 결과(원본보다 최신일 때만 사용)' },
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
    id: 'checkup', no: '08', icon: '📤', label: '체크업 · 퍼블리싱', sub: '최종본 확인·업로드', tab: 'checkup',
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
  const rowsUsed = {}
  const out = {}
  for (const d of defs) {
    const col = depth(d.id)
    const row = rowsUsed[col] = (rowsUsed[col] ?? -1) + 1
    const s = saved?.[d.id]
    out[d.id] = s && Number.isFinite(s.x) && Number.isFinite(s.y)
      ? { x: s.x, y: s.y }
      : { x: LAYOUT.x0 + col * LAYOUT.colW, y: LAYOUT.y0 + row * LAYOUT.rowH }
  }
  return out
}
