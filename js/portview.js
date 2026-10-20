/* ============================================================
   MOON WARS — portview.js  (update143)
   The port: a promenade of stalls under a window on the dock.

   jj, 20.10: "zajmijmy się stacją, tam dużo do poprawki, teraz jest
   słabo … fajne może coś na wzór jak jest w Arc Raiders: menu sklep
   i stragany typu bar". The mock-up (mk_port.png) was accepted —
   "reszta chyba ok".

   What it is:
     the top third  — a window on the dock: your own hull (its real
                      picture) on the gantry, the moon, a planet.
     below it       — six stalls, one trade each, with a face behind
                      every counter:
         DRYDOCK        hull plating and modules
         GUNSMITH       guns
         QUARTERMASTER  He2, missiles, torpedoes, medkits, rations, ore —
                        bought by dragging crates off his counter
         THE CRATER     the bar: hands for hire, and what people say
         CLINIC         the sick, the virus, the ducts
         BROKER         selling what is in your hold
     a line of talk from the bar, and DEPART.

   PortView only DRAWS the place and says what was clicked:
       PortView.open(station, ship)
       PortView.update(dt)  → { act: 'stall', key } | { act: 'depart' } | null
       PortView.draw(ctx)
   game.js decides what a stall opens. Nothing here moves money.

   The picture of the place is painted ONCE per port (its seed) at half
   size and blown up twice, the way the hull pictures are: crisp pixels,
   one drawImage a frame.
   ============================================================ */

'use strict';

