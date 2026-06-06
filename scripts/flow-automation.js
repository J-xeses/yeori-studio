/**
 * 여리 스튜디오 - Google Flow 이미지 자동화
 *
 * 사용법:
 *   npm run flow                            # downloads/flow/prompts.json 기반 실행
 *   npm run flow -- --ep=1                 # 에피소드 1만 처리
 *   npm run flow -- --cut=3                # CUT 3만 처리
 *   npm run flow -- --dry                  # 실제 생성 없이 프롬프트 목록 출력
 *   npm run flow -- --prompts=my.json     # 외부 프롬프트 파일 지정
 *   npm run flow -- --register-character  # 서여리 시그니처 얼굴 캐릭터 등록
 *   npm run flow -- --gen-face            # 클로즈업 얼굴 이미지 먼저 생성 후 캐릭터 등록
 *
 * 캐릭터 등록 준비:
 *   downloads/flow/character/yeori-face.jpg  에 클로즈업 얼굴 이미지를 넣어두세요.
 *   (--gen-face 옵션 사용 시 자동 생성)
 */

import puppeteer from 'puppeteer-core'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// .env 및 .env.local 로드
;['.env', '.env.local'].forEach(name => {
  const envPath = path.join(ROOT, name)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '')
  })
})

// ── 설정 ─────────────────────────────────────────────────────────────
const CONFIG = {
  chromeProfile:   'C:\\Users\\user\\AppData\\Local\\YeoriStudio\\chrome-profile',
  chromeExe:       'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  downloadDir:     path.join(ROOT, 'downloads', 'flow'),
  flowUrl:         'https://labs.google/flow',
  delayMs:         4000,   // 생성 요청 사이 대기 (레이트 리밋 방지)
  timeoutMs:       120000, // 이미지 생성 최대 대기 시간
  retryCount:      2,      // 실패 시 재시도 횟수

  // ── 레퍼런스 이미지 분석 ────────────────────────────────────────────
  referenceImage:  path.join(ROOT, 'assets', 'yeori-reference.jpg'),
  faceCacheFile:   path.join(ROOT, 'downloads', 'flow', 'yeori-face-cache.json'),

  // ── 클로즈업 얼굴 프롬프트 (에피소드당 1회) ────────────────────────
  closeupFacePrompt: 'Close-up face shot. Young Korean woman early-20s appearing no older than 22-23, long wavy dark brown hair NOT short NOT permed NOT curly, natural wave only flowing naturally, natural skin texture, delicate gold necklace, soft natural smile, calm expression NOT surprised NOT wide eyes, warm skin tone, high facial symmetry, sharp jawline, effortlessly photogenic not posing. Photorealistic 8K cinematic.',

  // ── 전신샷 자동 추가 프리픽스/서픽스 ──────────────────────────────
  bodyPrefix:   'Same face as closeup reference. Maintain exact same facial features. Face clearly visible. tall K-model proportions, very small face, long slim legs, slender figure, tall fashion model body, small head-to-body ratio, NOT petite, NOT short stature, NOT average body, DO NOT change body proportions.',
  bgSuffix:     'background people blurred and far away, must not interact with or touch main character, main character is clearly separated from background.',

  // ── 서여리 캐릭터 설정 ──────────────────────────────────────────────
  characterName:   '서여리',
  characterDir:    path.join(ROOT, 'downloads', 'flow', 'character'),
  characterImage:  path.join(ROOT, 'downloads', 'flow', 'character', 'yeori-face.jpg'),
  // 클로즈업 얼굴 생성 프롬프트 (--gen-face 사용 시)
  facePrompt: 'Young Korean woman early 20s, extreme close-up portrait, long wavy dark brown hair NOT short, natural skin texture on right cheek (subtle, not a prominent mark), delicate gold necklace, natural effortless expression, K-model proportions very small face, appearing no older than 22-23, bright natural eyes, soft lips, flawless skin, soft studio lighting, neutral background, Photorealistic 8K cinematic headshot 1:1',
}

// ── 예시 prompts.json 포맷 ────────────────────────────────────────────
const PROMPTS_EXAMPLE = {
  episode: 1,
  title: '에피소드 제목',
  generatedAt: new Date().toISOString(),
  cuts: [
    {
      no: 1,
      episode: 1,
      scene: '카페 창가',
      imagePrompt: 'Young Korean woman early 20s, long wavy dark brown hair, natural skin texture on right cheek, gold necklace, sitting by cafe window, morning light, Photorealistic 8K cinematic 9:16',
    },
  ],
}

// ── 진입점 ────────────────────────────────────────────────────────────
const args = parseArgs()

// 상세 에러 로그: stack trace 포함 출력 → proxy의 stderr 파이프로 전달됨
main().catch(err => {
  console.error(`[flow] 치명적 오류: ${err.message}`)
  if (err.stack) console.error(err.stack)
  log('error', `치명적 오류: ${err.message}`)
  process.exit(1)
})

// ── 유틸리티 ─────────────────────────────────────────────────────────

function parseArgs() {
  return Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => {
        const [k, v] = a.slice(2).split('=')
        return [k, v ?? true]
      })
  )
}

