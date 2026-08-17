// ffmpeg gdigrab으로 Windows 화면을 녹화하는 모듈.
// G2(이미지 생성)/G3(TTS) 등 Flow/ElevenLabs 자동화 과정을 "메이킹 영상"으로
// 남기기 위한 용도 — OBS 가상 카메라를 거치지 않고 gdigrab이 화면을 직접
// 캡처할 수 있음을 확인(2026-08-17)한 뒤 그 경로로 구현.
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'

const QUALITY_PRESETS = {
  low: ['-crf', '30', '-preset', 'ultrafast'],
  medium: ['-crf', '23', '-preset', 'veryfast'],
  high: ['-crf', '18', '-preset', 'fast'],
}

// 동시에 하나의 녹화만 지원 — G2/G3 등 파이프라인 단계는 순차 실행되므로 충분함.
let current = null // { proc, outputPath, startedAt }

function buildArgs(outputPath, { fps, quality, region }) {
  const args = ['-y', '-f', 'gdigrab', '-framerate', String(fps)]
  if (region) {
    args.push('-offset_x', String(region.x), '-offset_y', String(region.y))
    args.push('-video_size', `${region.w}x${region.h}`)
  }
  args.push('-i', 'desktop')
  args.push('-vcodec', 'libx264', ...(QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium))
  args.push(outputPath)
  return args
}

export function start(outputPath, options = {}) {
  if (current) {
    throw new Error(`이미 녹화 중입니다: ${current.outputPath}`)
  }
  const { fps = 30, quality = 'medium', region = null } = options

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const args = buildArgs(outputPath, { fps, quality, region })
  const proc = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'ignore', 'ignore'] })

  current = { proc, outputPath, startedAt: Date.now() }

  proc.on('error', (err) => {
    console.error('[screen-recorder] spawn 오류:', err.message)
    current = null
  })
  proc.on('close', () => {
    // stop()이 close를 기다리고 있지 않은 경우(예: 외부에서 죽은 경우)를 대비한 정리
    if (current && current.proc === proc) current = null
  })

  return { success: true, path: outputPath }
}

export function stop() {
  if (!current) {
    return Promise.reject(new Error('현재 녹화 중인 프로세스가 없습니다'))
  }
  const { proc, outputPath, startedAt } = current

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      current = null
      const duration = (Date.now() - startedAt) / 1000
      let size = 0
      let success = false
      try {
        size = fs.statSync(outputPath).size
        success = size > 0
      } catch { /* 파일이 없으면 success:false로 반환 */ }
      resolve({ success, path: outputPath, duration, size })
    }

    proc.once('close', finish)
    // gdigrab은 강제 종료(SIGKILL/kill)하면 mp4 트레일러가 안 써져서 파일이 깨짐 —
    // 'q' 입력으로 ffmpeg 자체 종료 루틴을 태워야 함(정상적인 파일 마무리).
    try {
      proc.stdin.write('q')
      proc.stdin.end()
    } catch {
      proc.kill()
    }
    // graceful 종료가 안 먹는 경우를 대비한 안전장치
    setTimeout(() => {
      if (!settled && current && current.proc === proc) proc.kill()
    }, 5000)
  })
}

export function isRecording() {
  return !!current
}
