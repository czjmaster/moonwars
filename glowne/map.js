/* ============================================================
   MOON WARS — map.js
   Sector map: node graph generation, path selection,
   event types, and FTL-style branching layout.
   ============================================================ */

'use strict';

// ── Node types ────────────────────────────────────────────

const NODE_TYPES = {
  combat:   { label: 'Enemy',    color: '#ff2d44', icon: '⚔',  weight: 5 },
  elite:    { label: 'Elite',    color: '#ff7c20', icon: '⚔⚔', weight: 2 },
  store:    { label: 'Station',  color: '#ffd700', icon: '⬡',  weight: 2 },
  event:    { label: 'Event',    color: '#4db8ff', icon: '?',   weight: 3 },
  nebula:   { label: 'Nebula',   color: '#cc44ff', icon: '☁',  weight: 1 },
  empty:    { label: 'Clear',    color: '#2a4060', icon: '·',   weight: 2 },
  exit:     { label: 'Exit',     color: '#1aff8c', icon: '▶',  weight: 0 },
  boss:     { label: 'BOSS',     color: '#ff2d44', icon: '☠',  weight: 0 },
};

// ── Random events ─────────────────────────────────────────

const EVENTS = [
  {
    id: 'abandoned_ship',
    title: 'Derelict Ship',
    text: 'A derelict vessel drifts ahead. No life signs on sensors.',
    choices: [
      { label: 'Board it', result: { scrap: [10,30], risk: 'crew_damage' } },
      { label: 'Ignore',   result: {} },
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
    title: 'Fuel Cache',
    text: 'Sensors detect a hidden fuel depot.',
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
    text: 'A wandering medic offers to upgrade your med systems.',
    choices: [
      { label: 'Accept (25 scrap)', result: { cost: 25, system_upgrade: 'medbay' } },
      { label: 'Decline',           result: {} },
    ],
  },
];

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

  draw(ctx, currentId) {
    const r       = 18;
    const isCurrent = this.id === currentId;
    const isLocked  = this.locked;

    // Glow for unlocked nodes
    if (!isLocked) {
      ctx.shadowBlur  = 12;
      ctx.shadowColor = this.color;
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
    ctx.shadowBlur  = 0;

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
  constructor(sector, seed) {
    this.sector   = sector;
    this.seed     = seed;
    this.nodes    = [];
    this.currentId = null;
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
      for (let row = 0; row < ROWS; row++) {
        // Skip some nodes for variety
        if (col > 0 && col < COLS - 1 && this._rng() < 0.2) {
          grid[col][row] = null;
          continue;
        }

        const x = MARGIN + col * colW + (col > 0 && col < COLS-1 ? (this._rng()-0.5)*30 : 0);
        const y = MARGIN + row * rowH + (this._rng()-0.5)*20;

        let type;
        if (col === 0) {
          type = 'empty';         // start
        } else if (col === COLS - 1) {
          type = row === 1 ? 'boss' : 'exit';
        } else {
          type = this._pickNodeType(col, COLS);
        }

        const node = new MapNode({
          id: `n${id++}`, type,
          x: Math.round(x), y: Math.round(y),
          sector: this.sector,
          locked: col > 0,   // only start unlocked
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

    // Unlock start node and its immediate destinations
    if (this.nodes.length > 0) {
      this.nodes[0].locked  = false;
      this.nodes[0].visited = true;
      this.currentId        = this.nodes[0].id;
      this.unlockNext();
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

    // Draw edges
    this.nodes.forEach(src => {
      src.next.forEach(dstId => {
        const dst = this.getNode(dstId);
        if (!dst) return;
        const bothVisited = src.visited && dst.visited;
        ctx.strokeStyle = bothVisited ? 'rgba(77,184,255,0.5)'
                        : src.locked  ? 'rgba(30,45,70,0.4)'
                        : 'rgba(77,184,255,0.2)';
        ctx.lineWidth   = bothVisited ? 2 : 1;
        ctx.setLineDash([4,4]);
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(dst.x, dst.y);
        ctx.stroke();
      });
    });
    ctx.setLineDash([]);

    // Draw nodes
    this.nodes.forEach(n => n.draw(ctx, this.currentId));

    ctx.restore();
  }
}
