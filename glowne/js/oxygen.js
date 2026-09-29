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
  /* ══ AIR IS A BUDGET NOW (update82) ══════════════════════════
   *
   * What was here was broken, and broken in a way that made the whole
   * module pointless. Both halves were PER ROOM:
   *
   *   refill = REFILL_PER_POWER * o2Power     …in every room
   *   drain  = BREATHING                      …in every room
   *
   * Every compartment got the FULL output of the module, so the same
   * one pip produced six times as much air on a six-room hull as on a
   * one-room hull; and the drain was a flat number per room whether it
   * held three men or nobody at all. A single unit of power therefore
   * ran any ship forever, and the size of the crew did not enter into
   * it anywhere. The player saw it: "jeden pips utrzymuje caly statek
   * w nieskonczonosc".
   *
   * Now there is ONE production, ONE consumption and ONE balance for
   * the hull, and the crew are in it.
   *
   * PER_POWER is set so that one unit of power carries THREE
   * crewmen — the player's number: "1 lev = 3 zalogantow". A full
   * crew on a single pip therefore runs a DEFICIT, which is the point:
   * life support becomes something you allocate against, rather than a
   * light you switch on once.
   *
   * BREATHING is per MAN per second now, not per room. The number is
   * unchanged, so a vented compartment empties at the same rate it has
   * since update54 — see the breach numbers below, which are the other
   * half of the same complaint and are untouched. */
  BREATHING:      0.04,   // per CREWMAN per second (update82: was per room)
  /* ══ THE DUCT HAS AIR OF ITS OWN (update85, U11) ══════════════
   *
   * Every compartment's ceiling duct holds its own small volume, and
   * the ORDER in which the two empty is the player's rule (29.09):
   *
   *   · a HOLE in the room — an open airlock or a breach — takes the
   *     ROOM's air first; the duct bleeds out after it, once the
   *     room below is empty;
   *   · a DEFICIT — the O2 module off, or too many mouths for it —
   *     comes out of the DUCT first, because the air pipes run in the
   *     duct: the room goes stale only once its duct is dry. A surplus
   *     fills the duct first for the same reason.
   *
   * So the two switches the player already has do different things to
   * the rats: cutting the module suffocates the ducts before the crew
   * notice, and blowing the airlock empties the room — and puts out its
   * fire — well before the rats in its ceiling feel it.
   *
   * DUCT_THIN: the duct is a thin pipe, so a given amount of air moves
   * its level this many times as far as it moves a room's.
   * DUCT_BLEED: how fast a duct over an EMPTY room loses what it has. */
  DUCT_THIN:      3,
  DUCT_BLEED:     0.6,
  /** Below this a room counts as empty for the duct above it. */
  ROOM_EMPTY:     0.005,
  /* What a smaller mouth takes. The player's figures, 24.09: a cat is
     half a man, a rat is a quarter. A creature that does not breathe
     at all is not in this table — `Pest.breathPerSec` asks
     `breathes()` first, so SUIT_AIR.NO_LUNGS stays the ONE place that
     says the spider has no lungs. */
  BREATH_PER_SEC: {
    _default:   0.04,
    cat_black:  0.02,
    cat_ginger: 0.02,
    rat:        0.01,
  },
  /* Three men to a pip. `3 * BREATHING` is written out rather than
     typed as 0.12 so that changing what a man breathes cannot leave
     the module quietly feeding two men or four. */
  PER_POWER:      0.04 * 3,
  /* A HULL BREACH is the other half of the update54 complaint, and it
     is untouched: at 0.07 a hole took fourteen seconds to empty a room
     and the patch was almost always faster; 0.16 makes it seven, so a
     breach in the medbay is a decision and not a chore. */
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
    this.level  = OXYGEN.MAX;     // 0–1, the compartment
    this.duct   = OXYGEN.MAX;     // 0–1, the duct in its ceiling (update85)
  }

  /**
   * Put `amount` of air (in ROOM units, negative to take) through this
   * compartment the way the pipes do: the duct first, the room with
   * what is left over. See OXYGEN.DUCT_THIN.
   */
  _pipe(amount) {
    if (this.duct == null) {                 // a lift shaft: no duct at all
      this.level = Utils.clamp(this.level + amount, 0, OXYGEN.MAX);
      return;
    }
    const T = OXYGEN.DUCT_THIN;
    if (amount < 0) {
      const take = Math.min(-amount, this.duct / T);
      this.duct = Math.max(0, this.duct - take * T);
      this.level = Math.max(0, this.level - (-amount - take));
    } else if (amount > 0) {
      const put = Math.min(amount, (OXYGEN.MAX - this.duct) / T);
      this.duct = Math.min(OXYGEN.MAX, this.duct + put * T);
      this.level = Math.min(OXYGEN.MAX, this.level + (amount - put));
    }
  }

  /** Returns current level 0–1 */
  get value() { return this.level; }

  get isCritical() { return this.level <= OXYGEN.CRIT_LEVEL; }
  get isWarning()  { return this.level <= OXYGEN.WARN_LEVEL; }

  /**
   * @param {number}  dt
   * @param {number}  netRate     - this room's share of the SHIP's air
   *                                balance, per second: what the module
   *                                makes minus what the crew breathe.
   *                                Computed once for the hull, in
   *                                OxygenManager.update — see there.
   * @param {number}  breachCount - active hull breaches in this room
   * @param {boolean} isVacuum    - room open to space?
   * @param {Array}   crew        - crew in room
   */
  update(dt, netRate, breachCount = 0, isVacuum = false, crew = []) {
    if (isVacuum) {
      this.level = Math.max(0, this.level - OXYGEN.DRAIN_VACUUM * dt);
    } else if (breachCount > 0) {
      this.level = Math.max(0, this.level - OXYGEN.DRAIN_BREACH * breachCount * dt);
    }

    if (!isVacuum) {
      /* ONE NUMBER (update82). This used to compute a refill and a
         drain of its own, from the module's FULL output and a flat
         per-room figure — which is how one pip came to run a ship of
         any size with a crew of any size. The room no longer works
         anything out; it is told its share of one balance. */
      this._pipe(netRate * dt);            // duct first (update85)
    }

    /* A HOLE EMPTIES THE ROOM, THEN THE DUCT (update85). Once the room
       below has nothing left in it, the duct bleeds into it — whatever
       emptied the room, an airlock of its own or a door to one. */
    if (this.duct != null && this.level <= OXYGEN.ROOM_EMPTY) {
      this.duct = Math.max(0, this.duct - OXYGEN.DUCT_BLEED * dt);
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
       to kill rats — and, since update79, ONLY rats: the spider does
       not breathe at all (SUIT_AIR.NO_LUNGS). Since update84 that is
       done to them in the duct, by Ship._pestHazards; nothing on this
       list is a pest, so nothing here has to ask whether it breathes. */
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

  /** The duct's own gauge: a tint over the grille once it is thinning. */
  drawDuct(ctx, x, y, w, h) {
    if (this.duct == null || this.duct >= OXYGEN.MAX * 0.95) return;
    const alpha = (1 - this.duct) * 0.45;
    ctx.fillStyle = this.duct <= OXYGEN.CRIT_LEVEL
      ? `rgba(180,30,30,${alpha})`
      : `rgba(30,100,180,${alpha})`;
    ctx.fillRect(x + 1, y, w - 2, h);
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

  /** `duct: false` for a lift shaft — it has air but no ceiling duct. */
  addRoom(roomId, { duct = true } = {}) {
    if (!this._rooms.has(roomId)) {
      const ro = new RoomOxygen(roomId);
      if (!duct) ro.duct = null;
      this._rooms.set(roomId, ro);
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

    /* ══ THE SHIP'S AIR BALANCE, WORKED OUT ONCE (update82) ══
     *
     * PRODUCTION is what the module makes, full stop — not what it
     * makes in each room, which is what the old code effectively did
     * and is why hull size was free air.
     *
     * CONSUMPTION is every mouth aboard, each at its own rate. A man
     * takes four times what a rat does and twice what a cat does, and
     * a spider takes nothing at all. So a rat problem now shows up on
     * the oxygen gauge before it shows up in the hold, which is the
     * point of putting vermin on the same meter as the crew.
     *
     * Only bodies actually IN a compartment count. Somebody in a slab,
     * on the enemy hull or already dead is not breathing this ship's
     * air, and counting him would charge the player for a mouth he
     * cannot see.
     */
    let consumption = 0;
    ship.crew.forEach(c => {
      if (!c || c.dead || c.dying || c.frozen || c.inRoom === false) return;
      consumption += (c.breathPerSec ? c.breathPerSec() : OXYGEN.BREATHING);
    });
    /* …AND WHATEVER IS IN THE DUCTS (update84). A rat in the crew list
       was charged here as a crewman; it is not in that list any more,
       and the rat problem showing up on the gauge is a feature the
       player was promised in update82, so it is charged here instead. */
    (ship.pests ?? []).forEach(p => { consumption += p.breathPerSec(); });
    const production = OXYGEN.PER_POWER * o2Power;
    const net = production - consumption;

    /* HOW THE BALANCE IS SPREAD. A surplus can only land where there
     * is room for it: pumping into compartments that are already full
     * would throw the module's output away and make a vented bay take
     * six times as long to come back on a six-room hull as on a
     * one-room hull — the same size-dependence this package exists to
     * delete, wearing the other hat.
     *
     * A DEFICIT comes off everybody, because the ship shares one air
     * loop. Which compartment a man happens to be standing in does not
     * decide who runs out first; the doors do that, below. */
    const rooms  = ship.rooms.filter(r => this._rooms.has(r.id));
    // A dry duct is as hungry as a stale room: the air goes there first.
    const hungry = rooms.filter(r => {
      const ro = this._rooms.get(r.id);
      return ro.level < OXYGEN.MAX || (ro.duct != null && ro.duct < OXYGEN.MAX);
    });
    const share  = net >= 0
      ? (hungry.length ? net / hungry.length : 0)
      : net / (rooms.length || 1);

    ship.rooms.forEach(room => {
      const ro = this._rooms.get(room.id);
      if (!ro) return;

      const breaches = ship.breaches.breaches.filter(b => b.roomId === room.id && !b.sealed).length;
      const crew     = ship.crew.filter(c => c.roomId === room.id && !c.dead);

      ro.update(dt, share, breaches, room.isVacuum ?? false, crew);
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
    /* ALL the air aboard (update85): the rooms AND their ducts, each
       duct counted at its real, thin volume. A deficit comes out of
       the ducts first, so a gauge that read the rooms alone would sit
       at 100% while every duct on the ship ran dry. */
    const T = OXYGEN.DUCT_THIN;
    let sum = 0, cap = 0;
    this._rooms.forEach(r => {
      sum += r.level; cap += 1;
      if (r.duct != null) { sum += r.duct / T; cap += 1 / T; }
    });
    return sum / cap;
  }

  isAnyRoomCritical() {
    for (const r of this._rooms.values()) {
      if (r.isCritical) return true;
    }
    return false;
  }

  reset() {
    this._rooms.forEach(r => { r.level = OXYGEN.MAX; if (r.duct != null) r.duct = OXYGEN.MAX; });
  }
}
