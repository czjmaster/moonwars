#!/usr/bin/env python3
"""MOON WARS — a SHAPED hull's pictures into art/ (update175).

    python3 tools/gen_shaped_hull_art.py <key> <hull_in.png> <hull_out.png> \
            --org OX,OY [--src-scale S]

<hull_in.png> / <hull_out.png> are the layers mock/warp2.py writes
(`<prefix>_hull_in.png`, `<prefix>_hull_out.png`): the cut-away with the
windows transparent, and the closed armour over the same outline.

  --org OX,OY     where the corner of the ROOM BOX (top-left of the
                  modules) sits in those pictures, in their pixels
  --src-scale S   their pixels per grid unit (default 1.5 — already the
                  game's; the mock-ups were 2 × 1.5 = 3)

Writes, at 1.5 px per grid unit (one grid unit on the Full HD screen):

    art/hull_<key>.png            cut-away, stern left (flown by you)
    art/hull_<key>_roof.png       armour,   stern left
    art/hull_<key>_enemy.png      both mirrored: their bow points left
    art/hull_<key>_enemy_roof.png

puts all four into art/manifest.json, and writes the hull's size and
ORG into HULL_SHAPED in js/ship.js — which is what makes the game use
them. It refuses pictures that do not fit the hull: a window not over
every module, or armour not closing every one.
"""
import argparse, json, os, re, subprocess, sys
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCALE = 1.5

def layout(key):
    js = ("const h=require('./tests/harness.js');const sb=h.loadEngine();"
          f"const L=sb.SHIP_LAYOUTS[{json.dumps(key)}];if(!L){{console.log('null');process.exit(0)}}"
          "console.log(JSON.stringify({rooms:L.rooms.map(r=>({x:r.x,y:r.y,w:r.w,h:r.h})),"
          "shafts:(L.elevators??[]).map(e=>e.x)}))")
    out = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True).stdout
    return json.loads(out.strip().splitlines()[-1])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('key'); ap.add_argument('hull_in'); ap.add_argument('hull_out')
    ap.add_argument('--org', required=True)
    ap.add_argument('--src-scale', type=float, default=SCALE)
    a = ap.parse_args()
    L = layout(a.key)
    if not L: sys.exit(f'no hull {a.key!r} in SHIP_LAYOUTS')
    rin, rout = Image.open(a.hull_in).convert('RGBA'), Image.open(a.hull_out).convert('RGBA')
    if rin.size != rout.size: sys.exit(f'the two layers differ in size: {rin.size} vs {rout.size}')
    ox, oy = (float(v) for v in a.org.split(','))
    k = SCALE / a.src_scale
    if abs(k - 1) > 1e-9:
        size = (round(rin.width * k), round(rin.height * k))
        rin, rout = rin.resize(size, Image.LANCZOS), rout.resize(size, Image.LANCZOS)
        ox, oy = ox * k, oy * k
    ox, oy = round(ox), round(oy)
    W, H = rin.size
    x0 = min(r['x'] for r in L['rooms']); y0 = min(r['y'] for r in L['rooms'])
    bw = max(r['x'] + r['w'] for r in L['rooms']) - x0
    bh = max(r['y'] + r['h'] for r in L['rooms']) - y0
    if ox < 0 or oy < 0 or ox + bw * SCALE > W or oy + bh * SCALE > H:
        sys.exit(f'the modules ({bw}x{bh} units at {ox},{oy}) run off the {W}x{H} picture')

    # Every module: a window in the cut-away, armour on the roof.
    ai, ao = np.array(rin)[:, :, 3], np.array(rout)[:, :, 3]
    bad = []
    for r in L['rooms']:
        px = ox + (r['x'] - x0) * SCALE; py = oy + (r['y'] - y0) * SCALE
        cx0, cx1 = int(px + r['w'] * SCALE * 0.3), int(px + r['w'] * SCALE * 0.7)
        cy0, cy1 = int(py + r['h'] * SCALE * 0.3), int(py + r['h'] * SCALE * 0.7)
        win, arm = ai[cy0:cy1, cx0:cx1].mean(), ao[cy0:cy1, cx0:cx1].mean()
        if win > 40: bad.append(f"module at {r['x']},{r['y']} not a window (alpha {win:.0f})")
        if arm < 215: bad.append(f"module at {r['x']},{r['y']} open on the roof (alpha {arm:.0f})")
    if bad: sys.exit('refused:\n  ' + '\n  '.join(bad))

    art = os.path.join(ROOT, 'art')
    names = {f'hull_{a.key}': rin, f'hull_{a.key}_roof': rout,
             f'hull_{a.key}_enemy': rin.transpose(Image.FLIP_LEFT_RIGHT),
             f'hull_{a.key}_enemy_roof': rout.transpose(Image.FLIP_LEFT_RIGHT)}
    for n, im in names.items():
        im.save(os.path.join(art, n + '.png'), optimize=True)
        print(f'  art/{n}.png  {im.width}x{im.height}')

    man_path = os.path.join(art, 'manifest.json')
    man = json.load(open(man_path, encoding='utf8'))
    # the four names listed, the rest of the list left as it is (and in its order)
    man['sprites'] += [n for n in names if n not in man['sprites']]
    open(man_path, 'w', encoding='utf8').write(json.dumps(man, indent=2, ensure_ascii=False) + '\n')

    # The hull's entry in HULL_SHAPED, js/ship.js.
    sp = os.path.join(ROOT, 'js', 'ship.js')
    src = open(sp, encoding='utf8').read()
    m = re.search(r'const HULL_SHAPED = \{\n(.*?)\n\};', src, re.S)
    if not m: sys.exit('HULL_SHAPED not found in js/ship.js')
    lines = [l for l in m.group(1).split('\n') if not re.match(rf'\s*{re.escape(a.key)}\s*:', l)]
    lines.append(f'  {a.key}: {{ w: {W}, h: {H}, ox: {ox}, oy: {oy} }},')
    src = src[:m.start(1)] + '\n'.join(lines) + src[m.end(1):]
    open(sp, 'w', encoding='utf8').write(src)
    print(f'HULL_SHAPED.{a.key} = {{ w: {W}, h: {H}, ox: {ox}, oy: {oy} }}  '
          f'(shape {W / SCALE:.0f}x{H / SCALE:.0f} units round modules {bw}x{bh})')

if __name__ == '__main__':
    main()
