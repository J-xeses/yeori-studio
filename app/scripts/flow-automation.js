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
 *   npm run flow -- --check-credits       # 크레딧 표시 탐색(디스커버리 전용, 자동 파싱 아님) — 화면 스캔 + 스크린샷만 남김
 *   npm run flow -- --profile=sub         # 서브 계정용 별도 Chrome 프로필/포트(9223) 사용. 기본은 main(9222)
 *
 * 캐릭터 등록 준비:
 *   downloads/flow/character/yeori-face.jpg  에 클로즈업 얼굴 이미지를 넣어두세요.
 *   (--gen-face 옵션 사용 시 자동 생성)
 *
 * 계정별 프로필: --profile=main(기본, 포트 9222) / --profile=sub(포트 9223), 둘 다 downloads/flow/chrome-profile-* 전용 폴더 사용.
 * ⚠️ 크롬 136+ 부터 --remote-debugging-port는 "기본 프로필"에서 보안상 무시되므로,
 * main/sub 둘 다 반드시 --user-data-dir로 비-기본 폴더를 지정해서 Chrome을 띄워야 함
 * (연결 실패 시 뜨는 connectBrowser() 안내 명령 그대로 사용하면 됨. 최초 1회는 해당 프로필에 직접 로그인 필요).
 */

import puppeteer from 'puppeteer-core'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import * as mp from '../server/lib/mediaPaths.js'
import { instaDir, instaRatio, INSTA_SUBDIR } from '../server/lib/mediaPaths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── ROOT ──────────────────────────────────────────────────────────────
const CODE_ROOT = 'C:\\yeori-studio\\app'
if (!fs.existsSync(path.join(CODE_ROOT, 'package.json'))) {
  console.error(`[ERROR] CODE_ROOT 경로를 찾을 수 없습니다: ${CODE_ROOT}`)
  process.exit(1)
}
console.log(`[CODE_ROOT] ${CODE_ROOT}`)
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

// ── 계정 프로필 (크레딧 모니터링용 — 메인/서브 구글 계정 분리) ─────────
// 기존 단일 Chrome(9222) 공유 방식은 그대로 유지(하위 호환, --profile 생략 시 main과 동일).
// 서브 계정을 동시에 확인하려면 --profile=sub 로 별도 포트/유저데이터 디렉터리의
// Chrome을 별도로 띄워야 함(로그인 세션이 안 섞이도록).
const PROFILE_PORTS = { main: 9222, sub: 9223 }
const activeProfile = process.argv.includes('--profile=sub') ? 'sub' : 'main'

