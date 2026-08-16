import express from 'express'
import cors from 'cors'
import { spawn, execSync, execFileSync } from 'child_process'
import { createWriteStream } from 'fs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { isV3Format, parseCutsV3, parseV3GlobalHeader, pipelineCodeToInstaContent } from './lib/scriptParserV3.js'
import { resolveEpisodeCode } from './lib/episodeCode.js'
import { instaDir, INSTA_SUBDIR, scriptDir, deliverablesDir } from './lib/mediaPaths.js'
import { getUsedCount, recordUsage } from './lib/creditUsage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CODE_ROOT = 'C:\\yeori-studio\\app'
const MEDIA_ROOT = 'C:\\yeori-studio'
const ROOT = CODE_ROOT  // 하위 호환 유지

// ── 종료/에러 로그 (콘솔 창이 그냥 닫혀버리면 사후 확인할 방법이 없어서 추가) ──
const LOG_PATH = path.join(MEDIA_ROOT, 'logs', 'proxy.log')
function logToFile(line) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`, 'utf-8')
  } catch { /* 로그 기록 실패는 무시 -- 로그 때문에 서버가 죽으면 안 됨 */ }
}

if (!fs.existsSync(path.join(CODE_ROOT, 'package.json'))) {
  const msg = `[ERROR] CODE_ROOT 경로를 찾을 수 없습니다: ${CODE_ROOT}`
  console.error(msg)
  logToFile(`FATAL ${msg}`)
  process.exit(1)
}
console.log(`[CODE_ROOT] ${CODE_ROOT}`)
logToFile('--- proxy 시작 ---')

// ── .env.local 로드 (CODE_ROOT 기준) ──────────────────────────
;(() => {
  const envPath = path.join(CODE_ROOT, '.env.local')
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^=\s#][^=]*)=(.*)$/)
    if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim() }
  })
})()
const ANTHROPIC_API_KEY = process.env.VITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || ''
const MCP_BRIDGE_SECRET = process.env.MCP_BRIDGE_SECRET || ''

const app = express()
const PORT = 3001

// Node.js 18+에서 unhandledRejection이 프로세스를 종료하지 않도록 처리
process.on('unhandledRejection', (reason) => {
  console.error('[proxy] unhandledRejection:', reason)
  logToFile(`unhandledRejection: ${reason?.stack || reason}`)
})
process.on('uncaughtException', (err) => {
  console.error('[proxy] uncaughtException:', err.message)
  logToFile(`uncaughtException: ${err?.stack || err?.message || err}`)
})
// 정상 종료 외의 경로(외부에서 taskkill, 콘솔 창 닫힘 등)로 프로세스가 사라지는 경우를
// 구분하기 위해 signal/exit도 기록한다 -- 콘솔 창이 흔적 없이 닫혀버리는 문제 진단용.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    logToFile(`신호 수신: ${sig} -- 종료`)
    process.exit(0)
  })
}
process.on('exit', (code) => {
  logToFile(`--- proxy 종료 (code ${code}) ---`)
})

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000', 'null'] }))
app.use(express.json({ limit: '10mb' }))
app.use('/downloads', express.static(path.join(MEDIA_ROOT, 'downloads')))

// ── 헬스 체크 ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Claude API 프록시 ───────────────────────────────────────
// Express 5: 와일드카드는 *path 형태로 명명해야 함
app.post('/api/claude/*path', async (req, res) => {
  const apiKey = req.headers['x-api-key']
  if (!apiKey) {
    return res.status(401).json({
      error: { message: '상단 API 바에서 Claude 키를 입력하세요.' },
    })
  }

  // req.params.path = 'v1/messages' 등 나머지 경로
  const upstreamPath = Array.isArray(req.params.path)
    ? req.params.path.join('/')
    : req.params.path
  const targetUrl = `https://api.anthropic.com/${upstreamPath}`

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': req.headers['anthropic-version'] ?? '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })
    const data = await upstream.json()
    res.status(upstream.status).json(data)
  } catch (err) {
    console.error('[proxy] Claude 오류:', err.message)
    res.status(502).json({ error: { message: `프록시 오류: ${err.message}` } })
  }
})

// ── ElevenLabs 유저 정보 (키 유효성 검사 + 잔여 글자 수) ──
app.get('/api/elevenlabs/user', async (req, res) => {
  const apiKey = req.headers['xi-api-key']
  if (!apiKey) return res.status(401).json({ error: 'API 키 없음' })
  try {
    const upstream = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    })
    const body = await upstream.json()
    if (!upstream.ok) {
      console.error('[proxy] ElevenLabs /v1/user 오류:', upstream.status, JSON.stringify(body))
    }
    res.status(upstream.status).json(body)
  } catch (err) {
    console.error('[proxy] ElevenLabs fetch 실패:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// ── ElevenLabs TTS ──────────────────────────────────────────
app.post('/api/elevenlabs/text-to-speech/:voiceId', async (req, res) => {
  const apiKey = req.headers['xi-api-key']
  if (!apiKey) return res.status(401).json({ error: 'API 키 없음' })
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${req.params.voiceId}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(req.body),
      }
    )
    if (!upstream.ok) {
      return res.status(upstream.status).json(await upstream.json())
    }
    res.set('content-type', 'audio/mpeg')
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── FFmpeg 실행 헬퍼 ──────────────────────────────────────────────
function runFFmpegCmd(args, logPath) {
  return new Promise(resolve => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const logStream = logPath ? createWriteStream(logPath) : null
    proc.stderr.on('data', d => logStream?.write(d))
    proc.on('close', code => { logStream?.end(); resolve(code) })
    proc.on('error', () => { logStream?.end(); resolve(1) })
  })
}

// ── POST /api/ffmpeg — SSE 스트리밍 자동 편집 ─────────────────────
app.post('/api/ffmpeg', async (req, res) => {
  const { meta, workDir } = req.body
  if (!Array.isArray(meta) || !meta.length)
    return res.status(400).json({ error: 'meta 배열이 필요합니다' })

  // workDir: 절대 경로 또는 ROOT 기준 상대 경로
  const dir = path.isAbsolute(workDir ?? '') ? workDir : path.join(ROOT, workDir || '')

  // SSE 헤더
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const outputDir = path.join(dir, 'output_final')
    fs.mkdirSync(outputDir, { recursive: true })
    const results = []

    for (let i = 0; i < meta.length; i++) {
      const m = meta[i]
      const cutNum = String(m.cutNo).padStart(2, '0')
      send({ type: 'progress', current: i + 1, total: meta.length, label: m.label || `CUT ${cutNum}` })

      const videoFile = path.join(dir, `cut_${cutNum}.mp4`)
      const outFile   = path.join(outputDir, `C${cutNum}_final.mp4`)
      const logFile   = path.join(outputDir, `C${cutNum}_ffmpeg.log`)
      const dur       = parseFloat(m.duration)

      let args
      if (m.sfxOnly || !m.audioFile) {
        args = ['-i', videoFile, '-c:v', 'copy', '-an', outFile, '-y']
      } else {
        const audioFile  = path.isAbsolute(m.audioFile) ? m.audioFile : path.join(dir, m.audioFile)
        const delay      = parseFloat(m.audioStart) || 0
        const audioEnd   = parseFloat(m.audioEnd) || dur
        const audioDur   = Math.max(0.01, audioEnd - delay)
        const delayMs    = Math.round(delay * 1000)
        // 원칙: 음성 길이 = 영상 길이 (adelay 패딩 + apad)
        const filter = delay > 0
          ? `[1:a]atrim=duration=${audioDur},adelay=${delayMs}|${delayMs},apad=whole_dur=${dur}[a]`
          : `[1:a]atrim=duration=${audioDur},apad=whole_dur=${dur}[a]`
        args = [
          '-i', videoFile, '-i', audioFile,
          '-filter_complex', filter,
          '-map', '0:v', '-map', '[a]',
          '-t', String(dur), outFile, '-y',
        ]
      }

      const code = await runFFmpegCmd(args, logFile)
      if (code === 0) {
        results.push({ cutNo: cutNum, file: `C${cutNum}_final.mp4`, status: 'ok' })
        send({ type: 'cut_done', cutNo: cutNum, label: m.label || `CUT ${cutNum}` })
      } else {
        results.push({ cutNo: cutNum, status: 'error', log: `output_final/C${cutNum}_ffmpeg.log` })
        send({ type: 'cut_error', cutNo: cutNum, label: m.label || `CUT ${cutNum}`, log: `output_final/C${cutNum}_ffmpeg.log` })
      }
    }

    send({ type: 'done', outputDir: path.relative(ROOT, outputDir).replace(/\\/g, '/'), results })
  } catch (err) {
    send({ type: 'error', message: err.message })
  }

  res.end()
})

