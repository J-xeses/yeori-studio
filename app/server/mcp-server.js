import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { TOOLS } from './mcp-tools.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL  = 'http://localhost:3001'
const MEDIA_ROOT = 'C:\\yeori-studio'
const CODE_ROOT = 'C:\\yeori-studio\\app'

// ── .env.local 로드 (studio_* 도구가 /api/mcp/*(Bearer 인증 필요)를 호출하기 위해
// MCP_BRIDGE_SECRET이 필요함 — proxy.js와 동일한 파싱 방식) ──────────────
;(() => {
  const envPath = path.join(CODE_ROOT, '.env.local')
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^=\s#][^=]*)=(.*)$/)
    if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim() }
  })
})()
const MCP_BRIDGE_SECRET = process.env.MCP_BRIDGE_SECRET || ''

// ── HTTP 헬퍼 ──────────────────────────────────────────────────
// /api/mcp/* (studio_* 도구용)는 proxy.js의 requireMcpAuth로 Bearer 토큰이 필요하므로
// 항상 같이 보낸다 — 그 외 기존 엔드포인트는 인증이 없어 헤더가 있어도 무시된다.
async function api(method, endpoint, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(MCP_BRIDGE_SECRET ? { 'Authorization': `Bearer ${MCP_BRIDGE_SECRET}` } : {}),
    },
  }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(`${BASE_URL}${endpoint}`, opts)
  return r.json()
}

