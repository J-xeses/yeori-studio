#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
script_generator.py

마스터 코드를 입력받아 yeori_ruleset v1.3.1(⑬ 대본 포맷 코드화 규칙) 기준의
표준 컷 포맷 대본 텍스트를 자동 생성한다.

마스터 코드 형식:
    [에피소드코드] :: [B군] :: [C군] :: [D군] :: [E군] :: [F군]

    B군 (파이프라인, 1개): YR_VD YR_IM BR_ GR_ CC_
    C군 (공간, 여러 개 가능): IN/OT CF/HM/ST/RE TZ_AF/TZ_GH/TZ_NT LT_WM/LT_NE
    D군 (캐릭터/의상, 여러 개 가능): LK_ TOP_ BTM_ SH_HHL/SH_SNK/SH_FLT
    E군 (샷/카메라/감정/동작, 여러 개 가능): SH_ CA_ MD_ AT_
    F군 (예비/미정, 선택): 현재 codebook 없음 — 있는 그대로 마스터 코드 헤더에만 기록

    같은 군 안의 여러 코드는 공백 또는 쉼표로 구분한다.

실행 방법:
    python script_generator.py --code "SF_E01_SHOE :: YR_VD :: IN CF TZ_AF LT_WM :: LK_CS TOP_CRP BTM_DNM SH_SNK :: SH_CU CA_PS MD_JOY AT_SD_01"
    python script_generator.py --file master_code.txt   (한 줄 = 컷 1개, 여러 줄 = C01, C02, ...)

출력:
    C:\\yeori-studio\\app\\scripts_output\\[에피소드코드]_script.txt (UTF-8)
