import puppeteer from 'puppeteer-core'
import fs from 'fs'

const DEBUGGING_PORT = 9222
const FLOW_URL_MARKER = 'labs.google/fx'

async function main() {
  // Chrome 연결
  let version
  try {
    const res = await fetch(`http://127.0.0.1:${DEBUGGING_PORT}/json/version`)
    version = await res.json()
  } catch {
    console.error(`Chrome 포트 ${DEBUGGING_PORT}에 연결 실패`)
    process.exit(1)
  }
  console.log(`Chrome 연결: ${version.Browser}`)

  const browser = await puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport: null,
  })

  // ep5 Flow 프로젝트 탭 찾기
  const pages = await browser.pages()
  console.log(`\n열린 탭 ${pages.length}개:`)
  for (let i = 0; i < pages.length; i++) {
    const title = await pages[i].title().catch(() => '(title 없음)')
    console.log(`  [${i}] url  : ${pages[i].url()}`)
    console.log(`       title: ${title}`)
  }

  // Flow 프로젝트 URL을 가진 탭 찾기
  let page = pages.find(p => p.url().includes(FLOW_URL_MARKER))
  if (!page) {
    // ep5 project_url.txt에서 URL 읽기
    const urlFile = 'C:\\yeori-studio\\downloads\\flow\\ep5\\project_url.txt'
    if (fs.existsSync(urlFile)) {
      const projectUrl = fs.readFileSync(urlFile, 'utf-8').trim()
      console.log(`Flow 탭 없음 → 새 탭으로 이동: ${projectUrl}`)
      page = pages[0] || await browser.newPage()
      await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      await new Promise(r => setTimeout(r, 2000))
    } else {
      console.error('Flow 탭을 찾을 수 없고 project_url.txt도 없음')
      await browser.disconnect()
      process.exit(1)
    }
  } else {
    const title = await page.title().catch(() => '(title 없음)')
    const idx = pages.indexOf(page)
    console.log(`\n▶ 스캔 대상: [${idx}] "${title}"`)
    console.log(`  url: ${page.url()}`)
  }

  // 전체 페이지 DOM 스캔
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  textContent에 동영상/이미지/Video/Image 포함 요소 스캔')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const results = await page.evaluate(() => {
    const found = []
    const keywords = ['동영상', '이미지', 'Video', 'Image']

    function getAncestors(el, depth) {
      const ancestors = []
      let cur = el.parentElement
      for (let i = 0; i < depth && cur; i++) {
        ancestors.push({ tag: cur.tagName, className: cur.className || '' })
        cur = cur.parentElement
      }
      return ancestors
    }

    function scan(root, depth = 0) {
      if (depth > 15) return
      for (const el of root.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        const txt = (el.textContent || '').trim()
        if (!keywords.some(k => txt.includes(k))) continue
        // 자식 요소도 매칭되면 leaf에 가까운 요소만 선별 (자식 수 10개 이하)
        if (el.children.length > 10) continue

        found.push({
          tag: el.tagName,
          role: el.getAttribute('role') || '',
          txt: txt.slice(0, 120),
          ariaSelected: el.getAttribute('aria-selected'),
          ariaPressed: el.getAttribute('aria-pressed'),
          ariaChecked: el.getAttribute('aria-checked'),
          dataActive: el.getAttribute('data-active'),
          className: el.className || '',
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          ancestors: getAncestors(el, 2),
        })
        if (el.shadowRoot) scan(el.shadowRoot, depth + 1)
      }
    }
    scan(document)
    return found
  })

  console.log(`총 ${results.length}개 요소 발견\n`)
  results.forEach((el, i) => {
    console.log(`[${i}] <${el.tag} role="${el.role}">`)
    console.log(`     txt     : "${el.txt}"`)
    console.log(`     pos     : (${el.x}, ${el.y})  size: ${el.w}x${el.h}`)
    console.log(`     aria    : selected=${el.ariaSelected}  pressed=${el.ariaPressed}  checked=${el.ariaChecked}  data-active=${el.dataActive}`)
    console.log(`     class   : "${el.className}"`)
    el.ancestors.forEach((a, ai) =>
      console.log(`     parent${ai + 1} : <${a.tag} class="${a.className}">`)
    )
    console.log()
  })

  await browser.disconnect()
}

main().catch(err => {
  console.error('오류:', err.message)
  process.exit(1)
})
