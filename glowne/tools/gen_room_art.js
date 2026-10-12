#!/usr/bin/env node
/* MOON WARS — paint every module's interior into art/ (update119).
 *
 *     node tools/gen_room_art.js
 *
 * Needs Playwright (the same one tests/browser_test.js uses). It serves
 * the repo, boots the REAL game in Chromium and paints each module with
 * tools/room_painter.js at the size the game says a room's inside is
 * (HULL_GRID: MODULE_W x MODULE_H - VENT_H, 100x50):
 *
 *     art/room_default.png     an empty bay
 *     art/room_<type>.png      engines, weapons, shields, piloting, oxygen,
 *                              medbay, reactor, cloaking, autorepair,
 *                              artillery, carbonite
 *
 * and lists every name in art/manifest.json, which is what makes the
 * game load them (the tiles drawn in js/assets.js stay the fallback).
 * Run it again if the module grid changes: a picture the wrong size is
 * refused by the game and section 306 of the tests fails until then.
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
  const server = await serve();
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => typeof HULL_GRID !== 'undefined', null, { timeout: 30000 });
  await page.addScriptTag({ path: path.join(__dirname, 'room_painter.js') });

  const out = await page.evaluate(() => {
    const W = HULL_GRID.MODULE_W, H = HULL_GRID.MODULE_H - HULL_GRID.VENT_H;
    if (W !== RoomPainter.W || H !== RoomPainter.H) {
      throw new Error(`the painter draws ${RoomPainter.W}x${RoomPainter.H}, a room is ${W}x${H}`);
    }
    return RoomPainter.TYPES.map(type => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      RoomPainter.paint(c.getContext('2d'), type);
      return { name: RoomPainter.spriteName(type), w: W, h: H,
               data: c.toDataURL('image/png').split(',')[1] };
    });
  });

  out.forEach(o => {
    fs.writeFileSync(path.join(ART, o.name + '.png'), Buffer.from(o.data, 'base64'));
    console.log(`  ${o.name}.png  ${o.w}x${o.h}`);
  });

  // The manifest: every room picture that is on disk, the rest untouched.
  const manPath = path.join(ART, 'manifest.json');
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const onDisk = fs.readdirSync(ART).filter(f => /^room_.*\.png$/.test(f)).map(f => f.slice(0, -4));
  man.sprites = [...man.sprites.filter(n => !n.startsWith('room_')), ...onDisk.sort()];
  fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
  console.log(`${out.length} modules painted; manifest lists ${man.sprites.length} sprites.`);

  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
