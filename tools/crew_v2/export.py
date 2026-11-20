#!/usr/bin/env python3
"""MOON WARS — update246: the crew from LAYERS (jj 20.11, the RimWorld way), exported for the game.

Sources (GPT, magenta background, 8 columns x 4 rows of 192x256 cells = the 24x32 crew frame at 8x), in src/:
  glowy.png   blank heads: 8 heads x front / side / back           (rows 0-2)
  oczy.png    eyes + brows: 8 x front / side                       (rows 0-1)
  wlosy.png   hair: 8 x front / side / back                        (rows 0-2)
  brody.png   beards: 8 x front / side                             (rows 0-1)
  chod.png    the body walking, side view, 12 frames                (row 0 x8 + row 1 x4)
  akcje_bok.png  side: idle 4, shoot 4 / punch 4, repair 4 / hit 2, death 2
  przod.png   front: idle 4, eat 4 / heal 4, salute 4 / arms crossed 4
  tyl.png     back: idle 4, work 4 / work 8
Every body has NO head and a closed metal collar at the same point of its cell (x 99, y 96), except where the pose
moves it (kneeling, hit, falling); the head and the hologram shield are laid on the collar by the game.

What it writes (art/):
  crew2_head_tint.png / crew2_head_fixed.png   — every head, and every eye/hair/beard ALREADY FITTED to every head
                                                 (a part GPT drew for head j, moved and scaled onto head k), each in
                                                 a 60x60 cell centred on the helmet's centre, at 3 px a game unit
  crew2_<sheet>_tint.png / _fixed.png / _over.png — the body frames, 72x96 cells (24x32 units at 3 px)
  crew2.json   — where every cell is, and per body frame where the helmet sits and how it tilts
"_tint" holds the parts the game recolours (skin, hair, suit fabric) as a grey LIGHTNESS the game multiplies its colour
into; "_fixed" holds what keeps its own colour (outlines, eyes, metal, boots); "_over" is the mask of a body frame's
pixels that go IN FRONT of the head and the shield (a hand raised past the collar, the collar's front lip).

    python3 tools/crew_v2/export.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
ART = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'art')
CW, CH = 192, 256                     # source cell (8 px a unit)
K = 3                                 # export: 3 px a unit
D = 112                               # helmet diameter at 8x
BLOCK8 = 160                          # head block at 8x (the helmet's square), -> 60 px
BLOCK = BLOCK8 * K // 8               # 60
BODY_W, BODY_H = 24 * K, 32 * K       # 72 x 96
HEAD_SCALE = 0.57 * D / 118           # the head inside the helmet (prototype, jj ok 20.11)
SIDE_SHIFT = -5                       # side view: the head 5 px (8x) back in the bubble (jj 20.11)

def load(name):
    a = np.array(Image.open(os.path.join(SRC, name)).convert('RGB')).astype(np.int16)
    pink = (a[:, :, 0] - a[:, :, 1] > 100) & (a[:, :, 2] - a[:, :, 1] > 100)
    return np.dstack([a.astype(np.uint8), np.where(pink, 0, 255).astype(np.uint8)])
def cell(S, r, c): return S[r * CH:(r + 1) * CH, c * CW:(c + 1) * CW]

HEAD, EYES, HAIR, BEARD = load('glowy.png'), load('oczy.png'), load('wlosy.png'), load('brody.png')

# ── fitting a part drawn for head j onto head k (the rules jj approved on 20.11) ───────────────────────────────
def box(r, c):
    m = cell(HEAD, r, c)[:, :, 3] > 0; ys, xs = np.nonzero(m); top, bot = ys.min(), ys.max(); h = bot - top
    y = int(top + 0.18 * h); row = np.nonzero(m[y])[0]
    return dict(top=top, bot=bot, cx=(row.min() + row.max()) / 2, w=row.max() - row.min(), h=h,
                bx0=xs.min(), bx1=xs.max(), by0=ys.min(), by1=ys.max())
BOX = {(r, c): box(r, c) for r in range(3) for c in range(8)}
def _paste(part, sx, sy, ox, oy):
    im = Image.fromarray(part, 'RGBA').resize((max(1, round(CW * sx)), max(1, round(CH * sy))), Image.LANCZOS)
    out = Image.new('RGBA', (CW, CH), (0, 0, 0, 0)); out.paste(im, (round(ox), round(oy)), im)
    a = np.array(out); a[:, :, 3] = np.where(a[:, :, 3] > 110, 255, 0); return a
def warp(part, src, dst):
    sx = dst['w'] / src['w']; sy = dst['h'] / src['h']
    return _paste(part, sx, sy, dst['cx'] - src['cx'] * sx, dst['top'] - src['top'] * sy)
def edges(r, c, f0, f1):
    m = cell(HEAD, r, c)[:, :, 3] > 0; b = BOX[(r, c)]; out = []
    for k in range(12):
        fr = f0 + (f1 - f0) * k / 11; y = int(b['top'] + fr * b['h']); row = np.nonzero(m[y])[0]
        if len(row): out.append((fr, row.min(), row.max()))
    return out
def warp_hair(part, v, j, k):
    bj, bk = BOX[(v, j)], BOX[(v, k)]; sy = bk['h'] / bj['h'] * 1.02
    f1 = {0: 0.5, 1: 0.55, 2: 0.8}[v]
    ej, ek = edges(v, j, 0.06, f1), edges(v, k, 0.06, f1)
    n = min(len(ej), len(ek)); sx = max((ek[i][2] - ek[i][1]) / max(1, (ej[i][2] - ej[i][1])) for i in range(n)) * 1.04
    oy = bk['top'] - bj['top'] * sy - 2
    if v == 1:
        ox = min(e[1] for e in ek) - min(e[1] for e in ej) * sx - 3
    else:
        al = part[:, :, 3] > 0; ys, xs = np.nonzero(al); t1 = ys.min() + 0.35 * (ys.max() - ys.min())
        top = xs[ys <= t1]; cj = (top.min() + top.max()) / 2
        ox = np.mean([(e[1] + e[2]) / 2 for e in ek]) - cj * sx
    return _paste(part, sx, sy, ox, oy)
EYE_LIFT = 0.05
def warp_eyes(part, v, j, k):
    a = warp(part, BOX[(v, j)], BOX[(v, k)]); al = a[:, :, 3] > 0
    if not al.any(): return a
    ys, xs = np.nonzero(al); hm = cell(HEAD, v, k)[:, :, 3] > 0; bk = BOX[(v, k)]
    if v == 0: dx = round(bk['cx'] - (xs.min() + xs.max()) / 2)
    else:
        row = np.nonzero(hm[int(ys.mean())])[0]; dx = round(row.max() - 0.10 * bk['w'] - xs.max())
    a = np.roll(a, -round(EYE_LIFT * bk['h']), axis=0)
    return np.roll(a, dx, axis=1)
def warp_beard(part, v, j, k):
    a = warp(part, BOX[(v, j)], BOX[(v, k)]); al = a[:, :, 3] > 0
    if not al.any(): return a
    ys, xs = np.nonzero(al); bk = BOX[(v, k)]; hm = cell(HEAD, v, k)[:, :, 3] > 0
    if v == 0: dx = round(bk['cx'] - (xs.min() + xs.max()) / 2)
    else:
        row = np.nonzero(hm[int(np.clip(ys.min() + 4, 0, CH - 1))])[0]
        dx = round((row.max() if len(row) else bk['cx']) + 2 - xs.max())
    return np.roll(a, dx, axis=1)
BEARD_CLIP = {0, 5}

# ── tint / fixed split ───────────────────────────────────────────────────────────────────────────────────────
def split_head(a):
    """heads, eyes, hair, beards: neutral greys tint (lightness lifted so dark hair keeps its shading), the rest fixed"""
    rgb = a[:, :, :3].astype(float); g = rgb.mean(axis=2) / 255; sat = rgb.max(axis=2) - rgb.min(axis=2)
    al = a[:, :, 3] > 0; fixed = al & ((sat >= 30) | (g < 0.13) | (g > 0.9)); tint = al & ~fixed
    L = np.clip(0.25 + g * 1.05, 0, 1) * 255
    t = np.zeros_like(a); t[tint, :3] = L[tint][:, None]; t[tint, 3] = 255
    f = np.zeros_like(a); f[fixed] = a[fixed]
    return t, f
def split_body(a):
    """suit fabric (pure neutral grey) tints; boots, gloves, collar, tanks (blue steel) and the outline stay"""
    rgb = a[:, :, :3].astype(float); g = rgb.mean(axis=2); sat = rgb.max(axis=2) - rgb.min(axis=2)
    al = a[:, :, 3] > 0; fab = al & (sat < 12) & (g > 60) & (g < 240)
    L = np.clip(0.22 + g / 255, 0, 1) * 255
    t = np.zeros_like(a); t[fab, :3] = L[fab][:, None]; t[fab, 3] = 255
    f = np.zeros_like(a); fx = al & ~fab; f[fx] = a[fx]
    return t, f

# ── heads: every head and every fitted part, in the helmet's square ──────────────────────────────────────────
def to_block(a, v, k):
    """cell coords of head k (8x) -> the 60x60 helmet square (3x): the head scaled into the bubble, its own box
    centred on the bubble's centre (+4 px down at 8x, and back in the side view)"""
    b = BOX[(v, k)]; s = HEAD_SCALE
    bw, bh = (b['bx1'] - b['bx0'] + 1), (b['by1'] - b['by0'] + 1)
    cx = BLOCK8 / 2 + (SIDE_SHIFT if v == 1 else 0); cy = BLOCK8 / 2 + 4
    big = Image.new('RGBA', (BLOCK8, BLOCK8), (0, 0, 0, 0))
    im = Image.fromarray(a, 'RGBA').resize((round(CW * s), round(CH * s)), Image.LANCZOS)
    ox = cx - (b['bx0'] + bw / 2) * s; oy = cy - (b['by0'] + bh / 2) * s
    big.paste(im, (round(ox), round(oy)), im)
    return np.array(big.resize((BLOCK, BLOCK), Image.LANCZOS))

