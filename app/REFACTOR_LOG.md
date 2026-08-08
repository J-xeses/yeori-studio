# 에피소드 식별자 리팩터 — 진행 로그

정식 에피소드 코드(예: `SF_E01_SHOE`)를 유일한 식별자로 통일하는 리팩터의 진행 상황을 라운드별로 기록합니다.
전체 배경/설계 결정은 `C:\Users\user\.claude\plans\dazzling-twirling-cocoa.md` 참고.

## 왜 하는가

- 지금 에피소드/컷 식별자가 3개 따로 존재함: `episodeId`(내부 타임스탬프), `episode.number`(자동증가 숫자, 파일경로에 사용), `episode.masterCode`(사람이 붙이는 자유 텍스트 코드). 서로 검증 없이 따로 놀아서 실제 드리프트 발견됨.
- `downloads/gpoints.json`이 `cut_N` 키만 쓰고 에피소드 구분이 없어서, 두 에피소드에 같은 컷 번호가 있으면 서로 덮어씀.
- 해결 방향: 정식 코드를 유일한 식별자로 승격 — 폴더명/gpoints 키/MCP 파라미터 전부 이 코드로 통일.

## 라운드 진행 상황

### 1차: 공유 유틸리티 신설 — 완료 (2026-08-02)
- [x] `server/lib/episodeCode.js` — `validateEpisodeCode`/`parseEpisodeCode`, node로 직접 실행해 검증
- [x] `server/lib/mediaPaths.js` — `flowDir`/`videoDir`/`audioDir`/`outputDir`/`cutFile`
- [x] `src/lib/episodeCode.js` — 서버판과 동일 로직
- [x] `src/lib/mediaPaths.js` — `flowUrl`/`videoUrl`/`audioUrl`
- 순수 신규 파일만 추가, 기존 코드 무변경 확인됨(문법 검사만 통과, 아직 아무 곳에서도 import 안 함)

### 2차: gpoints.json 재구조화 — 완료 (2026-08-02)
- [x] `src/lib/gpoints.js` — `setGPoint/setGPoints/getGPoint/getGPointSummary`에 `episodeCode` 인자 추가, 저장 구조 `{[episodeCode]: {cut_N: {...}}}`로 변경. 구버전 평면 데이터는 `_LEGACY` 키로 보존.
- [x] 클라이언트 호출부 갱신 — `StudioTab.jsx`(12곳), `TTSTab.jsx`(2곳), `VideoTab.jsx`(4곳), `ExtractTab.jsx`(1곳), `EditMetaTab.jsx`(4곳), `ScriptGenTab.jsx`(13곳), `EpisodeInfoSidebar.jsx`(1곳). 전부 임시로 `String(episode.number)`를 episodeCode 자리에 전달.
  - **버그 발견 및 수정**: `ScriptGenTab.jsx`의 "에피소드 목록" 사이드바가 여러 에피소드를 동시에 순회하면서 전부 활성 에피소드 하나의 g데이터만 참조하고 있었음 — 실제로 살아있던 크로스 에피소드 버그였음(각 `ep` 자신의 번호로 스코핑하도록 수정, `epGpKey` 변수 도입).
  - **부수 버그 수정**: `EditMetaTab.jsx:175`가 존재하지 않는 `state.episodeNo`를 참조해서 항상 `ep00`으로 저장되던 죽은 참조를 `episodeCode`로 수정.
- [x] 서버 `proxy.js` — `loadGpointsFile`(평면→`_LEGACY` 1회 마이그레이션 포함)/`saveGpointsFile`/`approveGForCuts`(episodeCode 인자 추가)/`studio-approve-g2`/`buildStudioStatusPayload` 전부 `[episodeCode][cut_N]` 키로 변경.
  - **버그 발견 및 수정**: `export_pipeline` 엔드포인트가 `studio-state.json`에 존재하지도 않는 `state.gData`를 읽어서(클라이언트가 그 필드에 쓴 적이 없음) 항상 빈 값 취급되던 버그를 발견 — 실제 `gpoints.json`을 읽도록 수정.
- [x] `scripts/video-automation.js`의 `getSelectedImageFilename(cutNo)` → `(episodeCode, cutNo)`.

