// 음성 검수(Voice QA) — 영상 클립의 대사가 대본과 맞는지, 발음·애드립 문제가 없는지 음성 인식으로 확인한다(2026-09-21).
//
// 배경: Veo 가 만든 대사 음성은 영상과 립싱크가 잘 맞지만 간헐적으로 발음이 틀리거나(예: "중심으로"→"중십프로"), 대사가 짧으면
//       엉뚱한 애드립을 한다. STS 는 이런 발음 오류를 고치지 못하고(2026-09-21 실측: 오류가 그대로 옮겨지거나 새로 틀림) 억양·발음을
//       입력 음성 그대로 따라가므로, 발음이 맞는 컷은 원본을 그대로 쓰고 틀린 컷만 재생성/교체하는 편이 낫다 → 그 판정을 자동화한다.
//
// 방식: 클립 오디오 → ElevenLabs STT(scribe_v1, 단어별 시각·신뢰도) → 대본과 비교
//   ① 글자 유사도(공백·문장부호 제거)  ② 대본에 없는 발음 단어  ③ 대본에서 빠졌거나 다르게 들린 단어
//   ④ 신뢰도가 낮은 단어(logprob)  ⑤ 대사가 없는 컷인데 말소리가 있음(애드립)
// 결과 verdict: ok(원본 사용 가능) | warn(귀로 확인 권장) | fail(재생성/교체 권장). 어디까지나 "검수 보조"이며 최종 판단은 사람이 한다.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'

// 판정 기준(2026-09-21 실측으로 잡은 초깃값 — 표본이 늘면 조정): 서여리 정상 컷은 일치율 1.00·최저 신뢰도 -0.03 이내,
// 발음 오류 컷은 오류 단어 신뢰도 -0.19~-0.37 이었다.
export const QA_THRESHOLDS = { okRatio: 0.97, failRatio: 0.85, lowLogprob: -0.15, veryLowLogprob: -0.3 }

const norm = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/[^가-힣A-Za-z0-9]/g, '').toLowerCase()

