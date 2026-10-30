# 클라우드 세션 작업 지시서 — 유튜브 운영실 대시보드 고도화 1차 (2026-10-30)

> 사용법: claude.ai/code 에서 저장소 **J-xeses/yeori-studio** 로 새 클라우드 세션을 열고, 아래 "지시문" 전체를 붙여 넣는다.
> 작업은 브랜치 `youtube-ops-dashboard-r1` 에서만. 합치기·실서버 확인은 로컬 Claude 가 한다.

---

## 지시문 (여기부터 복사)

You are extending "서여리 유튜브 운영실", a single-file vanilla-JS dashboard: `app/server/pages/youtube-ops.html` in this repo, backed by `app/server/lib/youtubeOps.js` (data load/save) and the `/api/youtube-ops` route in `app/server/proxy.js`. The page has 4 tabs (⚙️ 설정, 🎯 목표·대시보드, 📈 성과 현황, 🎬 콘텐츠 전략) rendered by `renderSetup()/renderGoal()/renderInsight()/renderStrategy()`, all called from `renderAll()`. Data lives in `downloads/seoyeori/YU/_account/ops.json`, loaded via `GET /api/youtube-ops` and saved via `PUT /api/youtube-ops` with rev-based optimistic concurrency (`saveOps()` in `youtubeOps.js` rejects a stale `rev`). The setup tab and the strategy tab's 경쟁채널/검토로그 sections were just rebuilt (2026-10-30) — follow their exact patterns (`$()`, `esc()`, `touch()`/`save()`, `.card`/`.btn`/`.field`/`.chk` CSS classes, CSS variables under `:root`) for everything you add.

### Hard constraints
- Create branch `youtube-ops-dashboard-r1` from `master`, commit there, push the branch. Never push to or merge into `master` (an hourly bot commits to master; the local Claude merges after live checks).
- **If the same command fails 3 times in a row, stop immediately, commit whatever is done, and report it instead of retrying further.** Do not loop.
- Change only `app/server/pages/youtube-ops.html`, `app/server/lib/youtubeOps.js`, and (only if strictly necessary for a new API field) `app/server/proxy.js`'s `/api/youtube-ops` routes. No other files, no `app/src/`, no `downloads/` media, no secrets.
- No build step, no npm packages, no CDN scripts. Stay vanilla JS/HTML/CSS in the one file. Charts: draw with `<canvas>` 2D context by hand, no chart library. UI copy is Korean, dark theme (reuse existing `:root` CSS variables — never hardcode new colors that don't derive from them).
- **Do not modify the real data file** `downloads/seoyeori/YU/_account/ops.json` directly. Only change the *schema* (new fields with safe defaults) in `defaultOps()` and the backfill guards in `loadOps()` inside `youtubeOps.js`, the same way `keywords`/`residenceCountry`/`competitors` were added there.
- **You cannot reach `localhost:3001`** from this environment (no live server, no browser). Do static checks only (see Verification). Do not attempt to start the server or claim you tested it live.
- The channel currently has **zero published videos** — there is no real analytics data to fetch. Anything "real-time" in this task is a UI shell only: show a last-updated timestamp, a manual refresh button, and a disabled/placeholder polling hook — never wire a real YouTube API call (there's no API key configured yet).

### A. 🎯 목표·대시보드 탭 — 캘린더/플래너
1. **캘린더/플래너 뷰**: a calendar (week or month view, your call — pick whichever fits the existing `.wrap` layout width best) showing `S.posts` entries by their `date` field, grouped/color-coded by `type` (`숏폼(유튜브 전용)` / `숏폼(릴스 교차)` / `롱폼` — the `TYPES` const). Build it fresh for this page's data shape (`id/code/title/type/status/date/...`); do not copy code from `insta-ops.html`, just take visual/structural inspiration from its "30일 캘린더" section if you want.
2. **기본 계획 vs 변경 계획**: add a `planDate` field to each post (first-ever planned date, set once and never overwritten) alongside the existing mutable `date` field. In `youtubeOps.js`'s `syncEpisodesToPosts()`, when a new post is first created, set `planDate = date` (or `''` if no date yet). In the calendar/plan UI, when `date !== planDate` and both are non-empty, visually mark that item as "일정 변경됨" (e.g. a small badge showing the original planned date struck through or an icon) so schedule slips are visible at a glance.
3. **제작여건 모니터링**: add a `production` object to the ops schema (e.g. `{ weeklyCapacity: 0, note: '' }` — manual numeric input for "이번 주 가용 제작 편수" plus a free-text note). Show it as an editable card in the goal tab. Do not call any external credit/API service — manual input only.
4. **콘텐츠 파이프라인 업로드 현황 자동기록**: add a `statusHistory` array field to each post item (e.g. `[{ status, at }]`). Whenever a post's `status` select changes in the UI, push `{ status: newValue, at: new Date().toISOString() }` to that post's `statusHistory` before saving. Add a small "최근 상태 변경" list (last ~10 entries across all posts, newest first) somewhere in the goal tab.
5. **실시간 지표 UI 틀 (shell only)**: in the YPP gauges area, add a "마지막 갱신: [timestamp]" line and a "🔄 새로고침" button that just re-runs the existing `load()`. Add a disabled-looking placeholder note explaining real-time auto-polling will be wired once the channel has published videos and API access — do not implement actual polling/setInterval against a real endpoint; a commented-out or clearly-labeled-inert hook is fine.

### B. 📈 성과 현황 탭 — 집계·그래프
1. **개별 vs 전체 집계**: the tab currently only shows combined KPI totals (`$('ikpis')`). Add a per-`TYPES` subtotal breakdown (e.g. small cards or a compact table: 조회수/시청시간/구독전환 broken down by 숏폼(유튜브전용)/숏폼(릴스교차)/롱폼), in addition to keeping the existing combined totals.
2. **요약 설명**: next to each KPI number, add a short `muted` one-line explanation of what it means (can be a `title=` tooltip or a small text under the number — your call, keep it unobtrusive).
3. **그래프 시각화**: add at least one hand-drawn `<canvas>` chart — pick whichever is more useful given the data shape available (e.g. a bar chart comparing 조회수 across posted content, or a line/cumulative chart by `date`). Must render correctly against the dark theme (readable axis/label colors derived from the existing CSS variables) and must not crash when there are 0 or 1 posted items (empty/placeholder state).

### Verification (required)
- Extract every inline `<script>` from the modified HTML and parse it (`node -e` with `new Function(src)` or similar); must pass with no syntax errors.
- Grep your own additions for any literal `undefined` leaking into rendered strings, and for any hardcoded hex color not derived from an existing CSS variable.
- Confirm `defaultOps()` and `loadOps()` in `youtubeOps.js` stay backward-compatible: an `ops.json` without the new fields must still load without throwing (the existing backfill pattern — `if (!Array.isArray(...)) ... = []` etc.) — add equivalent guards for every new field you introduce.
- You cannot run the live server or a browser here — say so plainly in the report rather than claiming a live check.

### Report (concise, Korean)
브랜치 + 커밋 목록; A1–A5, B1–B3 각각 무엇을 바꿨는지; 새로 추가된 ops.json 스키마 필드 목록(이름+기본값); 라이브 서버로 확인 못 한 부분 명시.

## 지시문 끝
