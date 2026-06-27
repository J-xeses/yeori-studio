---
# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-06-27 (채팅-10, G5 편집 자동화 + CapCut 자동화 설계)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### G5 편집 자동화 — ON 버튼 end-to-end 완성
- 상태: ①② 정상 작동 확인, ⑤⑥⑦ ON 버튼에 연결 필요
- ON 버튼 최종 흐름:
  ① generate() — AI 편집 주의사항 자동 생성 완료
  ② save-edit-meta 완료
  ③ generate-srt
  ④ concat-video
  ⑤ generate-capcut-spec (신규) ← 연결 필요
  ⑥ capcut compile (신규) ← 연결 필요
  ⑦ CapCut 자동 실행 (신규) ← 연결 필요
- 다음 단계: EditMetaTab.jsx runACC에 ⑤⑥⑦ 추가

### 편집 메타 탭 — 켄번스 방향 선택 UI 추가
- 상태: 방향 설계 완료, UI 구현 필요
- 내용: 컷별 켄번스 방향 선택 → yeori_edit_meta.json fx 필드 저장 → capcut_spec.json 반영
- 방향 목록: 확정 필요 (현재 Cutter 8가지 기준으로 조정)

### G2 Flow 자동화 실제 실행 테스트
- 상태: flow-automation.js 전면 업그레이드 완료, 실제 실행 테스트 필요
- 선행 조건 (수동):
  1. Flow 프로젝트 생성 후 project_url.txt 등록
  2. yeori-face.jpg / yeori-closeup.jpg 프로젝트에 업로드

### 프롬프트 서브라인 — 동작별 얼굴 고정 키포인트 발굴 (진행중)
- 상태: 1차 검증 세션 완료 (2026-06-25)
- 확정된 모듈: 의상 / 배경 / 신체비율
- 미확정: 동작/각도별 얼굴 고정 키포인트
- 관련 파일: 서여리_동작표현_표준프롬프트_v1.txt (6카테고리 24개 동작 코드)

---

## 📋 대기 중 (순서 기다리는 것)

### G3~G6 실제 연결 테스트
- G3 TTS: ElevenLabs 탭 자동 실행 (구현 완료, 연결 테스트 필요)
- G4 영상: Google Flow video-automation.js (부분 완료)
- G5 캡컷: capcut-cli 기반 자동화 (설계 완료, ON 버튼 연결 필요)
- G6 업로드: YouTube/인스타 API (미구현)

### BGM 파일 준비
- C:\yeori-studio\downloads\bgm\bgm_default.mp3 (감성/정보/훅 3종 세트)
- YouTube Audio Library 등 무료 음원 활용 예정

### 롱폼 신규 기획 4종 (2026-06-25 확정)
- 우선순위: LF-001(회의기억) → LF-003(투두리스트) → LF-005(호흡법) → LF-002(퇴근피로)
- LF-001 "회의 끝나고 기억 안 나는 이유": 파일 완성, G1 업로드 대기
- LF-002~004: 개요만 확정, 컷 분할 대기

### 의상 카탈로그 v1 / 캐릭터 보드 생성 매뉴얼
- 의상 카탈로그: 7카테고리 15종 초안 완료 (파일: 서여리_의상_프롬프트_카탈로그_v1.txt)
- 캐릭터 보드: 5샷 배치 구조 설계 완료, A1 프롬프트 세트 완료

### 롱폼 13화 — "운동 3주 포기 이유"
- 18컷 마스터 스크립트 완성 상태

---

## ✅ 완료된 것

