#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bridge_converter.py

ScriptGenTab.jsx 가 출력하는 [CUT N] 형식 txt 파일을
script_to_prompts.py 가 읽는 [C01] 마스터 코드 형식으로 변환한다.

입력 포맷 (JSX):
    [CUT 1]
    씬: OT. 카페 테라스
    액션: 카메라 보며 손 흔들기
    캐릭터: 서여리
    대사: 오늘 촬영 끝~~
    나레이션: 없음
    샷 타입: CLOSEUP
    컷 타입: YEORI
    컷 길이: 8
    이미지 프롬프트: Young Korean woman...

출력 포맷 (py, script_to_prompts.py 호환):
    ================================================================
    마스터 코드
    SF_E01_SHOE :: YR_VD :: ...
    ================================================================

    [C01]
    SC: OT. 카페 테라스
    SP: OT. 카페 테라스
    PL: YR_VD
    CH: 서여리
    DL: 오늘 촬영 끝~~
    NR: 없음
    SH: SH_CU
    CA: (미입력)
    MD: (미입력)
    AC: 카메라 보며 손 흔들기
    DU: 8
    ━━━━━━━━━━━━━━━━━━━━━━━━
    KR (한글 컨펌본)
    ━━━━━━━━━━━━━━━━━━━━━━━━
    ...
    ━━━━━━━━━━━━━━━━━━━━━━━━
    IP (이미지 프롬프트)
    ━━━━━━━━━━━━━━━━━━━━━━━━
    Young Korean woman...
    ━━━━━━━━━━━━━━━━━━━━━━━━
    VP (영상 프롬프트)
    ━━━━━━━━━━━━━━━━━━━━━━━━
    (Veo3 프롬프트를 여기에 작성)
    ━━━━━━━━━━━━━━━━━━━━━━━━

주의: JSX [CUT N] 포맷에는 공간(SP)/카메라(CA)/감정(MD) 코드 개념이 원래
없다. SP는 씬(SC) 텍스트를 그대로 대입하고, CA/MD는 정보가 없어
"(미입력)" 플레이스홀더로 채운다 — script_to_prompts.py가 기대하는
필드가 전부 존재해야 하기 때문이며(누락 시 해당 값이 빈 문자열로
사라짐), 실제 값은 변환 후 수동으로 보완해야 한다.

실행:
    python scripts/bridge_converter.py \\
        --input downloads/flow/ep_script.txt \\
        --output scripts_output/bridge_output.txt \\
        --episode SF_E01_SHOE
