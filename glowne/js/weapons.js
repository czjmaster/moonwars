/* ============================================================
   MOON WARS — weapons.js
   Weapon definitions, instances, projectile management.
   Weapons charge based on power allocated, fire projectiles
   that travel to the target ship.
   ============================================================ */

'use strict';

// ── Weapon definitions ────────────────────────────────────

// Charge readout geometry. Boxes are a fixed size so a 6-second gun and
// an 18-second gun are directly comparable at a glance — the strip grows
// instead of the boxes shrinking to nothing.
/** Mix a hex colour toward white / black. Used for charge boxes. */
function _lighten(hex, amt) {
  const c = Utils.hexToRgb(hex);
  const m = (v) => Math.round(v + (255 - v) * amt);
  return `rgb(${m(c.r)},${m(c.g)},${m(c.b)})`;
}
function _darken(hex, amt) {
  const c = Utils.hexToRgb(hex);
  const m = (v) => Math.round(v * (1 - amt));
  return `rgb(${m(c.r)},${m(c.g)},${m(c.b)})`;
}

const CHARGE_BOX_W   = 5;
const CHARGE_BOX_GAP = 1;

const WEAPON_DEFS = {
  laser_basic: {
    label: 'Laser Mk I', type: 'laser',
    damage: 1, shield_damage: 1, hull_damage: 1,
    powerCost: 1, chargeTime: 6, shots: 1,
    projectileSpeed: 240, missileUse: 0,
    fireChance: 0.10,   // starter gun: slow, and it rarely sets fires
    description: 'Basic laser. Blocked by one shield bar. Slow to charge, seldom ignites.',
    cost: 0,  // starting weapon
  },
  laser_burst: {
    label: 'Burst Laser II', type: 'laser',
    damage: 1, shield_damage: 1, hull_damage: 1,
    powerCost: 2, chargeTime: 14, shots: 3, burstGap: 0.42,
    projectileSpeed: 240, missileUse: 0,
    description: 'Fires 3 bolts one after another. Can overwhelm shields, '
               + 'but the reload is long.',
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
    powerCost: 2, chargeTime: 10, shots: 3, burstGap: 0.38,
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

    // Burst stagger: a 3-shot gun used to spawn all three projectiles at
    // the same point in the same frame, so they overlapped perfectly and
    // read as ONE bolt. Each shot now waits its turn.
    this.launchDelay = cfg.launchDelay ?? 0;
  }

  update(dt) {
    if (this.done) return;
    if (this.launchDelay > 0) {
      this.launchDelay -= dt;
      if (this.launchDelay <= 0) {
        // Each shot of a burst gets its own bang and flash — otherwise
        // three staggered bolts leave the ship in silence after the first.
        Audio?.sfx?.weaponFire?.();
        Particles?.muzzleFlash?.(this.x, this.y,
          this.fromPlayer ? 1 : -1,
          this.type === 'missile' ? '#ffb347' : '#ff2d44');
      }
      return;
    }

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
    if (this.launchDelay > 0) return;   // still in the tube

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    switch (this.type) {
      case 'laser':
      case 'laser_heavy': {
        const sprite = Assets.get('proj_laser');
        // Laser bolts are RED now — the blue read as friendly-UI colour
        // against a blue HUD. The pre-baked sprite is blue, so we draw
        // the bolt ourselves rather than tinting it.
        {
          const g = ctx.createLinearGradient(-12, 0, 12, 0);
          g.addColorStop(0, 'rgba(255,45,68,0)');
          g.addColorStop(0.5, '#ff2d44');
          g.addColorStop(1, '#ffdde2');
          ctx.fillStyle = g;
          ctx.fillRect(-12, -2, 24, 4);
          ctx.fillStyle = 'rgba(255,120,140,0.35)';
          ctx.fillRect(-14, -3.5, 28, 7);
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
    this.crewBonus = 0;       // last gunner bonus, refreshed every update()

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

  /**
   * Effective charge time, accounting for the crew on this gun.
   *
   * The bonus is CLAMPED. It is a plain sum over everyone in the bay
   * (0.1 per Weapons level), so three mastered gunners in one bay summed
   * to exactly 1.0 → charge time 0 → `dt / 0` → Infinity, and a fourth
   * pushed it NEGATIVE, which drove the charge backwards and left the
   * gun permanently unarmed. Cramming a bay is now merely very good.
   */
  chargeTime(crewBonus = this.crewBonus ?? 0) {
    const b = Math.min(0.75, Math.max(0, crewBonus || 0));
    return Math.max(0.5, this.def.chargeTime * (1 - b));
  }

  update(dt, crewBonus = 0, manned = true) {
    // Remembered so that every READOUT (the HUD card, the strip on the
    // hull, the seconds label) can show what this gun actually does with
    // this gunner on it, instead of the number off the factory plate.
    this.crewBonus = crewBonus;
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

    // Wide enough that three bolts read as three EVENTS, not one salvo.
    const gap = this.def.burstGap ?? 0.35;   // seconds between shots in a burst

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
        launchDelay: i * gap,
      }));
    }

    return projs;
  }

  /**
   * A real gun, not a grey box. `dir` is which way it points, so the
   * same routine works on either hull.
   */
  /** Charge boxes: ONE PER SECOND, so you can count the wait.
   *  Counted off the CREW-ADJUSTED time — a 10s gun with a good gunner
   *  charges in 8, so it must show eight boxes and say 8s. Showing ten
   *  boxes that visibly filled in eight seconds was the confusing part. */
  chargeSeconds() { return Math.max(1, Math.round(this.chargeTime())); }

  /** True when the crew are actually shortening the wait — readouts
   *  tint the number so the player can see the gunner paying off. */
  get chargeBoosted() { return this.chargeSeconds() < Math.max(1, Math.round(this.def.chargeTime ?? 1)); }

  /** How wide that strip is — the mounts space themselves by this. */
  chargeStripWidth() {
    const n = this.chargeSeconds();
    return n * CHARGE_BOX_W + (n - 1) * CHARGE_BOX_GAP;
  }

  draw(ctx, x, y, selected = false, dir = 1) {
    const w = 44, h = 18;

    if (selected) {
      ctx.fillStyle = 'rgba(26,140,255,0.28)';
      ctx.beginPath(); ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 3); ctx.fill();
      ctx.strokeStyle = '#4db8ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 3); ctx.stroke();
    }

    Renderer.drawWeaponIcon?.(ctx, this.defKey, x, y, w, h,
                              { dir, powered: this.powered, type: this.def.type });

    // ── Charge as SECONDS, not as a smooth bar ──
    // One box per second of charge time: a 9-second gun shows nine
    // boxes and you can count how long you have left at a glance.
    const col  = (Renderer.weaponStyleColor?.(this.defKey, this.def.type))
              || Renderer.weaponColor?.(this.def.type) || '#ff2d44';
    const secs = this.chargeSeconds();
    const bw   = CHARGE_BOX_W;
    const tw   = this.chargeStripWidth();
    const bx0  = x + Math.round((w - tw) / 2);   // strip may overhang the gun
    const by   = y + h + 3;
    const done = (this.powered ? Utils.clamp(this.charge, 0, 1) : 0) * secs;

    for (let i = 0; i < secs; i++) {
      const bx = bx0 + i * (bw + CHARGE_BOX_GAP);
      const full = i < Math.floor(done);
      const part = !full && i === Math.floor(done) ? done - Math.floor(done) : 0;
      ctx.fillStyle = 'rgba(6,9,16,0.9)';
      ctx.fillRect(bx, by, bw, 5);
      if (full || part > 0) {
        // The boxes wear the GUN's colour, so a cyan ion cannon charges
        // cyan and a red laser charges red — you can tell which gun is
        // filling without reading the label.
        ctx.fillStyle = this.armed ? _lighten(col, 0.45) : col;
        ctx.fillRect(bx, by, full ? bw : Math.max(1, bw * part), 5);
      }
      ctx.strokeStyle = this.armed ? _lighten(col, 0.45) : _darken(col, 0.55);
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 4);
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

/**
 * The stat line for a gun, as data.
 *
 * Every surface that describes a weapon — the station shop, the base
 * armoury, the combat HUD — used to hand-roll its own string, which is
 * how POWER ended up with a bolt beside it and DMG ended up as a bare
 * digit. One list, one order, one icon per stat, everywhere.
 *
 * `chargeTime` may be overridden with the CREW-ADJUSTED figure so a
 * readout can show what the gun will really do with this gunner on it,
 * rather than the number off the factory plate.
 */
function weaponStatChips(def, { chargeTime = null } = {}) {
  if (!def) return [];
  const ct = chargeTime == null ? def.chargeTime : chargeTime;
  const shownCt = Math.round(ct * 10) / 10;
  const chips = [
    { key: 'dmg',    icon: 'dmg',    label: 'DMG',    value: String(def.damage ?? 0),
      col: '#ff5566' },
    { key: 'charge', icon: 'charge', label: 'CHARGE', value: `${shownCt}s`,
      col: '#4db8ff', boosted: chargeTime != null && shownCt < def.chargeTime },
    { key: 'power',  icon: 'power',  label: 'POWER',  value: String(def.powerCost ?? 0),
      col: '#ffb020' },
    { key: 'shots',  icon: 'shots',  label: 'SHOTS',  value: String(def.shots ?? 1),
      col: '#1aff8c' },
  ];
  if (def.missileUse) {
    chips.push({ key: 'ammo', icon: 'ammo', label: 'AMMO',
                 value: `${def.missileUse} msl`, col: '#ff7c20' });
  }
  return chips;
}

if (typeof window !== 'undefined') window.weaponStatChips = weaponStatChips;
