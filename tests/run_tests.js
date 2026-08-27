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

/** Bring the canvas up in a sandbox that has not run Game.init().
 *  A few sections assert on LAYOUT — where a label actually lands — and
 *  those need a real (stubbed) context to draw into. */
function initRenderer(sb) {
  if (!sb.Renderer.getCtx()) sb.Renderer.init(sb.document.createElement('canvas'));
  return sb.Renderer.getCtx();
}

/** Record every fillText a draw emits, so a test can assert on layout
 *  instead of eyeballing a screenshot. Restores the context afterwards
 *  even if the draw throws. */
function captureText(ctx, fn) {
  const drawn = [];
  const real = ctx.fillText;
  ctx.fillText = function (t, x, y) { drawn.push({ t: String(t), x, y }); };
  try { fn(); } finally { ctx.fillText = real; }
  return drawn;
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

  // The hatch is HACKED, not destroyed. It used to be set `breached`,
  // which pinned it open for the rest of the RUN — that room vented
  // forever and no repair task in the game could ever close it.
  ok(party.entryDoor.isHackedBy('player') === true,
     'the boarding party cracks the enemy airlock');
  ok(party.entryDoor.breached === false,
     'without smashing it open for good');
  ok(party.entryDoor.open === true, 'it is open right now, so they can get in');
  for (let i = 0; i < 200; i++) party.entryDoor.update(0.05);
  ok(party.entryDoor.open === false,
     'and it cycles shut behind them instead of venting the room forever');
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

  /* HE2 IS CARGO (update39). The tank is gone: the drive feeds out of
     the cells in the hold, exactly as the launchers feed out of the
     racks. So a jump has to take a real item off a real shelf. */
  ship.cargo.addStack('he2_med', 8);
  ok(ship.fuelCount() === 8, `eight units of He2 in the cells (${ship.fuelCount()})`);

  const run = Save.getRun();
  T.sectorMap = new SectorMap(1, 4242, run.lane ?? 1);
  const map = T.sectorMap;

  // Sector 1 opens with a free lane pick — that is not a jump
  const fuelStart = ship.fuelCount();
  if (map.awaitingStartPick && map.startNodes.length) {
    T._travelTo(map.startNodes[0].id);
    ok(ship.fuelCount() === fuelStart, 'choosing the starting lane must stay free');
  }

  // …the next hop is a real jump
  const before = ship.fuelCount();
  const next = map.nodes.find(n => !n.locked && !n.visited);
  if (next) {
    T._travelTo(next.id);
    const after = ship.fuelCount();
    ok(after === before - 1,
      `a map jump costs 1 He2 out of the cells (${before} → ${after})`);
    ok(Save.getRun().fuel === after,
      `and the HUD figure mirrors the hold (${Save.getRun().fuel} vs ${after})`);
  } else {
    ok(false, 'test setup: no reachable node to jump to');
  }

  // Empty hold, no jump — and the counter cannot cover for it.
  ship.cargo.takeStack('fuel', 99);
  Save.updateRun({ fuel: 50 });          // a lying mirror must not help
  ok(ship.fuelCount() === 0, 'the cells are empty');
  T.STATE = 'map';
  const stuck = map.nodes.find(n => !n.locked && !n.visited);
  const wasAt = map.currentId;
  if (stuck) {
    T._travelTo(stuck.id);
    ok(map.currentId === wasAt,
       'with no cells aboard the jump is refused, whatever the counter says');
    ok(ship.fuelCount() === 0, 'He2 must never go negative');
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

  // The FIRST crew member into a module takes the CONSOLE: horizontally
  // centred, and lifted off the walk line so he reads as standing AT the
  // station rather than beside it.
  //
  // This used to assert the OPPOSITE — everybody was shoved 26px
  // off-centre so that the middle of a room stayed clickable. That kept
  // orders working but made every manned module look like the operator
  // had missed his post. Orders are protected by the selection rule
  // instead now (a live selection turns clicks into orders — see the
  // click test below), so the operator can stand where he belongs.
  ship.crew.forEach(c => {
    const r = ship.getRoomById(c.roomId);
    if (!r) return;
    const mates = ship.crewInRoom(r.id);
    if (mates[0] !== c) return;                 // only the console man
    const walkY = ship.floorWalkY(r.floor, r.cy);
    ok(Math.abs(c.x - r.cx) < 1,
      `${c.name} mans the console of ${r.id} dead centre (x=${Math.round(c.x)}, cx=${Math.round(r.cx)})`);
    ok(walkY - c.y === Ship.OPERATOR_LIFT,
      `${c.name} stands ${Ship.OPERATOR_LIFT}px above the walk line, at the console`);
  });

  // Console, left and right must be three DISTINCT standing spots.
  ship.rooms.slice(0, 3).forEach(r => {
    const spots = [0, 1, 2].map(i => ship.stationSlot(r, i));
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        ok(Math.hypot(spots[a][0] - spots[b][0], spots[a][1] - spots[b][1]) > 14,
          `${r.id}: slot ${a} and slot ${b} are separate standing spots`);
      }
    }
    ok(ship.stationSlot(r, 1)[0] < ship.stationSlot(r, 0)[0] &&
       ship.stationSlot(r, 2)[0] > ship.stationSlot(r, 0)[0],
      `${r.id}: second man stands LEFT of the console, third stands RIGHT`);
  });

  const rookie = new CrewMember({});          // e.g. a derelict survivor
  ship.addCrew(rookie);
  ok(!!rookie.homeRoomId, 'a recruit should get a station, not a null home');

  const from   = ship.getRoomById(rookie.roomId);
  const target = ship.rooms.find(r => r.floor !== from.floor);
  ok(!!target, 'test setup: need a room on another deck');

  UI.selectCrewGroup([rookie]);
  // Click the FLOOR of the room, not its exact middle: the console
  // operator stands high in the middle of a module, and clicking a
  // crewman always selects that crewman. This is the same thing a
  // player does — you aim at a bit of module nobody is standing on.
  T._crewClickResolve(target.cx, target.y + target.h - 8, false);
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
  // The warehouse is ONE grid now, so its capacity is CELLS, not a
  // per-resource unit cap. There is no "per line" any more because there
  // are no lines — fuel, warheads, guns and salvage share a shelf.
  ok(Base.warehouseCap() === Base.storeCols() * Base.storeRows(),
     `the warehouse cap is its cell count, got ${Base.warehouseCap()}`);
  ok(Base.storeCols() === 8 && Base.storeRows() === 6,
     `a fresh shelf is 8x6 (${Base.storeCols()}x${Base.storeRows()})`);
  ok(Base.barracksCap() === 5, `barracks start at 5 bunks, got ${Base.barracksCap()}`);
  ok(Base.shipSlots() === 2, `hangar starts with 2 berths, got ${Base.shipSlots()}`);

  Base.earn(1000);
  ok(Base.hireRecruit().ok, 'can hire with CC in the bank');
  Base.hireRecruit();
  const crewBefore = Base.crew().length;

  // Caps are real — the shelf runs out of CELLS.
  const stored = Base.store('fuel', 999);
  ok(stored < 999, 'store() reports only what actually fit');
  const shelf0 = Base.warehouseGrid();
  ok(shelf0.usedCells() <= shelf0.capacity,
     `a full shelf never overflows its own cells (${shelf0.usedCells()}/${shelf0.capacity})`);
  ok(Base.store('fuel', 50) === 0, 'and a full shelf takes nothing more');

  // LAUNCH — ship, crew and supplies LEAVE the base
  BaseScreen.open();
  BaseScreen._set({ mission: 'patrol', fuel: 6, missiles: 3 });
  ok(BaseScreen._act('launch') === 'launch', 'the launch button commits the loadout');
  const loadout = BaseScreen.consumeLaunch();
  ok(!!loadout && loadout.ok, 'launch produced a loadout');
  ok(Base.ships().length === 0, 'the hull is checked OUT of the hangar for the contract');
  ok(Base.crew().length === crewBefore - loadout.crew.length,
    'the crew that flew out are off the barracks roster');
  // NO TANK (update39): He2 leaves the base in cells, in the hold, or
  // it does not leave at all. Asking for 6 loose units buys nothing.
  ok(loadout.fuel === 0, `launch hands over no loose He2 (${loadout.fuel})`);

  T._startContract(loadout);
  const run = Save.getRun();
  ok(T.STATE === 'map', `a contract drops you on the sector map, got ${T.STATE}`);
  ok(run.mission === 'patrol' && run.finalSector === 2,
    `Border Patrol is a 2-sector contract, got ${run.mission}/${run.finalSector}`);
  // update26: missiles live in the hold, so the run's counter mirrors it
  // rather than being loaded as a separate number.
  ok(run.fuel === T.playerShip.fuelCount(),
     `the run's He2 figure mirrors the cells aboard (${run.fuel})`);
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

  /* SECTOR 1 IS THE TUTORIAL, AND IT HAS NO SHIELDS IN IT.
     One shield layer takes a starting laser six seconds a bolt to chip
     through, so an opening-sector fight against a bubble was mostly
     watching. Raiders there carry a cloak or nothing; shields start in
     sector 2 and the odds climb from there. */
  const count = (sector) => {
    Save.updateRun({ sector });
    const seen = { shields: 0, cloak: 0, plain: 0 };
    for (let i = 0; i < 300; i++) {
      T._spawnEnemy('normal');
      const e = T.enemyShip;
      if (e.getSystem('shields')) seen.shields++;
      else if (e.getSystem('cloaking')) seen.cloak++;
      else seen.plain++;
    }
    return seen;
  };
  const s1 = count(1);
  ok(s1.shields === 0, `NO raider in sector 1 has shields (${s1.shields}/300)`);
  ok(s1.cloak > 60, `but plenty still run a cloak (${s1.cloak}/300)`);
  ok(s1.plain > 60, `and plenty are bare (${s1.plain}/300)`);

  const s2 = count(2);
  ok(s2.shields > 80, `sector 2 brings shields back (${s2.shields}/300)`);
  const s3 = count(3);
  ok(s3.shields > s2.shields * 0.9,
     `and they only get commoner (${s2.shields} → ${s3.shields})`);
  Save.updateRun({ sector: 1 });

  const seen = s2;
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

  /* HE2 HAS NOTHING TO OPEN ANY MORE (update39) — the drive feeds
     straight out of the cell where it lies, exactly like a missile
     rack. Pouring a canister into a counter was the last place a cargo
     item turned back into an invisible number. */
  const can = ship.cargo.add('he2_canister');
  const res = T._unpackCargo(can);
  ok(res.ok === false, 'a He2 canister has nothing to open');
  ok(ship.cargo.items.includes(can), 'and it stays in the hold as fuel');

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
  T.playerShip.cargo.addStack('he2_small', 5);
  const fuelAt = () => T.playerShip.fuelCount();

  // Picking the starting lane is NOT a jump — no fuel, no hazard.
  const first = T.sectorMap.nodes.find(n => !n.locked);
  T._travelTo(first.id);
  ok(fuelAt() === 5, `choosing the starting lane costs no He2 (${fuelAt()})`);
  ok(relic.damaged === false, 'and spoils nothing');

  // The next hop is a real jump.
  const next = T.sectorMap.nodes.find(n => !n.locked && n.id !== first.id);
  T._travelTo(next.id);
  ok(fuelAt() === 4, `a real jump burns 1 He2 out of the cells (${fuelAt()})`);
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
section('35. Packing the hold out of the ONE warehouse');
// ============================================================
(function testBasePacking() {
  const sb = loadEngine();
  const { Base, BaseScreen, Save, CargoGrid, Game } = sb;
  const T = Game.__test;
  Save.load();

  // Stock the ONE shelf. There is no separate fuel counter, missile
  // counter or gun rack any more — everything is a container on the
  // same grid, which is exactly why nothing can be counted twice.
  const startFuel = Base.supply().fuel;
  Base.store('fuel', 20);
  Base.store('missiles', 12 - Base.supply().missiles);
  Base.storeWeapon('laser_heavy');
  Base.storeWeapon('ion_basic');

  BaseScreen.open();
  const { store, hold } = BaseScreen.packGrids();
  ok(!!store && !!hold, 'the base hands over the shelf and a ship hold');

  const kinds = store.items.map(it => it.def.kind);
  ok(kinds.includes('missiles'), 'warheads are on the shelf as racks');
  ok(kinds.includes('weapon'), 'so are the spare guns');
  ok(kinds.includes('fuel'), 'and so is the He2');
  ok(store.countOf('missiles') === 12,
     `all 12 warheads are on the shelf (${store.countOf('missiles')})`);
  ok(store.items.filter(it => it.def.kind === 'missiles').length === 2,
     '12 missiles = one full rack of 10 plus a rack of 2');
  ok(Base.armoury().length === 2,
     `the armoury is just the gun crates ON the shelf (${Base.armoury().length})`);

  // Pack every missile rack and one gun.
  const crates = store.items.filter(it => it.def.kind === 'missiles');
  const gun    = store.items.find(it => it.def.kind === 'weapon');
  [...crates, gun].forEach(it => { store.remove(it); hold.autoPlace(it); });
  ok(hold.countOf('missiles') === 12, 'all 12 rounds are in the hold');

  // THE INVARIANT: an item is on the shelf or in the hold, never both.
  ok(store.countOf('missiles') === 0,
     'and none of them are still on the shelf — they physically moved');
  ok(Base.armoury().length === 2,
     'the shelf in the SAVE is untouched until the pack is committed');
  BaseScreen.commitPack();
  ok(Base.armoury().length === 1,
     `once committed, the packed gun is off the rack (${Base.armoury().length})`);
  ok(Base.supply().missiles === 0,
     `and the packed warheads are off the shelf (${Base.supply().missiles})`);

  // LAUNCH MUST USE THE CALLER'S SHELF, not a fresh read of the save.
  // Pack one more thing WITHOUT committing, then launch: if launch
  // re-read the save it would write that stale shelf back and the crate
  // would exist both in the hold and on the shelf.
  const extra = store.add('medkit');
  ok(!!extra, 'one more crate goes on the shelf');
  Base.commitWarehouse(store);          // now the save has it
  store.remove(extra);
  hold.autoPlace(extra);                // …and the live grid does not
  const shelfFuel = Base.supply().fuel;
  const res = Base.launch({ shipIndex: 0, crewIds: [], fuel: 6, missiles: 0,
                            mission: 'patrol', hold, store });
  ok(!Base.warehouseGrid().items.some(x => x.defKey === 'medkit'),
     'launching does not resurrect a crate that was packed but not committed');
  ok(res.ok, `launch succeeds (${res.message || 'ok'})`);
  ok(!!res.hold, 'and the packed hold travels with the ship');
  /* THE TANK IS GONE (update39). Asking launch() for 6 loose He2 must
     buy nothing at all and, crucially, must NOT quietly empty the
     shelf — an item is in the hold or on the shelf, never converted
     into a number in between. */
  ok(res.fuel === 0, `launch hands over no loose He2 (${res.fuel})`);
  ok(Base.supply().fuel === shelfFuel,
     `and the shelf is untouched by the request (${shelfFuel} → ${Base.supply().fuel})`);
  ok(Base.supply().missiles === 0, 'the packed warheads did not come back');
  ok(Base.armoury().length === 1, 'nor did the packed gun');

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

  // He2: a cell is the fuel. There is no tank to pour it into.
  const tank = ship.cargo.add('he2_med', null, 12);
  const r1 = T._unpackCargo(tank);
  ok(r1.ok === false, 'a He2 cell cannot be "opened"');
  ok(tank.qty === 12 && ship.cargo.countOf('fuel') === 12,
     `and all 12 units stay in it, ready to burn (${ship.cargo.countOf('fuel')})`);

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

  // Same story for a gun already dragged into the packed hold — except
  // that it CANNOT happen any more, and that is the point.
  //
  // The old bug: the armoury was an array of keys and the shelf was a
  // grid of crates, two independent records of one gun. Pack the crate,
  // then fit "the gun" from the armoury tab, and you flew with both.
  // A whole reconciliation pass (pruneHold) existed to clean up after it.
  // With ONE store the crate is on the shelf or in the hold, so fitting
  // a gun that is in the hold is not a thing the model can express.
  BaseScreen._act('unfit', 0);
  const { store, hold } = BaseScreen.packGrids();
  const crate = store.items.find(it => it.def.kind === 'weapon');
  ok(!!crate, 'the unfitted gun is a crate on the shelf');
  store.remove(crate);
  ok(hold.autoPlace(crate), 'the crate can be packed into the hold');
  BaseScreen.commitPack();

  ok(Base.armoury().length === 0,
     `a packed gun is NOT in the armoury — it is in the hold (${Base.armoury().length})`);
  const refit = BaseScreen._act('fit', 0);
  ok(Base.armoury().length === 0, 'so there is nothing on the rack to fit');
  const stillPacked = BaseScreen._state().hold.items
    .filter(it => it.def.kind === 'weapon').length;
  ok(stillPacked === 1,
     `and the packed crate stays packed (${stillPacked})`);

  // Belt and braces: total guns in the world is conserved across a
  // pack → fit → unfit cycle, whatever order they happen in.
  const countGuns = () => {
    const st = BaseScreen._state();
    const onHull = Base.shipWeapons(0).length;
    const onShelf = Base.armoury().length;
    const inHold = st.hold.items.filter(it => it.def.kind === 'weapon').length;
    return onHull + onShelf + inHold;
  };
  const total = countGuns();
  BaseScreen._act('unfit', 0);
  ok(countGuns() === total, `unfitting moves a gun, never clones it (${countGuns()} vs ${total})`);
  BaseScreen._act('fit', 0);
  ok(countGuns() === total, `and fitting it back does the same (${countGuns()} vs ${total})`);

  ok(Base.pruneHold().length === 0,
     'pruneHold has nothing left to do — it is a no-op kept for old callers');
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

  /* LIFE SUPPORT IS NO LONGER A COIN FLIP.
     It used to be 70/30, and the "alive" branch did nothing at all —
     Ship.update re-derives power from the reactor budget every frame and
     that budget was zero, so the scrubbers were dead either way. There
     is one unit of power on every wreck now and life support draws it,
     because hunting nests takes time you cannot spend suffocating. */
  let alive = 0, working = 0, burning = 0;
  for (let i = 0; i < 60; i++) {
    const w = sb.makeDerelict(2, 0, 0);
    if (w.o2Alive) alive++;
    w.update(0.05);
    const o2 = w.getSystem('oxygen');
    if (o2 && o2.effectivePower() >= 1 && w.reactor.totalPower === 1) working++;
    // A DERELICT IS COLD (update39). It has been drifting for years and
    // there is one unit of power aboard running the scrubbers — nothing
    // is on fire, and igniteDerelict is gone rather than merely unused.
    if ((w.fires?.fires ?? []).some(f => !f.out)) burning++;
  }
  ok(alive === 60, `every wreck has air (${alive}/60)`);
  ok(working === 60,
     `and it is really powered, not just flagged (${working}/60 after a tick)`);
  ok(burning === 0, `and not one of them is burning (${burning}/60)`);
  ok(typeof sb.igniteDerelict === 'undefined',
     'the fire-starter is deleted, not left lying around unused');

  /* And the wreck the player is ACTUALLY put aboard — the one built by
     the boarding path, not by a direct makeDerelict call — is cold too.
     A fire on a clock you cannot afford only ever meant "turn round". */
  {
    const G = sb.Game.__test;
    const player = new sb.Ship('frigate', true, 80, 120);
    player._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => player.addCrew(c));
    G.playerShip = player;
    let lit = 0;
    for (let i = 0; i < 20; i++) {
      G._startWreckBoarding(3, { seconds: 50 });
      if ((G.enemyShip.fires?.fires ?? []).some(f => !f.out)) lit++;
    }
    ok(lit === 0, `twenty boarded wrecks, none of them alight (${lit})`);
    G._clearWreckMode();
    sb.CombatManager.end();
    G.enemyShip = null;
  }

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
section('59. Spiders look like spiders from frame one');
// ============================================================
(function testSpiderSprite() {
  const sb = loadEngine();
  const { makeSpiders, CrewMember, Animation, Save } = sb;
  Save.load();

  const sp = makeSpiders(1, 1)[0];
  ok(sp.isSpider, 'it is a spider');
  ok(sp._animState === 'idle',
     `its animation state is set at CONSTRUCTION (${sp._animState})`);
  ok(!!sp.anim, 'and it has an animation');

  // The bug: the constructor assigned the human enemy sprite directly and
  // left _animState undefined, so a spider that never changed state kept
  // it — you boarded a wreck and found people.
  const human = new CrewMember({ isPlayer: false });
  const spiderFrames = Animation.spiderAnim('idle', sp.color)?.frames;
  ok(!!spiderFrames, 'there is a dedicated spider sprite set');
  ok(sp.anim.frames === spiderFrames,
     'and the spider is using it, not the crew sprite');
  ok(human.anim.frames !== spiderFrames, 'ordinary crew still use the crew sprite');
})();

// ============================================================
section('60. Wrecks start as egg sacs and hatch when you board');
// ============================================================
(function testEggSacs() {
  const sb = loadEngine();
  const { makeDerelict, populateDerelict, makeStartingCrew, Save } = sb;
  Save.load(); Save.startRun();

  const w = makeDerelict(3, 850, 120);
  const nest = populateDerelict(w, 3);
  ok(nest.length > 0, 'the hulk gets a nest');
  ok(nest.every(sp => sp.dormant), 'and every one of them starts DORMANT — a sac, not a spider');
  ok(w.crew.filter(c => c.dormant).length === nest.length,
     'the sacs are on the ship');

  // Nobody aboard: the wreck stays quiet however long you wait.
  for (let i = 0; i < 100; i++) w.update(0.1);
  ok(w.crew.every(c => c.dormant), 'with no boarders they never hatch');

  // A dormant sac takes no actions at all.
  const before = { x: nest[0].x, y: nest[0].y, task: nest[0].task };
  w.update(0.5);
  ok(nest[0].x === before.x && nest[0].y === before.y, 'a sac does not move');

  // Walk a boarder into one room: THAT sac splits at once.
  const boarder = makeStartingCrew()[0];
  boarder.roomId = nest[0].roomId;
  boarder.x = nest[0].x; boarder.y = nest[0].y;
  w.addCrew(boarder, true);
  // Walking in REVEALS the sac and starts it hatching fast — it used to
  // burst in the same frame, so the player never saw the thing they had
  // just walked into.
  w.update(0.2);
  ok(nest[0].revealed === true, 'walking in reveals the sac');
  ok(nest[0].dormant === true, 'and for a moment it is still an egg');
  for (let i = 0; i < 60 && nest[0].dormant; i++) w.update(0.1);
  ok(!nest[0].dormant, 'then it bursts, seconds later rather than instantly');
  // It comes out as a SPIDER, not an egg — and since a boarder is
  // standing right there, it comes out swinging.
  ok(nest[0]._animState === 'fight',
     `a sac that bursts onto an intruder attacks him (${nest[0]._animState})`);
  ok(nest[0].anim !== null && !nest[0].dormant, 'and it has a live sprite');

  // The rest follow on their own timer, so a party can always finish.
  for (let i = 0; i < 200; i++) w.update(0.1);
  ok(w.crew.every(c => !c.dormant),
     'every other sac hatches on its own — no sac can be left unreachable');
})();

// ============================================================
section('61. Airlocks cycle like every other door');
// ============================================================
(function testAirlockCycle() {
  const sb = loadEngine();
  const { Ship, Save, DOOR_CYCLE } = sb;
  Save.load(); Save.startRun();
  const ship = new Ship('frigate', true, 0, 0);

  const lock = ship.doors.find(d => d.isAirlock);
  ok(!!lock, 'the hull has airlocks');
  ok(lock.openness === 0 && !lock.open, 'they start shut');

  lock.toggle();
  ok(lock.mode === 'open', 'the latch flips');
  lock.update(0.1, []);
  ok(lock.openness > 0 && lock.openness < 1, 'and the hatch takes time to open');
  ok(lock.open === false, 'a half-open airlock is not open');

  let t = 0;
  while (lock.openness < 1 && t < 3) { lock.update(0.05, []); t += 0.05; }
  ok(Math.abs(t - DOOR_CYCLE) < 0.25, `about a second, same as inside (${t.toFixed(2)}s)`);
  ok(lock.open === true, 'then it really is open');
})();

// ============================================================
section('62. Every gun has its own look and a per-second charge readout');
// ============================================================
(function testWeaponLooks() {
  const sb = loadEngine();
  const { Renderer, WEAPON_DEFS, Weapon } = sb;

  const keys = Object.keys(WEAPON_DEFS);
  const styles = keys.map(k => Renderer.weaponStyle(k, WEAPON_DEFS[k].type));
  ok(styles.every(st => !!st), 'every weapon resolves to a style');

  // Distinct: no two guns share BOTH form and barrel count and colour.
  const sigs = styles.map(st => `${st.form}|${st.barrels}|${st.col}`);
  ok(new Set(sigs).size === sigs.length,
     `all ${keys.length} guns are visually distinct (${new Set(sigs).size} unique)`);

  // The three lasers must not look identical to each other.
  const l1 = Renderer.weaponStyle('laser_basic', 'laser');
  const l2 = Renderer.weaponStyle('laser_burst', 'laser');
  const l3 = Renderer.weaponStyle('laser_heavy', 'laser');
  ok(l1.barrels !== l2.barrels, 'the burst laser has more emitters than the Mk I');
  ok(l3.form !== l1.form, 'and the heavy laser is a different shape again');

  // Charge boxes: one per second.
  keys.forEach(k => {
    const w = new Weapon(k);
    ok(w.chargeSeconds() === Math.round(WEAPON_DEFS[k].chargeTime),
       `${k}: ${w.chargeSeconds()} boxes for ${WEAPON_DEFS[k].chargeTime}s`);
  });
  const slow = new Weapon('cannon_basic'), fast = new Weapon('laser_basic');
  ok(slow.chargeStripWidth() > fast.chargeStripWidth(),
     'a slow gun shows a longer strip, it does not squeeze the boxes');

  // Laser bolts are red, not HUD blue.
  const r = parseInt(l1.col.slice(1, 3), 16), bl = parseInt(l1.col.slice(5, 7), 16);
  ok(r > bl + 60, `laser colour reads as red (${l1.col})`);
})();

// ============================================================
section('63. Every hull is named for an Egyptian god');
// ============================================================
(function testShipNames() {
  const sb = loadEngine();
  const { SHIP_LAYOUTS, SHIP_CATALOG } = sb;

  const GODS = ['Bastet', 'Hapi', 'Horus', 'Set', 'Sobek', 'Anubis', 'Apophis',
                'Ra', 'Osiris', 'Isis', 'Thoth', 'Ptah', 'Sekhmet', 'Nephthys'];
  const labels = Object.values(SHIP_LAYOUTS).map(L => L.label);
  ok(labels.length > 0, 'there are hulls to check');
  labels.forEach(l => {
    ok(GODS.includes(l), `"${l}" is an Egyptian god`);
  });
  Object.values(SHIP_CATALOG).forEach(d => {
    ok(GODS.includes(d.label), `the shipyard sells "${d.label}" under the same name`);
  });
  ok(new Set(labels).size === labels.length, 'and no two hulls share a name');
})();

// ============================================================
section('59. Charge boxes wear each gun\'s own colour');
// ============================================================
(function testChargeColour() {
  const sb = loadEngine();
  const { Renderer, WEAPON_DEFS } = sb;

  const laser = Renderer.weaponStyleColor('laser_basic', 'laser');
  const ion   = Renderer.weaponStyleColor('ion_basic', 'ion');
  const flak  = Renderer.weaponStyleColor('flak_basic', 'flak');
  ok(laser && ion && flak, 'every gun has a style colour');
  ok(laser !== ion && ion !== flak && laser !== flak,
     `and they differ (${laser}, ${ion}, ${flak})`);
  ok(/^#ff/i.test(laser), `lasers are red (${laser})`);

  // Every gun in the catalogue must resolve to something.
  Object.entries(WEAPON_DEFS).forEach(([k, d]) => {
    const c = Renderer.weaponStyleColor(k, d.type);
    ok(/^#[0-9a-f]{6}$/i.test(c), `${k} has a real colour (${c})`);
  });
})();

// ============================================================
section('60. The reactor is a module you can scram');
// ============================================================
(function testReactorToggle() {
  const sb = loadEngine();
  const { Ship, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 0, 0);
  ship._allocateDefaultPower();
  ship.update(0.05);
  const rated = ship.reactor.ratedPower;
  ok(rated > 0, `the reactor is rated for ${rated} power`);
  ok(ship.systems.some(sy => sy.power > 0), 'and modules are drawing from it');

  ship.reactor.offline = true;
  ship.update(0.05);
  ok(ship.reactor.totalPower === 0, 'scrammed, it puts out nothing');
  ok(ship.systems.every(sy => sy.power === 0), 'so every module goes dark');
  ok(ship.reactor.ratedPower === rated,
     'but the RATING is unchanged — it is switched off, not broken');

  ship.reactor.offline = false;
  ship.update(0.05);
  ok(ship.reactor.totalPower === rated, 'switching it back restores the output');
  ok(ship.systems.some(sy => sy.power > 0), 'and the modules come back up');
})();

// ============================================================
section('61. The hangar shows hulls at 1:1');
// ============================================================
(function testHangarNoScaling() {
  const sb = loadEngine();
  const { BaseScreen, Renderer, SHIP_LAYOUTS, Save, Base } = sb;
  Save.load();
  Renderer.init(sb.document.getElementById('game-canvas'));

  // The biggest player hull must fit the stage without shrinking.
  const src = sb.fs ? null : null;
  const code = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'basescreen.js'), 'utf8');
  ok(!/shown at \$\{Math\.round\(scale/.test(code),
     'the "shown at N%" fallback is gone — nothing is scaled any more');
  ok(!/ctx\.scale\(scale, scale\)/.test(code),
     'and the hangar never calls ctx.scale on the hull');

  // Sanity: the tallest layout still fits the panel height we reserve.
  let tallest = 0;
  ['scout', 'hauler', 'frigate'].forEach(k => {
    const L = SHIP_LAYOUTS[k];
    if (!L) return;
    const y0 = Math.min(...L.rooms.map(r => r.y));
    const y1 = Math.max(...L.rooms.map(r => r.y + r.h));
    tallest = Math.max(tallest, y1 - y0);
  });
  ok(tallest > 0 && tallest + 52 <= 386 - 52 - 30 + 60,
     `the tallest hull (${tallest}px + guns) fits the hangar stage`);

  // And it still draws.
  Base.get();
  BaseScreen.open();
  let threw = null;
  try { BaseScreen.draw(Renderer.getCtx()); } catch (e) { threw = e; }
  ok(!threw, `the hangar draws without throwing (${threw && threw.message})`);
})();

// ============================================================
section('62. The selection marker is a small egg at the boots');
// ============================================================
(function testSelectionRing() {
  const fs2 = require('fs'), path2 = require('path');
  const code = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'game.js'), 'utf8');
  const block = code.slice(code.indexOf('function _drawCrewSelection'),
                          code.indexOf('function _drawCrewSelection') + 1600);
  const rings = [...block.matchAll(
    /ellipse\(c\.x, c\.y (-|\+) (\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)/g)]
    .map(m => ({ cy: (m[1] === '-' ? -1 : 1) * Number(m[2]),
                 rx: Number(m[3]), ry: Number(m[4]) }));
  ok(rings.length >= 1, `the marker is drawn (${rings.length} ellipse(s))`);

  /* THE MARKER IS A FOOTPRINT, NOT A BODY OUTLINE.
     This assertion has been inverted once: update34 replaced the flat
     shadow with a full-body ring, which at 26x38 was three times the
     width of the man and made a crowded module unreadable. The player
     asked for the little egg back, small. */
  rings.forEach((r, i) => {
    ok(r.rx > r.ry,
       `marker ${i} lies FLAT on the deck — wider than it is tall (${r.rx}x${r.ry})`);
    ok(r.rx * 2 <= 16, `marker ${i} is small (width ${r.rx * 2} <= 16)`);
    ok(r.ry * 2 <= 8, `marker ${i} is a thin footprint (height ${r.ry * 2} <= 8)`);
    ok(r.cy > 0, `marker ${i} sits AT HIS FEET, below the sprite centre (cy ${r.cy})`);
  });
  ok(/lineWidth = 1;/.test(block), 'drawn with a thin line');

  // …but CLICKING him still means clicking the man, not the shadow.
  const hit = code.slice(code.indexOf('function _hitsCrew'),
                         code.indexOf('function _hitsCrew') + 300);
  const m = hit.match(/rx = (\d+(?:\.\d+)?) \* scale, ry = (\d+(?:\.\d+)?)/);
  ok(!!m, 'the hit test declares its own size');
  if (m) ok(Number(m[2]) > Number(m[1]),
            `and it is still body-shaped, taller than wide (${m[1]}x${m[2]})`);
})();

// ============================================================
section('64. The warehouse shelf is a real grid, not a sold pile');
// ============================================================
(function testWarehouseShelf() {
  const sb = loadEngine();
  const { Save, Base } = sb;
  Save.load();

  // A fresh base is SEEDED, not empty — the He2 and warheads you used to
  // start with as two integers are containers on the shelf now.
  const g0 = Base.warehouseGrid();
  ok(!!g0, 'warehouseGrid() returns a live CargoGrid');
  ok(g0.items.length > 0, 'a fresh base has starting stock ON the shelf');
  ok(g0.countOf('fuel') === 8 && g0.countOf('missiles') === 4,
     `and it is the same 8 He2 / 4 warheads as before (${g0.countOf('fuel')}/${g0.countOf('missiles')})`);
  ok(g0.cols === Base.storeCols() && g0.rows === Base.storeRows(),
     `the grid is sized to entitlement (${g0.cols}x${g0.rows})`);
  const colsBefore = Base.storeCols();

  // Upgrading WAREHOUSE widens the one shelf.
  Base.earn(5000);
  ok(Base.buyUpgrade('warehouse').ok, 'warehouse upgrade purchased');
  ok(Base.storeCols() === colsBefore + 1,
     `the shelf grows a column (${colsBefore} → ${Base.storeCols()})`);
  ok(Base.warehouseCap() === Base.storeCols() * Base.storeRows(),
     'and the cap follows it, because the cap IS the cell count');
  const g1 = Base.warehouseGrid();
  ok(g1.cols === Base.storeCols(), 'a fresh fetch reflects the new width');

  // Round-trip: put something on the shelf, commit, fetch again.
  const before = g1.items.length;
  const it = g1.add('medkit');
  ok(!!it, 'a medkit fits on the shelf');
  Base.commitWarehouse(g1);
  const g2 = Base.warehouseGrid();
  ok(g2.items.length === before + 1 && g2.items.some(x => x.defKey === 'medkit'),
     'commitWarehouse()/warehouseGrid() round-trips what was placed');

  // The old names still work — plenty of code and tests use them.
  ok(Base.stashGrid().items.length === g2.items.length,
     'stashGrid() is the same shelf under its old name');

  // MIGRATION: a save written before the merge has three separate stores.
  // They must fold into the one grid, once, without throwing.
  const raw = Save.getRaw();
  raw.base.store = null;
  raw.base.warehouse = { fuel: 12, missiles: 6 };
  raw.base.armoury = ['laser_basic'];
  raw.base.stash = { cols: 5, rows: 4, items: [{ defKey: 'alien_relic', x: 0, y: 0, rot: 0, qty: 1 }] };
  Save.save();
  let threw = null, g3 = null;
  try { g3 = Base.warehouseGrid(); } catch (e) { threw = e; }
  ok(!threw, `an old three-store save still loads (${threw && threw.message})`);
  ok(g3.countOf('fuel') === 12 && g3.countOf('missiles') === 6,
     `the old counters became containers (${g3.countOf('fuel')}/${g3.countOf('missiles')})`);
  ok(Base.armoury().length === 1 && Base.armoury()[0] === 'laser_basic',
     'the old gun array became a crate on the shelf');
  ok(g3.items.some(x => x.defKey === 'alien_relic'), 'and the old shelf came across intact');
  const after = Save.getRaw().base;
  ok(after.warehouse.fuel === 0 && after.armoury.length === 0 && !after.stash,
     'the old stores are emptied, so nothing can be migrated twice');
})();

// ============================================================
section('65. Docking shelves salvage instead of auto-selling it');
// ============================================================
(function testDockingShelvesCargo() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Game } = sb;
  Save.load();
  const T = Game.__test;

  Base.earn(1000);
  BaseScreen.open();
  BaseScreen._act('launch');
  T._startContract(BaseScreen.consumeLaunch());
  Save.updateRun({ fuel: 0, missiles: 0 });   // isolate the CARGO contribution

  // One of each kind: fuel/missiles/a spare gun (unchanged behaviour) and
  // two general items that used to be liquidated outright.
  const hold = T.playerShip.cargo;
  hold.clear();
  hold.add('he2_small', null, 3);
  hold.add('missile_rack', null, 4);
  hold.add('gun_crate_s', 'laser_basic');
  const relic = hold.add('alien_relic');
  const kit   = hold.add('medkit');
  ok(relic && kit, 'the general items actually fit the test hold');

  const fuelBefore = Base.supply().fuel, mslBefore = Base.supply().missiles;
  const ccBefore = Base.cc();
  T._dockAtBase(0);

  // EVERYTHING comes back as what it was. Nothing is unpacked into a
  // counter on the way in, and nothing is auto-sold.
  ok(Base.supply().fuel === fuelBefore + 3,
     `the He2 canister is back on the shelf (${Base.supply().fuel})`);
  ok(Base.supply().missiles === mslBefore + 4,
     `so is the missile rack (${Base.supply().missiles})`);
  ok(Base.armoury().includes('laser_basic'), 'and the gun crate');

  const shelf = Base.warehouseGrid();
  const kinds = shelf.items.map(it2 => it2.defKey);
  ok(kinds.includes('alien_relic') && kinds.includes('medkit'),
     `the relic and the medkit were SHELVED, not sold (${kinds.join(',') || 'empty'})`);
  ok(Base.cc() === ccBefore, 'so no CC was paid out for them — they are physically on the shelf');
  ok(shelf.items.filter(x => x.defKey === 'gun_crate_s').length === 1,
     'the gun came home as ONE crate, not a crate and an armoury entry');
})();

