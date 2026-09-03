# 생성도구 액션 장면 재현 (screen-scenario)

CUT 2·3 같은 "Flow 화면녹화" / "ElevenLabs 화면" 컷을 **실제 화면 녹화 없이** HTML
애니메이션 재현으로 만든다. 벤더 UI에 의존하지 않아 결정적이고 안 깨진다.

## 원리

`make_graphic_cut`(server/proxy.js `runGraphicCapture`)가:
1. puppeteer로 HTML을 로드하고 `document.getAnimations()`를 pause
2. 프레임마다 `animation.currentTime`을 수동 진행하며 스크린샷 (dur × 30fps 장)
3. ffmpeg로 mp4 합성

→ HTML에 CSS `@keyframes` 애니메이션만 있으면 그게 프레임 단위로 캡처된다.

## 규칙

- `.phone-wrap` 하나 = 컷 하나. 안에 `<span class="label">CUT N …</span>` 필수
  (`isolateCutInHtml`이 `^CUT\s*N\b`로 매칭, 나머지 wrap은 `display:none`).
- body는 1080×1920. 각 wrap이 그 안을 채우도록.
- 모든 움직임은 **CSS animation** (`animation: name Ns ...`). JS 런타임 로직 금지
  (캡처 루프는 class 토글 안 함 — 상태 변화도 keyframe으로).
- 애니메이션 길이 = 컷 길이(스크립트 DU)에 맞춰 `step-end`/`ease` keyframe으로 타이밍.
- 무한 반복(`infinite`)도 OK (currentTime이 phase로 wrap됨) — 파형 등.

## 호출

```
POST /api/make-graphic-cut
{ "epNum": 98, "cutNo": 2, "htmlFile": "rl03_screen.html", "motion": "type-in" }
```
- `htmlFile`: `01_script/`에 둔 파일명 (`list_episode_html_sources`로 확인)
- `motion`: `ANIMATED_MOTIONS`(`type-in`/`rise`/`pop`/`word-rise`) 중 하나여야
  프레임별 캡처 경로가 켜진다. 커스텀 HTML엔 `.main-text`가 없어 이 motion의
  자동 템플릿 CSS는 무영향, HTML 자체 애니메이션만 캡처됨.

## 예시

`example_rl03_flow_elevenlabs.html` — RL03 CUT 2(Flow 프롬프트 입력 + 이미지 그리드
스크롤) / CUT 3(ElevenLabs 타이핑 + 재생 + 파형 + "남자 목소리?!" 반전).
실제 사용본은 `downloads/seoyeori/IG/IG_R/IG_R03/01_script/rl03_screen.html`(gitignore).

## 한계 / TODO

- 썸네일·인물은 CSS 실루엣 placeholder. 실제 캐릭터 이미지를 쓰려면 data-URI 임베드나
  `/downloads/library/characters/` URL(프록시 떠 있을 때).
- 완전 무인 파이프라인에 넣으려면 pipeline-leader가 CAPCUT/GRAPHIC 컷에 대해
  `make_graphic_cut`을 자동 호출하도록 배선 필요 (현재는 MakingTab UI/수동 호출).
