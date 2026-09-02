/* ============================================================
   MOON WARS — chips.js  (update49)

   THE CPU BOARD: a captain's conscience, drawn as a grid.

   Five columns by five rows. One whole column is a BLOCKED WALL, and
   where that wall stands is decided by nothing but the captain's
   karma. Everything left of it is the good side and takes Etos chips;
   everything right of it is the evil side and takes Dominacja chips;
   universal chips go on either. A saint has four columns of Etos and
   nowhere to put a Dominacja chip; a butcher has the mirror image of
   that; and the man in the middle, where every captain starts, has two
   columns each and cannot fit a level III bar on either side.

   That is the whole point, and it is why karma is not a damage
   modifier: what your captain has done changes WHAT FITS, not how hard
   he hits. Move far enough in either direction and the chips you
   already own on the losing side stay exactly where they are and stop
   working — crossed out, not deleted. Come back and they light up
   again.

   THREE RULES THAT KEEP THIS HONEST

     1. A CHIP IS AN ITEM. It is a CargoItem in a CargoGrid, exactly
        like a gun crate or a ration pack, and the board is a third
        grid beside the shelf and the hold. It is on the shelf OR in
        the hold OR on the board — never in two places. There is no
        separate register of "installed upgrades"; that mistake cost
        this project three warehouses for one shelf in update35.

     2. INERT IS COMPUTED, NEVER STORED. Whether a chip works is read
        from the karma of the moment. A stored `active` flag would be
        a second copy of the karma, and the two would drift the first
        time a contract moved the needle.

     3. THE BOARD IS THE ONLY SOURCE OF ITS BONUSES. Nothing caches a
        total. `Chips.bonus()` walks the grid every time it is asked,
        which is cheap and cannot go stale — the alternative is a
        cached number that survives a re-render and doubles.
   ============================================================ */

'use strict';

/* ── The twelve ───────────────────────────────────────────────
 * `v` is the value at levels I, II, III, IV. `cap` is the ceiling on
 * what CHIPS may contribute to that effect — duplicates add up until
 * they hit it. The captain's corporation bonus is added separately
 * and is NOT bounded by this cap (spec §7).
 */
const CHIP_FAMILIES = {
  etos:      { label: 'Etos',        col: '#4dd8c0', side: 'good' },
  dominacja: { label: 'Dominacja',   col: '#ff9a4d', side: 'evil' },
  uni:       { label: 'Uniwersalne', col: '#b8c4d4', side: 'any'  },
};

