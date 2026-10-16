// ── 연출기법 공통 레퍼런스 이미지 저장소 — 2026-10-16 신설 ──────────────────
// 배경: 성준님 피드백 — "시그, 체인지, 프리즈 이 연출기법류 공통으로 미리 연출한 이미지가
// 레퍼런스로 스크랩 되어야 한다 — 모습이 머리에 배경으로 떠올라야 에피소드 n번 컷도 최적으로
// 선정할 수 있다". 지금까지 세 패널(SignatureRefPanel·ChangeComboPanel·FreezeBeatPanel)
// 다 텍스트 설명뿐이라, 기획 단계에서 "이게 어떤 그림인지" 매번 머릿속으로 다시 상상해야
// 했다. 세 기법 공통으로 쓰는 이미지 저장소를 하나만 두고(group: 'signature'|'change'|'freeze'),
// 기법 항목(key, 예: 프리즈 사건 이름·시그 프리셋 이름·트리거 id)마다 여러 장의 레퍼런스
// 이미지를 붙일 수 있게 한다. 실제 생성에 성공한 결과물도 그대로 여기 등록해서, 쓸수록
// 레퍼런스가 쌓이는 구조(성준님: "내가 지속적으로 채워갈 것이다").
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

function baseDir() { return path.join(mp.DOWNLOADS, '_shared', 'direction-refs') }
function indexPath() { return path.join(baseDir(), 'index.json') }

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(indexPath(), 'utf-8')) } catch { return {} }
}
function saveIndex(data) {
  fs.mkdirSync(baseDir(), { recursive: true })
  fs.writeFileSync(indexPath(), JSON.stringify(data, null, 2))
}

// 기법 항목 이름(한글 포함, 공백 섞임)을 폴더명으로 안전하게 변환.
function slugKey(key) {
  return String(key).trim().toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'untitled'
}

export function listRefImages(group, key) {
  return loadIndex()[group]?.[slugKey(key)] || []
}

// 패널이 목록 전체를 한 번에 그릴 때(항목마다 개별 요청 대신) 쓰는 벌크 조회.
export function listAllRefs(group) {
  return loadIndex()[group] || {}
}

export function addRefImage(group, key, buffer, ext = 'jpg', caption = '') {
  const k = slugKey(key)
  const dir = path.join(baseDir(), group, k)
  fs.mkdirSync(dir, { recursive: true })
  const filename = `ref_${Date.now()}.${ext}`
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, buffer)
  const idx = loadIndex()
  idx[group] = idx[group] || {}
  idx[group][k] = idx[group][k] || []
  const rec = { filename, caption: caption || '', addedAt: new Date().toISOString(), url: mp.toMediaUrl(filePath) }
  idx[group][k].push(rec)
  saveIndex(idx)
  return rec
}

export function deleteRefImage(group, key, filename) {
  const k = slugKey(key)
  const idx = loadIndex()
  if (idx[group]?.[k]) {
    idx[group][k] = idx[group][k].filter((r) => r.filename !== filename)
    saveIndex(idx)
  }
  try { fs.unlinkSync(path.join(baseDir(), group, k, filename)) } catch { /* 이미 없으면 무시 */ }
}
