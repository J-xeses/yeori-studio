// ── 컷 끼워넣기(2026-11-08) — 시그/체인지/프리즈/카메라 4개 모드 공유 "연결루트" ──────
// 배경: 네 모드(시그 레퍼런스·체인지 생성기·프리즈 비트·카메라 연출) 모두 "적용 = 기존 컷에
// 패치"가 기본 동작이지만, 연출 보완·수정 시점에 "이미 짜둔 전체 컷 사이에 새 훅/리빌 컷을
// 하나 끼워넣고 싶다"는 요청이 반복된다(2026-11-08, SF_E02 CUT1↔CUT2 사이 드론 훅).
//
// v3 스크립트 파서(ScriptGenTab.jsx의 V3_CUT_HEADER_RE, server/lib/scriptParserV3.js와 동일)는
// "[CUT <정수>]" 형식만 인식한다 — "[CUT 1.5]" 같은 소수점 표기는 파서가 그냥 못 읽고 그 블록
// 전체가 조용히 버려진다(2026-11-08 실측 발견). 그래서 진짜 끼워넣기는 삽입 지점 다음 컷부터
// 번호를 전부 +1 밀어야 하고, 02_images~07_output 각 단계 폴더에 이미 생성된 cut_NN.* 파일도
// 같이 밀어야 한다(안 밀면 "번호는 바뀌었는데 파일은 그대로"라는, 이 프로젝트가 이미 여러 번
// 겪은 상태↔파일 불일치 버그가 그대로 재현된다 — project_g4g5_flag_vs_file_integrity_gap).
// G포인트(gpoints.json)도 cut_N 키로 저장되므로 동일하게 밀어야 승인 현황이 안 뒤틀린다.
//
// dryRun(기본값)은 디스크를 건드리지 않고 "무엇이 바뀔지"만 계산해 돌려준다 — 프런트가 미리보기
// 보여준 뒤 사람이 "확정"을 눌러야만 commit:true로 실제 실행(기존 체인지/프리즈 패널의
// "미리보기 → 반영" 2단계 패턴과 동일).
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

const CUT_HEADER_RE = /^(\[CUT\s+)(\d+)(\]\s*.*)$/
const STAGE_DIR_FNS = {
  images: mp.imagesDir,
  audio: mp.audioDir,
  making: mp.makingDir,
  video: mp.videoDir,
  output: mp.outputDir,
  final: mp.finalDir,
}

function pad(n) { return String(n).padStart(2, '0') }

function safeList(dir) {
  try { return fs.readdirSync(dir) } catch { return [] }
}

