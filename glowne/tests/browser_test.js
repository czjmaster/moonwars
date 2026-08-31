'use strict';
/* ============================================================
 * MOON WARS — REAL BROWSER TEST (Playwright + Chromium)
 * ============================================================
 * The vm harness stubs the canvas, the DOM and the audio graph, so it
 * cannot see: a missing <script> tag, a real Canvas2D API that rejects
 * what the stub swallowed, the station shop (which is DOM, not canvas),
 * or anything that only breaks once a browser is actually running the
 * loop. That is what this file is for.
 *
 * It serves the repo over http://127.0.0.1 and drives the REAL game:
 * real clicks at real canvas coordinates, real drags, real page errors.
 *
 *   session 1 — boot, ENTER BASE, every tab, the shelf, LAUNCH
 *   session 2 — an OUT-OF-DATE index.html and the runtime self-repair
 *   session 3 — the salvage screen with a real drag & drop
 *   session 4 — the station shop: stat chips and the reactor quote
 *
 * Without playwright installed this exits CLEANLY (0) — it is an extra
 * pair of eyes, not a gate on machines that lack the browser.
 *
 * REBUILT in update43: the original file was lost (never tracked in
 * git, absent from the archive). Assertion count therefore differs from
 * the pre-update43 figure of 45 — see HANDOFF §4.
 * ============================================================ */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.log('playwright is not installed — skipping the browser test.');
  console.log('  install it with:  npm install playwright');
  process.exit(0);
}

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}
function section(name) { console.log('\n— ' + name + ' —'); }

// ── Static server ───────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

/** `overrides` lets a session serve a DIFFERENT index.html without ever
 *  touching the file on disk — session 2 needs a stale one. */
function serve(overrides = {}) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    if (overrides[rel] !== undefined) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(overrides[rel]);
      return;
    }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: 'http://127.0.0.1:' + server.address().port + '/',
      close: () => new Promise(r => server.close(r)),
    }));
  });
}

// ── Page helpers ────────────────────────────────────────────

/** Everything the page shouted about while a session ran.
 *  Only OUR files count: the stylesheet pulls Orbitron from Google
 *  Fonts and the browser asks for a favicon, and neither failing says
 *  anything about the game. */
function watchErrors(page, origin) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const src = m.location()?.url ?? '';
    if (src && !src.startsWith(origin)) return;         // third-party asset
    if (/favicon/i.test(src)) return;
    errors.push('console.error: ' + m.text() + (src ? '  [' + src + ']' : ''));
  });
  return errors;
}

/** Wait until Game.init() has finished and the menu loop is running. */
async function waitForBoot(page) {
  await page.waitForFunction(
    () => typeof Assets !== 'undefined' && typeof Renderer !== 'undefined'
       && !!Renderer.getCtx() && document.getElementById('loading-bar')
       && document.getElementById('loading-bar').style.width === '100%',
    null, { timeout: 30000 });
  // …plus the half-second the boot sequence spends on 'Ready.'
  await page.waitForTimeout(900);
}

/** Canvas game coordinates → a real mouse click on the page. */
async function canvasPoint(page, gx, gy) {
  return page.evaluate(([x, y]) => {
    const c = document.getElementById('game-canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + x * (r.width / c.width), y: r.top + y * (r.height / c.height) };
  }, [gx, gy]);
}
async function clickCanvas(page, gx, gy) {
  const p = await canvasPoint(page, gx, gy);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);      // let a frame register the hover
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(160);     // …and a few frames act on the click
}
async function dragCanvas(page, from, to) {
  const a = await canvasPoint(page, from[0], from[1]);
  const b = await canvasPoint(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.waitForTimeout(80);
  // Several steps: a single jump can outrun a drag that tracks movement.
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(a.x + (b.x - a.x) * i / 6, a.y + (b.y - a.y) * i / 6);
    await page.waitForTimeout(35);
  }
  await page.mouse.up();
  await page.waitForTimeout(160);
}

/** Click a base-screen button by the ACTION its zone carries, so the
 *  test presses what the player presses — not what we hope is there. */
