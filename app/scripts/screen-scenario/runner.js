// ── Runner ──────────────────────────────────────────────────────────
// 시나리오(도구 무관 액션 시퀀스) + 드라이버 + 레코더를 묶어 실행 → cut mp4.
//
// 흐름: driver.setup → recorder.start → [steps 순회] → recorder.stop → driver.teardown
//       → ffmpeg로 컷 규격(1080x1920 / 길이) 정규화 → cut_NN.mp4

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createDriver, createRecorder } from './registry.js'

function log(tag, msg) {
  console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] [${tag}] ${msg}`)
}

async function normalize(inPath, outPath, { width = 1080, height = 1920, duration } = {}) {
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p`
  const args = ['-y']
  if (duration) args.push('-t', String(duration))
  args.push('-i', inPath, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-r', '30', '-an',
    '-movflags', '+faststart', outPath)
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`정규화 ffmpeg ${c}: ${err.slice(-300)}`))))
  })
}

/**
 * @param {object} p
 *   scenario  : 시나리오 객체 (아래 형식)
 *   driver    : 'puppeteer' | ...   (기본: scenario.driver || 'puppeteer')
 *   recorder  : 'native'|'gdigrab'|'gamebar'|'obs'  (기본: scenario.recorder || 'native')
 *   outPath   : 최종 cut mp4 경로 (없으면 정규화 안 하고 raw 경로 반환)
 *   driverOpts / recorderOpts : 도구별 추가 옵션
 */
export async function runScenario(p) {
  const sc = p.scenario
  const driverName = p.driver || sc.driver || 'puppeteer'
  const recorderName = p.recorder || sc.recorder || 'native'
  const vp = sc.viewport || { width: 1080, height: 1920 }
  const fps = sc.record?.fps || 30

  // connect 모드(target이 문자열/{tool})는 headless 무의미 — 사용자 Chrome에 붙음
  const isConnect = typeof sc.target === 'string' || !!sc.target?.tool
  const driver = await createDriver(driverName, {
    viewport: vp,
    headless: isConnect ? false : (recorderName === 'native'),
    windowPosition: sc.record?.windowPosition, log: (m) => log(driverName, m),
    ...(p.driverOpts || {}),
  })

  log('runner', `시나리오 '${sc.id}' · driver=${driverName} · recorder=${recorderName}${isConnect ? ' · connect' : ''}`)
  await driver.setup(sc.target ?? {})

  // 레코더 준비
  let recorder
  if (recorderName === 'native') {
    if (isConnect) log('runner', '⚠ connect 모드 + native 녹화는 불안정(page.screencast). gdigrab/gamebar/obs 권장')
    const impl = driver.nativeRecorder()
    if (!impl) throw new Error(`${driverName} 드라이버는 native 녹화 미지원 — recorder를 gdigrab/gamebar/obs로`)
    recorder = await createRecorder('native', { impl, log: (m) => log('native', m) })
  } else {
    recorder = await createRecorder(recorderName, { log: (m) => log(recorderName, m), ...(p.recorderOpts || {}) })
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario_'))
  const rawPath = path.join(tmpDir, 'raw.mp4')
  const region = recorderName === 'gdigrab' ? await driver.windowBounds() : null

  await recorder.start(rawPath, { fps, region, windowTitle: sc.record?.windowTitle })
  try {
    for (const [i, step] of (sc.steps || []).entries()) {
      log('step', `${i + 1}/${sc.steps.length} ${step.action}${step.target ? ` → ${step.target}` : ''}`)
      await driver.execute(step, sc.selectors || {})
    }
  } finally {
    await recorder.stop()
    await driver.teardown()
  }

  if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size < 1024) {
    throw new Error(`녹화 결과가 비어있습니다 (${recorderName}). 창이 가려졌거나 레코더 파라미터 문제일 수 있습니다.`)
  }

  if (!p.outPath) { log('runner', `raw: ${rawPath}`); return { rawPath } }
  fs.mkdirSync(path.dirname(p.outPath), { recursive: true })
  await normalize(rawPath, p.outPath, { width: vp.width, height: vp.height, duration: sc.duration })
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
  log('runner', `완료 → ${p.outPath}`)
  return { outPath: p.outPath }
}