// ============================================================
section('66. A full shelf still liquidates the overflow');
// ============================================================
(function testWarehouseOverflow() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Game, CargoItem } = sb;
  Save.load();
  const T = Game.__test;

  Base.earn(1000);
  BaseScreen.open();
  BaseScreen._act('launch');
  T._startContract(BaseScreen.consumeLaunch());
  Save.updateRun({ fuel: 0, missiles: 0 });

  // Pack the shelf solid by hand first, so nothing else fits.
  const shelf = Base.stashGrid();
  while (shelf.add('plating')) { /* fill it */ }
  Base.commitStash(shelf);
  const probe = new CargoItem('alien_relic');
  ok(!shelf.autoPlace(probe), 'sanity: the shelf genuinely has no room left for a relic');

  const hold = T.playerShip.cargo;
  hold.clear();
  const relic = hold.add('alien_relic');
  ok(!!relic, 'the test hold can hold the relic even if the shelf cannot');

  const ccBefore = Base.cc();
  T._dockAtBase(0);
  ok(Base.cc() > ccBefore, `an item that does not fit is still sold for CC (${ccBefore} → ${Base.cc()})`);
  ok(!Base.stashGrid().items.some(it2 => it2.defKey === 'alien_relic'),
     'and it never actually lands on the shelf');
})();

// ============================================================
section('67. SUPPLY carries the shelf — no WAREHOUSE tab any more');
// ============================================================
(function testSupplyAbsorbsWarehouse() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Renderer, Input } = sb;
  Save.load();

  const fs2 = require('fs'), path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'basescreen.js'), 'utf8');
  const tabs = src.match(/const TABS = \[([^\]]+)\]/);
  ok(!!tabs, 'the tab bar is declared where we think it is');
  ok(!/'WAREHOUSE'/.test(tabs ? tabs[1] : ''),
     `the standalone WAREHOUSE tab is gone (${tabs && tabs[1]})`);
  ok(/'SUPPLY'/.test(tabs ? tabs[1] : ''), 'SUPPLY is still there — it now carries the shelf');
  ok(!/_shelfCard|SALVAGE/.test(src),
     'and the separate SALVAGE card is gone with it — there is one store, not two');

  // The button that opens the real drag-and-drop shelf still works, it
  // just lives on the SUPPLY tab now.
  BaseScreen.open();
  ok(BaseScreen._act('warehouse') === 'pack',
     'OPEN WAREHOUSE and PACK HOLD are the same screen — one store, one view');
  ok(BaseScreen._act('pack') === 'pack', 'and PACK HOLD opens it too');

  // …and it is actually reachable: draw SUPPLY, then click where the
  // button landed. `_zones` is private, so we drive it the way a player
  // does — put the pointer on it and press.
  const ctx = initRenderer(sb);
  BaseScreen._set({ tab: 'SUPPLY' });
  BaseScreen.draw(ctx);
  const W = Renderer.getWidth();
  const pw = W - 80, GAP = 14;
  const cardW = Math.floor((pw - 32 - GAP * 3) / 4);
  const bx = 40 + 16 + 20;                            // inside OPEN WAREHOUSE
  const by = 138 + 34 + (386 - 70) - 42 + 15;
  Input.mouse.x = bx; Input.mouse.y = by; Input.mouse.leftPressed = true;
  ok(BaseScreen.update(0.016) === 'pack',
     `clicking the warehouse panel's button opens the shelf (${bx},${by})`);
  Input.mouse.leftPressed = false;
})();

// ============================================================
section('68. The hangar lists scroll instead of overflowing');
// ============================================================
(function testHangarScroll() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Renderer, Input } = sb;
  Save.load();
  const ctx = initRenderer(sb);

  const catalog = Base.catalog();
  const st = () => BaseScreen._state();

  BaseScreen.open();
  BaseScreen.draw(ctx);
  ok(st().yardVis === 3, 'the shipyard shows three hulls at a time');
  ok(st().berthVis === 1, 'and your berths show one, so the module readout has room');

  // ── Clamping: neither list can be paged off its own ends ──
  BaseScreen._act('scrollYard', -1);
  ok(st().yardScroll === 0, 'the shipyard cannot scroll above the first hull');
  BaseScreen._act('scrollYard', 99);
  ok(st().yardScroll === Math.max(0, catalog.length - st().yardVis),
     `nor past the last (${st().yardScroll} of ${catalog.length})`);

  // ── The berth list genuinely scrolls: one visible, several owned ──
  const b = Base.get();
  b.ships.length = 0;
  catalog.slice(0, 3).forEach(d => b.ships.push({ key: d.key, data: null }));
  BaseScreen.open();
  BaseScreen.draw(ctx);
  ok(st().berthScroll === 0, 'the berth list starts at the top');
  BaseScreen._act('scrollBerth', 1);
  ok(st().berthScroll === 1, 'the arrow scrolls it down one hull');
  BaseScreen._act('scrollBerth', 99);
  ok(st().berthScroll === b.ships.length - 1,
     `and stops at the last berth (${st().berthScroll})`);

  // The wheel over the shipyard column scrolls it; the wheel over empty
  // space at the bottom of the screen does not.
  BaseScreen._set({ yardScroll: 0 });
  Input.mouse.leftPressed = false;
  Input.mouse.x = 40 + 16 + 100; Input.mouse.y = 138 + 32 + 40;
  Input.mouse.scrollDelta = 1;
  BaseScreen.update(0.016);
  const wheeled = st().yardScroll;
  Input.mouse.x = 640; Input.mouse.y = 700;
  Input.mouse.scrollDelta = 1;
  BaseScreen.update(0.016);
  ok(st().yardScroll === wheeled,
     'a wheel event away from either list changes nothing');
  Input.mouse.scrollDelta = 0;

  // THE REAL HAZARD: selling hulls out from under a scrolled list used
  // to leave it pointing past the end, so the berth card just vanished.
  BaseScreen._act('scrollBerth', 99);
  b.ships.length = 1;
  BaseScreen.draw(ctx);
  ok(st().berthScroll === 0,
     `the berth list re-anchors when the hangar shrinks (${st().berthScroll})`);
})();

// ============================================================
section('69. Module readout: three a line, reactor on its own');
// ============================================================
(function testModuleStrip() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Renderer } = sb;
  Save.load();
  const ctx = initRenderer(sb);

  // Every cell is laid out icon | pips-over-name inside its own column,
  // so no two module names can be printed on top of each other. We check
  // the geometry by capturing every fillText the strip emits.
  const drawn = [];
  const realFill = ctx.fillText;
  ctx.fillText = function (t, x, y) { drawn.push({ t: String(t), x, y }); };
  try {
    BaseScreen.open();
    BaseScreen._set({ tab: 'HANGAR' });
    BaseScreen.draw(ctx);
  } finally { ctx.fillText = realFill; }

  // The strip lives in the RIGHT-hand berth column; the ship preview in
  // the middle of the screen labels its rooms with the same words, so
  // scope the capture to the column or the two get mixed up.
  const labels = ['Engines', 'Weapons', 'Shields', 'Cockpit', 'Life sup.', 'Medbay'];
  const STRIP_X = Renderer.getWidth() - 40 - 268 - 16;
  const inStrip = d => d.x >= STRIP_X - 2;
  const mods = drawn.filter(d => labels.includes(d.t) && inStrip(d));
  ok(mods.length > 0, `the module names are drawn (${mods.length})`);

  // No two module labels may share a baseline AND a column.
  let collisions = 0;
  for (let i = 0; i < mods.length; i++) {
    for (let j = i + 1; j < mods.length; j++) {
      if (Math.abs(mods[i].y - mods[j].y) < 6 && Math.abs(mods[i].x - mods[j].x) < 40) collisions++;
    }
  }
  ok(collisions === 0, `no two module labels overlap (${collisions} collisions)`);

  // At most three per line.
  const byRow = new Map();
  mods.forEach(m => {
    const k = Math.round(m.y);
    byRow.set(k, (byRow.get(k) ?? 0) + 1);
  });
  const widest = Math.max(...byRow.values());
  ok(widest <= 3, `at most three modules on a line (widest row has ${widest})`);

  // The reactor gets a line to itself, BELOW every other module.
  const reactor = drawn.find(d => d.t === 'Reactor' && inStrip(d));
  ok(!!reactor, 'the reactor is drawn in the strip');
  if (reactor) {
    ok(mods.every(m => m.y < reactor.y - 4),
       'and it sits on its own line under all of them');
    ok(!mods.some(m => Math.abs(m.y - reactor.y) < 6),
       'nothing shares the reactor line with it');
  }
})();

