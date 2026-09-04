// ── 릴스 최종화 모듈 ────────────────────────────────────────────────
// 파싱된 컷(scriptParserV3) + downloads/.../05_video/cut_NN.mp4 를 받아
//   컷별 편집 판단(레터박스 여부 · 자막 번인 · 효과음) → 규격화 → concat →
//   자막 .ass 번인 → 효과음/BGM 믹스 → 07_output/{CODE}_final.mp4
// 를 만든다. 판단 내역은 {CODE}_finalize.json 으로 남긴다.
//
// 호출: finalizeReel({ epNum, cuts, bgmFile?, onLog? })
//   cuts: parseCutsV3() 결과 배열 (proxy 가 ep.cuts 를 넘김)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import * as mp from './mediaPaths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 손글씨체 — 레퍼런스(0808.mp4) 스타일. app/assets/fonts 번들.
const FONT = 'Gaegu'
const FONTS_SRC = path.join(__dirname, '..', '..', 'assets', 'fonts')          // Gaegu-Bold.ttf 등
const EMOJI_FONT_WIN = 'C:\\Windows\\Fonts\\seguiemj.ttf'                       // 컬러 이모지 폴백(COLR/CPAL)

// ── 효과음 규칙 — "AI연구소 효과음 모음집" 가이드(_shared/sfx/SFX_GUIDE.md) 기반 ─────
// 대본 "효과음:" 텍스트(+보조로 MD 감정·SC 장면)의 키워드로 매칭. 위에서부터 먼저 맞는 것.
//   at: 'start' | 'mid' | 'end'   layer:true → 자연소리(BGM 위에 길게 -18dB)
//   alts: 같은 파일이 이미 2회 쓰였을 때 대체할 동일 계열 파일들
const SFX_RULES = [
  // 특정도 높은 것 먼저
  { kw: /하트[·,\s]*별|별[·,\s]*하트|데코\s*팝업|하트.*팝업|별.*팝업/i, file: 'click/mixkit-happy-bell-alert-601.wav', at: 'start', gain: 0.5 },
  // 감성 자연소리·타이핑 (layer — BGM 과 겹쳐 길게)
  { kw: /타이핑|키보드|typing|keyboard|메시지\s*작성/i, file: 'ambience/mixkit-keyboard-typing-1386.wav', at: 'start', gain: 0.4, maxDur: 4.5 },
  { kw: /마무리|엔딩|ending|피아노/i, file: 'ambience/mixkit-little-piano-game-over-1944.wav', at: 'end', gain: 0.4 },
  { kw: /슬픈\s*회상|비극|비와\s*천둥|폭우/i, file: 'ambience/mixkit-rain-and-thunder-storm-2390.wav', at: 'start', gain: 0.22, layer: true },
  { kw: /쓸쓸|잔잔한\s*슬픔|가벼운\s*비|light\s*rain/i, file: 'ambience/mixkit-light-rain-loop-2393.wav', at: 'start', gain: 0.2, layer: true },
  { kw: /불길|천둥\s*우르릉|thunder\s*rumble/i, file: 'ambience/mixkit-thunder-rumble-during-a-storm-2395.wav', at: 'start', gain: 0.24, layer: true },
  { kw: /차분한?\s*회고|물\s*흐름|water\s*flow|감성\s*회상/i, file: 'ambience/mixkit-water-flowing-ambience-loop-3126.wav', at: 'start', gain: 0.2, layer: true },
  { kw: /야외|시골|새소리|정글|birds/i, file: 'ambience/mixkit-birds-in-the-jungle-2434.wav', at: 'start', gain: 0.22, layer: true },
  { kw: /강한?\s*폭풍|거친\s*감정|위기\s*상황|wild\s*wind/i, file: 'ambience/mixkit-strong-wild-wind-in-a-storm-2407.wav', at: 'start', gain: 0.26, layer: true },
  { kw: /신비로운\s*깨달음|마법\s*알림|좋은\s*소식/i, file: 'ambience/mixkit-magic-notification-ring-2344.wav', at: 'mid', gain: 0.5 },

  // 결과 공개 직전 긴장
  { kw: /드럼\s*롤|drum\s*roll|결과\s*공개\s*직전|진실\s*공개\s*직전/i, file: 'tension/mixkit-tension-and-suspense-drum-roll-577.wav', at: 'end', gain: 0.5 },
  { kw: /냉혹|차가운\s*분위기|금속성\s*긴장|metallic\s*sweep/i, file: 'tension/mixkit-metallic-sweep-suspense-670.wav', at: 'start', gain: 0.45 },
  { kw: /클라이맥스\s*빌드업|라이저|riser|고조\s*직전/i, file: 'tension/mixkit-cinematic-trailer-riser-790.wav', at: 'end', gain: 0.5 },
  { kw: /긴장|서스펜스|suspense|tension|고조/i, file: 'tension/mixkit-cinematic-suspense-swell-786.wav', at: 'start', gain: 0.42 },

  // 임팩트·폭로 (강조)
  { kw: /묵직한?\s*폭로|진실\s*공개|deep\s*impact/i, file: 'impact/mixkit-cinematic-whoosh-deep-impact-1143.mp3', at: 'mid', gain: 0.8 },
  { kw: /결정적\s*폭로|충격적\s*진실|폭탄|bomb\s*drop/i, file: 'reveal/mixkit-bomb-drop-impact-2804.wav', at: 'mid', gain: 0.85 },
  { kw: /거대한\s*충격|운명|천둥\s*폭발|distant\s*thunder/i, file: 'reveal/mixkit-distant-thunder-explosion-1278.wav', at: 'mid', gain: 0.8 },
  { kw: /갈등\s*폭발|대결\s*시작|전쟁의\s*북|drums\s*of\s*war/i, file: 'reveal/mixkit-drums-of-war-call-2780.wav', at: 'start', gain: 0.7 },
  { kw: /관계\s*파탄|신뢰\s*무너|유리\s*깨/i, file: 'impact/mixkit-cinematic-glass-hit-suspense-677.wav', at: 'mid', gain: 0.8 },
  { kw: /트레일러급|예고편|epic\s*impact/i, file: 'impact/mixkit-movie-trailer-epic-impact-2908.wav', at: 'mid', gain: 0.8 },
  { kw: /큰\s*임팩트|결정적\s*순간|최고조|클라이맥스/i, file: 'impact/mixkit-big-cinematic-impact-788.mp3', at: 'mid', gain: 0.8 },
  { kw: /심장\s*박동|긴장감\s*고조|heart\s*beat/i, file: 'impact/mixkit-human-single-heart-beat-490.wav', at: 'start', gain: 0.55 },
  { kw: /인트로|도입부|챕터\s*시작|introduction/i, file: 'impact/mixkit-introduction-bell-sound-1150.wav', at: 'start', gain: 0.6 },
  { kw: /에너지\s*흐름|시간\s*흐름|energy\s*flow/i, file: 'impact/mixkit-shot-light-energy-flowing-2589.wav', at: 'start', gain: 0.5 },
  { kw: /공기\s*가르|강타|강한\s*충격|air\s*in\s*a\s*hit/i, file: 'impact/mixkit-air-in-a-hit-2161.wav', at: 'mid', gain: 0.75 },
  { kw: /만화적\s*충격|어이없는\s*상황|dazzle\s*hit/i, file: 'impact/mixkit-cartoon-dazzle-hit-and-birds-746.wav', at: 'mid', gain: 0.7 },

  // 아이러니·비꼼
  { kw: /틀린?\s*판단|실패\s*강조|틀림\s*부저|wrong\s*buzzer/i, file: 'irony/mixkit-wrong-long-buzzer-954.wav', at: 'mid', gain: 0.7 },
  { kw: /오답|틀린\s*선택|황당한\s*결정|wrong\s*answer/i, file: 'irony/mixkit-game-show-wrong-answer-buzz-950.wav', at: 'mid', gain: 0.7 },
  { kw: /어이없는\s*반응|게임쇼\s*부저|buzz\s*in/i, file: 'irony/mixkit-game-show-buzz-in-3090.wav', at: 'mid', gain: 0.7 },
  { kw: /현실\s*깨짐|위화감|글리치\s*비꼼|glitch\s*robot/i, file: 'irony/mixkit-futuristic-glitch-robot-1039.wav', at: 'mid', gain: 0.6 },
  { kw: /글리치|glitch|오류|버그|의문\s*제기/i, file: 'irony/mixkit-small-electric-glitch-2595.wav', at: 'mid', gain: 0.6 },

  // 분위기 반전·회상
  { kw: /회상\s*진입|회상\s*시작|테이프\s*되감기|tape\s*rewind|플래시백/i, file: 'mood_shift/mixkit-tape-rewind-cinematic-transition-1088.wav', at: 'start', gain: 0.6 },
  { kw: /분위기\s*깨기|갑작스런?\s*전환|레코드\s*스크래치|record\s*scratch|스크래치/i, file: 'mood_shift/mixkit-vinyl-forward-and-back-scratch-705.wav', at: 'start', gain: 0.6 },
  { kw: /흐름\s*끊|새\s*국면/i, file: 'mood_shift/mixkit-record-player-vinyl-scratch-702.wav', at: 'start', gain: 0.55 },

  // 개그·코믹
  { kw: /깜짝|반전|surprise|실패\s*드럼|낙담/i, file: 'comedy/mixkit-fail-drum-and-xylophone-568.wav', at: 'mid', gain: 0.85 },
  { kw: /기대\s*깨짐|허탈|실망\s*트롬본|trombone/i, file: 'comedy/mixkit-trombone-disappoint-744.wav', at: 'mid', gain: 0.75 },
  { kw: /잘못된?\s*판단\s*코믹|오답\s*알림/i, file: 'comedy/mixkit-wrong-answer-fail-notification-946.wav', at: 'mid', gain: 0.7 },
  { kw: /광대\s*호른|어이없음|clown\s*horn/i, file: 'comedy/mixkit-funny-clown-horn-sounds-2886.wav', at: 'mid', gain: 0.65 },
  { kw: /비웃음|조롱|만화\s*웃음/i, file: 'comedy/mixkit-cartoon-voice-laugh-343.wav', at: 'mid', gain: 0.65 },
  { kw: /여러\s*명이?\s*비웃|다\s*같이\s*웃/i, file: 'comedy/mixkit-cartoon-laugh-voice-2882.wav', at: 'mid', gain: 0.65 },
  { kw: /능청|모르는\s*척|만화\s*휘파람/i, file: 'comedy/mixkit-cartoon-whistling-738.wav', at: 'start', gain: 0.6 },
  { kw: /갑작스런?\s*등장|휘파람\s*폭죽|firework/i, file: 'comedy/mixkit-fast-whistle-firework-3103.wav', at: 'start', gain: 0.6 },

  // 뽕·팝 (자막·이미지 톡톡)
  { kw: /문자|카톡|메시지\s*알림|SNS\s*알림|message\s*pop/i, file: 'pop/mixkit-message-pop-alert-2354.mp3', at: 'start', gain: 0.55 },
  { kw: /주요\s*키워드|강조\s*자막|강한\s*팝|hard\s*pop/i, file: 'pop/mixkit-hard-pop-click-2364.wav', at: 'start', gain: 0.6 },
  { kw: /짧은\s*단어|키워드\s*강조|물방울/i, file: 'pop/mixkit-water-bubble-1317.wav', at: 'start', gain: 0.55 },
  { kw: /부드러운\s*정보|비누방울|soap\s*bubble/i, file: 'pop/mixkit-soap-bubble-sound-2925.wav', at: 'start', gain: 0.5 },
  { kw: /분할\s*전환|화면\s*전환|전환\s*효과|긴\s*팝|부드럽게\s*등장|팝업|pop/i, file: 'pop/mixkit-long-pop-2358.wav', at: 'start', gain: 0.55 },

  // 클릭·딩
  { kw: /정답|깨달음|핵심\s*정보|주인공의?\s*깨달음/i, file: 'click/mixkit-toy-drums-and-bell-ding-560.wav', at: 'mid', gain: 0.6 },
  { kw: /긍정적\s*전환|좋은\s*소식|밝은\s*알림|happy\s*bell/i, file: 'click/mixkit-happy-bell-alert-601.wav', at: 'start', gain: 0.55 },
  { kw: /카운트다운|결과\s*공개\s*직전\s*긴장|countdown/i, file: 'click/mixkit-melodic-race-countdown-1955.wav', at: 'end', gain: 0.55 },
  { kw: /카메라\s*셔터|사진\s*강조|증거|shutter/i, file: 'click/mixkit-camera-shutter-click-1133.wav', at: 'mid', gain: 0.6 },
  { kw: /인물\s*등장|문\s*종소리|새\s*장면\s*시작/i, file: 'click/mixkit-cartoon-door-melodic-bell-110.wav', at: 'start', gain: 0.55 },
  { kw: /신속한\s*결정|빠른\s*전개|더블\s*클릭/i, file: 'click/mixkit-fast-double-click-on-mouse-275.wav', at: 'start', gain: 0.55 },
  { kw: /선택|결정|메뉴|옵션|click|클릭/i, file: 'click/mixkit-select-click-1109.wav', at: 'start', gain: 0.6 },

  // 슉·전환 (whoosh) — 가장 일반적, 맨 아래
  { kw: /회상\s*진입\s*신호|과거로\s*빨려|reverse\s*whoosh/i, file: 'whoosh/reverse whoosh.wav', at: 'start', gain: 0.55 },
  { kw: /챕터\s*전환|시간.*점프|공간.*점프|회상\s*종료|cinematic\s*whoosh/i, file: 'whoosh/cinematic whoosh transition.wav', at: 'start', gain: 0.55 },
  { kw: /충격적\s*사실\s*공개|자막\s*강조|반전\s*직전|hit\s*woosh/i, file: 'whoosh/hit woosh sweep.mp3', at: 'mid', gain: 0.7 },
  { kw: /줌인|줌아웃|클로즈업\s*강조|중요\s*텍스트\s*강조|zoom\s*woosh/i, file: 'whoosh/zoom woosh.wav', at: 'start', gain: 0.55 },
  { kw: /꿈|상상\s*장면|호기심\s*자극|magic\s*sweep/i, file: 'whoosh/woosh magic sweep.wav', at: 'start', gain: 0.5 },
  { kw: /갈등|인물\s*대립|날카로운\s*긴장|sword/i, file: 'whoosh/woosh swoosh sword.wav', at: 'start', gain: 0.55 },
  { kw: /쓸쓸한\s*분위기|정적인\s*장면|woosh\s*wind/i, file: 'whoosh/woosh wind.wav', at: 'start', gain: 0.35, layer: true },
  { kw: /일상\s*장면|부드러운\s*전환|air\s*whoosh/i, file: 'whoosh/air whoosh.wav', at: 'start', gain: 0.45 },
  { kw: /전환|자막\s*등장|swoosh|스와이프|swipe|휙/i, file: 'whoosh/swoosh.wav', at: 'start', gain: 0.5 },
  { kw: /whoosh|슉/i, file: 'whoosh/whoosh.wav', at: 'start', gain: 0.5 },
]
// 계열별 대체 목록(같은 파일 2회 초과 시 변주 — 가이드 "같은 효과음 3번 이상 반복 금지")
const SFX_ALTS = {
  'whoosh/swoosh.wav': ['whoosh/whoosh.wav', 'whoosh/air whoosh.wav'],
  'whoosh/whoosh.wav': ['whoosh/swoosh.wav', 'whoosh/air whoosh.wav'],
  'pop/mixkit-long-pop-2358.wav': ['pop/mixkit-hard-pop-click-2364.wav', 'pop/mixkit-soap-bubble-sound-2925.wav'],
  'click/mixkit-select-click-1109.wav': ['click/mixkit-clear-mouse-clicks-2997.wav', 'click/mixkit-fast-double-click-on-mouse-275.wav'],
  'comedy/mixkit-fail-drum-and-xylophone-568.wav': ['comedy/mixkit-trombone-disappoint-744.wav', 'comedy/mixkit-wrong-answer-fail-notification-946.wav'],
  'click/mixkit-toy-drums-and-bell-ding-560.wav': ['click/mixkit-happy-bell-alert-601.wav', 'impact/mixkit-introduction-bell-sound-1150.wav'],
}
// "정적"/"없음" 은 효과음 없음
const SFX_NONE = /^\s*(없음|정적|무음|-|n\/?a|silence)?\s*$|정적\s*[\d.]/i

