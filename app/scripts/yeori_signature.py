#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
yeori_signature.py — 서여리 채널 시그니처 효과 모듈

YEORI_STYLE 프리셋(빙그레체 폰트, 서여리 핑크 구름 말풍선, 고정 데코셋 ♡✨🌸💧,
라벤더 그라디언트 얇은 프레임)과 워터마크(우하단 @yeori.ai.log,
좌하단 "AI 생성 콘텐츠" — 인공지능기본법 의무표시)를 이미지에 자동 적용한다.

handwriting_overlay.py는 이 모듈의 apply_yeori_signature()를 import해서
씬 오버레이 위에 최종적으로 시그니처를 얹는 용도로 쓴다(순환 참조를 피하려고
이 파일은 handwriting_overlay.py를 import하지 않고, 필요한 폰트 유틸을 자체적으로
가지고 있다 — 로직은 동일).

단독 실행:
  python yeori_signature.py --test                    (테스트용 그라디언트 배경에 적용)
  python yeori_signature.py --input in.png --output out.png   (실제 이미지에 적용)
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ── 폰트 (handwriting_overlay.py와 동일한 폴백 체인: 빙그레체 → 나눔손글씨 → 맑은고딕) ──
FONT_DIRS = [Path(r"C:\Windows\Fonts"), Path.home() / "AppData/Local/Microsoft/Windows/Fonts"]
HANDWRITING_FONT_CANDIDATES = [
    "BinggraeTaomB.ttf", "BinggraeTaom.ttf", "Binggrae.ttf",
    "NanumPenScript-Regular.ttf", "NanumPen.ttf", "NanumBrush.ttf", "NanumBrushScript.ttf",
]
FALLBACK_FONT_CANDIDATES = ["malgun.ttf", "malgunbd.ttf"]


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

_FONT_CACHE = {}


def load_font(path, size):
    key = (str(path), size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(str(path), size) if path else ImageFont.load_default()
    return _FONT_CACHE[key]


# ── 서여리 고정 스타일 ────────────────────────────────────────────────────
YEORI_STYLE = {
    "font": "빙그레체",  # 실제 미설치 시 나눔손글씨 → 맑은고딕 순으로 자동 대체(resolve_text_font_path)
    "colors": {
        "white": (255, 255, 255, 255),
        "pink": (0xF4, 0x72, 0xB6, 255),
        "lavender": (0xC4, 0xB5, 0xFD, 255),
    },
    "bubble_color": (0xFF, 0xB7, 0xD5, 255),  # 서여리 핑크
    "bubble_style": "cloud",
    "deco_set": ["♡", "✨", "🌸", "💧"],
    "arrow_style": "curve_dotted",
    "frame": {
        "width": 6,
        "colors": [(0xC4, 0xB5, 0xFD, 255), (0xFF, 0xB7, 0xD5, 255)],  # 라벤더 → 서여리핑크 그라디언트
    },
}

WATERMARK_HANDLE = "@yeori.ai.log"
WATERMARK_AI_LABEL = "AI 생성 콘텐츠"


# ── 프레임 ────────────────────────────────────────────────────────────
def _diagonal_gradient(size, c1, c2):
    """좌상단 c1 → 우하단 c2 대각 그라디언트를 2x2 소형 이미지를 리사이즈해서 빠르게 생성."""
    small = Image.new("RGBA", (2, 2))
    mid = tuple(int((a + b) / 2) for a, b in zip(c1, c2))
    small.putpixel((0, 0), c1)
    small.putpixel((1, 1), c2)
    small.putpixel((1, 0), mid)
    small.putpixel((0, 1), mid)
    return small.resize(size, Image.BILINEAR)


def draw_gradient_frame(img, style=None):
    """이미지 테두리에 라벤더→핑크 그라디언트 얇은 보더를 그려서 반환(원본은 안 건드림)."""
    style = style or YEORI_STYLE["frame"]
    img = img.convert("RGBA")
    W, H = img.size
    width = style["width"]
    c1, c2 = style["colors"]

    grad = _diagonal_gradient((W, H), c1, c2)
    mask = Image.new("L", (W, H), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rectangle([0, 0, W - 1, H - 1], fill=255)
    if W - 2 * width > 0 and H - 2 * width > 0:
        mdraw.rectangle([width, width, W - 1 - width, H - 1 - width], fill=0)
    grad.putalpha(mask)
    return Image.alpha_composite(img, grad)


# ── 워터마크 ───────────────────────────────────────────────────────────
def draw_watermarks(img):
    """우하단 @yeori.ai.log(라벤더 반투명), 좌하단 'AI 생성 콘텐츠'(흰색 소형 반투명,
    인공지능기본법 의무표시)를 그려서 반환."""
    img = img.convert("RGBA")
    W, H = img.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    handle_size = max(20, int(W * 0.028))
    label_size = max(16, int(W * 0.020))
    handle_font = load_font(TEXT_FONT_PATH, handle_size)
    label_font = load_font(TEXT_FONT_PATH, label_size)

    lavender_semi = (*YEORI_STYLE["colors"]["lavender"][:3], 170)
    white_semi = (255, 255, 255, 150)

    handle_w = draw.textlength(WATERMARK_HANDLE, font=handle_font)
    draw.text((W - handle_w - 28, H - handle_size - 44), WATERMARK_HANDLE,
              font=handle_font, fill=lavender_semi)

    draw.text((24, H - label_size - 28), WATERMARK_AI_LABEL,
              font=label_font, fill=white_semi)

    return Image.alpha_composite(img, overlay)


# ── 공개 API ───────────────────────────────────────────────────────────
def apply_yeori_signature(image):
    """image: PIL.Image 또는 이미지 파일 경로(str/Path).
    프레임 → 워터마크 순으로 적용한 PIL.Image(RGBA)를 반환한다.
    handwriting_overlay.py에서 씬 오버레이를 다 그린 뒤 마지막 단계로 호출해서 쓴다."""
    img = Image.open(image) if isinstance(image, (str, Path)) else image
    img = draw_gradient_frame(img)
    img = draw_watermarks(img)
    return img


# ── 단독 실행(테스트) ────────────────────────────────────────────────────
def _make_test_canvas(size=(1080, 1920)):
    base = _diagonal_gradient(size, (40, 30, 55, 255), (70, 45, 60, 255))
    return base.convert("RGB")


def main():
    parser = argparse.ArgumentParser(description="서여리 채널 시그니처 효과 적용/테스트")
    parser.add_argument("--test", action="store_true", help="테스트용 배경 이미지에 시그니처를 적용해 저장")
    parser.add_argument("--input", help="실제 이미지 경로(지정 시 --test 대신 이 이미지에 적용)")
    parser.add_argument("--output", default="yeori_signature_test.png", help="출력 경로")
    args = parser.parse_args()

    if TEXT_FONT_PATH:
        is_target = TEXT_FONT_PATH.name.lower().startswith(("binggrae", "nanum"))
        note = "" if is_target else " (빙그레체/나눔손글씨 미설치 — 맑은고딕으로 대체됨)"
        print(f"ℹ 시그니처 폰트: {TEXT_FONT_PATH.name}{note}")

    if args.input:
        result = apply_yeori_signature(args.input)
    else:
        result = apply_yeori_signature(_make_test_canvas())

    out_path = Path(args.output)
    result.convert("RGB").save(out_path)
    print(f"✓ 서여리 시그니처 적용 완료 → {out_path}")


if __name__ == "__main__":
    main()