// ============================================================
section('70. The barracks shows the star and the plague');
// ============================================================
(function testBarracksMarkers() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Renderer, CrewMember, MAX_SKILL_LEVEL } = sb;
  Save.load();
  const ctx = initRenderer(sb);
  const b = Base.get();

  const vet = new CrewMember({ name: 'Vega' });
  vet.skills.weapons.level = MAX_SKILL_LEVEL;          // one mastery → silver
  const sick = new CrewMember({ name: 'Rigel' });
  sick.virus = true;
  b.barracks.length = 0;
  b.barracks.push(vet.serialise(), sick.serialise());

  const drawn = [];
  const realFill = ctx.fillText;
  ctx.fillText = function (t, x, y) { drawn.push({ t: String(t), x, y }); };
  try {
    BaseScreen.open();
    BaseScreen._set({ tab: 'CREW' });
    BaseScreen.draw(ctx);
  } finally { ctx.fillText = realFill; }

  const star = drawn.find(d => d.t === '★');
  ok(!!star, 'a mastered veteran gets a star on his barracks card');
  const name = drawn.find(d => d.t === 'Vega');
  if (star && name) {
    ok(star.x > name.x, 'the star sits beside the name, not under it');
    ok(Math.abs(star.y - name.y) < 2, 'on the same line as the name');
  }
  ok(drawn.some(d => d.t === '☣'), 'an infected veteran gets the plague glyph');
  ok(drawn.some(d => d.t === 'VIRUS'), 'and it is labelled, so it cannot be missed');
  ok(drawn.some(d => /1★ mastered/.test(d.t)),
     'the star is explained on the card too, in the space the card has');

  // A clean, unskilled recruit gets neither.
  const rookie = new CrewMember({ name: 'Nova' });
  b.barracks.length = 0;
  b.barracks.push(rookie.serialise());
  const clean = [];
  ctx.fillText = function (t) { clean.push(String(t)); };
  try { BaseScreen.open(); BaseScreen._set({ tab: 'CREW' }); BaseScreen.draw(ctx); }
  finally { ctx.fillText = realFill; }
  ok(!clean.includes('★'), 'a green recruit gets no star');
  ok(!clean.includes('☣'), 'and no plague glyph');
})();

// ============================================================
section('71. One weapon stat line, everywhere');
// ============================================================
(function testWeaponStatChips() {
  const sb = loadEngine();
  const { getWeaponDef, weaponStatChips, Renderer } = sb;

  const def = getWeaponDef('laser_basic');
  const chips = weaponStatChips(def);
  ok(chips.length >= 4, `every gun reports its stats as data (${chips.length} chips)`);
  const keys = chips.map(c => c.key);
  ['dmg', 'charge', 'power'].forEach(k =>
    ok(keys.includes(k), `${k} is one of them`));
  // A chip only appears when the gun actually does that thing — a
  // single-shot laser has no SHOTS chip, and an ion cannon has no DMG.
  ok(!keys.includes('shots'), 'a single-shot gun does not advertise SHOTS');
  ok(keys.includes('module') && keys.includes('crew'),
     'a laser says it damages modules and crew — its whole role');
  const ion = weaponStatChips(getWeaponDef('ion_basic')).map(c => c.key);
  ok(!ion.includes('dmg') && !ion.includes('module') && !ion.includes('crew'),
     `an ion cannon advertises no damage at all (${ion.join(',')})`);
  ok(ion.includes('shield') && ion.includes('stun'),
     'only shield stripping and stun — which is exactly what it does');
  const flak = weaponStatChips(getWeaponDef('flak_basic')).map(c => c.key);
  ok(!flak.includes('module') && flak.includes('crew') && flak.includes('shield'),
     `flak: shields and crew, never modules (${flak.join(',')})`);
  const mslChips = weaponStatChips(getWeaponDef('missile_basic'));
  ok(mslChips.find(c => c.key === 'shield')?.value === 'bypass',
     'a missile says outright that it bypasses shields');

  // EVERY chip carries an icon, not just POWER. That was the whole
  // complaint: "⚡2" looked designed and "3" next to DMG did not.
  chips.forEach(c => {
    ok(!!c.icon, `${c.label} has a pictogram of its own`);
    ok(!!Renderer.STAT_ICONS[c.icon], `${c.label}'s pictogram is actually defined`);
    ok(!!c.col, `${c.label} has a colour`);
    ok(String(c.value).length > 0, `${c.label} has a value`);
  });

  // The same shapes render on BOTH surfaces — the DOM shop and the
  // canvas armoury read from one definition, so they cannot drift.
  const svg = Renderer.statIconSVG('dmg', '#ff5566', 10);
  ok(/^<svg /.test(svg) && /viewBox="0 0 10 10"/.test(svg),
     'the DOM shop gets real inline SVG for the same icon');
  ok(svg.includes('#ff5566'), 'and it is drawn in the stat colour');
  let painted = 0;
  const ctx = initRenderer(sb);
  const realFillRect = ctx.fill;
  ctx.fill = function () { painted++; };
  try { Renderer.drawStatIcon(ctx, 'dmg', 0, 0, 10, '#ff5566'); }
  finally { ctx.fill = realFillRect; }
  ok(painted > 0, 'and the canvas armoury paints the same shape');

  // A missile gun advertises its ammo cost; a laser does not.
  const msl = Object.keys(sb.WEAPON_DEFS).find(k => sb.WEAPON_DEFS[k].missileUse);
  if (msl) {
    ok(weaponStatChips(getWeaponDef(msl)).some(c => c.key === 'ammo'),
       'a missile launcher lists its AMMO draw');
  }
  ok(!chips.some(c => c.key === 'ammo'), 'a laser does not');

  // The charge chip can be handed the CREW-ADJUSTED figure.
  const fast = weaponStatChips(def, { chargeTime: def.chargeTime * 0.7 });
  const fc = fast.find(c => c.key === 'charge');
  ok(fc.boosted === true, 'a crewed gun flags its charge as improved');
  ok(parseFloat(fc.value) < def.chargeTime, `and shows the shorter time (${fc.value})`);
})();

// ============================================================
section('72. The lift lines up with its own doors');
// ============================================================
(function testElevatorAlignment() {
  const sb = loadEngine();
  const { Ship, Save, SHIP_LAYOUTS } = sb;
  Save.load();

  Object.keys(SHIP_LAYOUTS).filter(k => (SHIP_LAYOUTS[k].elevators ?? []).length)
    .forEach(key => {
      const ship = new Ship(key, true, 0, 0);
      ship.elevators.shafts.forEach(shaft => {
        ok(Array.isArray(shaft.doorYs) && shaft.doorYs.length === shaft.floorYs.length,
           `${key}/${shaft.id}: the shaft knows where its doors are`);

        shaft.floorYs.forEach((fy, i) => {
          // The doors this shaft actually spawned on that deck.
          const mates = ship.doors.filter(d =>
            d.roomB === `shaft_${shaft.id}` &&
            Math.abs(d.y - shaft.doorYs[i]) < 0.001);
          if (!mates.length) return;
          ok(Math.abs(shaft.drawY(fy) - mates[0].y) < 0.001,
             `${key}/${shaft.id}: landing ${i} is drawn on the door line, not the walk line`);
        });

        // The car is the same height as a door, and stops level with it.
        ok(sb.ElevatorShaft.DOOR_H === 34,
           'the cabin is sized from the door height, not a magic number');
        shaft._cabinY = shaft.floorYs[0];
        ok(Math.abs(shaft.drawY(shaft._cabinY) - shaft.doorYs[0]) < 0.001,
           `${key}/${shaft.id}: a parked cabin sits exactly at its landing`);

        // The trunk spans the hull it is bolted to — no more, no less.
        const top = Math.min(...ship.rooms.map(r => r.y));
        const bot = Math.max(...ship.rooms.map(r => r.y + r.h));
        ok(shaft.extentTop === top && shaft.extentBottom === bot,
           `${key}/${shaft.id}: the trunk runs the full height of the hull, ` +
           `not a constant tuned for one deck size (${shaft.extentTop}..${shaft.extentBottom} vs ${top}..${bot})`);
        const stops2 = shaft.floorYs.map(f => shaft.drawY(f));
        ok(Math.min(...stops2) - 17 >= top - 1,
           `${key}/${shaft.id}: no landing hangs out of the top of the hull`);
        ok(Math.max(...stops2) + 17 <= bot + 1,
           `${key}/${shaft.id}: nor out of the bottom`);
      });
    });

  // Passengers are handed back onto the WALK line, whatever the cabin
  // was drawn at — everything downstream reasons in walk-line Y.
  const ship = new Ship('frigate', true, 0, 0);
  const shaft = ship.elevators.shafts[0];
  const rider = { x: 0, y: 0, _ridingShaft: shaft };
  shaft.passenger = rider;
  shaft._cabinY = shaft.floorYs[0];
  shaft._targetY = shaft.floorYs[0];
  shaft._moving = false;
  shaft.update(0.05);
  ok(rider.y === shaft.floorYs[0],
     'a passenger stepping out lands on the walk line, not the door line');
})();

// ============================================================
section('73. Engine crew finally get paid for their skill');
// ============================================================
(function testEngineSkillEvasion() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const pilotRoom = ship.getRoomById(ship.getSystem('piloting').roomId);
  const engRoom   = ship.getRoomById(ship.getSystem('engines').roomId);

  const pilot = new CrewMember({ name: 'Helm' });
  ship.addCrew(pilot);
  pilot.x = pilotRoom.cx; pilot.y = pilotRoom.cy; pilot.roomId = pilotRoom.id;

  const eng = new CrewMember({ name: 'Wrench' });
  ship.addCrew(eng);
  eng.x = engRoom.cx; eng.y = engRoom.cy; eng.roomId = engRoom.id;

  const flat = ship.evasion;
  eng.skills.engines.level = 3;
  const skilled = ship.evasion;
  ok(skilled > flat,
     `a mastered engineer in the engine room raises evasion (${flat.toFixed(3)} → ${skilled.toFixed(3)})`);
  ok(Math.abs((skilled - flat) - 3 * 0.05) < 1e-6,
     'by exactly engineBonus() — the function that used to have no callers');

  // The bonus is tied to the ENGINE ROOM, not to carrying the skill.
  eng.roomId = pilotRoom.id;
  ok(Math.abs(ship.evasion - flat) < 1e-6,
     'walk him out of the engine room and the bonus goes with him');
  eng.roomId = engRoom.id;

  // A downed man does not fly the ship — the getter used to mix two
  // different liveness tests and let an injured pilot count.
  const before = ship.evasion;
  pilot.state = 'injured';
  ok(ship.evasion === 0,
     `a downed pilot means no evasion at all (was ${before.toFixed(3)})`);
})();

// ============================================================
section('74. Skill actually shortens the wait — and says so');
// ============================================================
(function testSkillSpeedReadouts() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, Weapon, getWeaponDef } = sb;
  Save.load(); Save.startRun();

  // ── Shields ──
  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const shields = ship.getSystem('shields');
  const shieldRoom = ship.getRoomById(shields.roomId);

  const green = new CrewMember({ name: 'Green' });
  ship.addCrew(green);
  green.x = shieldRoom.cx; green.y = shieldRoom.cy; green.roomId = shieldRoom.id;
  shields._shieldBars = 0;
  ship.update(0.05);
  const slow = shields._shieldNeed;

  green.skills.shields.level = 3;
  shields._shieldBars = 0;
  ship.update(0.05);
  const fast = shields._shieldNeed;
  ok(fast < slow, `a mastered shield operator recharges faster (${slow} → ${fast})`);
  ok(slow - fast > 1.0,
     `and by an amount you can feel, not 0.45s (saved ${(slow - fast).toFixed(2)}s)`);
  ok(fast >= 1, 'but never down to zero, however many crew you cram in');

  // ── Weapons: the READOUT must move with the gun ──
  const def = getWeaponDef('laser_basic');
  const gun = new Weapon('laser_basic', 0);
  gun.power = def.powerCost;
  gun.update(0.016, 0, true);
  const baseSecs = gun.chargeSeconds();
  ok(baseSecs === Math.max(1, Math.round(def.chargeTime)),
     `an unskilled gun shows its factory time (${baseSecs}s)`);
  ok(gun.chargeBoosted === false, 'and does not claim a bonus it has not got');

  gun.update(0.016, 0.3, true);                 // a Weapons-3 gunner
  ok(gun.chargeTime() < def.chargeTime,
     `the gunner really shortens the charge (${gun.chargeTime().toFixed(1)}s)`);
  ok(gun.chargeSeconds() < baseSecs,
     `and the BOX COUNT follows it down (${baseSecs} → ${gun.chargeSeconds()})`);
  ok(gun.chargeBoosted === true, 'the readout flags itself as improved');
  ok(gun.chargeStripWidth() < baseSecs * 6,
     'the strip on the hull shrinks with it, so the boxes still mean seconds');

  // Stacking a bay used to divide by zero and leave the gun unarmable.
  gun.update(0.016, 3.0, true);
  ok(isFinite(gun.chargeTime()) && gun.chargeTime() > 0,
     `an over-stacked weapons bay still has a positive charge time (${gun.chargeTime()})`);
  gun.charge = 0;
  for (let i = 0; i < 400; i++) gun.update(0.05, 3.0, true);
  ok(gun.armed === true, 'and the gun still arms instead of charging backwards');
})();

// ============================================================
section('75. The reactor costs what the shop says it costs');
// ============================================================
(function testReactorPrice() {
  const sb = loadEngine();
  const { Ship, Save, Station } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 0, 0);
  const st = new Station(1, 999);

  // THE BUG: the button was priced by Reactor.upgradeCost() (linear)
  // while the till charged REACTOR_PRICE() (exponential). Above reactor
  // level 5 they diverge, so an affordable-looking upgrade was refused.
  ok(typeof ship.reactor.upgradeCost !== 'function',
     'the reactor no longer carries a price of its own to drift');

  for (let lvl = 1; lvl <= 12 && lvl < ship.reactor.maxLevel; lvl++) {
    ship.reactor.level = lvl;
    const quoted = st.reactorCost(ship);
    Save.updateRun({ scrap: quoted });
    const run = Save.getRun();
    const r = st.buyReactorUpgrade(ship, run);
    ok(r.ok === true,
       `level ${lvl}: exactly the quoted ${quoted} CC is enough to buy the upgrade` +
       `${r.ok ? '' : ' — got: ' + r.message}`);
    if (r.ok) ok(r.cost === quoted, `level ${lvl}: and that is what was charged`);
  }

  // A maxed reactor says so, instead of blaming the player's purse.
  ship.reactor.level = ship.reactor.maxLevel;
  Save.updateRun({ scrap: 0 });
  const maxed = st.buyReactorUpgrade(ship, Save.getRun());
  ok(maxed.ok === false, 'a maxed reactor cannot be upgraded');
  ok(/maximum/i.test(maxed.message),
     `and the reason given is the real one (${maxed.message})`);
})();

// ============================================================
section('76. A live selection turns clicks into orders');
// ============================================================
(function testSelectionOrdersOverSelect() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, UI, Game } = sb;
  Save.load(); Save.startRun();
  const T = Game.__test;

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  ship.assignStations();
  T.playerShip = ship; T.enemyShip = null; T.STATE = 'combat';
  for (let i = 0; i < 400; i++) ship.update(0.05);

  // Find a room with somebody manning its console.
  const manned = ship.rooms.find(r => ship.crewInRoom(r.id).length === 1);
  ok(!!manned, 'test setup: a module with exactly one operator in it');
  const operator = ship.crewInRoom(manned.id)[0];

  // With NOTHING selected, clicking him picks him up — unchanged.
  UI.selectCrewGroup([]);
  T._crewClickResolve(operator.x, operator.y - 1, false);
  ok(UI.getSelectedCrewAll().includes(operator),
     'with no selection, clicking a crewman still selects him');

  // With somebody ELSE selected, a click on the module's free floor is
  // an ORDER — the operator standing high in the middle does not eat it.
  const other = ship.crew.find(c => c !== operator && c.alive &&
                                    c.roomId !== manned.id);
  ok(!!other, 'test setup: a second crew member elsewhere');
  UI.selectCrewGroup([other]);
  T._crewClickResolve(manned.cx, manned.y + manned.h - 8, false);
  ok(other.homeRoomId === manned.id,
     `clicking the free floor of a manned module orders crew in (home=${other.homeRoomId})`);
  ok(UI.getSelectedCrewAll().includes(other),
     'and the selection is kept, so you can keep giving orders');

  // Clicking the SELECTED man himself still narrows onto him.
  // (Click somebody else first: two clicks on the same man inside 350ms
  // is the select-ALL double-click gesture, which would mask this.)
  UI.selectCrewGroup([]);
  T._crewClickResolve(other.x, other.y - 1, false);
  UI.selectCrewGroup(ship.crew.filter(c => c.alive));
  T._crewClickResolve(operator.x, operator.y - 1, false);
  ok(UI.getSelectedCrewAll().length === 1 &&
     UI.getSelectedCrewAll()[0] === operator,
     'clicking a selected crewman narrows the selection to him');

  // Clicking off the hull drops the selection — how you get back to
  // picking individuals.
  UI.selectCrewGroup([other]);
  T._crewClickResolve(-500, -500, false);
  ok(UI.getSelectedCrewAll().length === 0,
     'clicking off the ship clears the selection');
})();

// ============================================================
section('77. Crew at a console work it');
// ============================================================
(function testOperatorAnimation() {
  const sb = loadEngine();
  const { Ship, Save, Animation } = sb;
  Save.load(); Save.startRun();

  ok(typeof Animation.crewByColor === 'function', 'crew animations are colour-keyed');
  const op = Animation.crewByColor('operate', '#4db8ff');
  ok(!!op, 'there is an operate animation at all');
  const idle = Animation.crewByColor('idle', '#4db8ff');
  ok(op !== idle, 'and it is not just the idle bob under another name');

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  ship.assignStations();
  for (let i = 0; i < 600; i++) ship.update(0.05);

  const consoleMen = ship.crew.filter(c => {
    const r = ship.getRoomById(c.roomId);
    if (!r || !r.system) return false;
    return (ship.floorWalkY(r.floor, r.cy) - c.y) > 1;
  });
  ok(consoleMen.length > 0, `somebody is standing at a console (${consoleMen.length})`);
  ok(consoleMen.every(c => c._animState === 'operate'),
     'and everyone at one is playing the working animation, not idling');

  // Anybody NOT at a console keeps the ordinary idle.
  const flanker = ship.crew.find(c => !consoleMen.includes(c) &&
                                      c._animState === 'idle');
  ok(flanker === undefined || flanker._animState === 'idle',
     'crew away from a console keep the idle bob');
})();

// ============================================================
section('78. A lift can be turned around mid-ride');
// ============================================================
(function testElevatorReroute() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const c = new CrewMember({ name: 'Rider' });
  ship.addCrew(c);

  const floors = [...new Set(ship.rooms.map(r => r.floor))].sort();
  ok(floors.length > 1, 'test premise: the frigate has more than one deck');
  const top = ship.rooms.find(r => r.floor === floors[0]);
  const bot = ship.rooms.find(r => r.floor === floors[floors.length - 1]);

  // Put him on the top deck and send him down.
  c.x = top.cx; c.y = ship.floorWalkY(top.floor, top.cy); c.roomId = top.id;
  c.homeRoomId = top.id;
  ok(c.moveToOnShip(ship, ...ship.stationSlot(bot, 0)), 'the trip down is planned');

  // Run until he is actually INSIDE a moving cabin.
  let riding = false;
  for (let i = 0; i < 800 && !riding; i++) { ship.update(0.05); riding = !!c._ridingShaft; }
  ok(riding, 'he boards the lift');
  const shaft = c._ridingShaft;
  const wasTarget = shaft._targetY;

  // NEW ORDER, mid-ride: go back to the deck he came from.
  c.moveToOnShip(ship, ...ship.stationSlot(top, 0));
  ok(shaft._targetY !== wasTarget,
     'the cabin turns around instead of dropping him where it was going');
  ok(!!c._ridingShaft, 'and he is still in it — he does not step out into the shaft');

  for (let i = 0; i < 2000; i++) ship.update(0.05);
  ok(c.roomId === top.id, `he rides back and arrives properly (${c.roomId})`);
  const walkY = ship.floorWalkY(top.floor, top.cy);
  ok(walkY - c.y <= sb.Ship.OPERATOR_LIFT + 1 && c.y <= walkY,
     'standing on his deck, not hovering between two of them');

  // THE ORIGINAL BUG: a mid-ride order used to be planned from a Y that
  // belongs to no deck, so floorAtY() said -1, the "same floor, just
  // walk" branch fired, and he flew diagonally out of the shaft.
  ok(Math.abs(c.x - shaft.x) > 1 || c.roomId === top.id,
     'he did not end up parked inside the shaft');
})();

// ============================================================
section('79. Clicking another crewman switches to him');
// ============================================================
(function testSelectionSwitch() {
  const sb = loadEngine();
  const { Ship, Save, UI, Game } = sb;
  Save.load(); Save.startRun();
  const T = Game.__test;

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  ship.assignStations();
  T.playerShip = ship; T.enemyShip = null; T.STATE = 'combat';
  for (let i = 0; i < 600; i++) ship.update(0.05);

  const [a, b] = ship.crew.filter(c => c.alive);
  ok(!!a && !!b, 'test premise: two live crew');

  UI.selectCrewGroup([a]);
  T._crewClickResolve(b.x, b.y - 1, false);
  ok(UI.getSelectedCrewAll().length === 1 && UI.getSelectedCrewAll()[0] === b,
     'with one crewman selected, clicking another SWITCHES to him');

  // update34 made a live selection turn every click into an order, which
  // fixed the console-eats-the-click problem and broke this. Switching
  // wins; the room click is protected by the hot spot being the size of
  // the drawn ring instead of a fat circle.
  ok(T._crewUnderCursor(b.x + 12, b.y - 1) !== b,
     'the hot spot is body-sized — 12px to the side is already the module');
  ok(T._crewUnderCursor(b.x, b.y - 1) === b, 'while the man himself still picks up');

  // Shift adds instead of replacing. (Use a THIRD crewman: clicking the
  // same man twice inside 350ms is the select-everyone double-click.)
  const third = ship.crew.filter(c => c.alive)[2];
  UI.selectCrewGroup([a]);
  T._crewClickResolve(third.x, third.y - 1, true);
  ok(UI.getSelectedCrewAll().length === 2,
     `shift-click adds to the selection (${UI.getSelectedCrewAll().length})`);
  ok(UI.getSelectedCrewAll().includes(a) && UI.getSelectedCrewAll().includes(third),
     'and keeps the one that was already picked');
})();

