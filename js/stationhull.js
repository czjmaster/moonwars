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
  /* THE WINDOW IS MOST OF THE SCREEN NOW (update192, jj 31.10: "grafiki
     sprzedawców mniejsze, post i statek zajmują większość ekranu; statek
     widoczny w całości; hangar dla statku i post dobrze połączone"). The
     whole scene — the bay with our ship, the bridge, the station — is laid
     out at full size and then SCALED to fit WIN, so no hull is ever cut.
     Our ship is OUR ship (her crew, her damage), and `interior` takes her
     roof off. */
  const W = 1280, WIN = { x: 0, y: 50, w: W, h: 404 };
  const MAX_K = 1.25;
  /** The hull a port of this kind is. */
  /* the PRISON stands at the same berth (update209, jj: "więzienie też — ten sam motyw co ze stacjami") */
  const layoutKey = (type) => type === 'prison' ? 'prison_block' : 'station_' + (STATION_HULLS[type] ? type : 'general');
  let _win = WIN;               // the window drawn into: the port's, or the prison's (update209)
  /** The room the station's gate is on: its GATE, or the prison's INTAKE. */
  const _gateRoom = (sh) => sh.rooms.find(r => (r.art ?? r.type) === 'gate') ?? sh.rooms.find(r => (r.art ?? r.type) === 'intake') ?? null;

  let _key = '', _st = null, _ours = null, _dock = null, _anims = new Map(), _lastT = null;
  let _phase = null;  // the landing's phase as last drawn (update205)
  let _L = null;      // the layout: { k, ww, wh, ox, oy } — world → screen, and where our ship's rooms go
  const _box = (sh) => sh?.hullArtGeometry?.()?.box ?? sh?.roomBounds?.();

  /* THE PORT IS ONE BUILDING (update206, jj 6.11: "przerwa pod portem, nie
     łączy się z szybem windy od rękawa; hangar z portem musi być spójny; nad
     hangarem śluza do startu i lądowania"). Drawn pictures: the HANGAR our
     ship stands in, its roof airlock shut or open, and the APRON outside the
     station stands on — one deck, one floor line. Terra's set first; a yard
     without its own takes Terra's. No pictures (the suites): the old scene. */
  const PORT_ART = {
    // the hangar's file, cut to its field: the deck's surface where the feet stand, its orange edge
    HANGAR: { w: 1536, h: 696, feet: 584, edge: 602 },
    // the apron's file: the same deck, its orange edge on the hangar's
    // …and its deck's surface: the back of it, where the hangar's feet line meets it, the front (update207)
    APRON:  { w: 1536, h: 951, edge: 857, back: 820, feet: 839, front: 855 },
    MAX_STRETCH: 1.15,          // how much wider than tall the hangar may be drawn before its sides are cut
    /* SKY OVER THE ROOF (update218, the demo review B10: "przy lądowaniu nie widać, że śluza w dachu jest otwarta —
       statek ją zasłania, bo okno sceny ucina hangar u góry"): a band of space over the hangar's picture, in the
       stage's own units, so she is seen coming down over the roof and through the opened leaves */
    HEAD: 48,
    /* THE LIFT SHAFT IS THE HANGAR'S (update207, jj: "góra szybu wind powinna się pokrywać graficznie z
       hangarem"): the column at the right of the hangar's picture is the bridge's tower — the picture
       stands with that column at the bay's edge and the drawn tower is not put over it. */
    SHAFT: { pegasus: true, phoenix: true, aquarius: true },   // v12 (update209): their hangars drawn with the lift shaft; Terra's (v11) keeps the drawn tower
    /* THE ROOF AIRLOCK'S TWO LEAVES (update214), in each hangar's file: from x0 to x1, parting at
       `mid`, from the top down to `bot` — measured where the shut and the open pictures differ */
    HATCH: { terra:    { x0: 240, x1: 1296, mid: 768, bot: 118 },
             pegasus:  { x0: 253, x1: 1321, mid: 787, bot: 80 },
             phoenix:  { x0: 236, x1: 1330, mid: 783, bot: 68 },
             aquarius: { x0: 234, x1: 1332, mid: 783, bot: 74 } },
  };
  /** The hatch of this set, or Terra's. */
  const hatchOf = (A) => PORT_ART.HATCH[A?.yard] ?? PORT_ART.HATCH.terra;

  /* THE LEAVES SLIDE (update214, jj: "wrota otwierają się płynnie, widać rozsuwanie"). The hangar
     drawn `p` of the way open: the OPEN picture, and over it the two leaves cut from the SHUT one,
     each slid `p` of its own width into its wall (and clipped there, so it disappears into it).
     Amber beacons at the ends of the opening turn while the leaves move. */
  let _hatchDrawn = null;
  function hangarPic(ctx, A, p, dx, dy, dw, dh, t = 0) {
    const H = PORT_ART.HANGAR, HT = hatchOf(A), kx = dw / H.w, ky = dh / H.h;
    p = Math.max(0, Math.min(1, p ?? 0));
    if (p <= 0.001) ctx.drawImage(A.closed, dx, dy, dw, dh);
    else {
      ctx.drawImage(A.open, dx, dy, dw, dh);
      if (p < 0.999) [[HT.x0, HT.mid, -1], [HT.mid, HT.x1, 1]].forEach(([a, b, dir]) => {
        const x = dx + a * kx, w = (b - a) * kx, h = HT.bot * ky;
        ctx.save(); ctx.beginPath(); ctx.rect(x, dy, w, h); ctx.clip();
        ctx.drawImage(A.closed, a, 0, b - a, HT.bot, x + dir * p * w, dy, w, h);
        ctx.restore();
      });
    }
    const moving = p > 0.001 && p < 0.999;
    if (moving) [HT.x0, HT.x1].forEach((sx, i) => {
      const x = dx + sx * kx, y = dy + HT.bot * ky + 4, a = (t * 6 + i * Math.PI) % (Math.PI * 2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
      g.addColorStop(0, `rgba(255,176,32,${0.55 + 0.4 * Math.max(0, Math.cos(a))})`); g.addColorStop(1, 'rgba(255,176,32,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd890'; ctx.fillRect(x - 3, y - 3, 6, 6);
    });
    _hatchDrawn = { p, x0: dx + HT.x0 * kx, x1: dx + HT.x1 * kx, mid: dx + HT.mid * kx, bot: dy + HT.bot * ky, moving };
    return _hatchDrawn;
  }

  /* SHE COMES IN THROUGH THE ROOF (update214): while she flies, nothing of her shows over the
     roof but what is in the opening — a clip of two boxes: the opening's column above the leaves'
     line, and the whole hall under it. */
  function clipToHatch(ctx, hd, w, h) {
    ctx.beginPath();
    ctx.rect(hd.x0, -4000, hd.x1 - hd.x0, hd.bot + 4000);
    ctx.rect(-4000, hd.bot, w + 8000, h + 4000 - hd.bot);
    ctx.clip();
  }
  function portArt(yard) {
    if (typeof Assets === 'undefined' || !Assets.has || !Assets.source) return null;
    const pick = (n) => [yard, 'terra'].map(y => `port_${n}_${y}`).find(k => Assets.has(k) && Assets.source(k) === 'file');
    const yc = [yard, 'terra'].find(y => ['port_hangar_' + y + '_closed', 'port_hangar_' + y + '_open'].every(k => Assets.has(k) && Assets.source(k) === 'file'));
    const ap = pick('apron');
    if (!yc || !ap) return null;
    return { yard: yc, closed: Assets.get(`port_hangar_${yc}_closed`), open: Assets.get(`port_hangar_${yc}_open`), apron: Assets.get(ap) };
  }

  function _ensure(station, ship) {
    const lk0 = layoutKey(station?.type), yard0 = STRUCTURE_LAYOUTS[lk0]?.builder ?? 'terra';
    const art = portArt(yard0);
    const key = `${lk0}|${ship?.layoutKey ?? 'scout'}|${(ship?._extraModules ?? []).length}|${art ? 1 : 0}|${_win.w}x${_win.h}`;
    if (_key === key && _st && (!ship || _ours === ship)) return;
    _key = key; _anims = new Map();
    const lk = layoutKey(station?.type);
    // a stand-in for our ship when there is none (tests, the menu)
    const sk = ship?.layoutKey ?? 'scout';
    _ours = ship ?? new Ship(sk, true, 0, 0);
    if (!ship) { _ours.isPreview = true; _ours._allocateDefaultPower?.(); }
    const tmp = new Ship(lk, true, 0, 0), sb = _box(tmp), sr = tmp.roomBounds();
    const ob = _box(_ours), orr = _ours.roomBounds();
    const JB = (typeof DockArt !== 'undefined' && DockArt.JB) ? DockArt.JB.CAB + DockArt.JB.FULL + DockArt.JB.WALL + 10 : 200;
    const dockW = ob.w + JB + 70, wantW = dockW + 14 + sb.w + 40;
    // the hangar's deck takes some of the height (update206): room for her gear and the station's guns over it
    const head = art ? PORT_ART.HEAD : 0;          // the sky over the roof (update218)
    const wantH = art ? Math.max(ob.h + 200, sb.h + 140) + head : Math.max(ob.h + 170, sb.h + 90);
    const k = Math.min(MAX_K, _win.w / wantW, _win.h / wantH);
    const ww = _win.w / k, wh = _win.h / k, cy = wh * 0.5;
    // the pictures' scale: the hangar's height is the stage's; its deck surface is the floor
    const s = (wh - head) / PORT_ART.HANGAR.h, feet = art ? Math.round(wh - (PORT_ART.HANGAR.h - PORT_ART.HANGAR.feet) * s) : null;
    /* THE STATION'S GATE LEVEL WITH THE BRIDGE (update207, jj 6.11: "troszkę
       obniżyć stację tak, aby pasowała idealnie z rękawem na tej samej
       wysokości"): the station stands nearer or further on the apron's deck
       (its base anywhere on the deck's surface, never off it), and what that
       cannot make up her gear does — she stands a little higher or lower on it */
    const LEG = (typeof DockArt !== 'undefined' && DockArt.LEG) ? DockArt.LEG : { DROP: 40, MIN_DROP: 16 };
    const keelOff = ob.y + ob.h - orr.y;
    let drop = art ? Math.max(LEG.MIN_DROP, Math.min(LEG.DROP, feet - ob.h - 8)) : 0;
    let base = art ? feet : null, level = null;
    if (art) {
      const gr = _gateRoom(tmp);
      const M = (typeof DockArt !== 'undefined' && DockArt.moorings) ? DockArt.moorings(_ours) : null;
      if (gr && M?.tube) {
        const bridgeAt = (d) => (feet - d - keelOff) - orr.y + M.tube.y + ((DockArt.JB?.DROP) ?? 0);   // the bridge's middle, her drop `d`
        const gateAt = (b) => b - (sb.y + sb.h) + gr.y + gr.h / 2 + GATE_DY;                            // the gate tube's, the station's base at `b`
        const A = PORT_ART.APRON, back = (A.feet - A.back) * s, front = (A.front - A.feet) * s;
        const want = bridgeAt(drop) - gateAt(feet);                                    // down (+) or up (−) the station would go
        const shift = Math.max(-back, Math.min(front, want));
        base = feet + shift;
        // the rest: her gear — longer lifts the bridge, shorter lowers it; her top clear of the stage's
        const rest = want - shift, top = feet - keelOff - (orr.y - ob.y);
        const most = Math.min(LEG.DROP + LEG.EXTRA, feet - ob.h - 4);
        drop = Math.round(Math.max(LEG.MIN_DROP, Math.min(Math.max(drop, most), drop + rest)));
        void top;
        level = { shift, drop, off: Math.round(gateAt(base) - bridgeAt(drop)) };
      }
    }
    // the station: its picture against the right edge, centred top to bottom — or STANDING ON THE APRON (update206)
    _st = new Ship(lk, true, Math.round(ww - 30 - (sb.x + sb.w) + 0), Math.round(art ? base - (sb.y + sb.h) : cy - (sb.y + sb.h / 2)));
    _st.isPreview = true; _st._allocateDefaultPower?.();
    _st.moored = true;                         // moored (update177); ours is moored as she is drawn
    _st._B = _st.roomBounds();
    const sArt = _box(_st);
    _dock = { x: 0, y: 0, w: Math.round(Math.min(_st._B.x - 16, sArt.x - 4)), h: wh };
    // our ship in the bay: the jet bridge's room past her bow, her rooms a little above the middle
    const cx = _dock.w / 2 - 40 + (typeof DockArt !== 'undefined' ? DockArt.shiftFor(sk, _dock, _dock.w / 2 - 40) : 0);
    const rx = Math.round(cx - orr.w / 2);
    // on the hangar's deck (update206): her keel her gear's drop over the floor
    const ry = Math.round(art ? feet - drop - keelOff : wh * 0.46 - orr.h / 2);
    _L = { k, ww, wh, rx, ry, cx, art, s, feet, base, drop, level, head };
    void sr;
  }

  /** Where the scene is on screen, and how big (for tests and for clicks). */
  function layout() { return _L ? { ..._win, k: _L.k, worldW: _L.ww, worldH: _L.wh } : null; }

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

  /** How far the roof airlock is open (update214: the phase's `hatch`; before it, open while her
   *  engines burned — update206 — and a phase without `hatch` still reads so). */
  const hatchP = (ph) => !ph ? 0 : (ph.hatch != null ? ph.hatch : (ph.engines ? 1 : 0));
  const hatchOpen = (ph) => hatchP(ph) >= 0.5;

  /** The hangar and the apron (update206): the hangar fills the bay, its roof
   *  airlock over HER; the apron from under the tower to the right edge,
   *  its deck's edge level with the hangar's. */
  function _backdrop(ctx, A, ph) {
    const { ww, wh, s, cx } = _L, H = PORT_ART.HANGAR, P = PORT_ART.APRON, head = _L.head ?? 0;
    const was = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    // the apron first: the tower and the hangar's wall stand over its left end
    const ay = head + (H.edge - P.edge) * s, aw = P.w * s, ax0 = _dock.w - 40;
    for (let x = ax0; x < ww; x += aw - 1) ctx.drawImage(A.apron, x, ay, aw, P.h * s);
    // the hangar: its height the stage's; as wide as the bay, stretched a little if it must, cut at the sides if more
    const sx = Math.min(s * PORT_ART.MAX_STRETCH, Math.max(s, _dock.w / H.w)), hw = H.w * sx;
    const shaft = PORT_ART.SHAFT[A.yard];
    const hx = shaft ? _dock.w - hw                                     // its shaft at the bay's edge (update207)
             : Math.max(_dock.w - hw, Math.min(0, cx - hw / 2));        // the airlock over her, the picture over the whole bay
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, _dock.w, wh); ctx.clip();
    if (head > 0) _sky(ctx, 0, 0, _dock.w, head, 7);                    // space over the roof (update218)
    const hd = hangarPic(ctx, A, hatchP(ph), hx, head, hw, H.h * s, _now());
    /* a bay wider than the picture (the prison's low window, update209): the back wall's windows
       go on to the left — the middle of the picture, repeated — never a black gap (its roof shut:
       the airlock is the one over her) */
    if (hx > 0.5) {
      const img = A.closed, s0 = H.w * 0.18, s1 = H.w * 0.62, sw = (s1 - s0) * sx;
      for (let x = hx; x > 0; x -= sw - 1) ctx.drawImage(img, s0, 0, s1 - s0, H.h, x - sw, head, sw, H.h * s);
    }
    ctx.restore();
    ctx.imageSmoothingEnabled = was;
    _drawn = { hangar: { x: hx, y: head, w: hw, h: H.h * s, open: hatchOpen(ph), hatch: hd, wall: hx > 0.5 }, apron: { x: ax0, y: ay, w: aw, h: P.h * s } };
  }
  /** A band of stars (update218): the space over a hangar's roof. */
  function _sky(ctx, x, y, w, h, seed = 0) {
    ctx.fillStyle = '#04050a'; ctx.fillRect(x, y, w, h);
    for (let i = 0, n = Math.round(w * h / 900); i < n; i++) {
      ctx.fillStyle = `rgba(220,230,255,${0.25 + ((i + seed) % 5) * 0.12})`;
      ctx.fillRect(x + (i * 137 + seed * 31) % w, y + (i * 71 + seed) % h, 1, 1);
    }
  }
  const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

  /** Her, on her berth or on her way: the dock under her, her hull lifted by the phase, her pads,
   *  then the bridge. Flying (`hd` — the hatch as drawn), she and her gear are clipped to the
   *  roof's opening; the bridge stands in the hall and is not. */
  function _drawBerthed(ctx, sh, ph, dockLocal, hangar, ox, oy, hd, ww, wh) {
    if (typeof DockArt === 'undefined') return;
    ctx.save();
    try {
      if (hd) clipToHatch(ctx, hd, ww, wh);
      ctx.translate(ox, oy);
      DockArt.draw(ctx, dockLocal, sh, ph, hangar);
      ctx.save(); if (ph?.lift) ctx.translate(0, -ph.lift);
      try { sh.draw(ctx); } finally { ctx.restore(); }
      if (hd) DockArt.drawOver(ctx, dockLocal, sh, ph, { ...hangar, only: 'pads' });
    } catch (e) { /* a picture */ } finally { ctx.restore(); }
    ctx.save();
    try {
      ctx.translate(ox, oy);
      DockArt.drawOver(ctx, dockLocal, sh, ph, hd ? { ...hangar, only: 'bridge' } : hangar);
    } catch (e) { /* a picture */ } finally { ctx.restore(); }
  }
  let _drawn = null, _flight = null;

  /** The station's gate (update206): a short sealed tube from the bridge's
   *  tower to the station's gate deck, its collar on the station's wall. */
  function _gate(ctx, t) {
    const g = _gateRoom(_st) ?? _st.rooms[0], PB = _st._B;
    const parts = (typeof DockArt !== 'undefined' && DockArt.bridgeArt) ? DockArt.bridgeArt() : null;
    const th = ((typeof DockArt !== 'undefined' && DockArt.JB?.H) || 60) + 4, cy = g.y + g.h / 2 + GATE_DY;
    const x0 = _dock.w - 22, x1 = PB.x + 2;
    if (parts?.tube && parts?.collar) {
      const k = th / parts.collar.height, cw = parts.collar.width * k;
      const was = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, cy - th / 2 - 2, Math.max(0, x1 - cw - x0 + 2), th + 4); ctx.clip();
      ctx.drawImage(parts.tube, x0, cy - th / 2, parts.tube.width * th / parts.tube.height, th);
      ctx.restore();
      // the collar, its bellows on the station's wall (drawn facing her: mirrored)
      ctx.save(); ctx.translate(x1, 0); ctx.scale(-1, 1); ctx.drawImage(parts.collar, 0, cy - th / 2, cw, th); ctx.restore();
      ctx.imageSmoothingEnabled = was;
    } else {
      ctx.fillStyle = '#161c2a'; ctx.fillRect(x0, cy - th / 2, x1 - x0, th); ctx.fillStyle = '#2a3448'; ctx.fillRect(x0, cy - th / 2, x1 - x0, 2);
    }
    ctx.fillStyle = Math.sin(t * 2) > -0.5 ? '#1aff8c' : '#0e4a2a'; ctx.fillRect(x1 - 8, cy - th / 2 - 6, 4, 4);
    _gateDrawn = { x0, x1, y: cy, th, room: g.id };
  }
  let _gateDrawn = null;
  const GATE_DY = 6;            // the gate tube a little under the gate room's middle: level with its floor's doorway

  function draw(ctx, station, ship, hotStall = null, t = 0, opts = {}) {
    if (typeof Ship === 'undefined' || typeof STRUCTURE_LAYOUTS === 'undefined') return false;
    _win = opts.win ?? WIN;
    _ensure(station, ship);
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const dt = _lastT == null ? 0 : Math.min(0.05, now - _lastT); _lastT = now;
    const PB = _st._B, seed = (station?.seed ?? 0) | 0, { k, ww, wh } = _L;
    ctx.save();
    ctx.beginPath(); ctx.rect(_win.x, _win.y, _win.w, _win.h); ctx.clip();
    ctx.fillStyle = '#04050a'; ctx.fillRect(_win.x, _win.y, _win.w, _win.h);
    ctx.translate(_win.x, _win.y); ctx.scale(k, k);
    const A = _L.art;
    const ph = opts.phase !== undefined ? opts.phase
             : (typeof DockArt !== 'undefined' && DockArt.phase && DockArt.PORT_SEQ?.on !== false ? DockArt.phase() : null);
    if (A) _backdrop(ctx, A, ph);
    // the sky: stars
    if (!A) for (let i = 0; i < 120; i++) {
      const x = (i * 137 + seed) % ww, y = 2 + (i * 71) % (wh * 0.85);
      ctx.fillStyle = `rgba(220,230,255,${0.25 + (i % 5) * 0.12})`; ctx.fillRect(x, y, 1, 1);
    }
    // the ground under the station
    const groundY = A ? _L.feet : wh * 0.8 + 8;
    if (!A) {
      ctx.fillStyle = '#26272c'; ctx.fillRect(_dock.w, groundY, ww - _dock.w, wh - groundY);
      ctx.fillStyle = '#34363e'; ctx.fillRect(_dock.w, groundY, ww - _dock.w, 2);
    }
    /* OUR SHIP, in the bay: moved (not rebuilt) to her berth — her real crew
       and her damage; the roof on, or off when the player looks inside */
    const sh = _ours, orr = sh.roomBounds(), ox = _L.rx - orr.x, oy = _L.ry - orr.y;
    // with the hangar's picture its deck is the floor her feet stand on (DockArt.floorOf = the rect's bottom - 6)
    const dockLocal = { x: _dock.x - ox, y: _dock.y - oy, w: _dock.w, h: A ? _L.feet + 6 - _dock.y : _dock.h };
    const hangar = A ? { hangar: true, shaft: !!PORT_ART.SHAFT[A.yard] } : {};
    const was = { moored: sh.moored, roof: sh.roofAlpha };
    /* SHE LANDS ON THE BERTH AND TAKES OFF FROM IT (update205): the bay's
       sequence — down, the gear out, the engines off, the bridge on, and
       back — the same as at home */
    _phase = ph;
    /* OUT THROUGH THE ROOF (update214): `fly` of the way from her berth to clear over the
       hangar's top — her keel and her flame — and nothing of her over the roof but the opening */
    const ob = _box(sh), out = _L.ry + (ob.y + ob.h - orr.y) + 70;
    const fp = A && ph && ph.fly != null ? { ...ph, lift: ph.fly * out + (ph.hover ?? 0) } : ph;
    _flight = fp ? { lift: fp.lift ?? 0, out } : null;
    sh.moored = fp ? !fp.engines : true; sh.roofAlpha = opts.interior ? 0 : 1;
    _drawBerthed(ctx, sh, fp, dockLocal, hangar, ox, oy, A && fp?.lift > 0 ? _drawn?.hangar?.hatch : null, ww, wh);
    sh.moored = was.moored; sh.roofAlpha = was.roof;
    /* THE SEAM (update192): the hangar's wall and the station's gate are one
       structure — a frame from the ground to over the bridge, the gate's
       light green while we are moored */
    const gx = _dock.w, gTop = Math.min(PB.y - 20, wh * 0.2), gBot = groundY;
    if (!A) {
    ctx.fillStyle = '#141a26'; ctx.fillRect(gx - 6, gTop, 20, gBot - gTop);
    ctx.fillStyle = '#2c3548'; ctx.fillRect(gx - 6, gTop, 2, gBot - gTop); ctx.fillRect(gx + 12, gTop, 2, gBot - gTop);
    for (let y = gTop + 8; y < gBot; y += 18) { ctx.fillStyle = '#1e2636'; ctx.fillRect(gx - 4, y, 16, 3); }
    ctx.fillStyle = Math.sin(t * 2) > -0.5 ? '#1aff8c' : '#0e4a2a'; ctx.fillRect(gx + 1, gTop + 3, 4, 4);
    }
    _st.roofAlpha = 0; try { _st.draw(ctx); } catch (e) { /* a picture */ }
    if (opts.people) { try { opts.people(ctx, _st, t, dt); } catch (e) { /* a picture */ } }   // the prison draws its own (update209)
    else _people(ctx, t, dt, seed);
    // the stall under the pointer lights its room, in its colour
    if (hotStall && typeof PortView !== 'undefined') {
      const col = PortView.STALLS.find(s => s.key === hotStall)?.col ?? '#ffffff';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      stallRooms(hotStall).forEach(r => { ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.fillStyle = col + '14'; ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); });
    }
    // the gate the bridge seals onto
    if (A) _gate(ctx, t);
    else {
      const gy = PB.y + PB.h / 2 - 26;
      ctx.fillStyle = '#161c2a'; ctx.fillRect(PB.x - 16, gy, 14, 52); ctx.fillStyle = '#2a3448'; ctx.fillRect(PB.x - 16, gy, 2, 52);
    }
    ctx.restore();
    ctx.fillStyle = '#2a2e3a'; ctx.fillRect(0, _win.y + _win.h, W, 6);
    return true;
  }

  /* THE BASE'S HANGAR IS TERRA'S (update214, jj: "hangar bazy i LOADOUT na nowym hangarze Terry —
     spójność z portami"). The picture behind her in a stage `rect`: its deck's surface on the
     stage's floor line (DockArt.floorOf), as tall as the stage over it and as wide, its roof
     airlock over `cx` as far as the picture allows. false = no picture (the painted bay stands). */
  function drawHangarBack(ctx, rect, cx, p = 0, yard = 'terra') {
    const A = portArt(yard);
    if (!A || !rect) return false;
    const H = PORT_ART.HANGAR, floor = rect.y + rect.h - 6;
    const s = Math.max((floor - rect.y) / H.feet, rect.w / H.w);
    const top = floor - H.feet * s, hw = H.w * s, HT = hatchOf(A);
    const hx = Math.max(rect.x + rect.w - hw, Math.min(rect.x, cx - HT.mid * s));
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const was = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    hangarPic(ctx, A, p, hx, top, hw, H.h * s);
    ctx.imageSmoothingEnabled = was;
    ctx.restore();
    _back = { x: hx, y: top, w: hw, h: H.h * s, s, floor };
    return true;
  }
  let _back = null;

  /* ══ THE HOME BAY (update214, jj 6.11: "baza i porty: animacja startu i lądowania; hangar bazy
     = nowy hangar Terry; zniknie ekran pustego hangaru przy starcie"). The base's own hangar is
     Terra's picture, the whole screen: her in it under the roof airlock, the bridge to her door,
     the tower at the right. She lifts off out of it (LAUNCH) and comes home into it (the end of a
     contract) — the same phase as at a port, the leaves sliding, her flying through the opening.
     No pictures (the suites): the painted bay, the same sequence. */
  let _home = null;
  function drawHome(ctx, ship, ph = null, opts = {}) {
    const win = opts.win ?? { x: 0, y: 0, w: W, h: 720 }, t = opts.t ?? _now();
    ctx.save();
    ctx.beginPath(); ctx.rect(win.x, win.y, win.w, win.h); ctx.clip();
    ctx.fillStyle = '#04050a'; ctx.fillRect(win.x, win.y, win.w, win.h);
    if (!ship || typeof ship.roomBounds !== 'function') { ctx.restore(); _home = null; return false; }
    const A = portArt('terra'), H = PORT_ART.HANGAR;
    const orr = ship.roomBounds(), ob = _box(ship) ?? orr;
    const JB = (typeof DockArt !== 'undefined' && DockArt.JB) ? DockArt.JB.CAB + DockArt.JB.FULL + DockArt.JB.WALL + 10 : 200;
    const k = Math.min(MAX_K, win.w / (ob.w + JB + 160), win.h / (ob.h + 300));
    const ww = win.w / k, wh = win.h / k;
    ctx.translate(win.x, win.y); ctx.scale(k, k);
    const key = ship.layoutKey ?? 'scout', dock = { x: 0, y: 0, w: ww, h: wh };
    const cx = ww / 2 - 40 + (typeof DockArt !== 'undefined' && DockArt.shiftFor ? DockArt.shiftFor(key, dock, ww / 2 - 40, ship.isPlayer !== false) : 0);
    const keelOff = ob.y + ob.h - orr.y;
    const LEG = (typeof DockArt !== 'undefined' && DockArt.LEG) ? DockArt.LEG : { DROP: 40, MIN_DROP: 16 };
    const head = A ? PORT_ART.HEAD : 0;                                   // the sky over the roof (update218)
    const s = (wh - head) / H.h, feet = A ? Math.round(wh - (H.h - H.feet) * s) : null;
    const drop = A ? Math.max(LEG.MIN_DROP, Math.min(LEG.DROP, feet - ob.h - 8)) : 0;
    const rx = Math.round(cx - orr.w / 2), ry = Math.round(A ? feet - drop - keelOff : wh * 0.5 - orr.h / 2);
    const ox = rx - orr.x, oy = ry - orr.y;
    let hd = null;
    if (A) {
      const was = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
      const hw = H.w * s, HT = hatchOf(A);
      const hx = Math.max(ww - hw, Math.min(0, cx - HT.mid * s));        // the airlock over her, the picture over the hall
      _sky(ctx, 0, 0, ww, head, 3);
      hd = hangarPic(ctx, A, hatchP(ph), hx, head, hw, H.h * s, t);
      ctx.imageSmoothingEnabled = was;
    }
    const out = ry + keelOff + 70;
    const fp = ph ? { ...ph, lift: A && ph.fly != null ? ph.fly * out + (ph.hover ?? 0) : (ph.lift ?? 0) } : null;
    const dockLocal = { x: -ox, y: -oy, w: ww, h: A ? feet + 6 : wh };
    const was = { moored: ship.moored, roof: ship.roofAlpha };
    ship.moored = fp ? !fp.engines : true; ship.roofAlpha = 1;
    _drawBerthed(ctx, ship, fp, dockLocal, A ? { hangar: true, shaft: false } : {}, ox, oy, A && fp?.lift > 0 ? hd : null, ww, wh);
    ship.moored = was.moored; ship.roofAlpha = was.roof;
    ctx.restore();
    // the caption: what is happening, and that a click hurries it
    if (opts.caption) {
      ctx.save();
      ctx.fillStyle = 'rgba(4,6,12,0.78)'; ctx.fillRect(win.x, win.y + win.h - 46, win.w, 46);
      ctx.fillStyle = '#ffb020'; ctx.font = '16px Orbitron, monospace'; ctx.textAlign = 'center';
      ctx.fillText(opts.caption, win.x + win.w / 2, win.y + win.h - 22);
      if (opts.hint) { ctx.fillStyle = '#7a90a8'; ctx.font = '10px Share Tech Mono, monospace'; ctx.fillText(opts.hint, win.x + win.w / 2, win.y + win.h - 8); }
      ctx.restore();
    }
    _home = { k, ww, wh, feet, rx, ry, drop, out, head, art: !!A, hatch: hd ? { ...hd } : null, lift: fp?.lift ?? 0 };
    return true;
  }

  return { draw, drawHome, drawHangarBack, hangarPic, hatchP, stallRooms, layoutKey, layout, WIN, _state: () => ({ station: _st, ours: _ours, dock: _dock, key: _key, layout: _L, phase: _phase, drawn: _drawn, gate: _gateDrawn, flight: _flight, home: _home, back: _back }), PORT_ART, portArt, hatchOpen };
})();

if (typeof window !== 'undefined') { window.STATION_HULLS = STATION_HULLS; window.StationScene = StationScene; }
