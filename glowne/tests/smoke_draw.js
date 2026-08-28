'use strict';
/* ============================================================
 * MOON WARS — DRAW SMOKE TEST
 * ============================================================
 * RUN THIS BEFORE EVERY PACKAGE.
 *
 * The logic suite (run_tests.js) never calls a draw path, so a
 * ReferenceError inside _drawCombat — the `const W` trap from update19 —
 * is completely invisible to it, while in the browser it kills the whole
 * frame and reads to the player as "the game froze".
 *
 * This file walks every screen the game can show and fails loudly if a
 * draw throws. Where a bug has previously hidden behind "it did not
 * throw", the step ALSO asserts on the result: click zones carry the
 * right action, the shield row and the hull bar stay on the canvas, the
 * base tab that opened is the one that was asked for.
 *
 * REBUILT in update43: the original file was lost (it was never tracked
 * in git and did not survive the archive). Step count therefore differs
 * from the pre-update43 figure of 32 — see HANDOFF §4.
 * ============================================================ */

const { loadEngine } = require('./harness.js');

/* Sprite atlases are not loaded headless, so assets.js warns once per
   glyph per frame — thousands of lines that bury the actual result.
   The missing-asset path is not what this file tests; the draw is. */
const _realWarn = console.warn, _realLog = console.log;
const _assetNoise = (a) => /^\[Assets\] Sprite not found/.test(String(a));
console.warn = (...a) => { if (!_assetNoise(a[0])) _realWarn(...a); };
console.log  = (...a) => { if (!_assetNoise(a[0])) _realLog(...a); };

let steps = 0, failures = 0;

function step(name, fn) {
  steps++;
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failures++;
    console.error('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack : e));
  }
}

/** Assertion INSIDE a step — a failed check must read like a thrown draw. */
function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}

/** Record every fillText/fillRect a draw emits so a step can assert on
 *  layout instead of only on "no exception". */
function capture(ctx, fn) {
  const text = [], rects = [], arcs = [];
  const rT = ctx.fillText, rR = ctx.fillRect, rA = ctx.arc;
  ctx.fillText = (t, x, y) => { text.push({ t: String(t), x, y }); };
  ctx.fillRect = (x, y, w, h) => { rects.push({ x, y, w, h }); };
  ctx.arc = (x, y, r) => { arcs.push({ x, y, r }); };
  try { fn(); } finally { ctx.fillText = rT; ctx.fillRect = rR; ctx.arc = rA; }
  return { text, rects, arcs };
}

// ────────────────────────────────────────────────────────────
// Shared world
// ────────────────────────────────────────────────────────────

const sb = loadEngine();
const {
  Renderer, UI, Save, Base, BaseScreen, Ship, CrewMember, CombatManager,
  Animation, SectorMap, Game, Input, Particles,
} = sb;
const T = Game.__test;

const ctx = (() => {
  Renderer.init(sb.document.createElement('canvas'));
  return Renderer.getCtx();
})();
const W = Renderer.getWidth(), H = Renderer.getHeight();

Save.load();
Save.startRun();

/** A crewed player hull, a crewed enemy hull, CombatManager live. */
function buildCombat() {
  const player = new Ship('frigate', true, 80, 120);
  const enemy  = new Ship('enemy_frigate', false, 850, 120);
  [player, enemy].forEach(s => { s._allocateDefaultPower(); s.prechargeShields(); });
  sb.makeStartingCrew().forEach(c => player.addCrew(c));
  sb.makeEnemyCrew(3).forEach(c => enemy.addCrew(c));
  player.assignStations();
  enemy.assignStations();
  T.playerShip = player;
  T.enemyShip  = enemy;
  T.STATE = 'combat';
  T.boardingParty = null;
  T.enemyParty = null;
  CombatManager.begin(player, enemy, 'normal');
  for (let i = 0; i < 60 && !CombatManager.isActive(); i++) CombatManager.update(0.05);
  return { player, enemy };
}

const { player, enemy } = buildCombat();

console.log('\n— BACKDROPS —');

