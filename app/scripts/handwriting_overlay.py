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
각 항목 옵션: backing(false면 판 대신 글자 외곽선), arrow_target([x,y] 비율로 특정 지점 겨냥).
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
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from yeori_signature import apply_yeori_signature

from PIL import Image, ImageDraw, ImageFont

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

# 번들 폰트 → 시스템 빙그레체/나눔손글씨 → 맑은고딕 순으로 시도
HANDWRITING_FONT_CANDIDATES = [
    "NanumPenScript-Regular.ttf", "Gaegu-Bold.ttf",
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
COLORS = {
    "white": (255, 255, 255, 255),
    "pink": (0xF4, 0x72, 0xB6, 255),
    "lavender": (0xC4, 0xB5, 0xFD, 255),
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


def split_runs(text):
    """텍스트를 (이모지여부, 연속구간) 단위로 분리"""
    runs = []
    cur_emoji, cur = None, ""
    for ch in text:
        e = is_emoji(ch)
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
    elif EMOJI_FONT_PATH:
        emoji_size = max(8, int(size * 0.92))
        try:
            draw.text(xy, ch, font=load_font(EMOJI_FONT_PATH, emoji_size), embedded_color=True)
        except TypeError:
            draw.text(xy, ch, font=load_font(EMOJI_FONT_PATH, emoji_size), fill=fill)
    else:
        draw.text(xy, ch, font=load_font(TEXT_FONT_PATH, size), fill=fill)


def draw_mixed_text(draw, xy, text, size, fill, stroke_width=0, stroke_fill=(0, 0, 0, 210)):
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
    # 스캘럽(구름) 외곽선 — 박스 둘레를 도는 닫힌 곡선으로, 3점마다 바깥으로만
    # 튀어나오게 한다. 항상 박스보다 크게 그려져 텍스트 위로 선이 지나가지 않는다.
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    bumps = 9
    steps = bumps * 5
    amt = min(rx, ry) * 0.025 + 1.5
    pts = []
    for i in range(steps + 1):
        a = 2 * math.pi * i / steps
        bulge = 1.03 + 0.12 * (math.sin(bumps * a) * 0.5 + 0.5)  # 부드러운 스캘럽
        pts.append(jitter(cx + rx * bulge * math.cos(a), cy + ry * bulge * math.sin(a), amt))
    pts.append(pts[0])
    draw.line(pts, fill=color, width=width, joint="curve")


def _inflate(box, dx, dy):
    return (box[0] - dx, box[1] - dy, box[2] + dx, box[3] + dy)


def draw_soft_backing(base_img, box, radius=40, alpha=115):
    """텍스트 뒤에 반투명 어두운 판을 깔아 흰 손글씨가 어떤 배경 위에서도 읽히게 한다."""
    layer = Image.new("RGBA", base_img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = (int(v) for v in box)
    r = int(max(4, min(radius, (x1 - x0) / 2, (y1 - y0) / 2)))
    ld.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=(0, 0, 0, alpha))
    return Image.alpha_composite(base_img, layer)


ARROW_DIR_VECTORS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


def draw_dotted_arrow(draw, start, end, color, width=4):
    x0, y0 = start
    x1, y1 = end
    mx = (x0 + x1) / 2 + random.uniform(-20, 20)
    my = (y0 + y1) / 2 + random.uniform(-20, 20)
    n = 24
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1
        pts.append((x, y))
    for i in range(0, len(pts) - 1, 2):
        draw.line([pts[i], pts[min(i + 1, len(pts) - 1)]], fill=color, width=width)
    ax, ay = pts[-1]
    bx, by = pts[-3] if len(pts) >= 3 else pts[0]
    ang = math.atan2(ay - by, ax - bx)
    for da in (0.5, -0.5):
        hx = ax - 22 * math.cos(ang + da)
        hy = ay - 22 * math.sin(ang + da)
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


def measure_block(draw, lines, size):
    widths = [measure_line(draw, ln, size) for ln in lines] or [0]
    return max(widths), size * 1.32 * len(lines)


def render_scene(canvas_size, scene, font_size=64):
    W, H = canvas_size
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = COLORS.get(scene.get("color", "white"), COLORS["white"])
    lines = scene.get("text", "").split("\n")

    # 씬별 글자 크기 오버라이드 (bubbles 포맷 등)
    font_size = int(scene.get("font_size", font_size))

    block_w, block_h = measure_block(draw, lines, font_size)
    line_h = font_size * 1.32

    # 짧은 문구가 거대한 말풍선을 얻지 않도록 패딩을 타이트하게
    pad_x, pad_y = 34, 22
    box_w, box_h = block_w + pad_x * 2, block_h + pad_y * 2

    # 위치: x/y(0~1 비율)가 있으면 그 지점을 박스 중심으로, 없으면 앵커(position).
    if "x" in scene or "y" in scene:
        cx = W * float(scene.get("x", 0.5))
        cy = H * float(scene.get("y", 0.5))
        left = cx - box_w / 2
        top = cy - box_h / 2
    else:
        ax, ay = POSITION_ANCHORS.get(scene.get("position", "center"), (0.5, 0.5))
        cx, cy = W * ax, H * ay
        left = cx - box_w / 2
        top = cy - box_h / 2
        if ax < 0.3:
            left = cx
        elif ax > 0.7:
            left = cx - box_w
        if ay < 0.3:
            top = cy
        elif ay > 0.7:
            top = cy - box_h

    bubble = scene.get("bubble", "none")
    # 말풍선 모양이 텍스트를 감싸는 최소 여유 (타원은 사각을 담으려면 좀 더).
    infl = {"cloud": (box_w * 0.05 + 10, box_h * 0.12 + 10),
            "oval": (box_w * 0.17 + 10, box_h * 0.22 + 10),
            "arrow_box": (16, 10)}.get(bubble, (0, 0))
    ix, iy = infl
    margin_x = 28 + ix
    arrow_pad = H * 0.1 if scene.get("arrow") else 0
    cap_safe_top = H * 0.75 - box_h - iy - arrow_pad  # 자막 영역(하단) 침범 방지
    left = max(margin_x, min(left, W - box_w - margin_x))
    top = max(40 + iy, min(top, min(H - box_h - 40 - iy, cap_safe_top)))
    text_box = (left, top, left + box_w, top + box_h)
    bubble_box = _inflate(text_box, *infl)

    # 가독성 처리:
    #  - 말풍선 없음 + backing: 글자 뒤 반투명 판
    #  - 말풍선 있음: 판을 깔면 버블 안에 박스처럼 이중으로 보임 → 판 대신 글자 외곽선만
    #  - backing=False: 항상 글자 외곽선만
    backing = scene.get("backing", True)
    show_plate = (bubble == "none") and backing
    if show_plate:
        img = draw_soft_backing(img, _inflate(text_box, 10, 6), radius=int(min(box_w, box_h) * 0.35))
        draw = ImageDraw.Draw(img)
    stroke_w = 0 if show_plate else max(4, int(font_size * 0.09))

    if bubble == "cloud":
        draw_cloud(draw, bubble_box, color)
    elif bubble == "oval":
        draw_wobbly_ellipse(draw, (bubble_box[0] + bubble_box[2]) / 2, (bubble_box[1] + bubble_box[3]) / 2,
                            (bubble_box[2] - bubble_box[0]) / 2, (bubble_box[3] - bubble_box[1]) / 2, color)
    elif bubble == "arrow_box":
        draw_wobbly_roundrect(draw, bubble_box, color)

    box = bubble_box  # deco/화살표 배치 기준
    # 텍스트 블록을 박스 세로 중앙에. 줄 i의 중심 = top + pad_y + line_h*(i+0.5)
    for i, line in enumerate(lines):
        lw = measure_line(draw, line, font_size)
        tx = left + (box_w - lw) / 2
        angle = random.uniform(-2.2, 2.2)
        pad = 10 + stroke_w
        img_w = max(1, int(lw + 40 + stroke_w * 2))
        img_h = int(font_size * 1.6 + stroke_w * 2)
        line_img = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
        line_draw = ImageDraw.Draw(line_img)
        # 텍스트를 line_img 세로 중앙에
        ty_in = (img_h - font_size) / 2
        draw_mixed_text(line_draw, (pad, ty_in), line, font_size, color, stroke_width=stroke_w)
        rotated = line_img.rotate(angle, resample=Image.BICUBIC, expand=True)
        line_center_y = top + pad_y + line_h * (i + 0.5)
        img.paste(rotated, (int(tx - pad), int(line_center_y - rotated.height / 2)), rotated)

    deco_size = int(font_size * 0.5)
    bh = box[3] - box[1]
    deco_positions = [
        (box[0] + deco_size * 0.3, box[1] + bh * 0.12),
        (box[2] - deco_size * 0.3, box[1] + bh * 0.06),
    ]
    for i, d in enumerate(scene.get("deco", [])[:2]):
        dx, dy = deco_positions[i % len(deco_positions)]
        draw_deco_glyph(draw, (dx, dy), d, deco_size, color)

    if scene.get("arrow"):
        cxb, cyb = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        tgt = scene.get("arrow_target")
        if tgt and len(tgt) == 2:
            # 화면 특정 지점(0~1 비율)을 겨냥
            ex, ey = W * float(tgt[0]), H * float(tgt[1])
            dx, dy = ex - cxb, ey - cyb
            d = max(1.0, math.hypot(dx, dy))
            ux, uy = dx / d, dy / d
            start = (cxb + ux * (box_w / 2 + 20), cyb + uy * (box_h / 2 + 20))
            end = (ex, ey)
        else:
            direction = scene.get("arrow_direction", "right")
            vx, vy = ARROW_DIR_VECTORS.get(direction, (1, 0))
            start = (cxb + vx * (box_w / 2 + 20), cyb + vy * (box_h / 2 + 20))
            end = (start[0] + vx * 140, start[1] + vy * 140)
        draw_dotted_arrow(draw, start, end, color)

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


def process_video(input_path, output_path, scenes, canvas_size, work_dir):
    W, H = canvas_size
    overlay_paths = []
    for i, sc in enumerate(scenes):
        p = work_dir / f"scene_{i:02d}.png"
        render_scene(canvas_size, sc).save(p)
        overlay_paths.append(p)
        print(f"    씬 {i + 1}/{len(scenes)} 렌더링 완료 ({sc.get('time')})")

    # 서여리 시그니처(프레임+워터마크)는 씬 타이밍과 무관하게 영상 내내 표시되는
    # 별도 레이어 — 투명 캔버스에 적용해서 테두리·워터마크만 남은 오버레이를 만든다.
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
    # 시그니처는 항상 표시(enable 조건 없음), 마지막 입력이므로 인덱스는 len(scenes)+1
    filter_parts.append(f"[{prev}][{len(scenes) + 1}:v]overlay=0:0[vout]")
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
                process_video(input_path, output_path, items, canvas_size, Path(td))
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
