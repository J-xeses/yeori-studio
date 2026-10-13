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