// ── 설정 ─────────────────────────────────────────────────────────────
const CONFIG = {
  // remote debugging 방식: Chrome을 --remote-debugging-port=9222 로 미리 실행
  // chrome.exe --remote-debugging-port=9222
  debuggingPort:   PROFILE_PORTS[activeProfile],
  userDataDir:     mp.flowProfileDir(activeProfile),
  chromeExe:       'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  downloadDir:     mp.flowDownloadDir(),
  flowUrl:         'https://labs.google/flow',
  delayMs:         4000,   // 생성 요청 사이 대기 (레이트 리밋 방지)
  timeoutMs:       120000, // 이미지 생성 최대 대기 시간(1장 기준)
  twoImageTimeoutMs: 300000, // 2장(x2 생성 모드) 대기 최대 시간 — timeoutMs와 공유하면
                              // 1장 기준 예산으로 2장이 다 뜨길 기다리게 돼 실제로 아직
                              // 생성 중인데 타임아웃으로 강제 저장되는 문제가 있었음(2026-08-22)
  protocolTimeout: 300000, // puppeteer CDP 프로토콜(예: Page.captureScreenshot) 응답 대기
                            // 시간. puppeteer-core 기본값은 180000ms(3분)인데 그 안에서도
                            // "timed out" 이 발생해 5분으로 늘림(2026-08-22) — 기본값보다
                            // 짧게 잡으면 오히려 타임아웃이 더 잦아지므로 절대 기본값
                            // 밑으로 내리지 말 것.
  retryCount:      2,      // 실패 시 재시도 횟수

  // ── 레퍼런스 이미지 분석 ────────────────────────────────────────────
  referenceImage:  path.join(CODE_ROOT, 'assets', 'yeori-reference.jpg'),
  faceCacheFile:   mp.charactersDir('yeori-face-cache.json'),

  // ── 클로즈업 얼굴 프롬프트 (에피소드당 1회) ────────────────────────
  closeupFacePrompt: 'Close-up face shot. Young Korean woman early-20s appearing no older than 22-23, long wavy dark brown hair NOT short NOT permed NOT curly, natural wave only flowing naturally, natural skin texture, delicate gold necklace, soft natural smile, calm expression NOT surprised NOT wide eyes, warm skin tone, high facial symmetry, sharp jawline, effortlessly photogenic not posing. Photorealistic 8K cinematic.',

  // ── 전신샷 자동 추가 프리픽스/서픽스 ──────────────────────────────
  // yeori_ruleset_v1.3 반영: "DO NOT change ~" 류 강한 명령형은 정책위반 오인 유발 가능성으로 제거,
  // 서술형 표현으로 대체 (v1.2에서 "DO NOT change clothing" 금지가 확정된 것과 동일 사유)
  bodyPrefix:   'Same face as closeup reference, maintaining consistent facial features. Face clearly visible in frame. 1:8 head-to-body ratio, supermodel body proportions, tall K-model proportions, small face, long slender legs, slim figure.',
  bgSuffix:     'background people blurred and far away, must not interact with or touch main character, main character is clearly separated from background.',
  subtitleSuppression: 'NO subtitles. NO captions. NO text overlay. NO dialogue text visible in frame. NO watermark. NO on-screen text of any kind.',

  // ── 서여리 캐릭터 설정 ──────────────────────────────────────────────
  characterName:   '서여리',
  characterDir:    mp.charactersDir(),
  characterImage:  mp.charactersDir('yeori-face.jpg'),
  closeupImage:    mp.charactersDir('yeori-closeup.jpg'),
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

// 다중 캐릭터 — main()이 모듈 로드 중 동기 실행 구간에서 참조하므로 진입점 위에서 선언(TDZ 방지)
let EPISODE_REF_FILES = null   // 이 에피소드에서 업로드할 얼굴 레퍼런스 절대경로 목록
let EPISODE_CHAR_IDS = []      // 이 에피소드 컷들에 등장하는 캐릭터 id 목록
const CHARACTERS_JSON_PATH = () => mp.charactersJsonPath()

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

// 산출물 저장 폴더 계산 — 예전엔 saveNewImage/saveTwoNewImages/saveImage/main()
// 각자 downloads/flow/ep{N}/ 을 따로 조립했는데, 여기 하나로 모으고
// --type=insta 일 때만 downloads/insta/{content}/{num}/(raw) 로 분기한다.
// --ep= 기반 기존 동작은 이 함수를 거쳐도 완전히 동일하게 유지됨(하위호환).
function resolveContentDir(episode) {
  if (args.type === 'insta') {
    if (!args.content || !args.num) {
      log('error', '--type=insta 사용 시 --content=FD|RL|PT|ST 와 --num=값이 모두 필요합니다')
      process.exit(1)
    }
    return instaDir(args.content, args.num, INSTA_SUBDIR[args.content])
  }
  return mp.imagesDir(episode)
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

// ── 캐릭터 레지스트리 (downloads/flow/characters.json) ──────────────
// run-flow가 prompts.json의 cut.characters에 이미 인물 레코드를 실어주지만,
// 폴백(primary 인물)과 레퍼런스 파일 경로 해석용으로 원본도 읽는다.
function loadCharacterRegistry() {
  try {
    return JSON.parse(fs.readFileSync(CHARACTERS_JSON_PATH(), 'utf-8')) || {}
  } catch {
    return {}
  }
}
// 캐릭터를 Flow "캐릭터" 라이브러리에 등록한 뒤 그 사실을 characters.json에 기록
// (다음 실행에서 재등록하지 않도록). 실패해도 조용히 넘어간다.
function markCharacterFlowRegistered(id) {
  try {
    const reg = loadCharacterRegistry()
    if (!reg[id]) return
    reg[id] = { ...reg[id], flowRegistered: true, flowRegisteredAt: new Date().toISOString() }
    fs.writeFileSync(CHARACTERS_JSON_PATH(), JSON.stringify(reg, null, 2))
  } catch (e) {
    log('warn', `characters.json flowRegistered 기록 실패(무시): ${e.message}`)
  }
}
function charRefAbs(rel) {
  if (!rel) return null
  const abs = path.isAbsolute(rel) ? rel : path.join(MEDIA_ROOT, rel)
  return fs.existsSync(abs) ? abs : null
}
// IP 프롬프트에 인물별 descriptor를 삽입한다.
//  · "WOMAN 1 (Yeori):" / "WOMAN LEFT (Jia):" / "WOMAN (Yeori):" 처럼 번호·위치·아무것도
//    없는 라벨이 있으면 각 라벨 줄 뒤에 매칭 descriptor 삽입 (2026-09-04: 숫자만 받던 걸
//    LEFT/RIGHT 등 임의의 위치어까지 받도록 확장 — 안 넓혔을 때 라벨 매칭이 통째로 실패해
//    두 인물 descriptor가 프롬프트 맨 앞에 뭉쳐 붙는 버그가 있었음)
//  · 그래도 라벨이 하나도 없으면 맨 앞에 등장 인물 descriptor를 순서대로 나열
function injectCharacterDescriptors(prompt, cutChars) {
  const chars = (cutChars || []).filter(c => c && c.descriptor)
  if (!chars.length) return prompt
  const labelRe = /^(\s*WOMAN\s*[\w-]*\s*\(([^)]+)\)\s*:?.*)$/gim
  if (labelRe.test(prompt)) {
    labelRe.lastIndex = 0
    return prompt.replace(labelRe, (line, full, nameInParen) => {
      const key = String(nameInParen).trim().toUpperCase()
      const match = chars.find(c =>
        String(c.name || '').toUpperCase() === key ||
        String(c.id || '').toUpperCase() === key ||
        (c.aliases || []).some(a => String(a).toUpperCase() === key) ||
        String(c.flowCharacterName || '').toUpperCase() === key
      )
      return match ? `${full}\n${match.descriptor}` : line
    })
  }
  const prefix = chars.map(c => c.descriptor).join(' ')
  return `${prefix} ${prompt}`
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
    const epFile = path.join(mp.imagesDir(args.ep), 'prompts.json')
    if (fs.existsSync(epFile)) {
      file = epFile
      usingEpFile = true
      log('info', `ep 전용 파일 사용: ${epFile}`)
    } else {
      file = mp.promptsJsonPath()
      log('info', `ep${args.ep} 전용 파일 없음 → 글로벌 fallback: ${file}`)
    }
  } else {
    file = mp.promptsJsonPath()
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
  //   --register-character            : characters.json의 flowRegistered 아닌 캐릭터 전부
  //   --register-character=jia        : 그 캐릭터만 (id/이름/별칭)
  //   --register-character --force    : 이미 flowRegistered여도 재등록
  //   --gen-face                      : (서여리 전용, 레거시) 얼굴 먼저 생성 후 등록
  if (args['register-character'] || args['gen-face']) {
    const browser = await connectBrowser()
    const page = await setupPage(browser)
    try {
      await navigateToFlow(page)

      // --gen-face: 클로즈업 얼굴 먼저 생성 (서여리 레거시 경로)
      if (args['gen-face'] && !fs.existsSync(CONFIG.characterImage)) {
        log('info', '서여리 시그니처 얼굴 이미지 생성 중…')
        await generateFaceImage(page)
      }

      const reg = loadCharacterRegistry()
      const arg = typeof args['register-character'] === 'string' ? args['register-character'] : ''
      let ids
      if (arg) {
        const key = arg.toUpperCase()
        const hit = Object.entries(reg).find(([id, c]) =>
          id.toUpperCase() === key || String(c.name || '').toUpperCase() === key ||
          (c.aliases || []).some(a => String(a).toUpperCase() === key))
        if (!hit) { log('error', `characters.json에 "${arg}" 캐릭터 없음`); return }
        ids = [hit[0]]
      } else {
        ids = args.force ? Object.keys(reg) : Object.keys(reg).filter(id => !reg[id].flowRegistered)
      }

      if (Object.keys(reg).length === 0) {
        // characters.json이 아직 없는 구환경 — 기존 서여리 단일 경로로 폴백
        if (!fs.existsSync(CONFIG.characterImage)) {
          log('warn', `characters.json 없음 + 캐릭터 이미지 없음: ${CONFIG.characterImage}`)
          return
        }
        await registerCharacterWithImage(page, CONFIG.characterImage, { name: CONFIG.characterName })
      } else if (!ids.length) {
        log('ok', '등록할 캐릭터 없음 (전부 flowRegistered — 재등록하려면 --force)')
      } else {
        for (const id of ids) {
          const c = reg[id]
          const facePath = charRefAbs(c.closeup) || charRefAbs(c.face)
          if (!facePath) { log('warn', `"${id}" 얼굴 이미지 없음 → 건너뜀`); continue }
          const name = c.flowCharacterName || c.name || id
          const okReg = await registerCharacterWithImage(page, facePath, {
            name, matchNames: [name, c.name, id, ...(c.aliases || [])].filter(Boolean),
          })
          if (okReg) { markCharacterFlowRegistered(id); log('ok', `"${name}" 등록 완료`) }
        }
      }
    } finally {
      // Chrome 창은 유지하되(사람이 계속 쓸 수 있게), puppeteer 연결만 끊어서
      // 이 Node 프로세스는 종료되게 한다. disconnect() 없이 그냥 return하면
      // CDP WebSocket이 이벤트루프를 계속 붙잡아 프로세스가 좀비로 남았음
      // (2026-08-23 실측 — 하루 사이 이 스크립트를 여러 번 돌렸더니 완료된
      // 프로세스가 전부 안 죽고 쌓여서, 같은 Flow 계정에 여러 프로세스가
      // 동시에 요청을 보내는 상태가 됐고 그게 레이트리밋의 실제 원인이었음).
      await browser.disconnect()
    }
    process.exit(0)
  }

  // ── 크레딧 표시 탐색 모드 (디스커버리 전용 — 자동 파싱 아님) ────────
  if (args['check-credits']) {
    const browser = await connectBrowser()
    const page = await setupPage(browser)
    await navigateToFlow(page)
    await checkFlowCredits(page)
    // puppeteer.connect()로 붙인 CDP 세션은 disconnect() 없이는 프로세스가 안 끝남
    // (WebSocket 핸들이 이벤트루프를 계속 붙잡음) — Chrome 창 자체는 그대로 두고 연결만 해제.
    await browser.disconnect()
    process.exit(0)
  }

  // ── 일반 이미지 생성 모드 ─────────────────────────────────────────
  const { episode, type, cuts } = loadPrompts()
  if (!cuts.length) {
    log('warn', '처리할 프롬프트가 없습니다. 조건을 확인하세요.')
    return
  }

  // prompts.json에서 제목 읽기 → 프로젝트 이름: "EP4_한강라이딩"
  const _epPromptFile = args.ep && fs.existsSync(path.join(mp.imagesDir(args.ep), 'prompts.json'))
    ? path.join(mp.imagesDir(args.ep), 'prompts.json')
    : mp.promptsJsonPath()
  const rawPrompts = JSON.parse(fs.readFileSync(_epPromptFile, 'utf-8'))
  const epTitle    = (rawPrompts.title || '').replace(/\s+/g, '')
  const contentLabel = args.type === 'insta' ? `${args.content}${args.num}` : `EP${episode}`
  // --code=IG_R02 처럼 정식 에피소드 코드를 넘기면 그걸 새 프로젝트 이름에 우선 사용 —
  // 안 넘기면 기존처럼 contentLabel(예: RLRL02)로 폴백(하위호환).
  const projectNameSuffix = args.code || contentLabel
  const projectTitle = epTitle ? `${contentLabel}_${epTitle}` : contentLabel

  const epDir       = resolveContentDir(episode)
  const projectMarker = args.type === 'insta'
    ? path.join(instaDir(args.content, args.num), 'project_url.txt')  // 항상 콘텐츠 루트에 (raw 하위 아님)
    : path.join(epDir, 'project_url.txt')
  ensureDir(epDir)

  // ── 캐릭터 descriptor 주입 (다중 인물 지원) ──────────────────────────
  //  · prompts.json의 cut.characters(run-flow가 CH 필드에서 해석) 우선
  //  · 없으면 characters.json의 primary(서여리) 1명으로 폴백
  //  · IP에 "WOMAN 1 (Yeori):"/"WOMAN LEFT (Yeori):" 같은 라벨이 있으면 각 라벨 뒤에 해당 descriptor 삽입,
  //    없으면 맨 앞에 등장 인물 descriptor를 순서대로 나열
  const registry = loadCharacterRegistry()
  const primaryChar = Object.values(registry).find(c => c.primary) || Object.values(registry)[0] || null
  const epCharIds = new Set()
  for (const c of cuts) {
    let cutChars = Array.isArray(c.characters) && c.characters.length ? c.characters : null
    if (!cutChars && primaryChar) cutChars = [primaryChar]
    if (!cutChars) continue
    cutChars.forEach(cc => cc.id && epCharIds.add(cc.id))
    c.imagePrompt = injectCharacterDescriptors(c.imagePrompt, cutChars)
  }
  // 이 에피소드에서 필요한 모든 캐릭터의 얼굴 레퍼런스를 새 프로젝트 생성 시 업로드
  EPISODE_REF_FILES = []
  for (const id of epCharIds) {
    const ch = registry[id]
    for (const rel of [ch?.face, ch?.closeup]) {
      if (!rel) continue
      const abs = path.isAbsolute(rel) ? rel : path.join(MEDIA_ROOT, rel)
      if (fs.existsSync(abs) && !EPISODE_REF_FILES.includes(abs)) EPISODE_REF_FILES.push(abs)
    }
  }
  EPISODE_CHAR_IDS = [...epCharIds]
  log('ok', `캐릭터 descriptor 주입: ${cuts.length}컷 · 인물 ${EPISODE_CHAR_IDS.join(', ') || '(폴백)'} · 레퍼런스 ${EPISODE_REF_FILES.length}장`)

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

    // ── ①-b 이 에피소드 등장 캐릭터를 Flow 캐릭터 라이브러리에 자동 등록 ──
    //    (대시보드에 있는 지금 타이밍에. 이미 등록됐거나 실패하면 조용히 넘어감)
    try {
      await ensureFlowCharactersRegistered(page, EPISODE_CHAR_IDS)
    } catch (e) {
      log('warn', `캐릭터 자동 등록 단계 예외(무시): ${e.message}`)
    }

    // ── ② 에피소드 전용 프로젝트 확보 ───────────────────────────────
    //    project_url.txt 있으면 재사용 / 없으면 새 프로젝트를 자동 생성해서
    //    "{날짜} {에피소드코드}"로 이름 붙임(2026-08-23, 기존 "낡은 프로젝트 계속
    //    재사용" 방식이 세션 열화·미디어 그리드 오염의 원인 중 하나였음 — 에피소드당
    //    새 프로젝트를 쓰면 이 문제를 구조적으로 줄일 수 있음).
    if (!fs.existsSync(projectMarker)) {
      const projectUrl = await createNewFlowProject(page, projectNameSuffix)
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
    // 비율: --type=insta면 콘텐츠 유형별(FD/PT=1:1, RL/ST=9:16), 아니면 기존 longform/shorts 기준.
    // (예전엔 switchToImageMode가 9:16을 하드코딩해서 longform도 항상 9:16으로 나가던 버그가 있었음 — 같이 수정)
    const ratio = args.type === 'insta' ? (instaRatio(args.content) || '9:16') : (type === 'longform' ? '16:9' : '9:16')
    try {
      await switchToImageMode(page, ratio)
    } catch (err) {
      // 2026-08-23 실측: 같은 탭을 오래/반복해서 쓰면 page.screenshot()이
      // protocolTimeout(5분)을 다 채우고 ProtocolError로 죽는 현상이 재현됨 —
      // 같은 페이지를 새 탭에서 열면 즉시 정상 응답했으므로, 탭 자체를 버리고
      // 새로 열어 한 번 더 시도한다(사람 개입 없이 자동 복구).
      log('warn', `switchToImageMode 실패(${err.message}) → 새 탭으로 재연결 후 재시도`)
      page = await openFreshPage(browser, page)
      await page.goto(savedUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      await sleep(2500)
      await waitForImagesStable(page)
      await preFlightCheck(page)
      await switchToImageMode(page, ratio)
    }
    log('info', `모드 설정 완료: 이미지 / ${ratio} / x2`)

    // ── ③ 컷별 이미지 생성 ──────────────────────────────────────────
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i]
      const _ep = cut.episode ?? episode ?? 'x'
      const _padded = String(cut.no).padStart(2, '0')
      const _cutDir = resolveContentDir(_ep)
      const existingA = path.join(_cutDir, `cut_${_padded}_a.jpg`)
      const existingLegacy = path.join(_cutDir, `cut_${_padded}.jpg`)
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
            // Flow 자체 거부(레이트리밋/대기열초과)는 2초 기다린다고 안 풀림 —
            // 60초로 더 길게 백오프.
            const backoffMs = err.isFlowRejection ? 60000 : 2000
            log('warn', `${label} 재시도 ${attempt + 1}/${CONFIG.retryCount} (${backoffMs / 1000}초 대기): ${err.message}`)
            await sleep(backoffMs)
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
    // Chrome 창은 유지, puppeteer 연결만 끊어서 이 프로세스가 좀비로 안 남게 함
    // (위 register-character 분기의 동일한 수정 참고 — 2026-08-23).
    await browser.disconnect()
  }

  printSummary(ok, fail, results)
  saveReport(episode, results)
  process.exit(0)
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
    console.error(`  Chrome에 연결할 수 없습니다. (프로필: ${activeProfile})`)
    console.error('  Chrome을 먼저 아래 명령으로 실행해주세요:')
    // Chrome 136+ 부터는 --remote-debugging-port가 "기본 프로필(디폴트 user-data-dir)"에서는
    // 보안상 무시됨 — main/sub 둘 다 반드시 전용(비-기본) --user-data-dir 폴더가 있어야 함.
    console.error(`\n  "${CONFIG.chromeExe}" --remote-debugging-port=${CONFIG.debuggingPort} --user-data-dir="${CONFIG.userDataDir}"`)
    console.error(`\n  (--user-data-dir는 ${activeProfile === 'main' ? '메인' : '서브'} 계정 전용 Chrome 세션 폴더 — 최초 실행 시 해당 구글 계정으로 직접 로그인해두면 이후 세션이 유지됩니다.`)
    console.error('   기존 크롬 프로필(비밀번호/북마크 등)과는 완전히 별개의 새 프로필이라 처음엔 빈 화면으로 뜹니다.)')
    console.error('  다른 크롬이 하나라도 떠 있으면 먼저 taskkill /F /IM chrome.exe 로 전부 종료 후 실행하세요.')
    if (activeProfile === 'main') console.error('  서브 계정을 동시에 켜려면 다른 터미널에서 --profile=sub 로 별도 실행하세요.')
    console.error('═'.repeat(56) + '\n')
    throw new Error(`Chrome remote debugging 포트(${CONFIG.debuggingPort})에 연결 실패`)
  }
  log('info', `Chrome 연결 완료 (${version.Browser})`)
  return puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport:   null,
    protocolTimeout:   CONFIG.protocolTimeout,
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

// 기존 탭이 CDP 레벨에서 응답 불능(예: page.screenshot()이 protocolTimeout을 다
// 채우고 죽는 경우, 2026-08-23 실측 — 새 탭에서는 같은 페이지를 즉시 스크린샷할
// 수 있었음, 즉 탭/세션 단위 열화이지 Chrome 전체가 멈춘 게 아니었음)일 때, 그
// 탭은 버리고 완전히 새 탭을 만들어 이어가기 위한 용도. setupPage()와 달리
// "기존 탭 재사용" 없이 항상 새로 만든다.
async function openFreshPage(browser, closeStale) {
  if (closeStale) {
    try { await closeStale.close() } catch { /* 이미 응답불능일 수 있음 — 무시 */ }
  }
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
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

// 새 Flow 프로젝트를 만들고 "{날짜} {nameSuffix}"로 이름을 바꾼다(예: "8월 23일 IG_R02").
// Flow가 새 프로젝트 생성 시 자동으로 붙이는 이름이 "{날짜} {시간}" 형식이라(예: "8월 23일
// 오후 01:41"), 날짜 부분만 남기고 시간 대신 에피소드 코드로 바꿔치기하는 방식.
// 2026-08-23 라이브로 직접 클릭해보며 확정한 절차:
//   1) 대시보드의 "새 프로젝트" 클릭 → 즉시 새 프로젝트로 이동, 제목이 입력창(input)에 자동 채워짐
//   2) 제목 입력창 클릭 → 전체선택 → 새 이름 타이핑
//   3) 옆에 나타나는 "완료" 버튼 클릭(텍스트 길이에 따라 버튼 x좌표가 바뀌므로 매번 다시 탐색)
//   4) 저장이 비동기라 클릭 직후엔 대시보드 카드 목록에 반영 안 될 수 있음(실측 확인) —
//      개별 프로젝트 페이지 자체의 제목은 즉시 반영되고 새로고침해도 유지됨, 그걸로 충분함.
async function createNewFlowProject(page, nameSuffix) {
  const dashboardUrl = 'https://labs.google/fx/ko/tools/flow'
  // 대시보드 "루트"가 아니면(/characters, /project/… 포함) 반드시 대시보드로 이동.
  // 예전엔 startsWith(dashboardUrl)만 봐서 /characters도 통과시켜 "새 프로젝트" 버튼을 못 찾았음.
  const onDashboardRoot = /^https:\/\/labs\.google\/fx\/[a-z-]+\/tools\/flow\/?(\?|#|$)/.test(page.url())
  if (!onDashboardRoot) {
    await page.goto(dashboardUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(1500)
  }

  const newBtn = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const txt = (el.textContent || '').trim()
      if (/새 프로젝트/.test(txt)) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      }
    }
    return null
  })
  if (!newBtn) throw new Error('"새 프로젝트" 버튼을 찾지 못했습니다.')
  await page.mouse.click(newBtn.x, newBtn.y)
  try {
    await page.waitForFunction(() => location.href.includes('/project/'), { timeout: 15000 })
  } catch {
    // 2026-08-23 실측: 클릭이 씹히는 것처럼 15초 안에 이동이 없는 경우가 가끔
    // 있었음(같은 좌표로 다시 시도하면 바로 됐음) — 좌표 다시 찾아서 한 번 더 클릭.
    log('warn', '"새 프로젝트" 클릭 후 이동 없음 → 좌표 재탐색 후 재시도')
    const retryBtn = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const txt = (el.textContent || '').trim()
        if (/새 프로젝트/.test(txt)) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        }
      }
      return null
    })
    if (retryBtn) await page.mouse.click(retryBtn.x, retryBtn.y)
    await page.waitForFunction(() => location.href.includes('/project/'), { timeout: 15000 })
  }
  await sleep(1500)

  const currentTitle = await page.$eval('input', el => el.value).catch(() => '')
  const dateOnly = currentTitle.replace(/\s*(오전|오후).*$/, '').trim()
  const newTitle = dateOnly ? `${dateOnly} ${nameSuffix}` : nameSuffix

  const titlePos = await page.evaluate(() => {
    const el = document.querySelector('input')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  if (!titlePos) throw new Error('프로젝트 제목 입력창을 찾지 못했습니다.')

  await page.mouse.click(titlePos.x, titlePos.y)
  await sleep(300)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.type(newTitle, { delay: 20 })
  await sleep(300)

  const doneBtn = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button')) {
      if ((el.textContent || '').includes('완료')) {
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      }
    }
    return null
  })
  if (doneBtn) {
    await page.mouse.click(doneBtn.x, doneBtn.y)
  } else {
    // 완료 버튼을 못 찾으면 Enter로 대체 시도(완전 실패보다 낫다).
    await page.keyboard.press('Enter')
  }
  await sleep(1500)

  log('ok', `새 프로젝트 생성 + 이름 변경: "${newTitle}"`)

  // 새 프로젝트는 레퍼런스 이미지가 하나도 없는 빈 프로젝트라, findReferenceThumbs가
  // 항상 실패해 캐릭터 일관성 없이 생성이 진행되는 문제가 있었음(2026-08-23 실측 —
  // 레퍼런스 없이 진행하다 새 이미지 감지도 실패해서 엉뚱하게 구글 계정 프로필
  // 사진을 저장한 사고 발생). 새 프로젝트를 만들 때마다 로컬 레퍼런스 2장을
  // 자동으로 업로드해서, findReferenceThumbs가 기존 방식(호버 툴팁의 파일명)
  // 그대로 찾을 수 있게 한다.
  await uploadReferenceImages(page)

  return page.url()
}

