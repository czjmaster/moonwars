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
section('6. Terra cyborg powers a module on his own');
// ============================================================
(function testCyborgAutoPower() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const med     = ship.getSystem('medbay');
  const medRoom = ship.getRoomById(med.roomId);
  ship.setPowerAt(ship.systems.indexOf(med), 0);
  ship.update(0.05);
  ok(med.isDisabled(), 'an unpowered medbay with nobody in it is disabled');

  // A Terra walks in. His +1 alone should light the module up.
  const terra = new CrewMember({ race: 'terra' });
  ship.addCrew(terra);
  terra.x = medRoom.cx; terra.y = medRoom.cy;
  terra.roomId = medRoom.id; terra.homeRoomId = medRoom.id;
  ship.update(0.05);

  ok(med.hasCyborg, 'the medbay should see the cyborg standing in it');
  ok(med.effectivePower() === 1, `cyborg alone gives 1 effective power, got ${med.effectivePower()}`);
  ok(!med.isDisabled(),
    'a module a cyborg stands in must WORK even at 0 allocated power — isDisabled() used to look at raw power and keep it dark');

  // …and it must actually heal, which is what the player sees
  const patient = new CrewMember({});
  patient.x = medRoom.cx; patient.y = medRoom.cy; patient.roomId = medRoom.id;
  patient.state = 'injured'; patient.hp = 8;
  ship.addCrew(patient, true);
  const hp0 = patient.hp;
  for (let i = 0; i < 40; i++) ship.update(0.05);
  ok(patient.hp > hp0, `cyborg-powered medbay must actually treat the wounded (${hp0} → ${patient.hp.toFixed(1)})`);

  // When he leaves, the module goes dark again
  const far = ship.rooms.find(r => r.id !== medRoom.id);
  terra.x = far.cx; terra.y = far.cy; terra.roomId = far.id; terra.homeRoomId = far.id;
  ship.update(0.05);
  ok(med.isDisabled(), 'the bonus travels WITH the cyborg — module goes dark when he walks out');

  // The reactor must never promise more power than it can deliver
  const drawn = ship.systems.reduce((a, s) => a + s.reactorDraw(), 0);
  ok(drawn <= ship.reactor.totalPower,
    `total reactor draw (${drawn}) must never exceed capacity (${ship.reactor.totalPower})`);
})();

// ============================================================
section('7. Crew repair breaches AND wrecked modules');
// ============================================================
(function testRepairs() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, UI, Game, TASK } = sb;
  Save.load(); Save.startRun();
  const T = Game.__test;

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  ship.assignStations();
  T.playerShip = ship; T.enemyShip = null; T.STATE = 'combat';

  const shields = ship.getSystem('shields');
  const sRoom   = ship.getRoomById(shields.roomId);
  shields.damageLevel(shields.level);
  ship.breaches.open(sRoom.id, sRoom.cx + 8, sRoom.cy);
  ok(shields.damagedLevels > 0 && ship.breaches.hasBreachInRoom(sRoom.id),
    'scenario: shields shot out AND a hull breach in the same room');

  // Three WOUNDED lying in that room. They must not make it "full".
  for (let i = 0; i < 3; i++) {
    const w = new CrewMember({});
    w.x = sRoom.cx; w.y = sRoom.cy; w.roomId = sRoom.id;
    w.state = 'injured'; w.hp = 10;
    ship.addCrew(w, true);
  }

  const medic = ship.crew.find(c => c.alive);
  ship.crew.filter(c => c.alive).forEach((c, i) => {
    const r = ship.rooms[0];
    c.x = r.cx + i * 5; c.y = r.cy; c.roomId = r.id; c.homeRoomId = r.id;
  });

  UI.selectCrewGroup([medic]);
  T._crewClickResolve(sRoom.cx, sRoom.cy, false);
  ok(medic.homeRoomId === sRoom.id,
    `the order must reach the wrecked room — 3 downed bodies used to read as "module full" (home=${medic.homeRoomId})`);
  ok(medic.task === TASK.BREACH || medic.task === TASK.REPAIR,
    `sending crew into a holed/wrecked room is an explicit repair order, got task=${medic.task}`);

  for (let i = 0; i < 1500; i++) ship.update(0.05);
  ok(!ship.breaches.hasBreachInRoom(sRoom.id), 'the hull breach must get sealed');
  ok(shields.damagedLevels === 0,
    `the shields module must get repaired too, still damaged: ${shields.damagedLevels} (repair crew used to wander off carrying a body)`);
})();

