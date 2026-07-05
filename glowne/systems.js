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
    label: 'Reactor', icon: 'icon_shields',
    maxLevel: 25, basePower: 8,
    description: 'Provides power to all ship systems.',
  },
  shields: {
    label: 'Shields', icon: 'icon_shields',
    maxLevel: 4, powerPerLayer: 2,
    rechargeTime: 7,
    description: 'Each 2 power = 1 shield layer. Max level 4.',
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

    this._pulse = 0;
  }

  get def()      { return SYSTEM_DEFS[this.type]; }
  get maxPower() { return this.level; }

  /** Usable power slots right now (level minus broken slots) */
  get workingLevels() { return Math.max(0, this.level - this.damagedLevels); }

  isDisabled() {
    return this.workingLevels <= 0 || this.ionDamage > 0 || this.power <= 0;
  }

  effectivePower() {
    if (this.ionDamage > 0) return 0;
    let p = Math.min(this.power, this.workingLevels);
    // Terra cyborg crew add +1 power to the module they operate
    if (p > 0 && this.crew.some(c => c && !c.dead && c.cyborg)) {
      p = Math.min(this.maxPower, p + 1);
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
  }

  _updateShields(dt) {
    const layers = Math.floor(this.effectivePower() / (this.def.powerPerLayer ?? 2));
    this._shieldMax = layers;
    if (this._shieldBars > layers) this._shieldBars = layers;

    if (this._shieldBars < layers) {
      const bonus = this.crew.reduce((a, c) => a + (c ? c.shieldBonus() : 0), 0);
      this._shieldTimer += dt;
      if (this._shieldTimer >= (this.def.rechargeTime ?? 7) - bonus) {
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

  /** Crew repair: fills repairProgress; each full bar restores one level */
  repair(amount, crew = null) {
    if (this.damagedLevels <= 0) return;
    this.repairProgress += amount * 0.25 * (crew ? crew.repairSpeed() : 1);
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

class Reactor {
  constructor(level = 8) {
    this.level     = level;
    this.maxLevel  = 25;
    this._damage   = 0;
  }

  get totalPower() {
    return Math.max(0, this.level - this._damage);
  }

  damage(amount = 1) {
    this._damage = Math.min(this.level, this._damage + amount);
  }

  repair(amount = 1) {
    this._damage = Math.max(0, this._damage - amount);
  }

  upgrade() {
    if (this.level < this.maxLevel) { this.level++; return true; }
    return false;
  }

  upgradeCost() { return (this.level + 1) * 30; }

  /** Distribute power across systems, returns leftover */
  distribute(systems) {
    let used = 0;
    systems.forEach(s => { used += s.power; });
    return this.totalPower - used;
  }

  setPower(system, amount, allSystems) {
    const available = this.totalPower
                    - allSystems.reduce((a, s) => a + (s === system ? 0 : s.power), 0);
    const clamped = Utils.clamp(amount, 0, Math.min(system.maxPower, available + system.power));
    system.power  = clamped;
  }
}
