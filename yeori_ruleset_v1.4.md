# 서여리 연출 원칙 — 에이전트 판단 룰셋 v1.4.3

> 출처: 성준님 직접 정리 (AI 유튜브 채널 운영 시작하기 1\~7)
> 용도: 프롬프트 생성 후 자동 품질 체크 기준

\---

## ① 캐릭터 일관성 \[최우선 / 절대 원칙]

|항목|기준|위반 시|
|-|-|-|
|스타트 프레임|반드시 서여리 얼굴 있는 이미지 사용|즉시 재생성|
|헤어|long wavy hair / NOT short 이중 강조 필수|프롬프트 수정 후 재생성|
|피부|`clear healthy skin, smooth even complexion, soft natural finish` + `avoid: acne, blemishes, ...` 상시 포함. ⚠️ "skin texture on (right) cheek" 류 표현 **금지** — 모델이 여드름·잡티로 증폭 (2026-09-09 v1.4.1 실측)|해당 문구 제거 후 재생성|
|시그니처 디테일|`delicate gold necklace` 필수|프롬프트 추가|
|의상|색상·소재·스타일 구체적으로 명시 (⚠️ "DO NOT change clothing" 등 강한 명령형 사용 금지 — 정책위반 오인 유발, 2026-06-14 확정)|프롬프트 수정|
|소품|가방·신발·골드 목걸이·브레이슬렛 디테일 명시|프롬프트 추가|
|공간|같은 에피소드 내 배경 일치 필수|스타트 프레임 재활용|

```
✅ 통과 체크리스트:
□ 스타트 프레임 = 서여리 얼굴 이미지
□ 헤어 길이 이중 강조 포함
□ 피부: 깨끗·균일한 톤 · 여드름/잡티/붉은기 없음 · avoid: 줄 포함
□ 의상 색상·소재·스타일 구체적 명시 (명령형 문구 없이)
□ 배경 일관성 확인
```

\---

## ② 영상 생성 (Veo3/Flow) 원칙

|항목|기준|
|-|-|
|대사 처리|**⚠️ 2026-09-10 변경 — §⑬-2 참조.** (구) "프롬프트에 대사 금지 + 무음 반환"은 Flow 퍼펫티어 시절 규칙(2026-09-02 폐기). (신) YEORI 대사 컷은 Veo 가 **대사를 말하도록** 생성(립싱크·음성 함께) → 음성 추출 → 서여리 음성 변환. 나레이션(NR) 컷은 여전히 인물 무발화 + ElevenLabs 직접.|
|시간 명시|"First 3s / Next 3s / Final 4s" 형식으로 행동 순서 명시|
|전신샷|불안정 → B-roll + 클로즈업 조합으로 대체|
|배경 인물|배경 인물 자체는 허용 / 단 서여리 행동·연출에 개입 금지 → "background people must not interact with or interfere with the main character" 필수|
|얼굴 클로즈업|일관성 가장 높음 → 적극 활용|

```
✅ 통과 체크리스트:
□ 대사 컷: VP 에 대사 텍스트 + "Veo 가 말하도록" 지시 (§⑬-2)
□ 나레이션 컷: 인물 무발화 확인
□ 행동이 시간 단위로 분리됨
□ 배경 인물이 서여리 연출에 개입하지 않도록 분리 문구 포함
□ 전신샷은 B-roll로 대체 계획 있음
```

\---

## ③ K감성 / 리얼리티 기준

|항목|기준|NG 예시|
|-|-|-|
|모델 핏|"effortlessly photogenic, not posing, just existing beautifully"|증명사진 느낌|
|볼캡|"worn loosely, slightly oversized, sitting higher on head"|딱 맞는 모자|
|롤업 진|부츠컷 롤업|스키니 롤업 = 반바지처럼 보임|
|음식|풍성해야 사진 찍고 싶은 의욕 생김|빈약한 모듬전|
|POV 컷|서버 얼굴 선명하면 몰입감 깨짐 → 손만 등장|서버 얼굴 선명|
|디테일 오류|반찬 중복 / 젓가락 2세트 / 가방 변신 즉시 지적|즉시 재생성|

```
✅ 통과 체크리스트:
□ "밖에서 본 기억이 없는 스타일"이 아닌가?
□ K감성 디테일 (볼캡 여유감 / 부츠컷 등) 반영됨
□ 디테일 오류 (소품 중복·변형) 없음
□ POV 컷은 손만 등장
```

\---

## ④ 스토리텔링 원칙

