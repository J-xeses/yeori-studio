# 클라우드 세션 작업 지시서 — 코디젠 UI 2차 (2026-09-27)

> 사용법: claude.ai/code 에서 저장소 **J-xeses/yeori-studio** 로 새 클라우드 세션을 열고, 아래 "지시문" 전체를 붙여 넣는다.
> 작업은 브랜치 `codigen-ui-r2` 에서만. 합치기·실서버 확인은 로컬 Claude 가 한다.

---

## 지시문 (여기부터 복사)

You are improving the UI of "Codi_Gen", a single-file vanilla-JS tool: `app/code_generator_v1.html` in this repo. It was just revamped (commits a5a1827..07b0bf8 on master; context in `app/docs/codigen-review-2026-09-27.md`). This is round 2: layout/visual polish requested by the owner (성준님) plus review findings.

### Hard constraints
- Create branch `codigen-ui-r2` from `master`, commit there, push the branch. Never push to or merge into `master` (an hourly bot commits to master; the local Claude merges after live checks).
- End every commit message with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Change only `app/code_generator_v1.html` (no server, no `app/src/`, no `downloads/`, no secrets). Keep it one self-contained file. UI copy is Korean.
- Keep the existing dark theme and teal accent family; derive every new color from the existing CSS variables (`--surface`, `--border`, `--border2`, `--teal`, …).

### A. Owner requests (layout)
1. **Sidebar width +25%**: `.sidebar` is `width: 180px` → `225px`. Anything aligned to the sidebar width must follow (use one CSS variable, e.g. `--sb-w: 225px`, and reference it everywhere).
2. **Scrollbars**: current default scrollbars look foreign. Style all scroll containers (sidebar, main content, code blocks, workflow grid) to match the dark UI: thin (≈8px), track = surface/transparent, thumb = a muted border/teal-grey tone, hover slightly brighter. Provide both `::-webkit-scrollbar*` rules and Firefox `scrollbar-width: thin; scrollbar-color: …`.
3. **Top-left header cell above the sidebar**: in the horizontal tab bar row, add a block exactly the sidebar's width (`--sb-w`), visually part of the sidebar column (same background, right border), containing a short guide title, e.g. first line `작업 단계` with a small `→` hint toward the tabs, second line small muted text `아래: 채널 · 에피소드 · 컷`. Keep it compact (same height as the tab bar).
4. **Tabs shift right**: as a result, the tab titles start right after that block, aligned with the main content's left edge (not flush with the window edge).

### B. Review findings to fix
1. **Korean text rendered in the monospace font with letter-spacing** looks spaced out ("후 보 풀 데 이 터", "채널 · 서여리", button "후보 풀에서 불러오기", step labels). Rule: monospace only for codes/IDs/numbers; any label containing Hangul uses the sans font and no extra letter-spacing. Audit all such classes.
2. **컷 설계 → 02 파이프라인** shows a pill `making_record undefined`: a codebook `PL` entry has no label. Fall back to a readable label (`메이킹 기록`) or the code alone; never print `undefined` anywhere (grep the render code for other `${…label}` cases without fallback).
3. **Header `완성도 100%`** shows while prompts are 미생성 — misleading. Rename/redefine: show `설계 n%` (fields filled) and `생성 n/N` (cuts with generated prompts) separately, or one clearly labelled metric.
4. **Sidebar cut-list dots**: `.d-wip` uses scarlet (reads as an error) and the meaning is unclear. Use an amber/teal-light tone for "진행 중", keep scarlet only for real problems, show the G-point count as tiny text (e.g. `3/5`) or a clear tooltip, and add a one-line legend under the cut list.
5. **Sidebar episode titles truncate** heavily; with the wider sidebar allow a 2-line clamp for titles while keeping the code on its own line.
6. **패키지 → 05 전달 대상**: when the selected episode differs from the studio's active episode, make the warning prominent (warning style box) and state exactly what will happen if the user presses ② 전달.
7. **CA_BANK cards**: description text is very small/low-contrast; raise to readable size/contrast. (Do not change the data model — the CA_BANK merge is pending the owner's decision.)

### Verification (required)
- Extract every inline `<script>` and parse it (`node -e` with `new Function(src)`); must pass.
- Grep: no remaining literal `undefined` produced by templates you touched; `--sb-w` used for all sidebar-width alignments.
- If a headless browser is available, open the file (the local server will be offline — that is expected) and screenshot the header/sidebar area at 1500×900 and 1200×800 to check the header cell and tab alignment; otherwise describe what you checked.

### Report (concise, Korean)
Branch + commits; per item A1–A4, B1–B7 what changed; anything you could not verify without the live server.

## 지시문 끝
