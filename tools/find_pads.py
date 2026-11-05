#!/usr/bin/env python3
"""MOON WARS — find the landing pads on a drawn hull's keel (update199).

    python3 tools/find_pads.py [key ...]        (no keys: every shaped hull)

jj 5.11: "na każdym kadłubie są gotowe już podwozie — chodzi o to, aby się
opuściło". The yards drew three landing pads under every keel (the
skeleton's three orange marks, at 0.18 / 0.5 / 0.82 of the decks). This
reads art/hull_<key>_roof.png, finds each pad as the flat run of the
keel nearest its mark, and writes it into HULL_SHAPED in js/ship.js:

    pads: [[x0, y0, x1, y1], ...]    picture px, flown by you (stern left)

The game cuts that piece of the picture out as her FOOT and lowers it to
the apron (DockArt). A Pegasus hull has no pads (the yard drew none): it
is skipped and keeps the yard's own gear. A pad's height is a share of its
width — each yard drew them in one proportion (PAD_H).
"""
import json, os, re, subprocess, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHIP = os.path.join(ROOT, 'js', 'ship.js')
MARKS = (0.18, 0.5, 0.82)
PAD_H = {'terra': 0.36, 'aquarius': 0.36, 'phoenix': 0.36}
# measured by hand where the keel fooled the search (update199): a pad on a
# sloped bow, pads with a lip under the sole, pads level with a pipe
OVERRIDE = {
    'scout':         [[214, 300, 283, 328], [426, 302, 491, 328], [632, 246, 694, 268]],
    'enemy_montu':   [[202, 317, 311, 359], [410, 317, 518, 363], [622, 318, 731, 359]],
    'enemy_khnum':   [[206, 403, 308, 436], [421, 403, 516, 438], [602, 394, 672, 436]],
    'enemy_gunship': [[186, 305, 298, 349], [370, 305, 481, 349], [547, 305, 657, 349]],
    'enemy_raider':  [[160, 333, 283, 379], [332, 333, 456, 379], [522, 333, 643, 379]],
}
MAX_W = 200          # px: a run wider than this is her keel, not a pad
MIN_W = 30


def hulls():
    js = ("const h=require('./tests/harness.js');const sb=h.loadEngine();const o={};"
          "for(const k of Object.keys(sb.HULL_SHAPED)){const L=sb.SHIP_LAYOUTS[k];const s=new sb.Ship(k,true,0,0);"
          "o[k]={b:L.builder,st:!!L.isStation,bw:s.roomBounds().w};}console.log(JSON.stringify(o))")
    out = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True).stdout
    return json.loads(out.strip().splitlines()[-1])


def spec(src, key):
    m = re.search(r'\n  ' + re.escape(key) + r': \{ w: (\d+), h: (\d+), ox: (\d+), oy: (\d+)', src)
    return tuple(int(v) for v in m.groups()) if m else None


def pads(key, yard, bw, ox):
    a = np.array(Image.open(os.path.join(ROOT, 'art', f'hull_{key}_roof.png')))[..., 3] > 40
    H, W = a.shape
    bottom = np.array([(np.nonzero(a[:, x])[0].max() if a[:, x].any() else -1) for x in range(W)])
    # strictly flat stretches of the keel (a pad's sole is dead level), a gap
    # of a pixel or two in one bridged
    runs, s = [], 0
    for x in range(1, W + 1):
        if x == W or bottom[x] != bottom[x - 1]:
            if x - s >= 4 and bottom[s] > 0:
                runs.append([s, x - 1, int(bottom[s])])
            s = x
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 3 and abs(r[2] - merged[-1][2]) <= 1:
            merged[-1][1] = r[1]; merged[-1][2] = max(merged[-1][2], r[2])
        else:
            merged.append(r)
    runs = [tuple(r) for r in merged if MIN_W <= r[1] - r[0] + 1 <= MAX_W]
    out = []
    for f in MARKS:
        p = ox + bw * f * 1.5
        if not runs:
            return []
        r = min(runs, key=lambda r: 0 if r[0] <= p <= r[1] else min(abs(r[0] - p), abs(r[1] - p)))
        if (min(abs(r[0] - p), abs(r[1] - p)) > 90 and not r[0] <= p <= r[1]) or r in [tuple(o[:1]) for o in out]:
            return []
        x0, x1, b = r
        # the sole is the flat bottom of a pad; its sides slope up to her keel
        # line — walk out along them until the outline runs level again
        def walk(x, step):
            while 0 < x + step < W - 5:
                nx = x + step
                if bottom[nx] < 0: break
                level = all(bottom[nx + step * i] == bottom[nx] for i in range(4) if 0 <= nx + step * i < W)
                if level and bottom[nx] <= b - 6: break
                if bottom[nx] > bottom[x] + 2: break          # going down again: not her side any more
                x = nx
            return x
        x0, x1 = walk(x0, -1), walk(x1, 1)
        if x1 - x0 > MAX_W + 40:
            return []
        h = round((x1 - x0) * PAD_H[yard])
        out.append([int(x0), int(b - h), int(x1 + 1), int(b + 1)])
    if len({o[0] for o in out}) < len(out):
        return []
    return out


def main():
    src = open(SHIP).read()
    H = hulls()
    keys = sys.argv[1:] or list(H)
    for k in keys:
        h = H[k]
        if h['b'] == 'pegasus' or h['st'] or h['b'] not in PAD_H:
            print(f'{k}: {h["b"]}{" station" if h["st"] else ""} — no pads, the yard\'s gear')
            continue
        sp = spec(src, k)
        P = OVERRIDE.get(k) or pads(k, h['b'], h['bw'], sp[2])
        if not P:
            print(f'{k}: pads not found — the yard\'s gear')
            continue
        head = f'\n  {k}: {{ w: {sp[0]}, h: {sp[1]}, ox: {sp[2]}, oy: {sp[3]},'
        src = re.sub(re.escape(head) + r'(\n    pads: \[[^\n]*\],)?', head + f'\n    pads: {json.dumps(P)},', src, count=1)
        print(f'{k}: pads {P}')
    open(SHIP, 'w').write(src)


if __name__ == '__main__':
    main()
