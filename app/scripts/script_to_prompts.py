#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
script_to_prompts.py

script_generator.py가 생성한 {에피소드코드}_script.txt를 읽어
스튜디오가 사용하는 downloads/flow/prompts.json 형식으로 변환한다.

입력:
    C:\\yeori-studio\\app\\scripts_output\\{에피소드코드}_script.txt

출력:
    C:\\yeori-studio\\downloads\\flow\\prompts.json (UTF-8)

실행 방법:
    python scripts/script_to_prompts.py --file SF_E01_SHOE_script.txt
    (파일명만 주면 scripts_output/ 기준으로 찾고, 절대/상대 경로를 직접
    줘도 된다)
"""

import argparse
import json
import os
import re
import sys

# Windows 콘솔(cp949 등) 환경에서도 한글 출력이 깨지지 않도록 stdout/stderr을 UTF-8로 고정
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

SCRIPTS_OUTPUT_DIR = r"C:\yeori-studio\app\scripts_output"
PROMPTS_OUTPUT_PATH = r"C:\yeori-studio\downloads\flow\prompts.json"

# script_generator.py가 컷 블록 안에서 섹션 구분에 쓰는 구분선과 동일해야 한다.
SEP = "━" * 24

CUT_HEADER_RE = re.compile(r"^\[C(\d+)\]\s*$")
MAIN_FIELD_RE = re.compile(r"^(SC|SP|PL|CH|DL|NR|SH|CA|MD|AC|DU):\s?(.*)$")
KR_FIELD_RE = re.compile(r"^([A-Z]+)\(([^)]*)\):\s*(.*)$")
HEADER_RE = re.compile(r"^={10,}\n마스터 코드\n(.+)\n={10,}", re.MULTILINE)


def tokenize(segment):
    """공백/쉼표/마침표/더하기 기준으로 토큰 분리 (script_generator.py와 동일한 규칙)"""
    return [t for t in re.split(r"[+.\s,]+", segment.strip()) if t]


def parse_header(text):
    """
    "마스터 코드" 헤더(=== 사이의 원본 마스터 코드 줄)에서
    episode 메타데이터(code/pipeline/quality/ratio/platform)를 추출한다.
    quality/ratio/platform은 codebook이 없는 F군을 접두어(Q_/RT_/PB_)로 판별한다.
    """
    episode = {"code": "", "pipeline": "", "quality": "", "ratio": "", "platform": ""}
    m = HEADER_RE.search(text)
    if not m:
        return episode

    parts = [p.strip() for p in m.group(1).strip().split("::")]
    if parts:
        episode["code"] = parts[0]
    if len(parts) > 1:
        pipeline_tokens = tokenize(parts[1])
        episode["pipeline"] = pipeline_tokens[0] if pipeline_tokens else ""
    if len(parts) > 4:
        for tok in tokenize(parts[-1]):
            if tok.startswith("Q_"):
                episode["quality"] = tok
            elif tok.startswith("RT_"):
                episode["ratio"] = tok
            elif tok.startswith("PB_"):
                episode["platform"] = tok
    return episode


def parse_cut_block(block_text):
    """"[C01]"로 시작하는 컷 블록 하나를 파싱해 dict로 반환. 형식이 아니면 None."""
    lines = block_text.splitlines()
    if not lines or not CUT_HEADER_RE.match(lines[0].strip()):
        return None
    cut_no = CUT_HEADER_RE.match(lines[0].strip()).group(1)

    chunks = block_text.split(SEP)
    main_text = chunks[0] if len(chunks) > 0 else ""
    kr_text = chunks[2] if len(chunks) > 2 else ""
    ip_text = chunks[4] if len(chunks) > 4 else ""
    vp_text = chunks[6] if len(chunks) > 6 else ""

    main_fields = {}
    for line in main_text.splitlines():
        fm = MAIN_FIELD_RE.match(line.strip())
        if fm:
            main_fields[fm.group(1)] = fm.group(2).strip()

    kr_fields = {}
    for line in kr_text.splitlines():
        line = line.strip("\n")
        if not line.strip():
            continue
        fm = KR_FIELD_RE.match(line)
        if fm:
            kr_fields[fm.group(1).lower()] = fm.group(3).strip()

    du_raw = main_fields.get("DU", "").strip()
    try:
        du_val = int(du_raw)
    except ValueError:
        du_val = du_raw

    return {
        "no": cut_no,
        "sc": main_fields.get("SC", ""),
        "sp": main_fields.get("SP", ""),
        "pl": main_fields.get("PL", ""),
        "dl": main_fields.get("DL", ""),
        "nr": main_fields.get("NR", ""),
        "sh": main_fields.get("SH", ""),
        "ca": main_fields.get("CA", ""),
        "md": main_fields.get("MD", ""),
        "ac": main_fields.get("AC", ""),
        "du": du_val,
        "imagePrompt": ip_text.strip("\n"),
        "videoPrompt": vp_text.strip("\n"),
        "kr": {
            "sp": kr_fields.get("sp", ""),
            "ch": kr_fields.get("ch", ""),
            "sh": kr_fields.get("sh", ""),
            "ca": kr_fields.get("ca", ""),
            "ac": kr_fields.get("ac", ""),
            "md": kr_fields.get("md", ""),
            "dl": kr_fields.get("dl", ""),
            "nr": kr_fields.get("nr", ""),
        },
    }


def parse_script(text):
    episode = parse_header(text)

    cut_starts = [m.start() for m in re.finditer(r"^\[C\d+\]\s*$", text, re.MULTILINE)]
    cuts = []
    for i, start in enumerate(cut_starts):
        end = cut_starts[i + 1] if i + 1 < len(cut_starts) else len(text)
        cut = parse_cut_block(text[start:end])
        if cut:
            cuts.append(cut)

    return {"episode": episode, "cuts": cuts}


def resolve_input_path(file_arg):
    if os.path.isabs(file_arg) or os.path.dirname(file_arg):
        return file_arg
    return os.path.join(SCRIPTS_OUTPUT_DIR, file_arg)


def main():
    parser = argparse.ArgumentParser(
        description="script_generator.py가 만든 {에피소드코드}_script.txt를 prompts.json으로 변환"
    )
    parser.add_argument(
        "--file", required=True,
        help="입력 스크립트 파일 (파일명만 주면 scripts_output/ 기준으로 찾음)"
    )
    args = parser.parse_args()

    in_path = resolve_input_path(args.file)
    if not os.path.exists(in_path):
        print(f"오류: 입력 파일을 찾을 수 없습니다: {in_path}", file=sys.stderr)
        sys.exit(1)

    with open(in_path, encoding="utf-8") as f:
        text = f.read()

    data = parse_script(text)
    if not data["cuts"]:
        print("오류: 컷을 하나도 파싱하지 못했습니다. 입력 파일 형식을 확인하세요.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(PROMPTS_OUTPUT_PATH), exist_ok=True)
    with open(PROMPTS_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[완료] {PROMPTS_OUTPUT_PATH} ({len(data['cuts'])}개 컷)")


if __name__ == "__main__":
    main()
