/* ============================================================
   MOON WARS — map.js
   Sector map: node graph generation, path selection,
   event types, and FTL-style branching layout.
   ============================================================ */

'use strict';

// ── Node types ────────────────────────────────────────────

const NODE_TYPES = {
  combat:   { label: 'Enemy',    color: '#ff2d44', icon: '⚔',  weight: 5 },
  elite:    { label: 'Elite',    color: '#ff7c20', icon: '⚔⚔', weight: 0 },   // only the contract boss is elite now
  store:    { label: 'Station',  color: '#ffd700', icon: '⬡',  weight: 1 },
  event:    { label: 'Event',    color: '#4db8ff', icon: '?',   weight: 5 },
  nebula:   { label: 'Nebula',   color: '#cc44ff', icon: '☁',  weight: 1 },
  empty:    { label: 'Clear',    color: '#2a4060', icon: '·',   weight: 1 },
  exit:     { label: 'Exit',     color: '#1aff8c', icon: '▶',  weight: 0 },
  boss:     { label: 'BOSS',     color: '#ff2d44', icon: '☠',  weight: 0 },
};

// ── Random events ─────────────────────────────────────────

const EVENTS = [
  {
    id: 'abandoned_ship',
    title: 'Derelict Ship',
    text: 'A derelict vessel drifts ahead. No life signs on sensors, but the '
        + 'hold hatch is still sealed — whatever she was carrying is in there.',
    choices: [
      { label: 'Dock and strip the hold', result: { dockWreck: true, seconds: 55 } },
      { label: 'Ignore',                  result: {} },
    ],
  },
  {
    id: 'frozen_freighter',
    title: 'Frozen Freighter',
    text: 'Her reactor died years ago and she is cold through. The cargo '
        + 'survived the freeze; the docking clamps may not.',
    choices: [
      { label: 'Dock — take your time', result: { dockWreck: true, seconds: 70 } },
      { label: 'Too risky',             result: {} },
    ],
  },
  {
    id: 'mining_barge',
    title: 'Gutted Mining Barge',
    text: 'Someone got here first and left in a hurry. Half the hold is still '
        + 'racked — and their reactor is venting into the bay.',
    choices: [
      { label: 'Dock — and be quick about it',
        result: { dockWreck: true, seconds: 34, hazard: true } },
      { label: 'Leave it', result: {} },
    ],
  },
  {
    id: 'quarantined_hauler',
    title: 'Quarantined Hauler',
    text: 'QUARANTINE beacons on every channel, no explanation, no crew on '
        + 'sensors. The manifest lists science cargo.',
    choices: [
      { label: 'Break the seal and dock',
        result: { dockWreck: true, seconds: 45, rich: true } },
      { label: 'Respect the quarantine', result: {} },
    ],
  },
  {
    id: 'distress_signal',
    title: 'Distress Signal',
    text: 'A civilian ship is under attack.',
    choices: [
      { label: 'Rescue',   result: { scrap: [5,15], crew: 1 } },
      { label: 'Pass by',  result: { scrap: [0,5] } },
    ],
  },
  {
    id: 'nebula_anomaly',
    title: 'Energy Anomaly',
    text: 'A pulsing energy field. Sensors can\'t explain it.',
    choices: [
      { label: 'Investigate', result: { scrap: [0,20], system_damage: 0.3 } },
      { label: 'Avoid',       result: {} },
    ],
  },
  {
    id: 'rebel_patrol',
    title: 'Rebel Patrol',
    text: 'A rebel patrol hails you. Pay a toll or fight.',
    choices: [
      { label: 'Pay',   result: { scrap: [-20,-10] } },
      { label: 'Fight', result: { combat: 'easy' } },
    ],
  },
  {
    id: 'fuel_cache',
    title: 'He2 Cache',
    text: 'Sensors detect a hidden He2 depot.',
    choices: [
      { label: 'Collect', result: { fuel: [1,3] } },
    ],
  },
  {
    id: 'missile_cache',
    title: 'Supply Cache',
    text: 'A supply pod tumbles in the debris field.',
    choices: [
      { label: 'Retrieve', result: { missiles: [3,6] } },
      { label: 'Leave it', result: {} },
    ],
  },
  {
    id: 'med_bay_upgrade',
    title: 'Field Medic',
    text: 'A wandering medic offers to upgrade your med bay.',
    // Only offered to a ship that HAS one — see eventFits().
    requires: 'medbay',
    choices: [
      { label: 'Accept (25 CC)', result: { cost: 25, system_upgrade: 'medbay' } },
      { label: 'Decline',           result: {} },
    ],
  },
  {
    id: 'shield_tuner',
    title: 'Shield Tuner',
    text: 'A tender matches your course. Her engineer says she can '
        + 're-phase your emitters — for a price, and while you wait.',
    requires: 'shields',
    choices: [
      { label: 'Let her aboard (30 CC)', result: { cost: 30, system_upgrade: 'shields' } },
      { label: 'Wave her off',            result: {} },
    ],
  },
  {
    id: 'drive_rebuild',
    title: 'Drive Rebuild',
    text: 'A yard tug offers a field rebuild of your main drive. She has '
        + 'the parts; you have the CC.',
    requires: 'engines',
    choices: [
      { label: 'Take the offer (30 CC)', result: { cost: 30, system_upgrade: 'engines' } },
      { label: 'Decline',                 result: {} },
    ],
  },
];

