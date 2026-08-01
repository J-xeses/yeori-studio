#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
script_generator.py (v2 — codebook.json 외부 로드 기반)

마스터 코드(또는 구조화된 cuts.json)를 입력받아 codebook.json에 정의된
SP/SH/CA/MD/AT/LOOK_BANK 데이터를 조합해 v3 스타일 [CUT N] 컷 포맷 대본
텍스트를 자동 생성한다. (기준: script_generator_spec.md, 2026-08-01)

기존(v1) 대비 변경점:
    - CODE_CATEGORIES 내장 딕셔너리 제거 → codebook.json 외부 로드
    - AC 필드 → AT로 통일 (동작 코드)
    - CP(자막) 필드 신규 추가
    - character_id 분기 지점 추가 (현재는 "yeori" 단일 — codebook.json의
      meta.character_id로 검증만 하고, YEORI_BASE/LOOK_BANK 키 자체는 아직
      캐릭터별로 나뉘어 있지 않음. 다른 캐릭터 codebook 추가 시 이 지점에서
      캐릭터별 BASE/LOOK 딕셔너리 선택 로직을 넣으면 됨)
    - VP 생성 로직 고도화: DU(8/10초)별 시간 구간 자동 계산 + 립싱크(DL 있음)
      / 나레이션(NR) 자동 분기

마스터 코드 문법 (신규, codebook.json 기준):
    {에피소드코드} :: {PL} :: {SP 프리셋 키} :: {LOOK_ID} :: {SH.CA.MD.AT...} [:: DU_{n}]

    - PL: codebook["PL"] 키 중 하나 (YR_VD, BR_VD, CC_ED, GR_ED)
    - SP 프리셋 키: codebook["SP"]["presets"]에 등록된 "IN.CF.TZ_AF.LT_WM" 형태의
      점(.) 결합 키. 등록 안 된 조합이면 _location_codes/_time_codes/_light_codes
      기준으로 최대한 조립해서 폴백한다.
    - LOOK_ID: codebook["LOOK_BANK"] 키 하나 (예: LOOK_CS, LOOK_ST)
    - 네 번째 세그먼트 이후는 전부 하나의 토큰 풀로 합쳐서 codebook의
      SH/CA/MD/AT 딕셔너리 멤버십으로 재분류한다(같은 방식으로 AT는 여러 개
      허용 — "+"나 "."로 몇 개를 이어 써도 전부 AT로 분류됨). "DU_8"/"DU_10"
      처럼 DU_ 접두 토큰이 있으면 컷 길이로 사용(없으면 8초 기본값).
    - SH 전환("SH_MCU → SH_CU")은 "→"도 구분자로 처리해 순서대로 여러 SH를
      인식한다 — IP는 첫 SH 기준, VP/SH 필드에는 전환 전체를 표시한다.

입력 모드 (택 1):
    --code "SF_E07 :: YR_VD :: OT.ST.TZ_AF.LT_WM :: LOOK_ST :: SH_MCU.CA_ST.MD_REL.AT_MW_01 :: DU_8"
        (여러 컷은 줄바꿈으로 구분)
    --file master_code.txt   (한 줄 = 컷 1개, 기존 v1과 동일한 동작 — proxy.js의
                               /api/generate-script가 이 모드로 호출하므로 계속 지원)
    --input cuts.json        (구조화 입력 — DL/NR/CP처럼 마스터 코드 문법으로
                               표현 불가능한 필드까지 직접 지정 가능)

    cuts.json 스키마:
        {
          "episode_code": "SF_E07",
          "cuts": [
            {
              "pl": "YR_VD", "sp": "OT.ST.TZ_AF.LT_WM", "look_id": "LOOK_ST",
              "sh": "SH_MCU", "ca": "CA_ST", "md": "MD_REL", "at": "AT_MW_01",
              "dl": "오늘 촬영 끝~~", "nr": null, "cp": null,
              "du": 8, "sc": "(선택) SC 직접 지정 시 자동생성 대신 이 값 사용"
            }
          ]
        }
        (bare list [ {...}, {...} ]도 허용 — 이 경우 --episode-code로 코드를 줘야 함)

출력:
    C:\\yeori-studio\\app\\scripts_output\\[에피소드코드]_script.txt (UTF-8)
    (--output으로 다른 경로 지정 가능)

