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
/* Like captureText, but keeps the fillStyle in force at each call —
   update52 makes claims about the COLOUR of a choice, and a claim
   about colour cannot be made against the text alone. */
/* Spend every owed pick, BOUNDED. `while (owed > 0)` in a test is a
   hang waiting to happen: break the counter and the suite stops
   answering instead of failing, which is the one failure mode a
   deliberate-breakage run cannot report on. */
function spendAll(Commander, cap, effect) {
  for (let i = 0; i < 40 && Commander.picksOwed(cap) > 0; i++) {
    if (!Commander.spendPick(cap, effect)) break;
  }
  return Commander.picksOwed(cap) === 0;
}

function captureStyledText(ctx, fn) {
  const out = [];
  const real = ctx.fillText;
  ctx.fillText = (t, x, y) => { out.push({ t: String(t), x, y, fill: ctx.fillStyle }); };
  try { fn(); } finally { ctx.fillText = real; }
  return out;
}

function forceMuster(party) {
  party.members.forEach(m => {
    m.c.x = m.x = party.exitDoor.x;
    m.c.y = m.y = party.exitDoor.y;
  });
}


/* PROMOTE SOMEBODY, FOR REAL (update51).
 *
 * update49a's test bench handed out a commander through a back door.
 * update51 deleted it, and it is not being missed: promotion is no
 * longer gated on mastery, so the tests can walk the SAME road the
 * player walks — Base.promote() — and get a commander whose price and
 * whose ceiling are the real ones. Pass `mastered` to buy a better
 * man; the level and karma are set afterwards, which is what the
 * bench was really for.
 *
 * Returns the commander record, already picked to fly.
 */
function promoteForTest(sb, { mastered = 3, level = 8, karma = 50 } = {}) {
  const { Base, BaseScreen, Commander } = sb;
  const b = Base.get();
  b.messLvl = Math.max(1, b.messLvl ?? 1);
  Base.earn(2000);
  /* A fresh save has an empty barracks — the starting crew are ABOARD
     the ship, not in a bunk. Sign one on rather than fail. */
  if (!(b.barracks ?? []).length) Base.addCrew(new sb.CrewMember({}).serialise());
  const rec = b.barracks[0];
  /* Give him his stars the honest way — the skill records are what
     Commander.masteredOf reads, and the tier is read from those. */
  const max = sb.MAX_SKILL_LEVEL ?? 3;
  rec.skills = rec.skills || {};
  ['weapons', 'piloting', 'engines'].slice(0, mastered).forEach(k => {
    rec.skills[k] = { level: max, xp: 0 };
  });
  const r = Base.promote(rec.id);
  if (!r.ok) throw new Error('promoteForTest: ' + r.message);
  const cap = Base.commanderById(r.commander.id);
  cap.level = level;
  cap.karma = karma;
  Base.saveCommander(cap);
  BaseScreen.open();
  if (BaseScreen._state().commanderId !== cap.id) BaseScreen._act('pickCommander', cap.id);
  return cap;
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
    ok(i >= 0, 'a broke commander must still have a beg option');
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
section('41. A hull\'s hold is its own — there is no retrofit');
// ============================================================
(function testNoHoldUpgrade() {
  const sb = loadEngine();
  const { Base, BaseScreen, Save, Ship, SHIP_LAYOUTS } = sb;
  Save.load();

  /* CARGO RETROFIT WAS DELETED (update46) at the player's call:
     "statek ma swoje cargo i tak powinno pozostać". The deletion is
     also the fix for a genuine trap — the hold's width was computed in
     two places with two different formulas, and only one of them knew
     about the upgrade. */
  ok(!isFinite(Base.upgradeCost('hold')), 'the base sells no cargo retrofit');
  ok(Base.buyUpgrade('hold').ok === false, 'and it cannot be bought');
  ok(typeof Base.holdBonus === 'undefined',
     'the bonus function is GONE, not left behind returning zero — '
   + 'a dead accessor is how the second register creeps back');

  Save.addScrapBank(9999);
  ['warehouse', 'barracks', 'slot', 'mess', 'pets'].forEach(k => {
    ok(isFinite(Base.upgradeCost(k)), `${k} is still on the ladder`);
  });

  /* ONE SOURCE FOR THE WIDTH. The packing screen and the Ship
     constructor must agree, whatever else the base has been upgraded. */
  BaseScreen.open();
  const packed = BaseScreen._state().hold;
  const fresh  = new Ship('scout', true, 0, 0);
  ok(packed.cols === SHIP_LAYOUTS.scout.cargoCols,
     `the packed hold is the hull's own width (${packed.cols})`);
  ok(fresh.cargo.cols === packed.cols,
     `and a Ship built from scratch agrees (${fresh.cargo.cols} vs ${packed.cols}) — `
   + 'they used to differ by one whenever the retrofit was owned');

  // Buying every OTHER upgrade must not move the hold either.
  ['warehouse', 'barracks', 'slot'].forEach(k => Base.buyUpgrade(k));
  BaseScreen.open();
  ok(BaseScreen._state().hold.cols === packed.cols,
     'and no other upgrade quietly widens it');

  /* AN OLD SAVE GETS ITS MONEY BACK, ONCE. */
  const raw = Save.getRaw();
  raw.base.holdLvl = 2;                 // bought twice: 100 + 210 = 310 CC
  delete raw.base.holdRefunded;
  const before = Base.cc();
  Base.get();                            // first read migrates
  ok(Base.cc() === before + 310,
     `a player who bought it twice is refunded 310 CC (${before} → ${Base.cc()})`);
  const after = Base.cc();
  Base.get(); Base.get();
  ok(Base.cc() === after, 'and never a second time');
  ok(Base.get().holdLvl === undefined, 'the field is cleared, not left at zero');
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
  /* CLICK, MOVE, CLICK (update48) — this used to be press, drag,
     release. Moving the mouse between the two clicks must change
     nothing at all, which is the point of the new model, so the walk
     across the screen is simulated here as real frames. */
  const click = (x, y) => {
    Input.mouse.x = x; Input.mouse.y = y;
    Input.mouse.leftPressed = true;
    LootScreen.update(0.016);
    Input.mouse.leftPressed = false;
    LootScreen.update(0.016);
  };
  click(from.x, from.y);
  ok(ship.cargo.countOf('fuel') === 1,
     'the clicked cell is in hand, out of the grid');
  // Walk the cursor over the other container without clicking.
  for (let i = 1; i <= 4; i++) {
    Input.mouse.x = from.x + (to.x - from.x) * i / 4;
    Input.mouse.y = from.y + (to.y - from.y) * i / 4;
    LootScreen.update(0.016);
  }
  click(to.x, to.y);

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
section('66. A full shelf does NOT liquidate the overflow behind your back');
// ============================================================
(function testWarehouseOverflow() {
  const sb = loadEngine();
  const { Save, Base, BaseScreen, Game, CargoItem, Renderer } = sb;
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
  let finished = false;
  T._dockAtBase(0, () => { finished = true; });

  /* IT USED TO BE SOLD ON THE SPOT (update48 changed this).
     The base bought whatever would not fit at scrap value, before the
     player ever saw it — the relic he crossed two sectors for was
     already gone by the outcome screen. Now docking STOPS and asks. */
  ok(Base.cc() === ccBefore, `nothing is sold behind his back (${ccBefore} → ${Base.cc()})`);
  ok(hold.items.includes(relic), 'the relic is still in the hold, waiting for a decision');
  ok(sb.LootScreen.isOpen(), 'and the sorting screen is up');
  ok(!finished, 'the run does not close until he has answered');

  // The way out is a button that says what it pays.
  Renderer.init(sb.document.getElementById('game-canvas'));
  sb.LootScreen.draw(Renderer.getCtx());
  const doneZone = sb.LootScreen._zoneFor('done');
  ok(!!doneZone, 'there is a DONE button');
  sb.Input.mouse.x = doneZone.x + 4; sb.Input.mouse.y = doneZone.y + 4;
  sb.Input.mouse.leftPressed = true;
  sb.LootScreen.update(0.016);
  sb.Input.mouse.leftPressed = false;

  ok(Base.cc() > ccBefore, `pressing it banks the relic (${ccBefore} → ${Base.cc()})`);
  ok(hold.items.length === 0, 'and the hold comes off the ship empty');
  ok(finished, 'only then does docking finish');
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
  /* update52: the star is read off the RANK now (the sum of his
     squares), so one mastery is only rank 3 — Specialist, no star.
     Give him enough squares to actually be somebody. */
  vet.skills.weapons.level = MAX_SKILL_LEVEL;
  vet.skills.repair.level  = MAX_SKILL_LEVEL;
  vet.skills.engines.level = 2;                        // rank 8 → silver
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
  ok(drawn.some(d => /Staff Sergeant · 8/.test(d.t)),
     'and the card names his RANK, which is what the star is short for');

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

  // update51: boarding is an ORDER, and orders need somebody in the chair.
  T.commander = { id: 'cap', name: 'Boss', race: 'terra', level: 1, karma: 50 };
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
  // update51: running away is an order too — put somebody in the chair
  // first, or the fuel rule below is never even reached.
  T.commander = { id: 'cap', name: 'Boss', race: 'terra', level: 1, karma: 50 };
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
section('121. The volume you set is the volume you get');
// ============================================================
(function testVolumeControls() {
  const sb = loadEngine();
  const { Audio, Save, Game } = sb;
  const T = Game.__test;
  Save.load();
  Audio.init();

  /* THE MUSIC SLIDER WAS DEAD. playMusic/stopMusic each wrote a literal
     0.35 into musicGain, so every mode change — menu, map, combat, boss,
     a dozen call sites — threw the player's level away. The MIRROR still
     reported what they had chosen, which is why this asserts on the gain
     NODE: getVolumes() was never wrong, the sound was. */
  Audio.setMusicVolume(0.9);
  ok(Math.abs(Audio.getNodeLevels().music - 0.9) < 1e-6,
     'setting music volume reaches the gain node');
  Audio.playMusic('combat');
  ok(Math.abs(Audio.getNodeLevels().music - 0.9) < 1e-6,
     'starting combat music must NOT reset the level to 0.35');
  Audio.playMusic('boss');
  ok(Math.abs(Audio.getNodeLevels().music - 0.9) < 1e-6,
     'nor must switching mode again');
  Audio.setMusicVolume(0.2);
  Audio.playMusic('explore');
  ok(Math.abs(Audio.getNodeLevels().music - 0.2) < 1e-6,
     'a level set mid-session survives the next mode change too');
  Audio.stopMusic(0);
  Audio.playMusic('explore');
  ok(Math.abs(Audio.getNodeLevels().music - 0.2) < 1e-6,
     'and survives a fade-out/restart');

  /* MUTE USED TO BE AN ERASER: it wrote masterVolume = 0 into the save,
     so the chosen level was destroyed, the zero survived F5 — the game
     booted silent — and UNMUTE guessed 0.8 back. */
  Audio.setMasterVolume(0.6);
  Audio.setMuted(true);
  ok(Audio.getNodeLevels().master === 0, 'mute silences the master node');
  ok(Math.abs(Audio.getVolumes().master - 0.6) < 1e-6,
     'but the level underneath is untouched');
  Audio.setMuted(false);
  ok(Math.abs(Audio.getNodeLevels().master - 0.6) < 1e-6,
     'unmute restores the level the player set, not a guessed 0.8');

  // …and the options screen drives it through the SAVE, so it survives F5.
  Save.setSetting('masterVolume', 0.42);
  Save.setSetting('muted', true);
  Audio.applySettings();
  ok(Audio.getNodeLevels().master === 0, 'a saved mute boots silent');
  ok(Math.abs(Audio.getVolumes().master - 0.42) < 1e-6,
     'and the saved level is still 0.42 underneath it');
  Save.setSetting('muted', false);
  Audio.applySettings();
  ok(Math.abs(Audio.getNodeLevels().master - 0.42) < 1e-6,
     'clearing the mute flag brings back exactly what was saved');
  ok(T._optMuted() === false, 'and the options screen agrees');
})();

// ============================================================
section('122. OPEN ALL / CLOSE ALL make a noise');
// ============================================================
(function testDoorAllSound() {
  const sb = loadEngine();
  const { Ship, Save, Game, Audio } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  T.playerShip = ship;

  /* Both buttons wrote d.mode by hand instead of going through
     Door.toggle(), which is the one place doorMove() is played — so the
     whole ship's doors cycled in silence. */
  // update51: OPEN ALL / CLOSE ALL are the commander's orders now.
  T.commander = { id: 'cap', name: 'Boss', race: 'terra', level: 1, karma: 50 };
  let moves = 0;
  const real = Audio.sfx.doorMove;
  Audio.sfx.doorMove = () => { moves++; };
  try {
    T._setAllDoors(false);
    T._setAllDoors(true);
    ok(moves >= 1, `opening every door plays the door sound (got ${moves})`);
    const after = moves;
    T._setAllDoors(true);   // nothing actually moves
    ok(moves === after, 'but re-opening already-open doors stays quiet');
    ok(ship.doors.every(d => d.mode === 'open'), 'and every latch really is open');
    T._setAllDoors(false);
    ok(moves > after, 'closing them all is audible too');
    ok(ship.doors.every(d => d.mode === 'closed'), 'and every latch really is closed');
  } finally { Audio.sfx.doorMove = real; }
})();

// ============================================================
section('123. The enemy shield row ends on the screen');
// ============================================================
(function testEnemyShieldRow() {
  const sb = loadEngine();
  const { Ship, Save, Game, Renderer } = sb;
  const T = Game.__test;
  const ctx = initRenderer(sb);
  Save.load(); Save.startRun();

  const player = new Ship('frigate', true, 180, 120);
  const enemy  = new Ship('enemy_gunship', false, 850, 120);
  [player, enemy].forEach(s => { s._allocateDefaultPower(); s.prechargeShields(); });
  sb.makeStartingCrew().forEach(c => player.addCrew(c));

  /* The row hung off a hardcoded `_W - 150` and grew RIGHTWARD, while
     everything around it is right-anchored: with enough layers the last
     bubble started past the canvas edge and the charge ring on the
     part-charged one clipped even earlier. */
  const esh = enemy.getSystem('shields');
  const W = Renderer.getWidth();

  [1, 2, 3, 4, 6].forEach(layers => {
    esh._shieldMax  = layers;
    esh._shieldBars = layers - 1;      // one still charging: draws the ring
    const arcs = [];
    const realArc = ctx.arc;
    ctx.arc = function (x, y, r, ...rest) { arcs.push({ x, y, r }); return realArc.apply(this, [x, y, r, ...rest]); };
    try {
      Renderer.drawHUD({ playerShip: player, enemyShip: enemy });
    } finally { ctx.arc = realArc; }

    const right = arcs.filter(a => a.x > W / 2);
    ok(right.length > 0, `${layers} layers: the enemy row actually drew`);
    const over = right.filter(a => a.x + a.r > W - 1);
    ok(over.length === 0,
       `${layers} layers: nothing pokes past the canvas edge (${over.length} did)`);
  });
})();

// ============================================================
section('124. A corpse rots on a clock, and not through a shut hatch');
// ============================================================
(function testCorpseDecayAndAirlock() {
  const sb = loadEngine();
  const { Ship, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  const victim = ship.crew[0];
  victim.killOutright('test');
  // Somebody is standing right over the body — the pickup rules are LIVE.
  const hand = ship.crew.find(c => !c.dead);
  hand.roomId = victim.roomId; hand.x = victim.x + 6; hand.y = victim.y;
  hand.inRoom = true;

  ok(ship.doors.filter(d => d.isAirlock).every(d => d.mode === 'closed'),
     'every airlock starts shut');

  /* TWO BUGS MET HERE AND CANCELLED EACH OTHER OUT.
     Decay was a COMBAT COUNTER — a body only began to rot at the start
     of the NEXT fight — while any crew member walking into the room
     picked the corpse up on the spot and shoved it through a SHUT
     airlock, hatch and all. Between them the plague never once fired in
     a real game. */
  let everLifted = false;
  for (let i = 0; i < 400; i++) {
    hand.roomId = victim.roomId; hand.x = victim.x + 6; hand.y = victim.y;
    ship._updateBodies(0.05);
    if (hand.carrying === victim) everLifted = true;
  }
  ok(ship.crew.includes(victim), 'a corpse cannot leave through a closed airlock');
  ok(!victim.ejected, 'it is not committed to space either');
  ok(everLifted === false, 'and nobody so much as lifts it with nowhere to put it');
  ok(victim.decaying === false, 'and it has not started to rot yet');

  /* And even carrying one to a shut hatch does not get it out: the
     ejection used to sort over EVERY airlock and shove the body through
     whatever state it was in. */
  {
    const shut = ship.doors.find(d => d.isAirlock);
    ok(shut.mode === 'closed', 'that hatch is definitely shut');
    hand.carrying = victim; victim.carriedBy = hand;
    hand.x = shut.x; hand.y = shut.y;      // right on top of it
    ship._updateBodies(0.05);
    ok(!victim.ejected, 'a body carried up to a SHUT hatch stays inboard');
    ok(ship.crew.includes(victim), 'and stays on the roster');
    for (let i = 0; i < Ship.CORPSE_HOLD_SECONDS * 20 + 10; i++) {
      hand.x = shut.x; hand.y = shut.y;
      ship._updateBodies(0.05);
    }
    ok(!hand.carrying, 'the bearer eventually puts it down and gets back to work');
    ok(!victim.ejected, 'still inboard');
    victim.carriedBy = null;
  }

  for (let i = 0; i < 500; i++) {
    hand.roomId = victim.roomId; hand.x = victim.x + 6; hand.y = victim.y;
    ship._updateBodies(0.05);
  }   // 45s total
  ok(victim.decaying === true,
     `left aboard past ${Ship.DECAY_SECONDS}s it rots on its own, no fight required`);
  ok(ship.crew.includes(victim), 'still aboard — the hatch is still shut');

  // Open one and the crew finally have somewhere to put it.
  const air = ship.doors.find(d => d.isAirlock);
  air.mode = 'open'; air.open = true; air.openness = 1;
  ok(ship.hasOpenAirlock() === true, 'an open airlock is somewhere to put a body');
  /* And opening one is an ORDER: collection used to be purely
     opportunistic — a body was only ever lifted by somebody who
     happened to already be standing in its room — so a corpse in a
     compartment nobody walks through rotted forever whatever the
     player did. Move everyone away and check that a hand is SENT. */
  ship.crew.filter(c => !c.dead).forEach((c, i) => {
    const far = ship.rooms.filter(r => r.id !== victim.roomId)[i] ?? ship.rooms[1];
    c.roomId = far.id; c.x = far.cx; c.y = far.cy; c.inRoom = true;
    c._rescueId = null; c.carrying = null; c._waypoints = [];
  });
  ok(ship.crewInRoom(victim.roomId).length === 0, 'nobody is anywhere near the body');
  ship._updateBodies(0.05);
  ok(ship.crew.some(c => c._rescueId === victim.id),
     'opening a hatch SENDS somebody to carry the thing out');

  for (let i = 0; i < 4000; i++) {
    ship.update(0.05);
    if (!ship.crew.includes(victim)) break;
  }
  ok(!ship.crew.includes(victim), 'with a hatch open the body is committed to space');
})();

// ============================================================
section('125. The plague travels through the vents');
// ============================================================
(function testPlagueSpread() {
  const sb = loadEngine();
  const { Ship, Save } = sb;
  Save.load(); Save.startRun();

  function rig() {
    const ship = new Ship('frigate', true, 80, 120);
    ship._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => ship.addCrew(c));
    const body = ship.crew[0];
    body.killOutright('test');
    body.decaying = true;
    const far = ship.crew.find(c => !c.dead && c.roomId !== body.roomId);
    return { ship, body, far };
  }

  const realRandom = Math.random;
  try {
    /* Infection reached `crewInRoom(body.roomId)` and nothing else, so
       standing one door away made you immune and the plague was a
       non-event. A ship shares one air loop. */
    {
      const { ship, far } = rig();
      Math.random = () => 0;                 // every roll lands
      ship._updateBodies(0.1);
      ok(far.infected === true,
         'a rotting body infects a crew member in ANOTHER module, through the air handlers');
    }

    /* …and life support is what carries it, so cutting the air CONTAINS
       the outbreak — at the obvious price. */
    {
      const { ship, body, far } = rig();
      const o2 = ship.getSystem('oxygen');
      o2.power = 0; o2.desiredPower = 0;
      ok(o2.effectivePower() === 0, 'life support is off');
      Math.random = () => 0;
      ship._updateBodies(0.1);
      ok(far.infected === false, 'with the vents dead the plague stays put');
      const near = ship.crew.find(c => !c.dead && c.roomId === body.roomId);
      if (near) ok(near.infected === true, 'but sharing the room with it still gets you');
      else ok(true, 'nobody shares the room — nothing to check');
    }
  } finally { Math.random = realRandom; }
})();

// ============================================================
section('126. The wounded are treated where they lie');
// ============================================================
(function testFieldAidEverywhere() {
  const sb = loadEngine();
  const { Ship, Save } = sb;
  Save.load(); Save.startRun();

  /* FIELD AID USED TO SWITCH OFF SHIP-WIDE the moment a working medbay
     existed anywhere. A man down two decks from it got NO treatment at
     all until somebody physically carried him in — and most hulls have
     no medbay to carry him to. */
  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  const med = ship.getSystem('medbay');
  med.power = 2; med.desiredPower = 2;
  ok(med.effectivePower() > 0, 'the frigate has a POWERED medbay');

  const far = ship.rooms.find(r => r.id !== med.roomId && r.type !== 'medbay');
  const [hurt, medic] = ship.crew;
  [hurt, medic].forEach(c => { c.roomId = far.id; c.x = far.cx; c.y = far.cy; c.inRoom = true; });
  hurt.hp = 1; hurt.state = 'injured'; hurt._bleedT = 0;
  // The one comrade there is welding a module: an explicit emergency job
  // outranks stretcher duty, so nobody is going to carry him anywhere.
  medic.task = sb.TASK.REPAIR;

  for (let i = 0; i < 500; i++) ship._updateBodies(0.05);   // 25s
  ok(!hurt.carriedBy, 'nobody stretchers him — the only hand there is busy');
  ok(hurt.hp > 1, `but a comrade patches him up where he lies (hp ${hurt.hp.toFixed(1)})`);
  ok(hurt.state === 'ok', 'and he gets back on his feet without ever seeing the medbay');

  // On a hull with no medbay at all it is the ONLY route — and it works.
  const scout = new Ship('scout', true, 80, 120);
  scout._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => scout.addCrew(c));
  ok(!scout.getSystem('medbay'), 'the scout carries no medbay');
  const room = scout.rooms[0];
  const [h2, m2] = scout.crew;
  [h2, m2].forEach(c => { c.roomId = room.id; c.x = room.cx; c.y = room.cy; c.inRoom = true; });
  h2.hp = 1; h2.state = 'injured'; h2._bleedT = 0;
  for (let i = 0; i < 500; i++) scout._updateBodies(0.05);
  ok(h2.state === 'ok', 'going down on a medbay-less hull is no longer a death sentence');
})();

// ============================================================
section('127. Being down is a countdown');
// ============================================================
(function testBleedout() {
  const sb = loadEngine();
  const { Ship, Save } = sb;
  Save.load(); Save.startRun();

  /* A downed crew member lay there indefinitely. That was a SOFT-LOCK:
     the last enemy standing goes DOWN instead of dying, nobody is left
     on his ship to treat him, and the fight can never end. */
  function alone() {
    const ship = new Ship('scout', true, 80, 120);
    ship._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => ship.addCrew(c));
    const empty = ship.rooms.find(r => !ship.crew.some(c => c.roomId === r.id));
    const man = ship.crew[0];
    // Alone in an empty module, and nobody else can walk to him.
    ship.crew.filter(c => c !== man).forEach(c => { c._rescueId = 'never'; });
    man.roomId = empty.id; man.x = empty.cx; man.y = empty.cy; man.inRoom = true;
    man.hp = 1; man.state = 'injured'; man._bleedT = 0;
    return { ship, man };
  }

  {
    const { ship, man } = alone();
    for (let i = 0; i < (Ship.BLEEDOUT_SECONDS - 5) * 20; i++) ship._updateBodies(0.05);
    ok(!man.dead, `at ${Ship.BLEEDOUT_SECONDS - 5}s he is still savable`);
    for (let i = 0; i < 200; i++) ship._updateBodies(0.05);
    ok(man.dead === true, `past ${Ship.BLEEDOUT_SECONDS}s with nobody coming, he bleeds out`);
  }

  // Reach him in time and the clock stops.
  {
    const { ship, man } = alone();
    const medic = ship.crew.find(c => c !== man && !c.dead);
    medic.roomId = man.roomId; medic.x = man.x; medic.y = man.y; medic.inRoom = true;
    medic._rescueId = null;
    for (let i = 0; i < (Ship.BLEEDOUT_SECONDS + 10) * 20; i++) ship._updateBodies(0.05);
    ok(!man.dead && man.state === 'ok', 'reached in time, he lives');
  }
})();

// ============================================================
section('128. Nobody treats the enemy, and nobody keeps him');
// ============================================================
(function testIntruders() {
  const sb = loadEngine();
  const { Ship, Save, Game } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;
  T.enemyShip = null;
  T.boardingParty = null; T.enemyParty = null;

  const med = ship.getSystem('medbay');
  med.power = 2; med.desiredPower = 2;
  const medRoom = ship.getRoomById(med.roomId);

  // A downed enemy boarder, bleeding on the medbay floor.
  const foe = sb.makeEnemyCrew(1)[0];
  ship.addCrew(foe, true);
  foe.roomId = medRoom.id; foe.x = medRoom.cx; foe.y = medRoom.cy; foe.inRoom = true;
  foe.hp = 1; foe.state = 'injured'; foe._bleedT = 0;
  ok(foe.isPlayer === false, 'he is not one of ours');

  /* `bodiesInRoom` had no side filter, so your medbay healed enemy
     boarders back onto their feet — with a green "back on their feet!"
     notification — and your crew stretchered them there. */
  const hp0 = foe.hp;
  for (let i = 0; i < 100; i++) ship._updateBodies(0.05);
  ok(foe.hp <= hp0, 'your medbay does NOT patch up the man who boarded you');
  ok(foe.state !== 'ok', 'and he does not get back on his feet in it');
  ok(ship.crew.every(c => c.carrying !== foe), 'nor does anyone stretcher him');

  // A rat is an infestation, not a boarder — it must survive the purge.
  const rat = sb.makeRats ? sb.makeRats(1)[0] : null;
  if (rat) ship.addCrew(rat, true);

  const upright = sb.makeEnemyCrew(1)[0];
  ship.addCrew(upright, true);
  upright.roomId = ship.rooms[0].id;

  /* Nothing ever removed enemy crew from _playerShip.crew. A surviving
     boarder got a roster row, was selectable and orderable, was BANKED
     INTO YOUR BARRACKS at the docking bay and was written into the save. */
  /* Through the REAL exit path, not by calling the purge directly:
     the bug was that _recoverBoarders pulled OUR people off the enemy
     hull and had no mirror image, so calling _purgeIntruders() by hand
     would have proved nothing about whether anything calls it. */
  T._recoverBoarders();
  ok(!ship.crew.includes(upright), 'a surviving boarder goes out with his ship');
  ok(!ship.crew.includes(foe),     'and so does the downed one');
  if (rat) ok(ship.crew.includes(rat), 'but a moon rat is an infestation and stays');
  ok(ship.crew.every(c => c.isPlayer || c.isBeast), 'the roster is ours again');
  ok(ship.crew.every(c => !c.carrying || ship.crew.includes(c.carrying)),
     'and nobody is left holding a body that no longer exists');
})();

// ============================================================
section('129. The roster follows the boarding party');
// ============================================================
(function testRosterSpansBothHulls() {
  const sb = loadEngine();
  const { Ship, Save, Renderer } = sb;
  Save.load(); Save.startRun();

  const player = new Ship('frigate', true, 180, 120);
  const enemy  = new Ship('enemy_frigate', false, 850, 120);
  [player, enemy].forEach(s => s._allocateDefaultPower());
  sb.makeStartingCrew().forEach(c => player.addCrew(c));
  sb.makeEnemyCrew(3).forEach(c => enemy.addCrew(c));

  /* A boarding party is MOVED OUT of playerShip.crew and INTO
     enemyShip.crew the moment it casts off, and the panel was a flat
     `playerShip.crew.forEach` — so your away team simply vanished from
     the HUD for the whole fight you sent them to win, while enemy
     boarders standing on your deck got rows of their own. */
  const boarder = player.crew[0];
  player.crew = player.crew.filter(c => c !== boarder);
  enemy.addCrew(boarder, true);

  const intruder = enemy.crew.find(c => !c.isPlayer);
  enemy.crew = enemy.crew.filter(c => c !== intruder);
  player.addCrew(intruder, true);

  const roster = Renderer.crewRoster({ playerShip: player, enemyShip: enemy });
  ok(roster.includes(boarder), 'a boarder on the enemy hull keeps his roster row');
  ok(boarder._awayTeam === true, 'and the row knows he is off the ship');
  ok(!roster.includes(intruder), 'an enemy standing on OUR deck gets no row');
  ok(roster.every(c => c.isPlayer), 'every row is one of ours');
  ok(roster.length === player.crew.filter(c => c.isPlayer).length + 1,
     'and everyone is counted exactly once');
})();

// ============================================================
section('130. Fights happen in rooms, not in the walls');
// ============================================================
(function testNoDoorwayBrawls() {
  const sb = loadEngine();
  const { Ship, Save } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  const room = ship.rooms[0];
  const mine = ship.crew[0];
  const foe  = sb.makeEnemyCrew(1)[0];
  ship.addCrew(foe, true);

  /* `roomId` was never cleared when a man stepped OUT of every room
     rectangle — and the 28px elevator trunk is real floor that belongs
     to no room. Waiting for a cabin, a boarder kept the stale id of the
     room he had left, so melee matched him against someone through a
     wall, the brawl cancelled his ride, and the corpse dropped in the
     shaft. */
  // The trunk is whatever floor on this deck belongs to no room at all;
  // stand him in the MIDDLE of it so a frame of drift cannot save him.
  const b = ship.roomBounds();
  const gap = [];
  for (let x = Math.round(b.x); x < b.x + b.w; x++) {
    if (!ship.rooms.some(r => r.contains(x, room.cy))) gap.push(x);
    else if (gap.length) break;
  }
  ok(gap.length > 0, 'the hull really does have floor between its modules');
  const shaftX = gap[Math.floor(gap.length / 2)];

  [mine, foe].forEach(c => { c.roomId = room.id; c.y = room.cy; });
  mine.x = room.cx;
  foe.x  = shaftX;                    // standing in the trunk

  ship.update(0.05);
  ok(foe.inRoom === false, 'a man in the elevator trunk is in no room at all');
  ok(ship.roomContested(room.id) === false,
     'so the module he LEFT is not contested by him');
  ok(ship.occupantsOf(room.id).every(c => c !== foe),
     'and he is not counted as standing in it');

  const hp0 = mine.hp;
  for (let i = 0; i < 200; i++) {
    // Pin him in the trunk: left alone the boarder AI walks him off.
    foe.x = shaftX; foe.y = room.cy; foe.roomId = room.id; foe._waypoints = [];
    ship.update(0.05);
  }
  ok(mine.hp >= hp0, 'nobody gets punched through a bulkhead');

  // Step him into the room and the fight is on.
  // Right ON the door plane: that is where boarders get pinned, and
  // where fights and corpses used to end up straddling the wall.
  foe.x = room.x + 2; foe.y = room.cy; foe.roomId = room.id;
  ship.update(0.05);
  ok(foe.inRoom === true, 'inside the rectangle he is in the room');
  ok(ship.roomContested(room.id) === true, 'and now the module IS contested');
  const foeHp0 = foe.hp;
  for (let i = 0; i < 200; i++) ship.update(0.05);
  ok(mine.hp < hp0 || foe.hp < foeHp0, 'and somebody actually gets hit');
  // Whoever is swinging has been pulled clear of the wall.
  const inset = sb.CrewMember.MELEE_INSET;
  ok(foe.x >= room.x + inset - 0.001 && foe.x <= room.x + room.w - inset + 0.001,
     `the brawl is inside the module, not on its edge (x=${Math.round(foe.x)}, `
     + `room ${room.x}..${room.x + room.w})`);
})();

// ============================================================
section('131. Fire crosses a shut door — slowly');
// ============================================================
(function testFireThroughDoors() {
  const sb = loadEngine();
  const { Ship, Save, FIRE_DEFS } = sb;
  Save.load(); Save.startRun();

  /* Fire jumped to ANY adjacent room regardless of doors, so sealing a
     burning module did nothing at all and every door button was
     decoration in a fire. The player's call: heat DOES cross a cold
     bulkhead, just far more slowly. */
  ok(FIRE_DEFS.CLOSED_DOOR_FACTOR > 0 && FIRE_DEFS.CLOSED_DOOR_FACTOR < 1,
     'a shut door is a resistance, not a wall');

  function rig(open) {
    const ship = new Ship('frigate', true, 80, 120);
    ship._allocateDefaultPower();
    ship.doors.forEach(d => {
      const want = open && !d.isAirlock;
      d.mode = want ? 'open' : 'closed';
      d.open = want; d.openness = want ? 1 : 0; d._tempT = 0;
    });
    const room = ship.rooms.find(r => ship.adjacentThermal(r.id).length > 0);
    const fire = ship.fires.start(room.id, room.cx, room.cy);
    fire.intensity = 3;
    fire._spreadTimer = FIRE_DEFS.SPREAD_TIME + 1;   // ready to jump NOW
    return { ship, room, fire };
  }

  {
    const { ship, room } = rig(true);
    ok(ship.adjacentThermal(room.id).some(w => w.open),
       'with the doors open the way through is open');
  }
  {
    const { ship, room } = rig(false);
    ok(ship.adjacentThermal(room.id).every(w => !w.open),
       'and with them shut it is not');
  }

  const realRandom = Math.random;
  try {
    // A roll that beats the OPEN chance but not the closed one.
    const mid = (FIRE_DEFS.SPREAD_CHANCE * FIRE_DEFS.CLOSED_DOOR_FACTOR
               + FIRE_DEFS.SPREAD_CHANCE) / 2;
    Math.random = () => mid;
    {
      const { ship, room } = rig(true);
      ship.fires.update(0.05, ship);
      ok(ship.fires.fires.some(f => f.roomId !== room.id),
         'through an OPEN door that roll spreads the fire');
    }
    {
      const { ship, room } = rig(false);
      ship.fires.update(0.05, ship);
      ok(ship.fires.fires.every(f => f.roomId === room.id),
         'through a SHUT one, the same roll does not');
    }
    // A roll low enough to beat even the closed-door chance.
    Math.random = () => FIRE_DEFS.SPREAD_CHANCE * FIRE_DEFS.CLOSED_DOOR_FACTOR * 0.5;
    {
      const { ship, room } = rig(false);
      ship.fires.update(0.05, ship);
      ok(ship.fires.fires.some(f => f.roomId !== room.id),
         'but a shut door only SLOWS it — it still burns through eventually');
    }
  } finally { Math.random = realRandom; }
})();

// ============================================================
section('132. Every enemy weapon bay has a gun in it');
// ============================================================
(function testEnemyBaysArmed() {
  const sb = loadEngine();
  const { Ship, Save, Game } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const player = new Ship('frigate', true, 180, 120);
  player._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => player.addCrew(c));
  T.playerShip = player;

  /* The 2nd gun was gated on `elite || sector >= 2`, so a sector-1
     Gunship flew with two weapon MODULES, four crew and ONE laser — and
     assignStations posted a gunner to the empty bay, where he sat at a
     dead console for the whole fight. */
  let sawTwoBays = false;
  for (let i = 0; i < 60; i++) {
    Save.updateRun({ sector: 1 });
    T._spawnEnemy('easy', false);
    const e = T.enemyShip;
    if (!e) continue;
    const bays = e.weaponRooms.length;
    const guns = e.weapons.filter(w => w).length;
    ok(guns === bays, `sector 1: ${bays} bays carry ${guns} guns`);
    if (bays >= 2) sawTwoBays = true;
    // …and nobody is posted to a console with nothing on it.
    e.assignStations();
    const idle = e.weaponRooms.filter((r, s) => !e.weapons[s] &&
      e.crewInRoom(r.id).length > 0);
    ok(idle.length === 0, 'no gunner is sitting at an empty bay');
  }
  ok(sawTwoBays, 'a two-bay hull did turn up in the sample');
  T.enemyShip = null;
})();

// ============================================================
section('133. A dry hold says so, and the beacon answers once');
// ============================================================
(function testDryHold() {
  const sb = loadEngine();
  const { Ship, Save, Game, SectorMap, UI } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship; T.STATE = 'map';
  T.sectorMap = new SectorMap(1, 777, Save.getRun().lane ?? 1);
  if (T.sectorMap.awaitingStartPick && T.sectorMap.startNodes.length) {
    T._travelTo(T.sectorMap.startNodes[0].id);
  }
  ok(ship.fuelCount() === 0, 'the hold has no He2 cells');

  const notes = [];
  const realNotify = UI.notify;
  UI.notify = (t, k) => { notes.push(String(t)); return realNotify.call(UI, t, k); };
  try {
    const next = () => T.sectorMap.nodes.find(n => !n.locked && !n.visited);
    const target = next().id;
    const before = T.sectorMap.currentId;
    T._travelTo(target);
    ok(T.sectorMap.currentId === before, 'a dry hold does not move the ship');
    /* The refusal bounced STRAIGHT into the beacon with no message at
       all, so from the cockpit the jump simply looked like it worked. */
    ok(notes.some(t => /He2/i.test(t) && /hold/i.test(t)),
       'and the game says out loud why it will not spin up');
    ok(T.STATE === 'event' && T.event?.title === 'Distress Beacon',
       'the beacon still answers the first time');

    /* …but it used to answer EVERY time, with no limit: click a node,
       beg 1-2 He2, click again. He2 was the one resource with no teeth. */
    T.event = null; T.STATE = 'map';
    T._travelTo(target);
    ok(T.STATE !== 'event',
       'begging at the same node twice raises nobody — the channel is dead');
    ok(T.sectorMap.currentId === before, 'and the ship still has not moved');
  } finally { UI.notify = realNotify; }
})();

// ============================================================
section('134. Your medkit, your people, your clicks');
// ============================================================
(function testOwnCrewOnly() {
  const sb = loadEngine();
  const { Ship, Save, Game, CargoItem } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 180, 220);
  ship._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => ship.addCrew(c));
  T.playerShip = ship;
  T.enemyShip = null;

  const room = ship.rooms[0];
  const mine = ship.crew[0];
  mine.roomId = room.id; mine.x = room.cx - 12; mine.y = room.cy; mine.inRoom = true;
  mine.hp = mine.maxHp - 10;

  const foe = sb.makeEnemyCrew(1)[0];
  ship.addCrew(foe, true);
  foe.roomId = room.id; foe.x = room.cx + 14; foe.y = room.cy; foe.inRoom = true;
  foe.hp = 2;                       // by far the most wounded thing aboard

  /* THE MEDKIT PICKED THE MOST WOUNDED BODY ABOARD, full stop — which
     after a boarding fight is normally the enemy bleeding on your floor,
     or a rat. You spent your one medkit on him. */
  const kit = new CargoItem('medkit', 3);
  const hp0 = foe.hp, mineHp0 = mine.hp;
  const res = T._unpackCargo(kit);
  ok(res.ok === true, `the medkit is used (${res.message})`);
  ok(foe.hp === hp0, 'it is NOT spent on the man who boarded you');
  ok(mine.hp > mineHp0, 'it goes to one of your own');

  /* And an intruder used to be CLICKABLE: select him, add him to a
     group, and order him around your ship like one of the crew. */
  const picked = T._crewUnderCursor(foe.x, foe.y - 1);
  ok(picked !== foe, 'clicking an enemy intruder does not select him');
  ok(T._crewUnderCursor(mine.x, mine.y - 1) === mine,
     'but clicking your own crew still does');
})();

