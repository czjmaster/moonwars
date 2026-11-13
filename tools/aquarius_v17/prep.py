#!/usr/bin/env python3
"""MOON WARS — update235, step 1: GPT's open Aquarius hulls -> cut-away (A) + composed exterior (B) for fit_gpt_hull.py

    python3 tools/aquarius_v17/prep.py <gpt_dir> <work_dir> [key ...]

<gpt_dir> is jj's zip unpacked (Kadluby/, Elementy_wspolne/). GPT drew each hull OPEN only (modules flat blue, shaft
green, gear wells magenta); the closed hull is composed here from the armour plates (A1/A2 like a chessboard, the
shaft plate a deck each). The wells become flat yellow (found again after the fit by wells.py); a magenta triangle
at each stern nozzle is the marker fit_gpt_hull.py reads the flames from (update177). See HANDOFF 5-0 (update235).
"""
import sys, json, os, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
Z = os.path.join(sys.argv[1], ''); OUT = os.path.join(sys.argv[2], ''); os.makedirs(OUT, exist_ok=True)
SHIPS = {  # key: (file, nozzle centre ys in source px)
    'frigate':        ('Kadluby/Aquarius_kadlub_dwa_szyby_v3.png',    [300, 438, 583]),
    'thoth':          ('Kadluby/Aquarius_kadlub_wysunieta_rufa_v2.png', [300, 593]),
    'enemy_ra':       ('Kadluby/Aquarius_kadlub_glebokie_wciecie_v2.png', [300, 448, 590]),
    'enemy_nephthys': ('Kadluby/Aquarius_kadlub_dwa_poklady_v3.png',  [298, 588]),
}
YEL = (255, 230, 0)
plates = Image.open(Z + 'Elementy_wspolne/Aquarius_plyty_pancerza.png').convert('RGB')
c = lambda b, i=3: plates.crop((b[0] + i, b[1] + i, b[0] + b[2] - i, b[1] + b[3] - i))
A1 = c((59, 70, 402, 281)); A2 = c((540, 70, 401, 281)); SH = c((1020, 70, 119, 281))

def comps(m, mn=800):
    lab, n = nd.label(m)
    return [(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop) for k, sl in enumerate(nd.find_objects(lab)) if (lab[sl] == k + 1).sum() > mn]

def prep(key):
    f, nys = SHIPS[key]
    im = Image.open(Z + f).convert('RGB'); a = np.array(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = (r > 180) & (b > 180) & (g < 120)
    blue = (b > 200) & (r < 90) & (g < 120) & (b - g > 120); green = (g > 180) & (r < 120) & (b < 160)
    wells = comps(mag)
    # the wells: flat yellow (found again after the warp); their pink fringe too
    A = a.copy()
    A[nd.binary_dilation(mag, iterations=2) & (r > g + 60) & (b > g + 60)] = YEL
    A[mag] = YEL
    # the nozzles: a magenta triangle pointing aft at each drum's face
    bg = a[5, 5]; d = np.sqrt(((a - bg) ** 2).sum(-1)); solid = d > 30
    Ai = Image.fromarray(A.astype('uint8')); dr = ImageDraw.Draw(Ai)
    noz = []
    for y in nys:
        row = solid[y - 3:y + 4].any(axis=0); x = int(np.argmax(row))
        dr.polygon([(x - 1, y - 14), (x - 1, y + 14), (x - 20, y)], fill=(255, 0, 255)); noz.append((x, y))
    A = np.array(Ai).astype(int)
    # the exterior: plates over the modules (A1/A2 like a chessboard), shaft plates a deck each
    B = Image.fromarray(A.astype('uint8'))
    mods = sorted(comps(blue, 3000), key=lambda q: (q[1], q[0]))
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

for k in (sys.argv[3:] or SHIPS): prep(k)
