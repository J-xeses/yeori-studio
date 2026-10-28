# 클라우드 세션 작업 지시서 — CA_BANK 레이아웃 정리 + 묶은머리 화면 병합 + 보드 슬롯 추가 (2026-10-28)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 새 세션(Sonnet 5 / High) → 아래 "지시문" 붙여넣기.
> 예상 비용 $5~8.
> **규칙: 같은 명령이 3번 연속 실패하면 즉시 멈추고 보고.**
> 이 작업은 CA_BANK 보완 2건 중 1번째(레이아웃+슬롯). 2번째(자동 생성 워크플로우)는 별도 지시서로 이어서 진행.
> 성준님이 화면 스크린샷에 직접 빨간 글씨로 표시한 보완사항을 반영한다. 아래 각 항목은 이미 로컬에서 코드를 직접 읽고 확인한 내용이므로, 추측하지 말고 명시된 함수/라인을 그대로 수정할 것.

---

## 지시문 (여기부터 복사)

You are improving the **CA_BANK tab** in `app/code_generator_v1.html` — a single large standalone HTML file (not a React component; all CA_BANK logic is inline `<script>` using `cab`-prefixed JS functions). This is a pure layout/UX + small-feature pass, not a backend change. Five independent fixes below; do all five in one branch, one commit per logical fix is fine, but keep them scoped — **do not touch unrelated parts of this 3000+ line file**.