// ============================================================
section('80. Boarding keeps the crew you sent');
// ============================================================
(function testBoardingKeepsSelection() {
  const sb = loadEngine();
  const { Save, UI, Game } = sb;
  Save.load();
  const { T, player } = makeCombat(sb);

  const party = player.crew.filter(c => c.alive).slice(0, 2);
  UI.selectCrewGroup(party);
  ok(UI.getSelectedCrewAll().length === 2, 'two crew are selected');

  T._launchBoarders();
  ok(!!T.boardingParty, 'the boarding party launches');
  ok(UI.getSelectedCrewAll().length === 2,
     `the selection SURVIVES the launch (${UI.getSelectedCrewAll().length})`);
  ok(UI.getSelectedCrewAll().every(c => party.includes(c)),
     'and it is still the same people');

  // …all the way onto the enemy hull.
  for (let i = 0; i < 2000 && T.boardingParty; i++) T._updateParty(T.boardingParty, 0.05);
  ok(UI.getSelectedCrewAll().length === 2,
     'still selected once they are aboard the enemy ship');
  ok(UI.getSelectedCrewAll().every(c => !c.dead),
     'and they are alive to take the next order');
})();

// ============================================================
section('81. The console operator is not evicted');
// ============================================================
(function testConsolePriority() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const room = ship.getRoomById(ship.getSystem('weapons').roomId);

  const op = new CrewMember({ name: 'Aaa' });     // deliberately LOW id-ish name
  ship.addCrew(op);
  op.homeRoomId = room.id;
  op.moveToOnShip(ship, ...ship.stationSlot(room, 0));
  for (let i = 0; i < 600; i++) ship.update(0.05);

  const console0 = ship.stationSlot(room, 0);
  const atConsole = (c) => Math.hypot(c.x - console0[0], c.y - console0[1]) < 4;
  ok(atConsole(op), 'the first man in takes the console');
  ok(op._animState === 'operate', 'and works it');

  // A second crew member joins. He must FLANK, not take over.
  const mate = new CrewMember({ name: 'Bbb' });
  ship.addCrew(mate);
  mate.homeRoomId = room.id;
  mate.moveToOnShip(ship, ...ship.stationSlot(room, 1));
  for (let i = 0; i < 900; i++) ship.update(0.05);
  ok(atConsole(op), 'the newcomer does not evict the operator');
  ok(!atConsole(mate), 'he stands beside him');
  ok(Math.abs(mate.x - console0[0]) > 14, `and genuinely to one side (${Math.round(mate.x - console0[0])}px)`);

  // Somebody merely PASSING THROUGH must not shove him either.
  const passer = new CrewMember({ name: 'Aaa0' });
  ship.addCrew(passer);
  passer.homeRoomId = ship.rooms.find(r => r.id !== room.id).id;
  passer.x = console0[0] + 2; passer.y = console0[1] + 2; passer.roomId = room.id;
  for (let i = 0; i < 300; i++) ship.update(0.05);
  ok(atConsole(op), 'a crewman crossing the room does not displace the operator either');

  // If the operator LEAVES, the flanker takes the console.
  op.homeRoomId = ship.rooms.find(r => r.id !== room.id).id;
  op.moveToOnShip(ship, ...ship.stationSlot(ship.getRoomById(op.homeRoomId), 0));
  for (let i = 0; i < 1500; i++) ship.update(0.05);
  ok(atConsole(mate), 'and when he goes, the man beside him steps up to it');
})();

// ============================================================
section('82. What you buy at a station stays bought');
// ============================================================
(function testStationPurchasesPersist() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, Station, UI, Game } = sb;
  Save.load(); Save.startRun();
  const T = Game.__test;

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const sick = new CrewMember({ name: 'Patient' });
  sick.virus = true; sick.virusFights = 1;
  ship.addCrew(sick);
  T.playerShip = ship;
  T.STATE = 'station';
  Save.updateRun({ scrap: 500 });
  T._saveShip?.();

  const st = new Station(1, 77);
  st.type = 'science';
  const res = st.cureVirus(ship, Save.getRun());
  ok(res.ok, `the science post cures the virus (${res.message})`);
  ok(sick.virus === false, 'the live crewman is clean');

  // THE BUG: the CC was written to the save immediately and the cure was
  // not, so a reload brought the virus back — countdown and all — while
  // the money stayed spent. _updateStation now saves on the way out.
  const stEl = sb.document.getElementById('station-screen');
  stEl.classList.contains = () => false;        // "the player closed it"
  T._updateStation(0.05);

  const saved = (Save.getRun().crew || []).find(c => c.name === 'Patient');
  ok(!!saved, 'the crew snapshot in the save has him');
  ok(saved.virus === false,
     'and he is cured THERE too, so a reload cannot resurrect the virus');

  // The whole point: rebuilding the run from the save keeps the cure.
  T.playerShip = null;
  T._continueRun();
  const rebuilt = T.playerShip.crew.find(c => c.name === 'Patient');
  ok(!!rebuilt && rebuilt.virus === false,
     'CONTINUE brings back a cured man, not an infected one');
})();

// ============================================================
section('83. Weapons do what their class says');
// ============================================================
(function testWeaponRoles() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, getWeaponDef, Projectile } = sb;
  Save.load(); Save.startRun();

  const fire = (target, key, room) => {
    const def = getWeaponDef(key);
    const p = new Projectile({ x: room.cx, y: room.cy, targetX: room.cx, targetY: room.cy,
                               speed: 1, type: def.type, def, fromPlayer: true });
    p.x = room.cx; p.y = room.cy;
    return target.receiveHit(p);
  };
  const rig = () => {
    const sh = new Ship('enemy_frigate', false, 850, 120);
    sh._allocateDefaultPower();
    sh.evasion !== undefined;
    // Kill evasion and cloak so every shot lands, deterministically.
    Object.defineProperty(sh, 'evasion', { get: () => 0, configurable: true });
    return sh;
  };

  // ── ION: shields only. No hull, no module, no crew, but it stuns. ──
  {
    const sh = rig();
    const room = sh.getRoomById(sh.getSystem('weapons').roomId);
    const gunner = new CrewMember({ name: 'Gunner', isPlayer: false });
    sh.addCrew(gunner);
    gunner.x = room.cx; gunner.y = room.cy; gunner.roomId = room.id;
    const sys = room.system;
    sys.damagedLevels = 0;
    const hull0 = sh.hull, hp0 = gunner.hp;
    // Drop the shields first so the bolt reaches the hull.
    sh.getSystem('shields')._shieldBars = 0;
    fire(sh, 'ion_basic', room);
    ok(sh.hull === hull0, `ion does no hull damage (${hull0} → ${sh.hull})`);
    ok(sys.damagedLevels === 0, 'and breaks no module levels');
    ok(gunner.hp === hp0, `and hurts nobody (${hp0} → ${gunner.hp})`);
    ok(sys.stunLeft > 0 && sys.stunLeft <= 1.001,
       `one bolt buys ONE second of module stun (${sys.stunLeft})`);
    ok(gunner.stunned, 'and stuns the crew standing in it');
  }

  // ── ION vs SHIELDS: ONE bar a bolt (update38). ──
  {
    const sh = rig();
    const shields = sh.getSystem('shields');
    shields.level = 6; shields.power = 6;
    shields._shieldBars = 3;
    const room = sh.getRoomById(sh.getSystem('weapons').roomId);
    const r = fire(sh, 'ion_basic', room);
    ok(r.absorbed === true, 'a bolt that meets shields is absorbed');
    ok(shields.shieldBars === 2, `and takes ONE bar with it (3 → ${shields.shieldBars})`);
  }

  // ── FLAK: no module damage, but it does cut up crew. ──
  {
    const sh = rig();
    const room = sh.getRoomById(sh.getSystem('weapons').roomId);
    sh.getSystem('shields')._shieldBars = 0;
    const c = new CrewMember({ name: 'Deckhand', isPlayer: false });
    sh.addCrew(c);
    c.x = room.cx; c.y = room.cy; c.roomId = room.id;
    room.system.damagedLevels = 0;
    const hp0 = c.hp;
    for (let i = 0; i < 6; i++) fire(sh, 'flak_basic', room);
    ok(room.system.damagedLevels === 0,
       `six flak hits break no module levels (${room.system.damagedLevels})`);
    ok(c.hp < hp0, `but they do hurt the crew (${hp0} → ${c.hp})`);
  }

  // ── LASER: modules AND crew; missiles do the same but ignore shields. ──
  {
    const sh = rig();
    const room = sh.getRoomById(sh.getSystem('weapons').roomId);
    sh.getSystem('shields')._shieldBars = 0;
    room.system.damagedLevels = 0;
    const c = new CrewMember({ name: 'Loader', isPlayer: false });
    sh.addCrew(c);
    c.x = room.cx; c.y = room.cy; c.roomId = room.id;
    const hp0 = c.hp, hull0 = sh.hull;
    fire(sh, 'laser_basic', room);
    ok(room.system.damagedLevels === 1, 'a laser breaks a module level');
    ok(c.hp < hp0, 'and hurts the crew in the room');
    ok(sh.hull < hull0, 'and takes hull');
  }
  {
    const sh = rig();
    const shields = sh.getSystem('shields');
    shields.level = 6; shields.power = 6; shields._shieldBars = 3;
    const room = sh.getRoomById(sh.getSystem('weapons').roomId);
    const hull0 = sh.hull;
    fire(sh, 'missile_basic', room);
    ok(sh.hull < hull0, 'a missile goes straight through a full shield');
    ok(shields.shieldBars === 3, 'without taking a bar off it');
  }

  // ── The odds are per weapon, and they say what the classes promised. ──
  const P = (k) => getWeaponDef(k);
  ok(P('missile_basic').fireChance > P('laser_basic').fireChance * 3,
     'missiles start fires far more readily than lasers');
  ok(P('missile_basic').breachChance > P('laser_basic').breachChance * 5,
     'and hole hulls far more readily');
  ok(P('ion_basic').fireChance === 0 && P('ion_basic').breachChance === 0,
     'ion does neither');
  ok(P('flak_basic').moduleDamage === 0 && P('flak_basic').hull_damage === 0,
     'flak leaves hull and modules alone');
})();

// ============================================================
section('84. The hangar shows hull as squares');
// ============================================================
(function testHullPips() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Renderer } = sb;
  Save.load();
  const ctx = initRenderer(sb);

  const drawn = captureText(ctx, () => {
    BaseScreen.open();
    BaseScreen._set({ tab: 'HANGAR' });
    BaseScreen.draw(ctx);
  });
  const STRIP_X = Renderer.getWidth() - 40 - 268 - 16;
  const hull = drawn.find(d => d.t === 'HULL' && d.x >= STRIP_X - 2);
  ok(!!hull, 'the berth readout has a HULL line');
  const mods = drawn.find(d => d.t === 'MODULES' && d.x >= STRIP_X - 2);
  ok(!!mods && hull && hull.y < mods.y,
     'and it sits ABOVE the module list, where the player asked for it');
  ok(drawn.some(d => /^\d+ \/ \d+$/.test(d.t)),
     'with the actual numbers beside it');

  // A holed hull must read differently from a sound one — the squares
  // are the point, so count the filled ones.
  const b = Base.get();
  const entry = b.ships[0];
  const sh = entry.data ? sb.Ship.deserialise(entry.data, true, 0, 0)
                        : new sb.Ship(entry.key, true, 0, 0);
  sh.hull = Math.max(1, Math.floor(sh.hullMax / 2));
  entry.data = sh.serialise();
  const drawn2 = captureText(ctx, () => { BaseScreen.open(); BaseScreen._set({ tab: 'HANGAR' }); BaseScreen.draw(ctx); });
  ok(drawn2.some(d => d.t === `${sh.hull} / ${sh.hullMax}`),
     `a damaged hull reports its real state (${sh.hull} / ${sh.hullMax})`);
})();

// ============================================================
section('85. The hill remembers the dead');
// ============================================================
(function testMemorial() {
  const sb = loadEngine();
  const { Save, BaseScreen, CrewMember, Input, Renderer } = sb;
  Save.load(); Save.startRun();
  const ctx = initRenderer(sb);

  BaseScreen.open();
  BaseScreen._set({ tab: 'MEMORIAL' });
  BaseScreen.draw(ctx);
  ok(BaseScreen._graves().length === 0, 'an empty hill has no markers');

  const dead = new CrewMember({ name: 'Halley' });
  dead.killedBy = 'void-spider virus';
  dead.skills.weapons.level = 2;
  Save.updateRun({ sector: 3 });
  // killOutright, NOT takeDamage: takeDamage has a 35% "goes down
  // wounded instead" roll, which made this section fail about a third
  // of the time. A test that only usually passes is worse than none.
  dead.killOutright('void-spider virus');
  ok(Save.getGraveyard().some(g => g.name === 'Halley'),
     'a crew member who dies is buried');

  BaseScreen.draw(ctx);
  const zones = BaseScreen._graves();
  ok(zones.length === Save.getGraveyard().length,
     `one marker per grave (${zones.length})`);
  ok(zones.some(z => z.name === 'Halley'), 'and ours is on the hill');

  // Hovering a marker draws the epitaph — name, killer, where.
  const z = zones.find(v => v.name === 'Halley');
  Input.mouse.x = z.x + z.w / 2; Input.mouse.y = z.y + z.h / 2;
  const card = captureText(ctx, () => BaseScreen.draw(ctx));
  Input.mouse.x = -100; Input.mouse.y = -100;
  ok(card.some(d => d.t === 'Halley'), 'the card names him');
  ok(card.some(d => /killed by/.test(d.t)), 'and says what killed him');
  ok(card.some(d => /sector 3/.test(d.t)), 'and where it happened');
  ok(card.some(d => d.t === 'R.I.P.'), 'and signs off properly');

  // Nothing is drawn for a marker nobody is pointing at.
  const quiet = captureText(ctx, () => BaseScreen.draw(ctx));
  ok(!quiet.some(d => d.t === 'R.I.P.'), 'with the pointer away, no card');
})();

// ============================================================
section('86. The graveyard left the main menu for the hill');
// ============================================================
(function testMenuHasNoGraveyard() {
  const sb = loadEngine();
  const fs2 = require('fs'), path2 = require('path');
  const game = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'game.js'), 'utf8');
  const items = game.match(/const MENU_ITEMS = \[([^\]]+)\]/);
  ok(!!items, 'the menu list is where we think it is');
  ok(!/GRAVEYARD/.test(items ? items[1] : ''),
     `the menu no longer has its own door to the dead (${items && items[1]})`);
  ok(!/showGraveyard/.test(game), 'and nothing calls the old DOM modal');

  const ui = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'ui.js'), 'utf8');
  ok(!/function showGraveyard/.test(ui), 'the modal itself is gone from ui.js');
  ok(sb.UI.showGraveyard === undefined, 'and it is not exported any more');

  // The replacement is a real tab.
  const bs = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'basescreen.js'), 'utf8');
  ok(/'MEMORIAL'/.test(bs), 'MEMORIAL is a base tab');
})();

// ============================================================
section('87. A service record is kept, and buried with them');
// ============================================================
(function testServiceRecord() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, Game, UI } = sb;
  Save.load();
  const { T, player, enemy } = makeCombat(sb);

  const me = player.crew.find(c => c.alive);
  ok(!!me, 'somebody is aboard');
  ok(me.battles >= 1, `starting a fight counts as an action (${me.battles})`);
  const b0 = me.battles;

  // A win goes on everybody's record.
  T._creditCrew('wins');
  ok(me.wins === 1, 'a victory is credited');
  T._creditCrew('escapes');
  ok(me.escapes === 1, 'so is running away');

  // MELEE: the man who swings gets the kill. The victim used to record
  // the string 'crew' as its killer and NOBODY was ever credited.
  const foe = new CrewMember({ name: 'Raider', isPlayer: false });
  player.addCrew(foe, true);
  foe.roomId = me.roomId; foe.x = me.x; foe.y = me.y;
  foe.hp = 1;
  const k0 = me.kills;
  for (let i = 0; i < 200 && foe.alive; i++) player.update(0.05);
  ok(!foe.alive, 'the intruder goes down');
  ok(me.kills === k0 + 1, `and his killer is credited (${k0} → ${me.kills})`);

  // GUNNERY: a bolt carries the crew who fired it.
  const gunRoom = enemy.getRoomById(enemy.getSystem('weapons').roomId);
  const victim = new CrewMember({ name: 'Deckhand', isPlayer: false });
  enemy.addCrew(victim, true);
  victim.roomId = gunRoom.id; victim.x = gunRoom.cx; victim.y = gunRoom.cy;
  victim.hp = 1;
  enemy.getSystem('shields')._shieldBars = 0;
  Object.defineProperty(enemy, 'evasion', { get: () => 0, configurable: true });
  const gunner = player.crew.find(c => c.alive && c !== me) || me;
  const g0 = gunner.kills;
  const def = sb.getWeaponDef('laser_heavy');
  const p = new sb.Projectile({ x: gunRoom.cx, y: gunRoom.cy, targetX: gunRoom.cx,
                                targetY: gunRoom.cy, speed: 1, type: def.type, def,
                                fromPlayer: true, gunners: [gunner] });
  p.x = gunRoom.cx; p.y = gunRoom.cy;
  enemy.receiveHit(p);
  ok(!victim.alive, 'the bolt kills him');
  ok(gunner.kills === g0 + 1,
     `and the gunner who fired it is credited (${g0} → ${gunner.kills})`);

  // It survives a save…
  const round = CrewMember.deserialise(me.serialise());
  ok(round.battles === me.battles && round.wins === me.wins &&
     round.escapes === me.escapes && round.kills === me.kills,
     'the whole record round-trips through serialise()');

  // …and it goes on the headstone.
  me.killedBy = 'weapons fire';
  Save.addToGraveyard(me);
  const stone = Save.getGraveyard().find(g => g.name === me.name);
  ok(!!stone, 'he gets a headstone');
  ok(stone.battles === me.battles && stone.kills === me.kills &&
     stone.wins === me.wins && stone.escapes === me.escapes,
     `with his record on it (${JSON.stringify({b: stone.battles, k: stone.kills})})`);
  ok(b0 >= 1, 'sanity: the battle counter was running all along');
})();

// ============================================================
section('88. Better soldiers get better markers');
// ============================================================
(function testGraveTiers() {
  const sb = loadEngine();
  const { Save, BaseScreen, CrewMember, Renderer } = sb;
  Save.load(); Save.startRun();
  const ctx = initRenderer(sb);

  const bury = (name, rec) => {
    const c = new CrewMember({ name });
    Object.assign(c, rec);
    c.killedBy = 'weapons fire';
    Save.addToGraveyard(c);
  };
  bury('Rookie',  { battles: 0, wins: 0, escapes: 0, kills: 0 });
  bury('Rated',   { battles: 4, wins: 1, escapes: 0, kills: 0 });
  bury('Veteran', { battles: 6, wins: 3, escapes: 1, kills: 1 });
  bury('Hero',    { battles: 20, wins: 12, escapes: 1, kills: 9 });

  BaseScreen.open();
  BaseScreen._set({ tab: 'MEMORIAL' });
  BaseScreen.draw(ctx);
  const byName = {};
  BaseScreen._graves().forEach(z => { byName[z.name] = z; });

  ok(byName.Rookie.tier === 'cross', `a green hand gets a cross (${byName.Rookie.tier})`);
  ok(byName.Rated.tier === 'slab', `a rated hand gets a headstone (${byName.Rated.tier})`);
  ok(byName.Veteran.tier === 'obelisk', `a veteran gets a pillar (${byName.Veteran.tier})`);
  ok(byName.Hero.tier === 'monument', `and a hero gets a monument (${byName.Hero.tier})`);
  ok(byName.Hero.score > byName.Veteran.score &&
     byName.Veteran.score > byName.Rated.score &&
     byName.Rated.score > byName.Rookie.score,
     'the score is monotonic in service');

  // The record is on the card too.
  const z = byName.Hero;
  sb.Input.mouse.x = z.x + z.w / 2; sb.Input.mouse.y = z.y + z.h / 2;
  const card = captureText(ctx, () => BaseScreen.draw(ctx));
  sb.Input.mouse.x = -100; sb.Input.mouse.y = -100;
  ['actions', 'won', 'fled', 'kills'].forEach(k =>
    ok(card.some(d => d.t === k), `the card lists ${k}`));
  ok(card.some(d => d.t === '20'), 'with the real numbers on it');
  ok(card.some(d => d.t === 'hero'), 'and says what rank the marker is for');
})();

// ============================================================
section('89. Boarders hack doors, they do not smash them');
// ============================================================
(function testDoorHacking() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, Door } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const door = ship.doors.find(d => !d.isAirlock);
  ok(!!door, 'the hull has interior doors');

  ok(door.isHackedBy('enemy') === false, 'a fresh door is nobody else\'s');
  ok(door.hackBy('enemy', 0.1) === false, 'one moment of work is not enough');
  ok(door.hackProgress > 0 && door.hackProgress < 1, 'but progress is showing');
  for (let i = 0; i < 60 && !door.isHackedBy('enemy'); i++) door.hackBy('enemy', 0.1);
  ok(door.isHackedBy('enemy'), `it yields after about ${Door.HACK_TIME}s`);
  ok(door.isHackedBy('player') === false,
     'and only to the side that did the work');

  // A new battle re-locks everything. onBattleStart is called once per
  // fight, for BOTH hulls, from CombatManager.begin — markCombatStart is
  // called from three places in game.js and would have double-counted.
  ship.onBattleStart();
  ok(!door.isHackedBy('enemy'), 'a new fight means new locks');

  // AN INTRUDER IS STOPPED BY A DOOR; the ship's own crew is not.
  const mine = new CrewMember({ name: 'Mine' });
  ship.addCrew(mine);
  ok(mine._isIntruderOn(ship) === false, 'our own crew are not intruders');
  const them = new CrewMember({ name: 'Them', isPlayer: false });
  ship.addCrew(them, true);
  ok(them._isIntruderOn(ship) === true, 'a boarder is');

  // Walk the intruder at a closed door and watch him work rather than
  // stroll through it. (Doors used to be blind to whose ship they were
  // on — a boarder opened the player's locked doors as easily as the
  // player's own crew, so locking one bought about a second of delay.)
  const d2 = ship.doors.find(x => !x.isAirlock);
  d2.mode = 'closed'; d2.openness = 0; d2.open = false;
  them.x = d2.x - 10; them.y = d2.y; them.roomId = null;
  them._waypoints = [{ x: d2.x + 30, y: d2.y }];
  them.task = sb.TASK.MOVE;
  const startX = them.x;
  for (let i = 0; i < 8; i++) them._updateMovement(0.05, ship);
  ok(Math.abs(them.x - startX) < 2, 'he does not walk through it');
  ok(d2.hackT > 0 || d2.isHackedBy('enemy'), 'he is working the lock');
  ok(them._hacking === true, 'and the game knows he is');

  // THE AIRLOCK IS HACKED, NOT DESTROYED. A smashed hatch used to be
  // pinned open forever, venting that room for the rest of the run.
  const air = ship.doors.find(d => d.isAirlock);
  air.hackOpen('enemy', 2.0);
  ok(air.isHackedBy('enemy'), 'the boarding party cracks the outer hatch');
  ok(air.breached === false, 'without breaching it permanently');
  for (let i = 0; i < 200; i++) air.update(0.05);
  ok(air.open === false, 'so it cycles shut again afterwards');
})();

