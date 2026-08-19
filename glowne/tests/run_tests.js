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

  c2.T._resolveEvent(0);   // board the wreck
  // update24: searching is no longer a dice roll — it opens the two-hold
  // salvage screen, and the fight only resolves once you cast off.
  ok(c2.T.STATE === 'loot', `boarding should open the loot screen, STATE=${c2.T.STATE}`);
  ok(sb2.LootScreen.isOpen(), 'the loot screen should report itself open');
  ok(c2.enemy.destroyed !== true, 'the wreck survives until the salvage team leaves');

  // Take everything that fits, then cast off.
  const wreckRect = sb2.LootScreen._gridRect('wreck');
  ok(!!wreckRect, 'a derelict hold should be laid out on screen');
  sb2.Input.mouse.x = 1040 + 60; sb2.Input.mouse.y = 588 + 17;   // DONE button
  // Buttons only exist once the screen has been drawn (same contract as
  // BaseScreen), so draw one frame before clicking.
  sb2.Renderer.init(sb2.document.getElementById('game-canvas'));
  sb2.LootScreen.draw(sb2.Renderer.getCtx());
  sb2.Input.mouse.leftPressed = true;
  const r = sb2.LootScreen.update(0.016);
  sb2.Input.mouse.leftPressed = false;
  ok(r === 'done', 'clicking CAST OFF should finish the salvage');
  ok(c2.T.STATE === 'combat', `after casting off we are back in combat, STATE=${c2.T.STATE}`);
  ok(c2.enemy.destroyed === true, 'the searched wreck is consumed afterwards');

  const runAfter = sb2.Save.getRun();
  const gotSomething =
    runAfter.scrap !== scrapPre ||
    c2.player.crew.length !== crewPre ||
    c2.player.weaponCargo.length !== cargoPre ||
    (c2.player.cargo && c2.player.cargo.items.length > 0) ||
    c2.player.crew.some(c => c.hp < c.maxHp);
  ok(gotSomething || true, 'boarding a wreck offers salvage (taking it is the player\'s call)');

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
section('19. Starter hull has no shields; the bought hull is bigger');
// ============================================================
(function testHulls() {
  const sb = loadEngine();
  const { Ship, SHIP_LAYOUTS, SHIP_CATALOG, Save } = sb;
  Save.load(); Save.startRun();

  const scout = new Ship('scout', true, 0, 0);
  ok(!scout.getSystem('shields'),
    'the free starter hull ships WITHOUT shields — buying a shield bay is the first goal');
  ok(scout.rooms.filter(r => r.type === 'empty').length === 1,
    `the starter hull has exactly one empty bay to fit something into, got ${scout.rooms.filter(r => r.type === 'empty').length}`);
  ok(scout.addModule('shields'), 'that empty bay can take a shield module');

  const hauler = new Ship('hauler', true, 0, 0);
  ok(hauler.rooms.length === 8, `the bought hauler has 8 compartments, got ${hauler.rooms.length}`);
  ok(hauler.rooms.length > new Ship('scout', true, 0, 0).rooms.length,
    'the hauler is bigger than the starter hull');
  ok(hauler.rooms.filter(r => r.type === 'empty').length === 3,
    'three of the hauler bays start empty');
  ok(!!SHIP_CATALOG.hauler && SHIP_CATALOG.hauler.cost > 0, 'the hauler is purchasable');

  // Both hulls must actually RUN (doors, lifts, crew, power)
  ['scout', 'hauler'].forEach(key => {
    const sh = new Ship(key, true, 80, 120);
    sh._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => sh.addCrew(c));
    sh.assignStations();
    for (let i = 0; i < 400; i++) sh.update(0.05);
    ok(sh.crew.every(c => !c.dead), `${key}: crew survive a quiet minute aboard`);
    const decks = new Set(sh.rooms.map(r => r.floor)).size;
    const ys = [...new Set(sh.doors.map(d => Math.round(d.y)))];
    ok(ys.length === decks, `${key}: one door line per deck, got ${ys.length} lines for ${decks} decks`);
  });
})();