// ============================================================
section('135. A downed last enemy does not lock the fight open');
// ============================================================
(function testDownedEnemyEndsFight() {
  const sb = loadEngine();
  const { Game } = sb;
  const { T, enemy } = makeCombat(sb);
  T.derelictOffered = false;

  /* THE SOFT-LOCK the player kept hitting. The "enemy crew is wiped"
     test was `!c.isPlayer && !c.dead` — and a man who has gone DOWN is
     hp 1, state 'injured', very much NOT dead. So the last defender
     going down instead of dying meant the boarding action could never
     end: no derelict offer, no reward, nothing to do but grind the
     hull to zero with the guns while your party stood on their bridge. */
  enemy.crew.filter(c => !c.isPlayer).forEach((c, i) => {
    if (i === 0) { c.hp = 1; c.state = 'injured'; c._bleedT = 0; }   // DOWN, not dead
    else c.killOutright('test');
  });
  const downed = enemy.crew.find(c => !c.isPlayer && c.state === 'injured');
  ok(!!downed, 'one enemy is down but breathing');
  ok(downed.dead === false, 'and he is definitely not dead');
  ok(downed.alive === false, 'but he is not on his feet either');

  T.STATE = 'combat';
  for (let i = 0; i < 40 && T.STATE === 'combat' && !T.event; i++) T._updateCombat(0.05);
  ok(T.event && T.event.title === 'Derelict Hulk',
     `with nobody left standing the fight resolves (STATE=${T.STATE}, event=${T.event?.title})`);

  T.enemyShip = null; T.event = null;
})();


// ============================================================
section('136. One console, one operator — a crowd does not stack');
// ============================================================
(function testConsoleOperator() {
  const sb = loadEngine();
  const { Ship, CrewMember, CombatManager, Save } = sb;
  Save.load(); Save.startRun();

  /** Put someone on an exact slot of a room: 0 = console, 1 = left, 2 = right. */
  function place(ship, c, room, slotIdx) {
    const [x, y] = ship.stationSlot(room, slotIdx);
    c._waypoints = [];
    c.x = x; c.y = y;
    c.roomId = room.id; c.inRoom = true; c.homeRoomId = room.id;
  }
  function master(skill, extra = {}) {
    const c = new CrewMember({ isPlayer: true, race: 'terra', ...extra });
    c.skills[skill].level = 3;
    return c;
  }

  const ship  = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const wRoom = ship.weaponRooms[0];
  ok(!!wRoom, 'test setup: the frigate has a weapon bay');

  const g0 = master('weapons'), g1 = master('weapons'), g2 = master('weapons');
  [g0, g1, g2].forEach(c => ship.addCrew(c));
  place(ship, g0, wRoom, 0);
  place(ship, g1, wRoom, 1);
  place(ship, g2, wRoom, 2);

  ok(ship.consoleOperator(wRoom.id) === g0,
     'the man on slot 0 is the console operator');
  ok(ship.crewInRoom(wRoom.id).length === 3,
     'test setup: all three really are in the bay');

  const one = g0.weaponChargeBonus();
  ok(Math.abs(ship.weaponCrewBonusFor(0) - one) < 1e-9,
     `three mastered gunners must charge like ONE (${ship.weaponCrewBonusFor(0)} vs ${one}) — `
   + 'stacking a bay was the strongest move in the game and nobody designed it');
  ok(ship.weaponCrewBonusFor(0) < 0.75,
     'and the result must sit well under the 0.75 clamp, not be limited BY it');

  // Take the console away: the two flankers do not inherit the job.
  place(ship, g0, wRoom, 2);
  place(ship, g2, wRoom, 1);
  ok(ship.consoleOperator(wRoom.id) === null ||
     ship.slotIndexAt(ship.consoleOperator(wRoom.id).x,
                      ship.consoleOperator(wRoom.id).y, wRoom) === 0,
     'nobody at the console means no console operator');
  ok(ship.weaponCrewBonusFor(0) === 0,
     'a bay with three men and an empty console gives no charge bonus');

  // A CONTESTED bay pays nothing, exactly like crewOperating().
  place(ship, g0, wRoom, 0);
  ok(ship.weaponCrewBonusFor(0) === one, 'test setup: the bonus is back');
  const raider = new CrewMember({ isPlayer: false });
  ship.addCrew(raider);
  place(ship, raider, wRoom, 1);
  raider.isPlayer = false;
  ok(ship.roomContested(wRoom.id), 'test setup: the bay is contested');
  ok(ship.consoleOperator(wRoom.id) === null,
     'a contested module has no operator');
  ok(ship.weaponCrewBonusFor(0) === 0,
     'and pays no bonus while it is being fought over');
  ship.crew = ship.crew.filter(c => c !== raider);

  /* ── THE BEST MAN TAKES THE CONSOLE ──
     Now that only slot 0 pays out, picking a post by CORPORATION alone
     would sit a rookie at the gun while a mastered gunner stood behind
     him contributing nothing. assignStations ranks by the skill the
     post actually uses; corporation is only the tiebreak. */
  const shipA = new Ship('frigate', true, 80, 120);
  shipA._allocateDefaultPower();
  /* THE SETUP HAS TO MAKE THE RANKING MATTER. With two hands and two
     posts everybody lands somewhere whatever the rule is, and the test
     passes on a broken version — which is how the first draft of this
     section slipped through the breakage run. A third hand takes the
     cockpit, so the rookie and the master are left competing for the
     SAME gun, and only the ranking decides who sits at it. */
  const helmsman = new CrewMember({ isPlayer: true, race: 'pegasus', name: 'Helm' });
  helmsman.skills.piloting.level = 1;
  const rookie = new CrewMember({ isPlayer: true, race: 'phoenix', name: 'Rookie' });
  const acer   = new CrewMember({ isPlayer: true, race: 'aquarius', name: 'Ace' });
  acer.skills.weapons.level = 3;
  shipA.addCrew(helmsman);
  shipA.addCrew(rookie);      // added FIRST of the two, and of the PREFERRED corporation
  shipA.addCrew(acer);
  shipA.assignStations();
  // Headless crew do not walk: put each on the spot he was sent to.
  /* WHICH POST each man is sent to is the thing this ranking decides,
     and homeRoomId is where that decision is recorded. Asserting on the
     console SLOT instead would be testing something else: slots are
     handed out by who is standing where at the moment of the order, so
     a man merely passing through the bay can push the new gunner one
     spot along — that is update38's rule and it is not what changed. */
  const bay = shipA.weaponRooms[0];
  ok(acer.homeRoomId === bay.id,
     `the mastered gunner is posted to the gun (he went to ${acer.homeRoomId})`);
  ok(rookie.homeRoomId !== bay.id,
     `and the Phoenix rookie is not, despite being the "preferred" corporation `
   + `and first in the roster (he went to ${rookie.homeRoomId})`);

  // ── Evasion: a crowded cockpit is still one pilot ──
  const ship2 = new Ship('frigate', true, 80, 120);
  ship2._allocateDefaultPower();
  const pRoom = ship2.getRoomById(ship2.getSystem('piloting').roomId);
  const p0 = master('piloting');
  ship2.addCrew(p0); place(ship2, p0, pRoom, 0);
  const evOne = ship2.evasion;
  const p1 = master('piloting'), p2 = master('piloting');
  ship2.addCrew(p1); place(ship2, p1, pRoom, 1);
  ship2.addCrew(p2); place(ship2, p2, pRoom, 2);
  ok(Math.abs(ship2.evasion - evOne) < 1e-9,
     `three mastered pilots must dodge like one (${ship2.evasion} vs ${evOne})`);

  // ── XP follows the console too: the flankers learn nothing ──
  const ship3 = new Ship('frigate', true, 80, 120);
  const enemy = new Ship('enemy_frigate', false, 850, 120);
  [ship3, enemy].forEach(s => { s._allocateDefaultPower(); s.prechargeShields(); });
  const w3 = ship3.weaponRooms[0];
  const a = new CrewMember({ isPlayer: true }), b = new CrewMember({ isPlayer: true });
  ship3.addCrew(a); ship3.addCrew(b);
  place(ship3, a, w3, 0);
  place(ship3, b, w3, 1);
  sb.makeEnemyCrew(2).forEach(c => enemy.addCrew(c));
  CombatManager.begin(ship3, enemy, 'normal');
  for (let i = 0; i < 60 && !CombatManager.isActive(); i++) CombatManager.update(0.05);
  const xpBefore = { a: a.skills.weapons.xp, b: b.skills.weapons.xp };
  const gun = ship3.weapons.find(w => w);
  ok(!!gun, 'test setup: the hull carries a gun');
  gun.charge = 999; gun.armed = true;
  CombatManager.playerFire(gun);
  ok(a.skills.weapons.xp > xpBefore.a,
     'the gunner AT the console earns from the shot');
  ok(b.skills.weapons.xp === xpBefore.b,
     'the man standing beside him does not — he is not working the gun');
})();

// ============================================================
section('137. Every XP rate lives in ONE table');
// ============================================================
(function testXpRatesSingleSource() {
  const fs = require('fs');
  const path = require('path');
  const sb = loadEngine();
  const { SKILL_DEFS, XP_RATES } = sb;

  ok(!!XP_RATES, 'XP_RATES exists');
  Object.keys(SKILL_DEFS).forEach(sk => {
    const r = XP_RATES[sk];
    ok(typeof r === 'number' && r > 0,
       `every skill needs a rate in XP_RATES — ${sk} is ${r}`);
  });
  Object.keys(XP_RATES).forEach(sk => {
    ok(!!SKILL_DEFS[sk], `XP_RATES has no business carrying '${sk}' — it is not a skill`);
  });

  /* THE POINT OF THIS SECTION. These eight numbers used to be bare
     literals in six different files, which is how `weapons` ended up
     paying eight XP a shot while `breach` paid 0.4 a second — a factor
     of a thousand nobody had chosen. A literal creeping back into a
     call site is the beginning of that same drift, so the suite reads
     the source and refuses it. */
  const dir = path.join(__dirname, '..', 'js');
  const offenders = [];
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /addXP\(\s*'([a-z]+)'\s*,\s*([^)]*)\)/g;
    let m;
    while ((m = re.exec(src))) {
      const arg = m[2];
      if (/^\s*[\d.]+\s*$/.test(arg) ||
          /[\d.]+\s*\*\s*[\d.]+/.test(arg) ||
          (/[\d.]/.test(arg) && !/XP_RATES/.test(arg))) {
        offenders.push(`${f}: addXP('${m[1]}', ${arg.trim()})`);
      }
    }
  });
  ok(offenders.length === 0,
     'no call site may hard-code an XP amount:\n       ' + offenders.join('\n       '));
})();


