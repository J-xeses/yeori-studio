# 서여리 연출 원칙 — 에이전트 판단 룰셋 v1.1

> 출처: 성준님 직접 정리 (AI 유튜브 채널 운영 시작하기 1\~7)
> 용도: 프롬프트 생성 후 자동 품질 체크 기준

\---

## ① 캐릭터 일관성 \[최우선 / 절대 원칙]

|항목|기준|위반 시|
|-|-|-|
|스타트 프레임|반드시 서여리 얼굴 있는 이미지 사용|즉시 재생성|
|헤어|long wavy hair / NOT short 이중 강조 필수|프롬프트 수정 후 재생성|
|시그니처 디테일|❗"a very subtle natural skin texture on her right cheek (subtle, never exaggerated)" 클로즈업 컷마다 필수|프롬프트 추가|
|의상|DO NOT change clothing 문구 필수 / 색상·소재·스타일 명시|프롬프트 수정|
|소품|가방·신발·골드 목걸이·브레이슬렛 디테일 명시|프롬프트 추가|
|공간|같은 에피소드 내 배경 일치 필수|스타트 프레임 재활용|

```
✅ 통과 체크리스트:
□ 스타트 프레임 = 서여리 얼굴 이미지
□ 헤어 길이 이중 강조 포함
□ 자연스러운 피부 텍스처 (very subtle, never exaggerated) 클로즈업 컷에 포함
□ 의상 변경 방지 문구 포함
□ 배경 일관성 확인
```

\---

## ② 영상 생성 (Veo3/Flow) 원칙

|항목|기준|
|-|-|
|오디오 에러|Flow 설정 "무음 동영상 반환 → 사용" 고정 (프롬프트 문구보다 설정이 근본 해결)|
|대사 분리|프롬프트에 대사 텍스트 절대 금지 → 립싱크+행동 동시 발생 문제|
|시간 명시|"First 3s / Next 3s / Final 4s" 형식으로 행동 순서 명시|
|전신샷|불안정 → B-roll + 클로즈업 조합으로 대체|
|배경 인물|배경 인물 자체는 허용 / 단 서여리 행동·연출에 개입 금지 → "background people must not interact with or interfere with the main character" 필수|
|얼굴 클로즈업|일관성 가장 높음 → 적극 활용|

```
✅ 통과 체크리스트:
□ 프롬프트에 대사 없음
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
❗a very subtle natural skin texture on her right cheek (subtle, never exaggerated),
delicate gold necklace,
effortlessly photogenic not posing just existing beautifully,
K-model proportions small face long legs,
appearing no older than 22-23,
DO NOT change character appearance
```

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
□ 자연스러운 피부 텍스처 (very subtle, never exaggerated) 클로즈업 컷에 포함
□ DO NOT change character appearance 포함
□ 의상 설명 구체적 (색상·소재·스타일)
□ 한국어 텍스트는 CapCut 후처리 계획
```

\---

## ⑦ 재생성 판단 기준 (OK vs 재생성)

### 즉시 재생성:

```
❌ 얼굴 없는 스타트 프레임
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
✅ 자연스러운 피부 텍스처 보임
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
|오디오|무음 동영상 반환 → 사용 고정|

\---

## ⑩ G1~G6 파이프라인 승인 규칙

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

## ⑪ 파일 경로 규칙

### 미디어 파일 루트:

|PC|경로|
|-|-|
|회사 PC|C:\yeori-studio\|
|집 PC|C:\Users\user\Desktop\yeori-studio\yeori-studio\|

### 파일 경로:

```
이미지:      C:\yeori-studio\downloads\flow\ep{N}\cut_NN_a.jpg
영상:        C:\yeori-studio\downloads\video\ep{N}\cut_NN.mp4
음성:        C:\yeori-studio\downloads\audio\ep{N}\cut_NN.mp3
레퍼런스:    C:\yeori-studio\downloads\flow\character\
               - yeori-face.jpg
               - yeori-closeup.jpg
프로젝트 URL: C:\yeori-studio\downloads\flow\project_url.txt
prompts.json: C:\yeori-studio\downloads\flow\prompts.json
```

### 소스코드 경로:

|PC|경로|
|-|-|
|회사|C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio\|
|집|C:\Users\user\Desktop\yeori-studio\yeori-studio\|

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

> 버전: v1.1 / 2026-06-18
> 업데이트: 새로운 피드백 발생 시 즉시 추가