function log(level, msg) {
  const prefix = { info: 'ℹ️ ', ok: '✅', warn: '⚠️ ', error: '❌', step: '⏳' }
  console.log(`${prefix[level] ?? '  '} ${msg}`)
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// 이미지 개수가 2초간 변화 없을 때까지 대기 (최대 10초)
async function waitForImagesStable(page) {
  let prev = -1, stableMs = 0
  const deadline = Date.now() + 10000
  while (stableMs < 2000 && Date.now() < deadline) {
    const cur = (await collectImageSrcs(page)).length
    if (cur === prev) { stableMs += 400 } else { stableMs = 0; prev = cur }
    await sleep(400)
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// ── 레퍼런스 이미지 분석 (Claude API) ───────────────────────────────

async function analyzeReferenceImage() {
  const refPath = CONFIG.referenceImage
  if (!fs.existsSync(refPath)) {
    log('warn', `레퍼런스 이미지 없음: ${refPath} (얼굴 분석 건너뜀)`)
    return null
  }

  // 파일 크기+날짜 기반 캐시 무효화
  const stat = fs.statSync(refPath)
  const cacheKey = `${stat.size}_${stat.mtimeMs}`

  if (fs.existsSync(CONFIG.faceCacheFile)) {
    const cache = JSON.parse(fs.readFileSync(CONFIG.faceCacheFile, 'utf-8'))
    if (cache.key === cacheKey && cache.features) {
      log('info', '레퍼런스 이미지 캐시 적용')
      return cache.features
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    log('warn', 'ANTHROPIC_API_KEY 없음 → .env.local에 추가 필요 (얼굴 분석 건너뜀)')
    return null
  }

  log('info', 'Claude API로 레퍼런스 이미지 분석 중…')

  const imgBase64 = fs.readFileSync(refPath).toString('base64')
  const client = new Anthropic({ apiKey })

  const res = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imgBase64 },
        },
        {
          type: 'text',
          text: "Analyze this woman's face and output a single concise descriptor for AI image generation consistency. Start with 'Consistent character face:' then precisely describe: face shape, eye shape and color, nose, lips, skin tone, hair, and any distinctive features (e.g. beauty marks). 1–2 sentences max. No extra commentary.",
        },
      ],
    }],
  })

  const features = res.content[0]?.text?.trim()
  if (!features) throw new Error('Claude API 응답 없음')

  fs.writeFileSync(CONFIG.faceCacheFile, JSON.stringify({ key: cacheKey, features, analyzedAt: new Date().toISOString() }, null, 2))
  log('ok', `얼굴 분석: ${features.slice(0, 100)}…`)

  return features
}

// ── 프롬프트 로드 ────────────────────────────────────────────────────

function loadPrompts() {
  const file = args.prompts
    ? path.resolve(args.prompts)
    : path.join(CONFIG.downloadDir, 'prompts.json')

  if (!fs.existsSync(file)) {
    log('warn', `프롬프트 파일 없음: ${file}`)
    log('info', '여리 스튜디오 → 스튜디오 탭 → "프롬프트 JSON 내보내기" 버튼을 먼저 실행하세요.')
    log('info', `또는 아래 형식으로 직접 생성하세요:\n${JSON.stringify(PROMPTS_EXAMPLE, null, 2)}`)
    process.exit(0)
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))

  // 배열 직접 or { episode, cuts: [...] } 형식 모두 처리
  const episode = raw.episode ?? null
  const type    = raw.type ?? 'shorts'   // "shorts" → 9:16 / "longform" → 16:9
  const cuts = (Array.isArray(raw) ? raw : raw.cuts ?? [])
    .filter(c => c.imagePrompt?.trim())
    .filter(c => !args.ep  || String(c.episode ?? episode) === String(args.ep))
    .filter(c => !args.cut || String(c.no) === String(args.cut))

  return { episode, type, cuts }
}

// ── 메인 ─────────────────────────────────────────────────────────────

async function main() {
  ensureDir(CONFIG.downloadDir)
  ensureDir(CONFIG.characterDir)

  // ── 캐릭터 등록 모드 ───────────────────────────────────────────────
  if (args['register-character'] || args['gen-face']) {
    const browser = await launchBrowser()
    const page = await setupPage(browser)
    try {
      await navigateToFlow(page)

      // --gen-face: 클로즈업 얼굴 먼저 생성
      if (args['gen-face'] && !fs.existsSync(CONFIG.characterImage)) {
        log('info', '서여리 시그니처 얼굴 이미지 생성 중…')
        await generateFaceImage(page)
      }

      // 캐릭터 이미지 확인
      if (!fs.existsSync(CONFIG.characterImage)) {
        log('warn', `캐릭터 이미지 없음: ${CONFIG.characterImage}`)
        log('info', '해당 경로에 클로즈업 얼굴 이미지를 넣거나 --gen-face 옵션을 사용하세요.')
        return
      }

      await registerCharacter(page)
    } finally {
      await browser.close()
    }
    return
  }

  // ── 일반 이미지 생성 모드 ─────────────────────────────────────────
  const { episode, type, cuts } = loadPrompts()
  if (!cuts.length) {
    log('warn', '처리할 프롬프트가 없습니다. 조건을 확인하세요.')
    return
  }

  // 레퍼런스 이미지 → Claude API 얼굴 분석 → 프롬프트 앞에 자동 추가
  const faceFeatures = await analyzeReferenceImage()
  if (faceFeatures) {
    cuts.forEach(c => { c.imagePrompt = `${faceFeatures} ${c.imagePrompt}` })
    log('ok', `얼굴 특징 ${cuts.length}개 컷 프롬프트에 자동 추가`)
  }

  printHeader(episode, type, cuts)

  if (args.dry) {
    cuts.forEach((c, i) =>
      console.log(`  [${i + 1}] CUT ${c.no}: ${c.imagePrompt.slice(0, 120)}…`)
    )
    return
  }

  let browser
  try {
    browser = await launchBrowser()
  } catch (err) {
    console.error(`[flow] Chrome 실행 실패: ${err.message}`)
    console.error(`[flow] chromeExe 경로: ${CONFIG.chromeExe}`)
    throw err
  }

  const page = await setupPage(browser)
  let ok = 0, fail = 0
  const results = []

  try {
    await navigateToFlow(page)

    // ── 에피소드 클로즈업 1회 생성 또는 재사용 ──────────────────────
    const epDir = path.join(CONFIG.downloadDir, `ep${episode}`)
    ensureDir(epDir)
    const closeupPath = path.join(epDir, 'yeori_closeup.jpg')

    if (fs.existsSync(closeupPath)) {
      log('ok', `yeori_closeup.jpg 재사용: ${path.relative(ROOT, closeupPath)}`)
    } else {
      log('step', '클로즈업 얼굴 이미지 생성 중 (에피소드 1회)…')
      await generateEpisodeCloseup(page, closeupPath)
      log('ok', `클로즈업 저장: ${path.relative(ROOT, closeupPath)}`)
      await sleep(CONFIG.delayMs)
    }

    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i]
      const label = `[${i + 1}/${cuts.length}] CUT ${cut.no}`
      log('step', `${label} 생성 중…`)

      let success = false
      for (let attempt = 0; attempt <= CONFIG.retryCount; attempt++) {
        try {
          const savedPath = await processCut(page, cut, episode, closeupPath, type)
          log('ok', `${label} → ${path.relative(ROOT, savedPath)}`)
          results.push({ cutNo: cut.no, status: 'ok', file: savedPath })
          ok++; success = true; break
        } catch (err) {
          if (attempt < CONFIG.retryCount) {
            log('warn', `${label} 재시도 ${attempt + 1}/${CONFIG.retryCount}: ${err.message}`)
            await sleep(2000)
          } else {
            log('error', `${label} 실패: ${err.message}`)
            results.push({ cutNo: cut.no, status: 'fail', reason: err.message })
            fail++
          }
        }
      }

      if (i < cuts.length - 1) {
        process.stdout.write(`   ${CONFIG.delayMs / 1000}초 대기 중…`)
        await sleep(CONFIG.delayMs)
        process.stdout.write('\r' + ' '.repeat(30) + '\r')
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }

  printSummary(ok, fail, results)
  saveReport(episode, results)
}

