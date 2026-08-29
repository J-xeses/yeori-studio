#!/usr/bin/env node
/**
 * task-queue-worker.js — downloads/code-task-queue.json을 확인해서 status가
 * 'approved'(스튜디오 UI의 "코드 작업 승인" 탭에서 사람이 승인)이고 아직 처리
 * 안 된 작업을, 헤드리스 Claude Code(claude -p)로 실제 처리한다.
 *
 * 이 스크립트는 어떤 Claude Code 대화 세션에도 종속되지 않는다 — Windows
 * 작업 스케줄러 등으로 주기 실행하도록 등록해서 쓴다(등록은 이 스크립트가 하지
 * 않음 — 사용자가 직접 스케줄러에 등록). 실행할 때마다 큐를 한 번 확인하고
 * 종료한다(daemon 아님).
 *
 * 안전장치: git push는 --disallowedTools로 기술적으로 차단한다(프롬프트 지시가
 * 아니라 Claude Code 권한 시스템 자체가 그 도구 호출을 막음 — 2026-08-29 확인:
 * deny 규칙이 allow보다 우선 적용됨). 커밋까지는 자동, push는 사람이 직접 하도록
 * 요청받아 이렇게 설계함.
 *
 * 사용법:
 *   node scripts/task-queue-worker.js
 *   node scripts/task-queue-worker.js --dry-run   (실제 claude 호출 없이 큐 상태만 출력)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CODE_ROOT = path.join(__dirname, '..')       // C:\yeori-studio\app
const MEDIA_ROOT = path.join(CODE_ROOT, '..')       // C:\yeori-studio (git root)
const QUEUE_PATH = path.join(MEDIA_ROOT, 'downloads', 'code-task-queue.json')
const LOG_PATH = path.join(MEDIA_ROOT, 'downloads', 'task-queue-worker.log')

const DRY_RUN = process.argv.includes('--dry-run')
// Task Scheduler 환경에서 PATH에 claude가 없을 수 있어 override 가능하게 —
// 필요하면 이 환경변수를 작업 스케줄러 작업의 "환경 변수" 설정에 추가한다.
const CLAUDE_EXE = process.env.TASK_QUEUE_CLAUDE_PATH || 'claude'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
  try { fs.appendFileSync(LOG_PATH, line, 'utf-8') } catch {}
}

function loadQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function saveQueue(tasks) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(tasks, null, 2), 'utf-8')
}

// 헤드리스 Claude에게 이 세션(대화형 Claude Code)에서 자리잡은 관례를 짧게
// 상기시킨다 — 헤드리스 실행은 이 대화 기록을 전혀 모르는 완전히 새 세션이라서.
function buildPrompt(description) {
  return `당신은 여리 스튜디오(C:\\yeori-studio) 저장소를 무인으로 처리하는 자동화 작업자입니다.
사람이 스튜디오 UI("코드 작업 승인" 탭)에서 이미 승인한 작업이니 바로 진행하세요.

작업 지시:
${description}

지켜야 할 것:
- 작업 시작 전에 관련 코드/파일의 현재 상태를 먼저 확인하세요(가정하지 말고 실제로 읽어볼 것).
- 코드 변경 후 가능하면 실제로 검증하세요(문법 체크, 관련 있으면 직접 호출 테스트 등).
- 변경 사항을 git commit까지만 하세요. git push는 절대 하지 마세요(권한 시스템에서도 차단되어
  있지만, 시도조차 하지 마세요 — 사람이 검토 후 직접 push합니다).
- 커밋 메시지는 이 저장소의 최근 커밋 스타일(한글, "무엇을 왜" 위주)을 따르세요.
- 마지막에 무엇을 했는지, 어떤 파일을 바꿨는지, 검증 결과가 어땠는지 간결하게 요약해서 답하세요.`
}

function runClaudeHeadless(promptText) {
  return new Promise((resolve) => {
    // 프롬프트를 인자로 직접 넘기면(shell: true) 여러 줄·공백·괄호가 cmd.exe에서
    // 재파싱돼 첫 토큰만 전달되는 문제가 있어(2026-08-29 실측), 프롬프트는 stdin으로
    // 흘려보낸다. -p(플래그만, 값 없음)로 print 모드를 켜면 claude가 stdin을 프롬프트로 읽는다.
    const args = [
      '-p',
      '--permission-mode', 'dontAsk',
      '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep',
      '--disallowedTools', 'Bash(git push *)',
      '--output-format', 'json',
    ]
    const child = spawn(CLAUDE_EXE, args, {
      cwd: MEDIA_ROOT,
      shell: true,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.write(promptText, 'utf-8')
    child.stdin.end()
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', err => resolve({ ok: false, error: err.message }))
    child.on('close', code => {
      if (code !== 0) {
        resolve({ ok: false, error: `claude 종료 코드 ${code}: ${stderr.slice(-1000) || stdout.slice(-1000)}` })
        return
      }
      try {
        const parsed = JSON.parse(stdout)
        resolve({ ok: true, result: parsed.result || stdout.slice(-2000), cost: parsed.total_cost_usd })
      } catch {
        resolve({ ok: true, result: stdout.slice(-2000) })
      }
    })
  })
}

async function main() {
  const tasks = loadQueue()
  const pending = tasks.filter(t => t.status === 'approved' && !t.completedAt)

  if (!pending.length) {
    log('처리할 승인된 작업 없음 — 종료')
    return
  }

  log(`승인된 작업 ${pending.length}건 발견 — 순차 처리 시작`)

  for (const task of pending) {
    log(`처리 시작: ${task.id} — ${task.description.slice(0, 80)}`)

    if (DRY_RUN) {
      log(`[dry-run] 실제 claude 호출 생략`)
      continue
    }

    const prompt = buildPrompt(task.description)
    const outcome = await runClaudeHeadless(prompt)

    task.completedAt = new Date().toISOString()
    if (outcome.ok) {
      task.status = 'done'
      task.result = outcome.result
      log(`처리 완료: ${task.id}`)
    } else {
      task.status = 'failed'
      task.result = outcome.error
      log(`처리 실패: ${task.id} — ${outcome.error}`)
    }
    saveQueue(tasks) // 작업 하나 끝날 때마다 바로 저장 — 중간에 죽어도 진행 상황 보존
  }

  log('전체 처리 완료')
}

main().catch(err => log(`치명적 오류: ${err.stack || err.message}`))
