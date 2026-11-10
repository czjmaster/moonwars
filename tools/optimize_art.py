#!/usr/bin/env python3
"""OPTIMISE THE ART (update224, jj 10.11: "trzeba będzie zrobić optymalizację img" — the GitHub Pages deploy timed
out syncing ~90 MB of PNGs, and the game fetched all of it at boot).

  python3 tools/optimize_art.py            # every art/*.png not done yet
  python3 tools/optimize_art.py --check    # just report sizes

* The big painted backdrops (bg_*, port_*) become WebP (q 90): smooth gradients, no pixel test reads them.
  Their names go into manifest.json's "webp" list; js/assets.js loads `<name>.webp` for those.
* Everything else (hulls, rooms, items, gear, icons…) stays PNG, quantised to a 256-colour palette with its
  transparency (tests read these files' pixels; the pixel edges stay hard). A file that would not shrink is left.
"""
import io, json, os, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ART = os.path.join(ROOT, 'art')
WEBP_PREFIX = ('bg_', 'port_')

def main():
    check = '--check' in sys.argv
    man_p = os.path.join(ART, 'manifest.json')
    man = json.load(open(man_p, encoding='utf-8'))
    webp = set(man.get('webp', []))
    before = after = 0
    for f in sorted(os.listdir(ART)):
        if not f.endswith('.png'):
            continue
        p = os.path.join(ART, f); name = f[:-4]; b = os.path.getsize(p); before += b
        if check:
            after += b; continue
        im = Image.open(p); im.load()
        if name.startswith(WEBP_PREFIX):
            out = os.path.join(ART, name + '.webp')
            src = im.convert('RGBA') if 'A' in im.getbands() else im.convert('RGB')
            src.save(out, 'WEBP', quality=90, method=6)
            os.remove(p); webp.add(name); after += os.path.getsize(out)
            continue
        if im.mode == 'P':
            after += b; continue                                   # already a palette: done before
        rgba = im.convert('RGBA')
        if rgba.getcolors(256) is not None or rgba.width * rgba.height < 20000:   # tiny: exact colours matter more than bytes
            after += b; continue                                   # 256 colours or fewer, or tiny (the code's own 100x50 rooms, whose exact colours the tests check): left as it is
        q = rgba.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        bio = io.BytesIO(); q.save(bio, 'PNG', optimize=True)
        if bio.tell() < b:
            open(p, 'wb').write(bio.getvalue()); after += bio.tell()
        else:
            after += b
    for f in os.listdir(ART):
        if f.endswith('.webp'): webp.add(f[:-5])
    if not check:
        man['webp'] = sorted(webp)
        json.dump(man, open(man_p, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
        open(man_p, 'a', encoding='utf-8').write('\n')
    print(f'art: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB (webp: {len(webp)})')

if __name__ == '__main__':
    main()
