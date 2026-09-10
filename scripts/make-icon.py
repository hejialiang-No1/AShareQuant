#!/usr/bin/env python3
"""
make-icon.py —— 生成 AShareQuant 应用图标（macOS .icns）

设计：深色终端底 + 红金渐变上升折线 + 面积填充 + 底部红涨绿跌蜡烛，
      左上角一枚金色 "A" 徽标，呼应"A股量化终端"（国内习惯：涨红跌绿）。

用法：python3 scripts/make-icon.py
"""
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
SIZE = 1024

BG_TOP = (34, 22, 26)
BG_BOTTOM = (12, 10, 14)
LINE_A = (255, 92, 88)     # 中国红
LINE_B = (255, 196, 78)    # 金
UP = (246, 70, 93)         # 涨：红
DOWN = (14, 203, 129)      # 跌：绿
GOLD = (255, 200, 87)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius_ratio=0.2237):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1],
                                        radius=int(size * radius_ratio), fill=255)
    return m


def draw_background(img, size):
    d = ImageDraw.Draw(img)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(BG_TOP, BG_BOTTOM, y / max(1, size - 1)))


def draw_grid(d, size):
    top, bottom = int(size * 0.24), int(size * 0.76)
    for i in range(1, 4):
        y = top + (bottom - top) * i / 4
        d.line([(int(size * 0.14), y), (int(size * 0.86), y)], fill=(255, 255, 255, 14), width=2)


def draw_chart(img, size):
    xs = [0.16, 0.29, 0.40, 0.51, 0.62, 0.73, 0.86]
    ys = [0.66, 0.58, 0.61, 0.47, 0.50, 0.38, 0.28]
    pts = [(int(size * x), int(size * y)) for x, y in zip(xs, ys)]
    base_y = int(size * 0.80)

    # 渐变面积
    grad = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(int(size * 0.24), base_y):
        t = (y - size * 0.24) / max(1, base_y - size * 0.24)
        gd.line([(0, y), (size, y)], fill=LINE_A + (int(96 * (1 - t) + 8),))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).polygon(pts + [(pts[-1][0], base_y), (pts[0][0], base_y)], fill=255)
    grad.putalpha(mask)
    img.paste(Image.alpha_composite(img.convert('RGBA'), grad).convert('RGB'), (0, 0))

    d = ImageDraw.Draw(img)
    w = max(6, int(size * 0.030))
    for i in range(len(pts) - 1):
        t = (i + 0.5) / (len(pts) - 1)
        col = lerp(LINE_A, LINE_B, t)
        d.line([pts[i], pts[i + 1]], fill=col, width=w, joint='curve')
        r = w * 0.42
        d.ellipse([pts[i][0] - r, pts[i][1] - r, pts[i][0] + r, pts[i][1] + r], fill=col)

    ex, ey = pts[-1]
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([ex - w * 2.4, ey - w * 2.4, ex + w * 2.4, ey + w * 2.4],
                                 fill=LINE_B + (80,))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.022))
    img.paste(Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB'), (0, 0))
    ImageDraw.Draw(img).ellipse([ex - w * 0.75, ey - w * 0.75, ex + w * 0.75, ey + w * 0.75],
                                fill=(255, 255, 255))


def draw_candles(img, size):
    d = ImageDraw.Draw(img)
    base, top = int(size * 0.80), int(size * 0.68)
    xs = [0.20, 0.29, 0.38, 0.47, 0.56, 0.65, 0.74, 0.83]
    data = [(0.62, 0.78, True), (0.55, 0.70, True), (0.60, 0.74, False), (0.48, 0.62, True),
            (0.42, 0.56, True), (0.46, 0.60, False), (0.30, 0.44, True), (0.18, 0.32, True)]
    cw = int(size * 0.026)
    for x, (h0, h1, is_up) in zip(xs, data):
        cx = int(size * x)
        y0 = int(top + (base - top) * (1 - h1))
        y1 = int(top + (base - top) * (1 - h0))
        col = UP if is_up else DOWN
        d.line([(cx, y0), (cx, y1)], fill=col, width=max(3, int(size * 0.008)))
        d.rectangle([cx - cw // 2, y0, cx + cw // 2, max(y0 + 4, y1)], fill=col)


def draw_badge(img, size):
    """左上角金色 A 徽标"""
    d = ImageDraw.Draw(img)
    cx = cy = int(size * 0.255)
    r = int(size * 0.135)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(20, 14, 16), outline=GOLD,
              width=max(4, int(size * 0.014)))

    fs = int(size * 0.20)
    font = None
    for p in ('/System/Library/Fonts/Supplemental/Futura.ttc',
              '/System/Library/Fonts/Helvetica.ttc',
              '/System/Library/Fonts/SFNS.ttf',
              '/Library/Fonts/Arial Bold.ttf'):
        if os.path.exists(p):
            try:
                font = ImageFont.truetype(p, fs)
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), 'A', font=font)
    d.text((cx - (bbox[2] - bbox[0]) / 2 - bbox[0], cy - (bbox[3] - bbox[1]) / 2 - bbox[1]),
           'A', font=font, fill=GOLD)


def make_icon(size=SIZE):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw_background(img, size)
    d = ImageDraw.Draw(img)
    draw_grid(d, size)
    draw_chart(img, size)
    draw_candles(img, size)
    draw_badge(img, size)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), rounded_mask(size))
    return out


def main():
    os.makedirs(ASSETS, exist_ok=True)
    big = make_icon(SIZE * 2)
    icon = big.resize((SIZE, SIZE), Image.LANCZOS)
    png_path = os.path.join(ASSETS, 'icon.png')
    icon.save(png_path, 'PNG')
    print('生成 icon.png:', png_path)

    iconset = os.path.join(ASSETS, 'icon.iconset')
    os.makedirs(iconset, exist_ok=True)
    for s, name in [(16, 'icon_16x16.png'), (32, 'icon_16x16@2x.png'),
                    (32, 'icon_32x32.png'), (64, 'icon_32x32@2x.png'),
                    (128, 'icon_128x128.png'), (256, 'icon_128x128@2x.png'),
                    (256, 'icon_256x256.png'), (512, 'icon_256x256@2x.png'),
                    (512, 'icon_512x512.png'), (1024, 'icon_512x512@2x.png')]:
        icon.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, name), 'PNG')

    icns = os.path.join(ASSETS, 'icon.icns')
    r = subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns],
                       capture_output=True, text=True)
    if r.returncode == 0 and os.path.exists(icns):
        print('生成 icon.icns:', icns, f'({os.path.getsize(icns)} bytes)')
    else:
        print('iconutil 失败:', r.stderr)


if __name__ == '__main__':
    main()