// ── POST /api/update-env — .env.local 특정 키 업데이트 ──────────
app.post('/api/update-env', (req, res) => {
  const { updates } = req.body
  const envPath = path.join(ROOT, '.env.local')
  try {
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
    for (const [key, value] of Object.entries(updates || {})) {
      const regex = new RegExp(`^${key}=.*$`, 'm')
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`)
      } else {
        content += (content.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`
      }
    }
    fs.writeFileSync(envPath, content, 'utf-8')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/studio-data ─────────────────────────────────────────
app.get('/api/studio-data', (req, res) => {
  const dataPath = path.join(ROOT, 'data', 'studio-data.json')
  try {
    if (fs.existsSync(dataPath)) {
      res.json(JSON.parse(fs.readFileSync(dataPath, 'utf-8')))
    } else {
      res.json({})
    }
  } catch {
    res.json({})
  }
})

// ── POST /api/studio-data ────────────────────────────────────────
app.post('/api/studio-data', (req, res) => {
  const dataDir  = path.join(ROOT, 'data')
  const dataPath = path.join(dataDir, 'studio-data.json')
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(dataPath, JSON.stringify(req.body, null, 2), 'utf-8')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/studio-state — 회사/집 PC 간 동기화되는 상태 (app/studio-state.json, git 동기화) ──
// apiKeys 등 시크릿은 studio-secrets.json(gitignore 대상, OneDrive 동기화)에 별도 보관 후 병합해서 내려줌
app.get('/api/studio-state', (req, res) => {
  const statePath   = path.join(CODE_ROOT, 'studio-state.json')
  const secretsPath = path.join(CODE_ROOT, 'studio-secrets.json')
  try {
    const state   = fs.existsSync(statePath)   ? JSON.parse(fs.readFileSync(statePath, 'utf-8'))   : {}
    const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) : {}
    res.json({ ...state, ...secrets })
  } catch {
    res.json({})
  }
})

// ── GET /api/elevenlabs-key — content_matrix_v3.html 등 다른 오리진에서 ElevenLabs 키 조회 ──
// (studio-secrets.json은 gitignore 대상이라 이 서버를 경유해야만 읽을 수 있음)
app.get('/api/elevenlabs-key', (req, res) => {
  const secretsPath = path.join(CODE_ROOT, 'studio-secrets.json')
  try {
    const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) : {}
    res.json({ key: secrets.apiKeys?.elevenLabs || '' })
  } catch {
    res.json({ key: '' })
  }
})

// ── GET /api/claude-key — content_matrix_v3.html 등 다른 오리진에서 Claude 키 조회 ──
app.get('/api/claude-key', (req, res) => {
  const secretsPath = path.join(CODE_ROOT, 'studio-secrets.json')
  try {
    const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) : {}
    res.json({ key: secrets.apiKeys?.claude || '' })
  } catch {
    res.json({ key: '' })
  }
})

// ── POST /api/studio-state ───────────────────────────────────────
app.post('/api/studio-state', (req, res) => {
  const statePath   = path.join(CODE_ROOT, 'studio-state.json')
  const secretsPath = path.join(CODE_ROOT, 'studio-secrets.json')
  try {
    const { apiKeys, ...state } = req.body
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8')
    if (apiKeys) {
      fs.writeFileSync(secretsPath, JSON.stringify({ apiKeys }, null, 2), 'utf-8')
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/update-status — STATUS.md 자동 갱신 (scripts/update-status.js 실행) ──
app.post('/api/update-status', (req, res) => {
  const scriptPath = path.join(CODE_ROOT, 'scripts', 'update-status.js')
  try {
    const output = execSync(`node "${scriptPath}"`, { cwd: CODE_ROOT, env: process.env, encoding: 'utf-8' })
    const result = JSON.parse(output)
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.stderr?.toString() || err.message })
  }
})

// ── GET /api/codebook — codebook.json 읽기전용 서빙 ──────────────
// code_generator_v1.html(Codi_GEN, file:// 정적 파일이라 codebook.json을 직접
// import할 수 없음)이 컷 설계 탭의 SP/SH/CA/MD/AT/LOOK_ID 필드를 실제 코드북
// 기준으로 그리기 위해 fetch로 가져다 씀. script_generator.py와 동일한 파일을
// 그대로 반환하므로 두 쪽이 항상 같은 코드 정의를 보게 된다.
app.get('/api/codebook', (req, res) => {
  const codebookPath = path.join(CODE_ROOT, 'scripts', 'codebook.json')
  try {
    const codebook = JSON.parse(fs.readFileSync(codebookPath, 'utf-8'))
    res.json({ ok: true, codebook })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/generate-script — 마스터 코드 -> script_generator.py -> script_to_prompts.py -> prompts.json ──
app.post('/api/generate-script', (req, res) => {
  const { code } = req.body
  if (!code || !code.trim()) return res.status(400).json({ ok: false, error: '마스터 코드가 필요합니다' })

  const scriptsDir = path.join(CODE_ROOT, 'scripts')
  const tmpCodePath = path.join(scriptsDir, '.tmp_master_code.txt')
  const generatorPath = path.join(scriptsDir, 'script_generator.py')
  const converterPath = path.join(scriptsDir, 'script_to_prompts.py')

  try {
    fs.writeFileSync(tmpCodePath, code, 'utf-8')

    const genOut = execFileSync('python', [generatorPath, '--file', tmpCodePath], {
      cwd: scriptsDir, encoding: 'utf-8',
    })
    const m = genOut.match(/\[완료\]\s*(.+_script\.txt)/)
    if (!m) throw new Error(`script_generator.py 출력에서 결과 파일을 찾지 못했습니다: ${genOut}`)
    const scriptTxtName = path.basename(m[1].trim())

    const convOut = execFileSync('python', [converterPath, '--file', scriptTxtName], {
      cwd: scriptsDir, encoding: 'utf-8',
    })

    const promptsPath = path.join(MEDIA_ROOT, 'downloads', 'flow', 'prompts.json')
    const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'))

    // script.txt 상단 SCRIPT META 헤더를 파싱해 함께 반환 (ScriptGenTab.jsx가 "실제 적용" 시
    // /api/update-script-history 호출에 재사용 — 버전/날짜/상태를 다시 계산하지 않고 그대로 사용)
    let meta = null
    const scriptTxtPath = path.join(CODE_ROOT, 'scripts_output', scriptTxtName)
    if (fs.existsSync(scriptTxtPath)) {
      const scriptContent = fs.readFileSync(scriptTxtPath, 'utf-8')
      const metaMatch = scriptContent.match(
        /# SCRIPT META\r?\n# EPISODE:\s*(.+?)\r?\n# VERSION:\s*(.+?)\r?\n# DATE:\s*(.+?)\r?\n# STATUS:\s*(.+?)\r?\n# CHANGES:\s*(.+?)\r?\n# CUTS:\s*(.+?)\r?\n/
      )
      if (metaMatch) {
        meta = {
          episode: metaMatch[1].trim(),
          version: metaMatch[2].trim(),
          date: metaMatch[3].trim(),
          status: metaMatch[4].trim(),
          changes: metaMatch[5].trim(),
          cuts: parseInt(metaMatch[6].trim(), 10),
        }
      }
    }

    res.json({ ok: true, prompts, meta, generatorLog: genOut, converterLog: convOut })
  } catch (err) {
    const detail = err.stderr?.toString() || err.stdout?.toString() || err.message
    console.error('[generate-script] 오류:', detail)
    res.status(500).json({ ok: false, error: detail })
  } finally {
    try { fs.unlinkSync(tmpCodePath) } catch {}
  }
})

// ── Codi_GEN(code_generator_v1.html) → 스튜디오(ScriptGenTab.jsx) 대본 핸드오프 ──
// 두 화면이 서로 다른 origin(file:// vs http://localhost:5173)이라 localStorage를
// 공유할 수 없어(content_matrix_v3.html↔code_generator_v1.html 사이의 기존
// 'codi_gen_candidate' localStorage 패턴은 둘 다 file://라서 가능했던 것) 서버 파일을
// 경유한다. GET이 읽음과 동시에 파일을 지워 1회성 소비를 보장(localStorage의
// getItem+removeItem 조합과 동일한 의도).
const CODI_GEN_HANDOFF_PATH = path.join(MEDIA_ROOT, 'downloads', 'codi_gen_handoff.json')

app.post('/api/codi-gen-handoff', (req, res) => {
  const { prompts, meta } = req.body || {}
  if (!prompts) return res.status(400).json({ ok: false, error: 'prompts가 필요합니다' })
  try {
    fs.mkdirSync(path.dirname(CODI_GEN_HANDOFF_PATH), { recursive: true })
    fs.writeFileSync(
      CODI_GEN_HANDOFF_PATH,
      JSON.stringify({ prompts, meta: meta || null, sentAt: new Date().toISOString() }, null, 2),
      'utf-8'
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/codi-gen-handoff', (req, res) => {
  try {
    if (!fs.existsSync(CODI_GEN_HANDOFF_PATH)) return res.json({ ok: true, pending: false })
    const data = JSON.parse(fs.readFileSync(CODI_GEN_HANDOFF_PATH, 'utf-8'))
    fs.unlinkSync(CODI_GEN_HANDOFF_PATH)
    res.json({ ok: true, pending: true, prompts: data.prompts, meta: data.meta })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/update-script-history — Notion 에피소드 DB에 스크립트 이력 행 추가 ──
// 주의: Notion 호출이 실패해도(토큰 없음/페이지 없음/네트워크 오류) 항상 200으로
// { success:false, error } 반환 — 호출부(script_generator.py, ScriptGenTab.jsx)가
// 이 실패로 자기 작업을 중단하지 않도록 하기 위함.
const NOTION_EPISODE_DB_ID = '2d093c5f-69c4-4e91-9d2d-0b997ddbe299'
const NOTION_VERSION = '2022-06-28'
const SCRIPT_HISTORY_HEADING = '📝 스크립트 이력'

app.post('/api/update-script-history', async (req, res) => {
  const { episodeCode, version, date, status, changes, cuts, cutDetail } = req.body
  if (!episodeCode) return res.json({ success: false, error: 'episodeCode가 필요합니다' })

  const secretsPath = path.join(CODE_ROOT, 'studio-secrets.json')
  let notionToken = ''
  try {
    const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) : {}
    notionToken = secrets.apiKeys?.notion || ''
  } catch { /* studio-secrets.json 읽기 실패 시 아래에서 토큰 없음으로 처리 */ }

  if (!notionToken) {
    console.warn('[update-script-history] Notion 토큰 없음 (studio-secrets.json apiKeys.notion) — 건너뜀')
    return res.json({ success: false, error: 'Notion API 키가 설정되어 있지 않습니다 (apiKeys.notion)' })
  }

  const notionHeaders = {
    'Authorization': `Bearer ${notionToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
  const textCell = (v) => [[{ type: 'text', text: { content: String(v ?? '') } }]]
  const buildRow = () => ({
    object: 'block', type: 'table_row',
    table_row: { cells: [
      textCell(version)[0], textCell(date)[0], textCell(status)[0], textCell(cutDetail)[0], textCell(changes)[0],
    ] },
  })

  try {
    // 1. 에피소드 DB에서 title에 episodeCode가 포함된 페이지 검색
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_EPISODE_DB_ID}/query`, {
      method: 'POST', headers: notionHeaders,
      body: JSON.stringify({ filter: { property: 'title', title: { contains: episodeCode } } }),
    })
    const queryData = await queryRes.json()
    if (!queryRes.ok) throw new Error(queryData.message || `Notion 검색 실패 (${queryRes.status})`)

    const page = queryData.results?.[0]
    if (!page) {
      console.warn(`[update-script-history] 에피소드 페이지를 찾지 못함: ${episodeCode}`)
      return res.json({ success: false, error: `Notion에서 에피소드 페이지를 찾지 못함: ${episodeCode}` })
    }
    const pageId = page.id

    // 2. 페이지 블록에서 "스크립트 이력" 헤딩 바로 다음의 table 블록 탐색
    const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
      headers: notionHeaders,
    })
    const blocksData = await blocksRes.json()
    if (!blocksRes.ok) throw new Error(blocksData.message || `Notion 블록 조회 실패 (${blocksRes.status})`)

    const blocks = blocksData.results || []
    let tableBlockId = null
    for (let i = 0; i < blocks.length; i++) {
      const headingText = (blocks[i].heading_2?.rich_text || []).map(t => t.plain_text).join('')
      if (headingText.includes('스크립트 이력')) {
        if (blocks[i + 1]?.type === 'table') tableBlockId = blocks[i + 1].id
        break
      }
    }

    if (tableBlockId) {
      // 3a. 기존 테이블에 행만 추가
      const appendRes = await fetch(`https://api.notion.com/v1/blocks/${tableBlockId}/children`, {
        method: 'PATCH', headers: notionHeaders,
        body: JSON.stringify({ children: [buildRow()] }),
      })
      const appendData = await appendRes.json()
      if (!appendRes.ok) throw new Error(appendData.message || `Notion 행 추가 실패 (${appendRes.status})`)
    } else {
      // 3b. 섹션 + 테이블(헤더 행 포함) 신규 생성
      const createRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH', headers: notionHeaders,
        body: JSON.stringify({
          children: [
            { object: 'block', type: 'heading_2',
              heading_2: { rich_text: [{ type: 'text', text: { content: SCRIPT_HISTORY_HEADING } }] } },
            { object: 'block', type: 'table',
              table: {
                table_width: 5, has_column_header: true, has_row_header: false,
                children: [
                  { object: 'block', type: 'table_row', table_row: { cells: [
                    textCell('버전')[0], textCell('날짜')[0], textCell('상태')[0], textCell('변경 컷')[0], textCell('변경 내용')[0],
                  ] } },
                  buildRow(),
                ],
              } },
          ],
        }),
      })
      const createData = await createRes.json()
      if (!createRes.ok) throw new Error(createData.message || `Notion 섹션 생성 실패 (${createRes.status})`)
    }

    res.json({ success: true, notionPageId: pageId, version })
  } catch (err) {
    console.warn('[update-script-history] Notion 연동 실패(무시하고 계속):', err.message)
    res.json({ success: false, error: err.message })
  }
})

// ── GET/POST/PATCH/DELETE /api/candidates — 후보 풀 Notion DB 연동 ───────
// 주의: Notion 호출이 실패해도(토큰 없음/네트워크 오류 등) 항상 200으로
// { success:false, error } 반환 — content_matrix_v3.html의 후보 풀 탭은 로컬
// 캐시(localStorage)만으로도 완전히 동작해야 하며, Notion 연동은 best-effort임.
const NOTION_CANDIDATE_DB_ID = 'c45d2b84-7522-4a2a-8cd7-3263bcbb2cef'

// 공통 13항목(4단계 반영도 SELECT) + 유형별 추가 3항목(MULTI_SELECT) — content_matrix_v3.html과 동일하게 유지
const CANDIDATE_CHECKLIST_ITEMS = [
  { key: 'script_msg',      agent: 'script', label: '핵심메시지 명확' },
  { key: 'script_3act',     agent: 'script', label: '3막구조 있음' },
  { key: 'script_tone',     agent: 'script', label: '서여리 톤 맞음' },
  { key: 'script_emotion',  agent: 'script', label: '감정흐름 자연스러움' },
  { key: 'image_scene',     agent: 'image',  label: '씬별 시각요소 있음' },
  { key: 'image_setting',   agent: 'image',  label: '의상·배경 설정 있음' },
  { key: 'image_mood',      agent: 'image',  label: '색감·분위기 설정됨' },
  { key: 'tts_emotion',     agent: 'tts',    label: '감정톤 지정됨' },
  { key: 'tts_length',      agent: 'tts',    label: '대사길이 적절' },
  { key: 'video_cut',       agent: 'video',  label: '컷분할 가능' },
  { key: 'video_8s',        agent: 'video',  label: '8초배수 고려됨' },
  { key: 'edit_transition', agent: 'edit',   label: '전환연출 있음' },
  { key: 'edit_bgm',        agent: 'edit',   label: 'BGM분위기 설정됨' },
]

const CANDIDATE_TYPE_EXTRA_ITEMS = {
  SF:   [ { key: 'sf_hook',       label: '훅 첫컷 있음' },        { key: 'sf_duration',     label: '15~60초 완결' },       { key: 'sf_noSubtitle', label: '자막없이 이해가능' } ],
  LF:   [ { key: 'lf_chapter',    label: '챕터구분 가능' },       { key: 'lf_density',      label: '정보밀도 적절' },       { key: 'lf_retention',  label: '중간이탈 방지장치' } ],
  IG_R: [ { key: 'igr_ratio',     label: '9:16구도 고려' },       { key: 'igr_hook3s',      label: '첫3초 훅 있음' },       { key: 'igr_musicsync', label: '음악싱크 포인트' } ],
  IG_P: [ { key: 'igp_thumbnail', label: '썸네일컷 있음' },       { key: 'igp_textoverlay', label: '텍스트오버레이 계획' }, { key: 'igp_carousel',  label: '캐러셀구성 가능' } ],
  IG_S: [ { key: 'igs_expire24h', label: '24시간 소멸 고려' },    { key: 'igs_swipeup',     label: '스와이프업 유도' },     { key: 'igs_sticker',   label: '스티커·인터랙션 요소' } ],
  TK:   [ { key: 'tk_trend',      label: '트렌드밈 요소' },       { key: 'tk_comment',      label: '댓글유도 요소' },       { key: 'tk_challenge',  label: '챌린지 연결 가능' } ],
}

const CANDIDATE_CHECK_STATUS_TO_NOTION = { '': '⬜ 미확인', no: '❌ 미반영', partial: '🟡 부분반영', full: '✅ 충분반영' }
const CANDIDATE_NOTION_STATUS_TO_CHECK = { '⬜ 미확인': '', '❌ 미반영': 'no', '🟡 부분반영': 'partial', '✅ 충분반영': 'full' }

function getNotionToken() {
  const secretsPath = path.join(CODE_ROOT, 'studio-secrets.json')
  try {
    const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) : {}
    return secrets.apiKeys?.notion || ''
  } catch {
    return ''
  }
}
function notionHeadersFor(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}
function richText(v) {
  const s = (v ?? '').toString()
  return s ? [{ type: 'text', text: { content: s } }] : []
}
function plainText(richTextArr) {
  return (richTextArr || []).map(t => t.plain_text).join('')
}

// 실제 Notion DB 필드명은 content_matrix_v3.html 내부 필드명과 다르고(예: '후보명' → '에피소드 후보명'),
// '현재 단계'는 내부 stage 키(step1 등)가 아니라 전체 라벨을 옵션으로 쓰고 있어 별도 매핑이 필요하다.
const CANDIDATE_STAGE_LABELS = {
  step1: 'STEP1 키워드수집', step2: 'STEP2 주제설정', step3: 'STEP3 에피소드기획',
  step4: 'STEP4 한글대본', approval: '승인대기', g1: 'G1투입',
}
const CANDIDATE_STAGE_LABELS_REVERSE = Object.fromEntries(
  Object.entries(CANDIDATE_STAGE_LABELS).map(([k, v]) => [v, k])
)

function candidateToNotionProperties(cand) {
  const props = {
    '에피소드 후보명': { title: richText(cand.title) },
    '콘텐츠 유형': cand.type ? { select: { name: cand.type } } : { select: null },
    '현재 단계': cand.stage ? { select: { name: CANDIDATE_STAGE_LABELS[cand.stage] || cand.stage } } : { select: null },
    '트렌드 소스': cand.source ? { select: { name: cand.source } } : { select: null },
    '핵심 키워드': { rich_text: richText(cand.keywords) },
    '주제 요약': { rich_text: richText(cand.topic) },
    '스토리 기획': { rich_text: richText(cand.story) },
    '한글 대본': { rich_text: richText(cand.script) },
    '메모': { rich_text: richText(cand.memo) },
  }
  CANDIDATE_CHECKLIST_ITEMS.forEach(it => {
    const status = cand.checklist?.[it.key] || ''
    props[it.label] = { select: { name: CANDIDATE_CHECK_STATUS_TO_NOTION[status] } }
  })
  const extraItems = CANDIDATE_TYPE_EXTRA_ITEMS[cand.type] || []
  if (extraItems.length) {
    props[`${cand.type} 추가항목`] = {
      multi_select: extraItems.filter(it => cand.checklist?.[it.key] === 'full').map(it => ({ name: it.label })),
    }
  }
  return props
}
function notionPageToCandidate(page) {
  const p = page.properties || {}
  const type = p['콘텐츠 유형']?.select?.name || 'SF'
  const checklist = {}
  CANDIDATE_CHECKLIST_ITEMS.forEach(it => {
    checklist[it.key] = CANDIDATE_NOTION_STATUS_TO_CHECK[p[it.label]?.select?.name] ?? ''
  })
  const extraItems = CANDIDATE_TYPE_EXTRA_ITEMS[type] || []
  if (extraItems.length) {
    const selected = new Set((p[`${type} 추가항목`]?.multi_select || []).map(o => o.name))
    extraItems.forEach(it => { checklist[it.key] = selected.has(it.label) ? 'full' : '' })
  }
  return {
    id: page.id,
    notionPageId: page.id,
    title: plainText(p['에피소드 후보명']?.title),
    type,
    stage: CANDIDATE_STAGE_LABELS_REVERSE[p['현재 단계']?.select?.name] || 'step1',
    source: p['트렌드 소스']?.select?.name || '',
    keywords: plainText(p['핵심 키워드']?.rich_text),
    topic: plainText(p['주제 요약']?.rich_text),
    story: plainText(p['스토리 기획']?.rich_text),
    script: plainText(p['한글 대본']?.rich_text),
    memo: plainText(p['메모']?.rich_text),
    checklist,
  }
}

app.get('/api/candidates', async (req, res) => {
  const notionToken = getNotionToken()
  if (!notionToken) {
    console.warn('[candidates] Notion 토큰 없음 (studio-secrets.json apiKeys.notion) — 건너뜀')
    return res.json({ success: false, error: 'Notion API 키가 설정되어 있지 않습니다 (apiKeys.notion)', candidates: [] })
  }
  try {
    const results = []
    let cursor
    do {
      const queryRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_CANDIDATE_DB_ID}/query`, {
        method: 'POST', headers: notionHeadersFor(notionToken),
        body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
      })
      const queryData = await queryRes.json()
      if (!queryRes.ok) throw new Error(queryData.message || `Notion 조회 실패 (${queryRes.status})`)
      results.push(...(queryData.results || []))
      cursor = queryData.has_more ? queryData.next_cursor : null
    } while (cursor)

    res.json({ success: true, candidates: results.map(notionPageToCandidate) })
  } catch (err) {
    console.warn('[candidates] Notion 조회 실패(무시):', err.message)
    res.json({ success: false, error: err.message, candidates: [] })
  }
})

app.post('/api/candidates', async (req, res) => {
  const notionToken = getNotionToken()
  if (!notionToken) return res.json({ success: false, error: 'Notion API 키가 설정되어 있지 않습니다 (apiKeys.notion)' })

  try {
    const createRes = await fetch(`https://api.notion.com/v1/pages`, {
      method: 'POST', headers: notionHeadersFor(notionToken),
      body: JSON.stringify({
        parent: { database_id: NOTION_CANDIDATE_DB_ID },
        properties: candidateToNotionProperties(req.body || {}),
      }),
    })
    const createData = await createRes.json()
    if (!createRes.ok) throw new Error(createData.message || `Notion 생성 실패 (${createRes.status})`)
    res.json({ success: true, notionPageId: createData.id })
  } catch (err) {
    console.warn('[candidates] Notion 생성 실패(무시):', err.message)
    res.json({ success: false, error: err.message })
  }
})

app.patch('/api/candidates/:pageId', async (req, res) => {
  const notionToken = getNotionToken()
  if (!notionToken) return res.json({ success: false, error: 'Notion API 키가 설정되어 있지 않습니다 (apiKeys.notion)' })

  try {
    const updateRes = await fetch(`https://api.notion.com/v1/pages/${req.params.pageId}`, {
      method: 'PATCH', headers: notionHeadersFor(notionToken),
      body: JSON.stringify({ properties: candidateToNotionProperties(req.body || {}) }),
    })
    const updateData = await updateRes.json()
    if (!updateRes.ok) throw new Error(updateData.message || `Notion 수정 실패 (${updateRes.status})`)
    res.json({ success: true, notionPageId: req.params.pageId })
  } catch (err) {
    console.warn('[candidates] Notion 수정 실패(무시):', err.message)
    res.json({ success: false, error: err.message })
  }
})

app.delete('/api/candidates/:pageId', async (req, res) => {
  const notionToken = getNotionToken()
  if (!notionToken) return res.json({ success: false, error: 'Notion API 키가 설정되어 있지 않습니다 (apiKeys.notion)' })

  try {
    const archiveRes = await fetch(`https://api.notion.com/v1/pages/${req.params.pageId}`, {
      method: 'PATCH', headers: notionHeadersFor(notionToken),
      body: JSON.stringify({ archived: true }),
    })
    const archiveData = await archiveRes.json()
    if (!archiveRes.ok) throw new Error(archiveData.message || `Notion 삭제 실패 (${archiveRes.status})`)
    res.json({ success: true })
  } catch (err) {
    console.warn('[candidates] Notion 삭제 실패(무시):', err.message)
    res.json({ success: false, error: err.message })
  }
})

// ── POST /api/analyze-candidate — 대본/기획 내용으로 체크리스트 자동 판정 ──
// content_matrix_v3.html의 자동 플로우가 STEP4(한글 대본) 완료 직후 호출한다.
// 공통 13항목 + 해당 유형의 추가 3항목을 한번에 Claude에게 판정시켜 반환한다.
app.post('/api/analyze-candidate', async (req, res) => {
  const { type, topic, story, script } = req.body || {}
  if (!ANTHROPIC_API_KEY) return res.json({ success: false, error: 'ANTHROPIC_API_KEY 미설정 (.env.local 확인)' })
  if (!script) return res.json({ success: false, error: 'script(대본) 내용이 필요합니다' })

  const items = [...CANDIDATE_CHECKLIST_ITEMS, ...(CANDIDATE_TYPE_EXTRA_ITEMS[type] || [])]
  const itemList = items.map(it => `- ${it.key}: ${it.label}`).join('\n')

  const prompt = `다음은 서여리(20대 한국 여성 AI 버추얼 인플루언서) 채널 에피소드의 기획 내용입니다.

주제 요약: ${topic || '(없음)'}
스토리 기획: ${story || '(없음)'}
한글 대본:
${script}

아래 체크리스트 항목 각각에 대해, 위 내용이 해당 항목을 얼마나 반영하고 있는지 판단하세요.
각 항목마다 "없음"(전혀 반영 안 됨), "부분"(일부만 반영), "충분"(충분히 반영) 중 하나만 선택하세요.

항목 목록:
${itemList}

아래 형식의 JSON 객체만 출력하세요. key는 위 목록의 key를 그대로 쓰고, 다른 텍스트는 포함하지 마세요:
{"항목key": "충분", "항목key2": "부분", ...}`

  try {
    const raw = await callClaudeText(prompt, 1024)
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    const STATUS_MAP = { '없음': 'no', '부분': 'partial', '충분': 'full' }
    const checklist = {}
    items.forEach(it => { checklist[it.key] = STATUS_MAP[parsed[it.key]] || '' })
    res.json({ success: true, checklist })
  } catch (err) {
    console.error('[analyze-candidate]', err.message)
    res.json({ success: false, error: err.message })
  }
})

// ── GET/POST /api/gpoints — G포인트를 서버 경유로 공유 ───────────────────
// lib/gpoints.js는 localStorage('aca_gpoints_v1')에 저장하는데, content_matrix_v3.html
// 같은 다른 오리진(file://)에서는 localStorage를 절대 읽을 수 없어 이 엔드포인트로 중계한다.
app.get('/api/gpoints', (req, res) => {
  const gpPath = path.join(MEDIA_ROOT, 'downloads', 'gpoints.json')
  try {
    if (fs.existsSync(gpPath)) {
      res.json(JSON.parse(fs.readFileSync(gpPath, 'utf-8')))
    } else {
      res.json({})
    }
  } catch {
    res.json({})
  }
})

// 컷 단위로 updatedAt을 비교해서 더 최신 쪽만 반영하는 병합 — 예전엔 요청 바디로
// 파일을 통째로 덮어써서, 오래된 localStorage 캐시를 가진 브라우저 탭이 열리기만 해도
// 다른 곳(MCP 도구, 다른 탭)에서 이미 반영된 최신 진행상황을 지워버리는 사고가 실제로
// 두 차례 발생했다(2026-08-04, 2026-08-08 — ep4의 g1/g4 데이터 유실, 백업으로 복구함).
// episodeCode/cut 단위로 스코프를 좁혀 병합하면 클라이언트가 모르는 다른 에피소드·컷의
// 최신 데이터는 절대 건드리지 않는다.
function mergeGpointsData(existing, incoming) {
  const result = { ...existing }
  for (const epCode of Object.keys(incoming || {})) {
    const incomingEp = incoming[epCode] || {}
    const mergedEp = { ...(existing[epCode] || {}) }
    for (const cutKey of Object.keys(incomingEp)) {
      const incomingCut = incomingEp[cutKey]
      const existingCut = mergedEp[cutKey]
      if (!existingCut) { mergedEp[cutKey] = incomingCut; continue }
      const incomingTime = Date.parse(incomingCut?.updatedAt || '') || 0
      const existingTime = Date.parse(existingCut?.updatedAt || '') || 0
      mergedEp[cutKey] = incomingTime >= existingTime ? incomingCut : existingCut
    }
    result[epCode] = mergedEp
  }
  return result
}

app.post('/api/gpoints', (req, res) => {
  const gpDir  = path.join(MEDIA_ROOT, 'downloads')
  const gpPath = path.join(gpDir, 'gpoints.json')
  try {
    fs.mkdirSync(gpDir, { recursive: true })
    const existing = fs.existsSync(gpPath) ? JSON.parse(fs.readFileSync(gpPath, 'utf-8')) : {}
    const merged = mergeGpointsData(existing, req.body || {})
    fs.writeFileSync(gpPath, JSON.stringify(merged, null, 2), 'utf-8')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/check-tool-credits — flow/pixverse-automation.js --check-credits 실행 후 파싱된 잔여 크레딧 반환 ──
// 이미 로그인돼 있는 전용 프로필 Chrome(9222/9223, --user-data-dir 필요, Chrome 136+ 정책)에
// CDP로 붙어서 화면을 읽어옴 — Chrome이 안 떠 있으면 실패 응답.
const CREDIT_CHECK_SCRIPTS = { flow: 'flow-automation.js', pixverse: 'pixverse-automation.js' }
app.post('/api/check-tool-credits', (req, res) => {
  const tool = CREDIT_CHECK_SCRIPTS[req.body?.tool] ? req.body.tool : 'flow'
  const profile = req.body?.profile === 'sub' ? 'sub' : 'main'
  const scriptPath = path.join(ROOT, 'scripts', CREDIT_CHECK_SCRIPTS[tool])
  const args = [scriptPath, '--check-credits', ...(profile === 'sub' ? ['--profile=sub'] : [])]

  const proc = spawn(process.execPath, args, { cwd: ROOT, env: process.env })
  let out = '', err = '', settled = false

  // 안전장치: Chrome이 멈춰있거나 예상 못한 화면 상태(로그인 대기 등)로 무한정 안 끝나는 경우 대비.
  // 정상적으로는 몇 초~수십 초면 끝나는 작업이라 45초로 충분히 여유를 둠.
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    proc.kill('SIGKILL')
    res.status(504).json({ ok: false, error: '45초 안에 응답이 없어 중단했습니다 (Chrome이 멈춰있거나 응답 없는 상태일 수 있음)' })
  }, 45000)

  proc.stdout.on('data', c => { out += c.toString() })
  proc.stderr.on('data', c => { err += c.toString() })

  proc.on('close', () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    const m = out.match(/CREDIT_RESULT:(\{.*\})/)
    if (m) {
      try {
        const data = JSON.parse(m[1])
        if (data.remaining != null) return res.json({ ok: true, ...data })
        return res.status(422).json({ ok: false, error: '화면에서 크레딧 숫자를 못 찾음', ...data, log: out.slice(-1500) })
      } catch {}
    }
    res.status(500).json({ ok: false, error: `${tool}-automation 실행 결과 파싱 실패`, log: out.slice(-1500), stderr: err.slice(-500) })
  })

  proc.on('error', e => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    res.status(500).json({ ok: false, error: `실행 실패: ${e.message}` })
  })
})

// ── GET /api/credits-status — G4(Flow) 크레딧 현황 조회 전용. studio-run-g4가 내부적으로
// 쓰는 두 소스(사람이 마지막으로 확인/입력한 studio-state.json의 creditTracker.main.flow.remaining
// + 오늘 자동화가 실제로 쓴 만큼을 세는 credit-usage-today.json)를 그대로 합쳐서 보여준다.
// costPerCut/available/canRun 계산은 studio-run-g4와 완전히 동일한 공식(포인트 단위로 통일).
// (2026-08-17 신규, 같은 날 costPerCut 단위 불일치 발견 후 수정.)
app.get('/api/credits-status', (req, res) => {
  const state = loadStudioState()
  const flowCredit = state.creditTracker?.main?.flow || {}
  const confirmed = flowCredit.remaining ?? 0
  const costPerCut = flowCredit.costPerCut || 12
  const usedToday = getUsedCount('main', 'flow')
  const usedTodayPoints = usedToday * costPerCut
  const available = confirmed - usedTodayPoints
  res.json({
    date: new Date().toISOString().slice(0, 10),
    main: {
      flow: {
        confirmed,
        costPerCut,
        usedToday,
        usedTodayPoints,
        available,
        canRun: available >= costPerCut,
      },
    },
  })
})

// ── POST /api/save-video-prompts — video-prompts.json 에피소드별 저장 ────────
app.post('/api/save-video-prompts', (req, res) => {
  const { epNum, prompts } = req.body
  if (!epNum || !Array.isArray(prompts)) return res.status(400).json({ error: 'epNum, prompts[] 필요' })
  const dir  = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`)
  const dest = path.join(dir, 'video-prompts.json')
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(dest, JSON.stringify(prompts, null, 2), 'utf-8')
    res.json({ success: true, path: dest, count: prompts.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/save-edit-meta — yeori_edit_meta.json 서버 저장 ─────────────
app.post('/api/save-edit-meta', (req, res) => {
  const metaPath = path.join(MEDIA_ROOT, 'downloads', 'video', 'yeori_edit_meta.json')
  try {
    fs.mkdirSync(path.dirname(metaPath), { recursive: true })
    fs.writeFileSync(metaPath, JSON.stringify(req.body, null, 2), 'utf-8')
    res.json({ ok: true, path: metaPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/confirm-image — G2 승인 이미지를 표준명(cut_NN.jpg)으로 저장 ──
app.post('/api/confirm-image', (req, res) => {
  const { ep, cutNo, imageUrl } = req.body
  if (!ep || !cutNo || !imageUrl) return res.status(400).json({ error: 'ep, cutNo, imageUrl 필요' })
  const padded  = String(cutNo).padStart(2, '0')
  const flowDir = path.join(MEDIA_ROOT, 'downloads', 'flow', `ep${ep}`)
  try {
    fs.mkdirSync(flowDir, { recursive: true })
    const srcPath  = path.join(MEDIA_ROOT, imageUrl.replace(/^\//, ''))
    const destPath = path.join(flowDir, `cut_${padded}.jpg`)
    if (srcPath !== destPath) fs.copyFileSync(srcPath, destPath)
    res.json({ ok: true, saved: `cut_${padded}.jpg` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/scan-images — 기존 생성 이미지 재조회 ──────────────
app.get('/api/scan-images', (req, res) => {
  const { ep } = req.query
  if (!ep) return res.status(400).json({ error: 'ep 파라미터 필요' })
  const epDir = path.join(MEDIA_ROOT, 'downloads', 'flow', `ep${ep}`)
  if (!fs.existsSync(epDir)) return res.json({ images: [] })
  const images = []
  fs.readdirSync(epDir).sort().forEach(file => {
    const m = file.match(/^cut_(\d+)(?:_[ab])?\.(jpg|jpeg|png|webp)$/i)
    if (m) images.push({ cutNo: parseInt(m[1], 10), url: `/downloads/flow/ep${ep}/${file}` })
  })
  res.json({ images })
})

// ── POST /api/scan-media — ep 전체 미디어 스캔 ─────────────────────
app.post('/api/scan-media', (req, res) => {
  const { epNum } = req.body
  if (!epNum) return res.status(400).json({ error: 'epNum 필요' })

  const flowDir  = path.join(MEDIA_ROOT, 'downloads', 'flow',  `ep${epNum}`)
  const videoDir = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`)
  const audioDir = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${epNum}`)
  const styleGuidePath = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`, 'episode_style_guide.json')

  const images = {}
  const videos = {}
  const audios = {}

  if (fs.existsSync(flowDir)) {
    fs.readdirSync(flowDir).sort().forEach(file => {
      const m = file.match(/^cut_(\d+)(?:_[ab])?\.(jpg|jpeg|png|webp)$/i)
      if (m) {
        const key = `cut_${String(parseInt(m[1], 10)).padStart(2, '0')}`
        if (!images[key]) images[key] = path.join(flowDir, file)
      }
    })
  }

  if (fs.existsSync(videoDir)) {
    fs.readdirSync(videoDir).sort().forEach(file => {
      const mFin  = file.match(/^cut_(\d+)_final\.mp4$/i)
      const mBase = file.match(/^cut_(\d+)\.mp4$/i)
      const m = mFin || mBase
      if (m) {
        const key = `cut_${String(parseInt(m[1], 10)).padStart(2, '0')}`
        if (mFin || !videos[key]) videos[key] = path.join(videoDir, file)
      }
    })
  }

  if (fs.existsSync(audioDir)) {
    fs.readdirSync(audioDir).sort().forEach(file => {
      const m = file.match(/^cut_(\d+)\.mp3$/i)
      if (m) {
        const key = `cut_${String(parseInt(m[1], 10)).padStart(2, '0')}`
        audios[key] = path.join(audioDir, file)
      }
    })
  }

  res.json({ images, videos, audios, styleGuide: fs.existsSync(styleGuidePath) })
})

