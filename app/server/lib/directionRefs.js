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

// 2026-10-22 4차 보완 — "이미지 먼저 등록, 그 다음 설명 입력" 흐름을 위한 캡션 전용 패치.
// 업로드는 이미 끝난 레코드의 caption 필드만 바꾼다(파일 재업로드 없음).
export function updateRefCaption(group, key, filename, caption) {
  const k = slugKey(key)
  const idx = loadIndex()
  const rec = idx[group]?.[k]?.find((r) => r.filename === filename)
  if (!rec) return null
  rec.caption = caption || ''
  saveIndex(idx)
  return rec
}

// 2026-10-22 4차 보완 재재점검 — "이미지부터 먼저 등록, 기법 이름은 그 다음"으로 진짜 바꾸려면
// 기법 이름(=key)을 미리 받지 않고 임시 그룹("미분류")에 업로드한 뒤, 나중에 진짜 이름으로
// 옮길 수 있어야 한다. 파일을 실제로 다른 폴더(key)로 이동시키고 url도 새로 계산해 돌려준다.
export function moveRefImage(group, oldKey, filename, newKey) {
  const ok = slugKey(oldKey)
  const nk = slugKey(newKey)
  if (ok === nk) return updateRefCaption(group, oldKey, filename, undefined) // 이름 그대로면 이동 불필요
  const idx = loadIndex()
  const list = idx[group]?.[ok] || []
  const i = list.findIndex((r) => r.filename === filename)
  if (i === -1) return null
  const rec = list[i]
  const fromPath = path.join(baseDir(), group, ok, filename)
  const toDir = path.join(baseDir(), group, nk)
  fs.mkdirSync(toDir, { recursive: true })
  const toPath = path.join(toDir, filename)
  fs.renameSync(fromPath, toPath)
  list.splice(i, 1)
  idx[group][ok] = list
  idx[group][nk] = idx[group][nk] || []
  rec.url = mp.toMediaUrl(toPath)
  idx[group][nk].push(rec)
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
