#!/usr/bin/env python3
"""MOON WARS — update243: Terra's module floor drawn in code, pixel for pixel (jj 18.11: „poprawmy grafikę podłogi
i ścian terra w module").

GPT drew the floor 9 u high and cut_interior.py stretched it to 12: soft, and its slanted slats read as a ramp. This
paints the floor band (38..50 u = rows 152..199 at 4 px a unit) anew, in the wall's own colours:
  - a lit lip where the wall meets the deck, the deck's front edge with rivets,
  - the grating: upright slots every 4 u (16 px; 400 / 16 tiles, so modules side by side meet without a seam),
  - a lower rail and the base beam with its plate joints and bolts,
and a kick plate along the wall's foot (34..38 u) so the floor is not glued straight onto flat sheet metal.
The same floor goes over the lift trunk's landing (shaft_top / shaft_trunk / shaft_bottom_terra, 120 wide), so a deck
reads as one floor through the shaft.

    python3 tools/terra_v20/redraw_floor.py          (idempotent: repaints the same rows every time)
"""
import os
from PIL import Image

ART = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'art', '')
K = 4
Y0 = 38 * K            # the floor line (the modules' floor at 38 u)

# the wall's colours (measured on room_wall_terra.png)
BLACK  = (11, 9, 7)
DEEP   = (25, 21, 18)
DARK   = (40, 35, 28)
SHADE  = (47, 42, 37)
WALL   = (60, 55, 49)
MID    = (76, 68, 57)
STEEL  = (90, 84, 75)
LIT    = (107, 99, 89)
BRIGHT = (131, 122, 114)
SHINE  = (150, 141, 130)
RUST   = (88, 62, 40)

def floor(px, w, x_phase=0):
    """Paint rows Y0..Y0+47 of a picture `w` px wide. x_phase shifts the pattern (the trunk sits at its own x)."""
    def row(y, c):
        for x in range(w): px[x, y] = c
    y = Y0
    # the lip: a shadow under the wall, then the deck's lit top edge
    row(y, BLACK); row(y + 1, SHINE); row(y + 2, BRIGHT); row(y + 3, LIT)
    # the deck's front edge: steel with rivets every 25 u, half a unit under the lip
    for yy in range(y + 4, y + 9): row(yy, STEEL)
    row(y + 9, SHADE)
    for x in range(w):
        gx = (x + x_phase) % 100
        if gx in (48, 49, 50):
            px[x, y + 5] = SHINE if gx == 48 else LIT
            px[x, y + 6] = LIT if gx == 48 else MID
            px[x, y + 7] = DARK
    # the grating: 16 px period — 6 px slot (dark, a lit sill at its foot), 10 px bar (lit left edge, shaded right)
    g0, g1 = y + 10, y + 34            # 24 px = 6 u of grating
    for x in range(w):
        p = (x + x_phase) % 16
        for yy in range(g0, g1):
            if p < 6:                                   # the slot
                c = BLACK if yy < g0 + 3 else DEEP
                if yy >= g1 - 2: c = DARK               # the slot's floor catches a little light
                if p == 0: c = BLACK
            else:                                       # the bar
                c = MID                                 # update243 v2: darker bars — the floor stays behind the machines
                if p == 6: c = LIT
                elif p == 7: c = STEEL
                elif p == 15: c = DARK
                elif p == 14: c = SHADE
                if yy == g0: c = SHADE                  # under the deck edge's shadow
                elif yy == g1 - 1: c = MID
            px[x, yy] = c
    # the lower rail
    row(g1, BLACK); row(g1 + 1, LIT); row(g1 + 2, STEEL); row(g1 + 3, MID); row(g1 + 4, SHADE)
    # the base beam: plates 25 u long with a joint, a bolt each side of it
    b0 = g1 + 5
    for yy in range(b0, Y0 + 48):
        row(yy, WALL if yy < Y0 + 46 else SHADE)
    row(Y0 + 47, DEEP)
    for x in range(w):
        gx = (x + x_phase) % 100
        if gx in (0, 1):                                # the joint between beam plates
            for yy in range(b0, Y0 + 47): px[x, yy] = BLACK if gx == 0 else MID
        for bx in (7, 93):                              # bolts 1.75 u either side of the joint
            if gx in (bx, bx + 1, bx + 2):
                by = b0 + 3
                px[x, by] = BRIGHT if gx == bx else LIT
                px[x, by + 1] = LIT if gx == bx else STEEL
                px[x, by + 2] = DARK
        if 40 <= gx < 60 and (gx // 2) % 2 == 0:        # a worn rust streak in the middle of each plate, faint
            px[x, Y0 + 45] = RUST

def kick(px, w, x_phase=0):
    """The kick plate along the wall's foot: 34..38 u (rows 136..151), darker than the wall, lit top, rivets."""
    y0 = 34 * K
    for x in range(w):
        gx = (x + x_phase) % 100
        for yy in range(y0, Y0):
            c = SHADE
            if yy == y0: c = DEEP
            elif yy == y0 + 1: c = MID
            elif yy == y0 + 2: c = WALL
            elif yy >= Y0 - 2: c = DARK
            if gx == 0: c = BLACK                         # the joint between plates (each 25 u)
            elif gx == 1 and yy > y0: c = WALL
            px[x, yy] = c
        for rx in (6, 50, 94):                           # rivets
            if gx in (rx, rx + 1) :
                ry = y0 + 7
                px[x, ry] = BRIGHT if gx == rx else LIT
                px[x, ry + 1] = LIT if gx == rx else DARK

def paint(name, w_expected, do_kick, x_phase=0):
    im = Image.open(ART + name + '.png').convert('RGBA')
    assert im.width == w_expected and im.height >= Y0 + 48, (name, im.size)
    px = im.load()
    if do_kick: kick(px, im.width, x_phase)
    floor(px, im.width, x_phase)
    im.save(ART + name + '.png', optimize=True)
    print('ok', name, im.size)

paint('room_wall_terra', 400, True)
for n in ('shaft_top_terra', 'shaft_trunk_terra', 'shaft_bottom_terra'):
    paint(n, 120, False)
