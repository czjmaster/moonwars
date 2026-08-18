'use strict';
/* Logic regression suite for MOON WARS.
 * Covers the update17 bug fixes end-to-end (boarding placement, recall,
 * derelict choice, Terra cyborg power accounting). */
const { loadEngine } = require('./harness.js');

let failures = 0, passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failures++; console.error('FAIL: ' + msg); }
}
function section(name) { console.log('\n— ' + name + ' —'); }

/** Build a live combat: player + enemy ship, crewed, CombatManager active. */
function makeCombat(sb, { enemyArmed = false } = {}) {
  const { Game, Ship, CombatManager, Save } = sb;
  const T = Game.__test;

  Save.load();
  Save.startRun();

  const player = new Ship('frigate', true, 80, 120);
  const enemy  = new Ship('enemy_frigate', false, 850, 120);
  [player, enemy].forEach(sh => { sh._allocateDefaultPower(); sh.prechargeShields(); });
  sb.makeStartingCrew().forEach(c => player.addCrew(c));
  sb.makeEnemyCrew(3).forEach(c => enemy.addCrew(c));
  player.assignStations();
  enemy.assignStations();

  // Keep the test deterministic: an unarmed enemy can't kill the player
  // mid-simulation and flip the state machine to 'outcome'.
  if (!enemyArmed) { enemy.weapons = []; player.weapons = []; }

  T.playerShip = player;
  T.enemyShip  = enemy;
  T.STATE = 'combat';
  T.boardingParty = null;
  T.enemyParty = null;
  T.derelictOffered = false;

  CombatManager.begin(player, enemy, 'normal');
  // begin() starts in 'entering' — advance to 'active' (HANDOFF §4)
  for (let i = 0; i < 60 && !CombatManager.isActive(); i++) CombatManager.update(0.05);

  return { T, player, enemy };
}

/** Teleport a party's members onto their exit airlock so the 'muster'
 *  walk completes immediately (no pathfinding in a headless test). */
function forceMuster(party) {
  party.members.forEach(m => {
    m.c.x = m.x = party.exitDoor.x;
    m.c.y = m.y = party.exitDoor.y;
  });
}

// ============================================================
section('1. Terra cyborg reactor accounting (systems.js)');
// ============================================================
(function testCyborgReactor() {
  const sb = loadEngine();
  const { Reactor, ShipSystem } = sb;

  const cyborgCrew = { alive: true, dead: false, dying: false, cyborg: true };

  const reactor = new Reactor(8, 16);

  const partialCyborgSys = new ShipSystem('engines', 3);
  partialCyborgSys.power = 1;              // NOT fully powered (workingLevels=3)
  partialCyborgSys.crew  = [cyborgCrew];

  const plainSys = new ShipSystem('shields', 2);
  plainSys.power = 2;                      // fully powered, no cyborg

  const fullCyborgSys = new ShipSystem('weapons', 3);
  fullCyborgSys.power = 3;                 // fully powered WITH cyborg
  fullCyborgSys.crew  = [cyborgCrew];

  const systems = [partialCyborgSys, plainSys, fullCyborgSys];

  // Raw allocated: 1 + 2 + 3 = 6 of 8 → 2 genuinely free. Only the FULL
  // cyborg module substitutes a real reactor unit → 3 free. The partial
  // one must NOT (its cyborg +1 is extra output, not a substitution) —
  // that was the phantom pip the player could see but never spend.
  const free = reactor.distribute(systems);
  ok(free === 3, `distribute() should report 3 free power, got ${free}`);
  ok(free !== 4, 'partially-powered cyborg module must not create a phantom free unit (the reported bug)');

  ok(partialCyborgSys.effectivePower() === 2,
    `partial cyborg module effectivePower should be 2 (1 allocated + 1 cyborg), got ${partialCyborgSys.effectivePower()}`);
  ok(fullCyborgSys.effectivePower() === 3,
    `full cyborg module effectivePower stays capped at 3, got ${fullCyborgSys.effectivePower()}`);

  // Every pip the bar shows must actually be spendable.
  const freshSys = new ShipSystem('oxygen', 2);
  freshSys.power = 0;
  const testSystems = [partialCyborgSys, plainSys, fullCyborgSys, freshSys];
  reactor.setPower(freshSys, 2, testSystems);
  ok(freshSys.power === 2, `setPower should grant the 2 genuinely free units, got ${freshSys.power}`);

  const freeAfter = reactor.distribute(testSystems);
  ok(freeAfter === 1, `only the 1 genuine cyborg reclaim should remain free, got ${freeAfter}`);

  // And the last pip must be spendable too — not a stuck phantom.
  const lastSys = new ShipSystem('medbay', 2);
  lastSys.power = 0;
  const all = [...testSystems, lastSys];
  reactor.setPower(lastSys, 1, all);
  ok(lastSys.power === 1, `the final free pip must be spendable, got ${lastSys.power}`);
  ok(reactor.distribute(all) === 0, `bank should read empty after spending everything, got ${reactor.distribute(all)}`);
})();

