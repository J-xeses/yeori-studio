// 드라이버 자체 녹화를 Recorder 인터페이스로 감싸는 어댑터.
// runner가 driver.nativeRecorder()를 받아 여기 넣어준다.
import { Recorder } from './base.js'

export class NativeRecorder extends Recorder {
  constructor(opts = {}) {
    super(opts)
    this.impl = opts.impl   // { start(outPath, {fps}), stop() }
  }
  async start(outPath, spec = {}) {
    this.log(`native(CDP screencast) 녹화 시작 → ${outPath}`)
    await this.impl.start(outPath, { fps: spec.fps || 30, viewport: spec.viewport })
  }
  async stop() {
    await this.impl.stop()
    this.log('native 녹화 종료')
  }
}
