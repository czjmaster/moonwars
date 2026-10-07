/* ============================================================
   MOON WARS — chips.js  (update49; TABLETS since update99)

   THE CPU BOARD: a commander's conscience, drawn as a grid.

   update99: the chips are gone and the ancient TABLETS stand on the
   board instead (TABLET_DEFS below). Everything about the board — the
   wall, the cells, inert-not-deleted — is unchanged; read "chip" in
   the notes that follow as "whatever stands on the board". The file
   keeps its name and `Chips` its name because the load order and the
   test harness both know them by it.

   Five columns by five rows. One whole column is a BLOCKED WALL, and
   where that wall stands is decided by nothing but the commander's
   karma. Everything left of it is the good side and takes Etos chips;
   everything right of it is the evil side and takes Dominacja chips;
   universal chips go on either. A saint has four columns of Etos and
   nowhere to put a Dominacja chip; a butcher has the mirror image of
   that; and the man in the middle, where every commander starts, has two
   columns each and cannot fit a level III bar on either side.

   That is the whole point, and it is why karma is not a damage
   modifier: what your commander has done changes WHAT FITS, not how hard
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

/* ── THE ELEVEN TABLETS (update99) ────────────────────────────
 *
 * The chips are GONE. The board, its wall and its rules stay exactly as
 * update49 built them; what goes on it now are the ancient tablets of
 * jj's design (projekt-kapitan-wiedza-tabliczki, Claude Docs "Moon Wars
 * — Kapitan i Starożytne Tabliczki"). Every number below is from that
 * table — Lv1-3 are the GDD's, Lv4 is the GDD's old Lv5 — and this is
 * the ONE place they live.
 *
 * A tablet is not a passive bonus. It is USED — from the Book or the
 * quick bar on the commander bar — and every use is paid in knowledge
 * (`cost`, by the level it actually works at). Re-Atum is the one that
 * works by itself, and the one that is spent.
 *
 *   family   sumer (good side, high karma) | egypt (evil side, low
 *            karma) | neutral (either side, no karma limit)
 *   where    combat | any (combat and flight) | map (out of a fight)
 *            | asteroids (an asteroid field, package C) | passive
 *   live     whether its effect is wired yet. update99 wires one of
 *            each family (Golden Ratio, Was, ME) and Re-Atum's pod;
 *            the rest arrive with packages D and E and say so.
 *   tag      what kind of thing the legend is (jj: legend and game
 *            adaptation are two separate layers, never mixed).
 *
 * The item fields on the board keep their update49 names (`chipKey`,
 * `chipLevel`, `chipFamily`): they are what a BOARD ITEM is, and every
 * board rule reads them. Since update99 they describe a tablet.
 */
const TABLET_FAMILIES = {
  sumer:   { label: 'Sumerian', col: '#5fd8c4', side: 'good', karma: [55, 62, 70, 80] },
  egypt:   { label: 'Egyptian', col: '#e8b04a', side: 'evil', karma: [45, 38, 30, 20] },
  neutral: { label: 'Neutral',  col: '#b9a6e8', side: 'any',  karma: null },
};

