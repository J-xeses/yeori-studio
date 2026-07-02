/**
 * STS 후처리 단독 테스트 스크립트
 *
 * 사용법:
 *   node scripts/test-sts.js --ep=2 --cut=1
 *
 * 사전 준비:
 *   pip install demucs   (최초 1회)
 *
 * 동작:
 *   1. demucs → 대사(cut_NN_voice.mp3) + 배경음(cut_NN_background.mp3) 분리
 *   2. ElevenLabs STS → 대사를 서여리 목소리로 변환(cut_NN_yeori_voice.mp3)
 *   3. FFmpeg → 영상(무음) + 서여리 음성 + 배경음 3트랙 합성 → cut_NN_final.mp4
 */

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MEDIA_ROOT = 'C:\\yeori-studio'
const FFMPEG     = 'C:\\ffmpeg\\bin\\ffmpeg.exe'

const ENV_SEARCH_DIRS = [
  MEDIA_ROOT,
  'C:\\Users\\won56\\OneDrive - CTEC\\문서\\GitHub\\yeori-studio\\yeori-studio',
  'C:\\Users\\user\\Desktop\\yeori-studio\\yeori-studio',
]

function loadEnvFiles() {
  for (const dir of ENV_SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue
    for (const name of ['.env', '.env.local']) {
      const envPath = path.join(dir, name)
      if (!fs.existsSync(envPath)) continue
      let loaded = 0
      fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
        const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
        if (m) { process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, ''); loaded++ }
      })
      if (loaded > 0) log('info', `env 로드: ${envPath} (${loaded}개 항목)`)
    }
  }
}

function parseArgs() {
  return Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] })
  )
}

