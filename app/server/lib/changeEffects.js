// ── 체인지(트랜지션) 조합 생성기(2026-10-11) ──────────────────────────────
// 배경: 사용자가 별도 프로젝트(Instagram Change Effect Prompt Studio)로 만든 트리거×VFX
// 조합 생성기를 리빌드. 원본은 "한 샷 안에서 의상+배경이 통째로 모핑"하는 단일 프롬프트를
// 만드는데, 실측 테스트(Veo, 2026-10-11)에서 얼굴 identity가 끝까지 안 붙잡혔다(룰셋 §①
// 캐릭터 일관성 최우선과 충돌). R07이 실제로 "같은 구도 고정 + 컷마다 별도 생성 + 하드컷"
// 으로 구현한 것과 동일하게, 여기서는 트리거+VFX를 "리빌 컷 하나의 AC/VP"로, Scene B를
// "그 컷의 IP(시작 이미지)"로 분해해서 기존 G2(Nano Banana, 캐릭터 얼굴 레퍼런스 자동
// 첨부, proxy.js genImageForCut)→G4(Flow) 파이프라인에 그대로 올라타게 한다.
export const TRIGGER_ACTIONS = [
  { id: 'spin_360', nameKo: '360도 스핀 턴', descKo: '한 바퀴 빠르게 도는 원심력의 중간 지점에서 룩이 교체', en: 'a rapid 360-degree spin turn, motion blur trailing', icon: '🔄' },
  { id: 'finger_snap', nameKo: '핑거 스냅 & 충격파', descKo: '손가락을 튕기는 순간 오디오 힛과 함께 즉각 변신', en: 'a finger snap gesture, light and particles bursting outward at the snap', icon: '🫰' },
  { id: 'walk_through', nameKo: '런웨이 워크스루', descKo: '정면 카메라를 향해 걸어올 때 룩과 배경이 교차 모핑', en: 'walking confidently toward camera, runway-style', icon: '🚶' },
  { id: 'jacket_whip', nameKo: '재킷 휩', descKo: '입고 있던 외투를 카메라 앞으로 휙 젖히는 순간 전환', en: 'whipping an outer jacket or fabric across the camera lens', icon: '🧥' },
  { id: 'crash_zoom', nameKo: '크래시 줌 인/아웃', descKo: '눈동자나 로고로 확대된 뒤 새 룩의 와이드 샷으로 축소', en: 'a crash zoom in then rapid zoom out', icon: '🔍' },
  { id: 'jump_cut', nameKo: '점프 컷 착지', descKo: '공중으로 솟았다가 착지하는 순간 룩이 교체', en: 'jumping lightly and landing with impact', icon: '🦘' },
  { id: 'head_turn', nameKo: '헤드 휩 모션', descKo: '고개를 빠르게 돌릴 때 생기는 모션 블러를 타고 새 룩 등장', en: 'a quick head turn whip with motion blur', icon: '👤' },
  { id: 'hand_wipe', nameKo: '핸드 와이프', descKo: '손바닥으로 렌즈를 쓸어내리거나 가렸다 떼는 순간 전환', en: 'a hand wiping across the camera lens', icon: '✋' },
  { id: 'mirror_touch', nameKo: '거울 터치 & 리플렉션', descKo: '거울 속 비친 모습이 먼저 바뀌며 현실로 전이', en: 'touching a mirror surface, reflection shifting first', icon: '🪞' },
  { id: 'smoke_burst', nameKo: '연기/스모크 버스트', descKo: '자욱한 연기가 터지며 그 속에서 새로운 모습으로 등장', en: 'a burst of colored smoke, figure emerging from within', icon: '💨' },
]

