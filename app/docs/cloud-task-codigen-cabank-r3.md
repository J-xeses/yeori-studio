# 클라우드 세션 작업 지시서 — 코디젠 CA_BANK 재구성 (3차, 2026-09-27)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 새 세션(Sonnet 5 / High) → 아래 "지시문" 붙여넣기.
> 참고: UI 2차는 $5 소모. 이번 목표 $5~8.

---

## 지시문 (여기부터 복사)

You are redesigning the **CA_BANK tab** of "Codi_Gen" (`app/code_generator_v1.html`, single-file vanilla JS, dark theme, teal accent). Read first: `app/docs/ca-bank-academy-proposal.md` (option A: characters.json is the source of truth) and `app/docs/codigen-review-2026-09-27.md`.

### Hard constraints
- Branch `codigen-cabank-r3` from `master`; commit and push the branch only. Never push/merge to `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Change only `app/code_generator_v1.html`. No server changes, no writes to data files — this round is **read-only** (display, select, combine, copy). Korean UI copy. Reuse existing CSS variables, the `--sb-w` sidebar width, fonts rules (monospace only for codes; Hangul labels in sans).
- Server is `YEORI_SERVER` (http://localhost:3001), offline in your environment: every fetch needs an explicit empty/offline state.

### Data (already served by the local server — read the code to confirm shapes)
- `GET /api/characters` (see `app/server/proxy.js` ~line 2235) → registry from `downloads/seoyeori/characters/characters.json`: ids `yeori`, `yeori_nt`, `jia`, `jiyu`; fields include `name, aliases, face, closeup, primary, descriptor, looks, flowCharacterName, voiceName, notes, personaOf`.
- `GET /api/codebook` → codebook with LOOK_BANK etc. (already loaded by Codi_Gen as `codebook`).
- Images: any file under `downloads/` is served at `${YEORI_SERVER}/downloads/<relative path>` (static route). Resolve character image paths (`face`, `closeup`, look images) to that URL; show a placeholder when missing or offline.

### 1) Sidebar changes on the CA_BANK tab only
When CA_BANK is active, the left sidebar shows a **classification tree instead of the channel/episode list** (restore the normal sidebar on other tabs):
- **캐릭터**: 서여리 · 서여리(묶은머리) · 지아 · 지유 (from /api/characters; show small face thumbnail)
- **룩(LOOK)**: grouped per character (codebook LOOK_BANK + characters.json `looks`), code + Korean label
- **코드 분류**: LOOK / TOP / BOTTOM / SEASON / 표정(MD_) / 샷(SH_) — whatever vocabularies Codi_Gen already has (VOCAB, codebook). Clicking an item selects it into the simulator.
Also, on the other tabs, fix the issue that the long episode list pushes the cut list off-screen: make the episode list collapsible and/or height-limited with its own scroll so the cut list stays visible.

### 2) Main area = two regions
**A. 시뮬레이터 (선택 + 조합)** — top region
- Pick: character → look → (top/bottom/season when applicable) → expression → shot.
- Live output: (1) the combined **code line** in the same token style Codi_Gen uses for master code (LOOK_ID and D군 tokens), (2) an **image prompt** assembled from the character `descriptor` + look description + expression + shot wording, (3) Flow character name to use (`flowCharacterName`). Copy buttons for code and prompt.
- Show warnings when a chosen code is not in the codebook, or a look belongs to another character.

**B. 표준 캐릭터 보드 (타입별 이미지 세팅)** — bottom region, for the selected character
Board types as slot grid (each slot: image if exists, else an empty "미생성" slot showing the ready-to-copy prompt for that slot):
1. 얼굴 기준 — 정면 얼굴(face), 클로즈업(closeup)
2. 턴어라운드 — 정면 · 측면 · 후면 전신
3. 표정 시트 — 기본 · 웃음 · 놀람 · 슬픔 · 당황
4. 룩별 전신 — one slot per look of that character
5. 시즌 — 봄/여름/가을/겨울 룩 (use looks/notes if present)
Header shows fill ratio per board type (e.g. 표정 1/5). Empty slots are where the owner will spend free generation credits — make the prompt + target filename convention visible (e.g. `downloads/seoyeori/characters/<id>/<board>_<slot>.jpg`) so files dropped there appear automatically next time.

### Verification
- Parse every inline `<script>` with `new Function(src)` — must pass.
- Check with a headless browser if available (server offline → verify empty states render, sidebar switches on CA_BANK and back). Screenshot 1500×900.
- No literal `undefined` in rendered text.

### Report (concise, Korean)
Branch + commits; what's where; assumptions about data shapes; what needs a live-server check.

## 지시문 끝
