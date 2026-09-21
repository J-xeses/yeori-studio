/**
 * 여리 스튜디오 - Flow 클립 1개 제출 (무료 경로 반자동화, 2026-09-21)
 *
 * 스튜디오의 프롬프트/시작 프레임을 Flow에 입력하고, 검증 관문을 통과하면 생성 → 완료 감지 → 다운로드 →
 * 04_making/raw/cut_NN_clip_K.mp4 로 저장한다. 화면 조작은 scripts/lib/flowDriver.js.
 *
 * 사용법:
 *   node scripts/flow-submit.js --job=<job.json 경로>
 *   job.json: { jobId, epNum, cutNo, clipNo, prevClipPath?, model?, durationSec?, maxCredits?, dryRun?, overwrite? }
 *
 * - clipNo=1(또는 세그 없는 컷): 시작 프레임 = G2 승인 이미지.  clipNo>1: 시작 프레임 = prevClipPath 영상의 마지막 프레임.
 * - dryRun=true: 시작 프레임·프롬프트 입력과 검증 관문까지만(전송 안 함).
 * - 진행 상황은 job.json 옆 <jobId>.status.json 에 기록(서버가 읽어 UI에 전달).
 * - 안전: 검증 관문 실패 시 전송하지 않는다. 대상 파일이 이미 있으면 overwrite 없이는 중단.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import * as mp from '../server/lib/mediaPaths.js'
import { attachFlow, flowKit, sleep } from './lib/flowDriver.js'

const SERVER = 'http://localhost:3001'
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
if (!args.job) { console.error('--job=<경로> 필요'); process.exit(2) }
const job = JSON.parse(fs.readFileSync(args.job, 'utf-8'))
const statusPath = path.join(path.dirname(args.job), `${job.jobId}.status.json`)
const status = { jobId: job.jobId, state: 'running', startedAt: new Date().toISOString(), steps: [], result: null, error: null }
const save = () => fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf-8')
// 취소: 서버가 <jobId>.cancel 파일을 만들면 단계 사이에서 중단한다. 전송 전이면 깔끔히 정리하고 끝나고, 전송 후라면
// Flow 쪽 생성은 멈출 수 없으므로 기다리기만 그만둔다(결과는 Flow에 남는다).
const cancelPath = path.join(path.dirname(args.job), `${job.jobId}.cancel`)
class Cancelled extends Error {}
const checkCancel = (where) => { if (fs.existsSync(cancelPath)) throw new Cancelled(where) }
const step = (msg) => { status.steps.push({ at: new Date().toISOString(), msg }); save(); console.log(msg) }

// ── 프롬프트 추출 ───────────────────────────────────────────────────
// VP는 세그 컷이면 "[Clip k/N — Ns]" 블록들로 나뉜다. 클립 k의 프롬프트 = 그 클립의 비주얼 서술 + 클립 지시(마커부터 빈 줄까지).
// 세그 없는 컷은 VP 본문(발화 안내/후처리 메모 제외)에, 대사 컷이면 "대사를 한국어로 말한다" 지시를 덧붙인다.
export function extractClipPrompt(vp, segPrompts, k) {
  let text = String(vp || '').replace(/\r/g, '')
  const footerAt = text.search(/^생성:/m)
  if (footerAt >= 0) text = text.slice(0, footerAt)
  const headerLines = /^(━━━.*|유형:.*|전체 대사\(참고용\):.*)$/gm
  const dl = (text.match(/^대사:\s*"([\s\S]*?)"\s*$/m) || [])[1]
  const isDialogue = /^유형:\s*대사/m.test(text)
  text = text.replace(headerLines, '').replace(/^(대사|나레이션\(VO\)):.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

  const markers = [...text.matchAll(/\[Clip (\d+)\/(\d+)[^\]]*\]/g)]
  if (!markers.length) {
    if (isDialogue && dl) {
      const line = dl.split('||').map(s => s.trim()).filter(Boolean).join(' ')
      return `${text}\n\nShe speaks this line in Korean, lips synced to it: "${line}". No on-screen subtitle text or captions — dialogue is spoken audio only.`
    }
    return text
  }
  const m = markers.find(x => Number(x[1]) === k)
  if (!m) throw new Error(`VP에서 Clip ${k} 블록을 찾지 못했습니다`)
  const tailStart = m.index
  const blank = text.indexOf('\n\n', tailStart)
  const tail = text.slice(tailStart, blank < 0 ? text.length : blank).trim()
  let visual = Array.isArray(segPrompts) && segPrompts[k - 1] ? String(segPrompts[k - 1]).trim() : ''
  if (!visual) {
    const idx = markers.indexOf(m)
    const prevEnd = idx === 0 ? 0 : (() => { const pe = text.indexOf('\n\n', markers[idx - 1].index); return pe < 0 ? 0 : pe })()
    visual = text.slice(prevEnd, tailStart).trim()
    if (!visual) visual = text.slice(0, markers[0].index).trim()
  }
  return `${visual}\n\n${tail}`.trim()
}

const pad = (n) => String(n).padStart(2, '0')
const run = (file, argv) => execFileSync(file, argv, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })

async function main() {
  const { epNum, cutNo, clipNo = 1 } = job
  const model = job.model || 'Omni 1.1 Flash'
  const durationSec = job.durationSec || 8
  const maxCredits = job.maxCredits ?? 15
  // 화면 비율: 지정이 없으면 콘텐츠 유형으로 판단(LF/SF 유튜브 = 16:9, IG/TK 릴스 = 9:16)
  let ratio = job.ratio || null

  step(`컷 ${cutNo} 클립 ${clipNo} 준비`)
  const chk = await (await fetch(`${SERVER}/api/episode-video-checklist?epNum=${epNum}`)).json()
  const chkCut = (chk.cuts || []).find(c => c.no === cutNo)
  if (!ratio) ratio = /^(LF|SF)/i.test(String(chk.contentType || '')) ? '16:9' : '9:16'
  if (!chkCut) throw new Error(`컷 ${cutNo}을(를) 찾지 못했습니다`)
  const st = await (await fetch(`${SERVER}/api/studio-state`)).json()
  const stCut = ((st.d || st).cuts || []).find(c => c.no === cutNo)
  let prompt = extractClipPrompt(chkCut.videoPrompt, stCut?.segPrompts, Number(clipNo))
  step(`프롬프트 ${prompt.length}자 추출`)

  const outPath = path.join(mp.makingDir(epNum), 'raw', `cut_${pad(cutNo)}_clip_${clipNo}.mp4`)
  if (!job.dryRun && fs.existsSync(outPath) && !job.overwrite) throw new Error(`이미 있는 파일입니다(덮어쓰지 않음): ${path.basename(outPath)}`)

  // 시작 프레임
  let framePath
  if (Number(clipNo) > 1) {
    if (!job.prevClipPath || !fs.existsSync(job.prevClipPath)) throw new Error(`이전 클립(${clipNo - 1}번) 영상 파일이 필요합니다`)
    framePath = path.join(os.tmpdir(), `cut_${pad(cutNo)}_clip${clipNo - 1}_last.jpg`)
    run('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.1', '-i', job.prevClipPath, '-frames:v', '1', '-q:v', '2', framePath])
    step(`이전 클립 마지막 프레임 추출`)
  } else {
    const u = chkCut.startFrame
    if (!u) throw new Error('G2 승인 이미지(시작 프레임)가 없습니다')
    framePath = path.join(mp.DOWNLOADS, decodeURIComponent(new URL(u).pathname.replace(/^\/downloads\//, '')))
    if (!fs.existsSync(framePath)) throw new Error(`시작 프레임 파일이 없습니다: ${framePath}`)
    step('G2 승인 이미지를 시작 프레임으로 사용')
  }

  // 시작 프레임 직접 지정(예: 앞 컷 영상의 마지막 프레임으로 이어 붙일 때). downloads 폴더 안의 파일만 허용.
  if (job.startFramePath) {
    const sf = path.resolve(String(job.startFramePath))
    if (!sf.toLowerCase().startsWith(path.resolve(mp.DOWNLOADS).toLowerCase()) || !fs.existsSync(sf)) throw new Error('startFramePath 는 downloads 폴더 안의 존재하는 파일이어야 합니다')
    framePath = sf
    step(`시작 프레임을 직접 지정: ${path.basename(sf)}`)
  }
  // 프롬프트 직접 지정(컷의 VP 대신): 대사 컷이면 "한국어로 말한다" 지시는 그대로 덧붙인다.
  if (job.promptOverride) {
    const dlg = String(stCut?.dialogue || chkCut.dialogue || '').trim()
    prompt = dlg
      ? `${String(job.promptOverride).trim()}\n\nShe speaks this line in Korean, lips synced to it: "${dlg}". No on-screen subtitle text or captions — dialogue is spoken audio only.`
      : String(job.promptOverride).trim()
    step(`프롬프트를 직접 지정(${prompt.length}자)`)
  }

  checkCancel('입력 시작 전')
  // 영상 제출은 한글 화면 기준으로 만들어져 있다 — 프로젝트 주소에 ?hl=ko 를 붙여 맞춘다(영상 전용 프로젝트는 downloads/state/flow-video-project.json).
  let projectId = job.projectId
  if (!projectId) { try { projectId = JSON.parse(fs.readFileSync(mp.statePath('flow-video-project.json'), 'utf-8')).projectId } catch { /* noop */ } }
  const { page, release, emulated } = await attachFlow({ projectId: projectId || null, lang: 'ko' })
  const kit = flowKit(page)
  try {
    if (emulated) step('Flow 창이 작아 화면 크기를 임시 보정')
    await kit.setVideoMode()
    await kit.setModel(model)
    await kit.setRatio(ratio)
    await kit.setCount(1)        // 영상은 항상 x1 (이미지 작업이 x2로 남겨 둔 값이 넘어오지 않게 명시적으로 지정)
    if (model.startsWith('Omni')) await kit.setDuration(durationSec)
    // 입력 방식: frames(기본) = 시작 프레임 슬롯 / ingredients = "소재" 참조 이미지(컷 이미지 + 서여리 클로즈업 얼굴)
    const mode = job.mode === 'ingredients' ? 'ingredients' : 'frames'
    let finalPrompt = prompt
    let refCount = null
    if (mode === 'ingredients') {
      let chars = {}
      try { chars = JSON.parse(fs.readFileSync(mp.charactersJsonPath(), 'utf-8')) || {} } catch { /* noop */ }
      const prim = Object.values(chars).find(c => c.primary)
      const root = path.resolve(mp.DOWNLOADS, '..')
      const closeup = prim ? [prim.closeup, prim.face].filter(Boolean).map(r => path.join(root, r)).find(f => fs.existsSync(f)) : null
      const refs = [framePath, ...(closeup ? [closeup] : [])]
      step(`소재 모드: 참조 이미지 ${refs.length}장(${refs.map(r => path.basename(r)).join(', ')})`)
      await kit.setSubMode('ingredients'); await kit.closePopup()
      await kit.resetPromptBar()
      for (const r of refs) { const a = await kit.attachReference(r); step(`참조 이미지 첨부: ${path.basename(r)} (현재 ${a.refCount}장)`) }
      refCount = refs.length
      finalPrompt = `${prompt}\n\nThe first attached image is the exact starting scene, pose and outfit of this shot; the second attached image is the character's face reference — keep the face identical to it.`
    } else {
      step('시작 프레임 업로드·지정')
      await kit.attachStartFrame(framePath)
      // 종료 프레임(선택): 표정·시선이 바뀌는 컷은 끝 장면 이미지를 함께 지정해 움직임의 도착점을 잡아 준다.
      if (job.endFrame) {
        const ef = path.resolve(String(job.endFrame))
        if (!ef.toLowerCase().startsWith(path.resolve(mp.DOWNLOADS).toLowerCase()) || !fs.existsSync(ef)) throw new Error('endFrame 은 downloads 폴더 안의 존재하는 파일이어야 합니다')
        step(`종료 프레임 업로드·지정: ${path.basename(ef)}`)
        await kit.attachEndFrame(ef)
      }
    }
    await kit.fillPrompt(finalPrompt)
    step('프롬프트 입력 완료')
    const gate = await kit.verifyGate({ model, ratio, durationSec, maxCredits, prompt: finalPrompt, startFrame: mode === 'frames', endFrame: mode === 'frames' && !!job.endFrame, refs: refCount })
    step(`검증 관문: ${gate.ok ? '통과' : '실패'} (모델 ${gate.model}, ${gate.credits}크레딧)`)
    if (!gate.ok) throw new Error('검증 관문 실패 — 전송하지 않음: ' + gate.problems.join(' / '))
    status.result = { gate: { model: gate.model, credits: gate.credits }, dryRun: !!job.dryRun }
    save()
    if (job.dryRun) { step('dryRun — 전송 없이 종료'); return }

    checkCancel('전송 직전')
    const before = await kit.mediaSnapshot()
    await kit.submit()
    step('Flow에 전송했습니다 — 생성 대기')
    await sleep(3000)
    const res = await kit.waitForResult(before, { timeoutMs: 8 * 60 * 1000, shouldStop: () => fs.existsSync(cancelPath), onTick: (s) => { if (s.sec % 20 === 0) step(`생성 중… ${s.sec}초 ${(s.progress || []).join(' ')}`) } })
    if (res.status === 'cancelled') throw new Cancelled('전송 후 생성 대기 중 — Flow에서는 생성이 계속되니 완료되면 직접 받으세요')
    if (res.status === 'failed') throw new Error(res.reason)
    if (res.status !== 'done') throw new Error('8분 안에 생성이 끝나지 않았습니다')
    step('생성 완료 — 다운로드')
    const bytes = await kit.saveResult(res.thumbSrc, outPath)
    let dur = null
    try { dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath]).trim()) } catch { /* noop */ }
    status.result = { ...status.result, path: outPath, name: path.basename(outPath), bytes, duration: dur }
    step(`저장 완료: ${path.basename(outPath)} (${Math.round(bytes / 1024)}KB, ${dur?.toFixed?.(1)}초)`)
  } finally {
    await kit.clearPrompt().catch(() => {})
    await kit.clearStartFrame().catch(() => {})
    await kit.clearPromptBar().catch(() => {})
    await kit.setSubMode('ingredients').catch(() => {})
    await kit.closePopup().catch(() => {})
    await release()
  }
}

main()
  .then(() => { status.state = 'done'; status.finishedAt = new Date().toISOString(); save(); process.exit(0) })
  .catch((e) => { status.state = e instanceof Cancelled ? 'cancelled' : 'failed'; status.error = e instanceof Cancelled ? `취소됨(${e.message})` : e.message; status.finishedAt = new Date().toISOString(); save(); console.error('ERROR:', e.message); process.exit(1) })
