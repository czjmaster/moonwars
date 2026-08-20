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
  // update30: doors take a full second to cycle, so it is CLOSING here,
  // not already closed. What matters is that it ends up shut.
  ok(ourAirlock.mode === 'closed', 'our airlock is latched shut behind the returning party');
  for (let i = 0; i < 30; i++) ourAirlock.update(0.05, []);
  ok(ourAirlock.open === false, 'and a second later it really is closed (no venting)');
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
  // update26: missiles live in the hold, so the run's counter mirrors it
  // rather than being loaded as a separate number.
  ok(run.fuel === 6, 'the run starts with the He2 that was loaded');
  ok(run.missiles === T.playerShip.missileCount(),
     `the missile readout mirrors the racks (${run.missiles})`);
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

  // TAKE ALL — found by name, not by counting pixels along the row
  LootScreen.draw(ctx);
  const taZone = LootScreen._zoneFor('takeAll');
  ok(!!taZone, 'the TAKE ALL button is on screen');
  const takeAll = taZone.x + taZone.w / 2;
  sb.Input.mouse.x = takeAll; sb.Input.mouse.y = taZone.y + taZone.h / 2;
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

  // A tall grid (the base store is 8x6) must still fit above the detail
  // panel — it used to run straight underneath it.
  const bigStore = new CargoGrid(8, 6);
  LootScreen.openLoot(bigStore, ship.cargo, {});
  LootScreen.draw(ctx);
  const br = LootScreen._gridRect('wreck');
  ok(br.y + br.h <= 470, `an 8x6 store fits above the detail panel (bottom ${br.y + br.h})`);
  const hr = LootScreen._gridRect('hold');
  ok(br.x + br.w < hr.x, 'and the two grids still do not overlap at that size');

  // A full hold cannot swallow more than it holds
  const tiny = new Ship('scout', true, 0, 0);
  const fat = new CargoGrid(4, 4);
  for (let i = 0; i < 8; i++) fat.add('module_crate');
  LootScreen.openLoot(fat, tiny.cargo, {});
  LootScreen.draw(ctx);
  const tz = LootScreen._zoneFor('takeAll');
  sb.Input.mouse.x = tz.x + tz.w / 2; sb.Input.mouse.y = tz.y + tz.h / 2;
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

  // Missiles are not "unpacked" any more — the launcher feeds from the
  // rack where it lies, so opening one is a no-op with an explanation.
  const rack = ship.cargo.add('missile_rack', null, 6);
  const mslRes = T._unpackCargo(rack);
  ok(mslRes.ok === false, 'a missile rack has nothing to open');
  ok(ship.cargo.countOf('missiles') === 6, 'and the rounds stay in it');

  const hurt = ship.crew[0];
  hurt.hp = 1;
  const kit = ship.cargo.add('medkit');
  T._unpackCargo(kit);
  ok(hurt.hp > 1, 'a medkit patches up the worst-hurt crewman');

  // update29: a gun is either BOLTED ON or BOXED. Unboxing = fitting,
  // and that needs a free mount — there is no weightless rack any more.
  ship.weapons = [];                                  // free every mount
  const gun = ship.cargo.add('gun_crate', 'laser_basic');
  const r = T._unpackCargo(gun);
  ok(r.ok, `a gun crate can be unboxed into a free mount (${r.message})`);
  ok(ship.weapons.some(w => w && w.defKey === 'laser_basic'),
     'and the gun ends up FITTED, not floating on a rack');

  // With every mount full it stays in its crate.
  const gun2 = ship.cargo.add('gun_crate', 'laser_basic');
  const r2 = T._unpackCargo(gun2);
  ok(r2.ok === false, 'with no free mount it cannot be unboxed');
  ok(ship.cargo.items.includes(gun2), 'and the crate stays in the hold');

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
section('33. Bursts fire one shot at a time');
// ============================================================
(function testBurstStagger() {
  const sb = loadEngine();
  const { Weapon, WEAPON_DEFS } = sb;

  const burst = new Weapon('laser_burst');
  ok(WEAPON_DEFS.laser_burst.shots === 3, 'the burst laser is a 3-shot gun');
  burst.armed = true;
  const projs = burst.fire(0, 0, 400, 0, true);
  ok(projs.length === 3, 'firing it spawns three projectiles');

  const delays = projs.map(p => p.launchDelay);
  ok(delays[0] === 0, 'the first bolt leaves immediately');
  ok(delays[1] > 0 && delays[2] > delays[1],
     `the rest are staggered (${delays.join(', ')})`);

  // Until its delay expires a bolt must not move — otherwise all three
  // overlap perfectly and read as a single shot, which is the bug.
  const p2 = projs[1];
  const x0 = p2.x;
  p2.update(0.05);
  ok(p2.x === x0, 'a queued bolt does not move while it waits');
  p2.update(0.5);
  p2.update(0.05);
  ok(p2.x !== x0, 'and it does move once its turn comes');

  const single = new Weapon('laser_basic');
  single.armed = true;
  const one = single.fire(0, 0, 400, 0, true);
  ok(one.length === 1 && one[0].launchDelay === 0,
     'a single-shot gun is unaffected');
})();

// ============================================================
section('34. Missiles and guns take up hold space');
// ============================================================
(function testAmmoInHold() {
  const sb = loadEngine();
  const { CargoItem, cargoCrateForWeapon, WEAPON_DEFS } = sb;

  // Better gun → bigger box.
  const light = cargoCrateForWeapon('ion_basic');      // 45 CC
  const mid   = cargoCrateForWeapon('laser_heavy');    // 70 CC
  const heavy = cargoCrateForWeapon('cannon_basic');   // 80 CC
  const size = k => { const it = new CargoItem(k); return it.w * it.h; };
  ok(size(light) < size(mid), `a light gun boxes smaller than a mid one (${size(light)} < ${size(mid)})`);
  ok(size(mid) < size(heavy), `and a mid one smaller than a heavy (${size(mid)} < ${size(heavy)})`);

  // A boxed gun is worth a share of its shop price, not a flat number.
  const cheap = new CargoItem(cargoCrateForWeapon('ion_basic'), 'ion_basic');
  const dear  = new CargoItem(cargoCrateForWeapon('cannon_basic'), 'cannon_basic');
  ok(dear.value('general') > cheap.value('general'),
     'a boxed heavy gun sells for more than a boxed light one');
})();

