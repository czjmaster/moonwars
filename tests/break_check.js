'use strict';
/* ============================================================
   MOON WARS — break_check.js  (update54)

   THE POINT: a test that does not fail on a broken build is worth
   nothing. This reverts each fix in update54, ONE AT A TIME, runs the
   suites, and reports any revert the tests slept through.

   It edits the real files and puts them back afterwards — including on
   a crash — so it must be run on a clean tree.

   Usage:  node tests/break_check.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const F = (n) => path.join(ROOT, 'js', n);

/* Each entry: what was fixed, which file, and the exact text to swap
   back to the broken version. `from` must appear EXACTLY once. */
const BREAKS = [
  {
    name: '#4 doors — put them back under the commander',
    file: F('game.js'),
    from: "           room WALLS, so nothing else claims that pixel. */\n        d.toggle();",
    to:   "           room WALLS, so nothing else claims that pixel. */\n        if (_needCommander('the doors')) return true;\n        d.toggle();",
  },
  {
    name: '#1 karma colours painted with no commander in the chair',
    file: F('game.js'),
    from: "      const km  = _hasCommander() ? (c.result?.karma || 0) : 0;",
    to:   "      const km  = (c.result?.karma || 0);",
  },
  {
    name: '#2 air — breathing back to the old trickle',
    file: F('oxygen.js'),
    from: "  BREATHING:      0.04,",
    to:   "  BREATHING:      0.014,",
  },
  {
    name: '#2 air — a hull breach back to the old leak',
    file: F('oxygen.js'),
    from: "  DRAIN_BREACH:   0.16,",
    to:   "  DRAIN_BREACH:   0.07,",
  },
  {
    name: '#3 the red wash over a broken module, restored',
    file: F('systems.js'),
    from: "    if (this.ionDamage > 0) {\n      ctx.fillStyle = `rgba(77,184,255,",
    to:   "    if (this.damagedLevels > 0) {\n      const a = Math.min(0.5, this.damagedLevels / this.level * 0.5);\n      ctx.fillStyle = `rgba(255,45,68,${a})`;\n      ctx.fillRect(x, y, w, h);\n    }\n    if (this.ionDamage > 0) {\n      ctx.fillStyle = `rgba(77,184,255,",
  },
  {
    name: '#10 medbay reads operators again, so the cat is skipped',
    file: F('ship.js'),
    from: "      sys.crew = sys.roomId\n        ? (sys.type === 'medbay' ? this.medbayPatients(sys.roomId)\n                                 : this.crewOperating(sys.roomId))\n        : [];",
    to:   "      sys.crew = sys.roomId ? this.crewOperating(sys.roomId) : [];",
  },
  {
    name: '#10 the station clinic turns the cat away again',
    file: F('station.js'),
    from: "      c.isPlayer && !c.isVermin && !c.isSpider &&",
    to:   "      c.isPlayer && !c.isBeast &&",
  },
  {
    name: '#14 uninstall unbolts first and loses the gun',
    file: F('base.js'),
    from: "    const pending = [...(ship.weaponCargo ?? []), w.defKey];",
    to:   "    ship.uninstallWeapon(slot);\n    const pending = [...(ship.weaponCargo ?? []), w.defKey];",
  },
  {
    name: '#13 SELL sells on the first click again',
    file: F('basescreen.js'),
    from: "        _confirm = { act: 'doSellShip', arg,",
    to:   "        return _act('doSellShip', arg);\n        // eslint-disable-next-line no-unreachable\n        _confirm = { act: 'doSellShip', arg,",
  },
  {
    name: '#11 the hangar resets to the first hull',
    file: F('basescreen.js'),
    from: "      const want = b.lastShipKey;",
    to:   "      const want = null;",
  },
  {
    name: '#7 the base picks the first four hands for the player',
    file: F('basescreen.js'),
    from: "    if (remembered.length) remembered.forEach(id => _picked.add(id));\n    else if (!b.lastCrew) homeCrew.slice(0, 4).forEach(c => _picked.add(c.id));",
    to:   "    homeCrew.slice(0, 4).forEach(c => _picked.add(c.id));",
  },
  {
    name: '#8 the enemy badge hangs on the stale flag again',
    file: F('renderer.js'),
    from: "    if (foeAlive && typeof Commander !== 'undefined' && Commander.enemy && Commander.enemy()) {",
    to:   "    if (typeof Commander !== 'undefined' && Commander.enemy && Commander.enemy()) {",
  },
  {
    name: '#15 the boss chip goes back to the exit the boss never takes',
    file: F('game.js'),
    from: "    if (!_bossJustBeaten()) return null;",
    to:   "    if (true) return null;",
  },
  {
    name: '#6 recruits draw names with replacement again',
    file: F('base.js'),
    from: "    const c = new CrewMember({ name: pickUniqueName(CREW_NAMES, takenNames()) });",
    to:   "    const c = new CrewMember({});",
  },
  {
    name: '#6 rename lets two people share a name',
    file: F('base.js'),
    from: "    if (clash) return { ok: false, message: `${clean} is already somebody aboard.` };",
    to:   "    if (false) return { ok: false, message: 'unreachable' };",
  },
  {
    name: '#9 victory declared the moment their hull dies',
    file: F('combat.js'),
    from: "      if (!this.intrudersAboard()) {",
    to:   "      if (true) {",
  },
  {
    name: '#9 our hands bandage their boarders again',
    file: F('ship.js'),
    from: "      if (body.isPlayer !== this.isPlayer) return;\n      /* AND NOBODY KNEELS DOWN",
    to:   "      /* AND NOBODY KNEELS DOWN",
  },
  {
    name: '#9 first aid in the middle of a brawl again',
    file: F('ship.js'),
    from: "      if (this.roomContested(body.roomId)) return;\n      // Already lying in a powered medbay",
    to:   "      // Already lying in a powered medbay",
  },
  {
    name: '#5 pips drawn as one bar again',
    file: F('renderer.js'),
    from: "    for (let i = 0; i < n; i++) {\n      ctx.fillStyle = i < lit ? col : '#1a2030';\n      ctx.fillRect(x + i * (bw + gap), y, bw, h);\n    }",
    to:   "    ctx.fillStyle = col;\n    ctx.fillRect(x, y, w * (v / (max || 1)), h);",
  },
  {
    name: '#5 the orders panel back to its old width',
    file: F('renderer.js'),
    from: "  const ORDER_BW = 48, ORDER_BH = 18, ORDER_GAP = 4, ORDER_X = 14;",
    to:   "  const ORDER_BW = 58, ORDER_BH = 18, ORDER_GAP = 4, ORDER_X = 14;",
  },
  {
    name: '#12 gun strips dimmed by the cloak again',
    file: F('ship.js'),
    from: "    if (cloaked) ctx.globalAlpha = 1;\n    this._drawWeaponMounts(ctx);",
    to:   "    this._drawWeaponMounts(ctx);",
  },
  /* ── SUBTLER REVERTS ──────────────────────────────────────
     The obvious ones above were all caught on the second pass. These
     break the CORNERS of the same fixes — the places where a test can
     pass for the wrong reason. */
  {
    name: '#9 a rat in the hold counts as a boarding party',
    file: F('combat.js'),
    from: "    return p.crew.some(c => c && c.alive && !c.isPlayer &&\n                            !c.isVermin && !c.isSpider);",
    to:   "    return p.crew.some(c => c && c.alive && !c.isPlayer);",
  },
  {
    name: '#9/#10 the medbay treats people through a brawl',
    file: F('ship.js'),
    from: "  medbayPatients(roomId) {\n    if (this.roomContested(roomId)) return [];",
    to:   "  medbayPatients(roomId) {\n    if (false) return [];",
  },
  {
    name: '#15 the boss chip remembers THAT it paid, not WHICH boss',
    file: F('game.js'),
    from: "    if (!hull || _bossChipPaidFor === hull) return null;",
    to:   "    if (!hull || _bossChipPaidFor) return null;",
  },
  {
    name: '#5 a man on his last hit point shows an empty row',
    file: F('renderer.js'),
    from: "    const lit = v <= 0 ? 0 : Math.max(1, Math.round((v / (max || 1)) * n));",
    to:   "    const lit = Math.round((v / (max || 1)) * n);",
  },
  {
    name: '#6 rename accepts a blank name',
    file: F('base.js'),
    from: "    if (!clean) return { ok: false, message: 'A name cannot be empty.' };",
    to:   "    if (false) return { ok: false, message: 'unreachable' };",
  },
  {
    name: '#2 one pip of power no longer holds the air (refill left behind)',
    file: F('oxygen.js'),
    from: "  REFILL_PER_POWER: 0.06,",
    to:   "  REFILL_PER_POWER: 0.03,",
  },
  {
    name: '#13 CANCEL sells anyway',
    file: F('basescreen.js'),
    from: "      case 'confirmNo':  _confirm = null; break;",
    to:   "      case 'confirmNo':  { const c0 = _confirm; _confirm = null; if (c0) return _act(c0.act, c0.arg); break; }",
  },
];