/**
 * Can this event be OFFERED to this ship?
 *
 * An event that upgrades a module is worthless — and reads as a bug —
 * to a hull that does not carry that module. The player kept being
 * offered a med-bay refit with no med bay aboard. Anything with a
 * `requires`, or with a `system_upgrade` in one of its outcomes, is
 * checked against the ship before it is ever shown.
 */
function eventFits(ev, ship) {
  if (!ev) return false;
  const need = ev.requires
            ?? ev.choices?.map(c => c.result?.system_upgrade).find(Boolean)
            ?? null;
  if (!need) return true;
  return !!(ship && typeof ship.getSystem === 'function' && ship.getSystem(need));
}

/** An event this ship can actually be offered. `rng` is optional. */
function pickEventFor(ship, rng = null) {
  const pool = EVENTS.filter(e => eventFits(e, ship));
  // Never return nothing: the unconditional events are always valid.
  const list = pool.length ? pool : EVENTS.filter(e => !e.requires);
  if (!list.length) return null;
  const i = rng ? Math.floor(rng() * list.length)
                : Math.floor(Math.random() * list.length);
  return list[Math.min(i, list.length - 1)];
}

// ── Map node ──────────────────────────────────────────────

class MapNode {
  constructor(cfg) {
    this.id      = cfg.id;
    this.type    = cfg.type;
    this.x       = cfg.x;       // map canvas position
    this.y       = cfg.y;
    this.visited = false;
    this.locked  = cfg.locked ?? true;  // reachable?
    this.sector  = cfg.sector ?? 1;
    this.row     = cfg.row ?? 1;   // 0=top lane, 1=middle, 2=bottom
    this.col     = cfg.col ?? 0;
    this.event   = cfg.event ?? null;
    this.next    = [];   // ids of next nodes
    this.prev    = [];   // ids of previous nodes

    // For boss node
    this.isBoss  = cfg.type === 'boss';
    // For exit node
    this.isExit  = cfg.type === 'exit';
  }

  get def() { return NODE_TYPES[this.type] || NODE_TYPES.empty; }
  get color() { return this.def.color; }
  get icon()  { return this.def.icon; }
  get label() { return this.def.label; }

