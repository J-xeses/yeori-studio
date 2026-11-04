#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
handwriting_overlay.py — 서여리 릴스용 손글씨 주석 오버레이

인스타 스토리/릴스풍으로, 사진·영상 위에 손글씨 텍스트(구름/타원/화살표박스 말풍선,
점선 화살표, 하트·반짝이 장식, -3~+3도 랜덤 기울기)를 합성한다.

설정 포맷 2가지:
  - "scenes": 시간대(time)별 1개씩. 영상은 구간 합성, 이미지는 씬별 파일 저장.
  - "bubbles": 한 화면에 여러 주석 자유 배치. x/y(0~1 비율), 씬별 font_size 지원.
               이미지는 파일 1개로 합성(레퍼런스 인스타 스토리처럼).
각 항목 옵션: backing(false면 판 대신 글자 외곽선), arrow_target([x,y] 비율로 특정 지점 겨냥),
  bubble_scale(말풍선 윤곽만 확대/축소, 기본 1.0), offset_x/offset_y(위치 미세조정, 비율, 기본 0),
  angle(말풍선+글씨 전체를 한 장처럼 기울이는 입력각, 도 단위, 기본 0, 2026-11-03 추가).
config 최상위 "subject_outline": true|{width,gap,color,opacity} → 인물 둘레 손그림 흰 테두리
  (이미지 전용, rembg + onnxruntime 필요 — 없으면 조용히 건너뜀).

사용법:
  python handwriting_overlay.py --config config.json --input in.mp4 --output out.mp4
  python handwriting_overlay.py --config config.json --input in.png --output out.png

폰트: 저장소 번들 나눔손글씨 펜(app/assets/fonts/, OFL) 우선 → 시스템 빙그레체/나눔손글씨
→ 맑은고딕. 장식 ♡/✦는 폰트에 없어 벡터로 직접 그림. 문장 속 이모지는 Segoe UI Emoji.

씬을 다 그린 뒤 yeori_signature.py의 apply_yeori_signature()로 서여리 채널 시그니처를 얹는다.

