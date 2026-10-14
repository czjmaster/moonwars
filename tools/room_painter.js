/* MOON WARS — the module painter (update119, redone in update120).
 *
 * Paints the INSIDE of one module: 100x50, the room under its duct, the
 * part the crew stand in. Runs in a page with the game loaded
 * (tools/gen_room_art.js does that) and writes art/room_<type>_<yard>.png
 * (and a plain art/room_<type>.png for a hull nobody built); the game
 * never loads this file, it loads the PNGs.
 *
 * What jj asked for:
 *   update119  no coloured strip under the duct; a console in the middle
 *              of every module somebody works in; everybody standing;
 *              none in the medbay (a healing pod) or in carbonite (three
 *              slabs on the three places a man stands in a module).
 *   update120  the inside in the colours of the ship (the yard's palette,
 *              the same one the hull is painted in); a THIN floor (the
 *              crew walk lower now); no desk and monitor — a big display
 *              on the wall with a slim console under it; the module's
 *              emblem painted into the room, not stuck on it; four air
 *              lamps in the top-right corner set into the wall (the game
 *              lights them); in the oxygen bay the display is where the
 *              game writes the ship's air, above the heads of the crew.
 *
 * Deterministic: the same module paints the same picture every time.
 */
(function () {
  'use strict';
  const W = 100, H = 50;
  /* The deck: its back edge (where the operator's boots are, the walk
     line minus OPERATOR_LIFT plus FEET = 40) and the front (the side
     places' boots at 45). Tests read these back out of the pixels. */
  const DECK_BACK = 45;                                 // under the duct now (update120): the deck is the room's last 5 px
  const KIT_DROP = 5;                                   // the kit was drawn for a deck at 40
  /* The big display, the air lamps and the emblem plate — the game
     draws onto the first two, so their places are shared with it
     (ROOM_DISPLAY in js/systems.js, OXYGEN_LAMPS in js/oxygen.js). */
  const DISPLAY = { x: 31, y: 4, w: 38, h: 15 };
  const LAMPS = { x: W - 23, y: 3, size: 4, gap: 1, n: 4 };   // clear of the 2 px of wall
  const PLATE = { x: 4, y: 3, w: 14, h: 14 };                 // clear of the 2 px of wall
  /* The slabs' places are the GAME's (Ship.SLAB_ART, update128): a frozen
     man is drawn in the window painted here, so both read one table. */
  const SLAB_X = (typeof Ship !== 'undefined' && Ship.SLAB_ART) ? Ship.SLAB_ART.xs : [24, 50, 76];
  /* Where the operator's hands are (update128): the console's keys. */
  const PANEL_Y = 30;

  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  function hash(s, x, y) {
    let h = s ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  /** The module's light — its colour on the power bar. */
  const TINT = {
    empty: '#5a6a86', engines: '#1aff8c', weapons: '#ff5566', shields: '#4db8ff', piloting: '#9fdcff',
    oxygen: '#4dd8ff', medbay: '#3aff6a', reactor: '#ffb020', cloaking: '#cc44ff',
    autorepair: '#ffd700', artillery: '#ff7c20', carbonite: '#9fe8ff',
  };
  const STEEL = { base: [52, 62, 82], light: [110, 124, 150], dark: [22, 27, 38], seam: [36, 44, 60], outline: [8, 10, 16] };
  const METAL = [70, 80, 98], METAL_L = [128, 140, 162], METAL_D = [34, 40, 52];
  /** The sprite each module is written to. */
  const spriteName = (type, yard) => (type === 'empty' ? 'room_default' : 'room_' + type) + (yard ? '_' + yard : '');

  /** The walls and the deck in the ship's own colours, darkened. */
  function shell(P) {
    return {
      wall:  mix(P.dark, [16, 20, 30], 0.45),
      wallD: mix(P.outline || P.dark, [8, 10, 16], 0.5),
      wallL: mix(P.seam, [44, 52, 70], 0.35),
      trim:  mix(P.base, [70, 80, 100], 0.35),
      trimL: mix(P.light, [150, 160, 180], 0.3),
      deck:  mix(P.seam, [40, 46, 60], 0.45),
      deckD: mix(P.dark, [16, 20, 28], 0.5),
    };
  }

  function base(g, S, seed) {
    // the back wall: tall panels, each its own shade, a rib every 25 px
    for (let x = 0; x < W; x++) for (let y = 0; y < DECK_BACK; y++) {
      const p = Math.floor(x / 25);
      let c = mix(S.wall, hash(seed, p, 0) < 0.5 ? S.wallD : S.wallL, Math.abs(hash(seed, p, 0) - 0.5) * 0.45);
      if (x % 25 === 0) c = S.wallD;
      if (x % 25 === 1) c = mix(c, S.wallL, 0.5);
      if (y === 12 || y === 28) c = mix(c, S.wallD, 0.6);           // horizontal panel joints
      const n = hash(seed + 3, x >> 1, y >> 1) - 0.5;
      c = c.map(v => v + Math.round(n * 5));
      g.fillStyle = rgb(c); g.fillRect(x, y, 1, 1);
    }
    // the ceiling edge under the duct: the ship's trim, no colour of its own
    g.fillStyle = rgb(S.wallD); g.fillRect(0, 0, W, 1);
    g.fillStyle = rgb(mix(S.trim, S.wallD, 0.4)); g.fillRect(0, 1, W, 1);
    // skirting
    g.fillStyle = rgb(S.wallD); g.fillRect(0, DECK_BACK - 2, W, 2);
    // THE DECK: thin — its lit back edge, plates, a dark front lip
    g.fillStyle = rgb(S.trimL); g.fillRect(0, DECK_BACK, W, 1);
    for (let y = DECK_BACK + 1; y < H - 1; y++) {
      const t = (y - DECK_BACK) / (H - DECK_BACK);
      g.fillStyle = rgb(mix(S.deck, S.deckD, t)); g.fillRect(0, y, W, 1);
    }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let x = 12; x < W; x += 25) g.fillRect(x, DECK_BACK + 1, 1, H - DECK_BACK - 2);
    g.fillStyle = rgb(S.wallD); g.fillRect(0, H - 1, W, 1);
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

  /* THE CONSOLE (update120): a big display on the wall with a slim
     panel of keys under it, fixed to the wall — no desk, no monitor on a
     stand. The operator stands in front of it. */
  function console_(g, T, S, d = DISPLAY, drop = 0) {
    glow(g, d.x + d.w / 2, d.y + d.h / 2, d.w * 0.55, T, 0.18);
    box(g, d.x - 2, d.y - 2, d.w + 4, d.h + 4, S.trim);             // the bezel, in the ship's trim
    g.fillStyle = rgb([6, 9, 14]); g.fillRect(d.x, d.y, d.w, d.h);
    g.fillStyle = rgb(mix([6, 9, 14], T, 0.32)); g.fillRect(d.x + 1, d.y + 1, d.w - 2, d.h - 2);
    // what is on it: a few lines of readout and a trace
    for (let k = 0; k < 3; k++) {
      g.fillStyle = rgb(mix(T, [255, 255, 255], 0.3));
      g.fillRect(d.x + 3, d.y + 3 + k * 3, Math.round((d.w * 0.45) * (0.5 + 0.5 * hash(3, d.w, k))), 1);
    }
    g.fillStyle = rgb(T);
    for (let x = 0; x < d.w * 0.4; x++) {
      const yy = d.y + d.h - 4 - Math.round(2 * Math.sin(x * 0.7 + d.w) * hash(4, x, 0));
      g.fillRect(d.x + d.w - 3 - Math.round(d.w * 0.4) + x, yy, 1, 1);
    }
    /* THE KEYS AT HIS HANDS (update128, jj: "w modułach opuść konsole —
       te przyciski są na wysokości hełmu załoganta, a powinny być na
       wysokości dłoni, tak aby wyglądało, że klika w te przyciski").
       The panel hung just under the display, at the man's helmet. It is
       a desk now, its keys at PANEL_Y — where his hands are when he
       stands at the console — on a pedestal down to the deck, with a
       conduit up to the display so the two read as one machine. */
    // `drop`: a kit drawn in the frame lowered by KIT_DROP passes it, so its keys land at the same height
    const px = d.x + 3, pw = d.w - 6, py = PANEL_Y - drop;
    const cx = Math.round(px + pw / 2);
    // conduit: display → desk
    g.fillStyle = rgb(mix(S.trim, [0, 0, 0], 0.5));
    g.fillRect(px + 2, d.y + d.h + 2, 1, py - (d.y + d.h + 2));
    g.fillRect(px + pw - 3, d.y + d.h + 2, 1, py - (d.y + d.h + 2));
    // pedestal to the deck
    box(g, cx - 3, py + 6, 6, DECK_BACK - 2 - drop - (py + 6), mix(S.trim, S.wallD, 0.35));
    // the desk: lit top with the keys, a darker sloped front
    box(g, px, py, pw, 4, S.trim);
    g.fillStyle = rgb(mix(S.trim, [0, 0, 0], 0.35)); g.fillRect(px + 1, py + 4, pw - 2, 2);
    for (let k = 0; k < Math.floor((pw - 4) / 4); k++) light(g, px + 2 + k * 4, py + 1, hash(5, pw, k) < 0.6 ? T : [255, 200, 90]);
  }

  /* The emblem: the module's sign on a plate set into the wall. */
  function plate(g, type, T, S) {
    const p = PLATE;
    box(g, p.x, p.y, p.w, p.h, mix(S.trim, S.wallD, 0.35));
    g.fillStyle = rgb(mix(S.wallD, [0, 0, 0], 0.3)); g.fillRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
    if (type !== 'empty' && typeof Renderer !== 'undefined' && Renderer.drawSystemIcon) {
      Renderer.drawSystemIcon(g, type, p.x + p.w / 2, p.y + p.h / 2, p.w - 4, rgb(mix(T, [255, 255, 255], 0.15)), 0.9);
    }
    g.fillStyle = rgb(S.trimL);
    [[p.x + 1, p.y + 1], [p.x + p.w - 2, p.y + 1], [p.x + 1, p.y + p.h - 2], [p.x + p.w - 2, p.y + p.h - 2]]
      .forEach(([x, y]) => g.fillRect(x, y, 1, 1));
  }

  /* The air lamps' housing: four sockets the game lights. */
  function lamps(g, S) {
    const L = LAMPS, w = L.n * L.size + (L.n - 1) * L.gap;
    box(g, L.x - 2, L.y - 2, w + 4, L.size + 4, mix(S.trim, S.wallD, 0.3));
    for (let i = 0; i < L.n; i++) {
      g.fillStyle = rgb([4, 6, 10]);
      g.fillRect(L.x + i * (L.size + L.gap), L.y, L.size, L.size);
    }
  }

  /* The kit of each module, at the two sides. Everything sits on the
     wall above the deck's back edge (y < 40). Return true for "no
     console here". */
  const DRAW = {
    empty(g, T, S) {
      g.fillStyle = rgb(S.wallD); g.fillRect(24, 18, 52, 1); g.fillRect(24, 30, 52, 1);
      box(g, 64, 26, 16, 14, [92, 74, 48]); box(g, 74, 18, 12, 8, [104, 84, 52]);
      g.fillStyle = rgb([60, 46, 30]); g.fillRect(66, 32, 12, 1);
      g.fillStyle = 'rgba(232,176,32,0.8)'; for (let x = 22; x < 50; x += 6) g.fillRect(x, 37, 3, 2);
      return true;
    },
    engines(g, T, S) {
      [3, 73].forEach(x0 => {
        box(g, x0, 20, 24, 20, METAL);
        for (let k = 0; k < 3; k++) { g.fillStyle = rgb(METAL_D); g.fillRect(x0 + 5 + k * 6, 21, 2, 18); }
        g.fillStyle = rgb(mix(METAL_D, T, 0.3)); g.fillRect(x0 + 3, 25, 18, 8);
        glow(g, x0 + 12, 29, 10, T, 0.5);
        g.fillStyle = rgb(T); g.fillRect(x0 + 5, 28, 14, 2);
      });
      g.fillStyle = rgb(METAL_L); g.fillRect(27, 31, 4, 2); g.fillRect(69, 31, 4, 2);
    },
    reactor(g, T, S) {
      // the core stands in the middle behind the operator, its readouts either side
      glow(g, 50, 20, 24, T, 0.4);
      box(g, 43, 2, 14, 38, METAL_D);
      g.fillStyle = rgb(mix(T, [255, 255, 255], 0.35)); g.fillRect(46, 4, 8, 34);
      g.fillStyle = rgb(T); g.fillRect(45, 4, 1, 34); g.fillRect(54, 4, 1, 34);
      for (let y = 8; y < 38; y += 6) { g.fillStyle = rgb(METAL); g.fillRect(44, y, 12, 1); }
      console_(g, T, S, { x: 26, y: 6 - KIT_DROP, w: 14, h: 12 }, KIT_DROP);
      console_(g, T, S, { x: 60, y: 6 - KIT_DROP, w: 14, h: 12 }, KIT_DROP);
      [4, 84].forEach(x0 => { box(g, x0, 22, 12, 18, [52, 74, 92]); g.fillStyle = rgb([120, 170, 210]); g.fillRect(x0 + 3, 24, 2, 14); });
      return 'own';
    },
    shields(g, T, S) {
      [[14, 28], [86, 28]].forEach(([cx, cy]) => {
        box(g, cx - 7, 35, 14, 5, METAL);
        g.strokeStyle = rgb(METAL_L); g.lineWidth = 2;
        g.beginPath(); g.ellipse(cx, cy, 7, 7, 0, 0, Math.PI * 2); g.stroke();
        glow(g, cx, cy, 10, T, 0.55);
        g.fillStyle = rgb(mix(T, [255, 255, 255], 0.5)); g.fillRect(cx - 1, cy - 1, 3, 3);
      });
    },
    weapons(g, T, S) {
      [3, 15].forEach(x0 => {
        box(g, x0, 20, 11, 20, METAL_D);
        for (let y = 23; y < 38; y += 5) { g.fillStyle = rgb([150, 120, 70]); g.fillRect(x0 + 2, y, 7, 3); g.fillStyle = rgb(T); g.fillRect(x0 + 2, y, 2, 3); }
      });
      // the loader that feeds the gun above, at the right
      g.fillStyle = rgb(METAL_L); g.fillRect(78, 0, 2, 30); g.fillRect(92, 0, 2, 30);
      box(g, 74, 30, 24, 10, METAL);
      g.fillStyle = rgb([150, 120, 70]); g.fillRect(79, 33, 14, 4);
      g.fillStyle = rgb(T); g.fillRect(79, 33, 3, 4);
    },
    piloting(g, T, S) {
      // the helm: the widest display — the chart
      console_(g, T, S, { x: 25, y: 4 - KIT_DROP, w: 50, h: 15 }, KIT_DROP);
      [[4, 22], [84, 22]].forEach(([x0, y0]) => {
        box(g, x0, y0, 12, 10, [14, 22, 32]);
        g.fillStyle = rgb(mix([14, 22, 32], T, 0.4)); g.fillRect(x0 + 2, y0 + 2, 8, 6);
      });
      return 'own';
    },
    oxygen(g, T, S) {
      [3, 14].forEach(x0 => {
        box(g, x0, 20, 9, 20, [190, 200, 214]);
        g.fillStyle = rgb(T); g.fillRect(x0, 25, 9, 2);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0 + 6, 21, 2, 18);
      });
      g.fillStyle = rgb(METAL_D); g.beginPath(); g.arc(86, 30, 9, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgb(METAL_L); g.lineWidth = 1; g.beginPath(); g.arc(86, 30, 9, 0, Math.PI * 2); g.stroke();
      g.fillStyle = rgb(mix(METAL, T, 0.3));
      for (let k = 0; k < 4; k++) { g.save(); g.translate(86, 30); g.rotate(k * Math.PI / 2 + 0.3); g.fillRect(1, -1.5, 7, 3); g.restore(); }
      g.fillStyle = rgb(METAL_L); g.fillRect(85, 29, 2, 2);
    },
    medbay(g, T, S) {
      [2, 72].forEach(x0 => {
        box(g, x0, 31, 26, 5, [200, 210, 220]);
        g.fillStyle = rgb(METAL_D); g.fillRect(x0 + 2, 36, 2, 4); g.fillRect(x0 + 22, 36, 2, 4);
        g.fillStyle = rgb(METAL_L); g.fillRect(x0 + 12, 19, 2, 4); box(g, x0 + 6, 22, 14, 3, METAL);
        g.fillStyle = rgb(T, 0.3); g.fillRect(x0 + 7, 25, 12, 6);
      });
      glow(g, 50, 22, 20, T, 0.35);
      box(g, 39, 2, 22, 4, METAL);
      box(g, 39, 35, 22, 5, METAL);
      g.fillStyle = rgb(mix([10, 30, 20], T, 0.45)); g.fillRect(41, 6, 18, 29);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(43, 7, 2, 27);
      for (let y = 10; y < 34; y += 6) { g.fillStyle = rgb(mix(T, [255, 255, 255], 0.4)); g.fillRect(42, y, 16, 1); }
      for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(220,255,230,0.7)'; g.fillRect(46 + Math.floor(hash(13, k, 0) * 10), 10 + Math.floor(hash(14, k, 0) * 22), 1, 1); }
      g.fillStyle = rgb(T); g.fillRect(48, 36, 4, 3); g.fillRect(47, 37, 6, 1);
      return true;
    },
    cloaking(g, T, S) {
      glow(g, 50, 26, 30, T, 0.22);
      [[3, 24], [74, 24]].forEach(([x0, w]) => {
        for (let x = x0; x < x0 + w; x += 8) for (let y = 21; y < 39; y += 6) {
          g.fillStyle = rgb(METAL_D); g.fillRect(x, y, 5, 5);
          g.fillStyle = rgb(hash(9, x, y) < 0.6 ? T : mix(T, [0, 0, 0], 0.6)); g.fillRect(x + 2, y + 2, 1, 1);
        }
      });
    },
    autorepair(g, T, S) {
      [[14, 1], [86, -1]].forEach(([x0, s]) => {
        box(g, x0 - 11, 33, 22, 7, METAL);
        g.fillStyle = rgb(METAL_L); g.fillRect(x0, 18, 2, 4);
        g.save(); g.translate(x0 + 1, 22); g.rotate(s * 0.5); g.fillStyle = rgb(T); g.fillRect(-1, 0, 3, 9); g.restore();
        g.fillStyle = rgb(T); g.fillRect(x0 + s * 5 - 2, 29, 5, 2);
        glow(g, x0 + s * 5, 32, 3, [255, 240, 180], 0.9);
      });
    },
    artillery(g, T, S) {
      // the breech of the big gun at the right, shells at the left
      box(g, 72, 18, 26, 22, METAL_D);
      g.fillStyle = rgb(METAL_D); g.beginPath(); g.arc(85, 28, 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgb(T); g.lineWidth = 1; g.beginPath(); g.arc(85, 28, 6, 0, Math.PI * 2); g.stroke();
      [4, 12, 20].forEach(x0 => { box(g, x0, 26, 6, 14, [170, 140, 80]); g.fillStyle = rgb(T); g.fillRect(x0, 26, 6, 3); });
    },
    carbonite(g, T, S) {
      SLAB_X.forEach(cx => {
        const x0 = cx - 11;
        box(g, x0, 3, 22, 37, METAL);
        g.fillStyle = rgb(mix([20, 40, 60], T, 0.35)); g.fillRect(x0 + 3, 6, 16, 30);
        for (let k = 0; k < 12; k++) { g.fillStyle = 'rgba(230,250,255,0.5)'; g.fillRect(x0 + 3 + Math.floor(hash(11, cx, k) * 16), 6 + Math.floor(hash(12, cx, k) * 30), 1, 1); }
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x0 + 4, 7, 1, 28);
        light(g, cx - 1, 37, T);
      });
      glow(g, 50, 22, 26, T, 0.12);
      return true;
    },
  };

  /**
   * @param {CanvasRenderingContext2D} g  a 100x50 canvas
   * @param {string} type  a module type, or 'empty'
   * @param {object} opts  { palette } — a yard palette from HullPainter; none = plain steel
   */
  function paint(g, type, opts = {}) {
    const seed = 1000 + Object.keys(TINT).indexOf(type) * 97;
    const T = hex(TINT[type] || TINT.empty);
    const S = shell(opts.palette || STEEL);
    base(g, S, seed);
    g.save(); g.translate(0, KIT_DROP);              // the kit stands on the deck
    const r = (DRAW[type] || DRAW.empty)(g, T, S);
    g.restore();
    if (r !== true && r !== 'own') console_(g, T, S);
    plate(g, type, T, S);
    lamps(g, S);
  }

  window.RoomPainter = { paint, W, H, TYPES: Object.keys(TINT), TINT, spriteName,
                         DECK_BACK, KIT_DROP, DISPLAY, LAMPS, PLATE, SLAB_X, PANEL_Y, shell, STEEL };
})();
