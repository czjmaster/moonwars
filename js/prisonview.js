/* ============================================================
   MOON WARS — prisonview.js  (update163)
   THE PRISON: a node of its own on the sector map.

   jj, 22–23.10, over six mock-ups (mk_prison … mk_prison6, the last one
   "zajebiste gg lecimy"):
     · a node with three counters under a window on the block:
         INTAKE         a transport's convicts are signed in (the job is
                        paid), and the men you caught — the full bounty,
                        here and now
         INTERROGATION  one of your captives, an hour in the back room:
                        the whole sector map, free, once a visit; he goes
                        into the intake after
         THE WARDEN     pays: the places on this map you have not seen
     · the block is a HULL like any ship ("na podstawie modułów statków,
       ta sama wielkość, plus winda") — the same 100-px modules, a lift,
       plating; its own rooms painted like modules with no names on the
       walls (tools/room_painter.js: security, warden, intake, decon,
       mess, cell); its gravity generator is the ENGINES module, its
       freezer the CARBONITE bay; air lamps in every room
     · no bars: a field on each cell; the inmates bare-headed in orange,
       the staff on duty in helmets; people doing things; a cat that
       hunts the mice in the mess now and then
     · our ship moored to the block's gate by the jet bridge (DockArt)

   PrisonView only DRAWS the place and says what was clicked:
       PrisonView.open(prison, ship, { hidden })   hidden() = unseen nodes
       PrisonView.update(dt) → { act: 'hand'|'ask', id } | { act: 'warden' }
                              | { act: 'depart' } | null
       PrisonView.draw(ctx)
   game.js does the deed (Base.handOver, the map's reveal, the purse).
   ============================================================ */

'use strict';

/* ── THE BLOCK, A HULL (the standard for every structure from now on) ── */
if (typeof STRUCTURE_LAYOUTS !== 'undefined' && typeof buildHull === 'function' && !STRUCTURE_LAYOUTS.prison_block) {
  STRUCTURE_LAYOUTS.prison_block = buildHull({
    label: 'Penal Block', builder: 'terra', spriteKey: 'ship_enemy', hullMax: 60,
    isStation: true, grounded: true, immobile: true, structure: true, armor: 2,
    originX: 20, originY: 20, decks: 3, shaftAfter: [1],
    grid: [
      { id: 'p_weapons',  type: 'weapons',   col: 0, row: 2 }, { id: 'p_security', type: 'empty', art: 'security', col: 1, row: 2 },
      { id: 'p_warden',   type: 'empty', art: 'warden', col: 2, row: 2 },
      { id: 'p_cell1',    type: 'empty', art: 'cell', col: 3, row: 2 }, { id: 'p_cell2', type: 'empty', art: 'cell', col: 4, row: 2 },
      { id: 'p_intake',   type: 'empty', art: 'intake', col: 0, row: 1 }, { id: 'p_decon', type: 'empty', art: 'decon', col: 1, row: 1 },
      { id: 'p_freezer',  type: 'carbonite', col: 2, row: 1 },
      { id: 'p_cell3',    type: 'empty', art: 'cell', col: 3, row: 1 }, { id: 'p_cell4', type: 'empty', art: 'cell', col: 4, row: 1 },
      { id: 'p_oxygen',   type: 'oxygen',    col: 0, row: 0 }, { id: 'p_gravity', type: 'engines', col: 1, row: 0 },
      { id: 'p_mess',     type: 'empty', art: 'mess', col: 2, row: 0 },
      { id: 'p_cell5',    type: 'empty', art: 'cell', col: 3, row: 0 }, { id: 'p_cell6', type: 'empty', art: 'cell', col: 4, row: 0 },
    ],
    startSystems: ['oxygen', 'weapons', 'engines', 'carbonite', 'reactor'],
    systemLevels: { oxygen: 2, weapons: 1, engines: 1, carbonite: 2 },
    startWeapons: [], reactorLevel: 6, reactorMax: 10, weaponSlots: 1,
  });
}

const Prison = (() => {
  const NAMES = ['Tycho Penal Block', 'Aitken Deep Holding', 'Mare Frigoris Gaol', 'Grimaldi Stockade', 'Copernicus Detention', 'Kepler Hard Cells'];
  /** What the warden asks for the map (jj: about 60 + 30 a sector). */
  const wardenPrice = (sector) => 60 + 30 * Math.max(1, sector | 0);
  /** A prison, for a node: what the view and the deeds need, nothing else. */
  function make(sector, seed) {
    const s = Math.abs(seed | 0);
    return { isPrison: true, sector: Math.max(1, sector | 0), seed: s, name: NAMES[s % NAMES.length],
             block: 'ABCDEF'[(s >> 3) % 6], asked: false, sold: false, nodeId: null };
  }
  return { make, wardenPrice, NAMES };
})();