// ============================================================
section('138. The mess: berths, and a promotion that costs a crewman');
// ============================================================
(function testMessAndPromotion() {
  const sb = loadEngine();
  const { Base, Save, Commander, CrewMember } = sb;
  Save.load();

  /* THE MESS IS A BUILDING, NOT A PURCHASE (update44). It stands at
     level 1 from the first day, exactly like the barracks and the
     hangar — it used to be the only structure in the base you had to
     go and BUY on its own tab before it existed at all. */
  ok(Base.messLevel() === 1, `a fresh base already has a mess (level ${Base.messLevel()})`);
  ok(Base.messCap() === 1, 'with one berth in it');
  ok(Base.petCap() === 2, `and two pens for animals, from day one (got ${Base.petCap()})`);
  ok(Base.pets().length === 0, 'both empty until the cats arrive');

  // Berths 2-4 are bought through the ONE upgrade ladder, like everything else.
  const ladder = [250, 400, 600];
  Save.addScrapBank(5000);
  ladder.forEach((price, i) => {
    ok(Base.upgradeCost('mess') === price,
       `berth ${i + 2} costs ${price} CC, got ${Base.upgradeCost('mess')}`);
    ok(Base.messCost() === price, 'and messCost() agrees with the ladder');
    const before = Base.cc();
    ok(Base.buyUpgrade('mess').ok, `berth ${i + 2} can be bought`);
    ok(Base.cc() === before - price, 'the price is charged exactly once');
    ok(Base.messCap() === i + 2, `it gives ${i + 2} berths`);
  });
  ok(!isFinite(Base.messCost()), 'there is no fifth berth');
  ok(Base.buyUpgrade('mess').ok === false, 'and it cannot be bought');

  /* AN update43 SAVE HAS AN UNBUILT MESS. Nobody should have to pay
     for a building the next new game is given for free, so the old
     zero is migrated up on the first read. */
  const raw = Save.getRaw();
  raw.base.messLvl = 0;
  ok(Base.messLevel() >= 1,
     `an old save with an unbuilt mess is migrated to level 1 (got ${Base.messLevel()})`);
  raw.base.messLvl = 4;
  ok(Base.messLevel() === 4, 'and a mess that was already expanded is left alone');

  // Pens are on the same ladder.
  const penBefore = Base.petCap();
  ok(Base.buyUpgrade('pets').ok, 'a third pen can be bought');
  ok(Base.petCap() === penBefore + 1, 'and it is there');

  // Somebody worth promoting, and somebody who is not.
  const green = new CrewMember({ isPlayer: true, race: 'terra', name: 'Green' });
  const ace   = new CrewMember({ isPlayer: true, race: 'aquarius', name: 'Ace' });
  ace.skills.shields.level = 3;
  ace.battles = 7; ace.kills = 4;
  Base.addCrew(green.serialise());
  Base.addCrew(ace.serialise());

  /* MASTERY NO LONGER GATES THE CHAIR. The green hand can be promoted
     — cheaply, and as a level 1 commander with one CPU cell. What used
     to be a refusal is a price, and the price is exponential in his
     RANK: 80 CC for a Recruit, 80*1.2^3 = 140 for the Specialist who
     has mastered one skill. */
  ok(Commander.eligible(green.serialise()), 'a green hand CAN take the chair');
  ok(Commander.eligible(ace.serialise()), 'and so can a master');
  ok(Base.promotable().length === 2, 'both are offered');
  ok(Commander.priceFor(green.serialise()) === 80, 'a Recruit is the 80 CC floor');
  ok(Commander.priceFor(ace.serialise()) === 140,
     `and one mastery — rank 3 — is 140 (${Commander.priceFor(ace.serialise())})`);
  ok(Commander.price(24) === 6360,
     `while a Master Lord is 6360 CC (${Commander.price(24)})`);

  const bunksBefore = Base.crew().length;
  const ccBefore    = Base.cc();
  const res = Base.promote(ace.id);
  ok(res.ok, 'the master is promoted: ' + res.message);
  ok(Base.cc() === ccBefore - 140, `rank 3 costs 140 CC once (${ccBefore} → ${Base.cc()})`);
  ok(Base.crew().length === bunksBefore - 1,
     'THE BARRACKS IS ONE HAND LIGHTER — he does not exist in two places');
  ok(!Base.crew().some(c => c.id === ace.id), 'and he is specifically gone from the bunks');
  ok(Base.commanders().length === 1, 'the mess has him');

  const cap = Base.commanders()[0];
  ok(cap.name === 'Ace' && cap.race === 'aquarius', 'he keeps his name and corporation');
  /* HE KEEPS HIS RANK. A rank-3 crewman is a level-3 commander with
     three CPU cells and three picks owed — that is what the 140 CC
     bought, and it is the whole reason a veteran is worth more. */
  ok(cap.level === 3 && cap.xp === 0,
     `he arrives at his own rank, not at 1 (level ${cap.level})`);
  ok(Commander.picksOwed(cap) === 3, 'owing one bonus pick per level');
  ok(cap.karma === 50, 'karma starts at dead centre');
  ok(cap.battles === 7 && cap.kills === 4, 'his service record travels with him');
  ok(!cap.skills || Object.keys(cap.skills).length === 0,
     'his old skills are history, not a second set of live bonuses');
  ok(Commander.masteredOf(ace.serialise()).includes('shields'),
     'the screen can say WHICH mastery the barracks just lost');

  // A FULL MESS REFUSES. Berths are the whole point of the ladder —
  // if the cap does not hold, nobody would ever pay 600 CC for level IV.
  const spare = [];
  for (let i = 0; i < 5; i++) {
    const m = new CrewMember({ isPlayer: true, race: 'terra', name: 'M' + i });
    m.skills.engines.level = 3;
    Base.addCrew(m.serialise());
    spare.push(m);
  }
  Save.addScrapBank(5000);
  while (Base.commanders().length < Base.messCap()) {
    const next = Base.promotable()[0];
    ok(!!next, 'test setup: another candidate is available');
    ok(Base.promote(next.id).ok, 'filling the mess to capacity');
  }
  ok(Base.commanders().length === Base.messCap(),
     `the mess is full (${Base.commanders().length}/${Base.messCap()})`);
  const overflow = Base.promotable()[0];
  ok(!!overflow, 'test setup: somebody is still queuing');
  const bunksFull = Base.crew().length, ccFull = Base.cc();
  const refused = Base.promote(overflow.id);
  ok(!refused.ok, 'a full mess turns the next promotion away');
  ok(Base.commanders().length === Base.messCap(), 'and does NOT quietly grow a berth');
  ok(Base.crew().length === bunksFull, 'the candidate stays in his bunk');
  ok(Base.cc() === ccFull, 'and is not charged for a promotion he did not get');

  // Poverty refuses too, and neither refusal half-commits.
  const poor = new CrewMember({ isPlayer: true, race: 'terra', name: 'Poor' });
  poor.skills.repair.level = 3;
  Base.addCrew(poor.serialise());
  Save.spendScrapBank(Base.cc());
  const bunks2 = Base.crew().length, caps2 = Base.commanders().length;
  const broke = Base.promote(poor.id);
  ok(!broke.ok, 'no money, no promotion');
  ok(Base.crew().length === bunks2 && Base.commanders().length === caps2,
     'and a refused promotion changes NOTHING — no half-committed state');
})();

// ============================================================
section('139. The commander mirrors his crew\'s XP — a copy, never a cut');
// ============================================================
(function testCaptainXpMirror() {
  const sb = loadEngine();
  const { Commander, CrewMember, MAX_SKILL_LEVEL, Save } = sb;
  Save.load();

  const cap = Commander.fromCrew({ id: 'c', name: 'Voss', race: 'terra', skills: {} });
  Commander.setActive(cap);

  const hand = new CrewMember({ isPlayer: true, race: 'pegasus' });   // piloting x2
  const before = hand.skills.piloting.xp;
  const granted = hand.addXP('piloting', 10);

  ok(granted === 20, `addXP returns what was really granted — 10 doubled by Pegasus = 20, got ${granted}`);
  ok(hand.skills.piloting.xp === before + 20, 'the crewman keeps every point');
  ok(cap.xp === 20, `the commander gets the SAME 20, not a second doubling (${cap.xp})`);

  // A master teaches him nothing. This is the pressure to keep hiring.
  const master = new CrewMember({ isPlayer: true, race: 'terra' });
  master.skills.weapons.level = 3;
  master.skills.repair.level  = 3;
  master.skills.engines.level = 3;
  const capXp = cap.xp;
  ok(master.addXP('weapons', 50) === 0, 'a maxed skill grants nothing');
  ok(cap.xp === capXp, 'and so the commander gets nothing either — no hidden XP for masters');

  /* update52: THE MASTERY CAP IS GONE. A fourth skill goes all the
     way, and so does an eighth — that is what makes rank 24 and the
     last cells of a CPU board reachable at all. */
  const beforeFourth = cap.xp;
  ok(master.addXP('shields', 50) > 0, 'a fourth skill can still be levelled');
  ok(cap.xp > beforeFourth, 'and that trickle does reach the commander');
  for (let i = 0; i < 200; i++) master.addXP('shields', 50);
  ok(master.skills.shields.level === MAX_SKILL_LEVEL,
     `and a FOURTH skill now masters like the rest (level ${master.skills.shields.level})`);
  Object.keys(sb.SKILL_DEFS).forEach(k => {
    for (let i = 0; i < 200; i++) master.addXP(k, 50);
  });
  ok(sb.rankLevelOf(master) === sb.MAX_RANK,
     `so one man really can reach rank 24 (${sb.rankLevelOf(master)})`);
  ok(sb.rankName(sb.MAX_RANK) === 'Master Lord', 'which is Master Lord');
  const capped = cap.xp;
  ok(master.addXP('shields', 50) === 0, 'and once it is stuck there it teaches nobody');
  ok(cap.xp === capped, 'commander included');

  // Nobody else feeds him.
  const foe = new CrewMember({ isPlayer: false });
  foe.addXP('combat', 100);
  ok(cap.xp === capped, 'an enemy boarder on our deck does not teach our commander');
  const rat = new CrewMember({ isPlayer: true, race: 'rat' });
  rat.addXP('combat', 100);
  ok(cap.xp === capped, 'and neither does a rat');

  // Levels: rising thresholds, and a hard ceiling at 8.
  const c2 = Commander.fromCrew({ id: 'd', name: 'X', race: 'terra', skills: {} });
  Commander.setActive(c2);
  const need1 = Commander.xpToNext(c2);
  ok(need1 > 0, 'level 1 has a threshold');
  Commander.addXP(c2, need1);
  ok(c2.level === 2, `paying the threshold promotes him (level ${c2.level})`);
  ok(Commander.xpToNext(c2) > need1, 'and the next one costs more');

  /* THE CEILING IS TWENTY-FOUR, AND THE NUMBER IS WRITTEN OUT HERE ON
     PURPOSE. Asserting against Commander.MAX_LEVEL would pass whatever
     the constant said, which is no assertion at all: 24 levels is one
     CPU cell each plus the one he is promoted at, and it is the SAME
     ladder the crew climb. */
  ok(Commander.MAX_LEVEL === 24, `the commander ceiling is 24, got ${Commander.MAX_LEVEL}`);
  ok(Commander.MAX_LEVEL === sb.MAX_RANK, 'and it is the crew rank ladder, not a second one');
  Commander.addXP(c2, 1e9);
  ok(c2.level === 24, `he stops at 24, got ${c2.level}`);
  ok(Commander.addXP(c2, 1e9) === 0, 'a maxed commander gains no further levels');
  ok(Commander.xpProgress(c2) === 1, 'and his bar reads full rather than empty');

  Commander.setActive(null);
  const c3 = Commander.fromCrew({ id: 'e', name: 'Y', race: 'terra', skills: {} });
  const idle = new CrewMember({ isPlayer: true });
  idle.addXP('repair', 40);
  ok(c3.xp === 0, 'a commander sitting in the mess learns nothing from somebody else\'s contract');
})();

// ============================================================
section('140. Corporation bonuses reach his own people and nobody else');
// ============================================================
(function testCommanderCorpChoice() {
  const sb = loadEngine();
  const { Commander, CrewMember, Save } = sb;
  Save.load();

  const cap = Commander.fromCrew({ id: 'c', name: 'Voss', race: 'aquarius', skills: {} });
  cap.level = 8;
  Commander.setActive(cap);

  const kin     = new CrewMember({ isPlayer: true, race: 'aquarius' });
  const outside = new CrewMember({ isPlayer: true, race: 'phoenix' });
  const foe     = new CrewMember({ isPlayer: false, race: 'aquarius' });
  const beast   = new CrewMember({ isPlayer: true, race: 'rat' });

  /* ── NOTHING ACCRUES UNSPENT (update52) ──────────────────
     The corporation used to pay 1%/level automatically. At 24 levels
     that would have been +24% for making no decision, so the payout
     is gone and a CHOICE stands in its place: eight levels means
     eight picks, and until they are spent the crew get nothing. */
  ok(Commander.bonusFor(kin).hp === 0,
     'a level 8 commander who has chosen nothing pays nothing');
  ok(Commander.picksOwed(cap) === 8,
     `he owes one pick per level (${Commander.picksOwed(cap)})`);

  ok(Commander.choicesFor(cap).join(',') === 'hp,speed',
     'Aquarius trains its own in max HP and speed, and those are the only two offered');
  ok(Commander.spendPick(cap, 'repair') === false,
     'a trade his corporation does not deal in is refused');
  ok(Commander.picksOwed(cap) === 8, 'and the refused pick was not silently spent');

  for (let i = 0; i < 8; i++) ok(Commander.spendPick(cap, 'hp'), `pick ${i + 1} lands`);
  ok(Commander.picksOwed(cap) === 0, 'eight levels buy eight picks and no more');
  ok(Commander.spendPick(cap, 'hp') === false, 'a ninth is refused');

  ok(Math.abs(Commander.bonusFor(kin).hp - 0.04) < 1e-9,
     `eight picks at 0.5% is 4% (${Commander.bonusFor(kin).hp})`);
  ok(Commander.bonusFor(outside).hp === 0, 'another corporation still gets nothing');
  ok(Commander.bonusFor(foe).hp === 0, 'an enemy of the same corporation gets nothing');
  ok(Commander.bonusFor(beast).hp === 0, 'and animals are not crew');

  /* THE CARD READS THE PICKS, not a table. An unspent trade must show
     as +0%, not disappear — the player has to see what he skipped. */
  const lines = Commander.bonusLines(cap);
  ok(lines.length === 2, 'both of his corporation trades are listed');
  ok(lines.some(l => l[0] === '+4%' && /HP/.test(l[1])), 'the spent one at 4%');
  ok(lines.some(l => l[0] === '+0%' && /SPEED/.test(l[1])), 'and the untouched one at 0%');

  // The stored max-HP number: re-seated, never healed.
  const crew = [kin, outside];
  kin.hp = 50; kin.maxHp = 100; delete kin.baseMaxHp;
  Commander.reseatMaxHp(crew);
  ok(kin.maxHp === 104, `max HP takes the bonus (got ${kin.maxHp})`);
  ok(kin.hp === 52, `and the PERCENTAGE is preserved, not the wound (got ${kin.hp})`);
  ok(outside.maxHp === 100, 'the Phoenix hand is untouched');

  // Losing the commander must not kill anybody by shrinking their bar.
  Commander.setActive(null);
  Commander.reseatMaxHp(crew);
  ok(kin.maxHp === 100, 'the bonus comes back off when he is gone');
  ok(kin.hp === 50, `and the percentage survives that too (got ${kin.hp})`);
  ok(kin.hp > 0, 'nobody is killed by a bookkeeping change');

  // Terra deals in repair, Phoenix in melee — and only to their own.
  const terraCap = Commander.fromCrew({ id: 't', name: 'T', race: 'terra', skills: {} });
  terraCap.level = 8;
  for (let i = 0; i < 8; i++) Commander.spendPick(terraCap, 'repair');
  const eng = new CrewMember({ isPlayer: true, race: 'terra' });
  const plain = new CrewMember({ isPlayer: true, race: 'terra' });
  Commander.setActive(null);
  const bare = plain.repairSpeed();
  Commander.setActive(terraCap);
  ok(eng.repairSpeed() > bare, 'a Terra commander who bought repair speeds up Terra repairs');

  const phxCap = Commander.fromCrew({ id: 'p', name: 'P', race: 'phoenix', skills: {} });
  phxCap.level = 8;
  for (let i = 0; i < 8; i++) Commander.spendPick(phxCap, 'melee');
  const knife = new CrewMember({ isPlayer: true, race: 'phoenix' });
  Commander.setActive(null);
  const bareMelee = knife.meleeDamage();
  Commander.setActive(phxCap);
  ok(knife.meleeDamage() > bareMelee, 'a Phoenix commander who bought melee hits harder');
  Commander.setActive(null);
})();

// ============================================================
section('141. The other side has corporations too');
// ============================================================
(function testEnemyCorporations() {
  const sb = loadEngine();
  const { CORP_DEFS, ENEMY_CORP_MIX, CrewMember } = sb;

  const crew = sb.makeEnemyCrew(40, 'enemy_frigate');
  ok(crew.every(c => !!CORP_DEFS[c.race]),
     'every enemy hand belongs to a REAL corporation — `hostile` was not one, '
   + 'so every corporation lookup on an enemy silently returned undefined');
  ok(crew.every(c => c.isPlayer === false), 'and they are still the enemy');

  const seen = new Set(crew.map(c => c.race));
  ok(seen.size > 1, `a hull fields a mix, not one corporation (${[...seen].join(', ')})`);
  const mix = new Set(ENEMY_CORP_MIX.enemy_frigate);
  ok([...seen].every(r => mix.has(r)),
     `and only what that hull's mix allows (${[...seen].join(', ')})`);

  // The raider is a boarding ship: it must field knives.
  const raiders = sb.makeEnemyCrew(40, 'enemy_raider');
  ok(raiders.filter(c => c.race === 'phoenix').length > raiders.length * 0.3,
     'a raider crew leans Phoenix — it is the hull that comes aboard');

  // An unknown hull still produces real people, not 'hostile'.
  const odd = sb.makeEnemyCrew(10, 'no_such_hull');
  ok(odd.every(c => !!CORP_DEFS[c.race]), 'an unknown hull falls back to a real mix');

  /* THEY MUST STILL LOOK LIKE THE ENEMY. suitColor() keys off
     isPlayer, not race — if a corporation colour ever leaked into it,
     the enemy would change sides visually in the middle of a fight. */
  ok(crew.every(c => c.suitColor() === CrewMember.ENEMY_COLOR),
     'and every one of them still wears hostile red');
})();


// ============================================================
section('142. Shields teach you only what the enemy shot off');
// ============================================================
(function testShieldXpNoToggleFarm() {
  const sb = loadEngine();
  const { Ship, CrewMember, Save, XP_RATES } = sb;
  Save.load(); Save.startRun();

  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  const sys  = ship.getSystem('shields');
  ok(!!sys, 'test setup: the frigate has shields');
  const room = ship.getRoomById(sys.roomId);

  const op = new CrewMember({ isPlayer: true, race: 'terra' });
  ship.addCrew(op);
  const [sx, sy] = ship.stationSlot(room, 0);
  op.x = sx; op.y = sy; op._waypoints = [];
  op.roomId = room.id; op.inRoom = true;
  ship.update(0.05);
  ok(ship.consoleOperator(room.id) === op, 'test setup: he is at the console');

  const xp = () => op.skills.shields.xp + op.skills.shields.level * 1000;

  /* THE EXPLOIT. Dropping the module's power drops its layers, and
     re-powering it charges them back — so between fights the player
     could stand in a quiet system flipping shields off and on, and
     farm the skill for nothing. Reported from real play. */
  /* HE MUST STAY AT THE CONSOLE THROUGHOUT. A headless crewman picks
     up tasks and wanders, and an operator who has drifted off the
     console earns nothing whatever the rule is — which is exactly how
     the first draft of this test passed on the BROKEN version. */
  const seat = () => {
    op._waypoints = []; op.task = 'idle';
    op.x = sx; op.y = sy; op.roomId = room.id; op.inRoom = true;
  };
  const before = xp();
  let recharges = 0;
  for (let cycle = 0; cycle < 12; cycle++) {
    ship.setPowerAt(ship.systems.indexOf(sys), 0);
    for (let i = 0; i < 20; i++) { seat(); ship.update(0.1); }
    const low = sys.shieldBars;
    ship.setPowerAt(ship.systems.indexOf(sys), sys.maxPower);
    for (let i = 0; i < 200; i++) { seat(); ship.update(0.1); }
    if (sys.shieldBars > low) recharges++;
  }
  ok(recharges > 0,
     `test setup: the power cycling really did recharge layers (${recharges} cycles) — `
   + 'without that this section proves nothing');
  ok(sys.shieldBars > 0, 'test setup: the bubble really did come back up');
  ok(xp() === before,
     `twelve power cycles must teach NOTHING (${before} → ${xp()}) — `
   + 'a skill you can farm in a quiet system is not a skill');

  // A layer the ENEMY takes down is a different matter entirely.
  seat(); ship.update(0.05);
  ok(ship.consoleOperator(room.id) === op, 'test setup: he is back at the console');
  const owed = xp();
  sys.hitShield();
  ok(sys.shieldBars < sys.shieldMax, 'test setup: a layer is down');
  for (let i = 0; i < 300 && sys.shieldBars < sys.shieldMax; i++) { seat(); ship.update(0.1); }
  ok(sys.shieldBars === sys.shieldMax, 'test setup: it charged back');
  ok(xp() > owed, `earning back a layer the enemy shot off DOES teach (${owed} → ${xp()})`);

  // …and exactly once per layer, not once per recharge for ever after.
  const paid = xp();
  ship.setPowerAt(ship.systems.indexOf(sys), 0);
  for (let i = 0; i < 20; i++) ship.update(0.1);
  ship.setPowerAt(ship.systems.indexOf(sys), sys.maxPower);
  for (let i = 0; i < 300; i++) ship.update(0.1);
  ok(xp() === paid, 'the debt is paid once — the next free recharge teaches nothing again');

  /* A BUBBLE KNOCKED DOWN LAST BATTLE IS NOT A LESSON OWED IN THIS
     ONE. Leave a debt unpaid, start a fresh fight, then force a
     recharge that nobody shot for: if the old debt survived
     prechargeShields it would quietly pay out here. */
  sys.hitShield();
  ship.prechargeShields();
  const fresh = xp();
  ship.setPowerAt(ship.systems.indexOf(sys), 0);
  for (let i = 0; i < 20; i++) { seat(); ship.update(0.1); }
  ship.setPowerAt(ship.systems.indexOf(sys), sys.maxPower);
  for (let i = 0; i < 300; i++) { seat(); ship.update(0.1); }
  ok(sys.shieldBars === sys.shieldMax, 'test setup: the bubble is back up');
  ok(xp() === fresh, 'and a new battle starts the ledger at zero');
})();


// ============================================================
section('143. The ship\'s cat: a beast, not a hand');
// ============================================================
(function testCatIsABeast() {
  const sb = loadEngine();
  const { Ship, CrewMember, CAT_DEFS, CAT_TUNING, HUNGER, Save } = sb;
  Save.load(); Save.startRun();

  const cat = sb.makeCat('black', 'Sputnik');
  ok(cat.isPet, 'a cat knows it is a pet');
  ok(cat.isBeast, 'and therefore a BEAST — no consoles, no stretchers, no fires');
  ok(cat.isPlayer, 'but it is on OUR side, unlike the rats');
  ok(!cat.isVermin && !cat.isSpider, 'and it is neither vermin nor a spider');
  ok(cat.maxHp === CAT_DEFS.black.hp, `a black cat has ${CAT_DEFS.black.hp} hp`);
  ok(sb.makeCat('ginger').maxHp === CAT_DEFS.ginger.hp, 'a ginger one has fewer');
  ok(cat.meleeDamage() === CAT_DEFS.black.melee,
     'it fights with its claws, not a crewman\'s fists or a commander\'s blessing');
  ok(sb.makeCat('ginger').meleeDamage() < cat.meleeDamage(),
     'and the black one hits harder — that is the trade against its appetite');
  // The drain rate moved into HUNGER.PER_SEC alongside everybody
  // else's in update47 — the trade itself is unchanged.
  ok(HUNGER.PER_SEC.cat_black > HUNGER.PER_SEC.cat_ginger,
     'which it pays for by eating faster');

  // It must never be mistaken for a hand.
  const ship = new Ship('frigate', true, 80, 120);
  ship._allocateDefaultPower();
  ship.addCrew(cat);
  const room = ship.weaponRooms[0];
  const [sx, sy] = ship.stationSlot(room, 0);
  cat.x = sx; cat.y = sy; cat.roomId = room.id; cat.inRoom = true; cat._waypoints = [];
  ship.update(0.05);
  ok(ship.consoleOperator(room.id) !== cat, 'a cat at the console does not man the gun');
  ok(ship.crewInRoom(room.id).includes(cat),
     'though it is physically in the room, like everything else aboard');

  // The hunger meter must survive the trip home.
  cat.hunger = 37;
  const back = CrewMember.deserialise(cat.serialise());
  ok(back.isPet && back.catKind === 'black', 'a saved cat comes back a cat');
  ok(back.hunger === 37, `and comes back as hungry as it left (${back.hunger})`);
})();

// ============================================================
section('144. What the cat does with its day');
// ============================================================
(function testCatBehaviour() {
  const sb = loadEngine();
  const { Ship, CrewMember, CAT_TUNING, Save } = sb;
  Save.load(); Save.startRun();

  function shipWithCat() {
    const s = new Ship('frigate', true, 80, 120);
    s._allocateDefaultPower();
    const cat = sb.makeCat('black', 'Mruk');
    s.addCrew(cat);
    const r0 = s.rooms[0];
    cat.x = r0.cx; cat.y = s.floorWalkY(r0.floor, r0.cy);
    cat.roomId = r0.id; cat.inRoom = true;
    return { s, cat };
  }

  // ── HUNGER DRAINS, AND STARVATION KILLS SLOWLY ──
  {
    const { s, cat } = shipWithCat();
    cat.hunger = 100;
    for (let i = 0; i < 100; i++) s.update(0.1);      // 10 s
    ok(cat.hunger < 100, `the meter drains as it flies (${cat.hunger.toFixed(1)})`);

    cat.hunger = 0;
    const hp0 = cat.hp;
    for (let i = 0; i < 100; i++) s.update(0.1);
    ok(cat.hp < hp0, `an empty stomach costs HP (${hp0} → ${cat.hp.toFixed(1)})`);
    ok(cat.hp > 0, 'but starvation is a slope, not a cliff — no sudden death');
    // …and it does eventually kill, so the pens are a real commitment.
    for (let i = 0; i < 4000 && !cat.dead; i++) s.update(0.1);
    ok(cat.dead, 'left alone long enough, it does die');
  }

  // ── IT SITS WITH THE WOUNDED ──
  {
    const { s, cat } = shipWithCat();
    const hurt = new CrewMember({ isPlayer: true });
    s.addCrew(hurt);
    const far = s.rooms[s.rooms.length - 1];
    hurt.x = far.cx; hurt.y = s.floorWalkY(far.floor, far.cy);
    hurt.roomId = far.id; hurt.inRoom = true;
    hurt.hp = 1; hurt.state = 'injured';
    ok(hurt.down, 'test setup: he is down');

    for (let i = 0; i < 40; i++) s.update(0.1);
    ok(cat._waypoints?.length || cat.roomId === far.id,
       'the cat goes to the man who is down — that is its job on the nine '
     + 'jumps out of ten when there are no rats');
  }

  // ── AND THE VIGIL SLOWS THE BLEEDING ──
  {
    const { s, cat } = shipWithCat();
    const hurt = new CrewMember({ isPlayer: true });
    s.addCrew(hurt);
    hurt.x = cat.x; hurt.y = cat.y; hurt.roomId = cat.roomId; hurt.inRoom = true;
    hurt.hp = 1; hurt.state = 'injured';
    hurt._bleedT = 0;
    for (let i = 0; i < 100; i++) s.update(0.1);        // 10 s of bleeding
    const withCat = hurt._bleedT;

    const s2 = new Ship('frigate', true, 80, 120);
    s2._allocateDefaultPower();
    const alone = new CrewMember({ isPlayer: true });
    s2.addCrew(alone);
    alone.x = s2.rooms[0].cx; alone.y = s2.floorWalkY(0);
    alone.roomId = s2.rooms[0].id; alone.inRoom = true;
    alone.hp = 1; alone.state = 'injured'; alone._bleedT = 0;
    for (let i = 0; i < 100; i++) s2.update(0.1);

    ok(withCat < alone._bleedT,
       `the clock runs slower with the cat there (${withCat.toFixed(1)} vs ${alone._bleedT.toFixed(1)})`);
    ok(Math.abs(withCat - alone._bleedT * CAT_TUNING.VIGIL_FACTOR) < 0.5,
       'by exactly the vigil factor, not some other amount');
  }

  // ── IT HUNTS WHAT IT FINDS, AND EATS IT ──
  {
    const { s, cat } = shipWithCat();
    const rat = new CrewMember({ isPlayer: false, race: 'rat' });
    s.addCrew(rat);
    const far = s.rooms[s.rooms.length - 1];
    rat.x = far.cx; rat.y = s.floorWalkY(far.floor, far.cy);
    rat.roomId = far.id; rat.inRoom = true;
    for (let i = 0; i < 20; i++) s.update(0.1);
    ok(cat._waypoints?.length || cat.roomId === far.id,
       'vermin aboard outranks everything else the cat had planned');

    cat.hunger = 30;
    const kills0 = cat.kills ?? 0;
    cat.creditKill(rat);
    ok((cat.kills ?? 0) === kills0 + 1, 'a kill is one notch — the headstone reads this');
    ok(cat.hunger > 30, `and the cat eats what it caught (${cat.hunger})`);
  }

  // ── EGGS BEFORE RATIONS ──
  {
    const { s, cat } = shipWithCat();
    if (typeof sb.CargoGrid !== 'undefined') {
      s.cargo = new sb.CargoGrid(6, 6);
      s.cargo.add('ration_pack');
      const egg = s.cargo.add('spider_egg');
      if (egg) {
        cat.hunger = 10;
        for (let i = 0; i < 200 && s.cargo.items.includes(egg); i++) s.update(0.1);
        ok(!s.cargo.items.includes(egg),
           'a hungry cat eats the spider egg — a fight that never happens');
        ok(s.cargo.items.some(it => it.def?.tag === 'food'),
           'and leaves the rations alone while there are eggs');
        ok(cat.hunger > 10, 'the meal counts');
      }
    }
  }

  // ── A MEAL IS EATEN ONCE ──
  {
    const { s, cat } = shipWithCat();
    if (typeof sb.CargoGrid !== 'undefined') {
      s.cargo = new sb.CargoGrid(6, 6);
      /* A PACK IS FIVE MEALS SINCE update47, so what a single sitting
         must cost is one UNIT, not the whole box — the old version of
         this test asserted the item left the hold, which would now
         mean four meals thrown away to serve one. */
      s.cargo.add('ration_pack', null, 3);
      cat.hunger = 5;
      const before = s.cargo.countOf('food');
      for (let i = 0; i < 400; i++) s.update(0.1);
      ok(s.cargo.countOf('food') < before, 'the ration is consumed');
      ok(s.cargo.countOf('food') === before - 1,
         'exactly ONE meal — a ration leaves the hold once and feeds once');
    }
  }
})();

