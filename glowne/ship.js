/* ============================================================
   MOON WARS — ship.js
   Ship class: layout, rooms, systems, hull, crew roster,
   weapons rack, elevator integration, damage resolution.
   Both player and enemy ships use this class.
   ============================================================ */

'use strict';

// ── Door ──────────────────────────────────────────────────

class Door {
  /**
   * Door between two horizontally adjacent rooms on the same floor.
   * Auto-opens when crew are near; closed doors block fire spread.
   */
  constructor(roomA, roomB, x, y) {
    this.roomA  = roomA;   // room id
    this.roomB  = roomB;
    this.x      = x;       // world position (centre of door)
    this.y      = y;
    this.open   = false;
    this._openTimer = 0;   // stays open briefly after crew pass
  }

  update(dt, crew) {
    // Auto-open when any crew within range
    const near = crew.some(c => !c.dead && Utils.dist(c.x, c.y, this.x, this.y) < 30);
    if (near) {
      this.open = true;
      this._openTimer = 1.2;
    } else if (this._openTimer > 0) {
      this._openTimer -= dt;
      if (this._openTimer <= 0) this.open = false;
    }
  }

  draw(ctx) {
    const w = 6, h = 34;
    ctx.fillStyle = this.open ? 'rgba(26,255,140,0.25)' : '#1a3a5a';
    if (this.open) {
      // Open door — two retracted halves
      ctx.fillRect(this.x - w/2, this.y - h/2, w, 6);
      ctx.fillRect(this.x - w/2, this.y + h/2 - 6, w, 6);
    } else {
      ctx.fillRect(this.x - w/2, this.y - h/2, w, h);
      ctx.strokeStyle = '#4db8ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(this.x - w/2, this.y - h/2, w, h);
    }
  }
}

// ── Room ──────────────────────────────────────────────────

class Room {
  constructor(cfg) {
    this.id      = cfg.id;
    this.type    = cfg.type ?? 'empty';   // system type or 'empty'
    this.x       = cfg.x;
    this.y       = cfg.y;
    this.w       = cfg.w ?? 96;
    this.h       = cfg.h ?? 80;
    this.floor   = cfg.floor ?? 0;        // which floor (0=bottom)
    this.cx      = this.x + this.w / 2;
    this.cy      = this.y + this.h / 2;
    this.isVacuum = false;

    // Adjacent room ids (set after all rooms created)
    this.adjacent = cfg.adjacent ?? [];

    // Linked system instance (set by Ship)
    this.system  = null;
  }

  contains(wx, wy) {
    return Utils.pointInRect(wx, wy, this.x, this.y, this.w, this.h);
  }

  /** Repair the system in this room */
  repair(amount, crew) {
    if (this.system) this.system.repair(amount, crew);
  }
}

// ── Ship layouts ──────────────────────────────────────────

