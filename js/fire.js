/* ============================================================
   MOON WARS — fire.js
   Per-room fire simulation.
   Fires spread to adjacent rooms, damage systems and crew,
   and consume oxygen. Crew can suppress fires.
   ============================================================ */

'use strict';

const FIRE_DEFS = {
  SPREAD_TIME:    12.0,  // seconds of burning before a spread attempt
  SPREAD_CHANCE:  0.6,   // probability per spread attempt
  GROW_TIME:      9.0,   // unfought fires grow +1 intensity this often
  DAMAGE_RATE:    0.5,   // system hp/sec damage per fire
  CREW_DAMAGE:    3.0,   // hp/sec crew take inside burning room
  SUPPRESS_RATE:  0.35,  // intensity reduced per second (per crew fighting)
  O2_DRAIN:       0.03,  // extra O2 drain per fire per second
  MAX_INTENSITY:  3,     // fire intensity levels (1=small, 2=medium, 3=large)
  HULL_BURN_TIME: 6.0,   // burning ship loses 1 hull this often
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

    // Particle emission
    if (this._particleTimer.tick(dt)) {
      Particles.fireParticles(
        this.x + Utils.randFloat(-12, 12),
        this.y + Utils.randFloat(-8, 8)
      );
      if (this.intensity >= 2) Particles.smokeTrail(this.x, this.y - 16);
    }
  }

  /** Crew firefighting — reduce intensity */
  suppress(amount) {
    this.intensity = Math.max(0, this.intensity - amount * FIRE_DEFS.SUPPRESS_RATE);
    if (this.intensity <= 0) {
      this.out = true;
      Audio.sfx.fireStart();
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

      const crewInRoom = ship.crew.filter(c =>
        c.roomId === fire.roomId && !c.dead
      );

      fire.update(dt, room, crewInRoom);

      // Fire spread — burning long enough jumps to ANY adjacent room
      // on the same floor. Closed doors do NOT stop it (heat travels
      // through bulkheads); only venting the room to vacuum kills it.
      if (fire.spreadReady && Math.random() < FIRE_DEFS.SPREAD_CHANCE) {
        fire.resetSpreadTimer();
        const room = ship.getRoomById(fire.roomId);
        const adj = (room?.adjacent ?? [])
          .map(id => ship.getRoomById(id))
          .filter(r => r && r.floor === room.floor);
        if (adj.length > 0) {
          const target = Utils.pick(adj);
          this.start(target.id, target.cx, target.cy);
          if (ship.isPlayer && typeof UI !== 'undefined') {
            UI.notify('FIRE SPREADING!', 'alert');
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

  draw(ctx) {
    this._fires.forEach(f => f.draw(ctx));
  }

  clear() { this._fires = []; }
}
