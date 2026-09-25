import puppeteer from 'puppeteer-core'
import fs from 'fs'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const [voice, out, line] = process.argv.slice(2)
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
await p.bringToFront()
const got = []
const onResp = async (r) => { const ct = r.headers()['content-type'] || ''; if (/audio|octet-stream/.test(ct) || /\.(wav|mp3|ogg)(\?|$)/.test(r.url())) { try { got.push({ url: r.url().slice(0, 80), ct, buf: await r.buffer() }) } catch {} } }
p.on('response', onResp)
// 1) 목소리 항목 클릭
const vpos = await p.evaluate((v) => { const e = [...document.querySelectorAll('*')].filter(x => x.children.length <= 3 && (x.innerText || '').trim().startsWith(v) && /pitch/.test(x.innerText || '') && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 90).sort((a, b) => a.innerText.length - b.innerText.length)[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, voice)
if (!vpos) { console.log('voice not found'); process.exit(1) }
await p.mouse.click(vpos.x, vpos.y); await sl(800)
// 2) 샘플 대화 입력칸
const ta = await p.evaluate(() => { const e = [...document.querySelectorAll('textarea,input,[contenteditable=true]')].filter(x => x.getBoundingClientRect().width > 0).find(x => { let a = x; for (let k = 0; k < 6 && a; k++) { if (/샘플 대화/.test(a.innerText || '')) return true; a = a.parentElement } return false }); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, tag: e.tagName, val: e.value || e.innerText || '' } })
if (!ta) { console.log('textarea not found'); process.exit(1) }
await p.mouse.click(ta.x, ta.y); await sl(300)
const focusedOk = await p.evaluate(() => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable) && [...Array(6)].reduce((acc) => acc, true) })
if (!focusedOk) { console.log('focus not on input — abort typing'); process.exit(1) }
const cur = await p.evaluate(() => document.activeElement.value ?? document.activeElement.innerText ?? '')
if (cur && cur !== line) { await p.evaluate(() => { const a = document.activeElement; if ('value' in a) { a.value = ''; a.dispatchEvent(new Event('input', { bubbles: true })) } }) }
if (cur !== line) await p.keyboard.type(line, { delay: 15 })
await sl(500)
// 3) 미리보기
const pv = await p.evaluate(() => { const e = [...document.querySelectorAll('button')].find(x => /미리보기/.test(x.textContent || '') && x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, dis: e.disabled } })
console.log('preview btn', JSON.stringify(pv))
if (pv && !pv.dis) { await p.mouse.click(pv.x, pv.y) }
for (let i = 0; i < 30 && !got.length; i++) await sl(1000)
const media = await p.evaluate(() => [...document.querySelectorAll('audio,video')].map(m => (m.currentSrc || m.src || '').slice(0, 80)))
console.log('responses', got.map(g => `${g.ct} ${g.buf.length}B ${g.url}`).join(' | '), '| media', media.join(' , '))
if (got.length) { fs.writeFileSync(out, got[got.length - 1].buf); console.log('saved', out) }
p.off('response', onResp)
b.disconnect(); process.exit(0)
