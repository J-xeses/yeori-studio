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

// ── 프리즈 비트(돌발상황 정지) 생성기 — 2026-10-15 신설, 2026-10-16 2차례 교정 ──────
// v1("0~X초 평소 → 결정적 순간 정지 → 재생" 3단계 시간분할 프롬프트): 실패(10/15 커피잔 테스트,
// 정지·오빗 효과 전혀 없이 평범한 연속 동작만 나옴 — Veo는 "동작을 멈추는 전환"을 못 받아들이고
// 그냥 제일 그럴듯한 연속 동작으로 밀어버림. "정지"는 모델이 학습한 물리 바깥의 편집 개념).
// v2(10/16 1차 교정): 레퍼런스(불릿타임 예시) 프레임 분석 — 성공 샷은 "평소→정지"라는 전환을
// 아예 요구하지 않고 **처음부터 끝까지 이미 정지된 포즈**만 유지, 카메라만 돈다는 걸 확인하고
// 그 패턴으로 단순화 → 실측 결과 "어느 정도 효과" (부분 성공, 성준님 확인).
// v3(10/16 2차 교정, 이번): 성준님이 직접 구축한 전용 도구("LongTake AI Studio" — Veo 2 롱테이크
// & 360° 불릿타임 전용 웹앱, 카메라 리그·셔터각·궤도반경/각속도까지 수치로 고정하는 "연속성 유지
// 템플릿" 보유)로 만든 두 번째 테스트(커피잔 리테이크, 10/16)를 프레임 분석해 v2보다 확연히 나은
// 결과를 확인. 차이 2가지를 반영한다:
// ① "정지 상태 하나만" 묘사하는 대신 실제 카메라 촬영 장비 어휘(셔터 각도·초고속 프레임레이트·
//    렌즈 스펙)로 앵커링하면 모델이 훨씬 더 많은 실사 고속촬영 레퍼런스를 끌어옴 — 막연한
//    "bullet-time style"보다 "30° shutter angle, 1/3000s, 1500fps time-freeze" 식 수치가 먹힘.
// ② 레퍼런스 영상 자체가 "평온한 클로즈업 표정으로 시작 → 카메라가 빠르게 줌아웃하며 이미 얼어붙은
//    혼돈 장면을 리빌"하는 구조였다 — 이건 사실상 v1이 실패했던 "평소→정지 전환"을 **포즈가 아니라
//    카메라 움직임(줌아웃 리빌)으로 숨겨서 우회**한 것. 모델이 "표정 변화"는 매끄럽게 못 하지만
//    "줌아웃 리빌"은 흔한 광고 기법이라 잘한다 — 그래서 openOnCloseUp 옵션으로 기본 채택.
// action = { nameKo, ko, en } — 얼어붙은 정점 상태 묘사(사건·자세 중심, 표정은 생략 가능 — 아래
//   줌아웃 리빌 문구가 표정 전환을 따로 맡는다). sceneA = 환경/조명만 선택적으로 사용.
// orbitDegrees: 카메라가 도는 궤도 각도(기본 120 — 두 레퍼런스 모두 완전 360도가 아니라 90~180도
//   부분 오빗이었음, LongTake 스튜디오의 "일상 돌발상황"용 권장치와도 일치).
// openOnCloseUp: true(기본)면 "평온한 클로즈업 표정 → 줌아웃 리빌" 오프닝을 붙인다.
const FREEZE_RIG = 'shot on a high-speed cine camera rig, 30-degree shutter angle (1/3000s shutter speed), time dilated to an extreme 1500fps super-slow-motion freeze, shallow anamorphic depth of field'

export function buildFreezeBeatCut({ action, sceneA, durationSec = 6, beat = '긴장', cpLine = '', orbitDegrees = 120, openOnCloseUp = true }) {
  if (!action?.ko?.trim() || !action?.en?.trim()) throw new Error('action.ko, action.en(얼어붙은 정점 상태 한글/영문 묘사) 필요')
  const audioCue = pick(AUDIO_CUES)
  const envAEn = sceneA?.envEn?.trim() || 'a softly lit, minimal space with a shallow depth of field, no specific background details'
  const lightingAEn = sceneA?.lightingEn?.trim() || 'soft neutral ambient light'
  const label = action.nameKo || '돌발상황'

  const scene = openOnCloseUp
    ? `(하드컷) 평온한 클로즈업 표정에서 시작 → 카메라가 빠르게 줌아웃하며 ${label}로 이미 얼어붙은 혼돈 장면을 리빌, 카메라는 그 주위를 ${orbitDegrees}도 돈다.`
    : `(하드컷, ${label} 효과음) 시간이 멈춘 듯 ${action.ko} 채로 완전히 얼어붙어 있고, 카메라가 그 주위를 ${orbitDegrees}도 돈다.`

  const imagePrompt = `MEDIUM SHOT — same Korean woman, same face, natural skin texture, never exaggerated, frozen mid-action — ${action.en} — her pose held at its most dramatic peak, ${FREEZE_RIG}, in ${envAEn}, photorealistic 8K cinematic, natural Korean beauty, effortlessly photogenic not posing just existing beautifully, avoid: acne, pimples, blemishes, skin blotches, rough or bumpy skin, uneven skin tone, redness, oily shine, lighting: ${lightingAEn}, never legible text or UI, vertical 9:16`

  const frozenCore = `A frozen, suspended-in-time bullet-time moment, ${FREEZE_RIG}: she is caught mid-action — ${action.en} — her pose held perfectly still at its most dramatic peak for the rest of the shot, only her hair and loose fabric gently drifting in the air, every falling object and droplet suspended mid-air with faint motion-trail ripples around it. The camera orbits roughly ${orbitDegrees} degrees around her frozen pose along a smooth arc, revealing the frozen scene from a new angle by the end.`

  const videoPrompt = openOnCloseUp
    ? `Opens on an extreme close-up of her calm, natural expression, ${envAEn}, ${lightingAEn}. / The camera rapidly pulls back and zooms out, revealing — ${frozenCore} ${envAEn}. ${lightingAEn}. NO dialogue. NO speaking. NO lip movement. MOUTH STAYS CLOSED. SILENT FILM.`
    : `${frozenCore} ${envAEn}. ${lightingAEn}. NO dialogue. NO speaking. NO lip movement. MOUTH STAYS CLOSED. SILENT FILM.`

  const audioNote = `BGM: 이어서, 비트 유지 / 효과음: ${label} 임팩트 + ${audioCue.soundFx}(컷 시작) / 타점: ${audioCue.beat}`

  const subtitle = cpLine || '...어?'

  const preview = openOnCloseUp
    ? {
        step1: `[0.0s ~ 1.5s 오프닝]: 평온한 클로즈업 표정.`,
        step2: `[1.5s ~ ${durationSec}s 줌아웃 리빌]: 카메라가 빠르게 빠지며 ${label}로 이미 얼어붙은 혼돈 장면 등장, 카메라가 주위를 ${orbitDegrees}도 돈다. 필요하면 뒤에 리액션 클립을 별도 생성해 하드컷으로 붙일 것.`,
      }
    : {
        step1: `[0.0s ~ ${durationSec}s 전체]: ${label}의 정점에서 완전히 얼어붙은 채, 카메라가 주위를 ${orbitDegrees}도 돈다. 필요하면 앞뒤에 평소/리액션 클립을 별도 생성해 하드컷으로 붙일 것.`,
      }

  return {
    cutPatch: { scene, imagePrompt, videoPrompt, subtitle, beat, audioNote },
    preview,
    audioCue,
  }
}