const PortView = (() => {
  const W = 1280, H = 720;
  const PW = 640, PH = 360;              // the painting, doubled on screen

  /* ── THE SIX STALLS ─────────────────────────────────────── */
  const STALLS = [
    { key: 'drydock', name: 'DRYDOCK',       sub: 'hull · modules',          col: '#4db8ff', awn: '#1d4f7a', icon: 'wrench', suit: '#2a4a6a' },
    { key: 'guns',    name: 'GUNSMITH',      sub: 'weapons',                 col: '#ff5566', awn: '#6e1f2a', icon: 'gun',    suit: '#5a2a30' },
    { key: 'qm',      name: 'QUARTERMASTER', sub: 'He2 · ammo · food',       col: '#ffb020', awn: '#6a4a10', icon: 'crate',  suit: '#5a4a20' },
    { key: 'bar',     name: 'THE CRATER',    sub: 'bar · hire · rumours',    col: '#c06bff', awn: '#46205e', icon: 'glass',  suit: '#3a2050' },
    { key: 'clinic',  name: 'CLINIC',        sub: 'heal · cure · fumigate',  col: '#1aff8c', awn: '#145a3a', icon: 'cross',  suit: '#c8e0d8' },
    { key: 'broker',  name: 'BROKER',        sub: 'sell cargo · ore',        col: '#ffd700', awn: '#5a5010', icon: 'coin',   suit: '#4a4420' },
  ];
  const SW = 104, SX0 = 8, SY = 176;     // a stall's width, the first one's x, their top (painting units)

  /** A stall's rectangle on SCREEN — what is clicked and what lights up. */
  function stallRect(i) {
    return { x: (SX0 + i * SW) * 2, y: (SY - 5) * 2, w: (SW - 6) * 2, h: 148 * 2 };
  }
  const DEPART = { x: 1100, y: 664, w: 160, h: 42 };

  /* ── State ──────────────────────────────────────────────── */
  let _st = null, _ship = null;
  let _hot = -1;
  let _zones = [];
  let _t = 0;
  let _scene = null;                     // { seed, base, frame }

  function open(station, ship) { _st = station; _ship = ship; _hot = -1; _t = 0; }
  function close() { _st = null; _ship = null; }
  function isOpen() { return !!_st; }

  /** The stalls that are open for trade — none, when the port has shut
   *  its doors on him (karma: `station.refusal()`). */
  function openStalls() {
    if (!_st) return [];
    return _st.refusal?.() ? [] : STALLS.map(s => s.key);
  }

  /* ── A seeded hand for the painting ─────────────────────── */
  function _rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function _canvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  const shade = (hex, f) => {
    const n = parseInt(String(hex).slice(1, 7), 16); const r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
    const m = v => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
    return '#' + [m(r), m(gg), m(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  };

  /* ── THE PAINTING ───────────────────────────────────────── */
  function _paint(seed, type) {
    const base = _canvas(PW, PH), frame = _canvas(PW, 160);
    if (!base || !frame) return null;
    const g = base.getContext('2d');
    const rnd = _rng(seed);
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); };

    // ── the window: space, a planet, the moon's horizon, the gantry ──
    const wy0 = 14, wy1 = 150;
    const sky = g.createLinearGradient(0, wy0, 0, wy1);
    sky.addColorStop(0, '#03040c'); sky.addColorStop(1, '#0b1028');
    g.fillStyle = sky; g.fillRect(0, wy0, PW, wy1 - wy0);
    for (let i = 0; i < 220; i++) {
      const x = rnd() * PW, y = wy0 + rnd() * 90;
      g.fillStyle = `rgba(${90 + rnd() * 60 | 0},${70 + rnd() * 40 | 0},${170 + rnd() * 60 | 0},${rnd() * 0.06})`;
      g.beginPath(); g.arc(x, y, 6 + rnd() * 18, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 380; i++) { const v = rnd(); R(rnd() * PW, wy0 + rnd() * (wy1 - wy0), 1, 1, v > 0.93 ? '#ffffff' : v > 0.7 ? '#9fb4ff' : '#4a5680'); }
    // the planet — its colour from the port's seed
    const px = 520 + rnd() * 60, py = 46 + rnd() * 14, pr = 34 + rnd() * 10;
    const tints = [['#a9c8f0', '#4f7fc0', '#1a2c55'], ['#f0d0a9', '#c08a4f', '#55301a'], ['#c8f0d8', '#4fc08a', '#1a5538']];
    const tc = tints[(rnd() * tints.length) | 0];
    const pg = g.createRadialGradient(px - 14, py - 12, 4, px, py, pr);
    pg.addColorStop(0, tc[0]); pg.addColorStop(0.55, tc[1]); pg.addColorStop(1, tc[2]);
    g.fillStyle = pg; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 40; i++) { const a = rnd() * 7, d = rnd() * pr * 0.85;
      g.fillStyle = `rgba(20,30,50,${0.2 + rnd() * 0.3})`; g.beginPath(); g.arc(px + Math.cos(a) * d, py + Math.sin(a) * d, 1 + rnd() * 4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(2,4,12,0.55)'; g.beginPath(); g.arc(px + 16, py + 10, pr, 0, Math.PI * 2); g.fill();
    // the moon under the window
    g.fillStyle = '#4b4d57';
    g.beginPath(); g.moveTo(0, 128);
    for (let x = 0; x <= PW; x += 8) g.lineTo(x, 122 + Math.sin(x * 0.021 + seed) * 5 + Math.sin(x * 0.07) * 2);
    g.lineTo(PW, wy1); g.lineTo(0, wy1); g.fill();
    g.fillStyle = '#5d606b';
    g.beginPath(); g.moveTo(0, 136);
    for (let x = 0; x <= PW; x += 6) g.lineTo(x, 132 + Math.sin(x * 0.033 + 1 + seed) * 3);
    g.lineTo(PW, wy1); g.lineTo(0, wy1); g.fill();
    for (let i = 0; i < 26; i++) { const x = rnd() * PW, y = 134 + rnd() * 14, r = 2 + rnd() * 5;
      g.fillStyle = '#3e4049'; g.beginPath(); g.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#6f727d'; g.fillRect(x - r, y - r * 0.35, r * 2, 1); }
    for (let i = 0; i < 18; i++) R(30 + rnd() * 160, 120 + rnd() * 6, 1, 1, rnd() > 0.5 ? '#ffb24a' : '#ffd890');
    // pylon and the boarding tube the ship is moored to
    R(430, 40, 18, 112, '#2a2f3c'); R(432, 40, 2, 112, '#3c4356'); R(446, 40, 2, 112, '#1b1f29');
    for (let y = 46; y < 150; y += 12) R(430, y, 18, 1, '#1b1f29');
    R(424, 36, 30, 6, '#343b4c'); R(437, 28, 4, 8, '#343b4c'); R(438, 24, 2, 4, '#ff4a4a');
    R(312, 86, 118, 10, '#2c3242'); R(312, 86, 118, 2, '#46506a'); R(312, 94, 118, 2, '#1a1e28');
    for (let x = 316; x < 430; x += 8) R(x, 88, 1, 6, '#1d2230');
    for (let x = 318; x < 430; x += 16) R(x, 90, 3, 2, '#ffcf6a');
    R(306, 82, 8, 18, '#343b4c'); R(306, 82, 8, 1, '#56607a');
    R(60, 118, 250, 4, '#2a2f3c'); R(60, 118, 250, 1, '#46506a');      // the cradle under the hull
    R(70, 114, 6, 34, '#2a2f3c'); R(294, 114, 6, 34, '#2a2f3c');

    // ── the promenade ──
    R(0, 160, PW, 170, '#11151f');
    for (let x = 0; x < PW; x += 32) { R(x, 160, 1, 170, '#0b0e15'); R(x + 1, 160, 1, 170, '#171c28'); }
    for (let y = 168; y < 330; y += 22) R(0, y, PW, 1, '#0d1018');
    R(0, 162, PW, 3, '#262d3c'); R(0, 162, PW, 1, '#3a4458'); R(0, 167, PW, 2, '#1d2330');
    for (let x = 20; x < PW; x += 90) R(x, 161, 5, 9, '#30384a');
    R(0, 318, PW, 42, '#191d27');
    for (let y = 318; y < PH; y += 6) R(0, y, PW, 1, '#141821');
    for (let x = 0; x < PW; x += 24) R(x + ((x / 24) % 2) * 6, 318, 1, 42, '#141821');
    R(0, 318, PW, 2, '#2a3140');
    for (let x = 6; x < PW; x += 20) R(x, 344, 8, 1, 'rgba(255,178,74,0.33)');
    STALLS.forEach((s, i) => _paintStall(g, R, rnd, i, s, type));

    // ── the window frame, on its own sheet: it goes OVER the ship ──
    const f = frame.getContext('2d');
    const Fr = (x, y, w, h, c) => { f.fillStyle = c; f.fillRect(x, y, w, h); };
    Fr(0, 0, PW, 14, '#151a24'); Fr(0, 12, PW, 2, '#252c3c');
    Fr(0, 150, PW, 10, '#1a202c'); Fr(0, 150, PW, 1, '#3a4458'); Fr(0, 158, PW, 2, '#0c0f16');
    for (const x of [0, 158, 318, 478, 636]) { Fr(x, 14, 4, 136, '#1a202c'); Fr(x + 1, 14, 1, 136, '#2c3446'); }
    Fr(0, 80, PW, 3, '#1a202c'); Fr(0, 80, PW, 1, '#2c3446');
    f.fillStyle = 'rgba(160,190,255,0.035)';
    for (let k = 0; k < 4; k++) { f.beginPath(); f.moveTo(40 + k * 160, 14); f.lineTo(80 + k * 160, 14); f.lineTo(20 + k * 160, 150); f.lineTo(-20 + k * 160, 150); f.fill(); }
    return { seed, base, frame };
  }

  function _icon(R, kind, x, y, col) {
    const p = (dx, dy, w = 1, h = 1) => R(x + dx, y + dy, w, h, col);
    switch (kind) {
      case 'wrench': p(1, 1, 3, 2); p(3, 3, 2, 2); p(5, 5, 2, 2); p(7, 7, 2, 2); p(0, 0, 1, 2); p(2, 0, 2, 1); break;
      case 'gun':    p(0, 3, 9, 3); p(9, 4, 2, 1); p(2, 6, 2, 3); p(5, 2, 3, 1); break;
      case 'crate':  p(0, 1, 9, 8); R(x + 1, y + 2, 7, 6, 'rgba(0,0,0,0.4)'); p(0, 4, 9, 1); p(4, 1, 1, 8); break;
      case 'glass':  p(0, 0, 8, 1); p(1, 1, 6, 1); p(2, 2, 4, 1); p(3, 3, 2, 3); p(1, 6, 6, 1); p(6, 0, 1, 1); break;
      case 'cross':  p(3, 0, 3, 9); p(0, 3, 9, 3); break;
      case 'coin':   p(2, 0, 5, 1); p(1, 1, 7, 7); p(2, 8, 5, 1); R(x + 3, y + 2, 3, 5, 'rgba(0,0,0,0.3)'); break;
    }
  }

  function _paintStall(g, R, rnd, i, s, type) {
    const x = SX0 + i * SW, w = SW - 6, y = SY;
    R(x, y, w, 142, '#0a0d14');
    R(x, y, 2, 142, '#202738'); R(x + w - 2, y, 2, 142, '#202738');
    const lg = g.createLinearGradient(0, y + 20, 0, y + 120);
    lg.addColorStop(0, s.col + '30'); lg.addColorStop(1, s.col + '05');
    g.fillStyle = lg; g.fillRect(x + 2, y + 20, w - 4, 100);
    // shelves of stock
    for (let k = 0; k < 2; k++) {
      const sy = y + 38 + k * 22;
      R(x + 6, sy + 12, w - 12, 2, '#3a3226'); R(x + 6, sy + 14, w - 12, 1, '#1a160f');
      let cx = x + 8;
      while (cx < x + w - 16) {
        const cw = 5 + (rnd() * 8 | 0), ch = 4 + (rnd() * 8 | 0);
        const cc = [s.col, '#7a6a52', '#4a5a6a', '#8a8f9a', shade(s.col, -0.4)][rnd() * 5 | 0];
        R(cx, sy + 12 - ch, cw, ch, shade(cc, -0.25)); R(cx, sy + 12 - ch, cw, 1, shade(cc, 0.2));
        cx += cw + 1 + (rnd() * 3 | 0);
      }
    }
    // what each trade keeps on the wall behind its counter
    if (s.key === 'guns')    { R(x + 10, y + 26, 40, 3, '#555c6a'); R(x + 48, y + 27, 6, 1, '#888888'); R(x + 54, y + 26, 30, 3, '#4a505c'); }
    if (s.key === 'bar')     { for (let k = 0; k < 7; k++) R(x + 10 + k * 11, y + 50 + (k % 2), 3, 8, ['#ffb020', '#4dd8ff', '#ff5566', '#1aff8c'][k % 4] + 'cc'); }
    if (s.key === 'clinic')  { R(x + w / 2 - 10, y + 22, 20, 22, '#d8f0e6'); R(x + w / 2 - 2, y + 25, 4, 16, '#1aff8c'); R(x + w / 2 - 8, y + 31, 16, 4, '#1aff8c'); }
    if (s.key === 'drydock') { R(x + 12, y + 24, 70, 34, '#0d2236'); for (let k = 0; k < 5; k++) R(x + 14, y + 28 + k * 6, 66, 1, '#1d4f7a'); R(x + 30, y + 32, 30, 12, s.col + '55'); }
    if (s.key === 'broker')  { for (let k = 0; k < 5; k++) R(x + 14 + k * 14, y + 56 - k * 4, 10, 4 + k * 4, '#ffd70088'); }
    // the counter, its front to the floor, a plate for the trade's words
    R(x + 2, y + 94, w - 4, 48, '#232835'); R(x + 2, y + 94, w - 4, 3, shade(s.col, -0.1)); R(x + 2, y + 97, w - 4, 1, '#46506a');
    R(x + 2, y + 98, w - 4, 1, '#151922');
    R(x + 8, y + 110, w - 16, 14, '#0b0e15'); R(x + 8, y + 110, w - 16, 1, s.col + '66'); R(x + 8, y + 123, w - 16, 1, s.col + '33');
    for (let k = x + 6; k < x + w - 6; k += 6) R(k, y + 132, 3, 1, '#2e3546');
    for (let k = 0; k < 3; k++) { const cc = [s.col, '#8a8f9a', shade(s.col, -0.3)][k]; R(x + 10 + k * 7, y + 89, 5, 5, cc); R(x + 10 + k * 7, y + 89, 5, 1, shade(cc, 0.3)); }
    R(x + w - 24, y + 88, 12, 6, '#0d1a12'); R(x + w - 22, y + 90, 8, 2, s.col);
    // the awning
    for (let k = 0; k < w; k += 8) {
      const c = (k / 8) % 2 ? s.awn : shade(s.awn, 0.18);
      R(x + k, y + 10, Math.min(8, w - k), 8, c); R(x + k + 1, y + 18, Math.min(6, w - k - 1), 2, c);
    }
    R(x, y + 9, w, 1, shade(s.awn, 0.4));
    // the sign over it
    R(x + 4, y - 4, w - 8, 13, '#07090e'); R(x + 4, y - 4, w - 8, 1, s.col + '90'); R(x + 4, y + 8, w - 8, 1, s.col + '90');
    _icon(R, s.icon, x + 8, y - 2, s.col);
    R(x + w - 14, y + 20, 6, 3, '#2a2f3c'); R(x + w - 13, y + 23, 4, 2, '#ffe0a0');
    void type;
  }

  /* ── THE PEOPLE BEHIND THE COUNTERS ─────────────────────── */
  /** A stall-keeper's record: the same face every visit to this port. */
  function vendor(i) {
    const s = STALLS[i];
    const corps = (typeof CORP_DEFS !== 'undefined') ? Object.keys(CORP_DEFS).filter(k => !CORP_DEFS[k].pet) : [];
    const seed = ((_st?.seed ?? 0) * 31 + i * 7919) >>> 0;
    const pool = (typeof CREW_NAMES !== 'undefined' && CREW_NAMES.length) ? CREW_NAMES : null;
    return { name: pool ? pool[seed % pool.length] : `${s.name} ${seed % 97}`, faceSeed: seed & 0x7fffffff,
             race: corps.length ? corps[seed % corps.length] : null, isPlayer: true };
  }

  /* ── WHAT EACH STALL HAS TODAY (the line under the pointer) ── */
  function stallLine(key) {
    const s = _st, sh = _ship;
    if (!s) return '';
    const st = s.stock ?? {};
    switch (key) {
      case 'qm': {
        const bits = [];
        if (st.fuel > 0) bits.push(`He2 ${s.fuelCost?.()} CC`);
        if (st.missiles > 0) bits.push(`missiles ${s.missileCost?.()} CC`);
        if ((st.torpedoes ?? 0) > 0) bits.push(`torpedoes ${s.torpedoCost?.()} CC`);
        if ((st.medkits ?? 0) > 0) bits.push('medkits');
        const kinds = Object.values(st.rations ?? {}).filter(n => n > 0).length;
        if (kinds) bits.push(`${kinds} kind${kinds > 1 ? 's' : ''} of rations`);
        return bits.length ? bits.join(' · ') : 'the shelves are bare';
      }
      case 'guns': {
        const left = (st.weapons ?? []).filter(w => !w.sold);
        return left.length ? left.map(w => `${w.def.label} ${s.weaponCost?.(w) ?? w.def.cost} CC`).join(' · ') : 'nothing on the rack today';
      }
      case 'drydock': {
        const mods = (st.newModules ?? []).filter(m => !m.sold).length;
        const hurt = sh ? sh.hullMax - sh.hull : 0;
        return `hull ${s.hullRepairCost?.()} CC a point${hurt ? ` — ${hurt} to weld` : ''} · ${mods} new module${mods === 1 ? '' : 's'}`;
      }
      case 'bar': {
        const hands = (st.crew ?? []).filter(c => !c.sold).length;
        return hands ? `${hands} hand${hands > 1 ? 's' : ''} looking for a berth · ${s.crewCost?.()} CC` : 'nobody looking for a berth';
      }
      case 'clinic': {
        const sick = sh ? sh.crew.filter(c => !c.dead && !c.isBeast && (c.hp < c.maxHp || c.state === 'injured' || c.infected || c.virus)).length : 0;
        return sick ? `${sick} of yours need seeing to` : 'every hand is fit';
      }
      case 'broker': {
        // the broker's own price — the same one his counter pays (update144)
        const worth = sh?.cargo ? sh.cargo.items.reduce((n, it) => n + (s.brokerPrice?.(it) ?? 0), 0) : 0;
        return worth ? `your hold is worth ~${worth} CC here` : 'your hold is empty';
      }
    }
    return '';
  }

  /* ── WHAT PEOPLE SAY AT THE BAR ─────────────────────────── */
  const RUMOURS = [
    'Pirates sit on the nebula lane. A raider took a hauler\'s cargo last week.',
    'The patrol boss changes course when his shields go down. Hit him early.',
    'A derelict out past the belt still has her hold sealed. Nobody came back.',
    'Somebody is paying in He-3 for bodies. Science post, they say.',
    'Rats in the ducts again. Keep the rations stowed or they find them.',
    'The Gate crews want ore, not money. Bring ore.',
    'An ion cannon will strip a shield in one go — if you can feed it the power.',
    'Two hands from the last crew that came through never made it home.',
    'They say a frontier outpost sells He2 cheapest — and asks the fewest questions.',
    'Carry a spare medkit. The clinic does not fly with you.',
  ];
  function rumour() {
    if (!_st) return '';
    return RUMOURS[((_st.seed ?? 0) + (_st.sector ?? 1) * 3) % RUMOURS.length];
  }

  /* ── BESIDE A COUNTER (update144) ──────────────────────── */
  const KEEPER_WORDS = {
    qm:     ['Cells, racks, rations.', 'What you take off the counter', 'goes straight into your hold.', 'He buys back at half.'],
    broker: ['Put it on the counter,', 'take the money.', 'He pays what this port pays —', 'no more, no less.'],
    guns:   ['Boxed and ready.', 'Take one, it goes in your hold —', 'UNBOX & FIT bolts it on.', 'He pays half for yours.'],
  };
  const PORT_WORDS = {
    military: 'Fleet yard: contraband is SEIZED, with a fine.',
    science:  'Research post: data cores and relics fetch a premium.',
    outpost:  'Frontier outpost: low prices, no questions.',
    general:  'Trade hub: fair prices across the board.',
  };

  /** What he quotes today, as [label, price] rows. */
  function todayPrices(key) {
    const s = _st, st = s?.stock ?? {};
    if (!s) return [];
    if (key === 'qm') {
      const rows = [];
      if (st.fuel > 0) rows.push(['He2, a unit', `${s.fuelCost(1)} CC`]);
      if (st.missiles > 0) rows.push(['missile', `${s.missileCost(1)} CC`]);
      if ((st.torpedoes ?? 0) > 0) rows.push(['torpedo', `${s.torpedoCost(1)} CC`]);
      if ((st.medkits ?? 0) > 0) rows.push(['medkit (5 doses)', `${s.medkitCost(1)} CC`]);
      Object.entries(st.rations ?? {}).filter(([, n]) => n > 0).forEach(([k]) =>
        rows.push([`${(typeof CARGO_ITEMS !== 'undefined' && CARGO_ITEMS[k]?.label) || k}, a meal`, `${s.rationCost(k, 1)} CC`]));
      if ((st.he3 ?? 0) > 0) rows.push(['He-3 ore', `${s.he3Cost(1)} CC`]);
      return rows;
    }
    if (key === 'guns') {
      return (st.weapons ?? []).filter(w => !w.sold).map(w => [w.def?.label ?? w.key, `${s.weaponCost(w)} CC`]);
    }
    if (key === 'broker') {
      // what of YOURS he would pay most for
      const hold = _ship?.cargo?.items ?? [];
      return hold.map(it => [it.label, s.brokerPrice?.(it)]).filter(([, p]) => p != null)
        .sort((a, b) => b[1] - a[1]).slice(0, 7)
        .map(([l, p]) => [l, p === 0 ? 'seized' : `${p} CC`]);
    }
    return [];
  }

  /** The man behind the counter: his face, his name, a few words, today's prices. */
  function drawKeeper(ctx, key, R) {
    const i = STALLS.findIndex(s => s.key === key);
    if (i < 0 || !R) return;
    const s = STALLS[i];
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.94)'; ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.strokeStyle = s.col + '88'; ctx.lineWidth = 1; ctx.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1);
    ctx.fillStyle = s.col; ctx.fillRect(R.x, R.y, 3, 24);
    _text(ctx, s.name, R.x + 12, R.y + 17, s.col, 13, 'left', 'bold');
    const v = vendor(i);
    const pc = (typeof CrewArt !== 'undefined' && CrewArt.portraitCanvas) ? CrewArt.portraitCanvas(v) : null;
    const size = Math.min(88, R.w - 24);
    let y = R.y + 30;
    if (pc) {
      ctx.fillStyle = s.suit; ctx.fillRect(R.x + R.w / 2 - size / 2, y, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pc, R.x + R.w / 2 - size / 2, y, size, size);
      y += size + 16;
    }
    _text(ctx, `"${v.name}"`, R.x + R.w / 2, y, '#e8f4ff', 12, 'center');
    y += 18;
    const words = [...(KEEPER_WORDS[key] ?? [])];
    if (key === 'broker') words.push('', PORT_WORDS[_st?.type] ?? PORT_WORDS.general);
    // wrapped to the panel: a narrow screen leaves a narrow panel
    const per = Math.max(12, Math.floor((R.w - 20) / 6));
    const lines = [];
    words.forEach(l => {
      let cur = '';
      String(l).split(' ').forEach(w => {
        if (cur && (cur + ' ' + w).length > per) { lines.push(cur); cur = w; }
        else cur = cur ? cur + ' ' + w : w;
      });
      lines.push(cur);
    });
    lines.forEach(l => { _text(ctx, l, R.x + R.w / 2, y, '#9fb4d0', 10, 'center'); y += 13; });
    const rows = todayPrices(key);
    if (rows.length && y < R.y + R.h - 30) {
      y += 8;
      _text(ctx, key === 'broker' ? 'WHAT HE WOULD PAY YOU' : key === 'guns' ? 'ON THE RACK' : 'TODAY', R.x + 12, y, s.col, 10, 'left', 'bold');
      y += 15;
      for (const [a, b] of rows) {
        if (y > R.y + R.h - 8) break;
        _text(ctx, String(a).slice(0, Math.floor((R.w - 80) / 6)), R.x + 12, y, '#c8d8f0', 10);
        _text(ctx, String(b), R.x + R.w - 12, y, '#ffd700', 10, 'right');
        y += 14;
      }
    }
    // the gunsmith also shows what you have bolted on, bay by bay
    if (key === 'guns' && _ship && y < R.y + R.h - 30) {
      y += 10;
      _text(ctx, 'YOUR MOUNTS', R.x + 12, y, s.col, 10, 'left', 'bold');
      y += 15;
      mountRows().forEach(([a, b]) => {
        if (y > R.y + R.h - 8) return;
        _text(ctx, a, R.x + 12, y, '#7a90a8', 10);
        _text(ctx, b, R.x + R.w - 12, y, b === 'empty' ? '#5a7090' : '#e8f4ff', 10, 'right');
        y += 14;
      });
    }
    ctx.restore();
    ctx.textAlign = 'left';
  }

  /** Your weapon bays and what is in each. */
  function mountRows() {
    const sh = _ship;
    if (!sh) return [];
    return sh.weaponRooms.map((r, i) => [`bay ${i + 1}`, sh.weapons[i]?.def?.label ?? 'empty']);
  }

  /** The receipt: what crossed the counters this visit, and the purse. */
  function drawLedger(ctx, R) {
    if (!R || !_st) return;
    const L = _st.ledger ?? [];
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.94)'; ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.strokeStyle = '#ffd70066'; ctx.lineWidth = 1; ctx.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1);
    ctx.fillStyle = '#ffd700'; ctx.fillRect(R.x, R.y, 3, 24);
    _text(ctx, 'THIS VISIT', R.x + 12, R.y + 17, '#ffd700', 13, 'left', 'bold');
    let y = R.y + 42;
    if (!L.length) { _text(ctx, 'nothing has changed hands yet', R.x + 12, y, '#5a7090', 10); y += 14; }
    const room = Math.max(1, Math.floor((R.h - 120) / 14));
    const shown = L.slice(-room);
    if (L.length > shown.length) { _text(ctx, `… ${L.length - shown.length} earlier`, R.x + 12, y, '#5a7090', 10); y += 14; }
    const cut = Math.floor((R.w - 80) / 6);
    shown.forEach(e => {
      const what = `${e.qty > 1 ? e.qty + ' × ' : ''}${e.label}`;
      _text(ctx, what.length > cut ? what.slice(0, cut - 1) + '…' : what, R.x + 12, y, '#c8d8f0', 10);
      _text(ctx, `${e.cc > 0 ? '+' : ''}${e.cc} CC`, R.x + R.w - 12, y, e.cc >= 0 ? '#1aff8c' : '#ffd700', 10, 'right');
      y += 14;
    });
    const spent = L.reduce((n, e) => n + (e.cc < 0 ? -e.cc : 0), 0), got = L.reduce((n, e) => n + (e.cc > 0 ? e.cc : 0), 0);
    const by = R.y + R.h - 58;
    ctx.fillStyle = '#26324a'; ctx.fillRect(R.x + 12, by - 12, R.w - 24, 1);
    _text(ctx, 'spent', R.x + 12, by + 2, '#7a90a8', 10); _text(ctx, `${spent} CC`, R.x + R.w - 12, by + 2, '#ffd700', 11, 'right');
    _text(ctx, 'taken in', R.x + 12, by + 18, '#7a90a8', 10); _text(ctx, `${got} CC`, R.x + R.w - 12, by + 18, '#1aff8c', 11, 'right');
    const run = (typeof Save !== 'undefined') ? Save.getRun?.() : null;
    _text(ctx, 'in your purse', R.x + 12, by + 38, '#7a90a8', 10); _text(ctx, `${run?.scrap ?? 0} CC`, R.x + R.w - 12, by + 38, '#e8f4ff', 13, 'right', 'bold');
    ctx.restore();
    ctx.textAlign = 'left';
  }

  /* ── Update ─────────────────────────────────────────────── */
  function update(dt) {
    if (!_st) return null;
    _t += dt;
    const mx = Input.mouse.x, my = Input.mouse.y;
    const open = openStalls();
    _hot = -1;
    STALLS.forEach((s, i) => {
      const r = stallRect(i);
      if (open.includes(s.key) && Utils.pointInRect(mx, my, r.x, r.y, r.w, r.h)) _hot = i;
    });
    if (_hot >= 0) Audio.hoverCue?.(`port:${STALLS[_hot].key}`);
    // the number keys go straight to a stall
    for (let i = 0; i < STALLS.length; i++) {
      if (Input.isPressed?.(`Digit${i + 1}`) && open.includes(STALLS[i].key)) return { act: 'stall', key: STALLS[i].key };
    }
    if (Input.mouse.leftPressed) {
      if (_hot >= 0) { Audio.sfx?.uiClick?.(); return { act: 'stall', key: STALLS[_hot].key }; }
      if (Utils.pointInRect(mx, my, DEPART.x, DEPART.y, DEPART.w, DEPART.h)) { Audio.sfx?.uiClick?.(); return { act: 'depart' }; }
    }
    return null;
  }

  /* ── Draw ───────────────────────────────────────────────── */
  const F = (px, w = '') => `${w} ${px}px Share Tech Mono, monospace`;
  function _text(ctx, t, x, y, col, px, align = 'left', w = '') {
    ctx.font = F(px, w); ctx.fillStyle = col; ctx.textAlign = align; ctx.fillText(t, x, y);
  }

  /** Your hull, moored at the boarding tube: its picture and roof,
   *  scaled into the window, its bow at the tube. */
  function _drawShipInWindow(ctx) {
    const sh = _ship;
    if (!sh) return;
    const art = sh.hullArt?.(), roof = sh.roofArt?.(), geom = sh.hullArtGeometry?.();
    const box = art?.geom?.box ?? geom?.box;
    if (!box) return;
    const s = Math.min(0.7, 560 / box.w, 190 / box.h);
    const w = box.w * s, h = box.h * s;
    const x = 618 - w, y = 182 - h / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 28, W, 272); ctx.clip();
    if (art) {
      ctx.drawImage(art.img, x, y, w, h);
      if (roof) ctx.drawImage(roof.img, x, y, w, h);
    } else {
      // no picture: the plate in the hull's colour, the way the roof falls back
      ctx.translate(x - box.x * s, y - box.y * s); ctx.scale(s, s);
      ctx.fillStyle = sh.isPlayer ? '#2a4a70' : '#6a2a2a';
      (geom?.plate ?? []).concat(geom?.engines ?? [], geom?.prows ?? []).forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h));
    }
    ctx.restore();
    // running lights, blinking
    const on = Math.sin(_t * 3) > 0;
    ctx.fillStyle = on ? '#1aff8c' : '#0a4a2a'; ctx.fillRect(x + 8, y + 10, 3, 3);
    ctx.fillStyle = on ? '#ff3a3a' : '#4a1010'; ctx.fillRect(x + 8, y + h - 13, 3, 3);
    const label = (typeof SHIP_CATALOG !== 'undefined' && SHIP_CATALOG[sh.layoutKey]?.label) || sh.layout?.label || 'YOUR SHIP';
    _text(ctx, `${String(label).toUpperCase()} — docked at gantry ${((_st?.seed ?? 0) % 7) + 1}`, x + w / 2, Math.min(296, y + h + 16), '#9fb4d0', 11, 'center');
  }

  function _drawVendor(ctx, i) {
    if (typeof CrewArt === 'undefined' || !CrewArt.portraitCanvas) return;
    const pc = CrewArt.portraitCanvas(vendor(i));
    if (!pc) return;
    const r = stallRect(i);
    const size = 60;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // shoulders in the trade's colours, then the face over them
    ctx.fillStyle = STALLS[i].suit;
    ctx.fillRect(r.x + r.w / 2 - 26, (SY + 80) * 2, 52, 16);
    ctx.drawImage(pc, r.x + r.w / 2 - size / 2, (SY + 94) * 2 - size, size, size);
    ctx.restore();
  }

  function draw(ctx) {
    if (!_st) return;
    _zones = [];
    if (!_scene || _scene.seed !== (_st.seed ?? 0)) _scene = _paint(_st.seed ?? 0, _st.type) || { seed: _st.seed ?? 0 };
    ctx.save();
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    if (_scene.base) ctx.drawImage(_scene.base, 0, 0, W, H);
    _drawShipInWindow(ctx);
    ctx.imageSmoothingEnabled = false;
    if (_scene.frame) ctx.drawImage(_scene.frame, 0, 0, W, 320);
    STALLS.forEach((s, i) => _drawVendor(ctx, i));
    ctx.restore();

    const port = { military: '#ff5566', science: '#4dd8ff', general: '#1aff8c', outpost: '#ffb020' }[_st.type] || '#1aff8c';
    const LINES = {
      military: 'Fleet yard — heavier guns, plating on tap.',
      science:  'Research post — modules and odd tech.',
      general:  'Trade hub — a bit of everything, fair prices.',
      outpost:  'Frontier outpost — thin stock, cheap fuel.',
    };
    // ── the bar at the top ──
    ctx.fillStyle = 'rgba(5,8,14,0.82)'; ctx.fillRect(0, 0, W, 50);
    ctx.fillStyle = port; ctx.fillRect(0, 49, W, 1);
    ctx.strokeStyle = port; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(36, 25, 15, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(36, 13); ctx.lineTo(36, 37); ctx.moveTo(24, 25); ctx.lineTo(48, 25); ctx.stroke();
    _text(ctx, String(_st.name ?? 'PORT').toUpperCase(), 64, 24, '#e8f4ff', 20, 'left', 'bold');
    _text(ctx, LINES[_st.type] || LINES.general, 64, 42, '#7a90a8', 11);
    const badgeX = 64 + Math.max(220, String(_st.name ?? '').length * 13 + 24);
    ctx.lineWidth = 1; ctx.strokeStyle = port; ctx.strokeRect(badgeX + 0.5, 12.5, 92, 22);
    _text(ctx, String(_st.type ?? 'general').toUpperCase(), badgeX + 46, 28, port, 12, 'center');
    const sh = _ship, run = (typeof Save !== 'undefined') ? Save.getRun?.() : null;
    if (sh) {
      const hc = sh.hull < sh.hullMax * 0.34 ? '#ff2d44' : sh.hull < sh.hullMax * 0.67 ? '#ffd700' : '#1aff8c';
      _text(ctx, `HULL ${sh.hull}/${sh.hullMax}`, 820, 30, hc, 13);
      _text(ctx, `He2 ${sh.cargo ? sh.cargo.countOf('fuel') : run?.fuel ?? 0}`, 950, 30, '#ff5566', 13);
      if (sh.cargo) _text(ctx, `HOLD ${sh.cargo.usedCells()}/${sh.cargo.capacity}`, 1020, 30, '#4db8ff', 13);
    }
    _text(ctx, `${run?.scrap ?? 0} CC`, 1250, 31, '#ffd700', 18, 'right', 'bold');

    // ── the stalls: names on the signs, trades on the counters ──
    const open = openStalls();
    STALLS.forEach((s, i) => {
      const r = stallRect(i), shut = !open.includes(s.key), hot = i === _hot;
      _text(ctx, s.name, r.x + r.w / 2 + 10, SY * 2 + 6, shut ? '#4a5568' : s.col, s.name.length > 11 ? 12 : 14, 'center', 'bold');
      _text(ctx, `${i + 1} · ${s.sub}`, r.x + r.w / 2, SY * 2 + 238, shut ? '#4a5568' : '#b8c8dc', 10, 'center');
      if (shut) {
        // the shutter is down
        ctx.fillStyle = 'rgba(30,34,44,0.92)'; ctx.fillRect(r.x + 4, (SY + 20) * 2, r.w - 8, 148);
        ctx.fillStyle = 'rgba(60,66,80,0.9)';
        for (let y = (SY + 20) * 2; y < (SY + 20) * 2 + 148; y += 8) ctx.fillRect(r.x + 4, y, r.w - 8, 2);
        _text(ctx, 'CLOSED', r.x + r.w / 2, (SY + 58) * 2, '#8a94a8', 13, 'center', 'bold');
        return;
      }
      if (hot) {
        ctx.strokeStyle = s.col; ctx.lineWidth = 2;
        ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
        ctx.fillStyle = s.col + '18'; ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      _zones.push({ act: 'stall', arg: s.key, ...r });
    });

    // ── what the stall under the pointer has today ──
    if (_hot >= 0) {
      const s = STALLS[_hot], r = stallRect(_hot);
      const line = stallLine(s.key);
      const tw = Math.max(260, Math.min(520, line.length * 7 + 30));
      const tx = Utils.clamp(r.x + r.w / 2 - tw / 2, 10, W - tw - 10);
      ctx.fillStyle = 'rgba(5,8,14,0.94)'; ctx.fillRect(tx, 290, tw, 44);
      ctx.strokeStyle = s.col; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, 290.5, tw - 1, 43);
      _text(ctx, line, tx + tw / 2, 309, '#e8f4ff', 11, 'center');
      _text(ctx, s.key === 'qm' ? 'click — his counter: take a crate, put it in your hold' : 'click to go over', tx + tw / 2, 325, s.col, 11, 'center');
    }

    // ── the bottom line: what the bar is saying, or why the port is shut ──
    const refused = _st.refusal?.();
    const label = (typeof Commander !== 'undefined' && Commander.reputationLabel) ? Commander.reputationLabel() : null;
    ctx.fillStyle = 'rgba(5,8,14,0.88)'; ctx.fillRect(20, 664, 1060, 42);
    if (refused) {
      ctx.strokeStyle = '#ff2d44'; ctx.lineWidth = 1; ctx.strokeRect(20.5, 664.5, 1060, 42);
      _text(ctx, 'DOCK CLOSED', 34, 682, '#ff2d44', 11, 'left', 'bold');
      _text(ctx, refused, 34, 698, '#ffb0b8', 11);
    } else {
      const col = label ? '#ffb020' : '#c06bff';
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(20.5, 664.5, 1060, 42);
      if (label) {
        _text(ctx, `${label} — every price at this port carries a +${Math.round((Commander.priceSurcharge?.() ?? 0) * 100)}% surcharge.`, 34, 682, '#ffb020', 11, 'left', 'bold');
      } else {
        _text(ctx, 'THE CRATER:', 34, 682, '#c06bff', 11, 'left', 'bold');
      }
      _text(ctx, `"${rumour()}"`, 34, 698, '#c8d8f0', 11);
    }
    const dh = Utils.pointInRect(Input.mouse.x, Input.mouse.y, DEPART.x, DEPART.y, DEPART.w, DEPART.h);
    ctx.fillStyle = dh ? 'rgba(255,124,32,0.16)' : 'rgba(5,8,14,0.88)'; ctx.fillRect(DEPART.x, DEPART.y, DEPART.w, DEPART.h);
    ctx.strokeStyle = '#ff7c20'; ctx.lineWidth = 1; ctx.strokeRect(DEPART.x + 0.5, DEPART.y + 0.5, DEPART.w, DEPART.h);
    _text(ctx, 'DEPART ▶', DEPART.x + DEPART.w / 2, DEPART.y + 27, '#ff7c20', 15, 'center');
    _zones.push({ act: 'depart', ...DEPART });
    ctx.textAlign = 'left';
  }

  return {
    STALLS, open, close, isOpen, update, draw, openStalls, stallLine, stallRect, vendor, rumour,
    todayPrices, drawKeeper, drawLedger, mountRows,
    /** For tests: what can be clicked, and where. */
    _zonesFor: (act) => _zones.filter(z => z.act === act),
    _state: () => ({ station: _st, ship: _ship, hot: _hot }),
  };
})();

if (typeof window !== 'undefined') window.PortView = PortView;
