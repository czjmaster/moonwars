#!/usr/bin/env python3
"""MOON WARS — update266: the GPT sheets for Aquarius's own doors and piston (jj 26.11).

    python3 tools/aquarius_v23/guides.py <out_dir>

Guides (exact layouts — tools/aquarius_v23/cut.py cuts GPT's answers at these boxes), references from the game's own
art, and two EXAMPLES drawn here in Aquarius colours: what we mean, for GPT to copy the idea and draw it properly.
Door geometry = Terra's in the game (Door.ART / ART_AIR): inner head 8x16 u, sill 8x4, leaves 6x17; airlock 10x16,
10x5, 8x17. Piston = the standard's three tubes 22/16/10 x 30 u (TUBE.W of the 64 bay).
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
ART = os.path.join(ROOT, 'art')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/gpt_aq'
os.makedirs(OUT, exist_ok=True)
MAG, FIELD, BG = (255, 0, 255), (150, 160, 172), (34, 36, 48)
def font(sz):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F, FS = font(40), font(24)
def art(n): return Image.open(os.path.join(ART, n + '.png')).convert('RGBA')
def up(im, k): return im.resize((round(im.width * k), round(im.height * k)), Image.NEAREST)

# ── the boxes (shared with cut.py) ──
DOOR_K = 16
DOOR = {   # name: (x, y, w_units, h_units)
    'head': (90, 110, 8, 16), 'sill': (90, 520, 8, 4), 'leaf_top': (330, 110, 6, 17), 'leaf_bot': (520, 110, 6, 17)}
AIR = {'head': (80, 110, 10, 16), 'sill': (80, 520, 10, 5), 'leaf_top': (330, 110, 8, 17), 'leaf_bot': (520, 110, 8, 17)}
TUBE_K = 5
TUBES = {'tube1': (120, 160, 22, 30), 'tube2': (330, 160, 16, 30), 'tube3': (500, 160, 10, 30)}
def box(d, k, n):
    x, y, w, h = d[n]; return (x, y, x + w * k, y + h * k)

# ── palette (from gear_aquarius_bay and room_default_aquarius) ──
NAVY, NAVY2, NAVY3, DARK = (44, 63, 92), (31, 43, 68), (70, 96, 128), (10, 16, 31)
TEAL, TEAL2 = (3, 59, 84), (24, 70, 87)
STEEL, STEEL_HI, STEEL_LO = (134, 170, 192), (200, 230, 240), (90, 132, 149)
CYAN, CYAN_HI = (40, 200, 230), (190, 250, 255)

def door_guide(D, path, air):
    im = Image.new('RGB', (1536, 1024), MAG); d = ImageDraw.Draw(im); k = DOOR_K
    for n, lab in [('head', 'A'), ('sill', 'B'), ('leaf_top', 'C'), ('leaf_bot', 'D')]:
        b = box(D, k, n); d.rectangle(b, fill=FIELD, outline=(60, 60, 70), width=2)
        d.text((b[0], b[1] - 50), lab, font=F, fill=(255, 255, 255))
    # the lamp socket in the head (yellow) and the meeting edges of the leaves (white)
    hx, hy, hw, hh = D['head']; cx = hx + hw * k / 2
    d.rectangle((cx - 2 * k, hy + 10 * k, cx + 2 * k, hy + 13 * k), fill=(255, 220, 0))
    for n, top in [('leaf_top', False), ('leaf_bot', True)]:
        b = box(D, k, n); e = 3 * k
        d.rectangle((b[0], b[1], b[2], b[1] + e) if top else (b[0], b[3] - e, b[2], b[3]), fill=(255, 255, 255))
    # E: the shut door assembled, F: the open one (outlines only — how the game puts the parts together)
    for ox, o in [(900, 0), (1220, 1)]:
        W, LW = D['head'][2], D['leaf_top'][2]; Hh, S = D['head'][3], D['sill'][3]
        x0 = ox; y0 = 110; c = x0 + W * k / 2
        d.text((x0, y0 - 50), 'E' if not o else 'F', font=F, fill=(255, 255, 255))
        d.rectangle((x0 - 60, y0 + Hh * k, x0 + W * k + 60, y0 + (Hh + 34) * k), fill=(70, 90, 110))   # the room's wall behind
        leaf = 17 * k if not o else 3 * k
        d.rectangle((c - LW * k / 2, y0 + Hh * k, c + LW * k / 2, y0 + Hh * k + leaf), fill=(130, 140, 200), outline=(20, 20, 40))
        d.rectangle((c - LW * k / 2, y0 + (Hh + 34) * k - max(leaf, (S + 3) * k), c + LW * k / 2, y0 + (Hh + 34) * k), fill=(130, 140, 200), outline=(20, 20, 40))
        d.rectangle((x0, y0, x0 + W * k, y0 + Hh * k), fill=FIELD, outline=(20, 20, 40), width=2)
        d.rectangle((x0, y0 + (Hh + 34 - S) * k, x0 + W * k, y0 + (Hh + 34) * k), fill=FIELD, outline=(20, 20, 40), width=2)
        d.rectangle((x0 - 60, y0 + (Hh + 34) * k, x0 + W * k + 60, y0 + (Hh + 34) * k + 6), fill=(30, 30, 30))       # the deck
    d.text((60, 960), 'A head  B threshold  C upper leaf  D lower leaf   |   E shut  F open (how the game assembles them)', font=FS, fill=(255, 255, 255))
    im.save(path)

def tube_guide(path):
    im = Image.new('RGB', (1536, 1024), MAG); d = ImageDraw.Draw(im); k = TUBE_K
    for n, lab in [('tube1', 'B1'), ('tube2', 'B2'), ('tube3', 'B3')]:
        b = box(TUBES, k, n); d.rectangle(b, fill=FIELD, outline=(60, 60, 70), width=2)
        d.text((b[0], b[1] - 50), lab, font=F, fill=(255, 255, 255))
    # E: assembled under the drawn mount, over the foot — the real game art at the same 5x
    bay, foot = art('gear_aquarius_bay'), art('gear_aquarius_foot')
    s = 64 * TUBE_K / bay.width
    B, Fo = up(bay, s), up(foot, 64 * TUBE_K / foot.width)
    ex, ey = 820, 110; d.text((ex, ey - 50), 'E', font=F, fill=(255, 255, 255))
    c = ex + B.width / 2; top = ey + B.height - 20; seg = 30 * k * 0.8
    for i, wu in enumerate([22, 16, 10]):
        y0 = top + i * seg; d.rectangle((c - wu * k / 2, y0, c + wu * k / 2, y0 + seg + 12), fill=FIELD, outline=(40, 40, 50), width=2)
    im.paste(B, (ex, ey), B); fy = int(top + 3 * seg + 10); im.paste(Fo, (int(c - Fo.width / 2), fy), Fo)
    d.text((60, 960), 'B1 thickest (out of the mount)  B2  B3 thinnest (into the foot)   |   E assembled, extended', font=FS, fill=(255, 255, 255))
    im.save(path)

# ── the examples, drawn here ──
def bolt(d, x, y, r):
    d.ellipse((x - r, y - r, x + r, y + r), fill=STEEL_LO); d.ellipse((x - r, y - r, x + r * 0.2, y + r * 0.2), fill=STEEL_HI)
def small_frame(d, b, k, glow=False):
    """the module's small rounded pale-steel frame (the portholes', the screens')"""
    x0, y0, x1, y1 = b; r = k * 0.9
    d.rounded_rectangle(b, radius=r, fill=STEEL_LO); d.rounded_rectangle((x0 + 2, y0 + 2, x1 - 3, y1 - 3), radius=r, fill=STEEL)
    d.line((x0 + r, y0 + 3, x1 - r, y0 + 3), fill=STEEL_HI, width=2)
    i = k * 0.55; d.rounded_rectangle((x0 + i, y0 + i, x1 - i, y1 - i), radius=r * 0.5, fill=TEAL2 if not glow else CYAN)
