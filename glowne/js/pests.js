'use strict';
/* ============================================================
   PESTS — what lives in the ceiling duct (update84)
   ============================================================

   Until this package a moon rat and a void spider were CrewMembers:
   hostile crew with `isVermin` / `isSpider` set, standing in a room.
   That is what let a crew corner a rat and beat it to death with the
   melee code that already existed — and it is also why every system
   that asks "who is in this room" had to be taught, one filter at a
   time, that some of the people in the room were not people. The
   brawl, the module defence, the station slots, the medbay, the
   barracks, the commander, the helm, the save: `isBeast` had grown
   into more than forty places.

   The player's design (17.09, U10A) moves them OUT of the room and
   into the duct along its ceiling. Up there nobody can swing at them
   and they cannot swing at anybody, so they stop being crew at all —
   and every one of those filters stops having anything to filter.
   This file is what is left: a small animal with a room, an x along
   that room's duct, some hit points, and nothing else.

   WHAT CAN KILL ONE, and it is deliberately short:
     · the cat, who goes up into the duct after it;
     · fire in the module below — the duct is the module's ceiling;
     · vacuum, for a RAT. A spider does not breathe (SUIT_AIR.NO_LUNGS).
   The crew cannot. That is the change the player asked for: a pest is
   a thing you manage with the ship, not a thing you fight.

   WHAT A PEST DOES
     · a RAT eats from the hold and grows on it — young, then breeding,
       then adult (update86, U10B, RAT_TUNING below). An ADULT with
       nothing left to eat chews the loom of the module under it, and
       when it is hungry as well it will now and then drop on a man.
     · a SPIDER drops out of the duct on a crewman in the room below,
       bites him — the bite can carry the virus — and goes straight
       back up. That is the only way a pest ever touches a person.
   ============================================================ */

/* ONE TABLE per kind. The numbers a rat had as a crewman (18 hp, a
   quarter of a man's breath) are carried over unchanged; the spider's
   are not, because the spider's were set for a room brawl against three
   armed men and it now faces one cat. At 45 hp a black cat needed nine
   swings — eighteen seconds — while the spider took her apart in six,
   so "only the cat can kill a spider" would have meant "nothing can".
   At 16 a black cat wins in four swings and comes out scratched; a
   ginger wins in five and comes out badly hurt. A spider from a deep
   wreck (tough 3) is still more than any cat should take on alone. */
const PEST_DEFS = {
  rat: {
    label: 'Moon Rat', color: '#b3a189',
    hp: 18, hpPerTough: 0,
    speed: 22,                    // px/s along the duct
  },
  spider: {
    label: 'Void Spider', color: '#9fff7a',
    hp: 16, hpPerTough: 6,
    bite: 6, bitePerTough: 2,     // per bite, on a man or on the cat
    speed: 30,
  },
};

/* ══ THE RAT ECONOMY (update86, U10B) ══════════════════════════
 *
 *   lvl 1 YOUNG    eats from the hold               a meal → lvl 2
 *   lvl 2 BREEDING eats; its meal brings a litter   a meal → lvl 3
 *   lvl 3 ADULT    eats; with NOTHING to eat it chews the loom, and
 *                  hungry as well it now and then bites a man
 *
 * THE RULE THAT MAKES IT A DECISION: rats do not chew while there is
 * food in the hold. The player feeds them or loses modules, and which
 * he picks depends on how many rations he has — that is the point.
 *
 * Rats eat SPIDER EGGS first, as the cat does: a plague of rats is a
 * smaller spider problem, so "exterminate everything" stops being the
 * obvious play.
 *
 * Every number here is a knob, and they pull on each other; that is
 * why this was its own package. Tune HERE and nowhere else. */