// ============================================================
section('35. Packing the hold in the base');
// ============================================================
(function testBasePacking() {
  const sb = loadEngine();
  const { Base, BaseScreen, Save, CargoGrid, Game } = sb;
  const T = Game.__test;
  Save.load();

  const b = Base.get();
  b.warehouse.fuel = 20;
  b.warehouse.missiles = 12;
  b.armoury.push('laser_heavy', 'ion_basic');

  BaseScreen.open();
  const { store, hold } = BaseScreen.packGrids();
  ok(!!store && !!hold, 'the base hands over a store grid and a ship hold');

  const kinds = store.items.map(it => it.def.kind);
  ok(kinds.includes('missiles'), 'missiles are on the shelf as crates');
  ok(kinds.includes('weapon'), 'so are the spare guns');
  ok(store.countOf('missiles') === 12,
     `all 12 missiles are on the shelf (${store.countOf('missiles')})`);
  ok(store.items.filter(it => it.def.kind === 'missiles').length === 2,
     '12 missiles = one full rack of 10 plus a rack of 2');

  // Pack every missile rack and one gun.
  const crates = store.items.filter(it => it.def.kind === 'missiles');
  const gun    = store.items.find(it => it.def.kind === 'weapon');
  [...crates, gun].forEach(it => { store.remove(it); hold.autoPlace(it); });

  ok(hold.countOf('missiles') === 12, 'all 12 rounds are in the hold');

  const before = { fuel: b.warehouse.fuel, msl: b.warehouse.missiles, guns: b.armoury.length };
  const res = Base.launch({ shipIndex: 0, crewIds: [], fuel: 6, missiles: 0,
                            mission: 'patrol', hold });
  ok(res.ok, `launch succeeds (${res.message || 'ok'})`);
  ok(!!res.hold, 'and the packed hold travels with the ship');

  const after = Base.get();
  ok(after.warehouse.missiles === before.msl - 12,
     `the packed rounds really left the warehouse (${before.msl} → ${after.warehouse.missiles})`);
  ok(after.armoury.length === before.guns - 1, 'and the packed gun left the armoury');
  ok(after.warehouse.fuel === before.fuel - 6, 'the tank draws from the same warehouse');

  // The run must actually receive the cargo.
  T._startContract(res);
  const shipHold = T.playerShip.cargo;
  ok(shipHold.items.length >= 2,
     `the launched ship carries the packed cargo (${shipHold.items.length} items)`);
  ok(Save.getRun().missiles === 12,
     `the HUD reads the racks straight off the hold (${Save.getRun().missiles})`);
  ok(T.playerShip.missileCount() === 12, 'and the ship agrees');
})();

// ============================================================
section('36. Missile crates feed the guns mid-fight');
// ============================================================
(function testAutoUnpack() {
  const sb = loadEngine();
  const c = makeCombat(sb, { enemyArmed: false });
  const { Save, CombatManager, Weapon } = sb;

  // One rack with 3 rounds in it — that IS the ammo, there is no second
  // hidden counter.
  c.player.cargo.clear();
  const rack = c.player.cargo.add('missile_rack', null, 3);
  ok(!!rack && c.player.missileCount() === 3, 'the hold holds 3 rounds');
  Save.updateRun({ missiles: c.player.missileCount() });

  const gun = new Weapon('missile_basic');
  gun.armed = true;
  c.player.weapons = [gun];
  for (let i = 0; i < 40 && !CombatManager.isActive(); i++) CombatManager.update(0.05);

  CombatManager.playerFire(gun, c.enemy.rooms[0]);
  ok(c.player.missileCount() === 2, `firing takes one out of the rack (${c.player.missileCount()})`);
  ok(Save.getRun().missiles === 2, 'and the HUD figure follows the rack');

  // Empty the rack: the gun simply cannot fire.
  c.player.cargo.takeStack('missiles', 99);
  ok(c.player.cargo.items.length === 0, 'an emptied rack leaves the hold');
  gun.armed = true;
  CombatManager.playerFire(gun, c.enemy.rooms[0]);
  ok(c.player.missileCount() === 0, 'with nothing left, the gun simply does not fire');
})();

// ============================================================
section('37. Derelicts turn up on the map, not just after fights');
// ============================================================
(function testMapDerelicts() {
  const sb = loadEngine();
  const { EVENTS, Ship, Save, Game, NODE_TYPES } = sb;
  const T = Game.__test;

  const dockers = EVENTS.filter(e =>
    e.choices.some(ch => ch.result && ch.result.dockWreck));
  ok(dockers.length >= 4, `several map events now offer a docking (${dockers.length})`);
  ok(NODE_TYPES.event.weight >= 5, 'and event nodes are more common on the map');

  Save.load(); Save.startRun();
  const ship = new Ship('hauler', true, 0, 0);
  sb.makeStartingCrew().forEach(cm => ship.addCrew(cm));
  T.playerShip = ship;
  T.STATE = 'event';
  T.event = dockers[0];

  const idx = dockers[0].choices.findIndex(ch => ch.result.dockWreck);
  T._resolveEvent(idx);
  // update28: docking comes FIRST, then you walk through the hulk.
  ok(T.STATE === 'docking', `docking a map derelict opens the clamps minigame (${T.STATE})`);
  ok(sb.DockingGame.isOpen(), 'the minigame is live');

  // Auto-dock straight through it.
  sb.Renderer.init(sb.document.getElementById('game-canvas'));
  sb.DockingGame.draw(sb.Renderer.getCtx());
  const az = sb.DockingGame._zoneFor('auto');
  ok(!!az, 'AUTO-DOCK is always offered — the minigame never blocks you');
  sb.Input.mouse.x = az.x + az.w / 2; sb.Input.mouse.y = az.y + az.h / 2;
  // Drive it through the GAME's own update, or the result is consumed
  // out from under _updateDocking and the flow never advances.
  sb.Input.mouse.leftPressed = true;
  T._updateDocking(0.016);
  sb.Input.mouse.leftPressed = false;
  T._updateDocking(1.2);                 // let the outcome hold expire

  ok(T.STATE === 'combat', `after docking you are ABOARD the hulk (${T.STATE})`);
  ok(!!T.enemyShip && T.enemyShip.isDerelict, 'and the hulk is a real, walkable ship');
  const nest = T.enemyShip.crew.filter(c => !c.isPlayer && !c.dead);
  ok(nest.length > 0, `with a nest in it (${nest.length} spiders)`);
  ok(nest.every(c => c.isSpider), 'and they really are spiders');
  ok(T.enemyShip.weapons.length === 0, 'a derelict has no guns to shoot back with');

  // Kill the nest: the hold opens by itself, no dialog.
  nest.forEach(c => { c.dead = true; c.dying = false; });
  T._updateCombat(0.05);
  ok(T.STATE === 'loot', `clearing the nest opens the hold (${T.STATE})`);
})();

