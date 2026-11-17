#!/usr/bin/env python3
"""MOON WARS — update236: GPT's Terra insides (drawn in layers, jj 17.11) -> the game's parts, x4 (4 px a grid unit)

    python3 tools/terra_v18/cut_interior.py <wall.png> <floor.png> <duct.png> <shaft.png>

The four sheets GPT drew on the guides of claude/... (terra-wnetrza): the back wall of every module (100 x 50, one
for all), the floor (100 x 12; GPT drew it 9 high — stretched to 12), the duct (two grilles and the inside; jj: the
upright slots only), the lift trunk (top, middle, bottom — GPT drew each 87 high: re-cut to 70 — the wall to the
landing, the landing from the floor sheet, the duct's level) and the open cabin. Writes into art/:
  room_wall_terra       400 x 200  the wall with the floor laid at 38..50 (the modules' floor line)
  duct_back_terra       400 x 80   the duct's inside;  duct_front_terra  400 x 80  the grille (slots cut out)
  shaft_trunk_terra     120 x 280  one deck of the trunk (repeats);  shaft_top_terra / shaft_bottom_terra the ends
  lift_cabin_terra      120 x 160  the cage (its roof and hoist at the top, the floor at the bottom)
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as nd
ART = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', '')
K = 4
WALL, FLOOR, DUCT, SHAFT = sys.argv[1:5]

def demag(im):
    a = np.array(im.convert('RGBA')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r > 150) & (b > 150) & (g < 120)
    m |= nd.binary_dilation(m, iterations=2) & (r > g + 35) & (b > g + 35)
    a[m, 3] = 0; a[m, :3] = 8; return Image.fromarray(a.astype('uint8'))      # no magenta left to bleed into the edges
def fit(im, box, wu, hu):
    out = demag(im.crop(box)).resize((wu * K, hu * K), Image.LANCZOS)
    a = np.array(out); a[..., 3] = np.where(a[..., 3] < 128, 0, 255); return Image.fromarray(a)   # hard edges, pixel art
def sheet(p, w=1536):               # GPT gave some sheets at 1344 x 896: back to the guide's 1536 x 1024
    im = Image.open(p).convert('RGB'); return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) if im.width != w else im

W, F, D, S = sheet(WALL), sheet(FLOOR), sheet(DUCT), Image.open(SHAFT).convert('RGB')
wall = fit(W, (60, 60, 1260, 660), 100, 50)
floor = fit(F, (60, 60, 1260, 166), 100, 12)            # GPT's floor ends at 166 (9 u): stretched to 12
land = fit(F, (60, 540, 420, 646), 30, 12)
room = wall.copy(); room.alpha_composite(floor, (0, 38 * K)); room.save(ART + 'room_wall_terra.png')
fit(D, (60, 60, 1260, 300), 100, 20).save(ART + 'duct_front_terra.png')     # the upright slots (jj: not the long ones)
fit(D, (60, 661, 1260, 901), 100, 20).save(ART + 'duct_back_terra.png')

def trunk(x0, x1, kind):            # GPT's trunk at 10 px a unit, 87 high: the wall 0..38, our landing, the duct 50..70
    wall_ = S.crop((x0, 61, x1, 441))
    if kind == 'bottom':
        duct = Image.new('RGB', (x1 - x0, 203)); duct.paste(S.crop((x0, 563, x1, 633)), (0, 0)); duct.paste(S.crop((x0, 798, x1, 931)), (0, 70))
    else: duct = S.crop((x0, 563, x1, 763))
    seg = Image.new('RGBA', (30 * K, 70 * K))
    seg.paste(wall_.resize((30 * K, 38 * K), Image.LANCZOS), (0, 0)); seg.paste(duct.resize((30 * K, 20 * K), Image.LANCZOS), (0, 50 * K))
    seg.alpha_composite(land, (0, 38 * K)); return seg
for (x0, x1), n in (((64, 374), 'top'), ((421, 729), 'trunk'), ((778, 1085), 'bottom')):
    trunk(x0, x1, n).save(ART + f'shaft_{n}_terra.png')
fit(S, (1147, 135, 1440, 540), 30, 40).save(ART + 'lift_cabin_terra.png')
print('ok')