|항목|기준|
|-|-|
|구조|사건 → 감정변화 → 선택 (3막 구조 필수)|
|서여리 포지션|감성 큐레이터 — 다양한 소재를 서여리 시선으로 필터링해서 감정으로 연결|
|K문화|한국 트렌드 요소 자연스럽게 녹이기 / 한국인은 당연하지만 설명 못하는 것들|
|상징 연결|시각적 요소가 반드시 대사/스토리와 연결 (하이힐=페르소나 / 맨발=진짜 서여리)|
|엔딩|대사 끝나고 바로 끝나는 것 NG / 여운 2\~3초 필수 (컵 바라보기 / 침묵 등)|
|BGM|감정 전환점에서 BGM 완전 중단 → 현장감 극대화|

```
✅ 통과 체크리스트:
□ 3막 구조 (사건→감정→선택) 있음
□ 시각 요소가 스토리와 연결됨
□ 엔딩에 여운 2\~3초 있음
□ BGM 대비 연출 계획 있음
```

\---

## ⑤ 연출 감각 기준

|항목|기준|
|-|-|
|디테일|찜질방 달걀 껍질 / 하이힐 상징 등 "찐이다" 느끼는 현실적 디테일 최우선|
|보는 입장|"사소한 부분이라도 보는 입장을 최대한 존중"|
|감정 흐름|단순 이미지보다 감정 흐름 있는 컷 선호|
|긴 나레이션|한 컷 내 나레이션 길면 분할 (05A/B/C)|
|친구 등장|팔만 나오는 연출 → 일관성 문제 해결|
|B-roll|완벽하지 않아도 빠른 컷이면 OK|
|효율성|완벽한 한 컷보다 빠른 확정 후 다음 단계|

```
✅ 통과 체크리스트:
□ 현실적 디테일 1개 이상 포함됨
□ 감정 흐름 있는 컷 구성
□ 긴 나레이션 컷은 분할 계획 있음
□ 친구 등장 컷은 팔만 등장
```

\---

## ⑥ 이미지/영상 프롬프트 생성 원칙

### 공식: \[서여리 베이스] + \[의상] + \[장소/상황] + \[감정]

### 서여리 고정 베이스:

```
Young Korean woman early-20s,
long wavy dark brown hair, NOT short hair,
clear healthy skin, smooth even complexion with a soft natural finish,
delicate gold necklace,
effortlessly photogenic not posing just existing beautifully,
K-model proportions small face long legs,
appearing no older than 22-23,
avoid: acne, pimples, blemishes, skin blotches, rough or bumpy skin, uneven skin tone, redness, oily shine
```

⚠️ **2026-09-09 확정 (v1.4.1)**: 이전 베이스의 `❗a very subtle natural skin texture on her right cheek (subtle, never exaggerated)` 삭제. 같은 이유로 `downloads/seoyeori/characters/characters.json` 여리 descriptor 의 `rosy cheeks and a few small facial moles` 도 `clear even skin with a single small beauty mark near the right cheekbone; avoid acne blemishes redness rough skin` 로 교체(다인물 장면 `injectCharacterDescriptors` 가 주입하는 실제 데이터라 여기도 고쳐야 함). Flow·힉스필드·Krea 등이 이 문구를 **여드름·잡티·붉은기로 증폭**해 서여리 우뺨 피부를 심하게 망침(2026-09-09 실측 이미지). 원인: ① `skin texture on cheek` = 뺨에 뭔가 올리라는 지시로 읽힘 ② `(subtle, never exaggerated)` 괄호 부정 수식어는 대부분 무시됨 ③ `❗` 가 오히려 증폭. "AI 플라스틱 방지"는 `soft natural finish` + `avoid:` 목록으로 대체(긍정형 + 명시적 회피 목록이 훨씬 안정적).

⚠️ **2026-06-14 확정**: 위 베이스에 과거 포함되어 있던 "DO NOT change character appearance" 같은 강한 명령형 문구는 제거한다. 신체비율/외형 묘사 자체(K-model proportions 등)는 캐릭터 정체성의 핵심이므로 그대로 유지하되, "DO NOT", "absolutely mandatory", "strictly required" 같은 명령조 어휘가 누적되면 Flow 정책 모델이 "특정 실존 인물을 정밀 재현하려는 시도"로 오인해 정책위반 플래그가 발생한다(유명인 오인 플래그 회피 원칙). 명령형만 빼고 묘사는 유지하는 것이 핵심.

### 의상은 에피소드마다 자유:

→ 베이스에 의상만 추가하면 서여리가 입으면 다 예쁨
→ 룩01\~05 고정 관리 불필요
→ 새 의상도 자연스럽게 흡수

