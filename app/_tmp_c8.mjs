import puppeteer from 'puppeteer-core'
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
console.log(await p.evaluate(() => [...document.querySelectorAll('button')].filter(x => x.getBoundingClientRect().width > 0).map(x => (x.innerText || x.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30)).filter(t => t).join(' | ')))
console.log('focused:', await p.evaluate(() => { const a = document.activeElement; return a ? a.tagName + ':' + (a.value || '').slice(0, 40) : '' }))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
