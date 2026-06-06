/**
 * G4 자동화 - FFmpeg 영상 편집
 *
 * 사용법:
 *   npm run edit                       # downloads/flow/prompts.json 기반
 *   npm run edit -- --ep=2             # 에피소드 지정
 *   npm run edit -- --cut=3            # 특정 컷만
 *   npm run edit -- --no-concat        # 개별 컷만 생성 (최종 합치기 건너뜀)
 *   npm run edit -- --prompts=my.json # 외부 프롬프트 파일
 *
 * .env.local 선택:
 *   FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
 *   FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
 *
 * 입력:
 *   downloads/flow/ep{N}/cut_01.jpg ~ cut_07.jpg
 *   downloads/audio/ep{N}/cut_01.mp3 ~ cut_07.mp3
 *
 * 출력:
 *   downloads/output/ep{N}/cut_01.mp4 ~ cut_07.mp4
 *   downloads/output/ep{N}/ep{N}_final.mp4
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawnSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

;['.env', '.env.local'].forEach(name => {
  const envPath = path.join(ROOT, name)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '')
  })
})

const CONFIG = {
  downloadDir:  path.join(ROOT, 'downloads'),
  hooksDir:     path.join(ROOT, 'downloads', 'hooks'),
  ffmpeg:       process.env.FFMPEG_PATH  ?? 'ffmpeg',
  ffprobe:      process.env.FFPROBE_PATH ?? 'ffprobe',
  videoCodec:   'libx264',
  audioCodec:   'aac',
  crf:          18,
  fps:          30,
  defaultDur:   5,   // 음성 없는 컷 기본 길이(초)
  silencePad:   0.5, // 음성 끝 여운 패딩(초)
}

const args = parseArgs()

function parseArgs() {
  return Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
      const [k, v] = a.slice(2).split('=')
      return [k, v ?? true]
    })
  )
}

function log(level, msg) {
  const prefix = { info: 'ℹ️ ', ok: '✅', warn: '⚠️ ', error: '❌', step: '⏳' }
  console.log(`${prefix[level] ?? '  '} ${msg}`)
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function getPromptsMeta() {
  const file = args.prompts
    ? path.resolve(args.prompts)
    : path.join(CONFIG.downloadDir, 'flow', 'prompts.json')
  if (!fs.existsSync(file)) {
    log('error', `prompts.json 없음: ${file}`)
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  return { episode: raw.episode ?? 'x', title: raw.title ?? '', hookClip: raw.hookClip ?? null }
}

function prepareHookClip(hookId, outputDir, targetW, targetH) {
  const hookPath = path.join(CONFIG.hooksDir, `${hookId}.mp4`)
  if (!fs.existsSync(hookPath)) {
    log('warn', `훅 클립 없음: ${hookPath}`)
    return null
  }
  const hookOut = path.join(outputDir, `_hook_${hookId}.mp4`)
  log('step', `훅 클립 인코딩 중: ${hookId} → ${targetW}×${targetH}`)
  runFFmpeg([
    '-y', '-i', hookPath,
    '-c:v', CONFIG.videoCodec,
    '-crf', String(CONFIG.crf),
    '-vf', `scale=${targetW}:${targetH},fps=${CONFIG.fps},format=yuv420p`,
    '-c:a', CONFIG.audioCodec, '-b:a', '192k',
    '-movflags', '+faststart',
    hookOut,
  ], `hook-${hookId}`)
  const dur = getAudioDuration(hookOut)
  log('ok', `훅 클립 준비 완료 (${dur.toFixed(1)}초)`)
  return hookOut
}

function getAudioDuration(filePath) {
  try {
    const out = execSync(
      `"${CONFIG.ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    return parseFloat(out) || CONFIG.defaultDur
  } catch {
    return CONFIG.defaultDur
  }
}

function runFFmpeg(ffArgs, label) {
  const result = spawnSync(CONFIG.ffmpeg, ffArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error(`FFmpeg 실패 [${label}]:\n${(result.stderr ?? '').slice(-600)}`)
  }
}

function buildCutVideo(imagePath, audioPath, outputPath) {
  // 음성 길이 = 영상 길이, 끝에 silence pad 추가
  const audioDur = getAudioDuration(audioPath)
  const videoDur = audioDur + CONFIG.silencePad

  // adelay=0, apad로 음성 길이를 영상 길이에 맞춤
  runFFmpeg([
    '-y',
    '-loop', '1', '-t', String(videoDur), '-i', imagePath,
    '-i', audioPath,
    '-c:v', CONFIG.videoCodec,
    '-crf', String(CONFIG.crf),
    '-tune', 'stillimage',
    '-vf', `fps=${CONFIG.fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
    '-c:a', CONFIG.audioCodec, '-b:a', '192k',
    '-af', `adelay=0|0,apad=pad_dur=${CONFIG.silencePad}`,
    '-t', String(videoDur),
    '-movflags', '+faststart',
    outputPath,
  ], path.basename(outputPath))

  return videoDur
}

function buildSlideVideo(imagePath, outputPath, duration) {
  runFFmpeg([
    '-y',
    '-loop', '1', '-t', String(duration), '-i', imagePath,
    '-c:v', CONFIG.videoCodec,
    '-crf', String(CONFIG.crf),
    '-tune', 'stillimage',
    '-vf', `fps=${CONFIG.fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
    '-movflags', '+faststart',
    outputPath,
  ], path.basename(outputPath))
}

function concatVideos(cutPaths, outputPath) {
  const listFile = outputPath.replace(/\.mp4$/, '_list.txt')
  const content = cutPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n')
  fs.writeFileSync(listFile, content, 'utf-8')
  try {
    runFFmpeg([
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c', 'copy',
      outputPath,
    ], 'concat')
  } finally {
    fs.unlinkSync(listFile)
  }
}

async function main() {
  const { episode, title, hookClip: metaHook } = getPromptsMeta()
  const hookId = args['no-hook'] ? null : (args.hook ?? metaHook ?? null)

  const flowDir   = path.join(CONFIG.downloadDir, 'flow',   `ep${episode}`)
  const audioDir  = path.join(CONFIG.downloadDir, 'audio',  `ep${episode}`)
  const outputDir = path.join(CONFIG.downloadDir, 'output', `ep${episode}`)

  if (!fs.existsSync(flowDir)) {
    log('error', `이미지 폴더 없음: ${flowDir}`)
    log('info', 'npm run flow 로 이미지를 먼저 생성하세요.')
    process.exit(1)
  }

  ensureDir(outputDir)

  // 컷 파일 수집
  const cutFilter = args.cut ? `cut_${String(args.cut).padStart(2, '0')}` : null

  const imageFiles = fs.readdirSync(flowDir)
    .filter(f => /^cut_\d+\.(jpg|jpeg|png)$/i.test(f))
    .filter(f => !cutFilter || f.startsWith(cutFilter))
    .sort()
    .map(f => path.join(flowDir, f))

  const audioMap = {}
  if (fs.existsSync(audioDir)) {
    fs.readdirSync(audioDir)
      .filter(f => /^cut_\d+\.mp3$/i.test(f))
      .filter(f => !cutFilter || f.startsWith(cutFilter ?? ''))
      .forEach(f => {
        const key = path.basename(f, '.mp3')  // cut_01
        audioMap[key] = path.join(audioDir, f)
      })
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  🎬 여리 스튜디오 - G4 영상 편집 자동화')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  에피소드: ${episode}${title ? ` — ${title}` : ''}`)
  console.log(`  이미지:   ${imageFiles.length}개`)
  console.log(`  음성:     ${Object.keys(audioMap).length}개`)
  console.log(`  저장:     downloads/output/ep${episode}/`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (!imageFiles.length) {
    log('error', `이미지 파일 없음: ${flowDir}`)
    process.exit(1)
  }

  let ok = 0, fail = 0
  const outputCuts = []
  let totalDur = 0

  for (let i = 0; i < imageFiles.length; i++) {
    const imgPath  = imageFiles[i]
    const base     = path.basename(imgPath, path.extname(imgPath))  // cut_01
    const cutNo    = parseInt(base.replace(/\D/g, ''), 10)
    const audioPath = audioMap[base]
    const outPath  = path.join(outputDir, `${base}.mp4`)
    const label    = `[${i + 1}/${imageFiles.length}] CUT ${cutNo}`

    log('step', `${label} 합성 중…`)
    try {
      if (audioPath) {
        const dur = buildCutVideo(imgPath, audioPath, outPath)
        totalDur += dur
        log('ok', `${label} → ${path.relative(ROOT, outPath)} (${dur.toFixed(1)}초)`)
      } else {
        log('warn', `${label} 음성 없음 → ${CONFIG.defaultDur}초 슬라이드`)
        buildSlideVideo(imgPath, outPath, CONFIG.defaultDur)
        totalDur += CONFIG.defaultDur
        log('ok', `${label} → ${path.relative(ROOT, outPath)} (${CONFIG.defaultDur}초)`)
      }
      outputCuts.push(outPath)
      ok++
    } catch (err) {
      log('error', `${label} 실패: ${err.message}`)
      fail++
    }
  }

  // 전체 concat
  if (!args['no-concat'] && outputCuts.length > 1) {
    const finalPath = path.join(outputDir, `ep${episode}_final.mp4`)
    let concatList = [...outputCuts]

    // 훅 클립 앞에 붙이기
    if (hookId) {
      const sampleVideo = outputCuts[0]
      let targetW = 1376, targetH = 768
      try {
        const info = JSON.parse(execSync(
          `"${CONFIG.ffprobe}" -v quiet -print_format json -show_streams "${sampleVideo}"`,
          { encoding: 'utf-8' }
        ))
        const vs = info.streams.find(s => s.codec_type === 'video')
        if (vs) { targetW = vs.width; targetH = vs.height }
      } catch {}

      const hookOut = prepareHookClip(hookId, outputDir, targetW, targetH)
      if (hookOut) {
        concatList.unshift(hookOut)
        const hookDur = getAudioDuration(hookOut)
        totalDur += hookDur
      }
    }

    log('step', `최종 영상 합치기 (${concatList.length}클립, 총 ${totalDur.toFixed(1)}초)…`)
    try {
      concatVideos(concatList, finalPath)
      log('ok', `최종 → ${path.relative(ROOT, finalPath)}`)
    } catch (err) {
      log('error', `concat 실패: ${err.message}`)
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  완료: ✅ ${ok}개 성공 / ❌ ${fail}개 실패`)
  console.log(`  전체 영상 길이: ${totalDur.toFixed(1)}초`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main().catch(err => {
  log('error', `치명적 오류: ${err.message}`)
  process.exit(1)
})
