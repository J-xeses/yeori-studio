/**
 * 여리 스튜디오 - Flow 이미지 생성 (무료 경로 반자동화, 2026-09-21)
 *
 * 컷의 이미지 프롬프트(IP)와 캐릭터 레퍼런스를 Flow(Nano Banana)에 입력해 컷당 N장을 생성하고, 1K 원본을
 * 02_images/cut_NN_<슬롯>.jpg 로 저장한다. 화면 조작은 scripts/lib/flowDriver.js 의 이미지 모드.
 *
 * 사용법: node scripts/flow-image.js --job=<job.json 경로>
 *   job.json: { jobId, episodeCode, cutNos:[..], count?(2), model?('Nano Banana 2'), ratio?, dryRun?, maxPerDay?(180),
 *               minIntervalSec?(20), promptOverride?, projectId? }
 *
 * 안전장치
 *  - 하루 생성 장수 카운터(downloads/state/flow-image-usage.json). 한도(기본 180, Flow 무료 200장/일 여유분)를 넘기면 중단.
 *  - 컷 사이 최소 간격(기본 20초, 마지막 전송 시각은 같은 파일에 기록 → 다른 작업과 겹쳐도 지켜짐). 연속 생성 제재 방지.
 *  - 프롬프트는 한 줄로 입력하고 읽어서 원문과 일치하는지 검증한 뒤에만 전송(문장 단위로 잘려 엉뚱한 이미지가 대량 생성되던 사고 방지).
 *  - 전송 후에는 프롬프트·레퍼런스가 비워지므로 컷마다 레퍼런스를 다시 붙인다. 이미 있는 슬롯은 덮어쓰지 않고 다음 빈 슬롯(a~f)에 저장.
 *  - 진행 상황은 job.json 옆 <jobId>.status.json (서버 /api/flow/job/:id 가 읽음), 취소는 <jobId>.cancel 파일.
 */

import fs from 'fs'
import path from 'path'
import * as mp from '../server/lib/mediaPaths.js'
import { attachFlow, flowKit, sleep } from './lib/flowDriver.js'

const SERVER = 'http://localhost:3001'
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
if (!args.job) { console.error('--job=<경로> 필요'); process.exit(2) }
const job = JSON.parse(fs.readFileSync(args.job, 'utf-8'))
const statusPath = path.join(path.dirname(args.job), `${job.jobId}.status.json`)
const cancelPath = path.join(path.dirname(args.job), `${job.jobId}.cancel`)
const status = { jobId: job.jobId, state: 'running', startedAt: new Date().toISOString(), steps: [], result: { cuts: [] }, error: null }
const save = () => fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf-8')
const step = (msg) => { status.steps.push({ at: new Date().toISOString(), msg }); save(); console.log(msg) }
class Cancelled extends Error {}
const checkCancel = (where) => { if (fs.existsSync(cancelPath)) throw new Cancelled(where) }

const pad = (n) => String(n).padStart(2, '0')
const USAGE_PATH = mp.statePath('flow-image-usage.json')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const readUsage = () => {
  try { const u = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf-8')); return u.date === today() ? u : { date: today(), count: 0, lastSubmitAt: u.lastSubmitAt || 0 } }
  catch { return { date: today(), count: 0, lastSubmitAt: 0 } }
}
const writeUsage = (u) => { fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true }); fs.writeFileSync(USAGE_PATH, JSON.stringify(u, null, 2), 'utf-8') }

// ── 캐릭터 레퍼런스·descriptor (server/proxy.js 의 resolveChToCharacterIds/characterRefsAndDescriptors 와 같은 규칙) ──
const MEDIA_ROOT = path.resolve(mp.DOWNLOADS, '..')
function loadCharacters() { try { return JSON.parse(fs.readFileSync(mp.charactersJsonPath(), 'utf-8')) || {} } catch { return {} } }
function resolveCharIds(chRaw, chars) {
  const tokens = String(chRaw || '').split(/[+,/·]|\s{2,}/).map(s => s.trim().toUpperCase()).filter(Boolean)
  const ids = []
  for (const t of tokens) {
    for (const [id, c] of Object.entries(chars)) {
      if (id.toUpperCase() === t || String(c.name || '').toUpperCase() === t || (c.aliases || []).some(a => String(a).toUpperCase() === t)) { if (!ids.includes(id)) ids.push(id); break }
    }
  }
  if (!ids.length) { const p = Object.entries(chars).find(([, c]) => c.primary); if (p) ids.push(p[0]) }
  return ids
}
function refsAndDescriptors(ids, chars) {
  const refs = [], desc = []
  for (const id of ids) {
    const c = chars[id]; if (!c) continue
    for (const rel of [c.closeup, c.face].filter(Boolean)) { const abs = path.join(MEDIA_ROOT, rel); if (fs.existsSync(abs)) { refs.push(abs); break } }
    if (c.descriptor) desc.push(`${c.name || id}: ${c.descriptor}`)
  }
  return { refs, descriptorText: desc.join('\n') }
}

