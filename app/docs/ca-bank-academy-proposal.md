# CA_BANK → 캐릭터·의상 아카데미 — 설계 제안 (구현 전)

작성 2026-09-27 · 대상 `app/code_generator_v1.html` CA_BANK 탭 · 근거 `app/docs/codigen-review-2026-09-27.md` §7

## 1. 지금 상태 — 캐릭터 정보가 두 곳에 나뉘어 있음

| | `app/scripts/codebook.json` → `LOOK_BANK` | `downloads/seoyeori/characters/characters.json` |
|---|---|---|
| 쓰는 곳 | `script_generator.py`(IP 의상 문장), 코디젠 컷 설계 LOOK_ID·CA_BANK 탭 | 스튜디오 CH 필드 해석(`resolveCharacterToken`), Flow 참조 이미지·descriptor, TTS 목소리, 페르소나 |
| 단위 | 룩 1개 = `{label, ip_outfit, ep}` — **서여리 전용**(meta.character_id=yeori) | 캐릭터 1명 = 얼굴·클로즈업·descriptor·목소리·persona·`looks{}` |
| 겹치는 것 | `LOOK_NT`(홈 나이트 후드+묶은머리) | `yeori_nt.looks.LOOK_NT` — 같은 룩이 문구만 다르게 두 번 적힘 |
| 빠진 것 | 지아·지유 룩 없음, 시즌·파일 없음 | 서여리 본체 `looks` 없음, `ip_outfit` 문장 없음 |

둘 다 git 추적 파일이라 어느 쪽을 원본으로 해도 PC 간 동기화는 된다. 문제는 **같은 룩을 두 곳에서 따로 고친다**는 것 — 한쪽만 고치면 대본(IP 문장)과 생성(참조 이미지)이 어긋난다.

## 2. 합치는 방법 — 3가지 안

### A안. characters.json 이 원본, codebook.LOOK_BANK 는 자동 생성물 (권장)
- 룩을 `characters.json` 의 캐릭터 아래 `looks.{LOOK_ID}` 로 옮긴다. 룩 필드: `label`, `ip_outfit`(IP 영문 문장), `season`, `file`(착장 레퍼런스), `firstEp`, `status`(`draft|testing|approved|retired`).
- `codebook.json` 의 `LOOK_BANK` 는 스크립트(`scripts/sync-look-bank.js`, LLM 호출 없음 — 토큰 0 원칙)가 characters.json 에서 **다시 써 넣는다**. `script_generator.py` 는 지금처럼 codebook 만 읽으면 되니 파이썬 쪽 변경 0.
- 키 규칙: 서여리 룩은 기존 `LOOK_*` 그대로(대본·마스터 코드 호환), 조연은 `JY_LOOK01`, `HJ_LOOK01` 처럼 CH 접두사를 붙여 충돌 방지.
- 장점: 캐릭터 한 명의 모든 정보(얼굴·목소리·룩)가 한 파일, 기존 파서·대본 무수정. 단점: 동기 스크립트를 잊으면 codebook 이 뒤처짐 → selftest 에 "LOOK_BANK = characters.json 파생값과 같은가" 항목 추가로 막는다.

### B안. codebook.json 이 원본, characters.json 이 참조만
- LOOK_BANK 를 `{characterId: {LOOK_ID: …}}` 로 캐릭터별 분기(script_generator.py 주석에 이미 "분기 지점" 자리 있음). characters.json 의 `looks` 는 LOOK_ID 참조만 남김.
- 장점: 코드 체계(Codi_Gen 코드화 방향)와 한 파일. 단점: `script_generator.py` 수정 필요, 스튜디오 서버(`/api/characters`)·Flow 쪽이 룩을 보려면 codebook 까지 읽어야 함 — 캐릭터 정보가 여전히 두 파일에 걸침.

### C안. 새 `looks.json`(룩 전용) 을 원본으로, 두 파일 모두 파생
- 룩이 많아질 때(아카데미 시도 로그까지) 가장 깔끔하지만, 파일이 하나 더 생기고 동기 대상이 둘로 늘어남. 지금 규모(룩 ~12개)엔 과함.

**권장: A안.** 스튜디오·Flow·TTS 가 이미 characters.json 을 중심으로 돌고 있고(조연도 레지스트리에 룩·계절까지 기록한다는 기존 원칙과 일치), 파이썬 생성기를 건드리지 않아도 된다.

