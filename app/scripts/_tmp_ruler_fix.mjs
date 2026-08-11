import puppeteer from 'puppeteer-core'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const xsel = xpath => `::-p-xpath(${xpath})`
const fs = await import('fs')
const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('capcut.com/editor'))
await page.bringToFront()
await page.setViewport({ width: 1400, height: 800 })
await sleep(800)

const RULER_Y = 622

async function readCurrentTimeSec() {
  const txt = await page.evaluate(() => {
    const el = document.querySelector('.player-time')
    const span = el?.querySelector('span')
    return span ? span.textContent.trim() : null
  })
  if (!txt) return null
  const [mm, ss, ff] = txt.split(':').map(Number)
  return mm * 60 + ss + ff / 30
}

function clickTextTab() {
  return page.evaluate(() => {
    const items = document.querySelectorAll('div[class*="workbench-menu-item"]')
    for (const el of items) {
      if (el.textContent.trim() === '텍스트') { el.click(); return true }
    }
    return false
  })
}

async function seekTo(calib, targetSec) {
  const x = Math.max(calib.x1, Math.min(1390, calib.x1 + (targetSec - calib.t1) * calib.pxPerSec))
  await page.mouse.click(x, RULER_Y)
  await sleep(300)
  // 눈금자 클릭이 자료 패널을 접어버리므로 매번 "텍스트" 탭을 다시 열어준다
  await clickTextTab()
  await sleep(500)
}

async function addCaption(text) {
  const btn = await page.$(xsel('//div[contains(@class,"card-item-wrapper")][normalize-space(.)="본문 추가"]'))
  if (!btn) { console.log('  ❌ 버튼 못 찾음'); return false }
  const box = await btn.boundingBox()
  if (!box || box.width < 10) { console.log('  ❌ 버튼 width 0'); return false }
  await btn.click({ clickCount: 2 })
  await sleep(800)
  // 더블클릭으로 클립은 추가되지만, 우측 "기본" 아이콘을 눌러야 텍스트 편집 패널(입력창)이 열림
  await page.evaluate(() => {
    const all = document.querySelectorAll('body *')
    for (const el of all) {
      if (el.textContent.trim() === '기본' && el.children.length <= 2) {
        const r = el.getBoundingClientRect()
        if (r.x > 1300) { el.click(); return true }
      }
    }
    return false
  })
  await sleep(700)
  const ta = await page.$('textarea.lv-textarea:not(.lv-textarea-autosize-mirror)')
  if (!ta) { console.log('  ❌ 입력창 못 찾음'); return false }
  await ta.click({ clickCount: 3 })
  await ta.type(text, { delay: 20 })
  await sleep(400)
  await page.keyboard.press('Escape')
  await sleep(400)
  return true
}

await clickTextTab()
await sleep(600)

await page.mouse.click(510, RULER_Y); await sleep(400)
const t1 = await readCurrentTimeSec()
await page.mouse.click(1390, RULER_Y); await sleep(400)
const t2 = await readCurrentTimeSec()
const calib = { x1: 510, t1, pxPerSec: (1390 - 510) / (t2 - t1) }
console.log('calib:', JSON.stringify(calib))
await clickTextTab()
await sleep(500)

await seekTo(calib, 3)
console.log('cap1:', await addCaption('네번째 시도 자막A'))

await seekTo(calib, 16)
console.log('cap2:', await addCaption('네번째 시도 자막B'))

const shot = await page.screenshot({ encoding: 'base64' })
fs.writeFileSync('scripts/_tmp_ruler_fix_result.png', Buffer.from(shot, 'base64'))
console.log('saved')

await browser.disconnect()
process.exit(0)