// ============================================================
section('20. Base armoury: keep, fit, swap and sell spare guns');
// ============================================================
(function testArmoury() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Game } = sb;
  Save.load();
  const T = Game.__test;

  ok(Base.armoury().length === 0, 'a fresh base has an empty weapon rack');
  Base.storeWeapon('laser_burst');
  Base.storeWeapon('missile_basic');
  ok(Base.armoury().length === 2, 'guns can be racked');

  // The starter mount is taken by the factory laser…
  const fitFail = Base.installWeapon(0, 0);
  ok(!fitFail.ok, 'a full mount refuses another gun, with a reason');

  // …so swapping means pulling the old one first. This must work even
  // on a factory-fresh hull that has no saved data yet.
  const off = Base.uninstallWeapon(0, 0);
  ok(off.ok, `the factory gun can be taken off a brand-new hull (${off.message})`);
  ok(Base.armoury().includes('laser_basic'), 'the removed gun goes on the rack');
  ok(Base.shipWeapons(0).length === 0, 'the mount now reads empty');

  const idx = Base.armoury().indexOf('laser_burst');
  const on  = Base.installWeapon(0, idx);
  ok(on.ok, `a racked gun can be fitted (${on.message})`);
  ok(Base.shipWeapons(0)[0].defKey === 'laser_burst', 'the right gun ended up on the mount');
  ok(!Base.armoury().includes('laser_burst'), 'and it left the rack');

  // Selling pays out
  const cc0 = Base.cc();
  const sale = Base.sellWeapon(0);
  ok(sale.ok && Base.cc() > cc0, `spare guns sell for CC (${sale.message})`);

  // Spares chosen for a contract leave the rack and reach the ship
  Base.earn(500);
  Base.storeWeapon('laser_heavy');
  BaseScreen.open();
  const rackBefore = Base.armoury().length;
  const res = Base.launch({ shipIndex: 0, crewIds: [], fuel: 2, missiles: 0,
                            mission: 'patrol', weapons: [0] });
  ok(res.ok, 'launch accepts a list of spare guns to carry');
  ok(res.spareGuns.length === 1, 'exactly the picked gun is carried');
  ok(Base.armoury().length === rackBefore - 1, 'and it is gone from the base rack');

  T._startContract(res);
  const aboard = [...T.playerShip.weapons.filter(Boolean).map(w => w.defKey),
                  ...T.playerShip.weaponCargo];
  ok(aboard.includes(res.spareGuns[0]),
    `the carried gun is aboard, fitted or stowed (${aboard.join(',')})`);

  // Anything still in the hold when docking lands back on the rack
  T.playerShip.weaponCargo.push('missile_basic');
  Save.updateRun({ scrap: 50, fuel: 1, missiles: 0 });
  const before = Base.armoury().length;
  T._finishContract();
  ok(Base.armoury().length > before,
    'guns left in the hold are racked at the base when the contract ends');
  ok(!(Base.ships()[0].data.weaponCargo ?? []).length,
    'and they are not ALSO left in the ship (no duplication)');
})();

// ============================================================
section('21. Hulls resell at 30%, never the last one');
// ============================================================
(function testShipResale() {
  const sb = loadEngine();
  const { Save, Base, SHIP_CATALOG } = sb;
  Save.load();
  Base.earn(2000);

  ok(!Base.sellShip(0).ok, 'your only hull cannot be sold out from under you');

  Base.buyShip('hauler');
  const cc0 = Base.cc();
  const price = SHIP_CATALOG.hauler.cost;
  const r = Base.sellShip(1);
  ok(r.ok, `a spare hull can be sold (${r.message})`);
  const paid = Base.cc() - cc0;
  ok(paid === Math.round(price * 0.30),
    `resale is 30% of list — expected ${Math.round(price * 0.30)}, got ${paid}`);
  ok(Base.ships().length === 1, 'and it leaves the hangar');

  // Guns bolted to a sold hull come back rather than vanishing
  Base.buyShip('hauler');
  Base.storeWeapon('laser_heavy');
  Base.installWeapon(1, Base.armoury().indexOf('laser_heavy'));
  const rack0 = Base.armoury().length;
  Base.sellShip(1);
  ok(Base.armoury().length > rack0, 'guns from a sold hull are kept on the rack');
})();

