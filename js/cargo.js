/* ============================================================
   MOON WARS — cargo.js
   The grid hold: Tetris-shaped salvage in a fixed number of cells.

   Two ideas carry the whole system:

     1. SHAPE.  An item is a mask of cells, not a line in a list.
        A 3x2 gun crate and a 1x2 He2 canister compete for the same
        hold, so what you leave behind on a wreck is a real decision.

     2. NEIGHBOURS.  Some cargo cares what is packed next to it. An
        unstable core cooks whatever touches it; a cooler crate
        smothers the core. Packing is a puzzle, not just a fit test.

   Nothing here draws or reads input — lootscreen.js does that.
   Nothing here knows about the run — game.js/ui.js spend the items.

   Resource model (deliberate, so old saves keep working):
     CC, He2 and missiles stay plain numbers on the run. Cargo items
     are a SEPARATE layer; a canister/crate is UNPACKED into those
     numbers, or sold whole for CC.
   ============================================================ */

'use strict';

/* ── Item catalogue ──────────────────────────────────────────
   cells : rows of '#' (filled) and '.' (empty). Omit for a plain
           w x h block. The mask is the source of truth for size.
   kind  : 'fuel' | 'missiles' | 'heal' | 'weapon' | 'trade'
   value : base sell price in CC
   tag   : 'rad' emitter, 'cool' absorber — see hazardTick()
*/
const CARGO_ITEMS = {

  he2_canister: {
    label: 'He2 Canister', short: 'He2',
    w: 1, h: 2, value: 16, col: '#ff6b7a', kind: 'fuel', amount: 3,
    desc: 'Pressurised helium-3. Unpack for +3 He2.',
  },
  he2_drum: {
    label: 'He2 Drum', short: 'He2+',
    w: 2, h: 2, value: 42, col: '#ff5566', kind: 'fuel', amount: 8,
    desc: 'A full drum. Unpack for +8 He2 — if it fits.',
  },
  missile_crate: {
    label: 'Missile Crate', short: 'MSL',
    w: 2, h: 1, value: 20, col: '#ffb347', kind: 'missiles', amount: 4,
    desc: 'Four warheads in foam. Unpack to reload.',
  },
  medkit: {
    label: 'Medkit', short: 'MED',
    w: 1, h: 1, value: 14, col: '#1aff8c', kind: 'heal', amount: 30,
    desc: 'Unpack to patch up your most hurt crewman.',
  },
  ration_pack: {
    label: 'Ration Pack', short: 'RAT',
    w: 1, h: 1, value: 8, col: '#8fa8c0', kind: 'trade',
    desc: 'Nobody gets rich on freeze-dried protein.',
  },
  data_core: {
    label: 'Data Core', short: 'DAT',
    w: 1, h: 1, value: 45, col: '#4db8ff', kind: 'trade', science: 1.5,
    desc: 'Someone\'s navigation logs. Research posts pay well.',
  },
  drone_core: {
    label: 'Drone Core', short: 'DRN',
    w: 2, h: 2, value: 80, col: '#8a7dff', kind: 'trade',
    desc: 'An intact combat drone brain. Heavy, valuable.',
  },
  module_crate: {
    label: 'Module Crate', short: 'MOD',
    w: 2, h: 3, value: 120, col: '#4dd8ff', kind: 'trade',
    desc: 'A whole ship system, boxed. Awkward and worth it.',
  },
  gun_crate: {
    label: 'Gun Crate', short: 'GUN',
    w: 3, h: 2, value: 0, col: '#ffd780', kind: 'weapon',
    desc: 'A salvaged weapon. Unpack to move it to the weapon rack.',
  },
  plating: {
    label: 'Hull Plating', short: 'PLT',
    w: 3, h: 1, value: 34, col: '#7a90a8', kind: 'trade',
    desc: 'Cut-to-size armour sheet. Yards always want it.',
  },

  // ── hazards / puzzle pieces ──
  unstable_core: {
    label: 'Unstable Core', short: 'RAD',
    w: 2, h: 2, value: 150, col: '#ff3860', kind: 'trade', tag: 'rad',
    desc: 'Worth a fortune. Cooks anything packed against it — '
        + 'unless a cooler crate is touching it.',
  },
  cooler_crate: {
    label: 'Cooler Crate', short: 'CLR',
    w: 1, h: 2, value: 22, col: '#4dd8ff', kind: 'trade', tag: 'cool',
    desc: 'Smothers one unstable core it touches.',
  },
  contraband: {
    label: 'Sealed Contraband', short: 'CTB',
    w: 2, h: 1, value: 90, col: '#ff8adf', kind: 'trade', contraband: true,
    desc: 'Unmarked, unasked-about. Free ports pay double; '
        + 'fleet yards confiscate it.',
  },
  alien_relic: {
    label: 'Alien Relic', short: 'REL',
    cells: ['##', '#.', '#.'], value: 140, col: '#c9a0ff',
    kind: 'trade', science: 1.6,
    desc: 'It does not pack neatly and it never will.',
  },
  spider_egg: {
    label: 'Sealed Egg Case', short: 'EGG',
    w: 1, h: 1, value: 60, col: '#9fff7a', kind: 'trade', tag: 'egg',
    desc: 'Warm. Faintly moving. Science posts pay a lot for it, '
        + 'and ask no questions about the noise.',
  },
};