|항목|기준|
|-|-|
|Gemini|레퍼런스 이미지 업로드 시 원본 복사 → 오리지널 캐릭터는 텍스트 전용|
|레퍼런스|최대 2\~3장 유지 (최근 컷 + 캐릭터 보드)|
|Creativity|50\~60% (너무 낮으면 무표정)|
|한국어 텍스트|이미지 생성 불가 → CapCut 오버레이로 처리|

```
✅ 통과 체크리스트:
□ 서여리 베이스 포함됨
□ NOT short hair 이중강조 포함
□ 피부: 깨끗·균일한 톤 · 여드름/잡티/붉은기 없음 · avoid: 줄 포함
□ 명령형 어휘(DO NOT, absolutely, strictly 등) 미포함 확인
□ 의상 설명 구체적 (색상·소재·스타일)
□ 한국어 텍스트는 CapCut 후처리 계획
```

\---

### 즉시 재생성:

```
❌ 얼굴 없는 스타트 프레임
❌ 피부에 여드름·잡티·붉은기·거친 텍스처 (v1.4.1)
❌ 헤어가 숏컷으로 변형
❌ 의상 변경됨
❌ 배경이 에피소드 내 다른 컷과 불일치
❌ 소품 중복·변형 (젓가락 2세트 등)
❌ 배경 인물이 서여리 연출에 개입·간섭함
❌ 왜곡된 디테일 (고아원 간판 / 짐승 눈 등)
```

### OK 기준:

```
✅ 얼굴 일관성 유지됨
✅ 피부가 깨끗하고 균일 (잡티·여드름·붉은기 없음)
✅ 의상·소품 일치
✅ 감정 표현이 살아있음
✅ K감성 디테일 반영됨
✅ B-roll은 자연스러운 움직임이면 OK
```

\---

## ⑧ 에이전트 자동 체크 흐름

```
\[프롬프트 생성]
    ↓
\[룰셋 체크리스트 자동 검토]
    ↓
\[미달 항목 자동 수정]
    ↓
\[수정 후 재검토]
    ↓
\[전체 통과]
    ↓
\[성준님 최종 확인 (30초)]
    ↓
\[생성 실행]
    ↓
\[결과물 OK/재생성 판단]
```

\---

## ⑨ Google Flow 자동화 실행 규칙

### 성준님이 수동으로 해야 할 것 (자동화 불가):

```
1. Flow에서 새 프로젝트 생성 (이름: ep{N})
2. 레퍼런스 이미지 업로드:
   - yeori-face.jpg (전신 레퍼런스)
   - yeori-closeup.jpg (클로즈업 레퍼런스)
3. project_url.txt에 프로젝트 ID 입력 (1회)
   경로: C:\yeori-studio\downloads\flow\project_url.txt
```

### 자동화 시작 전 체크리스트 (미충족 시 즉시 중단):

```
□ project_url.txt 존재 확인
□ Flow 프로젝트 탭 정상 접속 확인
□ yeori-face 썸네일 hover 감지
□ yeori-closeup 썸네일 hover 감지
□ 미충족 시 에러: "레퍼런스 이미지를 Flow 프로젝트에 먼저 업로드하세요"
```

### 이미지 생성 설정 (flow-automation.js):

|항목|설정값|
|-|-|
|모드|이미지 탭 (동영상 모드 감지 시 자동 전환)|
|비율|9:16 (숏폼) / 16:9 (롱폼)|
|생성 개수|x2 (컷당 2장)|
|모델|Nano Banana 2|
|저장 파일명|cut_NN_a.jpg / cut_NN_b.jpg|

### 동영상 생성 설정 (video-automation.js):

|항목|설정값|
|-|-|
|모드|동영상 탭|
|비율|9:16 (숏폼) / 16:9 (롱폼)|
|길이|8초|
|모델|Omni Flash (Veo 3.1 Fast)|
|오디오|⚠️ 대사 컷은 §⑬-2 (Veo 가 대사 말하도록 → 음성 변환). 나레이션·무발화 컷만 무음 반환.|

\---

## ⑨-1 훅(Hook) 클립 시스템 [v1.2 신설]

### 목적: 시그니처 클로즈업 영상을 에피소드 영상 맨 앞에 자동으로 붙여 도입부 후킹 강화

### 에셋 구조:
```
downloads/hooks/
  hook_01.mp4          ← 원본 훅 영상 에셋
  hook_01_thumb.jpg    ← 썸네일
  hooks.json           ← 에셋 레지스트리 (등록된 모든 훅 목록)
```

