// 유료 영상 API 사용 장부 — 생성할 때마다 초 수와 금액을 서버가 직접 기록한다(2026-09-20).
//
// creditUsage.js(무료 일일 크레딧 카운터)와 같은 이유로 studio-state.json과 분리된 별도 파일:
// 브라우저 탭이 상태를 통째로 덮어써도 지출 기록이 사라지지 않게. 삭제는 지원하지 않는다(장부).
// 금액은 USD로 기록하고, 원화는 기록 시점의 환율(usdKrw)로 함께 저장해 나중에 환율을 바꿔도
// 과거 기록이 흔들리지 않게 한다.

import fs from 'fs'
import path from 'path'
import { statePath } from './mediaPaths.js'

const LEDGER_PATH = statePath('paid-usage.json')
const DEFAULT_RATE = 1400

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8'))
    return { usdKrw: Number(raw.usdKrw) > 0 ? Number(raw.usdKrw) : DEFAULT_RATE, entries: Array.isArray(raw.entries) ? raw.entries : [] }
  } catch {
    return { usdKrw: DEFAULT_RATE, entries: [] }
  }
}

function save(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true })
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf-8')
}

const monthKeyOf = (iso) => String(iso).slice(0, 7) // YYYY-MM

export function setUsdKrw(rate) {
  const n = Number(rate)
  if (!(n > 0)) throw new Error('환율은 0보다 큰 숫자여야 합니다')
  const ledger = load()
  ledger.usdKrw = n
  save(ledger)
  return n
}

// 유료 생성 1건 기록. seconds 또는 usd 중 하나는 필요(둘 다 있으면 usd 우선).
export function recordPaidUsage({ provider, model, seconds, usd, usdPerSec, epCode, cutNo, clipNo, note, source = 'auto' }) {
  const sec = Number(seconds) || 0
  const cost = Number(usd) > 0 ? Number(usd) : (Number(usdPerSec) > 0 ? sec * Number(usdPerSec) : 0)
  if (!(cost > 0)) throw new Error('금액(usd) 또는 초당 단가(usdPerSec)와 초 수가 필요합니다')
  const ledger = load()
  const at = new Date().toISOString()
  const entry = {
    at, provider: provider || '(미지정)', model: model || '', seconds: sec, usd: Math.round(cost * 10000) / 10000,
    krw: Math.round(cost * ledger.usdKrw), usdKrw: ledger.usdKrw,
    epCode: epCode || '', cutNo: cutNo ?? null, clipNo: clipNo ?? null, note: note || '', source,
  }
  ledger.entries.push(entry)
  save(ledger)
  return entry
}

// 월간 요약. month 생략 시 이번 달.
export function summarizeMonth(month = monthKeyOf(new Date().toISOString())) {
  const ledger = load()
  const rows = ledger.entries.filter(e => monthKeyOf(e.at) === month)
  const byProvider = {}
  let usd = 0, krw = 0, seconds = 0
  for (const e of rows) {
    usd += e.usd; krw += e.krw; seconds += e.seconds
    const k = e.provider || '(미지정)'
    byProvider[k] = byProvider[k] || { usd: 0, krw: 0, seconds: 0, count: 0 }
    byProvider[k].usd += e.usd; byProvider[k].krw += e.krw; byProvider[k].seconds += e.seconds; byProvider[k].count++
  }
  const round = (n) => Math.round(n * 100) / 100
  return {
    month, usdKrw: ledger.usdKrw, count: rows.length,
    totalUsd: round(usd), totalKrw: Math.round(krw), totalSeconds: round(seconds),
    byProvider, recent: rows.slice(-30).reverse(),
  }
}

// 예산 검사 — 유료 생성 직전에 호출(estimateUsd 만큼 더 쓰면 월 예산(원)을 넘는가).
// manualSpentKrw: 대시보드에 사람이 직접 입력한 지출(구독료 등), budgetKrw: 월 예산.
export function checkBudget({ estimateUsd = 0, budgetKrw = 0, manualSpentKrw = 0 }) {
  const s = summarizeMonth()
  const estimateKrw = Math.round(Number(estimateUsd) * s.usdKrw)
  const spentKrw = Math.round(s.totalKrw + Number(manualSpentKrw || 0))
  const afterKrw = spentKrw + estimateKrw
  return { ok: !(budgetKrw > 0) || afterKrw <= budgetKrw, budgetKrw, spentKrw, estimateKrw, afterKrw, leftKrw: budgetKrw > 0 ? budgetKrw - afterKrw : null }
}