// CONFIG.characterImage(yeori-face.jpg)/CONFIG.closeupImage(yeori-closeup.jpg)를
// 현재 프로젝트에 업로드. registerCharacter 쪽의 uploadCharacterImage()와 달리
// "캐릭터" 계정 라이브러리가 아니라 이 프로젝트의 미디어 풀(좌측 "업로드" 탭)에
// 넣는 것이 목적 — 파일 input을 직접 찾아 두 번 순서대로 업로드한다.
async function uploadReferenceImages(page) {
  // 이 에피소드 컷들에 등장하는 모든 인물의 얼굴 레퍼런스(EPISODE_REF_FILES)를 우선 사용.
  // 없으면 기존 단일(서여리) 레퍼런스로 폴백.
  const files = (EPISODE_REF_FILES && EPISODE_REF_FILES.length ? EPISODE_REF_FILES : [CONFIG.characterImage, CONFIG.closeupImage])
    .filter(f => fs.existsSync(f))
  if (!files.length) {
    log('warn', `레퍼런스 이미지 없음 — 업로드 건너뜀`)
    return
  }
  for (const filePath of files) {
    const inputHandle = await page.evaluateHandle(() => {
      function search(root) {
        for (const el of root.querySelectorAll('input[type="file"]')) return el
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) { const f = search(el.shadowRoot); if (f) return f }
        }
        return null
      }
      return search(document)
    })
    const inputEl = inputHandle.asElement()
    if (!inputEl) {
      log('warn', `파일 input을 찾지 못해 업로드 건너뜀: ${path.basename(filePath)}`)
      continue
    }
    await inputEl.uploadFile(filePath)
    log('ok', `레퍼런스 업로드: ${path.basename(filePath)}`)
    await sleep(2500) // 업로드/처리 완료 대기 — 다음 파일 input 재탐색 전 여유
  }
  // 두 번째 업로드까지 서버 처리(썸네일 생성)가 끝날 시간을 넉넉히 준다 —
  // findReferenceThumbs가 곧바로 호출되면 아직 처리 중이라 못 찾을 수 있음.
  await sleep(4000)
}


