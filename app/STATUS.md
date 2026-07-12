# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-07-12 (채팅-16, MCP 연동 + 트렌드 연동 + 컷타입 분류 + 워크플로우 확정)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 🎯 프로젝트 핵심 목표

시행착오를 줄이고 검증된 경로로 최소 과정 → 최대 성과
모든 판단 기준을 코드화 → 자동화 → 디지털 자산화 → 부가가치화

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### 매일 영상 재생성 시스템 구축
- 기존 에피소드 컷 중 품질 미달 컷 성준님이 직접 지정
- 재생성 큐 파일 생성 → 매일 자동 실행
- 1단계: 수동 지정 → 2단계: 패턴 수집 → 3단계: 재생성 매트릭스

### G1~G5 롱폼 파이프라인 연속 테스트
- LF_E01 18컷 실제 실행
- 컷 타입별 자동 스킵 검증 (GRAPHIC/CAPCUT)
- run_gN 플래그 정상 작동 확인

### TREND_RADAR_v7 최신본 업데이트
- 회사 PC CTEC OneDrive 최신 버전 → app/ 복사 후 git push
- 다음 회사 출근 시 진행

### BGM 생성/삽입 구현
- C:\yeori-studio\downloads\bgm\ 무료 음원 3종 준비
- G5 서브라인 BGM 자동 선택 연결

---

## 📋 코드화 로드맵 (진화 중)

### 완료된 코드화
| 판단 영역 | 코드 |
|------|------|
| 캐릭터 일관성 | yeori_ruleset_v1.3 |
| 씬별 제작 경로 | 컷 타입 YEORI/BROLL/PIP/GRAPHIC/CAPCUT |
| 콘텐츠 유형 | LF_E00/SF_E00/IG_R00/IG_P00/IG_S00/TK_E00 |
| 프롬프트 구조 | CUT_01/MOVE/ACT/CAM (v0.1 디벨롭 중) |
| 이미지 효과 | 켄번스/팝업카드/분할화면 씬 매핑표 |
| 편집 기준 | 편집 메타 AI 주의사항 자동 생성 |

### 앞으로 코드화할 것
| 판단 영역 | 코드화 방향 |
|------|------|
| 재생성 판단 | 재생성 매트릭스 (수집 중) |
| BGM 선택 | 씬 타입별 BGM 코드 |
| 업로드 타이밍 | 콘텐츠 캘린더 코드 |
| 트렌드 적합도 | 서여리 채널 피팅 스코어 |

---

## ✅ 완료된 것

| 항목 | 커밋/비고 |
|------|------|
| MCP yeori-studio 서버 구축 + 연결 | 커밋 a6f3af5 |
| 트렌드 레이더 → 에피소드 후보 생성 | 커밋 a23885f |
| 스토리 아카이브 → 대본 생성 탭 자동 연동 | 커밋 a7823a2 |
| 컷 타입 분류 시스템 (5종) + UI | 커밋 1e14307 |
| 컷 전체 목록 뷰 + 상세 편집 토글 | 커밋 6bc6584 |
| 콘텐츠 유형 코드 체계 확정 | LF/SF/IG_R/IG_P/IG_S/TK |
| 에피소드 사이드바 유형별 그룹 구분 | 커밋 434458a |
| content_matrix_v3 + TREND_RADAR app/ 통합 | 커밋 54f9a70 |
| start_yeori.bat 5개 탭 자동 열기 | 커밋 0ea86e0 |
| sync-content.bat 양방향 동기화 | 커밋 5824c60 |
| G5 전체 자동화 완성 | 커밋 5a219b1 |
| 퍼블리싱 탭 완성 | 커밋 e08a022 |
| G포인트 동기화 | 커밋 e0af279 |
| ElevenLabs 서여리 목소리 | 코드: RmYuvmCbqOMBJxDLW4k8 |

---

## 🗺️ 자동화 전체 현황 (~92%)

### Step 0 — 트렌드 레이더
- TREND_RADAR_v7 → 에피소드 후보 생성: ✅ 완료
- 스토리 아카이브 연동: ✅ 완료
- MCP 직접 호출: ✅ 완료

### Step 1 — 에피소드 기획
- 콘텐츠 유형 코드 체계: ✅ 완료
- 컷 타입 분류 시스템: ✅ 완료
- 프롬프트 코드 체계: 🟡 v0.1 디벨롭 중

### Step 2 — G1 대본 생성
- 대본 생성 탭 + 컷 타입 자동 배정: ✅ 완료
- 전체 목록 뷰: ✅ 완료

### Step 3 — G2 이미지 생성
- 스튜디오 탭 + G2 체크리스트: ✅ 완료
- Flow 자동화: ✅ 완료

### Step 4 — G3 TTS
- ElevenLabs TTS + 트랙 분기: ✅ 완료

### Step 5 — G4 영상 생성
- Flow Veo3 자동화: 🟡 부분 완료
- 매일 재생성 시스템: ⬜ 구현 예정

### Step 6 — G5 편집
- ON 버튼 7단계 자동화: ✅ 완료
- BGM 서브라인: ⬜ 미구현

### Step 7 — G6 퍼블리싱
- 퍼블리싱 탭: ✅ 완료
- 실제 업로드: ⬜ 미구현

### 에이전트 리더
- content_matrix_v3 + MCP 연동: ✅ 완료
- 자동 오케스트레이션: 🟡 설계 완료, 구현 예정

---

## 🚨 다음 세션 즉시 할 것

1. 재생성 대상 컷 직접 지정 → 재생성 큐 시스템 구현
2. G1~G5 롱폼 파이프라인 실제 테스트
3. BGM 파일 준비 + 자동 삽입
4. 회사 PC에서 TREND_RADAR 최신본 git push

---

## ⚠️ 알아야 할 핵심 메모

### A Creative Studio 실행
- C:\yeori-studio\app\start_yeori.bat
- 자동 열리는 탭: Flow / Cutter / Studio / content_matrix / TREND_RADAR
- 자동 git pull + sync-content.bat 포함

### MCP yeori-studio 도구 (8개)
- list_trend_episodes / create_trend_episode
- get_studio_state / list_episodes / export_pipeline
- run_flow_images / generate_srt / concat_video

### 콘텐츠 유형 코드
LF_E00 / SF_E00 / IG_R00 / IG_P00 / IG_S00 / TK_E00
확장 규칙: 언더바(_)로 연결

### 컷 타입 → G단계 분기
- YEORI: G2→G3(대사)→G4(립싱크)→G5
- BROLL: G2→G3(나레이션)→G4→G5
- PIP: G2→G3→G4→G5(PIP합성)
- GRAPHIC: G3→G5 (G2/G4 스킵)
- CAPCUT: G5만 (G2/G3/G4 전부 스킵)

### ElevenLabs 서여리 목소리
- 코드: RmYuvmCbqOMBJxDLW4k8

### 동기화 구조
- 소스코드: git (start_yeori.bat 자동 pull)
- 미디어: OneDrive sync-content.bat (양방향)
- 상태: studio-state.json / gpoints.json
