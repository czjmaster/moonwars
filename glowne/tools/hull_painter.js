/* MOON WARS — the hull painter (update116).
 *
 * Paints ONE hull picture onto a canvas the size of its box. Runs in a
 * browser page that has the game loaded (tools/gen_hull_art.js does
 * that), because the geometry comes from the game: `hullArtGeometry`
 * in js/ship.js says where the plate, the nacelles and the bow go, and
 * this file only decides what they look like.
 *
 * The game never loads this file. It loads the PNGs it writes.
 *
 * Deterministic: the same hull paints the same picture every time (the
 * noise is seeded from the layout key), so re-running the generator
 * after an unrelated change produces no diff in art/.
 */
(function () {
  'use strict';

  /* ONE PALETTE PER YARD (update117). The plate is the colour of the
     corporation that built the hull (`builder` in SHIP_LAYOUTS); the
     stripe is that corporation's own colour from CORP_DEFS, the one its
     people wear. Aquarius and Pegasus are both blue, so they are told
     apart by WEIGHT: Aquarius deep navy, Pegasus pale, almost silver.
     Which SIDE flies her is said by the nozzle flame and the running
     light on the bow (green yours, red theirs) — and by which way she
     points. */
  const PALETTES = {
    aquarius: {
      base: [36, 66, 112], light: [92, 140, 204], dark: [16, 30, 58],
      outline: [6, 12, 26], seam: [26, 46, 82],
      rivet: [150, 186, 230], glass: ['#bff2ff', '#3fb8e8', '#0e3a5c'],
    },
    pegasus: {
      base: [104, 136, 160], light: [186, 216, 236], dark: [48, 66, 84],
      outline: [14, 20, 30], seam: [74, 98, 118],
      rivet: [222, 238, 250], glass: ['#e8fbff', '#7fd0f0', '#1c4a66'],
    },
    terra: {
      base: [128, 74, 36], light: [208, 140, 78], dark: [62, 34, 16],
      outline: [24, 12, 6], seam: [92, 52, 26],
      rivet: [236, 180, 120], glass: ['#fff0d0', '#f0a050', '#5c300e'],
    },
    phoenix: {
      base: [112, 40, 36], light: [184, 82, 70], dark: [56, 18, 16],
      outline: [22, 8, 7], seam: [80, 28, 26],
      rivet: [214, 140, 124], glass: ['#ffd9c2', '#e8703f', '#5c1a0e'],
    },
  };
  const FLAME = { you: '#1aff8c', them: '#ff6a30' };
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  /** The palette for a hull: its yard's, with the yard's own colour as the stripe. */
  function paletteFor(builder, enemy) {
    const base = PALETTES[builder] || PALETTES.aquarius;
    const corp = (typeof CORP_DEFS !== 'undefined' && CORP_DEFS[builder]) ? CORP_DEFS[builder].color : '#4db8ff';
    return { ...base, accent: hexRgb(corp), flame: enemy ? FLAME.them : FLAME.you };
  }
  const METAL = { base: [74, 82, 98], light: [138, 147, 166], dark: [36, 40, 50], seam: [52, 58, 70] };
  const INTERIOR = [10, 14, 26];

  /** Small seeded hash → [0,1). */
  function hash(seed, x, y) {
    let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function seedOf(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

  /** A mask canvas: whatever `paint` fills is "in". */
  function maskOf(W, H, paint) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    paint(g);
    const d = g.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    return m;
  }

  /** Chamfer distance to the outside, in pixels (0 outside). */
  function distanceIn(mask, W, H) {
    const D = new Uint16Array(W * H);
    const BIG = 9999;
    for (let i = 0; i < D.length; i++) D[i] = mask[i] ? BIG : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!D[i]) continue;
      let v = D[i];
      if (x > 0) v = Math.min(v, D[i - 1] + 1); else v = 1;
      if (y > 0) v = Math.min(v, D[i - W] + 1); else v = 1;
      D[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; if (!D[i]) continue;
      let v = D[i];
      if (x < W - 1) v = Math.min(v, D[i + 1] + 1); else v = 1;
      if (y < H - 1) v = Math.min(v, D[i + W] + 1); else v = 1;
      D[i] = v;
    }
    return D;
  }

  /** The bow, in a frame where the plate edge is x=0 and the tip is x=w. */
  function prowPath(g, w, top, bot) {
    const H = bot - top, mid = top + H / 2;
    const shoulder = Math.min(16, H * 0.18);
    g.beginPath();
    g.moveTo(-14, top);
    g.lineTo(8, top + 2);
    g.lineTo(w, mid - Math.max(6, H * 0.12));
    g.lineTo(w, mid + Math.max(6, H * 0.12));
    g.lineTo(8, bot - 2);
    g.lineTo(-14, bot);
    g.closePath();
    return { shoulder, mid };
  }

  /** Run `fn(g)` in a frame whose +x points AWAY from the hull. */
  function outward(g, originX, isOut, fn) {
    g.save();
    g.translate(originX, 0);
    if (isOut < 0) g.scale(-1, 1);
    fn(g);
    g.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx  a canvas exactly geom.box big
   * @param {object} geom  from hullArtGeometry (layout coordinates)
   * @param {object} opts  { key, enemy, rooms }
   */
  function paintHull(ctx, geom, opts = {}) {
    const G = window.HULL_GRID, M = G.MARGIN, R = G.TILE + 4;
    const W = geom.box.w, H = geom.box.h, bx = geom.box.x, by = geom.box.y;
    const P = paletteFor(opts.builder, opts.enemy);
    const seed = seedOf(opts.key || 'hull');
    const b = geom.bounds;
    // +1 when the bow is on the right (yours), -1 when it is on the left.
    const dir = geom.isPlayer ? 1 : -1;
    const bowEdge   = geom.isPlayer ? b.x + b.w + M : b.x - M;

    const toLocal = g => g.translate(-bx, -by);

    // ── masks ──────────────────────────────────────────────
    const plateMask = maskOf(W, H, g => {
      toLocal(g); g.beginPath();
      geom.plate.forEach(r => g.roundRect(r.x, r.y, r.w, r.h, R));
      g.fill();
    });
    const prowMask = maskOf(W, H, g => {
      toLocal(g);
      geom.prows.forEach(p => outward(g, bowEdge, dir, gg => {
        prowPath(gg, p.w, p.y - M, p.y + p.h + M); gg.fill();
      }));
    });
    const engMask = maskOf(W, H, g => {
      toLocal(g);
      geom.engines.forEach(e => {
        const stern = geom.isPlayer ? e.x + e.w : e.x;   // where it meets the plate
        outward(g, stern, -dir, gg => {
          gg.beginPath(); gg.roundRect(-4, e.y + 6, e.w, e.h - 12, 6); gg.fill();
          // the pylon into the plate
          gg.fillRect(-14, e.y + 14, 16, e.h - 28);
        });
      });
    });
    /* A swept keel fin under the lowest deck that carries an engine —
       the one bit of silhouette that says "this moves" from across the
       screen. Below the hull, so it never meets a gun mount (those sit
       above it). */
    const finMask = maskOf(W, H, g => {
      toLocal(g);
      const low = geom.engines.reduce((a, e) => (!a || e.y > a.y ? e : a), null);
      if (!low) return;
      const bot = low.y + low.h + G.TILE + M;      // the plate's underside
      // only under the BOTTOM of the ship — a fin under an upper deck
      // would hang in the air or cut into the deck below it
      if (bot !== b.y + b.h + M) return;
      const stern = geom.isPlayer ? low.x + low.w : low.x;
      outward(g, stern, -dir, gg => {
        gg.beginPath();
        gg.moveTo(-48, bot - 4); gg.lineTo(-6, bot - 4);
        gg.lineTo(8, bot + 14); gg.lineTo(-14, bot + 14);
        gg.closePath(); gg.fill();
      });
    });
    const roomMask = maskOf(W, H, g => {
      toLocal(g);
      (opts.rooms || []).forEach(r => g.fillRect(r.x, r.y, r.w, r.h));
    });

    const N = W * H;
    const any = new Uint8Array(N);
    for (let i = 0; i < N; i++) any[i] = plateMask[i] | prowMask[i] | engMask[i] | finMask[i];
    const D = distanceIn(any, W, H);

    const img = ctx.createImageData(W, H);
    const px = img.data;
    const put = (i, c, a = 255) => { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = a; };

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lx = x + bx, ly = y + by;           // layout coordinates
      if (!any[i]) {
        // a one-pixel outline round the whole silhouette
        const n = (x > 0 && any[i - 1]) || (x < W - 1 && any[i + 1])
               || (y > 0 && any[i - W]) || (y < H - 1 && any[i + W]);
        if (n) put(i, P.outline, 230);
        continue;
      }
      if (roomMask[i]) { put(i, INTERIOR); continue; }

      const onPlate = plateMask[i] && !engMask[i] || (plateMask[i] && engMask[i] && D[i] > 3);
      const isEng = engMask[i] && !plateMask[i];
      const pal = isEng ? METAL : P;
      let c = pal.base;

      // panel seams on the TILE grid of the hull itself
      const gx = ((lx - b.x) % (2 * G.TILE) + 2 * G.TILE) % (2 * G.TILE);
      const gy = ((ly - b.y) % G.TILE + G.TILE) % G.TILE;
      if (gx === 0 || gy === 0) c = pal.seam;
      // each panel a slightly different shade — plates, not paint
      const panel = hash(seed, Math.floor((lx - b.x) / (2 * G.TILE)), Math.floor((ly - b.y) / G.TILE));
      c = mix(c, panel < 0.5 ? pal.dark : pal.light, Math.abs(panel - 0.5) * 0.28);
      // grain, in 2x2 blocks so it reads as pixels and not as fuzz
      const n = hash(seed + 7, x >> 1, y >> 1) - 0.5;
      c = c.map(v => Math.max(0, Math.min(255, Math.round(v + n * 10))));

      // light from above, shadow below: the edge pixels
      const up = y > 0 ? any[i - W] : 0, down = y < H - 1 ? any[i + W] : 0;
      const left = x > 0 ? any[i - 1] : 0, right = x < W - 1 ? any[i + 1] : 0;
      if (D[i] <= 2 && (!up || (y > 1 && !any[i - 2 * W]))) c = mix(c, pal.light, 0.6);
      else if (D[i] <= 2 && (!down || (y < H - 2 && !any[i + 2 * W]))) c = mix(c, pal.dark, 0.7);
      else if (D[i] <= 1 && (!left || !right)) c = mix(c, pal.dark, 0.35);

      // the faction stripe, four pixels in, on the plate only
      if (onPlate && D[i] === 4 && !isEng) c = mix(c, P.accent, 0.55);

      // rivets along the band
      if (onPlate && D[i] === 7 && gx % 10 === 5 && gy % 10 === 5) c = P.rivet;
      if (onPlate && D[i] >= 6 && D[i] <= 8 && gx === 10 && gy === 5) c = P.rivet;

      put(i, c);
    }
    ctx.putImageData(img, 0, 0);

    // ── the details that are drawn, not computed ──────────
    ctx.save();
    toLocal(ctx);

    // Nacelles: the bell, its hot throat and a hazard band.
    geom.engines.forEach(e => {
      const stern = geom.isPlayer ? e.x + e.w : e.x;
      const top = e.y + 6, h = e.h - 12;
      outward(ctx, stern, -dir, g => {
        const L = e.w - 4;                   // nozzle end at x = L (the box edge is e.w)
        // hazard band
        g.save();
        g.beginPath(); g.rect(L - 18, top + 1, 6, h - 2); g.clip();
        for (let k = -h; k < h; k += 6) {
          g.fillStyle = (k / 6) % 2 ? '#1a1a1a' : '#e8b020';
          g.beginPath();
          g.moveTo(L - 18, top + k); g.lineTo(L - 12, top + k + 6);
          g.lineTo(L - 12, top + k + 9); g.lineTo(L - 18, top + k + 3); g.fill();
        }
        g.restore();
        // the bell
        g.fillStyle = rgb(METAL.dark);
        g.beginPath();
        g.moveTo(L - 10, top + h * 0.2); g.lineTo(L + 2, top + 1);
        g.lineTo(L + 2, top + h - 1); g.lineTo(L - 10, top + h * 0.8); g.closePath();
        g.fill();
        g.strokeStyle = rgb(METAL.light); g.lineWidth = 1;
        g.beginPath(); g.moveTo(L - 10, top + h * 0.2 + 0.5); g.lineTo(L + 2, top + 1.5); g.stroke();
        // the throat
        const throat = g.createLinearGradient(L - 8, 0, L + 2, 0);
        throat.addColorStop(0, '#000');
        throat.addColorStop(1, P.flame);
        g.fillStyle = throat;
        g.fillRect(L - 1, top + 4, 2, h - 8);
        // intake grille on the body
        g.fillStyle = 'rgba(0,0,0,0.45)';
        for (let k = 0; k < 3; k++) g.fillRect(6 + k * 5, top + 6, 2, h - 12);
      });
    });

    // The bow: a cockpit canopy along its upper slope, running lights.
    geom.prows.forEach(p => {
      const top = p.y - M, bot = p.y + p.h + M, Hh = bot - top, mid = top + Hh / 2;
      outward(ctx, bowEdge, dir, g => {
        const w = p.w;
        const gl = g.createLinearGradient(0, top, w, mid);
        gl.addColorStop(0, P.glass[2]);
        gl.addColorStop(0.5, P.glass[1]);
        gl.addColorStop(1, P.glass[0]);
        g.fillStyle = gl;
        const y1 = mid - Math.max(6, Hh * 0.12);
        g.beginPath();
        g.moveTo(6, top + 7);
        g.lineTo(w - 3, y1 + 3);
        g.lineTo(w - 3, y1 + 10);
        g.lineTo(4, top + 16);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(8, top + 8.5); g.lineTo(w - 6, y1 + 4.5); g.stroke();
        // a running light on the tip
        g.fillStyle = geom.isPlayer ? '#7dffb0' : '#ff4040';
        g.fillRect(w - 3, mid - 1, 2, 2);
      });
    });

    // A station: hazard chevrons on its four outer corners — it is a
    // fortification, and the corners are where it reads as one.
    if (geom.isStation) {
      const corners = [
        [b.x - M, b.y - M, 1, 1], [b.x + b.w + M, b.y - M, -1, 1],
        [b.x - M, b.y + b.h + M, 1, -1], [b.x + b.w + M, b.y + b.h + M, -1, -1],
      ];
      corners.forEach(([cx, cy, sx, sy]) => {
        // only on a corner the plate really has (an L-shaped bunker has
        // a bounding-box corner out in open space)
        const ix = Math.round(cx + sx * 6 - bx), iy = Math.round(cy + sy * 6 - by);
        if (!plateMask[iy * W + ix]) return;
        ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, sy);
        ctx.beginPath(); ctx.rect(4, 2, 24, 5); ctx.clip();
        for (let k = 0; k < 30; k += 6) {
          ctx.fillStyle = (k / 6) % 2 ? '#1a1a1a' : '#e8b020';
          ctx.beginPath(); ctx.moveTo(k, 2); ctx.lineTo(k + 3, 2); ctx.lineTo(k + 6, 7); ctx.lineTo(k + 3, 7); ctx.fill();
        }
        ctx.restore();
      });
    }
    ctx.restore();
  }

  /* ── THE ROOF (update118) ─────────────────────────────────
   *
   * The outer skin that closes the cutaway: jj, "jak w FTL — w bazie i
   * przy skoku widać zamknięty kadłub, przekrój tylko w walce". A third
   * picture per hull, the SAME box as the hull, transparent everywhere
   * except over the compartments and the lift trunks — the part of the
   * hull picture that is painted as open interior. The game draws it on
   * top of the deck with an alpha and fades it out.
   *
   * Same yard palette as the plate, a shade lighter (it is the outermost
   * skin and catches the light), so a closed ship and an open one are
   * obviously the same ship:
   *   - plates in a brick bond, one row per half deck, seams in the
   *     plate's seam colour, each plate its own shade, the same grain;
   *   - a ribbed dorsal band along the duct line of every deck, the
   *     yard's stripe under it on the top deck;
   *   - a row of lit portholes along every deck (none over a lift);
   *   - the lift trunks as recessed ribbed channels;
   *   - one hatch per compartment;
   *   - a dark seam where the roof meets the plate, lit on top.
   */
  function paintRoof(ctx, geom, opts = {}) {
    const G = window.HULL_GRID;
    const W = geom.box.w, H = geom.box.h, bx = geom.box.x, by = geom.box.y;
    const P = paletteFor(opts.builder, opts.enemy);
    const seed = seedOf((opts.key || 'hull') + ':roof');
    const b = geom.bounds;
    const rooms = opts.rooms || [];
    const shafts = (opts.shaftXs || []).map(cx => ({ x: cx - G.SHAFT_W / 2, y: b.y, w: G.SHAFT_W, h: b.h }));

    const toLocal = g => g.translate(-bx, -by);
    const roomMask = maskOf(W, H, g => { toLocal(g); rooms.forEach(r => g.fillRect(r.x, r.y, r.w, r.h)); });
    const shaftMask = maskOf(W, H, g => { toLocal(g); shafts.forEach(s => g.fillRect(s.x, s.y, s.w, s.h)); });
    const N = W * H;
    const any = new Uint8Array(N);
    for (let i = 0; i < N; i++) any[i] = roomMask[i] | shaftMask[i];
    const D = distanceIn(any, W, H);

    const skin  = mix(P.base, P.light, 0.16);
    const skinD = mix(P.base, P.dark, 0.25);
    const img = ctx.createImageData(W, H);
    const px = img.data;
    const put = (i, c, a = 255) => { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = a; };
    const decks = geom.decks || [];
    const deckOf = ly => decks.find(d => ly >= d.y && ly < d.y + d.h);
    const topDeck = decks.length ? decks[0] : null;

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!any[i]) continue;
      const lx = x + bx, ly = y + by;
      const inShaft = !!shaftMask[i] && !roomMask[i];
      let c;
      if (inShaft) {
        // a recessed trunk: darker, ribbed every 8 px, lit rails both sides
        c = skinD;
        const sx = shafts.find(s => lx >= s.x && lx < s.x + s.w);
        const rel = sx ? lx - sx.x : 0;
        if ((ly - b.y) % 8 === 0) c = P.seam;
        if (rel === 2 || rel === G.SHAFT_W - 3) c = mix(c, P.light, 0.45);
        if (rel <= 1 || rel >= G.SHAFT_W - 2) c = P.dark;
      } else {
        const d = deckOf(ly);
        const dy = d ? ly - d.y : 0;
        // brick bond: two plate rows per deck, the lower one offset half a plate
        const rowH = d ? d.h / 2 : G.MODULE_H / 2;
        const row = Math.floor(dy / rowH);
        const PW = 3 * G.TILE;
        const off = row % 2 ? PW / 2 : 0;
        const gx = ((lx - b.x + off) % PW + PW) % PW;
        const gy = dy - row * rowH;
        c = skin;
        const panel = hash(seed, Math.floor((lx - b.x + off) / PW), Math.floor((ly - b.y) / rowH));
        c = mix(c, panel < 0.5 ? P.dark : P.light, Math.abs(panel - 0.5) * 0.30);
        if (gx === 0 || gy === 0) c = P.seam;
        // the dorsal band on the duct line: ribs, a lit edge, a shadow under
        if (d && dy >= 5 && dy <= 12) {
          c = ((lx - b.x) % 4 < 2) ? mix(skinD, P.dark, 0.2) : skinD;
          if (dy === 5) c = mix(P.light, skin, 0.3);
          if (dy === 12) c = P.dark;
        }
        // the yard's stripe under the band, on the top deck only
        if (d && d === topDeck && (dy === 14 || dy === 15)) c = mix(c, P.accent, 0.7);
        // rivets at the plate corners
        if (gx === 3 && gy === 3 && !(dy >= 5 && dy <= 15)) c = P.rivet;
      }
      // grain in 2x2 blocks, as on the plate
      const n = hash(seed + 7, x >> 1, y >> 1) - 0.5;
      c = c.map(v => Math.max(0, Math.min(255, Math.round(v + n * 9))));
      // where the roof meets the plate: a dark seam, lit along the top
      const up = y > 0 ? any[i - W] : 0;
      if (D[i] === 1) c = P.outline;
      else if (D[i] === 2) c = up && (y < 2 || any[i - 2 * W]) ? mix(c, P.dark, 0.35) : mix(c, P.light, 0.55);
      put(i, c);
    }
    ctx.putImageData(img, 0, 0);

    ctx.save();
    toLocal(ctx);
    // Portholes: one row per deck, at the middle of the compartment
    // under the band, never over a lift trunk.
    const lit = P.glass[1], hot = P.glass[0];
    rooms.forEach(r => {
      const y0 = r.y + Math.round(r.h * 0.52);
      for (let x = r.x + 9; x + 5 <= r.x + r.w - 6; x += 14) {
        const n = hash(seed + 13, x, y0);
        ctx.fillStyle = rgb(P.outline);
        ctx.fillRect(x - 1, y0 - 1, 7, 5);
        ctx.fillStyle = n < 0.22 ? rgb(mix(P.dark, P.base, 0.4)) : lit;   // a few are dark
        ctx.fillRect(x, y0, 5, 3);
        if (n >= 0.22) { ctx.fillStyle = hot; ctx.fillRect(x, y0, 2, 1); }
      }
      // a hatch, low down at one end of every compartment
      const hw = 14, hh = 9;
      const hx = hash(seed + 21, r.x, r.y) < 0.5 ? r.x + 6 : r.x + r.w - 6 - hw;
      const hy = r.y + r.h - hh - 5;
      ctx.fillStyle = rgb(P.outline);
      ctx.fillRect(hx - 1, hy - 1, hw + 2, hh + 2);
      ctx.fillStyle = rgb(mix(P.base, P.dark, 0.35));
      ctx.fillRect(hx, hy, hw, hh);
      ctx.fillStyle = rgb(mix(P.base, P.light, 0.35));
      ctx.fillRect(hx, hy, hw, 1);
      ctx.fillStyle = rgb(P.rivet);
      ctx.fillRect(hx + hw / 2 - 2, hy + 4, 4, 1);
    });
    ctx.restore();
  }

  window.HullPainter = { paintHull, paintRoof, PALETTES, paletteFor };
})();