// ── 크레딧 표시 탐색 (디스커버리 전용) ────────────────────────────────
// 이 함수는 "자동으로 크레딧을 읽어온다"가 아니라, 화면에서 크레딧/숫자로
// 보이는 후보 요소를 스캔해서 로그+스크린샷으로 남기는 것까지만 한다.
// 사용자 확인 결과: 크레딧은 대시보드에 바로 안 보이고, 우측 상단 계정
// 아바타(보라색 원형 배경 + 흰 글씨 이니셜, 예: "성준")를 클릭해야 열리는
// 메뉴/패널 안에 있음 — 그래서 아바타를 먼저 찾아 클릭한 뒤 스캔한다.

async function scanForCreditText(page) {
  return page.evaluate(() => {
    function deepLeaves(root, list = []) {
      for (const el of root.querySelectorAll('*')) {
        if (el.children.length === 0) list.push(el)
        if (el.shadowRoot) deepLeaves(el.shadowRoot, list)
      }
      return list
    }
    const found = []
    for (const el of deepLeaves(document)) {
      const txt = (el.textContent || '').trim()
      if (!txt || txt.length > 60) continue
      const looksLikeCredit = /(크레딧|credit)/i.test(txt) || /^\d{1,4}\s*\/\s*\d{1,4}$/.test(txt)
      if (!looksLikeCredit) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      found.push({ txt, aria: el.getAttribute('aria-label') || '', x: Math.round(r.left), y: Math.round(r.top) })
    }
    return found
  })
}

