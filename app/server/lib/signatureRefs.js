// ── 시그니처 컷 레퍼런스 저장소(2026-10-10) ──────────────────────────────
// 배경: 어제·오늘 리뷰에서 "시그니쳐 컷을 더 극적으로 발전시키려면 반복 가능한 설정이
// 필요하다"는 피드백(observation 0006) — 한 번 만든 시그니처 컨셉(예: IG_R07의 모던
// 한복 클라이맥스)을 다음 에피소드 기획 때 다시 찾아 베껴 쓰지 않고, 이름으로 저장해뒀다가
// "적용"하면 그 컷의 CH/LOOK_ID/SP 마스터코드 스니펫을 바로 받을 수 있게 한다.
// 저장 형태는 v3 스크립트 필드 그대로라, 적용 결과를 새 컷에 붙여넣기만 하면 된다 —
// 런타임에 studio-state를 직접 건드리지 않음(열린 탭 자동저장에 덮어써질 위험 회피,
// 2026-10-10 observation 0013 참고).
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

function storePath() {
  return path.join(mp.DOWNLOADS, '_shared', 'signature-cuts', 'index.json')
}

export function listSignatures() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf-8')) } catch { return [] }
}

export function getSignature(id) {
  return listSignatures().find((s) => s.id === id) || null
}

// entry: { id?, name, description, masterCodeTemplate:{sp,ch,lookId}, audioMotif, originEpisode, originCutNo, referenceImage }
export function saveSignature(entry) {
  if (!entry?.name) throw new Error('name 필요')
  const list = listSignatures()
  const id = entry.id || entry.name.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `sig-${Date.now()}`
  const existing = list.findIndex((s) => s.id === id)
  const saved = {
    id,
    name: entry.name,
    description: entry.description || '',
    masterCodeTemplate: entry.masterCodeTemplate || {},
    audioMotif: entry.audioMotif || '',
    originEpisode: entry.originEpisode || '',
    originCutNo: entry.originCutNo ?? null,
    referenceImage: entry.referenceImage || '',
    createdAt: existing >= 0 ? list[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (existing >= 0) list[existing] = saved; else list.push(saved)
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf-8')
  return saved
}

export function deleteSignature(id) {
  const list = listSignatures().filter((s) => s.id !== id)
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf-8')
}

// 저장된 레퍼런스를 v3 스크립트 필드 스니펫 텍스트로 변환 — 새 컷에 그대로 붙여넣을 수 있게.
export function applySignatureAsSnippet(id) {
  const sig = getSignature(id)
  if (!sig) throw new Error(`시그니처 레퍼런스 없음: ${id}`)
  const t = sig.masterCodeTemplate || {}
  const lines = [
    `CH: ${t.ch || ''}`,
    `LOOK_ID: ${t.lookId || ''}`,
    `SP: ${t.sp || ''}`,
    `BEAT: 시그`,
  ]
  if (sig.audioMotif) lines.push(`(오디오 모티프 참고: ${sig.audioMotif})`)
  return { sig, snippet: lines.join('\n') }
}