DL/NR/CP 미입력 규칙:
    - 값 자체가 없음(None) → "(작성 필요)" 표시 (아직 안 써진 것 — 마스터 코드
      문법(--code/--file)에는애초에 DL/NR/CP를 넣을 자리가 없으므로 이 모드는
      항상 이 상태)
    - cuts.json에서 명시적으로 빈 문자열("")을 준 경우 → "없음" 표시 (확정적으로
      없다고 판단한 것)
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime

# Windows 콘솔(cp949 등) 환경에서도 한글 출력이 깨지지 않도록 stdout/stderr을 UTF-8로 고정
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CODEBOOK_PATH = os.environ.get("CODEBOOK_PATH", os.path.join(SCRIPT_DIR, "codebook.json"))
OUTPUT_DIR = r"C:\yeori-studio\app\scripts_output"
DEFAULT_DU = 8
EQ = "=" * 64
SEP = "━" * 24
UPDATE_SCRIPT_HISTORY_URL = "http://localhost:3001/api/update-script-history"

VERSION_RE = re.compile(r"^#\s*VERSION:\s*v?(\d+)\.(\d+)", re.MULTILINE)
# 군 내부 토큰 구분자: 공백/쉼표/마침표/더하기/화살표(전환 표시)
_TOKEN_SPLIT_RE = re.compile(r"[+.\s,]+|→")
DU_TOKEN_RE = re.compile(r"^DU_(\d+)$")


# ── codebook 로드 ──────────────────────────────────────────────────────

def load_codebook(path=None):
    path = path or CODEBOOK_PATH
    if not os.path.exists(path):
        raise FileNotFoundError(f"codebook.json을 찾을 수 없습니다: {path}")
    with open(path, encoding="utf-8") as f:
        cb = json.load(f)

    # character_id 분기 지점 — 현재는 yeori 단일 지원. 다른 캐릭터 codebook을
    # 붙이게 되면 여기서 character_id별로 YEORI_BASE/LOOK_BANK에 해당하는
    # 키를 선택하는 분기를 추가하면 된다.
    char_id = cb.get("meta", {}).get("character_id", "yeori")
    if char_id != "yeori":
        print(f"[경고] codebook character_id='{char_id}' — 'yeori' 외 캐릭터는 "
              f"아직 전용 처리 로직이 없어 yeori 규칙을 그대로 적용합니다.", file=sys.stderr)
    return cb


# ── 토크나이저 / 분류 유틸 ──────────────────────────────────────────────

def tokenize_group(segment):
    return [t for t in _TOKEN_SPLIT_RE.split(segment.strip()) if t]


def classify_rest(tokens, cb):
    """4번째 세그먼트 이후 토큰 풀을 codebook의 SH/CA/MD/AT 멤버십으로 분류.
    등록 안 된 코드는 'unknown'(F군, 참고용)에 남긴다. 각 카테고리는 원래
    등장 순서를 유지한다(AT 복수 처리에 필요)."""
    sh, ca, md, at, du, unknown = [], [], [], [], None, []
    for t in tokens:
        m = DU_TOKEN_RE.match(t)
        if m:
            du = int(m.group(1))
        elif t in cb.get("SH", {}):
            sh.append(t)
        elif t in cb.get("CA", {}):
            ca.append(t)
        elif t in cb.get("MD", {}):
            md.append(t)
        elif t in cb.get("AT", {}):
            at.append(t)
        else:
            unknown.append(t)
    return {"sh": sh, "ca": ca, "md": md, "at": at, "du": du, "unknown": unknown}


def first_or(lst, default=None):
    return lst[0] if lst else default


# ── SP(공간) 프리셋 조회 — 등록 안 된 조합은 문법 기반으로 최대한 조립 ──────

def resolve_sp(cb, sp_key):
    """sp_key(예: "IN.HM.TZ_NT.LT_WM")를 codebook["SP"]["presets"]에서 찾고,
    없으면 _location_codes/_time_codes/_light_codes로 폴백 조립한다.
    반환: {"label": ..., "ip_bg": ...} (둘 다 실패하면 빈 문자열)"""
    sp = cb.get("SP", {})
    presets = sp.get("presets", {})
    if sp_key in presets:
        return presets[sp_key]

    parts = sp_key.split(".") if sp_key else []
    typ = next((p for p in parts if p in ("IN", "OT")), "")
    loc_codes = sp.get("_location_codes", {})
    loc = next((p for p in parts if p in loc_codes), "")
    time_codes = sp.get("_time_codes", {})
    tz = next((p for p in parts if p in time_codes), "")
    light_codes = sp.get("_light_codes", {})
    lt = next((p for p in parts if p in light_codes), "")

    typ_ko = "실내" if typ == "IN" else ("실외" if typ == "OT" else "")
    loc_ko = loc_codes.get(loc, "").split(" (")[0]
    label_bits = [b for b in (typ_ko, loc_ko) if b]
    label = " ".join(label_bits) or sp_key or "(미지정)"

    ip_bits = [b for b in (light_codes.get(lt, {}).get("ip"), time_codes.get(tz, {}).get("ip")) if b]
    ip_bg = ", ".join(ip_bits)
    return {"label": label, "ip_bg": ip_bg}


