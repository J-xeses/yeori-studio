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
]
