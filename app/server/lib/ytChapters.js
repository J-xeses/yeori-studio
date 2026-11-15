// ── 유튜브 운영실 "조치 가이드" — 챕터(타임스탬프) 등록 실제 제안(2026-11-15) ──
// "챕터 등록" 체크리스트 항목이 한 줄 설명만 있어 이해하기 어렵다는 피드백으로 신설.
// studio-state.json의 실제 컷 길이(cut.duration)를 누적해 진짜 시작 시각을 계산하고,
// 각 컷의 대사/나레이션/장면 설명에서 짧은 라벨을 뽑아 "그대로 복사해 붙일 수 있는" 챕터 목록을 만든다.
// 유튜브 챕터 최소 조건(3개 이상·00:00 시작·연속 챕터 간 10초 이상 간격)을 실제로 채우는지도 같이 판정 —
// 8초짜리 컷으로 구성된 짧은 숏폼은 구조적으로 조건을 못 채우는 경우가 많아, 그 사실을 숨기지 않고 알려준다.
import fs from 'fs'
import path from 'path'
import { MEDIA_ROOT } from './mediaPaths.js'

const STATE_PATH = path.join(MEDIA_ROOT, 'app', 'studio-state.json')

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return m + ':' + String(s).padStart(2, '0')
}

function shortLabel(cut, idx) {
  const text = cut.dialogue || cut.narration || cut.action || cut.scene || ''
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return '장면 ' + (idx + 1)
  return clean.length > 20 ? clean.slice(0, 20) + '…' : clean
}

export function buildChapterSuggestion(code) {
  let state
  try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) } catch {
    return { eligible: false, reason: '에피소드 데이터를 읽을 수 없습니다(studio-state.json)' }
  }
  const ep = Object.values(state.episodes || {}).find(e => e.episode?.code === code)
  if (!ep || !Array.isArray(ep.cuts) || !ep.cuts.length) {
    return { eligible: false, reason: '이 에피소드의 컷 정보를 찾을 수 없습니다' }
  }
  const cuts = ep.cuts.slice().sort((a, b) => (a.no || 0) - (b.no || 0))
  let t = 0
  const chapters = cuts.map((c, i) => {
    const row = { time: fmtTime(t), label: shortLabel(c, i) }
    t += Number(c.duration) || 8
    return row
  })
  const totalSec = t
  const shortGapIdx = cuts.findIndex(c => (Number(c.duration) || 8) < 10)
  const eligible = chapters.length >= 3 && shortGapIdx === -1
  let reason = ''
  if (!eligible) {
    reason = chapters.length < 3
      ? `컷이 ${chapters.length}개뿐이라 유튜브 챕터 최소 조건(3개 이상)을 못 채웁니다.`
      : `${shortGapIdx + 1}번 컷이 ${Number(cuts[shortGapIdx].duration) || 8}초라 챕터 간 최소 간격(10초) 조건을 못 채웁니다. 숏폼 특성상 흔한 경우 — 이 영상은 챕터보다 재생목록·고정댓글에 집중하는 게 더 효과적입니다.`
  }
  return { eligible, totalSec, cutCount: cuts.length, chapters, reason }
}
