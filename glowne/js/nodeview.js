/* ============================================================
   MOON WARS — nodeview.js  (update139)
   The card a map node shows under the pointer.

   Plan of 13.10, point 3: "mini animacje / obrazki w panelu info
   węzła (dziś pusty placeholder)". It was a 120 x 48 box with the
   node's name and "Click to travel". Now it is a card:

     · a small living picture of what is out there — a hull drifting
       with its guns warm, a station turning, a beacon pinging, the
       nebula's clouds, rocks tumbling, a quiet star field, the gate,
       the contract's target;
     · what the jump will bring, in the game's own odds — never the
       event's title, which is the surprise;
     · a man on the wanted board gets his poster: face, name, price;
     · the foot: what the jump costs and whether it can be made.

   Every picture is a pure function of (node, t): the same node looks
   the same every time it is hovered, and a test can draw it at any t.
   ============================================================ */

'use strict';

const NodeView = (() => {
  const CARD = { w: 276, h: 184, pic: { x: 10, y: 30, w: 256, h: 88 } };

  const COL = {
    panel: 'rgba(10,14,26,0.96)', line: '#1e2d4a', text: '#c8d8f0', dim: '#7a90a8',
    faint: '#4a6080', good: '#1aff8c', warn: '#ffb020', bad: '#ff5566',
  };

  /* What the jump brings, per type — read off the arrival code in
     game.js (`_travelTo`), so the card cannot promise what the node
     does not do. `{fight}` is the asteroid odds, filled in at draw. */
  const BLURB = {
    combat:    ['A hostile ship holds this point.', 'Some hail first and ask a toll.'],
    elite:     ['A hostile ship holds this point.', 'Some hail first and ask a toll.'],
    store:     ['Station: stock, repairs, new hands.', 'Your commander rests: knowledge full.'],
    event:     ['Something on the sensors.', 'You find out when you get there.'],
    nebula:    ['Sensors are blind in the cloud.', 'An ambush: −2 power for BOTH ships.'],
    asteroids: ['An asteroid field. A fight here is', 'fought under falling rock.'],
    empty:     ['Nothing on the sensors.', 'A quiet jump.'],
    exit:      ['The way out of this sector.', 'The next one is deeper and harder.'],
    exitLast:  ['The way out — and home.', 'The contract ends here.'],
    boss:      ['The contract\'s target.', 'Everything you brought, you will need.'],
  };

  // ── seeded helpers ─────────────────────────────────────────
  function hash(str) {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  /** Which picture a node gets. */
  function kindOf(node, sectorMap) {
    if (!node) return 'empty';
    if (node.wanted) return 'wanted';
    if (node.type === 'exit') {
      const last = sectorMap && (sectorMap.sector >= (sectorMap.finalSector ?? 3));
      return last ? 'exitLast' : 'exit';
    }
    return BLURB[node.type] ? node.type : 'empty';
  }

  /** The two lines under the picture. */
  function blurb(node, sectorMap) {
    const k = kindOf(node, sectorMap);
    if (k === 'wanted') {
      const w = node.wanted;
      return [`Bounty ${w.bounty} CC alive · ${Math.round(w.bounty / 2)} dead.`,
              (w.escapes ?? 0) > 0 ? `Got away ${w.escapes}× — he comes back heavier.`
                                   : 'He knows the yard wants him.'];
    }
    return BLURB[k].slice();
  }

  // ── the pictures ──────────────────────────────────────────
  function _stars(ctx, P, seed, t, speed = 4) {
    const r = rng(seed);
    for (let i = 0; i < 46; i++) {
      const depth = 0.3 + r() * 0.7;
      const x = P.x + ((r() * P.w - t * speed * depth) % P.w + P.w) % P.w;
      const y = P.y + r() * P.h;
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + r() * 2) + i);
      ctx.globalAlpha = (0.25 + 0.55 * depth) * (0.6 + 0.4 * tw);
      ctx.fillStyle = '#cfe0ff';
      ctx.fillRect(Math.round(x), Math.round(y), depth > 0.85 ? 2 : 1, depth > 0.85 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
  }

  function _hull(ctx, cx, cy, s, body, trim, seed, facing = -1) {
    // a blocky raider in profile, pointing `facing`
    const r = rng(seed);
    const L = 64 * s, H = 18 * s;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(facing, 1);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-L / 2, -H / 2); ctx.lineTo(L / 2 - 10 * s, -H / 2);
    ctx.lineTo(L / 2, 0); ctx.lineTo(L / 2 - 10 * s, H / 2); ctx.lineTo(-L / 2, H / 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = trim;
    ctx.fillRect(-L / 2 - 6 * s, -H / 2 - 4 * s, 16 * s, 5 * s);       // nacelles
    ctx.fillRect(-L / 2 - 6 * s, H / 2 - 1 * s, 16 * s, 5 * s);
    ctx.fillRect(-L / 4, -H / 2 - 5 * s, 14 * s, 5 * s);                 // turret
    ctx.fillRect(-L / 4 + 14 * s, -H / 2 - 3 * s, 10 * s, 2 * s);         // its barrel
    // windows
    ctx.fillStyle = 'rgba(255,220,150,0.8)';
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) ctx.fillRect(-L / 2 + 8 * s + i * 9 * s, -2 * s, 3 * s, 3 * s);
    ctx.restore();
  }

  function drawPicture(ctx, node, t, P, sectorMap) {
    const kind = kindOf(node, sectorMap);
    const seed = hash(node?.id ?? 'x');
    ctx.save();
    ctx.beginPath(); ctx.rect(P.x, P.y, P.w, P.h); ctx.clip();
    const g = ctx.createLinearGradient?.(0, P.y, 0, P.y + P.h);
    if (g) {
      const top = kind === 'nebula' ? '#1a0f2a' : kind === 'boss' ? '#1a0a0e' : '#060a16';
      g.addColorStop(0, top); g.addColorStop(1, '#03050b');
      ctx.fillStyle = g;
    } else ctx.fillStyle = '#05080f';
    ctx.fillRect(P.x, P.y, P.w, P.h);
    _stars(ctx, P, seed, t);
    const cx = P.x + P.w / 2, cy = P.y + P.h / 2;

    if (kind === 'combat' || kind === 'elite' || kind === 'wanted') {
      const bob = Math.sin(t * 1.3) * 2;
      const hx = P.x + P.w * 0.64, hy = cy + bob;
      _hull(ctx, hx, hy, 1, kind === 'wanted' ? '#7a4a2a' : '#5a2a30', kind === 'wanted' ? '#c07a3a' : '#8a3a44', seed, -1);
      // a running light, and now and then a bolt towards us
      if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = '#ff3344'; ctx.fillRect(hx + 30, hy - 10, 2, 2); }
      const ph = (t % 2.6) / 2.6;
      if (ph < 0.35) {
        const bx = hx - 30 - ph / 0.35 * (P.w * 0.6);
        ctx.fillStyle = '#ff5566'; ctx.fillRect(bx, hy - 9, 14, 2);
        ctx.fillStyle = 'rgba(255,85,102,0.35)'; ctx.fillRect(bx + 14, hy - 9, 12, 2);
      }
    } else if (kind === 'store') {
      // a ring station turning
      const R = 30;
      ctx.strokeStyle = '#8a9ab8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse?.(cx, cy, R, R * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = t * 0.6 + i * Math.PI / 3;
        const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R * 0.38;
        ctx.strokeStyle = '#4a5a74'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = Math.sin(a) > 0 ? '#ffd700' : '#7a6a30';
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      ctx.fillStyle = '#5a6a88'; ctx.fillRect(cx - 7, cy - 12, 14, 24);
      ctx.fillStyle = '#ffd700';
      if (Math.floor(t * 1.5) % 2 === 0) ctx.fillRect(cx - 1, cy - 15, 2, 3);
      // a shuttle coming in to dock
      const sp = (t % 6) / 6;
      ctx.fillStyle = '#c8d8f0'; ctx.fillRect(P.x + 10 + sp * (cx - 20 - P.x), cy + 22 - sp * 14, 5, 2);
    } else if (kind === 'event') {
      // a beacon pinging
      ctx.fillStyle = '#4a6a90'; ctx.fillRect(cx - 4, cy - 6, 8, 12);
      ctx.fillStyle = '#4db8ff';
      if (Math.floor(t * 2.5) % 2 === 0) ctx.fillRect(cx - 1, cy - 10, 2, 3);
      for (let i = 0; i < 3; i++) {
        const f = ((t * 0.7 + i / 3) % 1);
        ctx.globalAlpha = (1 - f) * 0.7;
        ctx.strokeStyle = '#4db8ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, 8 + f * 52, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#9fdcff'; ctx.font = '16px Orbitron, monospace'; ctx.textAlign = 'center';
      ctx.fillText('?', cx + 34, cy - 18);
    } else if (kind === 'nebula') {
      const r = rng(seed ^ 0x55);
      for (let i = 0; i < 7; i++) {
        const bx = P.x + ((r() * P.w + t * (3 + r() * 5)) % (P.w + 60)) - 30;
        const by = P.y + r() * P.h;
        const rad = 22 + r() * 30;
        const rg = ctx.createRadialGradient?.(bx, by, 0, bx, by, rad);
        if (rg) {
          rg.addColorStop(0, `rgba(${150 + Math.round(r() * 60)},70,220,0.38)`);
          rg.addColorStop(1, 'rgba(90,30,140,0)');
          ctx.fillStyle = rg;
        } else ctx.fillStyle = 'rgba(140,60,200,0.2)';
        ctx.beginPath(); ctx.arc(bx, by, rad, 0, Math.PI * 2); ctx.fill();
      }
      if ((t % 3.1) < 0.12) {                    // lightning in the cloud
        ctx.strokeStyle = '#e8d0ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - 30, P.y + 10); ctx.lineTo(cx - 18, cy - 4); ctx.lineTo(cx - 26, cy + 4); ctx.lineTo(cx - 10, P.y + P.h - 12); ctx.stroke();
      }
    } else if (kind === 'asteroids') {
      const r = rng(seed ^ 0x77);
      for (let i = 0; i < 9; i++) {
        const sz = 5 + r() * 12;
        const x = P.x + ((r() * (P.w + 40) - t * (10 + r() * 18)) % (P.w + 40) + P.w + 40) % (P.w + 40) - 20;
        const y = P.y + 8 + r() * (P.h - 16);
        const rot = t * (r() - 0.5) * 2;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.fillStyle = i % 3 ? '#6a5040' : '#8a6a50';
        ctx.beginPath();
        const pts = 7;
        for (let k = 0; k < pts; k++) {
          const a = k / pts * Math.PI * 2, rr = sz * (0.7 + ((seed >> (k + i)) & 3) * 0.1);
          if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-sz * 0.3, -sz * 0.1, sz * 0.4, sz * 0.3);
        ctx.restore();
      }
    } else if (kind === 'exit' || kind === 'exitLast') {
      const col = kind === 'exitLast' ? '#ffd700' : '#1aff8c';
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 14; i++) {
        const a = t * 1.4 + i * (Math.PI * 2 / 14);
        const rr = 6 + ((i * 7) % 20);
        ctx.globalAlpha = 0.4 + 0.6 * ((i % 3) / 2);
        ctx.fillStyle = col;
        ctx.fillRect(cx + Math.cos(a) * rr - 1, cy + Math.sin(a) * rr - 1, 2, 2);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 8; i++) {          // marker lights around the ring
        const a = i * Math.PI / 4;
        ctx.fillStyle = (Math.floor(t * 4) % 8) === i ? '#ffffff' : col;
        ctx.fillRect(cx + Math.cos(a) * 34 - 1.5, cy + Math.sin(a) * 34 - 1.5, 3, 3);
      }
    } else if (kind === 'boss') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
      ctx.fillStyle = '#2a1418';
      ctx.fillRect(cx - 60, cy - 16, 120, 32); ctx.fillRect(cx - 34, cy - 30, 68, 60);
      ctx.fillStyle = '#3a1c22';
      ctx.fillRect(cx - 76, cy - 6, 16, 12); ctx.fillRect(cx + 60, cy - 6, 16, 12);
      const rg = ctx.createRadialGradient?.(cx, cy, 0, cx, cy, 16);
      if (rg) { rg.addColorStop(0, `rgba(255,60,70,${0.6 + 0.4 * pulse})`); rg.addColorStop(1, 'rgba(255,40,60,0)'); ctx.fillStyle = rg; }
      else ctx.fillStyle = '#ff2d44';
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff2d44'; ctx.beginPath(); ctx.arc(cx, cy, 4 + 2 * pulse, 0, Math.PI * 2); ctx.fill();
    } else {
      // a quiet field: a planet's limb at the bottom, nothing else
      const rg = ctx.createRadialGradient?.(cx + 40, P.y + P.h + 120, 100, cx + 40, P.y + P.h + 120, 160);
      if (rg) { rg.addColorStop(0, 'rgba(60,90,140,0.5)'); rg.addColorStop(1, 'rgba(60,90,140,0)'); ctx.fillStyle = rg; }
      else ctx.fillStyle = 'rgba(60,90,140,0.2)';
      ctx.beginPath(); ctx.arc(cx + 40, P.y + P.h + 120, 160, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // the frame
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    ctx.strokeRect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1);
    return kind;
  }

  /** The wanted poster's face: the same face his hail shows. */
  function _poster(ctx, w, x, y) {
    ctx.fillStyle = 'rgba(8,10,16,0.9)'; ctx.fillRect(x - 2, y - 2, 52, 64);
    ctx.strokeStyle = '#ff9a4d'; ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5, 51, 63);
    if (typeof CrewArt !== 'undefined') {
      const seed = CrewArt.seedOf({ name: w.name, race: w.race });
      ctx.save(); ctx.imageSmoothingEnabled = false;
      CrewArt.portrait(ctx, x, y, '#a83a44', CrewArt.faceOf(seed, w.race ?? null), 48);
      ctx.restore();
    }
    ctx.fillStyle = '#ff9a4d'; ctx.font = 'bold 8px Share Tech Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText('WANTED', x + 24, y + 58);
  }

  function _fit(ctx, s, w) {
    s = String(s ?? '');
    if (ctx.measureText(s).width <= w) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
    return s + '…';
  }

  /**
   * Draw the card for `node` beside its spot on the chart.
   * opts: { sectorMap, at: {x, y} (the node on screen), bounds: {x, y, w, h}
   *         (where the card must stay), t, fuel, currentId }
   * Returns { rect, kind, lines, foot } for the caller and the tests.
   */
  function draw(ctx, node, opts = {}) {
    if (!node) return null;
    const { sectorMap = null, at = { x: 0, y: 0 }, t = 0 } = opts;
    const B = opts.bounds ?? { x: 0, y: 0, w: 1280, h: 720 };
    let x = at.x + 26, y = at.y - 30;
    if (x + CARD.w > B.x + B.w - 4) x = at.x - 26 - CARD.w;      // flip to the left near the right edge
    x = Math.max(B.x + 4, x);
    y = Math.max(B.y + 4, Math.min(y, B.y + B.h - CARD.h - 4));
    const R = { x: Math.round(x), y: Math.round(y), w: CARD.w, h: CARD.h };

    ctx.save();
    ctx.fillStyle = COL.panel;
    ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 5); ctx.fill();
    ctx.strokeStyle = node.color ?? COL.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, 5); ctx.stroke();
    ctx.fillStyle = node.color ?? COL.text; ctx.fillRect(R.x + 1, R.y + 1, R.w - 2, 2);

    // title row
    const here = node.id === (opts.currentId ?? sectorMap?.currentId);
    ctx.textAlign = 'left';
    // a dark node colour (Clear is #2a4060) is a dot on the chart, not a title
    const tc = node.type === 'empty' && !node.wanted ? COL.dim : (node.color ?? COL.text);
    ctx.fillStyle = tc; ctx.font = '14px Orbitron, monospace';
    ctx.fillText(_fit(ctx, node.label, R.w - 110), R.x + 10, R.y + 20);
    ctx.textAlign = 'right'; ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillStyle = here ? COL.good : node.visited ? COL.faint : COL.dim;
    ctx.fillText(here ? 'YOU ARE HERE' : node.visited ? 'VISITED' : `SECTOR ${node.sector ?? sectorMap?.sector ?? 1}`, R.x + R.w - 10, R.y + 19);

    // the picture
    const P = { x: R.x + CARD.pic.x, y: R.y + CARD.pic.y, w: CARD.pic.w, h: CARD.pic.h };
    const kind = drawPicture(ctx, node, t, P, sectorMap);
    if (kind === 'wanted' && node.wanted) _poster(ctx, node.wanted, P.x + 8, P.y + 12);

    // what the jump brings
    const lines = blurb(node, sectorMap);
    ctx.textAlign = 'left'; ctx.fillStyle = COL.text; ctx.font = '11px Share Tech Mono, monospace';
    lines.forEach((ln, i) => ctx.fillText(_fit(ctx, ln, R.w - 20), R.x + 10, P.y + P.h + 16 + i * 14));

    // the foot: what it costs, and can he
    let foot, footCol;
    const fuel = opts.fuel;
    if (here) { foot = 'You are here.'; footCol = COL.faint; }
    else if (node.locked) { foot = 'Out of reach from here.'; footCol = COL.faint; }
    else if (fuel != null && fuel <= 0) { foot = 'JUMP · 1 He2 — the tanks are dry'; footCol = COL.bad; }
    else { foot = fuel != null ? `CLICK TO JUMP · 1 He2 (${fuel} aboard)` : 'CLICK TO JUMP · 1 He2'; footCol = fuel != null && fuel <= 2 ? COL.warn : COL.good; }
    ctx.fillStyle = COL.line; ctx.fillRect(R.x + 10, R.y + R.h - 22, R.w - 20, 1);
    ctx.fillStyle = footCol; ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(foot, R.x + 10, R.y + R.h - 9);
    ctx.restore();
    return { rect: R, kind, lines, foot, pic: P };
  }

  return { CARD, BLURB, kindOf, blurb, drawPicture, draw, hash };
})();

if (typeof window !== 'undefined') window.NodeView = NodeView;
