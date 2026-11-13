#!/usr/bin/env python3
"""MOON WARS — update235, step 3: after fit_gpt_hull.py, the yellow wells -> the yard's gear bay

    python3 tools/aquarius_v17/wells.py <gpt_dir> <fit_dir> [key ...]

In both layers (<key>_hull_in/out.png in <fit_dir>) the bay gets GPT's mount (it fills the 64x24 bay) and the pad
tucked into its bottom; holes in the cut-away that are not a window are patched from the exterior. Writes
<fit_dir>/wells.json — `pads` and `wells` for HULL_SHAPED (gen_shaped_hull_art.py drops them: put them back).
"""
import json, sys, os, numpy as np
from PIL import Image
from scipy import ndimage as nd
F = os.path.join(sys.argv[2], '')
sheet = Image.open(os.path.join(sys.argv[1], 'Elementy_wspolne', 'Aquarius_podwozie_5x.png')).convert('RGBA')
def demag(im):
    a = np.array(im).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r > 170) & (b > 170) & (g < 130); m = nd.binary_dilation(m, iterations=1) & (r > g + 30) & (b > g + 30) | m
    a[m, 3] = 0; return Image.fromarray(a.astype('uint8'))
MOUNT = demag(sheet.crop((52, 52, 332, 158))); FOOT = demag(sheet.crop((52, 210, 332, 289)))
out = {}
for key in (sys.argv[3:] or ['frigate', 'thoth', 'enemy_ra', 'enemy_nephthys']):
    ims = {n: Image.open(F + f'{key}_hull_{n}.png').convert('RGBA') for n in ('in', 'out')}
    a = np.array(ims['out']).astype(int); r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    y = (r > 190) & (g > 160) & (b < 110) & (al > 60)
    lab, n = nd.label(y)
    boxes = sorted([(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop) for k, sl in enumerate(nd.find_objects(lab)) if (lab[sl] == k + 1).sum() > 200])
    wells, pads = [], []
    for (x0, y0, x1, y1) in boxes:
        w, h = x1 - x0, y1 - y0
        fh = round(w * FOOT.height / FOOT.width)
        for im in ims.values():
            A = np.array(im).astype(int)
            # the yellow and its fringe: the bay's dark first
            rr, gg, bb = A[..., 0], A[..., 1], A[..., 2]
            ring = np.zeros(rr.shape, bool); ring[y0 - 3:y1 + 3, x0 - 3:x1 + 3] = True
            yel = ring & (rr > 120) & (gg > 100) & (bb < rr - 50) & (gg > bb + 40)
            A[yel, :3] = (10, 16, 24)
            im.paste(Image.fromarray(A.astype('uint8')))
            m = MOUNT.resize((w + 2, h + 1), Image.LANCZOS); im.alpha_composite(m, (x0 - 1, y0))
            f = FOOT.resize((w + 2, fh), Image.LANCZOS); im.alpha_composite(f, (x0 - 1, y1 - fh))
        wells.append([x0, y0, x1, y1]); pads.append([x0 - 1, y1 - fh, x1 + 1, y1])
    for n, im in ims.items(): im.save(F + f'{key}_hull_{n}.png')
    out[key] = {'wells': wells, 'pads': pads}
    print(key, out[key])
json.dump(out, open(F + 'wells.json', 'w'))

# the cut-away's holes that are not a window (GPT's flat darks the silhouette took for space): from the exterior
import subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for key in out:
    js = ("const h=require('./tests/harness.js');const sb=h.loadEngine();const L=sb.SHIP_LAYOUTS['%s'];"
          "console.log(JSON.stringify({r:L.rooms.map(r=>[r.x,r.y,r.w,r.h]),e:(L.elevators||[]).map(e=>e.x)}))") % key
    L = json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True).stdout.strip().splitlines()[-1])
    fit = json.load(open(F + f'{key}_fit.json')); ox, oy = fit['org']
    bx0 = min(r[0] for r in L['r']); by0 = min(r[1] for r in L['r']); by1 = max(r[1] + r[3] for r in L['r'])
    I = Image.open(F + f'{key}_hull_in.png'); O = Image.open(F + f'{key}_hull_out.png')
    A = np.array(I).astype(int); B = np.array(O).astype(int)
    win = np.zeros(A.shape[:2], bool); S = 1.5
    for x, y_, w, h in L['r']:
        win[round(oy + (y_ - by0) * S) - 3:round(oy + (y_ + h - by0) * S) + 3, round(ox + (x - bx0) * S) - 3:round(ox + (x + w - bx0) * S) + 3] = True
    for ex in L['e']:
        win[round(oy) - 3:round(oy + (by1 - by0) * S) + 3, round(ox + (ex - 15 - bx0) * S) - 3:round(ox + (ex + 15 - bx0) * S) + 3] = True
    gap = (A[..., 3] < 200) & (B[..., 3] > A[..., 3] + 40) & ~win
    A[gap] = B[gap]
    Image.fromarray(A.astype('uint8')).save(F + f'{key}_hull_in.png')
    print(key, 'filled', int(gap.sum()), 'px')