/** Where a port pays over/under the odds. */
const CARGO_PORT_RATE = {
  military: 0.95,
  science:  1.10,
  general:  1.00,
  outpost:  0.85,
};

/* ── Mask helpers ────────────────────────────────────────── */

/** Base (unrotated) mask for a def key: array of arrays of bool. */
function cargoMask(defKey) {
  const def = CARGO_ITEMS[defKey];
  if (!def) return [[true]];
  if (def.cells) return def.cells.map(row => row.split('').map(ch => ch === '#'));
  const w = def.w ?? 1, h = def.h ?? 1;
  return Array.from({ length: h }, () => Array(w).fill(true));
}

/** Rotate a mask 90° clockwise, `times` times. */
function rotateMask(mask, times = 1) {
  let m = mask;
  for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
    const h = m.length, w = m[0].length;
    const out = Array.from({ length: w }, () => Array(h).fill(false));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        out[x][h - 1 - y] = m[y][x];
    m = out;
  }
  return m;
}

/* ── An item instance ────────────────────────────────────── */

class CargoItem {
  constructor(defKey, meta = null) {
    this.defKey = defKey;
    this.def    = CARGO_ITEMS[defKey] || CARGO_ITEMS.ration_pack;
    this.id     = `it${Utils.uid()}`;
    this.x      = 0;
    this.y      = 0;
    this.rot    = 0;
    this.meta   = meta;      // gun_crate → weapon defKey; egg → hatch timer
    this.damaged = false;    // cooked by a core: half value, cannot unpack
  }

  get mask()  { return rotateMask(cargoMask(this.defKey), this.rot); }
  get w()     { return this.mask[0].length; }
  get h()     { return this.mask.length; }
  get label() { return this.def.label; }

  /** Sell price, before any port modifier. */
  value(portType = 'general') {
    let v = this.def.value ?? 0;
    if (this.def.kind === 'weapon') v = 55;          // rack value of a boxed gun
    if (this.damaged) v = Math.round(v * 0.4);
    let rate = CARGO_PORT_RATE[portType] ?? 1;
    if (this.def.science && portType === 'science') rate = this.def.science;
    if (this.def.contraband) {
      if (portType === 'military') return 0;         // confiscated, never sold
      if (portType === 'outpost')  rate = 2.0;       // no questions out here
      else rate = 1.3;
    }
    return Math.max(1, Math.round(v * rate));
  }

  /** World cells this item covers at its current position. */
  cells() {
    const out = [];
    const m = this.mask;
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m[y].length; x++)
        if (m[y][x]) out.push([this.x + x, this.y + y]);
    return out;
  }

  serialise() {
    return { defKey: this.defKey, x: this.x, y: this.y, rot: this.rot,
             meta: this.meta, damaged: this.damaged };
  }

  static deserialise(d) {
    const it = new CargoItem(d.defKey, d.meta ?? null);
    it.x = d.x ?? 0; it.y = d.y ?? 0; it.rot = d.rot ?? 0;
    it.damaged = !!d.damaged;
    return it;
  }
}

/* ── The grid ────────────────────────────────────────────── */

class CargoGrid {
  constructor(cols = 6, rows = 4) {
    this.cols  = cols;
    this.rows  = rows;
    this.items = [];
  }

  get capacity() { return this.cols * this.rows; }

  /** Cells currently taken, as a cols x rows array of item-or-null. */
  occupancy(ignore = null) {
    const g = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
    for (const it of this.items) {
      if (it === ignore) continue;
      for (const [cx, cy] of it.cells())
        if (cy >= 0 && cy < this.rows && cx >= 0 && cx < this.cols) g[cy][cx] = it;
    }
    return g;
  }

  usedCells() {
    let n = 0;
    for (const it of this.items) n += it.cells().length;
    return n;
  }

  /** Item under a grid cell, or null. */
  at(cx, cy) {
    for (const it of this.items)
      for (const [x, y] of it.cells())
        if (x === cx && y === cy) return it;
    return null;
  }

