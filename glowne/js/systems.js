/* ============================================================
   MOON WARS — systems.js
   Ship system definitions and runtime instances.
   Reactor manages total power budget.
   Each system: power slots, damage levels, crew bonuses.
   ============================================================ */

'use strict';

// ── System type registry ──────────────────────────────────

/* ── WHAT AN OLD SAVE CALLS IT (update77) ──────────────────
 *
 * The brig became the carbonite bay, and a hull saved before that
 * carries the string 'brig' in `extraModules` and in her systems list.
 * ONE table, read everywhere a module type arrives from outside — the
 * alternative is an `if (type === 'brig')` at each of the four doors
 * and a fifth door added next year without one.
 *
 * It is a RENAME, not a new module: the same hardware, doing a job the
 * player redefined. Nothing is lost and nothing is added on load.
 */
const SYSTEM_ALIASES = { brig: 'carbonite' };
function systemType(type) { return SYSTEM_ALIASES[type] ?? type; }

const SYSTEM_DEFS = {
  reactor: {
    label: 'Reactor', icon: 'icon_reactor',
    maxLevel: 16,   // pips = reactor level (1 power each)
    description: 'Powers all systems. 1 power per level. Hits knock out power.',
  },
  shields: {
    label: 'Shields', icon: 'icon_shields',
    // Shield MODULE levels 1-3; each level = 1 layer and needs 2 power
    // to run. Pips = level × 2 (max 6 pips = 3 layers).
    maxLevel: 6, powerPerLayer: 2,
    // A shield generator is useless below one full layer, so a freshly
    // fitted one starts at TWO pips, not one. (It used to arrive at
    // level 1 = half a layer, which could never raise a bubble.)
    startLevel: 2,
    rechargeTime: 7,
    description: 'Each shield level = 1 layer, 2 power per level. Max lvl 3.',
  },
  weapons: {
    label: 'Weapons', icon: 'icon_weapons',
    maxLevel: 8,
    description: 'Powers weapon systems. Each weapon needs its power cost.',
  },
  engines: {
    label: 'Engines', icon: 'icon_engines',
    maxLevel: 8,
    description: '+2% evasion per powered level.',
  },
  oxygen: {
    label: 'O₂', icon: 'icon_oxygen',
    maxLevel: 8,
    description: 'Higher powered level = faster oxygen refill.',
  },
  cloaking: {
    label: 'Cloak', icon: 'icon_cloaking',
    maxLevel: 2,
    description: 'Active cloak: tap to vanish for a few seconds (big evasion), then recharge.',
    cloakDuration: 6,    // seconds invisible
    cloakCooldown: 22,   // seconds to recharge after it ends
  },
  autorepair: {
    label: 'Repair Bay', icon: 'icon_autorepair',
    maxLevel: 2,
    description: 'Nanobot swarm slowly repairs ALL damaged systems while powered.',
  },
  /* THE BRIG (update63). Levels are CELLS, one prisoner each — which
     is why it competes with the shield bay and the medbay for upgrade
     money rather than merely for a room. It draws power like anything
     else, and that is the whole risk: a brig with no power is a door
     a man can work on. */
  /* CARBONITE, not a brig (update77, player's spec). Same hardware,
     a different job: it does not lock men up, it STOPS THEIR CLOCK.
     Anybody goes in — a prisoner you are hauling in for the bounty or
     your own man with a spider bite that has nowhere else to go — and
     what you pay is a slab, a unit of power and his hands.
     ONE LEVEL = ONE SLAB = ONE UNIT OF POWER. Cut a unit and a slab
     goes cold: the man in it comes out, exactly as he went in. */
  carbonite: {
    label: 'Carbonite', icon: 'icon_carbonite',
    maxLevel: 3,
    description: 'Freezes a man in a slab — one slab per level, and one unit of power each. '
               + 'Time stops for whoever is inside. Cut the power and a slab thaws.',
  },
  medbay: {
    label: 'Medbay', icon: 'icon_medbay',
    maxLevel: 8,
    description: 'Heals crew inside. More power = faster healing.',
  },
  piloting: {
    label: 'Cockpit', icon: 'icon_piloting',
    maxLevel: 8,
    description: '+3% evasion per powered level. Requires a pilot.',
  },
  artillery: {
    label: 'Artillery', icon: 'icon_artillery',
    maxLevel: 8,
    description: 'Heavy beam weapon — bypasses shields.',
  },
};

// ── System instance ───────────────────────────────────────

