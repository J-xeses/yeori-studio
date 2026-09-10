# 발화 컷 명세 — VP 대사 명시 + 세그먼트 분할 (SEG)

> 대상: v3 대본 포맷 / G3 TTS / G4 영상(YEORI) / G5 편집
> 근거: LF_T01 v10 검토 (2026-09-10) — 발화 컷의 VP가 "무엇을 말하는지"와
> "8초씩 어떻게 쪼개지는지"를 담지 못함.
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

### 2-1. 컷 헤더 블록: `SEG` 필드 (신규)

메인 필드 블록(SC/SP/PL … DU) 안, `DU:` 다음 줄에 적는다.

```
DU: 25
SEG: 9 / 9 / 7
```

| 값 형태 | 의미 |
|-|-|
| `SEG: 9 / 9 / 7` | 3세그먼트, 각 초. 합 = DU (±1 허용, 코드젠이 검증) |
| `SEG: auto` | 코드젠이 DL 문장/호흡 단위로 ≤8초씩 자동 분할 |
| (필드 없음) | 1세그먼트 = 기존 동작. `DU ≤ 8`인 컷은 SEG 불필요 |

- 세그먼트 최대 길이 = **8초** (상수 `SEG_MAX_SEC = 8`, 룰셋 §⑬ CLIP_MAX_SEC 와 통일).
- `DU > 8`인 YEORI 발화 컷은 **SEG 필수** (없으면 코드젠 경고 + `auto` 처리).

### 2-2. `DL` / `NR` 분할 마커: ` || `

```
DL: "LE SSERAFIM은요, 데뷔 3년 차인데 || 이미 글로벌 팬덤을 완전히 장악한 그룹이잖아요. || 이번 콜라보에서 얘네 역할이 진짜 중요한 게…"
```

- `||` 개수 = `SEG` 개수 − 1. 코드젠이 검증 (불일치 시 오류).
- 분할 지점 = **문장·호흡 단위** (쉼표/마침표/접속어 앞). 단어 중간 금지.
- 다중 화자(`지아 "…" / 여리 "…"`)와 병존 가능:
  `DL: 지아 "야야! 이거 봤어?" || 여리 (표정으로만)` — 화자 슬래시 `/` 와 세그 `||` 는 축이 다름.
- `NR` 도 동일 규칙 (긴 나레이션 컷).

### 2-3. `발화 (한국어)` 블록 — VP 하단 자동 삽입

파서·빌더가 DL/NR 있는 컷의 VP 끝에 삽입한다(멱등: 마커 있으면 재삽입 안 함).

**단일 세그먼트 (SEG 없음 / DU ≤ 8):**
```
━━━ 발화 (한국어) ━━━
유형: 대사 — 립싱크 필요
텍스트: "…중독이에요."
```

**나레이션:**
```
━━━ 발화 (한국어) ━━━
유형: 나레이션 — 보이스오버, 립싱크 없음 (입 움직이지 않음)
텍스트: "근데 있잖아요… 좋은 거잖아요, 그냥."
```

**다중 세그먼트 (SEG 있음):** VP 를 세그먼트별로 재구성.
```
━━━ SEG 1 / 3 · 0–9s ━━━
[시작 프레임: G2 승인 이미지]
Medium closeup, calm analytical expression, one hand gesturing naturally.
LIP-SYNC (KO): "LE SSERAFIM은요, 데뷔 3년 차인데"
SILENT — lip movement only, no audio.

━━━ SEG 2 / 3 · 9–18s ━━━
CONTINUE FROM SEG 1 FINAL FRAME (동일 인물·의상·헤어·조명 유지).
Expression shifts with slight excitement, leaning forward.
LIP-SYNC (KO): "이미 글로벌 팬덤을 완전히 장악한 그룹이잖아요."
SILENT — lip movement only, no audio.

━━━ SEG 3 / 3 · 18–25s ━━━
CONTINUE FROM SEG 2 FINAL FRAME.
She pauses thoughtfully, glancing to the side then back to camera.
LIP-SYNC (KO): "이번 콜라보에서 얘네 역할이 진짜 중요한 게…"
SILENT — lip movement only, no audio.
```

세그먼트별 동작 비트는 기존 VP 의 `First / Next / Final` 문장을 세그 수에 맞춰 매핑.

### 2-4. 립싱크 오디오 소스 — ElevenLabs 우선

Veo 네이티브 발화는 서여리 고정 보이스가 아님 → 목소리 일관성 깨짐.

1. `studio-run-g3` 이 세그별 TTS 생성 (`cut_NN_s1.mp3` …)
2. Veo VP 에 `SILENT — lip movement only` 명시 → 무음 영상 클립 생성
3. G5 편집에서 세그 영상 N ↔ 세그 오디오 N 페어로 이어붙임 + 오디오 덮기

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
- `parseSegField(raw, duration)` → `[{ sec }]`
- `splitDialogueBySeg(text, segCount)` → `string[]` (`||` 기준, 없으면 균등/문장 분할)
- `ensureDialogueInVP({ videoPrompt, dialogue, narration, segments, cutType })` → 증강된 VP (멱등)

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
- `DU > 8` YEORI 발화 컷은 `SEG` 필수, `DL` 에 `||` 로 세그 경계
- `SEG_MAX_SEC = 8`, 세그 경계는 문장·호흡 단위
- 립싱크 오디오 = ElevenLabs (Veo 는 `SILENT` 무음 립싱크)
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

### 2단계 — SEG 필드 + `||` + 코드젠 VP 재구성

- 파서 이중 파일에 `SEG` 파싱 + `||` 분할 (3-1 전체)
- `ensureDialogueInVP` 를 세그 재구성 버전으로 확장
- `serializeCutForRevision`/`buildV3ScriptText` SEG 왕복
- 대본 생성/수정(`generateScript`/`handleRevision`) 프롬프트에 SEG 규칙
- LF_T01 → v11 재생성 (SEG 부여)

### 3단계 — TTS 세그 분할 + 조립 자동 concat

- `studio-run-g3` 세그별 생성 (3-2)
- `upload-cut-video?seg=` + G5 조립 concat (3-3, 3-4)
- `/api/cut-timing` 세그 검사

---

## 5. 부수 발견 (LF_T01 v10 — 코드젠 정리 대상)

- SC 설명이 renumber 이전 컷 번호 참조:
  CUT 4 "CUT 2 직후", CUT 10 "CUT 5 핵심 문장", CUT 12 "CUT 6에서" 등
- 하단 `[제작 체크리스트]` 가 구버전(전체 21컷 · A-01/B-01/CUT 1~12 네이밍)
- IP 에 `a very subtle natural skin texture on her right cheek` 잔존 (룰셋 v1.4.1 에서
  삭제된 문구 — CUT 2·3·7·11·12·16·20). 재생성 시 제거 대상.
