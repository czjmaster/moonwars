#!/usr/bin/env python3
"""MOON WARS — an item picture from GPT into the game (update199).

    python3 tools/cut_item.py <cargo_key> <picture.png> [<cargo_key> <picture.png> ...]

Writes art/item_<name>.png — the background (transparent, or flat MAGENTA)
taken out, cut to the item's own pixels, 320 px wide like every item_*
picture — and adds it to art/manifest.json. <name> is the cargo key, or
the gas containers' picture names (ITEM_ART in js/cargo.js):

    he2_small → item_he2_small     air_small → item_air_small
    he2_med   → item_he2           air_med   → item_air_med
    he2_large → item_he2_large     air_large → item_air_large

The hold draws it in the item's cells, upright when the cells are tall and
the picture wide (Renderer.drawItemArt).
"""
import json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut_gear import key_magenta  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES = {'he2_small': 'item_he2_small', 'he2_med': 'item_he2', 'he2_large': 'item_he2_large',
         'air_small': 'item_air_small', 'air_med': 'item_air_med', 'air_large': 'item_air_large'}
WIDTH = 320


def cut(key, path):
    a = np.array(Image.open(path).convert('RGBA'))
    if (a[..., 3] > 250).mean() > 0.97:             # no transparency: a flat background to key out
        a = key_magenta(a)
        if (a[..., 3] > 250).mean() > 0.97:         # not magenta either: the corner colour
            c = a[:6, :6, :3].reshape(-1, 3).mean(0)
            d = np.abs(a[..., :3].astype(int) - c).sum(2)
            a[..., 3] = np.where(d < 30, 0, 255).astype(np.uint8)
    im = Image.fromarray(a)
    bb = Image.fromarray((a[..., 3] > 16).astype(np.uint8) * 255).getbbox()
    im = im.crop(bb)
    im = im.resize((WIDTH, max(1, round(im.height * WIDTH / im.width))), Image.LANCZOS)
    name = NAMES.get(key, 'item_' + key)
    im.save(os.path.join(ROOT, 'art', name + '.png'), optimize=True)
    mp = os.path.join(ROOT, 'art', 'manifest.json')
    m = json.load(open(mp))
    if name not in m['sprites']:
        m['sprites'].append(name)
        with open(mp, 'w') as f:
            json.dump(m, f, indent=2, ensure_ascii=False); f.write('\n')
    print(name, im.size)


if __name__ == '__main__':
    args = sys.argv[1:]
    for k, p in zip(args[::2], args[1::2]):
        cut(k, p)
