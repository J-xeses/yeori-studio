# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-08-10 (고도화-11 — 에이전트 리더 채팅 소통 기능 완성)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### 에이전트 리더 채팅 — 패턴 축적 단계
- **상태**: 채팅 기능 구현 완료(4f07f65), 실제 사용하며 패턴 발견 중
- **다음**: 자주 쓰는 지시 패턴이 모이면 시스템 프롬프트 고도화
- **미결**: G4 파이프라인 타임아웃 처리 (15분 경과 시 재시도/스킵 로직 별도 처리 예정)

### ScriptGenTab.jsx — pc.ac → pc.at 마이그레이션
- **상태**: 미완료 이월 항목. codebook v1.0.0에서 AC→AT로 통일됐으나 JSX 참조 미변경

### Notion 마스터 허브 + STATUS.md
- **상태**: 매 세션 반복 지적 사항. 이 파일로 대신하는 중
- **다음**: 세션 시작 시 반드시 이 파일 먼저 읽을 것

---

## 🎯 On the Horizon (예정 작업)

- **SF_E07 실데이터로 codebook v1.0.0 검증** — 미완료 이월
- **VideoTab.jsx AI 영상 자동생성 UI 연결** — `/api/run-video` 엔드포인트는 완성, 호출 버튼 없음
- **G4 타임아웃 처리** — pipeline-leader.js 15분 경과 시 재시도/스킵 로직
- **서여리 의상 프롬프트 카탈로그 고도화** — 15룩, 7카테고리(A~G), 계절별 태그 분류
- **OneDrive 미디어 동기화** — 집 PC `C:\Users\user\OneDrive\yeori-studio-sync` 폴더 없음, 확인 필요

---

## ✅ 완료된 것

### 고도화-11 (2026-08-10)

| 항목 | 커밋 |
|------|------|
| POST /api/pipeline/start + GET /api/pipeline/status + POST /api/pipeline/stop (영구 락 버그 선제 처리 포함) | 7867f4c |
| 에이전트 리더 탭 — 구간 선택(G1~G5) + 파이프라인 실행/중지 버튼 + 3초 폴링 실시간 로그 | a30caf2 |
| 에이전트 리더 채팅 UI — 컨텍스트 자동주입 + 대화 히스토리 + 액션 파싱(pipeline_start/stop 실행) | 4f07f65 |

**검증 완료**: 에이전트 리더 탭 UI → `/api/pipeline/start` → `pipeline-leader.js` MCP 체이닝 실제 관통 확인
**버그 수정**: `studioState.episode?.id` → `studioState.activeEpisodeId` (조용한 실패 방지), pipelineStatus.meta?.xxx 구조 수정

### 고도화-10 (2026-08-07~09)

| 항목 | 커밋 |
|------|------|
| codebook_v1.0.0.json — SF_E01~E06 47컷 역설계, 전 필드 확정(SC/SP/PL/CH/DL/NR/SH/CA/MD/AT/DU/KR/IP/VP/CP) | d5613c3 |
| script_generator.py 재작성 — 외부 codebook.json 로드 방식 | d5613c3 |
| script_to_prompts.py — AT/CP 필드 대응, at+ac 듀얼 출력 하위 호환 | d5613c3 |
| /api/generate-candidate-flow 모델 업그레이드(haiku→sonnet-4-6) + LF/SF 컷 수 분기(LF=12~20컷 4096토큰) | 별도 커밋 |
| video-automation.js 팝업 트리거 하드코딩("Nano Banana 2") → 구조적 패턴으로 교체 | 별도 커밋 |
| 프롬프트 \n\n → 공백 치환 (Flow Enter=전송 조기제출 버그 수정) | 별도 커밋 |
| pipeline-leader.js — G1~G5 MCP 체이닝 오케스트레이터 검증 완료 (--episode/--from/--to 인자 추가) | 7867f4c 포함 |

### 고도화-9 (2026-07-14~30)

| 항목 | 내용 |
|------|------|
| MCP 브릿지 구축 | claude.ai → Vercel api/mcp.js → Cloudflare Quick Tunnel → proxy.js(3001) |
| MCP 도구 11개 완성 | studio_set_episode, studio_upload_script, studio_approve_g1, studio_run_g2~g4, studio_approve_g2~g4, studio_run_g5, studio_get_status |
| content_matrix_v3.html 후보 풀 탭 | 좌우 분할 패널, 4단계 체크리스트(⬜❌🟡✅), 코디젠 핸드오프 연결 |
| code_generator_v1.html (코디젠) | 에피소드/컷 설계/워크플로우 탭, /api/generate-script 연결 |
| ScriptGenTab.jsx v3 파서 | SC/SP/PL/CH/DL/NR/SH/CA/MD/AT/DU/KR/IP/VP 필드 파싱 |

### 인스타 릴스 제작 기능 (2026-08-07)

| 항목 | 내용 |
|------|------|
| handwriting_overlay.py | 인스타 릴스용 손글씨 오버레이 생성 |
| yeori_signature.py | 서여리 시그니처 자동 삽입 |