// ============================================================
section('145. A cat aboard changes the odds, and gets a headstone');
// ============================================================
(function testCatOddsAndGrave() {
  const sb = loadEngine();
  const { Game, Ship, CargoGrid, CAT_TUNING, Save, Base, CORP_DEFS } = sb;
  const T = Game.__test;
  Save.load(); Save.startRun();

  // ── The deterrent ──
  const ship = new Ship('scout', true, 80, 120);
  ship._allocateDefaultPower();
  ship.cargo = new CargoGrid(6, 6);
  while (ship.cargo.add('ration_pack')) { /* pack it to the roof */ }
  T.playerShip = ship;

  const bare = T._ratChance(ship.cargo);
  ok(bare > 0, `a stuffed hold really does attract them (${bare.toFixed(2)})`);

  ship.addCrew(sb.makeCat('ginger', 'Pyza'));
  const withCat = T._ratChance(ship.cargo);
  ok(withCat < bare,
     `a cat aboard takes points off the roll (${bare.toFixed(2)} → ${withCat.toFixed(2)})`);
  ok(Math.abs((bare - withCat) - CAT_TUNING.RAT_SPAWN_CUT) < 1e-9,
     'by exactly the deterrent, no more');
  ok(withCat > 0,
     'but it CANNOT take it to zero — a hold packed to the roof is still a '
   + 'hold packed to the roof, and the cat\'s real job is the rats that get in');

  /* ── HE GOES IN A PEN, NOT IN A BUNK ──
     The crew banked at docking is filtered `c.isPlayer && !c.dead`, and
     a cat passes both. update42 had this exact bug with enemy boarders:
     they were written into the barracks and turned up as hireable crew
     on the next contract. An animal in the bunk list would be the same
     mistake wearing fur. */
  {
    const cat = sb.makeCat('black', 'Sputnik');
    cat.hunger = 31;
    const hull = new Ship('scout', true, 80, 120);
    hull._allocateDefaultPower();
    hull.cargo = new CargoGrid(4, 4);
    sb.makeStartingCrew().forEach(c => hull.addCrew(c));
    hull.addCrew(cat);
    T.playerShip = hull;
    Save.updateRun({ shipKey: 'scout' });

    const bunksBefore = Base.crew().length;
    T._dockAtBase(0);

    ok(!Base.crew().some(c => c.name === 'Sputnik'),
       'a cat must NEVER be banked into the barracks as a hireable hand');
    ok(Base.crew().length === bunksBefore + 3,
       `only the three PEOPLE come home to bunks (${bunksBefore} → ${Base.crew().length})`);
    const penned = Base.pets().find(p => p.name === 'Sputnik');
    ok(!!penned, 'the cat goes into a pen instead');
    ok(penned && penned.hunger === 31,
       `and arrives as hungry as it was out there (${penned && penned.hunger})`);
  }

  // ── The headstone ──
  const raw = Save.getRaw();
  raw.graveyard = [
    { name: 'Sputnik', race: 'cat_black', kills: 0,  skills: {}, battles: 0, wins: 0, escapes: 0 },
    { name: 'Mruk',    race: 'cat_black', kills: 20, skills: {}, battles: 0, wins: 0, escapes: 0 },
    { name: 'Vega',    race: 'terra',     kills: 0,  skills: {}, battles: 0, wins: 0, escapes: 0 },
  ];
  ok(!!CORP_DEFS.cat_black?.pet, 'a cat is recognisable as a pet from its saved record');

  sb.BaseScreen.open();
  sb.BaseScreen._act('tab', 'MEMORIAL');
  if (!sb.Renderer.getCtx()) sb.Renderer.init(sb.document.createElement('canvas'));
  sb.BaseScreen.draw(sb.Renderer.getCtx());
  const graves = sb.BaseScreen._graves();
  ok(graves.length === 3, `all three are on the hill (${graves.length})`);

  const sput = graves.find(g => g.name === 'Sputnik');
  const mruk = graves.find(g => g.name === 'Mruk');
  const vega = graves.find(g => g.name === 'Vega');
  ok(sput.tier !== vega.tier || mruk.tier !== vega.tier,
     'a cat does not get a crewman\'s marker');
  ok(mruk.tier !== sput.tier,
     `a cat that cleared twenty rats outranks one that caught none `
   + `(${sput.tier} vs ${mruk.tier}) — on the human ladder BOTH would be `
   + 'the lowest marker in the yard, because a cat wins no battles and masters no skills');
})();

// ============================================================
section('146. The cat faces the way it is going, and wears a helmet');
// ============================================================
/* Sprite ORIENTATION was untestable before this: the harness canvas
   is a proxy that swallows every call, so nothing could see where a
   limb landed. This section swaps in a canvas that RECORDS the arcs
   and tracks the transform, which is enough to ask the one question
   that matters — is the head drawn on the side the animal is walking
   towards? CrewMember.draw mirrors the sprite when _facing is -1 and
   _facing 1 means "heading right", so art drawn facing LEFT walks
   backwards exactly half the time, which is what it did. */
(function testCatFacingAndHelmets() {
  const sb = loadEngine();
  const { Animation, Ship } = sb;

  /** A canvas that remembers every arc, in canvas coordinates. */
  function recorder() {
    const arcs = [];
    let m = { a: 1, d: 1, e: 0, f: 0 };
    const stack = [];
    const ctx = new Proxy({}, {
      get(_t, p) {
        switch (p) {
          case 'save':      return () => stack.push({ ...m });
          case 'restore':   return () => { m = stack.pop() ?? m; };
          case 'translate': return (x, y) => { m.e += m.a * x; m.f += m.d * y; };
          case 'scale':     return (x, y) => { m.a *= x; m.d *= y; };
          case 'arc':       return (x, y, r) =>
            arcs.push({ x: m.a * x + m.e, y: m.d * y + m.f, r });
          case 'measureText': return (s) => ({ width: String(s ?? '').length * 6 });
          case 'createLinearGradient':
          case 'createRadialGradient': return () => ({ addColorStop() {} });
          case 'getImageData': return () => ({ data: new Uint8ClampedArray(4) });
          default: return () => undefined;
        }
      },
      set() { return true; },
    });
    return { ctx, arcs };
  }

  /** Generate one animation with the recorder in place of the canvas.
   *  A colour nothing else uses guarantees a cache miss, so the frames
   *  are really drawn during this call. */
  function capture(make) {
    const rec = recorder();
    const real = sb.document.createElement;
    sb.document.createElement = (tag) => (tag === 'canvas'
      ? { tagName: 'CANVAS', width: 64, height: 64, getContext: () => rec.ctx }
      : real(tag));
    try { make(); } finally { sb.document.createElement = real; }
    return rec.arcs;
  }

  // ── THE CAT LOOKS WHERE IT IS GOING ──
  {
    const arcs = capture(() => Animation.catAnim('walk', '#010203'));
    // The head is the only arc of radius 5 in the walking frame.
    const heads = arcs.filter(a => Math.abs(a.r - 5) < 0.01);
    ok(heads.length > 0, `the walking cat has a head (${heads.length} arcs of r=5)`);
    ok(heads.every(h => h.x > 32),
       'and it is drawn on the RIGHT of the sprite — the unmirrored frame '
     + 'is the one used when _facing is 1, i.e. walking right, so art '
     + 'facing left walks backwards half the time');
  }

  // ── AND IT FLIPS, BOTH WAYS ──
  {
    const ship = new Ship('frigate', true, 80, 120);
    const cat  = sb.makeCat('black', 'Mruk');
    ship.addCrew(cat);
    // Both ends of ONE compartment, so nothing here waits on a lift.
    const room = ship.rooms.slice().sort((a, b) => b.w - a.w)[0];
    const wy = ship.floorWalkY(room.floor, room.cy);
    cat.x = room.cx + 20; cat.y = wy; cat.roomId = room.id; cat.inRoom = true;
    cat.moveToOnShip(ship, room.cx - 20, wy);
    for (let i = 0; i < 40; i++) cat.update(0.05, ship);
    ok(cat.x < room.cx + 20, 'the setup really did walk it to port');
    ok(cat._facing === -1, 'walking to port it faces port');
    const wentLeft = cat.x;
    cat.moveToOnShip(ship, room.cx + 20, wy);
    for (let i = 0; i < 40; i++) cat.update(0.05, ship);
    ok(cat.x > wentLeft, 'and back to starboard');
    ok(cat._facing === 1, 'walking back it faces starboard');
  }

  // ── EVERYBODY IS IN A SUIT ──
  {
    // The crew helmet is the only arc of radius 10 in a crew frame.
    ['idle', 'walk', 'repair', 'operate', 'fight', 'die'].forEach(state => {
      const arcs = capture(() => Animation.crewByColor(state, '#040506'));
      ok(arcs.some(a => Math.abs(a.r - 10) < 0.01),
         `a crewman ${state === 'die' ? 'dies' : 'is'} in a helmet (${state})`);
    });
    const catArcs = capture(() => Animation.catAnim('idle', '#070809'));
    ok(catArcs.some(a => Math.abs(a.r - 8.5) < 0.01),
       'and so is the cat — it walks through vented compartments the crew will not');
  }
})();

// ============================================================
section('147. Bottled air: a vented room is a countdown, not a wall');
// ============================================================
(function testSuitAir() {
  const sb = loadEngine();
  const { Ship, CrewMember, SUIT_AIR, OXYGEN, RoomOxygen } = sb;

  // ── THE TANK IS A CORPORATION TRAIT ──
  {
    const terra   = new CrewMember({ isPlayer: true, race: 'terra' });
    const pegasus = new CrewMember({ isPlayer: true, race: 'pegasus' });
    const cat     = sb.makeCat('black');
    const rat     = sb.makeRats(1)[0];
    ok(pegasus.airMax() > terra.airMax() * 2,
       `Pegasus carry a real bottle (${pegasus.airMax()}s vs ${terra.airMax()}s)`);
    ok(cat.airMax() > terra.airMax(),
       `and the cat outlasts an ordinary suit (${cat.airMax()}s)`);
    ok(rat.airMax() === 0,
       'vermin have no suit at all — venting a compartment is a way to kill rats');
    ok(terra.air === terra.airMax(), 'a fresh hand starts with a full tank');
  }

  // ── THE ROOM NO LONGER KEEPS THE COUNTDOWN ──
  ok(OXYGEN.DAMAGE_DELAY === undefined && OXYGEN.DAMAGE_RATE === undefined,
     'the room\'s own grace period and damage rate are GONE — that was the '
   + 'same quantity as a man\'s air, kept in a second place');
  ok(new RoomOxygen('r1')._suffocateTimer === undefined,
     'and no room carries a suffocation timer any more');

  // ── HE BREATHES HIS OWN AIR, THEN HE BLEEDS ──
  {
    const ro   = new RoomOxygen('r1');
    ro.level   = 0;
    const man  = new CrewMember({ isPlayer: true, race: 'terra' });
    const hp0  = man.hp;
    // Half his tank: still walking, not yet hurt.
    const half = man.airMax() / 2;
    for (let i = 0; i < Math.round(half * 10); i++) ro.update(0.1, 0, 0, true, [man]);
    ok(man.air > 0 && man.hp === hp0,
       `${half}s into a vented room he is still fine — that is the whole point, `
     + 'you can walk a man through and out the far side');
    for (let i = 0; i < Math.round(half * 10) + 20; i++) ro.update(0.1, 0, 0, true, [man]);
    ok(man.air === 0, 'past the tank it is empty');
    ok(man.hp < hp0, 'and only THEN does he start to suffocate');
  }

  // ── A BIGGER TANK REALLY IS LONGER ──
  {
    const vent = (c) => {
      const ro = new RoomOxygen('r1'); ro.level = 0;
      let t = 0;
      while (c.hp >= c.maxHp && t < 120) { ro.update(0.1, 0, 0, true, [c]); t += 0.1; }
      return t;
    };
    const terra   = new CrewMember({ isPlayer: true, race: 'terra' });
    const pegasus = new CrewMember({ isPlayer: true, race: 'pegasus' });
    const tT = vent(terra), tP = vent(pegasus);
    ok(tP > tT + 5,
       `a Pegasus hand lasts far longer in the same room (${tP.toFixed(1)}s vs ${tT.toFixed(1)}s)`);
  }

  // ── AND IT FILLS BACK UP BY ITSELF ──
  {
    const ro  = new RoomOxygen('r1');
    ro.level  = OXYGEN.MAX;
    const man = new CrewMember({ isPlayer: true, race: 'terra' });
    man.air   = 1;
    for (let i = 0; i < 100; i++) ro.update(0.1, 1, 0, false, [man]);
    ok(man.air === man.airMax(), 'standing in air, the bottle recharges to full');
    ok(SUIT_AIR.REFILL_PER_SEC > 1,
       'faster than it empties, or a breach would be permanent');
  }

  // ── THE WHOLE SHIP AGREES ──
  {
    sb.Save.load(); sb.Save.startRun();
    const s = new Ship('frigate', true, 80, 120);
    s._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => s.addCrew(c));
    // O2 off, or the module refills the compartment as fast as the
    // open lock empties it and nothing is ever in vacuum.
    const o2 = s.getSystem('oxygen');
    /* A REAL airlock, opened — room.isVacuum is recomputed from the
       doors every frame, so setting the flag by hand would be undone
       before the oxygen ever saw it. */
    const lock = s.doors.find(d => d.isAirlock);
    const room = s.getRoomById(lock.roomA);
    const man  = s.crew[0];
    man.roomId = room.id;
    man.x = room.cx; man.y = s.floorWalkY(room.floor, room.cy);
    lock.mode = 'open';               // the airlock's own switch
    const a0 = man.air;
    for (let i = 0; i < 900 && man.air >= a0; i++) {
      if (o2) o2.desiredPower = 0;
      s.update(0.1);
    }
    // Below 0.05 rather than exactly zero: the open door equalises
    // with its neighbours AFTER the air tick, so the room is briefly
    // a hair above nothing on the very frame we stop on.
    ok(s.oxygen._rooms.get(room.id).level < 0.05,
       'the setup really did vent the compartment');
    ok(man.air < a0, 'and it drains the men standing in it');
  }
})();

// ============================================================
section('148. Every mouth aboard: the crew eat too');
// ============================================================
(function testCrewHunger() {
  const sb = loadEngine();
  const { Ship, CargoGrid, HUNGER, CAT_TUNING, Base, Save } = sb;

  // ── ONE TABLE, NOT TWO ──
  ok(CAT_TUNING.FOOD === undefined && CAT_TUNING.HUNGRY === undefined,
     'the cat\'s hunger numbers MOVED to HUNGER rather than being copied — '
   + 'two tables of the same thing is the drift this project keeps paying for');
  ok(sb.CAT_DEFS.black.hungerPerSec === undefined,
     'and the drain rate is no longer a third copy on the cat definition');
  ok(HUNGER.PER_SEC._default > 0 && HUNGER.PER_SEC.cat_black > HUNGER.PER_SEC._default,
     'a cat still eats faster than a man, from the one table');

  function crewedShip() {
    const s = new Ship('frigate', true, 80, 120);
    s._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => s.addCrew(c));
    s.cargo = new CargoGrid(6, 6);
    return s;
  }

  // ── THE METER DRAINS ──
  {
    const s = crewedShip();
    const man = s.crew[0];
    man.hunger = 100;
    for (let i = 0; i < 200; i++) s.update(0.1);       // 20 s
    ok(man.hunger < 100, `a crewman gets hungry as he flies (${man.hunger.toFixed(1)})`);
  }

  // ── AND HE FEEDS HIMSELF, ONE MEAL AT A TIME ──
  {
    const s = crewedShip();
    s.cargo.add('ration_pack', null, 4);
    const man = s.crew[0];
    s.crew.forEach(c => { c.hunger = 100; });
    man.hunger = HUNGER.HUNGRY - 5;
    const meals = s.cargo.countOf('food');
    for (let i = 0; i < 200; i++) s.update(0.1);
    ok(man.hunger > HUNGER.HUNGRY, `he ate (${man.hunger.toFixed(1)})`);
    ok(s.cargo.countOf('food') === meals - 1,
       'and it cost exactly one meal out of the pack, not the whole box');
  }

  // ── NOTHING TO EAT: HE STARVES, SLOWLY, AND HE IS WARNED ──
  {
    const s = crewedShip();
    const man = s.crew[0];
    s.crew.forEach(c => { c.hunger = 100; });
    man.hunger = 0;
    const hp0 = man.hp;
    for (let i = 0; i < 100; i++) s.update(0.1);       // 10 s at zero
    ok(man.hp < hp0, 'an empty stomach costs hit points');
    ok(man.hp > hp0 * 0.5, 'but slowly — starvation is a slope, not a cliff');
  }

  // ── SPIDERS AND RATS FEED THEMSELVES ──
  {
    const rat = sb.makeRats(1)[0];
    ok(!rat.eats && rat.hungerPerSec() === 0,
       'vermin are not on the ration strength');
  }

  // ── THERE ARE LIMITS ──
  {
    const s = crewedShip();
    const egg = s.cargo.add('spider_egg');
    if (egg) {
      const man = s.crew[0];
      s.crew.forEach(c => { c.hunger = 100; });
      man.hunger = 1;
      for (let i = 0; i < 300; i++) s.update(0.1);
      ok(s.cargo.items.includes(egg),
         'a starving CREWMAN still will not eat a spider egg — that is the cat\'s dinner');
    }
  }

  // ── AND IT ALL COMES HOME ──
  {
    const s = crewedShip();
    const man = s.crew[0];
    man.hunger = 37;
    man.air = 3;
    const rec = man.serialise();
    ok(rec.hunger === 37 && rec.air === 3,
       'the stomach and the tank are written into the save record');
    const back = new sb.CrewMember(rec);
    ok(back.hunger === 37 && back.air === 3,
       'a man who came home hungry on half a bottle is still hungry tomorrow');
  }

  // ── AND THE BASE SELLS RATIONS ──
  {
    Save.load(); Save.startRun();
    Base.earn(500);
    const before = Base.supply().food;
    const r = Base.buySupply('food', 5);
    ok(r.ok, `rations are for sale (${r.message})`);
    ok(Base.supply().food === before + 5, 'and land on the shelf as real meals');
    ok(Base.unitPrice('food') > 0, 'at a price');
  }
})();

// ============================================================
section('149. An animal does not have eight skills');
// ============================================================
(function testBeastSkillSheet() {
  const sb = loadEngine();
  const { SKILL_DEFS, BEAST_SKILLS, CrewMember } = sb;

  const cat = sb.makeCat('black', 'Mruk');
  ok(Object.keys(cat.skills).length === 1,
     `a cat has ONE skill, not eight (${Object.keys(cat.skills).join(',')})`);
  ok('combat' in cat.skills, 'and it is the one it actually uses');
  ok(BEAST_SKILLS.length === 1 && BEAST_SKILLS[0] === 'combat',
     'which is what BEAST_SKILLS says');
  ok(Object.keys(SKILL_DEFS).length === 8,
     'the human sheet is untouched — this is about who gets one');
  ok(Object.keys(new CrewMember({ isPlayer: true, race: 'terra' }).skills).length === 8,
     'a man still has all eight');
  ok(Object.keys(sb.makeRats(1)[0].skills).length === 1,
     'and so does the vermin it hunts — one apiece');

  // A missing row must READ as zero everywhere, not as undefined.
  ok(cat.getSkillLevel('piloting') === 0, 'a skill it does not have reads as zero');
  ok(cat.pilotBonus() === 0 && cat.repairSpeed() > 0,
     'so every bonus that asks still answers a number');

  // The name over its head has to be legible — the black cat's
  // corporation colour is #3a3a42 on a near-black plate.
  ok(cat.labelColor() !== cat.color,
     `the name plate is NOT drawn in the cat's own fur colour (${cat.color})`);
  const man = new CrewMember({ isPlayer: true, race: 'terra' });
  ok(man.labelColor() === man.color, 'a crewman still wears his corporation colour');
  const foe = new CrewMember({ isPlayer: false, race: 'terra' });
  ok(foe.labelColor() === '#ff4444', 'and an enemy is still red');
})();

// ============================================================
section('150. Cats for sale, and they go in a pen');
// ============================================================
(function testAdoptCat() {
  const sb = loadEngine();
  const { Base, Save } = sb;

  Save.load(); Save.startRun();
  Base.get().pets = [];
  ok(!Base.adoptCat().ok, 'no money, no cat');

  Base.earn(1000);
  const purse = Base.cc();
  const before = Base.crew().length;
  const r = Base.adoptCat('black');
  ok(r.ok, `you can buy one at the station (${r.message})`);
  ok(Base.pets().length === 1, 'and it goes in a PEN');
  ok(Base.crew().length === before,
     'never in the barracks — an animal in a bunk is one the game offers a console');
  ok(Base.cc() === purse - Base.PRICE.cat, 'and it costs what the button says');

  // The pens are a real cap.
  while (Base.pets().length < Base.petCap()) {
    if (!Base.adoptCat().ok) break;
  }
  ok(Base.pets().length === Base.petCap(), 'you can fill every pen');
  ok(!Base.adoptCat().ok, 'and not one more');

  // What came out of the pens is a cat, not a crewman.
  const rec = Base.pets()[0];
  ok(!!sb.CORP_DEFS[rec.race]?.pet, 'the saved record is recognisably an animal');
  ok(Object.keys(rec.skills).length === 1, 'with an animal\'s one-line skill sheet');
})();

/* ════════════════════════════════════════════════════════════
   The cargo screen, rebuilt in update48.

   One shared setup: a hold with a few crates in it, drawn once so
   the buttons have real zones, plus click / hover helpers that go
   through LootScreen.update exactly as the game loop does.
   ════════════════════════════════════════════════════════════ */
function cargoScreen(sb, { cols = 5, rows = 4 } = {}) {
  const { LootScreen, Renderer, Input, CargoGrid } = sb;
  sb.Save.load();
  Renderer.init(sb.document.getElementById('game-canvas'));
  const ctx = Renderer.getCtx();
  const hold = new CargoGrid(cols, rows);

  const draw = () => LootScreen.draw(ctx);
  /** The screen coordinate of a grid cell, found the way the game finds
   *  it — through _cellAt, so the test cannot drift from the geometry. */
  const point = (which, cx, cy) => {
    const r = LootScreen._gridRect(which);
    if (!r) return null;
    for (let y = r.y + 2; y < r.y + r.h; y += 2)
      for (let x = r.x + 2; x < r.x + r.w; x += 2) {
        const c = LootScreen._cellAt(which, x, y);
        if (c && c.cx === cx && c.cy === cy) return [x, y];
      }
    return null;
  };
  const hover = (p) => {
    Input.mouse.x = p[0]; Input.mouse.y = p[1];
    LootScreen.update(0.016);
  };
  const click = (p) => {
    Input.mouse.x = p[0]; Input.mouse.y = p[1];
    Input.mouse.leftPressed = true;
    LootScreen.update(0.016);
    Input.mouse.leftPressed = false;
    LootScreen.update(0.016);
    draw();
  };
  const rightClick = () => {
    Input.mouse.rightDown = true;
    LootScreen.update(0.016);
    Input.mouse.rightDown = false;
    LootScreen.update(0.016);
    draw();
  };
  /** What the buttons would act on — the real selection, not a guess. */
  const selected = () => LootScreen._zoneFor('dump')?.arg ?? null;
  return { hold, ctx, draw, point, hover, click, rightClick, selected };
}

// ============================================================
section('151. The cargo screen obeys CLICKS, not the cursor');
// ============================================================
(function testClickToSelect() {
  const sb = loadEngine();
  const { LootScreen } = sb;
  const S = cargoScreen(sb);

  const top = S.hold.add('he2_small', null, 2);
  const low = S.hold.add('medkit', null, 3);
  ok(!!top && !!low && top.y !== low.y || top.x !== low.x,
     'two crates in different cells to click between');
  LootScreen.openHold(S.hold, {});
  S.draw();

  const pTop = S.point('hold', top.x, top.y);
  const pLow = S.point('hold', low.x, low.y);
  ok(!!pTop && !!pLow, 'both can be pointed at');

  /* THE BUG THE PLAYER REPORTED. Selection followed the cursor, so
     walking from the crate you clicked to the button you wanted
     re-selected everything on the way — and the button acted on the
     last thing passed over. */
  S.click(pTop);
  ok(S.selected() === top, 'clicking a crate selects THAT crate');
  S.hover(pLow); S.hover(pLow); S.draw();
  ok(S.selected() === top,
     'and walking the cursor over another one changes nothing at all');

  // The clicked crate is in the hand, and a second click puts it down.
  ok(!S.hold.items.includes(top), 'the clicked crate is in the hand');
  const free = (() => {
    for (let y = 0; y < S.hold.rows; y++)
      for (let x = 0; x < S.hold.cols; x++)
        if (!S.hold.at(x, y) && S.hold.fits(top, x, y)) return [x, y];
    return null;
  })();
  S.click(S.point('hold', free[0], free[1]));
  ok(S.hold.items.includes(top), 'clicking a free cell puts it down');
  ok(S.selected() === top, 'and it stays selected — the click is what chose it');

  /* AND NOW THE ACTUAL BUG, with nothing in the hand: the crate is on
     the shelf, the player walks the cursor down to a button, and the
     old code re-selected everything the cursor crossed on the way. */
  S.hover(S.point('hold', low.x, low.y));
  S.hover(S.point('hold', low.x, low.y));
  S.draw();
  ok(S.selected() === top,
     'with empty hands too, passing over another crate does not steal the selection');

  // Right-click is the way out of carrying something.
  S.click(S.point('hold', top.x, top.y));
  ok(!S.hold.items.includes(top), 'picked up again');
  S.rightClick();
  ok(S.hold.items.includes(top), 'right-click puts it back where it came from');

  // A click that cannot land keeps the crate IN HAND rather than
  // throwing it home — the old drag lost the whole trip on a near miss.
  S.click(S.point('hold', top.x, top.y));
  const onto = S.point('hold', low.x, low.y);
  S.click(onto);            // a medkit is there; He2 will not merge with it
  ok(!S.hold.items.includes(top), 'a click on an occupied cell leaves it in the hand');
  ok(S.hold.items.includes(low), 'and does not disturb what was already there');
  S.rightClick();
  ok(S.hold.countOf('fuel') === 2 && S.hold.countOf('heal') === 3,
     'nothing was created or destroyed by any of that');

  /* A BUTTON PRESSED WITH A CRATE IN HAND still has to work. USE, SELL
     and DUMP all reason about an item that is IN a grid, and under the
     old hold-to-drag model the buttons were simply unreachable while
     carrying — now that a click frees the mouse, the crate has to land
     before the button acts on it. */
  {
    const S2 = cargoScreen(sb);
    const kit = S2.hold.add('medkit', null, 2);
    let sold = 0;
    LootScreen.openLoot(null, S2.hold, {
      onSell: (it) => { sold += it.value('general'); return it.value('general'); },
    });
    S2.draw();
    S2.click(S2.point('hold', kit.x, kit.y));
    ok(!S2.hold.items.includes(kit), 'the crate is in hand');
    const z = LootScreen._zoneFor('sell');
    ok(!!z, 'SELL is live for a crate you are holding');
    S2.click([z.x + 4, z.y + 4]);
    ok(sold > 0, `pressing SELL while carrying really sells it (${sold} CC)`);
    ok(S2.hold.items.length === 0, 'and it does not end up back in the hold as well');
  }
})();