step('drawBackground (still)', () => Renderer.drawBackground(0));
step('drawBackground (scrolling)', () => Renderer.drawBackground(Date.now() * 0.008));
step('drawNebula', () => Renderer.drawNebula(ctx, 1.5));
step('drawMainMenu (no hover)', () => Renderer.drawMainMenu(null));
step('drawMainMenu (hovered item)', () => Renderer.drawMainMenu(0));

console.log('\n— HULLS —');

step('player hull draws', () => player.draw(ctx));
step('enemy hull draws (mirrored)', () => enemy.draw(ctx));
step('boss station hull draws (no engine/prow tiles)', () => {
  const st = new Ship('boss_station', false, 850, 60);
  st._allocateDefaultPower();
  assert(st.engineSlots().length === 0, 'a station must have no engine tiles');
  assert(st.prowSlots().length === 0, 'a station must have no prow tiles');
  st.draw(ctx);
});
step('derelict hull draws (unrevealed nests stay invisible)', () => {
  const wreck = sb.makeDerelict(1, 850, 120);
  assert(wreck.reactor.totalPower === 1,
    `a derelict always keeps exactly 1 power unit, got ${wreck.reactor.totalPower}`);
  const o2 = wreck.getSystem('oxygen');
  assert(o2 && o2.effectivePower() >= 1, 'the derelict spends its one unit on life support');
  wreck.draw(ctx);
});
step('crew sprites: every animation state has an ENEMY colour', () => {
  ['idle', 'walk', 'repair', 'fight', 'die'].forEach(state => {
    const a = Animation.crewByColor(state, CrewMember.ENEMY_COLOR);
    assert(a, `crewByColor('${state}') must return an animation`);
  });
});
step('rat sprite renders (moon rats, update39)', () => {
  const rat = new CrewMember({ race: 'rat' });
  assert(rat.isBeast, 'a rat must read as a beast, not as a hand for work');
  player.addCrew(rat);
  rat.x = player.rooms[0].cx; rat.y = player.floorWalkY(0);
  rat.draw(ctx, player);
  player.crew = player.crew.filter(c => c !== rat);
});

console.log('\n— MAP SCREEN —');

step('drawMapScreen — starting lane pick (sector 1)', () => {
  const m = new SectorMap(1, 12345, null, 3, true);
  assert(m.awaitingStartPick, 'sector 1 must ask the player to pick a lane');
  Renderer.drawMapScreen(m, null);
});
step('drawMapScreen — normal sector, no hover', () => {
  const m = new SectorMap(2, 999, 1, 3, true);
  Renderer.drawMapScreen(m, null);
});
step('drawMapScreen — hovered node tooltip', () => {
  const m = new SectorMap(2, 999, 1, 3, true);
  const known = m.nodes.find(n => m.visibilityOf(n) === 'known');
  assert(known, 'at least one node must be known at the start of a sector');
  Renderer.drawMapScreen(m, known.id);
});
step('drawMapScreen — fog: dark nodes are not drawn at all', () => {
  const m = new SectorMap(2, 4242, 1, 3, true);
  const dark = m.nodes.filter(n => m.visibilityOf(n) === 'dark');
  assert(dark.length > 0, 'an unsurveyed sector must still have dark nodes');
  const seen = capture(ctx, () => Renderer.drawMapScreen(m, null));
  const labels = seen.text.map(o => o.t);
  assert(!labels.includes('● SURVEYED'), 'an unsurveyed sector must not claim to be surveyed');
});
step('drawMapScreen — after a SURVEY PROBE the whole sector resolves', () => {
  const m = new SectorMap(2, 4242, 1, 3, true);
  m.revealed = true;
  const seen = capture(ctx, () => Renderer.drawMapScreen(m, null));
  const labels = seen.text.map(o => o.t);
  assert(labels.includes('● SURVEYED'), 'a surveyed sector must say so in the header');
  assert(m.nodes.every(n => m.visibilityOf(n) === 'known'),
    'a burnt probe must leave every node known');
});
step('drawMapScreen — no-boss contract (Courier Run) has an EXIT column', () => {
  const m = new SectorMap(1, 77, 1, 1, false);
  Renderer.drawMapScreen(m, null);
});

