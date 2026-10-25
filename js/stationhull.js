/* ============================================================
   MOON WARS — stationhull.js  (update168)
   The port is a HULL — the standard the prison set (update163).

   jj, 24–25.10 (mk_station): the port's window shows OUR ship moored by
   the jet bridge to the STATION, a hull of the same modules, with the
   stalls as its rooms — the drydock, the gunsmith's gun deck, the
   quartermaster's store, the bar, the clinic, the broker's office —
   and the rest a station needs: customs, the gate, air, gravity, guns,
   quarters. "Tak" to rooms of their own (tools/room_painter.js: bar,
   storage, broker, customs, gate, dock, lab, quarters); every kind of
   port its own layout ("inne kształty … może być więcej dział"); the
   Earth small in the sky, after the cataclysm.

   StationScene.draw(ctx, station, ship, hotStall, t) paints the window
   (y 50–300) — the sky, the ground, our hull at the bridge, the station
   with its people, and the room of the stall under the pointer lit in
   that stall's colour. PortView calls it; nothing here moves money.
   ============================================================ */

'use strict';

/* ── THE FOUR KINDS OF PORT, AS HULLS ───────────────────────── */
const STATION_HULLS = (() => {
  const R = (id, type, col, row, art = null) => ({ id, type, col, row, ...(art ? { art } : {}) });
  /** Which room each stall is (PortView.STALLS keys). The bar may span two. */
  const STALL_ROOMS = {
    drydock: ['s_dock'], guns: ['s_guns'], qm: ['s_store'], bar: ['s_bar', 's_bar2'], clinic: ['s_clinic'], broker: ['s_broker'],
  };
  const COMMON = { spriteKey: 'ship_enemy', isStation: true, grounded: true, immobile: true, structure: true, armor: 2,
                   startWeapons: [], reactorLevel: 10, reactorMax: 12, weaponSlots: 3, originX: 20, originY: 20, decks: 3 };
  return {
    /* a trade port: the classic block, its top-right corner cut away */
    general: { label: 'Trade Port', builder: 'pegasus', hullMax: 70, shaftAfter: [1],
      grid: [R('s_weapons', 'weapons', 0, 2), R('s_customs', 'empty', 1, 2, 'customs'), R('s_broker', 'empty', 2, 2, 'broker'), R('s_clinic', 'medbay', 3, 2),
             R('s_gate', 'empty', 0, 1, 'gate'), R('s_store', 'empty', 1, 1, 'storage'), R('s_bar', 'empty', 2, 1, 'bar'), R('s_bar2', 'empty', 3, 1, 'bar'), R('s_guns', 'artillery', 4, 1),
             R('s_oxygen', 'oxygen', 0, 0), R('s_gravity', 'engines', 1, 0), R('s_dock', 'empty', 2, 0, 'dock'), R('s_quarters', 'empty', 3, 0, 'quarters'), R('s_shields', 'shields', 4, 0)],
      startSystems: ['weapons', 'medbay', 'artillery', 'oxygen', 'engines', 'shields', 'reactor'], systemLevels: { oxygen: 2 } },
    /* a fleet yard: the full block and three gun decks on top */
    military: { label: 'Fleet Yard', builder: 'phoenix', hullMax: 110, shaftAfter: [1],
      grid: [R('s_weapons', 'weapons', 0, 2), R('s_customs', 'empty', 1, 2, 'customs'), R('s_weapons2', 'weapons', 2, 2), R('s_broker', 'empty', 3, 2, 'broker'), R('s_weapons3', 'weapons', 4, 2),
             R('s_gate', 'empty', 0, 1, 'gate'), R('s_store', 'empty', 1, 1, 'storage'), R('s_bar', 'empty', 2, 1, 'bar'), R('s_guns', 'artillery', 3, 1), R('s_clinic', 'medbay', 4, 1),
             R('s_oxygen', 'oxygen', 0, 0), R('s_gravity', 'engines', 1, 0), R('s_dock', 'empty', 2, 0, 'dock'), R('s_quarters', 'empty', 3, 0, 'quarters'), R('s_quarters2', 'empty', 4, 0, 'quarters')],
      startSystems: ['weapons', 'medbay', 'artillery', 'oxygen', 'engines', 'reactor'], systemLevels: { oxygen: 2 } },
    /* a science post: a dome of labs over a narrow ring */
    science: { label: 'Science Post', builder: 'aquarius', hullMax: 60, shaftAfter: [1],
      grid: [R('s_lab', 'empty', 1, 2, 'lab'), R('s_lab2', 'empty', 2, 2, 'lab'), R('s_broker', 'empty', 3, 2, 'broker'),
             R('s_gate', 'empty', 0, 1, 'gate'), R('s_customs', 'empty', 1, 1, 'customs'), R('s_clinic', 'medbay', 2, 1), R('s_bar', 'empty', 3, 1, 'bar'), R('s_store', 'empty', 4, 1, 'storage'),
             R('s_oxygen', 'oxygen', 0, 0), R('s_gravity', 'engines', 1, 0), R('s_dock', 'empty', 2, 0, 'dock'), R('s_guns', 'weapons', 3, 0), R('s_shields', 'shields', 4, 0)],
      startSystems: ['medbay', 'weapons', 'oxygen', 'engines', 'shields', 'reactor'], systemLevels: { oxygen: 2 } },
    /* an outpost: three modules wide, no customs, one gun */
    outpost: { label: 'Outpost', builder: 'terra', hullMax: 40, shaftAfter: [0],
      grid: [R('s_weapons', 'weapons', 0, 2), R('s_broker', 'empty', 1, 2, 'broker'), R('s_clinic', 'medbay', 2, 2),
             R('s_gate', 'empty', 0, 1, 'gate'), R('s_bar', 'empty', 1, 1, 'bar'), R('s_store', 'empty', 2, 1, 'storage'),
             R('s_oxygen', 'oxygen', 0, 0), R('s_dock', 'empty', 1, 0, 'dock'), R('s_guns', 'artillery', 2, 0)],
      startSystems: ['weapons', 'medbay', 'artillery', 'oxygen', 'reactor'], systemLevels: { oxygen: 2 } },
    STALL_ROOMS, COMMON,
  };
})();

