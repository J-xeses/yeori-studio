# 클라우드 세션 작업 지시서 — 리더: G4 승인된 대사 컷에 run-sts 자동 호출 (2026-11-04)

> 사용법: claude.ai/code 에서 저장소 **J-xeses/yeori-studio** 로 새 클라우드 세션을 열고, 아래 "지시문" 전체를 붙여 넣는다.
> 작업은 브랜치 `leader-runsts-hook-r1` 에서만. 합치기·실서버 확인은 로컬 Claude 가 한다.

---

## 지시문 (여기부터 복사)

This repo (yeori-studio) has a voice-conversion pipeline: a Veo-generated dialogue clip (`cut_NN.mp4`) has its voice track converted to the character's actual voice via ElevenLabs speech-to-speech, producing `cut_NN_final.mp4`. The endpoint for this already exists and works: `POST /api/mcp/run-sts` in `server/proxy.js` (search `pipeline-leader 용 (인증)` near line ~9796 — read the full handler, it takes `{episodeId, cutNo, character, voiceId}` and calls `runSts()` from `server/lib/sts.js`). Today this is only triggered **manually** — a human clicks "🎙️ 음성 변환" in the separate Field Gate app (not in this repo). The gap: `scripts/pipeline-leader.js` (the autonomous pipeline loop that already auto-triggers G3 TTS, auto-approves G3/making-G4, etc.) never calls this endpoint. This task wires that up.

### Read first (do not skip)
- `scripts/pipeline-leader.js` in full, especially: the main cycle function (search `checkAndAdvance` or similar), the G3 section (search `── G3 트리거` around line ~447) for the exact pattern of how it finds candidate cuts and calls an MCP endpoint (`api('POST', '/api/mcp/studio-run-g3', ...)`), the G4 section (search `── G4:` around line ~474) for how `cuts`, `c.g4`, `c.hasVideo`, `c.cutType` are used, and the `madeUnapproved`/`shouldAutoApprove('making', c)` loop (~line 426-444) for the auto-approval flow a dialogue cut goes through. Also check `needsG3(c)` (defined somewhere in this file or an import) to see the exact field name used for "this cut has dialogue" (likely `c.dialogue` — confirm, don't assume).
- `server/lib/sts.js` — `runSts({ epNum, cutNo, voiceId, apiKey, charTag, voiceSettings, onLog })` and `resolveVoice({...})`.
- `server/proxy.js` `/api/mcp/run-sts` handler in full (how it resolves `apiKey`, `epNum`, `charTag`, voice — mirror the same resolution logic conceptually, but you're calling the endpoint over HTTP via this file's existing `api()` helper, not importing `runSts` directly — follow the same pattern as the G3 trigger call).
- `server/lib/mediaPaths.js` `videoDir(epNum)` (already imported in `pipeline-leader.js` as `mp`) — use this to build the path for checking `cut_NN_final.mp4` existence via `fs.existsSync` (fs already imported too).

### Task
In the G4 section of `pipeline-leader.js`'s main cycle (near the existing `madeUnapproved`/G4 code, or wherever you judge fits the file's existing structure best — follow its conventions for where cycle flags like `didTrigger`/`cycleBlocker` get set):
1. Find candidate cuts: `cutType === 'YEORI'`, `c.g4 === true` (G4-approved — either by human click or by the existing making-type auto-approval; dialogue YEORI cuts per `GATE_POLICY.G4` are `delegable: 'making-only'` so they're human-approved, but you don't need to care how they got approved, just that `g4` is true now), has dialogue (confirm the right field — likely `c.dialogue?.trim()`), and `cut_NN_final.mp4` does **not** yet exist on disk for this cut (so you don't re-trigger every cycle — this is the dedup check, mirroring how `needsG3`/`!c.hasAudio` dedups the G3 trigger).
2. For each such cut, call `POST /api/mcp/run-sts` with `{ episodeId: EPISODE_ID, cutNo: c.no }` (character/voiceId can be omitted — the endpoint already resolves defaults from `characters.json`/`speakerVoices`, confirm this by reading the handler) using this file's existing `api()` helper, the same way the G3 trigger does it.
3. Log via the existing `log(...)` helper and `leaderLog({...})` pattern (stage `'G4'`, kind `'자동실행'` on success / `'블로커'` on failure, `humanInvolved` accordingly) — copy the exact shape used by the neighboring G3 trigger block for consistency.
4. **Rate/scope guard**: process at most one cut per cycle (same "one at a time" caution the G4 Veo-clip-submission code nearby uses, if you see that pattern — `run-sts` calls an external paid API, so don't fire off a batch of N cuts in one cycle without checking whether the rest of this file treats external-paid-API calls conservatively; follow its existing convention, don't invent a new concurrency model).
5. This must be **opt-in like the rest of the leader's delegation model** — check whether this should be gated behind the same `AUTO_APPROVE`/Notion policy mechanism (`getLeaderContext`) the rest of the file uses, or whether it's safe to always run since it only acts on already-G4-approved cuts (a human or the existing policy already signed off on the cut; STS is a mechanical post-process, not a new approval). Make a judgment call, document it clearly in your report, and prefer the more conservative choice if genuinely unsure.

### Hard constraints
- Create branch `leader-runsts-hook-r1` from `master`, commit there, push the branch. Never push to or merge into `master`.
- **If the same command fails 3 times in a row, stop immediately, commit whatever is done, and report it instead of retrying further.** Do not loop.
- Change only `scripts/pipeline-leader.js`. No other files, no server-side endpoint changes (the endpoint already works), no `downloads/` media, no `studio-secrets.json`.
- **You cannot run the live pipeline-leader process or call the real ElevenLabs/Notion APIs here.** Do static checks only (see Verification). Do not claim a live run.

### Verification (required)
- `node --check scripts/pipeline-leader.js` passes.
- Trace through your added code by hand against 2-3 synthetic cut objects (YEORI+dialogue+g4+no-final-file → should trigger; YEORI+dialogue+g4+final-file-exists → should skip; non-YEORI or no-dialogue or g4-false → should skip) and show this reasoning in your report.

### Report (concise, Korean)
브랜치 + 커밋; 추가한 트리거 조건(필드명 확정본) 요약; 중복 호출 방지(파일 존재 체크) 로직; AUTO_APPROVE 정책 연동 여부와 그 판단 근거; 라이브로 확인 못 한 부분 명시.

## 지시문 끝
