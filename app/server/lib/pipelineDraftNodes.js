// 파이프라인 워크벤치 "노드 신설"(구상 노드) 저장 — 2026-11-19.
//
// 성준님 요구: 편집 패널에서 컨셉(이름+설명)만 입력해 캔버스에 바로 올려볼 수 있게. 이 노드들은
// src/lib/pipelineNodes.js 의 진짜 노드(코드·입출력 포트·health 실측)와 다르다 — 아직 아무 코드에도
// 연결 안 된 "구상 카드"일 뿐이다. 실제 단계로 쓰려면 사람이 pipelineNodes.js 배열에 손으로 반영해야
// 한다(그 파일의 소스 오브 트루스 원칙은 그대로 유지, 이건 그 전 단계의 메모판).
// 좌표는 여기서 안 다룬다 — 구상 노드도 다른 노드와 똑같이 pipelineLayout.js(/api/pipeline-layout)가
// id 문자열 기준으로 저장하므로 드래그하면 그대로 거기 섞여 저장된다.
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

export const PIPELINE_DRAFT_NODES_PATH = mp.statePath('pipeline-draft-nodes.json')
const MAX_DRAFTS = 100
const MAX_LABEL = 60
const MAX_CONCEPT = 2000
// 2026-11-19(성준님 — "구상 노드도 배선을 꽂았다 뗐다 해볼 수 있어야 한다"): 구상 노드에 실제
// Handle(포트)을 달기 위한 이름 목록. 이 포트엔 kind(텍스트/이미지/영상/음성) 개념이 없다 —
// 아직 코드가 없는 카드라 "이게 정확히 어떤 데이터냐"까지 정하는 건 pipelineNodes.js 로
// 승격할 때의 몫이다. 여기선 이름만 받아 화면에서 자유롭게 잇고 떼어볼 수 있게만 한다.
const MAX_PORTS = 6
const MAX_PORT_NAME = 24
function sanitizePortNames(arr) {
  if (!Array.isArray(arr)) return []
  const out = []
  for (const raw of arr) {
    const name = String(raw || '').trim().slice(0, MAX_PORT_NAME)
    if (name && !out.includes(name)) out.push(name)
    if (out.length >= MAX_PORTS) break
  }
  return out
}

function loadRaw(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return Array.isArray(j?.drafts) ? j.drafts : []
  } catch { return [] }
}
function readSavedAt(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8'))?.savedAt || null } catch { return null }
}
function saveRaw(drafts, file) {
  const out = { drafts, savedAt: new Date().toISOString() }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
  return out
}

export function loadDraftNodes(file = PIPELINE_DRAFT_NODES_PATH) {
  return { drafts: loadRaw(file), savedAt: readSavedAt(file) }
}

// patch: { label, concept, inputs?, outputs? }. label 필수(빈 문자열이면 400) — 이름 없이
// 캔버스에 올릴 이유가 없다. inputs/outputs 는 포트 이름 배열(둘 다 선택, 없으면 포트 없는
// 카드 — 기존과 동일하게 동작).
export function addDraftNode(patch, file = PIPELINE_DRAFT_NODES_PATH) {
  const label = String(patch?.label || '').trim().slice(0, MAX_LABEL)
  const concept = String(patch?.concept || '').trim().slice(0, MAX_CONCEPT)
  if (!label) throw Object.assign(new Error('이름(label) 이 필요합니다'), { statusCode: 400 })
  const inputs = sanitizePortNames(patch?.inputs)
  const outputs = sanitizePortNames(patch?.outputs)
  const drafts = loadRaw(file)
  if (drafts.length >= MAX_DRAFTS) throw Object.assign(new Error(`구상 노드가 너무 많습니다(최대 ${MAX_DRAFTS}) — 정리 후 다시 시도하세요`), { statusCode: 400 })
  const id = `draft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const entry = { id, label, concept, inputs, outputs, createdAt: new Date().toISOString() }
  drafts.push(entry)
  saveRaw(drafts, file)
  return entry
}

export function removeDraftNode(id, file = PIPELINE_DRAFT_NODES_PATH) {
  const drafts = loadRaw(file)
  const next = drafts.filter((d) => d.id !== id)
  saveRaw(next, file)
  return next
}

export function mountPipelineDraftNodes(app, { file = PIPELINE_DRAFT_NODES_PATH } = {}) {
  app.get('/api/pipeline-draft-nodes', (_req, res) => res.json({ ok: true, ...loadDraftNodes(file) }))
  app.post('/api/pipeline-draft-nodes', (req, res) => {
    try { res.json({ ok: true, node: addDraftNode(req.body, file) }) }
    catch (e) { res.status(e.statusCode || 500).json({ ok: false, error: e.message }) }
  })
  app.delete('/api/pipeline-draft-nodes/:id', (req, res) => {
    try { res.json({ ok: true, drafts: removeDraftNode(req.params.id, file) }) }
    catch (e) { res.status(e.statusCode || 500).json({ ok: false, error: e.message }) }
  })
}
