#!/usr/bin/env python3
"""MOON WARS — update248: the hull BLUEPRINTS of the new standard (13.11), for GPT to draw a hull round.

    python3 tools/blueprint_v2.py <out_dir> <key>[:<Label>] [...]      a hull of SHIP_LAYOUTS
    python3 tools/blueprint_v2.py <out_dir> carrier:<name>:<Label>      one of CARRIERS below (no layout in the game yet)

1536 x 1024 at 2.18 px a grid unit (Terra and Aquarius were drawn at it), the stern on the LEFT:
  dark background          flat
  BLUE fields              the modules, 100 x 70 u (50 the room + 20 the duct), exactly the game's rooms — a hangar is
                           ONE field 200 x 70; a 2 px dark line between two that touch (no beams)
  GREEN strip              the lift shaft, 30 u, over every deck it serves
  CYAN bar on the roof     the bridge canopy: over the top deck's STERN-MOST module (the standard: the bridge on top at
                           the back — the game swaps its helm there when the hull comes in)
  ORANGE bars on the roof  a gun socket over every other module of the top deck
  MAGENTA wells            landing-gear bays 64 x 24 u (top corners cut) under the bottom deck, below an 8 u keel band:
                           2 when the bottom deck is up to 360 u long, 3 when longer; none for a station (it stands)
tools/fit_gpt_hull.py reads the blue and green; tools/terra_v18/prep.py + wells.py the magenta.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, S = 1536, 1024, 2.18
BG, LINE = (10, 13, 24), (10, 13, 24)
BLUE, GREEN, CYAN, ORANGE, MAG = (30, 80, 230), (40, 205, 90), (60, 200, 240), (255, 140, 20), (255, 0, 255)
CX, CY = 772, 500                     # where the middle of the decks goes (a little room more for the stern)

# carriers: (col, deck, width in modules) — the shaft after column 1 (as the Aquarius carriers of 13.11)
CARRIERS = {
    # Albatros (13.11, standard): 3 decks, two hangars on the bottom one
    'albatros': [(1, 0, 1), (2, 0, 1), (3, 0, 1), (0, 1, 1), (1, 1, 1), (2, 1, 1), (3, 1, 1), (0, 2, 2), (2, 2, 2)],
    # Lewiatan (13.11, heavy): 4 decks, two hangars on the bottom one
    'lewiatan': [(2, 0, 1), (3, 0, 1), (0, 1, 1), (1, 1, 1), (2, 1, 1), (3, 1, 1), (0, 2, 1), (1, 2, 1), (2, 2, 1),
                 (3, 2, 1), (0, 3, 2), (2, 3, 2)],
    # Geb (Terra, drawn 17.11): 3 decks, one hangar
    'geb': [(1, 0, 1), (2, 0, 1), (3, 0, 1), (0, 1, 1), (1, 1, 1), (2, 1, 1), (3, 1, 1), (0, 2, 2), (2, 2, 1)],
}


def from_game(key):
    js = ("const h=require('./tests/harness.js');const sb=h.loadEngine();"
          f"const L=sb.SHIP_LAYOUTS[{json.dumps(key)}];"
          "console.log(JSON.stringify({label:L.label,station:!!L.isStation,rooms:L.rooms.map(r=>[r.x,r.y,r.w,r.h]),"
          "shafts:(L.elevators??[]).map(e=>e.x)}))")
    p = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True)
    d = json.loads(p.stdout.strip().splitlines()[-1])
    shafts = []
    for sx in d['shafts']:
        x0, x1 = sx - 15, sx + 15
        ys = [(y, y + h) for x, y, w, h in d['rooms'] if x + w == x0 or x == x1]
        shafts.append([x0, min(a for a, _ in ys), 30, max(b for _, b in ys) - min(a for a, _ in ys)])
    return d['label'], d['station'], d['rooms'], shafts


def from_carrier(name):
    rooms = []
    for col, deck, wm in CARRIERS[name]:
        x = col * 100 + (30 if col >= 2 else 0)
        rooms.append([x, deck * 70, wm * 100 + (30 if col < 2 <= col + wm - 1 else 0), 70])
    decks = max(d for _, d, _ in CARRIERS[name]) + 1
    return rooms, [[200, 0, 30, decks * 70]]


def draw(out, label, station, rooms, shafts):
    xs = [r[0] for r in rooms + shafts] + [r[0] + r[2] for r in rooms + shafts]
    ys = [r[1] for r in rooms + shafts] + [r[1] + r[3] for r in rooms + shafts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    ox, oy = CX - (x1 - x0) * S / 2 - x0 * S, CY - (y1 - y0) * S / 2 - y0 * S
    P = lambda x, y: (round(ox + x * S), round(oy + y * S))
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    for r, col in [(r, BLUE) for r in rooms] + [(s, GREEN) for s in shafts]:
        a, b = P(r[0], r[1]), P(r[0] + r[2], r[1] + r[3])
        d.rectangle([a[0], a[1], b[0] - 1, b[1] - 1], fill=col, outline=LINE)
    top = min(r[1] for r in rooms)
    roof = sorted([r for r in rooms if r[1] == top], key=lambda r: r[0])
    bar = lambda r, c, w: d.rectangle([P(r[0] + r[2] / 2, 0)[0] - w // 2, P(0, top)[1] - 26,
                                       P(r[0] + r[2] / 2, 0)[0] + w // 2, P(0, top)[1] - 14], fill=c)
    bar(roof[0], CYAN, 96)
    for r in roof[1:]: bar(r, ORANGE, 72)
    wells = []
    if not station:
        bot = max(r[1] + r[3] for r in rooms)
        low = sorted([r for r in rooms if r[1] + r[3] == bot], key=lambda r: r[0])
        mid = lambda r: r[0] + (50 if r[2] > 130 else r[2] / 2)
        xs_ = [mid(low[0]), low[-1][0] + low[-1][2] - (50 if low[-1][2] > 130 else low[-1][2] / 2)]
        lx0, lx1 = low[0][0], low[-1][0] + low[-1][2]
        if lx1 - lx0 > 360:
            c = (lx0 + lx1) / 2; xs_.insert(1, min((mid(r) for r in low[1:-1]), key=lambda m: abs(m - c), default=c))
        for cx in xs_:
            a = P(cx - 32, bot + 8); b = P(cx + 32, bot + 32); k = 10
            d.polygon([(a[0] + k, a[1]), (b[0] - k, a[1]), (b[0], a[1] + k), (b[0], b[1]), (a[0], b[1]), (a[0], a[1] + k)], fill=MAG)
            wells.append(round(cx))
    im.save(out)
    return {'label': label, 'modules': len(rooms), 'sockets': len(roof) - 1, 'wells': len(wells), 'length_u': x1 - x0}


if __name__ == '__main__':
    out_dir = sys.argv[1]; os.makedirs(out_dir, exist_ok=True)
    for arg in sys.argv[2:]:
        if arg.startswith('carrier:'):
            _, name, label = arg.split(':')
            rooms, shafts = from_carrier(name); station = False
        else:
            key, _, label = arg.partition(':')
            lab, station, rooms, shafts = from_game(key); label = label or lab
        info = draw(os.path.join(out_dir, f'1_blueprint_{label.upper()}.png'), label, station, rooms, shafts)
        print(json.dumps(info))