// 우측 상단의 원형 계정 아바타 버튼을 찾아 클릭.
// 계정에 따라 표시가 다름 — 메인 계정: 짧은 이니셜 텍스트(예: "성준"),
// 서브 계정: 프로필 사진(<img> 또는 background-image)이 표시됨 — 둘 다 매칭.
// 색상은 브라우저/테마마다 다를 수 있어 색으로는 안 찾고,
// 위치(우측 상단)+모양(가로≈세로, 원형 크기대)으로 찾는다.
async function clickAccountAvatar(page) {
  return page.evaluate(() => {
    function deepAll(root, list = []) {
      for (const el of root.querySelectorAll('button, [role="button"], a, div, span')) list.push(el)
      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) deepAll(el.shadowRoot, list) }
      return list
    }
    const candidates = deepAll(document).filter(el => {
      const r = el.getBoundingClientRect()
      if (r.width < 20 || r.width > 64) return false
      if (Math.abs(r.width - r.height) > 10) return false        // 대략 원형/정사각형
      if (r.top > window.innerHeight * 0.2) return false         // 화면 상단부
      if (r.right < window.innerWidth * 0.55) return false       // 화면 우측부
      const txt = el.textContent.trim()
      // 편집 패널 등이 열려있을 때 "완료"/"저장" 같은 흔한 액션 버튼이 이니셜로 오인식되는 걸 방지
      const COMMON_ACTION_WORDS = ['완료', '저장', '취소', '닫기', '확인', 'done', 'save', 'cancel', 'close', 'ok']
      if (COMMON_ACTION_WORDS.includes(txt.toLowerCase())) return false
      const shortInitials = txt.length > 0 && txt.length <= 4    // 메인 계정: 이니셜
      const hasPhoto = !!el.querySelector('img')
        || (getComputedStyle(el).backgroundImage && getComputedStyle(el).backgroundImage !== 'none') // 서브 계정: 프로필 사진
      return shortInitials || hasPhoto
    })
    // 우측 상단에 더 가까운 순서로 정렬 (right가 클수록, top이 작을수록 우선)
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      return (rb.right - rb.top) - (ra.right - ra.top)
    })
    if (candidates[0]) {
      const r = candidates[0].getBoundingClientRect()
      const txt = candidates[0].textContent.trim()
      candidates[0].click()
      return { txt, x: Math.round(r.left), y: Math.round(r.top) }
    }
    return null
  })
}

async function checkFlowCredits(page) {
  log('info', `Flow 크레딧 표시 탐색 중… (프로필: ${activeProfile})`)
  await sleep(1500)

  // 1차: 대시보드 화면 그대로 스캔
  let matches = await scanForCreditText(page)
  const dashShotPath = path.join(CONFIG.downloadDir, `debug_credits_dashboard_${activeProfile}.png`)
  await page.screenshot({ path: dashShotPath, fullPage: true })

  // 2차: 우측 상단 계정 아바타 클릭 후 재스캔 (실제 크레딧은 보통 여기 있음)
  const avatar = await clickAccountAvatar(page)
  if (avatar) {
    log('info', `계정 아바타로 추정되는 버튼 클릭: "${avatar.txt}" @ (${avatar.x},${avatar.y})`)
    await sleep(1200)
    const menuMatches = await scanForCreditText(page)
    matches = matches.concat(menuMatches)
  } else {
    log('warn', '우측 상단 계정 아바타 버튼을 자동으로 못 찾았습니다. debug_credits_dashboard 스크린샷에서 직접 위치를 알려주시면 좌표 기반으로 다시 시도할 수 있습니다.')
  }

  const shotPath = path.join(CONFIG.downloadDir, `debug_credits_menu_${activeProfile}.png`)
  await page.screenshot({ path: shotPath, fullPage: true })

  // "50 Google Flow 크레딧" 처럼 숫자로 시작하는 텍스트에서 잔여 크레딧 추출
  const numberMatch = matches.map(m => m.txt.match(/^(\d+)\s/)).find(Boolean)
  const remaining = numberMatch ? parseInt(numberMatch[1], 10) : null

  if (matches.length) {
    log('ok', `크레딧 관련 후보 ${matches.length}개 발견:`)
    matches.forEach(m => log('info', `  "${m.txt}" aria="${m.aria}" @ (${m.x},${m.y})`))
  } else {
    log('warn', '크레딧 표시를 못 찾았습니다 — debug_credits_menu 스크린샷을 직접 확인해주세요.')
  }
  if (remaining != null) log('ok', `잔여 크레딧 파싱 결과: ${remaining}`)
  else log('warn', '숫자 패턴을 못 찾아 자동 파싱 실패 — 후보 텍스트를 확인해주세요.')

  log('info', `대시보드 스크린샷: ${path.relative(ROOT, dashShotPath)}`)
  log('info', `아바타 클릭 후 스크린샷: ${path.relative(ROOT, shotPath)}`)

  // 서버(proxy.js)가 stdout에서 이 한 줄만 grep해서 파싱함 — 형식 변경 시 proxy.js도 같이 수정할 것
  console.log(`CREDIT_RESULT:${JSON.stringify({ tool: 'flow', profile: activeProfile, remaining, checkedAt: new Date().toISOString() })}`)
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

async function registerCharacterWithImage(page, imagePath, opts = {}) {
  const charName = opts.name || CONFIG.characterName
  const CHAR_NAMES = opts.matchNames && opts.matchNames.length
    ? opts.matchNames
    : ['서여리', 'Seo Yeori', 'SeoYeori', 'yeori']
  // ── 전제조건 확인 ────────────────────────────────────────────────────
  if (!fs.existsSync(imagePath)) {
    log('error', `[REG-1] 캐릭터 이미지 파일 없음: ${imagePath}`)
    return false
  }
  log('info', `[REG-1] "${charName}" 캐릭터 이미지 확인: ${path.relative(ROOT, imagePath)}`)

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

  // ── 캐릭터 페이지가 실제로 쓸 수 있는지 확인 ─────────────────────────
  // (labs.google/fx/.../flow/characters 가 "여기에 표시할 정보가 없습니다" 같은
  //  빈/정책 화면으로 뜨는 경우가 있음 — 이때는 alreadyExists가 오탐될 수 있으므로
  //  아예 skip. 이미지 생성은 미디어 풀 레퍼런스를 쓰므로 이게 없어도 무방.)
  const pageUsable = await page.evaluate(() => {
    const t = document.body.innerText || ''
    if (/표시할 정보가 없습니다|no results to show|콘텐츠 정책/.test(t)) return false
    return [...document.querySelectorAll('button, a')].some(el =>
      /(캐릭터 만들기|create.{0,15}character|새 캐릭터|character 추가|add character|내 캐릭터|my characters)/i
        .test((el.textContent || '').trim()))
  })
  if (!pageUsable) {
    log('warn', `[REG-2] Flow 캐릭터 페이지를 쓸 수 없음(빈 화면/정책) → "${charName}" 등록 건너뜀. 미디어 풀 레퍼런스로 진행됨`)
    return false
  }

  // ── 이미 등록 여부 확인 ──────────────────────────────────────────────
  const alreadyExists = await page.evaluate((names) =>
    names.some(n =>
      [...document.querySelectorAll('*')].some(el =>
        el.offsetWidth > 0
        && el.textContent.trim().toLowerCase().includes(n.toLowerCase())
      )
    )
  , CHAR_NAMES)

  if (alreadyExists) {
    log('ok', `[REG-2] "${charName}" 캐릭터 이미 등록됨 → 스킵`)
    return true
  }
  log('info', `[REG-2] "${charName}" 미등록 → 신규 등록 시작`)

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
  log('info', `[REG-5] 캐릭터 이름 입력: "${charName}"`)
  await typeCharacterName(page, charName)
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

// ── 에피소드 등장 캐릭터를 Flow "캐릭터" 라이브러리에 자동 등록 ──────
// characters.json을 돌면서 이 에피소드에 등장하는(EPISODE_CHAR_IDS) 캐릭터 중
// flowRegistered가 아닌 것을 registerCharacterWithImage로 등록하고, 성공하면
// characters.json에 flowRegistered:true를 기록한다. 이미지 생성 흐름의 프로젝트
// 생성 직전에 1회 호출(대시보드에 있는 타이밍). 실패해도 생성은 계속 —
// 미디어 풀 레퍼런스(uploadReferenceImages)가 폴백.
async function ensureFlowCharactersRegistered(page, charIds) {
  if (args['no-char-register']) { log('info', '캐릭터 자동 등록 건너뜀 (--no-char-register)'); return }
  const reg = loadCharacterRegistry()
  const targets = (charIds && charIds.length ? charIds : Object.keys(reg))
    .filter(id => reg[id] && !reg[id].flowRegistered)
  if (!targets.length) {
    log('info', '등록 필요한 신규 캐릭터 없음 (전부 flowRegistered)')
    return
  }
  log('step', `[캐릭터 등록] 대상 ${targets.length}명: ${targets.join(', ')}`)
  for (const id of targets) {
    const c = reg[id]
    const facePath = charRefAbs(c.closeup) || charRefAbs(c.face)
    if (!facePath) { log('warn', `[캐릭터 등록] "${id}" 얼굴 이미지 없음 → 건너뜀`); continue }
    const name = c.flowCharacterName || c.name || id
    // 매칭명은 3글자 이하 짧은 별칭(오탐 위험)을 빼고 이름·flow이름·id만
    const matchNames = [name, c.flowCharacterName, c.name, id].filter(v => v && String(v).length >= 3)
    try {
      const okReg = await registerCharacterWithImage(page, facePath, { name, matchNames })
      if (okReg) {
        markCharacterFlowRegistered(id)
        log('ok', `[캐릭터 등록] "${name}" 완료`)
      } else {
        log('warn', `[캐릭터 등록] "${name}" 실패 — 미디어 풀 레퍼런스로 폴백`)
      }
    } catch (e) {
      log('warn', `[캐릭터 등록] "${name}" 예외(${e.message}) — 폴백`)
    }
  }
  // 캐릭터 페이지에 남아있으면 이후 createNewFlowProject가 "새 프로젝트" 버튼을 못 찾는다
  // (dashboardUrl.startsWith 체크가 /characters도 통과시켜 버려서). 반드시 대시보드로 복귀.
  try {
    log('info', '[캐릭터 등록] 대시보드로 복귀')
    await navigateToFlow(page)
  } catch (e) {
    log('warn', `[캐릭터 등록] 대시보드 복귀 경고: ${e.message}`)
  }
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

async function scanReferenceThumbsOnce(page, result) {
  // "모든 미디어"는 컷이 쌓일수록 레퍼런스 썸네일을 찾기 어려워지므로,
  // 업로드한 원본 2장만 들어있는 좌측 "업로드" 탭에서 바로 찾는다.
  const clickedUpload = await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const txt = (el.textContent || '').trim()
      if (txt === '업로드' && el.children.length === 0) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        }
      }
    }
    return null
  })
  if (clickedUpload) {
    await page.mouse.click(clickedUpload.x, clickedUpload.y)
    await sleep(500)
  } else {
    log('warn', '[findReferenceThumbs] "업로드" 탭 못 찾음 — 현재 화면에서 탐색')
  }

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

  // 너비 필터 없이 모든 이미지를 hover → tooltip 텍스트로만 판별
  // (width 기준은 배치 썸네일이 넓게 표시될 때 오탐지 발생)
  const candidates = imgPositions
  log('info', `[findReferenceThumbs] 레퍼런스 후보: ${candidates.length}개 (전체 탐색)`)

  const wanted = result.wanted  // ['yeori-face','yeori-closeup','jia-face',...]
  for (const pos of candidates) {
    if (wanted.every(bn => result.found[bn])) break

    // 호버 전 기준 텍스트 스냅샷
    const baseText = await page.evaluate(() => document.body.innerText.toLowerCase())

    await page.mouse.move(pos.x, pos.y)
    await sleep(600)

    const hitBn = await page.evaluate((base, wants) => {
      const text = document.body.innerText.toLowerCase()
      const newText = text.replace(base, '')
      const checkText = newText || text
      for (const bn of wants) {
        if (checkText.includes(bn) || checkText.includes(bn.replace(/-/g, '_'))) return bn
      }
      return null
    }, baseText, wanted)

    if (hitBn && !result.found[hitBn]) {
      result.found[hitBn] = pos
      log('info', `[findReferenceThumbs] ${hitBn} 발견: (${pos.x}, ${pos.y}) ${pos.w}×${pos.h}`)
    }
  }
}

