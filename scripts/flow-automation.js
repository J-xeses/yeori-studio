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
import readline from 'readline'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── ROOT 자동 감지 ──────────────────────────────────────────────────────
const CANDIDATES = [
  { label: '회사 PC', p: 'C:\\Users\\won56\\OneDrive - CTEC\\문서\\GitHub\\yeori-studio\\yeori-studio' },
  { label: '집 PC',   p: 'C:\\Users\\user\\Desktop\\yeori-studio\\yeori-studio' },
]
const CODE_ROOT = (() => {
  for (const { label, p } of CANDIDATES) {
    if (
      fs.existsSync(p) &&
      fs.existsSync(path.join(p, 'node_modules')) &&
      fs.existsSync(path.join(p, 'package.json'))
    ) {
      console.log(`[CODE_ROOT] ${label}: ${p}`)
      return p
    }
  }
  console.error('[ERROR] CODE_ROOT 경로를 찾을 수 없습니다.')
  process.exit(1)
})()
const MEDIA_ROOT = 'C:\\yeori-studio'
const ROOT = CODE_ROOT  // 하위 호환 유지

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
  // remote debugging 방식: Chrome을 --remote-debugging-port=9222 로 미리 실행
  // chrome.exe --remote-debugging-port=9222
  debuggingPort:   9222,
  chromeExe:       'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  downloadDir:     path.join(MEDIA_ROOT, 'downloads', 'flow'),
  flowUrl:         'https://labs.google/flow',
  delayMs:         4000,   // 생성 요청 사이 대기 (레이트 리밋 방지)
  timeoutMs:       120000, // 이미지 생성 최대 대기 시간
  retryCount:      2,      // 실패 시 재시도 횟수

  // ── 레퍼런스 이미지 분석 ────────────────────────────────────────────
  referenceImage:  path.join(CODE_ROOT, 'assets', 'yeori-reference.jpg'),
  faceCacheFile:   path.join(MEDIA_ROOT, 'downloads', 'flow', 'yeori-face-cache.json'),

  // ── 클로즈업 얼굴 프롬프트 (에피소드당 1회) ────────────────────────
  closeupFacePrompt: 'Close-up face shot. Young Korean woman early-20s appearing no older than 22-23, long wavy dark brown hair NOT short NOT permed NOT curly, natural wave only flowing naturally, natural skin texture, delicate gold necklace, soft natural smile, calm expression NOT surprised NOT wide eyes, warm skin tone, high facial symmetry, sharp jawline, effortlessly photogenic not posing. Photorealistic 8K cinematic.',

  // ── 전신샷 자동 추가 프리픽스/서픽스 ──────────────────────────────
  bodyPrefix:   'Same face as closeup reference. Maintain exact same facial features. Face clearly visible. tall K-model proportions, very small face, long slim legs, slender figure, tall fashion model body, small head-to-body ratio, NOT petite, NOT short stature, NOT average body, DO NOT change body proportions.',
  bgSuffix:     'background people blurred and far away, must not interact with or touch main character, main character is clearly separated from background.',
  subtitleSuppression: 'NO subtitles. NO captions. NO text overlay. NO dialogue text visible in frame. NO watermark. NO on-screen text of any kind.',

  // ── 서여리 캐릭터 설정 ──────────────────────────────────────────────
  characterName:   '서여리',
  characterDir:    path.join(MEDIA_ROOT, 'downloads', 'flow', 'character'),
  characterImage:  path.join(MEDIA_ROOT, 'downloads', 'flow', 'character', 'yeori-face.jpg'),
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

// 프로젝트 URL 전역 추적 (캐릭터 등록 후 복귀에 사용)
let _projectUrl = null

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

function promptInput(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer) })
  })
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
  let file
  let usingEpFile = false

  if (args.prompts) {
    file = path.resolve(args.prompts)
  } else if (args.ep) {
    const epFile = path.join(CONFIG.downloadDir, `ep${args.ep}`, 'prompts.json')
    if (fs.existsSync(epFile)) {
      file = epFile
      usingEpFile = true
      log('info', `ep 전용 파일 사용: ${epFile}`)
    } else {
      file = path.join(CONFIG.downloadDir, 'prompts.json')
      log('info', `ep${args.ep} 전용 파일 없음 → 글로벌 fallback: ${file}`)
    }
  } else {
    file = path.join(CONFIG.downloadDir, 'prompts.json')
  }

  if (!fs.existsSync(file)) {
    log('warn', `프롬프트 파일 없음: ${file}`)
    log('info', '여리 스튜디오 → 스튜디오 탭 → "프롬프트 JSON 내보내기" 버튼을 먼저 실행하세요.')
    log('info', `또는 아래 형식으로 직접 생성하세요:\n${JSON.stringify(PROMPTS_EXAMPLE, null, 2)}`)
    process.exit(0)
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))

  // 배열 직접 or { episode, cuts: [...] } 형식 모두 처리
  const rawEpisode = raw.episode ?? null
  // --ep 지정 시 해당 값을 episode로 우선 사용 (글로벌 파일 episode 값 무시)
  const episode = args.ep ?? rawEpisode
  const type    = raw.type ?? 'shorts'   // "shorts" → 9:16 / "longform" → 16:9

  log('info', `파일 episode: ${rawEpisode} | 실행 episode: ${episode} | --ep: ${args.ep ?? '없음'}`)

  const allCuts = (Array.isArray(raw) ? raw : raw.cuts ?? [])
  const withPrompt = allCuts.filter(c => c.imagePrompt?.trim())
  const epFiltered = withPrompt.filter(c => {
    if (!args.ep) return true           // --ep 없으면 전체 포함
    if (usingEpFile) return true        // ep 전용 파일이면 이미 해당 ep 데이터
    if (c.episode != null) return String(c.episode) === String(args.ep)  // 컷별 episode 있으면 그걸로 필터
    return true                          // 컷별 episode 없고 글로벌 fallback이면 포함
  })
  const cuts = epFiltered.filter(c => !args.cut || String(c.no) === String(args.cut))

  log('info', `컷 필터링: 전체 ${allCuts.length} → 프롬프트 있음 ${withPrompt.length} → ep필터 ${epFiltered.length} → 최종 ${cuts.length}`)

  return { episode, type, cuts }
}

// ── 메인 ─────────────────────────────────────────────────────────────

