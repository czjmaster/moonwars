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
  /* AN ASTEROID FIELD (update100, package C): a fight here is fought
     with rocks falling on both ships (combat.js ASTEROID). */
  asteroids:{ label: 'Asteroids', color: '#c08a52', icon: '◆',  weight: 1 },
  empty:    { label: 'Clear',    color: '#2a4060', icon: '·',   weight: 1 },
  /* A PRISON (update163): seated by the map, never rolled — always where a
     transport is going, otherwise in about a third of the sectors. */
  prison:   { label: 'Prison',   color: '#c9a6ff', icon: '⛓',  weight: 0 },
  /* THE WARDEN'S TIP (update166): one node per sector off the lanes — no probe,
     seal or interrogation shows it; only the warden sells it. */
  secret:   { label: 'Cache',    color: '#ffd700', icon: '✦',  weight: 0 },
  exit:     { label: 'Exit',     color: '#1aff8c', icon: '▶',  weight: 0 },
  boss:     { label: 'BOSS',     color: '#ff2d44', icon: '☠',  weight: 0 },
};

// ── Random events ─────────────────────────────────────────

const EVENTS = [
  /* WHERE THE CATS COME FROM (update45). Not a shop item: you meet one
     or you do not. The station offer costs a little, the derelict one
     costs nothing but is a gamble — and refusing is always allowed,
     because an animal you did not choose to take is an animal you will
     resent feeding. */
  {
    id: 'stowaway_cat',
    title: 'Something Alive in the Hold',
    text: 'The hold sensor keeps tripping on a mass too small to be cargo. '
        + 'When the lamp comes on, a moon cat blinks back at you from behind '
        + 'the ration racks — thin, and entirely unbothered.',
    choices: [
      { label: 'Keep it aboard',      result: { pet: true } },
      { label: 'Put it off at the next port', result: { scrap: [5, 15] } },
    ],
  },
  {
    id: 'ratter_for_sale',
    title: 'The Ratter',
    text: 'A dock hand at the transfer post has a crate with air holes and a '
        + 'story about a freighter that lost its whole grain load to vermin. '
        + '"She earns her rations," he says. "Twice over."',
    speaker: { seed: 0x5a17, role: 'DOCK HAND', colour: '#8a7a52' },
    choices: [
      { label: 'Take her — 40 CC', result: { pet: true, cost: 40 } },
      { label: 'Walk on',          result: {} },
    ],
  },
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
    text: 'A civilian ship is under attack. "Anyone on this channel — they are '
        + 'cutting into our hull!"',
    speaker: { seed: 0xc171, role: 'CIVILIAN SHIP', colour: '#7a90a8' },
    choices: [
      /* KARMA (update50, spec §8). Turning back costs you the jump and
         the risk — that is "pomoc kosztem zasobów lub ryzyka". Passing
         by is NOT a sin: "wstrzymanie się lub zwykła odmowa pomocy" is
         explicitly worth nothing, and the game must not punish a
         commander for having his own crew to think about. */
      { label: 'Rescue',   result: { scrap: [5,15], crew: 1, karma: 5 } },
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
    text: 'A rebel patrol hails you. "Pay the toll and you fly on. Or we take it '
        + 'off your wreck."',
    speaker: { seed: 0x7e6e1, role: 'REBEL PATROL', hostile: true, colour: '#a83a44' },
    choices: [
      { label: 'Pay',   result: { scrap: [-20,-10] } },
      { label: 'Fight', result: { combat: 'easy' } },
    ],
  },
  /* THE ONLY EVENT THAT CAN HURT A CREWMAN (update40).
     `_resolveEvent` has handled `risk: 'crew_damage'` — pick somebody
     and take 10-40 off them — since long before update40, and NOT ONE
     event in this table ever produced it. A whole category of event
     hazard was written, wired to the resolver, and unreachable. This
     is what it was for. */
  {
    id: 'meteor_swarm',
    title: 'Micrometeorite Swarm',
    text: 'A gravel stream, and you are already inside the leading edge. '
        + 'Ride it out and hope it stays gravel, or burn He2 sheering off '
        + 'and lose the fuel.',
    choices: [
      { label: 'Ride it out',            result: { risk: 'crew_damage', scrap: [0, 8] } },
      { label: 'Sheer off — burn 1 He2', result: { fuel: -1 } },
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
    text: 'A wandering medic hails you. "Your med bay is older than I am. '
        + 'Twenty-five CC and I will make it worth having."',
    speaker: { seed: 0x3ed1c, role: 'FIELD MEDIC', colour: '#e8e8e8' },
    // Only offered to a ship that HAS one — see eventFits().
    requires: 'medbay',
    choices: [
      { label: 'Accept (25 CC)', result: { cost: 25, system_upgrade: 'medbay' } },
      { label: 'Decline',           result: {} },
    ],
  },
  /* THE SHIELD TUNER IS GONE (update69, player's call). Shields are the
     one module the yard sells in PAIRS of pips, and this event handed
     out a single level — so an event-upgraded ship counted its shields
     differently from a yard-upgraded one, and the two disagreed for the
     rest of the run. Deleted rather than special-cased: an event that
     has to be corrected before it is applied is an event with nothing
     to offer. The yard still sells them, which is where that decision
     belongs. */
  {
    id: 'drive_rebuild',
    title: 'Drive Rebuild',
    text: 'A yard tug pulls alongside. "I can rebuild that drive of yours out '
        + 'here. I have the parts — you have the CC."',
    speaker: { seed: 0x7a6, role: 'YARD TUG', colour: '#c08a52' },
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

  /* AN OFFER THAT CANNOT BE DELIVERED IS NOT AN OFFER (update69).
     The player met the cat twice with a cat already aboard, took her
     both times and got nothing but a line in the log: "mam nieraz take
     her w eventach ale nic nie dostaje". The refusal was there and was
     correct — it was the OFFER that was wrong. Same for a module
     already at its ceiling: "upgraded to maximum" is not a trade.
     Price is NOT filtered here: being too poor is a real answer to a
     real offer, and hiding the ones you cannot afford would hide the
     reason to come back richer. */
  const wantsPet = !!ev.choices?.some(c => c.result?.pet);
  if (wantsPet && ship?.crew?.some(c => c.isPet && !c.dead)) return false;

  const need = ev.requires
            ?? ev.choices?.map(c => c.result?.system_upgrade).find(Boolean)
            ?? null;
  if (!need) return true;
  if (!ship || typeof ship.getSystem !== 'function') return false;
  const sys = ship.getSystem(need);
  if (!sys) return false;
  const up = ev.choices?.some(c => c.result?.system_upgrade === need);
  if (up && sys.level >= (sys.def?.maxLevel ?? 8)) return false;
  return true;
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

// How often a sector carries one of the wanted. Not every one, so the
// hunt is a hunt — see SectorMap._seatWanted.
/* Raised from 0.40 in update70 (player's call) now that a poster is
   only seated on ITS OWN contract: with the board split three ways, the
   old rate meant a hunt you could fly right past twice. */
const WANTED_ON_MAP = 0.50;

/* The four kinds of port, and what a job calls each (update161). */
const PORT_KINDS = ['general', 'military', 'science', 'outpost'];
const PORT_KIND_LABEL = { general: 'trade port', military: 'fleet yard', science: 'science post', outpost: 'outpost' };
/* What the warden's secret is (update166). */
const SECRET_KINDS = ['cache', 'wreck', 'haven'];
const SECRET_LABEL = { cache: "Smugglers' cache", wreck: 'Silent wreck', haven: 'Quiet berth' };

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
    /* WHOSE FIGHT THIS IS (update66). An ID off the wanted board, never
       a copy of the record — the board is where a pirate lives, and
       this node only points at him. `null` on every ordinary fight. */
    this.wantedId = cfg.wantedId ?? null;

    // For boss node
    this.isBoss  = cfg.type === 'boss';
    // For exit node
    this.isExit  = cfg.type === 'exit';
  }

  get def() { return NODE_TYPES[this.type] || NODE_TYPES.empty; }

  /** The man on this node, read off the board — never stored here.
   *  Null once he has been handed in, even on a map drawn earlier. */
  get wanted() {
    if (!this.wantedId || typeof Save === 'undefined' || !Save.wantedById) return null;
    return Save.wantedById(this.wantedId);
  }

  /* A NODE WITH A POSTER ON IT LOOKS DIFFERENT (update66) — orange
     against the ordinary red, a skull instead of crossed blades, and
     his NAME where the word "Enemy" would be. That is the whole payoff
     of scanning a sector: the map stops being six identical fights. */
  /** The hunter's mark (update160): a ring with four ticks — on a node, and on a chip. */
  static drawCrosshair(ctx, x, y, r, col) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.moveTo(x + dx * (r - 4), y + dy * (r - 4)); ctx.lineTo(x + dx * (r + 5), y + dy * (r + 5)); ctx.stroke();
    });
    ctx.restore();
  }
  get color() { return this.wanted ? '#ff9a4d' : this.def.color; }
  get icon()  { return this.wanted ? '☠' : this.def.icon; }
  get label() {
    if (this.type === 'secret') return SECRET_LABEL[this.secretKind] ?? this.def.label;
    return this.wanted ? this.wanted.name : (this.type === 'store' && this.portType ? PORT_KIND_LABEL[this.portType] : this.def.label);
  }

  /**
   * @param {string} currentId
   * @param {'known'|'horizon'|'dark'} vis  how much the player knows —
   *        see SectorMap.visibilityOf. 'known' is the old behaviour.
   */
  /**
   * A PLACE ON THE CHART (update167, jj: „natłok ikonek”, „szarość się gryzie z
   * kolorowymi ikonami”). A small dark pad on the rock, a ring in the node's
   * colour — full colour and a glow only where you can jump now, and where you
   * stand; everything else smaller and muted. A NAME only where it matters: where
   * you stand, where you can go, a port, the prison, the warden's secret, a man on
   * the board, the way out, the boss. The rest is said by its card under the pointer.
   * @param {string} currentId
   * @param {'known'|'horizon'|'dark'} vis  how much the player knows — SectorMap.visibilityOf
   */
  draw(ctx, currentId, vis = 'known') {
    if (vis === 'dark') return;
    if (vis === 'horizon') {
      ctx.save();
      ctx.strokeStyle = 'rgba(170,190,215,0.45)'; ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(this.x, this.y, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(170,190,215,0.55)'; ctx.font = '9px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', this.x, this.y + 0.5);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
      return;
    }
    const cur = this.id === currentId;
    const live = !this.locked && !cur && !this.visited;
    const col = this.color, R = MapNode.radius(this, currentId);
    const muted = MapNode.mute(col, 0.55);
    // the pad, the glow where you can go, the ring
    ctx.fillStyle = 'rgba(8,12,22,0.88)';
    ctx.beginPath(); ctx.arc(this.x, this.y, R, 0, Math.PI * 2); ctx.fill();
    if (live) {
      ctx.strokeStyle = col + '55'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(this.x, this.y, R + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = cur ? '#ffffff' : live ? col : muted;
    ctx.lineWidth = cur ? 2.5 : 1.25;
    ctx.beginPath(); ctx.arc(this.x, this.y, R, 0, Math.PI * 2); ctx.stroke();
    // the sign
    ctx.fillStyle = live || cur ? col : muted;
    ctx.font = `${live || cur ? 14 : 12}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this.icon, this.x, this.y + 0.5);
    ctx.textBaseline = 'alphabetic';

    /* THE NAME, where it matters — on a dark plate, so it reads on the rock */
    const named = MapNode.named(this, currentId);
    let below = this.y + R + 3;
    if (named) {
      ctx.font = '10px Share Tech Mono, monospace';
      const w = ctx.measureText(this.label).width + 8;
      ctx.fillStyle = 'rgba(8,12,22,0.8)'; ctx.fillRect(this.x - w / 2, below, w, 13);
      ctx.fillStyle = live || cur ? '#e8f0fa' : '#a8b8cc';
      ctx.fillText(this.label, this.x, below + 10);
      below += 13;
    }

    /* WHAT HE IS WORTH, under his name. A poster the player can read
       from the map is the difference between a hunt and a surprise. */
    if (this.wanted && this.locked) {         // out of reach: his ring, and his name above
      ctx.strokeStyle = '#ff9a4d88'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(this.x, this.y, R + 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (!this.locked && this.wanted) {
      /* …AND A MAN YOU HUNT WEARS THE CROSSHAIR (update160): the same mark as
         his chip at the top of the screen. */
      const hunted = typeof Save !== 'undefined' && Save.isHunted?.(this.wanted.id);
      if (hunted) MapNode.drawCrosshair(ctx, this.x, this.y, R + 7, '#ff7c20');
      else { ctx.strokeStyle = '#ff9a4d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(this.x, this.y, R + 5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = '9px Share Tech Mono, monospace';
      const tag = `${hunted ? 'HUNTED' : 'WANTED'} · ${this.wanted.bounty} CC`, w = ctx.measureText(tag).width + 8;
      ctx.fillStyle = 'rgba(8,12,22,0.8)'; ctx.fillRect(this.x - w / 2, below, w, 12);
      ctx.fillStyle = hunted ? '#ff9a4d' : '#ffd700';
      ctx.fillText(tag, this.x, below + 9);
    }

    // been there
    if (this.visited && !cur) {
      ctx.fillStyle = '#1aff8c';
      ctx.font = '11px monospace';
      ctx.fillText('✓', this.x + R, this.y - R + 2);
    }
  }

  /** How big a place is drawn: bigger where you stand and where you can go. */
  static radius(n, currentId) { return (n.id === currentId || (!n.locked && !n.visited)) ? 15 : 12; }
  /** The kinds that always carry their name on the chart. */
  static get NAMED_KINDS() { return ['store', 'prison', 'secret', 'boss', 'exit']; }
  /** Does this place carry its name on the chart? */
  static named(n, currentId) {
    return n.id === currentId || (!n.locked && !n.visited) || MapNode.NAMED_KINDS.includes(n.type) || !!n.wanted;
  }
  /** A colour pulled towards grey — the quiet marker. */
  static mute(hex, k = 0.55) {
    const m = /^#([0-9a-f]{6})/i.exec(String(hex));
    if (!m) return hex;
    const c = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    return `rgb(${c.map(v => Math.round(v + (150 - v) * k)).join(',')})`;
  }
}

// ── Sector map ────────────────────────────────────────────

class SectorMap {
  /** How often a sector carries one of the wanted. */
  static get WANTED_ON_MAP() { return WANTED_ON_MAP; }

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
    /* Nodes the VA 243 seal showed one by one (update102) — known like
       the probe's, but only these. Saved with the progress too. */
    this.seen     = new Set();
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

  /* ── THE SECTOR'S SIZE, IN ONE PLACE (update132, jj: "dłuższe sektory,
   * większa siatka, więcej węzłów w pionie i poziomie"; skok zostaje po
   * 1 He2, żadnych dodatkowych stacji, sektorów tyle samo) ──────────
   * 9 columns × 5 rows (was 6 × 3): eight jumps to the far edge instead
   * of five, five lanes instead of three. The generator, the screen
   * that draws it and the hit test that clicks it all read THIS — the
   * old 700 × 400 was written out three times in two files. */
  /* BIGGER SINCE update167 (jj: „natłok ikonek … większa mapa”): 920 × 376
     (was 900 × 330) — the chart of the moon's surface (js/mapterrain.js). */
  static get GRID() { return { cols: 9, rows: 5, w: 920, h: 376, margin: 35 }; }
  /** The chart's panel round the map, from the map's origin: the title band above, the scale below. */
  static panelOf(o) { const G = SectorMap.GRID; return { x: o.x - 40, y: o.y - 52, w: G.w + 80, h: G.h + 84 }; }
  /** Where the map's (0, 0) sits on a screen W × H (drawing and clicks).
   *  Centred across; down, it starts a fifth of the way so the panel ends
   *  above the power bar, which stays live on the map. */
  static origin(W, H) {
    const G = SectorMap.GRID;
    /* 128 since update167: the bigger chart's panel runs from 76 to 536, clear of the
       top bar and its buttons, the crew list, the power panel, the gun cards and the log. */
    return { x: Math.round((W - G.w) / 2), y: Math.round(H * 0.178) };
  }
  /** Old 6 × 3 maps had about 10 middle nodes; this one about 28. The
   *  station's weight is scaled by `STORE_THIN` so a sector still holds
   *  as many stations as it did — jj: no extra stations. */
  static get STORE_THIN() { return 3; }
  /** The middle lane — where a sector starts when nothing says otherwise. */
  static get MID_LANE() { return Math.floor(SectorMap.GRID.rows / 2); }
  /** A lane's name, top to bottom, for the notices. */
  static laneName(row) { return ['TOP', 'UPPER', 'MIDDLE', 'LOWER', 'BOTTOM'][row] ?? `LANE ${row + 1}`; }

  _generate() {
    const G          = SectorMap.GRID;
    const COLS       = G.cols;
    const ROWS       = G.rows;
    const MAP_W      = G.w;
    const MAP_H      = G.h;
    const MARGIN     = G.margin;
    const MID_ROW    = Math.floor(ROWS / 2);
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
            if (row !== MID_ROW) { grid[col][row] = null; continue; }
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
        !['boss', 'exit', 'store', 'prison'].includes(n.type));
      if (candidates.length) {
        const pick = candidates[this._rngInt(0, candidates.length)];
        pick.type  = 'store';
        pick.event = null;
      }
    }
    /* …AND THAT PORT HAS A KIND TOO (update163): the guaranteed one is made
       after the kinds were rolled, and went without — a job for "a science
       post" could never be delivered there, and its lane never shown. */
    this.nodes.filter(n => n.type === 'store' && !n.portType).forEach(n => { n.portType = this._rngPick(PORT_KINDS); });
    this._seatSecret(colW, rowH, MARGIN);

    // ── Start lanes: one per row (five since update132) ──
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

    this._seatWanted();
    /* (after the posters, so their seats do not move)
     EVERY PORT HAS A KIND (update161), rolled here from the map's own seed —
       a job at DISPATCH names one ("a science post in sector 2"), so it has to
       be the same port on every visit and every reload. */
    this.nodes.filter(n => n.type === 'store').forEach(n => { n.portType = this._rngPick(PORT_KINDS); });
    this._seatPrison();

    // Ensure at least 3 combat/elite nodes
    let fights = this.nodes.filter(n => n.type === 'combat' || n.type === 'elite').length;
    if (fights < 3) {
      const convertible = this.nodes.filter(n =>
        ['empty', 'nebula', 'asteroids', 'event'].includes(n.type) && n.prev.length > 0);
      Utils.shuffle(convertible);
      while (fights < 3 && convertible.length) {
        const n = convertible.pop();
        n.type  = 'combat';
        n.event = null;
        fights++;
      }
    }
  }

  /**
   * ONE FIGHT IN THIS SECTOR IS HIS (update66).
   *
   * Before this, a wanted man was rolled at the START OF A FIGHT — so
   * the list was a lottery, not a hunt: every combat node looked the
   * same and you learned who you had run into only once the shooting
   * started. Scanning a sector told you where the fights were and
   * nothing about who was in them.
   *
   * Now a poster is pinned to a NODE at map generation. The survey
   * probe becomes a hunter's tool rather than a convenience, and the
   * fight itself no longer rolls anything — it reads this. One
   * question, one answer, in one place.
   *
   * Not every sector: at `WANTED_ON_MAP` a hunt sometimes means flying
   * on to the next one, which is what keeps it a hunt.
   */
  _seatWanted() {
    if (typeof Save === 'undefined' || !Save.wanted) return;
    /* ── ONLY THE MEN WHOSE CONTRACT THIS IS (update70) ────────
     *
     * The board used to be one pool and any name could turn up on any
     * job, which is why the poster could not say where to look for
     * him: there was no answer. Each name carries a contract now
     * (`Save.wantedFor`), and a Courier Run meets the man wanted on
     * the Courier Run. A contract with nobody on it is a quiet run —
     * that is the point of them being spread. */
    const mission = Save.getRun?.()?.mission ?? null;
    // The first contract has no pirates on its map (update108, jj).
    if (mission && typeof MISSIONS !== 'undefined' && MISSIONS[mission]?.noWanted) return;
    const open = Save.wantedFor ? Save.wantedFor(mission) : Save.wanted();
    if (!open.length) return;
    /* THE MAP'S OWN RNG, NOT Math.random (update66).
     *
     * A sector map is REBUILT from `run.seed` every time the game is
     * loaded or the player comes back to it — the node layout is
     * deterministic for that reason. A poster placed with a loose
     * `Math.random()` would land somewhere else on every reload: save
     * next to your quarry, load, and he has moved or vanished. Worse,
     * it would have been a save-scummable hunt.
     *
     * Seeded, so the sector you scanned is the sector you come back to.
     */
    if (this._rng() >= SectorMap.WANTED_ON_MAP) return;
    /* Never the boss node and never the first hop: the boss fight is
       its own contract, and a poster on the very first node would let
       the player take him before he has a ship worth the risk. */
    const fights = this.nodes.filter(n =>
      n.type === 'combat' && !n.isBoss && !n.isExit && n.col > 1);
    if (!fights.length) return;
    const node = this._rngPick(fights);
    /* WHICH man is seeded too — the same board and the same seed must
       put the same name on the same node. */
    /* A MAN YOU HUNT COMES FIRST (update160): when anyone on this contract is
       hunted, the seat goes to one of them — the same seeded draw, a smaller hat. */
    const hunted = open.filter(w => Save.isHunted?.(w.id));
    const pool = hunted.length ? hunted : open;
    node.wantedId = pool[this._rngInt(0, pool.length)].id;
  }

  /** The node in this sector carrying a poster, if any. */
  wantedNode() { return this.nodes.find(n => n.wantedId) || null; }

  /* ── THE PRISON (update163) ─────────────────────────────────────────
   * jj: a node of its own — intake for a transport's convicts and for the
   * men you caught, an interrogation room, a warden who sells what he knows.
   * Always in the sector a PRISONERS job is going to; otherwise in about a
   * third of them. The map's own RNG, drawn AFTER everything else on it, so
   * no other node moves for it; one node turns into it, never a port, never
   * the poster's fight, never the first hop or the last column. */
  static get PRISON_ODDS() { return 1 / 3; }
  _seatPrison() {
    const roll = this._rng();
    const run = (typeof Save !== 'undefined') ? Save.getRun?.() : null;
    const due = (run?.jobs ?? []).some(j => j.kind === 'convict' && j.sector === this.sector && j.state === 'aboard');
    if (!due && roll >= SectorMap.PRISON_ODDS) return;
    const COLS = SectorMap.GRID.cols;
    const pool = this.nodes.filter(n => n.col > 1 && n.col < COLS - 1 && !n.wantedId
      && ['empty', 'event', 'nebula', 'asteroids', 'combat'].includes(n.type));
    /* A transport's prison is never missing: with no quiet node to take, any
       node that is not a port, the poster's or an end will do. */
    const pick = pool.length ? pool : (due ? this.nodes.filter(n => n.col > 0 && n.col < COLS - 1 && !n.wantedId && n.type !== 'store') : []);
    if (!pick.length) return;
    const node = this._rngPick(pick);
    node.type = 'prison'; node.event = null;
  }
  /* ── THE WARDEN'S SECRET (update166) ─────────────────────────────────
   * jj: "naczelnik da info, gdzie jest ukryty sektor, a sonda tego nie daje".
   * Every sector holds ONE node off the lanes: a smugglers' cache, a silent
   * wreck or a quiet berth. It sits in a gap between two columns, tied to the
   * nearest node either side; no probe, seal or interrogation lights it —
   * `visibilityOf` keeps it dark until `revealSecret` (the warden). Seeded,
   * drawn last from the map's RNG, so nothing else on the map moves for it. */
  _seatSecret(colW, rowH, MARGIN) {
    const kind = this._rngPick(SECRET_KINDS), colPick = this._rng(), rowPick = this._rng();
    const COLS = SectorMap.GRID.cols, ROWS = SectorMap.GRID.rows;
    const spots = [];
    for (let c = 2; c <= COLS - 3; c++) for (let r = 0; r < ROWS; r++) {
      const x = Math.round(MARGIN + (c + 0.5) * colW), y = Math.round(MARGIN + r * rowH);
      if (this.nodes.every(n => Math.hypot(n.x - x, n.y - y) > 44)) spots.push({ c, r, x, y });
    }
    if (!spots.length) return;
    const pick = spots[Math.floor(colPick * spots.length) % spots.length];
    const near = (col) => this.nodes.filter(n => n.col === col && !n.isBoss && !n.isExit)
      .sort((a, b) => Math.hypot(a.x - pick.x, a.y - pick.y) - Math.hypot(b.x - pick.x, b.y - pick.y))[0];
    const a = near(pick.c), b = near(pick.c + 1);
    if (!a || !b) return;
    const node = new MapNode({ id: 's0', type: 'secret', x: pick.x, y: pick.y, sector: this.sector, row: pick.r, col: pick.c, locked: true });
    node.secret = true; node.secretKind = kind; void rowPick;      // a draw kept for later use, so the stream stays put
    node.prev.push(a.id); node.next.push(b.id);
    a.next.push(node.id); b.prev.push(node.id);
    this.nodes.push(node);
  }
  /** The warden's secret on this map, or null. */
  secretNode() { return this.nodes.find(n => n.secret) || null; }
  /** The warden tells: the secret is on the chart. False if there was none or it was known. */
  revealSecret() {
    if (!this.secretNode() || this.secretKnown) return false;
    this.secretKnown = true;
    return true;
  }

  /** The prison on this map, or null. */
  prisonNode() { return this.nodes.find(n => n.type === 'prison') || null; }

  /**
   * THE WAY THERE, ON THE MAP (update163, jj: "jak dostajemy misję czy
   * kontrakt, to mamy odsłoniętą drogę do tego więzienia lub stacji, jeżeli
   * znajduje się w danym sektorze"). The shortest lane from where we stand
   * (or from any start, before the lane is picked) to each target becomes
   * known — the target too, even if no lane forward reaches it. Kept with the
   * VA 243 seal's `seen`, so it survives a reload. Returns the ids it added.
   */
  revealRoute(targetIds = []) {
    const added = [];
    const see = id => { if (!this.seen.has(id)) { this.seen.add(id); added.push(id); } };
    const from = this.currentId ? [this.currentId] : this.startNodes.map(n => n.id);
    targetIds.forEach(tid => {
      if (!this.getNode(tid)) return;
      const prev = new Map(from.map(id => [id, null])), queue = [...from];
      while (queue.length) {
        const id = queue.shift();
        if (id === tid) break;
        (this.getNode(id)?.next ?? []).forEach(nx => { if (!prev.has(nx)) { prev.set(nx, id); queue.push(nx); } });
      }
      if (prev.has(tid)) for (let id = tid; id != null; id = prev.get(id)) see(id);
      else see(tid);
    });
    return added;
  }

  _pickNodeType(col, totalCols) {
    const sector  = this.sector;
    /* WEIGHTS ARE A COPY — A REAL ONE (update40).
     *
     * This was `{ ...NODE_TYPES }`, a SHALLOW spread: `weights.combat`
     * *was* `NODE_TYPES.combat`, so `weights.combat.weight = 2`
     * overwrote the module-level constant for the rest of the page
     * session. Columns are generated left to right, so column 1's
     * "first hop easier" tweak silently applied to columns 2, 3 and 4
     * of the same map — combat dropped from 5/13 to 2/10 everywhere —
     * and once you reached sector 4, `elite.weight = 4` stuck for
     * good: start a fresh one-sector Courier Run without reloading the
     * page and sector 1 generated at the difficulty of the deepest
     * sector you had ever visited. A map's composition depended on
     * your previous run.
     *
     * Only the NUMBER is per-map; the table itself never changes.
     */
    const weights = {};
    Object.entries(NODE_TYPES).forEach(([t, def]) => { weights[t] = { ...def }; });
    if (col === 1) weights.combat.weight = 2;      // first hop easier
    if (sector >= 4) weights.elite.weight = 4;
    if (sector >= 6) weights.elite.weight = 6;

    /* Every other kind counts STORE_THIN times, the station once — the
       same number of stations on a map three times the size (update132). */
    const thin = SectorMap.STORE_THIN;
    const pool = [];
    Object.entries(weights).forEach(([t, def]) => {
      if (def.weight <= 0) return;
      const n = t === 'store' ? def.weight : def.weight * thin;
      for (let i = 0; i < n; i++) pool.push(t);
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
    /* The warden's secret: dark to everything but his word (update166). */
    if (node.secret) return this.secretKnown ? 'known' : 'dark';
    if (this.revealed) return 'known';
    if (this.seen?.has(node.id)) return 'known';
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

  /** The nodes the player cannot see in full yet (horizon or dark). */
  hiddenNodes() {
    return this.nodes.filter(n => !n.secret && this.visibilityOf(n) !== 'known');
  }

  /**
   * THE VA 243 SEAL (update102): every hidden node is rolled once at
   * `chance`; at least one always shows. Returns the ids it revealed
   * ([] when nothing was hidden — the caller refuses then).
   */
  revealSome(chance, rand = Math.random) {
    const hidden = this.hiddenNodes();
    if (!hidden.length) return [];
    let got = hidden.filter(() => rand() < chance);
    if (!got.length) got = [hidden[Math.floor(rand() * hidden.length) % hidden.length]];
    got.forEach(n => this.seen.add(n.id));
    return got.map(n => n.id);
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
      seen:      [...(this.seen ?? [])],
      secret:    !!this.secretKnown,
    };
  }

  /** Put the player back where they were. Safe with junk/missing input. */
  restoreProgress(p) {
    if (!p) return false;
    // A burnt probe stays burnt even if the rest of the record is junk.
    if (p.revealed) this.revealed = true;
    if (p.secret) this.secretKnown = true;      // what the warden told stays told (update166)
    // What the seal showed stays shown (update102) — ids this map knows.
    (Array.isArray(p.seen) ? p.seen : []).forEach(id => { if (this.getNode(id)) this.seen.add(id); });
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

    /* THE ROUTES (update167): a dark bed under each lane so it reads on the
       rock, the lane itself dotted over it — walked ones blue, the jumps you
       can make now bright, the way to the warden's secret gold, the rest
       quiet. A lane is only drawn if BOTH ends are at least on the sensor
       horizon; otherwise the graph gives away the sector shape that the
       probe is supposed to sell you. */
    const lanes = [];
    this.nodes.forEach(src => {
      const vs = vis.get(src.id);
      if (vs === 'dark') return;
      src.next.forEach(dstId => {
        const dst = this.getNode(dstId);
        if (!dst || vis.get(dst.id) === 'dark') return;
        lanes.push([src, dst, vs === 'horizon' || vis.get(dst.id) === 'horizon']);
      });
    });
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(5,7,12,0.45)'; ctx.lineWidth = 4;
    lanes.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    ctx.setLineDash([2, 5]);
    lanes.forEach(([a, b, faint]) => {
      const walked = a.visited && b.visited, next = a.id === this.currentId && !b.locked;
      ctx.lineWidth = walked ? 2 : 1.5;
      ctx.strokeStyle = faint ? 'rgba(170,190,215,0.22)'
                      : walked ? 'rgba(77,184,255,0.9)'
                      : (a.secret || b.secret) ? 'rgba(255,215,0,0.6)'
                      : next ? 'rgba(230,240,255,0.85)'
                      : 'rgba(190,205,225,0.35)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';

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