필요 패키지: Pillow. (선택) 인물 테두리용 rembg+onnxruntime. 영상 입력 시 PATH에 ffmpeg.
"""

import argparse
import json
import math
import random
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from yeori_signature import apply_yeori_signature

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

# Windows 콘솔 기본 코드페이지(cp949)에서 이모지/특수기호 출력 시 깨지는 것 방지
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


# ── 폰트 ──────────────────────────────────────────────────────────────
# 저장소에 손글씨 폰트(나눔손글씨 펜, OFL)를 번들해 둔다 — 시스템에 손글씨 폰트가
# 없어도 항상 손글씨체로 렌더되도록. app/assets/fonts/ 기준.
BUNDLED_FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONT_DIRS = [
    BUNDLED_FONT_DIR,
    Path(r"C:\Windows\Fonts"),
    Path.home() / "AppData/Local/Microsoft/Windows/Fonts",
]

# Gaegu Bold(둥글고 도톰 — 영상 오버레이 가독성 좋음) 우선 → 나눔손글씨펜 → 시스템 손글씨 → 맑은고딕
HANDWRITING_FONT_CANDIDATES = [
    "Gaegu-Bold.ttf", "NanumPenScript-Regular.ttf",
    "BinggraeTaomB.ttf", "BinggraeTaom.ttf", "Binggrae.ttf",
    "NanumPen.ttf", "NanumBrush.ttf", "NanumBrushScript.ttf",
]
FALLBACK_FONT_CANDIDATES = ["malgun.ttf", "malgunbd.ttf"]
EMOJI_FONT_CANDIDATES = ["seguiemj.ttf"]


def _find_font(candidates):
    for d in FONT_DIRS:
        for name in candidates:
            p = d / name
            if p.exists():
                return p
    return None


def resolve_text_font_path():
    for group in (HANDWRITING_FONT_CANDIDATES, FALLBACK_FONT_CANDIDATES):
        found = _find_font(group)
        if found:
            return found
    return None


TEXT_FONT_PATH = resolve_text_font_path()
EMOJI_FONT_PATH = _find_font(EMOJI_FONT_CANDIDATES)

if TEXT_FONT_PATH:
    _low = TEXT_FONT_PATH.name.lower()
    is_hand = _low.startswith(("binggrae", "nanum", "gaegu"))
    is_bundled = BUNDLED_FONT_DIR in TEXT_FONT_PATH.parents
    note = "" if is_hand else " (손글씨 폰트 미탐지 — 맑은고딕으로 대체됨)"
    if is_bundled and not note:
        note = " (저장소 번들)"
    print(f"ℹ 손글씨 폰트: {TEXT_FONT_PATH.name}{note}")
else:
    print("⚠ 시스템에서 손글씨/맑은고딕 폰트를 못 찾아 PIL 기본 폰트로 대체합니다(한글이 깨질 수 있음).")

if not EMOJI_FONT_PATH:
    print("⚠ Segoe UI Emoji를 못 찾아 이모지가 빈 사각형으로 나올 수 있습니다.")

_FONT_CACHE = {}


def load_font(path, size):
    key = (str(path), size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(str(path), size) if path else ImageFont.load_default()
    return _FONT_CACHE[key]


# ── 색상 ──────────────────────────────────────────────────────────────
# 2026-11-03, 성준님 요청: "글씨 색 종류 몇 가지 추가" — 기존 3색에서 보색 계열까지 확장.
COLORS = {
    "white": (255, 255, 255, 255),
    "black": (0x2A, 0x2A, 0x2A, 255),
    "pink": (0xF9, 0xA8, 0xD0, 255),
    "lavender": (0xC3, 0xB3, 0xF5, 255),
    "yellow": (0xFD, 0xE0, 0x47, 255),
    "mint": (0x6E, 0xE7, 0xB7, 255),
    "sky": (0x7D, 0xD3, 0xFC, 255),
    "orange": (0xFD, 0xBA, 0x74, 255),
    "red": (0xF8, 0x71, 0x71, 255),
}


# ── 한글/이모지 혼합 렌더링 ─────────────────────────────────────────────
def is_emoji(ch):
    cp = ord(ch)
    ranges = [
        (0x1F300, 0x1FAFF),  # 각종 이모지
        (0x2600, 0x27BF),    # 기타 기호·딩뱃(♡ ✨ 포함)
        (0x2190, 0x21FF),    # 화살표
        (0x2B00, 0x2BFF),
        (0xFE00, 0xFE0F),    # variation selector
        (0x1F1E6, 0x1F1FF),
    ]
    return any(lo <= cp <= hi for lo, hi in ranges)


# 강조 마커(부분 강조): 본문에는 <<강조>> 로 쓰고, 렌더 전에 이 두 사설 영역 문자로 바꿔 넘긴다.
# 폭 0 — measure_line/split_runs 에서는 무시되고, draw_mixed_text 만 위치를 기록한다.
EMPH_OPEN, EMPH_CLOSE = "\ue0a1", "\ue0a2"
_EMPH_RE = re.compile(r"<<(.+?)>>", re.S)

# 손글씨 폰트에 글리프가 없어도 예전 동작(빈 칸 유지)을 그대로 두는 문자 — "…", "·", "※" 등 일반 구두점은
# 기존 주석에 이미 쓰이고 있어 폭이 바뀌면 안 된다(하위호환). 카오모지류(태국어·IPA·결합 부호 등)만 정리한다.
_KEEP_BLANK_CHARS = set("…·‧※")
_WARNED_MISSING = set()


def _classify_char(ch):
    """'text' | 'emoji' | None(그릴 수 없음 — 건너뜀). 기존에 문제없던 문자는 항상 기존 분류 그대로."""
    if is_emoji(ch):
        return "emoji"
    if ch.isspace() or ch in _KEEP_BLANK_CHARS or 0x2000 <= ord(ch) <= 0x206F:
        return "text"
    if not _is_missing_glyph(TEXT_FONT_PATH, 48, ch):
        return "text"
    if EMOJI_FONT_PATH and not _is_missing_glyph(EMOJI_FONT_PATH, 48, ch):   # 손글씨엔 없고 이모지 폰트엔 있음
        return "emoji"
    if ch not in _WARNED_MISSING:    # 어느 폰트에도 없음 → tofu/빈 칸 대신 깔끔히 건너뛴다
        _WARNED_MISSING.add(ch)
        print(f"⚠ 글리프 없음 — 건너뜀: U+{ord(ch):04X} {ch!r}", file=sys.stderr)
    return None


def split_runs(text):
    """텍스트를 (이모지여부, 연속구간) 단위로 분리"""
    runs = []
    cur_emoji, cur = None, ""
    dropped = False   # 직전에 글리프 없는 글자를 건너뛰었는가 — 카오모지 앞뒤 공백이 겹쳐 빈 칸이 두 배가 되는 것 방지
    for ch in text:
        if ch in (EMPH_OPEN, EMPH_CLOSE):
            continue
        kind = _classify_char(ch)
        if kind is None:
            dropped = True
            continue
        if dropped and ch == " " and (cur.endswith(" ") or (not cur and runs and runs[-1][1].endswith(" "))):
            continue
        dropped = False
        e = kind == "emoji"
        if cur_emoji is None:
            cur_emoji, cur = e, ch
        elif e == cur_emoji:
            cur += ch
        else:
            runs.append((cur_emoji, cur))
            cur_emoji, cur = e, ch
    if cur:
        runs.append((cur_emoji, cur))
    return runs


def _run_font(is_e, size):
    if is_e and EMOJI_FONT_PATH:
        return load_font(EMOJI_FONT_PATH, max(8, int(size * 0.92)))
    return load_font(TEXT_FONT_PATH, size)


def measure_line(draw, text, size):
    w = 0
    for is_e, run in split_runs(text):
        w += draw.textlength(run, font=_run_font(is_e, size))
    return w


# 릴스 자막 줄바꿈·표시시간 수동 편집(2026-09-28, 성준님): 자막 편집 UI(Enter=\n)로 넣은
# 수동 줄바꿈은 항상 그대로 유지하고, 한 줄이 안전 폭을 넘칠 때만 그 줄만 자동으로 더 나눈다.
# 영상 탭 미리보기(ReelCaptionOverlay, CSS white-space:pre-wrap)와 같은 규칙.
def wrap_paragraph(draw, para, size, max_width):
    if not para:
        return [""]
    if measure_line(draw, para, size) <= max_width:
        return [para]
    words = para.split(" ")
    lines, cur = [], ""
    for w in words:
        test = f"{cur} {w}" if cur else w
        if not cur or measure_line(draw, test, size) <= max_width:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    # 공백 기준으로 나눠도 한 조각이 폭을 넘으면(긴 단어) 글자 단위로 다시 쪼갠다.
    final = []
    for ln in lines:
        if measure_line(draw, ln, size) <= max_width:
            final.append(ln)
            continue
        buf = ""
        for ch in ln:
            test = buf + ch
            if not buf or measure_line(draw, test, size) <= max_width:
                buf = test
            else:
                final.append(buf)
                buf = ch
        if buf:
            final.append(buf)
    return final or [""]


_TOFU_CACHE = {}


def _is_missing_glyph(font_path, size, ch):
    """font_path 폰트에 ch의 실제 글리프가 없어 대체 사각형(tofu box)으로 나오는지 확인.
    U+E000(사용자 영역, 어떤 폰트에도 절대 존재 안 함)의 렌더 결과와 픽셀 비교해서 판별
    (getmask().getbbox()만으로는 tofu box 자체도 '비어있지 않은 사각형'이라 구분이 안 됨 — 실측 확인)."""
    if not font_path:
        return True
    font = load_font(font_path, size)
    key = (str(font_path), size)
    if key not in _TOFU_CACHE:
        _TOFU_CACHE[key] = bytes(font.getmask(""))
    mask = font.getmask(ch)
    if mask.getbbox() is None:
        return True
    return bytes(mask) == _TOFU_CACHE[key]


_HEART_CHARS = {"♡", "♥", "❤", "🩷", "🖤", "💜", "💗", "💕"}
_STAR_CHARS = {"✦", "✧", "✨", "⭐", "★", "☆", "*", "＊"}


def _draw_vector_heart(draw, cx, cy, size, fill):
    s = size / 2.0
    pts = []
    for i in range(41):
        t = math.pi * 2 * i / 40
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * s / 16, cy - y * s / 16))
    draw.line(pts + [pts[0]], fill=fill, width=max(2, int(size * 0.13)), joint="curve")


def _draw_vector_star(draw, cx, cy, size, fill):
    s = size / 2.0
    pts = []
    for k in range(8):
        a = math.pi / 4 * k - math.pi / 2
        r = s if k % 2 == 0 else s * 0.32
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    draw.polygon(pts, fill=fill)


def draw_deco_glyph(draw, xy, ch, size, fill):
    """장식(하트·반짝이 등)은 손글씨 폰트에 글리프가 없어 tofu(□)로 나오므로 벡터로 직접
    그린다(하트=파라메트릭 곡선, 별=8각 폴리곤). !·?처럼 손글씨 폰트에 있는 기호는 그대로
    텍스트로, 그 외 이모지는 컬러 이모지 폰트로."""
    x, y = xy
    cx, cy = x + size * 0.4, y + size * 0.55
    if ch in _HEART_CHARS:
        _draw_vector_heart(draw, cx, cy, size, fill)
    elif ch in _STAR_CHARS:
        _draw_vector_star(draw, cx, cy, size, fill)
    elif ch in ("!", "?", "·", "‧", "～", "~", "…", ".."):
        draw.text(xy, ch, font=load_font(TEXT_FONT_PATH, size), fill=fill)
    elif EMOJI_FONT_PATH and not is_emoji(ch) and _is_missing_glyph(EMOJI_FONT_PATH, 48, ch):
        _classify_char(ch)   # 이모지 폰트에도 없는 글자 — 경고 1줄만 남기고 건너뜀
    elif EMOJI_FONT_PATH:
        emoji_size = max(8, int(size * 0.92))
        try:
            draw.text(xy, ch, font=load_font(EMOJI_FONT_PATH, emoji_size), embedded_color=True)
        except TypeError:
            draw.text(xy, ch, font=load_font(EMOJI_FONT_PATH, emoji_size), fill=fill)
    else:
        draw.text(xy, ch, font=load_font(TEXT_FONT_PATH, size), fill=fill)


def draw_mixed_text(draw, xy, text, size, fill, stroke_width=0, stroke_fill=(0, 0, 0, 210)):
    """text 를 그린다. 강조 마커(EMPH_OPEN/CLOSE)가 있으면 강조 구간의 (x0, x1) 목록을 반환(없으면 빈 목록)."""
    if EMPH_OPEN not in text and EMPH_CLOSE not in text:
        _draw_plain(draw, xy, text, size, fill, stroke_width, stroke_fill)
        return []
    x, y = xy
    spans, start = [], None
    for piece in re.split(f"({EMPH_OPEN}|{EMPH_CLOSE})", text):
        if piece == EMPH_OPEN:
            start = x
        elif piece == EMPH_CLOSE:
            if start is not None:
                spans.append((start, x))
            start = None
        elif piece:
            x = _draw_plain(draw, (x, y), piece, size, fill, stroke_width, stroke_fill)
    if start is not None:
        spans.append((start, x))
    return spans


def _draw_plain(draw, xy, text, size, fill, stroke_width=0, stroke_fill=(0, 0, 0, 210)):
    """마커 없는 텍스트 그리기(기존 draw_mixed_text 본문 그대로). 그린 뒤의 x 를 반환."""
    x, y = xy
    for is_e, run in split_runs(text):
        font = _run_font(is_e, size)
        # 문장 속 ♡/✦ 등은 손글씨 폰트에 없어 tofu — 글자별로 벡터로 직접 그린다
        if is_e and any(c in _HEART_CHARS or c in _STAR_CHARS for c in run):
            for c in run:
                if c in _HEART_CHARS:
                    _draw_vector_heart(draw, x + size * 0.42, y + size * 0.6, size * 0.9, fill)
                    x += size * 0.85
                elif c in _STAR_CHARS:
                    _draw_vector_star(draw, x + size * 0.42, y + size * 0.55, size * 0.9, fill)
                    x += size * 0.85
                elif EMOJI_FONT_PATH:
                    draw.text((x, y), c, font=font)
                    x += draw.textlength(c, font=font)
            continue
        if is_e and EMOJI_FONT_PATH:
            try:
                draw.text((x, y), run, font=font, embedded_color=True)
            except TypeError:
                draw.text((x, y), run, font=font, fill=fill)
        else:
            if stroke_width:
                draw.text((x, y), run, font=font, fill=fill,
                          stroke_width=stroke_width, stroke_fill=stroke_fill)
            else:
                draw.text((x, y), run, font=font, fill=fill)
        x += draw.textlength(run, font=font)
    return x


# ── 손그림 느낌 도형 ────────────────────────────────────────────────────
def jitter(x, y, amt):
    return (x + random.uniform(-amt, amt), y + random.uniform(-amt, amt))


def draw_wobbly_ellipse(draw, cx, cy, rx, ry, color, width=4, n=40):
    amt = min(rx, ry) * 0.04 + 2
    pts = [jitter(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n), amt)
           for i in range(n + 1)]
    draw.line(pts, fill=color, width=width, joint="curve")


def draw_wobbly_roundrect(draw, box, color, width=4, radius=30):
    x0, y0, x1, y1 = box
    radius = min(radius, (x1 - x0) / 2 - 2, (y1 - y0) / 2 - 2)
    radius = max(radius, 4)
    segs = []
    segs += [(x0 + radius + (x1 - x0 - 2 * radius) * t / 10, y0) for t in range(11)]
    segs += [(x1 - radius + radius * math.cos(-math.pi / 2 + math.pi / 2 * i / 5),
               y0 + radius + radius * math.sin(-math.pi / 2 + math.pi / 2 * i / 5)) for i in range(6)]
    segs += [(x1, y0 + radius + (y1 - y0 - 2 * radius) * t / 10) for t in range(11)]
    segs += [(x1 - radius + radius * math.cos(math.pi / 2 * i / 5),
               y1 - radius + radius * math.sin(math.pi / 2 * i / 5)) for i in range(6)]
    segs += [(x1 - radius - (x1 - x0 - 2 * radius) * t / 10, y1) for t in range(11)]
    segs += [(x0 + radius + radius * math.cos(math.pi / 2 + math.pi / 2 * i / 5),
               y1 - radius + radius * math.sin(math.pi / 2 + math.pi / 2 * i / 5)) for i in range(6)]
    segs += [(x0, y1 - radius - (y1 - y0 - 2 * radius) * t / 10) for t in range(11)]
    segs += [(x0 + radius + radius * math.cos(math.pi + math.pi / 2 * i / 5),
               y0 + radius + radius * math.sin(math.pi + math.pi / 2 * i / 5)) for i in range(6)]
    pts = [jitter(x, y, 3) for x, y in segs]
    pts.append(pts[0])
    draw.line(pts, fill=color, width=width, joint="curve")


def draw_cloud(draw, box, color, width=4):
    # 균일한 스캘롭 생각풍선 — 타원 둘레를 따라 일정 간격의 부드러운 물결(그림1 레퍼런스).
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    per = math.pi * (3 * (rx + ry) - math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
    scallops = max(9, round(per / (min(rx, ry) * 0.62)))
    steps = scallops * 6
    depth = min(rx, ry) * 0.11
    phase = random.uniform(0, 2 * math.pi)
    pts = []
    for i in range(steps + 1):
        a = 2 * math.pi * i / steps
        wob = 0.5 - 0.5 * math.cos(scallops * a + phase)  # 0..1 균일
        r = 1 - (depth / min(rx, ry)) * wob + random.uniform(-0.012, 0.012)
        pts.append((cx + rx * r * math.cos(a) + random.uniform(-1.5, 1.5),
                    cy + ry * r * math.sin(a) + random.uniform(-1.5, 1.5)))
    pts.append(pts[0])
    draw.line(pts, fill=color, width=width, joint="curve")


def draw_cloud_tail(draw, box, color, width=4, direction=1):
    """말풍선 아래로 이어지는 꼬리 점 3개 (그림1)."""
    x0, y0, x1, y1 = box
    px = x0 + (x1 - x0) * (0.3 if direction > 0 else 0.7)
    py = y1 - (y1 - y0) * 0.03
    r = max(5.0, (y1 - y0) * 0.05)
    for _ in range(3):
        px += direction * r * 1.7
        py += r * 2.2
        draw.ellipse((px - r, py - r, px + r, py + r), outline=color, width=max(2, int(width * 0.85)))
        r *= 0.6


def draw_wavy_underline(draw, x0, x1, y, color, width=4):
    """물결 밑줄 (연속 사인)."""
    span = x1 - x0
    periods = max(2, round(span / 130))
    amp = width * 1.8
    phase = random.uniform(0, math.pi)
    n = periods * 18
    pts = [(x0 + span * (i / n), y + math.sin((i / n) * periods * 2 * math.pi + phase) * amp)
           for i in range(n + 1)]
    draw.line(pts, fill=color, width=width, joint="curve")


def draw_ticks(draw, cx, y, size, color, width=4):
    """타이틀 위 틱 마크 ´´´."""
    for k in (-1, 0, 1):
        x = cx + k * size * 0.5
        a = k * 0.2 + random.uniform(-0.1, 0.1)
        draw.line([(x - math.sin(a) * size * 0.5, y - math.cos(a) * size * 0.5),
                   (x + math.sin(a) * size * 0.5, y + math.cos(a) * size * 0.5)],
                  fill=color, width=width)


def _inflate(box, dx, dy):
    return (box[0] - dx, box[1] - dy, box[2] + dx, box[3] + dy)


def apply_soft_vignette(img, cx, cy, r, max_alpha=66):
    """글자 영역에 가장자리 없는 부드러운 어둠(비네트) — 밝은 배경에서도 얇은 흰 획이 뜨게."""
    size = max(2, int(r * 2))
    g = Image.radial_gradient("L").resize((size, size))  # 0(중앙)→255(가장자리)
    a = ImageOps.invert(g).point(lambda v: int(v * max_alpha / 255))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    black = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    layer.paste(black, (int(cx - r), int(cy - r)), a)
    return Image.alpha_composite(img, layer)


ARROW_DIR_VECTORS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


def draw_dotted_arrow(draw, start, end, color, width=4):
    x0, y0 = start
    x1, y1 = end
    mx = (x0 + x1) / 2 + random.uniform(-45, 45)
    my = (y0 + y1) / 2 + random.uniform(-30, 30)
    n = 30
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1
        pts.append((x, y))
    for i in range(0, len(pts) - 1, 2):
        draw.line([pts[i], pts[min(i + 1, len(pts) - 1)]], fill=color, width=width)
    ax, ay = pts[-1]
    bx, by = pts[-4] if len(pts) >= 4 else pts[0]
    ang = math.atan2(ay - by, ax - bx)
    for da in (0.42, -0.42):
        hx = ax - 24 * math.cos(ang + da)
        hy = ay - 24 * math.sin(ang + da)
        draw.line([(ax, ay), (hx, hy)], fill=color, width=width)


# ── 씬 렌더링 ───────────────────────────────────────────────────────────
POSITION_ANCHORS = {
    "center": (0.5, 0.5),
    "top_left": (0.12, 0.16),
    "top_right": (0.88, 0.16),
    "top_center": (0.5, 0.13),
    "bottom_left": (0.12, 0.84),
    "bottom_right": (0.88, 0.84),
    "bottom_center": (0.5, 0.87),
}


def _carry_emphasis(lines):
    """강조 구간이 줄바꿈을 넘어가면 각 줄이 자기 마커 쌍을 갖도록 보정(줄 시작에 열기/끝에 닫기 추가)."""
    if not any(EMPH_OPEN in ln or EMPH_CLOSE in ln for ln in lines):
        return lines
    out, is_open = [], False
    for ln in lines:
        cur = (EMPH_OPEN if is_open else "") + ln
        for ch in ln:
            if ch == EMPH_OPEN:
                is_open = True
            elif ch == EMPH_CLOSE:
                is_open = False
        out.append(cur + (EMPH_CLOSE if is_open else ""))
    return out


def measure_block(draw, lines, size):
    widths = [measure_line(draw, ln, size) for ln in lines] or [0]
    return max(widths), size * 1.32 * len(lines)


# 안전 폭(캔버스 가로 비율) — 이보다 넓어지는 줄만 자동 줄바꿈 대상. 영상 탭 미리보기 박스
# 좌우 여백(52*k, 1920 기준 → 1080 기준 약 0.904)보다 데코/회전 여유를 두고 조금 더 좁게.
SAFE_TEXT_WIDTH_RATIO = 0.82


def render_scene(canvas_size, scene, font_size=64):
    """레퍼런스 그림1 방향: 검은 외곽선/판 금지. 가독성 = 어두운 헤일로(블러) +
    글자영역 소프트 비네트 + 얇은 컬러 획. 다크/컬러 2패스가 같은 좌표를 쓰도록
    각 패스 직전에 random 시드를 동일하게 재설정한다."""
    W, H = canvas_size
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    measure = ImageDraw.Draw(img)
    color = COLORS.get(scene.get("color", "white"), COLORS["white"])
    font_size = int(scene.get("font_size", font_size))
    # 수동 줄바꿈(\n)은 그대로 줄 경계로 유지 — 문단별로 안전 폭을 넘을 때만 자동 줄바꿈 추가.
    # 부분 강조 문법: <<강조할 말>> (단어/구절에만 물결 밑줄). '*' 는 별 장식 문자와 겹쳐 쓰지 않는다.
    # 짝이 안 맞는 '<<' 는 그냥 글자로 남는다. 마커 없는 주석은 아래 처리가 전부 no-op.
    raw_text = _EMPH_RE.sub(lambda m: EMPH_OPEN + m.group(1) + EMPH_CLOSE, scene.get("text", ""))
    lines = []
    for para in raw_text.split("\n"):
        lines.extend(wrap_paragraph(measure, para, font_size, W * SAFE_TEXT_WIDTH_RATIO))
    lines = _carry_emphasis(lines)
    pen_w = max(3, int(font_size * 0.05))

    try:
        seed_val = hash(json.dumps(scene, sort_keys=True, ensure_ascii=False)) & 0x7FFFFFFF
    except Exception:
        seed_val = hash(scene.get("text", "")) & 0x7FFFFFFF

    block_w, block_h = measure_block(measure, lines, font_size)
    line_h = font_size * 1.32
    pad_x, pad_y = 28, 18
    box_w, box_h = block_w + pad_x * 2, block_h + pad_y * 2

    # 위치 세부 조정(2026-11-03, 성준님 요청) — 기존 프리셋(position)/자유좌표(x,y)는 그대로 두고,
    # 거기서 좌우/상하로 추가로 살짝 미는 보정값. 비율(캔버스 폭·높이 기준)이라 해상도가 달라져도
    # 같은 비율로 밀린다. 기본 0(=미조정, 기존 동작과 동일).
    offset_x = float(scene.get("offset_x", 0) or 0)
    offset_y = float(scene.get("offset_y", 0) or 0)
    if "x" in scene or "y" in scene:
        cx = W * float(scene.get("x", 0.5)) + W * offset_x
        cy = H * float(scene.get("y", 0.5)) + H * offset_y
        left, top = cx - box_w / 2, cy - box_h / 2
    else:
        ax, ay = POSITION_ANCHORS.get(scene.get("position", "center"), (0.5, 0.5))
        cx, cy = W * ax + W * offset_x, H * ay + H * offset_y
        left, top = cx - box_w / 2, cy - box_h / 2
        if ax < 0.3:
            left = cx
        elif ax > 0.7:
            left = cx - box_w
        if ay < 0.3:
            top = cy
        elif ay > 0.7:
            top = cy - box_h

    # 말풍선 모양 크기 조절(2026-11-03, 성준님 요청) — 텍스트 크기(font_size)와는 별개로,
    # 그 텍스트를 둘러싼 말풍선 윤곽만 더 크게/작게. 1.0=기존 동작과 동일.
    bubble_scale = float(scene.get("bubble_scale", 1.0) or 1.0)
    bubble = scene.get("bubble", "none")
    base_infl = {"cloud": (box_w * 0.10 + 24, box_h * 0.16 + 18),
                 "oval": (box_w * 0.16 + 14, box_h * 0.22 + 12),
                 "arrow_box": (22, 16)}.get(bubble, (0, 0))
    infl = (base_infl[0] * bubble_scale, base_infl[1] * bubble_scale)
    ix, iy = infl
    margin_x = 24 + ix
    arrow_pad = H * 0.09 if scene.get("arrow") else 0
    tail_pad = H * 0.05 if bubble == "cloud" else 0
    cap_safe_top = H * 0.88 - box_h - iy - arrow_pad - tail_pad
    left = max(margin_x, min(left, W - box_w - margin_x))
    top = max(52 + iy, min(top, min(H - box_h - 52 - iy, cap_safe_top)))
    text_box = (left, top, left + box_w, top + box_h)
    bubble_box = _inflate(text_box, *infl)

    backing = scene.get("backing", True)
    underline = bool(scene.get("underline")) and bubble == "none"
    box = bubble_box  # deco 배치 기준
    tail_dir = -1 if (left + box_w / 2) > W / 2 else 1
    deco_list = scene.get("deco", [])
    if isinstance(deco_list, str):
        deco_list = [d.strip() for d in deco_list.split(",") if d.strip()]
    deco_list = deco_list[:3]

    def paint(target, col):
        """한 패스: 같은 시드에서 버블·텍스트·밑줄·틱·장식·화살표를 col 색으로 그린다."""
        random.seed(seed_val)
        d = ImageDraw.Draw(target)

        if bubble == "cloud":
            draw_cloud(d, bubble_box, col, pen_w)
            draw_cloud_tail(d, bubble_box, col, pen_w, tail_dir)
        elif bubble == "oval":
            draw_wobbly_ellipse(d, (bubble_box[0] + bubble_box[2]) / 2, (bubble_box[1] + bubble_box[3]) / 2,
                                (bubble_box[2] - bubble_box[0]) / 2, (bubble_box[3] - bubble_box[1]) / 2, col, pen_w)
        elif bubble == "arrow_box":
            draw_wobbly_roundrect(d, bubble_box, col, pen_w)

        for i, line in enumerate(lines):
            lw = measure_line(d, line, font_size)
            angle = random.uniform(-1.8, 1.8)
            dx = random.uniform(-4, 4)
            pad = 12
            img_w = max(1, int(lw + 48))
            img_h = int(font_size * 1.7)
            line_img = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
            emph_spans = draw_mixed_text(ImageDraw.Draw(line_img), (pad, (img_h - font_size) / 2), line, font_size, col)
            rotated = line_img.rotate(angle, resample=Image.BICUBIC, expand=True)
            tx = left + (box_w - lw) / 2 + dx
            line_center_y = top + pad_y + line_h * (i + 0.5)
            target.paste(rotated, (int(tx - pad), int(line_center_y - rotated.height / 2)), rotated)
            if emph_spans:
                # 강조 구간만 물결 밑줄 — 난수 상태를 보존해 이후 장식·화살표 모양이 마커 유무와 무관하게 같게 한다.
                rs = random.getstate()
                ey = line_center_y + font_size * 0.46
                for sx0, sx1 in emph_spans:
                    if sx1 - sx0 > 2:
                        draw_wavy_underline(d, int(tx - pad) + sx0, int(tx - pad) + sx1, ey, col, pen_w)
                random.setstate(rs)

        if underline:
            uy = top + pad_y + line_h * (len(lines) - 0.5) + font_size * 0.46
            draw_wavy_underline(d, left + pad_x * 0.3, left + box_w - pad_x * 0.3, uy, col, max(2, int(pen_w * 0.8)))
            draw_ticks(d, left + box_w * 0.28, top + pad_y - font_size * 0.32, font_size * 0.42, col, pen_w)

        deco_size = int(font_size * 0.5)
        dx0, dy0, dx1, dy1 = box
        dw, dh = dx1 - dx0, dy1 - dy0
        spots = [
            (dx1 + random.uniform(4, 16), dy0 + dh * random.uniform(0.1, 0.4)),
            (dx0 - random.uniform(4, 16), dy0 + dh * random.uniform(0.3, 0.7)),
            (dx1 - dw * random.uniform(0.05, 0.22), dy1 + random.uniform(4, 16)),
        ]
        for i, dch in enumerate(deco_list):
            gx, gy = spots[i % len(spots)]
            draw_deco_glyph(d, (gx - deco_size * 0.4, gy - deco_size * 0.55), dch, deco_size, col)

        if scene.get("arrow"):
            cxb, cyb = (bubble_box[0] + bubble_box[2]) / 2, (bubble_box[1] + bubble_box[3]) / 2
            tgt = scene.get("arrow_target")
            if tgt and len(tgt) == 2:
                ex, ey = W * float(tgt[0]), H * float(tgt[1])
                ddx, ddy = ex - cxb, ey - cyb
                dd = max(1.0, math.hypot(ddx, ddy))
                ux, uy2 = ddx / dd, ddy / dd
                start = (cxb + ux * (box_w / 2 + 16), cyb + uy2 * (box_h / 2 + 16))
                end = (ex, ey)
            else:
                vx, vy = ARROW_DIR_VECTORS.get(scene.get("arrow_direction", "down"), (0, 1))
                start = (cxb + vx * (box_w / 2 + 16), cyb + vy * (box_h / 2 + 16))
                end = (start[0] + vx * 150, start[1] + vy * 150)
            draw_dotted_arrow(d, start, end, col, max(2, int(pen_w * 0.95)))

    # 1) 소프트 비네트 (backing일 때만) — 가장자리 없는 어둠
    if backing:
        vr = math.hypot(box_w, box_h) * 0.62
        img = apply_soft_vignette(img, left + box_w / 2, top + box_h / 2, vr)

    # 1-b) 대사 바탕판(plate) — 어두운 반투명 직각 상자. 대사만(나레이션·장면 자막은 없음, 2026-09-28)
    if scene.get("plate"):
        pl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        # 글자 블록(안쪽 여백 pad_x/pad_y 제외)에 딱 붙이고 가장자리만 살짝 — 9/28 성준님 "텍스트보다 살짝만 크게"
        mx, my = font_size * 0.22, font_size * 0.04
        ImageDraw.Draw(pl).rectangle((left + pad_x - mx, top + pad_y - my, left + box_w - pad_x + mx, top + box_h - pad_y + my), fill=(18, 18, 24, 150))
        img = Image.alpha_composite(img, pl)

    # 2) 다크 헤일로 — 투명 레이어에 검게 그린 뒤 블러해서 여러 겹 합성
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    paint(dark, (0, 0, 0, 235))
    layers = ((font_size * 0.30, 2), (font_size * 0.15, 2)) if backing else ((font_size * 0.22, 1), (font_size * 0.11, 1))
    for radius, reps in layers:
        blurred = dark.filter(ImageFilter.GaussianBlur(radius))
        for _ in range(reps):
            img = Image.alpha_composite(img, blurred)

    # 3) 깨끗한 컬러 패스
    paint(img, color)

    # 4) 입력각(2026-11-03, 성준님 요청: "풍선·글씨 입력각 설정, 0~30도 정도 범위") — 말풍선+글씨+
    # 장식+화살표를 통째로 한 장(스티커)처럼 비스듬히 기울인다. img는 이 시점까지 이 장면 말고는
    # 아무것도 안 그려진 완전 투명 레이어라(배경 합성은 render_scene 밖에서 함), 캔버스 전체를
    # 말풍선 중심 기준으로 그냥 회전시켜도 다른 내용을 침범하거나 잘릴 걱정이 없다 — 별도 크롭/
    # 패딩 계산 불필요. 각도는 글자 한 줄 한 줄의 미세한 랜덤 기울기(-1.8~1.8도, 손글씨 느낌)와는
    # 별개로 전체 그룹에 추가로 걸리는 값.
    angle = float(scene.get("angle", 0) or 0)
    if angle:
        cx_rot = (bubble_box[0] + bubble_box[2]) / 2
        cy_rot = (bubble_box[1] + bubble_box[3]) / 2
        img = img.rotate(angle, resample=Image.BICUBIC, center=(cx_rot, cy_rot))

    return img


# ── 시간 파싱 ────────────────────────────────────────────────────────────
def parse_time_range(t):
    a, b = t.strip().split("~")
    return float(a.rstrip("s").strip()), float(b.rstrip("s").strip())


# ── 영상/이미지 합성 ─────────────────────────────────────────────────────
def run_cmd(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"명령 실패:\n{' '.join(cmd)}\n{proc.stderr[-2000:]}")
    return proc


def process_video(input_path, output_path, scenes, canvas_size, work_dir, signature=True):
    W, H = canvas_size
    overlay_paths = []
    for i, sc in enumerate(scenes):
        p = work_dir / f"scene_{i:02d}.png"
        render_scene(canvas_size, sc).save(p)
        overlay_paths.append(p)
        print(f"    씬 {i + 1}/{len(scenes)} 렌더링 완료 ({sc.get('time')})")

    # 서여리 시그니처(프레임+워터마크)는 씬 타이밍과 무관하게 영상 내내 표시되는
    # 별도 레이어. config의 "signature": false 면 생략(릴스 최종화처럼 프레임 없이 자막만 얹을 때).
    if signature:
        signature_path = work_dir / "signature.png"
        apply_yeori_signature(Image.new("RGBA", (W, H), (0, 0, 0, 0))).save(signature_path)
        print("    서여리 시그니처(프레임+워터마크) 렌더링 완료")
        overlay_paths.append(signature_path)

    filter_parts = [
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1[base]"
    ]
    prev = "base"
    for i, sc in enumerate(scenes):
        start, end = parse_time_range(sc["time"])
        label = f"v{i}"
        filter_parts.append(f"[{prev}][{i + 1}:v]overlay=0:0:enable='between(t,{start},{end})'[{label}]")
        prev = label
    # 시그니처(있으면) — 씬 다음 마지막 입력. enable 조건 없이 항상 표시.
    if signature:
        filter_parts.append(f"[{prev}][{len(scenes) + 1}:v]overlay=0:0[vout]")
    else:
        filter_parts.append(f"[{prev}]null[vout]")
    filter_complex = ";".join(filter_parts)

    # 입력 영상 길이를 명시적으로 걸어 둔다 — 루프(-loop 1) 이미지 입력 + 복합
    # 필터그래프에서 -shortest가 제때 종료를 못 잡아 인코딩이 몇 분씩 늘어지는 경우가
    # 있어서(실측), 베이스 길이로 -t를 직접 준다.
    dur = None
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(input_path)],
            capture_output=True, text=True,
        )
        dur = float(probe.stdout.strip())
    except Exception:
        dur = None

    cmd = ["ffmpeg", "-y", "-i", str(input_path)]
    for p in overlay_paths:
        cmd += ["-loop", "1", "-i", str(p)]
    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "0:a?",
        # yuv420p 강제 — 입력 컷이 yuv444p(그래픽 캡처)여도 일반 플레이어에서 열리게 한다.
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-g", "60", "-movflags", "+faststart", "-c:a", "aac", "-shortest",
    ]
    if dur:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += [str(output_path)]
    run_cmd(cmd)


def _fit_base(input_path, canvas_size, subject_outline=None):
    W, H = canvas_size
    src = Image.open(input_path).convert("RGBA")
    ratio = min(W / src.width, H / src.height)
    resized = src.resize((max(1, int(src.width * ratio)), max(1, int(src.height * ratio))))
    base = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    base.paste(resized, ((W - resized.width) // 2, (H - resized.height) // 2))
    if subject_outline:
        try:
            from subject_outline import add_subject_outline
            base = add_subject_outline(base, subject_outline)
            print("    인물 테두리 적용")
        except Exception as e:  # noqa: BLE001
            print(f"⚠ 인물 테두리 실패(무시): {e}")
    return base


def process_image(input_path, output_path, scenes, canvas_size, subject_outline=None):
    base = _fit_base(input_path, canvas_size, subject_outline)
    stem, suffix = output_path.stem, (output_path.suffix or ".png")
    outputs = []
    for i, sc in enumerate(scenes):
        composed = Image.alpha_composite(base, render_scene(canvas_size, sc))
        composed = apply_yeori_signature(composed)
        out_path = output_path.parent / f"{stem}_scene{i + 1:02d}{suffix}"
        composed.convert("RGB").save(out_path)
        outputs.append(out_path)
        print(f"    씬 {i + 1}/{len(scenes)} 저장: {out_path.name}")
    return outputs


def process_image_composite(input_path, output_path, bubbles, canvas_size, subject_outline=None):
    """bubbles 포맷 — 한 장의 정지 이미지에 모든 말풍선을 한꺼번에 얹어 파일 1개로 저장.
    (레퍼런스 인스타 스토리처럼 화면에 주석이 여럿 떠 있는 형태)"""
    base = _fit_base(input_path, canvas_size, subject_outline)
    composed = base
    for i, b in enumerate(bubbles):
        composed = Image.alpha_composite(composed, render_scene(canvas_size, b))
        print(f"    말풍선 {i + 1}/{len(bubbles)} 합성")
    composed = apply_yeori_signature(composed)
    suffix = output_path.suffix or ".png"
    out_path = output_path.with_suffix(suffix)
    composed.convert("RGB").save(out_path)
    print(f"    저장: {out_path.name}")
    return [out_path]


def process_video_composite(input_path, output_path, bubbles, canvas_size, work_dir):
    """bubbles 포맷 영상 — 각 말풍선은 time이 있으면 그 구간, 없으면 전체 구간 표시."""
    W, H = canvas_size
    overlay_paths = []
    for i, b in enumerate(bubbles):
        p = work_dir / f"bubble_{i:02d}.png"
        render_scene(canvas_size, b).save(p)
        overlay_paths.append(p)
    signature_path = work_dir / "signature.png"
    apply_yeori_signature(Image.new("RGBA", (W, H), (0, 0, 0, 0))).save(signature_path)
    overlay_paths.append(signature_path)

    filter_parts = [
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1[base]"
    ]
    prev = "base"
    for i, b in enumerate(bubbles):
        label = f"v{i}"
        if b.get("time"):
            s, e = parse_time_range(b["time"])
            filter_parts.append(f"[{prev}][{i + 1}:v]overlay=0:0:enable='between(t,{s},{e})'[{label}]")
        else:
            filter_parts.append(f"[{prev}][{i + 1}:v]overlay=0:0[{label}]")
        prev = label
    filter_parts.append(f"[{prev}][{len(bubbles) + 1}:v]overlay=0:0[vout]")

    dur = None
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(input_path)],
            capture_output=True, text=True,
        )
        dur = float(probe.stdout.strip())
    except Exception:
        dur = None

    cmd = ["ffmpeg", "-y", "-i", str(input_path)]
    for p in overlay_paths:
        cmd += ["-loop", "1", "-i", str(p)]
    cmd += [
        "-filter_complex", ";".join(filter_parts),
        "-map", "[vout]", "-map", "0:a?",
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-g", "60", "-movflags", "+faststart", "-c:a", "aac", "-shortest",
    ]
    if dur:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += [str(output_path)]
    run_cmd(cmd)


# ── 진입점 ────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="손글씨 주석 오버레이 (사진/영상)")
    parser.add_argument("--config", required=True, help="씬 설정 JSON 경로")
    parser.add_argument("--input", required=True, help="입력 영상 또는 이미지 경로")
    parser.add_argument("--output", required=True, help="출력 경로")
    args = parser.parse_args()

    config_path, input_path, output_path = Path(args.config), Path(args.input), Path(args.output)

    if not config_path.exists():
        print(f"⚠ 설정 파일을 찾을 수 없습니다: {config_path}")
        sys.exit(1)
    if not input_path.exists():
        print(f"⚠ 입력 파일을 찾을 수 없습니다: {input_path}")
        sys.exit(1)

    config = json.loads(config_path.read_text(encoding="utf-8"))
    canvas_size = tuple(config.get("output_size", [1080, 1920]))
    subject_outline = config.get("subject_outline")  # true | {width,gap,color,opacity} | None

    # 두 가지 포맷 지원:
    #  - "scenes": 시간대(time)별로 하나씩 — 영상은 구간 합성, 이미지는 씬별 파일
    #  - "bubbles": 한 화면에 여러 주석을 자유 배치(x/y) — 이미지는 파일 1개, 영상은 전체 구간
    scenes = config.get("scenes", [])
    bubbles = config.get("bubbles", [])
    if not scenes and not bubbles:
        print("⚠ 설정 파일에 scenes 또는 bubbles가 없습니다.")
        sys.exit(1)
    mode = "bubbles" if bubbles else "scenes"
    items = bubbles if bubbles else scenes

    video_exts = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    ext = input_path.suffix.lower()

    if ext in video_exts:
        if shutil.which("ffmpeg") is None:
            print("⚠ ffmpeg를 찾을 수 없습니다 — PATH에 ffmpeg가 설치돼 있는지 확인하세요.")
            sys.exit(1)
        if subject_outline:
            print("ℹ 인물 테두리는 정지 이미지 전용입니다 — 영상에서는 무시됩니다.")
        with tempfile.TemporaryDirectory(prefix="handwriting_") as td:
            if mode == "bubbles":
                print(f"[1/2] 말풍선 {len(items)}개를 영상에 합성 중…")
                process_video_composite(input_path, output_path, items, canvas_size, Path(td))
            else:
                print(f"[1/2] 씬 {len(items)}개를 렌더링하며 영상에 시간대별로 합성 중…")
                process_video(input_path, output_path, items, canvas_size, Path(td),
                              signature=bool(config.get("signature", True)))
        print(f"[2/2] 출력 완료: {output_path}")
    elif ext in image_exts:
        if mode == "bubbles":
            print(f"[1/1] 말풍선 {len(items)}개를 한 장에 합성 중…")
            process_image_composite(input_path, output_path, items, canvas_size, subject_outline)
        else:
            print(f"[1/1] 씬 {len(items)}개를 이미지별로 렌더링 중… "
                  f"(정지 이미지라 한 장에 다 못 담아 씬마다 별도 파일로 저장)")
            process_image(input_path, output_path, items, canvas_size, subject_outline)
    else:
        print(f"⚠ 지원하지 않는 입력 형식입니다: {ext}")
        sys.exit(1)

    print(f"✓ 손글씨 오버레이 완료 — {mode} {len(items)}개 적용")


if __name__ == "__main__":
    main()