// ── POST /api/run-flow — prompts 저장 후 Flow 자동 실행 (SSE) ──
app.post('/api/run-flow', (req, res) => {
  const { ep, prompts, projectId, type, content, num } = req.body
  if (!prompts) return res.status(400).json({ error: 'prompts 데이터 필요' })
  const isInsta = type === 'insta'
  if (isInsta && (!content || !num)) {
    return res.status(400).json({ error: 'type=insta 사용 시 content(FD/RL/PT/ST)와 num(인스타 번호)이 모두 필요합니다' })
  }

  const promptsPath = path.join(MEDIA_ROOT, 'downloads', 'flow', 'prompts.json')
  fs.mkdirSync(path.dirname(promptsPath), { recursive: true })
  fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2), 'utf-8')

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = data => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {}
  }
  send({ type: 'saved', message: 'prompts.json 저장 완료' })

  // 에피소드 번호: prompts.episode 우선 (클라이언트 상태 싱크 문제 방지), ep는 fallback
  // insta 모드에서는 episode 번호가 아니라 content/num이 저장 위치를 결정한다.
  const episode = prompts.episode ?? ep ?? null
  const epDir = isInsta ? instaDir(content, num, INSTA_SUBDIR[content]) : path.join(MEDIA_ROOT, 'downloads', 'flow', `ep${episode}`)
  // project_url.txt는 항상 콘텐츠 루트에 둔다(insta는 raw 하위가 아니라 {content}/{num}/ 바로 아래)
  const projectMarker = isInsta ? path.join(instaDir(content, num), 'project_url.txt') : path.join(epDir, 'project_url.txt')

  // project_url.txt 사전 확인 — 없으면 flow-automation.js가 stdin을 기다려 hang됨
  if (isInsta || episode != null) {
    // projectId가 요청에 포함된 경우 project_url.txt 자동 생성
    if (projectId && !fs.existsSync(projectMarker)) {
      fs.mkdirSync(path.dirname(projectMarker), { recursive: true })
      const projectUrl = `https://labs.google/fx/ko/tools/flow/project/${String(projectId).trim()}`
      fs.writeFileSync(projectMarker, projectUrl, 'utf-8')
      send({ type: 'log', level: 'info', message: `Flow 프로젝트 등록 완료: ${projectUrl}` })
    }

    if (!fs.existsSync(projectMarker)) {
      const label = isInsta ? `${content}/${num}` : `ep${episode}`
      const cliHint = isInsta ? `--type=insta --content=${content} --num=${num}` : `--ep=${episode}`
      send({ type: 'error', message: `Flow 프로젝트 미등록 (${label})\nproject_url.txt 없음 — 터미널에서 직접 실행하여 프로젝트 ID를 등록하세요:\n  node scripts/flow-automation.js ${cliHint}` })
      res.end()
      return
    }
  }

  const scriptPath = path.join(ROOT, 'scripts', 'flow-automation.js')
  const nodeArgs = [scriptPath]
  if (isInsta) {
    nodeArgs.push(`--type=insta`, `--content=${content}`, `--num=${num}`)
  } else if (episode != null) {
    nodeArgs.push(`--ep=${episode}`)
  }

  console.log(isInsta
    ? `[run-flow] INSTA content=${content} num=${num}`
    : `[run-flow] EP=${episode ?? 'all'} (req.ep=${ep ?? 'none'}, prompts.episode=${prompts.episode ?? 'none'})`)
  console.log(`[run-flow] spawn: ${process.execPath} ${nodeArgs.join(' ')}`)

  const proc = spawn(process.execPath, nodeArgs, { cwd: ROOT, env: process.env })

  const parseLine = line => {
    if (!line.trim()) return

    const progressMatch = line.match(/\[(\d+)\/(\d+)\].*CUT\s*(\d+)\s*생성/)
    if (progressMatch) {
      send({ type: 'progress', current: +progressMatch[1], total: +progressMatch[2], cutNo: +progressMatch[3] })
      return
    }
    const doneMatch = line.match(/\[(\d+)\/(\d+)\].*CUT\s*(\d+).*→/)
    if (doneMatch) {
      const cutNo = +doneMatch[3]
      send({ type: 'cut_done', current: +doneMatch[1], total: +doneMatch[2], cutNo })
      // cut 완료 시 파일 즉시 확인 후 cut_image 전송
      if (isInsta || episode != null) {
        const padded = String(cutNo).padStart(2, '0')
        const epUrlBase = isInsta
          ? `/downloads/insta/${content}/${num}${INSTA_SUBDIR[content] ? '/' + INSTA_SUBDIR[content] : ''}`
          : `/downloads/flow/ep${episode}`
        const epDirPath = epDir
        for (const suffix of ['_a', '_b', '']) {
          for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
            const fname = `cut_${padded}${suffix}.${ext}`
            if (fs.existsSync(path.join(epDirPath, fname))) {
              send({ type: 'cut_image', cutNo, url: `${epUrlBase}/${fname}` })
            }
          }
        }
      }
      return
    }
    const errMatch = line.match(/CUT\s*(\d+).*실패/)
    if (errMatch) {
      send({ type: 'cut_error', cutNo: +errMatch[1] })
      return
    }
    if (line.includes('성공') && line.includes('실패')) {
      send({ type: 'summary', message: line.trim() })
    }
  }

  // stdout / stderr 버퍼 분리 (혼합 시 라인 파싱 오류 방지)
  let outBuf = ''
  proc.stdout.on('data', chunk => {
    outBuf += chunk.toString()
    const lines = outBuf.split('\n')
    outBuf = lines.pop()
    lines.forEach(l => parseLine(l))
  })

  let errBuf = ''
  proc.stderr.on('data', chunk => {
    errBuf += chunk.toString()
    const lines = errBuf.split('\n')
    errBuf = lines.pop()
    lines.forEach(l => {
      const line = l.trim()
      if (!line) return
      console.error('[run-flow stderr]', line)
      // ExperimentalWarning 제외, 에러 관련 라인은 SSE로 전달
      if (!line.startsWith('ExperimentalWarning') &&
          (line.includes('Error') || line.includes('error') ||
           line.includes('오류') || line.includes('실패') || line.includes('치명'))) {
        send({ type: 'log', level: 'error', message: line })
      }
    })
  })

  proc.on('close', code => {
    if (outBuf.trim()) parseLine(outBuf)
    if (errBuf.trim()) {
      console.error('[run-flow stderr 잔여]', errBuf)
      send({ type: 'log', level: 'error', message: errBuf.trim() })
    }

    // code === null: 프로세스가 시그널로 강제 종료됨 (비정상)
    if (code === null) {
      console.error('[run-flow] 프로세스 비정상 종료 (signal kill)')
      send({ type: 'complete', success: false, code: null, reason: '프로세스가 예기치 않게 종료되었습니다 (signal)' })
    } else {
      console.log(`[run-flow] 종료 코드: ${code}`)
      send({ type: 'complete', success: code === 0, code })
    }

    // 완료 후 에피소드 디렉토리 전체 스캔 -> 누락된 cut_image 이벤트 전송
    if (episode != null) {
      const epDir = path.join(MEDIA_ROOT, 'downloads', 'flow', `ep${episode}`)
      if (fs.existsSync(epDir)) {
        fs.readdirSync(epDir).sort().forEach(file => {
          const m = file.match(/^cut_(\d+)(?:_[ab])?\.(jpg|jpeg|png|webp)$/i)
          if (m) send({ type: 'cut_image', cutNo: parseInt(m[1], 10), url: `/downloads/flow/ep${episode}/${file}` })
        })
      }
    }

    res.end()
  })

  proc.on('error', err => {
    console.error('[run-flow] spawn 오류:', err.message)
    send({ type: 'error', message: `flow-automation 실행 실패: ${err.message}`, detail: err.code ?? '' })
    res.end()
  })

  // 클라이언트 연결 종료 시 proc.kill() 하지 않음
  // flow-automation.js는 20분 이상 걸리므로 SSE 연결 끊겨도 백그라운드에서 완료까지 실행
  req.on('close', () => {
    console.log('[run-flow] 클라이언트 연결 종료 (flow 프로세스는 계속 실행)')
  })
})

// ── ElevenLabs 목소리 목록 (클론 필터용) ─────────────────────
app.get('/api/elevenlabs/voices', async (req, res) => {
  const apiKey = req.headers['xi-api-key']
  if (!apiKey) return res.status(401).json({ error: 'API 키 없음' })
  try {
    const upstream = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    })
    const body = await upstream.json()
    res.status(upstream.status).json(body)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── POST /api/run-video — video-prompts 저장 후 Veo 자동 실행 (SSE) ──
app.post('/api/run-video', (req, res) => {
  const { ep, cut, ratio, prompts } = req.body
  if (!prompts) return res.status(400).json({ error: 'prompts 데이터 필요' })

  const videoDir    = path.join(MEDIA_ROOT, 'downloads', 'video')
  const promptsPath = path.join(videoDir, 'video-prompts.json')
  fs.mkdirSync(videoDir, { recursive: true })
  fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2), 'utf-8')

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = data => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {}
  }
  send({ type: 'saved', message: 'video-prompts.json 저장 완료' })

  const episode    = prompts.episode ?? ep ?? null
  const scriptPath = path.join(ROOT, 'scripts', 'video-automation.js')
  const nodeArgs   = [scriptPath]
  if (episode != null) nodeArgs.push(`--ep=${episode}`)
  if (cut != null)     nodeArgs.push(`--cut=${cut}`)
  if (ratio)           nodeArgs.push(`--ratio=${ratio}`)

  console.log(`[run-video] EP=${episode ?? 'all'} CUT=${cut ?? 'all'} ratio=${ratio ?? '9:16'} (req.ep=${ep ?? 'none'}, prompts.episode=${prompts.episode ?? 'none'})`)
  console.log(`[run-video] spawn: ${process.execPath} ${nodeArgs.join(' ')}`)

  const proc = spawn(process.execPath, nodeArgs, { cwd: ROOT, env: process.env })

  const parseLine = line => {
    if (!line.trim()) return
    // 실제 로그: ⏳ [1/5] CUT 3 영상 생성 중…
    const progressMatch = line.match(/\[(\d+)\/(\d+)\].*CUT\s*(\d+)\s*영상\s*생성/)
    if (progressMatch) {
      send({ type: 'progress', current: +progressMatch[1], total: +progressMatch[2], cutNo: +progressMatch[3] })
      return
    }
    // 실제 로그: ✅ [1/5] CUT 3 → downloads\video\ep4\cut_03.mp4 (ok)
    const doneMatch = line.match(/\[(\d+)\/(\d+)\].*CUT\s*(\d+).*→\s*(\S+\.mp4)/i)
    if (doneMatch) {
      const cutNo = +doneMatch[3]
      const url   = '/' + doneMatch[4].replace(/\\/g, '/')
      send({ type: 'cut_done',  current: +doneMatch[1], total: +doneMatch[2], cutNo })
      send({ type: 'cut_video', current: +doneMatch[1], total: +doneMatch[2], cutNo, url })
      return
    }
    // .mp4 없는 → 라인 (예외 케이스 폴백)
    const doneBasic = line.match(/\[(\d+)\/(\d+)\].*CUT\s*(\d+).*→/)
    if (doneBasic) {
      send({ type: 'cut_done', current: +doneBasic[1], total: +doneBasic[2], cutNo: +doneBasic[3] })
      return
    }
    const errMatch = line.match(/CUT\s*(\d+).*실패/)
    if (errMatch) {
      send({ type: 'cut_error', cutNo: +errMatch[1] })
    }
  }

  let outBuf = ''
  proc.stdout.on('data', chunk => {
    outBuf += chunk.toString()
    const lines = outBuf.split('\n')
    outBuf = lines.pop()
    lines.forEach(l => parseLine(l))
  })

  let errBuf = ''
  proc.stderr.on('data', chunk => {
    errBuf += chunk.toString()
    const lines = errBuf.split('\n')
    errBuf = lines.pop()
    lines.forEach(l => {
      const line = l.trim()
      if (!line || line.startsWith('ExperimentalWarning')) return
      console.error('[run-video stderr]', line)
      if (line.includes('Error') || line.includes('error') ||
          line.includes('오류') || line.includes('실패') || line.includes('치명')) {
        send({ type: 'log', level: 'error', message: line })
      }
    })
  })

  proc.on('close', code => {
    if (outBuf.trim()) parseLine(outBuf)
    if (errBuf.trim()) {
      console.error('[run-video stderr 잔여]', errBuf)
      send({ type: 'log', level: 'error', message: errBuf.trim() })
    }
    if (code === null) {
      send({ type: 'complete', success: false, code: null, reason: '프로세스가 예기치 않게 종료되었습니다 (signal)' })
    } else {
      console.log(`[run-video] 종료 코드: ${code}`)
      send({ type: 'complete', success: code === 0, code })
    }
    res.end()
  })

  proc.on('error', err => {
    console.error('[run-video] spawn 오류:', err.message)
    send({ type: 'error', message: `video-automation 실행 실패: ${err.message}`, detail: err.code ?? '' })
    res.end()
  })

  req.on('close', () => {
    console.log('[run-video] 클라이언트 연결 종료 (video 프로세스는 계속 실행)')
  })
})

