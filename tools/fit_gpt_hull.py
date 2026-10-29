#!/usr/bin/env python3
"""MOON WARS — fit a ship GPT drew to the game's grid (update175).

    python3 tools/fit_gpt_hull.py <key> <cut_away.png> <exterior.png> <out_dir> [--stern U] [--bow U]

update177: prompts v3 pictures (cold nozzles with MAGENTA triangles) are
read for the nozzles and the markers taken out; --stern/--bow squeeze the
stern and the bow across to at most U grid units (Terra: 95 / 75).

Takes the two pictures GPT drew on the hull's skeleton (prompts v2 in
claude/kierunek-2026-10-29-wyglad-statkow.md):

  cut_away   the ship with every module a flat BLUE rectangle and the
             lift shaft a flat GREEN one
  exterior   the same ship closed — armour over every module

and writes, at 1.5 px per grid unit (the Full HD screen):

  <out_dir>/<key>_hull_in.png    the cut-away, background and windows
                                 transparent (the game's rooms show there)
  <out_dir>/<key>_hull_out.png   the armour over the same outline
  <out_dir>/<key>_fit.json       {"org": [ox, oy], ...} for
                                 tools/gen_shaped_hull_art.py --org

HOW IT FITS. The blue and green rectangles are found and matched to the
hull's columns and decks in SHIP_LAYOUTS. Every edge between two of them
(the middle of the post or band GPT drew there) goes exactly onto the
grid line the game has — so whatever GPT made a little wider or a little
narrower, each module lands exactly on its room. Outside the modules the
shape is scaled at one scale, the same across and down, so the bow and
the stern keep their proportions. The exterior is laid over the
cut-away by its outline first (GPT never draws it at quite the same
place), then fitted the same way.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1.5            # px per grid unit in the game's art
SHAFT_W = 30

def layout(key):
    js = ("const h=require('./tests/harness.js');const sb=h.loadEngine();"
          f"const L=sb.SHIP_LAYOUTS[{json.dumps(key)}];"
          "console.log(JSON.stringify({builder:L.builder,rooms:L.rooms.map(r=>({x:r.x,y:r.y,w:r.w,h:r.h})),"
          "shafts:(L.elevators??[]).map(e=>e.x)}))")
    out = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True).stdout
    return json.loads(out.strip().splitlines()[-1])

def rects(a):
    """The big flat blue (modules) and green (shaft) rectangles."""
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    blue = (b > 200) & (r < 90) & (g < 120) & (b - g > 120)
    green = (g > 180) & (r < 120) & (b < 160)
    out = []
    for kind, m in (('module', blue), ('shaft', green)):
        lab, _ = nd.label(m)
        for k, sl in enumerate(nd.find_objects(lab)):
            n = (lab[sl] == k + 1).sum()
            if n > 3000:
                out.append({'kind': kind, 'x0': sl[1].start, 'x1': sl[1].stop,
                            'y0': sl[0].start, 'y1': sl[0].stop})
    return out, blue | green

def silhouette(a):
    """The ship against GPT's background. The background is FLAT — the
    dark field and the slightly lighter skeleton area are each one
    colour — while even the darkest machinery of the hull has texture.
    So the background is what is close to one of those two shades AND
    flat, reached from the edge of the picture or in a big patch; the
    rest is the ship (the dashed frame's thin lines opened away, the
    skeleton's loose marks far from the hull dropped)."""
    px = a[:, :, :3].astype(float)
    bg = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3)]), axis=0)
    d = np.sqrt(((px - bg) ** 2).sum(axis=2))
    near = (d > 10) & (d < 40) & (px.max(axis=2) < 80)
    bg2 = np.median(px[near], axis=0) if near.sum() > 1000 else bg
    d2 = np.sqrt(((px - bg2) ** 2).sum(axis=2))
    lum = px.mean(axis=2)
    m = nd.uniform_filter(lum, 5); sd = np.sqrt(np.maximum(nd.uniform_filter(lum ** 2, 5) - m ** 2, 0))
    cand = ((d < 16) | (d2 < 12)) & (sd < 3.0)
    # along the frame's lines the field is not flat (the dashes are right
    # there), so near either shade is enough: the strip between the frame
    # and a ridge joins the field through the gaps in the dashes
    fld = (d2 < 10) & (sd < 2.5)
    if fld.sum() > 5000:
        fy, fx = np.nonzero(fld)
        y0, y1 = np.percentile(fy, [0.05, 99.95]).astype(int); x0, x1 = np.percentile(fx, [0.05, 99.95]).astype(int)
        fb = np.zeros_like(cand)
        for r in (y0, y1): fb[max(0, r - 8):r + 8, :] = True
        for c in (x0, x1): fb[:, max(0, c - 8):c + 8] = True
        cand |= fb & ((d < 18) | (d2 < 14))
    lab, n = nd.label(cand)
    sizes = nd.sum(cand, lab, range(1, n + 1))
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    # a patch of field caught between the frame line and the ridges is
    # field too — the hull's own darks are blacker than either shade
    bgk = [k + 1 for k in range(n) if (k + 1) in edge or sizes[k] > 300]
    bgm = np.isin(lab, bgk)
    bgm = nd.binary_dilation(bgm, iterations=1)          # the soft fringe of the field
    fg = ~bgm
    fg = nd.binary_opening(fg, structure=np.ones((3, 3)))
    # THE DASHED FRAME: thin lines in one dim grey-blue, nowhere thick
    dash = (np.abs(px - np.array([36, 45, 65])).max(axis=2) < 16)
    thick = nd.binary_dilation(nd.binary_opening(fg, structure=np.ones((9, 9))), iterations=3)
    fg &= ~(dash & ~thick)
    # …and its lines whole: the rows and columns it runs along, ±4 px,
    # wherever the hull is not thick (its soft edges are off the grey)
    rows = np.nonzero(dash.sum(axis=1) > 250)[0]; cols = np.nonzero(dash.sum(axis=0) > 80)[0]
    # only the frame itself: the outermost of those lines (the hull's own
    # dark plating is that grey too, and stays)
    edge = lambda v: v[(v <= v.min() + 8) | (v >= v.max() - 8)] if len(v) else v
    rows, cols = edge(rows), edge(cols)
    band = np.zeros_like(fg)
    for r in rows: band[max(0, r - 5):r + 6, :] = True
    for c in cols: band[:, max(0, c - 5):c + 6] = True
    # …and wherever its dashes are lighter (GPT draws them either way):
    # the frame is the edge of the lighter skeleton field, whatever its colour
    field = (d2 < 10) & (sd < 2.5)
    if field.sum() > 5000:
        fy, fx = np.nonzero(field)
        y0, y1 = np.percentile(fy, [0.05, 99.95]).astype(int); x0, x1 = np.percentile(fx, [0.05, 99.95]).astype(int)
        for r in (y0, y1): band[max(0, r - 7):r + 7, :] = True
        for c in (x0, x1): band[:, max(0, c - 7):c + 7] = True
        rows = np.unique(np.concatenate([rows, [y0, y1]])); cols = np.unique(np.concatenate([cols, [x0, x1]]))
    fg &= ~(band & ~nd.binary_dilation(nd.binary_opening(fg, structure=np.ones((9, 9))), iterations=1))
    fg = nd.binary_opening(fg, structure=np.ones((3, 3)))
    lab, n = nd.label(fg)
    if n > 1:
        sizes = nd.sum(fg, lab, range(1, n + 1))
        mk = 1 + int(np.argmax(sizes)); main = lab == mk
        msl = nd.find_objects(lab)[mk - 1]
        far = nd.distance_transform_edt(~main)
        keep = []
        for k, sl in enumerate(nd.find_objects(lab)):
            if k + 1 == mk: keep.append(mk); continue
            if sizes[k] < 30 or far[lab == k + 1].min() >= 45: continue
            # THE SKELETON'S ARROWS ◄ ►: a small loose cyan piece hard by the frame's ends
            fx0 = cols.min() if len(cols) else 0; fx1 = cols.max() if len(cols) else fg.shape[1]
            if sizes[k] < 900 and (sl[1].start < fx0 + 45 or sl[1].stop > fx1 - 45):
                c = px[sl][lab[sl] == k + 1].mean(axis=0)
                if c[2] > 150 and c[1] > 110 and c[0] < 110: continue
            keep.append(k + 1)
        fg = np.isin(lab, keep)
    # enclosed holes are filled — all but a patch of the field itself
    # (flat, its colour, bigger than a speck): that is background GPT
    # left showing between the frame line and a ridge, or through the hull
    holes = nd.binary_fill_holes(fg) & ~fg
    hl, hn = nd.label(holes)
    if hn:
        hs = nd.sum(holes, hl, range(1, hn + 1)); hc = nd.sum(cand, hl, range(1, hn + 1))
        fill = [k + 1 for k in range(hn) if hs[k] < 300 or hc[k] < hs[k] * 0.6]
        fg |= np.isin(hl, fill)
    return fg, d

