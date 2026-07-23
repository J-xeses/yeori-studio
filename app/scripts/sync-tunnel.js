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
const CLOUDFLARED = path.join(process.env.LOCALAPPDATA, 'cloudflared', 'cloudflared.exe')
const TUNNEL_TARGET = 'http://localhost:3001'
const STATE_PATH = path.join(APP_ROOT, '.tunnel-state.json')
const VERCEL_SCOPE = 'won566800-7736s-projects'
const VERCEL_ENV_VAR = 'MCP_BRIDGE_URL'
const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/

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
const CMD_TIMEOUT_MS = 60_000

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

    proc.stdout.on('data', (d) => { out += d.toString() })
    proc.stderr.on('data', (d) => process.stderr.write(d))
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
      else reject(new Error(`${commandLine} -- 종료 코드 ${code}`))
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

async function updateVercel(newUrl) {
  console.log(`\n[tunnel] URL 변경 감지 -- Vercel ${VERCEL_ENV_VAR} 갱신: ${newUrl}`)

  try {
    await run('vercel', ['env', 'rm', VERCEL_ENV_VAR, 'production', '--yes', '--scope', VERCEL_SCOPE])
  } catch {
    console.log(`[tunnel] 기존 ${VERCEL_ENV_VAR} 없음(최초 설정으로 간주) -- 계속 진행`)
  }

  await run('vercel', ['env', 'add', VERCEL_ENV_VAR, 'production', '--value', newUrl, '--yes', '--scope', VERCEL_SCOPE])

  const deployUrl = await latestReadyProductionUrl()
  console.log(`[tunnel] 재배포 대상: ${deployUrl}`)
  await run('vercel', ['redeploy', deployUrl, '--target', 'production', '--scope', VERCEL_SCOPE])

  console.log('[tunnel] Vercel 갱신 + 재배포 완료\n')
}

function main() {
  if (!fs.existsSync(CLOUDFLARED)) {
    console.error(`[tunnel] cloudflared.exe 없음: ${CLOUDFLARED}`)
    process.exit(1)
  }

  console.log('[tunnel] Cloudflare Quick Tunnel 시작...')
  const child = spawn(CLOUDFLARED, ['tunnel', '--url', TUNNEL_TARGET], { stdio: ['ignore', 'pipe', 'pipe'] })

  let handled = false

  const onData = (buf) => {
    const text = buf.toString('utf-8')
    process.stdout.write(text)
    if (handled) return
    const match = text.match(URL_RE)
    if (!match) return
    handled = true

    const newUrl = match[0]
    const prev = readState()
    console.log(`\n[tunnel] 감지된 터널 URL: ${newUrl}`)

    if (prev?.url === newUrl) {
      console.log('[tunnel] 이전 URL과 동일 -- Vercel 갱신 생략\n')
      return
    }

    updateVercel(newUrl)
      .then(() => writeState(newUrl))
      .catch((err) => {
        console.error(`[tunnel] Vercel 갱신 실패: ${err.message}`)
        console.error('[tunnel] 수동 갱신 필요:')
        console.error(`  vercel env rm ${VERCEL_ENV_VAR} production --yes --scope ${VERCEL_SCOPE}`)
        console.error(`  vercel env add ${VERCEL_ENV_VAR} production --value ${newUrl} --yes --scope ${VERCEL_SCOPE}`)
        console.error(`  vercel redeploy <최신 production 배포 URL> --target production --scope ${VERCEL_SCOPE}`)
      })
  }

  child.stdout.on('data', onData)
  child.stderr.on('data', onData)

  child.on('error', (err) => {
    console.error('[tunnel] cloudflared 실행 실패:', err.message)
    process.exit(1)
  })

  child.on('exit', (code) => {
    console.log(`[tunnel] cloudflared 종료됨 (code ${code})`)
    process.exit(code ?? 0)
  })

  process.on('SIGINT', () => child.kill())
  process.on('SIGTERM', () => child.kill())
}

main()
