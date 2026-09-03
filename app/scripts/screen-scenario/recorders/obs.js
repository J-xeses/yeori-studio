// OBS Studio WebSocket 녹화 (obs-websocket v5, OBS 28+ 내장).
// 스텁 — obs-websocket-js 의존성이 아직 없어 require를 지연 로드하고 없으면 안내.
// OBS 쪽 사전 준비: 씬에 브라우저/디스플레이 소스 구성 + WebSocket 서버 켜기(도구 > obs-websocket).
import { Recorder } from './base.js'

export class ObsRecorder extends Recorder {
  async start(outPath, _spec = {}) {
    let OBSWebSocket
    try { ({ default: OBSWebSocket } = await import('obs-websocket-js')) }
    catch { throw new Error('obs-websocket-js 미설치 — `npm i obs-websocket-js` 후 사용') }
    this.outPath = outPath
    this.obs = new OBSWebSocket()
    await this.obs.connect(this.opts.url || 'ws://127.0.0.1:4455', this.opts.password || undefined)
    if (this.opts.scene) await this.obs.call('SetCurrentProgramScene', { sceneName: this.opts.scene })
    await this.obs.call('StartRecord')
    this.log('OBS 녹화 시작')
  }

  async stop() {
    const { outputPath } = await this.obs.call('StopRecord')
    await this.obs.disconnect()
    if (outputPath && this.outPath && outputPath !== this.outPath) {
      const fs = await import('node:fs')
      fs.mkdirSync((await import('node:path')).dirname(this.outPath), { recursive: true })
      fs.renameSync(outputPath, this.outPath)
    }
    this.log(`OBS 녹화 종료 → ${this.outPath}`)
  }
}
