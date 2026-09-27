# IG_P01 웹툰 자기소개 — 컷 이미지(2048) → 1080x1080 + 말풍선/하단 문구 (2026-09-27). 문구 바꾸면 TEXTS 만 고치고 다시 실행
import sys, os
from PIL import Image, ImageDraw, ImageFont
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(HERE, '..', '02_images')
FONT = 'C:/Users/user/AppData/Local/Microsoft/Windows/Fonts/Pretendard-SemiBold.ttf'
INK = (122, 88, 176)          # 표지 글씨와 같은 보라
TEXTS = {  # 컷: (원본, 방식, 문구)
  'C01': ('src1.jpg', (722, 70, 1038, 262), '안녕하세요,\n저는 서여리예요!'),
  'C02': ('src2.jpg', 'bottom', '얼굴도, 목소리도, 영상도\n전부 AI가 만들었어요'),
  'C03': ('src3.jpg', 'bottom', '그래도 제 꿈만큼은\n진짜예요.'),
  'C04': ('src7.jpg', (728, 72, 1038, 300), '같이\n봐주실 거죠?'),
}
def bubble_box(im):
    # 오른쪽 위 1/2 영역에서 말풍선 분홍(밝고 R>B>G) 픽셀의 범위
    w, h = im.size; px = im.load(); xs = []; ys = []
    for y in range(0, h // 2, 4):
        for x in range(w // 2, w, 4):
            r, g, b = px[x, y][:3]
            if r > 235 and 190 < g < 225 and 205 < b < 235: xs.append(x); ys.append(y)
    if len(xs) < 200: return None
    xs.sort(); ys.sort(); k = len(xs) // 50
    return xs[k], ys[k], xs[-k - 1], ys[-k - 1]
def fit(draw, text, maxw, maxh, start):
    s = start
    while s > 20:
        f = ImageFont.truetype(FONT, s); bb = draw.multiline_textbbox((0, 0), text, font=f, spacing=s // 4, align='center')
        if bb[2] - bb[0] <= maxw and bb[3] - bb[1] <= maxh: return f, bb
        s -= 2
    return f, bb
for cut, (src, mode, text) in TEXTS.items():
    im = Image.open(os.path.join(SRC, src)).convert('RGB').resize((1080, 1080), Image.LANCZOS)
    d = ImageDraw.Draw(im, 'RGBA')
    if mode != 'bottom':   # 말풍선 위치(1080 기준, 원본에서 실측한 고정값)
        x0, y0, x1, y1 = mode; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        f, bb = fit(d, text, (x1 - x0) * 0.78, (y1 - y0) * 0.62, 64)
        d.multiline_text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]), text, font=f, fill=INK, spacing=f.size // 4, align='center')
    else:
        f, bb = fit(d, text, 760, 150, 50); tw, th = bb[2] - bb[0], bb[3] - bb[1]
        bx0, by0 = (1080 - tw) / 2 - 40, 1080 - 34 - th - 52
        d.rounded_rectangle((bx0, by0, 1080 - bx0, by0 + th + 52), radius=30, fill=(255, 255, 255, 215), outline=(238, 200, 222, 255), width=4)
        d.multiline_text(((1080 - tw) / 2 - bb[0], by0 + 26 - bb[1]), text, font=f, fill=INK, spacing=f.size // 4, align='center')
    out = os.path.join(HERE, f'IG_P01_{cut}.jpg'); im.save(out, quality=95); print(cut, '→', os.path.basename(out))
