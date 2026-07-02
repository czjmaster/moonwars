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
    maxPower: 4, maxLevel: 4,
    rechargeTime: 7,  // seconds per bar
    description: 'Absorbs projectile damage. Each 2 power = 1 shield bar.',
  },
  weapons: {
    label: 'Weapons', icon: 'icon_weapons',
    maxPower: 8, maxLevel: 4,
    description: 'Powers weapon systems. More power = faster charge.',
  },
  engines: {
    label: 'Engines', icon: 'icon_engines',
    maxPower: 4, maxLevel: 4,
    description: 'Evasion chance. More power = higher dodge %.',
  },
  oxygen: {
    label: 'O₂', icon: 'icon_oxygen',
    maxPower: 3, maxLevel: 3,
    description: 'Maintains oxygen levels throughout the ship.',
  },
  medbay: {
    label: 'Medbay', icon: 'icon_medbay',
    maxPower: 2, maxLevel: 2,
    description: 'Slowly heals crew inside the room.',
  },
  piloting: {
    label: 'Piloting', icon: 'icon_piloting',
    maxPower: 1, maxLevel: 1,
    description: 'Required to pilot the ship. Provides base evasion.',
  },
  artillery: {
    label: 'Artillery', icon: 'icon_weapons',
    maxPower: 4, maxLevel: 2,
    description: 'Heavy beam weapon — bypasses shields.',
  },
};

// ── System instance ───────────────────────────────────────

class ShipSystem {
  /**
   * @param {string} type  - key into SYSTEM_DEFS
   * @param {number} level - upgrade level (0-based, determines max power)
   */
  constructor(type, level = 1) {
    this.type   = type;
    const def   = SYSTEM_DEFS[type];
    if (!def) throw new Error(`Unknown system type: ${type}`);

    this.label   = def.label;
    this.icon    = def.icon;
    this.level   = Math.min(level, def.maxLevel ?? 4);

    // Power
    this.maxPower     = def.maxPower ?? 0;
    this.power        = 0;            // currently allocated bars
    this.requestedPow = 0;            // what player wants

    // Damage: 0=fine, 1=ion/disabled, 2=on-fire, 3=destroyed
    this.damage   = 0;
    this.hp       = level * 25;       // system HP for repair purposes
    this.maxHp    = this.hp;

    // Ion damage (temporary disable)
    this.ionDamage   = 0;  // stacked ion hits
    this.ionTimer    = new Utils.Timer(5);

    // Crew at this system (room)
    this.crew     = [];

    // Room geometry (set by Ship when rooms are positioned)
    this.roomId   = null;
    this.roomX    = 0;
    this.roomY    = 0;
    this.roomW    = 96;
    this.roomH    = 80;
    this.cx       = 0;   // centre
    this.cy       = 0;

    // Shield-specific
    this._shieldBars    = 0;
    this._shieldMax     = 0;
    this._shieldTimer   = 0;

    // Pulse animation (for rendering)
    this._pulse  = 0;

    // Artillery-specific
    this._beamCharge = 0;
  }

  get def() { return SYSTEM_DEFS[this.type]; }

  // ── Power ────────────────────────────────────────────────

  isDisabled() {
    return this.damage >= 3 || this.ionDamage > 0 || this.power <= 0;
  }

  effectivePower() {
    if (this.damage >= 3 || this.ionDamage > 0) return 0;
    return this.power;
  }

  // ── Update ───────────────────────────────────────────────

  update(dt) {
    this._pulse = (this._pulse + dt * 2) % (Math.PI * 2);

    // Ion decay
    if (this.ionDamage > 0) {
      if (this.ionTimer.tick(dt)) {
        this.ionDamage = Math.max(0, this.ionDamage - 1);
        this.ionTimer.reset();
      }
    }

    // Shields recharge
    if (this.type === 'shields') this._updateShields(dt);

    // Artillery beam charge
    if (this.type === 'artillery') this._updateArtillery(dt);

    // Medbay healing
    if (this.type === 'medbay' && !this.isDisabled()) {
      this.crew.forEach(c => {
        if (c && !c.dying) c.heal(8 * dt * this.effectivePower());
      });
    }
  }

  _updateShields(dt) {
    const ep  = this.effectivePower();
    this._shieldMax = Math.floor(ep / 2);

    if (this._shieldBars < this._shieldMax) {
      const rechargeDur = (this.def.rechargeTime ?? 7)
                        - (this.crew.reduce((acc, c) => acc + (c ? c.shieldBonus() : 0), 0));
      this._shieldTimer += dt;
      if (this._shieldTimer >= rechargeDur) {
        this._shieldTimer = 0;
        this._shieldBars++;
        Audio.sfx.shieldRecharge();
      }
    }
  }

