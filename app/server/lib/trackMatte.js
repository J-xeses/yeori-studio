// ── 트랙매트 연출 렌더러(Node 래퍼) ──────────────────────────────────
// 실제 렌더링은 app/scripts/trackmatte.py(ffmpeg 필터체인, 외부 패키지 불필요)가
// 한다. 여기서는 설정을 임시 JSON으로 써서 python 프로세스를 띄우고, stdout을
// 줄 단위로 onLog에 전달해 메이킹 탭에 SSE로 보여준다(reelFinalize.js의
// runPy() 와 같은 패턴 — scripts/handwriting_overlay.py 호출 방식을 그대로 따름).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import * as mp from './mediaPaths.js'

const PY_SCRIPT = path.join(mp.DOWNLOADS, '..', 'app', 'scripts', 'trackmatte.py')

export function trackMatteOutputDir() {
  const dir = path.join(mp.DOWNLOADS, '_shared', 'trackmatte')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function sanitizeTrackMatteName(name) {
  return (name || `trackmatte_${Date.now()}`).replace(/[^\w\-가-힣]/g, '_')
}

// effects.bgm.file이 BGM 라이브러리 선택값(예: "_shared/bgm/BGM_HOOK/xxx.mp3", /api/bgm-library가
// 주는 그대로)이면 절대경로로 풀어준다. 사용자가 "직접 입력"으로 이미 절대경로를 타이핑했으면
// 그대로 둔다. (2026-11-01 2차 보완: UI에 BGM 라이브러리 선택 드롭다운을 새로 연결하면서 발견 —
// 상대경로를 그대로 python/ffmpeg에 넘기면 "Error opening input file" 로 트랙매트 생성이 깨짐.)
function resolveBgmPath(file) {
  const f = String(file).replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(f) || f.startsWith('/')) return file
  return mp.bgmFile(f)
}

function withResolvedBgm(config) {
  const bgm = config?.effects?.bgm
  if (!bgm?.file) return config
  return { ...config, effects: { ...config.effects, bgm: { ...bgm, file: resolveBgmPath(bgm.file) } } }
}

function runPy(args, onLog) {
  const log = (m) => { try { onLog && onLog(m) } catch { /* noop */ } }
  return new Promise((resolve, reject) => {
    const p = spawn('python', [PY_SCRIPT, ...args], { cwd: path.dirname(PY_SCRIPT), windowsHide: true })
    let err = ''
    p.stdout.on('data', (d) => { for (const line of d.toString().split(/\r?\n/)) if (line.trim()) log(line) })
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-1500) || `trackmatte.py 종료 코드 ${code}`))))
  })
}

// config: trackmatte.py 가 읽는 그대로(front_layer/back_layer/effects/canvas).
// outputName: 확장자 없는 파일명(기본 trackmatte_<시각>) — downloads/_shared/trackmatte/ 아래 저장.
// 같은 이름으로 다시 생성하면 mp4·설정 json 둘 다 덮어쓴다(= "불러와서 수정 후 재생성"이 업데이트가 됨).
export async function renderTrackMatte({ config, outputName, onLog }) {
  if (!fs.existsSync(PY_SCRIPT)) throw new Error(`trackmatte.py 없음: ${PY_SCRIPT}`)
  const name = sanitizeTrackMatteName(outputName)
  const dir = trackMatteOutputDir()
  const outPath = path.join(dir, `${name}.mp4`)
  const cfgTmpPath = path.join(os.tmpdir(), `trackmatte_cfg_${Date.now()}.json`)
  fs.writeFileSync(cfgTmpPath, JSON.stringify(withResolvedBgm(config), null, 2), 'utf-8')
  try {
    await runPy(['--config', cfgTmpPath, '--output', outPath], onLog)
  } finally {
    try { fs.rmSync(cfgTmpPath, { force: true }) } catch { /* noop */ }
  }
  if (!fs.existsSync(outPath)) throw new Error('출력 파일이 생성되지 않았습니다')
  // 결과 옆에 설정을 같이 저장 — "지난 결과물 불러오기"가 이 파일을 읽어 폼에 그대로 채운다.
  fs.writeFileSync(path.join(dir, `${name}.config.json`), JSON.stringify(config, null, 2), 'utf-8')
  return { outputPath: outPath, videoUrl: mp.toMediaUrl(outPath), name }
}

// 미리보기: 장면 하나만 합성한 정지 이미지(빠름, 보통 1~2초) — 글자 크기 등을 눈으로 보고 결정할 때.
// frameIndex — 몇 번째 장면(0부터)을 볼지. 장면별로 패널 구성이 다르면 첫 장면만으로는 편집이
// 안 된다는 요청(2026-11-03)으로 장면 선택 가능하게 확장.
// 결과는 임시 디렉터리에만 저장(지난 결과물 목록에 안 남게 trackMatteOutputDir과 분리).
export async function renderTrackMattePreview({ config, frameIndex = 0, onLog }) {
  if (!fs.existsSync(PY_SCRIPT)) throw new Error(`trackmatte.py 없음: ${PY_SCRIPT}`)
  const previewDir = path.join(mp.DOWNLOADS, '_shared', 'trackmatte', '_preview')
  fs.mkdirSync(previewDir, { recursive: true })
  const outPath = path.join(previewDir, `preview_${Date.now()}.png`)
  const cfgTmpPath = path.join(os.tmpdir(), `trackmatte_preview_cfg_${Date.now()}.json`)
  fs.writeFileSync(cfgTmpPath, JSON.stringify(withResolvedBgm(config), null, 2), 'utf-8')
  try {
    await runPy(['--config', cfgTmpPath, '--output', outPath, '--preview', '--preview-frame', String(frameIndex)], onLog)
  } finally {
    try { fs.rmSync(cfgTmpPath, { force: true }) } catch { /* noop */ }
  }
  if (!fs.existsSync(outPath)) throw new Error('미리보기 이미지가 생성되지 않았습니다')
  return { outputPath: outPath, imageUrl: mp.toMediaUrl(outPath) }
}

// 지금까지 만든 결과물 목록(최근순) — 설정 json이 같이 있으면 hasConfig:true로 표시해서
// UI가 "불러오기" 버튼을 보여줄지 판단한다.
export function listTrackMatteResults() {
  const dir = trackMatteOutputDir()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4'))
  return files.map((f) => {
    const full = path.join(dir, f)
    const st = fs.statSync(full)
    const name = f.replace(/\.mp4$/, '')
    return {
      name,
      url: `${mp.toMediaUrl(full)}?t=${Math.round(st.mtimeMs)}`,
      mtimeMs: st.mtimeMs,
      hasConfig: fs.existsSync(path.join(dir, `${name}.config.json`)),
    }
  }).sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function loadTrackMatteConfig(name) {
  const safe = sanitizeTrackMatteName(name)
  const cfgPath = path.join(trackMatteOutputDir(), `${safe}.config.json`)
  if (!fs.existsSync(cfgPath)) return null
  return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
}
