'use strict';
/* ============================================================
   THE SHIP'S CONSOLE, BY YARD (update196)
   ============================================================

   jj, 4.11: "każda ma w sobie coś fajnego — zróbmy po prostu każdy inny
   panel do każdego rodzaju korporacyjnego statku" — then, on the second
   mock-up: "paipy i info najlepiej wyglądają u Terry" (one standard for
   the pips and the numbers, a yard changes the frame) and, on the third:
   "liczniki pod korpo, nie białe; mniejsze odległości; lampki
   ostrzegawcze (ogień, wyciek…); zbiorniki cienkie, a licznik obok
   swojego zbiornika; motyw dla każdej stoczni — animacja".

   So every hull's console is drawn from the same rows by renderer.js —
   the hull strip, the module columns (lit in the module's own colour,
   the medbay WHITE), the reactor bar — and THIS file dresses it:

     · the FRAME of the yard that built her (Terra copper with screws,
       Pegasus steel blue, Aquarius navy enamel with a teal stripe,
       Phoenix gunmetal with cut corners, rivets and hazard tape);
     · the INSTRUMENTS in the yard's colours — a dark face, its ink, its
       rim; each tank thin, its gauge right beside it, its litres under;
     · the WARNING LAMPS — under the gauge they belong to (LEAK, LOW,
       BURN, HOT, LOW O₂, BREACH) and a WARN block (FIRE, BOARD, PESTS,
       HULL); a live danger flashes, a state just glows;
     · the yard's PIECE, animated: Terra's reactor turbine, Pegasus'
       shield scope, Aquarius' vitals (the hull's pulse), Phoenix' radar.

   And the crew's little HEART (`drawHeart`, `bpm`): on every card in the
   list, beating slow when he is well, fast when he is hurt, ragged when
   he is dying, a flat line when he is gone.

   Nothing here decides anything: `readings(ship)` only reads the ship,
   the drawers only draw what they are handed.
   ============================================================ */

