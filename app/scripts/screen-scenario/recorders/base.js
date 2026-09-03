// ── Recorder 인터페이스 ─────────────────────────────────────────────
// 화면 녹화 도구를 감싸는 추상 계층. 시나리오 실행 동안 start()~stop().
// 종류:
//   native   — 드라이버 자체 녹화(예: puppeteer page.screencast). 드라이버가 제공.
//   gdigrab  — ffmpeg -f gdigrab. 특정 창 제목 또는 데스크톱 영역.
//   gamebar  — Windows 게임 바(Win+Alt+R). 포커스된 창 녹화, 결과는 Videos/Captures.
//   obs      — OBS WebSocket (obs-websocket-js). 씬/소스는 OBS에서 사전 구성.
//
// 새 녹화 도구 추가 = 이 클래스 상속 + registry.js 등록.

export class Recorder {
  constructor(opts = {}) {
    this.opts = opts
    this.log = opts.log || (() => {})
  }
  /** @param {string} outPath 최종 저장 경로(.mp4)
   *  @param {object} spec  { fps, region:{x,y,width,height}|null, windowTitle? } */
  async start(_outPath, _spec) { throw new Error('Recorder.start() 미구현') }

  /** 녹화 종료. 최종 mp4가 outPath에 있어야 함(필요 시 내부에서 트랜스코드). */
  async stop() { throw new Error('Recorder.stop() 미구현') }
}