class ShipSystem {
  /**
   * @param {string} type  - key into SYSTEM_DEFS
   * @param {number} level - upgrade level (1-based). Each level = 1 power slot.
   *                         For shields each LAYER costs 2 power (powerPerLayer).
   */
  constructor(type, level = 1) {
    this.type   = type;
    const def   = SYSTEM_DEFS[type];
    if (!def) throw new Error(`Unknown system type: ${type}`);

    this.label   = def.label;
    this.icon    = def.icon;
    this.level   = Math.min(level, def.maxLevel ?? 8);

    // Power model:
    //   maxPower       = level (slots you can fill)
    //   damagedLevels  = broken slots (red squares, cannot hold power)
    //   power          = currently allocated bars
    this.damagedLevels = 0;
    this.power         = 0;
    this.desiredPower  = 0;   // player/AI intent — power returns here after repair

    // Repair progress on the currently-being-fixed level (0–1)
    this.repairProgress = 0;

    // Ion damage (temporary disable)
    /* ONE BOLT, ONE LEVEL (update93c). The player: "1 pocisk stuna
       powinien zmniejszać o jeden power, nie wyłączać cały system — tak
       samo jak zwykły pocisk". Each bolt locks ONE level for its stun
       time; `ionDamage` is how many levels are locked right now. */
    this.ionDamage = 0;          // levels locked by ion, right now
    this._ionLocks = [];         // seconds left on each locked level
    this._stunT    = 0;          // the longest lock, in seconds (readout)
    this.ionTimer  = new Utils.Timer(5);   // legacy, no longer ticked

    // Crew at this system's room
    this.crew = [];

    // Room geometry (set by Ship)
    this.roomId = null;
    this.roomX = 0; this.roomY = 0;
    this.roomW = 96; this.roomH = 80;
    this.cx = 0; this.cy = 0;

    // Shields runtime
    this._shieldBars  = 0;
    this._shieldDebt  = 0;   // layers the enemy shot off and has not paid back
    this._shieldTimer = 0;

    // Artillery
    this._beamCharge = 0;

    // Cloak runtime (active ability)
    this.cloakActive = false;
    this.cloakTimer  = 0;   // seconds left while active
    this.cloakCd     = 0;   // seconds left on cooldown

    this._pulse = 0;
  }

  /** Cloak: player taps to activate. Needs power, must be off cooldown
   *  and not already active. Returns true if it fired. */
  activateCloak() {
    if (this.type !== 'cloaking') return false;
    if (this.isDisabled()) return false;
    if (this.cloakActive || this.cloakCd > 0) return false;
    this.cloakActive = true;
    this.cloakTimer  = this.def.cloakDuration ?? 6;
    return true;
  }

  get cloakReady() {
    return this.type === 'cloaking' && !this.cloakActive &&
           this.cloakCd <= 0 && !this.isDisabled();
  }

  get def()      { return SYSTEM_DEFS[this.type]; }
  get maxPower() { return this.level; }

  /** Usable power slots right now (level minus broken slots) */
  get workingLevels() { return Math.max(0, this.level - this.damagedLevels); }

  isDisabled() {
    // effectivePower — NOT raw power — decides this: a module with a
    // Terra cyborg standing in it runs on his +1 even with ZERO reactor
    // power allocated. Checking raw power here used to leave such a
    // module "disabled" (dark medbay, dead shields) despite the cyborg.
    return this.workingLevels <= 0 || this.effectivePower() <= 0;
  }

  /** Does a live Terra cyborg currently operate this module? */
  get hasCyborg() {
    /* AT THE CONSOLE, NOT IN THE ROOM (update93a). The player: the +1
       should switch off when he steps away from the console and switch
       on when he takes it as the module's operator — not when he walks
       in or out of the compartment. `consoleCrew` is the man on slot 0
       (Ship.consoleOperator), refreshed every frame by Ship.update; a
       module no ship has synced yet falls back to its crew list. */
    if (this.consoleCrew !== undefined) {
      const op = this.consoleCrew;
      return !!op && op.alive !== false && !op.dead && !!op.cyborg;
    }
    return this.crew.some(c => c && c.alive !== false && !c.dead && c.cyborg);
  }