const TABLET_DEFS = {
  // ── Neutral ──
  golden_ratio: {
    glyph: '\u03c6', family: 'neutral', label: 'Golden Ratio', title: 'Defensive Geometry',
    tag: 'INSPIRED (mathematics)', where: 'combat', live: true,
    cost: [5, 7, 9, 14],
    evasion: [0.05, 0.07, 0.10, 0.15], secs: [5, 6, 7, 10], shieldCharge: [0, 0, 0, 0.10],
    levels: ['+5% evasion for 5 s', '+7% evasion for 6 s', '+10% evasion for 7 s',
             '+15% evasion for 10 s and +10% shield charge'],
    legend: 'The golden ratio is real: the whole is to the larger part as the larger is to the smaller, about 1.618. Euclid called it division in extreme and mean ratio. The tablet itself is Moon Wars\' own.',
    adapt: 'A moment of optimised flight path and shield geometry. A short window, not a standing defence.',
  },
  absolute_zero: {
    glyph: '0K', family: 'neutral', label: 'Absolute Zero', title: 'Cryostasis',
    tag: 'MOON WARS FICTION (physics)', where: 'any', live: true,
    cost: [7, 9, 12, 19],
    cool: [10, 20, 30, 60], douse: [1, 2, 'room', 'all'], noIgnite: [0, 0, 0, 5],
    levels: ['-10 reactor heat, puts out 1 fire', '-20 heat, puts out 2 fires',
             '-30 heat, puts out every fire in one module',
             '-60 heat, every fire aboard, 5 s with no new fire'],
    legend: 'Absolute zero, 0 K or -273.15 °C, is the edge of thermodynamics: by the third law it cannot be reached in a finite number of steps. The tablet is fiction and does not pretend otherwise.',
    adapt: 'Emergency cooling for the reactor and a hand against fire. It does not touch gun charge.',
  },
  re_atum: {
    glyph: '\u2625', family: 'neutral', label: 'Re-Atum', title: 'The Last Chance',
    tag: 'MOON WARS FICTION (after the god Atum)', where: 'passive', live: true, oneShot: true,
    cost: [20, 22, 24, 30],
    pod: [12, 10, 8, 6],
    /* jj's rescue (update103, package F): who and what comes home when
       the ship is lost. The run ENDS (jj 07.10); the pod pays its
       Knowledge at the moment of rescue and needs it in hand. */
    crew: [0, 1, 2, Infinity], scrap: [0, 0.10, 0.25, 0.50], copy: [0, 0, 0, 1],
    levels: ['the commander comes home, 0% scrap', 'the commander + 1 crew, 10% scrap',
             'the commander + 2 crew, 25% scrap',
             'the whole living crew, 50% scrap + a copy of one of his tablets'],
    legend: 'Atum is the creator god of Heliopolis, who rose by himself out of the primeval waters of Nun and began the other gods. He was joined with Ra as Ra-Atum, the setting sun. The pod is deliberately fiction.',
    adapt: 'Passive: when the hull reaches 0 (or the pod is launched by hand) it gets the commander out, and with him as many as its level saves. Paid in Knowledge at that moment. Spent on use — the tablet leaves the board.',
  },

  // ── Egyptian — the evil side ──
  was: {
    glyph: 'W', family: 'egypt', label: 'Was Sceptre', title: 'Acoustic Destabiliser',
    tag: 'CONFIRMED ARTEFACT / SYMBOL', where: 'combat', live: true,
    cost: [8, 11, 14, 20],
    drain: [1, 2, 3, 5], secs: [10, 10, 10, 10],
    levels: ['-1 enemy reactor power for 10 s', '-2 enemy power for 10 s',
             '-3 enemy power for 10 s', '-5 enemy power for 10 s'],
    legend: 'The was is a real Egyptian sceptre: a straight shaft with a stylised animal head and a forked foot, held by gods and kings; its hieroglyph means power and dominion. Nothing says it was a tuning fork.',
    adapt: 'A resonant strike on the enemy\'s power plant. It can put out their shields, their air, or the last power in their engines — and with it their gravity.',
  },
  westcar: {
    glyph: '\u2248', family: 'egypt', label: 'Westcar Papyrus', title: 'Space Folder',
    tag: 'CONFIRMED TEXT', where: 'asteroids', live: true,
    cost: [6, 8, 10, 14],
    secs: [4, 7, 10, 16],
    levels: ['4 s safe from asteroids', '7 s', '10 s', '16 s'],
    legend: 'The Westcar Papyrus (now in Berlin) tells of wonders worked by priest-magicians at the court of Khufu. In one, Djadjaemankh folds the waters of a lake one upon the other to recover a rower\'s lost pendant.',
    adapt: 'In an asteroid field the commander folds the way: for a few seconds the rocks do no damage. Of no use anywhere else.',
  },
  horus: {
    glyph: '\u25c9', family: 'egypt', label: 'Eye of Horus', title: 'Quantum Scanner',
    tag: 'CONFIRMED ARTEFACT / SYMBOL', where: 'combat', live: true,
    cost: [5, 7, 9, 13],
    secs: [5, 6, 7, 15],
    levels: ['strips the enemy cloak for 5 s', '+ where their guns aim, 6 s',
             '+ how charged their guns are, 7 s', 'all of it for 15 s'],
    legend: 'The wedjat is the eye of Horus, wounded fighting Set and healed. It stands for protection, healing and wholeness; its amulets are among the commonest in Egypt. The scanner is science fiction.',
    adapt: 'Strips the enemy\'s cloak and shows which modules his guns are aimed at — and, higher, how charged they are.',
  },
  djed: {
    glyph: '\u2021', family: 'egypt', label: 'Djed Pillar', title: 'Resonance of Stability',
    tag: 'CONFIRMED ARTEFACT / SYMBOL', where: 'any', live: true,
    cost: [8, 11, 14, 20],
    power: [1, 2, 3, 5], heat: [10, 15, 20, 30], secs: [12, 12, 12, 12],
    levels: ['+1 power for 12 s, +10% reactor heat', '+2 power, +15% heat',
             '+3 power, +20% heat', '+5 power, +30% heat'],
    legend: 'The djed is the Egyptian sign of endurance and stability, later read as the backbone of Osiris; "raising the djed" celebrated his rebirth. Nothing supports calling it a generator.',
    adapt: 'A risky overload: extra reactor power for 12 s, paid for in heat at once. It can save the systems — or tip a hot core over.',
  },

  // ── Sumerian — the good side ──
  destinies: {
    glyph: '\u2736', family: 'sumer', label: 'Tablet of Destinies', title: 'Fate Shift',
    tag: 'MYTHOLOGICAL MOTIF', where: 'combat', live: true,
    cost: [8, 11, 14, 20],
    secs: [3, 5, 7, 12],
    levels: ['missiles and torpedoes pass through for 3 s', '5 s', '7 s', '12 s'],
    legend: 'In Mesopotamian literature whoever holds the Tablet of Destinies decrees fate. Anzu steals it from Enlil; in Enuma Elish Tiamat gives it to Kingu and Marduk takes it. It is not a found object.',
    adapt: 'For a moment missiles and torpedoes pass through the ship harmlessly. Lasers still hit.',
  },
  cone: {
    glyph: '\u25bc', family: 'sumer', label: 'Foundation Cone', title: 'Resonance Anchor',
    tag: 'CONFIRMED ARTEFACT, FICTIONAL USE', where: 'combat', live: true,
    cost: [6, 8, 10, 14],
    secs: [5, 8, 11, 18],
    levels: ['the enemy cannot jump away for 5 s', '8 s', '11 s', '18 s'],
    legend: 'Clay foundation cones are real Mesopotamian finds, driven into temple walls; their cuneiform says who built for which god — the rulers of Lagash among them. They were not acoustic tubes.',
    adapt: 'An anchored foundation becomes an anchor in space: the enemy cannot escape by jumping.',
  },
  me: {
    glyph: 'ME', family: 'sumer', label: 'ME', title: 'Decree of Knowledge and Craft',
    tag: 'MYTHOLOGICAL MOTIF / INSPIRED', where: 'any', live: true,
    cost: [7, 9, 12, 18],
    heal: [25, 40, 55, Infinity],
    levels: ['+25 HP to the whole crew', '+40 HP', '+55 HP and one repair level on life support',
             'full heal and one repair level on the worst-hit module'],
    legend: 'The Sumerian me are the divine powers civilisation stands on: kingship, the crafts, writing, law. Inanna gets Enki drunk and carries the me from Eridu to Uruk. There is no "ME disc".',
    adapt: 'A recorded package of medical and engineering knowledge: heals the crew, and higher up mends. It does not clear every fault.',
  },
  va243: {
    glyph: '\u2727', family: 'sumer', label: 'VA 243 Seal', title: 'Anomaly Map',
    tag: 'CONFIRMED ARTEFACT; "solar system map" UNCONFIRMED', where: 'map', live: true,
    cost: [5, 7, 9, 13],
    /* Each hidden node of the sector map, rolled once (update102). At
       least one always shows — a use never comes back empty-handed. */
    chance: [0.2, 0.4, 0.6, 1],
    levels: ['20% chance to reveal each hidden node', '40%', '60%', '100%'],
    legend: 'VA 243 is a real Akkadian cylinder seal in Berlin\'s Vorderasiatisches Museum. The popular claim that its star and dots are the solar system with Nibiru is not accepted by scholars: it is an ordinary star motif.',
    adapt: 'The seal\'s pattern as a navigation key: out of a fight it reveals the contract map\'s hidden nodes, if there are any.',
  },
};

