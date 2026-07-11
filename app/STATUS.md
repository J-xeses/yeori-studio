# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-07-11 (채팅-14, 동기화 완성 + 탭 UI 개선 + 도구 통합)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### 트렌드 레이더 → 스토리 아카이브 연동
- TREND_RADAR_v7.html의 📋 파이프라인 버튼 → 에피소드 후보 자동 생성
- content_matrix_v3.html에 자동 등록
- 여리 스튜디오 대본 생성 탭으로 전달
- 구현 방향: POST /api/trend-to-episode 엔드포인트 추가

### 프롬프트 코드 체계 (v0.1 초안 완성, 디벨롭 중)
- yeori_prompt_codebook_draft_v0.1.txt 검토 중
- 며칠 더 디벨롭 후 구현 예정
- 완성 시 G1~G5 전 단계 자동 연결 가능

### G1~G5 전체 파이프라인 연속 검증
- cut_02/03.mp4 생성 후 G5 재검증 필요
- G1부터 순서대로 연속 실행 테스트

### 스튜디오 탭 개선 보류 항목
- 추출 탭 / 대시보드 탭 용도 재검토 후 방향 결정
- 스튜디오 탭 체크리스트 → 팝업 대신 우측 빈 공간에 항상 표시

---

## 📋 대기 중

### BGM 파일 준비
- C:\yeori-studio\downloads\bgm\ (감성/정보/훅 3종)
- YouTube Audio Library 무료 음원 활용 예정

### G6 업로드 구현
- YouTube API 연동
- Instagram / TikTok 업로드

### OneDrive 집 PC 동기화 검증
- sync-content.bat 양방향 완성 (커밋 5824c60)
- 집 PC에서 실제 다운로드 테스트 필요

### content_matrix ElevenLabs API 키 연동
- 음성 에이전트 실행 불가 상태
- localStorage 크로스오리진 문제 해결 필요

---

## ✅ 완료된 것

| 항목 | 커밋/비고 |
|------|------|
| start_yeori.bat 5개 탭 자동 열기 | 커밋 0ea86e0 |
| content_matrix_v3.html + TREND_RADAR_v7.html app/ 통합 | 커밋 54f9a70 |
| sync-content.bat 양방향 동기화 완성 | 커밋 5824c60 |
| smart-sync-state.ps1 (savedAt 기반 스마트 싱크) | 커밋 e1a130f |
| 스튜디오 전체 탭 UI 개선 (사이드바 30vh, 이미지 비교 뷰 등) | 커밋 8ab4e81 등 |
| G2 체크리스트 + 승인 전 확인 팝업 | 커밋 8ab4e81 |
| TTS 탭 트랙별 Voice ID 지정 | 커밋 2c85150 |
| 내 음성 삽입 탭 다중 트랙 + 저장 버그 수정 | 커밋 3982b97 |
| 영상 탭 숏폼/롱폼 비율 자동 감지 | 커밋 fbbdfc2 |
| 스토리 아카이브 키워드 카드 auto-fit 6열 | 커밋 a57e335 |
| 퍼블리싱 탭 완성 (썸네일/제목/패키징/업로드) | 커밋 e08a022 |
| G포인트 동기화 (gpoints.json + /api/gpoints) | 커밋 e0af279 |
| content_matrix_v3 에이전트 리더 API 실제 연동 | 파일 저장 |
| content_matrix_v3 G1~G5 구조 재구성 | 파일 저장 |
| G5 전체 자동화 완성 (ON버튼→켄번스→G5배지) | 커밋 5a219b1 |
| CapCut 웹버전 자동화 (ep2_final.mp4 생성) | 커밋 f93bb00 |
| start_yeori.bat 자동 git pull 추가 | 커밋 b55f357 |
| studio-state.json PC간 동기화 | 커밋 5aab3e3 |
| 집 PC 경로 통일 C:\yeori-studio\ | 완료 |
| ElevenLabs 서여리 전용 목소리 | 코드: RmYuvmCbqOMBJxDLW4k8 |

---

## 🗺️ 자동화 전체 현황 (~88%)

### Step 0 — 트렌드 레이더
- TREND_RADAR_v7: ✅ app/ 통합 완료
- 스토리 아카이브 연동: 🟡 구현 예정

### Step 1 — 에피소드 기획
- content_matrix_v3: ✅ app/ 통합 + 에이전트 연동
- 프롬프트 코드 체계: 🟡 디벨롭 중

### Step 2 — G1 대본 생성
- A Creative Studio 대본 생성 탭: ✅ 완료

### Step 3 — G2 이미지 생성
- 스튜디오 탭 + Flow 자동화: ✅ 완료
- G2 체크리스트 승인: ✅ 완료

### Step 4 — G3 TTS
- ElevenLabs TTS 탭: ✅ 완료
- 트랙별 Voice ID 지정: ✅ 완료

### Step 5 — G4 영상 생성
- Google Flow 자동화: 🟡 부분 완료

### Step 6 — G5 편집
- ON 버튼 7단계 자동화: ✅ 완료
- CapCut 켄번스 효과: ✅ 완료
- BGM/색보정: ⬜ 미구현

### Step 7 — G6 퍼블리싱
- 퍼블리싱 탭 (썸네일/제목/패키징): ✅ 완료
- YouTube/인스타/TikTok 업로드: ⬜ 미구현

### 에이전트 리더 시스템
- content_matrix_v3 G1~G5 구조: ✅ 완료
- 에이전트 API 실제 연동: ✅ 완료
- G포인트 동기화: ✅ 완료
- 트렌드 레이더 연동: 🟡 구현 예정

---

## 🚨 다음 세션 즉시 할 것 (우선순위 순)

1. 트렌드 레이더 → 스토리 아카이브 연동 구현
2. G1~G5 전체 파이프라인 연속 검증
3. 프롬프트 코드 체계 v1.0 완성 후 구현
4. BGM 파일 준비 + 자동 삽입

---

## ⚠️ 알아야 할 핵심 메모

### A Creative Studio 실행 방법
- C:\yeori-studio\app\start_yeori.bat 실행
- 자동 열리는 탭: Flow / Cutter / Studio / content_matrix / TREND_RADAR
- 자동 git pull + sync-content.bat 포함

### 도구 위치 (통합 완료)
- C:\yeori-studio\app\content_matrix_v3.html
- C:\yeori-studio\app\TREND RADAR v7.html
- C:\yeori-studio\app\a_creative_cutter.html

### G5 ON 버튼 7단계 흐름
① generate() → ② save-edit-meta → ③ generate-srt
→ ④ concat-video → ⑤ generate-capcut-spec
→ ⑥ run-cutter.js (켄번스) → ⑦ CapCut 자동 실행

### 동기화 구조
- 소스코드: git push/pull 자동 (start_yeori.bat)
- 미디어: OneDrive sync-content.bat (양방향)
- 스마트 싱크: savedAt 기준 최신 파일 우선

### ElevenLabs 서여리 목소리
- 코드: RmYuvmCbqOMBJxDLW4k8

### CapCut 자동화
- 데스크톱: run-cutter.js + capcut-cli
- 웹버전: capcut-web-automation.js (별도 활용)
- 프로젝트: AppData\Local\CapCut\User Data\Projects\

### 프롬프트 코드 체계 (v0.1)
- CUT_01 / MOVE.BS→FS / ACT.A01 / MOOD.REL / CAM.PAN.L / 8s
- prompt_codebook.json 변환 → 전 단계 자동 연결
- 파일: yeori_prompt_codebook_draft_v0.1.txt
