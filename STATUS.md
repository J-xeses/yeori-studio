# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-06-18 (AI 자동화 생성도구 고도화-4 세션)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### G2 Flow 자동화 실제 실행 테스트
- **상태**: flow-automation.js 전면 업그레이드 완료 — 실제 실행 테스트 필요
- **선행 조건 (수동)**:
  1. Flow 프로젝트 생성 후 `project_url.txt` 등록
  2. yeori-face.jpg / yeori-closeup.jpg 프로젝트에 업로드
- **확인 포인트**:
  - preFlightCheck() 레퍼런스 썸네일 감지 정상 작동 여부
  - switchToImageMode() 팝업 → 이미지 탭 → 9:16 → x2 클릭 정상 여부
  - cut_NN_a.jpg / cut_NN_b.jpg 2장 저장 확인
  - cut_image SSE → StudioTab 컷카드 자동 표시 확인

### 서여리 채널 소개 2컷 전체 파이프라인 완주
- **상태**: G1 승인 완료 → G2 실행 대기
- **다음 단계**: 위 Flow 자동화 테스트 후 G3 TTS → G4 영상 순서로 진행

---

## 📋 대기 중 (순서 기다리는 것)

### G3~G6 실제 연결 테스트
- G3 TTS: ElevenLabs 탭 자동 실행 (구현 완료, 연결 테스트 필요)
- G4 영상: Google Flow video-automation.js (부분 완료)
- G5 캡컷: A Creative Cutter 연동 구현 (방향 확정, 미구현)
- G6 업로드: YouTube/인스타 API (미구현)

### ep5 FFmpeg 전체 합성 완성
- CUT 02~07 영상 생성 후 합성 (보류 중)

### 롱폼 13화 — "운동 3주 포기 이유"
- 18컷 마스터 스크립트 완성 상태

---

## ✅ 완료된 것

| 항목 | 커밋/비고 |
|------|------|
| yeori_ruleset_v1.1 완성 (섹션 ⑨~⑫ 추가) | 커밋 b4a8631 |
| flow-automation.js 이미지 2장 저장 (cut_NN_a/b.jpg) | 커밋 ed02734 |
| preFlightCheck() — 레퍼런스 썸네일 확인 후 미등록 시 즉시 중단 | 커밋 ed02734 |
| switchToImageMode() — 팝업→이미지탭→9:16→x2 자동 전환 | 커밋 ed02734 |
| flow-automation.js --ep 필터링 버그 수정 | 커밋 f5996ff |
| server/proxy.js ROOT 경로 C:\yeori-studio 통일 | 커밋 5d7a594 |
| flow-automation.js hang 수정 (project_url.txt 미등록 시 에러) | 커밋 8fd9447 |
| cut_image SSE 이벤트 → StudioTab 컷카드 자동 이미지 표시 | 커밋 52c48ed, 1c7cecc |
| start_yeori.bat 영문 전용 재작성 (인코딩 문제 영구 해결) | 커밋 72a0b18 |
| A Creative Cutter HTML (a_creative_cutter.html) git 추가 | 커밋 6ec364a |
| start_yeori.bat 원클릭 전체 시스템 시작 (Chrome+프록시+Vite+Edge) | 커밋 91d8c57 |
| G2~G5 파이프라인 승인 체계 완성 | 커밋 aa6928c |
| 프록시 상태 체크 URL /health로 수정 | 커밋 1cb200d |
| 편집 메타 탭 4탭 재설계 (SRT생성/컷분석/캡컷가이드/FFmpeg선택) | 커밋 6a3473f |
| 편집 메타 탭 전체너비 균등배치 + 컷분석 영상 미리보기 | 커밋 9e78066 |
| G1 승인 완료 시 스튜디오 탭 자동 이동 | 커밋 22d83a9 |
| 스튜디오 컷카드 다중 이미지 업로드 + 썸네일 선택 UI | 커밋 d3dee0d |
| G1~G6 파이프라인 흐름 재정의 확정 | 문서화 완료 |
| A Creative Cutter 연동 방향 확정 | 원본영상+SRT → CapCut 방식 |
| puppeteer-core 설치 완료 | npm install 완료 |
| 한식당(서라벌) 에피소드 | 9컷 전체 확정 |
| 신발 에피소드 1화 | 전 컷 생성 완료 |
| 핫플(성수동) 에피소드 Look02 | 완료 |
| 홈카페 에피소드 | 완료 |
| 찜질방 에피소드 | 완료 |
| 롱폼 1화 ElevenLabs 대본 | 감정 태그 6파일 완성 |
| BH 컷 카탈로그 | BH-13~BH-19, SIG-01, SIG-02 완료 |
| 서여리 베이스 프롬프트 v1.0 | 확정 |
| 서여리 전용 목소리 완성 | ElevenLabs 코드: RmYuvmCbqOMBJxDLW4k8 |
| FFmpeg 자동 실행 (로컬) | localhost:5173 정상 작동 |
| ep5 CUT 01 영상+음성 합성 | C01_final.mp4 생성 확인 |
| FFmpeg 설치 (회사 PC) | C:\ffmpeg\bin\ffmpeg.exe |

