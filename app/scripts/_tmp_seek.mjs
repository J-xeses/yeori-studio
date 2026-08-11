import puppeteer from 'puppeteer-core'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('capcut.com/editor'))
await page.bringToFront()
await page.setViewport({ width: 1400, height: 800 })
await sleep(500)

async function readCurrentTime() {
  return page.evaluate(() => {
    const el = document.querySelector('.player-time')
    if (!el) return null
    const spans = el.querySelectorAll('span')
    return spans[0] ? spans[0].textContent.trim() : null
  })
}

function parseTime(t) {
  // MM:SS:FF 가정
  const [mm, ss, ff] = t.split(':').map(Number)
  return mm * 60 + ss + ff / 30
}

// 타임라인 캔버스 영역 두 지점 클릭해서 px->sec 매핑 보정
const y = 700 // 트랙 행 y좌표 (썸네일 필름스트립 위)
await page.mouse.click(510, y)
await sleep(300)
const t1txt = await readCurrentTime()
const t1 = parseTime(t1txt)

await page.mouse.click(1390, y)
await sleep(300)
const t2txt = await readCurrentTime()
const t2 = parseTime(t2txt)

console.log('x=510 ->', t1txt, '=', t1, 's')
console.log('x=1390 ->', t2txt, '=', t2, 's')
console.log('px per sec:', (1390-510)/(t2-t1))

await browser.disconnect()
process.exit(0)
