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
    let top = Math.min(...g.plate.map(r => r.y)), bot = Math.max(...g.plate.map(r => r.y + r.h));
    let left = Math.min(...parts.map(r => r.x)), right = Math.max(...parts.map(r => r.x + r.w));
    // a SHAPED hull is her picture (update176): the stern, the ridges and the bow are her
    if (g.shaped) { top = g.box.y; bot = g.box.y + g.box.h; left = g.box.x; right = g.box.x + g.box.w; }
    // the top deck: the bow's tube goes into it
    const deck = g.decks?.[0];
    const guns = (ship.weaponMounts?.() ?? []).map(m => [m.x - 10, m.x + m.w + 10]);
    return { top, bot, left, right, deckY: deck ? deck.y + deck.h / 2 : (top + bot) / 2, guns, faces: (ship.facesRight ?? ship.isPlayer) ? 1 : -1, g };
  }

  /** The bottom of the hull at `x` — where a cradle arm meets her. */
  function keelAt(F, x) {
    if (F.g.shaped && F.g.keelAt) { const k = F.g.keelAt(x - 4, x + 4); if (k != null) return k; }
    const under = F.g.plate.filter(r => r.x <= x && x <= r.x + r.w);
    return under.length ? Math.max(...under.map(r => r.y + r.h)) : F.bot;
  }
  /** The top of the hull at `x` — where an umbilical plugs in. */
  function roofAt(F, x) {
    if (F.g.shaped && F.g.topAt) { const k = F.g.topAt(x - 3, x + 3); if (k != null) return k; }
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
    /* a shaped hull stands on her own LEGS (update176, jj: "niech stoi na
       swoich nóżkach") — three, under the stern, the middle and the bow */
    const legs = F.g.shaped;
    // (update198: under her own landing pads — the yards drew them at about these places)
    const pads = legs ? (F.g.pads ?? []) : [];
    const arms = pads.length
      ? pads.map(p => ({ x: (p.x0 + p.x1) / 2, y: p.y0, leg: true, pad: p }))       // her own pads (update199)
      : (legs ? LEG.AT : [0.3, 0.7]).map(f => {
        const x = F.left + span * f;
        return { x, y: keelAt(F, x), leg: legs };
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

  /* `opts.hangar` (update206): the port's hangar is a PICTURE now, drawn by
     the port under this — no painted bay, no gantry beam across its roof
     airlock and no umbilicals off that beam */
  /* THE HOME BAY IS TERRA'S HANGAR (update214): with its pictures in, a stage that does not
     say otherwise (`opts.home !== false`) is drawn in it — the picture behind, its deck the floor,
     and the rest as in a port's hangar. Without them, the painted bay as before. */
  const _homeBack = (opts) => !opts.hangar && opts.home !== false && typeof StationScene !== 'undefined'
    && !!StationScene.portArt?.('terra') && !!StationScene.drawHangarBack;
  function draw(ctx, rect, ship, ph = null, opts = {}) {
    if (!rect || rect.w < 40 || rect.h < 40) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    if (_homeBack(opts)) {
      const F = ship ? hullFrame(ship) : null;
      const hp = StationScene.hatchP ? StationScene.hatchP(ph) : 0;
      if (StationScene.drawHangarBack(ctx, rect, F ? (F.left + F.right) / 2 : rect.x + rect.w / 2, hp)) opts = { ...opts, hangar: true };
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const img = opts.hangar ? null : bay(rect.w, rect.h);
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
      if (!opts.hangar) {
      ctx.fillStyle = '#1e2638'; ctx.fillRect(rect.x, by, rect.w, 9);
      ctx.fillStyle = '#3a4660'; ctx.fillRect(rect.x, by, rect.w, 1);
      ctx.fillStyle = '#121824'; ctx.fillRect(rect.x, by + 8, rect.w, 1);
      for (let x = rect.x + 6; x < rect.x + rect.w; x += 22) { ctx.fillStyle = '#2c3548'; ctx.fillRect(x, by + 3, 3, 3); }
      // umbilicals: a cable with a sag, a coupling at the hull — once she is down (update201)
      if ((ph?.bridge ?? 1) >= 0.999) M.plugs.forEach((p, i) => {
        ctx.strokeStyle = i ? '#2a2216' : '#161e2c'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p.x - 18, by + 9);
        ctx.bezierCurveTo(p.x - 24, (by + p.y) / 2 + 26, p.x - 4, p.y - 26, p.x, p.y - 4); ctx.stroke();
        ctx.strokeStyle = i ? '#ffb020' : '#4db8ff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(p.x - 18, by + 9);
        ctx.bezierCurveTo(p.x - 24, (by + p.y) / 2 + 26, p.x - 4, p.y - 26, p.x, p.y - 4); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#3a4458'; ctx.fillRect(p.x - 5, p.y - 7, 10, 6);
      });
      }
      // a shaped hull: her landing legs, down from her keel to the apron
      /* (her own pads are lowered OVER her, in drawOver — the piece of her
         picture that is the pad has to leave her keel; update199) */
      if (M.arms[0]?.pad) { /* lowered in drawOver */ }
      else if (M.arms[0]?.leg) {
        const lift = ph?.lift ?? 0;                    // she is still coming down, or going up (update201)
        ctx.save(); ctx.translate(0, -lift);
        drawLegs(ctx, M, t, ship, floorOf(rect) + lift, ph ?? { gear: 1 });
        ctx.restore();
      }
      // the cradle: two arms up from the apron to her keel
      else M.arms.forEach(a => {
        const top = a.y + 2, bot = Math.max(top + 6, ground + 40);
        ctx.fillStyle = '#1c2332'; ctx.fillRect(a.x - 7, top + 8, 14, bot - top - 8);
        ctx.fillStyle = '#323c52'; ctx.fillRect(a.x - 7, top + 8, 2, bot - top - 8);
        ctx.fillStyle = '#2a3446'; ctx.fillRect(a.x - 22, top, 44, 8);
        for (let k = 0; k < 44; k += 8) { ctx.fillStyle = k % 16 ? '#1a1a1a' : '#e6b422'; ctx.fillRect(a.x - 22 + k, top + 5, 8, 3); }
        ctx.strokeStyle = '#1c2332'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x - 20, bot); ctx.lineTo(a.x - 6, top + 20); ctx.moveTo(a.x + 20, bot); ctx.lineTo(a.x + 6, top + 20); ctx.stroke();
        ctx.fillStyle = Math.sin(t * 3 + a.x) > 0 ? '#ff3a3a' : '#4a1010'; ctx.fillRect(a.x - 2, top + 12, 4, 3);
      });
      /* the jet bridge to her door goes in FRONT of her now (update176,
         jj: "rękaw powinien zasłaniać statek — grafika przed statkiem,
         nie za"): `drawOver`, after the hull */
    }
    ctx.restore();
  }

  /** How far below her keel the feet stand (update176; update198: further —
   *  the gear comes DOWN out of her, jj: "podwozie ma się opuścić"), where
   *  along her the legs are, the foot's width against her length, and how
   *  long the gear takes to come down when she shows in the bay. */
  // EXTRA (update207): how much longer the port lets her gear stand, to bring her bridge level with the station's gate
  // (update235: 24 → 32 — the new Aquarius hulls are shallower under the keel)
  const LEG = { DROP: 40, MIN_DROP: 16, EXTRA: 32, FOOT: 22, AT: [0.27, 0.5, 0.75], FOOT_K: 0.085, FOOT_MIN: 30, FOOT_MAX: 64, LOWER_S: 1.4 };

  /* HER OWN GEAR (update198). Every yard drew its landing gear (prompt E,
     v5): the bay mount under her keel, the telescopic strut, the foot — her
     landing pad, lowered. `gear_<yard>_{mount,strut,foot}` in art/; none of
     them there and the old painted legs stand. */
  /** THE ONE GROUND LINE (update199, jj: "nogi statku, pistony i kółka od
   *  rękawa powinny być na tej samej wysokości, ułożone na ziemi"): her feet
   *  and the bridge's wheels all stand on it. */
  function floorOf(rect) { return rect.y + rect.h - 6; }

  /* HER OWN PADS COME DOWN (update199). The yard drew her landing gear
     retracted under her keel; the hangar lowers it: the pad — the very
     piece of her picture — slides down to the floor on a strut in her
     yard's metal, and where it sat the gear bay is open. Drawn OVER her,
     so the pad can leave its place on her keel. */
  const BAY = { terra: ['#0b0d10', '#c87a3a'], aquarius: ['#0a1018', '#7fa8c8'], phoenix: ['#0e0909', '#c83a2a'], pegasus: ['#0a1018', '#8fb4d0'] };
  function hullPicture(ship) {
    const roof = (ship.roofAlpha ?? 0) > 0.5 ? ship.roofArt?.() : null;
    return (roof ?? ship.hullArt?.())?.img ?? null;
  }
  function bayArt() { return (typeof Assets !== 'undefined' && Assets.has?.('gear_aquarius_bay')) ? Assets.get('gear_aquarius_bay') : null; }
  function drawPads(ctx, M, ship, p, floorY) {
    const img = hullPicture(ship), G = gearArt(ship);
    if (!img) return;
    const yard = YARD_OF(ship), [hole, rim] = BAY[yard] ?? BAY.pegasus;
    const drawn = [];
    const was = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    M.arms.forEach(a => {
      const P = a.pad, w = P.x1 - P.x0, h = P.y1 - P.y0;
      const fBot = P.y1 + (floorY - P.y1) * p, fTop = fBot - h;
      if (p > 0.002) {
        const bay = P.well && bayArt();
        let top;
        if (bay) {
          /* HER GEAR BAY (update235, the Aquarius standard): the yard's mount fills the bay — the pad was tucked into
             its bottom; it goes down, the mount stays, and the strut comes out of the mount's cylinder */
          const W_ = P.well.x1 - P.well.x0, H_ = P.well.y1 - P.well.y0;
          ctx.drawImage(bay, P.well.x0, P.well.y0, W_, H_);
          top = P.well.y0 + H_ * 0.7;
        } else {
        // the bay where the pad sat: dark, its rim in her yard's colour
        const bx = P.x0 + w * 0.08, bw = w * 0.84, by = P.y0 + h * 0.2, bh = h * 0.8;
        ctx.fillStyle = hole; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, bw, bh * 0.3);
        ctx.fillStyle = rim; ctx.fillRect(bx, by + bh - 2, bw, 2); ctx.fillRect(bx, by, 2, bh); ctx.fillRect(bx + bw - 2, by, 2, bh);
        // the strut, out of the bay down to the pad: TELESCOPIC (update201, jj:
        // "jak prawdziwe — grubszy na dole, po nim średni, na górze cieńszy")
        top = by + bh * 0.35;
        }
        if (fTop > top) drawStrut(ctx, a.x, top, fTop + 2, w, yard);
        if (p >= 0.999) {                                   // its shadow once it stands
          ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.beginPath(); ctx.ellipse(a.x, fBot + 1, w * 0.6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.drawImage(img, P.src.x, P.src.y, P.src.w, P.src.h, P.x0, fTop, w, h);
      drawn.push({ x: a.x, keel: P.y1, fTop, fBot, fw: w, yard });
    });
    ctx.imageSmoothingEnabled = was;
    _gearDrawn = drawn;
  }

  /* A TELESCOPIC LEG (update201). Three tubes, the thickest at the bottom
     on the pad, the middle one out of it, the thinnest at the top out of the
     bay — each with its collar, chrome where it slides. However far she lets
     it down, the three share the length; nothing is drawn below the pad's
     top or above the bay. `w` is her pad's width: the tubes are its share. */
  const STRUT_COL = {
    terra:    { tube: '#3a3f47', lit: '#8a929e', dark: '#1a1d22', collar: '#c87a3a', collarLit: '#f0a868', lamp: '#1aff8c' },
    aquarius: { tube: '#3c4a5c', lit: '#9ab4cc', dark: '#18202c', collar: '#2c5a8c', collarLit: '#7fb0e0', lamp: '#5fe8d8' },
    phoenix:  { tube: '#2a2526', lit: '#7a6e6e', dark: '#110e0e', collar: '#b82a22', collarLit: '#ff6a50', lamp: '#ffb020' },
    pegasus:  { tube: '#4a5a6c', lit: '#c8d8e8', dark: '#1c2430', collar: '#7a9ab4', collarLit: '#d8ecff', lamp: '#6ed7ff' },
  };
  const STRUT = { W: [0.5, 0.36, 0.24], MIN: [12, 9, 6] };     // jj: thicker, like a real one
  function drawStrut(ctx, x, top, bottom, w, yard) {
    const C = STRUT_COL[yard] ?? STRUT_COL.pegasus, L = bottom - top;
    if (L <= 0) return;
    const seg = L / 3;
    const tube = (y0, y1, ww) => {
      const x0 = x - ww / 2, h = y1 - y0;
      if (h <= 0) return;
      ctx.fillStyle = C.tube; ctx.fillRect(x0, y0, ww, h);
      ctx.fillStyle = C.lit;  ctx.fillRect(x0 + ww * 0.18, y0, Math.max(1, ww * 0.16), h);    // the chrome where it slides
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x0 + ww * 0.22, y0, 1, h);
      ctx.fillStyle = C.dark; ctx.fillRect(x0 + ww * 0.78, y0, ww * 0.22, h);
    };
    const collar = (y, ww) => {
      ctx.fillStyle = C.collar; ctx.fillRect(x - ww / 2 - 2, y - 3, ww + 4, 6);
      ctx.fillStyle = C.collarLit; ctx.fillRect(x - ww / 2 - 2, y - 3, ww + 4, 1);
      ctx.fillStyle = C.dark; ctx.fillRect(x - ww / 2 - 2, y + 2, ww + 4, 1);
    };
    const W = STRUT.W.map((k, i) => Math.max(STRUT.MIN[i], w * k));
    // top (thin), middle, bottom (thick) — drawn thin first so each thicker one sleeves it
    tube(top, top + seg + 2, W[2]);
    tube(top + seg, top + 2 * seg + 2, W[1]);
    tube(top + 2 * seg, bottom, W[0]);
    collar(top + seg, W[1]);
    collar(top + 2 * seg, W[0]);
    collar(bottom - 2, W[0] + 2);
    // a hose down its side, and one lamp on the thick tube
    ctx.strokeStyle = 'rgba(10,10,12,0.85)'; ctx.lineWidth = Math.max(1.5, w * 0.03);
    ctx.beginPath(); ctx.moveTo(x + W[2] / 2 + 1, top + 2);
    ctx.bezierCurveTo(x + W[1] / 2 + 5, top + seg, x + W[0] / 2 + 6, top + 2 * seg - 4, x + W[0] / 2 + 1, bottom - 6); ctx.stroke();
    if (L > 18) { ctx.fillStyle = C.lamp; ctx.fillRect(x - 1.5, top + 2 * seg + Math.min(10, seg * 0.4), 3, 3); }
  }

  /* ══ THE LANDING AND THE TAKE-OFF (update201, jj: "animacja zniżania tylko
     raz, przy wylądowaniu — jak wracamy do bazy: statek powoli się obniża,
     wysuwają się pistony, potem silniki się wyłączają; to samo odwrotnie przy
     starcie; rękaw podjeżdża lub odjeżdża"). One sequence at a time, on her
     clock (seconds): ARRIVE plays once when she comes home (arrive() — the
     first time the bay shows her after it); DEPART when she leaves, held at
     its end until the game has taken her. Without one she stands moored.
     phase(now) → { lift (px over her berth), gear 0…1, engines, bridge 0…1 }. */
  /* THE ROOF OPENS FIRST, AND SHE COMES THROUGH IT (update214, jj 6.11: "wrota otwierają się
     płynnie — widać rozsuwanie — dopiero potem statek wjeżdża od góry i zwalnia; start odwrotnie,
     statek cały wylatuje"). Two more numbers in the phase: `hatch` (0 shut … 1 open — the roof
     airlock's leaves, slid into the walls) and `fly` (0 on her berth … 1 out over the roof).
     ARRIVE: HATCH (the leaves part) → DESCEND (down through it, slowing: ease-out) → GEAR → SPOOL
     → BRIDGE; the leaves close over the SPOOL and the BRIDGE. DEPART is the same backwards: the
     leaves part over the BRIDGE and the SPOOL, the gear comes in, she climbs out (ease-in: faster
     and faster) and the leaves close behind her — then the game takes her. `lift` stays: LIFT·fly,
     for whoever draws without knowing the stage; a stage that knows how far is "out" uses `fly`. */
  /* SHE STANDS ON HER GEAR (update216, jj's review: "przy starcie podwozie chowa się, zanim statek się
     uniesie — przez chwilę wisi bez nóg"): with the gear in she hovers HOVER px over her berth — the gear
     comes out under her as she settles onto it, and goes in as she rises off it. `hover` in the phase. */
  const SEQ = { HATCH: 1.0, DESCEND: 2.2, GEAR: 1.4, SPOOL: 0.7, BRIDGE: 1.2, LIFT: 90, HOVER: 24 };
  const SEQ_TOTAL = SEQ.HATCH + SEQ.DESCEND + SEQ.GEAR + SEQ.SPOOL + SEQ.BRIDGE;
  let _seq = null, _arrivePending = false;
  const _clock = () => (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
  function arrive() { _arrivePending = true; }
  function depart(now = _clock()) { _arrivePending = false; _seq = { kind: 'depart', t0: now }; }
  function departing() { return _seq?.kind === 'depart'; }
  function departDone(now = _clock()) { return _seq?.kind === 'depart' && now - _seq.t0 >= SEQ_TOTAL; }
  function endSequence() { _seq = null; _arrivePending = false; }
  const _eo = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
  const _ei = (x) => Math.pow(Math.max(0, Math.min(1, x)), 3);
  const _eio = (x) => { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  function phase(now = _clock()) {
    if (_arrivePending) { _seq = { kind: 'arrive', t0: now }; _arrivePending = false; }
    const still = { lift: 0, gear: 1, engines: false, bridge: 1, hatch: 0, fly: 0, hover: 0, kind: null };
    if (!_seq) return still;
    let t = now - _seq.t0;
    const P = (fly, gear, engines, bridge, hatch, kind) => {
      const hover = SEQ.HOVER * (1 - gear);
      return { lift: SEQ.LIFT * fly + hover, gear, engines, bridge, hatch, fly, hover, kind };
    };
    const SB = SEQ.SPOOL + SEQ.BRIDGE;            // the leaves move while the engines settle and the bridge rolls
    if (_seq.kind === 'arrive') {
      if (t >= SEQ_TOTAL) { _seq = null; return still; }
      if (t < SEQ.HATCH) return P(1, 0, true, 0, _eio(t / SEQ.HATCH), 'arrive');                       // the leaves part; she is over the roof
      t -= SEQ.HATCH;
      if (t < SEQ.DESCEND) return P(1 - _eo(t / SEQ.DESCEND), 0, true, 0, 1, 'arrive');                 // down through it, slowing
      t -= SEQ.DESCEND;
      if (t < SEQ.GEAR) return P(0, _eo(t / SEQ.GEAR), true, 0, 1, 'arrive');
      t -= SEQ.GEAR;
      const shut = 1 - _eio(t / SB);
      if (t < SEQ.SPOOL) return P(0, 1, true, 0, shut, 'arrive');
      return P(0, 1, false, _eio((t - SEQ.SPOOL) / SEQ.BRIDGE), shut, 'arrive');
    }
    // DEPART: the same, backwards — she climbs out, the leaves close behind her, and it holds there
    const open = Math.min(1, _eio(t / SB));
    if (t < SEQ.BRIDGE) return P(0, 1, false, 1 - _eio(t / SEQ.BRIDGE), open, 'depart');
    t -= SEQ.BRIDGE;
    if (t < SEQ.SPOOL) return P(0, 1, true, 0, open, 'depart');
    t -= SEQ.SPOOL;
    if (t < SEQ.GEAR) return P(0, 1 - _eo(t / SEQ.GEAR), true, 0, 1, 'depart');
    t -= SEQ.GEAR;
    if (t < SEQ.DESCEND) return P(_ei(t / SEQ.DESCEND), 0, true, 0, 1, 'depart');                      // up, faster and faster
    t -= SEQ.DESCEND;
    return P(1, 0, true, 0, 1 - _eio(t / SEQ.HATCH), 'depart');                                        // gone; the roof shuts
  }

  /** How far her gear comes down, as standFor settled it for her (update198). */
  const _drop = new Map();
  function dropOf(ship) { return _drop.get(`${ship?.layoutKey}|${ship?.isPlayer ? 1 : 0}`) ?? LEG.DROP; }
  const YARD_OF = (ship) => (typeof hullBuilder === 'function' ? hullBuilder(ship?.layoutKey) : null) ?? 'pegasus';
  function gearArt(ship) {
    if (typeof Assets === 'undefined' || !Assets.has) return null;
    const y = YARD_OF(ship), n = (p) => `gear_${y}_${p}`;
    if (!['mount', 'strut', 'foot'].every(p => Assets.has(n(p)))) return null;
    return { yard: y, mount: Assets.get(n('mount')), strut: Assets.get(n('strut')), foot: Assets.get(n('foot')) };
  }

  /** Her landing legs (update176): a strut down from her keel, a knee, a
   *  wide foot on the apron — Pegasus silver, a lamp at the knee. Under
   *  the hull: the top of each strut is behind her plating. */
  function drawLegs(ctx, M, t, ship = null, floorY = null, ph = null) {
    const G = ship ? gearArt(ship) : null;
    const floor = floorY ?? M.F.bot + (ship ? dropOf(ship) : LEG.DROP);
    if (G) return drawGear(ctx, M, G, ph ? ph.gear : 1, floor - M.F.bot);
    const footY = floor;
    M.arms.forEach((a, i) => {
      const top = a.y - 10, knee = (top + footY) / 2;
      ctx.fillStyle = '#26303f'; ctx.fillRect(a.x - 5, top, 10, footY - top - 4);         // the strut
      ctx.fillStyle = '#9fb6cc'; ctx.fillRect(a.x - 5, top, 3, footY - top - 4);           // lit edge
      ctx.fillStyle = '#5b7088'; ctx.fillRect(a.x + 2, top, 3, footY - top - 4);
      ctx.fillStyle = '#c8d8e6'; ctx.fillRect(a.x - 7, knee - 3, 14, 6);                   // the knee
      ctx.fillStyle = '#1c2430'; ctx.fillRect(a.x - 7, knee + 2, 14, 1);
      ctx.fillStyle = Math.sin(t * 2 + i) > 0 ? '#6ed7ff' : '#1d4a5e'; ctx.fillRect(a.x - 1, knee - 1, 3, 2);
      ctx.fillStyle = '#8aa2ba'; ctx.beginPath();                                            // the foot
      ctx.moveTo(a.x - LEG.FOOT / 2, footY); ctx.lineTo(a.x - 6, footY - 6); ctx.lineTo(a.x + 6, footY - 6);
      ctx.lineTo(a.x + LEG.FOOT / 2, footY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#141a24'; ctx.fillRect(a.x - LEG.FOOT / 2, footY, LEG.FOOT, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(a.x, footY + 3, LEG.FOOT * 0.7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    });
  }

  /** The yard's gear at her pads: the mount tucked under her keel, the
   *  strut out of it, the foot on the apron — `p` of the way down (0 = up
   *  against her keel, 1 = standing). The strut slides out of the mount:
   *  what is not yet out is hidden in it, and a long drop repeats it. */
  function drawGear(ctx, M, G, p = 1, drop = LEG.DROP) {
    const span = M.F.right - M.F.left;
    const fw = Math.max(LEG.FOOT_MIN, Math.min(LEG.FOOT_MAX, span * LEG.FOOT_K));
    const k = fw / G.foot.width;                         // one scale for the three parts
    const W = (im) => im.width * k, H = (im) => im.height * k;
    const floorY = M.F.bot + drop;
    const was = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    const drawn = [];
    M.arms.forEach(a => {
      const keel = a.y;
      const mTop = keel - H(G.mount) * 0.35, mBot = mTop + H(G.mount);
      const fBot = keel + (floorY - keel) * p, fTop = fBot - H(G.foot);
      // the strut: from inside the mount down to the foot's top
      const sw = W(G.strut), sh = H(G.strut), top = mTop + H(G.mount) * 0.5;
      if (fTop > top) {
        ctx.save(); ctx.beginPath(); ctx.rect(a.x - sw, top, sw * 2, fTop - top + 2); ctx.clip();
        for (let y = fTop + 2 - sh; y > top - sh; y -= sh * 0.92) ctx.drawImage(G.strut, a.x - sw / 2, y, sw, sh);
        ctx.restore();
      }
      ctx.drawImage(G.mount, a.x - W(G.mount) / 2, mTop, W(G.mount), H(G.mount));
      if (p >= 0.999) {                                   // a shadow once she stands
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(a.x, fBot + 2, fw * 0.6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.drawImage(G.foot, a.x - fw / 2, fTop, fw, H(G.foot));
      drawn.push({ x: a.x, keel, mTop, mBot, fTop, fBot, fw, yard: G.yard });
    });
    ctx.imageSmoothingEnabled = was;
    _gearDrawn = drawn;
  }
  let _gearDrawn = [];
  /** Where the gear was drawn the last time (update198) — for tests. */
  function gearDrawn() { return _gearDrawn.map(g => ({ ...g })); }

  /* THE JET BRIDGE (update153). A boarding bridge like the ones at an
     airport, built for vacuum: the terminal's wall at the edge of the bay,
     a fixed rotunda on its pillar, two telescoping sections (each a little
     slimmer than the one it slides out of), the drive column on its wheels
     near the far end, and the cab, sealed onto her airlock — its bellows
     drawn OVER her plating by `drawOver`. All of it under her. */
  const JB = { H: 60, CAB: 52, CABH: 72, DROP: 8, FULL: 120, WALL: 26 };   // DROP: the floor of the bridge level with hers
  /* THE BRIDGE AS DRAWN (update198): the yard's sheet (prompt D, v5) —
     the collar sealed on her, the tube segment repeated to the gate end, the
     gate's tower repeated up and down, and the support under the tube: its
     saddle clamp, the piston repeated down, the wheeled base. `jb_*` in
     art/; any of them missing and the painted bridge stands. */
  const JB_PARTS = ['collar', 'tube', 'gate', 'tower', 'clamp', 'piston', 'base'];
  function bridgeArt() {
    if (typeof Assets === 'undefined' || !Assets.has) return null;
    if (!JB_PARTS.every(n => Assets.has('jb_' + n))) return null;
    return Object.fromEntries(JB_PARTS.map(n => [n, Assets.get('jb_' + n)]));
  }
  let _bridgeDrawn = null;
  function bridgeDrawn() { return _bridgeDrawn ? { ..._bridgeDrawn } : null; }
  function jetBridgeArt(ctx, rect, M, ground, t, A, ext = 1, noTower = false) {
    const T = M.tube, dir = M.F.faces;
    const th = JB.H + 4, k = th / A.tube.height;          // one scale: the tube's height
    const W = (im) => im.width * k, H = (im) => im.height * k;
    const y = T.y + JB.DROP;
    // drawn as if she faced right, mirrored for one that faces left
    const edge = (dir > 0 ? rect.x + rect.w : rect.x) - T.x, L = edge * dir;
    ctx.save();
    ctx.translate(T.x, 0); ctx.scale(dir, 1);
    const was = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    const tw = W(A.tower), x0 = -6, cw = W(A.collar), gw = W(A.gate);
    const towerX = L - tw, gateX = Math.max(x0 + cw, towerX - gw * 0.9);
    // the gate's tower at the edge of the bay, its segment repeated top to bottom
    // (update207: the hangar's own picture can BE the tower — its lift shaft, its top in the hangar's roof)
    if (!noTower) for (let yy = rect.y - (H(A.tower) - ((y - th / 2 - rect.y) % H(A.tower))); yy < ground + 60; yy += H(A.tower) - 1)
      ctx.drawImage(A.tower, towerX, yy, tw, H(A.tower));
    // the tube: segments from the collar to the gate end; it rolls out to her
    // and back in (update201): the collar is `ext` of the way from the gate
    /* RETRACTED, IT GOES INTO THE TOWER (update216, jj's review: "po odjeździe rękawa przy wieży zostaje krótki
       kawałek rury wiszący w powietrzu"): the collar's home is flush with the tower's face, and the gate's end
       slides in with it — both clipped at the tower's face, so nothing is left hanging over the deck */
    const e01 = Math.max(0, Math.min(1, ext));
    const xcHome = Math.max(x0, towerX - cw * 0.3), gxHome = towerX - gw * 0.1;
    const xc = x0 + (1 - e01) * Math.max(0, xcHome - x0);
    const gx = gateX + (1 - e01) * Math.max(0, gxHome - gateX);
    ctx.save(); ctx.beginPath(); ctx.rect(xc + cw - 2, y - th / 2 - 4, Math.max(0, gateX - (xc + cw) + 4), th + 8); ctx.clip();
    for (let xx = gateX + 2 - W(A.tube); xx > xc + cw - 2 - W(A.tube); xx -= W(A.tube) - 1) ctx.drawImage(A.tube, xx, y - th / 2, W(A.tube), th);
    ctx.restore();
    // the support: clamp under the tube, the piston repeated down, the base on the apron
    // between her last leg and the tower; a tight gap takes a smaller support
    const legs = M.arms.map(a => ({ c: (a.x - T.x) * dir, half: a.pad ? (a.pad.x1 - a.pad.x0) / 2 : LEG.FOOT_MAX / 2 }));
    const after = Math.max(x0 + cw, ...legs.filter(v => v.c > x0).map(v => v.c + v.half + 6));
    const gap = towerX - 4 - after, ks = Math.min(1, gap / W(A.base));
    const col = (after + towerX - 4) / 2;
    const S = (im, v) => v * ks;                          // the support at its own scale
    let support = null;
    if (ks >= 0.55) {
      const cTop = y + th / 2 - 4, bBot = floorOf(rect), bTop = bBot - S(0, H(A.base));   // on the apron, with her feet
      const pTop = cTop + S(0, H(A.clamp)) - 4, pw = S(0, W(A.piston)), ph = S(0, H(A.piston));
      if (bTop > pTop) {
        ctx.save(); ctx.beginPath(); ctx.rect(col - pw, pTop, pw * 2, bTop - pTop + 2); ctx.clip();
        for (let yy = bTop + 2 - ph; yy > pTop - ph; yy -= ph - 1) ctx.drawImage(A.piston, col - pw / 2, yy, pw, ph);
        ctx.restore();
      }
      ctx.drawImage(A.clamp, col - S(0, W(A.clamp)) / 2, cTop, S(0, W(A.clamp)), S(0, H(A.clamp)));
      ctx.drawImage(A.base, col - S(0, W(A.base)) / 2, bTop, S(0, W(A.base)), S(0, H(A.base)));
      support = { x: T.x + col * dir, top: cTop, bottom: bBot, w: S(0, W(A.base)) * 1 };
    }
    ctx.save(); ctx.beginPath(); ctx.rect(-4000, y - th, towerX + 1 + 4000, th * 2); ctx.clip();
    ctx.drawImage(A.gate, gx, y - th / 2, gw, th);
    ctx.drawImage(A.collar, xc, y - th / 2, cw, th);        // sealed on her, over everything — or on its way (update201)
    ctx.restore();
    ctx.imageSmoothingEnabled = was;
    ctx.restore();
    _bridgeDrawn = { y, th, ext, collar: T.x + xc * dir, gate: T.x + gateX * dir, tower: T.x + towerX * dir, towerW: tw, support, dir };
  }

  function jetBridge(ctx, rect, M, ground, t, ext = 1, noTower = false) {
    const A = bridgeArt();
    if (A) return jetBridgeArt(ctx, rect, M, ground, t, A, ext, noTower);
    if (ext < 0.999) return;                     // the painted one only stands docked
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
  function drawOver(ctx, rect, ship, ph = null, opts = {}) {
    if (!rect || rect.w < 40 || rect.h < 40 || !ship) return;
    if (_homeBack(opts)) opts = { ...opts, hangar: true };
    const M = moorings(ship);
    if (!M) return;
    const T = M.tube, dir = M.F.faces, h = JB.CABH - 6, cy = T.y + JB.DROP;
    const edge = dir > 0 ? rect.x + rect.w : rect.x;
    const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const P = ph ?? { lift: 0, gear: 1, bridge: 1 };
    /* `opts.only` (update214): 'pads' — her pads alone (they fly with her, clipped to the roof's
       opening), 'bridge' — the bridge alone (it stands in the hall, never clipped) */
    if (M.arms[0]?.pad && opts.only !== 'bridge') {               // her pads down (update199), as far as the sequence has them (update201)
      ctx.save(); ctx.translate(0, -P.lift);
      drawPads(ctx, M, ship, P.gear, floorOf(rect) + P.lift);
      ctx.restore();
    }
    if (opts.only === 'pads') { ctx.restore(); return; }
    if ((edge - JB.WALL * dir - (T.x + dir * JB.CAB)) * dir < 4) { ctx.restore(); return; }
    // the tower down to the floor: the hangar's (update206) or the bay's apron
    jetBridge(ctx, rect, M, opts.hangar ? floorOf(rect) - 60 : rect.y + rect.h * 0.8 + 8, t, P.bridge, !!opts.shaft);      // in front of her (update176)
    if (P.bridge < 0.999) { ctx.restore(); return; }             // not on her yet: no seal (update201)
    if (bridgeArt()) {                                            // the drawn collar is the seal (update198)
      ctx.fillStyle = Math.sin(t * 1.5) > -0.6 ? '#1aff8c' : '#0e4a2a'; ctx.fillRect(T.x - 2, cy - (JB.H + 4) / 2 - 6, 4, 4);
      ctx.restore();
      return;
    }
    const x = dir > 0 ? T.x - 8 : T.x - 6;
    ctx.fillStyle = '#151a24'; ctx.fillRect(x, cy - h / 2, 14, h);
    for (let k = 0; k < 14; k += 3) { ctx.fillStyle = k % 6 ? '#2a3344' : '#0c1018'; ctx.fillRect(x + k, cy - h / 2, 2, h); }   // the folds
    ctx.fillStyle = '#4a5a78'; ctx.fillRect(x, cy - h / 2, 14, 2); ctx.fillRect(x, cy + h / 2 - 2, 14, 2);
    ctx.fillStyle = Math.sin(t * 1.5) > -0.6 ? '#1aff8c' : '#0e4a2a'; ctx.fillRect(x + 5, cy - h / 2 - 5, 4, 4);   // sealed
    ctx.restore();
  }

  /** Where to put the centre of a hull of `key`'s rooms so that, if she is
   *  a SHAPED hull, she stands on her legs on the apron with her guns under
   *  the stage's title band (update176) — or `cy` unchanged. */
  function standFor(key, rect, cy, bandBottom, isPlayer = true) {
    if (!rect || typeof Ship === 'undefined') return cy;
    let sh = null;
    try { sh = new Ship(key, isPlayer, 0, 0); } catch (e) { return cy; }
    const g = sh.hullArtGeometry?.();
    if (!g?.shaped) return cy;
    const b = sh.roomBounds(), mid = b.y + b.h / 2;
    const guns = Math.min(g.box.y, ...(sh.weaponMounts?.() ?? []).map(m => m.y));
    /* a tall hull lets her gear down less (update198): what her guns would
       lose under the band comes off the drop, never below LEG.MIN_DROP */
    const over = (bandBottom + 4) - (rect.y + rect.h - 6 - LEG.DROP - (g.box.y + g.box.h - mid) - (mid - guns));
    const drop = Math.round(Math.max(LEG.MIN_DROP, LEG.DROP - Math.max(0, over)));
    _drop.set(`${key}|${isPlayer ? 1 : 0}`, drop);
    const floor = rect.y + rect.h - 6 - drop;                // her feet on the apron, inside the stage
    const c0 = floor - (g.box.y + g.box.h - mid);            // her feet on the apron…
    const topNow = c0 - (mid - guns);
    const c = topNow < bandBottom + 4 ? c0 + (bandBottom + 4) - topNow : c0;   // …her guns clear of the band…
    return Math.round(Math.min(c, c0 + 6));                   // …and her feet no lower than the stage's edge
  }

  /** The port plays the same landing and take-off (update205); the suites written before it skip it. */
  const PORT_SEQ = { on: true };
  /* COMING HOME IS A LANDING TOO (update214): the end of a contract lands her in the home bay
     first, then the window of the contract, then the hold if the shelf is short — and LAUNCH lifts
     off in it. The suites written before it skip it (tests/harness.js). */
  const HOME_SEQ = { on: true };
  return { draw, drawOver, bay, moorings, shiftFor, standFor, drawLegs, drawGear, gearArt, gearDrawn, dropOf, drawPads, drawStrut, floorOf, phase, arrive, depart, departing, departDone, endSequence, SEQ, SEQ_TOTAL, PORT_SEQ, HOME_SEQ, bridgeArt, bridgeDrawn, JB, LEG, hullFrame };
})();

if (typeof window !== 'undefined') window.DockArt = DockArt;
