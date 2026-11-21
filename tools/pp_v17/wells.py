#!/usr/bin/env python3
"""MOON WARS — update249 (Pegasus / Phoenix; from tools/terra_v18/wells.py), step 3: after fit_gpt_hull.py the yellow wells
get the yard's gear, and the yard's gear art is written.

    python3 tools/pp_v17/wells.py <yard> <gear_sheet.png> <fit_dir> key [key ...]

<gear_sheet.png>: GPT's gear on the 5x guide (tools/pp_v17: mount top left, three piston stages, foot below the mount,
the assembled leg right). The parts are FOUND on the magenta. GPT drew each piston stage whole (also the part that
sleeves into the one above, about 2x the 30 u); the game draws a stage per a third of the leg, so the TOP 30 u of each
(its collar and sliding band) is kept. Writes art/gear_<yard>_{bay,pad,tube1,tube2,tube3}.png.
"""
import json, sys, os, subprocess, numpy as np
from PIL import Image
from scipy import ndimage as nd
YARD = sys.argv[1]; F = os.path.join(sys.argv[3], '')
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); ART = os.path.join(ROOT, 'art', '')
FROM_ART = sys.argv[2] == 'art'          # the yard's gear already in art/ (Terra for Geb): its bay mount and its pad
sheet = Image.open(sys.argv[2] if not FROM_ART else ART + f'gear_{YARD}_bay.png').convert('RGBA'); sa = np.array(sheet).astype(int)
magm = (np.abs(sa[..., :3] - np.array((255, 0, 255))).sum(-1) < 150)
lab, n = nd.label(~magm)
parts = sorted([(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop) for k, sl in enumerate(nd.find_objects(lab)) if (lab[sl] == k + 1).sum() > 1500])
def demag(im):
    a = np.array(im).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r > 170) & (b > 170) & (g < 130); m = nd.binary_dilation(m, iterations=1) & (r > g + 30) & (b > g + 30) | m
    a[m, 3] = 0; a[m, :3] = 12; return Image.fromarray(a.astype('uint8'))
if FROM_ART:
    MOUNT = sheet; FOOT = Image.open(ART + f'gear_{YARD}_pad.png').convert('RGBA'); tubes = []
else:
    left = [p for p in parts if p[2] < 900]
    mount = min((p for p in left if p[0] < 420), key=lambda p: p[1])            # top left
    foot = max((p for p in left if p[0] < 420), key=lambda p: p[1])             # below it
    tubes = sorted([p for p in left if p[0] >= 420], key=lambda p: -(p[2] - p[0]))   # thickest first
    mw = mount[2] - mount[0]
    MOUNT = demag(sheet.crop((mount[0], mount[1], mount[2], mount[1] + round(mw * 24 / 64))))   # the body that fills the 64x24 bay
    FOOT = demag(sheet.crop(foot))
    print(YARD, 'mount', mount, 'foot', foot, 'tubes', tubes)
out = {}
for key in sys.argv[4:]:
    ims = {nm: Image.open(F + f'{key}_hull_{nm}.png').convert('RGBA') for nm in ('in', 'out')}
    a = np.array(ims['out']).astype(int); r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    y = (r > 190) & (g > 160) & (b < 110) & (al > 60)
    lab2, _ = nd.label(y)
    boxes = sorted([(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop) for k, sl in enumerate(nd.find_objects(lab2)) if (lab2[sl] == k + 1).sum() > 200])
    wells, pads = [], []
    for (x0, y0, x1, y1) in boxes:
        w, h = x1 - x0, y1 - y0
        fh = min(h, round(w * FOOT.height / FOOT.width))
        for im in ims.values():
            A = np.array(im).astype(int)
            rr, gg, bb = A[..., 0], A[..., 1], A[..., 2]
            ring = np.zeros(rr.shape, bool); ring[y0 - 3:y1 + 3, x0 - 3:x1 + 3] = True
            yel = ring & (rr > 120) & (gg > 100) & (bb < rr - 50) & (gg > bb + 40)
            A[yel, :3] = (14, 13, 12)
            im.paste(Image.fromarray(A.astype('uint8')))
            im.alpha_composite(MOUNT.resize((w + 2, h + 1), Image.LANCZOS), (x0 - 1, y0))
            im.alpha_composite(FOOT.resize((w + 2, fh), Image.LANCZOS), (x0 - 1, y1 - fh))
        wells.append([x0, y0, x1, y1]); pads.append([x0 - 1, y1 - fh, x1 + 1, y1])
    for nm, im in ims.items(): im.save(F + f'{key}_hull_{nm}.png')
    out[key] = {'wells': wells, 'pads': pads}
    print(key, out[key])
json.dump(out, open(F + f'wells_{YARD}.json', 'w'))
if FROM_ART: tubes = None
# the yard's gear art, at the sizes the Terra set has (dockart.js scales them to the bay anyway)
if not FROM_ART:
    MOUNT.resize((192, round(192 * MOUNT.height / MOUNT.width)), Image.LANCZOS).save(ART + f'gear_{YARD}_bay.png')
    FOOT.resize((192, round(192 * FOOT.height / FOOT.width)), Image.LANCZOS).save(ART + f'gear_{YARD}_pad.png')
for i, t in enumerate((tubes or [])[:3], 1):
    tw = t[2] - t[0]; th = round(tw * 30 / (22, 16, 10)[i - 1])          # the top 30 u of the stage
    im = demag(sheet.crop((t[0], t[1], t[2], min(t[3], t[1] + th))))
    k = (22, 16, 10)[i - 1] * 3 / tw                                    # 3 px a unit, as gear_terra_tube*
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    q = np.array(im); q[..., 3] = np.where(q[..., 3] < 128, 0, 255); Image.fromarray(q).save(ART + f'gear_{YARD}_tube{i}.png')
# the cut-away's holes that are not a window: from the exterior (as Terra)
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
