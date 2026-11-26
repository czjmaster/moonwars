#!/usr/bin/env python3
"""MOON WARS — update266: the Phoenix hulls' engine pods, cut out whole again.

    python3 tools/phoenix_fix/fix_engines.py [--dry]

jj 26.11: „Phoenix — kadłuby źle wycięte przy silnikach". The background cut of GPT's Phoenix hulls (v17) ate the
dark, shaded lower half of every round engine pod at the stern: holes through the barrel and a chewed outline. The
pods are drawn lit from above but symmetric in shape, so each one is mended from its own clean upper half: a pixel
that is see-through in the lower half (row cy + d) while its mirror (cy - d) is solid is filled with that mirror,
darkened by how much darker that pod's lower half is;
the few holes up top (between the barrel and its armour) the other way, lightened. Only left of the pod's lamp (the barrel and its housing), only
within R of its centre (the soft half-see-through rims of the cut count as holes). Every picture of the hull: open, roof, and both enemy colourings (those
face the other way — mirrored for the mending).
"""
import sys, os, numpy as np
from PIL import Image
ART = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', '')
R = 40
SOLID = 200
# hull: (x1 — the pod's right end, just left of its lamp; the pods' centres)
PODS = {
    'osiris':        (87, [137, 243.5, 351]),
    'enemy_gunship': (82, [132, 254]),
    'enemy_raider':  (77, [120, 239.5]),
    'enemy_sopdet':  (44, [160, 274]),
}
def lum(p): return 0.299 * p[..., 0] + 0.587 * p[..., 1] + 0.114 * p[..., 2]
def mend(a, x1, centres):
    a = a.copy(); filled = 0
    for cy in centres:
        c = int(round(cy))
        pairs = [(c + d, c - d) for d in range(1, R + 1) if 0 <= c - d and c + d < a.shape[0]]
        lo = np.array([a[y, :x1] for y, _ in pairs]).astype(float)
        up = np.array([a[y, :x1] for _, y in pairs]).astype(float)
        both = (lo[..., 3] >= SOLID) & (up[..., 3] >= SOLID)
        k = float(np.clip(np.median(lum(lo)[both] / np.maximum(lum(up)[both], 1)), 0.45, 1.0)) if both.any() else 0.7
        for (yl, yu) in pairs:
            # the lower half from the upper (darkened), then what is still missing up top from the lower (lightened)
            for dst, src_y, f in ((yl, yu, k), (yu, yl, 1 / k)):
                hole = (a[dst, :x1, 3] < SOLID) & (a[src_y, :x1, 3] >= SOLID)     # the cut's soft rims too
                if hole.any():
                    src = a[src_y, :x1][hole].astype(float)
                    src[:, :3] = np.clip(src[:, :3] * f, 0, 255)
                    a[dst, :x1][hole] = src.astype(a.dtype); filled += int(hole.sum())
    return a, filled
if __name__ == '__main__':
    dry = '--dry' in sys.argv
    for key, (x1, cs) in PODS.items():
        for suf in ['', '_roof', '_enemy', '_enemy_roof']:
            p = f'{ART}hull_{key}{suf}.png'
            im = Image.open(p); mode = im.mode
            a = np.array(im.convert('RGBA'))
            flip = suf.startswith('_enemy')            # their colouring faces the other way: the pods at the right
            if flip: a = a[:, ::-1]
            a, n = mend(a, x1, cs)
            if flip: a = a[:, ::-1]
            print(f'hull_{key}{suf}: {n} px')
            if not dry: Image.fromarray(a).save(p)