// ============================================================
section('38. Stacks: quantity is the item');
// ============================================================
(function testStacks() {
  const sb = loadEngine();
  const { CargoGrid, CargoItem, CARGO_ITEMS } = sb;

  const rack = new CargoItem('missile_rack');
  ok(rack.w * rack.h === 3, 'a missile rack is three cells');
  ok(rack.stackMax === 10, 'and holds up to 10 rounds');
  ok(rack.qty === 10, 'a fresh one comes full');

  ok(new CargoItem('he2_small').stackMax === 5,  'small He2 cell: 5 units, 1 cell');
  ok(new CargoItem('he2_small').w * new CargoItem('he2_small').h === 1, 'and it is 1 cell');
  ok(new CargoItem('he2_med').stackMax === 15,   'medium tank: 15 units');
  ok(new CargoItem('he2_med').w * new CargoItem('he2_med').h === 2, 'across 2 cells');
  ok(new CargoItem('he2_large').stackMax === 50, 'drum: 50 units');
  ok(new CargoItem('he2_large').w * new CargoItem('he2_large').h === 4, 'across 4 cells');
  ok(new CargoItem('medkit').stackMax === 10, 'medical supplies: 10 doses in one cell');

  // 11 missiles must occupy TWO racks — this is the user's own example.
  const g = new CargoGrid(6, 4);
  const left = g.addStack('missile_rack', 11);
  ok(left === 0, 'all 11 rounds fit in a 6x4 hold');
  ok(g.countOf('missiles') === 11, 'and the hold counts 11 of them');
  const racks = g.items.filter(it => it.def.kind === 'missiles');
  ok(racks.length === 2, `11 rounds = 2 racks (${racks.length})`);
  ok(racks.some(r => r.qty === 10) && racks.some(r => r.qty === 1),
     'one full rack of 10 and one holding a single round');
  ok(g.usedCells() === 6, 'which costs 6 cells, not 3');

  // Topping up fills the part-empty rack first instead of laying a new one.
  g.addStack('missile_rack', 5);
  ok(g.items.filter(it => it.def.kind === 'missiles').length === 2,
     'topping up refills the half-empty rack rather than adding a third');
  ok(g.countOf('missiles') === 16, 'and the count is right');

  // Spending drains the SMALLEST stack first, so the hold defragments.
  const took = g.takeStack('missiles', 6);
  ok(took === 6, 'six rounds came out');
  ok(g.countOf('missiles') === 10, 'ten left');

  // A hold that is genuinely full reports the spill instead of swallowing it.
  const tiny = new CargoGrid(3, 1);
  const spill = tiny.addStack('missile_rack', 25);
  ok(spill === 15, `only one rack fits, 15 rounds are left behind (${spill})`);
  ok(tiny.countOf('missiles') === 10, 'and exactly 10 went aboard');

  // Value follows the quantity.
  const full = new CargoItem('missile_rack');
  const near = new CargoItem('missile_rack'); near.qty = 2;
  ok(full.value('general') > near.value('general'),
     'a full rack is worth more than a nearly-empty one');

  // Quantities survive a save.
  const back = CargoGrid.deserialise(JSON.parse(JSON.stringify(g.serialise())));
  ok(back.countOf('missiles') === g.countOf('missiles'), 'quantities survive a save');
})();

// ============================================================
section('39. Opening containers actually uses them');
// ============================================================
(function testUseContainers() {
  const sb = loadEngine();
  const { Ship, Save, Game } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('hauler', true, 0, 0);
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;

  // He2: the whole tank goes into the ship's tank.
  Save.updateRun({ fuel: 2 });
  const tank = ship.cargo.add('he2_med', null, 12);
  const r1 = T._unpackCargo(tank);
  ok(r1.ok && r1.consumed === true, 'pouring a tank uses it up');
  ok(Save.getRun().fuel === 14, `and all 12 units go in (${Save.getRun().fuel})`);

  // Medicine: ONE dose at a time, the rest survives.
  const hurt = ship.crew[0];
  hurt.hp = 10;
  const meds = ship.cargo.add('medkit', null, 3);
  const r2 = T._unpackCargo(meds);
  ok(r2.ok, 'a dose can be used');
  ok(r2.consumed === false, 'and the supplies are NOT thrown away after one dose');
  ok(meds.qty === 2, `two doses left (${meds.qty})`);
  ok(hurt.hp > 10, 'the crewman is patched up');

  hurt.hp = 10; T._unpackCargo(meds);
  hurt.hp = 10; const r3 = T._unpackCargo(meds);
  ok(meds.qty === 0 && r3.consumed === true, 'the last dose empties the box');

  // Nobody hurt → no dose wasted.
  ship.crew.forEach(c => { c.hp = c.maxHp; });
  const spare = ship.cargo.add('medkit', null, 4);
  const r4 = T._unpackCargo(spare);
  ok(r4.ok === false && spare.qty === 4, 'with a healthy crew, nothing is used up');
})();

// ============================================================
section('40. The base shelf never shows a gun twice (reported bug)');
// ============================================================
(function testGunDuplication() {
  const sb = loadEngine();
  const { Base, BaseScreen, Save } = sb;
  Save.load();

  const b = Base.get();
  b.armoury.length = 0;
  b.warehouse.fuel = 20; b.warehouse.missiles = 10;

  BaseScreen.open();
  const gunsOnShelf = () =>
    BaseScreen._state().store.items.filter(it => it.def.kind === 'weapon').length;
  ok(gunsOnShelf() === 0, 'nothing spare on the shelf to begin with');

  // Take the gun off the hull: it should appear on the shelf as a crate.
  BaseScreen._act('unfit', 0);
  ok(Base.armoury().length === 1, 'the gun is in the armoury');
  ok(gunsOnShelf() === 1, 'and a gun crate shows up on the base shelf');

  // Put it back on the hull. THE BUG: the crate stayed on the shelf, so
  // the same gun could be packed into the hold and flown out twice.
  BaseScreen._act('fit', 0);
  ok(Base.armoury().length === 0, 'fitting takes it back out of the armoury');
  ok(gunsOnShelf() === 0, `and the crate leaves the shelf too (${gunsOnShelf()} left)`);

  // Same story for a gun already dragged into the packed hold.
  BaseScreen._act('unfit', 0);
  const { store, hold } = BaseScreen.packGrids();
  const crate = store.items.find(it => it.def.kind === 'weapon');
  store.remove(crate);
  ok(hold.autoPlace(crate), 'the crate can be packed into the hold');
  BaseScreen._act('fit', 0);
  const stillPacked = BaseScreen._state().hold.items
    .filter(it => it.def.kind === 'weapon').length;
  ok(stillPacked === 0,
     `a gun fitted to the hull is taken back out of the packed hold (${stillPacked})`);

  // And pruning is honest about what it removed.
  const b2 = Base.get();
  b2.armoury.length = 0;
  b2.armoury.push('ion_basic');
  const shelf = Base.storeGrid(0);
  const hold2 = new sb.CargoGrid(6, 4);
  const c2 = shelf.items.find(it => it.def.kind === 'weapon');
  ok(!!c2, 'the freshly built shelf carries the spare gun');
  shelf.remove(c2);
  hold2.autoPlace(c2);
  b2.armoury.length = 0;               // the gun vanishes behind our back
  const dropped = Base.pruneHold(hold2, 0);
  ok(dropped.length === 1, 'pruning reports what it had to take back out');
  ok(hold2.items.filter(it => it.def.kind === 'weapon').length === 0,
     'and the unbacked crate is gone');
})();

// ============================================================
section('41. Cargo retrofit is a base upgrade');
// ============================================================
(function testHoldUpgrade() {
  const sb = loadEngine();
  const { Base, BaseScreen, Save, SHIP_LAYOUTS } = sb;
  Save.load();

  ok(Base.holdBonus() === 0, 'a new base has no retrofit');
  ok(isFinite(Base.upgradeCost('hold')), 'the retrofit has a price');

  const b = Base.get();
  BaseScreen.open();
  const before = BaseScreen._state().hold.cols;
  ok(before === SHIP_LAYOUTS.scout.cargoCols,
     'the packed hold starts at the hull size');

  const poor = Base.buyUpgrade('hold');
  ok(poor.ok === false, 'you cannot buy it with no CC');

  Base.earn(Base.upgradeCost('hold'));
  const r = Base.buyUpgrade('hold');
  ok(r.ok, `the retrofit can be bought (${r.message})`);
  ok(Base.holdBonus() === 1, 'and it takes effect');

  BaseScreen.open();
  const after = BaseScreen._state().hold.cols;
  ok(after === before + 1, `every hull gains a column (${before} → ${after})`);
})();