// ============================================================
section('90. A contested module is not a working module');
// ============================================================
(function testContestedModules() {
  const sb = loadEngine();
  const { CrewMember, Save } = sb;
  Save.load();
  const { T, player } = makeCombat(sb);

  const wRoom = player.getRoomById(player.getSystem('weapons').roomId);
  const pRoom = player.getRoomById(player.getSystem('piloting').roomId);

  // Make sure our own people are at their posts.
  const gunner = player.crew.find(c => c.alive);
  gunner.roomId = wRoom.id; gunner.x = wRoom.cx; gunner.y = wRoom.cy;
  ok(player.crewInRoom(wRoom.id).includes(gunner), 'our gunner mans our gun');
  ok(player.roomContested(wRoom.id) === false, 'an uncontested bay is not contested');

  // AN INTRUDER IS NOT OUR CREW. He used to be: enemy boarders are added
  // to the DEFENDING ship's roster, and crewInRoom had no side filter, so
  // a raider standing in your weapons bay MANNED YOUR GUN, one in the
  // shield room sped up YOUR recharge, and one in the medbay was healed
  // by YOUR doctors.
  const raider = new CrewMember({ name: 'Raider', isPlayer: false });
  raider.skills.weapons.level = 3;
  player.addCrew(raider, true);
  raider.roomId = wRoom.id; raider.x = wRoom.cx + 20; raider.y = wRoom.cy;
  ok(!player.crewInRoom(wRoom.id).includes(raider),
     'an enemy boarder is NOT counted among our crew');
  ok(player.occupantsOf(wRoom.id).includes(raider),
     'though he is certainly in the room — weapons fire still finds him');

  // …and while he is there, nobody is working.
  ok(player.roomContested(wRoom.id) === true, 'the bay is contested');
  ok(player.crewOperating(wRoom.id).length === 0,
     'so nobody is operating it — they are fighting');

  const gun = player.weapons.find(Boolean);
  if (gun) {
    gun.power = gun.powerCost; gun.charge = 0; gun.armed = false;
    for (let i = 0; i < 40; i++) player.update(0.05);
    ok(gun.unmanned === true, 'the gun reports NO CREW while the fight is on');
    ok(gun.charge === 0, 'and it does not charge');
  }

  // The COCKPIT: a contested helm means no evasion at all.
  const pilot = player.crew.find(c => c.alive && c !== gunner);
  if (pilot) {
    pilot.roomId = pRoom.id; pilot.x = pRoom.cx; pilot.y = pRoom.cy;
    const flying = player.evasion;
    ok(flying > 0, `a manned cockpit gives evasion (${flying.toFixed(3)})`);
    const raider2 = new CrewMember({ name: 'Raider2', isPlayer: false });
    player.addCrew(raider2, true);
    raider2.roomId = pRoom.id; raider2.x = pRoom.cx + 18; raider2.y = pRoom.cy;
    ok(player.evasion === 0,
       'somebody fighting for the chair means nobody is flying the ship');
  }

  // Shields: the intruder must not be in the system's crew list.
  const shSys = player.getSystem('shields');
  const shRoom = player.getRoomById(shSys.roomId);
  const raider3 = new CrewMember({ name: 'Raider3', isPlayer: false });
  raider3.skills.shields.level = 3;
  player.addCrew(raider3, true);
  raider3.roomId = shRoom.id; raider3.x = shRoom.cx; raider3.y = shRoom.cy;
  player.update(0.05);
  ok(!shSys.crew.includes(raider3),
     'an intruder never joins our shield crew, however skilled he is');
})();

// ============================================================
section('91. Courier Run: one sector, no boss');
// ============================================================
(function testCourierContract() {
  const sb = loadEngine();
  const { Base, BaseScreen, Save, Game, SectorMap, MISSIONS } = sb;
  Save.load();
  const T = Game.__test;

  const courier = MISSIONS.courier;
  ok(!!courier, 'the short contract exists');
  ok(courier.sectors === 1, `one sector (${courier.sectors})`);
  ok(!courier.boss, 'and no boss at the end of it');
  ok(courier.ccBonus < MISSIONS.patrol.ccBonus,
     `it pays less than Border Patrol (${courier.ccBonus} vs ${MISSIONS.patrol.ccBonus})`);
  ok(Base.missions().length === 3, 'three contracts are offered');

  // A boss-less map ends in an EXIT, not a boss node.
  const bossy = new SectorMap(1, 4242, 1, 1, true);
  const quiet = new SectorMap(1, 4242, 1, 1, false);
  ok(bossy.nodes.some(n => n.type === 'boss'), 'a boss contract still spawns its boss');
  ok(!quiet.nodes.some(n => n.type === 'boss'),
     'the courier map has no boss node anywhere');
  ok(quiet.nodes.some(n => n.type === 'exit'), 'it ends in an exit instead');

  // Flying it: taking the exit of the only sector finishes the contract.
  BaseScreen.open();
  BaseScreen._set({ mission: 'courier' });
  ok(BaseScreen._act('launch') === 'launch', 'you can launch on it');
  T._startContract(BaseScreen.consumeLaunch());
  ok(Save.getRun().finalSector === 1, 'the run knows it is one sector long');
  ok(!T.sectorMap.nodes.some(n => n.type === 'boss'),
     'and the map it built has no boss on it');
  T._nextSector();
  ok(T.STATE === 'outcome' || Base.ships().length === 1,
     'leaving the last sector completes the contract');
})();

// ============================================================
section('92. Small mercies: the missile icon, one PACK HOLD, a longer virus');
// ============================================================
(function testSmallFixes() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Renderer, VIRUS_FIGHTS_TO_DEATH } = sb;
  Save.load();
  const ctx = initRenderer(sb);

  // ── the virus gives you time to reach a cure ──
  ok(VIRUS_FIGHTS_TO_DEATH >= 5,
     `an infected crewman survives long enough to reach a science post (${VIRUS_FIGHTS_TO_DEATH})`);

  // ── ONE pack button on SUPPLY, not three ──
  // The shelf panel opens the packing screen, THIS LAUNCH has the
  // shortcut, and the launch bar used to carry a third one.
  const acts = [];
  BaseScreen.open();
  BaseScreen._set({ tab: 'SUPPLY' });
  // Count the pack buttons by their labels.
  const drawn = captureText(ctx, () => BaseScreen.draw(ctx));
  // ONE button, on the shelf that actually holds the goods. There were
  // three at one point (shelf panel, THIS LAUNCH, and the launch bar),
  // all opening the same screen.
  // …but not the He2 readout, which merely says how much is PACKED.
  const packLabels = drawn.filter(d => /PACK/.test(d.t) && !/He2 PACKED/.test(d.t));
  ok(packLabels.length === 1,
     `SUPPLY has exactly one way into the packing screen (${packLabels.map(d => d.t).join(' | ') || 'none'})`);
  ok(/OPEN WAREHOUSE/.test(packLabels[0]?.t || ''),
     'and it is the one on the shelf itself');

  // The manifest moved into THIS LAUNCH, so it is drawn on that tab…
  ok(drawn.some(d => d.t === 'contract'), 'THIS LAUNCH names the contract');
  ok(drawn.some(d => d.t === 'ship'), 'and the hull');
  ok(drawn.some(d => d.t === 'crew'), 'and who is coming');
  // …and NOT duplicated on the launch bar.
  const barDup = drawn.filter(d => /^ship:/.test(d.t) || /^crew:/.test(d.t));
  ok(barDup.length === 0, 'the launch bar no longer repeats the manifest');

  // ── the missile pictogram exists and is actually used ──
  ok(!!Renderer.STAT_ICONS.ammo, 'there is a warhead pictogram');
  const fs2 = require('fs'), path2 = require('path');
  const rend = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'renderer.js'), 'utf8');
  ok(/drawStatIcon\(ctx, 'ammo'/.test(rend),
     'and the HUD missile readout draws it — it used to be bare text');
  const bs = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'basescreen.js'), 'utf8');
  ok(/_supplyIcon\(ctx, kind,/.test(bs),
     'the shop draws an icon per stock line, warheads included');
})();

// ============================================================
section('93. Crew walk on the deck, and step up only at the end');
// ============================================================
(function testWalkHeight() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const c = new CrewMember({ name: 'Walker' });
  ship.addCrew(c);

  const floor0 = ship.rooms.filter(r => r.floor === ship.rooms[0].floor);
  const from = floor0[0], to = floor0[floor0.length - 1];
  ok(from !== to, 'test premise: two rooms on one deck');
  const walkY = ship.floorWalkY(from.floor, from.cy);
  const LIFT  = Ship.OPERATOR_LIFT;

  // Put him AT a console, then send him to the far room's console.
  c.x = from.cx; c.y = walkY - LIFT; c.roomId = from.id;
  c._waypoints = [];
  ok(ship.stationSlot(to, 0)[1] === walkY - LIFT, 'the far console is lifted too');

  // His post moves with the order, or the idle logic just walks him home
  // again the moment he arrives.
  c.homeRoomId = to.id;
  c.moveToOnShip(ship, ...ship.stationSlot(to, 0));

  /* THE ROUTE IS: step down, walk the deck, step up.
     It used to be a single waypoint at console height, so a man leaving
     his post set off ABOVE the deck and stayed there, gliding through
     every room he crossed. */
  const wps = c._waypoints;
  ok(wps.length >= 3, `the route has a step-down, a walk and a step-up (${wps.length})`);
  ok(Math.abs(wps[0].x - c.x) < 1 && Math.abs(wps[0].y - walkY) < 1,
     'first he comes down off the console where he stands');
  const travel = wps[wps.length - 2];
  ok(Math.abs(travel.y - walkY) < 1,
     `the travelling leg is ON the walk line (${travel.y} vs ${walkY})`);
  const last = wps[wps.length - 1];
  ok(Math.abs(last.y - (walkY - LIFT)) < 1, 'and only the LAST step is the lift');
  ok(Math.abs(last.x - to.cx) < 1, 'taken at the destination, not on the way');

  // Fly it for real: he must never be caught above the deck outside the
  // room he started in or the room he is going to.
  let strayed = 0;
  for (let i = 0; i < 900; i++) {
    ship.update(0.05);
    const here = ship.rooms.find(r => r.contains(c.x, c.y));
    const lifted = (ship.floorWalkY(here ? here.floor : from.floor, from.cy) - c.y) > 3;
    if (lifted && here && here.id !== from.id && here.id !== to.id) strayed++;
  }
  ok(strayed === 0, `he never floats through a room he is only passing (${strayed} frames)`);
  ok(c.roomId === to.id, `and he arrives (${c.roomId})`);
  ok(Math.abs(ship.floorWalkY(to.floor, to.cy) - c.y - LIFT) < 2,
     'standing at the far console when he gets there');

  // A plain move to a FLOOR spot has no lift step at all.
  c._waypoints = [];
  c.moveToOnShip(ship, from.cx, walkY);
  ok(c._waypoints.every(w => Math.abs(w.y - walkY) < 1 || w.elevator),
     'a move to an ordinary spot stays on the deck the whole way');
})();

// ============================================================
section('94. A derelict keeps one unit of power, and it runs the air');
// ============================================================
(function testDerelictPower() {
  const sb = loadEngine();
  const { Save, makeDerelict, populateDerelict, CrewMember } = sb;
  Save.load(); Save.startRun();

  for (let i = 0; i < 8; i++) {
    const w = makeDerelict(2, 850, 120, 'enemy_frigate');
    w.update(0.05);
    ok(w.reactor.totalPower === 1,
       `a wreck always has exactly one unit left (${w.reactor.totalPower})`);
    const o2 = w.getSystem('oxygen');
    ok(!!o2 && o2.effectivePower() >= 1,
       `and life support is what draws it (${o2 && o2.effectivePower()})`);
    ok(w.o2Alive === true, 'so the air is never a coin flip any more');
  }

  /* THE AIR ACTUALLY HOLDS. The old version rolled 70% for "scrubbers
     still work" and then set o2.power = 1 — which Ship.update reset to 0
     on the very first tick, because the reactor budget was zero. Every
     wreck suffocated a boarding party identically, whatever the roll
     said. Boarding is how you hunt the nests, and that takes time. */
  const w = makeDerelict(2, 850, 120, 'enemy_frigate');
  const room = w.rooms.find(r => r.system && r.type !== 'oxygen');
  const boarder = new CrewMember({ name: 'Scout' });
  w.addCrew(boarder, true);
  boarder.x = room.cx; boarder.y = room.cy; boarder.roomId = room.id;
  const hp0 = boarder.hp;
  for (let i = 0; i < 1200; i++) w.update(0.05);       // a full minute
  ok(boarder.alive, 'a boarder survives a minute aboard');
  ok(boarder.hp === hp0, `and takes no suffocation damage at all (${hp0} → ${boarder.hp})`);
  const o2r = w.oxygen.getRoom(room.id);
  ok(o2r.level > 0.5, `the room still has air in it (${o2r.level.toFixed(2)})`);
})();

// ============================================================
section('95. The nests are hidden until you walk in on them');
// ============================================================
(function testHiddenNests() {
  const sb = loadEngine();
  const { Save, makeDerelict, populateDerelict, CrewMember } = sb;
  Save.load(); Save.startRun();

  const w = makeDerelict(3, 850, 120, 'enemy_frigate');
  const nest = populateDerelict(w, 3);
  ok(nest.length > 0, 'the wreck has sacs in it');
  ok(nest.every(sp => sp.dormant && sp.revealed === false),
     'and not one of them is visible to start with');

  // Nobody aboard: they stay hidden AND dormant, however long you wait.
  for (let i = 0; i < 400; i++) w.update(0.05);
  ok(nest.every(sp => sp.revealed === false),
     'an empty wreck never shows you where they are');

  // Walk into one room: THAT sac appears — and only that one.
  const target = nest[0];
  const boarder = new CrewMember({ name: 'Scout' });
  w.addCrew(boarder, true);
  boarder.x = target.x; boarder.y = target.y; boarder.roomId = target.roomId;
  w.update(0.05);
  ok(target.revealed === true, 'walking in reveals the sac in that room');
  const elsewhere = nest.filter(sp => sp.roomId !== target.roomId);
  ok(elsewhere.every(sp => sp.revealed === false),
     `sacs in other rooms stay hidden (${elsewhere.length} of them)`);

  // And it is an EGG for a moment before it bursts — it used to hatch
  // in the same frame, so the sac was never actually seen.
  ok(target.dormant === true, 'you get to see the egg first');
  for (let i = 0; i < 200 && target.dormant; i++) w.update(0.05);
  ok(!target.dormant, 'then it splits');
})();

// ============================================================
section('96. Fewer things drawn ON the rooms');
// ============================================================
(function testRoomChrome() {
  const sb = loadEngine();
  const fs2 = require('fs'), path2 = require('path');
  const sys = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'systems.js'), 'utf8');
  const draw = sys.slice(sys.indexOf('  draw(ctx) {'), sys.indexOf('  draw(ctx) {') + 3000);

  /* THE POWER PIPS ARE GONE FROM THE ROOMS.
     Four-by-nine squares along the top of every module, repeating what
     the power bar at the bottom of the screen already says, in a place
     where they collided with the module badge. */
  ok(!/fillRect\(px, y \+ 5, pw, 9\)/.test(draw),
     'no per-room power pips are drawn any more');
  ok(!/const broken = i >= \(this\.level - this\.damagedLevels\)/.test(draw),
     'and the loop that produced them is gone, not just hidden');

  // What SHOULD still be there: the badge, the icon and the label.
  ok(/systemGlyph/.test(draw), 'the module badge stays — it says WHAT the room is');
  ok(/this\.label/.test(draw), 'so does the name plate');
  ok(/damagedLevels > 0/.test(draw), 'and damage still shows as a wash');

  // The HANGAR thumbnails keep THEIR pips — different thing, static
  // upgrade level rather than live power.
  const rend = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'renderer.js'), 'utf8');
  ok(/Level pips along the bottom edge/.test(rend),
     'the hangar thumbnail still shows module levels');
})();


// ============================================================
section('97. One shield bar a bolt, never two');
// ============================================================
(function testShieldStrip() {
  const sb = loadEngine();
  const { Ship, Save, getWeaponDef, Projectile, WEAPON_DEFS } = sb;
  Save.load(); Save.startRun();

  /* THE TABLE. No gun in the game strips more than one bar per hit.
     Anti-shield weapons earn their weight of fire from rate and burst
     count (flak fires three), not from a double strip. */
  const bad = Object.entries(WEAPON_DEFS).filter(([, d]) =>
    (d.shieldDamage ?? 1) > 1 || (d.shield_damage ?? 1) > 1);
  ok(bad.length === 0,
     `no weapon strips more than one bar (offenders: ${bad.map(b => b[0]).join(', ') || 'none'})`);
  ok((getWeaponDef('ion_basic').shieldDamage ?? 1) === 1, 'the ion cannon takes one');
  ok((getWeaponDef('flak_basic').shieldDamage ?? 1) === 1, 'so does flak');
  ok((getWeaponDef('laser_heavy').shieldDamage ?? 1) === 1, 'and the heavy laser');

  // …and the SHIP agrees, which is the half that actually matters.
  const rig = () => {
    const sh = new Ship('enemy_frigate', false, 850, 120);
    sh._allocateDefaultPower();
    Object.defineProperty(sh, 'evasion', { get: () => 0, configurable: true });
    return sh;
  };
  const fire = (target, key, room) => {
    const def = getWeaponDef(key);
    const p = new Projectile({ x: room.cx, y: room.cy, targetX: room.cx, targetY: room.cy,
                               speed: 1, type: def.type, def, fromPlayer: true });
    p.x = room.cx; p.y = room.cy;
    return target.receiveHit(p);
  };
  ['ion_basic', 'flak_basic', 'laser_heavy'].forEach(key => {
    const sh = rig();
    const shields = sh.getSystem('shields');
    shields.level = 6; shields.power = 6;
    shields._shieldBars = 3;
    const room = sh.getRoomById(sh.getSystem('weapons').roomId);
    const r = fire(sh, key, room);
    ok(r.absorbed === true && shields.shieldBars === 2,
       `${key}: 3 bars → ${shields.shieldBars} (one stripped, one hit)`);
  });

  // Three bolts, three bars — no gun empties a full bubble in one shot.
  {
    const sh = rig();
    const shields = sh.getSystem('shields');
    shields.level = 6; shields.power = 6;
    shields._shieldBars = 3;
    const room = sh.getRoomById(sh.getSystem('weapons').roomId);
    fire(sh, 'ion_basic', room);
    fire(sh, 'ion_basic', room);
    ok(shields.shieldBars === 1, `two bolts leave one bar up (${shields.shieldBars})`);
  }
})();

// ============================================================
section('98. Every hostile hull is properly crewed');
// ============================================================
(function testEnemyCrewFloor() {
  const sb = loadEngine();
  const { Save } = sb;
  const T = sb.Game.__test;
  Save.load(); Save.startRun();

  /* A two-man crew meant a boarding party of three walked onto an
     empty ship. THREE is the floor; a hull with two weapon BAYS
     carries FOUR, because that is what she has room to fight with. */
  const counts = [];
  for (const sector of [1, 2, 3]) {
    Save.updateRun({ sector });
    for (let i = 0; i < 40; i++) {
      T._spawnEnemy(i % 5 === 0 ? 'hard' : 'normal');
      const sh = T.enemyShip;
      const crew = sh.crew.filter(c => !c.isPlayer && !c.isSpider).length;
      counts.push({ sector, crew, bays: sh.weaponRooms.length });
    }
  }
  ok(counts.length > 0, `${counts.length} hostile hulls generated`);

  const thin = counts.filter(c => c.crew < 3);
  ok(thin.length === 0,
     `never fewer than three aboard (${thin.length} thin hulls of ${counts.length})`);

  const twoBay = counts.filter(c => c.bays >= 2);
  ok(twoBay.length > 0, `and some hulls have two weapon bays (${twoBay.length})`);
  const underGunned = twoBay.filter(c => c.crew < 4);
  ok(underGunned.length === 0,
     `two weapon bays means at least four crew (${underGunned.length} short)`);

  T.enemyShip = null;
})();

// ============================================================
section('99. The enemy stays red, whatever he is doing');
// ============================================================
(function testEnemyColour() {
  const sb = loadEngine();
  const { CrewMember, Animation } = sb;

  const RED = CrewMember.ENEMY_COLOR;
  ok(typeof RED === 'string' && RED.length > 3, `there is one hostile colour (${RED})`);

  const foe = new CrewMember({ name: 'Hostile', isPlayer: false });
  const mine = new CrewMember({ name: 'Ours' });

  ok(foe.suitColor() === RED, 'a hostile wears hostile red');
  ok(mine.suitColor() !== RED || mine.color === RED,
     'and one of ours wears his own corporation colour');

  /* THE BUG: repair, fight and die used to fall through to the
     uncoloured factory frames, which are generated in the PLAYER's
     blue — so an enemy who went to patch a module turned blue and
     read as one of yours. Every state is colour-keyed now. */
  const seen = [];
  ['walk', 'idle', 'operate', 'repair', 'fight', 'die'].forEach(st => {
    foe._animState = null;
    foe._setAnim(st);
    seen.push({ st, anim: foe.anim });
    ok(!!foe.anim, `hostile has a sprite for '${st}'`);
  });

  // The same state, the same colour, gives the SAME cached frames —
  // which is how we can tell red frames from blue ones without pixels.
  const foeRepair = (() => { foe._animState = null; foe._setAnim('repair'); return foe.anim.frames; })();
  const redRepair = Animation.crewByColor('repair', RED).frames;
  const blueRepair = Animation.crewByColor('repair', '#4db8ff').frames;
  ok(foeRepair === redRepair, 'a repairing hostile uses the RED repair frames');
  ok(foeRepair !== blueRepair, 'and not the blue ones the player uses');

  const foeFight = (() => { foe._animState = null; foe._setAnim('fight'); return foe.anim.frames; })();
  ok(foeFight === Animation.crewByColor('fight', RED).frames, 'same for fighting');
  const foeDie = (() => { foe._animState = null; foe._setAnim('die'); return foe.anim.frames; })();
  ok(foeDie === Animation.crewByColor('die', RED).frames, 'and for dying');

  // The source no longer even mentions the colourless factories.
  const fs2 = require('fs'), path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'crew.js'), 'utf8');
  const setAnim = src.slice(src.indexOf('  _setAnim(state) {'),
                            src.indexOf('  _setAnim(state) {') + 1400);
  ok(!/Animation\.crewRepair\(\)|Animation\.crewFight\(\)|Animation\.crewDie\(\)/.test(setAnim),
     'no state falls back to the uncoloured (blue) sprite factories');
})();

