// ffmpeg -f gdigrab 기반 OS 화면 녹화. 특정 창 제목 또는 데스크톱 영역.
// 창 제목 캡처가 더 깔끔하지만(다른 창 안 겹침), 창이 최소화/가려지면 실패 →
// region(좌표) 캡처가 더 안정적. runner가 driver.windowBounds()로 region을 넘겨준다.
import { spawn } from 'node:child_process'
import { Recorder } from './base.js'

export class GdigrabRecorder extends Recorder {
  async start(outPath, spec = {}) {
    const fps = spec.fps || 30
    const args = ['-y', '-f', 'gdigrab', '-framerate', String(fps)]
    if (spec.windowTitle) {
      args.push('-i', `title=${spec.windowTitle}`)
    } else if (spec.region) {
      const r = spec.region
      args.push('-offset_x', String(r.x), '-offset_y', String(r.y),
        '-video_size', `${r.width}x${r.height}`, '-i', 'desktop')
    } else {
      args.push('-i', 'desktop')
    }
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(fps), outPath)
    this.log(`gdigrab: ffmpeg ${args.join(' ')}`)
    this.proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] })
    this._err = ''
    this.proc.stderr.on('data', (d) => { this._err += d.toString() })
    await new Promise((r) => setTimeout(r, 800))   // 캡처 안정화
  }

  async stop() {
    if (!this.proc) return
    // 'q' 로 우아하게 종료(트레일러 기록). 안 먹으면 SIGINT.
    try { this.proc.stdin.write('q') } catch { /* noop */ }
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { this.proc.kill('SIGINT') } catch { /* noop */ } }, 2500)
      this.proc.on('close', () => { clearTimeout(t); resolve() })
    })
    this.log('gdigrab 종료')
  }
}
