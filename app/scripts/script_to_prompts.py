#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
script_to_prompts.py (v2 — AT/CP 필드 + 신규 [CUT N] 헤더 대응)

script_generator.py(v2)가 생성한 {에피소드코드}_script.txt를 읽어
스튜디오가 사용하는 downloads/flow/prompts.json 형식으로 변환한다.

v1 대비 변경점:
    - 컷 헤더가 "[C01]"(단독 줄) → "[CUT 1]  {제목} / {du}초"(제목 포함)로
      바뀌어서, 줄 끝 고정 정규식 대신 "[CUT N]"으로 시작하는지만 확인하도록 변경
    - 섹션 파싱을 SEP.split()의 위치(인덱스) 계산 대신, 줄 단위로 섹션
      제목("KR (한글 컨펌본)"/"IP (이미지 프롬프트)"/"VP (영상 프롬프트)")을
      직접 인식하는 상태 머신 방식으로 재작성 — 헤더 줄바꿈 구조가 바뀌어도
      안 깨지도록 견고하게 만듦(ScriptGenTab.jsx의 v3 파서와 동일한 접근)
    - AC 필드 → AT로 통일해서 읽음. 단, 기존 스튜디오 앱(ScriptGenTab.jsx)이
      아직 pc.ac / pc.kr.ac를 참조하므로, 출력 JSON에는 at와 함께 ac(=at와
      동일 값)도 같이 내려준다 — ScriptGenTab.jsx가 at 참조로 바뀌기 전까지의
      호환용 별칭이니, 그쪽 마이그레이션이 끝나면 ac 출력은 제거해도 된다.
    - CP(자막) 필드 신규 추가 → 출력 JSON에는 "subtitle" 키로 저장
      (codebook.json의 CP.script_to_prompts_key와 동일하게 맞춤)
    - LOOK_ID 필드 신규 추가 → 출력 JSON에 lookId로 포함

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

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

SCRIPTS_OUTPUT_DIR = r"C:\yeori-studio\app\scripts_output"
PROMPTS_OUTPUT_PATH = r"C:\yeori-studio\downloads\flow\prompts.json"

# script_generator.py가 컷 블록 안에서 섹션 구분에 쓰는 구분선과 동일해야 한다.
SEP = "━" * 24

CUT_HEADER_RE = re.compile(r"^\[CUT\s+(\d+)\]")
MAIN_FIELD_RE = re.compile(r"^(SC|SP|PL|CH|DL|NR|CP|AT|SH|CA|MD|LOOK_ID|DU):\s?(.*)$")
KR_FIELD_RE = re.compile(r"^([A-Z]+)\(([^)]*)\):\s*(.*)$")
HEADER_RE = re.compile(r"^={10,}\n마스터 코드\n(.+)\n={10,}", re.MULTILINE)

SECTION_TITLES = {
    "KR (한글 컨펌본)": "kr",
    "IP (이미지 프롬프트)": "ip",
    "VP (영상 프롬프트)": "vp",
}

# "(작성 필요)"는 v2 script_generator.py가 DL/NR/CP 미입력 필드에 쓰는 표시.
# prompts.json에는 실제 미입력 상태를 나타내도록 빈 문자열로 정규화한다.
PLACEHOLDER_VALUES = {"(작성 필요)", "없음"}


def tokenize(segment):
    """공백/쉼표/마침표/더하기 기준으로 토큰 분리 (script_generator.py와 동일한 규칙)"""
    return [t for t in re.split(r"[+.\s,]+", segment.strip()) if t]


def normalize_placeholder(val):
    return "" if val in PLACEHOLDER_VALUES else val


def parse_header(text):
    """"마스터 코드" 헤더(=== 사이의 원본 마스터 코드 줄)에서 episode 메타데이터
    (code/pipeline/quality/ratio/platform)를 추출한다. cuts.json 구조화 입력으로
    생성된 경우 이 줄이 마스터 코드 문법이 아닐 수 있어(예: "EP (cuts.json 구조화
    입력, N컷)") 그때는 code만 채우고 나머지는 빈 값으로 둔다."""
    episode = {"code": "", "pipeline": "", "quality": "", "ratio": "", "platform": ""}
    m = HEADER_RE.search(text)
    if not m:
        return episode

    raw = m.group(1).strip()
    parts = [p.strip() for p in raw.split("::")]
    episode["code"] = parts[0].split(" ")[0] if parts else ""
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


