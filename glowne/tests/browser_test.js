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
                   .replace(/\s*<script src="js\/basescreen\.js"><\/script>/, '');
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

    for (const [name, x] of [['HANGAR', 102], ['CREW', 234], ['SUPPLY', 366], ['UPGRADES', 498]]) {
      await s.click(x, 107);
      ok(s.errors.length === 0, `${name} tab drew without a page error`);
    }

    await s.click(366, 107);       // SUPPLY
    await s.click(686, 190);       // + He2
    await s.click(742, 190);       // MAX He2
    await s.click(104, 246);       // BUY x1 (broke — must flash, not throw)
    ok(s.errors.length === 0, 'supply stepper and a refused purchase do not throw');

    await s.click(1030, 600);      // LAUNCH
    await s.page.waitForTimeout(600);
    const after = await s.page.evaluate(() =>
      JSON.parse(localStorage.getItem('moonwars_save_v1') || '{}'));
    ok(!!after.run, 'LAUNCH actually starts a run');
    ok(after.run && after.run.mission === 'patrol' && after.run.finalSector === 2,
       `the chosen contract is the one that starts (${after.run && after.run.mission})`);
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
      base: typeof Base, screen: typeof BaseScreen,
    }));
    ok(healed.base === 'object' && healed.screen === 'object',
       'the game loaded the missing modules by itself');
    ok(s.errors.length === 0,
       `an out-of-date index.html no longer breaks the base screen${s.errors.length ? ': ' + s.errors[0] : ''}`);
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
