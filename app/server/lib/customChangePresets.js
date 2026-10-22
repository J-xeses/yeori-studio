// ── 체인지 생성기 커스텀 트리거/VFX 저장소(2026-10-13) ───────────────────
// 배경: 성준님 피드백 — "효과별 조합 매트릭스와 확장성이 안 보여서 연출방법이 이미 뻔한
// 범위에 머물러 있게 된다". changeEffects.js의 TRIGGER_ACTIONS/VFX_PRESETS는 코드에
// 하드코딩돼 있어 새 기법을 추가하려면 매번 코드 수정+배포가 필요했음. signatureRefs.js와
// 동일한 패턴(런타임 저장소, UI에서 바로 추가)으로 커스텀 트리거/VFX를 사람이 직접 늘릴 수
// 있게 한다 — 내장 프리셋은 그대로 두고, 여기 저장된 항목을 /api/change-combo/options
// 응답에 합쳐서 같은 그리드에 섞여 보이게 한다(출처 구분용 custom:true 플래그만 추가).
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

function storePath() {
  return path.join(mp.DOWNLOADS, '_shared', 'change-combo', 'custom-presets.json')
}

function load() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf-8')) } catch { return { triggers: [], vfx: [] } }
}

function persist(data) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf-8')
}

export function listCustomTriggers() {
  return load().triggers.map((t) => ({ ...t, custom: true }))
}

export function listCustomVfx() {
  return load().vfx.map((v) => ({ ...v, custom: true }))
}

// entry: { nameKo, descKo, en, icon? }
export function addCustomTrigger(entry) {
  if (!entry?.nameKo?.trim() || !entry?.en?.trim()) throw new Error('nameKo, en 필요')
  const data = load()
  const id = `custom_${entry.nameKo.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || Date.now()}`
  const saved = { id, nameKo: entry.nameKo.trim(), descKo: entry.descKo?.trim() || '', en: entry.en.trim(), icon: entry.icon || '✨', addedAt: new Date().toISOString() }
  data.triggers.push(saved)
  persist(data)
  return saved
}

// entry: { nameKo, en, type? }
export function addCustomVfx(entry) {
  if (!entry?.nameKo?.trim() || !entry?.en?.trim()) throw new Error('nameKo, en 필요')
  const data = load()
  const saved = { nameKo: entry.nameKo.trim(), en: entry.en.trim(), type: entry.type?.trim() || 'custom', addedAt: new Date().toISOString() }
  data.vfx.push(saved)
  persist(data)
  return saved
}

export function deleteCustomTrigger(id) {
  const data = load()
  data.triggers = data.triggers.filter((t) => t.id !== id)
  persist(data)
}

// ── 프리즈 비트 커스텀 사건(이벤트) 저장소(2026-10-16) ───────────────────────
// 배경: 성준님 피드백 — "프리즈 비트 생성 기능에 다양한 레퍼런스가 1차적으로 갖춰졌으면
// 좋겠다 — 여러 상황을 조합해서 상상할 수 있고, 그 상상에서 다른 가지를 더 만들 수도 있고,
// 입력하기도 하고". 내장 사건(FREEZE_EVENT_LIBRARY, RetentionHookTab.jsx)×장소 조합 위에,
// 사람이 직접 입력한 조합을 저장해두면 다음에도 재사용할 수 있게 같은 패턴으로 추가.
function freezeEventStorePath() {
  return path.join(mp.DOWNLOADS, '_shared', 'change-combo', 'custom-freeze-events.json')
}

function loadFreezeEvents() {
  try { return JSON.parse(fs.readFileSync(freezeEventStorePath(), 'utf-8')) } catch { return { events: [] } }
}

function persistFreezeEvents(data) {
  fs.mkdirSync(path.dirname(freezeEventStorePath()), { recursive: true })
  fs.writeFileSync(freezeEventStorePath(), JSON.stringify(data, null, 2), 'utf-8')
}

export function listCustomFreezeEvents() {
  return loadFreezeEvents().events.map((e) => ({ ...e, custom: true }))
}

// entry: { nameKo, ko, en, category? }
export function addCustomFreezeEvent(entry) {
  if (!entry?.nameKo?.trim() || !entry?.ko?.trim() || !entry?.en?.trim()) throw new Error('nameKo, ko, en 필요')
  const data = loadFreezeEvents()
  const id = `customfz_${Date.now()}`
  const saved = { id, nameKo: entry.nameKo.trim(), ko: entry.ko.trim(), en: entry.en.trim(), category: entry.category?.trim() || '직접입력', addedAt: new Date().toISOString() }
  data.events.push(saved)
  persistFreezeEvents(data)
  return saved
}

export function deleteCustomFreezeEvent(id) {
  const data = loadFreezeEvents()
  data.events = data.events.filter((e) => e.id !== id)
  persistFreezeEvents(data)
}

// ── 프리즈 비트 커스텀 장소 저장소(2026-10-22) ───────────────────────────────
// 배경: 성준님 — "추가할 수 있는 기능이 각 창마다 있어야겠다" — 상황/동작 리스트는 이미
// addCustomFreezeEvent로 즉석 추가가 되는데, 장소-1(일상)/장소-2(번외) 리스트는 코드에
// 박힌 배열뿐이었다. group('local'|'extra')으로 어느 리스트에 들어갈지만 구분해 저장하고,
// 나머지(envEn/lightingEn/poseKo/poseEn)는 사건 저장소와 같은 패턴.
function freezeLocationStorePath() {
  return path.join(mp.DOWNLOADS, '_shared', 'change-combo', 'custom-freeze-locations.json')
}

function loadFreezeLocations() {
  try { return JSON.parse(fs.readFileSync(freezeLocationStorePath(), 'utf-8')) } catch { return { locations: [] } }
}

function persistFreezeLocations(data) {
  fs.mkdirSync(path.dirname(freezeLocationStorePath()), { recursive: true })
  fs.writeFileSync(freezeLocationStorePath(), JSON.stringify(data, null, 2), 'utf-8')
}

export function listCustomFreezeLocations() {
  return loadFreezeLocations().locations.map((l) => ({ ...l, custom: true }))
}

// entry: { nameKo, group('local'|'extra'), envEn, lightingEn, poseKo?, poseEn? }
export function addCustomFreezeLocation(entry) {
  if (!entry?.nameKo?.trim()) throw new Error('nameKo 필요')
  const data = loadFreezeLocations()
  const id = `customfzloc_${Date.now()}`
  const saved = {
    id,
    nameKo: entry.nameKo.trim(),
    group: entry.group === 'extra' ? 'extra' : 'local',
    envEn: entry.envEn?.trim() || '',
    lightingEn: entry.lightingEn?.trim() || '',
    poseKo: entry.poseKo?.trim() || '',
    poseEn: entry.poseEn?.trim() || '',
    addedAt: new Date().toISOString(),
  }
  data.locations.push(saved)
  persistFreezeLocations(data)
  return saved
}

export function deleteCustomFreezeLocation(id) {
  const data = loadFreezeLocations()
  data.locations = data.locations.filter((l) => l.id !== id)
  persistFreezeLocations(data)
}
