import { attachFlow, flowKit, sleep } from './lib/flowDriver.js'

const { page, release } = await attachFlow({ port: 9222, projectId: '38cb99dc-8a17-4093-8550-89a6c8ab5f05', lang: 'ko' })
const kit = flowKit(page)
await sleep(500)
const path1 = 'C:/Users/user/AppData/Local/Temp/claude/ec29f026d20d029c/294a6560-cec8-4356-b1e6-614cacd10b17/scratchpad/flow-state-now.png'
await page.screenshot({ path: path1 })
console.log('screenshot:', path1)

// pill 버튼 탐색 로직 재현
const pillInfo = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'))
  const candidates = btns.filter(b => {
    const r = b.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > innerHeight * 0.6
  }).map(b => ({ text: (b.textContent||'').trim().slice(0,60), top: b.getBoundingClientRect().top }))
  return candidates
})
console.log('bottom-area buttons:', JSON.stringify(pillInfo, null, 2))
await release()
