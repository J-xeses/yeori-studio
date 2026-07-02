---
# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-06-30 (채팅-11, CapCut 웹버전 자동화 + ON 버튼 연결)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### G5 CapCut 웹버전 자동화 테스트
- 상태: 새 프로젝트 자동 생성 + 에디터 열림 확인 (커밋 61464f6)
- 다음 단계:
  1. node scripts/capcut-web-automation.js --ep=2 실행
  2. 영상 파일(ep2_raw.mp4) 자동 업로드 확인
  3. 켄번스 효과 자동 적용 확인
  4. 자막(SRT) 자동 삽입 확인
  5. BGM 자동 적용 확인
  6. 내보내기 자동 실행 확인

### 스튜디오 탭 + 영상 탭 이전 결과 복원 오류
- 상태: 파일은 존재하나 탭에 표시 안 됨
- video/ep2/cut_01.mp4 존재 확인
- AppContext.jsx 자동 스캔 로직 점검 필요

### 소스코드 경로 통일 (회사 PC에서 진행)
- 목표: C:\yeori-studio\app\ 로 양쪽 PC 동일 경로 통일
- 현재: 회사(OneDrive 경로) vs 집(Desktop 경로) 상이
- 회사 PC에서 다음 세션 시작 시 진행

---

## 📋 대기 중 (순서 기다리는 것)

### ON 버튼 최종 흐름 완성
- 현재 흐름:
  ① generate() — AI 편집 주의사항 자동 생성 완료
  ② save-edit-meta 완료
  ③ generate-srt
  ④ concat-video
  ⑤ generate-capcut-spec
  ⑥ capcut-web-automation.js 실행 (웹버전 새 프로젝트 생성 + 자동화)
- ⑤⑥ ON 버튼에 연결 필요

### 켄번스 방향 선택 UI
- 편집 메타 탭 컷카드에 드롭다운 추가
- 선택값 → yeori_edit_meta.json fx 필드 → capcut_spec.json 반영

### BGM 파일 준비
- C:\yeori-studio\downloads\bgm\ (감성/정보/훅 3종)
- YouTube Audio Library 무료 음원 활용

### G3~G6 실제 연결 테스트
- G3 TTS: 구현 완료, 연결 테스트 필요
- G4 영상: 부분 완료
- G5 캡컷: 웹버전 자동화 진행중
- G6 업로드: 미구현

### 롱폼 신규 기획 4종
- LF-001 "회의 끝나고 기억 안 나는 이유": G1 업로드 대기
- LF-002~004: 개요만 확정

---

## ✅ 완료된 것

| 항목 | 커밋/비고 |
|------|------|
| CapCut 웹버전 새 프로젝트 자동 생성 + 에디터 열림 | 커밋 61464f6 |
| capcut-web-automation.js 신규 생성 (웹버전 기반) | 커밋 c83213b |
| Claude API 모델명 수정 (claude-sonnet-4-6) | 커밋 8eb87fd |
| Claude API URL 절대경로 수정 (localhost:3001) | 커밋 0187d0a |
| ON 버튼 → generate() 자동 실행 | 커밋 9cd480d |
| capcut-cli 설치 (v0.11.3) | npm install -g |
| scripts/generate-capcut-spec.js 생성 | 커밋 9a2211c |
| /api/generate-capcut-spec + send-to-cutter 재설계 | 커밋 33a5589 |
| capcut compile 테스트 성공 (ep2, 8초) | 커밋 4bf8584 |
| sync-content.bat 집 PC 버전 + start_yeori.bat 연동 | 커밋 c0f4e3b, f9fa9a3 |
| DEFAULT_CUTTER_HTML 경로 수정 | 커밋 58d6df4 |
| ffprobe PATH 자동 탐색 | 커밋 b039db6 |
| 이미지 동적 효과 5가지 분석 + 씬 타입별 매핑표 | 문서화 완료 |
| CapCut 자동화 설계 확정 (웹버전 기반) | 설계 완료 |
| yeori_ruleset_v1.1 완성 | 커밋 b4a8631 |
| flow-automation.js 전면 업그레이드 | 커밋 ed02734 |
| cut_image SSE → StudioTab 컷카드 자동 표시 | 커밋 52c48ed |
| start_yeori.bat 원클릭 시스템 시작 | 커밋 91d8c57 |
| 서여리 베이스 프롬프트 v1.0 확정 | - |
| ElevenLabs 서여리 전용 목소리 | 코드: RmYuvmCbqOMBJxDLW4k8 |
| FFmpeg 설치 (회사 PC) | C:\ffmpeg\bin\ffmpeg.exe |
| ep5 CUT 01 영상+음성 합성 | C01_final.mp4 |
| 플로럴 드레스 프롬프트 검증 | 의상/배경/신체비율 모듈 확정 |
| 동작표현 표준프롬프트 v1 | 6카테고리 24개 코드 |
| LF-001 ep_script.txt | G1 입력용 완성 |

---

## 🗺️ 자동화 전체 현황 (~80%)

### Step 1 — 소재 발굴
- 트렌드 레이더: 🟡 부분 자동화
- Claude Code 트렌드 스코어링: ⬜ 미구현

### Step 2 — G1 대본 생성
- A Creative Studio 대본 생성 탭: ✅ 완료
- G1 승인 → 스튜디오 탭 자동 이동: ✅ 완료

