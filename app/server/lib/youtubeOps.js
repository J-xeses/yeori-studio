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
      description: '', category: 'People & Blogs',
      accountCreated: false, creatorChannelOn: false, aiLabelOn: false, twoFactorOn: false,
      monetizationApplied: false, monetizationApproved: false,
    },
    ypp: { subs: 0, watchHours: 0, shortsViews90d: 0, lastUpdated: '' },
    posts: [],
    reviewLog: [],
  }
}

export function loadOps() {
  let ops
  try { ops = JSON.parse(fs.readFileSync(OPS_PATH, 'utf-8')) } catch { ops = defaultOps() }
  if (!ops.settings) ops.settings = defaultOps().settings
  if (!ops.ypp) ops.ypp = defaultOps().ypp
  if (!Array.isArray(ops.posts)) ops.posts = []
  if (!Array.isArray(ops.reviewLog)) ops.reviewLog = []
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
        status: '기획', date: '', link: '',
        views: '', watchHours: '', shortsViews: '', subsGained: '', likes: '', comments: '',
      }
      ops.posts.push(post)
    } else {
      post.cutCount = cutCount
      if (!post.title && ep.episode?.title) post.title = ep.episode.title
    }
  }
}
