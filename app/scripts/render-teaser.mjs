// 티저 HTML(CSS @keyframes) → 프레임 캡처 → mp4. 메이킹 파이프라인 MOTION:self 와 같은 방식
// (애니메이션을 멈추고 currentTime 을 프레임마다 지정 = 헤드리스에서도 결정적).
// 사용: node scripts/render-teaser.mjs <html> <outDir> [--v=black,gold,...] [--f=plex,square] [--dur=6.5] [--stills=0.5,2,3.5]
//   --v(색) × --f(글꼴) 조합마다 1개. --f 를 주면 파일명에 글꼴이 붙는다.
//   --stills 만 주면 해당 시각 PNG 만 저장(빠른 확인용), 아니면 변형별 mp4 생성.
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'

const [htmlPath, outDir, ...rest] = process.argv.slice(2)
const opt = Object.fromEntries(rest.map(a => a.replace(/^--/, '').split('=')))
const colors = (opt.v || 'black').split(',')
const fonts = opt.f ? opt.f.split(',') : [null]
const variants = colors.flatMap(c => fonts.map(f => ({ c, f, name: f ? `${f}_${c}` : c })))
const dur = parseFloat(opt.dur || '6.5')
const stills = opt.stills ? opt.stills.split(',').map(Number) : null
const FPS = 30, W = 1080, H = 1920
fs.mkdirSync(outDir, { recursive: true })
const base = path.basename(htmlPath, '.html')

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
try {
  for (const { c, f, name: v } of variants) {
    const page = await browser.newPage()
    await page.setViewport({ width: W, height: H })
    const q = new URLSearchParams(); if (c !== 'black') q.set('v', c); if (f) q.set('f', f)
    const url = pathToFileURL(path.resolve(htmlPath)).href + (q.toString() ? `?${q}` : '')
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    await new Promise(r => setTimeout(r, 200))   // place() 좌표 계산 완료 대기
    const seek = (ms) => page.evaluate(t => document.getAnimations().forEach(a => { try { a.pause(); a.currentTime = t } catch (e) {} }), ms)

    if (stills) {
      for (const s of stills) {
        await seek(s * 1000)
        await page.screenshot({ path: path.join(outDir, `${base}_${v}_t${s.toFixed(2)}.png`) })
      }
      console.log(`stills ${v}: ${stills.join(', ')}`)
    } else {
      const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'teaser_'))
      const total = Math.round(dur * FPS)
      for (let i = 0; i < total; i++) {
        await seek((i / FPS) * 1000)
        await page.screenshot({ path: path.join(frames, `f_${String(i).padStart(5, '0')}.png`) })
      }
      const out = path.join(outDir, `${base}_${v}.mp4`)
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f_%05d.png'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', '30', '-crf', '16', '-movflags', '+faststart', out])
      fs.rmSync(frames, { recursive: true, force: true })
      if (r.status !== 0) throw new Error(`ffmpeg 실패: ${r.stderr}`)
      console.log(`mp4 ${v}: ${out}`)
    }
    await page.close()
  }
} finally {
  await browser.close()
}
