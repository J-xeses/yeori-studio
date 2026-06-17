# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-06-18 (AI 자동화 생성도구 고도화-3 세션)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### 서여리 채널 소개 2컷 테스트 에피소드 전체 파이프라인 테스트
- **상태**: G1 승인 완료 → 스튜디오 탭 자동 이동 확인
- **즉시 수정 필요**: prompts.json 저장 경로 버그
  - 현재: 소스코드 경로에 저장됨 (`yeori-studio/downloads/flow/prompts.json`)
  - 정상: `C:\yeori-studio\downloads\flow\prompts.json`
  - 원인: proxy.js ROOT = __dirname의 상위 폴더 (소스코드 경로)
- **다음 단계**: G2 이미지 생성 → Flow 자동 실행 연결

### 스튜디오 탭 레이아웃 가로 전개
- **상태**: fix_studio_layout.py 작성 완료, 실행/확인 미완료
- **즉시**: python fix_studio_layout.py 실행 후 git push

---

## 📋 대기 중 (순서 기다리는 것)

### Claude Code ↔ 프로젝트 Claude 협업 규칙 문서화
- 역할 분담: 기획/설계 = 프로젝트 Claude, 코드실행/git = Claude Code
- 명세서 형식 통일 필요
- STATUS.md 자동 업데이트 규칙 필요

### G2~G6 자동화 연결
- G2 이미지: Flow 자동 실행 (prompts.json 경로 버그 수정 후)
- G3 TTS: ElevenLabs 자동 실행 (이미 구현됨)
- G4 영상: Google Flow video-automation.js 연결
- G5 캡컷: A Creative Cutter 연동 (SRT + 원본영상 → draft_content.json)
- G6 업로드: YouTube/인스타 API (미구현)

### ep5 FFmpeg 전체 합성 완성
- CUT 02~07 영상 생성 후 합성 (보류 중)

### 롱폼 13화 — "운동 3주 포기 이유"
- 18컷 마스터 스크립트 완성 상태

---

## ✅ 완료된 것

| 항목 | 커밋/비고 |
|------|------|
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

## 🗺️ 자동화 전체 현황 (~68%)

### Step 1 — 소재 발굴
- 트렌드 레이더: 🟡 부분 자동화
- Claude Code 트렌드 스코어링: ⬜ 미구현

### Step 2 — G1 대본 생성
- A Creative Studio 대본 생성 탭: ✅ 완료
- G1 승인 → 스튜디오 탭 자동 이동: ✅ 완료

### Step 3 — G2 이미지 생성
- 스튜디오 탭 다중 이미지 업로드: ✅ 완료
- Flow 자동 실행 연결: 🟡 진행중 (prompts.json 경로 버그 수정 필요)

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

1. **prompts.json 경로 버그 수정** — proxy.js ROOT 경로를 C:\yeori-studio로 수정
2. **스튜디오 레이아웃 가로 전개** — fix_studio_layout.py 실행 확인
3. **G2 Flow 자동 실행 연결** — 파이프라인 내보내기 → Flow 자동 이미지 생성
4. **Claude Code 협업 규칙 문서화** — CLAUDE_CODE_RULES.md 생성
5. **서여리 채널 소개 2컷 전체 파이프라인 완주**

---

## ⚠️ 알아야 할 핵심 메모

### A Creative Studio 실행 방법
- **항상 `start_yeori.bat` (프로젝트 폴더 안)으로 실행**
- 프록시 서버: `localhost:3001`
- 웹앱 접속: `http://localhost:5173`
- 소스코드 경로 (회사): `C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio`
- 파일 경로 (회사/집 공통): `C:\yeori-studio\downloads\`


### G1~G6 파이프라인 흐름 (확정)

G1  대본생성 승인 → 스튜디오 탭 자동 이동
G2  이미지 승인 (다중 이미지 중 선택)
G3  TTS 승인
G4  영상 승인 (Google Flow 원본 무음 영상)
    - [영상 만들기 탭] SRT 자막 파일 생성
    - [A Creative Cutter] draft_content.json + 원본영상 + SRT → 캡컷 자동 배치
G5  캡컷 편집 승인 (립싱크 포함)
G6  업로드 승인


### 편집 메타 탭 4탭 구조
- ① 메타 생성: 타임코드 자동 계산, FFmpeg 선택적 사용
- ② SRT 생성: 자막 파일 생성 → A Creative Cutter 입력용
- ③ 컷 분석: 영상 미리보기 + 타이밍 이슈 감지
- ④ 캡컷 가이드: 립싱크 필요 컷, 음성 타이밍 안내

### 캐릭터 일관성
- 전신샷: `1:8 head-to-body ratio, supermodel body proportions`
- 헤어: `hair is long, NOT short` 이중 강조
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
- `C:\yeori-studio\downloads\flow\character\` — 서여리 레퍼런스 이미지
- `yeori_elevenlabs_emotion_tags.html` — 롱폼 1화 TTS 대본

---

## 🔄 이 파일 업데이트 방법
세션 끝날 때 "STATUS 업데이트해줘" → 완료된 것 이동 + 새 작업 추가
Claude Code 세션에서는 작업 완료 시 자동 업데이트