  /** Units this module actually DRAWS from the reactor for a given
   *  allocation. A cyborg substitutes exactly one reactor unit, but
   *  only once the module is otherwise FULL — below that his +1 is
   *  genuine extra output (effectivePower), not a substitution, so
   *  nothing is freed. SINGLE SOURCE OF TRUTH: Reactor.distribute(),
   *  Reactor.setPower() and Ship.update()'s power-flow loop all use
   *  this. If they disagree, the bar shows power you cannot spend. */
  reactorDraw(p = this.power) {
    if (p > 0 && this.hasCyborg && p >= this.workingLevels) return p - 1;
    return p;
  }

  effectivePower() {
    let p = Math.min(this.power, this.workingLevels);
    // A Terra cyborg feeds the module they stand in like a portable
    // reactor: +1 power, but ONLY up to the module's maxPower (a full
    // module gains nothing). If the module was already full, the
    // cyborg REPLACES one reactor unit — see reclaimCyborgPower(),
    // which frees that reactor unit back to the power bank.
    if (this.workingLevels > 0 && this.hasCyborg) {
      p = Math.min(this.workingLevels, p + 1);
    }
    // Each ion-locked level takes one unit off what runs (update93c).
    if (this.ionDamage > 0) p = Math.max(0, p - this.ionDamage);
    return p;
  }

  // ── Update ───────────────────────────────────────────────

  update(dt) {
    this._pulse = (this._pulse + dt * 2) % (Math.PI * 2);

    // Clamp power to working levels — excess auto-returns to reactor pool
    if (this.power > this.workingLevels) this.power = this.workingLevels;

    // ION STUN decay. This is a plain countdown in SECONDS now: an ion
    // bolt buys exactly what its weapon def says it buys (1s), instead
    // of a stack of hits each worth a hard-coded five. Five seconds of
    // lockout per bolt made one ion cannon a permanent disable.
    if (this._ionLocks?.length) {
      this._ionLocks = this._ionLocks.map(t => t - dt).filter(t => t > 0);
      this.ionDamage = this._ionLocks.length;
      this._stunT = this._ionLocks.length ? Math.max(...this._ionLocks) : 0;
    } else if (this._stunT > 0) {
      // a lock set by hand (old saves, tests): it holds until the clock runs out
      this._stunT = Math.max(0, this._stunT - dt);
      if (this._stunT <= 0) this.ionDamage = 0;
    }

    if (this.type === 'shields') this._updateShields(dt);
    if (this.type === 'artillery' && !this.isDisabled()) {
      this._beamCharge = Math.min(1, this._beamCharge + dt / 30);
    }
    /* THE MEDBAY'S HEALING MOVED OUT (update78).
     *
     * It was HALF of it: this loop healed the men on their feet in the
     * room, and a second loop in ship.js healed the ones on the floor.
     * Two places, each holding half the patient list, and the only
     * reason nobody noticed is that the halves happened not to
     * overlap — until the day one of them learned a rule the other
     * did not, which is the update where a downed man could be healed
     * to standing by one and then to full by the other with two
     * different rates.
     *
     * A module does not know about rooms, orders, notifications or who
     * is lying where. The ship does. All of it is in `Ship.update` now,
     * against `medbayPatients`, which is the one list of everybody the
     * bay treats. */
    if (this.type === 'cloaking') {
      // The cloak runs on live power. Knock the module out (or cut its
      // power) and the field COLLAPSES, and the recharge stops dead
      // instead of quietly ticking down while the module is a wreck.
      if (this.isDisabled()) {
        if (this.cloakActive) {
          this.cloakActive = false;
          this.cloakTimer  = 0;
          // Collapsing under damage costs the FULL cooldown, and that
          // cooldown only runs once the module has power again.
          this.cloakCd = this.def.cloakCooldown ?? 22;
          if (this.shipIsPlayer && typeof UI !== 'undefined') {
            UI.notify?.('CLOAK COLLAPSED — module lost power!', 'alert');
          }
        }
        return;   // no charging without power
      }
      if (this.cloakActive) {
        this.cloakTimer -= dt;
        if (this.cloakTimer <= 0) {
          this.cloakActive = false;
          this.cloakTimer  = 0;
          this.cloakCd = this.def.cloakCooldown ?? 22;
        }
      } else if (this.cloakCd > 0) {
        this.cloakCd = Math.max(0, this.cloakCd - dt);
      }
    }
  }