// ── /api/pipeline/* — scripts/pipeline-leader.js(G1~G5 MCP 체이닝 오케스트레이터,
// 실측 검증 완료 2026-08-10)를 웹에서 spawn/조회/중지하는 배관. /api/run-video와
// 동일한 child_process.spawn 패턴 — 다른 점은 pipeline-leader.js는 SSE 1회성 스트림이
// 아니라 --once 없이 계속 폴링하는 장시간 백그라운드 프로세스라, 응답을 바로 반환하고
// 로그는 별도 버퍼에 쌓아뒀다가 /status로 조회하는 구조로 뺐다.
let pipelineProc = null
let pipelineMeta = null   // { episodeId, startStage, endStage, startedAt, pid }
let pipelineLogs = []      // 최근 로그 라인 버퍼 (최대 200줄 유지, 조회 시 최근 20줄만 반환)

function pushPipelineLog(line) {
  if (!line) return
  pipelineLogs.push(line)
  if (pipelineLogs.length > 200) pipelineLogs = pipelineLogs.slice(-200)
}

// ① POST /api/pipeline/start
app.post('/api/pipeline/start', (req, res) => {
  const { episodeId, startStage, endStage } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  if (pipelineProc) {
    return res.status(409).json({ error: '이미 실행 중인 파이프라인이 있습니다', meta: pipelineMeta })
  }

  const from = startStage || 'g1'
  const to = endStage || 'g5'
  const scriptPath = path.join(ROOT, 'scripts', 'pipeline-leader.js')
  const nodeArgs = [scriptPath, `--episode=${episodeId}`, `--from=${from}`, `--to=${to}`]

  console.log(`[pipeline] spawn: ${process.execPath} ${nodeArgs.join(' ')}`)
  const proc = spawn(process.execPath, nodeArgs, { cwd: ROOT, env: process.env })

  pipelineLogs = []
  pipelineMeta = { episodeId, startStage: from, endStage: to, startedAt: new Date().toISOString(), pid: proc.pid }
  pipelineProc = proc

  proc.stdout.on('data', chunk => {
    chunk.toString().split('\n').filter(l => l.trim()).forEach(l => { console.log('[pipeline]', l); pushPipelineLog(l) })
  })
  proc.stderr.on('data', chunk => {
    chunk.toString().split('\n').filter(l => l.trim()).forEach(l => { console.error('[pipeline stderr]', l); pushPipelineLog(l) })
  })
  proc.on('close', code => {
    console.log(`[pipeline] 종료 코드: ${code}`)
    pushPipelineLog(`[프로세스 종료, 코드: ${code}]`)
    pipelineProc = null
  })
  proc.on('error', err => {
    console.error('[pipeline] spawn 오류:', err.message)
    pushPipelineLog(`[spawn 오류: ${err.message}]`)
    pipelineProc = null
  })

  res.json({ success: true, pid: proc.pid, episodeId, startStage: from, endStage: to })
})

// ② GET /api/pipeline/status
app.get('/api/pipeline/status', (req, res) => {
  res.json({
    running: !!pipelineProc,
    meta: pipelineMeta,
    logs: pipelineLogs.slice(-20),
  })
})

// ③ POST /api/pipeline/stop
app.post('/api/pipeline/stop', (req, res) => {
  if (!pipelineProc) return res.status(400).json({ error: '실행 중인 파이프라인이 없습니다' })
  pipelineProc.kill('SIGTERM')
  pipelineProc = null
  res.json({ success: true })
})

// ── POST /api/save-audio — WAV blob → MP3 변환 후 저장 ──
app.post('/api/save-audio', async (req, res) => {
  const ep    = req.query.ep
  const cutNo = req.query.cutNo
  if (!ep || !cutNo) return res.status(400).json({ error: 'ep, cutNo 필요' })

  const audioDir = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${ep}`)
  fs.mkdirSync(audioDir, { recursive: true })

  const wavPath = path.join(audioDir, `cut_${String(cutNo).padStart(2,'0')}_tmp.wav`)
  const mp3Path = path.join(audioDir, `cut_${String(cutNo).padStart(2,'0')}.mp3`)

  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    fs.writeFileSync(wavPath, Buffer.concat(chunks))

    const ffmpeg = 'ffmpeg'
    const proc = spawn(ffmpeg, [
      '-y', '-i', wavPath,
      '-codec:a', 'libmp3lame', '-qscale:a', '2',
      mp3Path
    ])

    proc.on('close', code => {
      fs.unlinkSync(wavPath)
      if (code === 0) {
        res.json({ ok: true, path: mp3Path })
      } else {
        res.status(500).json({ error: 'FFmpeg 변환 실패' })
      }
    })

    proc.on('error', err => {
      res.status(500).json({ error: 'FFmpeg 실행 오류: ' + err.message })
    })
  })
})

// ── POST /api/save-voice-insert — 사용자 업로드 음성 파일 원본 그대로 저장 ──
app.post('/api/save-voice-insert', (req, res) => {
  const ep      = req.query.ep
  const cutNo   = req.query.cutNo
  const idx     = req.query.idx
  const ext     = (req.query.ext || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3'
  if (!ep || cutNo == null || idx == null) return res.status(400).json({ error: 'ep, cutNo, idx 필요' })

  const dir = path.join(MEDIA_ROOT, 'downloads', 'voice-insert', `ep${ep}`)
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `cut_${String(cutNo).padStart(2,'0')}_${idx}.${ext}`
  const filePath = path.join(dir, fileName)

  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    try {
      fs.writeFileSync(filePath, Buffer.concat(chunks))
      res.json({ ok: true, url: `/downloads/voice-insert/ep${ep}/${fileName}` })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
})

// ── POST /api/run-ffmpeg — 영상+음성 FFmpeg 합성 (SSE) ──
app.post('/api/run-ffmpeg', (req, res) => {
  const { ep, cutNo, duration } = req.body
  if (!ep || cutNo == null) return res.status(400).json({ error: 'ep, cutNo 필요' })
  const dur = parseFloat(duration) || 8

  const padded   = String(cutNo).padStart(2, '0')
  const videoDir = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${ep}`)
  const audioDir = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${ep}`)
  const outDir   = path.join(MEDIA_ROOT, 'downloads', 'output', `ep${ep}`)
  fs.mkdirSync(outDir, { recursive: true })

  const videoFile = path.join(videoDir, `cut_${padded}.mp4`)
  const audioFile = path.join(audioDir, `cut_${padded}.mp3`)
  const outFile   = path.join(outDir,   `cut_${padded}_final.mp4`)

  if (!fs.existsSync(videoFile)) return res.status(404).json({ error: `영상 파일 없음: ${videoFile}` })
  if (!fs.existsSync(audioFile)) return res.status(404).json({ error: `음성 파일 없음: ${audioFile}` })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  send({ type: 'progress', message: 'FFmpeg 합성 시작…' })

  const ffmpeg = 'ffmpeg'
  const args = [
    '-y',
    '-i', videoFile,
    '-i', audioFile,
    '-filter_complex', `[1:a]apad=whole_dur=${dur}[a]`,
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    outFile,
  ]

  const proc = spawn(ffmpeg, args)
  let errBuf = ''

  proc.stderr.on('data', chunk => { errBuf += chunk.toString() })

  proc.on('close', code => {
    if (code === 0) {
      const url = `/downloads/output/ep${ep}/cut_${padded}_final.mp4`
      send({ type: 'complete', success: true, url, message: '합성 완료!' })
      console.log(`[run-ffmpeg] 완료: ${outFile}`)
    } else {
      send({ type: 'complete', success: false, message: 'FFmpeg 실패', detail: errBuf.slice(-300) })
      console.error('[run-ffmpeg] 실패:', errBuf.slice(-300))
    }
    res.end()
  })

  proc.on('error', err => {
    send({ type: 'error', message: 'FFmpeg 실행 오류: ' + err.message })
    res.end()
  })
})

// ── ffprobe 길이 측정 헬퍼 ──────────────────────────────────────────
const FFPROBE = 'ffprobe'
function getMediaDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ])
    let out = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.on('close', () => resolve(parseFloat(out.trim()) || 0))
    proc.on('error', () => resolve(0))
  })
}

function toSRTTimecode(sec) {
  const h  = Math.floor(sec / 3600)
  const m  = Math.floor((sec % 3600) / 60)
  const s  = Math.floor(sec % 60)
  const ms = Math.round((sec % 1) * 1000)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`
}

// ── POST /api/generate-srt — audio/ep{N}/*.mp3 → ep{N}.srt 생성 ──────
app.post('/api/generate-srt', async (req, res) => {
  const { epNum } = req.body
  if (!epNum) return res.status(400).json({ error: 'epNum 필요' })

  const audioDir = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${epNum}`)
  const metaPath = path.join(MEDIA_ROOT, 'downloads', 'video', 'yeori_edit_meta.json')
  const srtPath  = path.join(audioDir, `ep${epNum}.srt`)

  try {
    if (!fs.existsSync(audioDir)) return res.status(404).json({ error: `audioDir 없음: ${audioDir}` })

    const mp3Files = fs.readdirSync(audioDir)
      .filter(f => /^cut_\d+\.mp3$/.test(f))
      .sort()
    if (!mp3Files.length) return res.status(404).json({ error: `cut_NN.mp3 파일 없음` })

    const editMeta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      : []
    const metaMap = {}
    for (const m of (Array.isArray(editMeta) ? editMeta : [])) {
      metaMap[String(m.cutNo).padStart(2, '0')] = m
    }

    let cursor = 0
    let srtIdx = 1
    const lines = []

    for (const file of mp3Files) {
      const match = file.match(/^cut_(\d+)\.mp3$/)
      if (!match) continue
      const padded = String(parseInt(match[1], 10)).padStart(2, '0')
      const filePath = path.join(audioDir, file)
      const dur = await getMediaDuration(filePath) || 8

      const m = metaMap[padded]
      const text = (m?.narration?.trim() || m?.dialogue?.trim() || '').replace(/\n/g, ' ')

      if (text) {
        lines.push(`${srtIdx}`)
        lines.push(`${toSRTTimecode(cursor)} --> ${toSRTTimecode(cursor + dur)}`)
        lines.push(text)
        lines.push('')
        srtIdx++
      }
      cursor += dur
    }

    fs.writeFileSync(srtPath, lines.join('\n'), 'utf-8')

    const mm = String(Math.floor(cursor / 60)).padStart(2, '0')
    const ss = String(Math.floor(cursor % 60)).padStart(2, '0')
    res.json({ success: true, srtPath, cutCount: mp3Files.length, totalDuration: `${mm}:${ss}` })
  } catch (err) {
    console.error('[generate-srt]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/concat-video — cut_NN_final.mp4 순서대로 concat ─────────
app.post('/api/concat-video', async (req, res) => {
  const { epNum } = req.body
  if (!epNum) return res.status(400).json({ error: 'epNum 필요' })

  const videoDir  = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`)
  const outputDir = path.join(MEDIA_ROOT, 'downloads', 'output', `ep${epNum}`)
  const concatTxt = path.join(videoDir, 'concat_list.txt')
  const outFile   = path.join(outputDir, `ep${epNum}_raw.mp4`)

  try {
    if (!fs.existsSync(videoDir)) return res.status(404).json({ error: `videoDir 없음: ${videoDir}` })
    fs.mkdirSync(outputDir, { recursive: true })

    // cut_NN_final.mp4 우선, 없으면 cut_NN.mp4
    const allFiles = fs.readdirSync(videoDir)
    const cutNums = new Set()
    for (const f of allFiles) {
      const m = f.match(/^cut_(\d+)(?:_final)?\.mp4$/)
      if (m) cutNums.add(parseInt(m[1], 10))
    }
    const sortedNums = [...cutNums].sort((a, b) => a - b)
    if (!sortedNums.length) return res.status(404).json({ error: `cut_NN.mp4 파일 없음` })

    const selectedFiles = sortedNums.map(n => {
      const p = String(n).padStart(2, '0')
      const fin = path.join(videoDir, `cut_${p}_final.mp4`)
      const base = path.join(videoDir, `cut_${p}.mp4`)
      return fs.existsSync(fin) ? fin : base
    })

    const listContent = selectedFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n')
    fs.writeFileSync(concatTxt, listContent, 'utf-8')

    const ffmpeg = 'ffmpeg'
    const code = await new Promise((resolve) => {
      let errBuf = ''
      const proc = spawn(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-c', 'copy', outFile])
      proc.stderr.on('data', d => { errBuf += d.toString() })
      proc.on('close', c => { console.error('[concat-video]', errBuf.slice(-200)); resolve(c) })
      proc.on('error', () => resolve(1))
    })

    try { fs.unlinkSync(concatTxt) } catch {}

    if (code !== 0) return res.status(500).json({ error: 'FFmpeg concat 실패' })

    const totalSec = await getMediaDuration(outFile)
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
    const ss = String(Math.floor(totalSec % 60)).padStart(2, '0')

    res.json({ success: true, outputPath: outFile, cutCount: sortedNums.length, totalDuration: `${mm}:${ss}` })
  } catch (err) {
    console.error('[concat-video]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/restart-capcut — CapCut 종료 후 재실행 ─────────────────
app.post('/api/restart-capcut', (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(400).json({ error: 'Windows 전용 기능입니다' })
  }

  spawn('taskkill', ['/F', '/IM', 'CapCut.exe', '/T'], { shell: true })
    .on('error', () => {})

  setTimeout(() => {
    const exePathTxt = path.join(MEDIA_ROOT, 'downloads', 'video', 'capcut_exe_path.txt')
    const candidates = [
      'C:\\Program Files\\CapCut\\CapCut.exe',
      path.join('C:\\Users', process.env.USERNAME || '', 'AppData', 'Local', 'CapCut', 'Apps', 'CapCut.exe'),
      path.join('C:\\Users', process.env.USERNAME || '', 'AppData', 'Local', 'CapCut', 'CapCut.exe'),
    ]
    if (fs.existsSync(exePathTxt)) candidates.push(fs.readFileSync(exePathTxt, 'utf-8').trim())

    const capCutExe = candidates.find(p => fs.existsSync(p))
    if (!capCutExe) {
      return res.json({ success: false, message: 'CapCut.exe 경로를 찾을 수 없습니다. capcut_exe_path.txt에 경로를 저장하세요.' })
    }

    const proc = spawn(capCutExe, [], { detached: true, stdio: 'ignore' })
    proc.unref()
    res.json({ success: true, message: 'CapCut 재시작 완료. 프로젝트 로딩 대기 중...' })
  }, 1000)
})

// ── POST /api/run-script — scripts/{name}.js 실행 ─────────────────────
app.post('/api/run-script', (req, res) => {
  const { script, args = [] } = req.body
  if (!script) return res.status(400).json({ error: 'script 필요' })

  const scriptPath = path.join(CODE_ROOT, 'scripts', `${script}.js`)
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: `스크립트 없음: ${scriptPath}` })
  }

  let stdout = ''
  let stderr = ''
  const proc = spawn(process.execPath, [scriptPath, ...args], { cwd: CODE_ROOT, env: process.env })
  proc.stdout.on('data', d => { stdout += d.toString() })
  proc.stderr.on('data', d => { stderr += d.toString() })
  proc.on('close', code => {
    if (code === 0) {
      res.json({ success: true, output: stdout.trim() })
    } else {
      res.status(500).json({ success: false, error: stderr.trim() || stdout.trim() })
    }
  })
  proc.on('error', err => {
    res.status(500).json({ success: false, error: err.message })
  })
})

// ── POST /api/read-file — 텍스트 파일 읽기 ─────────────────────────
app.post('/api/read-file', (req, res) => {
  const { path: filePath } = req.body
  if (!filePath) return res.status(400).json({ success: false, error: 'path 필요' })
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    res.json({ success: true, content })
  } catch (err) {
    res.json({ success: false, error: err.message })
  }
})

// ── POST /api/read-file-binary — 바이너리 파일 읽기 ────────────────
app.post('/api/read-file-binary', (req, res) => {
  const { path: filePath } = req.body
  if (!filePath) return res.status(400).json({ success: false, error: 'path 필요' })
  const mimeMap = { '.mp4': 'video/mp4', '.srt': 'text/plain', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.png': 'image/png' }
  try {
    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mimeType = mimeMap[ext] || 'application/octet-stream'
    res.setHeader('Content-Type', mimeType)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})


// ── POST /api/generate-capcut-spec — 편집 메타 → capcut compile 스펙 생성 ──
app.post('/api/generate-capcut-spec', (req, res) => {
  const { epNum } = req.body
  if (!epNum) return res.status(400).json({ error: 'epNum 필요' })

  const specScriptPath = path.join(CODE_ROOT, 'scripts', 'generate-capcut-spec.js')
  const specOutputPath = path.join(MEDIA_ROOT, 'downloads', 'capcut_spec.json')

  let output = ''
  try {
    output = execSync(`node "${specScriptPath}" ${epNum}`, {
      cwd:      CODE_ROOT,
      env:      process.env,
      encoding: 'utf-8',
    })
    console.log('[generate-capcut-spec]', output.trim())
  } catch (err) {
    return res.status(500).json({ error: `generate-capcut-spec.js 실행 실패: ${err.stderr || err.message}` })
  }

  if (!fs.existsSync(specOutputPath)) {
    return res.status(500).json({ error: 'capcut_spec.json 생성 실패' })
  }

  res.json({
    success:  true,
    specPath: specOutputPath,
    message:  'capcut_spec.json 생성 완료',
    log:      output.trim(),
  })
})

// ── POST /api/send-to-cutter — run-cutter.js(데스크톱 커터+켄번스) 실행 + CapCut 재시작 ──
// 데스크톱 CapCut 프로젝트(draft_content.json)에 컷을 배치하고 켄번스 키프레임을
// 굽는 게 최종 산출물이다. capcut-web-automation.js(웹버전)는 별개 시스템이라
// 이 흐름에서 제외했다 — 필요하면 직접 실행: node scripts/capcut-web-automation.js --ep=N
app.post('/api/send-to-cutter', async (req, res) => {
  const { epNum } = req.body
  if (!epNum) return res.status(400).json({ error: 'epNum 필요' })

  const cutterScriptPath = path.join(CODE_ROOT, 'scripts', 'run-cutter.js')

  // ① run-cutter.js 실행 — draft_content.json에 컷+켄번스 직접 기록
  let cutterOut
  try {
    cutterOut = execSync(`node "${cutterScriptPath}" ${epNum}`, {
      cwd:      CODE_ROOT,
      env:      process.env,
      encoding: 'utf-8',
    })
    console.log('[send-to-cutter] run-cutter 완료:', cutterOut.trim())
  } catch (err) {
    return res.status(500).json({ error: `커터 실행 실패: ${err.stderr || err.message}` })
  }

  // ② CapCut 실행 중이면 종료 후 대기
  const username = process.env.USERNAME || process.env.USER || 'user'
  try {
    execSync('taskkill /F /IM CapCut.exe /T', { shell: true, stdio: 'ignore' })
    console.log('[send-to-cutter] 기존 CapCut 종료')
    await new Promise(r => setTimeout(r, 1500))
  } catch {
    // CapCut 실행 중 아님 — 정상
  }

  // ③ CapCut 재실행 (run-cutter.js가 방금 갱신한 프로젝트를 사람이 직접 열어 마무리)
  const exePathTxt = path.join(MEDIA_ROOT, 'downloads', 'video', 'capcut_exe_path.txt')
  const candidates = [
    path.join('C:\\Users', username, 'AppData', 'Local', 'CapCut', 'Apps', 'CapCut.exe'),
    path.join('C:\\Users', username, 'AppData', 'Local', 'CapCut', 'CapCut.exe'),
    'C:\\Program Files\\CapCut\\CapCut.exe',
  ]
  if (fs.existsSync(exePathTxt)) candidates.unshift(fs.readFileSync(exePathTxt, 'utf-8').trim())

  const capCutExe = candidates.find(p => fs.existsSync(p))
  if (capCutExe) {
    const proc = spawn(capCutExe, [], { detached: true, stdio: 'ignore' })
    proc.unref()
    console.log('[send-to-cutter] CapCut 실행:', capCutExe)
  } else {
    console.warn('[send-to-cutter] CapCut.exe 경로를 찾을 수 없습니다 (capcut_exe_path.txt에 경로 저장 필요)')
  }

  // run-cutter.js가 마지막 줄에 남긴 RESULT_JSON:{...}을 파싱해 프론트엔드에 전달
  let cutterResult = null
  const resultLine = cutterOut.trim().split('\n').find(l => l.startsWith('RESULT_JSON:'))
  if (resultLine) {
    try { cutterResult = JSON.parse(resultLine.slice('RESULT_JSON:'.length)) } catch {}
  }

  res.json({
    success:      true,
    message:      `커터 실행 완료 + CapCut ${capCutExe ? '실행' : '경로 미확인'}. 프로젝트를 열어 BGM/색보정/내보내기를 마무리하세요.`,
    cutterLog:    cutterOut.trim(),
    cutterResult, // { segCount, durationSec, draftPath, projectName } | null
    capCutExe:    capCutExe || null,
  })
})

// ── Claude API + Higgsfield MCP 헬퍼 ─────────────────────────────
async function callClaudeWithMCP(systemPrompt, userContent, maxTokens = 4096) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 미설정 (.env.local에 VITE_ANTHROPIC_API_KEY 확인)')
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    mcp_servers: [{ type: 'url', url: 'https://mcp.higgsfield.ai/mcp', name: 'higgsfield' }],
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-04-04',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`Claude API 오류 (${r.status}): ${t.slice(0, 300)}`)
  }
  return r.json()
}

