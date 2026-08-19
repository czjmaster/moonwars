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
section('11. A recruit can use the elevator like anyone else');
// ============================================================
(function testRecruitElevator() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, UI, Game } = sb;
  Save.load(); Save.startRun();
  const T = Game.__test;

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  ship.assignStations();
  T.playerShip = ship; T.enemyShip = null; T.STATE = 'combat';

  // Nobody may be parked exactly on a room's centre — that is the spot
  // the player clicks to give orders, and a body there ate the click.
  ship.crew.forEach(c => {
    const r = ship.getRoomById(c.roomId);
    if (!r) return;
    ok(Math.hypot(r.cx - c.x, r.cy - (c.y - 14)) >= 13,
      `${c.name} must not stand on the clickable centre of ${r.id}`);
  });

  const rookie = new CrewMember({});          // e.g. a derelict survivor
  ship.addCrew(rookie);
  ok(!!rookie.homeRoomId, 'a recruit should get a station, not a null home');

  const from   = ship.getRoomById(rookie.roomId);
  const target = ship.rooms.find(r => r.floor !== from.floor);
  ok(!!target, 'test setup: need a room on another deck');

  UI.selectCrewGroup([rookie]);
  T._crewClickResolve(target.cx, target.cy, false);
  ok(rookie.homeRoomId === target.id,
    `the order must reach the recruit (home=${rookie.homeRoomId}, wanted ${target.id}) — a crew member standing on the target's centre used to swallow the click`);

  for (let i = 0; i < 3000; i++) ship.update(0.05);
  ok(rookie.roomId === target.id,
    `the recruit must ride the lift to ${target.id}, ended in ${rookie.roomId}`);
})();

// ============================================================
section('12. Power layout survives into the next fight');
// ============================================================
(function testPowerPersists() {
  const sb = loadEngine();
  const { Ship, Save, Game } = sb;
  Save.load(); Save.startRun();
  const T = Game.__test;

  const player = new Ship('frigate', true, 80, 120);
  player._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => player.addCrew(c));
  T.playerShip = player;

  const shields = player.getSystem('shields');
  const med     = player.getSystem('medbay');
  player.setPowerAt(player.systems.indexOf(shields), 0);
  player.setPowerAt(player.systems.indexOf(med), med.maxPower);
  player.update(0.05);
  const before = player.systems.map(s => `${s.type}:${s.power}`).join(' ');

  T._startCombat('normal', false);
  player.update(0.05);
  const after = player.systems.map(s => `${s.type}:${s.power}`).join(' ');
  ok(before === after,
    `the player's power layout must carry into the next fight\n       before: ${before}\n       after : ${after}`);
  ok(player.getSystem('shields').power === 0,
    'a module the player switched OFF must stay off in the new fight');

  // A fresh, never-configured ship still gets the automatic spread
  const fresh = new Ship('frigate', true, 80, 120);
  fresh.systems.forEach(s => { s.power = 0; s.desiredPower = 0; });
  ok(!fresh.hasPowerPreference(), 'a blank ship reports no preference');
  T.playerShip = fresh;
  T._startCombat('normal', false);
  ok(fresh.hasPowerPreference(), 'a ship with no layout yet still gets the default spread');
})();

