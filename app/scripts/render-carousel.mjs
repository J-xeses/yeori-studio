// 연속 캐러셀 렌더 — 큰 캔버스 HTML 한 장을 캡처해 격자(cols×rows)로 잘라 슬라이드로 저장.
// 넘기는 순서 = 왼→오, 위→아래. --overview 면 캔버스 전체를 슬라이드 크기로 줄인 "전체 모음" 한 장을 마지막에 추가.
// 사용: node scripts/render-carousel.mjs <html> <outDir> [--cols=2] [--rows=2] [--w=1080] [--h=1350] [--overview] [--q=?query]
// HTML 은 준비가 끝나면 document.body.dataset.ready='1' 을 세팅할 것(폰트·측정 대기).
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'

const [htmlPath, outDir, ...rest] = process.argv.slice(2)
const opt = Object.fromEntries(rest.map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true] }))
const cols = +(opt.cols || 2), rows = +(opt.rows || 2), W = +(opt.w || 1080), H = +(opt.h || 1350)
fs.mkdirSync(outDir, { recursive: true })
const full = path.join(outDir, '_full.png')

const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const p = await b.newPage()
  await p.setViewport({ width: W * cols, height: H * rows })
  await p.goto(pathToFileURL(path.resolve(htmlPath)).href + (opt.q ? String(opt.q) : ''), { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 20000 })
  await p.screenshot({ path: full })
} finally { await b.close() }

const ff = (args) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf-8' }); if (r.status !== 0) throw new Error(r.stderr) }
let n = 0
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  n++
  ff(['-i', full, '-vf', `crop=${W}:${H}:${c * W}:${r * H}`, '-q:v', '2', path.join(outDir, `slide_${String(n).padStart(2, '0')}.jpg`)])
}
if (opt.overview) { n++; ff(['-i', full, '-vf', `scale=${W}:${H}:flags=lanczos`, '-q:v', '2', path.join(outDir, `slide_${String(n).padStart(2, '0')}_overview.jpg`)]) }
console.log(`슬라이드 ${n}장 → ${outDir}`)
