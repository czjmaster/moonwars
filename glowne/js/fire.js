/* ============================================================
   MOON WARS — fire.js
   Per-room fire simulation.
   Fires spread to adjacent rooms, damage systems and crew,
   and consume oxygen. Crew can suppress fires.
   ============================================================ */

'use strict';

/* SLOWER FIRE (update87). The player: "ogień za szybko się rozprzestrzenia
   i za szybko robi obrażenia". Every clock here is stretched by about
   two thirds, and the spread roll is a little less sure: a fire is still
   a crisis, but one there is time to answer. The old values are kept in
   the comments so the change is one read away. */
const FIRE_DEFS = {
  SPREAD_TIME:    20.0,  // seconds of burning before a spread attempt   (was 12)
  SPREAD_CHANCE:  0.45,  // probability per spread attempt               (was 0.6)
  GROW_TIME:      15.0,  // unfought fires grow +1 intensity this often  (was 9)
  DAMAGE_RATE:    0.3,   // system hp/sec damage per fire                (was 0.5)
  CREW_DAMAGE:    1.8,   // hp/sec crew take inside burning room         (was 3)
  SUPPRESS_RATE:  0.35,  // intensity reduced per second (per crew fighting)
  O2_DRAIN:       0.03,  // extra O2 drain per fire per second
  MAX_INTENSITY:  3,     // fire intensity levels (1=small, 2=medium, 3=large)
  HULL_BURN_TIME: 10.0,  // burning ship loses 1 hull this often         (was 6)
  /* A SHUT DOOR IS WORTH SOMETHING NOW (update42).
     Fire used to jump to ANY adjacent room regardless of doors, so
     sealing a burning module did nothing at all and every door button
     was decoration in a fire. Heat still crosses a cold bulkhead — the
     player asked for that explicitly — but at a fraction of the rate,
     which is what makes an armoured door a real upgrade later. */
  CLOSED_DOOR_FACTOR: 0.2,
  /* THE DUCT IS THE ROUTE (update85, U11). A burning module sets its
     ceiling duct alight after this long, and the duct is what carries
     the fire on: the spread below only happens once it is lit. The
     duct has no fire of its own — the player's call, "tylko
     pośrednik" — so it burns exactly while the module under it does,
     and not at all once its own air is gone. */
  DUCT_CATCH:     4.0,
  /** A duct with less air than this will not burn. */
  DUCT_MIN_AIR:   0.08,
};

let _nextFireId = 1;

class Fire {
  /**
   * @param {string} roomId  - room the fire is in
   * @param {number} x       - world x
   * @param {number} y       - world y
   */
  constructor(roomId, x, y) {
    this.id        = _nextFireId++;
    this.roomId    = roomId;
    this.x         = x;
    this.y         = y;
    this.intensity = 1;       // 1–3
    this.out       = false;
    this._spreadTimer  = 0;
    this._particleTimer = new Utils.Interval(0.08);
  }

  /**
   * @param {number} dt
   * @param {object} room        - room object with system ref
   * @param {Array}  crewInRoom  - crew members in this room
   */
  update(dt, room, crewInRoom = []) {
    if (this.out) return;
    this.age = (this.age ?? 0) + dt;

    // Damage system in room
    if (room.system) {
      room.system.takeDamage(FIRE_DEFS.DAMAGE_RATE * this.intensity * dt);
    }

    // Damage crew inside
    crewInRoom.forEach(c => {
      if (!c.dying) c.takeDamage(FIRE_DEFS.CREW_DAMAGE * dt, 'fire');
    });

    // Spread timer
    this._spreadTimer += dt;

    // Unfought fires GROW: +1 intensity every GROW_TIME seconds.
    // Crew suppression outpaces growth, so fighting it still wins.
    this._growTimer = (this._growTimer ?? 0) + dt;
    if (this._growTimer >= FIRE_DEFS.GROW_TIME) {
      this._growTimer = 0;
      if (this.intensity < FIRE_DEFS.MAX_INTENSITY) this.grow();
    }

    // Particle emission — a ball of flame in zero-G (update91), nothing rises.
    if (this._particleTimer.tick(dt)) {
      if (this.zeroG && Particles.fireParticlesZeroG) {
        Particles.fireParticlesZeroG(this.x, this.y - 6, this.intensity);
      } else {
        Particles.fireParticles(
          this.x + Utils.randFloat(-12, 12),
          this.y + Utils.randFloat(-8, 8)
        );
        if (this.intensity >= 2) Particles.smokeTrail(this.x, this.y - 16);
      }
    }
  }

