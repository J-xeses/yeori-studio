/**
 * make-image-sequence-cut.js — 사진 1~N장을 "크로스페이드+켄번즈 줌"으로 이어붙여
 * 컷용 mp4를 만든다. 2026-09-30, IG_R02 컷1/5 재작업 중 신설.
 *
 * 원리: graphicGen.js의 buildImageSequenceHtml()로 자기완결(self) CSS 애니메이션
 * HTML을 만들고, proxy.js의 runGraphicCapture()(motion:'self')와 동일한 방식으로
 * 헤드리스 크롬이 프레임을 한 장씩 찍어 ffmpeg로 이어붙인다. 결과 HTML은
 * 01_script/에도 저장해두므로, 메이킹 탭에서 이 컷의 htmlFile로 지정하면
 * 그 UI로도 그대로 재사용/재캡처할 수 있다.
 *
 * 사용법:
 *   node scripts/make-image-sequence-cut.js \
 *     --images "02_images/cut_01_a.jpg,02_images/cut_01_b.jpg" \
 *     --duration 3 --effect auto --w 1080 --h 1920 \
 *     --out 05_video/_manual_work/cut_01_seq.mp4 \
 *     --htmlOut 01_script/cut_01_imgseq.html \
 *     --base "C:/yeori-studio/downloads/seoyeori/IG/IG_R/IG_R02"
 *
 * 옵션:
 *   --images   콤마로 구분한 이미지 경로(순서대로 등장). base 기준 상대경로 가능.
 *   --duration 영상 총 길이(초). 기본 3.
 *   --effect   auto(기본, 1장=켄번즈/2장이상=크로스페이드+줌) | crossfade | kenburns | both
 *   --w --h    출력 해상도. 기본 1080x1920(세로).
 *   --out      결과 mp4 경로.
 *   --htmlOut  생성된 HTML을 저장할 경로(선택, 지정 시 메이킹 탭에서 재사용 가능).
 *   --base     상대경로 기준 폴더(생략 시 현재 작업 디렉터리).
 *   --fps      캡처 프레임레이트. 기본 30.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import puppeteer from 'puppeteer-core'
import { buildImageSequenceHtml } from '../server/lib/graphicGen.js'

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function toDataUri(absPath) {
  const buf = fs.readFileSync(absPath)
  return `data:${mimeFor(absPath)};base64,${buf.toString('base64')}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = args.base ? path.resolve(args.base) : process.cwd()
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(base, p)

  const imagePaths = String(args.images || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!imagePaths.length) throw new Error('--images 필요 (콤마로 구분)')
  const duration = parseFloat(args.duration || '3')
  const effect = args.effect || 'auto'
  const w = parseInt(args.w || '1080', 10)
  const h = parseInt(args.h || '1920', 10)
  const fps = parseInt(args.fps || '30', 10)
  const outPath = resolve(args.out || 'cut_imgseq.mp4')
  const htmlOutPath = args.htmlOut ? resolve(args.htmlOut) : null

  for (const p of imagePaths) {
    const abs = resolve(p)
    if (!fs.existsSync(abs)) throw new Error(`이미지 없음: ${abs}`)
  }

  console.log(`[1/4] 이미지 ${imagePaths.length}장 인코딩 중...`)
  const dataUris = imagePaths.map(p => toDataUri(resolve(p)))

  console.log(`[2/4] HTML 생성 중 (effect=${effect === 'auto' ? (imagePaths.length > 1 ? 'crossfade+zoom' : 'kenburns') : effect}, duration=${duration}s)...`)
  const html = buildImageSequenceHtml({ images: dataUris, w, h, durationSec: duration, effect })
  if (htmlOutPath) {
    fs.mkdirSync(path.dirname(htmlOutPath), { recursive: true })
    fs.writeFileSync(htmlOutPath, html, 'utf-8')
    console.log(`      HTML 저장: ${htmlOutPath}`)
  }

  console.log(`[3/4] 헤드리스 크롬으로 프레임 캡처 중 (${fps}fps × ${duration}s = ${Math.round(duration * fps)}프레임)...`)
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgseq_'))
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
    })
    const page = await browser.newPage()
    await page.setViewport({ width: w, height: h })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.evaluate(() => { document.getAnimations().forEach(a => { try { a.pause() } catch { /* noop */ } }) })
    const total = Math.max(2, Math.round(duration * fps))
    for (let i = 0; i < total; i++) {
      const tMs = (i / fps) * 1000
      await page.evaluate((t) => {
        document.getAnimations().forEach(a => { try { a.currentTime = t } catch { /* noop */ } })
      }, tMs)
      await page.screenshot({ path: path.join(framesDir, `f_${String(i).padStart(5, '0')}.png`) })
    }
  } finally {
    if (browser) await browser.close()
  }

  console.log(`[4/4] ffmpeg로 mp4 합성 중...`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await new Promise((resolve2, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-framerate', String(fps), '-i', path.join(framesDir, 'f_%05d.png'),
      '-vf', `scale=${w}:${h},format=yuv420p`,
      '-color_range', 'tv',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', String(fps), '-g', String(fps),
      '-movflags', '+faststart',
      outPath,
    ], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d })
    proc.on('close', code => code === 0 ? resolve2() : reject(new Error(`ffmpeg 종료 코드 ${code}\n${stderr}`)))
    proc.on('error', reject)
  })
  fs.rmSync(framesDir, { recursive: true, force: true })

  console.log(`완료: ${outPath}`)
}

main().catch(err => {
  console.error('실패:', err.message)
  process.exit(1)
})
