#!/usr/bin/env node
/**
 * generate-capcut-spec.js
 * 편집 메타 JSON → capcut compile 스펙 JSON 변환기
 *
 * Usage:
 *   node scripts/generate-capcut-spec.js [epNum]
 *   node scripts/generate-capcut-spec.js 3
 *
 * epNum 생략 시 output/ 폴더에서 최신 ep 번호 자동 감지
 */
import fs   from 'node:fs'
import path from 'node:path'

const MEDIA_ROOT = 'C:\\yeori-studio'
const DOWNLOADS  = path.join(MEDIA_ROOT, 'downloads')
const META_PATH  = path.join(DOWNLOADS, 'video', 'yeori_edit_meta.json')
const OUT_PATH   = path.join(DOWNLOADS, 'capcut_spec.json')

// ── 에피소드 번호 결정 ───────────────────────────────────────
function resolveEpNum() {
  const arg = process.argv[2]
  if (arg && /^\d+$/.test(arg)) return arg

  // output/ep{N} 폴더에서 자동 감지
  const outRoot = path.join(DOWNLOADS, 'output')
  if (fs.existsSync(outRoot)) {
    const latest = fs.readdirSync(outRoot)
      .filter(d => /^ep\d+$/.test(d))
      .sort((a, b) => parseInt(b.replace('ep', '')) - parseInt(a.replace('ep', '')))
    if (latest.length) return latest[0].replace('ep', '')
  }

  // audio/ep{N} 폴더에서 자동 감지 (fallback)
  const audioRoot = path.join(DOWNLOADS, 'audio')
  if (fs.existsSync(audioRoot)) {
    const latest = fs.readdirSync(audioRoot)
      .filter(d => /^ep\d+$/.test(d))
      .sort((a, b) => parseInt(b.replace('ep', '')) - parseInt(a.replace('ep', '')))
    if (latest.length) return latest[0].replace('ep', '')
  }

  throw new Error('에피소드 번호를 알 수 없습니다. node generate-capcut-spec.js <epNum> 으로 직접 지정하세요.')
}

// ── 트랜지션 매핑 ───────────────────────────────────────────
// capcut-cli 지원 slugs: dissolve, rgb-glitch, radial-blur,
// horizontal-blur, twinkle-zoom, urban-glitch, shake-3, vertical-blur-ii
function mapTransition(str) {
  if (!str) return null
  const t = str.trim()

  if (/페이드|fade|dissolv/i.test(t))   return 'dissolve'
  if (/블러|blur/i.test(t))             return 'horizontal-blur'
  if (/글리치|glitch/i.test(t))         return 'rgb-glitch'
  if (/줌|zoom|트윙클/i.test(t))        return 'twinkle-zoom'
  if (/쉐이크|흔들/i.test(t))           return 'shake-3'
  // 컷 편집 / 하드컷 → 트랜지션 없음
  if (/컷|cut|하드/i.test(t))           return null

  return null
}

// ── 비디오 경로 결정 (mp4 또는 이미지) ───────────────────────
function resolveVideoPath(videoDir, cutNo, sfxOnly) {
  const mp4 = path.join(videoDir, `cut_${cutNo}.mp4`)
  if (!sfxOnly) return { filePath: mp4, isPhoto: false }

  // sfxOnly 컷은 이미지일 수 있음 — jpg/png 순서로 확인
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const imgPath = path.join(videoDir, `cut_${cutNo}${ext}`)
    if (fs.existsSync(imgPath)) return { filePath: imgPath, isPhoto: true }
  }
  // 이미지 없으면 mp4로 폴백
  return { filePath: mp4, isPhoto: true }
}

// ── 메인 ────────────────────────────────────────────────────
const epNum = resolveEpNum()
console.log(`📼 ep${epNum} capcut 스펙 생성 시작...`)

const videoDir = path.join(DOWNLOADS, 'video', `ep${epNum}`)
const audioDir = path.join(DOWNLOADS, 'audio', `ep${epNum}`)
const srtPath  = path.join(audioDir,  `ep${epNum}.srt`)
const bgmPath  = path.join(DOWNLOADS, 'bgm', 'bgm_default.mp3')

if (!fs.existsSync(META_PATH)) {
  console.error(`❌ 편집 메타 없음: ${META_PATH}`)
  process.exit(1)
}