### Step 3 — G2 이미지 생성
- 스튜디오 탭 다중 이미지 업로드: ✅ 완료
- Flow 자동 실행 (flow-automation.js): ✅ 완료
- 실제 실행 테스트: 🟡 대기

### Step 4 — G3 TTS
- ElevenLabs TTS 탭: ✅ 완료
- 음성 파일 자동 저장: ✅ 완료

### Step 5 — G4 영상 생성
- Google Flow 이미지 자동화: ✅ 완료
- Google Flow 영상 자동화: 🟡 부분 완료

### Step 6 — G5 편집
- 편집 메타 자동 생성 (Claude AI): ✅ 완료
- SRT 생성: ✅ 완료
- capcut-cli 기반 spec 생성: ✅ 완료
- CapCut 웹버전 새 프로젝트 자동 생성: ✅ 완료
- 영상 업로드 + 효과 적용 + 내보내기: 🟡 테스트 진행중
- ON 버튼 end-to-end: 🟡 ⑤⑥ 연결 필요
- 켄번스 방향 선택 UI: ⬜ 미구현
- BGM 파일 준비: ⬜ 미완료

### Step 7 — G6 업로드
- YouTube API: ⬜ 미구현
- 인스타 IG4: ⬜ 미구현

---

## 🚨 다음 세션 즉시 할 것 (우선순위 순)

1. capcut-web-automation.js 실행 테스트 — 영상 업로드 + 효과 + 내보내기
2. 스튜디오/영상 탭 이전 결과 복원 오류 수정
3. ON 버튼 ⑤⑥ 연결 완성
4. 소스코드 경로 통일 (회사 PC에서)

---

## ⚠️ 알아야 할 핵심 메모

### A Creative Studio 실행 방법
- 항상 start_yeori.bat으로 실행 (sync-content.bat 자동 실행 포함)
- 소스코드 경로 (회사): C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio
- 소스코드 경로 (집): C:\Users\user\Desktop\yeori-studio\yeori-studio
- 파일 경로 (공통): C:\yeori-studio\downloads\

### G5 CapCut 웹버전 자동화 흐름 (확정)
편집 메타 탭 ON 버튼
  → ① generate() AI 편집 주의사항
  → ② save-edit-meta
  → ③ generate-srt
  → ④ concat-video → ep{N}_raw.mp4
  → ⑤ generate-capcut-spec → capcut_spec.json
  → ⑥ capcut-web-automation.js
       capcut.com 새 프로젝트 생성
       ep{N}_raw.mp4 업로드
       켄번스 효과 적용
       자막(SRT) 삽입
       BGM 적용
       색보정 적용
       내보내기 자동 실행
  → ep{N}_final.mp4 저장

### CapCut 자동화 확정 내용
- 방식: 웹버전(capcut.com) Puppeteer 자동화
- 새 프로젝트 생성 방식 (데스크톱 동기화 불필요)
- 켄번스: TYPE B/C 이미지 컷에만 적용
- BGM: C:\yeori-studio\downloads\bgm\ (3종 준비 필요)
- 색보정: warm 필터 0.3 기본 적용
- Veo3 생성 시: no background music 프롬프트 추가
- 프로젝트 URL 캐시: C:\yeori-studio\capcut_web_ep{N}_url.txt

### Higgsfield 401 오류
- 별도 구독 필요 → 보류

### 캐릭터 일관성
- 신체비율: 1:8 head-to-body ratio, supermodel body proportions, model-like slim waist
- 헤어: long wavy dark brown hair NOT short, NOT straight, deep waves throughout
- 피부: soft natural skin texture (beauty mark 폐기)
- Flow: 서여리/Seo Yeori 직접 사용 금지 → 20대 초반 한국 여성으로 대체
- 폐기 표현: DO NOT change clothing / absolutely mandatory / strictly required 등

### 프롬프트 모듈 구조
베이스 모듈 → 의상 모듈 → 동작/각도 모듈(발굴 진행중) → 배경/조명 모듈
→ Flow Imagen → Veo3

### ElevenLabs 서여리 목소리
- 코드: RmYuvmCbqOMBJxDLW4k8

---

## 🛠️ 툴 & 계정 현황

| 도구 | 용도 | 상태 |
|------|------|------|
| Google Flow (Veo3/Imagen) | 메인 이미지·영상 생성 | 활성 |
| ElevenLabs (서여리 전용) | TTS 더빙 | 활성 |
| capcut-cli (v0.11.3) | CapCut spec 생성 | 설치 완료 |
| CapCut 웹버전 | 편집·켄번스·자막·내보내기 | Puppeteer 자동화 진행중 |
| FFmpeg | 영상 합치기 | 회사 PC 설치 완료 |
| A Creative Studio | Vite+React 플랫폼 | Vercel + 로컬 병행 |

---

## 📁 프로젝트 파일 위치
- C:\yeori-studio\downloads\video\ep{N}\ — 영상 파일
- C:\yeori-studio\downloads\audio\ep{N}\ — 음성 파일
- C:\yeori-studio\downloads\flow\ep{N}\ — 이미지 파일
- C:\yeori-studio\downloads\capcut_spec.json — CapCut compile 스펙
- C:\yeori-studio\downloads\bgm\ — BGM 파일 (준비 필요)
- C:\yeori-studio\capcut_web_ep{N}_url.txt — CapCut 웹 프로젝트 URL 캐시

---

## 🔄 이 파일 업데이트 방법
세션 끝날 때 "STATUS 업데이트해줘" → 완료된 것 이동 + 새 작업 추가