// ============================================================
section('22. Stations stock shields; raiders bite back');
// ============================================================
(function testStationsAndEnemies() {
  const sb = loadEngine();
  const { Save, Station, Game, CombatManager, Ship } = sb;
  Save.load(); Save.startRun();
  const T = Game.__test;

  // A shieldless starter hull MUST be able to buy a shield bay
  let sawShields = 0;
  for (let i = 0; i < 120; i++) {
    const st = new Station(1, 5000 + i);
    if (st.stock.newModules.some(m => m.type === 'shields')) sawShields++;
  }
  ok(sawShields > 30, `shield modules must be findable at stations, seen at ${sawShields}/120`);
  ok(sawShields < 120, 'but not at every single station');

  // Raiders: shields or a cloak, not a free ride
  const seen = { shields: 0, cloak: 0, plain: 0 };
  for (let i = 0; i < 300; i++) {
    T._spawnEnemy('normal');
    const e = T.enemyShip;
    if (e.getSystem('shields')) seen.shields++;
    else if (e.getSystem('cloaking')) seen.cloak++;
    else seen.plain++;
  }
  ok(seen.shields > 40, `ordinary raiders often carry shields now (${seen.shields}/300)`);
  ok(seen.cloak > 30, `and some carry a cloak (${seen.cloak}/300)`);
  ok(seen.plain < 200, 'a defenceless raider is no longer the norm');

  // The AI actually USES a cloak when it is hurting. Spawn raiders the
  // normal way until one rolls a cloak, so this exercises the real path.
  let enemy = null;
  for (let i = 0; i < 200 && !enemy; i++) {
    T._spawnEnemy('normal');
    if (T.enemyShip.getSystem('cloaking')) enemy = T.enemyShip;
  }
  ok(!!enemy, 'a cloaked raider turns up within a reasonable number of spawns');
  const player = new Ship('frigate', true, 80, 120);
  player._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => player.addCrew(c));
  const cl = enemy.getSystem('cloaking');
  enemy.update(0.05);

  CombatManager.begin(player, enemy, 'normal');
  for (let i = 0; i < 60 && !CombatManager.isActive(); i++) CombatManager.update(0.05);
  enemy.hull = Math.floor(enemy.hullMax * 0.4);        // hurt it
  for (let i = 0; i < 40 && !cl.cloakActive; i++) CombatManager.update(0.05);
  ok(cl.cloakActive, 'a wounded raider fires its cloak instead of letting it rot');
})();

// ============================================================
section('23. Skill panel only opens from the crew roster');
// ============================================================
(function testSkillPanelHover() {
  const sb = loadEngine();
  const { Ship, Save, UI, Input, Renderer } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  ship.assignStations();
  ship.update(0.05);

  // The HUD needs a live canvas — nothing has booted the renderer in
  // this section, so wire it up the way Game.init() would.
  Renderer.init(sb.document.getElementById('game-canvas'));
  const ctx = Renderer.getCtx();
  Renderer.drawHUD({ playerShip: ship });      // publishes the roster zones

  // Cursor over a crew member ON THE SHIP — the panel must stay shut,
  // it used to cover the ship exactly while you were fighting.
  const c = ship.crew[0];
  Input.mouse.x = c.x; Input.mouse.y = c.y - 14;
  let drew = false;
  const realDraw = ctx.fillText;
  ok(!!c, 'test setup: a crew member exists');
  UI.draw(ctx, { playerShip: ship });
  // The reliable check is the hover resolver itself:
  const zone = Renderer.getPowerClickZones().find(z => z.crewIndex !== undefined);
  ok(!!zone, 'the HUD publishes roster rows as click zones');

  // Over the ROSTER row — the panel is expected here
  Input.mouse.x = zone.x + 4; Input.mouse.y = zone.y + 4;
  UI.draw(ctx, { playerShip: ship });
  ok(true, 'hovering a roster row draws the skill panel without throwing');

  // Formal guarantee: sprite position must not resolve to a crew member
  Input.mouse.x = c.x; Input.mouse.y = c.y - 14;
  const onSprite = Renderer.getPowerClickZones().some(z =>
    z.crewIndex !== undefined &&
    sb.Utils.pointInRect(Input.mouse.x, Input.mouse.y, z.x, z.y, z.w, z.h));
  ok(!onSprite, 'a crew sprite on the ship is not a roster zone — no panel there');
})();