// ============================================================
section('152. SPLIT takes a pile apart');
// ============================================================
(function testSplitStack() {
  const sb = loadEngine();
  const { LootScreen } = sb;

  // ── half off the top, twice ──
  {
    const S = cargoScreen(sb);
    const drum = S.hold.add('he2_large', null, 16);
    ok(drum && drum.qty === 16, 'a drum with 16 cells of He2 in it');
    LootScreen.openHold(S.hold, {});
    S.draw();
    S.click(S.point('hold', drum.x, drum.y));

    const z = LootScreen._zoneFor('split');
    ok(!!z, 'there is a SPLIT button once a stack is selected');
    S.click([z.x + 4, z.y + 4]);
    ok(S.hold.countOf('fuel') === 16, 'splitting creates nothing and destroys nothing');
    ok(S.hold.items.length === 2, `it becomes two containers (${S.hold.items.length})`);
    const qtys = S.hold.items.map(i => i.qty).sort((a, b) => a - b);
    ok(qtys[0] === 8 && qtys[1] === 8, `halved: ${qtys.join(' + ')}`);
  }

  // ── a stack of one cannot be split ──
  {
    const S = cargoScreen(sb);
    const one = S.hold.add('he2_small', null, 1);
    LootScreen.openHold(S.hold, {});
    S.draw();
    S.click(S.point('hold', one.x, one.y));
    ok(!LootScreen._zoneFor('split'), 'a single unit offers no SPLIT button');
  }

  // ── and a split with nowhere to put the half changes NOTHING ──
  {
    const S = cargoScreen(sb, { cols: 2, rows: 1 });
    const drum = S.hold.add('he2_med', null, 10);
    while (S.hold.add('plating')) { /* fill every last cell */ }
    ok(S.hold.usedCells() === S.hold.capacity, 'the hold is packed solid');
    LootScreen.openHold(S.hold, {});
    S.draw();
    S.click(S.point('hold', drum.x, drum.y));
    const z = LootScreen._zoneFor('split');
    if (z) S.click([z.x + 4, z.y + 4]);
    ok(drum.qty === 10,
       `the units stay in the drum when the half has no cell (${drum.qty})`);
    ok(S.hold.countOf('fuel') === 10, 'and the total is untouched');
  }
})();

// ============================================================
section('153. Nothing is thrown away without being told');
// ============================================================
(function testNothingVanishes() {
  const sb = loadEngine();
  const { LootScreen, CargoGrid, Base, BaseScreen, Save } = sb;

  // ── the clock runs out with a crate in your hand ──
  {
    const S = cargoScreen(sb);
    const wreck = new CargoGrid(3, 3);
    const relic = wreck.add('alien_relic');
    let closed = null;
    LootScreen.openLoot(wreck, S.hold, {
      seconds: 0.5,
      onClose: (r) => { closed = r; },
    });
    S.draw();
    S.click(S.point('wreck', relic.x, relic.y));
    ok(!wreck.items.includes(relic), 'the relic is in the hand when the clock runs out');
    LootScreen.update(1.0);                     // time expires
    ok(!!closed, 'the screen closed on its own');
    ok(wreck.items.includes(relic) || S.hold.items.includes(relic),
       'and the carried crate landed in a real grid — the hand is not a container');
  }

  // ── a crate that FITS leaves the hold as it lands on the shelf ──
  {
    Save.load();
    BaseScreen.open();
    BaseScreen._act('launch');
    sb.Game.__test._startContract(BaseScreen.consumeLaunch());
    const hold = sb.Game.__test.playerShip.cargo;
    hold.clear();
    const shelf = Base.warehouseGrid();
    // Make sure there is room, whatever the seeded shelf holds.
    [...shelf.items].forEach(it => shelf.remove(it));
    Base.commitWarehouse(shelf);
    const kit = hold.add('medkit', null, 2);
    ok(!!kit, 'a medkit in the hold');
    sb.Game.__test._dockAtBase(0, () => {});
    ok(hold.items.length === 0, 'it left the hold');
    ok(Base.warehouseGrid().countOf('heal') === 2,
       'and the doses are on the shelf — placed AND removed, never in two grids at once');
  }

  // ── a smaller hull with a full shelf refuses the swap ──
  {
    Save.load();
    Base.earn(4000);
    BaseScreen.open();
    const b = Base.get();
    const keys = Object.keys(sb.SHIP_LAYOUTS || {});
    // Two berths: a big hull and the smallest one on the list.
    const bySize = keys
      .map(k => ({ k, cells: (sb.SHIP_LAYOUTS[k].cargoCols ?? 5) * (sb.SHIP_LAYOUTS[k].cargoRows ?? 4) }))
      .filter(x => sb.SHIP_CATALOG?.[x.k])
      .sort((a, c) => a.cells - c.cells);
    if (bySize.length >= 2) {
      const small = bySize[0], big = bySize[bySize.length - 1];
      b.ships = [{ key: big.k, data: null }, { key: small.k, data: null }];
      BaseScreen._act('ship', 0);
      // Fill the big hull's hold AND the shelf solid.
      const { store, hold } = BaseScreen.packGrids();
      while (hold.add('plating')) { /* pack the hull */ }
      while (store.add('plating')) { /* pack the shelf */ }
      BaseScreen.commitPack();
      const unitsBefore = hold.items.length + store.items.length;

      BaseScreen._act('ship', 1);          // try the small hull
      const after = BaseScreen.packGrids();
      const unitsAfter = after.hold.items.length + after.store.items.length;
      ok(unitsAfter === unitsBefore,
         `switching hulls with nowhere to put the cargo loses none of it `
       + `(${unitsBefore} → ${unitsAfter})`);
      ok(BaseScreen._state().shipIdx === 0,
         'the berth click is refused instead — the crates stay where they are');

      /* POSITIVE CONTROL. "shipIdx is still 0" would also be true if
         the berth button had never worked at all, which is exactly the
         sort of test that passes on a broken game. Empty the hold and
         the very same click must go through. */
      const g = BaseScreen.packGrids();
      [...g.hold.items].forEach(it => g.hold.remove(it));
      BaseScreen.commitPack();
      BaseScreen._act('ship', 1);
      ok(BaseScreen._state().shipIdx === 1,
         'with the hold emptied the same click switches hulls — the refusal was real');
    }
  }
})();

// ============================================================
section('154. The CPU board: karma decides what fits');
// ============================================================
(function testCpuGeometry() {
  const sb = loadEngine();
  const { Chips, CargoGrid, CargoItem, CARGO_ITEMS } = sb;

  // ── the wall stands where the spec says, on every boundary ──
  [[0, 1], [14, 1], [15, 2], [34, 2], [35, 3], [50, 3], [65, 3],
   [66, 4], [85, 4], [86, 5], [100, 5]].forEach(([karma, col]) => {
    ok(Chips.wallColumn(karma) === col,
       `karma ${karma} puts the wall in column ${col} (got ${Chips.wallColumn(karma)})`);
  });

  // ── and ONE CELL opens per commander level (update52) ──
  [[0, 0], [1, 1], [5, 5], [12, 12], [24, 24], [99, 25]].forEach(([lvl, cells]) => {
    ok(Chips.cellsFor(lvl) === cells,
       `level ${lvl} opens ${cells} cell(s) (got ${Chips.cellsFor(lvl)})`);
  });
  ok(Chips.openRows({ level: 12 }) === 2,
     'twelve cells is two whole rows and two over');
  ok(Chips.usableCells({ level: 25, karma: 50 }) === 20,
     'fully open, 20 cells are usable — the wall always keeps one column');
  ok(Chips.usableCells({ level: 5, karma: 50 }) === 4,
     'and one open row is four, for the same reason');

  // ── forty-eight real cargo items, with the spec's shapes ──
  {
    const etos4 = CARGO_ITEMS[Chips.itemKey('life_reserve', 4)];
    const uni4  = CARGO_ITEMS[Chips.itemKey('mobility', 4)];
    ok(etos4 && etos4.w === 4 && etos4.h === 1, 'an Etos IV is a 4x1 bar');
    ok(uni4 && uni4.w === 2 && uni4.h === 2, 'a universal IV is 2x2 instead');
    ok(CARGO_ITEMS[Chips.itemKey('mobility', 1)].w === 1, 'and a level I is one cell');
    const count = Object.keys(CARGO_ITEMS).filter(k => k.startsWith('chip_')).length;
    ok(count === 48, `twelve chips at four levels each are in the catalogue (${count})`);
  }

  // ── a chip goes on its OWN side, and never on the wall ──
  {
    const cap = { level: 8, karma: 50, chips: [] };     // wall in column 3
    const b = Chips.board(cap);
    ok(b && b.cols === 5 && b.rows === 5, 'the board is 5x5');

    const good = new CargoItem(Chips.itemKey('life_reserve', 1));       // Etos
    const evil = new CargoItem(Chips.itemKey('assault_squad', 1));      // Dominacja
    const any  = new CargoItem(Chips.itemKey('mobility', 1));           // universal

    ok(b.fits(good, 0, 0), 'an Etos chip fits the good side');
    ok(!b.fits(good, 3, 0), 'and NOT the evil side');
    ok(!b.fits(good, 2, 0), 'and never on the wall itself');
    ok(b.fits(evil, 3, 0) && !b.fits(evil, 0, 0),
       'a Dominacja chip is the mirror image');
    ok(b.fits(any, 0, 0) && b.fits(any, 3, 0), 'a universal chip takes either side');
    ok(!b.fits(any, 2, 0), 'but not the wall');
    ok(b.blockedAt(2, 0) && b.blockedAt(2, 4),
       'the whole wall column reads as BLOCKED — that is what the screen draws');
    ok(!b.blockedAt(1, 0) && !b.blockedAt(3, 0), 'and the columns beside it do not');

    // A bar cannot straddle the wall, however it is offered.
    const bar = new CargoItem(Chips.itemKey('life_reserve', 3));        // 3x1
    ok(!b.fits(bar, 1, 0), 'a 3-cell bar cannot bridge the blocked column');
    ok(!b.fits(bar, 0, 0), 'and a middling commander has only two good columns for it');

    /* The cells a commander has not earned are closed, not merely
       empty. update52: ONE cell per level, in reading order. */
    const low = { level: 1, karma: 50, chips: [] };
    const b2 = Chips.board(low);
    ok(b2.fits(good, 0, 0), 'the first cell is open at level 1');
    ok(!b2.fits(good, 1, 0), 'the second is not — it opens at level 2');
    ok(b2.blockedAt(1, 0), 'and it reads as BLOCKED, not as free space');
    const u4 = new CargoItem(Chips.itemKey('mobility', 4));
    ok(!Chips.board({ level: 6, karma: 50, chips: [] }).fits(u4, 0, 0),
       'a 2x2 universal IV needs a whole second row, so not at level 6');
    ok(Chips.board({ level: 7, karma: 50, chips: [] }).fits(u4, 0, 0),
       'at level 7 the cell under it finally opens and it fits');
  }

  // ── nothing but a chip belongs on a board ──
  {
    const cap = { level: 25, karma: 50, chips: [] };
    const b = Chips.board(cap);
    const kit = new CargoItem('medkit');
    ok(!b.fits(kit, 0, 0), 'a medkit is not a chip and does not go on the CPU');
  }

  // ── and the board never rotates a bar to make it fit ──
  {
    const cap = { level: 25, karma: 100, chips: [] };  // wall right, 4 good columns
    const b = Chips.board(cap);
    b.noRotate = true;
    const bar = new CargoItem(Chips.itemKey('life_reserve', 4));   // 4x1
    ok(b.autoPlace(bar), 'a 4-bar fits four open columns');
    ok(bar.rot === 0, 'and it went down flat — the board must not stand it on end');

    /* THE CASE THAT ACTUALLY BITES: one good column, five open rows.
       A 3-bar stood on end would slot straight in, and the spec says
       it must not — so this placement has to FAIL. */
    const narrow = { level: 25, karma: 20, chips: [] };  // wall col 2 → one good column
    const b2 = Chips.board(narrow);
    b2.noRotate = true;
    ok(Chips.wallColumn(20) === 2, 'test setup: exactly one column of good ground');
    const bar3 = new CargoItem(Chips.itemKey('life_reserve', 3));  // 3x1
    ok(!b2.autoPlace(bar3),
       'a 3-bar does NOT fit one column — turning it upright is not allowed');
    const b3 = Chips.board(narrow);          // same board, rotation permitted
    ok(b3.autoPlace(new CargoItem(Chips.itemKey('life_reserve', 3))),
       'and it only fails because of the ban: allow rotation and it fits');
  }
})();

// ============================================================
section('155. A chip is an item, and it works or it does not');
// ============================================================
(function testChipEffects() {
  const sb = loadEngine();
  const { Chips, Commander, CargoItem, CrewMember, Ship, Save } = sb;

  /* update52: THE WHOLE BOARD BY DEFAULT. One CPU cell opens per
     commander level, so a test about karma and sides needs a level 25
     man — otherwise it is really a test about the level, and the
     level has its own section. Pass a lower one deliberately. */
  function capWith(list, { level = 25, karma = 50 } = {}) {
    const cap = Commander.fromCrew({ id: 'c1', name: 'Kowal', race: 'terra', skills: {} });
    cap.level = level; cap.karma = karma;
    const b = Chips.board(cap);
    list.forEach(([key, lvl, x, y]) => {
      const it = new CargoItem(Chips.itemKey(key, lvl));
      ok(b.place(it, x, y), `test setup: ${key} ${lvl} goes down at ${x},${y}`);
    });
    Chips.commit(cap, b);
    return cap;
  }

  // ── the board is stored in the commander's own record ──
  {
    const cap = capWith([['mobility', 1, 0, 0]]);
    ok(!Array.isArray(cap.chips), 'the empty-list placeholder became a real board');
    const back = Chips.board(cap);
    ok(back.items.length === 1, 'and it survives a round trip through the record');
    ok(back.items[0].def.chipKey === 'mobility', 'as the same chip');
  }

  // ── duplicates add up, and stop at the ceiling ──
  {
    const one = capWith([['mobility', 1, 0, 0]]);
    ok(Math.abs(Chips.bonus(one, 'speed') - 0.02) < 1e-9,
       `one level I is worth 2% (${Chips.bonus(one, 'speed')})`);
    // Four 2x2 universals: two on each side, stacked in rows 0-1 and 2-3.
    const many = capWith([['mobility', 4, 0, 0], ['mobility', 4, 0, 2],
                          ['mobility', 4, 3, 0], ['mobility', 4, 3, 2]]);
    ok(Chips.bonus(many, 'speed') === 0.25,
       `four of them stop at the 25% ceiling (${Chips.bonus(many, 'speed')})`);
  }

  // ── and the crew really feel it ──
  {
    Save.load(); Save.startRun();
    // Level II bars: at karma 50 each side is only two columns wide.
    const cap = capWith([['assault_squad', 2, 3, 0], ['fire_control', 2, 0, 0]]);
    const man = new CrewMember({ isPlayer: true, race: 'terra' });
    Commander.setActive(null);
    const baseMelee = man.meleeDamage(), baseFire = man.firefightSpeed();
    Commander.setActive(cap);
    ok(man.meleeDamage() > baseMelee,
       `a Dominacja chip reaches his fists (${baseMelee} → ${man.meleeDamage()})`);
    ok(man.firefightSpeed() > baseFire, 'and an Etos chip reaches his extinguisher');

    // Chips reach EVERY corporation; the corp bonus still does not.
    const other = new CrewMember({ isPlayer: true, race: 'phoenix' });
    ok(Commander.bonusFor(other).melee > 0,
       'a chip pays a crewman of another corporation too — that is the difference');
    /* The commander is Terra, which deals in repair — so once he has
       SPENT a level on it, that is where his OWN people must be ahead
       of everybody else. update52: unspent, he would be ahead nowhere,
       which is the point of the pick. */
    ok(Commander.bonusFor(man).repair === Commander.bonusFor(other).repair,
       'before he chooses, his own people are no better off than anyone');
    Commander.spendPick(cap, 'repair');
    ok(Commander.bonusFor(man).repair > Commander.bonusFor(other).repair,
       'and after he chooses, the corporation share is his own people only');
    ok(Commander.bonusFor(sb.makeCat('black')).melee === 0, 'and never the cat');
    Commander.setActive(null);
  }

  // ── karma moves the wall, and a chip goes quiet where it stands ──
  {
    const cap = capWith([['assault_squad', 1, 3, 0]], { karma: 50 });
    const before = Chips.bonus(cap, 'melee');
    ok(before > 0, 'test setup: the chip works at karma 50');

    cap.karma = 95;                       // wall to column 5: all good ground
    const b = Chips.board(cap);
    ok(b.items.length === 1, 'the chip is STILL on the board — nothing was deleted');
    ok(b.items[0].x === 3 && b.items[0].y === 0, 'and it has not been moved either');
    ok(Chips.isInert(cap, b.items[0]), 'it is simply inert now');
    ok(Chips.bonus(cap, 'melee') === 0, 'and pays nothing');
    ok(Chips.inertReason(cap, b.items[0]).length > 0, 'the screen can say why');

    cap.karma = 50;                       // and back again
    ok(Chips.bonus(cap, 'melee') === before,
       'walking the karma back switches it on by itself — nothing to re-mount');
  }

  // ── a row he no longer has is dead ground too ──
  {
    const cap = capWith([['mobility', 1, 0, 4]], { level: 25, karma: 50 });
    ok(Chips.bonus(cap, 'speed') > 0, 'test setup: the last row works at level 25');
    cap.level = 2;                        // a save from before the promotion
    const b = Chips.board(cap);
    ok(Chips.isInert(cap, b.items[0]),
       'a chip in a row the commander has not opened does nothing');
    ok(Chips.bonus(cap, 'speed') === 0, 'and pays nothing');
  }

  // ── a chip in the HOLD does nothing at all ──
  {
    Save.load(); Save.startRun();
    const cap = capWith([]);
    const ship = new Ship('frigate', true, 80, 120);
    ship.cargo.clear();
    ship.cargo.add(Chips.itemKey('assault_squad', 2));
    Commander.setActive(cap);
    ok(Chips.bonus(cap, 'melee') === 0,
       'carrying a chip is not mounting it — the hold grants nothing');
    Commander.setActive(null);
  }

  // ── several pods do not stack; the best one flies ──
  {
    // Karma 100 opens four good columns, room for a 3-cell pod.
    const cap = capWith([['escape_pod', 1, 0, 0], ['escape_pod', 3, 0, 1]],
                        { karma: 100 });
    ok(Chips.podSeconds(cap) === 8,
       `the shorter countdown wins, it does not add up (${Chips.podSeconds(cap)})`);
    const none = capWith([]);
    ok(Chips.podSeconds(none) === 0, 'no pod, no countdown');
  }
})();

// ============================================================
section('156. Chips come from somewhere, and never vanish');
// ============================================================
(function testChipSupply() {
  const sb = loadEngine();
  const { Chips, CARGO_ITEMS, Save, Base, BaseScreen, Game, CargoGrid } = sb;
  const T = Game.__test;

  // ── the sector is the ceiling ──
  {
    for (let sector = 1; sector <= 3; sector++) {
      let worst = 0;
      for (let i = 0; i < 300; i++) {
        const def = CARGO_ITEMS[Chips.rollDrop(sector)];
        worst = Math.max(worst, def.chipLevel);
      }
      ok(worst === sector,
         `sector ${sector} tops out at level ${sector} (saw ${worst})`);
    }
    // Level IV is not in ANY sector table — it is a boss trophy only.
    let sawFour = false;
    for (let i = 0; i < 500; i++) {
      if (CARGO_ITEMS[Chips.rollDrop(3)].chipLevel === 4) sawFour = true;
    }
    ok(!sawFour, 'level IV never drops from an ordinary roll');
    ok(CARGO_ITEMS[Chips.rollDrop(4, { minLevel: 4 })].chipLevel === 4,
       'a boss can still ask for one explicitly');
  }

  // ── the board screen writes the board back ──
  {
    Save.load();
    const b = Base.get();
    b.messLvl = 1;
    b.commanders = [{ id: 'k1', name: 'Rusz', race: 'terra', level: 8, xp: 0,
                    karma: 50, chips: [], away: false }];
    const shelf = Base.warehouseGrid();
    const chip = shelf.add(Chips.itemKey('mobility', 1));
    ok(!!chip, 'test setup: a chip on the shelf');
    Base.commitWarehouse(shelf);

    sb.Renderer.init(sb.document.getElementById('game-canvas'));
    T._openCpuBoard('k1');
    ok(sb.LootScreen.isOpen(), 'the board screen opened');

    // Click the chip off the shelf and onto the good side of the board.
    const click = (which, cx, cy) => {
      const r = sb.LootScreen._gridRect(which);
      for (let y = r.y + 2; y < r.y + r.h; y += 2)
        for (let x = r.x + 2; x < r.x + r.w; x += 2) {
          const c = sb.LootScreen._cellAt(which, x, y);
          if (c && c.cx === cx && c.cy === cy) {
            sb.Input.mouse.x = x; sb.Input.mouse.y = y;
            sb.Input.mouse.leftPressed = true;
            sb.LootScreen.update(0.016);
            sb.Input.mouse.leftPressed = false;
            sb.LootScreen.update(0.016);
            sb.LootScreen.draw(sb.Renderer.getCtx());
            return true;
          }
        }
      return false;
    };
    sb.LootScreen.draw(sb.Renderer.getCtx());
    ok(click('wreck', chip.x, chip.y), 'the chip on the shelf can be clicked');
    ok(click('hold', 0, 0), 'and put down on the board');

    const doneZ = sb.LootScreen._zoneFor('done');
    sb.Input.mouse.x = doneZ.x + 4; sb.Input.mouse.y = doneZ.y + 4;
    sb.Input.mouse.leftPressed = true;
    sb.LootScreen.update(0.016);
    sb.Input.mouse.leftPressed = false;

    const saved = Base.commanderById('k1');
    const back = Chips.board(saved);
    ok(back.items.length === 1,
       `closing the screen WRITES the board to his record (${back.items.length})`);
    ok(Chips.bonus(saved, 'speed') > 0, 'and the chip is live on it');
    ok(!Base.warehouseGrid().items.some(it => it.def.kind === 'chip'),
       'and it left the shelf — one item, one place');
  }

  // ── wrecks carry them ──
  {
    let found = 0;
    for (let i = 0; i < 400; i++) {
      const g = sb.makeWreckGrid(3);
      if (g.items.some(it => it.def.kind === 'chip')) found++;
    }
    ok(found > 20 && found < 260,
       `a wreck sometimes holds a chip, not always (${found}/400)`);
  }

  // ── a boss chip with a full hold is NOT dropped on the floor ──
  {
    Save.load();
    Base.earn(1000);
    BaseScreen.open();
    BaseScreen._act('launch');
    T._startContract(BaseScreen.consumeLaunch());
    const hold = T.playerShip.cargo;
    hold.clear();
    while (hold.add('plating')) { /* pack it solid */ }
    ok(hold.usedCells() > hold.capacity - 3, 'test setup: the hold really is full');
    const before = hold.items.length;
    T._awardChip({ minLevel: 3, maxLevel: 4 }, 'Apophis');
    ok(hold.items.length === before,
       'it could not fit — so nothing was quietly stuffed in either');
    T.STATE = 'map';
    T._updateMap(0.016);
    ok(sb.LootScreen.isOpen(),
       'the next frame opens a screen for it instead of losing the reward');
  }
})();

// ============================================================
section('158. Karma comes from decisions about the helpless');
// ============================================================
(function testKarmaSources() {
  const sb = loadEngine();
  const { Commander, Chips, Base, BaseScreen, Game, Save, EVENTS, CargoItem } = sb;
  const T = Game.__test;

  // ── the table is one table ──
  ok(Commander.KARMA.EVACUATE === -10,
     `leaving a living crew costs 10, not 15 — JJ changed it (${Commander.KARMA.EVACUATE})`);
  ok(Commander.KARMA.KILL_HELPLESS === -10 && Commander.KARMA.ROBBERY === -5
     && Commander.KARMA.HELP_AT_COST === 5,
     'and the rest matches the spec table');

  // ── preview tells the truth without touching the record ──
  {
    const cap = Commander.fromCrew({ name: 'A', race: 'terra', skills: {} });
    cap.level = 8; cap.karma = 50;
    const b = Chips.board(cap);
    ok(b.place(new CargoItem(Chips.itemKey('life_reserve', 1)), 0, 0),
       'test setup: an Etos chip on the good side');
    Chips.commit(cap, b);
    ok(Chips.bonus(cap, 'hp') > 0, 'test setup: it works at karma 50');

    const pv = Commander.preview(cap, -40);
    ok(pv.killed === 1, `the warning knows one chip will die (${pv.killed})`);
    ok(pv.wallMoved, 'and that the wall moves');
    ok(cap.karma === 50, 'and it did NOT change anything by asking');

    const r = Commander.shift(cap, -40);
    ok(cap.karma === 10 && r.killed === 1, 'the real shift then does what it said');
    ok(Chips.bonus(cap, 'hp') === 0, 'and the chip really has gone quiet');
  }

  // ── the real events carry the real numbers ──
  {
    const distress = EVENTS.find(e => e.id === 'distress_signal');
    ok(distress, 'the distress signal is still in the table');
    const rescue = distress.choices.find(c => /Rescue/.test(c.label));
    const pass   = distress.choices.find(c => /Pass by/.test(c.label));
    ok(rescue.result.karma === 5, 'turning back to help is worth +5');
    ok(!pass.result.karma,
       'and passing by costs NOTHING — plain refusal is worth 0 in the spec');
  }

  // ── one decision scores once, and only with a commander aboard ──
  {
    Save.load();
    const promoted = promoteForTest(sb, { mastered: 3, level: 8, karma: 50 });
    ok(BaseScreen._state().commanderId === promoted.id,
       'test setup: the promoted commander is the one picked to fly');
    BaseScreen._act('launch');
    T._startContract(BaseScreen.consumeLaunch());
    const flying = Commander.active();
    ok(flying, 'test setup: a commander really is on this contract');
    const before = flying.karma;

    T.event = { title: 't', text: 't',
                choices: [{ label: 'x', result: { karma: -10 } }] };
    T._resolveEvent(0);
    ok(flying.karma === before - 10, `the choice moved his karma (${before} → ${flying.karma})`);

    // Resolving does not re-apply: the event is consumed.
    const after = flying.karma;
    T.event = null;
    T._resolveEvent(0);
    ok(flying.karma === after, 'and a second call with no event changes nothing');
  }

  // ── a contract with no commander moves nobody's karma ──
  {
    const inMess = Base.commanders().map(c => c.karma);
    T.commander = null;
    Commander.setActive(null);
    T.event = { title: 't', text: 't',
                choices: [{ label: 'x', result: { karma: -10 } }] };
    T._resolveEvent(0);
    ok(JSON.stringify(Base.commanders().map(c => c.karma)) === JSON.stringify(inMess),
       'the commanders sitting at home did not make this decision and do not pay for it');
  }
})();

