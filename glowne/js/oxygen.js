/* ============================================================
   MOON WARS — oxygen.js
   Per-room oxygen simulation.
   Breaches and open doors cause O2 drain.
   Crew suffocate if O2 hits zero for too long.
   ============================================================ */

'use strict';

const OXYGEN = {
  MAX:            1.0,   // full = 1.0
  DRAIN_BREACH:   0.07,  // per second per breach
  DRAIN_VACUUM: 0.216,  // faster venting through an open airlock,  // per second — room open to space
  FILL_RATE:      0.05,  // per second when O2 system is on and powered
  WARN_LEVEL:     0.25,  // yellow warning
  CRIT_LEVEL:     0.10,  // red critical
  DAMAGE_RATE:    5,     // hp/sec crew take when O2 = 0
  DAMAGE_DELAY:   3.0,   // seconds at zero before crew start suffocating
};

class RoomOxygen {
  /** @param {string} roomId */
  constructor(roomId) {
    this.roomId = roomId;
    this.level  = OXYGEN.MAX;     // 0–1
    this._suffocateTimer = 0;     // time crew has been in vacuum
  }

  /** Returns current level 0–1 */
  get value() { return this.level; }

  get isCritical() { return this.level <= OXYGEN.CRIT_LEVEL; }
  get isWarning()  { return this.level <= OXYGEN.WARN_LEVEL; }

  /**
   * @param {number}  dt
   * @param {boolean} o2SystemOn  - O2 system powered?
   * @param {number}  breachCount - active hull breaches in this room
   * @param {boolean} isVacuum    - room open to space?
   * @param {Array}   crew        - crew in room
   */
  update(dt, o2Power, breachCount = 0, isVacuum = false, crew = []) {
    if (isVacuum) {
      this.level = Math.max(0, this.level - OXYGEN.DRAIN_VACUUM * dt);
    } else if (breachCount > 0) {
      this.level = Math.max(0, this.level - OXYGEN.DRAIN_BREACH * breachCount * dt);
    }

    if (!isVacuum) {
      // Net O2 change: refill from powered O2 system MINUS passive
      // consumption (crew breathing / leakage). Module off → ship
      // slowly suffocates even without breaches, exactly like FTL.
      const refill = 0.03 * o2Power;
      const drain  = 0.014;
      this.level = Utils.clamp(this.level + (refill - drain) * dt, 0, OXYGEN.MAX);
    }

    // Crew suffocation
    if (this.level <= 0) {
      this._suffocateTimer += dt;
      if (this._suffocateTimer >= OXYGEN.DAMAGE_DELAY) {
        crew.forEach(c => {
          if (c && !c.dying) c.takeDamage(OXYGEN.DAMAGE_RATE * dt, 'suffocation');
        });
        // Alert once
        if (Math.floor(this._suffocateTimer) !== Math.floor(this._suffocateTimer - dt)) {
          Audio.sfx.oxygenLow();
        }
      }
    } else {
      this._suffocateTimer = 0;
    }
  }

  /** Force fill (when O2 system repaired / installed) */
  fill(amount = 0.2) {
    this.level = Math.min(OXYGEN.MAX, this.level + amount);
  }

  /** Draw O2 indicator overlay in room */
  draw(ctx, x, y, w, h) {
    if (this.level >= OXYGEN.MAX * 0.95) return; // no overlay at full O2

    const alpha = (1 - this.level) * 0.35;
    ctx.fillStyle = this.isCritical
      ? `rgba(180,30,30,${alpha})`
      : `rgba(30,100,180,${alpha})`;
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

    // O2 text
    const pct = Math.round(this.level * 100);
    ctx.fillStyle = this.isCritical ? '#ff2d44' : '#4db8ff';
    ctx.font      = '8px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`O₂ ${pct}%`, x + w / 2, y + h / 2 + 3);
  }
}

// ── Ship-wide oxygen manager ──────────────────────────────

class OxygenManager {
  constructor() {
    /** roomId → RoomOxygen */
    this._rooms = new Map();
  }

  addRoom(roomId) {
    if (!this._rooms.has(roomId)) {
      this._rooms.set(roomId, new RoomOxygen(roomId));
    }
  }

  getRoom(roomId) { return this._rooms.get(roomId) || null; }

  /**
   * @param {Ship}   ship
   * @param {number} dt
   */
  update(dt, ship) {
    const o2Sys   = ship.getSystem('oxygen');
    const o2Power = o2Sys ? o2Sys.effectivePower() : 0;

    ship.rooms.forEach(room => {
      const ro = this._rooms.get(room.id);
      if (!ro) return;

      const breaches = ship.breaches.breaches.filter(b => b.roomId === room.id && !b.sealed).length;
      const crew     = ship.crew.filter(c => c.roomId === room.id && !c.dead);

      ro.update(dt, o2Power, breaches, room.isVacuum ?? false, crew);
    });

    // ── FTL air-flow: open doors equalise O2 between rooms ──
    // A breached room with an open door drains its neighbours too.
    if (ship.doors) {
      ship.doors.forEach(d => {
        if (!d.open) return;
        const a = this._rooms.get(d.roomA);
        const b = this._rooms.get(d.roomB);
        if (!a || !b) return;
        const avg  = (a.level + b.level) / 2;
        // Faster flow: an open door dumps air noticeably quicker
        const rate = Utils.clamp(dt * 3.5, 0, 0.6);
        a.level += (avg - a.level) * rate;
        b.level += (avg - b.level) * rate;
      });
    }
  }

  /** Average O2 across all rooms (for HUD display) */
  averageO2() {
    if (this._rooms.size === 0) return 1;
    let sum = 0;
    this._rooms.forEach(r => { sum += r.level; });
    return sum / this._rooms.size;
  }

  isAnyRoomCritical() {
    for (const r of this._rooms.values()) {
      if (r.isCritical) return true;
    }
    return false;
  }

  reset() {
    this._rooms.forEach(r => { r.level = OXYGEN.MAX; r._suffocateTimer = 0; });
  }
}
