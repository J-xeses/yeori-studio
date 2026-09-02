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
    description: 'G1(대본 확정) 승인 처리합니다. episodeId는 반드시 현재 studio_set_episode로 전환해둔 활성 에피소드와 같아야 합니다(다르면 409 오류).',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (활성 에피소드와 일치해야 함)' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_run_g2',
    description: 'flow-automation.js를 호출해 Google Flow로 컷 이미지(G2)를 자동 생성합니다. 실행 시작 여부만 반환하며 실제 생성은 백그라운드에서 계속 진행됩니다(수 분~20분 이상 소요 가능). episodeId는 반드시 현재 활성 에피소드와 같아야 합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (활성 에피소드와 일치해야 함)' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 이미지 프롬프트가 있는 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_approve_g2',
    description: '지정한 컷의 생성된 이미지 중 하나를 G2 승인 선택본으로 지정합니다(downloads/flow/ep{N}/에서 스캔). 이후 G4 영상 생성이 이 이미지를 스타트 프레임으로 사용합니다. episodeId는 반드시 현재 활성 에피소드와 같아야 합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId', 'cutId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (활성 에피소드와 일치해야 함)' },
        cutId: { type: 'string', description: '컷 id(cut-3) 또는 컷 번호(3)' },
        imageIndex: { type: 'number', description: '생성된 이미지 중 선택할 인덱스 (기본 0)' },
      },
    },
  },
  {
    name: 'studio_run_g3',
    description: 'ElevenLabs TTS로 각 컷의 대사/나레이션 오디오(G3)를 생성해 downloads/audio/ep{N}/cut_NN.mp3로 저장합니다. studio-secrets.json에 ElevenLabs API 키가 등록되어 있어야 합니다. 대사에 섞인 괄호 안 제작 메모(예: "(음성 오버레이 — Veo3 대사 포함 금지)")는 자동 제거 후 생성하며, ElevenLabs 잔여 글자수가 필요량보다 적으면 시작 전에 오류로 막습니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (활성 에피소드와 일치해야 함)' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 대사/나레이션이 있는 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_approve_g3',
    description: 'G3(TTS 음성) 승인 처리합니다. episodeId는 반드시 현재 활성 에피소드와 같아야 합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (활성 에피소드와 일치해야 함)' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_run_g4',
    description: '[DEPRECATED 2026-09-02 — 자동 영상 생성 중단] Flow/Veo 브라우저 자동화가 벤더 UI 변경으로 반복적으로 깨져서 영상은 수동 제작으로 전환했습니다. 이 도구는 호출하지 마세요. 영상 컷은 사람이 Veo/Flow에서 직접 만든 뒤 스튜디오 "영상 만들기" 탭에서 업로드합니다. 진행 현황은 studio_get_status 또는 GET /api/episode-video-checklist를 참고하세요.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (활성 에피소드와 일치해야 함)' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 G2 승인된 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_approve_g4',
    description: 'G4(영상) 승인 처리합니다. episodeId는 반드시 현재 활성 에피소드와 같아야 합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (활성 에피소드와 일치해야 함)' },
        cutIds: { type: 'array', items: { type: 'string' }, description: '대상 컷 id 또는 번호 목록 (생략 시 전체 컷)' },
      },
    },
  },
  {
    name: 'studio_run_g5',
    description: '편집 메타 생성 → SRT 자막 생성 → 컷 영상들을 순서대로 FFmpeg concat하여 ep{N}_raw.mp4를 만듭니다(G5 합성). episodeId는 반드시 현재 활성 에피소드와 같아야 합니다.',
    inputSchema: {
      type: 'object',
      required: ['episodeId'],
      properties: {
        episodeId: { type: 'string', description: '에피소드 ID (활성 에피소드와 일치해야 함)' },
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

  // ── 인프라 운영 도구 (2026-08-28 추가) ────────────────────────────
  {
    name: 'git_commit_push',
    description: '여리 스튜디오 저장소(git 루트)에서 git add -A && commit && push origin master를 실행합니다. .env/키/시크릿 파일 등 민감해 보이는 변경사항이 포함되어 있으면 자동으로 중단합니다.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', description: '커밋 메시지' },
      },
    },
  },
  {
    name: 'update_status_md',
    description: 'STATUS.md 파일 끝에 오늘 날짜와 함께 내용을 추가합니다(append).',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: '추가할 내용' },
      },
    },
  },
  {
    name: 'restart_proxy',
    description: '로컬 proxy.js 서버를 재시작합니다. 새 프로세스를 먼저 detached로 띄운 뒤(포트 경합은 자동 재시도로 흡수) 기존 프로세스를 종료합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vercel_redeploy',
    description: '유비 디렉터(C:\\yubi-director) 프로젝트를 Vercel 프로덕션에 재배포합니다. 여리 스튜디오 자체는 이 도구의 대상이 아닙니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'read_file',
    description: 'downloads/ 또는 app/ 하위의 텍스트 파일 내용을 읽습니다(최대 2MB, 경로 탈출 차단).',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'C:\\yeori-studio 기준 상대경로, 예: downloads/foo.txt 또는 app/package.json' },
      },
    },
  },
  {
    name: 'make_graphic_cut',
    description: 'GRAPHIC 컷 또는 CAPCUT 컷(html 모드)을 HTML→헤드리스 캡처→mp4 방식으로 자동 제작합니다. htmlFile 생략 시 컷의 나레이션/장면으로 기본 검정배경+텍스트 템플릿을 자동 채웁니다.',
    inputSchema: {
      type: 'object',
      required: ['epNum', 'cutNo'],
      properties: {
        epNum: { type: 'number', description: '에피소드 번호' },
        cutNo: { type: 'number', description: '컷 번호' },
        htmlFile: { type: 'string', description: '(선택) list_episode_html_sources로 찾은 커스텀 목업 HTML 파일명. 생략하면 자동 템플릿 사용' },
      },
    },
  },
  {
    name: 'list_episode_html_sources',
    description: '에피소드의 GRAPHIC/CAPCUT 컷 목록(컷 번호·산출물 존재 여부)과, 그 에피소드 폴더에 있는 커스텀 목업 HTML 후보 파일 목록을 함께 반환합니다.',
    inputSchema: {
      type: 'object',
      required: ['epNum'],
      properties: {
        epNum: { type: 'number', description: '에피소드 번호' },
      },
    },
  },
  {
    name: 'download_broll_cut',
    description: 'Pexels 영상 직접 다운로드 URL에서 mp4를 받아 BROLL 컷 산출물로 만듭니다. duration 지정 시 앞부분만 남기고 trim한 뒤, 1080x1920 스케일+패딩(assemble_making_film과 동일 규격)으로 변환해 downloads/video/ep{N}/cut_{NN}.mp4로 저장합니다. 소스 오디오는 버립니다(BROLL 나레이션은 G3에서 별도로 얹음).',
    inputSchema: {
      type: 'object',
      required: ['epNum', 'cutNo', 'videoUrl'],
      properties: {
        epNum:    { type: 'number', description: '에피소드 번호' },
        cutNo:    { type: 'number', description: '컷 번호' },
        videoUrl: { type: 'string', description: 'Pexels 영상 직접 다운로드 URL(mp4)' },
        duration: { type: 'number', description: '(선택) 원하는 클립 길이(초). 생략 시 원본 전체 길이 사용' },
      },
    },
  },
  {
    name: 'assemble_making_film',
    description: '확정된 downloads/video/ep{N}/cut_{NN}.mp4를 컷 번호 순으로 이어붙여 메이킹 필름(ep{N}_making.mp4)을 만듭니다.',
    inputSchema: {
      type: 'object',
      properties: {
        epNum: { type: 'number', description: '에피소드 번호(생략 시 현재 활성 에피소드)' },
      },
    },
  },
  {
    name: 'get_capcut_window_status',
    description: 'CapCut 데스크톱 앱 실행 여부(전역), 현재 녹화 진행 중인지, (epNum+cutNo 지정 시) 해당 컷의 최종 영상 산출 여부를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        epNum: { type: 'number', description: '(선택) 에피소드 번호 — cutNo와 함께 줘야 산출물 확인이 됩니다' },
        cutNo: { type: 'number', description: '(선택) 컷 번호' },
      },
    },
  },
  {
    name: 'get_capcut_screenshot',
    description: 'CapCut 창의 현재 화면을 단발 스크린샷(PNG)으로 캡처해 반환합니다. 사람이 화면 앞에 없어도 녹화 진행 상황을 보고 필요시 직접 개입할 수 있게 하기 위한 용도입니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'start_capcut_recording',
    description: 'CapCut 창을 자동 감지해 화면 녹화를 시작합니다. 녹화 종료(stop_capcut_recording) 시 목표 길이로 자동 트림+세로 스케일까지 처리됩니다.',
    inputSchema: {
      type: 'object',
      required: ['epNum', 'cutNo'],
      properties: {
        epNum: { type: 'number', description: '에피소드 번호' },
        cutNo: { type: 'number', description: '컷 번호' },
        targetDuration: { type: 'number', description: '(선택) 최종 컷 목표 길이(초)' },
        trimMode: { type: 'string', enum: ['start', 'end'], description: '(선택) 목표 길이보다 길 때 앞/뒤 중 어디를 자를지, 기본 end' },
      },
    },
  },
  {
    name: 'queue_code_task',
    description: 'Claude Code(터미널 세션)가 처리해야 하는 코드 작업을 큐에 등록합니다. 즉시 실행되지 않고, 사람이 스튜디오 UI에서 승인해야 처리됩니다.',
    inputSchema: {
      type: 'object',
      required: ['description'],
      properties: {
        description: { type: 'string', description: '수행할 작업에 대한 구체적인 설명 — Claude Code가 이 설명만 보고 작업을 판단합니다' },
      },
    },
  },
  {
    name: 'launch_capcut',
    description: 'CapCut 데스크톱 앱을 실행합니다. 이미 실행 중이면 중복 실행하지 않고 그대로 성공 처리합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stop_capcut_recording',
    description: '진행 중인 CapCut 녹화를 종료하고, start_capcut_recording에서 지정한 목표 길이로 자동 트림+1080x1920 스케일해 최종 컷 영상을 만듭니다.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]
