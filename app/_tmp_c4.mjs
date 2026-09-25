import puppeteer from 'puppeteer-core'
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
for (const p of await b.pages()) console.log('TAB', p.url().slice(0, 120))
const p = (await b.pages()).find(x => x.url().includes('flow.google.com'))
console.log((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1500))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
