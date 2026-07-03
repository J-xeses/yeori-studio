# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-07-03 (채팅-12, G5 편집 자동화 전체 완성)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### G5 후속 — 실제 컷 영상으로 재검증
- cut_02/03.mp4 실제 생성 후 "미디어 없음" 없이 완전한 결과 확인 필요
- 현재는 cut_01.mp4만 존재, cut_02/03은 미생성 상태

### BGM/색보정/내보내기 자동화
- 현재 CapCut에서 사람이 직접 마무리하는 상태
- BGM: C:\yeori-studio\downloads\bgm\ (파일 준비 필요)
- 색보정: warm 필터 자동 적용 구현 필요
- 내보내기: capcut-web-automation.js 활용 또는 별도 구현

### 새 에피소드 CapCut 프로젝트 준비 절차 정립
- 현재 0624 프로젝트 하나로 검증 완료
- 새 에피소드마다 초기 클립 1개를 수동으로 넣는 절차 필요
- 자동화 방안 검토 필요

### 소스코드 경로 통일 — 집 PC
- 회사 PC: C:\yeori-studio\app\ 완료 (커밋 51d3eab)
- 집 PC: C:\Users\user\Desktop\yeori-studio\yeori-studio\ → C:\yeori-studio\app\ 이동 필요
- 집 PC에서 git pull 후 경로 이동 작업

---

## 📋 대기 중 (순서 기다리는 것)

### G2 Flow 자동화 실제 실행 테스트
- flow-automation.js 전면 업그레이드 완료, 실제 실행 테스트 필요
- 선행 조건: Flow 프로젝트 생성 + yeori-face/closeup 업로드 + project_url.txt 등록

### 켄번스 방향 선택 UI (편집 메타 탭)
- 현재 bottomToTop 고정 적용 중
- 컷별 켄번스 방향 선택 드롭다운 추가 필요
- 선택값 → yeori_edit_meta.json fx 필드 → capcut_spec.json 반영

### G3~G6 실제 연결 테스트
- G3 TTS: 구현 완료, 연결 테스트 필요
- G6 업로드: YouTube/인스타 API 미구현

### 롱폼 신규 기획 4종
- LF-001 "회의 끝나고 기억 안 나는 이유": G1 업로드 대기
- LF-002~004: 개요만 확정

---

## ✅ 완료된 것

| 항목 | 커밋/비고 |
|------|------|
| G5 전체 자동화 완성 (ON버튼 → 켄번스 → G5배지) | 커밋 5a219b1 |
| G5 배지 cutNo 키 불일치 수정 (cut_01 → cut_1) | 커밋 5a219b1 |
| run-cutter.js 켄번스 키프레임 draft_content.json 반영 | 커밋 de0ccc1 |
| ON 버튼 7단계 완성 (메타→저장→SRT→합치기→스펙→커터→CapCut) | 확인 완료 |
| CapCut 데스크톱 켄번스 효과 실제 동작 확인 | 육안 검증 완료 |
| G5 완료: 3/3 배지 + 결과 카드 표시 | 확인 완료 |
| 소스코드 경로 통일 C:\yeori-studio\app\ (회사 PC) | 커밋 51d3eab |
| proxy.js 구버전 삭제 + app\server\proxy.js 통일 | 커밋 ac07332 |
| start_yeori.bat 경로 C:\yeori-studio\app\ 기준 수정 | 커밋 e049310 |
| capcut-web-automation.js 기본 흐름 완성 (ep2_final.mp4 10.6MB) | 커밋 f93bb00 |
| CapCut 웹버전 새 프로젝트 자동 생성 + 에디터 열림 | 커밋 61464f6 |
| Claude API 모델명 수정 (claude-sonnet-4-6) | 커밋 8eb87fd |
| ON 버튼 → generate() 자동 실행 | 커밋 9cd480d |
| capcut-cli 설치 (v0.11.3) + compile 테스트 성공 | 커밋 4bf8584 |
| generate-capcut-spec.js 생성 | 커밋 9a2211c |
| sync-content.bat 양방향 동기화 (회사↔집) | 커밋 c0f4e3b |
| flow-automation.js 전면 업그레이드 | 커밋 ed02734 |
| yeori_ruleset_v1.1 완성 | 커밋 b4a8631 |
| 서여리 베이스 프롬프트 v1.0 확정 | - |
| ElevenLabs 서여리 전용 목소리 | 코드: RmYuvmCbqOMBJxDLW4k8 |
| FFmpeg 설치 (회사 PC) | C:\ffmpeg\bin\ffmpeg.exe |
| 이미지 동적 효과 5가지 분석 + 씬 타입별 매핑표 | 문서화 완료 |
| 동작표현 표준프롬프트 v1 (6카테고리 24개 코드) | 완성 |
| LF-001 ep_script.txt | G1 입력용 완성 |
| episode_style_guide_v2.json | 수동 보완 완료 |