async function clickBaseAct(page, act, argMatch = null) {
  const zone = await page.evaluate(([a, m]) => {
    const zs = BaseScreen._zonesFor(a);
    const z = m === null ? zs[0] : zs.find(q => JSON.stringify(q.arg) === JSON.stringify(m));
    return z ? { x: z.x, y: z.y, w: z.w, h: z.h } : null;
  }, [act, argMatch]);
  if (!zone) return false;
  await clickCanvas(page, zone.x + zone.w / 2, zone.y + zone.h / 2);
  return true;
}

// ════════════════════════════════════════════════════════════
// SESSION 1 — boot, base, every tab, the shelf, LAUNCH
// ════════════════════════════════════════════════════════════

async function session1(browser) {
  section('SESSION 1 — boot → ENTER BASE → tabs → shelf → LAUNCH');
  const host = await serve();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = watchErrors(page, host.url);

  try {
    await page.goto(host.url, { waitUntil: 'load' });
    await waitForBoot(page);

    ok(await page.evaluate(() => typeof Base !== 'undefined'),
       'base.js loaded from index.html');
    ok(await page.evaluate(() => typeof BaseScreen !== 'undefined'),
       'basescreen.js loaded from index.html');
    ok(await page.evaluate(() => typeof LootScreen !== 'undefined'),
       'lootscreen.js loaded from index.html');
    ok(await page.evaluate(() => typeof CargoGrid !== 'undefined'),
       'cargo.js loaded from index.html');
    ok(await page.evaluate(() => typeof DockingGame !== 'undefined'),
       'wreck.js loaded from index.html');
    ok(await page.evaluate(() => typeof Captain !== 'undefined'),
       'captain.js loaded from index.html');

    // ENTER BASE — first item of MENU_ITEMS, canvas coordinates from _drawMenu
    await clickCanvas(page, 640, 360);
    const inBase = await page.waitForFunction(
      () => !!BaseScreen._state() && !!BaseScreen._zonesFor('tab').length,
      null, { timeout: 5000 }).then(() => true).catch(() => false);
    ok(inBase, 'ENTER BASE opens the base screen (it used to click and do nothing)');

    // Every tab, checked by WHICH TAB OPENED — not by "no error".
    // A coordinate-only loop went on quietly clicking the wrong tabs for
    // several updates and stayed green the whole time.
    for (const tab of ['HANGAR', 'ARMOURY', 'CREW', 'MESS', 'SUPPLY', 'UPGRADES', 'MEMORIAL']) {
      const clicked = await clickBaseAct(page, 'tab', tab);
      const now = await page.evaluate(() => BaseScreen._state().tab);
      ok(clicked && now === tab, `tab ${tab} opens ${tab} (opened: ${now})`);
    }

    /* THE MESS (update43), driven the way the player drives it: build
       it, promote somebody, and check the barracks actually shrank. */
    await clickBaseAct(page, 'tab', 'MESS');
    await page.evaluate(() => {
      Save.addScrapBank(2000);
      // A veteran worth promoting, put in by hand so the test does not
      // depend on the random skills a recruit happens to roll.
      const b = Base.get();
      b.barracks.push({ id: 'probe1', name: 'Probe', race: 'terra', hp: 100, maxHp: 100,
                        skills: { repair: { level: 3, xp: 0 } } });
      Save.save();
    });
    await clickBaseAct(page, 'tab', 'CREW');
    await clickBaseAct(page, 'tab', 'MESS');
    ok(await page.evaluate(() => Base.messLevel() === 1 && Base.messCap() === 1),
       'the mess stands at level I with one berth, unbought (update44)');
    ok(!(await clickBaseAct(page, 'buyMess')),
       'and carries no BUILD button of its own — berths are bought on UPGRADES');
    const bunksBefore = await page.evaluate(() => Base.crew().length);
    const promoted = await clickBaseAct(page, 'promote', 'probe1');
    ok(promoted, 'a promotable veteran gets a PROMOTE button');
    ok(await page.evaluate(() => Base.captains().length === 1),
       'pressing it puts him in the mess');
    ok(await page.evaluate(() => Base.crew().length) === bunksBefore - 1,
       'and takes him OUT of the barracks — he does not exist twice');
    ok(await page.evaluate(() => BaseScreen._state().captainId === Base.captains()[0].id),
       'the new captain is the one flying the next contract');

    // The shelf / PACK HOLD screen (one screen since update35)
    await clickBaseAct(page, 'tab', 'SUPPLY');
    const openedShelf = await clickBaseAct(page, 'warehouse');
    const shelfUp = await page.evaluate(() => LootScreen.isOpen());
    ok(openedShelf && shelfUp, 'OPEN SHELF puts the two-grid pack screen up');
    ok(await page.evaluate(() => !!LootScreen._gridRect('hold')),
       'the pack screen has a hold grid to drop things into');
    ok(await page.evaluate(() => !!LootScreen._gridRect('wreck')),
       'the pack screen has the shelf on the other side');

    // Back out of it the way the player does.
    const closeZone = await page.evaluate(() => {
      const z = LootScreen._zoneFor('close') || LootScreen._zoneFor('done');
      return z ? { x: z.x, y: z.y, w: z.w, h: z.h } : null;
    });
    if (closeZone) await clickCanvas(page, closeZone.x + closeZone.w / 2, closeZone.y + closeZone.h / 2);
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok(!(await page.evaluate(() => LootScreen.isOpen())), 'the pack screen closes again');

    // HANGAR: pick the hull we own
    await clickBaseAct(page, 'tab', 'HANGAR');
    ok(await page.evaluate(() => BaseScreen._state().tab === 'HANGAR'), 'back in the hangar');
    ok(await page.evaluate(() => Base.ships().length > 0), 'there is a hull in the berth to fly');

    // LAUNCH
    const launched = await clickBaseAct(page, 'launch');
    ok(launched, 'the LAUNCH button exists and is armed');
    const inRun = await page.waitForFunction(
      () => Save.hasActiveRun() && !!Save.getRun(),
      null, { timeout: 8000 }).then(() => true).catch(() => false);
    ok(inRun, 'LAUNCH starts a contract');
    ok(await page.evaluate(() => !!Save.getRun().captainId),
       'and the captain sails with it');
    ok(await page.evaluate(() => (Base.captains()[0] || {}).away === true),
       'his berth is still his while he is out there');
    ok(await page.evaluate(() => (Save.getRun().sector ?? 1) >= 1),
       'the run begins in a sector');

    await page.waitForTimeout(700);   // a few frames of the map/ship view
    ok(errors.length === 0, 'no page errors during the whole base tour'
       + (errors.length ? ':\n       ' + errors.join('\n       ') : ''));
  } finally {
    await page.close();
    await host.close();
  }
}