// ── 브라우저 설정 ─────────────────────────────────────────────────────

async function launchBrowser() {
  log('info', 'Chrome 실행 중 (YeoriStudio 프로필)…')
  return puppeteer.launch({
    executablePath: CONFIG.chromeExe,
    userDataDir:    CONFIG.chromeProfile,
    headless:       false,         // 기존 Google 로그인 유지를 위해 headful
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
}

async function setupPage(browser) {
  const page = await browser.newPage()

  // 자동화 감지 방지
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  // CDP 다운로드 경로 설정
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', {
    behavior:     'allow',
    downloadPath: CONFIG.downloadDir,
  })
  page._cdpClient = client

  return page
}

async function navigateToFlow(page) {
  log('info', `Flow 접속 중: ${CONFIG.flowUrl}`)
  await page.goto(CONFIG.flowUrl, { waitUntil: 'networkidle2', timeout: 30000 })

  // 로그인 필요 여부 확인
  if (page.url().includes('accounts.google.com') || page.url().includes('signin')) {
    log('warn', '구글 로그인이 필요합니다. 브라우저에서 로그인 후 Enter를 눌러주세요.')
    await waitForEnter()
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
  }

  // 쿠키 동의 배너 처리 (클릭 후 대시보드로 강제 이동)
  const hadCookie = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const agree = btns.find(b => /^(agree|동의)$/i.test(b.textContent.trim()))
    if (agree) { agree.click(); return true }
    return false
  })
  if (hadCookie) await sleep(500)

  // 대시보드 URL로 직접 이동
  const dashboardUrl = 'https://labs.google/fx/ko/tools/flow'
  if (!page.url().startsWith(dashboardUrl) || page.url().includes('/about')) {
    await page.goto(dashboardUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2000)
  }

  // 기존 프로젝트 링크 추출 후 이동
  const projectUrl = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/flow/project/"]')
    return a?.href ?? null
  })

  if (projectUrl) {
    log('info', `프로젝트 페이지로 이동: ${projectUrl}`)
    await page.goto(projectUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2500)
  } else {
    log('warn', '기존 프로젝트를 찾지 못했습니다. Flow에서 프로젝트를 먼저 만들어주세요.')
  }

  log('ok', `Flow 준비 완료: ${page.url()}`)
  // 기존 이미지가 모두 로드될 때까지 대기 (beforeItems 정확도 확보)
  await waitForImagesStable(page)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_project.png'), fullPage: true })
  log('info', '프로젝트 UI 스크린샷: downloads/flow/debug_project.png')
}

// ── 캐릭터 등록 ──────────────────────────────────────────────────────

async function registerCharacter(page) {
  log('info', `서여리 캐릭터 등록 시작: ${CONFIG.characterImage}`)

  // 대시보드로 이동 (캐릭터 탭은 프로젝트 외부에 있음)
  const dashUrl = 'https://labs.google/fx/ko/tools/flow'
  if (!page.url().startsWith(dashUrl) || page.url().includes('/project/')) {
    await page.goto(dashUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(1500)
  }

  // 캐릭터 탭 클릭 (사이드바 "캐릭터" 메뉴)
  const charTabClicked = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('a, button, [role="tab"], [role="menuitem"]')) {
        const txt = el.textContent.trim()
        if (txt === '캐릭터' || txt.includes('캐릭터') || txt.toLowerCase().includes('character')) {
          el.click(); return true
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && search(el.shadowRoot)) return true
      }
      return false
    }
    return search(document)
  })

  if (!charTabClicked) {
    // 사이드바 캐릭터 탭 URL로 직접 이동 시도
    await page.goto('https://labs.google/fx/ko/tools/flow/characters', { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {})
  }
  await sleep(1500)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_character_tab.png'), fullPage: true })

  // "캐릭터 만들기" / "Create a character" 버튼 클릭
  const createClicked = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('button, a')) {
        const txt = el.textContent.trim()
        if (/(캐릭터 만들기|create.{0,10}character|새 캐릭터|character 추가)/i.test(txt)) {
          el.click(); return true
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && search(el.shadowRoot)) return true
      }
      return false
    }
    return search(document)
  })

  if (!createClicked) {
    log('warn', '"캐릭터 만들기" 버튼을 찾지 못했습니다. 스크린샷을 확인하세요.')
    log('info', '스크린샷: downloads/flow/debug_character_tab.png')
    return
  }

  await sleep(2000)
  log('info', '"캐릭터 만들기" 클릭 완료')

  // 파일 업로드 인풋 탐색 (Shadow DOM 포함)
  const uploaded = await uploadCharacterImage(page, CONFIG.characterImage)
  if (!uploaded) {
    log('warn', '파일 업로드 인풋을 찾지 못했습니다.')
    return
  }

  await sleep(2000)

  // 캐릭터 이름 입력
  await typeCharacterName(page, CONFIG.characterName)
  await sleep(800)

  // 저장 / 확인 버튼 클릭
  const saved = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('button')) {
        const txt = el.textContent.trim()
        if (/(저장|완료|확인|save|done|confirm|create)/i.test(txt) && !el.disabled) {
          el.click(); return true
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && search(el.shadowRoot)) return true
      }
      return false
    }
    return search(document)
  })

  await sleep(2000)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_character_done.png'), fullPage: true })

  if (saved) {
    log('ok', `서여리 캐릭터 등록 완료! (스크린샷: downloads/flow/debug_character_done.png)`)
  } else {
    log('warn', '저장 버튼을 찾지 못했습니다. 스크린샷을 확인하세요.')
  }
}