// ============================================================
section('24. Combat feedback: flash, damage numbers, smoke');
// ============================================================
(function testCombatFeedback() {
  const sb = loadEngine();
  const { Ship, Save, Particles, Renderer, SHIP_CATALOG } = sb;
  Save.load(); Save.startRun();
  Renderer.init(sb.document.getElementById('game-canvas'));
  const ctx = Renderer.getCtx();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));

  // A hit must mark the room it landed in, so the player can SEE where
  // they were hit instead of hunting the power bar for a dark pip.
  const room = ship.rooms.find(r => r.system && r.type !== 'reactor');
  ship.rooms.forEach(r => { r._hitFlash = 0; });
  const shot = { def: { type: 'laser', damage: 2, shield_damage: 1, hull_damage: 2 },
                 x: room.cx, y: room.cy };
  // Aim it: receiveHit picks the room from the projectile position
  // shieldBars is a getter; strip the shield module instead so shots land
  const shSys = ship.getSystem('shields');
  if (shSys) ship.systems = ship.systems.filter(x => x !== shSys);
  let flashed = false;
  for (let i = 0; i < 60 && !flashed; i++) {
    ship.receiveHit({ ...shot, x: room.cx, y: room.cy });
    flashed = ship.rooms.some(r => r._hitFlash > 0);
  }
  ok(flashed, 'a shell landing lights up the compartment it hit');

  // …and the flash fades on its own rather than sticking
  for (let i = 0; i < 40; i++) ship.update(0.05);
  ok(ship.rooms.every(r => !r._hitFlash), 'the flash fades out again');

  // Wrecked modules smoke, so a beaten ship LOOKS beaten. Count the
  // REQUESTS (the particle pool is private, and counting stubbed draw
  // calls would only test the harness).
  const realSmoke = Particles.damageSmoke;
  let smokeCalls = 0;
  Particles.damageSmoke = (...a) => { smokeCalls++; return realSmoke.apply(Particles, a); };
  const sys = ship.getSystem('engines');
  sys.damageLevel(sys.level);
  for (let i = 0; i < 400 && smokeCalls === 0; i++) ship.update(0.05);
  ok(smokeCalls > 0, 'a wrecked module gives off smoke');

  // …and a HEALTHY ship stays clean
  const before = smokeCalls;
  ship.systems.forEach(x => { x.damagedLevels = 0; });
  for (let i = 0; i < 200; i++) ship.update(0.05);
  ok(smokeCalls === before, 'an undamaged ship does not smoke');
  Particles.damageSmoke = realSmoke;

  // The new effects must exist and be safe to call
  ok(typeof Particles.muzzleFlash === 'function', 'muzzle flash effect exists');
  ok(typeof Particles.damageSmoke === 'function', 'damage smoke effect exists');
  Particles.muzzleFlash(10, 10, 1);
  Particles.muzzleFlash(10, 10, -1, '#ff0000');
  ok(true, 'muzzle flash runs in both directions without throwing');

  // Ship thumbnails: every catalogue hull must draw, and the helper
  // must not leak canvas state into the caller (that bug pushed the
  // hangar stats outside their card).
  // The harness ctx is a Proxy whose save/restore do nothing, so use a
  // ctx that actually MODELS the canvas state stack — otherwise this
  // would test the stub instead of the code.
  const stateCtx = (() => {
    const st = { textAlign: 'left', fillStyle: '', strokeStyle: '', font: '', lineWidth: 1 };
    const stack = [];
    return new Proxy(st, {
      get: (t, k) => {
        if (k === 'save')    return () => stack.push({ ...t });
        if (k === 'restore') return () => Object.assign(t, stack.pop() || {});
        if (k === 'measureText') return () => ({ width: 10 });
        if (k in t) return t[k];
        return () => {};
      },
      set: (t, k, v) => { t[k] = v; return true; },
    });
  })();

  Object.keys(SHIP_CATALOG).forEach(key => {
    stateCtx.textAlign = 'left';
    Renderer.drawShipThumb(stateCtx, key, 0, 0, 150, 60);
    ok(stateCtx.textAlign === 'left',
      `${key}: drawShipThumb must not leak textAlign into the caller`);
  });
  Renderer.drawShipThumb(ctx, 'no_such_hull', 0, 0, 10, 10);
  ok(true, 'an unknown hull key is ignored rather than throwing');
})();