### start_yeori.bat 자동 동기화 (2026-08-08)

- bat 실행 시 이 PC에 1시간 자동 동기화 작업 등록 여부 확인 → 없으면 자동 등록, 있으면 스킵
- 회사 PC에서도 git pull 후 bat 실행만으로 동일 설정 자동 적용 (별도 명령어 불필요)
- "없으면 등록 / 있으면 스킵" 양쪽 경로 실제 검증 완료

### 고도화-8 이전 완료 항목 (06-21 기준)

<details>
<summary>펼치기</summary>

- 영상 만들기 탭 자막 시스템 전면 구축 (423b668 ~ f00d617)
- 다중 클립 트림 시스템 (8928265 ~ e7b46ef)
- G4 스타트 프레임 자동 연결 (gpoints.json selectedImage 필드)
- VideoTab 전체 일괄 합성 버튼 (/api/ffmpeg 연동)
- EP3 실전 테스트 완주 (G1~G2, 경로 버그 해결)
- A Creative Cutter CapCut draft_content.json 외부 조작 경로 폐기 → FFmpeg 직접 합성으로 전환
- studio-state.json OneDrive 동기화 전환 (git 추적 제외)
- TTS 탭 — 전역 상태 보존 + 영상 자막 자동 동기화 (eca548a)

</details>

---

## 🗺️ 자동화 전체 현황 (2026-08-10 기준)

| 단계 | 상태 | 비고 |
|------|------|------|
| Step 0 트렌드 수집 | 🟡 부분 자동화 | TREND RADAR v7, 후보풀 탭 연결 완료 |
| Step 1 후보 선정 | ✅ 완료 | 후보풀 → 코디젠 핸드오프 |
| G1 대본 생성 | ✅ 완료 | /api/generate-script, codebook v1.0.0 |
| G2 이미지 생성 | ✅ 완료 | flow-automation.js, MCP studio_run_g2 |
| G3 TTS | ✅ 완료 | ElevenLabs 연동, 자막 자동 동기화 |
| G4 영상 생성 | 🟡 부분 자동화 | video-automation.js 완성, VideoTab UI 미연결, 타임아웃 처리 미완 |
| G5 편집 | 🟡 부분 자동화 | FFmpeg 합성 완성, pipeline-leader G5 체이닝 확인 |
| G6 업로드 | ⬜ 미구현 | |
| **오케스트레이터** | ✅ **완료** | **에이전트 리더 탭 ↔ pipeline-leader.js 연결, 채팅 소통 기능** |

---

## ⚠️ 핵심 메모

### MCP 브릿지
- Quick Tunnel URL은 PC 재시작마다 변경 → `MCP_BRIDGE_URL` 갱신 + Vercel redeploy 필요
- 브릿지 끊김 시 `get_studio_state` 실패 → `recent_chats(n=3)` 폴백으로 컨텍스트 재구성
- `MCP_PUBLIC_SECRET`: 값은 문서에 적지 말 것 — Vercel 환경변수에서 직접 확인 (⚠️ 과거 버전의 이 문서에 평문으로 실려 GitHub public 저장소에 노출된 이력 있음 — 로테이션 권장, 2026-08-10 확인)

### 3개 도구 연결 구조 (2026-08-10 완성)
```
트렌드레이더(후보풀 탭)
    ↓ promoteCandidateToG1() — localStorage → code_generator_v1.html
코디젠 → /api/generate-script
    ↓ (스튜디오 에피소드 등록)
에이전트 리더 탭
    ↓ /api/pipeline/start (채팅 액션 파싱 또는 직접 버튼)
pipeline-leader.js — MCP G1→G5 체이닝
```

### 실행 환경
- `start_yeori.bat` — proxy.js(3001) + Vite(5173) + Chrome CDP(9222) + 1시간 자동동기화 등록
- ⚠️ Chrome CDP 포트 9222: `/api/run-video`와 에이전트 리더 영상 에이전트 동시 실행 금지 (Puppeteer 세션 충돌)
- ⚠️ node 스크립트 실행 전 `$env:NODE_OPTIONS=""` 초기화 필요 (양 PC 공통)
- Claude API 모델명: `claude-sonnet-4-6`

### 경로
- 집 PC: `C:\yeori-studio\` (git 루트) / `C:\yeori-studio\app\`
- 회사 PC: `C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio`
- GitHub: `J-xeses/yeori-studio` (master 브랜치)
- Vercel: `yeori-studio.vercel.app`

### 캐릭터 일관성
- 헤어: `hair is long, NOT short` 이중 강조 유지
- ElevenLabs 보이스 ID: `RmYuvmCbqOMBJxDLW4k8`
- Google Flow 프롬프트 내 "서여리"/"Seo Yeori" 직접 사용 금지 → "20대 초반 한국 여성"

---

## 🔄 이 파일 업데이트 방법
세션 끝날 때 "STATUS 업데이트해줘" → 완료된 것 이동 + 새 작업 추가