### 0) Before you start
Read `app/docs/ca-bank-academy-proposal.md` once for context (it's the original design proposal; stages 3-4 from it are already merged). This task is NOT from that proposal's stage list — it's a UI cleanup pass the project owner requested after reviewing the live screen.

### 1) Merge "서여리(묶은 머리)" into 서여리 — **display only, do not touch `characters.json`**
`downloads/seoyeori/characters/characters.json` has `yeori_nt` as a separate character entry with `"personaOf": "yeori"` (line ~186) — it's a hair-tied-up variant of 서여리, but it's also a real character id used by Flow reference images, TTS voice, and script `CH` fields elsewhere in the app. **Never rename, remove, or restructure this entry** — other features depend on the id `yeori_nt` existing exactly as-is.

The file already has two helper functions built for exactly this base-vs-variant relationship (around line 3017-3018):
```js
function basePersons() { return CAB_CHAR_ORDER.filter(id => !(cabChar(id) || {}).personaOf); }
function variantsOf(baseId) { return CAB_CHAR_ORDER.filter(id => id === baseId || (cabChar(id) || {}).personaOf === baseId); }
```
These are already used by the 에피소드 탭's cast picker (`castPickPerson`, around line 2439/2452) to show 서여리 as one entry with 묶은머리 as a sub-variant — but **CA_BANK's own sidebar and simulator still iterate the raw `CAB_CHAR_ORDER` array directly** (`renderCaBankSidebar` ~line 3173, `renderCabSimulator` ~line 3227), so `yeori_nt` shows up as a separate top-level character row there. Fix:

- In `renderCaBankSidebar()`: change the top-level character loop from `CAB_CHAR_ORDER.forEach(id => ...)` to `basePersons().forEach(id => ...)`. `yeori_nt` no longer appears as its own row.
- In `renderCabSimulator()`: change `charOptions` from mapping `CAB_CHAR_ORDER` to mapping `basePersons()`.
- Add a new helper `characterLooksAll(baseId)` next to the existing `characterLooks(id)` (~line 2993) that merges looks across `variantsOf(baseId)`, tagging each entry with which character id it actually came from:
  ```js
  function characterLooksAll(baseId) {
    return variantsOf(baseId).flatMap(id => characterLooks(id).map(l => ({ ...l, ownerId: id })));
  }
  ```
  For `yeori`, this returns 서여리's own looks plus `yeori_nt`'s `LOOK_NT` (tagged `ownerId: 'yeori_nt'`), merged into one list.
- Use `characterLooksAll(id)` instead of `characterLooks(id)` everywhere CA_BANK displays a character's full look list for selection: the sidebar's expanded look list (~line 3189 `looks[id] || []`), the simulator's look pills (~line 3231 `characterLooks(cab.charId)`), and board ④ "룩별 전신" in `cabBoardDefs()` (~line 3319, `looks: characterLooks(charId)`). **Do not change board ①②③⑤** (face/turnaround/expr/season) — those stay scoped to the base character only; this merge is specifically about the look list, matching what was marked on screen.
- Label distinction: when rendering a merged look row whose `ownerId !== baseId` (e.g. `LOOK_NT` owned by `yeori_nt`), append a short tag to the label so it's still visually distinguishable as the 묶은머리 variant — e.g. `${l.label} (묶은머리)` — don't silently merge it into an indistinguishable서여리 look.
- **Prompt accuracy fix**: in `renderCabSimulator()`, the 04 조합 결과 prompt currently builds from `cabChar(cab.charId).descriptor` (~line 3247, 3264). Since `cab.charId` will now always be the base id (`yeori`), a selected `LOOK_NT` would wrongly use 서여리's un-tied-hair descriptor instead of `yeori_nt`'s tied-hair-bun descriptor. Fix: when building the prompt, resolve the descriptor from the **selected look's `ownerId`** if present (`cabChar(lookEntry.ownerId || cab.charId)`), falling back to `cab.charId` when no look is selected or the look has no `ownerId`. This keeps the merged-display convenience without losing the correct face/hair description for generation prompts.
- `cabFindLookOwner()` (~line 3030) already searches all of `CAB_CHAR_ORDER` for a look's owner — leave it as-is, it still works correctly after this change since `yeori_nt` remains in `CAB_CHAR_ORDER` (only the *display* loops change to `basePersons()`/`variantsOf()`, the underlying data and `CAB_CHAR_ORDER` array are untouched).
- **Verify with a Node unit test** (no browser needed): extract `characterLooks`, `characterLooksAll`, `basePersons`, `variantsOf`, `cabChar`, `CAB_CHAR_ORDER` into a throwaway test script with mock `characters` and `codebook` objects shaped like the real `characters.json`/`codebook.json` (read the real files to get accurate shape), and confirm:
  - `basePersons()` returns `['yeori', 'jia', 'jiyu']` (no `yeori_nt`).
  - `characterLooksAll('yeori')` includes an entry with `code: 'LOOK_NT'` and `ownerId: 'yeori_nt'`.
  - `variantsOf('yeori')` returns `['yeori', 'yeori_nt']`.

### 2) Sidebar character row — name wrapping + look-list scrollbar
Screenshot shows the character name wrapping under the avatar instead of staying beside it, and the look list growing without a scrollbar as entries accumulate.
- `.cab-char-name` (~line 136): add `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` so the name stays on one line beside the avatar (truncate instead of wrap).
- The expanded look-list block under each character row (the `.cab-look-row` items rendered in the `if (expanded)` branch of `renderCaBankSidebar`, ~line 3195-3203): wrap that list's container in a scrollable div, e.g. `<div class="cab-look-scroll">...</div>` with new CSS `.cab-look-scroll { max-height: 240px; overflow-y: auto; }`. Don't apply this scroll to the whole sidebar — only to the per-character look sub-list.

### 3) P1-② 룩(LOOK) section — switch to single vertical column
`#cab-pills-look` currently uses the shared `.kw-wrap` class (`display: flex; flex-wrap: wrap`, line ~198), which causes long look labels (e.g. "LOOK_CS 크롭탑+데님숏츠+힐") to wrap awkwardly and visually collide in the narrow card. **`.kw-wrap` is used by many other sections across the app (top/bottom/season pills, other tabs) — do not modify it globally.** Instead:
- Add a new scoped class, e.g. `.cab-look-col { display: flex; flex-direction: column; gap: 6px; }`.
- In the HTML around line 909 (`<div class="kw-wrap" id="cab-pills-look" ...>`), change the class on that one element from `kw-wrap` to `cab-look-col` (keep the id).
- Confirm `setPills`/`pillsHtml` (used in `renderCabSimulator` ~line 3234-3236) doesn't hardcode `kw-wrap` itself — if the pill-rendering helper injects its own wrapper class, either adjust the call site to skip it for this one element or override via the new class's specificity. Check the actual helper function before assuming either way.

### 4) P1-③ 표정·샷 section — switch to vertical 2-column grid
Same overlap problem for `#cab-pills-mood` and `#cab-pills-shot` (~line 919-922). Add a new scoped class `.cab-pills-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }` and apply it (replacing `kw-wrap`) to both `#cab-pills-mood` and `#cab-pills-shot` elements only. Same caveat as #3 — don't touch global `.kw-wrap`.

### 5) P2 reference boards — "add slot" button (horizontal expansion)
Screenshot note: "각 레퍼런스 보드별 가로 추가 방식!!" on the ② 턴어라운드 board, but it applies to any board with a fixed slot list (`cabBoardDefs()` ~line 3301-3331 currently hardcodes slots for turnaround/expr; ④룩별전신/⑤시즌 are already dynamic from data). Add a lightweight, **session-only** (no backend persistence this round — that's in scope for the next workflow-stage task) custom-slot feature:
- New in-memory state: `cab.customSlots = {}` (shape: `{ [charId]: { [boardKey]: [{ key, label }] } }`).
- In `renderCabBoard()` / `cabBoardDefs()`, after building each board's base `slots` array, append any matching `cab.customSlots[charId]?.[board.key]` entries (using the existing `cabSlotHtml()` renderer — a custom slot behaves exactly like a normal empty slot: `file: null`, a prompt built the same way via `mk(...)`, and a `target` path following the existing `targetFile(board, slot)` convention).
- Add a small "+ 슬롯 추가" button to each board's header (`.cab-board-head`, ~line 427/3350ish) that calls a new `cabAddCustomSlot(boardKey)` function: prompt the user (`window.prompt`) for a short label, slugify it into a `key` (lowercase, non-alphanumeric → `_`, collision-check against existing slot keys in that board), push `{key, label}` into `cab.customSlots[cab.charId][boardKey]`, then call `renderCabBoard()` to re-render.
- This is intentionally simple (no delete button, no server save) — the goal is just to unblock adding extra reference angles/shots beyond the fixed set without waiting for a backend change.

### Hard constraints
- Branch `cabank-layout-r1` from `master`; commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Never edit `downloads/seoyeori/characters/characters.json`** in this task — fix #1 is display-logic only.
- **Never modify the global `.kw-wrap` CSS rule** — add new scoped classes instead, as specified.
- Don't touch CA_BANK's P1-01 캐릭터 picker, 04 조합 결과, 05 시도 기록, or any `/api/academy-*` backend code — out of scope for this pass.

### Verification
- Syntax-check the HTML's inline `<script>` block (e.g. extract it and run `new Function(scriptText)`, or `node --check` on the extracted JS) — must pass with no errors.
- Run the Node unit test from step 1 and report its output.
- Read through the modified render functions once more and confirm no leftover reference to `CAB_CHAR_ORDER` was left where `basePersons()`/`variantsOf()` should now be used (the intent is: `CAB_CHAR_ORDER` itself stays unchanged as the full underlying list; only the *display* loops switch).

### Report (concise, Korean)
브랜치/커밋; `characterLooksAll` 유닛테스트 결과(3가지 확인 항목); 사이드바/시뮬레이터에서 `CAB_CHAR_ORDER` → `basePersons()`로 바꾼 지점 목록; `.kw-wrap` 전역 규칙은 그대로인지; 슬롯 추가 버튼이 세션 메모리에만 저장된다는 점(새로고침하면 사라짐)을 사용자에게 알릴 만한 포인트인지.

## 지시문 끝