const RAT_TUNING = {
  /** Hit points and drawn size, by level. */
  LEVELS: {
    1: { hp: 10, scale: 0.7,  label: 'Young Moon Rat' },
    2: { hp: 18, scale: 0.85, label: 'Moon Rat' },
    3: { hp: 28, scale: 1.0,  label: 'Adult Moon Rat' },
  },
  /** Seconds of breath once its air is gone — a normal suit's worth
   *  (update86b, the player's pick): cutting the air kills the rats AND
   *  hurts the crew, unless somebody patches them up afterwards. */
  AIR_SECONDS: 12,
  /** Fullness lost per second: 100 → 0 in twenty minutes. */
  HUNGER_PER_SEC: 1 / 12,
  /** It goes looking for food below this. */
  EAT_BELOW: 50,
  /** What one meal (a portion of a ration, or an egg) puts back. */
  MEAL: 60,
  /** Below this an adult is HUNGRY, and a hungry adult bites. */
  HUNGRY: 30,
  /** "Wytrzymują długo": at zero it loses one hit point this often. */
  STARVE_EVERY: 30,
  /** A litter, and the most rats a hull can hold before they stop. */
  LITTER_MIN: 2,
  LITTER_MAX: 5,
  MAX_ABOARD: 12,
  /** An ADULT with nothing to eat acts this often (update89): it chews
   *  a level off the module under it — or, hungry and with a man below,
   *  now and then drops on him instead. One clock, a coin for which. */
  CHEW_MIN: 25,
  CHEW_MAX: 45,
  /** The share of a hungry adult's actions that are a drop, not a chew. */
  DROP_SHARE: 0.4,
  /** What a rat bite costs. */
  BITE: 3,
  /** A BREEDING rat with nothing to eat shorts the loom under it in a
   *  fight, as rats did before update86 (update89, the player: "średnie
   *  szczury robią stuna jak było wcześniej"). */
  SHORT_MIN: 20,
  SHORT_MAX: 45,
  SHORT_SECONDS: 3,
  /** EVERY RAT ITS OWN PACE (update89). A litter was born in one frame
   *  on one full belly and ate, grew and acted in lockstep for the rest
   *  of its life — "praktycznie w tym samym czasie robią akcje". Each rat
   *  burns food at its own rate, and a pup starts part full. */
  METAB_MIN: 0.8,
  METAB_MAX: 1.25,
  PUP_FULL_MIN: 55,
};

const PEST_TUNING = {
  /** Seconds between moves to a neighbouring compartment's duct. */
  MOVE_MIN: 8,
  MOVE_MAX: 18,
  /** A drop is an ATTEMPT (update89 — "nie zawsze, nieraz próbują tylko
   *  ugryźć"): this share of them land, the rest miss and go back up. */
  BITE_HIT: 0.6,
  /** Seconds a spider sits over a room before it drops on somebody. */
  POUNCE_MIN: 6,
  POUNCE_MAX: 14,
  /** How long the drop, the bite and the climb back take together. */
  POUNCE_SECONDS: 0.9,
  /** A spider cornered by the cat bites her this often. */
  BITE_BACK_EVERY: 3,
};

class Pest {
  constructor(cfg = {}) {
    this.kind   = cfg.kind === 'spider' ? 'spider' : 'rat';
    this.id     = cfg.id || `pest${Utils.uid()}`;
    this.tough  = cfg.tough ?? 0;
    const def   = this.def;
    /* A rat's size is its LEVEL (update86); a spider's is its toughness. */
    if (this.kind === 'rat') {
      this.level    = Utils.clamp(Math.round(cfg.level ?? 1), 1, 3);
      this.fullness = cfg.fullness ?? 100;
      this.air      = cfg.air ?? RAT_TUNING.AIR_SECONDS;   // breath held, seconds
      this.metab    = cfg.metab ?? Utils.randFloat(RAT_TUNING.METAB_MIN, RAT_TUNING.METAB_MAX);
    }
    this.maxHp  = cfg.maxHp ?? (this.kind === 'rat'
      ? RAT_TUNING.LEVELS[this.level].hp
      : def.hp + def.hpPerTough * this.tough);
    this.hp     = cfg.hp ?? this.maxHp;
    /** The compartment whose duct it is in. */
    this.roomId = cfg.roomId ?? null;
    /** World x along that duct. There is no y: a pest is always in a duct. */
    this.x      = cfg.x ?? 0;
    this.dead   = false;

    /* ── AN EGG SAC IS A PEST THAT HAS NOT HATCHED ─────────────
     * It used to be a CrewMember with `dormant` set, which meant the
     * crew constructor, update and draw all carried a branch for a
     * thing that was not crew. Here it is the same object before and
     * after — the sac splits and the spider is already in the duct. */
    this.dormant     = !!cfg.dormant;
    this.revealed    = cfg.revealed ?? !this.dormant;
    this.sensedByCat = !!cfg.sensedByCat;
    this.hatchT      = cfg.hatchT ?? 0;

    // Transient — what it is doing this second. Not saved: a reload
    // puts it back in its duct, sitting still, which it is most of the time.
    this._moveT   = Utils.randFloat(PEST_TUNING.MOVE_MIN, PEST_TUNING.MOVE_MAX);
    this._via     = null;    // room it is crawling towards
    this._tx      = null;    // where along this duct it is heading
    this._chewT   = null;
    // A spider's drop clock runs from the start; a rat's only once it is
    // an angry adult (update86) — see Ship._pestDrop.
    this._pounceT = this.kind === 'spider'
      ? Utils.randFloat(PEST_TUNING.POUNCE_MIN, PEST_TUNING.POUNCE_MAX) : null;
    this._pounce  = null;    // { t, victimId, bitten }
    this._catId   = null;    // the cat that has it cornered
    this._biteBackT = 0;
    this._facing  = 1;
    this._animState = null;
    this.anim     = null;
    this._setAnim('idle');
  }

