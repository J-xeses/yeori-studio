#!/usr/bin/env node
// Cloudflare Quick Tunnel 기동 + URL 변경 자동 감지 + Vercel MCP_BRIDGE_URL 갱신/재배포
// Usage: node scripts/sync-tunnel.js
//
// Quick Tunnel(cloudflared tunnel --url ...)은 재시작마다 URL이 바뀐다.
// 이 스크립트는 cloudflared를 자식 프로세스로 띄워 로그에서 URL을 파싱하고,
// 이전 실행 때 기록해둔 URL(.tunnel-state.json)과 다르면
// Vercel production env(MCP_BRIDGE_URL)를 갱신한 뒤 최신 배포를 redeploy한다.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const APP_ROOT = 'C:\\yeori-studio\\app'

// .env.local 에서 VERCEL_TOKEN 등을 읽어들인다 (setx 환경변수 전파가 스케줄 작업까지
// 확실히 안 되는 경우가 있어서 -- .env.local 이 단일 신뢰 소스). 이미 env 에 있으면 유지.
try {
  const envFile = path.join(APP_ROOT, '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  }
} catch { /* .env.local 없거나 읽기 실패 -- 무시 */ }
// 설치 방식(winget vs 수동 설치)에 따라 경로가 달라서 후보를 순서대로 확인한다.
// start_yeori.bat도 동일한 winget 경로를 우선 사용하도록 맞춰져 있음.
const CLOUDFLARED_CANDIDATES = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe'),
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
]
const CLOUDFLARED = CLOUDFLARED_CANDIDATES.find((p) => p && fs.existsSync(p)) || CLOUDFLARED_CANDIDATES[0]
const TUNNEL_TARGET = 'http://localhost:3001'
const STATE_PATH = path.join(APP_ROOT, '.tunnel-state.json')
const VERCEL_SCOPE = 'won566800-7736s-projects'
const VERCEL_ENV_VAR = 'MCP_BRIDGE_URL'          // 폴백 경로용 (Edge Config 실패 시)
// 기본 경로: Edge Config 항목만 REST API 로 갈아끼운다 (재배포 없음).
const EDGE_CONFIG_ID = 'ecfg_gihelk4e1zhfrhpvqlsef2zo1xeh'
const VERCEL_TEAM_ID = 'team_IU3S3PuemDCIj1NN8gGHC8EM'
const EDGE_CONFIG_KEY = 'mcpBridgeUrl'
const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/

// Quick Tunnel 은 몇 초 만에 끊겼다 붙으며 그때마다 URL 이 바뀔 수 있다.
// 매 변화를 즉시 반영하면 갱신 폭주가 나므로, URL 이 이만큼 조용하면(안정되면) 반영한다.
// 단 계속 요동쳐도 MAX 까지는 기다렸다가 마지막 값으로 강제 반영한다(무한 대기 방지).
const DEBOUNCE_MS = 10_000
const DEBOUNCE_MAX_MS = 45_000

// VERCEL_TOKEN 환경변수가 있으면 vercel CLI 가 자동으로 사용한다(대화형 로그인 만료 대비).
// setx VERCEL_TOKEN "..." 로 사용자 환경변수에 넣어두면 이 스크립트가 상속받는다.
if (process.env.VERCEL_TOKEN) console.log('[tunnel] VERCEL_TOKEN 감지 -- 토큰 인증 사용')

