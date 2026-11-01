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

// config: trackmatte.py 가 읽는 그대로(front_layer/back_layer/effects/canvas).
// outputName: 확장자 없는 파일명(기본 trackmatte_<시각>) — downloads/_shared/trackmatte/ 아래 저장.
export async function renderTrackMatte({ config, outputName, onLog }) {
  const log = (m) => { try { onLog && onLog(m) } catch { /* noop */ } }
  if (!fs.existsSync(PY_SCRIPT)) throw new Error(`trackmatte.py 없음: ${PY_SCRIPT}`)
  const name = (outputName || `trackmatte_${Date.now()}`).replace(/[^\w\-가-힣]/g, '_')
  const outPath = path.join(trackMatteOutputDir(), `${name}.mp4`)
  const cfgPath = path.join(os.tmpdir(), `trackmatte_cfg_${Date.now()}.json`)
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8')

  await new Promise((resolve, reject) => {
    const p = spawn('python', [PY_SCRIPT, '--config', cfgPath, '--output', outPath], {
      cwd: path.dirname(PY_SCRIPT), windowsHide: true,
    })
    let err = ''
    p.stdout.on('data', (d) => { for (const line of d.toString().split(/\r?\n/)) if (line.trim()) log(line) })
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    p.on('close', (code) => {
      try { fs.rmSync(cfgPath, { force: true }) } catch { /* noop */ }
      if (code === 0 && fs.existsSync(outPath)) resolve()
      else reject(new Error(err.slice(-1500) || `trackmatte.py 종료 코드 ${code}`))
    })
  })
  return { outputPath: outPath, videoUrl: mp.toMediaUrl(outPath) }
}
