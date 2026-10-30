#!/usr/bin/env python3
"""MOON WARS — the skeleton GPT draws a whole ship on (prompts v3, update177).

    python3 tools/gen_gpt_skeleton.py <out_dir> <key> [<key> ...] [--scale S]

--scale S   px per grid unit (update178): 2.18 is what Terra was drawn at —
            pass it so every yard's ships come out the same size.
A STATION (bunker, mech, boss station — `isStation`) stands on the ground:
no stern or bow, a field of 50 units each side and 45 on top, 20 under her,
no landing pads and no airlock; the gun mounts as for a ship.

For every hull key in SHIP_LAYOUTS writes <out_dir>/skeleton_<key>_<Label>.png,
1536 x 1024, the stern on the LEFT (the player's view; the game mirrors the
enemy):

  dark background      flat, one colour
  lighter field        flat, one colour: where GPT may draw the SHAPE —
                       90 units behind the stern, 100 in front of the bow,
                       45 above and below the decks; a dashed frame round it
                       and a cyan arrow at each end (stern < , bow >)
  BLUE rectangles      the modules, exactly the game's rooms, a thin dark seam
                       between two that touch (GPT draws one post there)
  GREEN rectangle      the lift shaft (30 units wide, over every deck it serves)
  orange bar on top    a flat mount for a gun, one per weapon slot, over the
                       top deck
  3 orange marks under the keel: flat landing pads (the game draws the legs)
  cyan square at bow   the airlock the dock's jet bridge meets: the lowest
                       deck that reaches the bow

tools/fit_gpt_hull.py reads what GPT draws on it: it finds the blue and green
rectangles and the flat field (the colours here are the ones it looks for).
Every skeleton of a run is drawn at ONE scale, so ships keep their sizes
against each other.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1536, 1024
STERN, BOW, PAD_Y = 90, 100, 45      # the field round the decks, grid units
SHAFT_W = 30
SEAM = 3                             # px of dark between two touching modules (each side)

BG = (13, 16, 24)
FIELD = (26, 32, 46)
DASH = (36, 45, 65)                  # fit_gpt_hull.py: the dashed frame's grey-blue
BLUE = (30, 80, 230)                 # fit_gpt_hull.py: b>200, r<90, g<120, b-g>120
GREEN = (40, 205, 90)                # fit_gpt_hull.py: g>180, r<120, b<160
ORANGE = (255, 140, 20)
CYAN = (60, 190, 235)                # fit_gpt_hull.py: the arrows are dropped as cyan


def layouts(keys):
    js = ("const h=require('./tests/harness.js');const sb=h.loadEngine();const out={};"
          f"for(const k of {json.dumps(keys)}){{const L=sb.SHIP_LAYOUTS[k];if(!L){{out[k]=null;continue;}}"
          "out[k]={label:L.label,builder:L.builder,slots:L.weaponSlots??1,station:!!L.isStation,"
          "rooms:L.rooms.map(r=>({x:r.x,y:r.y,w:r.w,h:r.h})),"
          "shafts:(L.elevators??[]).map(e=>({x:e.x,floors:e.floors}))};}"
          "console.log(JSON.stringify(out))")
    p = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True)
    if p.returncode:
        sys.exit(p.stderr)
    return json.loads(p.stdout.strip().splitlines()[-1])


def field(L):
    """(stern, bow, top, bottom) of the free field round her, grid units."""
    return (50, 50, PAD_Y, 20) if L.get('station') else (STERN, BOW, PAD_Y, PAD_Y)


def bounds(L):
    x0 = min(r['x'] for r in L['rooms']); x1 = max(r['x'] + r['w'] for r in L['rooms'])
    y0 = min(r['y'] for r in L['rooms']); y1 = max(r['y'] + r['h'] for r in L['rooms'])
    return x0, y0, x1, y1


def decks(L):
    """Each deck: its y, height and x span, top deck first."""
    by = {}
    for r in L['rooms']:
        d = by.setdefault((r['y'], r['h']), [r['x'], r['x'] + r['w']])
        d[0] = min(d[0], r['x']); d[1] = max(d[1], r['x'] + r['w'])
    return [{'y': y, 'h': h, 'x0': a, 'x1': b} for (y, h), (a, b) in sorted(by.items())]


def dashed(d, box, on=14, off=10, width=2):
    x0, y0, x1, y1 = box
    for (ax, ay, bx, by) in ((x0, y0, x1, y0), (x0, y1, x1, y1), (x0, y0, x0, y1), (x1, y0, x1, y1)):
        n = max(abs(bx - ax), abs(by - ay)); t = 0
        while t < n:
            e = min(t + on, n)
            if ay == by: d.line([(ax + t, ay), (ax + e, ay)], fill=DASH, width=width)
            else: d.line([(ax, ay + t), (ax, ay + e)], fill=DASH, width=width)
            t += on + off


def draw(L, s):
    x0, y0, x1, y1 = bounds(L)
    fs, fb, ft, fd = field(L)
    fw, fh = (x1 - x0 + fs + fb) * s, (y1 - y0 + ft + fd) * s
    ox = (W - fw) / 2 + fs * s - x0 * s             # picture px of grid x = 0
    oy = (H - fh) / 2 + ft * s - y0 * s
    P = lambda x, y: (round(ox + x * s), round(oy + y * s))

    img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img)
    fx0, fy0 = P(x0 - fs, y0 - ft); fx1, fy1 = P(x1 + fb, y1 + fd)
    d.rectangle([fx0, fy0, fx1, fy1], fill=FIELD)
    dashed(d, (fx0, fy0, fx1, fy1))
    # the arrows: stern < at the left end, bow > at the right, just outside the field
    cy = (fy0 + fy1) // 2; a = 16
    if L.get('station'): a = 0
    if a:
        d.polygon([(fx1 + 10 + a, cy), (fx1 + 10, cy - a // 2 - 2), (fx1 + 10, cy + a // 2 + 2)], fill=CYAN)
        d.polygon([(fx0 - 10 - a, cy), (fx0 - 10, cy - a // 2 - 2), (fx0 - 10, cy + a // 2 + 2)], fill=CYAN)

    # modules
    for r in L['rooms']:
        a0 = P(r['x'], r['y']); a1 = P(r['x'] + r['w'], r['y'] + r['h'])
        d.rectangle([a0[0] + SEAM, a0[1] + SEAM, a1[0] - SEAM - 1, a1[1] - SEAM - 1], fill=BLUE)
    # the lift shaft: over every deck it serves
    for sh in L['shafts']:
        top = min(f for f in sh['floors']); bot = max(f for f in sh['floors'])
        ds = [dk for dk in decks(L) if dk['y'] <= top <= dk['y'] + dk['h'] or dk['y'] <= bot <= dk['y'] + dk['h']]
        ya = min(dk['y'] for dk in ds) if ds else top - 35
        yb = max(dk['y'] + dk['h'] for dk in ds) if ds else bot + 35
        a0 = P(sh['x'] - SHAFT_W / 2, ya); a1 = P(sh['x'] + SHAFT_W / 2, yb)
        d.rectangle([a0[0] + SEAM, a0[1] + SEAM, a1[0] - SEAM - 1, a1[1] - SEAM - 1], fill=GREEN)

    dk = decks(L); top, low = dk[0], dk[-1]
    # gun mounts: over the top deck, one per weapon slot
    n = max(1, L['slots'])
    for i in range(n):
        cx = top['x0'] + (top['x1'] - top['x0']) * (i + 1) / (n + 1)
        a0 = P(cx - 22, top['y'] - 22); a1 = P(cx + 22, top['y'] - 16)
        d.rectangle([a0, a1], fill=ORANGE)
    if L.get('station'):
        return img
    # landing pads: three under the keel
    for f in (0.18, 0.5, 0.82):
        cx = x0 + (x1 - x0) * f
        a0 = P(cx - 10, y1 + 16); a1 = P(cx + 10, y1 + 22)
        d.rectangle([a0, a1], fill=ORANGE)
    # the airlock: the lowest deck that reaches the bow
    reach = [k for k in dk if k['x1'] >= x1 - 1]
    al = reach[-1] if reach else low
    my = al['y'] + al['h'] / 2
    a0 = P(al['x1'] + 6, my - 9); a1 = P(al['x1'] + 24, my + 9)
    d.rectangle([a0, a1], fill=CYAN)
    return img


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    args = sys.argv[1:]
    fixed = None
    if '--scale' in args:
        i = args.index('--scale'); fixed = float(args[i + 1]); del args[i:i + 2]
    out, keys = args[0], args[1:]
    Ls = layouts(keys)
    bad = [k for k, v in Ls.items() if v is None]
    if bad:
        sys.exit('no such hull: ' + ', '.join(bad))
    # one scale for the run: the widest and the tallest field fill ~88 % / ~80 %
    sw = min(W * 0.88 / (bounds(L)[2] - bounds(L)[0] + field(L)[0] + field(L)[1]) for L in Ls.values())
    sh = min(H * 0.94 / (bounds(L)[3] - bounds(L)[1] + field(L)[2] + field(L)[3]) for L in Ls.values())
    s = fixed or min(sw, sh)
    if s > min(sw, sh) + 1e-9:
        sys.exit(f'--scale {s} is too big for these hulls (at most {min(sw, sh):.3f})')
    os.makedirs(out, exist_ok=True)
    for k, L in Ls.items():
        p = os.path.join(out, f"skeleton_{k}_{L['label']}.png")
        draw(L, s).save(p)
        print(p, f"scale {s:.3f} px/unit")


if __name__ == '__main__':
    main()
