#!/usr/bin/env python3
"""MOON WARS — update242: a ship gun from GPT's sheet (magenta ground) -> art/gun_<key>.png and its measures.

    python3 tools/guns/cut_gun.py <sheet.png> <key> [--base-u 27]

jj 17.11 14:55: „mamy działko MK1 od Terry". The gun faces RIGHT on the sheet. Cut out of the magenta, cropped to
itself, scaled so its round BASE is `--base-u` game units wide (it drops into the hull's socket ring), saved x4
(4 px a unit). Printed: the JS line for GUN_ART in js/weapons.js — the picture's size in units, the base's centre
and bottom, the charge window (the black slot GPT left empty: the game lights the pips in it), the muzzle.
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as nd
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src, key = sys.argv[1], sys.argv[2]
base_u = float(sys.argv[sys.argv.index('--base-u') + 1]) if '--base-u' in sys.argv else 27.0
a = np.array(Image.open(src).convert('RGB')).astype(float)
mag = (a[..., 0] > 150) & (a[..., 2] > 150) & (a[..., 1] < 110)
mag |= nd.binary_dilation(mag, iterations=2) & (a[..., 0] > a[..., 1] + 50) & (a[..., 2] > a[..., 1] + 50)
lab, n = nd.label(~mag)
big = max(range(1, n + 1), key=lambda k: (lab == k).sum())
body = nd.binary_fill_holes(lab == big)
ys, xs = np.where(body)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
# the round base: the rows at the bottom, where the gun is only its base
bot = y1 - 1
row = lambda y: np.where(body[y])[0]
bx0, bx1 = row(bot - 6).min(), row(bot - 6).max() + 1
# the charge window: the largest near-black blob inside the body
L = a @ [0.299, 0.587, 0.114]
dark = body & (L < 22)
dl, dn = nd.label(dark)
wk = max(range(1, dn + 1), key=lambda k: (dl == k).sum())
wy, wx = np.where(dl == wk)
win = (wx.min(), wy.min(), wx.max() + 1, wy.max() + 1)
# the muzzle: the rightmost column's middle
mx = x1 - 1; my = np.where(body[:, mx - 3])[0].mean()
s = base_u / (bx1 - bx0)                      # units a sheet px
U = lambda v: round(float(v) * s, 2)
rgba = np.dstack([a, np.where(body, 255, 0)]).astype('uint8')
im = Image.fromarray(rgba).crop((x0, y0, x1, y1))
W, H = (x1 - x0) * s, (y1 - y0) * s
im = im.resize((round(W * 4), round(H * 4)), Image.LANCZOS)
q = np.array(im); q[..., 3] = np.where(q[..., 3] < 128, 0, 255)
Image.fromarray(q).save(os.path.join(ROOT, 'art', f'gun_{key}.png'))
print(f"  {key}: {{ w: {U(x1 - x0)}, h: {U(y1 - y0)}, base: {{ cx: {U((bx0 + bx1) / 2 - x0)}, w: {U(bx1 - bx0)}, bottom: {U(bot + 1 - y0)} }}, "
      f"window: {{ x: {U(win[0] - x0)}, y: {U(win[1] - y0)}, w: {U(win[2] - win[0])}, h: {U(win[3] - win[1])} }}, "
      f"muzzle: {{ x: {U(mx + 1 - x0)}, y: {U(my - y0)} }} }},")