### 검증 — 완료 (2026-08-02)
- **실데이터 보존**: 기존 평면 `gpoints.json`(ep4 실제 컷1~8 + 무관한 레거시 컷9~19 혼재)을 백업(`downloads/gpoints.json.backup-preflight-2026-08-02`) 후, 컷1~8은 `"4"`(ep4의 실제 episode.number) 키로, 나머지는 `_LEGACY`로 정밀 이관. 서버 재시작 후 `/api/studio-status-public`으로 재확인한 결과 `g1:8, g3:8, g4:7` — 마이그레이션 전과 완전히 동일하게 나옴.
- **격리 버그 회귀 테스트**: `approveGForCuts` 로직을 독립 스크립트로 재현해 서로 다른 코드(`TEST_A`, `TEST_B`)가 같은 컷 번호(`cut_1`)를 가져도 서로의 상태에 영향 없음을 확인(PASS).
- **클라이언트**: `npm run dev`로 실행 후 대본생성 탭 진입, 에피소드 목록 사이드바 펼침(수정한 크로스 에피소드 버그 코드 경로 직접 노출), G1 승인 버튼 클릭까지 — 콘솔 에러 없음. `localStorage['aca_gpoints_v1']`가 정확히 `{"1":{"cut_1":{"g1":true,...}}}` 형태로 기록됨을 확인.
- 검증 중 발견: 테스트 vite 인스턴스가 우연히 5174 포트로 떴는데, proxy.js의 CORS 화이트리스트(5173/3000/null)에 없어서 서버 동기화 POST가 막힘 — 덕분에 실제 gpoints.json 파일이 테스트로 인해 덮어써지는 사고 없이 보호됨(설계상 의도치 않은 안전장치였을 뿐, 별도 조치 불필요).

### 3차: episode.code 필드 정식 도입 — 완료 (2026-08-04, 커밋 `fe94711`)

설계안: `C:\Users\user\.claude\plans\composed-wandering-newt.md`. 확정 결정 — `state.episodes`는 내부 id(`ep_<timestamp>`) 키를 유지(재구성 안 함), `episode.code`(생성 시 필수, 사용자 입력)와 `episode.masterCode`(대본 파싱, 표시용)는 별개 필드로 공존.

**A. episode.code 생성 UI + 검증, 클라이언트 표시/키 통합:**
- `src/lib/episodeCode.js`: `formatEpisodeCode(contentType, number, slug)`(포맷 조립), `displayEpisodeCode(episode)`(배지/파일명용 — code 우선, 없으면 즉석 조립), `resolveEpisodeCode(episode, fallback)`(gpoints/MCP 키용 — code 우선, 없으면 기존 과도기 방식 `String(number)`로 정확히 대체) 3개 헬퍼 추가.
- `server/lib/episodeCode.js`: 동일 역할의 `resolveEpisodeCode(episode, fallbackId)` 추가.
- `src/context/AppContext.jsx`: `makeEpisode`가 `opts.contentType`/`opts.code`를 받도록 변경, `ADD_EPISODE` reducer가 `action.contentType`/`action.code`를 그대로 episode에 반영, `RENUMBER_EPISODE`의 로컬 중복 `epCode` 함수를 `formatEpisodeCode`로 교체(번호 변경은 여전히 가능하지만 `episode.code`는 건드리지 않음 — 생성 시 고정된 정식 식별자로 유지).
- `src/App.jsx`: "+ 새 에피소드 추가"가 즉시 생성 대신 인라인 폼(콘텐츠유형 드롭다운 + 슬러그 입력 + 코드 미리보기)으로 바뀜. `validateEpisodeCode` 형식 검증 + 전체 에피소드 대상 코드 중복 검사 통과해야 생성됨.
- 중복돼 있던 표시용 코드 포맷 함수 4곳(`App.jsx`/`EpisodeInfoSidebar.jsx`/`ScriptGenTab.jsx`/`AppContext.jsx` reducer)을 전부 `formatEpisodeCode`/`displayEpisodeCode`로 교체.
- **당초 설계 범위를 넘어 추가로 발견/수정한 것(구현 중 필수로 드러남):** gpoints.json 키로 쓰이는 클라이언트 `episodeCode` 지역변수가 7개 파일(`StudioTab`/`TTSTab`/`VideoTab`/`ExtractTab`/`EditMetaTab`/`ScriptGenTab`/`EpisodeInfoSidebar`)에 `String(episode?.number ?? '')`로 하드코딩돼 있었음 — 이걸 안 고치면 새로 만든 `episode.code`가 실제로는 아무 데도 안 쓰이는 죽은 필드가 됨. 전부 `resolveEpisodeCode(episode)`로 교체. **주의(중요):** 이 과정에서 `resolveEpisodeCode`(키용, code 없으면 `String(number)`)와 `displayEpisodeCode`(표시용, code 없으면 조립된 문자열)를 명확히 분리해야 했음 — 처음에 하나로 합쳤다가, 레거시 에피소드(ep4 등, code 필드 없음)의 gpoints 키가 기존 `"4"`에서 `"LF_E04"`로 바뀌어버려 기존 데이터와 끊기는 회귀를 발견하고 바로잡음.

