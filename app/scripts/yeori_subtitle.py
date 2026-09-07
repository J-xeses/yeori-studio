#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
yeori_subtitle.py — 메이킹 탭 모션 자막(effect) 합성

확정된 컷 영상(주로 BROLL) 위에 CapCut식 모션 자막을 얹는다. 손글씨 주석
(handwriting_overlay.py)과는 별개 — 이쪽은 프레임 단위 애니메이션(스케일·흔들림·
슬라이드·글로우)이 있는 강조 자막이다.

방식: 엔트리마다 표시 구간 전체를 PIL로 PNG 시퀀스(fps장/초)로 렌더한 뒤,
      ffmpeg overlay 로 `enable='between(t,start,end)'` 구간에 합성한다.
      (ffmpeg 필터식의 버전별 차이를 피하려고 모션은 전부 PIL에서 굽는다.)

사용법:
  python yeori_subtitle.py --config cfg.json --input cut_03.mp4 --output cut_03_subtitle.mp4

config JSON:
  {
    "output_size": [1080, 1920],
    "mode": "longform",              # 메타(현재 스타일 분기 없음)
    "effect": "slam",                # 기본 효과 — 엔트리에서 override 가능
    "fps": 30,
    "signature": false,              # 서여리 프레임/워터마크는 굽지 않음(조립 후 별도)
    "style": { "font_size": 72, "color": "#FFFFFF", "position": "bottom", "outline": true },
    "entries": [
      { "text": "데뷔 3년차", "start": 0.3, "end": 2.0 },
      { "text": "글로벌 팬덤 보유", "start": 1.2, "end": 3.0, "effect": "slide", "position": "top" }
    ]
  }

