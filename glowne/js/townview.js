/* ============================================================
   MOON WARS — townview.js  (update149)
   The home base as a town, and THE HILL behind it.

   jj, 20.10: "Base powinno wyglądać coś na wzór zamku w Heroes of
   Might and Magic", "cmentarz na skarpie"; after three mock-ups:
   "Ziemia mniejsza i zniszczona, pokryta chmurą — była katastrofa",
   "na cmentarzu stary system nagrobków + latarnia", "małe animacje,
   jak najedziemy na budynek". Then: "no dobra, update".

   Two paintings, each made ONCE at 640×360 and doubled crisp, with a
   glow layer added on top ('lighter'):
     · the TOWN — nine places on a crater plateau in 3/4 view: hangar,
       armoury, barracks, mess, supply yard, workshop, the wanted post,
       the Gate on the far rise, the hill on the cliff to the right.
       Over it, live: the few moving parts (the turret's gun, the reach
       stacker's container, the workshop's trolley), a small animation
       for the place under the pointer, the labels and a tooltip.
     · THE HILL — terraces of the colony's old stones going up the hill
       (dark), our plot on the lower terraces cleared of them and kerbed
       in pale stone, the overlook with the monument at the cliff edge.
       The markers on it are the game's own (basescreen `_drawGrave`);
       this file only says WHERE they stand (`hillSlots`) and draws the
       lantern beside each one.

   A picture and a hit test only — nothing here reads or writes the
   base; basescreen.js passes in the lines it wants shown.
   ============================================================ */

'use strict';