function nextSlots(imgDir, no, n) {
  const existing = (() => { try { return fs.readdirSync(imgDir) } catch { return [] } })()
  const used = new Set(existing.map(f => (f.match(new RegExp(`^cut_${pad(no)}_([a-z0-9]{1,2})\\.`)) || [])[1]).filter(Boolean))
  const free = []
  for (const s of 'abcdefghijklmnopqrstuvwxyz'.split('')) { if (!used.has(s)) free.push(s); if (free.length === n) break }
  return free
}

async function main() {
  const { episodeCode, cutNos = [] } = job
  const count = job.count || 2
  const model = job.model || 'Nano Banana 2'
  const maxPerDay = job.maxPerDay ?? 180
  const minIntervalSec = job.minIntervalSec ?? 20
  if (!episodeCode || !cutNos.length) throw new Error('episodeCode, cutNos 필요')

  const st = await (await fetch(`${SERVER}/api/studio-state`)).json()
  const S = st.d || st
  const ep = Object.values(S.episodes || {}).find(e => e.episode?.code === episodeCode)
  if (!ep) throw new Error(`에피소드 ${episodeCode} 를 찾지 못했습니다`)
  const imgDir = mp.imagesDir(episodeCode)
  const chars = loadCharacters()

  let projectId = job.projectId
  if (!projectId) { try { projectId = JSON.parse(fs.readFileSync(mp.statePath('flow-image-project.json'), 'utf-8')).projectId } catch { /* noop */ } }
  if (!projectId) throw new Error('이미지용 Flow 프로젝트가 지정되지 않았습니다(downloads/state/flow-image-project.json)')

  // 대상 컷·프롬프트를 먼저 전부 만들어 문제가 있으면 화면 조작 전에 중단
  const plan = []
  for (const no of cutNos) {
    const cut = (ep.cuts || []).find(c => c.no === no)
    if (!cut) throw new Error(`컷 ${no} 를 찾지 못했습니다`)
    if (['GRAPHIC', 'CAPCUT'].includes(cut.cutType)) { step(`컷 ${no}: ${cut.cutType} 컷이라 건너뜀`); continue }
    const base = (job.promptOverride && cutNos.length === 1 ? job.promptOverride : (cut.imagePrompt || cut.ip || '')).trim()
    if (!base) { step(`컷 ${no}: 이미지 프롬프트가 없어 건너뜀`); continue }
    const ids = resolveCharIds(cut.masterCode?.ch, chars)
    const { refs, descriptorText } = refsAndDescriptors(ids, chars)
    // 추가 레퍼런스(의상·분위기 기준 이미지): 캐릭터 얼굴 레퍼런스 뒤에 붙이고, 프롬프트에 역할을 알려 준다.
    const extra = (job.extraRefs || []).map(r => path.resolve(String(r))).filter(r => r.toLowerCase().startsWith(path.resolve(mp.DOWNLOADS).toLowerCase()) && fs.existsSync(r))
    if ((job.extraRefs || []).length !== extra.length) throw new Error('extraRefs 는 downloads 폴더 안의 존재하는 파일이어야 합니다')
    const allRefs = [...refs, ...extra]
    const roleNote = extra.length ? ' The first attached image is the reference face; the other attached image(s) are the outfit and overall look reference — keep the same cream oversized knit top style, jewelry and natural styling, while following the pose and scene described above.' : ''
    const prompt = descriptorText ? `${base}\n\n[Character consistency — the attached image is the reference face. Keep the face identical to it:]\n${descriptorText}${roleNote}` : base + roleNote
    const ratio = job.ratio || (base.match(/\b(16:9|9:16|1:1|4:3|3:4)\b/) || [])[1] || (/^(LF|SF)_/.test(episodeCode) ? '16:9' : '9:16')
    plan.push({ no, prompt, refs: allRefs, ratio, ids })
  }
  if (!plan.length) throw new Error('생성할 컷이 없습니다')
  step(`대상 ${plan.length}컷 · 컷당 ${count}장 · ${model}`)

  const { page, release, emulated } = await attachFlow({ projectId })
  const kit = flowKit(page)
  try {
    if (emulated) step('Flow 창이 작아 화면 크기를 임시 보정')
    for (const p of plan) {
      checkCancel(`컷 ${p.no} 시작 전`)
      const u = readUsage()
      if (u.count + count > maxPerDay && !job.dryRun) throw new Error(`오늘 생성 한도 도달(${u.count}/${maxPerDay}장) — 내일 다시 시도하세요`)
      const cutRes = { no: p.no, files: [], refs: p.refs.length }
      status.result.cuts.push(cutRes)

      await kit.backToList()
      await kit.setImageMode()
      await kit.setImageModel(model)
      await kit.setImageRatio(p.ratio)
      await kit.setImageCount(count)
      await kit.closeImagePopup()
      await kit.resetPromptBar()
      for (const r of p.refs) { const a = await kit.attachReference(r); step(`컷 ${p.no}: 레퍼런스 첨부(${path.basename(r)}, 현재 ${a.refCount}개)`) }
      await kit.fillPrompt(p.prompt)
      step(`컷 ${p.no}: 프롬프트 ${p.prompt.length}자 입력`)
      const gate = await kit.verifyImageGate({ model, ratio: p.ratio, count, refs: p.refs.length, prompt: p.prompt })
      step(`컷 ${p.no}: 검증 관문 ${gate.ok ? '통과' : '실패'} (${gate.pill})`)
      if (!gate.ok) throw new Error('검증 관문 실패 — 전송하지 않음: ' + gate.problems.join(' / '))
      if (job.dryRun) { step(`컷 ${p.no}: dryRun — 전송 없이 비움`); await kit.clearPromptBar(); await kit.clearPrompt().catch(() => {}); continue }

      // 컷 사이 최소 간격
      const wait = Math.max(0, minIntervalSec * 1000 - (Date.now() - (readUsage().lastSubmitAt || 0)))
      if (wait > 0) { step(`연속 생성 제재 방지: ${Math.ceil(wait / 1000)}초 대기`); await sleep(wait) }
      checkCancel(`컷 ${p.no} 전송 직전`)

      const before = await kit.imageSnapshot()
      await kit.submit()
      const u2 = readUsage(); u2.lastSubmitAt = Date.now(); u2.count += count; writeUsage(u2)     // 전송한 순간 차감(실패해도 한도 보수적으로)
      step(`컷 ${p.no}: 전송(오늘 ${u2.count}/${maxPerDay}장) — 생성 대기`)
      await sleep(3000)
      const res = await kit.waitForImages(before, count, { onTick: (s) => { if (s.sec % 15 === 0) step(`컷 ${p.no}: 생성 중… ${s.sec}초 (새 타일 ${s.fresh}/${count})`) } })
      if (res.status !== 'done') throw new Error(`컷 ${p.no}: 4분 안에 ${count}장이 나오지 않았습니다(Flow 화면을 확인하세요)`)
      const slots = nextSlots(imgDir, p.no, res.srcs.length)
      // 타일은 최신이 앞쪽 — 화면 순서 그대로 a, b… 로 배정
      for (let i = 0; i < res.srcs.length; i++) {
        const out = path.join(imgDir, `cut_${pad(p.no)}_${slots[i]}.jpg`)
        const bytes = await kit.saveImage(res.srcs[i], out)
        cutRes.files.push({ file: path.basename(out), bytes })
        step(`컷 ${p.no}: 저장 ${path.basename(out)} (${Math.round(bytes / 1024)}KB)`)
      }
      save()
    }
  } finally {
    await kit.clearPromptBar().catch(() => {})
    await kit.closeImagePopup().catch(() => {})
    await release()
  }
}

main()
  .then(() => { status.state = 'done'; status.finishedAt = new Date().toISOString(); save(); process.exit(0) })
  .catch((e) => { status.state = e instanceof Cancelled ? 'cancelled' : 'failed'; status.error = e instanceof Cancelled ? `취소됨(${e.message})` : e.message; status.finishedAt = new Date().toISOString(); save(); console.error('ERROR:', e.message); process.exit(1) })
