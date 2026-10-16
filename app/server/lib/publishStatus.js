// 퍼블리싱 탭 ④업로드 실제 게시 기록 저장소 — 2026-10-16 신설.
// 지금까지는 게시 성공 여부가 PublishingTab의 React state(새로고침하면 사라짐)에만
// 있어서, 이미 올린 에피소드인지 다른 탭/세션에서는 알 수 없었다. 성준님 요청:
// "업로드된 현황"을 퍼블리싱 탭에서 보고, "업로드된 에피소드" 표시를 에피소드 목록
// 사이드바(모든 탭에서 공통으로 보이는 좌측 목록)에도 일괄 반영.
// 구조: { [epNum]: { [platform]: { publishedAt, permalink, mediaId, caption } } }
import fs from 'fs'
import path from 'path'
import { statePath } from './mediaPaths.js'

const FILE = statePath('publish-status.json')

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf-8')) } catch { return {} }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

export function getAllPublishStatus() {
  return readAll()
}

export function getPublishStatus(epNum) {
  return readAll()[String(epNum)] || {}
}

export function markPublished(epNum, platform, data) {
  const all = readAll()
  const key = String(epNum)
  all[key] = { ...(all[key] || {}), [platform]: { publishedAt: Date.now(), ...data } }
  writeAll(all)
  return all[key]
}
