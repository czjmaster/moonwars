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
/* Some update51 claims are about COLOUR, not text: a dead button and a
   live one draw the same words. This capture records the style in
   force at each call so those can be asserted at all. */
function captureStyled(ctx, fn) {
  /* The canvas stub tracks fillStyle but NOT strokeStyle, so every
     claim about colour has to be made about a FILL. That is why a
     walled cell is filled in its own stone colour and not merely
     outlined in one. */
  const text = [], fills = [], strokes = [];
  const rT = ctx.fillText, rF = ctx.fill, rS = ctx.stroke;
  ctx.fillText = (t, x, y) => {
    text.push({ t: String(t), x, y, fill: ctx.fillStyle, align: ctx.textAlign,
                font: ctx.font });
  };
  ctx.fill = function () { fills.push(String(ctx.fillStyle)); };
  ctx.stroke = function () { strokes.push(String(ctx.strokeStyle)); };
  try { fn(); } finally { ctx.fillText = rT; ctx.fill = rF; ctx.stroke = rS; }
  return { text, fills, strokes };
}

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

step('drawHUD — the commander strip (and none when nobody is flying)', () => {
  const Commander = sb.Commander;
  Commander.setActive(null);
  const without = capture(ctx, () => Renderer.drawHUD({ playerShip: player }));
  assert(!without.text.some(o => /^Voss L/.test(o.t)),
    'no commander flying, no commander strip');

  const cap = Commander.fromCrew({ id: 'hud', name: 'Voss', race: 'aquarius', skills: {} });
  cap.level = 6;
  Commander.setActive(cap);
  try {
    const seen = capture(ctx, () => Renderer.drawHUD({ playerShip: player }));
    assert(seen.text.some(o => o.t === 'Voss L6'),
      'the strip names him and shows his level');
    // He is NOT a body on the deck: no roster row, no click target.
    const roster = Renderer.crewRoster({ playerShip: player });
    assert(!roster.some(c => c.id === 'hud'),
      'and he never appears among the crew — he is not aboard as a person');
  } finally { Commander.setActive(null); }
});
step('drawHUD — a maxed commander reads full, not empty', () => {
  const Commander = sb.Commander;
  const cap = Commander.fromCrew({ id: 'hud2', name: 'Max', race: 'terra', skills: {} });
  cap.level = Commander.MAX_LEVEL;
  Commander.setActive(cap);
  try {
    assert(Commander.xpProgress(cap) === 1, 'a commander at the ceiling shows a full bar');
    Renderer.drawHUD({ playerShip: player });
  } finally { Commander.setActive(null); }
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
    // update52: the star is read off the RANK, so one mastery (rank 3)
    // is a Specialist and no star. Give him rank 6.
    { id: 'c1', name: 'Vega', race: 'terra',    hp: 22,  maxHp: 100,
      skills: { weapons: { level: 3 }, repair: { level: 3 } } },
    { id: 'c2', name: 'Rho',  race: 'aquarius', hp: 100, maxHp: 100, infected: true },
    { id: 'c3', name: 'Old',  race: 'terra' },   // a pre-update39 record: no hp fields at all
  ];
  try {
    openTab('CREW');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');
    assert(labels.includes('WOUNDED'), 'a crew member under 30% hp must read WOUNDED');
    assert(/★/.test(labels), 'a ranking veteran must show as a star on the card');
    assert(/Sergeant · 6/.test(labels), 'and the card names the rank the star stands for');
    assert(!/NaN/.test(labels),
      'an old save without hp fields must not print NaN — this was the update39 bug');
    assert(labels.includes('100/100'), 'the card must print the raw hp numbers');
  } finally { b.barracks = barracks; }
});
step('base MESS — one berth and two animal pens from day one', () => {
  const b = Base.get();
  const caps = b.commanders;
  b.commanders = [];
  try {
    openTab('MESS');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');
    assert(/THE MESS I/.test(labels), 'the mess stands at level I without being bought');
    assert(/empty berth/.test(labels), 'its one berth is drawn');
    assert(/ANIMAL PENS — 0\/2/.test(labels), 'and two empty pens for animals');
    assert(BaseScreen._zonesFor('buyMess').length === 0,
      'the mess carries NO build button of its own — it is bought on UPGRADES '
      + 'like every other building');
  } finally { b.commanders = caps; }
});
step('base MESS — a cat in a pen, pickable, with its hunger showing', () => {
  const b = Base.get();
  const kept = b.pets;
  b.pets = [
    { id: 'p1', name: 'Sputnik', race: 'cat_black',  catKind: 'black',  hp: 26, maxHp: 26, hunger: 90 },
    { id: 'p2', name: 'Pyza',    race: 'cat_ginger', catKind: 'ginger', hp: 9,  maxHp: 22, hunger: 6 },
  ];
  try {
    openTab('MESS');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');
    assert(/ANIMAL PENS — 2\/2/.test(labels), 'both pens read as full');
    assert(labels.includes('Sputni') && labels.includes('Pyza'), 'both animals are named');
    const zones = BaseScreen._zonesFor('pickPet').map(z => z.arg);
    assert(zones.includes('p1') && zones.includes('p2'), 'both are clickable');
    BaseScreen._act('pickPet', 'p2');
    assert(BaseScreen._state().petId === 'p2', 'clicking one sends it on the contract');
    BaseScreen._act('pickPet', 'p2');
    assert(BaseScreen._state().petId === null, 'and clicking again leaves it at home');
    assert(!/NaN/.test(labels), 'no NaN on the pens');
  } finally { b.pets = kept; }
});
step('cat sprite renders (and is not a recoloured rat)', () => {
  const cat = sb.makeCat('black', 'Mruk');
  assert(cat.isBeast && cat.isPet, 'a cat is a beast and a pet');
  player.addCrew(cat);
  cat.x = player.rooms[0].cx; cat.y = player.floorWalkY(0);
  ['idle', 'walk', 'fight'].forEach(state => {
    const a = Animation.catAnim(state, '#3a3a42');
    assert(a, `catAnim('${state}') must return an animation`);
  });
  cat.draw(ctx, player);
  player.crew = player.crew.filter(c => c !== cat);
});
step('base MEMORIAL — a cat gets its own marker, ranked on what it caught', () => {
  const raw = Save.getRaw();
  const g = raw.graveyard;
  raw.graveyard = [
    { name: 'Sputnik', race: 'cat_black', kills: 0,  battles: 0, wins: 0, escapes: 0, skills: {} },
    { name: 'Mruk',    race: 'cat_black', kills: 20, battles: 0, wins: 0, escapes: 0, skills: {} },
    { name: 'Vega',    race: 'terra',     kills: 0,  battles: 0, wins: 0, escapes: 0, skills: {} },
  ];
  try {
    openTab('MEMORIAL');
    const graves = BaseScreen._graves();
    assert(graves.length === 3, 'all three are on the hill');
    const t = Object.fromEntries(graves.map(x => [x.name, x.tier]));
    assert(t.Mruk !== t.Sputnik,
      `a cat that cleared twenty rats outranks one that caught none (${t.Sputnik} vs ${t.Mruk})`);
    assert(t.Sputnik !== t.Vega, 'and a cat never wears a crewman\'s marker');
    Input.mouse.x = graves[0].x + graves[0].w / 2;
    Input.mouse.y = graves[0].y + graves[0].h / 2;
    BaseScreen.draw(ctx);
    Input.mouse.x = -100; Input.mouse.y = -100;
  } finally { raw.graveyard = g; }
});
step('base UPGRADES — the mess and the pens are on the one ladder', () => {
  openTab('UPGRADES');
  const args = BaseScreen._zonesFor('upgrade').map(z => z.arg);
  const seen = capture(ctx, () => BaseScreen.draw(ctx));
  const labels = seen.text.map(o => o.t).join('|');
  assert(/THE MESS/.test(labels), 'THE MESS has a card among the upgrades');
  assert(!/CARGO RETROFIT/.test(labels),
    'and CARGO RETROFIT is gone — a hull\'s hold is its own (update46)');
  assert(/ANIMAL PENS/.test(labels), 'so do the ANIMAL PENS');
  // With enough CC every card must be buyable through its own zone.
  Save.addScrapBank(5000);
  BaseScreen.draw(ctx);
  const rich = BaseScreen._zonesFor('upgrade').map(z => z.arg);
  ['warehouse', 'barracks', 'slot', 'mess', 'pets'].forEach(k => {
    assert(rich.includes(k), `${k} must have a working UPGRADE button (got ${rich.join(', ')})`);
  });
  assert(args.length <= rich.length, 'and a poor base simply greys them out');
});
step('base MESS — berths, a commander at level 1 and one at the cap', () => {
  const b = Base.get();
  const lvl = b.messLvl, caps = b.commanders, bar = b.barracks;
  b.messLvl = 3;
  b.commanders = [
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
    assert(labels.includes('Voss') && labels.includes('Rhen'), 'both commanders are listed');
    assert(/ON CONTRACT/.test(labels), 'a commander who is away says so instead of offering to fly');
    assert(/empty berth/.test(labels), 'the third, unused berth is drawn');
    assert(labels.includes('Ace'), 'a promotable veteran is offered');
    /* update52a replaced "you lose:" with the sharper claim: which
       skills are FULLY mastered, since only those become
       specialisations. Ace has repair at 3/3 and engines at 1/3. */
    assert(/specialisations \(3\/3\): Repair/.test(labels),
      `the card names his mastered skills: ${labels.slice(0, 500)}`);
    assert(!/Engines/.test(labels.split('specialisations')[1] || ''),
      'and does NOT count the one he has only started');
    assert(!/NaN/.test(labels), 'no NaN anywhere on the mess screen');
    // A commander can be picked for the launch through his own button.
    const z = BaseScreen._zonesFor('pickCommander').find(q => q.arg === 'k1');
    assert(z, 'the commander who is home has a FLY HIM button');
    assert(BaseScreen._state().commanderId === 'k1',
      'with exactly one commander at home he is already the one flying — '
      + 'nobody should have to remember to tick a box that has one option');
    BaseScreen._act('pickCommander', 'k1');
    assert(BaseScreen._state().commanderId === null, 'pressing it stands him down');
    BaseScreen._act('pickCommander', 'k1');
    assert(BaseScreen._state().commanderId === 'k1', 'and pressing it again puts him back');
    BaseScreen.draw(ctx);
    assert(!BaseScreen._zonesFor('pickCommander').some(q => q.arg === 'k2'),
      'the one already on contract cannot be picked');
  } finally { b.messLvl = lvl; b.commanders = caps; b.barracks = bar; }
});
step('base SUPPLY — the shelf renders as one grid', () => {
  openTab('SUPPLY');
  const grid = Base.warehouseGrid();
  assert(grid, 'SUPPLY must have a shelf grid to draw');
  BaseScreen.draw(ctx);
});
step('base SUPPLY — FOUR stock lines, and the last one is on the card', () => {
  openTab('SUPPLY');
  const seen = capture(ctx, () => BaseScreen.draw(ctx));
  const labels = seen.text.map(o => o.t).join('|');
  assert(/RATIONS — \d+ CC each/.test(labels), `rations are on sale: ${labels.slice(0, 400)}`);
  /* THE FOURTH LINE USED TO FALL OFF THE BOTTOM. The shop card is
     ph-70 tall and the old pitch of 50 put the rations' buttons 36
     pixels past its edge — drawn, clickable, and invisible. */
  const buys = BaseScreen._zonesFor('buy');
  assert(buys.length >= 8, `every stock line has its two buttons (${buys.length})`);
  const kinds = new Set(buys.map(z => z.arg[0]));
  assert(kinds.has('food'), 'including rations');
  /* Against the CARD, not the panel. The first version of this check
     measured against the panel (py+ph = 524) and the old pitch put
     the last button at exactly 524 — inside the panel, well outside
     the card it is supposed to be drawn in, and the check passed on
     the broken build. The card is py+34 tall by ph-70. */
  const cardBottom = 138 + 34 + (386 - 70);
  buys.forEach(z => assert(z.y + z.h <= cardBottom,
    `a BUY button for ${z.arg[0]} runs ${Math.round(z.y + z.h - cardBottom)}px past the shop card`));
});
step('base MESS — anyone can be promoted, and the card says what it buys', () => {
  const { Commander, CrewMember } = sb;
  const b = Base.get();
  const keptCaps = b.commanders, keptMess = b.messLvl, keptBar = b.barracks;
  b.commanders = []; b.messLvl = 1; b.barracks = [];
  try {
    /* update51 deleted the update49a test bench. This is the road the
       PLAYER walks instead — and it has to work, because it is now the
       only way a commander exists at all. */
    const green = new CrewMember({ isPlayer: true, race: 'terra', name: 'Zielony' });
    Base.addCrew(green.serialise());
    Base.earn(1000);
    openTab('MESS');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');
    assert(/PROMOTE — 80 CC/.test(labels),
      `a Recruit is offered at the 80 CC floor: ${labels.slice(0, 500)}`);
    assert(/commander level 1 · 1\/25 CPU cells/.test(labels),
      `and the card says exactly what that buys: ${labels.slice(0, 500)}`);

    const z = BaseScreen._zonesFor('promote');
    assert(z.length === 1, 'and the button is clickable');
    BaseScreen._act('promote', z[0].arg);
    assert(Base.commanders().length === 1, 'pressing it seats a commander');
    const cap = Base.commanders()[0];
    assert(cap.level === 1, `who arrives at his own rank (${cap.level})`);

    // With a commander in the mess the card must now offer his board.
    const seen2 = capture(ctx, () => BaseScreen.draw(ctx));
    /* He is owed a pick for his level, so the card offers THAT before
       the board — an unspent level is a bonus the crew are not getting. */
    assert(seen2.text.some(o => /LEVEL UP \(1\)/.test(o.t)),
      'and the card offers the level he has not spent yet');
    /* update52a: the berth card is a summary now — the cells, the
       karma and the board live in his FILE, one click away. What the
       card must still say is that a level is unspent. */
    assert(seen2.text.some(o => /click for file/.test(o.t)),
      'and points at the file for everything else');
  } finally { b.commanders = keptCaps; b.messLvl = keptMess; b.barracks = keptBar; }
});
step('CPU board — an unopened cell wears the level that opens it', () => {
  const { Chips, Commander, LootScreen } = sb;
  const b = Base.get();
  const keptCaps = b.commanders, keptMess = b.messLvl;
  b.messLvl = 1;
  /* A level 3 commander: three cells open, twenty-two shut. Each shut
     one has to say WHEN it opens, or twenty-five cells opening one at
     a time is unreadable. */
  const cap = Commander.fromCrew({ id: 'k7', name: 'Prob', race: 'terra', skills: {} });
  cap.level = 3; cap.karma = 50;
  b.commanders = [cap];
  try {
    assert(Chips.cellsFor(3) === 3, 'test setup: three cells open');
    T._openCpuBoard('k7');
    const seen = capture(ctx, () => LootScreen.draw(ctx));
    const labels = seen.text.map(o => o.t);
    assert(labels.includes('4') && labels.includes('25'),
      `every shut cell is stamped with its own level: ${labels.join('|').slice(0, 300)}`);
    assert(!labels.includes('3'),
      'and an OPEN cell carries no number — only the shut ones do');
    assert(seen.text.some(o => /3\/25 cells open/.test(o.t)),
      'and the board says how far he has got');
    assert(seen.text.some(o => /level 4/.test(o.t)),
      'and what the very next level buys');
    LootScreen.update(0.016);
  } finally { b.commanders = keptCaps; b.messLvl = keptMess; }
});
step('CPU board — an unlit cell and the karma wall do not share a colour', () => {
  const { Chips, Commander, LootScreen } = sb;
  const b = Base.get();
  const keptCaps = b.commanders, keptMess = b.messLvl;
  b.messLvl = 1;
  const cap = Commander.fromCrew({ id: 'k8', name: 'Prob2', race: 'terra', skills: {} });
  cap.level = 12; cap.karma = 50;      // wall in column 3, cells 13+ unlit
  b.commanders = [cap];
  try {
    T._openCpuBoard('k8');
    const seen = captureStyled(ctx, () => LootScreen.draw(ctx));
    const fills = new Set(seen.fills);
    assert(fills.has('rgba(26,28,34,0.95)'),
      'an unlit cell is stone — it opens by itself if he keeps flying');
    assert(fills.has('rgba(40,26,20,0.9)'),
      'the karma wall is orange — it opens only by changing the man');
    LootScreen.update(0.016);
  } finally { b.commanders = keptCaps; b.messLvl = keptMess; }
});
step('base MESS — a better hand costs more, and the card quotes HIM', () => {
  const { CrewMember } = sb;
  const b = Base.get();
  const keptCaps = b.commanders, keptMess = b.messLvl, keptBar = b.barracks;
  b.commanders = []; b.messLvl = 1; b.barracks = [];
  try {
    const gold = new CrewMember({ isPlayer: true, race: 'terra', name: 'Złoty' });
    ['weapons', 'piloting', 'engines'].forEach(k => { gold.skills[k].level = 3; });
    Base.addCrew(gold.serialise());
    Base.earn(2000);
    openTab('MESS');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');
    assert(/PROMOTE — 410 CC/.test(labels),
      `a rank 9 hand is quoted at his own price, not the floor: ${labels.slice(0, 500)}`);
    assert(/commander level 9 · 9\/25 CPU cells · 9 level-up picks/.test(labels),
      `and the card says the nine levels that buys: ${labels.slice(0, 500)}`);
  } finally { b.commanders = keptCaps; b.messLvl = keptMess; b.barracks = keptBar; }
});
step('combat HUD — every order is in one panel, and a spent one looks spent', () => {
  const { Commander, Renderer, Input } = sb;
  const keptCap = T.commander;
  try {
    Commander.resetOrders();
    const cap = Commander.fromCrew({ id: 'ord', name: 'Boss', race: 'terra',
      skills: { piloting: { level: 3 }, weapons: { level: 3 }, combat: { level: 3 } } });
    cap.level = 12;
    Commander.setActive(cap); T.commander = cap;

    Input.mouse.x = -50; Input.mouse.y = -50;      // nothing hovered
    const live = captureStyled(ctx, () =>
      Renderer.drawHUD({ playerShip: T.playerShip, enemyShip: T.enemyShip }));
    const labels = live.text.map(o => o.t).join('|');
    assert(/ORDERS/.test(labels), 'the panel is titled ORDERS');
    assert(/SPECIAL \(3\)/.test(labels), 'and counts his three specialisations');

    /* THE WHOLE POINT OF update53: one column, not two places. */
    const R = Renderer.orderRects();
    const all = [R.crewSave, R.doorsOpen, R.board, R.recall, R.retreat, ...R.specials];
    assert(all.every(r => r.x >= 14 && r.x < 160), 'every order is in the one column');

    /* A SPENT ORDER IS STRUCK THROUGH AND GREY. Grey alone reads as
       "not yet", and this one is not coming back until the next fight. */
    const glyph = (cap2, key) => {
      const g = Renderer.orderRects().specials.find(s => s.key === key);
      return cap2.text.find(o => Math.abs(o.x - (g.x + g.w / 2)) < 2
                              && Math.abs(o.y - (g.y + g.h / 2 + 5)) < 2);
    };
    assert(glyph(live, 'weapons').fill === '#4dd8c0',
      'an order he can give is drawn live');

    Commander.giveOrder('weapons');
    const after = captureStyled(ctx, () =>
      Renderer.drawHUD({ playerShip: T.playerShip, enemyShip: T.enemyShip }));
    assert(Commander.orderUsed('weapons'), 'test setup: it is spent');
    assert(glyph(after, 'weapons').fill === '#3a4560',
      `a spent one goes grey (${glyph(after, 'weapons').fill})`);
    assert(after.strokes.includes('#5a6478'),
      'and is struck through — grey alone reads as "not yet"');
    assert(!live.strokes.includes('#5a6478'),
      'which an unspent one is not');

    /* A RUNNING ORDER IS LIT. */
    Commander.giveOrder('piloting');
    assert(Commander.orderLeft('evasion') > 0, 'test setup: one is running');
    const running = captureStyled(ctx, () =>
      Renderer.drawHUD({ playerShip: T.playerShip, enemyShip: T.enemyShip }));
    assert(running.fills.includes('rgba(77,216,192,0.22)'),
      'a running order is filled, not just outlined');

    /* HOVERING ONE EXPLAINS IT — eight glyphs are eight riddles
       otherwise. */
    /* Ask for the rects AGAIN — the panel hangs under a crew list and
       the layout is only settled by the last draw, so a rectangle
       cached before three redraws is not the one on screen. */
    const sp = Renderer.orderRects().specials.find(s => s.key === 'combat');
    Input.mouse.x = sp.x + 2; Input.mouse.y = sp.y + 2;
    const hov = capture(ctx, () =>
      Renderer.drawHUD({ playerShip: T.playerShip, enemyShip: T.enemyShip }));
    const hl = hov.text.map(o => o.t).join('|');
    assert(/BATTLE FURY/.test(hl), `hovering names the order: ${hl.slice(0, 200)}`);
    assert(/melee/.test(hl), 'and says what it does');
    Input.mouse.x = -50; Input.mouse.y = -50;
  } finally {
    T.commander = keptCap;
    Commander.setActive(keptCap || null);
    Commander.resetOrders();
  }
});
step('base MESS — a cat can be adopted, and the button dies with the purse', () => {
  const b = Base.get();
  const kept = b.pets;
  b.pets = [];
  try {
    Base.earn(1000);
    openTab('MESS');
    let seen = capture(ctx, () => BaseScreen.draw(ctx));
    assert(seen.text.some(o => /ADOPT A CAT/.test(o.t)), 'the pens offer a cat');
    assert(BaseScreen._zonesFor('adoptCat').length === 1, 'and it is clickable');
    BaseScreen._act('adoptCat');
    assert(Base.pets().length === 1, 'clicking it puts a cat in a pen');
    // Fill the pens: the button must go dead rather than overfill them.
    while (Base.pets().length < Base.petCap() && Base.adoptCat().ok) { /* fill */ }
    seen = capture(ctx, () => BaseScreen.draw(ctx));
    assert(BaseScreen._zonesFor('adoptCat').length === 0,
      'with every pen full the button is dead');
  } finally { b.pets = kept; }
});
step('crew hover panel — air, food, and a cat with ONE skill', () => {
  const man = player.crew.find(c => !c.isBeast);
  assert(man, 'the smoke ship must have a crewman to hover');
  man.hunger = 30; man.air = man.airMax() / 2;
  let seen = capture(ctx, () => UI._skillPanel(ctx, man));
  let labels = seen.text.map(o => o.t);
  assert(labels.includes('AIR'), `the panel shows an air bar: ${labels.join('|')}`);
  assert(labels.includes('FOOD'), 'and a food bar');
  assert(labels.some(t => /^\d+s \/ \d+s$/.test(t)),
    `air is in SECONDS, which is what a decision is made on: ${labels.join('|')}`);

  const cat = sb.makeCat('black', 'Mruk');
  seen = capture(ctx, () => UI._skillPanel(ctx, cat));
  labels = seen.text.map(o => o.t);
  assert(labels.includes('Combat'), 'a cat is rated for combat');
  ['Piloting', 'Shields', 'Breach Rep', 'Repair'].forEach(s =>
    assert(!labels.includes(s), `and NOT for ${s} — it cannot man a console`));
  assert(labels.includes('AIR') && labels.includes('FOOD'),
    'but it breathes and it eats like everything else aboard');

  /* AND EVERYTHING IN IT IS INSIDE IT.
     The box height was a hard-coded 210 that exactly fitted eight
     skill rows and nothing else, so the two new bars pushed the last
     two skills out through the bottom border. Catch the box the panel
     draws for itself and check every row against it. */
  [man, cat].forEach((who) => {
    const boxes = [];
    const realRR = ctx.roundRect;
    ctx.roundRect = (x, y, w, h) => { boxes.push({ x, y, w, h }); };
    let drawn;
    try { drawn = capture(ctx, () => UI._skillPanel(ctx, who)); }
    finally { ctx.roundRect = realRR; }
    assert(boxes.length >= 1, 'the panel draws its own box');
    const box = boxes[0];
    const rows = drawn.text.concat(drawn.rects.map(r => ({ t: 'bar', x: r.x, y: r.y + r.h })));
    rows.forEach(r => assert(r.y <= box.y + box.h,
      `${who.name}: "${r.t}" is drawn ${Math.round(r.y - box.y - box.h)}px below the panel`));
  });
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
step('drawEventPopup — a moral choice states its price BEFORE you take it', () => {
  const { Commander, Chips, CargoItem } = sb;
  const cap = Commander.fromCrew({ id: 'e1', name: 'Sowa', race: 'terra', skills: {} });
  cap.level = 8; cap.karma = 50;
  const b = Chips.board(cap);
  assert(b.place(new CargoItem(Chips.itemKey('fire_control', 2)), 0, 0),
    'test setup: an Etos chip that a swing to evil will kill');
  Chips.commit(cap, b);
  Commander.setActive(cap);
  try {
    const ev = { title: 'Test', text: 'A choice.', choices: [
      { label: 'Finish them', result: { karma: -40 } },
      { label: 'Let them go', result: { karma: 5 } },
      { label: 'Walk away',   result: {} },
    ] };
    const seen = capture(ctx, () => Renderer.drawEventPopup(ev, -1));
    const labels = seen.text.map(o => o.t);
    assert(labels.some(t => /KARMA -40/.test(t)),
      `the cost is on the button: ${labels.join('|')}`);
    assert(labels.some(t => /KARMA \+5/.test(t)), 'and the reward on the other');
    assert(labels.some(t => /chip/i.test(t)),
      `and it warns which chips will go out: ${labels.join('|')}`);
    assert(!labels.some(t => /KARMA 0/.test(t)),
      'a choice with no moral weight says nothing at all');
  } finally { Commander.setActive(null); }
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
step('cargo screen — every button on the row, none of them under DONE', () => {
  const { LootScreen, CargoGrid } = sb;
  const shelf = new CargoGrid(8, 6);
  const hold  = new CargoGrid(5, 4);
  shelf.add('he2_large', null, 16);
  hold.add('medkit', null, 4);
  hold.add('gun_crate');
  LootScreen.openLoot(shelf, hold, {
    title: 'WAREHOUSE', onSell: () => 1, portType: 'general',
  });
  LootScreen.draw(ctx);
  /* A crate has to be SELECTED or half the row is drawn dead and pushes
     no zone at all — which would make this a test of two buttons. */
  const kit = hold.items.find(i => i.def.kind === 'heal');
  const rr = LootScreen._gridRect('hold');
  let pt = null;
  for (let y = rr.y + 2; y < rr.y + rr.h && !pt; y += 2)
    for (let x = rr.x + 2; x < rr.x + rr.w && !pt; x += 2) {
      const c = LootScreen._cellAt('hold', x, y);
      if (c && c.cx === kit.x && c.cy === kit.y) pt = [x, y];
    }
  sb.Input.mouse.x = pt[0]; sb.Input.mouse.y = pt[1];
  sb.Input.mouse.leftPressed = true;
  LootScreen.update(0.016);
  sb.Input.mouse.leftPressed = false;
  LootScreen.update(0.016);
  const seen = capture(ctx, () => LootScreen.draw(ctx));
  assert(!seen.text.some(o => /NaN/.test(o.t)), 'no NaN on the cargo screen');

  /* SPLIT joined a row that was already 936px wide and ended 104px
     short of DONE. Every button has to stay on the canvas and clear of
     the one that closes the screen. */
  const acts = ['rotate', 'tidy', 'split', 'takeAll', 'unpack', 'sell', 'dump', 'done'];
  const zones = acts.map(a => [a, LootScreen._zoneFor(a)]).filter(([, z]) => z);
  assert(zones.length >= 4, `the row draws its buttons (${zones.length})`);
  const done = LootScreen._zoneFor('done');
  assert(done, 'DONE is always there');
  zones.forEach(([a, z]) => {
    assert(z.x >= 0 && z.x + z.w <= 1280, `${a} runs off the canvas (${z.x}..${z.x + z.w})`);
    if (a !== 'done') {
      assert(z.x + z.w <= done.x,
        `${a} overlaps DONE by ${Math.round(z.x + z.w - done.x)}px`);
    }
  });
});
step('cargo screen — a carried crate follows the cursor and SPLIT lights up', () => {
  const { LootScreen, CargoGrid, Input } = sb;
  const hold = new CargoGrid(5, 4);
  const drum = hold.add('he2_large', null, 12);
  LootScreen.openHold(hold, {});
  LootScreen.draw(ctx);
  const r = LootScreen._gridRect('hold');
  let p = null;
  for (let y = r.y + 2; y < r.y + r.h && !p; y += 2)
    for (let x = r.x + 2; x < r.x + r.w && !p; x += 2) {
      const c = LootScreen._cellAt('hold', x, y);
      if (c && c.cx === drum.x && c.cy === drum.y) p = [x, y];
    }
  assert(p, 'the drum can be pointed at');
  Input.mouse.x = p[0]; Input.mouse.y = p[1];
  Input.mouse.leftPressed = true;
  LootScreen.update(0.016);
  Input.mouse.leftPressed = false;
  assert(!hold.items.includes(drum), 'test setup: it really is in the hand');
  const seen = capture(ctx, () => LootScreen.draw(ctx));
  assert(seen.text.some(o => /SPLIT — 6/.test(o.t)),
    `SPLIT says what it will take off: ${seen.text.map(o => o.t).join('|').slice(0, 200)}`);
  // And it has to be PRESSABLE — a disabled button still draws its
  // label, so the text alone would pass on a dead button.
  assert(LootScreen._zoneFor('split'), 'and the SPLIT button can actually be clicked');
  LootScreen.update(0.016);
});
step('cargo screen — DOCKED says what selling the rest pays', () => {
  const { LootScreen, CargoGrid } = sb;
  const shelf = new CargoGrid(8, 6);
  const hold  = new CargoGrid(5, 4);
  const relic = hold.add('alien_relic');
  LootScreen.openLoot(shelf, hold, {
    title: 'DOCKED', sellRestOnDone: true, portType: 'general',
    onSell: (it) => it.value('general'),
  });
  const seen = capture(ctx, () => LootScreen.draw(ctx));
  const worth = relic.value('general');
  assert(seen.text.some(o => o.t === `SELL THE REST — ${worth} CC`),
    `the button names the price: ${seen.text.map(o => o.t).join('|').slice(0, 200)}`);
  const z = LootScreen._zoneFor('done');
  assert(z && z.x + z.w <= 1280, 'and it still fits on the canvas');
});
step('CPU board — the wall, the two sides and a dead chip all render', () => {
  const { Chips, Commander, CargoItem, LootScreen } = sb;
  const b = Base.get();
  const keptCaps = b.commanders, keptMess = b.messLvl;
  b.messLvl = 1;
  const cap = Commander.fromCrew({ id: 'k9', name: 'Rusz', race: 'terra', skills: {} });
  cap.level = 8; cap.karma = 50;
  // One chip that works and one the karma has since turned off.
  const board = Chips.board(cap);
  assert(board.place(new CargoItem(Chips.itemKey('fire_control', 2)), 0, 0),
    'test setup: an Etos chip on the good side');
  assert(board.place(new CargoItem(Chips.itemKey('assault_squad', 2)), 3, 0),
    'test setup: a Dominacja chip on the evil side');
  Chips.commit(cap, board);
  b.commanders = [cap];
  try {
    T._openCpuBoard('k9');
    assert(LootScreen.isOpen(), 'the board screen opened');
    let seen = capture(ctx, () => LootScreen.draw(ctx));
    let labels = seen.text.map(o => o.t).join('|');
    /* THE SUBTITLE IS THE ONLY PLACE the board says where the wall
       stands and how far his level has got, and it is read before
       anything else on the screen. */
    assert(/wall in column 3/.test(labels),
      `the subtitle names the wall column: ${labels.slice(0, 200)}`);
    assert(/8\/25 cells \(level 8\)/.test(labels),
      `and how many CELLS his level has opened, not a row count: ${labels.slice(0, 200)}`);
    assert(/ETHOS/.test(labels) && /DOMINANCE/.test(labels),
      `both sides are named on the board: ${labels.slice(0, 300)}`);
    assert(!/NaN/.test(labels), 'no NaN on the CPU board');

    // Swing the karma: the Dominacja chip must now read as dead.
    cap.karma = 95;
    const live = Chips.live(cap);
    assert(live.length === 1, `only the Etos chip still works (${live.length})`);
    seen = capture(ctx, () => LootScreen.draw(ctx));
    labels = seen.text.map(o => o.t).join('|');
    assert(seen.text.length > 0, 'and the screen still draws with a dead chip on it');

    // Selecting the dead chip must explain itself.
    const r = LootScreen._gridRect('hold');
    let p = null;
    for (let y = r.y + 2; y < r.y + r.h && !p; y += 2)
      for (let x = r.x + 2; x < r.x + r.w && !p; x += 2) {
        const c = LootScreen._cellAt('hold', x, y);
        if (c && c.cx === 3 && c.cy === 0) p = [x, y];
      }
    assert(p, 'the dead chip can be pointed at');
    /* The reason is printed UNDER THE BOARD, not in the detail panel:
       an inert chip has no square left to stand on, so clicking it to
       read about it would push it onto the shelf. */
    assert(p, 'the dead chip is where the test put it');
    assert(/DEAD: /.test(labels),
      `the board says which chip is dead and why: ${labels.slice(0, 400)}`);
  } finally {
    b.commanders = keptCaps; b.messLvl = keptMess;
  }
});
step('base MESS — the card is a summary and the FILE holds the detail', () => {
  const b = Base.get();
  const keptCaps = b.commanders, keptMess = b.messLvl;
  b.messLvl = 1;
  b.commanders = [{ id: 'k9', name: 'Rusz', race: 'terra', level: 4, xp: 10,
                  karma: 20, chips: [], picks: { hp: 4 }, specialties: ['repair'],
                  away: false }];
  try {
    openTab('MESS');
    const seen = capture(ctx, () => BaseScreen.draw(ctx));
    const labels = seen.text.map(o => o.t).join('|');

    /* ── THE CARD. update52a took the karma line off it: at 62 pixels
       it ran straight through the XP figure, which is the overlap JJ
       was looking at. What stays is what you scan a berth for. */
    assert(/Rusz/.test(labels), 'the card names him');
    assert(/Corporal/.test(labels), 'and his rank');
    assert(/CPU BOARD/.test(labels), 'and offers the board, his levels being spent');
    assert(/click for file/.test(labels),
      'and says where the rest of it lives');
    assert(!/karma 20/.test(labels),
      'the karma line is NOT on the card any more — that was the collision');

    /* NOTHING MAY OVERLAP. Two runs of text on the same line whose
       boxes intersect is the actual defect; assert it directly rather
       than by eye. */
    const styled = captureStyled(ctx, () => BaseScreen.draw(ctx));
    /* Only the MESS panel itself — the launch bar below it has its own
       layout and is not what this step is about. The box has to respect
       textAlign: a right-aligned run ENDS at its x. */
    const inPanel = styled.text.filter(o => o.y > 150 && o.y < 520);
    const rows = {};
    inPanel.forEach(o => {
      const w = String(o.t).length * 6;
      const x = o.align === 'right'  ? o.x - w
              : o.align === 'center' ? o.x - w / 2 : o.x;
      /* GROUP WITH TOLERANCE. Two runs a couple of pixels apart still
         overlap on screen, and keying rows by an exact y let a real
         collision through — the mess subtitle at y=180 sailed past the
         candidate blurb at y=182. */
      const key = Math.round(o.y / 6) * 6;
      (rows[key] = rows[key] || []).push({ t: o.t, x, w, y: o.y });
    });
    Object.entries(rows).forEach(([y, items]) => {
      const boxed = items.sort((a, c) => a.x - c.x);
      for (let i = 1; i < boxed.length; i++) {
        assert(boxed[i].x >= boxed[i - 1].x + boxed[i - 1].w - 1,
          `"${boxed[i - 1].t}" and "${boxed[i].t}" collide on row ${y}`);
      }
    });

    // ── THE FILE. Everything the card no longer says has to be here.
    BaseScreen._act('dossier', 'k9');
    const file = capture(ctx, () => BaseScreen.draw(ctx));
    const f = file.text.map(o => o.t).join('|');
    assert(/Rusz/.test(f), 'the file names him');
    assert(/SHIP COMMANDER/.test(f), 'and says what he is');
    assert(/Corporal/.test(f) && /LEVEL 4 \/ 24/.test(f), 'his rank and level');
    assert(/KARMA/.test(f) && /20 \/ 100/.test(f), 'his karma, in full');
    assert(/Ethos columns/.test(f), 'and what that karma actually buys him');
    assert(/SPECIALISATIONS/.test(f) && /Repair/.test(f), 'his specialisations');
    assert(/CPU BOARD/.test(f) && /4\/25 cells/.test(f), 'and his board, read-only');
    assert(/CLOSE/.test(f), 'with a way out');

    const z = BaseScreen._zonesFor('dossierClose');
    assert(z.length >= 1, 'CLOSE is clickable');
    BaseScreen._act('dossierClose');
    const back = capture(ctx, () => BaseScreen.draw(ctx));
    assert(!back.text.some(o => /SHIP COMMANDER/.test(o.t)), 'and it really closes');
  } finally { b.commanders = keptCaps; b.messLvl = keptMess; }
});
step('combat HUD — the pod button, its countdown and the enemy commander', () => {
  const { Commander, Chips, CargoItem } = sb;
  const cap = Commander.fromCrew({ id: 'p1', name: 'Ewa', race: 'terra', skills: {} });
  cap.level = 8; cap.karma = 50;
  const b = Chips.board(cap);
  assert(b.place(new CargoItem(Chips.itemKey('escape_pod', 2)), 0, 0),
    'test setup: a pod on his board');
  Chips.commit(cap, b);
  const foe = Commander.rollEnemy(3, { level: 5, race: 'phoenix' });
  Commander.setActive(cap);
  Commander.setEnemy(foe);
  T.commander = cap;
  T.STATE = 'combat';
  try {
    let seen = capture(ctx, () => T._drawEvac(ctx));
    let labels = seen.text.map(o => o.t).join('|');
    assert(/POD /.test(labels), `the pod offers itself: ${labels}`);
    assert(/10s/.test(labels), `and says how long it takes: ${labels}`);

    assert(T._startEvac(), 'it can be fired');
    T._tickEvac(2);
    seen = capture(ctx, () => T._drawEvac(ctx));
    labels = seen.text.map(o => o.t).join('|');
    assert(/POD /.test(labels) && /\d+s/.test(labels),
      `and then shows a live countdown: ${labels}`);

    // The enemy commander badge: corporation and level, nothing else.
    seen = capture(ctx, () => Renderer.drawHUD({ playerShip: player, enemyShip: enemy }));
    labels = seen.text.map(o => o.t).join('|');
    assert(/L5/.test(labels), `their commander's level is shown: ${labels.slice(0, 300)}`);
    assert(!/Rezerwa|Oddział|chip/i.test(labels),
      'but never his board or his chips — the spec allows a badge and no more');
  } finally {
    T._tickEvac(99);           // let it finish rather than leaving it armed
    Commander.setActive(null); Commander.setEnemy(null); T.commander = null;
    T.STATE = 'combat';
  }
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
