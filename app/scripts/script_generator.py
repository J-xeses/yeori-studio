#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
script_generator.py

마스터 코드를 입력받아 yeori_ruleset v1.3.1(⑬ 대본 포맷 코드화 규칙) 기준의
표준 컷 포맷 대본 텍스트를 자동 생성한다.

마스터 코드 형식:
    [에피소드코드] :: [B군] :: [C군] :: [D군] :: [E군...] :: [F군]

    B군 (파이프라인, 1개): YR_VD YR_IM BR_ GR_ CC_
    C군 (공간, 여러 개 가능): IN/OT CF/HM/ST/RE TZ_AF/TZ_GH/TZ_NT LT_WM/LT_NE
    D군 (캐릭터/의상/헤어, 여러 개 가능): LK_ TOP_ BTM_ SH_HHL/SH_SNK/SH_FLT HR_
    E군 (샷/카메라/감정/동작, 여러 개 가능·여러 ::세그먼트에 걸쳐 있어도 됨):
         - 단순형: SH_ CA_ MD_ AT_ 코드를 그대로 나열
         - 구간형: CL_{초}S_{구간수}[라벨:SH_+CA_|라벨:SH_+CA_|...]
           (컷을 여러 서브 구간으로 나눠 구간별 샷/카메라를 지정)
    F군 (예비/미정, 선택): 현재 codebook에 없는 코드는 자동으로 F군(참고용)으로 분류됨

    같은 군 안의 여러 코드는 공백, 쉼표(,), 마침표(.), 더하기(+) 중 아무 것이나
    구분자로 써도 된다. E군/F군은 "::" 세그먼트가 여러 개로 나뉘어 있어도
    (예: ...::CL_..[...]::AT_..+MD_..::Q_..) 전체를 하나의 코드 풀로 합쳐 처리하며,
    codebook에 등록된 코드만 각 카테고리(샷/카메라/감정/동작)로 인식하고
    나머지는 F군(미정)으로 취급한다.

    마스터 코드가 너무 길어 여러 줄로 줄바꿈되어 있는 경우, "::"로 시작하는
    줄은 자동으로 이전 줄에 이어붙여 한 줄로 합친다.

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
    "hair":        {"HR_CORE": "롱웨이비 다크브라운"},
}

# 코드 -> (카테고리, 한국어 라벨) 역인덱스
CODE_INDEX = {}
for _cat, _codes in CODE_CATEGORIES.items():
    for _code, _label in _codes.items():
        CODE_INDEX[_code] = (_cat, _label)