  /** Would `item` sit legally with its origin at (gx,gy)? */
  fits(item, gx, gy, ignore = null) {
    const m = item.mask;
    const occ = this.occupancy(ignore ?? item);
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const cx = gx + x, cy = gy + y;
        if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
        if (occ[cy][cx]) return false;
      }
    }
    return true;
  }

  place(item, gx, gy) {
    if (!this.fits(item, gx, gy)) return false;
    item.x = gx; item.y = gy;
    if (!this.items.includes(item)) this.items.push(item);
    return true;
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) { this.items.splice(i, 1); return true; }
    return false;
  }

  /** First free spot, trying every rotation. Returns true on success. */
  autoPlace(item) {
    const startRot = item.rot;
    for (let r = 0; r < 4; r++) {
      item.rot = (startRot + r) % 4;
      for (let y = 0; y <= this.rows - item.h; y++)
        for (let x = 0; x <= this.cols - item.w; x++)
          if (this.fits(item, x, y)) { this.place(item, x, y); return true; }
    }
    item.rot = startRot;
    return false;
  }

  /** Convenience: build an item by def key and stow it. */
  add(defKey, meta = null) {
    const it = new CargoItem(defKey, meta);
    return this.autoPlace(it) ? it : null;
  }

  /** Items orthogonally touching `item`. */
  neighbours(item) {
    const occ  = this.occupancy();
    const seen = new Set();
    const out  = [];
    for (const [cx, cy] of item.cells()) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const other = occ[ny][nx];
        if (!other || other === item || seen.has(other.id)) continue;
        seen.add(other.id);
        out.push(other);
      }
    }
    return out;
  }

  /**
   * One jump's worth of hazard. An uncooled unstable core damages
   * every item touching it (a damaged item is worth 40% and can no
   * longer be unpacked). Returns human-readable lines for the log.
   */
  hazardTick() {
    const msgs = [];
    for (const core of this.items) {
      if (core.def.tag !== 'rad') continue;
      const near = this.neighbours(core);
      if (near.some(n => n.def.tag === 'cool')) continue;   // smothered
      for (const victim of near) {
        if (victim.def.tag === 'cool' || victim.damaged) continue;
        victim.damaged = true;
        msgs.push(`${victim.label} was cooked by the ${core.label}`);
      }
    }
    return msgs;
  }

  /** True if an uncooled core is sitting in the hold right now. */
  hasLiveHazard() {
    return this.items.some(it =>
      it.def.tag === 'rad' && !this.neighbours(it).some(n => n.def.tag === 'cool'));
  }

  clear() { this.items = []; }

  serialise() {
    return { cols: this.cols, rows: this.rows,
             items: this.items.map(i => i.serialise()) };
  }

  static deserialise(d) {
    const g = new CargoGrid(d?.cols ?? 6, d?.rows ?? 4);
    (d?.items ?? []).forEach(raw => {
      const it = CargoItem.deserialise(raw);
      if (CARGO_ITEMS[it.defKey]) g.items.push(it);
    });
    return g;
  }
}

/* ── Wreck generation ────────────────────────────────────── */

/** Weighted table: what actually drifts around in a given sector. */
function cargoRollTable(sector = 1) {
  const t = [
    ['he2_canister',  22],
    ['missile_crate', 18],
    ['medkit',        14],
    ['ration_pack',   12],
    ['plating',       10],
    ['data_core',      9],
    ['cooler_crate',   7],
    ['he2_drum',       6],
    ['contraband',     5 + sector],
    ['drone_core',     4 + sector],
    ['module_crate',   3 + sector],
    ['unstable_core',  2 + sector * 2],
    ['alien_relic',    1 + sector],
  ];
  return t;
}

function rollCargoKey(sector = 1) {
  const table = cargoRollTable(sector);
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of table) { r -= w; if (r <= 0) return key; }
  return 'ration_pack';
}

/**
 * Build the hold of a derelict. Bigger, richer grids deeper in.
 * Always returns a grid with at least one item worth taking.
 */
function makeWreckGrid(sector = 1, opts = {}) {
  const cols = opts.cols ?? Utils.clamp(4 + Math.floor(sector / 2), 4, 7);
  const rows = opts.rows ?? Utils.clamp(3 + Math.floor(sector / 3), 3, 5);
  const g = new CargoGrid(cols, rows);
  const tries = opts.tries ?? Utils.randInt(4, 8 + sector);
  for (let i = 0; i < tries; i++) g.add(rollCargoKey(sector));
  if (!g.items.length) g.add('ration_pack');
  return g;
}

/* Classic <script> tags: top-level const does NOT land on window.
   basescreen.js taught us that the hard way. */
if (typeof window !== 'undefined') {
  window.CARGO_ITEMS = CARGO_ITEMS;
  window.CargoItem   = CargoItem;
  window.CargoGrid   = CargoGrid;
  window.cargoMask   = cargoMask;
  window.rotateMask  = rotateMask;
  window.makeWreckGrid = makeWreckGrid;
  window.rollCargoKey  = rollCargoKey;
}