### 에피소드 연결:
```
prompts.json
  "hookClip": "hook_01"   ← 이 에피소드에서 사용할 훅 ID 지정
```

### 실행 (edit-automation.js):
|명령어|동작|
|-|-|
|`npm run edit -- --ep=N`|prompts.json의 hookClip 기준으로 훅 자동 적용|
|`npm run edit -- --ep=N --no-hook`|훅 없이 CUT 영상만 출력|
|`npm run edit -- --ep=N --hook=hook_02`|prompts.json 설정과 무관하게 특정 훅 강제 지정|

### 동작 원리:
```
1. 훅 클립을 컷 해상도(예: 1376×768)로 자동 인코딩 (포맷 통일)
2. ep{N}_final.mp4 맨 앞에 자동 concat
3. 결과: [훅 클립] + [CUT 1~N] = 최종 영상
```

### 새 훅 영상 등록 절차:
```
1. 훅 영상 파일을 downloads/hooks/ 에 복사
2. hooks.json에 항목 추가 (id, 파일명, 썸네일 경로 등)
3. 사용할 에피소드의 prompts.json "hookClip" 값을 해당 ID로 설정
   (또는 실행 시 --hook= 옵션으로 직접 지정)
```

### 향후 활용 방향 (서브 라인 연계):
- 인상깊은 클로즈업 매력 표정(장소성 가미), 촬영 후 비하인드, 희귀 상황 연출 등을
  롱폼 에피소드 도입부 훅으로 매칭하는 데 사용 예정
- 채널 아이덴티티 문서(`yeori_channel_identity.md`)의 "2단계 세계관 연결" 전략과 연동될 수 있음
  (특정 훅 클립이 나중에 다른 숏폼과 연결고리로 작용하는 식)

\---

|단계|승인 조건|다음 단계|
|-|-|-|
|G1 대본생성 승인|대본 컷 확인|이미지 자동 생성 트리거|
|G2 이미지 승인|컷별 2장 중 1장 선택 후 승인|TTS 자동 이동|
|G3 TTS 승인|컷별 음성 확인 후 승인|영상 만들기 자동 이동|
|G4 영상 승인|원본 무음 영상 확인 + SRT 생성|편집 메타 자동 이동|
|G5 편집 승인|A Creative Cutter + 캡컷 완료 후 승인|업로드 자동 이동|
|G6 업로드 승인|YouTube/인스타 업로드 완료 확인|완료|

### 각 단계 공통 원칙:

```
□ 컷별 승인 버튼 (개별 확인)
□ 전체 승인 버튼 (모든 컷 완료 후 활성화)
□ 전체 승인 완료 → 다음 탭 자동 이동
□ 에이전트 리더 자동 패스 가능 (품질 기준 통과 시)
```

\---

## ⑪ 파일 경로 규칙 [v1.2 정정 — ROOT 판별 로직 반영]

### ⚠️ 중요 — `C:\yeori-studio\`는 미디어 저장 루트가 아님 (2026-06-21 정정)

과거 버전에는 `C:\yeori-studio\`가 회사 PC 미디어 루트로 기재되어 있었으나, 이는 **Chrome 프로필 전용으로 생성된 빈 폴더**이며 양쪽 PC 모두에 존재한다. 실제 작업 데이터(node_modules, package.json이 있는 진짜 프로젝트 루트)는 PC마다 다른 경로에 있다.

### ROOT 판별 기준 (proxy.js, flow-automation.js 공통):
```
fs.existsSync(p) &&
fs.existsSync(path.join(p, 'node_modules')) &&
fs.existsSync(path.join(p, 'package.json'))
```
위 조건을 만족하는 첫 번째 후보가 ROOT로 채택된다. **단순 폴더 존재 여부만으로 판단하지 않음.**

### ROOT 후보 (우선순위 순):
|순위|경로|용도|
|-|-|-|
|1|`C:\yeori-studio\`|Chrome 프로필 전용 빈 폴더 — node_modules 없어 항상 스킵됨|
|2|`C:\Users\user\Desktop\yeori-studio\yeori-studio\`|집 PC 실제 작업 경로|
|3|`C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio\`|회사 PC 실제 작업 경로|

### 파일 경로 (ROOT 기준 상대 경로):
```
이미지:      {ROOT}\downloads\flow\ep{N}\cut_NN_a.jpg / cut_NN_b.jpg
영상:        {ROOT}\downloads\video\ep{N}\cut_NN.mp4
음성:        {ROOT}\downloads\audio\ep{N}\cut_NN.mp3
훅 영상:     {ROOT}\downloads\hooks\hook_NN.mp4
레퍼런스:    {ROOT}\downloads\flow\character\
               - yeori-face.jpg
               - yeori-closeup.jpg
