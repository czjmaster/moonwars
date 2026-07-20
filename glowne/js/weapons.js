/* ============================================================
   MOON WARS — weapons.js
   Weapon definitions, instances, projectile management.
   Weapons charge based on power allocated, fire projectiles
   that travel to the target ship.
   ============================================================ */

'use strict';

// ── Weapon definitions ────────────────────────────────────

const WEAPON_DEFS = {
  laser_basic: {
    label: 'Laser Mk I', type: 'laser',
    damage: 1, shield_damage: 1, hull_damage: 1,
    powerCost: 1, chargeTime: 5, shots: 1,
    projectileSpeed: 240, missileUse: 0,
    description: 'Basic laser. Blocked by one shield bar.',
    cost: 0,  // starting weapon
  },
  laser_burst: {
    label: 'Burst Laser II', type: 'laser',
    damage: 1, shield_damage: 1, hull_damage: 1,
    powerCost: 2, chargeTime: 12, shots: 3,
    projectileSpeed: 240, missileUse: 0,
    description: 'Fires 3 bolts. Can overwhelm shields.',
    cost: 65,
  },
  missile_basic: {
    label: 'Artemis Missile', type: 'missile',
    damage: 2, shield_damage: 0, hull_damage: 2,
    powerCost: 1, chargeTime: 14, shots: 1,
    projectileSpeed: 150, missileUse: 1,
    description: 'Bypasses shields. Requires a missile.',
    cost: 55,
  },
  ion_basic: {
    label: 'Ion Cannon I', type: 'ion',
    damage: 1, shield_damage: 2, hull_damage: 0,
    powerCost: 1, chargeTime: 7, shots: 1,
    projectileSpeed: 210, missileUse: 0,
    ionHits: 1,
    description: 'Ionises systems. No hull damage.',
    cost: 45,
  },
  cannon_basic: {
    label: 'Hull Cannon', type: 'cannon',
    damage: 3, shield_damage: 0, hull_damage: 3,
    powerCost: 3, chargeTime: 18, shots: 1,
    projectileSpeed: 180, missileUse: 1,
    description: 'Heavy impact. Ignores shields. Expensive ammo.',
    cost: 80,
  },
  laser_heavy: {
    label: 'Heavy Laser', type: 'laser',
    damage: 2, shield_damage: 2, hull_damage: 2,
    powerCost: 2, chargeTime: 10, shots: 1,
    projectileSpeed: 230, missileUse: 0,
    description: 'Deals 2 damage per hit.',
    cost: 70,
  },
  flak_basic: {
    label: 'Flak I', type: 'flak',
    damage: 1, shield_damage: 0, hull_damage: 1,
    powerCost: 2, chargeTime: 8, shots: 3,
    projectileSpeed: 190, missileUse: 0,
    spread: 30,  // pixel spread on target
    description: 'Scatter shot — hits random rooms.',
    cost: 60,
  },
  beam_basic: {
    label: 'Dual Beam', type: 'beam',
    damage: 1, shield_damage: 1, hull_damage: 1,
    powerCost: 2, chargeTime: 20, shots: 1,
    beamLength: 180,  // pixels swept
    projectileSpeed: 0, missileUse: 0,
    description: 'Sweeps a beam across the enemy ship.',
    cost: 85,
  },
};

// ── Projectile ────────────────────────────────────────────

class Projectile {
  constructor(cfg) {
    this.id      = Utils.uid();
    this.x       = cfg.x;
    this.y       = cfg.y;
    this.targetX = cfg.targetX;
    this.targetY = cfg.targetY;
    this.speed   = cfg.speed;
    this.type    = cfg.type;      // laser | missile | ion | cannon | flak
    this.def     = cfg.def;       // WEAPON_DEF reference
    this.fromPlayer = cfg.fromPlayer ?? true;
    this.done    = false;
    this.hit     = false;

    const dx  = this.targetX - this.x;
    const dy  = this.targetY - this.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    this.vx   = (dx / len) * this.speed;
    this.vy   = (dy / len) * this.speed;
    this.angle= Math.atan2(dy, dx);

    // Beam sweep state
    this.beamProgress = 0;

    // Flak spread offset
    this.spreadX = cfg.spreadX ?? 0;
    this.spreadY = cfg.spreadY ?? 0;
    this.targetX += this.spreadX;
    this.targetY += this.spreadY;

    // Missile wobble
    this._wobble = 0;
  }

