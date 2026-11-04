# 클라우드 세션 작업 지시서 — VP 대사 세그먼트 3단계: 세그별 TTS (2026-11-04)

> 사용법: claude.ai/code 에서 저장소 **J-xeses/yeori-studio** 로 새 클라우드 세션을 열고, 아래 "지시문" 전체를 붙여 넣는다.
> 작업은 브랜치 `vp-seg3-tts-r1` 에서만. 합치기·실서버 확인은 로컬 Claude 가 한다.

---

## 지시문 (여기부터 복사)

You are implementing stage 3 of a 3-stage feature in this repo (yeori-studio, a Korean AI-influencer content pipeline app). Stages 1 and 2 are done: cuts longer than 10s get split into Veo-generation-unit segments (8s/10s combos, e.g. `[8,8,10]`) stored as `cut.segments` in `studio-state.json`. This lets a long dialogue cut be generated as multiple Veo clips (`cut_NN_clip_K.mp4` naming — confirm exact convention yourself by reading `server/proxy.js` around the `/api/cut-timing` handler at line ~7967 and `/api/upload-cut-video` at line ~8178, plus any code that writes/reads `cut_NN_clip_*` filenames). What's missing is segment-aware TTS: today, `POST /api/mcp/studio-run-g3` (`server/proxy.js`, starts ~line 9310, function body runs to ~line 9420ish — read the whole handler) always generates **one** `cut_NN.mp3` per cut regardless of `cut.segments`, so a 3-segment video clip has no way to get 3 time-aligned audio pieces.

### Read first (do not skip)
- `app/src/lib/vpDialogue.js` — `SEG_UNITS`, `computeSegmentPlans(duration)`, `splitDialogueBySeg(text, segCount, {segSecs})` (already splits dialogue text into N segments by sentence/breath boundaries, segment-length-weighted), `deriveTrim`. These are the exact pure functions you need — do not reimplement the splitting logic, import and reuse it.
- `server/lib/ttsText.js` — `cleanForTTS`, `applyReadings` (already used by `studio-run-g3`).
- `server/proxy.js` `studio-run-g3` handler in full (search `⑥ studio-run-g3`) — understand `splitSpeakerSegments`, `concatMp3Files`, `elevenLabsTTS`, `voiceFor`, the `narrOnly` (IG_R reels) branch, and the existing per-cut-not-per-segment file naming (`cut_${padded}.mp3`, or `cut_${padded}_nr.mp3` for reel narration-only).
- `docs/vp-dialogue-seg-spec.md` — the full spec for the segment model (read §2-1/2-1b/2-1c/§4 at minimum).

### Task
Extend `studio-run-g3` so that when a target cut has `cut.segments` with `length > 1`:
1. For each segment index `k` (1-based), compute that segment's slice of the dialogue/narration text using `splitDialogueBySeg` (reuse exactly — do not write a new splitter), run it through the **existing** per-segment pipeline (speaker-segment splitting via `splitSpeakerSegments`, `cleanForTTS`, `applyReadings`, per-speaker voice resolution via `voiceFor`, ElevenLabs TTS call, per-part concat) to produce one mp3 for that segment.
2. Save each segment's audio as `cut_${padded}_s${k}.mp3` (k = 1-based segment index) in the same `audioDir` the existing code already resolves. Also still produce the whole-cut `cut_${padded}.mp3` (or `_nr.mp3` for reel narration) by concatenating the segment files in order — **keep full backward compatibility**: any code reading `cut_NN.mp3` today must keep working unchanged.
3. Cuts without `segments` (or `segments.length <= 1`) must go through the **exact existing code path**, byte-for-byte unchanged behavior — this is a pure addition, not a rewrite. Add the segment branch as a new code path that only triggers when `cut.segments?.length > 1`.
4. ElevenLabs character-count pre-check: make sure the existing "잔여 글자수" check still sums correctly across all segments of all target cuts (don't double count, don't undercount).
5. Response JSON: for segmented cuts, include per-segment results (`segments: [{ seg, path, speakers, voices }, ...]`) alongside the existing whole-file `path`, so the client can show per-segment status.

### `/api/cut-timing` (GET, `server/proxy.js` ~line 7967)
Read the full handler. If it reports per-cut audio/video info, extend it to also report, for cuts with `segments`, each segment's expected audio file path (`cut_NN_s{k}.mp3`) and whether it currently exists on disk (`fs.existsSync`) — so the UI/leader can tell "2 of 3 segments generated" at a glance. Match the existing response shape/style exactly; add fields, don't restructure what's already there.

### Hard constraints
- Create branch `vp-seg3-tts-r1` from `master`, commit there, push the branch. Never push to or merge into `master` (an hourly bot commits to master; the local Claude merges after live checks).
- **If the same command fails 3 times in a row, stop immediately, commit whatever is done, and report it instead of retrying further.** Do not loop.
- Change only `server/proxy.js` (the `studio-run-g3` and `/api/cut-timing` handlers), and only if strictly necessary, small additions to `app/src/lib/vpDialogue.js` (e.g. exporting something not yet exported) — do not change its existing function bodies/behavior. No other files. No `downloads/` media, no `studio-secrets.json` (you don't have it and can't test live ElevenLabs calls — that's expected, see Verification).
- Do not touch G5 assembly/reel-finalize logic (`server/lib/reelOverrides.js` or similar) — stitching segment video+audio together into the final reel is explicitly **out of scope** for this task, a separate follow-up. This task only produces the per-segment audio files and reports their existence.
- **You cannot reach `localhost:3001` or call the real ElevenLabs API** (no key, no live server). Do static/unit checks only (see Verification). Do not attempt to start the server or claim you tested a live TTS call.

### Verification (required)
- `node --check server/proxy.js` (or equivalent syntax check) passes.
- Write a small standalone Node test script (not committed, or committed under `scripts/` if you think it's reusable — your call) that imports `computeSegmentPlans`/`splitDialogueBySeg` from `vpDialogue.js` and a stubbed/mocked version of your new segment-splitting logic (mock `elevenLabsTTS`/fs writes) to confirm: a 3-segment cut produces 3 segment calls with non-overlapping, correctly ordered dialogue slices, and a 1-segment/no-segments cut produces exactly the old single call. Report what you tested and the output.
- Confirm the no-segments code path is byte-identical in behavior by diffing your changed function against the original — explicitly state in the report that you preserved it.

### Report (concise, Korean)
브랜치 + 커밋 목록; `studio-run-g3`에 추가된 세그 분기 요약; `cut-timing` 응답에 추가된 필드; 무세그 컷 하위호환 확인 방법; 라이브 ElevenLabs 호출로 확인 못 한 부분 명시.

## 지시문 끝
