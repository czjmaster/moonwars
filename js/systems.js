/* ============================================================
   MOON WARS — systems.js
   Ship system definitions and runtime instances.
   Reactor manages total power budget.
   Each system: power slots, damage levels, crew bonuses.
   ============================================================ */

'use strict';

// ── System type registry ──────────────────────────────────

const SYSTEM_DEFS = {
  reactor: {
    label: 'Reactor', icon: 'icon_engines',
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
    label: 'Cloak', icon: 'icon_engines',
    maxLevel: 2,
    description: 'Active cloak: tap to vanish for a few seconds (big evasion), then recharge.',
    cloakDuration: 6,    // seconds invisible
    cloakCooldown: 22,   // seconds to recharge after it ends
  },
  autorepair: {
    label: 'Repair Bay', icon: 'icon_medbay',
    maxLevel: 2,
    description: 'Nanobot swarm slowly repairs ALL damaged systems while powered.',
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
    label: 'Artillery', icon: 'icon_weapons',
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
    this.ionDamage = 0;          // whole seconds left, for the readout
    this._stunT    = 0;          // the real countdown, in seconds
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
    return this.workingLevels <= 0 || this.ionDamage > 0 || this.effectivePower() <= 0;
  }

  /** Does a live Terra cyborg currently operate this module? */
  get hasCyborg() {
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
    if (this.ionDamage > 0) return 0;
    let p = Math.min(this.power, this.workingLevels);
    // A Terra cyborg feeds the module they stand in like a portable
    // reactor: +1 power, but ONLY up to the module's maxPower (a full
    // module gains nothing). If the module was already full, the
    // cyborg REPLACES one reactor unit — see reclaimCyborgPower(),
    // which frees that reactor unit back to the power bank.
    if (this.workingLevels > 0 && this.hasCyborg) {
      p = Math.min(this.workingLevels, p + 1);
    }
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
    if (this._stunT > 0) {
      this._stunT = Math.max(0, this._stunT - dt);
      this.ionDamage = this._stunT > 0 ? Math.ceil(this._stunT) : 0;
    }

    if (this.type === 'shields') this._updateShields(dt);
    if (this.type === 'artillery' && !this.isDisabled()) {
      this._beamCharge = Math.min(1, this._beamCharge + dt / 30);
    }
    if (this.type === 'medbay' && !this.isDisabled()) {
      this.crew.forEach(c => { if (c && !c.dying) c.heal(6 * dt * this.effectivePower()); });
    }
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
      const bonus = Math.min(0.6,
        this.crew.reduce((a, c) => a + (c ? c.shieldBonus() : 0), 0));
      this._shieldNeed = Math.max(1, (this.def.rechargeTime ?? 7) * (1 - bonus));
      this._shieldTimer += dt;
      if (this._shieldTimer >= this._shieldNeed) {
        this._shieldTimer = 0;
        this._shieldBars++;
        Audio.sfx.shieldRecharge();
        // FTL XP: crew manning shields learn from each recharge
        this.crew.forEach(c => { if (c && !c.dead) c.addXP('shields', 6); });
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
  ionHit(seconds = 1) {
    this._stunT = (this._stunT ?? 0) + Math.max(0, seconds);
    this.ionDamage = Math.ceil(this._stunT);
  }

  /** Seconds of stun left — what the HUD should show. */
  get stunLeft() { return this._stunT ?? 0; }

  /** Crew repair: fills repairProgress; each full bar restores one level.
   *  Base rate ≈ 8s per level for an unskilled crew member. */
  repair(amount, crew = null) {
    if (this.damagedLevels <= 0) return;
    this.repairProgress += amount * 0.12 * (crew ? crew.repairSpeed() : 1);
    if (crew) crew.addXP('repair', amount * 0.5);
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

  // ── Draw (room interior) ─────────────────────────────────

  draw(ctx) {
    const x = this.roomX, y = this.roomY, w = this.roomW, h = this.roomH;

    const tileName = `room_${this.type}`;
    const tile = Assets.get(Assets.has(tileName) ? tileName : 'room_default');
    if (tile) {
      const tW = 48, tH = 48;
      for (let tx = 0; tx < w; tx += tW) {
        for (let ty = 0; ty < h; ty += tH) {
          ctx.drawImage(tile, 0, 0, tile.width, tile.height,
                        x + tx, y + ty,
                        Math.min(tW, w - tx), Math.min(tH, h - ty));
        }
      }
    }

    // Damage overlay
    if (this.damagedLevels > 0) {
      const a = Math.min(0.5, this.damagedLevels / this.level * 0.5);
      ctx.fillStyle = `rgba(255,45,68,${a})`;
      ctx.fillRect(x, y, w, h);
    }
    if (this.ionDamage > 0) {
      ctx.fillStyle = `rgba(77,184,255,${0.15 * this.ionDamage})`;
      ctx.fillRect(x, y, w, h);
    }

    const powered = !this.isDisabled();
    const pulse = powered ? 0.5 + 0.5 * Math.sin(this._pulse) : 0;
    ctx.strokeStyle = powered
      ? `rgba(26,140,255,${0.35 + 0.2 * pulse})`
      : 'rgba(120,90,90,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Icon
    const icon = Assets.get(this.icon);
    if (icon) {
      const iSize = 26;
      ctx.globalAlpha = powered ? 0.75 + 0.2 * pulse : 0.35;
      ctx.drawImage(icon, this.cx - iSize/2, this.cy - iSize/2 - 4, iSize, iSize);
      ctx.globalAlpha = 1;
    }

    // ── Module badge: WHAT it is and HOW BIG it is, on the room ──
    // Looking at a hull should tell you the layout without clicking.
    ctx.save();
    const glyph = (typeof Renderer !== 'undefined' && Renderer.systemGlyph)
      ? Renderer.systemGlyph(this.type) : '?';
    ctx.fillStyle = 'rgba(7,8,15,0.72)';
    ctx.beginPath(); ctx.roundRect(x + 3, y + 3, 16, 14, 2); ctx.fill();
    ctx.fillStyle = powered ? '#c8e8ff' : '#8a7b7b';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(glyph, x + 11, y + 14);

    // Level pips — ONE PER POWER SLOT, so what you see on the hull is
    // exactly what the power bar and the hangar readout say.
    if (this.type !== 'reactor') {
      const n = this.level;
      const pw = 4, pgap = 2;
      const tot = n * pw + (n - 1) * pgap;
      let px = x + w - 4 - tot;
      for (let i = 0; i < n; i++) {
        const broken = i >= (this.level - this.damagedLevels);
        const lit    = !broken && i < this.power;
        ctx.fillStyle = broken ? '#ff2d44' : lit ? '#1aff8c' : '#26324a';
        ctx.fillRect(px, y + 5, pw, 9);
        px += pw + pgap;
      }
    }
    ctx.restore();

    // Repair progress ring
    if (this.damagedLevels > 0 && this.repairProgress > 0) {
      ctx.strokeStyle = '#1aff8c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy - 4, 18, -Math.PI/2, -Math.PI/2 + this.repairProgress * Math.PI*2);
      ctx.stroke();
    }

    // Label
    ctx.save();
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillStyle = 'rgba(7,8,15,0.75)';
    const labelW = ctx.measureText(this.label).width + 10;
    ctx.fillRect(this.cx - labelW/2, y + h - 18, labelW, 15);
    ctx.fillStyle = powered ? '#e8f4ff' : '#c09090';
    ctx.textAlign = 'center';
    ctx.fillText(this.label, this.cx, y + h - 6);
    ctx.restore();
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

  get totalPower() {
    // SCRAMMED: the reactor can be shut down from the power bar like any
    // other module. Nothing draws while it is offline.
    if (this.offline) return 0;
    const dmg = this.sys ? this.sys.damagedLevels : 0;
    return Math.max(0, this.capacity - dmg - this.penalty);
  }

  /** Live output ignoring the scram, for the readout. */
  get ratedPower() {
    const dmg = this.sys ? this.sys.damagedLevels : 0;
    return Math.max(0, this.capacity - dmg - this.penalty);
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