"""

import argparse
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")

# ── 경로 상수 (script_generator.py / script_to_prompts.py와 동일한 CODE_ROOT 기준) ──
CODE_ROOT = r"C:\yeori-studio\app"

SEP = "━" * 24  # script_to_prompts.py 와 동일 (24자 고정)
EQ = "=" * 64

# ── 샷 타입 변환 맵 ────────────────────────────────────────────
SHOT_MAP = {
    "CLOSEUP": "SH_CU",
    "CLOSE": "SH_CU",
    "ECU": "SH_ECU",
    "MCU": "SH_MCU",
    "MEDIUM": "SH_MS",
    "MS": "SH_MS",
    "MIDSHOT": "SH_MS",
    "MLS": "SH_MLS",
    "FULLBODY": "SH_FS",
    "FULL": "SH_FS",
    "FS": "SH_FS",
    "WIDE": "SH_WS",
    "WS": "SH_WS",
    "WEB": "SH_WS",
}

# ── 컷 타입 → PL 코드 변환 맵 ─────────────────────────────────
# JSX cutType 값 → script_to_prompts.py PL 코드
PIPE_MAP = {
    "YEORI": "YR_VD",
    "YR_VD": "YR_VD",
    "YR_IM": "YR_IM",
    "BROLL": "BR_VD",
    "BR_": "BR_VD",
    "BR_VD": "BR_VD",
    "PIP": "PP_VD",
    "PP_VD": "PP_VD",
    "GRAPHIC": "GR_HT",
    "GR_": "GR_HT",
    "GR_HT": "GR_HT",
    "GR_CA": "GR_CA",
    "CAPCUT": "CC_ED",
    "CC_": "CC_ED",
    "CC_ED": "CC_ED",
}

UNSPECIFIED = "(미입력)"


def convert_shot(raw):
    """샷 타입 문자열을 SH_ 코드로 변환. 미인식 시 원본 반환."""
    key = raw.strip().upper().replace(" ", "").replace("_", "")
    return SHOT_MAP.get(key, f"SH_{raw.strip().upper()}")


def convert_pipe(raw):
    """컷 타입 문자열을 PL 코드로 변환. 미인식 시 YR_VD 기본값."""
    key = raw.strip().upper()
    return PIPE_MAP.get(key, "YR_VD")


def parse_jsx_cuts(text):
    """
    [CUT N] 블록을 파싱해 dict 리스트로 반환.
    멀티라인 이미지 프롬프트 지원.
    """
    lines = [l for l in text.splitlines() if not l.startswith("#")]
    content = "\n".join(lines)

    cut_re = re.compile(r"^\[CUT\s*(\d+)\]", re.MULTILINE)
    starts = [(m.start(), int(m.group(1))) for m in cut_re.finditer(content)]

    cuts = []
    for idx, (start, no) in enumerate(starts):
        end = starts[idx + 1][0] if idx + 1 < len(starts) else len(content)
        block = content[start:end]

        def get_field(regex, default=""):
            m = re.search(regex, block, re.IGNORECASE | re.DOTALL)
            if not m:
                return default
            raw = m.group(1)
            next_field = re.search(
                r"\n(씬|액션|캐릭터|대사|나레이션|샷\s*타입|컷\s*타입|컷\s*길이|이미지\s*프롬프트)[:：]",
                raw
            )
            if next_field:
                raw = raw[:next_field.start()]
            return raw.strip()

        cut = {
            "no": no,
            "sc": get_field(r"씬[:：]\s*(.+)"),
            "ac": get_field(r"액션[:：]\s*(.+)"),
            "ch": get_field(r"캐릭터[:：]\s*(.+)") or "서여리",
            "dl": get_field(r"대사[:：]\s*(.+)"),
            "nr": get_field(r"나레이션[:：](?:\s*\(VO\))?\s*(.+)"),
            "sh_raw": get_field(r"샷\s*타입[:：]\s*(.+)"),
            "pl_raw": get_field(r"컷\s*타입[:：]\s*(.+)"),
            "du": get_field(r"컷\s*길이[:：]\s*(.+)") or "8",
            "ip": get_field(r"이미지\s*프롬프트[:：]\s*(.+)"),
        }

        for key in ("dl", "nr", "ip"):
            if re.match(r"^없음$", cut[key].strip(), re.IGNORECASE):
                cut[key] = "없음"

        cut["sh"] = convert_shot(cut["sh_raw"]) if cut["sh_raw"] else "SH_CU"
        cut["pl"] = convert_pipe(cut["pl_raw"]) if cut["pl_raw"] else "YR_VD"

        try:
            cut["du"] = int(cut["du"])
        except ValueError:
            cut["du"] = 8

        cuts.append(cut)

    return cuts


def build_master_header(episode_code, cuts):
    """마스터 코드 헤더 생성."""
    pl_codes = list(dict.fromkeys(c["pl"] for c in cuts))
    pl_str = " | ".join(pl_codes)
    master_line = f"{episode_code} :: {pl_str}"
    return f"{EQ}\n마스터 코드\n{master_line}\n{EQ}"


def build_cut_block(cut):
    """
    컷 dict를 script_to_prompts.py 형식 문자열로 변환.
    SP/CA/MD는 JSX 포맷에 대응 코드가 없어 SC 값 재사용(SP) 또는
    "(미입력)" 플레이스홀더(CA/MD)로 채운다 — script_to_prompts.py가
    파싱하는 필드가 전부 존재해야 최종 prompts.json에서 빈 문자열로
    유실되지 않는다.
    """
    no_padded = str(cut["no"]).zfill(2)
    tag = f"[C{no_padded}]"

    main = (
        f"{tag}\n"
        f"SC: {cut['sc']}\n"
        f"SP: {cut['sc']}\n"
        f"PL: {cut['pl']}\n"
        f"CH: {cut['ch']}\n"
        f"DL: {cut['dl'] or '없음'}\n"
        f"NR: {cut['nr'] or '없음'}\n"
        f"SH: {cut['sh']}\n"
        f"CA: {UNSPECIFIED}\n"
        f"MD: {UNSPECIFIED}\n"
        f"AC: {cut['ac']}\n"
        f"DU: {cut['du']}\n"
    )

    # KR 컨펌본 — 브릿지 단계에서는 SC/CH/DL/NR/AC 그대로 복사, CA/MD는 플레이스홀더
    kr = (
        f"{SEP}\n"
        f"KR (한글 컨펌본)\n"
        f"{SEP}\n"
        f"SP(장소): {cut['sc']}\n"
        f"CH(캐릭터): {cut['ch']}\n"
        f"SH(샷): {cut['sh']}\n"
        f"CA(카메라): {UNSPECIFIED}\n"
        f"AC(동작): {cut['ac']}\n"
        f"MD(감정): {UNSPECIFIED}\n"
        f"DL(대사): {cut['dl'] or '없음'}\n"
        f"NR(나레이션): {cut['nr'] or '없음'}\n"
    )

    ip_content = cut["ip"] if cut["ip"] and cut["ip"] != "없음" else "(이미지 프롬프트 없음)"
    ip = (
        f"{SEP}\n"
        f"IP (이미지 프롬프트)\n"
        f"{SEP}\n"
        f"{ip_content}\n"
    )

    # VP 섹션 — 브릿지 단계에서는 빈 플레이스홀더 (Veo3 프롬프트는 수동 작성)
    vp = (
        f"{SEP}\n"
        f"VP (영상 프롬프트)\n"
        f"{SEP}\n"
        f"(Veo3 프롬프트를 여기에 작성)\n"
        f"{SEP}\n"
    )

    return main + kr + ip + vp


def convert(input_path, output_path, episode_code):
    if not os.path.exists(input_path):
        print(f"오류: 입력 파일 없음 → {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        text = f.read()

    cuts = parse_jsx_cuts(text)
    if not cuts:
        print("오류: [CUT N] 블록을 하나도 파싱하지 못했습니다.", file=sys.stderr)
        sys.exit(1)

    blocks = [build_master_header(episode_code, cuts)]
    for cut in cuts:
        blocks.append(build_cut_block(cut))

    output = "\n\n".join(blocks) + "\n"

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(output)

    print(f"[완료] {len(cuts)}컷 변환 → {output_path}")
    print(f"  에피소드 코드: {episode_code}")
    for c in cuts:
        print(f"  C{str(c['no']).zfill(2)} | SH={c['sh']} | PL={c['pl']} | DU={c['du']}s")


def resolve_path(p, base):
    if os.path.isabs(p):
        return p
    return os.path.join(base, p)


def main():
    parser = argparse.ArgumentParser(
        description="ScriptGenTab.jsx [CUT N] 포맷 -> script_to_prompts.py [C01] 포맷 변환"
    )
    parser.add_argument("--input", required=True, help="입력 파일 (JSX 포맷 txt)")
    parser.add_argument("--output", required=True, help="출력 파일 (py 포맷 txt)")
    parser.add_argument("--episode", required=True, help="에피소드 코드 (예: SF_E01_SHOE)")
    args = parser.parse_args()

    input_path = resolve_path(args.input, CODE_ROOT)
    output_path = resolve_path(args.output, CODE_ROOT)

    convert(input_path, output_path, args.episode)


if __name__ == "__main__":
    main()
