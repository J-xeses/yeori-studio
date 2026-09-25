import puppeteer from 'puppeteer-core'
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await b.pages()
for (const p of pages) console.log('TAB', p.url().slice(0, 100))
const p = pages.find(x => /flow/.test(x.url())) || pages[0]
await new Promise(r => setTimeout(r, 3000))
const info = await p.evaluate(() => ({ url: location.href, acct: [...document.querySelectorAll('[aria-label*="Google 계정"],[aria-label*="Google Account"]')].map(e => e.getAttribute('aria-label')).slice(0, 2), text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300) }))
console.log(JSON.stringify(info, null, 1))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