// ============================================================
section('13. Cloak: total cover, power-gated, collapses when hit');
// ============================================================
(function testCloak() {
  const sb = loadEngine();
  const { Ship, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ok(ship.addModule('cloaking'), 'test setup: fit a cloaking module');
  ship._allocateDefaultPower();
  const cl  = ship.getSystem('cloaking');
  const eng = ship.getSystem('engines');
  ship.setPowerAt(ship.systems.indexOf(eng), 0);        // free a unit
  ship.setPowerAt(ship.systems.indexOf(cl), cl.maxPower);
  ship.update(0.05);
  ok(!cl.isDisabled(), 'powered cloak is ready');
  ok(cl.activateCloak(), 'cloak engages when powered and off cooldown');

  // TOTAL cover while the field is up — not just a high dodge roll
  const shot = { def: { type: 'laser', damage: 2 }, x: 100, y: 100 };
  let landed = 0;
  for (let i = 0; i < 300; i++) if (!ship.receiveHit(shot).dodged) landed++;
  ok(landed === 0, `nothing may land while cloaked, ${landed}/300 got through`);

  // Knocked out mid-cloak → field collapses, full cooldown, frozen
  cl.damageLevel(cl.level);
  ship.update(0.05);
  ok(!cl.cloakActive, 'a wrecked cloak module drops the field');
  ok(cl.cloakCd > 0, 'collapsing puts it on cooldown');
  const frozen = cl.cloakCd;
  for (let i = 0; i < 200; i++) ship.update(0.05);
  ok(cl.cloakCd === frozen,
    `a wrecked module must NOT recharge (${frozen} → ${cl.cloakCd})`);
  ok(!cl.activateCloak(), 'a wrecked cloak cannot be fired');

  // Repaired → recharge resumes
  cl.damagedLevels = 0;
  ship.update(0.05);
  for (let i = 0; i < 100; i++) ship.update(0.05);
  ok(cl.cloakCd < frozen, `repairing resumes the recharge (${frozen} → ${cl.cloakCd})`);

  // Power pulled while recharging → frozen again
  const held = cl.cloakCd;
  ship.setPowerAt(ship.systems.indexOf(cl), 0);
  for (let i = 0; i < 100; i++) ship.update(0.05);
  ok(cl.cloakCd === held, `an unpowered cloak must NOT recharge (${held} → ${cl.cloakCd})`);
  ok(!cl.activateCloak(), 'an unpowered cloak cannot be fired');

  // Shots land normally once the field is down
  ship.setPowerAt(ship.systems.indexOf(cl), cl.maxPower);
  cl.cloakCd = 0; cl.cloakActive = false;
  ship.update(0.05);
  let anyLanded = false;
  for (let i = 0; i < 300; i++) if (!ship.receiveHit(shot).dodged) { anyLanded = true; break; }
  ok(anyLanded, 'with the field down, shots must be able to land again');
})();

// ============================================================
section('14. SOS beacon when the He2 tank runs dry');
// ============================================================
(function testSOS() {
  const sb = loadEngine();
  const { Ship, Save, Game, SectorMap } = sb;

  function stranded() {
    const s = loadEngine();
    s.Save.load(); s.Save.startRun();
    const t = s.Game.__test;
    const p = new s.Ship('frigate', true, 80, 120);
    p._allocateDefaultPower();
    s.makeStartingCrew().forEach(c => p.addCrew(c));
    t.playerShip = p; t.STATE = 'map';
    t.sectorMap = new s.SectorMap(1, 777, s.Save.getRun().lane ?? 1);
    if (t.sectorMap.awaitingStartPick && t.sectorMap.startNodes.length) {
      t._travelTo(t.sectorMap.startNodes[0].id);
    }
    s.Save.updateRun({ fuel: 0 });
    return { s, t, p, next: () => t.sectorMap.nodes.find(n => !n.locked && !n.visited) };
  }

  {
    const { t, next } = stranded();
    t._travelTo(next().id);
    ok(t.STATE === 'event' && t.event && t.event.title === 'Distress Beacon',
      `jumping on an empty tank must raise the distress beacon, got STATE=${t.STATE}`);
    ok(t.event.choices.length >= 3, 'the beacon should offer several ways out');
  }

  // Begging ALWAYS produces fuel — this is the anti-softlock branch
  {
    const { s, t, next } = stranded();
    s.Save.updateRun({ scrap: 0 });
    t._travelTo(next().id);
    const i = t.event.choices.findIndex(c => /beg/i.test(c.label));
    ok(i >= 0, 'a broke captain must still have a beg option');
    t._resolveEvent(i);
    ok(s.Save.getRun().fuel > 0,
      'begging must always yield some He2 — an empty tank can never end the run');
    ok(s.Save.getRun().scrap >= 0, 'CC must never go negative');
    ok(t.STATE === 'map', `back to the map afterwards, got ${t.STATE}`);
  }

  // Buying costs CC and delivers fuel
  {
    const { s, t, next } = stranded();
    s.Save.updateRun({ scrap: 500 });
    t._travelTo(next().id);
    const i = t.event.choices.findIndex(c => /^Buy/i.test(c.label));
    const cc0 = s.Save.getRun().scrap;
    t._resolveEvent(i);
    ok(s.Save.getRun().fuel === 4, `buying delivers 4 He2, got ${s.Save.getRun().fuel}`);
    ok(s.Save.getRun().scrap < cc0, 'buying costs CC');
  }

  // Too poor to buy → the beacon stays up rather than eating the choice
  {
    const { s, t, next } = stranded();
    s.Save.updateRun({ scrap: 0 });
    t._travelTo(next().id);
    const i = t.event.choices.findIndex(c => /^Buy/i.test(c.label));
    t._resolveEvent(i);
    ok(t.STATE === 'event' && t.event.title === 'Distress Beacon',
      'picking an unaffordable trade must re-offer the beacon, not strand the player');
  }

  // Fighting for it pays out on victory
  {
    const { s, t, next } = stranded();
    t._travelTo(next().id);
    const i = t.event.choices.findIndex(c => /force/i.test(c.label));
    t._resolveEvent(i);
    ok(t.STATE === 'combat' && !!t.enemyShip, 'the fight option starts a battle');
    t._onWin();
    ok(s.Save.getRun().fuel >= 4,
      `winning the fuel fight must fill the tank, got ${s.Save.getRun().fuel}`);
  }
})();

// ============================================================
section('15. Home base: launch, dock, and permanent loss');
// ============================================================
(function testBaseLoop() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Game, SHIP_CATALOG } = sb;
  Save.load();
  const T = Game.__test;

  // Fresh base: one free hull, empty barracks, a little supply
  ok(Base.ships().length === 1 && Base.ships()[0].key === 'scout',
    'a new base starts with exactly the free starter hull');
  ok(SHIP_CATALOG.scout.cost === 0, 'the starter hull is free');
  ok(SHIP_CATALOG.frigate.cost > 0, 'the better hull has to be bought');
  ok(Base.warehouseCap() === 20, `warehouse starts at 20 per line, got ${Base.warehouseCap()}`);
  ok(Base.barracksCap() === 5, `barracks start at 5 bunks, got ${Base.barracksCap()}`);
  ok(Base.shipSlots() === 2, `hangar starts with 2 berths, got ${Base.shipSlots()}`);

  Base.earn(1000);
  ok(Base.hireRecruit().ok, 'can hire with CC in the bank');
  Base.hireRecruit();
  const crewBefore = Base.crew().length;

  // Caps are real
  const stored = Base.store('fuel', 999);
  ok(Base.supply().fuel === Base.warehouseCap(),
    `storing past the cap must clamp to it, got ${Base.supply().fuel}`);
  ok(stored < 999, 'store() reports only what actually fit');

  // LAUNCH — ship, crew and supplies LEAVE the base
  BaseScreen.open();
  BaseScreen._set({ mission: 'patrol', fuel: 6, missiles: 3 });
  ok(BaseScreen._act('launch') === 'launch', 'the launch button commits the loadout');
  const loadout = BaseScreen.consumeLaunch();
  ok(!!loadout && loadout.ok, 'launch produced a loadout');
  ok(Base.ships().length === 0, 'the hull is checked OUT of the hangar for the contract');
  ok(Base.crew().length === crewBefore - loadout.crew.length,
    'the crew that flew out are off the barracks roster');
  ok(loadout.fuel === 6 && loadout.missiles === 3, 'the loaded supplies came off the warehouse');

  T._startContract(loadout);
  const run = Save.getRun();
  ok(T.STATE === 'map', `a contract drops you on the sector map, got ${T.STATE}`);
  ok(run.mission === 'patrol' && run.finalSector === 2,
    `Border Patrol is a 2-sector contract, got ${run.mission}/${run.finalSector}`);
  ok(run.fuel === 6 && run.missiles === 3, 'the run starts with exactly what was loaded');
  ok(T.playerShip.layoutKey === 'scout', 'we are flying the hull we picked');
  ok(T.playerShip.crew.length === loadout.crew.length, 'the veterans are aboard');

  // DOCK — everything aboard comes home
  Save.updateRun({ scrap: 200, fuel: 4, missiles: 2 });
  const ccBefore = Base.cc();
  T._finishContract();
  ok(Base.ships().length === 1, 'a completed contract puts the hull back in the hangar');
  ok(Base.ships()[0].data, 'the returned hull keeps its state (upgrades survive)');
  ok(Base.crew().length === crewBefore, 'the survivors are back in the barracks');
  ok(Base.cc() > ccBefore, `CC is banked on completion (${ccBefore} → ${Base.cc()})`);
  ok(T.STATE === 'outcome', 'the run ends on the outcome screen');
})();

