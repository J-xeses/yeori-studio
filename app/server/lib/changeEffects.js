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
  { id: 'water_emerge', nameKo: '수면 위로 떠오름', descKo: '물에 반쯤 잠겨 있다가 수면을 깨고 떠오르는 순간 새 룩 등장(연출 재료 창고 ① 수중 포트레이트 연결)', en: 'breaking through the water surface while rising up, droplets cascading off', icon: '💧' },
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
// outfitEn/envEn/lightingEn: 2026-10-14 추가 — buildRevealCut()의 IP/VP(전부 영문이어야 하는
// 이미지·영상 생성 프롬프트)는 반드시 이 영문 필드를 쓴다. 이전엔 한글 outfit/env/lighting을
// 그대로 꽂아 넣어서 "같은 Korean woman... now wearing 눈꽃 자수 겨울 밍크 코트..." 처럼 영문
// 프롬프트 한가운데 한글이 섞이는 버그가 있었다(IG_R08 CUT2 실측, 성준님 리포트: "이미지, 영상
// 프롬프트에 유독 한글 텍스트가 섞여있는데"). 한글 필드는 scene(한글 컷 설명)·화면 표시용 preview
// 에만 쓴다.
export const SCENE_B_FASHION_PRESETS = [
  { outfit: '스팽글이 촘촘히 박힌 오뜨꾸뛰르 미드나잇 블루 볼가운, 다이아몬드 목걸이', env: '거대한 크리스털 샹들리에 아래 오페라하우스 레드카펫', lighting: '파파라치 플래시와 황금빛 샹들리에 반사광',
    outfitEn: 'a densely sequined haute couture midnight-blue ball gown, a diamond necklace', envEn: 'an opera house red carpet beneath a massive crystal chandelier', lightingEn: 'paparazzi camera flashes and golden chandelier reflections' },
  { outfit: 'LED 파이버가 박힌 사이버 기모노, 발광 바이저', env: '미래형 초고층 빌딩 옥상, 야간', lighting: '네온 핑크·레이저 에메랄드 림라이트',
    outfitEn: 'a cyber kimono embedded with glowing LED fiber optics, a luminous visor', envEn: 'a futuristic skyscraper rooftop at night', lightingEn: 'neon pink and laser emerald rim lighting' },
  { outfit: '눈꽃 자수 겨울 밍크 코트, 크리스털 귀걸이', env: '눈 덮인 침엽수림, 얼어붙은 호수', lighting: '차가운 겨울 황혼 빛, 반짝이는 눈 결정',
    outfitEn: 'a snowflake-embroidered winter mink coat, crystal earrings', envEn: 'a snow-covered conifer forest beside a frozen lake', lightingEn: 'cold winter twilight light with glittering snow crystals' },
  { outfit: '버건디 벨벳 이브닝 드레스, 골드 커프', env: '마호가니 패널의 스피크이지 라운지, 그랜드 피아노', lighting: '앰버 촛불과 벽난로 플리커',
    outfitEn: 'a burgundy velvet evening dress, gold cuff bracelets', envEn: 'a mahogany-paneled speakeasy lounge with a grand piano', lightingEn: 'amber candlelight with flickering fireplace glow' },
  { outfit: '광택 블랙 레더 트렌치코트, 무릎 위까지 오는 하이 블랙 부츠, 레드 빈티지 헤드셋', env: '배경·바닥 전부 강렬한 솔리드 레드로 통일된 스튜디오, 매칭되는 레드 빈티지 전화기 소품', lighting: '드라마틱한 스튜디오 조명, 레더 코트와 레드 소품에 하이라이트',
    outfitEn: 'a glossy black leather trench coat, knee-high black boots, a red vintage headset', envEn: 'a studio with background and floor unified in bold solid red, a matching red vintage telephone prop', lightingEn: 'dramatic studio lighting highlighting the leather coat and red props' },
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

// trigger/vfx = TRIGGER_ACTIONS/VFX_PRESETS 요소, sceneB = {outfit,env,lighting,outfitEn,envEn,lightingEn}
// sceneA = {poseEn?, envEn?, lightingEn?} 변신 "전" 모습(선택) — 비워두면 범용 문구로 대체.
// durationSec = 이 컷의 길이. beat = BEAT 태그(기본 '고조'). cpLine = 자막 한 줄(선택).
//
// 2026-10-15 — IP(시작 이미지) 기준 변경: 예전엔 IP가 sceneB(완성된 "후" 모습)를 그렸다. 실측
// (IG_R08 CUT4, 성준님 리포트: "회중시계 태엽 감고 연기 피어오르는 장면은 안 나타나고 애초에
// 변신의상으로 등장")에서 원인이 밝혀짐 — Veo는 image-to-video라 시작 프레임을 강하게 따라가기
// 때문에, 시작 프레임이 이미 "완성 모습"이면 8초 내내 그 모습만 유지하고 트리거 동작(AC)은 VP에
// 적어도 전혀 재현되지 않는다. 반대로 성준님이 예전에 "트리거 동작 중인 전 모습"을 시작 프레임
// 으로 썼을 땐 같은 컷에서 트리거→VFX→리빌이 한 클립 안에 정상적으로 생성됐다(동일 컷 재검증,
// raw/cut_04_clip_1.mp4 — t=0도 t=4도 이미 완성 모습인 걸 프레임 추출로 직접 확인). 그래서
// **IP는 항상 "전" 모습(sceneA), VP가 트리거→VFX→리빌 전체 서사를 맡는다** — 이게 쪼개는 기준
// (IP=전 / VP=전체)이다. 컷을 2개로 쪼개서 하드컷으로 잇는 방식(R07처럼)은 채택하지 않음 —
// 한 클립 안에서 이미 재현되는 걸 실측으로 확인했기 때문에 더 간단한 쪽을 쓴다.
export function buildRevealCut({ trigger, vfx, sceneA, sceneB, durationSec = 6, beat = '고조', cpLine = '' }) {
  if (!trigger || !vfx || !sceneB?.outfit) throw new Error('trigger, vfx, sceneB.outfit 필요')
  // IP/VP는 전부 영문이어야 하므로 영문 필드가 반드시 있어야 한다 — 2026-10-14, IG_R08 CUT2에서
  // 한글 outfit/env/lighting이 영문 프롬프트에 그대로 섞여 들어간 버그를 잡은 뒤 추가한 가드.
  if (!sceneB.outfitEn || !sceneB.envEn || !sceneB.lightingEn) {
    throw new Error('sceneB.outfitEn/envEn/lightingEn(영문 설명) 필요 — 한글 설명만으로는 이미지·영상 프롬프트를 만들 수 없습니다')
  }
  const audioCue = pick(AUDIO_CUES)
  const poseEn = sceneA?.poseEn?.trim() || `caught in the middle of ${trigger.en}, her current everyday look, not yet transformed`
  const envAEn = sceneA?.envEn?.trim() || 'a softly lit, minimal space with a shallow depth of field, no specific background details'
  const lightingAEn = sceneA?.lightingEn?.trim() || 'soft neutral ambient light'

  const scene = `(하드컷, ${trigger.nameKo} 효과음) ${sceneA?.poseKo?.trim() || `${trigger.nameKo} 동작 중, 평소 모습 그대로`} — ${trigger.descKo}. 효과가 걷히면 배경이 ${sceneB.env}로 리빌되고, ${sceneB.outfit}+새 배경으로 바뀌어 있다.`

  const imagePrompt = `MEDIUM CLOSE-UP SHOT — same Korean woman, same face, natural skin texture, never exaggerated, ${poseEn}, standing in ${envAEn}, photorealistic 8K cinematic, natural Korean beauty, effortlessly photogenic not posing just existing beautifully, avoid: acne, pimples, blemishes, skin blotches, rough or bumpy skin, uneven skin tone, redness, oily shine, lighting: ${lightingAEn}, never legible text or UI, vertical 9:16`

  // 2026-10-13: 룰셋 표준 무발화 문구(2026-09-29 SF_E11 실측 확정)로 통일 — 예전 "No dialogue.
  // No on-screen subtitle text or captions."만으로는 Veo가 감정 구간에서 스스로 입모양을
  // 만들어내는 문제가 있었음(scriptParserV3.js의 applyNarrationSilentGuard와 동일 문구 유지).
  const videoPrompt = `First 0-${FRAME_SYNC.dropEnd}s: She initiates ${trigger.en}, ${vfx.en} sweeping across the frame — this is the transition moment, beat drop at ${FRAME_SYNC.prepEnd}s. / Next ${FRAME_SYNC.lockInStart}-${durationSec}s: The effect clears to reveal her in ${sceneB.outfitEn}, standing in ${sceneB.envEn}, settling into a graceful confident pose, looking directly at camera. NO dialogue. NO speaking. NO lip movement. MOUTH STAYS CLOSED. SILENT FILM.`

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

// ── 프리즈 비트(돌발상황 정지) 생성기 — 2026-10-15 ──────────────────────────
// buildRevealCut()은 "트리거 동작→VFX→의상/배경 리빌"(체인지) 구조라 프리즈프레임/불릿타임엔
// 억지로 끼워 맞춘 상태였다. 성준님 피드백: "변신하는 장면보다 빠르게 움직이다가 갑자기
// 돌발상황이 확 펼쳐지는 순간에 멈춰서 효과가 연출되는 장면이 적합" — 레퍼런스(유리공예 장인,
// 커피잔 파편)도 전부 의상·배경은 그대로고 "사건"만 얼어붙는 구조. 그래서 trigger/sceneB(의상
// 리빌) 없이 "무슨 돌발상황인지"만 받는 완전히 별도 생성기로 분리한다 — TRIGGER_ACTIONS는
// 전부 "의상 바꾸는 동작"이라 이 용도엔 안 맞고 재사용하지 않는다.
// action = { nameKo, ko, en } — 돌발상황 묘사. sceneA = 기존과 동일(선택, 평소 모습/환경).
export function buildFreezeBeatCut({ action, sceneA, durationSec = 6, beat = '긴장', cpLine = '' }) {
  if (!action?.ko?.trim() || !action?.en?.trim()) throw new Error('action.ko, action.en(돌발상황 한글/영문 묘사) 필요')
  const audioCue = pick(AUDIO_CUES)
  const poseEn = sceneA?.poseEn?.trim() || 'moving at a natural, everyday pace'
  const poseKo = sceneA?.poseKo?.trim() || '평소처럼 움직이는 중'
  const envAEn = sceneA?.envEn?.trim() || 'a softly lit, minimal space with a shallow depth of field, no specific background details'
  const lightingAEn = sceneA?.lightingEn?.trim() || 'soft neutral ambient light'
  const label = action.nameKo || '돌발상황'

  const scene = `(하드컷, ${label} 효과음) ${poseKo} — 갑자기 ${action.ko}. 그 순간 시간이 멈추고 카메라만 주변을 돈다. 시간이 다시 흐르며 놀란 반응.`

  // 의상/배경은 바뀌지 않으므로(사건만 멈춤) 단일 이미지 프롬프트 — sceneB 불필요.
  const imagePrompt = `MEDIUM SHOT — same Korean woman, same face, natural skin texture, never exaggerated, ${poseEn}, in ${envAEn}, photorealistic 8K cinematic, natural Korean beauty, effortlessly photogenic not posing just existing beautifully, avoid: acne, pimples, blemishes, skin blotches, rough or bumpy skin, uneven skin tone, redness, oily shine, lighting: ${lightingAEn}, never legible text or UI, vertical 9:16`

  const videoPrompt = `First 0-${FRAME_SYNC.prepEnd}s: She is ${poseEn}, a completely normal, everyday moment. / Next ${FRAME_SYNC.prepEnd}-${FRAME_SYNC.dropEnd}s: Suddenly, ${action.en} — at this exact peak moment time itself seems to stop, every object, droplet and loose fabric suspended perfectly still in mid-air, the camera rapidly orbiting around the frozen scene, beat drop at ${FRAME_SYNC.prepEnd}s. / Next ${FRAME_SYNC.lockInStart}-${durationSec}s: Time resumes, she reacts with a startled, wide-eyed expression, same outfit, same environment throughout. NO dialogue. NO speaking. NO lip movement. MOUTH STAYS CLOSED. SILENT FILM.`

  const audioNote = `BGM: 이어서, 비트 유지 / 효과음: ${label} 임팩트 + ${audioCue.soundFx} (프리즈 시작 지점) / 타점: ${audioCue.beat}`

  const subtitle = cpLine || '...어?'

  const preview = {
    step1: `[0.0s ~ ${FRAME_SYNC.prepEnd}s 평소]: ${poseKo} — 아직은 평범한 순간.`,
    step2: `[${FRAME_SYNC.prepEnd}s ~ ${FRAME_SYNC.dropEnd}s 돌발 프리즈]: 비트 드롭(${audioCue.beat})과 동시에 ${label} 발생 — 시간 정지, 카메라만 주변을 돈다.`,
    step3: `[${FRAME_SYNC.lockInStart}s ~ ${durationSec}s 리액션]: 시간이 다시 흐르고 놀란 반응. 긴장감으로 완청 유도.`,
  }

  return {
    cutPatch: { scene, imagePrompt, videoPrompt, subtitle, beat, audioNote },
    preview,
    audioCue,
  }
}
