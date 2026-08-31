/* ============================================================
   MOON WARS — ship.js
   Ship class: layout, rooms, systems, hull, crew roster,
   weapons rack, elevator integration, damage resolution.
   Both player and enemy ships use this class.
   ============================================================ */

'use strict';

// ── Door ──────────────────────────────────────────────────

/** Seconds for a door panel to travel from shut to fully open. */
const DOOR_CYCLE = 1.0;

class Door {
  /**
   * Door between two adjacent rooms — or an AIRLOCK to space (roomB = null).
   * Doors are BINARY: 'open' or 'closed'. Green = open, red = closed.
   *        'closed' (player-locked shut).
   * Open airlocks vent the room's oxygen to space (FTL fire-fighting tactic).
   */
  constructor(roomA, roomB, x, y, isAirlock = false) {
    this.roomA  = roomA;
    this.roomB  = roomB;        // null = space
    this.x      = x;
    this.y      = y;
    this.isAirlock = isAirlock;
    // Doors are strictly BINARY: open or closed. Interior doors start
    // open (air flows), airlocks start closed. Click toggles.
    this.mode   = isAirlock ? 'closed' : 'open';
    // A door is no longer instant. `openness` runs 0..1 over DOOR_CYCLE
    // seconds and `open` means FULLY open — nobody squeezes through a
    // door that is still moving.
    this.openness = isAirlock ? 0 : 1;
    this.open   = !isAirlock;
    // Auto-passage: an INTERIOR door a crew member walks up to slides
    // open briefly even if the player locked it 'closed', then closes
    // again. Airlocks NEVER auto-open (they must be breached).
    this._tempT = 0;   // seconds left holding open for a passer-by
    this.breached = false;   // legacy: airlock smashed open (see hack())

    /* ── HACKING ──────────────────────────────────────────────
       A door belongs to the hull it is bolted into: it slides open for
       the crew who live there and stays shut to everyone else. An
       intruder has to work the lock, and the first door of a fight is
       the airlock they came through.

       Per SIDE, and per fight: once a boarding party has cracked a
       particular door it stays cracked for them until the battle ends
       (Ship.markCombatStart resets them), so they are not re-hacking
       the same corridor on the way back. */
    this.hacked = { player: false, enemy: false };
    this.hackT  = 0;
  }

  /** Seconds of work to crack one lock. */
  static get HACK_TIME() { return 2.5; }

  /**
   * An intruder from `side` works this lock. Returns true once the door
   * will actually let them through.
   */
  hackBy(side, dt = 0) {
    if (this.hacked[side]) {
      // Already theirs — from here on it behaves like their own door.
      this._tempT = Math.max(this._tempT, 0.6);
      return this.open;
    }
    this.hackT += dt;
    if (this.hackT >= Door.HACK_TIME) {
      this.hacked[side] = true;
      this.hackT = 0;
      this._tempT = Math.max(this._tempT, 1.2);
      Audio.sfx.doorMove?.();
    }
    return false;
  }

  /** Force a door open to a side without the work — the boarding party
   *  cutting the outer hatch has already spent its time doing that. */
  hackOpen(side, hold = 2.2) {
    this.hacked[side] = true;
    this.hackT = 0;
    this._tempT = Math.max(this._tempT, hold);
  }

  isHackedBy(side) { return !!this.hacked[side]; }
  get hackProgress() { return Utils.clamp(this.hackT / Door.HACK_TIME, 0, 1); }

  /** New battle: every lock is a stranger's lock again. */
  resetHacks() { this.hacked = { player: false, enemy: false }; this.hackT = 0; }

  /** Player click: open ↔ closed. The panel then takes a second to cycle. */
  toggle() {
    this.mode = this.mode === 'open' ? 'closed' : 'open';
    this._tempT = 0;
    Audio.sfx.uiClick();
    Audio.sfx.doorMove?.();
  }

  /** Where the panel should end up, 1 = open. */
  get _target() {
    if (this.breached) return 1;
    // A hacked airlock cycles like any other door instead of staying a
    // hole in the hull. The old boarding code smashed it permanently,
    // which vented that room for the rest of the run with no way to
    // ever seal it again.
    if (this.isAirlock) return (this._tempT > 0 || this.mode === 'open') ? 1 : 0;
    return (this._tempT > 0 || this.mode === 'open') ? 1 : 0;
  }

  /** A crew member is standing at this door wanting through.
   *  INTERIOR doors slide open (with a short delay so it reads as a
   *  door cycling). Returns true once it's actually open to pass. */
  requestPassage(dt) {
    if (this.isAirlock) return this.open;   // airlocks don't auto-open
    // Ask for it, then WAIT. The door needs its full second; returning
    // true early let crew walk through a half-open panel.
    this._tempT = Math.max(this._tempT, 0.6);
    return this.open;
  }

