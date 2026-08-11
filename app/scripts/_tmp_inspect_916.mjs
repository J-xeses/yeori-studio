import puppeteer from 'puppeteer-core'

const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('capcut.com')) || pages[0]

// find the create button by text
const btnInfo = await page.evaluate(() => {
  const all = document.querySelectorAll('body *')
  const cands = []
  for (const el of all) {
    const t = (el.textContent || '').trim()
    if ((t === '새로 만들기' || t === 'Create new') && el.children.length <= 2) {
      cands.push({ tag: el.tagName, cls: el.className, text: t })
    }
  }
  return cands
})
console.log('create button candidates:', JSON.stringify(btnInfo, null, 2))

// click via evaluate on the most specific match (last one, usually the clickable leaf)
const clicked = await page.evaluate(() => {
  const all = document.querySelectorAll('body *')
  let target = null
  for (const el of all) {
    const t = (el.textContent || '').trim()
    if ((t === '새로 만들기' || t === 'Create new') && el.children.length <= 2) {
      target = el
    }
  }
  if (!target) return false
  // click the target itself, and also try closest button/div with role
  const clickable = target.closest('button,[role="button"],div[class*="btn"],div[class*="Button"]') || target
  clickable.click()
  return { clicked: true, clickedTag: clickable.tagName, clickedCls: clickable.className }
})
console.log('clicked:', JSON.stringify(clicked))

await sleep(1500)

const after = await page.evaluate(() => {
  const all = document.querySelectorAll('body *')
  const results = []
  for (const el of all) {
    const t = (el.textContent || '').trim()
    if (t.includes('9:16') && el.children.length <= 3) {
      results.push({
        tag: el.tagName,
        cls: (el.className && typeof el.className === 'string') ? el.className : '',
        text: t.slice(0, 60),
        attrs: Array.from(el.attributes).map(a => `${a.name}="${a.value}"`).join(' '),
      })
    }
  }
  return results.slice(0, 20)
})
console.log('after click, 9:16 matches:', JSON.stringify(after, null, 2))

await browser.disconnect()
