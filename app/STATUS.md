# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-09-05
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK
>
> ⚠️ 이 파일은 **append-only 로그**. 최신 상황은 이 상단 요약이 아니라 아래
> 날짜순 로그의 **맨 끝(가장 최근 날짜 절)**을 봐야 함. 상단 요약도 갱신하지만
> 세부는 항상 하단 로그 기준. 최신 로그(2026-09-05) = 맨 끝 "## 2026-09-05
> (그래픽 카드 생성기 + LF_T01 초상권 리스크 정리)" 절.

---

## 📌 현재 작업 중 / 다음 (2026-09-05 기준)

**2026-09-05: 그래픽 카드 생성기 구축 + LF_T01 배경장면 초상권/부정경쟁방지법 리스크 정리.**
- **그래픽 카드 생성기 신규** (`server/lib/graphicTemplates.js`, `d39b442`) — 템플릿×스타일
  조합으로 HTML 카드 자동 생성. `mv-intro`/`text-card`/`stat-card`/`info-source`/
  `fiction-disclaimer` 5종 + `/api/graphic-templates`·`/api/generate-graphic-html`·
  `/api/graphic-recommend`(proxy.js) + MakingTab CAPCUT 컷 카드 안 `GraphicCardGenerator`.
  설계 원칙은 `graphicTemplates.md`(신규) — 실존 인물 재현 금지, 컴플라이언스 문구는
  fields 아닌 템플릿에 고정, MD 코드는 codebook.json 8종만 사용.
- **MD 무드 자동추천 버그 수정** (`fa85cfa`) — `cut.md`가 아니라 `cut.masterCode.md`가
  실제 위치였음(750행 `c.masterCode?.pl`과 동일 자리). `MD_RECOMMEND`도 codebook.json
  실제 8종(JOY/SUR/STR/REL/CUR/DRM/SAD/INT)으로 재정비(전에 있던 MD_COM/MD_EMO는
  존재하지 않는 코드였음).
- **LF_T01 배경장면 초상권/부정경쟁방지법 리스크 발견·정리** — 실존 걸그룹(KATSEYE·ILLIT·
  르세라핌) AI 재현 배경장면 3개가 무대 화면에 실제 그룹명·곡명을 노출한 걸 확인
  (2025 판례 판단기준 5개 중 5개 전부 고위험 해당). 결론: **비주얼은 실명·로고 없이
  장르로 프롬프트**(재생성 샘플 확인 완료), **대사의 실명 언급은 유지**
  (명예훼손은 별개 법리, 사실 서술이면 안전). 원 배경장면 3개 교체는 아직 안 함.
  - **⚠️ 정정(같은 날)**: 이 에피소드가 "가상 콜라보 설정"이라고 전제했던 게 틀렸음.
    마스터코드 `[LF_TREND_01] :: [YR_VD] :: [LOOK_ST01] ICONIC BY MISTAKE`를 확인한
    결과, **KATSEYE×LE SSERAFIM×ILLIT "ICONIC BY MISTAKE"는 실제 협업 디지털 싱글**
    (2026.06.12 발매, KATSEYE 공식 Weverse 공지 + 공식 유튜브 MV 존재 — 허구 아님).
    → **`fiction-disclaimer` 템플릿은 이 에피소드에 쓰면 안 됨**(실제 뉴스를 허구라고
    잘못 고지하게 됨). 대신 `info-source`로 "ICONIC BY MISTAKE · 2026.06.12 발매 ·
    출처: KATSEYE 공식 Weverse 공지" 식 표기. **비주얼 원칙은 안 바뀜** — 실제 뉴스여도
    AI로 그들의 가짜 공연 장면을 사진처럼 재현하는 건 여전히 별개 문제(초상권은 사실
    여부와 무관). 오히려 진짜 공식 MV가 있으니 재연 없이 그 링크/사실을 그래픽 카드로
    전달하거나, 짧은 장면을 화면녹화로 인용(저작권법 28조, 최소 분량+명확한 해설
    맥락)하는 쪽이 맞음 — yt-dlp 전체 다운로드는 여전히 안 됨(유튜브 약관 위반 별개 문제).
- **flow-automation 캐릭터 라벨 정규식 버그 수정** (`0944980`) — `WOMAN\s*\d+`가 숫자만
  받아 "WOMAN LEFT/RIGHT" 라벨 매칭에 실패 → 두 인물 descriptor가 프롬프트 맨 앞에
  뭉쳐 붙으면서 여리 얼굴이 안 나오던 원인이었음. `WOMAN\s*[\w-]*`로 확장, 기존
  "WOMAN 1/2" 포맷도 회귀 없이 통과.
- **sync-content.bat 무한 재시도 수정** (`3bfcd05`) — `chrome-profile-main`이 켜진 채로
  robocopy가 돌면 crashpad_handler.exe가 `CrashpadMetrics.pma`를 잡고 있어 30초 재시도가
  무한 반복 → `start_yeori.bat`이 `[pre-2]` 단계에서 계속 멈춤. 좀비 프로세스 정리 +
  동기화 대상에서 해당 폴더 `/XD` 제외.
- **범용 화면 녹화 패널 추가** (`ScreenRecorderPanel`, `fd67536`) — 컷·에피소드에 안 묶인
  화면 녹화 UI. 기존 `screenRecorder.js`(ffmpeg gdigrab) + `/api/recording/start`의
  `outputPath` 직접 지정 분기를 그대로 재사용(백엔드 변경 없음). 메이킹 탭 상단에 카드로
  배치, 저장 위치 고정 `downloads/seoyeori/YU/sources/`. LF_T01 배경 클립 작업 중
  "화면에 보이는 걸 녹화해 sources/에 저장"이 반복될 일이라 판단해 만듦 — 유튜브 전용이
  아니라 범용(무엇을 녹화할지는 항상 사용자가 판단).

### 지금 이어할 것
- **LF_T01 배경장면 재생성** — KATSEYE/ILLIT/르세라핌 배경 3개를 실명·로고 없는 일반
  버전으로 교체(방향은 확정, 실행만 남음). **+ 실제 공식 MV("ICONIC BY MISTAKE")
  활용 검토** — 재연 대신 `info-source` 카드로 사실 전달, 또는 짧은 구간만 화면녹화로
  인용(전체 다운로드 금지, 최소 분량+해설 필수). `fiction-disclaimer`는 이 편에 안 씀.
- **다중 캐릭터 puppeteer 검증** — Phase 1·2 로직/API는 검증됨, Flow 캐릭터 페이지
  클릭·업로드 자동화(`ensureFlowCharactersRegistered`)는 실제 Flow 실행 시 확인 필요.
  라벨 매칭 버그(위)는 고쳐졌으니 다음 실제 생성 때 함께 검증.
- **ScriptGen 캐릭터 UI** — 레지스트리 목록·상태·새 캐릭터 추가 (지금은 API/JSON만).
- **손글씨 애니메이션 회사 PC 다듬기** — grim1 리워크는 완료, 남은 미세조정은 회사 PC.

### 이월 (여전히 유효)
- **G6 업로드 자동화** — MCP 도구 없음, 퍼블리싱 탭 패키지·썸네일까지만.
- **SF_E07 codebook v1.0.0** — 실데이터 검증 미완료.
- **크레딧 게이트 완전 정합** — `server/lib/creditUsage.js`, 날짜 바뀔 때만 자동 리셋.
- ~~**VideoTab AI 영상 자동생성 UI 버튼**~~ — 폐기(2026-09-02, 영상 수동 전환). `/api/run-video`는 DEPRECATED.
- **editIntent → 메이킹 탭 모션(graphic/s2c) 연동** (assemble 경로), run-cutter 컷 단위 재조립.

---

### (이전) 2026-09-04 기준

**2026-09-03~04: 화면녹화 + 릴스 최종화 파이프라인 구축.** screen-scenario(생성도구
화면을 스크립트로 조작·녹화, CDP `Page.startScreencast` + `cdp` 드라이버) + 릴스
최종화 모듈(`server/lib/reelFinalize.js` — 컷별 편집 판단 + concat + 손글씨 오버레이
자막 + SFX → `07_output/{CODE}_final.mp4`). 레퍼런스 `0808.mp4`, 검증 IG_R03(ep98).
상세 = 하단 "2026-09-02(영상=수동전환)" 로그의 `### 릴스 최종화 모듈`~`### 실행 이원화` 소절.

---

### (이전) 2026-09-02 기준

**2026-09-02: 영상 생성 = 수동 전환.** Flow/Veo puppeteer가 벤더 UI 변경으로 계속 깨져서
파이프라인 자동 영상 생성을 접음. 이제 사람이 Veo/Flow에서 직접 만들고 "영상 만들기" 탭
"영상 체크리스트"에서 mp4 업로드. 이미지는 자동 유지 방침이나 Gemini API 브로커는 미착수
(현재도 실질 Flow 수동). 상세 = 하단 "2026-09-02" 로그.

