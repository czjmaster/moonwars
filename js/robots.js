/* ══ ROBOTS (update257) ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * jj 22.11: „4 roboty (po jednym na korporację); warianty: lepsza naprawa, lepsza obsługa modułów (zastępuje
 * załoganta), lepsza walka. HP i zapas energii; bez energii — ładowanie przy reaktorze (trwa). Robot do myśliwca
 * i do statku głównego."
 *
 * A robot is a CrewMember with `isRobot` — it walks, works a console, mends, fights and flies the fighter through the
 * same code as a man. What is its own:
 *   · no lungs and no stomach: it takes no air from the ship and never goes hungry; a vented room is nothing to it;
 *   · no medbay: it is mended at the REACTOR, while it charges;
 *   · ENERGY: it runs down as it works (faster when it walks or works, slowly when it stands); under a fifth it
 *     walks to the reactor by itself, charges there, mends, and goes back to where it was; empty, it crawls and
 *     works at a third of its speed;
 *   · its skills are built in — it does not learn, it is not promoted, it has no captain's blessing;
 *   · knocked down it is not wounded but WRECKED: no stretcher, no headstone, no plague in its frame.
 * Four makers, one a corporation, each with its trait; three kinds, each with its trade.
 */
const ROBOT = {
  ENERGY: 100,
  DRAIN_IDLE: 0.18,        // a second, standing by
  DRAIN_WORK: 0.42,        // …more, walking or working
  LOW: 20,                 // it goes to charge under this
  FULL: 98,
  CHARGE: 6,               // a second, at the reactor
  MEND: 1.5,               // HP a second while it charges
  EMPTY_PACE: 0.35,        // its speed and its work, flat
  OVERRIDE_CD: 15,         // ordered away from the charger: it obeys this long before it goes again
  PRICE: { repair: 150, operator: 170, combat: 160 },
};

/* the makers: one a corporation (jj: „po jednym na korporację") */
const ROBOT_MODELS = {
  aquarius: { model: 'HYDRA',   trait: 'frugal: uses a quarter less energy', drain: 0.75 },
  phoenix:  { model: 'EMBER',   trait: 'fast charge: half as fast again at the reactor', charge: 1.5 },
  terra:    { model: 'BASTION', trait: 'armoured: 25% more frame', hp: 1.25 },
  pegasus:  { model: 'ZEPHYR',  trait: 'long cell: 30% more energy', energy: 1.3 },
};

/* the trades */
const ROBOT_KINDS = {
  repair:   { label: 'Repair unit',   letter: 'R', hp: 80,  skills: { repair: 3, firefight: 2 },
              blurb: 'mends modules and hull holes, puts out fires' },
  operator: { label: 'Operator unit', letter: 'O', hp: 80,  skills: { piloting: 2, weapons: 2, engines: 2, shields: 2 },
              blurb: 'runs any console as well as a trained hand' },
  combat:   { label: 'Combat unit',   letter: 'C', hp: 120, skills: { combat: 3 },
              blurb: 'holds a corridor against boarders' },
};