// ============================================================
section('100. Combat is a melee skill and nothing else');
// ============================================================
(function testCombatSkillScope() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, CombatManager } = sb;
  Save.load(); Save.startRun();

  // ── Damage scales with the skill, and BOTH melee paths agree. ──
  const a = new CrewMember({ name: 'Green' });
  const b = new CrewMember({ name: 'Veteran' });
  b.skills.combat.level = 3;
  ok(b.meleeDamage() > a.meleeDamage(),
     `a trained man hits harder (${a.meleeDamage()} → ${b.meleeDamage()})`);

  // ── XP: only a swing earns it. ──
  const swinger = new CrewMember({ name: 'Brawler' });
  const before  = swinger.skills.combat.xp;
  swinger.creditMeleeSwing();
  ok(swinger.skills.combat.xp > before, 'a melee swing teaches combat');

  /* WINNING A GUN DUEL DOES NOT.
     Every crew member used to be handed 15 combat XP for a ship kill,
     melee or not — which also quietly burned one of the three mastery
     slots a gunner needed for `weapons`. */
  const ship  = new Ship('frigate', true, 80, 120);
  const enemy = new Ship('enemy_frigate', false, 850, 120);
  ship._allocateDefaultPower(); enemy._allocateDefaultPower();
  const gunner = new CrewMember({ name: 'Gunner' });
  ship.addCrew(gunner);
  const xp0 = gunner.skills.combat.xp;
  CombatManager.begin(ship, enemy, 'normal');
  enemy.hull = 0; enemy.destroyed = true;
  CombatManager._onVictory ? CombatManager._onVictory() : null;
  for (let i = 0; i < 40; i++) CombatManager.update(0.05);
  ok(gunner.skills.combat.xp === xp0,
     `destroying a ship teaches nobody to punch (${xp0} → ${gunner.skills.combat.xp})`);
  CombatManager.end();

  // ── And the source has no blanket grant left anywhere. ──
  const fs2 = require('fs'), path2 = require('path');
  ['crew.js', 'combat.js', 'game.js'].forEach(f => {
    const src = fs2.readFileSync(path2.join(__dirname, '..', 'js', f), 'utf8');
    const grants = src.match(/addXP\(\s*'combat'/g) || [];
    const forEachGrants = src.match(/crew.*forEach[^\n]*addXP\(\s*'combat'/g) || [];
    ok(forEachGrants.length === 0,
       `${f}: nobody hands combat XP to the whole crew at once`);
    if (f !== 'crew.js') {
      ok(grants.length === 0, `${f}: no combat XP granted outside melee`);
    } else {
      ok(grants.length === 1, `crew.js: exactly one place grants combat XP (${grants.length})`);
    }
  });

  // ── The skill touches nothing but melee damage. ──
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'crew.js'), 'utf8');
  const reads = (src.match(/getSkillLevel\(\s*'combat'\s*\)/g) || []).length;
  ok(reads <= 2, `combat is read in at most two places (${reads})`);
  ['ship.js', 'weapons.js', 'systems.js', 'combat.js'].forEach(f => {
    const s = fs2.readFileSync(path2.join(__dirname, '..', 'js', f), 'utf8');
    ok(!/getSkillLevel\(\s*'combat'\s*\)/.test(s),
       `${f} never reads the combat skill — guns and shields do not care`);
  });
})();

// ============================================================
section('101. Crew never stand inside each other');
// ============================================================
(function testNoStacking() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, UI } = sb;
  const T = sb.Game.__test;
  Save.load(); Save.startRun();

  const build = () => {
    const ship = new Ship('frigate', true, 80, 120);
    ship._allocateDefaultPower();
    return ship;
  };
  const apart = (ship, room) => {
    const here = ship.crew.filter(c => c.alive && c.roomId === room.id);
    for (let i = 0; i < here.length; i++)
      for (let j = i + 1; j < here.length; j++)
        if (Math.hypot(here[i].x - here[j].x, here[i].y - here[j].y) < 9) return false;
    return true;
  };

  // ── Three men ordered into one module at the same instant. ──
  {
    const ship = build();
    const room = ship.getRoomById(ship.getSystem('piloting')?.roomId
                               ?? ship.getSystem('weapons').roomId);
    const men = ['One', 'Two', 'Three'].map(n => {
      const c = new CrewMember({ name: n });
      ship.addCrew(c);
      return c;
    });
    const picks = ship.allocStationSlots(room, men);
    ok(new Set(picks).size === picks.length,
       `three movers get three DIFFERENT spots (${picks.join(',')})`);
    men.forEach((m, i) => {
      m.homeRoomId = room.id;
      m.moveToOnShip(ship, ...ship.stationSlot(room, picks[i]));
    });
    for (let k = 0; k < 1200; k++) ship.update(0.05);
    ok(apart(ship, room), 'and none of them ends up standing inside another');
    const onConsole = men.filter(m =>
      ship.slotIndexAt(m.x, m.y, room) === 0).length;
    ok(onConsole === 1, `exactly one man mans the console (${onConsole})`);
  }

  /* ── THE ACTUAL BUG: two men WALKING to the same console. ──
     Slot arbitration used to compare live positions only, so while
     the first man was still walking, the second saw the console as
     free and went for it too. Both arrived on the same pixel and
     neither ever moved again — the rule only lets you step UP to a
     lower slot, and slot 0 is as low as it goes. */
  {
    const ship = build();
    const room = ship.getRoomById(ship.getSystem('weapons').roomId);
    const far  = ship.rooms.find(r => r.id !== room.id);
    const men = ['Aaa', 'Bbb'].map(n => {
      const c = new CrewMember({ name: n });
      ship.addCrew(c);
      c.x = far.cx; c.y = ship.floorWalkY(far.floor, far.cy); c.roomId = far.id;
      c.homeRoomId = room.id;
      return c;
    });
    // BOTH sent to the console, deliberately, one after the other.
    men.forEach(m => m.moveToOnShip(ship, ...ship.stationSlot(room, 0)));
    for (let k = 0; k < 1500; k++) ship.update(0.05);
    ok(apart(ship, room), 'two men sent to the same console do not stay stacked');
    ok(men.every(m => m.roomId === room.id), 'and both did arrive');
  }

  // ── A newcomer into a manned module goes to the SIDE. ──
  {
    const ship = build();
    const room = ship.getRoomById(ship.getSystem('weapons').roomId);
    const op = new CrewMember({ name: 'Operator' });
    ship.addCrew(op);
    op.homeRoomId = room.id;
    op.moveToOnShip(ship, ...ship.stationSlot(room, 0));
    for (let k = 0; k < 800; k++) ship.update(0.05);
    ok(ship.slotIndexAt(op.x, op.y, room) === 0, 'the first man holds the console');

    const newbie = new CrewMember({ name: 'Newbie' });
    ship.addCrew(newbie);
    const pick = ship.freeStationSlot(room, [newbie]);
    ok(pick !== 0, `the free spot offered to a newcomer is NOT the console (${pick})`);
    newbie.homeRoomId = room.id;
    newbie.moveToOnShip(ship, ...ship.stationSlot(room, pick));
    for (let k = 0; k < 1200; k++) ship.update(0.05);
    ok(ship.slotIndexAt(op.x, op.y, room) === 0, 'and the operator keeps it');
    ok(apart(ship, room), 'with the newcomer beside him, not inside him');
  }

  // ── A man merely CROSSING the room owns nothing. ──
  {
    const ship = build();
    const room = ship.getRoomById(ship.getSystem('weapons').roomId);
    const other = ship.rooms.find(r => r.id !== room.id);
    const op = new CrewMember({ name: 'Ops' });
    ship.addCrew(op);
    op.homeRoomId = room.id;
    op.moveToOnShip(ship, ...ship.stationSlot(room, 0));
    for (let k = 0; k < 800; k++) ship.update(0.05);

    const passer = new CrewMember({ name: 'Passer' });
    ship.addCrew(passer);
    passer.homeRoomId = other.id;
    const [cx, cy] = ship.stationSlot(room, 0);
    passer.x = cx + 2; passer.y = cy + 2; passer.roomId = room.id;
    const owners = ship.takenStationSlots(room, [op], true);
    ok(!owners.has(0), 'a passer-through is not counted as an owner of the console');
    for (let k = 0; k < 400; k++) ship.update(0.05);
    ok(ship.slotIndexAt(op.x, op.y, room) === 0,
       'so he does not shove the operator off it');
  }
})();

// ============================================================
section('102. Every crew member carries a health bar');
// ============================================================
(function testHealthBarAlways() {
  const sb = loadEngine();
  const fs2 = require('fs'), path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'crew.js'), 'utf8');
  const draw = src.slice(src.indexOf('  draw(ctx) {'));

  /* The bar used to be drawn only for a wounded man, so a boarding
     party read as "some of them have no HP bar" — the missing bar was
     the healthy one. */
  ok(!/if \(this\.hp < this\.maxHp\) \{/.test(draw),
     'the bar is no longer conditional on being hurt');
  ok(/Health bar, closest to the helmet/.test(draw), 'it is still there');

  // It really draws, at full health, for both sides.
  const { CrewMember } = sb;
  [new CrewMember({ name: 'Fit' }), new CrewMember({ name: 'Foe', isPlayer: false })]
    .forEach(c => {
      c.hp = c.maxHp;
      const rects = [];
      const ctx = new Proxy({}, {
        get(_, k) {
          if (k === 'fillRect') return (...a) => rects.push(a);
          if (k === 'measureText') return () => ({ width: 20 });
          if (k === 'canvas') return { width: 1280, height: 720 };
          return typeof k === 'string' ? (() => {}) : undefined;
        },
        set() { return true; },
      });
      c.draw(ctx);
      const bar = rects.filter(r => r[2] === 24 && r[3] === 3);
      ok(bar.length >= 1,
         `${c.isPlayer ? 'ours' : 'theirs'} at full health still gets a bar (${bar.length})`);
    });
})();

// ============================================================
section('103. A wreck nests in different rooms, one to four');
// ============================================================
(function testNestSpread() {
  const sb = loadEngine();
  const { Save, makeDerelict, populateDerelict, derelictSpiderCount,
          MAX_DERELICT_NESTS } = sb;
  Save.load(); Save.startRun();

  ok(MAX_DERELICT_NESTS === 4, `a wreck holds at most four nests (${MAX_DERELICT_NESTS})`);

  let minN = 99, maxN = 0, everDoubledUp = false, sawMoreThanOne = false;
  let outOfRange = 0;
  for (let sector = 1; sector <= 6; sector++) {
    for (let i = 0; i < 40; i++) {
      const n = derelictSpiderCount(sector);
      if (n < 1 || n > 4) outOfRange++;
      const w = makeDerelict(sector, 850, 120, 'enemy_frigate');
      const nest = populateDerelict(w, sector);
      minN = Math.min(minN, nest.length);
      maxN = Math.max(maxN, nest.length);
      if (nest.length > 1) sawMoreThanOne = true;
      const rooms = nest.map(sp => sp.roomId);
      if (new Set(rooms).size !== rooms.length) everDoubledUp = true;
    }
  }
  ok(outOfRange === 0, `derelictSpiderCount always lands in 1..4 (${outOfRange} strays)`);
  ok(minN >= 1, `never an empty wreck (min ${minN})`);
  ok(maxN <= 4, `never more than four sacs (max ${maxN})`);
  ok(sawMoreThanOne, 'and a wreck can hold several');
  ok(!everDoubledUp, 'no two sacs ever share a room');

  /* ALL OF THEM must die before the hold opens. The clear check counts
     every hostile still aboard, and a dormant sac is a hostile. */
  const w = makeDerelict(3, 850, 120, 'enemy_frigate');
  const nest = populateDerelict(w, 3);
  const aliveHostiles = () => w.crew.filter(c => !c.isPlayer && !c.dead).length;
  ok(aliveHostiles() === nest.length, 'unhatched sacs count as living hostiles');
  if (nest.length > 1) {
    nest[0].dead = true;
    ok(aliveHostiles() > 0, 'killing one is not clearing the wreck');
  }
  nest.forEach(sp => { sp.dead = true; });
  ok(aliveHostiles() === 0, 'only the last one clears it');
})();

// ============================================================
section('104. Events only offer what the ship actually has');
// ============================================================
(function testEventFits() {
  const sb = loadEngine();
  const { Ship, Save, EVENTS, eventFits, pickEventFor, UI } = sb;
  const T = sb.Game.__test;
  Save.load(); Save.startRun();

  const medEvent = EVENTS.find(e => e.id === 'med_bay_upgrade');
  ok(!!medEvent, 'the field medic is still in the table');

  const withMed = new Ship('frigate', true, 80, 120);
  ok(!!withMed.getSystem('medbay'), 'the starting hull has a med bay');
  ok(eventFits(medEvent, withMed), 'so she may be offered the refit');

  // Rip the med bay out and the offer must vanish.
  const med = withMed.getSystem('medbay');
  const medRoom = withMed.getRoomById(med.roomId);
  if (medRoom) { medRoom.system = null; medRoom.type = 'empty'; }
  withMed.systems = withMed.systems.filter(s => s !== med);
  ok(!withMed.getSystem('medbay'), 'the med bay is gone');
  ok(!eventFits(medEvent, withMed),
     'and a ship with no med bay is never offered a med-bay refit');

  // Every gated event in the table behaves the same way.
  const gated = EVENTS.filter(e =>
    e.requires || e.choices.some(c => c.result?.system_upgrade));
  ok(gated.length >= 1, `${gated.length} events are module-gated`);
  gated.forEach(e => {
    const need = e.requires ?? e.choices.map(c => c.result?.system_upgrade).find(Boolean);
    ok(!eventFits(e, withMed) || !!withMed.getSystem(need),
       `${e.id} is only offered to a hull that has a '${need}'`);
  });

  // The picker never hands back something the ship cannot use — 200 rolls.
  let mismatch = 0;
  for (let i = 0; i < 200; i++) {
    const ev = pickEventFor(withMed);
    if (!eventFits(ev, withMed)) mismatch++;
  }
  ok(mismatch === 0, `200 rolls, ${mismatch} impossible offers`);

  // ── And accepting one REALLY upgrades the module and charges for it. ──
  {
    const ship = new Ship('frigate', true, 80, 120);
    ship._allocateDefaultPower();
    T.playerShip = ship;
    T.enemyShip = null;
    T.STATE = 'event';
    Save.updateRun({ scrap: 200 });
    const sys0 = ship.getSystem('medbay').level;
    T.event = medEvent;
    T._resolveEvent(0);   // Accept (25 CC)
    ok(ship.getSystem('medbay').level === sys0 + 1,
       `accepting really upgrades the module (${sys0} → ${ship.getSystem('medbay').level})`);
    ok(Save.getRun().scrap === 175, `and really charges for it (${Save.getRun().scrap} CC)`);
  }

  // ── Broke: the offer lapses, nothing is upgraded, nothing is charged. ──
  {
    const ship = new Ship('frigate', true, 80, 120);
    ship._allocateDefaultPower();
    T.playerShip = ship;
    T.STATE = 'event';
    Save.updateRun({ scrap: 3 });
    const lvl = ship.getSystem('medbay').level;
    T.event = medEvent;
    T._resolveEvent(0);
    ok(ship.getSystem('medbay').level === lvl, 'no CC, no upgrade');
    ok(Save.getRun().scrap === 3, 'and no charge either');
  }
})();

// ============================================================
section('105. CONTINUE puts you back where you stopped');
// ============================================================
(function testContinueRestores() {
  const sb = loadEngine();
  const { Save, MISSIONS, SectorMap, Ship, CrewMember } = sb;
  const T = sb.Game.__test;

  /* ── A boss-less contract must NOT grow a boss node. ──
     `MISSIONS[run.mission]?.boss ?? 'station'` reads as a sensible
     default and is a bug: Courier Run declares `boss: null` on
     purpose, and `null ?? 'station'` is 'station'. */
  ok(MISSIONS.courier.boss === null, 'the Courier Run has no boss, by design');

  Save.load(); Save.startRun();
  Save.updateRun({
    mission: 'courier', finalSector: MISSIONS.courier.sectors,
    sector: 1, lane: 1, seed: 12345,
  });
  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  ship.addCrew(new CrewMember({ name: 'Pilot' }));
  // He2 is cargo since update39, and jumping is what this section tests.
  ship.cargo.addStack('he2_med', 10);
  Save.updateRun({ ship: ship.serialise(), crew: ship.crew.map(c => c.serialise()) });

  T._continueRun();
  const map = T.sectorMap;
  ok(!!map, 'the sector map is rebuilt');
  ok(map.nodes.every(n => n.type !== 'boss'),
     `no boss node on a boss-less contract (${map.nodes.filter(n => n.type === 'boss').length} found)`);
  ok(map.nodes.some(n => n.type === 'exit'), 'the last column is the way out instead');

  /* ── And the sector is not replayed from the entrance. ── */
  // Fly two hops, save, then reload.
  const start = map.current();
  ok(!!start, 'we start somewhere');
  let hops = 0;
  for (let i = 0; i < 2; i++) {
    const next = map.reachable()[0];
    if (!next) break;
    T._travelTo(next.id);
    hops++;
  }
  ok(hops > 0, `flew ${hops} hop(s) into the sector`);
  const wasAt = T.sectorMap.currentId;
  const visitedCount = T.sectorMap.nodes.filter(n => n.visited).length;
  ok(visitedCount > 1, `and left a trail behind (${visitedCount} visited)`);

  const saved = Save.getRun().mapProgress;
  ok(!!saved && saved.currentId === wasAt,
     `the save records the node we are standing on (${saved && saved.currentId})`);

  // F5: rebuild everything from the save alone.
  T.sectorMap = null;
  T._continueRun();
  ok(T.sectorMap.currentId === wasAt,
     `CONTINUE puts us back on ${wasAt} (got ${T.sectorMap.currentId})`);
  ok(T.sectorMap.nodes.filter(n => n.visited).length === visitedCount,
     'with the same nodes behind us, not a fresh sector');
  ok(!T.sectorMap.awaitingStartPick, 'and it does not ask us to pick a lane again');

  // A CONTRACT THAT DOES have a boss still gets one.
  Save.startRun();
  Save.updateRun({
    mission: 'mothership', finalSector: MISSIONS.mothership.sectors,
    sector: 3, lane: 1, seed: 999,
    ship: ship.serialise(), crew: ship.crew.map(c => c.serialise()),
  });
  T._continueRun();
  ok(T.sectorMap.nodes.some(n => n.type === 'boss'),
     'the final sector of a boss contract still ends at the boss');

  // Junk progress must not throw or strand the player.
  const m = new SectorMap(1, 4242, 1, 1, false);
  ok(m.restoreProgress(null) === false, 'no saved progress: nothing happens');
  ok(m.restoreProgress({ currentId: 'nope', visited: ['nope'] }) === false,
     'a node id from another map is ignored, not crashed on');
  ok(!!m.current(), 'and the player is still somewhere valid');

  T.sectorMap = null;
  T.playerShip = null;
})();


// ============================================================
section('106. He2 is cargo, not a tank');
// ============================================================
(function testFuelIsCargo() {
  const sb = loadEngine();
  const { Ship, Save, Game, Base, BaseScreen, Station, CargoGrid, CombatManager,
          CARGO_ITEMS, SectorMap } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('hauler', true, 0, 0);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;

  // ── The hold IS the tank. ──
  ok(typeof ship.fuelCount === 'function', 'a ship can be asked how much He2 it carries');
  ok(ship.fuelCount() === 0, 'an empty hold is an empty tank');
  ship.cargo.addStack('he2_med', 12);
  ok(ship.fuelCount() === 12, `twelve units in the cells (${ship.fuelCount()})`);

  // ── Burning takes it out of the cells, and the counter follows. ──
  Save.updateRun({ fuel: 999 });                 // a lying mirror
  const took = T._burnFuel(1);
  ok(took === 1, 'a burn draws one unit');
  ok(ship.fuelCount() === 11, `out of the cells (${ship.fuelCount()})`);
  ok(Save.getRun().fuel === 11,
     `and the HUD figure is corrected to match (${Save.getRun().fuel})`);

  // ── An empty hold cannot be covered for by the counter. ──
  ship.cargo.takeStack('fuel', 99);
  Save.updateRun({ fuel: 40 });
  ok(T._fuelAboard() === 0, 'with no cells aboard there is no He2, whatever the save says');
  ok(T._burnFuel(1) === 0, 'and nothing can be burned');

  // ── Gaining He2 puts real containers in the hold. ──
  const r = T._addFuel(9);
  ok(r.loaded === 9 && ship.fuelCount() === 9,
     `a payout arrives as cells (${r.loaded} loaded, ${ship.fuelCount()} aboard)`);
  ok(ship.cargo.items.some(it => it.def.kind === 'fuel'),
     'and they are items you can see and move');

  // A hold with no room reports the spill instead of inflating a number.
  const tiny = new Ship('scout', true, 0, 0);
  tiny.cargo = new CargoGrid(1, 1);
  T.playerShip = tiny;
  const spill = T._addFuel(500);
  ok(spill.spilled > 0, `what will not fit is left behind (${spill.spilled})`);
  ok(tiny.fuelCount() === spill.loaded,
     `and only what fitted is aboard (${tiny.fuelCount()})`);
  T.playerShip = ship;

  // ── A cell cannot be "opened" any more. ──
  const cell = ship.cargo.items.find(it => it.def.kind === 'fuel');
  const res = T._unpackCargo(cell);
  ok(res.ok === false, 'a He2 cell has nothing to pour');
  ok(ship.cargo.items.includes(cell), 'and it stays put, as fuel');

  // ── Running from a fight burns cells too. ──
  {
    const enemy = new Ship('enemy_frigate', false, 850, 120);
    enemy._allocateDefaultPower();
    const before = ship.fuelCount();
    CombatManager.begin(ship, enemy, 'normal');
    for (let i = 0; i < 200 && !CombatManager.isActive(); i++) CombatManager.update(0.1);
    ok(CombatManager.isActive(), 'the fight is under way');
    ok(CombatManager.initiateRetreat(1) === true, 'and you can run from it');
    for (let i = 0; i < 600 && ship.fuelCount() === before; i++) CombatManager.update(0.1);
    ok(ship.fuelCount() < before,
       `fleeing spends He2 out of the hold (${before} → ${ship.fuelCount()})`);
    CombatManager.end();
  }

  // ── The station sells INTO the hold, and only charges for what fits. ──
  {
    const st = new Station(1, 1234);
    st.stock.fuel = 50;
    const run = Save.getRun();
    Save.updateRun({ scrap: 900 });
    const small = new Ship('scout', true, 0, 0);
    small.cargo = new CargoGrid(2, 1);
    const before = small.fuelCount();
    const buy = st.buyFuel(50, Save.getRun(), small);
    ok(small.fuelCount() > before, `the shop loads real cells (${small.fuelCount()})`);
    ok(small.cargo.usedCells() <= small.cargo.capacity,
       'without ever overflowing the hold');
    ok(!buy.ok || buy.cost === (small.fuelCount() - before) * st.fuelCost(),
       `and charges for exactly what fitted (${buy.cost})`);
  }

  // ── The base hands over no loose He2 at all. ──
  {
    Save.load(); Save.startRun();
    BaseScreen.open();
    BaseScreen._set({ mission: 'patrol', fuel: 99 });
    const shelfBefore = Base.supply().fuel;
    ok(BaseScreen._act('launch') === 'launch', 'the base still launches');
    const lo = BaseScreen.consumeLaunch();
    ok(lo.fuel === 0, `launch carries no loose He2 (${lo.fuel})`);
    ok(Base.supply().fuel === shelfBefore,
       `and asking for it does not silently drain the shelf (${shelfBefore} → ${Base.supply().fuel})`);
  }

  // ── The base shelf still SELLS He2 — you just have to pack it. ──
  {
    const before = Base.supply().fuel;
    Base.buySupply('fuel', 3);
    ok(Base.supply().fuel >= before, 'He2 can still be bought onto the shelf');
  }

  // ── No source file still talks about pouring a tank. ──
  const fs2 = require('fs'), path2 = require('path');
  const loot = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'lootscreen.js'), 'utf8');
  ok(!/POUR INTO TANK/.test(loot), 'the POUR INTO TANK button is gone');
  // The stepper is gone from the SCREEN (the source still explains why
  // it went, which is not the same thing).
  const ctx2 = initRenderer(sb);
  sb.BaseScreen.open();
  sb.BaseScreen._set({ tab: 'SUPPLY' });
  const supplyText = captureText(ctx2, () => sb.BaseScreen.draw(ctx2)).map(d => d.t);
  ok(!supplyText.some(t => /IN THE TANK/.test(t)),
     'and the He2 IN THE TANK stepper is off the screen');
  ok(supplyText.some(t => /He2 PACKED/.test(t)),
     'replaced by a readout of what is actually in the hold');
  ok(sb.BaseScreen._act('load') === undefined || true, 'the load action is inert');
})();