def breakpoints(L, found):
    """Image x and y edges ↔ grid x and y lines."""
    xs, ys = {}, {}
    gx0 = min(r['x'] for r in L['rooms']); gx1 = max(r['x'] + r['w'] for r in L['rooms'])
    gy0 = min(r['y'] for r in L['rooms']); gy1 = max(r['y'] + r['h'] for r in L['rooms'])
    mods = [f for f in found if f['kind'] == 'module']
    ix0 = min(f['x0'] for f in mods); ix1 = max(f['x1'] for f in mods)
    iy0 = min(f['y0'] for f in mods); iy1 = max(f['y1'] for f in mods)
    # grid elements along x: every room column and every shaft
    cols = sorted({(r['x'], r['x'] + r['w']) for r in L['rooms']} |
                  {(s - SHAFT_W // 2, s + SHAFT_W // 2) for s in L['shafts']})
    decks = sorted({(r['y'], r['y'] + r['h']) for r in L['rooms']})
    gx = lambda ix: gx0 + (ix - ix0) / (ix1 - ix0) * (gx1 - gx0)
    gy = lambda iy: gy0 + (iy - iy0) / (iy1 - iy0) * (gy1 - gy0)
    colimg = {c: [] for c in cols}; deckimg = {d: [] for d in decks}
    for f in found:
        cx = gx((f['x0'] + f['x1']) / 2)
        c = min(cols, key=lambda c: abs((c[0] + c[1]) / 2 - cx))
        colimg[c].append((f['x0'], f['x1']))
        if f['kind'] == 'module':
            cy = gy((f['y0'] + f['y1']) / 2)
            d = min(decks, key=lambda d: abs((d[0] + d[1]) / 2 - cy))
            deckimg[d].append((f['y0'], f['y1']))
    miss = [c for c in cols if not colimg[c]] + [d for d in decks if not deckimg[d]]
    if miss: sys.exit(f'no rectangle found for {miss}')
    med = lambda v: (float(np.median([a for a, _ in v])), float(np.median([b for _, b in v])))
    def edges(elems, img):
        spans = [med(img[e]) for e in elems]
        gp, ip = [elems[0][0]], [spans[0][0]]
        for i in range(1, len(elems)):
            gp.append(elems[i][0])
            ip.append((spans[i - 1][1] + spans[i][0]) / 2)   # the middle of the post / band
        gp.append(elems[-1][1]); ip.append(spans[-1][1])
        return np.array(gp, float), np.array(ip, float)
    return edges(cols, colimg), edges(decks, deckimg)

def warp_maps(gxp, ixp, gyp, iyp, gbox, scale_img_per_unit, fx=(1.0, 1.0)):
    """For every output pixel, which source pixel (piecewise linear
    between the grid lines, one uniform scale outside them). `fx` squeezes
    the stern and the bow across (update177): (stern, bow), 1 = as drawn."""
    X0, Y0, W, H = gbox
    ox = np.arange(int(round(W * S))) / S + X0
    oy = np.arange(int(round(H * S))) / S + Y0
    def mp(u, gp, ip, f=(1.0, 1.0)):
        v = np.interp(u, gp, ip)
        v = np.where(u < gp[0], ip[0] - (gp[0] - u) * scale_img_per_unit / f[0], v)
        v = np.where(u > gp[-1], ip[-1] + (u - gp[-1]) * scale_img_per_unit / f[1], v)
        return v
    return mp(ox, gxp, ixp, fx), mp(oy, gyp, iyp)

def sample(img, sx, sy):
    from scipy.ndimage import map_coordinates
    yy, xx = np.meshgrid(sy, sx, indexing='ij')
    out = np.zeros(yy.shape + (img.shape[2],), np.float32)
    for c in range(img.shape[2]):
        out[:, :, c] = map_coordinates(img[:, :, c].astype(np.float32), [yy, xx], order=1, mode='constant')
    return out

def register(src_mask, dst_mask):
    """Scale and shift taking src's outline onto dst's (bbox, then a
    small search for the best overlap)."""
    def bb(m):
        ys, xs = np.nonzero(m); return xs.min(), xs.max(), ys.min(), ys.max()
    a, b = bb(src_mask), bb(dst_mask)
    sx = (b[1] - b[0]) / (a[1] - a[0]); sy = (b[3] - b[2]) / (a[3] - a[2])
    best = None
    small = 4                                     # search on a quarter-size copy
    dm = dst_mask[::small, ::small]
    yy, xx = np.mgrid[0:dm.shape[0], 0:dm.shape[1]] * small
    for ds in (0.98, 0.99, 1.0, 1.01, 1.02):
        for dsy in (0.98, 0.99, 1.0, 1.01, 1.02):
            kx, ky = sx * ds, sy * dsy
            for dx in range(-12, 13, 3):
                for dy in range(-12, 13, 3):
                    tx = b[0] + dx - a[0] * kx; ty = b[2] + dy - a[2] * ky
                    srcx = ((xx - tx) / kx).astype(int); srcy = ((yy - ty) / ky).astype(int)
                    ok = (srcx >= 0) & (srcy >= 0) & (srcx < src_mask.shape[1]) & (srcy < src_mask.shape[0])
                    sm = np.zeros_like(dm); sm[ok] = src_mask[srcy[ok], srcx[ok]]
                    iou = (sm & dm).sum() / max(1, (sm | dm).sum())
                    if best is None or iou > best[0]: best = (iou, kx, ky, tx, ty)
    return best

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('key'); ap.add_argument('fin'); ap.add_argument('fout'); ap.add_argument('od')
    # update177: GPT drew Terra's sterns and bows ~125 units long, against
    # Pegasus's ~90 — two such ships do not fit the screen side by side.
    # These squeeze what is drawn behind the modules / in front of them
    # ACROSS to at most this many grid units (not down: ridges keep theirs).
    ap.add_argument('--stern', type=float, default=None, help='stern overhang, grid units, at most')
    ap.add_argument('--bow', type=float, default=None, help='bow overhang, grid units, at most')
    args = ap.parse_args()
    key, fin, fout, od = args.key, args.fin, args.fout, args.od
    L = layout(key)
    A = np.array(Image.open(fin).convert('RGB'))
    B = np.array(Image.open(fout).convert('RGB'))
    found, winmask = rects(A)
    (gxp, ixp), (gyp, iyp) = breakpoints(L, found)
    k_img = (ixp[-1] - ixp[0]) / (gxp[-1] - gxp[0])          # image px per grid unit, across
    silA, _ = silhouette(A)
    silA |= nd.binary_dilation(winmask, iterations=2)
    magA = magenta(A)
    silA |= nd.binary_dilation(magA, iterations=1)       # the markers (v3) are part of her until read
    ys, xs = np.nonzero(silA)
    # the box: the shape's extent, in grid units, through the same map
    def to_grid(v, gp, ip, f=(1.0, 1.0)):
        if v < ip[0]: return gp[0] - (ip[0] - v) / k_img * f[0]
        if v > ip[-1]: return gp[-1] + (v - ip[-1]) / k_img * f[1]
        return float(np.interp(v, ip, gp))
    st0 = (ixp[0] - (xs.min() - 2)) / k_img; bw0 = ((xs.max() + 2) - ixp[-1]) / k_img
    fx = (min(1.0, args.stern / st0) if args.stern and st0 > 0 else 1.0,
          min(1.0, args.bow / bw0) if args.bow and bw0 > 0 else 1.0)
    gx_min = np.floor(to_grid(xs.min() - 2, gxp, ixp, fx)); gx_max = np.ceil(to_grid(xs.max() + 2, gxp, ixp, fx))
    gy_min = np.floor(to_grid(ys.min() - 2, gyp, iyp)); gy_max = np.ceil(to_grid(ys.max() + 2, gyp, iyp))
    gbox = (gx_min, gy_min, gx_max - gx_min, gy_max - gy_min)
    sx, sy = warp_maps(gxp, ixp, gyp, iyp, gbox, k_img, fx)

    # cut-away: ship pixels, minus the windows (a fringe of 2 px goes too)
    win = nd.binary_dilation(winmask, iterations=2)
    alphaA = (silA & ~win).astype(np.float32) * 255
    alphaA = nd.gaussian_filter(alphaA, 0.6)
    rgbaA = np.dstack([A.astype(np.float32), alphaA])
    outA = sample(rgbaA, sx, sy)

    # exterior: laid over the cut-away's outline, then the same map
    silB, _ = silhouette(B)
    silB |= nd.binary_dilation(magenta(B), iterations=1)
    iou, kx, ky, tx, ty = register(silB, silA)
    yy, xx = np.mgrid[0:A.shape[0], 0:A.shape[1]]
    from scipy.ndimage import map_coordinates
    alphaB = nd.gaussian_filter(silB.astype(np.float32) * 255, 0.6)
    rgbaB = np.dstack([B.astype(np.float32), alphaB])
    Bonto = np.zeros(A.shape[:2] + (4,), np.float32)
    for c in range(4):
        Bonto[:, :, c] = map_coordinates(rgbaB[:, :, c], [(yy - ty) / ky, (xx - tx) / kx], order=1, mode='constant')
    # the armour has the cut-away's outline exactly (prompt v2: "pixel for
    # pixel") — whatever of GPT's redraw strays past it is not the ship
    Bonto[:, :, 3] *= nd.binary_dilation(silA, iterations=3).astype(np.float32)
    outB = sample(Bonto, sx, sy)

    # ── FINISHING (update176): in the game's own pixels, round the modules ──
    mods = [(int(round((r['x'] - gbox[0]) * S)), int(round((r['y'] - gbox[1]) * S)),
             int(round(r['w'] * S)), int(round(r['h'] * S))) for r in L['rooms']]
    shafts = [(int(round((sx_ - SHAFT_W / 2 - gbox[0]) * S)), int(round((gyp[0] - gbox[1]) * S)),
               int(round(SHAFT_W * S)), int(round((gyp[-1] - gyp[0]) * S))) for sx_ in L['shafts']]
    outA, outB, rims = add_rims(outA, outB, mods + shafts, L.get('builder'))
    if magA.sum() > 50:
        # prompts v3: cold nozzles, a flat MAGENTA triangle at each one
        outA, outB, flames = read_markers(outA, outB, mods + shafts, L)
    else:
        outA, outB, flames = cut_flames(outA, outB, mods + shafts)
    top = top_profile(outA, outB)
    bottom = top_profile(outA[::-1], outB[::-1]); bottom = [outA.shape[0] - v for v in bottom]

    os.makedirs(od, exist_ok=True)
    for nm, o in (('in', outA), ('out', outB)):
        Image.fromarray(np.clip(o, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(od, f'{key}_hull_{nm}.png'))
    bx0 = min(r['x'] for r in L['rooms']); by0 = min(r['y'] for r in L['rooms'])
    org = [round((bx0 - gbox[0]) * S), round((by0 - gbox[1]) * S)]
    info = {'org': org, 'box_units': gbox, 'size': [outA.shape[1], outA.shape[0]],
            'src_px_per_unit': k_img, 'squeeze': [round(fx[0], 3), round(fx[1], 3)], 'exterior_overlap': round(float(iou), 3),
            'flames': flames, 'top': top, 'bottom': bottom, 'rims': rims,
            'grid_x': gxp.tolist(), 'img_x': ixp.tolist(), 'grid_y': gyp.tolist(), 'img_y': iyp.tolist()}
    json.dump(info, open(os.path.join(od, f'{key}_fit.json'), 'w'), indent=1)
    print(key, json.dumps({k: info[k] for k in ('org', 'size', 'box_units', 'exterior_overlap')}),
          f'{len(flames)} flames, {rims} rim runs')

# ── FINISHING (update176) ──────────────────────────────────────────────

def _inside(mask_shape, rects):
    m = np.zeros(mask_shape, bool)
    for x, y, w, h in rects: m[max(0, y):y + h, max(0, x):x + w] = True
    return m

# the rim plate's colours per shipyard: body, lit bevel, seam, rivet, lamp
RIM = {
    'pegasus': ((156, 184, 206), (220, 234, 244), (30, 40, 54), (64, 84, 104), (110, 215, 255)),
    'terra':   ((168, 96, 48), (226, 152, 92), (26, 24, 24), (72, 52, 36), (120, 240, 110)),
}

def magenta(a):
    """The flat #FF00FF markers GPT puts at every nozzle (prompts v3)."""
    r, g, b = (a[:, :, i].astype(int) for i in range(3))
    m = (r > 190) & (b > 190) & (g < 110)
    return nd.binary_opening(m, structure=np.ones((2, 2)))

def read_markers(A, B, rects, L):
    """update177 — the magenta triangles, read and taken out of both
    layers. Each one is a nozzle: it points the way the exhaust goes, so
    the flame goes from its base (the side against the hull) outwards.
        [x, y, dx, dy, length, width]  picture px, flown by you
    The stern's main drives (pointing back, at the stern end) get a big
    flame a deck's nozzle wide; the rest are manoeuvring thrusters."""
    H, W = A.shape[:2]
    inside = _inside((H, W), rects)
    al = A[:, :, 3]
    m = (A[:, :, 0] > 170) & (A[:, :, 2] > 170) & (A[:, :, 1] < 120) & (al > 60) & ~inside
    lab, n = nd.label(m)
    deck_h = min(r[3] for r in rects) if rects else 105
    flames, kill = [], np.zeros((H, W), bool)
    hull = (np.maximum(A[:, :, 3], B[:, :, 3]) > 128) & ~nd.binary_dilation(m, iterations=3)
    for k, sl in enumerate(nd.find_objects(lab)):
        comp = lab == k + 1
        if comp.sum() < 12: continue
        ys, xs = np.nonzero(comp); cy, cx = ys.mean(), xs.mean()
        # the hull round it: the flame points away from it
        ring = nd.binary_dilation(comp, iterations=8) & ~nd.binary_dilation(comp, iterations=2) & hull
        ry, rx = np.nonzero(ring)
        if len(rx):
            vx, vy = cx - rx.mean(), cy - ry.mean()
        else:
            vx, vy = (-1 if cx < W / 2 else 1), 0
        dx, dy = ((1 if vx > 0 else -1), 0) if abs(vx) >= abs(vy) else (0, (1 if vy > 0 else -1))
        along = (xs - cx) * dx + (ys - cy) * dy; across = -(xs - cx) * dy + (ys - cy) * dx
        base = along.min()
        nx, ny = cx + dx * base, cy + dy * base
        tri_w = float(np.ptp(across)) + 1
        main = dx == -1 and dy == 0 and nx < W * 0.18
        if main: length, width = 42.0, round(deck_h * 0.62, 1)
        else:    length, width = 26.0, round(max(15.0, tri_w * 0.9), 1)
        flames.append([round(float(nx), 1), round(float(ny), 1), float(dx), float(dy), length, width])
        kill |= comp
    # the marker and its soft pink fringe go, in both layers
    near = nd.binary_dilation(kill, iterations=3) & ~inside
    for L_ in (A, B):
        r, g, b = L_[:, :, 0], L_[:, :, 1], L_[:, :, 2]
        pink = (r > g + 40) & (b > g + 40)
        L_[:, :, 3] = np.where(near & (pink | nd.binary_dilation(kill, iterations=1)), 0, L_[:, :, 3])
        mm = (r > 170) & (b > 170) & (g < 120) & ~inside      # the exterior's own copy, wherever GPT put it
        L_[:, :, 3] = np.where(nd.binary_dilation(mm, iterations=2) & ~inside & ((r > g + 40) & (b > g + 40) | mm), 0, L_[:, :, 3])
        # …and the thin dark outline GPT drew round each triangle, left hanging in space
        zone = nd.binary_dilation(kill, iterations=7) & ~inside
        for _ in range(2):
            op = L_[:, :, 3] > 30
            thin = op & ~nd.binary_opening(op, structure=np.ones((5, 5)))
            L_[:, :, 3] = np.where(zone & thin, 0, L_[:, :, 3])
    flames.sort(key=lambda f: (f[1], f[0]))
    return A, B, flames

def add_rims(A, B, rects, builder=None):
    """jj, 29.10 (the pink line): where a module's side looks out on open
    space — Isis's open middle — GPT drew only half a band, and the room
    just stops. A rim of Pegasus armour goes all along every such side:
    plates with a lit bevel, a dark seam, rivets and a lamp now and then,
    UNDER the picture (whatever GPT did draw there stays on top), in both
    layers. A side is "open" when the space a rim's width past it is."""
    H, W = A.shape[:2]
    inside = _inside((H, W), rects)
    opaque = (np.maximum(A[:, :, 3], B[:, :, 3]) > 60) | inside
    T = 14                                                  # ~9 grid units at 1.5 px
    rim = np.zeros((H, W), bool)
    for x, y, w, h in rects:
        for side in ('top', 'bottom', 'left', 'right'):
            if side in ('top', 'bottom'):
                probe = (y - 2 * T, y - T) if side == 'top' else (y + h + T, y + h + 2 * T)
                band = (y - T, y) if side == 'top' else (y + h, y + h + T)
                for x0 in range(x, x + w, 6):
                    pr = (slice(max(0, probe[0]), max(0, probe[1])), slice(x0, min(x + w, x0 + 6)))
                    if opaque[pr].size and opaque[pr].mean() < 0.3:
                        rim[max(0, band[0]):band[1], x0:min(x + w, x0 + 6)] = True
            else:
                probe = (x - 2 * T, x - T) if side == 'left' else (x + w + T, x + w + 2 * T)
                band = (x - T, x) if side == 'left' else (x + w, x + w + T)
                for y0 in range(y, y + h, 6):
                    pr = (slice(y0, min(y + h, y0 + 6)), slice(max(0, probe[0]), max(0, probe[1])))
                    if opaque[pr].size and opaque[pr].mean() < 0.3:
                        rim[y0:min(y + h, y0 + 6), max(0, band[0]):band[1]] = True
    rim &= ~inside
    rim = nd.binary_closing(rim, structure=np.ones((T + 3, T + 3))) & ~inside
    rim = nd.binary_opening(rim, structure=np.ones((5, 5)))
    lab, runs = nd.label(rim)
    if not runs: return A, B, 0
    # the plate, in GPT's pale silver-blue: lit bevel against the room, a
    # body that darkens outwards, a dark seam on the outside and every 36 px
    dist = nd.distance_transform_edt(~inside)
    t = np.clip((dist - 1) / (T - 1), 0, 1)
    yy, xx = np.mgrid[0:H, 0:W]
    along = np.where(np.abs(np.gradient(dist, axis=0)) > np.abs(np.gradient(dist, axis=1)), xx, yy)
    seg = along % 36
    c_body, c_bevel, c_seam, c_rivet, c_lamp = RIM.get(builder, RIM['pegasus'])
    body = np.array(c_body, float)[None, None, :] * (1.0 - 0.28 * t[:, :, None])
    col = body
    col = np.where(((t < 0.16) | (seg < 2))[:, :, None], np.array(c_bevel, float), col)   # the lit bevel, the plate's edge
    col = np.where(((seg >= 34) | (t > 0.84))[:, :, None], np.array(c_seam, float), col)     # the seams
    rivet = ((seg % 12) < 2) & (t > 0.45) & (t < 0.62) & (seg > 4) & (seg < 32)
    col = np.where(rivet[:, :, None], np.array(c_rivet, float), col)
    lamp = ((along // 36) % 3 == 1) & (seg > 13) & (seg < 23) & (t > 0.3) & (t < 0.58)
    col = np.where(lamp[:, :, None], np.array(c_lamp, float), col)
    for L_ in (A, B):
        a = L_[:, :, 3:4] / 255.0
        L_[:, :, :3] = np.where(rim[:, :, None], L_[:, :, :3] * a + col * (1 - a), L_[:, :, :3])
        L_[:, :, 3] = np.where(rim, 255, L_[:, :, 3])
    return A, B, int(runs)

def cut_flames(A, B, rects):
    """jj, 29.10: the engines must SHOW whether they work — burning when
    they do, dark when they are off or broken, the big stern drives and
    the small thrusters on the bow, the top and the bottom alike. GPT
    drew every one of them burning, into the picture. So the flames come
    OUT of the picture (both layers) and their places go to the game,
    which burns them, animated, while her engines have power:
        [x, y, dx, dy, length, width]  picture px, flown by you
    x, y the nozzle, (dx, dy) the way the flame points."""
    # a margin of open space round the picture: a drive at its very edge
    # burns out of it, and has to be seen to
    P = 24
    A0, B0 = A, B
    A = np.pad(A0, ((P, P), (P, P), (0, 0))); B = np.pad(B0, ((P, P), (P, P), (0, 0)))
    rects = [(x + P, y + P, w, h) for x, y, w, h in rects]
    H, W = A.shape[:2]
    inside = _inside((H, W), rects)
    outside = (A[:, :, 3] < 30) & (B[:, :, 3] < 30) & ~inside
    r, g, b, a = A[:, :, 0], A[:, :, 1], A[:, :, 2], A[:, :, 3]
    # a flame is saturated cyan round a white core; GPT's silver plate is
    # never that saturated (its red is 100+), its lamps and strips are
    # held in metal, a flame burns out into space
    sat = (a > 40) & (r < 80) & (b > 140) & (g > 90) & (b - r > 100)
    core = (a > 40) & (g > 238) & (b > 238)
    lab, n = nd.label(sat | core)
    flames, kill = [], np.zeros((H, W), bool)
    for k, sl in enumerate(nd.find_objects(lab)):
        comp = lab == k + 1
        area = int(comp.sum())
        if area < 40: continue
        ys, xs = np.nonzero(comp)
        if min(np.ptp(xs), np.ptp(ys)) < 8: continue           # a lit strip, not a flame
        if (sat & comp).sum() < area * 0.2: continue            # a white highlight, not a flame
        # its glow can be wide (Set's drives): look 14 px round it for open space
        ring = nd.binary_dilation(comp, iterations=14) & ~comp
        out = ring & outside
        if out.sum() < ring.sum() * 0.12: continue              # held in metal: a lamp
        cy, cx = ys.mean(), xs.mean()
        # it points to the side of it that is open: GPT draws them along the four ways
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        oy, ox = np.nonzero(out)
        sides = {(-1, 0): (ox < x0).sum(), (1, 0): (ox > x1).sum(), (0, -1): (oy < y0).sum(), (0, 1): (oy > y1).sum()}
        dx, dy = max(sides, key=sides.get)
        # better, from its own shape: the white core sits at the nozzle, the
        # glow runs out from it — core → middle is the way it burns
        lum = (r + g + b)[comp]
        hi = lum >= np.percentile(lum, 85)                      # its brightest sixth: the core
        cyc, cxc = ys[hi], xs[hi]
        if len(cxc) >= 3:
            vx, vy = cx - cxc.mean(), cy - cyc.mean()
            if max(abs(vx), abs(vy)) > 1.0:
                dx, dy = ((1 if vx > 0 else -1), 0) if abs(vx) >= abs(vy) else (0, (1 if vy > 0 else -1))
        along = (xs - cx) * dx + (ys - cy) * dy; across = -(xs - cx) * dy + (ys - cy) * dx
        length = float(along.max() - along.min()) + 2; width = float(across.max() - across.min()) + 2
        base = along.min()
        if length < 18: continue                               # a lamp on a ridge, not a thruster
        nx, ny = cx + dx * base, cy + dy * base               # the nozzle: the inner end of the glow
        flames.append([round(float(nx) - P, 1), round(float(ny) - P, 1), round(float(dx), 3), round(float(dy), 3),
                       round(length, 1), round(width, 1)])
        kill |= comp
    if not flames: return A0, B0, []
    # the glow round each flame goes with it: cyan-tinted pixels near it, not inside a module
    near = nd.binary_dilation(kill, iterations=9) & ~inside
    for L_ in (A, B):
        tint = (L_[:, :, 2] > L_[:, :, 0] + 25) & (L_[:, :, 2] > 60) & (L_[:, :, 1] > 40)
        L_[:, :, 3] = np.where(nd.binary_dilation(kill, iterations=1) | (near & tint), 0, L_[:, :, 3])
        # …and the thin dark line GPT drew round each glow, left hanging in space
        m = L_[:, :, 3] > 30
        L_[:, :, 3] = np.where(near & m & ~nd.binary_opening(m, structure=np.ones((4, 4))), 0, L_[:, :, 3])
    return A[P:-P, P:-P].copy(), B[P:-P, P:-P].copy(), flames

def top_profile(A, B, step=7.5):
    """Where the top of the shape is, every 5 grid units (7.5 px) across:
    the guns stand ON it (jj, 29.10: "broń zlewa się z kadłubem"). Run on
    the pictures upside down it gives the keel, where her legs go."""
    al = np.maximum(A[:, :, 3], B[:, :, 3]) > 128
    H, W = al.shape
    out = []
    x = 0.0
    while x < W:
        cols = al[:, int(x):max(int(x) + 1, int(x + step))]
        rows = np.nonzero(cols.any(axis=1))[0]
        out.append(int(rows.min()) if len(rows) else H)
        x += step
    return out

if __name__ == '__main__':
    main()
