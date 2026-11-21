#!/usr/bin/env python3
"""MOON WARS — update249, last step: put back into HULL_SHAPED what gen_shaped_hull_art.py drops — `pads` and `wells`
(wells_<yard>.json from wells.py), `sockets: true`, and the socket `rings`.

    python3 tools/pp_v17/spec.py <work_dir> key [key ...]

Rings: Pegasus roofs are smooth — tools/guns/find_rings.py finds them. Phoenix roofs bristle with blades that
find_rings takes for rings, so theirs are measured over the modules that carry a gun: the run round the module's
middle whose top stays within 6 px of the roof there.
"""
import json, os, re, subprocess, sys, numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W = os.path.join(sys.argv[1], '')
wells = {}
for f in os.listdir(W):
    if f.startswith('wells_') and f.endswith('.json'): wells.update(json.load(open(W + f)))
src = os.path.join(ROOT, 'js', 'ship.js'); s = open(src, encoding='utf-8').read()
for key in sys.argv[2:]:
    js = ("const h=require('./tests/harness.js');const sb=h.loadEngine();const L=sb.SHIP_LAYOUTS['%s'];const S=sb.HULL_SHAPED['%s'];"
          "const x0=Math.min(...L.rooms.map(r=>r.x)),y0=Math.min(...L.rooms.map(r=>r.y));"
          "console.log(JSON.stringify({b:L.builder,c:L.rooms.filter(r=>r.y===y0&&r.type!=='piloting').map(r=>Math.round(S.ox+(r.x+r.w/2-x0)*1.5))}))") % (key, key)
    info = json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True).stdout.strip().splitlines()[-1])
    a = np.array(Image.open(os.path.join(ROOT, 'art', f'hull_{key}.png')).convert('RGBA'))[..., 3] > 0
    top = np.array([np.argmax(a[:, x]) if a[:, x].any() else a.shape[0] for x in range(a.shape[1])])
    rings = []
    for c in info['c']:
        med = np.median(top[c - 25:c + 26]); xs = [x for x in range(c - 45, c + 46) if abs(top[x] - med) <= 6]
        rings.append([int(min(xs)), int(max(xs)) + 1, int(top[min(xs):max(xs) + 1].min())])
    m = re.search(rf"\n  {key}: \{{ w: \d+, h: \d+, ox: \d+, oy: \d+,\n", s)
    ins = ''
    if key in wells:
        ins += f"    pads: {json.dumps(wells[key]['pads']).replace(',', ', ')},\n    wells: {json.dumps(wells[key]['wells']).replace(',', ', ')},\n"
    ins += f"    sockets: true,\n    rings: {rings},\n"
    s = s[:m.end()] + ins + s[m.end():]
    print(key, info['b'], 'rings', rings)
open(src, 'w', encoding='utf-8').write(s)