export const VFX_PRESETS = [
  { nameKo: '골드 더스트 & 크리스털 파티클', en: 'luminous golden glitter particles and floating crystal shards dissolving away', type: 'particles' },
  { nameKo: '네온 홀로그램 글리치', en: 'neon cyan scanlines and chromatic glitch distortion clearing', type: 'glitch' },
  { nameKo: '유체 액체 모핑', en: 'liquid mercury ripples settling into stillness', type: 'dissolve' },
  { nameKo: '모션 블러 회오리', en: 'kinetic motion-blur ribbons unwinding', type: 'spin' },
  { nameKo: '렌즈 플레어 버스트', en: 'a blinding lens flare flash fading out', type: 'flash' },
  { nameKo: '꽃잎 & 나비 소용돌이', en: 'a whirlwind of floral petals and butterflies dispersing', type: 'particles' },
  { nameKo: '불꽃 스파크 분산', en: 'fiery sparks and ember particles fading along the edges', type: 'particles' },
  { nameKo: '잉크 스플래시 번짐', en: 'black ink plume in water clearing to reveal', type: 'dissolve' },
]

export const AUDIO_CUES = [
  { soundFx: '딥 슬랩 하우스 드롭 + 크런치 핑거스냅 임팩트', genre: 'Slap House', beat: '1.8초 비트 드롭' },
  { soundFx: '808 헤비 베이스 글라이드 + 유리 파쇄음', genre: 'Dark Trap', beat: '2.0초 808 글라이드' },
  { soundFx: '바이올린 아르페지오 급상승 + 시네마틱 붐', genre: 'Cinematic Orchestral', beat: '1.6초 스트링 크레센도' },
  { soundFx: '카메라 셔터 연타 + 화이트노이즈 휩', genre: 'Tech House', beat: '1.5초 셔터음 3연타' },
  { soundFx: '레이저 차지업 + 네온 펄스', genre: 'Synthwave', beat: '2.2초 신스 리드' },
]

// 원본 "연출 백과사전"의 정밀 프레임싱크 — 우리 컷 길이(보통 6~10초)에 맞춰 상대값으로 사용.
// 1.2~1.8s 준비 모션 → 1.8~2.1s 드롭 프레임(모핑 피크) → 2.2s+ 락인(완성 포즈)
export const FRAME_SYNC = { prepStart: 1.2, prepEnd: 1.8, dropEnd: 2.1, lockInStart: 2.2 }

// "패션" 테마 스타터 Scene B 프리셋 — 다른 테마(직업 등)는 호출 측에서 자유 텍스트로 채움.
export const SCENE_B_FASHION_PRESETS = [
  { outfit: '스팽글이 촘촘히 박힌 오뜨꾸뛰르 미드나잇 블루 볼가운, 다이아몬드 목걸이', env: '거대한 크리스털 샹들리에 아래 오페라하우스 레드카펫', lighting: '파파라치 플래시와 황금빛 샹들리에 반사광' },
  { outfit: 'LED 파이버가 박힌 사이버 기모노, 발광 바이저', env: '미래형 초고층 빌딩 옥상, 야간', lighting: '네온 핑크·레이저 에메랄드 림라이트' },
  { outfit: '눈꽃 자수 겨울 밍크 코트, 크리스털 귀걸이', env: '눈 덮인 침엽수림, 얼어붙은 호수', lighting: '차가운 겨울 황혼 빛, 반짝이는 눈 결정' },
  { outfit: '버건디 벨벳 이브닝 드레스, 골드 커프', env: '마호가니 패널의 스피크이지 라운지, 그랜드 피아노', lighting: '앰버 촛불과 벽난로 플리커' },
]

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ── LK_ 룩 코드(2026-10-11, 성준님 설계) ──────────────────────────────────
// 기존 LOOK_BANK(scripts/codebook.json)의 LOOK_XXX(서여리 전용, 접두사 없음)와
// characters.json의 자유 형식(look01 등)이 겹치는 문제(§ca-bank-academy-proposal.md)를
// 피하려고 LK_ 는 아예 새 네임스페이스. 공간(SP 필드의 IN/OT 문법과 동일 어휘 — "맨발/신발"
// 구분은 실내 맨발 자동배제 가드와 직결)+계절 두 글자씩 넣어 코드만 보고도 "겨울 집"처럼
// 개략 느낌이 오게 하고, 의상 전체 묘사는 desc 필드가 맡는다(코드에 욱여넣지 않음).
export const LK_SPACE_CODES = { HM: '맨발(홈)', IN: '실내(신발)', OT: '실외' }
export const LK_SEASON_CODES = { SP: '봄', SU: '여름', AU: '가을', WI: '겨울', CH: '체인지(계절무관)' }