def ex_head(W, H, k):
    im = Image.new('RGBA', (W * k, H * k), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W * k - 1, H * k - 1), fill=NAVY); d.rectangle((0, 0, W * k - 1, k * 1.2), fill=STEEL)
    d.line((0, 1, W * k, 1), fill=STEEL_HI, width=2); d.rectangle((0, k * 1.2, W * k, k * 1.5), fill=DARK)
    small_frame(d, (k * 0.8, k * 2.4, W * k - k * 0.8, k * 8.6), k)              # the upper small frame
    d.rounded_rectangle((W * k / 2 - 2.4 * k, 9.6 * k, W * k / 2 + 2.4 * k, 13.4 * k), radius=k * 0.6, fill=STEEL)
    d.rounded_rectangle((W * k / 2 - 2 * k, 10 * k, W * k / 2 + 2 * k, 13 * k), radius=k * 0.5, fill=DARK)   # the lamp socket, off
    d.rectangle((0, H * k - k * 1.3, W * k, H * k), fill=STEEL); d.line((0, H * k - k * 1.3, W * k, H * k - k * 1.3), fill=STEEL_HI, width=2)
    for x in (k * 0.6, W * k - k * 0.6): bolt(d, x, k * 0.6, k * 0.3); bolt(d, x, H * k - k * 0.65, k * 0.3)
    return im
