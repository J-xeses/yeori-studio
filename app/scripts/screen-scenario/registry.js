// ── 드라이버 / 레코더 레지스트리 ────────────────────────────────────
// 새 도구 추가 = 여기 한 줄. import는 지연(해당 도구 안 쓰면 의존성 로드 안 함).

const DRIVERS = {
  // 디버깅 Chrome 의 대상 탭 CDP WS 에만 직결 — puppeteer.connect 의 OOPIF attach 멈춤 없음.
  // connect 모드(target:'flow'|'elevenlabs')의 기본 드라이버.
  cdp: () => import('./drivers/cdp-page.js').then(m => m.CdpPageDriver),
  'cdp-page': () => import('./drivers/cdp-page.js').then(m => m.CdpPageDriver),
  // puppeteer: launch 모드(격리된 새 Chrome)용. connect 모드는 cdp 권장.
  puppeteer: () => import('./drivers/puppeteer.js').then(m => m.PuppeteerDriver),
  // playwright: () => import('./drivers/playwright.js').then(m => m.PlaywrightDriver),
  // pyautogui:  () => import('./drivers/pyautogui.js').then(m => m.PyAutoGuiDriver),
}

const RECORDERS = {
  native:  () => import('./recorders/native.js').then(m => m.NativeRecorder),
  gdigrab: () => import('./recorders/gdigrab.js').then(m => m.GdigrabRecorder),
  gamebar: () => import('./recorders/gamebar.js').then(m => m.GameBarRecorder),
  obs:     () => import('./recorders/obs.js').then(m => m.ObsRecorder),
}

export async function createDriver(name, opts) {
  const load = DRIVERS[name]
  if (!load) throw new Error(`알 수 없는 driver: ${name} (등록: ${Object.keys(DRIVERS).join(', ')})`)
  const Cls = await load()
  return new Cls(opts)
}

export async function createRecorder(name, opts) {
  const load = RECORDERS[name]
  if (!load) throw new Error(`알 수 없는 recorder: ${name} (등록: ${Object.keys(RECORDERS).join(', ')})`)
  const Cls = await load()
  return new Cls(opts)
}

export const driverNames = () => Object.keys(DRIVERS)
export const recorderNames = () => Object.keys(RECORDERS)
