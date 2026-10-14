// ── 스토리 아카이브 영구 저장소(2026-10-14) ───────────────────────────────
// 배경: StoryArchiveTab.jsx의 "💾 저장" 버튼이 순수 React state에만 저장돼 있어서
// 새로고침·탭 전환하면 전부 사라지는 버그가 있었음(성준님 실측 지적 — "스토리 아카이브를
// 잘 활용하면 아이디어가 풍부하게 만들어질 것 같은데" → 안 쓰셨던 진짜 이유로 추정).
// signatureRefs.js와 동일한 패턴(런타임 파일 저장소)으로 실제 영속화한다.
// type: 'idea'(단편 아이디어) | 'series'(시리즈 기획) | 'benchmark'(연출기법/트렌드 벤치마킹
// — 2026-10-13 "연출 재료 정기 리서치"의 결과물을 앱 안에서도 보고 쌓을 수 있게 하는 신규 축).
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

function storePath() {
  return path.join(mp.DOWNLOADS, '_shared', 'story-archive', 'index.json')
}

export function listEntries(type) {
  let list
  try { list = JSON.parse(fs.readFileSync(storePath(), 'utf-8')) } catch { list = [] }
  return type ? list.filter((e) => e.type === type) : list
}

// entry: { id?, type, title, description, content?, tags?, source?, savedAt? }
// idea/series는 content에 원본 생성 객체(JSON)를, benchmark는 description/source 위주로 채움.
export function saveEntry(entry) {
  if (!entry?.type || !entry?.title) throw new Error('type, title 필요')
  const list = listEntries()
  const id = entry.id || `${entry.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const existing = list.findIndex((e) => e.id === id)
  const saved = {
    id,
    type: entry.type,
    title: entry.title,
    description: entry.description || '',
    content: entry.content ?? null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    source: entry.source || '',
    createdAt: existing >= 0 ? list[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (existing >= 0) list[existing] = saved; else list.unshift(saved)
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf-8')
  return saved
}

export function deleteEntry(id) {
  const list = listEntries().filter((e) => e.id !== id)
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf-8')
}
