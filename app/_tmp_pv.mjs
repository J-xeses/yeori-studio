import puppeteer from 'puppeteer-core'
import fs from 'fs'
const sl = (ms) => new Promise(r => setTimeout(r, ms))
const [voicesArg, outDir, line] = process.argv.slice(2)
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('/character/'))
await p.bringToFront()
let got = []
const onResp = async (r) => { const ct = r.headers()['content-type'] || ''; if (/audio/.test(ct) || (/octet-stream/.test(ct) && r.url().includes('audio'))) { try { got.push({ ct, buf: await r.buffer(), url: r.url().slice(0, 90) }) } catch {} } }
p.on('response', onResp)
const rect = (sel, pred) => p.evaluate((sel, pred) => { const e = [...document.querySelectorAll(sel)].filter(x => x.getBoundingClientRect().width > 0).find(x => new Function('x', pred)(x)); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, sel, pred)
const openDlg = async () => { const open = await p.evaluate(() => [...document.querySelectorAll("textarea")].some(x => x.getAttribute("maxlength") === "120" && x.getBoundingClientRect().width > 0) || /음성 선택s*close/.test(document.body.innerText)); if (open) return; const bpos = await p.evaluate(() => { const ic = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && (e.textContent || "").trim() === "voice_selection"); if (!ic) return null; let a = ic; while (a && a.tagName !== "BUTTON") a = a.parentElement; const r = (a || ic).getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 } }); if (bpos) { await p.mouse.click(bpos.x, bpos.y); await sl(1500) } }
let last = null
for (const v of voicesArg.split(",")) {
  got = []
  await openDlg()
  const vp = await p.evaluate((v) => { const e = [...document.querySelectorAll('*')].filter(x => x.children.length <= 3 && (x.innerText || '').trim().startsWith(v) && /pitch/.test(x.innerText || '') && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 90).sort((a, b) => a.innerText.length - b.innerText.length)[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, v)
  if (!vp) { console.log(v, '목록에 없음'); continue }
  if (last !== v) { await p.mouse.click(vp.x, vp.y); await sl(900) } last = v
  // 샘플 대화칸(maxlength=120) — 값 직접 설정(키 입력 없음)
  const ok = await p.evaluate((line) => { const t = [...document.querySelectorAll('textarea')].find(x => x.getAttribute('maxlength') === '120' && x.getBoundingClientRect().width > 0); if (!t) return false; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, line); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value === line }, line)
  if (!ok) { console.log(v, '샘플칸 못 찾음'); continue }
  await sl(400)
  const pv = await rect('button', "return /미리보기/.test(x.textContent||'')")
  await p.mouse.click(pv.x, pv.y)
  for (let i = 0; i < 25 && !got.length; i++) await sl(1000)
  if (got.length) { const g = got[got.length - 1]; const ext = /mpeg|mp3/.test(g.ct) ? 'mp3' : /wav/.test(g.ct) ? 'wav' : /ogg/.test(g.ct) ? 'ogg' : 'bin'; fs.writeFileSync(`${outDir}/${v}.${ext}`, g.buf); console.log(v, '저장', g.ct, g.buf.length) }
  else console.log(v, '오디오 응답 없음', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('audio')].map(a => (a.currentSrc || a.src || '').slice(0, 60)))))
  await sl(2500)
}
p.off('response', onResp)
b.disconnect(); process.exit(0)