  _updateArtillery(dt) {
    if (this.isDisabled()) return;
    this._beamCharge = Math.min(1, this._beamCharge + dt / 30);
  }

  // ── Shield interface ──────────────────────────────────────

  get shieldBars()  { return this._shieldBars; }
  get shieldMax()   { return this._shieldMax; }

  hitShield() {
    if (this._shieldBars > 0) {
      this._shieldBars--;
      this._shieldTimer = 0;
      Audio.sfx.shieldHit();
      return true;  // absorbed
    }
    return false;   // penetrated
  }

  // ── Damage / repair ───────────────────────────────────────

  takeDamage(amount) {
    this.hp    = Math.max(0, this.hp - amount);
    this.damage = Math.min(3, Math.floor((1 - this.hp / this.maxHp) * 4));
    if (this.damage >= 3) this.power = 0;
  }

  ionHit() {
    this.ionDamage++;
    this.ionTimer.reset();
    // Immediately reduce effective power
  }

  repair(amount, crew = null) {
    this.hp     = Math.min(this.maxHp, this.hp + amount * 12);
    this.damage = Math.max(0, Math.floor((1 - this.hp / this.maxHp) * 4));
    if (crew) crew.addXP('repair', amount * 0.5);
  }

  isFullyRepaired() { return this.hp >= this.maxHp; }

  // ── Evasion / engine helper ───────────────────────────────

  evasionChance() {
    if (this.type !== 'engines' || this.isDisabled()) return 0;
    const base  = this.effectivePower() * 0.05;          // 5% per bar
    const pilot = this.crew.reduce((acc, c) => acc + (c ? c.pilotBonus() : 0), 0);
    const eng   = this.crew.reduce((acc, c) => acc + (c ? c.engineBonus() : 0), 0);
    return Utils.clamp(base + pilot + eng, 0, 0.6);      // max 60%
  }

  // ── Upgrade ──────────────────────────────────────────────

  upgrade() {
    const maxLvl = this.def.maxLevel ?? 4;
    if (this.level >= maxLvl) return false;
    this.level++;
    this.maxHp = this.level * 25;
    this.hp    = Math.min(this.hp + 25, this.maxHp);
    return true;
  }

  upgradeCost() {
    return (this.level + 1) * 50;
  }

  // ── Draw ─────────────────────────────────────────────────

  draw(ctx) {
    const x = this.roomX, y = this.roomY, w = this.roomW, h = this.roomH;

    // Room background tile
    const tileName = `room_${this.type}`;
    const tile     = Assets.get(Assets.has(tileName) ? tileName : 'room_default');
    if (tile) {
      // Tile the room background
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
    if (this.damage > 0) {
      const a = this.damage / 4 * 0.5;
      ctx.fillStyle = `rgba(255,45,68,${a})`;
      ctx.fillRect(x, y, w, h);
    }

    // Ion overlay
    if (this.ionDamage > 0) {
      ctx.fillStyle = `rgba(77,184,255,${0.15 * this.ionDamage})`;
      ctx.fillRect(x, y, w, h);
    }

    // Room border
    const powered = !this.isDisabled();
    const pulse   = powered ? 0.5 + 0.5 * Math.sin(this._pulse) : 0;
    ctx.strokeStyle = powered
      ? `rgba(26,140,255,${0.3 + 0.2 * pulse})`
      : 'rgba(80,80,100,0.3)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // System icon (centre)
    const icon = Assets.get(this.icon);
    if (icon) {
      const iSize = 28;
      ctx.globalAlpha = powered ? 0.7 + 0.2 * pulse : 0.3;
      ctx.drawImage(icon, this.cx - iSize/2, this.cy - iSize/2, iSize, iSize);
      ctx.globalAlpha = 1;
    }

    // Power bars (bottom of room)
    this._drawPowerBars(ctx, x, y, w, h);

    // Label
    ctx.fillStyle   = powered ? '#c8d8f0' : '#4a6080';
    ctx.font        = '11px Share Tech Mono, monospace';
    ctx.textAlign   = 'center';
    ctx.fillText(this.label, this.cx, y + h - 8);
  }

  _drawPowerBars(ctx, x, y, w, h) {
    if (!this.maxPower) return;
    const barW = 6, barH = 14, gap = 2;
    const total = (barW + gap) * this.maxPower - gap;
    const startX = this.cx - total / 2;
    const barY   = y + 6;

    for (let i = 0; i < this.maxPower; i++) {
      const bx  = startX + i * (barW + gap);
      const lit = i < this.power;
      const ion = this.ionDamage > 0 && lit;

      ctx.fillStyle = ion      ? '#4db8ff'
                    : lit      ? '#1aff8c'
                    : '#0f2010';
      ctx.fillRect(bx, barY, barW, barH);
      ctx.strokeStyle = '#07080f';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(bx, barY, barW, barH);
    }
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
