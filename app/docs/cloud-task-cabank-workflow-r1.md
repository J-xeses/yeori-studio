# 클라우드 세션 작업 지시서 — CA_BANK 자동 생성 워크플로우 1단계: 턴어라운드·표정 카테고리로 승격 시스템 확장 (2026-10-28)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 새 세션(Sonnet 5 / High) → 아래 "지시문" 붙여넣기.
> 예상 비용 $8~12 (이전 라운드보다 서버+프론트 양쪽을 건드리는 범위가 넓음).
> **규칙: 같은 명령이 3번 연속 실패하면 즉시 멈추고 보고.**
> 선행 문서: `app/docs/ca-bank-academy-proposal.md`(최초 설계), `cloud-task-cabank-attempt-log-r1.md`/`cloud-task-cabank-promote-r1.md`(3·4단계, 이미 머지됨 — "시도 기록 → 유지/폐기 → 레퍼런스 승격" 흐름이 이미 동작 중이지만 지금은 **룩(LOOK)에만** 적용됨).
> 이 작업은 성준님이 CA_BANK 화면에 직접 표시한 "캐릭터의 기본 모습과 코디네이션을 자동으로 생성하는 워크플로우 구축 필요" 요청의 1단계 — 전체를 한 번에 하지 않고, 이미 있는 시도/승격 시스템을 ②턴어라운드·③표정 보드까지 넓히는 것부터 시작한다. 신규 캐릭터 생성·액세서리/헤어/메이크업 카테고리·시즌 보드는 이 라운드 범위 밖(다음 단계).

---

## 지시문 (여기부터 복사)

You are extending the **CA_BANK "attempt → evaluate → promote" pipeline** in the yeori-studio app so it covers **턴어라운드(turnaround) and 표정(expr) board categories**, not just looks. Read `app/server/lib/academyLog.js`, the `/api/academy-log` and `/api/academy-promote` handlers in `app/server/proxy.js`, and the CA_BANK section of `app/code_generator_v1.html` (search for `cab.attempts`, `cabRecordAttempt`, `cabSetResult`, `cabPromote`, `cabBoardDefs`) **before writing any code** — this task reuses that existing pipeline, it does not rebuild it.

### 0) Current state (verify this matches what you find before changing anything)
- `cabBoardDefs(charId)` in `code_generator_v1.html` builds 5 boards: `face`, `turnaround`, `expr`, `look`, `season`. Boards `turnaround` and `expr` currently hardcode every slot's `file` to `null` — there is **no characters.json field they read from**, so even a manually-edited characters.json could never make those slots show an image today. Board `look` already works end-to-end (slots read `characters.json`'s `looks{}`, populated via the existing promote flow).
- The existing attempt/promote flow lives in one place: section "05 시도 기록" below the P1 simulator (`cab.attempts`, `cabRecordAttempt()`, `cabSetResult()`, `cabPromote()`, `renderCabAttempts()`). It always assumes **category = look**: the server auto-generates a `<initials>_LK##` key (`academyLog.js`'s `lookInitials()` + counting), and `promoteAttempt()` always writes into `characters[char].looks[lookKey]`.
- `/api/academy-log` (`POST`) and `/api/academy-promote` (`POST`) are the two endpoints involved, backed by `downloads/seoyeori/ca_bank/attempts.jsonl` (append-only, one line per attempt/status-update, last line per key wins).

### 1) `characters.json` schema — add two new optional per-character fields
No existing character has these yet; they start absent (`undefined`), which must render exactly like today's `file: null` placeholder (no behavior change for characters that don't have them):
- `turnaround: { front?: string, side?: string, back?: string }` — each value is an image path, same convention as `looks.*.file`.
- `expressions: { neutral?: string, smile?: string, surprise?: string, sad?: string, flustered?: string }` — same five keys as `CAB_EXPR_LABEL` in `code_generator_v1.html` (don't invent different key names — match that constant exactly).
Do **not** add these keys to every character up front — they're written lazily by promotion (step 3). Don't touch any other field in `characters.json`.

### 2) `academyLog.js` — attempts carry a `category`, and non-look categories use a fixed slot key instead of an auto-generated one
- `appendAttempt()`: add a `category` parameter, default `'look'` for backward compatibility with how section 05 already calls it. When `category === 'look'`, keep the exact current behavior (server computes `<initials>_LK##` via `lookInitials()` + counting existing attempts). When `category` is `'turnaround'` or `'expr'`, the caller supplies the exact slot key directly (one of `front/side/back` for turnaround, one of `neutral/smile/surprise/sad/flustered` for expr) — **do not auto-generate a key for these**, reuse the client-supplied slot key as the attempt's `lookKey` field (keep the field named `lookKey` in the JSONL for minimal schema churn — it's just "the key this attempt targets" regardless of category). Write `category` into each JSONL line.
- **Important uniqueness fix**: `lookKey` alone is no longer unique across categories (e.g. `front` exists both in `turnaround` and potentially elsewhere) — `latestByLookKey()` / `findLatest()` must key by **the pair `(category, lookKey)`**, not `lookKey` alone. Update these functions accordingly, and audit every other place in `academyLog.js` that assumes `lookKey` alone is unique.
- `promoteAttempt()`: branch by `category`:
  - `'look'` (default): **unchanged** — writes into `characters[char].looks[lookKey]` exactly as today.
  - `'turnaround'`: writes the attempt's generated image/prompt info into `characters[char].turnaround[lookKey]` (creating the `turnaround` object if absent). Follow the same shape convention `looks.*` uses (at minimum a `file` path once an image exists — but since this pipeline still only deals with **prompts**, not actual uploaded images, store whatever `promoteAttempt()` currently stores for a look minus the image — check what `promoteAttempt()` actually writes today by reading it, don't assume).
  - `'expr'`: same idea, writes into `characters[char].expressions[lookKey]`.
  - Reject (same 404/409 pattern as today) an unknown category, an attempt not in `kept` state, or a slot key outside the fixed allowed set per category (`front/side/back` for turnaround, the 5 expr keys for expr) — validate server-side, don't trust the client.
