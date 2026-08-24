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

   Resource model (update39 — this note used to say the opposite):
     ONLY CC is a plain number now. Warheads live in racks and He2 in
     cells, both of them real items on real shelves, and the launchers
     and the drive feed straight out of them. `run.missiles` and
     `run.fuel` survive as MIRRORS of the hold, for the HUD, the shop
     and old saves — never as the truth. Nothing is "unpacked" into a
     counter any more.
   ============================================================ */

'use strict';

/* ── Item catalogue ──────────────────────────────────────────
   cells : rows of '#' (filled) and '.' (empty). Omit for a plain
           w x h block. The mask is the source of truth for size.
   kind  : 'fuel' | 'missiles' | 'heal' | 'weapon' | 'trade' | 'scan'
   value : base sell price in CC
   tag   : 'rad' emitter, 'cool' absorber — see hazardTick()
*/
const CARGO_ITEMS = {

  // ── STACKS ──────────────────────────────────────────────
  // These hold a QUANTITY, not a fixed parcel. One rack takes 3 cells
  // and carries up to 10 missiles; 11 missiles is two racks. Every one
  // of them is a real object you open and use, not a token to sell.

  missile_rack: {
    label: 'Missile Rack', short: 'MSL',
    w: 3, h: 1, col: '#ffb347', kind: 'missiles',
    stackMax: 10, unitValue: 5,
    desc: 'Warheads in a launch rack — up to 10. Your launchers feed '
        + 'straight from it.',
  },
  he2_small: {
    label: 'He2 Cell', short: 'He2',
    w: 1, h: 1, col: '#ff8a95', kind: 'fuel',
    stackMax: 5, unitValue: 5,
    desc: 'A one-cell bottle. Holds 5 He2. Open it to top up the tank.',
  },
  he2_med: {
    label: 'He2 Tank', short: 'He2',
    w: 1, h: 2, col: '#ff6b7a', kind: 'fuel',
    stackMax: 15, unitValue: 5,
    desc: 'Standard two-cell tank. Holds 15 He2.',
  },
  he2_large: {
    label: 'He2 Drum', short: 'He2+',
    w: 2, h: 2, col: '#ff5566', kind: 'fuel',
    stackMax: 50, unitValue: 5,
    desc: 'A four-cell drum. Holds 50 He2 — the reason freighters exist.',
  },
  medkit: {
    label: 'Medical Supplies', short: 'MED',
    w: 1, h: 1, col: '#1aff8c', kind: 'heal',
    stackMax: 10, unitValue: 6, healPerDose: 25,
    desc: 'Up to 10 doses. USE one to patch up your worst-hurt crewman.',
  },

  // ── legacy parcels (old saves only — no longer generated) ──
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
  ration_pack: {
    label: 'Ration Pack', short: 'RAT',
    // tag 'food' — and every rat between here and the Belt knows it.
    w: 1, h: 1, value: 8, col: '#8fa8c0', kind: 'trade', tag: 'food',
    desc: 'Nobody gets rich on freeze-dried protein. Keep it sealed: '
        + 'a hold that smells of food does not stay empty.',
  },
  /* ── SURVEY PROBE ────────────────────────────────────────
     You do not get a map of a sector for free any more: you see the
     jump you are about to make and a hint of what lies past it. Burn
     one of these and the whole sector opens up. */
  survey_probe: {
    label: 'Survey Probe', short: 'SCAN',
    w: 1, h: 2, col: '#4dffd0', kind: 'scan',
    stackMax: 1, unitValue: 30,
    desc: 'A one-shot mapping drone. Launch it and the whole sector '
        + 'resolves — every node, every type, all the way to the exit.',
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
  // ── boxed guns ──
  // A gun takes hold space in proportion to how good it is: the heavy
  // stuff genuinely does not fit next to everything else. `gun_crate`
  // stays as the medium tier so older saves keep loading.
  gun_crate_s: {
    label: 'Light Gun Crate', short: 'GUN',
    w: 2, h: 2, value: 0, col: '#ffd780', kind: 'weapon',
    desc: 'A light gun, boxed. Unpack to move it to the weapon rack.',
  },
  gun_crate: {
    label: 'Gun Crate', short: 'GUN',
    w: 3, h: 2, value: 0, col: '#ffd780', kind: 'weapon',
    desc: 'A salvaged weapon. Unpack to move it to the weapon rack.',
  },
  gun_crate_l: {
    label: 'Heavy Gun Crate', short: 'GUN+',
    w: 3, h: 3, value: 0, col: '#ffb347', kind: 'weapon',
    desc: 'Serious ordnance in a serious box. Eats hold space.',
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

/**
 * Which crate a weapon ships in. Better gun → bigger box, so carrying a
 * spare heavy laser costs you a corner of the hold, not a line in a list.
 */
function cargoCrateForWeapon(defKey) {
  const cost = (typeof WEAPON_DEFS !== 'undefined' && WEAPON_DEFS[defKey]?.cost) || 0;
  if (cost <= 50) return 'gun_crate_s';
  if (cost <= 75) return 'gun_crate';
  return 'gun_crate_l';
}

/** Base rate a boxed gun is worth, by crate tier. */
const GUN_CRATE_VALUE = { gun_crate_s: 40, gun_crate: 55, gun_crate_l: 75 };

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
    // Stacks carry a COUNT. A rack of 10 missiles and a rack of 1 are
    // the same three cells — the number is what you actually spend.
    this.qty    = this.def.stackMax ? (this.def.stackMax) : 1;
  }

  get isStack()  { return !!this.def.stackMax; }
  get stackMax() { return this.def.stackMax ?? 1; }
  get room()     { return Math.max(0, this.stackMax - this.qty); }

  get mask()  { return rotateMask(cargoMask(this.defKey), this.rot); }
  get w()     { return this.mask[0].length; }
  get h()     { return this.mask.length; }
  get label() { return this.def.label; }

  /** Sell price, before any port modifier. */
  value(portType = 'general') {
    let v = this.isStack ? (this.def.unitValue ?? 1) * this.qty : (this.def.value ?? 0);
    if (this.def.kind === 'weapon') {
      const w = (typeof WEAPON_DEFS !== 'undefined' && this.meta) ? WEAPON_DEFS[this.meta] : null;
      v = w?.cost ? Math.round(w.cost * 0.6) : (GUN_CRATE_VALUE[this.defKey] ?? 55);
    }
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
             meta: this.meta, damaged: this.damaged, qty: this.qty };
  }

  static deserialise(d) {
    const it = new CargoItem(d.defKey, d.meta ?? null);
    it.x = d.x ?? 0; it.y = d.y ?? 0; it.rot = d.rot ?? 0;
    it.damaged = !!d.damaged;
    // A save written before stacks existed has no qty — a full stack is
    // the right reading of "one of these".
    if (d.qty != null) it.qty = Utils.clamp(d.qty, 0, it.stackMax);
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
  add(defKey, meta = null, qty = null) {
    const it = new CargoItem(defKey, meta);
    if (qty != null) it.qty = Utils.clamp(qty, 0, it.stackMax);
    return this.autoPlace(it) ? it : null;
  }

  /** Total units of a stackable kind ('missiles', 'fuel', 'heal'). */
  countOf(kind) {
    // Damaged stacks are NOT counted: takeStack() refuses to draw from
    // them, so counting them would make the HUD promise rounds the guns
    // cannot actually fire.
    return this.items.reduce(
      (n, it) => n + (it.def.kind === kind && it.isStack && !it.damaged ? it.qty : 0), 0);
  }

  /**
   * Put `qty` units of a stackable in: top up part-filled stacks first,
   * then lay down fresh ones while there is room. Returns how many units
   * did NOT fit — the hold is a real constraint, so this can be > 0.
   */
  addStack(defKey, qty) {
    let left = Math.floor(qty);
    if (left <= 0) return 0;
    const def = CARGO_ITEMS[defKey];
    if (!def || !def.stackMax) return left;

    for (const it of this.items) {
      if (left <= 0) break;
      if (it.defKey !== defKey || it.damaged) continue;
      const put = Math.min(it.room, left);
      it.qty += put; left -= put;
    }
    while (left > 0) {
      const it = new CargoItem(defKey);
      it.qty = Math.min(def.stackMax, left);
      if (!this.autoPlace(it)) break;      // out of space
      left -= it.qty;
    }
    return left;
  }

  /**
   * Can `src` be poured into `dst`? Same kind of container, both stacks,
   * and the target not already full.
   */
  static canMerge(src, dst) {
    return !!src && !!dst && src !== dst
        && src.isStack && dst.isStack
        && src.defKey === dst.defKey
        && !src.damaged && !dst.damaged
        && dst.room > 0 && src.qty > 0;
  }

  /**
   * Pour `src` into `dst` up to the target's capacity.
   * Returns how many units moved; the caller decides what to do with a
   * source that is now empty.
   */
  static merge(src, dst) {
    if (!CargoGrid.canMerge(src, dst)) return 0;
    const moved = Math.min(dst.room, src.qty);
    dst.qty += moved;
    src.qty -= moved;
    return moved;
  }

  /** Tidy the whole grid: pour part-full stacks together where possible. */
  consolidate() {
    let moved = 0;
    // Both loops walk COPIES, so an item emptied and removed part-way
    // through is still in the list we are iterating. Without the
    // includes() guards the leftovers got poured into containers that
    // were no longer in the hold — three medkits holding 9 doses
    // consolidated into nothing at all.
    for (const dst of [...this.items]) {
      if (!dst.isStack || !this.items.includes(dst)) continue;
      for (const src of [...this.items]) {
        if (dst.room <= 0) break;
        if (!this.items.includes(src)) continue;
        if (!CargoGrid.canMerge(src, dst)) continue;
        moved += CargoGrid.merge(src, dst);
        if (src.qty <= 0) this.remove(src);
      }
    }
    return moved;
  }

  /**
   * Take `qty` units of a kind out, smallest stacks first so the hold
   * defragments itself as you spend. Returns how many were actually taken.
   */
  takeStack(kind, qty) {
    let want = Math.floor(qty), got = 0;
    const stacks = this.items
      .filter(it => it.def.kind === kind && it.isStack && !it.damaged)
      .sort((a, b) => a.qty - b.qty);
    for (const it of stacks) {
      if (want <= 0) break;
      const take = Math.min(it.qty, want);
      it.qty -= take; want -= take; got += take;
      if (it.qty <= 0) this.remove(it);
    }
    return got;
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
    ['he2_small',     20],
    ['he2_med',        9],
    ['missile_rack',  16],
    ['medkit',        13],
    ['ration_pack',   12],
    ['survey_probe',   5],
    ['plating',        9],
    ['data_core',      7],
    ['cooler_crate',   6],
    ['he2_large',      2],
    ['contraband',     3 + sector],
    ['drone_core',     2 + sector],
    ['module_crate',   2 + sector],
    ['unstable_core',  1 + sector],
    ['alien_relic',    1 + Math.floor(sector / 2)],
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
  // Deliberately lean. A wreck should be a decision about WHAT to take,
  // not a free restock — an overflowing hold made the fights pointless.
  const cols = opts.cols ?? Utils.clamp(3 + Math.floor(sector / 2), 3, 5);
  const rows = opts.rows ?? Utils.clamp(3 + Math.floor(sector / 3), 3, 4);
  const g = new CargoGrid(cols, rows);
  const tries = opts.tries ?? Utils.randInt(2, 4 + Math.floor(sector / 2));
  for (let i = 0; i < tries; i++) {
    const key = rollCargoKey(sector);
    const def = CARGO_ITEMS[key];
    // Stacks come PART FULL out of a wreck. Somebody already used some.
    const qty = def?.stackMax
      ? Utils.randInt(1, Math.max(2, Math.ceil(def.stackMax * 0.7)))
      : null;
    g.add(key, null, qty);
  }
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
  window.cargoCrateForWeapon = cargoCrateForWeapon;
}