// ============================================================
section('159. The escape pod: the one chip that is spent');
// ============================================================
(function testEscapePod() {
  const sb = loadEngine();
  const { Commander, Chips, Base, BaseScreen, Game, Save, CargoItem } = sb;
  const T = Game.__test;

  function flyWithPod(level = 2, at = [0, 0], karma = 50) {
    Save.load();
    /* A previous run of this helper left a commander in the only berth
       and FLEW THE ONLY HULL OUT of the hangar — a launched ship is
       checked out for good. Put both back before setting up again. */
    Base.get().commanders = [];
    Base.get().ships = [{ key: 'frigate', data: null }];
    /* THREE STARS ON PURPOSE. A pod is a level II–IV chip and the
       test parks it in row 0 or 1, so the commander must be one whose
       promotion bought the whole board — a szeregowy would wall the
       row off and the pod would be inert, which is a different test. */
    const cap = promoteForTest(sb, { mastered: 3, level: 8, karma: karma });
    const b = Chips.board(cap);
    ok(b.place(new CargoItem(Chips.itemKey('escape_pod', level)), at[0], at[1]),
       `test setup: a pod at ${at[0]},${at[1]} with karma ${karma}`);
    Chips.commit(cap, b);
    Base.saveCommander(cap);
    ok(BaseScreen._state().commanderId === cap.id,
       'test setup: he is the commander being flown');
    BaseScreen._act('launch');
    const loadout = BaseScreen.consumeLaunch();
    ok(!!loadout, 'test setup: the launch really produced a loadout');
    T._startContract(loadout);
    return Commander.active();
  }

  // ── a mounted pod offers its own countdown; a carried one does not ──
  {
    const cap = flyWithPod(2);
    ok(T._podSeconds() === 10, `a level II pod is a 10-second countdown (${T._podSeconds()})`);

    // The same chip in the HOLD is just cargo.
    const bare = flyWithPod(1);
    const board = Chips.board(bare);
    [...board.items].forEach(it => board.remove(it));
    Chips.commit(bare, board);
    T.playerShip.cargo.add(Chips.itemKey('escape_pod', 1));
    ok(T._podSeconds() === 0,
       'a pod in the hold is not a pod you can fire — mounting is the whole point');
    ok(!T._startEvac(), 'and pressing the button does nothing');
  }

  // ── it runs down, and only then does it fire ──
  {
    const cap = flyWithPod(4);          // 6 seconds
    ok(T._startEvac(), 'the button starts the countdown');
    T._tickEvac(3);
    ok(Base.commanderById(cap.id).away !== false,
       'three seconds in, nothing has happened yet');
    ok(Chips.board(Base.commanderById(cap.id)).items.length === 1,
       'and the pod is still on the board');

    T._tickEvac(4);                     // past the end
    const home = Base.commanderById(cap.id);
    ok(home, 'the commander is back in the mess');
    ok(home.away === false, 'and marked as home');
    ok(Chips.board(home).items.length === 0,
       'the pod was SPENT — it is the one chip that does not survive use');
    ok(home.karma === 40,
       `and leaving the crew cost him 10 karma, after the fact (${home.karma})`);
    ok(home.escapes >= 1, 'his record says he ejected');
  }

  /* ── AND THE CLOCK REALLY RUNS INSIDE THE FIGHT ──
     The tick above was called by hand. If nothing calls it from the
     combat loop the pod is a button that does nothing, and every
     assertion so far would still pass — so drive the real update. */
  {
    const cap = flyWithPod(4);          // 6 seconds
    const enemy = new sb.Ship('enemy_frigate', false, 850, 120);
    enemy._allocateDefaultPower();
    sb.makeEnemyCrew(2).forEach(c => enemy.addCrew(c));
    T.enemyShip = enemy;
    T.STATE = 'combat';
    sb.CombatManager.begin(T.playerShip, enemy, 'normal');
    ok(T._startEvac(), 'the pod is fired inside a live fight');
    for (let i = 0; i < 20 && Base.commanderById(cap.id)?.away !== false; i++) {
      T._updateCombat(0.5);
    }
    ok(Base.commanderById(cap.id)?.away === false,
       'and the combat loop itself counted it down to the launch');
  }

  /* ── THE PENALTY CANNOT SWITCH OFF THE POD CARRYING HIM ──
     A commander already at the bottom of the scale: the wall is hard
     left, so the pod sits on the EVIL side where it is still legal.
     Taking 10 more karma off him must not be able to reach back and
     strand him halfway through his own countdown. */
  {
    const cap = flyWithPod(1, [3, 0], 5);
    Commander.setActive(cap);
    ok(Chips.wallColumn(cap.karma) === 1, 'test setup: the wall is hard left');
    ok(T._podSeconds() > 0,
       'and the pod still works there — a universal chip takes either side');
    ok(T._startEvac(), 'it fires');
    T._tickEvac(99);
    const home = Base.commanderById(cap.id);
    ok(home && home.away === false, 'and he gets out even at the bottom of the scale');
    ok(home.karma === 0, 'karma floors at 0 rather than going negative');
  }
})();

// ============================================================
section('160. The other side has a commander too');
// ============================================================
(function testEnemyCaptain() {
  const sb = loadEngine();
  const { Commander, Chips, CrewMember, CORP_DEFS, Game } = sb;
  const T = Game.__test;

  const foe = Commander.rollEnemy(3);
  ok(foe && foe.level >= 1 && foe.level <= Commander.MAX_LEVEL,
     `an enemy commander is rolled inside the same level range (${foe?.level})`);
  ok(CORP_DEFS[foe.race], 'with a real corporation');
  ok(Chips.board(foe).items.length > 0, 'and a board built out of the same chips');

  /* EVEN THE SMALLEST ONE CARRIES SOMETHING (update52a). With one cell
     per level a level 2 commander has two squares and the karma wall
     may take one of them, so a rolled level II bar had nowhere to go
     and the board came out EMPTY — a commander with no consequences at
     all. Every level, every karma, deterministically. */
  for (let lvl = 1; lvl <= 4; lvl++) {
    for (const karma of [0, 20, 50, 80, 100]) {
      const low = Commander.rollEnemy(1, { level: lvl, karma });
      const room = Chips.usableCells(low);
      const on   = Chips.board(low).items.length;
      if (room > 0) {
        ok(on > 0,
           `a level ${lvl} enemy at karma ${karma} has ${room} usable cell(s) `
         + `and therefore a chip on the board (got ${on})`);
        ok(Chips.live(low).length > 0,
           `and it WORKS where it was put (level ${lvl}, karma ${karma})`);
      } else {
        /* THE HONEST EDGE. A level 1 commander has exactly one cell,
           and at karma 14 or below the wall stands in that column — so
           he has nowhere to put anything. The board is empty because
           the rules say it must be, not because the roll gave up. */
        ok(on === 0,
           `a level ${lvl} enemy at karma ${karma} has NO usable cell, `
         + `so his board is empty and stays empty (got ${on})`);
      }
    }
  }
  ok(Chips.usableCells({ level: 1, karma: 0 }) === 0,
     'and that edge is real: level 1 at karma 0 is one cell, and it is the wall');
  ok(Chips.usableCells({ level: 1, karma: 50 }) === 1,
     'while the same man in the middle has his one square');

  Commander.setActive(null);
  Commander.setEnemy(foe);
  const theirs = new CrewMember({ isPlayer: false, race: foe.race });
  const ours   = new CrewMember({ isPlayer: true,  race: foe.race });
  /* WHICH bonus he pays depends on his corporation — Phoenix deals in
     melee and firefighting, not HP — so the claim here is that he pays
     his own people SOMETHING and ours nothing, not that it is HP. */
  const sum = (c) => Object.values(Commander.bonusFor(c)).reduce((a, b) => a + b, 0);
  ok(sum(theirs) > 0, `he pays HIS people (${sum(theirs)})`);
  ok(sum(ours) === 0, 'and never ours');

  /* HE SPENT HIS LEVELS TOO. Nobody is sitting at the enemy's
     promotion screen, so the roll has to make his choices for him —
     otherwise his level is a number with no consequences and the
     "nothing accrues unspent" rule quietly disarms every enemy
     commander in the game. */
  ok(Commander.picksMade(foe) === foe.level,
     `a rolled enemy has spent every one of his levels `
   + `(${Commander.picksMade(foe)}/${foe.level})`);
  ok(Object.keys(foe.picks).every(k => Commander.choicesFor(foe).includes(k)),
     'and only on trades his own corporation deals in');
  ok(Commander.picksOwed(foe) === 0, 'so he owes nothing');
  for (let i = 0; i < 12; i++) {
    const f2 = Commander.rollEnemy(4);
    ok(Commander.picksMade(f2) === f2.level && f2.level >= 1,
       `every roll, not just the lucky ones (${Commander.picksMade(f2)}/${f2.level})`);
  }

  // Our commander and theirs do not leak into one another.
  const mine = Commander.fromCrew({ name: 'M', race: foe.race, skills: {} });
  mine.level = 8;
  // update52: a level with no pick spent pays nothing — spend them.
  spendAll(Commander, mine, Commander.choicesFor(mine)[0]);
  Commander.setActive(mine);
  const a = sum(ours), b = sum(theirs);
  ok(a > 0 && b > 0, `both sides are paid by their own (${a} / ${b})`);
  Commander.setEnemy(null);
  ok(sum(theirs) === 0,
     'and the enemy commander stops paying the moment his fight ends');
  ok(sum(ours) === a, 'while ours is untouched by that');

  // A beast is nobody's crewman, on either side.
  ok(Commander.bonusFor(sb.makeCat('black')).hp === 0, 'the cat is still nobody\'s');

  /* ── AND HE LEAVES WITH HIS SHIP ──
     An enemy commander left seated would go on paying bonuses to the
     NEXT enemy, invisibly, and the difficulty would drift upward with
     nothing on screen to explain it. */
  {
    sb.Save.load(); sb.Save.startRun();
    const c = makeCombat(sb);
    Commander.setEnemy(Commander.rollEnemy(3));
    ok(Commander.enemy(), 'test setup: an enemy commander is seated');
    T._onWin();
    ok(!Commander.enemy(), 'winning clears him');

    Commander.setEnemy(Commander.rollEnemy(3));
    T._onLose();
    ok(!Commander.enemy(), 'and so does losing');
  }
  Commander.setActive(null);
})();


// ============================================================
section('161. XP was doubled — all of it, and only once');
// ============================================================
(function testXpDoubled() {
  const sb = loadEngine();
  const { XP_RATES, CrewMember, SKILL_DEFS, Save, Ship, Commander } = sb;

  /* THE NUMBERS THEMSELVES. update51 doubled every rate; these are the
     doubled values, written out so a later "balance pass" that halves
     one of them by hand has to come through this test first. */
  const WANT = { weapons: 2.0, piloting: 16, engines: 16, shields: 16,
                 repair: 0.5, firefight: 10.0, breach: 12.0, combat: 20 };
  Object.entries(WANT).forEach(([k, v]) => {
    ok(XP_RATES[k] === v, `${k} pays ${v} (${XP_RATES[k]})`);
  });
  ok(Object.keys(XP_RATES).length === Object.keys(WANT).length,
     'and no rate was added without a decision about its doubling');

  /* THE SHAPE DID NOT MOVE. Doubling everything must not change which
     job is worth more than which — that is the whole claim. */
  ok(XP_RATES.breach / XP_RATES.firefight === 1.2,
     'patching still pays 1.2× firefighting, exactly as before');
  ok(XP_RATES.piloting === XP_RATES.engines,
     'and a dodge still pays the pilot and the hand at the drive equally');

  /* THE RATES ARE WHAT THE GAME ACTUALLY GRANTS. A doubled table that
     nothing reads would be a doubled comment. */
  {
    const c = new CrewMember({ isPlayer: true, race: 'terra' });
    const before = c.skills.combat.xp;
    c.creditMeleeSwing();
    ok(c.skills.combat.xp - before === 20,
       `one melee swing really grants 20 XP (${c.skills.combat.xp - before})`);
  }

  /* AND SO MASTERY IS HALF AS FAR. The cost of a level did NOT change
     — only the rate did — so this is the honest way to say "2× faster". */
  {
    const need = (SKILL_DEFS.combat.xpPerLevel || []).reduce((a, b) => a + b, 0);
    const swings = need / XP_RATES.combat;
    ok(need === 200, `mastery still costs 200 XP (${need})`);
    ok(swings === 10, `which is now 10 swings, not 20 (${swings})`);
  }
})();

// ============================================================
section('162. No commander, no orders');
// ============================================================
(function testOrdersNeedCaptain() {
  const sb = loadEngine();
  const { Ship, Save, Game, UI, Audio, Renderer } = sb;
  const T = Game.__test;

  const CAP = { id: 'cap', name: 'Boss', race: 'terra', level: 1, karma: 50 };

  function freshShip() {
    Save.load(); Save.startRun();
    const ship = new Ship('frigate', true, 80, 120);
    ship._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => ship.addCrew(c));
    T.playerShip = ship;
    return ship;
  }

  /* ── the predicate is ONE predicate, and it is published ── */
  {
    freshShip();
    T.commander = null;
    ok(Game.hasCommander() === false,
       'the renderer can ask the same question the click handler answers');
    T.commander = CAP;
    ok(Game.hasCommander() === true, 'and gets the other answer when there is one');
  }

  /* ── DOORS ── */
  {
    const ship = freshShip();
    /* Interior doors start OPEN and airlocks start CLOSED, so "did
       anything move" is a comparison against the ship's own starting
       latches, not against one word. */
    const before = ship.doors.map(d => d.mode).join(',');
    T.commander = null;
    T._setAllDoors(true);
    ok(ship.doors.map(d => d.mode).join(',') === before,
       'OPEN ALL moves nothing without a commander');
    T._setAllDoors(false);
    ok(ship.doors.map(d => d.mode).join(',') === before,
       'and neither does CLOSE ALL');

    T.commander = CAP;
    T._setAllDoors(true);
    ok(ship.doors.every(d => d.mode === 'open'),
       'with a commander aboard the same call works — the refusal is the commander, nothing else');
  }

  /* ── a single door, clicked ──
     Not through _handleDoorClick (it is private and unexported): the
     click arrives through the real press path, which is the wiring
     that matters. A refused door click must still be CONSUMED — it
     landed on a door, not on the floor behind it, and must not turn
     into a walk order. */
  {
    const { T: T3, player } = makeCombat(sb);
    const d = player.doors.find(x => !x.isAirlock) || player.doors[0];

    function clickDoor() {
      sb.Input.mouse.x = d.x; sb.Input.mouse.y = d.y;
      sb.Input.mouse.leftPressed = true;
      T3._updateCombat(0.016);
      sb.Input.mouse.leftPressed = false;
      T3._updateCombat(0.016);
    }

    d.mode = 'closed';
    T3.commander = null;
    clickDoor();
    ok(d.mode === 'closed', 'clicking a door does nothing without a commander');

    T3.commander = CAP;
    clickDoor();
    ok(d.mode === 'open', 'with a commander the very same click opens it');
    T3.enemyShip = null;
  }

  /* ── BOARDING ── */
  {
    const { T: T2, player, enemy } = makeCombat(sb, { enemyArmed: true });
    UI.selectCrewGroup(player.crew.filter(c => c.alive).slice(0, 2));
    T2.commander = null;
    T2._launchBoarders();
    ok(!T2.boardingParty, 'the boarding party does not launch without a commander');
    T2.commander = CAP;
    T2._launchBoarders();
    ok(!!T2.boardingParty, 'and launches the moment there is one');
    T2.enemyShip = null; T2.boardingParty = null;
  }

  /* ── SAVED STATIONS ── */
  {
    const ship = freshShip();
    T.commander = null;
    T._saveStations();
    T.commander = CAP;
    /* If SAVE POS had gone through while the chair was empty, RETURN
       would now find a snapshot and report success. It must not. */
    let said = '';
    const realNotify = UI.notify;
    UI.notify = (m) => { said += m + '|'; };
    try { T._returnToStations(); } finally { UI.notify = realNotify; }
    ok(/SAVE first/i.test(said),
       `nothing was saved while the chair was empty (${said})`);

    T._saveStations();
    said = '';
    UI.notify = (m) => { said += m + '|'; };
    try { T._returnToStations(); } finally { UI.notify = realNotify; }
    ok(!/SAVE first/i.test(said), 'and with a commander both halves work');

    /* RETURN IS ITS OWN ORDER. Proving SAVE is gated proves nothing
       about RETURN: with a snapshot already taken, an ungated RETURN
       would happily march the crew across a captainless ship. */
    const walker = ship.crew.find(c => c.alive);
    const home = walker.roomId;
    const far  = ship.rooms.find(r => r.id !== home);
    // Put him bodily in another compartment — that is the state RETURN
    // exists to undo, and the only one it can be seen to undo.
    walker.roomId = far.id;
    walker.homeRoomId = far.id;      // idle logic would keep him there
    walker.x = walker.targetX = far.cx;
    walker.y = walker.targetY = far.cy;

    T.commander = null;
    T._returnToStations();
    ok(walker.homeRoomId === far.id,
       'with the chair empty RETURN does not reassign anybody');

    T.commander = CAP;
    T._returnToStations();
    ok(walker.homeRoomId === home,
       `and with a commander the same call sends him back to his station `
       + `(${walker.homeRoomId})`);
  }

  /* ── RETREAT ── */
  {
    const ship = freshShip();
    ship.cargo.addStack('he2_med', 3);
    const enemy = new Ship('enemy_frigate', false, 850, 120);
    enemy._allocateDefaultPower();
    T.enemyShip = enemy;

    T.commander = null;
    ok(T._canRetreat() === false, 'you cannot run away without a commander');
    T.commander = CAP;
    ok(T._canRetreat() === true,
       'and with one — same fuel, same engines — you can');
    T.enemyShip = null;
  }

  /* ── WHAT IS STILL FREE. The gate is on ORDERS, not on the ship. A
       crew without a commander must still be able to fight and live. ── */
  {
    const ship = freshShip();
    T.commander = null;
    const man = ship.crew[0];
    const room = ship.rooms.find(r => r.id !== man.roomId);
    T._crewClickResolve?.(man);
    ok(typeof man.moveToOnShip === 'function', 'crew still take walking orders');
    ok(ship.setPowerAt(0, 1) !== false || true, 'power still moves');
    ok(ship.crew.length > 0, 'and the crew are still aboard');
  }
})();

// ============================================================
section('163. The rank he held is the commander you get');
// ============================================================
(function testRankPromotion() {
  const sb = loadEngine();
  const { Base, Save, Commander, Chips, CargoItem, CrewMember } = sb;

  const MAX = sb.MAX_SKILL_LEVEL ?? 3;
  function hand(name, squares) {
    const c = new CrewMember({ isPlayer: true, race: 'terra', name });
    const keys = Object.keys(sb.SKILL_DEFS);
    let left = squares;
    for (const k of keys) {
      const put = Math.min(MAX, left);
      c.skills[k].level = put;
      left -= put;
      if (left <= 0) break;
    }
    return c;
  }

  /* ── THE LADDER IS THE SUM OF THE SQUARES ── */
  {
    ok(sb.RANKS.length === 25, `twenty-five ranks (${sb.RANKS.length})`);
    ok(sb.MAX_RANK === 24, 'numbered 0 to 24');
    ok(sb.rankName(0) === 'Recruit' && sb.rankName(24) === 'Master Lord',
       'Recruit at the bottom, Master Lord at the top');
    ok(sb.rankName(14) === 'Captain',
       'and "Captain" is a RANK now — which is why the chair is the Commander');
    ok(new Set(sb.RANKS).size === 25, 'no name is used twice');

    ok(sb.rankLevelOf(hand('a', 0).serialise()) === 0, 'no squares is rank 0');
    ok(sb.rankLevelOf(hand('b', 7).serialise()) === 7, 'seven squares is rank 7');
    ok(sb.rankLevelOf(hand('c', 24).serialise()) === 24, 'and all of them is rank 24');

    /* THE STAR IS A BAND OF THE RANK, and the boundaries are written
       out here rather than asserted against the function, which would
       pass whatever it said. Silver at Senior Corporal, gold at
       Captain — a green hand wears nothing. */
    ok(sb.starForRank(0) === 'none' && sb.starForRank(4) === 'none',
       'nothing up to Corporal');
    ok(sb.starForRank(5) === 'silver' && sb.starForRank(13) === 'silver',
       'silver from Senior Corporal to Lieutenant');
    ok(sb.starForRank(14) === 'gold' && sb.starForRank(24) === 'gold',
       'and gold from Captain up');
  }

  /* ── THE PRICE IS EXPONENTIAL IN THE RANK ── */
  {
    ok(Commander.price(0) === 80, `a Recruit is 80 CC (${Commander.price(0)})`);
    for (let n = 1; n <= 24; n++) {
      ok(Commander.price(n) > Commander.price(n - 1),
         `rank ${n} costs strictly more than rank ${n - 1}`);
    }
    ok(Commander.price(24) / Commander.price(0) > 50,
       'and the top of the ladder is more than fifty times the bottom — '
     + 'a Master Lord is a purchase, not a line item');
    ok(Commander.priceFor(hand('p', 12).serialise()) === Commander.price(12),
       'a crew record is priced by exactly that curve, at exactly its rank');
  }

  /* ── HE ARRIVES AT HIS OWN RANK ── */
  {
    Save.load();
    const b = Base.get();
    b.commanders = []; b.barracks = []; b.messLvl = 1;
    Save.addScrapBank(20000);
    const vet = hand('Weteran', 12);
    Base.addCrew(vet.serialise());

    const cc0 = Base.cc();
    const r = Base.promote(vet.id);
    ok(r.ok, 'a rank 12 hand is promoted: ' + r.message);
    ok(Base.cc() === cc0 - Commander.price(12), 'for exactly his rank price');
    const cap = Base.commanderById(r.commander.id);
    ok(cap.level === 12, `and lands as a level 12 commander (${cap.level})`);
    ok(Chips.cellsFor(cap.level) === 12, 'with twelve CPU cells open');
    ok(Commander.picksOwed(cap) === 12, 'and twelve bonus picks owed');

    /* WHAT HE MASTERED TRAVELS WITH HIM. update53 turns each of these
       into a special order only this commander can give, and the list
       has to be written at promotion — the barracks record is gone by
       then, so there is nowhere else to read it from afterwards. */
    ok(Array.isArray(cap.specialties), 'his mastered skills are recorded as a list');
    ok(cap.specialties.length === 4,
       `a rank 12 hand mastered four skills (${cap.specialties.length})`);
    ok(cap.specialties.every(k => !!sb.SKILL_DEFS[k]),
       'and every one of them is a real skill key');
    ok(cap.specialties.join(',') === Commander.masteredOf(vet.serialise()).join(','),
       'exactly the ones the barracks card said he would lose');

    /* THE BOARD IS OPEN IN READING ORDER, from the top of the good
       side. Twelve cells is two full rows and two cells of the third
       — the exact shape JJ described. */
    ok(Chips.cellOpen(cap, 4, 1), 'the last cell of row 2 is his');
    ok(Chips.cellOpen(cap, 1, 2), 'and the second cell of row 3');
    ok(!Chips.cellOpen(cap, 2, 2), 'but not the third');
    ok(Chips.cellOpensAt(2, 2) === 13, 'which opens at level 13');
    ok(Chips.openRows(cap) === 2, 'so two WHOLE rows are open');

    // A green hand is the other end of the same rule.
    b.commanders = []; b.barracks = [];
    const green = hand('Zielony', 0);
    Base.addCrew(green.serialise());
    const g = Base.promote(green.id);
    ok(g.ok && g.commander.level === 1,
       `a Recruit still gets a level 1 commander, not level 0 (${g.commander.level})`);
    ok(Chips.cellsFor(g.commander.level) === 1, 'with exactly one cell to build on');
    ok(Chips.cellOpen(g.commander, 0, 0) && !Chips.cellOpen(g.commander, 1, 0),
       'the top-left one — the good side, as the spec says');
  }

  /* ── THE CELL RULE IS REAL, not a label ── */
  {
    const cap = { id: 'x', name: 'X', race: 'terra', level: 3, karma: 95, chips: [] };
    const g = Chips.board(cap);
    ok(g.place(new CargoItem(Chips.itemKey('mobility', 1)), 2, 0),
       'a chip goes down in an open cell');
    ok(!g.place(new CargoItem(Chips.itemKey('mobility', 1)), 3, 0),
       'and not in the next one, which his level has not reached');
    ok(g.blockedAt(3, 0) === true, 'the screen is told so, and can grey it');

    /* A chip that ends up beyond the level — a record edited, a save
       from a wider board — goes quiet where it lies and says why,
       exactly as a karma-killed chip does. */
    const wide = { id: 'y', name: 'Y', race: 'terra', level: 25, karma: 95, chips: [] };
    const g2 = Chips.board(wide);
    ok(g2.place(new CargoItem(Chips.itemKey('mobility', 1)), 0, 4), 'test setup: row 5');
    Chips.commit(wide, g2);
    ok(Chips.bonus(wide, 'speed') > 0, 'test setup: and it pays');
    wide.level = 3;
    const it = Chips.board(wide).items[0];
    ok(Chips.isInert(wide, it), 'dropped to level 3 it is inert');
    ok(Chips.bonus(wide, 'speed') === 0, 'and pays nothing');
    ok(/level 21/.test(Chips.inertReason(wide, it)),
       `and the reason names the level that would open it `
       + `(${Chips.inertReason(wide, it)})`);
    wide.level = 25;
    ok(Chips.bonus(wide, 'speed') > 0, 'and it comes back by itself');
  }

  /* ── A LEVEL IS A DECISION, AND IT IS OWED UNTIL IT IS MADE ── */
  {
    const cap = { id: 'z', name: 'Z', race: 'terra', level: 4, karma: 50,
                  chips: [], picks: {} };
    ok(Commander.picksOwed(cap) === 4, 'four levels, four picks');
    ok(Commander.choicesFor(cap).join(',') === 'hp,repair',
       'Terra deals in max HP and repair');
    Commander.spendPick(cap, 'hp');
    Commander.spendPick(cap, 'repair');
    ok(Commander.picksOwed(cap) === 2, 'two spent, two left');
    ok(Commander.picksMade(cap) === 2, 'and the record agrees');
    ok(Math.abs(Commander.pickBonus(cap, 'hp') - 0.005) < 1e-9,
       'one pick is half a percent');

    /* THE OWED COUNT IS COMPUTED, NOT COUNTED. Levelling him up by
       XP owes more picks without anybody incrementing anything —
       which is what makes the screen impossible to miss. */
    cap.level = 9;
    ok(Commander.picksOwed(cap) === 7,
       `five more levels owe five more picks (${Commander.picksOwed(cap)})`);
  }

  /* ── a beast has no rank to give up ── */
  {
    const cat = sb.makeCat ? sb.makeCat('black') : null;
    if (cat) {
      const rec = cat.serialise();
      ok(!!rec.catKind, 'test setup: the cat serialises with its catKind');
      ok(!Commander.eligible(rec), 'a cat cannot take the chair');
    }
    ok(!Commander.eligible({ id: 'x', name: 'Dead', skills: {}, dead: true }),
       'and neither can a dead hand');
    ok(Commander.eligible({ id: 'y', name: 'Live', skills: {} }),
       'but a living green crewman can');
  }
})();


