# 클라우드 세션 작업 지시서 — 진단 패널에 판정(통과/재작업) + 서버 기록 연결 (2026-10-28)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 새 세션(Sonnet 5 / High) → 아래 "지시문" 붙여넣기.
> 예상 비용 $3~6 (순수 프런트 와이어링, 백엔드 엔드포인트는 이미 존재).
> **규칙: 같은 명령이 3번 연속 실패하면 즉시 멈추고 보고.**

---

## 지시문 (여기부터 복사)

You are extending **`app/src/components/DiagnosisPanel.jsx`** (React) in the yeori-studio app. This panel is a port of the standalone tool `C:\yeori-genline\index.html` ("Field Gate") into the studio. Read `C:\yeori-genline\README.md` first (if not available in your environment, infer from the code below) — it documents two gaps versus the original tool that this round fixes:
1. Field Gate has a **판정(verdict) button** (✓ 통과 / ↻ 재작업) in its header, written to `.genline-review.json` + the agent leader log DB. The ported `DiagnosisPanel.jsx` has no such button at all.
2. Field Gate persists each turn to the server (`.genline-review.json`); the ported panel only keeps the conversation thread in **localStorage** (`lsKey`/`loadThread`/`saveThread` near the top of the file) — nothing survives a browser data clear or reaches the agent leader log.

Both gaps are fixed by wiring to **two backend endpoints that already exist and need no changes** — read them in `app/server/proxy.js` before writing any frontend code:
- `POST /api/genline-review` (~line 933): body `{ episodeId, cutNo, kind: 'ip'|'script'|'note'|'verdict', value, meta }`. Appends to `downloads/…/<episodeCode>/01_script/.genline-review.json` under `cut_<cutNo>`. `kind: 'verdict'` is already an accepted value in its own doc comment.
- `POST /api/genline-log` (~line 921): body `{ episode, stage: 'G2'|'G4', kind, summary, rationale, result, humanInvolved }`. Writes one row to the agent leader log DB (Notion) via `postLeaderLog`. Never throws to the caller (always resolves, even on failure) — don't add extra error UI beyond a quiet toast.

### Hard constraints
- Branch `diagnosis-verdict-r1` from `master`; commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Touch only `app/src/components/DiagnosisPanel.jsx` and its `.module.css`. No new backend routes — the two endpoints above already do everything needed.
- Korean UI copy, matching the panel's existing tone (see existing buttons: `🧹 초기화`, `닫기`).
- `episodeId` is **not** a prop of this component today (`episodeCode` is). Get the active episode id from `useApp()` — look at `app/src/context/AppContext.jsx` for `state.activeEpisodeId` and use that. If the panel can be open for a non-active episode in some call site, read the actual call sites (`app/src/tabs/VideoTab.jsx`, `app/src/tabs/CheckupTab.jsx`, `app/src/components/CheckupEffectsSidebar.jsx`) to confirm this assumption holds; if it doesn't, thread `episodeId` down as a new prop from those three call sites instead of guessing.

### 1) Verdict buttons
- Add `✓ 통과` / `↻ 재작업` buttons in the header (`s.head`), next to the existing `🧹 초기화` / `닫기` buttons. Disabled when `!thread.length` (nothing to judge yet) and while `busy`.
- On click:
  - `POST /api/genline-review` with `{ episodeId, cutNo: cut.no, kind: 'verdict', value: 'pass' | 'retry', meta: { stage, summaryLine: <last ai message's summaryLine if any> } }`.
  - `POST /api/genline-log` with `{ episode: episodeCode, stage, kind: value === 'pass' ? '사람선택' : '반려감지', summary: \`CUT ${cut.no} 판정: ${value === 'pass' ? '통과' : '재작업'}\`, result: '', humanInvolved: true }`.
  - Show a brief inline notice (reuse the existing `notice`/`setNotice` state) confirming the verdict was recorded. Don't block the UI on the network calls (fire-and-forget is fine given the endpoints never throw) but do surface a failure notice if either `fetch` itself rejects (network down).
  - After a verdict, keep the thread visible (don't auto-close the panel) — the owner may still want to copy a fix before closing.

### 2) Persist each turn, not just localStorage
In `send()`, after a successful AI response is committed (after the existing `commit([...withMe, ai])` call), also fire `POST /api/genline-review` with `kind: 'note'` and `value` = the user's message + AI's `summaryLine` (a short combined string is fine — this is a durable breadcrumb, not meant to replace the localStorage thread which stays the primary UI source of truth). Do the same for `applyFix()` — when `act` is `'ip'`, `'vp'`, or `'script'`, additionally call `/api/genline-review` with `kind: 'script'` for the script case and `kind: 'ip'` for both `ip`/`vp` cases (reuse `'ip'` for vp too — there's no separate `vp` kind in the existing endpoint), `value` = `f.body`. These calls are secondary/best-effort: don't let a failure block `markApplied()`.

### Verification
- Parse every JS/JSX file you touch for syntax errors (`node --check` won't work on JSX — use `npx vite build` or an equivalent bundler check if available in your environment; otherwise careful manual review).
- No literal `undefined` rendered in the UI.
- Confirm with a headless browser if available: open a cut's diagnosis panel (server likely offline in your environment — verify the empty/offline states still render and the new buttons are present and correctly disabled with no thread).

### Report (concise, Korean)
Branch + commits; which call sites needed `episodeId` threaded through (if any); anything about the `genline-review`/`genline-log` endpoints that didn't match this instruction's assumptions.

## 지시문 끝