  /**
   * @param {string} currentId
   * @param {'known'|'horizon'|'dark'} vis  how much the player knows —
   *        see SectorMap.visibilityOf. 'known' is the old behaviour.
   */
  draw(ctx, currentId, vis = 'known') {
    const r       = 18;
    const isCurrent = this.id === currentId;
    const isLocked  = this.locked;

    /* ── UNSURVEYED (update39) ─────────────────────────────
       You used to be handed the whole sector on arrival: every node,
       its type and its label, six columns deep. Now you see where you
       are, where you can jump NEXT, and a smudge on the sensors one
       step beyond that. A Survey Probe out of the hold resolves the
       rest (SectorMap.revealed). */
    if (vis === 'dark') return;
    if (vis === 'horizon') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(this.x, this.y, r - 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#33506f';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#33506f';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', this.x, this.y);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
      return;
    }

    // Glow via layered circle (cheaper than shadowBlur)
    if (!isLocked) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = this.color + '44';
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isLocked   ? '#0a1020'
                  : this.visited ? 'rgba(20,30,50,0.8)'
                  : this.color + '33';
    ctx.fill();
    ctx.strokeStyle = isLocked ? '#1a2a3a'
                    : isCurrent ? '#ffffff'
                    : this.color;
    ctx.lineWidth   = isCurrent ? 3 : 1.5;
    ctx.stroke();

    // Icon
    ctx.fillStyle   = isLocked ? '#2a3a4a' : (this.visited ? '#4a6080' : this.color);
    ctx.font        = '16px monospace';
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText(this.icon, this.x, this.y);
    ctx.textBaseline= 'alphabetic';

    // Label below
    ctx.fillStyle   = isLocked ? '#1a2a3a' : '#c8d8f0';
    ctx.font        = '11px Share Tech Mono, monospace';
    ctx.fillText(this.label, this.x, this.y + r + 10);

    // Visited checkmark
    if (this.visited && !isCurrent) {
      ctx.fillStyle = '#1aff8c';
      ctx.font      = '13px monospace';
      ctx.fillText('✓', this.x, this.y - r - 4);
    }
  }
}

// ── Sector map ────────────────────────────────────────────

class SectorMap {
  /**
   * @param {number} sector   - 1–8
   * @param {number} seed     - RNG seed for layout
   */
  constructor(sector, seed, startLane = null, finalSector = 3, hasBoss = true) {
    this.sector   = sector;
    this.seed     = seed;
    // Contracts are different lengths (Border Patrol ends at 2), so the
    // boss column is not hard-coded any more.
    this.finalSector = finalSector;
    // …and some contracts have no boss at all (Courier Run), in which
    // case the last column is simply the way out.
    this.hasBoss = hasBoss !== false;
    // Which of the 3 start nodes we begin at (0/1/2).
    // null = sector 1: the PLAYER picks the starting lane.
    this.startLane = startLane;
    this.nodes    = [];
    this.currentId = null;
    /* SURVEYED? A Survey Probe out of the hold flips this and the whole
       sector resolves. Persisted with the rest of the map progress —
       burning a probe and then reloading must not un-burn it. */
    this.revealed = false;
    this._rng     = this._makeRng(seed);

    this._generate();
  }

  // ── Seeded RNG ───────────────────────────────────────────

  _makeRng(seed) {
    let s = seed;
    return () => {
      s ^= s << 13; s ^= s >> 17; s ^= s << 5;
      return (s >>> 0) / 0xFFFFFFFF;
    };
  }

  _rngInt(min, max) { return Math.floor(this._rng() * (max - min)) + min; }
  _rngPick(arr)     { return arr[this._rngInt(0, arr.length)]; }

  // ── Generation ───────────────────────────────────────────

