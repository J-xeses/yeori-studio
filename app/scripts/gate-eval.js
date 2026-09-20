#!/usr/bin/env node
// 승인 게이트 검수 CLI — 결정론적(AI 호출 없음, 토큰 0). 승인 자체는 하지 않고 판정만 출력한다.
//
//   node scripts/gate-eval.js G4            # 표 형식(사람용)
//   node scripts/gate-eval.js G3 --json     # JSON (서버/리더/스냅샷이 자식 프로세스로 호출)
//   node scripts/gate-eval.js all           # G1~G4 요약 한 줄씩
// 판정: approved 이미 승인 / auto_ok 위임 시 자동 승인 가능 / recommend 사람 1클릭 권고 / blocked 승인 금지 / not_ready 산출물 없음
// 기준 상세: docs/gate-approval-policy.md, 코드: server/lib/gatePolicy.js

import { evaluateEpisode } from '../server/lib/gatePolicy.js'

const args = process.argv.slice(2)
const gate = (args.find(a => !a.startsWith('--')) || 'G4').toUpperCase()
const json = args.includes('--json')
const gates = gate === 'ALL' ? ['G1', 'G2', 'G3', 'G4'] : [gate]
try {
  const results = gates.map(g => evaluateEpisode(g))
  if (json) console.log(JSON.stringify(gate === 'ALL' ? results : results[0]))
  else for (const r of results) {
    console.log(`\n[${r.gate}] ${r.episode} — ${JSON.stringify(r.tally)}  (정책: ${r.policy.why})`)
    if (gate !== 'ALL') for (const c of r.cuts) console.log(`  컷 ${String(c.no).padStart(2)} ${String(c.cutType).padEnd(8)} ${c.verdict.padEnd(10)} ${(c.reasons || []).join(' | ').slice(0, 120)}`)
  }
} catch (e) { console.error('ERROR:', e.message); process.exitCode = 1 }
