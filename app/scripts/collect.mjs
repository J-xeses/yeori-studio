// 수집함 갱신 + 정리 — C:\yeori-studio\collect.bat 더블클릭용(서버 버튼 "새로 가져오기"와 같은 일).
// 핀터레스트 보드·유튜브 '벤치마킹 영상' 재생목록의 새 항목을 가져오고, 새로 담긴 것(북마클릿 포함)을 Haiku 로 정리한다.
import { runCollect, collectStatus } from '../server/lib/collectHub.js'

console.log('수집함 — 새 항목 가져오기 + 자동 정리')
const r = await runCollect({ log: (l) => console.log(l) })
const c = collectStatus().counts
console.log(`\n새로 가져옴 ${r.fresh}개 · 이번에 정리 ${r.processed ?? 0}개 · 전체 ${Object.values(c).reduce((a, b) => a + b, 0)}개`)
console.log('레퍼런스 보드: http://localhost:3001/downloads/_shared/references/library/index.html')
await new Promise((res) => setTimeout(res, 100))
process.exit(0)
