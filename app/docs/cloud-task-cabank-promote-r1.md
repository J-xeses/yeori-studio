# 클라우드 세션 작업 지시서 — CA_BANK 4단계: 승격 버튼 + 사용 횟수 집계 (2026-10-28)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 새 세션(Sonnet 5 / High) → 아래 "지시문" 붙여넣기.
> 예상 비용 $5~8.
> **규칙: 같은 명령이 3번 연속 실패하면 즉시 멈추고 보고.**
> **선행 조건: `cabank-attempt-log-r1` 브랜치(3단계: 시도 로그 + `/api/academy-log` + `downloads/seoyeori/ca_bank/attempts.jsonl`)가 먼저 master에 머지되어 있어야 함.** 머지 안 되어 있으면 그 브랜치를 먼저 베이스로 잡거나(머지 전이라도 작업은 가능하지만 충돌 위험), 작업 시작 전에 `git log master` 로 3단계 커밋이 들어가 있는지 확인하고 없으면 그 사실을 보고하고 중단할 것.

---

## 지시문 (여기부터 복사)

You are implementing **CA_BANK Academy stage 4**, the final stage per `app/docs/ca-bank-academy-proposal.md` section "## 4. 단계 제안". This depends on stage 3 (attempt logging) already being in `master` — **before writing any code, run `git log master --oneline | grep -i cabank` (or equivalent) to confirm stage 3's work (an `academy-log` endpoint, `downloads/seoyeori/ca_bank/attempts.jsonl`, look-keys shaped `<2-letter initials>_LK##`) actually exists in master. If it does not, stop and report — do not attempt to reimplement stage 3 yourself.**

Stage 4 adds two things on top of stage 3's attempt log:

### 1) Promote-to-reference button
A kept attempt (an entry in `downloads/seoyeori/ca_bank/attempts.jsonl` with `result: 'kept'`, per stage 3's log format) can be "promoted" — copied into the permanent character registry at `downloads/seoyeori/characters/characters.json` as a confirmed look for that character.

- Add a "✓ 레퍼런스로 승격" button next to each `kept` attempt in the CA_BANK tab (find the actual tab component — it was touched in stage 3, check its current state first rather than assuming unchanged).
- On click: `POST /api/academy-promote` (new endpoint) with `{ character, lookKey }`.
- Backend (`app/server/proxy.js`):
  - Look up the attempt by `lookKey` in `attempts.jsonl` (last entry for that key, per stage 3's "last entry wins" convention) to get its image/asset path(s) under `downloads/seoyeori/ca_bank/<attemptId>/`.
  - Copy (not move — the attempt log entry stays as history) the relevant reference image(s) into the character's folder under `downloads/seoyeori/characters/` (read `characters.json`'s existing structure first to match how current reference images are stored per character — likely an array of image paths or a dedicated subfolder per character; mirror the existing convention exactly, don't invent a new one).
  - Update `characters.json` to register the new look under that character, keyed by `lookKey` (so the registry itself gains a record that `JY_LK01` is now a confirmed look, with its reference image path(s)).
  - Append a `promoted: true` marker — either as a new line in `attempts.jsonl` with the same `lookKey` and this added field, or (preferred, since `attempts.jsonl` entries don't currently have a `promoted` field per stage 3's shape) just the fact that it now exists in `characters.json` is the source of truth for "promoted" status; read stage 3's actual JSONL schema in the merged code before deciding — don't guess.
  - This is the only part of this task allowed to write under `downloads/seoyeori/characters/`; stage 3 explicitly excluded that folder, stage 4 is where promotion is allowed to touch it.
  - Respond `{ ok: true }` or a clear error if the attempt isn't found or isn't `kept`.

### 2) Usage-count aggregation
A summary view (can be a small panel in the CA_BANK tab, or a new small section — check whether `CreditsTab.jsx` or the CA_BANK tab itself is the better home; prefer keeping it in the CA_BANK tab since it's CA_BANK-specific data, not the general credit ledger) showing, per character:
- Total attempts (count of distinct `lookKey`s or total log lines — decide based on what's more meaningful: distinct attempts, i.e. distinct `lookKey` values, is more useful than raw line count since stage 3 can append multiple status-update lines per `lookKey`).
- How many were kept vs discarded vs still pending.
- How many have been promoted (cross-reference against `characters.json`'s registered looks for that character).

Read `downloads/seoyeori/ca_bank/attempts.jsonl` and `downloads/seoyeori/characters/characters.json` server-side, compute this in a new lightweight endpoint `GET /api/academy-summary` (returns `{ [character]: { total, kept, discarded, pending, promoted } }`), and render it as a simple table/list in the CA_BANK tab. No new persistent storage needed — compute on read, this data is small.

### Hard constraints
- Branch `cabank-promote-r1` from `master` (after confirming stage 3 is merged — see above). Commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Do not change stage 3's `attempts.jsonl` schema in a way that breaks existing entries — only additive changes if any.
- Match existing Korean UI tone and the CA_BANK tab's established style from stage 3.

### Verification
- Simulate: create a test `kept` attempt (if a dev server is runnable in your environment), promote it, confirm `characters.json` gains the new look entry with a correctly shaped `lookKey`, and confirm `/api/academy-summary` reflects the promotion. Clean up any test data you added to `characters.json` specifically (this file, unlike `downloads/`, may or may not be gitignored — check before finishing, and do not leave test character-look entries committed).
- Confirm promoting an attempt that is NOT `kept` is rejected with a clear error, not silently allowed.

### Report (concise, Korean)
브랜치/커밋; stage 3 머지 확인 결과; `characters.json`에 실제로 어떤 구조로 look이 추가됐는지(기존 구조와 어떻게 맞췄는지); 집계 API 응답 예시 1개.

## 지시문 끝