async function uploadCharacterImage(page, imagePath) {
  // Shadow DOM 포함 파일 input 탐색
  const inputHandle = await page.evaluateHandle(() => {
    function search(root) {
      for (const el of root.querySelectorAll('input[type="file"]')) return el
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const found = search(el.shadowRoot)
          if (found) return found
        }
      }
      return null
    }
    return search(document)
  })

  const inputEl = inputHandle.asElement()
  if (inputEl) {
    await inputEl.uploadFile(imagePath)
    log('info', `이미지 업로드: ${path.basename(imagePath)}`)
    return true
  }

  // 파일 input이 없으면 업로드 영역 클릭 후 파일 선택 다이얼로그 처리
  const uploadAreaClicked = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('*')) {
        const txt = (el.textContent || '').trim()
        const label = (el.getAttribute('aria-label') || '').toLowerCase()
        if (/(이미지 추가|사진 추가|업로드|upload|drag|drop|add photo|add image)/i.test(txt + label)) {
          if (el.offsetWidth > 0) { el.click(); return true }
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && search(el.shadowRoot)) return true
      }
      return false
    }
    return search(document)
  })

  if (uploadAreaClicked) {
    // 파일 선택 다이얼로그가 열리면 CDP로 파일 경로 주입
    await sleep(500)
    const inputAfterClick = await page.evaluateHandle(() => {
      function search(root) {
        for (const el of root.querySelectorAll('input[type="file"]')) return el
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const f = search(el.shadowRoot); if (f) return f }
        }
        return null
      }
      return search(document)
    })
    const el2 = inputAfterClick.asElement()
    if (el2) {
      await el2.uploadFile(imagePath)
      log('info', `이미지 업로드 (클릭 후): ${path.basename(imagePath)}`)
      return true
    }
  }
  return false
}

async function typeCharacterName(page, name) {
  const typed = await page.evaluate((name) => {
    function search(root) {
      for (const el of root.querySelectorAll('input[type="text"], [contenteditable="true"]')) {
        const ph = (el.placeholder || el.getAttribute('aria-label') || '').toLowerCase()
        if (ph.includes('이름') || ph.includes('name') || el.offsetWidth > 0) {
          el.focus()
          el.value = name
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && search(el.shadowRoot)) return true
      }
      return false
    }
    return search(document)
  }, name)

  if (!typed) {
    // 포커스된 요소에 직접 타이핑
    await page.keyboard.type(name, { delay: 50 })
  }
  log('info', `캐릭터 이름 입력: ${name}`)
}

// ── 클로즈업 얼굴 생성 ────────────────────────────────────────────────

async function generateFaceImage(page) {
  const inputPos = await findPromptInputPos(page)
  await page.mouse.click(inputPos.x, inputPos.y)
  await sleep(400)
  await page.mouse.click(inputPos.x, inputPos.y, { clickCount: 3 })
  await sleep(200)
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(100)
  await page.keyboard.type(CONFIG.facePrompt, { delay: 15 })
  await sleep(500)
  await page.keyboard.press('Enter')
  log('info', '서여리 얼굴 이미지 생성 요청 전송…')

  // 생성 대기
  const beforeCount = await page.evaluate(() => {
    function count(root) {
      let n = 0
      for (const img of root.querySelectorAll('img')) { if (img.naturalWidth > 80 && img.complete) n++ }
      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) n += count(el.shadowRoot) }
      return n
    }
    return count(document)
  })

  await page.waitForFunction(
    (b) => {
      function count(root) {
        let n = 0
        for (const img of root.querySelectorAll('img')) { if (img.naturalWidth > 80 && img.complete) n++ }
        for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) n += count(el.shadowRoot) }
        return n
      }
      return count(document) > b
    },
    { timeout: CONFIG.timeoutMs },
    beforeCount
  )
  await sleep(1000)

  // 생성된 이미지 저장
  const srcs = await page.evaluate(() => {
    function collect(root, list = []) {
      for (const img of root.querySelectorAll('img')) {
        if (img.naturalWidth > 80 && img.complete && img.src) list.push(img.src)
      }
      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) collect(el.shadowRoot, list) }
      return list
    }
    return collect(document)
  })

  if (!srcs.length) throw new Error('얼굴 이미지 생성 결과를 찾지 못했습니다')

  const imgSrc = srcs[srcs.length - 1]
  const data = await page.evaluate(async (src) => {
    const res = await fetch(src)
    const buf = await res.arrayBuffer()
    return Array.from(new Uint8Array(buf))
  }, imgSrc)

  fs.writeFileSync(CONFIG.characterImage, Buffer.from(data))
  log('ok', `얼굴 이미지 저장: ${path.relative(ROOT, CONFIG.characterImage)}`)
}

// ── 공통: 하단 "만들기(+)" 버튼 클릭 ───────────────────────────────

async function clickPlusButton(page) {
  const result = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight * 0.7 || r.width === 0) continue
      const txt = el.textContent.trim()
      if (txt.includes('만들기') || txt === '+') { el.click(); return txt }
    }
    return null
  })
  if (result) log('info', `+ 버튼 클릭: "${result}"`)
  return !!result
}

// ── Step 1용: 캐릭터 탭 → Seo Yeori 선택 → 프롬프트에 추가 ──────────