// ============================================================
section('8. Downed crew get rescued, even with no medbay');
// ============================================================
(function testRescue() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save } = sb;
  Save.load(); Save.startRun();

  // The exact reported case: enemy gunner down in the weapons module,
  // the only other crew member sitting in the cockpit.
  const enemy = new Ship('enemy_frigate', false, 850, 120);
  enemy._allocateDefaultPower();
  ok(!enemy.getSystem('medbay'), 'enemy frigates carry no medbay — that is why nobody came');

  const wRoom = enemy.weaponRooms[0] || enemy.rooms.find(r => r.type === 'weapons');
  const pRoom = enemy.rooms.find(r => r.type === 'piloting') || enemy.rooms[0];

  const gunner = new CrewMember({ isPlayer: false });
  gunner.x = wRoom.cx; gunner.y = wRoom.cy;
  gunner.roomId = wRoom.id; gunner.homeRoomId = wRoom.id;
  gunner.state = 'injured'; gunner.hp = 12;
  enemy.addCrew(gunner, true);

  const pilot = new CrewMember({ isPlayer: false });
  pilot.x = pRoom.cx; pilot.y = pRoom.cy;
  pilot.roomId = pRoom.id; pilot.homeRoomId = pRoom.id;
  enemy.addCrew(pilot, true);

  ok(gunner.down, 'gunner starts down');
  for (let i = 0; i < 1500; i++) enemy.update(0.05);

  ok(pilot.roomId === wRoom.id,
    `the able crew member must go TO the casualty (pilot ended in ${pilot.roomId}, gunner is in ${wRoom.id})`);
  ok(!gunner.down && gunner.state === 'ok',
    `field aid must bring him back up on a ship with no medbay (state=${gunner.state}, hp=${gunner.hp.toFixed(0)})`);

  // A player ship WITH a powered medbay should still carry them there
  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const med = ship.getSystem('medbay');
  ship.setPowerAt(ship.systems.indexOf(med), med.maxPower);
  const medRoom = ship.getRoomById(med.roomId);
  const helper = new CrewMember({});
  const far = ship.rooms.find(r => r.id !== medRoom.id);
  helper.x = far.cx; helper.y = far.cy; helper.roomId = far.id; helper.homeRoomId = far.id;
  ship.addCrew(helper, true);
  const hurt = new CrewMember({});
  const other = ship.rooms.find(r => r.id !== medRoom.id && r.id !== far.id) || far;
  hurt.x = other.cx; hurt.y = other.cy; hurt.roomId = other.id;
  hurt.state = 'injured'; hurt.hp = 9;
  ship.addCrew(hurt, true);
  for (let i = 0; i < 2000; i++) ship.update(0.05);
  ok(!hurt.down, `a casualty in a far room must end up treated (state=${hurt.state}, room=${hurt.roomId})`);
})();

// ============================================================
section('9. Jumps burn He2');
// ============================================================
(function testFuel() {
  const sb = loadEngine();
  const { Ship, Save, Game, SectorMap } = sb;
  Save.load(); Save.startRun();
  const T = Game.__test;

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;
  T.STATE = 'map';

  const run = Save.getRun();
  T.sectorMap = new SectorMap(1, 4242, run.lane ?? 1);
  const map = T.sectorMap;

  // Sector 1 opens with a free lane pick — that is not a jump
  const fuelStart = Save.getRun().fuel;
  if (map.awaitingStartPick && map.startNodes.length) {
    T._travelTo(map.startNodes[0].id);
    ok(Save.getRun().fuel === fuelStart, 'choosing the starting lane must stay free');
  }

  // …the next hop is a real jump
  const before = Save.getRun().fuel;
  const next = map.nodes.find(n => !n.locked && !n.visited);
  if (next) {
    T._travelTo(next.id);
    const after = Save.getRun().fuel;
    ok(after === before - 1 || after === before,
      `a map jump costs 1 He2 (${before} → ${after})`);
    ok(after < before, `He2 must actually be spent on a jump (${before} → ${after}) — travel used to be free`);
  } else {
    ok(false, 'test setup: no reachable node to jump to');
  }

  // With an empty tank the jump is refused rather than going negative
  Save.updateRun({ fuel: 0 });
  T.STATE = 'map';
  const stuck = map.nodes.find(n => !n.locked && !n.visited);
  if (stuck) {
    T._travelTo(stuck.id);
    ok(Save.getRun().fuel === 0, 'He2 must never go negative');
  }
})();

// ============================================================
section('10. Every door on a floor lines up');
// ============================================================
(function testDoorAlignment() {
  const sb = loadEngine();
  const { Ship, SHIP_LAYOUTS } = sb;

  Object.keys(SHIP_LAYOUTS).forEach(key => {
    const ship = new Ship(key, key === 'frigate', 0, 0);
    const byFloor = new Map();
    ship.doors.forEach(d => {
      const f = ship.floorAtY(d.y);
      if (!byFloor.has(f)) byFloor.set(f, []);
      byFloor.get(f).push(d);
    });
    byFloor.forEach((doors, f) => {
      const ys = [...new Set(doors.map(d => Math.round(d.y)))];
      ok(ys.length === 1,
        `${key} floor ${f}: interior and airlock hatches must share one line, got ${JSON.stringify(ys)}`);
    });
    // Airlocks specifically — the ones the player sees on the hull edge
    const air = ship.doors.filter(d => d.isAirlock);
    air.forEach(a => {
      const mates = ship.doors.filter(d => !d.isAirlock &&
        ship.floorAtY(d.y) === ship.floorAtY(a.y));
      mates.forEach(m => ok(Math.round(m.y) === Math.round(a.y),
        `${key}: airlock at y=${Math.round(a.y)} must match interior door y=${Math.round(m.y)}`));
    });
  });
})();

// ============================================================
section('11. Engine boots and runs a frame');
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
