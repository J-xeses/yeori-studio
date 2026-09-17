// ffmpeg gdigrab으로 Windows 화면을 녹화하는 모듈.
// G2(이미지 생성)/G3(TTS) 등 Flow/ElevenLabs 자동화 과정을 "메이킹 영상"으로
// 남기기 위한 용도 — OBS 가상 카메라를 거치지 않고 gdigrab이 화면을 직접
// 캡처할 수 있음을 확인(2026-08-17)한 뒤 그 경로로 구현.
//
// ⚠️ 2026-09-17까지 이 모듈은 gdigrab(영상)만 쓰고 오디오는 전혀 안 잡았음 — BROLL
// "화면 녹화"로 뮤비 등을 녹화해도 항상 무음이었음(사용자 지적으로 발견). 이 PC엔
// "스테레오 믹스(Realtek(R) Audio)" dshow 장치가 활성화돼 있어(ffmpeg -f dshow
// -list_devices로 실측 확인) 시스템 오디오 루프백 캡처가 가능 — 아래서 자동 감지해
// gdigrab(영상)+dshow(오디오) 두 입력을 합쳐서 하나의 mp4로 녹화한다. 장치가 없는
// PC에서는 조용히 영상만(기존 동작)으로 폴백한다.
import { spawn, execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'

const QUALITY_CRF = { low: 28, medium: 23, high: 18 }

// 동시에 하나의 녹화만 지원 — G2/G3 등 파이프라인 단계는 순차 실행되므로 충분함.
let current = null // { proc, outputPath, startedAt }

// 시스템 오디오 루프백으로 쓸만한 dshow 장치 이름 후보(한/영 로캘, 흔한 가상 드라이버 이름).
const AUDIO_DEVICE_NAME_RE = /스테레오\s*믹스|stereo\s*mix|what\s*u\s*hear|virtual-audio-capturer|voicemeeter/i
let audioDeviceCache // undefined=미탐지, null=없음(폴백), string=장치이름

async function detectSystemAudioDevice() {
  if (audioDeviceCache !== undefined) return audioDeviceCache
  audioDeviceCache = await new Promise((resolve) => {
    execFile(FFMPEG_PATH, ['-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'], { timeout: 8000 }, (_err, _stdout, stderr) => {
      const m = String(stderr || '').match(/"([^"]+)"\s*\(audio\)/g) || []
      const names = m.map(line => line.match(/"([^"]+)"/)[1])
      resolve(names.find(n => AUDIO_DEVICE_NAME_RE.test(n)) || null)
    })
  }).catch(() => null)
  return audioDeviceCache
}

function buildArgs(outputPath, { fps, quality, region, audioDevice }) {
  const crf = QUALITY_CRF[quality] ?? QUALITY_CRF.medium
  const args = ['-f', 'gdigrab', '-framerate', String(fps), '-i', 'desktop']
  if (audioDevice) args.push('-f', 'dshow', '-i', `audio=${audioDevice}`)
  if (region) {
    // region(crop)은 영상 스트림에만 걸려야 함 — 오디오 입력이 섞여 있으면 필터가 몇 번째
    // 스트림용인지 명시해야 하므로 -filter:v 로 지정(입력이 하나뿐이던 예전 -vf와 동일 효과).
    args.push('-filter:v', `crop=${region.w}:${region.h}:${region.x}:${region.y}`)
  }
  // gdigrab 소스는 화면 픽셀을 고정밀로 넘기는데, -pix_fmt를 명시 안 하면 libx264가
  // yuv444p 등 표준(yuv420p)이 아닌 포맷으로 인코딩해버려 Windows Media Player 등 흔한
  // 플레이어가 "지원되지 않는 인코딩 설정" 에러로 raw 녹화본을 아예 못 여는 문제가 있었음
  // (2026-09-17 실측: 0x80004005). editBrollRaw의 최종 편집본은 이미 yuv420p로 강제하고
  // 있어 괜찮았지만, 확인용으로 raw 파일을 직접 열어보는 사람 입장에선 여기도 고쳐야 함.
  args.push('-vcodec', 'libx264', '-preset', 'ultrafast', '-crf', String(crf), '-pix_fmt', 'yuv420p')
  if (audioDevice) args.push('-acodec', 'aac', '-b:a', '192k')
  args.push('-y', outputPath)
  return args
}

export async function start(outputPath, options = {}) {
  if (current) {
    throw new Error(`이미 녹화 중입니다: ${current.outputPath}`)
  }
  const { fps = 30, quality = 'medium', region = null, withAudio = true } = options
  const audioDevice = withAudio ? await detectSystemAudioDevice() : null

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const args = buildArgs(outputPath, { fps, quality, region, audioDevice })
  const proc = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'ignore', 'ignore'] })

  current = { proc, outputPath, startedAt: Date.now(), hasAudio: !!audioDevice }

  proc.on('error', (err) => {
    console.error('[screen-recorder] spawn 오류:', err.message)
    current = null
  })
  proc.on('close', () => {
    // stop()이 close를 기다리고 있지 않은 경우(예: 외부에서 죽은 경우)를 대비한 정리
    if (current && current.proc === proc) current = null
  })

  return { success: true, pid: proc.pid, outputPath, hasAudio: !!audioDevice }
}

export function stop() {
  if (!current) {
    return Promise.reject(new Error('현재 녹화 중인 프로세스가 없습니다'))
  }
  const { proc, outputPath, hasAudio } = current

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      current = null
      let sizeBytes = 0
      let success = false
      try {
        sizeBytes = fs.statSync(outputPath).size
        success = sizeBytes > 0
      } catch { /* 파일이 없으면 success:false로 반환 */ }
      resolve({ success, path: outputPath, sizeBytes, hasAudio: !!hasAudio })
    }

    proc.once('close', finish)
    // gdigrab은 강제 종료(SIGKILL/kill)하면 mp4 트레일러가 안 써져서 파일이 깨짐 —
    // 'q' 입력으로 ffmpeg 자체 종료 루틴을 태워야 함(정상적인 파일 마무리).
    try {
      proc.stdin.write('q\n')
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