# ── 마스터 코드 파서(문자열 1줄 = 컷 1개) ────────────────────────────────

def parse_master_code_line(line, cb):
    parts = [p.strip() for p in line.split("::")]
    if len(parts) < 5:
        raise ValueError(
            f"마스터 코드 형식 오류 — '::' 구분 5개 이상 필요 "
            f"(에피소드코드::PL::SP::LOOK_ID::SH.CA.MD.AT[..DU_n]): {line}"
        )

    episode_code = parts[0]
    pl_tokens = tokenize_group(parts[1])
    pl = first_or(pl_tokens, "(미지정)")
    sp_key = parts[2].strip()
    look_tokens = tokenize_group(parts[3])
    look_id = first_or(look_tokens, "(미지정)")

    rest_tokens = tokenize_group(" ".join(parts[4:]))
    rest = classify_rest(rest_tokens, cb)

    return {
        "episode_code": episode_code,
        "pl": pl,
        "sp": sp_key,
        "look_id": look_id,
        "sh": rest["sh"],
        "ca": rest["ca"],
        "md": first_or(rest["md"]),
        "at": rest["at"],
        "du": rest["du"] or DEFAULT_DU,
        "dl": None, "nr": None, "cp": None, "sc": None,
        "extra": rest["unknown"],
    }


# ── cuts.json(구조화 입력) 정규화 ────────────────────────────────────────

def normalize_json_cut(raw, cb):
    """cuts.json의 컷 하나(dict)를 parse_master_code_line()과 동일한 shape으로
    정규화한다. sh/ca/at는 문자열("SH_A+SH_B")이든 리스트든 둘 다 받는다."""
    def as_list(v):
        if v is None:
            return []
        if isinstance(v, list):
            return v
        return tokenize_group(str(v))

    return {
        "pl": raw.get("pl", "(미지정)"),
        "sp": raw.get("sp", ""),
        "look_id": raw.get("look_id", "(미지정)"),
        "sh": as_list(raw.get("sh")),
        "ca": as_list(raw.get("ca")),
        "md": raw.get("md"),
        "at": as_list(raw.get("at")),
        "du": int(raw.get("du") or DEFAULT_DU),
        "dl": raw.get("dl"),
        "nr": raw.get("nr"),
        "cp": raw.get("cp"),
        "sc": raw.get("sc"),
        "extra": [],
    }


# ── 필드 표시 유틸 (DL/NR/CP: None="(작성 필요)", ""="없음") ──────────────

def field_or_placeholder(val):
    if val is None:
        return "(작성 필요)"
    if val == "":
        return "없음"
    return val


# ── IP(이미지 프롬프트) 조합 ──────────────────────────────────────────────

def build_ip(cb, cut):
    sh_code = first_or(cut["sh"])
    sh_info = cb.get("SH", {}).get(sh_code, {})
    look_info = cb.get("LOOK_BANK", {}).get(cut["look_id"], {})
    sp_info = resolve_sp(cb, cut["sp"])
    yeori_base = cb.get("YEORI_BASE", {})
    is_broll = cut["pl"] == "BR_VD"

    lines = []
    prefix = sh_info.get("ip_prefix", "")
    base_lines = [] if is_broll else yeori_base.get("ip_lines", [])

    if prefix:
        lines.append(prefix)
    if base_lines:
        lines.extend(base_lines)

    if look_info.get("ip_outfit") and not is_broll:
        lines.append(look_info["ip_outfit"])

    bg = sp_info.get("ip_bg", "")
    if bg:
        lines.append(bg if bg.endswith(",") else f"{bg},")

    at_phrases = [cb.get("AT", {}).get(t, {}).get("ip_phrase") for t in cut["at"]]
    at_phrases = [p for p in at_phrases if p]
    if at_phrases:
        lines.append(", ".join(at_phrases) + ",")

    md_phrase = cb.get("MD", {}).get(cut["md"], {}).get("ip_phrase") if cut["md"] else None
    if md_phrase:
        lines.append(f"{md_phrase},")

    suffix = sh_info.get("ip_suffix", "")
    if suffix:
        lines.append(suffix)

    if not is_broll:
        lines.extend(yeori_base.get("ip_footer", []))
    else:
        br_rule = cb.get("BG_RULE", {}).get("BR_VD", "no main character in frame")
        lines.append(br_rule)

    return "\n".join(lines) if lines else "(작성 필요)"