| 항목 | 커밋/비고 |
|------|------|
| Claude API 모델명 수정 (claude-sonnet-4-6) | 커밋 8eb87fd |
| Claude API URL 절대경로 수정 (localhost:3001) | 커밋 0187d0a |
| ON 버튼 → generate() 자동 실행 | 커밋 9cd480d |
| capcut-cli 설치 (v0.11.3) | npm install -g |
| scripts/generate-capcut-spec.js 생성 | 커밋 9a2211c |
| /api/generate-capcut-spec 엔드포인트 추가 | 커밋 33a5589 |
| /api/send-to-cutter 전면 재설계 (capcut-cli 기반) | 커밋 33a5589 |
| capcut compile 테스트 성공 (ep2, 8초) | 커밋 4bf8584 |
| sync-content.bat 집 PC 버전 생성 | 커밋 c0f4e3b |
| start_yeori.bat → sync-content.bat 자동 실행 연동 | 커밋 f9fa9a3 |
| DEFAULT_CUTTER_HTML 경로 수정 | 커밋 58d6df4 |
| cutter_html_path.txt 생성 | 커밋 58d6df4 |
| ffprobe 경로 하드코딩 → PATH 자동 탐색 | 커밋 b039db6 |
| 이미지 동적 효과 5가지 분석 + 씬 타입별 매핑표 완성 | 문서화 완료 |
| CapCut 자동화 설계 확정 (BGM/색보정/켄번스/클립배치) | 설계 완료 |
| yeori_ruleset_v1.1 완성 (섹션 9~12 추가) | 커밋 b4a8631 |
| flow-automation.js 전면 업그레이드 | 커밋 ed02734 |
| cut_image SSE → StudioTab 컷카드 자동 표시 | 커밋 52c48ed |
| start_yeori.bat 원클릭 시스템 시작 | 커밋 91d8c57 |
| 서여리 베이스 프롬프트 v1.0 확정 | - |
| ElevenLabs 서여리 전용 목소리 완성 | 코드: RmYuvmCbqOMBJxDLW4k8 |
| FFmpeg 설치 (회사 PC) | C:\ffmpeg\bin\ffmpeg.exe |
| ep5 CUT 01 영상+음성 합성 | C01_final.mp4 생성 확인 |
| 플로럴 드레스 프롬프트 검증 | 의상/배경/신체비율 모듈 확정 |
| 동작표현 표준프롬프트 v1 | 6카테고리 24개 코드 완성 |
| episode_style_guide_v2.json | 수동 보완 + 정책원칙 통합 완료 |
| LF-001 ep_script.txt | G1 입력용, 9컷 + 신체비율/안전원칙 반영 완료 |
| Higgsfield Soul 트레이닝 | 유료 플랜 필요 확인 → 보류 |

---

## 🗺️ 자동화 전체 현황 (~78%)

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
- Google Flow 영상 자동화: 🟡 부분 (ep5 cut_01만 성공)

### Step 6 — G5 편집
- 편집 메타 자동 생성 (Claude AI): ✅ 완료
- SRT 생성: ✅ 완료
- capcut-cli 기반 draft 자동 생성: ✅ 설계+테스트 완료
- ON 버튼 end-to-end: 🟡 ⑤⑥⑦ 연결 필요
- 켄번스 방향 선택 UI: ⬜ 미구현
- BGM 파일 준비: ⬜ 미완료

### Step 7 — G6 업로드
- YouTube API: ⬜ 미구현
- 인스타 IG4: ⬜ 미구현

---

## 🚨 다음 세션 즉시 할 것 (우선순위 순)

1. ON 버튼 ⑤⑥⑦ 연결 — EditMetaTab.jsx runACC에 generate-capcut-spec + capcut compile + CapCut 실행 추가
2. end-to-end 테스트 — ON 버튼 → CapCut 자동 열림 확인
3. 켄번스 방향 선택 UI — 편집 메타 탭 컷카드에 드롭다운 추가
4. BGM 파일 준비 — 무료 음원 3종 다운로드

---

## ⚠️ 알아야 할 핵심 메모

