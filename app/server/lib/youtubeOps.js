// 유튜브 운영실(/youtube-ops) 데이터 — downloads/seoyeori/YU/_account/ops.json
// insta-ops.js 와 같은 패턴(rev 확인 저장) — 계정 세팅 · 목표(YPP 게이트) · 콘텐츠(에피소드 연동) · 검토사항 로그.
//
// 인스타와 다른 핵심 차이: 인스타 goals 는 "우리가 정한 목표"였지만, 유튜브는 YPP(파트너 프로그램)라는
// 외부 고정 숫자 관문 + 마감(2027-02-01)이 있다. 2026-09-29 기준 확인된 사실(웹 검색):
//   - 지금 가입 기준: 구독자 1,000 + (연 시청시간 4,000시간 또는 쇼츠 조회수 1,000만/90일 롤링)
//   - 2027-02-01부터 신규 가입 기준 2배 강화(8,000시간 / 2,000만) — 이미 가입된 채널은 영향 없음
//   - 즉 "2027-02-01 전 YPP 가입 완료"가 실질적 1차 목표. 그 안에 못 들어가면 문턱이 2배로 뜀.
import fs from 'fs'
import path from 'path'
import * as mp from './mediaPaths.js'

export const ACCOUNT_DIR = path.join(mp.DOWNLOADS, mp.BRAND, 'YU', '_account')
const OPS_PATH = path.join(ACCOUNT_DIR, 'ops.json')
const STATE_PATH = 'C:\\yeori-studio\\app\\studio-state.json'   // gatePolicy.js 와 동일 패턴

export const YPP_DEADLINE = '2027-02-01'
export const YPP_CURRENT = { subs: 1000, watchHours: 4000, shortsViews90d: 10000000 }
export const YPP_TIGHTENED = { subs: 1000, watchHours: 8000, shortsViews90d: 20000000 }

function defaultOps() {
  return {
    rev: 0,
    settings: {
      handle: '', channelName: 'Seoyeori 서여리', profilePhoto: '', bannerPhoto: '',
      description: '', category: 'People & Blogs', keywords: '', residenceCountry: '',
      uploadDefaultDescription: '', uploadDefaultTags: '',
      accountCreated: false, creatorChannelOn: false, aiLabelOn: false, twoFactorOn: false,
      monetizationApplied: false, monetizationApproved: false,
    },
    ypp: { subs: 0, watchHours: 0, shortsViews90d: 0, lastUpdated: '' },
    posts: [],
    reviewLog: [],
    competitors: [],
    // 결론 적용 실험 기록 — 경쟁채널 비교·자체 성과분석에서 나온 결론을 실제 에피소드/연출에 적용하고 효과 추적
    experiments: [],
    // 제작여건 모니터링(수동 입력) — 이번 주 가용 제작 편수 + 메모
    production: { weeklyCapacity: 0, note: '' },
  }
}

export function loadOps() {
  let ops
  try { ops = JSON.parse(fs.readFileSync(OPS_PATH, 'utf-8')) } catch { ops = defaultOps() }
  if (!ops.settings) ops.settings = defaultOps().settings
  if (!ops.ypp) ops.ypp = defaultOps().ypp
  if (!Array.isArray(ops.posts)) ops.posts = []
  if (!Array.isArray(ops.reviewLog)) ops.reviewLog = []
  if (!Array.isArray(ops.competitors)) ops.competitors = []
  if (!Array.isArray(ops.experiments)) ops.experiments = []
  for (const c of ops.competitors) {
    if (typeof c.overview !== 'string') c.overview = ''
    if (typeof c.type !== 'string' || !c.type) c.type = '성숙 경쟁채널'   // '성숙 경쟁채널' | '신생 급성장 채널' — 후자는 블루오션 역산용 신호
    if (typeof c.founded !== 'string') c.founded = ''
    if (typeof c.growth !== 'string') c.growth = ''
    if (!Array.isArray(c.episodes)) {
      // 구 스키마(채널당 단일 ref/perf/cause/takeaway) → 참고 콘텐츠 1건으로 이전
      const hasOld = c.ref || c.perf || c.cause || c.takeaway
      c.episodes = hasOld ? [{ id: c.id + '_e1', title: c.ref || '', screenshot: '', perf: c.perf || '', cause: c.cause || '', takeaway: c.takeaway || '' }] : []
      delete c.ref; delete c.perf; delete c.cause; delete c.takeaway
    }
  }
  if (!ops.production || typeof ops.production !== 'object') ops.production = defaultOps().production
  if (typeof ops.production.weeklyCapacity !== 'number') ops.production.weeklyCapacity = Number(ops.production.weeklyCapacity) || 0
  if (typeof ops.production.note !== 'string') ops.production.note = ''
  for (const p of ops.posts) {
    // planDate = 최초 계획일(한 번 정해지면 안 바뀜). 옛 항목은 현재 date 를 최초 계획으로 간주, 날짜 없으면 ''(UI에서 처음 날짜 입력 시 고정)
    if (typeof p.planDate !== 'string') p.planDate = p.date || ''
    if (!Array.isArray(p.statusHistory)) p.statusHistory = []
  }
  syncEpisodesToPosts(ops)
  return ops
}

