#!/usr/bin/env python3
"""MOON WARS — update242: the gun SOCKET RINGS on a hull picture's roof, for the drawn guns to sit in.

    python3 tools/guns/find_rings.py [--write]

For every shaped hull with `sockets: true` in js/ship.js: art/hull_<key>.png's top silhouette (the first opaque row
of every column); a ring is a bump of it standing clear of the roof — narrower than RING_MAX px, its top over the
roof around it by RISE px. Printed as `rings: [[x0, x1, top], …]` (picture px, the player's side); --write puts the
line into the spec, after its `sockets: true`.
"""
import re, os, sys, numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'js', 'ship.js')
RING_MIN, RING_MAX, RISE = 40, 90, 6
# update249: Phoenix roofs bristle with blades — find_rings takes them for rings; theirs are measured over the modules
HAND = {'enemy_mech', 'enemy_gunship', 'enemy_raider', 'osiris', 'boss_station', 'enemy_geb', 'enemy_tefnut', 'enemy_sopdet'}
s = open(SRC, encoding='utf-8').read()
out = s
for m in re.finditer(r"\n  ([a-z_]+): \{ w: (\d+), h: (\d+), ox: (\d+), oy: (\d+)[^\n]*\n((?:    [^\n]*\n)*?)    sockets: true,\n(?:    rings: [^\n]*\n)*", s):
    key = m.group(1)
    p = os.path.join(ROOT, 'art', f'hull_{key}.png')
    if not os.path.exists(p): continue
    a = np.array(Image.open(p).convert('RGBA'))[..., 3] > 0
    top = np.array([np.argmax(a[:, x]) if a[:, x].any() else a.shape[0] for x in range(a.shape[1])])
    oy = int(m.group(5))
    # the roof around each column: the median top over 200 px; a ring stands RISE px over it
    med = np.array([np.median(top[max(0, x - 100):x + 101]) for x in range(len(top))])
    up = (top < med - RISE) & (top < oy)
    rings, x, W = [], 0, len(top)
    while x < W:
        if not up[x]: x += 1; continue
        x0 = x
        while x < W and up[x]: x += 1
        if RING_MIN <= x - x0 <= RING_MAX: rings.append([int(x0), int(x), int(top[x0:x].min())])
    line = f"    rings: {rings},\n"
    print(key, rings)
    if key in HAND: continue                       # update249: rings set by hand stay
    if '--write' in sys.argv:
        blk = m.group(0)
        blk2 = re.sub(r"    rings: \[[^\n]*\n", '', blk).replace("    sockets: true,\n", "    sockets: true,\n" + line)
        out = out.replace(blk, blk2, 1)
if '--write' in sys.argv: open(SRC, 'w', encoding='utf-8').write(out)
