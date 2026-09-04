// ── 릴스 최종화 모듈 ────────────────────────────────────────────────
// 파싱된 컷(scriptParserV3) + downloads/.../05_video/cut_NN.mp4 를 받아
//   컷별 편집 판단(레터박스 여부 · 자막 번인 · 효과음) → 규격화 → concat →
//   자막 .ass 번인 → 효과음/BGM 믹스 → 07_output/{CODE}_final.mp4
// 를 만든다. 판단 내역은 {CODE}_finalize.json 으로 남긴다.
//
// 호출: finalizeReel({ epNum, cuts, bgmFile?, onLog? })
//   cuts: parseCutsV3() 결과 배열 (proxy 가 ep.cuts 를 넘김)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import * as mp from './mediaPaths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 손글씨체 — 레퍼런스(0808.mp4) 스타일. app/assets/fonts 번들.
const FONT = 'Gaegu'
const FONTS_SRC = path.join(__dirname, '..', '..', 'assets', 'fonts')          // Gaegu-Bold.ttf 등
const EMOJI_FONT_WIN = 'C:\\Windows\\Fonts\\seguiemj.ttf'                       // 컬러 이모지 폴백(COLR/CPAL)

// ── 효과음 규칙: 대본 "효과음:" 텍스트의 키워드 → _shared/sfx 파일 ──────
// at: 'start' | 'mid' | 'end'  (컷 구간 내 배치 지점)
const SFX_RULES = [
  { kw: /타이핑|키보드|typing|keyboard/i, file: 'ambience/mixkit-keyboard-typing-1386.wav', at: 'start', gain: 0.4, maxDur: 4.5 },
  { kw: /깜짝|반전|surprise|충격|띠용|실패|fail/i, file: 'comedy/mixkit-fail-drum-and-xylophone-568.wav', at: 'mid', gain: 0.85 },
  { kw: /분할\s*전환|화면\s*전환|전환\s*효과|transition|switch|스위치/i, file: 'pop/mixkit-long-pop-2358.wav', at: 'start', gain: 0.55 },
  { kw: /하트|별|팝업|pop|bell|벨|딩/i, file: 'click/mixkit-toy-drums-and-bell-ding-560.wav', at: 'start', gain: 0.55 },
  { kw: /클릭|click|셔터|shutter/i, file: 'click/mixkit-select-click-1109.wav', at: 'start', gain: 0.6 },
  { kw: /whoosh|swoosh|스와이프|swipe|휙/i, file: 'whoosh/swoosh.wav', at: 'start', gain: 0.5 },
  { kw: /긴장|서스펜스|suspense|tension/i, file: 'tension/mixkit-cinematic-suspense-swell-786.wav', at: 'start', gain: 0.45 },
  { kw: /글리치|glitch|오류|버그/i, file: 'irony/mixkit-small-electric-glitch-2595.wav', at: 'mid', gain: 0.6 },
]
// "정적"/"없음" 은 효과음 없음
const SFX_NONE = /^\s*(없음|정적|무음|-|n\/?a)?\s*$|정적\s*\d/i