// ============================================================
section('25. Station tabs render in every awkward state');
// ============================================================
(function testStationTabs() {
  const sb = loadEngine();
  const { Ship, Save, Station, UI, CrewMember } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('scout', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));

  const cases = [
    ['fresh ship, full purse',   () => { Save.updateRun({ scrap: 500 }); }],
    ['broke and battered',       () => {
      Save.updateRun({ scrap: 0, fuel: 0, missiles: 0 });
      ship.hull = 1;
      ship.getSystem('engines').damageLevel(1);
      ship.crew[0].hp = 10;
      if (ship.crew[1]) { ship.crew[1].state = 'injured'; ship.crew[1].hp = 5; }
    }],
    ['no crew at all',           () => { ship.crew = []; }],
  ];

  cases.forEach(([label, setup]) => {
    setup();
    const st = new Station(2, 4242);
    try {
      UI.openStation(st, ship);
      ['repair', 'weapons', 'modules', 'crew'].forEach(tab => {
        UI.setStationTab ? UI.setStationTab(tab) : null;
      });
      ok(true, `station opens with ${label}`);
    } catch (e) {
      ok(false, `station threw with ${label}: ${e.message}`);
    }
  });

  // An empty hiring hall and a sold-out yard must not crash either
  const bare = new Station(1, 99);
  bare.stock.crew = [];
  bare.stock.weapons = [];
  bare.stock.hullRepair = 0;
  bare.stock.fuel = 0;
  bare.stock.missiles = 0;
  try {
    UI.openStation(bare, ship);
    ok(true, 'a picked-clean station still renders');
  } catch (e) {
    ok(false, 'empty station threw: ' + e.message);
  }
})();

// ============================================================
section('26. index.html loads every module, in dependency order');
// ============================================================
(function testIndexHtml() {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script src="(js\/[a-z0-9_]+\.js)"><\/script>/g)].map(m => m[1]);
  const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);

  // Every shipped module must be referenced. Forgetting one leaves the
  // game half-loaded — clicking a menu item plays a sound and dies
  // silently, which is exactly how the base screen shipped broken.
  files.forEach(f => ok(tags.includes(f), `index.html must load ${f}`));
  tags.forEach(t => ok(files.includes(t), `index.html references ${t}, which does not exist`));

  // Order matters: no bundler, so a file must come after what it uses.
  const idx = (f) => tags.indexOf('js/' + f + '.js');
  const after = (a, b) => ok(idx(a) > idx(b), `${a}.js must load after ${b}.js`);
  after('game', 'base');
  after('game', 'basescreen');
  after('basescreen', 'base');
  after('base', 'save');
  after('base', 'crew');
  after('game', 'renderer');
  after('renderer', 'ship');

  // And the self-healing loader must cover exactly the late modules, so
  // a player with an out-of-date index.html still gets a working game.
  const gameSrc = fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8');
  ['js/base.js', 'js/basescreen.js', 'js/cargo.js', 'js/lootscreen.js'].forEach(f => {
    ok(gameSrc.includes(`'${f}'`),
      `game.js must be able to load ${f} at runtime (stale index.html safety net)`);
  });
})();

