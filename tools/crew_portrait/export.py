#!/usr/bin/env python3
"""MOON WARS — tools/crew_portrait/export.py (update255)

THE PORTRAITS, SHARP (jj 23.11: the 96 px faces were the 30 px deck heads blown up, blurry). Five GPT sheets jj made
from claude/prompty-twarze-portrety-2026-11-23.md (src/T1..T5, 1536x1024, 6 x 4 cells of 256 px, magenta ground):
  T1 heads 1-8 (no eyes, no hair) + the neck and collar (slim, heavy)
  T2 eyes with brows: 8 open (odd = women's), the same 8 closed, 6 cybernetic
  T3 hair: 12 styles in front, 12 of what shows behind the head
  T4 beards: 8, and beards 1-4 for the heavy head
  T5 accessories: glasses ×6, patch, 2 scars, bandage, headband, cap, tattoo, earring, headset, nose ring, beanie, freckles

Every part is FITTED HERE to the one face it goes on (eyes up onto the eye line, a beard's mouth on the head's mouth,
hair a little higher than GPT put it…) and baked into a 128 px cell, so the game only stacks cells:
  art/crew2p_tint.png   grey lightness (+ alpha) of what the game recolours: skin, hair, brows, beard, suit fabric
  art/crew2p_fixed.png  what keeps its colour: outlines, eyes, lips, metal, lenses
  js/crew2pdata.js      CREW2P: the cell of every part
The tint rule is crew_v2's: lightness lifted (0.25 + 1.05 g) so dark hair keeps its shading; the dark outline and the
whites stay fixed.

Run:  python3 tools/crew_portrait/export.py      (from the repo root)
"""
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(os.path.dirname(__file__), 'src')
C, OUTC, COLS = 256, 128, 11

def load(name):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert('RGB')).astype(np.float32)

