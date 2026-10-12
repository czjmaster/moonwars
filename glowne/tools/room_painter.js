/* MOON WARS — the module painter (update119).
 *
 * Paints the INSIDE of one module: 100x50, the room under its duct, the
 * part the crew stand in. Runs in a page with the game loaded
 * (tools/gen_room_art.js does that) and writes art/room_<type>.png;
 * the game never loads this file, it loads the PNGs.
 *
 * What jj asked for (12.10):
 *   - no coloured strip between the duct and the module;
 *   - a CONSOLE in the middle of every module where somebody works, at
 *     the operator's spot (slot 0 is the centre, raised 14 px), and
 *     everybody works STANDING — no chairs;
 *   - none in the medbay (nobody works there: a healing pod instead) or
 *     in the carbonite bay (three slabs, on the three places a man can
 *     stand in a module, because a man is frozen where he stood);
 *   - the module's kit at the two sides, behind the side places.
 * The light of each module is its colour on the power bar.
 *
 * Deterministic: the same module paints the same picture every time.
 */
(function () {
  'use strict';
  const W = 100, H = 50, FLOOR = 34;          // crew feet at 32.5
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  function hash(s, x, y) {
    let h = s ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const TINT = {
    empty: '#5a6a86', engines: '#1aff8c', weapons: '#ff5566', shields: '#4db8ff', piloting: '#9fdcff',
    oxygen: '#4dd8ff', medbay: '#3aff6a', reactor: '#ffb020', cloaking: '#cc44ff',
    autorepair: '#ffd700', artillery: '#ff7c20', carbonite: '#9fe8ff',
  };
  /* Where the operator's desk starts (his feet are at 18.5) and the
     colour of its top edge; where the three slabs stand in the
     carbonite bay (the three places in a module: centre, ±26). Tests
     read these back out of the pixels. */
  const CONSOLE_TOP = 20, DESK_TOP = [92, 104, 128];
  const SLAB_X = [24, 50, 76];
  /** The sprite each module is written to (an empty bay is room_default). */
  const spriteName = type => type === 'empty' ? 'room_default' : 'room_' + type;
  const WALL = [22, 28, 42], WALL_D = [13, 17, 27], WALL_L = [38, 47, 68];
  const METAL = [70, 80, 98], METAL_L = [128, 140, 162], METAL_D = [34, 40, 52];

  function base(g, type, seed) {
    const T = hex(TINT[type] || TINT.empty);
    // back wall: vertical panels 20px, each its own shade
    for (let x = 0; x < W; x++) for (let y = 0; y < FLOOR; y++) {
      const p = Math.floor(x / 20);
      let c = mix(WALL, hash(seed, p, 0) < 0.5 ? WALL_D : WALL_L, Math.abs(hash(seed, p, 0) - 0.5) * 0.5);
      if (x % 20 === 0) c = WALL_D;
      if (x % 20 === 1) c = mix(c, WALL_L, 0.4);
      const n = hash(seed + 3, x >> 1, y >> 1) - 0.5;
      c = c.map(v => v + Math.round(n * 5));
      g.fillStyle = rgb(c); g.fillRect(x, y, 1, 1);
    }
    // the ceiling edge under the duct: plain steel, no colour (jj)
    g.fillStyle = rgb(WALL_D); g.fillRect(0, 0, W, 2);
    // the floor: deck plates seen from a little above
    for (let y = FLOOR; y < H; y++) {
      const t = (y - FLOOR) / (H - FLOOR);
      g.fillStyle = rgb(mix([46, 54, 72], [20, 25, 36], t)); g.fillRect(0, y, W, 1);
    }
    g.fillStyle = rgb([92, 106, 132]); g.fillRect(0, FLOOR, W, 1);           // the lip the crew stand on
    g.fillStyle = rgb([64, 74, 94]); g.fillRect(0, FLOOR + 1, W, 1);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < W; x += 10) g.fillRect(x, FLOOR + 2, 1, H - FLOOR - 2);
    for (let x = 5; x < W; x += 10) g.fillRect(x, FLOOR + 6, 2, 1);
    // skirting shadow
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, FLOOR - 2, W, 2);
    return T;
  }
  const box = (g, x, y, w, h, c, edge = true) => {
    g.fillStyle = rgb(c); g.fillRect(x, y, w, h);
    if (!edge) return;
    g.fillStyle = rgb(mix(c, [255, 255, 255], 0.25)); g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h);
    g.fillStyle = rgb(mix(c, [0, 0, 0], 0.45)); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
  };
  const glow = (g, x, y, r, c, a = 0.6) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgb(c, a)); gr.addColorStop(1, rgb(c, 0));
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const light = (g, x, y, c) => { g.fillStyle = rgb(c); g.fillRect(x, y, 2, 1); };

  /* THE CONSOLE (jj): every module has one, in the middle, where the
     operator stands (slot 0 is the centre, raised OPERATOR_LIFT = 14 px,
     so his feet are at y 18.5). Everybody works standing: a desk in
     front of him with the screen on it, nothing to sit on. The kit of
     the module stands at the two sides, behind the side slots. */
  function console_(g, T, w = 24, big = false) {
    const x = 50 - w / 2, top = CONSOLE_TOP;
    // the screen, tilted up toward him, lit in the module's colour
    const sh = big ? 9 : 7, sw = w - 4;
    glow(g, 50, top - sh / 2, w * 0.6, T, 0.22);
    g.fillStyle = rgb([10, 14, 20]); g.fillRect(x + 2, top - sh - 1, sw, sh + 1);
    g.fillStyle = rgb(mix([10, 14, 20], T, 0.55)); g.fillRect(x + 3, top - sh, sw - 2, sh - 1);
    for (let k = 0; k < (big ? 3 : 2); k++) {
      g.fillStyle = rgb(mix(T, [255, 255, 255], 0.35));
      g.fillRect(x + 5, top - sh + 2 + k * 3, Math.round((sw - 8) * (0.4 + 0.5 * hash(3, w, k))), 1);
    }
    box(g, x, top, w, FLOOR - top, [44, 52, 68]);                     // the desk
    g.fillStyle = rgb([28, 34, 46]); g.fillRect(x + 3, top + 4, w - 6, FLOOR - top - 6);
    g.fillStyle = rgb(DESK_TOP); g.fillRect(x - 1, top, w + 2, 2);     // its top edge, under his feet
    // a row of keys on the desk
    for (let k = 0; k < Math.floor((w - 6) / 4); k++) light(g, x + 3 + k * 4, top + 2, hash(5, w, k) < 0.6 ? T : [255, 200, 90]);
  }
  const DRAW = {
    empty(g, T) {
      // a bare bay: tie-down rails, crates, no console
      g.fillStyle = rgb(METAL_D); g.fillRect(6, 10, 88, 1); g.fillRect(6, 22, 88, 1);
      box(g, 66, 20, 16, 14, [92, 74, 48]); box(g, 76, 12, 12, 10, [104, 84, 52]);
      g.fillStyle = rgb([60, 46, 30]); g.fillRect(68, 26, 12, 1);
      g.fillStyle = 'rgba(232,176,32,0.8)'; for (let x = 10; x < 40; x += 6) g.fillRect(x, 31, 3, 2);
      return true;     // no console in an empty bay
    },
    engines(g, T) {
      [4, 70].forEach(x0 => {
        box(g, x0, 5, 26, 28, METAL);
        for (let k = 0; k < 3; k++) { g.fillStyle = rgb(METAL_D); g.fillRect(x0 + 5 + k * 7, 6, 2, 26); }
        g.fillStyle = rgb(mix(METAL_D, T, 0.3)); g.fillRect(x0 + 3, 13, 20, 10);
        glow(g, x0 + 13, 18, 11, T, 0.55);
        g.fillStyle = rgb(T); g.fillRect(x0 + 5, 17, 16, 2);
      });
      g.fillStyle = rgb(METAL_L); g.fillRect(30, 6, 40, 1);
      g.fillStyle = rgb(METAL_D); g.fillRect(30, 7, 40, 1);
    },
    reactor(g, T) {
      // the core stands BEHIND the console, coolant tanks at the sides
      glow(g, 50, 12, 24, T, 0.4);
      box(g, 42, 2, 16, 18, METAL_D);
      g.fillStyle = rgb(mix(T, [255, 255, 255], 0.35)); g.fillRect(46, 4, 8, 14);
      g.fillStyle = rgb(T); g.fillRect(45, 4, 1, 14); g.fillRect(54, 4, 1, 14);
      [6, 80].forEach(x0 => {
        box(g, x0, 8, 14, 25, [52, 74, 92]);
        g.fillStyle = rgb([120, 170, 210]); g.fillRect(x0 + 3, 11, 2, 18);
      });
      g.fillStyle = rgb(METAL_L); g.fillRect(20, 10, 22, 2); g.fillRect(58, 10, 22, 2);
      g.fillStyle = 'rgba(232,176,32,0.9)'; for (let x = 4; x < 36; x += 8) g.fillRect(x, 32, 4, 1);
      for (let x = 66; x < 96; x += 8) g.fillRect(x, 32, 4, 1);
    },
    shields(g, T) {
      // emitters at the sides, capacitor banks
      [[16, 15], [84, 15]].forEach(([cx, cy]) => {
        box(g, cx - 8, 26, 16, 8, METAL);
        g.strokeStyle = rgb(METAL_L); g.lineWidth = 2;
        g.beginPath(); g.ellipse(cx, cy, 9, 9, 0, 0, Math.PI * 2); g.stroke();
        glow(g, cx, cy, 12, T, 0.55);
        g.fillStyle = rgb(mix(T, [255, 255, 255], 0.5)); g.fillRect(cx - 1, cy - 1, 3, 3);
      });
      [30, 62].forEach(x0 => {
        box(g, x0, 6, 8, 12, METAL_D);
        for (let y = 8; y < 17; y += 3) light(g, x0 + 3, y, T);
      });
    },
    weapons(g, T) {
      [3, 16].forEach(x0 => {
        box(g, x0, 8, 12, 25, METAL_D);
        for (let y = 11; y < 31; y += 5) { g.fillStyle = rgb([150, 120, 70]); g.fillRect(x0 + 2, y, 8, 3); g.fillStyle = rgb(T); g.fillRect(x0 + 2, y, 2, 3); }
      });
      // the loading rail up to the gun, at the right
      g.fillStyle = rgb(METAL_L); g.fillRect(74, 0, 2, 24); g.fillRect(88, 0, 2, 24);
      box(g, 70, 22, 24, 11, METAL);
      g.fillStyle = rgb([150, 120, 70]); g.fillRect(75, 25, 14, 4);
      g.fillStyle = rgb(T); g.fillRect(75, 25, 3, 4);
    },
    piloting(g, T) {
      // the helm IS the console: wider, a bigger screen; star charts on the walls
      [[4, 8], [74, 8]].forEach(([x0, y0]) => {
        box(g, x0, y0, 22, 14, [14, 22, 32]);
        g.fillStyle = rgb(mix([14, 22, 32], T, 0.4)); g.fillRect(x0 + 2, y0 + 2, 18, 10);
        for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x0 + 3 + Math.floor(hash(8, x0, k) * 16), y0 + 3 + Math.floor(hash(9, x0, k) * 8), 1, 1); }
      });
      return 'big';
    },
    oxygen(g, T) {
      [3, 15].forEach(x0 => {
        box(g, x0, 8, 10, 25, [190, 200, 214]);
        g.fillStyle = rgb(T); g.fillRect(x0, 14, 10, 2);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0 + 7, 9, 2, 23);
      });
      g.fillStyle = rgb(METAL_D); g.beginPath(); g.arc(82, 17, 12, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgb(METAL_L); g.lineWidth = 1; g.beginPath(); g.arc(82, 17, 12, 0, Math.PI * 2); g.stroke();
      g.fillStyle = rgb(mix(METAL, T, 0.3));
      for (let k = 0; k < 4; k++) { g.save(); g.translate(82, 17); g.rotate(k * Math.PI / 2 + 0.3); g.fillRect(1, -2, 10, 4); g.restore(); }
      g.fillStyle = rgb(METAL_L); g.fillRect(80, 15, 4, 4);
    },
    medbay(g, T) {
      // nobody works here: a bed at each side under a scanner arm, and in
      // the middle the healing pod itself — a glass tube of green light
      [2, 70].forEach(x0 => {
        box(g, x0, 24, 28, 6, [200, 210, 220]);
        g.fillStyle = rgb(METAL_D); g.fillRect(x0 + 2, 30, 2, 4); g.fillRect(x0 + 24, 30, 2, 4);
        g.fillStyle = rgb(METAL_L); g.fillRect(x0 + 13, 2, 2, 8); box(g, x0 + 7, 9, 14, 4, METAL);
        g.fillStyle = rgb(T, 0.3); g.fillRect(x0 + 8, 13, 12, 11);
      });
      glow(g, 50, 18, 20, T, 0.35);
      box(g, 38, 2, 24, 4, METAL);                     // the cap
      box(g, 38, 29, 24, 5, METAL);                    // the base
      g.fillStyle = rgb(mix([10, 30, 20], T, 0.45)); g.fillRect(40, 6, 20, 23);   // the fluid
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(42, 7, 2, 21);          // the glass
      for (let y = 9; y < 28; y += 6) { g.fillStyle = rgb(mix(T, [255, 255, 255], 0.4)); g.fillRect(41, y, 18, 1); }
      for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(220,255,230,0.7)'; g.fillRect(46 + Math.floor(hash(13, k, 0) * 10), 10 + Math.floor(hash(14, k, 0) * 16), 1, 1); }
      g.fillStyle = rgb(T); g.fillRect(48, 30, 4, 3); g.fillRect(47, 31, 6, 1);
      return true;     // no console
    },
    cloaking(g, T) {
      glow(g, 50, 14, 30, T, 0.25);
      [[4, 30], [68, 30]].forEach(([x0, w]) => {
        for (let x = x0; x < x0 + w; x += 10) for (let y = 6; y < 31; y += 8) {
          g.fillStyle = rgb(METAL_D); g.fillRect(x, y, 6, 6);
          g.fillStyle = rgb(hash(9, x, y) < 0.6 ? T : mix(T, [0, 0, 0], 0.6)); g.fillRect(x + 2, y + 2, 2, 2);
        }
      });
    },
    autorepair(g, T) {
      [[16, 1], [84, -1]].forEach(([x0, s]) => {
        box(g, x0 - 12, 24, 24, 9, METAL);
        g.fillStyle = rgb(METAL_L); g.fillRect(x0, 0, 3, 6);
        g.save(); g.translate(x0 + 1, 6); g.rotate(s * 0.5); g.fillStyle = rgb(T); g.fillRect(-1, 0, 3, 12); g.restore();
        g.fillStyle = rgb(T); g.fillRect(x0 + s * 6 - 2, 15, 5, 3);
        glow(g, x0 + s * 6, 21, 4, [255, 240, 180], 0.9);
      });
    },
    artillery(g, T) {
      // the breech up behind the console, shells at the sides
      box(g, 36, 2, 28, 16, METAL_D);
      g.fillStyle = rgb(METAL_D); g.beginPath(); g.arc(50, 10, 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgb(T); g.lineWidth = 1; g.beginPath(); g.arc(50, 10, 6, 0, Math.PI * 2); g.stroke();
      [4, 12, 80, 88].forEach(x0 => { box(g, x0, 18, 7, 15, [170, 140, 80]); g.fillStyle = rgb(T); g.fillRect(x0, 18, 7, 3); });
    },
    carbonite(g, T) {
      // nobody works here: three slabs, standing where the three places in
      // a module are (x 24, 50, 76) — a man frozen in the bay is frozen on
      // the spot he stood on, so his slab lands in one of these
      SLAB_X.forEach(cx => {
        const x0 = cx - 11;
        box(g, x0, 2, 22, 32, METAL);
        g.fillStyle = rgb(mix([20, 40, 60], T, 0.35)); g.fillRect(x0 + 3, 5, 16, 25);
        for (let k = 0; k < 12; k++) { g.fillStyle = 'rgba(230,250,255,0.5)'; g.fillRect(x0 + 3 + Math.floor(hash(11, cx, k) * 16), 5 + Math.floor(hash(12, cx, k) * 25), 1, 1); }
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x0 + 4, 6, 1, 23);
        light(g, cx - 1, 31, T);
      });
      glow(g, 50, 18, 26, T, 0.14);
      return true;     // no console
    },
  };

  function paint(g, type, opts = {}) {
    const seed = 1000 + Object.keys(TINT).indexOf(type) * 97;
    const T = base(g, type, seed);
    const r = (DRAW[type] || DRAW.empty)(g, T, !!opts.enemy);
    if (r !== true) console_(g, T, r === 'big' ? 40 : 24, r === 'big');
  }
  window.RoomPainter = { paint, W, H, TYPES: Object.keys(TINT), TINT, spriteName,
                         CONSOLE_TOP, DESK_TOP, SLAB_X, FLOOR };
})();
