# 클라우드 세션 작업 지시서 — CA_BANK "오더 접수 → 자동 구성 → 승인" UI 1단계 (2026-10-29)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 새 세션(Sonnet 5 / High) → 아래 "지시문" 붙여넣기.
> 예상 비용 $5~8 (프론트엔드 전용, 서버/characters.json 변경 없음).
> **규칙: 같은 명령이 3번 연속 실패하면 즉시 멈추고 보고.**
> 선행 문서: `app/docs/cloud-task-cabank-workflow-r1.md`(머지됨 — 턴어라운드/표정 보드에 "시도 기록 → 유지/폐기 → 승격" 파이프라인이 이미 동작 중).
> 이 작업은 성준님이 설계한 "자동 선택 & 신규 생성 메커니즘"의 1단계 — **오더 접수 → 자동 구성 → 승인**까지만 다룬다. 승인 후 실제 생성(수동 Flow / 자동 API)을 어떻게 이원화할지는 다음 단계에서 별도로 설계하며, **이번 라운드는 생성 백엔드를 전혀 건드리지 않는다.** 신규 캐릭터 생성, 액세서리/헤어/메이크업 카테고리, 룩(look) 카테고리 오더도 이번 범위 밖(다음 단계).

---

## 지시문 (여기부터 복사)

You are adding an **"오더 접수 → 자동 구성 → 승인" (order intake → auto-compose → approve) UI** to the CA_BANK tab in `app/code_generator_v1.html`. This is a **pure frontend, in-memory feature** — no new server endpoint, no `characters.json` change, no image-generation call of any kind. It only automates the *selection* of which empty turnaround/expr slots to attempt, then bulk-registers them through the **existing** `/api/academy-log` pipeline exactly as if a person had clicked each board slot's "시도로 기록" button one at a time.

Read `app/docs/cloud-task-cabank-workflow-r1.md` (already-merged instructions) and the current CA_BANK code before writing anything — this task reuses `cabBoardDefs()`, `cabRecordSlotAttempt()`, `cab.attempts`, `renderCabAttempts()` as-is; it does not rebuild them. Key reference lines to read first: `cabBoardDefs(charId)` (builds boards incl. `turnaround`/`expr` with per-slot `{key, label, file, prompt, cat, promoted}}`), `cabRecordSlotAttempt(category, slotKey, promptText)` (around line 3119), `CAB_CATEGORY_LABEL`/`CAB_CHAR_ORDER`/`CAB_CHAR_SHORT`, and the "05 시도 기록" card markup (around line 963-969, inside `<section class="phase">` P1).

### 1) New UI: "06 오더 (자동 구성)" card
Add a new `<div class="card" ...>` **right after** the existing "05 시도 기록" card (same P1 `<section>`, after its closing `</div>` at ~line 969, before the `</section>` that follows). Structure, reusing existing CSS classes/conventions (`card-h`, `field-label`, `cab-copy-btn`, `cab-hint`) — don't invent a new visual language:
- Header: `<span class="idx">06</span>📦 오더 (자동 구성)`.
- Form row: 캐릭터 선택(`<select>`, options = `CAB_CHAR_ORDER` with `CAB_CHAR_SHORT` labels), 카테고리 선택(`<select>`, options restricted to **only** `turnaround`/`expr` via `CAB_CATEGORY_LABEL` — do **not** include `look` this round), 수량 입력(`<input type="number" min="1">`, plus a "전체" checkbox that when checked ignores the number and takes every empty slot in that category).
- "구성하기" button → `cabComposeOrder()`.
- Below the form, an empty container (e.g. `id="cab-order-preview"`) where the composed checklist renders.