const CHIP_DEFS = {
  // ── Etos — the good side ──
  life_reserve: {
    family: 'etos', label: 'Rezerwa życia', effect: 'hp',
    v: [0.02, 0.05, 0.09, 0.14], cap: 0.25, unit: '%',
    desc: 'Maksymalne HP załogi.',
  },
  golden_hour: {
    family: 'etos', label: 'Złota godzina', effect: 'bleedout',
    v: [2, 5, 9, 14], cap: 20, unit: 's',
    desc: 'Więcej sekund na dojście do powalonego, zanim się wykrwawi.',
  },
  helping_hand: {
    family: 'etos', label: 'Pomocna dłoń', effect: 'fieldAid',
    v: [0.04, 0.09, 0.15, 0.22], cap: 0.35, unit: '%',
    desc: 'Szybciej opatrują rannego w polu. Medbay pracuje po swojemu.',
  },
  fire_control: {
    family: 'etos', label: 'Kontrola pożarów', effect: 'firefight',
    v: [0.04, 0.09, 0.15, 0.22], cap: 0.35, unit: '%',
    desc: 'Szybsze gaszenie.',
  },

  // ── Dominacja — the evil side ──
  assault_squad: {
    family: 'dominacja', label: 'Oddział szturmowy', effect: 'melee',
    v: [0.02, 0.05, 0.09, 0.14], cap: 0.25, unit: '%',
    desc: 'Obrażenia wręcz własnej załogi.',
  },
  boarding_armour: {
    family: 'dominacja', label: 'Pancerz abordażowy', effect: 'meleeResist',
    v: [0.02, 0.05, 0.09, 0.14], cap: 0.25, unit: '%',
    desc: 'Mniej obrażeń WRĘCZ. Nie chroni przed ogniem, próżnią ani pociskami.',
  },
  forced_fire: {
    family: 'dominacja', label: 'Forsowanie ognia', effect: 'weaponCharge',
    v: [0.01, 0.025, 0.045, 0.07], cap: 0.10, unit: '%',
    desc: 'Krótszy czas ładowania dział.',
  },
  extortion: {
    family: 'dominacja', label: 'Wymuszenie', effect: 'tribute',
    v: [0.04, 0.09, 0.15, 0.22], cap: 0.35, unit: '%',
    desc: 'Więcej CC z przyjętej kapitulacji. Nie zmienia szansy na nią.',
  },

  // ── Uniwersalne — either side ──
  mobility: {
    family: 'uni', label: 'Mobilność', effect: 'speed',
    v: [0.02, 0.05, 0.09, 0.14], cap: 0.25, unit: '%',
    desc: 'Szybkość ruchu załogi.',
  },
  deck_service: {
    family: 'uni', label: 'Serwis pokładowy', effect: 'repair',
    v: [0.04, 0.09, 0.15, 0.22], cap: 0.35, unit: '%',
    desc: 'Szybkość naprawy modułów.',
  },
  sealant: {
    family: 'uni', label: 'Uszczelnienie', effect: 'breach',
    v: [0.04, 0.09, 0.15, 0.22], cap: 0.35, unit: '%',
    desc: 'Szybkość łatania wyrw.',
  },
  /* THE ONE CHIP THAT IS SPENT. Every other chip stays on the board
     for good; a pod that has flown is gone. Its countdown belongs to
     update50 — here it is a real, mountable, tradeable object whose
     level already means what it will mean then. */
  escape_pod: {
    family: 'uni', label: 'Kapsuła ratunkowa', effect: 'pod',
    v: [12, 10, 8, 6], cap: null, unit: 's', lowerIsBetter: true,
    desc: 'Ewakuacja kapitana. Zużywa się po użyciu — jedyny chip, który znika.',
  },
};

/** I, II, III, IV — the label everybody reads off the chip. */
const CHIP_LEVEL_LABELS = ['I', 'II', 'III', 'IV'];

/* ── Shapes ───────────────────────────────────────────────────
 * Etos and Dominacja grow into horizontal bars: level IV is four
 * cells long and needs four clear columns on its own side, which a
 * middling captain simply does not have. Universal IV is 2x2 instead
 * — the same four cells, but it fits a narrow board and needs a
 * SECOND ROW, so it is gated on the captain's level rather than on
 * his conscience. */
function chipShape(family, level) {
  if (family === 'uni' && level === 4) return { w: 2, h: 2 };
  return { w: level, h: 1 };
}

/** The cargo-item key for one chip at one level. */
function chipItemKey(key, level) { return `chip_${key}_${level}`; }

