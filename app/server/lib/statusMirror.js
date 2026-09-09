// STATUS.md 의 "최신 날짜 절"을 Notion 미러 페이지에 append + 중복 방지 상태 관리.
// 두 경로가 공유:
//   1) proxy.js /api/mcp/update-status-md (update_status_md MCP 도구) — 실시간
//   2) scripts/mirror-status-notion.js (git-auto-sync 훅) — 직접 편집·커밋 폴백
// 둘 다 같은 latestSection() 키 + 같은 상태파일을 써서 같은 절을 두 번 안 올린다.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const NOTION_VERSION = '2022-06-28'
export const NOTION_STATUS_PAGE_ID = '3d660cf6-afd9-81b2-8eea-c2ab6ffb5f2e'

const CODE_ROOT = 'C:\\yeori-studio\\app'
const DOWNLOADS = 'C:\\yeori-studio\\downloads'
export const STATUS_PATH = path.join(CODE_ROOT, 'STATUS.md')
const MIRROR_STATE_PATH = path.join(DOWNLOADS, 'state', '.status-mirror.json')

// STATUS.md 텍스트 → 마지막 "##|### YYYY-MM-DD …" 헤딩부터 EOF 까지가 최신 절.
export function latestSection(mdText) {
  const lines = String(mdText || '').split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,3}\s*\d{4}-\d{2}-\d{2}/.test(lines[i])) start = i
  }
  if (start === -1) return null
  const block = lines.slice(start).join('\n').replace(/\n+$/, '')
  const heading = lines[start].replace(/^#{2,3}\s*/, '').trim()
  const dateM = heading.match(/\d{4}-\d{2}-\d{2}/)
  const key = crypto.createHash('sha1').update(block).digest('hex').slice(0, 16)
  return { date: dateM ? dateM[0] : new Date().toISOString().slice(0, 10), heading, block, key }
}

export function readMirrorState() {
  try { return JSON.parse(fs.readFileSync(MIRROR_STATE_PATH, 'utf-8')) } catch { return {} }
}
export function writeMirrorState(key) {
  try {
    fs.mkdirSync(path.dirname(MIRROR_STATE_PATH), { recursive: true })
    fs.writeFileSync(MIRROR_STATE_PATH, JSON.stringify({ lastKey: key, at: new Date().toISOString() }, null, 2), 'utf-8')
  } catch { /* noop */ }
}

export function getNotionToken() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, 'studio-secrets.json'), 'utf-8'))
    return s.apiKeys?.notion || ''
  } catch { return '' }
}

// 로그 절을 divider + heading_3 + markdown code block 로 append.
// (마크다운 그대로 code block 에 넣으면 Notion 이 이스케이프·<br> 없이 깔끔히 렌더.)
// rich_text 요소당 2000자 제한 → code block 안에서 1800자 단위로 나눠 이어붙임.
export async function appendToNotionStatus(token, headingLabel, bodyText) {
  if (!token || !NOTION_STATUS_PAGE_ID) return { ok: false, skipped: 'no-token' }
  const elems = []
  let rest = String(bodyText || '') || '(내용 없음)'
  while (rest.length) { elems.push({ type: 'text', text: { content: rest.slice(0, 1800) } }); rest = rest.slice(1800) }
  const children = [
    { object: 'block', type: 'divider', divider: {} },
    { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: headingLabel } }] } },
    { object: 'block', type: 'code', code: { language: 'markdown', rich_text: elems } },
  ]
  try {
    const r = await fetch(`https://api.notion.com/v1/blocks/${NOTION_STATUS_PAGE_ID}/children`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ children }),
    })
    if (!r.ok) return { ok: false, status: r.status, body: (await r.text()).slice(0, 300) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// 최신 절이 아직 안 올라갔으면 올리고 상태 기록. label 로 미러 출처 구분.
export async function syncLatestStatusToNotion(label = '미러') {
  const token = getNotionToken()
  if (!token) return { ok: false, skipped: 'no-token' }
  const sec = latestSection(fs.readFileSync(STATUS_PATH, 'utf-8'))
  if (!sec) return { ok: false, skipped: 'no-section' }
  if (readMirrorState().lastKey === sec.key) return { ok: true, skipped: 'already-mirrored' }
  const r = await appendToNotionStatus(token, `${sec.date} (${label})`, sec.block)
  if (r.ok) writeMirrorState(sec.key)
  return r
}
