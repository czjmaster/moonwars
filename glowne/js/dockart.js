/* ============================================================
   MOON WARS — dockart.js  (update148)
   The ship at home: moored in the base's bay on the moon.

   jj, 20.10: "fajnie by było jak mamy menu SHIP i LOADOUT miało grafikę
   w tle tak, jakby statek był zadokowany do stacji na księżycu".

   Two layers, both drawn UNDER the hull:
     · the bay — the sky over the moon, a planet, the grey horizon with
       its craters and a few lights of the base, the mouth of the hangar
       with floodlights. Painted ONCE per size, at half resolution and
       doubled, the way the port is.
     · the moorings — worked out from THIS hull's own outline (its plate,
       its nacelles, its bow, its guns), so every ship sits right: the
       cradle's two arms up under her keel, the gantry beam overhead with
       its umbilicals down to her stern (clear of her guns), the boarding
       tube to her bow, blinking lights.

       DockArt.draw(ctx, rect, ship)
   A picture only: nothing here touches the ship.
   ============================================================ */

'use strict';

const DockArt = (() => {
  const _cache = new Map();          // `${w}x${h}` → canvas

  function _canvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function _rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** The bay, painted at half size for a `w` × `h` stage. */
  function bay(w, h) {
    const key = `${w | 0}x${h | 0}`;
    if (_cache.has(key)) return _cache.get(key);
    const PW = Math.max(16, Math.ceil(w / 2)), PH = Math.max(16, Math.ceil(h / 2));
    const c = _canvas(PW, PH);
    if (!c) return null;
    const g = c.getContext('2d'), rnd = _rng(0xb4e + PW * 31 + PH);
    const R = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, ww | 0, hh | 0); };
    const ground = PH * 0.8;
    // the sky
    const sky = g.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, '#02030a'); sky.addColorStop(1, '#0a0f24');
    g.fillStyle = sky; g.fillRect(0, 0, PW, ground);
    // sparse and dim: the ship is the picture, the sky is behind it
    for (let i = 0; i < PW * PH / 110; i++) { const v = rnd(); R(rnd() * PW, rnd() * ground, 1, 1, v > 0.95 ? '#c8d4f0' : v > 0.7 ? '#5a6a98' : '#2a3456'); }
    // the planet, high on the left (the bow is on the right, under the tube)
    const px = PW * 0.18, py = PH * 0.22, pr = Math.min(PW, PH) * 0.13;
    const pg = g.createRadialGradient(px - pr * 0.35, py - pr * 0.3, pr * 0.1, px, py, pr);
    pg.addColorStop(0, '#a9c8f0'); pg.addColorStop(0.55, '#4f7fc0'); pg.addColorStop(1, '#16264a');
    g.fillStyle = pg; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(2,4,12,0.55)'; g.beginPath(); g.arc(px + pr * 0.4, py + pr * 0.25, pr, 0, Math.PI * 2); g.fill();
    // the moon's horizon and its craters
    g.fillStyle = '#3f424c';
    g.beginPath(); g.moveTo(0, ground - 6);
    for (let x = 0; x <= PW; x += 6) g.lineTo(x, ground - 6 + Math.sin(x * 0.05) * 3 + Math.sin(x * 0.17) * 1.5);
    g.lineTo(PW, PH); g.lineTo(0, PH); g.fill();
    g.fillStyle = '#4e515c';
    g.beginPath(); g.moveTo(0, ground + 2);
    for (let x = 0; x <= PW; x += 5) g.lineTo(x, ground + 2 + Math.sin(x * 0.08 + 2) * 2);
    g.lineTo(PW, PH); g.lineTo(0, PH); g.fill();
    for (let i = 0; i < PW / 14; i++) {
      const x = rnd() * PW, y = ground + 4 + rnd() * (PH - ground - 6), r = 2 + rnd() * 5;
      g.fillStyle = '#383a43'; g.beginPath(); g.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI * 2); g.fill();
      R(x - r, y - r * 0.35, r * 2, 1, '#62656f');
    }
    // the base's lights along the horizon
    for (let i = 0; i < PW / 10; i++) R(rnd() * PW, ground - 4 - rnd() * 3, 1, 1, rnd() > 0.5 ? '#ffb24a' : '#ffd890');
    // the mouth of the hangar: a frame of girders, and floodlight cones
    const steel = '#1a2130', lit = '#2c3548';
    R(0, 0, PW, 5, steel); R(0, 5, PW, 1, lit);
    R(0, 0, 6, PH, steel); R(PW - 6, 0, 6, PH, steel); R(6, 0, 1, PH, lit); R(PW - 7, 0, 1, PH, lit);
    for (let y = 10; y < PH; y += 16) { R(0, y, 6, 1, '#11161f'); R(PW - 6, y, 6, 1, '#11161f'); }
    [0.3, 0.7].forEach(f => {
      const x = PW * f;
      R(x - 3, 5, 6, 3, '#3a4458');
      const cone = g.createLinearGradient(0, 8, 0, ground);
      cone.addColorStop(0, 'rgba(200,225,255,0.10)'); cone.addColorStop(1, 'rgba(200,225,255,0)');
      g.fillStyle = cone; g.beginPath(); g.moveTo(x - 2, 8); g.lineTo(x - PW * 0.16, ground); g.lineTo(x + PW * 0.16, ground); g.lineTo(x + 2, 8); g.fill();
    });
    // the apron the cradle stands on
    R(0, PH - 4, PW, 4, '#22262f'); for (let x = 0; x < PW; x += 10) R(x, PH - 4, 5, 1, 'rgba(255,200,60,0.35)');
    _cache.set(key, c);
    if (_cache.size > 8) _cache.delete(_cache.keys().next().value);
    return c;
  }

  /** Where this hull is, in the coordinates it is drawn at. */
  function hullFrame(ship) {
    const g = ship?.hullArtGeometry?.();
    if (!g) return null;
    const parts = [...(g.plate ?? []), ...(g.engines ?? []), ...(g.prows ?? [])];
    if (!parts.length) return null;
    const top = Math.min(...g.plate.map(r => r.y)), bot = Math.max(...g.plate.map(r => r.y + r.h));
    const left = Math.min(...parts.map(r => r.x)), right = Math.max(...parts.map(r => r.x + r.w));
    // the top deck: the bow's tube goes into it
    const deck = g.decks?.[0];
    const guns = (ship.weaponMounts?.() ?? []).map(m => [m.x - 10, m.x + m.w + 10]);
    return { top, bot, left, right, deckY: deck ? deck.y + deck.h / 2 : (top + bot) / 2, guns, faces: ship.isPlayer ? 1 : -1, g };
  }

  /** The bottom of the hull at `x` — where a cradle arm meets her. */
  function keelAt(F, x) {
    const under = F.g.plate.filter(r => r.x <= x && x <= r.x + r.w);
    return under.length ? Math.max(...under.map(r => r.y + r.h)) : F.bot;
  }
  /** The top of the hull at `x` — where an umbilical plugs in. */
  function roofAt(F, x) {
    const over = F.g.plate.filter(r => r.x <= x && x <= r.x + r.w);
    return over.length ? Math.min(...over.map(r => r.y)) : F.top;
  }

  /** Points along the hull for the moorings: the cradle's two arms and
   *  the umbilicals' plugs (never on a gun). For tests, too. */
  function moorings(ship) {
    const F = hullFrame(ship);
    if (!F) return null;
    const span = F.right - F.left;
    const arms = [0.3, 0.7].map(f => {
      const x = F.left + span * f;
      return { x, y: keelAt(F, x) };
    });
    const plugs = [];
    for (const f of [0.12, 0.2, 0.3, 0.4, 0.5]) {
      const x = F.left + span * (F.faces > 0 ? f : 1 - f);
      if (F.guns.some(([a, b]) => x >= a && x <= b)) continue;
      plugs.push({ x, y: roofAt(F, x) });
      if (plugs.length === 2) break;
    }
    const tube = { x: F.faces > 0 ? F.right : F.left, y: F.deckY };
    return { arms, plugs, tube, F };
  }

  function draw(ctx, rect, ship) {
    if (!rect || rect.w < 40 || rect.h < 40) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    const img = bay(rect.w, rect.h);
    if (img) {
      const was = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
      ctx.imageSmoothingEnabled = was;
    }
    const M = ship ? moorings(ship) : null;
    if (M) {
      const ground = rect.y + rect.h * 0.8 + 8;
      // the gantry beam overhead
      const by = rect.y + 14;
      ctx.fillStyle = '#1e2638'; ctx.fillRect(rect.x, by, rect.w, 9);
      ctx.fillStyle = '#3a4660'; ctx.fillRect(rect.x, by, rect.w, 1);
      ctx.fillStyle = '#121824'; ctx.fillRect(rect.x, by + 8, rect.w, 1);
      for (let x = rect.x + 6; x < rect.x + rect.w; x += 22) { ctx.fillStyle = '#2c3548'; ctx.fillRect(x, by + 3, 3, 3); }
      // umbilicals: a cable with a sag, a coupling at the hull
      M.plugs.forEach((p, i) => {
        ctx.strokeStyle = i ? '#2a2216' : '#161e2c'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p.x - 18, by + 9);
        ctx.bezierCurveTo(p.x - 24, (by + p.y) / 2 + 26, p.x - 4, p.y - 26, p.x, p.y - 4); ctx.stroke();
        ctx.strokeStyle = i ? '#ffb020' : '#4db8ff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(p.x - 18, by + 9);
        ctx.bezierCurveTo(p.x - 24, (by + p.y) / 2 + 26, p.x - 4, p.y - 26, p.x, p.y - 4); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#3a4458'; ctx.fillRect(p.x - 5, p.y - 7, 10, 6);
      });
      // the cradle: two arms up from the apron to her keel
      M.arms.forEach(a => {
        const top = a.y + 2, bot = Math.max(top + 6, ground + 40);
        ctx.fillStyle = '#1c2332'; ctx.fillRect(a.x - 7, top + 8, 14, bot - top - 8);
        ctx.fillStyle = '#323c52'; ctx.fillRect(a.x - 7, top + 8, 2, bot - top - 8);
        ctx.fillStyle = '#2a3446'; ctx.fillRect(a.x - 22, top, 44, 8);
        for (let k = 0; k < 44; k += 8) { ctx.fillStyle = k % 16 ? '#1a1a1a' : '#e6b422'; ctx.fillRect(a.x - 22 + k, top + 5, 8, 3); }
        ctx.strokeStyle = '#1c2332'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x - 20, bot); ctx.lineTo(a.x - 6, top + 20); ctx.moveTo(a.x + 20, bot); ctx.lineTo(a.x + 6, top + 20); ctx.stroke();
        ctx.fillStyle = Math.sin(t * 3 + a.x) > 0 ? '#ff3a3a' : '#4a1010'; ctx.fillRect(a.x - 2, top + 12, 4, 3);
      });
      // the boarding tube to her bow
      const T = M.tube, dir = M.F.faces;
      const x0 = T.x + dir * 4, x1 = dir > 0 ? rect.x + rect.w : rect.x;
      const tx = Math.min(x0, x1), tw = Math.abs(x1 - x0);
      if (tw > 6) {
        ctx.fillStyle = '#20283a'; ctx.fillRect(tx, T.y - 9, tw, 18);
        ctx.fillStyle = '#3a4660'; ctx.fillRect(tx, T.y - 9, tw, 2);
        ctx.fillStyle = '#121824'; ctx.fillRect(tx, T.y + 7, tw, 2);
        for (let x = tx + 4; x < tx + tw; x += 9) { ctx.fillStyle = '#161d2b'; ctx.fillRect(x, T.y - 7, 2, 14); }
        for (let x = tx + 8; x < tx + tw; x += 26) { ctx.fillStyle = Math.sin(t * 2 + x * 0.1) > 0.3 ? '#ffcf6a' : '#5a4a2a'; ctx.fillRect(x, T.y - 1, 3, 2); }
        ctx.fillStyle = '#3a4458'; ctx.fillRect(dir > 0 ? x0 - 4 : x0 - 2, T.y - 12, 6, 24);
      }
    }
    ctx.restore();
  }

  return { draw, bay, moorings };
})();

if (typeof window !== 'undefined') window.DockArt = DockArt;