# ── VP(영상 프롬프트) 조합 ──────────────────────────────────────────────

def build_vp(cb, cut):
    du = cut["du"]
    segs = cb.get("VP_RULES", {}).get("time_segments", {}).get(f"{du}s") or [3, 6, du]
    a, b, end = segs[0], segs[1], segs[-1]

    at_phrases = [cb.get("AT", {}).get(t, {}).get("vp_phrase") for t in cut["at"]]
    at_phrases = [p for p in at_phrases if p]
    at_joined = ", ".join(at_phrases) or "she settles naturally into frame"

    ca_code = first_or(cut["ca"])
    ca_phrase = cb.get("CA", {}).get(ca_code, {}).get("vp_phrase", "camera holds steady")
    md_phrase = cb.get("MD", {}).get(cut["md"], {}).get("vp_phrase") if cut["md"] else None

    blocks = []
    dl = cut["dl"]
    if dl:  # 립싱크 컷 — DL이 실제로 채워져 있을 때만 립싱크 구조 적용
        blocks.append(f"First 0-{a}s: {at_joined}, {ca_phrase}.")
        blocks.append(f"Next {a}-{b}s: she says \"{dl}\" naturally, natural lip movement, sincere expression.")
        final = f"Final {b}-{end}s: expression settles"
        final += f", {md_phrase}." if md_phrase else " naturally."
        blocks.append(final)
    else:
        blocks.append(cb.get("VP_RULES", {}).get("no_dialogue_header", "NO dialogue — narration added in post"))
        blocks.append(f"First 0-{a}s: {ca_phrase}, {at_joined}.")
        blocks.append(f"Next {a}-{b}s: {md_phrase or 'the moment continues naturally'}.")
        final = f"Final {b}-{end}s: the moment settles quietly."
        nr = cut["nr"]
        if nr:
            final += f'  NR: "{nr}"'
        blocks.append(final)

    # SH 전환("SH_MCU → SH_CU")이 있으면 전환 묘사 한 줄 추가
    if len(cut["sh"]) > 1:
        sh_labels = [cb.get("SH", {}).get(t, {}).get("label", t) for t in cut["sh"]]
        blocks.append(f"(transitioning {' → '.join(sh_labels)})")

    return "\n\n".join(blocks)


# ── KR(한글 컨펌본) 조합 ──────────────────────────────────────────────

def build_kr(cb, cut):
    sp_info = resolve_sp(cb, cut["sp"])
    look_label = cb.get("LOOK_BANK", {}).get(cut["look_id"], {}).get("label", cut["look_id"])
    sh_label = " → ".join(cb.get("SH", {}).get(t, {}).get("label", t) for t in cut["sh"]) or "(미지정)"
    ca_label = " / ".join(cb.get("CA", {}).get(t, {}).get("label", t) for t in cut["ca"]) or "(미지정)"
    at_label = " + ".join(cb.get("AT", {}).get(t, {}).get("label", t) for t in cut["at"]) or "(미지정)"
    md_label = cb.get("MD", {}).get(cut["md"], {}).get("label", "(미지정)") if cut["md"] else "(미지정)"

    dl = cut["dl"]
    nr = cut["nr"]
    cp = cut["cp"]

    lines = [
        f"SP(장소):     {sp_info.get('label', '(미지정)')}",
        f"CH(캐릭터):   {look_label}",
        f"SH(샷):       {sh_label}",
        f"CA(카메라):   {ca_label}",
        f"AT(동작):     {at_label}",
        f"MD(감정):     {md_label}",
        f"DL(대사):     {dl if dl else ('없음' if dl == '' else '(작성 필요)')}",
        f"NR(나레이션): {nr if nr else ('없음' if nr == '' else '(작성 필요)')}",
        f"CP(자막):     {cp if cp else ('없음' if cp == '' else '(작성 필요)')}",
    ]
    return "\n".join(lines)


