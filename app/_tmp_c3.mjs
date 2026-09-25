import puppeteer from 'puppeteer-core'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('55836226'))
const clickIncl = async (s, sel = 'button,[role=option],div') => { const pos = await p.evaluate((s, sel) => { const e = [...document.querySelectorAll(sel)].filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.width < 500 && r.height < 80 }).find(x => (x.textContent || '').includes(s)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, s, sel); if (pos) await p.mouse.click(pos.x, pos.y); return !!pos }
console.log('pick', await clickIncl('yeori_nt-closeup')); await sl(1200)
console.log('add', await clickIncl('미디어 추가', 'button')); await sl(4000)
console.log((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1500))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
