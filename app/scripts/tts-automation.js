/**
 * G2 자동화 - ElevenLabs TTS 음성 생성
 *
 * 사용법:
 *   npm run tts                        # downloads/flow/prompts.json 기반
 *   npm run tts -- --ep=2              # 에피소드 지정
 *   npm run tts -- --cut=3             # 특정 컷만
 *   npm run tts -- --dry               # 텍스트 확인만 (실제 생성 안 함)
 *   npm run tts -- --prompts=my.json  # 외부 프롬프트 파일 지정
 *
 * .env.local 필수:
 *   ELEVENLABS_API_KEY=sk-...
 *   ELEVENLABS_VOICE_ID=...   (없으면 "Sian" 이름으로 자동 검색)
 *
 * prompts.json 컷 필드:
 *   narration: "나레이션 텍스트"
 *   dialogue:  "대사 텍스트"   (없으면 "없음" 또는 생략)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

;['.env', '.env.local'].forEach(name => {
  const envPath = path.join(ROOT, name)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '')
  })
})

const CONFIG = {
  downloadDir:  path.join(ROOT, 'downloads'),
  voiceName:    '서여리',
  voiceId:      process.env.ELEVENLABS_VOICE_ID ?? 'RmYuvmCbqOMBJxDLW4k8',
  stability:    0.35,
  similarity:   0.75,
  style:        0.40,
  speed:        1.0,
  modelId:      'eleven_multilingual_v2',
  apiKey:       process.env.ELEVENLABS_API_KEY ?? '',
  ffprobe:      process.env.FFPROBE_PATH ?? 'ffprobe',
  delayMs:      300,
}

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function loadPrompts() {
  const file = args.prompts
    ? path.resolve(args.prompts)
    : path.join(CONFIG.downloadDir, 'flow', 'prompts.json')

  if (!fs.existsSync(file)) {
    log('error', `프롬프트 파일 없음: ${file}`)
    log('info', '여리 스튜디오 → 스크립트 탭에서 대본 생성 후 JSON 내보내기를 먼저 실행하세요.')
    process.exit(1)
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const episode = raw.episode ?? null
  const cuts = (Array.isArray(raw) ? raw : raw.cuts ?? [])
    .filter(c => !args.ep  || String(c.episode ?? episode) === String(args.ep))
    .filter(c => !args.cut || String(c.no) === String(args.cut))

  return { episode, cuts }
}

function buildText(cut) {
  const parts = []
  if (cut.narration?.trim()) parts.push(cut.narration.trim())
  if (cut.dialogue?.trim() && !/^없음$/i.test(cut.dialogue.trim())) {
    parts.push(cut.dialogue.trim())
  }
  return parts.join('\n')
}

async function resolveVoiceId() {
  if (CONFIG.voiceId) return CONFIG.voiceId

  log('info', `ElevenLabs에서 "${CONFIG.voiceName}" 음성 검색 중…`)
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': CONFIG.apiKey },
  })
  if (!res.ok) throw new Error(`음성 목록 조회 실패: ${res.status}`)
  const data = await res.json()

  const voice = data.voices?.find(v =>
    v.name.toLowerCase().includes(CONFIG.voiceName.toLowerCase())
  )
  if (!voice) {
    log('warn', `"${CONFIG.voiceName}" 음성 못 찾음. 사용 가능한 목소리:`)
    data.voices?.slice(0, 15).forEach(v => console.log(`    ${v.voice_id}  ${v.name}`))
    log('info', '.env.local에 ELEVENLABS_VOICE_ID=<위 ID 중 선택>을 추가하세요.')
    throw new Error(`음성 "${CONFIG.voiceName}"을 찾지 못했습니다`)
  }
  log('ok', `음성 찾음: ${voice.name} (${voice.voice_id})`)
  return voice.voice_id
}

async function generateTTS(text, voiceId, outputPath) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': CONFIG.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: CONFIG.modelId,
      speed: CONFIG.speed,
      voice_settings: {
        stability:         CONFIG.stability,
        similarity_boost:  CONFIG.similarity,
        style:             CONFIG.style,
        use_speaker_boost: true,
      },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 300)}`)
  }
  fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()))
}

function getAudioDuration(filePath) {
  try {
    const out = execSync(
      `"${CONFIG.ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    return Math.round(parseFloat(out) * 10) / 10 || 0
  } catch {
    return 0
  }
}

async function main() {
  if (!CONFIG.apiKey) {
    log('error', 'ELEVENLABS_API_KEY 없음. .env.local에 추가하세요.')
    process.exit(1)
  }

  const { episode, cuts } = loadPrompts()

  const cutsWithText = cuts.map(c => ({ ...c, _text: buildText(c) })).filter(c => c._text)
  const cutsNoText   = cuts.filter(c => !buildText(c))

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  🎙️  여리 스튜디오 - G2 TTS 자동화')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  if (episode != null) console.log(`  에피소드: ${episode}`)
  console.log(`  처리 컷:  ${cutsWithText.length}개 (텍스트 없음: ${cutsNoText.length}개 건너뜀)`)
  console.log(`  저장 위치: downloads/audio/ep${episode}/`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (cutsNoText.length) {
    log('warn', `narration/dialogue 없는 컷: ${cutsNoText.map(c => `CUT ${c.no}`).join(', ')}`)
    log('info', 'prompts.json 컷에 narration/dialogue 필드를 추가하면 해당 컷도 생성됩니다.')
  }

  if (!cutsWithText.length) {
    log('warn', '생성할 텍스트가 없습니다. prompts.json에 narration/dialogue를 추가하세요.')
    return
  }

  if (args.dry) {
    cutsWithText.forEach(c => console.log(`  CUT ${c.no}: "${c._text.replace(/\n/g, ' ').slice(0, 90)}…"`))
    return
  }

  const voiceId  = await resolveVoiceId()
  const audioDir = path.join(CONFIG.downloadDir, 'audio', `ep${episode}`)
  ensureDir(audioDir)

  const timing = []
  let ok = 0, fail = 0

  for (let i = 0; i < cutsWithText.length; i++) {
    const cut     = cutsWithText[i]
    const label   = `[${i + 1}/${cutsWithText.length}] CUT ${cut.no}`
    const outPath = path.join(audioDir, `cut_${String(cut.no).padStart(2, '0')}.mp3`)

    log('step', `${label} 생성 중… (${cut._text.replace(/\n/g, ' ').slice(0, 40)}…)`)
    try {
      await generateTTS(cut._text, voiceId, outPath)
      const duration = getAudioDuration(outPath)
      timing.push({ cutNo: cut.no, file: path.relative(ROOT, outPath), duration })
      log('ok', `${label} → ${path.relative(ROOT, outPath)} (${duration}초)`)
      ok++
    } catch (err) {
      log('error', `${label} 실패: ${err.message}`)
      timing.push({ cutNo: cut.no, error: err.message, duration: 0 })
      fail++
    }

    if (i < cutsWithText.length - 1) await sleep(CONFIG.delayMs)
  }

  const reportPath = path.join(audioDir, `report_ep${episode}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(
    { episode, generatedAt: new Date().toISOString(), voiceId: CONFIG.voiceId, timing },
    null, 2
  ))
  log('info', `리포트 저장: ${path.relative(ROOT, reportPath)}`)

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  완료: ✅ ${ok}개 성공 / ❌ ${fail}개 실패`)
  const total = timing.reduce((s, t) => s + (t.duration || 0), 0)
  console.log(`  전체 음성 길이: ${total.toFixed(1)}초`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main().catch(err => {
  log('error', `치명적 오류: ${err.message}`)
  process.exit(1)
})
