// 모바일 상황실 "개발" 탭 — STATUS.md 를 그대로 읽어 최근 항목만 뽑아 보여준다.
// 새 저장소/정리 작업 없음(토큰 0, 파일 읽기만) — 성준님이 매 작업 끝에 남기는 STATUS.md 가
// 이미 항상 최신이라, 별도로 관리해야 하는 데이터 소스를 새로 만들지 않는다.
// (참고: 비슷한 용도로 보이는 Notion "작업·버그 로그" DB는 2026-08-10 이후 갱신이 멈춰 있어
// 여기엔 쓰지 않음 — 정리가 먼저 필요하면 별도 작업.)

import fs from 'node:fs'
import path from 'node:path'

const STATUS_PATH = path.join('C:\\yeori-studio\\app', 'STATUS.md')

// ### 날짜 (MCP 자동 기록) 같은 래퍼 헤딩 바로 다음 줄에 실제 제목(## ...)이 중첩되는
// 경우가 많아, 헤딩을 전부 섹션 경계로 보고 본문 없는 섹션(래퍼만 있던 것)은 걸러낸다.
export function statusFileMtime() {
  try { return fs.statSync(STATUS_PATH).mtime.toISOString() } catch { return null }
}

export function recentStatusEntries(limit = 12) {
  let text
  try { text = fs.readFileSync(STATUS_PATH, 'utf-8') } catch { return [] }
  const lines = text.split(/\r?\n/)
  const sections = []
  let cur = null
  for (const line of lines) {
    const m = line.match(/^(#{2,3})\s+(.+?)\s*$/)
    if (m) {
      if (cur) sections.push(cur)
      cur = { heading: m[2].replace(/\(MCP 자동 기록\)/, '').trim(), body: [] }
    } else if (cur) {
      const t = line.trim()
      if (t && t !== '---') cur.body.push(t)
    }
  }
  if (cur) sections.push(cur)

  return sections
    .filter(s => s.body.length > 0)
    .slice(-limit)
    .reverse()
    .map(s => ({
      heading: s.heading,
      snippet: s.body
        .filter(l => !/^#{1,4}\s/.test(l))
        .slice(0, 2)
        .map(l => l.replace(/^[-*]\s*/, '').replace(/\*\*/g, ''))
        .join(' · ')
        .slice(0, 220),
    }))
}
