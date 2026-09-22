// ── 릴스 최종화 수동 오버라이드(SFX/BGM 등) ──────────────────────────
// studio-state.json은 브라우저 탭이 3초 디바운스로 계속 자동저장하는 파일이라,
// 스크립트/MCP로 masterCode.audio.sfxFile 등을 직접 써넣어도 열려있던 탭의 stale
// state가 다시 덮어써 사라지는 사고가 반복됐다(2026-09-22, R04 cut2 sfxAtSec 유실 실측).
// mtime 충돌가드(studio-state.json)는 "동시에 다른 쪽이 파일을 바꾼 경우"만 잡아주고,
// "탭이 그 필드를 아예 모른 채 자기 스냅샷을 그대로 되쓰는" 경우는 막지 못한다.
// 근본 해결: 이런 오버라이드는 브라우저가 절대 읽지도 쓰지도 않는 별도 파일에 보관해서
// studio-state.json 저장 경로와 완전히 분리한다. reelFinalize의 decideCut 판단 직전에
// resolveEpisodeCuts()가 이 파일을 병합해 적용한다.
import fs from 'node:fs'
import * as mp from './mediaPaths.js'

function overridesPath(code) {
  return mp.statePath(`reel-overrides/${code}.json`)
}

export function loadOverrides(code) {
  const p = overridesPath(code)
  if (!fs.existsSync(p)) return {}
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return {} }
}

// patch: masterCode.audio 에 병합할 필드(sfxFile/sfxAt/sfxAtSec/sfxGain/bgm 등).
// 값이 '' 인 키는 "지정 해제"로 보고 제거한다(예: sfxFile:'' → 자동판단으로 복귀).
export function setOverride(code, cutNo, patch) {
  const p = overridesPath(code)
  fs.mkdirSync(p.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
  const all = loadOverrides(code)
  const key = String(cutNo)
  const merged = { ...(all[key] || {}), ...(patch || {}) }
  for (const k of Object.keys(merged)) {
    if (merged[k] === '' || merged[k] == null) delete merged[k]
  }
  if (Object.keys(merged).length) all[key] = merged
  else delete all[key]
  fs.writeFileSync(p, JSON.stringify(all, null, 2), 'utf-8')
  return all[key] || {}
}

// masterCode.audio 소속 필드 — 그 외(subtitle/captionStartSec/captionSegTiming/duration/
// captionStack 등)는 컷 객체 최상위에 바로 병합한다. 2026-09-22: SFX뿐 아니라 자막(CP)·
// 자막 타이밍도 studio-state.json 직접수정 후 브라우저 탭 자동저장에 반복적으로 되돌려지는
// 사고가 나서(성준님 실측 지적) 오버라이드 범위를 확장 — "이 파일에 넣은 값은 브라우저가
// 절대 못 건드린다"를 자막류 전체로 넓힘.
const AUDIO_FIELDS = new Set(['bgm', 'voice', 'sfx', 'ambience', 'sfxFile', 'sfxAt', 'sfxAtSec', 'sfxGain'])

// cuts 배열에 해당 코드의 오버라이드를 덮어써서 반환 — audio 필드는 masterCode.audio에,
// 나머지는 컷 최상위 필드에 병합(둘 다 원본 studio-state 값보다 항상 우선).
export function applyOverrides(cuts, code) {
  const all = loadOverrides(code)
  if (!Object.keys(all).length) return cuts
  return cuts.map((c) => {
    const ov = all[String(c.no)]
    if (!ov || !Object.keys(ov).length) return c
    const audioPatch = {}, cutPatch = {}
    for (const [k, v] of Object.entries(ov)) (AUDIO_FIELDS.has(k) ? audioPatch : cutPatch)[k] = v
    const merged = { ...c, ...cutPatch }
    if (Object.keys(audioPatch).length) {
      const mc = { ...(c.masterCode || {}) }
      mc.audio = { ...(mc.audio || {}), ...audioPatch }
      merged.masterCode = mc
    }
    return merged
  })
}
