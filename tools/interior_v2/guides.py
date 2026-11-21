#!/usr/bin/env python3
"""MOON WARS — update248: the GUIDES GPT draws a yard's insides on (the Terra way of 17.11, for every yard)

    python3 tools/interior_v2/guides.py <out_dir>

Every field sits exactly where tools/terra_v18/cut_interior.py, tools/terra_v19/cut_doors.py and
tools/terra_v18/prep.py cut GPT's Terra sheets — so the same cutters take any yard's answer.
1536 x 1024 each; MAGENTA = nothing (cut away); GREY-BLUE = draw here; the other colours mark places (see the prompts).
  g1_wall      the back wall of a module, 100 x 50 u at 12 px a unit (60,60 - 1260,660)
  g2_floor     the deck 100 x 12 at 12 px (60,60 - 1260,204) + the lift landing 30 x 12 (60,540 - 420,684)
  g3_duct      the duct: front grille 100 x 20 (60,60 - 1260,300), inside 100 x 20 (60,661 - 1260,901)
  g4_shaft     the lift trunk at 10 px a unit: TOP / MIDDLE / BOTTOM columns 31 u wide — wall 38 u, landing 12,
               duct 20 (61..763); the bottom one with its buffers under it (798..931); the cage 30 x 40 (1147,135 - 1440,540)
  g5_doors     inner door: head 8 x 16, sill 8 x 4, two leaves 6 x 17 (cut_doors.py boxes)
  g6_airlock   the airlock: head 10 x 16, sill 10 x 5, two leaves 8 x 17
  g7_hangar    the back wall of a HANGAR, 200 x 50 u at 6 px (60,60 - 1260,360) — the floor and the duct are the
               module's, repeated
  g8_plates    the closed hull's cover plates at 4x: module A1 (59,59 400x280), A2 (537,59 401x280), shaft
               (1018,59 121x280), hangar (59,380 800x278) — the duct band the lower 80 px of each
  g9_equipment one module's equipment on magenta: the zone 8..92 x 9..42 u at 12 px over a ghost of the wall
"""
import os, sys
from PIL import Image, ImageDraw

MAG, FIELD, BROWN, GREEN, YEL, CYAN, WHITE, PURPLE, BLUE, RED = (
    (255, 0, 255), (96, 110, 132), (120, 84, 52), (60, 200, 90), (255, 220, 0), (60, 200, 240), (240, 240, 240),
    (150, 80, 200), (60, 110, 230), (220, 50, 40))
OUT = os.path.join(sys.argv[1], ''); os.makedirs(OUT, exist_ok=True)

def canvas():
    im = Image.new('RGB', (1536, 1024), MAG); return im, ImageDraw.Draw(im)

def dashed(d, box, col=WHITE, step=12):
    x0, y0, x1, y1 = box
    for x in range(x0, x1, step * 2): d.line([(x, y0), (min(x + step, x1), y0)], col, 2); d.line([(x, y1), (min(x + step, x1), y1)], col, 2)
    for y in range(y0, y1, step * 2): d.line([(x0, y), (x0, min(y + step, y1))], col, 2); d.line([(x1, y), (x1, min(y + step, y1))], col, 2)

# 1 — the wall of every module (12 px a unit)
im, d = canvas(); U = 12; X, Y = 60, 60
d.rectangle([X, Y, X + 100 * U - 1, Y + 50 * U - 1], fill=FIELD)
d.rectangle([X, Y, X + 100 * U - 1, Y + 4 * U], fill=(80, 92, 112))                         # the ceiling beam 0..4
d.rectangle([X, Y + 38 * U, X + 100 * U - 1, Y + 50 * U - 1], fill=BROWN)                    # the deck (drawn on g2)
d.rectangle([X + int(5.35 * U), Y + int(5.5 * U), X + int(16.75 * U), Y + int(16.5 * U)], fill=PURPLE)  # the icon plate
for k in range(4):
    cx = X + int((80.9 + k * 4.33) * U); cy = Y + int(7.05 * U); d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=YEL)
for k, cx in enumerate((30, 50, 70)): dashed(d, (X + (cx - 6) * U, Y + 16 * U, X + (cx + 6) * U, Y + 38 * U))  # crew
im.save(OUT + 'g1_wall.png')

# 2 — the deck and the lift landing
im, d = canvas()
d.rectangle([60, 60, 1259, 203], fill=BROWN); d.rectangle([60, 540, 419, 683], fill=BROWN)
im.save(OUT + 'g2_floor.png')

# 3 — the duct: the grille in front (its openings magenta), the inside behind
im, d = canvas()
d.rectangle([60, 60, 1259, 299], fill=FIELD)
for k in range(10):
    x = 60 + 30 + k * 120; d.rectangle([x, 100, x + 60, 260], fill=MAG)                     # where one looks in
d.rectangle([60, 661, 1259, 900], fill=(54, 62, 78))
im.save(OUT + 'g3_duct.png')