async function main() {
  ensureDir(CONFIG.downloadDir)
  ensureDir(CONFIG.characterDir)

  // ── 캐릭터 등록 모드 ───────────────────────────────────────────────
  if (args['register-character'] || args['gen-face']) {
    const browser = await connectBrowser()
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
      // 브라우저 유지
    }
    return
  }

  // ── 일반 이미지 생성 모드 ─────────────────────────────────────────
  const { episode, type, cuts } = loadPrompts()
  if (!cuts.length) {
    log('warn', '처리할 프롬프트가 없습니다. 조건을 확인하세요.')
    return
  }

  // prompts.json에서 제목 읽기 → 프로젝트 이름: "EP4_한강라이딩"
  const _epPromptFile = args.ep && fs.existsSync(path.join(CONFIG.downloadDir, `ep${args.ep}`, 'prompts.json'))
    ? path.join(CONFIG.downloadDir, `ep${args.ep}`, 'prompts.json')
    : path.join(CONFIG.downloadDir, 'prompts.json')
  const rawPrompts = JSON.parse(fs.readFileSync(_epPromptFile, 'utf-8'))
  const epTitle    = (rawPrompts.title || '').replace(/\s+/g, '')
  const projectTitle = epTitle ? `EP${episode}_${epTitle}` : `EP${episode}`

  const epDir       = path.join(CONFIG.downloadDir, `ep${episode}`)
  const projectMarker = path.join(epDir, 'project_url.txt')
  ensureDir(epDir)

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
    browser = await connectBrowser()
  } catch (err) {
    process.exit(1)
  }

  let page = await setupPage(browser)
  let ok = 0, fail = 0
  const results = []

  try {
    // ── ① Google Flow 로그인 + 대시보드 ─────────────────────────────
    await navigateToFlow(page)

    // ── ② 에피소드 전용 프로젝트 확보 ───────────────────────────────
    //    project_url.txt 있으면 재사용 / 없으면 "EP{N}_{제목}" 신규 생성
    if (!fs.existsSync(projectMarker)) {
      const projectId = await promptInput(
        `\nFlow 프로젝트 ID를 입력하세요 (URL의 마지막 부분):\n예) 77a33d02-f7d7-40d7-9a1f-b9983d92fc79\n> `
      )
      const trimmedId = projectId.trim()
      if (!trimmedId) throw new Error('프로젝트 ID를 입력하지 않았습니다.')
      const projectUrl = `https://labs.google/fx/ko/tools/flow/project/${trimmedId}`
      ensureDir(path.dirname(projectMarker))
      fs.writeFileSync(projectMarker, projectUrl, 'utf-8')
      log('ok', `project_url.txt 저장: ${projectUrl}`)
    }
    const savedUrl = fs.readFileSync(projectMarker, 'utf-8').trim().split('#')[0].trim()
    _projectUrl = savedUrl
    log('ok', `② 프로젝트 URL: ${savedUrl}`)
    const projectId = savedUrl.split('/').pop()
    if (!page.url().includes(projectId)) {
      await page.goto(savedUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      await sleep(2500)
      await waitForImagesStable(page)
    } else {
      log('info', '이미 프로젝트 페이지에 있음 — goto 스킵')
      await sleep(1000)
    }
    await preFlightCheck(page)

    // 이미지 모드 설정 — 루프 시작 전 한 번만 (매 컷마다 팝업 재오픈 시 탭 클릭 무시되는 문제 방지)
    await switchToImageMode(page)
    log('info', `모드 설정 완료: 이미지 / ${type === 'longform' ? '16:9' : '9:16'} / x2`)

    // ── ③ 컷별 이미지 생성 ──────────────────────────────────────────
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i]
      const _ep = cut.episode ?? episode ?? 'x'
      const _padded = String(cut.no).padStart(2, '0')
      const existingA = path.join(CONFIG.downloadDir, `ep${_ep}`, `cut_${_padded}_a.jpg`)
      const existingLegacy = path.join(CONFIG.downloadDir, `ep${_ep}`, `cut_${_padded}.jpg`)
      if (fs.existsSync(existingA) || fs.existsSync(existingLegacy)) {
        const existingPath = fs.existsSync(existingA) ? existingA : existingLegacy
        log('ok', `[${i + 1}/${cuts.length}] CUT ${cut.no} 이미 존재 → 스킵`)
        results.push({ cutNo: cut.no, status: 'ok', file: existingPath })
        ok++
        continue
      }

      const label = `[${i + 1}/${cuts.length}] CUT ${cut.no}`
      log('step', `⑤ ${label} 생성 중…`)

      for (let attempt = 0; attempt <= CONFIG.retryCount; attempt++) {
        try {
          const savedPaths = await processCut(page, cut, episode, type)
          const savedArr = Array.isArray(savedPaths) ? savedPaths : [savedPaths]
          log('ok', `${label} → ${savedArr.map(p => path.relative(ROOT, p)).join(', ')}`)
          results.push({ cutNo: cut.no, status: 'ok', file: savedArr[0] })
          ok++; break
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
    // 브라우저 유지
  }

  printSummary(ok, fail, results)
  saveReport(episode, results)
}

// ── 브라우저 설정 ─────────────────────────────────────────────────────

async function connectBrowser() {
  const wsUrl = `http://127.0.0.1:${CONFIG.debuggingPort}/json/version`
  let version
  try {
    const res = await fetch(wsUrl)
    version = await res.json()
  } catch {
    console.error('\n' + '═'.repeat(56))
    console.error('  Chrome에 연결할 수 없습니다.')
    console.error('  Chrome을 먼저 아래 명령으로 실행해주세요:')
    console.error(`\n  "${CONFIG.chromeExe}" --remote-debugging-port=${CONFIG.debuggingPort}`)
    console.error('\n  (실행 중인 Chrome이 있으면 완전히 종료 후 위 명령 사용)')
    console.error('═'.repeat(56) + '\n')
    throw new Error(`Chrome remote debugging 포트(${CONFIG.debuggingPort})에 연결 실패`)
  }
  log('info', `Chrome 연결 완료 (${version.Browser})`)
  return puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport:   null,
  })
}

async function setupPage(browser) {
  // 기존 Flow 탭 재사용 → 사용자가 보는 화면에서 직접 실행
  const pages = await browser.pages()
  const existing = pages.find(p => {
    const url = p.url()
    return url.includes('labs.google/fx') || url.includes('labs.google/flow')
  })

  let page
  if (existing) {
    log('info', `기존 Flow 탭 재사용: ${existing.url().slice(0, 70)}`)
    page = existing
  } else {
    log('info', '기존 Flow 탭 없음 → 새 탭 생성')
    page = await browser.newPage()
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
  }

  // CDP 다운로드 경로 설정
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', {
    behavior:     'allow',
    downloadPath: CONFIG.downloadDir,
  })
  page._cdpClient = client

  return page
}