// ════════════════════════════════════════════════════════════
// SESSION 2 — a stale index.html repairs itself at runtime
// ════════════════════════════════════════════════════════════

async function session2(browser) {
  section('SESSION 2 — an OUT-OF-DATE index.html self-repairs');

  const real = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // Exactly what a player has who copied js/ over an old checkout.
  const LATE = ['js/base.js', 'js/basescreen.js', 'js/cargo.js',
                'js/lootscreen.js', 'js/wreck.js', 'js/captain.js'];
  let stale = real;
  LATE.forEach(src => {
    stale = stale.replace(new RegExp(`\\s*<script src="${src.replace('.', '\\.')}"></script>`, 'g'), '');
  });
  ok(LATE.every(s => !stale.includes(s)),
     'test setup: the stale page really is missing the late modules');
  ok(stale.includes('js/game.js'), 'test setup: the stale page still boots game.js');

  const host = await serve({ '/index.html': stale });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = watchErrors(page, host.url);

  try {
    await page.goto(host.url, { waitUntil: 'load' });
    await waitForBoot(page);

    const healed = await page.evaluate(() =>
      ['Base', 'BaseScreen', 'CargoGrid', 'LootScreen', 'DockingGame', 'Captain']
        .filter(n => typeof window[n] === 'undefined'));
    ok(healed.length === 0,
       `the game loads its own missing modules (still missing: ${healed.join(', ') || 'none'})`);

    const autoloaded = await page.evaluate(() =>
      [...document.querySelectorAll('script[data-autoloaded="true"]')].map(s => s.getAttribute('src')));
    ok(autoloaded.length === LATE.length,
       `all ${LATE.length} late modules were injected at runtime, got ${autoloaded.length}`);
    ok(LATE.every(s => autoloaded.includes(s)),
       'every missing script is the one that got injected');

    // And the repaired page must actually WORK, not merely define things.
    await clickCanvas(page, 640, 360);
    const inBase = await page.waitForFunction(
      () => !!BaseScreen._zonesFor('tab').length, null, { timeout: 5000 })
      .then(() => true).catch(() => false);
    ok(inBase, 'ENTER BASE works on the repaired page — this is the bug it exists for');

    ok(errors.filter(e => e.startsWith('pageerror')).length === 0,
       'a self-repaired page throws nothing'
       + (errors.length ? ':\n       ' + errors.join('\n       ') : ''));
  } finally {
    await page.close();
    await host.close();
  }
}

