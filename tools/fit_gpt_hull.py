#!/usr/bin/env python3
"""MOON WARS — fit a ship GPT drew to the game's grid (update175).

    python3 tools/fit_gpt_hull.py <key> <cut_away.png> <exterior.png> <out_dir>

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
          "console.log(JSON.stringify({rooms:L.rooms.map(r=>({x:r.x,y:r.y,w:r.w,h:r.h})),"
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

def warp_maps(gxp, ixp, gyp, iyp, gbox, scale_img_per_unit):
    """For every output pixel, which source pixel (piecewise linear
    between the grid lines, one uniform scale outside them)."""
    X0, Y0, W, H = gbox
    ox = np.arange(int(round(W * S))) / S + X0
    oy = np.arange(int(round(H * S))) / S + Y0
    def mp(u, gp, ip):
        v = np.interp(u, gp, ip)
        v = np.where(u < gp[0], ip[0] - (gp[0] - u) * scale_img_per_unit, v)
        v = np.where(u > gp[-1], ip[-1] + (u - gp[-1]) * scale_img_per_unit, v)
        return v
    return mp(ox, gxp, ixp), mp(oy, gyp, iyp)

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
    key, fin, fout, od = sys.argv[1:5]
    L = layout(key)
    A = np.array(Image.open(fin).convert('RGB'))
    B = np.array(Image.open(fout).convert('RGB'))
    found, winmask = rects(A)
    (gxp, ixp), (gyp, iyp) = breakpoints(L, found)
    k_img = (ixp[-1] - ixp[0]) / (gxp[-1] - gxp[0])          # image px per grid unit, across
    silA, _ = silhouette(A)
    silA |= nd.binary_dilation(winmask, iterations=2)
    ys, xs = np.nonzero(silA)
    # the box: the shape's extent, in grid units, through the same map
    def to_grid(v, gp, ip):
        if v < ip[0]: return gp[0] - (ip[0] - v) / k_img
        if v > ip[-1]: return gp[-1] + (v - ip[-1]) / k_img
        return float(np.interp(v, ip, gp))
    gx_min = np.floor(to_grid(xs.min() - 2, gxp, ixp)); gx_max = np.ceil(to_grid(xs.max() + 2, gxp, ixp))
    gy_min = np.floor(to_grid(ys.min() - 2, gyp, iyp)); gy_max = np.ceil(to_grid(ys.max() + 2, gyp, iyp))
    gbox = (gx_min, gy_min, gx_max - gx_min, gy_max - gy_min)
    sx, sy = warp_maps(gxp, ixp, gyp, iyp, gbox, k_img)

    # cut-away: ship pixels, minus the windows (a fringe of 2 px goes too)
    win = nd.binary_dilation(winmask, iterations=2)
    alphaA = (silA & ~win).astype(np.float32) * 255
    alphaA = nd.gaussian_filter(alphaA, 0.6)
    rgbaA = np.dstack([A.astype(np.float32), alphaA])
    outA = sample(rgbaA, sx, sy)

    # exterior: laid over the cut-away's outline, then the same map
    silB, _ = silhouette(B)
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

    os.makedirs(od, exist_ok=True)
    for nm, o in (('in', outA), ('out', outB)):
        Image.fromarray(np.clip(o, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(od, f'{key}_hull_{nm}.png'))
    bx0 = min(r['x'] for r in L['rooms']); by0 = min(r['y'] for r in L['rooms'])
    org = [round((bx0 - gbox[0]) * S), round((by0 - gbox[1]) * S)]
    info = {'org': org, 'box_units': gbox, 'size': [outA.shape[1], outA.shape[0]],
            'src_px_per_unit': k_img, 'exterior_overlap': round(float(iou), 3),
            'grid_x': gxp.tolist(), 'img_x': ixp.tolist(), 'grid_y': gyp.tolist(), 'img_y': iyp.tolist()}
    json.dump(info, open(os.path.join(od, f'{key}_fit.json'), 'w'), indent=1)
    print(key, json.dumps({k: info[k] for k in ('org', 'size', 'box_units', 'exterior_overlap')}))

if __name__ == '__main__':
    main()
