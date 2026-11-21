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

const FIGHTER = {
  HP: 3,
  SPEED: 150,              // px/s in flight
  LIFT_TIME: 2.4,          // s for the lift to go all the way down, or up
  FIRE_EVERY: [7, 5.5, 4.5], // s between her shots, by the hangar's powered level (1, 2, 3+)
  RANGE: 520,              // px: she shoots from no farther than this
  DOGFIGHT_HIT: 0.55,      // the chance one fighter's burst hits another
  MEND: 0.25,              // hp a second, docked on a working hangar
  REBUILD: 30,             // s to build another, with power
  STAND_OFF: 46,           // px off the other hull's roof or keel where she flies
  LEN: 132,                // u: her length (the hangar's platform is 166)
  CLEAR: 6,                // px between the keel and her canopy when the lift is all the way down
  SHOT: { label: 'Fighter laser', type: 'laser', damage: 1, shield_damage: 1, shieldDamage: 1, hull_damage: 1,
          moduleDamage: 1, crewDamage: [6, 14], shots: 1, projectileSpeed: 420, fireChance: 0.03, breachChance: 0 },
  POSTS: [20, 20],         // u in from each end of the platform (jj: „trochę obok brzegów")
};

const Fighters = (() => {
  const HR = () => (typeof HANGAR_ROOM !== 'undefined' ? HANGAR_ROOM : { PLATFORM: { x0: 32, x1: 198, floor: 38 } });

  /** The fighter of one hangar (its system), made the first time it is asked for. */
  function of(sys) {
    if (!sys) return null;
    if (!sys._fighter) sys._fighter = { state: 'docked', lift: 0, hp: FIGHTER.HP, x: 0, y: 0, vx: 0, vy: 0, face: 1,
                                        cd: 1.5, t: 0, wp: null, wpT: 0, tracer: null, rebuild: 0 };
    return sys._fighter;
  }
  /** Every hangar of a ship. */
  function hangars(ship) { return (ship?.systems ?? []).filter(s => s.type === 'hangar'); }
  function roomOf(ship, sys) { return ship?.getRoomById?.(sys.roomId) ?? null; }

  /** Can this hangar send its fighter out right now? null when it can, else why not. */
  function refusal(ship, sys, fighting) {
    if (!sys) return 'no hangar';
    if (sys.isDisabled()) return sys.workingLevels <= 0 ? 'the hangar is wrecked' : 'no power';
    const op = ship.consoleOperator ? ship.consoleOperator(sys.roomId) : null;
    if (!op || op.isPlayer !== ship.isPlayer || op.isPrisoner) return 'nobody at the launch console';
    if (!fighting) return 'no fight';
    return null;
  }

  /** How often she fires, by the hangar's powered level. */
  function fireEvery(sys) {
    const lv = Math.max(1, Math.min(FIGHTER.FIRE_EVERY.length, Math.floor(sys.effectivePower?.() ?? 1)));
    return FIGHTER.FIRE_EVERY[lv - 1];
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
    const fighterH = 13 * 1.5 * ky;
    const drop = (keel - rest) + fighterH + FIGHTER.CLEAR;
    return { x, y, w, h, kx, ky, px0, px1, rest, keel, drop, fighterH };
  }
  /** The platform's top right now (px). */
  function platformY(G, lift) { return G.rest + G.drop * ease(lift); }
  const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  /** Where a fighter stands on this platform: her tail and nose x, her floor (px). */
  function onPlatform(ship, G, lift) {
    const face = (ship.facesRight ?? ship.isPlayer) ? 1 : -1;
    return { face, x: (G.px0 + G.px1) / 2, floor: platformY(G, lift), len: FIGHTER.LEN * G.kx };
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
    const why = refusal(ship, sys, fighting && foe && !foe.destroyed);
    f.why = why;
    const liftTo = (t) => {
      const d = dt / FIGHTER.LIFT_TIME;
      f.lift = f.lift < t ? Math.min(t, f.lift + d) : Math.max(t, f.lift - d);
    };
    if (f.tracer) { f.tracer.t -= dt; if (f.tracer.t <= 0) f.tracer = null; }

    switch (f.state) {
      case 'docked': {
        if (f.hp < FIGHTER.HP && !sys.isDisabled()) f.hp = Math.min(FIGHTER.HP, f.hp + FIGHTER.MEND * dt);
        const go = !why && f.hp >= 1;
        liftTo(go ? 1 : 0);
        if (go && f.lift >= 1) {                                   // down under the keel: she flies off
          const s = onPlatform(ship, G, 1);
          f.state = 'out'; f.x = s.x; f.y = s.floor - G.fighterH / 2; f.face = s.face;
          f.vx = s.face * FIGHTER.SPEED * 0.6; f.vy = 0; f.cd = 1.2; f.wp = null;
          if (typeof Audio !== 'undefined' && ship.isPlayer) Audio.sfx?.weaponCharge?.();
        }
        break;
      }
      case 'out': {
        const home = why || f.hp < 1;
        liftTo(home ? 1 : 0);
        if (home) { f.state = 'returning'; break; }
        fly(dt, f, ship, foe, G, combat, sys);
        break;
      }
      case 'returning': {
        liftTo(1);
        const s = onPlatform(ship, G, 1);
        const tx = s.x, ty = s.floor - G.fighterH / 2;
        steer(dt, f, tx, ty, 1);
        if (f.lift >= 1 && Math.hypot(tx - f.x, ty - f.y) < 3) { f.state = 'docked'; f.vx = f.vy = 0; }
        else if (!why && f.hp >= 1 && f.lift < 1) { f.state = 'out'; }      // called off before she landed: back to it
        break;
      }
      case 'lost': {
        liftTo(0);
        if (!sys.isDisabled()) f.rebuild -= dt;
        if (f.rebuild <= 0) { f.state = 'docked'; f.hp = FIGHTER.HP; f.lift = 0; }
        break;
      }
    }
  }

  /** Fly towards (tx, ty); `slow` near the end. */
  function steer(dt, f, tx, ty, slow = 0) {
    const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
    const sp = FIGHTER.SPEED * (slow ? Math.min(1, d / 60 + 0.15) : 1);
    const want = { x: dx / d * sp, y: dy / d * sp };
    const k = Math.min(1, dt * 3);
    f.vx += (want.x - f.vx) * k; f.vy += (want.y - f.vy) * k;
    if (d < sp * dt) { f.x = tx; f.y = ty; } else { f.x += f.vx * dt; f.y += f.vy * dt; }
    if (Math.abs(f.vx) > 8) f.face = f.vx > 0 ? 1 : -1;
  }

  /** Out: pick a point off her hull, go there, shoot. */
  function fly(dt, f, ship, foe, G, combat, sys) {
    const b = foe.roomBounds ? foe.roomBounds() : null;
    if (!b) return;
    f.wpT -= dt;
    if (!f.wp || f.wpT <= 0) {
      const above = Math.random() < 0.5;
      f.wp = { x: b.x + Math.random() * b.w, y: above ? b.y - FIGHTER.STAND_OFF - 18 : b.y + b.h + FIGHTER.STAND_OFF + 10 };
      f.wpT = 3 + Math.random() * 2;
    }
    steer(dt, f, f.wp.x, f.wp.y, 1);
    /* the enemy's fighter first, if she is out */
    const theirs = hangars(foe).map(of).filter(o => o && o.state === 'out');
    f.cd -= dt;
    if (f.cd > 0) return;
    if (theirs.length) {
      const t = theirs[0];
      f.cd = fireEvery(sys) * 0.6;
      f.face = t.x >= f.x ? 1 : -1;
      const hit = Math.random() < FIGHTER.DOGFIGHT_HIT;
      f.tracer = { x0: f.x + f.face * 30, y0: f.y, x1: t.x, y1: t.y + (hit ? 0 : 14), t: 0.14 };
      if (hit) {
        t.hp -= 1;
        if (typeof Particles !== 'undefined') Particles.laserHit?.(t.x, t.y);
        if (t.hp <= 0) shootDown(foe, t);
      }
      return;
    }
    const rooms = (foe.rooms ?? []).filter(r => r.system || r.type !== 'empty');
    const room = rooms.length ? rooms[Math.floor(Math.random() * rooms.length)] : null;
    if (!room || Math.hypot(room.cx - f.x, room.cy - f.y) > FIGHTER.RANGE) { f.cd = 0.5; return; }
    f.cd = fireEvery(sys);
    f.face = room.cx >= f.x ? 1 : -1;
    if (combat?._projectiles && typeof Projectile !== 'undefined') {
      const p = new Projectile({ x: f.x + f.face * 30, y: f.y, targetX: room.cx, targetY: room.cy, speed: FIGHTER.SHOT.projectileSpeed,
                                 type: 'laser', def: FIGHTER.SHOT, defKey: 'laser_basic', fromPlayer: !!ship.isPlayer });
      p.fromFighter = true;
      combat._projectiles.push(p);
      if (typeof Audio !== 'undefined') Audio.sfx?.weaponFire?.('laser', 'laser_basic');
    }
  }

  function shootDown(ship, f) {
    f.state = 'lost'; f.rebuild = FIGHTER.REBUILD; f.hp = 0;
    if (typeof Particles !== 'undefined') Particles.explosion?.(f.x, f.y, 0.8);
    if (typeof Audio !== 'undefined') Audio.sfx?.hullHit?.();
    if (typeof UI !== 'undefined') UI.notify?.(ship.isPlayer ? 'Our fighter is down — the hangar is building another.' : 'Their fighter is down!', ship.isPlayer ? 'alert' : 'good');
  }

  /** After a fight: every fighter home, on her platform, the lift up (no film — the fight is over). */
  function settle(ship) {
    hangars(ship).forEach(sys => {
      const f = of(sys);
      if (f.state !== 'lost') { f.state = 'docked'; f.lift = 0; f.vx = f.vy = 0; f.tracer = null; }
    });
  }

  // ── drawing ─────────────────────────────────────────────────
  function img(name) {
    if (typeof Assets === 'undefined' || !Assets.source || Assets.source(name) !== 'file') return null;
    const i = Assets.get(name); return i && i.width ? i : null;
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
      drawFighter(ctx, s.x, s.floor, G.kx, G.ky, s.face, T, f.hp / FIGHTER.HP);
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

  /** A plain fighter (update249's, painted in code until the fighters are drawn): `cx` her middle, `floor` under her
   *  skids, `face` 1 nose right. `health` 0..1 darkens her as she is hurt. */
  function drawFighter(ctx, cx, floor, kx, ky, face, T, health = 1) {
    const len = FIGHTER.LEN * kx, tail = cx - face * len / 2, nose = cx + face * len / 2;
    const X = (fr) => tail + (nose - tail) * fr, Y = (u) => floor - u * 1.5 * ky;
    const trim = (k, a) => (T && typeof trimRgba === 'function') ? trimRgba(T[k], a) : (k === 'base' ? '#4d6a8a' : '#8fd4ff');
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([fr, u], i) => i ? ctx.lineTo(X(fr), Y(u)) : ctx.moveTo(X(fr), Y(u))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
    ctx.save();
    ctx.lineWidth = Math.max(1, 0.5 * kx); ctx.strokeStyle = '#14171c'; ctx.lineJoin = 'round';
    poly([[0.16, 3], [0.2, 0], [0.26, 0], [0.24, 3]], '#2a2f36');                                 // the skids
    poly([[0.72, 3], [0.75, 0], [0.81, 0], [0.8, 3]], '#2a2f36');
    poly([[0.02, 12.5], [0.14, 12.5], [0.22, 8], [0.06, 8]], trim('base', 1));                    // the tail fin
    poly([[0, 4], [0, 9], [0.3, 10], [0.62, 10.5], [0.9, 7.5], [1, 6], [0.9, 4.5], [0.3, 3]], '#7d8590');   // the body
    ctx.fillStyle = '#b9c1cb'; ctx.fillRect(Math.min(X(0.04), X(0.6)), Y(9.6), Math.abs(X(0.6) - X(0.04)), 1 * ky);
    poly([[0.28, 6], [0.56, 6], [0.4, 2], [0.24, 2]], '#4b525c');                                // the wing
    ctx.fillStyle = trim('light', 0.95); ctx.fillRect(Math.min(X(0.12), X(0.5)), Y(6.4), Math.abs(X(0.5) - X(0.12)), 1.2 * ky);
    poly([[0.6, 10.3], [0.76, 9.4], [0.86, 7.8], [0.66, 7.8]], 'rgba(130,210,255,0.9)');          // the canopy
    poly([[-0.04, 4.6], [0, 4.6], [0, 8.4], [-0.04, 8.4]], '#2a2f36');                            // the nozzle
    if (health < 1) {                                                                            // hurt: soot on her
      ctx.fillStyle = `rgba(20,14,10,${0.45 * (1 - health)})`;
      poly([[0, 4], [0, 9], [0.3, 10], [0.62, 10.5], [0.9, 7.5], [1, 6], [0.9, 4.5], [0.3, 3]], ctx.fillStyle);
    }
    ctx.restore();
  }

  /** Every fighter in the air, both sides, and the tracers of a dogfight (game.js, after both hulls). */
  function drawAir(ctx, ships, now = (typeof performance !== 'undefined' ? performance.now() / 1000 : 0)) {
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
        const bob = Math.sin(now * 3 + sys.roomId.length) * 1.2;
        /* her flame, behind her */
        const tail = f.x - f.face * FIGHTER.LEN * G.kx / 2;
        const fl = 10 + 6 * Math.sin(now * 30);
        ctx.save();
        const g = ctx.createLinearGradient(tail, 0, tail - f.face * fl * 2, 0);
        g.addColorStop(0, 'rgba(220,245,255,0.95)'); g.addColorStop(1, 'rgba(120,200,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(tail - f.face * fl, f.y + bob, fl, 3 * G.ky, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        drawFighter(ctx, f.x, f.y + G.fighterH / 2 + bob, G.kx, G.ky, f.face, T, f.hp / FIGHTER.HP);
        if (f.hp < FIGHTER.HP) {                                     // her health, three boxes over her
          for (let i = 0; i < FIGHTER.HP; i++) {
            ctx.fillStyle = i < Math.ceil(f.hp) ? (ship.isPlayer ? '#1aff8c' : '#ff2d44') : 'rgba(20,24,32,0.9)';
            ctx.fillRect(f.x - 10 + i * 7, f.y - G.fighterH / 2 - 8, 6, 3);
          }
        }
      });
    });
  }

  /** The line on the hangar's screen: what she is doing. */
  function status(sys) {
    const f = of(sys);
    if (f.state === 'lost') return { t: `BUILD ${Math.ceil(Math.max(0, f.rebuild))}s`, col: '#ffb020', sub: 'SHOT DOWN' };
    if (f.state === 'out') return { t: 'IN FLIGHT', col: '#1aff8c', sub: `HP ${Math.ceil(f.hp)}/${FIGHTER.HP}` };
    if (f.state === 'returning') return { t: 'RETURNING', col: '#ffd700', sub: f.why ? f.why.toUpperCase().slice(0, 14) : 'LANDING' };
    if (f.lift > 0) return { t: 'LAUNCHING', col: '#8fe4ff', sub: `LIFT ${Math.round(f.lift * 100)}%` };
    return { t: 'DOCKED', col: '#7a90a8', sub: f.why === 'nobody at the launch console' ? 'NO PILOT' : f.why === 'no power' ? 'NO POWER' : 'READY' };
  }

  return { of, hangars, refusal, fireEvery, geom, platformY, update, step, settle, drawInRoom, drawBelow, drawAir, drawFighter, status, shootDown };
})();

if (typeof window !== 'undefined') { window.Fighters = Fighters; window.FIGHTER = FIGHTER; }