def ex_sill(W, H, k):
    im = Image.new('RGBA', (W * k, H * k), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W * k - 1, H * k - 1), fill=STEEL_LO); d.rectangle((0, 0, W * k, k * 0.8), fill=STEEL)
    d.line((0, 1, W * k, 1), fill=STEEL_HI, width=2)
    small_frame(d, (k * 0.9, k * 1.2, W * k - k * 0.9, H * k - k * 0.5), k * 0.7, glow=True)   # the lower small frame, a thin cyan strip
    for x in (k * 0.5, W * k - k * 0.5): bolt(d, x, H * k / 2 + k * 0.3, k * 0.28)
    return im
def ex_leaf(W, H, k, meet_bottom, air):
    im = Image.new('RGBA', (W * k, H * k), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W * k - 1, H * k - 1), fill=TEAL); d.rectangle((0, 0, k * 0.5, H * k), fill=TEAL2)
    d.rectangle((W * k - k * 0.5, 0, W * k, H * k), fill=DARK)
    far = (k * 0.8, k * 1.5, W * k - k * 0.8, k * 6.5) if meet_bottom else (k * 0.8, H * k - k * 6.5, W * k - k * 0.8, H * k - k * 1.5)
    small_frame(d, far, k)                                                         # a small frame on the far end
    e = 3 * k; mb = (0, H * k - e, W * k, H * k) if meet_bottom else (0, 0, W * k, e)
    if air:                                                                        # the airlock: hazard stripes at the seam
        d.rectangle(mb, fill=(20, 20, 20))
        for i in range(-4, 12):
            x = i * k * 1.4; y0, y1 = mb[1], mb[3]
            d.polygon([(x, y1), (x + k * 0.7, y1), (x + k * 0.7 + (y1 - y0), y0), (x + (y1 - y0), y0)], fill=(240, 190, 30))
        im2 = Image.new('RGBA', im.size, (0, 0, 0, 0)); im2.paste(im.crop(mb), mb[:2]); im.paste(im2.crop(mb), mb[:2])
    else:                                                                          # the inner door: a pale rim with a cyan seal
        d.rectangle(mb, fill=STEEL); sy = mb[3] - k * 0.6 if meet_bottom else mb[1] + k * 0.2
        d.rectangle((k * 0.6, sy, W * k - k * 0.6, sy + k * 0.45), fill=CYAN); d.line((k * 0.6, sy, W * k - k * 0.6, sy), fill=CYAN_HI, width=2)
    for x in (k * 0.5, W * k - k * 0.9):
        for y in (k * 7.5, k * 10): bolt(d, x + k * 0.2, y if meet_bottom else H * k - y, k * 0.22)
    return im