async function attachYeoriCharacterToPrompt(page) {
  if (!await clickPlusButton(page)) { log('warn', '+ 버튼 못 찾음'); return false }
  await sleep(1200)

  // 왼쪽 패널 "캐릭터" 탭 클릭
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const txt = el.textContent.trim()
      const r = el.getBoundingClientRect()
      if ((txt === '캐릭터' || txt.includes('accessibility_new캐릭터'))
          && r.left < 700 && r.top > 400 && el.offsetWidth > 0 && el.offsetWidth < 200) {
        el.click(); return
      }
    }
  })
  await sleep(800)

  // 우측 패널에서 Seo Yeori 캐릭터 선택
  const charClicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const txt = el.textContent.trim()
      if ((txt.includes('Untitled Character') || txt === '서여리' || txt.includes('Seo Yeori'))
          && el.offsetWidth > 0 && el.offsetWidth < 300) {
        el.click(); return txt.slice(0, 30)
      }
    }
    return null
  })
  if (!charClicked) { log('warn', 'Seo Yeori 캐릭터 못 찾음, 건너뜀'); return false }
  log('info', `캐릭터 선택: "${charClicked}"`)
  await sleep(800)

  const addClicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button')) {
      if (el.textContent.includes('프롬프트에 추가') && !el.disabled) { el.click(); return true }
    }
    return false
  })
  if (!addClicked) { log('warn', '"프롬프트에 추가" 못 찾음'); return false }
  log('info', 'Seo Yeori 캐릭터 프롬프트에 추가 완료')
  await sleep(800)
  return true
}

// ── Step 2용: "+" → 이미지 탭 클릭 → 최신 이미지(Step1 클로즈업) → 프롬프트에 추가

async function attachMostRecentProjectImage(page) {
  if (!await clickPlusButton(page)) { log('warn', 'Step2 + 버튼 못 찾음'); return false }
  await sleep(1500)

  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_step2_menu.png') })

  // 플로팅 메뉴 왼쪽 패널의 "이미지" 탭 클릭
  // (사이드바 x<100 제외, 플로팅 메뉴 x=130~350 범위)
  const imgTabClicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('*')].filter(el => {
      const txt = el.textContent.trim()
      const r = el.getBoundingClientRect()
      return txt === '이미지'
        && r.left > 130 && r.left < 400
        && r.top > 200
        && el.offsetWidth > 0 && el.offsetWidth < 200
    })
    if (items[0]) { items[0].click(); return true }
    return false
  })
  if (!imgTabClicked) log('warn', '이미지 탭 못 찾음, 현재 패널에서 시도')
  await sleep(800)

  // 우측 패널에서 가장 위(최신)에 있는 이미지 항목 클릭
  // 플로팅 메뉴 우측 패널은 x > 350 범위
  const imgInfo = await page.evaluate(() => {
    const items = [...document.querySelectorAll('*')].filter(el => {
      const txt = el.textContent.trim()
      const r = el.getBoundingClientRect()
      return txt.endsWith('이미지') && txt.length > 5
        && el.offsetWidth > 50 && el.offsetWidth < 400
        && r.top > 200 && r.left > 350
    }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    if (!items[0]) return null
    const r = items[0].getBoundingClientRect()
    return { txt: items[0].textContent.trim().slice(0, 40), x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }
  })

  if (!imgInfo) {
    log('warn', 'Step2 최근 이미지 못 찾음, 건너뜀')
    await page.keyboard.press('Escape')
    return false
  }

  log('info', `Step2 이미지 선택: "${imgInfo.txt}" at (${imgInfo.x}, ${imgInfo.y})`)
  await page.mouse.click(imgInfo.x, imgInfo.y)
  await sleep(800)

  const addClicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button')) {
      if (el.textContent.includes('프롬프트에 추가') && !el.disabled) { el.click(); return true }
    }
    return false
  })
  if (addClicked) log('info', 'Step1 클로즈업 이미지 프롬프트에 추가 완료')
  else log('warn', '"프롬프트에 추가" 못 찾음, 건너뜀')
  await sleep(800)
  return addClicked
}

// ── 입력창 초기화 + 캐릭터/이미지 첨부 공통 헬퍼 ──────────────────────

async function prepareInput(page) {
  const inputPos = await findPromptInputPos(page)
  await page.mouse.click(inputPos.x, inputPos.y)
  await sleep(400)
  await page.mouse.click(inputPos.x, inputPos.y, { clickCount: 3 })
  await sleep(200)
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(100)
  return inputPos
}

// ── 컷 처리 — 클로즈업 레퍼런스 재사용 ─────────────────────────────

async function processCut(page, cut, defaultEpisode, closeupPath, type = 'shorts') {
  const ep = cut.episode ?? defaultEpisode ?? 'x'

  // 전신샷 프롬프트에 K모델 비율 + 얼굴 일관성 + 배경 통제 자동 주입
  const finalPrompt = [
    CONFIG.bodyPrefix,
    cut.imagePrompt.trim(),
    CONFIG.bgSuffix,
  ].join(' ')

  log('step', `전신 컷 생성 중… (yeori_closeup.jpg 레퍼런스, ${type === 'longform' ? '16:9' : '9:16'})`)
  const pos = await prepareInput(page)
  log('info', `입력창: (${Math.round(pos.x)}, ${Math.round(pos.y)})`)

  await attachYeoriCharacterToPrompt(page)
  await attachCloseupToPrompt(page, closeupPath)
  await setAspectRatio(page, type)

  await page.mouse.click(pos.x, pos.y)
  await sleep(300); await page.keyboard.press('End'); await sleep(100)
  await page.keyboard.type(finalPrompt, { delay: 15 })
  await sleep(500)

  const before = await collectImageSrcs(page)
  await clickGenerate(page)
  await waitForNewImage(page, before)
  return saveNewImage(page, before, cut.no, ep, 'cut')
}

// ── 에피소드 클로즈업 1회 생성 ──────────────────────────────────────

async function generateEpisodeCloseup(page, savePath) {
  const pos = await prepareInput(page)
  await attachYeoriCharacterToPrompt(page)

  await page.mouse.click(pos.x, pos.y)
  await sleep(300); await page.keyboard.press('End'); await sleep(100)
  await page.keyboard.type(CONFIG.closeupFacePrompt, { delay: 15 })
  await sleep(500)

  const before = await collectImageSrcs(page)
  await clickGenerate(page)
  await waitForNewImage(page, before)

  const allItems = await collectImageSrcs(page)
  const beforeSet = new Set(before.map(i => i.src))
  const newItems = allItems.filter(i => !beforeSet.has(i.src))
  if (!newItems.length) throw new Error('클로즈업 이미지를 찾지 못했습니다')

  const imgSrc = newItems[newItems.length - 1].src
  let saved = false
  if (imgSrc.startsWith('data:')) {
    fs.writeFileSync(savePath, Buffer.from(imgSrc.split(',')[1], 'base64'))
    saved = true
  } else {
    const data = await page.evaluate(async (src) => {
      try { const res = await fetch(src); const buf = await res.arrayBuffer(); return Array.from(new Uint8Array(buf)) }
      catch { return null }
    }, imgSrc)
    if (data) { fs.writeFileSync(savePath, Buffer.from(data)); saved = true }
  }
  if (!saved) throw new Error('클로즈업 이미지 저장 실패')
}