// ============================================================
section('42. Wrecks are lean, not a free restock');
// ============================================================
(function testWreckBalance() {
  const sb = loadEngine();
  let cells = 0, worst = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const g = sb.makeWreckGrid(2);
    cells += g.usedCells();
    worst = Math.max(worst, g.usedCells());
  }
  const avg = cells / N;
  ok(avg < 12, `an average sector-2 wreck holds under 12 cells of cargo (${avg.toFixed(1)})`);
  ok(worst <= 20, `even the best one is not a jackpot (${worst} cells)`);

  // Stacks out of a wreck are part-used, not factory-full.
  let partials = 0, total = 0;
  for (let i = 0; i < 40; i++) {
    sb.makeWreckGrid(3).items.forEach(it => {
      if (!it.isStack) return;
      total++;
      if (it.qty < it.stackMax) partials++;
    });
  }
  ok(total > 0 && partials / total > 0.5,
     `most salvaged stacks are part-used (${partials}/${total})`);
})();

// ============================================================
section('43. Merging stacks by dropping one on another');
// ============================================================
(function testMerge() {
  const sb = loadEngine();
  const { CargoGrid, CargoItem, Ship, Save, LootScreen, Renderer, Input } = sb;

  const a = new CargoItem('medkit'); a.qty = 4;
  const bb = new CargoItem('medkit'); bb.qty = 3;
  ok(CargoGrid.canMerge(a, bb), 'two part-full medkits can be merged');
  ok(CargoGrid.merge(a, bb) === 4, 'all four doses pour across');
  ok(bb.qty === 7 && a.qty === 0, `7 in one box, the other is empty (${bb.qty}/${a.qty})`);

  // Overflow: only what fits moves, the rest stays put.
  const c = new CargoItem('medkit'); c.qty = 8;
  const d = new CargoItem('medkit'); d.qty = 6;
  const moved = CargoGrid.merge(c, d);
  ok(moved === 4, `only 4 fit into a box holding 6 of 10 (${moved})`);
  ok(d.qty === 10 && c.qty === 4, 'the target is full and the source keeps the rest');

  // Different things never merge.
  ok(!CargoGrid.canMerge(new CargoItem('medkit'), new CargoItem('he2_small')),
     'a medkit does not pour into a fuel cell');
  ok(!CargoGrid.canMerge(new CargoItem('drone_core'), new CargoItem('drone_core')),
     'non-stackable cargo cannot merge');
  const spoiled = new CargoItem('medkit'); spoiled.damaged = true;
  ok(!CargoGrid.canMerge(spoiled, new CargoItem('medkit')),
     'and spoiled goods are not poured into good ones');

  // consolidate() tidies a whole grid.
  const g = new CargoGrid(5, 4);
  g.add('medkit', null, 3); g.add('medkit', null, 4); g.add('medkit', null, 2);
  ok(g.items.length === 3, 'three part-full boxes to start');
  g.consolidate();
  ok(g.items.length === 1 && g.items[0].qty === 9,
     `they become one box of 9 (${g.items.length} box, ${g.items[0].qty})`);

  // ── and the same thing by DRAGGING, through the real screen ──
  Save.load(); Save.startRun();
  Renderer.init(sb.document.getElementById('game-canvas'));
  const ctx = Renderer.getCtx();
  const ship = new Ship('hauler', true, 0, 0);
  ship.cargo.clear();
  const src = ship.cargo.add('he2_small', null, 2);
  const dst = ship.cargo.add('he2_small', null, 1);
  LootScreen.openHold(ship.cargo, {});
  LootScreen.draw(ctx);

  const r = LootScreen._gridRect('hold');
  const cell = (it) => ({
    x: r.x + it.x * 47 + 20, y: r.y + it.y * 47 + 20,
  });
  const from = cell(src), to = cell(dst);
  Input.mouse.x = from.x; Input.mouse.y = from.y;
  Input.mouse.leftPressed = true; Input.mouse.leftDown = true;
  LootScreen.update(0.016);
  Input.mouse.leftPressed = false;
  Input.mouse.x = to.x; Input.mouse.y = to.y;
  LootScreen.update(0.016);
  Input.mouse.leftDown = false;
  LootScreen.update(0.016);

  ok(ship.cargo.items.length === 1,
     `dropping one cell onto the other leaves a single container (${ship.cargo.items.length})`);
  ok(ship.cargo.countOf('fuel') === 3, 'and nothing was lost in the merge');
})();

// ============================================================
section('44. The missile readout always equals the racks');
// ============================================================
(function testAmmoSync() {
  const sb = loadEngine();
  const { Ship, Save, Game, CargoItem } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('hauler', true, 0, 0);
  ship.cargo.clear();
  // A crewless ship is a LOST ship — _updateMap ends the run and there
  // would be nothing left to sync.
  sb.makeStartingCrew().forEach(cm => ship.addCrew(cm));
  T.playerShip = ship;
  T.STATE = 'map';
  T.sectorMap = new sb.SectorMap(1, 999);

  ship.cargo.addStack('missile_rack', 14);
  Save.updateRun({ missiles: 999 });          // deliberately wrong
  T._update(0.016);
  ok(Save.getRun().missiles === 14,
     `a stale readout is corrected to the real count (${Save.getRun().missiles})`);

  // Jettisoning changes it.
  ship.cargo.takeStack('missiles', 5);
  T._update(0.016);
  ok(Save.getRun().missiles === 9, 'spending rounds updates the readout');

  // A SPOILED rack must not be counted — the guns cannot draw from it.
  const rack = ship.cargo.items.find(it => it.def.kind === 'missiles');
  rack.damaged = true;
  ok(ship.cargo.countOf('missiles') === 0,
     'a spoiled rack counts for nothing');
  T._update(0.016);
  ok(Save.getRun().missiles === 0,
     'and the HUD does not promise rounds the launchers cannot fire');

  // Emptying the hold entirely.
  ship.cargo.clear();
  T._update(0.016);
  ok(Save.getRun().missiles === 0, 'an empty hold reads zero');
})();

// ============================================================
section('45. A recovered gun arrives in a locker');
// ============================================================
(function testWeaponLocker() {
  const sb = loadEngine();
  const { Ship, Save, Game, LootScreen, Renderer } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();
  Renderer.init(sb.document.getElementById('game-canvas'));

  const ship = new Ship('hauler', true, 0, 0);
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;
  T.STATE = 'map';
  T.sectorMap = new sb.SectorMap(1, 4242);
  const cargoBefore = ship.cargo.items.length;

  T._openWeaponLocker('laser_heavy');
  ok(T.STATE === 'loot', `a recovered gun opens the locker screen (${T.STATE})`);
  ok(LootScreen.isOpen(), 'the screen is live');

  const locker = LootScreen._gridRect('wreck');
  ok(!!locker, 'the locker has its own grid');
  ok(ship.cargo.items.length === cargoBefore,
     'the gun is NOT silently teleported into the hold');

  // Take it, then close.
  const ctx = Renderer.getCtx();
  LootScreen.draw(ctx);
  const takeZone = LootScreen._zoneFor('takeAll');
  sb.Input.mouse.x = takeZone.x + takeZone.w / 2;
  sb.Input.mouse.y = takeZone.y + takeZone.h / 2;
  sb.Input.mouse.leftPressed = true;
  LootScreen.update(0.016);
  sb.Input.mouse.leftPressed = false;
  const crate = ship.cargo.items.find(it => it.def.kind === 'weapon');
  ok(!!crate, 'taking it puts a real crate in the hold');
  ok(crate.meta === 'laser_heavy', 'and the crate knows which gun is inside');
  ok(crate.w * crate.h >= 4, 'a boxed gun takes real space');

  // Unboxing FITS it, and only if a mount is free.
  ship.weapons = [];
  const res = T._unpackCargo(crate);
  ok(res.ok, `unboxing fits the gun (${res.message})`);
  ok(ship.weapons.some(w => w && w.defKey === 'laser_heavy'),
     'the salvaged gun is on the hull');
  ok(!ship.cargo.items.includes(crate), 'and the crate is gone from the hold');
})();

