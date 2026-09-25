import puppeteer from 'puppeteer-core'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('55836226'))
await p.bringToFront(); await sl(600)
const byIcon = async (icon, labelRe) => { const pos = await p.evaluate((icon, src) => { const re = new RegExp(src); const ics = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() === icon); for (const ic of ics) { let a = ic; for (let k = 0; k < 5 && a; k++) { if (re.test(a.textContent || '')) { const r = a.getBoundingClientRect(); if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 } } a = a.parentElement } } return null }, icon, labelRe.source); if (pos) await p.mouse.click(pos.x, pos.y); return !!pos }
console.log('add', await byIcon('add', /프로젝트에서 추가/)); await sl(2500)
console.log((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 800))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
