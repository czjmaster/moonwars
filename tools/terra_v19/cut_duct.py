#!/usr/bin/env python3
"""MOON WARS — update240: GPT's Terra duct v2 (jj 17.11: thin rails, wide gaps; jj 12:58 gave a better sheet: the grille
with a stepped rail across, the inside a calm dark wall with three little lamps)

    python3 tools/terra_v19/cut_duct.py <sheet.png> [--tint] [--grille-from art/duct_front_aquarius.png]

jj 13:13: GPT's grille still weak — Aquarius's grille instead, repainted in the colour of the Terra floor (its tint and
brightness measured on room_wall_terra's floor band, 38..50); the inside stays this sheet's.

The two parts are found on the sheet (the grille on top, the inside under it), fitted to 100 x 20 each ->
art/duct_front_terra.png (the gaps cut out), art/duct_back_terra.png (solid), x4.
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as nd
ART = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', '')
a = np.array(Image.open(sys.argv[1]).convert('RGB')).astype(float)
m = (a[..., 0] > 170) & (a[..., 2] > 170) & (a[..., 1] < 120)
m |= nd.binary_dilation(m, iterations=2) & (a[..., 0] > a[..., 1] + 40) & (a[..., 2] > a[..., 1] + 40)
# the pink GPT smeared between the bars (magenta blended into steel): the steel's own warm grey, by its brightness
pink = ~m & (a[..., 2] > a[..., 1] + 12) & (a[..., 0] > a[..., 1] + 12)
L = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2])[..., None]
a = np.where(pink[..., None], np.clip(L * np.array([1.08, 0.99, 0.86]), 0, 255), a)
m |= pink & (L[..., 0] > 150)                                    # what is mostly magenta: gone
rgba = Image.fromarray(np.dstack([np.where(m[..., None], 8, a), np.where(m, 0, 255)]).astype('uint8'))
def cut(box, name, solid=False):
    im = rgba.crop(box).resize((400, 80), Image.LANCZOS)
    q = np.array(im); q[..., 3] = 255 if solid else np.where(q[..., 3] < 128, 0, 255)
    if solid:                   # update241: the inside at least as light as jj asked in 238 (a rat seen against it)
        f = q[..., :3].astype(float); L = (0.3 * f[..., 0] + 0.59 * f[..., 1] + 0.11 * f[..., 2]).mean()
        if L < 60: q[..., :3] = np.clip(255 * (f / 255) ** (np.log(60 / 255) / np.log(L / 255)), 0, 255).astype('uint8')
    Image.fromarray(q).save(ART + name + '.png')
lab, n = nd.label(~m)
boxes = sorted([(sl[0].start, sl[1].start, sl[1].stop, sl[0].stop) for k, sl in enumerate(nd.find_objects(lab)) if (lab[sl] == k + 1).sum() > 50000])
(fy0, fx0, fx1, fy1), (by0, bx0, bx1, by1) = boxes[:2]
cut((fx0, fy0, fx1, fy1), 'duct_front_terra')
cut((bx0 + 1, by0 + 1, bx1 - 1, by1 - 1), 'duct_back_terra', solid=True)      # the inside is solid: a hair in from GPT's edge
print('ok')

if '--tint' in sys.argv:            # jj 13:29 sheet: GPT's bars carry the magenta in their shading -> the floor's own tint, their light kept
    g = np.array(Image.open(ART + 'duct_front_terra.png').convert('RGBA')).astype(float)
    w = np.array(Image.open(ART + 'room_wall_terra.png').convert('RGB')).astype(float)[152:200].reshape(-1, 3)
    lum = lambda c: 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]
    fl = w.mean(0); on = g[..., 3] > 0; L = lum(g); k = 1.15 * lum(fl) / L[on].mean()
    g[..., :3] = np.clip(L[..., None] * k * (fl / lum(fl)), 0, 255)
    Image.fromarray(g.astype('uint8')).save(ART + 'duct_front_terra.png')
    print('grille in the floor tint', fl.round(1))

if '--grille-from' in sys.argv:
    g = np.array(Image.open(sys.argv[sys.argv.index('--grille-from') + 1]).convert('RGBA')).astype(float)
    w = np.array(Image.open(ART + 'room_wall_terra.png').convert('RGB')).astype(float)[152:200].reshape(-1, 3)
    lum = lambda c: 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]
    fl = w.mean(0); tint = fl / lum(fl)
    on = g[..., 3] > 0; L = lum(g); k = lum(fl) / L[on].mean()
    g[..., :3] = np.clip(L[..., None] * k * tint, 0, 255)
    g = Image.fromarray(g.astype('uint8')).resize((400, 80), Image.LANCZOS)
    q = np.array(g); q[..., 3] = np.where(q[..., 3] < 128, 0, 255); Image.fromarray(q).save(ART + 'duct_front_terra.png')
    print('grille from', sys.argv[sys.argv.index('--grille-from') + 1], 'in the floor colour', fl.round(1))
