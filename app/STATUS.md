# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-07-06 (채팅-13, 퍼블리싱 탭 + 에이전트 리더 시스템 완성)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### G포인트 동기화 검증
- 상태: 구현 완료 (커밋 e0af279), 실제 테스트 필요
- 방법:
  1. start_yeori.bat 실행
  2. 여리 스튜디오에서 아무 컷 G포인트 승인
  3. content_matrix 스튜디오 연동 탭 → "🔄 G포인트 동기화" 클릭
  4. 매트릭스 탭 G1~G5 배지 반영 확인

### content_matrix 개선 리스트 (우선순위 순)
- 즉시 수정:
  1. ElevenLabs API 키 연동 (음성 에이전트 실행 불가)
  2. 영상 에이전트 Flow 자동 실행 연결 (/api/run-video)
  3. 에이전트 실행 시 에피소드/컷 선택 UI 추가
- 중요:
  4. 진행 상태 "대기" → 실제 상태 반영
  5. 실행 로그 초기화 버튼 추가
  6. 사청자 반응 예측 AI 분석 연동
- 나중에:
  7. 트렌드 에이전트 실제 소재 발굴 연결
  8. G6 퍼블리싱 단계 매트릭스 추가
  9. 완료율 계산 기준 명확화

### OneDrive 미디어 동기화
- 집 PC C:\Users\user\OneDrive\yeori-studio-sync 폴더 없음
- 회사 PC OneDrive 업로드는 정상 작동 확인
- 집 PC에서 OneDrive 폴더 생성 + 동기화 테스트 필요

### G1~G5 전체 파이프라인 연속 검증
- cut_02/03.mp4 생성 후 G5 재검증
- G1부터 순서대로 연속 실행 테스트

---

## 📋 대기 중

### BGM 파일 준비
- C:\yeori-studio\downloads\bgm\ (감성/정보/훅 3종)
- YouTube Audio Library 무료 음원 활용 예정

### 롱폼 신규 기획 4종
- LF-001 "회의 끝나고 기억 안 나는 이유": G1 업로드 대기
- LF-002~004: 개요만 확정

### 집 PC 경로 완전 통일
- C:\yeori-studio\ git 루트 완료
- C:\yeori-studio\app\ 실행용 완료
- start_yeori.bat 자동 git pull 추가 완료

---

## ✅ 완료된 것

| 항목 | 커밋/비고 |
|------|------|
| G포인트 동기화 (gpoints.json + /api/gpoints) | 커밋 e0af279 |
| content_matrix_v3 에이전트 리더 API 실제 연동 | 파일 저장 완료 |
| content_matrix_v3 G1~G5 구조 재구성 | 파일 저장 완료 |
| 퍼블리싱 탭 완성 (썸네일/제목/패키징/업로드) | 커밋 e08a022 |
| 썸네일 9:16/16:9 비율 선택 | 커밋 f90e8f9 |
| 결과물 패키징 → downloads/final/ep{N}/ | 커밋 9d160ab |
| AI 제목/설명/태그 자동생성 (YouTube/인스타/TikTok) | 커밋 e08a022 |
| start_yeori.bat 자동 git pull 추가 | 커밋 b55f357 |
| studio-state.json PC간 동기화 | 커밋 5aab3e3 |
| 집 PC 경로 통일 C:\yeori-studio\ | 완료 |
| proxy.js CODE_ROOT 단일 경로 통일 | 커밋 d332329 |
| G5 전체 자동화 완성 (ON버튼→켄번스→G5배지) | 커밋 5a219b1 |
| CapCut 웹버전 자동화 (ep2_final.mp4 생성) | 커밋 f93bb00 |
| capcut-cli 설치 + compile 테스트 성공 | 커밋 4bf8584 |
| ElevenLabs TTS 탭 완성 | - |
| 서여리 베이스 프롬프트 v1.0 확정 | - |
| ElevenLabs 서여리 전용 목소리 | 코드: RmYuvmCbqOMBJxDLW4k8 |

---

## 🗺️ 자동화 전체 현황 (~88%)

### Step 1 — 소재 발굴
- 스토리 아카이브 탭: ✅ 완료
- 트렌드 에이전트 연동: 🟡 부분

### Step 2 — G1 대본 생성
- A Creative Studio 대본 생성 탭: ✅ 완료
- G1 승인 → 스튜디오 탭 자동 이동: ✅ 완료

### Step 3 — G2 이미지 생성
- 스튜디오 탭 + Flow 자동화: ✅ 완료
- 실제 실행 테스트: 🟡 대기

### Step 4 — G3 TTS
- ElevenLabs TTS 탭: ✅ 완료

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
- 영상/음성 에이전트 안정화: 🟡 진행중

---

## 🚨 다음 세션 즉시 할 것

1. G포인트 동기화 실제 검증
2. ElevenLabs API 키 content_matrix 연동
3. 영상 에이전트 /api/run-video 실제 연결
4. G1~G5 전체 파이프라인 연속 검증

---

## ⚠️ 알아야 할 핵심 메모

### A Creative Studio 실행
- C:\yeori-studio\app\start_yeori.bat (자동 git pull 포함)
- 소스코드: C:\yeori-studio\app\
- 미디어: C:\yeori-studio\downloads\

### G5 ON 버튼 7단계 흐름
① generate() → ② save-edit-meta → ③ generate-srt
→ ④ concat-video → ⑤ generate-capcut-spec
→ ⑥ run-cutter.js (켄번스) → ⑦ CapCut 자동 실행

### content_matrix_v3.html 위치
- C:\Users\won56\OneDrive - CTEC\...\03.A Creative...\content_matrix_v3.html
- 독립 HTML 도구 + localhost:3001 프록시 연동
- G포인트: 20초 폴링 또는 수동 동기화 버튼

### 에이전트 연동 엔드포인트
- GET/POST /api/gpoints → gpoints.json
- GET/POST /api/studio-state → studio-state.json
- POST /api/run-flow → 이미지 자동화
- POST /api/run-video → 영상 자동화
- POST /api/send-to-cutter → 편집 자동화
- POST /api/package-final → 퍼블리싱

### ElevenLabs 서여리 목소리
- 코드: RmYuvmCbqOMBJxDLW4k8

### CapCut 프로젝트
- 데스크톱: AppData\Local\CapCut\User Data\Projects\
- 웹버전 URL 캐시: C:\yeori-studio\capcut_web_ep{N}_url.txt

---

## 🔄 이 파일 업데이트 방법
세션 끝날 때 "STATUS 업데이트해줘" → 완료된 것 이동 + 새 작업 추가
