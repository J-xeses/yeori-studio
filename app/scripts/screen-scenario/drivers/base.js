// ── Driver 인터페이스 ────────────────────────────────────────────────
// 화면 조작 도구(puppeteer / playwright / pyautogui …)를 감싸는 추상 계층.
// 시나리오의 액션({action:'type', target:'prompt_box', ...})을 실제 도구 호출로 번역한다.
// 새 도구 추가 = 이 클래스를 상속해 execute()의 각 action만 구현 + registry.js에 등록.
//
// 액션 어휘 (도구 무관):
//   goto      {url}
//   wait      {ms}  |  {for:'selector'|'network-idle', timeout}
//   type      {target, text, cps?}       cps = 초당 글자수(타이핑 속도), 기본 18
//   click     {target}
//   hover     {target}
//   scroll    {target?, by, duration?}   target 생략 시 페이지 스크롤
//   key       {keys}                     "Enter" | "Control+a" 등
//   setValue  {target, value}            input 값 직접 주입(타이핑 애니 없이)
//   screenshot{name}                     디버그용
//   sleep     = wait 별칭
//
// target 은 시나리오의 selectors 맵을 통해 해석된다:
//   browser 계열 → CSS/xpath 문자열
//   pyautogui    → { image:'templates/x.png' } 또는 { x, y }

export class Driver {
  /** @param {object} opts  { headless, viewport:{width,height}, windowPosition:{x,y}, log } */
  constructor(opts = {}) {
    this.opts = opts
    this.log = opts.log || (() => {})
  }

  /** 도구 기동 + 대상(브라우저 페이지/앱) 준비. scenario.target 을 받는다. */
  async setup(_target) { throw new Error('Driver.setup() 미구현') }

  /** 액션 하나 실행. step = {action, ...}, selectors = 해석용 맵. */
  async execute(_step, _selectors) { throw new Error('Driver.execute() 미구현') }

  /** 정리(브라우저 종료 등). */
  async teardown() {}

  /** 이 드라이버가 자체 페이지 녹화를 지원하면 Recorder 인스턴스 반환, 아니면 null.
   *  (예: PuppeteerDriver 는 page.screencast() 기반 레코더를 줄 수 있음) */
  nativeRecorder() { return null }

  /** 녹화 대상 창의 화면 좌표 { x, y, width, height } — OS 레코더가 영역 지정에 씀. */
  async windowBounds() { return null }
}

// 액션 실행 공통 유틸 — 하위 드라이버에서 재사용
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// "type" 액션의 사람스러운 타이핑: 글자 사이 지연 + 약간의 흔들림
export async function humanType(typeOne, text, cps = 18) {
  const base = 1000 / Math.max(1, cps)
  for (const ch of [...String(text)]) {
    await typeOne(ch)
    await sleep(base * (0.6 + Math.random() * 0.9))
  }
}