// ============================================================
section('2. Boarders land in the room they breached');
// ============================================================
(function testBoardersLandInBreachedRoom() {
  const sb = loadEngine();
  const { CrewMember } = sb;
  const { T, player, enemy } = makeCombat(sb);

  const boarder = new CrewMember({ race: 'pegasus' });   // pegasus = no suffocation
  player.addCrew(boarder);

  const party = T._makeParty(player, enemy, [boarder]);
  ok(!!party, '_makeParty should find an airlock route to the enemy');
  T.boardingParty = party;
  forceMuster(party);

  const entryRoomId = party.entryRoom.id;
  for (let i = 0; i < 1000 && T.boardingParty; i++) {
    if (T._updateParty(party, 0.05)) T.boardingParty = null;
  }

  ok(enemy.crew.includes(boarder), 'boarder should end up on the enemy roster');
  ok(!player.crew.includes(boarder), 'boarder should be off our roster while aboard the enemy');
  ok(boarder.roomId === entryRoomId,
    `boarder must stand in the BREACHED room (${entryRoomId}), got ${boarder.roomId} — this was the "scattered randomly" bug`);
  ok(boarder.homeRoomId === entryRoomId,
    `boarder's home should be the breached room, got ${boarder.homeRoomId}`);

  // And physically inside that room's bounds, not teleported elsewhere
  const room = enemy.getRoomById(entryRoomId);
  const inside = boarder.x >= room.x - 20 && boarder.x <= room.x + room.w + 20 &&
                 boarder.y >= room.y - 20 && boarder.y <= room.y + room.h + 20;
  ok(inside, `boarder position (${Math.round(boarder.x)},${Math.round(boarder.y)}) should be inside the breached room bounds`);

  ok(party.entryDoor.breached === true, 'the enemy airlock stays permanently breached after a real boarding');
})();

// ============================================================
section('3. RECALL brings boarders home without re-breaching');
// ============================================================
(function testRecall() {
  const sb = loadEngine();
  const { CrewMember, UI } = sb;
  const { T, player, enemy } = makeCombat(sb);

  // Put a boarder onto the enemy hull, exactly as a completed boarding does
  const boarder = new CrewMember({ race: 'pegasus' });
  const eRoom = enemy.rooms[enemy.rooms.length - 1];
  boarder.x = eRoom.cx; boarder.y = eRoom.cy;
  boarder.roomId = eRoom.id; boarder.homeRoomId = eRoom.id;
  enemy.addCrew(boarder, true);

  const ourAirlock = player.doors.filter(d => d.isAirlock)
    .sort((a, b) => b.x - a.x)[0];
  ok(!!ourAirlock, 'player ship should have an airlock');
  const wasBreached = !!ourAirlock.breached;

  UI.selectCrewGroup([boarder]);
  T._recallBoarders();
  ok(!!T.boardingParty, '_recallBoarders should launch a return party');
  ok(T.boardingParty.recall === true, 'the return party must be flagged as a recall');
  ok(T.boardingParty.breachNeed < 4.0,
    'coming home through our OWN airlock should be quicker than smashing an enemy hatch');

  forceMuster(T.boardingParty);

  // Drive the REAL combat loop so the recall reseal path is exercised
  for (let i = 0; i < 2000 && T.boardingParty; i++) T._updateCombat(0.05);

  ok(!T.boardingParty, 'recall party should complete');
  ok(player.crew.includes(boarder), 'recalled boarder must be back on our roster');
  ok(!enemy.crew.includes(boarder), 'recalled boarder must be off the enemy roster');
  ok(!!boarder.roomId && player.getRoomById(boarder.roomId),
    'recalled boarder should stand in one of OUR rooms');
  ok(!!ourAirlock.breached === wasBreached,
    'our own airlock must NOT be permanently breached by our own crew coming home');
  ok(ourAirlock.open === false, 'our airlock reseals behind the returning party (no venting)');
})();