  get def()      { return PEST_DEFS[this.kind]; }
  get label()    { return this.isRat ? RAT_TUNING.LEVELS[this.level].label : this.def.label; }
  /** How big it is drawn: a young rat is a small one. */
  get scale()    { return this.isRat ? RAT_TUNING.LEVELS[this.level].scale : 1; }

  /** Grow a rat one level: the new body's hit points, the old wounds. */
  growUp() {
    if (!this.isRat || this.level >= 3) return false;
    const lost = this.maxHp - this.hp;
    this.level++;
    this.maxHp = RAT_TUNING.LEVELS[this.level].hp;
    this.hp = Math.max(1, this.maxHp - lost);
    return true;
  }
  get color()    { return this.def.color; }
  get isSpider() { return this.kind === 'spider'; }
  get isRat()    { return this.kind === 'rat'; }
  /** Hatched and not dead: the only state in which it does anything. */
  get alive()    { return !this.dead && !this.dormant; }

  /** Does it want air? SUIT_AIR.NO_LUNGS is the one place that says. */
  breathes() {
    const t = (typeof SUIT_AIR !== 'undefined') ? SUIT_AIR.NO_LUNGS : null;
    return !(t && t[this.kind]);
  }

  /** What it takes off the ship's air balance, per second. */
  breathPerSec() {
    if (!this.alive || !this.breathes()) return 0;
    const t = (typeof OXYGEN !== 'undefined') ? OXYGEN.BREATH_PER_SEC : null;
    return t ? (t[this.kind] ?? t._default) : 0;
  }

  biteDamage() {
    const d = this.def;
    return (d.bite ?? 0) + (d.bitePerTough ?? 0) * this.tough;
  }

  takeDamage(amount, source = 'unknown') {
    if (this.dead) return false;
    this.hp -= amount;
    if (this.hp > 0) return false;
    this.hp = 0;
    this.dead = true;
    this.killedBy = source;
    this._pounce = null;
    return true;
  }

  /** Split the sac. Returns true the first time. */
  hatch() {
    if (!this.dormant || this.dead) return false;
    this.dormant  = false;
    this.revealed = true;
    this._animState = null;
    return true;
  }

  // ── Where it is ──────────────────────────────────────────

  /** The line its feet are on: the floor of the duct. */
  static ductFloor(room) { return room.ventY + room.ventH - 2; }

  /** How far inside the duct it keeps from either end wall. */
  static get EDGE() { return 8; }

  /** Is it in the middle of a drop onto somebody? */
  get pouncing() { return !!this._pounce; }

  // ── Drawing ──────────────────────────────────────────────

  _setAnim(state) {
    if (this._animState === state && this.anim) return;
    this._animState = state;
    if (typeof Animation === 'undefined') return;
    this.anim = this.isSpider
      ? Animation.spiderAnim?.(state, this.color)
      : Animation.ratAnim?.(state, this.color);
  }

  /** The sprite's feet sit this far below the point `anim.draw` is
   *  given, at the 32px size the game draws animals at. Measured from
   *  the rendered frames — see HANDOFF update84. */
  static get FEET() { return 8; }