**2026-09-02: downloads 폴더 위계 전면 개편 완료 (구조 v3 — 브랜드 래퍼).**
```
downloads/
├── seoyeori/                            브랜드 (미래 멀티브랜드 대비)
│   ├── {YU,IG,TK}/{series}/{code}/{01_script..07_output}
│   │     YU: SF_E/LF_E(에피소드) SF_T/LF_T(트렌드)  ·  IG: IG_P/IG_R/IG_S/IG_T
│   ├── _etc/{code}/                     패턴 안 맞는 옛/테스트 (ep3·TEST_OVERLAY 등)
│   └── characters/  hw_stills/          브랜드별
├── _shared/{sfx, hooks}                 브랜드 무관 공용
├── runtime/{prompts, video-prompts}.json          전역 (Flow 실행)
├── state/{gpoints,trend_episodes,code-task-queue,credit-usage,capcut_config,yeori_edit_meta}.json
│                                         전역 (⚠️ 멀티브랜드 시 분리 필요)
├── flow/chrome-profile-*  (이동 안 함)   ← insta/ 는 seoyeori/IG/로 통합됨(`c1825b0`)
```
`{code}/` 안: `01_script 02_images 03_audio 04_making 05_video 06_publishing 07_output`
(06 = 편집·CapCut·raw·deliverables, 07 = 완성본·썸네일·업로드패키지 = 퍼블리싱 결과물).
경로 조립은 전부 `mediaPaths.js`(server+client): `BRAND='seoyeori'` + `parseCode()`
(`/^(SF|LF|IG|TK)_([ETPRS])(\d{2,})/`). 에피소드 코드 형식도 이에 맞춤(`EPISODE_CODE_RE`,
`659a6c9`). 코드 중복 입력 차단(`f8bc545`). `downloads/` git 추적 해제.
되돌리기: `migrate-downloads-v3.js --undo` → `-v2 --undo` → mediaPaths.js revert.
커밋: v1 `92bfe42` → 중복가드 `f8bc545` → v2 `e3583e5`·`659a6c9` → v3 `3ebd7f6`. 상세 = 하단 로그.


지난 이틀(8/31~9/1) 세션에서 메이킹 탭 자동 편집 파이프라인을 대거 완성함
(손글씨 재작업, 유형별 자동실행, source-to-cut, 이중 모션 가드, finishMode 콘텐츠별
분기, editIntent 컷별 켄번스, 다중 캐릭터 시스템 등 — 아래 해당 날짜 로그 참조).
**메이킹 탭 가이드 아티팩트**(사용법 + 화면 지도 + 릴스 최종본 판단 규칙 + 9/3~4 작업 로그 +
문제해결): https://claude.ai/code/artifact/f9dc4b8e-b70c-4aa5-bd38-ed0284e09abb

### 지금 이어할 것
- **다중 캐릭터 puppeteer 검증** — Phase 1·2 로직/API는 검증됨, Flow 캐릭터 페이지
  클릭·업로드 자동화(`ensureFlowCharactersRegistered`)는 실제 Flow 실행 시 확인 필요.
- **LF_T01 (서여리 + 한지아)** — 대본 `downloads/script/LF_T01_script_v3.txt` 준비됨.
  LF 에피소드 만들어 업로드 → 이미지 생성 테스트가 첫 실사용.
- **ScriptGen 캐릭터 UI** — 레지스트리 목록·상태·새 캐릭터 추가 (지금은 API/JSON만).
- **손글씨 애니메이션 회사 PC 다듬기** — grim1 방향 리워크는 이번 세션에 완료
  (`handwriting.js`/`-preview.js`/`handwriting_overlay.py`, "많이 개선됨" 확인).
  `draw_cloud` 겹친 원 문제도 이때 손봄. 남은 미세조정은 회사 PC.

### 이월 (이번 세션 범위 밖 — 여전히 유효)
- **G6 업로드 자동화** — MCP 도구 없음, 퍼블리싱 탭 패키지·썸네일까지만.
- **SF_E07 codebook v1.0.0** — 실데이터 검증 미완료.
- **크레딧 게이트 완전 정합** — `server/lib/creditUsage.js`, 날짜 바뀔 때만 자동 리셋.
- ~~**VideoTab AI 영상 자동생성 UI 버튼**~~ — 폐기(2026-09-02, 영상 수동 전환). `/api/run-video`는 DEPRECATED.
- **editIntent → 메이킹 탭 모션(graphic/s2c) 연동** (assemble 경로), run-cutter 컷 단위 재조립.

---

## 🎯 On the Horizon (예정 작업)

