# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-08-17 (고도화-12 — 스튜디오 전 기능 점검 + 메이킹 탭 완성)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### 편집 의도 프롬프트 자동 생성
- **다음**: 대본의 VP(영상 프롬프트)/SH(샷)/AT(동작) 필드를 CapCut 편집 명세로 자동 변환하는 기능 — 아직 미착수

### G6 업로드 자동화
- **상태**: MCP 도구 자체가 아직 없음, 퍼블리싱 탭의 패키지·썸네일 생성까지만 있음(이월 항목)

### 손글씨 텍스트 애니메이션(핸드라이팅 말풍선) — 다듬기 단계, 회사 PC에서 진행
- **상태**: `scripts/handwriting_overlay_animate_test.py` — 회전/bob/투명도 pulse 애니메이션 + 다중 말풍선 동시배치(좌표 직접 지정) 검증 완료. IG_R01 컷1로 5버블 테스트 성공(`test_out/C01_multibubble_v3.mp4`)
- **다음**: (1) `draw_cloud()` 구름 모양이 겹친 원처럼 보임 — 개선 필요 (2) 색상 팔레트를 버블 의도별로 의도적 조합 (3) 회전각(3.5도) 등 파라미터 미세조정 (4) 최종 결과물을 CapCut 프로젝트에 얹는 방법 설계 안 됨. **집 PC가 아니라 회사 PC에서 이어서 진행 예정.**
- **참고**: 대사 자막(CapCut 네이티브 텍스트트랙)과 이 손글씨 효과는 완전히 별개 레이어 — 속마음/상황/공감 코멘트를 자유배치하는 용도

### SF_E07 codebook v1.0.0 검증
- **상태**: 실데이터로 검증 미완료 — 이월

### Notion 마스터 허브 + STATUS.md
- **상태**: 매 세션 반복 지적 사항. 이 파일로 대신하는 중
- **다음**: 세션 시작 시 반드시 이 파일 먼저 읽을 것

---

## 🎯 On the Horizon (예정 작업)

