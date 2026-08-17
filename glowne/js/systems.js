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
    this.ionDamage = 0;
    this.ionTimer  = new Utils.Timer(5);

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
    return this.workingLevels <= 0 || this.ionDamage > 0 || this.power <= 0;
  }

  /** Does a live Terra cyborg currently operate this module? */
  get hasCyborg() {
    return this.crew.some(c => c && c.alive !== false && !c.dead && c.cyborg);
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

    // Ion decay
    if (this.ionDamage > 0 && this.ionTimer.tick(dt)) {
      this.ionDamage = Math.max(0, this.ionDamage - 1);
      this.ionTimer.reset();
    }

    if (this.type === 'shields') this._updateShields(dt);
    if (this.type === 'artillery' && !this.isDisabled()) {
      this._beamCharge = Math.min(1, this._beamCharge + dt / 30);
    }
    if (this.type === 'medbay' && !this.isDisabled()) {
      this.crew.forEach(c => { if (c && !c.dying) c.heal(6 * dt * this.effectivePower()); });
    }
    if (this.type === 'cloaking') {
      if (this.cloakActive) {
        this.cloakTimer -= dt;
        if (this.cloakTimer <= 0) {
          this.cloakActive = false;
          this.cloakCd = this.def.cloakCooldown ?? 22;
        }
      } else if (this.cloakCd > 0) {
        this.cloakCd -= dt;
      }
    }
  }

  _updateShields(dt) {
    const layers = Math.floor(this.effectivePower() / (this.def.powerPerLayer ?? 2));
    this._shieldMax = layers;
    if (this._shieldBars > layers) this._shieldBars = layers;

    if (this._shieldBars < layers) {
      const bonus = this.crew.reduce((a, c) => a + (c ? c.shieldBonus() : 0), 0);
      this._shieldNeed = Math.max(1, (this.def.rechargeTime ?? 7) - bonus);
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

  ionHit() {
    this.ionDamage++;
    this.ionTimer.reset();
  }

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

  upgradeCost() { return 10 + this._moduleLevel * 8; }

  /** Distribute power across systems, returns leftover.
   *  A module operated by a Terra cyborg has ONE of its allocated
   *  reactor units substituted by the cyborg, so that unit is free
   *  again — the player effectively gets +1 power to spend elsewhere. */
  distribute(systems) {
    let used = 0;
    systems.forEach(s => {
      let p = s.power;
      // Cyborg reclaims one reactor unit on a module that has power
      // allocated (an empty module the cyborg powers alone doesn't
      // free anything — there was no reactor unit there to reclaim).
      if (p > 0 && s.hasCyborg) p -= 1;
      used += p;
    });
    return this.totalPower - used;
  }

  setPower(system, amount, allSystems) {
    // Same reclaim rule when checking how much is available for THIS
    // system: cyborg-fed units elsewhere don't count against the bank.
    const usedByOthers = allSystems.reduce((a, s) => {
      if (s === system) return a;
      let p = s.power;
      if (p > 0 && s.hasCyborg) p -= 1;
      return a + p;
    }, 0);
    const selfReclaim = (system.power > 0 && system.hasCyborg) ? 1 : 0;
    const available = this.totalPower - usedByOthers + selfReclaim;
    const clamped = Utils.clamp(amount, 0, Math.min(system.maxPower, available + system.power - selfReclaim));
    system.power  = clamped;
  }
}
