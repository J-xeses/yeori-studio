# 클라우드 세션 작업 지시서 — 에이전트 리더 탭 Phase 2: 리더 채팅을 실제 리더 상태에 연결 (2026-11-04)

> 사용법: claude.ai/code 에서 저장소 **J-xeses/yeori-studio** 로 새 클라우드 세션을 열고, 아래 "지시문" 전체를 붙여 넣는다.
> 작업은 브랜치 `leader-chat-context-r1` 에서만. 합치기·실서버 확인은 로컬 Claude 가 한다.

---

## 지시문 (여기부터 복사)

This repo (yeori-studio) has `app/content_matrix_v3.html`, whose "🤖 에이전트 리더" tab contains a leader chat box (`sendLeaderChat()`, search `// ── 리더 채팅 ──` around line ~3258). Today that chat builds its system prompt only from studio-state + `/api/pipeline/status` + `/api/studio-status-public`. It does **not** see the real pipeline-leader's decision layer (Notion episode row: current gate, agent state, blocker, next action, hold, auto-approve delegation, pending-human items, recent leader log). A "🔔 승인 필요" panel was just added in the same file (functions prefixed `lap…`, search `승인 필요 패널 (에이전트 리더 탭 Phase 1)` near the end of the script) and already reads that data. This task connects the chat to the same data and gives it a few safe actions, so the user can talk to one place.

### Read first (do not skip)
- `app/content_matrix_v3.html`:
  - `sendLeaderChat()` in full, including its action loop (`create_episode`, `script_upload`, `pipeline_start`, `pipeline_stop`) and `renderLeaderChat()`.
  - The Phase 1 panel code: `lapGetJson()`, `lapResolveEpisode()`, `lapActiveEp`, `lapGateData`, `lapEsc()`, `lapRefreshAll()`, `lapApprove()`. **Reuse these; don't write parallel copies.**
- `app/server/proxy.js` — the unauthenticated `/mobile/*` aliases this file must use (`/api/mcp/*` needs a Bearer secret this HTML must never hold): `GET /mobile/active-episode`, `GET /mobile/leader-status?episode=CODE` (returns `getLeaderStatus()` from `server/lib/leaderRead.js`: `{ episode:{currentGate,agentState,nextAction,blocker,lastCycle,hold,autoApprove,url,...}|null, pendingHuman:[{at,episode,stage,kind,summary}], recentLog:[{at,stage,kind,summary,result,source}] }`), `POST /mobile/studio-approve-g4` `{episodeId, cutIds}`, `POST /mobile/mobile-hold` `{episodeId?, hold:boolean}`, `POST /mobile/leader-log` (`server/lib/leaderLog.js` `postLeaderLog`: `{episode, stage, kind, source, summary, rationale, result, humanInvolved}`; allowed `stage` ∈ G1..G6/making/사이클, `kind` ∈ 자동실행/승인대기/자동승인/반려감지/블로커/생성시도/재생성/사람선택/사이클요약, `source` ∈ pipeline-leader/genline/사람).
- `app/server/lib/leaderRead.js` `formatLeaderStatus()` — the server's existing human-readable layout of the same data; mirror its wording/order for the prompt section (write a small client-side equivalent, don't add a server route).

### Task
1. **Context.** In `sendLeaderChat()`, after the existing context fetches and with the same non-fatal try/catch style, call `lapResolveEpisode()` then `lapGetJson('/mobile/leader-status?episode=…')`. Add a section to the system prompt, `=== 리더 판단 상태 (Notion) ===`, with: current gate, agent state, hold, auto-approve delegation, blocker, next action, last cycle, up to 5 pendingHuman items, up to 6 recentLog items. If it fails, write one line `(리더 상태 못 읽음: <msg>)` instead — never block the chat.
   Also add `=== 게이트 검수 (승인 패널 캐시) ===` from the existing `lapGateData` (ready cut numbers / blocked count per G3·G4·G5). **Do not call `/mobile/gate-eligibility` from the chat** (it runs ffmpeg checks, heavy) — use the cache only, and say `(아직 검수 안 됨)` if empty.
2. **New actions** (add to the prompt's action list and to the action loop; keep the 4 existing actions exactly as they are):
   - `approve_g4` `{cutIds?}`: default `cutIds` = `lapGateData.G4.ready`. **Must ask the user with `confirm()` before calling** `/mobile/studio-approve-g4` (same as `lapApprove`); if declined, label "G4 승인 취소됨". After success call `lapRefreshAll(false)`. Prefer reusing `lapApprove` logic (e.g. factor its fetch part into a helper both call) over duplicating it.
   - `set_hold` `{hold:true|false}` → `POST /mobile/mobile-hold` with the active episode id; label the result; then `lapRefreshAll(false)`.
   - `log_decision` `{summary, stage?, rationale?}` → `POST /mobile/leader-log` with `source:'사람'`, `kind:'사람선택'`, `humanInvolved:true`, `episode` = active episode code, `stage` default `'사이클'` (clamp to the allowed set). Purpose: when the user states a decision in chat ("컷3은 재생성 말고 그대로 가자"), it gets recorded in the Notion leader log that the real leader reads.
   - In the prompt, state clearly: G1·G2·G3·G5 approval is **not** available from chat (policy: human in studio; G3 has no unauthenticated route). If asked, answer where to do it instead of emitting an action.
3. **Safety fix in rendering.** `renderLeaderChat()` currently injects `m.content` into innerHTML unescaped. Escape it with `lapEsc()` (keep `white-space:pre-wrap` so line breaks still show). Same for `m.action`.
4. Keep `max_tokens` large enough for the longer prompt (1500 is fine) and keep the model string as is.

### Hard constraints
- Create branch `leader-chat-context-r1` from `master`, commit there, push the branch. Never push to or merge into `master`.
- **If the same command fails 3 times in a row, stop immediately, commit whatever is done, and report it instead of retrying further.** Do not loop.
- Change only `app/content_matrix_v3.html`. No server changes, no new routes, no secrets, nothing under `downloads/`.
- Don't change the Phase 1 panel's behavior/polling, `startPipeline/stopPipeline/pollPipelineStatus`, the agent cards, or the 4 existing chat actions.
- No autonomous behavior: every new action runs only because the user typed a request in chat, and `approve_g4` additionally needs the `confirm()` click.
- **You cannot run the server, open a browser, or call Notion/Anthropic here.** Static checks only; don't claim a live check.

### Verification (required)
- Extract every inline `<script>` from the HTML and syntax-check it (e.g. `node -e` with `new Function(src)`), 0 errors.
- Hand-trace: (a) leader-status fetch fails → chat still sends with the one-line fallback; (b) `lapGateData` empty → `approve_g4` labels "승인할 컷 없음" without calling the server; (c) a reply with two action blocks (`log_decision` then `set_hold`) runs both in order.
- Grep that no `/api/mcp/` URL was added to the file.

### Report (concise, Korean)
브랜치 + 커밋; 프롬프트에 추가된 섹션(예시 텍스트 몇 줄); 새 액션 3종과 각각의 안전장치; lapApprove 재사용 방식; 이스케이프 수정 내용; 검증 결과; 브라우저/라이브로 확인 못 한 부분.

## 지시문 끝
