# 클라우드 세션 작업 지시서 — 손글씨 오버레이: 비표준 이모티콘 대응 + 단어 단위 강조 (2026-11-04)

> 사용법: claude.ai/code 에서 저장소 **J-xeses/yeori-studio** 로 새 클라우드 세션을 열고, 아래 "지시문" 전체를 붙여 넣는다.
> 작업은 브랜치 `handwriting-emphasis-r1` 에서만. 합치기·실서버 확인은 로컬 Claude 가 한다.

---

## 지시문 (여기부터 복사)

This repo (yeori-studio) has a Pillow-based handwriting-bubble overlay renderer: `app/scripts/handwriting_overlay.py`. It draws hand-lettered-style annotation bubbles (speech-bubble/thought-bubble/no-backing text) over images/video frames, using bundled fonts (`NanumPenScript-Regular.ttf`, `Gaegu-Bold.ttf`) and a separate emoji font for true Unicode emoji. It already handles: hearts/stars as hand-drawn vector glyphs (`_HEART_CHARS`/`_STAR_CHARS`, `_draw_vector_heart`/`_draw_vector_star`), true emoji via a dedicated emoji font (`EMOJI_FONT_PATH`, `is_emoji()`, `split_runs()`), a whole-bubble wavy underline (`draw_wavy_underline`, gated by `scene["underline"]`), and a fixed decorative tick mark drawn once per bubble (`draw_ticks`, called once near the top of each bubble — search for its call site around line ~570 in `render_scene`).

**Before changing anything, verify these two specific gaps still exist** (don't assume — confirm by reading the code, this task description is based on a point-in-time read that could be stale by the time you run):

### Gap 1 — kaomoji / complex Unicode emoticons render as tofu (missing-glyph boxes)
`is_emoji(ch)` (check its implementation) only recognizes actual Unicode emoji codepoints. A kaomoji like `>_<` (plain ASCII, fine, renders in the handwriting font already) is different from something like `๑˃̵ᴗ˂̵๑` (Thai digit + IPA/combining-diacritic characters used decoratively as a "cute face") — these characters are not emoji, not in `_HEART_CHARS`/`_STAR_CHARS`, not in the small literal punctuation whitelist (`"!", "?", "·", "‧", "～", "~", "…", ".."` in `draw_deco_glyph`), so they fall through to being drawn in the handwriting font (`NanumPenScript`/`Gaegu-Bold`), which almost certainly has no glyphs for Thai script or combining IPA extensions → renders as tofu/empty boxes.
**Fix**: in `draw_mixed_text`/`draw_deco_glyph` (whichever is the right layer — read both, decide), detect characters the active text font cannot actually render (PIL/Pillow: check the font's glyph table, e.g. via `font.getmask(ch)` being empty/zero-size, or a font library glyph-existence check — don't guess, verify what Pillow's `ImageFont` API actually exposes for this) and fall back to the emoji font (`EMOJI_FONT_PATH`) for those specific characters if it has them, else skip the character cleanly (never render a visible tofu box) and log a one-line warning (don't crash).

### Gap 2 — no per-word/phrase emphasis, only whole-bubble underline
`scene["underline"]` is a single boolean that underlines the **entire** bubble's text. There's no way to emphasize just one word or phrase within a longer annotation (e.g. "이거 완전 **대박**이야" with only "대박" getting a tick-mark/underline/color accent). `draw_ticks` is called once per bubble at a fixed position, not word-driven.
**Fix**: add support for marking specific substrings for emphasis within `text` — pick a simple, unambiguous markup your renderer can parse without breaking existing annotations that don't use it (e.g. wrapping the emphasized span in a marker pair like `*대박*` or `**대박**` — check `app/scripts/handwriting_overlay.py`'s existing text-escaping/parsing to make sure you don't collide with the existing `_STAR_CHARS` use of `*`/`＊` as a decoration glyph; if there's a collision, pick a different marker, e.g. `__대박__` or `<<대박>>`, your call — document whichever you pick clearly). When rendering, strip the markers from the displayed text and draw a short wavy underline (reuse `draw_wavy_underline`) or the existing tick style (reuse `draw_ticks`) under just that word's rendered bounding box (you'll need per-run x-position tracking — `draw_mixed_text` already tracks `x` as it advances per run, extend that to record the start/end x of marked spans).

### Scope discipline
Gap 1 is the higher-confidence, lower-risk fix — prioritize it and make sure it's solid. Gap 2 is more involved (new markup syntax, bounding-box tracking) — attempt it, but if it's taking materially longer than Gap 1, commit Gap 1 cleanly first, then continue with Gap 2 in a follow-up commit on the same branch. If you determine during investigation that either gap **no longer exists** (already fixed since this doc was written), say so plainly in your report and skip it — do not invent busywork to justify the session.

### Verification (required, no real server/browser available)
- Write a small throwaway test script (`python` or add to the existing `scripts/hw-preview.mjs` pattern if you prefer, your call) that renders a synthetic test image with: (a) a kaomoji string using non-ASCII combining/Thai characters, confirming no tofu boxes and no crash; (b) an annotation using your new emphasis markup, confirming the marker characters don't appear in the rendered output and the emphasized word visibly gets its accent. Save the rendered PNG(s) somewhere temporary (not committed) and describe what you see in the image (you can read the PNG back with your own image-reading capability if available, or at minimum confirm via code — e.g. sampling pixel colors at expected mark locations — that *something* was drawn there vs. a pure no-op).
- Confirm existing annotations (no kaomoji, no emphasis markup, `underline: true/false` as before) render byte-identical to before your change — run the existing render path on a plain-text example and diff dimensions/non-crash at minimum.
- `python -m py_compile app/scripts/handwriting_overlay.py` (or equivalent) passes.

### Hard constraints
- Create branch `handwriting-emphasis-r1` from `master`, commit there, push the branch. Never push to or merge into `master`.
- **If the same command fails 3 times in a row, stop immediately, commit whatever is done, and report it instead of retrying further.** Do not loop.
- Change only `app/scripts/handwriting_overlay.py` (and, only if the same emphasis-markup/font-glyph-check logic is duplicated there for preview purposes, `app/scripts/hw-preview.mjs` — but only if it duplicates rendering logic that would otherwise drift out of sync; check first, don't touch it speculatively). Do **not** touch `C:\yeori-studio`'s Node/JS handwriting files that belong to the separate yubi-director app (that's a different, non-git-connected project entirely — not reachable from this repo anyway).
- No `downloads/` media required — use synthetic test images/text you generate yourself for verification.

### Report (concise, Korean)
브랜치 + 커밋; Gap 1·Gap 2 각각 실제로 존재했는지(검증 결과) + 어떻게 고쳤는지; 선택한 강조 마크업 문법과 그 이유(`*` 충돌 회피 등); 기존 주석(마크업 없는 것들) 하위호환 확인 방법; 합성 테스트로 확인한 것과 못한 것.

## 지시문 끝
