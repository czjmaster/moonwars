'use strict';
/* browser_test.js — runs the REAL game in a REAL browser.
 *
 * WHY THIS EXISTS: the Node harness stubs the canvas with a Proxy that
 * swallows every unknown call, so it can never catch "this only breaks
 * in a browser" problems. It missed a stale index.html that left
 * BaseScreen undefined — clicking ENTER BASE played a click sound and
 * did nothing at all, with the error only visible in the F12 console.
 *
 *   node tests/browser_test.js            (needs playwright)
 *
 * Skips cleanly (exit 0) if playwright is not installed, so it never
 * blocks a packaging run on a machine without it.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.log('playwright not installed — skipping the browser test.');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PORT = 8097;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let failures = 0, passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failures++; console.error('  FAIL ' + msg); }
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

/** Canvas is 1280x720; the page viewport matches so coords map 1:1. */
const CANVAS = { w: 1280, h: 720 };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();

  async function session(label, { staleIndexHtml = false } = {}) {
    const page = await browser.newPage({ viewport: { width: CANVAS.w, height: CANVAS.h } });
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error' && !/ERR_TUNNEL|ERR_INTERNET/.test(m.text())) {
        errors.push('CONSOLE: ' + m.text());
      }
    });

    if (staleIndexHtml) {
      // Simulate a player who copied js/ but kept the OLD index.html:
      // strip the late-added module tags before the page ever parses.
      await page.route('**/index.html', async route => {
        let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        html = html.replace(/\s*<script src="js\/base\.js"><\/script>/, '')
                   .replace(/\s*<script src="js\/basescreen\.js"><\/script>/, '')
                   .replace(/\s*<script src="js\/lootscreen\.js"><\/script>/, '');
        await route.fulfill({ status: 200, contentType: 'text/html', body: html });
      });
    }

    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForTimeout(3500);   // asset generation + loading screen
    const click = async (x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(200); };
    return { page, errors, click, close: () => page.close() };
  }

  // ── 1. Normal boot: menu → base → every tab → launch ──
  console.log('\n— browser: full base flow —');
  {
    const s = await session('normal');
    await s.click(640, 360);                       // ENTER BASE (menu item 0)

    const state = await s.page.evaluate(() => ({
      base: typeof Base, screen: typeof BaseScreen,
      run: JSON.parse(localStorage.getItem('moonwars_save_v1') || '{}').base ? 'yes' : 'no',
    }));
    ok(state.base === 'object' && state.screen === 'object',
       'Base and BaseScreen are live in the page');

    // Tab bar x-centres: 102 + i*132 for HANGAR/ARMOURY/CREW/SUPPLY/
    // UPGRADES, in that order. WAREHOUSE is gone — the shelf lives on
    // the SUPPLY tab now — so every coordinate after CREW shifted left
    // one slot. Each click is checked against the tab that ACTUALLY
    // opened: this loop only asserted "no page error" before, so when
    // ARMOURY was added it silently clicked the wrong tabs for months.
    const TABS = ['HANGAR', 'ARMOURY', 'CREW', 'SUPPLY', 'UPGRADES', 'MEMORIAL'];
    for (let i = 0; i < TABS.length; i++) {
      await s.click(102 + i * 132, 107);
      const tab = await s.page.evaluate(() => BaseScreen._state().tab);
      ok(tab === TABS[i],
         `slot ${i} opens ${TABS[i]} (got ${tab}) — coordinates match the tab bar`);
      ok(s.errors.length === 0, `${TABS[i]} tab drew without a page error`);
    }

    await s.click(498, 107);       // SUPPLY
    await s.click(686, 190);       // + He2
    await s.click(742, 190);       // MAX He2
    await s.click(104, 246);       // BUY x1 (broke — must flash, not throw)
    ok(s.errors.length === 0, 'supply stepper and a refused purchase do not throw');

    // THE ONE WAREHOUSE, on the SUPPLY tab: clear it, put a single relic
    // on it, open the real grid screen, sell the relic and confirm it
    // stuck after DONE. Opening the warehouse and packing the hold are
    // the same screen now, so this exercises both.
    await s.page.evaluate(() => {
      const shelf = window.Base.warehouseGrid();
      shelf.clear();
      shelf.add('alien_relic');
      window.Base.commitWarehouse(shelf);
      BaseScreen.open();
    });
    await s.click(498, 107);       // SUPPLY tab
    await s.click(200, 461);       // OPEN WAREHOUSE — left panel, bottom button
    const shelfOpen = await s.page.evaluate(() => LootScreen.isOpen());
    ok(shelfOpen === true, 'the warehouse button on SUPPLY really opens the shelf');
    const relicAt = await s.page.evaluate(() => {
      const r = LootScreen._cellAt ? LootScreen._gridRect('wreck') : null;
      return r ? { x: r.x + 20, y: r.y + 20 } : null;
    });
    if (relicAt) {
      await s.page.mouse.move(relicAt.x, relicAt.y);
      await s.page.waitForTimeout(150);
    }
    const sellRect = await s.page.evaluate(() => LootScreen._zoneFor('sell'));
    if (sellRect) await s.click(sellRect.x + sellRect.w / 2, sellRect.y + sellRect.h / 2);
    const doneRect = await s.page.evaluate(() => LootScreen._zoneFor('done'));
    await s.click(doneRect.x + doneRect.w / 2, doneRect.y + doneRect.h / 2);
    ok(s.errors.length === 0, 'the shelf opens, sells an item and closes without a page error');
    const stashState = await s.page.evaluate(() => ({
      cc: window.Base.cc(), items: window.Base.warehouseGrid().items.length,
    }));
    ok(stashState.cc > 0 && stashState.items === 0,
       `SELL banked CC and the shelf reflects it after closing (${JSON.stringify(stashState)})`);

    // THE HILL: bury a few crew from the console, then hover a marker
    // and confirm the epitaph card really renders in a real browser.
    await s.page.evaluate(() => {
      for (let i = 0; i < 12; i++) {
        const c = new CrewMember({ name: 'Fallen ' + i });
        c.killedBy = 'weapons fire';
        Save.addToGraveyard(c);
      }
      BaseScreen.open(); BaseScreen._set({ tab: 'MEMORIAL' });
    });
    await s.click(102 + 5 * 132, 107);        // MEMORIAL
    const grave = await s.page.evaluate(() => BaseScreen._graves()[0] || null);
    ok(!!grave, 'the hill has markers on it');
    if (grave) {
      await s.page.mouse.move(grave.x + grave.w / 2, grave.y + grave.h / 2);
      await s.page.waitForTimeout(250);
      await s.page.screenshot({ path: '/tmp/shot_memorial.png' });
    }
    ok(s.errors.length === 0, 'the memorial draws and hovers without a page error');

    // The hangar lists scroll instead of running off the panel.
    await s.click(102, 107);       // HANGAR
    const scrolled = await s.page.evaluate(() => {
      const before = BaseScreen._state().yardScroll;
      BaseScreen._act('scrollYard', 1);
      const after = BaseScreen._state().yardScroll;
      BaseScreen._act('scrollYard', -99);
      return { before, after, vis: BaseScreen._state().yardVis,
               total: Base.catalog().length };
    });
    ok(scrolled.vis === 3, 'the shipyard shows three hulls at a time');
    ok(scrolled.total <= scrolled.vis || scrolled.after > scrolled.before,
       `and scrolls when there are more than that (${JSON.stringify(scrolled)})`);
    ok(s.errors.length === 0, 'scrolling the hangar throws nothing in a real browser');
    await s.click(498, 107);       // back to SUPPLY so LAUNCH is where we expect

    const chosenMission = await s.page.evaluate(() => BaseScreen._state().mission);
    await s.click(1030, 600);      // LAUNCH
    await s.page.waitForTimeout(600);
    const after = await s.page.evaluate(() =>
      JSON.parse(localStorage.getItem('moonwars_save_v1') || '{}'));
    ok(!!after.run, 'LAUNCH actually starts a run');
    ok(after.run && after.run.mission === chosenMission,
       `the chosen contract is the one that starts (${after.run && after.run.mission}, wanted ${chosenMission})`);
    ok(after.base && after.base.ships.length === 0,
       'the hull is checked out of the hangar for the contract');
    ok(s.errors.length === 0, `no page errors during the whole flow${s.errors.length ? ': ' + s.errors[0] : ''}`);
    await s.close();
  }

  // ── 2. STALE index.html: the game must heal itself ──
  console.log('\n— browser: stale index.html (missing script tags) —');
  {
    const s = await session('stale', { staleIndexHtml: true });
    // Only count tags that came from the HTML — the self-healer injects
    // its own (marked data-autoloaded), which would mask the setup.
    const tags = await s.page.evaluate(() =>
      [...document.querySelectorAll('script[src]:not([data-autoloaded])')]
        .map(x => x.getAttribute('src')));
    ok(!tags.includes('js/base.js'),
       'test setup: index.html really is missing the new script tags');

    await s.click(640, 360);       // ENTER BASE
    await s.page.waitForTimeout(400);
    const healed = await s.page.evaluate(() => ({
      base: typeof Base, screen: typeof BaseScreen, loot: typeof LootScreen,
    }));
    ok(healed.base === 'object' && healed.screen === 'object' && healed.loot === 'object',
       'the game loaded the missing modules by itself');
    ok(s.errors.length === 0,
       `an out-of-date index.html no longer breaks the base screen${s.errors.length ? ': ' + s.errors[0] : ''}`);
    await s.close();
  }

  // ── 3. The salvage screen: real drag & drop on a real canvas ──
  console.log('\n— browser: boarding a derelict —');
  {
    const s = await session('loot');
    await s.click(640, 360);        // ENTER BASE
    await s.click(1030, 600);       // LAUNCH
    await s.page.waitForTimeout(700);

    // The CARGO button on the map is the player's way in — click it, so
    // the REAL game loop is the thing driving the screen from here on.
    await s.click(640, 82);
    await s.page.waitForTimeout(300);
    const isLoot = await s.page.evaluate(() => LootScreen.isOpen());
    ok(isLoot === true, 'the CARGO button on the map opens the hold');

    // Swap in a wreck + a known hold so the drag has something to move.
    await s.page.evaluate(() => {
      const wreck = window.__wreck = new CargoGrid(4, 3);
      wreck.add('module_crate');    // 2x3 — will not fit just anywhere
      wreck.add('data_core');
      const hold = window.__hold = new CargoGrid(6, 4);
      LootScreen.openLoot(wreck, hold, { seconds: 60, title: 'TEST SALVAGE' });
    });
    await s.page.waitForTimeout(200);

    const rects = await s.page.evaluate(() => ({
      wreck: LootScreen._gridRect('wreck'), hold: LootScreen._gridRect('hold'),
    }));
    ok(rects.wreck && rects.hold, 'both holds are laid out on screen');
    ok(rects.wreck.x + rects.wreck.w < rects.hold.x,
       'the derelict hold sits fully left of your own — they never overlap');

    await s.page.mouse.move(rects.wreck.x + 20, rects.wreck.y + 20);
    await s.page.mouse.down();
    await s.page.waitForTimeout(150);
    await s.page.mouse.move(rects.hold.x + 24, rects.hold.y + 24, { steps: 10 });
    await s.page.waitForTimeout(150);
    await s.page.mouse.up();
    await s.page.waitForTimeout(250);

    const moved = await s.page.evaluate(() => ({
      wreck: window.__wreck.items.length, hold: window.__hold.items.length,
      overflow: window.__hold.items.some(it =>
        it.x < 0 || it.y < 0 || it.x + it.w > window.__hold.cols || it.y + it.h > window.__hold.rows),
    }));
    ok(moved.hold === 1 && moved.wreck === 1,
       `dragging really moves a crate between holds (wreck ${moved.wreck}, hold ${moved.hold})`);
    ok(moved.overflow === false, 'and never lands it outside the grid');
    await s.page.screenshot({ path: '/tmp/shot_loot.png' });

    // TAKE ALL, then cast off, and we should be out of the loot state.
    // Buttons are found by NAME — the row grows as features land.
    const taRect = await s.page.evaluate(() => LootScreen._zoneFor('takeAll'));
    ok(!!taRect, 'the TAKE ALL button is on screen');
    await s.click(taRect.x + taRect.w / 2, taRect.y + taRect.h / 2);
    const after = await s.page.evaluate(() => ({
      wreck: window.__wreck.items.length, hold: window.__hold.items.length }));
    ok(after.wreck === 0 && after.hold === 2, 'TAKE ALL clears the derelict hold');

    const dRect = await s.page.evaluate(() => LootScreen._zoneFor('done'));
    await s.click(dRect.x + dRect.w / 2, dRect.y + dRect.h / 2);   // DONE / CAST OFF
    await s.page.waitForTimeout(300);
    const closed = await s.page.evaluate(() => LootScreen.isOpen());
    ok(closed === false, 'DONE closes the salvage screen');
    ok(s.errors.length === 0,
       `no page errors on the salvage screen${s.errors.length ? ': ' + s.errors[0] : ''}`);
    await s.close();
  }

  // ── 4. The station shop: real DOM, real stat chips, real prices ──
  // The shop is HTML, not canvas, so neither the Node harness nor the
  // draw smoke test can see it at all. It is also where the reactor
  // price bug lived.
  console.log('\n— browser: the station shop —');
  {
    const s = await session('station');
    await s.click(640, 360);        // ENTER BASE
    await s.click(1030, 600);       // LAUNCH
    await s.page.waitForTimeout(700);

    const opened = await s.page.evaluate(() => {
      const run = Save.getRun();
      Save.updateRun({ scrap: 400 });
      const ship = new Ship('frigate', true, 100, 100);
      ship._allocateDefaultPower();
      window.__stShip = ship;
      window.__st = new Station(1, 4242);
      UI.openStation(window.__st, ship);
      return !!document.getElementById('station-screen');
    });
    ok(opened === true, 'the station screen builds its DOM');
    ok(s.errors.length === 0,
       `rendering the shop throws nothing${s.errors.length ? ': ' + s.errors[0] : ''}`);

    // Every weapon stat chip carries a pictogram now, not just POWER.
    await s.page.evaluate(() => {
      [...document.querySelectorAll('#station-screen [data-tab], #station-screen *')]
        .filter(e => /^weapons$/i.test((e.textContent || '').trim()))
        .slice(0, 1).forEach(e => e.click());
    });
    await s.page.waitForTimeout(250);
    const chips = await s.page.evaluate(() => {
      const el = document.getElementById('station-screen');
      // The CHIP, not the label inside it: a chip is label + icon +
      // value, so it has element children; the label span has none.
      const spans = [...el.querySelectorAll('span')].filter(sp =>
        sp.children.length > 0 &&
        /^(DMG|CHARGE|POWER|SHOTS|AMMO)/.test((sp.textContent || '').trim()));
      return spans.map(sp => ({
        text: ((sp.textContent || '').trim()
                .match(/^(DMG|CHARGE|POWER|SHOTS|AMMO)/) || [''])[0],
        svg: sp.querySelectorAll('svg').length,
      }));
    });
    ok(chips.length > 0, `the shop renders weapon stat chips (${chips.length})`);
    ok(chips.every(c => c.svg === 1),
       `EVERY chip carries its own icon, not just POWER (` +
       `${chips.filter(c => !c.svg).map(c => c.text).join(',') || 'all good'})`);
    ok(chips.some(c => c.text === 'DMG'), 'DMG is one of them');

    // THE REACTOR PRICE. The button used to be priced by a linear
    // formula on the hardware while the till charged an exponential one
    // from the seller, so above reactor level 5 an affordable-looking
    // upgrade was refused with "Insufficient CC".
    const price = await s.page.evaluate(() => {
      const out = [];
      for (let lvl = 1; lvl <= 10 && lvl < window.__stShip.reactor.maxLevel; lvl++) {
        window.__stShip.reactor.level = lvl;
        const quoted = window.__st.reactorCost(window.__stShip);
        Save.updateRun({ scrap: quoted });
        const r = window.__st.buyReactorUpgrade(window.__stShip, Save.getRun());
        out.push({ lvl, quoted, ok: r.ok, msg: r.message });
      }
      return out;
    });
    const refused = price.filter(p => !p.ok);
    ok(refused.length === 0,
       `the quoted price always buys the upgrade${refused.length
         ? ` — refused at level ${refused[0].lvl} for ${refused[0].quoted} CC: ${refused[0].msg}`
         : ''}`);
    await s.page.screenshot({ path: '/tmp/shot_station.png' });
    ok(s.errors.length === 0,
       `no page errors in the shop${s.errors.length ? ': ' + s.errors[0] : ''}`);
    await s.close();
  }

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('BROWSER TEST CRASH:', e);
  server.close();
  process.exit(1);
});
