#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
handwriting_overlay.py — 서여리 릴스용 손글씨 주석 오버레이

인스타 스토리/릴스풍으로, 사진·영상 위에 손글씨 텍스트(구름/타원/화살표박스 말풍선,
점선 화살표, 하트·반짝이 장식, -3~+3도 랜덤 기울기)를 시간대별로 합성한다.

사용법:
  python handwriting_overlay.py --config handwriting_config_rl03.json --input in.mp4 --output out.mp4
  python handwriting_overlay.py --config handwriting_config_rl03.json --input in.png --output out.png
    (이미지 입력은 씬 하나당 정지화면이 다르므로, out_scene01.png ~ out_sceneNN.png로 씬별 개별 저장)

폰트 폴백: 빙그레체 → 나눔손글씨 → 맑은고딕(시스템에 없으면 자동으로 다음 순위로 대체,
콘솔에 실제 사용된 폰트를 출력함). 이모지(🫢✨🎙️😱🙏💜👀🙈 등)는 한글 폰트가 표현 못 하므로
Segoe UI Emoji(컬러 폰트)로 별도 렌더링해 섞어 그린다.

씬 오버레이를 다 그린 뒤에는 yeori_signature.py의 apply_yeori_signature()로 서여리 채널
시그니처(라벤더 프레임 + @yeori.ai.log/AI 생성 콘텐츠 워터마크)를 항상 마지막에 얹는다.

필요 패키지: Pillow (pip install pillow) — 영상 입력 시 시스템 PATH에 ffmpeg 필요.
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


def draw_deco_glyph(draw, xy, ch, size, fill):
    """장식(하트·반짝이 등)은 실제 문장 속 이모지와 달리 손글씨 펜 색(흰/핑크/라벤더)을
    그대로 따라가야 하므로, 우선 텍스트 폰트로 그려 fill 색을 입힌다(컬러 이모지 폰트로
    그리면 embedded_color가 fill을 무시하고 폰트 고정색을 써버림 — 실측 확인). 다만 텍스트
    폰트(맑은고딕 등)에 실제 글리프가 없는 기호(예: ✨)는 빈 사각형만 나오므로, 그 경우엔
    컬러 이모지 폰트로 대체한다(색은 펜 색과 안 맞지만 빈 박스보다는 낫다)."""
    if not _is_missing_glyph(TEXT_FONT_PATH, size, ch):
        draw.text(xy, ch, font=load_font(TEXT_FONT_PATH, size), fill=fill)
    elif EMOJI_FONT_PATH:
        emoji_size = max(8, int(size * 0.92))
        try:
            draw.text(xy, ch, font=load_font(EMOJI_FONT_PATH, emoji_size), embedded_color=True)
        except TypeError:
            draw.text(xy, ch, font=load_font(EMOJI_FONT_PATH, emoji_size), fill=fill)
    else:
        draw.text(xy, ch, font=load_font(TEXT_FONT_PATH, size), fill=fill)


def draw_mixed_text(draw, xy, text, size, fill):
    x, y = xy
    for is_e, run in split_runs(text):
        font = _run_font(is_e, size)
        if is_e and EMOJI_FONT_PATH:
            try:
                draw.text((x, y), run, font=font, embedded_color=True)
            except TypeError:
                draw.text((x, y), run, font=font, fill=fill)
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
        bulge = 1.12 + 0.16 * (math.sin(bumps * a) * 0.5 + 0.5)  # 부드러운 스캘럽
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
    return max(widths), size * 1.5 * len(lines)