**B. masterCode 불일치 경고:**
- `src/components/EpisodeInfoSidebar.jsx`의 `EpisodeOverviewBlock`(모든 탭이 공유하는 읽기전용 개요 블록) — "마스터 코드" 섹션에 `episode.code`와 `episode.masterCode`가 다르면 `⚠️ 에피소드 코드(...)와 다릅니다` 경고를 인라인으로 표시. 어느 쪽 값도 건드리지 않음(표시만).
- `server/proxy.js`의 `studio-upload-script` 핸들러 응답에 `codeMismatch: boolean` 필드 추가.
- `server/mcp-server.js`/`api/mcp.js`의 `studio_upload_script` 케이스가 `codeMismatch`면 안내문을 응답 텍스트에 덧붙임.

**C. 서버 episodeCode 계산 통합:**
- `server/proxy.js`에 흩어져 있던 `episodeCode = String(ep.episode?.number ?? episodeId)` 중복 계산 7곳(export_pipeline, studio-approve-g1/g3/g4, studio-approve-g2, studio-run-g4, buildStudioStatusPayload)을 전부 `server/lib/episodeCode.js`의 `resolveEpisodeCode(ep.episode, episodeId)`로 교체. `buildStudioStatusPayload`가 반환하는 `episode` 객체는 이미 전체 episode를 그대로 포함하므로 `episode.code`도 자동으로 응답에 실림(별도 필드 추가 불필요 확인).

**검증 — 완료 (2026-08-04):**
- `npm run build` 통과(문법/임포트 오류 없음, A/B/C 전체 반영 후 최종 재확인).
- 실제 `npm run studio`(proxy+vite)로 서버 기동 후 Claude-in-Chrome으로 브라우저 직접 조작:
  - 레거시 ep4(episode.code 없음)가 `LF_E04`로 정상 표시되고 크래시 없음, `/api/studio-status-public?episodeId=...`로 정상 조회됨을 확인(회귀 없음).
  - "+ 새 에피소드 추가" 폼에서 슬러그에 특수문자(`test-slug!`) 입력 시 코드 미리보기가 `LF_E05_TESTSLUG`로 자동 정제(대문자화, 비허용 문자 제거)되는 것 확인.
  - 생성 후 실제 `episode.code`가 저장되고 새 컷 7개가 정확히 빈 상태로 생성됨을 localStorage/DOM 직접 조회로 확인(스크린샷 일부가 이전 화면 잔상을 보여주는 캡처 타이밍 이슈가 있어 DOM 조회로 교차검증함).
  - 중복 코드 검사 로직(`Object.values(episodes).some(e => e.episode?.code === code)`)이 실제 상태 기준으로 정확히 중복을 감지함을 확인.
  - 서버 studio-state.json을 직접 패치해 masterCode를 episode.code와 다르게 만든 뒤, 스튜디오 탭에서 `⚠️ 에피소드 코드(LF_E05_TESTSLUG)와 다릅니다` 경고가 정확히 렌더링되는 것을 DOM에서 확인.
  - 테스트로 만든 에피소드(LF_E05_TESTSLUG)와 주입한 masterCode는 검증 후 studio-state.json에서 직접 제거해 정리, activeEpisodeId를 ep4로 복원.

