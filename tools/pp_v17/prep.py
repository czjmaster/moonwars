#!/usr/bin/env python3
"""MOON WARS — update249, step 1 for PEGASUS and PHOENIX (GPT v17): an open hull -> cut-away (A) + closed (B) for fit_gpt_hull.py

    python3 tools/pp_v17/prep.py <plates.png> <work_dir> key=hull.png [key=hull.png ...]

As tools/terra_v18/prep.py, but:
  * the plates sheet is found, not read at fixed boxes (GPT moved and grew them): the four parts on magenta, top row
    A1, A2, shaft, the long one below = the hangar;
  * the stern nozzles are found, not typed: one engine on every deck that reaches the stern, at the deck's middle row,
    the triangle at the first solid pixel of that row (Pegasus and Phoenix draw one engine block per deck).
"""
import sys, json, os, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
PL = sys.argv[1]; OUT = os.path.join(sys.argv[2], ''); os.makedirs(OUT, exist_ok=True)
YEL = (255, 230, 0)
ALL_DECKS = {'enemy_geb'}      # Geb (Terra) has a drum on her short top deck too, at its step

def comps(m, mn=800):
    lab, n = nd.label(m)
    return [(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop) for k, sl in enumerate(nd.find_objects(lab)) if (lab[sl] == k + 1).sum() > mn]

def plates(path, inset=5):
    im = Image.open(path).convert('RGB'); a = np.array(im).astype(int)
    mag = (np.abs(a - np.array((255, 0, 255))).sum(-1) < 150)
    parts = sorted(comps(~mag, 5000), key=lambda q: (q[1] // 200, q[0]))
    if len(parts) != 4: sys.exit(f'plates: {len(parts)} parts, want 4')
    c = lambda b: im.crop((b[0] + inset, b[1] + inset, b[2] - inset, b[3] - inset))
    return c(parts[0]), c(parts[1]), c(parts[2]), c(parts[3])
A1, A2, SH, HG = plates(PL)

def prep(key, f):
    im = Image.open(f).convert('RGB'); a = np.array(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = (r > 180) & (b > 180) & (g < 120)
    blue = (b > 200) & (r < 90) & (g < 120) & (b - g > 120); green = (g > 180) & (r < 120) & (b < 160)
    wells = comps(mag)
    A = a.copy()
    A[nd.binary_dilation(mag, iterations=2) & (r > g + 60) & (b > g + 60)] = YEL
    A[mag] = YEL
    bg = np.median(np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3)]), axis=0)
    d = np.sqrt(((a - bg) ** 2).sum(-1)); solid = d > 30
    mods = sorted(comps(blue, 3000), key=lambda q: (q[1], q[0]))
    # the stern engines: every deck whose first module starts at the stern
    x_stern = min(q[0] for q in mods); decks = {}
    for q in mods:
        decks.setdefault(round(q[1] / 40), []).append(q)
    noz = []
    if not key.startswith('boss') and not key.startswith('bunker'):
        for rows in decks.values():
            q = min(rows, key=lambda t: t[0])
            if q[0] - x_stern > 40 and key not in ALL_DECKS: continue
            y = (q[1] + q[3]) // 2; band = solid[y - 10:y + 11]
            xs = [int(np.argmax(rw)) for rw in band if rw.any()]
            noz.append((min(xs), y))
    Ai = Image.fromarray(A.astype('uint8')); dr = ImageDraw.Draw(Ai)
    for x, y in noz: dr.polygon([(x - 1, y - 14), (x - 1, y + 14), (x - 20, y)], fill=(255, 0, 255))
    A = np.array(Ai).astype(int)
    B = Image.fromarray(A.astype('uint8'))
    deck_h = np.median([q[3] - q[1] for q in mods]); mod_w = np.median([q[2] - q[0] for q in mods])
    ys = sorted({q[1] for q in mods}); i = 0
    for (x0, y0, x1, y1) in mods:
        if x1 - x0 > 1.6 * mod_w: p = HG
        else: p = A1 if i % 2 == 0 else A2; i += 1
        B.paste(p.resize((x1 - x0 + 2, y1 - y0 + 2), Image.LANCZOS), (x0 - 1, y0 - 1))
    for (x0, y0, x1, y1) in comps(green, 3000):
        n = max(1, round((y1 - y0) / deck_h)); hh = (y1 - y0 + 2) / n
        for k in range(n):
            B.paste(SH.resize((x1 - x0 + 2, round(hh)), Image.LANCZOS), (x0 - 1, round(y0 - 1 + k * hh)))
    Ai.save(OUT + f'{key}_A.png'); B.save(OUT + f'{key}_B.png')
    json.dump({'wells': wells, 'nozzles': noz, 'mods': mods}, open(OUT + f'{key}_prep.json', 'w'))
    print(key, 'wells', len(wells), 'nozzles', noz, 'mods', len(mods))

for kv in sys.argv[3:]:
    k, f = kv.split('=', 1); prep(k, f)