def render_scene(canvas_size, scene, font_size=64):
    W, H = canvas_size
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = COLORS.get(scene.get("color", "white"), COLORS["white"])
    lines = scene.get("text", "").split("\n")

    block_w, block_h = measure_block(draw, lines, font_size)

    ax, ay = POSITION_ANCHORS.get(scene.get("position", "center"), (0.5, 0.5))
    cx, cy = W * ax, H * ay

    pad_x, pad_y = 52, 38
    box_w, box_h = block_w + pad_x * 2, block_h + pad_y * 2

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
    # 말풍선 외곽선이 텍스트를 가로지르지 않도록 텍스트 박스보다 크게 그린다(유형별).
    infl = {"cloud": (box_w * 0.10 + 20, box_h * 0.42 + 24),
            "oval": (box_w * 0.16 + 16, box_h * 0.30 + 18),
            "arrow_box": (26, 20)}.get(bubble, (0, 0))
    margin = 24 + max(infl)
    left = max(margin, min(left, W - box_w - margin))
    top = max(margin, min(top, H - box_h - margin))
    text_box = (left, top, left + box_w, top + box_h)
    bubble_box = _inflate(text_box, *infl)

    # 텍스트 뒤 반투명 판(가독성) — 말풍선 종류와 무관하게 항상.
    img = draw_soft_backing(img, _inflate(text_box, 10, 6), radius=int(min(box_w, box_h) * 0.35))
    draw = ImageDraw.Draw(img)

    if bubble == "cloud":
        draw_cloud(draw, bubble_box, color)
    elif bubble == "oval":
        draw_wobbly_ellipse(draw, (bubble_box[0] + bubble_box[2]) / 2, (bubble_box[1] + bubble_box[3]) / 2,
                            (bubble_box[2] - bubble_box[0]) / 2, (bubble_box[3] - bubble_box[1]) / 2, color)
    elif bubble == "arrow_box":
        draw_wobbly_roundrect(draw, bubble_box, color)

    box = bubble_box  # deco/화살표 배치 기준
    ty = top + pad_y
    for line in lines:
        lw = measure_line(draw, line, font_size)
        tx = left + (box_w - lw) / 2
        angle = random.uniform(-3, 3)
        line_w, line_h = max(1, int(lw + 40)), int(font_size * 1.6)
        line_img = Image.new("RGBA", (line_w, line_h), (0, 0, 0, 0))
        line_draw = ImageDraw.Draw(line_img)
        draw_mixed_text(line_draw, (10, 5), line, font_size, color)
        rotated = line_img.rotate(angle, resample=Image.BICUBIC, expand=True)
        img.paste(rotated, (int(tx - 10), int(ty - 5)), rotated)
        ty += font_size * 1.5

    deco_size = int(font_size * 0.55)
    deco_positions = [
        (box[0] - 18, box[1] - 14), (box[2] + 4, box[1] - 10),
        (box[0] - 14, box[3] - 4), (box[2] + 12, box[3] + 6),
    ]
    for i, d in enumerate(scene.get("deco", [])[:4]):
        dx, dy = deco_positions[i % len(deco_positions)]
        draw_deco_glyph(draw, (dx, dy), d, deco_size, color)

    if scene.get("arrow"):
        direction = scene.get("arrow_direction", "right")
        vx, vy = ARROW_DIR_VECTORS.get(direction, (1, 0))
        cxb, cyb = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
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


def process_image(input_path, output_path, scenes, canvas_size):
    W, H = canvas_size
    src = Image.open(input_path).convert("RGBA")
    ratio = min(W / src.width, H / src.height)
    resized = src.resize((max(1, int(src.width * ratio)), max(1, int(src.height * ratio))))
    base = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    base.paste(resized, ((W - resized.width) // 2, (H - resized.height) // 2))

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
    scenes = config.get("scenes", [])
    if not scenes:
        print("⚠ 설정 파일에 씬(scenes)이 없습니다.")
        sys.exit(1)

    video_exts = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    ext = input_path.suffix.lower()

    if ext in video_exts:
        if shutil.which("ffmpeg") is None:
            print("⚠ ffmpeg를 찾을 수 없습니다 — PATH에 ffmpeg가 설치돼 있는지 확인하세요.")
            sys.exit(1)
        print(f"[1/2] 씬 {len(scenes)}개를 렌더링하며 영상에 시간대별로 합성 중…")
        with tempfile.TemporaryDirectory(prefix="handwriting_") as td:
            process_video(input_path, output_path, scenes, canvas_size, Path(td))
        print(f"[2/2] 출력 완료: {output_path}")
    elif ext in image_exts:
        print(f"[1/1] 씬 {len(scenes)}개를 이미지별로 렌더링 중… "
              f"(정지 이미지라 한 장에 다 못 담아 씬마다 별도 파일로 저장)")
        process_image(input_path, output_path, scenes, canvas_size)
    else:
        print(f"⚠ 지원하지 않는 입력 형식입니다: {ext}")
        sys.exit(1)

    print(f"✓ 손글씨 오버레이 완료 — {len(scenes)}개 씬 적용")


if __name__ == "__main__":
    main()