**⚠️ 검증 중 발견한 심각한 기존 버그(3차 범위 밖, 실제 데이터 손실 발생 — 사용자 승인 하에 복구함):**
`src/lib/gpoints.js`의 `syncToServer()`가 G포인트 변경 시마다 브라우저 `localStorage` 전체를 `POST /api/gpoints`로 서버에 보내는데, 서버(`proxy.js`의 `POST /api/gpoints`)는 이걸 **병합이 아니라 무조건 덮어쓰기**한다. 반대로 클라이언트가 서버의 최신 gpoints를 읽어와 localStorage를 채우는 경로(`GET /api/gpoints` 호출)는 어디에도 없다. 이번 검증을 위해 연 브라우저 탭에 (다운 사고 전 세션의) 오래된 gpoints 캐시가 남아있었고, 탭에서 페이지가 로드/조작될 때마다 그 오래된 캐시가 서버 파일을 덮어써 ep4의 실제 g1(8컷)/g4(7컷) 승인 기록이 두 차례 사라짐(g3만 남음). `downloads/gpoints.json.backup-preflight-2026-08-02` 백업으로 정확히 복구했고(g1:8, g3:8, g4:7 — 마이그레이션 직후 기록과 완전히 동일하게 확인), 원인이 된 브라우저 탭을 닫은 뒤 35초간 데이터가 안정적으로 유지되는 것까지 확인함. 이 리스크는 2026-08-02 라운드에서 이미 "다음에 논의 필요"로 남겨뒀던 것이 이번에 실제로 발생한 것 — **다음 세션에서 반드시 별도로 다뤄야 함**(예: `POST /api/gpoints`를 병합 방식으로 바꾸거나, 클라이언트가 마운트 시 서버 최신값으로 localStorage를 먼저 채우도록 수정).

### 2026-08-08: 회사 PC↔집 PC 동기화 + 신규 에피소드 생성 버그 3건 수정

**회사 PC 커밋 동기화:** 8/3~8/4에 회사 PC에서 push된 커밋 2개(`5748fd1` UI 통일 라운드 2단계, `38d94b7` 일일 크레딧 탭)가 집 PC에 한 번도 pull된 적이 없어 갈라져 있던 것을 발견 — `git merge origin/master`로 병합(충돌 3건 수동 해결: App.jsx/EpisodeInfoSidebar.jsx/ScriptGenTab.jsx, 회사 PC가 아직 옛 gpoints 3-arg 시그니처를 쓰던 부분을 전부 resolveEpisodeCode 기준으로 맞춤), push 완료.