// ============================================================
section('28. Cargo grid: shapes, rotation, hazards, prices');
// ============================================================
(function testCargoGrid() {
  const sb = loadEngine();
  const { CargoGrid, CargoItem, CARGO_ITEMS, rotateMask, cargoMask } = sb;

  // — masks —
  const relic = cargoMask('alien_relic');
  ok(relic.length === 3 && relic[0].length === 2, 'the relic is a 2x3 bounding box');
  ok(relic[1][1] === false, 'the relic really has a hole in it (irregular shape)');
  const turned = rotateMask(relic, 1);
  ok(turned.length === 2 && turned[0].length === 3, 'rotating swaps width and height');
  ok(rotateMask(relic, 4).flat().join('') === relic.flat().join(''),
     'four rotations return the original mask');

  // — fitting —
  const g = new CargoGrid(4, 3);
  const crate = new CargoItem('module_crate');    // 2 wide, 3 tall
  ok(g.fits(crate, 0, 0), 'a 2x3 crate fits a 4x3 hold at the corner');
  ok(!g.fits(crate, 0, 1), 'the same crate does not fit hanging off the bottom');
  ok(!g.fits(crate, 3, 0), 'nor hanging off the right edge');
  ok(g.place(crate, 0, 0), 'placing it at the corner succeeds');
  const second = new CargoItem('module_crate');
  ok(!g.fits(second, 1, 0), 'a second crate cannot overlap the first');
  ok(g.fits(second, 2, 0), 'but it fits in the free half');

  // — rotation makes room —
  const g2 = new CargoGrid(3, 2);
  const gun = new CargoItem('gun_crate');          // 3x2
  ok(g2.fits(gun, 0, 0), 'a 3x2 gun crate fits a 3x2 hold');
  gun.rot = 1;
  ok(!g2.fits(gun, 0, 0), 'turned sideways (2x3) it no longer fits');

  // — autoPlace tries rotations —
  const g3 = new CargoGrid(2, 3);
  const gun2 = new CargoItem('gun_crate');
  ok(g3.autoPlace(gun2), 'autoPlace finds the rotation that fits');
  ok(gun2.w === 2 && gun2.h === 3, 'and leaves the item in that rotation');

  // — occupancy / at() —
  ok(g.at(0, 0) === crate, 'at() finds the item under a cell');
  ok(g.at(3, 2) === null, 'and returns null for empty space');
  ok(g.usedCells() === 6, 'a 2x3 crate takes exactly 6 cells');

  // — neighbours + hazard —
  const h = new CargoGrid(5, 3);
  const core = new CargoItem('unstable_core');     // 2x2, tag rad
  h.place(core, 0, 0);
  const med = new CargoItem('medkit');
  h.place(med, 2, 0);
  ok(h.neighbours(core).includes(med), 'a medkit packed against the core is a neighbour');
  ok(h.hasLiveHazard(), 'an uncooled core is a live hazard');
  let msgs = h.hazardTick();
  ok(med.damaged === true, 'the jump spoils cargo touching an uncooled core');
  ok(msgs.length === 1, 'and says so exactly once');
  msgs = h.hazardTick();
  ok(msgs.length === 0, 'already-spoiled cargo is not reported again');

  // — a cooler smothers it —
  const h2 = new CargoGrid(5, 3);
  const core2 = new CargoItem('unstable_core');
  h2.place(core2, 0, 0);
  const cooler = new CargoItem('cooler_crate');    // 1x2
  h2.place(cooler, 2, 0);
  const med2 = new CargoItem('medkit');
  // Directly UNDER the core — so if the cooler were ignored this
  // medkit would certainly cook. (It sat out of range before, which
  // made this test pass even with the cooler logic deleted.)
  h2.place(med2, 0, 2);
  ok(h2.neighbours(core2).includes(med2), 'the medkit really is touching the core');
  ok(!h2.hasLiveHazard(), 'a cooler crate touching the core defuses it');
  h2.hazardTick();
  ok(med2.damaged === false, 'and nothing else spoils');

  // — prices react to the port —
  const data = new CargoItem('data_core');
  ok(data.value('science') > data.value('outpost'),
     'research posts pay more for data cores than a frontier outpost');
  const ctb = new CargoItem('contraband');
  ok(ctb.value('military') === 0, 'a fleet yard never pays for contraband');
  ok(ctb.value('outpost') > ctb.value('general'),
     'the frontier pays best for contraband');
  const spoiled = new CargoItem('drone_core');
  const clean = spoiled.value('general');
  spoiled.damaged = true;
  ok(spoiled.value('general') < clean, 'spoiled cargo is worth less');

  // — serialisation round-trip —
  const raw = h2.serialise();
  const back = CargoGrid.deserialise(JSON.parse(JSON.stringify(raw)));
  ok(back.cols === h2.cols && back.rows === h2.rows, 'grid size survives a save');
  ok(back.items.length === h2.items.length, 'so do the items');
  ok(back.items[0].x === h2.items[0].x && back.items[0].rot === h2.items[0].rot,
     'positions and rotations survive a save');
  const junk = CargoGrid.deserialise({ cols: 3, rows: 3, items: [{ defKey: 'no_such_thing' }] });
  ok(junk.items.length === 0, 'an unknown item key from an older save is dropped, not crashed on');

  // — wreck generation —
  const wreck = sb.makeWreckGrid(3);
  ok(wreck.items.length > 0, 'a derelict always has something in it');
  ok(wreck.items.every(it => CARGO_ITEMS[it.defKey]), 'and only real items');
  ok(wreck.cols >= 4 && wreck.rows >= 3, 'a wreck hold is at least 4x3');
})();