// EPISODE_CHAR_IDS의 각 캐릭터 refBasename → ['<bn>-face','<bn>-closeup'] 목록.
// 폴백: 서여리(yeori).
function wantedRefBasenames() {
  const reg = loadCharacterRegistry()
  const ids = EPISODE_CHAR_IDS.length ? EPISODE_CHAR_IDS : ['yeori']
  const out = []
  for (const id of ids) {
    const bn = reg[id]?.refBasename || id
    out.push(`${bn}-face`, `${bn}-closeup`)
  }
  return out
}

async function findReferenceThumbs(page) {
  const wanted = wantedRefBasenames()
  const result = { found: {}, wanted }
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      log('warn', `[findReferenceThumbs] 재시도 ${attempt}/${maxAttempts} — 스캔 다시`)
      await sleep(700)
    }
    await scanReferenceThumbsOnce(page, result)
    if (wanted.every(bn => result.found[bn])) break
  }

  for (const bn of wanted) if (!result.found[bn]) log('warn', `[findReferenceThumbs] ${bn} 썸네일 못 찾음`)

  // 하위 호환: 첫 캐릭터(보통 서여리)의 face/closeup을 .face/.closeup으로도 노출
  const primaryBn = (wanted[0] || 'yeori-face').replace(/-face$/, '')
  result.face = result.found[`${primaryBn}-face`] || null
  result.closeup = result.found[`${primaryBn}-closeup`] || null
  return result
}

// ── 시작 전 체크리스트 ────────────────────────────────────────────────────

async function preFlightCheck(page) {
  log('step', '[체크리스트] 레퍼런스 썸네일 확인 중…')
  const thumbs = await findReferenceThumbs(page)
  const foundBns = Object.keys(thumbs.found)
  if (!foundBns.length) {
    log('warn', '[체크리스트] 레퍼런스 이미지 없음 — 레퍼런스 없이 진행 (텍스트 프롬프트만 사용)')
    return
  }
  log('ok', `[체크리스트] 레퍼런스 썸네일 ${foundBns.length}/${thumbs.wanted.length}: ${foundBns.join(', ')}`)
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
  // 대기열이 이미 꽉 찬 걸 아는 상태로 생성 버튼을 클릭하러 가면(실측 2026-08-23),
  // 그 클릭 자체는 성공해도 이후 page.screenshot()이 protocolTimeout(5분)을 다
  // 채우고 ProtocolError로 죽는 경우를 실제로 확인함(정확한 인과관계는 미확정 —
  // 원인 규명은 다음 세션 과제로 남김, 아래 memory 참고). 이미 알고 있는 나쁜
  // 상태에서 굳이 진행하지 않도록 컷 처리 시작 전에 먼저 걸러낸다.
  const preflightRejection = await detectFlowRejection(page)
  if (preflightRejection) throw new FlowRejectionError(`Flow 요청 거부(사전 확인): ${preflightRejection}`)

  const ep = cut.episode ?? defaultEpisode ?? 'x'

  // episode_style_guide.json이 있으면 promptPrefix를 프롬프트 앞에 삽입
  const styleGuidePath = path.join(mp.videoDir(ep), 'episode_style_guide.json')
  const promptPrefix = fs.existsSync(styleGuidePath)
    ? (() => { try { return JSON.parse(fs.readFileSync(styleGuidePath, 'utf-8')).promptPrefix || '' } catch { return '' } })()
    : ''
  const baseImagePrompt = promptPrefix
    ? `${promptPrefix}. ${cut.imagePrompt.trim()}`
    : cut.imagePrompt.trim()

  // 프롬프트 안에 실제 줄바꿈(\n)이 섞여 있으면 page.keyboard.type()이 Enter로
  // 그대로 보내는데, Flow 입력창은 Enter=제출(Shift+Enter만 줄바꿈)이라 프롬프트가
  // 한 줄씩 끊겨서 제출당 하나씩 수십 개의 조각 생성 요청이 나가버림(2026-08-23
  // 실측 — cut.imagePrompt에 \n이 들어있는 채로 타이핑했더니 대기열이 순식간에
  // 25개로 꽉 차고 완전히 엉뚱한 이미지가 저장됨). 타이핑 직전에 줄바꿈을 공백으로
  // 눌러 반드시 한 줄로 만든다.
  const finalPrompt = [CONFIG.bodyPrefix, baseImagePrompt, CONFIG.bgSuffix, CONFIG.subtitleSuppression]
    .join(' ')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  log('step', `컷 생성 중… (${type === 'longform' ? '16:9' : '9:16'})`)

  const pos = await prepareInput(page)
  log('info', `입력창: (${Math.round(pos.x)}, ${Math.round(pos.y)})`)

  // hover로 레퍼런스 썸네일 탐색 후 프롬프트 입력창으로 드래그 (등장 인물 전원)
  const thumbs = await findReferenceThumbs(page)
  const entries = Object.entries(thumbs.found)
  if (!entries.length) {
    log('warn', '[processCut] 레퍼런스 썸네일 없음 → 텍스트 프롬프트만')
  }
  for (const [bn, tpos] of entries) {
    await dragToPrompt(page, tpos, pos)
    log('info', `[processCut] ${bn} 드래그 완료`)
  }

  await page.mouse.click(pos.x, pos.y)
  await sleep(300)
  await page.keyboard.press('End')
  await sleep(100)
  await page.keyboard.type(finalPrompt, { delay: 15 })
  await sleep(500)

  // before 스냅샷 전에 "모든 미디어" 탭을 명시적으로 열어
  // 전체 그리드가 이미 렌더링된 상태에서 기준선을 잡는다.
  const clickedAllMedia = await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const txt = (el.textContent || '').trim()
      if (txt === '모든 미디어' && el.children.length === 0) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      }
    }
    return null
  })
  if (clickedAllMedia) {
    await page.mouse.click(clickedAllMedia.x, clickedAllMedia.y)
    await sleep(800)
  }

  const before = await collectImageSrcs(page)
  if (process.env.DIAG_NEWIMG) log('info', `[진단] 전체 스크롤 후 before=${before.length}`)
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