**사용자가 실사용 중 리포트한 버그 3건, 전부 원인 확인 후 수정:**
1. **인스타 릴스 새 에피소드 생성 시 내용이 "Shoe로 하드카피된 것처럼" 보임** — 실제로는 `episode.cuts`가 데이터로 복사된 게 아니라, "마스터 코드로 대본 생성" 텍스트영역의 **placeholder**(회색 예시 텍스트)가 실제 운영 데이터인 SF_E01_SHOE의 진짜 마스터 코드를 그대로 하드코딩해서 쓰고 있었음 — 값은 비어있는데(`value: ""`) 언뜻 보면 채워진 것처럼 보여서 오해를 일으킴. `ScriptGenTab.jsx`의 placeholder 앞에 "예)" 접두어 추가. **추가로 발견한 진짜 버그**: 이 텍스트영역의 로컬 state(`masterCode`/`mcPreview`/`mcMeta` 등)는 이 탭이 에피소드를 전환해도 언마운트되지 않아 전 에피소드 입력값이 그대로 남아있었음(사용자가 실제로 타이핑했다면 정말로 새 에피소드에 엉뚱한 대본을 생성시킬 수 있었던 잠재 버그) — `activeEpisodeId` 변경 시 이 패널을 비우는 `useEffect` 추가.
2. **"새 에피소드 추가" 팝업에서 드롭다운 텍스트가 안 보임** — 네이티브 `<select>`가 열릴 때 일부 브라우저는 `<select>` 자체의 색 지정을 팝업 옵션 목록에 상속하지 않고 OS 기본값(밝은 배경)으로 그리는데, 이 앱의 `--text`(#f0eeff, 거의 흰색)가 그 위에 그대로 적용돼 흰 배경에 흰 글씨가 됨. `<option>` 각각에 명시적으로 `background`/`color` 지정해서 해결.
3. **코드 번호가 예상과 다름(예: 기존 LF 에피소드가 있는데 첫 인스타 릴스가 E01이 아니라 이상한 번호로 보임)** — 조사 결과 기존 설계가 **전체 에피소드 통합 번호**(모든 콘텐츠유형 합쳐서 최댓값+1)였음이 원인. 사용자 확인 후 **콘텐츠유형별 독립 번호**로 전환(`App.jsx`의 `nextNumber`, `AppContext.jsx`의 `ADD_EPISODE` reducer 둘 다 `contentType`으로 필터링 후 최댓값+1). **트레이드오프 승인받음**: `episode.number`가 이제 서로 다른 유형끼리 같은 값을 가질 수 있게 됐는데, `downloads/{flow,video,audio}/ep{number}/` 파일 경로가 아직 `episode.number` 기준이라(4차 이전) LF_E01과 IG_R_E01이 동시에 존재하면 실제 생성 파일이 같은 폴더를 공유해 덮어쓸 위험이 있음 — **4차(파일경로 전면 교체)의 우선순위가 이 변경으로 인해 실질적으로 올라갔다.**

**✅ gpoints 동기화 "마지막 쓰기 승리" 버그 — 이번에 실제로 고침(더 이상 다음 세션으로 미루지 않음):** 위 3번 버그를 브라우저에서 검증하는 도중 이 버그가 또 발생해서(2026-08-04에 이어 두 번째, `downloads/gpoints.json.backup-preflight-2026-08-02` 패턴으로 복구) 더 이상 미룰 수 없다고 판단해 즉시 수정. `server/proxy.js`의 `POST /api/gpoints`가 요청 바디로 파일을 통째로 덮어쓰던 것을, 신규 `mergeGpointsData(existing, incoming)` 함수로 **컷 단위 `updatedAt` 타임스탬프 비교 병합**으로 교체 — 들어온 컷이 디스크에 있는 컷보다 같거나 더 최신이면 그것만 반영, 아니면 디스크 버전 유지. curl로 직접 검증: (a) 오래된 타임스탬프(2020년)로 조작한 스테일 payload를 보냈더니 서버가 정확히 거부하고 기존 최신 데이터를 그대로 유지함, (b) 진짜 최신 타임스탬프로 보낸 변경은 정상 반영됨, (c) payload에 언급 안 된 다른 컷은 전혀 건드리지 않음. 이제 오래된 브라우저 탭이 열려도 서버의 최신 진행상황을 지울 수 없다.

**검증:** `npm run build` 통과. Claude-in-Chrome으로 실제 브라우저 조작해서 3개 버그 수정 전부 라이브 확인(IG_R 선택 시 `코드: IG_R_E01` 정상 표시, LF 선택 시 독립적으로 `LF_E05` 유지, 마스터 코드 placeholder에 "예)" 접두어 확인, 에피소드 전환 시 마스터 코드 입력값 정상 초기화 확인). ep4의 gpoints는 최종적으로 g1:8/g3:8/g4:7로 정상 복구된 상태.

### 다음 라운드 (3차 이후, 확인 후 별도 진행)
- 4차: 파일시스템 경로 전면 교체 (proxy.js·scripts/*.js·클라이언트 탭들) — **위 8/8 변경으로 우선순위 상향**: episode.number가 콘텐츠유형별 독립이 되면서 서로 다른 유형이 같은 번호를 가질 때 downloads/ep{number}/ 경로가 실제로 충돌할 수 있음.
- 5차: content_matrix_v3.html 쪽 확인
- 6차: 실데이터 이관 (`ep4` → `SF_E01_SHOE` 폴더명 변경 + contentType 드리프트 수정)
- 7차: 부수 버그 정리 (죽은 `src/AppContext.jsx` 삭제, `state.gData` 죽은 참조 수정 등)
- 추가 결정사항: 파이프라인 진입 시(에피소드 코드 확정 시) 대충 순서만 맞춘 파일명을 자동으로 `cut_NN.ext`로 정리하는 정규화 단계 추가 예정(3차 이후 구현)