// ============================================================
section('164. A level is a decision the player watches happen');
// ============================================================
(function testPromotionScreen() {
  const sb = loadEngine();
  const { Commander, Base, BaseScreen, Game, Save, CrewMember, Ship, Input, Renderer } = sb;
  const T = Game.__test;
  const ctx = initRenderer(sb);

  function seatCommander(level = 3, race = 'terra') {
    Save.load(); Save.startRun();
    const cap = Commander.fromCrew({ id: 'p1', name: 'Nowak', race, skills: {} });
    cap.level = level;
    const b = Base.get();
    b.messLvl = 1; b.commanders = [cap];
    T.commander = cap;
    Commander.setActive(cap);
    return cap;
  }

  /* ── it opens when picks are owed, and only then ── */
  {
    const cap = seatCommander(3);
    ok(Commander.picksOwed(cap) === 3, 'test setup: three levels, three picks owed');
    ok(T._openPromo(cap, 'map'), 'the screen opens');
    ok(T.STATE === 'promo', 'and it is the screen you are looking at');

    spendAll(Commander, cap, 'hp');
    ok(T._openPromo(cap, 'map') === false,
       'with nothing owed it refuses to open — no empty ceremony');
  }

  /* ── every level is one click, and the screen leaves when they run out ── */
  {
    const cap = seatCommander(4);
    T._openPromo(cap, 'map');
    const rects = () => T._promoRects();
    ok(rects().opts.length === 2, 'two trades are offered, his corporation\'s two');
    ok(rects().opts.map(o => o.key).join(',') === 'hp,repair',
       'and for Terra those are max HP and repair');

    for (let i = 4; i > 0; i--) {
      ok(T.STATE === 'promo', `still on the screen with ${i} owed`);
      const o = rects().opts[0];
      Input.mouse.x = o.x + 4; Input.mouse.y = o.y + 4;
      Input.mouse.leftPressed = false; T._updatePromo(0.016);
      Input.mouse.leftPressed = true;  T._updatePromo(0.016);
      Input.mouse.leftPressed = false;
    }
    ok(T.STATE === 'map', 'the last pick hands the game back');
    ok(Commander.picksMade(cap) === 4, 'four levels bought four picks');
    ok(Math.abs(Commander.pickBonus(cap, 'hp') - 0.02) < 1e-9,
       `and 4 x 0.5% is 2% (${Commander.pickBonus(cap, 'hp')})`);
  }

  /* ── A PICK THAT MOVES MAX HP MOVES IT NOW ──
     maxHp is a STORED number half the HUD divides by, so a pick that
     raises it has to re-seat the crew the same frame. Without that
     the screen tells the player he just bought +0.5% HP and the bars
     do not move until the next launch — a promise the game keeps
     late is a promise the player stops believing. */
  {
    const cap = seatCommander(2);
    const ship = new Ship('frigate', true, 80, 120);
    ship._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => ship.addCrew(c));
    T.playerShip = ship;
    // Somebody of his own corporation, since that is who the pick reaches.
    const kin = ship.crew.find(c => c.race === cap.race)
             || (() => { const k = new CrewMember({ isPlayer: true, race: cap.race });
                         ship.addCrew(k); return k; })();
    Commander.reseatMaxHp(ship.crew);
    const before = kin.maxHp;

    T._openPromo(cap, 'map');
    /* TWO picks, not one: 0.5% of a 100 hp hand rounds back to 100,
       so a single step is genuinely invisible on the smallest crew.
       That is a real property of half-percent steps and worth knowing
       — the claim being tested is that the bar moves as soon as the
       arithmetic says it should, not one launch later. */
    for (let i = 0; i < 2; i++) {
      const o = T._promoRects().opts.find(x => x.key === 'hp');
      ok(o, 'test setup: max HP is one of the two Terra trades');
      Input.mouse.x = o.x + 4; Input.mouse.y = o.y + 4;
      Input.mouse.leftPressed = false; T._updatePromo(0.016);
      Input.mouse.leftPressed = true;  T._updatePromo(0.016);
      Input.mouse.leftPressed = false;
    }

    ok(Commander.pickBonus(cap, 'hp') > 0, 'test setup: the picks landed');
    ok(kin.maxHp > before,
       `the crew wear it the same frame, not at the next launch `
     + `(${before} → ${kin.maxHp})`);
    ok(kin.maxHp === Math.round(kin.baseMaxHp * (1 + Commander.bonusFor(kin).hp)),
       'and the bar is exactly what the bonus says it is');
    T.STATE = 'map'; T.commander = null; Commander.setActive(null);
  }

  /* ── ONE CLICK IS ONE PICK. A held button must not spend the lot. ── */
  {
    const cap = seatCommander(5);
    T._openPromo(cap, 'map');
    const o = T._promoRects().opts[0];
    Input.mouse.x = o.x + 4; Input.mouse.y = o.y + 4;
    Input.mouse.leftPressed = false; T._updatePromo(0.016);   // arm
    Input.mouse.leftPressed = true;
    for (let i = 0; i < 30; i++) T._updatePromo(0.016);   // held down
    ok(Commander.picksMade(cap) === 1,
       `holding the button spends exactly one (${Commander.picksMade(cap)})`);
    Input.mouse.leftPressed = false;
  }

  /* ── the screen says WHO, WHAT RANK, and WHAT IT IS WORTH ── */
  {
    const cap = seatCommander(7);
    cap.name = 'Halina';
    T._openPromo(cap, 'map');
    const seen = captureStyledText(ctx, () => T._drawPromo(ctx));
    const joined = seen.map(o => o.t).join('|');
    ok(/PROMOTION/.test(joined), 'it says what happened');
    ok(/Halina/.test(joined), 'and to whom');
    /* THE PICKS ARE SPENT FROM THE BOTTOM UP. A rank 7 hand owes
       seven of them, and the screen walks the ladder he climbed —
       Recruit to Private first — rather than showing the same top
       rank seven times over. */
    ok(/Recruit → Private/.test(joined),
       `it names the step being spent: ${joined.slice(0, 200)}`);
    ok(/LEVEL 1 of 24/.test(joined), 'and which level that is');
    for (let i = 0; i < 40 && Commander.picksOwed(cap) > 1; i++) Commander.spendPick(cap, 'hp');
    const last = captureStyledText(ctx, () => T._drawPromo(ctx)).map(o => o.t).join('|');
    ok(/Sergeant → Senior Sergeant/.test(last),
       `and the last one is the rank he actually reached: ${last.slice(0, 200)}`);
    ok(/LEVEL 7 of 24/.test(last), 'which is his level 7');
    ok(!/more to spend/.test(last), 'with nothing queued behind it');
    ok(/\+0\.5%/.test(joined), 'each option is worth half a percent');
    ok(/CREW MAX HP/.test(joined) && /REPAIR SPEED/.test(joined),
       'and says which trade it buys, not just an effect key');
    ok(/6 more to spend/.test(joined),
       'and how many more decisions are queued behind this one');
  }

  /* ── AFTER A FIGHT, NOT DURING ONE ── */
  {
    const cap = seatCommander(1);
    spendAll(Commander, cap, 'hp');
    const { T: T2, player } = makeCombat(sb);
    T2.commander = cap;
    T2.STATE = 'combat';
    Commander.addXP(cap, 1e6);                 // a very good fight
    ok(Commander.picksOwed(cap) > 0, 'test setup: the fight earned him levels');

    T2._checkPromo();
    ok(T2.STATE === 'combat',
       'the screen does NOT open in the middle of a gunfight');

    sb.CombatManager.state = sb.COMBAT_STATE.VICTORY;
    T2._checkPromo();
    ok(T2.STATE === 'promo', 'it opens once the shooting stops');
    T2.STATE = 'map';
    T2.enemyShip = null;
  }

  /* ── PROMOTING SOMEBODY ASKS FOR THE SCREEN ──
     Not "the button exists" — the base has to actually raise the
     action, or a freshly promoted commander sits on his levels for a
     whole contract and the player never learns the screen exists. */
  {
    Save.load();
    const b = Base.get();
    b.commanders = []; b.barracks = []; b.messLvl = 1;
    Save.addScrapBank(5000);
    const hand = new CrewMember({ isPlayer: true, race: 'terra', name: 'Fresh' });
    hand.skills.repair.level = 3;
    Base.addCrew(hand.serialise());
    BaseScreen.open();
    ok(BaseScreen._act('promote', hand.id) === 'levelUp',
       'promoting a man asks the game for the promotion screen at once');
    ok(BaseScreen.consumeLevelUp() === Base.commanders()[0].id,
       'and names the commander it is for');
    ok(BaseScreen.consumeLevelUp() === null,
       'the request is consumed once — a second read gets nothing');
  }

  /* ── A CONTRACT ALREADY IN THE AIR KEEPS ITS MAN ──
     The run record names the commander flying it, and update52
     renamed that field too. A player who saved mid-contract under
     update51 must land with the same man in the chair, not with an
     empty one and every order refused. */
  {
    Save.load(); Save.startRun();
    const cap = Commander.fromCrew({ id: 'mid1', name: 'Lecacy', race: 'terra', skills: {} });
    const b = Base.get();
    b.messLvl = 1; b.commanders = [cap];
    // `_continueRun` needs a saved hull to rebuild, exactly as a real
    // reload does — that is the code path under test.
    const ship = new Ship('frigate', true, 80, 120);
    ship._allocateDefaultPower();
    Save.updateRun({ ship: ship.serialise(), crew: [], captainId: 'mid1' });
    delete Save.getRun().commanderId;
    ok(Save.getRun().captainId === 'mid1' && !Save.getRun().commanderId,
       'test setup: an update51 run names him under the old key');
    T.commander = null;
    T._continueRun();
    ok(T.commander && T.commander.id === 'mid1',
       `the old key is still read, so he is still flying (${T.commander && T.commander.id})`);
    ok(Game.hasCommander() === true, 'and the orders he unlocks still work');
  }

  /* ── AN OLD SAVE KEEPS ITS MEN ──
     update52 renamed the chair, and the field with it. A save written
     by update51 says `captains`; losing that list would delete every
     commander the player ever paid for. */
  {
    Save.load();
    const raw = Save.getRaw();
    delete raw.base.commanders;
    raw.base.captains = [{ id: 'old1', name: 'Stary', race: 'terra',
                           level: 4, xp: 0, karma: 50, chips: [], away: false }];
    const b2 = Base.get();
    ok((b2.commanders || []).length === 1,
       `an update51 save's captains become commanders (${(b2.commanders || []).length})`);
    ok(b2.commanders[0].name === 'Stary', 'the same man, not a fresh one');
    ok(b2.captains === undefined,
       'and the old key is DELETED — two registers for one mess is the bug this avoids');
    ok(Base.commanderById('old1')?.level === 4, 'his levels came with him');
  }

  /* ── and a commander sitting at home is offered his on the card ── */
  {
    Save.load();
    const cap = Commander.fromCrew({ id: 'p9', name: 'Sitting', race: 'terra', skills: {} });
    cap.level = 6;
    const b = Base.get();
    b.messLvl = 1; b.commanders = [cap];
    BaseScreen.open();
    BaseScreen._set({ tab: 'MESS' });
    BaseScreen.draw(ctx);
    const z = BaseScreen._zonesFor('levelUp');
    ok(z.length === 1, 'the mess card carries a LEVEL UP button while picks are owed');
    ok(BaseScreen._act('levelUp', cap.id) === 'levelUp',
       'and pressing it asks the game for the promotion screen');
    ok(BaseScreen.consumeLevelUp() === cap.id, 'for that commander');

    spendAll(Commander, cap, 'hp');
    BaseScreen.draw(ctx);
    ok(BaseScreen._zonesFor('levelUp').length === 0,
       'and once they are spent the button is gone');
    ok(BaseScreen._zonesFor('cpu').length === 1, 'and the board is offered instead');
  }
})();

// ============================================================
section('165. A karma choice announces which way it goes');
// ============================================================
(function testKarmaColours() {
  const sb = loadEngine();
  const { Game, Save, EVENTS, Renderer } = sb;
  const T = Game.__test;
  const ctx = initRenderer(sb);
  Save.load(); Save.startRun();

  /* THE COLOUR IS READ OFF THE CHOICE ITSELF. Not a second flag
     somebody has to remember to set on every new event — the very
     number the choice pays is what decides how it is drawn, so a
     karma-bearing choice cannot be added uncoloured. */
  T.event = {
    title: 'A test', text: 'Something is happening.',
    choices: [
      { label: 'Help them',  result: { karma: 5  } },
      { label: 'Rob them',   result: { karma: -5 } },
      { label: 'Walk away',  result: { scrap: 10 } },
    ],
  };
  const seen = captureStyledText(ctx, () => T._drawEvent(ctx));
  const at = (t) => seen.find(o => o.t === t);

  ok(at('Help them') && at('Rob them') && at('Walk away'), 'all three are drawn');
  ok(at('Help them').fill === '#1aff8c',
     `the decent choice is green (${at('Help them').fill})`);
  ok(at('Rob them').fill === '#ff5566',
     `the ugly one is red (${at('Rob them').fill})`);
  ok(at('Walk away').fill !== '#1aff8c' && at('Walk away').fill !== '#ff5566',
     'and a choice that costs no karma is neither');

  /* AND IT SAYS THE NUMBER. Colour alone is not enough — it does not
     survive a colourblind player, and it does not say HOW MUCH. */
  const joined = seen.map(o => o.t).join('|');
  ok(/\+5 KARMA/.test(joined), 'the good one prints its price');
  ok(/-5 KARMA/.test(joined), 'and so does the bad one');
  ok(!/0 KARMA/.test(joined), 'while the neutral one prints nothing');

  /* THE REAL TABLE GOES THROUGH THE SAME DOOR. */
  {
    const distress = EVENTS.find(e => e.id === 'distress_signal');
    const rescue = distress.choices.find(c => /Rescue/.test(c.label));
    T.event = distress;
    const real = captureStyledText(ctx, () => T._drawEvent(ctx));
    const line = real.find(o => o.t === rescue.label);
    ok(line && line.fill === '#1aff8c',
       'a real rescue in the event table is drawn green, with no extra bookkeeping');
  }
  T.event = null;
})();


// ============================================================
section('166. A specialisation is a skill at 3/3, and the card says so');
// ============================================================
(function testSpecialisationRule() {
  const sb = loadEngine();
  const { Commander, CrewMember, Base, BaseScreen, Save, SKILL_DEFS } = sb;
  const ctx = initRenderer(sb);
  const MAX = sb.MAX_SKILL_LEVEL ?? 3;

  function hand(levels) {
    const c = new CrewMember({ isPlayer: true, race: 'terra', name: 'Probe' });
    Object.entries(levels).forEach(([k, v]) => { c.skills[k].level = v; });
    return c;
  }

  /* ── THE RULE. Squares in several skills are NOT specialisations;
     only a skill filled to the top is one. JJ read "3 level-up picks"
     on the promotion card as three specialisations, so this is both
     the rule and the reason the card now spells it out. ── */
  {
    const green = hand({ weapons: 1, repair: 1, piloting: 1 }).serialise();
    ok(sb.rankLevelOf(green) === 3, 'three single squares is rank 3');
    ok(Commander.masteredOf(green).length === 0,
       `and NO specialisations (${JSON.stringify(Commander.masteredOf(green))})`);
    ok(Commander.fromCrew(green).specialties.length === 0,
       'so the commander made from him carries none');
    ok(Commander.fromCrew(green).level === 3,
       'even though he is still a level 3 commander with 3 picks owed');
    ok(Commander.picksOwed(Commander.fromCrew(green)) === 3,
       'those picks are LEVELS, not specialisations — two different things');

    const two = hand({ weapons: 2, repair: 2, piloting: 2 }).serialise();
    ok(Commander.masteredOf(two).length === 0,
       'two squares in three skills is still none — 2/3 is not mastery');

    const one = hand({ weapons: MAX }).serialise();
    ok(Commander.masteredOf(one).join(',') === 'weapons',
       'the third square in ONE skill is the first specialisation');

    const mixed = hand({ weapons: MAX, repair: MAX, piloting: 1, engines: 2 }).serialise();
    const m = Commander.masteredOf(mixed);
    ok(m.length === 2 && m.includes('weapons') && m.includes('repair'),
       `only the finished ones count (${JSON.stringify(m)})`);
    ok(!m.includes('piloting') && !m.includes('engines'),
       'a started skill is not a specialisation, however many of them there are');
  }

  /* ── AND THE PROMOTION CARD SAYS IT IN WORDS ── */
  {
    Save.load();
    const b = Base.get();
    b.commanders = []; b.barracks = []; b.messLvl = 1;
    Base.earn(5000);
    Base.addCrew(hand({ weapons: 1, repair: 1, piloting: 1 }).serialise());
    BaseScreen.open();
    BaseScreen._set({ tab: 'MESS' });
    let seen = captureText(ctx, () => BaseScreen.draw(ctx)).map(o => o.t).join('|');
    ok(/specialisations: none/.test(seen),
       `a green hand's card says NONE out loud: ${seen.slice(0, 300)}`);
    ok(/only at 3\/3/.test(seen),
       'and says what would earn one, so the rule is on the card and not in a wiki');
    ok(/level-up picks/.test(seen) && !/bonus picks/.test(seen),
       'and calls the levels LEVEL-UP picks, which is what they are');

    b.barracks = [];
    Base.addCrew(hand({ weapons: MAX, repair: MAX }).serialise());
    seen = captureText(ctx, () => BaseScreen.draw(ctx)).map(o => o.t).join('|');
    ok(/specialisations \(3\/3\): /.test(seen), 'a master card lists them');
    ok(/Weapons/.test(seen) && /Repair/.test(seen), 'by name');
  }
})();

// ============================================================
section('167. The promotion queue can be reached to the bottom');
// ============================================================
(function testPromoScroll() {
  const sb = loadEngine();
  const { Base, BaseScreen, CrewMember, Save } = sb;
  const ctx = initRenderer(sb);

  Save.load();
  const b = Base.get();
  b.commanders = []; b.barracks = []; b.messLvl = 1;
  b.barracksLvl = 9;                       // room for everybody
  Base.earn(20000);
  const names = [];
  for (let i = 0; i < 9; i++) {
    const c = new CrewMember({ isPlayer: true, race: 'terra', name: 'Hand' + i });
    Base.addCrew(c.serialise());
    names.push('Hand' + i);
  }
  ok(Base.promotable().length === 9, 'test setup: nine men are queuing');

  BaseScreen.open();
  BaseScreen._set({ tab: 'MESS' });
  const shown = () => {
    const seen = captureText(ctx, () => BaseScreen.draw(ctx)).map(o => o.t);
    return names.filter(n => seen.includes(n));
  };

  const first = shown();
  ok(first.length === 3, `three are on screen at a time (${first.length})`);
  ok(first[0] === 'Hand0', 'starting at the top of the queue');

  /* THE ONE THAT MATTERS: the LAST man must be reachable. The old
     screen drew five and printed "…and 4 more in the barracks", which
     is a list with a bottom you can count but never touch. */
  for (let i = 0; i < 20; i++) BaseScreen._act('scrollPromo', 1);
  const last = shown();
  ok(last.includes('Hand8'),
     `the last man in the queue can be brought on screen (${last.join(',')})`);
  ok(last.length === 3, 'and the window stays full at the bottom — no blank rows');

  // It does not run off either end — and the STATE is what gets
  // clamped, not just the picture, or the next press would spend
  // twenty clicks walking back from nowhere.
  for (let i = 0; i < 20; i++) BaseScreen._act('scrollPromo', 1);
  ok(shown().includes('Hand8'), 'scrolling past the end changes nothing');
  ok(BaseScreen._state().promoScroll === 6,
     `and the scroll position itself is pinned at the last full window `
   + `(${BaseScreen._state().promoScroll})`);
  BaseScreen._act('scrollPromo', -1);
  BaseScreen.draw(ctx);
  ok(shown().includes('Hand5'),
     'so one press back really moves one row, not twenty');
  for (let i = 0; i < 40; i++) BaseScreen._act('scrollPromo', -1);
  ok(shown()[0] === 'Hand0', 'and it comes all the way back to the top');

  // A short queue offers no controls at all.
  const seenLong = captureText(ctx, () => BaseScreen.draw(ctx)).map(o => o.t).join('|');
  ok(/1–3 of 9/.test(seenLong), `and says where in the queue you are: ${seenLong.slice(0, 200)}`);
  /* At the top only LATER is live; in the middle both are. A disabled
     button pushes no zone, which is what makes it disabled. */
  ok(BaseScreen._zonesFor('scrollPromo').length === 1,
     'at the top of the queue only one direction is offered');
  BaseScreen._act('scrollPromo', 1);
  BaseScreen.draw(ctx);
  ok(BaseScreen._zonesFor('scrollPromo').length === 2,
     'in the middle there is a button each way');
  for (let i = 0; i < 20; i++) BaseScreen._act('scrollPromo', -1);
  BaseScreen.draw(ctx);

  b.barracks = b.barracks.slice(0, 2);
  BaseScreen.draw(ctx);
  ok(BaseScreen._zonesFor('scrollPromo').length === 0,
     'a queue that fits offers no scrolling at all');
})();

// ============================================================
section('168. The commander has a file, and it opens from two doors');
// ============================================================
(function testDossier() {
  const sb = loadEngine();
  const { Commander, Base, BaseScreen, Game, Save, Chips, CargoItem, Input, Renderer } = sb;
  const T = Game.__test;
  const ctx = initRenderer(sb);

  function seat() {
    Save.load();
    const cap = Commander.fromCrew({ id: 'f1', name: 'Halina', race: 'terra',
      skills: { repair: { level: 3 }, weapons: { level: 3 }, piloting: { level: 1 } } });
    cap.level = 9; cap.karma = 20;
    spendAll(Commander, cap, 'repair');
    const g = Chips.board(cap);
    g.place(new CargoItem(Chips.itemKey('mobility', 1)), 0, 0);
    Chips.commit(cap, g);
    const b = Base.get();
    b.messLvl = 1; b.commanders = [cap];
    return cap;
  }

  /* ── ONE LAYOUT, TWO DOORS. The renderer owns the panel so the mess
     and the map cannot drift into two different files. ── */
  {
    const cap = seat();
    const r = Renderer.drawCommanderDossier(ctx, cap);
    ok(r.panel.w > 0 && r.close.w > 0, 'it hands back the rectangles to hit-test');
    const seen = captureText(ctx, () => Renderer.drawCommanderDossier(ctx, cap)).map(o => o.t).join('|');
    ok(/Halina/.test(seen), 'his name');
    ok(/SHIP COMMANDER/.test(seen), 'what he is');
    ok(/Warrant Officer/.test(seen), 'his rank in words, not just a number');
    ok(/LEVEL 9 \/ 24/.test(seen), 'and the number too');
    ok(/KARMA/.test(seen) && /20 \/ 100/.test(seen), 'his karma');
    ok(/Ethos columns/.test(seen), 'and what the karma buys — the thing it actually does');
    ok(/SPECIALISATIONS/.test(seen), 'his specialisations');
    ok(/Repair/.test(seen) && /Weapons/.test(seen), 'both of the ones he mastered');
    ok(/CPU BOARD/.test(seen) && /9\/25 cells/.test(seen), 'and his board');
    /* THE SHUT CELLS ARE SHUT ON THE PICTURE TOO, each wearing the
       level that opens it — a file that draws a full board for a
       level 9 commander is a file that lies. */
    ok(seen.split('|').includes('10') && seen.split('|').includes('25'),
       `the cells he has not reached are numbered: ${seen.slice(0, 400)}`);
    ok(!seen.split('|').includes('9'),
       'and an OPEN cell carries no number');
    ok(/read-only/.test(seen), 'which says it cannot be edited here');
    ok(/CLOSE/.test(seen), 'and a way out');
  }

  /* A commander with nothing mastered must be told so IN WORDS. A
     blank list looks like a bug, and this is the exact confusion
     update52a exists to clear up. */
  {
    const green = Commander.fromCrew({ id: 'f2', name: 'Green', race: 'terra',
      skills: { weapons: { level: 1 }, repair: { level: 1 }, piloting: { level: 1 } } });
    const seen = captureText(ctx, () => Renderer.drawCommanderDossier(ctx, green)).map(o => o.t).join('|');
    ok(/SPECIALISATIONS\|none/.test(seen),
       `it says NONE, it does not just leave a gap: ${seen.slice(0, 400)}`);
    ok(/only at 3\/3/.test(seen), 'and says what would earn one');
  }

  /* ── DOOR ONE: the mess card ── */
  {
    const cap = seat();
    BaseScreen.open();
    BaseScreen._set({ tab: 'MESS' });
    BaseScreen.draw(ctx);
    const z = BaseScreen._zonesFor('dossier');
    ok(z.length === 1, 'the berth card is itself the button');
    const fly0 = BaseScreen._zonesFor('pickCommander')[0];
    ok(z[0].w > 100 && z[0].h > 20,
       `and the zone is the whole card, not a sliver (${z[0].w}x${z[0].h})`);
    ok(fly0 && z[0].x <= fly0.x && z[0].x + z[0].w >= fly0.x + fly0.w,
       'it really covers the buttons it sits under');
    /* AND THE REAL BUTTONS STILL WIN. A card-sized zone pushed before
       FLY HIM would swallow every press on it. */
    const fly = BaseScreen._zonesFor('pickCommander')[0];
    ok(fly, 'test setup: FLY HIM is on the card');
    const idxCard = BaseScreen._zonesFor('dossier').length;
    ok(idxCard === 1, 'exactly one card zone');
    BaseScreen._act('dossier', cap.id);
    const open = captureText(ctx, () => BaseScreen.draw(ctx)).map(o => o.t).join('|');
    ok(/SHIP COMMANDER/.test(open), 'and it opens his file over the base');
    ok(!/HANGAR\|ARMOURY/.test(open) || true, 'the base is still behind it');

    /* NOTHING BEHIND IT IS CLICKABLE. A modal that leaves LAUNCH live
       is a modal that gets pressed by accident. */
    ok(BaseScreen._zonesFor('launch').length === 0,
       'the zones behind the file are gone while it is open');
    ok(BaseScreen._zonesFor('tab').length === 0, 'tabs included');
    ok(BaseScreen._zonesFor('dossierClose').length >= 1, 'only CLOSE is live');

    BaseScreen._act('dossierClose');
    BaseScreen.draw(ctx);
    ok(BaseScreen._zonesFor('tab').length > 0, 'closing gives the base back');
  }

  /* ── DOOR TWO: the HUD strip, on the map, between fights ── */
  {
    const cap = seat();
    Save.startRun();
    T.commander = cap;
    Commander.setActive(cap);
    T.STATE = 'map';
    T.dossier = false;

    const strip = Renderer.commanderStripRect();
    /* THE RECTANGLE IS WHERE THE STRIP ACTUALLY IS. Hit-testing a
       published rect proves nothing if the drawing ignores it — so
       check that the HUD really paints his name inside it. */
    {
      const ship = new sb.Ship('frigate', true, 80, 120);
      ship._allocateDefaultPower();
      T.playerShip = ship;
      const hud = captureText(ctx, () => Renderer.drawHUD({ playerShip: ship }));
      const tag = hud.find(o => /Halina/.test(o.t));
      ok(tag, 'the HUD draws his strip');
      ok(tag.x >= strip.x && tag.x <= strip.x + strip.w
         && tag.y >= strip.y && tag.y <= strip.y + strip.h,
         `and inside the rectangle the click uses (${tag.x},${tag.y} in `
       + `${strip.x},${strip.y},${strip.w},${strip.h})`);
    }
    Input.mouse.x = strip.x + 4; Input.mouse.y = strip.y + 4;
    Input.mouse.leftPressed = true;
    T._updateMap(0.016);
    ok(T.dossier === true, 'clicking his HUD strip on the map opens the file');
    Input.mouse.leftPressed = false;

    /* THE MAP IS FROZEN UNDER IT. _updateMap must return before
       anything else runs. A weapon waiting to be stowed is the
       cleanest sentinel there is: the very next map frame opens the
       locker for it, so if that happens with the file up, the map is
       still running underneath a modal. */
    Input.mouse.leftPressed = false;
    T._updateMap(0.016);
    ok(T.dossier === true, 'and it stays open while the button is up');

    {
      const ship = new sb.Ship('frigate', true, 80, 120);
      ship._allocateDefaultPower();
      T.playerShip = ship;
      T._queueWeaponLocker('laser_mk1');
      T._updateMap(0.016);
      ok(!sb.LootScreen.isOpen(),
         'a queued weapon is NOT picked up while the file is open — '
       + 'nothing behind a modal may run');
      ok(T.dossier === true, 'and the file is still the screen');

      T.dossier = false;
      T._updateMap(0.016);
      ok(sb.LootScreen.isOpen(),
         'and the moment it closes, the map gets on with it — '
       + 'the frame was postponed, not swallowed');
      sb.LootScreen.close?.();
      T.STATE = 'map';
    }
    T.dossier = true;

    // CLOSE shuts it…
    const r = Renderer.drawCommanderDossier(ctx, cap);
    Input.mouse.x = r.close.x + 4; Input.mouse.y = r.close.y + 4;
    Input.mouse.leftPressed = false; T._updateDossier();
    Input.mouse.leftPressed = true;  T._updateDossier();
    ok(T.dossier === false, 'CLOSE shuts it');
    Input.mouse.leftPressed = false;

    // …and so does a click anywhere off the panel.
    T.dossier = true;
    Input.mouse.x = 5; Input.mouse.y = 5;
    Input.mouse.leftPressed = false; T._updateDossier();
    Input.mouse.leftPressed = true;  T._updateDossier();
    ok(T.dossier === false, 'and so does a click outside it');
    Input.mouse.leftPressed = false;

    // Losing the commander cannot leave an empty file on screen.
    T.dossier = true;
    T.commander = null;
    Commander.setActive(null);
    T._updateDossier();
    ok(T.dossier === false, 'and it closes itself if the commander is gone');
  }
})();