// proxy.js와 동일한 이유(콘솔 창이 닫히면 사후 확인 불가)로 파일 로그를 남긴다.
const LOG_PATH = path.join('C:\\yeori-studio', 'logs', 'sync-tunnel.log')
function logToFile(line) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`, 'utf-8')
  } catch { /* 로그 실패로 스크립트가 죽으면 안 됨 */ }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function writeState(url) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 2))
}

// vercel CLI는 Windows에서 .cmd 셔임이라 shell:true 필요.
// 배너/진행 메시지는 stderr로, 데이터(JSON 등)는 stdout으로 나오는 것을 확인했음 -- stdout만 캡처.
// redeploy는 빌드를 기다려야 해서 실측 40~50초대가 흔함 -- 60초는 여유가 없어
// 2026-08-28에 두 차례 연속 타임아웃으로 강제 종료되어 수동 개입이 필요했음.
const CMD_TIMEOUT_MS = 150_000

function run(cmd, args) {
  const commandLine = [cmd, ...args].join(' ')
  console.log(`+ ${commandLine}`)
  return new Promise((resolve, reject) => {
    // stdin을 'ignore'로 닫아둔다 -- 열어두면 non-TTY(백그라운드) 실행 시
    // vercel CLI가 존재하지 않는 입력을 기다리며 무한 대기하는 경우가 있음(실측 확인됨).
    const proc = spawn(commandLine, { cwd: APP_ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill()
      reject(new Error(`${commandLine} -- ${CMD_TIMEOUT_MS / 1000}초 내 응답 없음(타임아웃), 프로세스 강제 종료`))
    }, CMD_TIMEOUT_MS)

    let errOut = ''
    proc.stdout.on('data', (d) => { out += d.toString() })
    // stderr는 콘솔에 실시간으로 보여주는 것과 별개로 실패 원인 진단을 위해 로그 파일에도 남긴다
    // -- 과거에 "vercel ... 종료 코드 1"만 로그에 남고 실제 stderr 내용이 없어서
    // 원인을 알 수 없었던 사례가 있었음.
    proc.stderr.on('data', (d) => { process.stderr.write(d); errOut += d.toString() })
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${commandLine} -- 종료 코드 ${code}${errOut.trim() ? ` -- stderr: ${errOut.trim()}` : ''}`))
    })
  })
}

async function latestReadyProductionUrl() {
  const out = await run('vercel', [
    'ls', '--environment', 'production', '--status', 'READY',
    '--format', 'json', '--scope', VERCEL_SCOPE,
  ])
  const data = JSON.parse(out)
  const dep = data.deployments?.[0]
  if (!dep) throw new Error('READY 상태의 production 배포를 찾을 수 없음')
  return `https://${dep.url}`
}

// 기본 경로: Edge Config 항목만 REST API 로 갈아끼운다. 재배포 없음(~1초).
// api/mcp.js 가 요청 시점에 이 값을 읽으므로 즉시 반영된다.
// (vercel CLI --patch 는 shell:true 로 JSON 이 깨져서 REST 로 직접 호출한다.)
async function updateEdgeConfig(newUrl) {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN 없음 -- Edge Config REST 호출 불가')
  const r = await fetch(
    `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items?teamId=${VERCEL_TEAM_ID}`,
    {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ operation: 'upsert', key: EDGE_CONFIG_KEY, value: newUrl }] }),
      signal: AbortSignal.timeout(15_000),
    },
  )
  if (!r.ok) throw new Error(`Edge Config PATCH ${r.status}: ${(await r.text()).slice(0, 200)}`)
  console.log('[tunnel] Edge Config 갱신 완료 (재배포 불필요)\n')
}

// 폴백 경로: Edge Config 가 아직 없거나 실패할 때. env 교체 + 재배포(~40초).
async function updateVercelEnvAndRedeploy(newUrl) {
  console.log(`\n[tunnel] 폴백 -- Vercel ${VERCEL_ENV_VAR} env 갱신 + 재배포: ${newUrl}`)
  try {
    await run('vercel', ['env', 'rm', VERCEL_ENV_VAR, 'production', '--yes', '--scope', VERCEL_SCOPE])
  } catch {
    console.log(`[tunnel] 기존 ${VERCEL_ENV_VAR} 없음(최초 설정으로 간주) -- 계속 진행`)
  }
  await run('vercel', ['env', 'add', VERCEL_ENV_VAR, 'production', '--value', newUrl, '--yes', '--scope', VERCEL_SCOPE])
  const deployUrl = await latestReadyProductionUrl()
  console.log(`[tunnel] 재배포 대상: ${deployUrl}`)
  await run('vercel', ['redeploy', deployUrl, '--target', 'production', '--scope', VERCEL_SCOPE])
  console.log('[tunnel] Vercel env 갱신 + 재배포 완료\n')
}

async function pushBridgeUrl(newUrl) {
  try {
    await updateEdgeConfig(newUrl)
  } catch (err) {
    console.error(`[tunnel] Edge Config 갱신 실패 (${err.message}) -- env+재배포로 폴백`)
    logToFile(`Edge Config 갱신 실패 -- 폴백: ${err.message}`)
    await updateVercelEnvAndRedeploy(newUrl)
  }
}

// ── URL 변경 디바운스 (모듈 스코프: cloudflared 재시작과 무관하게 유지) ──
let pendingUrl = null
let pendingSince = 0
let debounceTimer = null
let committing = false

