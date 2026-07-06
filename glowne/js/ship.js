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
   * Door between two adjacent rooms — or an AIRLOCK to space (roomB = null).
   * Modes: 'auto' (opens for crew), 'open' (player-locked open = venting),
   *        'closed' (player-locked shut).
   * Open airlocks vent the room's oxygen to space (FTL fire-fighting tactic).
   */
  constructor(roomA, roomB, x, y, isAirlock = false) {
    this.roomA  = roomA;
    this.roomB  = roomB;        // null = space
    this.x      = x;
    this.y      = y;
    this.isAirlock = isAirlock;
    this.mode   = isAirlock ? 'closed' : 'auto';
    this.open   = false;
    this._openTimer = 0;
  }

  /** Player click: cycle auto → open → closed (airlocks: closed ↔ open) */
  toggle() {
    if (this.isAirlock) {
      this.mode = this.mode === 'open' ? 'closed' : 'open';
    } else {
      this.mode = this.mode === 'auto' ? 'open'
                : this.mode === 'open' ? 'closed'
                : 'auto';
    }
    Audio.sfx.uiClick();
  }

  update(dt, crew) {
    if (this.mode === 'open') {
      this.open = true;
      // Venting particles for open airlocks (throttled)
      if (this.isAirlock) {
        this._ventT = (this._ventT ?? 0) + dt;
        if (this._ventT > 0.15) {
          this._ventT = 0;
          Particles.emit({
            x: this.x, y: this.y + Utils.randFloat(-12, 12),
            vx: (this.x < 640 ? -1 : 1) * Utils.randFloat(40, 90),
            vy: Utils.randFloat(-15, 15), ay: 0,
            color: '#aaccee', size: 2, sizeEnd: 0,
            life: 0.4, alpha: 0.7, alphaEnd: 0,
          });
        }
      }
      return;
    }
    if (this.mode === 'closed') { this.open = false; return; }

    // Auto mode — opens for nearby crew
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

    if (this.isAirlock) {
      // Airlock — hull hatch. Red glow when venting.
      if (this.open) {
        ctx.fillStyle = 'rgba(255,60,60,0.3)';
        ctx.fillRect(this.x - w/2 - 3, this.y - h/2 - 3, w + 6, h + 6);
        ctx.fillStyle = '#ff4455';
        ctx.fillRect(this.x - w/2, this.y - h/2, w, 6);
        ctx.fillRect(this.x - w/2, this.y + h/2 - 6, w, 6);
        // (venting particles emitted in update, not draw)
      } else {
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(this.x - w/2, this.y - h/2, w, h);
        ctx.strokeStyle = '#ff7c20';
        ctx.lineWidth = 1;
        ctx.strokeRect(this.x - w/2, this.y - h/2, w, h);
      }
      return;
    }

    // Interior door
    const lockedOpen  = this.mode === 'open';
    const lockedShut  = this.mode === 'closed';
    ctx.fillStyle = this.open ? 'rgba(26,255,140,0.25)' : '#1a3a5a';
    if (this.open) {
      ctx.fillRect(this.x - w/2, this.y - h/2, w, 6);
      ctx.fillRect(this.x - w/2, this.y + h/2 - 6, w, 6);
      if (lockedOpen) {
        ctx.strokeStyle = '#1aff8c';
        ctx.lineWidth = 1;
        ctx.strokeRect(this.x - w/2 - 2, this.y - h/2 - 2, w + 4, h + 4);
      }
    } else {
      ctx.fillStyle = lockedShut ? '#5a2a2a' : '#1a3a5a';
      ctx.fillRect(this.x - w/2, this.y - h/2, w, h);
      ctx.strokeStyle = lockedShut ? '#ff5566' : '#4db8ff';
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

  /** Player starting frigate — 3 floors.
   *  Grid: 3 room columns (x 20 / 144 / 268, w 96) separated by two
   *  28px-wide elevator shafts (x 130 / 254). Shafts NEVER overlap rooms:
   *  column edges 116|144 and 240|268 are exactly the shaft walls. */
  frigate: {
    label: 'Kestrel Mk II',
    spriteKey: 'ship_player',
    hullMax: 30,
    floors: 3,
    rooms: [
      // Floor 0 (bottom)
      { id:'r_engines',  type:'engines',  x: 20,  y:220, w:96, h:80, floor:0, adjacent:['r_weapons'] },
      { id:'r_weapons',  type:'weapons',  x:144,  y:220, w:96, h:80, floor:0, adjacent:['r_engines','r_shields'] },
      { id:'r_shields',  type:'shields',  x:268,  y:220, w:96, h:80, floor:0, adjacent:['r_weapons'] },

      // Floor 1 (middle)
      { id:'r_piloting', type:'piloting', x: 20,  y:130, w:96, h:80, floor:1, adjacent:['r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   x:144,  y:130, w:96, h:80, floor:1, adjacent:['r_piloting','r_medbay'] },
      { id:'r_medbay',   type:'medbay',   x:268,  y:130, w:96, h:80, floor:1, adjacent:['r_oxygen'] },

      // Floor 2 (top — reactor amidships, crew quarters on the sides)
      { id:'r_crew1',    type:'empty',    x: 20,  y: 40, w:96, h:80, floor:2, adjacent:['r_reactor'] },
      { id:'r_reactor',  type:'reactor',  x:144,  y: 40, w:96, h:80, floor:2, adjacent:['r_crew1','r_crew3'] },
      { id:'r_crew3',    type:'empty',    x:268,  y: 40, w:96, h:80, floor:2, adjacent:['r_reactor'] },
    ],
    // Shaft stops sit on the crew walk line of each floor (y + h*0.65)
    elevators: [
      { id:'ev0', x: 130, floors:[272, 182, 92] },
      { id:'ev1', x: 254, floors:[272, 182, 92] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','medbay','reactor'],
    systemLevels: { shields: 4, weapons: 2, engines: 2 },   // shields lvl4 = 2 layers
    startWeapons: ['laser_basic'],
    reactorLevel: 3,   // MODULE level 1-4, each level = 4 power (3 → 12)
    weaponX: 360,   // world X where weapons are drawn on hull exterior
    weaponSlots: 2,
  },

  /** Enemy frigate — classic: cockpit up front, reactor topside aft */
  enemy_frigate: {
    label: 'Rebel Interceptor',
    spriteKey: 'ship_enemy',
    hullMax: 20,
    floors: 2,
    // Grid: engines | 28px shaft | weapons | shields (shared wall).
    // Upper floor aligned to the same columns — shaft never crosses a room.
    rooms: [
      { id:'r_engines',  type:'engines',  x: 20, y:170, w:80, h:72, floor:0, adjacent:['r_weapons'] },
      { id:'r_weapons',  type:'weapons',  x:128, y:170, w:80, h:72, floor:0, adjacent:['r_engines','r_shields'] },
      { id:'r_shields',  type:'shields',  x:208, y:170, w:80, h:72, floor:0, adjacent:['r_weapons'] },
      { id:'r_piloting', type:'piloting', x: 20, y: 90, w:80, h:72, floor:1, adjacent:['r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   x:128, y: 90, w:80, h:72, floor:1, adjacent:['r_piloting','r_reactor'] },
      { id:'r_reactor',  type:'reactor',  x:208, y: 90, w:80, h:72, floor:1, adjacent:['r_oxygen'] },
    ],
    elevators: [
      { id:'ev0', x: 114, floors:[217, 137] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','reactor'],
    systemLevels: { shields: 2, weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 2,   // MODULE level 1-4 (overridden per spawn)
    weaponX: 310,
    weaponSlots: 2,
  },

  /** Enemy gunship — weapons deck on top, reactor amidships below */
  enemy_gunship: {
    label: 'Rebel Gunship',
    spriteKey: 'ship_enemy',
    hullMax: 20,
    floors: 2,
    rooms: [
      { id:'r_piloting', type:'piloting', x: 20, y:170, w:80, h:72, floor:0, adjacent:['r_reactor'] },
      { id:'r_reactor',  type:'reactor',  x:128, y:170, w:80, h:72, floor:0, adjacent:['r_piloting','r_engines'] },
      { id:'r_engines',  type:'engines',  x:208, y:170, w:80, h:72, floor:0, adjacent:['r_reactor'] },
      { id:'r_weapons',  type:'weapons',  x: 20, y: 90, w:80, h:72, floor:1, adjacent:['r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   x:128, y: 90, w:80, h:72, floor:1, adjacent:['r_weapons','r_shields'] },
      { id:'r_shields',  type:'shields',  x:208, y: 90, w:80, h:72, floor:1, adjacent:['r_oxygen'] },
    ],
    elevators: [
      { id:'ev0', x: 114, floors:[217, 137] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','reactor'],
    systemLevels: { shields: 2, weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 2,
    weaponX: 310,
    weaponSlots: 2,
  },

  /** Enemy raider — reactor buried aft on the lower deck, shields forward */
  enemy_raider: {
    label: 'Rebel Raider',
    spriteKey: 'ship_enemy',
    hullMax: 20,
    floors: 2,
    rooms: [
      { id:'r_weapons',  type:'weapons',  x: 20, y:170, w:80, h:72, floor:0, adjacent:['r_reactor'] },
      { id:'r_reactor',  type:'reactor',  x:128, y:170, w:80, h:72, floor:0, adjacent:['r_weapons','r_engines'] },
      { id:'r_engines',  type:'engines',  x:208, y:170, w:80, h:72, floor:0, adjacent:['r_reactor'] },
      { id:'r_shields',  type:'shields',  x: 20, y: 90, w:80, h:72, floor:1, adjacent:['r_piloting'] },
      { id:'r_piloting', type:'piloting', x:128, y: 90, w:80, h:72, floor:1, adjacent:['r_shields','r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   x:208, y: 90, w:80, h:72, floor:1, adjacent:['r_piloting'] },
    ],
    elevators: [
      { id:'ev0', x: 114, floors:[217, 137] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','reactor'],
    systemLevels: { shields: 2, weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 2,
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
      // Reactor: one pip per power unit (module level 1-4 → 4-16 pips)
      const lvl = type === 'reactor'
        ? this.reactor.capacity
        : (this.layout.systemLevels ?? {})[type] ?? 1;
      const sys = new ShipSystem(type, lvl);
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

    // Link the reactor budget object to its room system —
    // from now on damage to the reactor ROOM = lost power.
    this.reactor.sys = this.getSystem('reactor');

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

    // Shafts are air columns: give each one an oxygen cell so open
    // shaft doors equalise O2 between the rooms on either side
    // (replaces the old direct doors that used to cross the shaft).
    this.elevators.shafts.forEach(s => this.oxygen.addRoom(`shaft_${s.id}`));

    // ── Doors between horizontally adjacent rooms ───────
    // If an elevator shaft sits in the gap between two rooms, they get
    // NO direct door — passage/airflow goes through the shaft's own
    // doors instead (a shaft and a room never share space).
    this.doors = [];
    const donePairs = new Set();
    this.rooms.forEach(room => {
      room.adjacent.forEach(adjId => {
        const other = this.getRoomById(adjId);
        if (!other || other.floor !== room.floor) return;
        const key = [room.id, other.id].sort().join('|');
        if (donePairs.has(key)) return;
        donePairs.add(key);
        if (this._shaftBetween(room, other)) return;   // shaft occupies the gap
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

    // Elevator shaft doors — each shaft gets a door on BOTH sides
    // at every floor it serves (shaft is its own vertical module)
    this.elevators.shafts.forEach(shaft => {
      shaft.floorYs.forEach(fy => {
        // Find rooms adjacent to shaft on this floor (left and right)
        const floorIdx = this.floorAtY(fy);
        const onFloor  = this.rooms.filter(r => r.floor === floorIdx);
        onFloor.forEach(room => {
          const touchesLeft  = Math.abs((room.x + room.w) - (shaft.x - shaft.width/2)) < 26;
          const touchesRight = Math.abs(room.x - (shaft.x + shaft.width/2)) < 26;
          if (touchesLeft) {
            this.doors.push(new Door(room.id, `shaft_${shaft.id}`,
              shaft.x - shaft.width/2, fy, false));
          }
          if (touchesRight) {
            this.doors.push(new Door(room.id, `shaft_${shaft.id}`,
              shaft.x + shaft.width/2, fy, false));
          }
        });
      });
    });

    // Airlocks — one on the outer wall of the leftmost and rightmost
    // room of each floor (FTL-style venting hatches)
    const floors = [...new Set(this.rooms.map(r => r.floor))];
    floors.forEach(f => {
      const onFloor = this.rooms.filter(r => r.floor === f);
      if (!onFloor.length) return;
      const leftmost  = onFloor.reduce((a, r) => r.x < a.x ? r : a);
      const rightmost = onFloor.reduce((a, r) => r.x + r.w > a.x + a.w ? r : a);
      this.doors.push(new Door(leftmost.id,  null, leftmost.x,               leftmost.y + leftmost.h * 0.5, true));
      if (rightmost.id !== leftmost.id) {
        this.doors.push(new Door(rightmost.id, null, rightmost.x + rightmost.w, rightmost.y + rightmost.h * 0.5, true));
      }
    });

    // ── In-flight projectiles ───────────────────────────
    this.projectiles = [];

    // ── Visual body = room bounding box ──────────────────
    const _b = this.roomBounds();
    this.spriteW = _b.w + 28;
    this.spriteH = _b.h + 28;

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

  /** Elevator shaft standing in the horizontal gap between two rooms, or null */
  _shaftBetween(a, b) {
    if (!this.elevators) return null;
    const left  = a.x < b.x ? a : b;
    const right = a.x < b.x ? b : a;
    return this.elevators.shafts.find(s =>
      s.x >= left.x + left.w && s.x <= right.x) || null;
  }

  /** Both shaft-side doors open at the given room pair's floor? */
  _shaftChannelOpen(shaft, roomA, roomB) {
    const sid  = `shaft_${shaft.id}`;
    const near = (d, room) =>
      d.roomB === sid && d.roomA === room.id &&
      d.y > room.y - 6 && d.y < room.y + room.h + 6;
    const dA = this.doors.find(d => near(d, roomA));
    const dB = this.doors.find(d => near(d, roomB));
    return !!(dA && dB && dA.open && dB.open);
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
        if (door) return door.open;
        // Rooms separated by an elevator shaft: fire crosses only
        // when BOTH shaft doors on this floor are open.
        const shaft = this._shaftBetween(room, r);
        if (shaft) return this._shaftChannelOpen(shaft, room, r);
        return true;  // genuinely touching, no door = open corridor
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
    const pilot = this.getSystem('piloting');
    const eng   = this.getSystem('engines');

    // FTL rule: no pilot in cockpit = no evasion at all
    const pilotRoom = pilot ? this.getRoomById(pilot.roomId) : null;
    const hasPilot  = pilotRoom
      ? this.crew.some(c => !c.dead && !c.dying && c.roomId === pilotRoom.id)
      : false;
    if (!hasPilot) return 0;

    const pilotPct = pilot ? pilot.effectivePower() * 0.03 : 0;   // 3%/level
    const engPct   = eng   ? eng.effectivePower()   * 0.02 : 0;   // 2%/level

    // Crew skill bonuses
    const skillPct = this.crew
      .filter(c => !c.dead && c.roomId === pilotRoom.id)
      .reduce((a, c) => a + c.pilotBonus(), 0);

    return Utils.clamp(pilotPct + engPct + skillPct, 0, 0.6);
  }

  get hullPct() { return this.hull / this.hullMax; }

  // ── Crew helpers ─────────────────────────────────────────

  addCrew(member) {
    // Place each crew member in a different room (cycle through rooms)
    const idx  = this.crew.length % this.rooms.length;
    const room = this.rooms[idx] || this.rooms[0];
    if (room) {
      member.x = room.cx + Utils.randFloat(-10, 10);
      member.y = this.floorWalkY(room.floor, room.cy);
      member.roomId = room.id;
    } else {
      member.x = this.worldX + 100;
      member.y = this.worldY + 100;
    }
    member.targetX = member.x;
    member.targetY = member.y;
    this.crew.push(member);
  }

  /**
   * Assign home stations by priority:
   * cockpit → engines → shields → weapons → oxygen → medbay.
   * Prefers crew whose corporation matches the module.
   */
  assignStations() {
    const priority = ['piloting', 'engines', 'shields', 'weapons', 'oxygen', 'medbay'];
    const prefer   = { piloting:'pegasus', engines:'terra', shields:'aquarius', weapons:'phoenix' };
    const unassigned = this.crew.filter(c => !c.dead);

    priority.forEach(type => {
      if (!unassigned.length) return;
      const sys = this.getSystem(type);
      if (!sys || !sys.roomId) return;
      // Prefer matching corporation, else first available
      let idx = unassigned.findIndex(c => c.race === prefer[type]);
      if (idx === -1) idx = 0;
      const c = unassigned.splice(idx, 1)[0];
      c.homeRoomId = sys.roomId;
      const room = this.getRoomById(sys.roomId);
      if (room) c.moveToOnShip(this, room.cx, room.cy);
    });
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
    // Weapons receive only EFFECTIVE power — damaged/ionised weapons
    // system means guns stop charging (FTL rule).
    let remaining = wSys.effectivePower();
    this.weapons.forEach(w => {
      if (!w) return;
      const give = Math.min(w.powerCost, remaining);
      w.power    = give;
      remaining -= give;
    });
  }

  // ── Power management ──────────────────────────────────────

  _allocateDefaultPower() {
    const order = ['shields','weapons','piloting','engines','oxygen','medbay','artillery'];
    let remaining = this.reactor.totalPower;

    order.forEach(type => {
      const sys = this.getSystem(type);
      if (!sys) return;
      const give = Math.min(sys.maxPower, remaining);
      sys.power        = give;
      sys.desiredPower = give;
      remaining       -= give;
    });
  }

  setPower(systemType, power) {
    const sys = this.getSystem(systemType);
    if (!sys) return;
    this.reactor.setPower(sys, power, this.systems);
    sys.desiredPower = sys.power;   // remember intent — restored after repair
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

    // Evasion dodge — pilot and engine crew gain XP (FTL)
    if (Math.random() < this.evasion) {
      Particles.floatText(proj.x, proj.y - 6, 'MISS', '#8fd4ff', 12);
      const pSys = this.getSystem('piloting');
      const eSys = this.getSystem('engines');
      if (pSys) this.crewInRoom(pSys.roomId).forEach(c => c.addXP('piloting', 10));
      if (eSys) this.crewInRoom(eSys.roomId).forEach(c => c.addXP('engines', 10));
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

    // Damage lands in the room the projectile actually reached.
    // (Previously a random room was picked — targeting was cosmetic
    //  and fires appeared in modules that were never hit.)
    const roomHit =
      this.rooms.find(r => r.contains(proj.x, proj.y)) ||
      this.rooms.find(r => r.contains(proj.targetX, proj.targetY)) ||
      Utils.pick(this.rooms);

    // Hull damage
    const dmg  = def.hull_damage ?? def.damage ?? 1;
    this.hull  = Math.max(0, this.hull - dmg);

    // Floating damage feedback
    if (roomHit.type === 'reactor' && roomHit.system) {
      Particles.floatText(roomHit.cx, roomHit.y + 10, `-${def.damage ?? 1} POWER`, '#ffb020', 12);
    } else {
      Particles.floatText(roomHit.cx, roomHit.y + 10, `-${dmg}`, '#ff5566', 13);
    }

    // System damage — hit breaks one module level per damage point (FTL style)
    if (roomHit.system) {
      roomHit.system.damageLevel(def.damage ?? 1);
    }

    // Crew in the hit room take damage
    this.crewInRoom(roomHit.id).forEach(c => {
      c.takeDamage(Utils.randInt(10, 25) * dmg, 'weapons fire');
    });

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
        const db = this.roomBounds();
        const rx = db.x + Utils.randFloat(0, db.w);
        const ry = db.y + Utils.randFloat(0, db.h);
        Particles.explosion(rx, ry, Utils.randFloat(0.5, 1.5));
      }
      if (this._deathTimer > 2.5) {
        this.destroyed = true;
      }
      return;
    }

    // Sync crew presence into each system (bonuses, cyborg power, medbay)
    this.systems.forEach(sys => {
      sys.crew = sys.roomId ? this.crewInRoom(sys.roomId) : [];
    });

    // Systems
    const crewBonus = this.weaponCrewBonus();
    this.systems.forEach(sys => sys.update(dt));

    // FTL power flow: each system draws up to its DESIRED power,
    // limited by working (undamaged) levels and reactor budget.
    // → repairing a module automatically re-lights its bars.
    {
      let remaining = this.reactor.totalPower;
      this.systems.forEach(sys => {
        const want = Math.min(sys.desiredPower, sys.workingLevels, remaining);
        sys.power  = want;
        remaining -= want;
      });
    }

    this._reallocWeaponPower();   // damaged weapons module instantly de-powers guns
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

    // Rooms with an open airlock are venting to space
    this.rooms.forEach(room => {
      room.isVacuum = this.doors.some(d =>
        d.isAirlock && d.open && d.roomA === room.id);
    });

    // Shield fade
    this._shieldAlpha = Math.max(0, this._shieldAlpha - dt * 2);

    // Shield pulse
    if (this._shieldPulse) {
      this._shieldPulse.update(dt);
      if (this._shieldPulse.done) this._shieldPulse = null;
    }
  }

  // ── Draw ─────────────────────────────────────────────────

  /** Bounding box of all rooms (the visual ship body) */
  roomBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.rooms.forEach(r => {
      minX = Math.min(minX, r.x);      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  draw(ctx) {
    // Hull silhouette behind rooms (dark plate with outline)
    const b = this.roomBounds();
    ctx.fillStyle = 'rgba(10,14,26,0.9)';
    ctx.beginPath();
    ctx.roundRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28, 18);
    ctx.fill();
    ctx.strokeStyle = this.isPlayer ? '#1e3a5c' : '#5c1e1e';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Engine glow at rear
    const engX = this.isPlayer ? b.x - 14 : b.x + b.w + 14;
    const g = ctx.createRadialGradient(engX, b.y + b.h/2, 2, engX, b.y + b.h/2, 30);
    g.addColorStop(0, this.isPlayer ? 'rgba(26,255,140,0.6)' : 'rgba(255,80,40,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(engX - 30, b.y + b.h/2 - 30, 60, 60);

    // Rooms (with systems, O2, fire, breach overlays)
    this.rooms.forEach(room => {
      if (room.system) {
        room.system.draw(ctx);
      } else {
        // Empty module — floor tile + visible frame (crew quarters,
        // or an enemy hull slot with no system installed)
        this._drawEmptyRoom(ctx, room);
      }

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
      const b = this.roomBounds();
      const alpha = (0.35 - this.hull / this.hullMax) * 0.5;
      ctx.fillStyle = `rgba(255,45,68,${alpha})`;
      ctx.fillRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28);
    }
  }

  /** Empty room: tiled floor, subtle grid line, clear frame */
  _drawEmptyRoom(ctx, room) {
    const { x, y, w, h } = room;
    const tile = Assets.has('room_default') ? Assets.get('room_default') : null;
    if (tile) {
      const tW = 48, tH = 48;
      ctx.save();
      ctx.globalAlpha = 0.8;
      for (let tx = 0; tx < w; tx += tW) {
        for (let ty = 0; ty < h; ty += tH) {
          ctx.drawImage(tile, 0, 0, tile.width, tile.height,
                        x + tx, y + ty,
                        Math.min(tW, w - tx), Math.min(tH, h - ty));
        }
      }
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(16,22,38,0.9)';
      ctx.fillRect(x, y, w, h);
    }

    // Frame — always visible so the module reads as a room
    ctx.strokeStyle = 'rgba(110,135,175,0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  _drawWeaponMounts(ctx) {
    const b = this.roomBounds();
    const baseX = this.isPlayer ? b.x + b.w + 16 : b.x - 56;
    const baseY = b.y + 20;
    this.weapons.forEach((w, i) => {
      if (!w) return;
      w.draw(ctx, baseX, baseY + i * 26, false);
    });
  }

  _drawShield(ctx) {
    if (this._shieldAlpha <= 0 && this.shieldBars <= 0) return;
    const b   = this.roomBounds();
    const cx  = b.x + b.w / 2;
    const cy  = b.y + b.h / 2;
    const rx  = b.w * 0.68 + 20;
    const ry  = b.h * 0.68 + 20;
    const alpha = Math.max(this._shieldAlpha, this.shieldBars > 0 ? 0.3 : 0);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Shield rings — layered strokes instead of shadowBlur (GPU-cheap)
    for (let ring = 0; ring < this.shieldBars; ring++) {
      // Soft outer glow: wide translucent stroke
      ctx.strokeStyle = 'rgba(26,140,255,0.18)';
      ctx.lineWidth   = 7;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + ring * 8, ry + ring * 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Crisp core line
      ctx.strokeStyle = '#4db8ff';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + ring * 8, ry + ring * 8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Hit flash ring
    if (this._shieldAlpha > 0.3) {
      ctx.strokeStyle = '#bfe8ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 4, ry + 4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
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
      if (!sys) return;
      if (sd.type === 'reactor') return;  // pips derive from module level
      sys.level = sd.level; sys.hp = sd.hp; sys.power = sd.power;
    });

    ship.weapons = [];
    data.weapons.forEach(wd => {
      if (wd) ship.installWeapon(wd.defKey, wd.slot);
    });

    return ship;
  }
}