---

## 🗺️ 자동화 전체 현황 (~72%)

### Step 1 — 소재 발굴
- 트렌드 레이더: 🟡 부분 자동화
- Claude Code 트렌드 스코어링: ⬜ 미구현

### Step 2 — G1 대본 생성
- A Creative Studio 대본 생성 탭: ✅ 완료
- G1 승인 → 스튜디오 탭 자동 이동: ✅ 완료

### Step 3 — G2 이미지 생성
- 스튜디오 탭 다중 이미지 업로드: ✅ 완료
- Flow 자동 실행 (flow-automation.js): ✅ 완료
  - preFlightCheck (레퍼런스 확인): ✅ 완료
  - switchToImageMode (이미지탭/9:16/x2): ✅ 완료
  - cut_NN_a.jpg / cut_NN_b.jpg 2장 저장: ✅ 완료
  - cut_image SSE → 컷카드 자동 표시: ✅ 완료
- 실제 실행 테스트: 🟡 대기 (레퍼런스 이미지 업로드 후 실행 필요)

### Step 4 — G3 TTS
- ElevenLabs TTS 탭: ✅ 완료
- 음성 파일 자동 저장: ✅ 완료

### Step 5 — G4 영상 생성
- Google Flow 이미지 자동화: ✅ 완료
- Google Flow 영상 자동화: 🟡 부분 (ep5 cut_01만 성공)

### Step 6 — G5 편집
- 편집 메타 4탭 (타임코드/SRT/컷분석/캡컷가이드): ✅ 완료
- FFmpeg 자동 실행 (선택적): ✅ 완료
- A Creative Cutter 연동: 🟡 진행중 (방향 확정, 구현 예정)
- 캡컷 립싱크: ⬜ 수동

### Step 7 — G6 업로드
- YouTube API: ⬜ 미구현
- 인스타 IG4: ⬜ 미구현

---

## 🚨 다음 세션 즉시 할 것 (우선순위 순)

1. **G2 Flow 자동화 실제 테스트** — Flow 프로젝트에 yeori-face/closeup 업로드 후 전체 실행
2. **cut_image SSE 수신 확인** — 2장 생성 후 StudioTab 컷카드 자동 표시 검증
3. **G3~G5 파이프라인 연결 테스트** — 소개 2컷 에피소드로 전체 완주
4. **A Creative Cutter 연동 구현** — draft_content.json + SRT → 캡컷 자동 배치

---

## ⚠️ 알아야 할 핵심 메모

### A Creative Studio 실행 방법
- **항상 `start_yeori.bat` (프로젝트 폴더 안)으로 실행** — 원클릭 전체 시스템 시작
  - [1] Chrome 9222 포트 확인 → Flow 자동 열기
  - [2] a_creative_cutter.html 자동 열기
  - [3] npm run studio (프록시 3001 + Vite 5173)
  - [4] Edge → localhost:5173