// ── 클로즈업 이미지 프롬프트 첨부 ───────────────────────────────────

async function attachCloseupToPrompt(page, closeupPath) {
  if (!await clickPlusButton(page)) { log('warn', 'closeup: + 버튼 못 찾음'); return false }
  await sleep(1200)

  // 이미지 탭 클릭
  const imgTabClicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('*')].filter(el => {
      const txt = el.textContent.trim()
      const r = el.getBoundingClientRect()
      return txt === '이미지'
        && r.left > 130 && r.left < 400
        && r.top > 200
        && el.offsetWidth > 0 && el.offsetWidth < 200
    })
    if (items[0]) { items[0].click(); return true }
    return false
  })
  if (!imgTabClicked) log('warn', 'closeup: 이미지 탭 못 찾음')
  await sleep(800)

  // 파일 input 탐색 → 클로즈업 업로드 시도
  const fileInput = await page.evaluateHandle(() => {
    function search(root) {
      for (const el of root.querySelectorAll('input[type="file"]')) return el
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const f = search(el.shadowRoot); if (f) return f }
      }
      return null
    }
    return search(document)
  })
  const fileEl = fileInput.asElement()
  if (fileEl) {
    await fileEl.uploadFile(closeupPath)
    log('info', `클로즈업 업로드: ${path.basename(closeupPath)}`)
    await sleep(1500)
    const addClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button')) {
        if (el.textContent.includes('프롬프트에 추가') && !el.disabled) { el.click(); return true }
      }
      return false
    })
    if (addClicked) { log('info', '클로즈업 이미지 프롬프트에 추가 완료'); await sleep(800); return true }
  }

  // 폴백: 프로젝트 이미지 목록에서 가장 오래된(첫 번째 생성된) 이미지 선택
  const imgInfo = await page.evaluate(() => {
    const items = [...document.querySelectorAll('*')].filter(el => {
      const txt = el.textContent.trim()
      const r = el.getBoundingClientRect()
      return txt.endsWith('이미지') && txt.length > 5
        && el.offsetWidth > 50 && el.offsetWidth < 400
        && r.top > 200 && r.left > 350
    }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    if (!items.length) return null
    // 가장 오래된(첫 생성) 이미지 = 리스트 맨 아래 (최신순 정렬 기준)
    const target = items[items.length - 1]
    const r = target.getBoundingClientRect()
    return { txt: target.textContent.trim().slice(0, 40), x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }
  })

  if (!imgInfo) {
    log('warn', 'closeup: 이미지 첨부 실패 (목록 없음), 건너뜀')
    await page.keyboard.press('Escape')
    return false
  }

  log('info', `클로즈업 이미지 선택 (폴백): "${imgInfo.txt}"`)
  await page.mouse.click(imgInfo.x, imgInfo.y)
  await sleep(800)

  const addClicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button')) {
      if (el.textContent.includes('프롬프트에 추가') && !el.disabled) { el.click(); return true }
    }
    return false
  })
  if (addClicked) log('info', '클로즈업 이미지 프롬프트에 추가 완료 (폴백)')
  else log('warn', '"프롬프트에 추가" 못 찾음')
  await sleep(800)
  return !!addClicked
}

// 접근성 트리 기반 입력창 위치 반환
async function findPromptInputPos(page) {
  // 접근성 트리로 "무엇을 만들고" 또는 "What" 텍스트박스 탐색
  const found = await page.evaluate(() => {
    function searchA11y(root) {
      for (const el of root.querySelectorAll('[role="textbox"], [role="combobox"], textarea, input[type="text"]')) {
        if (el.classList.contains('g-recaptcha-response')) continue
        const r = el.getBoundingClientRect()
        if (r.width > 100 && r.top > window.innerHeight * 0.5) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const res = searchA11y(el.shadowRoot)
          if (res) return res
        }
      }
      return null
    }
    return searchA11y(document)
  })
  if (found) return found

  // 폴백: 뷰포트 기반 추정 (debug_timeout.png 기준 ~90% 높이)
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  return { x: vp.w * 0.48, y: vp.h * 0.895 }
}

// Shadow DOM을 재귀 탐색해 요소의 뷰포트 좌표를 반환
async function findElementRect(page, matcher) {
  return page.evaluate((matcherSrc) => {
    const match = new Function('el', `return ${matcherSrc}`)
    function search(root) {
      for (const el of root.querySelectorAll('*')) {
        if (match(el)) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
        }
        if (el.shadowRoot) {
          const found = search(el.shadowRoot)
          if (found) return found
        }
      }
      return null
    }
    return search(document)
  }, matcher.toString())
}

async function findPromptInput(page) {
  // Shadow DOM 포함 전체 탐색 — "무엇을 만들고 싶으신가요?" placeholder 우선
  const rect = await findElementRect(page,
    `el => {
       const tag = el.tagName
       if (tag !== 'TEXTAREA' && tag !== 'INPUT' && el.contentEditable !== 'true') return false
       if (el.classList.contains('g-recaptcha-response')) return false
       if (el.offsetWidth < 50) return false
       const ph = (el.placeholder || el.getAttribute('data-placeholder') || el.textContent || '').trim()
       return ph.includes('무엇을') || ph.includes('만들고') ||
              ph.includes('프롬프트') || ph.toLowerCase().includes('prompt') ||
              ph.includes('what') || ph.includes('describe')
     }`
  )
  if (rect) return { _isRect: true, rect }

  // 화면 하단 60% 아래에 있는 가장 넓은 입력 요소
  const bottomRect = await page.evaluate(() => {
    function search(root, results = []) {
      for (const el of root.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')) {
        if (el.classList.contains('g-recaptcha-response')) continue
        const r = el.getBoundingClientRect()
        if (r.width > 100 && r.top > window.innerHeight * 0.6) {
          results.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height })
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) search(el.shadowRoot, results)
      }
      return results
    }
    const all = search(document)
    // 가장 넓은 것 선택
    return all.sort((a, b) => b.w - a.w)[0] ?? null
  })
  if (bottomRect) return { _isRect: true, rect: bottomRect }

  // 최후 수단: 뷰포트 하단 87% 중앙
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const fallback = { x: vp.w * 0.47, y: vp.h * 0.875, w: 600, h: 48 }
  log('warn', `입력창 좌표 추론: (${Math.round(fallback.x)}, ${Math.round(fallback.y)})`)
  return { _isRect: true, rect: fallback }
}

