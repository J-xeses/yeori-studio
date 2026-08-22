// ── G포인트 공유 저장소 ──────────────────────────────────────
// 스튜디오 ↔ 제작 매트릭스 실시간 연동
// localStorage key: 'aca_gpoints_v1'
// content_matrix_v3.html(file://)은 이 localStorage를 직접 읽을 수 없으므로(다른 오리진),
// 변경될 때마다 서버(POST /api/gpoints)에도 같이 저장해 서버를 경유해서만 공유한다.
//
// 저장 구조(v2, 2026-08-02): 이전엔 { cut_1: {...}, cut_2: {...} } 식으로 컷 번호만 키였는데,
// 그러면 서로 다른 에피소드에 같은 컷 번호가 있을 때 진행 상태를 덮어써버리는 문제가 있었다.
// 그래서 이제 { [episodeCode]: { cut_1: {...}, ... } } 형태로 에피소드 코드를 한 단계 더
// 감싼다. 호출부는 src/lib/episodeCode.js의 resolveEpisodeCode(episode)로 episodeCode를
// 구한다 — episode.code(3차에서 정식 도입)가 있으면 그 값, 없는 레거시 에피소드는
// 과도기 방식(String(episode.number))으로 자동 대체된다.
//
// 구버전(평면 구조) 데이터가 남아있으면 어느 에피소드 것인지 알 수 없으므로(애초에 구분이
// 없었음), 유실 방지 차원에서 "_LEGACY" 키 밑으로 통째로 옮겨서 보존만 하고 더 이상
// 읽지는 않는다.

const GP_KEY = 'aca_gpoints_v1'
const SERVER = 'http://localhost:3001'
const LEGACY_FLAT_KEY = '_LEGACY'

function isLegacyFlatShape(data) {
  // 평면 구조였다면 최상위 키들이 곧 cut_N이었다 — 하나라도 매치되면 구버전으로 간주.
  return Object.keys(data).some(k => /^cut_\d+$/.test(k))
}

function migrateIfLegacy(data) {
  if (!isLegacyFlatShape(data)) return data
  return { [LEGACY_FLAT_KEY]: data }
}

// 현재 G포인트 데이터 불러오기 (전체 구조: { [episodeCode]: { cut_N: {...} } })
export function loadGPoints() {
  try {
    const raw = JSON.parse(localStorage.getItem(GP_KEY) || '{}')
    const migrated = migrateIfLegacy(raw)
    if (migrated !== raw) localStorage.setItem(GP_KEY, JSON.stringify(migrated))
    return migrated
  } catch { return {} }
}

// 서버로도 저장 (실패해도 로컬 동작에는 영향 없음 — fire-and-forget)
function syncToServer(data) {
  fetch(`${SERVER}/api/gpoints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {})
}

// CUT의 특정 G포인트 업데이트
// episodeCode: 에피소드 코드(과도기엔 String(episode.number))
// cutNo: CUT 번호 (1, 2, 3...)
// gKey: 'g1' | 'g2' | 'g3' | 'g4' | 'g5'
// pass: true | false
export function setGPoint(episodeCode, cutNo, gKey, pass) {
  try {
    const data = loadGPoints()
    const cutKey = `cut_${cutNo}`
    const epData = { ...data[episodeCode] }
    epData[cutKey] = {
      ...epData[cutKey],
      [gKey]: pass,
      updatedAt: new Date().toISOString(),
    }
    data[episodeCode] = epData
    localStorage.setItem(GP_KEY, JSON.stringify(data))
    syncToServer(data)
    // 매트릭스에 변경 알림 (CustomEvent)
    window.dispatchEvent(new CustomEvent('gpoints_updated', { detail: { episodeCode, cutNo, gKey, pass } }))
  } catch(e) { console.warn('G포인트 저장 실패:', e) }
}

// 여러 G포인트 한번에 업데이트
export function setGPoints(episodeCode, cutNo, updates) {
  try {
    const data = loadGPoints()
    const cutKey = `cut_${cutNo}`
    const epData = { ...data[episodeCode] }
    epData[cutKey] = {
      ...epData[cutKey],
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    data[episodeCode] = epData
    localStorage.setItem(GP_KEY, JSON.stringify(data))
    syncToServer(data)
    window.dispatchEvent(new CustomEvent('gpoints_updated', { detail: { episodeCode, cutNo, updates } }))
  } catch(e) { console.warn('G포인트 저장 실패:', e) }
}

// CUT의 G포인트 현황 가져오기
export function getGPoint(episodeCode, cutNo) {
  const data = loadGPoints()
  return data[episodeCode]?.[`cut_${cutNo}`] || { g1: false, g2: false, g3: false, g4: false, g5: false }
}

// 전체 에피소드 G포인트 요약
export function getGPointSummary(episodeCode, cutCount) {
  const data = loadGPoints()
  const epData = data[episodeCode] || {}
  let g1=0, g2=0, g3=0, g4=0, g5=0
  for(let i = 1; i <= cutCount; i++) {
    const d = epData[`cut_${i}`] || {}
    if(d.g1) g1++
    if(d.g2) g2++
    if(d.g3) g3++
    if(d.g4) g4++
    if(d.g5) g5++
  }
  return { g1, g2, g3, g4, g5, total: cutCount }
}
