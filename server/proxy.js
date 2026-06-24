import express from 'express'
import cors from 'cors'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [
  { label: '회사 PC', p: 'C:\\Users\\won56\\OneDrive - CTEC\\문서\\GitHub\\yeori-studio\\yeori-studio' },
  { label: '집 PC',   p: 'C:\\Users\\user\\Desktop\\yeori-studio\\yeori-studio' },
]
const CODE_ROOT = (() => {
  for (const { label, p } of CANDIDATES) {
    if (
      fs.existsSync(p) &&
      fs.existsSync(path.join(p, 'node_modules')) &&
      fs.existsSync(path.join(p, 'package.json'))
    ) {
      console.log(`[CODE_ROOT] ${label}: ${p}`)
      return p
    }
  }
  console.error('[ERROR] CODE_ROOT 경로를 찾을 수 없습니다.')
  process.exit(1)
})()
const MEDIA_ROOT = 'C:\\yeori-studio'
const ROOT = CODE_ROOT  // 하위 호환 유지

// ── .env.local 로드 (CODE_ROOT 기준) ──────────────────────────
;(() => {
  const envPath = path.join(CODE_ROOT, '.env.local')
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^=\s#][^=]*)=(.*)$/)
    if (m) { const k = m[1].trim(); if (!process.env[k]) process.env[k] = m[2].trim() }
  })
})()
const HIGGSFIELD_API_KEY = process.env.HIGGSFIELD_API_KEY || ''

const app = express()
const PORT = 3001

// Node.js 18+에서 unhandledRejection이 프로세스를 종료하지 않도록 처리
process.on('unhandledRejection', (reason) => {
  console.error('[proxy] unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[proxy] uncaughtException:', err.message)
})

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
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

