/* ============================================================
   MOON WARS — dockart.js  (update148)
   The ship at home: moored in the base's bay on the moon.

   jj, 20.10: "fajnie by było jak mamy menu SHIP i LOADOUT miało grafikę
   w tle tak, jakby statek był zadokowany do stacji na księżycu".

   Two layers, both drawn UNDER the hull:
     · the bay — the sky over the moon, a planet, the grey horizon with
       its craters and a few lights of the base, the mouth of the hangar
       with floodlights. Painted ONCE per size, at half resolution and
       doubled, the way the port is.
     · the moorings — worked out from THIS hull's own outline (its plate,
       its nacelles, its bow, its guns), so every ship sits right: the
       cradle's two arms up under her keel, the gantry beam overhead with
       its umbilicals down to her stern (clear of her guns), the boarding
       tube to her bow, blinking lights.

       DockArt.draw(ctx, rect, ship)
   A picture only: nothing here touches the ship.
   ============================================================ */

'use strict';

const DockArt = (() => {
  const _cache = new Map();          // `${w}x${h}` → canvas

  function _canvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function _rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** The bay, painted at half size for a `w` × `h` stage. */
  function bay(w, h) {
    const key = `${w | 0}x${h | 0}`;
    if (_cache.has(key)) return _cache.get(key);
    const PW = Math.max(16, Math.ceil(w / 2)), PH = Math.max(16, Math.ceil(h / 2));
    const c = _canvas(PW, PH);
    if (!c) return null;
    const g = c.getContext('2d'), rnd = _rng(0xb4e + PW * 31 + PH);
    const R = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, ww | 0, hh | 0); };
    const ground = PH * 0.8;
    // the sky
    const sky = g.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, '#02030a'); sky.addColorStop(1, '#0a0f24');
    g.fillStyle = sky; g.fillRect(0, 0, PW, ground);
    // sparse and dim: the ship is the picture, the sky is behind it
    for (let i = 0; i < PW * PH / 110; i++) { const v = rnd(); R(rnd() * PW, rnd() * ground, 1, 1, v > 0.95 ? '#c8d4f0' : v > 0.7 ? '#5a6a98' : '#2a3456'); }
    // the Earth, high on the left — THE RUINED ONE, always (jj, 21.10: the same
    // Earth as over the town: ash, scorched land, a few fires on the night side)
    const px = PW * 0.18, py = PH * 0.22, pr = Math.min(PW, PH) * 0.13;
    if (typeof TownView !== 'undefined' && TownView.ruinedEarth) TownView.ruinedEarth(g, px, py, pr, rnd);
    else { g.fillStyle = '#4a3e32'; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill(); }
    // the moon's horizon and its craters
    g.fillStyle = '#3f424c';
    g.beginPath(); g.moveTo(0, ground - 6);
    for (let x = 0; x <= PW; x += 6) g.lineTo(x, ground - 6 + Math.sin(x * 0.05) * 3 + Math.sin(x * 0.17) * 1.5);
    g.lineTo(PW, PH); g.lineTo(0, PH); g.fill();
    g.fillStyle = '#4e515c';
    g.beginPath(); g.moveTo(0, ground + 2);
    for (let x = 0; x <= PW; x += 5) g.lineTo(x, ground + 2 + Math.sin(x * 0.08 + 2) * 2);
    g.lineTo(PW, PH); g.lineTo(0, PH); g.fill();
    for (let i = 0; i < PW / 14; i++) {
      const x = rnd() * PW, y = ground + 4 + rnd() * (PH - ground - 6), r = 2 + rnd() * 5;
      g.fillStyle = '#383a43'; g.beginPath(); g.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI * 2); g.fill();
      R(x - r, y - r * 0.35, r * 2, 1, '#62656f');
    }
    // the base's lights along the horizon
    for (let i = 0; i < PW / 10; i++) R(rnd() * PW, ground - 4 - rnd() * 3, 1, 1, rnd() > 0.5 ? '#ffb24a' : '#ffd890');
    // the mouth of the hangar: a frame of girders, and floodlight cones
    const steel = '#1a2130', lit = '#2c3548';
    R(0, 0, PW, 5, steel); R(0, 5, PW, 1, lit);
    R(0, 0, 6, PH, steel); R(PW - 6, 0, 6, PH, steel); R(6, 0, 1, PH, lit); R(PW - 7, 0, 1, PH, lit);
    for (let y = 10; y < PH; y += 16) { R(0, y, 6, 1, '#11161f'); R(PW - 6, y, 6, 1, '#11161f'); }
    [0.3, 0.7].forEach(f => {
      const x = PW * f;
      R(x - 3, 5, 6, 3, '#3a4458');
      const cone = g.createLinearGradient(0, 8, 0, ground);
      cone.addColorStop(0, 'rgba(200,225,255,0.10)'); cone.addColorStop(1, 'rgba(200,225,255,0)');
      g.fillStyle = cone; g.beginPath(); g.moveTo(x - 2, 8); g.lineTo(x - PW * 0.16, ground); g.lineTo(x + PW * 0.16, ground); g.lineTo(x + 2, 8); g.fill();
    });
    // the apron the cradle stands on
    R(0, PH - 4, PW, 4, '#22262f'); for (let x = 0; x < PW; x += 10) R(x, PH - 4, 5, 1, 'rgba(255,200,60,0.35)');
    _cache.set(key, c);
    if (_cache.size > 8) _cache.delete(_cache.keys().next().value);
    return c;
  }

  /** Where this hull is, in the coordinates it is drawn at. */
  function hullFrame(ship) {
    const g = ship?.hullArtGeometry?.();
    if (!g) return null;
    const parts = [...(g.plate ?? []), ...(g.engines ?? []), ...(g.prows ?? [])];
    if (!parts.length) return null;
    const top = Math.min(...g.plate.map(r => r.y)), bot = Math.max(...g.plate.map(r => r.y + r.h));
    const left = Math.min(...parts.map(r => r.x)), right = Math.max(...parts.map(r => r.x + r.w));
    // the top deck: the bow's tube goes into it
    const deck = g.decks?.[0];
    const guns = (ship.weaponMounts?.() ?? []).map(m => [m.x - 10, m.x + m.w + 10]);
    return { top, bot, left, right, deckY: deck ? deck.y + deck.h / 2 : (top + bot) / 2, guns, faces: ship.isPlayer ? 1 : -1, g };
  }

  /** The bottom of the hull at `x` — where a cradle arm meets her. */
  function keelAt(F, x) {
    const under = F.g.plate.filter(r => r.x <= x && x <= r.x + r.w);
    return under.length ? Math.max(...under.map(r => r.y + r.h)) : F.bot;
  }
  /** The top of the hull at `x` — where an umbilical plugs in. */
  function roofAt(F, x) {
    const over = F.g.plate.filter(r => r.x <= x && x <= r.x + r.w);
    return over.length ? Math.min(...over.map(r => r.y)) : F.top;
  }

  /* THE JET BRIDGE GOES TO HER DOOR (update153, jj: "ramię łączące port ze
     statkiem powinno być większe i łączyć się z drzwiami statku, taki rękaw
     jak w samolotach na lotnisku"). Her doors to space are her airlocks — one
     on the outer wall of each deck's end module. The bridge takes a BOW-side
     one that nothing of the hull stands in front of, the lowest of them; on a
     hull whose bow is a nose all the way down every bow airlock is behind it,
     and the bridge meets the nose where the lowest one is. No airlock at all:
     the top deck, as before. `hatch: true` when it is a door you can see. */
  function hatch(ship, F) {
    const M = (typeof HULL_GRID !== 'undefined' ? HULL_GRID.MARGIN : 10), dir = F.faces;
    // a bow-side airlock is the one on the BOW wall of its module (the stern one is on the other)
    const bowWall = (d) => { const r = (ship.rooms ?? []).find(q => q.id === d.roomA);
      return r ? (dir > 0 ? d.x >= r.x + r.w - 1 : d.x <= r.x + 1) : false; };
    const locks = (ship.doors ?? []).filter(d => d && d.isAirlock && bowWall(d));
    const parts = [...F.g.plate, ...(F.g.prows ?? []), ...(F.g.engines ?? [])];
    const open = (d) => !parts.some(r => r.y < d.y + 14 && d.y - 14 < r.y + r.h
      && (dir > 0 ? r.x + r.w > d.x + M + 1 : r.x < d.x - M - 1));
    const low = (a, b) => b.y - a.y;
    const seen = locks.filter(open).sort(low)[0];
    if (seen) return { x: seen.x + dir * M, y: seen.y, hatch: true };
    const hid = locks.sort(low)[0];
    if (hid) {
      const nose = (F.g.prows ?? []).find(r => r.y <= hid.y && hid.y <= r.y + r.h);
      const x = nose ? (dir > 0 ? nose.x + nose.w * 0.55 : nose.x + nose.w * 0.45) : hid.x + dir * M;
      return { x, y: hid.y, hatch: false };
    }
    return { x: dir > 0 ? F.right : F.left, y: F.deckY, hatch: false };
  }

  /** Points along the hull for the moorings: the cradle's two arms and
   *  the umbilicals' plugs (never on a gun). For tests, too. */
  function moorings(ship) {
    const F = hullFrame(ship);
    if (!F) return null;
    const span = F.right - F.left;
    const arms = [0.3, 0.7].map(f => {
      const x = F.left + span * f;
      return { x, y: keelAt(F, x) };
    });
    const plugs = [];
    for (const f of [0.12, 0.2, 0.3, 0.4, 0.5]) {
      const x = F.left + span * (F.faces > 0 ? f : 1 - f);
      if (F.guns.some(([a, b]) => x >= a && x <= b)) continue;
      plugs.push({ x, y: roofAt(F, x) });
      if (plugs.length === 2) break;
    }
    const tube = hatch(ship, F);
    return { arms, plugs, tube, F };
  }

  function draw(ctx, rect, ship) {
    if (!rect || rect.w < 40 || rect.h < 40) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const img = bay(rect.w, rect.h);
    if (img) {
      const was = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
      ctx.imageSmoothingEnabled = was;
    }
    const M = ship ? moorings(ship) : null;
    if (M) {
      const ground = rect.y + rect.h * 0.8 + 8;
      // the gantry beam overhead
      const by = rect.y + 14;
      ctx.fillStyle = '#1e2638'; ctx.fillRect(rect.x, by, rect.w, 9);
      ctx.fillStyle = '#3a4660'; ctx.fillRect(rect.x, by, rect.w, 1);
      ctx.fillStyle = '#121824'; ctx.fillRect(rect.x, by + 8, rect.w, 1);
      for (let x = rect.x + 6; x < rect.x + rect.w; x += 22) { ctx.fillStyle = '#2c3548'; ctx.fillRect(x, by + 3, 3, 3); }
      // umbilicals: a cable with a sag, a coupling at the hull
      M.plugs.forEach((p, i) => {
        ctx.strokeStyle = i ? '#2a2216' : '#161e2c'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p.x - 18, by + 9);
        ctx.bezierCurveTo(p.x - 24, (by + p.y) / 2 + 26, p.x - 4, p.y - 26, p.x, p.y - 4); ctx.stroke();
        ctx.strokeStyle = i ? '#ffb020' : '#4db8ff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(p.x - 18, by + 9);
        ctx.bezierCurveTo(p.x - 24, (by + p.y) / 2 + 26, p.x - 4, p.y - 26, p.x, p.y - 4); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#3a4458'; ctx.fillRect(p.x - 5, p.y - 7, 10, 6);
      });
      // the cradle: two arms up from the apron to her keel
      M.arms.forEach(a => {
        const top = a.y + 2, bot = Math.max(top + 6, ground + 40);
        ctx.fillStyle = '#1c2332'; ctx.fillRect(a.x - 7, top + 8, 14, bot - top - 8);
        ctx.fillStyle = '#323c52'; ctx.fillRect(a.x - 7, top + 8, 2, bot - top - 8);
        ctx.fillStyle = '#2a3446'; ctx.fillRect(a.x - 22, top, 44, 8);
        for (let k = 0; k < 44; k += 8) { ctx.fillStyle = k % 16 ? '#1a1a1a' : '#e6b422'; ctx.fillRect(a.x - 22 + k, top + 5, 8, 3); }
        ctx.strokeStyle = '#1c2332'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x - 20, bot); ctx.lineTo(a.x - 6, top + 20); ctx.moveTo(a.x + 20, bot); ctx.lineTo(a.x + 6, top + 20); ctx.stroke();
        ctx.fillStyle = Math.sin(t * 3 + a.x) > 0 ? '#ff3a3a' : '#4a1010'; ctx.fillRect(a.x - 2, top + 12, 4, 3);
      });
      // the jet bridge to her door
      jetBridge(ctx, rect, M, ground, t);
    }
    ctx.restore();
  }

  /* THE JET BRIDGE (update153). A boarding bridge like the ones at an
     airport, built for vacuum: the terminal's wall at the edge of the bay,
     a fixed rotunda on its pillar, two telescoping sections (each a little
     slimmer than the one it slides out of), the drive column on its wheels
     near the far end, and the cab, sealed onto her airlock — its bellows
     drawn OVER her plating by `drawOver`. All of it under her. */
  const JB = { H: 60, CAB: 52, CABH: 72, DROP: 8, FULL: 120, WALL: 26 };   // DROP: the floor of the bridge level with hers
  function jetBridge(ctx, rect, M, ground, t) {
    const T = M.tube, dir = M.F.faces;
    const edge = dir > 0 ? rect.x + rect.w : rect.x;
    const cab0 = T.x - dir * 6, cab1 = T.x + dir * JB.CAB;         // the cab: from her plate outwards
    const term = edge - dir * JB.WALL;                              // the terminal wall's face
    const room = (term - cab1) * dir;
    if (room < 4) return;                                           // no room at all in a tiny stage
    const full = room >= JB.FULL;                                   // short of it: one section, cab to wall
    const S = (a, b) => [Math.min(a, b), Math.abs(b - a)];
    const y = T.y + JB.DROP, H = JB.H;
    // ── the terminal wall at the edge of the bay ──
    {
      const [x, w] = S(term, edge + dir * 2), top = y - H / 2 - 40;
      ctx.fillStyle = '#161c2a'; ctx.fillRect(x, top, w, ground + 40 - top);
      ctx.fillStyle = '#2a3448'; ctx.fillRect(dir > 0 ? x : x + w - 2, top, 2, ground + 40 - top);
      for (let yy = top + 8; yy < ground + 30; yy += 14) { ctx.fillStyle = '#10151f'; ctx.fillRect(x, yy, w, 1); }
      ctx.fillStyle = '#ffcf6a'; ctx.globalAlpha = 0.55;
      for (let yy = top + 12; yy < y - H / 2 - 6; yy += 10) ctx.fillRect(x + 6, yy, w - 12, 3);
      ctx.globalAlpha = 1;
      // the sign over the gate
      ctx.fillStyle = '#0b0f18'; ctx.fillRect(x + 2, y - H / 2 - 22, w - 4, 14);
      ctx.fillStyle = '#ffb020'; ctx.font = 'bold 9px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText('GATE', x + w / 2, y - H / 2 - 12);
    }
    // ── the fixed rotunda and its pillar, by the terminal ──
    const rot = full ? term - dir * 30 : term;
    if (full) {
      ctx.fillStyle = '#1a2130'; ctx.fillRect(rot - 10, y + H / 2, 20, ground + 34 - (y + H / 2));
      ctx.fillStyle = '#2c3548'; ctx.fillRect(rot - 10, y + H / 2, 3, ground + 34 - (y + H / 2));
      const rh = H + 16;
      ctx.fillStyle = '#242c3e'; ctx.beginPath(); ctx.roundRect(rot - 26, y - rh / 2, 52, rh, 10); ctx.fill();
      ctx.strokeStyle = '#3e4a64'; ctx.lineWidth = 2; ctx.stroke();
      for (let k = -18; k <= 18; k += 6) { ctx.fillStyle = 'rgba(8,11,18,0.5)'; ctx.fillRect(rot + k, y - rh / 2 + 4, 1, rh - 8); }
      ctx.fillStyle = '#4a5a78'; ctx.fillRect(rot - 20, y - rh / 2 + 2, 40, 2);
    }
    // ── two telescoping sections: the outer one by the rotunda, the inner one by the cab ──
    const mid = (rot + cab1) / 2;
    const section = (a, b, h, col, lit) => {
      const [x, w] = S(a, b);
      if (w < 2) return;
      ctx.fillStyle = col; ctx.fillRect(x, y - h / 2, w, h);
      ctx.fillStyle = '#4a5a78'; ctx.fillRect(x, y - h / 2, w, 3);                 // the roof rail
      ctx.fillStyle = '#0e131d'; ctx.fillRect(x, y + h / 2 - 4, w, 4);             // the floor
      for (let xx = x + 3; xx < x + w; xx += 7) { ctx.fillStyle = 'rgba(8,11,18,0.55)'; ctx.fillRect(xx, y - h / 2 + 3, 1, h - 7); }   // the ribs
      ctx.fillStyle = '#0a0e16'; ctx.fillRect(x + 2, y - 8, w - 4, 9);             // the window band
      for (let xx = x + 6; xx < x + w - 6; xx += 14) {
        const on = lit && Math.sin(xx * 0.37) > -0.3;
        ctx.fillStyle = on ? '#ffd890' : '#2a3044'; ctx.fillRect(xx, y - 6, 8, 5);
      }
    };
    if (!full) section(term, cab1, H - 8, '#2e394f', true);
    else {
    section(rot - dir * 20, mid - dir * 8, H, '#283247', true);
    section(mid + dir * 8, cab1, H - 8, '#2e394f', true);
    // the overlap collar where one slides into the other
    const [x, w] = S(mid - dir * 10, mid + dir * 10); ctx.fillStyle = '#1c2332'; ctx.fillRect(x, y - H / 2 - 3, w, H + 6); ctx.fillStyle = '#3e4a64'; ctx.fillRect(x, y - H / 2 - 3, w, 2);
    }
    // ── the drive column: two legs down to a bogie on the apron ──
    let col = cab1 + (rot - cab1) * 0.4;
    const hullEnd = dir > 0 ? M.F.right : M.F.left;
    if ((col - hullEnd) * dir < 16) col = hullEnd + dir * 22;                 // never under her
    M.arms.forEach(a => { if (Math.abs(col - a.x) < 34) col = a.x + dir * 34; });   // nor on a cradle arm
    if (full && (term - col) * dir > 50) {
      const top = y + H / 2 - 4, bot = ground + 30;
      ctx.fillStyle = '#1a2130'; ctx.fillRect(col - 9, top, 6, bot - top); ctx.fillRect(col + 3, top, 6, bot - top);
      ctx.fillStyle = '#2c3548'; ctx.fillRect(col - 9, top, 2, bot - top);
      for (let yy = top + 10; yy < bot - 8; yy += 12) { ctx.fillStyle = '#e6b422'; ctx.fillRect(col - 3, yy, 6, 2); }
      ctx.fillStyle = '#232b3c'; ctx.fillRect(col - 20, bot - 8, 40, 8);
      ctx.fillStyle = '#0d1018'; [-12, 12].forEach(o => { ctx.beginPath(); ctx.arc(col + o, bot + 1, 6, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = '#3a4458'; [-12, 12].forEach(o => ctx.fillRect(col + o - 1, bot, 2, 2));
      ctx.fillStyle = Math.sin(t * 4) > 0 ? '#ffb020' : '#4a3010'; ctx.fillRect(col - 2, bot - 12, 4, 3);
    }
    // ── the cab, a little taller than the bridge ──
    {
      const [x, w] = S(cab0, cab1), h = JB.CABH;
      ctx.fillStyle = '#3a4762'; ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, 4); ctx.fill();
      ctx.strokeStyle = '#64789c'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#5a6e94'; ctx.fillRect(x + 2, y - h / 2 + 1, w - 4, 3);
      ctx.fillStyle = '#121824'; ctx.fillRect(x, y + h / 2 - 6, w, 6);
      ctx.fillStyle = '#0a0e16'; ctx.fillRect(x + 8, y - h / 2 + 10, w - 16, 14);       // the operator's window
      ctx.fillStyle = 'rgba(120,200,255,0.45)'; ctx.fillRect(x + 10, y - h / 2 + 12, w - 20, 3);
      ctx.fillStyle = '#ffd890'; ctx.fillRect(x + 12, y - h / 2 + 18, 5, 4);
      ctx.fillStyle = '#e6b422'; for (let k = 0; k < w; k += 10) ctx.fillRect(x + k, y + h / 2 - 11, 5, 3);
      ctx.fillStyle = Math.sin(t * 2.5) > 0 ? '#ff3a3a' : '#4a1010'; ctx.fillRect(x + w / 2 - 2, y - h / 2 - 4, 4, 4);   // the beacon
    }
  }

  /** How far to move a hull of `key` from a stage centre `cx` so the jet
   *  bridge has its full length past her bow, without pushing her stern out
   *  of `rect` (update153). Negative = to the left for one of ours. */
  const _probe = new Map();
  function shiftFor(key, rect, cx, isPlayer = true) {
    if (!rect || typeof Ship === 'undefined') return 0;
    const pk = key + (isPlayer ? '' : '|foe');
    if (!_probe.has(pk)) {
      let p = null;
      try {
        const sh = new Ship(key, isPlayer, 0, 0), M = moorings(sh);
        const b = sh.roomBounds?.() ?? null;
        if (M && b) p = { left: M.F.left, right: M.F.right, tube: M.tube.x, mid: b.x + b.w / 2, dir: M.F.faces };
      } catch (e) { p = null; }
      _probe.set(pk, p);
    }
    const p = _probe.get(pk);
    if (!p) return 0;
    const off = cx - p.mid, want = JB.CAB + JB.FULL + JB.WALL + 10;
    if (p.dir > 0) {
      const room = rect.x + rect.w - (p.tube + off);
      const slack = (p.left + off) - (rect.x + 14);
      return room >= want ? 0 : -Math.max(0, Math.min(want - room, slack));
    }
    const room = (p.tube + off) - rect.x;
    const slack = rect.x + rect.w - 14 - (p.right + off);
    return room >= want ? 0 : Math.max(0, Math.min(want - room, slack));
  }

  /** What sits OVER her: the cab's bellows, sealed round her airlock, and the
   *  lamp that says the seal holds. Drawn after the hull. */
  function drawOver(ctx, rect, ship) {
    if (!rect || rect.w < 40 || rect.h < 40 || !ship) return;
    const M = moorings(ship);
    if (!M) return;
    const T = M.tube, dir = M.F.faces, h = JB.CABH - 6, cy = T.y + JB.DROP;
    const edge = dir > 0 ? rect.x + rect.w : rect.x;
    if ((edge - JB.WALL * dir - (T.x + dir * JB.CAB)) * dir < 4) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const x = dir > 0 ? T.x - 8 : T.x - 6;
    ctx.fillStyle = '#151a24'; ctx.fillRect(x, cy - h / 2, 14, h);
    for (let k = 0; k < 14; k += 3) { ctx.fillStyle = k % 6 ? '#2a3344' : '#0c1018'; ctx.fillRect(x + k, cy - h / 2, 2, h); }   // the folds
    ctx.fillStyle = '#4a5a78'; ctx.fillRect(x, cy - h / 2, 14, 2); ctx.fillRect(x, cy + h / 2 - 2, 14, 2);
    ctx.fillStyle = Math.sin(t * 1.5) > -0.6 ? '#1aff8c' : '#0e4a2a'; ctx.fillRect(x + 5, cy - h / 2 - 5, 4, 4);   // sealed
    ctx.restore();
  }

  return { draw, drawOver, bay, moorings, shiftFor, JB };
})();

if (typeof window !== 'undefined') window.DockArt = DockArt;
