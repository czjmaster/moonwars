#!/usr/bin/env python3
"""MOON WARS — a case and one piece from GPT into the game (update271).

    python3 tools/cut_box.py <name> <case.png> <one.png> <cells_wide> [<n_nests>]

Writes art/item_<name>_case.png (320 px a cell wide) and art/item_<name>_one.png
(the background — flat MAGENTA or transparent — taken out, cut to its own
pixels), adds both to art/manifest.json, and prints the case's NESTS: the dark,
empty bays found in the picture, as [x, y, w, h] fractions of the case, left to
right — what goes into ITEM_BOX in js/cargo.js.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut_gear import key_magenta  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def keyed(path):
    a = np.array(Image.open(path).convert('RGBA'))
    if (a[..., 3] > 250).mean() > 0.97:
        a = key_magenta(a)
    bb = Image.fromarray((a[..., 3] > 16).astype(np.uint8) * 255).getbbox()
    return Image.fromarray(a).crop(bb)


def add_to_manifest(names):
    mp = os.path.join(ROOT, 'art', 'manifest.json')
    m = json.load(open(mp))
    ch = False
    for n in names:
        if n not in m['sprites']:
            m['sprites'].append(n); ch = True
    if ch:
        with open(mp, 'w') as f:
            json.dump(m, f, indent=2, ensure_ascii=False); f.write('\n')


def nests(im, n):
    """The n largest dark bays, left to right, as fractions of the picture."""
    a = np.array(im.convert('RGBA')).astype(int)
    lum = (a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11)
    dark = (lum < 48) & (a[..., 3] > 200)
    dark = ndimage.binary_opening(dark, iterations=2)
    lab, k = ndimage.label(dark)
    if not k:
        return []
    sizes = ndimage.sum(dark, lab, range(1, k + 1))
    keep = np.argsort(sizes)[::-1][:n] + 1
    out = []
    for i in keep:
        ys, xs = np.where(lab == i)
        out.append([xs.min() / im.width, ys.min() / im.height,
                    (xs.max() - xs.min() + 1) / im.width, (ys.max() - ys.min() + 1) / im.height])
    out.sort(key=lambda r: r[0])
    return [[round(v, 3) for v in r] for r in out]


def main():
    name, case_p, one_p, cells = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    n = int(sys.argv[5]) if len(sys.argv) > 5 else cells
    case = keyed(case_p)
    w = 320 * cells
    case = case.resize((w, max(1, round(case.height * w / case.width))), Image.LANCZOS)
    one = keyed(one_p)
    ow = 240
    one = one.resize((ow, max(1, round(one.height * ow / one.width))), Image.LANCZOS)
    cn, on = f'item_{name}_case', f'item_{name}_one'
    case.save(os.path.join(ROOT, 'art', cn + '.png'), optimize=True)
    one.save(os.path.join(ROOT, 'art', on + '.png'), optimize=True)
    add_to_manifest([cn, on])
    print(cn, case.size, on, one.size)
    print('nests:', json.dumps(nests(case, n)))


if __name__ == '__main__':
    main()