// 로그인 + 쿠키 처리 + 대시보드 이동 (프로젝트 이동은 별도)
async function navigateToFlow(page) {
  const currentUrl = page.url()
  // 이미 Flow에 있으면 불필요한 리다이렉트 건너뜀
  if (currentUrl.includes('labs.google/fx') &&
      !currentUrl.includes('pricing') && !currentUrl.includes('signin') &&
      !currentUrl.includes('accounts.google.com')) {
    log('ok', 'Flow 대시보드 준비 완료 (기존 탭)')
    return
  }
  log('info', `Flow 접속 중: ${CONFIG.flowUrl}`)
  await page.goto(CONFIG.flowUrl, { waitUntil: 'networkidle2', timeout: 30000 })

  // 로그인 필요 판단: Google 로그인 페이지 또는 pricing 리다이렉트
  const needsLogin = () => {
    const u = page.url()
    return u.includes('accounts.google.com') || u.includes('signin') ||
           u.includes('#pricing') || u.includes('/pricing')
  }

  if (needsLogin()) {
    log('warn', '전용 프로필에 Google 로그인이 필요합니다.')
    console.log('\n브라우저에서 Google 계정으로 로그인 후 Enter를 눌러주세요.')
    await promptInput('')
    // 로그인 후 Flow 대시보드 재접속
    await page.goto(CONFIG.flowUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    if (needsLogin()) throw new Error('로그인 후에도 pricing 페이지로 리다이렉트됩니다. 로그인 상태를 확인하세요.')
  }

  const hadCookie = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const agree = btns.find(b => /^(agree|동의)$/i.test(b.textContent.trim()))
    if (agree) { agree.click(); return true }
    return false
  })
  if (hadCookie) await sleep(500)

  const dashboardUrl = 'https://labs.google/fx/ko/tools/flow'
  if (!page.url().startsWith(dashboardUrl) || page.url().includes('/about')) {
    await page.goto(dashboardUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2000)
  }

  log('ok', `Flow 대시보드 준비 완료`)
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

// ── 캐릭터 등록 래퍼 (imagePath 지정, 성공 여부 반환) ────────────────

async function registerCharacterWithImage(page, imagePath) {
  // ── 전제조건 확인 ────────────────────────────────────────────────────
  if (!fs.existsSync(imagePath)) {
    log('error', `[REG-1] 캐릭터 이미지 파일 없음: ${imagePath}`)
    return false
  }
  log('info', `[REG-1] 캐릭터 이미지 확인: ${path.relative(ROOT, imagePath)}`)

  // ── 캐릭터 페이지 이동 ───────────────────────────────────────────────
  const charUrl = 'https://labs.google/fx/ko/tools/flow/characters'
  log('info', `[REG-2] 캐릭터 페이지 이동: ${charUrl}`)
  try {
    await page.goto(charUrl, { waitUntil: 'networkidle2', timeout: 30000 })
  } catch {
    log('warn', '[REG-2] networkidle2 타임아웃 → domcontentloaded로 재시도')
    await page.goto(charUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
  }
  await sleep(2500)

  const actualUrl = page.url()
  log('info', `[REG-2] 현재 URL: ${actualUrl}`)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_reg_01_charpage.png'), fullPage: true })

  // ── 페이지에 있는 버튼 목록 출력 (디버깅) ───────────────────────────
  const allBtns = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[role="button"]')]
      .filter(el => el.getBoundingClientRect().width > 0)
      .map(el => el.textContent.trim().slice(0, 40))
      .filter(Boolean)
  )
  log('info', `[REG-2] 페이지 버튼 목록: ${JSON.stringify(allBtns)}`)

  // ── 이미 등록 여부 확인 ──────────────────────────────────────────────
  const CHAR_NAMES = ['서여리', 'Seo Yeori', 'SeoYeori', 'yeori']
  const alreadyExists = await page.evaluate((names) =>
    names.some(n =>
      [...document.querySelectorAll('*')].some(el =>
        el.offsetWidth > 0
        && el.textContent.trim().toLowerCase().includes(n.toLowerCase())
      )
    )
  , CHAR_NAMES)

  if (alreadyExists) {
    log('ok', '[REG-2] 서여리 캐릭터 이미 등록됨 → 스킵')
    return true
  }
  log('info', '[REG-2] 등록된 캐릭터 없음 → 신규 등록 시작')

  // ── "캐릭터 만들기" 버튼 클릭 ────────────────────────────────────────
  const createResult = await page.evaluate(() => {
    const patterns = /(캐릭터 만들기|create.{0,15}character|새 캐릭터|character 추가|add character)/i
    for (const el of document.querySelectorAll('button, a')) {
      const txt = el.textContent.trim()
      if (patterns.test(txt) && el.getBoundingClientRect().width > 0) {
        el.click()
        return txt
      }
    }
    return null
  })

  if (!createResult) {
    log('warn', '[REG-3] "캐릭터 만들기" 버튼 못 찾음 → debug_reg_01_charpage.png 확인')
    return false
  }
  log('info', `[REG-3] "캐릭터 만들기" 클릭: "${createResult}"`)
  await sleep(2500)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_reg_02_create.png'), fullPage: true })

  // ── 파일 업로드 ──────────────────────────────────────────────────────
  log('info', `[REG-4] 이미지 업로드 시도: ${path.basename(imagePath)}`)
  const uploaded = await uploadCharacterImage(page, imagePath)
  if (!uploaded) {
    log('warn', '[REG-4] 파일 업로드 실패 → debug_reg_02_create.png 확인')
    return false
  }
  log('ok', `[REG-4] 업로드 완료: ${path.basename(imagePath)}`)
  await sleep(2500)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_reg_03_uploaded.png'), fullPage: true })

  // ── 이름 입력 ────────────────────────────────────────────────────────
  log('info', `[REG-5] 캐릭터 이름 입력: "${CONFIG.characterName}"`)
  await typeCharacterName(page, CONFIG.characterName)
  await sleep(800)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_reg_04_named.png'), fullPage: true })

  // ── 저장 버튼 클릭 ───────────────────────────────────────────────────
  const saveBtns = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter(el => el.getBoundingClientRect().width > 0 && !el.disabled)
      .map(el => el.textContent.trim().slice(0, 30))
  )
  log('info', `[REG-6] 사용 가능한 버튼: ${JSON.stringify(saveBtns)}`)

  const saved = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button')) {
      const txt = el.textContent.trim()
      if (/(저장|완료|확인|save|done|confirm|create|등록)/i.test(txt) && !el.disabled
          && el.getBoundingClientRect().width > 0) {
        el.click()
        return txt
      }
    }
    return null
  })

  await sleep(2500)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_reg_05_saved.png'), fullPage: true })

  if (!saved) {
    log('warn', '[REG-6] 저장 버튼 못 찾음 → debug_reg_04_named.png 확인')
    return false
  }
  log('ok', `[REG-6] 저장 버튼 클릭: "${saved}"`)

  // ── 등록 완료 검증 ───────────────────────────────────────────────────
  let verified = false
  for (let i = 0; i < 6; i++) {
    await sleep(1000)
    verified = await page.evaluate((names) =>
      names.some(n =>
        [...document.querySelectorAll('*')].some(el =>
          el.offsetWidth > 0
          && el.textContent.trim().toLowerCase().includes(n.toLowerCase())
        )
      )
    , CHAR_NAMES)
    if (verified) break
    log('info', `[REG-7] 목록 확인 중… (${i + 1}/6)`)
  }

  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_reg_06_verify.png'), fullPage: true })

  if (verified) {
    log('ok', '[REG-7] 캐릭터 등록 완료 + 목록에서 이름 확인')
  } else {
    log('warn', '[REG-7] 목록에서 이름 못 찾음 (등록 됐을 수 있음) → debug_reg_06_verify.png 확인')
  }

  return true
}