const PrisonView = (() => {
  const W = 1280, H = 720;
  const WIN = { x: 0, y: 50, w: W, h: 250 };
  const DESK = [{ key: 'INTAKE', col: '#c9a6ff', x: 16 }, { key: 'INTERROGATION', col: '#ff5566', x: 438 }, { key: 'THE WARDEN', col: '#ffd700', x: 860 }];
  const DESK_Y = 318, DESK_W = 404, DESK_H = 318;
  const DEPART = { x: 1100, y: 664, w: 160, h: 44 };
  const KEEPERS = [{ name: 'Officer Brann', race: 'terra' }, { name: 'Sgt. Hollis', race: 'phoenix' }, { name: 'Warden Okoye', race: 'pegasus' }];
  const SAYS = ['"Slabs and paperwork. Freeze-dried or alive, we sign for them."',
                '"Leave him with me for an hour. You will get your map."',
                '"There are things on this map nobody charts. I know where."'];
  const TALK = ['"Two transports came in frozen this week. One woke on the way. Keep your power up."',
                '"The mess cat caught three this shift. The mice are winning anyway."',
                '"A courier cut his slab power to save a gun. The man he carried is on the board now."',
                '"Block C is full. Whoever you bring, he gets a field and a bunk and no view."'];
  const STAFF = '#5f7392', GUARD = '#38506e', WARDEN = '#b08a3a', INMATE = '#e07020';
  const INMATES = ['Dag Morrow', 'Vic Hale', 'Sel Brandt', 'Oona Pike', 'Rask Vole', 'Bo Linde', 'Juno Teague', 'Kerr Duval', 'Tor Hallam', 'Ines Coyle'];

  let _p = null, _ship = null, _opts = {}, _t = 0, _zones = [], _sel = null, _hot = null;
  let _block = null, _ours = null, _anims = new Map(), _lastT = null;

  function open(prison, ship, opts = {}) {
    _p = prison; _ship = ship; _opts = opts; _t = 0; _sel = null; _hot = null;
    _block = null; _ours = null; _anims = new Map(); _lastT = null;
  }
  function close() { _p = null; _ship = null; _block = null; _ours = null; }
  const isOpen = () => !!_p;

  /* ── the deeds' inputs, read by the view and by the tests ── */
  const sector = () => _p?.sector ?? 1;
  function intake() { return (typeof Base !== 'undefined' && Base.intakeRows) ? Base.intakeRows(_ship, sector()) : []; }
  /** Who can be questioned: the men you caught, never a transport's convict. */
  function suspects() { return intake().filter(r => r.kind !== 'job'); }
  function hidden() { return typeof _opts.hidden === 'function' ? _opts.hidden() : 0; }
  function purse() { return (typeof Save !== 'undefined' && Save.getRun?.()?.scrap) || 0; }
  /** Why the interrogation cannot be had now, or null. */
  function askRefusal(id = _sel) {
    if (_p?.asked) return 'once a visit — he has talked already';
    if (!suspects().length) return 'nobody to question — bring a captive';
    if (!hidden()) return 'you know this whole map already';
    if (!suspects().some(r => r.id === id)) return 'pick who talks';
    return null;
  }
  function wardenRefusal() {
    if (_p?.sold) return 'he has told you all he knows';
    if (!hidden()) return 'nothing on this map he could show you';
    if (purse() < Prison.wardenPrice(sector())) return `${Prison.wardenPrice(sector())} CC — you have ${purse()}`;
    return null;
  }

  function update(dt) {
    if (!_p) return null;
    _t += dt;
    const mx = Input.mouse.x, my = Input.mouse.y;
    const z = _zones.find(q => Utils.pointInRect(mx, my, q.x, q.y, q.w, q.h)) || null;
    _hot = z ? `${z.act}:${z.id ?? ''}` : null;
    if (z) Audio.hoverCue?.(`prison:${_hot}`);
    if (!Input.mouse.leftPressed || !z) return null;
    Audio.sfx?.uiClick?.();
    if (z.act === 'pick') { _sel = z.id; return null; }
    if (z.act === 'ask') return askRefusal(z.id) ? null : { act: 'ask', id: z.id };
    if (z.act === 'warden') return wardenRefusal() ? null : { act: 'warden' };
    if (z.act === 'hand') return { act: 'hand', id: z.id };
    if (z.act === 'depart') return { act: 'depart' };
    return null;
  }

  /* ── drawing ─────────────────────────────────────────────── */
  let ctx = null;
  const F = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const T = (s, x, y, col, size, al = 'left', bold = false, font = 'Share Tech Mono') => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
  function wrap(s, x, y, w, lh, col, size) {
    ctx.font = `${size}px Share Tech Mono, monospace`; ctx.fillStyle = col; ctx.textAlign = 'left';
    let line = '', yy = y;
    for (const wd of String(s).split(' ')) {
      if (line && ctx.measureText(line + wd).width > w) { ctx.fillText(line, x, yy); yy += lh; line = ''; }
      line += wd + ' ';
    }
    ctx.fillText(line, x, yy);
    return yy;
  }
  function btn(x, y, w, h, label, sub, col, act, id, live) {
    const hot = live && _hot === `${act}:${id ?? ''}`;
    F(x, y, w, h, live ? (hot ? col + '33' : col + '1a') : 'rgba(20,24,34,0.9)');
    ctx.strokeStyle = live ? col : '#3a4458'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    T(label, x + w / 2, y + (sub ? h / 2 + 1 : h / 2 + 5), live ? col : '#5a6478', 13, 'center', true, 'Orbitron');
    if (sub) T(sub, x + w / 2, y + h / 2 + 15, live ? '#a8b8cc' : '#5a6478', 9, 'center');
    if (live) _zones.push({ act, id, x, y, w, h });
  }

  /** The block and our ship in the window — both hulls, one scale. */
  function _ensureHulls() {
    if (!_block) {
      const tmp = new Ship('prison_block', true, 0, 0), b = tmp.roomBounds();
      _block = new Ship('prison_block', true, Math.round(W - 30 - b.w - b.x), Math.round(175 - b.h / 2 - b.y));
      _block.isPreview = true; _block._allocateDefaultPower?.();
      _block._B = _block.roomBounds();
    }
    if (!_ours && _ship) {
      const key = _ship.layoutKey ?? 'scout', DOCK = _dockRect();
      const tmp = new Ship(key, true, 0, 0), b = tmp.roomBounds();
      const cx = DOCK.w / 2 - 40 + DockArt.shiftFor(key, DOCK, DOCK.w / 2 - 40), cy = 175;
      _ours = new Ship(key, true, Math.round(cx - b.w / 2 - b.x), Math.round(cy - b.h / 2 - b.y));
      _ours.isPreview = true; _ours._allocateDefaultPower?.();
    }
  }
  const _dockRect = () => ({ x: 0, y: WIN.y, w: Math.round((_block?._B?.x ?? 700)) - 14, h: WIN.h });

  /** One of the block's people this frame: a frame of his state, at his place. */
  function _man(key, rec, state, x, y, dir, dt) {
    let a = _anims.get(key);
    if (!a || a.crewState !== state) { a = CrewArt.anim(state, rec); _anims.set(key, a); }
    a.update(dt);
    ctx.save(); if (dir < 0) { ctx.scale(-1, 1); ctx.translate(-x * 2, 0); } a.draw(ctx, x, y, 32, 32); ctx.restore();
  }
  const rec = (name, race, suit, bare = false) => ({ name, race, bare, suitColor: () => suit });
  /** Back and forth between x0 and x1 at v px/s, a pause at each end. */
  function pace(t, x0, x1, v, wait, ph = 0) {
    const L = Math.abs(x1 - x0), leg = L / v, P = 2 * (leg + wait), k = ((t + ph) % P + P) % P, d = x1 > x0 ? 1 : -1;
    if (k < wait) return { x: x0, dir: d, moving: false };
    if (k < wait + leg) return { x: x0 + (x1 - x0) * (k - wait) / leg, dir: d, moving: true };
    if (k < 2 * wait + leg) return { x: x1, dir: -d, moving: false };
    return { x: x1 + (x0 - x1) * (k - 2 * wait - leg) / leg, dir: -d, moving: true };
  }
  /** Which cells are held — seeded per prison, so the block is the same block on every visit. */
  function heldCells() {
    const s = _p?.seed ?? 0, out = {};
    ['p_cell1', 'p_cell2', 'p_cell3', 'p_cell4', 'p_cell5', 'p_cell6'].forEach((id, i) => { if (((s >> i) & 1) || i === 0 || i === 3) out[id] = i + 1; });
    return out;
  }

  function _drawPeople(t, dt) {
    const pr = _block, R = id => pr.rooms.find(r => r.id === id);
    const WALK = walkOffset(), LIFT = Ship.OPERATOR_LIFT, wy = r => r.y + WALK, s0 = _p.seed ?? 0;
    const inmate = k => INMATES[(s0 + k * 7) % INMATES.length];
    // at the consoles: the gunner, the air tech, the gravity tech, security, intake
    [['p_weapons', 'Cpl. Dace', 'terra', GUARD], ['p_oxygen', 'Tech Imre', 'aquarius', STAFF], ['p_gravity', 'Tech Sola', 'pegasus', STAFF],
     ['p_security', 'Sgt. Hollis', 'phoenix', GUARD], ['p_intake', 'Officer Brann', 'terra', STAFF]].forEach(([id, n, race, suit], i) => {
      const r = R(id); _man('op' + i, rec(n, race, suit), 'operate', r.x + r.w / 2, wy(r) - LIFT, 1, dt);
    });
    { const r = R('p_warden'), p = pace(t, r.x + 50, r.x + 16, 14, 5);       // the warden: his chart, his files
      _man('warden', rec('Warden Okoye', 'pegasus', WARDEN), p.moving ? 'walk' : 'operate', p.x, wy(r) - (p.moving ? 0 : LIFT), p.dir, dt); }
    { const r = R('p_intake'), by = r.floorTop + 9 + ((t * 18) % 30);       // a new man in the arch, the beam down him
      _man('new', rec(inmate(1), 'terra', INMATE, true), 'idle', r.x + 14, wy(r), 1, dt);
      F(r.x + 7, by, 14, 1, 'rgba(201,166,255,0.75)'); F(r.x + 7, by - 3, 14, 3, 'rgba(201,166,255,0.18)'); }
    { const r = R('p_decon'), on = (t % 6) < 4;                              // one under the spray, a guard at the door
      _man('wash', rec(inmate(2), 'aquarius', INMATE, true), 'idle', r.x + 42, wy(r), 1, dt);
      if (on) {
        for (let k = 0; k < 4; k++) for (let q = 0; q < 5; q++)
          F(r.x + 17 + k * 14 + ((q * 3) % 5) - 2, r.floorTop + 12 + ((t * 70 + q * 9 + k * 5) % 30), 1, 2, 'rgba(160,225,255,0.7)');
        F(r.x + 10, r.floorTop + 10, 64, 34, 'rgba(160,225,255,0.07)');
      }
      _man('dguard', rec('Pvt. Moss', 'phoenix', GUARD), 'idle', r.x + 70, wy(r), -1, dt); }
    { const r = R('p_freezer');                                               // two transports on ice
      [[0, inmate(3), 'phoenix'], [2, inmate(4), 'terra']].forEach(([i, n, race]) => {
        const s2 = pr.slabRect(r, i), a = CrewArt.anim('idle', rec(n, race, INMATE, true));
        ctx.save(); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.rect(s2.x, s2.y, s2.w, s2.h); ctx.clip();
        const sc = Math.min(1, (s2.h - 2) / 41, (s2.w + 6) / 26);
        ctx.translate(s2.x + s2.w / 2, s2.y + s2.h / 2); ctx.scale(sc, sc); a.draw(ctx, 0, 3.5, 32, 32); ctx.restore();
        F(s2.x, s2.y, s2.w, s2.h, 'rgba(127,212,255,0.22)');
        ctx.strokeStyle = 'rgba(200,240,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(s2.x + 2, s2.y + 8); ctx.lineTo(s2.x + s2.w - 2, s2.y + 13); ctx.moveTo(s2.x + 2, s2.y + 20); ctx.lineTo(s2.x + s2.w - 2, s2.y + 15); ctx.stroke();
      }); }
    { const r = R('p_mess');                                                  // two eating, a guard walking the room
      _man('eat1', rec(inmate(5), 'terra', INMATE, true), 'eat', r.x + 42, wy(r), 1, dt);
      _man('eat2', rec(inmate(6), 'aquarius', INMATE, true), 'eat', r.x + 62, wy(r), 1, dt);
      const p = pace(t, r.x + 10, r.x + 88, 16, 3, 2);
      _man('mguard', rec('Pvt. Arno', 'terra', GUARD), p.moving ? 'walk' : 'idle', p.x, wy(r), p.dir, dt); }
    const held = heldCells(), races = ['phoenix', 'terra', 'pegasus', 'aquarius'];
    pr.rooms.filter(r => r.art === 'cell').forEach(r => {                   // the held ones pace and stand at the field
      const k = held[r.id]; if (!k) return;
      const p = pace(t, r.x + 44, r.x + 74, 9 + k * 2, 2.5 + k, k * 3.1);
      _man('cell' + k, rec(inmate(7 + k), races[k % 4], INMATE, true), p.moving ? 'walk' : 'idle', p.x, wy(r), p.dir, dt);
    });
    _drawHunt(t, dt, R('p_mess'), R('p_cell5'), wy);
    // the fields over the cells, in front of everybody in them
    pr.rooms.filter(r => r.art === 'cell').forEach(r => {
      const on = !!held[r.id], fc = on ? '201,166,255' : '122,208,255', h = r.floorH;
      F(r.x + 2, r.floorTop + 2, r.w - 4, h - 7, `rgba(${fc},${on ? 0.13 : 0.05})`);
      for (let q = 0; q < 2; q++) F(r.x + 2, r.floorTop + 2 + ((t * 16 + q * 17 + r.x) % (h - 8)), r.w - 4, 1, `rgba(${fc},0.45)`);
    });
  }

  /* THE CAT AND THE MICE (jj: "dodaj kota i myszy, niech kot poluje czasami
     na nie"): one hunt every 14 s on the deck of the mess — the mouse at the
     crumbs, the cat watching, the creep, the run for the hole in the next
     cell's wall; every other hunt she gets it and walks back with it. */
  const HUNT = 14;
  function huntPhase(t) {
    const k = ((t % HUNT) + HUNT) % HUNT, lucky = Math.floor(t / HUNT) % 2 === 1;
    if (k < 6) return { k, phase: 'watch', lucky };
    if (k < 6.6) return { k, phase: 'creep', lucky };
    if (k < 8.6) return { k, phase: 'run', lucky };
    return { k, phase: 'back', lucky };
  }
  function _drawHunt(t, dt, r, r2, wy) {
    const floor = wy(r) + HULL_GRID.FEET, hole = r2.x + r2.w - 12, h = huntPhase(t), k = h.k;
    let mx = r.x + 50, mdir = 1, cx = r.x + 16, cdir = 1, cstate = 'idle', mouse = true, carry = false;
    if (h.phase === 'watch') { mx = r.x + 50 + Math.sin(t * 1.3) * 6; mdir = Math.cos(t * 1.3) > 0 ? 1 : -1; }
    else if (h.phase === 'creep') { cx = r.x + 16 + (k - 6) * 30; cstate = 'walk'; }
    else if (h.phase === 'run') {
      const q = (k - 6.6) / 2; mx = r.x + 50 + (hole - r.x - 50) * q; cx = r.x + 34 + (hole - 6 - r.x - 34) * Math.min(1, q * 1.02); cstate = 'walk';
      if (h.lucky && q > 0.82) mouse = false;
    } else {
      const q = Math.min(1, (k - 8.6) / 4.5); mouse = false;
      cx = hole - 6 + (r.x + 16 - hole + 6) * q; cdir = q < 1 ? -1 : 1; cstate = q < 1 ? 'walk' : 'idle'; carry = h.lucky && q < 0.25;
    }
    F(hole + 2, floor - 5, 6, 5, '#05060a');
    if ((t % 5) < 3) { F(hole + 2, floor - 4, 3, 3, '#8a7a6a'); F(hole + 2, floor - 3, 1, 1, '#ff6a6a'); }   // the one that never gets caught
    if (mouse && typeof Animation !== 'undefined') {
      const key = h.phase === 'watch' ? 'mouseIdle' : 'mouseRun';
      let a = _anims.get(key); if (!a) { a = Animation.ratAnim(h.phase === 'watch' ? 'idle' : 'walk', '#8a7a6a'); _anims.set(key, a); }
      a.update(dt);
      const s2 = 0.6; ctx.save(); if (mdir < 0) { ctx.scale(-1, 1); ctx.translate(-mx * 2, 0); } a.draw(ctx, mx, floor - 8 * s2, 32 * s2, 32 * s2); ctx.restore();
    }
    if (typeof Animation !== 'undefined') {
      const key = 'cat_' + cstate;
      let a = _anims.get(key); if (!a) { a = Animation.catAnim(cstate, '#3a3a42'); _anims.set(key, a); }
      a.update(dt * (cstate === 'walk' ? 1.6 : 1));
      ctx.save(); if (cdir < 0) { ctx.scale(-1, 1); ctx.translate(-cx * 2, 0); } a.draw(ctx, cx, wy(r), 32, 32); ctx.restore();
      if (carry) F(cx - 9, floor - 7, 3, 2, '#8a7a6a');
    }
  }

  function _drawWindow(t, dt) {
    _ensureHulls();
    const pr = _block, PB = pr._B, DOCK = _dockRect();
    F(WIN.x, WIN.y, WIN.w, WIN.h, '#04050a');
    ctx.save(); ctx.beginPath(); ctx.rect(WIN.x, WIN.y, WIN.w, WIN.h); ctx.clip();
    ctx.fillStyle = '#1c1d22'; ctx.beginPath(); ctx.moveTo(PB.x - 40, 300); ctx.lineTo(PB.x - 10, 70); ctx.lineTo(W, 56); ctx.lineTo(W, 300); ctx.fill();
    if (_ours) {
      DockArt.draw(ctx, DOCK, _ours);
      _ours.roofAlpha = 1; try { _ours.draw(ctx); } catch (e) { /* a picture, not the game */ }
      DockArt.drawOver(ctx, DOCK, _ours);
    }
    pr.roofAlpha = 0; try { pr.draw(ctx); } catch (e) { /* a picture, not the game */ }
    { // the gravity generator is the engines module: its display reads the field, not the evasion
      const g = pr.rooms.find(r => r.id === 'p_gravity'), D = ROOM_DISPLAY, x = g.x + D.x, y = g.floorTop + D.y;
      F(x, y, D.w, D.h, '#06140e'); F(x + 1, y + 1, D.w - 2, D.h - 2, '#0c2a1c');
      T('1.00 g', x + D.w / 2, y + 8, '#7affc8', 8, 'center', true); T('FIELD OK', x + D.w / 2, y + 14, '#3a9a6a', 6, 'center');
    }
    _drawPeople(t, dt);
    // the gate the bridge seals onto, the tower and its searchlights
    F(PB.x - 16, 150, 14, 52, '#161c2a'); F(PB.x - 16, 150, 2, 52, '#2a3448');
    F(PB.x + PB.w - 30, 54, 16, 18, '#1a1c24'); F(PB.x + PB.w - 36, 50, 28, 5, '#2a2e3a');
    [0, 1].forEach(i => {
      const x = PB.x + PB.w - 22, y = 56, a = Math.PI * 0.75 + i * 0.4 + Math.sin(t * 0.55 + i * 2.2) * 0.3;
      ctx.fillStyle = 'rgba(255,240,180,0.06)'; ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a - 0.07) * 380, y + Math.sin(a - 0.07) * 380); ctx.lineTo(x + Math.cos(a + 0.07) * 380, y + Math.sin(a + 0.07) * 380); ctx.fill();
    });
    F(PB.x + PB.w - 24, 46, 4, 4, Math.floor(t * 2) % 2 ? '#ff2d44' : '#5a1018');
    ctx.restore();
    F(0, 296, W, 6, '#2a2e3a');
  }

  function _desk(i) {
    const d = DESK[i], x = d.x, y = DESK_Y, w = DESK_W, h = DESK_H;
    F(x, y, w, h, 'rgba(14,16,24,0.95)'); ctx.strokeStyle = d.col + '88'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    F(x, y, w, 28, d.col + '22'); T(d.key, x + w / 2, y + 19, d.col, 13, 'center', true, 'Orbitron');
    const f = CrewArt.portraitCanvas(KEEPERS[i]);
    F(x + 12, y + 40, 72, 72, '#05070d');
    if (f) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(f, x + 14, y + 42, 68, 68); ctx.restore(); }
    for (let bx = x + 16; bx < x + 82; bx += 10) F(bx, y + 40, 2, 72, 'rgba(90,96,110,0.8)');
    T(KEEPERS[i].name, x + 96, y + 56, '#e8f4ff', 12, 'left', true);
    wrap(SAYS[i], x + 96, y + 74, w - 108, 13, '#a8b8cc', 10);
  }
  function _face(name, race, x, y, s) {
    const f = CrewArt.portraitCanvas({ name, race }, { bare: true, asleep: true });
    if (!f) return;
    ctx.save(); ctx.globalAlpha = 0.85; ctx.imageSmoothingEnabled = false; ctx.drawImage(f, x, y, s, s); ctx.restore();
    F(x, y, s, s, 'rgba(120,200,255,0.25)');
  }

  function _drawIntake() {
    const x = DESK[0].x + 12, y = 444, rows = intake();
    T('IN YOUR CARBONITE', x, y - 2, '#5f7893', 10);
    if (!rows.length) { wrap('Nobody in your slabs. Take a PRISONERS job at DISPATCH, or bring in a man off the WANTED board.', x, y + 22, 380, 13, '#4a6080', 10); return; }
    rows.slice(0, 4).forEach((r, k) => {
      const ry = y + 6 + k * 46;
      F(x, ry, 380, 42, 'rgba(8,12,22,0.9)');
      F(x + 4, ry + 4, 36, 36, '#8ac8ff44'); _face(r.name, r.race, x + 4, ry + 4, 36);
      T(r.name, x + 48, ry + 18, '#e8f4ff', 12, 'left', true);
      ctx.font = 'bold 12px Share Tech Mono, monospace';
      const tag = r.kind === 'job' ? 'JOB' : r.kind === 'wanted' ? 'WANTED' : 'CAUGHT';
      T(tag, x + 56 + ctx.measureText(r.name).width, ry + 18, r.kind === 'job' ? '#7ad0ff' : '#ff9a4d', 9, 'left', true);
      const what = r.kind === 'job' ? (r.ok ? `${r.job?.client ?? 'the court'} — for this prison` : r.why)
                 : r.kind === 'wanted' ? 'WANTED — the full bounty, here and now' : 'a captive — his price, here and now';
      T(what.length > 40 ? what.slice(0, 39) + '…' : what, x + 48, ry + 34, r.ok ? '#7a90a8' : '#ff7c20', 9);
      btn(x + 280, ry + 8, 96, 28, 'HAND OVER', r.ok ? (r.kind === 'job' ? 'the job' : `+${r.pay} CC`) : 'refused', '#1aff8c', 'hand', r.id, r.ok);
    });
    if (rows.length > 4) T(`+${rows.length - 4} more — hand these over first`, x + 200, y - 2, '#7a90a8', 9);
  }
  function _drawInterrogation() {
    const x = DESK[1].x + 12, y = 446, sus = suspects();
    if (_sel == null || !sus.some(r => r.id === _sel)) _sel = sus[0]?.id ?? null;
    wrap('One of your captives, an hour in the back room: the block\'s men know every lane of this sector. He goes into the intake after.', x, y, 380, 13, '#a8b8cc', 10);
    T('WHO TALKS', x, y + 52, '#5f7893', 10);
    if (!sus.length) T('nobody — a transport\'s convict stays frozen', x, y + 74, '#4a6080', 10);
    sus.slice(0, 2).forEach((r, k) => {
      const ry = y + 60 + k * 30, on = r.id === _sel;
      F(x, ry, 380, 26, on ? 'rgba(255,85,102,0.12)' : 'rgba(8,10,16,0.9)');
      ctx.strokeStyle = on ? '#ff5566' : '#2a3346'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, ry + 0.5, 379, 25);
      T(r.name, x + 10, ry + 17, '#e8f4ff', 11); T(r.kind === 'wanted' ? 'WANTED · knows the pirates\' lanes' : 'a captive · he knows the lanes', x + 150, ry + 17, '#7a90a8', 9);
      _zones.push({ act: 'pick', id: r.id, x, y: ry, w: 380, h: 26 });
    });
    const why = askRefusal(), who = sus.find(r => r.id === _sel);
    btn(x, y + 132, 380, 40, who && !why ? `INTERROGATE ${who.name.toUpperCase()}  ▶` : 'INTERROGATE', why ?? 'the whole sector map — once a visit', '#ff5566', 'ask', _sel, !why);
  }
  function _drawWarden() {
    const x = DESK[2].x + 12, y = 446, n = hidden(), price = Prison.wardenPrice(sector()), why = wardenRefusal();
    wrap('Caches, wrecks, a quiet berth — the places no probe shows. He has them on paper and paper costs.', x, y, 380, 13, '#a8b8cc', 10);
    T('THIS SECTOR', x, y + 52, '#5f7893', 10);
    T(n ? `somewhere on this map, unseen: ${n} place${n > 1 ? 's' : ''}` : 'you have seen all of this map', x, y + 70, n ? '#ffd780' : '#4a6080', 12, 'left', true);
    T('(a survey probe or the VA 243 seal shows them too)', x, y + 88, '#5f7893', 9);
    btn(x, y + 132, 380, 40, `PAY ${price} CC — SHOW ME  ▶`, why ?? 'the hidden places on this map', '#ffd700', 'warden', null, !why);
  }

  function draw(c) {
    if (!_p) return;
    ctx = c; _zones = [];
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const dt = _lastT == null ? 0 : Math.min(0.05, now - _lastT); _lastT = now;
    const t = _t;
    ctx.save();
    F(0, 0, W, H, '#05070d');
    _drawWindow(t, dt);
    // the header
    F(0, 0, W, 50, 'rgba(5,6,10,0.85)'); F(0, 49, W, 1, '#c9a6ff');
    T(`⛓ ${String(_p.name).toUpperCase()}`, 24, 30, '#c9a6ff', 22, 'left', false, 'Orbitron');
    T('PRISON — intake, questions, and a warden who sells what he knows', 24, 44, '#7a90a8', 11);
    const held = Object.keys(heldCells()).length;
    T(`BLOCK ${_p.block} · 6 CELLS · ${held} HELD · 2 ON ICE · FIELDS ON`, 560, 30, '#8a8e9a', 11, 'left', true);
    if (_ship) {
      const hc = _ship.hull < _ship.hullMax * 0.34 ? '#ff2d44' : _ship.hull < _ship.hullMax * 0.67 ? '#ffd700' : '#1aff8c';
      T(`HULL ${_ship.hull}/${_ship.hullMax}`, 900, 30, hc, 13);
      const cap = _ship.getSystem?.('carbonite')?.level ?? 0, used = (_ship.prisoners?.length ?? 0) + (_ship.frozenCrew?.().length ?? 0);
      T(`CARB ${used}/${cap}`, 1010, 30, '#9fe8ff', 13);
    }
    T(`${purse()} CC`, 1250, 32, '#ffd700', 19, 'right');
    // the counters
    F(0, 302, W, 418, '#0b0c12');
    for (let x = 0; x < W; x += 64) F(x, 302, 2, 334, 'rgba(201,166,255,0.04)');
    [0, 1, 2].forEach(_desk);
    _drawIntake(); _drawInterrogation(); _drawWarden();
    // the foot: what the block says, DEPART
    F(20, 664, 1060, 44, 'rgba(8,10,16,0.95)'); ctx.strokeStyle = '#c9a6ff88'; ctx.lineWidth = 1; ctx.strokeRect(20.5, 664.5, 1059, 43);
    T('THE BLOCK:', 34, 682, '#c9a6ff', 10, 'left', true); T(TALK[(_p.seed ?? 0) % TALK.length], 34, 698, '#a8b8cc', 11);
    const dh = _hot === 'depart:';
    F(DEPART.x, DEPART.y, DEPART.w, DEPART.h, dh ? 'rgba(255,124,32,0.16)' : 'rgba(20,10,4,0.9)');
    ctx.strokeStyle = '#ff7c20'; ctx.strokeRect(DEPART.x + 0.5, DEPART.y + 0.5, DEPART.w - 1, DEPART.h - 1);
    T('DEPART ▶', DEPART.x + DEPART.w / 2, DEPART.y + 28, '#ff7c20', 15, 'center', false, 'Orbitron');
    _zones.push({ act: 'depart', id: undefined, ...DEPART });
    ctx.restore();
    ctx.textAlign = 'left';
  }

  return {
    open, close, isOpen, update, draw, intake, suspects, hidden, askRefusal, wardenRefusal, heldCells, huntPhase, pace,
    DESK, DEPART,
    /** For tests: what can be clicked, and where. */
    _zonesFor: (act) => _zones.filter(z => z.act === act),
    _state: () => ({ prison: _p, ship: _ship, sel: _sel, block: _block, ours: _ours }),
    _select: (id) => { _sel = id; },
  };
})();

if (typeof window !== 'undefined') { window.Prison = Prison; window.PrisonView = PrisonView; }