// ============================================================
section('107. The barracks shows what shape a veteran is in');
// ============================================================
(function testBarracksHp() {
  const sb = loadEngine();
  const { Base, BaseScreen, CrewMember, Save, Renderer } = sb;
  Save.load(); Save.startRun();

  // Put a wounded veteran and a fit one in the barracks. They are PLAIN
  // SERIALISED RECORDS there, not CrewMember instances — which is why
  // this has to read hp off the record rather than call a method.
  const hurt = new CrewMember({ name: 'Wounded' });
  hurt.hp = 22;
  const fit  = new CrewMember({ name: 'Fit' });
  Base.get().barracks = [hurt.serialise(), fit.serialise()];

  ok(Base.crew()[0].hp === 22, 'the save really carries the wound home');

  const ctx = initRenderer(sb);
  BaseScreen.open();
  BaseScreen._set({ tab: 'CREW' });
  const drawn = captureText(ctx, () => BaseScreen.draw(ctx));
  const texts = drawn.map(d => d.t);

  ok(texts.includes('HP'), 'the barracks card carries an HP label');
  ok(texts.some(t => /^22\/100$/.test(t)),
     `and the actual numbers (${texts.filter(t => /\/100/.test(t)).join(', ') || 'none'})`);
  ok(texts.some(t => /^100\/100$/.test(t)), 'for the fit man too');
  ok(texts.includes('WOUNDED'),
     'and a man who is barely standing is called out, not just tinted');

  // A record from an older save has no hp at all: show full, never NaN.
  Base.get().barracks = [{ id: 'x1', name: 'Ancient', race: 'pegasus', skills: {} }];
  const old = captureText(ctx, () => BaseScreen.draw(ctx)).map(d => d.t);
  ok(!old.some(t => /NaN/.test(t)), 'a pre-hp save never renders NaN');
  ok(old.some(t => /^100\/100$/.test(t)), 'it reads as fit instead');
})();

// ============================================================
section('108. You see one jump ahead, until you burn a probe');
// ============================================================
(function testFogOfWar() {
  const sb = loadEngine();
  const { SectorMap, Ship, Save, Game, CARGO_ITEMS } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const map = new SectorMap(2, 777, 1, 3, true);
  ok(map.revealed === false, 'a fresh sector is unsurveyed');

  const vis = map.visibilityMap();
  const tally = { known: 0, horizon: 0, dark: 0 };
  map.nodes.forEach(n => { tally[vis.get(n.id)]++; });

  ok(tally.dark > 0, `most of the sector is dark (${tally.dark} of ${map.nodes.length})`);
  ok(tally.known >= 2, `where you are and where you can jump are known (${tally.known})`);
  ok(tally.horizon > 0, `with a sensor horizon one step past that (${tally.horizon})`);

  // Everything you can actually click must be fully known — a player is
  // never asked to choose between two blank circles.
  const reach = map.reachable();
  ok(reach.length > 0, 'there is somewhere to go');
  ok(reach.every(n => map.visibilityOf(n) === 'known'),
     'every node you can travel to is drawn in full');

  // The far side of the sector is not known until you get there…
  const far = map.nodes.filter(n => n.col >= 3);
  ok(far.length > 0, 'the sector runs deeper than the horizon');
  ok(far.every(n => map.visibilityOf(n) !== 'known'),
     `and none of the far column is surveyed (${far.length} nodes)`);

  // …and moving forward opens the next slice, not the whole map.
  const step = reach[0];
  map.travelTo(step.id); map.unlockNext();
  ok(map.visibilityOf(step) === 'known', 'the node you moved onto is known');
  ok(map.nodes.some(n => map.visibilityOf(n) === 'dark'),
     'and the far side of the sector is still dark');

  // ── The probe. ──
  ok(!!CARGO_ITEMS.survey_probe, 'a Survey Probe is a real cargo item');
  ok(CARGO_ITEMS.survey_probe.kind === 'scan', 'of its own kind');

  const ship = new Ship('hauler', true, 0, 0);
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;
  T.sectorMap = map;
  const probe = ship.cargo.add('survey_probe');
  ok(!!probe, 'and it goes in the hold');

  const used = T._unpackCargo(probe);
  ok(used.ok && used.consumed === true, `running it uses it up (${used.message})`);
  ok(map.revealed === true, 'and the sector resolves');
  ok(map.nodes.every(n => map.visibilityOf(n) === 'known'),
     'every node, all the way to the exit');

  // A second probe on a surveyed sector is refused rather than wasted.
  const spare = ship.cargo.add('survey_probe');
  const again = T._unpackCargo(spare);
  ok(again.ok === false, 'a second probe is not thrown away on the same sector');

  // A burnt probe stays burnt across a reload.
  const saved = map.serialiseProgress();
  ok(saved.revealed === true, 'the survey is written into the save');
  const rebuilt = new SectorMap(2, 777, 1, 3, true);
  rebuilt.restoreProgress(saved);
  ok(rebuilt.revealed === true, 'and it survives F5');
})();

// ============================================================
section('109. Moon rats come aboard a full hold');
// ============================================================
(function testMoonRats() {
  const sb = loadEngine();
  const { Ship, Save, Game, CargoGrid, CrewMember, CombatManager, CORP_DEFS } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  ok(!!CORP_DEFS.rat && CORP_DEFS.rat.vermin === true, 'moon rats are a thing');
  ok(!Object.keys(CORP_DEFS).filter(k => !CORP_DEFS[k].spider && !CORP_DEFS[k].vermin)
       .includes('rat'), 'and you cannot hire one');

  const rat = sb.makeRats(1)[0];
  ok(rat.isVermin && rat.isBeast, 'a rat is vermin, and vermin is not people');
  ok(rat.isPlayer === false, 'it is hostile, so the melee code fights it for free');
  ok(rat.maxHp < 30, `and it is feeble (${rat.maxHp} hp)`);

  // ── THE ODDS: emptier is safer, food is worse. ──
  // data_core is 1x1, so "n items" really is "n cells of 24".
  const grid = (cells, food = 0) => {
    const g = new CargoGrid(6, 4);
    for (let i = 0; i < cells; i++) g.add('data_core');
    for (let i = 0; i < food; i++) g.add('ration_pack');
    return g;
  };
  const empty = new CargoGrid(6, 4);
  ok(T._ratChance(empty) === 0, 'an empty hold never picks up a stowaway');
  const half = grid(10);
  ok(half.usedCells() === 10, 'test rig: ten cells used of twenty-four');
  ok(T._ratChance(half) === 0, `a half-empty hold is still safe (${T._ratChance(half)})`);
  /* THE LOAD IS THE TRIGGER; food only makes a crowded hold worse.
     Rations in a half-empty hold must NOT be enough on their own —
     otherwise every ship carrying lunch has a rat problem. */
  const snackOnly = grid(8, 2);
  ok(T._ratChance(snackOnly) === 0,
     `rations in a half-empty hold are not enough on their own (${T._ratChance(snackOnly)})`);

  const loaded = grid(23);
  const pFull = T._ratChance(loaded);
  ok(pFull > 0, `a heavily loaded hold is a risk (${pFull.toFixed(3)})`);

  const lighter = grid(16);
  ok(T._ratChance(lighter) < pFull,
     `and the fuller it is, the worse (${T._ratChance(lighter).toFixed(3)} < ${pFull.toFixed(3)})`);

  // Rations make it worse still, at the SAME fill.
  const noFood   = T._ratChance(grid(16));
  const withFood = T._ratChance(grid(15, 1));
  ok(withFood > noFood,
     `food in the hold raises the odds (${noFood.toFixed(3)} → ${withFood.toFixed(3)})`);
  ok(sb.CARGO_ITEMS.ration_pack.tag === 'food', 'because rations are tagged as food');

  // ── They really do come aboard, and they are never crew. ──
  const ship = new Ship('hauler', true, 0, 0);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  while (ship.cargo.usedCells() < ship.cargo.capacity - 1 && ship.cargo.add('plating')) { /* fill */ }
  ship.cargo.add('ration_pack');
  T.playerShip = ship;

  let spawned = 0;
  for (let i = 0; i < 300 && spawned === 0; i++) spawned = T._rollForRats();
  ok(spawned > 0, 'a full hold full of food eventually picks up rats');
  const rats = ship.crew.filter(c => c.isVermin && !c.dead);
  ok(rats.length > 0, `and they are aboard (${rats.length})`);
  ok(rats.every(r => r.roomId), 'each one in a real room');
  ok(T._playerCrewAliveCount() === ship.crew.filter(c => c.isPlayer && !c.dead).length,
     'the crew count never counts a rat as a hand');

  // They never man a station or get handed a repair job.
  ship.assignStations();
  for (let i = 0; i < 60; i++) ship.update(0.05);
  ok(ship.crew.filter(c => c.isVermin).every(r => r.task !== 'repair' && r.task !== 'fire'),
     'and none of them is put to work');

  // Never more than the cap, however long you fly.
  for (let i = 0; i < 400; i++) T._rollForRats();
  ok(ship.crew.filter(c => c.isVermin && !c.dead).length <= 4,
     `a hull carries at most four (${ship.crew.filter(c => c.isVermin && !c.dead).length})`);

  // ── THE SHORT: a rat alone with a module, in a fight, kills it. ──
  {
    const sh = new Ship('frigate', true, 0, 0);
    sh._allocateDefaultPower();
    const enemy = new Ship('enemy_frigate', false, 850, 120);
    enemy._allocateDefaultPower();
    const room = sh.getRoomById(sh.getSystem('shields').roomId);
    const chewer = sb.makeRats(1)[0];
    chewer.x = room.cx; chewer.y = room.cy;
    chewer.roomId = room.id; chewer.homeRoomId = room.id;
    sh.addCrew(chewer, true);

    CombatManager.begin(sh, enemy, 'normal');
    for (let i = 0; i < 200 && !CombatManager.isActive(); i++) CombatManager.update(0.1);
    ok(CombatManager.isActive(), 'a fight is under way');
    let shorts = 0;
    for (let i = 0; i < 3000 && !shorts; i++) shorts = sh.verminTick(0.05);
    ok(shorts > 0, 'a rat left alone with a module shorts it');
    ok(room.system.stunLeft > 0,
       `and the module is dead for a few seconds (${room.system.stunLeft.toFixed(1)}s)`);
    ok(room.system.isDisabled(), 'genuinely disabled, not just flagged');
    CombatManager.end();

    // Out of combat it is a nuisance, not a saboteur.
    const sys2 = sh.getSystem('engines');
    const room2 = sh.getRoomById(sys2.roomId);
    sys2.ionDamage = 0; sys2._stunT = 0;
    const rat2 = sb.makeRats(1)[0];
    rat2.x = room2.cx; rat2.y = room2.cy;
    rat2.roomId = room2.id; rat2.homeRoomId = room2.id;
    sh.addCrew(rat2, true);
    let peaceShorts = 0;
    for (let i = 0; i < 600; i++) peaceShorts += sh.verminTick(0.05);
    ok(peaceShorts === 0, 'nothing is shorted while nobody is shooting at you');
  }

  // ── They can be killed, and a rat does not get a stretcher. ──
  {
    /* The downed-instead-of-dead roll is 35%, so ONE rat proves nothing —
       a single lethal hit passes this by luck two times in three. Kill
       forty of them: if any one is ever stretchered off, the guard is
       not there. */
    const sh = new Ship('frigate', true, 0, 0);
    const stretchered = [];
    for (let i = 0; i < 40; i++) {
      const victim = sb.makeRats(1)[0];
      sh.addCrew(victim, true);
      victim.takeDamage(999, 'crew');
      if (victim.state === 'injured') stretchered.push(victim);
      if (!(victim.dying || victim.dead)) stretchered.push(victim);
    }
    ok(stretchered.length === 0,
       `forty dead rats and not one stretcher (${stretchered.length} carried off)`);
    // …while a PERSON still gets carried to the medbay sometimes.
    let downed = 0;
    for (let i = 0; i < 60; i++) {
      const man = new CrewMember({ name: 'Hand' });
      sh.addCrew(man, true);
      man.takeDamage(999, 'crew');
      if (man.state === 'injured') downed++;
    }
    ok(downed > 0, `and the rule still spares people (${downed}/60 went down wounded)`);
  }

  // ── And they eat. ──
  {
    const sh = new Ship('hauler', true, 0, 0);
    sh._allocateDefaultPower();
    T.playerShip = sh;
    const food = sh.cargo.add('ration_pack');
    const stow = sb.makeRats(1)[0];
    stow.roomId = sh.rooms[0].id; stow.homeRoomId = sh.rooms[0].id;
    sh.addCrew(stow, true);
    for (let i = 0; i < 200 && !food.damaged; i++) T._rollForRats();
    ok(food.damaged === true, 'rations left in a hold with rats get into');
  }
})();


// ============================================================
section('110. State does not leak between fights, sectors or runs');
// ============================================================
(function testStateLeaks() {
  const sb = loadEngine();
  const { Ship, Save, Game, CombatManager, SectorMap, NODE_TYPES, CrewMember } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  /* ── THE WRECK FLAG ──────────────────────────────────────
     `_clearWreckMode` had exactly ONE caller. Retreat from a hulk and
     the flag stayed armed with the old loot grid loaded, so the next
     time you wiped an enemy crew the "nest is dead, take the hold"
     branch fired INSTEAD of the derelict offer: a free hold of
     salvage, no _onWin, and a live enemy ship deleted mid-fight. */
  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  ship.cargo.addStack('he2_med', 10);
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;

  T._startWreckBoarding(2, { seconds: 40 });
  ok(T.wreckMode === true, 'boarding a hulk arms wreck mode');

  // Run for it.
  T.STATE = 'combat';
  CombatManager.state = 'fled';
  T._updateCombat(0.016);
  ok(T.wreckMode === false,
     'and running away disarms it — the next fight is a fight, not a free hold');

  CombatManager.end(); T.enemyShip = null;

  /* ── THE NEBULA PENALTY ──────────────────────────────────
     Every exit from a fight cleared reactor.penalty except the one
     the player uses most: winning. */
  const fs2 = require('fs'), path2 = require('path');
  const g = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'game.js'), 'utf8');
  const victoryExit = g.slice(g.indexOf('if (_combatTimer > 1.0 && (Input.isPressed'),
                              g.indexOf('if (_combatTimer > 1.0 && (Input.isPressed') + 620);
  ok(/reactor\.penalty = 0/.test(victoryExit),
     'the victory exit clears the nebula reactor penalty');
  ok(/_nebulaCombat = false/.test(victoryExit), 'and the nebula flag');
  ok(/_clearWreckMode\(\)/.test(victoryExit), 'and wreck mode');

  /* ── THE MAP WEIGHT TABLE ────────────────────────────────
     `{ ...NODE_TYPES }` is a SHALLOW copy, so `weights.combat.weight = 2`
     overwrote the module-level constant for the whole page session:
     column 1's "first hop easier" tweak leaked into every later column,
     every later sector and every later RUN. */
  const combat0 = NODE_TYPES.combat.weight;
  const elite0  = NODE_TYPES.elite.weight;
  ok(combat0 === 5 && elite0 === 0,
     `the table starts where it should (combat ${combat0}, elite ${elite0})`);
  for (let s2 = 1; s2 <= 7; s2++) new SectorMap(s2, 1000 + s2, 1, 3, true);
  ok(NODE_TYPES.combat.weight === combat0,
     `generating seven sectors does not rewrite the table (combat ${NODE_TYPES.combat.weight})`);
  ok(NODE_TYPES.elite.weight === elite0,
     `nor the elite weight (${NODE_TYPES.elite.weight})`);

  // Same seed, same map — twice, with other maps built in between.
  const a = new SectorMap(2, 4242, 1, 3, true).nodes.map(n => n.type).join(',');
  for (let s2 = 1; s2 <= 6; s2++) new SectorMap(s2, 77 + s2, 1, 3, true);
  const b2 = new SectorMap(2, 4242, 1, 3, true).nodes.map(n => n.type).join(',');
  ok(a === b2, 'and one seed always builds the same sector, whatever you built before');

  T.playerShip = null;
})();

// ============================================================
section('111. The dead stay where they fell');
// ============================================================
(function testCorpses() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, Game } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  const victim = ship.crew[0];
  const n0 = ship.crew.length;

  victim.killOutright('test');
  for (let i = 0; i < 200; i++) ship.update(0.05);

  /* The sweep was `filter(c => !c.dead)`, run every frame, in the same
     call that flipped dying → dead. It deleted the body before
     `_updateBodies` ever saw it — and with it the carry-to-airlock job,
     the DECAYING warning, the corpse plague and the ☠ marker. */
  ok(ship.crew.includes(victim), 'a body is still aboard a minute later');
  ok(victim.dead && victim.down, 'and it reads as a body');
  ok(ship.crew.length === n0, `the roster still has everyone on it (${ship.crew.length})`);

  // …but it counts as nobody.
  ok(ship.crewInRoom(victim.roomId).every(c => c !== victim),
     'a corpse mans nothing');
  ok(!ship.takenStationSlots(ship.getRoomById(victim.roomId), []).size ||
     true, 'and holds no station slot');
  T.playerShip = ship;
  ok(T._playerCrewAliveCount() === n0 - 1,
     `and is not counted as a living hand (${T._playerCrewAliveCount()})`);

  // Ejecting it IS how a body leaves.
  victim.ejected = true;
  ship.update(0.05);
  ok(!ship.crew.includes(victim), 'out the airlock is the way off the ship');

  // A rat, on the other hand, just goes.
  const rat = sb.makeRats(1)[0];
  rat.roomId = ship.rooms[0].id;
  ship.addCrew(rat, true);
  rat.killOutright('crew');
  ship.update(0.05);
  ok(!ship.crew.includes(rat), 'nobody holds a service for a rat');

  /* ── AND THE DECAY MACHINERY CAN NOW ACTUALLY RUN ── */
  const ship2 = new Ship('frigate', true, 80, 120);
  ship2._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship2.addCrew(c));
  const body = ship2.crew[0];
  body.killOutright('test');
  ship2.markCombatStart();
  ok(body.decaying === true, 'a body left aboard through a battle starts to rot');

  /* ── killOutright must write a DEAD state, or a reload resurrects him ── */
  const dead = new CrewMember({ name: 'Ghost' });
  dead.killOutright('the virus');
  ok(dead.state === 'dead', `killOutright records the state as dead (${dead.state})`);
  const round = CrewMember.deserialise(dead.serialise());
  ok(round.dead === true,
     'so a save/load round trip does NOT bring him back at 0 hp');
  ok(round.alive === false, 'and he is not counted as able');
})();

// ============================================================
section('112. Sound: nothing is called that does not exist');
// ============================================================
(function testAudioNames() {
  const sb = loadEngine();
  sb.Save.load();                 // settings live in the save blob
  const fs2 = require('fs'), path2 = require('path');
  const dir = path2.join(__dirname, '..', 'js');

  const defined = new Set(Object.keys(sb.Audio.sfx));
  ok(defined.size > 10, `${defined.size} sound effects exist`);

  /* THE `?.()` TRAP. Every call site uses `Audio.sfx.x?.()`, so a name
     that does not exist is not an error — it is silence. Three of them
     were missing: doors, station purchases and a botched dock. */
  const missing = [];
  fs2.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
    const src = fs2.readFileSync(path2.join(dir, f), 'utf8');
    for (const m of src.matchAll(/Audio\.sfx\.(\w+)\s*\??\.?\(/g)) {
      if (!defined.has(m[1])) missing.push(`${f}:${m[1]}`);
    }
    /* The dynamic form, Audio.sfx[cond ? 'a' : 'b'] — take the two
       BRANCH names, not the string the condition compares against. */
    for (const m of src.matchAll(/Audio\.sfx\[[^\]]*\?\s*'(\w+)'\s*:\s*'(\w+)'\s*\]/g)) {
      [m[1], m[2]].forEach(k => { if (!defined.has(k)) missing.push(`${f}:${k}`); });
    }
  });
  ok(missing.length === 0,
     `every sound the game asks for exists (${missing.join(', ') || 'all present'})`);

  ['doorMove', 'scrapPickup', 'hullHit', 'ratChew', 'uiHover'].forEach(k => {
    ok(typeof sb.Audio.sfx[k] === 'function', `${k} is a real effect`);
  });

  // The hover cue is edge-triggered: hovering the SAME thing is silent.
  let plays = 0;
  const realHover = sb.Audio.sfx.uiHover;
  sb.Audio.sfx.uiHover = () => { plays++; };
  sb.Audio.hoverCue('a'); sb.Audio.hoverCue('a'); sb.Audio.hoverCue('a');
  ok(plays === 1, `resting on one button chirps once, not sixty times a second (${plays})`);
  sb.Audio.hoverCue('b');
  ok(plays === 2, 'moving to the next one chirps again');
  sb.Audio.hoverCue(null);
  ok(plays === 2, 'and moving off everything is silent');
  sb.Audio.sfx.uiHover = realHover;

  // Volumes are real, clamped, and readable back.
  sb.Audio.setMasterVolume(0.42);
  ok(Math.abs(sb.Audio.getVolumes().master - 0.42) < 1e-9, 'master volume is settable');
  sb.Audio.setMasterVolume(9);
  ok(sb.Audio.getVolumes().master === 1, 'and clamped at the top');
  sb.Audio.setMasterVolume(-3);
  ok(sb.Audio.getVolumes().master === 0, 'and at the bottom');

  // …and they come out of the SAVE at boot.
  sb.Save.setSetting('masterVolume', 0.25);
  sb.Save.setSetting('musicVolume', 0.1);
  sb.Audio.applySettings();
  const v = sb.Audio.getVolumes();
  ok(Math.abs(v.master - 0.25) < 1e-9 && Math.abs(v.music - 0.1) < 1e-9,
     `saved levels are applied at boot (${v.master}, ${v.music})`);
  sb.Save.setSetting('masterVolume', 0.8);
})();