## 3. 아카데미 — "흘려보낸 무료 크레딧을 꼼꼼히 쓰는 장"

CA_BANK 탭을 "참고용 룩 목록"에서 **캐릭터별 개발 기록장**으로 바꾼다. 화면은 캐릭터(서여리·서여리 묶은머리·지아·지유) 탭 → 4개 구역.

1. **레퍼런스 시트** — 얼굴·클로즈업·전신(FS)·캐릭터 시트(A/B/C…) 확정본과 후보. 확정 = characters.json `face/closeup/looks.*.file` 로 승격(버튼 1개, 서버 `POST /api/characters` 재사용).
2. **의상 변형(룩)** — 룩 카드: `ip_outfit` 문장 · 레퍼런스 이미지 · 상태(draft→testing→approved) · 첫 사용 에피소드 · 사용 횟수(대본 CH/LOOK 집계).
3. **시즌 룩** — 봄/여름/가을/겨울 × 실내/실외 매트릭스, 비어 있는 칸이 곧 "이번 주 크레딧으로 만들 것" 목록.
4. **시도 로그(크레딧 장부)** — 도구별 시도 기록. 이게 "무료 크레딧 활용"의 핵심.

### 시도 로그 형식 (append-only JSONL 권장)
`downloads/seoyeori/characters/academy_log.jsonl` — 한 줄 = 한 시도.
```json
{"at":"2026-09-28T10:12:00+09:00","char":"jiyu","look":"JY_LOOK02","tool":"flow","account":"sub",
 "credits":12,"prompt":"…","refs":["jiyu-face.jpg"],"out":"academy/jiyu/2026-09-28_flow_01.jpg",
 "verdict":"keep|retry|reject","note":"앞머리 길이 OK, 톤 과함"}
```
- `tool` 은 스튜디오 `creditTracker`(main/sub × flow/qwen …)와 같은 이름을 써서 **남은 무료 크레딧 → 아카데미 과제**를 바로 연결: "sub 계정 Flow 38 남음 → 지유 가을 실외 룩 3회 시도 가능".
- 판정(`verdict`)과 한 줄 메모를 남겨 같은 실패를 반복하지 않게 하고, `keep` 이 모이면 레퍼런스 시트 후보로 올라간다.
- 집계(도구별 성공률·룩별 시도 수·주간 사용 크레딧)는 스크립트로 계산(토큰 0).

### 하루 흐름(예)
크레딧 탭에서 잔여 확인 → 아카데미 "비어 있는 시즌 칸" 중 하나 선택 → 프롬프트 자동 조립(descriptor + ip_outfit + 시즌/장소) → 도구에서 생성 → 결과 끌어다 놓기 + 판정 1클릭 → 로그 1줄. 쓰고 남은 크레딧이 매일 룩 자산으로 쌓인다.

## 4. 단계 제안

| 단계 | 내용 | 규모 |
|---|---|---|
| 1 | A안 스키마 확정(룩 필드·조연 키 규칙) + `sync-look-bank.js` + selftest 항목 | 작음 |
| 2 | CA_BANK 탭을 characters.json 기준으로 읽기(`GET /api/characters`) — 캐릭터 탭·룩 카드·시즌 매트릭스 | 중간 |
| 3 | 시도 로그 JSONL + 기록 API(`POST /api/academy-log`) + 크레딧 트래커 연결 | 중간 |
| 4 | 승격 버튼(시도 → 확정 레퍼런스), 사용 횟수 집계 | 작음 |

## 5. 성준님 결정이 필요한 것
1. 원본 파일: **A안(characters.json)** 으로 갈지.
2. 조연 룩 키 이름: `JY_LOOK01` 식 접두사 vs 캐릭터 안에서만 `look01`(현재 지유 방식).
3. 에피소드 기본 룩(코디젠 에피소드 탭 P3 의 `LK_CS/TOP_KNT/BTM_DNM/HR_/MK_/AC_`)은 codebook 에 없는 초안 코드 — 아카데미 룩으로 **대체**할지, 상·하의·헤어 조합 코드 체계로 **확장**할지.
4. 시도 로그 위치: `downloads/…/characters/`(미디어 옆, git 추적) vs `app/data/`(코드 쪽).