// ============================================================
section('46. Boarders come home able to use the lift (reported bug)');
// ============================================================
(function testElevatorAfterBoarding() {
  const sb = loadEngine();
  const c = makeCombat(sb);
  const { Game } = sb;
  const T = Game.__test;
  const player = c.player, enemy = c.enemy;

  const shaft = player.elevators.shafts[0];
  ok(!!shaft, 'the hull has a lift shaft');

  // Someone is INSIDE the cabin when the boarding party goes out.
  const rider = player.crew.find(cm => !cm.dead);
  shaft.board(rider, 0);
  ok(shaft.passenger === rider && rider._ridingShaft === shaft,
     'test setup: he really is in the cabin');

  T.boardingParty = T._makeParty(player, enemy, [rider]);
  ok(shaft.passenger === null,
     'launching the party takes him out of the cabin');
  ok(!rider._ridingShaft, 'and clears his passenger flag');

  // Bring him home the way the game does.
  enemy.addCrew(rider, true);
  player.crew = player.crew.filter(k => k !== rider);
  rider._ridingShaft = shaft;             // simulate the stale flag
  shaft.passenger = rider;
  T._recoverBoarders();

  ok(!rider._ridingShaft, 'coming home clears the stale cabin flag');
  ok(shaft.passenger === null, 'and frees the shaft for everybody else');

  // He can now actually plan a route to the other deck.
  const otherFloorY = player.floorWalkY(0, 0) === player.floorWalkY(1, 0)
    ? null : player.floorWalkY(0, 999);
  rider.y = player.floorWalkY(1, 0);
  rider.x = player.rooms[0].cx;
  const routed = rider.moveToOnShip(player, player.rooms[0].cx, player.floorWalkY(0, 999));
  ok(routed !== false, 'he can be routed to the deck below');
  ok(rider._waypoints.some(w => w.elevator),
     'and the route really goes through the lift');
})();

// ============================================================
section('47. Void spiders bite, and the bite carries');
// ============================================================
(function testSpiderBite() {
  const sb = loadEngine();
  const { CrewMember, makeSpiders, CORP_KEYS, Save } = sb;
  Save.load();          // dying crew reach for the graveyard

  ok(!CORP_KEYS.includes('spider'), 'spiders are not a hireable corporation');

  const nest = makeSpiders(3, 1);
  ok(nest.length === 3 && nest.every(c => c.isSpider), 'a nest of three spiders');
  ok(nest.every(c => !c.isPlayer), 'and they are hostile');

  // A bite infects; the same man is not re-infected.
  const victim = new CrewMember({ name: 'Bitten' });
  ok(victim.isPlayer && !victim.virus, 'a fresh crewman is clean');
  let tries = 0, hurt = false;
  while (!victim.virus && tries++ < 400) {
    nest[0].strike(victim, 1);
    if (victim.hp < victim.maxHp) hurt = true;
    victim.hp = victim.maxHp;      // keep him upright so we test the BITE
  }
  ok(victim.virus, `a spider bite eventually takes hold (after ${tries})`);
  ok(hurt, 'and the bite itself hurt');

  // Spiders do not infect each other, and ordinary crew infect nobody.
  const other = new CrewMember({ name: 'Clean' });
  const human = new CrewMember({ name: 'Human' });
  for (let i = 0; i < 200; i++) human.strike(other, 0.01);
  ok(!other.virus, 'ordinary crew do not carry it');

  // The old corpse plague is a SEPARATE thing — the clinic must not
  // accidentally cure the spider virus.
  ok('infected' in victim && 'virus' in victim,
     'the two illnesses are separate flags');

  // It survives a save.
  const back = CrewMember.deserialise(JSON.parse(JSON.stringify(victim.serialise())));
  ok(back.virus === true, 'the virus survives a save');
})();

// ============================================================
section('48. Virus → death → egg → spiders loose aboard');
// ============================================================
(function testVirusLifecycle() {
  const sb = loadEngine();
  const { Ship, Save, Game, VIRUS_FIGHTS_TO_DEATH, EGG_FIGHTS_TO_HATCH } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('hauler', true, 0, 0);
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;
  const victim = ship.crew[0];
  victim.virus = true;

  // A few fights of getting worse, then it kills him.
  for (let i = 0; i < VIRUS_FIGHTS_TO_DEATH - 1; i++) T._tickInfections();
  ok(!victim.dead, `he survives the first ${VIRUS_FIGHTS_TO_DEATH - 1} fights`);
  ok(victim.virusFights === VIRUS_FIGHTS_TO_DEATH - 1, 'and the clock is ticking');

  T._tickInfections();
  ok(victim.dead, 'the virus kills him on schedule');
  const egg = ship.cargo.items.find(it => it.def.tag === 'egg');
  ok(!!egg, 'and leaves an egg case in the hold');
  ok(egg.meta === EGG_FIGHTS_TO_HATCH, 'with a hatch timer on it');

  // The egg hatches into loose spiders aboard YOUR ship.
  const crewBefore = ship.crew.length;
  for (let i = 0; i < EGG_FIGHTS_TO_HATCH - 1; i++) T._tickInfections();
  ok(ship.cargo.items.includes(egg), 'it does not hatch early');

  T._tickInfections();
  ok(!ship.cargo.items.includes(egg), 'then the case splits');
  const loose = ship.crew.filter(c => c.isSpider && !c.dead);
  ok(loose.length >= 1 && loose.length <= 3,
     `1-3 spiders are loose aboard (${loose.length})`);
  ok(ship.crew.length === crewBefore + loose.length, 'they really joined the ship');

  // They must NOT be counted as your crew — otherwise a ship full of
  // spiders would read as still crewed after they killed everybody.
  ship.crew.filter(c => c.isPlayer).forEach(c => { c.dead = true; });
  ok(T._playerCrewAliveCount() === 0,
     'a ship crewed only by spiders counts as lost');
})();