필요: Pillow, PATH에 ffmpeg/ffprobe.
"""

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ── 효과 타입 (명세 그대로) ─────────────────────────────────────────────
EFFECT_TYPES = {
    # 기본형
    "fade":      {"in": 0.3, "out": 0.3},
    "slide":     {"direction": "bottom", "dur": 0.22},
    "typer":     {"char_delay": 0.05},
    "pop":       {"scale_from": 0.0, "dur": 0.15},
    # 강조형
    "slam":      {"scale_from": 1.4, "shake": 2, "dur": 0.1},
    "glow":      {"color": "#AFA9EC", "radius": 12},
    "highlight": {"underline_color": "#FFE066", "dur": 0.2},
    "split":     {"left_from": "left", "right_from": "right"},
}
# 이번 버전에서 실제 렌더 구현된 효과. 나머지는 fade로 폴백 + 경고.
IMPLEMENTED = {"fade", "slide", "pop", "slam", "glow"}

# ── 폰트 (자막용 볼드 산세리프) ────────────────────────────────────────
BUNDLED_FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONT_DIRS = [
    BUNDLED_FONT_DIR,
    Path(r"C:\Windows\Fonts"),
    Path.home() / "AppData/Local/Microsoft/Windows/Fonts",
    Path("/usr/share/fonts"),
    Path("/Library/Fonts"),
]
CAPTION_FONT_CANDIDATES = [
    "malgunbd.ttf", "NotoSansKR-Bold.ttf", "NotoSansKR-VF.ttf",
    "NanumGothicBold.ttf", "NanumGothicExtraBold.ttf",
    "AppleSDGothicNeoB.ttf", "malgun.ttf", "NanumGothic.ttf",
    "Arial Bold.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf",
]


def _find_font(candidates):
    # 1) 직접 경로 확인(handwriting_overlay.py와 동일) — C:\Windows\Fonts 는 가상 셸
    #    폴더라 iterdir() 열거가 spawn 컨텍스트에서 불안정. 존재 확인이 확실하다.
    for d in FONT_DIRS:
        for name in candidates:
            p = d / name
            try:
                if p.exists():
                    return p
            except Exception:
                pass
    # 2) 대소문자 무시 폴백(리눅스/맥)
    for d in FONT_DIRS:
        try:
            entries = {p.name.lower(): p for p in d.iterdir()} if d.exists() else {}
        except Exception:
            entries = {}
        for name in candidates:
            p = entries.get(name.lower())
            if p:
                return p
    return None


CAPTION_FONT_PATH = _find_font(CAPTION_FONT_CANDIDATES)
if CAPTION_FONT_PATH:
    print(f"ℹ 자막 폰트: {CAPTION_FONT_PATH.name}")
else:
    print("⚠ 볼드 산세리프 폰트를 못 찾아 PIL 기본 폰트로 대체합니다(한글이 깨질 수 있음).")

_FONT_CACHE = {}


def load_font(size):
    size = max(8, int(size))
    if size not in _FONT_CACHE:
        _FONT_CACHE[size] = (
            ImageFont.truetype(str(CAPTION_FONT_PATH), size)
            if CAPTION_FONT_PATH else ImageFont.load_default()
        )
    return _FONT_CACHE[size]


# ── 색/보간 유틸 ──────────────────────────────────────────────────────
def hex_rgba(s, alpha=255):
    s = str(s or "#FFFFFF").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    try:
        r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except Exception:
        r, g, b = 255, 255, 255
    return (r, g, b, int(alpha))


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def ease_out_cubic(u):
    u = clamp(u)
    return 1 - (1 - u) ** 3


def ease_out_back(u):
    u = clamp(u)
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2


# ── 자막 블록 렌더 ────────────────────────────────────────────────────
POSITION_FRAC = {"top": 0.15, "center": 0.5, "bottom": 0.80}


def wrap_lines(text, font, max_w):
    """공백 기준 줄바꿈 + 명시적 \\n 유지."""
    scratch = ImageDraw.Draw(Image.new("RGBA", (4, 4)))

    def width(t):
        return scratch.textbbox((0, 0), t, font=font)[2]

    out = []
    for para in str(text).split("\n"):
        words = para.split(" ")
        cur = ""
        for w in words:
            trial = w if not cur else cur + " " + w
            if width(trial) <= max_w or not cur:
                cur = trial
            else:
                out.append(cur)
                cur = w
        out.append(cur)
    return out or [""]


def fit_font(text, base_size, max_w):
    """한 줄이 max_w를 크게 넘으면 폰트를 줄여 맞춘다(최대 3단계)."""
    size = base_size
    for _ in range(6):
        font = load_font(size)
        lines = wrap_lines(text, font, max_w)
        scratch = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
        widest = max(scratch.textbbox((0, 0), ln, font=font)[2] for ln in lines)
        if widest <= max_w or size <= base_size * 0.62:
            return font, lines
        size = int(size * 0.92)
    return load_font(size), wrap_lines(text, load_font(size), max_w)


def render_text_layer(lines, font, fill_rgba, outline):
    """여러 줄 중앙정렬 텍스트를 자기 크기의 RGBA 레이어로. (스케일 전 1.0 기준)"""
    scratch = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
    metrics = [scratch.textbbox((0, 0), ln or " ", font=font, stroke_width=outline) for ln in lines]
    line_h = int(font.size * 1.42)
    block_w = max(m[2] - m[0] for m in metrics) + outline * 2 + 8
    block_h = line_h * len(lines) + outline * 2 + 8
    pad = max(outline * 2, 6)
    layer = Image.new("RGBA", (block_w + pad * 2, block_h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    y = pad
    for ln, m in zip(lines, metrics):
        w = m[2] - m[0]
        x = (layer.width - w) / 2 - m[0]
        if outline:
            d.text((x, y), ln, font=font, fill=fill_rgba,
                   stroke_width=outline, stroke_fill=(0, 0, 0, min(235, fill_rgba[3])))
        else:
            d.text((x, y), ln, font=font, fill=fill_rgba)
        y += line_h
    return layer


def compose_frame(canvas_wh, lines, font, style, effect, params, t_rel, dur):
    """엔트리 한 프레임(RGBA, canvas 크기). 모션(스케일/이동/알파/글로우)을 여기서 굽는다."""
    cw, ch = canvas_wh
    frame = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    fill = hex_rgba(style.get("color", "#FFFFFF"))
    outline = int(font.size * 0.09) if style.get("outline", True) else 0

    scale, dx, dy, alpha, glow_a = 1.0, 0.0, 0.0, 1.0, 0.0
    eff = effect if effect in IMPLEMENTED else "fade"

    if eff == "fade":
        fin = float(params.get("in", 0.3)); fout = float(params.get("out", 0.3))
        alpha = min(ease_out_cubic(t_rel / fin) if fin > 0 else 1.0,
                    ease_out_cubic((dur - t_rel) / fout) if fout > 0 else 1.0)
    elif eff == "slide":
        d0 = float(params.get("dur", 0.22))
        direction = params.get("direction", "bottom")
        travel = int(font.size * 1.3)
        p = 1 - ease_out_cubic(t_rel / d0) if d0 > 0 else 0
        if direction in ("bottom", "top"):
            dy = travel * p * (1 if direction == "bottom" else -1)
        else:
            dx = travel * p * (1 if direction == "right" else -1)
        alpha = min(1.0, ease_out_cubic(t_rel / 0.16), ease_out_cubic((dur - t_rel) / 0.2))
    elif eff == "pop":
        d0 = max(0.01, float(params.get("dur", 0.15)))
        if t_rel < d0:
            scale = 1.15 * max(0.03, ease_out_cubic(t_rel / d0))
        else:
            k = clamp((t_rel - d0) / 0.12)
            scale = 1.15 - 0.15 * ease_out_cubic(k)
        alpha = min(1.0, ease_out_cubic(t_rel / 0.08), ease_out_cubic((dur - t_rel) / 0.2))
    elif eff == "slam":
        d0 = max(0.01, float(params.get("dur", 0.1)))
        sf = float(params.get("scale_from", 1.4))
        shake = float(params.get("shake", 2))
        scale = 1.0 + (sf - 1.0) * (1 - clamp(t_rel / d0))
        decay = max(0.0, 1 - t_rel / 0.2)
        amp = shake * 3.4 * decay
        dx = math.sin(t_rel * 2 * math.pi * 17) * amp
        dy = math.cos(t_rel * 2 * math.pi * 19) * amp
        alpha = min(1.0, ease_out_cubic(t_rel / 0.05), ease_out_cubic((dur - t_rel) / 0.18))
    elif eff == "glow":
        glow_a = 0.5 + 0.28 * math.sin(t_rel * 2 * math.pi * 1.15)
        alpha = min(1.0, ease_out_cubic(t_rel / 0.25), ease_out_cubic((dur - t_rel) / 0.25))

    alpha = clamp(alpha)
    if alpha <= 0.003:
        return frame

    layer = render_text_layer(lines, font, fill, outline)

    # 글로우: glow 효과이거나 style.glow=true 이면 컬러 헤일로를 깐다.
    want_glow = eff == "glow" or style.get("glow")
    if want_glow:
        gp = EFFECT_TYPES["glow"]
        gcol = hex_rgba(style.get("glow_color", gp["color"]))
        radius = int(style.get("glow_radius", gp["radius"]))
        halo = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        ImageDraw.Draw(halo).bitmap((0, 0), layer.split()[3], fill=gcol[:3] + (255,))
        halo = halo.filter(ImageFilter.GaussianBlur(radius))
        base_glow = 0.85 if eff != "glow" else clamp(0.35 + glow_a)
        halo = _mul_alpha(halo, base_glow)
        composite = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        composite = Image.alpha_composite(composite, halo)
        composite = Image.alpha_composite(composite, halo)
        composite = Image.alpha_composite(composite, layer)
        layer = composite

    if scale != 1.0:
        nw = max(1, int(layer.width * scale))
        nh = max(1, int(layer.height * scale))
        layer = layer.resize((nw, nh), Image.Resampling.LANCZOS)
    if alpha < 0.999:
        layer = _mul_alpha(layer, alpha)

    cx = cw / 2 + dx
    cy = ch * POSITION_FRAC.get(style.get("position", "bottom"), 0.80) + dy + style.get("_stack_dy", 0)
    frame.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))
    return frame


def _mul_alpha(img, factor):
    r, g, b, a = img.split()
    a = a.point(lambda v: int(v * clamp(factor)))
    return Image.merge("RGBA", (r, g, b, a))


# ── 엔트리 → PNG 시퀀스 ──────────────────────────────────────────────
def build_entry_frames(entry, defaults, style, canvas_wh, fps, work_dir, idx):
    cw, ch = canvas_wh
    text = str(entry.get("text", "")).strip()
    start = float(entry.get("start", 0))
    end = float(entry.get("end", start + 2))
    dur = max(0.1, end - start)
    effect = (entry.get("effect") or defaults).lower()
    if effect not in IMPLEMENTED:
        print(f"⚠ 효과 '{effect}' 는 아직 미구현 — fade로 대체합니다.")
    params = dict(EFFECT_TYPES.get(effect, EFFECT_TYPES["fade"]))
    params.update(entry.get("params", {}))

    est = dict(style)
    est.update({k: entry[k] for k in ("color", "position", "font_size", "outline") if k in entry})
    est["_stack_dy"] = entry.get("_stack_dy", 0)

    base_size = int(est.get("font_size", 72))
    font, lines = fit_font(text, base_size, int(cw * 0.86))

    n = max(1, int(round(dur * fps)))
    for f in range(n):
        t_rel = f / fps
        img = compose_frame(canvas_wh, lines, font, est, effect, params, t_rel, dur)
        img.save(work_dir / f"e{idx}_{f:04d}.png")
    return {"idx": idx, "count": n, "start": start, "end": end}


# ── ffmpeg 합성 ──────────────────────────────────────────────────────
def probe_duration(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True,
        ).stdout.strip()
        return float(out)
    except Exception:
        return None


def run_cmd(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"명령 실패:\n{' '.join(str(c) for c in cmd)}\n{proc.stderr[-2500:]}")
    return proc


def process_video(input_path, output_path, entry_meta, canvas_wh, fps, work_dir,
                  limit=None):
    W, H = canvas_wh
    src_dur = probe_duration(input_path)
    out_dur = min(src_dur, limit) if (src_dur and limit) else (limit or src_dur)

    cmd = ["ffmpeg", "-y", "-i", str(input_path)]
    for m in entry_meta:
        cmd += ["-framerate", str(fps), "-itsoffset", f"{m['start']:.3f}",
                "-i", str(work_dir / f"e{m['idx']}_%04d.png")]

    parts = [f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
             f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1[base]"]
    prev = "base"
    for i, m in enumerate(entry_meta):
        lbl = f"v{i}"
        s, e = m["start"], m["end"]
        parts.append(
            f"[{prev}][{i + 1}:v]overlay=0:0:eof_action=pass:"
            f"enable='between(t,{s:.3f},{e:.3f})'[{lbl}]"
        )
        prev = lbl
    parts.append(f"[{prev}]null[vout]")

    cmd += [
        "-filter_complex", ";".join(parts),
        "-map", "[vout]", "-map", "0:a?",
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-g", str(fps * 2), "-movflags", "+faststart", "-c:a", "aac", "-shortest",
    ]
    if out_dur:
        cmd += ["-t", f"{out_dur:.3f}"]
    cmd += [str(output_path)]
    run_cmd(cmd)


# ── 진입점 ───────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="메이킹 탭 모션 자막 합성")
    ap.add_argument("--config", required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--preview", type=float, default=0,
                    help="앞 N초만 렌더(미리보기). 0이면 전체")
    args = ap.parse_args()

    cfg_path, in_path, out_path = Path(args.config), Path(args.input), Path(args.output)
    if not cfg_path.exists():
        print(f"⚠ 설정 파일 없음: {cfg_path}"); sys.exit(1)
    if not in_path.exists():
        print(f"⚠ 입력 영상 없음: {in_path}"); sys.exit(1)
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        print("⚠ ffmpeg/ffprobe 를 PATH에서 찾을 수 없습니다."); sys.exit(1)

    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    canvas_wh = tuple(cfg.get("output_size", [1080, 1920]))
    fps = int(cfg.get("fps", 30))
    default_effect = (cfg.get("effect") or "slam").lower()
    style = dict(cfg.get("style") or {})
    style.setdefault("font_size", 72)
    style.setdefault("color", "#FFFFFF")
    style.setdefault("position", "bottom")
    style.setdefault("outline", True)

    entries = [e for e in (cfg.get("entries") or []) if str(e.get("text", "")).strip()]
    if not entries:
        print("⚠ entries 가 비었습니다."); sys.exit(1)

    # 표시 구간이 겹치고 같은 position 인 엔트리는 세로로 쌓는다.
    groups = {}
    for e in sorted(entries, key=lambda x: float(x.get("start", 0))):
        pos = e.get("position", style["position"])
        line_h = int(e.get("font_size", style["font_size"]) * 1.55)
        active = [g for g in groups.get(pos, []) if float(g.get("end", 0)) > float(e.get("start", 0))]
        k = len(active)
        e["_stack_dy"] = (-k * line_h) if pos == "bottom" else (k * line_h if pos == "top" else (k - 0.0) * line_h)
        groups.setdefault(pos, []).append(e)

    limit = args.preview or None
    print(f"[1/2] 엔트리 {len(entries)}개 프레임 렌더 (effect 기본={default_effect}, {fps}fps)…")
    with tempfile.TemporaryDirectory(prefix="yeori_subtitle_") as td:
        work = Path(td)
        meta = []
        for i, e in enumerate(entries):
            m = build_entry_frames(e, default_effect, style, canvas_wh, fps, work, i)
            meta.append(m)
            print(f"    엔트리 {i + 1}/{len(entries)} — “{e['text']}” {m['start']}s~{m['end']}s ({m['count']}f)")
        print("[2/2] ffmpeg 합성…")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        process_video(in_path, out_path, meta, canvas_wh, fps, work, limit=limit)

    print(f"✓ 모션 자막 완료 — {out_path}")


if __name__ == "__main__":
    main()
