/* ============================================================
   MOON WARS — rewardview.js  (update140)
   The picture in the "what happened" window.

   jj, 20.10: "te img animacje nagród tam dalej brakuje, jest puste".
   Since update106 the event's outcome window had a 160 x 160 frame
   with "— image —" in it, waiting for art. It holds a small living
   picture now, of what the choice ACTUALLY did — read off the ship and
   the run before and after (`diff`), not off what the choice promised:
   a cat that could not be paid for is not drawn coming aboard.

     crew      a new face, lit up as he comes aboard
     pet       the cat, sitting, tail going
     upgrade   the module's icon, its new level filling in
     hurt      somebody hurt: the hull struck, sparks
     burnout   a module burned out: arcs over its icon
     fuel      He2 canisters, the gauge filling
     fuelBurn  the gauge running down, the flare of the burn
     missiles  rounds sliding into the rack
     cc        credits dropping onto the stack
     paid      credits flying off the stack
     karmaUp   a warm light rising        karmaDown  smoke
     nothing   dust drifting past

   Each picture is a pure function of (pic, t). A badge in the corner
   carries the number ("+12 CC", "+2 He2").
   ============================================================ */

'use strict';

const RewardView = (() => {
  /* He2 in LITRES everywhere (update253, jj 22.11: H2 in an event read -1; everything else is litres) */
  const _L = (n) => Math.round(n * (typeof TANKS !== 'undefined' ? TANKS.HE2_L : 10));
  /** Which picture, from what changed. `d` is the diff:
   *  { cc, fuel, missiles, newCrew: [rec], newPets: [rec], levelsUp: [sys],
   *    burned: [sys], hpLost, karma } */
  function pick(d) {
    if (!d) return { kind: 'nothing' };
    if (d.newCrew?.length) return { kind: 'crew', rec: d.newCrew[0], badge: d.newCrew.length > 1 ? `+${d.newCrew.length} CREW` : 'NEW CREW' };
    if (d.newPets?.length) return { kind: 'pet', rec: d.newPets[0], badge: 'ABOARD' };
    if (d.levelsUp?.length) return { kind: 'upgrade', sys: d.levelsUp[0], badge: `LEVEL ${d.levelsUp[0].level}` };
    if ((d.hpLost ?? 0) >= 1) return { kind: 'hurt', badge: `−${Math.round(d.hpLost)} HP` };
    if (d.burned?.length) return { kind: 'burnout', sys: d.burned[0], badge: 'BURNED OUT' };
    if ((d.fuel ?? 0) > 0) return { kind: 'fuel', badge: `+${_L(d.fuel)} L He2` };
    if ((d.air ?? 0) > 0) return { kind: 'air', badge: `+${d.air} L AIR` };
    if ((d.he3 ?? 0) > 0) return { kind: 'he3', badge: `+${d.he3} He-3` };
    if ((d.missiles ?? 0) > 0) return { kind: 'missiles', badge: `+${d.missiles} MSL` };
    if ((d.cc ?? 0) > 0) return { kind: 'cc', badge: `+${d.cc} CC` };
    if ((d.fuel ?? 0) < 0) return { kind: 'fuelBurn', badge: `−${_L(-d.fuel)} L He2` };
    if ((d.air ?? 0) < 0) return { kind: 'airLost', badge: `${d.air} L AIR` };
    if ((d.cc ?? 0) < 0) return { kind: 'paid', badge: `${d.cc} CC` };
    if ((d.karma ?? 0) > 0) return { kind: 'karmaUp', badge: `+${d.karma} KARMA` };
    if ((d.karma ?? 0) < 0) return { kind: 'karmaDown', badge: `${d.karma} KARMA` };
    return { kind: 'nothing' };
  }

  /* EVERY REWARD, NOT THE FIRST (update185, jj 31.10: "nieraz mamy 2
     nagrody, one powinny być uwzględnione, a zawsze obrazek tylko jednej").
     The same order as `pick`; each kind once. Up to MAX_PICS are drawn. */
  const MAX_PICS = 3;
  function pickAll(d) {
    if (!d) return [{ kind: 'nothing' }];
    const out = [];
    const add = (p) => { if (p && !out.some(o => o.kind === p.kind)) out.push(p); };
    if (d.newCrew?.length) add({ kind: 'crew', rec: d.newCrew[0], badge: d.newCrew.length > 1 ? `+${d.newCrew.length} CREW` : 'NEW CREW' });
    if (d.newPets?.length) add({ kind: 'pet', rec: d.newPets[0], badge: 'ABOARD' });
    if (d.levelsUp?.length) add({ kind: 'upgrade', sys: d.levelsUp[0], badge: `LEVEL ${d.levelsUp[0].level}` });
    if ((d.hpLost ?? 0) >= 1) add({ kind: 'hurt', badge: `−${Math.round(d.hpLost)} HP` });
    if (d.burned?.length) add({ kind: 'burnout', sys: d.burned[0], badge: 'BURNED OUT' });
    if ((d.fuel ?? 0) > 0) add({ kind: 'fuel', badge: `+${_L(d.fuel)} L He2` });
    if ((d.air ?? 0) > 0) add({ kind: 'air', badge: `+${d.air} L AIR` });
    if ((d.he3 ?? 0) > 0) add({ kind: 'he3', badge: `+${d.he3} He-3` });
    if ((d.missiles ?? 0) > 0) add({ kind: 'missiles', badge: `+${d.missiles} MSL` });
    if ((d.cc ?? 0) > 0) add({ kind: 'cc', badge: `+${d.cc} CC` });
    if ((d.fuel ?? 0) < 0) add({ kind: 'fuelBurn', badge: `−${_L(-d.fuel)} L He2` });
    if ((d.air ?? 0) < 0) add({ kind: 'airLost', badge: `${d.air} L AIR` });
    if ((d.cc ?? 0) < 0) add({ kind: 'paid', badge: `${d.cc} CC` });
    if ((d.karma ?? 0) > 0) add({ kind: 'karmaUp', badge: `+${d.karma} KARMA` });
    if ((d.karma ?? 0) < 0) add({ kind: 'karmaDown', badge: `${d.karma} KARMA` });
    return out.length ? out : [{ kind: 'nothing' }];
  }

  /** Several pictures in one frame, stacked: each its own strip of A. */
  function drawAll(ctx, pics, A, t = 0) {
    const list = (pics ?? []).slice(0, MAX_PICS);
    if (list.length <= 1) return [draw(ctx, list[0] ?? { kind: 'nothing' }, A, t)];
    const gap = 4, h = Math.floor((A.h - gap * (list.length - 1)) / list.length);
    return list.map((p, i) => draw(ctx, p, { x: A.x, y: A.y + i * (h + gap), w: A.w, h }, t));
  }

  const TINT = {
    crew: '#4db8ff', pet: '#ffd780', upgrade: '#1aff8c', hurt: '#ff5566', burnout: '#ff7c20',
    fuel: '#4dd8c0', fuelBurn: '#ffb020', air: '#8fe4ff', he3: '#cfe4ff', airLost: '#ffb020', missiles: '#ffb347', cc: '#ffd700', paid: '#ff9a50',
    gun: '#ff7c20', crewOffer: '#4db8ff',
    karmaUp: '#1aff8c', karmaDown: '#ff5566', nothing: '#4a6080',
  };

  function _rng(seed) {
    let s = seed >>> 0 || 7;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  function _bg(ctx, A, kind, t) {
    const g = ctx.createLinearGradient?.(0, A.y, 0, A.y + A.h);
    if (g) { g.addColorStop(0, '#0a1020'); g.addColorStop(1, '#04060c'); ctx.fillStyle = g; }
    else ctx.fillStyle = '#070b14';
    ctx.fillRect(A.x, A.y, A.w, A.h);
    const r = _rng(kind.length * 977 + 13);
    for (let i = 0; i < 30; i++) {
      const x = A.x + ((r() * A.w - t * 3 * (0.3 + r())) % A.w + A.w) % A.w, y = A.y + r() * A.h;
      ctx.globalAlpha = 0.25 + 0.5 * r();
      ctx.fillStyle = '#cfe0ff'; ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    ctx.globalAlpha = 1;
    // a soft glow of the outcome's colour behind the subject
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
    const rg = ctx.createRadialGradient?.(cx, cy, 4, cx, cy, A.w * 0.55);
    if (rg) {
      const c = TINT[kind] || '#4a6080';
      rg.addColorStop(0, c + '30'); rg.addColorStop(1, c + '00');
      ctx.fillStyle = rg; ctx.fillRect(A.x, A.y, A.w, A.h);
    }
  }

  function _coin(ctx, x, y, r, col = '#ffd700') {
    ctx.fillStyle = '#7a5a10'; ctx.beginPath(); ctx.ellipse?.(x, y + 2, r, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse?.(x, y, r, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse?.(x, y, r * 0.6, r * 0.24, 0, 0, Math.PI * 2); ctx.stroke();
  }

  function _canister(ctx, x, y, w, h, fill, col) {
    ctx.fillStyle = '#3a4a5c'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#5a6a80'; ctx.fillRect(x + 2, y - 5, w - 4, 5);
    ctx.fillStyle = '#0a1018'; ctx.fillRect(x + 4, y + 6, w - 8, h - 12);
    const fh = (h - 12) * Math.max(0, Math.min(1, fill));
    ctx.fillStyle = col; ctx.fillRect(x + 4, y + 6 + (h - 12) - fh, w - 8, fh);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 2, y + 2, 2, h - 4);
    ctx.fillStyle = '#c8d8f0'; ctx.font = '8px Share Tech Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText('He2', x + w / 2, y + h + 10);
  }

  /** The painted container for a gas reward (update251): He2 or air, or null when the art is not loaded. */
  function _gasArt(kind) {
    if (typeof Assets === 'undefined' || !Assets.source) return null;
    const n = (kind === 'air' || kind === 'airLost') ? 'item_air_med' : 'item_he2';
    if (Assets.source(n) !== 'file') return null;
    const i = Assets.get(n); return i && i.width ? i : null;
  }

  function _missile(ctx, x, y, len, col) {
    ctx.fillStyle = '#8a94a6'; ctx.fillRect(x, y - 3, len, 6);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + len, y - 3); ctx.lineTo(x + len + 8, y); ctx.lineTo(x + len, y + 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a6476'; ctx.fillRect(x - 4, y - 6, 6, 3); ctx.fillRect(x - 4, y + 3, 6, 3);
    ctx.fillStyle = '#ff5566'; ctx.fillRect(x + len * 0.55, y - 3, 3, 6);
  }

  /** Paint `pic` (from `pick`) into the frame A at time t. */
  function draw(ctx, pic, A, t = 0) {
    const kind = pic?.kind ?? 'nothing';
    const col = TINT[kind] || '#4a6080';
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h); ctx.clip();
    _bg(ctx, A, kind, t);

    if (kind === 'cc' || kind === 'paid') {
      const n = 6;
      for (let i = 0; i < n; i++) _coin(ctx, cx, cy + 40 - i * 7, 26);
      const r = _rng(31);
      for (let i = 0; i < 5; i++) {
        const ph = ((t * 0.7 + i / 5) % 1);
        const x = cx - 40 + r() * 80;
        const y = kind === 'cc' ? A.y - 10 + ph * (cy + 40 - n * 7 - A.y + 10) : cy + 40 - n * 7 - ph * 90;
        ctx.globalAlpha = kind === 'cc' ? 1 : 1 - ph;
        _coin(ctx, kind === 'cc' ? x + (cx - x) * ph : x + (x - cx) * ph, y, 9, kind === 'paid' ? '#e0a050' : '#ffd700');
      }
      ctx.globalAlpha = 1;
      if (kind === 'cc' && Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = '#fff6c0'; ctx.fillRect(cx + 14, cy - 8, 2, 6); ctx.fillRect(cx + 12, cy - 6, 6, 2); }
    } else if ((kind === 'fuel' || kind === 'fuelBurn' || kind === 'air' || kind === 'airLost') && _gasArt(kind)) {
      /* THE CONTAINERS AS THEY ARE PAINTED (update251, jj 21.11: „w info, jak dostaję tlen albo He2, nie pokazuje
         obrazka; tak samo jak dajemy — jest stara grafika He2, powinna być nowa"): the He2 or the air container
         from art/, bobbing — sliding in for a gain, out and dimming for a loss. */
      const img = _gasArt(kind), gain = kind === 'fuel' || kind === 'air';
      const w = Math.min(A.w - 24, 132), h = w * img.height / img.width;
      const ph = (t * 0.5) % 1, bob = Math.sin(t * 2) * 3;
      ctx.globalAlpha = gain ? 1 : 1 - 0.5 * ph;
      ctx.drawImage(img, cx - w / 2 + (gain ? 0 : ph * 24), cy - h / 2 - 6 + bob, w, h);
      ctx.globalAlpha = 1;
      const r = _rng(5);
      for (let i = 0; i < 6; i++) {
        const q = (t * 0.9 + r()) % 1;
        ctx.fillStyle = gain ? `rgba(200,255,240,${0.7 * (1 - q)})` : `rgba(255,${150 + Math.round(r() * 80)},60,${1 - q})`;
        ctx.fillRect(cx - w / 2 + r() * w, cy - h / 2 - 6 - q * 30, 2, 2);
      }
    } else if (kind === 'he3' && typeof LootScreen !== 'undefined' && LootScreen.drawCargoItem && typeof CargoItem !== 'undefined') {
      /* HE-3 ORE (update254): the crates as they lie in a hold, three of them, glinting */
      const it = new CargoItem('he3_ore'), sc = 2.2, C = (LootScreen.CELL ?? 36) * sc;
      [[-C * 0.9, 6], [0, -10], [C * 0.9, 6]].forEach(([dx, dy], i) => {
        ctx.save(); ctx.translate(cx + dx, cy + dy + Math.sin(t * 2 + i) * 2); ctx.scale(sc, sc);
        try { LootScreen.drawCargoItem(ctx, it, -C / sc / 2, -C / sc / 2, 1, false, false); } catch (e) { /* a picture only */ }
        ctx.restore();
      });
      if (Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = '#e8f6ff'; ctx.fillRect(cx + 10, cy - 24, 2, 6); ctx.fillRect(cx + 8, cy - 22, 6, 2); }
    } else if (kind === 'gun' && pic.key && typeof Renderer !== 'undefined' && Renderer.drawWeaponIcon) {
      Renderer.drawWeaponIcon(ctx, pic.key, cx - 54, cy - 30, 108, 44, {});
      ctx.fillStyle = '#c8d8f0'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(String(pic.label ?? '').slice(0, 18), cx, cy + 34);
    } else if (kind === 'crewOffer') {
      const s = 72 + Math.sin(t * 2) * 2;                                  // somebody new: a lit silhouette
      ctx.fillStyle = 'rgba(77,184,255,0.25)';
      ctx.beginPath(); ctx.arc(cx, cy - 14, s * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse?.(cx, cy + 34, s * 0.46, s * 0.32, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy - 14, s * 0.36, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col; ctx.font = 'bold 22px Orbitron, monospace'; ctx.textAlign = 'center'; ctx.fillText('?', cx, cy - 6);
    } else if (kind === 'fuel' || kind === 'fuelBurn') {
      const f = kind === 'fuel' ? 0.25 + 0.75 * ((t * 0.35) % 1) : 1 - 0.85 * ((t * 0.35) % 1);
      _canister(ctx, cx - 44, cy - 34, 26, 64, kind === 'fuel' ? 1 : 0.5, '#4dd8c0');
      _canister(ctx, cx - 13, cy - 40, 26, 72, f, kind === 'fuel' ? '#4dd8c0' : '#ffb020');
      _canister(ctx, cx + 18, cy - 34, 26, 64, kind === 'fuel' ? 0.8 : 0.3, '#4dd8c0');
      const r = _rng(5);
      for (let i = 0; i < 6; i++) {                     // bubbles / the flare
        const ph = (t * 0.9 + r()) % 1;
        if (kind === 'fuel') { ctx.fillStyle = 'rgba(200,255,240,0.6)'; ctx.fillRect(cx - 8 + r() * 14, cy + 26 - ph * 50, 2, 2); }
        else { ctx.fillStyle = `rgba(255,${150 + Math.round(r() * 80)},60,${1 - ph})`; ctx.fillRect(cx - 4 + (r() - 0.5) * 20, A.y + A.h - 6 - ph * 22, 3, 3); }
      }
    } else if (kind === 'missiles') {
      for (let i = 0; i < 3; i++) {
        const slide = Math.min(1, Math.max(0, (t * 0.8 - i * 0.25) % 2));
        const x = A.x - 60 + slide * (cx - 30 - (A.x - 60));
        _missile(ctx, x, cy - 26 + i * 26, 56, '#ffb347');
      }
      ctx.strokeStyle = '#5a6476'; ctx.lineWidth = 2;
      ctx.strokeRect(cx - 40, cy - 40, 84, 80);
    } else if (kind === 'crew' && pic.rec && typeof CrewArt !== 'undefined') {
      const s = 96, x = cx - s / 2, y = cy - s / 2 - 4;
      const glow = 0.5 + 0.5 * Math.sin(t * 2);
      ctx.strokeStyle = col; ctx.globalAlpha = 0.4 + 0.4 * glow; ctx.lineWidth = 2;
      ctx.strokeRect(x - 4, y - 4, s + 8, s + 8); ctx.globalAlpha = 1;
      const face = { ...CrewArt.faceOf(CrewArt.seedOf(pic.rec), pic.rec.race ?? null) };
      face.blink = ((t + 0.4) % 3.4) < 0.12;
      ctx.imageSmoothingEnabled = false;
      const colour = typeof crewColor === 'function' ? crewColor(pic.rec) : '#4db8ff';
      const paint = () => CrewArt.portrait(ctx, x, y, colour, face, s);
      if (typeof Palette !== 'undefined' && Palette.raw) Palette.raw(paint); else paint();
      ctx.fillStyle = '#c8d8f0'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(String(pic.rec.name ?? '').slice(0, 16), cx, y + s + 16);
    } else if (kind === 'pet' && pic.rec) {
      /* A CAT, NOT THREE BALLS (update264, jj 26.11: „kot wygląda jak robak z 3 kulek i ogon"): the deck's 64 px sprite —
         mostly its helmet — blown up was a bubble, a blob and a tail. The card draws a cat of its own, sitting. */
      drawCatPortrait(ctx, cx, cy + 8, 1, pic.rec.color ?? (typeof crewColor === 'function' ? crewColor(pic.rec) : '#3a3a42'), t);
      ctx.fillStyle = '#c8d8f0'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(String(pic.rec.name ?? '').slice(0, 16), cx, A.y + A.h - 26);
    } else if (kind === 'upgrade' || kind === 'burnout') {
      const type = pic.sys?.type ?? 'shields';
      if (typeof Renderer !== 'undefined' && Renderer.drawSystemIcon) Renderer.drawSystemIcon(ctx, type, cx, cy - 12, 56, kind === 'upgrade' ? '#c8ffe0' : '#ffb080');
      const lv = pic.sys?.level ?? 1, max = Math.min(8, pic.sys?.def?.maxLevel ?? 8);
      for (let i = 0; i < max; i++) {
        const x = cx - max * 7 + i * 14, y = cy + 32;
        const on = kind === 'upgrade' ? i < lv - 1 || (i === lv - 1 && (t % 1.4) > 0.5) : i < lv;
        ctx.fillStyle = on ? col : '#1e2d4a'; ctx.fillRect(x, y, 11, 6);
      }
      if (kind === 'upgrade') {
        const up = (t * 40) % 40;
        ctx.globalAlpha = 1 - up / 40; ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(cx + 40, cy - 10 - up); ctx.lineTo(cx + 48, cy - up); ctx.lineTo(cx + 32, cy - up); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      } else if ((t % 0.9) < 0.35) {
        ctx.strokeStyle = '#ffe0a0'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - 30, cy - 40); ctx.lineTo(cx - 10, cy - 20); ctx.lineTo(cx - 22, cy - 12); ctx.lineTo(cx + 4, cy + 8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 34, cy - 36); ctx.lineTo(cx + 18, cy - 18); ctx.lineTo(cx + 28, cy - 10); ctx.stroke();
      }
    } else if (kind === 'hurt') {
      // a hull plate, struck: rocks streak in, sparks and a red flash
      ctx.fillStyle = '#4a5468'; ctx.fillRect(A.x, cy + 18, A.w, A.h);
      ctx.fillStyle = '#3a4252'; for (let x = A.x; x < A.x + A.w; x += 24) ctx.fillRect(x, cy + 18, 1, A.h);
      const r = _rng(17);
      for (let i = 0; i < 4; i++) {
        const ph = (t * 0.8 + i / 4) % 1;
        const sx = A.x + A.w + 10 - ph * (A.w * 0.9), sy = A.y + 10 + ph * (cy + 8 - A.y);
        ctx.strokeStyle = `rgba(255,200,140,${0.8 - ph * 0.5})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 16, sy - 8); ctx.stroke();
        if (ph > 0.9) for (let k = 0; k < 6; k++) { ctx.fillStyle = '#ffd780'; ctx.fillRect(sx + (r() - 0.5) * 20, cy + 16 - r() * 14, 2, 2); }
      }
      if ((t % 1.2) < 0.15) { ctx.fillStyle = 'rgba(255,60,80,0.25)'; ctx.fillRect(A.x, A.y, A.w, A.h); }
      ctx.strokeStyle = '#ff5566'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 10, cy - 20); ctx.lineTo(cx + 10, cy - 20); ctx.moveTo(cx, cy - 30); ctx.lineTo(cx, cy - 10); ctx.stroke();
    } else if (kind === 'karmaUp' || kind === 'karmaDown') {
      const r = _rng(kind === 'karmaUp' ? 3 : 9);
      for (let i = 0; i < 18; i++) {
        const ph = (t * 0.4 + r()) % 1;
        const x = cx + (r() - 0.5) * 90, y = A.y + A.h - ph * A.h;
        const sz = kind === 'karmaUp' ? 2 + r() * 2 : 8 + ph * 18;
        ctx.globalAlpha = kind === 'karmaUp' ? (1 - ph) : 0.25 * (1 - ph);
        ctx.fillStyle = kind === 'karmaUp' ? '#c8ffd8' : '#5a2a30';
        ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 24 + Math.sin(t * 2) * 2, 0, Math.PI * 2); ctx.stroke();
    } else {
      // nothing: dust drifting past
      const r = _rng(77);
      for (let i = 0; i < 14; i++) {
        const x = A.x + ((r() * A.w + t * (6 + r() * 10)) % A.w), y = A.y + r() * A.h;
        ctx.fillStyle = 'rgba(140,160,190,0.35)'; ctx.fillRect(x, y, 2, 1);
      }
    }
    ctx.restore();

    // the frame and the badge
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.strokeRect(A.x + 0.5, A.y + 0.5, A.w - 1, A.h - 1);
    if (pic?.badge) {
      ctx.font = 'bold 11px Share Tech Mono, monospace';
      const bw = Math.min(A.w - 12, ctx.measureText(pic.badge).width + 12);
      ctx.fillStyle = 'rgba(6,9,16,0.9)'; ctx.fillRect(A.x + 6, A.y + A.h - 22, bw, 16);
      ctx.strokeStyle = col; ctx.strokeRect(A.x + 6.5, A.y + A.h - 21.5, bw - 1, 15);
      ctx.fillStyle = col; ctx.textAlign = 'left';
      ctx.fillText(pic.badge, A.x + 12, A.y + A.h - 10);
    }
    ctx.textAlign = 'left';
    return kind;
  }

  /* ONE REWARD OF SEVERAL, AS A PICTURE (update251): what a reward key of an event's choice would look like — the
     cards of the pick (game.js `_drawRewardPick`). `v` is the choice's amount or key. */
  function offer(k, v) {
    const n = Array.isArray(v) ? `${v[0]}–${v[1]}` : v;
    switch (k) {
      case 'scrap': return { kind: 'cc', badge: `+${n} CC` };
      case 'missiles': return { kind: 'missiles', badge: `+${n} MSL` };
      case 'fuel': return { kind: 'fuel', badge: `+${Array.isArray(v) ? `${_L(v[0])}–${_L(v[1])}` : _L(v)} L He2` };
      case 'tankFuel': return { kind: 'fuel', badge: 'He2 TANK' };
      case 'air': return { kind: 'air', badge: `+${n} L AIR` };
      case 'he3': return { kind: 'he3', badge: `+${n} He-3` };
      case 'tankAir': return { kind: 'air', badge: 'AIR TANK' };
      case 'weaponReward': return { kind: 'gun', key: v, label: (typeof WEAPON_DEFS !== 'undefined' && WEAPON_DEFS[v]?.label) || 'a gun', badge: 'WEAPON' };
      case 'system_upgrade': return { kind: 'upgrade', sys: { type: v, level: 2, def: { maxLevel: 4 } }, badge: `${String(v).toUpperCase()} +1` };
      case 'crew': return { kind: 'crewOffer', badge: 'NEW CREW' };
      case 'pet': return { kind: 'pet', rec: { name: 'Cat', isPet: true, color: '#d9893a' }, badge: 'A CAT' };
      default: return { kind: 'nothing', badge: String(k).toUpperCase() };
    }
  }

  return { pick, pickAll, draw, drawAll, offer, TINT, MAX_PICS, drawCatPortrait };

  /** A sitting cat, three-quarter, ~110 px tall at k = 1 — her tail sways, she blinks. `col` her coat. */
  function drawCatPortrait(ctx, cx, cy, k, col, t) {
    const shade = (c, f) => { const n = parseInt(String(c).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
      const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
      return `rgb(${ch(n >> 16 & 255)},${ch(n >> 8 & 255)},${ch(n & 255)})`; };
    const base = col, dark = shade(col, -0.45), light = shade(col, 0.35), chest = shade(col, 0.6);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k, k);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    /* the shadow under her */
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(4, 46, 40, 7, 0, 0, Math.PI * 2); ctx.fill();
    /* the tail, round the haunch, its tip swaying */
    const sw = Math.sin(t * 1.8) * 7;
    ctx.strokeStyle = dark; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(22, 40); ctx.bezierCurveTo(46, 44, 50, 20, 44 + sw * 0.4, 4); ctx.quadraticCurveTo(42 + sw, -6, 36 + sw, -8); ctx.stroke();
    ctx.strokeStyle = base; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(22, 40); ctx.bezierCurveTo(46, 44, 50, 20, 44 + sw * 0.4, 4); ctx.quadraticCurveTo(42 + sw, -6, 36 + sw, -8); ctx.stroke();
    /* the body: haunch at the back, chest up front */
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.moveTo(-14, -6); ctx.bezierCurveTo(-26, 8, -30, 30, -24, 44); ctx.lineTo(28, 44);
    ctx.bezierCurveTo(36, 30, 30, 6, 12, -6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = dark;                                              // the haunch's shading
    ctx.beginPath(); ctx.ellipse(18, 30, 12, 15, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(16, 29, 10, 13, -0.3, 0, Math.PI * 2); ctx.fill();
    /* the chest */
    ctx.fillStyle = chest;
    ctx.beginPath(); ctx.moveTo(-10, 2); ctx.quadraticCurveTo(-2, 30, -6, 38); ctx.quadraticCurveTo(0, 32, 4, 2); ctx.closePath(); ctx.fill();
    /* the front legs and paws */
    [[-12, 0], [-1, 1]].forEach(([lx, d]) => {
      ctx.fillStyle = d ? light : base;
      ctx.beginPath(); ctx.roundRect(lx - 4, 18, 8, 26, 4); ctx.fill();
      ctx.fillStyle = chest;
      ctx.beginPath(); ctx.ellipse(lx, 44, 6, 3.4, 0, 0, Math.PI * 2); ctx.fill();
    });
    /* the head */
    const hy = -20, blink = ((t + 0.7) % 3.6) < 0.14, tilt = Math.sin(t * 0.6) * 0.05;
    ctx.save(); ctx.translate(-4, hy); ctx.rotate(tilt);
    [[-1, -11], [1, 9]].forEach(([sd, ex]) => {                       // the ears
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.moveTo(ex - 8 * sd, -8); ctx.lineTo(ex + sd * 1, -26); ctx.lineTo(ex + 7 * sd, -10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e9a0a8';
      ctx.beginPath(); ctx.moveTo(ex - 4 * sd, -10); ctx.lineTo(ex + sd * 1, -21); ctx.lineTo(ex + 4 * sd, -11); ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(0, -2, 19, 16, 0, 0, Math.PI * 2); ctx.fill();   // the skull
    ctx.beginPath(); ctx.ellipse(0, 5, 21, 11, 0, 0, Math.PI * 2); ctx.fill();    // the cheeks
    ctx.fillStyle = chest;
    ctx.beginPath(); ctx.ellipse(0, 8, 9, 6, 0, 0, Math.PI * 2); ctx.fill();      // the muzzle
    /* the eyes: green, almond, a slit — or shut */
    [-8, 8].forEach(ex => {
      if (blink) { ctx.strokeStyle = '#1a1a20'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(ex - 4.5, -2); ctx.quadraticCurveTo(ex, 0.5, ex + 4.5, -2); ctx.stroke(); return; }
      ctx.fillStyle = '#9dff6a';
      ctx.beginPath(); ctx.ellipse(ex, -2, 5, 3.6, ex < 0 ? 0.15 : -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b0e10';
      ctx.beginPath(); ctx.ellipse(ex, -2, 1.1, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(ex + 1.2, -4.2, 1.4, 1.4);
    });
    /* the nose, the mouth, the whiskers */
    ctx.fillStyle = '#e07a8a';
    ctx.beginPath(); ctx.moveTo(-2.6, 4); ctx.lineTo(2.6, 4); ctx.lineTo(0, 6.6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,26,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 6.6); ctx.lineTo(0, 8.5); ctx.quadraticCurveTo(-2.5, 10.5, -4.5, 9); ctx.moveTo(0, 8.5); ctx.quadraticCurveTo(2.5, 10.5, 4.5, 9); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,240,250,0.7)'; ctx.lineWidth = 0.8;
    [[-1, 0], [-1, 2.5], [1, 0], [1, 2.5]].forEach(([sd, dy]) => {
      ctx.beginPath(); ctx.moveTo(sd * 7, 7 + dy); ctx.quadraticCurveTo(sd * 16, 5 + dy * 1.5, sd * 26, 6 + dy * 2.2); ctx.stroke();
    });
    ctx.restore();
    ctx.restore();
  }
})();

if (typeof window !== 'undefined') window.RewardView = RewardView;