프로젝트 URL: {ROOT}\downloads\flow\ep{N}\project_url.txt
prompts.json: {ROOT}\downloads\flow\prompts.json
```

### 소스코드 경로:

|PC|경로|
|-|-|
|회사|C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio\|
|집|C:\Users\user\Desktop\yeori-studio\yeori-studio\|

### scripts/ 수정 시 필수 점검:
```
□ server/proxy.js와 scripts/flow-automation.js의 ROOT 판별 로직이 항상 동일한지 확인
  (둘 중 하나만 고치면 두 프로세스가 서로 다른 경로를 보게 되는 사고 발생 — 2026-06-21 실제 발생 사례)
□ 새 스크립트 추가 시에도 동일한 isValidProjectRoot() 패턴 적용
```

\---

## ⑫ Claude Code 작업 규칙

### 모든 작업 시작 전:

```
1. yeori_ruleset_v1.md 읽기
2. STATUS.md 읽기
```

### 작업 완료 후 반드시:

```
1. 수정한 파일 목록 출력
2. git diff --stat 출력
3. 미완료 항목 명시
4. git push origin master 후 커밋 해시 출력
```

### 한글 파일 규칙:

```
□ .bat 파일: 영문 전용 (인코딩 문제 방지)
□ 한글 내용 파일: Python utf-8 인코딩 사용
□ PowerShell Set-Content 한글 사용 금지
```

### scripts/ 수정 시:

```
소스코드 수정 후 C:\yeori-studio\scripts\ 에도 복사 필수
```

### 작업 완료 후 STATUS.md 자동 업데이트:

```
1. git log --oneline으로 오늘 완료된 커밋 확인
2. 완료된 항목 STATUS.md에 반영
3. 현재 진행 중 / 다음 할 것 업데이트
4. 마지막 업데이트 날짜 갱신
5. git push origin master
```

\---

## ⑬ 대본 포맷 코드화 규칙 [v1.3 신설]

### 컷 필드 코드 약자 체계

|약자|필드명|연동 코드군|
|-|-|-|
|SC|씬|-|
|SP|공간|C군|
|PL|파이프라인|B군|
|CH|캐릭터|D군|
|DL|대사|-|
|NR|나레이션|-|
|SH|샷타입|E군 SH_|
|CA|카메라|E군 CA_|
|MD|감정|E군 MD_|
|AC|동작|E군 AT_|
|DU|컷길이|8초 배수|
|KR|한글 컨펌본|-|
|IP|이미지 프롬프트|-|
|VP|영상 프롬프트|-|

### 샷타입 코드 표준화

기존 CLOSEUP/FULLBODY → E군 코드로 통일:

|코드|의미|
|-|-|
|SH_ECU|익스트림 클로즈업|
|SH_CU|클로즈업|
|SH_MCU|미디엄 클로즈업|
|SH_MS|미디엄샷|
|SH_MLS|미디엄롱샷|
|SH_FS|풀샷(전신)|
|SH_WS|와이드샷|

### 컷 길이 원칙

- 기본 단위: 8초
- 초과 시 자동 분할: C01 → C01-1 / C01-2 / C01-3
- CLIP_MAX_SEC=8 상수 기준

### 표준 컷 포맷

```
================================================================
마스터 코드
[에피소드코드] :: [B군] :: [C군] :: [D군] :: [E군] :: [F군]
================================================================

[C01]
SC: [한국어 씬 묘사]
SP: [C군 코드]
PL: [B군 코드]
CH: 서여리
DL: [대사 또는 없음]
NR: [나레이션 또는 없음]
SH: [E군 SH_ 코드]
CA: [E군 CA_ 코드]
MD: [E군 MD_ 코드]
AC: [E군 AT_ 코드]
DU: 8