const SUITES = ['run_tests.js', 'smoke_draw.js', 'browser_test.js'];

function runSuites() {
  for (const s of SUITES) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, s)],
                   { stdio: 'pipe', timeout: 180000 });
    } catch (e) {
      return { failed: true, suite: s };
    }
  }
  return { failed: false };
}

// ── Baseline: everything must be green before we start ──
console.log('baseline…');
{
  const base = runSuites();
  if (base.failed) {
    console.log(`REFUSING TO RUN: ${base.suite} is already red on a clean tree.`);
    process.exit(2);
  }
  console.log('baseline green\n');
}

const leaks = [];
for (const b of BREAKS) {
  const src = fs.readFileSync(b.file, 'utf8');
  const hits = src.split(b.from).length - 1;
  if (hits !== 1) {
    console.log(`!! ANCHOR ${hits === 0 ? 'MISSING' : 'AMBIGUOUS'} (${hits}): ${b.name}`);
    leaks.push(`${b.name}  [anchor ${hits === 0 ? 'missing' : 'ambiguous'}]`);
    continue;
  }
  fs.writeFileSync(b.file, src.replace(b.from, b.to));
  let res;
  try {
    res = runSuites();
  } finally {
    fs.writeFileSync(b.file, src);      // always put it back
  }
  if (res.failed) {
    console.log(`  caught  (${res.suite})  ${b.name}`);
  } else {
    console.log(`  LEAK              ${b.name}`);
    leaks.push(b.name);
  }
}

console.log(`\n${BREAKS.length - leaks.length}/${BREAKS.length} reverts caught by the tests`);
if (leaks.length) {
  console.log('\nNOT CAUGHT — these fixes have no test that fails without them:');
  leaks.forEach(l => console.log('  · ' + l));
}
process.exit(leaks.length ? 1 : 0);
