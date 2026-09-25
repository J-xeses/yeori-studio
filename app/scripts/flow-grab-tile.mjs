// Flow 영상 결과 수동 회수 — 화면에 보이는 N번째 영상 타일(▶ 표식, 위→아래·왼→오른, 0=최신)을 열어 "원본 크기"로 받는다.
// 사용: node scripts/flow-grab-tile.mjs <저장경로.mp4> [N=0]   (flowDriver 의 타일 감지가 화면 구조 변경으로 어긋날 때의 비상구, 2026-09-25)
import puppeteer from 'puppeteer-core'
import fs from 'fs'; import os from 'os'; import path from 'path'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const out = process.argv[2], nth = Number(process.argv[3] || 0)
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(p => p.url().includes('55836226'))
await p.bringToFront(); await sl(800)
// 화면에 보이는 play_circle 아이콘(영상 타일 표식) — 위→아래, 왼→오른 순
const tiles = await p.evaluate(() => [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() === 'play_circle').map(e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width } }).filter(t => t.w > 0 && t.y > 0 && t.y < innerHeight).sort((a, b) => (Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x)))
console.log('tiles', JSON.stringify(tiles.slice(0, 4)))
const t = tiles[nth]; await p.mouse.click(t.x + 60, t.y + 80)
let ok = false; for (let i = 0; i < 15 && !ok; i++) { await sl(1000); ok = await p.evaluate(() => /현재 시간|Current time/i.test(document.body.innerText)) }
if (!ok) throw new Error('viewer not opened')
const cdp = await b.target().createCDPSession(); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowdl-'))
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: tmp })
const btn = async (re, sel) => p.evaluate((src, sel) => { const re = new RegExp(src); for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); if (r.width > 0 && re.test((e.textContent || '').trim())) return { x: r.left + r.width / 2, y: r.top + r.height / 2 } } return null }, re.source, sel)
const dl = await btn(/^download$/, 'button'); await p.mouse.click(dl.x, dl.y)
let item = null; for (let i = 0; i < 16 && !item; i++) { await sl(500); item = await btn(/원본 크기|Original size/, 'flow-menu-item button') }
await p.mouse.click(item.x, item.y)
let f = null; for (let i = 0; i < 90 && !f; i++) { await sl(1000); f = fs.readdirSync(tmp).find(n => n.endsWith('.mp4')) }
await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' })
fs.copyFileSync(path.join(tmp, f), out); console.log('saved', fs.statSync(out).size)
await p.keyboard.press('Escape')
b.disconnect(); process.exit(0)
