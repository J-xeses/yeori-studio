// 인스타 운영실(/insta-ops) 데이터 — downloads/seoyeori/IG/_account/ops.json
// 설정(계정 세팅 선택값) · 게시물(계획·상태·지표) · 목표(콘텐츠 구성)를 한 파일에.
// 저장은 rev(버전) 확인 후에만 — 열려 있던 옛 탭이 최신 데이터를 통째로 덮어쓰는 사고(studio-state.json 에서
// 반복됐던 패턴) 방지. rev 가 다르면 409 → 페이지가 최신본을 다시 불러오게 한다.
import fs from 'fs'
import path from 'path'
import * as mp from './mediaPaths.js'

export const ACCOUNT_DIR = path.join(mp.DOWNLOADS, mp.BRAND, 'IG', '_account')
const OPS_PATH = path.join(ACCOUNT_DIR, 'ops.json')

// 첫 30일 = 시장조사(instagram-launch-plan.md §10). 유형별 목표 개수 + 적응형 4칸.
export const CONTENT_TYPES = ['패션 Reel', '일상 Reel', '스토리텔링 Reel', '사진 Carousel', 'AI 제작 과정', '캐릭터 세계관', '실험 콘텐츠']
const MIX = { '패션 Reel': 2, '일상 Reel': 6, '스토리텔링 Reel': 2, '사진 Carousel': 4, 'AI 제작 과정': 2, '캐릭터 세계관': 2, '실험 콘텐츠': 2 }

const seedPost = (id, date, time, type, title, code, status, img) =>
  ({ id, date, time, type, title, code, status, img, link: '', note: '', metrics: {} })

function defaultOps() {
  return {
    rev: 0,
    launchDate: '2026-09-25',
    settings: { photo: 'profile_A_front.jpg', handle: 'seoyeori.ai', name: '서여리 | AI 크리에이터', bio: 0 },
    goals: { mix: MIX, flexible: 4, checkpointDay: 14 },
    posts: [
      seedPost('t1', '2026-09-25', '12:00', '실험 콘텐츠', '티저① Se ye ri → 서여리', 'IG_T01', '완성', 'grid/t1.jpg'),
      seedPost('t2', '2026-09-26', '12:00', '실험 콘텐츠', '티저② 텍스트 소개', 'IG_T02', '기획', ''),
      seedPost('p01', '2026-09-27', '18:00', '사진 Carousel', 'P01 웹툰 자기소개', 'IG_P01', '제작중', 'grid/p01.jpg'),
      seedPost('p02', '2026-09-28', '18:00', '사진 Carousel', 'P02 AI 크리에이터 되는 법(제작과정툰)', 'IG_P02', '기획', ''),
      seedPost('r04', '2026-09-29', '12:00', '캐릭터 세계관', 'R04 서여리 실사 소개', 'IG_R04', '완성', 'grid/r04.jpg'),
      seedPost('r02', '2026-09-30', '12:00', '스토리텔링 Reel', 'R02 AI인지 모르고 DM 보낸 사람들, 이거 실화?', 'IG_R02', '제작중', 'grid/r02.jpg'),
      seedPost('r03', '2026-10-02', '12:00', 'AI 제작 과정', 'R03 AI 크리에이터 만드는 데 든 비용 0원', 'IG_R03', '완성', 'grid/r03.jpg'),
    ],
  }
}

export function loadOps() {
  try { return JSON.parse(fs.readFileSync(OPS_PATH, 'utf-8')) } catch { return defaultOps() }
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
  if (fs.existsSync(OPS_PATH)) fs.copyFileSync(OPS_PATH, OPS_PATH + '.bak')   // 직전본 1개 보관
  const out = { ...next, rev: (cur.rev ?? 0) + 1, savedAt: new Date().toISOString() }
  const tmp = OPS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2))
  fs.renameSync(tmp, OPS_PATH)
  return out
}

export function listProfilePhotos() {
  try { return fs.readdirSync(path.join(ACCOUNT_DIR, 'profile')).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort() } catch { return [] }
}