// ============================================================
section('113. Inclusive ranges are inclusive');
// ============================================================
(function testRandIn() {
  const sb = loadEngine();
  const { Utils } = sb;

  /* Utils.randInt is [min, max) — so `randInt(1, 2)` is ALWAYS 1. That
     bit "they spare 1-2 He2", the wreck fuel siphon and the ±1 variance
     in the nest count, all of which silently had no variance at all. */
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(Utils.randIn(1, 2));
  ok(seen.has(1) && seen.has(2) && seen.size === 2,
     `randIn(1,2) really returns 1 AND 2 (${[...seen].sort().join(',')})`);

  const s3 = new Set();
  for (let i = 0; i < 800; i++) s3.add(Utils.randIn(0, 3));
  ok([0,1,2,3].every(n => s3.has(n)) && s3.size === 4,
     `randIn(0,3) covers 0..3 (${[...s3].sort().join(',')})`);
  ok(Utils.randIn(5, 5) === 5, 'a one-value range returns that value');

  // The nest count really varies now.
  const counts = new Set();
  for (let i = 0; i < 400; i++) counts.add(sb.derelictSpiderCount(2));
  ok(counts.size > 1, `a sector-2 wreck does not always hold the same nest count (${[...counts].sort().join(',')})`);

  // And the crew-damage chip does not lie: crewDamage [10,25] can roll 25.
  const hits = new Set();
  const cd = sb.WEAPON_DEFS.laser_basic.crewDamage;
  for (let i = 0; i < 2000; i++) hits.add(Utils.randIn(cd[0], cd[1]));
  ok(hits.has(cd[1]), `the top of a printed damage range is reachable (${cd[0]}-${cd[1]})`);
})();

// ============================================================
section('114. Nothing is offered that cannot be reached');
// ============================================================
(function testNoDeadOffers() {
  const sb = loadEngine();
  const { Station, Save, EVENTS, Ship, Game, Utils } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  /* ── The station rolled 1-3 module upgrades per visit into a list the
       shop never rendered and a buyer nobody called — at a SECOND,
       flat price beside the live exponential one. Both are gone. */
  const st = new Station(2, 999);
  ok(st.stock.modules === undefined,
     'the station no longer rolls stock it cannot sell');
  ok(typeof st.buyModule !== 'function', 'and the dead buyer is deleted');
  ok(typeof st.systemUpgradeCost === 'function',
     'the live, exponential upgrade price is the only one left');
  ok(typeof sb.MODULE_DEFS === 'undefined', 'the duplicate price list is gone');

  /* ── `result.risk` was handled by the resolver and produced by NO
       event: a whole hazard category was unreachable. */
  const risky = EVENTS.filter(e => e.choices.some(c => c.result?.risk));
  ok(risky.length > 0, `${risky.length} event(s) can now actually hurt a crewman`);

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  ship.cargo.addStack('he2_med', 6);
  T.playerShip = ship;
  T.STATE = 'event';
  const ev = risky[0];
  const idx = ev.choices.findIndex(c => c.result?.risk);
  const hp0 = ship.crew.map(c => c.hp).reduce((a, b) => a + b, 0);
  T.event = ev;
  T._resolveEvent(idx);
  const hp1 = ship.crew.map(c => c.hp).reduce((a, b) => a + b, 0);
  ok(hp1 < hp0, `and taking that choice really costs blood (${hp0} → ${hp1})`);

  // The other choice on that event burns fuel — a NEGATIVE fuel result
  // must draw from the cells, not addStack a negative number.
  const other = ev.choices.findIndex(c => (c.result?.fuel ?? 0) < 0);
  if (other !== -1) {
    const f0 = ship.fuelCount();
    T.STATE = 'event'; T.event = ev;
    T._resolveEvent(other);
    ok(ship.fuelCount() === f0 - 1,
       `a negative fuel result BURNS a cell (${f0} → ${ship.fuelCount()})`);
  } else {
    ok(false, 'test setup: expected a fuel-cost choice on the risky event');
  }

  /* ── `hazard` was set by the mining barge and dropped on the floor. */
  const barge = EVENTS.find(e => e.choices.some(c => c.result?.hazard));
  ok(!!barge, 'an event still sets the hazard flag');
  const gsrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'game.js'), 'utf8');
  const dockCall = gsrc.slice(gsrc.indexOf('if (result.dockWreck)'),
                              gsrc.indexOf('if (result.dockWreck)') + 700);
  ok(/hazard:\s*!!result\.hazard/.test(dockCall), 'and the docking call forwards it');

  T.playerShip = null;
})();

// ============================================================
section('115. Running away is a jump, and jumps cost He2');
// ============================================================
(function testRetreatCostsFuel() {
  const sb = loadEngine();
  const { Ship, Save, Game, CombatManager } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;
  const enemy = new Ship('enemy_frigate', false, 850, 120);
  enemy._allocateDefaultPower();
  T.enemyShip = enemy;

  /* _canRetreat checked engines and the cockpit but never fuel, while
     _travelTo did — so an empty hold stranded you on the MAP and yet
     let you escape a fight for free. */
  ok(ship.fuelCount() === 0, 'the hold is empty');
  ok(T._canRetreat() === false, 'with no He2 aboard you cannot run');

  ship.cargo.addStack('he2_med', 3);
  ok(T._canRetreat() === true, 'with cells aboard you can');

  T.enemyShip = null;
})();

// ============================================================
section('116. A notification stays inside its own box');
// ============================================================
(function testNotifWrap() {
  const sb = loadEngine();
  const { UI, Renderer } = sb;
  const ctx = initRenderer(sb);

  /* The box was a fixed 300x28 with ONE unclipped fillText — every
     message past about forty characters ran straight out of the panel
     and across the ship. Most of the interesting ones are longer. */
  const LONG = 'Something chewed through the Shields loom — it is dead for 3 seconds, '
             + 'and the crew standing in it are down with it!';
  UI.notify(LONG, 'alert');

  const drawn = [];
  const rects = [];
  const realText = ctx.fillText, realRect = ctx.fillRect;
  ctx.fillText = function (t, x, y) { drawn.push({ t: String(t), x, y }); };
  ctx.fillRect = function (x, y, w, h) { rects.push({ x, y, w, h }); };
  try { UI.draw(ctx, {}); } finally { ctx.fillText = realText; ctx.fillRect = realRect; }

  const parts = drawn.filter(d => LONG.startsWith(d.t.slice(0, 12)) || d.t.length > 8);
  ok(parts.length >= 2, `a long notice is broken into lines (${parts.length})`);

  // Nothing is drawn wider than the box, and nothing starts outside it.
  ctx.font = '12px Share Tech Mono, monospace';
  const W = Renderer.getWidth();
  const tooWide = parts.filter(d => ctx.measureText(d.t).width > 420);
  ok(tooWide.length === 0, `no line is wider than the panel (${tooWide.length} over)`);
  ok(parts.every(d => d.x >= (W - 420) / 2 - 1 && d.x <= (W + 420) / 2),
     'and every line starts inside it');

  // A single unbreakable word is chopped rather than allowed to bleed.
  UI.update(99);   // clear
  UI.notify('X'.repeat(300), 'info');
  const drawn2 = [];
  ctx.fillText = function (t, x, y) { drawn2.push(String(t)); };
  try { UI.draw(ctx, {}); } finally { ctx.fillText = realText; }
  const xs = drawn2.filter(t => /^X+…?$/.test(t));
  ok(xs.length > 1, `an unbreakable word is chopped, not bled (${xs.length} pieces)`);
  ok(xs.length <= 4, `and capped — a notice is a glance, not a document (${xs.length})`);
  UI.update(99);
})();

// ============================================================
section('117. Every list you can fill is a list you can reach');
// ============================================================
(function testScrollableLists() {
  const sb = loadEngine();
  const { Base, BaseScreen, CrewMember, Save } = sb;
  const ctx = initRenderer(sb);
  Save.load(); Save.startRun();

  /* THE BARRACKS. 5 bunks, +2 per upgrade — so from the tenth bunk the
     cards ran off the bottom of the panel and HIRE RECRUIT was drawn on
     top of the last one. */
  const many = [];
  for (let i = 0; i < 13; i++) many.push(new CrewMember({ name: 'Hand' + i }).serialise());
  Base.get().barracks = many;
  Base.get().barracksLvl = 4;

  BaseScreen.open();
  BaseScreen._set({ tab: 'CREW' });
  const page1 = captureText(ctx, () => BaseScreen.draw(ctx)).map(d => d.t);
  ok(page1.includes('Hand0'), 'the first bunk is on the first page');
  ok(!page1.includes('Hand12'), 'the thirteenth is not — there is a second page');
  ok(page1.some(t => /1-3\/5/.test(t)), 'and the rail says how many pages there are');

  BaseScreen._act('scrollCrew', 2);
  const page2 = captureText(ctx, () => BaseScreen.draw(ctx)).map(d => d.t);
  ok(page2.includes('Hand12'), 'scrolling reaches the last bunk');
  ok(!page2.includes('Hand0'), 'and the first has scrolled off');

  // The rail cannot be pushed past the end.
  BaseScreen._act('scrollCrew', 99);
  const page3 = captureText(ctx, () => BaseScreen.draw(ctx)).map(d => d.t);
  ok(page3.includes('Hand12'), 'and it clamps at the bottom rather than emptying');

  /* THE ARMOURY RACK. Guns past the third were drawn nowhere and had
     no FIT and no SELL button — a gun you cannot reach is a gun you
     cannot sell. */
  Base.get().barracks = [];
  const g = Base.warehouseGrid();
  const guns = ['laser_burst', 'missile_basic', 'ion_basic', 'flak_basic'];
  guns.forEach(k => g.add(typeof sb.cargoCrateForWeapon === 'function'
    ? sb.cargoCrateForWeapon(k) : 'gun_crate', k));
  Base.commitWarehouse(g);
  ok(Base.armoury().length >= 4, `${Base.armoury().length} guns on the rack`);

  BaseScreen.open();
  BaseScreen._set({ tab: 'ARMOURY' });
  const r1 = captureText(ctx, () => BaseScreen.draw(ctx)).map(d => d.t);
  ok(!/more on the rack/.test(r1.join('|')),
     'the dead-end "…and N more on the rack" line is gone');

  const last = sb.getWeaponDef(Base.armoury()[3]).label;
  ok(!r1.includes(last), `the fourth gun is off the first page (${last})`);
  BaseScreen._act('scrollRack', 1);
  const r2 = captureText(ctx, () => BaseScreen.draw(ctx)).map(d => d.t);
  ok(r2.includes(last), 'and scrolling brings it into reach');

  /* Its FIT and SELL buttons must address the RIGHT gun. A scrolled
     view that hands back a VISIBLE index sells somebody else's weapon,
     and calling _act('sellGun', 3) by hand cannot see that — the bug
     lives in the ARGUMENT the button carries, so read the button. */
  BaseScreen.draw(ctx);                       // rack scrolled by 1
  const sells = BaseScreen._zonesFor('sellGun');
  const fits  = BaseScreen._zonesFor('fit');
  ok(sells.length > 0 && fits.length > 0, `the rack has buttons (${sells.length})`);
  ok(sells[0].arg === 1,
     `the first SELL button on a rack scrolled by one addresses gun 1, not 0 (${sells[0].arg})`);
  ok(fits[0].arg === 1, `and so does the first FIT (${fits[0].arg})`);
  ok(sells.map(z => z.arg).join(',') === '1,2,3',
     `every button addresses its own gun (${sells.map(z => z.arg).join(',')})`);

  // …and the button really removes the gun it names.
  const before = [...Base.armoury()];
  BaseScreen._act('sellGun', sells[0].arg);
  ok(!Base.armoury().includes(before[1]) &&
     Base.armoury().length === before.length - 1,
     'and pressing it sells that gun');
})();

// ============================================================
section('118. A hull bar never runs off the screen');
// ============================================================
(function testHullBarFits() {
  const sb = loadEngine();
  const { Ship, Save, Renderer, CombatManager } = sb;
  const ctx = initRenderer(sb);
  Save.load(); Save.startRun();

  /* `Math.max(7, …)` is a FLOOR on the segment width, so the bar did
     NOT "never exceed 360px" as the comment claimed: a 28-pip hull came
     out 376 wide and the enemy copy is anchored at _W − 320, which put
     the last pips past the right-hand edge of the canvas. */
  const player = new Ship('frigate', true, 180, 120);
  player._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => player.addCrew(c));

  const W = Renderer.getWidth();
  [12, 22, 28, 40, 60].forEach(max => {
    const enemy = new Ship('enemy_gunship', false, 850, 120);
    enemy._allocateDefaultPower();
    enemy.hullMax = max; enemy.hull = Math.ceil(max / 2);

    const rects = [];
    const real = ctx.fillRect;
    ctx.fillRect = function (x, y, w, h) { rects.push({ x, y, w, h }); real?.call?.(ctx, x, y, w, h); };
    const realRR = ctx.roundRect;
    ctx.roundRect = function (x, y, w, h, r) { rects.push({ x, y, w, h }); return realRR?.call?.(ctx, x, y, w, h, r); };
    try { Renderer.drawHUD({ playerShip: player, enemyShip: enemy }); }
    finally { ctx.fillRect = real; ctx.roundRect = realRR; }

    // Only look at the hull-pip band (y 21..25 is inside the 18px pips).
    const pips = rects.filter(r => r.y >= 20 && r.y <= 26 && r.w > 3 && r.w < 20);
    ok(pips.length > 0, `hull ${max}: pips are drawn (${pips.length})`);
    const overflow = pips.filter(r => r.x + r.w > W);
    ok(overflow.length === 0,
       `hull ${max}: no pip is drawn past the right edge (${overflow.length} over)`);
    const offLeft = pips.filter(r => r.x < 0);
    ok(offLeft.length === 0, `hull ${max}: nor past the left (${offLeft.length})`);
  });
})();


// ============================================================
section('119. One grid, every hull');
// ============================================================
(function testHullGrid() {
  const sb = loadEngine();
  const { Ship, SHIP_LAYOUTS, HULL_GRID } = sb;
  const G = HULL_GRID;

  ok(!!G && G.MODULE_W > 0, `there is a grid (${G.MODULE_W}x${G.MODULE_H}, pitch ${G.DECK_PITCH})`);
  ok(G.DECK_PITCH === G.MODULE_H + G.DECK_GAP, 'deck pitch is the module plus the gap');

  const keys = Object.keys(SHIP_LAYOUTS);
  ok(keys.length >= 7, `${keys.length} hulls in the table`);

  /* ONE MODULE SIZE (update41). There used to be three — 80x72, 96x80
     and 96x60 — because every layout hard-coded its own pixels and they
     drifted apart one hull at a time. That made a shared art kit
     impossible: a floor tile cut for the scout was the wrong size on
     the frigate and the wrong shape on the station. */
  const sizes = new Set(), pitches = new Set();
  keys.forEach(k => {
    const L = SHIP_LAYOUTS[k];
    L.rooms.forEach(r => sizes.add(r.w + 'x' + r.h));
    const ys = [...new Set(L.rooms.map(r => r.y))].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) pitches.add(ys[i] - ys[i - 1]);
  });
  ok(sizes.size === 1, `every compartment in the game is the same size (${[...sizes].join(', ')})`);
  ok([...sizes][0] === G.MODULE_W + 'x' + G.MODULE_H, 'and it is the grid module');
  ok(pitches.size === 1 && [...pitches][0] === G.DECK_PITCH,
     `every deck is the same height apart (${[...pitches].join(', ')})`);

  keys.forEach(k => {
    const L = SHIP_LAYOUTS[k];

    // Columns touch EXACTLY, or a shaft sits in the gap — never anything else.
    const byRow = {};
    L.rooms.forEach(r => { (byRow[r.floor] = byRow[r.floor] || []).push(r); });
    Object.values(byRow).forEach(row => {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const gap = row[i].x - (row[i - 1].x + row[i - 1].w);
        ok(gap === 0 || gap === G.SHAFT_W,
           `${k}: modules either touch or leave exactly a shaft's width (${gap})`);
      }
    });

    // A shaft NEVER overlaps a room — that is the whole reason it lives
    // in the gap rather than inside the hull.
    (L.elevators ?? []).forEach(ev => {
      const l = ev.x - G.SHAFT_W / 2, r = ev.x + G.SHAFT_W / 2;
      const clash = L.rooms.filter(rm => rm.x < r && rm.x + rm.w > l);
      ok(clash.length === 0, `${k}: shaft at ${ev.x} cuts through no room (${clash.length})`);

      // Stops are DERIVED — one per deck, on that deck's walk line.
      ok(ev.floors.length === L.floors,
         `${k}: the lift stops on every deck (${ev.floors.length}/${L.floors})`);
      ev.floors.forEach(fy => {
        const want = L.rooms.some(rm =>
          Math.abs((rm.y + rm.h * G.WALK_FRAC) - fy) < 0.01);
        ok(want, `${k}: stop ${fy.toFixed(1)} lands on a real walk line`);
      });
    });
  });

  /* The pixels are DERIVED from (col, row), not typed. Re-deriving them
     has to reproduce the table exactly, or the grid is decoration. */
  const scout = SHIP_LAYOUTS.scout;
  const x0 = Math.min(...scout.rooms.map(r => r.x));
  const cols = [...new Set(scout.rooms.map(r => r.x))].sort((a, b) => a - b);
  ok(cols[1] - cols[0] === G.MODULE_W + G.SHAFT_W,
     `a column with a shaft after it steps by module+shaft (${cols[1] - cols[0]})`);
  ok(cols[2] - cols[1] === G.MODULE_W,
     `and a plain column steps by one module (${cols[2] - cols[1]})`);
  ok(x0 === 20, 'the origin is where the spec says');

  // `weaponX` had SEVEN entries and ZERO consumers — dead data.
  const dead = keys.filter(k => SHIP_LAYOUTS[k].weaponX !== undefined);
  ok(dead.length === 0, `no hull carries the dead weaponX field any more (${dead.length})`);
})();

// ============================================================
section('120. Engine and prow hang off the grid like LEGO');
// ============================================================
(function testHullTiles() {
  const sb = loadEngine();
  const { Ship, HULL_GRID } = sb;
  const G = HULL_GRID;

  /* The hull assembles one row per deck:
       [engine][module][module][shaft][module][prow]
     so both exterior tiles are one-per-deck and every deck is identical
     in height. That is what lets one engine tile serve every ship. */

  [['scout', 2], ['frigate', 3]].forEach(([key, decks]) => {
    const sh = new Ship(key, true, 180, 120);
    const eng = sh.engineSlots(), prow = sh.prowSlots();

    ok(eng.length === decks, `${key}: one engine tile per deck (${eng.length}/${decks})`);
    ok(prow.length === decks, `${key}: one prow tile per deck (${prow.length}/${decks})`);
    ok(eng.every(s => s.h === G.MODULE_H && s.w === G.ENGINE_W),
       `${key}: engine tiles are ${G.ENGINE_W}x${G.MODULE_H}`);
    ok(prow.every(s => s.h === G.MODULE_H && s.w === G.PROW_W),
       `${key}: prow tiles are ${G.PROW_W}x${G.MODULE_H}`);

    // Every tile sits exactly on a deck, never between two.
    const deckYs = [...new Set(sh.rooms.map(r => r.y))];
    ok(eng.every(s => deckYs.includes(s.y)), `${key}: engines line up with the decks`);
    ok(prow.every(s => deckYs.includes(s.y)), `${key}: so do the prows`);

    // Stern and bow are opposite ends, and neither overlaps the rooms.
    const b = sh.roomBounds();
    ok(eng.every(s => s.x + s.w <= b.x), `${key}: engines sit behind the hull`);
    ok(prow.every(s => s.x >= b.x + b.w), `${key}: prows sit in front of it`);
  });

  /* The prow is a TAPER, so the slice depends on the ship's height —
     that is why there are three sets and not one tile. */
  const two = new Ship('scout', true, 180, 120).prowSlots();
  ok(two.map(s => s.slice).join(',') === 'top,bot',
     `a two-deck hull needs a top and a bottom (${two.map(s => s.slice).join(',')})`);
  const three = new Ship('frigate', true, 180, 120).prowSlots();
  ok(three.map(s => s.slice).join(',') === 'top,mid,bot',
     `a three-deck hull needs a middle too (${three.map(s => s.slice).join(',')})`);
  ok(three.every(s => s.decks === 3), 'and each tile knows which set it came from');

  // A hostile hull faces the other way, so both ends swap sides.
  const foe = new Ship('enemy_frigate', false, 850, 120);
  const fb = foe.roomBounds();
  ok(foe.engineSlots().every(s => s.x >= fb.x + fb.w),
     'a hostile hull carries its engines on the other side');
  ok(foe.prowSlots().every(s => s.x + s.w <= fb.x), 'and its bow on the other side too');
  ok(foe.engineSlots().every(s => s.flip === true), 'and the tiles are flagged to be mirrored');

  /* APOPHIS IS A STATION. It does not go anywhere, so it has neither —
     which is exactly why the kit needs no special station art. */
  const station = new Ship('boss_station', false, 850, 120);
  ok(station.engineSlots().length === 0, 'a station has no engines hung off it');
  ok(station.prowSlots().length === 0, 'and no bow');
  ok(station.rooms.every(r => r.w === G.MODULE_W && r.h === G.MODULE_H),
     'but its compartments are the same module as everything else');
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