- **SF_E01 CUT2~8 G2~G4 수동 승인 대기** — CUT1은 2026-08-16에 실제로 확인 후 승인 완료(`downloads/deliverables/SF_E01/cut_01_image.jpeg` 생성 확인). 나머지 7컷도 같은 방식으로 스튜디오/TTS/영상 탭에서 눈으로 확인 후 승인만 누르면 됨.
- **크레딧 게이트 완전 정합 미완** — `downloads/credit-usage-today.json`(오늘 G4 소모량 자체 추적)이 사람이 "자동 확인" 눌러도 즉시 리셋되진 않음, 날짜 바뀔 때만 자동 초기화. 다음에 완전 정합 붙일 것(2026-08-16 설계 노트: `server/lib/creditUsage.js`).
- **4차(파일경로를 episode.code 기준 전면교체)는 보류** — proxy.js 약 25곳 + scripts/*.js 11개 + 클라이언트 탭 8개로 범위가 너무 커서(2026-08-15 전수조사 완료, 상세는 아래 핵심 메모 참고) 당장은 손 안 댐. 대신 `episode.number`를 전역 유일 카운터로 되돌려 충돌 자체를 막는 우회로 대응. 나중에 필요해지면 이 조사 결과부터 참고할 것.
- **VideoTab.jsx AI 영상 자동생성 UI 연결** — `/api/run-video` 엔드포인트는 완성, 호출 버튼 없음(MCP 경로로는 크레딧 게이트까지 적용됨 — UI 버튼도 붙이게 되면 크레딧 게이트 로직 재사용할 것)
- **서여리 의상 프롬프트 카탈로그 고도화** — 15룩, 7카테고리(A~G), 계절별 태그 분류
- **OneDrive 미디어 동기화** — 집 PC `C:\Users\user\OneDrive\yeori-studio-sync` 폴더 없음, 확인 필요

---

## ✅ 완료된 것

### 스튜디오 전 기능 점검 + 메이킹 탭 완성 (고도화-12, 2026-08-17)

**버그 수정 9건:**

| 항목 | 커밋 |
|------|------|
| `studio_get_status` 컷별 응답에 `cutType`/`hasDialogue`/`hasNarration` 필드 추가 | `8cb8604` |
| G5 완료 후 gpoints 미기록 수정(concat 성공해도 G5 완료로 안 잡히던 버그) | `7edeed3` |
| `pipeline-leader.js` G5 완료 후에도 `running` 상태가 안 꺼지던 버그 | `63180ce` |
| 이미 완료된 단계 재실행 방지 — G1~G5 전 단계 스킵 로직 | `a50837f` |
| G3 스킵/자동종료 판정에서 무음(대사·나레이션 없음) 컷 제외 | `b1c27e2`, `baf9171` |
| `check-final`/`package-final` 파라미터명 통일 + G5 raw 산출물 폴백 | `fe6cb26` |
| `credits-status` 크레딧 단위 불일치(컷수 vs 포인트) 수정 | `db7f65e` |
| 코디젠(Codi_GEN) "스튜디오로 전달" 버튼에 활성 에피소드 배지 + confirm | `efc9dff` |

**신규 기능:**

| 항목 | 커밋 |
|------|------|
| 에이전트 리더 채팅 `create_episode` 액션 + `POST /api/episodes` | `b2048e6` |
| `script_upload`에 `scriptPath`(파일 경로) 방식 추가 | `ddd83ab` |
| 채팅 3단계 체이닝(에피소드 생성→대본 업로드→G2 실행) 검증 완료 | - |
| `PIP_VD` 컷타입 + `pipTarget`/`pipLayout`/`pipScale` 필드 | `f27e122` |
| codebook `G2-R`/`G3-R`/`G4-R`/`G5-M` making_record 매트릭스 확정 | `5169556` |
| `screen-recorder.js` + `POST /api/recording/start·stop` | `29ffe35`, `b1085cb` |
| MakingTab.jsx 완성 — GRAPHIC 편집기(HTML→헤드리스 캡처→mp4) | `1be7e1f` |
| MakingTab.jsx 완성 — BROLL 녹화(녹화→자동 트림+스케일 편집) | `31960f4` |
| MakingTab.jsx 완성 — CAPCUT 녹화(창 자동감지) + 듀얼모니터 좌표 보정 | `17c8ff6` |
| MakingTab.jsx 완성 — G5-M 메이킹 필름 조립 | `2a98586` |
| MakingTab.jsx 완성 — Pexels 소스 검색/다운로드 | `8ba35b4` |

### G4 크레딧 게이트 + start_yeori.bat 버그 수정 + 시스템 지도 (2026-08-16)

| 항목 | 내용 |
|------|------|
| **G4 크레딧 게이트 신규** | `server/lib/creditUsage.js`(신규) — 오늘 G4가 실제 소모한 컷 수를 `downloads/credit-usage-today.json`에 자체 기록(클라이언트가 studio-state.json을 통째로 덮어써도 안 건드려지는 별도 파일). `studio-run-g4`가 요청 전에 "사람이 확인해둔 크레딧 − 오늘 이미 쓴 만큼"으로 감당 가능한 컷 수 계산 → 부족하면 배치 전체가 아니라 **감당되는 만큼만 일부 진행**, 0이면 아예 차단. `pipeline-leader.js`는 `skippedForCredit` 응답을 로그로 표시. G2는 크레딧 소모가 없는 구조라 게이트 대상 아님(사용자 확인). |
| **CreditsTab(일일 크레딧 모니터링) 실측 검증** | "🔄 자동 확인" 버튼이 실제로 Flow 대시보드(Chrome CDP 9222)를 읽어서 정확한 값을 파싱하는 것 라이브로 확인(스크린샷 교차검증). 서브 계정(PixVerse, 포트 9223)은 코드는 정상이나 서브 Chrome이 안 떠있어 미검증. |
| **`start_yeori.bat` 트렌드레이더 버그 수정** | `.next` 폴더 존재만 체크해서 "빌드된 걸로 착각 → npm run start가 즉시 크래시"하던 버그 발견(실측: `Could not find a production build`). `.next\BUILD_ID` 파일 존재로 체크 방식 변경. 실제로 `npm run build` 돌려서 트렌드레이더(:3000) 정상화까지 확인. |
| **SF_E01 CUT1 실제 승인** | 이미지 직접 확인(카페 테라스 B-roll, 서여리 미등장 컷 — 대본 의도와 실제 이미지 일치 확인) 후 G2 승인, `downloads/deliverables/SF_E01/cut_01_image.jpeg` 자동 생성 확인. |
| **시스템 지도 아티팩트** | 트렌드레이더/후보풀/코디젠/스튜디오/에이전트리더 도구 관계 + G1~G6 자동화 성숙도를 다이어그램으로 정리(claude.ai 아티팩트, 대화 내 링크). |

**검증**: `node --check server/proxy.js`, 크레딧 0원 상태에서 `studio-run-g4` 실제 호출 → `/api/run-video` 자체가 안 불리고(video-automation.js 프로세스 확인 안 뜸) 명확한 에러로 차단되는 것 확인. 부분배치 트림 계산식은 별도 스크립트로 수식 검증(실제 Veo 크레딧 소모하는 라이브 배치 테스트는 안 함 — 사용자가 준비됐을 때 직접 확인 예정).

### 에피소드 번호 충돌 발견 → 스튜디오 리셋 + deliverables 산출물 모음 시스템 (2026-08-15)

**배경**: StudioTab.jsx의 "목록과 화면이 안 맞는다" 버그를 조사하다가, `ep_1`(LF)/`IG_R_E01_AI`(IG_R)/`SF_E01`(SF) 세 에피소드가 전부 `episode.number:1`이라 `downloads/flow/ep1/` 등 같은 폴더를 실제로 공유하고 있던 걸 발견(2026-08-08에 "콘텐츠유형별 독립 번호"로 바꾼 게 원인). 근본 해법(4차: 파일경로를 episode.code 기준 전면교체)은 proxy.js 약 25곳+scripts/*.js 11개+클라이언트 탭 8개로 범위가 너무 커서 보류.

| 항목 | 내용 |
|------|------|
| 번호 자동제안 → 전역 유일 카운터로 전환 | `App.jsx`(nextNumber)·`AppContext.jsx`(`ADD_EPISODE`/`RENUMBER_EPISODE`) — 콘텐츠유형별 필터 제거. 트레이드오프: 코드의 "E0N"이 유형별로 1부터 안 시작할 수 있음(사용자 승인) |
| 스튜디오 전면 리셋 | `studio-state.json`/`gpoints.json`을 `downloads/_archive_2026-08-15/`에 백업 후, 앱 최초실행 기본상태(에피소드 1개, `ep_1`)로 초기화. `downloads/{flow,video,audio,output}` 밑 번호기반 ep폴더 전부 아카이브로 이동 |
| **`downloads/deliverables/{episodeCode}/` 신규** | G2/G3/G4 승인 시 자동으로 `cut_NN_image/audio/video.ext` 복사, G5 완료 시 `{code}_edit_raw.mp4` 복사(`server/lib/mediaPaths.js`의 `deliverablesDir()`, `proxy.js`의 `copyToDeliverables()`). 원본은 그대로 두고 복사만 함, 실패해도 승인 자체는 안 막음(비파괴적) |
| `script_upload` 채팅 액션 신규 | 에이전트 리더 채팅(`content_matrix_v3.html`)에 대본을 붙여넣고 "업로드해줘"라고 하면 `POST /api/script-upload`(인증 없음, `/api/pipeline/*`와 같은 패턴)로 G1까지 자동 승인. 대본 원문의 정식 저장 위치도 처음 생김: `downloads/script/{code}/script_v3.txt` |
| G2 CAPCUT 오분류 버그 수정 | IG_RL 등 인스타 콘텐츠는 PL이 전부 `IG_RL` 하나뿐이라 텍스트 전용 컷(이미지 불필요)도 `imagePrompt`가 안 비어서 G2 대상에 잘못 잡히던 버그. IP에 "이미지 생성 불필요" 문구 있으면 `CAPCUT` 타입으로 분류(`scriptParserV3.js`+`ScriptGenTab.jsx`) + `studio-run-g2`/`StudioTab.jsx`의 `runFlow()` 둘 다 GRAPHIC/CAPCUT 제외하도록 수정 |
| `studio-run-g2` 인스타 라우팅 누락 수정 | MCP 경로가 `type:'insta'` 파라미터를 안 보내서 인스타 콘텐츠도 숫자 폴더로 잘못 저장될 뻔한 걸 발견·수정 |
| 에이전트 리더 채팅 G1~G5 카운트 표시 버그 수정 | `studioState.cuts`엔 g1~g5 필드가 원래 없어서(gpoints.json에만 있음) 항상 0으로 잘못 보고하던 버그 — `/api/studio-status-public`의 `summary`를 쓰도록 수정 |
| `saveStudioState()` savedAt 미갱신 버그 수정 | MCP/에이전트 리더 경로로 저장할 때 `savedAt`을 안 찍어서, PC간 동기화(`smart-sync-state.ps1`)가 최신 변경을 못 알아볼 위험이 있던 걸 발견·수정 |
| SF_E01 재등록 | 리셋 때 아카이브된 SF_E01(8컷, 실제 이미지·영상 완결본 있음)을 `episode.number:4`로 교정해서 재등록, media 폴더도 원위치 복구, gpoints G1 기록도 복원 |

**⚠️ 사고 기록(재발 방지용)**: 서버 코드(`proxy.js`) 수정 후 재시작을 안 하고 테스트 요청을 보냈다가, 예전(버그 있는) 코드가 그대로 돌면서 실제로 열려있던 Chrome(원격 디버깅 9222)에 `flow-automation.js`가 진짜로 붙어서 자동화를 시작한 사고가 있었음(10~15초 내 강제종료, 실제 생성까지 갔는지는 불확실). **서버 코드를 고친 뒤엔 반드시 재시작하고 나서 테스트할 것.**

**검증**: `vite build` 통과, MCP 엔드포인트 실측(더미 테스트 에피소드로 G2/G3/G4 승인→deliverables 복사 확인 후 정리), `git status`로 의도한 파일만 변경됐는지 확인.

### ScriptGenTab.jsx — pc.ac → pc.at 마이그레이션 완료 (2026-08-11)

| 항목 | 커밋 |
|------|------|
| `mapPromptsCutsToAppCuts` 3곳(action, masterCode.ac, masterCode.kr.ac) 전부 `pc.at`/`pc.kr?.at` 참조로 변경 — codebook v1.0.0 AC→AT 통일에 맞춤 | bb7cae0 + 본 커밋 |

**참고**: `script_to_prompts.py`가 내려주던 `ac`(레거시 별칭, at와 동일값) 듀얼 출력은 이 JSX 마이그레이션이 끝났으니 이제 제거 가능(별도 작업).

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

## 🗺️ 자동화 전체 현황 (2026-08-16 기준)

| 단계 | 상태 | 비고 |
|------|------|------|
| Step 0 트렌드 수집 | 🟡 부분 자동화 | TREND RADAR v7, 후보풀 탭 연결 완료 |
| Step 1 후보 선정 | ✅ 완료 | 후보풀 → 코디젠 핸드오프 |
| G1 대본 생성 | ✅ 완료 | /api/generate-script, codebook v1.0.0 |
| G2 이미지 생성 | ✅ 완료 | flow-automation.js, MCP studio_run_g2 |
| G3 TTS | ✅ 완료 | ElevenLabs 연동, 자막 자동 동기화 |
| G4 영상 생성 | 🟡 부분 자동화 | video-automation.js 완성, VideoTab UI 미연결. 타임아웃(15분) 처리는 완료. **크레딧 게이트 신규(2026-08-16)** |
| G5 편집 | 🟡 부분 자동화 | FFmpeg 합성 완성, pipeline-leader G5 체이닝 확인 |
| G6 업로드 | ⬜ 미구현 | |
| **오케스트레이터** | ✅ **완료** | **에이전트 리더 탭 ↔ pipeline-leader.js 연결, 채팅 소통 기능** |
| **산출물 모음(deliverables)** | ✅ **완료(2026-08-16)** | **G2~G5 승인/완료 시 `downloads/deliverables/{code}/`에 자동 수집** |

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
- **`downloads/deliverables/{episodeCode}/`(신규, 2026-08-15)**: G2~G5 승인 시 자동 수집되는 산출물 모음 — `downloads/final/ep{N}/`(퍼블리싱 탭의 CapCut 편집 끝난 발행용 파일)과는 다른 폴더이니 혼동 주의
- **`downloads/_archive_2026-08-15/`**: 리셋 때 옮긴 옛 ep번호 폴더들(ep2/ep3/ep98/ep99 등 테스트 데이터, SF_E01/IG_R_E01_AI는 복원해서 뺐음) + 리셋 전 studio-state.json/gpoints.json 백업
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


---
### 2026-08-27 (MCP 자동 기록)
proxy.js MCP 라우터에 5개 도구 추가: git_commit_push, update_status_md, restart_proxy, vercel_redeploy(유비 디렉터 대상), read_file(downloads/·app/ 하위 제한). 전부 실제 호출로 검증 완료.


---
### 2026-08-30 (MCP 자동 기록)
### 2026-08-30 (고도화-13 완료 기록)

**Worker 버그 수정 및 MakingTab 재구성:**

| 항목 | 커밋 |
|------|------|
| MakingTab.jsx 컷 목록 중심 UI 재구성 — 타입별(GRAPHIC/BROLL/CAPCUT/YEORI) 제작 버튼 + proxy.js `/api/download-broll-cut` 추가 | d87e72a |
| task-queue-worker.js stdin 방식으로 수정 (shell:true + argv → stdin pipe) — Windows 공백 파싱 버그 수정 | 1d08e74 |
| task-queue-worker.js shell:false로 변경 — DEP0190 경고 제거 | 011e198 (push 필요) |

**Worker 정상 작동 확인**: worker-test.txt 생성 성공 (2026-08-29 07:20)

**미완료:**
- shell:false 커밋 git push 누락 → push 필요
- MakingTab 브라우저 실제 동작 검증 미완료
- GRAPHIC/BROLL 타입 실제 제작 검증 미완료
- /api/file-info + /api/extract-frame 엔드포인트 추가 필요 (Claude AI가 직접 영상 내용 확인용)



---
### 2026-08-30 (MCP 자동 기록)
### 2026-08-30 (Worker 버그 추가 수정)

**Worker ENOENT 버그 수정 (9ed4169, push 완료):**
- shell:false + claude.cmd 조합 → ENOENT 확정 (CVE-2024-27980 이후 Windows 제약)
- resolveClaudeExe() 추가: (a) TASK_QUEUE_CLAUDE_PATH 환경변수 → (b) claude.exe 직접 경로 → (c) 폴백 shell:true
- @임시파일 방식 실측 검증 완료 (claude.exe + shell:false + -p @tmpfile → 정상 동작 확인)
- Worker 실제 e2e 테스트 통과 (close code:0, parsed result 정상)

**현재 Worker 상태: 정상 작동 확인 ✅**

**STATUS.md 정정:**
- "shell:false 커밋 push 필요" → 이미 완료 (9ed4169)
- "shell:false 수정 커밋 push 누락" → 수정됨



---
### 2026-08-30 (MCP 자동 기록)
### 2026-08-30 (고도화-14 MakingTab 완성)

**MakingTab 유형별 제작 기능 완성 (성준님 직접 구현, 478f697 / a90a9b3, push 완료):**

| 항목 | 내용 |
|------|------|
| fillTemplate 서버 통일 | 문구 선택 순서: subtitle → videoPrompt 따옴표 → imagePrompt [캡션] → dialogue → narration → scene. white-space:pre-line, word-break:keep-all, 80px, sub-text 제거 |
| 유형별 기본 제작 스타일 등록 | localStorage making_type_styles_v1. 기본 제작 방식(CAPCUT: HTML캡처/CapCut녹화, BROLL: Pexels/녹화), 기본 HTML 파일 지정, 자동 템플릿 시각 스타일(배경색·글자색·크기·굵기·정렬) + 라이브 미리보기 |
| renderHtmlCapturePanel 통합 | GRAPHIC/CAPCUT(html) 패널 단일화. [제작 실행]은 항상 /api/graphic-capture로 단일화 |
| CAPCUT 기본 HTML 등록 | RL02_DM_mockup_v3.html 등록 → 새로고침 후에도 유지. CUT 2 제작 실행 → DM 목업 isolate 캡처 성공 ✅ |

**검증 완료:**
- CUT 1 GRAPHIC 자동 템플릿 제작 실행 ✅
- CUT 2 CAPCUT + RL02_DM_mockup_v3.html 커스텀 HTML 제작 실행 ✅ (DM 목업 isolate 캡처)
- npm run build 통과 ✅

**큐 미처리 작업 (성준님 직접 해결로 불필요):**
- task_1788063011854 (file-info/extract-frame) — 취소
- task_1788064486191 (HTML 드롭다운 연동) — 성준님 방식으로 대체
- task_1788065164779 (instaNum 폴백) — 성준님 방식으로 대체

**다음 작업:**
- CUT 3, 5 CAPCUT 제작 검증
- BROLL CUT 4 (YEORI 타입) 확인
- 메이킹 필름 전체 조립 실행 검증



---
### 2026-08-30 (MCP 자동 기록)
### 2026-08-30 (고도화-14 손글씨 오버레이 + Worker 완전 정상화)

**Worker spawn EINVAL 수정 (a5097d5, push 완료):**
- 원인: TASK_QUEUE_CLAUDE_PATH=claude.cmd + shell:false → Windows CVE-2024-27980 제약
- 수정: override 경로 옆 claude.exe 우선 시도, .cmd/.bat/.ps1이면 shell:true 경유
- 검증: 06:39 사이클에 실제 작업 처리 완료 ✅

**손글씨 오버레이 기능 완성 (55c5f7f, push 완료):**
- proxy.js: POST /api/handwriting-overlay (scenes → config JSON → handwriting_overlay.py → cut_NN_overlay.mp4)
- MakingTab.jsx: 씬별 텍스트/위치/말풍선/색상/데코/화살표+방향/시간 설정 UI + [오버레이 적용]
- handwriting_overlay.py: ffprobe 베이스 길이 측정 + -t 명시 + veryfast preset (4초 클립 1.8초 처리)
- Pillow 12.3.0 설치 완료
- 검증: cut_02_overlay.mp4 63KB 생성, 구름 말풍선+화살표+✨+서여리 시그니처 확인 ✅

**유형별 기본 제작 스타일 (localStorage making_type_styles_v1):**
- GRAPHIC: 자동 템플릿 스타일 설정
- CAPCUT: HTML 캡처 기본, RL02_DM_mockup_v3.html 등록
- BROLL: Pexels 검색 기본

**다음 작업:**
- CAPCUT 기본 HTML을 컷별로 다르게 설정하는 방법 필요 (CUT 1은 자동템플릿, CUT 2/3은 DM 목업)
- CUT 3, 5 제작 검증
- 메이킹 필름 전체 조립 실행 검증
- IG_R02 손글씨 오버레이 컷별 씬 설정 (CUT 1~5)



---
### 2026-08-30 (MCP 자동 기록)

## 고도화-15 세션 완료 (2026-08-30)

### 확인된 것
- Worker 완전 정상 (a5097d5 이후, 마지막 EINVAL 06:14, 이후 clean)
- VideoTab AI 영상 UI / FFmpeg 합성 — STATUS.md와 달리 이미 구현되어 있었음 (코드 피드백 확인)
- TEST_OVERLAY 에피소드 생성 완료 (G1:3컷 승인, 이미지/영상 파일 존재)

### 구조 변경
- Project Instructions 3개 프로젝트(AI 고도화 / 서여리 채널 / AI 유튜브)에 세션 시작/종료 루프 강제화
- 세션 시작: Notion 마스터 허브 + 에피소드 DB + studio_get_status 먼저 읽기
- 세션 종료: Notion + STATUS.md 업데이트 완료 후 종료

### 다음 세션 즉시 할 것
1. TEST_OVERLAY — CP 필드 포함 v3 표준 대본으로 GRAPHIC/CAPCUT 실제 제작 검증
2. 손글씨 오버레이 (/api/handwriting-overlay) 구현
3. ScriptGenTab.jsx pc.ac → pc.at 마이그레이션


---
### 2026-08-31 ~ 09-01 (메이킹 탭 자동 편집 파이프라인 완성 + 유비 디렉터 정비)

#### 손글씨 오버레이 재작업 — "그림1" 수준 (커밋 계열, push 완료)
- 자막 버블스러운 인위적 표현 → 손으로 쓴 느낌. 다크 헤일로(다층 블러 섀도) +
  소프트 라디얼 비네트 + 얇은 컬러 스트로크, 검정 아웃라인 제거. 폰트 Gaegu-Bold(OFL,
  번들) → Nanum Pen 폴백. seeded mulberry32 결정적 2-pass.
- 3벌 동기화: `yubi-director/lib/handwriting.js` + `lib/handwriting-preview.js` +
  `yeori-studio/app/scripts/handwriting_overlay.py`. 장면당 손글씨 주석 2~3개(사물
  자기소개 라벨 포함) 산포.

#### 유비 디렉터
- 사용 매뉴얼 독립 HTML 3벌 동기화(`~/Desktop/유비 디렉터 매뉴얼.html`,
  `yubi-director/docs/manual.html`, 아티팩트). "인물 흰 테두리(누끼)" 내용 전부 제외.
  성준이 유비 의도 받아 "콘텐츠 틀" 잡아주는 5단계 핸드오프 포함.
- AI 소스 생성 무드 + 디렉터 UI를 유비 실제 인스타(모노톤 어반)로 조정. `app/globals.css`
  로즈/골드 → 무채색(검정 그라운드·실버 강조). `proposals` 프롬프트 가짜"Swan Beauty" 삭제.
  AI 이미지 스타일가이드 `…/03. 제작엔진/유비_이미지_스타일가이드.md` 신규.

#### 메이킹 탭 자동실행 — 제작유형별 (커밋 `b2af9d1` → `db5b81c`)
- **유형별 자동실행 카드**: MANUAL_TYPES(GRAPHIC/BROLL/CAPCUT) 컷 순회 일괄 제작.
- **정지 그래픽 기본 모션** (`8234859`): `graphicMotionVf` none/zoom-in/-out/fade/zoom-in-fade.
- **애니메이션 그래픽 캡처** (`d24ee0a`): rise/pop/type-in — CSS 애니 클럭을 프레임마다
  `a.currentTime=t`로 수동 진행 → 스크린샷 N장 → ffmpeg. CAPCUT 데스크톱 녹화 컷을
  "HTML+애니 모션"으로 대체 가능.
- **`POST /api/broll-auto`** (`8234859`): 컷 묘사 → `aiPexelsQuery`(claude-sonnet-4-6)
  영어 검색어 → Pexels → 길이 근접 클립 자동.
- **`POST /api/capture-video-url`** (`8fe61ee`): 페이지/미디어 URL → puppeteer 헤드리스
  미디어 URL 추출 → ffmpeg. 봇차단(Pexels)·blob·canvas는 실패(422) → 수동.
- **CapCut 세미오토** (`db5b81c`): `/api/capcut-cdp` + `/api/capcut-semiauto` —
  헤어라인 리셰이프 등 편집만 자동, 내보내기는 수동. 전용 Chrome 9222 + 에디터 탭 전제.

#### 스튜디오 소스 → 메이킹 탭 컷 (커밋 `9d0939f`)
- RL03 분석: 약간 움직이는 초상 클립은 **스튜디오(영상생성)가 만들고** 메이킹 탭은
  규격화+손글씨. 편집효과로 동작 흉내내지 않음(사용자 피드백).
- **`POST /api/source-to-cut {epNum,cutNo,srcPath,duration,trimStart,trimMode,motion,fit}`**:
  로컬 이미지/영상 → `downloads/video/ep{N}/cut_NN.mp4`(1080×1920). 영상=trim+fit,
  이미지=fit+모션. `GET /api/source-scan?epNum` 소스 후보 목록. CP 있으면 손글씨 이어짐.
- 미리보기 "지지직" 플리커 수정: `?t=${Date.now()}` JSX 렌더 → `_ts` result state 저장 +
  videoStatus 폴링 dedup.

#### downloads 폴더 규약 통일 (커밋 `185349b`)
- `downloads/making/ep{N}/source/{studio,upload,stock}/` + `raw/` + `hw_stills/`.
  최종 컷은 `downloads/video/ep{N}/cut_NN.mp4`(불변). 규약 문서
  `downloads/making/README.md`(downloads/는 gitignore).
- `source-scan` 재작성(중복 제거·isFile 체크·group 라벨). `scene/ep99` → `source/studio` 이동.
- 루트 디버그 잔해(`bisect*.log`, `debug_*.png` 38개 등) 정리 (`dc0992d`).

#### 이중 모션 가드 (커밋 `f479cc4`)
- 메이킹 탭 자동 편집효과(그래픽 모션·s2c 줌·BROLL 실사) 위에 A Creative Cutter가
  켄번스를 또 얹던 문제.
- `recordCutMotion()` → `downloads/video/ep{N}/.motion-manifest.json`에 컷별
  `{method,motion,baked}` 기록. s2c 정지+모션없음만 `baked:false`, 나머지 메이킹 산출물
  `baked:true`. G4 YEORI는 기록 안 함(켄번스 유지).
- `run-cutter.js`가 (1)매니페스트 baked (2)editMeta cutType∈{GRAPHIC,BROLL,CAPCUT}로
  컷별 켄번스 스킵. `EditMetaTab.buildMeta()`에 cutType 추가.

#### 자동 커버리지 현황
텍스트/그래픽/모션 = 완전자동 ✅ / BROLL = AI자동(검토권장) 🟢 / 화면녹화URL = 자동 🟢 /
스튜디오 소스 컷 = source-to-cut 🟢 / CapCut 헤어라인 = 세미오토(편집 자동, export 수동) 🟡 /
순수 수동 색보정만 남음.

#### 다음 후보 4건 완료 (커밋 `f0877fd`)
- **메이킹 매니페스트 확장**: `.motion-manifest.json`에 `duration·producedAt`,
  손글씨 시 `overlay/overlayAt`. `buildStudioStatusPayload`가 컷별 `making{...}` +
  `hasOverlayVideo` + `dirtyVsAssemble`(조립본 mtime 대비) 노출. summary에
  `hasVideo·made·overlay·dirtyVsAssemble` 집계.
- **G4 자동 연동**: MakingTab useEffect — GRAPHIC/BROLL/CAPCUT 컷은 `cut_NN.mp4`
  확인되면 G4 자동. 리더 대시보드·매트릭스가 메이킹 진행 반영. YEORI는 제외(사람 승인).
- **길이 단일 규칙**: `src/lib/cutDuration.js` — `sec→duration→estimateDuration(대본)→5`.
  MakingTab 8곳 + EditMetaTab buildMeta 공유.
- **편집메타 컷분석 미리보기**: `analyzeCut`이 `cut_NN_overlay.mp4→cut_NN.mp4` HEAD
  확인해 자동 로드. 수동 파일선택은 폴백.

#### 메이킹 컷 진행 위젯 완료 (커밋 `209e797`)
- `GET /api/episode-making-status`(무인증) — GRAPHIC/BROLL/CAPCUT 컷의 done/overlay/
  dirty + 컷별 상세. `DashboardTab`에 "메이킹 컷" 카드(유형색 칩, ✍ 손글씨, ↻ 재조립,
  5초 폴링). 매니페스트 없는 구컷은 hasVideo만으로 완료 표시.

### 남은 후보
- run-cutter가 여전히 에피소드 통짜 실행 — 컷 단위 재조립은 별개 과제

