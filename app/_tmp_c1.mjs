import puppeteer from 'puppeteer-core'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => /flow\.google\.com\/?$/.test(x.url())) || (await b.pages())[0]
await p.bringToFront(); await sl(800)
const btn = await p.evaluate(() => { const e = [...document.querySelectorAll('button,a,[role=button]')].find(x => /Create a character/i.test(x.textContent || '') && x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: e.textContent.trim().slice(0, 40) } })
console.log('btn', JSON.stringify(btn))
if (btn) { await p.mouse.click(btn.x, btn.y); await sl(3500) }
console.log('URL', p.url())
console.log((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1500))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