function noteUrl(newUrl) {
  const prev = readState()
  if (prev?.url === newUrl && pendingUrl === null) {
    console.log('[tunnel] 이전 URL과 동일 -- 갱신 생략')
    logToFile('이전 URL과 동일 -- 갱신 생략')
    return
  }
  if (newUrl === pendingUrl) return // 이미 이 값으로 예약됨

  const now = Date.now()
  if (pendingUrl === null) pendingSince = now
  pendingUrl = newUrl
  console.log(`[tunnel] URL 후보: ${newUrl} -- ${DEBOUNCE_MS / 1000}초 안정되면 반영`)
  logToFile(`URL 후보: ${newUrl} (이전 반영: ${prev?.url || '없음'})`)

  if (debounceTimer) clearTimeout(debounceTimer)
  const waited = now - pendingSince
  const delay = waited >= DEBOUNCE_MAX_MS ? 0 : Math.min(DEBOUNCE_MS, DEBOUNCE_MAX_MS - waited)
  debounceTimer = setTimeout(commitUrl, delay)
}

function commitUrl() {
  if (committing || pendingUrl === null) return
  const url = pendingUrl
  const prev = readState()
  if (prev?.url === url) { pendingUrl = null; return }

  committing = true
  console.log(`\n[tunnel] URL 반영 시작: ${url}`)
  pushBridgeUrl(url)
    .then(() => {
      writeState(url)
      logToFile(`반영 완료: ${url}`)
    })
    .catch((err) => {
      console.error(`[tunnel] URL 반영 실패: ${err.message}`)
      console.error('[tunnel] 수동 갱신: .env.local 에 VERCEL_TOKEN 설정 후 이 프로세스 재시작')
      console.error(`  (Edge Config ${EDGE_CONFIG_ID} 의 ${EDGE_CONFIG_KEY} 를 ${url} 로)`)
      logToFile(`FATAL URL 반영 실패 (url=${url}): ${err.stack || err.message}`)
    })
    .finally(() => {
      committing = false
      // 반영 도중 더 새로운 URL 이 들어왔다면 이어서 처리
      if (pendingUrl && pendingUrl !== url) {
        pendingSince = Date.now()
        debounceTimer = setTimeout(commitUrl, DEBOUNCE_MS)
      } else {
        pendingUrl = null
      }
    })
}

// ── 자동 재연결 (Quick Tunnel은 가동시간 보장이 없어 언제든 끊길 수 있음) ──
// cloudflared 프로세스가 예기치 않게 죽으면(네트워크 문제, Cloudflare 엣지 쪽 문제 등)
// 이전에는 스크립트 자체가 같이 종료돼서 사용자가 직접 다시 실행해야 했다.
// 이제는 백오프를 두고 자동으로 재기동하고, 재시작할 때마다 새 URL을 다시 감지해
// Vercel에 반영한다. 사용자가 Ctrl+C(SIGINT/SIGTERM)로 끈 경우에는 재시작하지 않는다.
let shuttingDown = false
let currentChild = null
let restartCount = 0
let lastStartedAt = 0
const RESTART_BASE_DELAY_MS = 3_000
const RESTART_MAX_DELAY_MS = 60_000
const STABLE_UPTIME_MS = 120_000 // 이만큼 오래 떠있었으면 다음에 끊겨도 백오프를 처음부터 다시 센다

function scheduleRestart() {
  if (shuttingDown) return
  const uptime = Date.now() - lastStartedAt
  restartCount = uptime >= STABLE_UPTIME_MS ? 0 : restartCount + 1
  const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** restartCount, RESTART_MAX_DELAY_MS)
  console.log(`[tunnel] ${Math.round(delay / 1000)}초 후 터널 재연결 시도... (연속 재시작 ${restartCount}회째)`)
  logToFile(`재연결 예약: ${delay}ms 후 (연속 재시작 ${restartCount}회째)`)
  setTimeout(startTunnel, delay)
}