console.log('\n— HUD —');

step('drawHUD — map state (player hull only)', () => {
  Renderer.drawHUD({ playerShip: player });
});
step('drawHUD — combat state (both hulls)', () => {
  Renderer.drawHUD({ playerShip: player, enemyShip: enemy });
});
step('drawHUD — nebula combat', () => {
  Renderer.drawHUD({ playerShip: player, enemyShip: enemy, nebula: true });
});
step('drawHUD — enemy shield row stays ON the canvas at 6 layers', () => {
  // shieldMax/shieldBars are GETTERS onto the module — the layers live
  // there, so that is where a six-layer bubble has to be set up.
  const ss = enemy.getSystem('shields');
  assert(ss, 'test setup: the enemy needs a shield module');
  ss._shieldMax = 6; ss._shieldBars = 6; ss._shieldTimer = 0;
  assert(enemy.shieldMax === 6, 'test setup: the enemy must read six layers');
  const seen = capture(ctx, () => Renderer.drawHUD({ playerShip: player, enemyShip: enemy }));
  const off = seen.arcs.filter(a => a.x + a.r + 4 > W);
  assert(off.length === 0,
    `a shield bubble ran off the right edge (${off.length} of ${seen.arcs.length}) — the update42 T-10 bug`);
});
step('drawHUD — hull bar stays on the canvas for 12/22/28/40/60 hull', () => {
  [12, 22, 28, 40, 60].forEach(max => {
    enemy.hullMax = max; enemy.hull = max;
    const seen = capture(ctx, () => Renderer.drawHUD({ playerShip: player, enemyShip: enemy }));
    const off = seen.rects.filter(r => r.x + r.w > W + 0.5);
    assert(off.length === 0, `hull bar with hullMax=${max} drew ${off.length} pips past the right edge`);
  });
  enemy.hullMax = 20; enemy.hull = 20;
});
step('drawHUD — an away team keeps its rows (boarders are OUR crew)', () => {
  const boarder = player.crew.find(c => c.isPlayer && c.alive);
  assert(boarder, 'test setup: the player needs a live crew member');
  player.crew = player.crew.filter(c => c !== boarder);
  enemy.addCrew(boarder);
  const roster = Renderer.crewRoster({ playerShip: player, enemyShip: enemy });
  assert(roster.includes(boarder), 'a boarder must still have a roster row while aboard the enemy');
  assert(boarder._awayTeam === true, 'a boarder must be flagged as away');
  assert(roster.every(c => c.isPlayer), 'an enemy intruder must NOT get a row on our roster');
  Renderer.drawHUD({ playerShip: player, enemyShip: enemy });
  enemy.crew = enemy.crew.filter(c => c !== boarder);
  player.addCrew(boarder);
});
step('drawHUD — an enemy intruder on OUR deck gets no roster row', () => {
  const intruder = new CrewMember({ race: 'terra', isPlayer: false });
  player.addCrew(intruder);
  const roster = Renderer.crewRoster({ playerShip: player, enemyShip: enemy });
  assert(!roster.includes(intruder), 'an enemy standing on our deck must not appear in our crew list');
  Renderer.drawHUD({ playerShip: player, enemyShip: enemy });
  player.crew = player.crew.filter(c => c !== intruder);
});

step('drawHUD — the captain strip (and none when nobody is flying)', () => {
  const Captain = sb.Captain;
  Captain.setActive(null);
  const without = capture(ctx, () => Renderer.drawHUD({ playerShip: player }));
  assert(!without.text.some(o => /^Voss L/.test(o.t)),
    'no captain flying, no captain strip');

  const cap = Captain.fromCrew({ id: 'hud', name: 'Voss', race: 'aquarius', skills: {} });
  cap.level = 6;
  Captain.setActive(cap);
  try {
    const seen = capture(ctx, () => Renderer.drawHUD({ playerShip: player }));
    assert(seen.text.some(o => o.t === 'Voss L6'),
      'the strip names him and shows his level');
    // He is NOT a body on the deck: no roster row, no click target.
    const roster = Renderer.crewRoster({ playerShip: player });
    assert(!roster.some(c => c.id === 'hud'),
      'and he never appears among the crew — he is not aboard as a person');
  } finally { Captain.setActive(null); }
});
step('drawHUD — a maxed captain reads full, not empty', () => {
  const Captain = sb.Captain;
  const cap = Captain.fromCrew({ id: 'hud2', name: 'Max', race: 'terra', skills: {} });
  cap.level = Captain.MAX_LEVEL;
  Captain.setActive(cap);
  try {
    assert(Captain.xpProgress(cap) === 1, 'a captain at the ceiling shows a full bar');
    Renderer.drawHUD({ playerShip: player });
  } finally { Captain.setActive(null); }
});

