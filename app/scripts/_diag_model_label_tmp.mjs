import { attachFlow, flowKit, sleep } from './lib/flowDriver.js'

const { page, release } = await attachFlow({ port: 9222, projectId: '38cb99dc-8a17-4093-8550-89a6c8ab5f05', lang: 'en' })
const kit = flowKit(page)
try {
  await kit.openImagePopup()
  await sleep(300)
  const dd = await kit.rectOf('arrow_drop_down', 'includes', 'button')
  console.log('dropdown rect+text raw:', JSON.stringify(dd))

  // open the dropdown to see menu item texts
  if (dd) {
    await page.mouse.click(dd.x, dd.y)
    await sleep(600)
    const items = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, [role="menuitem"], [role="option"], li'))
        .map(e => (e.textContent || '').trim()).filter(t => t && t.length < 40)
    })
    console.log('menu items near dropdown:', JSON.stringify(items, null, 2))
    await page.keyboard.press('Escape')
  }
} finally {
  await kit.closeImagePopup().catch(() => {})
  await release()
}
