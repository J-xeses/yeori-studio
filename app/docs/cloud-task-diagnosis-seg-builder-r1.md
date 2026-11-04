# 클라우드 세션 작업 지시서 — 진단 패널에 세그 분할 빌더 통합 (2026-11-04)

> 사용법: claude.ai/code 에서 저장소 **J-xeses/yeori-studio** 로 새 클라우드 세션을 열고, 아래 "지시문" 전체를 붙여 넣는다.
> 작업은 브랜치 `diagnosis-seg-builder-r1` 에서만. 합치기·실서버 확인은 로컬 Claude 가 한다.

---

## 지시문 (여기부터 복사)

This repo (yeori-studio) has a separate standalone app (`C:\yeori-genline`, a different git repo — **you cannot and should not try to access it**, it is not in this repository) that has a "세그 분할" (segment split) tab: for a dialogue cut longer than 10s, it shows candidate ways to split it into Veo-generation-unit segments (8s/10s combinations like `8+8+10`), ranked by least trim, each card showing the per-segment dialogue preview, with an "적용" (apply) button. The roadmap item (documented 2026-09-20) is to bring this same capability into the main studio app's `VideoTab`/`DiagnosisPanel`, so users don't need the separate app for this one feature.

### Read first (do not skip)
- `app/src/lib/vpDialogue.js` — `SEG_UNITS`, `computeSegmentPlans(duration)` (pure function: given a duration, returns possible segment combinations sorted by ascending trim), `splitDialogueBySeg(text, segCount, {segSecs})` (splits dialogue text per segment), `deriveTrim`. These already exist in this repo (unlike the Field Gate app, which has a vanilla-JS port of the same logic) — **import and reuse them directly, do not reimplement or port anything.**
- `app/src/components/DiagnosisPanel.jsx` (+ `.module.css`) — the existing AI-diagnosis popup (opened from `VideoTab.jsx` line ~2946, `<DiagnosisPanel cut={dc} episodeCode={episodeCode} stage="G4" onClose={...} />`). It already has `parseSeg` (validates an 8/10 combo string) and `scriptBodyToPatch` (turns a `script` fix body with a `SEG:` line into an `UPDATE_CUT` patch) — read these to understand the existing SEG-handling conventions and the `UPDATE_CUT` dispatch pattern used throughout this component.
- `app/src/tabs/VideoTab.jsx` — confirm there is currently **no** segment-builder UI (grep for `computeSegmentPlans`/`세그 분할`/`SegmentBuilder` returns nothing today). Find where cut duration (`cut.duration` or `masterCode.du`) and `cut.dialogue`/`cut.narration` are available in this file's cut-detail view, to decide where the new UI mounts.
- `docs/vp-dialogue-seg-spec.md` §2-1/2-1b/2-1c — the segment model spec, for card copy/labels consistency with existing terminology (트림, 생성단위, etc).

### Task — new "세그 분할" section in DiagnosisPanel
1. Add a new tab/section inside `DiagnosisPanel.jsx` (alongside its existing chat/diagnosis UI — your call on exact placement, but keep the existing AI-chat functionality fully intact and unchanged) that only renders when `cut.duration > 10` (or the `DU>10` threshold already used elsewhere in this codebase — confirm the exact threshold value from `vpDialogue.js`/the spec and reuse it, don't invent a new one).
2. Call `computeSegmentPlans(cut.duration)` to get candidate combinations (cap at ~6 cards, least-trim-first — follow the same cap/sort Field Gate uses per the spec, since that's the established UX this is porting).
3. For each candidate combo, call `splitDialogueBySeg(dialogueText, combo.length, {segSecs: combo})` to preview the per-segment dialogue text on the card.
4. Each card gets an "📝 이 조합 반영" button. Unlike Field Gate (which must round-trip through a `codi-gen-handoff` queue because it's a separate app), **this runs inside the actual studio app already** — on click, dispatch `UPDATE_CUT` directly with `{ segments: combo }` (follow the exact dispatch pattern already used elsewhere in `DiagnosisPanel.jsx`/`VideoTab.jsx`, e.g. `dispatch({ type: 'UPDATE_CUT', id: cut.id, p: { segments: combo } })`). No new handoff mechanism, no new API endpoint needed for this — it's a local state update like any other field edit in this app.
5. Visually distinguish the currently-applied combo (if `cut.segments` already matches a card's combo, mark that card as "현재 적용됨").
6. Style: reuse `DiagnosisPanel.module.css` conventions (check its existing class naming/visual language) rather than inventing a new design language for this section.

### Hard constraints
- Create branch `diagnosis-seg-builder-r1` from `master`, commit there, push the branch. Never push to or merge into `master`.
- **If the same command fails 3 times in a row, stop immediately, commit whatever is done, and report it instead of retrying further.** Do not loop.
- Change only `app/src/components/DiagnosisPanel.jsx`, `app/src/components/DiagnosisPanel.module.css`, and (only if a prop needs threading through) `app/src/tabs/VideoTab.jsx`'s existing `<DiagnosisPanel .../>` call site. No other files, no server-side changes, no `downloads/` media, no secrets.
- Do not modify `app/src/lib/vpDialogue.js`'s existing exported function behavior — import-only. If something isn't exported that you need, add an export, don't change the function body.
- **You cannot run the dev server or a browser here.** Do static checks only (see Verification). Do not claim a live UI check.

### Verification (required)
- The project uses Vite + React (no TypeScript build step for this check) — run whatever lint/build command this repo defines (check `package.json` scripts, e.g. `npm run build` or `npx vite build`) and confirm no errors from your changed files specifically (pre-existing unrelated errors elsewhere, if any, don't block you — note them if seen).
- Manually trace through `computeSegmentPlans`/`splitDialogueBySeg` with 2-3 example durations/dialogue strings (can write a throwaway Node script importing the module) to confirm your card-rendering logic consumes their actual return shape correctly (don't guess the shape — read the function source).

### Report (concise, Korean)
브랜치 + 커밋; DiagnosisPanel 어디에 어떤 UI를 추가했는지; UPDATE_CUT 반영 흐름 요약; threshold(DU>10 등) 어디서 가져왔는지; 빌드/정적 검증 결과; 브라우저로 확인 못 한 부분 명시.

## 지시문 끝