export function saveOps(next) {
  const cur = loadOps()
  if ((next?.rev ?? -1) !== (cur.rev ?? 0)) {
    const e = new Error('다른 창에서 먼저 저장된 내용이 있습니다. 최신본을 다시 불러옵니다.')
    e.statusCode = 409; e.current = cur
    throw e
  }
  if (!Array.isArray(next.posts)) { const e = new Error('posts 배열 필요'); e.statusCode = 400; throw e }
  fs.mkdirSync(ACCOUNT_DIR, { recursive: true })
  if (fs.existsSync(OPS_PATH)) fs.copyFileSync(OPS_PATH, OPS_PATH + '.bak')
  const out = { ...next, rev: (cur.rev ?? 0) + 1, savedAt: new Date().toISOString() }
  const tmp = OPS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2))
  fs.renameSync(tmp, OPS_PATH)
  return out
}

export function listProfilePhotos() {
  try { return fs.readdirSync(path.join(ACCOUNT_DIR, 'profile')).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort() } catch { return [] }
}

export function listBannerPhotos() {
  try { return fs.readdirSync(path.join(ACCOUNT_DIR, 'banner')).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort() } catch { return [] }
}

// ── 실시간 모니터링: "완성됐지만 아직 게시 안 됨" 자동 감지 ──────────────
// posts 는 전부 사람이 status를 직접 바꿔야 해서, 실제로는 07_output에 최종 파일이
// 이미 올라와 있는데도 화면엔 "기획"으로 보이는 맹점이 있었다(2026-10-29 실측: IG_R02~07·
// SF_E12 7건이 최종본까지 끝나 있었는데 전부 "기획" 표시). status가 사람 입력인 건 유지하고,
// 파일시스템을 직접 스캔해 "제작 재고"를 별도로 띄워주는 쪽으로 보완.
const PUBLISH_STATUS_PATH = path.join(mp.DOWNLOADS, 'state', 'publish-status.json')
function otherPlatformPublish(code) {
  try {
    const pub = JSON.parse(fs.readFileSync(PUBLISH_STATUS_PATH, 'utf-8'))
    for (const rec of Object.values(pub)) {
      for (const [platform, info] of Object.entries(rec)) {
        // code 필드가 없는 과거 기록(예: IG_R06 등 mediaId 기반 신규 자동기록)은 permalink/videoUrl에
        // 코드 문자열이 안 박혀있을 수 있어, publishedAt 날짜가 finalDir 파일 mtime 이후인 것만으로도
        // "같은 코드로 보기엔 근거 부족"하므로 code 일치만 신뢰하고 videoUrl 경로의 코드 토큰도 보조로 본다.
        const viaUrl = String(info?.videoUrl || '').toUpperCase().includes('/' + code.toUpperCase() + '/')
        if (info?.code === code || viaUrl) return { platform, publishedAt: info.publishedAt, permalink: info.permalink }
      }
    }
  } catch { /* 파일 없거나 파싱 실패 — 무시 */ }
  return null
}
export function scanReadySignals(ops) {
  const out = []
  for (const p of ops.posts || []) {
    if (p.status === '게시') continue
    const parsed = mp.parseCode(p.code)
    if (!parsed) continue
    let files
    try { files = fs.readdirSync(mp.finalDir(p.code)).filter(f => /\.mp4$/i.test(f)) } catch { files = [] }
    if (!files.length) continue
    const preferred = files.find(f => f.toLowerCase() === `${p.code.toLowerCase()}_final.mp4`) || files[0]
    const stat = fs.statSync(path.join(mp.finalDir(p.code), preferred))
    out.push({
      code: p.code, title: p.title, status: p.status, file: preferred,
      finalizedAt: stat.mtimeMs, ageDays: Math.floor((Date.now() - stat.mtimeMs) / 864e5),
      otherPlatform: otherPlatformPublish(p.code),
    })
  }
  return out.sort((a, b) => a.finalizedAt - b.finalizedAt)
}

// ── 스튜디오 에피소드 → 운영실 콘텐츠 목록 자동 동기화 ──────────────────────
// SF_E*(유튜브 전용 숏폼)와 IG_R*(릴스 — 유튜브 쇼츠로 교차 업로드 가능)를 대상으로,
// ops.posts에 없는 코드는 새로 추가한다(있으면 title/cutCount만 갱신, 사람이 채운 날짜·조회수·상태는 보존).
function syncEpisodesToPosts(ops) {
  let state
  try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) } catch { return }
  const episodes = Object.values(state.episodes || {})
  for (const ep of episodes) {
    const code = ep.episode?.code || ''
    const isSF = /^SF_E/i.test(code)
    const isReel = /^IG_R/i.test(code)
    if (!isSF && !isReel) continue
    const cutCount = (ep.cuts || []).length
    let post = ops.posts.find(p => p.code === code)
    if (!post) {
      post = {
        id: code, code, title: ep.episode?.title || '', cutCount,
        type: isSF ? '숏폼(유튜브 전용)' : '숏폼(릴스 교차)',
        status: '기획', date: '', planDate: '', statusHistory: [], link: '',
        views: '', watchHours: '', shortsViews: '', subsGained: '', likes: '', comments: '',
      }
      ops.posts.push(post)
    } else {
      post.cutCount = cutCount
      if (!post.title && ep.episode?.title) post.title = ep.episode.title
    }
  }
}