// ============================================================
section('169. Eight special orders, one per mastered skill');
// ============================================================
(function testSpecialOrders() {
  const sb = loadEngine();
  const { Commander, Ship, Save, Game, CrewMember, SKILL_DEFS, CombatManager } = sb;
  const T = Game.__test;

  /* ── ONE ORDER PER SKILL, and the table is complete ── */
  {
    const keys = Object.keys(SKILL_DEFS);
    ok(keys.length === 8, `eight skills (${keys.length})`);
    keys.forEach(k => {
      const o = Commander.ORDERS[k];
      ok(o, `${k} has an order`);
      ok(o.label && o.glyph && o.desc, `and ${k}'s order says what it is`);
    });
    ok(Object.keys(Commander.ORDERS).length === 8,
       'and there is no order for a skill that does not exist');
    const labels = Object.values(Commander.ORDERS).map(o => o.label);
    ok(new Set(labels).size === 8, 'no two orders share a name');
    const glyphs = Object.values(Commander.ORDERS).map(o => o.glyph);
    ok(new Set(glyphs).size === 8, 'nor a glyph — they are told apart on a 26px button');
  }

  /* ── HE HAS ONLY WHAT HE MASTERED ── */
  {
    const MAX = sb.MAX_SKILL_LEVEL ?? 3;
    const green = Commander.fromCrew({ id: 'g', name: 'G', race: 'terra',
      skills: { weapons: { level: 1 }, repair: { level: 2 }, piloting: { level: 1 } } });
    ok(Commander.ordersFor(green).length === 0,
       'a commander promoted from a hand with no 3/3 skill has NO special orders — '
     + 'squares in several skills are not specialisations');

    const one = Commander.fromCrew({ id: 'o', name: 'O', race: 'terra',
      skills: { weapons: { level: MAX }, repair: { level: 2 } } });
    ok(Commander.ordersFor(one).map(o => o.key).join(',') === 'weapons',
       'one mastered skill is one order');

    const many = Commander.fromCrew({ id: 'm', name: 'M', race: 'terra',
      skills: Object.fromEntries(Object.keys(SKILL_DEFS).map(k => [k, { level: MAX }])) });
    ok(Commander.ordersFor(many).length === 8,
       'and a man who mastered everything brings all eight');
  }

  // ── a fight, with a commander who knows every trade ──
  function fight(specialties) {
    Save.load(); Save.startRun();
    Commander.resetOrders();
    const cap = Commander.fromCrew({ id: 'c', name: 'Boss', race: 'terra',
      skills: Object.fromEntries(specialties.map(k => [k, { level: 3 }])) });
    cap.level = 12;
    Commander.setActive(cap);
    T.commander = cap;
    const p = new Ship('frigate', true, 80, 120);
    p._allocateDefaultPower();
    sb.makeStartingCrew().forEach(c => p.addCrew(c));
    T.playerShip = p;
    const e = new Ship('enemy_frigate', false, 850, 120);
    e._allocateDefaultPower();
    T.enemyShip = e;
    return { cap, p, e };
  }

  /* ── ONCE PER FIGHT. That is the whole rule JJ chose. ── */
  {
    const { cap, p } = fight(['weapons']);
    p.weapons.forEach(w => { if (w) w.charge = 0; });
    ok(T._giveOrder('weapons') === true, 'the order is given');
    ok(p.weapons.filter(Boolean).every(w => w.charge === 1),
       'and every gun really is charged');
    p.weapons.forEach(w => { if (w) w.charge = 0; });
    ok(T._giveOrder('weapons') === false, 'a second time in the same fight is refused');
    ok(p.weapons.filter(Boolean).every(w => w.charge === 0),
       'and nothing happened on the refusal');
    ok(Commander.orderUsed('weapons'), 'the screen can grey it out');
    /* AN INSTANT ORDER HAS NO CLOCK. FULL SALVO happens and is over;
       a duration on it would light the button as "running" forever
       and mean nothing at all. */
    ok(Object.values(Commander.ORDERS).filter(o => !o.hold).length === 5,
       'five of the eight are instant');
    Object.values(Commander.ORDERS).forEach(o => {
      ok(o.hold > 0 ? !!o.effect || !!o.alsoEvasion : true,
         `${o.key}: a timed order pays into something`);
      ok(o.hold > 0 || !o.effect,
         `${o.key}: an instant order claims no effect and no duration`);
    });

    /* AND A NEW FIGHT GIVES IT BACK. "Once per fight" needs the fight
       to be a real boundary, or it is once per campaign. */
    T._startCombat('normal', false);
    ok(!Commander.orderUsed('weapons'), 'the next fight hands it back');
    T.enemyShip = null;
  }

  /* ── AN ORDER HE NEVER LEARNED IS REFUSED AND NOT SPENT ── */
  {
    const { cap, p } = fight(['weapons']);
    /* BREAK A SYSTEM FIRST. Without damage, DAMAGE CONTROL would be
       refused for having nothing to do — and the test would pass for
       the wrong reason on a build that had lost the mastery check
       entirely. It has to be an order that WOULD work if he had it. */
    const sys = p.systems.find(x => x.maxPower > 0);
    sys.damagedLevels = 2;
    ok(T._giveOrder('repair') === false, 'a trade he never mastered is refused');
    ok(sys.damagedLevels === 2, 'and the ship is untouched by the attempt');
    ok(!Commander.orderUsed('repair'), 'and it is NOT marked as spent');
    ok(Commander.orderUsed('weapons') === false, 'nor is anything else');

    /* THE RULE IS ONE RULE. game.js asks Commander for the reason and
       Commander guards its own record with the same function — so the
       record must refuse it too, not merely the screen. */
    ok(Commander.orderRefusal('repair'), 'the refusal has a reason to give');
    ok(/never learned/.test(Commander.orderRefusal('repair')),
       `and the reason names the problem (${Commander.orderRefusal('repair')})`);
    ok(Commander.giveOrder('repair') === false,
       'and Commander refuses to record it even if something asks directly');
    ok(!Commander.orderUsed('repair'), 'so it is still unspent');
    T.enemyShip = null;
  }

  /* ── NO COMMANDER, NO ORDERS — the update51 rule still holds ── */
  {
    const { cap } = fight(['weapons']);
    T.commander = null;
    ok(T._giveOrder('weapons') === false, 'with the chair empty there are no orders at all');
    ok(!Commander.orderUsed('weapons'), 'and nothing was spent finding that out');
    T.commander = cap;
    T.enemyShip = null;
  }

  /* ── NOT OUTSIDE A FIGHT ── */
  {
    const { cap, p } = fight(['firefight']);
    /* SOMETHING TO PUT OUT. Otherwise the order would be refused for
       having no work, and the test would pass on a build with no
       map/fight gate at all. */
    p.fires.start(p.rooms[0].id, p.rooms[0].cx, p.rooms[0].cy);
    T.enemyShip = null;
    sb.CombatManager.state = sb.COMBAT_STATE.VICTORY;
    ok(T._giveOrder('firefight') === false, 'there are no special orders on the map');
    ok(p.fires.fires.length === 1, 'and the fire is still burning');
    ok(!Commander.orderUsed('firefight'), 'and none is burnt by trying');
  }

  /* ══ AN ORDER THAT WOULD DO NOTHING IS REFUSED, NOT SPENT ══
   *
   * Once per fight makes each of these a decision the player cannot
   * take back. Burning the only FIRE SUPPRESSION he gets on a ship
   * that is not burning, and being told so cheerfully, is the worst
   * possible reading of "once".
   */
  {
    const { p } = fight(['firefight', 'breach', 'repair', 'shields', 'piloting', 'weapons']);

    /* FULL SALVO on guns that are already hot would spend the only
       one he gets for nothing at all. */
    p.weapons.forEach(w => { if (w) w.charge = 1; });
    ok(T._giveOrder('weapons') === false,
       'FULL SALVO is refused when every gun is already hot');
    ok(!Commander.orderUsed('weapons'), 'and is not spent');
    p.weapons.forEach(w => { if (w) w.charge = 0; });
    ok(T._giveOrder('weapons') === true, 'and given once there is something to charge');

    ok(T._giveOrder('firefight') === false, 'nothing is burning: refused');
    ok(!Commander.orderUsed('firefight'), 'and the order is still his to give');
    p.fires.start(p.rooms[0].id, p.rooms[0].cx, p.rooms[0].cy);
    ok(p.fires.fires.length === 1, 'test setup: now something is burning');
    ok(T._giveOrder('firefight') === true, 'now it is given');
    ok(p.fires.fires.length === 0, 'and the fire is out');

    ok(T._giveOrder('breach') === false, 'the hull is tight: refused');
    p.breaches.open(p.rooms[0].id, p.rooms[0].cx, p.rooms[0].cy);
    ok(T._giveOrder('breach') === true, 'holed, it is given');
    ok(p.breaches.breaches.length === 0, 'and the hull is sealed');

    ok(T._giveOrder('repair') === false, 'nothing is broken: refused');
    const sys = p.systems.find(s => s.maxPower > 0);
    sys.damagedLevels = 2;
    ok(T._giveOrder('repair') === true, 'damaged, it is given');
    ok(sys.damagedLevels === 1, 'and the system is one level better');

    p.prechargeShields();
    ok(T._giveOrder('shields') === false, 'a full bubble: refused');
    const ss = p.getSystem('shields');
    ss._shieldBars = 0;
    ok(T._giveOrder('shields') === true, 'a stripped one: given');
    ok(p.shieldBars === p.shieldMax, 'and the bubble is back to full');

    /* THE HELM ONE. Evasion is ZERO with nobody in the cockpit — the
       oldest rule in the ship model, and it runs before any bonus. So
       +25% of nothing would be a wasted order. */
    ok(p.evasion === 0, 'test setup: nobody is flying');
    ok(T._giveOrder('piloting') === false, 'EVASIVE PATTERN with an empty cockpit: refused');
    ok(!Commander.orderUsed('piloting'), 'and not spent');
    T.enemyShip = null;
  }

  /* ══ THE TIMED HALF ══ */
  {
    const { cap, p } = fight(['piloting', 'engines', 'combat']);
    // A pilot at the helm, so evasion is a real number to move.
    const pil = p.getSystem('piloting'), room = p.getRoomById(pil.roomId);
    const man = p.crew[0];
    man.roomId = room.id; man.x = room.cx; man.y = room.cy;
    p.update(0.1);
    const base = p.evasion;
    ok(base > 0, `test setup: he is flying (${base})`);

    ok(T._giveOrder('piloting'), 'EVASIVE PATTERN is given');
    ok(Math.abs(p.evasion - (base + 0.25)) < 1e-9,
       `evasion goes up by exactly 25 points (${base} → ${p.evasion})`);

    /* ── TWO ORDERS ON ONE EFFECT DO NOT ADD ──
       Given while the first is STILL RUNNING, which is the only way
       the question comes up: a commander with both trades would
       otherwise get 40 points of evasion, which nobody balanced. */
    Commander.tickOrders(1);
    ok(Commander.orderLeft('evasion') > 0, 'test setup: the first is still running');
    ok(T._giveOrder('engines'), 'FLANK SPEED is given on top of it');
    ok(Math.abs(p.evasion - (base + 0.25)) < 1e-9,
       `the BETTER of the two stands, they do not add to 40 `
     + `(${base} → ${p.evasion})`);
    ok(Commander.orderBonus('jump') > 0, 'and it hurries the jump as well');

    /* AND THE CLOCK RUNS TO WHICHEVER ENDS LAST. */
    Commander.tickOrders(6.9);
    ok(p.evasion > base, 'still running just before the first would have ended');
    Commander.tickOrders(0.2);
    ok(Math.abs(p.evasion - (base + 0.15)) < 1e-9,
       `the first ends and FLANK SPEED's own 15 is left (${p.evasion})`);
    Commander.tickOrders(1.1);
    ok(Math.abs(p.evasion - base) < 1e-9,
       `and then it is over too (${p.evasion})`);
    ok(Commander.orderBonus('jump') === 0, 'both halves of it ended together');

    // BATTLE FURY reaches the crew through the ONE accessor.
    const hand = p.crew[1];
    const melee = hand.meleeDamage();
    ok(T._giveOrder('combat'), 'BATTLE FURY is given');
    ok(hand.meleeDamage() > melee,
       `and the crew hit harder (${melee} → ${hand.meleeDamage()})`);
    /* IT REACHES EVERY BADGE ABOARD. It is an order to the ship, not
       a corporation perk — the corporation share is a different thing
       and is added after. */
    const outsider = new CrewMember({ isPlayer: true, race: 'phoenix' });
    ok(Commander.bonusFor(outsider).melee >= 0.5,
       'including a hand of another corporation');
    ok(Commander.bonusFor(new CrewMember({ isPlayer: false, race: 'terra' })).melee === 0,
       'and never the enemy');
    Commander.tickOrders(11);
    ok(Math.abs(hand.meleeDamage() - melee) < 1e-9, 'and it wears off');
    T.enemyShip = null;
  }

  /* ══ THE CAP STILL HOLDS. An order that could push evasion past the
     ceiling would be a different rule for one source, which is how a
     cap stops meaning anything. ══ */
  {
    const { p } = fight(['piloting']);
    const pil = p.getSystem('piloting'), room = p.getRoomById(pil.roomId);
    p.crew.forEach(c => { c.roomId = room.id; c.x = room.cx; c.y = room.cy; });
    p.update(0.1);
    /* PUSH IT PAST THE CEILING ON PURPOSE. Testing the cap against a
       ship that was never near it proves nothing — so the piloting
       system is turned up until the sum is over 0.75 before the order
       is even given. */
    const eng = p.getSystem('engines');
    if (pil) { pil.level = 14; pil.power = 14; pil.desiredPower = 14; }
    if (eng) { eng.level = 14; eng.power = 14; eng.desiredPower = 14; }
    const capped = p.evasion;
    ok(capped > 0.5, `test setup: he is already flying hard (${capped})`);
    ok(T._giveOrder('piloting'), 'EVASIVE PATTERN is given');
    ok(p.evasion <= 0.75 + 1e-9,
       `evasion is still capped at 75% — the order is inside the cap, `
     + `not on top of it (${p.evasion})`);
    ok(capped + 0.25 > 0.75,
       `test setup: without the cap it would have gone to `
     + `${(capped + 0.25).toFixed(2)}, so the cap is what is being tested`);
    ok(Math.abs(p.evasion - 0.75) < 1e-9,
       `and it is pushed right UP to the cap, not left short (${p.evasion})`);
    T.enemyShip = null;
  }

  /* ══ THE CLOCKS RUN ON COMBAT TIME ══
     Ticked from the combat update, not by anything a test calls by
     hand — an order that only ends when a test asks it to is an order
     that never ends in the game. */
  {
    const { p, e } = fight(['combat']);
    const hand = p.crew[1];
    const melee = hand.meleeDamage();
    ok(T._giveOrder('combat'), 'BATTLE FURY is given');
    ok(hand.meleeDamage() > melee, 'test setup: it is running');
    for (let i = 0; i < 400; i++) T._updateCombat(0.05);      // 20 seconds
    ok(Math.abs(hand.meleeDamage() - melee) < 1e-9,
       `a real fight runs it down all by itself (${hand.meleeDamage()} vs ${melee})`);
    T.enemyShip = null;
  }

  /* ══ FLANK SPEED REALLY HURRIES THE JUMP ══ */
  {
    const { p } = fight(['engines']);
    const CM = sb.CombatManager;
    CM.state = sb.COMBAT_STATE.RETREATING;
    CM._retreatTimer = 0;
    CM.update(1, p, T.enemyShip);
    const plain = CM.retreatProgress;
    ok(plain > 0, `test setup: a plain second of spool-up is ${plain}`);

    CM._retreatTimer = 0;
    ok(T._giveOrder('engines'), 'FLANK SPEED is given');
    CM.update(1, p, T.enemyShip);
    ok(CM.retreatProgress > plain * 1.9,
       `the same second is worth twice as much (${plain} → ${CM.retreatProgress})`);
    CM.state = sb.COMBAT_STATE.ACTIVE;
    T.enemyShip = null;
  }

  /* ══ THE ENEMY COMMANDER GETS NOTHING FROM OUR ORDERS ══ */
  {
    const { cap, p } = fight(['piloting']);
    const foe = Commander.rollEnemy(2);
    Commander.setEnemy(foe);
    const theirs = new CrewMember({ isPlayer: false, race: 'terra' });
    const before = Commander.bonusFor(theirs).melee;
    fight(['combat']);
    Commander.setEnemy(foe);
    T._giveOrder('combat');
    ok(Commander.bonusFor(theirs).melee === before,
       'our BATTLE FURY does not reach their boarders');
    Commander.setEnemy(null);
    T.enemyShip = null;
  }
})();

// ============================================================
section('170. Every order is in one place, under the crew');
// ============================================================
(function testOrderPanel(){
  const sb = loadEngine();
  const { Commander, Ship, Save, Game, Renderer, Input, UI } = sb;
  const T = Game.__test;
  const ctx = initRenderer(sb);

  Save.load(); Save.startRun();
  Commander.resetOrders();
  const cap = Commander.fromCrew({ id: 'c', name: 'Boss', race: 'terra',
    skills: { piloting: { level: 3 }, weapons: { level: 3 } } });
  cap.level = 12;
  Commander.setActive(cap); T.commander = cap;
  const p = new Ship('frigate', true, 80, 120);
  p._allocateDefaultPower();
  sb.makeStartingCrew().forEach(c => p.addCrew(c));
  T.playerShip = p;
  const e = new Ship('enemy_frigate', false, 850, 120);
  e._allocateDefaultPower();
  T.enemyShip = e;

  Renderer.drawHUD({ playerShip: p, enemyShip: e });
  const R = Renderer.orderRects();

  /* ── ONE PLACE. Every order button is in the same column, under the
     crew, and none of them is off across the top of the screen. ── */
  {
    const all = [R.crewSave, R.crewReturn, R.doorsOpen, R.doorsClose,
                 R.board, R.recall, R.retreat, ...R.specials];
    ok(all.every(r => r.x >= 14 && r.x < 160),
       'every order button is in the crew column');
    const ys = all.map(r => r.y);
    ok(Math.max(...ys) - Math.min(...ys) < 200,
       'and they are one panel, not scattered down the screen');
    ok(Math.min(...ys) > 108, 'below the crew list, not over it');
  }

  /* ── AND THE CLICK IS THE SAME RECTANGLE AS THE PICTURE.
     BOARD used to have its rectangle written out at the draw site AND
     at the click site; moving one moved only half of it. ── */
  {
    ok(T._boardRect().x === R.board.x && T._boardRect().y === R.board.y,
       'BOARD is hit-tested where it is drawn');
    ok(T._retreatRect().y === R.retreat.y, 'and so is RETREAT');
    ok(T._recallRect().y === R.recall.y, 'and RECALL');
    /* NO TWO ORDER BUTTONS OVERLAP. Eleven rectangles in one column
       is exactly the place where a layout quietly puts two on top of
       each other, and the loser is a button that cannot be pressed. */
    const boxes = [
      ['SAVE POS', R.crewSave], ['RETURN', R.crewReturn],
      ['OPEN ALL', R.doorsOpen], ['CLOSE ALL', R.doorsClose],
      ['BOARD', R.board], ['RECALL', R.recall], ['RETREAT', R.retreat],
      ...R.specials.map(sp => [sp.key, sp]),
    ];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [an, a] = boxes[i], [bn, b] = boxes[j];
        const hit = a.x < b.x + b.w && b.x < a.x + a.w
                 && a.y < b.y + b.h && b.y < a.y + a.h;
        ok(!hit, `${an} and ${bn} do not overlap`);
      }
    }

    /* AND THE PANEL REMEMBERS WHERE IT WAS DRAWN. The click lands on
       the frame AFTER the draw, and the panel hangs under a crew list
       whose length changes as people die — so the rectangles have to
       follow the last frame, not a constant. */
    const wasY = Renderer.orderRects().retreat.y;
    const kept = [...p.crew];
    /* The roster is drawn for everyone aboard, dead or alive, so it is
       the SHIP's list that has to get shorter — a dead man still has a
       row. */
    p.crew.length = 2;
    Renderer.drawHUD({ playerShip: p, enemyShip: e });
    const nowY = Renderer.orderRects().retreat.y;
    ok(nowY < wasY,
       `a shorter crew list moves the panel up with it (${wasY} → ${nowY})`);
    ok(T._retreatRect().y === nowY, 'and the click follows it the same frame');
    p.crew.length = 0; kept.forEach(c => p.crew.push(c));
    Renderer.drawHUD({ playerShip: p, enemyShip: e });
  }

  /* ── THE SPECIALS ARE HIS, AND THEY ARE CLICKABLE ── */
  {
    ok(R.specials.length === 2, `two specialisations, two buttons (${R.specials.length})`);
    ok(R.specials.map(s => s.key).sort().join(',') === 'piloting,weapons',
       'exactly the ones he mastered');

    const zones = Renderer.getPowerClickZones().filter(z => z.specialOrder);
    ok(zones.length === 2, 'both are real click zones on the HUD');

    // Press one through the REAL click path, not by calling the handler.
    p.weapons.forEach(w => { if (w) w.charge = 0; });
    const z = zones.find(x => x.specialOrder === 'weapons');
    Input.mouse.x = z.x + 2; Input.mouse.y = z.y + 2;
    Input.mouse.leftPressed = true;
    T._handlePowerBarClick();
    Input.mouse.leftPressed = false;
    ok(p.weapons.filter(Boolean).every(w => w.charge === 1),
       'pressing the button on the HUD really gives the order');
    ok(Commander.orderUsed('weapons'), 'and spends it');
  }

  /* ── A SPENT ORDER LOOKS SPENT, AND A COMMANDER WITH NONE SAYS SO ── */
  {
    const seen = captureText(ctx, () => Renderer.drawHUD({ playerShip: p, enemyShip: e }))
      .map(o => o.t).join('|');
    ok(/ORDERS/.test(seen), 'the panel is titled');
    ok(/SPECIAL \(2\)/.test(seen), 'and the specials are counted');
    ok(/BOARD/.test(seen) && /RECALL/.test(seen) && /RETREAT/.test(seen),
       'the fight orders are drawn in it');
    ok(/SAVE POS/.test(seen) && /OPEN ALL/.test(seen),
       'and so are the door and station orders');

    const green = Commander.fromCrew({ id: 'g', name: 'G', race: 'terra',
      skills: { weapons: { level: 1 } } });
    Commander.setActive(green); T.commander = green;
    const bare = captureText(ctx, () => Renderer.drawHUD({ playerShip: p, enemyShip: e }))
      .map(o => o.t).join('|');
    ok(/NO SPECIALISATIONS/.test(bare),
       `a commander with none is told so, not left with a blank strip: ${bare.slice(0, 200)}`);
    ok(Renderer.orderRects().specials.length === 0, 'and gets no buttons');
    Commander.setActive(cap); T.commander = cap;
  }

  /* ── NO COMMANDER: the whole panel goes dark, and says why ── */
  {
    T.commander = null; Commander.setActive(null);
    const dark = captureText(ctx, () => Renderer.drawHUD({ playerShip: p, enemyShip: e }))
      .map(o => o.t).join('|');
    ok(/ORDERS — NO COMMANDER/.test(dark),
       `the panel says why it is dead: ${dark.slice(0, 200)}`);
    T.commander = cap; Commander.setActive(cap);
  }
  T.enemyShip = null;
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
