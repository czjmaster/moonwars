#!/usr/bin/env python3
"""MOON WARS — the jet bridge sheet from GPT into game sprites (update198).

    python3 tools/cut_jetbridge.py <sheet.png>

The sheet (prompt D, v5; guide_jet_bridge.png) is seven parts on flat
MAGENTA: the tube's collar at the ship, ONE repeating tube segment, the
gate end, a repeating segment of the gate's tower, and the mobile support
under the tube — the saddle clamp, the repeating piston, the wheeled base.
Writes art/jb_{collar,tube,gate,tower,clamp,piston,base}.png, keyed and
trimmed, all at one scale (the tube TUBE_H px tall).

The parts are told apart by where they sit on the sheet: the three on the
tube's row left to right, the tall one at the right, the three under the
tube top to bottom.
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut_gear import key_magenta, trim  # noqa: E402

TUBE_H = 160
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    a = key_magenta(np.array(Image.open(sys.argv[1]).convert('RGBA')))
    lab, _ = ndimage.label(ndimage.binary_closing(a[..., 3] > 40, iterations=3))
    boxes = []
    for sl in ndimage.find_objects(lab):
        x0, y0, x1, y1 = sl[1].start, sl[0].start, sl[1].stop, sl[0].stop
        if (x1 - x0) * (y1 - y0) > 2000:
            boxes.append((x0, y0, x1, y1))
    if len(boxes) != 7:
        sys.exit(f'{len(boxes)} parts on the sheet, not 7')
    tower = max(boxes, key=lambda b: (b[3] - b[1]) / max(1, b[2] - b[0]) + (b[0] > a.shape[1] * 0.6) * 10)
    rest = [b for b in boxes if b != tower]
    top = min(b[1] for b in rest)
    row = sorted([b for b in rest if b[1] < top + 40], key=lambda b: b[0])
    under = sorted([b for b in rest if b[1] >= top + 40], key=lambda b: b[1])
    if len(row) != 3 or len(under) != 3:
        sys.exit('the tube row or the support is not three parts')
    named = dict(zip(('collar', 'tube', 'gate'), row)) | {'tower': tower} | dict(zip(('clamp', 'piston', 'base'), under))
    k = TUBE_H / (named['tube'][3] - named['tube'][1])
    for n, (x0, y0, x1, y1) in named.items():
        im = trim(Image.fromarray(a[y0:y1, x0:x1]))
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        out = os.path.join(ROOT, 'art', f'jb_{n}.png')
        im.save(out, optimize=True)
        print(out, im.size)


if __name__ == '__main__':
    main()