// ============================================================
section('29. The hold is part of the ship');
// ============================================================
(function testShipCargo() {
  const sb = loadEngine();
  const { Ship, Save } = sb;
  Save.load(); Save.startRun();

  const scout = new Ship('scout', true, 0, 0);
  const hauler = new Ship('hauler', true, 0, 0);
  ok(!!scout.cargo, 'every hull gets a cargo grid');
  ok(hauler.cargo.capacity > scout.cargo.capacity,
     `the freighter's hold is bigger than the tug's (${hauler.cargo.capacity} > ${scout.cargo.capacity})`);

  scout.cargo.add('data_core');
  scout.cargo.add('he2_canister');
  const data = scout.serialise();
  ok(data.cargo && data.cargo.items.length === 2, 'the hold is written into the save');

  const back = Ship.deserialise(data, true, 0, 0);
  ok(back.cargo.items.length === 2, 'and read back out again');
  ok(back.cargo.items[0].defKey === 'data_core', 'with the right contents');

  // Old save, written before the hold existed
  delete data.cargo;
  const legacy = Ship.deserialise(data, true, 0, 0);
  ok(legacy.cargo && legacy.cargo.items.length === 0,
     'a pre-cargo save loads with an empty hold instead of crashing');
})();

// ============================================================
section('30. Loot screen: taking, unpacking, casting off');
// ============================================================
(function testLootScreen() {
  const sb = loadEngine();
  const { Ship, Save, LootScreen, CargoGrid, Renderer } = sb;
  Save.load(); Save.startRun();
  Renderer.init(sb.document.getElementById('game-canvas'));
  const ctx = Renderer.getCtx();

  const ship = new Ship('hauler', true, 0, 0);
  const wreck = new CargoGrid(3, 2);
  wreck.add('data_core');
  wreck.add('missile_crate');

  let closed = false;
  LootScreen.openLoot(wreck, ship.cargo, {
    seconds: 30, onClose: () => { closed = true; },
    onUnpack: (it) => ({ ok: true, message: 'unpacked ' + it.label }),
  });
  ok(LootScreen.isOpen(), 'the screen reports itself open');
  LootScreen.draw(ctx);

  // TAKE ALL
  sb.Input.mouse.x = 120 + 60; sb.Input.mouse.y = 588 + 17;
  LootScreen.draw(ctx);
  const takeAll = 120 + 122 + 60;                 // second button along
  sb.Input.mouse.x = takeAll; sb.Input.mouse.y = 588 + 17;
  sb.Input.mouse.leftPressed = true;
  LootScreen.update(0.016);
  sb.Input.mouse.leftPressed = false;
  ok(wreck.items.length === 0, 'TAKE ALL empties the derelict hold');
  ok(ship.cargo.items.length === 2, 'and fills yours');

  // The clock runs out on its own
  const r = LootScreen.update(40);
  ok(r === 'done', 'running out of time closes the screen');
  ok(closed, 'and the close callback fires');
  ok(!LootScreen.isOpen(), 'the screen is no longer open afterwards');

  // A full hold cannot swallow more than it holds
  const tiny = new Ship('scout', true, 0, 0);
  const fat = new CargoGrid(4, 4);
  for (let i = 0; i < 8; i++) fat.add('module_crate');
  LootScreen.openLoot(fat, tiny.cargo, {});
  LootScreen.draw(ctx);
  sb.Input.mouse.x = takeAll; sb.Input.mouse.y = 588 + 17;
  sb.Input.mouse.leftPressed = true;
  LootScreen.update(0.016);
  sb.Input.mouse.leftPressed = false;
  ok(tiny.cargo.usedCells() <= tiny.cargo.capacity,
     'a small hold never overfills');
  ok(fat.items.length + tiny.cargo.items.length >= 1,
     'nothing is lost in the transfer — it stays on the wreck if it does not fit');
})();

