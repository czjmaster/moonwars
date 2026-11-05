#!/usr/bin/env python3
"""MOON WARS — landing gear sheets from GPT into game sprites (update198).

    python3 tools/cut_gear.py <yard> <sheet.png> [--cuts top,strutTop,footTop]

A sheet (prompt E, v5) is three parts on flat MAGENTA, top to bottom:
the gear bay mount that hangs under the keel, the telescopic strut, and
the foot (the landing pad). Writes art/gear_<yard>_{mount,strut,foot}.png,
each trimmed to its own pixels and scaled together (the foot 160 px wide), with the magenta keyed out and its fringe
pulled back to neutral.

The three parts are found by the empty rows between them. A sheet where
they touch (Terra's did) takes --cuts: the rows where the strut and the
foot begin.
"""
import os, sys
import numpy as np
from PIL import Image

FOOT_W = 160                         # px: drawn at ~45 px, room for DPR 2 and the loadout's zoom
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def key_magenta(a):
    rgb = a[..., :3].astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # how magenta a pixel is: red and blue both high above green
    m = np.clip((np.minimum(r, b) - g - 40) / 120.0, 0, 1)
    alpha = (1 - m) * 255
    out = a.copy()
    out[..., 3] = alpha.astype(np.uint8)
    # despill: a half-keyed edge keeps no pink — red and blue down to green's level
    edge = (m > 0) & (m < 1)
    lim = np.maximum(g, np.minimum(r, b) - (m * 255).astype(int))
    out[..., 0] = np.where(edge, np.minimum(r, lim), r)
    out[..., 2] = np.where(edge, np.minimum(b, lim), b)
    out[alpha < 24] = 0
    return out


def bands(alpha, min_px=3):
    on = (alpha > 40).sum(1) > min_px
    segs, s = [], None
    for i, v in enumerate(on):
        if v and s is None: s = i
        if not v and s is not None: segs.append((s, i)); s = None
    if s is not None: segs.append((s, len(on)))
    return segs


def trim(img):
    bb = img.getbbox()
    return img.crop(bb) if bb else img


def main():
    yard, path = sys.argv[1], sys.argv[2]
    cuts = None
    if '--cuts' in sys.argv:
        cuts = [int(v) for v in sys.argv[sys.argv.index('--cuts') + 1].split(',')]
    a = key_magenta(np.array(Image.open(path).convert('RGBA')))
    if cuts:
        top, s0, f0 = cuts
        on = bands(a[..., 3])
        end = on[-1][1]
        parts = [(top, s0), (s0, f0), (f0, end)]
    else:
        parts = bands(a[..., 3])
        if len(parts) != 3:
            sys.exit(f'{path}: {len(parts)} parts, not 3 — pass --cuts')
    ims = [trim(Image.fromarray(a[y0:y1])) for y0, y1 in parts]
    k = FOOT_W / ims[2].width          # one scale for all three: the foot FOOT_W wide
    for name, im in zip(('mount', 'strut', 'foot'), ims):
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        out = os.path.join(ROOT, 'art', f'gear_{yard}_{name}.png')
        im.save(out, optimize=True)
        print(out, im.size)


if __name__ == '__main__':
    main()
