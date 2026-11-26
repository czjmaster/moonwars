#!/usr/bin/env python3
"""MOON WARS — update266: GPT's Aquarius doors, airlock and piston -> art/

    python3 tools/aquarius_v23/cut.py [--doors <sheet>] [--air <sheet>] [--tubes <sheet>]

The sheets are GPT's answers to the prompts on the guides of tools/aquarius_v23/guides.py (1536 x 1024; another size
is scaled to it first). Cut at the guides' boxes, magenta out, at the game's pixel density: doors 4 px a unit (as
Terra's: door_{head,sill,leaf_top,leaf_bot}_aquarius, door_air_*_aquarius), tubes 3 px a unit (gear_aquarius_tube1-3,
thickest first). The names go into manifest.json's sprites, whose "version" is bumped. The game takes them by itself:
Door.art(yard) and DockArt.tubeArt(yard) look for the yard's own first.
"""
import sys, os, json, numpy as np
from PIL import Image
from scipy import ndimage as nd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, '..', '..', 'art')
src = open(os.path.join(HERE, 'guides.py')).read()
G = {}
exec(src[src.index('DOOR_K'):src.index('def box')], G)                  # the boxes, from the guides themselves
def box(d, k, n):
    x, y, w, h = d[n]; return (x, y, x + w * k, y + h * k)
def sheet(p):
    im = Image.open(p).convert('RGB')
    if im.size != (1536, 1024): im = im.resize((1536, 1024), Image.LANCZOS)
    a = np.array(im).astype(float)
    m = (a[..., 0] > 170) & (a[..., 2] > 170) & (a[..., 1] < 120)
    m |= nd.binary_dilation(m, iterations=2) & (a[..., 0] > a[..., 1] + 40) & (a[..., 2] > a[..., 1] + 40)
    return Image.fromarray(np.dstack([np.where(m[..., None], 0, a), np.where(m, 0, 255)]).astype('uint8'))
PAD = 12
def fit(s, b):
    """GPT draws a part a few pixels over its field (26.11: the tubes' bottom rings): the drawn part's own box,
    looked for within PAD of the field"""
    x0, y0, x1, y1 = (int(v) for v in b)
    A = np.array(s)[max(0, y0 - PAD):y1 + PAD, max(0, x0 - PAD):x1 + PAD, 3] > 0
    ys, xs = np.where(A)
    if not len(xs): return (x0, y0, x1, y1)
    return (max(0, x0 - PAD) + xs.min(), max(0, y0 - PAD) + ys.min(), max(0, x0 - PAD) + xs.max() + 1, max(0, y0 - PAD) + ys.max() + 1)
def cut(s, b, wu, hu, k, name):
    im = s.crop(fit(s, b)).resize((wu * k, hu * k), Image.LANCZOS)
    q = np.array(im); q[..., 3] = np.where(q[..., 3] < 128, 0, 255)
    Image.fromarray(q).save(os.path.join(ART, name + '.png')); return name
def main(argv):
    made = []
    args = dict(zip(argv[::2], argv[1::2]))
    for flag, D, pre in [('--doors', G['DOOR'], 'door_'), ('--air', G['AIR'], 'door_air_')]:
        if flag in args:
            s = sheet(args[flag])
            for n in ['head', 'sill', 'leaf_top', 'leaf_bot']:
                made.append(cut(s, box(D, G['DOOR_K'], n), D[n][2], D[n][3], 4, f'{pre}{n}_aquarius'))
    if '--tubes' in args:
        s = sheet(args['--tubes'])
        for i in (1, 2, 3):
            T = G['TUBES'][f'tube{i}']
            made.append(cut(s, box(G['TUBES'], G['TUBE_K'], f'tube{i}'), T[2], T[3], 3, f'gear_aquarius_tube{i}'))
    mp = os.path.join(ART, 'manifest.json'); man = json.load(open(mp, encoding='utf-8'))
    for n in made:
        if n not in man['sprites']: man['sprites'].append(n)
    if made:
        man['version'] = 'update' + str(int(man['version'].replace('update', '')) + 1) if man['version'].startswith('update') else man['version']
        json.dump(man, open(mp, 'w', encoding='utf-8'), indent=2, ensure_ascii=False); open(mp, 'a', encoding='utf-8').write('\n')
    print('cut:', ', '.join(made) or 'nothing')
if __name__ == '__main__':
    main(sys.argv[1:])
