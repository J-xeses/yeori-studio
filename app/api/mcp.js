// Vercel Serverless Function — Streamable HTTP MCP 서버
// claude.ai 웹 커스텀 커넥터가 이 엔드포인트를 호출한다.
// 실제 작업은 사용자 PC의 proxy.js(server/proxy.js /api/mcp/*)가 수행하며,
// 이 함수는 Cloudflare Tunnel(MCP_BRIDGE_URL)을 통해 그쪽으로 요청을 중계만 한다.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOLS } from '../server/mcp-tools.js'

const BRIDGE_URL    = process.env.MCP_BRIDGE_URL || ''
const BRIDGE_SECRET = process.env.MCP_BRIDGE_SECRET || ''
const PUBLIC_SECRET = process.env.MCP_PUBLIC_SECRET || ''

async function bridge(method, subpath, body) {
  if (!BRIDGE_URL) throw new Error('MCP_BRIDGE_URL 환경변수 미설정 (Cloudflare Tunnel URL 필요)')
  const r = await fetch(`${BRIDGE_URL}/api/mcp${subpath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BRIDGE_SECRET}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return r.json()
}

async function executeTool(name, args) {
  switch (name) {

    case 'list_trend_episodes': {
      const data = await bridge('GET', '/trend-episodes')
      if (data.error) return `오류: ${data.error}`
      const entries = data.entries || []
      if (!entries.length) return '저장된 트렌드 에피소드 후보가 없습니다. TREND RADAR에서 📋 파이프라인 버튼을 눌러 추가하세요.'
      return entries.map((e, i) => {
        const ep = (e.episodes || []).map(ep => `  [${ep.category}] ${ep.title}\n       → ${ep.angle}`).join('\n')
        return `${i + 1}. [${e.trend.source}] ${e.trend.title} (점수: ${e.trend.score}, ${e.trend.heat})\n   생성: ${new Date(e.createdAt).toLocaleString('ko-KR')}\n${ep}`
      }).join('\n\n')
    }

    case 'create_trend_episode': {
      const data = await bridge('POST', '/trend-to-episode', args)
      if (data.error) return `오류: ${data.error}`
      const eps = (data.episodes || []).map(ep => `[${ep.category}] ${ep.title}\n  → ${ep.angle}`).join('\n')
      return `에피소드 후보 ${data.episodes?.length || 0}개 생성 완료 (누적 ${data.savedCount}건)\n\n${eps}`
    }

    case 'get_studio_state': {
      const data = await bridge('GET', '/studio-state')
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
      const data = await bridge('GET', '/list-episodes')
      const episodes = data.episodes || []
      if (!episodes.length) return '등록된 에피소드 없음'
      return episodes.map(e => {
        const code = ['IG_R','IG_P','IG_S'].includes(e.contentType)
          ? `${e.contentType}${String(e.number || 1).padStart(2,'0')}`
          : `${e.contentType || '?'}_E${String(e.number || 1).padStart(2,'0')}`
        return `[${code}] "${e.title}"  컷 ${e.cutCount}개${e.isActive ? '  ← 현재' : ''}`
      }).join('\n')
    }

    case 'export_pipeline': {
      const data = await bridge('POST', '/export-pipeline', { episodeId: args.episodeId })
      if (data.error) return `오류: ${data.error}`
      return `파이프라인 ${data.pipeline.length}개 컷 내보내기 완료\n저장 위치: ${data.savePath}\n\n` +
        data.pipeline.map(c => `CUT ${c.no}: run_g2=${c.run_g2} run_g3=${c.run_g3} run_g4=${c.run_g4 ?? '-'} run_g5=${c.run_g5}`).join('\n')
    }

    case 'run_flow_images': {
      const data = await bridge('POST', '/run-flow', { ep: args.ep, projectId: args.projectId })
      if (data.type === 'error') return `오류: ${data.message}`
      return `Flow 이미지 생성 요청 전달됨 (ep${args.ep})\n상태: ${data.message || data.type || '진행 중'}`
    }

    case 'generate_srt': {
      const data = await bridge('POST', '/generate-srt', { epNum: args.epNum })
      if (data.error) return `오류: ${data.error}`
      return `SRT 자막 생성 완료\n파일: ${data.srtPath}\n컷 수: ${data.cutCount}개 | 총 길이: ${data.totalDuration}`
    }

    case 'concat_video': {
      const data = await bridge('POST', '/concat-video', { epNum: args.epNum })
      if (data.error) return `오류: ${data.error}`
      return `영상 합치기 완료\n출력: ${data.outputPath}\n컷 수: ${data.cutCount}개 | 총 길이: ${data.totalDuration}`
    }

    default:
      return `알 수 없는 도구: ${name}`
  }
}

function buildServer() {
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
  return server
}

export default async function handler(req, res) {
  // 인증은 두 가지 경로를 모두 허용한다:
  // 1) claude.ai 커스텀 커넥터 URL에 ?key=... 형태로 직접 등록 (기존 방식)
  // 2) /authorize → /token OAuth 스텁을 거쳐 발급된 Authorization: Bearer 토큰
  //    (토큰 값 자체가 MCP_PUBLIC_SECRET이므로 아래에서 동일하게 비교)
  // 401을 반환하면 MCP 클라이언트가 이를 "OAuth 필요" 신호로 해석해 OAuth discovery를
  // 시도하다 실패("Failed to start MCP authorization")하므로, 인증 실패는 403으로 반환한다.
  const bearerToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  const authorized = !!PUBLIC_SECRET && (req.query.key === PUBLIC_SECRET || bearerToken === PUBLIC_SECRET)
  if (!authorized) {
    return res.status(403).json({ error: 'unauthorized' })
  }

  const server = buildServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}