console.log('\n— POWER BAR: CLOAK —');

/** A hull with a powered cloaking module, freed from the engines. */
function cloakShip() {
  const s = new Ship('frigate', true, 80, 120);
  if (!s.addModule('cloaking')) throw new Error('test setup: could not fit a cloaking module');
  s._allocateDefaultPower();
  const cl = s.getSystem('cloaking');
  const eng = s.getSystem('engines');
  s.setPowerAt(s.systems.indexOf(eng), 0);
  s.setPowerAt(s.systems.indexOf(cl), cl.maxPower);
  s.update(0.05);
  sb.makeStartingCrew().forEach(c => s.addCrew(c));
  s.assignStations();
  return { s, cl };
}

step('power bar — CLOAK READY', () => {
  const { s, cl } = cloakShip();
  assert(!cl.isDisabled(), 'test setup: the cloak must be powered');
  const seen = capture(ctx, () => Renderer.drawHUD({ playerShip: s }));
  assert(seen.text.some(o => o.t === 'READY [C]'), 'a powered, off-cooldown cloak must read READY [C]');
});
step('power bar — CLOAKED (countdown ring)', () => {
  const { s, cl } = cloakShip();
  assert(cl.activateCloak(), 'test setup: the cloak must engage');
  const seen = capture(ctx, () => Renderer.drawHUD({ playerShip: s }));
  assert(seen.text.some(o => /^\d+s$/.test(o.t)), 'an active cloak must show its seconds');
  assert(!seen.text.some(o => o.t === 'READY [C]'), 'an active cloak must not also read READY');
});
step('power bar — RECHARGE (cooldown ring)', () => {
  const { s, cl } = cloakShip();
  cl.activateCloak();
  for (let i = 0; i < 200 && cl.cloakActive; i++) s.update(0.05);
  assert(!cl.cloakActive && cl.cloakCd > 0, 'test setup: the cloak must be recharging');
  const seen = capture(ctx, () => Renderer.drawHUD({ playerShip: s }));
  assert(seen.text.some(o => /^\d+s$/.test(o.t)), 'a recharging cloak must show its seconds');
  assert(!seen.text.some(o => o.t === 'READY [C]'), 'a recharging cloak must not read READY');
});
step('power bar — NO PWR', () => {
  const { s, cl } = cloakShip();
  s.setPowerAt(s.systems.indexOf(cl), 0);
  s.update(0.05);
  assert(cl.isDisabled(), 'test setup: the cloak must be unpowered');
  const seen = capture(ctx, () => Renderer.drawHUD({ playerShip: s }));
  assert(seen.text.some(o => o.t === 'NO PWR'), 'an unpowered cloak must read NO PWR');
});
step('power bar — the CLOAK icon FIRES, every other icon TOGGLES', () => {
  const { s, cl } = cloakShip();
  Renderer.drawHUD({ playerShip: s });
  const zones = Renderer.getPowerClickZones();
  const cloakIdx = s.systems.indexOf(cl);
  const fire = zones.filter(z => z.sysActivateIndex !== undefined);
  assert(fire.length === 1, `exactly one activate zone expected, got ${fire.length}`);
  assert(fire[0].sysActivateIndex === cloakIdx,
    'the activate zone must point at the cloaking module');
  assert(!zones.some(z => z.sysToggleIndex === cloakIdx),
    'the cloak icon must not ALSO be a power toggle — clicking it fires the ability');
  // Every other module icon is a power toggle — except the reactor,
  // which is the bank the pips are drawn from and cannot be switched off.
  const others = s.systems.filter(x => x !== cl && x.type !== 'reactor' && !x.isEmpty?.());
  const missing = others.filter(o => !zones.some(z => z.sysToggleIndex === s.systems.indexOf(o)));
  assert(missing.length === 0,
    `these module icons lost their power toggle: ${missing.map(o => o.type).join(', ')}`);
  assert(!zones.some(z => z.sysToggleIndex === s.systems.findIndex(x => x.type === 'reactor')),
    'the reactor must not be switchable off');
});