// ── 대본에서 컷별 CP(자막) · 오디오(BGM/음성/효과음) 보강 ──────────────
// scriptParserV3 는 v3.0 포맷(오디오 헤더에 콜론 없음, BGM 이 열0, CP 가 KR 블록에만 존재)의
// 자막·오디오를 못 뽑는다. 여기서 raw 를 직접 훑어 컷별로 채운다(있는 값은 안 덮음).
export function enrichCutsFromScript(cuts, raw) {
  if (!raw) return cuts
  const blocks = {}
  const parts = raw.split(/^\[CUT\s+(\d+)\]/m)
  // parts: [pre, "1", body1, "2", body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    blocks[Number(parts[i])] = parts[i + 1] || ''
  }
  const pick = (body, re) => { const m = body.match(re); return m ? m[1].trim() : '' }
  const notNone = (s) => s && !/^(없음|-|n\/?a|\(작성 필요\))/i.test(s.trim())

  return cuts.map((c) => {
    const body = blocks[c.no]
    if (!body) return c
    const cp = pick(body, /CP\s*\(자막\)\s*[:：]\s*(.+)/)
      || pick(body, /^\s*CP\s*[:：]\s*(.+)/m)
    const nr = pick(body, /NR\s*\(나레이션\)\s*[:：]\s*(.+)/)
      || pick(body, /^\s*NR\s*[:：]\s*(.+)/m)
    // 오디오 블록 — "오디오" 헤더(콜론 유무 무관) 다음의 BGM/음성/효과음/앰비언스 줄
    const audioSeg = body.split(/(?:^|\n)\s*오디오\s*[:：]?\s*\n/).slice(1).join('\n')
    const ax = (label) => pick(audioSeg || body, new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*(.+)`))
    const merged = { ...c }
    if (!notNone(merged.subtitle) && notNone(cp)) merged.subtitle = cp
    if (!notNone(merged.narration) && notNone(nr)) merged.narration = nr
    const mc = { ...(merged.masterCode || {}) }
    const audio = { ...(mc.audio || { bgm: '', voice: '', sfx: '', ambience: '' }) }
    if (!audio.bgm) audio.bgm = ax('BGM')
    if (!audio.voice) audio.voice = ax('음성')
    if (!audio.sfx) audio.sfx = ax('효과음')
    if (!audio.ambience) audio.ambience = ax('앰비언스')
    mc.audio = audio
    merged.masterCode = mc
    return merged
  })
}

// ── 자막 스타일 (ass) ───────────────────────────────────────────────
function assHeader() {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${FONT},66,&H00FFFFFF,&H00FFFFFF,&H00303030,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,80,80,220,1
Style: Punch,${FONT},72,&H003C3CF5,&H00FFFFFF,&H00FFFFFF,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,2,80,80,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
}

function assTime(sec) {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = (s % 60)
  return `${h}:${String(m).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')}`
}

// 이모지는 유지한다(레퍼런스 스타일). seguiemj.ttf 폴백으로 컬러 렌더.
// variation selector(FE0F)·ZWJ(200D)만 정리 — libass 에서 폭 계산이 어긋날 수 있어서.
function cleanCaption(s) {
  return String(s).replace(/[\u{FE0F}\u{FE0E}]/gu, '').replace(/\s{2,}/g, ' ').trim()
}

// ── 컷별 편집 판단 ──────────────────────────────────────────────────
export function decideCut(cut) {
  const mc = cut.masterCode || {}
  const sp = String(mc.sp || '')
  const sh = String(mc.sh || '')
  const md = String(mc.md || '')
  const scene = `${cut.scene || ''} ${cut.action || ''}`
  const audio = mc.audio || {}

  // fit: 화면녹화(데스크톱 웹앱) 컷은 잘림 없이 레터박스, 나머지는 채움
  const isScreen = /IN\.SC|화면\s*녹화|화면녹화|screen\s*rec/i.test(sp + scene) || /SH_SCR/i.test(sh)
  const fit = isScreen ? 'contain' : 'cover'

  // caption: CP(자막) 있고, 그래픽이 자체 텍스트를 렌더하는 컷(SH_TEXT)만 아니면 번인
  const cp = String(cut.subtitle || '').trim()
  const graphicSelfText = cut.cutType === 'GRAPHIC' && /SH_TEXT/i.test(sh)
  let caption = null
  if (cp && !graphicSelfText) {
    // 반전/멀티스텝 판정 → 해당 세그먼트만 Punch(빨강)
    const isPunch = (/SUR/i.test(md) && /(COM|WRM)/i.test(md)) || /반전|twist|잠깐/i.test(scene + cp)
    // "1단계: X / 2단계: Y" 또는 "X / Y" → 세그먼트
    const rawSegs = cp.split(/\s*\/\s*/).map((t) => t.replace(/^\s*\d+\s*단계\s*[:：]\s*/, '').trim()).filter(Boolean)
    const segs = rawSegs.length ? rawSegs : [cp]
    caption = {
      style: isPunch && segs.length === 1 ? 'Punch' : 'Cap', // 하위호환(단일 세그)
      segments: segs.map((t, i) => {
        // 멀티세그 + 반전이면 마지막(펀치라인)만 빨강, 앞은 흰색
        const segStyle = isPunch ? (segs.length === 1 || i === segs.length - 1 ? 'Punch' : 'Cap') : 'Cap'
        let burn = cleanCaption(t)
        if (/\s→\s/.test(burn) && burn.length > 16) burn = burn.replace(/\s→\s/, ' →\\N') // 화살표 뒤 줄바꿈
        burn = `"${burn}"`   // 레퍼런스 스타일 — 따옴표로 감싸기
        return { raw: t, burn, style: segStyle }
      }),
    }
  }

  // sfx: "효과음:" 텍스트 키워드 매칭
  const sfxText = String(audio.sfx || '')
  const sfx = []
  if (!SFX_NONE.test(sfxText)) {
    for (const rule of SFX_RULES) {
      if (rule.kw.test(sfxText)) {
        sfx.push({ file: rule.file, at: rule.at, gain: rule.gain, maxDur: rule.maxDur || null, reason: sfxText })
        break // 컷당 1개
      }
    }
  }

  return {
    no: cut.no,
    cutType: cut.cutType,
    durSec: Number(cut.duration) || 8,
    fit,
    caption,
    sfx,
    bgmText: String(audio.bgm || ''),
  }
}

// ── ffmpeg 실행 ────────────────────────────────────────────────────
function ff(args, opts = {}) {
  return new Promise((resolve, reject) => {
    // -y 필수 — 없으면 출력 파일이 이미 있을 때 "Overwrite? [y/N]" 프롬프트에서 영구 정지한다.
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'], ...opts })
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-500)}`))))
  })
}
function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('close', () => resolve(parseFloat(out.trim()) || 0))
    p.on('error', () => resolve(0))
  })
}

function normVf(fit, w = 1080, h = 1920) {
  return fit === 'contain'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`
}

// ── 메인 ───────────────────────────────────────────────────────────
/**
 * @param {object} p
 *   epNum   : 에피소드 번호 (경로 해석용)
 *   cuts    : parseCutsV3() 결과 배열
 *   bgmFile : (선택) BGM 파일 절대경로 또는 _shared/bgm 상대경로
 *   onLog   : (선택) 진행 로그 콜백 (line)
 */
export async function finalizeReel(p) {
  const { epNum, cuts, bgmFile, onLog } = p
  const log = (m) => { try { onLog && onLog(m) } catch { /* noop */ } }
  const code = mp.resolveCode(epNum)
  const vdir = mp.videoDir(epNum)
  const fdir = mp.finalDir(epNum)
  const mdir = mp.makingDir(epNum)
  fs.mkdirSync(fdir, { recursive: true })
  fs.mkdirSync(mdir, { recursive: true })

  if (!Array.isArray(cuts) || !cuts.length) throw new Error('cuts 가 비어있음 — 대본 파싱 결과를 넘기세요')

  // 1) 컷별 판단 + 파일 확인
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelfin_'))
  const decisions = []
  let cursor = 0
  for (const cut of cuts.slice().sort((a, b) => a.no - b.no)) {
    const src = path.join(vdir, `cut_${String(cut.no).padStart(2, '0')}.mp4`)
    if (!fs.existsSync(src)) { log(`⚠ cut_${String(cut.no).padStart(2, '0')}.mp4 없음 — 건너뜀`); continue }
    const d = decideCut(cut)
    const realDur = await ffprobeDuration(src)
    d.durSec = realDur > 0 ? realDur : d.durSec
    d.startSec = cursor
    d.src = src
    cursor += d.durSec
    decisions.push(d)
    const capDesc = !d.caption ? 'skip'
      : d.caption.segments.map((s) => (s.style === 'Punch' ? '빨강' : '흰')).join('+')
    log(`컷 ${d.no}: ${d.fit === 'contain' ? '레터박스' : '채움'} · 자막 ${capDesc} · SFX ${d.sfx.length ? d.sfx.map((s) => path.basename(s.file)).join(',') : '-'} · ${d.durSec.toFixed(1)}s`)
  }
  if (!decisions.length) throw new Error('사용 가능한 cut_NN.mp4 가 하나도 없습니다')
  const totalDur = cursor

  // 2) 각 컷 규격화 + 무음 오디오
  const listLines = []
  for (const d of decisions) {
    const out = path.join(tmp, `n_${String(d.no).padStart(2, '0')}.mp4`)
    await ff(['-i', d.src, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', normVf(d.fit), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out])
    listLines.push(`file '${out.replace(/\\/g, '/')}'`)
  }
  const listFile = path.join(tmp, 'list.txt')
  fs.writeFileSync(listFile, listLines.join('\n') + '\n')
  const concat = path.join(tmp, 'concat.mp4')
  await ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concat])
  log(`concat: ${decisions.length}컷 · ${totalDur.toFixed(1)}s`)

  // 3) 자막 .ass — 멀티세그는 누적 스택(레퍼런스처럼 줄이 쌓임). 각 구간은 겹치지 않게.
  let ass = assHeader()
  let capCount = 0
  for (const d of decisions) {
    if (!d.caption) continue
    const segs = d.caption.segments
    const per = d.durSec / segs.length
    segs.forEach((seg, i) => {
      const st = d.startSec + i * per + 0.3
      const en = d.startSec + (segs.length === 1 || i === segs.length - 1 ? d.durSec : (i + 1) * per) - 0.05
      // 지금까지의 세그를 위→아래로 쌓아 하나의 Dialogue 로 (스타일이 섞이면 마지막 줄만 색상 태그)
      const lines = segs.slice(0, i + 1).map((s, j) => {
        const body = String(s.burn).replace(/\n/g, '\\N')
        return (s.style === 'Punch' && (segs[j].style === 'Punch')) ? `{\\c&H3C3CF5&}${body}{\\c}` : body
      })
      const style = segs.some((s) => s.style === 'Punch') ? 'Cap' : (seg.style || 'Cap')
      ass += `Dialogue: 0,${assTime(st)},${assTime(en)},${style},,0,0,0,,${lines.join('\\N')}\n`
      capCount++
    })
  }
  const assPath = path.join(fdir, `${code}_captions.ass`)
  fs.writeFileSync(assPath, ass, 'utf-8')
  const assTmp = path.join(tmp, 'subs.ass')
  fs.writeFileSync(assTmp, ass, 'utf-8')
  // 폰트: 번들 손글씨체 + 컬러 이모지 폴백을 tmp/fonts/ 로 모아 fontsdir 로 지정
  const fontsTmp = path.join(tmp, 'fonts')
  fs.mkdirSync(fontsTmp, { recursive: true })
  try {
    for (const f of fs.readdirSync(FONTS_SRC)) {
      if (/\.(ttf|otf|ttc)$/i.test(f)) fs.copyFileSync(path.join(FONTS_SRC, f), path.join(fontsTmp, f))
    }
  } catch { /* noop */ }
  if (fs.existsSync(EMOJI_FONT_WIN)) { try { fs.copyFileSync(EMOJI_FONT_WIN, path.join(fontsTmp, 'seguiemj.ttf')) } catch { /* noop */ } }
  const SUBS_VF = 'subtitles=subs.ass:fontsdir=fonts'

  // 4) 효과음 + BGM 믹스
  const sfxInputs = []      // ffmpeg -i 인자
  const sfxFilters = []     // filter_complex 절
  const sfxLabels = []      // [s1] [s2] ...
  let idx = 1               // 입력 인덱스 (0 = concat)
  for (const d of decisions) {
    for (const s of d.sfx) {
      const abs = mp.sfxDir(s.file)
      if (!fs.existsSync(abs)) { log(`⚠ SFX 없음: ${s.file}`); continue }
      let atSec = d.startSec
      if (s.at === 'mid') atSec = d.startSec + d.durSec * 0.55
      else if (s.at === 'end') atSec = d.startSec + d.durSec - 0.6
      atSec += 0.15
      sfxInputs.push('-i', abs)
      const ms = Math.round(atSec * 1000)
      const trim = s.maxDur ? `atrim=0:${s.maxDur},` : ''
      sfxFilters.push(`[${idx}:a]${trim}adelay=${ms}|${ms},volume=${s.gain}[s${idx}]`)
      sfxLabels.push(`[s${idx}]`)
      idx++
    }
  }

  // BGM
  let bgmAbs = null
  const wantsBgm = decisions.some((d) => d.bgmText && !/^\s*(없음|-|n\/?a)?\s*$/i.test(d.bgmText))
  if (bgmFile) bgmAbs = path.isAbsolute(bgmFile) ? bgmFile : mp.bgmFile(bgmFile)
  else if (wantsBgm) {
    // _shared/bgm 에서 첫 파일 자동 사용
    try {
      const dir = mp.bgmDir()
      const first = fs.readdirSync(dir).find((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f))
      if (first) bgmAbs = path.join(dir, first)
    } catch { /* noop */ }
  }
  let bgmNote = 'BGM 없음'
  let bgmFilterOut = ''
  if (bgmAbs && fs.existsSync(bgmAbs)) {
    const bgmStart = decisions.find((d) => d.bgmText && !/없음/.test(d.bgmText))?.startSec ?? 0
    sfxInputs.push('-stream_loop', '-1', '-i', bgmAbs)
    const bi = idx
    const fadeOut = Math.max(0, totalDur - 1.5)
    sfxFilters.push(`[${bi}:a]atrim=0:${(totalDur - bgmStart).toFixed(2)},adelay=${Math.round(bgmStart * 1000)}|${Math.round(bgmStart * 1000)},volume=0.13,afade=t=in:st=${bgmStart.toFixed(2)}:d=1.2,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.5[bgm]`)
    bgmFilterOut = '[bgm]'
    bgmNote = `BGM: ${path.basename(bgmAbs)} (-17dB, 루프)`
    idx++
  } else if (wantsBgm) {
    bgmNote = 'BGM 필요(대본) 하나 _shared/bgm 에 트랙 없음 — CapCut 에서 추가'
  }

  const finalOut = path.join(fdir, `${code}_final.mp4`)
  // sfxFilters 에는 위에서 SFX 절 + (있으면) BGM 절이 이미 모두 들어있다.
  if (sfxLabels.length || bgmFilterOut) {
    const amixIn = `[0:a]${sfxLabels.join('')}${bgmFilterOut}`
    const amixN = 1 + sfxLabels.length + (bgmFilterOut ? 1 : 0)
    const withSfx = path.join(tmp, 'withaudio.mp4')
    await ff([
      '-i', concat, ...sfxInputs,
      '-filter_complex', `${sfxFilters.join(';')};${amixIn}amix=inputs=${amixN}:duration=first:normalize=0[aout]`,
      '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', withSfx,
    ])
    // 자막 번인 (cwd=tmp 로 상대경로 → Windows 드라이브 콜론 회피)
    await ff(['-i', withSfx, '-vf', SUBS_VF,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'copy',
      '-movflags', '+faststart', finalOut], { cwd: tmp })
  } else {
    await ff(['-i', concat, '-vf', SUBS_VF,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'copy',
      '-movflags', '+faststart', finalOut], { cwd: tmp })
  }

  // 06_publishing/{ep}_raw.mp4 도 최신 concat 으로 갱신 (자막·SFX 없는 순수 이어붙임)
  try {
    const rawOut = path.join(mp.outputDir(epNum), `ep${epNum}_raw.mp4`)
    fs.mkdirSync(path.dirname(rawOut), { recursive: true })
    fs.copyFileSync(concat, rawOut)
  } catch { /* noop */ }

  // 5) 매니페스트
  const manifest = {
    code, epNum, generatedAt: new Date().toISOString(),
    duration: +totalDur.toFixed(2),
    captionsBurned: capCount,
    bgm: bgmNote,
    cuts: decisions.map((d) => ({
      no: d.no, cutType: d.cutType, fit: d.fit,
      startSec: +d.startSec.toFixed(2), durSec: +d.durSec.toFixed(2),
      caption: d.caption ? { segments: d.caption.segments.map((s) => ({ text: s.raw, style: s.style || d.caption.style })) } : null,
      sfx: d.sfx.map((s) => ({ file: s.file, at: s.at, reason: s.reason })),
    })),
  }
  fs.writeFileSync(path.join(fdir, `${code}_finalize.json`), JSON.stringify(manifest, null, 2), 'utf-8')

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* noop */ }
  log(`완료 → ${finalOut}`)
  return { finalPath: finalOut, manifest, assPath }
}