def key(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g                                  # how magenta: the ground is 255, pink lips ~75
    alpha = np.clip(1 - (m - 140) / (220 - 140), 0, 1)
    spill = np.clip(m, 0, None) * (1 - alpha)
    out = a.copy(); out[..., 0] = np.clip(r - spill, 0, 255); out[..., 2] = np.clip(b - spill, 0, 255)
    return out, alpha

def split(rgb, alpha, lens=False):
    r, g, b = rgb[..., 0] / 255, rgb[..., 1] / 255, rgb[..., 2] / 255
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    gl = r * 0.299 + g * 0.587 + b * 0.114
    neutral = sat < 0.10
    edge = (alpha < 0.95) & (sat < 0.55)                      # anti-aliased rims carry the magenta: grey them
    fixed_dark = gl < 0.13                                    # the outline keeps its black
    white = gl > 0.91                                         # eye whites, glints
    tint = (neutral | edge) & ~fixed_dark & ~white
    L = np.clip(0.25 + gl * 1.05, 0, 1) * 255
    T = np.zeros(rgb.shape[:2] + (4,), np.float32)
    T[..., 0] = T[..., 1] = T[..., 2] = L; T[..., 3] = np.where(tint, alpha, 0) * 255
    F = np.zeros(rgb.shape[:2] + (4,), np.float32)
    F[..., :3] = rgb; F[..., 3] = np.where(~tint, alpha, 0) * 255
    if lens:                                                  # lenses came out violet (the magenta behind): pale glass
        d = mx - mn + 1e-6
        hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
        vio = (hue > 255) & (hue < 330) & (sat > 0.18) & (F[..., 3] > 76) & (gl > 0.43)
        F[vio] = [200, 235, 255, 90]
    return T, F

def sheet(name, lens=False):
    rgb, alpha = key(load(name))
    T, F = split(rgb, alpha, lens)
    cell = lambda arr, i: Image.fromarray(arr[(i // 6) * C:(i // 6 + 1) * C, (i % 6) * C:(i % 6 + 1) * C].astype(np.uint8))
    return lambda i: (cell(T, i), cell(F, i))

def xform(im, s=1.0, dx=0, dy=0, cx=128, cy=128):
    if s == 1 and dx == 0 and dy == 0: return im
    w = round(C * s); im2 = im.resize((w, w), Image.LANCZOS)
    out = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    out.paste(im2, (round(cx - cx * s + dx), round(cy - cy * s + dy)), im2)
    return out

HEAD = dict(s=0.92, dy=-14)                                   # every face a little smaller and higher: room for the collar
EYES = dict(s=0.86, dy=-30, cy=150)                           # GPT drew them on the nose: up onto the eye line
HAIR = dict(s=0.93, dy=-24)
HAIR_EXTRA = {9: -10}                                         # the bob's fringe off the eyes
ACC_EYES = dict(s=0.86, dy=-22, cy=140)                       # glasses, the patch, the tattoo under the eye
ACC_ON_EYES = {0, 1, 2, 3, 4, 5, 6, 12}
ACC_HEADGEAR = {9, 10, 11, 16}                                # bandage, headband, cap, beanie: up onto the brow
HAT = dict(s=0.95, dy=-34, cy=60)

def both(pair, *steps):
    t, f = pair
    for st in steps: t, f = xform(t, **st), xform(f, **st)
    return t, f

def beard_dy(pair):
    a = np.maximum(np.asarray(pair[0])[..., 3], np.asarray(pair[1])[..., 3])
    idx = np.where(a[:, 128] > 128)[0]
    gaps = [(idx[k], idx[k + 1]) for k in range(len(idx) - 1) if 20 < idx[k + 1] - idx[k] < 60]
    if gaps: g = gaps[-1]; return 182 - (g[0] + g[1]) / 2   # its mouth on the head's mouth
    ys = np.where(a.max(1) > 128)[0]
    return 174 - ys.max()                                     # a moustache: just over the lip

def collar(pair):
    """The neck in skin, the shoulders in the suit's colour: two tint cells, split at the collar ring's top."""
    t, f = pair
    fa = np.asarray(f)[..., 3]; ys = np.where(fa.max(1) > 0)[0]
    ring = int(ys.min()) + 4 if len(ys) else 180
    ta = np.asarray(t).copy(); skin = ta.copy(); suit = ta.copy()
    skin[ring:, :, 3] = 0; suit[:ring, :, 3] = 0
    return Image.fromarray(skin), Image.fromarray(suit), f

def main():
    T1, T2, T3, T4, T5 = sheet('T1_heads.png'), sheet('T2_eyes.png'), sheet('T3_hair.png'), sheet('T4_beards.png'), sheet('T5_accessories.png', lens=True)
    cells, index = [], {}
    def put(kind, i, t, f):
        index.setdefault(kind, {})[str(i)] = len(cells); cells.append((t, f))
    for i in range(8): put('head', i, *both(T1(i), HEAD))
    for i in range(22): put('eyes', i, *both(T2(i), EYES, HEAD))
    for i in range(12):
        hs = dict(HAIR, dy=HAIR['dy'] + HAIR_EXTRA.get(i, 0))
        put('hair', i, *both(T3(i), hs))
        put('hairBack', i, *both(T3(12 + i), hs))
    for i in range(12):
        p = T4(i); put('beard', i, *both(p, dict(s=0.92, dy=beard_dy(p), cy=180), HEAD))
    for i in range(18):
        put('acc', i, *(both(T5(i), ACC_EYES, HEAD) if i in ACC_ON_EYES else both(T5(i), HAT, HEAD) if i in ACC_HEADGEAR else both(T5(i), HEAD)))
    empty = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    for k, i in (('slim', 8), ('heavy', 9)):
        skin, suit, f = collar(T1(i))
        index.setdefault('neck', {})[k] = len(cells); cells.append((skin, empty))
        index.setdefault('collar', {})[k] = len(cells); cells.append((suit, f))
    rows = (len(cells) + COLS - 1) // COLS
    At = Image.new('RGBA', (COLS * OUTC, rows * OUTC), (0, 0, 0, 0)); Af = At.copy()
    for n, (t, f) in enumerate(cells):
        xy = ((n % COLS) * OUTC, (n // COLS) * OUTC)
        At.paste(t.resize((OUTC, OUTC), Image.LANCZOS), xy); Af.paste(f.resize((OUTC, OUTC), Image.LANCZOS), xy)
    At.convert('LA').save(os.path.join(ROOT, 'art', 'crew2p_tint.png'), optimize=True)
    Af.quantize(256, method=Image.Quantize.FASTOCTREE).save(os.path.join(ROOT, 'art', 'crew2p_fixed.png'), optimize=True)   # flat art: 256 colours do
    meta = {'version': 1, 'cw': OUTC, 'ch': OUTC, 'cols': COLS, 'n': len(cells), 'index': index,
            '_readme': 'update255 portrait layers — written by tools/crew_portrait/export.py, do not edit by hand'}
    with open(os.path.join(ROOT, 'js', 'crew2pdata.js'), 'w') as fh:
        fh.write('/* MOON WARS — crew2pdata.js (update255): GENERATED by tools/crew_portrait/export.py — do not edit by hand.\n'
                 '   Where every portrait part sits in art/crew2p_tint.png and art/crew2p_fixed.png (128 px cells). */\n'
                 "'use strict';\nconst CREW2P = " + json.dumps(meta, separators=(',', ':')) + ';\n'
                 "if (typeof window !== 'undefined') window.CREW2P = CREW2P;\n")
    print(len(cells), 'cells', At.size)

if __name__ == '__main__':
    main()