def door_example(D, path, air):
    k = DOOR_K; im = Image.new('RGBA', (1536, 1024), BG + (255,)); d = ImageDraw.Draw(im)
    W, Hh = D['head'][2], D['head'][3]; SW, SH = D['sill'][2], D['sill'][3]; LW = D['leaf_top'][2]
    head, sill = ex_head(W, Hh, k), ex_sill(SW, SH, k)
    lt, lb = ex_leaf(LW, 17, k, True, air), ex_leaf(LW, 17, k, False, air)
    for n, p in [('head', head), ('sill', sill), ('leaf_top', lt), ('leaf_bot', lb)]:
        im.alpha_composite(p, D[n][:2])
    room = up(art('room_default_aquarius'), k / 4)                              # the module behind, at the same scale
    for ox, o in [(900, 0), (1220, 1)]:
        y0 = 110; c = ox + W * k // 2
        im.alpha_composite(room.crop((0, 0, W * k + 120, 50 * k)), (ox - 60, y0))
        leaf = 17 * k if not o else 3 * k
        im.alpha_composite(lt.crop((0, lt.height - leaf, lt.width, lt.height)), (c - LW * k // 2, y0 + Hh * k))
        lo = max(leaf, (SH + 3) * k); im.alpha_composite(lb.crop((0, 0, lb.width, lo)), (c - LW * k // 2, y0 + (Hh + 34) * k - lo))
        im.alpha_composite(head, (ox, y0)); im.alpha_composite(sill, (ox, y0 + (Hh + 34 - SH) * k))
    d.text((60, 960), 'EXAMPLE (drawn by code — only the idea): small pale-steel frames top and bottom like the modules', font=FS, fill=(255, 255, 255))
    im.save(path)
def tube_example(path):
    k = TUBE_K; im = Image.new('RGBA', (1536, 1024), BG + (255,)); d = ImageDraw.Draw(im)
    def tube(b, wu):
        x0, y0, x1, y1 = b; w = x1 - x0
        d.rectangle(b, fill=NAVY); d.rectangle((x0, y0, x0 + w * 0.12, y1), fill=NAVY3)
        d.rectangle((x0 + w * 0.2, y0 + 3 * k, x0 + w * 0.3, y1), fill=STEEL); d.line((x0 + w * 0.22, y0 + 3 * k, x0 + w * 0.22, y1), fill=STEEL_HI, width=2)
        d.rectangle((x1 - w * 0.22, y0, x1, y1), fill=NAVY2); d.rectangle((x1 - w * 0.08, y0, x1, y1), fill=DARK)
        d.rectangle((x0 - 0, y0, x1, y0 + 3 * k), fill=NAVY3); d.rectangle((x0, y0, x1, y0 + k * 0.6), fill=STEEL)    # the collar
        d.rectangle((x0, y0 + 3 * k, x1, y0 + 3.4 * k), fill=DARK)
        if wu > 12:
            d.rounded_rectangle((x0 + w * 0.45, y0 + 9 * k, x0 + w * 0.6, y0 + 15 * k), radius=3, fill=CYAN)
        bolt(d, x0 + w * 0.15, y0 + 1.6 * k, k * 0.5); bolt(d, x1 - w * 0.15, y0 + 1.6 * k, k * 0.5)
    for n, wu in [('tube1', 22), ('tube2', 16), ('tube3', 10)]: tube(box(TUBES, k, n), wu)
    bay, foot = art('gear_aquarius_bay'), art('gear_aquarius_foot')
    B = up(bay, 64 * k / bay.width); Fo = up(foot, 64 * k / foot.width)
    ex, ey = 820, 110; c = ex + B.width // 2; top = ey + B.height - 20; seg = 30 * k * 0.8
    for i, wu in list(enumerate([22, 16, 10]))[::-1]:
        tube((c - wu * k / 2, top + i * seg, c + wu * k / 2, top + i * seg + seg + 12), wu)
    im.alpha_composite(B, (ex, ey)); im.alpha_composite(Fo, (int(c - Fo.width / 2), int(top + 3 * seg + 10)))
    d.text((60, 960), 'EXAMPLE (drawn by code — only the idea): the piston in the navy of the mount, not grey-blue', font=FS, fill=(255, 255, 255))
    im.save(path)

def refs():
    # the module: its small frames circled
    room = up(art('room_default_aquarius'), 3); im = Image.new('RGBA', (room.width + 40, room.height + 40), BG + (255,))
    im.alpha_composite(room, (20, 20)); d = ImageDraw.Draw(im)
    for b in [(20 + 3 * 14, 20 + 3 * 18, 20 + 3 * 60, 20 + 3 * 56), (20 + 3 * 128, 20 + 3 * 28, 20 + 3 * 272, 20 + 3 * 82),
              (20 + 3 * 292, 20 + 3 * 60, 20 + 3 * 380, 20 + 3 * 110)]:
        d.ellipse((b[0] - 14, b[1] - 14, b[2] + 14, b[3] + 14), outline=(255, 210, 0), width=5)
    for y in (20 + 3 * 4, 20 + 3 * 192): d.rectangle((24, y - 14, room.width + 16, y + 14), outline=(255, 210, 0), width=4)
    im.save(os.path.join(OUT, '3_ref_modul_aquarius.png'))
    # Terra's doors: the parts and the game's door (structure to keep)
    parts = [art(n) for n in ['door_head_terra', 'door_sill_terra', 'door_leaf_top_terra', 'door_leaf_bot_terra',
                              'door_air_head_terra', 'door_air_sill_terra', 'door_air_leaf_top_terra', 'door_air_leaf_bot_terra']]
    im = Image.new('RGBA', (1400, 360), BG + (255,)); x = 20
    for i, p in enumerate(parts):
        P = up(p, 4); im.alpha_composite(P, (x, 20)); x += P.width + (60 if i == 3 else 20)
    im.save(os.path.join(OUT, '4_ref_drzwi_terra.png'))
    # the gear: the mount and foot we have (keep), the code's piston now (wrong colour), Terra's three tubes (the build)
    bay, foot = art('gear_aquarius_bay'), art('gear_aquarius_foot')
    im = Image.new('RGBA', (1500, 700), BG + (255,)); d = ImageDraw.Draw(im)
    B = up(bay, 3); im.alpha_composite(B, (20, 20)); Fo = up(foot, 3 * bay.width / foot.width * 0.83); im.alpha_composite(Fo, (20, 520))
    # the code's piston today (dockart.js drawStrut, STRUT_COL.aquarius), crossed out
    cx, t, b = 20 + B.width // 2, 20 + B.height - 10, 520
    seg = (b - t) / 3; W3 = [0.5 * 192, 0.36 * 192, 0.24 * 192]
    for i, (y0, y1, ww) in enumerate([(t, t + seg, W3[2]), (t + seg, t + 2 * seg, W3[1]), (t + 2 * seg, b, W3[0])]):
        d.rectangle((cx - ww / 2, y0, cx + ww / 2, y1), fill=(0x3c, 0x4a, 0x5c)); d.rectangle((cx - ww / 2 + ww * .18, y0, cx - ww / 2 + ww * .34, y1), fill=(0x9a, 0xb4, 0xcc))
        d.rectangle((cx + ww / 2 - ww * .22, y0, cx + ww / 2, y1), fill=(0x18, 0x20, 0x2c))
        if i: d.rectangle((cx - ww / 2 - 6, y0 - 9, cx + ww / 2 + 6, y0 + 9), fill=(0x2c, 0x5a, 0x8c))
    im.alpha_composite(B, (20, 20)); d.line((cx - 140, t + 10, cx + 140, b - 10), fill=(255, 40, 40), width=8); d.line((cx + 140, t + 10, cx - 140, b - 10), fill=(255, 40, 40), width=8)
    x = 720
    for n in ['gear_terra_tube1', 'gear_terra_tube2', 'gear_terra_tube3']:
        T = up(art(n), 3); im.alpha_composite(T, (x, 60)); x += T.width + 30
    d.text((720, 20), 'build: like these three tubes', font=FS, fill=(255, 255, 255))
    d.text((720, 420), 'colours: like the mount on the left', font=FS, fill=(255, 255, 255))
    im.save(os.path.join(OUT, '7_ref_podwozie_aquarius.png'))

door_guide(DOOR, os.path.join(OUT, '1_guide_drzwi_aquarius_x16.png'), False)
door_example(DOOR, os.path.join(OUT, '2_przyklad_drzwi_aquarius.png'), False)
door_guide(AIR, os.path.join(OUT, '5_guide_sluza_aquarius_x16.png'), True)
door_example(AIR, os.path.join(OUT, '6_przyklad_sluza_aquarius.png'), True)
tube_guide(os.path.join(OUT, '8_guide_tloki_aquarius_5x.png'))
tube_example(os.path.join(OUT, '9_przyklad_tloki_aquarius.png'))
refs()
print('ok', OUT)