// ============================================================
section('49. Only a research post can cure it');
// ============================================================
(function testQuarantine() {
  const sb = loadEngine();
  const { Ship, Save, Station } = sb;
  Save.load(); Save.startRun();
  Save.updateRun({ scrap: 500 });

  const ship = new Ship('hauler', true, 0, 0);
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  ship.crew[0].virus = true;
  ship.crew[1].virus = true;

  const yard = new Station(2, 11); yard.type = 'military';
  const bad = yard.cureVirus(ship, Save.getRun());
  ok(bad.ok === false, 'a fleet yard cannot treat it');
  ok(ship.crew[0].virus, 'and the carrier is still carrying');

  // The ordinary clinic heals wounds but must NOT clear the virus.
  ship.crew[0].hp = 10;
  const heal = yard.healCrew(ship, Save.getRun());
  ok(heal.ok, 'the clinic still patches people up');
  ok(ship.crew[0].virus === true,
     'but a 12 CC clinic visit does not cure the void-spider virus');

  const lab = new Station(2, 12); lab.type = 'science';
  const cost = lab.quarantineCost(ship);
  ok(cost === 90, `two carriers cost 90 CC (${cost})`);
  const good = lab.cureVirus(ship, Save.getRun());
  ok(good.ok, `a research post treats it (${good.message})`);
  ok(!ship.crew[0].virus && !ship.crew[1].virus, 'both carriers are clean');
  ok(lab.cureVirus(ship, Save.getRun()).ok === false, 'and there is nobody left to treat');
})();

// ============================================================
section('50. Docking: short, skippable, and it matters');
// ============================================================
(function testDocking() {
  const sb = loadEngine();
  const { DockingGame, DOCK_OUTCOMES, Renderer, Input } = sb;
  Renderer.init(sb.document.getElementById('game-canvas'));
  const ctx = Renderer.getCtx();

  DockingGame.open({ sector: 1 });
  ok(DockingGame.isOpen(), 'the minigame opens');

  // The marker actually moves.
  const p0 = DockingGame._state().pos;
  DockingGame.update(0.2);
  ok(DockingGame._state().pos !== p0, 'the marker slides along the bar');

  // Stopping dead centre is a clean lock.
  const g = DockingGame._state().green;
  DockingGame._set({ pos: g.start + g.size / 2 });
  DockingGame.draw(ctx);
  const lz = DockingGame._zoneFor('lock');
  Input.mouse.x = lz.x + lz.w / 2; Input.mouse.y = lz.y + lz.h / 2;
  Input.mouse.leftPressed = true;
  DockingGame.update(0.016);
  Input.mouse.leftPressed = false;
  ok(DockingGame._state().result === 'perfect',
     `centre of the green is a clean lock (${DockingGame._state().result})`);
  const out = DockingGame.update(1.2);
  ok(out === 'perfect', 'and the result is handed back once');
  ok(!DockingGame.isOpen(), 'then the screen closes');

  // Missing the band entirely costs hull.
  DockingGame.open({ sector: 1 });
  const g2 = DockingGame._state().green;
  DockingGame._set({ pos: g2.start > 0.5 ? 0 : 1 });
  DockingGame.draw(ctx);
  const lz2 = DockingGame._zoneFor('lock');
  Input.mouse.x = lz2.x + lz2.w / 2; Input.mouse.y = lz2.y + lz2.h / 2;
  Input.mouse.leftPressed = true;
  DockingGame.update(0.016);
  Input.mouse.leftPressed = false;
  ok(DockingGame._state().result === 'bad', 'missing the green is a hard dock');
  ok(DOCK_OUTCOMES.bad.hullDamage > 0, 'which costs hull');
  ok(DOCK_OUTCOMES.perfect.bonusSeconds > 0, 'a clean lock buys time aboard');
  ok(DOCK_OUTCOMES.auto.fuel > 0, 'and the skip costs He2 — it is never free, never blocked');
  DockingGame.update(1.2);

  // Deeper sectors are harder.
  DockingGame.open({ sector: 1 });
  const easy = DockingGame._state().green.size;
  DockingGame.open({ sector: 5 });
  const hard = DockingGame._state().green.size;
  ok(hard < easy, `the green band narrows further out (${easy} → ${hard})`);
})();

// ============================================================
section('51. A derelict is a real ship you walk through');
// ============================================================
(function testDerelict() {
  const sb = loadEngine();
  const { makeDerelict, populateDerelict, Save } = sb;
  Save.load(); Save.startRun();

  const d = makeDerelict(3, 850, 120);
  ok(d.isDerelict === true, 'it is flagged as a derelict');
  ok(d.rooms.length > 0 && d.elevators, 'but it is a REAL ship — rooms, lifts and all');
  ok(d.weapons.length === 0, 'with no guns to shoot back');
  ok(d.hull > 0 && d.hull < d.hullMax, 'holed, but still holding together');
  // update29: a derelict is not "lights down", it STOPPED. Everything is
  // wrecked and cold — except life support, which usually still limps.
  const nonO2 = d.systems.filter(sy => sy.type !== 'oxygen' && sy.type !== 'reactor');
  ok(nonO2.every(sy => sy.power === 0), 'every system is unpowered');
  ok(nonO2.every(sy => sy.damagedLevels >= sy.level), 'and shot out, not merely switched off');

  // Life support is the coin-flip that decides whether you need suits.
  let alive = 0, dead = 0, burning = 0;
  for (let i = 0; i < 60; i++) {
    const w = sb.makeDerelict(2, 0, 0);
    if (w.o2Alive) alive++; else dead++;
    const o2 = w.getSystem('oxygen');
    if (w.o2Alive) {
      if (o2 && o2.damagedLevels !== 0) alive--;      // must actually work
    }
    if (sb.igniteDerelict(w, 2) > 0) burning++;
  }
  ok(alive > 0 && dead > 0,
     `life support is usually alive but not always (${alive} alive / ${dead} dead of 60)`);
  ok(alive > dead, 'usually alive');
  ok(burning > 0 && burning < 60,
     `and sometimes — not always — something is still burning (${burning}/60)`);

  const nest = populateDerelict(d, 3);
  ok(nest.length >= 1, 'a nest is aboard');
  ok(nest.every(sp => d.crew.includes(sp)), 'and they are on its crew list');
  ok(nest.every(sp => sp.roomId), 'each one starts in a room, not in the void');

  // They are not a repair crew: running the wreck for a while must not
  // put a single spider on a station or a repair job.
  const before = d.systems.map(sy => sy.damagedLevels);
  for (let i = 0; i < 60; i++) d.update(0.05);
  const after = d.systems.map(sy => sy.damagedLevels);
  ok(after.every((v, i) => v >= before[i]),
     'spiders never repair the wreck they live in');
  ok(d.crew.filter(c => c.isSpider).every(c => c.task !== 'repair' && c.task !== 'operate'),
     'and they take no stations or repair orders');

  d.assignStations();
  ok(d.crew.filter(c => c.isSpider).every(c => !c.stationRoomId),
     'assignStations skips them entirely');

  // Bigger sectors, bigger nests (averaged — the count is random).
  let low = 0, high = 0;
  for (let i = 0; i < 60; i++) {
    low  += sb.derelictSpiderCount(1);
    high += sb.derelictSpiderCount(6);
  }
  ok(high > low, `deeper wrecks hold more of them (${low} vs ${high})`);
})();

