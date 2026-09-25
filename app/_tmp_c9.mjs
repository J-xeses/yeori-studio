import puppeteer from 'puppeteer-core'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
// 검색칸 비우기(값 직접 설정 — 키 입력 안 씀)
await p.evaluate(() => { const a = document.activeElement; if (a && a.tagName === 'INPUT') { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(a, ''); a.dispatchEvent(new Event('input', { bubbles: true })) } })
await sl(1200)
const vpos = await p.evaluate(() => { const e = [...document.querySelectorAll('*')].filter(x => x.children.length <= 3 && (x.innerText || '').trim().startsWith('Erinome') && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 90).sort((a, b) => a.innerText.length - b.innerText.length)[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
console.log('Erinome', !!vpos); if (vpos) { await p.mouse.click(vpos.x, vpos.y); await sl(1200) }
console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('textarea,input,[contenteditable=true]')].filter(x => x.getBoundingClientRect().width > 0).map(x => { const r = x.getBoundingClientRect(); return { tag: x.tagName, ph: x.getAttribute('placeholder'), aria: x.getAttribute('aria-label'), max: x.getAttribute('maxlength'), y: Math.round(r.top), x: Math.round(r.left), w: Math.round(r.width) } })), null, 0))
console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('button')].filter(x => x.getBoundingClientRect().width > 0).map(x => ({ t: (x.innerText || x.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 24), y: Math.round(x.getBoundingClientRect().top), dis: x.disabled })).filter(o => /미리|play|성능|추가|샘플/.test(o.t)))))
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
