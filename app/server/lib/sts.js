// STS(speech-to-speech) 후처리 — Veo 대사 영상의 목소리를 캐릭터(서여리·한지아…) 음성으로 변환.
//
//   ① demucs --two-stems=vocals  → 대사(cut_NN_voice.mp3) + 배경음(cut_NN_background.mp3) 분리
//   ② ElevenLabs /v1/speech-to-speech/{voiceId}  (eleven_multilingual_sts_v2)
//      → cut_NN_voice_<char>.mp3  (타이밍·립싱크 보존, 음색만 교체)
//   ③ FFmpeg [1:a][2:a]amix  → 영상 + 변환음성 + 배경음 3트랙 합성 → cut_NN_final.mp4
//
// 원본: scripts/test-sts.js (단독 테스트, 2026-06-23). 이걸 프록시/파이프라인이 재사용하도록 라이브러리화.
// 실행 요건: pip install demucs, C:\ffmpeg\bin\ffmpeg.exe, ELEVENLABS_API_KEY

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import * as mp from './mediaPaths.js'

// 프록시 다른 곳과 동일하게 PATH 의 ffmpeg 사용 (스튜디오는 WinGet ffmpeg 를 PATH 로 씀).
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const STS_MODEL = 'eleven_multilingual_sts_v2'

