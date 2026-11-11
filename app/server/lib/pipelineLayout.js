// 파이프라인 워크벤치(모니터 탭 캔버스) 노드 배치 저장 — 2026-11-11.
//
// 성준님 요구: "노드가 계속 붙을 것이므로 배치 조정(드래그)과 배선 조절이 수반돼야 한다". 드래그로 옮긴 좌표를
// downloads/state/pipeline-layout.json 에 { positions: { nodeId: { x, y } } } 로 저장해 새로고침·다른 세션에서도 유지한다.
// 에피소드와 무관한 "화면 배치"라 studio-state.json(브라우저 자동저장이 통째로 덮어쓰는 파일)과 분리한 별도 파일.
// 저장 안 된 노드(나중에 추가된 노드 포함)는 프론트(src/lib/pipelineNodes.js autoLayout)가 자동 배치한다.

import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

export const PIPELINE_LAYOUT_PATH = mp.statePath('pipeline-layout.json')
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const MAX_NODES = 500
const MAX_COORD = 1e6

// 요청 본문 검증 — 통과한 좌표만 정수로 반올림해 돌려준다. 형식이 틀리면 throw(400).
export function sanitizePositions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('positions 는 { nodeId: { x, y } } 객체여야 합니다'), { statusCode: 400 })
  const ids = Object.keys(input)
  if (ids.length > MAX_NODES) throw Object.assign(new Error(`노드가 너무 많습니다(최대 ${MAX_NODES})`), { statusCode: 400 })
  const out = {}
  for (const id of ids) {
    const p = input[id]
    const x = Number(p?.x), y = Number(p?.y)
    if (!ID_RE.test(id) || !p || typeof p !== 'object' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) {
      throw Object.assign(new Error(`잘못된 노드 좌표: ${String(id).slice(0, 64)}`), { statusCode: 400 })
    }
    out[id] = { x: Math.round(x), y: Math.round(y) }
  }
  return out
}

export function loadPipelineLayout(file = PIPELINE_LAYOUT_PATH) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return { positions: j && typeof j.positions === 'object' && j.positions ? j.positions : {}, savedAt: j?.savedAt || null }
  } catch { return { positions: {}, savedAt: null } }   // 한 번도 저장 안 됨(또는 파일 손상) → 프론트가 자동 배치
}

// 통째 교체 저장(프론트가 항상 화면의 전체 노드 좌표를 보낸다). 임시 파일에 쓰고 rename — 쓰다 죽어도 반쪽 파일이 남지 않게.
export function savePipelineLayout(positions, file = PIPELINE_LAYOUT_PATH) {
  const out = { positions: sanitizePositions(positions), savedAt: new Date().toISOString() }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
  return out
}

// GET/PUT /api/pipeline-layout 등록. file 인자는 테스트용(임시 파일로 같은 라우트 코드를 검증).
export function mountPipelineLayout(app, { file = PIPELINE_LAYOUT_PATH } = {}) {
  app.get('/api/pipeline-layout', (_req, res) => res.json({ ok: true, ...loadPipelineLayout(file) }))
  app.put('/api/pipeline-layout', (req, res) => {
    try { res.json({ ok: true, ...savePipelineLayout(req.body?.positions, file) }) }
    catch (e) { res.status(e.statusCode || 500).json({ ok: false, error: e.message }) }
  })
}