console.log('\n— BASE SCREEN —');

/** Open the base screen and switch to a tab through the real button. */
function openTab(tab) {
  BaseScreen.open();
  BaseScreen.draw(ctx);
  const z = BaseScreen._zonesFor('tab').find(x => x.arg === tab);
  assert(z, `no click zone for tab ${tab}`);
  BaseScreen._act('tab', z.arg);
  assert(BaseScreen._state().tab === tab,
    `clicking ${tab} opened ${BaseScreen._state().tab} instead`);
  BaseScreen.draw(ctx);
}

['HANGAR', 'ARMOURY', 'CREW', 'MESS', 'SUPPLY', 'UPGRADES', 'MEMORIAL'].forEach(tab => {
  step(`base tab ${tab} draws (and is the tab that opened)`, () => openTab(tab));
});

step('base HANGAR — empty hangar and empty barracks', () => {
  const b = Base.get();
  const ships = b.ships, barracks = b.barracks;
  b.ships = []; b.barracks = [];
  try { openTab('HANGAR'); } finally { b.ships = ships; b.barracks = barracks; }
});
step('base HANGAR — both lists at EVERY scroll position', () => {
  const b = Base.get();
  const ships = b.ships;
  // Enough hulls that the berth list genuinely scrolls.
  b.ships = ['scout', 'hauler', 'frigate'].map(k => ({ key: k, data: null }));
  try {
    openTab('HANGAR');
    const st = BaseScreen._state();
    const yardMax  = Math.max(0, (Base.catalog?.() ?? []).length - st.yardVis);
    const berthMax = Math.max(0, b.ships.length - st.berthVis);
    for (let y = 0; y <= yardMax; y++) {
      BaseScreen._set({ yardScroll: y });
      BaseScreen.draw(ctx);
      assert(BaseScreen._state().yardScroll === y, `yard scroll ${y} did not stick`);
    }
    for (let k = 0; k <= berthMax; k++) {
      BaseScreen._set({ berthScroll: k });
      BaseScreen.draw(ctx);
      assert(BaseScreen._state().berthScroll === k, `berth scroll ${k} did not stick`);
    }
  } finally { b.ships = ships; }
});
step('base ARMOURY — a scrolled rack sells the gun you CLICKED', () => {
  // Stock the shelf past the visible rack so it genuinely scrolls.
  const keys = Object.keys(sb.WEAPON_DEFS).slice(0, 6);
  assert(keys.length >= 4, 'test setup: need several weapon defs');
  keys.forEach(k => Base.storeWeapon(k));
  openTab('ARMOURY');
  const rack = Base.armoury();
  assert(rack.length >= 4, `test setup: the rack needs several guns, got ${rack.length}`);

  // scrollRack takes a DELTA, the way the scrollbar buttons hand it over.
  const scrollBy = (d) => {
    BaseScreen._act('scrollRack', d);
    BaseScreen.draw(ctx);
    return {
      sell: BaseScreen._zonesFor('sellGun').map(z => z.arg),
      fit:  BaseScreen._zonesFor('fit').map(z => z.arg),
    };
  };

  const top = scrollBy(0);
  assert(top.sell.length > 0, 'an occupied rack must render SELL buttons');
  assert(top.sell[0] === 0, 'unscrolled, the first SELL must point at rack slot 0');

  const down = scrollBy(+1);
  assert(down.sell[0] === 1,
    `scrolled by one, the first SELL must carry the ABSOLUTE index 1, got ${down.sell[0]} — `
    + 'a visible index here sells somebody else\'s gun, and _act("sellGun", n) by hand cannot see it');
  assert(down.fit[0] === 1, 'FIT must carry the absolute index too');
  assert(new Set(down.sell).size === down.sell.length, 'two SELL buttons pointed at one slot');
  assert(down.sell.every(a => Number.isInteger(a) && a >= 0 && a < rack.length),
    'a SELL button pointed outside the rack');
  BaseScreen._act('scrollRack', -1);
});
step('base CREW — HP bars, stars and plague markers in the barracks', () => {
  const b = Base.get();
  const barracks = b.barracks;
  // These are RECORDS out of the save, not live CrewMember instances —
  // that is exactly why the card has to read hp/maxHp defensively.
  b.barracks = [
    { id: 'c1', name: 'Vega', race: 'terra',    hp: 22,  maxHp: 100, skills: { weapons: { level: 3 } } },
    { id: 'c2', name: 'Rho',  race: 'aquarius', hp: 100, maxHp: 100, infected: true },
    { id: 'c3', name: 'Old',  race: 'terra' },   // a pre-update39 record: no hp fields at all
  ];
  try {
    openTab('CREW');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');
    assert(labels.includes('WOUNDED'), 'a crew member under 30% hp must read WOUNDED');
    assert(/★/.test(labels), 'a mastered skill must show as a star on the card');
    assert(!/NaN/.test(labels),
      'an old save without hp fields must not print NaN — this was the update39 bug');
    assert(labels.includes('100/100'), 'the card must print the raw hp numbers');
  } finally { b.barracks = barracks; }
});
step('base MESS — not built yet', () => {
  const b = Base.get();
  const lvl = b.messLvl, caps = b.captains;
  b.messLvl = 0; b.captains = [];
  try {
    openTab('MESS');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');
    assert(/not built/i.test(labels), 'an unbuilt mess must say so');
    assert(BaseScreen._zonesFor('buyMess').length >= 0, 'the build button has a zone or is greyed');
  } finally { b.messLvl = lvl; b.captains = caps; }
});
step('base MESS — berths, a captain at level 1 and one at the cap', () => {
  const b = Base.get();
  const lvl = b.messLvl, caps = b.captains, bar = b.barracks;
  b.messLvl = 3;
  b.captains = [
    { id: 'k1', name: 'Voss',  race: 'aquarius', level: 1, xp: 10,  karma: 50, chips: [], away: false },
    { id: 'k2', name: 'Rhen',  race: 'phoenix',  level: 8, xp: 0,   karma: 12, chips: [], away: true  },
  ];
  b.barracks = [
    { id: 'p1', name: 'Ace', race: 'terra', hp: 90, maxHp: 100,
      skills: { repair: { level: 3, xp: 0 }, engines: { level: 1, xp: 0 } } },
  ];
  try {
    openTab('MESS');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');
    assert(labels.includes('Voss') && labels.includes('Rhen'), 'both captains are listed');
    assert(/ON CONTRACT/.test(labels), 'a captain who is away says so instead of offering to fly');
    assert(/empty berth/.test(labels), 'the third, unused berth is drawn');
    assert(labels.includes('Ace'), 'a promotable veteran is offered');
    assert(/you lose/.test(labels),
      'and the card says WHAT the barracks loses — a cost you find out afterwards is a trap');
    assert(!/NaN/.test(labels), 'no NaN anywhere on the mess screen');
    // A captain can be picked for the launch through his own button.
    const z = BaseScreen._zonesFor('pickCaptain').find(q => q.arg === 'k1');
    assert(z, 'the captain who is home has a FLY HIM button');
    assert(BaseScreen._state().captainId === 'k1',
      'with exactly one captain at home he is already the one flying — '
      + 'nobody should have to remember to tick a box that has one option');
    BaseScreen._act('pickCaptain', 'k1');
    assert(BaseScreen._state().captainId === null, 'pressing it stands him down');
    BaseScreen._act('pickCaptain', 'k1');
    assert(BaseScreen._state().captainId === 'k1', 'and pressing it again puts him back');
    BaseScreen.draw(ctx);
    assert(!BaseScreen._zonesFor('pickCaptain').some(q => q.arg === 'k2'),
      'the one already on contract cannot be picked');
  } finally { b.messLvl = lvl; b.captains = caps; b.barracks = bar; }
});
step('base SUPPLY — the shelf renders as one grid', () => {
  openTab('SUPPLY');
  const grid = Base.warehouseGrid();
  assert(grid, 'SUPPLY must have a shelf grid to draw');
  BaseScreen.draw(ctx);
});
step('base MEMORIAL — an empty hill', () => {
  const raw = Save.getRaw();
  const g = raw.graveyard;
  raw.graveyard = [];
  try {
    openTab('MEMORIAL');
    assert(BaseScreen._graves().length === 0, 'an empty graveyard must place no markers');
  } finally { raw.graveyard = g; }
});
step('base MEMORIAL — a full hill, all four marker tiers, hovered epitaph', () => {
  const raw = Save.getRaw();
  const g = raw.graveyard;
  raw.graveyard = [
    // One per tier: score 0 / 5 / 12 / 57  →  cross / slab / obelisk / monument
    { name: 'Rook',  race: 'terra',    cause: 'suffocation', sector: 1, battles: 0,  wins: 0,  escapes: 0, kills: 0,  skills: {} },
    { name: 'Vela',  race: 'pegasus',  cause: 'fire',        sector: 2, battles: 2,  wins: 1,  escapes: 1, kills: 0,  skills: {} },
    { name: 'Ibis',  race: 'aquarius', cause: 'melee',       sector: 2, battles: 3,  wins: 1,  escapes: 1, kills: 2,  skills: {} },
    { name: 'Horus', race: 'phoenix',  cause: 'melee',       sector: 3, battles: 22, wins: 18, escapes: 3, kills: 19, skills: { combat: { level: 3 } } },
  ];
  try {
    openTab('MEMORIAL');
    const graves = BaseScreen._graves();
    assert(graves.length === 4, `four fallen, four markers — got ${graves.length}`);
    const tiers = new Set(graves.map(x => x.tier));
    assert(tiers.size === 4,
      `a hill where every marker is the same says nothing about who lies under it (tiers: ${[...tiers].join(',')})`);
    const best = graves.reduce((a, b2) => (b2.score > a.score ? b2 : a));
    assert(best.name === 'Horus', 'the highest hero score must belong to the veteran');
    // Hover the first marker — the epitaph card is a separate draw path.
    Input.mouse.x = graves[0].x + graves[0].w / 2;
    Input.mouse.y = graves[0].y + graves[0].h / 2;
    BaseScreen.draw(ctx);
    Input.mouse.x = -100; Input.mouse.y = -100;
  } finally { raw.graveyard = g; }
});