- **SF_E01 CUT2~8 G2~G4 수동 승인 대기** — CUT1은 2026-08-16에 실제로 확인 후 승인 완료(`downloads/deliverables/SF_E01/cut_01_image.jpeg` 생성 확인). 나머지 7컷도 같은 방식으로 스튜디오/TTS/영상 탭에서 눈으로 확인 후 승인만 누르면 됨.
- **크레딧 게이트 완전 정합 미완** — `downloads/credit-usage-today.json`(오늘 G4 소모량 자체 추적)이 사람이 "자동 확인" 눌러도 즉시 리셋되진 않음, 날짜 바뀔 때만 자동 초기화. 다음에 완전 정합 붙일 것(2026-08-16 설계 노트: `server/lib/creditUsage.js`).
- **4차(파일경로를 episode.code 기준 전면교체)는 보류** — proxy.js 약 25곳 + scripts/*.js 11개 + 클라이언트 탭 8개로 범위가 너무 커서(2026-08-15 전수조사 완료, 상세는 아래 핵심 메모 참고) 당장은 손 안 댐. 대신 `episode.number`를 전역 유일 카운터로 되돌려 충돌 자체를 막는 우회로 대응. 나중에 필요해지면 이 조사 결과부터 참고할 것.
- ~~**VideoTab.jsx AI 영상 자동생성 UI 연결**~~ — 폐기(2026-09-02). 영상은 수동 제작 + `/api/upload-cut-video` 업로드로 전환. `/api/run-video`·`studio_run_g4`는 DEPRECATED 주석만 남김.
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

#### 컷 싱크 패널 완료 (커밋 `30a4e65`)
- `GET /api/cut-timing?epNum` — 컷별 ffprobe 실측(영상/음성/Δ) + status + 처방값
  (suggestSpeed = audio/video, suggestVideoDur = ceil(audio)). 이전 컷분석의
  "음성 길이"(글자수÷5 추정) → 실측으로 대체.
- EditMetaTab 컷분석 탭 상단 "컷 싱크" 표 — 처방 버튼:
  "영상 Ns로"(cut.duration 갱신 + VideoTab 딥링크) / "TTS ×R"(TTSTab 딥링크) /
  "여운 수용"(cut.duration = 음성 길이). `cutDuration()` 통해 자막·조립 자동 반영.
- 딥링크: `ttsTabState.focusCutId` 추가(TTSTab 소비 후 해제), VideoTab은 기존
  `selectedCutId` 재사용.

#### 콘텐츠별 최종 조립 분기 — 1단계 완료 (커밋 `6dd906e`)
- **`finishMode`** 에피소드 필드 — `src/lib/finishMode.js` `resolveFinishMode()`:
  명시값 우선, 없으면 `contentType==='LF' → cutter`, 그 외 `assemble`.
  ScriptGenTab 에피소드 설정에 "완성 방식" 셀렉트.
- **EditMetaTab `runACC` 분기**:
  · `assemble`(인스타·틱톡): 메타→저장→SRT(음성없으면 skip)→`/api/making-assemble`
    →`/api/promote-making-to-raw`(→`output/ep{N}/ep{N}_raw.mp4`, 발행이 찾는 자리)→G5 자동.
    이중 모션 가드·손글씨본 우선·규격 재인코딩 다 반영됨. **end-to-end 무인 완성.**
  · `cutter`(서여리 시리즈): 메타→저장→SRT→concat-video(raw)→send-to-cutter.
- 죽은 `generate-capcut-spec` 단계 양쪽 다 제거. `POST /api/promote-making-to-raw` 신설.
- 검증: ep99 assemble — making-assemble(cuts 1~3, 11s)→promote→check-final이 raw 인식.

#### CapCut 연동 2단계 완료 (커밋 `e26550b`)
사용자 결정: **에피소드별 프로젝트 분리**(혼선 방지).
- `downloads/video/capcut_config.json` `{ draftRoot?, templateProject }`.
  draftRoot 생략 시 `%LOCALAPPDATA%\CapCut\...\com.lveditor.draft` 자동.
- `ensureEpisodeCapcutProject(episodeCode)` — `yeori_{code}` 폴더 없으면 템플릿
  프로젝트 `fs.cpSync` 복제 + `draft_meta_info.json` 갱신(경로·이름·id·타임스탬프·
  클라우드 흔적 제거). run-cutter가 세그먼트 템플릿으로 쓸 클립 1개는 템플릿에 있어야 함.
- `writeCutterInputJson()` → `output/ep{N}/cutter_input.json`.
  `draft` = `프로젝트/draft_content.json` **파일** 경로(run-cutter가 folder 아닌 file 기대 — 옛 ep2 json이 folder라 원래 안 됐던 것).
- `send-to-cutter`가 run-cutter 전에 위 둘 실행 + `kenburns` 파라미터, 응답에 `project`.
- `GET/POST /api/capcut-config`. EditMetaTab "최종 조립" 패널에 cutter 전용 블록
  (프로젝트명 표시 · 켄번스 셀렉트 · 템플릿 미설정 시 드롭다운+저장).
- 검증: 템플릿=0614 → ep99 send-to-cutter → `yeori_TEST_OVERLAY` 복제 + cutter_input.json
  + run-cutter 3세그먼트 정상(이중모션가드로 켄번스 스킵).
- **전제(사용자 1회 작업):** CapCut에서 클립 1개짜리 빈 프로젝트 만들어 templateProject로 지정.
- `send-to-cutter` 순서 수정(`26550b` 후속): CapCut 종료 → run-cutter → 재실행.
  (기존엔 편집 후 종료라 CapCut이 파일 물고 있으면 씹힘.)
- CapCut 재실행 시 뜨는 팝업은 자동화와 무관 — 편집은 CapCut 닫힌 상태에서 끝남,
  재실행은 사람이 프로젝트 여는 용도.

#### editIntent 컷별 켄번스 자동결정 (커밋 `f0269ff`)
지시서 `…\04. 편집영상 제작기능 고도화\claude_code_task_edit_intent.md` 기준 + 저장소 실제 조정.
- `POST /api/build-edit-intent` (무인증, 순수) — 대본 SH/CA/AT/MD → `{kenburns, reason, source}`.
  우선순위 CA > SH(+MD) > AT_EM. 전환형(`SH_MCU → SH_CU`) 끝값·복수(`AT_x + AT_y`) 리스트 파싱.
  켄번스명은 run-cutter 내부 효과명으로 통일.
- `run-cutter.js`: `cutKbMode = motionBaked ? 'none' : (intentKb || kbMode)`.
  **우선순위: 이중모션가드 > editIntent > 전역 kbMode.**
- `EditMetaTab`: buildMeta에 editIntent+SH/CA/AT/MD, "🎬 편집 의도 생성" 버튼, 메타표 "연출" 칸.
- 지시서 대비 수정: 경로(src/tabs), 필드(masterCode.sh 등), dispatch UPDATE_CUT, 코드 파싱, 값 정규화.
- 검증: ep99 seg1 zoomIn / seg2 leftToRight / seg3(GRAPHIC) keyframe 0.

#### 이미지 생성 진행 신호 2건 수정 (커밋 `e4f3e96`)
- **ScriptGenTab `approveG1`**: 전체 G1 승인 → 스튜디오 탭 자동 이동이 다중 컷에서
  안 됐음. `fe94711` 마이그레이션이 `gData[cut_N]` → `gData[episodeCode][cut_N]`로
  여러 곳 고쳤는데 `approveG1`의 `allDone` 체크 한 줄을 놓침. → `updated[episodeCode]?.[...]`로 수정.
- **StudioTab**: Flow/Gemini 이미지 생성·업로드·재조회 8곳이 `g3`(음성)를 자동
  마킹하고 있었음(`g2` 아님). Flow 이미지 있는 컷이 대시보드·에이전트에서 "G3 음성 완료"로
  표시되던 원인. 전부 제거 — "생성됨"은 `hasImage`(파일)가, `g2`는 사람 승인 버튼만.
- 기존 에피소드의 잘못 찍힌 `g3`는 이 커밋으로 정리 안 됨(재작업 시 자연 해소).

#### 다중 캐릭터 시스템 Phase 1 (커밋 `2f05b47`)
Flow 이미지 생성이 서여리 단일 하드코딩 → 2인 이상 등장 컷(한지아 등) 지원.
- `downloads/flow/characters.json`(gitignore) — 캐릭터별 name/aliases/face/closeup/
  descriptor/flowCharacterName. 서여리 마이그레이션 + 한지아 추가(얼굴=시그니처
  클로즈업, descriptor=Claude vision).
- `GET/POST /api/characters`, `POST /api/characters/:id/analyze`(vision → descriptor).
- `run-flow`가 컷 CH 필드(`YR_TX + JIA`)를 캐릭터 레코드로 해석해 prompts.json
  `cut.characters`에 실음. 못 찾으면 primary 폴백.
- `flow-automation.js`: `injectCharacterDescriptors` — IP의 `WOMAN N (Name):` 라벨 뒤에
  해당 인물 descriptor 삽입(라벨 없으면 맨 앞). `uploadReferenceImages`가 에피소드
  등장 인물 전원 얼굴 레퍼런스 업로드.
#### 다중 캐릭터 Phase 2 (커밋 `ab9b5c5`)
- `ensureFlowCharactersRegistered(page, charIds)` — 이미지 생성 흐름 프로젝트 생성 직전,
  에피소드 등장 캐릭터 중 `flowRegistered` 아닌 것을 Flow "캐릭터" 라이브러리에 순회 등록,
  성공 시 characters.json에 기록. 실패해도 생성 계속(미디어 풀 폴백). `--no-char-register` 스킵.
- `registerCharacterWithImage(page, img, {name, matchNames})` 파라미터화(서여리 하드코딩 제거).
- `--register-character[=id] [--force]` characters.json 순회로 일반화.
- `findReferenceThumbs`/`processCut` — `yeori-face/closeup` 하드코딩 → `wantedRefBasenames()`
  (등장 캐릭터 refBasename)로 다중 인물 썸네일 탐색·드래그. `result.found{basename:pos}`.
- jia 레퍼런스 flatten(`jia-face.jpg` 등, yeori 규칙 통일) + `refBasename` 필드.
- puppeteer 부분은 실제 Flow 실행 시 검증 필요.

## 2026-09-02 (영상 = 수동 제작 전환 · 스튜디오는 추적/업로드만) — 커밋 `4fcbe4e`

**배경**: Flow/Veo puppeteer 자동화(`flow-automation.js` 이미지 · `video-automation.js` 영상)가
Google `labs.google/fx` UI 변경 때마다 깨져서(2026-09-01 테스트: `createNewFlowProject`가
"새 프로젝트" 클릭 후 `/project/` 이동 감지 15초 타임아웃, `/characters` 페이지는 빈 화면)
파이프라인 신뢰성을 못 지킴. 결정: **이미지는 자동(추후 Gemini API 브로커), 영상은 당분간 수동**.
사용자가 브라우저에서 직접 Veo/Flow 제작 → 스튜디오는 진행현황 추적 + 완성본 업로드만.
서여리 차별화 요소가 "대부분 영상으로 움직이는 실사 장면"이라 LF는 영상 비중 높게, IG는 낮게.

- **`src/lib/videoPolicy.js` (신규)** — `finishMode.js`와 같은 패턴.
  - `resolveVideoPolicy(episode)` → `episode.videoPolicy` 우선, 없으면 contentType:
    LF→`video-first`, SF→`mixed`, 그 외(IG_R/IG_P/IG_S/TK)→`image-first`.
  - `resolveCutVideoMode(cut, episode)` → `veo`|`motion`|`still`. 우선순위: `cut.videoMode`
    명시 > GRAPHIC/CAPCUT/BROLL은 항상 `motion` > 정책 + 대사유무.
    video-first: 대사있으면 veo/없으면 motion · mixed: veo/still · image-first: motion/still.
  - `needsManualVideo(cut, episode)` = `resolveCutVideoMode === 'veo'`.
- **proxy.js**
  - `GET /api/episode-video-checklist?epNum` — `{policy, contentType, total, veoNeeded,
    veoDone, cuts:[{no, cutType, videoMode, needsManualVideo, cutMark, dialogue, narration,
    videoPrompt, duration, startFrame, hasImage/hasAudio/hasVideo, g2, g4}]}`. startFrame =
    G2 선택 이미지(flowDir) 또는 `cut_NN(_a).jpg`.
  - `POST /api/upload-cut-video?epNum=&cutNo=&trimTo=&keepAudio=1` — raw body 스트림,
    ffmpeg로 1080×1920 cover 정규화 + `-t trimTo` 트림 + (keepAudio=1이면 aac 유지/아니면 -an),
    `cut_NN.mp4` 저장, `recordCutMotion(method:'veo-manual', baked:true)` 기록.
  - `serverVideoPolicy`/`serverCutVideoMode` — videoPolicy.js 서버 사본(동기 유지).
  - `/api/run-video`, `mcp /studio-run-g4`, MCP 도구 `studio_run_g4` → **DEPRECATED 주석**.
    수동 재시도용으로만 남김, 파이프라인 자동 호출 없음.
- **VideoTab.jsx** — 스크롤 상단에 "영상 체크리스트" 접이식 패널. 정책·veoNeeded/Done 표시,
  컷별 `videoMode` 셀렉트(→ `UPDATE_CUT {videoMode}`), veo 컷은 "VP 복사" · "시작 프레임 저장"
  (`<a download>`) · "Veo 오디오 유지(립싱크)" 체크(기본=대사 유무) · "완성본 mp4 업로드".
- **pipeline-leader.js** — **G2·G4 둘 다** 자동 트리거 블록 제거(G2는 커밋 `<G2fix>`에서).
  `stageInRange('g2'|'g4')`면 "수동 제작 대기 — 컷 N,M" 로그만. `g2/g4InFlight`·`*StartedAt`·
  `*_TIMEOUT_MS` 죽은 코드 정리. "승인대기" 알림(hasImage/hasVideo && !g2/g4)은 유지.
- `mcp /studio-run-g2`·`studio_run_g2`도 DEPRECATED 표기. 수동 재시도용만.

### 이미지·영상 수동 전환 후 나머지 파이프라인 자동화 상태 (2026-09-02 점검 + 실측)
- **자동으로 도는 것**: G1 대본생성(script_generator.py)+사람승인 · G3 TTS(ElevenLabs API 직접,
  이미지와 독립 — 대사만 있으면 병렬 진행) · 메이킹 탭 GRAPHIC/CAPCUT/BROLL 컷(Flow/Veo 안 씀,
  직접 `cut_NN.mp4`) · editIntent·컷싱크(`cut-timing`, 영상+오디오 있어야 측정) ·
  G5 편집메타→SRT→concat(전 컷 g4 승인 시) · `assemble_making_film`/`run-cutter`.
- **게이트는 사람 대기로 정상**: G2 승인 없으면 다음 단계 대기, G4 승인 없으면 G5 대기 — 올바른 동작.
- **의존성**: G3는 G2 불필요(병렬 가능) / G5·컷싱크는 수동 영상 업로드가 선행돼야 함.
- **버그 발견+수정 (`<G3fix>`)**: `pipeline-leader.isG3Complete`가 `c.dialogue`(원문)를 봤는데
  MCP 페이로드는 `c.hasDialogue`(불리언)만 줌 → 항상 "G3 완료"로 오판 → 리더가 TTS를 영영
  자동 트리거 안 했음. `hasDialogue`/`hasNarration`로 수정. LF_T01 실측: 수정 후 리더가
  TTS 2건 생성 → `seoyeori/YU/LF_T/LF_T01/03_audio/cut_0N.mp3` 정상.
- **미해결(사소, 기존)**: 멀티스피커 대사(`지아 "..." / 여리 "..."`)를 TTS가 화자명·`/`까지
  읽음. 화자별 분리 TTS나 라벨 스트립 필요 — 별건.

### R99/R03 파이프라인 테스트 (2026-09-03)
**1차(R99, R03)**: 이미지·영상을 더미로 채워 배관/게이팅/파서 로직만 검증 → 보고를
"성공/생성"으로 과장했다가 정정(R99는 스크립트만, R03은 스크립트+실제 TTS만 남기고 정리).
**2차(R03)**: `make_graphic_cut` MCP로 GRAPHIC/CAPCUT 컷 실제 자동 생성 + 사용자 Veo 클립 →
진짜 60초 `ep98_raw.mp4` 완주 (아래 R03 항목 참조).
→ 스튜디오 자동화는 있고 동작함. GRAPHIC/CAPCUT(html모드)=`make_graphic_cut`,
BROLL=`download_broll_cut`, TTS=`studio_run_g3`, concat=`studio_run_g5` 전부 API/헤드리스.
이미지·영상(veo)만 수동.

**R99** (RL02 복제, `ep_test_r99`, 5컷 CAPCUT4+YEORI1, 음성 없음) — 발견·수정한 버그:
- **pipeline-leader가 모든 컷이 G1~G5 다 거친다고 가정** → GRAPHIC/CAPCUT/BROLL 컷도
  "이미지 수동 제작 대기"로 잘못 보고, `isStageComplete`가 영영 false로 매 사이클 재시도.
  → `MAKING_TYPES`(GRAPHIC/CAPCUT/BROLL) · `needsGenImage` · `needsG3` · `stageApplies` ·
  `cutStageDone`(메이킹 컷 g4는 mp4 존재로 완료 취급) 도입.
  · G2 대기 = 생성 이미지 필요 컷만 · "제작" 로그 신규(메이킹 탭 대기, 유형별) ·
    G4 대기 = Veo 필요 컷만 · G5 게이트/승인대기도 메이킹 컷 반영.
- **`studio-run-g5`가 음성 없는 에피소드에서 전체 실패** — SRT 생성이 `audioDir` 없어 404 →
  G5 중단. → 음성 있는 컷 0개면 SRT 생략(자막은 CapCut CP 텍스트로 직접).
- (앞서) `isG3Complete`가 `c.dialogue` vs 페이로드 `c.hasDialogue` 불일치.

더미 입력으로 확인: 파서 컷타입 · 유형별 게이팅 로그 · G5 무음성 SRT 스킵 후 concat 배관 ·
멱등(재실행 "G5 이미 완료"). concat 산출물은 검정 더미 10초 — 내용 무의미.

**R03** (RL03 v3.0, `ep_test_r03`, 7컷 GRAPHIC3+CAPCUT2+YEORI2, 컷1 GRAPHIC+나레이션) —
- **버그**: V3 파서 `inferCutType`이 `[CUT 1]  GRAPHIC — 훅 텍스트` 헤더나 IP의
  "GRAPHIC 타입 — …" 마커를 안 읽어 7컷 전부 YEORI로 파싱(v3.0 포맷). →
  우선순위: ① 헤더 타입 토큰(parseCutHeaderMeta.headerType) ② IP "GRAPHIC|CAPCUT|BROLL 타입"
  / "이미지 생성 불필요" ③ PL 접두사. (`0183988`)
- **2차: 실제 콘텐츠로 완주 (2026-09-03)** — cut 4,5는 사용자가 8s Veo 클립 제작해서
  `04_making/`에 넣음 → `/api/upload-cut-video`로 `05_video/cut_0N.mp4` 정규화(1080×1920).
  cut 1,2,3,6,7은 **`/api/make-graphic-cut`(MCP `make_graphic_cut`)로 자동 생성** —
  htmlFile 생략 시 CP/나레이션으로 검정배경+텍스트 템플릿 자동 채움 → HTML→헤드리스 캡처→mp4.
  G3(cut1 TTS)·G4(cut4,5)·메이킹 컷 자동완료 → **G5 concat → `ep98_raw.mp4` 진짜 60초 3.3MB**
  (스크립트 목표 60s 정확히 일치) + `ep98.srt`.
- **영상 직접 제작 컷 G2 스킵** (`b24f839`): YEORI 컷을 시작프레임 없이 text→video로 만들면
  스틸이 없어 "G2 이미지 대기"로 남던 것 → `stageApplies(c,'g2') = needsGenImage && !hasVideo`.
- **CAPCUT 컷 2,3 = 화면 녹화 대신 HTML 재현 (커밋 `98b612d`)**: Flow/ElevenLabs
  화면을 실제 녹화 안 하고 CSS @keyframes 재현 HTML(`01_script/rl03_screen.html`)을
  `make_graphic_cut`(htmlFile + motion=type-in)이 프레임 단위 캡처 → cut_02(9s, Flow 프롬프트
  타이핑+이미지 그리드 스크롤) · cut_03(14s, ElevenLabs 타이핑+재생+파형+"⚠Adam(남성)" 반전+💧).
  벤더 UI 의존 없음, 결정적. 가이드·예시 = `app/assets/screen-scenario/`.
- **R03 최종**: 7컷 전부 실제 → G5 재concat `ep98_raw.mp4` **정확히 60.0초** (script 목표 일치).
  cut1(5s auto텍스트)·cut2(9s Flow재현)·cut3(14s ElevenLabs재현)·cut4·5(7·8s 사용자 Veo)·
  cut6·7(8·9s auto텍스트) + ep98.srt(cut1 나레이션).
- **남은 것**: pipeline-leader가 GRAPHIC/CAPCUT 컷에 `make_graphic_cut`을 자동 호출하도록 배선
  (현재는 MakingTab UI 또는 수동 curl). 화면 재현 HTML은 컷마다 손으로 작성(템플릿화 여지).

### 실제 화면조작+녹화 모듈형 아키텍처 (2026-09-03, `8916822`)
HTML 재현(위) 말고 **실제 사이트를 조작·녹화**할 때. `app/scripts/screen-scenario/`:
- **시나리오 = 도구 무관 액션 JSON** (`scenarios/*.json`): `{action:'type', target:'text_field',
  text, cps}` 등. `target`은 `selectors` 맵으로 해석(브라우저=CSS/xpath/text,
  pyautogui=image/coord). 실행엔진만 바꾸면 다른 도구로.
- **Driver 교체가능** (`registry.js` 한 줄 + `Driver` 상속): `puppeteer` 구현,
  playwright/pyautogui는 클래스만 추가. `execute(step, selectors)` action별 매핑.
- **Recorder 교체가능**: `native`(page.screencast, 검증됨) / `gdigrab`(ffmpeg 창·영역) /
  `gamebar`(Win+Alt+R) / `obs`(WebSocket v5).
- `node scripts/screen-scenario/run.js <s.json> --ep 98 --cut 3 [--driver x --recorder y --debug-port N]`
  → `mediaPaths.videoDir(ep)/cut_NN.mp4` 정규화 저장.
- **target 자동 접속 (`2504cff`)**: 시나리오 `"target":"flow"|"elevenlabs"|{tool,path}` →
  새 Chrome 대신 **디버깅 Chrome(9222, 로그인된 flow 프로필)에 접속**(connectBrowser 패턴),
  도구 탭 재사용/새 탭. `{url}`/`{html}`이면 격리된 새 Chrome. teardown은 disconnect(안 닫음).
- 검증: `_selftest`(launch+native) 통과 · connect 모드(9222 Chrome → elevenlabs 탭 접속·생성) 확인.
  실사이트 셀렉터·gamebar/obs는 실기. connect+native는 불안정 → gdigrab.

### 메이킹 탭 '자동 녹화' 배선 (2026-09-03, 커밋 `8f15ef8`)
- **proxy**: `GET /api/screen-scenario/list?epNum&cutNo` — `scenarios/*.json` + 에피소드
  `01_script/*.json` 스캔, `for:{cut,episodeCode}`로 컷 매칭(`matched`) 표시. `POST
  /api/screen-scenario` — `run.js` spawn, 진행상황 SSE(`start/log/result/done`), 종료 0이면
  `recordCutMotion(...,{method:'screen-scenario',baked:true})` + `videoUrl`.
- **MakingTab**: CAPCUT 컷 record 모드에 "시나리오 자동 녹화" 패널 — 시나리오 select(자동
  매칭 선택)·↻·**자동 녹화** 버튼, 실시간 로그(`<pre>`), 완료 영상 미리보기(`<video>`).
  record 라디오 선택 시 목록 로드. 완료 후 videoStatus 폴링이 g4 자동 마킹.
- **시나리오 매핑**: `rl03_cut2_flow.json`→컷2, `rl03_cut3_elevenlabs.json`→컷3
  (`for:{cut,episodeCode:"IG_R03"}`).
### 녹화 방식 근본 수정 — CDP screencast (2026-09-03, 커밋 `3016d13`)
- **문제**: 8f15ef8의 gdigrab 검증은 틀렸음. gdigrab은 **데스크톱 좌표 영역**을 캡처 →
  그 자리에 다른 창(파일 탐색기 등)이 있으면 그게 녹화됨. `cut_02.mp4`가 Flow가 아닌
  탐색기 화면이었음. "파일 크기만으로 검증"도 오류(엉뚱한 창도 파일은 생성됨).
- **해결**: `recorder:"native"` 를 **CDP `Page.startScreencast`** 로 재구현(puppeteer 드라이버
  `nativeRecorder()`). 렌더러가 그리는 **페이지 픽셀을 직접** 수신 → OS 창 z-order·포커스·
  겹친 창·Chrome이 최상위가 아님 전부 무관(탭이 자기 창의 활성 탭이면 됨). 프레임별 수신
  타임스탬프로 concat → 고정 fps 정규화. connect 모드 기본 레코더로 채택.
- **내용 검증 단계 추가**(`runner.verifyContent`): 결과 mp4에서 10/50/90% 지점 프레임 3장
  추출 → JPEG 크기로 단색/빈 화면 판별(peak <5KB면 실패로 throw). 중간 프레임을
  `cut_NN_verify.jpg` 로 남김. SSE `done`에 `verifyUrl`·`verify`, MakingTab이 썸네일 표시.
- **proxy 버그**: `req.on('close')`가 최신 Node에서 "요청 본문 수신 완료"에도 발생 → 스폰
  직후 자식 kill(그래서 버튼 경로가 애초에 동작 안 했음). `res.on('close')` + `!writableEnded`
  체크로 수정.
- gdigrab는 잔존(브라우저 크롬/OS UI 녹화용): region + 짝수 픽셀 보정 + stop() 다단계.
- **검증(실측)**: IG_R03 컷2 — proxy `POST /api/screen-scenario` → connect 모드 Flow 탭
  → CDP screencast → 1080×1920 9s `cut_02.mp4`. **추출 프레임 육안 확인 = Google Flow
  웹 UI**(좌측 네비·서여리 이미지 그리드·프롬프트바). 프레임 JPEG ~230KB(단색 아님).

### screen-scenario 안정화 (2026-09-03~04, 커밋 `ec7f892`)
- `puppeteer.connect()` 하드 타임아웃 40s + 1회 재시도 → 실패 시 "디버깅 Chrome 재시작" 안내(hint).
- **프레임 하트비트**: `Page.startScreencast` 는 화면 변화 시에만 프레임을 줌 → 정적 wait 구간에
  결과 영상이 짧아짐. 130ms 갭이면 `Page.captureScreenshot` 강제(최소 ~8fps). duration 정확.
- **선택 스텝**: `step.optional=true` 면 실패해도 계속(재생 버튼처럼 생성 여부에 따라 없을 수 있는 것).
- `rl03_cut3_elevenlabs`: 한국어 UI 셀렉터('주요 텍스트 영역' / '음성 생성'), 로그인 필요.

### connect 8분→1초 — cdp 드라이버 (2026-09-03, 커밋 `eb5f4b2`)
- **문제**: `puppeteer.connect()` 가 브라우저 전체 attach 하면서 Flow/ElevenLabs 의
  stripe·recaptcha OOPIF·service_worker 에 붙으려다 **간헐적으로 수 분(실측 8분+) 멈춤**.
  MakingTab 버튼이 얼어붙은 것처럼 보임.
- **해결: `drivers/cdp-page.js`** — puppeteer 안 거치고 **대상 탭 하나의 CDP WebSocket**
  (`ws://…/devtools/page/<id>`)에만 직결. Page/Runtime/Input/DOM 도메인만. Node 전역
  WebSocket(무의존) + 최소 CDP JSON-RPC 클라이언트 내장. click=요소 중심좌표→
  `Input.dispatchMouseEvent`, type=`execCommand(selectAll→delete)`+`Input.insertText` 한 글자씩.
  nativeRecorder=`Page.startScreencast`+하트비트. teardown=소켓만 닫음(탭 유지).
  `registry`: connect 모드(target:'flow'|'elevenlabs') **기본 드라이버 = cdp**.
- `runner.normalize`: `fit='contain'` 추가(데스크톱 웹앱은 잘림 없이 흰 배경 레터박스),
  connect 모드 기본 contain.
- **검증(실측 IG_R03 cut3)**: connect **1초** · 실제 ElevenLabs 텍스트 음성 변환 페이지 ·
  서여리 보이스 · 텍스트 정상 입력 · '음성 생성' 클릭 → **실제 생성 트리거**('음성 다시 생성'
  상태, 플레이어 오디오 로드) · 1080×1920 16s `cut_03.mp4` · 프레임 육안 확인.
- **CUT 2(Flow)**: Flow 탭이 **프로젝트 안**(`.../flow/project/…`)에 있어야 프롬프트 입력창
  존재. 랜딩/목록 페이지면 실패. Flow 생산 경로는 결정적 `rl03_screen.html` 유지.
- **start_gen.bat 재작성**: LF→**CRLF**(LF면 cmd 괄호블록/for 루프 깨져 **클릭 즉시 종료**),
  ASCII 전용, 프로필 경로 드라이버와 일치(`downloads/flow/chrome-profile-main`),
  `timeout`→`ping`(stdin 안전). `.gitattributes`에 `*.bat eol=crlf` 강제.

### 릴스 최종화 모듈 (2026-09-03~04, 커밋 `d3f8c79` → `dc3fa71`)
파싱된 컷 + `05_video/cut_NN.mp4` → **컷별 편집 판단 → 자막 번인 → SFX → `07_output/{CODE}_final.mp4`**.
- **`server/lib/reelFinalize.js`**:
  - `decideCut(cut)`: **fit**(화면녹화 SP=IN.SC/SH_SCR → 레터박스 contain, 나머지 채움 cover)
    · **caption**(CP 있고 SH_TEXT 그래픽 아니면 번인; " / " 세그먼트 분할, "N단계:" 제거,
    화살표에서 줄바꿈; 반전 MD SUR→COM/"잠깐"이면 멀티세그의 **펀치라인 세그만 빨강** Punch)
    · **sfx**(대본 "효과음:" 키워드 → `_shared/sfx` 매핑: 타이핑/깜짝반전/분할전환/팝업/클릭/
    whoosh/긴장/글리치; "정적 N초"·"없음" → 없음)
  - `enrichCutsFromScript(cuts, raw)`: **scriptParserV3 가 v3.0 포맷**(오디오 헤더 콜론 없음,
    BGM 열0, CP 가 KR 블록에만)에서 **놓치는 CP·오디오를 raw 에서 직접 보강**. 파서 자체는 안 건드림.
  - 규격화(fit별) → concat → `.ass` 번인 → SFX/BGM `amix`. `{CODE}_finalize.json` 매니페스트
    (컷별 판단 내역) + `{CODE}_captions.ass`. `06_publishing/ep{N}_raw.mp4` 도 최신 concat 갱신.
  - BGM: `bgmFile` 파라미터 또는 `_shared/bgm` 자동. 없으면 스킵+매니페스트 기록.
  - ⚠ `ff()` 헬퍼 `-y` 필수 — 없으면 "Overwrite? [y/N]" 에서 영구 정지(실측 10분 행).
- **proxy**: `GET /api/reel-finalize/plan?epNum`(판단만) · `POST /api/reel-finalize {epNum,bgmFile?}`(SSE).
- **MakingTab**: "🎬 릴스 최종본" 카드(메이킹 필름 조립 아래) — "컷별 판단 미리보기"(테이블) +
  "릴스 최종본 생성"(SSE 로그 + 영상).
- **검증(IG_R03 실측)**: 63s 1080×1920, 자막 6개 번인, SFX 4개, 26초 소요. cut3 punchline
  "잠깐, 남자 목소리?!" 빨강 렌더·cut2 레터박스·cut1/7 자막 skip 프레임 육안 확인.
- **레퍼런스 스타일 반영**(2026-09-04, 커밋 `0752a62`): 손제작 R03 `0808.mp4` 대조 →
  자막 폰트 `Gaegu` 손글씨체 · `"..."` 래핑 · 멀티세그 누적 스택.
- **SFX 전면 확장 + 자막 컬러 이모지**(2026-09-04, 커밋 `dc3fa71`):
  · `SFX_RULES` 8→60개+ ("AI연구소 효과음 모음집" 가이드 = `_shared/sfx/SFX_GUIDE.md`,
    10개 카테고리 전 파일 매핑). `decideCut` 이 "효과음:" 필드 + SC/MD 추론. 같은 파일 3회+
    금지(SFX_ALTS 변주), 자연소리 layer(-18dB, 컷 길이 페이드).
  · **자막 = handwriting_overlay.py 경로**(captionMode 'overlay', 기본). libass 대신 PIL 로
    렌더 → **컬러 이모지·손글씨체·데코 스티커(♡✨💧)**. 실패 시 ass 폴백. `enrichCutsFromScript`
    가 대본 "손글씨 오버레이" 섹션에서 말풍선/색/데코 힌트 추출. `backing:false`(판/비네트 없이
    흰 손글씨 + 외곽선). `handwriting_overlay.py` 에 `"signature":false`(채널 프레임 생략) 옵션.
  · 검증(IG_R03): cut2 ✨ · cut3 😱🎙️💧 컬러 렌더, 배경 워시아웃 없음.
- 남은 것: BGM 트랙 자산(CapCut) · 웹툰 GRAPHIC 소스(cut6/7) · 말풍선/데코 배치 미세조정 ·
  회상 진입/종료 SFX 페어링·빌드업 시퀀스(가이드 팁, 미구현).

### 실행 이원화 (커밋 `8bf37b1`, 재작성 `eb5f4b2`)
- **`start_yeori.bat`** (제작 코어): git sync · TREND RADAR(:3000) · Cloudflare Tunnel ·
  **task-queue-worker**(에이전트, 신규) · `npm run studio`(:3001+:5173) · 제작 탭(스튜디오/커터/
  매트릭스/트렌드)을 기본 브라우저로. **Flow Chrome 안 엶.**
- **`start_gen.bat`** (생성/편집): 제작 코어 `:3001` 확인 · Chrome 디버깅 세션(9222,
  `--user-data-dir=downloads/flow/chrome-profile-main` — **cdp 드라이버가 접속하는 그 프로필**)로
  Flow + ElevenLabs + 스튜디오 탭 · CapCut. 서버·git 없음. 루트 래퍼도 추가.
- ⚠ **CRLF 필수**(`eb5f4b2`): LF 줄바꿈이면 cmd 가 `if()` 괄호블록·`for` 루프를 못 파싱해
  **더블클릭 즉시 종료**. `.gitattributes` `*.bat *.cmd eol=crlf` 로 강제. ASCII 전용,
  `timeout`→`ping`(stdin 안전). `app/start_yeori.bat`·`sync-content.bat` 도 CRLF 로 정규화.
- 백업: 구 통합본은 git 히스토리(`fa7508d` 직전).

**이월/다음**:
- **Gemini 이미지 자동 생성 브로커** — 이미지는 자동 유지 방침이나 `api/gemini.js`가 아직
  레퍼런스 이미지 파트 미지원(text-only). `/api/generate-cut` + Vercel US 릴레이 + StudioTab
  버튼 재연결 필요. 미착수.
- **도구 실행 이원화** — ✅ 완료(`8bf37b1`/`eb5f4b2`). 큐 폴더 OneDrive 동기 방식은 미채택
  (대신 화면 자동화 = screen-scenario + cdp 드라이버).
- **유료 Veo API**(~$32~80/mo) / Google AI Pro $19.99/mo 구독 결정 — 보류("당분간 수동").
- LF_T01(서여리+한지아) 실사용 테스트는 이미지 생성 경로 정리 후.
- **BGM 트랙 자산** — `_shared/bgm/` 비어있음. 로파이 트랙 몇 개 넣으면 릴스 최종화가 자동 믹싱
  (`bgmFile` 파라미터·자동탐색 배선됨, -18dB 루프+페이드).
- **릴스 최종화 다음** — 말풍선/데코 배치 미세조정 · 회상 진입/종료 SFX 페어링 · drum roll→impact
  빌드업 시퀀스(효과음 가이드 심화 팁) · 웹툰 GRAPHIC 컷 소스 품질(`make_graphic_cut`).
- **screen-scenario 다음** — Flow 실사이트 셀렉터는 프로젝트 페이지 기준으로 실기 검증 필요
  (Flow 생산은 결정적 `rl03_screen.html` 유지) · gamebar/obs 레코더 실기 미검증.

### 남은 후보
- ScriptGen 캐릭터 UI(목록·상태·새 캐릭터 추가), 컷 카드 CH 옆 인물 뱃지
- editIntent를 메이킹 탭 모션(graphicMotionVf/s2cImageVf)에도 연동(assemble 경로) — v2
- editIntent에 transition/filter 추가 → CapCut CDP 세미오토 연동
- run-cutter가 여전히 에피소드 통짜 실행 — 컷 단위 재조립은 별개 과제
- 데스크톱 CapCut 자동 내보내기(CLI 부재로 화면자동화뿐, 현실적으로 사람이 Export)

---

## 2026-09-02 (downloads 폴더 위계 개편 v3 — 브랜드/플랫폼/시리즈/코드/번호폴더)

**동기**: `C:\yeori-studio\downloads` 최상위에 에피소드 산출물(`flow/audio/video/making/output/
final/deliverables/script`) + 공유 라이브러리(`sfx/hooks/flow-character`) + 앱 상태 json +
디버그 잡동사니가 위계 없이 40개 뒤섞여 있었음. 목표 = 스튜디오 관련 단일 위계.

**커밋 이력 (시간순)**:
`43f7421` P1(아카이브+P2·3 설계) → `56482c2` P2 proxy.js → `c7961ed`(auto-sync에 P2 scripts 14개)
→ `5288d13` P2 scripts+client 마무리 → `416614b` P3 준비(migrate 스크립트) →
`92bfe42` P3 실행(--go 173건 + HIER=true) → `686c717` startFrame URL 수정 →
`b5ee823` setup.bat → `3de9e42` STATUS → `f8bc545` 코드 중복 방지 가드 → `419d7f8` STATUS.

### Phase 1 — 잡동사니 아카이브 (완료 `43f7421`, 코드 변경 0)
`downloads/_archive/2026-09-02/`로 이동(삭제 안 함, 총 238MB):
- `logs/` — bisect*.log, start_yeori_*.log(6), px*.log(10), temp_capcut_chrome_launch.log
- `capcut-debug/` — capcut_*.png(7), capcut_spec*.json(3)
- `misc/` — out.txt, worker-test.txt, gpoints.json.backup-preflight-2026-08-02,
  studio-state.json(루트 stale — 라이브는 `app/studio-state.json`)
- 디렉터리 — `temp_capcut/`, `pixverse/`, `Creative studio/`(53MB), `scripts/`(test 파일 1개),
  `_archive_2026-08-15/`(107MB)
- `legacy-subdirs/` — `flow/OLD`, `flow/ep99_*_backup`(4), `audio/OLD`, `video/OLD`, `output/OLD`

루트 40개 → 19개. **건드리지 않은 라이브 파일**: `gpoints.json`, `trend_episodes.json`,
`code-task-queue.json`, `credit-usage-today.json`, `task-queue-worker.log`, `_app-data/`(secrets 포함),
실제 에피소드 폴더 전부(SF_E01 포함). git-tracked 44개(`downloads/flow/` 루트 얼굴 레퍼런스 등)
이동 없음 → `git status` clean. proxy 스모크(health/video-checklist/trend-episodes) 통과.

### Phase 2 — 경로 조립 일원화 (완료, 커밋 56482c2·c7961ed·5288d13)
`path.join(MEDIA_ROOT,'downloads',...)` 직접 조립 ~375곳을 `server/lib/mediaPaths.js` +
`src/lib/mediaPaths.js` 헬퍼 경유로 전환(`HIER=false`, 동작 불변). proxy.js 95곳 자동
치환 + 잔여 수동, scripts/*.js 14개(auto-sync에 휩쓸림), 클라 탭(EditMetaTab/MakingTab/
ExtractTab). `/api/sfx-catalog`·`/api/bgm-library`가 item.path/t.file을 현재 구조 상대경로로
재작성. 클라 `epMediaUrl(episode, kind)`.

### Phase 3 — episodes/{code}/ 위계 + 마이그레이션 (커밋 416614b·92bfe42·686c717·b5ee823)
1차 목표였던 `downloads/episodes/{code}/{images,audio,...}` 구조로 173건 이동.
→ **곧바로 v2로 재개편됨(아래).** epKey() number→code 매핑, downloads/ git 추적 해제,
코드 중복 방지 가드(`f8bc545`)는 v2에서도 그대로 유효.

### 구조 v2 — 플랫폼/시리즈/코드/번호폴더 (커밋 `e3583e5`, 사용자 리뷰 반영)
`node scripts/migrate-downloads-v2.js --go` (31건, episodes/{code}/{sub} → 아래). 최종:
```
downloads/
├── YU/                     유튜브
│   ├── SF_E/{SF_E01,..}    (숏폼 에피소드)   LF_E/  (롱폼 에피소드)
│   └── SF_T/  LF_T/{LF_T01,..}                (트렌드)
├── IG/                     인스타그램
│   └── IG_P/ IG_R/{IG_R02,..} IG_S/ IG_T/     (피드/릴스/스토리/트렌드릴스)
├── TK/                     틱톡 (빈 폴더, 규칙 미정)
├── _etc/{code}/            패턴 안 맞는 옛/테스트 (ep3·ep4·ep98·ep100·ep998·epT02·
│                            TEST_OVERLAY·IG_RL_E02·test_chat_flow)
├── library/{characters, sfx, hooks, hw_stills}
├── runtime/{prompts.json, video-prompts.json}
├── state/{gpoints, trend_episodes, code-task-queue, credit-usage-today,
│          capcut_config, yeori_edit_meta, migrate-manifest(+v2)}.json
├── flow/chrome-profile-*   ← 이동 안 함(실행중 잠김 + 실행 단축키 연동)
├── insta/{FD,RL,PT,ST}/{num}/  ← 구 "인스타 번호" 시스템, 이번 개편에서 안 건드림
└── _archive/2026-09-02/
```
각 `{code}/` 안 (워크플로 순서, `NN_` 언더스코어 프리픽스):
```
01_script  02_images  03_audio  04_making  05_video  06_publishing  07_output
  06_publishing = 구 output/(cutter_input·CapCut·raw) + deliverables/(하위폴더)
  07_output     = 구 final/(완성본 mp4·썸네일·업로드 패키지) — "퍼블리싱 단계의 결과물"
```
- **코드 → 경로**: `mediaPaths.parseCode()` = `/^(SF|LF|IG|TK)_([A-Z])(\d{2,})/`.
  `SF|LF→YU, IG→IG, TK→TK` 플랫폼. series = 코드에서 숫자 뗀 것(`LF_T01`→`LF_T`).
  안 맞으면 `_etc/{code}/`. 서버 `instanceDir(epRef)` / 클라 `instanceUrl(episode)`.
- 호출부는 여전히 `epNum` 그대로 넘김 — 헬퍼가 number→code→platform/series 해석.
- 에피소드 코드 형식도 이에 맞춤 — `EPISODE_CODE_RE = /^(SF|LF|IG|TK)_([ETPRS])(\d{2,})/`
  (`659a6c9`, 구 `_E` 형식은 LEGACY 정규식으로 계속 허용). `formatEpisodeCode('IG_R',2)`→`IG_R02`.

### 구조 v3 — 브랜드 래퍼 (커밋 `3ebd7f6`, 미래 멀티브랜드 대비)
`migrate-downloads-v3.js --go` (8건). v2 구조를 `downloads/seoyeori/` 아래로:
```
downloads/
├── seoyeori/{YU,IG,TK,_etc}/…        콘텐츠 (v2 구조 그대로, 브랜드 하위로)
│   └── characters/  hw_stills/        브랜드별 (캐릭터 레퍼런스)
├── _shared/{sfx, hooks}              브랜드 무관 공용 (구 library/)
├── runtime/  state/  flow/  insta/   전역·불변
```
- `mediaPaths.js`: `export const BRAND='seoyeori'`. `instanceDir/instanceUrl`에 브랜드
  세그먼트. `charactersDir/hwStillsDir`→브랜드 하위, `sfxDir/hooksDir`→`_shared/`.
  `sfxFile/bgmFile` 접두어 매칭에 `_shared/`·`library/`(레거시)·bare 모두 허용.
  vestigial HIER 분기 전부 제거.
- **state는 여전히 전역** — 진짜 멀티브랜드는 studio-state.json/gpoints 상태 계층까지
  나눠야 함(폴더 정리와 별개, 그때 착수).
- **되돌리기**: `migrate-downloads-v3.js --undo` → `-v2 --undo` → mediaPaths.js revert.
- **스모크 통과**: scan-media(ep2→`seoyeori/IG/IG_R/IG_R02/02_images`) + video-checklist +
  sfx-catalog(→`_shared/sfx/..`) + 정적파일(`seoyeori/characters`, `_shared/sfx`) 200 + build.
- **insta 서브시스템 통합 (커밋 `c1825b0`)**: 별도 `downloads/insta/{content}/{num}/`
  폐기 → `seoyeori/IG/{series}/{code}/`. `mediaPaths.instaCode(content,num)` = `IG_{K}{NN}`
  (FD/PT→P, RL→R, ST→S). `instaDir()`는 시그니처 유지하고 새 위치로 리다이렉트 —
  proxy의 `isInsta` 분기 ~20곳이 코드 삭제 없이 자동 적용. `migrate-insta.js --go`(14건).
  RL02(=라이브 IG_R02의 구 아티팩트)의 DM 목업·G1 스크립트가 `IG_R02/01_script/`로 병합.
  + Phase2 때 놓친 클라 하드코딩 URL 5곳(StudioTab·VideoTab) 정리, `/api/ffmpeg`가
  `workDir` 대신 `epNum` 받도록.
- **미해결**: `state` 계층 멀티브랜드화(별도 작업). `TK/` 틱톡 코드 규칙.

---

## 2026-09-05 (그래픽 카드 생성기 + LF_T01 초상권 리스크 정리)

### 그래픽 카드 생성기 (신규)
- **`server/lib/graphicTemplates.js`**(`d39b442`) — 템플릿(카테고리) × 스타일 조합으로
  1920×1080 HTML 카드를 생성하는 순수 함수 모듈. `generateHTML(type, style, fields, duration)` /
  `getRecommendation(mdCode)` / `getTemplateList()`.
  - `mv-intro`(neon-dark/pastel-dream/bold-impact) — 무드 인트로, beam+particle 애니메이션.
  - `text-card`(minimal/gradient/dark-minimal) — 일반 텍스트 카드.
  - `stat-card`(infographic/versus) — 통계·비교.
  - `info-source`(`12b2df6`, news-light/news-dark) — **실존 그룹 사실 정보 카드**. "ℹ️ 정보
    제공 목적의 인용" 문구를 fields가 아니라 템플릿에 고정 — 사람이 빼먹을 수 있는 자리에
    안 둠. 채우는 건 title/fact1~3/source뿐.
  - `fiction-disclaimer`(`1477dd2`, notice-dark/notice-light) — **가상 설정 고지 카드**.
    "이 영상은 AI로 제작된 가상의 이야기입니다…" 면책 문구를 통째로 템플릿에 고정.
    title/subtitle(에피소드 설정 설명)만 채움.
- **proxy.js 라우트 3개**(`d39b442`) — `GET /api/graphic-templates`(목록),
  `POST /api/generate-graphic-html`(HTML 생성 → `01_script/cut_NN_graphic.html` 저장,
  `autoGenerate:true`면 `makeGraphicCutForMcp()` 직접 호출해 컷까지 완성 — 기존
  `/api/make-graphic-cut`과 같은 내부 함수 재사용, 자기 자신에 HTTP 왕복 안 함),
  `GET /api/graphic-recommend?md=`(추천).
- **MakingTab.jsx `GraphicCardGenerator`**(`d39b442`) — CAPCUT 컷 카드(`renderCapcutPanel`)
  안에 렌더링. 템플릿·스타일 선택 → 필드 입력 → 미리보기 없이 바로 "생성 + 영상 변환".
  `YEORI_SERVER` 절대경로 fetch, `cutDuration(cut)` 헬퍼 재사용, CSS는 `index.css` 실제
  토큰(`--accent`/`--bg-panel` 등) 사용 — 이 파일 스타일 관례와 일치시킴.
- **MD 무드 자동추천 버그 수정**(`fa85cfa`) — 처음엔 `cut.md`를 봤는데 실제로는
  `cut.masterCode.md`에 있었음(대본 원문 "MD:" 필드 → `ScriptGenTab.jsx:359` 파싱 →
  `masterCode.md`, `MakingTab.jsx:750`의 `c.masterCode?.pl`과 같은 자리). `MD_RECOMMEND`도
  `app/data/codebook.json`의 실제 8종(JOY/SUR/STR/REL/CUR/DRM/SAD/INT)으로 재정비 —
  이전에 있던 `MD_COM`/`MD_EMO`는 codebook에 없는, 지어낸 코드였음.
- **설계 원칙 문서**(`app/server/lib/graphicTemplates.md`, `1477dd2`) — 템플릿을 계속
  늘려갈 예정이라 기준을 코드 옆에 문서화: 실존 인물 재현 금지, 컴플라이언스 문구는
  fields 아닌 템플릿 고정, MD 코드는 codebook.json 8종만, 공통 구조(캔버스/폰트/애니메이션),
  추가 전 체크리스트.

### LF_T01 배경장면 — 초상권/부정경쟁방지법 리스크 검토
`downloads/seoyeori/YU/LF_T/LF_T01/배경장면/`에 있던 AI 생성 배경 영상 3개
(Katseye_performing…, ILLIT_concert_performance…, Group_performing_with_blurred_figures…)를
프레임 캡처해서 검토:
- **문제**: 실제 무대 스크린에 "KATSEYE", "ILLIT · IT'S ME"(실제 곡명까지)가 그대로 노출.
  얼굴 블러는 있었지만 브랜드 텍스트가 그대로라 식별 가능성 자체가 안 없어짐.
- **법적 근거**: 부정경쟁방지법 2조(식별 표지 무단 상업적 이용) + 2025년 실제 판례 분석
  — 식별 가능성은 얼굴이 아니라 "헤어스타일+의상+배경+맥락" 결합으로 판단, 프롬프트에
  실명이 있으면 의도성 증거, 민사 위자료 최대 2천만원 사례 있음. 대사 속 실명 언급은
  별개 법리(명예훼손 — 사실 서술이면 안전)라 그대로 유지 가능.
- **해결 방향**: 배경장면 프롬프트에서 실존 그룹명을 빼고 "한국 유명 걸그룹" 같은 **장르
  단위**로 서술. 실제 재생성 결과(대형 라인업 실루엣, 로고 없는 추상 LED 패턴) 확인함 —
  브랜드 노출 없이도 "여러 그룹이 합동 무대에 섰다"는 설정을 인원 규모로 시각화해 오히려
  스토리텔링이 명확해짐.
- **⚠️ 정정(같은 날, 세션 후반)**: 이 에피소드를 "가상 콜라보 설정"으로 전제하고 위
  결론(+`fiction-disclaimer` 템플릿)을 냈는데, 확인해보니 틀렸음. 마스터코드
  `[LF_TREND_01] :: [YR_VD] :: [LOOK_ST01] ICONIC BY MISTAKE`가 가리키는 그대로,
  **KATSEYE×LE SSERAFIM×ILLIT "ICONIC BY MISTAKE"는 실제 협업 디지털 싱글**
  (2026.06.12 발매). KATSEYE 커뮤니티 매니저 명의 공식 Weverse 공지(`weverse.io/katseye/
  notice/36522`)에 발매 정보 + 공식 유튜브 MV 링크가 그대로 있음 — 허구 아니라 실제 뉴스.
  - 비주얼 원칙(실명·로고 없이 프롬프트)은 **그대로 유효** — 뉴스가 진짜여도 AI로 그들의
    가짜 공연 장면을 사진처럼 재현하는 문제는 별개(초상권은 사실 여부와 무관하게 적용).
  - 다만 고지 카드는 `fiction-disclaimer`가 아니라 **`info-source`가 정답** — "ICONIC BY
    MISTAKE · 2026.06.12 발매 · 출처: KATSEYE 공식 Weverse 공지" 식으로.
  - 진짜 공식 MV가 있으니 AI 재연 자체가 불필요할 수 있음 — 링크·사실을 그래픽 카드로
    전달하거나, 저작권법 28조 인용 요건(최소 분량 + 명확한 해설 맥락) 지켜서 짧은 구간만
    화면녹화로 인용하는 것도 검토 가능(단, `yt-dlp` 전체 다운로드는 여전히 안 됨 — 유튜브
    약관 위반은 뉴스 진위와 무관한 별개 문제).
- **남은 일**: 원래 KATSEYE/ILLIT 배경 영상 2개를 실명·로고 없는 버전으로 교체 + 위 정정
  반영해 `info-source` 카드로 발매 사실 안내 추가 검토.

### flow-automation / sync 버그 2건
- **캐릭터 라벨 정규식**(`app/scripts/flow-automation.js`, `0944980`) — `injectCharacterDescriptors()`의
  `labelRe`가 `WOMAN\s*\d+\s*\(...)`  라 숫자 라벨("WOMAN 1")만 받았음. "WOMAN LEFT (Jia):" /
  "WOMAN RIGHT (Yeori):"는 매칭 실패 → 전체 폴백 모드로 빠져 두 인물 descriptor가 각자
  라벨 옆이 아니라 프롬프트 맨 앞에 뭉쳐 붙음. 여리는 본문에 얼굴 묘사가 없고 이 주입
  descriptor에만 의존해서, 사실상 얼굴 정보가 사라지는 결과로 이어졌음(LF_T01 2인 장면
  생성 시 발견). `WOMAN\s*[\w-]*\s*\(...)` 로 확장 — 숫자/LEFT·RIGHT/빈값 모두 받음,
  기존 포맷 회귀 없음(실제 characters.json 데이터로 재현 테스트 완료).
- **sync-content.bat 무한 대기**(`3bfcd05`) — Flow 자동화 크롬(`chrome-profile-main`,
  `--remote-debugging-port=9222`)이 종료 안 된 채 `downloads/` robocopy가 돌면,
  `crashpad_handler.exe`가 `CrashpadMetrics.pma`를 계속 잡고 있어 "Access denied → 30초
  대기 → 재시도"가 무한 반복 → `start_yeori.bat`의 `[pre-2] Sync on start` 단계에서
  영구 정지. 해당 프로필에 묶인 프로세스 15개 종료 + robocopy에 `chrome-profile-main`
  `/XD` 제외(살아있는 브라우저 세션이라 애초에 동기화 대상이 아님).