"""

import argparse
import os
import re
import sys

# Windows 콘솔(cp949 등) 환경에서도 한글 출력이 깨지지 않도록 stdout/stderr을 UTF-8로 고정
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

# ── 코드북 (yeori_ruleset v1.3.1 ⑬ 기준) ──────────────────────────────

CODE_CATEGORIES = {
    "space_type":  {"IN": "실내", "OT": "실외"},
    "space_place": {"CF": "카페", "HM": "집", "ST": "거리", "RE": "식당"},
    "space_time":  {"TZ_AF": "오후", "TZ_GH": "골든아워", "TZ_NT": "야간"},
    "space_light": {"LT_WM": "따뜻한 햇살", "LT_NE": "네온빛"},
    "shot": {
        "SH_ECU": "익스트림 클로즈업", "SH_CU": "클로즈업", "SH_MCU": "미디엄 클로즈업",
        "SH_MS": "미디엄샷", "SH_MLS": "미디엄롱샷", "SH_FS": "풀샷(전신)", "SH_WS": "와이드샷",
    },
    "camera": {
        "CA_ST": "고정", "CA_PS": "푸시인", "CA_ZI": "줌인", "CA_PL": "풀아웃",
        "CA_PN_L": "패닝(좌)", "CA_PN_R": "패닝(우)", "CA_TK": "트래킹",
    },
    "mood": {
        "MD_JOY": "밝고 활기찬", "MD_SUR": "충격·각성", "MD_INT": "집중·몰입", "MD_SAD": "슬픔·공허",
        "MD_REL": "편안·여유", "MD_DRM": "몽환·감성", "MD_CUR": "호기심·의문", "MD_STR": "강함·자신감",
    },
    "action": {
        "AT_SD_01": "서서 정면 응시", "AT_SD_02": "서서 측면 응시", "AT_SI_01": "앉아서 정면 응시",
        "AT_MW_01": "걷기 (일반)", "AT_AC_05": "카메라 직접 응시",
        "AT_EM_01": "미소·웃음", "AT_EM_02": "놀람 표정", "AT_EM_03": "생각에 잠김",
    },
    "pipeline": {
        "YR_VD": "서여리 립싱크 영상", "YR_IM": "서여리 이미지",
        "BR_": "B-Roll", "GR_": "그래픽", "CC_": "CapCut 전용",
    },
    "look_style":  {"LK_CS": "캐주얼", "LK_NT": "나이트·드레시", "LK_HM": "홈·편안", "LK_SH": "화보·촬영"},
    "look_top":    {"TOP_CRP": "크롭탑", "TOP_KNT": "니트", "TOP_TNK": "터틀넥", "TOP_OFS": "오프숄더"},
    "look_bottom": {"BTM_DNM": "데님쇼츠/팬츠", "BTM_SHT": "쇼츠", "BTM_SKT": "스커트"},
    "look_shoes":  {"SH_HHL": "하이힐 (스틸레토)", "SH_SNK": "스니커즈", "SH_FLT": "플랫슈즈"},
}

# 코드 -> (카테고리, 한국어 라벨) 역인덱스
CODE_INDEX = {}
for _cat, _codes in CODE_CATEGORIES.items():
    for _code, _label in _codes.items():
        CODE_INDEX[_code] = (_cat, _label)

# IP(이미지 프롬프트)/VP(영상 프롬프트)용 영어 대응표
EN_INDEX = {
    "IN": "indoor", "OT": "outdoor",
    "CF": "a cafe", "HM": "a home", "ST": "a street", "RE": "a restaurant",
    "TZ_AF": "afternoon", "TZ_GH": "golden hour", "TZ_NT": "night",
    "LT_WM": "warm sunlight", "LT_NE": "neon light",
    "LK_CS": "casual style", "LK_NT": "night, dressy style",
    "LK_HM": "cozy homewear style", "LK_SH": "editorial photoshoot style",
    "TOP_CRP": "a cropped top", "TOP_KNT": "a knit sweater",
    "TOP_TNK": "a turtleneck", "TOP_OFS": "an off-shoulder top",
    "BTM_DNM": "denim shorts", "BTM_SHT": "shorts", "BTM_SKT": "a skirt",
    "SH_HHL": "stiletto high heels", "SH_SNK": "sneakers", "SH_FLT": "flat shoes",
    "CA_ST": "the camera stays static", "CA_PS": "the camera pushes in slowly",
    "CA_ZI": "the camera zooms in", "CA_PL": "the camera pulls out",
    "CA_PN_L": "the camera pans left", "CA_PN_R": "the camera pans right",
    "CA_TK": "the camera tracks alongside her",
    "AT_SD_01": "standing, looking straight ahead", "AT_SD_02": "standing, looking to the side",
    "AT_SI_01": "sitting, looking straight ahead", "AT_MW_01": "walking naturally",
    "AT_AC_05": "looking directly at the camera", "AT_EM_01": "smiling gently",
    "AT_EM_02": "a surprised expression", "AT_EM_03": "lost in thought",
    "MD_JOY": "bright, cheerful mood", "MD_SUR": "shocked, awakening mood",
    "MD_INT": "focused, immersive mood", "MD_SAD": "sad, empty mood",
    "MD_REL": "relaxed, at-ease mood", "MD_DRM": "dreamy, sentimental mood",
    "MD_CUR": "curious, questioning mood", "MD_STR": "strong, confident mood",
}

# ⑬ 체크리스트: SH_CU/SH_MCU -> "CLOSEUP SHOT —", SH_FS/SH_MLS -> "FULLBODY SHOT —"
# SH_ECU/SH_MS/SH_WS는 ⑬에 명시되지 않아, 클로즈업 계열/풀샷 계열로 자연 확장해 매핑한다.
CLOSEUP_SHOTS = {"SH_ECU", "SH_CU", "SH_MCU"}
FULLBODY_SHOTS = {"SH_FS", "SH_MLS", "SH_MS", "SH_WS"}

YEORI_BASE_LINES = [
    "Young Korean woman early-20s,",
    "long wavy dark brown hair NOT short hair,",
    "a very subtle natural skin texture on her right cheek,",
    "delicate gold necklace,",
    "effortlessly photogenic not posing just existing beautifully,",
    "K-model proportions small face long legs,",
    "appearing no older than 22-23,",
]

OUTPUT_DIR = r"C:\yeori-studio\app\scripts_output"


# ── 마스터 코드 파서 ───────────────────────────────────────────────────

def tokenize_group(segment):
    """군 안의 여러 코드를 공백/쉼표 기준으로 분리"""
    return [t for t in re.split(r"[,\s]+", segment.strip()) if t]


def parse_master_code(line):
    """
    [에피소드코드] :: [B군] :: [C군] :: [D군] :: [E군] :: [F군] 파싱
    """
    parts = [p.strip() for p in line.split("::")]
    if len(parts) < 5:
        raise ValueError(
            f"마스터 코드 형식 오류 — '::' 구분 5개 이상 필요 (에피소드코드::B::C::D::E[::F]): {line}"
        )
    return {
        "episode_code": parts[0],
        "pipeline": tokenize_group(parts[1]),
        "space":    tokenize_group(parts[2]),
        "look":     tokenize_group(parts[3]),
        "shot_grp": tokenize_group(parts[4]),
        "extra":    tokenize_group(parts[5]) if len(parts) > 5 else [],
    }


def classify(tokens):
    """토큰 목록을 CODE_CATEGORIES 기준 카테고리별로 분류. 매칭 안 되는 토큰은 'unknown'에 보관"""
    result = {cat: [] for cat in CODE_CATEGORIES}
    result["unknown"] = []
    for t in tokens:
        entry = CODE_INDEX.get(t)
        if entry:
            result[entry[0]].append(t)
        else:
            result["unknown"].append(t)
    return result


def pipeline_code_and_label(tokens):
    for t in tokens:
        if t in CODE_CATEGORIES["pipeline"]:
            return t, CODE_CATEGORIES["pipeline"][t]
    # 접두어 기반 폴백 (예: BR_002, GR_titlecard 등 구체 코드)
    for t in tokens:
        for prefix in ("YR_VD", "YR_IM", "BR_", "GR_", "CC_"):
            if t.startswith(prefix):
                return t, CODE_CATEGORIES["pipeline"].get(prefix, prefix)
    return (tokens[0] if tokens else "(미지정)"), "(미지정)"


def ko_labels(codes):
    return [CODE_INDEX[c][1] for c in codes if c in CODE_INDEX]


def en_labels(codes):
    return [EN_INDEX[c] for c in codes if c in EN_INDEX]


def first_or(tokens, default=None):
    return tokens[0] if tokens else default


def shot_ip_prefix(shot_code):
    if shot_code in CLOSEUP_SHOTS:
        return "CLOSEUP SHOT — "
    if shot_code in FULLBODY_SHOTS:
        return "FULLBODY SHOT — "
    return ""


def split_duration(du, n=3):
    """DU초를 n개 구간으로 가능한 균등하게 나눠 (start, end) 리스트 반환"""
    base, rem = divmod(du, n)
    bounds = [0]
    for i in range(n):
        bounds.append(bounds[-1] + base + (1 if i < rem else 0))
    return list(zip(bounds[:-1], bounds[1:]))


# ── 컷 블록 생성 ───────────────────────────────────────────────────────

def build_cut_block(cut_no, code_line, du=8):
    parsed = parse_master_code(code_line)

    space = classify(parsed["space"])
    look = classify(parsed["look"])
    shot_grp = classify(parsed["shot_grp"])
    pipeline_code, _pipeline_ko = pipeline_code_and_label(parsed["pipeline"])

    shot_code = first_or(shot_grp["shot"])
    camera_code = first_or(shot_grp["camera"])
    mood_code = first_or(shot_grp["mood"])
    action_code = first_or(shot_grp["action"])

    space_codes_all = (
        space["space_type"] + space["space_place"] + space["space_time"] + space["space_light"]
    )
    look_codes_all = look["look_style"] + look["look_top"] + look["look_bottom"] + look["look_shoes"]

    # ── SC: 공간 + 분위기 한국어 묘사 ──
    sc_bits = ko_labels(space_codes_all)
    sc = " ".join(sc_bits) if sc_bits else "(공간 미지정)"
    if mood_code:
        sc += f", {CODE_INDEX[mood_code][1]} 분위기"

    cut_no_str = f"{cut_no:02d}"
    lines = []
    lines.append(f"[C{cut_no_str}]")
    lines.append(f"SC: {sc}")
    lines.append(f"SP: {' '.join(space_codes_all) if space_codes_all else '(미지정)'}")
    lines.append(f"PL: {pipeline_code}")
    lines.append("CH: 서여리")
    lines.append("DL: ")
    lines.append("NR: ")
    lines.append(f"SH: {shot_code or '(미지정)'}")
    lines.append(f"CA: {camera_code or '(미지정)'}")
    lines.append(f"MD: {mood_code or '(미지정)'}")
    lines.append(f"AC: {action_code or '(미지정)'}")
    lines.append(f"DU: {du}")
    lines.append("")

    # ── KR 한글 컨펌본 ──
    sep = "━" * 24
    lines.append(sep)
    lines.append("KR (한글 컨펌본)")
    lines.append(sep)
    lines.append(f"SP(장소):     {', '.join(ko_labels(space_codes_all)) or '(미지정)'}")
    lines.append(f"CH(캐릭터):   {', '.join(ko_labels(look_codes_all)) or '(미지정)'}")
    lines.append(f"SH(샷):       {CODE_INDEX[shot_code][1] if shot_code else '(미지정)'}")
    lines.append(f"CA(카메라):   {CODE_INDEX[camera_code][1] if camera_code else '(미지정)'}")
    lines.append(f"AC(동작):     {CODE_INDEX[action_code][1] if action_code else '(미지정)'}")
    lines.append(f"MD(감정):     {CODE_INDEX[mood_code][1] if mood_code else '(미지정)'}")
    lines.append("DL(대사):     ")
    lines.append("NR(나레이션): ")
    lines.append(sep)

    # ── IP 이미지 프롬프트 ──
    lines.append("IP (이미지 프롬프트)")
    lines.append(sep)
    prefix = shot_ip_prefix(shot_code)
    ip_lines = []
    first_base = YEORI_BASE_LINES[0]
    ip_lines.append(f"{prefix}{first_base}")
    ip_lines.extend(YEORI_BASE_LINES[1:])
    clothing_en = ", ".join(en_labels(look_codes_all)) or "casual everyday outfit"
    space_en = ", ".join(en_labels(space_codes_all)) or "an unspecified location"
    ip_lines.append(f"wearing {clothing_en},")
    ip_lines.append(f"in {space_en} setting,")
    ip_lines.append("background people must not interact with main character.")
    lines.extend(ip_lines)
    lines.append(sep)

    # ── VP 영상 프롬프트 ──
    lines.append("VP (영상 프롬프트)")
    lines.append(sep)
    seg_labels = ["First", "Next", "Final"]
    cam_en = EN_INDEX.get(camera_code, "the camera holds the frame")
    act_en = EN_INDEX.get(action_code, "she stays naturally in frame")
    mood_en = EN_INDEX.get(mood_code, "a natural mood")
    bounds = split_duration(du, 3)
    for i, (start, end) in enumerate(bounds):
        label = seg_labels[i] if i < len(seg_labels) else f"Seg{i+1}"
        if i == 0:
            desc = f"{cam_en}, she is {act_en}."
        elif i == len(bounds) - 1:
            desc = f"the moment settles, {mood_en}."
        else:
            desc = f"{act_en} continues, {mood_en}."
        lines.append(f"{label} {start}-{end}s: {desc}")
    lines.append(sep)

    return "\n".join(lines), parsed["episode_code"], parsed["extra"]


# ── 메인 ──────────────────────────────────────────────────────────────

def generate_script(code_lines):
    valid = []
    for i, raw in enumerate(code_lines, 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            block, ep_code, extra = build_cut_block(len(valid) + 1, line)
            valid.append((block, ep_code, extra, line))
        except ValueError as e:
            print(f"[경고] {i}번째 줄 건너뜀 — {e}", file=sys.stderr)

    if not valid:
        raise ValueError("유효하게 파싱된 마스터 코드가 없습니다.")

    episode_code = valid[0][1]
    first_line = valid[0][3]

    header = (
        "=" * 64 + "\n"
        "마스터 코드\n"
        f"{first_line}\n"
        + "=" * 64
    )

    body = "\n\n".join(block for block, _, _, _ in valid)
    return episode_code, f"{header}\n\n{body}\n"


def main():
    parser = argparse.ArgumentParser(
        description="마스터 코드 -> yeori_ruleset v1.3.1(⑬) 표준 컷 포맷 대본 자동 생성"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--code", type=str, help="마스터 코드 문자열 (여러 컷은 줄바꿈으로 구분)")
    group.add_argument("--file", type=str, help="마스터 코드가 담긴 텍스트 파일 경로 (한 줄 = 컷 1개)")
    args = parser.parse_args()

    if args.code:
        code_lines = args.code.splitlines()
    else:
        with open(args.file, encoding="utf-8") as f:
            code_lines = f.readlines()

    try:
        episode_code, script_text = generate_script(code_lines)
    except ValueError as e:
        print(f"오류: {e}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_path = os.path.join(OUTPUT_DIR, f"{episode_code}_script.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(script_text)

    print(f"[완료] {out_path}")


if __name__ == "__main__":
    main()