// ════════════════════════════════════════════════════════════
// SESSION 3 — the salvage screen, with a REAL drag & drop
// ════════════════════════════════════════════════════════════

async function session3(browser) {
  section('SESSION 3 — the salvage screen: a REAL drag & drop');
  const host = await serve();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = watchErrors(page, host.url);

  try {
    await page.goto(host.url, { waitUntil: 'load' });
    await waitForBoot(page);

    /* The two-grid salvage screen is ONE mechanism — the derelict hold,
       PACK HOLD and the weapon locker all open the same LootScreen. The
       shelf is the only one the player can reach in four clicks, so the
       drag is done there, driven by the GAME'S OWN loop: nothing here
       fakes a frame, a click or a coordinate. The derelict's own grid is
       checked separately below. */

    // Put something on the shelf to drag.
    const stocked = await page.evaluate(() => {
      Base.buySupply?.('fuel', 4);
      const g = Base.warehouseGrid();
      if (!g.items.length) { g.add('ration_pack'); Base.commitWarehouse(g); }
      return Base.warehouseGrid().items.length;
    });
    ok(stocked > 0, `the shelf has something on it to move (${stocked} stacks)`);

    await clickCanvas(page, 640, 360);                 // ENTER BASE
    await page.waitForFunction(() => !!BaseScreen._zonesFor('tab').length,
                               null, { timeout: 5000 });
    await clickBaseAct(page, 'tab', 'SUPPLY');
    await clickBaseAct(page, 'warehouse');             // OPEN SHELF
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => LootScreen.isOpen()),
       'the two-grid salvage screen is up, driven by the real game loop');

    /* Where IS a given cell on screen? _gridRect does not publish its
       cell size, so the point is found through _cellAt — the same
       function the game uses to decide what the mouse is over. */
    const geom = await page.evaluate(() => {
      const pointFor = (which, cx, cy) => {
        const r = LootScreen._gridRect(which);
        if (!r) return null;
        for (let y = r.y + 2; y < r.y + r.h; y += 2)
          for (let x = r.x + 2; x < r.x + r.w; x += 2) {
            const c = LootScreen._cellAt(which, x, y);
            if (c && c.cx === cx && c.cy === cy) return [x, y];
          }
        return null;
      };
      const shelf = LootScreen._gridRect('wreck').grid;
      const hold  = LootScreen._gridRect('hold').grid;
      const it = shelf.items[0];
      if (!it) return { error: 'the shelf grid came up empty' };
      // A cell in the hold nothing occupies yet.
      let dest = null;
      for (let y = 0; y < hold.rows && !dest; y++)
        for (let x = 0; x < hold.cols && !dest; x++)
          if (!hold.at(x, y)) dest = [x, y];
      return {
        id: it.id, defKey: it.defKey,
        shelfBefore: shelf.items.length,
        holdBefore:  hold.items.length,
        from: pointFor('wreck', it.x, it.y),
        to:   dest ? pointFor('hold', dest[0], dest[1]) : null,
      };
    });
    ok(!geom.error && geom.from && geom.to,
       'a crate on the shelf and an empty cell in the hold can both be pointed at'
       + (geom.error ? ' — ' + geom.error : ''));

    if (geom.from && geom.to) {
      await dragCanvas(page, geom.from, geom.to);

      const after = await page.evaluate(() => ({
        shelf: LootScreen._gridRect('wreck').grid.items.length,
        hold:  LootScreen._gridRect('hold').grid.items.length,
        ids:   LootScreen._gridRect('hold').grid.items.map(i => i.id),
        keys:  LootScreen._gridRect('hold').grid.items.map(i => i.defKey),
      }));
      ok(after.hold === geom.holdBefore + 1,
         `the dragged crate landed in the hold (${geom.holdBefore} → ${after.hold})`);
      ok(geom.id && after.ids.includes(geom.id),
         `the crate that landed is THE crate that was dragged `
         + `(${geom.defKey} #${geom.id}; hold now holds ${after.keys.join(', ')})`);
      ok(after.shelf === geom.shelfBefore - 1,
         'the crate LEFT the shelf — an item is on the shelf OR in the hold, never both '
         + `(${geom.shelfBefore} → ${after.shelf})`);
    }

    // Closing the screen must PERSIST what was packed: those items have
    // physically left the shelf, so they have to be somewhere.
    const closed = await page.evaluate(() => {
      const z = LootScreen._zoneFor('close') || LootScreen._zoneFor('done');
      return z ? { x: z.x, y: z.y, w: z.w, h: z.h } : null;
    });
    if (closed) await clickCanvas(page, closed.x + closed.w / 2, closed.y + closed.h / 2);
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok(!(await page.evaluate(() => LootScreen.isOpen())), 'the salvage screen closes');
    ok(await page.evaluate(() => (Base.packedHold()?.items?.length ?? 0) > 0),
       'what was packed is written back to the base — it cannot evaporate on reload');

    // ── The derelict builds the same kind of grid the drag just used ──
    const wreck = await page.evaluate(() => {
      const w = makeDerelict(1, 850, 120);
      return {
        power: w.reactor.totalPower,
        rooms: w.rooms.length,
        hasO2: !!w.getSystem('oxygen'),
        weapons: w.weapons.length,
      };
    });
    ok(wreck.power === 1, `a derelict carries exactly 1 power unit, got ${wreck.power}`);
    ok(wreck.hasO2, 'and spends it on life support — that is what makes boarding possible');
    ok(wreck.weapons === 0, 'a derelict has no guns left');

    ok(errors.length === 0, 'no page errors while salvaging'
       + (errors.length ? ':\n       ' + errors.join('\n       ') : ''));
  } finally {
    await page.close();
    await host.close();
  }
}

