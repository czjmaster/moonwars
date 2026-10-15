/* ============================================================
   MOON WARS — eventview.js  (update136)
   The event window: somebody TELLS you what is happening.

   jj, 15.10: "zrób je fajnie, tak że dana osoba niby rusza ustami a
   tekst się pisze tak jakby gadała, nie od razu cały tekst".

   WHO SPEAKS
     us    one of ours reports it — the man at the helm if there is
           one, else any of the crew, else the commander. He speaks
           the narration.
     them  the other party, when the event has one (`ev.speaker`): a
           pirate on the channel, a dock hand, a surrendering crew.
           Whatever is inside "double quotes" is THEIR line, and their
           mouth moves while it is typed; the rest is ours.

   THE TEXT TYPES ITSELF at CPS characters a second, with a breath
   after a full stop or a comma. The mouth follows the letter being
   typed: a vowel opens it wide, a consonant half, a space or a stop
   closes it — held a few frames so it reads as speech, not flicker.

   THE CHOICES ARE THERE FROM THE FIRST FRAME (you can read them while
   he talks) but dim and locked; a click or SPACE while he is talking
   finishes the sentence instead of taking a choice by accident. Once
   the text is out they light up, and 1–4 pick them.

   Drawing and the hit test are the same function: `draw` returns the
   rectangles it painted, and game.js clicks on those.
   ============================================================ */

'use strict';