// ── 캐릭터 등록 후 프로젝트 페이지로 복귀 ──────────────────────────

async function navigateBackToProject(page) {
  if (_projectUrl) {
    log('info', `프로젝트 페이지로 복귀: ${_projectUrl}`)
    await page.goto(_projectUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2500)
    await waitForImagesStable(page)
  } else {
    log('warn', '프로젝트 URL 없음 — navigateToFlow 재실행')
    await navigateToFlow(page)
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

// ── 공통: 하단 레퍼런스 "+" 버튼 클릭 ──────────────────────────────
// Flow UI는 SVG 아이콘 버튼 → 텍스트 매칭 대신 위치·aria-label 기반

async function clickPlusButton(page) {
  const result = await page.evaluate(() => {
    function search(root) {
      // 1순위: aria-label에 add/media/미디어/추가 포함된 버튼
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase()
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.top < window.innerHeight * 0.55) continue
        if (/(add|media|미디어|추가|reference|레퍼런스|attach|첨부)/i.test(label)) {
          el.click(); return `aria:${label}`
        }
      }
      // 2순위: 텍스트가 "+", "만들기", "add" 인 버튼
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.top < window.innerHeight * 0.55) continue
        const txt = el.textContent.trim()
        if (txt === '+' || txt.includes('만들기') || txt.toLowerCase() === 'add') {
          el.click(); return `txt:${txt}`
        }
      }
      // 3순위: 하단 입력창 왼쪽 영역(x<200, y>55%)의 소형 버튼
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.width > 80) continue
        if (r.top < window.innerHeight * 0.55 || r.left > 300) continue
        if (r.height < 60 && r.height > 10) { el.click(); return `pos:(${Math.round(r.left)},${Math.round(r.top)})` }
      }
      // Shadow DOM 재귀
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return null
    }
    return search(document)
  })
  if (result) log('info', `+ 버튼 클릭: "${result}"`)
  else {
    // 디버깅: 하단 버튼 목록 덤프
    const btns = await page.evaluate(() => {
      const h = window.innerHeight
      return [...document.querySelectorAll('button, [role="button"]')]
        .filter(el => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.top > h * 0.5
        })
        .map(el => {
          const r = el.getBoundingClientRect()
          return `[${el.tagName}] txt="${el.textContent.trim().slice(0,20)}" aria="${el.getAttribute('aria-label')||''}" x=${Math.round(r.left)} y=${Math.round(r.top)} w=${Math.round(r.width)}`
        })
    })
    log('warn', `+ 버튼 못 찾음. 하단 버튼 목록:\n  ${btns.slice(0,10).join('\n  ')}`)
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_plus_not_found.png') })
  }
  return !!result
}

// ── Step 1용: 캐릭터 탭 → Seo Yeori 선택 → 프롬프트에 추가 ──────────

async function attachYeoriCharacterToPrompt(page) {
  if (!await clickPlusButton(page)) { log('warn', '+ 버튼 못 찾음'); return false }
  await sleep(1500)

  // 패널 오픈 직후 스크린샷 (선택자 디버깅용)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_char_panel.png') })

  // "캐릭터" 탭 클릭 — 위치 제약 없이 텍스트 매칭
  const tabClicked = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('*')].filter(el => {
      const txt = el.textContent.trim()
      const r = el.getBoundingClientRect()
      return (txt === '캐릭터' || txt === 'Character' || txt === 'Characters' ||
              txt.includes('accessibility_new캐릭터'))
        && r.width > 0 && r.height > 0 && r.width < 250
    })
    // y 오름차순 정렬 후 y > 100인 첫 번째 요소 클릭
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    for (const el of candidates) {
      if (el.getBoundingClientRect().top > 100) { el.click(); return el.textContent.trim().slice(0, 20) }
    }
    return null
  })
  if (tabClicked) log('info', `캐릭터 탭 클릭: "${tabClicked}"`)
  else log('warn', '캐릭터 탭 못 찾음 — 현재 패널에서 직접 검색')
  await sleep(1000)

  // 캐릭터 이름 검색 — 이름 조건 완화 (등록된 이름이 달라도 매칭)
  const charClicked = await page.evaluate(() => {
    const NAMES = ['서여리', 'Seo Yeori', 'SeoYeori', 'yeori', 'Yeori', 'Untitled Character']
    for (const name of NAMES) {
      const found = [...document.querySelectorAll('*')].find(el => {
        const txt = el.textContent.trim()
        const r = el.getBoundingClientRect()
        return txt.toLowerCase().includes(name.toLowerCase())
          && r.width > 0 && r.width < 400 && r.height > 0 && r.height < 120
      })
      if (found) { found.click(); return found.textContent.trim().slice(0, 40) }
    }
    return null
  })

  if (!charClicked) {
    log('warn', `Seo Yeori 캐릭터 못 찾음 → debug_char_panel.png 확인`)
    log('warn', '캐릭터가 등록되지 않은 경우 --register-character 플래그로 먼저 등록하세요')
    await page.keyboard.press('Escape').catch(() => {})
    return false
  }
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

// ── 로컬 파일을 input[type="file"]에 직접 주입해서 프롬프트 레퍼런스로 첨부 ──

