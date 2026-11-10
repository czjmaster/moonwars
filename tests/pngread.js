'use strict';
/* THE ART FILES, READ BY THE TESTS (update224). One reader for every test that looks at the pixels of a drawn
   file: 8-bit RGBA, RGB, grey and PALETTE PNGs (tools/optimize_art.py writes palettes with a tRNS chunk), and
   the size of a WebP (the big backdrops). `readPng` returns { w, h, px (RGBA), at(x, y) → [r, g, b, a] }. */
const fs = require('fs'), zlib = require('zlib'), path = require('path');

function readPng(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 1, 4) !== 'PNG') return null;
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], type = b[25];
  if (depth !== 8 || ![0, 2, 3, 4, 6].includes(type)) return null;
  const idat = []; let o = 8, plte = null, trns = null;
  while (o < b.length) {
    const len = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8), d = b.slice(o + 8, o + 8 + len);
    if (t === 'IDAT') idat.push(d); else if (t === 'PLTE') plte = d; else if (t === 'tRNS') trns = d;
    o += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], st = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat)), un = Buffer.alloc(h * st);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)];
    for (let x = 0; x < st; x++) {
      const v = raw[y * (st + 1) + 1 + x], a = x >= bpp ? un[y * st + x - bpp] : 0, up = y ? un[(y - 1) * st + x] : 0,
            ul = (y && x >= bpp) ? un[(y - 1) * st + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a; else if (f === 2) r = v + up; else if (f === 3) r = v + ((a + up) >> 1);
      else if (f === 4) { const p0 = a + up - ul, pa = Math.abs(p0 - a), pb = Math.abs(p0 - up), pc = Math.abs(p0 - ul); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul); }
      un[y * st + x] = r & 255;
    }
  }
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * bpp, d = i * 4;
    if (type === 6) { px[d] = un[s]; px[d + 1] = un[s + 1]; px[d + 2] = un[s + 2]; px[d + 3] = un[s + 3]; }
    else if (type === 2) { px[d] = un[s]; px[d + 1] = un[s + 1]; px[d + 2] = un[s + 2]; px[d + 3] = 255; }
    else if (type === 0) { px[d] = px[d + 1] = px[d + 2] = un[s]; px[d + 3] = 255; }
    else if (type === 4) { px[d] = px[d + 1] = px[d + 2] = un[s]; px[d + 3] = un[s + 1]; }
    else { const k = un[s]; px[d] = plte[k * 3]; px[d + 1] = plte[k * 3 + 1]; px[d + 2] = plte[k * 3 + 2]; px[d + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { w, h, px, at: (x, y) => [px[(y * w + x) * 4], px[(y * w + x) * 4 + 1], px[(y * w + x) * 4 + 2], px[(y * w + x) * 4 + 3]] };
}

/** Width and height of a PNG or a WebP file, from its header. */
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const c = b.toString('ascii', 12, 16);
    if (c === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (c === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (c === 'VP8L') { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
  }
  return null;
}

/** The file of a drawn sprite: art/<name>.webp when the manifest lists it in "webp", else art/<name>.png. */
function artFile(root, name) {
  const man = JSON.parse(fs.readFileSync(path.join(root, 'art', 'manifest.json'), 'utf8'));
  return path.join(root, 'art', name + ((man.webp ?? []).includes(name) ? '.webp' : '.png'));
}

module.exports = { readPng, imageSize, artFile };
