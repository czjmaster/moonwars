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

  step('Particles.draw', () => Particles.draw(ctx, 1));

  CombatManager.end();
  T.boardingParty = null;

  console.log(`\n${passed} draw steps ok, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('SMOKE HARNESS CRASH:\n', e && e.stack || e);
  process.exit(1);
});
