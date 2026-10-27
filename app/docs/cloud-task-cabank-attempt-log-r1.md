# 클라우드 세션 작업 지시서 — CA_BANK 3단계: 시도 로그 + 기록 API + 크레딧 트래커 연동 (2026-10-28)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 새 세션(Sonnet 5 / High) → 아래 "지시문" 붙여넣기.
> 예상 비용 $5~8.
> **규칙: 같은 명령이 3번 연속 실패하면 즉시 멈추고 보고.**
> 선행 문서: `app/docs/ca-bank-academy-proposal.md` (4단계 제안 중 ①②는 완료, 이 문서가 ③).

---

## 지시문 (여기부터 복사)

You are implementing **CA_BANK Academy stage 3** in the yeori-studio app — read `app/docs/ca-bank-academy-proposal.md` section "## 4. 단계 제안" and "## 5. 성준님 결정이 필요한 것" first. CA_BANK is a workflow for trying out supporting-character looks (의상/배경/연출 variations) before "promoting" a confirmed one into the character registry. Stages 1 (schema + sync script) and 2 (CA_BANK tab reads `characters.json`) are already done (see git history for `cloud-task-codigen-cabank-r3.md`). This stage adds **attempt logging** — every generation try in the CA_BANK tab gets recorded, independent of whether it's later promoted.

The project owner (성준님) has made two decisions that are hard constraints, not suggestions:

1. **Attempt logs go in a brand-new, separate folder — never inside `downloads/seoyeori/characters/`.** That folder holds only the confirmed registry (`characters.json` + reference images) and must stay untouched by in-progress attempts. Create a new top-level folder for this: `downloads/seoyeori/ca_bank/` (sibling to `characters/`, not nested inside it). Structure under it:
   - `downloads/seoyeori/ca_bank/attempts.jsonl` — one JSON line per attempt (append-only log).
   - `downloads/seoyeori/ca_bank/<attemptId>/` — the generated images/assets for that attempt, if the generation pipeline produces files (check how the CA_BANK tab currently triggers generation — likely reuses an existing image-gen endpoint; this attempt folder is just where CA_BANK-specific outputs get copied/saved, parallel to how other tabs use `0X_` numbered subfolders under an episode code, but CA_BANK isn't an episode so don't force that convention here — a flat `<attemptId>/` per attempt is enough).
   - Verify the exact current CA_BANK tab file name and generation flow first (search for "CA_BANK" or "ca_bank" or "ca-bank" across `app/src/tabs/` and `app/src/components/`) before assuming paths — adapt to what you actually find rather than guessing blind.

2. **Look-key naming uses an abbreviated short form: `<2-letter romanized initials>_LK##`** (e.g. 지아 → `JA_LK01`, 지유 → `JY_LK01`), not a spelled-out word like `LOOK`. `LK` is fixed short for "look". Each new attempt that gets a look key increments `##` per character (zero-padded 2 digits, `01`, `02`, ...). Check `characters.json` (path: `downloads/seoyeori/characters/characters.json`) for how existing characters are keyed (likely by a `CH` field or similar character code) to derive the correct 2-letter initials per character — do not invent a new character-id scheme; derive the look-key prefix from whatever character identifier already exists in `characters.json`.

### Hard constraints
- Branch `cabank-attempt-log-r1` from `master`; commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Do not create or modify anything under `downloads/seoyeori/characters/`.** That is stage-4 territory (promotion) and out of scope here.
- Reuse existing infrastructure, don't rebuild it:
  - Credit tracking: `app/server/lib/creditUsage.js` (`getUsedCount(account, tool)` / `recordUsage(count, account, tool)`). This stage's "크레딧 트래커 연결" means **read-only display** of current usage counts relevant to CA_BANK attempts (e.g. show "이번 세션 N회 생성" using whatever `tool` key the CA_BANK generation call already uses to `recordUsage`) inside the CA_BANK tab UI — it does NOT mean building a new tracker. If CA_BANK's generation call doesn't already call `recordUsage`, add that one call (reusing the existing function signature) so usage is attributed correctly, but do not change `creditUsage.js` itself unless it's missing a capability you've confirmed by reading the file first.
  - Look at `app/src/tabs/CreditsTab.jsx` for the existing display pattern/style to match.

### 1) Backend: new endpoint `POST /api/academy-log`
Add to `app/server/proxy.js`, modeled on the existing `/api/genline-log` handler (~line 921) for structure/error-handling style (never throw to caller; log server-side and return 200 even on internal failure, since this must never block the CA_BANK generation flow):
- Body: `{ character, lookKey, prompt, result ('kept'|'discarded'|'pending'), note }`.
  - `character`: the character identifier as used in `characters.json`.
  - `lookKey`: `<initials>_LK##` as described above — compute the next `##` server-side by reading `attempts.jsonl` and counting existing entries for that character's initials (don't trust the client to avoid collisions).
- Appends one line to `downloads/seoyeori/ca_bank/attempts.jsonl`: `{ character, lookKey, prompt, result, note, at: <ISO timestamp> }`.
- Returns `{ ok: true, lookKey }` (the server-computed lookKey, so the frontend displays the actual assigned key).

### 2) Frontend: CA_BANK tab wiring
Find the actual CA_BANK tab component (search first, don't assume the filename). Add:
- After each generation attempt, call `POST /api/academy-log` with the attempt's character/prompt, `result: 'pending'` initially.
- Add a small "결과" control per attempt (keep / discard), which does a follow-up call (either a second `POST /api/academy-log` entry or, simpler, a `PATCH`-like append — given the log is append-only JSONL, just append a new line with the same `lookKey` and updated `result`; reading code should take the **last** entry per `lookKey` as current status) to update `result` to `'kept'` or `'discarded'`.
- Show the assigned `lookKey` next to each attempt once the server responds.
- Add a compact credit-usage readout (read-only, per the reuse note above) near the generation trigger button — e.g. "이번 세션 N회 생성, 크레딧 사용 M" using `getUsedCount` via whatever existing API route already exposes it (check `CreditsTab.jsx` for how it fetches this — likely an existing `/api/credits` or similar route; reuse it, don't add a new route for this alone unless none exists).

### Verification
- Confirm `downloads/seoyeori/ca_bank/` is created fresh (not nested in `characters/`) by the first real log write — test with a throwaway local call if a dev server is runnable in your environment, then delete the test entry/folder before finishing (don't leave test junk in the committed state — this is a data directory, likely gitignored; check `.gitignore` and if `downloads/` is ignored, no cleanup is needed since it won't be committed anyway — but still don't leave stray test files that would confuse the next real session).
- Grep the full diff for any accidental path under `downloads/seoyeori/characters/` — if found, stop and fix before committing.
- Confirm look-key generation for a brand-new character initials prefix starts at `01` and increments correctly across repeated calls (simulate 2-3 calls).

### Report (concise, Korean)
브랜치/커밋; 실제 CA_BANK 탭 파일 경로(가정과 다를 경우 뭐가 달랐는지); `ca_bank/` 폴더 구조 실제 모습; look-key 접두어를 `characters.json`의 어떤 필드에서 유도했는지; 크레딧 표시에 재사용한 기존 API 경로.

## 지시문 끝
