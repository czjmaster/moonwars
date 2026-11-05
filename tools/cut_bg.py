#!/usr/bin/env python3
"""MOON WARS — a combat background layer from GPT into the game (update199).

    python3 tools/cut_bg.py <sky|far|mid|near> <picture.png>

The pictures (prompts v6, guide_bg_<layer>.png) are 1536 x 1024. The sky
fills the picture; the far mountains, the middle hills and the near plain
are each drawn in a band with flat MAGENTA (#FF00FF) round them — over a
ridge line the magenta is the sky showing through.

Writes art/bg_combat_<layer>.png — magenta keyed out, cut to its band,
scaled to the height CombatGround draws it at (x2 for a sharp screen),
and made SEAMLESS left to right: the last SEAM px of the picture are
blended into its first ones and cut off, so a copy laid after it joins
without a line. Adds the name to art/manifest.json.
"""
import json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut_gear import key_magenta  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H_DESIGN = {'sky': 720, 'far': 170, 'mid': 130, 'near': 344}   # CombatGround.ART / H
DPR = 2
SEAM = 96


def seamless(a, seam):
    a = a.astype(float)
    w = a.shape[1]
    out = a[:, :w - seam].copy()
    for i in range(seam):
        f = i / seam                       # 0 at the join: all the picture's right end
        out[:, i] = a[:, w - seam + i] * (1 - f) + a[:, i] * f
    return out.clip(0, 255).astype(np.uint8)


def main():
    layer, path = sys.argv[1], sys.argv[2]
    if layer not in H_DESIGN:
        sys.exit('layer: sky, far, mid or near')
    a = np.array(Image.open(path).convert('RGBA'))
    if layer != 'sky':
        a = key_magenta(a)
        rows = np.nonzero((a[..., 3] > 40).sum(1) > a.shape[1] * 0.02)[0]
        a = a[rows.min():rows.max() + 1]
    else:
        a[..., 3] = 255
    a = seamless(a, SEAM)
    im = Image.fromarray(a)
    h = H_DESIGN[layer] * DPR
    im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
    name = f'bg_combat_{layer}'
    im.save(os.path.join(ROOT, 'art', name + '.png'), optimize=True)
    mp = os.path.join(ROOT, 'art', 'manifest.json')
    m = json.load(open(mp))
    if name not in m['sprites']:
        m['sprites'].append(name)
        with open(mp, 'w') as f:
            json.dump(m, f, indent=2, ensure_ascii=False); f.write('\n')
    print(name, im.size)


if __name__ == '__main__':
    main()
