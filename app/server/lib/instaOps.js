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

// 🌱 관심사 설계 — 새 계정의 관심사 신호(팔로우·시청·저장)를 우리 분야로 의도적으로 채우기 위한 방문 목록.
// 2026-09-24 웹 검색으로 실존 확인된 계정만. day = 개설일 기준 며칠째에 처음 방문할지(0=개설일).
const seed = (handle, group, why, use, day) => ({ handle, group, why, use, day, followedAt: '', visits: [], note: '' })
export const DEFAULT_SEEDS = [
  seed('rozy.gram', 'AI 인플루언서', '한국 최초 초실사 버추얼 인플루언서, "감성 장인" — 표정 연기가 강점', '한국형 AI 인플루언서 벤치마크 · 표정/감정 컷 구성', 0),
  seed('lilmiquela', 'AI 인플루언서', '가장 많이 팔로우된 가상 인물(약 250만) — 캐릭터 서사·세계관 운영', '캐릭터 세계관 칸 · 스토리 연재 방식', 0),
  seed('imma.gram', 'AI 인플루언서', '도쿄 기반, 시그니처 핑크 단발 + 글로벌 브랜드 협업', '시그니처 비주얼 일관성 · 협업 게시물 톤', 0),
  seed('fit_aitana', 'AI 인플루언서', '생성형 이미지 툴로 만든 실사형 AI(바르셀로나 에이전시) — 우리와 같은 제작 방식', 'AI 제작 과정 칸 · 실사형 일관성 관리', 1),
  seed('noonoouri', 'AI 인플루언서', '패션·뷰티·여행 중심의 가상 인플루언서', '패션 Reel 칸 참고', 2),
  seed('shudu.gram', 'AI 인플루언서', '최초의 디지털 슈퍼모델(2017) — 화보형 사진 톤', '사진 Carousel 톤·구도', 2),
  seed('yoonee3326', '인스타툰', '유니유니 — INFP 내향인 일상툰(약 7만), "나만 그런 게 아니었네" 공감', 'P01·P02 웹툰 캐러셀 · 공감 소재 발굴', 1),
  seed('i_iary2', '인스타툰', '이아리 — 소소한 일상 공감툰', '일상 Reel 소재 · 짧은 컷 공감 구조', 1),
  seed('0g_maru', '인스타툰', '영지 — 티격태격 신혼부부 일상툰', '관계 티키타카(메이킹 채널 "투덜" 톤) 참고', 2),
  seed('nanheemang', '인스타툰', '난희 — 인스타툰 작가', '캐러셀 컷 수·말풍선 밀도 참고', 3),
  seed('elevenlabsio', 'AI 제작 도구', 'ElevenLabs 공식 — 음성 기능 업데이트·데모', 'AI 제작 과정 칸 · 음성 신기능 빠른 파악', 2),
  seed('pixverse_official', 'AI 제작 도구', 'PixVerse 공식(약 8.7만) — 생성 영상 사례·템플릿', '영상 생성 트렌드 · 우리 툴 목록과 연계', 2),
  seed('runwayapp', 'AI 제작 도구', 'Runway 공식(약 47만) — 생성 영상 크리에이터 사례 소개', 'AI 제작 과정 칸 · 연출 레퍼런스', 3),
]

function defaultOps() {
  return {
    rev: 0,
    launchDate: '2026-09-25',
    settings: { photo: 'profile_A_front.jpg', handle: 'seoyeori.ai', name: '서여리 | AI 크리에이터', bio: 0 },
    goals: { mix: MIX, flexible: 4, checkpointDay: 14 },
    seeds: DEFAULT_SEEDS,
    seedRules: { followPerDay: 5, firstWeekFollowMax: 20 },
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
  let ops
  try { ops = JSON.parse(fs.readFileSync(OPS_PATH, 'utf-8')) } catch { return defaultOps() }
  // 기존 ops.json 에 나중에 생긴 필드 채우기(파일은 다음 저장 때 반영)
  if (!Array.isArray(ops.seeds)) ops.seeds = DEFAULT_SEEDS
  if (!ops.seedRules) ops.seedRules = { followPerDay: 5, firstWeekFollowMax: 20 }
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
