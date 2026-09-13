// 체크업 탭 타임라인 편집기(Tier4, 2026-09-13)용 오디오 파형 피크 추출 + 캐싱.
// mediaPaths.js의 probeMedia()와 같은 스타일 — ffmpeg 실행 실패 시 조용히 폴백.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const FFMPEG = (process.env.FFMPEG_PATH || 'ffmpeg')
const SAMPLE_RATE = 8000     // 파형용이라 저해상도로 충분 — 다운로드/처리량 최소화
const PEAK_COUNT = 400       // 프론트에서 클립 폭에 맞춰 늘려 그림

// 원본 파일 옆 .waveform/ 폴더에 캐싱 — .motion-manifest.json과 같은 사이드카 컨벤션.
function cachePath(filePath) {
  const dir = path.join(path.dirname(filePath), '.waveform')
  return path.join(dir, path.basename(filePath, path.extname(filePath)) + '.json')
}

function extractPeaks(filePath) {
  // mono 8kHz 16bit PCM raw로 뽑아서 Node에서 직접 다운샘플 — 별도 npm 의존성 없이 ffmpeg만 사용.
  const buf = execFileSync(FFMPEG, [
    '-v', 'error', '-i', filePath,
    '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', '-',
  ], { maxBuffer: 1024 * 1024 * 100 })
  const samples = buf.length / 2
  if (samples === 0) return new Array(PEAK_COUNT).fill(0)
  const bucketSize = Math.max(1, Math.floor(samples / PEAK_COUNT))
  const peaks = []
  for (let i = 0; i < PEAK_COUNT; i++) {
    const start = i * bucketSize
    if (start >= samples) { peaks.push(0); continue }
    const end = Math.min(samples, start + bucketSize)
    let max = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(buf.readInt16LE(j * 2))
      if (v > max) max = v
    }
    peaks.push(Math.round((max / 32768) * 1000) / 1000)
  }
  return peaks
}

// { peaks: number[0..1] } — 캐시 히트/생성 실패 시에도 항상 배열을 반환(실패하면 전부 0).
export function getWaveformPeaks(filePath) {
  if (!fs.existsSync(filePath)) return { peaks: new Array(PEAK_COUNT).fill(0), ok: false }
  const srcMtimeMs = fs.statSync(filePath).mtimeMs
  const cp = cachePath(filePath)
  try {
    if (fs.existsSync(cp)) {
      const cached = JSON.parse(fs.readFileSync(cp, 'utf-8'))
      if (cached.srcMtimeMs === srcMtimeMs && Array.isArray(cached.peaks)) return { peaks: cached.peaks, ok: true }
    }
  } catch { /* 캐시 손상 — 재생성 */ }

  try {
    const peaks = extractPeaks(filePath)
    fs.mkdirSync(path.dirname(cp), { recursive: true })
    fs.writeFileSync(cp, JSON.stringify({ peaks, srcMtimeMs }), 'utf-8')
    return { peaks, ok: true }
  } catch (e) {
    return { peaks: new Array(PEAK_COUNT).fill(0), ok: false, error: e.message }
  }
}