━━━━━━━━━━━━━━━━━━━━━━━━
KR (한글 컨펌본)
━━━━━━━━━━━━━━━━━━━━━━━━
SP(장소):     [한국어 장소·시간·빛 묘사]
CH(캐릭터):   [한국어 의상·헤어 묘사]
SH(샷):       [한국어 샷타입 설명]
CA(카메라):   [한국어 카메라 무브 설명]
AC(동작):     [한국어 동작 설명]
MD(감정):     [한국어 감정·분위기]
DL(대사):     "[대사 또는 없음]"
NR(나레이션): [나레이션 또는 없음]
━━━━━━━━━━━━━━━━━━━━━━━━
IP (이미지 프롬프트)
━━━━━━━━━━━━━━━━━━━━━━━━
[영어 이미지 프롬프트]
━━━━━━━━━━━━━━━━━━━━━━━━
VP (영상 프롬프트)
━━━━━━━━━━━━━━━━━━━━━━━━
First 0-Xs: [동작 묘사]
Next X-Xs:  [동작 묘사]
Final X-Xs: [동작 묘사]
================================================================
```

### KR 컨펌본 목적

- 코드 → 한글 자동 변환으로 성준님 검토 용이
- 승인 후 영어 프롬프트(IP/VP)로 실제 생성
- 잘못된 해석 즉시 발견·수정 가능

### 체크리스트 추가

```
□ 마스터 코드 헤더 포함
□ 모든 컷에 PL(파이프라인) 코드 명시
□ SH_ 코드 표준 약자 사용 (FULLBODY/CLOSEUP 사용 금지)
□ DU 8초 배수 원칙 (초과 시 컷 분할)
□ KR 컨펌본 포함 (SP/CH/SH/CA/AC/MD/DL/NR 항목)
□ IP는 KR 승인 후 생성
□ SH_CU/SH_MCU 컷: 이미지 프롬프트 시작을 "CLOSEUP SHOT —" 으로 시작 (IP 작성 시)
□ SH_FS/SH_MLS 컷: 이미지 프롬프트 시작을 "FULLBODY SHOT —" 으로 시작 (IP 작성 시)
□ flow-automation.js는 SH_ 코드로 처리 방식 분기
```

### ⑬-1 메이킹 라인 컷 필드 [v1.4 신설 — 2026-09-09]

메인 필드 블록(SC/SP/PL... DU) 안에 함께 적는다. 파서: `server/lib/scriptParserV3.js`
+ `src/tabs/ScriptGenTab.jsx` (이중 파일, 반드시 동일 유지).

**CT — 컷 유형** (없으면 헤더/IP마커/PL 접두사로 추론)

|값|의미|제작 방식|
|-|-|-|
|`YEORI`|인물 연기 컷|이미지 생성(G2) → 영상(G4). 메이킹 탭 아님|
|`GRAPHIC`|HTML → 헤드리스 캡처 영상|`HTML:` 또는 `GTPL:` 필요|
|`CAPCUT`|텍스트·자막 카드|`HTML:`/`GTPL:` 있으면 자동, 없으면 데스크톱 녹화(수동)|
|`BROLL`|참고 영상 클립|`CLIP:`>`SRC:`>`URL:`>`BQ:` 중 하나|
|`PIP`|YEORI 위에 BROLL 합성|`pipTarget` 등 수동 지정|

우선순위: 컷 헤더(`[CUT N] — GRAPHIC | …`) > `CT:` > IP섹션 `GRAPHIC 타입` 마커 > PL 코드 접두사(BR_/GR_/CC_)

**소스 지정 필드** (해당 CT 에서만 의미)

|필드|CT|예시값|동작|
|-|-|-|-|
|`HTML:`|GRAPHIC·CAPCUT|`LF_T01_B05_graphic.html`|`01_script/` 의 목업 파일을 캡처. `.html` 아닌 값(`AE_제작대상_수동`)=수동 마커→스킵|
|`GTPL:`|GRAPHIC·CAPCUT|`ai` / `cards-3col/yeori` / `ai:relation/yeori`|HTML 자동 생성 후 `cut_NN_graphic.html` 저장→캡처. `HTML:` 파일 없을 때만|
|`CLIP:`|BROLL|`<url> @ 0:30 +10`|웹 영상 구간 화면녹화(screen-scenario). ⚠️ 공정이용 전제, 책임=대본 작성자|
|`SRC:`|BROLL(무관 가능)|`sources/B01_lesserafim.mp4`|로컬 파일 규격화(source-to-cut). `sources/`=`downloads/seoyeori/YU/sources/`. 없으면 CLIP 폴백|
|`URL:`|BROLL|`https://…/video-page`|페이지에서 미디어 URL 추출→헤드리스 캡처|
|`BQ:`|BROLL|`neon city night rain`|Pexels 검색어 직접 지정(AI 번역 안 함)|
|`MOTION:`|캡처·이미지 소스|`self` / `zoom-in` / `fade` / `type-in` / `rise` / `none`|`self`=HTML 자체 CSS @keyframes 프레임 캡처(canvas rAF 는 안 됨). GTPL 생성물 기본 `self`|

