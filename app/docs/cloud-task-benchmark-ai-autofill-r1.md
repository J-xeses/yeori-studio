# 클라우드 세션 작업 지시서 — 스토리 아카이브 "연출기법 벤치마킹" AI 자동 입력 (2026-11-04)

> 사용법: claude.ai/code 에서 저장소 **J-xeses/yeori-studio** 로 새 클라우드 세션을 열고, 아래 "지시문" 전체를 붙여 넣는다.
> 작업은 브랜치 `benchmark-ai-autofill-r1` 에서만. 합치기·실서버 확인은 로컬 Claude 가 한다.

---

## 지시문 (여기부터 복사)

This repo (yeori-studio) has a "스토리 아카이브" page (`app/src/tabs/StoryArchiveTab.jsx`) with a "🔎 연출기법 벤치마킹" sub-tab (`BenchmarkTab()` function, search `연출기법·트렌드 벤치마킹 (2026-10-14 신설)` around line ~805). It stores entries `{type:'benchmark', title, description, source, tags}` via `GET/POST /api/story-archive` (`server/proxy.js` ~line 7217-7227, backed by `server/lib/storyArchive.js`'s `listEntries`/`saveEntry`). Today, adding an entry is 100% manual typing (the `adding` form state with 4 plain text inputs: title/description/source/tags).

**Important scoping context** (read, don't skip): this app cannot log into Instagram/social media itself — a human (or a separate Claude session with browser access) has to actually open the link and see the content first. This task is NOT about fetching URLs server-side. It's about removing the *typing* step once someone already has the content in front of them: paste the URL plus whatever text/caption they're looking at, click one button, and have Claude (via this app's own existing Claude API proxy, using the user's own API key — already wired for the "📺 유튜브 분석" sub-tab's AI feature, check how that one calls Claude for the established pattern) extract a clean title/description/tags into the form fields, which the user then reviews and saves exactly as before.

### Read first (do not skip)
- `app/src/tabs/StoryArchiveTab.jsx` — the full `BenchmarkTab()` function (the component to extend) and, for the established "call Claude from this tab" pattern, whichever other inner tab in this same file (e.g. the "📺 유튜브 분석" tab, `YoutubeTab` or similarly named function — search for `claudeMessages` or `/api/claude` usage in this file) already makes a Claude call client-side. Copy its exact pattern: how it gets the API key (likely from a shared studio-state/apiKeys context — find and reuse whatever hook/prop/fetch this file already uses, don't invent a new way to read the key), how it handles the loading/error state, and its visual style (reuse `s.genBtn`/`s.genBtnActive`/`s.fieldGroup` etc. — this file's existing CSS module classes).
- `app/src/lib/api.js` — `claudeMessages(apiKey, body)` (POSTs to `/api/claude/v1/messages`, which `server/proxy.js` (~line 188) proxies straight to Anthropic using the passed key — no server-side key needed, the browser already holds it).
- `app/docs/direction-material-bank.md` and the 5 categories described at its top (AI만 가능한 비주얼 / 구조적 반전 / 채널 고유 시그널 / 감정적 어택 / 포맷 파격) — this benchmark archive is scoped to **implementable direction techniques**, narrower than general trend monitoring (that's a separate "운영실" concern, out of scope here) — use this framing in the extraction prompt so results stay in-scope (a technique description, not a generic trend summary).

### Task
1. In `BenchmarkTab()`'s "+ 자료 추가" form, add a way to paste raw source material alongside the URL: a textarea for "원문 캡션/설명 (붙여넣기)" and, if you judge it's reasonably easy given this file's existing patterns for any file/image upload elsewhere in this app, an optional image attach (data URL) — but **text paste is the required minimum; image attach is a nice-to-have, don't block on it if it adds significant complexity**.
2. Add a "🤖 AI로 자동 채우기" button next to/near the manual fields. On click, call `claudeMessages(apiKey, {...})` with a system/user prompt instructing Claude to read the pasted URL + raw text and extract, in Korean: a short `title` (기법 이름), a `description` (1-3문장, 무엇이고 어디에 쓸 수 있는지 — 일반 트렌드 요약이 아니라 **실제로 구현 가능한 연출기법** 관점으로), and `tags` (3-6개, 쉼표구분 배열). Instruct Claude to respond with JSON only (reuse this file's or `DiagnosisPanel.jsx`'s existing "respond with JSON only" + parsing-recovery conventions if this file doesn't already have one of its own — check both before picking).
3. Parse the response and **prefill the existing form fields** (`adding.title`/`adding.description`/`adding.tags`) — do not auto-save; the user still reviews and clicks the existing "저장" button. `source` stays whatever the user typed (the URL), untouched by the AI step.
4. Handle the no-API-key case the same way this file's other Claude-calling tab already does (reuse its exact error message/UX, don't invent a new one).
5. Loading state: disable the button and show a brief "분석 중..." indicator while the call is in flight (reuse this file's existing loading-state visual convention).

### Hard constraints
- Create branch `benchmark-ai-autofill-r1` from `master`, commit there, push the branch. Never push to or merge into `master`.
- **If the same command fails 3 times in a row, stop immediately, commit whatever is done, and report it instead of retrying further.** Do not loop.
- Change only `app/src/tabs/StoryArchiveTab.jsx` (and its `.module.css` only if a genuinely new visual element needs a class not already covered by existing ones — prefer reusing existing classes). No server-side changes (the existing `/api/claude/*` proxy and `/api/story-archive` endpoints already cover everything needed). No other files, no secrets, no `downloads/` media.
- Do not touch the other inner tabs (유튜브 분석/단편 아이디어/시리즈 기획) or the manual add/save/delete flow's existing behavior — this is additive only: one new button, one new textarea, prefilled fields the user can still edit before saving.
- **You cannot run the dev server, open a browser, or call the real Anthropic API here** (no key). Do static checks only (see Verification). Do not claim a live UI or live-API check.

### Verification (required)
- Run this repo's build/lint command (check `package.json` scripts, e.g. `npm run build` or `npx vite build`) and confirm no errors from your changed file specifically.
- Manually trace the JSON-parsing path with 2-3 example Claude response strings (well-formed, and one with a markdown code fence wrapper if that's a realistic failure mode per the existing parsing-recovery pattern you're reusing) to confirm your parser handles both.
- Confirm the no-API-key path doesn't throw an unhandled error (trace it by hand against the code).

### Report (concise, Korean)
브랜치 + 커밋; 어떤 기존 탭의 Claude 호출 패턴을 그대로 재사용했는지; 추출 프롬프트가 "구현 가능한 연출기법" 관점을 어떻게 반영했는지; 이미지 첨부는 했는지 안 했는지(안 했다면 이유); 빌드 검증 결과; 브라우저로 확인 못 한 부분 명시.

## 지시문 끝