  update(dt, crew) {
    if (this._tempT > 0) this._tempT -= dt;

    // Slide toward the target at a fixed rate — one full second end to
    // end, whichever way it is going. A breached airlock is simply gone,
    // so it snaps.
    const target = this._target;
    if (this.breached) {
      this.openness = 1;
    } else if (this.openness !== target) {
      const step = dt / DOOR_CYCLE;
      this.openness = target > this.openness
        ? Math.min(target, this.openness + step)
        : Math.max(target, this.openness - step);
    }
    // FULLY open, not "on its way".
    this.open = this.openness >= 1;

    if (!this.isAirlock) return;

    // Venting particles for open airlocks (throttled)
    if (this.open) {
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
  }

  draw(ctx) {
    const w = 6, h = 34;

    // Somebody is working this lock — show how far they have got.
    if (this.hackT > 0) {
      const p = this.hackProgress;
      ctx.fillStyle = 'rgba(6,9,16,0.85)';
      ctx.fillRect(this.x - 9, this.y - h / 2 - 9, 18, 4);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(this.x - 9, this.y - h / 2 - 9, 18 * p, 4);
      ctx.strokeStyle = 'rgba(255,215,0,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(this.x - 9.5, this.y - h / 2 - 9.5, 19, 5);
    }

    if (this.isAirlock) {
      // Airlock — same one-second cycle as an interior door, so the
      // outer hatches read as machinery too, not as an instant toggle.
      const ao   = Utils.clamp(this.openness ?? (this.open ? 1 : 0), 0, 1);
      const half = h / 2;
      const leaf = half * (1 - ao);
      const moving = ao > 0 && ao < 1;

      if (ao > 0) {                       // vacuum showing through the gap
        ctx.fillStyle = `rgba(255,60,60,${(0.30 * ao).toFixed(2)})`;
        ctx.fillRect(this.x - w/2 - 3, this.y - half - 3, w + 6, h + 6);
      }
      if (leaf > 0.5) {                   // the hatch leaves themselves
        ctx.fillStyle = this.breached ? '#4a2020' : '#3a2a1a';
        ctx.fillRect(this.x - w/2, this.y - half, w, leaf);
        ctx.fillRect(this.x - w/2, this.y + half - leaf, w, leaf);
      }
      if (ao >= 1) {                      // fully open: hot edges
        ctx.fillStyle = '#ff4455';
        ctx.fillRect(this.x - w/2, this.y - half, w, 6);
        ctx.fillRect(this.x - w/2, this.y + half - 6, w, 6);
      }
      ctx.strokeStyle = this.breached ? '#ff2d44'
                      : moving ? '#ffb020' : (ao >= 1 ? '#ff4455' : '#ff7c20');
      ctx.lineWidth = 1;
      ctx.strokeRect(this.x - w/2, this.y - half, w, h);
      return;
    }

    // Interior door — TWO PANELS that actually slide apart, so a door
    // mid-cycle reads as mid-cycle. Green fully open, red shut, amber
    // while it is moving (and crew are waiting on it).
    const o    = Utils.clamp(this.openness ?? (this.open ? 1 : 0), 0, 1);
    const half = h / 2;
    const panel = half * (1 - o);          // how much each leaf still covers
    const moving = o > 0 && o < 1;
    const col  = o >= 1 ? '#1aff8c' : moving ? '#ffb020' : '#ff5566';

    if (panel > 0.5) {
      ctx.fillStyle = o >= 1 ? '#2a5a3a' : moving ? '#5a4a1a' : '#5a2a2a';
      ctx.fillRect(this.x - w / 2, this.y - half, w, panel);
      ctx.fillRect(this.x - w / 2, this.y + half - panel, w, panel);
    }
    // Frame: doubled and offset when fully open, exactly as before.
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    if (o >= 1) {
      ctx.fillStyle = 'rgba(26,255,140,0.25)';
      ctx.fillRect(this.x - w / 2, this.y - half, w, 6);
      ctx.fillRect(this.x - w / 2, this.y + half - 6, w, 6);
      ctx.strokeRect(this.x - w / 2 - 2, this.y - half - 2, w + 4, h + 4);
    } else {
      ctx.strokeRect(this.x - w / 2, this.y - half, w, h);
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

/* ============================================================
   THE HULL GRID (update41)

   Every hull in this game is now built from ONE module size. Before
   this there were three — 80x72, 96x80 and 96x60 — with three
   different deck pitches, because each layout hard-coded its own pixel
   coordinates and they drifted apart one hull at a time. That made a
   shared set of art impossible: a floor tile drawn for the scout was
   the wrong size on the frigate and the wrong shape on the station.

   Layouts are declared in GRID COORDINATES now — (col, row) — and the
   pixels are derived. Adding a hull is listing squares; changing the
   module size is changing one number here and every hull, every door,
   every lift stop and every crew station follows.

       MODULE_W x MODULE_H     one compartment
       DECK_PITCH              MODULE_H + DECK_GAP, floor to floor
       SHAFT_W                 a lift trunk sits in the gap BETWEEN two
                               columns, never inside a room
       ENGINE_W / PROW_W       exterior tiles, one per deck, hung off
                               the stern and the bow (see engineSlots
                               and prowSlots). Stations have neither.

   The art kit is cut to these numbers. Do not nudge them for one hull.
   ============================================================ */

const HULL_GRID = {
  MODULE_W: 80,
  MODULE_H: 72,
  DECK_GAP:  8,
  SHAFT_W:  28,
  MARGIN:   14,     // hull plate overhang past the outermost room
  ENGINE_W: 48,     // stern tile, one per deck
  PROW_W:   40,     // bow tile, one per deck
  WALK_FRAC: 0.65,  // crew feet, as a fraction of MODULE_H
};
HULL_GRID.DECK_PITCH = HULL_GRID.MODULE_H + HULL_GRID.DECK_GAP;   // 80

/** World X of a column, counting the shafts that sit before it. */
function gridColX(originX, col, shaftAfter) {
  const before = shaftAfter.filter(c => c < col).length;
  return originX + col * HULL_GRID.MODULE_W + before * HULL_GRID.SHAFT_W;
}

/** World Y of a deck. Row 0 is the BOTTOM deck, as `floor` always was. */
function gridRowY(originY, row, decks) {
  return originY + (decks - 1 - row) * HULL_GRID.DECK_PITCH;
}

/** World X of the CENTRE of the shaft that follows column `afterCol`. */
function gridShaftX(originX, afterCol, shaftAfter) {
  const before = shaftAfter.filter(c => c < afterCol).length;
  return originX + (afterCol + 1) * HULL_GRID.MODULE_W
       + before * HULL_GRID.SHAFT_W + HULL_GRID.SHAFT_W / 2;
}

/**
 * Expand a compact hull spec into the `rooms` / `elevators` shape the
 * rest of the engine already consumes, so nothing downstream had to
 * change when the grid arrived.
 *
 * Lift stops are DERIVED — every shaft stops on the crew walk line of
 * every deck it passes. They used to be hand-typed per hull, which is
 * how the boss station ended up with a cabin hanging out of the roof.
 */
function buildHull(spec) {
  const { originX, originY, decks, shaftAfter = [], grid = [] } = spec;
  const W = HULL_GRID.MODULE_W, H = HULL_GRID.MODULE_H;

  spec.floors = decks;
  spec.rooms = grid.map(r => ({
    id: r.id, type: r.type ?? 'empty',
    x: gridColX(originX, r.col, shaftAfter),
    y: gridRowY(originY, r.row, decks),
    w: W, h: H,
    floor: r.row,
    adjacent: r.adjacent ?? [],
  }));

  const stops = [];
  for (let row = decks - 1; row >= 0; row--) {
    stops.push(gridRowY(originY, row, decks) + H * HULL_GRID.WALK_FRAC);
  }
  spec.elevators = shaftAfter.map((afterCol, i) => ({
    id: 'ev' + i,
    x: gridShaftX(originX, afterCol, shaftAfter),
    floors: stops.slice(),
  }));
  return spec;
}

const SHIP_LAYOUTS = {

  /** FREE STARTER HULL — the same class of boat the ordinary raiders
   *  fly, refitted for you. Two decks, no medbay (field aid only),
   *  smaller reactor. The empty bay is the first real refit decision. */
  scout: buildHull({
    label: 'Bastet',
    spriteKey: 'ship_player',
    hullMax: 22,
    originX: 20, originY: 90, decks: 2, shaftAfter: [0],
    grid: [
      { id:'r_engines',  type:'engines',  col:0, row:0, adjacent:['r_weapons'] },
      { id:'r_weapons',  type:'weapons',  col:1, row:0, adjacent:['r_engines','r_hold'] },
      { id:'r_hold',     type:'empty',    col:2, row:0, adjacent:['r_weapons'] },
      { id:'r_piloting', type:'piloting', col:0, row:1, adjacent:['r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   col:1, row:1, adjacent:['r_piloting','r_reactor'] },
      { id:'r_reactor',  type:'reactor',  col:2, row:1, adjacent:['r_oxygen'] },
    ],
    startSystems: ['engines','weapons','piloting','oxygen','reactor'],
    systemLevels: { weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 6,
    reactorMax: 12,
    weaponSlots: 1,
    cargoCols: 5, cargoRows: 3,
  }),

  /** Bought hull — Bastet's bigger sister: the same two-deck design
   *  with EIGHT bays instead of six, three of them starting empty. */
  hauler: buildHull({
    label: 'Hapi',
    spriteKey: 'ship_player',
    hullMax: 26,
    originX: 20, originY: 90, decks: 2, shaftAfter: [0],
    grid: [
      { id:'r_engines',  type:'engines',  col:0, row:0, adjacent:['r_weapons'] },
      { id:'r_weapons',  type:'weapons',  col:1, row:0, adjacent:['r_engines','r_hold1'] },
      { id:'r_hold1',    type:'empty',    col:2, row:0, adjacent:['r_weapons','r_hold2'] },
      { id:'r_hold2',    type:'empty',    col:3, row:0, adjacent:['r_hold1'] },
      { id:'r_piloting', type:'piloting', col:0, row:1, adjacent:['r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   col:1, row:1, adjacent:['r_piloting','r_reactor'] },
      { id:'r_reactor',  type:'reactor',  col:2, row:1, adjacent:['r_oxygen','r_hold3'] },
      { id:'r_hold3',    type:'empty',    col:3, row:1, adjacent:['r_reactor'] },
    ],
    startSystems: ['engines','weapons','piloting','oxygen','reactor'],
    systemLevels: { weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 8,
    reactorMax: 14,
    weaponSlots: 1,
    cargoCols: 7, cargoRows: 5,
  }),

  /** Three decks and two lift trunks. The side bays on the top deck
   *  start EMPTY and become weapon modules at a station. */
  frigate: buildHull({
    label: 'Horus',
    spriteKey: 'ship_player',
    hullMax: 30,
    originX: 20, originY: 90, decks: 3, shaftAfter: [0, 1],
    grid: [
      { id:'r_engines',  type:'engines',  col:0, row:0, adjacent:['r_weapons'] },
      { id:'r_weapons',  type:'weapons',  col:1, row:0, adjacent:['r_engines','r_shields'] },
      { id:'r_shields',  type:'shields',  col:2, row:0, adjacent:['r_weapons'] },
      { id:'r_piloting', type:'piloting', col:0, row:1, adjacent:['r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   col:1, row:1, adjacent:['r_piloting','r_medbay'] },
      { id:'r_medbay',   type:'medbay',   col:2, row:1, adjacent:['r_oxygen'] },
      { id:'r_crew1',    type:'empty',    col:0, row:2, adjacent:['r_reactor'] },
      { id:'r_reactor',  type:'reactor',  col:1, row:2, adjacent:['r_crew1','r_crew3'] },
      { id:'r_crew3',    type:'empty',    col:2, row:2, adjacent:['r_reactor'] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','medbay','reactor'],
    systemLevels: { shields: 2, weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 8,
    reactorMax: 16,
    weaponSlots: 1,
    cargoCols: 6, cargoRows: 4,
  }),

  enemy_frigate: buildHull({
    label: 'Set',
    spriteKey: 'ship_enemy',
    hullMax: 20,
    originX: 20, originY: 90, decks: 2, shaftAfter: [0],
    grid: [
      { id:'r_engines',  type:'engines',  col:0, row:0, adjacent:['r_weapons'] },
      { id:'r_weapons',  type:'weapons',  col:1, row:0, adjacent:['r_engines','r_shields'] },
      { id:'r_shields',  type:'shields',  col:2, row:0, adjacent:['r_weapons'] },
      { id:'r_piloting', type:'piloting', col:0, row:1, adjacent:['r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   col:1, row:1, adjacent:['r_piloting','r_reactor'] },
      { id:'r_reactor',  type:'reactor',  col:2, row:1, adjacent:['r_oxygen'] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','reactor'],
    systemLevels: { shields: 2, weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 8,
    reactorMax: 12,
    weaponSlots: 1,
  }),

  /** TWO weapon bays — the hull elites favour. */
  enemy_gunship: buildHull({
    label: 'Sobek',
    spriteKey: 'ship_enemy',
    hullMax: 20,
    originX: 20, originY: 90, decks: 2, shaftAfter: [0],
    grid: [
      { id:'r_piloting', type:'piloting', col:0, row:0, adjacent:['r_reactor'] },
      { id:'r_reactor',  type:'reactor',  col:1, row:0, adjacent:['r_piloting','r_engines'] },
      { id:'r_engines',  type:'engines',  col:2, row:0, adjacent:['r_reactor'] },
      { id:'r_weapons',  type:'weapons',  col:0, row:1, adjacent:['r_weapons2'] },
      { id:'r_weapons2', type:'weapons',  col:1, row:1, adjacent:['r_weapons','r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   col:2, row:1, adjacent:['r_weapons2','r_shields'] },
      { id:'r_shields',  type:'shields',  col:3, row:1, adjacent:['r_oxygen'] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','reactor'],
    systemLevels: { shields: 2, weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 8,
    reactorMax: 14,
    weaponSlots: 2,
  }),

  enemy_raider: buildHull({
    label: 'Anubis',
    spriteKey: 'ship_enemy',
    hullMax: 20,
    originX: 20, originY: 90, decks: 2, shaftAfter: [0],
    grid: [
      { id:'r_weapons',  type:'weapons',  col:0, row:0, adjacent:['r_reactor'] },
      { id:'r_reactor',  type:'reactor',  col:1, row:0, adjacent:['r_weapons','r_engines'] },
      { id:'r_engines',  type:'engines',  col:2, row:0, adjacent:['r_reactor'] },
      { id:'r_shields',  type:'shields',  col:0, row:1, adjacent:['r_piloting'] },
      { id:'r_piloting', type:'piloting', col:1, row:1, adjacent:['r_shields','r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   col:2, row:1, adjacent:['r_piloting'] },
    ],
    startSystems: ['engines','weapons','shields','piloting','oxygen','reactor'],
    systemLevels: { shields: 2, weapons: 2, engines: 2 },
    startWeapons: ['laser_basic'],
    reactorLevel: 8,
    reactorMax: 12,
    weaponSlots: 1,
  }),

  /** APOPHIS — a STATION, not a ship: no engines hung off the stern,
   *  no bow. Five decks of two bays, ten compartments, one trunk up
   *  the middle. It used to be six decks of 96x60 compartments, which
   *  was the only reason a third module size existed at all. */
  boss_station: buildHull({
    label: 'Apophis',
    spriteKey: 'ship_enemy',
    hullMax: 40,
    isStation: true,
    originX: 40, originY: 20, decks: 5, shaftAfter: [0],
    grid: [
      { id:'r_engines',  type:'engines',  col:0, row:0, adjacent:['r_medbay'] },
      { id:'r_medbay',   type:'medbay',   col:1, row:0, adjacent:['r_engines'] },
      { id:'r_reactor',  type:'reactor',  col:0, row:1, adjacent:['r_oxygen'] },
      { id:'r_oxygen',   type:'oxygen',   col:1, row:1, adjacent:['r_reactor'] },
      { id:'r_weapons3', type:'weapons',  col:0, row:2, adjacent:['r_shields'] },
      { id:'r_shields',  type:'shields',  col:1, row:2, adjacent:['r_weapons3'] },
      { id:'r_weapons',  type:'weapons',  col:0, row:3, adjacent:['r_weapons2'] },
      { id:'r_weapons2', type:'weapons',  col:1, row:3, adjacent:['r_weapons'] },
      { id:'r_piloting', type:'piloting', col:0, row:4, adjacent:['r_top'] },
      { id:'r_top',      type:'empty',    col:1, row:4, adjacent:['r_piloting'] },
    ],
    startSystems: ['engines','medbay','reactor','oxygen','weapons','shields','piloting'],
    systemLevels: { shields: 4, engines: 3, piloting: 2, oxygen: 2, medbay: 2, weapons: 2 },
    startWeapons: [],
    reactorLevel: 8,
    reactorMax: 20,
    weaponSlots: 3,
  }),
};

class Ship {
  /**
   * How far ABOVE the floor's walk line the console operator stands.
   *
   * Enough to read as "at the console" and — the part that matters for
   * input — to keep him off the exact middle of the room, so the floor
   * underneath him stays free for module orders. Clicking a crewman
   * always selects that crewman (that is the gesture players reach for
   * most), so ordering crew INTO a manned module means clicking the
   * part of it nobody is standing on. Sitting him high leaves most of
   * the room to click.
   */
  static get OPERATOR_LIFT() { return 14; }

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

    // ── Build systems — ONE per system-type room ──────────
    // Multiple rooms of the same type (e.g. two 'weapons' modules)
    // each get their OWN independent system instance.
    this.systems = [];
    this.reactor  = new Reactor(this.layout.reactorLevel,
                                this.layout.reactorMax ?? 16);

    this.rooms.forEach(room => {
      if (room.type === 'empty' || !SYSTEM_DEFS[room.type]) return;
      const lvl = room.type === 'reactor'
        ? this.reactor.capacity
        : (this.layout.systemLevels ?? {})[room.type] ?? 1;
      const sys = new ShipSystem(room.type, lvl);
      this.systems.push(sys);

      // Link to room
      room.system = sys;
      sys.roomId  = room.id;
      sys.roomX   = room.x;
      sys.roomY   = room.y;
      sys.roomW   = room.w;
      sys.roomH   = room.h;
      sys.cx      = room.cx;
      sys.cy      = room.cy;
    });

    // Link the reactor budget object to its room system —
    // from now on damage to the reactor ROOM = lost power.
    this.reactor.sys = this.getSystem('reactor');

    // Default power allocation
    this._allocateDefaultPower();

    // ── Weapons rack — ONE gun per weapon module room ────
    this.weapons     = [];
    this.weaponCargo = [];   // uninstalled guns (defKeys), managed at stations

    // ── Cargo hold ──────────────────────────────────────
    // A grid, not a list: salvage has a shape, so hull choice and hold
    // upgrades finally mean something. Sized by the layout. (cargo.js
    // may be absent in a stripped-down test — degrade, do not explode.)
    this.cargo = (typeof CargoGrid !== 'undefined')
      ? new CargoGrid(this.layout.cargoCols ?? 5, this.layout.cargoRows ?? 4)
      : null;

    // Slots = number of weapon MODULE rooms (boss may override upward)
    this.weaponSlots = Math.max(this.weaponRooms.length,
                                this.layout.weaponSlots ?? 0);
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
        // Door at shared vertical edge, hung on the floor's door line
        const doorX = room.x < other.x ? room.x + room.w : other.x + other.w;
        const doorY = this.floorDoorY(room.floor, room.y + room.h * 0.5);
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
      // Hand the shaft the line its doors sit on, so the landing plates
      // and the cabin are drawn level with them instead of a dozen
      // pixels lower on the crew walk line. Presentation only.
      shaft.setDoorYs?.(shaft.floorYs.map(fy =>
        this.floorDoorY(this.floorAtY(fy), fy)));
      // …and how far the hull runs, so the trunk spans the ship exactly
      // rather than by a constant tuned for one deck height.
      shaft.setExtent?.(Math.min(...this.rooms.map(r => r.y)),
                        Math.max(...this.rooms.map(r => r.y + r.h)));
      shaft.floorYs.forEach(fy => {
        // Find rooms adjacent to shaft on this floor (left and right)
        const floorIdx = this.floorAtY(fy);
        const onFloor  = this.rooms.filter(r => r.floor === floorIdx);
        const shaftDoorY = this.floorDoorY(floorIdx, fy);
        onFloor.forEach(room => {
          const touchesLeft  = Math.abs((room.x + room.w) - (shaft.x - shaft.width/2)) < 26;
          const touchesRight = Math.abs(room.x - (shaft.x + shaft.width/2)) < 26;
          if (touchesLeft) {
            this.doors.push(new Door(room.id, `shaft_${shaft.id}`,
              shaft.x - shaft.width/2, shaftDoorY, false));
          }
          if (touchesRight) {
            this.doors.push(new Door(room.id, `shaft_${shaft.id}`,
              shaft.x + shaft.width/2, shaftDoorY, false));
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
      const airY = this.floorDoorY(f, leftmost.y + leftmost.h * 0.5);
      this.doors.push(new Door(leftmost.id,  null, leftmost.x,               airY, true));
      if (rightmost.id !== leftmost.id) {
        this.doors.push(new Door(rightmost.id, null, rightmost.x + rightmost.w, airY, true));
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

  /**
   * Every same-floor neighbour, each tagged with whether the way in is
   * actually OPEN. Fire uses this (update42).
   *
   * `getOpenAdjacentRooms` below is the strict version and had exactly
   * zero callers: fire.js spread through walls unconditionally, so
   * shutting a door did nothing at all and the doors were decoration in
   * a fire. Heat DOES cross a shut bulkhead — just far more slowly —
   * so fire needs the whole list plus the state of each way through,
   * not a pre-filtered one.
   */
  adjacentThermal(roomId) {
    const room = this.getRoomById(roomId);
    if (!room) return [];
    const openIds = new Set(this.getOpenAdjacentRooms(roomId).map(r => r.id));
    return (room.adjacent ?? [])
      .map(id => this.getRoomById(id))
      .filter(r => r && r.floor === room.floor)
      .map(r => ({ room: r, open: openIds.has(r.id) }));
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

  /** Canonical door centre-line for a floor.
   *  EVERY hatch on a floor — interior, elevator and airlock — hangs
   *  here. Each door used to take the centre of whichever room spawned
   *  it, so rooms of different heights pushed their doors to different
   *  levels and the outer airlocks sat visibly off from the interior
   *  doors on every hull in the game. */
  floorDoorY(floorIndex, fallbackY = 0) {
    const roomsOnFloor = this.rooms.filter(r => r.floor === floorIndex);
    if (!roomsOnFloor.length) return fallbackY;
    const top = Math.min(...roomsOnFloor.map(r => r.y));
    const bot = Math.max(...roomsOnFloor.map(r => r.y + r.h));
    return (top + bot) / 2;
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

    // FTL rule: no pilot in cockpit = no evasion at all. `alive` is the
    // one liveness test used throughout here — the old code mixed
    // `!dead && !dying` for the gate with a bare `!dead` for the bonus,
    // so a crewman bleeding out on the cockpit floor still flew the ship.
    const pilotRoom = pilot ? this.getRoomById(pilot.roomId) : null;
    // crewOperating: our own pilot, and only while nobody is fighting
    // him for the chair.
    const hasPilot = pilotRoom ? this.crewOperating(pilotRoom.id).length > 0 : false;
    if (!hasPilot) return 0;

    const pilotPct = pilot ? pilot.effectivePower() * 0.03 : 0;   // 3%/level
    const engPct   = eng   ? eng.effectivePower()   * 0.02 : 0;   // 2%/level
    const cloak    = this.getSystem('cloaking');
    // Cloak now gives a big evasion spike ONLY while actively cloaked.
    const cloakPct = (cloak && cloak.cloakActive) ? 0.60 : 0;

    // ── Crew skill bonuses ──
    // The pilots at the helm, AND the engine gang keeping the drive
    // responsive. Engine crew have always EARNED engines XP on every
    // dodge (see receiveHit) and CrewMember.engineBonus() has always
    // existed — but nothing ever called it, so levelling Engines paid
    // out exactly nothing in evasion. Terra crews even get double
    // engines XP, which made the dead end worse. The loop is closed now.
    // ONE pilot at the helm, ONE engineer at the drive console
    // (update43) — a crowded cockpit no longer stacks evasion.
    const helm     = this.consoleOperator(pilotRoom.id);
    const skillPct = helm ? helm.pilotBonus() : 0;
    const engRoom  = eng ? this.getRoomById(eng.roomId) : null;
    const engHand  = engRoom ? this.consoleOperator(engRoom.id) : null;
    const engSkill = engHand ? engHand.engineBonus() : 0;

    const cap = (cloak && cloak.cloakActive) ? 0.9 : 0.75;
    return Utils.clamp(pilotPct + engPct + cloakPct + skillPct + engSkill, 0, cap);
  }

  get hullPct() { return this.hull / this.hullMax; }

  // ── Crew helpers ─────────────────────────────────────────

  addCrew(member, keepPosition = false) {
    // Never add the same member twice (boarding recovery could
    // otherwise duplicate crew on the roster).
    if (this.crew.includes(member)) return;
    if (keepPosition) {
      // Caller already placed x/y/roomId precisely (e.g. a boarder
      // storming into the room they just breached) — don't scramble it.
      member.targetX = member.x;
      member.targetY = member.y;
      this.crew.push(member);
      return;
    }
    // Place each crew member in a different room (cycle through rooms)
    const idx  = this.crew.length % this.rooms.length;
    const room = this.rooms[idx] || this.rooms[0];
    if (room) {
      const [sx, sy] = this.stationSpot(room);
      member.x = sx;
      member.y = sy;
      member.roomId = room.id;
      // A recruit with no station never settles anywhere and reads as
      // "broken" to the player — give them the room they walked into.
      if (!member.homeRoomId) member.homeRoomId = room.id;
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
    // Weapons need a live OPERATOR per module now — stations cover
    // piloting first, then EVERY weapon room, then the rest.
    const prefer = { piloting:'pegasus', engines:'terra', shields:'aquarius', weapons:'phoenix' };
    // Animals do not stand watches. (isBeast = spider or rat.)
    const unassigned = this.crew.filter(c => !c.dead && !c.isBeast);
    const posts = [];
    const pilot = this.getSystem('piloting');
    if (pilot?.roomId) posts.push({ type:'piloting', roomId: pilot.roomId });
    this.weaponRooms.forEach(r => posts.push({ type:'weapons', roomId: r.id }));
    ['shields','engines','oxygen','medbay'].forEach(t => {
      const sys = this.getSystem(t);
      if (sys?.roomId) posts.push({ type: t, roomId: sys.roomId });
    });

    /* WHO GETS THE CONSOLE (update43).
       Since only the operator at slot 0 supplies the module's bonus,
       picking by CORPORATION alone would sit a Phoenix rookie at the
       gun while a mastered Aquarius gunner stood behind him doing
       nothing. Rank by the skill the post actually uses, and keep the
       corporation preference as the tiebreak it was always meant to
       be — a Terra crew still gravitates to the engine room. */
    const POST_SKILL = { piloting: 'piloting', engines: 'engines',
                         shields: 'shields',   weapons: 'weapons' };
    posts.forEach(post => {
      if (!unassigned.length) return;
      const skill = POST_SKILL[post.type];
      let idx = 0, bestScore = -1;
      unassigned.forEach((cand, i) => {
        const lvl   = skill ? cand.getSkillLevel(skill) : 0;
        const score = lvl * 10 + (cand.race === prefer[post.type] ? 1 : 0);
        if (score > bestScore) { bestScore = score; idx = i; }
      });
      const c = unassigned.splice(idx, 1)[0];
      const room = this.getRoomById(post.roomId);
      // Ask which SPOT is free, not how many heads are in there. The
      // head count once handed the first man into an empty module the
      // LEFT flank (because setting homeRoomId first counted him as an
      // occupant of his own room) and left the console unmanned.
      c.homeRoomId = post.roomId;
      if (room) c.moveToOnShip(this, ...this.stationSpot(room, null, c));
    });
  }

  /**
   * Where a crew member should STAND in a room.
   *
   *      empty room   →  the console, dead centre and a little high
   *      one already  →  the newcomer takes the LEFT of him
   *      two already  →  the third takes the RIGHT
   *
   * That order matters: walking into an empty module and standing off
   * to one side of the console looked like the man had missed his post,
   * which is why hitting RETURN (which sends everyone to room.cx/cy)
   * always "looked right" and ordinary orders did not.
   *
   * The old comment here warned that a crewman on the exact centre
   * swallowed every click aimed at the module. That was true when the
   * pick radius was 20px around a point 14px above his head; the
   * operator now stands OPERATOR_LIFT pixels above the walk line, up at
   * the console, which leaves the whole lower half of the room clear
   * for module clicks.
   */
  stationSpot(room, occupants = null, forCrew = null) {
    // No count given → work out which spot is actually free.
    if (occupants == null)
      return this.stationSlot(room, this.freeStationSlot(room, forCrew ? [forCrew] : []));
    return this.stationSlot(room, Math.min(occupants, 2));
  }

  /** The i-th standing spot in a room: 0 = console, 1 = left, 2 = right. */
  stationSlot(room, i = 0) {
    const slot = [0, -1, 1][Utils.clamp(i, 0, 2)];
    const x = Utils.clamp(room.cx + slot * 26, room.x + 14, room.x + room.w - 14);
    const y = this.floorWalkY(room.floor, room.cy)
            - (slot === 0 ? Ship.OPERATOR_LIFT : 0);
    return [x, y];
  }

  /** How close to a slot counts as standing on it. */
  static get SLOT_GRIP() { return 13; }

  /**
   * Which of the three standing spots in `room` is a crewman on (or
   * heading for)? -1 if he is somewhere else in the room entirely.
   */
  slotIndexAt(x, y, room, tol = Ship.SLOT_GRIP) {
    let best = -1, bd = tol;
    for (let i = 0; i < 3; i++) {
      const [sx, sy] = this.stationSlot(room, i);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /**
   * The set of spots in `room` that are spoken for.
   *
   * "Spoken for" means somebody is standing on it OR walking to it —
   * see CrewMember.destPoint. Counting heads instead of spots is what
   * used to stack crew: the count said "one man in here, you take slot
   * 1", but that man might himself be standing on slot 1 because the
   * room was busier when HE was sent.
   *
   * @param {Room} room
   * @param {CrewMember[]} exclude  people whose claim does not count
   * @param {boolean} residentsOnly  count only crew POSTED to this room —
   *        used to decide whether a stack is real. Somebody merely
   *        crossing the room stands in the way (so you do not walk into
   *        him) but he never owns the console and never evicts anyone.
   */
  takenStationSlots(room, exclude = [], residentsOnly = false) {
    const taken = new Set();
    if (!room) return taken;
    this.crew.forEach(c => {
      if (!c.alive || c.isBeast || exclude.includes(c)) return;
      if (residentsOnly && c.homeRoomId !== room.id) return;
      // Only people who belong in, or are inside, this room can hold a
      // spot in it — somebody in another room is irrelevant.
      if (c.roomId !== room.id && c.homeRoomId !== room.id) return;
      const p = c.destPoint ? c.destPoint() : { x: c.x, y: c.y };
      const i = this.slotIndexAt(p.x, p.y, room);
      if (i !== -1) taken.add(i);
    });
    return taken;
  }

  /**
   * The best FREE spot in `room`: the console first, then the left
   * flank, then the right. Falls back to the right flank when all
   * three are held (the room is full and the caller should have
   * stopped earlier).
   */
  freeStationSlot(room, exclude = []) {
    const taken = this.takenStationSlots(room, exclude);
    for (let i = 0; i < 3; i++) if (!taken.has(i)) return i;
    return 2;
  }

  /**
   * Hand out one free spot per crew member, in order.
   *
   * This is the ONLY correct way to place several people into the same
   * module at once: each pick has to see the picks made before it, or
   * the whole group lands on the console together.
   *
   * @returns {number[]} slot index per member of `movers`
   */
  allocStationSlots(room, movers = []) {
    const taken = this.takenStationSlots(room, movers);
    return movers.map(() => {
      let i = 0;
      while (i < 2 && taken.has(i)) i++;
      taken.add(i);
      return i;
    });
  }

  /**
   * OUR crew, able, in this room.
   *
   * The `isPlayer === this.isPlayer` filter is the important half and it
   * was missing entirely. `this.crew` holds everyone physically aboard —
   * including enemy boarders, who are added to the DEFENDING ship's
   * roster when they come through the airlock. Without the filter an
   * intruder standing in your weapons bay MANNED YOUR GUN, one in the
   * shield room sped up YOUR recharge and earned YOUR shields XP, one in
   * the medbay was healed by YOUR doctors, and one in the cockpit added
   * his piloting skill to YOUR evasion.
   */
  crewInRoom(roomId) {
    // Only fully-able crew count for manning/repairs — the downed
    // and the dead lie on the floor (see bodiesInRoom).
    return this.crew.filter(c =>
      c.roomId === roomId && c.alive && c.inRoom !== false &&
      c.isPlayer === this.isPlayer);
  }

  /**
   * A battle is beginning aboard this hull.
   *
   * Done HERE rather than in markCombatStart because CombatManager.begin
   * is the one place every fight passes through exactly once, for both
   * ships — game.js calls markCombatStart from three different places
   * and would have counted some battles twice.
   */
  onBattleStart() {
    // Every lock is a stranger's lock again: boarders work for the ship
    // a second time rather than strolling through last fight's holes.
    this.doors.forEach(d => d.resetHacks?.());
    // And everyone still standing has one more action on their record.
    this.crew.forEach(c => { if (c.alive) c.battles = (c.battles ?? 0) + 1; });
  }

  /** EVERYONE physically in the room, whoever's side they are on.
   *  Weapons fire, stun and fire burns do not care whose uniform you
   *  are wearing — only manning does. */
  occupantsOf(roomId) {
    return this.crew.filter(c => c.roomId === roomId && c.alive && c.inRoom !== false);
  }

  /** Hostiles from both sides sharing a room: nobody is working. */
  roomContested(roomId) {
    const here = this.occupantsOf(roomId);
    return here.some(c => c.isPlayer) && here.some(c => !c.isPlayer);
  }

  /**
   * Who is actually OPERATING the module in this room.
   *
   * A module with a fight going on in it is not being run: the crew are
   * swinging at each other, not flying the ship. A contested cockpit
   * gives no evasion, a contested weapons bay stops charging, contested
   * shields stop recharging — which is what makes boarding a way to shut
   * a ship down rather than only a way to chip at its hull.
   */
  crewOperating(roomId) {
    return this.roomContested(roomId) ? [] : this.crewInRoom(roomId);
  }

  /**
   * WHO IS ACTUALLY AT THE CONSOLE (update43).
   *
   * Every skill bonus a module grants — gunnery, shields, piloting,
   * engines — used to be the SUM over everyone standing in the room.
   * Three mastered gunners came to 0.9 and were stopped only by the
   * 0.75 clamp, which exists to keep `dt / 0` from killing the frame.
   * So the strongest move in the game was to shove three people into
   * one compartment: nobody designed that, and the player could not
   * see it. A module has ONE console (slot 0, the raised spot), and
   * the man sitting at it is the one working it.
   *
   * The other two in the room are not useless — they fight boarders,
   * put out fires and repair the module — they just do not make the
   * gun charge faster.
   *
   * Returns null for an empty or CONTESTED room, exactly like
   * crewOperating(), so an invaded compartment stops paying out.
   */
  consoleOperator(roomId) {
    const room = this.getRoomById(roomId);
    if (!room) return null;
    const manned = this.crewOperating(roomId);
    if (!manned.length) return null;
    return manned.find(c => this.slotIndexAt(c.x, c.y, room) === 0) || null;
  }

  /* SIDE MATTERS FOR BODIES TOO (update42). This used to return every
     downed body in the room regardless of whose it was, which is how
     your crew ended up stretchering enemy boarders to your medbay and
     your medbay healed them back onto their feet — mid-boarding. Pass
     `false` only where you genuinely mean "everyone lying here". */
  bodiesInRoom(roomId, ownSideOnly = true) {
    return this.crew.filter(c =>
      c.roomId === roomId && c.down && c.inRoom !== false &&
      (!ownSideOnly || c.isPlayer === this.isPlayer));
  }

  /** Called by Game whenever a new battle begins: unburied corpses
   *  start to ROT — and rotting corpses spread the plague. */
  markCombatStart() {
    this.crew.forEach(c => {
      if (!c.dead) return;
      c._deadCombats = (c._deadCombats ?? 0) + 1;
      if (c._deadCombats >= 1 && !c.decaying) {
        this._startDecay(c);
      }
    });
  }

  _startDecay(c) {
    if (c.decaying) return;
    c.decaying = true;
    if (this.isPlayer && typeof UI !== 'undefined') {
      UI.notify(`${c.name}'s body is DECAYING — open an airlock and get it OUT!`, 'alert');
    }
  }

  /** Is there anywhere to actually put a corpse right now?
   *  You cannot throw a body through a shut hatch (update42). */
  hasOpenAirlock() {
    return this.doors.some(d => d.isAirlock && d.mode === 'open');
  }

  /** Carry the wounded to the medbay, carry the dead to an airlock,
   *  rot unburied corpses onto the crew, remove the ejected. */
  _updateBodies(dt) {
    // Remove anyone who went out the airlock (self-ejected plague
    // victims and committed corpses alike) — the roster entry goes.
    const ejected = this.crew.filter(c => c.ejected);
    ejected.forEach(c => {
      if (c.carriedBy) c.carriedBy.carrying = null;
      if (this.isPlayer && typeof UI !== 'undefined') {
        UI.notify(c.dead ? `${c.name}'s body committed to space.` :
                           `${c.name} walked out of the airlock…`, c.dead ? 'info' : 'alert');
      }
      Particles.emit?.({ x: c.x, y: c.y, vx: this.isPlayer ? -60 : 60, vy: -10,
        ay: 0, color: '#aaccee', size: 3, sizeEnd: 0, life: 1, alpha: 0.8, alphaEnd: 0 });
    });
    if (ejected.length) this.crew = this.crew.filter(c => !c.ejected);

    const medbay = this.getSystem('medbay');
    const medRoom = medbay ? this.getRoomById(medbay.roomId) : null;

    const medPowered = medbay && medRoom && medbay.effectivePower() > 0;

    const medUsable = !!medRoom && !!medPowered;

    /* ── ROT IS A CLOCK NOW (update42) ────────────────────────
       Decay used to be a COMBAT COUNTER: a corpse only began to rot at
       the start of the NEXT fight. Combined with the pickup rule below
       — which hauled a corpse to the airlock the instant anybody walked
       into the room — that meant a body was always gone long before it
       could rot, and the entire plague subsystem never fired once in a
       real game. A corpse left aboard now starts to stink on its own. */
    this.crew.forEach(c => {
      if (!c.dead || c.decaying || c.ejected) return;
      c._rotT = (c._rotT ?? 0) + dt;
      if (c._rotT >= Ship.DECAY_SECONDS) this._startDecay(c);
    });

    /* ── BLEEDING OUT (update42) ─────────────────────────────
       A downed crew member used to lie there indefinitely. That was a
       soft-lock: the last enemy standing goes DOWN instead of dying,
       nobody on his ship is left to treat him, and the fight can never
       end. Being down is now a countdown — save them, or lose them. */
    this.crew.forEach(c => {
      if (c.dead || !c.down) { if (c._bleedT) c._bleedT = 0; return; }
      c._bleedT = (c._bleedT ?? 0) + dt;
      if (c._bleedT >= Ship.BLEEDOUT_SECONDS) {
        c._bleedT = 0;
        c.killOutright?.();
        if (this.isPlayer && typeof UI !== 'undefined') {
          UI.notify(`${c.name} bled out.`, 'alert');
        }
      }
    });

    const airOpen = this.hasOpenAirlock();

    // ── RESCUE DISPATCH ──────────────────────────────────────
    // Pickup below only ever triggers for a body in the SAME room, so a
    // crew member who went down somewhere else just bled out while the
    // rest of the ship carried on (the enemy pilot ignoring his downed
    // gunner). Send the nearest able hand to them — to carry them to a
    // medbay if the ship has one, or to patch them up on the spot if it
    // doesn't (most enemy hulls carry no medbay at all).
    {
      // Drop stale claims first (target rescued, dead or already lifted)
      this.crew.forEach(c => {
        if (!c._rescueId) return;
        const t = this.crew.find(b => b.id === c._rescueId);
        // A claim on a DECAYING corpse is a body-collection order and is
        // valid precisely because the target is dead (update42).
        const corpseRun = !!t && t.dead && t.decaying && airOpen;
        if (!t || (!corpseRun && (t.dead || !t.down)) || t.carriedBy || !c.alive) {
          c._rescueId = null;
        }
      });

      /* AND SOMEONE GOES TO FETCH A ROTTING BODY (update42).
         Corpse collection was purely opportunistic — a body was only
         ever lifted by somebody who happened to already be standing in
         its room — so a corpse in a compartment nobody visits rotted
         forever and the only cure was to walk a crew member there by
         hand. Opening an airlock is now an ORDER: it sends a hand to
         carry the thing out. */
      this.crew.forEach(body => {
        if (body.dead && body.decaying && airOpen && !body.carriedBy &&
            !this.crew.some(c => c._rescueId === body.id) &&
            this.crewInRoom(body.roomId).length === 0) {
          const hand = this.crew
            .filter(c => c.alive && !c.carrying && !c._rescueId && !c.isBeast &&
                         c.isPlayer === this.isPlayer &&
                         c.task !== TASK.REPAIR && c.task !== TASK.BREACH &&
                         c.task !== TASK.FIRE && c.task !== TASK.FIGHT)
            .sort((a, b) => Utils.dist(a.x, a.y, body.x, body.y) -
                            Utils.dist(b.x, b.y, body.x, body.y))[0];
          if (hand) {
            hand._rescueId  = body.id;
            hand.homeRoomId = body.roomId;
            hand.moveToOnShip(this, body.x, body.y);
          }
          return;
        }
        if (body.dead || !body.down || body.carriedBy) return;
        // Nobody runs across the ship to rescue an enemy boarder (update42).
        if (body.isPlayer !== this.isPlayer || body.isBeast) return;
        if (body.roomId === medRoom?.id && medPowered) return;  // already being treated
        if (this.crewInRoom(body.roomId).length > 0) return;    // someone's there already
        if (this.crew.some(c => c._rescueId === body.id)) return;

        const helper = this.crew
          .filter(c => c.alive && !c.carrying && !c._rescueId &&
                       c.isPlayer === this.isPlayer && !c.isBeast &&
                       c.task !== TASK.REPAIR && c.task !== TASK.BREACH &&
                       c.task !== TASK.FIRE && c.task !== TASK.FIGHT)
          .sort((a, b) => Utils.dist(a.x, a.y, body.x, body.y) -
                          Utils.dist(b.x, b.y, body.x, body.y))[0];
        if (!helper) return;
        helper._rescueId  = body.id;
        helper.homeRoomId = body.roomId;   // walk there; pickup/field aid takes over
        helper.moveToOnShip(this, body.x, body.y);
      });
    }

    this.crew.forEach(c => {
      if (!c.alive) return;
      // Spiders are not a repair crew. They do not fix the wreck they
      // live in, do not haul bodies and do not man stations — they sit
      // in their rooms and kill whatever comes through the door.
      if (c.isBeast) return;
      // An EXPLICIT emergency job outranks opportunistic body-hauling.
      // Without this, a crew member sent to seal a breach or fix a
      // module would scoop up a wounded body on arrival and walk off to
      // the medbay, so the damage never got repaired at all.
      const onEmergency = c.task === TASK.REPAIR || c.task === TASK.BREACH ||
                          c.task === TASK.FIRE;
      // Same reasoning for the room they're standing in: while it is
      // burning, holed or shot out, that work comes first — otherwise
      // they seal the breach and immediately wander off with a body,
      // leaving the module broken.
      const hereRoom = this.getRoomById(c.roomId);
      const roomBusy = !!hereRoom && (
        this.fires.getFiresInRoom(hereRoom.id).length > 0 ||
        this.breaches.hasBreachInRoom(hereRoom.id) ||
        (hereRoom.system && hereRoom.system.damagedLevels > 0));
      // Pick up a body sharing the room (wounded first) — but NOT a
      // wounded crew member already lying in a working medbay (that
      // caused the endless carry-back-and-forth jitter), and only if
      // there's actually somewhere useful to take them.
      if (!c.carrying && !onEmergency && !roomBusy) {
        const body = this.bodiesInRoom(c.roomId)
          .filter(b => !b.carriedBy)
          .filter(b => {
            /* NOBODY LIFTS A CORPSE WITH NOWHERE TO PUT IT (update42).
               This used to be an unconditional `return true`, so a body
               was scooped up and shoved through a SHUT airlock — the
               hatch never even opened. Now the player has to open one,
               which is also what finally lets a corpse sit long enough
               to rot. */
            if (b.dead) return airOpen;
            // wounded: skip if already in a powered medbay (healing)
            if (medRoom && b.roomId === medRoom.id && medPowered) return false;
            // wounded: pointless to carry if there's no medbay at all
            return !!medRoom;
          })
          .sort((a, b) => (a.dead ? 1 : 0) - (b.dead ? 1 : 0))[0];
        if (body) { body.carriedBy = c; c.carrying = body; c._rescueId = null; }
      }
      const body = c.carrying;
      if (!body) return;
      // The body rides on the carrier's shoulders
      body.x = c.x; body.y = c.y - 10; body.roomId = c.roomId;

      if (!body.dead) {
        // WOUNDED → medbay
        if (medRoom) {
          if (c.roomId === medRoom.id ||
              Utils.dist(c.x, c.y, medRoom.cx, medRoom.cy) < 30) {
            // Arrived: lay them down and STOP (carrier stays put so it
            // doesn't wander off and re-trigger a pickup next frame).
            body.carriedBy = null; c.carrying = null;
            body.x = medRoom.cx + Utils.randFloat(-16, 16);
            body.y = medRoom.cy + 10;
            body.roomId = medRoom.id;
            c._waypoints = [];
            c.homeRoomId = medRoom.id;
          } else if (!c._waypoints.length) {
            c.moveToOnShip(this, medRoom.cx, medRoom.cy);
          }
        }
      } else {
        /* DEAD → nearest OPEN airlock, then out it goes.
           This used to sort over EVERY airlock and eject through it
           whatever its state, so bodies passed straight through a
           closed hatch (update42). If the player shuts every airlock
           mid-haul the carrier puts the body down and gets back to
           work rather than standing there holding it forever. */
        const air = this.doors.filter(d => d.isAirlock && d.mode === 'open')
          .sort((a, b) => Utils.dist(c.x, c.y, a.x, a.y) -
                          Utils.dist(c.x, c.y, b.x, b.y))[0];
        if (air) {
          c._ejectWaitT = 0;
          if (Utils.dist(c.x, c.y, air.x, air.y) < 26) {
            body.ejected = true;
            body.carriedBy = null; c.carrying = null;
          } else if (!c._waypoints.length) {
            c.moveToOnShip(this, air.x, air.y);
          }
        } else {
          // The player shut every hatch mid-haul. Wait a while with the
          // body — they may be venting a fire — then put it down and go
          // back to work rather than standing there holding it forever.
          c._ejectWaitT = (c._ejectWaitT ?? 0) + dt;
          if (c._ejectWaitT >= Ship.CORPSE_HOLD_SECONDS) {
            c._ejectWaitT = 0;
            body.carriedBy = null; c.carrying = null; c._waypoints = [];
          }
        }
      }
    });

    // Medbay treats the wounded lying on its floor
    if (medbay && medRoom && medbay.effectivePower() > 0) {
      this.bodiesInRoom(medRoom.id).forEach(b => {
        if (b.dead) return;
        b.hp = Math.min(b.maxHp, b.hp + 6 * dt * medbay.effectivePower());
        if (b.hp >= b.maxHp * 0.3) {
          b.state = 'ok';
          b._bleedT = 0;
          if (this.isPlayer && typeof UI !== 'undefined') {
            UI.notify(`${b.name} is back on their feet!`, 'good');
          }
        }
      });
    }

    /* FIELD AID — ALWAYS, NOT ONLY AS A LAST RESORT (update42).
       This was gated on `!medUsable`, i.e. the whole mechanic switched
       OFF ship-wide the moment a working medbay existed anywhere. A man
       down two decks away got no treatment at all until somebody
       physically carried him in, and most hulls have no medbay to carry
       him to. A crewmate kneeling beside him now patches him up WHERE
       HE LIES on any ship; the medbay is simply ~3x faster and is still
       where stretcher-bearers take people. */
    this.crew.forEach(body => {
      if (body.dead || !body.down || body.carriedBy) return;
      // Already lying in a powered medbay — that loop above has them.
      if (medUsable && body.roomId === medRoom.id) return;
      const medic = this.crewInRoom(body.roomId).find(c => !c.carrying && !c.isBeast);
      if (!medic) return;
      body.hp = Math.min(body.maxHp, body.hp + Ship.FIELD_AID_HPS * dt);
      if (Math.random() < dt * 0.7) Particles.repairSparks?.(body.x, body.y - 6);
      if (body.hp >= body.maxHp * 0.3) {
        body.state = 'ok';
        body._bleedT = 0;
        medic.addXP?.('repair', 5);
        if (this.isPlayer && typeof UI !== 'undefined') {
          UI.notify(`${medic.name} patched ${body.name} up in the field.`, 'good');
        }
      }
    });

    /* ── THE PLAGUE TRAVELS THROUGH THE VENTS (update42) ──────
       Infection used to reach only `crewInRoom(body.roomId)` — stand
       one door away and you were untouchable, which made the plague a
       non-event. A ship shares one air loop, so a rotting body taints
       the whole hull: fast in the room it lies in, slowly everywhere
       else, and the ship-wide half only while life support is actually
       circulating air. Cutting oxygen contains the outbreak — at the
       obvious price. */
    const vents = (this.getSystem('oxygen')?.effectivePower() ?? 0) > 0;
    const rotting = this.crew.filter(b => b.dead && b.decaying);
    if (rotting.length) {
      const rotRooms = new Set(rotting.map(b => b.roomId));
      const n = rotting.length;
      this.crew.forEach(c => {
        if (c.infected || !c.alive || c.isBeast) return;
        if (c.isPlayer !== this.isPlayer) return;
        const near = rotRooms.has(c.roomId);
        const rate = near ? Ship.PLAGUE_RATE_ROOM
                   : vents ? Ship.PLAGUE_RATE_VENT
                   : 0;
        if (rate <= 0) return;
        if (Math.random() < dt * rate * n) {
          c.infected = true;
          if (this.isPlayer && typeof UI !== 'undefined') {
            UI.notify(near ? `${c.name} caught the corpse plague! ☣`
                           : `${c.name} caught the plague through the VENTS! ☣`, 'alert');
          }
        }
      });
    }
  }

  /** Instantly charge shields to full (used at combat start) */
  prechargeShields() {
    const ss = this.getSystem('shields');
    if (!ss) return;
    const layers = Math.floor(ss.effectivePower() / (ss.def.powerPerLayer ?? 2));
    ss._shieldMax  = layers;
    ss._shieldBars = layers;
    ss._shieldTimer = 0;
    // A bubble knocked down LAST fight is not a lesson owed in this
    // one — the debt starts every battle at zero (update44).
    ss._shieldDebt = 0;
  }

  /** World Y of a deck's top edge. */
  _deckY(row) {
    const r = this.rooms.find(o => o.floor === row);
    return r ? r.y : this.roomBounds().y;
  }

  /**
   * THE EXTERIOR TILE SLOTS (update41).
   *
   * The hull is assembled like LEGO, one row per deck:
   *
   *     [engine][module][module][shaft][module][module][prow]
   *
   * The modules and the shaft are the interior, and the engine and the
   * prow are exterior tiles hung off either end — one per deck, every
   * deck the same. These two methods say exactly where they go, so the
   * art can be dropped in without anybody re-deriving the geometry.
   *
   * A STATION has neither: Apophis does not go anywhere.
   */
  engineSlots() {
    if (this.layout.isStation) return [];
    const G = HULL_GRID, b = this.roomBounds();
    // The stern faces AWAY from the enemy: left for you, right for them.
    const x = this.isPlayer ? b.x - G.ENGINE_W : b.x + b.w;
    const out = [];
    for (let row = this.layout.floors - 1; row >= 0; row--) {
      out.push({ x, y: this._deckY(row), w: G.ENGINE_W, h: G.MODULE_H,
                 deck: row, flip: !this.isPlayer });
    }
    return out;
  }

  /**
   * The bow, one tile per deck. Unlike the engine these are NOT all the
   * same tile: a nose is a taper, so the slice you need depends on how
   * tall the hull is and where in it you are —
   *
   *     1 deck   solo
   *     2 decks  top, bot
   *     3 decks  top, mid, bot
   *
   * `slice` names the tile to draw; `decks` names the set it comes from.
   */
  prowSlots() {
    if (this.layout.isStation) return [];
    const G = HULL_GRID, b = this.roomBounds();
    const decks = this.layout.floors;
    const x = this.isPlayer ? b.x + b.w : b.x - G.PROW_W;
    const out = [];
    for (let row = decks - 1; row >= 0; row--) {
      const slice = decks === 1 ? 'solo'
                  : row === decks - 1 ? 'top'
                  : row === 0 ? 'bot' : 'mid';
      out.push({ x, y: this._deckY(row), w: G.PROW_W, h: G.MODULE_H,
                 deck: row, decks, slice, flip: !this.isPlayer });
    }
    return out;
  }

  /** Weapon module rooms in slot order (slot i ↔ i-th weapons room) */
  get weaponRooms() {
    return this.rooms.filter(r => r.type === 'weapons');
  }

  /** The weapon system powering slot i (its own module room) */
  weaponSystemFor(slot) {
    return this.weaponRooms[slot]?.system ?? null;
  }

  /** Charge bonus for a SPECIFIC weapon: the gunner AT ITS CONSOLE.
   *  Used to sum over everyone in the bay — see consoleOperator(). */
  weaponCrewBonusFor(slot) {
    const room = this.weaponRooms[slot];
    if (!room) return 0;
    const gunner = this.consoleOperator(room.id);
    return gunner ? gunner.weaponChargeBonus() : 0;
  }

  weaponCrewBonus() {   // legacy aggregate (kept for compatibility)
    return this.weapons.reduce((a, w, i) =>
      Math.max(a, w ? this.weaponCrewBonusFor(i) : 0), 0);
  }

  // ── Weapons ──────────────────────────────────────────────

  /** ONE gun per weapon module. Fails if the slot is occupied or
   *  there is no module room for it (boss ships may override slots). */
  installWeapon(defKey, slot) {
    if (slot >= this.weaponSlots) return false;
    if (this.weapons[slot]) return false;
    const w = new Weapon(defKey, slot);
    this.weapons[slot] = w;
    this._reallocWeaponPower();
    return true;
  }

  /** STATION UPGRADE: convert the first empty room into a brand-new
   *  MODULE of the given type (level 1 system). Weapons cap at 3 per
   *  hull; other module types cap at 1. */
  addModule(type) {
    if (!SYSTEM_DEFS[type]) return false;
    if (type === 'weapons') {
      if (this.weaponRooms.length >= 3) return false;
    } else if (this.getSystem(type)) {
      return false;   // only one cloak / repair bay etc.
    }
    const room = this.rooms.find(r => r.type === 'empty');
    if (!room) return false;
    room.type = type;
    // Some modules are worthless at one pip — shields need a whole
    // 2-power layer before they can raise anything at all.
    const sys = new ShipSystem(type, SYSTEM_DEFS[type].startLevel ?? 1);
    sys.power = 0; sys.desiredPower = 0;   // new modules start UNPOWERED
    room.system = sys;
    sys.roomId = room.id;
    sys.roomX = room.x; sys.roomY = room.y;
    sys.roomW = room.w; sys.roomH = room.h;
    sys.cx = room.cx;   sys.cy = room.cy;
    this.systems.push(sys);
    this._extraModules = this._extraModules ?? [];
    this._extraModules.push(type);
    if (type === 'weapons') {
      this.weaponSlots = Math.max(this.weaponSlots, this.weaponRooms.length);
    }
    return true;
  }

  addWeaponModule() { return this.addModule('weapons'); }

  /** Same as addModule, but into a SPECIFIC empty room chosen by the
   *  player on the station's ship diagram. */
  addModuleAt(type, roomId) {
    if (!SYSTEM_DEFS[type]) return false;
    if (type === 'weapons') {
      if (this.weaponRooms.length >= 3) return false;
    } else if (this.getSystem(type)) {
      return false;
    }
    const room = this.getRoomById(roomId);
    if (!room || room.type !== 'empty') return false;
    room.type = type;
    // Some modules are worthless at one pip — shields need a whole
    // 2-power layer before they can raise anything at all.
    const sys = new ShipSystem(type, SYSTEM_DEFS[type].startLevel ?? 1);
    sys.power = 0; sys.desiredPower = 0;   // new modules start UNPOWERED
    room.system = sys;
    sys.roomId = room.id;
    sys.roomX = room.x; sys.roomY = room.y;
    sys.roomW = room.w; sys.roomH = room.h;
    sys.cx = room.cx;   sys.cy = room.cy;
    this.systems.push(sys);
    this._extraModules = this._extraModules ?? [];
    this._extraModules.push({ type, roomId });
    if (type === 'weapons') {
      this.weaponSlots = Math.max(this.weaponSlots, this.weaponRooms.length);
    }
    return true;
  }

  /** Missiles are physical: the racks in the hold ARE the ammo count. */
  missileCount() { return this.cargo?.countOf?.('missiles') ?? 0; }

  /** He2 is physical too (update39): the cells in the hold ARE the tank.
   *  No canisters aboard, no jump — exactly like the missile racks. */
  fuelCount() { return this.cargo?.countOf?.('fuel') ?? 0; }

  /**
   * Box a gun and stow it in the grid hold. A gun can only ever be
   * MOUNTED or BOXED — there is no weightless rack it can live on.
   * Returns the crate, or null if the hold has no room for it.
   */
  boxWeapon(defKey) {
    if (!this.cargo || typeof cargoCrateForWeapon !== 'function') return null;
    return this.cargo.add(cargoCrateForWeapon(defKey), defKey);
  }

  /** Uninstall a gun into the cargo hold (station use). */
  uninstallWeapon(slot) {
    const w = this.weapons[slot];
    if (!w) return null;
    this.weapons[slot] = null;
    this.weaponCargo.push(w.defKey);
    this._reallocWeaponPower();
    return w.defKey;
  }

  /* removeWeapon(slot) DELETED (update40).
   *
   * It sat directly below `uninstallWeapon(slot)` with no call sites and
   * the opposite behaviour: uninstall pushes the gun into
   * `this.weaponCargo` so you keep it, removeWeapon DESTROYED it. Two
   * contradictory rules for one action, one of them silently
   * confiscating a weapon the day anybody wired it up by mistake.
   */

  _reallocWeaponPower() {
    // Each gun draws power from ITS OWN weapon module. A damaged or
    // ionised module de-powers only the gun mounted in it (FTL rule,
    // one gun per module). Overflow slots without a room (boss ships)
    // share the FIRST module's leftover power.
    let sharedLeft = null;
    this.weapons.forEach((w, i) => {
      if (!w) return;
      const sys = this.weaponSystemFor(i);
      if (sys) {
        w.power = Math.min(w.powerCost, sys.effectivePower());
      } else {
        if (sharedLeft === null) {
          const first = this.weaponSystemFor(0);
          sharedLeft = first ? Math.max(0, first.effectivePower()
            - (this.weapons[0]?.power ?? 0)) : 0;
        }
        const give = Math.min(w.powerCost, sharedLeft);
        w.power    = give;
        sharedLeft -= give;
      }
    });
  }

  // ── Power management ──────────────────────────────────────

  /** Has this ship's power ever been laid out (by the auto-spread or
   *  by the player)? Used so a new battle does NOT stomp the layout the
   *  player set up in the previous one. */
  hasPowerPreference() {
    return this.systems.some(s => s.type !== 'reactor' && s.desiredPower > 0);
  }

  _allocateDefaultPower() {
    // Life support and helm first — the starting reactor (6 power)
    // cannot feed everything, and an unpowered O2 system suffocates.
    const prio = { oxygen:0, piloting:1, shields:2, weapons:3,
                   engines:4, medbay:5, artillery:6 };
    let remaining = this.reactor.totalPower;
    [...this.systems]
      .filter(s => s.type !== 'reactor')
      .sort((a, b) => (prio[a.type] ?? 9) - (prio[b.type] ?? 9))
      .forEach(sys => {
        const give = Math.min(sys.maxPower, remaining);
        sys.power        = give;
        sys.desiredPower = give;
        remaining       -= give;
      });
  }

  setPower(systemType, power) {
    const sys = this.getSystem(systemType);
    if (!sys) return;
    this.setPowerAt(this.systems.indexOf(sys), power);
  }

  /** Index-based power control — needed because a ship can carry
   *  SEVERAL systems of the same type (one per weapon module). */
  setPowerAt(sysIndex, power) {
    const sys = this.systems[sysIndex];
    if (!sys || sys.type === 'reactor') return;
    this.reactor.setPower(sys, power, this.systems);
    sys.desiredPower = sys.power;   // remember intent — restored after repair
    if (sys.type === 'weapons') this._reallocWeaponPower();
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

    // ACTIVE CLOAK: nothing lands while the field is up. Not a high
    // evasion roll — a guaranteed miss for the whole duration. That is
    // the point of spending a cooldown on it.
    {
      const cl = this.getSystem('cloaking');
      if (cl && cl.cloakActive) {
        Particles.floatText(proj.x, proj.y - 6, 'CLOAKED', '#cc44ff', 12);
        return { absorbed: true, dodged: true, hullDamage: 0 };
      }
    }

    // Evasion dodge — pilot and engine crew gain XP (FTL)
    if (Math.random() < this.evasion) {
      Particles.floatText(proj.x, proj.y - 6, 'MISS', '#8fd4ff', 12);
      const pSys = this.getSystem('piloting');
      const eSys = this.getSystem('engines');
      const helmHand = pSys ? this.consoleOperator(pSys.roomId) : null;
      const engHand2  = eSys ? this.consoleOperator(eSys.roomId) : null;
      if (helmHand) helmHand.addXP('piloting', XP_RATES.piloting);
      if (engHand2) engHand2.addXP('engines',  XP_RATES.engines);
      return { absorbed: true, dodged: true, hullDamage: 0 };
    }

    // Who ignores shields: it is a property of the GUN now, not a list
    // of type names scattered through the damage code.
    const isBeam    = def.type === 'beam';
    const pierces   = def.pierceShields ?? (def.type === 'missile' || def.type === 'cannon' || isBeam);

    // Shield check. A bolt stopped by the bubble strips shieldDamage
    // BARS, not one — that is what makes an ion cannon or a flak burst
    // a shield-breaker rather than a slightly worse laser.
    if (!pierces && this.shieldBars > 0) {
      const shSys = this.getSystem('shields');
      const strip = Math.max(1, def.shieldDamage ?? def.shield_damage ?? 1);
      for (let i = 0; i < strip && this.shieldBars > 0; i++) shSys.hitShield();
      Particles.shieldHit(proj.x, proj.y);
      if (strip > 1) Particles.floatText(proj.x, proj.y - 6, `-${strip} SHIELD`, '#4db8ff', 11);
      this._shieldAlpha = 1;
      Camera.shake(4, 0.15);
      return { absorbed: true, hullDamage: 0, shieldStripped: strip };
    }

    // Damage lands in the room the projectile actually reached.
    // (Previously a random room was picked — targeting was cosmetic
    //  and fires appeared in modules that were never hit.)
    const roomHit =
      this.rooms.find(r => r.contains(proj.x, proj.y)) ||
      this.rooms.find(r => r.contains(proj.targetX, proj.targetY)) ||
      Utils.pick(this.rooms);

    /* EVERY EFFECT IS ITS OWN NUMBER.
       `damage` used to do four jobs at once — hull points, module levels,
       a multiplier on crew injury and, by implication, the breach roll —
       so there was no way to describe a gun that strips shields and
       harms nothing, or one that cuts up crew but leaves modules alone.
       Each one is a separate field on the def now (see WEAPON_DEFS). */
    const dmg = def.hull_damage ?? def.damage ?? 1;
    this.hull = Math.max(0, this.hull - dmg);

    // Floating damage feedback
    if (roomHit.type === 'reactor' && roomHit.system && dmg > 0) {
      Particles.floatText(roomHit.cx, roomHit.y + 10, `-${dmg} POWER`, '#ffb020', 12);
    } else if (dmg > 0) {
      Particles.floatText(roomHit.cx, roomHit.y + 10, `-${dmg}`, '#ff5566', 13);
    }

    // Module levels knocked out. 0 means this gun cannot break a module
    // at all, however hard it lands (ion, flak).
    const modDmg = def.moduleDamage ?? def.damage ?? 1;
    if (roomHit.system && modDmg > 0) roomHit.system.damageLevel(modDmg);

    // Crew in the hit room. An explicit [min,max] per weapon, so a flak
    // burst can hurt people without touching the machinery.
    const cd = def.crewDamage ?? [10 * dmg, 25 * dmg];
    if ((cd[1] ?? 0) > 0) {
      this.occupantsOf(roomHit.id).forEach(c => {
        const before = c.alive;
        // crewDamage is an inclusive range in WEAPON_DEFS, and the
        // stat chip prints it as one — so roll it as one.
        c.takeDamage(Utils.randIn(cd[0], cd[1]), 'weapons fire');
        // Credit the gunner who actually pulled the trigger — that is
        // what the memorial means by "kills".
        if (before && !c.alive) (proj.gunners ?? []).forEach(g => g.creditKill?.(c));
      });
    }

    // STUN — the module and everyone in it. One second per ion bolt.
    const stun = def.stunTime ?? (def.type === 'ion' ? 1 : 0);
    if (stun > 0) {
      if (roomHit.system) roomHit.system.ionHit(stun);
      this.occupantsOf(roomHit.id).forEach(c => c.stun?.(stun));
      Particles.floatText(roomHit.cx, roomHit.y + 22, 'STUNNED', '#8fd4ff', 11);
    }

    // Breach chance — per weapon now. It used to be "missiles always,
    // any 2+ hit 25% of the time", which made every heavy laser a hull
    // breacher and gave the designer no way to say otherwise.
    const breachP = def.breachChance ?? (pierces ? 0.5 : dmg >= 2 ? 0.25 : 0);
    if (breachP > 0 && Math.random() < breachP) {
      this.breaches.open(
        roomHit.id,
        roomHit.x + Utils.randFloat(8, roomHit.w - 8),
        roomHit.y + Utils.randFloat(8, roomHit.h - 8)
      );
    }

    // Fire chance — per weapon, 25% unless the def says otherwise
    // (the starting laser is deliberately tamer, see WEAPON_DEFS).
    if (Math.random() < (def.fireChance ?? 0.25)) {
      this.fires.start(roomHit.id, roomHit.cx, roomHit.cy);
    }

    Particles.explosion(proj.x, proj.y, 0.7);
    Camera.shake(6, 0.2);

    /* THE SECOND DAMAGE NUMBER IS GONE (update40).
       There were two floatText calls for one hit, at the same point:
       the guarded one above (`else if (dmg > 0)`) and an unguarded one
       here. Every laser hit painted two overlapping numbers in two
       sizes, which read as a smeared bold figure — and because ion and
       flak have hull_damage 0, the unguarded one proudly rendered
       "-0" over the room for the two guns whose whole identity is that
       they harm nothing. */
    roomHit._hitFlash = 1;          // drawn by Room.draw, fades out

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

  /**
   * Egg sacs split open once there is prey aboard.
   *
   * Anyone sharing a room with a sac sets it off IMMEDIATELY; the rest
   * hatch on their own stagger so a boarding party can never get stuck
   * unable to finish because one sac sits in a room nobody visits.
   */
  hatchNests(dt) {
    const sacs = this.crew.filter(c => c.dormant && !c.dead);
    if (!sacs.length) return 0;
    const intruders = this.crew.filter(c => c.isPlayer && !c.dead && !c.down);
    if (!intruders.length) return 0;      // still nobody aboard

    let hatched = 0;
    sacs.forEach(sac => {
      const inRoom = intruders.some(p => p.roomId === sac.roomId);
      /* WALKING IN IS HOW YOU FIND THEM.
         A sac is invisible until somebody is in the room with it — the
         wreck reads as empty and the nests are something you discover,
         not something the sensors hand you on the way in.
         Entering also makes it hatch six times faster (it was hatching
         INSTANTLY before, so the sac was never actually seen), which
         leaves a moment to register what you have just walked into. */
      if (inRoom) sac.revealed = true;
      sac.hatchT -= dt * (inRoom ? 6 : 1);
      if (sac.hatchT <= 0) {
        if (sac.hatch()) hatched++;
      }
    });
    if (hatched && typeof UI !== 'undefined') {
      UI.notify?.(`${hatched} egg sac${hatched > 1 ? 's' : ''} just split open!`, 'alert');
    }
    return hatched;
  }

  /**
   * MOON RATS, once they are aboard (update39).
   *
   * A rat is ordinary hostile crew — that is what lets your people
   * corner one and beat it to death using the melee code that already
   * works, and it is why "sometimes they go for a crewman" needs no
   * code at all. What DOES need code is the other half of the report:
   * a rat that finds a module chews through the loom and shorts it.
   * That is exactly a stun, so it goes through the same ionHit() an
   * ion bolt uses — the module stops working, the people in it stop
   * with it, and the readout already knows how to say so.
   *
   * They only chew DURING A FIGHT. A rat gnawing your shields flat in
   * open space is a chore; a rat gnawing them flat with a gunship
   * closing is a story, and the player asked for the story.
   */
  verminTick(dt) {
    const rats = this.crew.filter(c => c.isVermin && !c.dead);
    if (!rats.length) return 0;
    // Clear away anything that finally stopped moving, so a hunted-out
    // hull does not carry a list of corpses for the rest of the run.
    const gone = this.crew.filter(c => c.isVermin && c.dead);
    if (gone.length) this.crew = this.crew.filter(c => !(c.isVermin && c.dead));

    const fighting = (typeof CombatManager !== 'undefined')
      && (CombatManager.isActive?.() ?? false);
    let shorts = 0;
    rats.forEach(rat => {
      if (!rat.alive) return;
      rat._chewT = (rat._chewT ?? Utils.randFloat(4, Ship.RAT_CHEW_MAX)) - dt;
      if (rat._chewT > 0) return;
      rat._chewT = Utils.randFloat(Ship.RAT_CHEW_MIN, Ship.RAT_CHEW_MAX);

      const room = this.getRoomById(rat.roomId);
      // Somebody is already swinging at it — it has other problems.
      const cornered = room && this.crew.some(c =>
        c.isPlayer && c.alive && c.roomId === room.id);
      if (cornered) return;

      const sys = room?.system;
      // Already shorted? Leave it — chewing a dead loom does nothing,
      // and stacking stun on stun would hold a module down for ever.
      if (fighting && sys && !(sys.stunLeft > 0)) {
        sys.ionHit(Ship.RAT_SHORT_SECONDS);
        this.occupantsOf(room.id).forEach(c => c.stun?.(Ship.RAT_SHORT_SECONDS));
        Particles.floatText?.(room.cx, room.y + 22, 'SHORTED', '#ffd780', 11);
        if (this.isPlayer) Audio.sfx.ratChew?.();
        if (this.isPlayer && typeof UI !== 'undefined') {
          UI.notify(`Something chewed through the ${sys.label} loom — it is dead for `
                  + `${Ship.RAT_SHORT_SECONDS}s!`, 'alert');
        }
        shorts++;
        return;
      }

      // Otherwise it moves on to somewhere else worth chewing.
      const elsewhere = this.rooms.filter(r => r.id !== rat.roomId);
      if (!elsewhere.length) return;
      const to = Utils.pick(elsewhere);
      rat.homeRoomId = to.id;
      rat.moveToOnShip(this, to.cx + Utils.randFloat(-14, 14),
                             this.floorWalkY(to.floor, to.cy));
    });
    return shorts;
  }

  /** How long a chewed loom stays dead, and how often a rat tries. */
  static get RAT_SHORT_SECONDS() { return 3; }
  static get RAT_CHEW_MIN() { return 9; }
  static get RAT_CHEW_MAX() { return 22; }

  /* ── Casualty clocks (update42) ──────────────────────────
     Every one of these used to be an inline literal buried in
     _updateBodies, and two of them didn't exist at all. */
  /** Seconds a corpse lies aboard before it starts to rot. */
  static get DECAY_SECONDS() { return 40; }
  /** Seconds a DOWNED crew member has before they bleed out. */
  static get BLEEDOUT_SECONDS() { return 40; }
  /** HP/s a crewmate restores kneeling beside the wounded. */
  static get FIELD_AID_HPS() { return 2.2; }
  /** Infection chance per second, sharing a room with a rotting body. */
  static get PLAGUE_RATE_ROOM() { return 0.05; }
  /** …and anywhere else on the ship, carried by the air handlers. */
  static get PLAGUE_RATE_VENT() { return 0.008; }
  /** How long a bearer waits with a body when every hatch is shut. */
  static get CORPSE_HOLD_SECONDS() { return 6; }

  update(dt) {
    if (this.destroyed) return;

    if (this.isDerelict) this.hatchNests(dt);
    else this.verminTick(dt);

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

    // ── Bodies: carrying, medbay healing, decay plague, ejection ──
    this._updateBodies(dt);

    // Sync crew presence into each system (bonuses, cyborg power, medbay)
    this.systems.forEach(sys => {
      sys.crew = sys.roomId ? this.crewOperating(sys.roomId) : [];
      // WHO IS AT THE CONSOLE (update43) — the only one whose skill
      // counts, and the only one who learns from the module's work.
      sys.consoleCrew = sys.roomId ? this.consoleOperator(sys.roomId) : null;
      sys.shipIsPlayer = this.isPlayer;   // so a system can talk to the UI
    });

    // Systems
    this.systems.forEach(sys => sys.update(dt));

    // FTL power flow: each system draws up to its DESIRED power,
    // limited by working (undamaged) levels and reactor budget.
    // → repairing a module automatically re-lights its bars.
    {
      let remaining = this.reactor.totalPower;
      this.systems.forEach(sys => {
        // Use the SAME cyborg-substitution rule as Reactor.distribute/
        // setPower (ShipSystem.reactorDraw). This loop used to subtract
        // the raw allocation, so a unit the cyborg had freed was never
        // actually available here — the last modules in the list (the
        // medbay, typically) silently got starved and would not switch
        // on no matter how many times you clicked their pips.
        let want = Math.min(sys.desiredPower, sys.workingLevels);
        while (want > 0 && sys.reactorDraw(want) > remaining) want--;
        sys.power  = want;
        remaining -= sys.reactorDraw(want);
      });
    }

    // Repair Bay: powered nanobots slowly mend every damaged system.
    // Rate ≈ half a crew member per powered level (1 level / ~17s).
    const rbay = this.getSystem('autorepair');
    if (rbay) {
      const rate = rbay.effectivePower() * 0.5;
      if (rate > 0) {
        this.systems.forEach(sys => {
          if (sys !== rbay && sys.damagedLevels > 0) sys.repair(dt * rate);
        });
      }
    }

    this._reallocWeaponPower();   // damaged weapon module instantly de-powers ITS gun
    this.weapons.forEach((w, i) => {
      if (!w) return;
      // OPERATOR RULE: a gun charges only while a crew member stands
      // in ITS weapon module (slots without a room fall back to any
      // weapons-room operator — legacy boss overflow).
      const room   = this.weaponRooms[i];
      const manned = room
        ? this.crewOperating(room.id).length > 0
        : this.weaponRooms.some(r => this.crewOperating(r.id).length > 0);
      w.update(dt, this.weaponCrewBonusFor(i), manned);
    });

    // Hit flashes fade; wrecked modules smoke so a broken ship LOOKS
    // broken even when you are not reading the power bar.
    this.rooms.forEach(room => {
      if (room._hitFlash > 0) room._hitFlash = Math.max(0, room._hitFlash - dt * 3.5);
      const sys = room.system;
      if (sys && sys.damagedLevels > 0 && Math.random() < dt * (1.2 * sys.damagedLevels)) {
        Particles.damageSmoke?.(room.cx + Utils.randFloat(-14, 14), room.cy);
      }
    });

    // Crew update and room assignment
    this.crew.forEach(c => {
      if (c.dead) return;
      /* FIGHTS BELONG IN ROOMS, NOT IN THE WALLS (update42).
         `roomId` was never cleared when a crew member stepped OUT of
         every room rectangle — and there is real floor that belongs to
         no room: the 28px elevator trunk. Waiting for a cabin or riding
         one, a boarder kept the stale id of the room he had left, so
         melee matched him against someone on the other side of a wall,
         the brawl cancelled his ride, and if he lost, the corpse lay in
         the shaft while bodiesInRoom still reported him inside. Melee
         and the body loops now require you to actually BE in a room.

         Resolved BEFORE c.update, not after: melee runs inside update
         and has to judge where the man is standing NOW, not where he
         was last frame — and on his very first frame aboard there is
         no last frame at all. */
      const at = this.rooms.find(r => r.contains(c.x, c.y));
      c.inRoom = !!at;
      if (at) c.roomId = at.id;

      c.update(dt, this);

      // …and again afterwards, so everything that reads the roster
      // between frames sees where he ended up.
      const now = this.rooms.find(r => r.contains(c.x, c.y));
      c.inRoom = !!now;
      if (now) c.roomId = now.id;
    });
    /* CORPSES STAY (update40).
     *
     * This line was `filter(c => !c.dead)` — unconditional, and run at
     * the end of every single update, in the SAME call in which
     * CrewMember.update flips dying → dead. `_updateBodies` runs
     * BEFORE the crew loop, so it never once saw a body that had just
     * died, and the body was gone by the next frame.
     *
     * That quietly deleted an entire subsystem the game keeps telling
     * the player about: carrying the dead to an airlock, the
     * "…body is DECAYING — eject it before the crew gets sick!" warning
     * in markCombatStart, the corpse plague that spreads from a rotting
     * body to everyone in the room, the ☠/☣ head markers in
     * CrewMember.draw and the DECAYING tag in the crew panel. None of
     * it could ever fire. (The wounded half still worked, which is what
     * made the contradiction so easy to miss.)
     *
     * A body now lies where it fell until somebody carries it out —
     * `_updateBodies` removes the EJECTED, and that is the only way off
     * the ship. Animals are the exception: nobody holds a service for a
     * spider, and a hull that had been cleared of vermin should not
     * carry a list of little corpses for the rest of the run.
     *
     * Everything that counts people already filters `!c.dead`
     * (_playerCrewAliveCount, returnFromRun, crewInRoom, occupantsOf,
     * takenStationSlots, the wreck-cleared check), so keeping them in
     * the roster changes no count.
     */
    this.crew = this.crew.filter(c => !(c.dead && c.isBeast));

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
    // Cloaking field: powered cloak renders the whole ship as a
    // shimmering phantom (visual feedback for the evasion bonus)
    const cloakSys = this.getSystem('cloaking');
    const cloaked  = !!(cloakSys && cloakSys.cloakActive);
    if (cloaked) {
      ctx.save();
      const t = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.004;
      ctx.globalAlpha = 0.55 + Math.sin(t) * 0.12;
    }

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

      // HIT FLASH — a shell landing here lights the compartment for a
      // moment. Without it a hit on a far room is easy to miss entirely.
      if (room._hitFlash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.55 * room._hitFlash})`;
        ctx.fillRect(room.x, room.y, room.w, room.h);
        ctx.strokeStyle = `rgba(255,90,110,${room._hitFlash})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(room.x + 1, room.y + 1, room.w - 2, room.h - 2);
      }
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

    if (cloaked) {
      ctx.restore();
      // faint distortion ring so you can still find the hull outline
      const b = this.roomBounds();
      ctx.strokeStyle = 'rgba(120,200,255,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x - 10, b.y - 10, b.w + 20, b.h + 20);
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

  /**
   * Guns sit ON the hull, along the top edge, spread across its width —
   * they used to float off the nose in a vertical stack, which read as a
   * detached UI widget rather than as part of the ship.
   */
  _drawWeaponMounts(ctx) {
    const b = this.roomBounds();
    const mounted = this.weapons.filter(Boolean);
    if (!mounted.length) return;

    // Space the mounts by whichever is wider — the gun or its charge
    // strip — so an 18-second cannon's boxes never run into its neighbour.
    const GW = 44, GAP = 14;
    const widths = mounted.map(w => Math.max(GW, w.chargeStripWidth?.() ?? GW));
    const total = widths.reduce((a, b) => a + b, 0) + (mounted.length - 1) * GAP;
    // Centre the row on the hull; if the hull is narrow, start at its edge.
    const startX = Math.round(b.x + Math.max(6, (b.w - total) / 2));
    // Clear of the plating: the charge boxes hang under the gun, so
    // a tighter offset put them straight on top of the hull.
    const y = Math.round(b.y - 42);
    const dir = this.isPlayer ? 1 : -1;      // point at the enemy

    let gx = startX;
    mounted.forEach((w, i) => {
      // draw() centres itself on the 44px gun box, so offset by the
      // difference when the strip is the wider of the two.
      w.draw(ctx, gx + Math.round((widths[i] - GW) / 2), y, false, dir);
      gx += widths[i] + GAP;
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
      // Systems serialised BY INDEX — layouts are deterministic, and a
      // ship can carry several systems of the same type (weapon modules).
      // Save the DESIRED allocation, not the momentary one: a module
      // that happened to be shot out when we jumped would otherwise
      // come back permanently switched off after repairs.
      systems: this.systems.map(s => ({
        type: s.type, level: s.level, power: Math.max(s.power, s.desiredPower ?? 0),
      })),
      weapons: this.weapons.map(w => w ? { defKey: w.defKey, slot: w.slot } : null),
      weaponCargo: [...this.weaponCargo],
      cargo: this.cargo ? this.cargo.serialise() : null,
      extraModules: [...(this._extraModules ?? [])],
      reactor: this.reactor.level,
    };
  }

  static deserialise(data, isPlayer, wx, wy) {
    const ship = new Ship(data.layoutKey, isPlayer, wx, wy);
    ship.hull  = data.hull;
    ship.reactor.level = data.reactor;

    // Re-apply purchased modules IN ORDER before restoring systems so
    // the systems array lines up index-for-index with the save.
    (data.extraModules ?? []).forEach(e => {
      if (typeof e === 'string') ship.addModule(e);
      else ship.addModuleAt(e.type, e.roomId) || ship.addModule(e.type);
    });

    data.systems.forEach((sd, i) => {
      const sys = ship.systems[i];
      if (!sys || sys.type !== sd.type) return;   // layout mismatch guard
      if (sd.type === 'reactor') return;  // pips derive from module level
      sys.level = sd.level; sys.power = sd.power; sys.desiredPower = sd.power;
    });
    ship.weaponCargo = [...(data.weaponCargo ?? [])];

    // Saves written before the grid hold existed simply have no `cargo`
    // key — those ships keep the empty grid the constructor built.
    if (data.cargo && typeof CargoGrid !== 'undefined') {
      ship.cargo = CargoGrid.deserialise(data.cargo);
    }

    ship.weapons = [];
    data.weapons.forEach(wd => {
      if (wd) ship.installWeapon(wd.defKey, wd.slot);
    });

    return ship;
  }
}

/* The grid is the contract between the code and the art kit — the
   brief that the module, shaft, engine and prow tiles are cut to reads
   these numbers, so they have to be reachable from a test. */
if (typeof window !== 'undefined') {
  window.HULL_GRID = HULL_GRID;
  window.buildHull = buildHull;
}