// ── 불릿타임 멀티앵글 키프레임 프롬프트 세트 — 2026-10-16 신설 ──────────────────
// LongTake AI Studio(성준님 자작 도구)의 "카메라 어레이" 방식 참고: 진짜 불릿타임 리그는 여러
// 각도에서 동시에 찍은 정지 스틸을 이어붙여 만든다. 그 도구의 Gemini API 키프레임 렌더링
// (gemini-3.1-flash-lite-image)이 무료 티어 할당량 0으로 막혀있어(RESOURCE_EXHAUSTED, 10/16
// 실측 — limit:0은 "오늘 다 씀"이 아니라 무료 티어 자체에서 제외된 모델이라는 뜻), 성준님 결정:
// "운영이 활성화되기 전까지는 API 확대 보류, 수동이라도 AI Pro 구독 범위(Gemini 웹앱)에서 생성"
// ([[project_veo_api_emergency_path]]와 동일 원칙 — 평소 무료 수동 경로, API는 나중에 확대).
// 그래서 이 함수는 이미지를 직접 만들지 않고, Gemini 앱에 수동으로 붙여넣을 각도별 프롬프트
// 텍스트만 만든다 — buildFreezeBeatCut()과 같은 "얼어붙은 정점" 묘사를 공유하되 카메라가 몇 도
// 위치에서 바라보는지만 바꾼다. angles를 안 주면 LongTake 스튜디오와 동일한 8방향 전체를 낸다.
const FREEZE_ANGLE_DIRECTIONS = [
  { deg: 0,   ko: '정면',       en: 'front view, facing the camera' },
  { deg: 45,  ko: '우측 45도',  en: 'three-quarter view from the front-right' },
  { deg: 90,  ko: '우측면',     en: 'right profile view' },
  { deg: 135, ko: '우후면',     en: 'three-quarter view from the back-right' },
  { deg: 180, ko: '후면',       en: 'back view, facing away from the camera' },
  { deg: 225, ko: '좌후면',     en: 'three-quarter view from the back-left' },
  { deg: 270, ko: '좌측면',     en: 'left profile view' },
  { deg: 315, ko: '좌측 45도',  en: 'three-quarter view from the front-left' },
]

export function buildFreezeKeyframeAngles({ action, sceneA, angles }) {
  if (!action?.ko?.trim() || !action?.en?.trim()) throw new Error('action.ko, action.en(얼어붙은 정점 상태 한글/영문 묘사) 필요')
  const envAEn = sceneA?.envEn?.trim() || 'a softly lit, minimal space with a shallow depth of field, no specific background details'
  const lightingAEn = sceneA?.lightingEn?.trim() || 'soft neutral ambient light'
  const list = Array.isArray(angles) && angles.length
    ? FREEZE_ANGLE_DIRECTIONS.filter((a) => angles.includes(a.deg))
    : FREEZE_ANGLE_DIRECTIONS

  return list.map(({ deg, ko, en }) => ({
    angleDeg: deg,
    label: `${deg}° (${ko})`,
    imagePrompt: `MEDIUM SHOT — same Korean woman, same face, natural skin texture, never exaggerated, frozen mid-action — ${action.en} — her pose held at its most dramatic peak, ${FREEZE_RIG}, camera positioned ${deg} degrees around her on a fixed ~2m-radius orbit, ${en}, in ${envAEn}, photorealistic 8K cinematic, natural Korean beauty, effortlessly photogenic not posing just existing beautifully, avoid: acne, pimples, blemishes, skin blotches, rough or bumpy skin, uneven skin tone, redness, oily shine, lighting: ${lightingAEn}, never legible text or UI, vertical 9:16`,
  }))
}