// 편집 거리 기반 유사도(0~1)
export function similarity(a, b) {
  a = norm(a); b = norm(b)
  if (!a && !b) return 1
  if (!a || !b) return 0
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

// 대본 대사 문자열 → 어절 목록. "화자 \"대사\" || 대사" 같은 표기에서 따옴표·화자·구분자를 걷어낸다.
export function expectedWords(dialogue) {
  const text = String(dialogue || '').replace(/\|\|/g, ' ').replace(/^\s*[가-힣A-Za-z]{2,6}\s*["“”'‘’]/gm, ' ').replace(/["“”'‘’]/g, ' ')
  return text.split(/\s+/).map(norm).filter(Boolean)
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', d => { err += d })
    p.on('error', reject)
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} 종료코드 ${code}: ${err.slice(0, 200)}`)))
  })
}

async function transcribe(wavPath, apiKey, { diarize = false } = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), 'a.wav')
  fd.append('model_id', 'scribe_v1')
  fd.append('language_code', 'kor')
  fd.append('timestamps_granularity', 'word')
  fd.append('tag_audio_events', 'false')
  if (diarize) fd.append('diarize', 'true')
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': apiKey }, body: fd })
  if (!r.ok) throw new Error(`STT API ${r.status}: ${(await r.text()).slice(0, 160)}`)
  return r.json()
}

// 클립 하나 검수. expected: 그 컷(구간)의 대본 대사 — 비어 있으면 "말하지 않아야 하는 컷"으로 본다.
export async function checkClip({ videoPath, expected = '', apiKey, diarize = false, partial = false }) {
  if (!apiKey) throw new Error('ElevenLabs API 키가 없습니다')
  if (!fs.existsSync(videoPath)) throw new Error(`파일 없음: ${videoPath}`)
  const tmp = path.join(os.tmpdir(), `vqa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`)
  try {
    await run(FFMPEG, ['-v', 'error', '-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', tmp])
    const j = await transcribe(tmp, apiKey, { diarize })
    const words = (j.words || []).filter(w => w.type === 'word').map(w => ({
      text: w.text, start: +(w.start ?? 0).toFixed(2), end: +(w.end ?? 0).toFixed(2), logprob: +(w.logprob ?? 0).toFixed(2), speaker: w.speaker_id ?? null,
    }))
    const heard = String(j.text || '').replace(/\[[^\]]*\]/g, '').trim()
    const exp = expectedWords(expected)
    const expJoined = exp.join('')
    const heardJoined = norm(heard)
    const flags = []
    const T = QA_THRESHOLDS

    const hasExpected = exp.length > 0
    const ratio = hasExpected ? similarity(exp.join(' '), heard) : (heardJoined ? 0 : 1)

    if (!hasExpected) {
      if (words.length) flags.push({ kind: 'adlib', severity: 'fail', message: `대사가 없는 컷인데 말소리가 들립니다: "${heard}"` })
    } else {
      if (!words.length) flags.push({ kind: 'silent', severity: 'fail', message: '대사가 있어야 하는 컷인데 말소리를 인식하지 못했습니다' })
      // 들린 단어가 대본 어디에도 없으면 "대본에 없는 발음"
      for (const w of words) {
        const n = norm(w.text)
        if (n && !expJoined.includes(n)) flags.push({ kind: 'unexpected-word', severity: 'warn', word: w.text, at: w.start, logprob: w.logprob, message: `대본에 없는 발음: "${w.text}" (${w.start}s)` })
      }
      // 대본 어절이 들린 결과에 없으면 "빠졌거나 다르게 들림"
      for (const e of (partial ? [] : exp)) {   // partial: 컷의 대사 일부만 담긴 클립(다중 클립 컷)이라 "빠진 단어"는 판단하지 않는다
        if (!heardJoined.includes(e)) flags.push({ kind: 'missing-word', severity: 'warn', word: e, message: `대본 어절이 들린 결과에 없음: "${e}"` })
      }
    }
    // 신뢰도가 낮은 단어(대본과 일치해도 발음이 불분명했을 수 있음)
    for (const w of words) {
      if (w.logprob <= T.veryLowLogprob) flags.push({ kind: 'low-confidence', severity: 'warn', word: w.text, at: w.start, logprob: w.logprob, message: `인식 신뢰도 매우 낮음: "${w.text}" (${w.logprob})` })
      else if (w.logprob <= T.lowLogprob) flags.push({ kind: 'low-confidence', severity: 'note', word: w.text, at: w.start, logprob: w.logprob, message: `인식 신뢰도 낮음: "${w.text}" (${w.logprob})` })
    }
    // 대사가 있는데 여러 명이 말한 것으로 인식되면(diarize 사용 시) 알림
    if (diarize) {
      const sp = new Set(words.map(w => w.speaker).filter(Boolean))
      if (sp.size > 1) flags.push({ kind: 'multi-speaker', severity: 'note', message: `화자 ${sp.size}명이 인식됨 — 한 명만 말해야 하는 컷인지 확인` })
    }

    let verdict = 'ok'
    if (flags.some(f => f.severity === 'fail') || (hasExpected && !partial && ratio < T.failRatio)) verdict = 'fail'
    else if (flags.some(f => f.severity === 'warn') || (hasExpected && !partial && ratio < T.okRatio)) verdict = 'warn'
    return { verdict, ratio: +ratio.toFixed(3), heard, expected: exp.join(' '), words, flags, checkedAt: new Date().toISOString() }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* noop */ }
  }
}

// 검수 결과 저장소: downloads/state/voice-qa.json  { [episodeCode]: { [cutNo]: { [clipKey]: result } } }
export function loadQa(file) { try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return {} } }
export function saveQa(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8') }