// ============================================================
section('4. Clicking our own room does not mis-order boarders');
// ============================================================
(function testClickDoesNotStrandBoarders() {
  const sb = loadEngine();
  const { CrewMember, UI } = sb;
  const { T, player, enemy } = makeCombat(sb);

  const boarder = new CrewMember({ race: 'pegasus' });
  const eRoom = enemy.rooms[enemy.rooms.length - 1];
  boarder.x = eRoom.cx; boarder.y = eRoom.cy;
  boarder.roomId = eRoom.id; boarder.homeRoomId = eRoom.id;
  enemy.addCrew(boarder, true);

  // Move our own crew out of the way so the click resolves to a ROOM,
  // not to a crew sprite under the cursor.
  player.crew.forEach(c => { c.x = -9999; c.y = -9999; });

  UI.selectCrewGroup([boarder]);
  const ourRoom = player.rooms[0];
  T._crewClickResolve(ourRoom.cx, ourRoom.cy, false);

  ok(enemy.crew.includes(boarder),
    'clicking OUR room must not silently pull an enemy-side boarder off the enemy roster');
  ok(boarder.homeRoomId === eRoom.id,
    `boarder's home must stay on the enemy ship (${eRoom.id}), got ${boarder.homeRoomId} — the old bug retargeted them, which made them fly home and re-smash the already-broken door`);
  ok(!T.boardingParty, 'a stray room click must not launch a boarding/return flight by itself');

  // Crew actually aboard our ship still take room orders normally
  const homeCrew = player.crew.find(c => !c.dead);
  UI.selectCrewGroup([homeCrew]);
  const target = player.rooms[1] || player.rooms[0];
  T._crewClickResolve(target.cx, target.cy, false);
  ok(homeCrew.homeRoomId === target.id,
    'ordinary crew aboard our ship must still respond to room clicks');
})();

// ============================================================
section('5. Derelict hulk: search vs destroy');
// ============================================================
(function testDerelictChoice() {
  const sb = loadEngine();
  const { Save } = sb;
  const { T, enemy } = makeCombat(sb);

  // Wipe the enemy crew but leave the hull intact
  enemy.crew.forEach(c => { c.dead = true; c.dying = false; });
  ok(enemy.hull > 0, 'enemy hull should still be standing for this scenario');

  T._updateCombat(0.05);

  ok(T.STATE === 'event', `a crewless-but-intact enemy should raise a choice event, STATE=${T.STATE}`);
  ok(T.event && T.event.title === 'Derelict Hulk', 'the event should be the derelict choice');
  ok(T.event.choices.length === 2, 'derelict choice should offer search AND destroy');

  // — Destroy branch: guaranteed scrap, wreck finished off —
  const scrapBefore = sb.CombatManager.scrapReward;
  T._resolveEvent(1);
  ok(T.STATE === 'combat', `destroy should return to combat for the kill, STATE=${T.STATE}`);
  ok(sb.CombatManager.scrapReward > scrapBefore,
    `destroying the hulk should add bonus scrap (${scrapBefore} → ${sb.CombatManager.scrapReward})`);
  ok(enemy.destroyed === true && enemy.hull <= 0, 'the wreck should be finished off');

  // — Search branch on a fresh fight —
  const sb2 = loadEngine();
  const c2 = makeCombat(sb2);
  c2.enemy.crew.forEach(c => { c.dead = true; c.dying = false; });
  c2.T._updateCombat(0.05);
  ok(c2.T.STATE === 'event', 'second run should also raise the derelict event');

  const runBefore = sb2.Save.getRun();
  const scrapPre = runBefore.scrap;
  const crewPre  = c2.player.crew.length;
  const cargoPre = c2.player.weaponCargo.length;

  c2.T._resolveEvent(0);   // search the wreck
  ok(c2.T.STATE === 'combat', `search should return to combat, STATE=${c2.T.STATE}`);
  ok(c2.enemy.destroyed === true, 'the searched wreck is consumed afterwards');

  const runAfter = sb2.Save.getRun();
  const gotSomething =
    runAfter.scrap !== scrapPre ||
    c2.player.crew.length !== crewPre ||
    c2.player.weaponCargo.length !== cargoPre ||
    c2.player.crew.some(c => c.hp < c.maxHp);
  ok(gotSomething, 'searching a wreck must produce SOME outcome (loot, survivor, or a booby trap)');

  // The offer is one-shot per fight
  ok(c2.T.derelictOffered === true, 'derelict offer should not repeat within the same fight');
  c2.T._updateCombat(0.05);
  ok(c2.T.STATE === 'combat', 'the derelict event must not re-open every frame');
})();

// ============================================================
section('6. Engine boots and runs a frame');
// ============================================================
(async function testEngineBoots() {
  const sb = loadEngine();
  try {
    await sb.Game.init();
    await new Promise((resolve) => setTimeout(resolve, 60));
    ok(true, 'engine ran init + at least one update/draw tick without throwing');
  } catch (e) {
    ok(false, 'Game.init()/loop threw: ' + (e && e.stack || e));
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
});
