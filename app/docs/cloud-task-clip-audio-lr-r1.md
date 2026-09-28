# 클라우드 세션 작업 지시서 — 클립 프롬프트: 현장음 Audio 문단 + 두 인물 좌/우 앵커 (2026-09-28)

> 사용법: claude.ai/code → 저장소 J-xeses/yeori-studio → 환경 **☁ Default(클라우드)** → Sonnet 5 / High → 아래 "지시문" 붙여넣기. 예상 $5 안팎.

---

## 지시문 (여기부터 복사)

Improve the deterministic Veo clip-prompt builder `app/server/lib/clipPrompt.js` (`buildClipPrompt(cut, k, n)`), based on two field findings from episode IG_R06 (owner generated clips manually in Google Flow/Veo):

1. **Cut 2 (no dialogue)**: the script's Korean audio direction — `BGM: 촌스러운 댄스 비트(영상 속 소리처럼 폰 스피커 질감)`, `음성: 없음 (동기들 웃음소리만)` — never reached Veo, so the clip had no beat. Adding an English "Audio:" paragraph to the video prompt fixed it (loudness -18.3 → -15.7 LUFS, rhythmic beat present).
2. **Cut 3 (two people, 서여리 + 지유)**: Veo confused who says which line in several attempts; it worked after the owner wrote a left/right position next to each character's name.

### Hard constraints
- Branch `clip-audio-lr-r1` from `master`; commit/push the branch only. Never push/merge `master`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Deterministic only — no LLM calls in the builder (token-free principle). No changes to `downloads/` or secrets.

### Context (read first)
- `app/server/lib/scriptParserV3.js` already parses each cut's audio block into `cut.masterCode.audio = { bgm, voice, sfx, ambience }` (Korean keys `BGM / 음성 / 효과음 / 앰비언스`, see `V3_AUDIO_KEY_MAP`). The client parser in `app/src/tabs/ScriptGenTab.jsx` must stay in sync with the server parser (two copies).
- Real example: `downloads/seoyeori/IG/IG_R/IG_R06/01_script/IG_R06_script.txt` (CUT 2 and CUT 3).
- Characters and descriptors: `downloads/seoyeori/characters/characters.json` (yeori, yeori_nt, jia, jiyu). `clipPrompt.js` already has `speakerIdsFor`, `CHAR_EN`, and throws when a two-person line has no speaker.
- Background music chosen in post (`app/server/lib/bgmSelect.js`) must NOT be duplicated by Veo: only **diegetic/in-scene** sound goes to Veo.

### Build
1. **Audio paragraph** appended to every clip prompt:
   - Optional new script field `AU:` (English, one line per cut or per clip `[Clip k/N]`) — if present, use it verbatim. Add it to both parsers (server + client) without breaking existing scripts.
   - Otherwise derive from `masterCode.audio`: include `sfx`, `ambience`, and `voice` non-dialogue sounds (e.g. laughter); include `bgm` **only** when it is marked in-scene (Korean cues like `영상 속`, `현장`, `폰 스피커`, `틀어놓은`, `라디오`). Keep the Korean phrase but wrap it in a clear English frame, e.g. `Audio (in-scene, not background score): …`. Always end with `No background music score unless stated as in-scene.` when bgm is post-production.
   - Dialogue clips keep the existing spoken-line sentence; the Audio paragraph comes after it.
2. **Left/right anchors for two-person frames**: when a clip shows two characters, prefix each speaker in the spoken-line sentence with a position + short look tag, e.g. `Seo Yeori (on the LEFT, long wavy brown hair, white tee) says …; Kim Jiyu (on the RIGHT, straight black hair with bangs) says …`. Position source, in order: an explicit script hint (`좌/왼쪽/LEFT`, `우/오른쪽/RIGHT` next to the name in CH/AC/VP), else the order of names in `CH:` (first = LEFT). Look tag = a short fixed phrase per character (add an optional `lookTag` to characters.json entries if needed, with sensible defaults in code).
3. Keep `No on-screen subtitle text or captions` in every clip prompt (one of the owner's clips had burned-in subtitles).

### Verification
- Unit checks with node on IG_R06: CUT 2 prompt contains an Audio paragraph with the phone-speaker beat + laughter and no generic BGM; CUT 3 prompt has LEFT/RIGHT anchors for both speakers in the correct order.
- `node scripts/clip-prompts.js` (writes `downloads/state/clip-prompts/{CODE}.md`) still runs for LF_T01 without new errors (it may fail in the cloud if `downloads/` data is absent — then test with the IG_R06 script file directly).
- Add selftest items in `app/scripts/pipeline-selftest.js` (e.g. `P4` audio paragraph, `P5` L/R anchors).

### Report (Korean, concise)
Branch + commits; before/after prompt excerpts for IG_R06 CUT 2 and CUT 3; any script-format change the owner must know.

## 지시문 끝
