import puppeteer from 'puppeteer-core'
import fs from 'fs'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const [voice, out] = process.argv.slice(2)
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
await p.bringToFront()
let got = []
const onResp = async (r) => { const ct = r.headers()['content-type'] || ''; if (/audio/.test(ct) && !/gstatic/.test(r.url())) { try { got.push({ ct, buf: await r.buffer() }) } catch {} } }
p.on('response', onResp)
const setVal = (pred, val) => p.evaluate((pred, val) => { const t = [...document.querySelectorAll('textarea')].filter(x => x.getBoundingClientRect().width > 0).find(x => new Function('x', pred)(x)); if (!t) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, val); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value === val }, pred, val)
// 목록에서 voice 항목 찾기(스크롤)
const vp = await p.evaluate(async (v) => {
  const find = () => [...document.querySelectorAll('*')].filter(x => x.children.length <= 4 && new RegExp('^(voice_selection\\s*)?' + v + '\\s*\\n').test((x.innerText || '').trim()) && x.getBoundingClientRect().height > 20 && x.getBoundingClientRect().height < 70).sort((a, b) => a.innerText.length - b.innerText.length)[0]
  let e = find()
  const sc = [...document.querySelectorAll('*')].filter(x => x.scrollHeight > x.clientHeight + 20 && /(Female|Male),[^\n]*pitch/.test(x.innerText || '') && !/음성 이름|샘플 대화/.test(x.innerText || '')).sort((a, b) => a.innerText.length - b.innerText.length)[0]
  if (!e && sc) { sc.scrollTop = 0; await new Promise(r => setTimeout(r, 300)); e = find() }
  for (let i = 0; !e && sc && i < 30; i++) { sc.scrollTop += 200; await new Promise(r => setTimeout(r, 150)); e = find() }
  if (!e) return null; e.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 300)); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, voice)
if (!vp) { console.log('목록에서 못 찾음', voice); process.exit(1) }
await p.mouse.click(vp.x, vp.y); await sl(1200)
const style = 'A young Korean woman in her early 20s speaking natural Korean with a standard Seoul accent: gentle, calm and warm, clear and soft, slightly breathy, relaxed natural pace, never childish or shrill.'
console.log('style', await setVal("return /성능 스타일|맞춤/.test(x.getAttribute('placeholder')||'') || x.value.startsWith('A young Korean')", style))
console.log('sample', await setVal("return x.getAttribute('maxlength')==='120'", '좋아요는 다 눌렀는데, 왜 나만 멈춰 있는 것 같지. 다들 보여주고 싶은 것만 올리는 거지, 뭐.'))
await sl(600)
const name = (await p.evaluate(() => document.body.innerText)).match(/음성 이름\s*\n?\s*([^\n]+)/)?.[1]
console.log('음성 이름:', name)
const pv = await p.evaluate(() => { const e = [...document.querySelectorAll('button,div[role=button]')].filter(x => x.getBoundingClientRect().width > 0).find(x => /미리보기/.test(x.textContent || '')); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
await p.mouse.click(pv.x, pv.y)
for (let i = 0; i < 40 && !got.length; i++) await sl(1000)
if (got.length) { fs.writeFileSync(out, got[got.length - 1].buf); console.log('저장', got[got.length - 1].ct, got[got.length - 1].buf.length) }
else console.log('오디오 없음', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('audio')].map(a => (a.currentSrc || a.src || '').slice(0, 80)))))
p.off('response', onResp)
b.disconnect(); process.exit(0)