const Robots = (() => {
  const isRobot = (c) => !!c?.isRobot;
  const model = (c) => ROBOT_MODELS[c?.race] ?? ROBOT_MODELS.aquarius;
  const kind = (c) => ROBOT_KINDS[c?.robotKind] ?? ROBOT_KINDS.repair;
  function energyMax(c) { return ROBOT.ENERGY * (model(c).energy ?? 1); }

  /** A new robot of this maker and this trade. `serial` makes its name (HYDRA R-07). */
  function make(race, robotKind, opts = {}) {
    const K = ROBOT_KINDS[robotKind] ?? ROBOT_KINDS.repair, M = ROBOT_MODELS[race] ?? ROBOT_MODELS.aquarius;
    const serial = opts.serial ?? (1 + Math.floor(Math.random() * 98));
    const skills = {};
    Object.entries(K.skills).forEach(([k, l]) => { skills[k] = { level: l, xp: 0 }; });
    const hp = Math.round(K.hp * (M.hp ?? 1));
    return new CrewMember({
      name: opts.name ?? `${M.model} ${K.letter}-${String(serial).padStart(2, '0')}`,
      race, isRobot: true, robotKind, skills, maxHp: hp, baseMaxHp: hp, isPlayer: opts.isPlayer ?? true,
    });
  }

  /** A yard's robot on the bar's board (station.js): its fee rides on the item. */
  function offer(rnd, sector = 1, race = null) {
    const r = rnd ?? Math.random;
    const races = Object.keys(ROBOT_MODELS), kinds = Object.keys(ROBOT_KINDS);
    const rc = race ?? races[Math.floor(r() * races.length) % races.length];
    const kd = kinds[Math.floor(r() * kinds.length) % kinds.length];
    const member = make(rc, kd, { serial: 1 + Math.floor(r() * 98) });
    return { name: member.name, skill: Object.keys(ROBOT_KINDS[kd].skills)[0], sold: false, member, robot: true,
             fee: ROBOT.PRICE[kd] + 15 * Math.max(0, sector - 1) };
  }

  /** Where it charges: the reactor's room of the hull it belongs to. */
  function chargerOf(ship) {
    const sys = ship?.systems?.find(s => s.type === 'reactor');
    const room = sys ? ship.getRoomById(sys.roomId) : (ship?.rooms ?? []).find(r => r.type === 'reactor');
    return room ?? null;
  }
  function chargerWorks(ship) {
    const sys = ship?.systems?.find(s => s.type === 'reactor');
    return !sys || (sys.workingLevels ?? 1) > 0;
  }

  /** Its clock, run from CrewMember.update. */
  function tick(c, dt, ship) {
    if (!isRobot(c) || c.dead || c.dying || !(dt > 0)) return;
    const max = energyMax(c);
    if (!Number.isFinite(c.energy)) c.energy = max;
    c.air = c.airMax ? c.airMax() : c.air;            // nothing to breathe, nothing to run out of
    c.hunger = 100;
    if (c._chargeCd > 0) c._chargeCd -= dt;
    const home = ship && ship.isPlayer === c.isPlayer ? ship : null;     // it charges only aboard its own hull
    const room = home ? chargerOf(home) : null;
    const moving = (c._waypoints?.length ?? 0) > 0;
    const working = c.task && c.task !== 'idle';
    /* AT THE CHARGER: standing in the reactor room, sent there to charge */
    if (c._charging && room && c.roomId === room.id && !moving) {
      if (chargerWorks(home)) {
        c.energy = Math.min(max, c.energy + ROBOT.CHARGE * (model(c).charge ?? 1) * dt);
        if (c.hp < c.maxHp && c.state !== 'injured') c.hp = Math.min(c.maxHp, c.hp + ROBOT.MEND * dt);
      }
      if (c.energy >= max * ROBOT.FULL / 100) done(c, home);
      return;
    }
    c.energy = Math.max(0, c.energy - (moving || working ? ROBOT.DRAIN_WORK : ROBOT.DRAIN_IDLE) * (model(c).drain ?? 1) * dt);
    /* ORDERED AWAY on the way to the charger: it obeys, for a while */
    if (c._charging && room && c.homeRoomId !== room.id) { c._charging = false; c._chargeCd = ROBOT.OVERRIDE_CD; return; }
    if (!c._charging && room && c.energy < max * ROBOT.LOW / 100 && !(c._chargeCd > 0) && !c._inFighter && c.alive) go(c, home, room);
  }
  function go(c, ship, room) {
    c._charging = true;
    c._chargeFrom = { roomId: c.homeRoomId ?? c.roomId };
    c.homeRoomId = room.id;
    const [tx, ty] = ship.stationSlot(room, 2);
    c.moveToOnShip(ship, tx, ty);
    if (c.isPlayer && typeof UI !== 'undefined') UI.notify?.(`${c.name} is low on power — off to the reactor to charge.`, 'info');
  }
  function done(c, ship) {
    c._charging = false;
    const back = c._chargeFrom?.roomId != null ? ship.getRoomById(c._chargeFrom.roomId) : null;
    c._chargeFrom = null;
    if (back && back.id !== c.roomId) {
      c.homeRoomId = back.id;
      const [tx, ty] = ship.stationSlot(back, 1);
      c.moveToOnShip(ship, tx, ty);
    }
  }
  /** How hard it can work (CrewMember.effortFactor): flat out, or a third of it on an empty cell. */
  function effort(c) { return (c.energy ?? 1) <= 0 ? ROBOT.EMPTY_PACE : 1; }
  function energyFrac(c) { return Utils.clamp((c.energy ?? energyMax(c)) / energyMax(c), 0, 1); }

  /* ── THE PICTURE ───────────────────────────────────────────
   * Drawn in code, by maker (shape) and trade (the tool on its arm): HYDRA a dome, EMBER a wedge, BASTION a block,
   * ZEPHYR tall and slim. Feet on its spot, like a man; lying when wrecked. */
  const SHAPE = {
    aquarius: { w: 14, h: 15, head: 'dome' },
    phoenix:  { w: 13, h: 16, head: 'wedge' },
    terra:    { w: 17, h: 14, head: 'block' },
    pegasus:  { w: 11, h: 18, head: 'mast' },
  };
  function body(g, c, x, y, t, lying, s = 1) {
    const sh = SHAPE[c.race] ?? SHAPE.aquarius, col = (typeof crewColor === 'function') ? crewColor(c) : '#4db8ff';
    const metal = '#8a93a3', dark = '#4a5060', lite = '#c8ced8';
    g.save();
    g.translate(x, y);
    if (lying) { g.rotate(Math.PI / 2); g.translate(-4, -2); }
    g.scale(s, s);
    const walk = !lying && (c._waypoints?.length ?? 0) > 0, bob = walk ? Math.sin(t * 14) * 1.2 : 0;
    const w = sh.w, h = sh.h, top = -6 - h + bob;
    // legs / tracks
    g.fillStyle = dark;
    if (c.race === 'terra') { g.fillRect(-w / 2, -6, w, 6); g.fillStyle = '#2a2e38'; for (let i = -w / 2 + 1; i < w / 2; i += 3) g.fillRect(i, -2, 2, 2); }
    else { const k = walk ? Math.sin(t * 14) * 2 : 0; g.fillRect(-4 + k, -7, 3, 7); g.fillRect(1 - k, -7, 3, 7); }
    // body
    g.fillStyle = metal; g.fillRect(-w / 2, top + 7, w, h - 7);
    g.fillStyle = lite; g.fillRect(-w / 2, top + 7, w, 2);
    g.fillStyle = col; g.fillRect(-w / 2 + 2, top + 11, w - 4, 3);                    // the maker's band
    // energy window on its chest
    const ef = energyFrac(c);
    g.fillStyle = '#10141c'; g.fillRect(-3, top + 15, 6, 3);
    g.fillStyle = ef > 0.4 ? '#1aff8c' : ef > 0.15 ? '#ffd700' : '#ff4444'; g.fillRect(-3, top + 15, Math.max(1, Math.round(6 * ef)), 3);
    // head
    g.fillStyle = metal;
    if (sh.head === 'dome') { g.beginPath(); g.arc(0, top + 7, w / 2 - 1, Math.PI, 0); g.fill(); }
    else if (sh.head === 'wedge') { g.beginPath(); g.moveTo(-w / 2, top + 7); g.lineTo(w / 2, top + 7); g.lineTo(w / 2 - 3, top); g.lineTo(-w / 2 + 2, top + 2); g.closePath(); g.fill(); }
    else if (sh.head === 'block') g.fillRect(-w / 2 + 2, top, w - 4, 7);
    else { g.fillRect(-w / 2 + 1, top + 1, w - 2, 6); g.fillStyle = dark; g.fillRect(-1, top - 4, 2, 5); g.fillStyle = col; g.fillRect(-1.5, top - 6, 3, 2); }
    // the visor
    const off = (c.energy ?? 1) <= 0 || lying;
    g.fillStyle = off ? '#2a2e38' : col; g.fillRect(-w / 2 + 3, top + 3, w - 6, 2);
    if (!off) { g.fillStyle = '#ffffff'; g.fillRect(1, top + 3, 2, 1); }
    // the tool on its arm
    const k = c.robotKind;
    g.fillStyle = dark; g.fillRect(w / 2 - 1, top + 9, 3, 6);
    if (k === 'repair') { g.fillStyle = '#ffd700'; g.fillRect(w / 2 + 1, top + 14, 4, 2); g.fillRect(w / 2 + 4, top + 12, 2, 2); }
    else if (k === 'combat') { g.fillStyle = '#ff5a5a'; g.fillRect(w / 2 + 1, top + 13, 7, 2); }
    else { g.fillStyle = '#4dd8ff'; g.fillRect(-w / 2 - 2, top + 8, 2, 2); g.fillRect(w / 2 + 1, top + 13, 3, 3); }
    g.restore();
  }
  /** On the deck (CrewMember.draw). */
  function drawBody(ctx, c) {
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    body(ctx, c, c.x, c.y, t + (c.id?.length ?? 0), !!c.down);
    if (c._charging && c.roomId != null && !c.down) {                                   // the charge, over its head
      ctx.save(); ctx.fillStyle = '#ffd700'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('⚡', c.x, c.y - 30 - Math.sin(t * 4)); ctx.restore();
    }
  }
  /** Its card picture (CrewArt.portraitCanvas). */
  const _faces = new Map();
  function portraitCanvas(c, size = 96) {
    const key = `${c.race}|${c.robotKind}|${size}`;
    if (_faces.has(key)) return _faces.get(key);
    let cv = null;
    try {
      cv = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas')
         : (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : null);
    } catch (e) { cv = null; }
    if (!cv) return null;
    cv.width = size; cv.height = size;
    const g = cv.getContext?.('2d');
    if (g) {
      g.fillStyle = '#0e1626'; g.fillRect(0, 0, size, size);
      g.fillStyle = '#17223a'; g.fillRect(0, size * 0.72, size, size * 0.28);
      g.imageSmoothingEnabled = false;
      body(g, { ...c, energy: energyMax(c), _waypoints: [], down: false }, size / 2, size * 0.9, 0, false, size / 30);
    }
    _faces.set(key, cv);
    return cv;
  }

  /** What its card says under its name. */
  function describe(c) {
    const K = kind(c), M = model(c);
    return `${M.model} ${K.label.toLowerCase()} — ${K.blurb}; ${M.trait}. Charges at the reactor, needs no air.`;
  }

  return { ROBOT, MODELS: ROBOT_MODELS, KINDS: ROBOT_KINDS, isRobot, make, offer, tick, effort, energyMax, energyFrac,
           chargerOf, drawBody, portraitCanvas, describe, kind, model };
})();