async function attachFileToPrompt(page, filePath) {
  if (!fs.existsSync(filePath)) {
    log('warn', `[attachFileToPrompt] 파일 없음: ${filePath}`)
    return false
  }

  const fileName = path.basename(filePath)

  // contenteditable 근처 또는 전체 페이지(Shadow DOM 포함)에서 input[type="file"] 탐색
  const fileInputHandle = await page.evaluateHandle(() => {
    function deepFind(root) {
      // contenteditable 부모 체인에서 먼저 탐색
      for (const ce of root.querySelectorAll('div[contenteditable="true"]')) {
        const r = ce.getBoundingClientRect()
        if (r.width > 100 && r.top > window.innerHeight * 0.4) {
          let node = ce.parentElement
          for (let i = 0; i < 15 && node; i++, node = node.parentElement) {
            const inp = node.querySelector('input[type="file"]')
            if (inp) return inp
          }
        }
      }
      // 전체 Shadow DOM 포함 탐색
      function search(r2) {
        for (const el of r2.querySelectorAll('input[type="file"]')) return el
        for (const el of r2.querySelectorAll('*'))
          if (el.shadowRoot) { const f = search(el.shadowRoot); if (f) return f }
        return null
      }
      return search(root)
    }
    return deepFind(document)
  })

  const fileInput = fileInputHandle.asElement()
  if (!fileInput) {
    log('warn', `[attachFileToPrompt] input[type=file] 없음 → ${fileName} 건너뜀`)
    await fileInputHandle.dispose()
    return false
  }

  // 숨겨진 input도 파일 주입 가능하게 스타일 잠깐 해제
  await page.evaluate(el => {
    el.style.display = 'block'
    el.style.visibility = 'visible'
    el.style.opacity = '1'
    el.style.position = 'fixed'
    el.style.top = '0'
    el.style.left = '0'
    el.style.zIndex = '99999'
  }, fileInput)

  await fileInput.uploadFile(filePath)
  log('info', `[attachFileToPrompt] ${fileName} → input[type=file] 주입 성공`)
  await sleep(1200)

  // "프롬프트에 추가" 버튼 클릭
  const addClicked = await clickAddToPrompt(page)
  log(addClicked ? 'info' : 'warn',
    `[attachFileToPrompt] ${fileName} 프롬프트에 추가 ${addClicked ? '완료' : '실패'}`)
  await sleep(500)
  return addClicked
}

// (구) attachLocalFile — 하위 호환용 래퍼
async function attachLocalFile(page, filePath) {
  if (!fs.existsSync(filePath)) {
    log('warn', `[attachLocalFile] 파일 없음: ${filePath}`)
    return false
  }

  const fileName = path.basename(filePath)
  const fileBaseName = path.basename(filePath, path.extname(filePath))

  if (!await clickPlusButton(page)) { log('warn', '[attachLocalFile] + 버튼 못 찾음'); return false }
  await sleep(1200)

  // 업로드 전 패널 이미지 src 스냅샷 (새 썸네일 감지용)
  const beforeSrcs = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map(img => img.src)
  )

  // file input 탐색 (전략 1: 직접, 전략 2: 업로드 버튼 클릭 후)
  let strategy = null
  let fileEl = (await page.evaluateHandle(() => {
    function s(root) {
      for (const el of root.querySelectorAll('input[type="file"]')) return el
      for (const el of root.querySelectorAll('*'))
        if (el.shadowRoot) { const f = s(el.shadowRoot); if (f) return f }
      return null
    }
    return s(document)
  })).asElement()

  if (fileEl) {
    strategy = 1
    log('ok', '[attachLocalFile][전략1] file input 발견')
  } else {
    log('info', '[attachLocalFile][전략1] file input 없음 → [전략2] 업로드 버튼 클릭')
    const clicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        const t = el.textContent.trim()
        const label = el.getAttribute('aria-label') || ''
        if (/(새 미디어|업로드|upload|add media|new media)/i.test(t + label)
            && el.getBoundingClientRect().width > 0) {
          el.click(); return t
        }
      }
      return null
    })
    if (clicked) {
      log('info', `[attachLocalFile][전략2] "${clicked}" 클릭 → file input 대기`)
      await sleep(1000)
      fileEl = (await page.evaluateHandle(() => {
        function s(root) {
          for (const el of root.querySelectorAll('input[type="file"]')) return el
          for (const el of root.querySelectorAll('*'))
            if (el.shadowRoot) { const f = s(el.shadowRoot); if (f) return f }
          return null
        }
        return s(document)
      })).asElement()
      if (fileEl) { strategy = 2; log('ok', '[attachLocalFile][전략2] file input 발견') }
      else log('warn', '[attachLocalFile][전략2] file input 여전히 없음')
    } else {
      log('warn', '[attachLocalFile][전략2] 업로드 버튼 못 찾음')
    }
  }

  if (!fileEl) {
    log('warn', `[attachLocalFile] file input 없음 → ${fileName} 건너뜀`)
    await page.keyboard.press('Escape').catch(() => {})
    return false
  }

  await fileEl.uploadFile(filePath)
  log('info', `[attachLocalFile] 업로드 완료: ${fileName} (전략${strategy})`)
  await sleep(2000)

  // 업로드 후 새로 나타난 썸네일 img 탐색 → 부모 카드 클릭
  const thumbInfo = await page.evaluate((prevSrcs) => {
    function clickCard(img) {
      let el = img
      for (let i = 0; i < 8; i++) {
        if (!el) break
        const role = (el.getAttribute('role') || '').toLowerCase()
        const tag = el.tagName.toLowerCase()
        const r = el.getBoundingClientRect()
        if (r.width > 0 && (
          role === 'option' || role === 'button' || role === 'listitem' || role === 'gridcell' ||
          tag === 'li' || tag === 'article'
        )) { el.click(); return `<${el.tagName} role="${role}">` }
        if (r.width > 0 && tag === 'div' && el.querySelector('img') && r.width > 30 && r.height > 30 && r.height < 300) {
          el.click(); return `<DIV ${Math.round(r.width)}x${Math.round(r.height)}>`
        }
        el = el.parentElement
      }
      img.click(); return '<IMG fallback>'
    }
    const newImgs = [...document.querySelectorAll('img')].filter(img => {
      const r = img.getBoundingClientRect()
      return !prevSrcs.includes(img.src) && r.width > 20 && r.width < 400 && r.height > 20
    })
    if (!newImgs.length) return null
    return clickCard(newImgs[0])
  }, beforeSrcs)

  if (thumbInfo) log('ok', `[attachLocalFile] 새 썸네일 카드 클릭: ${thumbInfo}`)
  else log('warn', '[attachLocalFile] 새 썸네일 없음 — 선택 없이 진행')
  await sleep(800)

  // 진단: 버튼 목록 + 스크린샷
  const visibleBtns = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .filter(el => el.getBoundingClientRect().width > 0)
      .map(el => el.textContent.trim().slice(0, 30))
      .filter(Boolean)
  )
  log('info', `[attachLocalFile] 버튼 목록: ${JSON.stringify(visibleBtns)}`)
  await page.screenshot({ path: path.join(CONFIG.downloadDir, `debug_attach_${fileBaseName}.png`) })

  const added = await clickAddToPrompt(page)
  if (added) {
    log('ok', `[attachLocalFile] "${fileName}" 프롬프트 추가 완료 (전략${strategy})`)
    await sleep(800)
    return true
  }

  log('warn', `[attachLocalFile] "프롬프트에 추가" 못 찾음 → debug_attach_${fileBaseName}.png 확인`)
  return false
}