  _generate() {
    const COLS       = 6;
    const ROWS       = 3;
    const MAP_W      = 700;
    const MAP_H      = 400;
    const MARGIN     = 80;
    const colW       = (MAP_W - MARGIN * 2) / (COLS - 1);
    const rowH       = (MAP_H - MARGIN * 2) / (ROWS - 1);

    let id = 0;

    // Place nodes in grid with jitter
    const grid = [];   // grid[col][row] = node | null

    for (let col = 0; col < COLS; col++) {
      grid[col] = [];
      let placedInCol = 0;
      for (let row = 0; row < ROWS; row++) {
        // Skip some nodes for variety — but NEVER the whole column:
        // an empty column severed the path (rare "road ends" bug).
        const lastChance = row === ROWS - 1 && placedInCol === 0;
        if (col > 0 && col < COLS - 1 && !lastChance && this._rng() < 0.2) {
          grid[col][row] = null;
          continue;
        }
        placedInCol++;

        const x = MARGIN + col * colW + (col > 0 && col < COLS-1 ? (this._rng()-0.5)*30 : 0);
        const y = MARGIN + row * rowH + (this._rng()-0.5)*20;

        let type;
        const FINAL_SECTOR = this.finalSector ?? 3;
        if (col === 0) {
          type = 'empty';         // start
        } else if (col === COLS - 1) {
          if (this.sector >= FINAL_SECTOR && this.hasBoss) {
            // Final sector: exactly ONE boss node (middle row); skip others
            if (row !== 1) { grid[col][row] = null; continue; }
            type = 'boss';
          } else {
            // No boss on this contract — the last column is the exit,
            // and taking it ends the run (see game.js _nextSector).
            type = 'exit';
          }
        } else {
          type = this._pickNodeType(col, COLS);
          // No elite nodes anywhere any more — the ONLY elite fight is
          // the contract's boss at the end (user's call).
          if (type === 'elite') type = 'combat';
        }

        const node = new MapNode({
          id: `n${id++}`, type,
          x: Math.round(x), y: Math.round(y),
          sector: this.sector,
          row, col,
          locked: true,   // start unlock handled below (lane logic)
          event: type === 'event' ? this._rngPick(EVENTS) : null,
        });

        grid[col][row] = node;
        this.nodes.push(node);
      }
    }

    // Connect nodes: each node connects to 1–2 nodes in the next column
    for (let col = 0; col < COLS - 1; col++) {
      for (let row = 0; row < ROWS; row++) {
        const src = grid[col][row];
        if (!src) continue;

        // Find valid targets in next column
        const targets = [];
        for (let tr = 0; tr < ROWS; tr++) {
          if (grid[col+1][tr]) targets.push(grid[col+1][tr]);
        }
        if (!targets.length) continue;

        // Connect to closest + maybe one more
        targets.sort((a,b) => Math.abs(a.y-src.y) - Math.abs(b.y-src.y));
        const count = this._rng() < 0.4 ? 2 : 1;
        for (let i = 0; i < Math.min(count, targets.length); i++) {
          const dst = targets[i];
          if (!src.next.includes(dst.id))  src.next.push(dst.id);
          if (!dst.prev.includes(src.id)) dst.prev.push(src.id);
        }
      }
    }

    // ── Post-generation fixes ─────────────────────────────
    this._fixConnectivity(grid, COLS, ROWS);
    this._balanceNodes();

    // ── Guarantee: EVERY sector has at least one orbital STATION ──
    const hasStore = this.nodes.some(n => n.type === 'store');
    if (!hasStore) {
      const candidates = this.nodes.filter(n =>
        n.col > 0 && n.col < COLS - 1 &&
        !['boss', 'exit', 'store'].includes(n.type));
      if (candidates.length) {
        const pick = candidates[this._rngInt(0, candidates.length)];
        pick.type  = 'store';
        pick.event = null;
      }
    }

    // ── Start lanes: the map ALWAYS has 3 starts (top/mid/bottom) ──
    // With a lane carried over from the previous sector's exit, we
    // begin there. Sector 1 (no lane yet): all three starts unlock
    // and the player CHOOSES one.
    const starts = [];
    for (let r = 0; r < ROWS; r++) if (grid[0][r]) starts.push(grid[0][r]);
    if (this.startLane != null && grid[0][this.startLane]) {
      const s = grid[0][this.startLane];
      s.locked  = false;
      s.visited = true;
      this.currentId = s.id;
      this.unlockNext();
    } else if (starts.length) {
      starts.forEach(s => { s.locked = false; });
      this.currentId = null;   // waiting for the player's pick
    }
  }

  /** All three entry nodes (used while the player is choosing) */
  get startNodes() { return this.nodes.filter(n => n.col === 0); }

  /** True while sector 1 waits for the player to pick a lane */
  get awaitingStartPick() { return this.currentId === null; }