**GTPL 문법**: `<템플릿>/<스타일>` 결정형 · `ai` Claude 맞춤 · `ai:<템플릿>/<스타일>` 골격+AI.
템플릿: text-card, mv-intro, stat-card, info-source, fiction-disclaimer, cards-3col, relation.
브랜드 스타일 `yeori` (인트로/엔드카드 팔레트). 정의: `server/lib/graphicTemplates.js` + `graphicGen.js`.

**화면 비율**: 대본에 안 씀 — 에피소드 코드가 결정. `LF`·`SF` = 16:9(1920×1080), 그 외 9:16(1080×1920). `src/lib/videoPolicy.js` `cutDims()`.

**자동 실행 흐름**: `start_gen.bat` → `pipeline-leader`(상시) → g1 승인된 메이킹 컷 감지 →
`POST /api/mcp/run-making`(헤드리스 순차 제작) → 메이킹 탭 리뷰 패널 → **G4 승인은 사람**
(`shouldAutoApprove` 현재 무조건 false). 반려는 파라미터/HTML 수정 후 재실행.

**"생성 서브라인"**: 수동 자산 제작(HTML 목업·모션그래픽·소스 수급·G5 편집)을 모듈로
분리 — 대본 필드로 메인라인에 접속, 도구 성숙 시 흡수. 체크리스트 아티팩트:
https://claude.ai/code/artifact/47d3b3c1-b5ed-41d3-bb5f-3b27732fedeb

**체크리스트 추가**
```
□ 메이킹 컷(GRAPHIC/CAPCUT/BROLL)에 CT: 명시
□ GRAPHIC/CAPCUT: HTML: 파일(01_script/) 또는 GTPL: 지시 중 하나
□ BROLL: CLIP:/SRC:/URL:/BQ: 중 하나 (없으면 AI 추론 — 비권장)
□ CLIP: 은 공정이용 범위(리뷰·비평 인용, 최소 길이)
□ 모션 필요하면 MOTION: (GTPL 생성물은 self 자동)
□ 파서 수정 시 scriptParserV3.js ↔ ScriptGenTab.jsx 동시 반영
```

### ⑬-2 발화 컷 규칙 (VP 대사 명시 + 세그먼트) [v1.4.2 신설 — 2026-09-10]

전체 명세: `app/docs/vp-dialogue-seg-spec.md`. 근거: LF_T01 v10 검토 —
발화 컷 VP 가 "무엇을 말하는지"와 "8초씩 어떻게 쪼개지는지"를 담지 못함.

**규칙 (1단계 — 적용됨)**

- 모든 발화 컷(DL 또는 NR 보유)의 VP 하단에 `발화 (한국어)` 블록을 자동 삽입한다.
  - `유형: 대사 — 인물이 화면에서 이 대사를 말함 (립싱크)` (DL) /
    `유형: 나레이션 — 보이스오버, 인물은 입을 움직이지 않음 (립싱크 금지)` (NR)
  - `대사:` / `나레이션(VO):` 에 verbatim 텍스트
  - `DU > 8` 이면 `※ Ns — Veo 클립 N개 이어붙이기` 안내 자동 부기
  - DL: `생성: Veo 가 대사를 말하도록(립싱크·음성 함께)` + `후처리: 음성 추출 → 서여리 음성 변환`
- 구현: `app/src/lib/vpDialogue.js` `ensureDialogueInVP()` (멱등). server(`/api/episode-video-checklist`,
  `/api/mcp/video-checklist`) + client(`buildV3ScriptText`) 가 이걸 통과.
- **음성 처리 (사용자 확정 2026-09-10)** — DL 컷은 Veo 가 립싱크·음성을 함께 생성해야 입모양이 맞음.
  무음영상+별도TTS 덮기는 립싱크 안 맞음. → ① Veo 가 말하는 영상 생성(목소리 음색은 무관)
  → ② 음성 트랙 추출 → ③ speech-to-speech 로 서여리 음성 변환(타이밍·억양 유지, 음색만 교체)
  → ④ 재합성. `cut_NN.mp3` = 변환된 서여리 음성.
  NR 컷은 인물이 말 안 하므로 ElevenLabs 서여리 나레이션 직접.
  ⚠️ ③ 자동화 미구현 — 현재 `keepAudio=1` 로 Veo 음성 임시 유지 or 수동. 자동 파이프라인 = 3단계.

**규칙 (2단계 — 예정, SEG 필드)**

