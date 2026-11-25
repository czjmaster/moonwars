'use strict';

/* ══ THE FIGHTERS (update250) ══════════════════════════════════════════════════════════════════════════════════════
 *
 * jj 21.11: „następnie zabierzemy się za myśliwce i hangar — mechanika; grafika na razie jest ok; pamiętaj, że mają
 * być w nim moduły i załogant". The decisions of the night before (HANDOFF 5-0 update249): the lift's platform is a
 * piece of the hangar's floor, two telescopic posts 20 u in from its ends hold it from the ceiling, BEHIND the fighter;
 * there are no doors in the keel — the lift goes down behind the duct and the keel (it is simply not drawn there) and
 * comes out under the ship on its posts; the fighter flies off it.
 *
 * THE HANGAR IS A MODULE (`SYSTEM_DEFS.hangar`, a room two modules wide): it takes power like any other, it breaks
 * like any other, and it needs a MAN AT ITS CONSOLE (the launch console at its stern end) — the crewman flies her
 * from there. One fighter a hangar.
 *
 *   docked     on the platform. With power, a man at the console and a fight on, the lift goes DOWN.
 *   (lift 0→1) the platform sinks out of the floor, behind the duct and the keel, and comes out under the ship.
 *   out        she leaves the platform (the lift goes back up, empty) and flies at the other ship: from a point a
 *              little off its hull she fires a light laser at its modules every `FIRE_EVERY[level]` seconds — the
 *              same shot a gun fires, through the same shields and the same dodge. An enemy fighter out at the
 *              same time she fights first (they shoot each other, `DOGFIGHT_HIT`).
 *   returning  no power, nobody at the console, the fight over, or hurt to her last point: the lift goes down
 *              again and she flies onto it, and rides it up. Docked, she mends (`MEND`).
 *   lost       shot down: the hangar builds another in `REBUILD` seconds while it has power.
 *
 * Nothing of this is saved — like the repair drones, a fighter is wherever she is this second; a reload puts her
 * back on her platform. Both sides fly them: a carrier of theirs launches at you the same way.
 */

/* ══ update252: MINI MODULES, A PILOT ABOARD, A REPAIR DROID ═══════════════════════════════════════════════════════
 *
 * jj 22.11: „myśliwce trzeba zrobić podobnie z modułami i pilotem, jak już mieliśmy plan, czyli mini moduły w
 * szkielecie i robot do naprawy" — the plan of 13.11 (claude/mysliwiec-lotniskowce-2026-11-13.md,
 * claude/mysliwce-przyklady-2026-11-13.md) and of 25.10 (Myśliwce v3/v4):
 *
 *   • she is a little ship seen from the side: a row of MINI MODULES from her tail, ENG · O₂ · WPN · HELM, each 24 u
 *     wide and 23 u tall, a 3 u bulkhead with a way through between them, each with its vent, its air lamp, its icon
 *     and its pips. Every one of them can be aimed at and broken:
 *       ENG out  — slow, and no dodge;   O₂ out — the air in her runs down and then the pilot chokes (in his helmet,
 *       slowly);   WPN out — she does not shoot;   HELM hit — the pilot is hurt; HELM out — no dodge.
 *     Her HULL is the sum that ends her: at 0 she is shot down.
 *   • the PILOT is a real man of the crew: the one at the launch console gets in when she goes (out of the ship's
 *     roster while she flies, like a boarder in the void), his face in his helmet under the canopy. Shot down, he
 *     EJECTS (jj 22.11: „tak śmiało" — the proposal): he is picked up after the fight, hurt. Killed in his seat, she
 *     falls. Down (wounded), she flies him home on her own.
 *   • the REPAIR DROID: his socket just behind the cockpit, his head over her roof; he runs down his rail to a broken
 *     module and mends it at half a hand's pace, in the air too. A hit on the module he is in can break him.
 *   • OUR GUNS AIM AT THEIR FIGHTERS, theirs at ours: a selected gun and a click on a mini module of a fighter in the
 *     air; the shot follows her, and she may dodge (her engines, her helm, her pilot's piloting).
 *   • her level is her hangar's: hull and modules grow with it.
 */

const FIGHTER = {
  HP: 6,                   // her hull at level 1 (HULL below by the hangar's level)
  HULL: [6, 8, 10],
  MOD_HP: [2, 3, 3],       // each mini module, by the hangar's level
  MODS: [                  // from her tail to her nose
    { k: 'eng',  label: 'ENG',  icon: 'icon_engines', name: 'engine' },
    { k: 'o2',   label: 'O₂',   icon: 'icon_oxygen',  name: 'air' },
    { k: 'wpn',  label: 'WPN',  icon: 'icon_weapons', name: 'gun' },
    { k: 'helm', label: 'HELM', icon: 'icon_piloting', name: 'cockpit' },
  ],
  SPEED: 150,              // px/s in flight
  SLOW: 0.4,               // her speed with the engine out
  LIFT_TIME: 2.4,          // s for the lift to go all the way down, or up
  FIRE_EVERY: [7, 5.5, 4.5], // s between her shots, by the hangar's powered level (1, 2, 3+)
  RANGE: 520,              // px: she shoots from no farther than this
  DOGFIGHT_HIT: 0.55,      // the chance one fighter's burst finds another (before her dodge)
  DODGE: 0.25,             // her dodge with engine and helm whole; + DODGE_SKILL a level of her pilot's piloting
  DODGE_SKILL: 0.03,
  EYE_SKILL: 0.03,         // + her pilot's weapons skill a level, in a dogfight (update256)
  HOME_AT: 0.34,           // she comes home with her hull under this share of it…
  GO_AT: 0.6,              // …and goes out again from this share
  MEND: 0.25,              // hull a second, docked on a working hangar (the modules and the droid as fast)
  REBUILD: 30,             // s to build another, with power
  AIR_LOSS: 0.05,          // her air a second with the O₂ module out (1 = full)
  AIR_BACK: 0.1,           // …and back with it whole
  CHOKE: 2,                // hp a second the pilot loses under a quarter of her air (his helmet holds the rest)
  EJECT_HP: 0.35,          // a pilot who ejected comes home with no more than this share of his health
  DROID_HP: 2,
  DROID_RATE: 0.2,         // module hp a second — half a hand
  DROID_SPEED: 40,         // u/s down his rail
  DROID_HURT: 0.5,         // the chance a hit on the module he is in breaks a piece of him
  AI_AIM: 0.3,             // the chance one of their shots goes at our fighter while she is out
  STAND_OFF: 46,           // px off the other hull's roof or keel where she flies
  /* HER BODY, in the hangar's units (u; 1 u = room.w/200 px), from her tail (0) to her nose (LEN), up from her skids */
  LEN: 150,
  H: 36,
  BODY: { SKID: 3, FLOOR: 6, CEIL: 29, ROOF: 32, TOP: 36, START: 12, PART: 3, MOD_W: 24, HELM_W: 28 },
  CLEAR: 6,                // px between the keel and her canopy when the lift is all the way down
  SHOT: { label: 'Fighter laser', type: 'laser', damage: 1, shield_damage: 1, shieldDamage: 1, hull_damage: 1,
          moduleDamage: 1, crewDamage: [6, 14], shots: 1, projectileSpeed: 420, fireChance: 0.03, breachChance: 0 },
  POSTS: [20, 20],         // u in from each end of the platform (jj: „trochę obok brzegów")
};

