// ffmpeg -f gdigrab 기반 OS 화면 녹화. 특정 창 제목 또는 데스크톱 영역.
// 창 제목 캡처가 더 깔끔하지만(다른 창 안 겹침), 창이 최소화/가려지면 실패 →
// region(좌표) 캡처가 더 안정적. runner가 driver.windowBounds()로 region을 넘겨준다.
import { spawn } from 'node:child_process'
import { Recorder } from './base.js'

export class GdigrabRecorder extends Recorder {
  async start(outPath, spec = {}) {
    const fps = spec.fps || 30
    const args = ['-y', '-f', 'gdigrab', '-framerate', String(fps)]
    // region(좌표) 우선 — 창 제목은 정확 일치가 필요해(예: "Flow" ≠ "Flow - Google Chrome") 자주 실패.
    // driver.windowBounds()가 준 region이 있으면 그걸로 데스크톱 영역을 잘라 캡처한다.
    if (spec.region && spec.region.width > 0 && spec.region.height > 0) {
      const r = spec.region
      // libx264 + yuv420p 은 짝수 폭·높이 필수 → 내림 보정
      const w = Math.floor(Math.round(r.width) / 2) * 2
      const h = Math.floor(Math.round(r.height) / 2) * 2
      args.push('-offset_x', String(Math.max(0, Math.round(r.x))),
        '-offset_y', String(Math.max(0, Math.round(r.y))),
        '-video_size', `${w}x${h}`, '-i', 'desktop')
    } else if (spec.windowTitle) {
      args.push('-i', `title=${spec.windowTitle}`)
    } else {
      args.push('-i', 'desktop')
    }
    // 어떤 입력 경로든 홀수 픽셀이 오면 libx264가 죽으므로 항상 짝수로 스케일 보정
    args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(fps), outPath)
    this.log(`gdigrab: ffmpeg ${args.join(' ')}`)
    this.proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] })
    this._err = ''
    this._exited = new Promise((r) => this.proc.on('close', r))
    this.proc.stderr.on('data', (d) => { this._err += d.toString() })
    await new Promise((r) => setTimeout(r, 800))   // 캡처 안정화
    // 즉시 죽었으면(잘못된 파라미터 등) 바로 알림
    if (this.proc.exitCode != null && this.proc.exitCode !== 0) {
      throw new Error(`gdigrab 즉시 종료(${this.proc.exitCode}): ${this._err.slice(-400)}`)
    }
  }

  async stop() {
    if (!this.proc) return
    // 'q' 로 우아하게 종료(트레일러 기록). 안 먹으면 SIGINT → 그래도 안 죽으면 kill.
    try { this.proc.stdin.write('q') } catch { /* noop */ }
    await Promise.race([
      this._exited,
      new Promise((resolve) => setTimeout(() => {
        try { this.proc.kill('SIGINT') } catch { /* noop */ }
        setTimeout(() => { try { this.proc.kill() } catch { /* noop */ } }, 1500)
        this._exited.then(resolve)
      }, 2500)),
    ])
    this.log('gdigrab 종료')
  }
}
