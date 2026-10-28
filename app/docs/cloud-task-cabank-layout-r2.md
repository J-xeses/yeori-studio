# 클라우드 세션 작업 지시서 — CA_BANK 레이아웃 2차 보완: 스크롤 프레임 + 룩 추가 + 보드 가로배치 + 색상 강조 (2026-10-28)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 새 세션(Sonnet 5 / High) → 아래 "지시문" 붙여넣기.
> 예상 비용 $5~8.
> **규칙: 같은 명령이 3번 연속 실패하면 즉시 멈추고 보고.**
> 선행 작업: `cloud-task-cabank-layout-r1.md` (머지됨, 커밋 `08c2696`) — 이 문서는 그 작업물을 다듬는 2차 보완.
> 아래 라인 번호는 현재 `master`(커밋 `08c2696` 이후) 기준이다. 시작 전에 실제 라인이 맞는지 먼저 확인할 것(파일 수정 이력이 생겼을 수 있음).

---

## 지시문 (여기부터 복사)

You are refining the **CA_BANK tab** in `app/code_generator_v1.html` (standalone HTML, inline `<script>`, `cab`-prefixed functions — same file as `cloud-task-cabank-layout-r1.md`, already merged). This round is 5 focused CSS/small-JS refinements to what r1 built. Read r1's diff first (`git log --oneline -5` then `git show 08c2696` or equivalent) to see the current state before editing.

### 1) P1-② 룩(LOOK) pills — scrollable frame + "+ 룩 추가" (draft look) button
`.cab-look-col` (~line 201) currently has no height cap, so the look-pill list can grow unbounded and push the card tall. Add a max-height + scroll:
```css
.cab-look-col { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; padding-right: 4px; }
```
Then add a lightweight "add" feature, mirroring the session-only custom-slot pattern already built in r1 (`cab.customSlots` / `cabAddCustomSlot`, ~line 3362-3375) — this is a **draft look**, not a real registered look:
- New state: `cab.customLooks = {};` (shape: `{ [charId]: [{code, label, desc, file: null, season: null, source: 'draft', ownerId: charId, tag: '초안'}] }`).
- New function `cabAddCustomLook()`: if no `cab.charId`, return. `window.prompt()` for a short label. Build a code like `DRAFT_<SLUG>` (uppercase, non-alnum → `_`), checked against existing codes from `characterLooksAll(cab.charId)` plus already-added drafts to avoid collisions (same collision-avoidance style as `cabAddCustomSlot`). Push the new entry into `cab.customLooks[cab.charId]`, then call `renderCabSimulator()` and `renderCabBoard()` to refresh both views.
- Add a new shared helper `cabAllLooksFor(charId)` that returns `characterLooksAll(charId).concat(cab.customLooks[charId] || [])`, and use it in **both** places that currently call `characterLooksAll(cab.charId)` / `characterLooksAll(charId)` for the full look list: `renderCabSimulator()` (~line 3247 area, the `looks` variable) and `cabBoardDefs()` (~line 3321 area, the `looks` variable feeding board ④). This way a draft look drafted in the simulator also shows up as an empty slot in board ④ 룩별 전신, consistent with how real looks work.
- Add a small "+ 룩 추가" button next to or below the `#cab-pills-look` element (HTML around line 913-914), calling `onclick="cabAddCustomLook()"`. Reuse the existing `.cab-copy-btn` button style for visual consistency with the board's "+슬롯 추가" button.
- Draft looks are **session-memory only** — no backend write, same as r1's custom slots. Make sure this is clear in your report.

### 2) P1-③ 표정·샷 — split into two independent single-column scroll frames (side by side = 2 columns total)
Current HTML (~line 922-927):
```html
<div class="card">
  <div class="card-h"><span class="idx">03</span>🎭 표정 · 샷</div>
  <div class="field-label">표정(MD_)</div>
  <div class="cab-pills-2col" id="cab-pills-mood" style="margin-bottom:8px"></div>
  <div class="field-label">샷(SH_)</div>
  <div class="cab-pills-2col" id="cab-pills-shot"></div>
</div>
```
`.cab-pills-2col` currently makes a 2-column grid *inside each individual list* (mood pills wrap into 2 columns, shot pills wrap into 2 columns, separately) — that's not what's wanted. The correct layout: **표정 is its own single column, 샷 is its own single column, placed side-by-side** so the two lists together form 2 columns, and **each list scrolls independently** in a bounded frame. Restructure the HTML to:
```html
<div class="card">
  <div class="card-h"><span class="idx">03</span>🎭 표정 · 샷</div>
  <div class="cab-md-sh-grid">
    <div>
      <div class="field-label">표정(MD_)</div>
      <div class="cab-pills-scroll-col" id="cab-pills-mood"></div>
    </div>
    <div>
      <div class="field-label">샷(SH_)</div>
      <div class="cab-pills-scroll-col" id="cab-pills-shot"></div>
    </div>
  </div>
</div>
```
New CSS (replace the old `.cab-pills-2col` rule entirely — it becomes dead code after this change, remove it rather than leaving it unused):
```css
.cab-md-sh-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cab-pills-scroll-col { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; padding-right: 4px; }
```
The JS that fills these elements (`renderCabSimulator()`, the `moodEl`/`shotEl` blocks) doesn't need to change — it just sets `innerHTML`, which still works regardless of the wrapper's CSS class name (ids are unchanged: `cab-pills-mood`, `cab-pills-shot`).

