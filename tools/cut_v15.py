"""GPT v15 (update226): doors, airlocks, ducts, lift shafts and cabins — cut out of the 1536x1024 sheets.

    python3 tools/cut_v15.py <folder with door_inner_terra.png …> <art folder>

Magenta out, everything at x4 the game's size (like the v14 rooms), and the measurements the game needs printed as JS
(paste into ship.js `V15_ART`). The boxes below were measured by hand on jj's sheets of 10.11.2026 (GPT drew bigger
than the templates, so nothing is read off the templates).
"""
import json, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
X = 4                 # pixels of art per game pixel
DOOR_H = 34           # Door.H
LEAF_H = DOOR_H // 2  # each leaf is half the doorway

# frame crop (x0, y0, x1, y1) and the doorway in it (x, y, w, h); leaves (x0, y0, x1, y1): up, down
DOORS = {
    'inner_terra':      dict(file='door_inner_terra',      crop=(181, 197, 418, 689), open=(244, 302, 110, 343),
                             # GPT swapped them: the plain leaves with a handle are on the airlock sheet (jj 10.11)
                             leaves=('door_airlock_terra', (694, 384, 795, 638), (949, 393, 1043, 661))),
    'airlock_terra':    dict(file='door_airlock_terra',    crop=(153, 159, 448, 784), open=(250, 294, 102, 434),
                             leaves=('door_inner_terra', (660, 364, 828, 690), (933, 364, 1101, 690))),
    'inner_aquarius':   dict(file='door_inner_aquarius',   crop=(238, 260, 400, 605), open=(291, 335, 56, 242),
                             leaves=('door_inner_aquarius', (680, 334, 769, 596), (921, 335, 1010, 596))),
    'airlock_aquarius': dict(file='door_airlock_aquarius', crop=(182, 248, 416, 650), open=(272, 328, 55, 300),
                             leaves=('door_airlock_aquarius', (673, 337, 772, 717), (918, 348, 1017, 718))),
}
DUCT = dict(x0=368, x1=1169, back=(200, 361), front=(560, 721), seam=(765, 772))
SHAFT = {   # columns of the trunk; the deck's landing (top, plate top); the plain trunk repeated between them
    'terra':    dict(x=(647, 889), landing=(280, 545), plate_bot=572, trunk=(572, 961)),
    'aquarius': dict(x=(643, 893), landing=(527, 527), plate_bot=572, trunk=(572, 961)),
}

def load(name):
    a = np.asarray(Image.open(f'{SRC}/{name}.png').convert('RGB')).astype(np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = (r > 180) & (b > 180) & (g < 110) & (r - g > 110) & (b - g > 110)
    alpha = np.where(mag, 0, 255).astype(np.uint8)
    # a pink fringe next to the cut-out goes too
    near = np.zeros_like(mag)
    for dy in (-2, -1, 0, 1, 2):
        for dx in (-2, -1, 0, 1, 2):
            near |= np.roll(np.roll(mag, dy, 0), dx, 1)
    pink = near & ~mag & (r - g > 60) & (b - g > 60) & (np.abs(r - b) < 70)
    alpha[pink] = 0
    return np.dstack([a.astype(np.uint8), alpha])

def img(arr):
    return Image.fromarray(arr, 'RGBA')

def resize(im, w, h):
    return im.convert('RGBa').resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS).convert('RGBA')

def save(im, name):
    a = np.asarray(im).copy()                         # what is still magenta after the scaling: out too
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    a[(r > 170) & (b > 170) & (g < 90), 3] = 0
    im = Image.fromarray(a, 'RGBA')
    im.save(f'{OUT}/{name}.png', optimize=True)
    return name

meta = {'door': {}, 'shaft': {}, 'cabin': {}}
for key, d in DOORS.items():
    a = load(d['file'])
    x0, y0, x1, y1 = d['crop']
    ox, oy, ow, oh = d['open']
    s = DOOR_H / oh                                   # game px per sheet px
    fr = resize(img(a[y0:y1, x0:x1]), (x1 - x0) * s * X, (y1 - y0) * s * X)
    save(fr, 'door_' + key)
    ow_g = ow * s
    la = load(d['leaves'][0])
    for part, (lx0, ly0, lx1, ly1) in zip(('up', 'dn'), d['leaves'][1:]):
        kind, yard = key.split('_')
        save(resize(img(la[ly0:ly1, lx0:lx1]), ow_g * X, LEAF_H * X), f'door_{kind}_{part}_{yard}')
    meta['door'][key] = dict(w=round(fr.width / X, 2), h=round(fr.height / X, 2),
                             ox=round((ox - x0) * s, 2), oy=round((oy - y0) * s, 2), ow=round(ow_g, 2))

for yard in ('terra', 'aquarius'):
    a = load('duct_' + yard)
    for layer in ('back', 'front'):
        t, b = DUCT[layer]
        part = a[t:b, DUCT['x0']:DUCT['x1']].copy()
        # the template's white line between the halves: fill it from the columns either side
        s0, s1 = DUCT['seam'][0] - DUCT['x0'], DUCT['seam'][1] - DUCT['x0']
        L, R = s0 - 1, s1
        for c in range(s0, s1):
            f = (c - L) / (R - L)
            part[:, c] = (part[:, L] * (1 - f) + part[:, R] * f).astype(np.uint8)
        if layer == 'back':
            part[..., 3] = 255                        # the inside of the duct is solid
        save(resize(img(part), 100 * X, 20 * X), f'duct_{layer}_{yard}')

    a = load('shaft_' + yard)
    S = SHAFT[yard]
    sx0, sx1 = S['x']
    k = 30 / (sx1 - sx0)                              # game px per sheet px
    trunk = a[S['trunk'][0]:S['trunk'][1], sx0:sx1]
    save(resize(img(trunk), 30 * X, trunk.shape[0] * k * X), 'shaft_trunk_' + yard)
    lt, ptop = S['landing']
    land = a[lt:S['plate_bot'], sx0:sx1]
    save(resize(img(land), 30 * X, land.shape[0] * k * X), 'shaft_landing_' + yard)
    meta['shaft'][yard] = dict(trunkH=round(trunk.shape[0] * k, 2), landH=round(land.shape[0] * k, 2),
                               landTop=round((lt - ptop) * k, 2))   # its top, from the deck (the plate's top)

    a = load('lift_cabin_' + yard)
    op = a[..., 3] > 0
    rows = np.where(op.any(axis=1))[0]; colsx = np.where(op.any(axis=0))[0]
    width = op.sum(axis=1)
    body_top = int(rows[np.argmax(width[rows] > 0.6 * (colsx[-1] - colsx[0]))])
    cab = a[body_top:rows[-1] + 1, colsx[0]:colsx[-1] + 1]
    s = DOOR_H / cab.shape[0]
    save(resize(img(cab), cab.shape[1] * s * X, DOOR_H * X), 'lift_cabin_' + yard)
    meta['cabin'][yard] = dict(w=round(cab.shape[1] * s, 2), bodyTop=body_top)

print(json.dumps(meta, indent=1))