// ── POST /api/run-flow — prompts 저장 후 Flow 자동 실행 (SSE) ──
app.post('/api/run-flow', (req, res) => {
  const { ep, prompts, projectId } = req.body
  if (!prompts) return res.status(400).json({ error: 'prompts 데이터 필요' })

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
  const episode = prompts.episode ?? ep ?? null

  // project_url.txt 사전 확인 — 없으면 flow-automation.js가 stdin을 기다려 hang됨
  if (episode != null) {
    const epDir = path.join(MEDIA_ROOT, 'downloads', 'flow', `ep${episode}`)
    const projectMarker = path.join(epDir, 'project_url.txt')

    // projectId가 요청에 포함된 경우 project_url.txt 자동 생성
    if (projectId && !fs.existsSync(projectMarker)) {
      fs.mkdirSync(epDir, { recursive: true })
      const projectUrl = `https://labs.google/fx/ko/tools/flow/project/${String(projectId).trim()}`
      fs.writeFileSync(projectMarker, projectUrl, 'utf-8')
      send({ type: 'log', level: 'info', message: `Flow 프로젝트 등록 완료: ${projectUrl}` })
    }

    if (!fs.existsSync(projectMarker)) {
      send({ type: 'error', message: `Flow 프로젝트 미등록 (ep${episode})\nproject_url.txt 없음 — 터미널에서 직접 실행하여 프로젝트 ID를 등록하세요:\n  node scripts/flow-automation.js --ep=${episode}` })
      res.end()
      return
    }
  }

  const scriptPath = path.join(ROOT, 'scripts', 'flow-automation.js')
  const nodeArgs = [scriptPath]
  if (episode != null) nodeArgs.push(`--ep=${episode}`)

  console.log(`[run-flow] EP=${episode ?? 'all'} (req.ep=${ep ?? 'none'}, prompts.episode=${prompts.episode ?? 'none'})`)
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
      if (episode != null) {
        const padded = String(cutNo).padStart(2, '0')
        const epUrlBase = `/downloads/flow/ep${episode}`
        const epDirPath = path.join(MEDIA_ROOT, 'downloads', 'flow', `ep${episode}`)
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
  const { ep, ratio, prompts } = req.body
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
  if (ratio)           nodeArgs.push(`--ratio=${ratio}`)

  console.log(`[run-video] EP=${episode ?? 'all'} ratio=${ratio ?? '9:16'} (req.ep=${ep ?? 'none'}, prompts.episode=${prompts.episode ?? 'none'})`)
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

    const ffmpeg = 'C:\\ffmpeg\\bin\\ffmpeg.exe'
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

// ── POST /api/run-ffmpeg — 영상+음성 FFmpeg 합성 (SSE) ──
app.post('/api/run-ffmpeg', (req, res) => {
  const { ep, cutNo } = req.body
  if (!ep || cutNo == null) return res.status(400).json({ error: 'ep, cutNo 필요' })

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

  const ffmpeg = 'C:\\ffmpeg\\bin\\ffmpeg.exe'
  const args = [
    '-y',
    '-i', videoFile,
    '-i', audioFile,
    '-filter_complex', '[1:a]apad=whole_dur=8[a]',
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
const FFPROBE = 'C:\\ffmpeg\\bin\\ffprobe.exe'
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

    const ffmpeg = 'C:\\ffmpeg\\bin\\ffmpeg.exe'
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

// ── POST /api/analyze-video — cut 영상 → Higgsfield 분석 시작 ──
app.post('/api/analyze-video', async (req, res) => {
  const { epNum, cutNo } = req.body
  if (!epNum || cutNo == null) return res.status(400).json({ error: 'epNum, cutNo 필요' })
  if (!HIGGSFIELD_API_KEY) return res.status(500).json({ error: 'HIGGSFIELD_API_KEY 미설정 (.env.local 확인)' })

  const padded   = String(cutNo).padStart(2, '0')
  const videoDir = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`)
  const finalP   = path.join(videoDir, `cut_${padded}_final.mp4`)
  const rawP     = path.join(videoDir, `cut_${padded}.mp4`)
  const videoFile = fs.existsSync(finalP) ? finalP : fs.existsSync(rawP) ? rawP : null
  if (!videoFile) return res.status(404).json({ error: '영상 파일을 찾을 수 없습니다' })

  try {
    // ① 영상 업로드 (multipart/form-data)
    // TODO: Higgsfield media upload 정확한 엔드포인트 확인
    const formData = new FormData()
    const buf = fs.readFileSync(videoFile)
    formData.append('file', new Blob([buf], { type: 'video/mp4' }), path.basename(videoFile))

    const uploadRes = await fetch('https://api.higgsfield.ai/v1/media/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${HIGGSFIELD_API_KEY}` },
      body: formData,
    })
    if (!uploadRes.ok) {
      const t = await uploadRes.text()
      return res.status(502).json({ error: `Higgsfield 업로드 실패 (${uploadRes.status}): ${t.slice(0,200)}` })
    }
    const upData = await uploadRes.json()
    const mediaId = upData.id || upData.media_id || upData.data?.id

    // ② 분석 생성
    // TODO: Higgsfield video analysis 정확한 엔드포인트 확인
    const anaRes = await fetch('https://api.higgsfield.ai/v1/video-analysis', {
      method: 'POST',
      headers: { Authorization: `Bearer ${HIGGSFIELD_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_input_id: mediaId }),
    })
    if (!anaRes.ok) {
      const t = await anaRes.text()
      return res.status(502).json({ error: `Higgsfield 분석 시작 실패 (${anaRes.status}): ${t.slice(0,200)}` })
    }
    const anaData = await anaRes.json()
    const analysisId = anaData.id || anaData.analysis_id || anaData.data?.id

    res.json({ success: true, analysisId, status: 'queued', message: '분석 시작됨. /api/analysis-status로 폴링하세요' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/analysis-status — 분석 상태 폴링 → episode_style_guide.json 저장 ──
app.post('/api/analysis-status', async (req, res) => {
  const { analysisId, epNum, cutNo } = req.body
  if (!analysisId || !epNum) return res.status(400).json({ error: 'analysisId, epNum 필요' })
  if (!HIGGSFIELD_API_KEY) return res.status(500).json({ error: 'HIGGSFIELD_API_KEY 미설정' })

  try {
    // TODO: Higgsfield video analysis status 정확한 엔드포인트 확인
    const r = await fetch(`https://api.higgsfield.ai/v1/video-analysis/${analysisId}`, {
      headers: { Authorization: `Bearer ${HIGGSFIELD_API_KEY}` },
    })
    if (!r.ok) {
      const t = await r.text()
      return res.status(502).json({ error: `Higgsfield 상태 조회 실패 (${r.status}): ${t.slice(0,200)}` })
    }
    const data = await r.json()
    const status = data.status || data.state

    if (status !== 'completed') return res.json({ success: true, status: 'in_progress' })

    // ── 완료 → 데이터 추출 ─────────────────────────────────────
    const scenes = data.scenes || data.data?.scenes || []
    const scene  = scenes[0] || {}
    const visual = scene.visual || scene.description || ''
    const shotType = scene.shot_type || scene.shotType || ''

    const extr = (re) => { const m = visual.match(re); return m ? m[1].trim() : '' }

    const ageAppearance = extr(/approximately ([\d\-\s]+years? old[^,.\n]*)/i)
      || 'approximately 20-25 years old, appearing no older than 24-25'
    const skin    = extr(/([\w\s]+skin[^,.\n]*)/i) || ''
    const hair    = extr(/([\w\s]+hair[^,.\n]*)/i) || ''
    const outfit  = visual.match(/wearing ([^.]+)/i)?.[1]?.trim() || ''
    const lighting = extr(/([\w\s]+lighting[^,.\n]*)/i) || ''
    const colorPalette = extr(/(color palette[^,.\n]*)/i) || extr(/([\w\s]+palette[^,.\n]*)/i) || ''
    const bg      = extr(/(background[^,.\n]+)/i) || ''
    const camera  = shotType || extr(/([\w\-]+ shot[^,.\n]*)/i) || ''

    const promptPrefix = [
      ageAppearance, skin, hair,
      'small natural beauty mark on right cheek',
      'K-model proportions, small face to body ratio, slim delicate frame, tall, long legs',
      outfit, lighting, colorPalette,
    ].filter(Boolean).join(', ')

    const styleGuide = {
      epNum, generatedAt: new Date().toISOString(),
      sourceCut: `cut_${String(cutNo || 1).toString().padStart(2, '0')}`,
      analysisId,
      character: {
        face: {
          ageAppearance,
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
      outfit: outfit ? { description: outfit } : {},
      cinematography: {
        lighting,
        colorPalette,
        background: bg ? `${bg}, background must not interact with subject` : 'background must not interact with subject',
        cameraStyle: camera,
      },
      promptPrefix,
    }

    const savePath = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${epNum}`, 'episode_style_guide.json')
    fs.mkdirSync(path.dirname(savePath), { recursive: true })
    fs.writeFileSync(savePath, JSON.stringify(styleGuide, null, 2), 'utf-8')

    res.json({ success: true, status: 'completed', styleGuide, savedPath: savePath })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const server = app.listen(PORT, () => {
  console.log('')
  console.log('  ✦ 여리 Studio 프록시 서버')
  console.log(`  → http://localhost:${PORT}`)
  console.log('  → Claude / ElevenLabs API 요청을 중계합니다')
  console.log('')
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌ 포트 ${PORT} 이미 사용 중입니다.`)
    console.error(`  → 기존 프록시 프로세스를 종료 후 다시 실행하세요.\n`)
  } else {
    console.error(`\n  ❌ 서버 오류: ${err.message}\n`)
  }
  process.exit(1)
})