  _updateShields(dt) {
    const layers = Math.floor(this.effectivePower() / (this.def.powerPerLayer ?? 2));
    this._shieldMax = layers;
    if (this._shieldBars > layers) this._shieldBars = layers;

    if (this._shieldBars < layers) {
      // shieldBonus() is 0.15 PER LEVEL — a fraction, like the gunner's
      // weaponChargeBonus(). It used to be SUBTRACTED from a 7-second
      // recharge, so a fully mastered shield operator bought 0.45s: a
      // 6% gain for three levels of work, invisible in play. It scales
      // the time now, capped so a stacked room cannot reach zero.
      // ONE operator at the console (update43); the cap stays as a
      // guard, it is simply no longer the thing doing the limiting.
      const op = this.consoleCrew;
      const bonus = Math.min(0.6, op ? op.shieldBonus() : 0);
      this._shieldNeed = Math.max(1, (this.def.rechargeTime ?? 7) * (1 - bonus));
      this._shieldTimer += dt;
      if (this._shieldTimer >= this._shieldNeed) {
        this._shieldTimer = 0;
        this._shieldBars++;
        Audio.sfx.shieldRecharge();
        /* Pay only for layers the enemy actually took off (update44).
           Toggling the module's power still recharges the bubble — it
           simply teaches nobody, because nothing was learned. */
        if ((this._shieldDebt ?? 0) > 0) {
          this._shieldDebt--;
          // The one working the console is the one who learns from it.
          if (op && !op.dead) op.addXP('shields', XP_RATES.shields);
        }
      }
    }
  }

  get shieldBars() { return this._shieldBars; }
  get shieldMax()  { return this._shieldMax ?? 0; }
  /** 0-1 progress of the layer currently recharging (0 when full) */
  get shieldChargeProgress() {
    if (this._shieldBars >= (this._shieldMax ?? 0)) return 0;
    return Utils.clamp(this._shieldTimer / (this._shieldNeed ?? 7), 0, 1);
  }

  hitShield() {
    if (this._shieldBars > 0) {
      this._shieldBars--;
      this._shieldTimer = 0;
      /* A LAYER THAT WAS SHOT OFF IS A LAYER WORTH LEARNING FROM
         (update44). XP used to be paid for ANY recharge, and dropping
         the module's power drops its layers — so between fights the
         player could sit there flipping shields off and on and farm
         the skill for free. Only what the enemy takes down is owed
         back; the debt is what pays out, not the recharge itself. */
      this._shieldDebt = (this._shieldDebt ?? 0) + 1;
      Audio.sfx.shieldHit();
      return true;
    }
    return false;
  }

  // ── Damage / repair (FTL model) ───────────────────────────

  /** A hit breaks one level (red square). Excess power returns to pool. */
  damageLevel(count = 1) {
    this.damagedLevels = Math.min(this.level, this.damagedLevels + count);
    this.repairProgress = 0;
    if (this.power > this.workingLevels) this.power = this.workingLevels;
  }

  /** Stun this module for `seconds`. Stacks, so a burst really does
   *  hold a module down for longer than a single bolt. */
  ionHit(seconds = 1, levels = 1) {
    this._ionLocks = this._ionLocks ?? [];
    const s = Math.max(0, seconds);
    for (let i = 0; i < Math.max(1, levels); i++) {
      if (this._ionLocks.length < Math.max(1, this.level)) this._ionLocks.push(s);
      else {
        // every level already locked: the bolt holds the soonest one longer
        let k = 0;
        this._ionLocks.forEach((t, j) => { if (t < this._ionLocks[k]) k = j; });
        this._ionLocks[k] += s;
      }
    }
    this.ionDamage = this._ionLocks.length;
    this._stunT = Math.max(...this._ionLocks);
  }

  /** Seconds of stun left — what the HUD should show. */
  get stunLeft() { return this._stunT ?? 0; }

  /** Crew repair: fills repairProgress; each full bar restores one level.
   *  Base rate ≈ 8s per level for an unskilled crew member. */
  repair(amount, crew = null) {
    if (this.damagedLevels <= 0) return;
    this.repairProgress += amount * 0.12 * (crew ? crew.repairSpeed() : 1);
    if (crew) crew.addXP('repair', amount * XP_RATES.repair);
    if (this.repairProgress >= 1) {
      this.repairProgress = 0;
      this.damagedLevels = Math.max(0, this.damagedLevels - 1);
      Audio.sfx.repair();
    }
  }

  isFullyRepaired() { return this.damagedLevels <= 0; }

  // Legacy interface used by fire.js — fire slowly breaks levels
  takeDamage(amount) {
    this._fireAcc = (this._fireAcc ?? 0) + amount;
    if (this._fireAcc >= 8) {   // accumulated fire damage breaks a level
      this._fireAcc = 0;
      this.damageLevel(1);
    }
  }

