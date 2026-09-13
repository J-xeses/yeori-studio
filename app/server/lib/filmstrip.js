// 체크업 탭 타임라인 클립의 "실제 영상 스틸컷 나열" 필름스트립(2026-09-13) — 지금까지는
// startFrame(G2 승인 이미지 1장)을 클립 전체에 늘려 배경으로 썼는데, 클립 폭이 넓어지면
// 같은 이미지가 그대로 늘어나 보여 컷 내부 장면 변화를 구별할 수 없다는 피드백으로 추가.
// ffmpeg로 1초 간격 프레임을 실제로 뽑아 캐싱 — waveform.js/probeMedia()와 동일한
// "ffmpeg 실행 + 실패 시 폴백" 스타일.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const FFMPEG = (process.env.FFMPEG_PATH || 'ffmpeg')

// 폴더명에 "." 접두어를 안 쓴다 — express.static 기본 dotfiles:'ignore' 옵션 때문에
// "."로 시작하는 경로 세그먼트는 정적 서빙이 막혀 <img src>로 못 읽는다(2026-09-13 확인).
function cacheDir(filePath) {
  return path.join(path.dirname(filePath), 'filmstrip_cache', path.basename(filePath, path.extname(filePath)))
}

// 캐시 폴더 안에 frame_000.jpg, frame_001.jpg ... + meta.json(srcMtimeMs) 저장.
// 반환: 프레임 파일의 절대경로 배열(순서대로) — 호출부(proxy.js)에서 URL로 변환.
export function getFilmstripFrames(filePath) {
  if (!fs.existsSync(filePath)) return { frames: [], ok: false }
  const srcMtimeMs = fs.statSync(filePath).mtimeMs
  const dir = cacheDir(filePath)
  const metaPath = path.join(dir, 'meta.json')

  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      if (meta.srcMtimeMs === srcMtimeMs && Array.isArray(meta.frames) && meta.frames.length) {
        const frames = meta.frames.map(f => path.join(dir, f)).filter(p => fs.existsSync(p))
        if (frames.length === meta.frames.length) return { frames, ok: true }
      }
    }
  } catch { /* 캐시 손상 — 재생성 */ }

  try {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    // 1초당 1프레임, 폭 240px로 축소(스트립 표시용이라 원본 해상도 불필요 — 캐시 용량/속도 절약)
    execFileSync(FFMPEG, [
      '-v', 'error', '-i', filePath,
      '-vf', 'fps=1,scale=240:-1',
      '-q:v', '5', path.join(dir, 'frame_%03d.jpg'),
    ], { maxBuffer: 1024 * 1024 * 50, windowsHide: true })
    const frameNames = fs.readdirSync(dir).filter(f => /^frame_\d+\.jpg$/.test(f)).sort()
    fs.writeFileSync(metaPath, JSON.stringify({ srcMtimeMs, frames: frameNames }), 'utf-8')
    return { frames: frameNames.map(f => path.join(dir, f)), ok: frameNames.length > 0 }
  } catch (e) {
    return { frames: [], ok: false, error: e.message }
  }
}
