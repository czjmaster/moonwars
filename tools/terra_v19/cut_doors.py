#!/usr/bin/env python3
"""MOON WARS — update239/240: GPT's Terra doors -> art/, x4

    python3 tools/terra_v19/cut_doors.py <inner_sheet.png> [<airlock_sheet.png>]

Inner (terra-drzwi/1b_guide_drzwi_v2_x12): the HEAD (8 x 16 u, the lamp socket at 2..6 x 10..13), the THRESHOLD (8 x 4)
and the two LEAVES (6 x 17). Airlock (1c_guide_sluza_x12, update240 — heavier): head 10 x 16, threshold 10 x 5, leaves
8 x 17 (GPT drew them all a little big — fitted). update240 (jj: „kolor drzwi bliżej metalu jak statek, teraz za bardzo
zielonkawe"): every part brought to the hull's warm grey — its brightness kept, its tint the hull plates'.
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as nd
ART = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', '')
K = 4
TINT = np.array([1.08, 0.99, 0.86])          # the hull plates' warm grey, over the brightness
def sheet(p):
    a = np.array(Image.open(p).convert('RGB')).astype(float)
    m = (a[..., 0] > 170) & (a[..., 2] > 170) & (a[..., 1] < 120)
    m |= nd.binary_dilation(m, iterations=2) & (a[..., 0] > a[..., 1] + 40) & (a[..., 2] > a[..., 1] + 40)
    lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2])[..., None]
    sat = a.max(-1) - a.min(-1); hazard = (a[..., 0] > 150) & (sat > 90)       # the yellow of the stripes stays
    warm = np.clip(lum * TINT, 0, 255)
    a = np.where((hazard | m)[..., None], a, warm)
    return Image.fromarray(np.dstack([np.where(m[..., None], 0, a), np.where(m, 0, 255)]).astype('uint8'))
def cut(rgba, box, wu, hu, name):
    im = rgba.crop(box).resize((wu * K, hu * K), Image.LANCZOS)
    q = np.array(im); q[..., 3] = np.where(q[..., 3] < 128, 0, 255); Image.fromarray(q).save(ART + name + '.png')
s = sheet(sys.argv[1])
cut(s, (57, 58, 157, 263), 8, 16, 'door_head_terra')
cut(s, (57, 360, 157, 414), 8, 4, 'door_sill_terra')
cut(s, (246, 58, 335, 292), 6, 17, 'door_leaf_top_terra')
cut(s, (246, 306, 335, 529), 6, 17, 'door_leaf_bot_terra')
if len(sys.argv) > 2:
    s = sheet(sys.argv[2])
    cut(s, (45, 55, 185, 292), 10, 16, 'door_air_head_terra')
    cut(s, (45, 356, 185, 419), 10, 5, 'door_air_sill_terra')
    cut(s, (233, 55, 345, 296), 8, 17, 'door_air_leaf_top_terra')
    cut(s, (233, 302, 345, 534), 8, 17, 'door_air_leaf_bot_terra')
print('ok')