# ── 컷 블록 생성 (v3 스타일 [CUT N] 헤더) ─────────────────────────────────

def build_cut_block(cut_no, cut, cb):
    pl_label = cb.get("PL", {}).get(cut["pl"], {}).get("label", cut["pl"])
    sp_info = resolve_sp(cb, cut["sp"])
    sc = cut["sc"] or sp_info.get("label", "(미지정)")
    md_label = cb.get("MD", {}).get(cut["md"], {}).get("label") if cut["md"] else None
    if not cut["sc"] and md_label:
        sc += f" · {md_label} 분위기"

    at_field = "+".join(cut["at"]) if cut["at"] else "(미지정)"
    sh_field = " → ".join(cut["sh"]) if cut["sh"] else "(미지정)"
    ca_field = "+".join(cut["ca"]) if cut["ca"] else "(미지정)"
    md_field = cut["md"] or "(미지정)"

    lines = [
        SEP,
        f"[CUT {cut_no}]  {pl_label} — {sc} / {cut['du']}초",
        SEP,
        f"SC: {sc}",
        f"SP: {cut['sp'] or '(미지정)'}",
        f"PL: {cut['pl']}",
        f"CH: 서여리 / {cut['look_id']}",
        f"DL: {field_or_placeholder(cut['dl'])}",
        f"NR: {field_or_placeholder(cut['nr'])}",
        f"CP: {field_or_placeholder(cut['cp'])}",
        f"AT: {at_field}",
        f"SH: {sh_field}",
        f"CA: {ca_field}",
        f"MD: {md_field}",
        f"LOOK_ID: {cut['look_id']}",
        f"DU: {cut['du']}",
        SEP,
        "KR (한글 컨펌본)",
        SEP,
        build_kr(cb, cut),
        SEP,
        "IP (이미지 프롬프트)",
        SEP,
        build_ip(cb, cut),
        SEP,
        "VP (영상 프롬프트)",
        SEP,
        build_vp(cb, cut),
        SEP,
    ]
    return "\n".join(lines)


# ── 여러 줄 입력 전처리 (마스터 코드가 "::"로 줄바꿈된 경우 병합) ──────────

def join_wrapped_lines(raw_lines):
    joined = []
    for raw in raw_lines:
        line = raw.rstrip("\n").rstrip("\r")
        if line.strip().startswith("::") and joined:
            joined[-1] = joined[-1].rstrip() + " " + line.strip()
        else:
            joined.append(line)
    return joined


# ── 버전 헤더 / 스크립트 이력 (v1과 동일 — proxy.js가 이 포맷에 의존) ──────

def next_version(out_path):
    if os.path.exists(out_path):
        try:
            with open(out_path, encoding="utf-8") as f:
                head = f.read(2000)
            m = VERSION_RE.search(head)
            if m:
                major, minor = int(m.group(1)), int(m.group(2))
                return f"v{major}.{minor + 1}"
        except OSError:
            pass
    return "v1.0"


def build_meta_header(episode_code, version, date_str, status, changes, cuts_count):
    lines = [
        EQ,
        "# SCRIPT META",
        f"# EPISODE: {episode_code}",
        f"# VERSION: {version}",
        f"# DATE: {date_str}",
        f"# STATUS: {status}",
        f"# CHANGES: {changes}",
        f"# CUTS: {cuts_count}",
        EQ,
    ]
    return "\n".join(lines)


def cut_detail_range(cuts_count):
    if cuts_count <= 1:
        return "C01"
    return f"C01~C{cuts_count:02d}"


def notify_script_history(episode_code, version, date_str, status, changes, cuts_count):
    """생성 완료 후 proxy.js의 /api/update-script-history를 호출해 Notion 이력에
    기록한다. 실패해도(proxy.js 미실행 등) 경고만 출력하고 예외를 전파하지 않는다."""
    payload = json.dumps({
        "episodeCode": episode_code,
        "version": version,
        "date": date_str,
        "status": status,
        "changes": changes,
        "cuts": cuts_count,
        "cutDetail": cut_detail_range(cuts_count),
    }).encode("utf-8")

    req = urllib.request.Request(
        UPDATE_SCRIPT_HISTORY_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        if result.get("success"):
            print(f"[Notion] 스크립트 이력 업데이트 완료 (page: {result.get('notionPageId')})")
        else:
            print(f"[Notion] 경고: {result.get('error', '알 수 없는 오류')}")
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"[Notion] 경고: 이력 업데이트 실패 (proxy.js 실행 중인지 확인) — {e}")


