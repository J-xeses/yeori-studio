// Vercel Serverless Function — Streamable HTTP MCP 서버
// claude.ai 웹 커스텀 커넥터가 이 엔드포인트를 호출한다.
// 실제 작업은 사용자 PC의 proxy.js(server/proxy.js /api/mcp/*)가 수행하며,
// 이 함수는 Cloudflare Tunnel(MCP_BRIDGE_URL)을 통해 그쪽으로 요청을 중계만 한다.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOLS } from '../server/mcp-tools.js'

const EDGE_CONFIG    = process.env.EDGE_CONFIG || ''
const ENV_BRIDGE_URL = process.env.MCP_BRIDGE_URL || ''
const BRIDGE_SECRET  = process.env.MCP_BRIDGE_SECRET || ''
const PUBLIC_SECRET  = process.env.MCP_PUBLIC_SECRET || ''

// Cloudflare Quick Tunnel URL 은 재접속마다 바뀐다. 예전에는 그때마다
// MCP_BRIDGE_URL env 를 갈아끼우고 Vercel 을 재배포(~40초, 로그인 만료 시 실패)했다.
// 이제 sync-tunnel.js 가 Edge Config(`mcpBridgeUrl`)만 갱신하고(재배포 없음),
// 이 함수가 요청 시점에 Edge Config 를 읽는다. Edge Config 가 없거나 실패하면
// 기존 MCP_BRIDGE_URL env 로 폴백하므로 두 방식이 동시에 유효하다.
let _bridgeCache = { url: '', at: 0 }
async function resolveBridgeUrl() {
  const now = Date.now()
  if (_bridgeCache.url && now - _bridgeCache.at < 5000) return _bridgeCache.url
  if (EDGE_CONFIG) {
    try {
      const u = new URL(EDGE_CONFIG)
      const r = await fetch(`${u.origin}${u.pathname}/item/mcpBridgeUrl${u.search}`, {
        signal: AbortSignal.timeout(3000),
      })
      if (r.ok) {
        const val = await r.json()
        if (typeof val === 'string' && val) {
          _bridgeCache = { url: val, at: now }
          return val
        }
      }
    } catch { /* Edge Config 실패 → env 폴백 */ }
  }
  return ENV_BRIDGE_URL
}

// 터널이 재연결 중이면 이 메시지가 도구 결과로 나온다. 에이전트가 "연결 안 됨"으로
// 단정하고 기억으로 추측하지 않도록, 무엇을 해야 하는지 명확히 적는다.
const TUNNEL_DOWN_MSG = [
  '여리 스튜디오 로컬 서버에 연결하지 못했습니다 (Cloudflare 터널이 재연결 중일 수 있음).',
  '⚠️ "연결 안 됨"으로 단정하거나 기억/추측으로 답하지 마세요.',
  '조치: (1) 30~60초 뒤 같은 도구를 다시 호출 — 터널은 워치독이 자동 재연결합니다.',
  '(2) 2~3회 재시도해도 계속 실패하면 사용자에게 [PC에서 YeoriMcpTunnel 작업 상태 확인, 또는 start_yeori.bat 실행] 을 요청하세요.',
  '(3) 그때까지는 스튜디오 상태를 모른다고 답하세요.',
].join(' ')