---

## 🗺️ 자동화 전체 현황 (~85%)

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
- run-cutter.js 켄번스 키프레임 적용: ✅ 완료
- CapCut 데스크톱 자동 실행 + 반영: ✅ 완료
- G5 배지 + 결과 카드: ✅ 완료
- BGM/색보정 자동화: ⬜ 미구현
- 내보내기 자동화: 🟡 capcut-web-automation.js 부분 완료

### Step 7 — G6 업로드
- YouTube API: ⬜ 미구현
- 인스타 IG4: ⬜ 미구현

---

## 🚨 다음 세션 즉시 할 것 (우선순위 순)

1. cut_02/03.mp4 생성 후 G5 전체 재검증
2. BGM 파일 준비 (무료 음원 3종) + 자동 삽입 구현
3. 집 PC 경로 C:\yeori-studio\app\ 통일
4. 켄번스 방향 선택 UI 추가 (편집 메타 탭 드롭다운)

---

## ⚠️ 알아야 할 핵심 메모

### A Creative Studio 실행 방법
- 항상 C:\yeori-studio\app\start_yeori.bat 으로 실행
- 소스코드 경로 (회사/집 공통 목표): C:\yeori-studio\app\
- 파일 경로 (공통): C:\yeori-studio\downloads\

### G5 ON 버튼 7단계 흐름 (확정)
① generate() — AI 편집 주의사항
② save-edit-meta
③ generate-srt
④ concat-video → ep{N}_raw.mp4
⑤ generate-capcut-spec → capcut_spec.json
⑥ run-cutter.js — 켄번스 키프레임 → draft_content.json
⑦ CapCut 데스크톱 자동 실행 → 드래프트 반영

### CapCut 프로젝트 준비 (현재 수동)
- 새 에피소드마다 CapCut에서 초기 클립 1개 수동 배치 필요
- 프로젝트 경로: C:\Users\won56\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\
- capcut_project_path.txt에 경로 등록 필요

### capcut-web-automation.js (별도 활용)
- CapCut 웹버전 자동화 독립 스크립트
- ep{N}_raw.mp4 업로드 + 내보내기까지 자동
- BGM/자막/켄번스 추가 구현 필요

### Higgsfield 401 오류
- 별도 구독 필요 → 보류

### 캐릭터 일관성
- 신체비율: 1:8 head-to-body ratio, supermodel body proportions
- 헤어: long wavy dark brown hair NOT short, NOT straight
- 피부: soft natural skin texture
- Flow: 서여리/Seo Yeori 직접 사용 금지

### ElevenLabs 서여리 목소리
- 코드: RmYuvmCbqOMBJxDLW4k8

---

## 🛠️ 툴 & 계정 현황

| 도구 | 용도 | 상태 |
|------|------|------|
| Google Flow (Veo3/Imagen) | 메인 이미지·영상 생성 | 활성 |
| ElevenLabs (서여리 전용) | TTS 더빙 | 활성 |
| capcut-cli (v0.11.3) | CapCut spec 생성 | 설치 완료 |
| CapCut 데스크톱 | 켄번스·편집·내보내기 | 자동화 완성 |
| capcut-web-automation.js | 웹버전 내보내기 | 부분 완료 |
| FFmpeg | 영상 합치기 | 회사 PC 완료 |
| A Creative Studio | Vite+React 플랫폼 | Vercel + 로컬 병행 |

---

## 📁 프로젝트 파일 위치
- C:\yeori-studio\app\ — 소스코드 (git)
- C:\yeori-studio\downloads\video\ep{N}\ — 영상 파일
- C:\yeori-studio\downloads\audio\ep{N}\ — 음성 파일
- C:\yeori-studio\downloads\output\ep{N}\ — 합성 영상
- C:\yeori-studio\downloads\bgm\ — BGM 파일 (준비 필요)
- C:\yeori-studio\capcut_web_ep{N}_url.txt — CapCut 웹 URL 캐시

---

## 🔄 이 파일 업데이트 방법
세션 끝날 때 "STATUS 업데이트해줘" → 완료된 것 이동 + 새 작업 추가
