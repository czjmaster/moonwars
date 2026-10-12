#!/usr/bin/env node
/* MOON WARS — paint every hull's picture into art/ (update116).
 *
 *     node tools/gen_hull_art.js            all hulls
 *     node tools/gen_hull_art.js scout isis only these
 *
 * Needs Playwright (the same one tests/browser_test.js uses). It serves
 * the repo, boots the REAL game in Chromium, and paints each hull with
 * tools/hull_painter.js at the geometry the game itself reports
 * (`hullArtGeometry` in js/ship.js). Two pictures per hull:
 *
 *     art/hull_<key>.png        flown by you   (stern left, bow right)
 *     art/hull_<key>_enemy.png  flown at you   (stern right, bow left)
 *
 * and, since update118, a ROOF for each — the outer skin over the
 * compartments, shown in the base and while jumping, faded out when a
 * fight opens (art/hull_<key>_roof.png, art/hull_<key>_enemy_roof.png):
 *
 * and every name goes into art/manifest.json, which is what makes the
 * game load them. The plate is painted in the colours of the yard that
 * built the hull (`builder` in SHIP_LAYOUTS, update117). Run it again whenever a layout changes: a picture
 * cut for the old layout is refused by the game (it falls back to the
 * plate drawn in code) and section 303 of the tests fails until then.
 */
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART  = path.join(ROOT, 'art');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('playwright is not installed:  npm install playwright');
  process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.png': 'image/png', '.json': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
  const only = process.argv.slice(2);
  const server = await serve();
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => typeof SHIP_LAYOUTS !== 'undefined'
    && typeof hullArtGeometry === 'function', null, { timeout: 30000 });
  await page.addScriptTag({ path: path.join(__dirname, 'hull_painter.js') });

  const out = await page.evaluate((only) => {
    const res = [];
    Object.keys(SHIP_LAYOUTS).forEach(key => {
      if (only.length && !only.includes(key)) return;
      const L = SHIP_LAYOUTS[key];
      [true, false].forEach(isPlayer => {
        const geom = hullArtGeometry(L.rooms, (L.elevators ?? []).map(e => e.x),
                                     isPlayer, !!L.isStation);
        const c = document.createElement('canvas');
        c.width = geom.box.w; c.height = geom.box.h;
        HullPainter.paintHull(c.getContext('2d'), geom,
                              { key, enemy: !isPlayer, rooms: L.rooms, builder: L.builder });
        res.push({ name: HULL_ART.name(key, isPlayer), w: c.width, h: c.height,
                   data: c.toDataURL('image/png').split(',')[1] });
        // …and its roof (update118): the same box, only the compartments
        // and the lift trunks painted, the rest transparent.
        const r = document.createElement('canvas');
        r.width = geom.box.w; r.height = geom.box.h;
        HullPainter.paintRoof(r.getContext('2d'), geom,
                              { key, enemy: !isPlayer, rooms: L.rooms, builder: L.builder,
                                shaftXs: (L.elevators ?? []).map(e => e.x) });
        res.push({ name: HULL_ART.roofName(key, isPlayer), w: r.width, h: r.height,
                   data: r.toDataURL('image/png').split(',')[1] });
      });
    });
    return res;
  }, only);

  out.forEach(o => {
    fs.writeFileSync(path.join(ART, o.name + '.png'), Buffer.from(o.data, 'base64'));
    console.log(`  ${o.name}.png  ${o.w}x${o.h}`);
  });

  // The manifest: every hull picture that is on disk, the rest untouched.
  const manPath = path.join(ART, 'manifest.json');
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const onDisk = fs.readdirSync(ART).filter(f => /^hull_.*\.png$/.test(f)).map(f => f.slice(0, -4));
  man.sprites = [...man.sprites.filter(n => !n.startsWith('hull_')), ...onDisk.sort()];
  fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
  console.log(`${out.length} pictures painted; manifest lists ${man.sprites.length} sprites.`);

  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
