#!/usr/bin/env python3
"""MOON WARS — update237: GPT's equipment of the twelve Terra modules -> layers over the shared wall (room_wall_terra)

    python3 tools/terra_v19/cut_equipment.py <uploads_dir> [type ...]     (only those types, and no tubes)

Each sheet (GPT on the guides of terra-moduly/, flat magenta round the equipment) is cut out, its colours brought to
the set's (the same dark warm steel: GPT drew the air and the medbay lighter, the reactor in copper), fitted into the
module — its height from y 9 to the floor's back (42), centred, at most 92 wide (the helm 61) — and written at x4 as
art/room_eq_<type>_terra.png (400 x 200, transparent round it). Prints the dark windows it finds (screens, glass,
slabs, cells) in the module's units, for MODULE_WALL_EQ in js/systems.js. Also the three piston tubes:
art/gear_terra_tube{1,2,3}.png (thickest first, as they come out of the mount).
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as nd
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(ROOT, 'art', ''); U = os.path.join(sys.argv[1], '')
K = 4
SHEETS = {  # type: (GPT sheet, widest it may be in units, desaturate first)
    'piloting': ('640b8fdc', 92, 1),            # update239: v3 — two pilots' stations and the captain's table (jj) 'engines': ('6b518be0', 92, 1), 'weapons': ('53fd127b', 92, 1),
    'shields': ('53da569b', 92, 1), 'oxygen': ('ee62f4df', 92, 1), 'medbay': ('387a40c0', 92, 1),
    'reactor': ('06730094', 92, 0.55), 'artillery': ('9bb724f0', 92, 1), 'autorepair': ('781a29ce', 92, 1),
    'carbonite': ('dc4049cb', 92, 1), 'cloaking': ('079eb72d', 92, 1), 'tractor': ('53f8dfe7', 92, 1),
}
TARGET = np.array([64., 53., 41.])          # the mean of the engine room, the weapons and the shields
def magenta(a):
    m = (a[..., 0] > 170) & (a[..., 2] > 170) & (a[..., 1] < 120)
    return m | (nd.binary_dilation(m, iterations=2) & (a[..., 0] > a[..., 1] + 40) & (a[..., 2] > a[..., 1] + 40))
def sheet(name):
    f = [x for x in os.listdir(U) if x.startswith(name)][0]
    return np.array(Image.open(U + f).convert('RGB')).astype(float)
ONLY = sys.argv[2:]
for t, (name, wmax, sat) in SHEETS.items():
    if ONLY and t not in ONLY: continue
    a = sheet(name); mag = magenta(a)
    if sat < 1:
        g = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2])[..., None]; a = g + (a - g) * sat
    a[~mag] = np.clip(a[~mag] * (TARGET / a[~mag].mean(0)), 0, 255)
    ys, xs = np.nonzero(~mag); bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    k = min(33 / (by1 - by0), wmax / (bx1 - bx0)); w, h = (bx1 - bx0) * k, (by1 - by0) * k
    X0, Y0 = 50 - w / 2, 42 - h
    rgba = np.dstack([np.where(mag[..., None], 0, a), np.where(mag, 0, 255)]).astype('uint8')
    eq = Image.fromarray(rgba).crop((bx0, by0, bx1, by1)).resize((round(w * K), round(h * K)), Image.LANCZOS)
    q = np.array(eq); q[..., 3] = np.where(q[..., 3] < 128, 0, 255); eq = Image.fromarray(q)
    out = Image.new('RGBA', (100 * K, 50 * K)); out.alpha_composite(eq, (round(X0 * K), round(Y0 * K))); out.save(ART + f'room_eq_{t}_terra.png')
    # the dark windows (screens, glass, slabs, cells), in the module's units
    dark = (a.sum(-1) < 75) & ~mag
    lab, n = nd.label(dark); found = []
    for sl in nd.find_objects(lab):
        ww, hh = (sl[1].stop - sl[1].start) * k, (sl[0].stop - sl[0].start) * k
        if ww * hh > 6: found.append((round(X0 + (sl[1].start - bx0) * k, 2), round(Y0 + (sl[0].start - by0) * k, 2), round(ww, 2), round(hh, 2)))
    print(t, f'x {X0:.1f}..{X0 + w:.1f} y {Y0:.1f}..42', sorted(found, key=lambda r: (r[1], r[0])))
if ONLY: sys.exit(0)
# the piston: three tubes (GPT, the guide's 5x: 22/16/10 wide, 30 long), at 3 px a unit
p = sheet('7b260850'); pm = magenta(p)
for i, (x0, x1) in enumerate(((59, 171), (229, 313), (368, 421)), 1):
    rgba = np.dstack([np.where(pm[..., None], 0, p), np.where(pm, 0, 255)]).astype('uint8')
    im = Image.fromarray(rgba).crop((x0, 60, x1, 213)); im = im.resize((round(im.width * 3 / 5), round(im.height * 3 / 5)), Image.LANCZOS)
    q = np.array(im); q[..., 3] = np.where(q[..., 3] < 128, 0, 255); Image.fromarray(q).save(ART + f'gear_terra_tube{i}.png')
print('tubes ok')