  /** Ensure no dead ends: every node has a way in and a way out */
  _fixConnectivity(grid, COLS, ROWS) {
    const colNodes = c => {
      const out = [];
      for (let r = 0; r < ROWS; r++) if (grid[c] && grid[c][r]) out.push(grid[c][r]);
      return out;
    };

    for (let c = 1; c < COLS; c++) {
      colNodes(c).forEach(node => {
        // No way IN → connect from closest node in previous column
        if (node.prev.length === 0) {
          const prevs = colNodes(c - 1);
          if (prevs.length) {
            prevs.sort((a, b) => Math.abs(a.y - node.y) - Math.abs(b.y - node.y));
            const src = prevs[0];
            src.next.push(node.id);
            node.prev.push(src.id);
          }
        }
      });
    }
    for (let c = 0; c < COLS - 1; c++) {
      colNodes(c).forEach(node => {
        // No way OUT → connect to closest node in next column
        if (node.next.length === 0) {
          const nexts = colNodes(c + 1);
          if (nexts.length) {
            nexts.sort((a, b) => Math.abs(a.y - node.y) - Math.abs(b.y - node.y));
            const dst = nexts[0];
            node.next.push(dst.id);
            dst.prev.push(node.id);
          }
        }
      });
    }
  }

  /** Guarantee ≥3 combat encounters; cap stores at 2 per sector */
  _balanceNodes() {
    const mid = this.nodes.filter(n =>
      n.type !== 'boss' && n.type !== 'exit' && n.type !== 'empty' || true)
      .filter(n => !n.isBoss && !n.isExit && n.prev.length > 0);

    // Cap stores at 2 — extras become combat
    const stores = this.nodes.filter(n => n.type === 'store');
    for (let i = 2; i < stores.length; i++) {
      stores[i].type = 'combat';
      stores[i].event = null;
    }

    // Ensure at least 3 combat/elite nodes
    let fights = this.nodes.filter(n => n.type === 'combat' || n.type === 'elite').length;
    if (fights < 3) {
      const convertible = this.nodes.filter(n =>
        ['empty', 'nebula', 'event'].includes(n.type) && n.prev.length > 0);
      Utils.shuffle(convertible);
      while (fights < 3 && convertible.length) {
        const n = convertible.pop();
        n.type  = 'combat';
        n.event = null;
        fights++;
      }
    }
  }

  _pickNodeType(col, totalCols) {
    const sector  = this.sector;
    // Later columns have harder encounters
    const weights = { ...NODE_TYPES };
    if (col === 1) weights.combat.weight = 2;      // first hop easier
    if (sector >= 4) weights.elite.weight = 4;
    if (sector >= 6) weights.elite.weight = 6;

    // Guaranteed store every ~3 nodes via weight
    const pool = [];
    Object.entries(weights).forEach(([t, def]) => {
      if (def.weight <= 0) return;
      for (let i = 0; i < def.weight; i++) pool.push(t);
    });

    return this._rngPick(pool);
  }

  // ── Navigation ───────────────────────────────────────────

  getNode(id)    { return this.nodes.find(n => n.id === id) || null; }
  current()      { return this.getNode(this.currentId); }

  /** Unlock nodes reachable from current */
  unlockNext() {
    const cur = this.current();
    if (!cur) return;
    cur.next.forEach(nid => {
      const n = this.getNode(nid);
      if (n) n.locked = false;
    });
  }

  /** Travel to a node (must be unlocked and adjacent) */
  travelTo(nodeId) {
    const cur  = this.current();
    const dest = this.getNode(nodeId);
    if (!dest || dest.locked) return false;
    if (cur && !cur.next.includes(nodeId)) return false;

    if (cur) cur.visited = true;
    dest.visited  = true;
    this.currentId = nodeId;
    return true;
  }

  /* ── WHAT THE PLAYER CAN SEE (update39) ──────────────────
     Three tiers:
       known    the node you are on, everywhere you have been, and the
                jumps you can make from here — drawn in full, clickable
       horizon  one step past those: a dim '?' on the sensors, so you
                can see the lanes branch without knowing what is on them
       dark     everything else — not drawn at all
     A Survey Probe sets `revealed` and every node becomes known. */

  /** One node's tier. */
  visibilityOf(node) {
    if (!node) return 'dark';
    if (this.revealed) return 'known';
    if (node.visited) return 'known';
    if (node.id === this.currentId) return 'known';
    // Before the lane is picked, all three entry nodes are the choice.
    if (this.currentId == null && node.col === 0) return 'known';
    const cur = this.current();
    if (cur && cur.next.includes(node.id)) return 'known';
    // Horizon: reachable in two hops from here.
    const oneHop = cur ? cur.next : this.nodes.filter(n => n.col === 0).map(n => n.id);
    for (const id of oneHop) {
      const n = this.getNode(id);
      if (n && n.next.includes(node.id)) return 'horizon';
    }
    return 'dark';
  }