  // ── Upgrade ──────────────────────────────────────────────

  upgrade() {
    const maxLvl = this.def.maxLevel ?? 8;
    if (this.level >= maxLvl) return false;
    this.level++;
    return true;
  }

  upgradeCost() { return (this.level + 1) * 40; }

  /** The module's badge in the corner of its room — where it is drawn,
   *  and the only place its hover answers (update90a). */
  badgeRect() {
    return { x: this.roomX + 2, y: this.roomY + 2, w: 20, h: 20 };
  }

  // ── Draw (room interior) ─────────────────────────────────

  draw(ctx) {
    const x = this.roomX, y = this.roomY, w = this.roomW, h = this.roomH;

    const tileName = `room_${this.type}`;
    const tile = Assets.get(Assets.has(tileName) ? tileName : 'room_default');
    if (tile) Assets.tileRect(ctx, tile, x, y, w, h, 48);

    /* THE RED WASH OVER A BROKEN MODULE IS GONE (update54) — a fourth
       copy of one fact, and the loudest: the power bar already reddens
       the broken slots, the module smokes, and the frame greys out.
       Deleted, not faded: a faint version is the same fact again. */
    if (this.ionDamage > 0) {
      ctx.fillStyle = `rgba(77,184,255,${0.15 * this.ionDamage})`;
      ctx.fillRect(x, y, w, h);
    }

    /* THE REACTOR IS THE SOURCE, NOT A CONSUMER (update93c). It is never
       handed power, so asking it "are you powered" always said no and its
       badge sat grey like a switched-off module. It is lit while it has a
       working level and is not scrammed — `_offline` comes from the ship. */
    const powered = this.type === 'reactor'
      ? (this.workingLevels > 0 && !this._offline)
      : !this.isDisabled();
    const pulse = powered ? 0.5 + 0.5 * Math.sin(this._pulse) : 0;
    ctx.strokeStyle = powered
      ? `rgba(26,140,255,${0.35 + 0.2 * pulse})`
      : 'rgba(120,90,90,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    /* THE ICON IN THE MIDDLE OF THE ROOM WENT (update88). The player:
       "te na środku są niewidoczne, jak jest tam załogant, ponadto się
       różnią" — a man standing on it hid it, and it did not match the
       mark in the corner. The corner mark is the one icon now, drawn by
       the same call as the power bar and the crew marks. */

    // ── Module badge: WHAT it is, in its corner ──
    ctx.save();
    const bg = this.badgeRect();
    ctx.fillStyle = 'rgba(7,8,15,0.72)';
    ctx.beginPath(); ctx.roundRect(bg.x, bg.y, bg.w, bg.h, 3); ctx.fill();
    if (typeof Renderer !== 'undefined' && Renderer.drawSystemIcon) {
      Renderer.drawSystemIcon(ctx, this.type, bg.x + bg.w / 2, bg.y + bg.h / 2, 18,
                              powered ? '#c8e8ff' : '#8a7b7b');
    }

  /* THE POWER PIPS USED TO BE HERE.
       Four-by-nine squares along the top-right of every room, repeating
       what the power bar at the bottom of the screen already says, in a
       place where they collided with the module badge and made a busy
       hull unreadable. The bar is the readout; the room is the picture.
       Damage still shows as the red wash and the broken-module tint. */
    ctx.restore();

    // Repair progress ring
    if (this.damagedLevels > 0 && this.repairProgress > 0) {
      ctx.strokeStyle = '#1aff8c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy - 4, 18, -Math.PI/2, -Math.PI/2 + this.repairProgress * Math.PI*2);
      ctx.stroke();
    }

    /* NO NAME IN THE ROOM (update90a). The module's name was printed in
       the duct along the top of every compartment ("Cockpit", "Weapons"
       …) in a dark grey the player could barely read. The badge in the
       corner already says what the module is; the player: "ikony są,
       więc tekst niepotrzebny". The name is in the hover over that badge. */
  }
}

// ── Reactor ───────────────────────────────────────────────
// The reactor is now a ROOM MODULE. Module levels 1–4, each level
// provides 4 power units. Damage is tracked by the linked ShipSystem
// (one pip per power unit): every hit on the reactor room = −1 power
// until crew repair it. `level` keeps its old external meaning for
// station/UI/serialise code, but now means MODULE level (1–4).