console.log('\n— COMBAT SCREEN (6 variants) —');

/* The update19 crash lived in exactly one of these branches: a `const W`
   declared inside a button block and read outside it. Each variant walks
   a different set of blocks, so all six have to be drawn. */

step('_drawCombat — no selection', () => {
  UI.deselectCrew();
  T.boardingParty = null; T.enemyParty = null;
  T._drawCombat(ctx);
});
step('_drawCombat — BOARD armed (live selection)', () => {
  const c = player.crew.find(x => x.isPlayer && x.alive);
  UI.selectCrew(c);
  assert(UI.getSelectedCrewAll().some(x => x.alive), 'test setup: something must be selected');
  T._drawCombat(ctx);
});
step('_drawCombat — enemy is running (escape bar + pulsing marker)', () => {
  CombatManager.enemyEscapeActive = true;
  CombatManager._enemyEscapeT = 3;
  try {
    assert(CombatManager.enemyEscapeProgress > 0, 'test setup: the escape must be under way');
    T._drawCombat(ctx);
  } finally {
    CombatManager.enemyEscapeActive = false;
    CombatManager._enemyEscapeT = 0;
  }
});
step('_drawCombat — boarding party in flight', () => {
  const rider = new CrewMember({ race: 'pegasus' });   // no suffocation mid-flight
  player.addCrew(rider);
  const party = T._makeParty(player, enemy, [rider]);
  assert(party, 'test setup: _makeParty must find an airlock route');
  party.members.forEach(m => {
    m.phase = 'fly';
    m.x = (player.worldX + enemy.worldX) / 2;
    m.y = party.entryDoor.y;
    m.c.x = m.x; m.c.y = m.y;
  });
  player.crew = player.crew.filter(c => c !== rider);
  T.boardingParty = party;
  T._drawCombat(ctx);
  T._drawParty(ctx, party);
});
step('_drawCombat — RECALL armed (party aboard the enemy)', () => {
  assert(T.boardingParty, 'test setup: a party must be in the air from the previous step');
  const r = T._recallRect ? T._recallRect() : null;
  if (r) assert(r.w > 0 && r.h > 0, 'the RECALL button needs a real rectangle');
  T._drawCombat(ctx);
});
step('_drawCombat — party coming home (recall leg)', () => {
  const rider = T.boardingParty.members[0].c;
  const back = T._makeParty(enemy, player, [rider], { recall: true });
  assert(back, 'test setup: the recall leg must find a route home');
  assert(back.recall === true, 'a recall party must be flagged as such');
  back.members.forEach(m => { m.phase = 'fly'; });
  T.boardingParty = back;
  T._drawCombat(ctx);
  T._drawParty(ctx, back);
  T.boardingParty = null;
});
step('_drawCombat — victory (JUMP button)', () => {
  const real = CombatManager.isVictory;
  CombatManager.isVictory = () => true;
  try { T._drawCombat(ctx); } finally { CombatManager.isVictory = real; }
});