  /** Every node's tier, computed once. */
  visibilityMap() {
    const m = new Map();
    this.nodes.forEach(n => m.set(n.id, this.visibilityOf(n)));
    return m;
  }

  /** Burn a probe: the whole sector resolves. Returns false if already done. */
  revealAll() {
    if (this.revealed) return false;
    this.revealed = true;
    return true;
  }

  /**
   * Where the player has GOT TO in this sector.
   *
   * The map itself is regenerated from (sector, seed, lane), which is
   * deterministic — so the layout comes back identical after a reload.
   * What did NOT come back was progress: nothing ever recorded which
   * node you were standing on, so pressing F5 halfway through a sector
   * put you back at the entry lane and made you fly the whole thing
   * again. That is all this pair fixes.
   */
  serialiseProgress() {
    return {
      currentId: this.currentId,
      visited:   this.nodes.filter(n => n.visited).map(n => n.id),
      revealed:  !!this.revealed,
    };
  }

  /** Put the player back where they were. Safe with junk/missing input. */
  restoreProgress(p) {
    if (!p) return false;
    // A burnt probe stays burnt even if the rest of the record is junk.
    if (p.revealed) this.revealed = true;
    if (!p.currentId) return false;
    const cur = this.getNode(p.currentId);
    if (!cur) return false;                     // seed changed — start over
    (p.visited || []).forEach(id => {
      const n = this.getNode(id);
      if (n) { n.visited = true; n.locked = false; }
    });
    cur.visited = true;
    cur.locked  = false;
    this.currentId = cur.id;
    // A sector-1 start lane is normally chosen by clicking; having a
    // saved position means that choice was already made, so the other
    // two lanes stay shut.
    this.startNodes.forEach(s => { if (s.id !== cur.id && !s.visited) s.locked = true; });
    this.unlockNext();
    return true;
  }

  /** Nodes player can travel to right now */
  reachable() {
    const cur = this.current();
    if (!cur) return [];
    return cur.next.map(id => this.getNode(id)).filter(n => n && !n.locked);
  }

  // ── Draw ─────────────────────────────────────────────────

  draw(ctx, offsetX = 0, offsetY = 0) {
    ctx.save();
    ctx.translate(offsetX, offsetY);

    // Visibility is computed ONCE per frame — every node asks about its
    // neighbours, so doing it per node would be quadratic for nothing.
    const vis = this.visibilityMap();

    // Draw edges. A lane is only drawn if BOTH ends are at least on the
    // sensor horizon; otherwise the graph gives away the sector shape
    // that the probe is supposed to sell you.
    this.nodes.forEach(src => {
      const vs = vis.get(src.id);
      if (vs === 'dark') return;
      src.next.forEach(dstId => {
        const dst = this.getNode(dstId);
        if (!dst) return;
        const vd = vis.get(dst.id);
        if (vd === 'dark') return;
        const faint = vs === 'horizon' || vd === 'horizon';
        const bothVisited = src.visited && dst.visited;
        ctx.strokeStyle = faint       ? 'rgba(40,62,92,0.45)'
                        : bothVisited ? 'rgba(77,184,255,0.5)'
                        : src.locked  ? 'rgba(30,45,70,0.4)'
                        : 'rgba(77,184,255,0.2)';
        ctx.lineWidth   = bothVisited && !faint ? 2 : 1;
        ctx.setLineDash([4,4]);
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(dst.x, dst.y);
        ctx.stroke();
      });
    });
    ctx.setLineDash([]);

    // Draw nodes
    this.nodes.forEach(n => n.draw(ctx, this.currentId, vis.get(n.id)));

    ctx.restore();
  }
}

if (typeof window !== 'undefined') {
  window.EVENTS       = EVENTS;
  window.eventFits    = eventFits;
  window.pickEventFor = pickEventFor;
}
