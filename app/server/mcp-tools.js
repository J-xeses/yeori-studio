// 로컬 stdio 서버(mcp-server.js)와 원격 Streamable HTTP 서버(api/mcp.js)가
// 공유하는 도구 정의. 스키마는 두 transport가 동일해야 하므로 여기서 단일 소스로 관리한다.
export const TOOLS = [
  {
    name: 'list_trend_episodes',
    description: 'TREND RADAR에서 파이프라인으로 전송된 트렌드 에피소드 후보 목록을 최신순으로 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_trend_episode',
    description: '트렌드 정보를 바탕으로 서여리 채널 에피소드 후보 3개(LF/SF/IG_R)를 Claude가 생성합니다.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:  { type: 'string',  description: '트렌드 제목' },
        score:  { type: 'number',  description: '트렌드 점수 (0-100)' },
        source: { type: 'string',  description: '출처 (예: 유튜브 급상승, GitHub 트렌딩)' },
        heat:   { type: 'string',  description: '열기 (예: 🔥 폭발, 📈 상승)' },
      },
    },
  },
  {
    name: 'get_studio_state',
    description: '현재 여리 스튜디오의 에피소드/컷 상태, G단계 진행 현황을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_episodes',
    description: 'studio-state.json에 저장된 모든 에피소드 목록과 각 에피소드의 컷 수, 콘텐츠 유형을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'export_pipeline',
    description: 'G1 승인된 컷들의 파이프라인 JSON을 생성합니다. 각 컷의 cutType별 run_gN 플래그가 포함됩니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
      },
    },
  },
  {
    name: 'run_flow_images',
    description: 'Google Flow를 통해 에피소드 이미지(G2)를 생성합니다. SSE 스트림 대신 완료 여부만 반환합니다.',
    inputSchema: {
      type: 'object',
      required: ['ep'],
      properties: {
        ep:        { type: 'number', description: '에피소드 번호' },
        projectId: { type: 'string', description: 'Flow 프로젝트 ID (선택)' },
      },
    },
  },
  {
    name: 'generate_srt',
    description: '에피소드 오디오 파일로부터 SRT 자막 파일을 생성합니다.',
    inputSchema: {
      type: 'object',
      required: ['epNum'],
      properties: {
        epNum: { type: 'number', description: '에피소드 번호' },
      },
    },
  },
  {
    name: 'concat_video',
    description: '에피소드의 cut_NN.mp4 파일들을 순서대로 합쳐 ep{N}_raw.mp4를 생성합니다.',
    inputSchema: {
      type: 'object',
      required: ['epNum'],
      properties: {
        epNum: { type: 'number', description: '에피소드 번호' },
      },
    },
  },

  // ── G1~G5 스튜디오 자동화 오케스트레이션 ──────────────────────────
  {
    name: 'studio_set_episode',
    description: 'studio-state.json에서 지정한 에피소드를 활성 에피소드로 전환합니다. 이후 G1~G5 도구들은 이 에피소드를 대상으로 동작합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (예: ep_1784551030896)' },
      },
    },
  },
  {
    name: 'studio_upload_script',
    description: 'v3 표준 포맷 대본 파일([CUT N] + SC/SP/PL 필드 + KR(한글 컨펌본)/IP/VP 섹션)을 읽어 지정한 에피소드의 컷 데이터로 반영합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId', 'scriptPath'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
        scriptPath: { type: 'string', description: '대본 파일 경로 (절대경로 또는 app/ 기준 상대경로)' },
      },
    },
  },
  {
    name: 'studio_approve_g1',
    description: '지정한 에피소드의 전체 컷 G1(대본 확정) 승인 처리합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
      },
    },
  },
  {
    name: 'studio_run_g2',
    description: 'flow-automation.js를 호출해 Google Flow로 컷 이미지(G2)를 자동 생성합니다. 실행 시작 여부만 반환하며 실제 생성은 백그라운드에서 계속 진행됩니다(수 분~20분 이상 소요 가능).',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 이미지 프롬프트가 있는 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_approve_g2',
    description: '지정한 컷의 생성된 이미지 중 하나를 G2 승인 선택본으로 지정합니다(downloads/flow/ep{N}/에서 스캔). 이후 G4 영상 생성이 이 이미지를 스타트 프레임으로 사용합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId', 'cutId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
        cutId: { type: 'string', description: '컷 id(cut-3) 또는 컷 번호(3)' },
        imageIndex: { type: 'number', description: '생성된 이미지 중 선택할 인덱스 (기본 0)' },
      },
    },
  },
  {
    name: 'studio_run_g3',
    description: 'ElevenLabs TTS로 각 컷의 대사/나레이션 오디오(G3)를 생성해 downloads/audio/ep{N}/cut_NN.mp3로 저장합니다. studio-secrets.json에 ElevenLabs API 키가 등록되어 있어야 합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 대사/나레이션이 있는 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_approve_g3',
    description: '지정한 에피소드의 전체 컷 G3(TTS 음성) 승인 처리합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
      },
    },
  },
  {
    name: 'studio_run_g4',
    description: 'video-automation.js를 호출해 G2 승인된 이미지를 스타트 프레임으로 컷 영상(G4)을 자동 생성합니다. 실행 시작 여부만 반환하며 실제 생성은 백그라운드에서 계속 진행됩니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 G2 승인된 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_approve_g4',
    description: '지정한 에피소드의 전체 컷 G4(영상) 승인 처리합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
      },
    },
  },
  {
    name: 'studio_run_g5',
    description: '편집 메타 생성 → SRT 자막 생성 → 컷 영상들을 순서대로 FFmpeg concat하여 ep{N}_raw.mp4를 만듭니다(G5 합성).',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID' },
      },
    },
  },
  {
    name: 'studio_get_status',
    description: '지정한(또는 현재 활성) 에피소드의 컷별 G1~G5 진행 상태와 이미지/오디오/영상 산출물 존재 여부를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (생략 시 현재 활성 에피소드)' },
      },
    },
  },
]