const Fighters = (() => {
  const HR = () => (typeof HANGAR_ROOM !== 'undefined' ? HANGAR_ROOM : { PLATFORM: { x0: 32, x1: 198, floor: 38 } });
  const rnd = () => Math.random();

  // ── her parts, in u ─────────────────────────────────────────
  /** Each mini module's span along her (u from her tail) and the bulkheads between them. */
  const SPANS = (() => {
    const B = FIGHTER.BODY, out = [], parts = [];
    let u = B.START;
    FIGHTER.MODS.forEach((m, i) => {
      parts.push([u, u + B.PART]); u += B.PART;
      const w = m.k === 'helm' ? B.HELM_W : B.MOD_W;
      out.push([u, u + w]); u += w;
    });
    return { mods: out, parts };
  })();
  const SOCKET = (SPANS.parts[3][0] + SPANS.parts[3][1]) / 2;     // the droid's socket: the bulkhead behind the cockpit
  const modMid = (i) => (SPANS.mods[i][0] + SPANS.mods[i][1]) / 2;

  /* update256: THE BAY'S TIER AND HER MARK. A hangar is two pips a tier (like the shields); her Mk is bought at a
     yard and is never more than the bay's tier. Theirs fly the Mk of their bay. */
  function tierOf(sys) { return Math.max(1, Math.min(FIGHTER.HULL.length, Math.floor((sys?.level ?? 2) / 2))); }
  function markOf(sys) { return Math.max(1, Math.min(FIGHTER.HULL.length, sys?._fighterMk ?? sys?._fighterSave?.mk ?? 1)); }
  /** The level she flies at (1..3): her Mk, capped by her bay's tier. */
  function levelOf(sys) { return Math.max(1, Math.min(markOf(sys), tierOf(sys))); }
  /** The powered tier: two bars a tier — under 2 the bay is dark. */
  function poweredTier(sys) {
    if (!sys || sys.isDisabled?.()) return 0;
    return Math.floor((sys.effectivePower?.() ?? 0) / (sys.def?.powerPerLayer ?? 2));
  }
  function hullMax(f) { return f.hullMax ?? FIGHTER.HP; }

  /** A whole fighter for this hangar's level. */
  function fresh(sys) {
    const lv = levelOf(sys), mh = FIGHTER.MOD_HP[lv - 1];
    return { lv, hp: FIGHTER.HULL[lv - 1], hullMax: FIGHTER.HULL[lv - 1],
             mods: FIGHTER.MODS.map(m => ({ k: m.k, hp: mh, max: mh })),
             droid: { u: SOCKET, hp: FIGHTER.DROID_HP, to: null, working: false },
             air: 1 };
  }
  /** Her hull, modules, droid and air whole again — for the hangar's level. */
  function refit(f, sys) { Object.assign(f, fresh(sys)); }

  /** The fighter of one hangar (its system), made the first time it is asked for. */
  function of(sys) {
    if (!sys) return null;
    if (!sys._fighter) {
      const S = sys._fighterSave;
      sys._fighter = { state: 'docked', lift: 0, x: 0, y: 0, vx: 0, vy: 0, face: 1, cd: 1.5, t: 0, wp: null, wpT: 0,
                       tracer: null, rebuild: 0, pilot: null, ejected: [], tgts: [], order: 'hold', ...fresh(sys) };
      if (S?.lost) { sys._fighter.state = 'lost'; sys._fighter.hp = 0; sys._fighter.noRebuild = true; }
    }
    return sys._fighter;
  }
  /** Every hangar of a ship. */
  function hangars(ship) { return (ship?.systems ?? []).filter(s => s.type === 'hangar'); }
  function roomOf(ship, sys) { return ship?.getRoomById?.(sys.roomId) ?? null; }
  const mod = (f, k) => f.mods?.find(m => m.k === k);
  const works = (f, k) => (mod(f, k)?.hp ?? 1) > 0;
  const pilotOk = (c) => !!c && !c.dead && !c.dying && c.state !== 'injured';

  /** The man at the launch console, if he is one of hers. */
  function consoleMan(ship, sys) {
    const op = ship.consoleOperator ? ship.consoleOperator(sys.roomId) : null;
    if (!op || op.isPlayer !== ship.isPlayer || op.isPrisoner || op.isPet) return null;
    return op;
  }

  /** Can this hangar send its fighter out (or keep her out) right now? null when it can, else why not. */
  function refusal(ship, sys, fighting) {
    if (!sys) return 'no hangar';
    if (sys.isDisabled()) return sys.workingLevels <= 0 ? 'the hangar is wrecked' : 'no power';
    if (poweredTier(sys) < 1) return 'no power';                    // two bars at least, like a shield layer (update256)
    const f = sys._fighter;
    if (f?.pilot) { if (!pilotOk(f.pilot)) return 'the pilot is down'; }
    else if (!consoleMan(ship, sys)) return 'nobody at the launch console';
    if (!fighting) return 'no fight';
    return null;
  }

  /** How often she fires, by the hangar's powered level. */
  function fireEvery(sys) {
    const lv = Math.max(1, Math.min(FIGHTER.FIRE_EVERY.length, poweredTier(sys) || 1));
    return FIGHTER.FIRE_EVERY[lv - 1];
  }

  /** Her chance to dodge a shot: engine and helm whole, a pilot fit to fly — and his piloting. */
  function dodge(f) {
    if (!f || !works(f, 'eng') || !works(f, 'helm') || !pilotOk(f.pilot)) return 0;
    return FIGHTER.DODGE + FIGHTER.DODGE_SKILL * (f.pilot.getSkillLevel?.('piloting') ?? 0);
  }

  // ── the pilot gets in, gets out ─────────────────────────────
  /** The man at the console climbs in: off the ship's roster while she is his (like a boarder in the void). */
  function board(ship, f, c) {
    ship.elevators?.release?.(c);
    c._waypoints = []; c.carrying = null;
    if (typeof TASK !== 'undefined') c.task = TASK.IDLE;
    ship.crew = ship.crew.filter(k => k !== c);
    c.roomId = null; c._inFighter = true;
    f.pilot = c;
  }
  /** Out of her, at the launch console — alive, wounded or dead. */
  function disembark(ship, sys, f) {
    const c = f.pilot;
    if (!c) return;
    f.pilot = null;
    putBack(ship, sys, c);
  }
  function putBack(ship, sys, c) {
    const room = roomOf(ship, sys);
    c._inFighter = false;
    if (room) {
      const [x, y] = ship.stationSlot ? ship.stationSlot(room, 0) : [room.cx, room.cy];
      c.x = x; c.y = y; c.roomId = room.id;
      if (!c.homeRoomId) c.homeRoomId = room.id;
    }
    c._waypoints = [];
    ship.addCrew(c, true);
  }
  /** Everyone of this ship's who is out in a fighter or waiting to be picked up (for the save). */
  function crewAway(ship) {
    const out = [];
    hangars(ship).forEach(sys => { const f = sys._fighter; if (!f) return; if (f.pilot) out.push(f.pilot); out.push(...(f.ejected ?? [])); });
    return out;
  }

  // ── geometry: the lift ──────────────────────────────────────
  /** Where things are for this hangar: the room's inside, its scale, the platform at rest, the keel under it, and how
   *  far the lift goes down. Everything in px. */
  function geom(ship, room) {
    const P = HR().PLATFORM, x = room.x, y = room.floorTop, w = room.w, h = room.floorH;
    const kx = w / 200, ky = h / 50;
    const px0 = x + P.x0 * kx, px1 = x + P.x1 * kx, rest = y + P.floor * ky;
    let keel = null;
    try { const g = ship.hullArtGeometry?.(); if (g?.shaped && g.keelAt) keel = g.keelAt(px0, px1); } catch (e) { keel = null; }
    if (keel == null) keel = room.y + room.h + (typeof HULL_GRID !== 'undefined' ? HULL_GRID.MARGIN : 10);
    keel = Math.max(keel, room.y + room.h);
    const fighterH = FIGHTER.H * ky;
    const drop = (keel - rest) + fighterH + FIGHTER.CLEAR;
    return { x, y, w, h, kx, ky, px0, px1, rest, keel, drop, fighterH };
  }
  /** The platform's top right now (px). */
  function platformY(G, lift) { return G.rest + G.drop * ease(lift); }
  const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  /** Where a fighter stands on this platform: her middle x, her floor (px). */
  function onPlatform(ship, G, lift) {
    const face = (ship.facesRight ?? ship.isPlayer) ? 1 : -1;
    return { face, x: (G.px0 + G.px1) / 2, floor: platformY(G, lift), len: FIGHTER.LEN * G.kx };
  }

  /** Her mini modules in px: `cx` her middle, `floor` under her skids. [{x, y, w, h, cx, cy}] tail to nose. */
  function modRects(cx, floor, kx, ky, face) {
    const B = FIGHTER.BODY, tail = cx - face * FIGHTER.LEN * kx / 2;
    return SPANS.mods.map(([a, b]) => {
      const xa = tail + face * a * kx, xb = tail + face * b * kx, x = Math.min(xa, xb), w = Math.abs(xb - xa);
      const y = floor - B.CEIL * ky, h = (B.CEIL - B.FLOOR) * ky;
      return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    });
  }
  /** Her modules where she is in the air. */
  function airRects(ship, sys) {
    const f = of(sys), room = roomOf(ship, sys);
    if (!room) return [];
    const G = f._G ?? geom(ship, room);
    return modRects(f.x, f.y + G.fighterH / 2, G.kx, G.ky, f.face);
  }

  // ── aiming at her ───────────────────────────────────────────
  /** A gun's target on one of her mini modules — the same object each time, so a gun can remember it. */
  function target(ship, sys, i) {
    const f = of(sys);
    if (!f.tgts[i]) {
      const M = FIGHTER.MODS[i];
      f.tgts[i] = {
        isFighter: true, ship, sys, mod: i,
        get cx() { return airRects(ship, sys)[i]?.cx ?? f.x; },
        get cy() { return airRects(ship, sys)[i]?.cy ?? f.y; },
        label: `${ship.isPlayer ? 'our' : 'their'} fighter's ${M.name}`,
        system: { label: `${ship.isPlayer ? 'our' : 'their'} fighter's ${M.name}` },
      };
    }
    return f.tgts[i];
  }
  /** Is this target still a fighter in the air? */
  function targetLive(t) {
    if (!t || !t.isFighter) return false;
    const f = t.sys?._fighter;
    return !!f && (f.state === 'out' || f.state === 'returning') && !t.ship?.destroyed;
  }
  /** The mini module of one of this ship's fighters under (x, y), or null. */
  function targetAt(ship, x, y) {
    for (const sys of hangars(ship)) {
      const f = sys._fighter;
      if (!f || (f.state !== 'out' && f.state !== 'returning')) continue;
      const R = airRects(ship, sys), pad = 3;
      for (let i = 0; i < R.length; i++) {
        const r = R[i];
        if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad * 2 && y <= r.y + r.h + pad * 2) return target(ship, sys, i);
      }
    }
    return null;
  }
  /** One of this ship's fighters in the air, a module of her, for their gunners — or null. */
  function aimFor(ship) {
    const live = hangars(ship).filter(s => { const f = s._fighter; return f && f.state === 'out'; });
    if (!live.length) return null;
    const sys = live[Math.floor(rnd() * live.length)];
    return target(ship, sys, Math.floor(rnd() * FIGHTER.MODS.length));
  }
  /** A shot in the air at her: it follows her (she moves), and flies on if she is gone. */
  function track(p) {
    const t = p.atFighter;
    if (!t || p.done || p.flyOn || p.hit) return;
    if (!targetLive(t)) { p.flyOn = true; return; }
    if (p.launchDelay > 0) return;
    const dx = t.cx - p.x, dy = t.cy - p.y, d = Math.hypot(dx, dy) || 1;
    p.targetX = t.cx; p.targetY = t.cy;
    p.vx = dx / d * p.speed; p.vy = dy / d * p.speed; p.angle = Math.atan2(dy, dx);
  }
  /** A gun's shot reaches her: a dodge, or a hit on the module it was aimed at. {dodged} */
  function receiveHit(t, p) {
    const f = t?.sys?._fighter;
    if (!f || !targetLive(t)) return { dodged: true };
    if (rnd() < dodge(f)) {
      if (typeof Particles !== 'undefined') Particles.floatText?.(t.cx, t.cy - 10, 'MISS', '#8fe4ff', 10);
      f.pilot?.addXP?.('piloting', (typeof XP_RATES !== 'undefined' ? XP_RATES.piloting : 16) / 2);
      return { dodged: true };
    }
    const d = p?.def ?? {};
    const ion = p?.type === 'ion';
    const dmg = ion ? 0 : Math.max(1, d.hull_damage ?? d.damage ?? 1);
    hitModule(t.ship, t.sys, t.mod, dmg, d.crewDamage, ion ? Math.max(1, d.damage ?? 1) : 0);
    return { dodged: false };
  }
  /** A hit on her `i`th module: her hull, the module, the pilot in the cockpit, the droid if he is in it. */
  function hitModule(ship, sys, i, dmg = 1, crewDamage = null, modOnly = 0) {
    const f = of(sys), m = f.mods[i];
    if (!m) return;
    f.hp = Math.max(0, f.hp - dmg);
    m.hp = Math.max(0, m.hp - Math.max(dmg, modOnly));
    const R = airRects(ship, sys)[i];
    if (R && typeof Particles !== 'undefined') Particles.laserHit?.(R.cx, R.cy);
    if (m.k === 'helm' && f.pilot && !f.pilot.dead) {
      const cd = Array.isArray(crewDamage) ? crewDamage[0] + rnd() * (crewDamage[1] - crewDamage[0]) : (crewDamage ?? 10);
      f.pilot.takeDamage?.(cd, 'a hit on the cockpit');
    }
    const D = f.droid;
    if (D && D.hp > 0 && Math.abs(D.u - modMid(i)) < 14 && rnd() < FIGHTER.DROID_HURT) D.hp -= 1;
    if (f.hp <= 0 && f.state !== 'lost') shootDown(ship, f);
  }

  // ── the clock ───────────────────────────────────────────────
  function update(dt, combat) {
    const P = combat?.playerShip, E = combat?.enemyShip;
    const fighting = !!(combat && (combat.isActive?.() || combat.state === 'active') && P && E && !P.destroyed && !E.destroyed
                        && (E.hull ?? 1) > 0 && (P.hull ?? 1) > 0);
    [[P, E], [E, P]].forEach(([own, foe]) => {
      if (!own) return;
      hangars(own).forEach(sys => step(dt, own, foe, sys, fighting, combat));
    });
  }

  function step(dt, ship, foe, sys, fighting, combat) {
    const f = of(sys), room = roomOf(ship, sys);
    if (!room) return;
    const G = geom(ship, room);
    f._G = G;
    if (ours(ship)) return stepOurs(dt, ship, foe, sys, fighting, combat, f, G);
    /* theirs fly the Mk of their bay */
    if (!ship.isPlayer) sys._fighterMk = tierOf(sys);
    if (f.state === 'docked' && f.lv !== levelOf(sys) && f.lift <= 0) refit(f, sys);
    const why = refusal(ship, sys, fighting && foe && !foe.destroyed);
    f.why = why;
    const liftTo = (t) => {
      const d = dt / FIGHTER.LIFT_TIME;
      f.lift = f.lift < t ? Math.min(t, f.lift + d) : Math.max(t, f.lift - d);
    };
    if (f.tracer) { f.tracer.t -= dt; if (f.tracer.t <= 0) f.tracer = null; }
    if (f.state !== 'lost') droid(dt, f);

    switch (f.state) {
      case 'docked': {
        if (!sys.isDisabled()) mend(dt, f);
        const go = !why && f.hp >= hullMax(f) * FIGHTER.GO_AT;
        if (go && !f.pilot) { const c = consoleMan(ship, sys); if (c) board(ship, f, c); }
        if (!f.pilot) { liftTo(0); break; }
        liftTo(go ? 1 : 0);
        if (!go && f.lift <= 0) { disembark(ship, sys, f); break; }
        if (go && f.lift >= 1) {                                   // down under the keel: she flies off
          const s = onPlatform(ship, G, 1);
          f.state = 'out'; f.x = s.x; f.y = s.floor - G.fighterH / 2; f.face = s.face;
          f.vx = s.face * FIGHTER.SPEED * 0.6; f.vy = 0; f.cd = 1.2; f.wp = null;
          if (typeof Audio !== 'undefined' && ship.isPlayer) Audio.sfx?.weaponCharge?.();
        }
        break;
      }
      case 'out': {
        if (life(dt, ship, sys, f)) break;
        const home = why || f.hp < hullMax(f) * FIGHTER.HOME_AT;
        liftTo(home ? 1 : 0);
        if (home) { f.state = 'returning'; break; }
        fly(dt, f, ship, foe, G, combat, sys);
        break;
      }
      case 'returning': {
        if (life(dt, ship, sys, f)) break;
        liftTo(1);
        const s = onPlatform(ship, G, 1);
        const tx = s.x, ty = s.floor - G.fighterH / 2;
        steer(dt, f, tx, ty, 1);
        if (f.lift >= 1 && Math.hypot(tx - f.x, ty - f.y) < 3) { f.state = 'docked'; f.vx = f.vy = 0; }
        else if (!why && f.hp >= hullMax(f) * FIGHTER.HOME_AT && f.lift < 1) { f.state = 'out'; }  // called off before she landed
        break;
      }
      case 'lost': {
        liftTo(0);
        if (!sys.isDisabled()) f.rebuild -= dt;
        if (f.rebuild <= 0) { refit(f, sys); f.state = 'docked'; f.lift = 0; }
        break;
      }
    }
  }


  /* ══ OURS FLY ON ORDERS (update256) ══════════════════════════════════════════════════════════════════════════
   * jj 22.11: „lot myśliwca nie powinien być automatyczny — musimy zaznaczyć załoganta i dać na samolot komendę
   * »wejdź«; jak pilot jest plus gość w hangarze przy konsoli, możemy wysłać myśliwiec, tak samo go zawołać; jak nie
   * ma załoganta przy konsoli, nikt nie otworzy windy — myśliwiec nie może wrócić; tak samo jak nie ma energii".
   *
   *   BOARD     a selected hand, a click on her on the platform: he walks to the bay and climbs in.
   *   LAUNCH    a pilot in her, a man at the launch console, two bars of power and a fight on: down, and out.
   *   RECALL    she flies under the bay; the lift comes down for her only with a man at the console and power —
   *             without them she waits under the keel. Home, she mends on her platform (a powered bay).
   *   PILOT OUT on the platform, the lift up: he climbs out.
   * She does not come home on her own any more (only with her pilot down). The fight over, she is still out there:
   * RECALL her — jump away with her outside and she is lost, her pilot with her. Shot down, she is not rebuilt: a
   * yard sells a new one (station.buyFighter). */
  /** On orders: ours — unless AUTO (the old automatic bay of update250, kept for theirs and the tests of 436–438). */
  const AUTO = { on: false };
  function ours(ship) { return !!ship?.isPlayer && !AUTO.on; }
  function liftWorks(ship, sys) { return poweredTier(sys) >= 1 && !!consoleMan(ship, sys); }
  function liftWhy(ship, sys) {
    if (sys.workingLevels <= 0) return 'the hangar is wrecked';
    if (poweredTier(sys) < 1) return 'the bay needs 2 power';
    if (!consoleMan(ship, sys)) return 'nobody at the launch console';
    return null;
  }
  /** Her own ship, the fight to go to — or why not. */
  function launchWhy(ship, sys, f, fightOn) {
    if (f.state === 'lost') return 'she was lost — a yard sells a new one';
    if (!f.pilot) return 'no pilot — select a hand and click her';
    if (!pilotOk(f.pilot)) return 'the pilot is hurt';
    const lw = liftWhy(ship, sys); if (lw) return lw;
    if (!fightOn) return 'no fight to fly into';
    return null;
  }
  function fightOnFor(fighting, foe) { return !!(fighting && foe && !foe.destroyed && !foe.isDerelict && !foe._hullDown && !foe.surrendered); }

  function stepOurs(dt, ship, foe, sys, fighting, combat, f, G) {
    const fightOn = fightOnFor(fighting, foe);
    const liftTo = (t) => {
      const d = dt / FIGHTER.LIFT_TIME;
      f.lift = f.lift < t ? Math.min(t, f.lift + d) : Math.max(t, f.lift - d);
    };
    if (f.tracer) { f.tracer.t -= dt; if (f.tracer.t <= 0) f.tracer = null; }
    if (f.state !== 'lost' && f.state !== 'outside') droid(dt, f);
    const lw = liftWhy(ship, sys);
    f.why = f.state === 'docked' ? launchWhy(ship, sys, f, fightOn) : lw;
    switch (f.state) {
      case 'docked': {
        if (!sys.isDisabled()) mend(dt, f);
        if (!f.pilot && f.lift <= 0) boardWaiting(ship, sys, f);
        if (f.pilot && !pilotOk(f.pilot) && f.lift <= 0) { disembark(ship, sys, f); f.order = 'hold'; }
        if (f.order === 'launch' && !fightOn) f.order = 'hold';
        const go = f.order === 'launch' && !launchWhy(ship, sys, f, fightOn);
        liftTo(go ? 1 : 0);
        if (go && f.lift >= 1) {
          const s = onPlatform(ship, G, 1);
          f.state = 'out'; f.order = 'out'; f.x = s.x; f.y = s.floor - G.fighterH / 2; f.face = s.face;
          f.vx = s.face * FIGHTER.SPEED * 0.6; f.vy = 0; f.cd = 1.2; f.wp = null;
          if (typeof Audio !== 'undefined') Audio.sfx?.weaponCharge?.();
        }
        break;
      }
      case 'out': {
        if (life(dt, ship, sys, f)) break;
        liftTo(0);
        if (f.order === 'recall' || !pilotOk(f.pilot)) { f.state = 'returning'; f.order = 'recall'; break; }
        if (fightOn) fly(dt, f, ship, foe, G, combat, sys);
        else loiter(dt, f, ship, G);
        break;
      }
      case 'returning': {
        if (life(dt, ship, sys, f)) break;
        if (f.order === 'launch' && pilotOk(f.pilot) && fightOn) { f.state = 'out'; f.order = 'out'; break; }
        const s = onPlatform(ship, G, 1), tx = s.x, ty = s.floor - G.fighterH / 2;
        if (lw) {                                                    // nobody to open the lift: she waits under the keel
          liftTo(0);
          steer(dt, f, tx, ty + G.fighterH * 0.8 + 10, 1);
          break;
        }
        liftTo(1);
        steer(dt, f, tx, ty, 1);
        if (f.lift >= 1 && Math.hypot(tx - f.x, ty - f.y) < 3) { f.state = 'docked'; f.order = 'hold'; f.vx = f.vy = 0; }
        break;
      }
      case 'outside': {                                              // out there after a fight, off the screen
        if (f.order === 'recall' && !lw) {
          liftTo(1);
          if (f.lift >= 1) { f.state = 'docked'; f.order = 'hold'; f.vx = f.vy = 0; }
        } else liftTo(0);
        break;
      }
      case 'lost': {
        liftTo(0);
        f.order = 'hold';
        break;
      }
    }
  }

  /** No fight: she flies a slow round under her own ship. */
  function loiter(dt, f, ship, G) {
    const b = ship.roomBounds ? ship.roomBounds() : null;
    if (!b) return;
    f.wpT -= dt;
    if (!f.wp || f.wpT <= 0) { f.wp = { x: b.x + b.w * (0.25 + rnd() * 0.5), y: b.y + b.h + FIGHTER.STAND_OFF + 24 }; f.wpT = 3 + rnd() * 2; }
    steer(dt, f, f.wp.x, f.wp.y, 1);
  }

  /** The hand sent to her (`c._boardFighter`) climbs in once he stands in the bay. */
  function boardWaiting(ship, sys, f) {
    const c = ship.crew.find(k => k && k._boardFighter === sys.roomId);
    if (!c) return;
    if (!pilotOk(c) || c.isPet || (c.homeRoomId != null && c.homeRoomId !== sys.roomId)) { c._boardFighter = null; return; }
    if (c.roomId !== sys.roomId || (c._waypoints?.length ?? 0) > 0) return;
    c._boardFighter = null;
    board(ship, f, c);
    c.homeRoomId = sys.roomId;
    if (typeof UI !== 'undefined') UI.notify?.(`${c.name} is in the cockpit — LAUNCH from the hangar.`, 'info');
  }

  /** An order from the hangar's buttons: 'launch' | 'recall' | 'out' (the pilot climbs out) | 'hold'. {ok, message} */
  function order(ship, sys, act, fighting = false, foe = null) {
    const f = of(sys);
    if (act === 'out') {
      if (f.state !== 'docked' || f.lift > 0 || !f.pilot) return { ok: false, message: 'She is not on her platform.' };
      disembark(ship, sys, f); f.order = 'hold';
      return { ok: true, message: 'The pilot climbs out.' };
    }
    if (act === 'launch') {
      if (f.state === 'returning') { f.order = 'launch'; return { ok: true, message: 'Back into the fight.' }; }
      const why = launchWhy(ship, sys, f, fightOnFor(fighting, foe));
      if (why) return { ok: false, message: `LAUNCH — ${why}.` };
      f.order = 'launch';
      return { ok: true, message: 'Launching — the lift is going down.' };
    }
    if (act === 'recall') {
      if (f.state !== 'out' && f.state !== 'returning' && f.state !== 'outside') return { ok: false, message: 'She is home.' };
      f.order = 'recall';
      const lw = liftWhy(ship, sys);
      return { ok: true, message: lw ? `Recalled — but ${lw}: she waits under the keel.` : 'Recalled — the lift is coming down for her.' };
    }
    f.order = 'hold';
    return { ok: true, message: 'Launch called off.' };
  }

  /** Her buttons on the bay's wall (ours): [{x, y, w, h, label, act, sys, on}] */
  function buttons(ship) {
    if (!ours(ship)) return [];
    const out = [];
    hangars(ship).forEach(sys => {
      const room = roomOf(ship, sys), f = sys._fighter;
      if (!room || !f) return;
      const list = [];
      if (f.state === 'docked' && f.lift <= 0 && f.pilot) list.push(['LAUNCH', 'launch'], ['PILOT OUT', 'out']);
      else if (f.state === 'docked' && f.order === 'launch') list.push(['HOLD', 'hold']);
      else if (f.state === 'out') list.push(['RECALL', 'recall']);
      else if (f.state === 'returning') list.push(['LAUNCH', 'launch']);
      else if (f.state === 'outside' && f.order !== 'recall') list.push(['RECALL', 'recall']);
      const bw = 46, bh = 13;
      list.forEach(([label, act], i) => out.push({ x: room.x + 4 + i * (bw + 3), y: room.y + 4, w: bw, h: bh, label, act, sys,
                                                   on: !(act === 'launch' && f.state === 'docked' && f.why) }));
    });
    return out;
  }
  function buttonAt(ship, x, y) {
    return buttons(ship).find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null;
  }
  /** Our hangar whose fighter stands on her platform, empty, under (x, y) — for the BOARD order. */
  function boardAt(ship, x, y) {
    if (!ours(ship)) return null;
    for (const sys of hangars(ship)) {
      const f = sys._fighter, room = roomOf(ship, sys);
      if (!f || !room || f.state !== 'docked' || f.lift > 0 || f.pilot) continue;
      const G = geom(ship, room), s = onPlatform(ship, G, 0);
      if (x >= s.x - s.len / 2 && x <= s.x + s.len / 2 && y >= s.floor - G.fighterH - 4 && y <= s.floor + 4) return sys;
    }
    return null;
  }
  /** Away from the ship (out, coming home, or left outside after a fight) — a jump would leave her behind. */
  function away(ship) {
    return hangars(ship).filter(sys => { const f = sys._fighter; return f && ['out', 'returning', 'outside'].includes(f.state); });
  }
  /** We jumped with her outside: she and her pilot are lost (jj: „zostawiony = tracimy pilota i myśliwiec"). */
  function abandon(ship) {
    const lost = [];
    away(ship).forEach(sys => {
      const f = sys._fighter, c = f.pilot;
      if (c) { c._inFighter = false; c.dead = true; c.hp = 0; c.state = 'dead'; lost.push(c); }
      f.pilot = null; f.state = 'lost'; f.hp = 0; f.lift = 0; f.order = 'hold'; f.noRebuild = true;
    });
    return lost;
  }
  /** Off the fight's clock (the map, a wreck): her lift and her orders still run. */
  function idle(dt, ship) {
    if (!ship) return;
    hangars(ship).forEach(sys => step(dt, ship, null, sys, false, null));
  }
  // ── the yard ────────────────────────────────────────────────
  function isLost(sys) { return of(sys).state === 'lost'; }
  function setMark(sys, mk) {
    sys._fighterMk = Math.max(1, Math.min(FIGHTER.HULL.length, mk));
    const f = of(sys);
    if (f.state !== 'lost') { const keep = { state: f.state, pilot: f.pilot, lift: f.lift, order: f.order }; refit(f, sys); Object.assign(f, keep); }
  }
  function restore(sys) {
    const f = of(sys);
    refit(f, sys); f.state = 'docked'; f.lift = 0; f.order = 'hold'; f.noRebuild = false;
    if (sys._fighterSave) sys._fighterSave.lost = false;
  }
  /** What the save keeps of her: her Mk, and whether the bay is empty. */
  function saveOf(sys) { const f = sys._fighter; return { mk: markOf(sys), lost: f ? f.state === 'lost' : !!sys._fighterSave?.lost }; }

  /** Docked on a working hangar: hull, modules, droid and air come back. */
  function mend(dt, f) {
    const k = FIGHTER.MEND * dt;
    f.hp = Math.min(hullMax(f), f.hp + k);
    f.mods.forEach(m => { m.hp = Math.min(m.max, m.hp + k); });
    if (f.droid) f.droid.hp = Math.min(FIGHTER.DROID_HP, f.droid.hp + k);
    f.air = Math.min(1, f.air + FIGHTER.AIR_BACK * dt);
  }

  /** The pilot in the air: the air in her, his health. True when she is finished by it (he is dead). */
  function life(dt, ship, sys, f) {
    const c = f.pilot;
    f.air = works(f, 'o2') ? Math.min(1, f.air + FIGHTER.AIR_BACK * dt) : Math.max(0, f.air - FIGHTER.AIR_LOSS * dt);
    if (c && !c.dead && f.air < 0.25 && c.race !== 'pegasus' && !c.isRobot) c.takeDamage?.(FIGHTER.CHOKE * dt, 'suffocation');   // a robot pilot breathes nothing (update257)
    if (c && c.dying && !c.dead) { c.hp = 0; c.dying = false; c.dead = true; c.state = 'dead'; }   // nobody to finish his fall in here
    if (c && c.dead) {
      if (typeof UI !== 'undefined') UI.notify?.(ship.isPlayer ? `${c.name} died in the cockpit — our fighter is going down.` : 'Their pilot is dead — their fighter falls!', ship.isPlayer ? 'alert' : 'good');
      shootDown(ship, f, true);
      return true;
    }
    if (c && !c.dead) c.addXP?.('piloting', dt * 0.2);
    return false;
  }

  /** The repair droid: to the most broken module, mend it, back to his socket. */
  function droid(dt, f) {
    const D = f.droid;
    if (!D) return;
    D.working = false;
    if (D.hp <= 0) return;
    let best = null;
    f.mods.forEach((m, i) => { if (m.hp < m.max && (!best || m.hp / m.max < best.m.hp / best.m.max)) best = { m, i }; });
    const to = best ? modMid(best.i) : SOCKET;
    D.to = best ? best.i : null;
    const d = to - D.u, step = FIGHTER.DROID_SPEED * dt;
    if (Math.abs(d) > step) { D.u += Math.sign(d) * step; return; }
    D.u = to;
    if (best) { best.m.hp = Math.min(best.m.max, best.m.hp + FIGHTER.DROID_RATE * dt); D.working = true; }
  }

  /** Fly towards (tx, ty); `slow` near the end. */
  function steer(dt, f, tx, ty, slow = 0) {
    const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
    const top = FIGHTER.SPEED * (works(f, 'eng') ? 1 : FIGHTER.SLOW);
    const sp = top * (slow ? Math.min(1, d / 60 + 0.15) : 1);
    const want = { x: dx / d * sp, y: dy / d * sp };
    const k = Math.min(1, dt * 3);
    f.vx += (want.x - f.vx) * k; f.vy += (want.y - f.vy) * k;
    if (d < sp * dt) { f.x = tx; f.y = ty; } else { f.x += f.vx * dt; f.y += f.vy * dt; }
    if (Math.abs(f.vx) > 8) f.face = f.vx > 0 ? 1 : -1;
  }

  /** Out: pick a point off her hull, go there, shoot. */
  function fly(dt, f, ship, foe, G, combat, sys) {
    if (!foe || foe.isDerelict || foe._hullDown) return loiter(dt, f, ship, G);     // never a wreck (jj 22.11)
    const b = foe.roomBounds ? foe.roomBounds() : null;
    if (!b) return;
    f.wpT -= dt;
    if (!f.wp || f.wpT <= 0) {
      const above = rnd() < 0.5;
      f.wp = { x: b.x + rnd() * b.w, y: above ? b.y - FIGHTER.STAND_OFF - 18 : b.y + b.h + FIGHTER.STAND_OFF + 10 };
      f.wpT = 3 + rnd() * 2;
    }
    steer(dt, f, f.wp.x, f.wp.y, 1);
    f.cd -= dt;
    if (f.cd > 0) return;
    if (!works(f, 'wpn')) { f.cd = 0.5; return; }                 // her gun is out: she only flies
    /* the enemy's fighter first, if she is out */
    const theirs = hangars(foe).filter(s => s._fighter && s._fighter.state === 'out');
    if (theirs.length) {
      const tSys = theirs[0], t = tSys._fighter;
      f.cd = fireEvery(sys) * 0.6;
      f.face = t.x >= f.x ? 1 : -1;
      /* her pilot's eye: his weapons skill (update256) */
      const eye = FIGHTER.DOGFIGHT_HIT + FIGHTER.EYE_SKILL * (f.pilot?.getSkillLevel?.('weapons') ?? 0);
      const hit = rnd() < eye && rnd() >= dodge(t);
      f.tracer = { x0: f.x + f.face * 30, y0: f.y, x1: t.x, y1: t.y + (hit ? 0 : 14), t: 0.14 };
      if (hit) {
        hitModule(foe, tSys, Math.floor(rnd() * t.mods.length), 1, FIGHTER.SHOT.crewDamage);
        f.pilot?.addXP?.('weapons', (typeof XP_RATES !== 'undefined' ? XP_RATES.weapons ?? 16 : 16) / 2);
      }
      return;
    }
    const rooms = (foe.rooms ?? []).filter(r => r.system || r.type !== 'empty');
    const room = rooms.length ? rooms[Math.floor(rnd() * rooms.length)] : null;
    if (!room || Math.hypot(room.cx - f.x, room.cy - f.y) > FIGHTER.RANGE) { f.cd = 0.5; return; }
    f.cd = fireEvery(sys);
    f.face = room.cx >= f.x ? 1 : -1;
    if (combat?._projectiles && typeof Projectile !== 'undefined') {
      const p = new Projectile({ x: f.x + f.face * 30, y: f.y, targetX: room.cx, targetY: room.cy, speed: FIGHTER.SHOT.projectileSpeed,
                                 type: 'laser', def: FIGHTER.SHOT, defKey: 'laser_basic', fromPlayer: !!ship.isPlayer,
                                 gunners: f.pilot ? [f.pilot] : [] });
      p.fromFighter = true;
      /* HER SHOTS COUNT (update256, jj: „strzały myśliwca nie są liczone"): her own gun in the Book's combos and
         finishes, her pilot's kills and XP */
      p.gun = `fighter:${sys.roomId}`;
      p.gunners = f.pilot ? [f.pilot] : [];
      p.pilot = f.pilot ?? null;
      combat._projectiles.push(p);
      if (typeof Audio !== 'undefined') Audio.sfx?.weaponFire?.('laser', 'laser_basic');
    }
  }

  /** Shot down (or fallen with her pilot dead): the hangar builds another. A live pilot ejects — picked up after the
   *  fight; a dead one goes with her. */
  function shootDown(ship, f, pilotDead = false) {
    f.state = 'lost'; f.rebuild = FIGHTER.REBUILD; f.hp = 0; f.order = 'hold';
    if (ours(ship)) f.noRebuild = true;                              // ours: a yard sells a new one (update256)
    const c = f.pilot;
    f.pilot = null;
    if (c && !c.dead && !pilotDead) {
      c._ejected = true;
      (f.ejected = f.ejected ?? []).push(c);
      if (typeof Particles !== 'undefined') Particles.floatText?.(f.x, f.y - 14, 'EJECT', '#ffd700', 11);
    }
    if (typeof Particles !== 'undefined') Particles.explosion?.(f.x, f.y, 0.8);
    if (typeof Audio !== 'undefined') Audio.sfx?.hullHit?.();
    if (typeof UI !== 'undefined' && !pilotDead) {
      UI.notify?.(ship.isPlayer
        ? (c && !c.dead ? `Our fighter is down — ${c.name} ejected; we pick him up after the fight. A yard sells a new one.`
                        : 'Our fighter is down — a yard sells a new one.')
        : 'Their fighter is down!', ship.isPlayer ? 'alert' : 'good');
    }
  }

  /** After a fight: every fighter home, on her platform, the lift up (no film — the fight is over); her pilot out at
   *  the console; a man who ejected picked up, hurt; and the hangar's hands patch her whole between fights. */
  function settle(ship) {
    hangars(ship).forEach(sys => {
      const f = of(sys);
      /* theirs: the fight is over and they lost it or we left — their pilot flies off (no live man appears in a wreck) */
      if (!ship.isPlayer) { if (f.pilot) f.pilot._inFighter = false; f.pilot = null; f.ejected = []; }
      /* OURS STAY WHERE THEY ARE (update256): one in the air is left outside — RECALL her before the jump; her pilot
         stays in her on the platform until he is ordered out */
      if (ours(ship)) {
        if (['out', 'returning'].includes(f.state)) { f.state = 'outside'; f.tracer = null; if (f.order !== 'recall') f.order = 'hold'; }
        if (f.state === 'docked' && f.lift > 0 && f.order === 'launch') f.order = 'hold';
      } else if (f.pilot) disembark(ship, sys, f);
      (f.ejected ?? []).forEach(c => {
        c._ejected = false;
        if (!c.dead) c.hp = Math.max(1, Math.min(c.hp, Math.round(c.maxHp * FIGHTER.EJECT_HP)));
        putBack(ship, sys, c);
      });
      f.ejected = [];
      if (!ours(ship) && f.state !== 'lost') { f.state = 'docked'; f.lift = 0; f.vx = f.vy = 0; f.tracer = null; refit(f, sys); }
    });
  }

  // ── drawing ─────────────────────────────────────────────────
  function img(name) {
    if (typeof Assets === 'undefined' || !Assets.source || Assets.source(name) !== 'file') return null;
    const i = Assets.get(name); return i && i.width ? i : null;
  }
  function icon(name) {
    if (typeof Assets === 'undefined' || !Assets.get) return null;
    try { const i = Assets.get(name); return i && i.width ? i : null; } catch (e) { return null; }
  }

  /** The lift (platform, posts) and the fighter on it, clipped to `clip` ({x, y, w, h}) — the room's inside, or the
   *  space under the keel. Everything between the floor and the keel is never drawn: the lift passes behind the duct
   *  and the keel there. */
  function drawLift(ctx, ship, room, clip) {
    const sys = room.system;
    if (!sys || sys.type !== 'hangar') return;
    const f = of(sys), G = geom(ship, room), top = platformY(G, f.lift), T = ship.trim ? ship.trim() : null;
    const P = HR().PLATFORM;
    ctx.save();
    ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip();
    /* the posts, behind the fighter: three sections each 38 u, out of each other as the lift goes down */
    const L = top - G.y, seg = 38 * G.ky;
    const posts = [P.x0 + FIGHTER.POSTS[0], P.x1 - FIGHTER.POSTS[1] - 6].map(u => G.x + u * G.kx);
    const sec = [['lift_terra_post3', 3.2], ['lift_terra_post2', 4.7], ['lift_terra_post1', 6]];
    posts.forEach(px => {
      const spans = L <= seg ? [[0, L], [0, L], [0, L]] : [[L - seg, L], [(L - seg) / 2, (L - seg) / 2 + seg], [0, seg]];
      sec.forEach(([n, wu], i) => {
        const [a, b] = spans[i], w = wu * G.kx, x = px + (6 * G.kx - w) / 2, im = img(n);
        if (im) ctx.drawImage(im, x, G.y + a, w, b - a);
        else { ctx.fillStyle = ['#5d564c', '#6d655a', '#7e7466'][i]; ctx.fillRect(x, G.y + a, w, b - a); }
      });
    });
    /* the fighter on the platform */
    if (f.state === 'docked') {
      const s = onPlatform(ship, G, f.lift);
      drawFighter(ctx, s.x, s.floor, G.kx, G.ky, s.face, T, f.hp / hullMax(f), { f, enemy: !ship.isPlayer });
    }
    /* the platform: a piece of the floor */
    const pl = img('lift_terra_platform');
    if (pl) ctx.drawImage(pl, G.px0, top, G.px1 - G.px0, 12 * G.ky);
    else { ctx.fillStyle = '#4a443c'; ctx.fillRect(G.px0, top, G.px1 - G.px0, 12 * G.ky); }
    ctx.restore();
  }
  /** Inside the room (drawn with the room). */
  function drawInRoom(ctx, ship, room) {
    drawLift(ctx, ship, room, { x: room.x, y: room.floorTop, w: room.w, h: room.floorH });
    /* her orders on the bay's wall (update256) */
    const mouse = (typeof Input !== 'undefined') ? Input.mouse : null;
    buttons(ship).filter(b => b.sys.roomId === room.id).forEach(b => {
      const over = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
      ctx.save();
      ctx.fillStyle = !b.on ? 'rgba(20,22,30,0.85)' : over ? 'rgba(26,255,140,0.35)' : 'rgba(8,24,18,0.85)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = b.on ? '#1aff8c' : '#4a4f5a'; ctx.lineWidth = 1; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      ctx.fillStyle = b.on ? '#d8ffe8' : '#7a808c'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      ctx.restore();
    });
    /* an empty cockpit: how to get a pilot in */
    const f = room.system?._fighter;
    if (ours(ship) && f && f.state === 'docked' && !f.pilot && f.lift <= 0) {
      ctx.save(); ctx.fillStyle = 'rgba(200,220,255,0.75)'; ctx.font = '7px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('NO PILOT: select a hand, click her', room.x + 4, room.y + 5); ctx.restore();
    }
  }
  /** Under the keel (drawn after the hull). */
  function drawBelow(ctx, ship) {
    hangars(ship).forEach(sys => {
      const room = roomOf(ship, sys), f = of(sys);
      if (!room || f.lift <= 0) return;
      const G = geom(ship, room);
      drawLift(ctx, ship, room, { x: room.x - 4, y: G.keel, w: room.w + 8, h: 2000 });
    });
  }

  /** HER, seen from the side, cut open: the hull round a row of mini modules (ENG · O₂ · WPN · HELM), the bulkheads
   *  with their ways through, the pilot's face in his helmet under the canopy, the droid on his rail. Painted in code
   *  until the fighters are drawn. `cx` her middle, `floor` under her skids, `face` 1 nose right. `o.f` her state
   *  (modules, pilot, droid) — without it she is drawn whole and empty; `o.enemy` the dark „stealth" of theirs. */
  function drawFighter(ctx, cx, floor, kx, ky, face, T, health = 1, o = {}) {
    const B = FIGHTER.BODY, f = o.f ?? null, enemy = !!o.enemy;
    const tail = cx - face * FIGHTER.LEN * kx / 2;
    const X = (u) => tail + face * u * kx, Y = (v) => floor - v * ky;
    const R = (u0, u1, v0, v1) => { const a = X(u0), b = X(u1); return [Math.min(a, b), Y(v1), Math.abs(b - a), (v1 - v0) * ky]; };
    const trim = (k, a) => (T && typeof trimRgba === 'function') ? trimRgba(T[k], a) : (k === 'base' ? '#4d6a8a' : '#8fd4ff');
    const hullC = enemy ? '#30353f' : '#838c98', hullL = enemy ? '#454b57' : '#a7b0bb';
    const accent = enemy ? '#c9952f' : trim('light', 0.95);
    const glass = enemy ? 'rgba(214,160,60,0.55)' : 'rgba(130,210,255,0.45)';
    const poly = (pts, fill, stroke = true) => {
      ctx.beginPath(); pts.forEach(([u, v], i) => i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); if (stroke) ctx.stroke();
    };
    ctx.save();
    ctx.lineWidth = Math.max(0.8, 0.5 * kx); ctx.strokeStyle = '#11141a'; ctx.lineJoin = 'round';
    /* skids, the wing under her, the gun under her nose, the fin over her tail, the nozzle */
    poly([[28, B.SKID], [31, 0], [38, 0], [36, B.SKID]], '#262a31');
    poly([[112, B.SKID], [115, 0], [122, 0], [120, B.SKID]], '#262a31');
    poly(enemy ? [[40, B.FLOOR], [92, B.FLOOR], [78, 1], [50, 2]] : [[44, B.FLOOR], [86, B.FLOOR], [76, 2.5], [54, 2.5]], enemy ? '#23272f' : '#5d6570');
    poly([[78, 4.2], [146, 4.2], [146, 6.2], [78, 6.2]], '#2a2f36');
    poly(enemy ? [[2, B.ROOF], [6, B.TOP + 2], [16, B.TOP + 2], [24, B.ROOF]] : [[3, B.ROOF], [7, B.TOP], [20, B.TOP], [26, B.ROOF]], enemy ? '#262a33' : trim('base', 1));
    poly([[-6, 12], [2, 11], [2, 25], [-6, 24]], '#24282e');
    /* the hull */
    poly([[2, 9], [2, 29], [12, B.ROOF], [124, B.ROOF - 0.5], [138, 26], [150, 17], [146, 12], [124, B.FLOOR], [14, B.FLOOR]], hullC);
    ctx.fillStyle = hullL; ctx.fillRect(...R(12, 124, B.ROOF - 1.2, B.ROOF - 0.4));                     // the light along her roof
    ctx.fillStyle = accent; ctx.fillRect(...R(126, 146, 15, 16.2));                                      // a stripe on her nose
    /* the bulkheads and the modules, cut open */
    SPANS.parts.forEach(([a, b]) => {
      ctx.fillStyle = hullL; ctx.fillRect(...R(a, b, B.FLOOR, B.CEIL));
      ctx.fillStyle = '#0c1016'; ctx.fillRect(...R(a, b, B.FLOOR, B.FLOOR + 14));                         // the way through
    });
    const lvl = f?.lv ?? 1;
    SPANS.mods.forEach(([a, b], i) => {
      const M = FIGHTER.MODS[i], m = f?.mods?.[i] ?? null, helm = M.k === 'helm';
      ctx.fillStyle = enemy ? '#141820' : '#18202b'; ctx.fillRect(...R(a, b, B.FLOOR, B.CEIL));
      ctx.fillStyle = enemy ? '#1d222c' : '#222c38'; ctx.fillRect(...R(a, b, B.FLOOR, B.FLOOR + 2));       // its floor
      if (!helm) {
        /* the vent under its ceiling: a grille */
        ctx.fillStyle = '#2f3946'; ctx.fillRect(...R(a + 2, b - 2, B.CEIL - 4, B.CEIL - 1.2));
        ctx.fillStyle = '#0d1117';
        for (let u = a + 3.5; u < b - 3; u += 2.4) ctx.fillRect(...R(u, u + 1, B.CEIL - 3.6, B.CEIL - 1.6));
        /* its icon */
        const ic = icon(M.icon), s = 10;
        const [ix] = R(a + (b - a - s) / 2, a + (b - a + s) / 2, 0, 0);
        if (ic) { ctx.globalAlpha = m && m.hp <= 0 ? 0.35 : 0.9; ctx.drawImage(ic, ix, Y(B.FLOOR + 15.5), s * kx, s * ky); ctx.globalAlpha = 1; }
      }
      /* its air lamp, in the top corner on the nose side */
      const air = f ? f.air : 1;
      ctx.fillStyle = (m && m.hp <= 0) ? '#ff2d44' : air < 0.25 ? '#ff2d44' : air < 0.7 ? '#ffb020' : '#1aff8c';
      const [lx] = R(b - 3.2, b - 1.6, 0, 0);
      ctx.fillRect(lx, Y(B.CEIL - 0.6), 1.6 * kx, 1.4 * ky);
      /* its pips: the level, coloured by its state */
      for (let p = 0; p < lvl; p++) {
        const st = !m ? 1 : m.hp / m.max;
        ctx.fillStyle = !m || st >= 1 ? '#1aff8c' : m.hp <= 0 ? '#ff2d44' : (p + 1) / lvl <= st ? '#1aff8c' : '#ffb020';
        ctx.fillRect(...R(a + 2 + p * 3.2, a + 4.2 + p * 3.2, B.FLOOR + 2.6, B.FLOOR + 4.2));
      }
      if (m && m.hp < m.max) {                                       // damage: orange, or red and out
        ctx.fillStyle = m.hp <= 0 ? 'rgba(255,45,68,0.32)' : 'rgba(255,150,40,0.18)';
        ctx.fillRect(...R(a, b, B.FLOOR, B.CEIL));
      }
    });
    /* the rail under her ceiling, the droid's */
    ctx.fillStyle = '#56606c'; ctx.fillRect(...R(SPANS.mods[0][0], SPANS.mods[3][0], B.CEIL - 4.6, B.CEIL - 4));
    /* the cockpit: the seat, the pilot's face in his helmet, the canopy */
    const [ha, hb] = SPANS.mods[3];
    poly([[ha + 4, B.FLOOR + 2], [ha + 4, B.FLOOR + 14], [ha + 7, B.FLOOR + 14], [ha + 9, B.FLOOR + 4], [ha + 15, B.FLOOR + 2]], '#3a4250', false);
    const pilot = f?.pilot ?? null;
    if (pilot) drawPilot(ctx, pilot, X(ha + 12), Y(B.FLOOR + 17), 13 * Math.min(kx, ky), face);
    ctx.fillStyle = '#4a5260'; ctx.fillRect(...R(hb - 8, hb - 2, B.FLOOR + 8, B.FLOOR + 10));         // the stick and the board
    poly([[ha - 1, B.ROOF - 0.5], [ha + 5, B.TOP], [hb - 6, B.TOP], [hb + 6, B.ROOF - 3], [hb, B.CEIL - 6], [ha + 2, B.CEIL - 6]], glass);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(X(ha + 7), Y(B.TOP - 1)); ctx.lineTo(X(hb - 7), Y(B.TOP - 1)); ctx.stroke();
    ctx.strokeStyle = '#11141a';
    /* the droid: on his socket his head over her roof; on his rail down in a module */
    drawDroid(ctx, f?.droid ?? { u: SOCKET, hp: FIGHTER.DROID_HP }, X, Y, kx, ky, face);
    if (health < 1) {                                                 // hurt: soot on her
      ctx.fillStyle = `rgba(20,14,10,${0.35 * (1 - health)})`;
      poly([[2, 9], [2, 29], [12, B.ROOF], [124, B.ROOF - 0.5], [138, 26], [150, 17], [146, 12], [124, B.FLOOR], [14, B.FLOOR]], ctx.fillStyle, false);
    }
    ctx.restore();
  }

  /** The pilot's face in his helmet (his portrait from the layers, the shield up), a disc `d` px wide at (x, y). */
  function drawPilot(ctx, c, x, y, d, face) {
    let p = null;
    try {
      if (typeof CrewLayers !== 'undefined' && CrewLayers.ready?.()) {
        const seed = (typeof CrewArt !== 'undefined' && CrewArt.seedOf) ? CrewArt.seedOf(c) : 1;
        p = CrewLayers.portrait(seed, c.race ?? null, c.suitColor?.() ?? '#4db8ff', false, 48);
      }
    } catch (e) { p = null; }
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, d / 2, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = c.dead ? '#3a1414' : (c.suitColor?.() ?? '#4db8ff'); ctx.fill();
    if (p) {
      ctx.clip();
      ctx.translate(x, y); if (face < 0) ctx.scale(-1, 1);
      ctx.drawImage(p, -d / 2, -d / 2, d, d);
    }
    ctx.restore();
  }

  /** The repair droid: a hexagonal head, one red eye, a stocky body, an arm (our own, not the film's dome). */
  function drawDroid(ctx, D, X, Y, kx, ky, face) {
    const B = FIGHTER.BODY, onSocket = Math.abs(D.u - SOCKET) < 0.5, dead = D.hp <= 0;
    const s = Math.min(kx, ky);
    const hx = X(D.u), hy = onSocket ? Y(B.ROOF + 2.4) : Y(B.CEIL - 9);
    ctx.save();
    if (!onSocket) {                                                  // the body hanging from the rail, and the arm
      ctx.fillStyle = dead ? '#3a3a3a' : '#6f7782';
      ctx.fillRect(hx - 1, Y(B.CEIL - 4), 2 * s, 3 * ky);
      ctx.fillStyle = dead ? '#2c2c2c' : '#5a626d';
      ctx.fillRect(hx - 3 * s, hy + 2.4 * s, 6 * s, 5 * s);
      if (D.working) {
        ctx.strokeStyle = '#8a929c'; ctx.lineWidth = Math.max(0.8, 0.8 * s);
        ctx.beginPath(); ctx.moveTo(hx + face * 3 * s, hy + 4 * s); ctx.lineTo(hx + face * 6 * s, hy + 8 * s); ctx.stroke();
        const now = (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
        if (Math.sin(now * 40) > 0) { ctx.fillStyle = '#fff2a0'; ctx.fillRect(hx + face * 6 * s - 1, hy + 8 * s - 1, 2, 2); }
      }
    }
    ctx.beginPath();                                                  // the hexagonal head
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; const px = hx + Math.cos(a) * 2.8 * s, py = hy + Math.sin(a) * 2.4 * s; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fillStyle = dead ? '#3a3a3a' : '#9aa3ae'; ctx.fill();
    ctx.strokeStyle = '#11141a'; ctx.lineWidth = Math.max(0.6, 0.4 * s); ctx.stroke();
    ctx.fillStyle = dead ? '#401010' : '#ff2d2d';                     // the one red eye
    ctx.fillRect(hx + face * 0.6 * s - 0.6 * s, hy - 0.6 * s, 1.3 * s, 1.2 * s);
    ctx.restore();
  }

  /** Her card, beside her in the air (jj 25.10: the labels by the machines, not on them): her hull in boxes, her four
   *  modules as icons in their state, her pilot. Ours under her, theirs over her. */
  function drawCard(ctx, ship, sys, f, x, y, G) {
    const w = 64, h = 21, up = !ship.isPlayer;
    const cx = Math.round(x - w / 2), cy = Math.round(up ? y - G.fighterH / 2 - h - 8 : y + G.fighterH / 2 + 10);
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.82)'; ctx.fillRect(cx, cy, w, h);
    ctx.strokeStyle = ship.isPlayer ? 'rgba(26,255,140,0.55)' : 'rgba(255,45,68,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, w - 1, h - 1);
    const hm = hullMax(f), bw = (w - 6 - (hm - 1)) / hm;
    for (let i = 0; i < hm; i++) {
      ctx.fillStyle = i < Math.ceil(f.hp) ? (ship.isPlayer ? '#1aff8c' : '#ff2d44') : 'rgba(40,48,60,0.9)';
      ctx.fillRect(cx + 3 + i * (bw + 1), cy + 3, bw, 3);
    }
    f.mods.forEach((m, i) => {
      const bx = cx + 3 + i * 15, by = cy + 8, ic = icon(FIGHTER.MODS[i].icon);
      ctx.fillStyle = m.hp <= 0 ? 'rgba(255,45,68,0.45)' : m.hp < m.max ? 'rgba(255,176,32,0.35)' : 'rgba(26,255,140,0.18)';
      ctx.fillRect(bx, by, 12, 10);
      if (ic) ctx.drawImage(ic, bx + 1.5, by + 0.5, 9, 9);
    });
    ctx.restore();
  }

  /** Every fighter in the air, both sides, and the tracers of a dogfight (game.js, after both hulls). `o.aiming` (a gun
   *  of ours is picked): their fighters' modules are outlined to be clicked, the one under the mouse lit. */
  function drawAir(ctx, ships, now = (typeof performance !== 'undefined' ? performance.now() / 1000 : 0), o = {}) {
    if (now && typeof now === 'object') { o = now; now = (typeof performance !== 'undefined' ? performance.now() / 1000 : 0); }
    (ships ?? []).forEach(ship => {
      if (!ship) return;
      hangars(ship).forEach(sys => {
        const f = of(sys), room = roomOf(ship, sys);
        if (!room) return;
        if (f.tracer) {
          ctx.save(); ctx.strokeStyle = ship.isPlayer ? 'rgba(143,228,255,0.9)' : 'rgba(255,110,90,0.9)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(f.tracer.x0, f.tracer.y0); ctx.lineTo(f.tracer.x1, f.tracer.y1); ctx.stroke(); ctx.restore();
        }
        if (f.state !== 'out' && f.state !== 'returning') return;     // on her platform she is the lift's (drawLift)
        const G = geom(ship, room), T = ship.trim ? ship.trim() : null;
        f._G = G;
        const bob = Math.sin(now * 3 + String(sys.roomId).length) * 1.2;
        /* her flame, behind her — weak with her engine out */
        const tail = f.x - f.face * FIGHTER.LEN * G.kx / 2;
        const fl = (works(f, 'eng') ? 10 : 4) + 6 * Math.sin(now * 30);
        ctx.save();
        const g = ctx.createLinearGradient(tail, 0, tail - f.face * fl * 2, 0);
        g.addColorStop(0, 'rgba(220,245,255,0.95)'); g.addColorStop(1, 'rgba(120,200,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(tail - f.face * fl, f.y + bob, Math.max(1, fl), 3 * G.ky, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        drawFighter(ctx, f.x, f.y + G.fighterH / 2 + bob, G.kx, G.ky, f.face, T, f.hp / hullMax(f), { f, enemy: !ship.isPlayer });
        drawCard(ctx, ship, sys, f, f.x, f.y, G);
        if (o.aiming && !ship.isPlayer) {
          const R = modRects(f.x, f.y + G.fighterH / 2 + bob, G.kx, G.ky, f.face);
          const mx = o.mouse?.x, my = o.mouse?.y;
          ctx.save(); ctx.lineWidth = 1; ctx.setLineDash?.([2, 2]);
          R.forEach(r => {
            const over = mx != null && mx >= r.x - 3 && mx <= r.x + r.w + 3 && my >= r.y - 6 && my <= r.y + r.h + 6;
            if (over) { ctx.fillStyle = 'rgba(255,45,68,0.3)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
            ctx.strokeStyle = over ? '#ffd0d6' : 'rgba(255,45,68,0.85)'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
          });
          ctx.restore();
        }
      });
    });
  }

  /** The line on the hangar's screen: what she is doing. */
  function status(sys) {
    const f = of(sys);
    if (f.state === 'lost') return f.noRebuild ? { t: 'NO FIGHTER', col: '#ff6a5a', sub: 'BUY AT A YARD' }
                                               : { t: `BUILD ${Math.ceil(Math.max(0, f.rebuild))}s`, col: '#ffb020', sub: 'SHOT DOWN' };
    if (f.state === 'outside') return { t: 'OUTSIDE', col: '#ffd700', sub: f.order === 'recall' ? (f.why ? f.why.toUpperCase().slice(0, 14) : 'LANDING') : 'RECALL HER' };
    if (f.state === 'out') return { t: 'IN FLIGHT', col: '#1aff8c', sub: `HULL ${Math.ceil(f.hp)}/${hullMax(f)}` };
    if (f.state === 'returning') return { t: f.why ? 'WAITING' : 'RETURNING', col: '#ffd700', sub: f.why ? (f.why.includes('console') ? 'NO LIFT MAN' : 'NO LIFT POWER') : 'LANDING' };
    if (f.lift > 0) return { t: 'LAUNCHING', col: '#8fe4ff', sub: `LIFT ${Math.round(f.lift * 100)}%` };
    if (f.pilot) return { t: 'BOARDED', col: '#8fe4ff', sub: String(f.pilot.name ?? 'PILOT').toUpperCase().slice(0, 14) };
    return { t: `DOCKED Mk${f.lv ?? 1}`, col: '#7a90a8', sub: f.why === 'nobody at the launch console' ? 'NO CONSOLE MAN' : /power/.test(f.why ?? '') ? 'NO POWER' : 'NO PILOT' };
  }

  return { of, hangars, refusal, fireEvery, geom, platformY, update, step, settle, drawInRoom, drawBelow, drawAir, drawFighter, status,
           shootDown, modRects, airRects, target, targetAt, targetLive, aimFor, track, receiveHit, hitModule, dodge, crewAway,
           board, disembark, refit, levelOf, SPANS, SOCKET,
           tierOf, markOf, poweredTier, setMark, isLost, restore, saveOf, order, buttons, buttonAt, boardAt, away, abandon, idle,
           liftWhy, launchWhy, AUTO };
})();

if (typeof window !== 'undefined') { window.Fighters = Fighters; window.FIGHTER = FIGHTER; }
