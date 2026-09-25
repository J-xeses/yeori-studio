import puppeteer from 'puppeteer-core'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
await p.bringToFront()
const pos = await p.evaluate(() => { const e = [...document.querySelectorAll('button')].find(x => /음성 선택/.test(x.textContent || '') && x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
console.log('voice btn', !!pos); if (pos) { await p.mouse.click(pos.x, pos.y); await sl(2500) }
console.log((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 2500))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
