import puppeteer from 'puppeteer-core'
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('textarea')].map(x => { const r = x.getBoundingClientRect(); return { ph: (x.getAttribute('placeholder') || '').slice(0, 20), max: x.getAttribute('maxlength'), w: Math.round(r.width), y: Math.round(r.top) } }))))
console.log((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(-500))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