class Atlas:
    def __init__(self, cw, ch, cols): self.cw, self.ch, self.cols, self.cells = cw, ch, cols, []
    def add(self, *layers): self.cells.append(layers); return len(self.cells) - 1
    def save(self, names):
        rows = (len(self.cells) + self.cols - 1) // self.cols
        for li, name in enumerate(names):
            im = Image.new('RGBA', (self.cols * self.cw, rows * self.ch), (0, 0, 0, 0))
            for i, layers in enumerate(self.cells):
                im.paste(Image.fromarray(layers[li], 'RGBA'), ((i % self.cols) * self.cw, (i // self.cols) * self.ch))
            path = os.path.join(ART, name + '.png')
            if name.endswith('_tint') or name.endswith('_over'):
                im.convert('LA').save(path, optimize=True)          # grey lightness + alpha: half the bytes
            else:
                q = im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
                q.save(path, optimize=True)                          # outlines, eyes, metal: 256 colours are plenty
                if os.path.getsize(path) > im.size[0] * im.size[1]:  # (never let the palette make it bigger)
                    im.save(path, optimize=True)
        return {'cw': self.cw, 'ch': self.ch, 'cols': self.cols, 'n': len(self.cells)}

def export_heads(meta):
    A = Atlas(BLOCK, BLOCK, 24); idx = {'head': {}, 'eyes': {}, 'hair': {}, 'beard': {}}
    def put(kind, key, a8, v, k):
        t, f = split_head(a8); idx[kind][key] = A.add(to_block(t, v, k), to_block(f, v, k))
    for v in range(3):
        for k in range(8):
            hd = cell(HEAD, v, k); face = hd[:, :, 3] > 0; b = BOX[(v, k)]
            put('head', f'{v}.{k}', hd, v, k)
            for j in range(8):
                put('hair', f'{v}.{k}.{j}', warp_hair(cell(HAIR, v, j), v, j, k), v, k)
                if v < 2:
                    e = warp_eyes(cell(EYES, v, j), v, j, k); e[:, :, 3] = np.where(face, e[:, :, 3], 0)
                    put('eyes', f'{v}.{k}.{j}', e, v, k)
                    bd = warp_beard(cell(BEARD, v, j), v, j, k)
                    yy = np.arange(CH)[:, None]; jaw = b['bot'] - 0.12 * b['h']
                    keep = face | ((yy > jaw) & (j not in BEARD_CLIP)); bd[:, :, 3] = np.where(keep, bd[:, :, 3], 0)
                    put('beard', f'{v}.{k}.{j}', bd, v, k)
    meta['heads'] = {'atlas': A.save(['crew2_head_tint', 'crew2_head_fixed']), 'index': idx}

# ── bodies ───────────────────────────────────────────────────────────────────────────────────────────────────
def collar(S, r, c):
    """the collar: thin, long, light blue-steel pieces nearest the top of the figure; centre, 'up' and tilt"""
    a = cell(S, r, c); raw = a[:, :, :3].astype(int); al = a[:, :, 3] > 0
    blue = al & (raw[:, :, 2] - raw[:, :, 0] > 25) & (raw.mean(axis=2) > 140)
    lab, n = ndimage.label(blue); cand = []
    for k in range(1, n + 1):
        m = lab == k; yy, xx = np.nonzero(m)
        if len(yy) < 40: continue
        cy, cx = yy.mean(), xx.mean(); w, v = np.linalg.eigh(np.cov(np.vstack([xx - cx, yy - cy])))
        el = np.sqrt(w.max() / max(w.min(), 1e-3)); L = 4 * np.sqrt(w.max())
        if el > 3.0 and 18 < L < 45: cand.append((el, cx, cy, v[:, np.argmax(w)], m))
    by, _ = np.nonzero(al); near = [t for t in cand if t[2] < by.min() + 30]
    cand = sorted(near or cand, key=lambda t: -t[0]); el, cx, cy, mj, m = cand[0]
    mask = np.zeros_like(blue)
    for t in cand:
        if np.hypot(t[1] - cx, t[2] - cy) < 16: mask |= t[4]
    yy, xx = np.nonzero(mask); cx, cy = xx.mean(), yy.mean()
    ang = (np.degrees(np.arctan2(mj[1], mj[0])) + 90) % 180 - 90; t = np.radians(ang)
    nrm = np.array([np.sin(t), -np.cos(t)]); bby, bbx = np.nonzero(al)
    if np.dot(nrm, np.array([cx, cy]) - np.array([bbx.mean(), bby.mean()])) < 0: nrm = -nrm
    tilt = float(np.degrees(np.arctan2(nrm[0], -nrm[1])))
    return cx, cy, tilt, nrm, ndimage.binary_dilation(mask, iterations=3) & al

SHEETS = {   # name: (file, view, frames as (row, col))
    'walk':  ('chod.png', 1, [(0, i) for i in range(8)] + [(1, i) for i in range(4)]),
    'side':  ('akcje_bok.png', 1, [(0, i) for i in range(8)] + [(1, i) for i in range(8)] + [(2, i) for i in range(4)]),
    'front': ('przod.png', 0, [(0, i) for i in range(8)] + [(1, i) for i in range(8)] + [(2, i) for i in range(4)]),
    'back':  ('tyl.png', 2, [(0, i) for i in range(8)] + [(1, i) for i in range(8)]),
}
def shrink(a):
    return np.array(Image.fromarray(a, 'RGBA').resize((BODY_W, BODY_H), Image.LANCZOS))
def export_bodies(meta):
    meta['bodies'] = {}
    for name, (fname, view, frames) in SHEETS.items():
        S = load(fname); A = Atlas(BODY_W, BODY_H, 8); fr = []
        for (r, c) in frames:
            a = cell(S, r, c); cx, cy, tilt, nrm, cap = collar(S, r, c)
            if abs(tilt) < 5: tilt = 0.0
            al = a[:, :, 3] > 0; yy = np.arange(CH)[:, None]; xx = np.arange(CW)[None, :]
            along = (xx - cx) * nrm[0] + (yy - cy) * nrm[1]
            over = cap & (along < -1)
            if view != 2: over |= al & (along > 4) & ~cap     # a raised hand: in front of the head (not from behind)
            o = np.zeros_like(a); o[over, 3] = 255; o[over, :3] = 255
            t, f = split_body(a)
            A.add(shrink(t), shrink(f), shrink(o))
            hc = np.array([cx, cy]) + nrm * (D / 2 - 7)
            fr.append({'hx': round(float(hc[0]) * K / 8, 2), 'hy': round(float(hc[1]) * K / 8, 2), 'tilt': round(tilt, 1)})
        meta['bodies'][name] = {'atlas': A.save([f'crew2_{name}_tint', f'crew2_{name}_fixed', f'crew2_{name}_over']),
                                'view': view, 'frames': fr}

if __name__ == '__main__':
    meta = {'version': 1, 'k': K, 'block': BLOCK, 'helmet_r': round(D / 2 * K / 8, 2), 'body': [BODY_W, BODY_H],
            '_readme': 'update246 crew from layers — written by tools/crew_v2/export.py, do not edit by hand'}
    export_heads(meta); export_bodies(meta)
    with open(os.path.join(ART, 'crew2.json'), 'w') as fh: json.dump(meta, fh, separators=(',', ':'))
    # the same data as a script, so the game (and the tests, which load no images) have it without a fetch
    JS = os.path.join(os.path.dirname(ART), 'js', 'crew2data.js')
    with open(JS, 'w') as fh:
        fh.write('/* MOON WARS — crew2data.js (update246): GENERATED by tools/crew_v2/export.py — do not edit by hand.\n'
                 '   Where every layered-crew part sits in art/crew2_*.png, and where the helmet sits on every body frame. */\n'
                 "'use strict';\nconst CREW2 = " + json.dumps(meta, separators=(',', ':')) + ';\n')
    print('ok', {k: (v['atlas'] if 'atlas' in v else {n: b['atlas']['n'] for n, b in v.items()}) for k, v in meta.items() if isinstance(v, dict)})
