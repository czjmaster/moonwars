'use strict';
/* MOON WARS — desktop/build.js (update247)
   node build.js [win32|linux|darwin]   (default: win32)
   Copies the game (index.html, css, js, art) into a staging folder next to
   main.js/preload.js and packs it with @electron/packager into
   desktop/out/MoonWars-<platform>-x64/. Tests and tools are not shipped. */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const REPO = path.join(HERE, '..');
const SHIP = ['index.html', 'css', 'js', 'art'];
const platform = process.argv[2] || 'win32';

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) copy(path.join(src, n), path.join(dst, n));
  } else fs.copyFileSync(src, dst);
}

(async () => {
  const stage = path.join(HERE, 'out', 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'game'), { recursive: true });
  for (const f of SHIP) copy(path.join(REPO, f), path.join(stage, 'game', f));
  for (const f of ['main.js', 'preload.js']) copy(path.join(HERE, f), path.join(stage, f));
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: 'moonwars', productName: pkg.productName, version: pkg.version,
    description: pkg.description, main: 'main.js',
  }, null, 2));

  const electronVersion = require(path.join(HERE, 'node_modules', 'electron', 'package.json')).version;
  const { packager } = await import('@electron/packager');
  const out = await packager({
    dir: stage, out: path.join(HERE, 'out'), overwrite: true,
    name: 'MoonWars', executableName: 'MoonWars', platform, arch: 'x64',
    electronVersion, asar: true, prune: false,
    appCopyright: 'Moon Wars',
    win32metadata: { CompanyName: 'Moon Wars', ProductName: 'Moon Wars', FileDescription: 'Moon Wars' },
  });
  console.log('built:', out.join(', '));
})().catch(e => { console.error(e); process.exit(1); });