# ── 메인 ──────────────────────────────────────────────────────────────

def generate_from_code_lines(raw_lines, cb):
    code_lines = join_wrapped_lines(raw_lines)
    valid = []
    for i, raw in enumerate(code_lines, 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            cut = parse_master_code_line(line, cb)
            valid.append(cut)
        except ValueError as e:
            print(f"[경고] {i}번째 줄 건너뜀 — {e}", file=sys.stderr)

    if not valid:
        raise ValueError("유효하게 파싱된 마스터 코드가 없습니다.")

    episode_code = valid[0]["episode_code"]
    first_line = next(l.strip() for l in code_lines if l.strip() and not l.strip().startswith("#"))
    return episode_code, first_line, valid


def generate_from_json(data, episode_code_arg, cb):
    if isinstance(data, list):
        raw_cuts = data
        episode_code = episode_code_arg or "EP_UNKNOWN"
    else:
        raw_cuts = data.get("cuts", [])
        episode_code = data.get("episode_code") or episode_code_arg or "EP_UNKNOWN"

    if not raw_cuts:
        raise ValueError("cuts.json에 컷 데이터가 없습니다 (cuts 배열 확인)")

    valid = [normalize_json_cut(raw, cb) for raw in raw_cuts]
    first_line = f"{episode_code} (cuts.json 구조화 입력, {len(valid)}컷)"
    return episode_code, first_line, valid


def build_script_text(episode_code, first_line, cuts, cb):
    header = f"{EQ}\n마스터 코드\n{first_line}\n{EQ}"
    body = "\n\n".join(build_cut_block(i, cut, cb) for i, cut in enumerate(cuts, 1))
    return f"{header}\n\n{body}\n"


def main():
    parser = argparse.ArgumentParser(
        description="마스터 코드/cuts.json -> codebook.json 기반 [CUT N] 표준 컷 포맷 대본 자동 생성"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--code", type=str, help="마스터 코드 문자열 (여러 컷은 줄바꿈으로 구분)")
    group.add_argument("--file", type=str, help="마스터 코드가 담긴 텍스트 파일 경로 (한 줄 = 컷 1개)")
    group.add_argument("--input", type=str, help="구조화된 cuts.json 파일 경로")
    parser.add_argument("--episode-code", type=str, default=None, help="--input이 bare list일 때 사용할 에피소드 코드")
    parser.add_argument("--output", type=str, default=None, help="출력 파일 경로 (생략 시 scripts_output/{episode_code}_script.txt)")
    parser.add_argument("--codebook", type=str, default=None, help="codebook.json 경로 (생략 시 CODEBOOK_PATH 환경변수 또는 스크립트 옆 codebook.json)")
    parser.add_argument("--changes", type=str, default="자동 생성", help="이번 버전의 변경 내용 한 줄 요약")
    parser.add_argument(
        "--status", type=str, default="draft",
        choices=["draft", "review", "approved", "regenerate", "archived"],
    )
    args = parser.parse_args()

    try:
        cb = load_codebook(args.codebook)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"오류: codebook 로드 실패 — {e}", file=sys.stderr)
        sys.exit(1)

    try:
        if args.code:
            episode_code, first_line, cuts = generate_from_code_lines(args.code.splitlines(), cb)
        elif args.file:
            with open(args.file, encoding="utf-8") as f:
                episode_code, first_line, cuts = generate_from_code_lines(f.readlines(), cb)
        else:
            with open(args.input, encoding="utf-8") as f:
                data = json.load(f)
            episode_code, first_line, cuts = generate_from_json(data, args.episode_code, cb)
    except (ValueError, OSError, json.JSONDecodeError) as e:
        print(f"오류: {e}", file=sys.stderr)
        sys.exit(1)

    script_text = build_script_text(episode_code, first_line, cuts, cb)
    cuts_count = len(cuts)

    if args.output:
        out_path = args.output
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    else:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        out_path = os.path.join(OUTPUT_DIR, f"{episode_code}_script.txt")

    version = next_version(out_path)
    date_str = datetime.now().strftime("%Y-%m-%d")
    meta_header = build_meta_header(episode_code, version, date_str, args.status, args.changes, cuts_count)
    full_text = f"{meta_header}\n\n{script_text}"

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(full_text)

    print(f"[완료] {out_path}")
    notify_script_history(episode_code, version, date_str, args.status, args.changes, cuts_count)


if __name__ == "__main__":
    main()