### 2) `cabComposeOrder()` — build the candidate list purely from existing board data
```
function cabComposeOrder() {
  // read the order form's character/category/quantity/전체-checkbox values
  // call cabBoardDefs(orderCharId) to get the SAME boards the P2 board already renders
  // find board with key === orderCategory ('turnaround' or 'expr')
  // filter its slots to ones that are empty: !slot.file
  // take up to the requested quantity (or all if "전체" is checked)
  // store as cab.pendingOrder = { character: orderCharId, category: orderCategory, items: [{ slotKey: slot.key, label: slot.label, prompt: slot.prompt, checked: true }, ...] }
  // render the checklist (see step 3)
}
```
**Do not re-derive or alter the prompt text** — use `slot.prompt` exactly as `cabBoardDefs()` produced it (it already includes the character's descriptor + the turnaround/expr-specific English phrase). This guarantees the auto-composed attempt's prompt is byte-identical to what a person would have gotten by opening that board slot manually.
If the chosen board has zero empty slots, show a toast/hint ("해당 카테고리는 이미 모두 채워져 있어요") and don't render an empty checklist.

### 3) Approval checklist UI
Render `cab.pendingOrder.items` as a list of rows, each with: a checkbox (default checked), the slot label, a truncated prompt preview (full text in `title` attribute, matching how `cab-attempt-prompt` already does it), and two buttons at the bottom of the card: "오더 승인" (`cabApproveOrder()`) and "취소" (`cabCancelOrder()`, just clears `cab.pendingOrder` and the preview container). Keep visual density consistent with the existing "05 시도 기록" rows (reuse `.cab-attempt`-style classes if they fit, or a new scoped `.cab-order-item` class — your call, but don't modify `.cab-attempt` itself since that's shared with the live attempt list).

### 4) `cabApproveOrder()` — bulk-register through the existing pipeline
Loop over `cab.pendingOrder.items.filter(i => i.checked)` and call `cabRecordSlotAttempt(category, slotKey, prompt)` for each — **but first check this**: that function currently always targets `cab.charId` (the globally-selected simulator character), not an explicit character. The order's character may differ from whatever is currently selected in the simulator (a person could be looking at 서여리's boards while an order targets 지유). Extend `cabRecordSlotAttempt` to take an explicit character parameter:
```
async function cabRecordSlotAttempt(category, slotKey, promptText, character) {
  const charId = character || cab.charId;   // default keeps every existing call site (the board-slot buttons) working unchanged
  ...use charId everywhere inside instead of cab.charId...
}
```
This mirrors the exact pattern already used for `cabSetResult(category, lookKey, result, character)` / `cabPromote(category, lookKey, character)` in the previous round — **grep every existing call site of `cabRecordSlotAttempt` first** (should only be the board-slot "시도로 기록" buttons) and confirm they still pass no 4th argument / still work via the default.
After the loop finishes, clear `cab.pendingOrder`, clear the preview container, call `renderCabAttempts()` (so the new entries show up in the existing 05 list tagged with their category, exactly like a manually-recorded one would), and show a toast with the count registered (e.g. "✓ 3건 오더 등록").

### Hard constraints
- Branch `cabank-order-r1` from `master`; commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **No new server endpoint. No `characters.json` edits. No call to any image/video generation API or service.** This round only orchestrates the existing `/api/academy-log` calls client-side.
- Category dropdown in the order form offers **only** `turnaround` and `expr` — not `look`, not `season`, not `face`. (룩 카테고리는 attempt마다 서버가 새 LK 키를 자동발급하는 구조라 "빈 슬롯을 지정해서 채운다"는 이 기능의 전제와 안 맞음 — 다음 단계에서 별도 설계.)
- One order = one character (matches how 성준님 phrases orders, e.g. "지유 턴어라운드 3컷") — don't build multi-character orders this round.
- Don't touch `cabBoardDefs()`'s prompt-building logic (the `mk()` helper, `CAB_TURN_EN`/`CAB_EXPR_EN` constants) — only read its output.
- Don't touch board `face`/`look`/`season` rendering or the existing per-slot "시도로 기록" buttons on `turnaround`/`expr` boards — they must keep working exactly as before, independent of whether an order was used.

### Verification
- Syntax-check the inline `<script>` (extract + `node --check`).
- Since this round adds no server code, write the verification as a careful **manual trace with exact line/function references**, not a Node unit test against a mock DOM: pick one character with at least one empty turnaround slot and one empty expr slot, and trace step by step — form selection → `cabComposeOrder()`'s filter against `cabBoardDefs()` output (list the exact empty slots it would find and confirm the quantity/전체 logic) → checklist render → `cabApproveOrder()`'s loop → each `cabRecordSlotAttempt(category, slotKey, prompt, character)` call's effect on `cab.attempts` and the POST body sent to `/api/academy-log` → confirm `renderCabAttempts()` shows the right category tag and character for each new row.
- Grep every pre-existing call site of `cabRecordSlotAttempt`, `cabSetResult`, `cabPromote` and confirm none of them break from the signature change (they should all still omit the new trailing parameter and fall back to `cab.charId` as before).
- Confirm the order form's category `<select>` truly cannot produce `category === 'look'` (no stray option, no way to bypass via devtools-only concern — just confirm the HTML doesn't render a `look` option).

### Report (concise, Korean)
브랜치/커밋; "06 오더" 카드가 정확히 어디에 삽입됐는지(앞뒤 마크업 스니펫); `cabComposeOrder()`가 `cabBoardDefs()` 결과를 그대로 재사용하는지(직접 발췌 코드로); `cabRecordSlotAttempt` 시그니처 확장이 기존 호출부와 호환되는지 grep 결과; 턴어라운드 3건 오더 + 표정 2건 오더 두 가지 트레이스 결과.

## 지시문 끝