// ════════════════════════════════════════════════════════════
// SESSION 4 — the station shop (the only test that sees it: it is DOM)
// ════════════════════════════════════════════════════════════

async function session4(browser) {
  section('SESSION 4 — the station shop: stat chips and the reactor quote');
  const host = await serve();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = watchErrors(page, host.url);

  try {
    await page.goto(host.url, { waitUntil: 'load' });
    await waitForBoot(page);

    await page.evaluate(() => {
      Save.load(); Save.startRun();
      Save.updateRun({ scrap: 9999 });
      const ship = new Ship('frigate', true, 80, 120);
      ship._allocateDefaultPower();
      window.__shop = { ship, station: new Station(2, 7) };
      UI.openStation(window.__shop.station, ship);
    });
    ok(await page.evaluate(() => !!document.getElementById('station-screen')),
       'the station overlay is built');

    // ── WEAPONS tab: every stat chip carries its OWN pictogram ──
    await page.click('.station-tab[data-tab="weapons"]');
    await page.waitForTimeout(200);

    const chips = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#station-content span').forEach(sp => {
        // A stat chip is LABEL · icon · number
        if (sp.children.length >= 2 && sp.querySelector('svg')) {
          out.push({ text: sp.textContent.trim(), svg: sp.querySelector('svg').outerHTML });
        }
      });
      return out;
    });
    ok(chips.length > 0, `the shop rack renders stat chips (found ${chips.length})`);
    ok(chips.every(c => /<svg/.test(c.svg)), 'every stat chip carries an inline SVG pictogram');
    const shapes = new Set(chips.map(c => c.svg));
    ok(shapes.size > 1,
       `chips must not all share ONE pictogram — a stat with no icon of its own is a stat `
       + `nobody can read (distinct icons: ${shapes.size})`);

    const bare = await page.evaluate(() =>
      [...document.querySelectorAll('#station-content span')]
        .filter(sp => /^(DMG|SHOTS|POWER|SHIELDS|CREW|STUN|FIRE|BREACH)$/i.test(sp.textContent.trim()))
        .filter(sp => !sp.parentElement || !sp.parentElement.querySelector('svg')).length);
    ok(bare === 0, `no stat label is left as a bare word without its icon (bare: ${bare})`);

    // ── MODULES tab: THE PRICE THE SHOP QUOTES MUST BE THE PRICE IT CHARGES ──
    await page.click('.station-tab[data-tab="modules"]');
    await page.waitForTimeout(200);

    // Click the reactor on the blueprint, level by level, and compare
    // the quoted number with the seller's own price every single time.
    // Until update34 the button drew a LINEAR price while the till used
    // an exponential one, so from level 6 up the button lit, the player
    // clicked, and got "Insufficient CC." holding the money.
    const quoteWalk = await page.evaluate(async () => {
      const { ship, station } = window.__shop;
      const bad = [];
      const clickReactor = () => {
        const d = [...document.querySelectorAll('#station-content div')]
          .find(x => x.children.length === 2 && /^RCT/.test(x.textContent));
        if (!d) return false;
        d.click();
        return true;
      };
      /* A HARD STEP CAP. With a broken quote the purchase is refused,
         the level never rises and this walk would spin forever — a test
         that hangs is a test nobody runs. Bail out and report instead. */
      let guard = ship.reactor.maxLevel + 2;
      while (ship.reactor.level < ship.reactor.maxLevel) {
        if (guard-- <= 0) { bad.push({ stuck: ship.reactor.level }); break; }
        if (!clickReactor()) return { error: 'could not find the reactor on the blueprint' };
        await new Promise(r => setTimeout(r, 30));
        const txt = document.querySelector('#station-content')?.textContent ?? '';
        const m = txt.match(/UPGRADE\s+(\d+)\s+CC/);
        if (!m) { if (/MAX LEVEL/.test(txt)) break; return { error: 'no quote and not maxed: ' + txt.slice(0, 120) }; }
        const quoted = Number(m[1]);
        const real   = station.reactorCost(ship);
        const lvl    = ship.reactor.level;
        if (quoted !== real) bad.push({ lvl, quoted, real });
        // Pay EXACTLY what the button asked for, then buy.
        Save.updateRun({ scrap: quoted });
        const r = station.buyReactorUpgrade(ship, Save.getRun());
        if (!r.ok) bad.push({ lvl, quoted, real, refused: r.message });
        clickReactor();                     // deselect
        await new Promise(r2 => setTimeout(r2, 20));
      }
      return { bad, level: ship.reactor.level, max: ship.reactor.maxLevel };
    });

    ok(!quoteWalk.error, 'the reactor is reachable on the shop blueprint'
       + (quoteWalk.error ? ' — ' + quoteWalk.error : ''));
    if (!quoteWalk.error) {
      ok(quoteWalk.bad.length === 0,
        'the quoted reactor price is ALWAYS enough to buy with'
        + (quoteWalk.bad.length ? ': ' + JSON.stringify(quoteWalk.bad) : ''));
      ok(quoteWalk.level === quoteWalk.max,
        `walking the quotes upgraded the reactor to the cap (${quoteWalk.level}/${quoteWalk.max})`);
    }

    // DEPART closes it again — leaving a port is a state change.
    await page.click('#station-close-btn');
    await page.waitForTimeout(200);
    ok(!(await page.evaluate(() =>
        document.getElementById('station-screen').classList.contains('visible'))),
       'DEPART closes the port overlay');

    ok(errors.length === 0, 'no page errors in the shop'
       + (errors.length ? ':\n       ' + errors.join('\n       ') : ''));
  } finally {
    await page.close();
    await host.close();
  }
}

// ════════════════════════════════════════════════════════════

/** Launch Chromium.
 *  Normally playwright finds its own download. Some environments ship a
 *  browser at a fixed path instead (and CI images pin a different build
 *  number than the npm package expects) — MOONWARS_CHROMIUM, or a couple
 *  of well-known locations, are tried before giving up. */
async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (e) {
    const candidates = [process.env.MOONWARS_CHROMIUM, '/opt/pw-browsers/chromium']
      .filter(Boolean).filter(p2 => { try { return fs.existsSync(p2); } catch (_) { return false; } });
    for (const executablePath of candidates) {
      try { return await chromium.launch({ executablePath }); } catch (_) { /* next */ }
    }
    console.log('could not start Chromium — skipping the browser test.');
    console.log('  ' + String(e && e.message || e).split('\n')[0]);
    console.log('  install the browser with:  npx playwright install chromium');
    return null;
  }
}

(async () => {
  const browser = await launchBrowser();
  if (!browser) process.exit(0);
  try {
    await session1(browser);
    await session2(browser);
    await session3(browser);
    await session4(browser);
  } catch (e) {
    failed++;
    console.error('\nFATAL: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
  }
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
