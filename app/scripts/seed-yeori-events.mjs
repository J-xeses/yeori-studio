// 감정이입 P5 사건 원장 시드 — 이미 만든 릴스 대본에서 한 번 채운다(이후는 G5 때 자동 기록). 다시 돌려도 코드별 덮어쓰기라 안전
import fs from 'node:fs'
import { parseCutsV3, parseV3GlobalHeader } from 'file:///C:/yeori-studio/app/server/lib/scriptParserV3.js'
import { recordEpisodeEvent, suggestCallbacks } from 'file:///C:/yeori-studio/app/server/lib/yeoriActive.js'
for (const c of ['IG_R03','IG_R04','IG_R05','IG_R06']) {
  const raw = fs.readFileSync(`C:/yeori-studio/downloads/seoyeori/IG/IG_R/${c}/01_script/${c}_script.txt`,'utf-8')
  const cuts = parseCutsV3(raw)
  const title = (raw.match(/에피소드명\s*[:：]\s*(.+)/) || [])[1]?.trim() || c
  recordEpisodeEvent({ code: c, title, cuts })
  console.log(c, title, cuts.length)
}
console.log(JSON.parse(fs.readFileSync('C:/yeori-studio/downloads/state/yeori-events.json','utf-8')).map(e=>[e.code,e.moments.length,e.people]))
console.log(suggestCallbacks())