const TownView = (() => {
  const PW = 640, PH = 360;                 // the painting; drawn ×2

  /* THE NINE PLACES — the order is the number on the label and the key
     that opens it. `tab` is the base screen behind the door today. */
  const BUILDINGS = [
    { key: 'hangar',   n: 1, tab: 'HANGAR',   name: 'HANGAR',   col: '#4db8ff', at: [206, 140], body: [142, 150, 142, 100],
      blurb: 'berths, the yard, and the ship you fly' },
    { key: 'armoury',  n: 2, tab: 'ARMOURY',  name: 'ARMOURY',  col: '#ff5566', at: [344, 182], body: [310, 192, 72, 48],
      blurb: 'the rack of guns, and the bays to fit them' },
    { key: 'barracks', n: 3, tab: 'CREW',     name: 'BARRACKS', col: '#9fe4ff', at: [60, 150],  body: [14, 166, 92, 66],
      blurb: 'bunks for the hands you hired' },
    { key: 'mess',     n: 4, tab: 'MESS',     name: 'MESS',     col: '#ffb050', at: [418, 186], body: [384, 198, 72, 40],
      blurb: 'the table where commanders are made, and the pen' },
    { key: 'supply',   n: 5, tab: 'SUPPLY',   name: 'SUPPLY',   col: '#ffd780', at: [62, 254],  body: [10, 262, 124, 50],
      blurb: 'the shelf: He2, warheads, medkits and loot' },
    { key: 'works',    n: 6, tab: 'UPGRADES', name: 'WORKSHOP', col: '#c8d4e8', at: [304, 96],  body: [258, 104, 88, 86],
      blurb: 'what the base itself can be built up to' },
    { key: 'wanted',   n: 7, tab: 'WANTED',   name: 'WANTED',   col: '#ff7c20', at: [452, 232], body: [418, 240, 82, 50],
      blurb: 'the board of men with a price on them' },
    { key: 'gate',     n: 8, tab: 'GATE',     name: 'THE GATE', col: '#c06bff', at: [366, 52],  body: [300, 56, 140, 116],
      blurb: 'what opens the other moons, one day' },
    { key: 'hill',     n: 9, tab: 'MEMORIAL', name: 'THE HILL', col: '#ffb84a', at: [596, 36],  body: [496, 26, 144, 170],
      blurb: 'where we bury the ones we carried home' },
  ];
  /* Where two bodies overlap (the workshop's crane over the hangar roof,
     the Gate's rise behind the workshop) the nearer, smaller one wins. */
  const HIT_ORDER = ['armoury', 'mess', 'wanted', 'works', 'hangar', 'barracks', 'supply', 'hill', 'gate'];
  const byKey = (k) => BUILDINGS.find(b => b.key === k);

  /* ── the painter's kit ─────────────────────────────────── */
  function _canvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  const hex2 = (hex) => { const n = parseInt(hex.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => { const A = hex2(a), B2 = hex2(b);
    return '#' + A.map((v, i) => Math.round(v + (B2[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const shade = (hex, f) => f > 0 ? mix(hex, '#ffffff', f) : mix(hex, '#000000', -f);

  /** A painter over a 640×360 canvas and its 1280×720 glow layer. */
  function _kit() {
    const B = _canvas(PW, PH), GL = _canvas(PW * 2, PH * 2);
    if (!B || !GL) return null;
    const g = B.getContext('2d'), gl = GL.getContext('2d');
    let seed = 9001;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); };
    const P = (x, y, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, 1, 1); };
    const glow = (x, y, r, col, a = 0.5) => {
      const gr = gl.createRadialGradient(x * 2, y * 2, 0, x * 2, y * 2, r * 2);
      const [rr, gg, bb] = hex2(col);
      gr.addColorStop(0, `rgba(${rr},${gg},${bb},${a})`); gr.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      gl.fillStyle = gr; gl.fillRect(x * 2 - r * 2, y * 2 - r * 2, r * 4, r * 4);
    };
    const k = { B, GL, g, gl, rnd, R, P, glow };

    k.sky = (hz) => {
      const s = g.createLinearGradient(0, 0, 0, hz);
      s.addColorStop(0, '#010208'); s.addColorStop(0.7, '#070b1c'); s.addColorStop(1, '#141a36');
      g.fillStyle = s; g.fillRect(0, 0, PW, hz);
      for (let i = 0; i < 900; i++) {           // a faint band of the galaxy
        const t = rnd(), x = t * PW, y = 20 + t * 70 + (rnd() - 0.5) * 46;
        g.fillStyle = `rgba(${150 + rnd() * 60 | 0},${140 + rnd() * 50 | 0},${200 + rnd() * 55 | 0},${rnd() * 0.05})`;
        g.fillRect(x, y, 2 + rnd() * 3, 1 + rnd() * 2);
      }
      for (let i = 0; i < 340; i++) {
        const v = rnd(), x = rnd() * PW, y = rnd() * hz;
        P(x, y, v > 0.97 ? '#ffffff' : v > 0.85 ? '#c8d4f8' : v > 0.6 ? '#6a7ab0' : '#2c3660');
        if (v > 0.985) { P(x - 1, y, '#5a6aa0'); P(x + 1, y, '#5a6aa0'); P(x, y - 1, '#5a6aa0'); P(x, y + 1, '#5a6aa0'); }
      }
    };
    /* EARTH AFTER THE FALL: small, under a shroud of ash, no city lights —
       only a few fires still burning on the night side. */
    k.ruinedEarth = (px, py, pr) => {
      const h = g.createRadialGradient(px, py, pr * 0.9, px, py, pr * 1.3);
      h.addColorStop(0, 'rgba(170,120,80,.28)'); h.addColorStop(1, 'rgba(170,120,80,0)');
      g.fillStyle = h; g.beginPath(); g.arc(px, py, pr * 1.3, 0, 7); g.fill();
      const pg = g.createRadialGradient(px - pr * 0.4, py - pr * 0.35, pr * 0.05, px, py, pr);
      pg.addColorStop(0, '#a89880'); pg.addColorStop(0.4, '#6a5c4c'); pg.addColorStop(0.8, '#3a3028'); pg.addColorStop(1, '#1a1410');
      g.fillStyle = pg; g.beginPath(); g.arc(px, py, pr, 0, 7); g.fill();
      g.save(); g.beginPath(); g.arc(px, py, pr, 0, 7); g.clip();
      for (let i = 0; i < 18; i++) {             // scorched land showing through
        const a = rnd() * 7, d = rnd() * pr * 0.8; g.fillStyle = `rgba(40,30,22,${0.35 + rnd() * 0.3})`;
        g.beginPath(); g.ellipse(px + Math.cos(a) * d, py + Math.sin(a) * d, 2 + rnd() * 6, 1 + rnd() * 3, rnd() * 3, 0, 7); g.fill();
      }
      for (let i = 0; i < 60; i++) {             // the shroud of ash
        const a = rnd() * 7, d = rnd() * pr;
        g.fillStyle = `rgba(${150 + rnd() * 40 | 0},${130 + rnd() * 30 | 0},${110 + rnd() * 25 | 0},${0.18 + rnd() * 0.3})`;
        g.beginPath(); g.ellipse(px + Math.cos(a) * d, py + Math.sin(a) * d, 3 + rnd() * 8, 0.8 + rnd() * 1.6, rnd() * 0.5 - 0.25, 0, 7); g.fill();
      }
      g.strokeStyle = 'rgba(190,170,140,.35)'; g.lineWidth = 0.8;
      for (let j = 0; j < 3; j++) { g.beginPath(); g.arc(px + (rnd() - 0.5) * pr, py + (rnd() - 0.5) * pr, pr * (0.2 + rnd() * 0.2), rnd() * 3, rnd() * 3 + 2.5); g.stroke(); }
      const n = g.createLinearGradient(px - pr * 0.2, py - pr * 0.2, px + pr, py + pr * 0.6);
      n.addColorStop(0, 'rgba(1,1,4,0)'); n.addColorStop(0.55, 'rgba(1,1,4,.78)'); n.addColorStop(1, 'rgba(1,1,4,.96)');
      g.fillStyle = n; g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      for (let i = 0; i < 7; i++) {
        const a = rnd() * 1.4 - 0.2, d = pr * (0.45 + rnd() * 0.45), x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
        P(x, y, '#ff5a1a'); glow(x, y, 3, '#ff4a10', 0.5);
      }
      g.restore();
      for (let i = 0; i < 26; i++) {             // debris catching the sun
        const a = rnd() * 7, d = pr * (1.25 + rnd() * 0.5);
        P(px + Math.cos(a) * d, py + Math.sin(a) * d * 0.35, rnd() > 0.5 ? '#8a7a68' : '#4a4038');
      }
    };
    k.ridge = (y0, amp, freq, col, rim, ph) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, PH);
      const pts = [];
      for (let x = 0; x <= PW; x += 3) {
        const y = y0 - Math.abs(Math.sin(x * freq + ph)) * amp - Math.sin(x * freq * 3.1 + ph * 2) * amp * 0.25;
        pts.push([x, y]); g.lineTo(x, y);
      }
      g.lineTo(PW, PH); g.fill();
      if (rim) pts.forEach(([x, y], i) => { const nx = pts[i + 1]; if (nx && nx[1] < y) R(x, y, 3, 1, rim); });
    };
    k.regolith = (y0, y1, base) => {
      for (let y = y0; y < y1; y++) R(0, y, PW, 1, mix(base, shade(base, -0.35), (y - y0) / (y1 - y0) * 0.8));
      for (let i = 0; i < 5000; i++) P(rnd() * PW, y0 + rnd() * (y1 - y0), rnd() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.1)');
    };
    k.crater = (x, y, r) => {
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x, y, r, r * 0.32, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x + r * 0.15, y + r * 0.04, r * 0.8, r * 0.24, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, r, r * 0.32, 0, Math.PI * 0.05, Math.PI * 0.95); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, y, r, r * 0.32, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    };
    /* 3/4 solids, light from the upper left: a block's front (w×h) at
       (x, y) and its depth d going up and to the right. */
    k.block = (x, y, w, h, d, col, o = {}) => {
      const top = shade(col, 0.22), side = shade(col, -0.32);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(x + w, y + h); g.lineTo(x + w + h * 0.6 + d, y + h);
      g.lineTo(x + w + d + h * 0.6, y + h - d * 0.5); g.lineTo(x + w + d, y + h - d * 0.5); g.fill();
      R(x, y, w, h, col);
      g.fillStyle = top; g.beginPath(); g.moveTo(x, y); g.lineTo(x + d, y - d * 0.5); g.lineTo(x + w + d, y - d * 0.5); g.lineTo(x + w, y); g.fill();
      g.fillStyle = side; g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w + d, y - d * 0.5); g.lineTo(x + w + d, y + h - d * 0.5); g.lineTo(x + w, y + h); g.fill();
      R(x, y, w, 1, shade(col, 0.35)); R(x, y + h - 1, w, 1, shade(col, -0.45));
      if (o.panels) for (let px = x + o.panels; px < x + w; px += o.panels) R(px, y + 1, 1, h - 2, shade(col, -0.15));
    };
    k.windows = (x, y, n, step, lit = 0.7, col = '#ffd890') => {
      for (let i = 0; i < n; i++) {
        const on = rnd() < lit; R(x + i * step, y, 2, 2, on ? col : '#1a2030');
        if (on) glow(x + i * step + 1, y + 1, 4, col, 0.25);
      }
    };
    k.dome = (cx, cy, r, glass, glowCol) => {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(cx + r * 0.5, cy + 1, r * 1.3, r * 0.28, 0, 0, 7); g.fill();
      const d = g.createRadialGradient(cx - r * 0.4, cy - r * 0.7, 1, cx, cy - r * 0.3, r * 1.1);
      d.addColorStop(0, glass ? 'rgba(220,240,255,.55)' : '#9aa6b8'); d.addColorStop(0.6, glass ? 'rgba(120,150,190,.35)' : '#5a6476');
      d.addColorStop(1, glass ? 'rgba(40,60,90,.55)' : '#2a3242');
      g.fillStyle = d; g.beginPath(); g.ellipse(cx, cy, r, r * 0.9, 0, Math.PI, 0); g.fill();
      if (glass) {
        g.strokeStyle = 'rgba(180,200,230,.55)'; g.lineWidth = 0.7;
        for (let j = 1; j < 6; j++) { g.beginPath(); g.ellipse(cx, cy, r * j / 6, r * 0.9, 0, Math.PI, 0); g.stroke(); }
        for (let j = 1; j < 4; j++) { g.beginPath(); g.ellipse(cx, cy, r, r * 0.9 * j / 4, 0, Math.PI, 0); g.stroke(); }
        if (glowCol) glow(cx, cy - r * 0.3, r * 1.6, glowCol, 0.35);
      }
      R(cx - r - 1, cy, r * 2 + 2, 3, '#3a4252'); R(cx - r - 1, cy, r * 2 + 2, 1, '#6a7488');
    };
    k.cylinder = (x, y, w, h, col) => {
      const gr = g.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, shade(col, 0.25)); gr.addColorStop(0.35, col); gr.addColorStop(1, shade(col, -0.45));
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = shade(col, 0.3); g.beginPath(); g.ellipse(x + w / 2, y, w / 2, w * 0.2, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x + w / 2 + w * 0.6, y + h, w * 0.8, w * 0.18, 0, 0, 7); g.fill();
    };
    k.lamp = (x, y, col = '#ffcf7a', r = 10) => { R(x, y, 1, 7, '#3a4252'); R(x - 1, y - 1, 3, 2, col); glow(x, y, r, col, 0.45); };
    k.tube = (x0, y0, x1, y1) => {
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 5; g.beginPath(); g.moveTo(x0 + 3, y0 + 3); g.lineTo(x1 + 3, y1 + 3); g.stroke();
      g.strokeStyle = '#454c5a'; g.lineWidth = 5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = '#7a8496'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0 - 2); g.lineTo(x1, y1 - 2); g.stroke();
      const L = Math.hypot(x1 - x0, y1 - y0);
      for (let t = 6; t < L; t += 7) R(x0 + (x1 - x0) * t / L, y0 + (y1 - y0) * t / L - 2, 1, 5, '#2e3440');
    };
    k.monument = (cx, base) => {
      R(cx - 14, base - 50, 28, 50, '#3a3d47'); R(cx - 14, base - 50, 28, 1, '#6a6d78');
      R(cx - 14, base - 50, 2, 50, '#4a4d57'); R(cx + 12, base - 50, 2, 50, '#26282e');
      R(cx - 17, base - 54, 34, 5, '#4a4d58'); R(cx - 8, base - 66, 16, 12, '#3a3d47'); R(cx - 3, base - 76, 6, 10, '#3a3d47');
      R(cx - 1, base - 80, 2, 4, '#ff4a4a'); glow(cx, base - 79, 6, '#ff3a3a', 0.6);
      R(cx - 10, base - 44, 2, 38, '#ffb84a'); R(cx + 8, base - 44, 2, 38, '#ffb84a');
      glow(cx - 9, base - 25, 14, '#ffb84a', 0.35); glow(cx + 9, base - 25, 14, '#ffb84a', 0.35);
      g.strokeStyle = '#ece4d4'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, base - 30, 6, Math.PI * 0.3, Math.PI * 1.7); g.stroke();
      P(cx + 5, base - 34, '#ece4d4');
      R(cx - 24, base, 48, 4, '#4a4d58'); R(cx - 24, base, 48, 1, '#7a7d88');
    };
    return k;
  }

  /* ── THE TOWN ──────────────────────────────────────────── */
  /* The windows of the barracks, in the order they light up on hover. */
  const BARRACK_WINDOWS = [];
  [[25, 200], [51, 196], [77, 204], [25, 208], [51, 206], [77, 212]].forEach(([x, y]) => {
    for (let i = 0; i < 4; i++) BARRACK_WINDOWS.push([x + i * 4, y]);
  });

  let _town = null;
  function town() {
    if (_town) return _town;
    const k = _kit();
    if (!k) return null;
    const { g, R, P, rnd, glow } = k;
    const lit = [];               // our lit stones on the little hill, for its flare

    k.sky(170);
    k.ruinedEarth(92, 62, 22);
    k.ridge(150, 26, 0.012, '#1e2230', '#3a4258', 1);
    k.ridge(166, 16, 0.021, '#262a36', '#4a5268', 3);
    const haze = g.createLinearGradient(0, 120, 0, 175);
    haze.addColorStop(0, 'rgba(90,110,160,0)'); haze.addColorStop(1, 'rgba(90,110,160,.16)');
    g.fillStyle = haze; g.fillRect(0, 120, PW, 55);

    // THE GATE on the far rise
    g.fillStyle = '#2a2e3a'; g.beginPath(); g.moveTo(290, 172); g.lineTo(330, 128); g.lineTo(400, 126); g.lineTo(446, 172); g.fill();
    g.strokeStyle = '#2c2238'; g.lineWidth = 9; g.beginPath(); g.arc(366, 96, 32, Math.PI * 0.78, Math.PI * 2.22); g.stroke();
    g.strokeStyle = '#5c4680'; g.lineWidth = 3; g.beginPath(); g.arc(366, 96, 32, Math.PI * 0.8, Math.PI * 1.95); g.stroke();
    g.strokeStyle = 'rgba(192,107,255,.5)'; g.lineWidth = 1; g.beginPath(); g.arc(366, 96, 25, 0, 7); g.stroke(); glow(366, 96, 30, '#a06bff', 0.22);
    for (let j = 0; j < 6; j++) { const a = Math.PI * (1.95 + j * 0.05); R(366 + Math.cos(a) * 32 - 1, 96 + Math.sin(a) * 32, 2, 30 - j * 3, '#3a3f4c'); }
    R(334, 126, 64, 3, '#3a3f4c'); for (let x = 336; x < 398; x += 7) R(x, 112, 1, 14, '#2c3140');
    k.lamp(334, 120, '#c06bff', 8); k.lamp(398, 120, '#c06bff', 8);

    // the plateau
    k.regolith(170, PH, '#5a5d68');
    for (let i = 0; i < 26; i++) k.crater(10 + rnd() * 480, 200 + rnd() * 150, 3 + rnd() * 11);

    // the cliff and the hill on the right, with its terraces of stones
    g.fillStyle = '#1e2026'; g.beginPath(); g.moveTo(492, PH); g.lineTo(500, 250); g.lineTo(514, 196); g.lineTo(520, 150); g.lineTo(PW, 120); g.lineTo(PW, PH); g.fill();
    for (let i = 0; i < 90; i++) { const x = 500 + rnd() * 140, y = 160 + rnd() * 200; R(x, y, 1 + rnd() * 9, 1, '#16181d'); R(x, y + 1, 1, 2 + rnd() * 7, '#2c2e36'); }
    {
      const stone = (x, y, on) => {
        const c = on ? '#7a7d88' : '#4a4d57';
        R(x, y, 4, 6, c); R(x + 1, y - 1, 2, 1, c); R(x, y, 1, 6, shade(c, 0.2)); R(x + 3, y, 1, 6, shade(c, -0.35));
        R(x + 1, y + 2, 2, 1, shade(c, -0.3));
        if (on) R(x + 1, y + 6, 2, 1, ['#ff6680', '#ffd780', '#ffffff'][(x * 7 + y) % 3]);
      };
      const x0 = 524, y0 = 168, rows = 4, rowH = 9, depth = 7, slope = 6;
      for (let t = rows - 1; t >= 0; t--) {
        const y = y0 - t * rowH, x = x0 + t * slope, w = PW - x + 10;
        R(x, y, w, rowH * 0.45, '#2e3038'); for (let q = x; q < x + w; q += 6) R(q, y + 1, 5, rowH * 0.45 - 2, (q / 6) % 2 ? '#34363f' : '#30323a');
        R(x, y, w, 1, '#5a5d68');
        R(x, y - depth, w, depth, '#454852'); for (let i = 0; i < w / 3; i++) P(x + rnd() * w, y - rnd() * depth, rnd() > 0.5 ? '#4e515c' : '#3c3f48');
        const sx = x + 30 + (t % 3) * 70; for (let q = 0; q < 4; q++) R(sx + q, y - q * 2, 9, 2, q % 2 ? '#5a5d68' : '#4a4d58');
        for (let q = x + 6; q < x + w - 4; q += 8) {
          const on = rnd() < 0.22;
          stone(q, y - depth + 1, on);
          if (on) { R(q + 5, y - depth + 3, 1, 4, '#3a2a18'); R(q + 5, y - depth + 1, 2, 2, '#ffb84a'); glow(q + 6, y - depth + 2, 7, '#ffaa4a', 0.55); lit.push([q + 6, y - depth + 2]); }
        }
      }
    }
    k.monument(606, 120);

    // walkways first, under the buildings
    k.tube(98, 230, 150, 232); k.tube(268, 236, 304, 240); k.tube(368, 240, 392, 232); k.tube(80, 268, 96, 244); k.tube(436, 240, 440, 262); k.tube(304, 196, 304, 214);

    // BARRACKS — three habitat cylinders on a deck
    R(16, 224, 86, 6, '#3a4252'); R(16, 224, 86, 1, '#6a7488');
    k.cylinder(22, 194, 22, 30, '#6a7486'); k.cylinder(48, 188, 22, 36, '#6a7486'); k.cylinder(74, 198, 22, 26, '#6a7486');
    [[25, 200], [51, 196], [77, 204]].forEach(([x, y]) => k.windows(x, y, 4, 4, 0.75, '#9fe4ff'));
    [[25, 208], [51, 206], [77, 212]].forEach(([x, y]) => k.windows(x, y, 4, 4, 0.6, '#9fe4ff'));
    R(57, 176, 1, 12, '#6a7486'); R(55, 174, 5, 2, '#8a94a6'); k.lamp(57, 170, '#ff4a4a', 6);

    // HANGAR — a long vaulted shed, doors open, a hull's nose in the bay
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(270, 244); g.lineTo(312, 244); g.lineTo(300, 214); g.fill();
    g.fillStyle = '#56607a'; g.beginPath(); g.moveTo(144, 244); g.lineTo(144, 204); g.quadraticCurveTo(206, 154, 268, 204); g.lineTo(268, 244); g.fill();
    g.fillStyle = '#6a7690'; g.beginPath(); g.moveTo(144, 204); g.quadraticCurveTo(206, 154, 268, 204); g.lineTo(282, 196); g.quadraticCurveTo(220, 148, 160, 196); g.closePath(); g.fill();
    g.fillStyle = '#3a4258'; g.beginPath(); g.moveTo(268, 204); g.lineTo(282, 196); g.lineTo(282, 236); g.lineTo(268, 244); g.fill();
    g.strokeStyle = '#4a5468'; g.lineWidth = 1;
    for (let j = 1; j < 8; j++) { const x = 144 + j * 15.5; g.beginPath(); g.moveTo(x, 244); g.lineTo(x, 204 - Math.sin(j / 8 * Math.PI) * 34); g.stroke(); }
    R(164, 208, 84, 36, '#080a12');
    const bay = g.createLinearGradient(0, 208, 0, 244); bay.addColorStop(0, 'rgba(120,170,255,.05)'); bay.addColorStop(1, 'rgba(120,170,255,.22)');
    g.fillStyle = bay; g.fillRect(164, 208, 84, 36);
    R(170, 222, 62, 14, '#a8682f'); R(170, 222, 62, 2, '#d89050'); R(170, 234, 62, 2, '#6a3e1c');
    g.fillStyle = '#a8682f'; g.beginPath(); g.moveTo(232, 222); g.lineTo(246, 229); g.lineTo(232, 236); g.fill();
    for (let j = 0; j < 7; j++) R(176 + j * 7, 226, 3, 2, '#ffcf6a');
    R(160, 204, 92, 5, '#2e3446'); R(160, 204, 92, 1, '#7a849a');
    for (let x = 150; x < 266; x += 10) { R(x, 248, 4, 1, '#ffcf6a'); glow(x + 2, 248, 4, '#ffcf6a', 0.3); }
    glow(206, 230, 40, '#9ac4ff', 0.18);
    k.lamp(150, 200); k.lamp(262, 200);

    // WORKSHOP — a fabricator tower and its gantry crane (the trolley is live)
    k.block(290, 152, 26, 46, 10, '#556072', { panels: 6 });
    for (let y = 160; y < 194; y += 9) { R(292, y, 22, 3, '#2a3240'); R(294, y + 1, 6, 1, '#4dd8ff'); }
    R(301, 116, 3, 36, '#7a8496'); R(262, 114, 80, 3, '#e6b422'); for (let x = 264; x < 340; x += 6) R(x, 115, 3, 1, '#1a1a1a');
    k.lamp(302, 110, '#ff4a4a', 6);
    glow(300, 180, 22, '#4dd8ff', 0.12);

    // ARMOURY — a low armoured bunker with slits; the turret's gun is live
    k.block(312, 214, 58, 24, 12, '#5c5450', { panels: 10 });
    for (let j = 0; j < 4; j++) R(318 + j * 13, 222, 9, 3, '#120c0a');
    R(336, 198, 18, 9, '#6a625e'); R(336, 198, 18, 1, '#8a827e');
    k.lamp(316, 210, '#ff5566', 7);

    // MESS — a glass dome full of warm light, tables outside
    for (let j = 0; j < 7; j++) { R(398 + j * 6, 222, 2, 6, '#2a1a10'); R(397 + j * 6, 219, 4, 3, '#c89060'); }
    R(398, 214, 40, 1, '#ffcf6a');
    k.dome(418, 232, 30, true, '#ffb050');
    k.lamp(386, 226); k.lamp(450, 226);

    // SUPPLY — containers stacked, a reach stacker (its load is live)
    const cont = (x, y, c) => { k.block(x, y, 20, 9, 5, c); for (let q = 3; q < 20; q += 3) R(x + q, y + 2, 1, 6, shade(c, -0.25)); };
    cont(18, 296, '#8a4a3a'); cont(40, 296, '#3a6a8a'); cont(62, 296, '#8a7a3a'); cont(29, 285, '#4a7a4a'); cont(51, 285, '#8a4a3a'); cont(40, 274, '#3a6a8a');
    R(96, 268, 3, 34, '#e6b422'); R(96, 268, 34, 3, '#e6b422'); for (let x = 98; x < 128; x += 5) R(x, 269, 2, 1, '#1a1a1a');
    R(88, 300, 26, 6, '#c8a020'); R(90, 306, 5, 4, '#1a1a1a'); R(106, 306, 5, 4, '#1a1a1a');
    k.lamp(14, 290); k.lamp(132, 292);

    // WANTED — a security post with the board of posters outside
    k.block(422, 266, 40, 22, 10, '#4a4a58', { panels: 8 });
    R(428, 272, 12, 8, '#ff7c20'); glow(434, 276, 10, '#ff7c20', 0.35); R(444, 272, 14, 4, '#0c0c12');
    R(470, 270, 26, 18, '#2a2420'); R(470, 270, 26, 1, '#5a4a3a');
    for (let j = 0; j < 3; j++) { R(472 + j * 8, 272, 6, 8, '#e0d0b0'); R(473 + j * 8, 273, 4, 3, '#8a6a4a'); }
    R(472, 282, 22, 4, '#e0d0b0');
    R(434, 244, 1, 22, '#6a6a78'); R(428, 244, 13, 1, '#6a6a78'); k.lamp(434, 240, '#ff7c20', 7);

    // the apron's lights, and a few people about
    for (let x = 120; x < 480; x += 16) { R(x, 262, 2, 1, '#ffb24a'); glow(x + 1, 262, 5, '#ffb24a', 0.25); }
    [[170, 258], [286, 262], [380, 256], [120, 250]].forEach(([x, y]) => {
      R(x, y, 2, 4, '#c8d0e0'); R(x, y - 2, 2, 2, '#e8eef8'); R(x + 2, y + 3, 3, 1, 'rgba(0,0,0,.4)');
    });

    _town = { img: k.B, glow: k.GL, lit };
    return _town;
  }

  /* ── live parts and the hover animations ───────────────────
     Drawn every frame over the painting, in painting units under a ×2
     scale. `t` is how long the place has been under the pointer,
     `T` the clock. Only the hovered place moves; the three live props
     (gun, container, trolley) are drawn at rest otherwise. */
  function _lglow(ctx, x, y, r, col, a) {
    if (a <= 0 || r <= 0) return;
    const [rr, gg, bb] = hex2(col);
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rr},${gg},${bb},${a})`); gr.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    const was = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = was;
  }
  const _hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

  function _live(ctx, hot, t, T) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const on = (k) => hot === k;
    ctx.save();
    ctx.scale(2, 2);

    // ARMOURY: the turret's gun sweeps, its tip blinks, a searchlight
    {
      const a = on('armoury') ? Math.sin(t * 1.6) * 0.45 : 0;
      ctx.save(); ctx.translate(352, 201.5); ctx.rotate(a);
      R(0, -1.5, 18, 3, '#7a726e'); R(0, -1.5, 18, 1, '#9a928e');
      const blink = on('armoury') ? (Math.sin(T * 9) > 0 ? 1 : 0.25) : 0.8;
      ctx.globalAlpha = blink; R(18, -1.5, 2, 3, '#ff5566'); ctx.globalAlpha = 1;
      if (on('armoury')) {
        ctx.fillStyle = 'rgba(255,220,200,0.07)';
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(90, -16); ctx.lineTo(90, 16); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      _lglow(ctx, 352 + Math.cos(a) * 19, 201.5 + Math.sin(a) * 19, 6, '#ff5566', on('armoury') ? 0.6 * blink : 0.4);
    }
    // SUPPLY: the reach stacker lifts its container
    {
      const lift = on('supply') ? (0.5 - Math.cos(t * 1.8) * 0.5) * 11 : 0;
      R(124, 271, 1, 12 - lift, '#999999');
      R(120, 283 - lift, 9, 5, '#8a4a3a'); R(120, 283 - lift, 9, 1, '#a86a5a');
      for (let q = 2; q < 9; q += 2) R(120 + q, 284 - lift, 1, 3, '#6a3a2a');
    }
    // WORKSHOP: the trolley runs along the gantry; the welder sparks
    {
      const tx = on('works') ? 264 + (0.5 - Math.cos(t * 0.9) * 0.5) * 66 : 264;
      R(tx - 1, 117, 7, 3, '#4a5262');
      R(tx + 4, 120, 1, 15, '#999999'); R(tx, 135, 9, 6, '#4a5262'); R(tx, 135, 9, 1, '#6a7282');
      if (on('works')) {
        const f = Math.floor(T * 24);
        for (let i = 0; i < 6; i++) {
          const sx = 300 + (_hash(f + i * 7) - 0.5) * 10, sy = 186 + (_hash(f * 3 + i) - 0.5) * 8;
          R(sx, sy, 1, 1, _hash(f + i) > 0.5 ? '#fff4c0' : '#ffd040');
        }
        _lglow(ctx, 300, 186, 9 + _hash(f) * 4, '#9fe8ff', 0.55);
      }
    }
    if (hot) {
      // HANGAR: a bar of light sweeps the bay, the apron lights run
      if (on('hangar')) {
        const x = 164 + ((t * 50) % 96) - 8;
        ctx.save(); ctx.beginPath(); ctx.rect(164, 208, 84, 36); ctx.clip();
        ctx.fillStyle = 'rgba(170,210,255,0.18)'; ctx.fillRect(x, 208, 8, 36);
        ctx.fillStyle = 'rgba(170,210,255,0.10)'; ctx.fillRect(x - 6, 208, 20, 36);
        ctx.restore();
        const run = Math.floor(t * 10) % 12;
        for (let i = 0; i < 12; i++) if (i === run || i === (run + 11) % 12) {
          R(150 + i * 10, 248, 4, 1, '#fff2c0'); _lglow(ctx, 152 + i * 10, 248, 6, '#ffcf6a', 0.6);
        }
      }
      // BARRACKS: the windows come on one by one
      if (on('barracks')) {
        const n = Math.min(BARRACK_WINDOWS.length, Math.floor(t * 14));
        for (let i = 0; i < n; i++) {
          const [x, y] = BARRACK_WINDOWS[i];
          R(x, y, 2, 2, '#c8f4ff'); _lglow(ctx, x + 1, y + 1, 4, '#9fe4ff', 0.35);
        }
      }
      // MESS: the dome breathes warm light, steam over the tables
      if (on('mess')) {
        _lglow(ctx, 418, 216, 44, '#ffb050', 0.16 + 0.1 * Math.sin(t * 3));
        for (let i = 0; i < 5; i++) {
          const ph = ((t * 0.7 + i * 0.2) % 1), x = 400 + i * 8 + Math.sin(t * 2 + i) * 1.5, y = 217 - ph * 16;
          ctx.fillStyle = `rgba(230,236,245,${0.35 * (1 - ph)})`;
          ctx.beginPath(); ctx.arc(x, y, 1 + ph * 2.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      // WANTED: the posters lift in the draught, the beacon turns
      if (on('wanted')) {
        for (let j = 0; j < 3; j++) {
          const lift = Math.max(0, Math.sin(t * 5 + j * 1.3)) * 2;
          ctx.fillStyle = '#f0e2c4';
          ctx.beginPath(); ctx.moveTo(472 + j * 8, 280); ctx.lineTo(478 + j * 8, 280); ctx.lineTo(478 + j * 8 + lift * 0.6, 280 - lift); ctx.closePath(); ctx.fill();
        }
        const b = 0.5 + 0.5 * Math.sin(t * 8);
        _lglow(ctx, 434, 240, 10 + b * 6, '#ff7c20', 0.35 + b * 0.4);
        _lglow(ctx, 434, 276, 12, '#ff7c20', 0.2 * b);
      }
      // THE GATE: the ring pulses violet, sparks on the scaffold
      if (on('gate')) {
        const ph = (t * 0.8) % 1;
        ctx.strokeStyle = `rgba(200,140,255,${0.6 * (1 - ph)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(366, 96, 20 + ph * 14, 0, Math.PI * 2); ctx.stroke();
        _lglow(ctx, 366, 96, 34, '#a06bff', 0.2 + 0.15 * Math.sin(t * 4));
        const f = Math.floor(T * 14);
        for (let i = 0; i < 3; i++) {
          const a = Math.PI * (1.95 + _hash(f + i) * 0.25), r = 32 + _hash(f * 5 + i) * 6;
          R(366 + Math.cos(a) * r, 96 + Math.sin(a) * r + _hash(f + i * 3) * 20, 1, 1, '#e8c8ff');
        }
      }
      // THE HILL: the lanterns flare
      if (on('hill') && _town) {
        _town.lit.forEach(([x, y], i) => _lglow(ctx, x, y, 9 + 3 * Math.sin(t * 4 + i), '#ffaa4a', 0.45 + 0.25 * Math.sin(t * 4 + i)));
        _lglow(ctx, 606, 95, 22, '#ffb84a', 0.25 + 0.1 * Math.sin(t * 3));
      }
    }
    ctx.restore();
  }

  /* ── the labels, the hit test, the tooltip ─────────────── */
  const LABEL_FONT = (on) => `${on ? 12 : 10}px Orbitron, monospace`;
  function _labelRect(ctx, b, on) {
    ctx.font = LABEL_FONT(on);
    const tw = (ctx.measureText?.(b.name)?.width ?? b.name.length * 7) + 30;
    const x = b.at[0] * 2, y = b.at[1] * 2;
    return { x: Math.round(x - tw / 2), y: y - 16, w: Math.round(tw), h: on ? 22 : 18 };
  }
  const _in = (mx, my, r) => mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;
  const bodyRect = (b) => ({ x: b.body[0] * 2, y: b.body[1] * 2, w: b.body[2] * 2, h: b.body[3] * 2 });

  /** Which place is at (mx, my) — a label first, then the buildings. */
  function hitAt(ctx, mx, my) {
    // the lit label is drawn larger — it keeps the pointer it already has
    if (_hotKey && _in(mx, my, _labelRect(ctx, byKey(_hotKey), true))) return _hotKey;
    for (const b of BUILDINGS) if (_in(mx, my, _labelRect(ctx, b, false))) return b.key;
    for (const k of HIT_ORDER) if (_in(mx, my, bodyRect(byKey(k)))) return k;
    return null;
  }

  let _hotKey = null, _hotSince = 0;

  /**
   * The town, full screen. `o.info[key] = { status }` is the line under
   * the description in the tooltip. Returns the hot place and the click
   * zones: one per place (its label, and its body), arg = its tab.
   */
  function draw(ctx, o = {}) {
    const T = o.T ?? 0, mx = o.mx ?? -1, my = o.my ?? -1;
    const hot = hitAt(ctx, mx, my);
    if (hot !== _hotKey) { _hotKey = hot; _hotSince = T; }
    const t = T - _hotSince;
    const p = town();
    if (p) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(p.img, 0, 0, PW * 2, PH * 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(p.glow, 0, 0);
      ctx.restore();
    } else {
      ctx.fillStyle = '#0a0e1a'; ctx.fillRect(0, 0, PW * 2, PH * 2);
    }
    _live(ctx, hot, t, T);

    // a soft outline round the hot place, so the click target reads
    const zones = [];
    BUILDINGS.forEach(b => {
      const on = b.key === hot;
      const r = _labelRect(ctx, b, on);
      ctx.fillStyle = on ? 'rgba(5,8,14,.94)' : 'rgba(5,8,14,.7)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = b.col; ctx.fillRect(r.x, r.y, 2, r.h);
      ctx.strokeStyle = b.col + (on ? 'ff' : '66'); ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = b.col + 'aa'; ctx.font = `${on ? 11 : 9}px Share Tech Mono, monospace`;
      ctx.fillText(String(b.n), r.x + 7, r.y + r.h - (on ? 6 : 5));
      ctx.textAlign = 'center';
      ctx.fillStyle = b.col; ctx.font = LABEL_FONT(on);
      ctx.fillText(b.name, r.x + r.w / 2 + 5, r.y + r.h - (on ? 6 : 5));
      zones.push({ ...r, key: b.key, tab: b.tab });
    });
    HIT_ORDER.forEach(k => { const b = byKey(k); zones.push({ ...bodyRect(b), key: k, tab: b.tab }); });

    if (hot) {
      const b = byKey(hot), r = _labelRect(ctx, b, true);
      const status = o.info?.[hot]?.status || '';
      const TW = 340, TH = status ? 46 : 30;
      const tx = Math.max(8, Math.min(PW * 2 - TW - 8, r.x + r.w / 2 - TW / 2));
      // over the label, so the place itself (and what it is doing) stays in sight;
      // under it only where the title band would be in the way
      const ty = r.y - TH - 6 >= 58 ? r.y - TH - 6 : r.y + r.h + 6;
      ctx.fillStyle = 'rgba(5,8,14,.94)'; ctx.fillRect(tx, ty, TW, TH);
      ctx.strokeStyle = b.col; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, ty + 0.5, TW - 1, TH - 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e8f4ff'; ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText(b.blurb, tx + TW / 2, ty + 18);
      if (status) { ctx.fillStyle = b.col; ctx.font = '10px Share Tech Mono, monospace'; ctx.fillText(status, tx + TW / 2, ty + 36); }
    }
    ctx.textAlign = 'left';
    return { hot, zones };
  }

  /* ── THE HILL ──────────────────────────────────────────── */
  /* The terraces, back to front: row 0 is the nearest and lowest. Pure
     geometry — the painting and `hillSlots` read the same numbers. */
  const ROWS = 11;
  const _T = (() => {
    const T = []; let base = 362;
    for (let t = 0; t < ROWS; t++) {
      const s = 1 - t * 0.05, wallH = 14 * s, topD = 22 * s;
      T.push({ t, s, wallH, topD, y: base, x0: -12 + t * 17, x1: 474 - t * 3 });
      base -= wallH + topD * 0.62;
    }
    return T;
  })();
  const _curve = (L, x) => -Math.sin(Math.max(0, Math.min(1, (x - L.x0) / (L.x1 - L.x0))) * Math.PI) * 7 * L.s;
  const _stairX = (i) => 186 + i * 13;

  /* OUR PLOT grows with the dead: two terraces in the middle while there
     are few, four and wider, then most of the hill. */
  const PLOTS = [
    { rows: [2, 3],                   f: [0.29, 0.63] },
    { rows: [2, 3, 1, 4],             f: [0.20, 0.72] },
    { rows: [2, 3, 1, 4, 0, 5, 6, 7], f: [0.08, 0.86] },
  ];
  const SLOT_STEP = 17;                // painting units between two markers

  function _plotSlots(tier) {
    const P = PLOTS[tier], out = [];
    P.rows.forEach(row => {
      const L = _T[row];
      const a = L.x0 + (L.x1 - L.x0) * P.f[0] + 8, b = L.x0 + (L.x1 - L.x0) * P.f[1] - 8;
      const n = Math.floor((b - a) / SLOT_STEP) + 1;
      const off = (b - a - (n - 1) * SLOT_STEP) / 2;
      const sx = _stairX(row);
      for (let i = 0; i < n; i++) {
        const x = a + off + i * SLOT_STEP;
        if (x > sx - 9 && x < sx + 22) continue;          // the stair comes up here
        const y = L.y + _curve(L, x) - L.topD * 0.38;
        out.push({ x: Math.round(x * 2), y: Math.round(y * 2), row });
      }
    });
    return out;
  }
  const hillCapacity = (tier) => _plotSlots(tier).length;
  function hillTier(n) {
    for (let t = 0; t < PLOTS.length; t++) if (_plotSlots(t).length >= n) return t;
    return PLOTS.length - 1;
  }
  /** Where the first `n` of our dead stand, in screen pixels (the foot of
   *  each marker), in burial order. A hill full beyond its last terrace
   *  gives back fewer than `n`. */
  function hillSlots(n) { return _plotSlots(hillTier(n)).slice(0, Math.max(0, n)); }

  const _hill = new Map();
  function hill(tier) {
    if (_hill.has(tier)) return _hill.get(tier);
    const k = _kit();
    if (!k) return null;
    const { g, R, P, rnd, glow } = k;
    const plot = PLOTS[tier];

    k.sky(200);
    k.ruinedEarth(566, 116, 34);
    k.ridge(184, 30, 0.01, '#1c2030', '#38405a', 7);
    k.ridge(204, 18, 0.018, '#24283a', '#444c66', 9);
    const haze = g.createLinearGradient(0, 150, 0, 215);
    haze.addColorStop(0, 'rgba(90,110,160,0)'); haze.addColorStop(1, 'rgba(90,110,160,.2)');
    g.fillStyle = haze; g.fillRect(0, 150, PW, 65);

    const stoneAt = (x, y, s, kind) => {
      const c = mix('#4a4d57', '#2c2e36', (1 - s) * 1.6);
      const w = Math.max(2, Math.round(4 * s)), h = Math.max(3, Math.round(6 * s));
      if (kind === 0) { R(x, y - h, w, h, c); R(x + 1, y - h - 1, w - 2, 1, c); }
      else if (kind === 1) { R(x + w / 2 - 0.5, y - h - 2, 1, h + 2, c); R(x, y - h + 1, w, 1, c); }
      else if (kind === 2) { R(x, y - h - 2, w, h + 2, c); R(x + 1, y - h - 3, w - 2, 1, c); }
      else R(x, y - h + 1, w + 1, h - 1, c);
      R(x, y - h, 1, h, shade(c, 0.18)); R(x + w - 1, y - h, 1, h, shade(c, -0.35));
      R(x - 1, y, w + 2, 1, 'rgba(0,0,0,.35)');
    };
    const ours = (i, x) => {
      if (!plot.rows.includes(i)) return false;
      const L = _T[i], f = (x - L.x0) / (L.x1 - L.x0);
      return f > plot.f[0] && f < plot.f[1];
    };
    for (let i = ROWS - 1; i >= 0; i--) {
      const L = _T[i];
      for (let x = Math.max(0, L.x0 | 0); x < L.x1; x++) {
        const y = L.y + _curve(L, x), top = y - L.topD;
        g.fillStyle = mix('#474a55', '#2a2c33', i / ROWS * 0.7); g.fillRect(x, top, 1, L.topD);
        g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x, top + L.topD * 0.55, 1, L.topD * 0.2);
        g.fillStyle = mix('#33363f', '#1e2026', i / ROWS * 0.7); g.fillRect(x, y, 1, L.wallH);
        const course = Math.max(3, 4 * L.s);
        for (let q = 0; q < L.wallH; q += course) {
          const off = ((q / course) % 2) * 4;
          if ((x + off) % 8 === 0) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + q, 1, course); }
          g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + q, 1, 1);
        }
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, 1, 1);
      }
      // the colony's stones, dark, two ranks a terrace — not on our plot
      for (const rank of [0.35, 0.8]) {
        for (let x = L.x0 + 6 + rank * 4; x < L.x1 - 6; x += 9 * L.s) {
          if (rnd() < 0.08) continue;
          const kind = (rnd() * 4) | 0;
          if (ours(i, x)) continue;
          stoneAt(x, L.y + _curve(L, x) - L.topD * rank, L.s, kind);
        }
      }
      for (let x = L.x0 + 40; x < L.x1 - 20; x += 64) {      // cold path lamps
        const y = L.y + _curve(L, x) - L.topD * 0.55;
        R(x, y - 4 * L.s, 1, 4 * L.s, '#2a2c33'); P(x, y - 4 * L.s - 1, '#6a8ab8'); glow(x, y - 4 * L.s, 5 * L.s, '#5a7ab8', 0.18);
      }
      if (i % 3 === 1 && !plot.rows.includes(i)) {           // a dwarf pine
        const px = L.x0 + 90 + i * 23, y = L.y + _curve(L, px) - L.topD * 0.6, h = 20 * L.s;
        R(px + 2, y - h * 0.45, 2, h * 0.45, '#1a1714');
        g.fillStyle = '#18241c'; g.beginPath(); g.moveTo(px - 5 * L.s, y - h * 0.35); g.lineTo(px + 3, y - h); g.lineTo(px + 7 + 5 * L.s, y - h * 0.35); g.fill();
        g.fillStyle = '#1e2c22'; g.beginPath(); g.moveTo(px - 3 * L.s, y - h * 0.6); g.lineTo(px + 3, y - h * 1.15); g.lineTo(px + 5 + 3 * L.s, y - h * 0.6); g.fill();
      }
      if (i % 4 === 2 && !plot.rows.includes(i)) {           // a bench
        const bx = L.x0 + 300 - i * 9, y = L.y + _curve(L, bx) - L.topD * 0.55;
        R(bx, y - 3, 10 * L.s, 2, '#3a2a1c'); R(bx, y - 1, 1, 2, '#2a1c10'); R(bx + 9 * L.s, y - 1, 1, 2, '#2a1c10');
      }
    }
    // a kerb of pale stone round our plot, so it reads as ours
    plot.rows.forEach(r => {
      const L = _T[r];
      for (let x = L.x0 + (L.x1 - L.x0) * plot.f[0]; x < L.x0 + (L.x1 - L.x0) * plot.f[1]; x++) {
        const y = L.y + _curve(L, x); P(x, y - L.topD + 1, '#6a6d78'); P(x, y - 1, '#6a6d78');
      }
    });
    // one stair up the whole hill
    for (let i = 0; i < ROWS - 1; i++) {
      const L = _T[i], sx = _stairX(i), y = L.y + _curve(L, sx);
      for (let q = 0; q < 5; q++) {
        const yy = y + L.wallH - q * (L.wallH + L.topD * 0.62) / 5;
        R(sx + q * 1.5, yy - 2, 12 * L.s, 2, q % 2 ? '#62656f' : '#50535e');
      }
    }
    // the cliff, and the overlook with the monument at its edge
    g.fillStyle = '#16181d'; g.beginPath(); g.moveTo(448, 150); g.lineTo(524, 148); g.lineTo(566, PH); g.lineTo(446, PH); g.fill();
    for (let i = 0; i < 80; i++) { const x = 452 + rnd() * 100, y = 156 + rnd() * 200; R(x, y, 2 + rnd() * 10, 1, '#0f1014'); R(x, y + 1, 1, 2 + rnd() * 6, '#23252b'); }
    R(420, 142, 108, 9, '#4a4d58'); R(420, 142, 108, 1, '#7a7d88'); R(420, 150, 108, 2, '#26282e');
    for (let x = 422; x < 528; x += 5) R(x, 133, 1, 9, '#6a5a3a');
    R(420, 133, 108, 1, '#8a7a5a');
    [430, 520].forEach(x => {
      R(x, 104, 2, 38, '#3a3d47'); R(x + 2, 106, 10, 22, '#2a2030'); R(x + 3, 108, 8, 18, '#3a2840');
      g.strokeStyle = '#d8c8a8'; g.lineWidth = 1; g.beginPath(); g.arc(x + 7, 116, 3, Math.PI * 0.3, Math.PI * 1.7); g.stroke();
    });
    k.monument(476, 142);

    const p = { img: k.B, glow: k.GL, tier };
    _hill.set(tier, p);
    return p;
  }

  /** The hill for `n` of our dead, full screen. */
  function drawHill(ctx, n) {
    const p = hill(hillTier(n));
    if (!p) { ctx.fillStyle = '#0a0e1a'; ctx.fillRect(0, 0, PW * 2, PH * 2); return; }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(p.img, 0, 0, PW * 2, PH * 2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(p.glow, 0, 0);
    ctx.restore();
  }

  /** The lantern beside a marker whose foot is at (x, y), screen pixels. */
  function lantern(ctx, x, y, T = 0, hot = false) {
    const lx = x + 17, top = y - 18;
    ctx.fillStyle = '#3a2a18'; ctx.fillRect(lx, top, 2, 18);
    ctx.fillStyle = '#2a1c10'; ctx.fillRect(lx - 2, top - 1, 6, 2);
    const flick = 0.85 + 0.15 * Math.sin(T * 7 + x * 0.37);
    ctx.fillStyle = hot ? '#fff0b0' : '#ffc060'; ctx.fillRect(lx - 2, top - 7, 6, 6);
    ctx.fillStyle = '#5a3a18'; ctx.fillRect(lx - 2, top - 8, 6, 1);
    _lglow(ctx, lx + 1, top - 4, (hot ? 34 : 26) * flick, '#ffaa4a', (hot ? 0.9 : 0.7) * flick);
    _lglow(ctx, x, y - 10, 46, '#ff9a3a', 0.12);
  }

  return {
    BUILDINGS, HIT_ORDER, PLOTS,
    town, draw, hitAt, bodyRect,
    labelRect: (ctx, key, on = false) => _labelRect(ctx, byKey(key), on),
    hill, drawHill, hillSlots, hillTier, hillCapacity, lantern,
    /** Where the stair crosses a terrace, in screen pixels: no marker there. */
    stairSpan: (row) => [(_stairX(row) - 9) * 2, (_stairX(row) + 22) * 2],
    BARRACK_WINDOWS,
  };
})();

if (typeof window !== 'undefined') window.TownView = TownView;