- `summarize()`: include per-category breakdowns if that's a small addition; don't over-build this — a flat total is fine if splitting by category meaningfully complicates the function, use your judgment but favor the simpler version.

### 3) `proxy.js` — pass `category` through
- `POST /api/academy-log`: accept an optional `category` in the body (default `'look'`), pass through to `appendAttempt()`.
- `POST /api/academy-promote`: accept `category` in the body (default `'look'`), pass through to `promoteAttempt()`. Keep the existing `loadCharacters()` → `promoteAttempt()` → `saveCharacters()` pattern already there for the look path — reuse it for the new categories too, don't duplicate the load/save wiring.

### 4) `code_generator_v1.html` — wire the boards and the UI
**a) `cabBoardDefs()`**: stop hardcoding `file: null` for `turnaround` and `expr` slots — read from `c.turnaround?.[k]` and `c.expressions?.[k]` respectively (same pattern board `look`/`face` already use). This alone makes a promoted turnaround/expr slot actually display once promotion (step 4c) has happened.

**b) New per-slot "시도로 기록" button on empty board slots (boards `turnaround` and `expr` only — not `face`/`look`/`season`, those are out of scope)**: Each empty slot already renders a prompt + "프롬프트 복사" button via `cabSlotHtml()`. Add a second button right next to it, **only when the slot belongs to board `turnaround` or `expr`**, calling a new function `cabRecordSlotAttempt(category, slotKey, promptText)`:
  - Posts to `/api/academy-log` with `{ character: cab.charId, category, lookKey: slotKey, prompt: promptText, result: 'pending', note: cab.lastCode || '' }` (reuse the existing `cabPostLog()` helper, don't write a new fetch wrapper).
  - On success, push the new attempt into `cab.attempts` (same array section 05 already renders) with the `category` field included, then call `renderCabAttempts()` so it shows up in the existing list immediately — this is the same list, not a new one.
  - You'll need to pass `category`/`slotKey` through from `cabBoardDefs()`'s slot objects into `cabSlotHtml()`'s rendering so the button's `onclick` has the right values — check how `cabSlotHtml()` currently gets called and extend its signature/call sites minimally (don't restructure unrelated parts of it).

**c) `renderCabAttempts()` / `cabSetResult()` / `cabPromote()` — category-aware**:
  - Each attempt row must show its `category` (e.g. a small tag/prefix before the key, like `[턴어라운드] front` or just keep showing the existing look-style row but with a category label added — your call on exact presentation, keep it compact and consistent with the existing row's visual density).
  - `cabSetResult(lookKey, result)` and `cabPromote(lookKey)` currently find the attempt via `cab.attempts.find(x => x.lookKey === lookKey)` — **this breaks with the uniqueness fix in step 2** (two categories can share a slot key like `front`). Change both functions' signatures to take `(category, lookKey, result)` / `(category, lookKey)`, update the `.find()` to match both fields, and update every `onclick="cabSetResult('${lookKey}','kept')"`-style call site (in `renderCabAttempts()` and the new button from 4b) to pass category through too.
  - On successful promotion for `turnaround`/`expr`, update the in-memory `characters[a.character]` object the same way the existing look-promotion code does (`characters[a.character].looks[lookKey] = d.look`) — find that line and mirror the pattern for `.turnaround`/`.expressions`, then call `renderCabBoard()` (not just `renderCabAttempts()`) so the newly-promoted slot actually appears filled in board ②/③ without a page reload.

### Hard constraints
- Branch `cabank-workflow-r1` from `master`; commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Board `face`, `look`, `season` behavior must be byte-for-byte unchanged** — this round only adds `turnaround`/`expr`. Don't touch their rendering logic beyond what's incidentally shared (e.g. `cabSlotHtml()`'s signature change must stay backward-compatible for those boards' existing call sites).
- Don't add real image upload/generation — this is still the existing "copy prompt → generate in Flow manually → paste result path in later" pattern CA_BANK has always used. No new API calls to any image-generation service.
- Never edit any `characters.json` field other than adding the two new optional objects described in step 1, and only via the promote flow (no bulk-editing existing characters).

### Verification
- Syntax-check the inline `<script>` (extract + `node --check`).
- Write a Node unit test (mock `characters`/attempts data) for the updated `academyLog.js`: confirm `(category, lookKey)` pair uniqueness in `latestByLookKey()`/`findLatest()` — specifically that a `turnaround` attempt with key `front` and a hypothetical other-category attempt also keyed `front` don't collide; confirm `promoteAttempt()` correctly routes to `.turnaround`/`.expressions`/`.looks` depending on category; confirm an invalid slot key for a given category is rejected (404-equivalent) server-side.
- Manually trace one full cycle in your head against the code (character → pick empty turnaround slot → "시도로 기록" → appears in 05 list tagged turnaround → "유지" → "✓ 레퍼런스로 승격" → `characters[char].turnaround.front` gets set → board ② that slot now shows as filled) and confirm every step's function calls line up with what you actually wrote, not what you assumed.

### Report (concise, Korean)
브랜치/커밋; `characters.json`에 추가된 두 필드의 정확한 모양(실제 승격 테스트로 나온 값); `(category, lookKey)` 유닛테스트 결과; `cabSlotHtml()` 시그니처를 어떻게 확장했는지(기존 호출부 호환 여부); 턴어라운드/표정 보드가 승격 후 실제로 채워지는지 트레이스한 결과.

## 지시문 끝
