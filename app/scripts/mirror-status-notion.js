#!/usr/bin/env node
// STATUS.md 최신 절을 Notion 미러 페이지에 반영 (아직 안 올라간 경우만).
// git-auto-sync.ps1 이 매 사이클 호출 — update_status_md MCP 경로가 놓치는
// "직접 파일 편집 / git 커밋" 케이스를 잡는다. 중복은 .status-mirror.json 로 방지.
//
// Usage: node scripts/mirror-status-notion.js

import { syncLatestStatusToNotion } from '../server/lib/statusMirror.js'

const r = await syncLatestStatusToNotion('git-sync')
if (r.skipped) console.log(`[mirror-status] skip: ${r.skipped}`)
else if (r.ok) console.log('[mirror-status] Notion 미러 완료')
else console.log(`[mirror-status] 실패: ${r.status || r.error || '?'} ${r.body || ''}`)
// 미러 실패해도 auto-sync 는 계속 — exit code 0 유지. process.exit() 는 fetch 소켓
// 정리 중 libuv assertion 을 유발할 수 있어 안 씀(자연 종료).
process.exitCode = 0
