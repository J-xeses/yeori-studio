# 발화 컷 명세 — VP 대사 명시 + 세그먼트 분할 (SEG)

> 대상: v3 대본 포맷 / G3 TTS / G4 영상(YEORI) / G5 편집
> 근거: LF_T01 v10 검토 (2026-09-10) — 발화 컷의 VP가 "무엇을 말하는지"와
> "8초씩 어떻게 쪼개지는지"를 담지 못함.
> **2026-09-11 개정**: SEG 를 "임의 초 자유분할"에서 **"Veo 고정 생성단위(8/10초) 조합 +
> 트림"** 모델로 다시 설계(§2-1·2-1b·2-1c). Field Gate 가 후보 조합을 비교해서 고르고,
> 고른 결과를 대본 SEG 필드에 반영하는 흐름으로 정리(§4 2단계).
> 관련 룰셋: `yeori_ruleset_v1.4.md` §⑬ / §⑬-1 / §⑬-2(신설)
> 파서 이중 파일: `app/server/lib/scriptParserV3.js` ↔ `app/src/tabs/ScriptGenTab.jsx`

---

## 1. 문제 정의

### 1-1. VP에 대사 누락

발화 컷(DL 또는 NR 보유)의 VP(영상 프롬프트)는 **동작·표정·타임라인만** 기술하고
실제 발화 텍스트가 없다.

- `serverCutVideoMode()`: **LF = video-first → 대사 컷 = `veo` 모드** (사람이 Veo 3.1에서 제작).
  Veo 3는 네이티브 발화·립싱크를 생성하는데 프롬프트에 대사가 없으면 입만 벙긋대거나
  엉뚱한 말을 함.
