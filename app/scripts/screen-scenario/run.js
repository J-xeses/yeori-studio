#!/usr/bin/env node
// ── CLI 진입점 ──────────────────────────────────────────────────────
//   node scripts/screen-scenario/run.js <scenario.json> [옵션]
//
//   --driver puppeteer|...        (기본: 시나리오 driver 또는 puppeteer)
//   --recorder native|gdigrab|gamebar|obs   (기본: 시나리오 recorder 또는 native)
//   --out <path.mp4>              최종 cut mp4 (없으면 raw만)
//   --ep <N> --cut <N>           스튜디오 컷 경로로 저장 (mediaPaths.videoDir 사용)
//   --obs-url / --obs-pass / --obs-scene
//
// 예)
//   node scripts/screen-scenario/run.js scenarios/rl03_cut3_elevenlabs.json --ep 98 --cut 3 --recorder gdigrab

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScenario } from './runner.js'
import * as mp from '../../server/lib/mediaPaths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const scenarioArg = args.find((a) => !a.startsWith('--') && (a.endsWith('.json') || a.endsWith('.js')))
if (!scenarioArg) {
  console.error('사용법: node run.js <scenario.json> [--driver x] [--recorder y] [--out z | --ep N --cut N]')
  process.exit(1)
}
const scenarioPath = path.isAbsolute(scenarioArg) ? scenarioArg
  : fs.existsSync(path.resolve(scenarioArg)) ? path.resolve(scenarioArg)
  : path.join(__dirname, 'scenarios', scenarioArg)

const scenario = scenarioPath.endsWith('.js')
  ? (await import(scenarioPath)).default
  : JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'))

let outPath = flag('out')
const ep = flag('ep'), cut = flag('cut')
if (!outPath && ep && cut) outPath = path.join(mp.videoDir(ep), `cut_${String(cut).padStart(2, '0')}.mp4`)

const recorderOpts = {}
if (flag('obs-url')) recorderOpts.url = flag('obs-url')
if (flag('obs-pass')) recorderOpts.password = flag('obs-pass')
if (flag('obs-scene')) recorderOpts.scene = flag('obs-scene')

try {
  const r = await runScenario({
    scenario,
    driver: flag('driver'),
    recorder: flag('recorder'),
    outPath,
    recorderOpts,
    driverOpts: has('headful') ? { headless: false } : {},
  })
  console.log(JSON.stringify(r))
} catch (e) {
  console.error('실패:', e.message)
  process.exit(1)
}