const ShipConsole = (() => {
  const TAU = Math.PI * 2;

  /** The module's own colour on its pips — the medbay white (jj). */
  const MOD_COL = {
    engines: '#1aff8c', shields: '#4db8ff', piloting: '#ffd700', oxygen: '#8fd4ff', medbay: '#f2f6fa',
    weapons: '#ff7c20', cloaking: '#cc44ff', autorepair: '#7dff9a', artillery: '#ff5566', carbonite: '#9fe4ff',
    sensors: '#c8a8ff', doors: '#c8d0dc', teleporter: '#ff9adf', drones: '#ffe08a', mind: '#e08aff',
    hacking: '#8aff6a', tractor: '#5fe8ff',
  };
  function modColor(type) { return MOD_COL[type] ?? '#ffb020'; }

  /** The yards: the frame, the instruments' colours, the piece. */
  const YARDS = {
    terra:    { label: 'TERRA', motif: 'turbine', f0: '#3a2a1e', f1: '#1c140e', edge: '#8a5a32', screws: true, well: '#14100c',
                dial: { face: '#20160e', ink: '#ffb060', rim: '#a8703a', needle: '#ff7a2a', unit: '#ffc890' }, lampOff: '#2a1e14', box: '#0e0a06' },
    pegasus:  { label: 'PEGASUS', motif: 'shield', f0: '#2a3846', f1: '#141a22', edge: '#7a9ab4', screws: true, radius: 10, well: '#0a1018',
                dial: { face: '#08141e', ink: '#8fdcff', rim: '#7a9ab4', needle: '#e8f4ff', unit: '#bfe8ff' }, lampOff: '#16202a', box: '#060c12' },
    aquarius: { label: 'AQUARIUS', motif: 'vitals', f0: '#24426e', f1: '#10203a', edge: '#5c8ccc', radius: 12, stripe: '#1fb8c8', well: '#0a1628',
                dial: { face: '#0a1a2c', ink: '#5fe8d8', rim: '#5c8ccc', needle: '#f2f6fa', unit: '#a8f4ea' }, lampOff: '#142236', box: '#06101c', manCol: '#1fe0d0' },
    phoenix:  { label: 'PHOENIX', motif: 'radar', f0: '#2e1c1a', f1: '#120c0b', edge: '#8a3a2a', chamfer: true, rivets: '#5a3a34', hazard: true, labelCol: '#ff6a50', well: '#120c0a',
                dial: { face: '#160c0a', ink: '#ffcf8a', rim: '#7a3424', needle: '#ff5a2a', unit: '#ffcf8a' }, lampOff: '#2a1614', box: '#0c0606', manCol: '#ffb020' },
  };

  /** Which yard built her — the one in her layout; a hull nobody built
   *  wears Pegasus on our side and Phoenix on theirs. */
  function yardOf(ship) {
    const b = (typeof hullBuilder === 'function') ? hullBuilder(ship?.layoutKey) : null;
    return YARDS[b] ? b : (ship?.isPlayer ? 'pegasus' : 'phoenix');
  }
  function yard(ship) { return YARDS[yardOf(ship)]; }

  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
  const flash = (t, hz = 2.2) => Math.sin(t * TAU * hz) > -0.2;

  /* ── THE FRAME ─────────────────────────────────────────── */
  function _oct(ctx, x, y, w, h, k) {
    ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.lineTo(x + w, y + k); ctx.lineTo(x + w, y + h - k);
    ctx.lineTo(x + w - k, y + h); ctx.lineTo(x + k, y + h); ctx.lineTo(x, y + h - k); ctx.lineTo(x, y + k); ctx.closePath();
  }
  function _screw(ctx, x, y) {
    ctx.fillStyle = '#3a4252'; ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillStyle = '#1a1f28'; ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.fillStyle = '#59637a'; ctx.fillRect(x - 2, y, 4, 1);
  }
  /** The plate the console sits on, in the yard's dress, and its name on the top edge. */
  function drawFrame(ctx, x, y, w, h, Y, opts = {}) {
    ctx.save();
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, Y.f0); gr.addColorStop(1, Y.f1);
    ctx.globalAlpha = opts.alpha ?? 0.94;
    ctx.fillStyle = gr;
    if (Y.chamfer) _oct(ctx, x, y, w, h, 12); else { ctx.beginPath(); ctx.roundRect(x, y, w, h, Y.radius ?? 6); }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = Y.edge; ctx.lineWidth = Y.chamfer ? 1.5 : 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x + 6, y + 3, w - 12, 1);
    if (Y.screws) { _screw(ctx, x + 6, y + 6); _screw(ctx, x + w - 6, y + 6); _screw(ctx, x + 6, y + h - 6); _screw(ctx, x + w - 6, y + h - 6); }
    if (Y.rivets) {
      ctx.fillStyle = Y.rivets;
      [[x + 22, y + 4], [x + w - 22, y + 4], [x + 4, y + h / 2], [x + w - 4, y + h / 2]].forEach(([rx, ry]) => { ctx.beginPath(); ctx.arc(rx, ry, 2, 0, TAU); ctx.fill(); });
    }
    if (Y.stripe) { ctx.fillStyle = Y.stripe; ctx.fillRect(x + 16, y + h - 6, w - 32, 2); }
    if (Y.hazard) {
      ctx.save(); ctx.beginPath(); ctx.rect(x + 14, y + h - 7, w - 28, 4); ctx.clip();
      ctx.fillStyle = '#f0b400';
      for (let hx = x; hx < x + w; hx += 12) { ctx.beginPath(); ctx.moveTo(hx, y + h - 3); ctx.lineTo(hx + 4, y + h - 7); ctx.lineTo(hx + 10, y + h - 7); ctx.lineTo(hx + 6, y + h - 3); ctx.fill(); }
      ctx.restore();
    }
    if (opts.label !== false) {
      const L = Y.label, pw = L.length * 6 + 14;
      ctx.fillStyle = '#0c0f15'; ctx.fillRect(x + w / 2 - pw / 2, y - 5, pw, 10);
      ctx.strokeStyle = Y.edge; ctx.lineWidth = 1; ctx.strokeRect(x + w / 2 - pw / 2 + 0.5, y - 4.5, pw - 1, 9);
      ctx.font = 'bold 7px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = Y.labelCol ?? '#8a96ac'; ctx.fillText(L, x + w / 2, y + 2.5);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  /* ── THE INSTRUMENTS ───────────────────────────────────── */
  /** A gauge in the yard's colours: the face, its ink, its rim, the red zone, the needle. */
  function drawDial(ctx, cx, cy, r, f, D, o = {}) {
    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    ctx.fillStyle = '#0a0c10'; ctx.beginPath(); ctx.arc(cx, cy, r + 2.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = D.rim; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy, r + 1.2, 0, TAU); ctx.stroke();
    ctx.fillStyle = D.face; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    if (o.red != null) {
      ctx.strokeStyle = '#e0303e'; ctx.lineWidth = r > 12 ? 2.5 : 1.8; ctx.beginPath();
      ctx.arc(cx, cy, r * 0.76, o.redHi ? A0 + (A1 - A0) * (1 - o.red) : A0, o.redHi ? A1 : A0 + (A1 - A0) * o.red); ctx.stroke();
    }
    ctx.strokeStyle = D.ink; ctx.lineWidth = 1;
    const ticks = r > 12 ? 8 : 4;
    for (let k = 0; k <= ticks; k++) {
      const a = A0 + (A1 - A0) * k / ticks, l = k % 2 ? 0.8 : 0.66;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * l, cy + Math.sin(a) * r * l); ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92); ctx.stroke();
    }
    if (r > 12) {
      ctx.font = 'bold 6px Share Tech Mono, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = D.ink;
      (r >= 18 ? o.marks ?? [] : []).forEach(([t, fr]) => { const a = A0 + (A1 - A0) * fr; ctx.fillText(t, cx + Math.cos(a) * r * 0.46, cy + Math.sin(a) * r * 0.46 + 2.5); });
      if (o.label) { ctx.font = 'bold 5.5px Share Tech Mono, monospace'; ctx.fillText(o.label, cx, cy + r * 0.72); }
      ctx.textAlign = 'left';
    }
    const a = A0 + (A1 - A0) * Math.max(0, Math.min(1, f));
    ctx.strokeStyle = D.needle; ctx.lineWidth = r > 12 ? 1.6 : 1.2;
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * r * 0.15, cy - Math.sin(a) * r * 0.15); ctx.lineTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86); ctx.stroke();
    ctx.fillStyle = D.rim; ctx.beginPath(); ctx.arc(cx, cy, r > 12 ? 2.2 : 1.5, 0, TAU); ctx.fill();
    return a;
  }
  /** A number in a little dark window under its gauge. */
  function drawReadout(ctx, cx, y, txt, Y, col, w = 38) {
    ctx.fillStyle = Y.box; ctx.fillRect(cx - w / 2, y, w, 10);
    ctx.font = 'bold 7.5px Share Tech Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = col ?? Y.dial.unit; ctx.fillText(txt, cx, y + 8);
    ctx.textAlign = 'left';
  }
  /** A warning lamp: off, glowing (`true`) or flashing (`'flash'`). Returns whether it is lit now. */
  function drawLamp(ctx, x, y, w, label, on, col, Y, t = now()) {
    const lit = on === 'flash' ? flash(t) : !!on;
    ctx.fillStyle = '#05070a'; ctx.fillRect(x, y, w, 11);
    ctx.fillStyle = lit ? col : Y.lampOff; ctx.fillRect(x + 1, y + 1, w - 2, 9);
    if (lit) {
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 7; ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, w - 2, 9); ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x + 2, y + 2, w - 4, 1);
    }
    ctx.font = 'bold 6px Share Tech Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = lit ? '#14080a' : '#7a8294'; ctx.fillText(label, x + w / 2, y + 8.5);
    ctx.textAlign = 'left';
    _lamps.push({ label, on: !!on, flashing: on === 'flash', x, y, w, h: 11 });
    return lit;
  }
  /** A thin air bottle: valve, shoulder, the gas as a pale column; a leak puffs from the valve. */
  function drawBottle(ctx, x, y, w, h, f, t, leak) {
    ctx.fillStyle = '#8a96ac'; ctx.fillRect(x + w / 2 - 1.5, y - 4, 3, 3);
    ctx.fillStyle = '#c8d0dc'; ctx.fillRect(x + w / 2 - 2.5, y - 5, 5, 1.5);
    ctx.fillStyle = '#2a3242'; ctx.beginPath(); ctx.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, [w / 2 + 1.5, w / 2 + 1.5, 2, 2]); ctx.fill();
    ctx.fillStyle = '#0c1420'; ctx.beginPath(); ctx.roundRect(x, y, w, h, [w / 2, w / 2, 1, 1]); ctx.fill();
    const ff = Math.max(0, Math.min(1, f)), lv = y + h - (h - 3) * ff;
    const gr = ctx.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, '#5aa8d8'); gr.addColorStop(0.5, '#b8e4ff'); gr.addColorStop(1, '#4a90c0');
    ctx.fillStyle = gr; ctx.fillRect(x + 1, lv, w - 2, y + h - lv - 1);
    ctx.fillStyle = '#e8f6ff'; ctx.fillRect(x + 1, Math.round(lv), w - 2, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 1, y + 4, 1, h - 6);
    if (ff < 0.25) { ctx.fillStyle = '#e0303e'; ctx.fillRect(x, y + h - 3, w, 2); }
    if (leak) for (let k = 0; k < 3; k++) {
      const p = (t * 1.4 + k / 3) % 1;
      ctx.fillStyle = `rgba(200,230,255,${0.6 * (1 - p)})`;
      ctx.beginPath(); ctx.arc(x + w / 2 + 4 + p * 9, y - 5 - p * 5, 1 + p * 2.5, 0, TAU); ctx.fill();
    }
  }
  /** A thin sight glass of liquid He2: the surface rocks, bubbles rise; a leak drips. */
  function drawGlass(ctx, x, y, w, h, f, t, leak) {
    ctx.fillStyle = '#2a3242'; ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    ctx.fillStyle = '#10161f'; ctx.fillRect(x, y, w, h);
    const ff = Math.max(0, Math.min(1, f)), low = ff < 0.25, lvl = y + h - h * ff;
    const gr = ctx.createLinearGradient(0, lvl, 0, y + h);
    gr.addColorStop(0, low ? '#ffd27a' : '#ff9aa6'); gr.addColorStop(1, low ? '#8a5a10' : '#a8233a');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x, y + h);
    for (let k = 0; k <= w; k++) ctx.lineTo(x + k, lvl + Math.sin(k * 0.9 + t * 4) * 0.9);
    ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
    for (let k = 0; k < 2; k++) {
      const p = (t * 0.7 + k * 0.5) % 1, by = y + h - p * (y + h - lvl);
      ctx.fillStyle = 'rgba(255,240,220,0.6)'; ctx.fillRect(x + 1.5 + k * 3, by, 1.5, 1.5);
    }
    ctx.fillStyle = 'rgba(200,215,235,0.45)';
    for (let k = 1; k < 4; k++) ctx.fillRect(x + w - 3, y + h * k / 4, 3, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 1, y + 1, 1, h - 2);
    if (leak) { const p = (t * 1.6) % 1; ctx.fillStyle = `rgba(255,120,140,${1 - p})`; ctx.fillRect(x + w / 2, y + h + 2 + p * 6, 1.5, 2); }
  }

  /* ── THE YARD'S PIECE — animated ───────────────────────── */
  function drawHeart(ctx, x, y, s, col) {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x, y + s * 1.1);
    ctx.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.9, y - s * 1.3, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.9, y - s * 1.3, x + s * 1.6, y - s * 0.1, x, y + s * 1.1);
    ctx.fill();
  }
  function _led(ctx, x, y, on, col, r = 2.5) {
    ctx.fillStyle = on ? col : '#1a1f28'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (on) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x - 1, y - r + 0.5, 1, 1); }
  }
  /** The ship's pulse for the Aquarius vitals: a weak hull beats fast. */
  function hullRate(R) { return Math.round(60 + 60 * (1 - Math.max(0, Math.min(1, R.hullFrac)))); }

  function drawMotif(ctx, kind, x, y, w, h, t, R, Y) {
    ctx.save();
    ctx.fillStyle = '#05080a'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = Y.edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
    const small = h < 50, cx = x + w / 2, cy = y + h / 2 + (small ? 2 : 4);
    const head = (a, b, ca, cb) => {
      if (small) return;
      ctx.font = 'bold 6.5px Share Tech Mono, monospace';
      ctx.textAlign = 'left'; ctx.fillStyle = ca; ctx.fillText(a, x + 5, y + 10);
      ctx.textAlign = 'right'; ctx.fillStyle = cb; ctx.fillText(b, x + w - 5, y + 10);
      ctx.textAlign = 'left';
    };
    if (kind === 'turbine') {
      /* TERRA — the reactor turbine, spun by the power drawn from it. */
      const k = R.powerFrac;
      head('REACTOR', `${Math.round(1200 + 3600 * k)} RPM`, '#ffb060', '#ffc890');
      const r = Math.min(w, h) * (small ? 0.4 : 0.34), ang = t * TAU * (R.reactorOn ? 0.3 + 1.6 * k : 0);
      ctx.fillStyle = '#1a120a'; ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#a8703a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r + 2.5, 0, TAU); ctx.stroke();
      for (let b = 0; b < 7; b++) {
        const a = ang + b * TAU / 7;
        ctx.fillStyle = b % 2 ? '#c88a4a' : '#e0a060';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3);
        ctx.lineTo(cx + Math.cos(a + 0.45) * r * 0.62, cy + Math.sin(a + 0.45) * r * 0.62);
        ctx.lineTo(cx + Math.cos(a + 0.38) * r, cy + Math.sin(a + 0.38) * r);
        ctx.lineTo(cx + Math.cos(a + 0.06) * r, cy + Math.sin(a + 0.06) * r);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = R.reactorOn ? `rgba(120,255,140,${0.5 + 0.3 * Math.sin(t * TAU * 1.5)})` : '#3a2a1a';
      ctx.beginPath(); ctx.arc(cx, cy, small ? 2.5 : 4, 0, TAU); ctx.fill();
      if (!small) for (let b = 0; b < 4; b++) _led(ctx, x + 8 + b * 9, y + h - 7, b < Math.round(k * 4), '#1aff8c');
    } else if (kind === 'shield') {
      /* PEGASUS — the bubble round the hull, a ripple running out, the next layer charging. */
      head('SHIELD', `${R.shd}/${R.shdMax}`, '#8fdcff', '#bfe8ff');
      const s = small ? 0.6 : 1;
      ctx.fillStyle = '#6a8aa4'; ctx.beginPath();
      ctx.moveTo(cx + 18 * s, cy); ctx.lineTo(cx + 6 * s, cy - 6 * s); ctx.lineTo(cx - 16 * s, cy - 6 * s); ctx.lineTo(cx - 20 * s, cy - 3 * s);
      ctx.lineTo(cx - 20 * s, cy + 3 * s); ctx.lineTo(cx - 16 * s, cy + 6 * s); ctx.lineTo(cx + 6 * s, cy + 6 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8fdcff'; ctx.fillRect(cx - 22 * s, cy - 2 * s, 3 * s, 4 * s);
      for (let i = 0; i < Math.max(1, R.shdMax); i++) {
        const rx = (28 + i * 8) * s, ry = (16 + i * 6) * s, up = i < R.shd;
        ctx.strokeStyle = up ? `rgba(77,184,255,${0.75 + 0.25 * Math.sin(t * TAU)})` : '#123048'; ctx.lineWidth = small ? 1.5 : 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.stroke();
        if (i === R.shd && R.shdMax > 0 && R.shdProg > 0) {
          ctx.strokeStyle = '#4db8ff'; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + TAU * R.shdProg); ctx.stroke();
        }
      }
      if (R.shd > 0) {
        const rp = (t * 0.8) % 1; ctx.strokeStyle = `rgba(160,220,255,${0.6 * (1 - rp)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(cx, cy, (20 + rp * 22) * s, (10 + rp * 16) * s, 0, 0, TAU); ctx.stroke();
      }
    } else if (kind === 'vitals') {
      /* AQUARIUS — the ship's pulse: the hull beats, a weak hull beats fast. */
      const hr = hullRate(R);
      head('VITALS', `HR ${hr}`, '#5fe8d8', R.hullFrac < 0.3 ? '#ff5a6e' : '#3cff9a');
      const per = 60 / hr, span = 3, sweep = (t % span) / span, base = cy + (small ? 4 : 6), amp = small ? 0.6 : 1;
      const yAt = (u) => {
        const ph = ((u * span) / per) % 1;
        return ph > 0.30 && ph < 0.33 ? base - 16 * amp : ph >= 0.33 && ph < 0.355 ? base + 6 * amp : ph >= 0.355 && ph < 0.38 ? base - 3 * amp
             : ph > 0.5 && ph < 0.62 ? base - Math.sin((ph - 0.5) / 0.12 * Math.PI) * 3 * amp : base;
      };
      ctx.strokeStyle = R.hullFrac < 0.3 ? '#ff5a6e' : '#3cff9a'; ctx.lineWidth = 1.3; ctx.beginPath();
      let pen = false;
      for (let i = 0; i < w - 8; i++) {
        const u = i / (w - 8);
        if (Math.abs(u - sweep) < 0.06) { pen = false; continue; }
        const px = x + 4 + i, py = yAt(u);
        if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(60,255,154,0.5)'; ctx.fillRect(x + 4 + sweep * (w - 8) - 1, base - 18 * amp, 2, 26 * amp);
      const beat = ((t % per) / per) < 0.12 ? 1.25 : 1;
      drawHeart(ctx, x + w - (small ? 7 : 12), y + h - (small ? 6 : 10), (small ? 2.2 : 3.2) * beat, '#ff5a6e');
    } else if (kind === 'radar') {
      /* PHOENIX — the scope: the sweep and its trail, the foe lighting up as it passes. */
      head('SCOPE', R.inChase ? `${Math.round(R.v)}▼${Math.round(R.vFoe)}` : 'TRACK', '#ff6a50', '#ff5566');
      const r = Math.min(w, h) * (small ? 0.42 : 0.38), a = t * TAU * 0.5;
      ctx.strokeStyle = 'rgba(255,120,60,0.3)'; ctx.lineWidth = 1;
      [r * 0.4, r * 0.75, r].forEach(rr => { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
      for (let k = 0; k < 12; k++) {
        ctx.fillStyle = `rgba(255,110,50,${0.28 * (1 - k / 12)})`;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a - (k + 1) * 0.08, a - k * 0.08); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = '#ff8a50'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      if (R.hasFoe) {
        const fa = R.foeBearing ?? -0.6, since = ((a - fa) % TAU + TAU) % TAU, fb = Math.max(0.2, 1 - since / TAU * 1.4);
        const fr = r * (R.foeRange ?? 0.7);
        ctx.fillStyle = `rgba(255,58,42,${fb})`; ctx.fillRect(cx + Math.cos(fa) * fr - 2, cy + Math.sin(fa) * fr - 2, 4, 4);
      }
      ctx.fillStyle = '#1aff8c'; ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }
    ctx.restore();
  }

  /* ── WHAT THE SHIP SAYS — one reading for every instrument and lamp ── */
  function readings(ship, foe = null) {
    const R = { hullFrac: 1, powerFrac: 0, reactorOn: false, shd: 0, shdMax: 0, shdProg: 0, v: 0, vFoe: 0, inChase: false, hasFoe: !!foe };
    if (!ship) return R;
    R.hullFrac = (ship.hull ?? 0) / Math.max(1, ship.hullMax ?? 1);
    const r = ship.reactor;
    const rated = Math.max(1, r?.ratedPower ?? r?.totalPower ?? 1);
    R.reactorOn = !!r && !r.offline;
    R.powerFrac = R.reactorOn ? Math.max(0, Math.min(1, (rated - (ship.availablePower?.() ?? rated)) / rated)) : 0;
    const ss = ship.getSystem?.('shields');
    R.shd = ship.shieldBars ?? 0; R.shdMax = ship.shieldMax ?? 0;
    R.shdProg = ss ? Math.max(0, Math.min(1, ss.shieldChargeProgress ?? 0)) : 0;
    const T = (typeof Tanks !== 'undefined') ? Tanks : null, LOW = (typeof TANKS !== 'undefined') ? TANKS.LOW : 0.25;
    ['air', 'he2'].forEach(kind => {
      const cap = T ? T.capacity(ship, kind) : 0;
      R[kind] = { cap, f: cap > 0 ? T.frac(ship, kind) : 0, litres: cap > 0 ? Math.round(T.litres(ship, kind)) : 0,
                  leak: cap > 0 && T.leakRate(ship, kind) > 0, low: cap > 0 && T.frac(ship, kind) < LOW };
    });
    const ch = (typeof CombatManager !== 'undefined') ? CombatManager.chase : null;
    const mine = typeof CombatManager !== 'undefined' && ship === CombatManager.playerShip;
    R.inChase = !!(ch && ch.on && foe);
    if (R.inChase) { R.v = mine ? ch.vPlayer : ch.vEnemy; R.vFoe = mine ? ch.vEnemy : ch.vPlayer; }
    else if (typeof Chase !== 'undefined') { try { R.v = Chase.speed(ship); } catch (e) { R.v = 0; } }
    const H = (typeof REACTOR_HEAT_CONFIG !== 'undefined') ? REACTOR_HEAT_CONFIG : { warnHeat: 70, criticalHeat: 90, maxCelsius: 100 };
    R.heat = Math.max(0, Math.min(100, ship.reactorHeat ?? 0));
    R.celsius = typeof heatCelsius === 'function' ? heatCelsius(R.heat) : Math.round(R.heat);
    R.hot = R.heat >= H.criticalHeat ? 'flash' : R.heat >= H.warnHeat;
    R.o2 = ship.oxygen?.averageO2?.() ?? 1;
    const fires = ship.fires?.fires?.length ?? 0;
    const holes = (ship.breaches?.breaches ?? []).filter(b => !b.sealed).length;
    const boarders = (ship.crew ?? []).filter(c => !c.dead && c.isPlayer !== ship.isPlayer && !c.isPet && !c.isPrisoner && !c._survivor).length;
    const pests = (ship.pests ?? []).filter(p => !p.dead).length;
    R.warn = {
      fire: fires > 0 ? 'flash' : false,
      breach: holes > 0 ? 'flash' : false,
      board: boarders > 0 ? 'flash' : false,
      pests: pests > 0,
      hull: R.hullFrac <= 0.3 ? (R.hullFrac <= 0.15 ? 'flash' : true) : false,
      lowO2: R.o2 < 0.25 ? 'flash' : R.o2 < 0.5,
    };
    /* their BURN only while there is a fight to run from (update220, jj: "po walce ikonka miga BURN, chyba nie powinna
       w panelu"): a ship that got away, or one that is a wreck, burns nothing on our panel */
    const fighting = typeof CombatManager === 'undefined' || (CombatManager.isActive?.() && !CombatManager.enemyDown);
    R.burn = foe ? (foe.fullBurn && fighting && (foe.hull ?? 1) > 0 ? 'flash' : false) : (ship.fullBurn ? true : false);
    if (foe) {
      R.foeBearing = ship.isPlayer ? -0.35 : Math.PI + 0.35;
      R.foeRange = R.inChase ? Math.max(0.35, Math.min(0.95, 0.4 + (ch.gap ?? 0) / 900)) : 0.7;
    }
    return R;
  }

  /* ── THE INSTRUMENT BLOCK — ours, beside the module columns ── */
  const BLOCK = { w: 232, h: 150 };
  let _lamps = [];
  /** The lamps drawn since the last `beginFrame` (for the tests to ask the picture). */
  function lamps() { return _lamps.slice(); }
  function beginFrame() { _lamps = []; }

  function drawInstruments(ctx, ship, foe, bx, by, Y, t = now()) {
    const R = readings(ship, foe), D = Y.dial;
    ctx.fillStyle = Y.well; ctx.fillRect(bx, by, BLOCK.w, BLOCK.h);
    const lab = (txt, x, y, col) => { ctx.font = 'bold 7px Share Tech Mono, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.fillText(txt, x, y); ctx.textAlign = 'left'; };
    // row 1: each tank thin, its gauge right beside it, the litres under, its lamps under that
    const tank = (kind, x0) => {
      const k = R[kind], gx = x0 + 32;
      lab(kind === 'air' ? 'AIR' : 'He2', gx, by + 9, kind === 'air' ? '#8fd4ff' : '#ff8a95');
      if (kind === 'air') drawBottle(ctx, x0 + 3, by + 15, 8, 48, k.f, t, k.leak);
      else drawGlass(ctx, x0 + 3, by + 15, 8, 48, k.f, t, k.leak);
      drawDial(ctx, gx, by + 31, 16, k.cap > 0 ? k.f + (k.leak ? Math.sin(t * 40) * 0.006 : 0) : 0, D,
               { red: 0.25, label: kind === 'air' ? 'AIR' : 'He2', marks: kind === 'air' ? [['0', 0], ['1', 1]] : [['E', 0], ['F', 1]] });
      drawReadout(ctx, gx, by + 50, k.cap > 0 ? `${k.litres} L` : '—', Y, kind === 'he2' ? '#ffb020' : null);
      drawLamp(ctx, x0, by + 64, 27, 'LEAK', k.leak ? 'flash' : false, '#ff3a4a', Y, t);
      drawLamp(ctx, x0 + 29, by + 64, 25, 'LOW', k.low, '#ffb020', Y, t);
    };
    tank('air', bx + 4);
    tank('he2', bx + 62);
    drawMotif(ctx, Y.motif, bx + 122, by + 3, 106, 72, t, R, Y);
    // row 2: speed and heat with their lamps, the cabin, the master warnings
    const r2 = by + 80;
    drawDial(ctx, bx + 22, r2 + 17, 15, R.v / 50, D, { label: 'SPD', marks: [['0', 0], ['50', 1]] });
    drawReadout(ctx, bx + 22, r2 + 35, R.inChase ? `${Math.round(R.v)}▼${Math.round(R.vFoe)}` : `${Math.round(R.v)}`, Y,
                R.inChase ? (R.v >= R.vFoe ? '#1aff8c' : '#ff5566') : null);
    drawLamp(ctx, bx + 6, r2 + 49, 32, 'BURN', R.burn, '#ff3a4a', Y, t);
    drawDial(ctx, bx + 64, r2 + 17, 15, R.heat / 100, D, { red: 0.3, redHi: true, label: '°C' });
    drawReadout(ctx, bx + 64, r2 + 35, `${R.celsius}°C`, Y, R.hot ? '#ff7a20' : null);
    drawLamp(ctx, bx + 50, r2 + 49, 28, 'HOT', R.hot, '#ff7a20', Y, t);
    const sx = bx + 86, sw = 70;
    ctx.fillStyle = '#06120c'; ctx.fillRect(sx, r2 + 2, sw, 44);
    ctx.strokeStyle = '#0f2a1c'; ctx.lineWidth = 1; ctx.strokeRect(sx + 0.5, r2 + 2.5, sw - 1, 43);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let yy = r2 + 3; yy < r2 + 46; yy += 2) ctx.fillRect(sx + 1, yy, sw - 2, 1);
    ctx.font = 'bold 7px Share Tech Mono, monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = '#5fd88a'; ctx.fillText('CABIN O₂', sx + 5, r2 + 13);
    const o2c = R.o2 < 0.25 ? '#ff2d44' : R.o2 < 0.6 ? '#ffd700' : '#1aff8c';
    ctx.font = 'bold 16px Share Tech Mono, monospace'; ctx.fillStyle = o2c; ctx.fillText(`${Math.round(R.o2 * 100)}%`, sx + 5, r2 + 36);
    drawLamp(ctx, sx, r2 + 49, 33, 'LOW O₂', R.warn.lowO2, '#ff3a4a', Y, t);
    drawLamp(ctx, sx + 35, r2 + 49, 35, 'BREACH', R.warn.breach, '#ff3a4a', Y, t);
    const ax = bx + 162;
    lab('WARN', ax + 31, r2 + 9, '#8a96ac');
    [['FIRE', R.warn.fire, '#ff3a2a'], ['BOARD', R.warn.board, '#ff3a4a'], ['PESTS', R.warn.pests, '#ffd700'], ['HULL', R.warn.hull, '#ff3a4a']]
      .forEach(([L, on, col], k) => drawLamp(ctx, ax + (k % 2) * 32, r2 + 14 + Math.floor(k / 2) * 14, 30, L, on, col, Y, t));
    return R;
  }

  /* ── THEIR STRIP — the same instruments, small, in their panel ── */
  const STRIP_H = 38;
  function drawFoeStrip(ctx, ship, foe, x, y, w, Y, t = now()) {
    const R = readings(ship, foe), D = Y.dial;
    ctx.fillStyle = Y.well; ctx.fillRect(x, y, w, STRIP_H);
    const cell = (kind, x0) => {
      const k = R[kind];
      if (kind === 'air') drawBottle(ctx, x0 + 2, y + 6, 5, 28, k.f, t, k.leak);
      else drawGlass(ctx, x0 + 2, y + 6, 5, 28, k.f, t, k.leak);
      drawDial(ctx, x0 + 21, y + 17, 9, k.cap > 0 ? k.f : 0, D, { red: 0.25 });
      ctx.font = 'bold 8px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = kind === 'air' ? '#8fd4ff' : '#ff8a95'; ctx.fillText(kind === 'air' ? 'AIR' : 'He2', x0 + 33, y + 12);
      ctx.fillStyle = k.leak ? '#ff3a4a' : k.low ? '#ffb020' : D.unit; ctx.fillText(k.cap > 0 ? `${k.litres}L` : '—', x0 + 33, y + 22);
      drawLamp(ctx, x0 + 33, y + 25, 26, 'LEAK', k.leak ? 'flash' : false, '#ff3a4a', Y, t);
    };
    cell('air', x + 3);
    cell('he2', x + 66);
    const fx = x + 130;
    drawLamp(ctx, fx, y + 3, 26, 'FIRE', R.warn.fire, '#ff3a2a', Y, t);
    drawLamp(ctx, fx, y + 14, 26, 'BRCH', R.warn.breach, '#ff3a4a', Y, t);
    drawLamp(ctx, fx, y + 25, 26, 'BURN', R.burn, '#ff3a4a', Y, t);
    const mw = Math.max(40, w - (fx + 30 - x) - 3);
    drawMotif(ctx, Y.motif, x + w - mw - 3, y + 3, mw, STRIP_H - 6, t, R, Y);
    return R;
  }

  /* ── THEIR BLOCK (update201, jj: "konsola wroga za wysoka — rozciągnij ją")
     The same instruments as the strip, beside their columns instead of
     over them: the two tanks side by side, under them the lamps in a row
     and their yard's piece. FOE_BLOCK.w × FOE_BLOCK.h. */
  const FOE_BLOCK = { w: 136, h: 80 };
  function drawFoeBlock(ctx, ship, foe, x, y, Y, t = now()) {
    const R = readings(ship, foe), D = Y.dial, w = FOE_BLOCK.w, h = FOE_BLOCK.h;
    ctx.fillStyle = Y.well; ctx.fillRect(x, y, w, h);
    const cell = (kind, x0, y0) => {
      const k = R[kind];
      if (kind === 'air') drawBottle(ctx, x0 + 2, y0 + 6, 5, 28, k.f, t, k.leak);
      else drawGlass(ctx, x0 + 2, y0 + 6, 5, 28, k.f, t, k.leak);
      drawDial(ctx, x0 + 20, y0 + 17, 9, k.cap > 0 ? k.f : 0, D, { red: 0.25 });
      ctx.font = 'bold 8px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = kind === 'air' ? '#8fd4ff' : '#ff8a95'; ctx.fillText(kind === 'air' ? 'AIR' : 'He2', x0 + 32, y0 + 12);
      ctx.fillStyle = k.leak ? '#ff3a4a' : k.low ? '#ffb020' : D.unit; ctx.fillText(k.cap > 0 ? `${k.litres}L` : '—', x0 + 32, y0 + 22);
      drawLamp(ctx, x0 + 32, y0 + 25, 26, 'LEAK', k.leak ? 'flash' : false, '#ff3a4a', Y, t);
    };
    cell('air', x + 2, y);
    cell('he2', x + 68, y);
    const ly = y + 42;
    drawLamp(ctx, x + 3, ly, 26, 'FIRE', R.warn.fire, '#ff3a2a', Y, t);
    drawLamp(ctx, x + 3, ly + 12, 26, 'BRCH', R.warn.breach, '#ff3a4a', Y, t);
    drawLamp(ctx, x + 3, ly + 24, 26, 'BURN', R.burn, '#ff3a4a', Y, t);
    drawMotif(ctx, Y.motif, x + 34, ly - 1, w - 37, h - 42 - 2, t, R, Y);
    return R;
  }

  /* ── THE CREW'S HEART ─────────────────────────────────── */
  /** His pulse: slow when he is well, fast when hurt; 0 when he is gone. */
  function bpm(c) {
    if (!c || c.dead) return 0;
    const f = Math.max(0, Math.min(1, (c.hp ?? 0) / Math.max(1, c.maxHp ?? 100)));
    return Math.round(62 + 80 * (1 - f));
  }
  /** The little heart on his card, and the trace beside it when there is room. */
  function drawCrewHeart(ctx, c, x, y, t = now(), trace = null) {
    const rate = bpm(c), dead = !rate, f = (c?.hp ?? 0) / Math.max(1, c?.maxHp ?? 100);
    const seed = ((c?.id ?? c?.name ?? '').toString().split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 97) / 97;
    const per = rate ? 60 / rate : 1, ph = rate ? ((t + seed * per) % per) / per : 0;
    const beat = rate && ph < 0.14 ? 1.3 : 1;
    const col = dead ? '#3a4252' : f <= 0.25 ? '#ff2d44' : '#ff5a6e';
    drawHeart(ctx, x, y, 2.4 * beat, col);
    if (trace) {
      const lc = dead ? '#3a4252' : f <= 0.25 ? '#ff2d44' : f <= 0.5 ? '#ffb020' : '#3cff9a';
      ctx.strokeStyle = lc; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i <= trace.w; i++) {
        const u = (i / trace.w + t * 0.8 + seed) % 1, pp = rate ? ((u * 2.4 * rate / 60) % 1) : 0;
        const jit = !dead && f <= 0.25 ? Math.sin(i * 7 + t * 9) * 0.6 : 0;
        const yy = trace.y - (rate && pp > 0.4 && pp < 0.46 ? 4 : rate && pp >= 0.46 && pp < 0.5 ? -1.5 : 0) + jit;
        if (i) ctx.lineTo(trace.x + i, yy); else ctx.moveTo(trace.x, yy);
      }
      ctx.stroke();
    }
    return { bpm: rate, col };
  }

  return { YARDS, MOD_COL, modColor, yardOf, yard, readings, drawFrame, drawDial, drawReadout, drawLamp, drawBottle, drawGlass,
           drawMotif, drawHeart, drawInstruments, drawFoeStrip, drawCrewHeart, bpm, hullRate, lamps, beginFrame, BLOCK, STRIP_H, FOE_BLOCK, drawFoeBlock };
})();

if (typeof window !== 'undefined') window.ShipConsole = ShipConsole;