if (typeof STRUCTURE_LAYOUTS !== 'undefined' && typeof buildHull === 'function') {
  ['general', 'military', 'science', 'outpost'].forEach(kind => {
    const key = 'station_' + kind;
    if (STRUCTURE_LAYOUTS[key]) return;
    const spec = STATION_HULLS[kind];
    STRUCTURE_LAYOUTS[key] = buildHull({ ...STATION_HULLS.COMMON, ...spec, grid: spec.grid.map(r => ({ ...r })) });
  });
}

const StationScene = (() => {
  const W = 1280, WIN = { x: 0, y: 50, w: W, h: 250 };
  /** The hull a port of this kind is. */
  const layoutKey = (type) => 'station_' + (STATION_HULLS[type] ? type : 'general');

  let _key = '', _st = null, _ours = null, _dock = null, _anims = new Map(), _lastT = null;
  function _ensure(station, ship) {
    const key = `${layoutKey(station?.type)}|${ship?.layoutKey ?? 'scout'}`;
    if (_key === key && _st) return;
    _key = key; _anims = new Map();
    const lk = layoutKey(station?.type);
    const tmp = new Ship(lk, true, 0, 0), b = tmp.roomBounds();
    _st = new Ship(lk, true, Math.round(W - 30 - b.w - b.x), Math.round(175 - b.h / 2 - b.y));
    _st.isPreview = true; _st._allocateDefaultPower?.();
    _st._B = _st.roomBounds();
    _dock = { x: 0, y: WIN.y, w: Math.round(_st._B.x) - 14, h: WIN.h };
    const sk = ship?.layoutKey ?? 'scout';
    const t2 = new Ship(sk, true, 0, 0), b2 = t2.roomBounds();
    const cx = _dock.w / 2 - 40 + (typeof DockArt !== 'undefined' ? DockArt.shiftFor(sk, _dock, _dock.w / 2 - 40) : 0);
    _ours = new Ship(sk, true, Math.round(cx - b2.w / 2 - b2.x), Math.round(175 - b2.h / 2 - b2.y));
    _ours.isPreview = true; _ours._allocateDefaultPower?.();
  }

  /** The rooms of the stall `key` on this port's hull (for the light, and for tests). */
  function stallRooms(key) {
    if (!_st) return [];
    return (STATION_HULLS.STALL_ROOMS[key] ?? []).map(id => _st.getRoomById(id)).filter(Boolean);
  }

  function _man(ctx, key, rec, state, x, y, dir, dt) {
    let a = _anims.get(key);
    if (!a || a.crewState !== state) { a = CrewArt.anim(state, rec); _anims.set(key, a); }
    a.update(dt);
    ctx.save(); if (dir < 0) { ctx.scale(-1, 1); ctx.translate(-x * 2, 0); } a.draw(ctx, x, y, 32, 32); ctx.restore();
  }
  const rec = (name, race, suit, bare = false) => ({ name, race, bare, suitColor: () => suit });
  const RACES = ['terra', 'phoenix', 'aquarius', 'pegasus'];

  /** Who is where: on duty in helmets at the consoles, off duty bare in the bar and the quarters (jj's rule). */
  function _people(ctx, t, dt, seed) {
    const WALK = walkOffset(), LIFT = Ship.OPERATOR_LIFT;
    _st.rooms.forEach((r, i) => {
      const y = r.y + WALK, race = RACES[(seed + i) % 4], cx = r.x + r.w / 2;
      const kind = r.art ?? r.type;
      if (kind === 'bar') {
        _man(ctx, r.id + 'a', rec('Patron ' + r.id, race, ['#4a6a8a', '#6a4a3a', '#3a5a4a', '#5a3a6a'][i % 4], true), 'eat', r.x + 40, y, 1, dt);
        _man(ctx, r.id + 'b', rec('Patron b' + r.id, RACES[(seed + i + 1) % 4], ['#6a5a3a', '#3a4a6a'][i % 2], true), (i % 2) ? 'idle' : 'eat', r.x + 64, y, -1, dt);
      } else if (kind === 'gate') {
        const p = ((t * 18 + i * 13) % 140), x = r.x + 14 + (p < 70 ? p : 140 - p);
        _man(ctx, r.id, rec('Docker ' + r.id, race, '#8a7a52'), 'walk', x, y, p < 70 ? 1 : -1, dt);
      } else if (kind === 'dock') {
        _man(ctx, r.id, rec('Welder ' + r.id, race, '#2a4a6a'), 'repair', r.x + 38, y, 1, dt);
      } else if (kind === 'quarters') {
        if (i % 2) _man(ctx, r.id, rec('Off duty ' + r.id, race, '#5f7392', true), 'idle', r.x + 52, y, 1, dt);
      } else if (kind === 'storage') {
        const p = ((t * 10 + i * 7) % 60), x = r.x + 36 + (p < 30 ? p : 60 - p);
        _man(ctx, r.id, rec('Quartermaster ' + r.id, race, '#5a4a20'), p % 30 < 4 ? 'idle' : 'walk', x, y, p < 30 ? 1 : -1, dt);
      } else if (kind === 'shields' || kind === 'engines' || kind === 'medbay') {
        if (kind !== 'medbay') _man(ctx, r.id, rec('Tech ' + r.id, race, '#5f7392'), 'operate', cx, y - LIFT, 1, dt);
        else _man(ctx, r.id, rec('Medic ' + r.id, race, '#c8e0d8'), 'idle', r.x + 28, y, 1, dt);
      } else {
        // the counters and the consoles: somebody on duty at each
        const suit = kind === 'customs' ? '#38506e' : kind === 'broker' ? '#5a5010' : kind === 'artillery' || kind === 'weapons' ? '#5a2a30' : '#5f7392';
        _man(ctx, r.id, rec('Hand ' + r.id, race, suit), 'operate', cx, y - LIFT, 1, dt);
      }
    });
  }

  function draw(ctx, station, ship, hotStall = null, t = 0) {
    if (typeof Ship === 'undefined' || typeof STRUCTURE_LAYOUTS === 'undefined') return false;
    _ensure(station, ship);
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const dt = _lastT == null ? 0 : Math.min(0.05, now - _lastT); _lastT = now;
    const PB = _st._B, seed = (station?.seed ?? 0) | 0;
    ctx.save();
    ctx.beginPath(); ctx.rect(WIN.x, WIN.y, WIN.w, WIN.h); ctx.clip();
    ctx.fillStyle = '#04050a'; ctx.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    // the sky: stars
    for (let i = 0; i < 90; i++) {
      const x = (i * 137 + seed) % W, y = 52 + (i * 71) % 230;
      ctx.fillStyle = `rgba(220,230,255,${0.25 + (i % 5) * 0.12})`; ctx.fillRect(x, y, 1, 1);
    }
    /* the Earth after the cataclysm is the bay's own backdrop (DockArt) — where the sky shows */
    // the ground
    ctx.fillStyle = '#26272c'; ctx.fillRect(0, 286, W, 14);
    if (typeof DockArt !== 'undefined') DockArt.draw(ctx, _dock, _ours);
    _ours.roofAlpha = 1; try { _ours.draw(ctx); } catch (e) { /* a picture */ }
    if (typeof DockArt !== 'undefined') DockArt.drawOver(ctx, _dock, _ours);
    _st.roofAlpha = 0; try { _st.draw(ctx); } catch (e) { /* a picture */ }
    _people(ctx, t, dt, seed);
    // the stall under the pointer lights its room, in its colour
    if (hotStall && typeof PortView !== 'undefined') {
      const col = PortView.STALLS.find(s => s.key === hotStall)?.col ?? '#ffffff';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      stallRooms(hotStall).forEach(r => { ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.fillStyle = col + '14'; ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); });
    }
    // the gate the bridge seals onto
    ctx.fillStyle = '#161c2a'; ctx.fillRect(PB.x - 16, 150, 14, 52); ctx.fillStyle = '#2a3448'; ctx.fillRect(PB.x - 16, 150, 2, 52);
    ctx.restore();
    ctx.fillStyle = '#2a2e3a'; ctx.fillRect(0, 296, W, 6);
    return true;
  }

  return { draw, stallRooms, layoutKey, _state: () => ({ station: _st, ours: _ours, dock: _dock, key: _key }) };
})();

if (typeof window !== 'undefined') { window.STATION_HULLS = STATION_HULLS; window.StationScene = StationScene; }
