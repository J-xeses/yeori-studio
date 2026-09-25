import puppeteer from 'puppeteer-core'
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
const all = await p.evaluate(async () => {
  const grab = () => [...document.body.innerText.matchAll(/([A-Z][a-z]+)\s*\n?\s*(Female|Male),\s*([^,\n]+),\s*([^\n]*pitch)/g)].map(m => `${m[1]}|${m[2]}|${m[3]}|${m[4]}`)
  const seen = new Set(grab())
  const sc = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 20 && /Achernar|Aoede/.test(e.innerText || '')).sort((a, b) => a.innerText.length - b.innerText.length)[0]
  if (sc) { for (let i = 0; i < 20; i++) { sc.scrollTop += 300; await new Promise(r => setTimeout(r, 250)); grab().forEach(x => seen.add(x)) } sc.scrollTop = 0 }
  return [...seen]
})
console.log(all.length); console.log(all.filter(x => x.includes('Female')).join('\n'))
b.disconnect(); process.exit(0)