// dir 1단계(하위폴더 안 뒤짐)에서 "cut_NN"으로 시작하는 항목들의 최댓값 컷 번호
function maxCutNoIn(dir) {
  let max = 0
  for (const name of safeList(dir)) {
    const m = name.match(/^cut_(\d+)/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max
}

// dir 안의 "cut_{fromNo}"로 시작하는 모든 항목(cut_05.mp4, cut_05_overlay.mp4, cut_05_overlay_
// config.json …)을 "cut_{toNo}"로 이름만 바꾼다. fromNo를 내림차순으로 호출하는 쪽(呼출부)이
// 책임져야 충돌 없이 안전 — cut_06→cut_07을 먼저 옮겨 07 자리를 비워야 cut_05→cut_06이 그
// 자리에 안전하게 들어간다.
function renameCutFilesInDir(dir, fromNo, toNo, plan, dryRun) {
  const fromP = pad(fromNo), toP = pad(toNo)
  for (const name of safeList(dir)) {
    if (!name.startsWith(`cut_${fromP}`)) continue
    const rest = name.slice(`cut_${fromP}`.length)
    if (/^\d/.test(rest)) continue // cut_050... 같은 우연한 접두사 오염 방지(다음 글자가 숫자면 실제론 다른 번호)
    const newName = `cut_${toP}${rest}`
    plan.push({ dir, from: name, to: newName })
    if (!dryRun) fs.renameSync(path.join(dir, name), path.join(dir, newName))
  }
}

function shiftGpoints(episodeCode, afterCutNo, maxNo, dryRun) {
  const gpPath = mp.statePath('gpoints.json')
  let data
  try { data = JSON.parse(fs.readFileSync(gpPath, 'utf-8')) } catch { return [] }
  const epData = data[episodeCode]
  if (!epData) return []
  const plan = []
  for (let k = maxNo; k > afterCutNo; k--) {
    if (epData[`cut_${k}`]) plan.push({ from: `cut_${k}`, to: `cut_${k + 1}` })
  }
  if (!dryRun && plan.length) {
    const next = {}
    for (const [k, v] of Object.entries(epData)) {
      const m = k.match(/^cut_(\d+)$/)
      next[m && parseInt(m[1], 10) > afterCutNo ? `cut_${parseInt(m[1], 10) + 1}` : k] = v
    }
    data[episodeCode] = next
    fs.writeFileSync(gpPath, JSON.stringify(data, null, 2), 'utf-8')
  }
  return plan
}

// 대본 텍스트: afterCutNo보다 큰 모든 "[CUT N]" 헤더를 N+1로 다시 쓰고, afterCutNo+1 자리에
// newCutBlockText(이미 "[CUT {afterCutNo+1}] ..."로 완성된 블록)를 끼워넣는다. 헤더 숫자만
// 바꾸는 텍스트 치환이라 순서 무관(파일 rename과 달리 충돌 없음).
function renumberAndInsertScript(rawText, afterCutNo, newCutBlockText) {
  const lines = rawText.split('\n')
  const out = []
  let inserted = false
  for (const line of lines) {
    const m = line.match(CUT_HEADER_RE)
    if (m) {
      const n = parseInt(m[2], 10)
      if (!inserted && n === afterCutNo + 1) {
        out.push(...newCutBlockText.split('\n'), '', '')
        inserted = true
      }
      if (n > afterCutNo) { out.push(`${m[1]}${n + 1}${m[3]}`); continue }
    }
    out.push(line)
  }
  if (!inserted) out.push('', '', ...newCutBlockText.split('\n')) // afterCutNo가 마지막 컷이었던 경우
  return out.join('\n')
}

function resolveScriptFile(episodeCode, scriptFileName) {
  const dir = mp.scriptDir(episodeCode)
  if (scriptFileName) {
    const p = path.join(dir, scriptFileName)
    if (!fs.existsSync(p)) throw new Error(`대본 파일 없음: ${p}`)
    return p
  }
  const files = safeList(dir).filter((f) => /\.(txt|md)$/i.test(f))
  const v3 = files.find((f) => /v3/i.test(f)) || files[0]
  if (!v3) throw new Error(`${dir}에서 대본 파일을 찾지 못했습니다 — scriptFileName을 지정하세요`)
  return path.join(dir, v3)
}

// { episodeCode, afterCutNo, newCutBlockText, scriptFileName? } → 실행계획(plan). dryRun=true면
// 디스크를 하나도 안 건드리고 무엇이 바뀔지만 계산한다.
export function insertCut({ episodeCode, afterCutNo, newCutBlockText, scriptFileName }, { dryRun = true } = {}) {
  if (!episodeCode) throw new Error('episodeCode 필요')
  if (afterCutNo == null || Number.isNaN(Number(afterCutNo))) throw new Error('afterCutNo 필요(숫자, 이 컷 "다음"에 끼워넣음)')
  if (!newCutBlockText?.trim()) throw new Error('newCutBlockText 필요')
  const after = Number(afterCutNo)

  const scriptFile = resolveScriptFile(episodeCode, scriptFileName)
  const rawBefore = fs.readFileSync(scriptFile, 'utf-8')
  const newScriptText = renumberAndInsertScript(rawBefore, after, newCutBlockText)

  const fileRenames = []
  let maxNoAcrossStages = after
  for (const kind of Object.keys(STAGE_DIR_FNS)) {
    const dir = STAGE_DIR_FNS[kind](episodeCode)
    const maxNo = maxCutNoIn(dir)
    maxNoAcrossStages = Math.max(maxNoAcrossStages, maxNo)
    for (let k = maxNo; k > after; k--) renameCutFilesInDir(dir, k, k + 1, fileRenames, dryRun)
  }

  const gpointShifts = shiftGpoints(episodeCode, after, maxNoAcrossStages, dryRun)

  if (!dryRun) fs.writeFileSync(scriptFile, newScriptText, 'utf-8')

  return {
    scriptFile,
    newCutNo: after + 1,
    fileRenames,     // [{ dir, from, to }]
    gpointShifts,    // [{ from, to }]
    shiftedCutCount: Math.max(0, maxNoAcrossStages - after),
    newScriptText: dryRun ? newScriptText : null, // 미리보기용(커밋 후엔 호출부가 /api/read-file로 다시 읽음)
  }
}