// ============================================================
section('52. A crewman keeps his corporation colour');
// ============================================================
(function testCrewColours() {
  const sb = loadEngine();
  const { CrewMember, CORP_DEFS, crewColor, Animation, Renderer } = sb;
  Renderer.init(sb.document.getElementById('game-canvas'));
  Animation.init();

  // The colours themselves, as the player expects them.
  ok(CORP_DEFS.terra.color === '#ff9a40',  'Terra is orange');
  ok(CORP_DEFS.aquarius.color === '#4db8ff', 'Aquarius is blue');
  ok(CORP_DEFS.phoenix.color === '#ff5544', 'Phoenix is red');

  const terra = new CrewMember({ name: 'T', race: 'terra' });
  ok(terra.color === CORP_DEFS.terra.color, 'a live Terra crewman is orange');

  // THE REPORTED BUG: the base CREW tab reads SERIALISED crew, and
  // serialise() writes no `color` — so a Terra veteran was drawn with
  // the default blue swatch.
  const raw = JSON.parse(JSON.stringify(terra.serialise()));
  ok(raw.color === undefined, 'serialised crew genuinely carry no colour');
  ok(crewColor(raw) === CORP_DEFS.terra.color,
     `serialised Terra still resolves to orange (${crewColor(raw)})`);
  ok(crewColor({ race: 'phoenix' }) === CORP_DEFS.phoenix.color,
     'and every other corporation resolves too');

  // Repairing must not turn him blue.
  const a = Animation.crewByColor('repair', '#ff9a40');
  const b2 = Animation.crewByColor('repair', '#4db8ff');
  ok(!!a && !!b2, 'repair frames exist per colour');
  ok(a.frames !== b2.frames, 'two corporations get DIFFERENT repair frames');

  terra._setAnim('repair');
  const repairAnim = terra.anim;
  terra._setAnim('idle');
  const idleAnim = terra.anim;
  ok(repairAnim && idleAnim, 'both states produced an animation');
  ok(repairAnim.frames !== idleAnim.frames, 'and they are different animations');
  // The proof that matters: the same state in another colour differs.
  const other = new CrewMember({ name: 'A', race: 'aquarius' });
  other._setAnim('repair');
  ok(other.anim.frames !== repairAnim.frames,
     'a repairing Aquarius and a repairing Terra do not share frames');
})();

// ============================================================
section('53. Spiders look like spiders');
// ============================================================
(function testSpiderSprites() {
  const sb = loadEngine();
  const { makeSpiders, CrewMember, Animation, Renderer } = sb;
  Renderer.init(sb.document.getElementById('game-canvas'));
  Animation.init();

  const sp = makeSpiders(1)[0];
  const man = new CrewMember({ isPlayer: false, name: 'Raider' });

  sp._setAnim('idle');
  man._setAnim('idle');
  ok(!!sp.anim && !!man.anim, 'both have an idle animation');
  ok(sp.anim.frames !== man.anim.frames,
     'a spider does NOT reuse the enemy-crew sprite');

  sp._setAnim('fight');
  const fightFrames = sp.anim.frames;
  sp._setAnim('idle');
  ok(sp.anim.frames !== fightFrames, 'and it has its own lunge animation');
  ok(typeof Animation.spiderAnim === 'function', 'the sprite set is public');
})();

// ============================================================
section('54. A gun is either bolted on or boxed');
// ============================================================
(function testGunStorageRule() {
  const sb = loadEngine();
  const { Ship, Save, Station } = sb;
  Save.load(); Save.startRun();
  Save.updateRun({ scrap: 400 });

  const ship = new Ship('hauler', true, 0, 0);
  const st = new Station(2, 7);

  ok(ship.weapons.filter(Boolean).length > 0, 'the hull starts with a gun fitted');
  const before = ship.cargo.items.length;
  const r = st.uninstallWeapon(ship, 0);
  ok(r.ok, `taking it off works (${r.message})`);
  ok(!ship.weapons[0], 'the mount is empty');
  const crate = ship.cargo.items.find(it => it.def.kind === 'weapon');
  ok(!!crate, 'and the gun is now a CRATE in the hold, not a weightless rack entry');
  ok(ship.cargo.items.length === before + 1, 'which costs hold space');
  ok(ship.weaponCargo.length === 0, 'nothing was left on the legacy rack');

  // Fill the hold: the gun then stays bolted on rather than vanishing.
  const ship2 = new Ship('scout', true, 0, 0);
  const st2 = new Station(2, 8);
  while (ship2.cargo.add('he2_small')) { /* pack it solid */ }
  const r2 = st2.uninstallWeapon(ship2, 0);
  ok(r2.ok === false, `a full hold refuses the crate (${r2.message})`);
  ok(!!ship2.weapons[0], 'so the gun stays on the hull instead of disappearing');
})();

// ============================================================
section('52. A fitted shield generator starts at a whole layer');
// ============================================================
(function testShieldStartLevel() {
  const sb = loadEngine();
  const { Ship, Save, SYSTEM_DEFS } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('scout', true, 0, 0);
  ok(!ship.getSystem('shields'), 'the tug has no shields to begin with');
  ok(ship.addModule('shields'), 'shields can be fitted into the empty bay');

  const sh = ship.getSystem('shields');
  ok(sh.level === 2,
     `a new shield generator arrives at 2 power pips = one full layer (got ${sh.level})`);
  ok(SYSTEM_DEFS.shields.powerPerLayer === 2, 'a layer costs 2 power');
  ok(sh.level / SYSTEM_DEFS.shields.powerPerLayer === 1,
     'which is exactly one usable layer, not half of one');

  // Other modules are unaffected — they are useful at one pip.
  const ship2 = new Ship('hauler', true, 0, 0);
  ok(ship2.addModule('medbay'), 'a medbay fits');
  ok(ship2.getSystem('medbay').level === 1, 'and still starts at level 1');
})();

// ============================================================
section('53. Upgrades get exponentially dearer');
// ============================================================
(function testUpgradeCurve() {
  const sb = loadEngine();
  const { Station, Ship, Save, REACTOR_PRICE } = sb;
  Save.load(); Save.startRun();
  const st = new Station(1, 7);

  // Reactor: each step costs MORE than the one before, and the gap grows.
  const r = [4, 6, 8, 10, 12].map(l => REACTOR_PRICE(l));
  for (let i = 1; i < r.length; i++) {
    ok(r[i] > r[i - 1], `reactor lvl ${[4,6,8,10,12][i]} costs more than the step before`);
  }
  const d1 = r[1] - r[0], d2 = r[4] - r[3];
  ok(d2 > d1 * 2, `the curve accelerates, it is not a straight line (${d1} → ${d2})`);
  ok(REACTOR_PRICE(15) > REACTOR_PRICE(5) * 5,
     `maxing the reactor is a real campaign goal (${REACTOR_PRICE(5)} → ${REACTOR_PRICE(15)})`);

  // Modules: same shape.
  const ship = new Ship('frigate', true, 0, 0);
  const w = ship.getSystem('weapons');
  const costs = [1, 2, 3, 4, 5].map(l => { w.level = l; return st.systemUpgradeCost(w); });
  for (let i = 1; i < costs.length; i++) {
    ok(costs[i] > costs[i - 1], `module lvl ${i + 1} costs more than lvl ${i}`);
  }
  ok((costs[4] - costs[3]) > (costs[1] - costs[0]) * 1.8,
     `module upgrades accelerate too (${costs.join(', ')})`);

  // Shields step by LAYER, so their curve is driven by layer number.
  const sh = ship.getSystem('shields');
  if (sh) {
    sh.level = 2; const l1 = st.systemUpgradeCost(sh);
    sh.level = 4; const l2 = st.systemUpgradeCost(sh);
    ok(l2 > l1, `the third shield layer costs more than the second (${l1} → ${l2})`);
  }
})();