// existingLookIds = 캐릭터의 현재 looks 키 배열. 같은 space+season 접두사 중 최대 번호+1.
export function nextLookId(existingLookIds, spaceCode, seasonCode) {
  if (!LK_SPACE_CODES[spaceCode]) throw new Error(`알 수 없는 space 코드: ${spaceCode}`)
  if (!LK_SEASON_CODES[seasonCode]) throw new Error(`알 수 없는 season 코드: ${seasonCode}`)
  const prefix = `LK_${spaceCode}_${seasonCode}`
  let max = 0
  for (const id of existingLookIds || []) {
    const m = new RegExp(`^${prefix}(\\d{2})$`).exec(id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

// trigger/vfx = TRIGGER_ACTIONS/VFX_PRESETS 요소, sceneB = {outfit,env,lighting}
// durationSec = 이 컷의 길이. beat = BEAT 태그(기본 '고조'). cpLine = 자막 한 줄(선택).
export function buildRevealCut({ trigger, vfx, sceneB, durationSec = 6, beat = '고조', cpLine = '' }) {
  if (!trigger || !vfx || !sceneB?.outfit) throw new Error('trigger, vfx, sceneB.outfit 필요')
  const audioCue = pick(AUDIO_CUES)

  const scene = `(하드컷, ${trigger.nameKo} 효과음) 같은 카메라 구도 유지, 배경이 ${sceneB.env}로 리빌. ${trigger.descKo} — 효과가 걷히면 ${sceneB.outfit}+새 배경으로 바뀌어 있다.`

  const imagePrompt = `MEDIUM CLOSE-UP SHOT — same Korean woman, same face, natural skin texture, never exaggerated, caught just as ${trigger.en} settles — ${vfx.en}, now wearing ${sceneB.outfit}, standing in ${sceneB.env}, graceful confident pose, looking directly at camera, photorealistic 8K cinematic, natural Korean beauty, effortlessly photogenic not posing just existing beautifully, lighting: ${sceneB.lighting}, background: softly blurred ${sceneB.env}, never legible text or UI, vertical 9:16`

  const videoPrompt = `First 0-${FRAME_SYNC.dropEnd}s: She initiates ${trigger.en}, ${vfx.en} sweeping across the frame — this is the transition moment, beat drop at ${FRAME_SYNC.prepEnd}s. / Next ${FRAME_SYNC.lockInStart}-${durationSec}s: The effect clears to reveal her in ${sceneB.outfit}, settling into a graceful confident pose, looking directly at camera. No dialogue. No on-screen subtitle text or captions.`

  const audioNote = `BGM: 이어서, 비트 유지 / 효과음: ${trigger.nameKo} + ${audioCue.soundFx} (컷 시작 0.2초) / 타점: ${audioCue.beat}`

  const subtitle = cpLine || `이번엔 이 모습으로.`

  const preview = {
    step1: `[0.0s ~ ${FRAME_SYNC.prepEnd}s 준비]: ${trigger.nameKo} 시동. 시청자 시선을 끄는 자연스러운 포즈.`,
    step2: `[${FRAME_SYNC.prepEnd}s ~ ${FRAME_SYNC.dropEnd}s 트랜지션 피크]: 비트 드롭(${audioCue.beat})과 동시에 ${vfx.nameKo}가 폭발하며 1프레임도 끊김 없이 모핑.`,
    step3: `[${FRAME_SYNC.lockInStart}s ~ ${durationSec}s 완성씬]: ${sceneB.outfit} 완성. ${sceneB.env}. 완청률을 높이는 시선 고정.`,
  }

  return {
    cutPatch: { scene, imagePrompt, videoPrompt, subtitle, beat, audioNote },
    preview,
    audioCue,
  }
}