// ============================================================
section('16. Losing a contract loses the ship and crew for good');
// ============================================================
(function testBaseLoss() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Game } = sb;
  Save.load();
  const T = Game.__test;

  Base.earn(1000);
  Base.hireRecruit();
  BaseScreen.open();
  BaseScreen._act('launch');
  T._startContract(BaseScreen.consumeLaunch());

  const ccBefore = Base.cc();
  T._onLose();
  ok(Base.ships().length === 0, 'the hull does not come back from a lost contract');
  ok(Base.crew().length === 0, 'neither does the crew');
  ok(Base.cc() === ccBefore, 'and there is no payout');

  // …but the base itself survives, and you can re-equip
  ok(Base.buyShip('scout').ok, 'you can buy a replacement hull');
  ok(Base.ships().length === 1, 'the replacement is in the hangar');
})();

// ============================================================
section('17. Base economy: caps, shop and upgrades');
// ============================================================
(function testBaseEconomy() {
  const sb = loadEngine();
  const { Save, Base } = sb;
  Save.load();

  // Broke: nothing is for sale
  ok(!Base.buySupply('fuel', 1).ok, 'no CC, no fuel');
  ok(!Base.buyUpgrade('warehouse').ok, 'no CC, no upgrades');
  ok(!Base.hireRecruit().ok, 'no CC, no recruits');

  Base.earn(2000);
  const fuel0 = Base.supply().fuel;
  const cc0 = Base.cc();
  ok(Base.buySupply('fuel', 5).ok, 'the base shop sells He2');
  ok(Base.supply().fuel === fuel0 + 5, 'bought He2 lands in the warehouse');
  ok(Base.cc() === cc0 - 5 * Base.unitPrice('fuel'), 'and it costs the listed price');
  ok(Base.buySupply('missiles', 3).ok, 'the base shop sells missiles too');

  // Warehouse cap blocks over-buying, upgrade lifts it
  Base.store('fuel', 999);
  ok(!Base.buySupply('fuel', 1).ok, 'cannot buy past a full warehouse');
  const cap0 = Base.warehouseCap();
  ok(Base.buyUpgrade('warehouse').ok, 'warehouse upgrade purchasable');
  ok(Base.warehouseCap() > cap0, `upgrade raises the cap (${cap0} → ${Base.warehouseCap()})`);
  ok(Base.buySupply('fuel', 1).ok, 'and the shop opens up again');

  // Barracks cap turns crew away — including returning survivors
  const bcap = Base.barracksCap();
  for (let i = 0; i < bcap + 3; i++) Base.addCrew({ id: 'c' + i, name: 'X' + i });
  ok(Base.crew().length === bcap, `barracks hold exactly ${bcap}, got ${Base.crew().length}`);
  const rep = Base.returnFromRun({ crew: [{ id: 'zz', name: 'Overflow' }], fuel: 0, missiles: 0, cc: 0 });
  ok(rep.crewTurnedAway === 1, 'a full barracks turns returning crew away, and says so');

  const bcap0 = Base.barracksCap();
  ok(Base.buyUpgrade('barracks').ok, 'barracks upgrade purchasable');
  ok(Base.barracksCap() > bcap0, 'more bunks after the upgrade');

  // Ship berths
  const slots0 = Base.shipSlots();
  ok(Base.buyUpgrade('slot').ok, 'berth upgrade purchasable');
  ok(Base.shipSlots() === slots0 + 1, 'one more berth');

  // Overflow supply on return is reported, not silently kept
  Base.store('missiles', 999);
  const rep2 = Base.returnFromRun({ fuel: 0, missiles: 5, cc: 0 });
  ok(rep2.mslLost === 5, `missiles that do not fit are lost and reported, got ${rep2.mslLost}`);
})();

