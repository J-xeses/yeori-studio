/**
 * 전체 파이프라인 자동화
 * G1(대본) → G2(음성) → G3(이미지) → G4(편집)
 *
 * 사용법:
 *   npm run pipeline                     # 전 단계 순차 실행
 *   npm run pipeline -- --from=g2        # G2부터 시작
 *   npm run pipeline -- --from=g4        # G4만 실행
 *   npm run pipeline -- --skip-confirm   # 확인 없이 자동 연속 실행
 *   npm run pipeline -- --ep=2           # 에피소드 지정 (각 스크립트에 전달)
 *
 * 단계별 확인:
 *   각 단계 완료 후 "다음 단계를 시작할까요?" 확인 → y/N
 *   N 입력 시 해당 단계에서 파이프라인 종료
 */

import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const args = parseArgs()

function parseArgs() {
  return Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
      const [k, v] = a.slice(2).split('=')
      return [k, v ?? true]
    })
  )
}

function log(level, msg) {
  const prefix = { info: 'ℹ️ ', ok: '✅', warn: '⚠️ ', error: '❌', step: '⏳' }
  console.log(`${prefix[level] ?? '  '} ${msg}`)
}

// 공통 인수 (--ep, --prompts 등 하위 스크립트에 그대로 전달)
function passArgs() {
  const passThrough = ['ep', 'prompts', 'cut']
  return passThrough
    .filter(k => args[k] !== undefined && args[k] !== true)
    .map(k => `--${k}=${args[k]}`)
}

function runScript(scriptFile, label) {
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`  ${label}`)
  console.log('═'.repeat(50))
  const result = spawnSync('node', [
    path.join(ROOT, 'scripts', scriptFile),
    ...passArgs(),
  ], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`${label} 실패 (exit code: ${result.status})`)
  }
}

async function askConfirm(question) {
  if (args['skip-confirm']) return true
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(`\n  ${question} (y/N): `, ans => {
      rl.close()
      resolve(ans.trim().toLowerCase() === 'y')
    })
  })
}

function checkG1() {
  const promptsFile = path.join(ROOT, 'downloads', 'flow', 'prompts.json')
  if (!fs.existsSync(promptsFile)) {
    log('error', 'G1 미완료: downloads/flow/prompts.json가 없습니다.')
    log('info', '여리 스튜디오 앱 → 스크립트 탭에서 대본 생성 후 JSON 내보내기를 실행하세요.')
    return false
  }
  const raw = JSON.parse(fs.readFileSync(promptsFile, 'utf-8'))
  const cuts = Array.isArray(raw) ? raw : (raw.cuts ?? [])
  if (!cuts.length) {
    log('warn', 'G1: prompts.json의 cuts가 비어 있습니다.')
    return false
  }
  const ep = raw.episode ?? '?'
  const hasAudio  = cuts.some(c => c.narration?.trim() || c.dialogue?.trim())
  const hasImages = cuts.some(c => c.imagePrompt?.trim())
  log('ok', `G1 확인: EP${ep} — ${cuts.length}컷 (나레이션/대사: ${hasAudio ? '있음' : '없음'}, 이미지 프롬프트: ${hasImages ? '있음' : '없음'})`)
  if (!hasAudio) log('warn', 'narration/dialogue 필드가 없어 G2(TTS)는 건너뛸 수 있습니다.')
  return true
}

const STAGES = [
  {
    id:     'g1',
    label:  'G1 — 대본 확인',
    check:  true,
  },
  {
    id:     'g2',
    label:  'G2 — 음성 생성 (ElevenLabs TTS)',
    script: 'tts-automation.js',
    desc:   '나레이션·대사를 ElevenLabs API로 음성 파일 생성',
  },
  {
    id:     'g3',
    label:  'G3 — 이미지 생성 (Google Flow)',
    script: 'flow-automation.js',
    desc:   'Chrome을 열고 Google Flow에서 컷 이미지 자동 생성',
  },
  {
    id:     'g4',
    label:  'G4 — 영상 편집 (FFmpeg)',
    script: 'edit-automation.js',
    desc:   '이미지 + 음성을 합성하고 최종 영상으로 합치기',
  },
]

async function main() {
  console.log('\n' + '━'.repeat(50))
  console.log('  🎬 여리 스튜디오 - 전체 파이프라인')
  console.log('  G1 대본 → G2 음성 → G3 이미지 → G4 편집')
  console.log('━'.repeat(50) + '\n')

  const fromId  = (args.from ?? 'g1').toLowerCase()
  const fromIdx = STAGES.findIndex(s => s.id === fromId)
  if (fromIdx < 0) {
    log('error', `알 수 없는 시작 단계: "${args.from}". g1~g4 중 선택하세요.`)
    process.exit(1)
  }

  const stages = STAGES.slice(fromIdx)
  let pipelineOk = true

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]

    // G1: 파일 존재 확인만
    if (stage.check) {
      if (!checkG1()) { process.exit(1) }
      continue
    }

    // 다음 단계 진행 여부 확인
    console.log(`\n  다음 단계: ${stage.label}`)
    if (stage.desc) console.log(`  설명: ${stage.desc}`)
    const go = await askConfirm(`✨ ${stage.label}을(를) 시작할까요?`)
    if (!go) {
      log('info', `${stage.label} 건너뜀 → 파이프라인 종료`)
      pipelineOk = false
      break
    }

    try {
      runScript(stage.script, stage.label)
      log('ok', `${stage.label} 완료`)
    } catch (err) {
      log('error', err.message)
      const cont = await askConfirm('오류가 발생했습니다. 다음 단계로 계속할까요?')
      if (!cont) { pipelineOk = false; break }
    }
  }

  console.log('\n' + '━'.repeat(50))
  console.log(pipelineOk ? '  ✅ 파이프라인 완료' : '  ⏹️  파이프라인 중단')
  console.log('━'.repeat(50) + '\n')
}

main().catch(err => {
  log('error', `치명적 오류: ${err.message}`)
  process.exit(1)
})