// ── 클로즈업 생성: yeori-face.jpg 레퍼런스 → 클로즈업 프롬프트 ────────

async function generateEpisodeCloseup(page, savePath) {
  const pos = await prepareInput(page)

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

// ── hover로 레퍼런스 썸네일 좌표 탐색 ──────────────────────────────────

async function findReferenceThumbs(page) {
  // 컷이 쌓이면 레퍼런스 썸네일이 오른쪽으로 밀려나므로, 상단 이미지 스트립을 오른쪽 끝으로 스크롤
  await page.evaluate(() => {
    const strip = [...document.querySelectorAll('*')].find(el => {
      const r = el.getBoundingClientRect()
      return el.scrollWidth > el.clientWidth + 50
        && r.top < window.innerHeight * 0.45
        && r.top > 0
        && r.height > 50
        && r.height < 450
    })
    if (strip) strip.scrollLeft = strip.scrollWidth
  })
  await sleep(400)

  // 화면에 보이는 img 요소 좌표 수집 (shadow DOM 포함, 40px 이상)
  const imgPositions = await page.evaluate(() => {
    function collectVisible(root, list = []) {
      for (const img of root.querySelectorAll('img')) {
        const r = img.getBoundingClientRect()
        const pos = {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          w: Math.round(r.width),
          h: Math.round(r.height)
        }
        if (pos.w >= 40 && pos.h >= 40
          && pos.y > 0 && pos.y < window.innerHeight * 0.9
          && pos.x > 0 && pos.x < window.innerWidth) {
          list.push(pos)
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) collectVisible(el.shadowRoot, list)
      }
      return list
    }
    return collectVisible(document)
  })

  log('info', `[findReferenceThumbs] 탐색 이미지 수: ${imgPositions.length}`)

  // 9:16 컷 이미지 썸네일(너비 ≈140px)을 제외하고 레퍼런스 이미지만 후보로 선택
  // yeori-face ≈222px, yeori-closeup ≈448px → 너비 160px 초과 이미지만 호버
  // (생성된 컷을 호버하면 "yeori-face" 툴팁이 나타나 오탐지 발생하는 문제 방지)
  const candidates = imgPositions.filter(pos => pos.w > 160)
  log('info', `[findReferenceThumbs] 레퍼런스 후보: ${candidates.length}개 (너비>160px)`)

  const result = { face: null, closeup: null }

  for (const pos of candidates) {
    if (result.face && result.closeup) break

    // 호버 전 기준 텍스트 스냅샷
    const baseText = await page.evaluate(() => document.body.innerText.toLowerCase())

    await page.mouse.move(pos.x, pos.y)
    await sleep(600)

    const appeared = await page.evaluate((base) => {
      const text = document.body.innerText.toLowerCase()
      // 호버 전에 없던 텍스트가 새로 나타난 경우만 감지 (기존 DOM 오탐지 방지)
      const newText = text.replace(base, '')
      const checkText = newText || text
      return {
        face: checkText.includes('yeori-face') || checkText.includes('yeori_face'),
        closeup: checkText.includes('yeori-closeup') || checkText.includes('yeori_closeup')
      }
    }, baseText)

    if (appeared.face && !result.face) {
      result.face = pos
      log('info', `[findReferenceThumbs] yeori-face 발견: (${pos.x}, ${pos.y}) ${pos.w}×${pos.h}`)
    }
    if (appeared.closeup && !result.closeup) {
      result.closeup = pos
      log('info', `[findReferenceThumbs] yeori-closeup 발견: (${pos.x}, ${pos.y}) ${pos.w}×${pos.h}`)
    }
  }

  if (!result.face) log('warn', '[findReferenceThumbs] yeori-face 썸네일 못 찾음')
  if (!result.closeup) log('warn', '[findReferenceThumbs] yeori-closeup 썸네일 못 찾음')
  return result
}

// ── 시작 전 체크리스트 ────────────────────────────────────────────────────

async function preFlightCheck(page) {
  log('step', '[체크리스트] 레퍼런스 썸네일 확인 중…')
  const thumbs = await findReferenceThumbs(page)
  if (!thumbs.face && !thumbs.closeup) {
    throw new Error('레퍼런스 이미지를 Flow 프로젝트에 먼저 업로드하세요 (yeori-face, yeori-closeup)')
  }
  if (!thumbs.face) log('warn', '[체크리스트] yeori-face 없음 — 진행 계속')
  if (!thumbs.closeup) log('warn', '[체크리스트] yeori-closeup 없음 — 진행 계속')
  log('ok', '[체크리스트] 레퍼런스 썸네일 확인 완료')
}

// ── 썸네일 좌표 → 프롬프트 입력창으로 드래그 ────────────────────────────

async function dragToPrompt(page, fromPos, toPos) {
  await page.mouse.move(fromPos.x, fromPos.y)
  await sleep(200)
  await page.mouse.down()
  await sleep(150)
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      Math.round(fromPos.x + (toPos.x - fromPos.x) * (i / steps)),
      Math.round(fromPos.y + (toPos.y - fromPos.y) * (i / steps))
    )
    await sleep(25)
  }
  await sleep(200)
  await page.mouse.up()
  await sleep(600)
}

// ── 컷 생성: hover로 레퍼런스 탐색 → 드래그앤드롭 → 프롬프트 텍스트 → 생성 ──

