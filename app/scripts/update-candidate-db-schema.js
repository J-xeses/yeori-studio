// 후보 풀 Notion DB(c45d2b84-7522-4a2a-8cd7-3263bcbb2cef)의 체크리스트 필드를
// 기존 체크박스 구조에서 공통 13항목(4단계 SELECT) + 유형별 3항목(MULTI_SELECT)
// 구조로 갱신한다. studio-secrets.json에 apiKeys.notion 토큰이 준비되면 한 번
// 실행하면 된다:
//   node scripts/update-candidate-db-schema.js
//
// 주의: 새 속성을 추가/갱신만 한다. 기존에 수동으로 만들어둔 체크박스 속성(11개)은
// 정확한 이름을 알 수 없어 자동으로 지우지 않으므로, 실행 후 Notion에서 직접
// 확인하고 더 이상 필요 없는 옛 체크박스 속성은 수동으로 삭제할 것을 권장한다.
import fs from 'fs'
import path from 'path'

const CODE_ROOT = 'C:\\yeori-studio\\app'
const NOTION_CANDIDATE_DB_ID = 'c45d2b84-7522-4a2a-8cd7-3263bcbb2cef'
const NOTION_VERSION = '2022-06-28'

// content_matrix_v3.html / server/proxy.js와 동일하게 유지할 것
const CANDIDATE_CHECKLIST_ITEMS = [
  { key: 'script_msg',      label: '핵심메시지 명확' },
  { key: 'script_3act',     label: '3막구조 있음' },
  { key: 'script_tone',     label: '서여리 톤 맞음' },
  { key: 'script_emotion',  label: '감정흐름 자연스러움' },
  { key: 'image_scene',     label: '씬별 시각요소 있음' },
  { key: 'image_setting',   label: '의상·배경 설정 있음' },
  { key: 'image_mood',      label: '색감·분위기 설정됨' },
  { key: 'tts_emotion',     label: '감정톤 지정됨' },
  { key: 'tts_length',      label: '대사길이 적절' },
  { key: 'video_cut',       label: '컷분할 가능' },
  { key: 'video_8s',        label: '8초배수 고려됨' },
  { key: 'edit_transition', label: '전환연출 있음' },
  { key: 'edit_bgm',        label: 'BGM분위기 설정됨' },
]

const CANDIDATE_TYPE_EXTRA_ITEMS = {
  SF:   [ { key: 'sf_hook',       label: '훅 첫컷 있음' },        { key: 'sf_duration',     label: '15~60초 완결' },       { key: 'sf_noSubtitle', label: '자막없이 이해가능' } ],
  LF:   [ { key: 'lf_chapter',    label: '챕터구분 가능' },       { key: 'lf_density',      label: '정보밀도 적절' },       { key: 'lf_retention',  label: '중간이탈 방지장치' } ],
  IG_R: [ { key: 'igr_ratio',     label: '9:16구도 고려' },       { key: 'igr_hook3s',      label: '첫3초 훅 있음' },       { key: 'igr_musicsync', label: '음악싱크 포인트' } ],
  IG_P: [ { key: 'igp_thumbnail', label: '썸네일컷 있음' },       { key: 'igp_textoverlay', label: '텍스트오버레이 계획' }, { key: 'igp_carousel',  label: '캐러셀구성 가능' } ],
  IG_S: [ { key: 'igs_expire24h', label: '24시간 소멸 고려' },    { key: 'igs_swipeup',     label: '스와이프업 유도' },     { key: 'igs_sticker',   label: '스티커·인터랙션 요소' } ],
  TK:   [ { key: 'tk_trend',      label: '트렌드밈 요소' },       { key: 'tk_comment',      label: '댓글유도 요소' },       { key: 'tk_challenge',  label: '챌린지 연결 가능' } ],
}

const STATUS_OPTIONS = [
  { name: '⬜ 미확인', color: 'default' },
  { name: '❌ 미반영', color: 'red' },
  { name: '🟡 부분반영', color: 'yellow' },
  { name: '✅ 충분반영', color: 'green' },
]

function getNotionToken() {
  const secretsPath = path.join(CODE_ROOT, 'studio-secrets.json')
  if (!fs.existsSync(secretsPath)) throw new Error('studio-secrets.json 없음')
  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'))
  const token = secrets.apiKeys?.notion
  if (!token) throw new Error('studio-secrets.json에 apiKeys.notion이 설정되어 있지 않습니다')
  return token
}

async function main() {
  const token = getNotionToken()
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }

  const properties = {}
  CANDIDATE_CHECKLIST_ITEMS.forEach(it => {
    properties[it.label] = { select: { options: STATUS_OPTIONS } }
  })
  Object.entries(CANDIDATE_TYPE_EXTRA_ITEMS).forEach(([type, items]) => {
    properties[`${type} 추가항목`] = { multi_select: { options: items.map(it => ({ name: it.label })) } }
  })

  console.log(`[schema] ${Object.keys(properties).length}개 속성 추가/갱신 요청 중...`)
  const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_CANDIDATE_DB_ID}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ properties }),
  })
  const data = await res.json()
  if (!res.ok) {
    console.error('[schema] 실패:', data.message || JSON.stringify(data))
    process.exit(1)
  }

  console.log('[schema] 완료. 추가/갱신된 속성:')
  Object.keys(properties).forEach(name => console.log(`  - ${name}`))
  console.log('\n기존 체크박스 11개는 자동으로 지우지 않았습니다. Notion에서 직접 확인 후 필요 없는 것은 삭제하세요.')
}

main().catch(err => {
  console.error('[schema] 오류:', err.message)
  process.exit(1)
})
