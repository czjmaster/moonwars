/* ============================================================
   MOON WARS — oxygen.js
   Per-room oxygen simulation.
   Breaches and open doors cause O2 drain.
   Crew suffocate if O2 hits zero for too long.
   ============================================================ */

'use strict';

const OXYGEN = {
  MAX:            1.0,   // full = 1.0
  DRAIN_BREACH:   0.16,  // per second per breach  (update54: was 0.07)
  DRAIN_VACUUM: 0.216,  // faster venting through an open airlock,  // per second — room open to space
  FILL_RATE:      0.05,  // per second when O2 system is on and powered
  WARN_LEVEL:     0.25,  // yellow warning
  CRIT_LEVEL:     0.10,  // red critical
  /* WHAT THE ROOM LOSES WITH NOBODY MAKING AIR (update54).
     There is ONE consumption number and the O2 module pays it back;
     losing the module does not add a second drain, it stops the
     repayment. BREATHING is what the crew takes out of the room no
     matter what, and it used to be 0.014/s — a dead O2 module gave the
     player seventy-one seconds of full air, which is longer than most
     fights, so a wrecked life-support module was not frightening.
     0.04 empties a full compartment in twenty-five seconds: long
     enough to walk out, short enough to matter.
     A HULL BREACH is the other half of the same complaint. At 0.07 a
     hole took fourteen seconds to empty a room and the patch was
     almost always faster; 0.16 makes it seven, so a breach in the
     medbay is a decision and not a chore. */
  BREATHING:      0.04,  // per second, always (update54: was 0.014)
  /* ONE PIP STILL RUNS THE AIR. Raised with BREATHING so that the
     oldest promise in this file — a derelict on a single unit of power
     keeps breathable air — survives the new drain. 0.06 against 0.04
     leaves one pip a slow net gain, which is what it always was. */
  REFILL_PER_POWER: 0.06,   // per second per power (update54: was 0.03)
  /* DAMAGE_RATE and DAMAGE_DELAY used to live here.
     DAMAGE_DELAY was a three-second grace period the ROOM held on
     behalf of everybody standing in it — which is the same quantity
     as a man's own supply of air, kept in a second place. update47
     gives every body a tank of its own (SUIT_AIR, crew.js) and
     DELETED the room's copy, the rate along with it. One number for
     how long a man lasts in vacuum, and it belongs to the man. */
};

class RoomOxygen {
  /** @param {string} roomId */
  constructor(roomId) {
    this.roomId = roomId;
    this.level  = OXYGEN.MAX;     // 0–1
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
      const refill = OXYGEN.REFILL_PER_POWER * o2Power;
      const drain  = OXYGEN.BREATHING;
      this.level = Utils.clamp(this.level + (refill - drain) * dt, 0, OXYGEN.MAX);
    }

    /* ── BOTTLED AIR (update47) ────────────────────────────
       A vented compartment is a COUNTDOWN now, not a wall. Every
       body in it breathes off its own tank; walk a man through and
       out the far side and he comes out alive with the bottle to
       show for it. He only starts taking damage when his own supply
       is gone — which is why the room no longer keeps a timer.

       The room does not know how long anybody lasts. That number is
       the suit's, and it differs: a Pegasus hand outlives a Terra
       one by a factor of three, and vermin, with no suit at all,
       die the moment the air goes. Venting a compartment is a way
       to kill rats. */
    const air = (typeof SUIT_AIR !== 'undefined') ? SUIT_AIR : null;
    if (air) {
      const breathable = this.level > 0;
      crew.forEach(c => {
        if (!c || c.dying || c.dead) return;
        const max = c.airMax ? c.airMax() : 0;
        if (breathable) {
          c.air = Math.min(max, (c.air ?? max) + air.REFILL_PER_SEC * dt);
          c._airAlarm = false;
          return;
        }
        c.air = Math.max(0, (c.air ?? max) - dt);
        if (c.air > 0) return;
        if (!c._airAlarm) {
          c._airAlarm = true;
          Audio.sfx.oxygenLow();
        }
        c.takeDamage(air.DAMAGE_PER_SEC * dt, 'suffocation');
      });
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
    this._rooms.forEach(r => { r.level = OXYGEN.MAX; });
  }
}
