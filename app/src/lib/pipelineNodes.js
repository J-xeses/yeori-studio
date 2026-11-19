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
//   external true  생산 체인 밖의 노드 — 이 저장소 밖의 별도 앱(trendRadar·agentApp, code 엔 "연결 엔드포인트"만 적는다)과
//                  전 단계를 가로지르는 지휘 레이어(pipelineLeader). gate 없음 · no 는 EX/FG/LD.
//                  헤더 알약(worst)·selftest 등 "지금 제작 파이프라인이 끊겼나" 집계에서 제외한다 — 켜져 있든 꺼져 있든,
//                  가끔 손으로 쓰는 외부 도구가 오래 안 쓰였다는 신호가 실제 제작 사고 경보와 섞이면 안 된다.
//
// 2026-11-11(2차): 성준님 지적 — ComfyUI 처럼 "전단계에서 받는 항목마다 이름 붙은 플러그에 전선이 꽂힌 모습"이어야 한다.
//   노드-노드 뭉뚱그린 선 1개 → 데이터 아이템 단위 포트(IP·VP·selectedImage·narrationMp3·rawClip·cutVideo…)로 쪼갰다.

// 플러그 점 색 = 나르는 데이터 성격. 2026-11-19: "영상·음성"을 하나로 뭉쳐 두던 media 를
// video(영상)·audio(음성)로 쪼갰다(성준님 요청 — "영상은 녹색, 음성은 분홍으로 구분"). video 는
// 노드 카드 테두리의 "핵심 제작 단계" 색(아래 CATEGORY_COLOR.core)과 같은 초록을 그대로 쓴다 —
// 의도적 재사용(둘 다 "제작 파이프라인의 핵심 산출물"이라는 결이 같다), 충돌 아님.
export const PORT_KINDS = {
  text: { label: '텍스트·기록', color: '#a8a29a' },
  image: { label: '이미지', color: '#6cb6ff' },
  video: { label: '영상', color: '#4ee6a8' },
  audio: { label: '음성', color: '#f58fc8' },
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
      // 2026-11-19 감사(누락 배선 점검): 이 포트를 받는 노드가 하나도 없다 — 그런데 정상이다.
      // /api/trend-candidates 주석(proxy.js)에 적혀 있듯, 이 파일은 "content_matrix_v3.html(별도
      // origin)과 데이터를 주고받는 파일 경유 통로"라 소비자가 또 다른 '노드'가 아니라 사람이
      // 보는 표시 화면(pipelineLeader.code 에 이미 참고로 적힌 그 HTML)이다 — agentApp.reviewLog·
      // pipelineLeader.decisionLog 와 같은 이유로 의도적으로 안 꽂는다.
      { port: 'candidates', kind: 'text', text: 'state/trend_candidates.json (후보풀로 전송 — 사람용 표시 화면이 소비, 노드 아님)' },
      { port: 'bgm', kind: 'audio', text: '_shared/bgm/{무드}/*.mp3 (BGM 레이더 다운로드)' },
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
      // 2026-11-19 감사(누락 배선 점검): scriptTxt 를 받는 노드가 하나도 없다 — 그런데 정상이다.
      // 실제 코드(proxy.js resolveEpisodeCuts)는 아래 IP·VP·narration 을 "따로 전달받는" 게
      // 아니라, 모든 다음 단계가 이 원본 .txt 파일을 직접 열어 scriptParserV3.js 로 그때그때
      // 다시 파싱한다 — 즉 이 .txt 가 유일한 실제 산출물이고, IP·VP·narration 3개 포트는 그
      // 파싱 결과를 "이미 뽑아 보여주는" 뷰일 뿐이다(파일이 하나, 의미상 갈래가 셋). 그래서
      // scriptTxt 자체를 또 다른 포트로 이어 붙이면 같은 연결의 중복이 된다 — 안 잇는 게 맞다.
      { port: 'scriptTxt', kind: 'text', text: '01_script/*.txt (실제 원본 — IP·VP·narration 은 전부 이 파일을 파싱한 결과)' },
      // 2026-11-19(성준님 — BGM 워크벤치 배선이 제작완료 이후에야 BGM을 보여주는 구조였다는 지적):
      // 대본 작성 시점에 헤더·컷별 "BGM:" 서브필드로 분위기 초안을 이미 적는다
      // (scriptParserV3.js V3_AUDIO_KEY_MAP → masterCode.audio.bgm). bgmSelect.js
      // episodeBgmBrief()가 이 문구를 태그로 변환해 후보 매칭에 쓴다 — 지금까지 그래프엔
      // 이 출발점이 전혀 없었다.
      { port: 'bgmMood', kind: 'text', text: '헤더·컷별 "BGM:" 문구(분위기 초안, tagsFromText 매칭 대상)' },
    ],
    vars: [
      { key: 'format', label: '대본 포맷', type: 'select', options: ['v8 (CT·파이프 헤더)'], value: 'v8 (CT·파이프 헤더)' },
    ],
  },
  // ── BGM 선곡(후보 큐레이션 → 최종 결정) — 2026-11-19 성준님 지적: "대본에서 분위기 초안을
  //   잡지만 후보선곡 과정을 거쳐야 하고, 최종 결정을 거쳐야 체크업·퍼블리싱으로 이어지는 게
  //   제작 흐름에 맞다"는데 지금까지 그래프엔 그 과정이 전혀 없었다 — trendRadar.bgm(원곡
  //   라이브러리)이 finalize·checkup 양쪽에 그대로 직결돼 있어서, 사람이 뭘 고르고 뭐가
  //   자동으로 정해지는지 그래프상으로는 안 보였다(실제로는 영상제작이 끝난 뒤 메이킹 탭
  //   "최종 영상 조립" 버튼 옆 BGM 드롭다운에서야 비로소 결정이 일어나는 구조였음).
  //   실제 코드 위치: 후보 큐레이션(검색·다운로드)은 메이킹 탭 자체 BGM 패널
  //   (MakingTab.jsx "BGM(배경음악) — TrendRadar 검색", /api/bgm-search·/api/bgm-download)과
  //   트렌드레이더 외부 앱 둘 다에서 같은 _shared/bgm 라이브러리(index.json)로 들어간다 — 생산자가
  //   둘이라 트렌드레이더 노드의 출력 포트(trendRadar.bgm)를 그대로 "후보 풀"로 재사용하고,
  //   여기서 새로 만들지 않는다. 최종 결정은 reelBgm 드롭다운('library'/'auto'/'none'/보유곡 직접
  //   선택, MakingTab.jsx)이 /api/reel-finalize 의 bgmFile·bgmMode 로 넘어가 reelFinalize.js가
  //   사람이 고른 곡을 쓰거나(직접 지정) bgmSelect.js의 자동 태그매칭으로 떨어진다.
  //   위치 판단: script(분위기 초안)·trendRadar(후보 풀) 둘 다를 입력으로 받으므로 depth상
  //   자연히 둘 다보다 다음 열에 놓인다(autoLayout, 좌표 수동 지정 안 함) — 대략 image/tts와
  //   같은 열, finalize보다는 한참 앞. 아직 health 실측(pipelineHealth.js)은 없음 — 코드 경로
  //   확인만 끝난 상태, 실측은 다음 단계로 미룸.
  {
    id: 'bgm', no: 'BG', icon: 'music', label: 'BGM 선곡', sub: '후보 큐레이션 → 최종 결정(메이킹 탭)', tab: 'making',
    code: [
      'src/tabs/MakingTab.jsx · BGM 패널(검색·다운로드·라이브러리) + "최종 영상 조립" BGM 드롭다운',
      'server/lib/bgmSelect.js (태그 매칭·자동 선곡·2구간 크로스페이드)',
      'server/proxy.js · /api/bgm-search · /api/bgm-download · /api/bgm-library · /api/bgm-remix',
      'server/proxy.js · /api/reel-finalize (bgmFile/bgmMode 파라미터로 결정 전달)',
    ],
    inputs: [
      { port: 'mood', kind: 'text', from: 'script.bgmMood', text: '헤더·컷별 BGM 분위기 초안(태그 매칭 대상)' },
      { port: 'candidates', kind: 'audio', from: 'trendRadar.bgm', text: '_shared/bgm 후보 풀(트렌드레이더+메이킹 탭 자체 검색 공용)' },
    ],
    outputs: [
      // 2026-11-19 감사로 정정: 체크업 미리듣기는 이 포트가 아니라 finalize.finalizeLog 를 본다
      // (아래 checkup 노드 주석 참고) — "reelFinalize 가 그대로 씀"만 맞고, 체크업 쪽 설명은 오류였다.
      { port: 'decided', kind: 'audio', text: '최종 결정(사람이 직접 고른 곡 · 자동 선곡 · 없음) — reelFinalize 가 그대로 씀' },
    ],
    vars: [
      { key: 'mode', label: 'BGM 결정 방식', type: 'select', options: ['보유 곡에서만(library)', '자동 생성 포함(auto)', '없음(none)', '직접 선택(보유곡 중)'], value: '보유 곡에서만(library)' },
    ],
  },
  {
    id: 'image', no: '02', icon: 'photo', label: '이미지 생성', sub: 'G2 · 스튜디오(Flow)', tab: 'studio', gate: 'g2', health: true, path: '02_images',
    code: ['src/tabs/StudioTab.jsx', 'scripts/flow-image.js', 'scripts/lib/flowDriver.js', 'scripts/pipeline-leader.js'],
    inputs: [
      { port: 'IP', kind: 'text', from: 'script.IP', text: '컷별 이미지 프롬프트' },
      // from 없음 = 의도적 "외부 입력"(카드에서 호버하면 "외부 입력"으로 뜬다) — characters.json 은
      // 어느 파이프라인 단계의 산출물이 아니라 사람이 미리 등록해 둔 고정 레퍼런스 파일이다.
      { port: 'charRef', kind: 'image', text: '캐릭터 레퍼런스(characters.json) — 고정 파일, 파이프라인 산출물 아님' },
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
      { port: 'narrationMp3', kind: 'audio', text: '03_audio/cut_NN_nr.mp3' },
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
      { port: 'rawClip', kind: 'video', text: '04_making/raw/cut_NN_clip_K.mp4 (Flow/Veo 원본)' },
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
      { port: 'rawClip', kind: 'video', from: 'video.rawClip', text: '원본 클립(세그 조합·트림)' },
    ],
    outputs: [
      { port: 'cutVideo', kind: 'video', text: '05_video/cut_NN.mp4 (컷 원본 — 덮어쓰기 금지)' },
    ],
    vars: [
      { key: 'trim', label: '세그 트림', type: 'select', options: ['DU 기준 자동', '수동'], value: 'DU 기준 자동' },
    ],
  },
  {
    id: 'preview', no: '06', icon: 'headphones', label: '나레이션 미리듣기', sub: '영상 탭 · 나레이션+효과음', tab: 'video', health: true, path: '06_publishing',
    code: ['src/tabs/VideoTab.jsx', 'server/lib/subtitleBurn.js', 'server/lib/reelOverrides.js'],
    inputs: [
      { port: 'cutVideo', kind: 'video', from: 'compose.cutVideo', text: '05_video/cut_NN.mp4' },
      { port: 'narrationMp3', kind: 'audio', from: 'tts.narrationMp3', text: '03_audio/cut_NN_nr.mp3' },
    ],
    outputs: [
      { port: 'previewFile', kind: 'video', text: '06_publishing/cut_NN_preview.mp4 (미리듣기 전용)' },
    ],
    vars: [
      { key: 'narrVol', label: '나레이션 음량', type: 'input', value: '100%' },
    ],
  },
  {
    id: 'finalize', no: '07', icon: 'rocket', label: '최종화', sub: 'G5 · 최종 영상 조립', tab: 'making', gate: 'g5', health: true, path: '07_output',
    code: ['server/lib/reelFinalize.js', 'server/lib/bgmSelect.js', 'server/lib/reelOverrides.js', 'server/proxy.js · /api/reel-finalize'],
    inputs: [
      { port: 'cutVideo', kind: 'video', from: 'compose.cutVideo', text: '05_video 컷 영상 전체' },
      { port: 'narrationMp3', kind: 'audio', from: 'tts.narrationMp3', text: '나레이션 음성(직접 믹스)' },
      { port: 'previewFile', kind: 'video', from: 'preview.previewFile', text: '미리듣기 결과(원본보다 최신일 때만 사용)' },
      // 2026-11-19: 이전엔 trendRadar.bgm(원곡 라이브러리)을 여기로 바로 연결해 "자동 선곡"만
      // 보이는 그림이었다 — 실제로는 bgm 노드(후보선곡·최종 결정)를 거친 결과를 쓴다. BGM
      // 결정 방식 선택(vars)도 그 노드로 옮겼다 — finalize는 이미 결정된 값을 실행만 한다.
      { port: 'bgm', kind: 'audio', from: 'bgm.decided', text: '최종 결정된 BGM(직접 지정 또는 자동 선곡)' },
    ],
    outputs: [
      { port: 'finalOutput', kind: 'video', text: '07_output/{CODE}_final.mp4' },
      { port: 'finalizeLog', kind: 'text', text: '_finalize.json (생성 기록)' },
    ],
    vars: [
      { key: 'subtitle', label: '자막 번인', type: 'select', options: ['켜기', '끄기'], value: '켜기' },
    ],
  },
  {
    id: 'checkup', no: '08', icon: 'check', label: '체크업 · 퍼블리싱', sub: '최종본 확인·업로드', tab: 'checkup', health: true, path: 'state/reel-overrides/<code>.json',
    code: ['src/tabs/CheckupTab.jsx', 'src/tabs/PublishingTab.jsx', 'server/lib/igPublish.js', 'server/lib/publishStatus.js', 'server/lib/reelOverrides.js'],
    inputs: [
      { port: 'finalOutput', kind: 'video', from: 'finalize.finalOutput', text: '07_output 최종본' },
      // 2026-11-16 계획 → 2026-11-18~19 실제 구현 완료: 체크업 탭에 BGM 미리듣기 토글(메인 영상과
      // 함께 재생) + 곡위치 슬라이더(bgmOffsetSec, 전주 건너뛰기 등 "곡의 어느 지점을 영상과 맞출지")
      // + 구간별 음량 보정(gainSegments)이 생겼다 — 둘 다 /api/reel-finalize/override로 즉시 저장되고
      // reelFinalize.js가 그 오버라이드를 읽어 실제 최종본(-ss 오프셋 + 구간 음량)에도 반영한다.
      // 더 이상 "계획"이 아니라 가동 중인 배선이라 planned 플래그를 뗐다 — 실측(pipelineHealth.js
      // checkCheckup)은 "체크업 탭에서 설정한 값이 최종본(_finalize.json 의 bgm 노트)에 실제로
      // 반영됐는가"만 대조한다(선언 vs 실제 파일 간극을 BGM 쪽에도 적용).
      // 2026-11-19 정정(누락 배선 감사 중 실제 코드로 재확인): 지난 턴엔 bgm.decided 로 배선했는데,
      // /api/checkup-bgm-preview(proxy.js)를 직접 읽어보니 그 드롭다운 상태를 전혀 보지 않는다 —
      // ①이 에피소드로 G5를 이미 한 번이라도 돌렸으면 그 finalize.finalizeLog(_finalize.json)에
      // 적힌 곡을 그대로 재사용하고(reelFinalize.js가 "재합성 때도 같은 곡 유지"하는 것과 동일
      // 우선순위), ②그마저 없을 때만 bgmSelect.selectBgm 으로 독자적으로 자동 추천한다(bgm 노드의
      // 자동 선곡과 같은 함수를 쓰지만, bgm 노드의 '현재 결정'을 참조하는 게 아니라 완전히 새로
      // 계산). 즉 진짜 입력은 bgm.decided 가 아니라 finalize.finalizeLog — "결정은 finalize 가
      // 실행되는 순간에만 기록으로 남고, 체크업은 그 기록을 본다"가 실제 데이터 흐름이다.
      { port: 'bgmPreview', kind: 'audio', from: 'finalize.finalizeLog', text: 'BGM 미리듣기 — 지난 최종본의 곡 우선 재사용, 없으면 독자 자동추천(둘 다 곡위치·구간음량 보정 반영)' },
    ],
    outputs: [
      { port: 'published', kind: 'video', text: '게시(Instagram·YouTube)' },
      { port: 'publishStatus', kind: 'text', text: 'publish-status.json' },
    ],
    vars: [
      { key: 'platform', label: '게시 대상', type: 'select', options: ['Instagram 릴스', 'YouTube 쇼츠'], value: 'Instagram 릴스' },
    ],
  },
  // ── 외부 앱 ② 에이전트 앱 = yeori-genline "Field Gate" (2026-11-12) — C:\yeori-genline (file:// 단일 HTML, 이 저장소 밖).
  //   생산 단계가 아니라 사람이 G2 이미지·G4 영상을 대본과 대조해 판정하는 "검토 사이드 노드"다. 그래서 입력만 배선한다.
  //   2026-11-12(정정): 이 노드는 "지휘체계 전체"가 아니라 그 안의 검토 에이전트 하나다 — 리더는 아래 pipelineLeader.
  //   leaderLog 출력만 예외적으로 pipelineLeader.genlineLog 에 꽂는다(둘 다 사이드 노드라 메인 생산 체인에는 끼어들지 않는다).
  //   ★ 이 노드의 outputs 를 다른 노드의 inputs[].from 으로 가리키지 말 것 — Field Gate 가 G2 선택본(/api/genline/select)을
  //     직접 쓰긴 하지만, 같은 포트(image.selectedImage)에 생산자가 둘이 되면 "입력 1개 = from 1개" 모델과 그래프가 헷갈려진다.
  {
    id: 'agentApp', no: 'FG', icon: 'review', label: '에이전트 앱 · Field Gate', sub: '외부 앱 · G2/G4 현장 검토(리더 산하 검토 에이전트)', tab: 'studio', health: true, external: true, path: '01_script/.genline-review.json',
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
      { port: 'cutVideo', kind: 'video', from: 'compose.cutVideo', text: '05_video 컷 영상(G4 검토·음성 변환)' },
    ],
    outputs: [
      { port: 'reviewLog', kind: 'text', text: '01_script/.genline-review.json (판정·IP 초안·대본 수정안)' },
      { port: 'leaderLog', kind: 'text', text: '에이전트 리더 로그 DB (Notion · 출처=genline)' },
    ],
  },
  // ── 에이전트 리더 = scripts/pipeline-leader.js (2026-11-12) — 성준님 정정: "에이전트 앱은 주요 생산 단계를 각각 점검하는
  //   에이전트와 그 에이전트의 리더로 구성된 지휘체계". Field Gate(agentApp)는 그 검토 에이전트 중 하나일 뿐이고, 진짜 리더는 이것.
  //   deriveGate() 가 매 사이클 G1→G5 전체를 스캔해 다음 액션을 정하고, shouldAutoApprove()(MAKING_AUTORUN)로 일부를 자동 승인하고,
  //   leaderLog()/leaderEpisodeSync() 로 Notion "에이전트 리더 로그"·"에피소드 파이프라인" DB 에 기록한다.
  //   = 특정 단계 하나에 붙는 노드가 아니라 script~finalize 전부를 가로질러 읽고 판단하는 상위 레이어.
  //   · external:true — 생산 체인 밖(리더가 꺼져 있어도 제작 파일은 멀쩡하다). 헤더 알약 집계에서 제외.
  //   · gateScan 입력엔 from 이 없다 — 특정 노드의 출력 포트가 아니라 studio-state.json 전체를 읽기 때문.
  //   ★ decisionLog 출력을 다른 노드의 inputs[].from 으로 가리키지 말 것 — 리더가 G2·G4 Flow 생성과 메이킹 자동실행을 실제로
  //     기동하긴 하지만(그래서 image·video 쪽 code 에 pipeline-leader.js 가 있다), 그걸 화살표로 그리면 모든 노드에 선이 꽂혀
  //     생산 흐름이 안 보인다. 영향 관계는 여기 주석과 sub 로만 설명한다.
  //   · content_matrix_v3.html 의 "에이전트 리더" 탭(7개 에이전트 카드)은 별도 지휘 주체가 아니라 이 스크립트가 하는 일을
  //     사람이 보기 좋게 그린 표시 뷰다 — 노드를 따로 만들지 않고 code 에 참고로만 적는다.
  //   실측(pipelineHealth.js checkPipelineLeader): 리더 자신의 중복실행 락파일(app/downloads/state/.pipeline-leader-<episodeId>.lock)만 본다.
  {
    id: 'pipelineLeader', no: 'LD', icon: 'conductor', label: '에이전트 리더', sub: 'pipeline-leader.js · G1~G5 전체 지휘(전 단계를 가로지르는 상위 레이어)', health: true, external: true, path: 'state/.pipeline-leader-<episodeId>.lock',
    code: [
      'scripts/pipeline-leader.js',
      'server/lib/leaderLog.js',
      'server/lib/leaderState.js',
      'server/lib/leaderRead.js',
      'content_matrix_v3.html (사람용 표시 뷰 — 실제 지휘자 아님)',
    ],
    inputs: [
      { port: 'genlineLog', kind: 'text', from: 'agentApp.leaderLog', text: 'Field Gate 현장판단(G2/G4) — 같은 리더 로그로 합류' },
      { port: 'gateScan', kind: 'text', text: '매 사이클 studio-state.json 전체 컷 g1~g5 스캔(deriveGate) — 특정 노드의 출력 포트가 아니라 전체 상태를 읽음' },
    ],
    outputs: [
      { port: 'decisionLog', kind: 'text', text: '에이전트 리더 로그(Notion) · 자동승인·블로커·사이클요약 — 다른 노드가 이걸 입력으로 받지는 않는다(사람이 Notion에서 봄)' },
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
      edges.push({ id: `${inp.from}->${d.id}.${inp.port}`, source: src.node, sourceHandle: src.port, target: d.id, targetHandle: inp.port, planned: inp.planned === true })
    }
  }
  return edges
}

// 자동 배치 — 의존관계의 최장 경로 깊이를 열(왼쪽→오른쪽)로, 같은 열 안에서는 배열 순서대로 위→아래.
// saved 에 좌표가 있는 노드는 그 좌표를 그대로 쓴다(자동 배치는 저장 안 된 노드만 채운다).
// 2026-11-12: rowH 500 → 660. 카드 실측 높이가 424~580px(포트·코드 줄이 많은 finalize·agentApp·pipelineLeader 가 550 이상)라
//   500 간격으로는 아래 행 카드가 위 카드 밑단에 겹쳤다(실측: finalize(y36·높이561) ↔ 새 노드 pipelineLeader(y547)).
export const LAYOUT = { colW: 420, rowH: 660, x0: 40, y0: 40, stepY: 80 }
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
      // 겹치면 조금씩(stepY) 아래로 — 한 행(rowH)씩 건너뛰면 이웃에서 쓸데없이 멀어진다
      for (let guard = 0; hits(pos) && guard < 400; guard++) pos = { x: pos.x, y: pos.y + LAYOUT.stepY }
      out[d.id] = pos
      placed.push(pos)
    }
  }
  return out
}
