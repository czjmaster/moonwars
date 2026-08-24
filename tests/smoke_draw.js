'use strict';
/* smoke_draw.js — RUN BEFORE EVERY PACKAGE (per HANDOFF §4).
 * Exercises every render path against a Proxy canvas context. Logic
 * tests don't touch draw code, so a ReferenceError in a draw function
 * (a missing helper, a renamed rect) only ever shows up here — or in
 * the player's black screen. */
const { loadEngine } = require('./harness.js');

let failures = 0, passed = 0;
function step(label, fn) {
  try { fn(); passed++; console.log('  ok   ' + label); }
  catch (e) {
    failures++;
    console.error('  FAIL ' + label + '\n       ' + (e && e.stack || e));
  }
}

(async function main() {
  const sb = loadEngine();
  const { Game, Renderer, UI, Save, SectorMap, Ship, CrewMember, CombatManager, Particles } = sb;

  await Game.init();
  const T = Game.__test;
  const ctx = Renderer.getCtx();

  console.log('\n— draw smoke —');

  step('Renderer.drawBackground', () => Renderer.drawBackground(12.5));

  // A live run is required before ships/map/HUD can be drawn
  Save.load();
  Save.startRun();
  const run = Save.getRun();

  const player = new Ship('frigate', true, 80, 120);
  const enemy  = new Ship('enemy_frigate', false, 850, 120);
  [player, enemy].forEach(sh => {
    sh._allocateDefaultPower();
    sh.prechargeShields();
  });
  sb.makeStartingCrew().forEach(c => player.addCrew(c));
  sb.makeEnemyCrew(3).forEach(c => enemy.addCrew(c));
  player.assignStations();
  enemy.assignStations();

  step('player ship.draw', () => player.draw(ctx));
  step('enemy ship.draw',  () => enemy.draw(ctx));

  step('drawMapScreen (lane pick)', () => {
    const map = new SectorMap(1, 12345, 1);
    Renderer.drawMapScreen(map, null);
    Renderer.drawMapScreen(map, map.nodes[0] ? map.nodes[0].id : null);
  });

  // update39: the map has three visibility tiers now, and the '?' ghost
  // and the dashed horizon edges are drawn by code the logic tests never
  // touch. Both states, plus a hover on an unsurveyed node.
  step('drawMapScreen (unsurveyed / surveyed / hovering the fog)', () => {
    const fog = new SectorMap(2, 8686, 1, 3, true);
    Renderer.drawMapScreen(fog, null);
    const dark = fog.nodes.find(n => fog.visibilityOf(n) !== 'known');
    Renderer.drawMapScreen(fog, dark ? dark.id : null);
    fog.travelTo((fog.reachable()[0] || fog.current()).id);
    fog.unlockNext();
    Renderer.drawMapScreen(fog, fog.currentId);
    fog.revealAll();
    Renderer.drawMapScreen(fog, fog.currentId);
  });

  // update39: moon rats have their own sprite set, in every state, and
  // nothing in the logic suite ever rasterises one.
  step('moon rat draws (idle / walk / fight / dead)', () => {
    const rat = sb.makeRats(1)[0];
    rat.x = 200; rat.y = 200;
    ['idle', 'walk', 'fight'].forEach(st => {
      rat._animState = null;
      rat._setAnim(st);
      rat.draw(ctx);
    });
    rat.takeDamage(999, 'crew');
    rat.draw(ctx);
  });

  step('drawHUD (map)',    () => Renderer.drawHUD({ playerShip: player }));
  step('drawHUD (combat)', () => Renderer.drawHUD({ playerShip: player, enemyShip: enemy }));
  step('drawHUD (nebula)', () => Renderer.drawHUD({ playerShip: player, enemyShip: enemy, nebula: true }));

  step('UI.draw', () => UI.draw(ctx, { playerShip: player }));

  // ── Combat screen: this is where the new RECALL button lives ──
  T.playerShip = player;
  T.enemyShip  = enemy;
  T.STATE = 'combat';
  CombatManager.begin(player, enemy, 'normal');
  // begin() starts in 'entering' — advance to 'active' (HANDOFF §4)
  for (let i = 0; i < 40 && !CombatManager.isActive(); i++) CombatManager.update(0.05);

  step('_drawCombat (no selection)', () => T._drawCombat(ctx));

  step('_drawCombat (crew selected → BOARD armed)', () => {
    UI.selectCrewGroup(player.crew.filter(c => c.alive).slice(0, 2));
    T._drawCombat(ctx);
  });

  step('_drawCombat (boarding party in flight)', () => {
    const sel = player.crew.filter(c => c.alive).slice(0, 2);
    const party = T._makeParty(player, enemy, sel);
    if (!party) throw new Error('_makeParty returned null — no airlock route');
    T.boardingParty = party;
    for (let i = 0; i < 30; i++) T._updateParty(party, 0.1);
    T._drawCombat(ctx);
    T._drawParty(ctx, party);
  });

  step('_drawCombat (RECALL armed — boarders on enemy hull)', () => {
    // Put a player boarder physically onto the enemy roster
    const b = new CrewMember({});
    const room = enemy.rooms[enemy.rooms.length - 1];
    b.x = room.cx; b.y = room.cy; b.roomId = room.id; b.homeRoomId = room.id;
    enemy.addCrew(b, true);
    T.boardingParty = null;
    UI.selectCrewGroup([b]);
    T._drawCombat(ctx);
  });

  step('_drawCombat (recall party returning)', () => {
    const boarders = enemy.crew.filter(c => c.isPlayer && c.alive);
    const party = T._makeParty(enemy, player, boarders, { recall: true });
    if (!party) throw new Error('recall _makeParty returned null');
    T.boardingParty = party;
    for (let i = 0; i < 20; i++) T._updateParty(party, 0.1);
    T._drawCombat(ctx);
  });

  // ── Cloak now lives ON its module in the power bar: draw all states ──
  step('power bar with CLOAK module (ready / active / recharging)', () => {
    const cloakShip = new Ship('frigate', true, 80, 120);
    if (!cloakShip.addModule('cloaking')) throw new Error('could not fit a cloaking module');
    cloakShip._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => cloakShip.addCrew(c));
    const cloak = cloakShip.getSystem('cloaking');
    if (!cloak) throw new Error('cloaking system missing after addModule');

    // The starting reactor is fully committed — free a unit first,
    // exactly as the player would before running a cloak.
    const eng = cloakShip.getSystem('engines');
    cloakShip.setPowerAt(cloakShip.systems.indexOf(eng), 0);
    cloakShip.setPowerAt(cloakShip.systems.indexOf(cloak), cloak.maxPower);
    if (cloak.power <= 0) throw new Error('cloak could not be powered after freeing a reactor unit');
    Renderer.drawHUD({ playerShip: cloakShip });          // READY

    cloak.activateCloak();
    if (!cloak.cloakActive) throw new Error('activateCloak() did not engage');
    Renderer.drawHUD({ playerShip: cloakShip });          // CLOAKED

    cloak.cloakActive = false; cloak.cloakCd = 12;
    Renderer.drawHUD({ playerShip: cloakShip });          // RECHARGE

    cloak.cloakCd = 0;
    cloakShip.setPowerAt(cloakShip.systems.indexOf(cloak), 0);
    Renderer.drawHUD({ playerShip: cloakShip });          // NO PWR

    // The icon must publish an ACTIVATE zone, not a power toggle
    const zones = Renderer.getPowerClickZones();
    const idx = cloakShip.systems.indexOf(cloak);
    if (!zones.some(z => z.sysActivateIndex === idx)) {
      throw new Error('cloak module has no activate click zone in the power bar');
    }
    if (zones.some(z => z.sysToggleIndex === idx)) {
      throw new Error('cloak module should not also expose a power-toggle zone');
    }
  });

  step('_drawCombat (enemy escaping — warning marker)', () => {
    T.boardingParty = null;
    CombatManager.enemyEscapeActive = true;
    CombatManager._enemyEscapeT = 4;
    T._drawCombat(ctx);
    CombatManager.enemyEscapeActive = false;
  });

  // ── HOME BASE screen: every tab, empty and stocked ──
  step('BaseScreen.draw (all tabs, stocked base)', () => {
    const { Base, BaseScreen } = sb;
    Base.earn(3000);
    Base.hireRecruit(); Base.hireRecruit();
    Base.buySupply('fuel', 4); Base.buySupply('missiles', 3);
    Base.buyShip('frigate');
    BaseScreen.open();
    ['HANGAR', 'ARMOURY', 'CREW', 'SUPPLY', 'UPGRADES', 'MEMORIAL'].forEach(tab => {
      BaseScreen._set({ tab });
      BaseScreen.draw(ctx);
    });
  });

  step('BaseScreen.draw (empty hangar + empty barracks)', () => {
    const { Base, BaseScreen } = sb;
    // Wipe the hangar and barracks the way a lost contract would
    while (Base.ships().length) Base.checkoutShip(0);
    Base.crew().forEach(c => Base.removeCrew(c.id));
    BaseScreen.open();
    ['HANGAR', 'ARMOURY', 'CREW', 'SUPPLY', 'UPGRADES', 'MEMORIAL'].forEach(tab => {
      BaseScreen._set({ tab });
      BaseScreen.draw(ctx);
    });
  });

  step('BaseScreen SUPPLY tab: the ONE warehouse (empty and stocked)', () => {
    const { Base, BaseScreen } = sb;
    BaseScreen.open();
    BaseScreen._set({ tab: 'SUPPLY' });
    BaseScreen.draw(ctx);                        // empty shelf
    const shelf = Base.warehouseGrid();
    shelf.clear();
    BaseScreen.open(); BaseScreen._set({ tab: 'SUPPLY' });
    Base.commitWarehouse(shelf);
    BaseScreen.draw(ctx);                         // genuinely empty shelf
    ['medkit', 'medkit', 'alien_relic', 'contraband'].forEach(k => shelf.add(k));
    const cooked = shelf.add('unstable_core');
    if (cooked) cooked.damaged = true;            // a spoiled row too
    Base.commitWarehouse(shelf);
    BaseScreen.draw(ctx);                         // stocked shelf, with the list
    // …and a shelf with every KIND on it at once — fuel, warheads, guns
    // and salvage share one store now, so one panel has to render them all.
    const packed = Base.warehouseGrid();
    packed.addStack('he2_med', 12);
    packed.addStack('missile_rack', 14);
    ['medkit','ration','contraband','alien_relic','data_core','scrap_pile',
     'unstable_core','cooler_crate'].forEach(k => { try { packed.add(k); } catch (e) {} });
    ['laser_burst','ion_basic','flak_basic'].forEach(k => {
      try { packed.add(sb.cargoCrateForWeapon(k), k); } catch (e) {}
    });
    Base.commitWarehouse(packed);
    BaseScreen.draw(ctx);
    // …and the SHOP panel with an empty purse and a full shelf.
    BaseScreen.draw(ctx);
  });

  step('BaseScreen HANGAR: both lists scrolled to every position', () => {
    const { Base, BaseScreen } = sb;
    Base.earn(5000);
    Base.get().slotsLvl = 4;
    Base.catalog().forEach(d => { try { Base.buyShip(d.key); } catch (e) {} });
    BaseScreen.open();
    BaseScreen._set({ tab: 'HANGAR' });
    const n = Math.max(Base.catalog().length, Base.get().ships.length);
    for (let i = 0; i <= n + 1; i++) {
      BaseScreen._set({ yardScroll: i, berthScroll: i });
      BaseScreen.draw(ctx);
    }
    BaseScreen._set({ yardScroll: 0, berthScroll: 0 });
  });

  step('BaseScreen CREW: veteran star and plague markers', () => {
    const { Base, BaseScreen, CrewMember, MAX_SKILL_LEVEL } = sb;
    const b = Base.get();
    const gold = new CrewMember({ name: 'Auriga' });
    ['weapons', 'shields', 'repair'].forEach(k => gold.skills[k].level = MAX_SKILL_LEVEL);
    const sick = new CrewMember({ name: 'Rigel' });   sick.virus = true;
    const rot  = new CrewMember({ name: 'Deneb' });   rot.infected = true;
    b.barracks.length = 0;
    [gold, sick, rot].forEach(c => b.barracks.push(c.serialise()));
    BaseScreen.open();
    BaseScreen._set({ tab: 'CREW' });
    BaseScreen.draw(ctx);
    BaseScreen.update(0.4);      // advance the blink
    BaseScreen.draw(ctx);
  });

  step('BaseScreen MEMORIAL: empty hill, every marker tier, a hovered grave', () => {
    const { Base, BaseScreen, Save, CrewMember, Input } = sb;
    BaseScreen.open();
    BaseScreen._set({ tab: 'MEMORIAL' });
    BaseScreen.draw(ctx);                       // nobody buried yet
    // Bury enough people to fill more than one row on the hill, across
    // the whole range of service records so every marker tier draws.
    for (let i = 0; i < 44; i++) {
      const c = new CrewMember({ name: 'Fallen ' + i });
      c.killedBy = i % 2 ? 'void-spider virus' : 'weapons fire';
      c.battles = i; c.wins = Math.floor(i / 2);
      c.escapes = i % 3; c.kills = Math.floor(i / 3);
      Save.addToGraveyard(c);
    }
    BaseScreen.draw(ctx);
    // …and hover one, which draws the epitaph card.
    const zones = BaseScreen._graves();
    if (zones.length) {
      Input.mouse.x = zones[0].x + zones[0].w / 2;
      Input.mouse.y = zones[0].y + zones[0].h / 2;
      BaseScreen.draw(ctx);
      Input.mouse.x = -100; Input.mouse.y = -100;
    }
  });

  step('BaseScreen ARMOURY tab (mounts + rack, empty and stocked)', () => {
    const { Base, BaseScreen } = sb;
    BaseScreen.open();
    BaseScreen._set({ tab: 'ARMOURY' });
    BaseScreen.draw(ctx);                       // empty rack
    Base.storeWeapon('laser_burst');
    Base.storeWeapon('missile_basic');
    Base.storeWeapon('laser_heavy');
    BaseScreen.draw(ctx);                       // stocked rack
  });

  step('new hulls draw (scout, hauler)', () => {
    ['scout', 'hauler'].forEach(key => {
      const sh = new Ship(key, true, 80, 120);
      sh._allocateDefaultPower();
      sb.makeStartingCrew().forEach(c => sh.addCrew(c));
      sh.assignStations();
      sh.draw(ctx);
      Renderer.drawHUD({ playerShip: sh });
    });
  });

  step('LootScreen: wreck + hold, every hover and drag state', () => {
    const { LootScreen, CargoGrid, CargoItem, Input } = sb;
    const ship = new Ship('hauler', true, 80, 120);
    const wreck = new CargoGrid(5, 4);
    ['data_core', 'module_crate', 'alien_relic', 'unstable_core',
     'contraband', 'he2_drum'].forEach(k => wreck.add(k));
    ship.cargo.add('cooler_crate');
    // Stacks: full, part-full and a single unit, so the quantity badge
    // gets drawn at every width it can be.
    ship.cargo.addStack('missile_rack', 13);
    ship.cargo.addStack('medkit', 7);
    ship.cargo.add('he2_large', null, 38);
    ship.cargo.add('he2_small', null, 1);
    const spoiled = ship.cargo.add('ration_pack');
    if (spoiled) spoiled.damaged = true;

    LootScreen.openLoot(wreck, ship.cargo, {
      seconds: 40, portType: 'science',
      onUnpack: () => ({ ok: true, message: 'ok' }),
    });
    // idle
    Input.mouse.x = 5; Input.mouse.y = 5;
    LootScreen.draw(ctx);
    // hovering an item (detail panel + selection outline)
    const r = LootScreen._gridRect('wreck');
    Input.mouse.x = r.x + 20; Input.mouse.y = r.y + 20;
    LootScreen.update(0.016);
    LootScreen.draw(ctx);
    // carrying an item across both grids (ghost preview, valid + invalid)
    Input.mouse.leftPressed = true; Input.mouse.leftDown = true;
    LootScreen.update(0.016);
    Input.mouse.leftPressed = false;
    LootScreen.draw(ctx);
    const h = LootScreen._gridRect('hold');
    Input.mouse.x = h.x + 30; Input.mouse.y = h.y + 30;
    LootScreen.draw(ctx);
    Input.mouse.leftDown = false;
    LootScreen.update(0.016);
    LootScreen.draw(ctx);
    // low timer (red bar) and the hazard warning line
    LootScreen.update(38);
    LootScreen.draw(ctx);

    // hold-only view
    LootScreen.openHold(ship.cargo, { title: 'CARGO HOLD' });
    LootScreen.draw(ctx);
  });

  step('LootScreen: base store 8x6 (tall grid) packs above the panel', () => {
    const { LootScreen, CargoGrid, Input } = sb;
    const store = new CargoGrid(8, 6);
    ['he2_canister','he2_canister','missile_crate','gun_crate_s','gun_crate','gun_crate_l',
     'module_crate','alien_relic'].forEach(k => store.add(k));
    const ship = new Ship('scout', true, 80, 120);
    LootScreen.openLoot(store, ship.cargo, {
      title: 'PACK THE HOLD', leftLabel: 'BASE STORE', takeAllLabel: 'LOAD ALL' });
    Input.mouse.x = 5; Input.mouse.y = 5;
    LootScreen.draw(ctx);
    const r = LootScreen._gridRect('wreck');
    Input.mouse.x = r.x + 10; Input.mouse.y = r.y + 10;
    LootScreen.update(0.016);
    LootScreen.draw(ctx);
  });

  step('LootScreen: warehouse shelf with the SELL button (onSell opt-in)', () => {
    const { LootScreen, CargoGrid, Input } = sb;
    const shelf = new CargoGrid(5, 4);
    shelf.add('medkit'); shelf.add('alien_relic');
    LootScreen.openHold(shelf, {
      title: 'WAREHOUSE', holdLabel: 'WAREHOUSE SHELF',
      onSell: (it) => it.value('general'),
    });
    Input.mouse.x = 5; Input.mouse.y = 5;
    LootScreen.draw(ctx);                       // no selection: bare "SELL" label
    const r = LootScreen._gridRect('hold');
    Input.mouse.x = r.x + 10; Input.mouse.y = r.y + 10;
    LootScreen.update(0.016);                    // hover selects the item
    LootScreen.draw(ctx);                        // selected: "SELL — N CC"

    const before = shelf.items.length;
    const z = LootScreen._zoneFor('sell');
    if (!z) throw new Error('SELL button missing with a selection and onSell set');
    Input.mouse.x = z.x + 4; Input.mouse.y = z.y + 4;
    Input.mouse.leftPressed = true;
    LootScreen.update(0.016);                    // click SELL
    Input.mouse.leftPressed = false;
    if (shelf.items.length !== before - 1) throw new Error('SELL did not remove the item');
    LootScreen.draw(ctx);

    // A screen that does NOT opt in gets no sell button at all.
    LootScreen.openHold(new CargoGrid(3, 3), { title: 'CARGO HOLD' });
    LootScreen.draw(ctx);
    if (LootScreen._zoneFor('sell')) throw new Error('SELL leaked into a screen without onSell');
  });

  step('map screen draws the cargo button (empty, full, hazardous)', () => {
    const sh = new Ship('scout', true, 80, 120);
    sh._allocateDefaultPower();
    T.playerShip = sh;
    T.STATE = 'map';
    T.sectorMap = new sb.SectorMap(1, 4242);
    Renderer.drawBackground(0);
    T._draw();
    sh.cargo.add('unstable_core');
    sh.cargo.add('medkit');
    T._draw();
  });

  step('DockingGame draws in every phase', () => {
    const { DockingGame, Input } = sb;
    DockingGame.open({ sector: 3, title: 'DOCKING MANOEUVRE' });
    Input.mouse.x = 5; Input.mouse.y = 5;
    DockingGame.draw(ctx);
    DockingGame.update(0.3);
    DockingGame.draw(ctx);
    // hovering each button
    ['auto', 'lock', 'abort'].forEach(a => {
      const z = DockingGame._zoneFor(a);
      if (z) { Input.mouse.x = z.x + 4; Input.mouse.y = z.y + 4; DockingGame.draw(ctx); }
    });
    // each outcome banner
    ['perfect', 'ok', 'bad', 'auto'].forEach(() => {
      DockingGame._set({ pos: 0.5 });
      Input.mouse.x = 5; Input.mouse.y = 5;
      Input.mouse.leftPressed = true;
      DockingGame.update(0.016);
      Input.mouse.leftPressed = false;
      DockingGame.draw(ctx);
      DockingGame.update(1.2);
      DockingGame.open({ sector: 2 });
    });
    DockingGame.update(99);
  });

  step('a derelict and its nest draw', () => {
    const d = sb.makeDerelict(3, 850, 120);
    sb.populateDerelict(d, 3);
    d.update(0.05);
    d.draw(ctx);
    // an infected crewman draws his marker
    const sh = new Ship('scout', true, 80, 120);
    sh._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => sh.addCrew(c));
    sh.crew[0].virus = true;
    sh.crew[0].virusFights = 1;
    sh.draw(ctx);
    sh.crew[0].draw(ctx);
  });

  step('Particles.draw', () => Particles.draw(ctx, 1));

  CombatManager.end();
  T.boardingParty = null;

  console.log(`\n${passed} draw steps ok, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('SMOKE HARNESS CRASH:\n', e && e.stack || e);
  process.exit(1);
});