const Chips = (() => {

  const COLS = 5, ROWS = 5;

  /* ── Geometry ───────────────────────────────────────────── */

  /**
   * Which column the karma wall stands in, 1-based from the left.
   * Every boundary in the spec's table is inclusive, and the middle
   * band is the widest on purpose: a captain starts at 50 and should
   * not be one bad decision away from his board rearranging itself.
   */
  function wallColumn(karma) {
    const k = Utils.clamp(karma ?? 50, 0, 100);
    if (k <= 14) return 1;
    if (k <= 34) return 2;
    if (k <= 65) return 3;
    if (k <= 85) return 4;
    return 5;
  }

  /** How many rows the captain's level has opened. */
  function rowsFor(level) {
    const l = Math.max(1, level ?? 1);
    if (l <= 1) return 1;
    if (l <= 3) return 2;
    if (l <= 5) return 3;
    if (l <= 7) return 4;
    return 5;
  }

  /** The level at which a given row (0-based) opens — for the UI. */
  function rowOpensAt(row) { return [1, 2, 4, 6, 8][row] ?? 8; }

  /** Chip levels are written in Roman everywhere the player sees them. */
  const ROMAN = ['—', 'I', 'II', 'III', 'IV'];
  function roman(n) { return ROMAN[n] ?? String(n); }

  /* ── The promotion ceiling (update51) ─────────────────────
   *
   * TWO different things can keep a row shut and the player must be
   * able to tell them apart, because one of them is worth waiting for
   * and the other never will be:
   *
   *   · not opened YET — his level is too low. Fly more.
   *   · WALLED — the man he promoted was not worth that row, and no
   *     amount of flying will change it. Promote someone better.
   *
   * So there are two questions here, not one, and every caller asks
   * the one it means. `openRows` is the answer for placement.
   */

  /** Rows this captain's tier will EVER allow. */
  function tierRows(cap) {
    return (typeof Captain !== 'undefined' && Captain.ceiling)
      ? Captain.ceiling(cap).maxRows
      : (cap?.maxRows ?? ROWS);
  }

  /** The highest chip level this captain's tier will EVER accept. */
  function tierChipLevel(cap) {
    return (typeof Captain !== 'undefined' && Captain.ceiling)
      ? Captain.ceiling(cap).maxChipLevel
      : (cap?.maxChipLevel ?? 4);
  }

  /** Rows actually usable now: level and tier, whichever binds first. */
  function openRows(cap) {
    return Math.min(rowsFor(cap?.level ?? 1), tierRows(cap));
  }

  /** Is this row (0-based) walled off for good by the promotion? */
  function isWalledRow(cap, row) { return row >= tierRows(cap); }

  /** Is this chip above the tier's ceiling — junk on THIS board? */
  function overChipLevel(cap, it) {
    return (it?.def?.chipLevel ?? 1) > tierChipLevel(cap);
  }

  /** Usable cells right now: 4 per open row, the wall taking the rest. */
  function usableCells(cap) { return openRows(cap) * (COLS - 1); }

  /** 'good' | 'evil' | 'wall' for a column, 0-based. */
  function sideOfColumn(x, karma) {
    const wall = wallColumn(karma) - 1;
    if (x === wall) return 'wall';
    return x < wall ? 'good' : 'evil';
  }

  /** Is this chip family allowed to sit on that side? */
  function familyFits(family, side) {
    if (side === 'wall') return false;
    const f = CHIP_FAMILIES[family];
    if (!f) return false;
    return f.side === 'any' || f.side === side;
  }

  /* ── The board itself ───────────────────────────────────── */

  /**
   * The rule a board grid enforces, as a closure over ONE captain
   * record. CargoGrid asks it before every placement; nothing else
   * knows about karma.
   */
  function ruleFor(cap) {
    return {
      cell(x, y) {
        if (y >= openRows(cap)) return false;   // not open yet, or walled for good
        return sideOfColumn(x, cap?.karma) !== 'wall';
      },
      item(it, x, y, w, h) {
        const fam = it?.def?.chipFamily;
        if (!fam) return false;                 // only chips go on a board
        if (overChipLevel(cap, it)) return false;  // above the promotion ceiling
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const side = sideOfColumn(x + dx, cap?.karma);
            if (!familyFits(fam, side)) return false;
          }
        }
        return true;
      },
    };
  }

  /**
   * The captain's board as a live CargoGrid.
   *
   * Stored on the captain record in the SAME `chips` field update43
   * reserved for it — a serialised grid, not a second list. Old
   * records hold an empty array, which deserialises to an empty
   * board, so nothing has to be migrated.
   */
  function board(cap) {
    if (!cap || typeof CargoGrid === 'undefined') return null;
    const raw = Array.isArray(cap.chips) ? null : cap.chips;
    const g = raw ? CargoGrid.deserialise(raw) : new CargoGrid(COLS, ROWS);
    g.cols = COLS; g.rows = ROWS;
    g.rule = ruleFor(cap);
    return g;
  }

  /** Write a board back to the captain record. */
  function commit(cap, grid) {
    if (!cap) return false;
    cap.chips = grid ? grid.serialise() : null;
    return true;
  }

  /* ── What is actually working ───────────────────────────── */

  /**
   * Is this chip dead where it lies?
   *
   * Computed, every time, from the karma of the moment — see rule 2
   * at the top of this file. A chip goes inert when the wall moves
   * under it or when the ground it stands on changes sides; it is
   * never moved and never destroyed, and it wakes up by itself.
   */
  function isInert(cap, it) {
    if (!it || !it.def?.chipFamily) return true;
    /* Above the promotion ceiling it is dead wherever it lies — a
       legacy record widened by Captain.ceiling never trips this. */
    if (overChipLevel(cap, it)) return true;
    const rows = openRows(cap);
    /* `mask` is an ARRAY OF ROWS of booleans — not a {w,h,cells}
       record. Reading it the other way silently walked zero cells and
       reported every chip as working, which is the worst possible
       failure here: the board would pay bonuses it does not have. */
    const m = it.mask;
    for (let dy = 0; dy < m.length; dy++) {
      for (let dx = 0; dx < m[dy].length; dx++) {
        if (!m[dy][dx]) continue;
        const x = it.x + dx, y = it.y + dy;
        if (y >= rows) return true;
        if (!familyFits(it.def.chipFamily, sideOfColumn(x, cap?.karma))) return true;
      }
    }
    return false;
  }

  /** Why it is dead, in words the player can act on. */
  function inertReason(cap, it) {
    if (!it || !isInert(cap, it)) return '';
    if (overChipLevel(cap, it)) {
      return `chip poziom ${it.def.chipLevel} — ten kapitan bierze najwyżej ${roman(tierChipLevel(cap))}`;
    }
    const m = it.mask;
    for (let dy = 0; dy < m.length; dy++) {
      for (let dx = 0; dx < m[dy].length; dx++) {
        if (!m[dy][dx]) continue;
        if (isWalledRow(cap, it.y + dy)) {
          return `rząd zamurowany — awans z ${tierRows(cap)} rzędami`;
        }
        if (it.y + dy >= rowsFor(cap?.level ?? 1)) {
          return `rząd otwiera się na poziomie ${rowOpensAt(it.y + dy)}`;
        }
        const side = sideOfColumn(it.x + dx, cap?.karma);
        if (side === 'wall') return 'leży na blokadzie karmy';
        if (!familyFits(it.def.chipFamily, side)) {
          return side === 'good' ? 'po dobrej stronie — ten chip jest z Dominacji'
                                 : 'po złej stronie — ten chip jest z Etosu';
        }
      }
    }
    return '';
  }

  /** Every chip on the board that is currently working. */
  function live(cap) {
    const g = board(cap);
    if (!g) return [];
    return g.items.filter(it => it.def?.chipFamily && !isInert(cap, it));
  }

  /**
   * What the board is worth for one effect, capped.
   *
   * Duplicates add up — a player who fills three columns with the
   * same bar gets three times the number, right up to the ceiling
   * the spec set for that effect. Nothing is cached: this walks the
   * grid on every call, which is a handful of items, and cannot go
   * stale the way a stored total does.
   */
  function bonus(cap, effect) {
    if (!cap) return 0;
    let sum = 0, ceiling = null;
    live(cap).forEach(it => {
      const def = CHIP_DEFS[it.def.chipKey];
      if (!def || def.effect !== effect) return;
      sum += def.v[(it.def.chipLevel ?? 1) - 1] ?? 0;
      ceiling = def.cap;
    });
    if (ceiling != null) sum = Math.min(sum, ceiling);
    return sum;
  }

  /**
   * The escape pod is not additive: the spec says several pods do not
   * stack into a shorter countdown, one of them fires. The best one
   * mounted and working, in seconds, or 0 for none.
   */
  function podSeconds(cap) {
    let best = 0;
    live(cap).forEach(it => {
      if (it.def.chipKey !== 'escape_pod') return;
      const secs = CHIP_DEFS.escape_pod.v[(it.def.chipLevel ?? 1) - 1];
      if (!best || secs < best) best = secs;
    });
    return best;
  }

  /** Human-readable rows for the board screen. */
  function lines(cap) {
    const out = [];
    const seen = new Map();
    live(cap).forEach(it => {
      const def = CHIP_DEFS[it.def.chipKey];
      if (!def) return;
      seen.set(def.effect, def);
    });
    seen.forEach((def, effect) => {
      const val = effect === 'pod' ? podSeconds(cap) : bonus(cap, effect);
      if (!val) return;
      const txt = def.unit === 's' ? `${val} s`
                : `+${Math.round(val * 1000) / 10}%`;
      const capped = def.cap != null && effect !== 'pod' && val >= def.cap;
      out.push([def.label, txt, capped]);
    });
    return out;
  }

  /* ── Where chips come from ──────────────────────────────
   *
   * The SECTOR is the ceiling, by the spec: sector 1 hands out level
   * I, sector 2 up to II, sector 3 up to III. Level IV is not in any
   * table at all — it exists only as a boss reward from Apophis, so
   * that the best chips in the game are a thing you beat somebody for
   * rather than a thing you eventually find.
   *
   * Within the ceiling the roll leans LOW: a level III bar is four
   * cells wide and most captains have nowhere to put it, so making it
   * common would just fill holds with cargo nobody can mount.
   */
  function maxLevelForSector(sector) {
    return Utils.clamp(Math.floor(sector ?? 1), 1, 4);
  }

  /** A random chip item key at or below the sector's ceiling. */
  function rollDrop(sector, opts = {}) {
    const top = Math.min(opts.maxLevel ?? 4, maxLevelForSector(sector));
    const low = Utils.clamp(opts.minLevel ?? 1, 1, top);
    // Weights: I is bread and butter, IV is a trophy.
    const weights = [];
    for (let l = low; l <= top; l++) weights.push([l, [10, 6, 3, 1][l - 1]]);
    const total = weights.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    let lvl = low;
    for (const [l, w] of weights) { r -= w; if (r <= 0) { lvl = l; break; } }
    const keys = Object.keys(CHIP_DEFS);
    return chipItemKey(keys[Math.floor(Math.random() * keys.length)], lvl);
  }

  return {
    COLS, ROWS, maxLevelForSector, rollDrop,
    wallColumn, rowsFor, rowOpensAt, usableCells, sideOfColumn, familyFits,
    openRows, tierRows, tierChipLevel, isWalledRow, overChipLevel, roman,
    ruleFor, board, commit,
    isInert, inertReason, live, bonus, podSeconds, lines,
    DEFS: CHIP_DEFS, FAMILIES: CHIP_FAMILIES, shape: chipShape, itemKey: chipItemKey,
  };
})();

/* Classic scripts keep top-level `const` out of window — publish, so a
   stale index.html can be spotted and the module loaded at runtime. */
/* If cargo.js already ran (a stale index.html loading us late), its
   catalogue has no chip entries yet — build them now. See
   registerChipItems() for why this is safe to call twice. */
if (typeof registerChipItems === 'function') registerChipItems();

if (typeof window !== 'undefined') {
  window.Chips = Chips;
  window.CHIP_DEFS = CHIP_DEFS;
  window.CHIP_FAMILIES = CHIP_FAMILIES;
  window.CHIP_LEVEL_LABELS = CHIP_LEVEL_LABELS;
}