// ── 도구 실행 ──────────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {

    case 'list_trend_episodes': {
      const data = await api('GET', '/api/trend-episodes')
      if (data.error) return `오류: ${data.error}`
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
      if (data.error) return `오류: ${data.error}`
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

    // ── G1~G5 스튜디오 자동화 오케스트레이션 ────────────────────
    case 'studio_set_episode': {
      const data = await api('POST', '/api/mcp/studio-set-episode', { episodeId: args.episodeId })
      if (data.error) return `오류: ${data.error}`
      return `활성 에피소드 전환 완료: ${data.episode?.title || '(제목 없음)'} (컷 ${data.cutCount}개)`
    }

    case 'studio_upload_script': {
      const data = await api('POST', '/api/mcp/studio-upload-script', args)
      if (data.error) return `오류: ${data.error}`
      return `대본 업로드 완료: ${data.cutCount}개 컷 반영됨${data.masterCode ? `\n마스터 코드: ${data.masterCode}` : ''}${data.codeMismatch ? `\n⚠️ 대본 마스터 코드가 에피소드 코드와 다릅니다 — 값은 그대로 저장됐으니 확인해주세요` : ''}`
    }

    case 'studio_approve_g1': {
      const data = await api('POST', '/api/mcp/studio-approve-g1', args)
      if (data.error) return `오류: ${data.error}`
      return `G1 승인 완료: ${data.approvedCount}개 컷`
    }

    case 'studio_run_g2': {
      const data = await api('POST', '/api/mcp/studio-run-g2', args)
      if (data.error) return `오류: ${data.error}`
      if (data.type === 'error') return `오류: ${data.message}`
      return `G2 이미지 생성 시작됨 (컷 ${data.requestedCuts?.join(', ')})\n상태: ${data.message || data.type || '진행 중'}`
    }

    case 'studio_approve_g2': {
      const data = await api('POST', '/api/mcp/studio-approve-g2', args)
      if (data.error) return `오류: ${data.error}`
      return `G2 승인 완료: CUT ${data.cutNo} → ${data.selectedImage} (후보 ${data.availableImages?.length}개 중 선택)`
    }

    case 'studio_run_g3': {
      const data = await api('POST', '/api/mcp/studio-run-g3', args)
      if (data.error) return `오류: ${data.error}${data.remaining != null ? ` (잔여 ${data.remaining}자 / 필요 ${data.needed}자)` : ''}`
      const failLines = (data.results || []).filter(r => r.status === 'error')
        .map(r => `  CUT ${r.cutNo}: ${r.error}`).join('\n')
      const skipLines = (data.results || []).filter(r => r.status === 'skipped')
        .map(r => `  CUT ${r.cutNo}: 괄호 제거 후 텍스트 없음 (제거됨: ${r.removed?.join(', ')})`).join('\n')
      const noteLines = (data.results || []).filter(r => r.status === 'ok' && r.removedNotes?.length)
        .map(r => `  CUT ${r.cutNo}: 제작 메모 제거함 → ${r.removedNotes.join(', ')}`).join('\n')
      return `G3 TTS 생성 완료: 성공 ${data.generatedCount}개 / 스킵 ${data.skippedCount || 0}개 / 실패 ${data.failCount}개`
        + (failLines ? `\n${failLines}` : '') + (skipLines ? `\n${skipLines}` : '') + (noteLines ? `\n${noteLines}` : '')
    }

    case 'studio_approve_g3': {
      const data = await api('POST', '/api/mcp/studio-approve-g3', args)
      if (data.error) return `오류: ${data.error}`
      return `G3 승인 완료: ${data.approvedCount}개 컷`
    }

    case 'studio_run_g4': {
      const data = await api('POST', '/api/mcp/studio-run-g4', args)
      if (data.error) return `오류: ${data.error}`
      if (data.type === 'error') return `오류: ${data.message}`
      return `G4 영상 생성 시작됨 (컷 ${data.requestedCuts?.join(', ')})\n상태: ${data.message || data.type || '진행 중'}`
    }

    case 'studio_approve_g4': {
      const data = await api('POST', '/api/mcp/studio-approve-g4', args)
      if (data.error) return `오류: ${data.error}`
      return `G4 승인 완료: ${data.approvedCount}개 컷`
    }

    case 'studio_run_g5': {
      const data = await api('POST', '/api/mcp/studio-run-g5', { episodeId: args.episodeId })
      if (data.error) return `오류: ${data.error}`
      return `G5 합성 완료\nSRT: ${data.srt?.srtPath}\n최종 영상: ${data.concat?.outputPath} (${data.concat?.totalDuration})`
    }

    case 'studio_get_status': {
      const data = await api('GET', `/api/mcp/studio-status${args.episodeId ? `?episodeId=${encodeURIComponent(args.episodeId)}` : ''}`)
      if (data.error) return `오류: ${data.error}`
      const s = data.summary || {}
      const rows = (data.cuts || []).map(c =>
        `CUT ${c.no}: G1${c.g1?'✅':'⬜'} G2${c.g2?'✅':'⬜'} G3${c.g3?'✅':'⬜'} G4${c.g4?'✅':'⬜'} G5${c.g5?'✅':'⬜'}` +
        ` | 이미지${c.hasImage?'✓':'✗'} 오디오${c.hasAudio?'✓':'✗'} 영상${c.hasVideo?'✓':'✗'}`
      ).join('\n')
      return `${data.episode?.title || '(제목 없음)'} (컷 ${data.cutCount}개)\n` +
        `요약 — G1:${s.g1} G2:${s.g2} G3:${s.g3} G4:${s.g4} G5:${s.g5}\n\n${rows}`
    }

    // ── 인프라 운영 도구 (2026-08-28 추가) ────────────────────────────
    case 'git_commit_push': {
      const data = await api('POST', '/api/mcp/git-commit-push', { message: args.message })
      if (!data.success) return `오류: ${data.error}`
      return `커밋+푸시 완료\n해시: ${data.commitHash}\n메시지: ${data.message}`
    }

    case 'update_status_md': {
      const data = await api('POST', '/api/mcp/update-status-md', { content: args.content })
      if (!data.success) return `오류: ${data.error}`
      return `STATUS.md 갱신 완료: ${data.path}`
    }

    case 'restart_proxy': {
      const data = await api('POST', '/api/mcp/restart-proxy', {})
      if (!data.success) return `오류: ${data.error}`
      return `proxy.js 재시작됨 (새 PID: ${data.pid})`
    }

    case 'vercel_redeploy': {
      const data = await api('POST', '/api/mcp/vercel-redeploy', {})
      if (!data.success) return `오류: ${data.error}`
      return `유비 디렉터 재배포 완료: ${data.deployUrl}`
    }

    case 'read_file': {
      const data = await api('POST', '/api/mcp/read-file', { path: args.path })
      if (!data.success) return `오류: ${data.error}`
      return data.content
    }

    // ── 메이킹 탭 GRAPHIC/CAPCUT 자동화 (2026-08-28 추가) ──────────────
    case 'make_graphic_cut': {
      const data = await api('POST', '/api/mcp/make-graphic-cut', { epNum: args.epNum, cutNo: args.cutNo, htmlFile: args.htmlFile })
      if (!data.success) return `오류: ${data.error}`
      return `컷 ${args.cutNo} 제작 완료\n영상: ${data.videoPath}`
    }

    case 'list_episode_html_sources': {
      const data = await api('GET', `/api/mcp/episode-html-sources?epNum=${encodeURIComponent(args.epNum)}`)
      if (!data.success) return `오류: ${data.error}`
      const cuts = (data.cuts || []).map(c => `CUT ${c.cutNo} [${c.cutType}] ${c.outputExists ? '✅ 산출물 있음' : '⬜ 미제작'}`).join('\n')
      const files = (data.availableHtmlFiles || []).length ? data.availableHtmlFiles.join(', ') : '(없음)'
      return `GRAPHIC/CAPCUT 컷:\n${cuts || '(없음)'}\n\n사용 가능한 커스텀 HTML: ${files}`
    }

    case 'download_broll_cut': {
      const data = await api('POST', '/api/mcp/download-broll-cut', {
        epNum: args.epNum, cutNo: args.cutNo, videoUrl: args.videoUrl, duration: args.duration,
      })
      if (!data.success) return `오류: ${data.error}`
      return `BROLL 컷 ${args.cutNo} 다운로드 완료\n영상: ${data.outputPath}\n길이: ${data.duration?.toFixed(1)}초`
    }

    case 'assemble_making_film': {
      const data = await api('POST', '/api/mcp/assemble-making-film', { epNum: args.epNum })
      if (!data.success) return `오류: ${data.error}`
      return `메이킹 필름 조립 완료: ${data.outputPath}\n포함된 컷: ${data.includedCuts?.join(', ')}\n제외된 컷: ${data.skippedCuts?.join(', ') || '없음'}\n길이: ${data.duration?.toFixed(1)}초`
    }

    case 'get_capcut_window_status': {
      const qs = new URLSearchParams()
      if (args.epNum != null) qs.set('epNum', args.epNum)
      if (args.cutNo != null) qs.set('cutNo', args.cutNo)
      const data = await api('GET', `/api/mcp/capcut-window-status?${qs}`)
      if (!data.success) return `오류: ${data.error}`
      return [
        `CapCut 실행 중: ${data.capcutRunning ? `예 (${data.windowTitle})` : '아니오'}`,
        `현재 녹화 중: ${data.isRecording ? `예 (ep${data.recordingFor?.epNum} 컷${data.recordingFor?.cutNo})` : '아니오'}`,
        data.outputPath ? `컷 산출물: ${data.outputExists ? '있음' : '없음'} (${data.outputPath})` : null,
      ].filter(Boolean).join('\n')
    }

    case 'get_capcut_screenshot': {
      const data = await api('GET', '/api/mcp/capcut-screenshot')
      if (!data.success) return `오류: ${data.error}`
      return { __image: true, data: data.data, mimeType: data.mimeType }
    }

    case 'start_capcut_recording': {
      const data = await api('POST', '/api/mcp/start-capcut-recording', {
        epNum: args.epNum, cutNo: args.cutNo, targetDuration: args.targetDuration, trimMode: args.trimMode,
      })
      if (!data.success) return `오류: ${data.error}`
      return `녹화 시작됨 (PID ${data.pid})${data.capcutWindowFound ? '' : ' — CapCut 창을 찾지 못해 전체화면으로 녹화합니다'}`
    }

    case 'stop_capcut_recording': {
      const data = await api('POST', '/api/mcp/stop-capcut-recording', {})
      if (!data.success) return `오류: ${data.error}`
      return `녹화 종료 및 편집 완료\n최종 영상: ${data.finalPath || data.path}\n길이: ${data.finalDuration ?? data.duration ?? '?'}초`
    }

    case 'launch_capcut': {
      const data = await api('POST', '/api/mcp/launch-capcut', {})
      return data.success ? data.message : `오류: ${data.message}`
    }

    case 'queue_code_task': {
      const data = await api('POST', '/api/mcp/queue-code-task', { description: args.description })
      if (!data.success) return `오류: ${data.error}`
      return `작업 큐에 등록됨 (id: ${data.id}) — 스튜디오 UI에서 승인 대기 중`
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
    if (result && typeof result === 'object' && result.__image) {
      return { content: [{ type: 'image', data: result.data, mimeType: result.mimeType }] }
    }
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
