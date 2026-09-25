// ── 목소리 유사도(화자 임베딩) — 클립 음성이 인물 기준 음성과 같은 사람처럼 들리는지 ──────────
// 2026-09-25: Flow 는 목소리 ID 입력이 없어 클립마다 목소리가 달라질 수 있다(LF_T01 실측: 공식 목소리 대비 0.48~0.74,
// 같은 사람 수준 ≈0.78+). 프롬프트 고정 문구로 흔들림을 줄이고, 여기서 재서 기준 미만이면 사람 확인으로 넘긴다.
// scripts/voice_embed.py(Python) 사용 — 입력 {items:[{name,path}], reference:[path]} → {vsReference:[..]}
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const EMBED_PY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'voice_embed.py')
export const VOICE_SIM_MIN = 0.6     // 이 미만이면 "다른 사람 목소리"로 보고 사람 확인(실측: 벗어난 클립 0.48·0.55, 정상 0.61~0.74)

export function speakerSimilarity(clipPath, refPath) {
  if (!fs.existsSync(clipPath) || !fs.existsSync(refPath)) return null
  const cfg = path.join(os.tmpdir(), `voicesim_${process.pid}_${Date.now()}.json`)
  fs.writeFileSync(cfg, JSON.stringify({ items: [{ name: 'clip', path: clipPath }], reference: [refPath] }), 'utf-8')
  try {
    const o = spawnSync('python', [EMBED_PY, cfg], { encoding: 'utf-8', timeout: 180000 })
    const last = String(o.stdout || '').trim().split('\n').pop()
    const v = JSON.parse(last)?.vsReference?.[0]
    return Number.isFinite(v) ? v : null
  } catch { return null } finally { try { fs.unlinkSync(cfg) } catch { /* noop */ } }
}
