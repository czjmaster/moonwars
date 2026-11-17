#!/usr/bin/env python3
"""MOON WARS — update236, step 1: GPT's open TERRA hulls -> cut-away (A) + composed exterior (B) for fit_gpt_hull.py

    python3 tools/terra_v18/prep.py <plates.png> <work_dir> key=hull.png [key=hull.png ...]

As tools/aquarius_v17/prep.py (update235): GPT drew each hull OPEN (modules flat blue, shaft green, gear wells
magenta); the closed hull is composed from the Terra plates v6 (A1/A2 like a chessboard, the shaft plate a deck each;
the sheet 1536 x 1024: A1, A2, shaft, hangar at x4). The wells -> flat yellow (wells.py finds them after the fit).
The stern drums (NOZ, rows in GPT's picture) get a magenta triangle each (update177's marker for the flames).
"""
import sys, json, os, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
PL = sys.argv[1]; OUT = os.path.join(sys.argv[2], ''); os.makedirs(OUT, exist_ok=True)
YEL = (255, 230, 0)
plates = Image.open(PL).convert('RGB')
c = lambda b, i=2: plates.crop((b[0] + i, b[1] + i, b[0] + b[2] - i, b[1] + b[3] - i))
A1 = c((59, 59, 400, 280)); A2 = c((537, 59, 401, 280)); SH = c((1018, 59, 121, 280))

def comps(m, mn=800):
    lab, n = nd.label(m)
    return [(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop) for k, sl in enumerate(nd.find_objects(lab)) if (lab[sl] == k + 1).sum() > mn]

NOZ = {  # the stern drums' centre rows in GPT's picture (Terra staggers them deck by deck)
    'scout': [422, 585], 'enemy_montu': [419, 593], 'customs_cruiser': [335, 641], 'enemy_khnum': [294, 438, 578],
    'hauler': [425, 581],          # update238: measured on the drums' faces (jj: the top flame stuck out above its drum)
}
def nozzles(solid, key):
    out = []
    for y in NOZ.get(key, []):
        band = solid[y - 10:y + 11]; xs = [int(np.argmax(r)) for r in band if r.any()]
        out.append((min(xs), y))
    return out

def prep(key, f):
    im = Image.open(f).convert('RGB'); a = np.array(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = (r > 180) & (b > 180) & (g < 120)
    blue = (b > 200) & (r < 90) & (g < 120) & (b - g > 120); green = (g > 180) & (r < 120) & (b < 160)
    wells = comps(mag)
    A = a.copy()
    A[nd.binary_dilation(mag, iterations=2) & (r > g + 60) & (b > g + 60)] = YEL
    A[mag] = YEL
    bg = a[5, 5]; d = np.sqrt(((a - bg) ** 2).sum(-1)); solid = d > 30
    mods = sorted(comps(blue, 3000), key=lambda q: (q[1], q[0]))
    Ai = Image.fromarray(A.astype('uint8')); dr = ImageDraw.Draw(Ai)
    noz = nozzles(solid, key)
    for x, y in noz: dr.polygon([(x - 1, y - 14), (x - 1, y + 14), (x - 20, y)], fill=(255, 0, 255))
    A = np.array(Ai).astype(int)
    B = Image.fromarray(A.astype('uint8'))
    ys = sorted({q[1] for q in mods}); xs = sorted({q[0] for q in mods})
    for (x0, y0, x1, y1) in mods:
        i = xs.index(x0) + ys.index(y0)
        B.paste((A1 if i % 2 == 0 else A2).resize((x1 - x0 + 2, y1 - y0 + 2), Image.LANCZOS), (x0 - 1, y0 - 1))
    deck_h = np.median([q[3] - q[1] for q in mods])
    for (x0, y0, x1, y1) in comps(green, 3000):
        n = max(1, round((y1 - y0) / deck_h)); hh = (y1 - y0 + 2) / n
        for k in range(n):
            B.paste(SH.resize((x1 - x0 + 2, round(hh)), Image.LANCZOS), (x0 - 1, round(y0 - 1 + k * hh)))
    Ai.save(OUT + f'{key}_A.png'); B.save(OUT + f'{key}_B.png')
    json.dump({'wells': wells, 'nozzles': noz, 'mods': mods}, open(OUT + f'{key}_prep.json', 'w'))
    print(key, 'wells', wells, 'nozzles', noz, 'mods', len(mods))

for kv in sys.argv[3:]:
    k, f = kv.split('=', 1); prep(k, f)
