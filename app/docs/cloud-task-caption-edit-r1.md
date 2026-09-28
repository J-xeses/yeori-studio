# 클라우드 세션 작업 지시서 — 릴스 자막 줄바꿈·표시 시간 직접 편집 (2026-09-28)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 환경 **☁ Default(클라우드)** → Sonnet 5 / High → 아래 "지시문" 붙여넣기. 예상 $5 안팎.

---

## 지시문 (여기부터 복사)

Add manual caption editing for Instagram Reels in the video tab of the studio (React/Vite app in `app/`). Owner (성준님) wants to control **line breaks** and **how long each caption segment is shown**, instead of automatic 2-line wrapping and automatic timing.

### Hard constraints
- Branch `caption-edit-r1` from `master`; commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Korean UI copy. Do not touch `downloads/`, secrets, Flow scripts. Keep changes focused.

### How it works today (read these first)
- Caption text per cut: `cut.subtitle` (segments separated by ` / `), overridable per cut in `downloads/state/reel-overrides/{CODE}.json` via `POST /api/reel-finalize/override` (`app/server/proxy.js` ~3575, lib `app/server/lib/reelOverrides.js`). Timing override: `captionSegTiming` = `[[start,end], …]` seconds within the cut; `captionTimingAuto` marks auto (speech-synced) timings.
- Preview: `app/src/tabs/VideoTab.jsx` — `ReelCaptionOverlay` (full 9:16 layer, Gaegu font, `isDialogueSeg` → dark plate for dialogue), segments via `toSegments(...)`, `activeSegIdx` by playback time.
- Final render: `app/server/lib/reelFinalize.js` builds scenes for `app/scripts/handwriting_overlay.py`; the overlay already renders `\n` inside `text` as a line break, and wraps long lines automatically.
- Selftest `app/scripts/pipeline-selftest.js` item **F2** asserts preview rules == final rules; keep it passing (update both sides together).

### Build
1. **Line breaks**: in the reel caption edit UI (the existing caption edit mode in VideoTab), editing a segment uses a multi-line input where Enter inserts a line break. Store line breaks inside the segment as `\n` (keep ` / ` as the segment separator). Preview and final must both honor manual `\n` exactly; when a segment has a manual `\n`, do not auto-rewrap it (only wrap if a single line still exceeds the safe width).
   - Make sure nothing strips the `\n` on the way: `cleanCaption()` in reelFinalize collapses whitespace — keep single `\n`. Check the override save path and `toSegments`.
2. **Display duration per segment**: a compact timing editor for the selected cut showing each segment as a bar on the cut's timeline (start/end handles, snap 0.1s, min 0.5s). Dragging saves `captionSegTiming` via the override API and clears `captionTimingAuto` (manual timing must never be overwritten by the auto speech-sync — check `/api/reel-finalize/sync-captions` respects this). Provide "자동 타이밍으로 되돌리기".
3. Show a small hint in the UI: `Enter = 줄바꿈 · 막대 끝을 끌어 표시 시간 조절`.

### Verification
- `node --check` on changed server files; build or esbuild-parse `VideoTab.jsx`.
- Unit-level check (node) that a segment text with `\n` survives: override save → `applyOverrides` → reelFinalize scene `text` contains the same `\n`.
- Add a selftest item (e.g. `C3`) in `pipeline-selftest.js` for: manual `\n` preserved end-to-end, and manual timing not overwritten by auto sync.

### Report (Korean, concise)
Branch + commits; what changed; what needs a live check in the studio (exact clicks).

## 지시문 끝
