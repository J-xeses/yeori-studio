import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL  = 'http://localhost:3001'
const MEDIA_ROOT = 'C:\\yeori-studio'
const CODE_ROOT = 'C:\\yeori-studio\\app'

// ── HTTP 헬퍼 ──────────────────────────────────────────────────
async function api(method, endpoint, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(`${BASE_URL}${endpoint}`, opts)
  return r.json()
}

// ── 도구 정의 ──────────────────────────────────────────────────
const TOOLS = [
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

// ── 도구 실행 ──────────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {

    case 'list_trend_episodes': {
      const data = await api('GET', '/api/trend-episodes')
      const entries = data.entries || []
      if (!entries.length) return '저장된 트렌드 에피소드 후보가 없습니다. TREND RADAR에서 📋 파이프라인 버튼을 눌러 추가하세요.'
      return entries.map((e, i) => {
        const ep = (e.episodes || []).map(ep => `  [${ep.category}] ${ep.title}\n       → ${ep.angle}`).join('\n')
        return `${i + 1}. [${e.trend.source}] ${e.trend.title} (점수: ${e.trend.score}, ${e.trend.heat})\n   생성: ${new Date(e.createdAt).toLocaleString('ko-KR')}\n${ep}`
      }).join('\n\n')
    }

    case 'create_trend_episode': {
      const data = await api('POST', '/api/trend-to-episode', args)
      if (data.error) return `오류: ${data.error}`
      const eps = (data.episodes || []).map(ep =>
        `[${ep.category}] ${ep.title}\n  → ${ep.angle}`
      ).join('\n')
      return `에피소드 후보 ${data.episodes?.length || 0}개 생성 완료 (누적 ${data.savedCount}건)\n\n${eps}`
    }

    case 'get_studio_state': {
      const data = await api('GET', '/api/studio-state')
      if (!data || Object.keys(data).length === 0) return '저장된 스튜디오 상태 없음'
      const ep = data.episode || {}
      const cuts = data.cuts || []
      const g1 = Object.values(data.gData || {}).filter(v => v?.g1).length
      return [
        `현재 에피소드: ${ep.contentType || '?'} ${ep.number ? `E${String(ep.number).padStart(2,'0')}` : ''} "${ep.title || '제목 없음'}"`,
        `컷 수: ${cuts.length}개  |  G1 승인: ${g1}개`,
        `마지막 저장: ${data.savedAt || '알 수 없음'}`,
      ].join('\n')
    }

    case 'list_episodes': {
      const statePath = path.join(CODE_ROOT, 'studio-state.json')
      if (!fs.existsSync(statePath)) return 'studio-state.json 없음'
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
      const episodes = Object.values(state.episodes || {})
      if (!episodes.length) return '등록된 에피소드 없음'
      return episodes.map(ep => {
        const e = ep.episode || {}
        const code = ['IG_R','IG_P','IG_S'].includes(e.contentType)
          ? `${e.contentType}${String(e.number||1).padStart(2,'0')}`
          : `${e.contentType||'?'}_E${String(e.number||1).padStart(2,'0')}`
        return `[${code}] "${e.title || '제목 없음'}"  컷 ${(ep.cuts||[]).length}개${ep.id === state.activeEpisodeId ? '  ← 현재' : ''}`
      }).join('\n')
    }

    case 'export_pipeline': {
      const { episodeId } = args
      const statePath = path.join(CODE_ROOT, 'studio-state.json')
      if (!fs.existsSync(statePath)) return 'studio-state.json 없음'
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
      const ep = state.episodes?.[episodeId]
      if (!ep) return `에피소드 ID ${episodeId} 없음`
      const gData = state.gData || {}
      const approvedCuts = (ep.cuts || []).filter(c => gData[`cut_${c.no}`]?.g1)
      if (!approvedCuts.length) return 'G1 승인된 컷이 없습니다. 대본 생성 탭에서 G1 승인 후 다시 시도하세요.'

      const PIPE = new Set(['YEORI','BROLL','PIP','GRAPHIC','CAPCUT'])
      const getFlags = c => {
        switch (c.cutType || 'YEORI') {
          case 'BROLL':   return { run_g2:true,  run_g3:true,  g3_track:'나레이션', run_g4:true,  run_g5:true }
          case 'PIP':     return { run_g2:true,  run_g3:true,  g3_track:'대사',    run_g4:true,  run_g5:true, ...(parseInt(c.pipTarget)>0 ? {pip_target:parseInt(c.pipTarget)} : {}) }
          case 'GRAPHIC': return { run_g2:false, run_g3:true,  g3_track:'나레이션', run_g4:false, run_g5:true, g5_tool:'browser_record', ...(c.graphicTool ? {graphic_tool:c.graphicTool} : {}) }
          case 'CAPCUT':  return { run_g2:false, run_g3:false, run_g4:false, run_g5:true, g5_tool:'capcut_only' }
          default:        return { run_g2:true,  run_g3:true,  g3_track:'대사',    run_g4:true,  g4_mode:'lipsync', run_g5:true }
        }
      }

      const pipeline = approvedCuts.map(c => ({
        no: c.no, imagePrompt: c.imagePrompt || '', ...getFlags(c),
      }))
      const savePath = path.join(MEDIA_ROOT, 'downloads', 'pipeline_export.json')
      fs.writeFileSync(savePath, JSON.stringify(pipeline, null, 2), 'utf-8')

      return `파이프라인 ${pipeline.length}개 컷 내보내기 완료\n저장 위치: ${savePath}\n\n` +
        pipeline.map(c => `CUT ${c.no}: run_g2=${c.run_g2} run_g3=${c.run_g3} run_g4=${c.run_g4 ?? '-'} run_g5=${c.run_g5}`).join('\n')
    }

    case 'run_flow_images': {
      const { ep, projectId } = args
      const statePath = path.join(CODE_ROOT, 'studio-state.json')
      if (!fs.existsSync(statePath)) return 'studio-state.json 없음 — 스튜디오 앱을 먼저 실행하세요'
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
      const epData = Object.values(state.episodes || {}).find(e => e.episode?.number === ep)
      if (!epData) return `에피소드 ${ep} 없음`
      const prompts = {
        episode: ep,
        cuts: (epData.cuts || []).map(c => ({ no: c.no, imagePrompt: c.imagePrompt || '' })),
      }
      const data = await api('POST', '/api/run-flow', { ep, prompts, ...(projectId ? { projectId } : {}) })
      if (data.error) return `오류: ${data.error}`
      return `Flow 이미지 생성 시작됨 (ep${ep}, 컷 ${prompts.cuts.length}개)\n상태: ${data.message || 'SSE 스트림 진행 중'}`
    }

    case 'generate_srt': {
      const data = await api('POST', '/api/generate-srt', { epNum: args.epNum })
      if (data.error) return `오류: ${data.error}`
      return `SRT 자막 생성 완료\n파일: ${data.srtPath}\n컷 수: ${data.cutCount}개 | 총 길이: ${data.totalDuration}`
    }

    case 'concat_video': {
      const data = await api('POST', '/api/concat-video', { epNum: args.epNum })
      if (data.error) return `오류: ${data.error}`
      return `영상 합치기 완료\n출력: ${data.outputPath}\n컷 수: ${data.cutCount}개 | 총 길이: ${data.totalDuration}`
    }

    default:
      return `알 수 없는 도구: ${name}`
  }
}

// ── MCP 서버 초기화 ────────────────────────────────────────────
const server = new Server(
  { name: 'yeori-studio', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    const result = await executeTool(name, args || {})
    return { content: [{ type: 'text', text: String(result) }] }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `도구 실행 오류 (${name}): ${err.message}` }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
