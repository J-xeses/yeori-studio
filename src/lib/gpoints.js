// ── G포인트 공유 저장소 ──────────────────────────────────────
// 스튜디오 ↔ 제작 매트릭스 실시간 연동
// localStorage key: 'aca_gpoints_v1'

const GP_KEY = 'aca_gpoints_v1'

// 현재 G포인트 데이터 불러오기
export function loadGPoints() {
  try {
    return JSON.parse(localStorage.getItem(GP_KEY) || '{}')
  } catch { return {} }
}

// CUT의 특정 G포인트 업데이트
// cutNo: CUT 번호 (1, 2, 3...)
// gKey: 'g1' | 'g2' | 'g3' | 'g4'
// pass: true | false
export function setGPoint(cutNo, gKey, pass) {
  try {
    const data = loadGPoints()
    const key = `cut_${cutNo}`
    data[key] = {
      ...data[key],
      [gKey]: pass,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(GP_KEY, JSON.stringify(data))
    // 매트릭스에 변경 알림 (CustomEvent)
    window.dispatchEvent(new CustomEvent('gpoints_updated', { detail: { cutNo, gKey, pass } }))
  } catch(e) { console.warn('G포인트 저장 실패:', e) }
}

// 여러 G포인트 한번에 업데이트
export function setGPoints(cutNo, updates) {
  try {
    const data = loadGPoints()
    const key = `cut_${cutNo}`
    data[key] = {
      ...data[key],
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(GP_KEY, JSON.stringify(data))
    window.dispatchEvent(new CustomEvent('gpoints_updated', { detail: { cutNo, updates } }))
  } catch(e) { console.warn('G포인트 저장 실패:', e) }
}

// CUT의 G포인트 현황 가져오기
export function getGPoint(cutNo) {
  const data = loadGPoints()
  return data[`cut_${cutNo}`] || { g1: false, g2: false, g3: false, g4: false }
}

// 전체 에피소드 G포인트 요약
export function getGPointSummary(cutCount) {
  const data = loadGPoints()
  let g1=0, g2=0, g3=0, g4=0
  for(let i = 1; i <= cutCount; i++) {
    const d = data[`cut_${i}`] || {}
    if(d.g1) g1++
    if(d.g2) g2++
    if(d.g3) g3++
    if(d.g4) g4++
  }
  return { g1, g2, g3, g4, total: cutCount }
}
