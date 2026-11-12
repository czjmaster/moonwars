"""GPT v16 (update227): a yard's whole set drawn on the x12 templates (jj 10.11, `moon_wars_<yard>_approved_complete.zip`).

    python3 tools/cut_v16.py <set folder> <yard> <art folder>

The set: modules/room_<type>_<yard>.png, duct/duct_<yard>_background.png + duct_<yard>_cage.png, lift/lift_shaft_<yard>.png,
lift/lift_platform_<yard>_open.png — each 1536 x 1024, the x12 template's places (module x 168-1368 y 92-692, duct y 692-932,
the shaft one deck 30 x 70). Out, x4 of the game: rooms 400 x 200, duct_back/front 400 x 80, shaft_trunk 120 x 280 (a whole
deck, stacked), lift_cabin (the open platform, 28 wide in the game). A module GPT drew taller than the template (it happens:
the empty one, artillery, cryo) is fitted into 100 x 50 from its own top to its own bottom. Prints what the game needs.
"""
import glob, os, sys
import numpy as np
from PIL import Image

SET, YARD, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

def load(p):
    a = np.asarray(Image.open(p).convert('RGBA')).copy()
    r, g, b = (a[..., i].astype(int) for i in range(3))
    a[(r > 170) & (b > 150) & (g < 130) & (r - g > 80), 3] = 0     # the magenta, shaded or not
    return a

def resize(arr, w, h):
    return Image.fromarray(arr, 'RGBA').convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')

def box(a):
    rows = np.where((a[..., 3] > 0)[:, 300:1236].mean(axis=1) > 0.5)[0]
    cols = np.where((a[..., 3] > 0)[100:680].mean(axis=0) > 0.5)[0]
    return cols.min(), cols.max() + 1, rows.min(), rows.max() + 1

for p in sorted(glob.glob(f'{SET}/modules/room_*_{YARD}.png')):
    a = load(p)
    x0, x1, y0, y1 = box(a)
    y0 = min(y0, 92); y1 = max(y1, 692)
    room = a[y0:y1, 168:1368].copy(); room[..., 3] = 255
    resize(room, 400, 200).save(f'{OUT}/{os.path.basename(p)}', optimize=True)
    print(os.path.basename(p), 'rows', y0, y1, '(tall)' if y1 - y0 > 610 else '')

bg = load(f'{SET}/duct/duct_{YARD}_background.png')[692:932, 168:1368].copy(); bg[..., 3] = 255
resize(bg, 400, 80).save(f'{OUT}/duct_back_{YARD}.png', optimize=True)
cage = np.asarray(Image.open(f'{SET}/duct/duct_{YARD}_cage.png').convert('RGBA'))[692:932, 168:1368].copy()
resize(cage, 400, 80).save(f'{OUT}/duct_front_{YARD}.png', optimize=True)

sh = load(f'{SET}/lift/lift_shaft_{YARD}.png')
ys, xs = np.where(sh[..., 3] > 0)
trunk = sh[92:932, xs.min():xs.max() + 1].copy(); trunk[..., 3] = 255
resize(trunk, 120, 280).save(f'{OUT}/shaft_trunk_{YARD}.png', optimize=True)

pl = load(f'{SET}/lift/lift_platform_{YARD}_open.png')
op = pl[..., 3] > 0
w = op.sum(axis=1)
top = int(np.argmax(w > 0.2 * w.max()))     # below its stem (the cable is the code's)
ys, xs = np.where(op)
body = pl[top:ys.max() + 1, xs.min():xs.max() + 1]
CW = 28
ch = body.shape[0] * CW / body.shape[1]
# where its grating is: the first row (from the top of the body) wider than 95% of it
gr = int(np.argmax(op[top:ys.max() + 1].sum(axis=1) > 0.95 * body.shape[1]))
resize(body, CW * 4, round(ch * 4)).save(f'{OUT}/lift_cabin_{YARD}.png', optimize=True)
print(f'cabin: w {CW}, h {ch:.2f}, its floor {gr * CW / body.shape[1]:.2f} below its top')