const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'))
if (!Array.isArray(meta) || meta.length === 0) {
  console.error('❌ 편집 메타가 비어 있습니다.')
  process.exit(1)
}

const totalDuration = meta[meta.length - 1]?.endSec ?? 0
console.log(`   컷 수: ${meta.length}개, 총 길이: ${totalDuration}초`)

// ── 비디오 트랙 ─────────────────────────────────────────────
const videoItems = meta.map(cut => {
  const { filePath, isPhoto } = resolveVideoPath(videoDir, cut.cutNo, cut.sfxOnly)
  const item = {
    path: filePath,
    start: cut.startSec,
    duration: cut.duration,
    ref: `v${cut.cutNo}`,
  }
  if (isPhoto) item.type = 'photo'
  return item
})

// ── 음성(VO) 오디오 트랙 ──────────────────────────────────────
const audioItems = meta
  .filter(cut => cut.audioFile && !cut.sfxOnly)
  .map(cut => ({
    path: path.join(audioDir, cut.audioFile),
    start: cut.startSec,
    duration: Math.max(0.1, (cut.audioEnd ?? cut.endSec) - (cut.audioStart ?? 0)),
    volume: 1.0,
  }))

// ── Operations ──────────────────────────────────────────────
const operations = []

// 트랜지션 (컷 경계마다 적용)
for (let i = 0; i < meta.length - 1; i++) {
  const slug = mapTransition(meta[i].transition)
  if (slug) {
    operations.push({
      op:       'transition',
      target:   `v${meta[i].cutNo}`,
      slug,
      duration: 0.4,
    })
  }
}

// Ken Burns 효과 — 이미지 컷(sfxOnly:true)이고 type이 훅/일반인 경우
// keyframe으로 서서히 확대 (scale 1.0 → 1.25)
for (const cut of meta) {
  const isKenBurnsTarget = cut.sfxOnly && (cut.type === '훅' || cut.type === '일반')
  if (!isKenBurnsTarget) continue

  const dur = cut.duration
  operations.push(
    { op: 'keyframe', target: `v${cut.cutNo}`, property: 'scale_x', time: 0,   value: '1.0'  },
    { op: 'keyframe', target: `v${cut.cutNo}`, property: 'scale_x', time: dur,  value: '1.25' },
    { op: 'keyframe', target: `v${cut.cutNo}`, property: 'scale_y', time: 0,   value: '1.0'  },
    { op: 'keyframe', target: `v${cut.cutNo}`, property: 'scale_y', time: dur,  value: '1.25' },
  )
}

// 색보정 필터 (전체 구간)
operations.push({
  op:        'filter',
  slug:      'warm',
  start:     0,
  duration:  totalDuration,
  intensity: 0.3,
})

// SRT 자막 (파일 있을 때만)
if (fs.existsSync(srtPath)) {
  operations.push({ op: 'captions', path: srtPath })
  console.log(`   SRT 연결: ${srtPath}`)
} else {
  console.warn(`⚠  SRT 없음 (건너뜀): ${srtPath}`)
}

// ── 트랙 조립 ────────────────────────────────────────────────
const tracks = [
  { type: 'video', name: 'main', items: videoItems },
]

if (audioItems.length > 0) {
  tracks.push({ type: 'audio', name: 'vo', items: audioItems })
}

// BGM 트랙 (파일 있을 때만)
if (fs.existsSync(bgmPath)) {
  tracks.push({
    type: 'audio',
    name: 'bgm',
    items: [{ path: bgmPath, start: 0, duration: totalDuration, volume: 0.15 }],
  })
  console.log(`   BGM 연결: ${bgmPath}`)
} else {
  console.warn(`⚠  BGM 없음 (건너뜀): ${bgmPath}`)
}

// ── 최종 스펙 ────────────────────────────────────────────────
const spec = {
  name:       `ep${epNum}_shorts`,
  width:      1080,
  height:     1920,
  fps:        30,
  ratio:      '9:16',
  tracks,
  operations,
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, JSON.stringify(spec, null, 2), 'utf-8')

console.log(`\n✅ capcut_spec.json 생성 완료`)
console.log(`   출력: ${OUT_PATH}`)
console.log(`   트랙: ${tracks.length}개 | operations: ${operations.length}개`)