- **DL과 NR은 정반대 처리**가 필요:
  - `DL` (대사) — 화면 속 인물이 말함 → **립싱크 필수**
  - `NR` (나레이션) — 보이스오버, 인물은 말 안 함 (예: LF_T01 CUT 16 "웃음 사그라들며
    몽환 눈빛") → **립싱크 금지**, 영상 모델엔 페이싱·길이만 필요

### 1-2. 8초 생성 단위 vs 20~25초 컷 + 대사 분할

- Veo 3.1 = 클립당 ~8초. 스크립트 컷은 20/25초 → **컷당 클립 2~3개**.
- VP가 이미 `First 0-8s / Next 8-17s / Final 17-25s` 3토막 구조지만:
  - 각 토막에 **그 구간에 말하는 대사 조각**이 없음
  - **클립 이어붙이기 지시 없음** — N번째 클립은 (N-1)번째 클립의 마지막 프레임에서
    이어져야 인물·의상·헤어·조명 연속성 유지
  - TTS는 통짜 `cut_NN.mp3` 하나 → 클립별 A/V 정렬 불가
- `/api/upload-cut-video?trimTo=` 주석 *"Veo 8초 → 컷 길이 트림"* = **8초 이하 컷 전제**로
  설계됨. 25초 컷엔 안 맞음.
- 룰셋 §⑬ "컷 길이 원칙 — 기본 8초, 초과 시 C01 → C01-1/C01-2/C01-3 자동 분할"은
  **선언만 있고 파서·파이프라인 어디에도 구현 없음**.

---

## 2. 설계 — `SEG` 필드 + `||` 분할 마커 + 발화 블록

### 2-1. 컷 헤더 블록: `SEG` 필드 (신규, 2026-09-11 모델 개정)

메인 필드 블록(SC/SP/PL … DU) 안, `DU:` 다음 줄에 적는다.

**핵심 전제(2026-09-11 확정)**: Veo 는 세그먼트를 "아무 길이"로나 생성할 수 없다.
**`SEG_UNITS = [8, 10]`** — 8초 또는 10초, 이 두 고정 생성모드뿐이다. 20/25초 같은 컷은
이 단위들을 이어붙여 만들고, 실제 필요 길이보다 남는 부분은 **편집에서 트림**해서 맞춘다
(§2-1b). 즉 SEG 는 "임의 초 자유분할"이 아니라 **"생성단위 조합"**을 적는다.

```
DU: 25
SEG: 8+8+10
```

| 값 형태 | 의미 |
|-|-|
| `SEG: 8+8+10` | 생성 순서대로 세그 길이 나열(각 값은 `SEG_UNITS` 원소). 생성 총합(`genTotal`)이 DU 이상이어야 함 — 남는 만큼 트림(§2-1b) |
| `SEG: auto` | 코드젠이 `computeSegmentPlans(DU)`(§2-1c) 1위 후보(트림 최소)로 자동 배정 |
| (필드 없음) | `DU ≤ 10` 컷의 기본 동작 — 단일 세그, 생성 길이는 `DU ≤ 8`→8초 / `8 < DU ≤ 10`→10초 자동 선택 |

- `DU > 10`인 YEORI 발화 컷은 **SEG 필수** (없으면 코드젠 경고 + `auto` 처리).
- 조합의 **순서가 의미를 가진다** — `8+8+10` 과 `10+8+8` 은 트림량은 같아도(§2-1b) 대사가
  실리는 위치(어느 세그가 더 긴 호흡을 갖는지)가 달라 편집 결과가 달라짐. 이게 Field Gate 가
  후보로 비교시켜주는 이유(§4 2단계).

### 2-1b. 트림 규칙 — 남는 길이는 처음·끝에서만 잘라낸다

중간 세그는 다음 세그와 "마지막 프레임에서 이어지기"(CONTINUE FROM …) 로 연속성을 잡아야
하므로 자르지 않는다. 트림은 항상 **1번 세그의 시작**과 **마지막 세그의 끝**에서만 일어난다.

```
genTotal  = SEG 값들의 합
trimTotal = genTotal − DU          (0 이상이어야 함 — 코드젠이 검증, 음수면 SEG 조합 오류)
trimStart = floor(trimTotal / 2)   ← 1번 세그 맨 앞에서 잘라낼 초
trimEnd   = ceil(trimTotal / 2)    ← 마지막 세그 맨 끝에서 잘라낼 초
```

예:
| DU | SEG | genTotal | trimTotal | trimStart / trimEnd |
|-|-|-|-|-|
| 20 | `10+10` | 20 | 0 | 0 / 0 (트림 없음, 정확히 맞음) |
| 20 | `8+8+8` | 24 | 4 | 2 / 2 |
| 25 | `8+8+10` | 26 | 1 | 0 / 1 |
| 25 | `10+8+8` | 26 | 1 | 0 / 1 (트림량 같지만 순서가 달라 10초 호흡이 앞에 옴) |
| 25 | `10+10+8` | 28 | 3 | 1 / 2 |

- **대사 배치 규칙**: 1번 세그의 첫 `trimStart`초, 마지막 세그의 끝 `trimEnd`초는 최종본에서
  잘려나간다 — 이 구간에 중요 대사가 걸치지 않게 배치한다(자동 분할(`auto`)은 이 규칙을
  지키고, 수동 배치 시 권장사항으로 체크리스트에 안내).

### 2-1c. `computeSegmentPlans(DU)` — Field Gate 후보 비교용 순수 함수

```
computeSegmentPlans(DU, units = SEG_UNITS, maxSegs = 3)
  → [{ combo:number[], genTotal, trimTotal, trimStart, trimEnd }, ...]
```

- `units`(기본 `[8,10]`)의 길이 1~`maxSegs`(기본 3) 조합 중 `genTotal ≥ DU` 인 것을 전부 계산.
- **정렬 기준**: `trimTotal` 오름차순 → 같으면 세그 개수 적은 순 → 같으면 조합 순서(입력 순서) 유지.
- 순서가 다른 동일 길이-집합(`8+8+10` vs `10+8+8` vs `8+10+8`)은 **각각 별개 후보**로 남긴다
  (트림량은 같아도 대사 배치 느낌이 다르므로 — §2-1 참고).
- Field Gate 는 이 배열을 나란히 보여주고, 후보마다 대사를 `splitDialogueBySeg` 로 미리 나눠
  보여준 뒤 사용자가 고르면 그 `combo` 를 `SEG` 필드로 대본에 반영한다(§4 2단계, "📝 대본에
  반영"과 같은 패턴 — TTS 탭에 이미 있음).

### 2-2. `DL` / `NR` 분할 마커: ` || `

```
DL: "LE SSERAFIM은요, 데뷔 3년 차인데 || 이미 글로벌 팬덤을 완전히 장악한 그룹이잖아요. || 이번 콜라보에서 얘네 역할이 진짜 중요한 게…"
```

- `||` 개수 = `SEG` 개수 − 1. 코드젠이 검증 (불일치 시 오류).
- 분할 지점 = **문장·호흡 단위** (쉼표/마침표/접속어 앞). 단어 중간 금지.
- **트림 구간 회피** — 1번 세그 앞 `trimStart`초, 마지막 세그 뒤 `trimEnd`초에는 대사가 걸치지
  않게 분할(§2-1b). `auto` 분할은 자동 준수, 수동 배치는 권장사항.
- 다중 화자(`지아 "…" / 여리 "…"`)와 병존 가능:
  `DL: 지아 "야야! 이거 봤어?" || 여리 (표정으로만)` — 화자 슬래시 `/` 와 세그 `||` 는 축이 다름.
- `NR` 도 동일 규칙 (긴 나레이션 컷).

### 2-3. `발화 (한국어)` 블록 — VP 하단 자동 삽입

파서·빌더가 DL/NR 있는 컷의 VP 끝에 삽입한다(멱등: 마커 있으면 재삽입 안 함).

**단일 세그먼트 (SEG 없음 / DU ≤ 10):**
```
━━━ 발화 (한국어) ━━━
유형: 대사 — 인물이 화면에서 이 대사를 말함 (립싱크)
대사: "…중독이에요."
생성: Veo 가 이 대사를 한국어로 말하도록 — 립싱크·음성 함께.
후처리: 생성된 음성만 추출 → 서여리 음성으로 변환(speech-to-speech, 타이밍 유지) → 재합성.
```

**나레이션:**
```
━━━ 발화 (한국어) ━━━
유형: 나레이션 — 보이스오버, 인물은 입을 움직이지 않음 (립싱크 금지)
나레이션(VO): "근데 있잖아요… 좋은 거잖아요, 그냥."
생성: 나레이션 음성은 ElevenLabs 서여리 나레이션(cut_NN.mp3) 을 영상에 얹음.
```

**다중 세그먼트 (SEG 있음):** VP 를 세그먼트별로 재구성. 시간 표기는 **실제 생성 길이**
(8/10초 고정)로 적고, 트림이 걸리는 세그는 그 사실과 대사가 안전한 종료 지점을 명시한다.
아래는 `SEG: 8+8+10`(DU=25, §2-1b 예시 그대로 → trimStart=0, trimEnd=1) 기준.

```
━━━ SEG 1 / 3 · 생성 8초 (트림 없음) ━━━
[시작 프레임: G2 승인 이미지]
Medium closeup, calm analytical expression, one hand gesturing naturally.
SPEAKS (KO): "LE SSERAFIM은요, 데뷔 3년 차인데"  ← Veo 가 이 부분을 말하도록. 립싱크·음성 함께.

━━━ SEG 2 / 3 · 생성 8초 (트림 없음) ━━━
CONTINUE FROM SEG 1 FINAL FRAME (동일 인물·의상·헤어·조명 유지).
Expression shifts with slight excitement, leaning forward.
SPEAKS (KO): "이미 글로벌 팬덤을 완전히 장악한 그룹이잖아요."

━━━ SEG 3 / 3 · 생성 10초 (끝 1초 트림 예정) ━━━
CONTINUE FROM SEG 2 FINAL FRAME.
She pauses thoughtfully, glancing to the side then back to camera.
SPEAKS (KO): "이번 콜라보에서 얘네 역할이 진짜 중요한 게…"
※ 마지막 1초는 편집에서 잘려나감 — 대사는 9초 지점 전에 끝내고, 남는 1초는 표정 여운으로 채울 것.
```

세그먼트별 동작 비트는 기존 VP 의 `First / Next / Final` 문장을 세그 수에 맞춰 매핑.
트림이 있는 세그(1번 시작 또는 마지막 끝)는 "※ …초는 편집에서 잘려나감" 안내를 덧붙인다.

### 2-4. 음성 처리 — Veo 가 말하게 생성 → 서여리 음성으로 변환 (사용자 확정 2026-09-10)

DL 컷은 **Veo 가 립싱크와 음성을 함께 생성해야** 입모양이 맞는다. 무음 영상 + 별도 TTS
덮기는 립싱크가 안 맞음. 대신:

1. **Veo 생성** — 인물이 대사를 한국어로 말하는 영상 (네이티브 오디오 포함). 목소리 음색은
   서여리가 아니지만 상관없음 — 타이밍·입모양만 맞으면 됨.
2. **demucs 분리** — 영상 오디오를 대사(`cut_NN_voice.mp3`) + 배경음(`cut_NN_background.mp3`) 로 분리.
3. **ElevenLabs STS** — `/v1/speech-to-speech/{voiceId}` `model=eleven_multilingual_sts_v2`
   (stability 0.30, similarity_boost 0.75) → `cut_NN_yeori_voice.mp3`. 타이밍·억양·호흡 그대로,
   **음색만 서여리로** → 립싱크 유지.
4. **FFmpeg 3트랙 합성** — 영상 + 서여리음성 + 배경음 `amix` → `cut_NN_final.mp4`.

NR 컷은 인물이 말하지 않으므로 ElevenLabs 서여리 나레이션을 직접 얹으면 됨(변환 불필요).

**세그먼트가 있으면**: 각 세그 영상의 음성을 각각 변환 → 세그별 페어로 이어붙임.

**✅ 구현 상태**: STS 파이프라인은 **2026-06-23 구현·테스트됨** — 실행 `node scripts/test-sts.js
--ep=<N> --cut=<N>` (사전 `pip install demucs`), 로직은 `video-automation.js` `runStsPostProcess()` 에도.
**갭**: 프록시 엔드포인트가 없어 Field Gate/pipeline-leader/MCP 에서 못 부름 → CLI 수동.
현재 G4→G5 자동 체인(upload-cut-video → assemble)엔 안 엮임.

---

## 3. 파이프라인 영향 & diff 지점

### 3-1. 파서 (이중 파일 — 동시 수정)

`app/server/lib/scriptParserV3.js` + `app/src/tabs/ScriptGenTab.jsx`

| 지점 | 변경 |
|-|-|
| `V3_MAIN_FIELD_RE` | `SEG` 추가: `/^(SC\|SP\|…\|MOTION\|GTPL\|SEG):\s?(.*)$/` |
| `parseCutsV3` (server) / `parseCutsV3` (client) | `fields.SEG` → `segments: parseSegField(fields.SEG, duration)` 배열. `dialogue`/`narration` 의 `||` → 세그별 텍스트 매핑 |
| `parseCutsV3` 반환 컷 | `...(segments.length > 1 ? { segments } : {})` — `[{ idx, sec, startSec, endSec, dialogue, kind:'dl'|'nr' }]` |
| `serializeCutForRevision` (client) | `DU:` 다음에 `if (c.segments?.length>1) L.push('SEG: ' + c.segments.map(s=>s.sec).join(' / '))` + `DL:` 은 `||` 로 재결합 |
| `buildV3ScriptText` (client) | `SEG:` 줄 출력, VP 섹션은 `buildVP(c)` (세그 재구성 or 발화 블록 삽입) |
| `v3RevisionPatch` (client) | `fields.SEG` → `p.segments` |

**새 순수 함수** `app/src/lib/vpDialogue.js` (server 가 import — `videoPolicy.js` 선례):
- `SEG_UNITS = [8, 10]` 상수
- `parseSegField(raw, duration)` → `[{ sec, trimStart, trimEnd }]` (생성단위 배열 파싱 +
  §2-1b 트림 계산까지 포함해서 반환 — 소비하는 쪽(VP 빌더 등)이 매번 재계산 안 해도 되게)
- `computeSegmentPlans(duration, units = SEG_UNITS, maxSegs = 3)` → §2-1c. Field Gate 비교 UI 가 씀
- `splitDialogueBySeg(text, segCount, { trimStart, trimEnd, segSecs })` → `string[]`
  (`||` 기준, 없으면 문장/호흡 분할 + 트림 구간 회피(§2-2))
- `ensureDialogueInVP({ videoPrompt, dialogue, narration, segments, cutType })` → 증강된 VP (멱등,
  트림 안내 문구 포함 — §2-3)

### 3-2. TTS — `studio-run-g3` (`app/server/proxy.js`)

- `p.segs` (화자 세그) 위에 **길이 세그(SEG) 축을 추가**:
  컷에 `segments` 있으면 세그별로 `cut_NN_s{k}.mp3` 생성 + 합본 `cut_NN.mp3`
- 세그 mp3 실제 길이 측정 → 컷의 `segments[k].actualSec` 기록 (studio-state / gpoints 메모)
- `cleanForTTS`: ` || ` 마커를 공백으로 제거 (`BRACKET_RE` 처럼 규칙 1줄 추가)

### 3-3. 영상 — 체크리스트 & 업로드 (`app/server/proxy.js`)

| 엔드포인트 | 변경 |
|-|-|
| `/api/episode-video-checklist` | `videoPrompt: ensureDialogueInVP(...)`. 컷에 `segments` → `segments[]` 배열도 응답 (각 세그의 시작프레임 안내·LIP-SYNC 텍스트·목표초) |
| `/api/mcp/video-checklist` | 동일 |
| `/api/upload-cut-video` | `?seg=<k>` 파라미터 → `cut_NN_s{k}.mp4` 로 저장. `trimTo` 는 세그 목표초 |
| `serverCutTargetDuration` | 세그 있으면 세그별 목표초 |

### 3-4. 편집·합성 — G5 (`assembleMakingFilm` / `run-cutter` / `concat-video`)

- 컷 조립 시 `cut_NN_s*.mp4` 있으면 → concat 후 `cut_NN.mp4` 생성.
  각 세그 영상 ↔ `cut_NN_s{k}.mp3` 페어. 없으면 `cut_NN.mp4` 직접 (기존).
- `/api/cut-timing` 이 세그 단위 delta 도 검사.

### 3-5. 룰셋 §⑬-2 (신설)

`yeori_ruleset_v1.4.md` — 발화 컷 규칙:
- 모든 발화 컷 VP 에 `발화 (한국어)` 블록 (유형: 대사/나레이션 + verbatim)
- `DU > 10` YEORI 발화 컷은 `SEG` 필수, `DL` 에 `||` 로 세그 경계
- `SEG_UNITS = [8, 10]`(Veo 고정 생성단위) 조합 + 트림(§2-1b), 세그 경계는 문장·호흡 단위 +
  트림 구간 회피
- DL 컷: Veo 가 대사를 말하도록 생성(립싱크+음성) → 음성 추출 → 서여리 음성으로 변환(§2-4)
- NR 컷: 인물 입 안 움직임 + ElevenLabs 서여리 나레이션 직접
- 체크리스트 항목 추가

---

## 4. 단계적 적용

### 1단계 (경량 · 즉시) — VP 대사 자동 명시 ← **현재 착수**

- `app/src/lib/vpDialogue.js` `ensureDialogueInVP()` (멱등, 단일 세그 발화 블록만)
- `buildV3ScriptText` VP 섹션 + `/api/episode-video-checklist` + `/api/mcp/video-checklist`
  가 이걸 통과
- 룰셋 §⑬-2 최소 버전(발화 블록 규칙)
- **효과**: SEG 없이 사람이 3클립 수동 제작해도 "무슨 말 하는지"는 확보.
  `DU > 8` 컷엔 `※ 8초 초과 — 클립 N개 이어붙이기 필요` 안내 자동 부기.
- 파서 변경 없음 (VP 텍스트 끝에 append). 기존 대본 즉시 적용.

### 2단계 — SEG 필드(생성단위+트림 모델) + `||` + 코드젠 VP 재구성 + Field Gate 비교 UI

**2a. 대본/파서 쪽**
- 파서 이중 파일에 `SEG`(생성단위 조합) 파싱 + `||` 분할 (3-1 전체)
- `ensureDialogueInVP` 를 세그 재구성 버전으로 확장 — 생성 길이·트림 안내 포함(§2-3)
- `serializeCutForRevision`/`buildV3ScriptText` SEG 왕복
- 대본 생성/수정(`generateScript`/`handleRevision`) 프롬프트에 SEG 규칙(생성단위만 쓸 것,
  자유 초 금지)
- LF_T01 → v11 재생성 (SEG 부여)

**2b. Field Gate 비교 UI** (`C:\yeori-genline\index.html`) — 이번에 새로 추가하는 부분
- `DU > 10`인 발화 컷을 열면, `computeSegmentPlans(DU)` 후보(트림 최소순)를 **나란히 카드로**
  보여준다 — 각 카드: 조합(`8+8+10` 등) · 트림 위치/양 · `splitDialogueBySeg` 로 나눈 대사
  세그별 미리보기.
- 후보 하나를 고르면 **"📝 대본에 반영"**(TTS 탭에 이미 있는 것과 같은 패턴) — 해당 컷의
  `SEG`/`DL`(또는 `NR`) 필드를 골라낸 조합으로 대본에 기록. 자동 실시간 반영이 아니라 명시적
  버튼 클릭으로 확정(사고 방지, 기존 패턴과 동일).
- 최초 진입 시 기본 선택값 = 트림 최소 1위 후보(`auto` 와 동일 로직).
- 순수 함수(`computeSegmentPlans`/`splitDialogueBySeg`)만 쓰고 AI 호출 없음 — "AI 소통 배제"
  원칙 준수(사람이 후보 중 고르는 것뿐, 매번 생성할 필요 없음).

### 3단계 — STS 파이프라인 배선 + TTS/조립 세그 분할

- **STS 배선 (§2-4)** — 파이프라인은 이미 있음(`scripts/test-sts.js` / `runStsPostProcess`).
  필요: `POST /api/genline/sts`(또는 `/api/mcp/run-sts`) 엔드포인트 + Field Gate 버튼 +
  pipeline-leader 가 G4 승인 후 자동 호출(또는 G4.5). `pip install demucs` 필요.
- `studio-run-g3` 세그별 생성 (3-2) — NR 컷용 나레이션
- `upload-cut-video?seg=` + G5 조립 concat (3-3, 3-4)
- `/api/cut-timing` 세그 검사

---

## 5. 부수 발견 (LF_T01 v10 — 코드젠 정리 대상)

- SC 설명이 renumber 이전 컷 번호 참조:
  CUT 4 "CUT 2 직후", CUT 10 "CUT 5 핵심 문장", CUT 12 "CUT 6에서" 등
- 하단 `[제작 체크리스트]` 가 구버전(전체 21컷 · A-01/B-01/CUT 1~12 네이밍)
- IP 에 `a very subtle natural skin texture on her right cheek` 잔존 (룰셋 v1.4.1 에서
  삭제된 문구 — CUT 2·3·7·11·12·16·20). 재생성 시 제거 대상.