// ============================================================
section('18. Contracts: length, boss and no elite nodes');
// ============================================================
(function testMissions() {
  const sb = loadEngine();
  const { Save, SectorMap, BossManager, MISSIONS } = sb;
  Save.load(); Save.startRun();

  ok(MISSIONS.patrol.sectors === 2, 'Border Patrol is 2 sectors');
  ok(MISSIONS.mothership.sectors === 3, 'Mothership Assault is 3 sectors');

  // The boss sits at the END of the contract, wherever that is
  [[MISSIONS.patrol, 2], [MISSIONS.mothership, 3]].forEach(([m, final]) => {
    for (let sec = 1; sec <= final; sec++) {
      const map = new SectorMap(sec, 4242, 1, final);
      const bosses = map.nodes.filter(n => n.type === 'boss').length;
      const exits  = map.nodes.filter(n => n.type === 'exit').length;
      if (sec === final) {
        ok(bosses === 1, `${m.id}: sector ${sec} (last) must hold the boss, got ${bosses}`);
        ok(exits === 0, `${m.id}: the last sector has no exit, got ${exits}`);
      } else {
        ok(bosses === 0, `${m.id}: sector ${sec} must NOT hold a boss`);
        ok(exits > 0, `${m.id}: mid-contract sectors need exits`);
      }
      ok(map.nodes.every(n => n.type !== 'elite'),
        `${m.id}: no elite nodes anywhere (sector ${sec}) — the boss is the only elite fight`);
    }
  });

  // Each contract builds a different final boss
  BossManager.reset('elite');
  const elite = BossManager.start(0, 850, 120, 'elite');
  ok(elite.layoutKey === 'enemy_gunship', `patrol boss is a gunship, got ${elite.layoutKey}`);
  const eliteHull = elite.hullMax;

  BossManager.reset('station');
  const station = BossManager.start(0, 850, 120, 'station');
  ok(station.layoutKey === 'boss_station', `mothership boss is the station, got ${station.layoutKey}`);
  ok(station.hullMax > eliteHull,
    `the long contract's boss must be the tougher one (${eliteHull} vs ${station.hullMax})`);
})();

// ============================================================
section('19. Engine boots and runs a frame');
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
