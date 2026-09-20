#!/usr/bin/env node
// 마스터 허브 "현재 상태" 블록 수동 갱신 / 규칙 검토일 기록. ★ AI 호출 없음(토큰 0) ★
//
// 평소에는 update_status_md 와 시간별 git-auto-sync(mirror-status-notion.js) 가 자동으로 부른다. 이 스크립트는 수동용:
//   node scripts/hub-refresh.js                    # 지금 강제 갱신
//   node scripts/hub-refresh.js --mark-reviewed    # 허브 "확정 규칙" 섹션을 방금 점검·수정했을 때(검토일=오늘) + 갱신
//   node scripts/hub-refresh.js --print            # Notion 에 쓰지 않고 내용만 출력
//   node scripts/hub-refresh.js --set-block=<블록ID>  # 스냅샷 callout 블록 ID 등록(최초 1회)

import { refreshHubSnapshot, buildSnapshotLines, markRulesReviewed, setSnapshotBlockId } from '../server/lib/hubSnapshot.js'

const args = process.argv.slice(2)
const has = (k) => args.some(a => a === `--${k}` || a.startsWith(`--${k}=`))
const val = (k) => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1]

if (has('set-block')) { setSnapshotBlockId(val('set-block')); console.log('[hub-refresh] 블록 ID 등록:', val('set-block')) }
if (has('mark-reviewed')) console.log('[hub-refresh] 규칙 검토일 기록:', markRulesReviewed())
if (has('print')) { console.log(buildSnapshotLines().join('\n')) }
else {
  const r = await refreshHubSnapshot('수동', { force: true })
  console.log('[hub-refresh]', JSON.stringify(r))
}
process.exitCode = 0   // process.exit() 는 fetch 소켓 정리 중 assert 를 유발할 수 있어 쓰지 않음
