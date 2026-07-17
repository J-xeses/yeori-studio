#!/usr/bin/env node
// STATUS.md 자동 갱신
// Usage: node scripts/update-status.js
//
// 1. 마지막 업데이트 날짜를 오늘 날짜로 갱신
// 2. git log 최신 20개 커밋 중 "✅ 완료된 것" 표에 없는 것을 새 행으로 추가
// 3. "🗺️ 자동화 전체 현황 (~NN%)" 제목의 NN%를 본문 ✅/🟡/⬜ 마커 집계로 재계산
// 4. downloads/gpoints.json, app/studio-state.json은 읽어서 콘솔/응답 요약에만 사용
//    (Step 섹션 프로즈는 사람이 직접 쓴 서술이라 자동으로 고쳐 쓰지 않음)
// 5. "🚨 다음 세션 즉시 할 것" 섹션은 절대 건드리지 않음 (사람이 관리)

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const MEDIA_ROOT = 'C:\\yeori-studio'
const CODE_ROOT = 'C:\\yeori-studio\\app'
const STATUS_PATH = path.join(CODE_ROOT, 'STATUS.md')

function todayDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getRecentCommits(n = 20) {
  const raw = execSync(`git log --oneline -${n}`, { cwd: MEDIA_ROOT, encoding: 'utf-8' })
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const m = line.match(/^([0-9a-f]+)\s+(.*)$/)
    return m ? { hash: m[1], subject: m[2] } : null
  }).filter(Boolean)
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function summarizeGPoints(gpoints) {
  if (!gpoints) return { totalCuts: 0, g5Done: 0 }
  const keys = Object.keys(gpoints)
  const g5Done = keys.filter(k => gpoints[k]?.g5).length
  return { totalCuts: keys.length, g5Done }
}

function summarizeStudioState(state) {
  const ep = state?.episode
  if (!ep) return null
  return { number: ep.number ?? null, title: ep.title || '' }
}

// "> 마지막 업데이트: YYYY-MM-DD (설명)" 줄의 날짜만 오늘 날짜로 교체
function updateHeaderDate(lines) {
  const idx = lines.findIndex(l => l.startsWith('> 마지막 업데이트:'))
  if (idx === -1) return
  lines[idx] = lines[idx].replace(/\d{4}-\d{2}-\d{2}/, todayDate())
}

// "## ✅ 완료된 것" 표에 없는 최신 커밋을 표 끝에 새 행으로 추가
function appendNewCommits(lines, commits) {
  const headingIdx = lines.findIndex(l => l.trim() === '## ✅ 완료된 것')
  if (headingIdx === -1) return []

  const sepIdx = lines.findIndex((l, i) => i > headingIdx && /^\|[-|]+\|$/.test(l.trim()))
  if (sepIdx === -1) return []

  let lastRowIdx = sepIdx
  for (let i = sepIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) lastRowIdx = i
    else break
  }

  const existingHashes = new Set()
  for (let i = sepIdx + 1; i <= lastRowIdx; i++) {
    for (const m of lines[i].matchAll(/커밋\s+([0-9a-f]{7,40})/g)) {
      existingHashes.add(m[1].slice(0, 7))
    }
  }

  const added = []
  const newRows = []
  for (const c of commits) {
    const short = c.hash.slice(0, 7)
    if (existingHashes.has(short)) continue
    if (/^merge:|STATUS\.md/i.test(c.subject)) continue // 자체 갱신/머지 커밋은 스킵
    newRows.push(`| 🆕 ${c.subject} | 커밋 ${short} |`)
    added.push(short)
  }

  if (newRows.length) lines.splice(lastRowIdx + 1, 0, ...newRows)
  return added
}

// "## 🗺️ 자동화 전체 현황 (~NN%)" 제목의 NN%를 본문 ✅/🟡/⬜ 마커 집계로 재계산
function recomputeAutomationPercent(lines) {
  const headingIdx = lines.findIndex(l => /^## 🗺️ 자동화 전체 현황 \(~\d+%\)$/.test(l.trim()))
  if (headingIdx === -1) return null

  let endIdx = lines.length
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break }
  }

  let score = 0, total = 0
  for (let i = headingIdx + 1; i < endIdx; i++) {
    for (const m of lines[i].matchAll(/(✅|🟡|⬜)/g)) {
      total++
      if (m[1] === '✅') score += 1
      else if (m[1] === '🟡') score += 0.5
    }
  }
  if (!total) return null

  const percent = Math.round((score / total) * 100)
  lines[headingIdx] = lines[headingIdx].replace(/\(~\d+%\)/, `(~${percent}%)`)
  return percent
}

function main() {
  if (!fs.existsSync(STATUS_PATH)) {
    console.error(`[ERROR] STATUS.md 없음: ${STATUS_PATH}`)
    process.exit(1)
  }

  const commits = getRecentCommits(20)
  const gpoints = readJsonSafe(path.join(MEDIA_ROOT, 'downloads', 'gpoints.json'))
  const studioState = readJsonSafe(path.join(CODE_ROOT, 'studio-state.json'))
  const gSummary = summarizeGPoints(gpoints)
  const epSummary = summarizeStudioState(studioState)

  const lines = fs.readFileSync(STATUS_PATH, 'utf-8').split('\n')

  updateHeaderDate(lines)
  const addedCommits = appendNewCommits(lines, commits)
  const percent = recomputeAutomationPercent(lines)

  fs.writeFileSync(STATUS_PATH, lines.join('\n'), 'utf-8')

  console.log(JSON.stringify({
    updatedAt: todayDate(),
    addedCommits,
    automationPercent: percent,
    gpoints: gSummary,
    activeEpisode: epSummary,
  }, null, 2))
}

main()