/** I, II, III, IV — the label everybody reads off a tablet. */
const TABLET_LEVEL_LABELS = ['I', 'II', 'III', 'IV'];

/* ── Shapes ───────────────────────────────────────────────────
 * A tablet takes as many cells as its level, in a bar — level IV needs
 * four clear columns on its own side, which a middling commander does
 * not have. A neutral IV is 2x2 instead: the same four cells, but it
 * fits a narrow board and needs a SECOND ROW. (update49's rule, kept.) */
function tabletShape(family, level) {
  if (family === 'neutral' && level === 4) return { w: 2, h: 2 };
  return { w: level, h: 1 };
}

/** The cargo-item key for one tablet at one level. */
function tabletItemKey(key, level) { return `tablet_${key}_${level}`; }

/* Where tablets come from (jj 06.10): crates from wrecks and pirates,
   SOMETIMES, by sector — 1 → Lv1, 2 → Lv1-2, 3 → Lv3. Bosses pay their
   own: the first Lv1-2, Apophis Lv3-4 (game.js `_payBossChip`). */
const TABLET_SECTOR_LEVELS = { 1: [1, 1], 2: [1, 2], 3: [3, 3] };
const TABLET_DROP = { wreck: 0.20, salvage: 0.15 };

const Chips = (() => {

  const COLS = 5, ROWS = 5;

  /* ── Geometry ───────────────────────────────────────────── */

  /**
   * Which column the karma wall stands in, 1-based from the left.
   * Every boundary in the spec's table is inclusive, and the middle
   * band is the widest on purpose: a commander starts at 50 and should
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

  /* ── ONE CELL PER LEVEL (update52) ────────────────────────
   *
   * The board is 5x5 and the commander ladder is 24 levels plus the
   * rank he was promoted at: 25 cells, 25 steps, exactly. A level
   * opens the NEXT cell in reading order — left to right along the
   * top row first, which is the good side, then down. Five levels is
   * one full row.
   *
   * update51's promotion tiers (maxRows / maxChipLevel) are GONE.
   * They were a second ceiling on top of the level, and now that the
   * level IS the ceiling, keeping both would be two registers for one
   * number — which in this project always ends the same way. A record
   * saved with those fields simply ignores them.
   */

  /** How many cells this commander's level has opened. */
  function cellsFor(level) {
    return Utils.clamp(Math.round(level ?? 0), 0, COLS * ROWS);
  }

  /** The reading-order index of a cell — the order they open in. */
  function cellIndex(x, y) { return y * COLS + x; }

  /** Has this commander's level reached the cell at x,y? */
  function cellOpen(cap, x, y) {
    return cellIndex(x, y) < cellsFor(cap?.level ?? 0);
  }

  /** The level at which a given cell opens — for the UI. */
  function cellOpensAt(x, y) { return cellIndex(x, y) + 1; }

  /** How many WHOLE rows are open, for the cards that quote a row count. */
  function openRows(cap) { return Math.floor(cellsFor(cap?.level ?? 0) / COLS); }

  /** Chip levels are written in Roman everywhere the player sees them. */
  const ROMAN = ['\u2014', 'I', 'II', 'III', 'IV'];
  function roman(n) { return ROMAN[n] ?? String(n); }

  /** Cells that are open AND not under the karma wall — what he can
   *  actually build on today. */
  function usableCells(cap) {
    let n = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (cellOpen(cap, x, y) && sideOfColumn(x, cap?.karma) !== 'wall') n++;
      }
    }
    return n;
  }

  /** 'good' | 'evil' | 'wall' for a column, 0-based. */
  function sideOfColumn(x, karma) {
    const wall = wallColumn(karma) - 1;
    if (x === wall) return 'wall';
    return x < wall ? 'good' : 'evil';
  }

  /** Is this chip family allowed to sit on that side? */
  function familyFits(family, side) {
    if (side === 'wall') return false;
    const f = TABLET_FAMILIES[family];
    if (!f) return false;
    return f.side === 'any' || f.side === side;
  }

  /* ── The board itself ───────────────────────────────────── */

  /**
   * The rule a board grid enforces, as a closure over ONE commander
   * record. CargoGrid asks it before every placement; nothing else
   * knows about karma.
   */
  function ruleFor(cap) {
    return {
      cell(x, y) {
        if (!cellOpen(cap, x, y)) return false;   // his level has not reached it
        return sideOfColumn(x, cap?.karma) !== 'wall';
      },
      item(it, x, y, w, h) {
        const fam = it?.def?.chipFamily;
        if (!fam) return false;                 // only tablets go on a board
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
   * The commander's board as a live CargoGrid.
   *
   * Stored on the commander record in the SAME `chips` field update43
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

  /** Write a board back to the commander record. */
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
    /* `mask` is an ARRAY OF ROWS of booleans — not a {w,h,cells}
       record. Reading it the other way silently walked zero cells and
       reported every chip as working, which is the worst possible
       failure here: the board would pay bonuses it does not have. */
    const m = it.mask;
    for (let dy = 0; dy < m.length; dy++) {
      for (let dx = 0; dx < m[dy].length; dx++) {
        if (!m[dy][dx]) continue;
        const x = it.x + dx, y = it.y + dy;
        if (!cellOpen(cap, x, y)) return true;
        if (!familyFits(it.def.chipFamily, sideOfColumn(x, cap?.karma))) return true;
      }
    }
    return false;
  }

  /** Why it is dead, in words the player can act on. */
  function inertReason(cap, it) {
    if (!it || !isInert(cap, it)) return '';
    const m = it.mask;
    for (let dy = 0; dy < m.length; dy++) {
      for (let dx = 0; dx < m[dy].length; dx++) {
        if (!m[dy][dx]) continue;
        const x = it.x + dx, y = it.y + dy;
        if (!cellOpen(cap, x, y)) {
          return `cell opens at commander level ${cellOpensAt(x, y)}`;
        }
        const side = sideOfColumn(x, cap?.karma);
        if (side === 'wall') return 'sitting on the karma wall';
        if (!familyFits(it.def.chipFamily, side)) {
          return side === 'good' ? 'good side — this is an Egyptian tablet'
                                 : 'evil side — this is a Sumerian tablet';
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

  /* ── WHAT A TABLET IS WORTH TO THIS COMMANDER (update99) ──────
   *
   * jj: the level a tablet WORKS at is the lowest of three — the tablet
   * itself, what his INTELLIGENCE can read, and what his karma allows
   * its family. A strong tablet found too early waits for the man.
   * Neutral tablets ignore karma (they have no side).
   */

  /** The highest level this family works at for a karma reading. */
  function karmaCap(family, karma) {
    const f = TABLET_FAMILIES[family];
    if (!f) return 0;
    if (!f.karma) return 4;
    const k = Utils.clamp(karma ?? 50, 0, 100);
    return f.side === 'good' ? f.karma.filter(t => k >= t).length
                             : f.karma.filter(t => k <= t).length;
  }

  /** The highest level his mind reads — Commander.tabletCap, INT 1-2 → I … */
  function intCap(cap) {
    return (typeof Commander !== 'undefined' && Commander.tabletCap) ? Commander.tabletCap(cap) : 4;
  }

  /** The level one board item actually works at; 0 when it does not. */
  function itemLevel(cap, it) {
    if (!it || !it.def?.chipFamily || isInert(cap, it)) return 0;
    return Math.min(it.def.chipLevel ?? 1, intCap(cap), karmaCap(it.def.chipFamily, cap?.karma));
  }

  /**
   * HIS TABLETS, one entry per KIND (two Was sceptres are one Was — the
   * better one is the one that answers). Every mounted tablet is here,
   * working or not, because the Book has to say WHY one is dark.
   *   { key, def, item, level (item's), eff (works at), why }
   */
  function tablets(cap) {
    const g = board(cap);
    if (!g) return [];
    const by = new Map();
    g.items.forEach(it => {
      const key = it.def?.chipKey;
      const def = TABLET_DEFS[key];
      if (!def) return;
      const eff = itemLevel(cap, it);
      const was = by.get(key);
      if (!was || eff > was.eff || (eff === was.eff && (it.def.chipLevel ?? 1) > was.level)) {
        by.set(key, { key, def, item: it, level: it.def.chipLevel ?? 1, eff });
      }
    });
    return Object.keys(TABLET_DEFS).filter(k => by.has(k)).map(k => {
      const t = by.get(k);
      t.why = t.eff > 0 ? '' : darkReason(cap, t.item);
      return t;
    });
  }

  /** Why a mounted tablet works at nothing, in words he can act on. */
  function darkReason(cap, it) {
    if (isInert(cap, it)) return inertReason(cap, it);
    if (intCap(cap) <= 0) return 'his INTELLIGENCE reads no tablets yet (needs 1)';
    const f = TABLET_FAMILIES[it.def.chipFamily];
    if (f?.karma && karmaCap(it.def.chipFamily, cap?.karma) <= 0) {
      return f.side === 'good' ? `karma too low (needs ${f.karma[0]}+)`
                               : `karma too high (needs ${f.karma[0]} or less)`;
    }
    return '';
  }

  /** What the level it works at is capped by, for the Book ("Lv III → II (INT 4)"). */
  function capNote(cap, t) {
    if (!t || t.eff >= t.level || t.eff <= 0) return '';
    if (intCap(cap) === t.eff) return `INT ${Commander?.attr?.(cap, 'intelligence') ?? 0}`;
    return `karma ${Math.round(cap?.karma ?? 50)}`;
  }

  /** Knowledge one use costs at the level it works at. */
  function costOf(key, eff) {
    const d = TABLET_DEFS[key];
    return d && eff > 0 ? d.cost[eff - 1] : 0;
  }

  /* ── IN USE (update99) ───────────────────────────────────────
   * Seconds left on each RUNNING tablet, by key, the way Commander keeps
   * running orders. What one effect is worth right now is answered in
   * ONE place (`runningValue`) by looking at what is running. Cleared at
   * the start of every fight (`resetRunning`, beside resetOrders).
   */
  let _run = {};                  // key -> { t, lvl, ship? }

  function running(key) { return !!_run[key]; }
  /** The level a running tablet works at, 0 when it is not running. */
  function runningLevel(key) { return _run[key]?.lvl ?? 0; }
  function runningLeft(key) { return _run[key]?.t ?? 0; }

  /** What running tablets pay into one effect ('evasion', 'shieldCharge'). */
  function runningValue(effect) {
    let v = 0;
    Object.entries(_run).forEach(([k, r]) => {
      const arr = TABLET_DEFS[k]?.[effect];
      if (Array.isArray(arr)) v = Math.max(v, arr[r.lvl - 1] ?? 0);
    });
    return v;
  }

  function _end(key) {
    const r = _run[key];
    if (!r) return;
    /* The Was drain lives on THEIR reactor and must come off with the
       clock — a drain left behind is a nebula nobody can see. */
    if (key === 'was' && r.ship?.reactor) r.ship.reactor.drain = 0;
    // …and the Djed's extra units come off OUR core the same way (update101).
    if (key === 'djed' && r.ship?.reactor) r.ship.reactor.boost = 0;
    delete _run[key];
  }

  function tick(dt) {
    Object.keys(_run).forEach(k => {
      _run[k].t -= dt;
      if (_run[k].t <= 0) _end(k);
    });
  }

  function resetRunning() { Object.keys(_run).forEach(_end); _run = {}; }

  /**
   * WHY THIS TABLET CANNOT BE USED, or null when it can. THE ONE rule,
   * asked by the click (game.js) and by every button that greys itself
   * out — the Book, the quick bar. `where` is 'combat' or 'map'.
   */
  function useRefusal(cap, key, where = 'combat') {
    const def = TABLET_DEFS[key];
    if (!def) return 'No such tablet.';
    if (!cap) return 'No commander in the chair.';
    const t = tablets(cap).find(x => x.key === key);
    if (!t) return `${def.label} — not on his CPU board.`;
    if (t.eff <= 0) return `${def.label} — dark: ${t.why}.`;
    if (def.where === 'passive') return `${def.label} works by itself — it is not used by hand.`;
    if (!def.live) return `${def.label} — its power arrives with package ${def.pkg} (not wired yet).`;
    if (def.where === 'combat' && where !== 'combat') return `${def.label} — only in a fight.`;
    if (def.where === 'map' && where !== 'map') return `${def.label} — only out of a fight.`;
    /* Westcar folds the way through an ASTEROID FIELD — in a fight among
       the rocks and nowhere else (update101; the field is package C). */
    if (def.where === 'asteroids'
        && !(where === 'combat' && typeof CombatManager !== 'undefined' && CombatManager.asteroids)) {
      return `${def.label} — only in an asteroid field.`;
    }
    if (running(key)) return `${def.label} — already working (${Math.ceil(runningLeft(key))} s).`;
    const cost = costOf(key, t.eff);
    const have = (typeof Commander !== 'undefined') ? Commander.knowledge(cap) : 0;
    if (have < cost) return `${def.label} — not enough knowledge (${cost} needed, ${Math.floor(have)} left).`;
    return null;
  }

  /**
   * PAY FOR A USE and start its clock. game.js calls this only once the
   * effect had something to do, so a refused use costs nothing — the
   * rule the orders have. Returns the level it worked at, or 0.
   */
  function markUsed(cap, key, opts = {}) {
    const t = tablets(cap).find(x => x.key === key);
    if (!t || t.eff <= 0) return 0;
    if (typeof Commander !== 'undefined'
        && !Commander.spendKnowledge(cap, costOf(key, t.eff))) return 0;
    const secs = TABLET_DEFS[key].secs;
    if (Array.isArray(secs)) _run[key] = { t: secs[t.eff - 1], lvl: t.eff, ship: opts.ship || null };
    return t.eff;
  }

  /* ── THE QUICK BAR (update99) ────────────────────────────────
   * Up to four tablets on the commander bar, by KIND. Chosen in the Book
   * (right click); until he chooses, the first four he can use by hand.
   */
  const QUICK_MAX = 4;
  function quick(cap) {
    const mine = tablets(cap).filter(t => t.def.where !== 'passive');
    if (Array.isArray(cap?.quick)) {
      return cap.quick.map(k => mine.find(t => t.key === k)).filter(Boolean).slice(0, QUICK_MAX);
    }
    // Until he chooses: the ones that WORK first, in the table's order.
    return mine.filter(t => t.eff > 0).concat(mine.filter(t => t.eff <= 0)).slice(0, QUICK_MAX);
  }
  /** Put a tablet on the bar or take it off. Returns true when it is on. */
  function toggleQuick(cap, key) {
    if (!cap || !TABLET_DEFS[key] || TABLET_DEFS[key].where === 'passive') return false;
    const now = quick(cap).map(t => t.key);
    const i = now.indexOf(key);
    if (i >= 0) now.splice(i, 1);
    else if (now.length < QUICK_MAX) now.push(key);
    else return false;
    cap.quick = now;
    return now.includes(key);
  }

  /**
   * RE-ATUM'S POD (update99, the escape pod's countdown carried over —
   * package F gives it jj's full rescue). The best working one, in
   * seconds, or 0 for none. Several do not stack: one of them fires.
   */
  function podSeconds(cap) {
    const t = tablets(cap).find(x => x.key === 're_atum');
    return (t && t.eff > 0) ? TABLET_DEFS.re_atum.pod[t.eff - 1] : 0;
  }

  /**
   * CAN RE-ATUM SAVE HIM NOW? (update103) null when it can, else why
   * not. It needs a working tablet AND its Knowledge in hand — the
   * pod pays at the moment of rescue (jj's card).
   */
  function rescueRefusal(cap) {
    if (!cap) return 'No commander in the chair.';
    const t = tablets(cap).find(x => x.key === 're_atum');
    if (!t) return 'Re-Atum is not on his CPU board.';
    if (t.eff <= 0) return `Re-Atum is dark: ${t.why}.`;
    const cost = costOf('re_atum', t.eff);
    const have = (typeof Commander !== 'undefined') ? Commander.knowledge(cap) : 0;
    if (have < cost) return `Re-Atum needs ${cost} knowledge (${Math.floor(have)} left).`;
    return null;
  }
  /** The level the rescue works at (0 = none). */
  function rescueLevel(cap) {
    const t = tablets(cap).find(x => x.key === 're_atum');
    return (t && t.eff > 0) ? t.eff : 0;
  }

  /* ── Where tablets come from ──────────────────────────────── */
  function levelsForSector(sector) {
    const s = Utils.clamp(Math.floor(sector ?? 1), 1, 3);
    return TABLET_SECTOR_LEVELS[s];
  }
  function maxLevelForSector(sector) { return levelsForSector(sector)[1]; }

  /** A random tablet item key: the sector's band, or opts.min/maxLevel. */
  function rollDrop(sector, opts = {}) {
    const [lo, hi] = levelsForSector(sector);
    const low = Utils.clamp(opts.minLevel ?? lo, 1, 4);
    const top = Utils.clamp(opts.maxLevel ?? hi, low, 4);
    const lvl = Utils.randIn ? Utils.randIn(low, top) : low;
    const keys = Object.keys(TABLET_DEFS);
    return tabletItemKey(keys[Math.floor(Math.random() * keys.length)], lvl);
  }

  return {
    COLS, ROWS, maxLevelForSector, levelsForSector, rollDrop,
    wallColumn, usableCells, sideOfColumn, familyFits, roman,
    cellsFor, cellIndex, cellOpen, cellOpensAt, openRows,
    ruleFor, board, commit,
    isInert, inertReason, live, podSeconds,
    karmaCap, intCap, itemLevel, tablets, darkReason, capNote, costOf, rescueRefusal, rescueLevel,
    useRefusal, markUsed, running, runningLevel, runningLeft, runningValue, tick, resetRunning,
    quick, toggleQuick, QUICK_MAX,
    /* The Book's state (update99): open, and which tab. Here rather than
       in game.js so a test can open it — Game's export is fixed. */
    book: { open: false, tab: 'all' },
    DEFS: TABLET_DEFS, FAMILIES: TABLET_FAMILIES, shape: tabletShape, itemKey: tabletItemKey,
    DROP: TABLET_DROP, SECTOR_LEVELS: TABLET_SECTOR_LEVELS,
  };
})();

/* Classic scripts keep top-level `const` out of window — publish, so a
   stale index.html can be spotted and the module loaded at runtime. */
/* If cargo.js already ran (a stale index.html loading us late), its
   catalogue has no chip entries yet — build them now. See
   registerChipItems() for why this is safe to call twice. */
if (typeof registerTabletItems === 'function') registerTabletItems();

if (typeof window !== 'undefined') {
  window.Chips = Chips;
  window.TABLET_DEFS = TABLET_DEFS;
  window.TABLET_FAMILIES = TABLET_FAMILIES;
  window.TABLET_LEVEL_LABELS = TABLET_LEVEL_LABELS;
}
