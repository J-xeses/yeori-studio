// ── 카메라 이동연출 레퍼런스 저장소(2026-11-08) ──────────────────────────
// 배경: SF_E01 CUT1용으로 생성했던 드론 급상승·급강하 후보 영상(최종엔 미채택)의 카메라
// 기법을 SF_E02에 훅으로 재사용하려다, 기존 "시그 레퍼런스"(CH/LOOK_ID/SP, 룩·캐릭터 축)·
// "체인지 생성기"(트리거×VFX, 의상/배경 전환 축)·"프리즈 비트"(사건+카메라 오빗, 시간정지
// 전제)의 어느 틀에도 안 맞는다는 게 드러났다 — 이 세 모드 다 "카메라가 어떻게 움직이는가"를
// 1급 데이터로 다루지 않는다. 그래서 캐릭터·사건·의상과 무관하게 "카메라 무브 자체"를
// 재사용 단위로 저장하는 네 번째 저장소를 signatureRefs.js와 같은 패턴으로 만든다.
//
// 저장 형태: ipTemplate/vpTemplate에 {{BEFORE}}/{{AFTER}} 토큰을 남겨두고, buildCameraMoveCut()
// 호출 시 실제 장면 묘사로 치환한다 — 매 기법마다 전용 함수를 안 만들고도 재사용 가능하게.
import fs from 'node:fs'
import path from 'node:path'
import * as mp from './mediaPaths.js'

function storePath() {
  return path.join(mp.DOWNLOADS, '_shared', 'camera-moves', 'index.json')
}

// 2026-11-08 신설 — SF_E01 CUT1 드론 후보(Fly camera gen/Drone_camera_soaring_and_diving_
// 10e3cc21.mp4, 최종 미채택) 기법 + 기존 시그 레퍼런스 프리셋 중 순수 카메라 무브였던
// "극적 줌아웃 리빌"을 이쪽으로 이전(RetentionHookTab.jsx SIGNATURE_TECHNIQUE_PRESETS에서 제거).
const BUILTIN_PRESETS = [
  {
    id: 'drone-soar-dive',
    name: '드론 급상승·급강하 (훅)',
    description: '현재 장면에서 카메라가 공중으로 빠르게 상승해 전체를 훑은 뒤, 다음 장면의 인물에게 급강하하며 접근 — 두 컷 사이 패턴 인터럽트용 훅. SF_E01 CUT1용 드론 후보(최종 미채택, Fly camera gen/Drone_camera_soaring_and_diving) 참고.',
    caCode: 'CA_DR',
    suggestedDuration: 3,
    audioMotif: '급상승·급강하 스월(swoosh) 효과음 + 바람 소리, 상승 구간엔 BGM 위에 바람 레이어만 추가',
    ipTemplate: 'WIDE SHOT —\n{{BEFORE}},\nstreet-level low angle wide shot framed to leave headroom for an upward camera move,\nvertical 9:16,\nCinematic, photorealistic, 8K,\nbackground people must not interact with or interfere with the main character',
    vpTemplate: 'NO dialogue — pure camera-move hook, no narration\n\nFirst 0-33%: camera rapidly ascends high above the scene,\n{{BEFORE}},\nfalling away below, fast upward motion, slight motion blur.\n\nMid 33-50%: brief suspended aerial hold,\nwide view below, light and atmosphere visible across the scene.\n\nFinal 50-100%: camera dives rapidly downward,\nswooping toward {{AFTER}},\nfast descending motion, smooth landing into shot.',
    originEpisode: 'SF_E01',
    originCutNo: 1,
    referenceImage: '',
  },
  {
    id: 'dolly-zoom-out-reveal',
    name: '극적 줌아웃 리빌 (지구까지 빠지기)',
    description: '가까운 피사체에서 시작해 카메라가 빠르게 빠지며 지구 전체가 보이는 데까지 이어지는 돌리줌 — 오프닝 훅·엔딩 임팩트용(연출 재료 창고 ①, 2026-10-15 Instagram 레퍼런스). 2026-11-08: 시그 레퍼런스(CH/LOOK 축)에서 카메라 연출 레퍼런스로 이전 — 룩/캐릭터가 아니라 순수 카메라 무브라 이 저장소가 맞는 집.',
    caCode: 'CA_ZO',
    suggestedDuration: 4,
    audioMotif: '시네마틱 휩 사운드만, 음악 없이',
    ipTemplate: 'CLOSEUP SHOT —\n{{BEFORE}},\ntight on her face,\nvertical 9:16,\nPhotorealistic 8K cinematic natural Korean beauty',
    vpTemplate: 'NO dialogue — pure camera-move impact shot\n\nExtreme continuous dolly-zoom-out starting tight on her face,\n{{BEFORE}},\ncamera rapidly pulling back and ascending through the atmosphere until {{AFTER}},\nspeed ramp acceleration, radial motion blur.',
    originEpisode: '',
    originCutNo: null,
    referenceImage: '',
  },
]

