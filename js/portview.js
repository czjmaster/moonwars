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
  let _view = 'port';                    // 'port' | 'bar' (update146)
  let _barScene = null;                  // { seed, base }

  function open(station, ship) { _st = station; _ship = ship; _hot = -1; _t = 0; _view = 'port'; }
  function close() { _st = null; _ship = null; _view = 'port'; }
  function openBar() { if (_st) _view = 'bar'; }
  function closeBar() { _view = 'port'; }
  /** The clinic and the drydock are rooms too (update147). */
  function openRoom(key) { if (_st && (key === 'clinic' || key === 'drydock' || key === 'bar')) _view = key; }
  function view() { return _st ? _view : null; }
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
  /** What the barkeep has heard: `n` different lines, the promenade's one first. */
  function rumours(n = 3) {
    if (!_st) return [];
    const i0 = ((_st.seed ?? 0) + (_st.sector ?? 1) * 3) % RUMOURS.length;
    return Array.from({ length: Math.min(n, RUMOURS.length) }, (_, k) => RUMOURS[(i0 + k * 3) % RUMOURS.length]);
  }

  /* ── BESIDE A COUNTER (update144) ──────────────────────── */
  const KEEPER_WORDS = {
    qm:     ['Cells, racks, rations.', 'What you take off the counter', 'goes straight into your hold.', 'He buys back at half.'],
    broker: ['Put it on the counter,', 'take the money.', 'He pays what this port pays —', 'no more, no less.'],
    clinic:  ['Lie down.', 'Wounds, the corpse plague,', 'the void-spider virus —', 'and what lives in your ducts.'],
    drydock: ['Plating by the point.', 'Broken modules your crew', 'fix for free, in flight.', 'The plans are under MODULES.'],
    bar:    ['Sit down, have a drink.', 'Hands looking for a berth', 'sit at the tables.', 'Pay the fee, they sign on.'],
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
    if (key === 'clinic') {
      return [['a patient', `${s.constructor.CLINIC_EACH ?? 12} CC`],
              ['the virus, a head', s.type === 'science' ? '45 CC' : 'research posts only'],
              ['the ducts', s.offersFumigation ? `${s.constructor.FUMIGATE_BASE} + ${s.constructor.FUMIGATE_EACH} a head` : 'not done here']];
    }
    if (key === 'drydock') {
      return [['plating, a point', `${s.hullRepairCost(1)} CC`], ['in the yard', `${st.hullRepair ?? 0} HP`],
              ['new modules', `${(st.newModules ?? []).filter(m => !m.sold).length}`]];
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
    if (key === 'bar' && y < R.y + R.h - 40) {
      y += 10;
      _text(ctx, 'WHAT PEOPLE SAY', R.x + 12, y, s.col, 10, 'left', 'bold');
      y += 15;
      rumours(3).forEach(r => {
        let cur = '';
        const out = [];
        `"${r}"`.split(' ').forEach(w => { if (cur && (cur + ' ' + w).length > per) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
        out.push(cur);
        out.forEach(l => { if (y < R.y + R.h - 8) { _text(ctx, l, R.x + 12, y, '#c8d8f0', 10); y += 13; } });
        y += 6;
      });
    }
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

  /* ── THE CRATER (update146) ────────────────────────────────
   * The bar is its own room: hands looking for a berth sit in three
   * booths, each with his card (the barracks card: face, rank, skills),
   * what his corporation does for you, his fee and SIGN ON. The barkeep
   * on the left has what people say; the receipt on the right. PortView
   * still moves no money: SIGN ON is reported, game.js hires.
   */
  const BOOTH = { x: 330, y: 74, w: 620, h: 168, gap: 12 };
  function boothRect(i) { return { x: BOOTH.x, y: BOOTH.y + i * (BOOTH.h + BOOTH.gap), w: BOOTH.w, h: BOOTH.h }; }
  function hireRect(i) { const b = boothRect(i); return { x: b.x + b.w - 196, y: b.y + b.h - 50, w: 180, h: 36 }; }
  const BAR_BACK = { x: 1100, y: 664, w: 160, h: 42 };

  /** Why a hand cannot be signed on right now, or null when he can. */
  function hireBlock(i) {
    const item = _st?.stock?.crew?.[i];
    if (!item) return 'nobody';
    if (item.sold) return 'HIRED';
    if ((_st.crewRoomLeft?.(_ship) ?? 1) <= 0) return 'NO BUNK FREE';
    const fee = _st.crewCost?.() ?? 0, cc = (typeof Save !== 'undefined') ? (Save.getRun?.()?.scrap ?? 0) : 0;
    if (cc < fee) return `NEED ${fee - cc} MORE CC`;
    return null;
  }

  function _updateBar() {
    const mx = Input.mouse.x, my = Input.mouse.y;
    if (Input.isPressed?.('Escape')) return { act: 'back' };
    if (!Input.mouse.leftPressed) return null;
    const n = Math.min(3, _st.stock?.crew?.length ?? 0);
    for (let i = 0; i < n; i++) {
      const r = hireRect(i);
      if (Utils.pointInRect(mx, my, r.x, r.y, r.w, r.h) && !hireBlock(i)) { Audio.sfx?.uiClick?.(); return { act: 'hire', idx: i }; }
    }
    if (Utils.pointInRect(mx, my, BAR_BACK.x, BAR_BACK.y, BAR_BACK.w, BAR_BACK.h)) { Audio.sfx?.uiClick?.(); return { act: 'back' }; }
    return null;
  }

  function _paintBar(seed) {
    const base = _canvas(PW, PH);
    if (!base) return null;
    const g = base.getContext('2d'), rnd = _rng(seed ^ 0x5bd1e995);
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); };
    // the room: dark purple walls, a long bar at the back, bottles, a round window on the moon
    R(0, 0, PW, PH, '#120c1a');
    for (let x = 0; x < PW; x += 24) { R(x, 0, 1, 300, '#0d0913'); R(x + 1, 0, 1, 300, '#1a1226'); }
    R(0, 300, PW, 60, '#1a1420');
    for (let y = 300; y < PH; y += 6) R(0, y, PW, 1, '#140f19');
    R(0, 300, PW, 2, '#2e2238');
    // the round window, under the bunk count where nothing covers it
    const wx = 560, wy = 286, wr = 32;
    g.fillStyle = '#05060f'; g.beginPath(); g.arc(wx, wy, wr, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 40; i++) { const a = rnd() * 7, d = rnd() * wr; R(wx + Math.cos(a) * d, wy + Math.sin(a) * d, 1, 1, rnd() > 0.7 ? '#ffffff' : '#6a78a8'); }
    g.save(); g.beginPath(); g.arc(wx, wy, wr, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#5d606b'; g.beginPath(); g.arc(wx, wy + wr + 26, wr + 12, 0, Math.PI * 2); g.fill();
    g.restore();
    g.strokeStyle = '#3a2c48'; g.lineWidth = 5; g.beginPath(); g.arc(wx, wy, wr, 0, Math.PI * 2); g.stroke();
    // the bar itself, along the bottom under the booths: bottles on a shelf, the counter, its neon
    const bx0 = 166, bx1 = 474;
    R(bx0, 312, bx1 - bx0, 2, '#3a2c20');
    for (let x = bx0 + 4; x < bx1 - 6; x += 7 + (rnd() * 4 | 0)) {
      const c = ['#ffb020', '#4dd8ff', '#ff5566', '#1aff8c', '#c06bff', '#d8d0c0'][rnd() * 6 | 0];
      const h = 6 + (rnd() * 5 | 0);
      R(x, 312 - h, 4, h, c + 'aa'); R(x + 1, 312 - h - 2, 2, 2, c);
    }
    R(bx0 - 6, 318, bx1 - bx0 + 12, 22, '#2a1c30'); R(bx0 - 6, 318, bx1 - bx0 + 12, 3, '#c06bff'); R(bx0 - 6, 321, bx1 - bx0 + 12, 1, '#5a3a6a');
    for (let x = bx0; x < bx1; x += 14) R(x, 326, 8, 10, '#22172a');
    for (let x = bx0 + 6; x < bx1; x += 26) { R(x, 340, 6, 3, '#3a2c48'); R(x + 2, 343, 2, 10, '#3a2c48'); R(x, 352, 6, 2, '#3a2c48'); }   // stools
    return { seed, base };
  }

  function _drawBar(ctx) {
    _zones = [];
    if (!_barScene || _barScene.seed !== (_st.seed ?? 0)) _barScene = _paintBar(_st.seed ?? 0) || { seed: _st.seed ?? 0 };
    ctx.save();
    ctx.fillStyle = '#0a0710'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    if (_barScene.base) ctx.drawImage(_barScene.base, 0, 0, W, H);
    ctx.restore();
    // the bar at the top
    ctx.fillStyle = 'rgba(8,5,12,0.85)'; ctx.fillRect(0, 0, W, 50);
    ctx.fillStyle = '#c06bff'; ctx.fillRect(0, 49, W, 1);
    _text(ctx, 'THE CRATER', 24, 24, '#c06bff', 20, 'left', 'bold');
    _text(ctx, `${String(_st.name ?? '').toUpperCase()} — the bar`, 24, 42, '#9a80b0', 11);
    const run = (typeof Save !== 'undefined') ? Save.getRun?.() : null;
    _text(ctx, `${run?.scrap ?? 0} CC`, 1250, 31, '#ffd700', 18, 'right', 'bold');
    // the barkeep, and the receipt
    drawKeeper(ctx, 'bar', { x: 16, y: 66, w: 298, h: 530 });
    drawLedger(ctx, { x: 966, y: 66, w: 298, h: 330 });
    // bunks aboard
    const alive = (_ship?.crew ?? []).filter(c => !c.dead).length, room = _st.constructor?.CREW_ROOM ?? 8;
    ctx.fillStyle = 'rgba(8,12,20,0.94)'; ctx.fillRect(966, 408, 298, 64);
    ctx.strokeStyle = alive >= room ? '#ff556688' : '#4db8ff66'; ctx.lineWidth = 1; ctx.strokeRect(966.5, 408.5, 297, 63);
    _text(ctx, 'ABOARD', 978, 428, '#4db8ff', 11, 'left', 'bold');
    _text(ctx, `${alive} / ${room}`, 1252, 430, alive >= room ? '#ff5566' : '#e8f4ff', 16, 'right', 'bold');
    _text(ctx, alive >= room ? 'no bunk free — nobody else can sign on' : `${room - alive} bunk${room - alive === 1 ? '' : 's'} free`, 978, 456, alive >= room ? '#ff5566' : '#7a90a8', 10);
    // the booths
    const list = (_st.stock?.crew ?? []).slice(0, 3);
    const fee = _st.crewCost?.() ?? 0;
    for (let i = 0; i < 3; i++) {
      const b = boothRect(i), item = list[i];
      ctx.fillStyle = 'rgba(20,12,28,0.92)'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = item && !item.sold ? '#c06bff66' : '#3a2c48'; ctx.lineWidth = 1; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      // the table edge along the bottom of the booth
      ctx.fillStyle = '#3a2830'; ctx.fillRect(b.x + 10, b.y + b.h - 10, b.w - 20, 6);
      ctx.fillStyle = '#5a4048'; ctx.fillRect(b.x + 10, b.y + b.h - 10, b.w - 20, 1);
      if (!item) {
        _text(ctx, i === 0 && !list.length ? 'Nobody is looking for a berth at this port.' : 'an empty booth', b.x + b.w / 2, b.y + b.h / 2, '#5a4a6a', 12, 'center');
        continue;
      }
      const m = item.member;
      if (typeof Renderer !== 'undefined' && Renderer.drawCrewCard) {
        Renderer.drawCrewCard(ctx, m, b.x + 14, b.y + 14, 'M', { w: 380, h: 66, skills: true, dim: !!item.sold });
      }
      const corp = (typeof CORP_DEFS !== 'undefined' && CORP_DEFS[m.race]) || {};
      const perk = (typeof CORP_PERK_TEXT !== 'undefined' && CORP_PERK_TEXT[m.race]) || 'Steady hand, no special training.';
      const words = `${corp.label || m.race || ''}: ${perk}`;
      let y = b.y + 100, cur = '';
      const per = 62;
      const lines = [];
      words.split(' ').forEach(w => { if (cur && (cur + ' ' + w).length > per) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
      lines.push(cur);
      lines.slice(0, 3).forEach(l => { _text(ctx, l, b.x + 16, y, '#b8a8cc', 10); y += 13; });
      // the fee and SIGN ON
      _text(ctx, item.sold ? '' : `${fee} CC`, b.x + b.w - 20, b.y + 34, '#ffd700', 16, 'right', 'bold');
      if (!item.sold) _text(ctx, 'signing fee', b.x + b.w - 20, b.y + 50, '#7a6a8a', 10, 'right');
      const r = hireRect(i), why = hireBlock(i), can = !why;
      const hot = can && Utils.pointInRect(Input.mouse.x, Input.mouse.y, r.x, r.y, r.w, r.h);
      ctx.fillStyle = hot ? 'rgba(26,255,140,0.18)' : can ? 'rgba(26,255,140,0.08)' : 'rgba(10,10,16,0.8)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = can ? '#1aff8c' : '#3a3a4a'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      _text(ctx, can ? 'SIGN ON' : why, r.x + r.w / 2, r.y + 23, can ? '#1aff8c' : '#6a6a7a', 12, 'center', 'bold');
      if (can) _zones.push({ act: 'hire', arg: i, ...r });
    }
    // back to the promenade
    const bh = Utils.pointInRect(Input.mouse.x, Input.mouse.y, BAR_BACK.x, BAR_BACK.y, BAR_BACK.w, BAR_BACK.h);
    ctx.fillStyle = bh ? 'rgba(192,107,255,0.16)' : 'rgba(8,5,12,0.88)'; ctx.fillRect(BAR_BACK.x, BAR_BACK.y, BAR_BACK.w, BAR_BACK.h);
    ctx.strokeStyle = '#c06bff'; ctx.lineWidth = 1; ctx.strokeRect(BAR_BACK.x + 0.5, BAR_BACK.y + 0.5, BAR_BACK.w, BAR_BACK.h);
    _text(ctx, '◀ BACK', BAR_BACK.x + BAR_BACK.w / 2, BAR_BACK.y + 27, '#c06bff', 15, 'center');
    _zones.push({ act: 'back', ...BAR_BACK });
    ctx.textAlign = 'left';
  }

  /* ── THE CLINIC AND THE DRYDOCK (update147) ─────────────────
   * Rooms like the bar: the keeper on the left, the receipt on the
   * right, ◀ BACK, and in the middle what the room is for. PortView
   * only says what was pressed — { act: 'svc', key, n } — and game.js
   * calls the station's own service, the one the old panel calls.
   */
  const ROOM = { x: 330, w: 620 };
  const SVC = {
    clinic:  { col: '#1aff8c', wall: '#0e1a16', line: '#16302a', title: 'CLINIC' },
    drydock: { col: '#4db8ff', wall: '#0c1420', line: '#16243a', title: 'DRYDOCK' },
  };
  function svcRect(i) { return { x: ROOM.x, y: 404 + i * 76, w: ROOM.w, h: 66 }; }
  function weldRect(i) { return { x: ROOM.x + 16 + i * 140, y: 492, w: 130, h: 40 }; }
  const MODULES_BTN = { x: ROOM.x + ROOM.w - 170, y: 492, w: 154, h: 40 };

  /** The crew the clinic sees, with what is wrong with each. */
  function patientRows() {
    const sh = _ship;
    if (!sh) return [];
    return sh.crew.filter(c => c.isPlayer && !c.dead).map(c => ({
      c, tag: c.virus ? 'VIRUS' : c.state === 'injured' ? 'DOWN' : c.infected ? 'PLAGUE' : c.hp < c.maxHp ? 'HURT' : 'fit',
    }));
  }

  /** The services the clinic offers him today, with why one cannot be had. */
  function clinicServices() {
    const s = _st, sh = _ship;
    if (!s || !sh) return [];
    const cc = (typeof Save !== 'undefined') ? (Save.getRun?.()?.scrap ?? 0) : 0;
    const pts = s.clinicPatients?.(sh) ?? [];
    const carriers = sh.crew.filter(c => !c.dead && c.virus);
    const vermin = (sh.pests ?? []).filter(p => p.alive);
    const out = [];
    const treat = s.clinicCost?.(sh) ?? 0;
    out.push({ key: 'treat', name: 'MEDICAL CLINIC', what: pts.length ? `${pts.length} patient${pts.length > 1 ? 's' : ''} — full heal, the downed back up, the plague cured` : 'every hand is fit',
               cost: treat, block: !pts.length ? 'NOBODY TO TREAT' : cc < treat ? `NEED ${treat - cc} MORE CC` : null, label: `TREAT ALL — ${treat} CC` });
    const q = s.quarantineCost?.(sh) ?? 0;
    out.push({ key: 'quarantine', name: 'QUARANTINE WARD', what: carriers.length ? `${carriers.length} carrying the void-spider virus: ${carriers.map(c => c.name).join(', ')}` : 'nobody carries the virus',
               cost: q, block: !carriers.length ? 'NOBODY CARRIES IT' : s.type !== 'science' ? 'RESEARCH POSTS ONLY' : cc < q ? `NEED ${q - cc} MORE CC` : null, label: `TREAT — ${q} CC` });
    const f = s.fumigationCost?.(sh) ?? 0;
    out.push({ key: 'fumigate', name: 'DUCT FUMIGATION', what: vermin.length ? `${vermin.length} in the ducts — egg cases stay, they are cargo` : 'your ducts are clean',
               cost: f, block: !vermin.length ? 'DUCTS CLEAN' : !s.offersFumigation ? 'NOT DONE HERE' : cc < f ? `NEED ${f - cc} MORE CC` : null, label: `CLEAR — ${f} CC` });
    return out;
  }

  /** The welds on offer: +1, +5, and all of it — what the yard can supply and the purse can pay for. */
  function weldOptions() {
    const s = _st, sh = _ship;
    if (!s || !sh) return [];
    const missing = sh.hullMax - sh.hull, cc = (typeof Save !== 'undefined') ? (Save.getRun?.()?.scrap ?? 0) : 0;
    const most = Math.min(missing, s.stock?.hullRepair ?? 0, Math.floor(cc / Math.max(1, s.hullRepairCost(1))));
    return [1, 5, most].filter((n, i, a) => n > 0 && n <= most && a.indexOf(n) === i)
      .map(n => ({ n, cost: s.hullRepairCost(n), label: n === most && most > 5 ? `ALL ${n} HP` : `+${n} HP` }));
  }

  function _updateRoom() {
    if (Input.isPressed?.('Escape')) return { act: 'back' };
    if (!Input.mouse.leftPressed) return null;
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (const z of _zones) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      Audio.sfx?.uiClick?.();
      if (z.act === 'svc') return { act: 'svc', key: z.arg.key, n: z.arg.n };
      if (z.act === 'modules') return { act: 'modules' };
      if (z.act === 'back') return { act: 'back' };
    }
    return null;
  }

  function _paintRoom(key, seed) {
    const base = _canvas(PW, PH);
    if (!base) return null;
    const g = base.getContext('2d'), S = SVC[key], rnd = _rng(seed ^ (key === 'clinic' ? 0x1234 : 0x9876));
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); };
    R(0, 0, PW, PH, S.wall);
    if (key === 'clinic') {
      for (let y = 0; y < 300; y += 12) for (let x = (y / 12 % 2) * 6; x < PW; x += 12) R(x, y, 11, 11, '#101e19');
      R(0, 300, PW, 60, '#16241f'); for (let y = 300; y < PH; y += 8) R(0, y, PW, 1, '#13201b');
      // a bed and a scanner behind the panels, under the services
      R(170, 316, 120, 10, '#d8f0e6'); R(170, 326, 120, 4, '#5a7a70'); R(176, 330, 4, 18, '#3a4a46'); R(280, 330, 4, 18, '#3a4a46');
      R(300, 300, 30, 52, '#1c2e28'); R(304, 306, 22, 14, '#0a2018'); R(306, 309, 18, 2, '#1aff8c'); R(306, 313, 12, 2, '#1aff8c88');
      R(340, 310, 120, 6, '#d8f0e6'); R(340, 316, 120, 3, '#5a7a70');
    } else {
      // a dock bay: girders, floodlights, the cradle the hull sits in
      for (let x = 0; x < PW; x += 40) { R(x, 0, 4, 300, '#16243a'); for (let y = 0; y < 300; y += 20) { R(x, y, 40, 1, '#122034'); } }
      R(0, 300, PW, 60, '#121c2a'); for (let y = 300; y < PH; y += 6) R(0, y, PW, 1, '#0f1824');
      for (let i = 0; i < 4; i++) { const x = 190 + i * 90; R(x, 28, 10, 6, '#2a3a52'); g.fillStyle = 'rgba(180,220,255,0.05)'; g.beginPath(); g.moveTo(x, 34); g.lineTo(x - 50, 220); g.lineTo(x + 60, 220); g.fill(); }
      R(180, 200, 290, 6, '#2a3a52'); R(180, 200, 290, 1, '#4a5a72');
      R(200, 206, 8, 26, '#2a3a52'); R(442, 206, 8, 26, '#2a3a52');
      for (let i = 0; i < 30; i++) R(170 + rnd() * 300, 236 + rnd() * 60, 1, 1, rnd() > 0.5 ? '#ffd780' : '#4db8ff');
    }
    return { key, seed, base };
  }
  let _roomScene = null;

  function _drawRoom(ctx) {
    _zones = [];
    const key = _view, S = SVC[key];
    if (!_roomScene || _roomScene.key !== key || _roomScene.seed !== (_st.seed ?? 0)) _roomScene = _paintRoom(key, _st.seed ?? 0) || { key, seed: _st.seed ?? 0 };
    ctx.save();
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    if (_roomScene.base) ctx.drawImage(_roomScene.base, 0, 0, W, H);
    ctx.restore();
    ctx.fillStyle = 'rgba(5,8,14,0.85)'; ctx.fillRect(0, 0, W, 50);
    ctx.fillStyle = S.col; ctx.fillRect(0, 49, W, 1);
    _text(ctx, S.title, 24, 24, S.col, 20, 'left', 'bold');
    _text(ctx, `${String(_st.name ?? '').toUpperCase()} — ${key === 'clinic' ? 'the clinic' : 'the yard'}`, 24, 42, '#7a90a8', 11);
    const run = (typeof Save !== 'undefined') ? Save.getRun?.() : null;
    _text(ctx, `${run?.scrap ?? 0} CC`, 1250, 31, '#ffd700', 18, 'right', 'bold');
    drawKeeper(ctx, key, { x: 16, y: 66, w: 298, h: 530 });
    drawLedger(ctx, { x: 966, y: 66, w: 298, h: 330 });
    if (key === 'clinic') _drawClinic(ctx); else _drawDrydock(ctx);
    const bh = Utils.pointInRect(Input.mouse.x, Input.mouse.y, BAR_BACK.x, BAR_BACK.y, BAR_BACK.w, BAR_BACK.h);
    ctx.fillStyle = bh ? S.col + '28' : 'rgba(5,8,14,0.88)'; ctx.fillRect(BAR_BACK.x, BAR_BACK.y, BAR_BACK.w, BAR_BACK.h);
    ctx.strokeStyle = S.col; ctx.lineWidth = 1; ctx.strokeRect(BAR_BACK.x + 0.5, BAR_BACK.y + 0.5, BAR_BACK.w, BAR_BACK.h);
    _text(ctx, '◀ BACK', BAR_BACK.x + BAR_BACK.w / 2, BAR_BACK.y + 27, S.col, 15, 'center');
    _zones.push({ act: 'back', ...BAR_BACK });
    ctx.textAlign = 'left';
  }

  function _button(ctx, r, label, can, col, zone) {
    const hot = can && Utils.pointInRect(Input.mouse.x, Input.mouse.y, r.x, r.y, r.w, r.h);
    ctx.fillStyle = hot ? col + '30' : can ? col + '14' : 'rgba(10,10,16,0.8)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = can ? col : '#3a3a4a'; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    _text(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 4, can ? col : '#6a6a7a', 11, 'center', 'bold');
    if (can && zone) _zones.push({ ...zone, ...r });
  }

  function _drawClinic(ctx) {
    // the patients: every hand aboard, his card and what is wrong with him
    const rows = patientRows();
    const TAG = { VIRUS: '#ff2d44', DOWN: '#ff2d44', PLAGUE: '#3aff6a', HURT: '#ffd700', fit: '#5a7a70' };
    ctx.fillStyle = 'rgba(8,16,14,0.9)'; ctx.fillRect(ROOM.x, 66, ROOM.w, 326);
    ctx.strokeStyle = '#1aff8c44'; ctx.lineWidth = 1; ctx.strokeRect(ROOM.x + 0.5, 66.5, ROOM.w - 1, 325);
    _text(ctx, 'ON THE WARD', ROOM.x + 14, 86, '#1aff8c', 12, 'left', 'bold');
    if (!rows.length) _text(ctx, 'nobody aboard', ROOM.x + ROOM.w / 2, 220, '#5a7a70', 12, 'center');
    rows.slice(0, 8).forEach((r, i) => {
      const x = ROOM.x + 12 + (i % 2) * 302, y = 98 + Math.floor(i / 2) * 72;
      if (typeof Renderer !== 'undefined' && Renderer.drawCrewCard) Renderer.drawCrewCard(ctx, r.c, x, y, 'M', { w: 294, h: 64, dim: r.tag === 'fit' });
      ctx.fillStyle = 'rgba(5,8,14,0.9)'; ctx.fillRect(x + 294 - 56, y + 4, 52, 14);
      _text(ctx, r.tag, x + 294 - 30, y + 15, TAG[r.tag], 10, 'center', 'bold');
    });
    // the services
    clinicServices().forEach((v, i) => {
      const r = svcRect(i);
      ctx.fillStyle = 'rgba(8,16,14,0.92)'; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = v.block ? '#2a3a36' : '#1aff8c66'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      _text(ctx, v.name, r.x + 14, r.y + 22, v.block ? '#7a9a90' : '#e8f4ff', 12, 'left', 'bold');
      const what = v.what.length > 64 ? v.what.slice(0, 63) + '…' : v.what;
      _text(ctx, what, r.x + 14, r.y + 42, '#9fb4b0', 10);
      _button(ctx, { x: r.x + r.w - 196, y: r.y + 14, w: 180, h: 38 }, v.block || v.label, !v.block, '#1aff8c', { act: 'svc', arg: { key: v.key } });
    });
  }

  function _drawDrydock(ctx) {
    const sh = _ship, s = _st;
    // the hull, in its cradle
    ctx.fillStyle = 'rgba(8,12,22,0.55)'; ctx.fillRect(ROOM.x, 66, ROOM.w, 338);
    ctx.strokeStyle = '#4db8ff44'; ctx.lineWidth = 1; ctx.strokeRect(ROOM.x + 0.5, 66.5, ROOM.w - 1, 337);
    _text(ctx, 'IN THE CRADLE', ROOM.x + 14, 86, '#4db8ff', 12, 'left', 'bold');
    const art = sh?.hullArt?.(), roof = sh?.roofArt?.(), geom = sh?.hullArtGeometry?.();
    const box = art?.geom?.box ?? geom?.box;
    if (box) {
      const k = Math.min(1, 580 / box.w, 250 / box.h), w = box.w * k, h = box.h * k;
      const x = ROOM.x + (ROOM.w - w) / 2, y = 96 + (260 - h) / 2;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      if (art) { ctx.drawImage(art.img, x, y, w, h); if (roof) ctx.drawImage(roof.img, x, y, w, h); }
      else {
        ctx.translate(x - box.x * k, y - box.y * k); ctx.scale(k, k);
        ctx.fillStyle = '#2a4a70';
        (geom?.plate ?? []).concat(geom?.engines ?? [], geom?.prows ?? []).forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h));
      }
      ctx.restore();
      // the damage, as scorch over the plate — more of it the more is missing
      const hurt = sh.hullMax ? 1 - sh.hull / sh.hullMax : 0;
      const rnd = _rng((s.seed ?? 0) ^ 77);
      for (let i = 0; i < Math.round(hurt * 24); i++) {
        ctx.fillStyle = `rgba(20,10,6,${0.45 + rnd() * 0.3})`;
        ctx.beginPath(); ctx.ellipse(x + rnd() * w, y + h * 0.2 + rnd() * h * 0.6, 6 + rnd() * 8, 3 + rnd() * 4, 0, 0, Math.PI * 2); ctx.fill();
        if (Math.sin(_t * 6 + i) > 0.7) { ctx.fillStyle = '#ffb24a'; ctx.fillRect(x + rnd() * w, y + h * 0.3 + rnd() * h * 0.4, 2, 2); }
      }
    }
    // the hull bar
    const hp = sh?.hull ?? 0, max = sh?.hullMax ?? 1, missing = max - hp;
    const col = hp < max * 0.34 ? '#ff2d44' : hp < max * 0.67 ? '#ffd700' : '#1aff8c';
    ctx.fillStyle = 'rgba(8,12,22,0.92)'; ctx.fillRect(ROOM.x, 412, ROOM.w, 136);
    ctx.strokeStyle = '#4db8ff66'; ctx.strokeRect(ROOM.x + 0.5, 412.5, ROOM.w - 1, 135);
    _text(ctx, 'HULL', ROOM.x + 16, 436, '#7a90a8', 11, 'left', 'bold');
    _text(ctx, `${hp} / ${max}`, ROOM.x + ROOM.w - 16, 436, col, 13, 'right', 'bold');
    ctx.fillStyle = '#0a1018'; ctx.fillRect(ROOM.x + 16, 444, ROOM.w - 32, 10);
    ctx.fillStyle = col; ctx.fillRect(ROOM.x + 16, 444, (ROOM.w - 32) * hp / Math.max(1, max), 10);
    _text(ctx, missing ? `${missing} HP to weld · the yard has ${s.stock?.hullRepair ?? 0} HP of plate · ${s.hullRepairCost(1)} CC a point`
                       : 'the hull is sound — nothing to weld', ROOM.x + 16, 476, missing ? '#c8d8f0' : '#1aff8c', 10);
    const opts = weldOptions();
    opts.forEach((o, i) => _button(ctx, weldRect(i), `${o.label} — ${o.cost} CC`, true, '#1aff8c', { act: 'svc', arg: { key: 'weld', n: o.n } }));
    if (missing && !opts.length) {
      _text(ctx, (s.stock?.hullRepair ?? 0) <= 0 ? 'This yard has no plate left.' : `You cannot pay for a single point (${s.hullRepairCost(1)} CC).`, ROOM.x + 16, 516, '#ff5566', 11);
    }
    _button(ctx, MODULES_BTN, 'MODULES ▶', true, '#4db8ff', { act: 'modules' });
    const broken = (sh?.systems ?? []).filter(y => y.damagedLevels > 0);
    if (broken.length) _text(ctx, `damaged: ${broken.map(y => y.label).join(', ')} — your crew fix these for free, in flight`, ROOM.x + 16, 540, '#ffd700', 10);
  }

  /* ── Update ─────────────────────────────────────────────── */
  function update(dt) {
    if (!_st) return null;
    _t += dt;
    if (_view === 'bar') return _updateBar();
    if (_view === 'clinic' || _view === 'drydock') return _updateRoom();
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
    if (_view === 'bar') { _drawBar(ctx); return; }
    if (_view === 'clinic' || _view === 'drydock') { _drawRoom(ctx); return; }
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
    openBar, closeBar, view, rumours, boothRect, hireRect, hireBlock,
    openRoom, patientRows, clinicServices, weldOptions,
    /** For tests: what can be clicked, and where. */
    _zonesFor: (act) => _zones.filter(z => z.act === act),
    _state: () => ({ station: _st, ship: _ship, hot: _hot }),
  };
})();

if (typeof window !== 'undefined') window.PortView = PortView;