- `SEG_MAX_SEC = 8`. `DU > 8` YEORI 발화 컷은 `SEG:` 필드 필수.
  - `SEG: 9 / 9 / 7` (세그별 초, 합 ≈ DU) 또는 `SEG: auto`
- `DL` / `NR` 에 ` || ` 로 세그 경계 표시 (개수 = SEG−1, 문장·호흡 단위)
- VP 를 세그먼트별로 재구성: `SEG k/N · A–Bs` + `CONTINUE FROM SEG (k-1) FINAL FRAME` +
  세그별 `SPEAKS (KO): "…"` (Veo 가 그 부분을 말함)
- 파서 이중 파일에 `SEG` 파싱 추가. 세그별 Veo 영상 → 세그별 음성 변환 → 페어로 concat.

**체크리스트 추가**
```
□ 발화 컷: VP 에 발화(한국어) 블록 — 유형(대사/나레이션) + verbatim 텍스트
□ DL 컷: Veo 가 대사를 말하도록 생성(립싱크·음성 함께) → 음성 추출 → 서여리 음성 변환 → 재합성
□ NR 컷: 립싱크 금지 (인물 입 안 움직임) + ElevenLabs 서여리 나레이션 직접
□ DU > 8 YEORI 발화 컷: 클립 N개 이어붙이기 (2단계: SEG 필드 + DL || 마커)
```

\---

## 제작 철학 요약 (핵심 원칙)

```
👁️ 보는 입장 존중
🎭 상징과 스토리 연결
🎯 디테일이 신뢰를 만든다
😊 숨길 수 없는 예쁨
🇰🇷 K-문화 현실 고증
✨ 여운이 있는 엔딩
```

\---

> 버전: v1.4.3 / 2026-09-10
> 업데이트: 새로운 피드백 발생 시 즉시 추가

### 버전 이력
```
v1.0 (2026-05-24) — 최초 작성
v1.1 (2026-06-18) — 섹션 ⑨~⑫ 추가 (Flow 자동화 규칙, 파이프라인 승인, 경로, Claude Code 작업 규칙)
v1.2 (2026-06-21) — ① 의상/⑥ 베이스 프롬프트 명령형 어휘 제거(06-14 결정 반영),
                     ⑥-1 샷 타입 분류(CLOSEUP/FULLBODY) 신설,
                     ⑨-1 훅 클립 시스템 신설,
                     ⑪ 파일 경로 규칙을 실제 ROOT 판별 로직 기준으로 정정
v1.3 (2026-07-18) — ⑬ 대본 포맷 코드화 규칙 신설
                     (컷 필드 코드 약자 체계 / 샷타입 표준화 / KR 한글 컨펌본 / 컷 길이 원칙)
v1.3.1 (2026-07-18) — ⑥-1 삭제, ⑬에 흡수
v1.4 (2026-09-09) — ⑬-1 메이킹 라인 컷 필드 신설
                     (CT 유형 / HTML·GTPL·SRC·URL·BQ·CLIP·MOTION 소스 필드 /
                      GTPL HTML 자동 생성 / 화면 비율 / run-making 자동 흐름 / 생성 서브라인)
v1.4.1 (2026-09-09) — ① 피부 항목 전면 개정. 베이스의 "skin texture on right cheek
                     (subtle, never exaggerated)" 삭제 → 여드름·잡티 증폭 원인(실측).
                     "clear healthy skin, soft natural finish" + avoid: 목록으로 교체.
                     ①/⑥ 체크리스트·즉시재생성·OK기준 동반 수정.
v1.4.2 (2026-09-10) — ⑬-2 발화 컷 규칙 신설 (VP 대사 명시 + 세그먼트).
                     1단계: ensureDialogueInVP() — 발화 컷 VP 에 verbatim 대사/나레이션 블록
                     자동 삽입(멱등), DU>8 클립 분할 안내. 전체 명세 app/docs/vp-dialogue-seg-spec.md
v1.4.3 (2026-09-10) — ⑬-2 음성 처리 방침 정정 (사용자 확정). DL 컷 = Veo 가 대사를
                     말하도록 생성(립싱크·음성 함께) → 음성 추출 → 서여리 음성 변환
                     (speech-to-speech). 무음영상+TTS덮기(구안) 폐기. ② "대사 금지"·⑨
                     "무음 반환 고정" 은 Flow 퍼펫티어 시절 규칙 → ⑬-2 로 대체 명시.
                     ③ 음성 변환 자동화 미구현(현재 keepAudio=1 임시).
```