function ensureSeeded(list) {
  if (list.length > 0) return list
  const seeded = BUILTIN_PRESETS.map((p) => ({ ...p, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(seeded, null, 2), 'utf-8')
  return seeded
}

export function listCameraMoves() {
  let list
  try { list = JSON.parse(fs.readFileSync(storePath(), 'utf-8')) } catch { list = [] }
  return ensureSeeded(list)
}

export function getCameraMove(id) {
  return listCameraMoves().find((t) => t.id === id) || null
}

// entry: { id?, name, description, caCode, suggestedDuration, audioMotif, ipTemplate, vpTemplate, originEpisode, originCutNo, referenceImage }
export function saveCameraMove(entry) {
  if (!entry?.name) throw new Error('name 필요')
  const list = listCameraMoves()
  const id = entry.id || entry.name.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `cam-${Date.now()}`
  const existing = list.findIndex((t) => t.id === id)
  const saved = {
    id,
    name: entry.name,
    description: entry.description || '',
    caCode: entry.caCode || '',
    suggestedDuration: entry.suggestedDuration || 4,
    audioMotif: entry.audioMotif || '',
    ipTemplate: entry.ipTemplate || '',
    vpTemplate: entry.vpTemplate || '',
    originEpisode: entry.originEpisode || '',
    originCutNo: entry.originCutNo ?? null,
    referenceImage: entry.referenceImage || '',
    createdAt: existing >= 0 ? list[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (existing >= 0) list[existing] = saved; else list.push(saved)
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf-8')
  return saved
}

export function deleteCameraMove(id) {
  const list = listCameraMoves().filter((t) => t.id !== id)
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf-8')
}

// 저장된 기법을 실제 컷 패치(IP/VP/CA/BEAT/DU)로 변환 — before/after는 이 훅컷의 앞·뒤에 오는
// 장면을 짧게 묘사한 영문 — 신호 전체(시그 레퍼런스의 masterCodeTemplate)가 아니라 이 한 컷의
// imagePrompt/videoPrompt/masterCode만 만든다(studio-state는 여기서 직접 안 건드림 — 다른
// 세 모드와 동일 원칙).
export function buildCameraMoveCut({ id, beforeDesc, afterDesc, sp = '', lookId = '', beat = '훅', duration, cpLine = '' }) {
  const t = getCameraMove(id)
  if (!t) throw new Error(`카메라 기법 없음: ${id}`)
  if (!beforeDesc?.trim() || !afterDesc?.trim()) throw new Error('beforeDesc(이전 장면), afterDesc(다음 장면) 영문 묘사가 필요합니다')
  const before = beforeDesc.trim()
  const after = afterDesc.trim()
  const sub = (s) => String(s || '').split('{{BEFORE}}').join(before).split('{{AFTER}}').join(after)
  const imagePrompt = sub(t.ipTemplate)
  const videoPrompt = sub(t.vpTemplate)
  const du = duration || t.suggestedDuration || 4

  return {
    technique: t,
    cutPatch: {
      imagePrompt,
      videoPrompt,
      beat,
      duration: du,
      subtitle: cpLine || '',
      dialogue: '',
      narration: '',
      masterCode: {
        ca: t.caCode, pl: 'BR_VD', sp, lookId,
        audio: { bgm: '', voice: '', sfx: t.audioMotif || '', ambience: '' },
        kr: { ca: `${t.name} (${before} → ${after})` },
      },
    },
    preview: {
      기법: t.name,
      이전장면: before,
      다음장면: after,
      DU: `${du}초`,
      오디오모티프: t.audioMotif || '',
    },
  }
}