async function processCut(page, cut, defaultEpisode, type = 'shorts') {
  const ep = cut.episode ?? defaultEpisode ?? 'x'

  // episode_style_guide.json이 있으면 promptPrefix를 프롬프트 앞에 삽입
  const styleGuidePath = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${ep}`, 'episode_style_guide.json')
  const promptPrefix = fs.existsSync(styleGuidePath)
    ? (() => { try { return JSON.parse(fs.readFileSync(styleGuidePath, 'utf-8')).promptPrefix || '' } catch { return '' } })()
    : ''
  const baseImagePrompt = promptPrefix
    ? `${promptPrefix}. ${cut.imagePrompt.trim()}`
    : cut.imagePrompt.trim()

  const finalPrompt = [CONFIG.bodyPrefix, baseImagePrompt, CONFIG.bgSuffix, CONFIG.subtitleSuppression].join(' ')

  log('step', `컷 생성 중… (${type === 'longform' ? '16:9' : '9:16'})`)

  const pos = await prepareInput(page)
  log('info', `입력창: (${Math.round(pos.x)}, ${Math.round(pos.y)})`)

  // hover로 레퍼런스 썸네일 탐색 후 프롬프트 입력창으로 드래그
  const thumbs = await findReferenceThumbs(page)
  if (thumbs.face) {
    await dragToPrompt(page, thumbs.face, pos)
    log('info', '[processCut] yeori-face 드래그 완료')
  } else {
    log('warn', '[processCut] yeori-face 썸네일 못 찾음 → 건너뜀')
  }
  if (thumbs.closeup) {
    await dragToPrompt(page, thumbs.closeup, pos)
    log('info', '[processCut] yeori-closeup 드래그 완료')
  } else {
    log('warn', '[processCut] yeori-closeup 썸네일 못 찾음 → 건너뜀')
  }

  await page.mouse.click(pos.x, pos.y)
  await sleep(300)
  await page.keyboard.press('End')
  await sleep(100)
  await page.keyboard.type(finalPrompt, { delay: 15 })
  await sleep(500)

  const before = await collectImageSrcs(page)
  await clickGenerate(page)
  await waitForTwoNewImages(page, before)
  return saveTwoNewImages(page, before, cut.no, ep, 'cut')
}

// ── 이미지 탭 클릭 헬퍼 (플로팅 패널) ───────────────────────────────

async function clickImageTab(page) {
  return page.evaluate(() => {
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
}

// ── 이미지 모드 전환: 설정 팝업 → 이미지 탭 → 9:16 → x2 ─────────────────

async function switchToImageMode(page) {
  const alreadyOpen = await page.evaluate(() =>
    document.querySelectorAll('[role="tab"].flow_tab_slider_trigger').length > 0
  )

  if (!alreadyOpen) {
    // "Nano Banana 2" 모델명 하드코드 제거 → x1~x4 카운트 포함 하단 버튼으로 탐지
    const popupInfo = await page.evaluate(() => {
      function search(root) {
        for (const el of root.querySelectorAll('button')) {
          const txt = (el.textContent || '').trim()
          const r = el.getBoundingClientRect()
          if (r.top < window.innerHeight * 0.5 || r.width < 1 || r.height < 1) continue
          if (/x[1-4]/.test(txt) && el.children.length >= 1) {
            return { txt: txt.slice(0, 60), x: Math.round(r.left + 10), y: Math.round(r.top + 10) }
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const res = search(el.shadowRoot); if (res) return res }
        }
        return null
      }
      return search(document)
    })
    if (popupInfo) {
      log('info', `[imageMode] 팝업 트리거 클릭 — "${popupInfo.txt}"`)
      await page.mouse.click(popupInfo.x, popupInfo.y)
      await sleep(1500)
      // 팝업 열린 직후 스크린샷 — 실제 탭 구조 확인용
      await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_imagemode_popup.png') })
    } else {
      log('warn', '[imageMode] 팝업 트리거 버튼 못 찾음')
      await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_imagemode_fail.png') })
    }
  } else {
    log('info', '[imageMode] 설정 팝업 이미 열려있음')
  }
  await sleep(400)

  // 팝업 내 모든 flow_tab_slider_trigger 텍스트 덤프 (디버깅)
  const allTabTexts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"].flow_tab_slider_trigger')]
      .map(el => el.textContent.trim().slice(0, 30))
  )
  log('info', `[imageMode] 팝업 탭 목록: ${JSON.stringify(allTabTexts)}`)

  // el.click()은 React/Lit 컴포넌트에 무시됨 → 좌표 추출 후 page.mouse.click() 사용
  async function clickTab(matcher, label) {
    const coords = await page.evaluate((m) => {
      for (const el of document.querySelectorAll('[role="tab"].flow_tab_slider_trigger')) {
        const txt = (el.textContent || '').trim()
        if (eval(m)) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0)
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        }
      }
      return null
    }, matcher)
    if (coords) {
      await page.mouse.click(coords.x, coords.y)
      log('info', `[imageMode] ${label} 클릭 (${coords.x}, ${coords.y})`)
      return true
    }
    log('warn', `[imageMode] ${label} 탭 못 찾음`)
    return false
  }

  // 0. 모델 확인 → Nano Banana 2가 아니면 전환 (Pro는 일일 한도 있음)
  // 트리거 버튼(하단 바)에는 "x2" 등 카운트가 붙어 있음 → /x[1-4]/ 포함 버튼 제외
  // 팝업 내 모델 선택기는 "🍌 Nano Banana Pro ▼" 형태 (카운트 없음)
  const modelBtn = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const txt = (el.textContent || '').trim()
      const r = el.getBoundingClientRect()
      if (txt.includes('Banana') && !/x[1-4]/.test(txt) && r.width > 0 && r.height > 0)
        return { txt: txt.slice(0, 60), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), isV2: /Banana\s*2/.test(txt) }
    }
    return null
  })
  if (modelBtn && !modelBtn.isV2) {
    log('info', `[imageMode] 모델 전환: "${modelBtn.txt}" → Nano Banana 2`)
    await page.mouse.click(modelBtn.x, modelBtn.y)
    await sleep(900)
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_model_dropdown.png') })

    const nb2 = await page.evaluate(() => {
      function searchAll(root, results = []) {
        for (const el of root.querySelectorAll('button, [role="option"], [role="menuitem"], [role="listbox"] *, li, span, div')) {
          const txt = (el.textContent || '').trim()
          if (/Banana/.test(txt)) {
            const r = el.getBoundingClientRect()
            if (r.width > 0 && r.height > 0)
              results.push({ txt: txt.slice(0, 50), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) searchAll(el.shadowRoot, results)
        }
        return results
      }
      const all = searchAll(document)
      // "Banana 2" 포함 + "Pro" 미포함 → 부모 컨테이너(Pro+2 혼재) 제외하고 정확한 옵션만 선택
      const v2 = all.find(r => /Banana\s*2/.test(r.txt) && !r.txt.includes('Pro'))
      return { v2: v2 || null, all: all.map(r => r.txt) }
    })

    log('info', `[imageMode] 모델 옵션 목록: ${JSON.stringify(nb2.all)}`)
    if (nb2.v2) {
      await page.mouse.click(nb2.v2.x, nb2.v2.y)
      log('info', '[imageMode] Nano Banana 2 선택 완료 (querySelector)')
      await sleep(600)
    } else {
      // 폴백: 드롭다운 행 높이 약 36px → Pro 아래 항목 클릭
      log('info', `[imageMode] modelBtn 좌표: (${modelBtn.x}, ${modelBtn.y}) — 오프셋 탐색 중`)
      let found = false
      for (const offset of [36, 45, 55, 65]) {
        const txt = await page.evaluate((x, y) => {
          const el = document.elementFromPoint(x, y)
          return el ? (el.textContent || '').trim().slice(0, 50) : null
        }, modelBtn.x, modelBtn.y + offset)
        log('info', `[imageMode] +${offset}px 위치 텍스트: "${txt}"`)
        if (txt && /Banana\s*2/i.test(txt)) {
          await page.mouse.click(modelBtn.x, modelBtn.y + offset)
          log('info', `[imageMode] Nano Banana 2 선택 완료 (+${offset}px)`)
          found = true
          await sleep(600)
          break
        }
      }
      if (!found) {
        log('warn', '[imageMode] Nano Banana 2 위치 탐색 실패 — Pro 유지')
        await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_model_fail.png') })
      }
    }
  } else if (modelBtn) {
    log('info', '[imageMode] 모델 이미 Nano Banana 2')
  }

  // 1. '이미지' 탭
  await clickTab(`txt.includes('이미지') || txt.toLowerCase().includes('image')`, '이미지 탭')
  await sleep(500)

  // 2. '9:16' 비율
  await clickTab(`txt.endsWith('9:16') || txt === '9:16'`, '9:16 비율')
  await sleep(400)

  // 3. 'x2' 생성 개수
  await clickTab(`txt === 'x2'`, 'x2 개수')
  await sleep(400)

  // 팝업 닫기
  await page.mouse.click(100, 100)
  log('info', '[imageMode] 팝업 닫기')
  await sleep(500)
}

async function clickAddToPrompt(page) {
  // 1순위: XPath로 텍스트 직접 매칭
  try {
    const btns = await page.$x('//button[contains(normalize-space(.), "프롬프트에 추가") and not(@disabled)]')
    for (const btn of btns) {
      const clicked = await btn.evaluate(el => {
        if (el.getBoundingClientRect().width === 0) return false
        el.click(); return true
      })
      if (clicked) return true
    }
  } catch {}

  // 2순위: Shadow DOM 포함 전체 탐색 (button + [role="button"])
  return page.evaluate(() => {
    const re = /프롬프트에 추가|add to prompt/i
    function search(root) {
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        if (re.test(el.textContent) && !el.disabled && el.getBoundingClientRect().width > 0) {
          el.click(); return true
        }
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = search(el.shadowRoot); if (r) return r }
      }
      return false
    }
    return search(document)
  })
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

// 2장의 새 이미지가 나타날 때까지 대기 (x2 생성 모드)
async function waitForTwoNewImages(page, beforeItems) {
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
        return collect(document).filter(src => !before.includes(src)).length >= 2
      },
      { timeout: CONFIG.timeoutMs },
      beforeSrcs
    )
  } catch {
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_timeout.png'), fullPage: true })
    log('warn', '2장 대기 타임아웃 → 현재 상태로 진행')
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
    // file:// URL 대신 base64 data URL 사용 (file:// 로드 시 페이지 프레임 분리 버그 방지)
    const fileBase64 = fs.readFileSync(outPath).toString('base64')
    const croppedBase64 = await page.evaluate(async (b64, panels) => {
      return new Promise(resolve => {
        const img = new Image()
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
        img.src = 'data:image/jpeg;base64,' + b64
      })
    }, fileBase64, 3)

    if (croppedBase64) {
      fs.writeFileSync(outPath, Buffer.from(croppedBase64, 'base64'))
      log('info', '중앙 패널 크롭 저장 완료')
    }
  }

  return outPath
}

// 단일 이미지 타깃을 파일로 저장 (fetch → 3분할 크롭 포함)
async function _saveImageTarget(page, target, outPath) {
  const imgSrc = target.src
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
      if (!downloaded) throw new Error('이미지 저장 실패: ' + path.basename(outPath))
    }
  }
  if (target.w > target.h * 1.3) {
    log('info', `3분할 이미지 감지 → 중앙 패널 크롭 (${target.w}×${target.h})`)
    const fileBase64 = fs.readFileSync(outPath).toString('base64')
    const croppedBase64 = await page.evaluate(async (b64, panels) => {
      return new Promise(resolve => {
        const img = new Image()
        img.onload = () => {
          const panelW = Math.floor(img.width / panels)
          const startX = Math.floor((img.width - panelW) / 2)
          const canvas = document.createElement('canvas')
          canvas.width = panelW
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, startX, 0, panelW, img.height, 0, 0, panelW, img.height)
          resolve(canvas.toDataURL('image/jpeg', 0.95).split(',')[1])
        }
        img.onerror = () => resolve(null)
        img.src = 'data:image/jpeg;base64,' + b64
      })
    }, fileBase64, 3)
    if (croppedBase64) {
      fs.writeFileSync(outPath, Buffer.from(croppedBase64, 'base64'))
      log('info', '중앙 패널 크롭 저장 완료')
    }
  }
  return outPath
}

// x2 생성 결과를 cut_NN_a.jpg + cut_NN_b.jpg 로 저장
async function saveTwoNewImages(page, beforeItems, cutNo, episode, prefix = 'cut') {
  const beforeSet = new Set(beforeItems.map(i => i.src))
  const allItems = await collectImageSrcs(page)
  const newItems = allItems.filter(i => !beforeSet.has(i.src))

  const epDir = path.join(CONFIG.downloadDir, `ep${episode}`)
  ensureDir(epDir)
  const padded = String(cutNo).padStart(2, '0')

  if (!newItems.length) {
    log('warn', '새 이미지 src를 찾지 못함 — saveImage fallback')
    await saveImage(page, cutNo, episode)
    const legacyPath = path.join(epDir, `${prefix}_${padded}.jpg`)
    const fallbackPath = path.join(epDir, `${prefix}_${padded}_a.jpg`)
    if (fs.existsSync(legacyPath) && !fs.existsSync(fallbackPath)) {
      fs.renameSync(legacyPath, fallbackPath)
    }
    return [fallbackPath]
  }

  // 마지막 2개 (가장 최근 생성)
  const targets = newItems.length >= 2
    ? [newItems[newItems.length - 2], newItems[newItems.length - 1]]
    : [newItems[newItems.length - 1]]
  const suffixes = targets.length === 2 ? ['a', 'b'] : ['a']
  const saved = []

  for (let idx = 0; idx < targets.length; idx++) {
    const outPath = path.join(epDir, `${prefix}_${padded}_${suffixes[idx]}.jpg`)
    log('info', `저장 ${suffixes[idx].toUpperCase()}: ${path.basename(outPath)} (${targets[idx].w}×${targets[idx].h})`)
    await _saveImageTarget(page, targets[idx], outPath)
    saved.push(outPath)
  }

  return saved
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
