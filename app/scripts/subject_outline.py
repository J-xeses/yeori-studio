#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""subject_outline.py — 사진 속 인물 둘레에 손그림 흰 테두리를 얹는다.

인스타 스토리에서 자주 보는 "인물을 스티커처럼 흰 선으로 따라 그린" 효과.
인물을 오려내지 않고 원본 사진은 그대로 두되, 인물 바깥 경계선만 흰색으로 긋는다.

의존: rembg + onnxruntime (pip install rembg onnxruntime). 첫 실행 시 세그멘테이션
모델(u2net_human_seg, ~170MB)을 자동 다운로드한다.

handwriting_overlay.py가 config의 "subject_outline"을 통해 호출한다:
  "subject_outline": true
  "subject_outline": { "width": 7, "gap": 3, "color": "white", "opacity": 0.95 }
"""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from PIL import Image, ImageChops, ImageFilter

_SESSION = None
_REMBG_ERR = None


def _get_session():
    global _SESSION, _REMBG_ERR
    if _SESSION is not None or _REMBG_ERR is not None:
        return _SESSION
    try:
        from rembg import new_session
        _SESSION = new_session("u2net_human_seg")
    except Exception as e:  # noqa: BLE001
        _REMBG_ERR = e
    return _SESSION


_COLORS = {
    "white": (255, 255, 255),
    "pink": (0xF4, 0x72, 0xB6),
    "lavender": (0xC4, 0xB5, 0xFD),
    "black": (20, 20, 20),
}


def _subject_mask(base_rgb):
    """인물 실루엣 마스크('L' 모드, 255=인물). rembg 사용 불가 시 None."""
    session = _get_session()
    if session is None:
        return None
    try:
        from rembg import remove
        out = remove(base_rgb.convert("RGBA"), session=session, only_mask=True,
                     post_process_mask=True)
        mask = out.convert("L") if out.mode != "L" else out
        return mask.point(lambda p: 255 if p > 128 else 0)
    except Exception:  # noqa: BLE001
        return None


def add_subject_outline(base_rgba, opts=None):
    """base_rgba(RGBA) 위에 인물 테두리를 그려 새 RGBA를 돌려준다.
    실패하면(모델 없음 등) 원본을 그대로 돌려주고 사유를 콘솔에 남긴다."""
    if opts in (None, False):
        return base_rgba
    if opts is True:
        opts = {}

    width = int(opts.get("width", 7))
    gap = int(opts.get("gap", 3))            # 인물과 테두리 사이 간격(px)
    opacity = float(opts.get("opacity", 0.95))
    rgb = _COLORS.get(opts.get("color", "white"), _COLORS["white"])

    mask = _subject_mask(base_rgba.convert("RGB"))
    if mask is None:
        print(f"⚠ 인물 테두리 건너뜀 — rembg 사용 불가"
              f"{(': ' + str(_REMBG_ERR)) if _REMBG_ERR else ''}")
        return base_rgba

    # 인물 바깥으로 gap 만큼 떨어진 지점부터 width 두께의 링
    def expand(m, px):
        return m.filter(ImageFilter.MaxFilter(px * 2 + 1)) if px > 0 else m

    inner = expand(mask, gap)
    outer = expand(mask, gap + width)
    band = ImageChops.subtract(outer, inner)
    # 살짝 부드럽게 → 손그림 느낌
    band = band.filter(ImageFilter.GaussianBlur(0.8)).point(lambda p: min(255, int(p * 1.4)))

    line = Image.new("RGBA", base_rgba.size, (0, 0, 0, 0))
    solid = Image.new("RGBA", base_rgba.size, rgb + (int(255 * opacity),))
    line.paste(solid, (0, 0), band)
    return Image.alpha_composite(base_rgba, line)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python subject_outline.py <입력이미지> <출력이미지>")
        sys.exit(1)
    src = Image.open(sys.argv[1]).convert("RGBA")
    add_subject_outline(src, {"width": 7, "gap": 3}).convert("RGB").save(sys.argv[2])
    print(f"✓ 저장: {sys.argv[2]}")
