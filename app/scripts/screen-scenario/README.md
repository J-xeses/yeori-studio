# screen-scenario — 생성도구 액션 재현 + 화면 녹화 (모듈형)

CUT 2·3 같은 "Flow 화면"/"ElevenLabs 화면" 컷을, **도구에 종속되지 않는 시나리오**로
정의하고, **교체 가능한 드라이버·레코더**로 실행해 mp4로 만든다.

> 결정적이고 벤더 UI에 안 깨지는 버전은 `../../assets/screen-scenario/`(HTML 재현 +
> `make_graphic_cut`). 이 디렉터리는 **실제 화면을 조작하고 녹화**하는 방식.

```
scenario (JSON, 액션 시퀀스)  ──►  Runner  ──►  Driver   (화면 조작: puppeteer | playwright | pyautogui)
                                     └────►  Recorder (화면 녹화: native | gdigrab | gamebar | obs)
                                     └────►  ffmpeg 정규화 → cut_NN.mp4
```

## 도구 탭 자동 접속 (target 별칭)

`target` 이 문자열이면 **새 Chrome 대신 이미 떠 있는 디버깅 Chrome**(포트 9222,
로그인된 flow-automation 프로필 `downloads/flow/chrome-profile-main`)에 붙는다 —
`flow-automation.js connectBrowser()` 패턴 그대로. 해당 도구 탭을 찾으면 재사용, 없으면 새 탭.

| target | 접속 | 탭 판별 |
|---|---|---|
| `"flow"` | `labs.google/fx/ko/tools/flow` | `labs.google/(fx\|flow)` |
| `"elevenlabs"` | `elevenlabs.io/app/speech-synthesis` | `elevenlabs.io/(app\|sign)` |
| `{ "tool":"elevenlabs", "path":"/app/..." }` | tool + 특정 경로 | 〃 |
| `{ "url":"..." }` / `{ "html":"..." }` | 새 Chrome(격리, 로그인 없음) | — |

- Chrome이 9222로 안 떠 있으면 실행 명령을 출력하고 종료. `start_gen.bat`이 이 방식으로 띄움.
- teardown 시 사용자 Chrome은 **닫지 않고** 연결만 해제(`disconnect`).
- `--debug-port N` 으로 포트 변경(서브 계정 9223 등).
- ⚠ connect 모드 + `native` 녹화는 불안정 → `gdigrab`/`gamebar`/`obs` 사용.

## 1. 시나리오 = 도구 무관 액션 (요구사항 2)

`scenarios/*.json` — 어떤 도구로 실행하든 동일:

```jsonc
{
  "id": "rl03_cut3_elevenlabs",
  "driver": "puppeteer",          // 기본값, --driver로 override
  "recorder": "native",          // 기본값, --recorder로 override
  "duration": 14,                 // 최종 컷 길이(초) — ffmpeg 트림
  "viewport": { "width": 1080, "height": 1920 },
  "target": { "url": "https://elevenlabs.io/...", "waitUntil": "networkidle2" },
  "record":  { "fps": 30, "windowTitle": "ElevenLabs", "windowPosition": {"x":40,"y":20} },
  "selectors": {                  // target 이름 → 도구별 지정자
    "text_field": "textarea",                    // 브라우저: CSS
    "generate_btn": { "text": "Generate" },      //           또는 {text}/{xpath}
    "play_btn": "button[aria-label*='play' i]"
    // pyautogui 라면: { "image": "templates/play.png" } 또는 { "x": 540, "y": 900 }
  },
  "steps": [
    { "action": "wait", "ms": 2000 },
    { "action": "type", "target": "text_field", "text": "안녕하세요...", "cps": 10 },
    { "action": "click", "target": "generate_btn" },
    { "action": "wait", "ms": 6000 },
    { "action": "click", "target": "play_btn" },
    { "action": "wait", "ms": 4000 }
  ]
}
```

**액션 어휘** (`drivers/base.js` 참고): `goto` `wait`(`{ms}`|`{for}`) `waitFor` `type`(`cps`=초당 글자수)
`setValue` `click` `hover` `scroll`(`by`,`duration`) `key` `screenshot`.

## 2. 드라이버 교체/추가 (요구사항 1)

`registry.js`의 `DRIVERS` 맵에 한 줄. 구현은 `Driver`(`drivers/base.js`) 상속 →
`setup()` / `execute(step, selectors)` / `teardown()` / (선택) `nativeRecorder()` / `windowBounds()`.

- **puppeteer** — 구현됨 (`drivers/puppeteer.js`). native 녹화(page.screencast) 제공.
- **playwright** — `drivers/playwright.js` 추가 + 등록. execute()의 action별 매핑만 다름.
- **pyautogui** — `drivers/pyautogui.js`가 `spawn('python', ['exec.py'])` 로 파이썬 헬퍼를
  띄우고 액션을 JSON 라인으로 파이프. selectors는 image/coord 기반.

## 3. 레코더 교체/추가 (요구사항 3)

`registry.js`의 `RECORDERS` 맵. 구현은 `Recorder`(`recorders/base.js`) 상속 → `start(outPath, spec)` / `stop()`.

| 레코더 | 방식 | 비고 |
|---|---|---|
| `native` | 드라이버 자체 녹화 (puppeteer `page.screencast`) | 창 없어도 됨, 가장 안정. **자체 검증 통과** |
| `gdigrab` | `ffmpeg -f gdigrab` (창 제목 또는 데스크톱 영역) | headful 필요. runner가 `driver.windowBounds()`로 영역 지정 |
| `gamebar` | Windows 게임 바 `Win+Alt+R` | 설정 0·GPU 인코딩. 타이밍 부정확, 결과는 `Videos\Captures`에서 최신 파일 이동 |
| `obs` | OBS WebSocket v5 (`StartRecord`) | `npm i obs-websocket-js` + OBS 씬 사전 구성. `--obs-url/-pass/-scene` |

## 실행

```bash
# 자체 검증 (외부 사이트/로그인 없음, 새 headless Chrome + native)
node scripts/screen-scenario/run.js _selftest.json --out out.mp4

# 실제 사이트 — 먼저 디버깅 Chrome을 로그인된 프로필로 띄워둘 것 (start_gen.bat):
#   "chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\yeori-studio\downloads\flow\chrome-profile-main"
node scripts/screen-scenario/run.js rl03_cut3_elevenlabs.json --ep 98 --cut 3

# --ep N --cut N  → mediaPaths.videoDir(ep)/cut_NN.mp4 로 저장(스튜디오 파이프라인 경로)
# --driver / --recorder / --debug-port / --user-data-dir 로 override
```

## 한계 / TODO

- 실제 사이트 시나리오의 `selectors`는 벤더 UI 변경 시 갱신 필요(그래서 결정적 버전은
  HTML 재현). puppeteer 로그인 세션 = `--driverOpts`로 `userDataDir` 전달하도록 확장 여지.
- `gdigrab`/`gamebar`는 헤드리스 CI에서 검증 불가 — 실기에서만.
- pipeline-leader가 CAPCUT(record) 컷에 대해 이 러너를 자동 호출하도록 배선(현재 수동).