async function bridge(method, subpath, body) {
  const BRIDGE_URL = await resolveBridgeUrl()
  if (!BRIDGE_URL) throw new Error(TUNNEL_DOWN_MSG + ' (bridge URL 미설정)')
  let r
  try {
    r = await fetch(`${BRIDGE_URL}/api/mcp${subpath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_SECRET}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    throw new Error(`${TUNNEL_DOWN_MSG} (원인: ${e.name === 'TimeoutError' ? '응답 시간 초과' : e.message})`)
  }
  // Cloudflare: 530(원본 불가) / 502·503·504(게이트웨이) = 터널/프록시 다운
  if ([502, 503, 504, 530].includes(r.status)) {
    throw new Error(`${TUNNEL_DOWN_MSG} (터널 응답 ${r.status})`)
  }
  const text = await r.text()
  try {
    return JSON.parse(text)
  } catch {
    // 프록시 대신 Cloudflare HTML 에러페이지가 온 경우
    throw new Error(`${TUNNEL_DOWN_MSG} (HTTP ${r.status}, 비정상 응답)`)
  }
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

    // ── G1~G5 스튜디오 자동화 오케스트레이션 ────────────────────
    case 'studio_set_episode': {
      const data = await bridge('POST', '/studio-set-episode', { episodeId: args.episodeId })
      if (data.error) return `오류: ${data.error}`
      return `활성 에피소드 전환 완료: ${data.episode?.title || '(제목 없음)'} (컷 ${data.cutCount}개)`
    }

    case 'studio_upload_script': {
      const data = await bridge('POST', '/studio-upload-script', args)
      if (data.error) return `오류: ${data.error}`
      return `대본 업로드 완료: ${data.cutCount}개 컷 반영됨${data.masterCode ? `\n마스터 코드: ${data.masterCode}` : ''}${data.codeMismatch ? `\n⚠️ 대본 마스터 코드가 에피소드 코드와 다릅니다 — 값은 그대로 저장됐으니 확인해주세요` : ''}`
    }

    case 'studio_approve_g1': {
      const data = await bridge('POST', '/studio-approve-g1', args)
      if (data.error) return `오류: ${data.error}`
      return `G1 승인 완료: ${data.approvedCount}개 컷`
    }

    case 'studio_run_g2': {
      const data = await bridge('POST', '/studio-run-g2', args)
      if (data.error) return `오류: ${data.error}`
      const lines = (data.results || []).map(r => r.status === 'ok'
        ? `  CUT ${r.cutNo}: ✅ ${r.file} (${r.model}, ${r.aspectRatio}${r.characters?.length ? `, ${r.characters.join('+')}` : ''}${r.refCount ? `, 참조 ${r.refCount}장` : ''}, ${r.promptChars}자)`
        : `  CUT ${r.cutNo}: ❌ ${r.error}`)
      const skip = data.skippedExisting?.length ? `\n이미 이미지 있어 제외: CUT ${data.skippedExisting.join(', ')}` : ''
      return `G2 Nano Banana 이미지: 성공 ${data.generatedCount} / 실패 ${data.failCount} (컷 간격 ${(data.gapMs||0)/1000}s)${skip}\n${lines.join('\n')}\n\n${data.note || ''}`
    }

    case 'studio_approve_g2': {
      const data = await bridge('POST', '/studio-approve-g2', args)
      if (data.error) return `오류: ${data.error}`
      return `G2 승인 완료: CUT ${data.cutNo} → ${data.selectedImage} (후보 ${data.availableImages?.length}개 중 선택)`
    }

    case 'studio_run_g3': {
      const data = await bridge('POST', '/studio-run-g3', args)
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
      const data = await bridge('POST', '/studio-approve-g3', args)
      if (data.error) return `오류: ${data.error}`
      return `G3 승인 완료: ${data.approvedCount}개 컷`
    }

    case 'studio_run_g4': {
      const data = await bridge('POST', '/studio-run-g4', args)
      if (data.error) return `오류: ${data.error}`
      if (data.type === 'error') return `오류: ${data.message}`
      return `G4 영상 생성 시작됨 (컷 ${data.requestedCuts?.join(', ')})\n상태: ${data.message || data.type || '진행 중'}`
    }

    case 'studio_approve_g4': {
      const data = await bridge('POST', '/studio-approve-g4', args)
      if (data.error) return `오류: ${data.error}`
      return `G4 승인 완료: ${data.approvedCount}개 컷`
    }

    case 'studio_run_g5': {
      const data = await bridge('POST', '/studio-run-g5', { episodeId: args.episodeId })
      if (data.error) return `오류: ${data.error}`
      return `G5 합성 완료\nSRT: ${data.srt?.srtPath}\n최종 영상: ${data.concat?.outputPath} (${data.concat?.totalDuration})`
    }

    case 'studio_get_status': {
      const data = await bridge('GET', `/studio-status${args.episodeId ? `?episodeId=${encodeURIComponent(args.episodeId)}` : ''}`)
      if (data.error) return `오류: ${data.error}`
      const s = data.summary || {}
      const rows = (data.cuts || []).map(c =>
        `CUT ${c.no}: G1${c.g1?'✅':'⬜'} G2${c.g2?'✅':'⬜'} G3${c.g3?'✅':'⬜'} G4${c.g4?'✅':'⬜'} G5${c.g5?'✅':'⬜'}` +
        ` | 이미지${c.hasImage?'✓':'✗'} 오디오${c.hasAudio?'✓':'✗'} 영상${c.hasVideo?'✓':'✗'}`
      ).join('\n')
      return `${data.episode?.title || '(제목 없음)'} (컷 ${data.cutCount}개)\n` +
        `요약 — G1:${s.g1} G2:${s.g2} G3:${s.g3} G4:${s.g4} G5:${s.g5}\n\n${rows}`
    }

    case 'import_cut_images': {
      const data = await bridge('POST', '/import-cut-images', { episodeId: args.episodeId })
      if (data.error) return `오류: ${data.error}`
      const rn = (data.renamed || []).map(r => `  ${r.from} → ${r.to}`).join('\n')
      const sk = (data.skipped || []).map(r => `  ${r.file} — ${r.reason}`).join('\n')
      return `이미지 파일명 정리: ${data.renamed?.length || 0}개 rename, ${data.skipped?.length || 0}개 스킵\n`
        + `폴더: ${data.dir}\n`
        + (rn ? `\n[정리됨]\n${rn}` : '')
        + (sk ? `\n\n[스킵]\n${sk}` : '')
    }

    case 'get_video_checklist': {
      const data = await bridge('GET', `/video-checklist${args.episodeId ? `?episodeId=${encodeURIComponent(args.episodeId)}` : ''}`)
      if (data.error) return `오류: ${data.error}`
      const s = data.summary || {}
      const rows = (data.cuts || []).filter(c => c.needsVideo).map(c => {
        const st = c.hasVideo ? `✅ ${c.savedFile} (${c.videoSource})` : (c.hasImage ? '🎬 제작 대기 (시작프레임 있음)' : '⛔ 이미지 없음')
        return `CUT ${c.no} [${c.durationTarget}s] ${st}\n    VP: ${(c.videoPrompt || '(없음)').slice(0, 90)}`
      }).join('\n')
      return `${data.episode?.title} — 영상(G4) 현황\n`
        + `정책: ${data.policy} | 영상 필요 ${s.needVideo}컷 · 완료 ${s.videoDone} · 제작대기 ${s.readyToShoot}`
        + (s.blockedNoImage?.length ? ` · 이미지없음 ${s.blockedNoImage.join(',')}` : '')
        + `\n업로드: ${data.uploadEndpoint}\n저장위치: ${data.videoDir}\n\n${rows}`
    }

    // ── 인프라 운영 도구 (2026-08-28 추가) ────────────────────────────
    case 'git_commit_push': {
      const data = await bridge('POST', '/git-commit-push', { message: args.message })
      if (!data.success) return `오류: ${data.error}`
      return `커밋+푸시 완료\n해시: ${data.commitHash}\n메시지: ${data.message}`
    }

    case 'update_status_md': {
      const data = await bridge('POST', '/update-status-md', { content: args.content })
      if (!data.success) return `오류: ${data.error}`
      return `STATUS.md 갱신 완료: ${data.path}`
    }

    case 'restart_proxy': {
      const data = await bridge('POST', '/restart-proxy', {})
      if (!data.success) return `오류: ${data.error}`
      return `proxy.js 재시작됨 (새 PID: ${data.pid})`
    }

    case 'vercel_redeploy': {
      const data = await bridge('POST', '/vercel-redeploy', {})
      if (!data.success) return `오류: ${data.error}`
      return `유비 디렉터 재배포 완료: ${data.deployUrl}`
    }

    case 'read_file': {
      const data = await bridge('POST', '/read-file', { path: args.path })
      if (!data.success) return `오류: ${data.error}`
      return data.content
    }

    // ── 메이킹 탭 GRAPHIC/CAPCUT 자동화 (2026-08-28 추가) ──────────────
    case 'make_graphic_cut': {
      const data = await bridge('POST', '/make-graphic-cut', { epNum: args.epNum, cutNo: args.cutNo, htmlFile: args.htmlFile })
      if (!data.success) return `오류: ${data.error}`
      return `컷 ${args.cutNo} 제작 완료\n영상: ${data.videoPath}`
    }

    case 'list_episode_html_sources': {
      const data = await bridge('GET', `/episode-html-sources?epNum=${encodeURIComponent(args.epNum)}`)
      if (!data.success) return `오류: ${data.error}`
      const cuts = (data.cuts || []).map(c => `CUT ${c.cutNo} [${c.cutType}] ${c.outputExists ? '✅ 산출물 있음' : '⬜ 미제작'}`).join('\n')
      const files = (data.availableHtmlFiles || []).length ? data.availableHtmlFiles.join(', ') : '(없음)'
      return `GRAPHIC/CAPCUT 컷:\n${cuts || '(없음)'}\n\n사용 가능한 커스텀 HTML: ${files}`
    }

    case 'download_broll_cut': {
      const data = await bridge('POST', '/download-broll-cut', {
        epNum: args.epNum, cutNo: args.cutNo, videoUrl: args.videoUrl, duration: args.duration,
      })
      if (!data.success) return `오류: ${data.error}`
      return `BROLL 컷 ${args.cutNo} 다운로드 완료\n영상: ${data.outputPath}\n길이: ${data.duration?.toFixed(1)}초`
    }

    case 'assemble_making_film': {
      const data = await bridge('POST', '/assemble-making-film', { epNum: args.epNum })
      if (!data.success) return `오류: ${data.error}`
      return `메이킹 필름 조립 완료: ${data.outputPath}\n포함된 컷: ${data.includedCuts?.join(', ')}\n제외된 컷: ${data.skippedCuts?.join(', ') || '없음'}\n길이: ${data.duration?.toFixed(1)}초`
    }

    case 'get_capcut_window_status': {
      const qs = new URLSearchParams()
      if (args.epNum != null) qs.set('epNum', args.epNum)
      if (args.cutNo != null) qs.set('cutNo', args.cutNo)
      const data = await bridge('GET', `/capcut-window-status?${qs}`)
      if (!data.success) return `오류: ${data.error}`
      return [
        `CapCut 실행 중: ${data.capcutRunning ? `예 (${data.windowTitle})` : '아니오'}`,
        `현재 녹화 중: ${data.isRecording ? `예 (ep${data.recordingFor?.epNum} 컷${data.recordingFor?.cutNo})` : '아니오'}`,
        data.outputPath ? `컷 산출물: ${data.outputExists ? '있음' : '없음'} (${data.outputPath})` : null,
      ].filter(Boolean).join('\n')
    }

    case 'get_capcut_screenshot': {
      const data = await bridge('GET', '/capcut-screenshot')
      if (!data.success) return `오류: ${data.error}`
      return { __image: true, data: data.data, mimeType: data.mimeType }
    }

    case 'start_capcut_recording': {
      const data = await bridge('POST', '/start-capcut-recording', {
        epNum: args.epNum, cutNo: args.cutNo, targetDuration: args.targetDuration, trimMode: args.trimMode,
      })
      if (!data.success) return `오류: ${data.error}`
      return `녹화 시작됨 (PID ${data.pid})${data.capcutWindowFound ? '' : ' — CapCut 창을 찾지 못해 전체화면으로 녹화합니다'}`
    }

    case 'stop_capcut_recording': {
      const data = await bridge('POST', '/stop-capcut-recording', {})
      if (!data.success) return `오류: ${data.error}`
      return `녹화 종료 및 편집 완료\n최종 영상: ${data.finalPath || data.path}\n길이: ${data.finalDuration ?? data.duration ?? '?'}초`
    }

    case 'launch_capcut': {
      const data = await bridge('POST', '/launch-capcut', {})
      return data.success ? data.message : `오류: ${data.message}`
    }

    case 'queue_code_task': {
      const data = await bridge('POST', '/queue-code-task', { description: args.description })
      if (!data.success) return `오류: ${data.error}`
      return `작업 큐에 등록됨 (id: ${data.id}) — 스튜디오 UI에서 승인 대기 중`
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