async function switchToImageMode(page, ratio = '9:16') {
  // 팝업이 이미 열려있는지 확인 (이미지/동영상 탭 텍스트 존재 여부로 판단)
  const alreadyOpen = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"], [role="option"]')]
    return tabs.some(el => /이미지|동영상|image|video/i.test((el.textContent || '').trim()))
  })

  if (!alreadyOpen) {
    // 하단 바 오른쪽 모드 설정 버튼 탐색
    // Flow UI 예: "동영상 · 9:16 □ 1x" 또는 "이미지 · 9:16 □ 2x"
    // ⚠️ 이전 코드 버그: /x[1-4]/ 는 "x1"/"x2" 형식만 매칭, 실제 UI의 "1x"/"2x"는 매칭 안 됨
    const popupInfo = await page.evaluate(() => {
      const h = window.innerHeight
      const w = window.innerWidth

      // 전략 1: 하단 60% 이하에서 모드/개수 텍스트 포함 버튼
      const modeRe = /[1-9]x|x[1-9]|동영상|이미지|video|image/i
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const txt = (el.textContent || '').trim()
        const r = el.getBoundingClientRect()
        if (r.top < h * 0.6 || r.width < 1 || r.height < 1) continue
        if (modeRe.test(txt)) {
          return { strategy: 1, txt: txt.slice(0, 80), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        }
      }

      // 전략 2: 하단 우측 영역(x > 40%, y > 70%)의 첫 번째 클릭 가능 요소
      const candidates = [...document.querySelectorAll('button, [role="button"], [tabindex]')]
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 10 && r.height > 10 && r.top > h * 0.7 && r.left > w * 0.4 && r.left < w * 0.95)
        .sort((a, b) => a.r.left - b.r.left)
      if (candidates.length > 0) {
        const { el, r } = candidates[0]
        return { strategy: 2, txt: (el.textContent || '').trim().slice(0, 80), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      }

      // 전략 3: 화면 하단 우측 고정 좌표 (최후 수단)
      return { strategy: 3, txt: '(고정좌표)', x: Math.round(w * 0.75), y: Math.round(h * 0.93) }
    })

    log('info', `[imageMode] 팝업 트리거 전략${popupInfo.strategy} — "${popupInfo.txt}" at (${popupInfo.x}, ${popupInfo.y})`)
    await page.mouse.click(popupInfo.x, popupInfo.y)
    await sleep(1500)
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_imagemode_popup.png') })
  } else {
    log('info', '[imageMode] 설정 팝업 이미 열려있음')
  }
  await sleep(400)

  // 팝업 내 클릭 가능한 짧은 요소 덤프 (디버깅)
  const allTabTexts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"], [role="option"], button, [role="button"]')]
      .filter(el => {
        const r = el.getBoundingClientRect()
        const txt = (el.textContent || '').trim()
        return r.width > 0 && r.height > 0 && txt.length > 0 && txt.length < 25
      })
      .map(el => {
        const r = el.getBoundingClientRect()
        return `"${(el.textContent || '').trim().slice(0, 15)}"@(${Math.round(r.left)},${Math.round(r.top)})`
      })
      .slice(0, 25)
  )
  log('info', `[imageMode] 팝업 요소 목록: ${JSON.stringify(allTabTexts)}`)

  // 범용 탭/버튼 클릭 — eval() 미사용, 클래스명 의존 없음
  // directTextOnly: true면 <i>아이콘 리거처</i> 자식 텍스트("crop_9_16" 등)를 제외하고
  // 해당 요소의 직계 텍스트 노드만 이어붙여 매칭한다.
  // (실사례: 16:9 버튼 textContent가 "crop_16_9"+"16:9"="crop_16_916:9"가 되어
  //  9:16을 찾는 느슨한 정규식이 "..._9"+"16"에 우연히 매칭돼 16:9를 잘못 클릭하는 버그가 있었음 — 2026-08-23 라이브 확인)
  async function clickTab(textPattern, label, excludePattern, opts) {
    const directTextOnly = !!(opts && opts.directTextOnly)
    const coords = await page.evaluate((pattern, exclusion, directTextOnly) => {
      const re = new RegExp(pattern, 'i')
      const excl = exclusion ? new RegExp(exclusion, 'i') : null
      // role="tab" 우선, 없으면 role="option"/button으로 폴백
      const selectors = ['[role="tab"]', '[role="option"]', '[role="menuitem"]', 'button', '[role="button"]']
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const txt = directTextOnly
            ? [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()
            : (el.textContent || '').trim()
          const r = el.getBoundingClientRect()
          if (r.width < 1 || r.height < 1) continue
          if (!txt || !re.test(txt)) continue
          if (excl && excl.test(txt)) continue
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), txt: txt.slice(0, 30) }
        }
      }
      return null
    }, textPattern, excludePattern || null, directTextOnly)

    if (coords) {
      await page.mouse.click(coords.x, coords.y)
      log('info', `[imageMode] ${label} 클릭 — "${coords.txt}" at (${coords.x}, ${coords.y})`)
      return true
    }
    log('warn', `[imageMode] ${label} 못 찾음 (pattern: ${textPattern})`)
    return false
  }

  // 0. 모델 확인 → Nano Banana 2가 아니면 전환 (Pro는 일일 한도 있음)
  const modelBtn = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const txt = (el.textContent || '').trim()
      const r = el.getBoundingClientRect()
      // "Banana" 포함, 개수 버튼(1x/2x/x1/x2 형식) 제외
      if (txt.includes('Banana') && !/[0-9]x|x[0-9]/i.test(txt) && r.width > 0 && r.height > 0)
        return { txt: txt.slice(0, 60), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), isV2: /Banana\s*2/.test(txt) && !/lite/i.test(txt) }
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
      const v2 = all.find(r => /Banana\s*2/.test(r.txt) && !r.txt.includes('Pro') && !/lite/i.test(r.txt))
      return { v2: v2 || null, all: all.map(r => r.txt) }
    })

    log('info', `[imageMode] 모델 옵션 목록: ${JSON.stringify(nb2.all)}`)
    if (nb2.v2) {
      await page.mouse.click(nb2.v2.x, nb2.v2.y)
      log('info', '[imageMode] Nano Banana 2 선택 완료')
      await sleep(600)
    } else {
      log('info', `[imageMode] modelBtn 좌표: (${modelBtn.x}, ${modelBtn.y}) — 오프셋 탐색 중`)
      let found = false
      for (const offset of [36, 45, 55, 65]) {
        const txt = await page.evaluate((x, y) => {
          const el = document.elementFromPoint(x, y)
          return el ? (el.textContent || '').trim().slice(0, 50) : null
        }, modelBtn.x, modelBtn.y + offset)
        log('info', `[imageMode] +${offset}px 위치 텍스트: "${txt}"`)
        if (txt && /Banana\s*2/i.test(txt) && !/lite/i.test(txt)) {
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
  } else if (modelBtn?.isV2) {
    log('info', '[imageMode] 모델 이미 Nano Banana 2')
  }

  // 1. '이미지' 탭 (동영상 모드에서 이미지로 전환)
  const imgOk = await clickTab('이미지|^image$', '이미지 탭')
  await sleep(500)
  if (!imgOk) await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_imagemode_tab_fail.png') })

  // 2. 비율 탭 (예: "9:16" → "9:16", "9/16", "916" 등 구분자 다양성까지 매칭)
  //    예전엔 여기가 9:16으로 하드코딩돼 있어서 longform(16:9)도 항상 9:16으로 나가던 버그가 있었음.
  //    directTextOnly + 앵커(^...$): 아이콘 리거처 텍스트를 제외한 순수 라벨만 비교해서
  //    9:16 ↔ 16:9 상호 오매칭을 방지한다 (2026-08-23 실사용 중 발견/수정).
  const [_ratioA, _ratioB] = ratio.split(':')
  await clickTab(`^${_ratioA}.{0,2}${_ratioB}$`, `${ratio} 비율`, null, { directTextOnly: true })
  await sleep(400)

  // 3. 'x2' 생성 개수 (x2, 2x, ×2, 2 등) — 모드/비율 텍스트는 제외
  await clickTab('[x×]2|2[x×]|^2$', 'x2 개수', '동영상|이미지|image|video|9|16|Banana')
  await sleep(400)

  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_imagemode_done.png') })

  // 팝업 닫기 (Escape 키 — 바깥 클릭보다 안전)
  await page.keyboard.press('Escape')
  log('info', '[imageMode] 팝업 닫기 (Escape)')
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
            /arrow_forward/.test(txt) ||
            label.includes('send') || label.includes('전송') || label.includes('보내기') ||
            label.includes('submit') || label.includes('generate') || label.includes('만들기')) {
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
          const r = img.getBoundingClientRect()
          list.push({ src: img.src, w: img.naturalWidth, h: img.naturalHeight, top: Math.round(r.top), left: Math.round(r.left) })
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

// Flow가 생성 요청 자체를 거부했을 때 뜨는 토스트 감지("너무 빨리 요청했습니다",
// "대기열에 추가할" 25개 초과 등). 2026-08-22 실측(IG_R02/CUT4) — 이 토스트가 뜨면
// 새 이미지는 영원히 안 생기는데 기존 코드는 이걸 구분 못 하고 waitForFunction
// 타임아웃(수 분)을 그냥 다 날린 뒤 "현재 상태로 진행"해버렸음. live DOM에서 실제
// 문구를 확인해 키워드로 잡음(스타일드컴포넌트 해시 클래스는 버전마다 바뀌므로
// 텍스트 매칭이 더 안정적).
const FLOW_REJECTION_KEYWORDS = ['너무 빨리 요청', '대기열에 추가할']

async function detectFlowRejection(page) {
  return page.evaluate((keywords) => {
    for (const el of document.querySelectorAll('li, div')) {
      const txt = (el.textContent || '').trim()
      if (txt.length > 0 && txt.length < 150 && keywords.some(k => txt.includes(k))) return txt
    }
    return null
  }, FLOW_REJECTION_KEYWORDS)
}

class FlowRejectionError extends Error {
  constructor(message) {
    super(message)
    this.isFlowRejection = true
  }
}

// page.waitForFunction 하나로는 "조건 충족"과 "Flow가 요청을 거부함"을 동시에
// 감지할 수 없어서(둘 중 뭐가 됐는지 구분이 필요) 짧은 간격으로 직접 폴링한다.
async function pollUntil(page, checkFn, checkArg, { timeout, pollMs = 1000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const [ready, rejection] = await Promise.all([
      page.evaluate(checkFn, checkArg),
      detectFlowRejection(page),
    ])
    if (ready) return
    if (rejection) throw new FlowRejectionError(`Flow 요청 거부: ${rejection}`)
    await sleep(pollMs)
  }
  const err = new Error('polling timeout')
  err.isPollTimeout = true
  throw err
}

const COLLECT_NEW_IMAGE_SRCS = (before) => {
  function collect(root, list = []) {
    for (const img of root.querySelectorAll('img')) {
      if (img.naturalWidth > 80 && img.complete && img.src) list.push(img.src)
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) collect(el.shadowRoot, list)
    }
    return list
  }
  return collect(document).filter(src => !before.includes(src))
}

// 새 이미지가 나타날 때까지 대기
async function waitForNewImage(page, beforeItems) {
  const beforeSrcs = beforeItems.map(i => i.src)
  try {
    await pollUntil(
      page,
      (before) => COLLECT_NEW_IMAGE_SRCS(before).length >= 1,
      beforeSrcs,
      { timeout: CONFIG.timeoutMs }
    )
  } catch (err) {
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_timeout.png'), fullPage: true })
    log('info', err.isFlowRejection
      ? `Flow 거부 감지, 타임아웃 스크린샷: downloads/flow/debug_timeout.png (${err.message})`
      : '타임아웃 스크린샷: downloads/flow/debug_timeout.png')
    throw err
  }
  await sleep(800)
}

// 2장의 새 이미지가 나타날 때까지 대기 (x2 생성 모드)
async function waitForTwoNewImages(page, beforeItems) {
  const beforeSrcs = beforeItems.map(i => i.src)
  try {
    await pollUntil(
      page,
      (before) => COLLECT_NEW_IMAGE_SRCS(before).length >= 2,
      beforeSrcs,
      { timeout: CONFIG.twoImageTimeoutMs }
    )
  } catch (err) {
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug_timeout.png'), fullPage: true })
    if (err.isFlowRejection) {
      log('warn', `2장 대기 중 Flow 거부 감지 → 재시도로 넘김: ${err.message}`)
      throw err   // 예전엔 여기서 삼키고 "현재 상태로 진행"했음 — 그러면 바깥 재시도
                  // 로직이 아예 발동을 안 해서, 거부됐는데도 다음 컷으로 그냥 넘어가버림
    }
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

  const epDir = resolveContentDir(episode)
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

  if (process.env.DIAG_NEWIMG) {
    log('info', `[진단] before=${beforeItems.length} all=${allItems.length} new=${newItems.length}`)
    const diagDir = path.join(CONFIG.downloadDir, '_diag')
    ensureDir(diagDir)
    for (let i = 0; i < newItems.length; i++) {
      const it = newItems[i]
      log('info', `[진단] new[${i}] top=${it.top} left=${it.left} ${it.w}x${it.h} ...${it.src.slice(-24)}`)
      try {
        await _saveImageTarget(page, it, path.join(diagDir, `cut${cutNo}_new${i}_top${it.top}_left${it.left}.jpg`))
      } catch (e) {
        log('warn', `[진단] new[${i}] 저장 실패: ${e.message}`)
      }
    }
  }

  const epDir = resolveContentDir(episode)
  ensureDir(epDir)
  const padded = String(cutNo).padStart(2, '0')

  if (!newItems.length) {
    // 예전엔 여기서 saveImage()(= DOM에 있는 "마지막" img를 무조건 저장)로 폴백했는데,
    // saveImage()는 beforeItems와 무관하게 그 시점 DOM의 마지막 큰 이미지를 그냥 가져가는
    // 함수라서, 진짜 생성이 실패한 경우 방금 업로드해둔 레퍼런스 썸네일 등 기존 이미지를
    // "생성 결과"로 잘못 저장해버리는 사고가 반복됐다(2026-08-22, 2026-08-23 실측 — 매번
    // 똑같은 127497바이트 레퍼런스성 클로즈업 사진이 컷4 결과로 저장됨). 새 이미지가 정말
    // 하나도 없으면 조용히 잘못된 파일을 만드는 대신 실패시켜서 바깥 재시도 루프가 다시
    // 시도하게 한다.
    throw new Error('2장 대기 타임아웃 후에도 새 이미지가 0개 — 생성 실패로 처리')
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
  const epDir = resolveContentDir(episode)
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
  const label = args.type === 'insta' ? `${args.content}${args.num}` : `ep${episode ?? 'x'}`
  const reportPath = path.join(CONFIG.downloadDir, `report_${label}_${Date.now()}.json`)
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