async function setAspectRatio(page, type = 'shorts') {
  const is169 = type === 'longform'
  const ratio = is169 ? '16:9' : '9:16'
  const clicked = await page.evaluate((r, is169) => {
    const portrait = ['[aria-label*="9:16"]', '[aria-label*="Portrait"]', '[data-ratio="9:16"]', '[data-aspect="portrait"]']
    const landscape = ['[aria-label*="16:9"]', '[aria-label*="Landscape"]', '[data-ratio="16:9"]', '[data-aspect="landscape"]']
    const selectors = is169 ? landscape : portrait
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el) { el.click(); return r }
    }
    // 텍스트 매칭 폴백
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes(r))
    if (btn) { btn.click(); return r }
    return null
  }, ratio, is169)
  if (clicked) { log('info', `화면 비율 설정: ${clicked}`); await sleep(400) }
  else log('warn', `화면 비율 버튼 못 찾음 (${ratio}), 기본값 사용`)
}

async function clickGenerate(page) {
  // Shadow DOM 포함: 하단 전송 버튼 탐색
  const rect = await page.evaluate(() => {
    function search(root) {
      for (const el of root.querySelectorAll('button')) {
        if (el.disabled) continue
        const r = el.getBoundingClientRect()
        if (r.top < window.innerHeight * 0.6 || r.width < 1) continue
        const txt = el.textContent.trim()
        const label = (el.getAttribute('aria-label') || '').toLowerCase()
        if (txt === '→' || txt === '▶' ||
            label.includes('send') || label.includes('전송') || label.includes('보내기') ||
            label.includes('submit') || label.includes('generate')) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const res = search(el.shadowRoot)
          if (res) return res
        }
      }
      return null
    }
    return search(document)
  })

  if (rect) {
    await page.mouse.click(rect.x, rect.y)
    log('info', `전송 버튼 클릭 (${Math.round(rect.x)}, ${Math.round(rect.y)})`)
    return
  }

  // Enter 키 폴백
  log('info', 'Enter 키로 전송')
  await page.keyboard.press('Enter')
}

// 페이지의 모든 큰 이미지 src + 크기 수집
async function collectImageSrcs(page) {
  return page.evaluate(() => {
    function collect(root, list = []) {
      for (const img of root.querySelectorAll('img')) {
        if (img.naturalWidth > 80 && img.complete && img.src) {
          list.push({ src: img.src, w: img.naturalWidth, h: img.naturalHeight })
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) collect(el.shadowRoot, list)
      }
      return list
    }
    return collect(document)
  })
}

// 새 이미지가 나타날 때까지 대기
async function waitForNewImage(page, beforeItems) {
  const beforeSrcs = beforeItems.map(i => i.src)
  try {
    await page.waitForFunction(
      (before) => {
        function collect(root, list = []) {
          for (const img of root.querySelectorAll('img')) {
            if (img.naturalWidth > 80 && img.complete && img.src) list.push(img.src)
          }
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) collect(el.shadowRoot, list)
          }
          return list
        }
        return collect(document).some(src => !before.includes(src))
      },
      { timeout: CONFIG.timeoutMs },
      beforeSrcs
    )
  } catch (err) {
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_timeout.png'), fullPage: true })
    log('info', '타임아웃 스크린샷: downloads/flow/debug_timeout.png')
    throw err
  }
  await sleep(800)
}

async function waitForResult(page) {
  const beforeCount = await page.evaluate(() => {
    function countBigImgs(root) {
      let n = 0
      for (const img of root.querySelectorAll('img')) {
        if (img.naturalWidth > 80 && img.complete) n++
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) n += countBigImgs(el.shadowRoot)
      }
      return n
    }
    return countBigImgs(document)
  })

  try {
    await page.waitForFunction(
      (before) => {
        function countBigImgs(root) {
          let n = 0
          for (const img of root.querySelectorAll('img')) {
            if (img.naturalWidth > 80 && img.complete) n++
          }
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) n += countBigImgs(el.shadowRoot)
          }
          return n
        }
        return countBigImgs(document) > before
      },
      { timeout: CONFIG.timeoutMs },
      beforeCount
    )
  } catch (err) {
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_timeout.png'), fullPage: true })
    log('info', '타임아웃 스크린샷: downloads/flow/debug_timeout.png')
    throw err
  }

  await sleep(800)
}

// beforeItems에 없는 새 이미지 저장 (3분할 감지 시 중앙 패널 크롭)
async function saveNewImage(page, beforeItems, cutNo, episode, prefix = 'cut') {
  const beforeSet = new Set(beforeItems.map(i => i.src))
  const allItems = await collectImageSrcs(page)
  const newItems = allItems.filter(i => !beforeSet.has(i.src))

  if (!newItems.length) {
    log('warn', '새 이미지 src를 찾지 못해 마지막 이미지로 폴백')
    return saveImage(page, cutNo, episode)
  }

  const target = newItems[newItems.length - 1]
  const imgSrc = target.src
  log('info', `새 이미지 src (${target.w}×${target.h}): ${imgSrc.slice(0, 80)}…`)

  const epDir = path.join(CONFIG.downloadDir, `ep${episode}`)
  ensureDir(epDir)
  const outPath = path.join(epDir, `${prefix}_${String(cutNo).padStart(2, '0')}.jpg`)

  if (imgSrc.startsWith('data:')) {
    fs.writeFileSync(outPath, Buffer.from(imgSrc.split(',')[1], 'base64'))
  } else {
    const data = await page.evaluate(async (src) => {
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        return Array.from(new Uint8Array(buf))
      } catch { return null }
    }, imgSrc)
    if (data) {
      fs.writeFileSync(outPath, Buffer.from(data))
    } else {
      const downloaded = await tryDownloadButton(page, outPath)
      if (!downloaded) throw new Error('새 이미지 저장 실패')
    }
  }

  // 3분할 감지 (가로/세로 비율 > 1.3): 중앙 패널만 크롭
  if (target.w > target.h * 1.3) {
    log('info', `3분할 이미지 감지 → 중앙 패널 크롭 (${target.w}×${target.h})`)
    const croppedBase64 = await page.evaluate(async (filePath, panels) => {
      return new Promise(resolve => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const panelW = Math.floor(img.width / panels)
          const startX = Math.floor((img.width - panelW) / 2) // 중앙 패널
          const canvas = document.createElement('canvas')
          canvas.width = panelW
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, startX, 0, panelW, img.height, 0, 0, panelW, img.height)
          resolve(canvas.toDataURL('image/jpeg', 0.95).split(',')[1])
        }
        img.onerror = () => resolve(null)
        img.src = 'file://' + filePath.replace(/\\/g, '/')
      })
    }, outPath, 3)

    if (croppedBase64) {
      fs.writeFileSync(outPath, Buffer.from(croppedBase64, 'base64'))
      log('info', '중앙 패널 크롭 저장 완료')
    }
  }

  return outPath
}