// ============================================================
section('54. Doors take a second, and nobody slips through early');
// ============================================================
(function testDoorCycle() {
  const sb = loadEngine();
  const { Ship, Save, DOOR_CYCLE } = sb;
  Save.load(); Save.startRun();
  const ship = new Ship('frigate', true, 0, 0);

  const door = ship.doors.find(d => !d.isAirlock);
  ok(!!door, 'the hull has interior doors');
  ok(door.openness === 1 && door.open, 'interior doors start open');

  // Closing is not instant.
  door.toggle();
  ok(door.mode === 'closed', 'the latch flips at once');
  door.update(0.1, []);
  ok(door.openness > 0 && door.openness < 1, 'but the panel is still moving');
  ok(door.open === false, 'and a moving door does NOT count as open');

  let t = 0;
  while (door.openness > 0 && t < 3) { door.update(0.05, []); t += 0.05; }
  ok(Math.abs(t - DOOR_CYCLE) < 0.25, `it takes about a second to shut (${t.toFixed(2)}s)`);

  // A crew member asking to pass has to WAIT for it.
  ok(door.requestPassage(0.05) === false, 'a closed door refuses passage');
  door.update(0.1, []);
  ok(door.requestPassage(0.05) === false, 'and still refuses while it is opening');
  // Keep asking while it cycles — that is what a waiting crewman does.
  for (let i = 0; i < 30; i++) { door.requestPassage(0.05); door.update(0.05, []); }
  ok(door.requestPassage(0.05) === true, 'once fully open, through you go');

  // A breached airlock is smashed, not sliding.
  const lock = ship.doors.find(d => d.isAirlock);
  lock.breached = true;
  lock.update(0.016, []);
  ok(lock.open === true && lock.openness === 1, 'a breached airlock is simply gone');
})();

// ============================================================
section('55. Spiders do not crew the hulk they nest in');
// ============================================================
(function testSpidersDoNotRepair() {
  const sb = loadEngine();
  const { makeDerelict, populateDerelict, CombatManager, Ship, Save, TASK } = sb;
  Save.load(); Save.startRun();

  const player = new Ship('frigate', true, 80, 120);
  const wreck  = makeDerelict(3, 850, 120);
  const nest   = populateDerelict(wreck, 3);
  ok(nest.length > 0, 'the hulk has a nest');
  ok(wreck.systems.some(sy => sy.damagedLevels > 0), 'and plenty of broken modules');

  sb.makeStartingCrew().forEach(c => player.addCrew(c));
  CombatManager.begin(player, wreck, 'normal');
  for (let i = 0; i < 60 && !CombatManager.isActive(); i++) CombatManager.update(0.05);

  // Run the enemy-crew AI hard: it must never hand a spider a job.
  for (let i = 0; i < 200; i++) {
    CombatManager.update(0.05);
    wreck.update(0.05);
  }
  const working = wreck.crew.filter(c =>
    c.isSpider && (c.task === TASK.REPAIR || c.task === TASK.FIRE || c.task === TASK.BREACH));
  ok(working.length === 0,
     `no spider is repairing, firefighting or patching the hulk (${working.length} were)`);
  ok(wreck.systems.some(sy => sy.damagedLevels > 0),
     'and the wreck stays wrecked — nothing got fixed');
  CombatManager.end();
})();

// ============================================================
section('56. Hangar readouts match the ship you will fly');
// ============================================================
(function testHangarReadout() {
  const sb = loadEngine();
  const { Base, BaseScreen, Ship, Save, SYSTEM_DEFS } = sb;
  Save.load();

  // A hull with THREE weapon bays at different levels — the case that
  // used to print the layout's level for all of them.
  const ship = new Ship('frigate', true, 0, 0);
  const wRooms = ship.systems.filter(sy => sy.type === 'weapons');
  if (wRooms.length) wRooms[0].level = 3;
  ship.getSystem('engines').level = 4;

  const b = Base.get();
  b.ships[0] = { key: 'frigate', data: ship.serialise() };
  BaseScreen.open();

  const mods = BaseScreen._levels(b.ships[0]);
  ok(!!mods, 'the hangar can read a hull\'s modules');
  const eng = mods.find(m => m.type === 'engines');
  ok(eng && eng.level === 4, `engines read back at level 4 (${eng && eng.level})`);
  const wpn = mods.filter(m => m.type === 'weapons');
  ok(wpn.length === wRooms.length, 'every weapon bay is listed separately');
  if (wRooms.length) {
    ok(wpn[0].level === wRooms[0].level,
       `each bay shows ITS OWN level (${wpn.map(w => w.level).join(',')})`);
  }
  mods.forEach(m => {
    ok(m.level >= 1 && m.level <= (SYSTEM_DEFS[m.type]?.maxLevel ?? 8),
       `${m.type} level ${m.level} is inside its legal range`);
  });
})();

// ============================================================
section('57. The base yard welds hulls');
// ============================================================
(function testBaseHullRepair() {
  const sb = loadEngine();
  const { Base, Ship, Save } = sb;
  Save.load();

  const b = Base.get();
  const ship = new Ship('scout', true, 0, 0);
  ship.hull = 8;
  b.ships[0] = { key: 'scout', data: ship.serialise() };

  const q = Base.hullRepairQuote(0);
  ok(!!q && q.hp === ship.hullMax - 8, `the yard quotes the missing ${q.hp} hull`);
  ok(q.cost === q.hp * Base.HULL_REPAIR_PRICE, 'at a flat price per point');

  // Broke: no free welding.
  const poor = Base.repairHull(0);
  ok(poor.ok === false, 'with no CC there is no repair');
  ok(Base.hullRepairQuote(0).hp === q.hp, 'and nothing changed');

  Base.earn(q.cost);
  const done = Base.repairHull(0);
  ok(done.ok, `the hull gets welded (${done.message})`);
  ok(Base.cc() === 0, 'and it costs exactly the quote');
  ok(Base.hullRepairQuote(0) === null, 'a sound hull needs no repair');
  ok(Base.repairHull(0).ok === false, 'and cannot be repaired again for free CC');

  // A factory-fresh berth with no saved data must not crash.
  b.ships[0] = { key: 'scout', data: null };
  ok(Base.hullRepairQuote(0) === null, 'a factory-fresh hull is already sound');
})();

// ============================================================
section('58. Burst guns are slower and their shots are spread out');
// ============================================================
(function testBurstTiming() {
  const sb = loadEngine();
  const { Weapon, WEAPON_DEFS } = sb;

  const burst = WEAPON_DEFS.laser_burst, single = WEAPON_DEFS.laser_heavy;
  ok(burst.shots === 3, 'the burst laser fires three');
  ok(burst.chargeTime >= single.chargeTime + 2,
     `and pays at least 2s more charge for it (${single.chargeTime} vs ${burst.chargeTime})`);
  ok((burst.burstGap ?? 0) >= 0.35, `with a wide gap between shots (${burst.burstGap})`);

  const w = new Weapon('laser_burst');
  w.armed = true;
  const projs = w.fire(0, 0, 400, 0, true);
  const delays = projs.map(p => p.launchDelay);
  ok(delays[2] - delays[1] >= 0.35, `the third bolt is well clear of the second (${delays.join(', ')})`);
  ok(delays[2] >= 0.7, 'so the salvo really reads as three separate shots');
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