function run(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let err = ''
    p.stdout.on('data', (c) => onLog?.(c.toString().trim()))
    p.stderr.on('data', (c) => { const s = c.toString(); err += s; onLog?.(s.trim()) })
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exit ${code}: ${err.slice(-300)}`))))
    p.on('error', (e) => reject(new Error(`${path.basename(cmd)} 실행 실패: ${e.message}`)))
  })
}

// characters.json + ttsSettings 로 캐릭터명 → { id, name, voiceId } 해석.
// characters = loadCharacters() 결과, speakerVoices = state.ttsSettings.speakerVoices
export function resolveVoice({ character, voiceId, characters = {}, speakerVoices = {}, defaultVoiceId }) {
  if (voiceId) return { voiceId, source: 'explicit' }
  const key = String(character || '').trim()
  if (key) {
    // characters.json 직접 매칭 (id / name / aliases)
    const K = key.toUpperCase()
    for (const [id, c] of Object.entries(characters)) {
      if (id.toUpperCase() === K || String(c.name || '').toUpperCase() === K ||
          (c.aliases || []).some((a) => String(a).toUpperCase() === K)) {
        if (c.voiceId) return { voiceId: c.voiceId, id, name: c.name || id, source: 'characters.json' }
      }
    }
    // ttsSettings.speakerVoices 느슨 매칭 (지아 ↔ 한지아)
    if (speakerVoices[key]) return { voiceId: speakerVoices[key], name: key, source: 'speakerVoices' }
    const sk = Object.keys(speakerVoices).find((k) => k.includes(key) || key.includes(k))
    if (sk) return { voiceId: speakerVoices[sk], name: sk, source: 'speakerVoices~' }
  }
  // primary 캐릭터 → 없으면 기본
  const primary = Object.entries(characters).find(([, c]) => c.primary && c.voiceId)
  if (primary) return { voiceId: primary[1].voiceId, id: primary[0], name: primary[1].name || primary[0], source: 'primary' }
  return { voiceId: defaultVoiceId, name: '기본', source: 'default' }
}

// { epNum, cutNo, voiceId, apiKey, onLog, charTag } → { ok, finalPath, files } / throw
export async function runSts({ epNum, cutNo, voiceId, apiKey, onLog, charTag = 'conv' }) {
  const log = (m) => onLog?.(m)
  const padded = String(cutNo).padStart(2, '0')
  const videoDir = mp.videoDir(epNum)
  const audioDir = mp.audioDir(epNum)
  const videoPath = path.join(videoDir, `cut_${padded}.mp4`)
  const voicePath = path.join(audioDir, `cut_${padded}_voice.mp3`)
  const bgPath = path.join(audioDir, `cut_${padded}_background.mp3`)
  const convPath = path.join(audioDir, `cut_${padded}_voice_${charTag}.mp3`)
  const finalPath = path.join(videoDir, `cut_${padded}_final.mp4`)

  if (!apiKey) throw new Error('ELEVENLABS_API_KEY 없음')
  if (path.isAbsolute(FFMPEG) && !fs.existsSync(FFMPEG)) throw new Error(`FFmpeg 없음: ${FFMPEG}`)
  if (!fs.existsSync(videoPath)) throw new Error(`입력 영상 없음: cut_${padded}.mp4 (${videoDir})`)
  if (!voiceId) throw new Error('voiceId 없음')
  fs.mkdirSync(audioDir, { recursive: true })

  // 오디오 트랙 있는지 먼저 확인 (없으면 demucs 가 난해한 에러를 냄)
  const probe = await new Promise((resolve) => {
    let out = ''
    const pp = spawn(FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'), [
      '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', videoPath,
    ])
    pp.stdout.on('data', (c) => { out += c })
    pp.on('close', () => resolve(out.trim()))
    pp.on('error', () => resolve('?'))
  })
  if (probe === '') throw new Error(`cut_${padded}.mp4 에 오디오 트랙이 없습니다 — 대사가 들어간 Veo 영상이 필요합니다 (무음 영상은 STS 대상 아님)`)

  // ① demucs
  log(`[1/3] demucs 음원 분리 — cut_${padded}.mp4`)
  const demucsOut = path.join(audioDir, 'demucs')
  const stem = path.basename(videoPath, path.extname(videoPath))
  fs.mkdirSync(demucsOut, { recursive: true })
  await run('python', ['-m', 'demucs', '--two-stems=vocals', '--mp3', '-o', demucsOut, videoPath], log)
  const dv = path.join(demucsOut, 'htdemucs', stem, 'vocals.mp3')
  const dn = path.join(demucsOut, 'htdemucs', stem, 'no_vocals.mp3')
  if (!fs.existsSync(dv)) throw new Error(`demucs 결과 없음: ${dv}`)
  fs.copyFileSync(dv, voicePath)
  fs.copyFileSync(dn, bgPath)
  log(`  대사 ${(fs.statSync(voicePath).size / 1024).toFixed(0)}KB · 배경음 ${(fs.statSync(bgPath).size / 1024).toFixed(0)}KB`)

  // ② ElevenLabs STS
  log(`[2/3] ElevenLabs STS (${STS_MODEL}, voice ${voiceId})`)
  const buf = fs.readFileSync(voicePath)
  const fd = new FormData()
  fd.append('audio', new Blob([buf], { type: 'audio/mpeg' }), 'voice.mp3')
  fd.append('model_id', STS_MODEL)
  fd.append('voice_settings', JSON.stringify({ stability: 0.30, similarity_boost: 0.75, speed: 1.0 }))
  const r = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}`, {
    method: 'POST', headers: { 'xi-api-key': apiKey }, body: fd,
  })
  if (!r.ok) throw new Error(`STS API ${r.status}: ${(await r.text()).slice(0, 200)}`)
  fs.writeFileSync(convPath, Buffer.from(await r.arrayBuffer()))
  log(`  변환 완료 ${(fs.statSync(convPath).size / 1024).toFixed(0)}KB → ${path.basename(convPath)}`)

  // ③ FFmpeg 3트랙 합성
  log(`[3/3] FFmpeg 3트랙 합성 → cut_${padded}_final.mp4`)
  await run(FFMPEG, [
    '-y', '-i', videoPath, '-i', convPath, '-i', bgPath,
    '-filter_complex', '[1:a][2:a]amix=inputs=2:normalize=0[aout]',
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', finalPath,
  ], log)
  log(`  ✅ ${path.basename(finalPath)} (${(fs.statSync(finalPath).size / 1048576).toFixed(1)}MB)`)

  return {
    ok: true,
    finalPath,
    files: {
      video: `cut_${padded}.mp4`, voice: path.basename(voicePath),
      background: path.basename(bgPath), converted: path.basename(convPath),
      final: path.basename(finalPath),
    },
  }
}