- 소스코드 경로 (회사): `C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio`
- 파일 경로 (회사/집 공통): `C:\yeori-studio\downloads\`

### G1~G6 파이프라인 흐름 (확정)

```
G1  대본생성 승인 → 스튜디오 탭 자동 이동
G2  이미지 승인 (컷별 2장 생성 → 1장 선택)
G3  TTS 승인
G4  영상 승인 (Google Flow 원본 무음 영상)
    - [편집 메타 탭] SRT 자막 파일 생성
    - [A Creative Cutter] draft_content.json + 원본영상 + SRT → 캡컷 자동 배치
G5  캡컷 편집 승인 (립싱크 포함)
G6  업로드 승인
```

### Flow 자동화 실행 규칙
- 수동 선행 작업: Flow 프로젝트 생성 + yeori-face/closeup 업로드 + project_url.txt 등록
- 자동화 체크리스트: project_url.txt 존재 → Flow 탭 접속 → 레퍼런스 썸네일 감지
- 이미지 저장: `cut_NN_a.jpg` / `cut_NN_b.jpg` (컷당 2장)
- scripts/ 수정 시: `C:\yeori-studio\scripts\` 에도 복사 필수

### 편집 메타 탭 4탭 구조
- ① 메타 생성: 타임코드 자동 계산, FFmpeg 선택적 사용
- ② SRT 생성: 자막 파일 생성 → A Creative Cutter 입력용
- ③ 컷 분석: 영상 미리보기 + 타이밍 이슈 감지
- ④ 캡컷 가이드: 립싱크 필요 컷, 음성 타이밍 안내

### 캐릭터 일관성
- 전신샷: `1:8 head-to-body ratio, supermodel body proportions`
- 헤어: `hair is long, NOT short` 이중 강조
- 피부 텍스처: `a very subtle natural skin texture on her right cheek (subtle, never exaggerated)`
- Google Flow: "서여리" 직접 사용 금지 → "20대 초반 한국 여성"으로 대체

### 영상 생성
- 기본 영상 길이: 8초 (원본 유지, 트림 금지)
- 캡컷에서 음성/자막/립싱크 처리 (FFmpeg 합성 안 함)
- ElevenLabs 서여리 전용 목소리 코드: RmYuvmCbqOMBJxDLW4k8

---

## 🛠️ 툴 & 계정 현황

| 도구 | 용도 | 상태 |
|------|------|------|
| Google Flow (Veo3/Imagen) | 메인 이미지·영상 생성 | 활성 |
| ElevenLabs (서여리 전용) | TTS 더빙 | 활성 (코드: RmYuvmCbqOMBJxDLW4k8) |
| CapCut + A Creative Cutter | 편집·립싱크·자막 | 활성 |
| FFmpeg | 선택적 영상+음성 합성 | 회사 PC 설치 완료 |
| A Creative Studio | Vite+React 플랫폼 | Vercel + 로컬 병행 |

---

## 📁 프로젝트 파일 위치
- `C:\yeori-studio\downloads\video\ep5\output_final\C01_final.mp4` — ep5 CUT01 합성본
- `C:\yeori-studio\downloads\flow\character\` — 서여리 레퍼런스 이미지 (yeori-face.jpg, yeori-closeup.jpg)
- `C:\yeori-studio\downloads\flow\ep{N}\project_url.txt` — Flow 프로젝트 URL
- `yeori_elevenlabs_emotion_tags.html` — 롱폼 1화 TTS 대본
- `yeori_ruleset_v1.md` — 서여리 연출 원칙 룰셋 (git 루트)

---

## 🔄 이 파일 업데이트 방법
세션 끝날 때 "STATUS 업데이트해줘" → 완료된 것 이동 + 새 작업 추가
Claude Code 세션에서는 작업 완료 시 자동 업데이트 (yeori_ruleset_v1.md ⑫ 참조)
