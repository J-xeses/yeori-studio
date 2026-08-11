import puppeteer from 'puppeteer-core'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('capcut.com/editor'))
await page.bringToFront()
await page.setViewport({ width: 1400, height: 800 })
await sleep(400)

const ta = await page.$('textarea.lv-textarea:not(.lv-textarea-autosize-mirror)')
console.log('found textarea:', !!ta)
if (ta) {
  await ta.click({ clickCount: 3 })
  await ta.type('테스트 자막입니다', { delay: 30 })
  await sleep(500)
}

const shot = await page.screenshot({ encoding: 'base64' })
const fs = await import('fs')
fs.writeFileSync('scripts/_tmp_typed.png', Buffer.from(shot, 'base64'))
console.log('saved')

await browser.disconnect()
process.exit(0)
