"""Derive per-table live stills from the one photo we own.

The felt is the only thing recoloured: pixels whose hue sits in the felt's band get
rotated to a new hue, so the wood rail, chips, cards and the dealer's hands keep their
own colours. Each variant also takes a slightly different framing of the same shot, at
the identical 672x470 aspect the stage is built around.
"""
from PIL import Image, ImageEnhance
import numpy as np, os

SRC = '/home/user/Cage-Admin/shared/assets/table-live.jpg'
OUT = '/home/user/Cage-Admin/shared/assets'
W, H = 672, 470

# felt hue band in PIL's 0..255 hue scale (the source felt sits at ~128-160)
FELT_LO, FELT_HI = 118, 172

def recolour(im, hue_delta, sat_scale=1.0):
    hsv = np.asarray(im.convert('HSV')).astype(np.int16)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    felt = (h >= FELT_LO) & (h <= FELT_HI) & (s > 40)
    h[felt] = (h[felt] + hue_delta) % 256
    if sat_scale != 1.0:
        s[felt] = np.clip(s[felt] * sat_scale, 0, 255)
    hsv[:, :, 0], hsv[:, :, 1] = h, s
    return Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')

def frame(im, zoom, dx=0.0, dy=0.0):
    """Crop a zoom-th of the frame, centred at (0.5+dx, 0.5+dy), back to WxH."""
    w, h = int(im.width / zoom), int(im.height / zoom)
    cx, cy = im.width * (0.5 + dx), im.height * (0.5 + dy)
    l = int(max(0, min(im.width - w, cx - w / 2)))
    t = int(max(0, min(im.height - h, cy - h / 2)))
    return im.crop((l, t, l + w, t + h)).resize((W, H), Image.LANCZOS)

# name, hue delta, saturation scale, zoom, pan x, pan y, brightness
VARIANTS = [
    ('table-live-1.jpg',    0, 1.00, 1.00,  0.00,  0.00, 1.00),  # teal - the original framing
    ('table-live-2.jpg',  -52, 1.05, 1.06,  0.03, -0.02, 0.97),  # green felt
    ('table-live-3.jpg',   12, 1.00, 1.04, -0.04,  0.01, 1.03),  # blue felt
    ('table-live-4.jpg',  104, 0.90, 1.08,  0.02,  0.03, 0.95),  # burgundy felt
    ('table-live-5.jpg',   51, 0.92, 1.02, -0.02, -0.03, 1.05),  # violet felt
    ('table-live-6.jpg',  -94, 0.85, 1.05,  0.04,  0.02, 0.93),  # olive felt
]

src = Image.open(SRC).convert('RGB')
for name, dh, ds, zoom, dx, dy, bright in VARIANTS:
    im = recolour(src, dh, ds) if dh or ds != 1.0 else src.copy()
    im = frame(im, zoom, dx, dy)
    if bright != 1.0:
        im = ImageEnhance.Brightness(im).enhance(bright)
    path = os.path.join(OUT, name)
    im.save(path, 'JPEG', quality=82, optimize=True)
    print(name, im.size, f'{os.path.getsize(path)//1024}KB')