function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19)
  const prefix = { info: 'ℹ️ ', ok: '✅', warn: '⚠️ ', error: '❌', step: '⏳' }
  console.log(`[${ts}] ${prefix[level] ?? '  '} ${msg}`)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args)
    let errBuf = ''
    proc.stderr.on('data', chunk => { errBuf += chunk.toString() })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg 종료코드 ${code}: ${errBuf.slice(-400)}`))
    })
    proc.on('error', err => reject(new Error(`FFmpeg 실행 오류: ${err.message}`)))
  })
}

async function main() {
  const args = parseArgs()
  loadEnvFiles()

  const ep  = args.ep
  const cut = args.cut

  if (!ep || !cut) {
    console.error('사용법: node scripts/test-sts.js --ep=<에피소드> --cut=<컷번호>')
    console.error('예시:   node scripts/test-sts.js --ep=2 --cut=1')
    process.exit(1)
  }

  const padded      = String(cut).padStart(2, '0')
  const videoDir    = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${ep}`)
  const audioDir    = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${ep}`)
  const videoPath   = path.join(videoDir,  `cut_${padded}.mp4`)
  const voicePath   = path.join(audioDir,  `cut_${padded}_voice.mp3`)
  const bgPath      = path.join(audioDir,  `cut_${padded}_background.mp3`)
  const yeoriVoice  = path.join(audioDir,  `cut_${padded}_yeori_voice.mp3`)
  const finalPath   = path.join(videoDir,  `cut_${padded}_final.mp4`)
  const apiKey      = process.env.ELEVENLABS_API_KEY
  const voiceId     = process.env.ELEVENLABS_VOICE_ID || 'RmYuvmCbqOMBJxDLW4k8'

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  🎙️  STS 후처리 테스트 (Audio Isolation 포함)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  에피소드 : EP${ep}  /  CUT ${cut} → ${padded}`)
  console.log(`  입력 영상 : ${videoPath}`)
  console.log(`  대사 음성 : ${voicePath}`)
  console.log(`  배경 음악 : ${bgPath}`)
  console.log(`  분리 엔진 : demucs (htdemucs 모델)`)
  console.log(`  변환 음성 : ${yeoriVoice}`)
  console.log(`  출력 영상 : ${finalPath}`)
  console.log(`  Voice ID  : ${voiceId}`)
  console.log(`  API Key   : ${apiKey ? apiKey.slice(0, 8) + '…' : '(없음 — .env 확인 필요)'}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // 사전 검증
  if (!apiKey) {
    log('error', 'ELEVENLABS_API_KEY 없음. .env 또는 .env.local에 ELEVENLABS_API_KEY=sk-... 추가 필요')
    process.exit(1)
  }
  if (!fs.existsSync(videoPath)) {
    log('error', `입력 영상 없음: ${videoPath}`)
    process.exit(1)
  }
  if (!fs.existsSync(FFMPEG)) {
    log('error', `FFmpeg 없음: ${FFMPEG}`)
    process.exit(1)
  }

  ensureDir(audioDir)

  // ── Step 1: demucs 음원 분리 ──────────────────────────────────────────
  // demucs는 딥러닝 기반 음원 분리 도구로 위상 반전 방식과 달리 목소리 잔상이 없음
  // 출력 구조: <demucsOut>/htdemucs/<stem>/<파일명>/vocals.mp3, no_vocals.mp3
  log('step', `[1/3] demucs 음원 분리: ${path.basename(videoPath)} → 대사 + 배경음`)

  const demucsOut  = path.join(audioDir, 'demucs')
  const stemName   = path.basename(videoPath, path.extname(videoPath))
  const demucsVocals   = path.join(demucsOut, 'htdemucs', stemName, 'vocals.mp3')
  const demucsNoBg     = path.join(demucsOut, 'htdemucs', stemName, 'no_vocals.mp3')

  ensureDir(demucsOut)

  await new Promise((resolve, reject) => {
    const proc = spawn('python', [
      '-m', 'demucs',
      '--two-stems=vocals',
      '--mp3',
      '-o', demucsOut,
      videoPath,
    ])
    proc.stdout.on('data', chunk => process.stdout.write(chunk))
    proc.stderr.on('data', chunk => process.stderr.write(chunk))
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`demucs 종료코드 ${code} — pip install demucs 실행 여부 확인`))
    })
    proc.on('error', err => reject(new Error(`demucs 실행 오류: ${err.message} — pip install demucs 실행 여부 확인`)))
  })

  // demucs 결과를 audioDir의 명명 규칙에 맞게 복사
  fs.copyFileSync(demucsVocals, voicePath)
  fs.copyFileSync(demucsNoBg,   bgPath)
  log('ok', `  대사 분리: ${path.basename(voicePath)} (${(fs.statSync(voicePath).size / 1024).toFixed(1)} KB)`)
  log('ok', `  배경음 분리: ${path.basename(bgPath)} (${(fs.statSync(bgPath).size / 1024).toFixed(1)} KB)`)

  // ── Step 2: STS — 대사 → 서여리 목소리 변환 ──────────────────────────
  log('step', `[2/3] ElevenLabs STS 변환 (eleven_multilingual_sts_v2, voice: ${voiceId})`)

  const voiceBuffer = fs.readFileSync(voicePath)
  const voiceBlob   = new Blob([voiceBuffer], { type: 'audio/mpeg' })
  const fdSts = new FormData()
  fdSts.append('audio', voiceBlob, 'voice.mp3')
  fdSts.append('model_id', 'eleven_multilingual_sts_v2')
  fdSts.append('voice_settings', JSON.stringify({ stability: 0.30, similarity_boost: 0.75, speed: 1.0 }))

  const stsRes = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}`, {
    method:  'POST',
    headers: { 'xi-api-key': apiKey },
    body:    fdSts,
  })
  if (!stsRes.ok) {
    const errText = await stsRes.text()
    log('error', `STS API 오류 (HTTP ${stsRes.status}): ${errText.slice(0, 300)}`)
    process.exit(1)
  }
  fs.writeFileSync(yeoriVoice, Buffer.from(await stsRes.arrayBuffer()))
  log('ok', `STS 변환 완료: ${path.basename(yeoriVoice)} (${(fs.statSync(yeoriVoice).size / 1024).toFixed(1)} KB)`)

  // ── Step 3: FFmpeg 3트랙 합성 ─────────────────────────────────────────
  // 입력0: cut_NN.mp4  → 비디오 스트림만 사용 (오디오 무시)
  // 입력1: yeori_voice → 서여리 대사
  // 입력2: background  → 배경음
  // 오디오: [1:a][2:a] amix → aac
  log('step', `[3/3] FFmpeg 3트랙 합성 → ${path.basename(finalPath)}`)
  await runFfmpeg([
    '-y',
    '-i', videoPath,
    '-i', yeoriVoice,
    '-i', bgPath,
    '-filter_complex', '[1:a][2:a]amix=inputs=2:normalize=0[aout]',
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    finalPath,
  ])
  const finalSize = (fs.statSync(finalPath).size / (1024 * 1024)).toFixed(2)
  log('ok', `합성 완료: ${path.basename(finalPath)} (${finalSize} MB)`)

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  ✅ STS 후처리 완료')
  console.log(`  출력: ${finalPath}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main().catch(err => {
  log('error', err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