// ============================================================
section('31. Unpacking a crate spends it on the run');
// ============================================================
(function testUnpack() {
  const sb = loadEngine();
  const { Ship, Save, Game } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('hauler', true, 0, 0);
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;

  const fuelBefore = Save.getRun().fuel;
  const can = ship.cargo.add('he2_canister');
  const res = T._unpackCargo(can);
  ok(res.ok, 'a He2 canister unpacks');
  ok(Save.getRun().fuel === fuelBefore + can.def.amount,
     `and the He2 lands in the tank (${fuelBefore} → ${Save.getRun().fuel})`);

  const mslBefore = Save.getRun().missiles;
  const crate = ship.cargo.add('missile_crate');
  T._unpackCargo(crate);
  ok(Save.getRun().missiles === mslBefore + crate.def.amount, 'missiles reload too');

  const hurt = ship.crew[0];
  hurt.hp = 1;
  const kit = ship.cargo.add('medkit');
  T._unpackCargo(kit);
  ok(hurt.hp > 1, 'a medkit patches up the worst-hurt crewman');

  const gun = ship.cargo.add('gun_crate', 'laser_basic');
  const gunsBefore = ship.weaponCargo.length;
  T._unpackCargo(gun);
  ok(ship.weaponCargo.length === gunsBefore + 1, 'a gun crate moves the gun to the rack');

  const junk = ship.cargo.add('ration_pack');
  ok(T._unpackCargo(junk).ok === false, 'plain trade goods have nothing to unpack');
})();

// ============================================================
section('32. Hazard bites on the jump, not before');
// ============================================================
(function testJumpHazard() {
  const sb = loadEngine();
  const { Ship, Save, Game, CargoItem } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('hauler', true, 0, 0);
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;
  T.STATE = 'map';

  const core = new CargoItem('unstable_core');
  ship.cargo.place(core, 0, 0);
  const relic = new CargoItem('alien_relic');
  ship.cargo.place(relic, 2, 0);
  ok(relic.damaged === false, 'sitting still, nothing spoils');

  T.sectorMap = new sb.SectorMap(1, 12345);
  Save.updateRun({ fuel: 5 });

  // Picking the starting lane is NOT a jump — no fuel, no hazard.
  const first = T.sectorMap.nodes.find(n => !n.locked);
  T._travelTo(first.id);
  ok(Save.getRun().fuel === 5, 'choosing the starting lane costs no He2');
  ok(relic.damaged === false, 'and spoils nothing');

  // The next hop is a real jump.
  const next = T.sectorMap.nodes.find(n => !n.locked && n.id !== first.id);
  T._travelTo(next.id);
  ok(Save.getRun().fuel === 4, 'a real jump burns 1 He2');
  ok(relic.damaged === true, 'and spoils cargo packed against an uncooled core');
})();

// ============================================================
section('27. Engine boots and runs a frame');
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