class Reactor {
  constructor(moduleLevel = 8, maxLevel = 16) {
    // Each reactor LEVEL = 1 power unit. Max level differs per hull
    // (the starting frigate caps at 16; other ships may differ).
    this.maxLevel     = maxLevel;
    this._moduleLevel = Utils.clamp(moduleLevel, 1, this.maxLevel);
    this.sys          = null;   // linked ShipSystem in the reactor room
    this.penalty      = 0;      // environmental power loss (e.g. nebula −2)
  }

  get level()  { return this._moduleLevel; }
  set level(v) {
    this._moduleLevel = Utils.clamp(Math.round(v), 1, this.maxLevel);
    if (this.sys) {
      this.sys.level = this.capacity;
      this.sys.damagedLevels = Math.min(this.sys.damagedLevels, this.sys.level);
    }
  }

  /** Total power units this module can output when undamaged.
   *  1 power per level. */
  get capacity() { return this._moduleLevel; }

  /**
   * A TERRA CYBORG AT THE REACTOR CONSOLE (update87). His implant runs
   * any module he mans on +1 — the reactor included, where +1 is one more
   * unit for the whole ship to spend. Only while the reactor has a
   * working level left to hang it on: a wrecked core is not rescued by
   * a man standing in it.
   */
  get cyborgBonus() {
    const s = this.sys;
    return (s && s.hasCyborg && s.workingLevels > 0) ? 1 : 0;
  }

  get totalPower() {
    // SCRAMMED: the reactor can be shut down from the power bar like any
    // other module. Nothing draws while it is offline.
    if (this.offline) return 0;
    const dmg = this.sys ? this.sys.damagedLevels : 0;
    return Math.max(0, this.capacity - dmg - this.penalty) + this.cyborgBonus;
  }

  /** Live output ignoring the scram, for the readout. */
  get ratedPower() {
    const dmg = this.sys ? this.sys.damagedLevels : 0;
    return Math.max(0, this.capacity - dmg - this.penalty) + this.cyborgBonus;
  }

  // Legacy direct-damage API (events etc.) — routed to the system
  damage(amount = 1) { if (this.sys) this.sys.damageLevel(amount); }
  repair(amount = 1) {
    if (this.sys) this.sys.damagedLevels =
      Math.max(0, this.sys.damagedLevels - amount);
  }

  upgrade() {
    if (this._moduleLevel < this.maxLevel) { this.level = this._moduleLevel + 1; return true; }
    return false;
  }

  /* upgradeCost() USED TO LIVE HERE and returned 10 + level*8.
   * It was a second, LINEAR price for a thing the station sells at an
   * exponential one, and the station shop rendered its button from this
   * copy while charging from the other — the "I have the CC but it says
   * I do not" bug. There is exactly one reactor price now and the seller
   * owns it: Station.reactorCost(ship) → REACTOR_PRICE in station.js.
   * Do not add a price back onto the hardware. */

  /** Distribute power across systems, returns leftover.
   *  A module operated by a Terra cyborg has ONE of its allocated
   *  reactor units substituted by the cyborg, so that unit is free
   *  again — the player effectively gets +1 power to spend elsewhere.
   *  This ONLY applies once the module is already fully powered
   *  (power === workingLevels): that's the unit the cyborg's own +1
   *  boost would otherwise be wasted on (effectivePower caps at
   *  workingLevels). A partially-powered module still draws exactly
   *  what's allocated — there the cyborg's +1 is genuine extra output,
   *  not a substitute for a real reactor unit, so reclaiming there
   *  used to show "free" power that didn't actually exist anywhere
   *  to spend. */
  distribute(systems) {
    let used = 0;
    systems.forEach(s => { used += s.reactorDraw(); });
    return this.totalPower - used;
  }

  setPower(system, amount, allSystems) {
    const usedByOthers = allSystems.reduce(
      (a, s) => (s === system ? a : a + s.reactorDraw()), 0);
    const free = this.totalPower - usedByOthers;
    // Walk DOWN from the requested allocation to the largest one this
    // module can actually draw from what's left. Doing the arithmetic
    // directly used to mis-handle the cyborg substitution step (the
    // draw is not linear in `amount`: it drops by 1 exactly when the
    // module becomes full), which is what put an unspendable pip on
    // the reactor bar.
    let want = Utils.clamp(Math.round(amount), 0, system.maxPower);
    while (want > 0 && system.reactorDraw(want) > free) want--;
    system.power = want;
  }
}
