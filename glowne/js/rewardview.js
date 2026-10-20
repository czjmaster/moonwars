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
    if ((d.fuel ?? 0) > 0) return { kind: 'fuel', badge: `+${d.fuel} He2` };
    if ((d.missiles ?? 0) > 0) return { kind: 'missiles', badge: `+${d.missiles} MSL` };
    if ((d.cc ?? 0) > 0) return { kind: 'cc', badge: `+${d.cc} CC` };
    if ((d.fuel ?? 0) < 0) return { kind: 'fuelBurn', badge: `${d.fuel} He2` };
    if ((d.cc ?? 0) < 0) return { kind: 'paid', badge: `${d.cc} CC` };
    if ((d.karma ?? 0) > 0) return { kind: 'karmaUp', badge: `+${d.karma} KARMA` };
    if ((d.karma ?? 0) < 0) return { kind: 'karmaDown', badge: `${d.karma} KARMA` };
    return { kind: 'nothing' };
  }

  const TINT = {
    crew: '#4db8ff', pet: '#ffd780', upgrade: '#1aff8c', hurt: '#ff5566', burnout: '#ff7c20',
    fuel: '#4dd8c0', fuelBurn: '#ffb020', missiles: '#ffb347', cc: '#ffd700', paid: '#ff9a50',
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
      const anim = (typeof Animation !== 'undefined' && Animation.catAnim)
        ? Animation.catAnim('idle', typeof crewColor === 'function' ? crewColor(pic.rec) : '#3a3a42') : null;
      const fr = anim?.frames?.length ? anim.frames[Math.floor(t * 6) % anim.frames.length] : null;
      if (fr && fr.width) {
        ctx.imageSmoothingEnabled = false;
        const k = 2;
        ctx.drawImage(fr, cx - fr.width * k / 2, cy - fr.height * k / 2 + 6, fr.width * k, fr.height * k);
      } else {
        ctx.fillStyle = '#3a3a42'; ctx.beginPath(); ctx.ellipse?.(cx, cy + 14, 26, 20, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy - 16, 16, 0, Math.PI * 2); ctx.fill();
      }
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

  return { pick, draw, TINT };
})();

if (typeof window !== 'undefined') window.RewardView = RewardView;
