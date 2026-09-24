# start_yeori.bat 운영 메모

`start_yeori.bat`(루트 → `app/start_yeori.bat` 호출)은 **ASCII 전용**으로 유지한다. 예전 한글 주석·안내문은 이 문서로 옮겼다.

## 왜 한글을 뺐나 (2026-09-24)
cmd.exe 는 배치 파일을 한 줄씩 실행하면서 "파일의 몇 번째 바이트까지 읽었는지"를 기억했다가 다시 읽는다. UTF-8 한글(글자당 3바이트)이 섞이면 이 위치 계산이 어긋나 **뒤따르는 명령 줄이 중간부터 잘려 실행**된다. 실측 결과:
- `[5] Git pull` 의 `git -c http.lowSpeedLimit=...` 줄이 `'.lowSpeedLimit' is not recognized` 로 깨짐 → **git pull 이 조용히 실행되지 않고 있었음**.
- READY 안내 문구 줄들도 잘려서 오류 메시지로 출력됨.
- `chcp 65001` 을 맨 앞에 넣어도 해결되지 않음(위치 계산 문제라 코드페이지와 무관).
- 같은 날 만든 `ref-grab.bat` 도 같은 이유로 링크 입력 줄이 깨졌었음 → 한글 입출력을 Node 스크립트(`ref-grab.mjs --interactive`)로 옮기고 bat 는 영문 4줄로.

**규칙:** 새 .bat 는 영문(ASCII)만. 한글 안내가 필요하면 Node/PowerShell 스크립트 안에서 출력.
남은 한글 bat: `app/setup.bat`(49줄), `app/sync-content.bat`(2줄) — 같은 위험이 있으니 손볼 때 같이 정리.

## 단계별 이력
1. **백그라운드 서비스:** proxy(:3001)+vite(:5173), Cloudflare 터널, 워커, 자동 동기화는 Windows 작업 스케줄러가 로그온 시 자동 시작 + 죽으면 재시작(`ensure-yeori-tasks.ps1`). 이 bat 는 확인/시작만 하고 서버를 붙잡고 있지 않는다. 최초 1회 등록은 `install-services.bat`(관리자).
2. **프록시 대기가 git pull 보다 먼저 (2026-09-20):** 예전엔 git pull 이 먼저였는데, 네트워크 문제로 git pull 이 멈추면 뒤의 프록시 대기·브라우저 탭 열기가 통째로 막혔다(실측: 터널 창만 뜨고 탭이 하나도 안 열림). "코드를 최신으로"는 "도구 탭을 연다"와 무관하므로 git pull 을 맨 뒤로 옮겼다.
3. **트렌드 레이더(:3000):** 스케줄에 없는 별도 UI 라 여기서만 띄운다. 위치가 PC 마다 달라 여러 후보 경로를 순서대로 찾는다.
4. **브라우저 탭 (2026-09-24):** 도구들을 Chrome **새 창 하나**에 탭으로 모아 연다(성준님 요청) — 스튜디오, 인스타 운영실, 레퍼런스 보드, 커터, 콘텐츠 매트릭스, 트렌드 레이더. 레퍼런스 보드는 file:// 대신 proxy 정적 경로(/downloads)로 연다(브라우저 열기 버튼이 같은 출처로 동작). Chrome 이 없으면 기본 브라우저로 하나씩.
5. **git pull:** 전송이 15초 넘게 1KB/s 밑이면 자동 포기(`http.lowSpeedLimit/Time`, 2026-09-20).
6. **OneDrive 콘텐츠 동기화 중단 (2026-09-17):** 회사 PC 를 더 이상 안 써서 양방향 동기화가 불필요. `sync-content.bat` 는 남겨뒀으니 필요하면 호출 줄만 되살리면 된다. 중단 이유: robocopy 가 /PURGE 없이 양방향으로 돌아 로컬에서 지운 파일이 며칠 뒤 OneDrive 사본에서 되살아났음.

## 참고
- 생성/편집(Flow/CapCut/ElevenLabs)은 `start_gen.bat`.
- 서비스 완전 정지: `schtasks /end /tn YeoriStudio` (그리고 `YeoriMcpTunnel`).