async function saveImage(page, cutNo, episode) {
  const epDir = path.join(CONFIG.downloadDir, `ep${episode}`)
  ensureDir(epDir)
  const filename = `cut_${String(cutNo).padStart(2, '0')}.jpg`
  const outPath = path.join(epDir, filename)

  // Shadow DOM 포함 전체 이미지 src 수집 (큰 이미지만)
  const srcs = await page.evaluate(() => {
    function collectImgs(root, list = []) {
      for (const img of root.querySelectorAll('img')) {
        if (img.naturalWidth > 80 && img.complete && img.src) list.push(img.src)
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) collectImgs(el.shadowRoot, list)
      }
      return list
    }
    return collectImgs(document)
  })

  if (!srcs.length) throw new Error('결과 이미지 src를 찾지 못했습니다')

  // 마지막으로 생성된 이미지 (목록 끝)
  const imgSrc = srcs[srcs.length - 1]
  log('info', `이미지 src: ${imgSrc.slice(0, 80)}…`)

  if (imgSrc.startsWith('data:')) {
    const base64 = imgSrc.split(',')[1]
    fs.writeFileSync(outPath, Buffer.from(base64, 'base64'))
  } else if (imgSrc.startsWith('blob:')) {
    const data = await page.evaluate(async (src) => {
      const res = await fetch(src)
      const buf = await res.arrayBuffer()
      return Array.from(new Uint8Array(buf))
    }, imgSrc)
    fs.writeFileSync(outPath, Buffer.from(data))
  } else {
    // 외부 URL (Google CDN 등): page 컨텍스트에서 fetch
    const data = await page.evaluate(async (src) => {
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        return Array.from(new Uint8Array(buf))
      } catch { return null }
    }, imgSrc)
    if (data) {
      fs.writeFileSync(outPath, Buffer.from(data))
    } else {
      // 최후 수단: 다운로드 버튼 시도
      const downloaded = await tryDownloadButton(page, outPath)
      if (!downloaded) throw new Error('이미지 저장 방법을 찾지 못했습니다')
      return outPath
    }
  }

  return outPath
}

async function tryDownloadButton(page, targetPath) {
  const dlSelectors = [
    'button[aria-label*="Download" i]',
    'button[aria-label*="다운로드" i]',
    'a[download]',
    '[data-testid="download"]',
  ]
  for (const sel of dlSelectors) {
    const el = await page.$(sel)
    if (el) {
      // 다운로드된 파일을 targetPath로 이동
      const before = fs.readdirSync(CONFIG.downloadDir)
      await el.click()
      await sleep(3000)
      const after = fs.readdirSync(CONFIG.downloadDir)
      const newFiles = after.filter(f => !before.includes(f) && /\.(jpg|jpeg|png|webp)$/i.test(f))
      if (newFiles.length) {
        fs.renameSync(path.join(CONFIG.downloadDir, newFiles[0]), targetPath)
        return true
      }
    }
  }
  return false
}

async function clickIfExists(page, selectors) {
  for (const sel of selectors) {
    // :has-text() 는 브라우저 querySelector 미지원 → 직접 필터
    if (sel.includes(':has-text(')) {
      const text = sel.match(/:has-text\("(.+?)"\)/)?.[1]
      const tag  = sel.split(':')[0] || 'button'
      if (text) {
        const found = await page.evaluateHandle((tag, text) => {
          const els = [...document.querySelectorAll(tag)]
          return els.find(el => el.textContent.trim().includes(text)) ?? null
        }, tag, text)
        const el = found.asElement()
        if (el) { try { await el.click(); await sleep(300) } catch {}; return }
      }
      continue
    }
    const el = await page.$(sel)
    if (el) {
      try { await el.click(); await sleep(300) } catch {}
      return
    }
  }
}

// ── 로그 및 리포트 ────────────────────────────────────────────────────

function printHeader(episode, type, cuts) {
  const ratio = type === 'longform' ? '16:9 (longform)' : '9:16 (shorts)'
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  🎬 여리 스튜디오 - Google Flow 자동화')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  if (episode) console.log(`  에피소드: ${episode}`)
  console.log(`  화면 비율: ${ratio}`)
  console.log(`  처리 컷 수: ${cuts.length}개`)
  console.log(`  저장 위치: downloads/flow/`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

function printSummary(ok, fail, results) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  완료: ✅ ${ok}개 성공 / ❌ ${fail}개 실패`)
  if (fail > 0) {
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`    CUT ${r.cutNo}: ${r.reason}`)
    })
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

function saveReport(episode, results) {
  const reportPath = path.join(CONFIG.downloadDir, `report_ep${episode ?? 'x'}_${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    episode,
    results,
  }, null, 2))
  log('info', `리포트 저장: ${path.relative(ROOT, reportPath)}`)
}

async function waitForEnter() {
  return new Promise(resolve => {
    process.stdin.once('data', resolve)
    console.log('   Enter를 눌러 계속하세요...')
  })
}