  /** Crew firefighting — reduce intensity */
  /**
   * Crew firefighting — reduce intensity.
   *
   * `by` is who is holding the extinguisher (update71). `Breach.repair`
   * has always taken the man doing the work; this one did not, so the
   * moment a fire went out there was nothing to say WHOSE fire it was
   * — and a side objective about beating fires would have counted the
   * enemy putting out his own.
   */
  suppress(amount, by = null) {
    this.intensity = Math.max(0, this.intensity - amount * FIRE_DEFS.SUPPRESS_RATE);
    if (this.intensity <= 0) {
      this.out = true;
      Audio.sfx.fireStart();
      if (by && by.isPlayer && typeof Save !== 'undefined') Save.goalEvent?.('fires');
    }
  }

  get spreadReady() {
    return this._spreadTimer >= FIRE_DEFS.SPREAD_TIME && this.intensity >= 2;
  }

  resetSpreadTimer() { this._spreadTimer = 0; }

  /** Grow intensity (up to max) */
  grow() {
    this.intensity = Math.min(FIRE_DEFS.MAX_INTENSITY, this.intensity + 1);
  }

  draw(ctx) {
    if (this.out) return;
    /* ZERO-G FLAME (update91): the same fire, drawn as a pulsing sphere —
       with no "up" there is no plume. Gravity back, it is drawn as before.
       A visual state of this object only; nothing is created or destroyed. */
    if (this.zeroG) {
      const t = (this.age ?? 0);
      const r = (7 + this.intensity * 4) * (1 + 0.12 * Math.sin(t * 7));
      const cy = this.y - 6;
      const g = ctx.createRadialGradient(this.x, cy, 0, this.x, cy, r);
      g.addColorStop(0,    `rgba(255,240,180,${0.45 * this.intensity})`);
      g.addColorStop(0.45, `rgba(255,140,40,${0.35 * this.intensity})`);
      g.addColorStop(1,    'rgba(255,60,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, cy, r, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // Fires are drawn via particle system; this draws a static indicator
    const r = 8 + this.intensity * 4;
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
    g.addColorStop(0, `rgba(255,200,50,${0.3 * this.intensity})`);
    g.addColorStop(0.5, `rgba(255,80,10,${0.2 * this.intensity})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(this.x - r, this.y - r, r*2, r*2);
  }
}

// ── Fire manager ──────────────────────────────────────────

class FireManager {
  constructor() {
    this._fires = [];
  }

  get fires() { return this._fires; }

  /** Start a fire in a room */
  start(roomId, x, y) {
    // Don't stack fires too close together
    const existing = this._fires.find(f =>
      !f.out && f.roomId === roomId && Utils.dist(f.x, f.y, x, y) < 32
    );
    if (existing) {
      existing.grow();
      Audio.sfx.fireStart();
      return existing;
    }

    const fire = new Fire(roomId, x, y);
    this._fires.push(fire);
    Audio.sfx.fireStart();
    return fire;
  }

  update(dt, ship) {
    const activeFires = this._fires.filter(f => !f.out);

    activeFires.forEach(fire => {
      const room     = ship.getRoomById(fire.roomId);
      if (!room) { fire.out = true; return; }

      // FTL rule: fire needs oxygen — venting a room extinguishes it
      const ro = ship.oxygen.getRoom(fire.roomId);
      if (ro && ro.level < 0.08) {
        fire.suppress(dt * 3);   // suffocates rapidly in vacuum
        if (fire.out) return;
      }

      // `inRoom` (update42): somebody standing in the elevator trunk
      // kept the stale roomId of the module he had left, and burned
      // for it from the far side of a wall.
      const crewInRoom = ship.crew.filter(c =>
        c.roomId === fire.roomId && !c.dead && c.inRoom !== false
      );

      fire.zeroG = !!ship.zeroG;             // visual state only (update91)
      fire.update(dt, room, crewInRoom);

      /* Fire spread — burning long enough tries the neighbours on this
         floor. Each way through is rolled on its OWN merits: an open
         door at the full SPREAD_CHANCE, a shut one at a fifth of it.
         Venting the room to vacuum still kills the fire outright. */
      if (fire.spreadReady && this.ductBurning(ship, fire.roomId)) {
        fire.resetSpreadTimer();
        const ways = ship.adjacentThermal
          ? ship.adjacentThermal(fire.roomId)
          : (ship.getRoomById(fire.roomId)?.adjacent ?? [])
              .map(id => ({ room: ship.getRoomById(id), open: true }))
              .filter(w => w.room);
        // Zero-G: a fifth of the spread (update91, GRAVITY_CONFIG).
        const zg = (ship.zeroG && typeof GRAVITY_CONFIG !== 'undefined')
          ? GRAVITY_CONFIG.fireSpreadMultiplier : 1;
        const lit = ways.filter(w => Math.random() <
          FIRE_DEFS.SPREAD_CHANCE * zg * (w.open ? 1 : FIRE_DEFS.CLOSED_DOOR_FACTOR));
        if (lit.length > 0) {
          const way = Utils.pick(lit);
          this.start(way.room.id, way.room.cx, way.room.cy);
          if (ship.isPlayer && typeof UI !== 'undefined') {
            UI.notify(way.open ? 'FIRE SPREADING!'
                               : 'Fire burned THROUGH a sealed door!', 'alert');
          }
        }
      }
    });

    // A burning ship slowly cooks its own hull: −1 HP every few
    // seconds for as long as ANY fire is alive aboard.
    if (activeFires.length > 0) {
      this._hullBurnTimer = (this._hullBurnTimer ?? 0) + dt;
      if (this._hullBurnTimer >= FIRE_DEFS.HULL_BURN_TIME) {
        this._hullBurnTimer = 0;
        ship.hull = Math.max(0, ship.hull - 1);
        const f = activeFires[0];
        Particles.floatText(f.x, f.y - 16, '-1 HULL', '#ff7c20', 12);
        if (ship.isPlayer && typeof UI !== 'undefined') {
          UI.notify('Fire is burning through the hull!', 'warn');
        }
      }
    } else {
      this._hullBurnTimer = 0;
    }

    // Clean up dead fires
    this._fires = this._fires.filter(f => !f.out);
  }

  getFiresInRoom(roomId) {
    return this._fires.filter(f => !f.out && f.roomId === roomId);
  }

  hasFireInRoom(roomId) {
    return this._fires.some(f => !f.out && f.roomId === roomId);
  }

  /** Is the duct over this room alight? See FIRE_DEFS.DUCT_CATCH. */
  ductBurning(ship, roomId) {
    const ro = ship?.oxygen?.getRoom?.(roomId);
    if (ro && (ro.duct ?? 1) < FIRE_DEFS.DUCT_MIN_AIR) return false;
    return this._fires.some(f => !f.out && f.roomId === roomId &&
                                 (f.age ?? 0) >= FIRE_DEFS.DUCT_CATCH);
  }

  draw(ctx) {
    this._fires.forEach(f => f.draw(ctx));
  }

  clear() { this._fires = []; }
}