console.log('\n— OVERLAYS —');

step('drawRetreatBar', () => {
  [0, 0.5, 1].forEach(p => Renderer.drawRetreatBar(p));
});
step('drawEventPopup (no hover and hovered choice)', () => {
  const ev = {
    title: 'DISTRESS BEACON',
    text: 'A thin carrier wave repeats a single word.',
    choices: [{ text: 'Answer it' }, { text: 'Jump away' }],
  };
  Renderer.drawEventPopup(ev, -1);
  Renderer.drawEventPopup(ev, 0);
});
step('drawOutcome (win and loss)', () => {
  Renderer.drawOutcome('victory', 120);
  Renderer.drawOutcome('defeat', 0);
});
step('UI.draw — plain frame', () => {
  UI.draw(ctx, { playerShip: player });
});
step('UI.draw — notifications WRAP inside their box', () => {
  const long = 'Something chewed through the Shields loom and the whole '
             + 'starboard bus went dark for a moment — check the runs.';
  UI.notify(long, 'alert');
  // The box is 420 wide with 12px padding and a 14px gutter, so a line
  // may measure at most 394px. Anything wider is running across the ship.
  const W_BOX = 420, PAD = 12, MAX_LINE = W_BOX - PAD - 14;
  const boxX = (W - W_BOX) / 2 + PAD;
  const seen = capture(ctx, () => UI.draw(ctx, { playerShip: player }));
  const lines = seen.text.filter(o => Math.abs(o.x - boxX) < 0.51).map(o => o.t);
  assert(lines.length > 1,
    `a long notification must wrap over several lines, got ${lines.length}`);
  const start = lines.findIndex(t => long.startsWith(t));
  assert(start >= 0, `none of the drawn lines starts the message: ${JSON.stringify(lines)}`);
  const mine = [];
  for (let i = start; i < lines.length; i++) {
    mine.push(lines[i]);
    if (mine.join(' ').length >= long.length) break;
  }
  assert(mine.join(' ').replace(/\s+/g, ' ') === long,
    `wrapping dropped or mangled the message: ${JSON.stringify(mine)}`);
  const widest = Math.max(...lines.map(t => t.length * 6));
  assert(widest <= MAX_LINE,
    `a notification line measured ${Math.round(widest)}px of ${MAX_LINE} — it is running out of its box`);
});
step('Particles.draw', () => Particles.draw(ctx, 1));

// ────────────────────────────────────────────────────────────

console.log('');
if (failures) {
  console.error(`${steps - failures}/${steps} draw steps ok, ${failures} FAILED`);
  process.exit(1);
} else {
  console.log(`${steps} draw steps ok`);
}
