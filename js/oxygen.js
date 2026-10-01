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
   * the ORDER in which the two empty is the player's rule — first set
   * on 29.09 for update85 and CORRECTED by him after playing it the
   * same evening (update86b):
   *
   *   · a HOLE in the room — an open airlock or a breach — takes the
   *     ROOM's air first; the duct bleeds out after it, once the
   *     room below is empty;
   *   · TOO LITTLE AIR — the module running, but short for the mouths
   *     aboard — is short in the ROOMS first. The pipes run in the duct,
   *     so the duct is the last place the thin supply fails: "najpierw
   *     brakuje w przedziałach". (update85 had it the other way round,
   *     and the result was a red duct over a breathable room and rats
   *     that died of a small deficit while the crew never felt it —
   *     "za łatwo", and it looked wrong.)
   *   · NO AIR AT ALL — the module off or unpowered — and nothing is
   *     flowing anywhere, so room and duct go down TOGETHER, evenly.
   *     That is the rat-killer now, and it takes the crew with it
   *     unless somebody patches them up: a rat has a normal suit's
   *     worth of breath (RAT_TUNING.AIR_SECONDS), no more.
   *   · A SURPLUS fills the duct first — it is where the pipes are.
   *
   * DUCT_THIN: the duct is a thin pipe, so a given amount of air moves
   * its level this many times as far as it moves a room's.
   * DUCT_BLEED: how fast a duct over an EMPTY room loses what it has. */
  DUCT_THIN:      3,
  DUCT_BLEED:     1.5,   // update90: was 0.6 — it is the network's way out now, see VENT_LINK
  /* ══ THE DUCTS ARE ONE NETWORK (update90, pkt 9) ══════════════
   *
   * Until now each duct was a dead end over its own room, and a hole
   * could only take what was behind open doors. The player's test of
   * 89: two pips of O2 held an open airlock forever, because the rest
   * of the ship, behind shut doors, never lost anything. His rule:
   * "kanały połączone za drzwiami i szybem, jedna otwarta śluza powoli
   * wysysa cały statek, jeśli O2 nie nadąża".
   *
   * So air now creeps, slowly, two ways:
   *   · DUCT↔DUCT along `Ship.ductLinks` — the same graph the rats
   *     walk: sideways over the doors (shut or not — the duct runs in
   *     the ceiling, above them) and up and down the lift shaft;
   *   · DUCT↔ROOM through the grille in each ceiling.
   *
   * A hole therefore drains its own room fast, the duct over it through
   * DUCT_BLEED, and the rest of the ship through the network — slowly.
   * Calibrated (01.10) on the player's figure of about two minutes: a
   * full frigate, pumps off, nobody aboard, one airlock open and every
   * door shut, is below 10% in ~100 s (raider ~60 s, boss ~140 s). With
   * the pumps on the ship settles where they make as much as the network
   * loses: three men on two pips sink a frigate to about a third (the
   * rooms by the lock at nothing); three or four pips hold ~80%.
   *
   * It is a THRESHOLD, not a slope: either the most the network can carry
   * out past a full ship beats the pumps' surplus and the ship sinks, or
   * it does not and she holds near full. At LINK 0.4 two pips held again,
   * at 0.5 it was on the edge — 0.6 is there for the margin, and the
   * DUCT_BLEED over the hole (1.5) is set so it is not the bottleneck.
   *
   * LINK and GRILLE are rates per second on the LEVEL difference
   * (duct levels for LINK, air units for GRILLE — see _ventNetwork). */
  VENT_LINK:      0.6,
  VENT_GRILLE:    0.15,
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
  _pipe(amount, flowing = true) {
    if (this.duct == null) {                 // a lift shaft: no duct at all
      this.level = Utils.clamp(this.level + amount, 0, OXYGEN.MAX);
      return;
    }
    const T = OXYGEN.DUCT_THIN;
    if (amount < 0 && !flowing) {
      /* Nothing flowing: both go down by the same fraction of what they
         hold — the same level, at the same time. */
      const f = -amount / (1 + 1 / T);
      this.level = Math.max(0, this.level - f);
      this.duct  = Math.max(0, this.duct - f);
    } else if (amount < 0) {
      // Running short: the rooms go first, the duct with the pipes last.
      const fromRoom = Math.min(-amount, this.level);
      this.level = Math.max(0, this.level - fromRoom);
      this.duct  = Math.max(0, this.duct - (-amount - fromRoom) * T);
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
  update(dt, netRate, breachCount = 0, isVacuum = false, crew = [], flowing = true,
         leaking = isVacuum || breachCount > 0) {
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
      this._pipe(netRate * dt, flowing);   // see OXYGEN.DUCT_THIN for the order
    }

    /* A HOLE EMPTIES THE ROOM, THEN THE DUCT (update85). Once the room
       below has nothing left in it, the duct bleeds into it — whatever
       emptied the room, an airlock of its own or a door to one.
       ONLY WHILE THERE IS A HOLE (update89 fix). It used to bleed over
       ANY empty room — so a ship that had been breathed flat by rats
       and then got its module back pumped a trickle into each duct,
       the duct lost it faster than it came, the room below never got
       its leftover, and the gauge sat on 0 for good with the pumps
       running ("wlaczam na 2 lev o2 to nie pompuje"). `leaking` is
       worked out by the manager: a hole here or through an open door. */
    if (leaking && this.duct != null && this.level <= OXYGEN.ROOM_EMPTY) {
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
      /* Thinner than ROOM_EMPTY is nothing to breathe (update90): the
         network draws a sealed room down towards a hole the way a tank
         empties — ever more slowly — and would never quite reach zero. */
      const breathable = this.level > OXYGEN.ROOM_EMPTY;
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
    // The wash only once the air is going — a full room is not tinted.
    if (this.level < OXYGEN.MAX * 0.95) {
      const alpha = (1 - this.level) * 0.35;
      ctx.fillStyle = this.isCritical
        ? `rgba(180,30,30,${alpha})`
        : `rgba(30,100,180,${alpha})`;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    }

    /* THE NUMBER, ALWAYS, IN THE TOP-RIGHT CORNER (update88). It sat in
       the middle of the room, only below 95% — under whoever was
       standing there, and absent exactly when the player wanted to check
       that it was fine. Now it is always there, out of the way, and it
       only changes colour when it matters. `y` is the room's top: the
       number goes below the ceiling duct. */
    const pct = Math.round(this.level * 100);
    const top = y + ((typeof HULL_GRID !== 'undefined') ? HULL_GRID.VENT_H : 0);
    ctx.font      = '9px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(7,8,15,0.6)';
    ctx.fillRect(x + w - 44, top + 2, 42, 12);
    ctx.fillStyle = this.isCritical ? '#ff2d44'
                  : this.isWarning  ? '#ffb020'
                  : this.level < OXYGEN.MAX * 0.95 ? '#4db8ff' : '#7a90a8';
    ctx.fillText(`O₂ ${pct}%`, x + w - 4, top + 11);
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
    /* A dry duct is as hungry as a stale room: the air goes there first.
       A room OPEN TO SPACE is not (update90): its share was put through
       nothing and lost — the pumps do not fill a compartment with the
       outer door open; the network feeds it from its neighbours. */
    const hungry = rooms.filter(r => {
      if (r.isVacuum) return false;
      const ro = this._rooms.get(r.id);
      return ro.level < OXYGEN.MAX || (ro.duct != null && ro.duct < OXYGEN.MAX);
    });
    const share  = net >= 0
      ? (hungry.length ? net / hungry.length : 0)
      : net / (rooms.length || 1);

    /* THE NETWORK FIRST (update90), the holes after it: what the ducts
       carry towards an open lock in this frame goes out through it in
       the same frame, so the duct over a hole reads dry — air rushes
       THROUGH it — and a rat up there still dies as it did in 86b. */
    this._ventNetwork(dt, ship);

    const leaking = this.leakingRooms(ship);
    ship.rooms.forEach(room => {
      const ro = this._rooms.get(room.id);
      if (!ro) return;

      const breaches = ship.breaches.breaches.filter(b => b.roomId === room.id && !b.sealed).length;
      const crew     = ship.crew.filter(c => c.roomId === room.id && !c.dead);

      ro.update(dt, share, breaches, room.isVacuum ?? false, crew, production > 0,
                leaking.has(room.id));
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

  /**
   * THE VENT NETWORK (update90). Air creeps duct to duct along
   * `ship.ductLinks`, and is drawn up out of each room (and each lift
   * shaft) into a duct standing lower than it. See OXYGEN.VENT_LINK.
   * Every exchange moves air from the fuller side to the emptier and
   * never past the point where the two are level, so the network can
   * only spread what is there — it makes nothing and, on its own, loses
   * nothing; the holes do the losing.
   */
  _ventNetwork(dt, ship) {
    // Duct ↔ duct: each pair of linked ducts once.
    this.ventPairs(ship).forEach(([ia, ib]) => {
      const a = this._rooms.get(ia), b = this._rooms.get(ib);
      if (!a || !b || a.duct == null || b.duct == null) return;
      const q = (a.duct - b.duct) * Math.min(OXYGEN.VENT_LINK * dt, 0.5);
      a.duct -= q;
      b.duct += q;
    });
    // Room → duct: the grille. See _grille for why it is one way.
    (ship.rooms ?? []).forEach(r => {
      const ro = this._rooms.get(r.id);
      if (!ro || ro.duct == null) return;
      this._grille(ro, ro, OXYGEN.VENT_GRILLE, dt);
    });
    /* Duct ↔ LIFT SHAFT. The duct goes up the shaft ("przez szyb windy"),
       so the shaft's own column of air is on the network too: it trades
       with the duct of every room whose end wall is on it. Without this
       a drained ship kept a full shaft for ever behind its shut doors. */
    this.ventShafts(ship).forEach(([cellId, roomIds]) => {
      const cell = this._rooms.get(cellId);
      if (!cell) return;
      roomIds.forEach(id => {
        const ro = this._rooms.get(id);
        if (ro && ro.duct != null) this._grille(ro, cell, OXYGEN.VENT_GRILLE, dt);
      });
    });
  }

  /**
   * THE GRILLE: a body of air the size of a room (`r.level`) is drawn up
   * into a thinner duct (`d.duct`) that stands lower than it, at `rate`
   * per second on the difference — never past the point where the two
   * stand level.
   *
   * ONE WAY ONLY. Air comes DOWN into a room through the pumps
   * (`RoomOxygen._pipe`: the duct first, the room with the rest), and
   * the player's two rules from 86b stay true because of it: a hole
   * takes the room before the duct over it, and a module short for the
   * mouths aboard is short in the rooms while the ducts stay full. The
   * grille is how the network DRAWS a sealed room out towards a hole.
   */
  _grille(d, r, rate, dt) {
    if (r.level <= d.duct) return;
    const T = OXYGEN.DUCT_THIN;
    const even = (d.duct / T + r.level) / (1 + 1 / T);       // the common level
    const move = Math.min((r.level - d.duct) * rate * dt, r.level - even);   // air units, room → duct
    if (move <= 0) return;
    d.duct  = Utils.clamp(d.duct + move * T, 0, OXYGEN.MAX);
    r.level = Utils.clamp(r.level - move, 0, OXYGEN.MAX);
  }

  /** Each lift shaft's air cell and the rooms whose end wall is on it — per hull, kept. */
  ventShafts(ship) {
    if (ship._ventShafts) return ship._ventShafts;
    const reach = (typeof Ship !== 'undefined' && Ship.SHAFT_REACH) || 20;
    ship._ventShafts = (ship.elevators?.shafts ?? []).map(sh => {
      const top = sh.extentTop ?? sh.topY ?? -Infinity;
      const bot = sh.extentBottom ?? sh.bottomY ?? Infinity;
      const on = (ship.rooms ?? []).filter(r =>
        (Math.abs(r.x + r.w - sh.x) <= reach || Math.abs(r.x - sh.x) <= reach) &&
        r.y + r.h > top && r.y < bot);
      return [`shaft_${sh.id}`, on.map(r => r.id)];
    });
    return ship._ventShafts;
  }

  /** Every pair of linked ducts, once each — worked out per hull and kept. */
  ventPairs(ship) {
    if (ship._ventPairs) return ship._ventPairs;
    const seen = new Set(), out = [];
    (ship.rooms ?? []).forEach(r => {
      (ship.ductLinks ? ship.ductLinks(r.id) : []).forEach(l => {
        const key = [r.id, l.room.id].sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        out.push([r.id, l.room.id]);
      });
    });
    ship._ventPairs = out;
    return out;
  }

  /**
   * Every compartment that is losing air to space right now (update89):
   * an open airlock or an unsealed breach in it, or one reachable through
   * open doors. The duct over an empty room only bleeds out in these.
   */
  leakingRooms(ship) {
    const out = new Set();
    const open = (ship.doors ?? []).filter(d => d.open && d.roomA && d.roomB);
    (ship.rooms ?? []).forEach(r => {
      const holed = r.isVacuum ||
        (ship.breaches?.breaches ?? []).some(b => b.roomId === r.id && !b.sealed);
      if (holed) out.add(r.id);
    });
    const queue = [...out];
    while (queue.length) {
      const id = queue.shift();
      open.forEach(d => {
        const other = d.roomA === id ? d.roomB : d.roomB === id ? d.roomA : null;
        if (other && !out.has(other)) { out.add(other); queue.push(other); }
      });
    }
    return out;
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