### 3) P2 board ④ "룩별 전신" — switch to single-row horizontal layout (accumulate sideways, horizontal scrollbar), bigger cards
Currently all P2 boards share `.cab-board-grid` (~line 436, `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`), which wraps to multiple rows once there are more than ~6-7 slots — board ④ has 14 looks and wraps to 2 rows, which the project owner found excessive. **Only board ④ (룩별 전신) changes** — boards ①②③⑤ keep the existing `.cab-board-grid` wrap layout (they have few enough slots that wrapping isn't a problem).

In `renderCabBoard()` (~line 3376), find where it builds each board's `body` HTML (the line building `.cab-board-grid` div). Change it to pick the grid class conditionally:
```js
const gridCls = b.key === 'look' ? 'cab-board-row' : 'cab-board-grid';
```
and use `${gridCls}` instead of the hardcoded `cab-board-grid` class in that one template string.

Add new scoped CSS (don't touch the base `.cab-board-grid`/`.cab-slot-img-wrap`/`.cab-slot-prompt` rules, which boards ①②③⑤ still use as-is):
```css
.cab-board-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.cab-board-row .cab-slot { flex: 0 0 220px; }
.cab-board-row .cab-slot-img-wrap { height: 220px; }
.cab-board-row .cab-slot-prompt { max-height: 120px; }
```
This gives board ④ more vertical room per card for the generated image and the prompt text (as requested — "이미지 생성공간과 프롬프트 공간을 더 확장"), while the cards line up in one horizontally-scrolling row instead of wrapping to a second row.

### 4) Prompt text color — brighter green for legibility
`.cab-slot-prompt` (~line 444) currently uses `color: var(--text3)` (a dim, low-contrast green, `#2d6a5a`). Change it to the existing bright mint-green token already used elsewhere in this file for emphasis/active states:
```css
.cab-slot-prompt { ... color: var(--teal-light); ... }
```
(`--teal-light` = `#9FE1CB`, defined in `:root` near the top of the file — don't invent a new color, reuse this token.) Keep every other property on that rule unchanged.

### 5) Selected pill (룩/표정/샷/캐릭터 등 고른 버튼) — add a bright glow border on top of the current color
The project owner confirmed this refers to the **selected-chip (`.pill.on`) highlight**, not text selection. `.pill.on` (~line 206) is the shared selected-state class used across the *entire app* (not just CA_BANK) — this round it's fine (and desirable) to change it globally, unlike `.kw-wrap` in r1 which was deliberately left untouched. Keep the existing border color (`var(--teal)`) and text color exactly as they are — only **add** an outer glow on top:
```css
.pill.on { background: transparent; border: 1px solid var(--teal); color: var(--teal); font-weight: 700; box-shadow: 0 0 0 1px rgba(29,158,117,0.25) inset, 0 0 6px 1px rgba(159,225,203,0.55); }
```
Apply the same style of addition to `.pill.on-alt` (~line 209) for consistency — append a matching outer glow (e.g. `, 0 0 6px 1px rgba(159,225,203,0.6)`) to its existing `box-shadow` value, again without changing its current border/text color.

### Hard constraints
- Branch `cabank-layout-r2` from `master`; commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never edit `downloads/seoyeori/characters/characters.json`.
- Item 3's new row layout applies **only** to board key `'look'` — verify boards ①②③⑤ still render with the original `.cab-board-grid` wrap behavior unchanged.
- Item 5 is the one intentionally-global change this round — everything else (items 1-4) stays scoped to CA_BANK-specific classes/ids, same discipline as r1.

### Verification
- Syntax-check the inline `<script>` (extract + `node --check`, or `new Function(scriptText)`).
- Write a short Node unit test (mock `characters`/`codebook` like r1's test) confirming `cabAllLooksFor(charId)` merges `characterLooksAll()` output with `cab.customLooks[charId]` entries, and that `cabAddCustomLook()`'s code-generation avoids collisions across 2-3 simulated calls.
- Re-read the final HTML/CSS once to confirm: `.cab-pills-2col` rule is gone (not just unused — actually removed), `.cab-board-grid` base rule is byte-for-byte unchanged, `.pill.on`/`.pill.on-alt` border/text colors are unchanged (only box-shadow grew).

### Report (concise, Korean)
브랜치/커밋; `cabAllLooksFor` 유닛테스트 결과; 보드 가로배치가 `look` 키에만 적용되는지 재확인한 방법; `.pill.on` 전역 변경이 다른 탭(예: 코드 분류 선택, 출연 선택)에서도 자연스러워 보이는지 diff로 확인한 내용.

## 지시문 끝