# IP(이미지 프롬프트)/VP(영상 프롬프트)용 영어 대응표
EN_INDEX = {
    "IN": "indoor", "OT": "outdoor",
    "CF": "cafe", "HM": "home", "ST": "street", "RE": "restaurant",
    "TZ_AF": "afternoon", "TZ_GH": "golden hour", "TZ_NT": "night",
    "LT_WM": "warm sunlight", "LT_NE": "neon light",
    "LK_CS": "casual style", "LK_NT": "night, dressy style",
    "LK_HM": "cozy homewear style", "LK_SH": "editorial photoshoot style",
    "TOP_CRP": "white crop top", "TOP_KNT": "a knit sweater",
    "TOP_TNK": "a turtleneck", "TOP_OFS": "an off-shoulder top",
    "BTM_DNM": "denim shorts", "BTM_SHT": "denim shorts", "BTM_SKT": "a skirt",
    "SH_HHL": "stiletto high heels", "SH_SNK": "sneakers", "SH_FLT": "flat shoes",
    "HR_CORE": "long wavy dark brown hair",
    "CA_ST": "camera holds steady", "CA_PS": "camera gently pushes in",
    "CA_ZI": "camera zooms in", "CA_PL": "camera pulls out",
    "CA_PN_L": "camera pans left", "CA_PN_R": "camera pans right",
    "CA_TK": "camera tracks alongside her",
    "AT_SD_01": "she stands looking forward", "AT_SD_02": "she stands looking to the side",
    "AT_SI_01": "she sits looking forward", "AT_MW_01": "she walks naturally",
    "AT_AC_05": "she looks directly at the camera", "AT_EM_01": "she smiles warmly",
    "AT_EM_02": "a surprised expression crosses her face", "AT_EM_03": "she looks lost in thought",
    "MD_JOY": "bright joyful expression", "MD_SUR": "shocked, awakening mood",
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
DEFAULT_DU = 8

# CL_{초}S_{구간수}[라벨:코드+코드|라벨:코드+코드|...]
CL_PATTERN = re.compile(r"CL_(\d+)S_(\d+)\[([^\]]*)\]")

# 그룹 내부 토큰 구분자: 공백, 쉼표, 마침표, 더하기
_TOKEN_SPLIT_RE = re.compile(r"[+.\s,]+")


# ── 토크나이저 / 분류 유틸 ──────────────────────────────────────────────

def tokenize_group(segment):
    """군 안의 여러 코드를 공백/쉼표/마침표/더하기 기준으로 분리"""
    return [t for t in _TOKEN_SPLIT_RE.split(segment.strip()) if t]


def classify(tokens):
    """토큰 목록을 CODE_CATEGORIES 기준 카테고리별로 분류. 매칭 안 되는 토큰은 'unknown'(F군)에 보관"""
    result = {cat: [] for cat in CODE_CATEGORIES}
    result["unknown"] = []
    for t in tokens:
        entry = CODE_INDEX.get(t)
        if entry:
            result[entry[0]].append(t)
        else:
            result["unknown"].append(t)
    return result


def extract_cl_block(text):
    """
    text에서 CL_{초}S_{구간수}[라벨:코드+코드|...] 블록을 찾아 파싱하고,
    (cl_info, 블록이 제거된 나머지 텍스트)를 반환한다. 블록이 없으면 (None, text).
    """
    m = CL_PATTERN.search(text)
    if not m:
        return None, text

    duration = int(m.group(1))
    declared_count = int(m.group(2))
    body = m.group(3)

    segments = []
    for i, seg_text in enumerate(body.split("|")):
        seg_text = seg_text.strip()
        if not seg_text:
            continue
        if ":" in seg_text:
            label, codes = seg_text.split(":", 1)
            label = label.strip()
        else:
            label, codes = f"SEG{i + 1}", seg_text
        seg_tokens = tokenize_group(codes)
        sh = next((t for t in seg_tokens if t in CODE_CATEGORIES["shot"]), None)
        ca = next((t for t in seg_tokens if t in CODE_CATEGORIES["camera"]), None)
        segments.append({"label": label, "sh": sh, "ca": ca})

    cl_info = {"duration": duration, "declared_count": declared_count, "segments": segments}
    remainder = text[:m.start()] + " " + text[m.end():]
    return cl_info, remainder


def first_or(tokens, default=None):
    return tokens[0] if tokens else default


def ko_labels(codes):
    return [CODE_INDEX[c][1] for c in codes if c in CODE_INDEX]


def en_labels(codes):
    return [EN_INDEX[c] for c in codes if c in EN_INDEX]


def split_duration(du, n):
    """DU초를 n개 구간으로 가능한 균등하게 나눠 (start, end) 리스트 반환"""
    if n <= 0:
        return []
    base, rem = divmod(du, n)
    bounds = [0]
    for i in range(n):
        bounds.append(bounds[-1] + base + (1 if i < rem else 0))
    return list(zip(bounds[:-1], bounds[1:]))


def shot_ip_prefix(shot_code):
    if shot_code in CLOSEUP_SHOTS:
        return "CLOSEUP SHOT — "
    if shot_code in FULLBODY_SHOTS:
        return "FULLBODY SHOT — "
    return ""


# ── 마스터 코드 파서 ───────────────────────────────────────────────────

def parse_master_code(line):
    """
    [에피소드코드] :: [B군] :: [C군] :: [D군] :: [E군...] :: [F군] 파싱.
    E군/F군은 "::" 세그먼트 개수가 가변적일 수 있어(단순형 6세그먼트 / 구간형은
    CL_ 블록 + AT_/MD_ 블록 + F군까지 7세그먼트 이상 가능), 4번째 세그먼트
    이후 전부를 하나의 풀로 합쳐서 codebook 기준으로 재분류한다.
    """
    parts = [p.strip() for p in line.split("::")]
    if len(parts) < 5:
        raise ValueError(
            f"마스터 코드 형식 오류 — '::' 구분 5개 이상 필요 (에피소드코드::B::C::D::E[::F]): {line}"
        )

    episode_code = parts[0]
    pipeline_tokens = tokenize_group(parts[1])
    space_raw = parts[2]
    space_tokens = tokenize_group(space_raw)
    look_tokens = tokenize_group(parts[3])

    rest_text = " ".join(parts[4:])
    cl_info, remainder = extract_cl_block(rest_text)
    rest_tokens = tokenize_group(remainder)
    rest_classified = classify(rest_tokens)

    # 구간별 대사/감정 zip을 위해 원래 등장 순서를 보존한 action/mood 코드 목록
    action_mood_ordered = [
        t for t in rest_tokens
        if t in CODE_CATEGORIES["action"] or t in CODE_CATEGORIES["mood"]
    ]

    return {
        "episode_code": episode_code,
        "pipeline": pipeline_tokens,
        "space": space_tokens,
        "space_raw": space_raw,
        "look": look_tokens,
        "cl_info": cl_info,
        "rest_classified": rest_classified,
        "action_mood_ordered": action_mood_ordered,
        "extra": rest_classified["unknown"],
    }


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


# ── KR 컨펌본 텍스트 조합 ──────────────────────────────────────────────

def kr_space_line(space_by_cat):
    place = ko_labels(space_by_cat["space_place"])
    typ = ko_labels(space_by_cat["space_type"])
    time_ = ko_labels(space_by_cat["space_time"])
    light = ko_labels(space_by_cat["space_light"])
    phrase1 = " ".join(place + typ)
    parts = [p for p in [phrase1, " ".join(time_), " ".join(light)] if p]
    return " / ".join(parts) if parts else "(미지정)"


def kr_look_line(look_by_cat):
    style = ko_labels(look_by_cat["look_style"])
    clothing = ko_labels(look_by_cat["look_top"] + look_by_cat["look_bottom"] + look_by_cat["look_shoes"])
    hair = ko_labels(look_by_cat["hair"])
    parts = []
    if style:
        parts.append(" ".join(style))
    if clothing:
        parts.append(" + ".join(clothing))
    if hair:
        parts.append(" ".join(hair))
    return " / ".join(parts) if parts else "(미지정)"


def en_space_phrase(space_by_cat):
    typ = en_labels(space_by_cat["space_type"])
    place = en_labels(space_by_cat["space_place"])
    time_ = en_labels(space_by_cat["space_time"])
    light = en_labels(space_by_cat["space_light"])
    part1 = " ".join(typ + place)
    part2 = ", ".join(light + time_)
    if part1 and part2:
        return f"{part1} setting, {part2} light"
    return part1 or part2 or "an unspecified location"


# ── 컷 블록 생성 ───────────────────────────────────────────────────────

def build_cut_block(cut_no, code_line):
    parsed = parse_master_code(code_line)

    space = classify(parsed["space"])
    look = classify(parsed["look"])
    rest = parsed["rest_classified"]
    cl_info = parsed["cl_info"]
    pipeline_code, _pipeline_ko = pipeline_code_and_label(parsed["pipeline"])

    space_codes_all = (
        space["space_type"] + space["space_place"] + space["space_time"] + space["space_light"]
    )
    look_codes_all = look["look_style"] + look["look_top"] + look["look_bottom"] + look["look_shoes"]
    ip_clothing_codes = look["look_top"] + look["look_bottom"] + look["look_shoes"]

    action_codes = rest["action"]
    mood_codes = rest["mood"]
    mood_code = first_or(mood_codes)

    if cl_info and cl_info["segments"]:
        du = cl_info["duration"]
        sh_sequence = [seg["sh"] for seg in cl_info["segments"] if seg["sh"]]
        ca_sequence = [seg["ca"] for seg in cl_info["segments"] if seg["ca"]]
        shot_code = first_or(sh_sequence)          # 대표 샷(IP 프리픽스 판단용) = 첫 구간 기준
        sh_field = " → ".join(sh_sequence) if sh_sequence else "(미지정)"
        ca_field = " → ".join(ca_sequence) if ca_sequence else "(미지정)"
        sh_kr_field = " → ".join(ko_labels(sh_sequence)) if sh_sequence else "(미지정)"
        ca_kr_field = " → ".join(ko_labels(ca_sequence)) if ca_sequence else "(미지정)"
    else:
        du = DEFAULT_DU
        shot_code = first_or(rest["shot"])
        camera_code = first_or(rest["camera"])
        sh_field = shot_code or "(미지정)"
        ca_field = camera_code or "(미지정)"
        sh_kr_field = CODE_INDEX[shot_code][1] if shot_code else "(미지정)"
        ca_kr_field = CODE_INDEX[camera_code][1] if camera_code else "(미지정)"

    # ── SC: 공간 + 분위기 한국어 묘사 ──
    sc_bits = ko_labels(space_codes_all)
    sc = " ".join(sc_bits) if sc_bits else "(공간 미지정)"
    if mood_code:
        sc += f", {CODE_INDEX[mood_code][1]} 분위기"

    ac_field = "+".join(action_codes) if action_codes else "(미지정)"
    ac_kr = " + ".join(ko_labels(action_codes)) if action_codes else "(미지정)"
    md_field = "+".join(mood_codes) if mood_codes else "(미지정)"
    md_kr = " + ".join(ko_labels(mood_codes)) if mood_codes else "(미지정)"

    cut_no_str = f"{cut_no:02d}"
    lines = []
    lines.append(f"[C{cut_no_str}]")
    lines.append(f"SC: {sc}")
    lines.append(f"SP: {parsed['space_raw'] or '(미지정)'}")
    lines.append(f"PL: {pipeline_code}")
    lines.append("CH: 서여리")
    lines.append("DL: ")
    lines.append("NR: ")
    lines.append(f"SH: {sh_field}")
    lines.append(f"CA: {ca_field}")
    lines.append(f"MD: {md_field}")
    lines.append(f"AC: {ac_field}")
    lines.append(f"DU: {du}")
    lines.append("")

    # ── KR 한글 컨펌본 ──
    sep = "━" * 24
    lines.append(sep)
    lines.append("KR (한글 컨펌본)")
    lines.append(sep)
    lines.append(f"SP(장소):     {kr_space_line(space)}")
    lines.append(f"CH(캐릭터):   {kr_look_line(look)}")
    lines.append(f"SH(샷):       {sh_kr_field}")
    lines.append(f"CA(카메라):   {ca_kr_field}")
    lines.append(f"AC(동작):     {ac_kr}")
    lines.append(f"MD(감정):     {md_kr}")
    lines.append("DL(대사):     ")
    lines.append("NR(나레이션): ")
    lines.append(sep)

    # ── IP 이미지 프롬프트 ──
    lines.append("IP (이미지 프롬프트)")
    lines.append(sep)
    prefix = shot_ip_prefix(shot_code)
    ip_lines = [f"{prefix}{YEORI_BASE_LINES[0]}"]
    ip_lines.extend(YEORI_BASE_LINES[1:])
    clothing_en = ", ".join(en_labels(ip_clothing_codes)) or "casual everyday outfit"
    space_en = en_space_phrase(space)
    ip_lines.append(f"wearing {clothing_en},")
    ip_lines.append(f"{space_en},")
    ip_lines.append("background people must not interact with main character.")
    lines.extend(ip_lines)
    lines.append(sep)

    # ── VP 영상 프롬프트 ──
    lines.append("VP (영상 프롬프트)")
    lines.append(sep)
    lines.extend(build_vp_lines(cl_info, du, parsed["action_mood_ordered"], shot_code, mood_code, action_codes))
    lines.append(sep)

    return "\n".join(lines), parsed["episode_code"], parsed["extra"]


def build_vp_lines(cl_info, du, action_mood_ordered, fallback_shot, fallback_mood, fallback_actions):
    """
    CL_ 구간 정보가 있으면 구간별 CA_ + (AT_/MD_ 순서대로 1개씩 매칭)로 영어 문장을 만들고,
    없으면(단순형 마스터 코드) 기존 3구간(First/Next/Final) 방식으로 만든다.
    """
    lines = []

    if cl_info and cl_info["segments"]:
        segments = cl_info["segments"]
        n = len(segments)
        bounds = split_duration(du, n)
        generic_labels = ["First", "Next", "Final"] if n == 3 else [f"Seg{i + 1}" for i in range(n)]
        for i, seg in enumerate(segments):
            start, end = bounds[i] if i < len(bounds) else (0, du)
            cam_en = EN_INDEX.get(seg["ca"], "camera holds the frame")
            aux_code = None
            if action_mood_ordered:
                aux_code = action_mood_ordered[i] if i < len(action_mood_ordered) else action_mood_ordered[-1]
            aux_en = EN_INDEX.get(aux_code, "she stays naturally in frame")
            seg_label = seg["label"] or f"C{i + 1}"
            prefix = generic_labels[i] if i < len(generic_labels) else f"Seg{i + 1}"
            lines.append(f"{prefix} {seg_label} ({start}-{end}s): {cam_en}, {aux_en}.")
        return lines

    # ── 단순형(단일 SH_/CA_/MD_/AT_) 폴백: 기존 First/Next/Final 3분할 ──
    cam_en = EN_INDEX.get(fallback_shot, "camera holds the frame")  # 참고용, 실제로는 camera_code 사용
    action_code = first_or(fallback_actions)
    act_en = EN_INDEX.get(action_code, "she stays naturally in frame")
    mood_en = EN_INDEX.get(fallback_mood, "a natural mood")
    seg_labels = ["First", "Next", "Final"]
    bounds = split_duration(du, 3)
    for i, (start, end) in enumerate(bounds):
        if i == 0:
            desc = f"{cam_en}, {act_en}."
        elif i == len(bounds) - 1:
            desc = f"the moment settles, {mood_en}."
        else:
            desc = f"{act_en} continues, {mood_en}."
        lines.append(f"{seg_labels[i]} {start}-{end}s: {desc}")
    return lines


# ── 여러 줄 입력 전처리 ────────────────────────────────────────────────

def join_wrapped_lines(raw_lines):
    """
    마스터 코드가 너무 길어 "::"로 시작하는 줄로 줄바꿈되어 있으면
    이전 줄에 이어붙여 하나의 논리적 줄로 합친다.
    """
    joined = []
    for raw in raw_lines:
        line = raw.rstrip("\n").rstrip("\r")
        if line.strip().startswith("::") and joined:
            joined[-1] = joined[-1].rstrip() + " " + line.strip()
        else:
            joined.append(line)
    return joined


# ── 메인 ──────────────────────────────────────────────────────────────

def generate_script(raw_lines):
    code_lines = join_wrapped_lines(raw_lines)

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