// ── 대본에서 컷별 CP(자막) · 오디오(BGM/음성/효과음) 보강 ──────────────
// scriptParserV3 는 v3.0 포맷(오디오 헤더에 콜론 없음, BGM 이 열0, CP 가 KR 블록에만 존재)의
// 자막·오디오를 못 뽑는다. 여기서 raw 를 직접 훑어 컷별로 채운다(있는 값은 안 덮음).
export function enrichCutsFromScript(cuts, raw) {
  if (!raw) return cuts
  const blocks = {}
  const parts = raw.split(/^\[CUT\s+(\d+)\]/m)
  // parts: [pre, "1", body1, "2", body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    blocks[Number(parts[i])] = parts[i + 1] || ''
  }
  const pick = (body, re) => { const m = body.match(re); return m ? m[1].trim() : '' }
  const notNone = (s) => s && !/^(없음|-|n\/?a|\(작성 필요\))/i.test(s.trim())

  return cuts.map((c) => {
    const body = blocks[c.no]
    if (!body) return c
    const cp = pick(body, /CP\s*\(자막\)\s*[:：]\s*(.+)/)
      || pick(body, /^\s*CP\s*[:：]\s*(.+)/m)
    const nr = pick(body, /NR\s*\(나레이션\)\s*[:：]\s*(.+)/)
      || pick(body, /^\s*NR\s*[:：]\s*(.+)/m)
    // 오디오 블록 — "오디오" 헤더(콜론 유무 무관) 다음의 BGM/음성/효과음/앰비언스 줄
    const audioSeg = body.split(/(?:^|\n)\s*오디오\s*[:：]?\s*\n/).slice(1).join('\n')
    const ax = (label) => pick(audioSeg || body, new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*(.+)`))
    const merged = { ...c }
    if (!notNone(merged.subtitle) && notNone(cp)) merged.subtitle = cp
    if (!notNone(merged.narration) && notNone(nr)) merged.narration = nr
    const mc = { ...(merged.masterCode || {}) }
    const audio = { ...(mc.audio || { bgm: '', voice: '', sfx: '', ambience: '' }) }
    if (!audio.bgm) audio.bgm = ax('BGM')
    if (!audio.voice) audio.voice = ax('음성')
    if (!audio.sfx) audio.sfx = ax('효과음')
    if (!audio.ambience) audio.ambience = ax('앰비언스')
    mc.audio = audio

    // "손글씨 오버레이" 섹션 → 자막 시각 힌트(말풍선/색/데코/화살표)
    const hwSeg = body.split(/(?:^|\n)\s*손글씨\s*오버레이[^\n]*\n/).slice(1).join('\n').split(/\n\s*━{4,}/)[0] || ''
    if (hwSeg.trim()) {
      const hint = {}
      if (/구름/.test(hwSeg)) hint.bubble = 'cloud'
      else if (/타원|둥근\s*말풍선/.test(hwSeg)) hint.bubble = 'oval'
      else if (/화살표\s*박스|arrow_box/.test(hwSeg)) hint.bubble = 'arrow_box'
      else if (/말풍선/.test(hwSeg)) hint.bubble = /빨간|빨강|red/.test(hwSeg) ? 'oval' : 'arrow_box'
      if (/핑크|분홍|pink/.test(hwSeg)) hint.color = 'pink'
      else if (/라벤더|보라|lavender|purple/.test(hwSeg)) hint.color = 'lavender'
      else if (/빨간|빨강|red/.test(hwSeg)) hint.color = 'pink'
      if (/화살표\s*스티커|화살표\s*데코/.test(hwSeg)) hint.arrow = true
      // 데코: "데코:" 줄 + 따옴표 없는(=캡션 아닌) 줄에서만 이모지/키워드 수집
      const decoLines = hwSeg.split('\n').filter((ln) => /데코|스티커/.test(ln) || (!/^\s*["']/.test(ln) && !/\d\s*단계/.test(ln)))
      const decoSrc = decoLines.join(' ')
      const deco = [...new Set(decoSrc.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu) || [])]
      if (/하트|heart/.test(decoSrc) && !deco.some((d) => /[❤💜💖💗]/.test(d))) deco.unshift('♡')
      if (/별|star/.test(decoSrc) && !deco.includes('✨')) deco.push('✨')
      if (deco.length) hint.deco = deco.slice(0, 3)
      if (Object.keys(hint).length) merged.overlayHint = hint
    }

    merged.masterCode = mc
    return merged
  })
}

// ── 자막 스타일 (ass) ───────────────────────────────────────────────
function assHeader() {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${FONT},66,&H00FFFFFF,&H00FFFFFF,&H00303030,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,80,80,220,1
Style: Punch,${FONT},72,&H003C3CF5,&H00FFFFFF,&H00FFFFFF,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,2,80,80,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
}

function assTime(sec) {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = (s % 60)
  return `${h}:${String(m).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')}`
}

// 이모지는 유지한다(레퍼런스 스타일). seguiemj.ttf 폴백으로 컬러 렌더.
// variation selector(FE0F)·ZWJ(200D)만 정리 — libass 에서 폭 계산이 어긋날 수 있어서.
function cleanCaption(s) {
  return String(s).replace(/[\u{FE0F}\u{FE0E}]/gu, '').replace(/\s{2,}/g, ' ').trim()
}

// ── 컷별 편집 판단 ──────────────────────────────────────────────────
export function decideCut(cut) {
  const mc = cut.masterCode || {}
  const sp = String(mc.sp || '')
  const sh = String(mc.sh || '')
  const md = String(mc.md || '')
  const scene = `${cut.scene || ''} ${cut.action || ''}`
  const audio = mc.audio || {}

  // fit: 화면녹화(데스크톱 웹앱) 컷은 잘림 없이 레터박스, 나머지는 채움
  const isScreen = /IN\.SC|화면\s*녹화|화면녹화|screen\s*rec/i.test(sp + scene) || /SH_SCR/i.test(sh)
  const fit = isScreen ? 'contain' : 'cover'

  // caption: CP(자막) 있고, 그래픽이 자체 텍스트를 렌더하는 컷(SH_TEXT)만 아니면 번인
  const cp = String(cut.subtitle || '').trim()
  const graphicSelfText = cut.cutType === 'GRAPHIC' && /SH_TEXT/i.test(sh)
  let caption = null
  if (cp && !graphicSelfText) {
    // 반전/멀티스텝 판정 → 해당 세그먼트만 Punch(빨강)
    const isPunch = (/SUR/i.test(md) && /(COM|WRM)/i.test(md)) || /반전|twist|잠깐/i.test(scene + cp)
    // "1단계: X / 2단계: Y" 또는 "X / Y" → 세그먼트
    const rawSegs = cp.split(/\s*\/\s*/).map((t) => t.replace(/^\s*\d+\s*단계\s*[:：]\s*/, '').trim()).filter(Boolean)
    const segs = rawSegs.length ? rawSegs : [cp]
    const hint = cut.overlayHint || {}
    // 오버레이 렌더용 색/말풍선/위치 기본값 (대본 힌트 > 감정 > 컷타입)
    const warm = /WRM/i.test(md)
    const baseColor = hint.color || (warm ? 'lavender' : 'white')
    const basePos = /SH_TEXT/i.test(sh) ? 'center' : (fit === 'contain' ? 'bottom_center' : 'bottom_center')
    caption = {
      style: isPunch && segs.length === 1 ? 'Punch' : 'Cap',
      segments: segs.map((t, i) => {
        const isLast = i === segs.length - 1
        const segPunch = isPunch && (segs.length === 1 || isLast)
        const segStyle = segPunch ? 'Punch' : 'Cap'
        let burn = cleanCaption(t)
        if (/\s→\s/.test(burn) && burn.length > 16) burn = burn.replace(/\s→\s/, ' →\\N')
        burn = `"${burn}"`
        // 오버레이(handwriting_overlay.py) 씬 속성 — 레퍼런스처럼 판/비네트 없이(backing:false)
        // 흰 손글씨 + 외곽선 + 컬러 이모지 + 가벼운 데코. 말풍선은 과해서 기본 미사용.
        const overlay = {
          text: `"${cleanCaption(t).replace(/\s→\s/, ' →\n')}"`,
          position: basePos,
          font_size: 58,
          backing: false,
          bubble: 'none',
          color: 'white',
          deco: (hint.deco || (warm ? ['♡'] : (segPunch ? ['💥'] : []))).slice(0, 2),
          arrow: false,
          arrow_direction: hint.arrowDir || 'right',
        }
        return { raw: t, burn, style: segStyle, overlay }
      }),
    }
  }

  // sfx: 1순위 "효과음:" 필드, 2순위 SC/AC 장면 + MD 감정에서 추론
  const sfxText = String(audio.sfx || '')
  const sfx = []
  const pickRule = (hay) => SFX_RULES.find((r) => r.kw.test(hay))
  if (!SFX_NONE.test(sfxText)) {
    let rule = pickRule(sfxText)
    // 필드가 비었거나 "없음"이 아니지만 매칭 실패 → 장면/감정으로 보조 추론
    if (!rule) {
      const inferHay = `${scene} ${/SUR/i.test(md) ? '깜짝 반전' : ''} ${/반전|twist/i.test(scene) ? '분위기 깨기' : ''} ${/폭로|공개|진실/.test(scene) ? '결정적 폭로' : ''} ${/회상|과거/.test(scene) ? '회상 진입' : ''} ${/전환|switch/i.test(scene) ? '전환' : ''}`
      rule = pickRule(inferHay)
    }
    if (rule) sfx.push({ file: rule.file, at: rule.at, gain: rule.gain, maxDur: rule.maxDur || null, layer: !!rule.layer, reason: sfxText || scene.trim().slice(0, 40) })
  }

  return {
    no: cut.no,
    cutType: cut.cutType,
    durSec: Number(cut.duration) || 8,
    fit,
    caption,
    sfx,
    bgmText: String(audio.bgm || ''),
  }
}

// ── ffmpeg 실행 ────────────────────────────────────────────────────
function ff(args, opts = {}) {
  return new Promise((resolve, reject) => {
    // -y 필수 — 없으면 출력 파일이 이미 있을 때 "Overwrite? [y/N]" 프롬프트에서 영구 정지한다.
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'], ...opts })
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-500)}`))))
  })
}
function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('close', () => resolve(parseFloat(out.trim()) || 0))
    p.on('error', () => resolve(0))
  })
}
// handwriting_overlay.py 로 컬러 이모지·말풍선·손그림 데코까지 렌더(libass 우회)
const HW_OVERLAY_PY = path.join(__dirname, '..', '..', 'scripts', 'handwriting_overlay.py')
function runPy(args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn('python', args, { cwd: path.dirname(HW_OVERLAY_PY), stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.stderr.on('data', (d) => { err += d.toString() })
    const killer = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* noop */ } }, 240000)
    p.on('error', (e) => { clearTimeout(killer); resolve({ code: 1, out, err: err + e.message }) })
    p.on('close', (code) => { clearTimeout(killer); resolve({ code, out, err }) })
  })
}

function normVf(fit, w = 1080, h = 1920) {
  return fit === 'contain'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`
}

// ── 메인 ───────────────────────────────────────────────────────────
/**
 * @param {object} p
 *   epNum   : 에피소드 번호 (경로 해석용)
 *   cuts    : parseCutsV3() 결과 배열
 *   bgmFile : (선택) BGM 파일 절대경로 또는 _shared/bgm 상대경로
 *   onLog   : (선택) 진행 로그 콜백 (line)
 */
export async function finalizeReel(p) {
  const { epNum, cuts, bgmFile, onLog } = p
  const log = (m) => { try { onLog && onLog(m) } catch { /* noop */ } }
  const code = mp.resolveCode(epNum)
  const vdir = mp.videoDir(epNum)
  const fdir = mp.finalDir(epNum)
  const mdir = mp.makingDir(epNum)
  fs.mkdirSync(fdir, { recursive: true })
  fs.mkdirSync(mdir, { recursive: true })

  if (!Array.isArray(cuts) || !cuts.length) throw new Error('cuts 가 비어있음 — 대본 파싱 결과를 넘기세요')

  // 1) 컷별 판단 + 파일 확인
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelfin_'))
  const decisions = []
  let cursor = 0
  for (const cut of cuts.slice().sort((a, b) => a.no - b.no)) {
    const src = path.join(vdir, `cut_${String(cut.no).padStart(2, '0')}.mp4`)
    if (!fs.existsSync(src)) { log(`⚠ cut_${String(cut.no).padStart(2, '0')}.mp4 없음 — 건너뜀`); continue }
    const d = decideCut(cut)
    const realDur = await ffprobeDuration(src)
    d.durSec = realDur > 0 ? realDur : d.durSec
    d.startSec = cursor
    d.src = src
    cursor += d.durSec
    decisions.push(d)
    const capDesc = !d.caption ? 'skip'
      : d.caption.segments.map((s) => (s.style === 'Punch' ? '빨강' : '흰')).join('+')
    log(`컷 ${d.no}: ${d.fit === 'contain' ? '레터박스' : '채움'} · 자막 ${capDesc} · SFX ${d.sfx.length ? d.sfx.map((s) => path.basename(s.file)).join(',') : '-'} · ${d.durSec.toFixed(1)}s`)
  }
  if (!decisions.length) throw new Error('사용 가능한 cut_NN.mp4 가 하나도 없습니다')
  const totalDur = cursor

  // 2) 각 컷 규격화 + 무음 오디오
  const listLines = []
  for (const d of decisions) {
    const out = path.join(tmp, `n_${String(d.no).padStart(2, '0')}.mp4`)
    await ff(['-i', d.src, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', normVf(d.fit), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out])
    listLines.push(`file '${out.replace(/\\/g, '/')}'`)
  }
  const listFile = path.join(tmp, 'list.txt')
  fs.writeFileSync(listFile, listLines.join('\n') + '\n')
  const concat = path.join(tmp, 'concat.mp4')
  await ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concat])
  log(`concat: ${decisions.length}컷 · ${totalDur.toFixed(1)}s`)

  // 3) 자막 .ass — 멀티세그는 누적 스택(레퍼런스처럼 줄이 쌓임). 각 구간은 겹치지 않게.
  let ass = assHeader()
  let capCount = 0
  for (const d of decisions) {
    if (!d.caption) continue
    const segs = d.caption.segments
    const per = d.durSec / segs.length
    segs.forEach((seg, i) => {
      const st = d.startSec + i * per + 0.3
      const en = d.startSec + (segs.length === 1 || i === segs.length - 1 ? d.durSec : (i + 1) * per) - 0.05
      // 지금까지의 세그를 위→아래로 쌓아 하나의 Dialogue 로 (스타일이 섞이면 마지막 줄만 색상 태그)
      const lines = segs.slice(0, i + 1).map((s, j) => {
        const body = String(s.burn).replace(/\n/g, '\\N')
        return (s.style === 'Punch' && (segs[j].style === 'Punch')) ? `{\\c&H3C3CF5&}${body}{\\c}` : body
      })
      const style = segs.some((s) => s.style === 'Punch') ? 'Cap' : (seg.style || 'Cap')
      ass += `Dialogue: 0,${assTime(st)},${assTime(en)},${style},,0,0,0,,${lines.join('\\N')}\n`
      capCount++
    })
  }
  const assPath = path.join(fdir, `${code}_captions.ass`)
  fs.writeFileSync(assPath, ass, 'utf-8')
  const assTmp = path.join(tmp, 'subs.ass')
  fs.writeFileSync(assTmp, ass, 'utf-8')
  // 폰트: 번들 손글씨체 + 컬러 이모지 폴백을 tmp/fonts/ 로 모아 fontsdir 로 지정(ass 폴백용)
  const fontsTmp = path.join(tmp, 'fonts')
  fs.mkdirSync(fontsTmp, { recursive: true })
  try {
    for (const f of fs.readdirSync(FONTS_SRC)) {
      if (/\.(ttf|otf|ttc)$/i.test(f)) fs.copyFileSync(path.join(FONTS_SRC, f), path.join(fontsTmp, f))
    }
  } catch { /* noop */ }
  if (fs.existsSync(EMOJI_FONT_WIN)) { try { fs.copyFileSync(EMOJI_FONT_WIN, path.join(fontsTmp, 'seguiemj.ttf')) } catch { /* noop */ } }
  const SUBS_VF = 'subtitles=subs.ass:fontsdir=fonts'

  // 3b) handwriting_overlay.py 로 자막 렌더(컬러 이모지·말풍선·손그림 데코) — 실패 시 ass 폴백
  let baseForAudio = concat
  let captionMode = 'none'
  if (p.captionMode !== 'ass' && capCount > 0 && fs.existsSync(HW_OVERLAY_PY)) {
    const scenes = []
    for (const d of decisions) {
      if (!d.caption) continue
      const segs = d.caption.segments
      const per = d.durSec / segs.length
      segs.forEach((seg, i) => {
        const st = d.startSec + i * per + 0.3
        const en = d.startSec + (segs.length === 1 || i === segs.length - 1 ? d.durSec : (i + 1) * per) - 0.05
        const stacked = segs.slice(0, i + 1).map((s) => s.overlay.text.replace(/^"|"$/g, '')).join('\n')
        const o = seg.overlay
        scenes.push({
          time: `${st.toFixed(2)}~${en.toFixed(2)}s`,
          text: `"${stacked}"`,
          position: o.position, bubble: o.bubble || 'none', color: o.color || 'white',
          font_size: o.font_size || 58, backing: o.backing === true,
          deco: o.deco || [], arrow: !!o.arrow, arrow_direction: o.arrow_direction || 'right',
        })
      })
    }
    const cfgPath = path.join(tmp, 'overlay.json')
    fs.writeFileSync(cfgPath, JSON.stringify({ output_size: [1080, 1920], signature: p.signature === true, scenes }, null, 2), 'utf-8')
    const capOut = path.join(tmp, 'captioned.mp4')
    log(`자막 오버레이 렌더(handwriting_overlay.py) — 씬 ${scenes.length}개`)
    const r = await runPy([HW_OVERLAY_PY, '--config', cfgPath, '--input', concat, '--output', capOut])
    if (r.code === 0 && fs.existsSync(capOut) && fs.statSync(capOut).size > 10000) {
      baseForAudio = capOut; captionMode = 'overlay'
      fs.copyFileSync(cfgPath, path.join(fdir, `${code}_captions.overlay.json`))
    } else {
      log(`⚠ 오버레이 실패 → ass 자막으로 폴백: ${(r.err || r.out || '').slice(-300)}`)
    }
  }

  // 4) 효과음 + BGM 믹스
  const sfxInputs = []      // ffmpeg -i 인자
  const sfxFilters = []     // filter_complex 절
  const sfxLabels = []      // [s1] [s2] ...
  let idx = 1               // 입력 인덱스 (0 = concat)
  const useCount = {}       // 파일별 사용 횟수 — 가이드: 같은 효과음 3회+ 금지
  for (const d of decisions) {
    for (const s of d.sfx) {
      // 같은 파일 2회 초과 → 동일 계열 대체로 변주
      let file = s.file
      if ((useCount[file] || 0) >= 2) {
        const alt = (SFX_ALTS[file] || []).find((a) => (useCount[a] || 0) < 2 && fs.existsSync(mp.sfxDir(a)))
        if (alt) { log(`SFX 변주: ${path.basename(file)} → ${path.basename(alt)} (3회+ 반복 방지)`); file = alt }
      }
      const abs = mp.sfxDir(file)
      if (!fs.existsSync(abs)) { log(`⚠ SFX 없음: ${file}`); continue }
      useCount[file] = (useCount[file] || 0) + 1
      let atSec = d.startSec
      if (s.at === 'mid') atSec = d.startSec + d.durSec * 0.55
      else if (s.at === 'end') atSec = d.startSec + Math.max(0, d.durSec - 1.2)
      atSec += 0.15
      sfxInputs.push('-i', abs)
      const ms = Math.round(atSec * 1000)
      // layer(자연소리): 컷 길이만큼 길게, 페이드. 그 외: maxDur 로 짧게.
      const dur = s.layer ? Math.max(2, d.durSec - (atSec - d.startSec)) : (s.maxDur || null)
      const trim = dur ? `atrim=0:${dur.toFixed ? dur.toFixed(2) : dur},` : ''
      const fade = s.layer ? `,afade=t=in:st=0:d=0.6,afade=t=out:st=${(dur - 0.8).toFixed(2)}:d=0.8` : ''
      sfxFilters.push(`[${idx}:a]${trim}adelay=${ms}|${ms},volume=${s.gain}${fade}[s${idx}]`)
      sfxLabels.push(`[s${idx}]`)
      s._file = file
      idx++
    }
  }

  // BGM
  let bgmAbs = null
  const wantsBgm = decisions.some((d) => d.bgmText && !/^\s*(없음|-|n\/?a)?\s*$/i.test(d.bgmText))
  if (bgmFile) bgmAbs = path.isAbsolute(bgmFile) ? bgmFile : mp.bgmFile(bgmFile)
  else if (wantsBgm) {
    // _shared/bgm 에서 첫 파일 자동 사용
    try {
      const dir = mp.bgmDir()
      const first = fs.readdirSync(dir).find((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f))
      if (first) bgmAbs = path.join(dir, first)
    } catch { /* noop */ }
  }
  let bgmNote = 'BGM 없음'
  let bgmFilterOut = ''
  if (bgmAbs && fs.existsSync(bgmAbs)) {
    const bgmStart = decisions.find((d) => d.bgmText && !/없음/.test(d.bgmText))?.startSec ?? 0
    sfxInputs.push('-stream_loop', '-1', '-i', bgmAbs)
    const bi = idx
    const fadeOut = Math.max(0, totalDur - 1.5)
    sfxFilters.push(`[${bi}:a]atrim=0:${(totalDur - bgmStart).toFixed(2)},adelay=${Math.round(bgmStart * 1000)}|${Math.round(bgmStart * 1000)},volume=0.13,afade=t=in:st=${bgmStart.toFixed(2)}:d=1.2,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.5[bgm]`)
    bgmFilterOut = '[bgm]'
    bgmNote = `BGM: ${path.basename(bgmAbs)} (-17dB, 루프)`
    idx++
  } else if (wantsBgm) {
    bgmNote = 'BGM 필요(대본) 하나 _shared/bgm 에 트랙 없음 — CapCut 에서 추가'
  }

  const finalOut = path.join(fdir, `${code}_final.mp4`)
  const needAssBurn = captionMode !== 'overlay' && capCount > 0
  // sfxFilters 에는 위에서 SFX 절 + (있으면) BGM 절이 이미 모두 들어있다.
  if (sfxLabels.length || bgmFilterOut) {
    const amixIn = `[0:a]${sfxLabels.join('')}${bgmFilterOut}`
    const amixN = 1 + sfxLabels.length + (bgmFilterOut ? 1 : 0)
    const withSfx = needAssBurn ? path.join(tmp, 'withaudio.mp4') : finalOut
    await ff([
      '-i', baseForAudio, ...sfxInputs,
      '-filter_complex', `${sfxFilters.join(';')};${amixIn}amix=inputs=${amixN}:duration=first:normalize=0[aout]`,
      '-map', '0:v', '-map', '[aout]',
      ...(needAssBurn ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20']),
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', withSfx,
    ])
    if (needAssBurn) {
      await ff(['-i', withSfx, '-vf', SUBS_VF, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-c:a', 'copy', '-movflags', '+faststart', finalOut], { cwd: tmp })
    }
  } else if (needAssBurn) {
    await ff(['-i', baseForAudio, '-vf', SUBS_VF, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'copy', '-movflags', '+faststart', finalOut], { cwd: tmp })
  } else {
    fs.copyFileSync(baseForAudio, finalOut)
  }

  // 06_publishing/{ep}_raw.mp4 도 최신 concat 으로 갱신 (자막·SFX 없는 순수 이어붙임)
  try {
    const rawOut = path.join(mp.outputDir(epNum), `ep${epNum}_raw.mp4`)
    fs.mkdirSync(path.dirname(rawOut), { recursive: true })
    fs.copyFileSync(concat, rawOut)
  } catch { /* noop */ }

  // 5) 매니페스트
  const manifest = {
    code, epNum, generatedAt: new Date().toISOString(),
    duration: +totalDur.toFixed(2),
    captionsBurned: capCount,
    captionMode: captionMode === 'overlay' ? 'handwriting-overlay(컬러이모지·말풍선)' : (needAssBurn ? 'ass(libass 모노크롬)' : 'none'),
    bgm: bgmNote,
    cuts: decisions.map((d) => ({
      no: d.no, cutType: d.cutType, fit: d.fit,
      startSec: +d.startSec.toFixed(2), durSec: +d.durSec.toFixed(2),
      caption: d.caption ? {
        segments: d.caption.segments.map((s) => ({
          text: s.raw, style: s.style || d.caption.style,
          bubble: s.overlay?.bubble, color: s.overlay?.color, deco: s.overlay?.deco,
        })),
      } : null,
      sfx: d.sfx.map((s) => ({ file: s._file || s.file, at: s.at, layer: !!s.layer, reason: s.reason })),
    })),
  }
  fs.writeFileSync(path.join(fdir, `${code}_finalize.json`), JSON.stringify(manifest, null, 2), 'utf-8')

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* noop */ }
  log(`완료 → ${finalOut}`)
  return { finalPath: finalOut, manifest, assPath }
}