const EventView = (() => {
  const CPS = 50;                       // characters per second
  const BREATH = { '.': 0.24, '!': 0.24, '?': 0.24, ',': 0.1, ';': 0.12, ':': 0.12, '—': 0.14 };
  const MOUTH_HOLD = 0.075;             // a mouth shape lasts at least this long
  const PANEL_W = 820;
  const PORTRAIT = 96;                  // 2 × the 48 px face, so every pixel stays square
  const COL_W = 124;                    // a portrait column
  const LINE_H = 21;
  const CHOICE_H = 38, CHOICE_GAP = 8;

  const COL = {
    panel: '#0c111e', panel2: '#101828', line: '#1e2d4a', line2: '#2a3d5e',
    text: '#c8d8f0', speech: '#eef4ff', dim: '#7a90a8', faint: '#4a5a70',
    ours: '#4db8ff', hostile: '#ff5566', stranger: '#ffd780',
    good: '#1aff8c', bad: '#ff5566',
  };

  let _v = null;

  /* ── TEXT ─────────────────────────────────────────────── */

  /** Who owns each character: 'us', 'them' or null. A quote mark
   *  belongs to the speech it opens or closes. With nobody on the
   *  other end, the quotes are ours too. */
  function owners(text, hasUs, hasThem) {
    const out = new Array(text.length);
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') { out[i] = hasThem ? 'them' : (hasUs ? 'us' : null); inQ = !inQ; continue; }
      out[i] = (inQ && hasThem) ? 'them' : (hasUs ? 'us' : null);
    }
    return out;
  }

  /** The mouth a character makes: 'b' wide (vowel), 'a' half (other
   *  letter or digit), null shut. */
  function mouthFor(ch) {
    if (!ch) return null;
    if (/[aeiouyąęó]/i.test(ch)) return 'b';
    if (/[a-z0-9ąćęłńóśźż']/i.test(ch)) return 'a';
    return null;
  }

  /** Seconds to wait after typing `ch` (with `next` after it). */
  function delayAfter(ch, next) {
    const base = 1 / CPS;
    if (BREATH[ch] && (next === ' ' || next === '"' || next === undefined)) return base + BREATH[ch];
    return base;
  }

  /** Word-wrap the WHOLE text up front, so lines never jump while it
   *  types. Returns [{ from, to }] index ranges into the text. */
  function wrap(text, width, measure) {
    const lines = [];
    let from = 0, lastSpace = -1, i = 0;
    while (i < text.length) {
      if (text[i] === ' ') lastSpace = i;
      if (measure(text.slice(from, i + 1)) > width && i > from) {
        const cut = lastSpace > from ? lastSpace : i;
        lines.push({ from, to: cut });
        from = text[cut] === ' ' ? cut + 1 : cut;
        lastSpace = -1;
        i = from;
        continue;
      }
      i++;
    }
    if (from < text.length) lines.push({ from, to: text.length });
    return lines;
  }

  /* ── THE VIEW ─────────────────────────────────────────── */

  function _seedOf(sp) {
    if (!sp) return 0;
    if (sp.rec && typeof CrewArt !== 'undefined') return CrewArt.seedOf(sp.rec);
    if (Number.isFinite(sp.seed)) return sp.seed | 0;
    return (typeof CrewArt !== 'undefined') ? CrewArt.strHash(`${sp.name ?? ''}|${sp.role ?? ''}`) : 1;
  }

  function open(ev, opts = {}) {
    const text = String(ev?.text ?? '');
    const us = opts.reporter || null;
    const them = ev?.speaker || null;
    _v = {
      ev, text, us, them,
      own: owners(text, !!us, !!them),
      t: 0, idx: 0, acc: 0, doneAt: null,
      lastCharAt: -1, lastChar: '',
      mouth: { us: { shape: null, until: 0 }, them: { shape: null, until: 0 } },
      seeds: { us: _seedOf(us), them: _seedOf(them) },
      blips: 0,
    };
    if (!text.length) _v.doneAt = 0;
    return _v;
  }

  function reset() { _v = null; }
  function view() { return _v; }
  function done() { return !!_v && _v.doneAt !== null; }

  /** Finish the sentence now. */
  function skip() {
    if (!_v || _v.doneAt !== null) return;
    _v.idx = _v.text.length;
    _v.doneAt = _v.t;
  }

  /** Who is talking this instant: 'us', 'them' or null. */
  function speaking() {
    if (!_v || _v.doneAt !== null || _v.idx === 0) return null;
    if (_v.t - _v.lastCharAt > 0.3) return null;
    return _v.own[Math.max(0, _v.idx - 1)] || null;
  }

  function update(dt, ev) {
    if (!ev) { _v = null; return; }
    if (!_v || _v.ev !== ev) return;           // opened by the first draw
    _v.t += dt;
    if (_v.doneAt !== null) return;
    _v.acc += dt;
    const T = _v.text;
    while (_v.idx < T.length) {
      const d = delayAfter(T[_v.idx - 1], T[_v.idx]);
      if (_v.idx > 0 && _v.acc < d) break;
      if (_v.idx > 0) _v.acc -= d;
      const ch = T[_v.idx];
      _v.idx++;
      _v.lastChar = ch;
      _v.lastCharAt = _v.t;
      const who = _v.own[_v.idx - 1];
      // a syllable now and then — every third letter, at his own pitch
      if (who && /[a-z]/i.test(ch) && (++_v.blips % 3 === 0)
          && typeof Audio !== 'undefined' && Audio.sfx?.voiceBlip) {
        const s = _v.seeds[who] >>> 0;
        Audio.sfx.voiceBlip(0.8 + (s % 50) / 100 + (who === 'them' ? -0.12 : 0));
      }
    }
    if (_v.idx >= T.length) _v.doneAt = _v.t;
    // the mouths
    ['us', 'them'].forEach(who => {
      const m = _v.mouth[who];
      if (_v.t < m.until) return;
      const talking = speaking() === who;
      m.shape = talking ? mouthFor(_v.lastChar) : null;
      m.until = _v.t + MOUTH_HOLD;
    });
  }

  /** A blink: each face on its own clock, 0.12 s every 3–5 s. */
  function blinking(seed, t) {
    const s = seed >>> 0;
    const period = 3 + (s % 200) / 100;
    const phase = (s % 997) / 997 * period;
    return ((t + phase) % period) < 0.12;
  }

  /* ── LAYOUT ───────────────────────────────────────────── */

  function layout(ev, W, H, measure) {
    const v = _v;
    const us = !!v?.us, them = !!v?.them;
    const x = Math.round(W / 2 - PANEL_W / 2);
    const tx = x + 24 + (us ? COL_W + 16 : 0);
    const tr = x + PANEL_W - 24 - (them ? COL_W + 16 : 0);
    const lines = wrap(v?.text ?? '', tr - tx - 24, measure);
    const textH = Math.max(1, lines.length) * LINE_H + 28;
    const bodyH = Math.max(us || them ? 172 : 0, textH);
    const n = ev?.choices?.length ?? 0;
    const choicesH = n ? n * (CHOICE_H + CHOICE_GAP) - CHOICE_GAP : 0;
    const PH = 66 + bodyH + 16 + choicesH + 34;
    const y = Math.max(8, Math.round(H / 2 - PH / 2));
    const by = y + 66;
    const cy = by + bodyH + 16;
    return {
      panel: { x, y, w: PANEL_W, h: PH },
      text: { x: tx, y: by, w: tr - tx, h: bodyH },
      lines,
      us: us ? { x: x + 24, y: by } : null,
      them: them ? { x: x + PANEL_W - 24 - COL_W, y: by } : null,
      choices: (ev?.choices ?? []).map((c, i) => ({
        i, x: x + 24, y: cy + i * (CHOICE_H + CHOICE_GAP), w: PANEL_W - 48, h: CHOICE_H,
      })),
      hintY: y + PH - 14,
    };
  }

  /* ── DRAWING ──────────────────────────────────────────── */

  function _bracket(ctx, x, y, w, h, col, len = 10) {
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
    ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
    ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
    ctx.stroke();
  }

  function _fit(ctx, s, w) {
    s = String(s ?? '');
    if (ctx.measureText(s).width <= w) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
    return s + '…';
  }

  function _accentOf(who, sp) {
    if (who === 'us') return COL.ours;
    return sp?.hostile ? COL.hostile : COL.stranger;
  }

  function _portrait(ctx, who, sp, at) {
    const v = _v;
    const accent = _accentOf(who, sp);
    const talking = speaking() === who;
    const fx = at.x + (COL_W - PORTRAIT - 12) / 2, fy = at.y;
    const fw = PORTRAIT + 12;
    // the frame
    ctx.fillStyle = '#070b14';
    ctx.fillRect(fx, fy, fw, fw);
    ctx.strokeStyle = talking ? accent : COL.line2; ctx.lineWidth = 1;
    ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fw - 1);
    if (talking) {
      ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 12;
      ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fw - 1); ctx.restore();
    }
    // the face
    const seed = v.seeds[who];
    if (typeof CrewArt !== 'undefined') {
      const colour = sp.colour ?? (sp.rec && typeof crewColor === 'function' ? crewColor(sp.rec) : '#8a8d93');
      const face = { ...CrewArt.faceOf(seed, sp.rec?.race ?? sp.race ?? null) };
      face.talk = v.mouth[who].shape;
      face.blink = blinking(seed, v.t);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      const paint = () => CrewArt.portrait(ctx, fx + 6, fy + 6, colour, face, PORTRAIT);
      // a face keeps its colours in any palette (update137)
      if (typeof Palette !== 'undefined') Palette.raw(paint); else paint();
      ctx.restore();
    }
    // a transmission is a picture on a screen: scan lines, and a roll
    if (who === 'them') {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let yy = fy + 6; yy < fy + 6 + PORTRAIT; yy += 3) ctx.fillRect(fx + 6, yy, PORTRAIT, 1);
      const roll = (v.t * 40) % PORTRAIT;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(fx + 6, fy + 6 + roll, PORTRAIT, 6);
    }
    _bracket(ctx, fx - 3, fy - 3, fw + 6, fw + 6, talking ? accent : COL.line, 8);
    // name and role
    const cx = at.x + COL_W / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = COL.text; ctx.font = '12px Share Tech Mono, monospace';
    ctx.fillText(_fit(ctx, sp.name || sp.role || '—', COL_W), cx, fy + fw + 18);
    if (sp.name && sp.role) {
      ctx.fillStyle = accent; ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(_fit(ctx, sp.role, COL_W), cx, fy + fw + 32);
    }
    // the voice meter
    const bars = 9, bw = 4, gap = 3, total = bars * bw + (bars - 1) * gap;
    const bx = cx - total / 2, base = fy + fw + 48;
    for (let i = 0; i < bars; i++) {
      const h = talking
        ? 3 + Math.abs(Math.sin(v.t * (9 + i * 1.7) + i * 1.3 + seed % 7)) * 11
        : 2;
      ctx.fillStyle = talking ? accent : COL.line2;
      ctx.globalAlpha = talking ? 0.9 : 1;
      ctx.fillRect(bx + i * (bw + gap), base - h, bw, h);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  /**
   * Paint the event. `opts`: { reporter, hasCommander, mouse, W, H }.
   * Returns the layout, choice rectangles included, for the hit test.
   */
  function draw(ctx, ev, opts = {}) {
    if (!ev) return null;
    if (!_v || _v.ev !== ev) open(ev, opts);
    const v = _v;
    const W = opts.W ?? 1280, H = opts.H ?? 720;
    ctx.font = '14px Share Tech Mono, monospace';
    const L = layout(ev, W, H, s => ctx.measureText(s).width);
    const { panel: P } = L;
    const them = v.them;
    const hostile = !!them?.hostile;

    // the room goes dark around it
    ctx.fillStyle = 'rgba(3,5,10,0.62)';
    ctx.fillRect(0, 0, W, H);

    // the panel
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 30;
    ctx.fillStyle = COL.panel;
    ctx.beginPath(); ctx.roundRect(P.x, P.y, P.w, P.h, 6); ctx.fill();
    ctx.restore();
    const grad = ctx.createLinearGradient?.(0, P.y, 0, P.y + P.h);
    if (grad) { grad.addColorStop(0, COL.panel2); grad.addColorStop(1, COL.panel); ctx.fillStyle = grad; }
    ctx.beginPath(); ctx.roundRect(P.x, P.y, P.w, P.h, 6); ctx.fill();
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1, 6); ctx.stroke();
    const accent = them ? _accentOf('them', them) : COL.ours;
    ctx.fillStyle = accent;
    ctx.fillRect(P.x + 1, P.y + 1, P.w - 2, 2);
    _bracket(ctx, P.x - 4, P.y - 4, P.w + 8, P.h + 8, accent, 14);

    // the header
    const kicker = them ? (hostile ? 'HOSTILE CHANNEL' : 'OPEN CHANNEL') : 'SHIP\'S LOG';
    ctx.textAlign = 'left';
    ctx.fillStyle = COL.dim; ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(kicker, P.x + 24, P.y + 24);
    ctx.fillStyle = COL.speech; ctx.font = '17px Orbitron, monospace';
    ctx.fillText(_fit(ctx, ev.title, P.w - 160), P.x + 24, P.y + 48);
    if (them) {                                     // a live channel blinks
      const on = Math.floor(v.t * 2) % 2 === 0;
      ctx.fillStyle = on ? accent : COL.line2;
      ctx.beginPath(); ctx.arc(P.x + P.w - 70, P.y + 21, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COL.dim; ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText('LIVE', P.x + P.w - 60, P.y + 24);
    }
    ctx.fillStyle = COL.line;
    ctx.fillRect(P.x + 24, P.y + 58, P.w - 48, 1);

    // the faces
    if (L.us) _portrait(ctx, 'us', v.us, L.us);
    if (L.them) _portrait(ctx, 'them', them, L.them);

    // the words, as far as they have been said
    const T = L.text;
    ctx.fillStyle = 'rgba(6,10,20,0.6)';
    ctx.fillRect(T.x, T.y, T.w, T.h);
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    ctx.strokeRect(T.x + 0.5, T.y + 0.5, T.w - 1, T.h - 1);
    ctx.font = '14px Share Tech Mono, monospace';
    let caret = null;
    L.lines.forEach((ln, li) => {
      const ly = T.y + 24 + li * LINE_H;
      let lx = T.x + 12, i = ln.from;
      const end = Math.min(ln.to, v.idx);
      while (i < end) {
        const who = v.own[i];
        let j = i;
        while (j < end && v.own[j] === who) j++;
        const run = v.text.slice(i, j);
        ctx.fillStyle = who === 'them' ? COL.speech : COL.text;
        ctx.fillText(run, lx, ly);
        lx += ctx.measureText(run).width;
        i = j;
      }
      if (v.idx >= ln.from && v.idx <= ln.to && v.doneAt === null) caret = { x: lx, y: ly };
    });
    if (caret && Math.floor(v.t * 3) % 2 === 0) {
      ctx.fillStyle = v.own[Math.max(0, v.idx - 1)] === 'them' ? accent : COL.ours;
      ctx.fillRect(caret.x + 1, caret.y - 12, 8, 14);
    }

    // the choices
    const ready = v.doneAt !== null;
    const lit = ready ? Math.min(1, (v.t - v.doneAt) / 0.25) : 0;
    const mouse = opts.mouse || { x: -1, y: -1 };
    const hover = ready
      ? L.choices.find(r => mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h)
      : null;
    ev.choices.forEach((c, i) => {
      const r = L.choices[i];
      const on = hover === r;
      /* THE COLOUR OF THE DECISION (update52) and NO COMMANDER, NO
         COLOUR (update54) — the same rule the old window had. */
      const km = opts.hasCommander ? (c.result?.karma || 0) : 0;
      const tone = km > 0 ? { line: COL.good, fill: 'rgba(26,255,140,0.16)' }
                 : km < 0 ? { line: COL.bad,  fill: 'rgba(255,85,102,0.16)' }
                 :          { line: COL.ours, fill: 'rgba(26,140,255,0.22)' };
      ctx.globalAlpha = 0.35 + 0.65 * lit;
      ctx.fillStyle = on ? tone.fill : 'rgba(16,24,42,0.95)';
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
      ctx.strokeStyle = km ? tone.line : (on ? COL.ours : COL.line);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 4); ctx.stroke();
      if (on) { ctx.fillStyle = tone.line; ctx.fillRect(r.x, r.y + 6, 3, r.h - 12); }
      // the key that takes it
      ctx.strokeStyle = on ? tone.line : COL.line2;
      ctx.strokeRect(r.x + 10.5, r.y + 9.5, 20, 20);
      ctx.fillStyle = on ? tone.line : COL.dim;
      ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), r.x + 20.5, r.y + 23);
      ctx.textAlign = 'left';
      ctx.fillStyle = km ? tone.line : (on ? COL.ours : COL.text);
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.fillText(c.label, r.x + 42, r.y + 24);
      if (km) {
        ctx.textAlign = 'right';
        ctx.font = '11px Share Tech Mono, monospace';
        ctx.fillText(`${km > 0 ? '+' : ''}${km} KARMA`, r.x + r.w - 14, r.y + 24);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    });

    // what the keys do
    ctx.textAlign = 'center';
    ctx.fillStyle = COL.faint; ctx.font = '10px Share Tech Mono, monospace';
    const n = ev.choices.length;
    ctx.fillText(ready ? (n > 1 ? `1–${n} OR CLICK — CHOOSE` : '1 OR CLICK — CONTINUE')
                       : 'CLICK OR SPACE — SKIP', P.x + P.w / 2, L.hintY);
    ctx.textAlign = 'left';

    L.hover = hover ? hover.i : -1;
    L.ready = ready;
    return L;
  }

  return {
    CPS, PORTRAIT, PANEL_W,
    owners, mouthFor, delayAfter, wrap, blinking,
    open, reset, view, done, skip, speaking, update, layout, draw,
  };
})();

if (typeof window !== 'undefined') window.EventView = EventView;
