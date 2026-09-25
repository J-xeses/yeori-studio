import puppeteer from 'puppeteer-core'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
await p.bringToFront()
const setVal = (sel, pred, val) => p.evaluate((sel, pred, val) => { const t = [...document.querySelectorAll(sel)].filter(x => x.getBoundingClientRect().width > 0).find(x => new Function('x', pred)(x)); if (!t) return false; const proto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(t, val); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); return t.value === val }, sel, pred, val)
const clickPos = async (pos) => { if (pos) { await p.mouse.click(pos.x, pos.y); await sl(1200) } return !!pos }
// 대화창 열기
const dlgOpen = () => p.evaluate(() => /음성 선택\s*close/.test(document.body.innerText))
if (!(await dlgOpen())) await clickPos(await p.evaluate(() => { const ic = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && (e.textContent || '').trim() === 'voice_selection'); let a = ic; while (a && a.tagName !== 'BUTTON') a = a.parentElement; if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 } }))
console.log('dialog', await dlgOpen())
// Vindemiatrix 한 번 클릭
await clickPos(await p.evaluate(() => { const e = [...document.querySelectorAll('*')].filter(x => x.children.length <= 3 && (x.innerText || '').trim().startsWith('Vindemiatrix') && /pitch/.test(x.innerText || '') && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 90).sort((a, b) => a.innerText.length - b.innerText.length)[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }))
const style = 'A young Korean woman in her early 20s speaking natural Korean with a standard Seoul accent: gentle, calm and warm, clear and soft, slightly breathy, relaxed natural pace, never childish or shrill.'
console.log('style', await setVal('textarea', "return /성능 스타일/.test(x.getAttribute('placeholder')||'')", style))
console.log('sample', await setVal('textarea', "return x.getAttribute('maxlength')==='120'", '좋아요는 다 눌렀는데, 왜 나만 멈춰 있는 것 같지. 다들 보여주고 싶은 것만 올리는 거지, 뭐.'))
console.log('selected text:', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').match(/Vindemiatrix[^|]{0,60}/)?.[0])
await p.screenshot({ path: process.argv[2] })
b.disconnect(); process.exit(0)