def split_cut_blocks(text):
    """[CUT N] 줄을 기준으로 컷 블록 텍스트를 나눈다."""
    starts = [(m.start(), int(m.group(1))) for m in re.finditer(r"^\[CUT\s+(\d+)\]", text, re.MULTILINE)]
    blocks = []
    for i, (start, no) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        blocks.append((no, text[start:end]))
    return blocks


def parse_cut_block(cut_no, block_text):
    """컷 블록 하나를 줄 단위 상태 머신으로 파싱 — SEP.split() 위치 계산에
    의존하지 않아 헤더/섹션 구조가 조금 바뀌어도 안 깨진다."""
    section = "main"
    buckets = {"main": [], "kr": [], "ip": [], "vp": []}

    for line in block_text.splitlines():
        stripped = line.strip()
        if stripped == SEP:
            continue
        if CUT_HEADER_RE.match(stripped):
            continue  # 헤더 줄 자체는 필드 파싱 대상이 아님(제목 텍스트라 MAIN_FIELD_RE와 안 겹침)
        if stripped in SECTION_TITLES:
            section = SECTION_TITLES[stripped]
            continue
        buckets[section].append(line)

    main_fields = {}
    for line in buckets["main"]:
        fm = MAIN_FIELD_RE.match(line.strip())
        if fm:
            main_fields[fm.group(1)] = fm.group(2).strip()

    kr_fields = {}
    for line in buckets["kr"]:
        if not line.strip():
            continue
        fm = KR_FIELD_RE.match(line.strip("\n"))
        if fm:
            kr_fields[fm.group(1).lower()] = fm.group(3).strip()

    def joined(lines):
        # 섹션 앞뒤 빈 줄만 제거하고 내용은 그대로 유지
        start, end = 0, len(lines)
        while start < end and not lines[start].strip():
            start += 1
        while end > start and not lines[end - 1].strip():
            end -= 1
        return "\n".join(lines[start:end])

    du_raw = main_fields.get("DU", "").strip()
    try:
        du_val = int(du_raw)
    except ValueError:
        du_val = du_raw

    at_val = normalize_placeholder(main_fields.get("AT", ""))
    kr_at = normalize_placeholder(kr_fields.get("at", ""))

    return {
        "no": str(cut_no),
        "sc": main_fields.get("SC", ""),
        "sp": main_fields.get("SP", ""),
        "pl": main_fields.get("PL", ""),
        "dl": normalize_placeholder(main_fields.get("DL", "")),
        "nr": normalize_placeholder(main_fields.get("NR", "")),
        "subtitle": normalize_placeholder(main_fields.get("CP", "")),   # CP → subtitle
        "at": at_val,
        "ac": at_val,   # 레거시 별칭 — ScriptGenTab.jsx가 at로 마이그레이션되면 제거 가능
        "sh": main_fields.get("SH", ""),
        "ca": main_fields.get("CA", ""),
        "md": main_fields.get("MD", ""),
        "lookId": main_fields.get("LOOK_ID", ""),
        "du": du_val,
        "imagePrompt": joined(buckets["ip"]),
        "videoPrompt": joined(buckets["vp"]),
        "kr": {
            "sp": kr_fields.get("sp", ""),
            "ch": kr_fields.get("ch", ""),
            "sh": kr_fields.get("sh", ""),
            "ca": kr_fields.get("ca", ""),
            "at": kr_at,
            "ac": kr_at,   # 레거시 별칭
            "md": kr_fields.get("md", ""),
            "dl": normalize_placeholder(kr_fields.get("dl", "")),
            "nr": normalize_placeholder(kr_fields.get("nr", "")),
            "cp": normalize_placeholder(kr_fields.get("cp", "")),
        },
    }


def parse_script(text):
    episode = parse_header(text)
    cuts = [parse_cut_block(no, block) for no, block in split_cut_blocks(text)]
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
