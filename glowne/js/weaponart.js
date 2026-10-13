/* ============================================================
   MOON WARS — weaponart.js  (update126)
   Every gun, every shot and every hit, painted in code.

   jj: "przydały by się lepsze grafiki broni" — the guns were flat
   badges, a shot was a 24×4 strip, and every hit in the game was the
   same orange puff whatever landed. Here each gun is a machine with
   its own silhouette, each shot has its own body and trail, and each
   kind of hit its own blast.

   All painting is a PURE function of its inputs (key, charge, time,
   a seed) — no state, no Math.random — so a frame can be painted
   again exactly, for the sketch, for the tests and for the game.

   Native gun box: 44×18, pointing RIGHT. `turret` takes the same
   (x, y, w, h) as the old Renderer.drawWeaponIcon and scales to it.
   ============================================================ */

'use strict';

const WeaponArt = (() => {

  const GUN = { w: 44, h: 18 };

  /* THE STEEL. One palette for every housing, so the guns belong to
     the same ship; the colour of the gun is in its lens, coils and
     warheads, not its paint. */
  const STEEL = {
    out: '#1d232e', body: '#6c7586', hi: '#a3acba', lo: '#4a5260',
    rivet: '#3a414d', barrel: '#b4bcc8', barrelHi: '#d4dae2', barrelLo: '#7d8592',
    dark: '#0a0d14', fin: '#5b6371',
  };
  /* ON A CARD (shop, armoury, crate) the same machine in the dark blue
     of the UI, so it sits in its badge instead of shouting off it. */
  const CARD = {
    out: '#0b1220', body: '#2a3a55', hi: '#3d5476', lo: '#1c2840',
    rivet: '#16203a', barrel: '#5a6f90', barrelHi: '#7f95b6', barrelLo: '#3c4d6a',
    dark: '#05080f', fin: '#22314c',
  };

  /* Which machine each gun is. `col` is the gun's own colour — its
     charge boxes, lens and shots wear it. */
  const STYLE = {
    laser_basic:      { form: 'rail',    col: '#ff5566', housing: 'low'  },
    laser_burst:      { form: 'twin',    col: '#ff7a88', housing: 'low'  },
    laser_heavy:      { form: 'heavy',   col: '#ff3344', housing: 'std'  },
    missile_basic:    { form: 'pods',    col: '#ffb347', housing: 'tall' },
    torpedo_launcher: { form: 'tube',    col: '#4dd8c0', housing: 'tall' },
    cannon_basic:     { form: 'howitzer',col: '#ff7c20', housing: 'tall' },
    flak_basic:       { form: 'drum',    col: '#ffd780', housing: 'std'  },
    ion_basic:        { form: 'coil',    col: '#8a7dff', housing: 'low'  },
    beam_basic:       { form: 'emitter', col: '#ff2d6a', housing: 'low'  },
  };
  const TYPE_KEY = {
    laser: 'laser_basic', missile: 'missile_basic', torpedo: 'torpedo_launcher',
    cannon: 'cannon_basic', flak: 'flak_basic', ion: 'ion_basic', beam: 'beam_basic',
  };
  function styleOf(key, type) {
    return STYLE[key] || STYLE[TYPE_KEY[type]] || STYLE[TYPE_KEY[key]] || STYLE.laser_basic;
  }
  function keyOf(key, type) {
    return STYLE[key] ? key : (TYPE_KEY[type] || TYPE_KEY[key] || 'laser_basic');
  }

  // ── tiny helpers ──────────────────────────────────────────
  const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  /** A steel block with a 1-px outline and cut corners, lit from above. */
  function block(c, x, y, w, h, s = STEEL) {
    R(c, x + 1, y, w - 2, h, s.out); R(c, x, y + 1, w, h - 2, s.out);
    R(c, x + 1, y + 1, w - 2, h - 2, s.body);
    R(c, x + 1, y + 1, w - 2, 1, s.hi);
    R(c, x + 1, y + h - 2, w - 2, 1, s.lo);
  }
  /** A round barrel lying along x: outline, light top, dark belly. */
  function tube(c, x, y, w, h, s = STEEL) {
    R(c, x, y, w, h, s.out);
    R(c, x, y + 1, w, h - 2, s.barrel);
    R(c, x, y + 1, w, 1, s.barrelHi);
    if (h > 3) R(c, x, y + h - 2, w, 1, s.barrelLo);
  }
  function hexA(col, a) {
    const n = parseInt(col.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  }
  function mix(a, b, t) {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const ch = s => Math.round((((x >> s) & 255) * (1 - t)) + (((y >> s) & 255) * t));
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  /** Deterministic noise: the same seed and index give the same number. */
  function rnd(seed, i) {
    let h = (seed * 374761393 + i * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ── THE GUNS ──────────────────────────────────────────────

  const HOUSING = { low: [4, 11], std: [3, 13], tall: [1, 17] };   // [top, height]

  /**
   * Paint one gun.
   * opts: dir (1 right / -1 left), powered, dim, charge 0..1, armed,
   *       recoil 0..1 (just fired), t (seconds, for pulses),
   *       card (the dark-blue UI version, for shop and armoury cards).
   */
  function turret(ctx, key, x, y, w = GUN.w, h = GUN.h, opts = {}) {
    const type = opts.type;
    const k = keyOf(key, type), st = styleOf(key, type);
    const { dir = 1, powered = true, dim = false, armed = false, t = 0 } = opts;
    const charge = powered && !dim ? Math.max(0, Math.min(1, opts.charge ?? (armed ? 1 : 0))) : 0;
    const kick = Math.round(Math.max(0, Math.min(1, opts.recoil ?? 0)) * 3);
    const col = st.col;
    const lit = powered && !dim;
    const P = opts.card ? CARD : STEEL;
    const pulse = armed && lit ? 0.6 + 0.4 * Math.sin(t * 8) : 0;

    ctx.save();
    ctx.translate(x + (dir < 0 ? w : 0), y);
    ctx.scale((dir < 0 ? -1 : 1) * w / GUN.w, h / GUN.h);

    // ── the housing ──
    const [hy, hh] = HOUSING[st.housing];
    block(ctx, 1, hy, 21, hh, P);
    R(ctx, 8, hy + 2, 1, hh - 4, P.lo);                         // panel seam
    [[3, hy + 2], [3, hy + hh - 3], [19, hy + 2], [19, hy + hh - 3]]
      .forEach(([rx, ry]) => R(ctx, rx, ry, 1, 1, P.rivet));
    for (let v = -2; v <= 2; v += 2) R(ctx, 12, 9 + v, 5, 1, P.lo);   // vents
    // status lamp: dark off, the gun's colour on, pulsing when armed
    R(ctx, 10, hy + 2, 2, 2, lit ? (armed ? mix(col, '#ffffff', pulse * 0.6) : col) : '#2a3040');
    // the trunnion it turns on
    R(ctx, 19, 6, 4, 7, P.out); R(ctx, 20, 7, 2, 5, P.lo);

    // ── the barrel, by family ──
    ctx.save();
    ctx.translate(-kick, 0);
    const glow = a => hexA(col, a);
    const lens = (lx, ly, lw, lh) => {
      R(ctx, lx, ly, lw, lh, lit ? mix('#3a1a20', col, 0.35 + charge * 0.65) : '#2a3040');
      if (charge > 0.5 && lit) R(ctx, lx + Math.floor(lw / 2), ly + Math.floor(lh / 2), 1, 1, '#ffffff');
    };
    switch (st.form) {
      case 'rail': {
        tube(ctx, 21, 7, 18, 5, P);
        [24, 27, 30].forEach(fx => { R(ctx, fx, 5, 2, 9, P.out); R(ctx, fx, 6, 1, 7, P.fin); });
        R(ctx, 38, 6, 3, 7, P.out); R(ctx, 39, 7, 2, 5, P.rivet);
        R(ctx, 41, 7, 2, 5, P.out); lens(41, 8, 2, 3);
        break;
      }
      case 'twin': {
        tube(ctx, 21, 3, 18, 4, P); tube(ctx, 21, 11, 18, 4, P);
        R(ctx, 27, 3, 3, 12, P.out); R(ctx, 28, 4, 1, 10, P.fin);   // the yoke
        R(ctx, 38, 2, 3, 6, P.out); R(ctx, 38, 10, 3, 6, P.out);
        lens(41, 3, 2, 4); lens(41, 11, 2, 4);
        break;
      }
      case 'heavy': {
        tube(ctx, 21, 6, 17, 7, P);
        [24, 29, 34].forEach(rx => {
          R(ctx, rx, 3, 3, 13, P.out); R(ctx, rx, 4, 3, 11, P.barrelLo);
          R(ctx, rx, 4, 3, 1, P.barrelHi);
          R(ctx, rx + 1, 9, 1, 1, lit ? mix(P.rivet, col, 0.3 + charge * 0.7) : P.rivet);
        });
        R(ctx, 38, 3, 6, 13, P.out);
        lens(39, 4, 4, 11);
        if (lit && charge > 0) R(ctx, 40, 6, 1, 7, glow(0.4 + charge * 0.5));
        break;
      }
      case 'pods': {
        block(ctx, 21, 1, 21, 17, P);
        for (let s = 0; s < 6; s++) R(ctx, 23, 3 + s * 2, 1, 1, s % 2 ? '#1d232e' : '#ffd24a');  // hazard tick
        [[3, 6], [10, 6]].forEach(([ty, th]) => {
          R(ctx, 34, ty, 8, th, P.out);
          R(ctx, 35, ty + 1, 7, th - 2, P.dark);
          if (lit && charge >= 1) {                                   // a warhead in the tube
            R(ctx, 38, ty + 1, 3, th - 2, '#c8ccd4');
            R(ctx, 41, ty + 2, 1, th - 4, '#ff5a3c');
          }
        });
        R(ctx, 26, 8, 6, 2, P.lo);
        break;
      }
      case 'tube': {
        R(ctx, 21, 4, 21, 11, P.out);
        R(ctx, 21, 5, 21, 9, '#5d6676');
        R(ctx, 21, 5, 21, 1, P.hi); R(ctx, 21, 12, 21, 1, P.lo);
        R(ctx, 33, 4, 3, 11, P.out); R(ctx, 33, 5, 3, 9, lit ? col : '#2f4a48');   // the band
        [25, 29].forEach(rx => R(ctx, rx, 7, 1, 1, P.rivet));
        R(ctx, 40, 3, 4, 13, P.out); R(ctx, 41, 5, 2, 9, P.dark);
        if (lit && charge >= 1) { R(ctx, 41, 6, 2, 7, col); R(ctx, 42, 8, 1, 3, '#e0fff8'); }
        break;
      }
      case 'howitzer': {
        tube(ctx, 21, 5, 16, 9, P);
        R(ctx, 36, 6, 2, 7, P.out); R(ctx, 36, 7, 2, 5, P.barrel);
        R(ctx, 37, 3, 7, 13, P.out);                              // muzzle brake
        R(ctx, 38, 4, 5, 11, P.barrelLo); R(ctx, 38, 4, 5, 1, P.barrelHi);
        R(ctx, 39, 5, 1, 3, P.dark); R(ctx, 39, 11, 1, 3, P.dark);
        R(ctx, 41, 5, 1, 3, P.dark); R(ctx, 41, 11, 1, 3, P.dark);
        R(ctx, 42, 8, 2, 3, lit && charge > 0 ? mix('#2a1206', col, charge) : P.dark);
        break;
      }
      case 'drum': {
        const spin = Math.floor((opts.recoil ?? 0) * 8) % 4;     // the barrels turn as it fires
        R(ctx, 23, 2, 9, 15, P.out);
        R(ctx, 24, 3, 7, 13, P.body); R(ctx, 24, 3, 7, 1, P.hi); R(ctx, 24, 14, 7, 1, P.lo);
        R(ctx, 26, 8, 3, 3, P.rivet);
        [3, 7, 10, 14].forEach((by, i) => {
          R(ctx, 31, by - 1, 12, 3, P.out);
          R(ctx, 31, by, 11, 1, i === spin && (opts.recoil ?? 0) > 0 ? P.barrelHi : P.barrel);
          R(ctx, 42, by, 1, 1, lit && charge > 0 ? mix(P.dark, col, charge) : P.dark);
        });
        break;
      }
      case 'coil': {
        tube(ctx, 21, 7, 21, 5, P);
        [25, 30, 35].forEach((cx, i) => {
          R(ctx, cx, 2, 3, 15, P.out);
          const on = lit ? Math.max(0, Math.min(1, charge * 3 - i)) : 0;   // they light one by one
          R(ctx, cx, 3, 3, 13, mix('#2c3350', col, 0.25 + on * 0.75));
          R(ctx, cx + 1, 3, 1, 13, mix('#3c4568', '#ffffff', on * 0.55));
        });
        R(ctx, 40, 6, 4, 7, P.out); R(ctx, 41, 7, 2, 5, lit ? mix('#2c3350', col, 0.4 + charge * 0.6) : '#2c3350');
        if (lit && charge > 0.6) {                                    // crackle between the coils
          const f = Math.floor(t * 20);
          for (let s = 0; s < 3; s++) {
            const sx = 27 + Math.floor(rnd(f, s) * 12), sy = 4 + Math.floor(rnd(f, s + 9) * 10);
            R(ctx, sx, sy, 1, 1, '#e8f0ff');
          }
        }
        break;
      }
      case 'emitter': {
        tube(ctx, 21, 7, 8, 5, P);
        for (let ix = 0; ix <= 10; ix++) {                            // the dish opens out
          const half = 2 + Math.round(ix * 0.6);
          R(ctx, 28 + ix, 9 - half - 1, 1, half * 2 + 3, P.out);
          R(ctx, 28 + ix, 9 - half, 1, half * 2 + 1, ix > 1 ? '#1a1f2a' : P.lo);
          R(ctx, 28 + ix, 9 - half, 1, 1, P.hi);
        }
        R(ctx, 38, 1, 4, 2, P.out); R(ctx, 38, 15, 4, 2, P.out);     // prongs
        R(ctx, 31, 8, 3, 3, lit ? mix('#3a1424', col, 0.4 + charge * 0.6) : '#3a1424');
        if (lit && charge > 0.5) R(ctx, 32, 9, 1, 1, '#ffffff');
        break;
      }
    }
    // the muzzle glows as the charge comes up, and breathes when armed
    if (lit && charge > 0.15 && !['pods', 'tube', 'drum'].includes(st.form)) {
      R(ctx, 42, 7, 3, 5, glow(charge * 0.25 + pulse * 0.25));
    }
    ctx.restore();

    if (!lit) {                       // dark and dull when off, as before
      ctx.globalAlpha = dim ? 0.55 : 0.45;
      R(ctx, 0, 0, GUN.w, GUN.h, '#0b0f18');
    }
    ctx.restore();
  }

  // ── THE SHOTS ─────────────────────────────────────────────
  /* Drawn in the shot's own frame: x along its flight, 0 at its head's
     centre. `t` is the game clock (for flicker); `age` how long it has
     been flying (for the trail to grow in). */

  const SHOT = {
    laser:   { len: 22, col: '#ff2d44', core: '#ffe0e4' },
    heavy:   { len: 30, col: '#ff3a20', core: '#fff2d0' },
    ion:     { r: 5,   col: '#6a8cff', core: '#e8f0ff' },
    missile: { col: '#c8ccd4', nose: '#ff5a3c' },
    torpedo: { col: '#3a4a56', head: '#4dd8c0' },
    cannon:  { col: '#ff7c20', core: '#fff4d0' },
    flak:    { col: '#ffd780' },
  };

  /** Which look a projectile wears: a heavy laser has its own. */
  function shotKind(type, defKey) {
    if (defKey === 'laser_heavy' || type === 'laser_heavy') return 'heavy';
    return SHOT[type] ? type : 'laser';
  }

  /** Which blast a projectile makes when it lands on a hull. */
  function hitKind(type, defKey) {
    if (type === 'asteroid') return 'cannon';
    if (type === 'beam') return 'laser';
    return HIT_OF[shotKind(type, defKey)] || 'laser';
  }

  function shot(ctx, kind, x, y, angle, t = 0, age = 1) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle);
    const trail = Math.min(1, age * 6);
    switch (kind) {
      case 'laser':
      case 'heavy': {
        const S = SHOT[kind], L = S.len, hw = kind === 'heavy' ? 3 : 2;
        const pill = (x0, y0, w0, h0) => { ctx.beginPath(); ctx.roundRect(x0, y0, w0, h0, h0 / 2); ctx.fill(); };
        // a tail that thins out behind the bolt
        const tl = ctx.createLinearGradient(-L - 26, 0, -L + 2, 0);
        tl.addColorStop(0, hexA(S.col, 0)); tl.addColorStop(1, hexA(S.col, 0.65 * trail));
        ctx.fillStyle = tl; ctx.fillRect(-L - 26, -1, 28, 2);
        const glowA = kind === 'heavy' ? 0.22 + 0.12 * Math.sin(t * 30) : 0.2;
        ctx.globalAlpha = glowA; ctx.fillStyle = S.col; pill(-L - 4, -hw - 4, L + 8, hw * 2 + 8);
        ctx.globalAlpha = 0.45; pill(-L - 1, -hw - 1, L + 2, hw * 2 + 2);
        ctx.globalAlpha = 1; pill(-L, -hw, L, hw * 2);
        ctx.fillStyle = S.core; pill(-L * 0.8, -hw + 1, L * 0.8 + 1, hw * 2 - 2);
        ctx.fillStyle = '#ffffff'; pill(-6, -1, 7, 2);
        break;
      }
      case 'ion': {
        const S = SHOT.ion;
        for (let m = 1; m <= 4; m++) {                            // motes left behind
          ctx.globalAlpha = (0.5 - m * 0.1) * trail;
          const my = Math.round(Math.sin(t * 12 + m * 1.7) * 2);
          R(ctx, -6 - m * 5, my, 2, 2, S.col);
        }
        ctx.globalAlpha = 0.25; ctx.fillStyle = S.col;
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(0, 0, S.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = S.core; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
        for (let s = 0; s < 3; s++) {                             // the spinning sparks
          const a = t * 10 + s * 2.094;
          R(ctx, Math.round(Math.cos(a) * 7) - 1, Math.round(Math.sin(a) * 7) - 1, 2, 2, '#e8f0ff');
        }
        break;
      }
      case 'missile': {
        const S = SHOT.missile, fl = 4 + Math.round((Math.sin(t * 47) + 1) * 1.5);
        for (let p = 1; p <= 4; p++) {                            // smoke it leaves
          ctx.globalAlpha = (0.35 - p * 0.07) * trail; ctx.fillStyle = '#8a929e';
          ctx.beginPath(); ctx.arc(-12 - p * 7, Math.sin(p * 2.3 + t * 3) * 1.5, 2 + p * 0.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        R(ctx, -9 - fl, -1, fl, 2, '#ff9a20'); R(ctx, -9 - Math.ceil(fl / 2), -1, Math.ceil(fl / 2), 2, '#fff0a0');
        R(ctx, -8, -3, 3, 1, '#1d232e'); R(ctx, -8, 2, 3, 1, '#1d232e');      // fins
        R(ctx, -9, -2, 13, 4, '#1d232e');
        R(ctx, -8, -1, 12, 2, S.col); R(ctx, -8, -1, 12, 1, '#eef0f4');
        R(ctx, 4, -2, 2, 4, S.nose); R(ctx, 6, -1, 1, 2, S.nose);
        break;
      }
      case 'torpedo': {
        const S = SHOT.torpedo;
        for (let p = 1; p <= 5; p++) {                            // bubbles of plasma
          ctx.globalAlpha = (0.5 - p * 0.08) * trail; ctx.strokeStyle = S.head; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(-16 - p * 6, Math.sin(p * 1.9 + t * 4) * 2, 1.5 + p * 0.4, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 40);
        R(ctx, -19, -2, 6, 4, '#bff8ff');
        ctx.globalAlpha = 1;
        R(ctx, -14, -4, 24, 8, '#1d232e');
        R(ctx, -13, -3, 22, 6, S.col); R(ctx, -13, -3, 22, 1, '#6a7c8a');
        R(ctx, -3, -3, 2, 6, S.head);
        R(ctx, 9, -3, 3, 6, S.head); R(ctx, 12, -2, 1, 4, S.head); R(ctx, 10, -2, 1, 1, '#e0fff8');
        R(ctx, -14, -6, 4, 2, '#1d232e'); R(ctx, -14, 4, 4, 2, '#1d232e');
        break;
      }
      case 'cannon': {
        const S = SHOT.cannon;
        const g = ctx.createLinearGradient(-28, 0, 0, 0);
        g.addColorStop(0, hexA(S.col, 0)); g.addColorStop(1, hexA(S.col, 0.75 * trail));
        ctx.fillStyle = g; ctx.fillRect(-28, -1, 26, 2);
        ctx.globalAlpha = 0.3; ctx.fillStyle = S.col;
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        R(ctx, -4, -3, 7, 6, '#1d232e'); R(ctx, -3, -2, 6, 4, S.col); R(ctx, -2, -1, 4, 2, S.core);
        break;
      }
      case 'flak': {
        ctx.globalAlpha = 0.6 * trail; R(ctx, -12, -1, 10, 1, SHOT.flak.col);
        ctx.globalAlpha = 1;
        R(ctx, -2, -2, 4, 4, '#1d232e'); R(ctx, -1, -1, 3, 2, SHOT.flak.col);
        break;
      }
    }
    ctx.restore();
  }

  // ── THE HITS ──────────────────────────────────────────────
  /* An impact is painted from its AGE alone. Each kind has a lifetime;
     past it, `impact` returns false and the effect can be dropped. */

  const LIFE = {
    laser: 0.35, heavy: 0.5, ion: 0.5, missile: 0.75, torpedo: 1.0, cannon: 0.8,
    flak: 0.55, shield: 0.6, armour: 0.3, scorch: 6, muzzle: 0.14, miss: 0.4,
  };
  /** Which blast a shot of this kind makes when it lands on a hull. */
  const HIT_OF = { laser: 'laser', heavy: 'heavy', ion: 'ion', missile: 'missile',
                   torpedo: 'torpedo', cannon: 'cannon', flak: 'flak', asteroid: 'cannon', beam: 'laser' };

  function sparks(ctx, x, y, a, seed, n, reach, col, len = 3) {
    for (let i = 0; i < n; i++) {
      const ang = rnd(seed, i) * Math.PI * 2, sp = 0.5 + rnd(seed, i + 50) * 0.5;
      const d = reach * sp * Math.sqrt(a);
      const px = x + Math.cos(ang) * d, py = y + Math.sin(ang) * d;
      ctx.globalAlpha = Math.max(0, 1 - a * 1.1);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(px - Math.cos(ang) * len * (1 - a), py - Math.sin(ang) * len * (1 - a)); ctx.stroke();
    }
  }
  function disc(ctx, x, y, r, col, alpha) {
    if (r <= 0 || alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha); ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  function ring(ctx, x, y, r, col, alpha, lw = 1) {
    if (r <= 0 || alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha); ctx.strokeStyle = col; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }
  /** A ball of fire: white, yellow, orange, red, then smoke. */
  function fireball(ctx, x, y, a, size, seed) {
    disc(ctx, x, y, size * (0.6 + a * 0.9), '#2a2e38', (1 - a) * 0.7);          // smoke behind
    for (let i = 0; i < 5; i++) {
      const ang = rnd(seed, i + 7) * Math.PI * 2, d = size * 0.45 * rnd(seed, i + 17) * (0.4 + a);
      const r = size * (0.35 + rnd(seed, i + 27) * 0.3) * (1 - a * 0.6);
      const col = a < 0.25 ? '#ffd24a' : a < 0.5 ? '#ff9a20' : a < 0.75 ? '#e0441c' : '#5a3a30';
      disc(ctx, x + Math.cos(ang) * d, y + Math.sin(ang) * d, r, col, 1 - a * 0.9);
    }
    disc(ctx, x, y, size * 0.4 * (1 - a * 1.6), '#fff4c0', 1 - a * 2);
  }
  /** Bits of plate thrown out of a blast. */
  function debris(ctx, x, y, a, seed, n, reach) {
    for (let i = 0; i < n; i++) {
      const ang = rnd(seed, i + 70) * Math.PI * 2, d = reach * (0.4 + rnd(seed, i + 80) * 0.6) * a;
      ctx.globalAlpha = Math.max(0, 1 - a);
      R(ctx, Math.round(x + Math.cos(ang) * d), Math.round(y + Math.sin(ang) * d + a * a * 8),
        rnd(seed, i + 90) < 0.5 ? 2 : 1, 1, rnd(seed, i + 95) < 0.5 ? '#8a929e' : '#ff9a20');
    }
  }
  /** Jagged lightning from (x,y) outwards; it re-forks every 1/20 s. */
  function arcs(ctx, x, y, a, seed, n, reach, col) {
    const f = Math.floor(a * 20);
    ctx.globalAlpha = Math.max(0, 1 - a); ctx.strokeStyle = col; ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const ang = rnd(seed, i) * Math.PI * 2, len = reach * (0.5 + 0.5 * rnd(seed + f, i + 30));
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 1; s <= 4; s++) {
        const d = len * s / 4, j = (rnd(seed + f, i * 7 + s) - 0.5) * 6;
        ctx.lineTo(x + Math.cos(ang) * d - Math.sin(ang) * j, y + Math.sin(ang) * d + Math.cos(ang) * j);
      }
      ctx.stroke();
    }
  }

  /**
   * Paint one effect at its age. Returns false once it is over.
   * fx: { kind, x, y, seed, col?, dir?, shield?: {cx,cy,rx,ry} }
   */
  function impact(ctx, fx, age) {
    const life = LIFE[fx.kind] ?? 0.5;
    if (age < 0) return true;
    if (age >= life) return false;
    const a = age / life, { x, y } = fx, seed = fx.seed ?? 1;
    ctx.save();
    switch (fx.kind) {
      case 'laser':
      case 'heavy': {
        const big = fx.kind === 'heavy' ? 1.5 : 1, col = fx.kind === 'heavy' ? '#ff3a20' : '#ff2d44';
        disc(ctx, x, y, 7 * big * (1 - a * 2), '#ffffff', 1 - a * 3);
        ring(ctx, x, y, (3 + 14 * a) * big, col, 1 - a, 2);
        disc(ctx, x, y, 4 * big * (1 - a), col, 0.8 - a);
        sparks(ctx, x, y, a, seed, 9, 20 * big, '#ffd0c0');
        break;
      }
      case 'ion': {
        disc(ctx, x, y, 12 * (1 - a * 0.5), '#6a8cff', 0.35 * (1 - a));
        arcs(ctx, x, y, a, seed, 6, 22, '#c8d8ff');
        ring(ctx, x, y, 4 + 18 * a, '#8a9dff', 1 - a, 1);
        disc(ctx, x, y, 3 * (1 - a), '#e8f0ff', 1 - a);
        break;
      }
      case 'missile':
      case 'cannon':
      case 'torpedo': {
        const size = fx.kind === 'torpedo' ? 20 : fx.kind === 'cannon' ? 16 : 13;
        if (age < 0.06) disc(ctx, x, y, size * 1.1, '#ffffff', 1);
        ring(ctx, x, y, 4 + size * 3 * a, fx.kind === 'torpedo' ? '#4dd8c0' : '#ffd9a0', (1 - a) * 0.8, 2);
        fireball(ctx, x, y, a, size, seed);
        if (fx.kind === 'torpedo' && a > 0.2) fireball(ctx, x + 9, y - 5, (a - 0.2) / 0.8, size * 0.6, seed + 3);
        debris(ctx, x, y, a, seed, fx.kind === 'missile' ? 8 : 12, size * 2.6);
        break;
      }
      case 'flak': {
        for (let i = 0; i < 3; i++) {
          const ox = (rnd(seed, i) - 0.5) * 18, oy = (rnd(seed, i + 3) - 0.5) * 14;
          const la = Math.max(0, a - i * 0.12) / (1 - i * 0.12);
          if (la <= 0) continue;
          disc(ctx, x + ox, y + oy, 4 + 6 * la, '#6a707c', (1 - la) * 0.8);
          disc(ctx, x + ox, y + oy, 3 * (1 - la * 2), '#ffd780', 1 - la * 2);
        }
        sparks(ctx, x, y, a, seed, 10, 24, '#ffd780', 2);
        break;
      }
      case 'shield': {
        /* THE BUBBLE TAKES IT (update126): a patch of the shield's
           lattice lights up where the shot struck, and a ripple runs
           off round the bubble both ways. */
        const S = fx.shield;
        if (S) {
          const th = Math.atan2((y - S.cy) / S.ry, (x - S.cx) / S.rx);
          const spread = 0.15 + a * 0.9;
          ctx.globalAlpha = (1 - a) * 0.9; ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(S.cx, S.cy, S.rx, S.ry, 0, th - spread, th + spread); ctx.stroke();
          ctx.globalAlpha = (1 - a) * 0.5; ctx.lineWidth = 5; ctx.strokeStyle = '#4db8ff';
          ctx.beginPath(); ctx.ellipse(S.cx, S.cy, S.rx, S.ry, 0, th - spread * 0.6, th + spread * 0.6); ctx.stroke();
        }
        // the lattice: hexagons round the point, brightest in the middle
        const hs = 5, R0 = 4 + a * 18;
        for (let gy = -3; gy <= 3; gy++) for (let gx = -3; gx <= 3; gx++) {
          const hx = x + gx * hs * 1.5, hy = y + gy * hs * 1.732 + (gx & 1 ? hs * 0.866 : 0);
          const d = Math.hypot(hx - x, hy - y);
          if (d > R0 + 6) continue;
          const al = (1 - a) * Math.max(0, 1 - d / (R0 + 6));
          if (al <= 0.04) continue;
          ctx.globalAlpha = al; ctx.strokeStyle = '#8fd4ff'; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let s = 0; s < 6; s++) {
            const an = s * Math.PI / 3;
            const px = hx + Math.cos(an) * hs * 0.95, py = hy + Math.sin(an) * hs * 0.95;
            s ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.closePath(); ctx.stroke();
        }
        disc(ctx, x, y, 6 * (1 - a * 2), '#ffffff', 1 - a * 2.5);
        sparks(ctx, x, y, a, seed, 6, 14, '#bfe8ff');
        break;
      }
      case 'armour': {
        disc(ctx, x, y, 4 * (1 - a), '#ffffff', 1 - a);
        sparks(ctx, x, y, a, seed, 8, 16, '#e8eef8', 4);
        break;
      }
      case 'scorch': {
        /* A burn on the plate (update126): dark, with embers that cool. */
        const fade = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
        ctx.globalAlpha = 0.4 * fade; ctx.fillStyle = '#0c0a08';
        ctx.beginPath(); ctx.ellipse(x, y, 8 + rnd(seed, 1) * 2, 5 + rnd(seed, 2), rnd(seed, 3), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.75 * fade;
        ctx.beginPath(); ctx.ellipse(x, y, 4 + rnd(seed, 4) * 2, 2.5 + rnd(seed, 5), rnd(seed, 3), 0, Math.PI * 2); ctx.fill();
        const ember = Math.max(0, 1 - age / 1.5);
        for (let i = 0; i < 4; i++) {
          ctx.globalAlpha = ember * (0.5 + 0.5 * rnd(seed, i + 9)) * fade;
          R(ctx, Math.round(x - 3 + rnd(seed, i + 11) * 6), Math.round(y - 2 + rnd(seed, i + 13) * 4), 1, 1,
            i % 2 ? '#ff9a20' : '#ffd24a');
        }
        break;
      }
      case 'muzzle': {
        const col = fx.col || '#ffd780', d = fx.dir || 1;
        disc(ctx, x + d * 3, y, 6 * (1 - a), '#ffffff', 1 - a);
        ctx.globalAlpha = 1 - a; ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + d * 14 * (1 - a * 0.5), y); ctx.lineTo(x, y + 4); ctx.closePath(); ctx.fill();
        R(ctx, x, y - 6, d * 6, 1, col); R(ctx, x, y + 5, d * 6, 1, col);
        break;
      }
      case 'miss': {
        ring(ctx, x, y, 3 + a * 10, '#8fd4ff', (1 - a) * 0.6, 1);
        break;
      }
    }
    ctx.restore();
    return true;
  }

  // ── THE BEAM ──────────────────────────────────────────────
  /** A beam from the emitter to its cut: glow, colour, a white core
   *  that shivers, and a burning point where it bites the plate. */
  function beam(ctx, x0, y0, x1, y1, t = 0, col = '#ff2d6a') {
    ctx.save();
    const w = 1 + 0.5 * Math.sin(t * 50);
    const line = (lw, c, al) => {
      ctx.globalAlpha = al; ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    line(9 + w * 2, col, 0.18);
    line(4 + w, col, 0.75);
    line(1.5, '#ffffff', 0.95);
    disc(ctx, x1, y1, 6 + w * 2, col, 0.45);
    disc(ctx, x1, y1, 3, '#ffffff', 1);
    const f = Math.floor(t * 30);
    for (let i = 0; i < 4; i++) {
      const ang = -Math.PI / 2 + (rnd(f, i) - 0.5) * 2.4, d = 4 + rnd(f, i + 5) * 9;
      R(ctx, Math.round(x1 + Math.cos(ang) * d), Math.round(y1 + Math.sin(ang) * d), 1, 1, i % 2 ? '#ffd780' : '#ffffff');
    }
    ctx.restore();
  }
  /** The burnt line a beam leaves along the hull behind its cut. */
  function beamScar(ctx, x0, y, x1, alpha = 1) {
    if (x1 <= x0) return;
    ctx.save();
    ctx.globalAlpha = 0.5 * alpha; R(ctx, x0, y - 1, x1 - x0, 3, '#14100c');
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(255,90,40,0)'); g.addColorStop(1, 'rgba(255,154,32,0.9)');
    ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.fillRect(x0, y, x1 - x0, 1);
    ctx.restore();
  }

  // ── THE EFFECTS IN PLAY ───────────────────────────────────
  /* Hits, scorches and muzzle flashes live here while they play out.
     The clock is our own (advanced by `update`), so a paused game
     freezes its blasts and the tests can step it. Scorches are the
     UNDER layer — burnt into the plate, below the shots; everything
     else is OVER. */
  const MAX_FX = 160;
  const _fx = [];
  let _clock = 0, _seq = 0;
  function now() { return _clock; }
  function add(fx) {
    if (!fx || !LIFE[fx.kind]) return null;
    fx.born = _clock;
    if (fx.seed == null) fx.seed = (++_seq * 7919) % 100003;
    _fx.push(fx);
    if (_fx.length > MAX_FX) _fx.splice(0, _fx.length - MAX_FX);
    return fx;
  }
  function update(dt) {
    _clock += Math.max(0, dt || 0);
    for (let i = _fx.length - 1; i >= 0; i--) {
      if (_clock - _fx[i].born >= LIFE[_fx[i].kind]) _fx.splice(i, 1);
    }
  }
  function draw(ctx, layer = 'over') {
    for (const fx of _fx) {
      if ((fx.kind === 'scorch') !== (layer === 'under')) continue;
      impact(ctx, fx, _clock - fx.born);
    }
  }
  function clear() { _fx.length = 0; }
  function active() { return _fx.slice(); }

  return {
    now, add, update, draw, clear, active, MAX_FX,
    GUN, STEEL, CARD, STYLE, SHOT, LIFE, HIT_OF,
    styleOf, keyOf, shotKind, hitKind, rnd,
    turret, shot, impact, beam, beamScar,
  };
})();

window.WeaponArt = WeaponArt;