  /**
   * Drawn by the ship, over the duct it lives in.
   *
   * THE WHOLE POINT IS THAT IT IS SEEN. A pest moved out of the room
   * the crew stand in, and a threat nobody can see is a threat the
   * player forgets he has — the U9 rule, "skutek ma być zobaczony".
   */
  draw(ctx, ship) {
    if (this.dead) return;
    const room = ship?.getRoomById?.(this.roomId);
    if (!room) return;
    /* SEEN ONLY WHERE SOMEBODY IS (update86a) — see Ship.pestVisible.
       In a shaft it is seen from either end of the climb. */
    if (ship.pestVisible && !ship.pestVisible(this.roomId) &&
        !(this._climb && ship.pestVisible(this._climb.to))) return;
    const floor = Pest.ductFloor(room);

    // UP OR DOWN THE LIFT SHAFT (update86a): head first, the way it goes.
    if (this._climb) {
      const c = this._climb;
      const k = Utils.clamp(c.t / (c.dur || 1), 0, 1);
      const cy = c.y0 + (c.y1 - c.y0) * k - Pest.FEET * this.scale;
      const s = this.scale;
      ctx.save();
      ctx.translate(c.x, cy);
      // The art faces right (+x); turned a quarter, right becomes up or down.
      ctx.rotate(c.y1 < c.y0 ? -Math.PI / 2 : Math.PI / 2);
      this.anim?.draw(ctx, 0, 0, 32 * s, 32 * s);
      ctx.restore();
      return;
    }

    if (this.dormant) {
      // Nobody has walked in on it and no cat has smelt it: not drawn.
      if (!this.revealed) return;
      ctx.save();
      ctx.translate(this.x, floor - 7);
      ctx.scale(0.6, 0.6);
      this._sacT = (this._sacT ?? 0) + 0.05;
      Animation.drawEggSac?.(ctx, 0, 0, this._sacT);
      ctx.restore();
      return;
    }

    // Where the body is drawn: in the duct, or on the way down to a man.
    let y = floor - Pest.FEET;
    const p = this._pounce;
    if (p) {
      const victim = ship.crew?.find(c => c && c.id === p.victimId);
      const low = victim ? victim.y - 6 : y + 30;
      // Down and back up on one arc: the bite is at the bottom.
      const k = Math.sin(Math.PI * Utils.clamp(p.t / PEST_TUNING.POUNCE_SECONDS, 0, 1));
      y = y + (low - y) * k;
    }

    // A smaller body stands on the same duct floor (update86).
    const s = this.scale;
    if (s !== 1 && !p) y = floor - Pest.FEET * s;
    ctx.save();
    if (this._facing === -1) {
      ctx.scale(-1, 1);
      ctx.translate(-this.x * 2, 0);
    }
    this.anim?.draw(ctx, this.x, y, 32 * s, 32 * s);
    ctx.restore();

    // A bar only once it is hurt — a duct full of full green bars would
    // be noise, and a hurt one is the thing the player is watching.
    if (this.hp < this.maxHp && !p) {
      const bw = 14, bh = 2;
      const bx = this.x - bw / 2, by = room.ventY + 1;
      ctx.fillStyle = 'rgba(7,8,15,0.85)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = '#ff5566';
      ctx.fillRect(bx, by, bw * Utils.clamp(this.hp / this.maxHp, 0, 1), bh);
    }
  }

  // ── Save ─────────────────────────────────────────────────

  serialise() {
    return {
      id: this.id, kind: this.kind, tough: this.tough,
      hp: this.hp, maxHp: this.maxHp,
      roomId: this.roomId, x: this.x,
      dormant: this.dormant, revealed: this.revealed, hatchT: this.hatchT,
      ...(this.isRat ? { level: this.level, fullness: this.fullness, metab: this.metab } : {}),
    };
  }

  static deserialise(data) { return new Pest(data || {}); }

  /**
   * AN OLD SAVE HAS ITS RATS IN THE CREW LIST.
   *
   * Every save written before update84 carried rats and spiders as
   * crew records (`race: 'rat'` / `'spider'`), because that is what
   * they were. Loading one must not build a CrewMember out of them —
   * there is no such crewman any more — and must not drop them either,
   * or reloading would be a free fumigation. So the record is turned
   * into the pest it always was, in the duct of the room it stood in.
   *
   * Returns null for anything that is not a pest, which is how the
   * loader tells the two apart without a second list of races.
   */
  static fromCrewRecord(rec) {
    if (!rec || (rec.race !== 'rat' && rec.race !== 'spider')) return null;
    const p = new Pest({
      kind: rec.race, roomId: rec.roomId ?? null, x: rec.x ?? 0,
      hp: rec.hp, maxHp: rec.maxHp,
      level: 2,          // an old-save rat was an 18-hp animal: a breeding one
      dormant: !!rec.dormant, hatchT: rec.hatchT ?? 0,
    });
    // The record's spider hp was a crewman's 45-odd; clamp it to what a
    // spider in a duct is, or the first one loaded outlives every cat.
    p.maxHp = Math.min(p.maxHp, p.def.hp + p.def.hpPerTough * 3);
    p.hp    = Math.min(p.hp, p.maxHp);
    if (rec.state === 'dead' || !(p.hp > 0)) p.dead = true;
    return p;
  }
}

if (typeof window !== 'undefined') {
  window.Pest        = Pest;
  window.PEST_DEFS   = PEST_DEFS;
  window.PEST_TUNING = PEST_TUNING;
  window.RAT_TUNING  = RAT_TUNING;
}
