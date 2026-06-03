import express from 'express'
import cors from 'cors'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const app = express()
const PORT = 3001

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
app.use(express.json({ limit: '10mb' }))

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

      const videoFile = path.join(dir, `C${cutNum}_video.mp4`)
      const outFile   = path.join(outputDir, `C${cutNum}_final.mp4`)
      const logFile   = path.join(outputDir, `C${cutNum}_ffmpeg.log`)
      const dur       = parseFloat(m.duration)

      let args
      if (m.sfxOnly || !m.audioFile) {
        args = ['-i', videoFile, '-c:v', 'copy', '-an', outFile, '-y']
      } else {
        const audioFile  = path.join(dir, m.audioFile)
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

app.listen(PORT, () => {
  console.log('')
  console.log('  ✦ 여리 Studio 프록시 서버')
  console.log(`  → http://localhost:${PORT}`)
  console.log('  → Claude / ElevenLabs API 요청을 중계합니다')
  console.log('')
})