const SHIP_LAYOUTS = {

  /** Player starting frigate — 3 floors */
  frigate: {
    label: 'Kestrel Mk II',
    spriteKey: 'ship_player',
    hullMax: 30,
    floors: 3,
    rooms: [
      // Floor 0 (bottom)
      { id:'r_engines',  type:'engines',  x: 20,  y:220, w:96, h:80, floor:0, adjacent:['r_weapons','r_ev0'] },
      { id:'r_weapons',  type:'weapons',  x:136,  y:220, w:96, h:80, floor:0, adjacent:['r_engines','r_shields','r_ev0'] },
      { id:'r_shields',  type:'shields',  x:252,  y:220, w:96, h:80, floor:0, adjacent:['r_weapons','r_ev0'] },

      // Floor 1 (middle)
      { id:'r_piloting', type:'piloting', x: 20,  y:130, w:96, h:80, floor:1, adjacent:['r_oxygen','r_ev0','r_ev1'] },
      { id:'r_oxygen',   type:'oxygen',   x:136,  y:130, w:96, h:80, floor:1, adjacent:['r_piloting','r_medbay','r_ev1'] },
      { id:'r_medbay',   type:'medbay',   x:252,  y:130, w:96, h:80, floor:1, adjacent:['r_oxygen','r_ev1'] },

      // Floor 2 (top — crew quarters / empty)
      { id:'r_crew1',    type:'empty',    x: 68,  y: 40, w:96, h:80, floor:2, adjacent:['r_ev0','r_ev1','r_crew2'] },
      { id:'r_crew2',    type:'empty',    x:184,  y: 40, w:96, h:80, floor:2, adjacent:['r_crew1','r_ev1'] },
    ],
    elevators: [
      { id:'ev0', x: 110, floors:[300, 170, 80] },  // leftmost shaft
      { id:'ev1', x: 232, floors:[300, 170, 80] },   // rightmost shaft
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','medbay'],
    startWeapons: ['laser_basic'],
    reactorLevel: 8,
    weaponX: 360,   // world X where weapons are drawn on hull exterior
    weaponSlots: 4,
  },

  /** Enemy frigate */
  enemy_frigate: {
    label: 'Rebel Interceptor',
    spriteKey: 'ship_enemy',
    hullMax: 20,
    floors: 2,
    rooms: [
      { id:'r_engines',  type:'engines',  x: 20, y:170, w:80, h:72, floor:0, adjacent:['r_weapons','r_ev0'] },
      { id:'r_weapons',  type:'weapons',  x:120, y:170, w:80, h:72, floor:0, adjacent:['r_engines','r_shields','r_ev0'] },
      { id:'r_shields',  type:'shields',  x:220, y:170, w:80, h:72, floor:0, adjacent:['r_weapons','r_ev0'] },
      { id:'r_piloting', type:'piloting', x: 70, y: 90, w:80, h:72, floor:1, adjacent:['r_ev0','r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   x:170, y: 90, w:80, h:72, floor:1, adjacent:['r_piloting','r_ev0'] },
    ],
    elevators: [
      { id:'ev0', x: 155, floors:[242, 126] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen'],
    startWeapons: ['laser_basic'],
    reactorLevel: 7,
    weaponX: 310,
    weaponSlots: 2,
  },
};

// ── Ship ──────────────────────────────────────────────────

class Ship {
  /**
   * @param {string}  layoutKey  - key into SHIP_LAYOUTS
   * @param {boolean} isPlayer
   * @param {number}  worldX     - ship world X origin
   * @param {number}  worldY     - ship world Y origin
   */
  constructor(layoutKey, isPlayer = true, worldX = 0, worldY = 0) {
    this.layoutKey = layoutKey;
    this.layout    = SHIP_LAYOUTS[layoutKey];
    if (!this.layout) throw new Error(`Unknown ship layout: ${layoutKey}`);

    this.isPlayer = isPlayer;
    this.worldX   = worldX;
    this.worldY   = worldY;

    this.label    = this.layout.label;
    this.hull     = this.layout.hullMax;
    this.hullMax  = this.layout.hullMax;

    // ── Build rooms ──────────────────────────────────────
    this.rooms = this.layout.rooms.map(cfg => new Room({
      ...cfg,
      x: worldX + cfg.x,
      y: worldY + cfg.y,
    }));

    // ── Build systems ────────────────────────────────────
    this.systems = [];
    this.reactor  = new Reactor(this.layout.reactorLevel);

    this.layout.startSystems.forEach(type => {
      const sys = new ShipSystem(type, 1);
      this.systems.push(sys);

      // Link to room
      const room = this.rooms.find(r => r.type === type);
      if (room) {
        room.system = sys;
        sys.roomId  = room.id;
        sys.roomX   = room.x;
        sys.roomY   = room.y;
        sys.roomW   = room.w;
        sys.roomH   = room.h;
        sys.cx      = room.cx;
        sys.cy      = room.cy;
      }
    });

    // Default power allocation
    this._allocateDefaultPower();

    // ── Weapons rack ────────────────────────────────────
    this.weapons     = [];
    this.weaponSlots = this.layout.weaponSlots ?? 4;
    this.layout.startWeapons.forEach((wk, i) => {
      this.installWeapon(wk, i);
    });

    // ── Crew ────────────────────────────────────────────
    this.crew = [];

    // ── Subsystems ──────────────────────────────────────
    this.oxygen   = new OxygenManager();
    this.rooms.forEach(r => this.oxygen.addRoom(r.id));

    this.fires    = new FireManager();
    this.breaches = new BreachManager();
    // Expose breaches list directly for compatibility
    Object.defineProperty(this, 'breachesList', {
      get: () => this.breaches.breaches
    });

    // ── Elevators ────────────────────────────────────────
    this.elevators = new ElevatorManager();
    (this.layout.elevators ?? []).forEach(ev => {
      this.elevators.addShaft(ev.id, worldX + ev.x,
        ev.floors.map(fy => worldY + fy));
    });

    // ── Doors between horizontally adjacent rooms ───────
    this.doors = [];
    const donePairs = new Set();
    this.rooms.forEach(room => {
      room.adjacent.forEach(adjId => {
        const other = this.getRoomById(adjId);
        if (!other || other.floor !== room.floor) return;
        const key = [room.id, other.id].sort().join('|');
        if (donePairs.has(key)) return;
        donePairs.add(key);
        // Door at shared vertical edge
        const doorX = room.x < other.x ? room.x + room.w : other.x + other.w;
        const doorY = room.y + room.h * 0.5;
        // Only if rooms actually touch horizontally
        if (Math.abs((room.x + room.w) - other.x) < 30 ||
            Math.abs((other.x + other.w) - room.x) < 30) {
          this.doors.push(new Door(room.id, other.id, doorX, doorY));
        }
      });
    });

    // ── In-flight projectiles ───────────────────────────
    this.projectiles = [];

    // ── Ship sprite (side view) ──────────────────────────
    this.sprite   = Assets.get(this.layout.spriteKey);
    this.spriteW  = this.sprite ? this.sprite.width  : 400;
    this.spriteH  = this.sprite ? this.sprite.height : 300;

    // Shield visual
    this._shieldPulse = null;
    this._shieldAlpha = 0;

    // Destruction
    this.destroyed    = false;
    this._deathTimer  = 0;
    this._explosionTimer = new Utils.Interval(0.18);
  }

  // ── Accessors ────────────────────────────────────────────

  getSystem(type) { return this.systems.find(s => s.type === type) || null; }
  getRoomById(id) { return this.rooms.find(r => r.id === id) || null; }

  getAdjacentRooms(roomId) {
    const room = this.getRoomById(roomId);
    if (!room) return [];
    return room.adjacent.map(id => this.getRoomById(id)).filter(Boolean);
  }

  /** Adjacent rooms reachable through OPEN doors (fire spread uses this) */
  getOpenAdjacentRooms(roomId) {
    const room = this.getRoomById(roomId);
    if (!room) return [];
    return room.adjacent
      .map(id => this.getRoomById(id))
      .filter(r => {
        if (!r) return false;
        // Different floor — no door, fire cannot spread vertically
        if (r.floor !== room.floor) return false;
        const door = this.doors.find(d =>
          (d.roomA === roomId && d.roomB === r.id) ||
          (d.roomB === roomId && d.roomA === r.id));
        return door ? door.open : true;  // no door = open corridor
      });
  }

  /** Which floor index is at world Y? Returns -1 if outside */
  floorAtY(wy) {
    let best = -1, bestDist = Infinity;
    this.rooms.forEach(r => {
      if (wy >= r.y - 10 && wy <= r.y + r.h + 10) {
        const d = Math.abs(r.cy - wy);
        if (d < bestDist) { bestDist = d; best = r.floor; }
      }
    });
    return best;
  }

  /** Walking Y line for a floor (crew feet level) */
  floorWalkY(floorIndex, fallbackY = 0) {
    const roomsOnFloor = this.rooms.filter(r => r.floor === floorIndex);
    if (!roomsOnFloor.length) return fallbackY;
    // Walk line = lower third of room (feet on floor)
    const r = roomsOnFloor[0];
    return r.y + r.h * 0.65;
  }

  get shieldBars() {
    const ss = this.getSystem('shields');
    return ss ? ss.shieldBars : 0;
  }

  get shieldMax() {
    const ss = this.getSystem('shields');
    return ss ? ss.shieldMax : 0;
  }

  get evasion() {
    const eng = this.getSystem('engines');
    return eng ? eng.evasionChance() : 0;
  }

  get hullPct() { return this.hull / this.hullMax; }

  // ── Crew helpers ─────────────────────────────────────────

  addCrew(member) {
    member.x = this.worldX + 180;
    member.y = this.worldY + 170;
    member.targetX = member.x;
    member.targetY = member.y;
    member.roomId  = this.rooms[0]?.id ?? null;
    this.crew.push(member);
  }

  crewInRoom(roomId) {
    return this.crew.filter(c => c.roomId === roomId && !c.dead);
  }

  weaponCrewBonus() {
    const wRoom = this.getRoomById(this.getSystem('weapons')?.roomId);
    if (!wRoom) return 0;
    return this.crewInRoom(wRoom.id)
      .reduce((acc, c) => acc + c.weaponChargeBonus(), 0);
  }

  // ── Weapons ──────────────────────────────────────────────

  installWeapon(defKey, slot) {
    if (slot >= this.weaponSlots) return false;
    const w = new Weapon(defKey, slot);
    this.weapons[slot] = w;
    this._reallocWeaponPower();
    return true;
  }

  removeWeapon(slot) {
    this.weapons[slot] = null;
    this._reallocWeaponPower();
  }

  _reallocWeaponPower() {
    const wSys = this.getSystem('weapons');
    if (!wSys) return;
    let remaining = wSys.power;
    this.weapons.forEach(w => {
      if (!w) return;
      const give = Math.min(w.powerCost, remaining);
      w.power    = give;
      remaining -= give;
    });
  }

  // ── Power management ──────────────────────────────────────

  _allocateDefaultPower() {
    const order = ['shields','weapons','engines','piloting','oxygen','medbay','artillery'];
    let remaining = this.reactor.totalPower;

    order.forEach(type => {
      const sys = this.getSystem(type);
      if (!sys) return;
      const give = Math.min(sys.maxPower, remaining);
      sys.power   = give;
      remaining  -= give;
    });
  }

  setPower(systemType, power) {
    const sys = this.getSystem(systemType);
    if (!sys) return;
    this.reactor.setPower(sys, power, this.systems);
    if (systemType === 'weapons') this._reallocWeaponPower();
    Audio.sfx.powerUp();
  }

  availablePower() {
    return this.reactor.distribute(this.systems);
  }

  // ── Damage resolution ────────────────────────────────────

  /**
   * Receive a projectile hit.
   * Returns { absorbed, hullDamage, roomHit }
   */
  receiveHit(proj) {
    const def = proj.def;

    // Evasion dodge
    if (Math.random() < this.evasion) {
      return { absorbed: true, dodged: true, hullDamage: 0 };
    }

    // Beam always hits regardless of shields
    const isBeam = def.type === 'beam';
    const isMissile = def.type === 'missile' || def.type === 'cannon';

    // Shield check (missiles bypass, beams bypass)
    if (!isMissile && !isBeam && this.shieldBars > 0) {
      const shSys = this.getSystem('shields');
      shSys.hitShield();
      Particles.shieldHit(proj.x, proj.y);
      this._shieldAlpha = 1;
      Camera.shake(4, 0.15);
      return { absorbed: true, hullDamage: 0 };
    }

    // Pick a random room to hit
    const roomHit = Utils.pick(this.rooms);

    // Hull damage
    const dmg  = def.hull_damage ?? def.damage ?? 1;
    this.hull  = Math.max(0, this.hull - dmg);

    // System damage
    if (roomHit.system) {
      roomHit.system.takeDamage(def.damage ?? 1);
    }

    // Ion damage
    if (def.type === 'ion' && roomHit.system) {
      roomHit.system.ionHit();
    }

    // Breach chance (missiles always, heavy hits 25%)
    if (isMissile || (dmg >= 2 && Math.random() < 0.25)) {
      this.breaches.open(
        roomHit.id,
        roomHit.x + Utils.randFloat(8, roomHit.w - 8),
        roomHit.y + Utils.randFloat(8, roomHit.h - 8)
      );
    }

    // Fire chance (25% on hull hit)
    if (Math.random() < 0.25) {
      this.fires.start(roomHit.id, roomHit.cx, roomHit.cy);
    }

    Particles.explosion(proj.x, proj.y, 0.7);
    Camera.shake(6, 0.2);

    if (this.hull <= 0) this._beginDestruction();

    return { absorbed: false, hullDamage: dmg, roomHit };
  }

  _beginDestruction() {
    if (this.destroyed) return;
    this.destroyed = false;   // will flip after death animation
    this._deathTimer = 0;
    Audio.sfx.explosion();
    Camera.shake(20, 0.8);
    Save.recordKill();
  }

  // ── Update ───────────────────────────────────────────────

  update(dt) {
    if (this.destroyed) return;

    // Death animation
    if (this.hull <= 0) {
      this._deathTimer += dt;
      if (this._explosionTimer.tick(dt)) {
        const rx = this.worldX + Utils.randFloat(20, this.spriteW - 20);
        const ry = this.worldY + Utils.randFloat(20, this.spriteH - 20);
        Particles.explosion(rx, ry, Utils.randFloat(0.5, 1.5));
      }
      if (this._deathTimer > 2.5) {
        this.destroyed = true;
      }
      return;
    }

    // Systems
    const crewBonus = this.weaponCrewBonus();
    this.systems.forEach(sys => sys.update(dt));
    this.weapons.forEach(w => { if (w) w.update(dt, crewBonus); });

    // Crew update and room assignment
    this.crew.forEach(c => {
      if (c.dead) return;
      c.update(dt, this);
      // Update roomId based on position
      const inRoom = this.rooms.find(r => r.contains(c.x, c.y));
      if (inRoom) c.roomId = inRoom.id;
    });
    // Remove dead crew (after death anim)
    this.crew = this.crew.filter(c => !c.dead);

    // O2
    this.oxygen.update(dt, this);

    // Fires
    this.fires.update(dt, this);

    // Breaches
    this.breaches.update(dt);

    // Elevators
    this.elevators.update(dt);

    // Doors
    this.doors.forEach(d => d.update(dt, this.crew));

    // Shield fade
    this._shieldAlpha = Math.max(0, this._shieldAlpha - dt * 2);

    // Shield pulse
    if (this._shieldPulse) {
      this._shieldPulse.update(dt);
      if (this._shieldPulse.done) this._shieldPulse = null;
    }
  }

  // ── Draw ─────────────────────────────────────────────────

  draw(ctx) {
    ctx.save();

    // Flip enemy ships so they face left
    if (!this.isPlayer) {
      ctx.translate(this.worldX + this.spriteW, this.worldY);
      ctx.scale(-1, 1);
      ctx.translate(-this.worldX, -this.worldY);
    }

    // Ship sprite
    if (this.sprite) {
      ctx.drawImage(this.sprite, this.worldX, this.worldY);
    }

    ctx.restore();

    // Rooms (with systems, O2, fire, breach overlays)
    this.rooms.forEach(room => {
      if (room.system) room.system.draw(ctx);

      // O2 overlay
      const ro = this.oxygen.getRoom(room.id);
      if (ro) ro.draw(ctx, room.x, room.y, room.w, room.h);
    });

    // Elevators
    this.elevators.draw(ctx);

    // Doors
    this.doors.forEach(d => d.draw(ctx));

    // Crew (particles below crew)
    Particles.draw(ctx, 0);
    this.crew.forEach(c => c.draw(ctx));

    // Fires
    this.fires.draw(ctx);

    // Breaches
    this.breaches.draw(ctx);

    // Weapon mounts on hull exterior
    this._drawWeaponMounts(ctx);

    // Shield ring
    this._drawShield(ctx);

    // Hull damage glow
    if (this.hull / this.hullMax < 0.35) {
      const alpha = (0.35 - this.hull / this.hullMax) * 0.6;
      ctx.fillStyle = `rgba(255,45,68,${alpha})`;
      ctx.fillRect(this.worldX, this.worldY, this.spriteW, this.spriteH);
    }
  }

  _drawWeaponMounts(ctx) {
    const baseX = this.layout.weaponX + this.worldX - (this.isPlayer ? 0 : this.spriteW);
    const baseY = this.worldY + 60;
    this.weapons.forEach((w, i) => {
      if (!w) return;
      w.draw(ctx, baseX, baseY + i * 26, false);
    });
  }

  _drawShield(ctx) {
    if (this._shieldAlpha <= 0 && this.shieldBars <= 0) return;
    const cx  = this.worldX + this.spriteW / 2;
    const cy  = this.worldY + this.spriteH / 2;
    const rx  = this.spriteW * 0.55;
    const ry  = this.spriteH * 0.55;
    const alpha = Math.max(this._shieldAlpha, this.shieldBars > 0 ? 0.25 : 0);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#4db8ff';
    ctx.lineWidth   = 2;
    ctx.shadowBlur  = 12;
    ctx.shadowColor = '#1a8cff';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── Serialise ────────────────────────────────────────────

  serialise() {
    return {
      layoutKey: this.layoutKey,
      hull: this.hull,
      systems: this.systems.map(s => ({ type: s.type, level: s.level, hp: s.hp, power: s.power })),
      weapons: this.weapons.map(w => w ? { defKey: w.defKey, slot: w.slot } : null),
      reactor: this.reactor.level,
    };
  }

  static deserialise(data, isPlayer, wx, wy) {
    const ship = new Ship(data.layoutKey, isPlayer, wx, wy);
    ship.hull  = data.hull;
    ship.reactor.level = data.reactor;

    data.systems.forEach(sd => {
      const sys = ship.getSystem(sd.type);
      if (sys) { sys.level = sd.level; sys.hp = sd.hp; sys.power = sd.power; }
    });

    ship.weapons = [];
    data.weapons.forEach(wd => {
      if (wd) ship.installWeapon(wd.defKey, wd.slot);
    });

    return ship;
  }
}