  update(dt) {
    if (this.done) return;

    if (this.type === 'beam') {
      this.beamProgress = Math.min(1, this.beamProgress + dt * 0.8);
      if (this.beamProgress >= 1) this.done = true;
      return;
    }

    // Missile adds slight tracking
    if (this.type === 'missile') {
      this._wobble += dt * 3;
      const wobAmt = Math.sin(this._wobble) * 20;
      const perp   = this.angle + Math.PI * 0.5;
      this.x += (this.vx + Math.cos(perp) * wobAmt) * dt;
      this.y += (this.vy + Math.sin(perp) * wobAmt) * dt;
    } else {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    if (dx*dx + dy*dy < 16*16) {
      this.done = true;
      this.hit  = true;
    }
  }

  draw(ctx) {
    if (this.done) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    switch (this.type) {
      case 'laser':
      case 'laser_heavy': {
        const sprite = Assets.get('proj_laser');
        if (sprite) ctx.drawImage(sprite, -sprite.width/2, -sprite.height/2);
        else {
          const g = ctx.createLinearGradient(-12, 0, 12, 0);
          g.addColorStop(0, 'rgba(26,140,255,0)');
          g.addColorStop(0.5, '#4db8ff');
          g.addColorStop(1, '#ffffff');
          ctx.fillStyle = g;
          ctx.fillRect(-12, -2, 24, 4);
        }
        break;
      }

      case 'ion': {
        ctx.fillStyle = '#4db8ff';
        ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#1a8cff';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }

      case 'missile': {
        const ms = Assets.get('proj_missile');
        if (ms) ctx.drawImage(ms, -ms.width/2, -ms.height/2);
        else {
          ctx.fillStyle = '#888888';
          ctx.fillRect(-10, -3, 20, 6);
          ctx.fillStyle = '#ff7700';
          ctx.beginPath(); ctx.arc(-8, 0, 4, 0, Math.PI*2); ctx.fill();
        }
        break;
      }

      case 'cannon':
      case 'flak': {
        const cs = Assets.get('proj_cannon');
        if (cs) ctx.drawImage(cs, -cs.width/2, -cs.height/2);
        else {
          ctx.fillStyle = '#ffd700';
          ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI*2); ctx.fill();
        }
        break;
      }
    }

    ctx.restore();
  }

  drawBeam(ctx, shipX, shipY, shipW) {
    if (this.type !== 'beam' || this.beamProgress <= 0) return;
    const endX = shipX + shipW * this.beamProgress;
    const grad = ctx.createLinearGradient(shipX, this.y, endX, this.y);
    grad.addColorStop(0, 'rgba(255,100,20,0.9)');
    grad.addColorStop(0.5, 'rgba(255,200,50,0.8)');
    grad.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 3;
    ctx.shadowBlur  = 12;
    ctx.shadowColor = '#ff7700';
    ctx.beginPath();
    ctx.moveTo(shipX, this.y);
    ctx.lineTo(endX, this.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

// ── Weapon instance ───────────────────────────────────────

class Weapon {
  /**
   * @param {string} defKey  - key into WEAPON_DEFS
   * @param {number} slot    - weapon slot index (0-3)
   */
  constructor(defKey, slot = 0) {
    this.defKey    = defKey;
    this.def       = WEAPON_DEFS[defKey];
    if (!this.def) throw new Error(`Unknown weapon: ${defKey}`);

    this.slot      = slot;
    this.charge    = 0;   // 0–1
    this.armed     = false;
    this.power     = 0;   // bars allocated from weapons system
    this.autoFire  = false;   // AUTO toggle — fires at targetRoom when charged
    this.targetRoom = null;   // remembered enemy room (persists between shots)

    // Visual state
    this._chargeAnim  = null;
    this._chargeTimer = 0;

    // Projectiles owned by this weapon (in flight)
    // Managed by Combat, stored here for draw access
    this.projectiles = [];
  }

  get label()       { return this.def.label; }
  get powerCost()   { return this.def.powerCost; }
  get powered()     { return this.power >= this.powerCost; }

  /** Effective charge time accounting for crew weapon skill */
  chargeTime(crewBonus = 0) {
    return this.def.chargeTime * (1 - crewBonus);
  }

  update(dt, crewBonus = 0, manned = true) {
    if (!this.powered) {
      this.charge = 0;
      this.armed  = false;
      this.unmanned = false;
      return;
    }
    // OPERATOR RULE: no crew in the weapon module = charge FREEZES
    // (it doesn't reset — the gunner just has to come back).
    this.unmanned = !manned;
    if (!manned) return;

    const ct = this.chargeTime(crewBonus);
    this.charge = Math.min(1, this.charge + dt / ct);

    if (this.charge >= 1 && !this.armed) {
      this.armed = true;
      Audio.sfx.weaponCharge();
    }
  }

  /** Fire — returns array of new Projectile objects */
  fire(fromX, fromY, toX, toY, fromPlayer = true) {
    if (!this.armed && this.def.type !== 'beam') return [];

    this.armed  = false;
    this.charge = 0;
    Audio.sfx.weaponFire();

    const projs = [];
    const shots = this.def.shots ?? 1;

    for (let i = 0; i < shots; i++) {
      const spreadX = this.def.spread ? Utils.randFloat(-this.def.spread, this.def.spread) : 0;
      const spreadY = this.def.spread ? Utils.randFloat(-this.def.spread * 0.5, this.def.spread * 0.5) : 0;

      projs.push(new Projectile({
        x: fromX, y: fromY,
        targetX: toX, targetY: toY,
        speed: this.def.projectileSpeed,
        type: this.def.type,
        def: this.def,
        fromPlayer,
        spreadX, spreadY,
      }));
    }

    return projs;
  }

  draw(ctx, x, y, selected = false) {
    // Draw weapon mount on ship hull
    const w = 40, h = 16;

    ctx.fillStyle = selected
      ? 'rgba(26,140,255,0.4)'
      : (this.powered ? 'rgba(26,140,255,0.15)' : 'rgba(80,80,100,0.2)');
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();

    ctx.strokeStyle = selected ? '#4db8ff' : (this.powered ? '#1a5a99' : '#2a3040');
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Charge bar
    if (this.powered) {
      ctx.fillStyle = this.armed ? '#1aff8c' : '#1a8cff';
      ctx.fillRect(x + 2, y + h - 4, (w - 4) * this.charge, 3);
    }
  }
}

// ── Weapon shop / loot pool ───────────────────────────────

function randomWeaponDrop(sector = 1) {
  const pool = Object.entries(WEAPON_DEFS)
    .filter(([k, d]) => d.cost > 0 && d.cost <= 40 + sector * 20);
  if (!pool.length) return null;
  const [key] = Utils.pick(pool);
  return key;
}

function getWeaponDef(key) { return WEAPON_DEFS[key] || null; }
function allWeaponKeys()   { return Object.keys(WEAPON_DEFS); }