# 4 — the lift trunk: TOP, MIDDLE (repeats), BOTTOM, and the cage
im, d = canvas()
for x0, x1, kind in ((64, 374, 'top'), (421, 729, 'mid'), (778, 1085, 'bottom')):
    d.rectangle([x0, 61, x1, 440], fill=FIELD)                                              # the wall, 38 u
    d.rectangle([x0, 441, x1, 562], fill=BROWN)                                             # the landing, 12 u
    d.rectangle([x0, 563, x1, 762], fill=(54, 62, 78))                                      # the duct's level, 20 u
    for cx in (x0 + 40, x1 - 40): d.rectangle([cx - 8, 61, cx + 8, 440], fill=CYAN)       # the guide rails
    if kind == 'top': d.rectangle([x0 + 60, 61, x1 - 60, 140], fill=GREEN)                  # the hoist
    if kind == 'bottom': d.rectangle([x0, 798, x1, 931], fill=(80, 92, 112))               # the buffers
d.rectangle([1147, 135, 1440, 540], fill=FIELD); d.rectangle([1147, 135, 1440, 200], fill=GREEN)
d.rectangle([1147, 480, 1440, 540], fill=BROWN); d.line([(1293, 60), (1293, 135)], CYAN, 6)
dashed(d, (1240, 230, 1350, 478))
im.save(OUT + 'g4_shaft.png')

# 5/6 — the doors (the boxes cut_doors.py cuts)
for name, head, sill, top, bot in (
        ('g5_doors', (57, 58, 157, 263), (57, 360, 157, 414), (246, 58, 335, 292), (246, 306, 335, 529)),
        ('g6_airlock', (45, 55, 185, 292), (45, 356, 185, 419), (233, 55, 345, 296), (233, 302, 345, 534))):
    im, d = canvas()
    d.rectangle(head, fill=GREEN); hx = (head[0] + head[2]) // 2
    d.ellipse([hx - 16, head[1] + 24, hx + 16, head[1] + 56], fill=YEL)                    # the lamp, off
    d.rectangle([head[0] + 16, head[1] + 90, head[2] - 16, head[3]], fill=(20, 24, 30))     # the doorway
    d.rectangle(sill, fill=BROWN)
    leaf = RED if 'air' in name else BLUE
    d.rectangle(top, fill=leaf); d.rectangle(bot, fill=leaf)
    d.rectangle([top[0], top[3] - 8, top[2], top[3]], fill=WHITE); d.rectangle([bot[0], bot[1], bot[2], bot[1] + 8], fill=WHITE)
    im.save(OUT + name + '.png')

# 7 — the hangar's back wall (6 px a unit)
im, d = canvas(); U = 6
d.rectangle([60, 60, 60 + 200 * U - 1, 60 + 50 * U - 1], fill=FIELD)
d.rectangle([60, 60, 60 + 200 * U - 1, 60 + 4 * U], fill=(80, 92, 112))
d.rectangle([60, 60 + 38 * U, 60 + 200 * U - 1, 60 + 50 * U - 1], fill=BROWN)
d.rectangle([60 + int(5.35 * U), 60 + int(5.5 * U), 60 + int(16.75 * U), 60 + int(16.5 * U)], fill=PURPLE)
for k in range(4):
    cx = 60 + int((180.9 + k * 4.33) * U); cy = 60 + int(7.05 * U); d.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=YEL)
dashed(d, (60 + 55 * U, 60 + 14 * U, 60 + 145 * U, 60 + 38 * U), WHITE)                     # the fighter's cradle stands here
d.rectangle([60 + 20 * U, 60 + 12 * U, 60 + 42 * U, 60 + 22 * U], fill=CYAN)                 # the launch console screen
im.save(OUT + 'g7_hangar.png')

# 8 — the closed hull's cover plates, 4x
im, d = canvas()
for box in ((59, 59, 400, 280), (537, 59, 401, 280), (1018, 59, 121, 280), (59, 380, 800, 278)):
    x, y, w, h = box; d.rectangle([x, y, x + w - 1, y + h - 1], fill=FIELD); d.rectangle([x, y + h - 80, x + w - 1, y + h - 1], fill=(70, 80, 98))
    d.rectangle([x + w // 2 - 30, y + 90, x + w // 2 + 30, y + 110], fill=CYAN)
im.save(OUT + 'g8_plates.png')

# 9 — the equipment of one module, on magenta (the wall behind is shown as a ghost line only)
im, d = canvas(); U = 12
d.rectangle([60, 60, 1259, 659], outline=FIELD, width=3)
d.rectangle([60 + 8 * U, 60 + 9 * U, 60 + 92 * U, 60 + 42 * U], fill=FIELD)
d.line([(60, 60 + 42 * U), (1259, 60 + 42 * U)], BROWN, 6)
im.save(OUT + 'g9_equipment.png')
print('ok')