function extractJsonFromClaude(claudeRes) {
  const blocks = claudeRes.content || []
  const textBlock = [...blocks].reverse().find(b => b.type === 'text')
  if (!textBlock) throw new Error('Claude 응답에 text 블록 없음')
  const raw = textBlock.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  return JSON.parse(raw)
}

// ── POST /api/analyze-video — Claude + Higgsfield MCP 경유 분석 시작 ──
app.post('/api/analyze-video', async (req, res) => {
  const { epNum, cutNo } = req.body
  if (!epNum || cutNo == null) return res.status(400).json({ error: 'epNum, cutNo 필요' })

  const padded   = String(cutNo).padStart(2, '0')
  const videoDir = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`)
  const finalP   = path.join(videoDir, `cut_${padded}_final.mp4`)
  const rawP     = path.join(videoDir, `cut_${padded}.mp4`)
  const videoFile = fs.existsSync(finalP) ? finalP : fs.existsSync(rawP) ? rawP : null
  if (!videoFile) return res.status(404).json({ error: '영상 파일을 찾을 수 없습니다' })

  const buf = fs.readFileSync(videoFile)
  if (buf.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: '영상 파일이 너무 큽니다. 10MB 이하의 파일을 사용하세요' })
  }
  const base64Data = buf.toString('base64')

  try {
    const systemPrompt = `You are a video analysis assistant.
Your job is to:
1. Upload the provided video to Higgsfield using media_upload
2. Start video analysis using video_analysis_create
3. Return ONLY a JSON object with this structure:
{"analysisId":"...","mediaId":"...","status":"queued"}
Do not include any other text.`

    const userContent = [
      { type: 'image', source: { type: 'base64', media_type: 'video/mp4', data: base64Data } },
      { type: 'text', text: 'Upload this video to Higgsfield and start video analysis. Return only the JSON with analysisId and mediaId.' },
    ]

    const claudeRes = await callClaudeWithMCP(systemPrompt, userContent, 4096)
    const parsed = extractJsonFromClaude(claudeRes)

    res.json({
      success: true,
      analysisId: parsed.analysisId,
      mediaId: parsed.mediaId,
      status: 'queued',
      message: '분석 시작됨. /api/analysis-status로 폴링하세요',
    })
  } catch (err) {
    console.error('[analyze-video]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/analysis-status — Claude + Higgsfield MCP 상태 폴링 → episode_style_guide.json ──
app.post('/api/analysis-status', async (req, res) => {
  const { analysisId, epNum, cutNo } = req.body
  if (!analysisId || !epNum) return res.status(400).json({ error: 'analysisId, epNum 필요' })

  try {
    const systemPrompt = `You are a video analysis assistant.
Check the status of a Higgsfield video analysis.
If status is not "completed", return:
{"status":"in_progress"}

If status is "completed", extract from scenes data and return ONLY this JSON structure:
{
  "status": "completed",
  "extracted": {
    "ageAppearance": "approximately 20-25 years old",
    "skin": "피부 특징",
    "hair": "헤어 특징",
    "outfit": {"top":"상의","bottom":"하의","shoes":"신발","cap":null},
    "accessories": {"necklace":"목걸이","bracelet":"팔찌","earrings":null},
    "lighting": "조명 특징",
    "colorPalette": "색감",
    "background": "배경 특징",
    "shotType": "샷 타입",
    "cameraStyle": "카메라 스타일"
  }
}
Do not include any other text. Return only JSON.`

    const userContent = `Check video analysis status for analysisId: ${analysisId}
Use video_analysis_status tool to get the result.
Extract all character and cinematography details from scenes.`

    const claudeRes = await callClaudeWithMCP(systemPrompt, userContent, 8192)
    const parsed = extractJsonFromClaude(claudeRes)

    if (parsed.status !== 'completed') {
      return res.json({ success: true, status: 'in_progress' })
    }

    // ── completed → episode_style_guide.json 생성 ────────────
    const e = parsed.extracted || {}
    const age  = e.ageAppearance || 'approximately 20-25 years old'
    const hair = e.hair || ''
    const skin = e.skin || ''
    const neck = e.accessories?.necklace || ''
    const brac = e.accessories?.bracelet || ''
    const light = e.lighting || ''

    const promptPrefix = [
      `Young Korean woman ${age}`,
      hair ? `${hair} NOT short` : '',
      'small natural beauty mark on right cheek',
      skin,
      neck,
      brac,
      'K-model proportions small face long legs slim delicate frame',
      'effortlessly photogenic not posing just existing beautifully',
      light,
      'shallow depth of field',
      'Photorealistic 8K cinematic 9:16',
    ].filter(Boolean).join(', ')

    const styleGuide = {
      epNum, generatedAt: new Date().toISOString(),
      sourceCut: `cut_${String(cutNo || 1).toString().padStart(2, '0')}`,
      analysisId,
      character: {
        face: {
          ageAppearance: age,
          skin,
          beautyMark: 'small natural beauty mark on right cheek',
          hair,
        },
        body: {
          proportions: 'K-model proportions, small face to body ratio',
          build: 'slim delicate frame, tall, long legs',
          height: 'tall, long-legged silhouette',
        },
      },
      outfit: e.outfit || {},
      accessories: e.accessories || {},
      cinematography: {
        lighting: light,
        colorPalette: e.colorPalette || '',
        background: e.background
          ? `${e.background}, background people must not interact with subject`
          : 'background people must not interact with subject',
        shotType: e.shotType || '',
        cameraStyle: e.cameraStyle || '',
      },
      promptPrefix,
    }

    const savePath = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`, 'episode_style_guide.json')
    fs.mkdirSync(path.dirname(savePath), { recursive: true })
    fs.writeFileSync(savePath, JSON.stringify(styleGuide, null, 2), 'utf-8')

    res.json({ success: true, status: 'completed', styleGuide, savedPath: savePath })
  } catch (err) {
    console.error('[analysis-status]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/save-draft — draft_content.json을 CapCut 프로젝트 경로에 저장 ──
app.post('/api/save-draft', (req, res) => {
  const { path: filePath, data } = req.body
  if (!filePath || !data) return res.status(400).json({ error: 'path, data 필요' })
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')
    res.json({ ok: true, path: filePath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/save-thumbnail — 썸네일 JPEG 저장 (downloads/final/ep{N}/thumb.jpg) ──
app.post('/api/save-thumbnail', (req, res) => {
  const { epNum, dataUrl } = req.body
  if (!epNum || !dataUrl) return res.status(400).json({ error: 'epNum, dataUrl 필요' })
  try {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    const dir = path.join(MEDIA_ROOT, 'downloads', 'final', `ep${epNum}`)
    fs.mkdirSync(dir, { recursive: true })
    const outPath = path.join(dir, 'thumb.jpg')
    fs.writeFileSync(outPath, buffer)
    res.json({ success: true, path: outPath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/check-final-assets — 최종 산출물(영상/썸네일) 존재 확인 ──
app.post('/api/check-final-assets', (req, res) => {
  const { epNum } = req.body
  if (!epNum) return res.status(400).json({ error: 'epNum 필요' })
  const videoPath = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`, `ep${epNum}_final.mp4`)
  const thumbPath = path.join(MEDIA_ROOT, 'downloads', 'final', `ep${epNum}`, 'thumb.jpg')
  res.json({
    videoExists: fs.existsSync(videoPath), videoPath,
    thumbExists: fs.existsSync(thumbPath), thumbPath,
  })
})

// ── GET /api/check-final?epNum={N} — 최종 영상/썸네일 존재 확인 (video/thumb 개별 { exists, path }) ──
// ep{N}_final.mp4(CapCut 등에서 마무리 편집해 export한 진짜 최종본)가 없으면 G5 산출물인
// downloads/output/ep{N}/ep{N}_raw.mp4를 대신 확인 — 있으면 isRaw:true로 구분해서 알려준다
// (2026-08-17 발견: G5가 만드는 파일과 이 엔드포인트가 찾던 파일이 이름부터 달라서, G5까지
// 다 끝난 에피소드도 여기선 항상 "없음"으로 나오던 갭).
app.get('/api/check-final', (req, res) => {
  const epNum = req.query.epNum
  if (!epNum) return res.status(400).json({ error: 'epNum 쿼리 파라미터 필요' })
  const videoPath = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`, `ep${epNum}_final.mp4`)
  const rawPath   = path.join(MEDIA_ROOT, 'downloads', 'output', `ep${epNum}`, `ep${epNum}_raw.mp4`)
  const thumbPath = path.join(MEDIA_ROOT, 'downloads', 'final', `ep${epNum}`, 'thumb.jpg')

  let video
  if (fs.existsSync(videoPath)) {
    video = { exists: true, path: videoPath }
  } else if (fs.existsSync(rawPath)) {
    video = { exists: true, path: rawPath, isRaw: true }
  } else {
    video = { exists: false, path: videoPath }
  }

  res.json({
    video,
    thumb: { exists: fs.existsSync(thumbPath), path: thumbPath },
  })
})

// ── POST /api/package-final — ep{N}_final.mp4(없으면 raw)을 downloads/final/ep{N}/로 복사 ──
// (thumb.jpg는 /api/save-thumbnail이 이미 같은 폴더에 저장해두므로 별도 복사 불필요)
app.post('/api/package-final', (req, res) => {
  const { epNum } = req.body
  if (!epNum) return res.status(400).json({ error: 'epNum 필요' })
  const videoPath = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`, `ep${epNum}_final.mp4`)
  const rawPath   = path.join(MEDIA_ROOT, 'downloads', 'output', `ep${epNum}`, `ep${epNum}_raw.mp4`)
  const finalDir  = path.join(MEDIA_ROOT, 'downloads', 'final', `ep${epNum}`)
  const thumbPath = path.join(finalDir, 'thumb.jpg')

  const isRaw = !fs.existsSync(videoPath) && fs.existsSync(rawPath)
  const srcPath = fs.existsSync(videoPath) ? videoPath : rawPath

  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: `${videoPath} 없음 — 먼저 편집(G5)을 완료하세요` })
  }
  try {
    fs.mkdirSync(finalDir, { recursive: true })
    const destVideo = path.join(finalDir, `ep${epNum}_final.mp4`)
    fs.copyFileSync(srcPath, destVideo)
    res.json({
      success: true,
      finalDir,
      isRaw,
      files: { video: destVideo, thumb: fs.existsSync(thumbPath) ? thumbPath : null },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/trend-candidates, POST /api/trend-to-candidate ──────────
// TREND RADAR(localhost:3000) 파이프라인 탭의 "후보풀로 전송" 버튼이 호출한다.
// content_matrix_v3.html(file://)과는 origin이 달라 localStorage를 직접 공유할 수
// 없으므로, 이 엔드포인트(파일 저장)를 거쳐야 두 앱 사이에 실제로 데이터가 전달된다.
const TREND_CANDIDATES_PATH = path.join(MEDIA_ROOT, 'downloads', 'trend_candidates.json')

app.get('/api/trend-candidates', (req, res) => {
  try {
    if (!fs.existsSync(TREND_CANDIDATES_PATH)) return res.json({ candidates: [] })
    const all = JSON.parse(fs.readFileSync(TREND_CANDIDATES_PATH, 'utf-8'))
    res.json({ candidates: Array.isArray(all) ? all : [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/trend-to-candidate', (req, res) => {
  try {
    const { id, title, source, score, keyword, topic, steps } = req.body
    if (!title) return res.status(400).json({ error: 'title 필요' })

    let list = []
    if (fs.existsSync(TREND_CANDIDATES_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(TREND_CANDIDATES_PATH, 'utf-8'))
        if (Array.isArray(parsed)) list = parsed
      } catch { /* 손상된 파일이면 새로 시작 */ }
    }

    const entry = {
      id: id || `trend_${Date.now()}`,
      title, source: source || '', score: Number(score) || 0,
      keyword: keyword || title, topic: topic || '',
      steps: steps || {},
      createdAt: new Date().toISOString(),
    }
    const idx = list.findIndex(c => c.id === entry.id)
    if (idx >= 0) list[idx] = entry; else list.unshift(entry)

    fs.writeFileSync(TREND_CANDIDATES_PATH, JSON.stringify(list, null, 2), 'utf-8')
    console.log(`[trend-to-candidate] "${title.slice(0, 40)}" → 후보풀 전송 (누적 ${list.length}건)`)
    res.json({ success: true, candidate: entry, total: list.length })
  } catch (err) {
    console.error('[trend-to-candidate]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/trend-episodes — trend_episodes.json 최신 20개 반환 ──────
app.get('/api/trend-episodes', (req, res) => {
  const savePath = path.join(MEDIA_ROOT, 'downloads', 'trend_episodes.json')
  try {
    if (!fs.existsSync(savePath)) return res.json({ entries: [] })
    const all = JSON.parse(fs.readFileSync(savePath, 'utf-8'))
    res.json({ entries: (Array.isArray(all) ? all : []).slice(0, 20) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/trend-to-episode — 트렌드 → 서여리 에피소드 후보 3개 생성 ──
app.post('/api/trend-to-episode', async (req, res) => {
  const { title, score, source, heat } = req.body
  if (!title) return res.status(400).json({ error: 'title 필요' })
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정 (.env.local 확인)' })

  const prompt = `트렌드 정보:
- 제목: ${title}
- 출처: ${source || '불명'}
- 열기: ${heat || '불명'}
- 트렌드 점수: ${score || 0}

위 트렌드를 기반으로 서여리(20대 한국 여성 AI 버추얼 인플루언서) 채널에 적합한 에피소드 후보 3개를 생성하세요.

JSON 배열만 출력하고 다른 텍스트는 포함하지 마세요:
[
  { "title": "에피소드 제목", "category": "LF", "angle": "트렌드를 서여리 관점에서 다루는 방향 한 문장" },
  { "title": "에피소드 제목", "category": "SF", "angle": "..." },
  { "title": "에피소드 제목", "category": "IG_R", "angle": "..." }
]

카테고리 규칙:
- LF: 유튜브 롱폼 (10분+, 깊이 있는 이야기, 서여리의 일상/경험 연결)
- SF: 유튜브 숏츠 (60초 이내, 강한 훅, 트렌드 핵심만)
- IG_R: 인스타그램 릴스 (30-60초, 감성적·트렌디, 비주얼 중심)`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!r.ok) {
      const t = await r.text()
      throw new Error(`Claude API 오류 (${r.status}): ${t.slice(0, 200)}`)
    }

    const claudeRes = await r.json()
    const textBlock = (claudeRes.content || []).find(b => b.type === 'text')
    if (!textBlock) throw new Error('Claude 응답에 text 블록 없음')

    const raw = textBlock.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const episodes = JSON.parse(raw)

    // downloads/trend_episodes.json에 누적 저장 (최신순)
    const savePath = path.join(MEDIA_ROOT, 'downloads', 'trend_episodes.json')
    let existing = []
    if (fs.existsSync(savePath)) {
      try { existing = JSON.parse(fs.readFileSync(savePath, 'utf-8')) } catch {}
    }
    const entry = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      trend: { title, score, source, heat },
      episodes,
    }
    existing.unshift(entry)
    fs.mkdirSync(path.dirname(savePath), { recursive: true })
    fs.writeFileSync(savePath, JSON.stringify(existing, null, 2), 'utf-8')

    console.log(`[trend-to-episode] "${title.slice(0, 40)}" → ${episodes.length}개 후보 생성`)
    res.json({ ok: true, episodes, savedCount: existing.length })
  } catch (err) {
    console.error('[trend-to-episode]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/generate-candidate-flow — 후보 풀 STEP1~4 자동 생성(SSE) ──
// content_matrix_v3.html의 "🤖 자동 플로우 실행" 버튼이 호출. 콘텐츠 유형 하나를
// 받아 키워드→주제→스토리→대본을 순서대로 Claude에게 생성시키고, 각 단계가 끝날
// 때마다 SSE로 진행상황을 흘려보낸다. Notion 저장은 프론트가 완료 이벤트를 받은
// 뒤 기존 /api/candidates 엔드포인트로 별도 수행한다.
const CANDIDATE_FLOW_TYPE_LABEL = {
  SF: 'SF — 유튜브 숏폼', LF: 'LF — 유튜브 롱폼', IG_R: 'IG_R — 인스타 릴스',
  IG_P: 'IG_P — 인스타 피드', IG_S: 'IG_S — 인스타 스토리', TK: 'TK — 틱톡',
}

// LF만 롱폼(10분+)이라 컷 수가 압도적으로 많음 — 나머지는 전부 60초 내외 숏폼이라 SF와 동일 범위 적용
const CANDIDATE_CUT_SPEC_BY_TYPE = {
  LF: '12~20개 컷',
}
const CANDIDATE_CUT_SPEC_DEFAULT = '5~8개 컷(컷당 약 8초 분량)'
const CANDIDATE_SCRIPT_MAX_TOKENS_BY_TYPE = { LF: 4096 }
const CANDIDATE_SCRIPT_MAX_TOKENS_DEFAULT = 1024

// STEP1~4 각 호출이 서로 독립된 Claude API 요청(대화 맥락 공유 안 됨)이라
// 매 단계 프롬프트에 이 컨텍스트를 반복 포함시켜야 한다. "SF"를 콘텐츠 유형이
// 아닌 공상과학(Science Fiction) 장르로 오인해 미래도시/홀로그램/평행우주 같은
// 소재를 생성하는 문제가 실제로 발생해 명시적 금지 문구를 추가함.
const YEORI_CHANNEL_CONTEXT = `서여리는 20대 한국 여성 컨셉의 AI 버추얼 인플루언서로, 친근하고 공감가는 "일상 감성 채널"입니다. 항상 현실적인 20대 여성의 일상과 감정을 다루는 콘텐츠를 만듭니다.

참고할 톤/분위기 예시(아래 항목 중 하나를 그대로 고르라는 뜻이 아니라 분위기 참고용입니다):
- 연애 / 짝사랑 / 이별
- 친구관계 / 외로움
- 취업 / 자기계발
- 일상 속 소소한 공감
- 감정 정리 / 힐링
- MZ세대 트렌드 공감

주의사항: 콘텐츠 포맷 코드 중 "SF"는 "숏폼(Short Form, 짧은 영상)"의 약자일 뿐인 정상적인 분류값입니다 — 이 코드 자체를 보고 거부하거나 경고할 필요는 전혀 없습니다. 다만 실제 에피소드 소재로 미래 도시, 홀로그램, 평행우주, 타임리프, AI 로봇, 우주 탐험, 사이버펑크 같은 공상과학(Science Fiction) 장르 요소는 이 채널과 맞지 않으니 사용하지 마세요.

당신은 지금 사용자와 대화하는 것이 아니라, 자동 콘텐츠 생성 파이프라인의 한 단계로 동작하고 있습니다. 이 요청에는 사람이 실시간으로 응답할 수 없으므로, 정보가 부족하거나 요청이 이상해 보이더라도 절대 되묻거나 거부하거나 경고만 출력하지 말고, 주어진 내용만으로 완전히 새로운 구체적인 결과물을 스스로 창작해 최종 결과만 출력하세요.`

async function callClaudeText(prompt, maxTokens = 512) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`Claude API 오류 (${r.status}): ${t.slice(0, 200)}`)
  }
  const data = await r.json()
  const textBlock = (data.content || []).find(b => b.type === 'text')
  if (!textBlock) throw new Error('Claude 응답에 text 블록 없음')
  return textBlock.text.trim()
}

// downloads/trend_episodes.json에 실제 수집된 트렌드가 있으면 그걸 우선 사용하고,
// 없으면 Claude의 web_search 서버 도구로 최신 트렌드를 직접 검색해 대체한다.
async function fetchTrendData() {
  try {
    const { status, body } = await selfFetch('/api/trend-episodes')
    if (status === 200 && Array.isArray(body?.entries) && body.entries.length) {
      return body.entries
    }
  } catch { /* 무시하고 웹 검색 fallback으로 진행 */ }
  return []
}

function formatTrendEntries(entries) {
  return entries.slice(0, 5).map(e =>
    `- [${e.trend?.source || '?'}] ${e.trend?.title || ''} (점수: ${e.trend?.score ?? '?'}, ${e.trend?.heat || ''})`
  ).join('\n')
}

async function searchWebTrends(typeLabel) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{
        role: 'user',
        content: `지금 한국 20대 여성들 사이에서 화제인 SNS/유튜브 트렌드, 밈, 화제의 소재를 웹 검색으로 찾아서 5개 이내로 간결하게 정리해줘. ${typeLabel} 포맷에 어울리는 소재 위주로.`,
      }],
    }),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`Claude 웹 검색 API 오류 (${r.status}): ${t.slice(0, 200)}`)
  }
  const data = await r.json()
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  if (!text.trim()) throw new Error('웹 검색 결과에서 텍스트를 추출하지 못함')
  return text.trim()
}

app.post('/api/generate-candidate-flow', async (req, res) => {
  const { type } = req.body || {}
  const typeLabel = CANDIDATE_FLOW_TYPE_LABEL[type]
  if (!typeLabel) return res.status(400).json({ error: '유효하지 않은 콘텐츠 유형' })
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정 (.env.local 확인)' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  try {
    let trendContext
    const trendEntries = await fetchTrendData()
    if (trendEntries.length) {
      trendContext = `다음은 TREND RADAR가 실제로 수집한 최신 트렌드 데이터입니다. 이를 참고해서 키워드를 뽑으세요:\n${formatTrendEntries(trendEntries)}`
    } else {
      const webTrends = await searchWebTrends(typeLabel)
      trendContext = `내부에 수집된 트렌드 데이터가 없어 웹 검색으로 최신 트렌드를 직접 조회했습니다. 이를 참고해서 키워드를 뽑으세요:\n${webTrends}`
    }

    const keywords = await callClaudeText(
      `${YEORI_CHANNEL_CONTEXT}\n\n${trendContext}\n\n새 에피소드 후보를 기획합니다.\n콘텐츠 유형: ${typeLabel}\n\n위 트렌드를 참고하되 서여리 채널 톤에 맞게, 이 유형에 어울리는 핵심 키워드를 5~8개, 쉼표로 구분해서만 출력하세요. 다른 설명은 하지 마세요.`,
      250
    )
    send({ step: 'step1', label: '키워드 수집', value: keywords })

    const topic = await callClaudeText(
      `${YEORI_CHANNEL_CONTEXT}\n\n핵심 키워드: ${keywords}\n\n위 키워드들을 조합해서 완전히 새로운 에피소드 하나를 직접 창작하고, 그 핵심 주제를 2~3문장으로 작성하세요. 서여리 채널 톤(친근하고 공감가는 20대 여성 관점)에 맞게 작성하고, 다른 설명 없이 요약문만 출력하세요.`,
      300
    )
    send({ step: 'step2', label: '주제 설정', value: topic })

    const story = await callClaudeText(
      `${YEORI_CHANNEL_CONTEXT}\n\n핵심 키워드: ${keywords}\n주제 요약: ${topic}\n\n위 내용을 바탕으로 이어지는 3막 구조(사건→감정변화→선택) 기준 스토리 기획을 직접 창작해 3~5문장으로 작성하세요. 다른 설명 없이 기획 내용만 출력하세요.`,
      400
    )
    send({ step: 'step3', label: '에피소드 기획', value: story })

    const cutSpec = CANDIDATE_CUT_SPEC_BY_TYPE[type] || CANDIDATE_CUT_SPEC_DEFAULT
    const scriptMaxTokens = CANDIDATE_SCRIPT_MAX_TOKENS_BY_TYPE[type] || CANDIDATE_SCRIPT_MAX_TOKENS_DEFAULT
    const scriptRaw = await callClaudeText(
      `${YEORI_CHANNEL_CONTEXT}\n\n핵심 키워드: ${keywords}\n주제 요약: ${topic}\n스토리 기획: ${story}\n\n위 내용을 바탕으로 서여리 채널의 [CUT] 포맷 한글 대본 초안을 ${cutSpec}으로 작성하세요. 각 컷은 씬/액션/대사 또는 나레이션을 포함하세요.\n\n반드시 첫 줄에 "제목: <에피소드 제목>" 형식으로 제목을 먼저 출력하고, 그 다음 줄부터 대본을 출력하세요.`,
      scriptMaxTokens
    )
    const titleMatch = scriptRaw.match(/^제목:\s*(.+)$/m)
    const title = titleMatch ? titleMatch[1].trim() : `${typeLabel} 자동 생성 에피소드`
    const script = titleMatch ? scriptRaw.slice(titleMatch.index + titleMatch[0].length).trim() : scriptRaw
    send({ step: 'step4', label: '한글 대본', value: script, title })

    send({ step: 'complete' })
  } catch (err) {
    console.error('[generate-candidate-flow]', err.message)
    send({ step: 'error', message: err.message })
  }
  res.end()
})

// ── BGM 레이더 — Chosic.com 무료 BGM 검색 + 다운로드 ──────────────
// Bensound는 현재 완전 유료 카탈로그(라이선스 구매 필요)로 전환되어 있어
// 자동 다운로드 대상에서 제외한다. Chosic은 CC BY 4.0(크레딧 표기 조건) 무료
// 다운로드를 실제로 제공하므로 이것만 스크레이핑한다.
const CHOSIC_UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

// Chosic은 Cloudflare 봇 감지로 Node fetch(undici)의 TLS 핑거프린트를 차단한다
// (헤더를 아무리 브라우저처럼 꾸며도 403 "Just a moment..." 발생).
// Windows 기본 curl.exe(Schannel)는 통과하므로 HTML 페이지 요청은 curl로 우회한다.
// (mp3 실 파일 다운로드는 Cloudflare 챌린지 대상이 아니라 fetch로 그대로 받는다)
function curlFetchHtml(url) {
  return execFileSync('curl', [
    '-s', '-L',
    '-A', CHOSIC_UA_HEADERS['User-Agent'],
    '-H', `Accept-Language: ${CHOSIC_UA_HEADERS['Accept-Language']}`,
    '--max-time', '15',
    url,
  ], { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 })
}

const CHOSIC_MOOD_TAG = {
  BGM_EMO:  'emotional',   // 감성
  BGM_INFO: 'corporate',   // 정보전달/설명
  BGM_HOOK: 'energetic',   // 훅/임팩트
  BGM_CALM: 'calm',        // 차분
}

function sanitizePathSegment(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\.\./g, '').trim()
}

async function fetchChosicListing(tag, limit = 8) {
  const listUrl = `https://www.chosic.com/free-music/${encodeURIComponent(tag)}/`
  let html
  try {
    html = curlFetchHtml(listUrl)
  } catch (err) {
    throw new Error(`Chosic 목록 조회 실패: ${err.message}`)
  }
  if (!html || !html.includes('track-info track')) throw new Error('Chosic 목록 조회 실패 (빈 응답 또는 차단됨)')

  const blocks = html.split('class="track-info track"').slice(1, limit + 1)
  const items = []
  for (const block of blocks) {
    const idMatch       = block.match(/data-track="(\d+)"/)
    const titleMatch    = block.match(/trackF-title-inside"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/)
    const artistMatch   = block.match(/artist-name"\s+href="[^"]*">([^<]+)<\/a>/)
    const durationMatch = block.match(/time-full">([^<]+)<\/div>/)
    if (!idMatch || !titleMatch) continue
    items.push({
      id: idMatch[1],
      title: titleMatch[2].trim(),
      artist: artistMatch ? artistMatch[1].trim() : '',
      detailUrl: titleMatch[1],
      duration: durationMatch ? durationMatch[1].trim() : '',
    })
  }
  return items
}

async function fetchChosicDetail(detailUrl) {
  let html
  try {
    html = curlFetchHtml(detailUrl)
  } catch {
    return null
  }
  if (!html) return null

  const mainIdx = html.indexOf('main-track')
  const scope = mainIdx >= 0 ? html.slice(mainIdx, mainIdx + 6000) : html

  const mp3Match   = scope.match(/data-url="([^"]+\.mp3)"/)
  const attrMatch  = scope.match(/data-attribution="([\s\S]*?)"\s*>/)
  const tagsBlock  = scope.match(/tagcloud-names">([\s\S]*?)<\/div>/)
  const tags = tagsBlock
    ? [...tagsBlock[1].matchAll(/tag-cloud-link-names"[^>]*>([^<]+)</g)].map(m => m[1].trim())
    : []

  const attribution = attrMatch ? attrMatch[1].replace(/<br\s*\/?>/g, ' ').replace(/\s+/g, ' ').trim() : ''
  const license = attribution.includes('CC BY')
    ? 'CC BY 4.0 — 크레딧 표기 시 무료 사용 가능'
    : (attribution || 'Chosic 라이선스 (원본 페이지 확인 필요)')

  return {
    mp3: mp3Match ? mp3Match[1] : null,
    tags,
    license,
    attribution,
  }
}

// ── POST /api/bgm-search — Chosic 무드/키워드 기반 BGM 검색 ──────────
app.post('/api/bgm-search', async (req, res) => {
  const { mood, keywords, source } = req.body || {}
  if (!mood) return res.status(400).json({ error: 'mood 필요' })

  if (source === 'bensound') {
    return res.json({
      results: [],
      message: 'Bensound는 현재 유료 라이선스 카탈로그로 전환되어 자동 검색/다운로드를 지원하지 않습니다. Chosic을 이용하세요.',
    })
  }

  const tag = CHOSIC_MOOD_TAG[mood]
  if (!tag) return res.status(400).json({ error: `알 수 없는 mood: ${mood} (BGM_EMO/BGM_INFO/BGM_HOOK/BGM_CALM 중 하나)` })

  try {
    const listing = await fetchChosicListing(tag, 8)
    const results = await Promise.all(listing.map(async item => {
      const detail = await fetchChosicDetail(item.detailUrl).catch(() => null)
      return {
        title: item.title,
        artist: item.artist,
        url: item.detailUrl,
        bpm: null, // Chosic은 트랙별 BPM을 제공하지 않음
        duration: item.duration,
        mood: detail?.tags?.length ? detail.tags.join(', ') : mood,
        license: detail?.license || 'Chosic 라이선스 (원본 페이지 확인 필요)',
        previewUrl: detail?.mp3 || null,
        downloadUrl: detail?.mp3 || null,
      }
    }))

    console.log(`[bgm-search] mood=${mood} tag=${tag} keywords=${JSON.stringify(keywords)} → ${results.length}건`)
    res.json({ results })
  } catch (err) {
    console.error('[bgm-search]', err.message)
    res.status(502).json({ error: err.message })
  }
})

// ── POST /api/bgm-download — Chosic mp3 다운로드 + index.json 갱신 ────
app.post('/api/bgm-download', async (req, res) => {
  const { url, mood, filename } = req.body || {}
  if (!url || !mood) return res.status(400).json({ error: 'url, mood 필요' })

  try {
    let mp3Url = url
    if (!/\.mp3(\?.*)?$/i.test(mp3Url)) {
      const detail = await fetchChosicDetail(url)
      if (!detail?.mp3) return res.status(404).json({ error: '다운로드 가능한 mp3 URL을 찾을 수 없습니다' })
      mp3Url = detail.mp3
    }

    const upstream = await fetch(mp3Url, { headers: CHOSIC_UA_HEADERS })
    if (!upstream.ok) return res.status(502).json({ error: `원본 파일 다운로드 실패 (${upstream.status})` })
    const buffer = Buffer.from(await upstream.arrayBuffer())

    const moodDir = sanitizePathSegment(mood) || 'misc'
    const baseName = filename
      ? path.basename(sanitizePathSegment(filename))
      : path.basename(new URL(mp3Url).pathname)
    const safeName = /\.mp3$/i.test(baseName) ? baseName : `${baseName}.mp3`

    const dir = path.join(MEDIA_ROOT, 'downloads', 'bgm', moodDir)
    fs.mkdirSync(dir, { recursive: true })
    const destPath = path.join(dir, safeName)
    fs.writeFileSync(destPath, buffer)

    // index.json 갱신 (최신순 배열)
    const indexPath = path.join(MEDIA_ROOT, 'downloads', 'bgm', 'index.json')
    let index = []
    if (fs.existsSync(indexPath)) {
      try { index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) } catch {}
    }
    index.unshift({
      id: Date.now(),
      title: safeName.replace(/\.mp3$/i, ''),
      mood: moodDir,
      sourceUrl: url,
      mp3Url,
      file: path.join('bgm', moodDir, safeName).replace(/\\/g, '/'),
      downloadedAt: new Date().toISOString(),
    })
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')

    console.log(`[bgm-download] ${mp3Url} → ${destPath}`)
    res.json({ success: true, path: destPath })
  } catch (err) {
    console.error('[bgm-download]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── /api/mcp/* — 원격 MCP 브리지 전용 (Cloudflare Tunnel 경유, Bearer 토큰 필요) ──
// Vercel(api/mcp.js)의 Streamable HTTP MCP 서버가 이 라우터를 호출한다.
// 로컬 프론트엔드(VideoTab 등)가 쓰는 /api/* 원본 엔드포인트는 그대로 무인증 유지.
function requireMcpAuth(req, res, next) {
  if (!MCP_BRIDGE_SECRET) {
    return res.status(503).json({ error: 'MCP_BRIDGE_SECRET 미설정 -- .env.local에 추가 후 서버 재시작 필요' })
  }
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (token !== MCP_BRIDGE_SECRET) return res.status(401).json({ error: 'unauthorized' })
  next()
}

async function selfFetch(pathAndQuery, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}${pathAndQuery}`, opts)
  const text = await r.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: r.status, body }
}

// run-flow는 SSE라 오래 열려있음 -- 첫 이벤트만 읽고 끊는다("SSE 스트림 대신 완료 여부만 반환" 원래 의도와 동일)
async function readFirstSSEEvent(pathAndQuery, opts) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${pathAndQuery}`, opts)
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const idx = buf.indexOf('\n\n')
      if (idx !== -1) {
        const line = buf.slice(0, idx).split('\n').find(l => l.startsWith('data: '))
        reader.cancel().catch(() => {})
        if (line) return JSON.parse(line.slice(6))
        break
      }
    }
  } catch (err) {
    return { type: 'error', message: err.message }
  }
  return { type: 'error', message: '응답 스트림에서 이벤트를 읽지 못함' }
}

const mcpRouter = express.Router()
mcpRouter.use(requireMcpAuth)

// studio-state/list-episodes와 동일하게 파일을 직접 읽는다 -- 이전에는 selfFetch로
// 자기 자신에게 루프백 HTTP 요청을 보내는 방식이었는데, 터널을 통한 호출 시
// 이 추가 왕복에서 응답이 지연/누락되어 "The connector's server isn't responding"
// 오류가 발생했다.
mcpRouter.get('/trend-episodes', (_req, res) => {
  const savePath = path.join(MEDIA_ROOT, 'downloads', 'trend_episodes.json')
  try {
    if (!fs.existsSync(savePath)) return res.json({ entries: [] })
    const all = JSON.parse(fs.readFileSync(savePath, 'utf-8'))
    res.json({ entries: (Array.isArray(all) ? all : []).slice(0, 20) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

mcpRouter.post('/trend-to-episode', async (req, res) => {
  const { status, body } = await selfFetch('/api/trend-to-episode', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body),
  })
  res.status(status).json(body)
})

// studio-secrets.json(API 키)은 절대 병합하지 않는 전용 핸들러 -- /api/studio-state와 달리 secrets 미포함
mcpRouter.get('/studio-state', (_req, res) => {
  const statePath = path.join(CODE_ROOT, 'studio-state.json')
  try {
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf-8')) : {}
    res.json(state)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

mcpRouter.post('/run-flow', async (req, res) => {
  const ev = await readFirstSSEEvent('/api/run-flow', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body),
  })
  res.json(ev)
})

mcpRouter.post('/generate-srt', async (req, res) => {
  const { status, body } = await selfFetch('/api/generate-srt', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body),
  })
  res.status(status).json(body)
})

mcpRouter.post('/concat-video', async (req, res) => {
  const { status, body } = await selfFetch('/api/concat-video', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body),
  })
  res.status(status).json(body)
})

// mcp-server.js가 직접 fs로 읽던 것을 서버 엔드포인트로 이전 (Vercel에서도 쓸 수 있도록)
mcpRouter.get('/list-episodes', (_req, res) => {
  const statePath = path.join(CODE_ROOT, 'studio-state.json')
  if (!fs.existsSync(statePath)) return res.json({ episodes: [] })
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    const episodes = Object.values(state.episodes || {}).map(ep => {
      const e = ep.episode || {}
      return {
        id: ep.id,
        contentType: e.contentType || '?',
        number: e.number || 1,
        title: e.title || '제목 없음',
        cutCount: (ep.cuts || []).length,
        isActive: ep.id === state.activeEpisodeId,
      }
    })
    res.json({ episodes })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

mcpRouter.post('/export-pipeline', (req, res) => {
  const { episodeId } = req.body || {}
  const statePath = path.join(CODE_ROOT, 'studio-state.json')
  if (!fs.existsSync(statePath)) return res.status(404).json({ error: 'studio-state.json 없음' })
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    const ep = state.episodes?.[episodeId]
    if (!ep) return res.status(404).json({ error: `에피소드 ID ${episodeId} 없음` })
    // 이전엔 studio-state.json의 존재하지 않는 state.gData를 읽어서 항상 빈 값이었던
    // 버그가 있었음(클라이언트가 gData를 studio-state.json에 쓴 적이 없음) — 실제
    // g포인트 저장소(downloads/gpoints.json, 에피소드 코드로 중첩됨)를 읽도록 수정.
    const episodeCode = resolveEpisodeCode(ep.episode, episodeId)
    const gData = loadGpointsFile()[episodeCode] || {}
    const approvedCuts = (ep.cuts || []).filter(c => gData[`cut_${c.no}`]?.g1)
    if (!approvedCuts.length) return res.status(400).json({ error: 'G1 승인된 컷이 없습니다' })

    const getFlags = c => {
      switch (c.cutType || 'YEORI') {
        case 'BROLL':   return { run_g2:true,  run_g3:true,  g3_track:'나레이션', run_g4:true,  run_g5:true }
        case 'PIP':     return { run_g2:true,  run_g3:true,  g3_track:'대사',    run_g4:true,  run_g5:true, ...(parseInt(c.pipTarget)>0 ? {pip_target:parseInt(c.pipTarget)} : {}) }
        case 'GRAPHIC': return { run_g2:false, run_g3:true,  g3_track:'나레이션', run_g4:false, run_g5:true, g5_tool:'browser_record', ...(c.graphicTool ? {graphic_tool:c.graphicTool} : {}) }
        case 'CAPCUT':  return { run_g2:false, run_g3:false, run_g4:false, run_g5:true, g5_tool:'capcut_only' }
        default:        return { run_g2:true,  run_g3:true,  g3_track:'대사',    run_g4:true,  g4_mode:'lipsync', run_g5:true }
      }
    }

    const pipeline = approvedCuts.map(c => ({ no: c.no, imagePrompt: c.imagePrompt || '', ...getFlags(c) }))
    const savePath = path.join(MEDIA_ROOT, 'downloads', 'pipeline_export.json')
    fs.writeFileSync(savePath, JSON.stringify(pipeline, null, 2), 'utf-8')

    res.json({ success: true, savePath, pipeline })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── G1~G5 스튜디오 자동화 오케스트레이션 (Claude MCP가 직접 호출) ──────────
// gpoints.json은 에피소드로 구분되지 않고 cut_N 키 하나만 쓰므로(studio 브라우저와
// 동일한 제약), studio-set-episode로 대상 에피소드를 studio-state.json의 최상위
// (episode/cuts/activeEpisodeId)로 먼저 옮긴 뒤 이후 단계를 진행하는 것을 전제로 한다.
const STUDIO_STATE_PATH = path.join(CODE_ROOT, 'studio-state.json')
const GPOINTS_PATH = path.join(MEDIA_ROOT, 'downloads', 'gpoints.json')
const DEFAULT_YEORI_VOICE_ID = 'RmYuvmCbqOMBJxDLW4k8'

function loadStudioState() {
  return fs.existsSync(STUDIO_STATE_PATH) ? JSON.parse(fs.readFileSync(STUDIO_STATE_PATH, 'utf-8')) : {}
}
function saveStudioState(state) {
  // 브라우저(AppContext.jsx의 MARK_SAVED)는 저장할 때마다 savedAt을 직접 찍는데, MCP/에이전트
  // 리더/파이프라인 경로(이 함수)는 그동안 안 찍고 있었음 — smart-sync-state.ps1이 PC간 동기화를
  // 정확히 이 필드로 "최신 쪽" 판단하므로, 여기서 안 찍으면 MCP로만 만든 변경이 사람이 브라우저에서
  // 한 번도 저장 안 누르면 "최신"으로 인식 안 돼서 나중에 오래된 클라우드 사본에 덮어써질 위험이 있었음
  // (2026-08-15 발견). 브라우저 저장 경로(POST /api/studio-state)는 이 함수를 안 거치고 클라이언트가
  // 보낸 savedAt을 그대로 쓰므로 여기서 건드리지 않는다.
  state.savedAt = new Date().toISOString()
  fs.writeFileSync(STUDIO_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}
// v2(2026-08-02): { cut_N: {...} } 평면 구조 -> { [episodeCode]: { cut_N: {...} } } 중첩
// 구조로 변경(에피소드 구분이 없어 서로 다른 에피소드의 같은 컷 번호가 덮어쓰던 문제
// 수정). 기존 평면 데이터는 어느 에피소드 것인지 알 길이 없으므로 유실 방지 차원에서
// "_LEGACY" 키 밑에 통째로 보존만 하고 더 이상 읽지는 않는다.
const GPOINTS_LEGACY_KEY = '_LEGACY'
function isLegacyFlatGpoints(data) {
  return Object.keys(data).some(k => /^cut_\d+$/.test(k))
}
function loadGpointsFile() {
  if (!fs.existsSync(GPOINTS_PATH)) return {}
  const raw = JSON.parse(fs.readFileSync(GPOINTS_PATH, 'utf-8'))
  if (!isLegacyFlatGpoints(raw)) return raw
  const migrated = { [GPOINTS_LEGACY_KEY]: raw }
  saveGpointsFile(migrated)
  return migrated
}
function saveGpointsFile(data) {
  fs.mkdirSync(path.dirname(GPOINTS_PATH), { recursive: true })
  fs.writeFileSync(GPOINTS_PATH, JSON.stringify(data, null, 2), 'utf-8')
}
function getEpisodeOrThrow(state, episodeId) {
  const ep = state.episodes?.[episodeId]
  if (!ep) { const e = new Error(`에피소드 ID ${episodeId} 없음`); e.statusCode = 404; throw e }
  return ep
}
// cutIds: cut.id("cut-3") 또는 cut.no(3) 어느 쪽으로 와도 매칭
function filterCutsByIds(cuts, cutIds) {
  if (!Array.isArray(cutIds) || !cutIds.length) return cuts
  const idSet = new Set(cutIds.map(String))
  return cuts.filter(c => idSet.has(String(c.id)) || idSet.has(String(c.no)))
}
function scanFlowImagesByCut(epNum) {
  const dir = path.join(MEDIA_ROOT, 'downloads', 'flow', `ep${epNum}`)
  const byCut = {}
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).sort().forEach(file => {
      const m = file.match(/^cut_(\d+)(?:_[ab])?\.(jpg|jpeg|png|webp)$/i)
      if (m) {
        const no = parseInt(m[1], 10)
        if (!byCut[no]) byCut[no] = []
        byCut[no].push(file)
      }
    })
  }
  return byCut
}
// 승인(G2~G4)/완료(G5) 시점에 확정된 산출물의 복사본을 downloads/deliverables/{code}/에 쌓는다.
// 원본(작업 후보 파일)은 그대로 두고 복사만 함 — 실패해도(파일이 아직 없는 등) 승인 자체는
// 막지 않고 경고만 남긴다(2026-08-15 신규, "업로드 준비된 산출물 모음소" 필요 요청).
function copyToDeliverables(episodeCode, srcPath, destFilename) {
  try {
    if (!fs.existsSync(srcPath)) return { copied: false, reason: `원본 없음: ${srcPath}` }
    const dir = deliverablesDir(episodeCode)
    fs.mkdirSync(dir, { recursive: true })
    const destPath = path.join(dir, destFilename)
    fs.copyFileSync(srcPath, destPath)
    return { copied: true, path: destPath }
  } catch (err) {
    return { copied: false, reason: err.message }
  }
}

function approveGForCuts(episodeCode, cuts, gKey) {
  const gData = loadGpointsFile()
  const epData = { ...gData[episodeCode] }
  const now = new Date().toISOString()
  cuts.forEach(c => {
    const key = `cut_${c.no}`
    epData[key] = { ...epData[key], [gKey]: true, updatedAt: now }
  })
  gData[episodeCode] = epData
  saveGpointsFile(gData)
  return cuts.length
}
// gpoints.json이 cut_N 키만 쓰고 에피소드로 구분되지 않으므로, 승인/실행 계열 엔드포인트는
// 항상 "요청한 episodeId가 지금 활성 에피소드와 같다"를 강제해서 다른 에피소드의 gpoints를
// 실수로 덮어쓰는 사고를 막는다. studio_set_episode를 먼저 호출하지 않으면 여기서 막힌다.
function requireActiveEpisode(state, episodeId) {
  if (state.activeEpisodeId !== episodeId) {
    const e = new Error(`episodeId(${episodeId})가 현재 활성 에피소드(${state.activeEpisodeId || '없음'})와 다릅니다 — 먼저 studio_set_episode를 호출하세요`)
    e.statusCode = 409
    throw e
  }
}
// v3 대본의 대사/나레이션 필드에 촬영·제작 메모가 괄호로 섞여 들어오는 경우가 있어
// (예: "아~ 살 것 같다 (음성 오버레이 — Veo3 대사 포함 금지)") TTS가 그대로 읽지 않도록 제거한다.
function stripStageDirections(text) {
  const removed = []
  const clean = text.replace(/\s*\([^)]*\)/g, (m) => { removed.push(m.trim()); return '' }).trim()
  return { clean, removed }
}

// v3 대본 원문(raw) 하나를 파싱해서 지정 에피소드의 cuts/scriptRaw/마스터코드에 반영.
// studio-upload-script(MCP, scriptPath로 파일을 읽어옴)와 /api/script-upload(에이전트
// 리더 채팅, scriptText를 직접 받음) 둘이 파일을 얻는 방식만 다르고 나머지는 완전히
// 동일해서 공유. state는 호출부가 loadStudioState()로 미리 로드해서 넘기고,
// saveStudioState까지 이 함수가 책임진다.
function applyScriptToEpisode(state, episodeId, raw) {
  if (!isV3Format(raw)) {
    const e = new Error('v3 표준 포맷([CUT N] + SC/SP/PL 필드 + KR(한글 컨펌본) 섹션)이 아닙니다')
    e.statusCode = 400
    throw e
  }
  const cuts = parseCutsV3(raw)
  if (!cuts.length) {
    const e = new Error('v3 포맷 파싱 실패 — [CUT N] 블록을 확인하세요')
    e.statusCode = 400
    throw e
  }
  const { masterCode, epHeaderRaw } = parseV3GlobalHeader(raw)

  const ep = getEpisodeOrThrow(state, episodeId)
  ep.cuts = cuts
  ep.scriptRaw = raw
  if (masterCode || epHeaderRaw) {
    ep.episode = { ...ep.episode, ...(masterCode ? { masterCode } : {}), ...(epHeaderRaw ? { epHeaderRaw } : {}) }
  }
  state.episodes[episodeId] = ep

  if (state.activeEpisodeId === episodeId) {
    state.cuts = ep.cuts
    state.scriptRaw = ep.scriptRaw
    state.episode = ep.episode
  }
  saveStudioState(state)
  // episode.code(생성 시 확정한 정식 식별자)와 대본에서 파싱된 masterCode가 다르면 경고만 —
  // 어느 쪽 값도 여기서 되돌리거나 덮어쓰지 않는다(둘 다 위에서 이미 그대로 저장됨).
  const codeMismatch = !!(ep.episode?.code && masterCode && ep.episode.code !== masterCode)
  return { cuts, cutCount: cuts.length, masterCode, epHeaderRaw, codeMismatch }
}

// ① studio-set-episode — 대상 에피소드를 studio-state.json 최상위(활성 에피소드)로 전환
mcpRouter.post('/studio-set-episode', (req, res) => {
  const { episodeId } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    state.activeEpisodeId = episodeId
    state.episode = ep.episode
    state.cuts = ep.cuts
    state.scriptRaw = ep.scriptRaw || ''
    saveStudioState(state)
    res.json({ success: true, episodeId, episode: state.episode, cutCount: (state.cuts || []).length })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ── POST /api/episodes — 신규 에피소드 생성(에이전트 리더 채팅의 create_episode 액션 전용,
// content_matrix_v3.html의 file:// 페이지가 직접 호출하므로 /api/script-upload·/api/pipeline/*와
// 같은 패턴으로 인증 없이 둠). 지금까지 에피소드 생성은 스튜디오 UI의 "+ 새 에피소드 추가"
// 폼(사람이 직접)으로만 가능했고 채팅/MCP 어디에도 없었던 걸 처음 채움(2026-08-17).
//
// 번호는 반드시 "전체 에피소드 통틀어 최댓값+1"(전역 유일 카운터)로 매긴다 — App.jsx/
// AppContext.jsx의 ADD_EPISODE와 동일한 계산. 콘텐츠유형별로 독립 계산하면 안 됨: 바로 오늘
// 오전에 episode.number가 유형별 독립이라 서로 다른 에피소드가 같은 번호를 가져서
// downloads/flow/ep{N}/ 폴더를 실제로 공유하는 사고를 겪고 전역 카운터로 되돌렸는데, 여기서
// 다시 유형별로 매기면 그 버그가 그대로 재발한다.
app.post('/api/episodes', (req, res) => {
  const { contentType, title } = req.body || {}
  const VALID_TYPES = ['SF', 'LF', 'IG_R', 'IG_P', 'TK']
  if (!VALID_TYPES.includes(contentType)) {
    return res.status(400).json({ error: `contentType은 ${VALID_TYPES.join('/')} 중 하나여야 합니다` })
  }
  try {
    const state = loadStudioState()
    if (!state.episodes) state.episodes = {}
    const nextNumber = Math.max(0, ...Object.values(state.episodes).map(e => e.episode.number)) + 1
    const code = `${contentType}_E${String(nextNumber).padStart(2, '0')}`
    const id = `ep_${Date.now()}`

    const makeCut = (no) => ({
      id: `cut-${no}`, no,
      scene: '', action: '', character: '서여리',
      dialogue: '', narration: '', imagePrompt: '',
      duration: 5, cutType: 'YEORI', cutMark: 'NORMAL',
    })

    const newEp = {
      id,
      episode: {
        number: nextNumber,
        title: title || '',
        location: '카페',
        mood: '감성',
        cutCount: 7,
        contentType,
        topicCode: 'PSY',
        scnCode: 'DOC',
        instaNum: '',
        character: '서여리 - 20대 초반 한국 여성, 긴 웨이비 다크 브라운 헤어, 자연스러운 피부결, 골드 목걸이, K-모델 포스, 차분하지만 가끔은 엉뚱한 반전매력, AI 크리에이터',
        code,
      },
      cuts: Array.from({ length: 7 }, (_, i) => makeCut(i + 1)),
      scriptRaw: '',
      createdAt: new Date().toISOString(),
    }

    state.episodes[id] = newEp
    state.activeEpisodeId = id
    state.episode = newEp.episode
    state.cuts = newEp.cuts
    state.scriptRaw = ''
    if (!Array.isArray(state.openTabIds)) state.openTabIds = []
    if (!state.openTabIds.includes(id)) state.openTabIds.push(id)

    saveStudioState(state)
    res.json({ success: true, episodeId: id, code, title: newEp.episode.title, number: nextNumber })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ② studio-upload-script — v3 표준 포맷 대본 파일을 읽어 해당 에피소드의 cuts로 반영
mcpRouter.post('/studio-upload-script', (req, res) => {
  const { episodeId, scriptPath } = req.body || {}
  if (!episodeId || !scriptPath) return res.status(400).json({ error: 'episodeId, scriptPath 필요' })
  try {
    const resolvedPath = path.isAbsolute(scriptPath) ? scriptPath : path.join(CODE_ROOT, scriptPath)
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: `파일 없음: ${resolvedPath}` })
    const raw = fs.readFileSync(resolvedPath, 'utf-8')

    const state = loadStudioState()
    const { cutCount, masterCode, epHeaderRaw, codeMismatch } = applyScriptToEpisode(state, episodeId, raw)
    res.json({ success: true, cutCount, masterCode, epHeaderRaw, codeMismatch })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ②-b /api/script-upload — 에이전트 리더 채팅(content_matrix_v3.html, file:// 정적 페이지)
// 전용 공개 엔드포인트. studio-upload-script(위)는 MCP_BRIDGE_SECRET Bearer 인증이 필요한데
// file://로 여는 채팅 페이지는 그 시크릿을 안전하게 보관할 수 없어서(스튜디오 연동 탭의
// /api/studio-status-public과 같은 이유), 파이프라인 제어(/api/pipeline/*)와 같은 패턴으로
// 인증 없는 로컬 전용 엔드포인트를 별도로 둔다. scriptText(채팅에 붙여넣은 원문)와 scriptPath
// (로컬 파일 경로, studio-upload-script와 동일한 절대/상대경로 해석) 둘 다 지원 — 어느 쪽이든
// 최종적으로 downloads/script/{episodeCode}/script_v3.txt에 정식 저장. 지금까지 대본 파일을
// 어디에 둘지 정해진 위치가 없어 사람이 임의 경로를 만들던 문제를 같이 해결한다.
// 사용자 확정(2026-08-15): 채팅 업로드는 G1(대본) 승인까지 자동으로 같이 처리한다 — G1은
// (G2/G3/G4와 달리) 검토할 생성물이 없는 단계라 "사람이 붙여넣은 대본을 그대로 채택" 이상의
// 의미가 없다고 판단.
app.post('/api/script-upload', (req, res) => {
  const { episodeId, scriptText: bodyScriptText, scriptPath: inputScriptPath } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  if (!bodyScriptText && !inputScriptPath) {
    return res.status(400).json({ error: 'scriptText 또는 scriptPath 중 하나가 필요합니다' })
  }

  let scriptText = bodyScriptText
  if (!scriptText) {
    const resolvedPath = path.isAbsolute(inputScriptPath) ? inputScriptPath : path.join(CODE_ROOT, inputScriptPath)
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: `파일 없음: ${resolvedPath}` })
    try {
      scriptText = fs.readFileSync(resolvedPath, 'utf-8')
    } catch (err) {
      return res.status(500).json({ error: `파일 읽기 실패: ${err.message}` })
    }
  }

  try {
    const state = loadStudioState()
    requireActiveEpisode(state, episodeId)
    const { cuts, cutCount, masterCode, epHeaderRaw, codeMismatch } = applyScriptToEpisode(state, episodeId, scriptText)

    const ep = getEpisodeOrThrow(state, episodeId)
    const episodeCode = resolveEpisodeCode(ep.episode, episodeId)
    const dir = scriptDir(episodeCode)
    fs.mkdirSync(dir, { recursive: true })
    const scriptPath = path.join(dir, 'script_v3.txt')
    fs.writeFileSync(scriptPath, scriptText, 'utf-8')

    const approvedCount = approveGForCuts(episodeCode, cuts, 'g1')

    res.json({ success: true, scriptPath, cutCount, masterCode, epHeaderRaw, codeMismatch, approvedCount })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ③ studio-approve-g1 — G1(대본) 승인 (cutIds 생략 시 전체 컷)
mcpRouter.post('/studio-approve-g1', (req, res) => {
  const { episodeId, cutIds } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    requireActiveEpisode(state, episodeId)
    const episodeCode = resolveEpisodeCode(ep.episode, episodeId)
    const targetCuts = filterCutsByIds(ep.cuts || [], cutIds)
    const approvedCount = approveGForCuts(episodeCode, targetCuts, 'g1')
    res.json({ success: true, approvedCount })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ④ studio-run-g2 — flow-automation.js 호출(이미지 생성). 오래 걸리므로 시작 확인만 반환
mcpRouter.post('/studio-run-g2', async (req, res) => {
  const { episodeId, cutIds } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    requireActiveEpisode(state, episodeId)
    // GRAPHIC/CAPCUT 컷(CapCut에서 직접 제작, 텍스트 훅/DM 목업 등)은 IP에 안내문이 들어있어도
    // imagePrompt가 비어있지 않게 파싱되므로 반드시 cutType으로도 걸러야 함(2026-08-15 실측
    // IG_RL_E02에서 발견 — CAPCUT 컷까지 Flow 생성 대상에 잡혀 크레딧이 낭비될 뻔함).
    const targetCuts = filterCutsByIds(ep.cuts || [], cutIds)
      .filter(c => c.imagePrompt?.trim() && !['GRAPHIC', 'CAPCUT'].includes(c.cutType))
    if (!targetCuts.length) return res.status(400).json({ error: '이미지 생성이 필요한 컷이 없습니다(전부 이미지 프롬프트가 없거나 GRAPHIC/CAPCUT 타입)' })

    const epNum = ep.episode?.number
    const prompts = {
      episode: epNum,
      title: ep.episode?.title || '',
      cuts: targetCuts.map(c => ({
        no: c.no,
        imagePrompt: c.imagePrompt || '',
        ...(c.narration?.trim() ? { narration: c.narration.trim() } : {}),
        ...(c.dialogue?.trim() && !/^없음$/i.test(c.dialogue) ? { dialogue: c.dialogue.trim() } : {}),
        duration: c.duration || 5,
      })),
    }

    // 이 에피소드의 컷이 인스타 콘텐츠(IG_FD/IG_RL/IG_PT/IG_ST)면 downloads/insta/{content}/{num}/
    // 로 라우팅해야 함 — StudioTab.jsx의 runFlow()는 이미 이렇게 하는데 이 MCP 경로는 안 하고 있어서
    // { ep, prompts }만 보내면 존재하지도 않는 숫자 폴더(downloads/flow/ep{episode.number}/)로
    // 잘못 저장됐음(2026-08-15, 에이전트 리더로 G2 실행 준비 중 실측 발견 — 클라이언트 버튼과
    // MCP/파이프라인 리더 경로가 서로 다른 동작을 하고 있었음).
    const instaContent = targetCuts.map(c => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean) || null
    if (instaContent && !ep.episode?.instaNum?.trim()) {
      const e = new Error(`이 에피소드의 컷들이 인스타 콘텐츠(${instaContent})인데 episode.instaNum이 없습니다 — 먼저 설정해야 합니다`)
      e.statusCode = 400
      throw e
    }

    const ev = await readFirstSSEEvent('/api/run-flow', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(instaContent
        ? { type: 'insta', content: instaContent, num: ep.episode.instaNum.trim(), prompts }
        : { ep: epNum, prompts }),
    })
    res.json({ ...ev, requestedCuts: targetCuts.map(c => c.no) })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ⑤ studio-approve-g2 — 지정한 컷의 생성된 이미지 중 하나를 G2 선택본으로 승인
mcpRouter.post('/studio-approve-g2', (req, res) => {
  const { episodeId, cutId, imageIndex } = req.body || {}
  if (!episodeId || cutId == null) return res.status(400).json({ error: 'episodeId, cutId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    requireActiveEpisode(state, episodeId)
    const cut = (ep.cuts || []).find(c => String(c.id) === String(cutId) || String(c.no) === String(cutId))
    if (!cut) return res.status(404).json({ error: `컷을 찾을 수 없음: ${cutId}` })

    const epNum = ep.episode?.number
    const byCut = scanFlowImagesByCut(epNum)
    const files = byCut[cut.no] || []
    if (!files.length) return res.status(404).json({ error: `CUT ${cut.no}의 생성된 이미지가 없습니다 (downloads/flow/ep${epNum})` })
    const idx = Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < files.length ? imageIndex : 0
    const filename = files[idx]

    const episodeCode = resolveEpisodeCode(ep.episode, episodeId)
    const gData = loadGpointsFile()
    const epData = { ...gData[episodeCode] }
    const key = `cut_${cut.no}`
    epData[key] = { ...epData[key], g2: true, selectedImage: filename, updatedAt: new Date().toISOString() }
    gData[episodeCode] = epData
    saveGpointsFile(gData)

    const ext = path.extname(filename) || '.jpg'
    const deliverable = copyToDeliverables(
      episodeCode,
      path.join(MEDIA_ROOT, 'downloads', 'flow', `ep${epNum}`, filename),
      `cut_${String(cut.no).padStart(2, '0')}_image${ext}`,
    )
    res.json({ success: true, cutNo: cut.no, selectedImage: filename, availableImages: files, deliverable })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ⑥ studio-run-g3 — ElevenLabs TTS로 대사/나레이션 오디오 생성 (컷당 1개 파일)
mcpRouter.post('/studio-run-g3', async (req, res) => {
  const { episodeId, cutIds } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    requireActiveEpisode(state, episodeId)
    const secretsPath = path.join(CODE_ROOT, 'studio-secrets.json')
    const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) : {}
    const apiKey = secrets.apiKeys?.elevenLabs
    if (!apiKey) return res.status(400).json({ error: 'ElevenLabs API 키가 studio-secrets.json에 없습니다 (스튜디오 앱에서 먼저 연동하세요)' })

    const voiceId = state.ttsSettings?.voiceId || DEFAULT_YEORI_VOICE_ID
    const epNum = ep.episode?.number
    const targetCuts = filterCutsByIds(ep.cuts || [], cutIds).filter(c => c.dialogue?.trim() || c.narration?.trim())
    if (!targetCuts.length) return res.status(400).json({ error: '대사/나레이션이 있는 컷이 없습니다' })

    // 괄호로 섞여 들어온 제작 메모 제거 후 실제로 읽을 텍스트만 남김
    const prepared = targetCuts.map(c => {
      const raw = c.dialogue?.trim() || c.narration?.trim() || ''
      const { clean, removed } = stripStageDirections(raw)
      return { cut: c, text: clean, removed }
    })
    const empties = prepared.filter(p => !p.text)
    const toGenerate = prepared.filter(p => p.text)
    if (!toGenerate.length) return res.status(400).json({ error: '괄호 제거 후 남는 텍스트가 없습니다 (대사가 전부 제작 메모였음)' })

    // ── ElevenLabs 잔여 글자수 사전 체크 — 부족하면 중간에 끊기지 않도록 아예 시작을 막는다 ──
    const totalChars = toGenerate.reduce((sum, p) => sum + p.text.length, 0)
    try {
      const userRes = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': apiKey } })
      if (userRes.ok) {
        const userData = await userRes.json()
        const limit = userData.subscription?.character_limit
        const used = userData.subscription?.character_count
        if (Number.isFinite(limit) && Number.isFinite(used)) {
          const remaining = limit - used
          if (remaining < totalChars) {
            return res.status(400).json({ error: `ElevenLabs 잔여 글자수 부족 (필요: ${totalChars}자, 잔여: ${remaining}자)`, remaining, needed: totalChars })
          }
        }
      }
    } catch { /* 잔여량 조회 자체가 실패해도 생성은 막지 않음 — 사전체크는 보조 수단일 뿐 */ }

    const audioDir = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${epNum}`)
    fs.mkdirSync(audioDir, { recursive: true })

    const results = empties.map(p => ({ cutNo: p.cut.no, status: 'skipped', reason: '괄호 제거 후 텍스트 없음 (제작 메모만 있었음)', removed: p.removed }))
    for (const p of toGenerate) {
      const c = p.cut
      try {
        const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ text: p.text, model_id: 'eleven_multilingual_v2' }),
        })
        if (!upstream.ok) {
          const errBody = await upstream.json().catch(() => ({}))
          results.push({ cutNo: c.no, status: 'error', error: errBody.detail?.message || `HTTP ${upstream.status}` })
          continue
        }
        const buf = Buffer.from(await upstream.arrayBuffer())
        const dest = path.join(audioDir, `cut_${String(c.no).padStart(2, '0')}.mp3`)
        fs.writeFileSync(dest, buf)
        results.push({ cutNo: c.no, status: 'ok', path: dest, ...(p.removed.length ? { removedNotes: p.removed } : {}) })
      } catch (err) {
        results.push({ cutNo: c.no, status: 'error', error: err.message })
      }
    }
    const failCount = results.filter(r => r.status === 'error').length
    const skippedCount = results.filter(r => r.status === 'skipped').length
    res.json({ success: failCount === 0, results, generatedCount: results.filter(r => r.status === 'ok').length, failCount, skippedCount })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ⑦ studio-approve-g3 — G3(TTS) 승인 (cutIds 생략 시 전체 컷)
mcpRouter.post('/studio-approve-g3', (req, res) => {
  const { episodeId, cutIds } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    requireActiveEpisode(state, episodeId)
    const episodeCode = resolveEpisodeCode(ep.episode, episodeId)
    const epNum = ep.episode?.number
    const targetCuts = filterCutsByIds(ep.cuts || [], cutIds)
    const approvedCount = approveGForCuts(episodeCode, targetCuts, 'g3')
    const deliverables = targetCuts.map(c => {
      const padded = String(c.no).padStart(2, '0')
      const result = copyToDeliverables(
        episodeCode,
        path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${epNum}`, `cut_${padded}.mp3`),
        `cut_${padded}_audio.mp3`,
      )
      return { cutNo: c.no, ...result }
    })
    res.json({ success: true, approvedCount, deliverables })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ⑧ studio-run-g4 — video-automation.js 호출(영상 생성). G2 승인된 컷만 대상으로 함
// (video-automation.js가 gpoints.json의 selectedImage를 자체적으로 읽어 스타트 프레임으로 사용)
mcpRouter.post('/studio-run-g4', async (req, res) => {
  const { episodeId, cutIds, ratio } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    requireActiveEpisode(state, episodeId)
    const episodeCode = resolveEpisodeCode(ep.episode, episodeId)
    const gData = loadGpointsFile()[episodeCode] || {}
    let targetCuts = filterCutsByIds(ep.cuts || [], cutIds).filter(c => gData[`cut_${c.no}`]?.g2)
    if (!targetCuts.length) return res.status(400).json({ error: 'G2 승인된 컷이 없습니다 — 먼저 studio_approve_g2를 실행하세요' })

    // ── 크레딧 게이트(G2는 크레딧 소모가 없어 대상 아님, G4만) ──────────────────
    // creditTracker.main.flow.remaining은 사람이 마지막으로 확인/입력한 값(실시간 아님).
    // G4를 실제로 보낼 때마다 여기서 예상 소모량만큼 creditUsage.js에 직접 차감해두므로,
    // 폴링마다 브라우저를 안 건드리고도 어느 정도 정확도를 유지한다(2026-08-16, 사용자 확정
    // 설계 — "남은 만큼만 일부 진행", 완전히 막지 않음).
    const flowCredit = state.creditTracker?.main?.flow
    let skippedForCredit = []
    if (flowCredit) {
      const costPerCut = flowCredit.costPerCut || 12
      const usedToday = getUsedCount('main', 'flow')
      const affordable = Math.max(0, Math.floor((flowCredit.remaining - usedToday * costPerCut) / costPerCut))
      if (affordable <= 0) {
        return res.status(400).json({
          error: '오늘 Flow 크레딧이 부족해서 영상 생성을 진행할 수 없습니다 — 크레딧 탭에서 "자동 확인" 또는 리셋 후 다시 시도하세요',
          remaining: flowCredit.remaining, usedToday, costPerCut,
        })
      }
      if (targetCuts.length > affordable) {
        skippedForCredit = targetCuts.slice(affordable).map(c => c.no)
        targetCuts = targetCuts.slice(0, affordable)
      }
    }

    const epNum = ep.episode?.number
    const prompts = {
      episode: epNum,
      episodeCode, // video-automation.js가 gpoints.json(코드 키 기준)에서 G2 선택 이미지를 찾을 때 씀 —
      // epNum(숫자)만 있으면 gpoints[String(epNum)]이 존재하지 않아 항상 조회 실패 → cut_NN.jpg
      // 폴백으로 빠지는데 실제 생성 파일명은 항상 cut_NN_a/b.jpg라 "입력 이미지 없음"으로 실패함
      // (2026-08-09 실측 테스트에서 발견 — 이 필드가 빠져있던 게 원인).
      cuts: targetCuts.map(c => {
        const dl = c.dialogue?.trim()
        const cleanDl = dl && !/^없음$/i.test(dl) ? stripStageDirections(dl).clean : ''
        return {
          no: c.no,
          imagePrompt: c.imagePrompt || '',
          ...(c.videoPrompt?.trim() ? { videoPrompt: c.videoPrompt.trim() } : {}),
          duration: c.duration || 8,
          ...(cleanDl ? { dialogue: cleanDl } : {}),
        }
      }),
    }

    const ev = await readFirstSSEEvent('/api/run-video', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ep: epNum, ratio: ratio || '9:16', prompts }),
    })
    if (flowCredit && targetCuts.length) recordUsage(targetCuts.length, 'main', 'flow')
    res.json({ ...ev, requestedCuts: targetCuts.map(c => c.no), ...(skippedForCredit.length ? { skippedForCredit } : {}) })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ⑨ studio-approve-g4 — G4(영상) 승인 (cutIds 생략 시 전체 컷)
mcpRouter.post('/studio-approve-g4', (req, res) => {
  const { episodeId, cutIds } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    requireActiveEpisode(state, episodeId)
    const episodeCode = resolveEpisodeCode(ep.episode, episodeId)
    const epNum = ep.episode?.number
    const targetCuts = filterCutsByIds(ep.cuts || [], cutIds)
    const approvedCount = approveGForCuts(episodeCode, targetCuts, 'g4')
    const videoDir = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`)
    const deliverables = targetCuts.map(c => {
      const padded = String(c.no).padStart(2, '0')
      // 편집(_final) 버전이 있으면 그걸, 없으면 원본 생성본을 사용 — buildStudioStatusPayload의
      // videoDir 스캔(mFin 우선)과 동일한 우선순위.
      const finalPath = path.join(videoDir, `cut_${padded}_final.mp4`)
      const basePath  = path.join(videoDir, `cut_${padded}.mp4`)
      const srcPath = fs.existsSync(finalPath) ? finalPath : basePath
      const result = copyToDeliverables(episodeCode, srcPath, `cut_${padded}_video.mp4`)
      return { cutNo: c.no, ...result }
    })
    res.json({ success: true, approvedCount, deliverables })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ⑩ studio-run-g5 — 편집 메타 생성 → SRT 생성 → 컷 영상 순서대로 합치기(FFmpeg concat)
mcpRouter.post('/studio-run-g5', async (req, res) => {
  const { episodeId } = req.body || {}
  if (!episodeId) return res.status(400).json({ error: 'episodeId 필요' })
  try {
    const state = loadStudioState()
    const ep = getEpisodeOrThrow(state, episodeId)
    requireActiveEpisode(state, episodeId)
    const epNum = ep.episode?.number
    const cuts = ep.cuts || []

    let cursor = 0
    const meta = cuts.map(c => {
      const dur = c.duration || 5
      const start = cursor
      cursor += dur
      // SRT 자막에 괄호 안 제작 메모가 그대로 노출되지 않도록 G3와 동일하게 정리
      return {
        cutNo: String(c.no).padStart(2, '0'),
        label: `CUT ${String(c.no).padStart(2, '0')}`,
        start, end: cursor, duration: dur,
        audioFile: `cut_${String(c.no).padStart(2, '0')}.mp3`,
        dialogue: c.dialogue ? stripStageDirections(c.dialogue).clean : '',
        narration: c.narration ? stripStageDirections(c.narration).clean : '',
      }
    })
    const metaPath = path.join(MEDIA_ROOT, 'downloads', 'video', 'yeori_edit_meta.json')
    fs.mkdirSync(path.dirname(metaPath), { recursive: true })
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

    const srtRes = await selfFetch('/api/generate-srt', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ epNum }),
    })
    if (srtRes.status !== 200) return res.status(srtRes.status).json({ step: 'generate-srt', ...srtRes.body })

    const concatRes = await selfFetch('/api/concat-video', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ epNum }),
    })
    if (concatRes.status !== 200) return res.status(concatRes.status).json({ step: 'concat-video', ...concatRes.body })

    const episodeCode = resolveEpisodeCode(ep.episode, episodeId)
    const deliverable = copyToDeliverables(
      episodeCode,
      path.join(MEDIA_ROOT, 'downloads', 'output', `ep${epNum}`, `ep${epNum}_raw.mp4`),
      `${episodeCode}_edit_raw.mp4`,
    )
    // G1~G4와 동일한 패턴으로 gpoints에 G5 완료 기록 — 이게 없으면 concat까지 성공해도
    // summary.g5가 계속 0으로 남아 "G5 미완료"로 잘못 보고됨(2026-08-17 발견).
    const approvedCount = approveGForCuts(episodeCode, cuts, 'g5')
    res.json({ success: true, srt: srtRes.body, concat: concatRes.body, deliverable, approvedCount })
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// ⑪ studio-status — 현재(또는 지정) 에피소드의 컷별 G1~G5 진행 상태 + 산출물 존재 여부
function buildStudioStatusPayload(episodeId) {
  const state = loadStudioState()
  const ep = episodeId ? getEpisodeOrThrow(state, episodeId) : state.episodes?.[state.activeEpisodeId]
  if (!ep) {
    const e = new Error('에피소드를 찾을 수 없습니다 (episodeId 지정 또는 studio_set_episode 먼저 실행)')
    e.statusCode = 404
    throw e
  }

  const epNum = ep.episode?.number
  const episodeCode = resolveEpisodeCode(ep.episode, episodeId ?? state.activeEpisodeId)
  const cuts = ep.cuts || []
  const gData = loadGpointsFile()[episodeCode] || {}

  const flowDir  = path.join(MEDIA_ROOT, 'downloads', 'flow',  `ep${epNum}`)
  const videoDir = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`)
  const audioDir = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${epNum}`)
  const hasFile = (dir, re) => fs.existsSync(dir) && fs.readdirSync(dir).some(f => re.test(f))

  const cutStatus = cuts.map(c => {
    const g = gData[`cut_${c.no}`] || {}
    const padded = String(c.no).padStart(2, '0')
    return {
      no: c.no,
      g1: !!g.g1, g2: !!g.g2, g3: !!g.g3, g4: !!g.g4, g5: !!g.g5,
      selectedImage: g.selectedImage || null,
      hasImage: hasFile(flowDir, new RegExp(`^cut_${padded}(_[ab])?\\.(jpg|jpeg|png|webp)$`, 'i')),
      hasAudio: fs.existsSync(path.join(audioDir, `cut_${padded}.mp3`)),
      hasVideo: hasFile(videoDir, new RegExp(`^cut_${padded}(_final)?\\.mp4$`, 'i')),
      cutType: c.cutType,
      hasDialogue: c.dialogue?.trim() ? true : false,
      hasNarration: c.narration?.trim() ? true : false,
    }
  })

  const summary = ['g1', 'g2', 'g3', 'g4', 'g5'].reduce((acc, k) => {
    acc[k] = cutStatus.filter(c => c[k]).length
    return acc
  }, {})

  return {
    episodeId: episodeId || state.activeEpisodeId,
    episode: ep.episode,
    cutCount: cuts.length,
    summary,
    cuts: cutStatus,
  }
}

mcpRouter.get('/studio-status', (req, res) => {
  try {
    res.json(buildStudioStatusPayload(req.query.episodeId))
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

app.use('/api/mcp', mcpRouter)

// GET /api/studio-status-public — content_matrix_v3.html(정적 파일, 시크릿 보관 불가) 전용
// 읽기전용 상태 조회. /api/mcp/studio-status와 로직은 동일하나 인증 없이 노출한다
// (로컬 전용 서버라 실질 위험은 낮음). 상태를 변경하는 studio-run-*/approve-* 계열은
// 여기 노출하지 않고 Bearer 인증이 걸린 /api/mcp 경로로만 유지한다.
app.get('/api/studio-status-public', (req, res) => {
  try {
    res.json(buildStudioStatusPayload(req.query.episodeId))
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message })
  }
})

// start_yeori.bat가 [0] 단계에서 기존 프로세스를 taskkill한 직후(1초 대기) 바로 이
// 프록시를 재기동하는데, OS가 소켓을 즉시 회수하지 못하면 EADDRINUSE가 날 수 있다.
// 즉시 죽는 대신 잠깐 재시도해서 이런 타이밍 경합을 흡수한다.
const LISTEN_RETRY_MAX = 5
const LISTEN_RETRY_DELAY_MS = 1000
let listenAttempt = 0

function startServer() {
  const server = app.listen(PORT, () => {
    console.log('')
    console.log('  ✦ 여리 Studio 프록시 서버')
    console.log(`  → http://localhost:${PORT}`)
    console.log('  → Claude / ElevenLabs API 요청을 중계합니다')
    console.log('')
    logToFile(`포트 ${PORT} 바인딩 성공 (attempt ${listenAttempt + 1})`)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && listenAttempt < LISTEN_RETRY_MAX) {
      listenAttempt++
      console.error(`  ⚠ 포트 ${PORT} 아직 사용 중 -- ${LISTEN_RETRY_DELAY_MS}ms 후 재시도 (${listenAttempt}/${LISTEN_RETRY_MAX})`)
      logToFile(`EADDRINUSE, 재시도 ${listenAttempt}/${LISTEN_RETRY_MAX}`)
      setTimeout(startServer, LISTEN_RETRY_DELAY_MS)
      return
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ❌ 포트 ${PORT} 이미 사용 중입니다 (재시도 ${LISTEN_RETRY_MAX}회 실패).`)
      console.error(`  → 기존 프록시 프로세스를 종료 후 다시 실행하세요.\n`)
      logToFile(`FATAL EADDRINUSE, 재시도 ${LISTEN_RETRY_MAX}회 모두 실패, 종료`)
    } else {
      console.error(`\n  ❌ 서버 오류: ${err.message}\n`)
      logToFile(`FATAL server error: ${err.stack || err.message}`)
    }
    process.exit(1)
  })
}

startServer()