### A Creative Studio 실행 방법
- 항상 start_yeori.bat으로 실행 (sync-content.bat 자동 실행 포함)
- 소스코드 경로 (회사): C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio
- 소스코드 경로 (집): C:\Users\user\Desktop\yeori-studio\yeori-studio
- 파일 경로 (공통): C:\yeori-studio\downloads\

### G5 CapCut 자동화 흐름 (확정)
yeori_edit_meta.json (fx 필드 포함)
  → generate-capcut-spec.js → capcut_spec.json
  → capcut compile → draft_content.json (CapCut 드래프트 폴더)
  → CapCut 자동 실행 → 드래프트 자동 반영
  → 사람: 켄번스 세부조정 + 내보내기

### CapCut 자동화 설계 확정
- 클립 배치: cut_NN.mp4 순서대로 자동
- 켄번스: TYPE B/C 이미지 컷에만 자동 적용
- 자막: ep{N}.srt 자동 삽입
- BGM: C:\yeori-studio\downloads\bgm\ (씬타입별 3종, 준비 필요)
- 색보정: warm 필터 0.3 기본 적용
- Veo3 생성 시: no background music 프롬프트 추가
- CapCut 닫힌 상태에서만 compile 실행 (자동 종료 후 재실행)

### Higgsfield 401 오류
- 별도 구독 필요 → 보류 (수동 episode_style_guide.json으로 우회 중)

### 캐릭터 일관성
- 신체비율: 1:8 head-to-body ratio, supermodel body proportions, model-like slim waist
- 헤어: long wavy dark brown hair NOT short, NOT straight, deep waves throughout
- 피부: soft natural skin texture (beauty mark 폐기)
- Flow: 서여리/Seo Yeori 직접 사용 금지 → 20대 초반 한국 여성으로 대체
- 폐기 표현: DO NOT change clothing / absolutely mandatory / strictly required 등 강한 명령형 전부

### 프롬프트 모듈 구조 (2026-06-25 확정)
[베이스 모듈] 캐릭터 기본정보 + 신체비율 + 헤어 + 액세서리
  → [의상 모듈] Look별 선택 (카탈로그 A~G)
  → [동작/각도 모듈] 6카테고리 24개 코드 + 얼굴고정 키포인트 (발굴 진행중)
  → [배경/조명 모듈] 씬별 선택
  → [이미지 생성] Flow Imagen → [영상 생성] Veo3

### ElevenLabs 서여리 목소리
- 코드: RmYuvmCbqOMBJxDLW4k8

---

## 🛠️ 툴 & 계정 현황

| 도구 | 용도 | 상태 |
|------|------|------|
| Google Flow (Veo3/Imagen) | 메인 이미지·영상 생성 | 활성 |
| ElevenLabs (서여리 전용) | TTS 더빙 | 활성 |
| capcut-cli (v0.11.3) | CapCut draft 자동 생성 | 설치 완료 |
| CapCut | 편집·켄번스·자막·내보내기 | 활성 |
| FFmpeg | 선택적 영상+음성 합성 | 회사 PC 설치 완료 |
| A Creative Studio | Vite+React 플랫폼 | Vercel + 로컬 병행 |

---

## 📁 프로젝트 파일 위치
- C:\yeori-studio\downloads\video\ep5\output_final\C01_final.mp4 — ep5 CUT01 합성본
- C:\yeori-studio\downloads\flow\character\ — 서여리 레퍼런스 이미지
- C:\yeori-studio\downloads\flow\ep{N}\project_url.txt — Flow 프로젝트 URL
- C:\yeori-studio\downloads\capcut_spec.json — CapCut compile 스펙 파일
- C:\yeori-studio\downloads\bgm\ — BGM 파일 폴더 (준비 필요)
- yeori_ruleset_v1.md — 서여리 연출 원칙 룰셋

---

## 🔄 이 파일 업데이트 방법
세션 끝날 때 "STATUS 업데이트해줘" → 완료된 것 이동 + 새 작업 추가
Claude Code 세션에서는 작업 완료 시 자동 업데이트