function startTunnel() {
  if (!fs.existsSync(CLOUDFLARED)) {
    console.error(`[tunnel] cloudflared.exe 없음: ${CLOUDFLARED}`)
    logToFile(`FATAL cloudflared.exe 없음: ${CLOUDFLARED}`)
    process.exit(1)
  }

  console.log('[tunnel] Cloudflare Quick Tunnel 시작...')
  logToFile(`--- 터널 프로세스 시작 (cloudflared: ${CLOUDFLARED}) ---`)
  lastStartedAt = Date.now()
  const child = spawn(CLOUDFLARED, ['tunnel', '--url', TUNNEL_TARGET], { stdio: ['ignore', 'pipe', 'pipe'] })
  currentChild = child

  let handled = false
  // stdout/stderr는 파이프로 받으므로 한 줄(특히 박스로 그려지는 URL 배너)이
  // 여러 data 이벤트로 쪼개져 도착할 수 있다 -- 청크 단위로만 정규식을 매칭하면
  // URL이 경계에서 잘려 영원히 감지되지 않는 경우가 실제로 있었다(원인 확인됨).
  // 그래서 누적 버퍼에 대해 매칭하고, 버퍼는 과도하게 자라지 않게 마지막 4000자만 유지한다.
  let rollingBuffer = ''

  const onData = (buf) => {
    const text = buf.toString('utf-8')
    process.stdout.write(text)
    if (handled) return

    rollingBuffer += text
    if (rollingBuffer.length > 4000) rollingBuffer = rollingBuffer.slice(-4000)

    const match = rollingBuffer.match(URL_RE)
    if (!match) return
    handled = true

    const newUrl = match[0]
    console.log(`\n[tunnel] 감지된 터널 URL: ${newUrl}`)
    noteUrl(newUrl)
  }

  child.stdout.on('data', onData)
  child.stderr.on('data', onData)

  child.on('error', (err) => {
    console.error('[tunnel] cloudflared 실행 실패:', err.message)
    logToFile(`cloudflared 실행 실패: ${err.stack || err.message}`)
    scheduleRestart()
  })

  child.on('exit', (code, signal) => {
    console.log(`[tunnel] cloudflared 종료됨 (code ${code}, signal ${signal})`)
    logToFile(`cloudflared 종료됨 (code ${code}, signal ${signal}), handled=${handled}, shuttingDown=${shuttingDown}`)
    if (shuttingDown) {
      process.exit(code ?? 0)
      return
    }
    scheduleRestart()
  })
}

process.on('SIGINT', () => { shuttingDown = true; currentChild?.kill() })
process.on('SIGTERM', () => { shuttingDown = true; currentChild?.kill() })

// ── 워치독 ──────────────────────────────────────────────────────────
// Quick Tunnel 은 cloudflared 프로세스가 살아있는데도 Cloudflare 엣지 쪽에서
// 라우트만 죽는 일이 잦다(2026-09-07~08 실측: 14시간 무응답인데 프로세스는 running).
// child.on('exit') 만으로는 재연결이 안 걸리므로, 주기적으로 자기 URL 을 직접
// 확인하고 연속 실패하면 cloudflared 를 죽여 재연결을 강제한다.
const WATCHDOG_INTERVAL_MS = 90_000
const WATCHDOG_FAIL_LIMIT = 3
let watchdogFails = 0
async function watchdogTick() {
  if (shuttingDown || committing) return
  const url = readState()?.url
  if (!url || Date.now() - lastStartedAt < 120_000) { watchdogFails = 0; return } // 방금 시작이면 스킵
  let ok = false
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) })
    ok = r.ok
  } catch { ok = false }
  if (ok) { watchdogFails = 0; return }
  watchdogFails += 1
  console.log(`[tunnel] 워치독: 터널 무응답 ${watchdogFails}/${WATCHDOG_FAIL_LIMIT}`)
  logToFile(`워치독: ${url} 무응답 (${watchdogFails}/${WATCHDOG_FAIL_LIMIT})`)
  if (watchdogFails >= WATCHDOG_FAIL_LIMIT) {
    watchdogFails = 0
    console.log('[tunnel] 워치독: cloudflared 종료 → 재연결')
    logToFile('워치독: cloudflared 강제 종료 → 재연결')
    currentChild?.kill() // exit 핸들러가 scheduleRestart() 호출
  }
}
setInterval(() => { watchdogTick().catch(() => {}) }, WATCHDOG_INTERVAL_MS)

// 이 스크립트도 장시간 떠있어야 하므로 proxy.js와 동일하게 예기치 못한 예외로
// 조용히 죽지 않도록 방지(로그만 남기고 계속 진행).
process.on('uncaughtException', (err) => {
  console.error('[tunnel] uncaughtException:', err.message)
  logToFile(`uncaughtException: ${err.stack || err.message}`)
})
process.on('unhandledRejection', (reason) => {
  console.error('[tunnel] unhandledRejection:', reason)
  logToFile(`unhandledRejection: ${reason?.stack || reason}`)
})

startTunnel()
