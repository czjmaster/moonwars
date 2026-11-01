/* ============================================================
   MOON WARS — eva.js  (update187)

   OUT IN THE WRECKAGE: THE JETPACK, THE DEBRIS, THE BODIES.

   jj 31.10: "sterowanie załogantem podczas lotu poza statkiem, mechanika
   lotu musi być w miarę realna, sterowanie odrzutowym plecakiem na W/S/A/D
   i strzałkach; nie za trudne, ale też nie za łatwe" · "po rozwalonym
   statku grafiki rozwalonych części, które trzeba omijać, aby dotrzeć do
   skrzyń" · "skrzynie powinny być większe" · "pojawiają się nieraz ciała
   załogantów, je można przeszukać i znaleźć broń".

   This file is the PHYSICS and the PIECES; game.js keeps the salvage
   round (who goes where, the hatch, the loot window) and calls in here.

     · A man under his own jets has a velocity. Thrust accelerates him,
       nothing stops him but a little drag (a suit's attitude jets damping
       the drift — real space has none, a game needs a touch), and a top
       speed. Burning the jets costs air from his bottle.
     · Debris are torn hull plates: circles for the physics, jagged
       polygons for the eye. A man flying into one bounces off and loses
       most of his speed; the autopilot steers round them.
     · A body drifting in the wreckage is searched like a crate (quicker).
   ============================================================ */

'use strict';

const EVA = {
  THRUST:      170,   // px/s² while a jet burns
  MAX_SPEED:   150,   // px/s
  DRAG:        0.35,  // 1/s — the suit damping the drift
  AIR_PER_SEC: 0.6,   // s of bottle per second of thrust
  BOUNCE:      0.35,  // speed kept after striking a plate
  GRAB_DIST:   20,    // px: close enough to a crate or a body to work it
  GRAB_SPEED:  70,    // px/s: and slow enough
  DOCK_DIST:   22,    // px from the hatch
  CRATE_W:     36, CRATE_H: 26,      // drawn and hit (update187: bigger, was 22×16)
  BODY_CUT:    1.2,   // s to go through a body's pockets
  HURT_SPEED:  12,    // px/s into a plate: below this he only brushes it (update189)
  HURT_BASE:   3,     // a torn edge cuts the suit: hp…
  HURT_PER_SPEED: 0.1,  // …and this much more for every px/s he hit it at
  DEBRIS:      [4, 7],               // plates, by how big she was
  DEBRIS_R:    [16, 34],
};

const Eva = (() => {

  /** Which way the keys push: { x, y } in -1..1. `held` is Input.isHeld. */
  function keyThrust(held) {
    if (typeof held !== 'function') return { x: 0, y: 0 };
    const x = (held('KeyD') || held('ArrowRight') ? 1 : 0) - (held('KeyA') || held('ArrowLeft') ? 1 : 0);
    const y = (held('KeyS') || held('ArrowDown') ? 1 : 0) - (held('KeyW') || held('ArrowUp') ? 1 : 0);
    return { x, y };
  }

  /**
   * One step of a man under his own jets. `m` carries x, y, vx, vy; `push`
   * is keyThrust; `debris` the plates; `bounds` the box he may not leave.
   * Returns { thrusting, hit } — hit: the plate he struck this step, or null.
   */
  function fly(m, push, dt, debris = [], bounds = null) {
    m.vx = m.vx ?? 0; m.vy = m.vy ?? 0;
    const len = Math.hypot(push.x, push.y);
    const thrusting = len > 0;
    if (thrusting) {
      m.vx += push.x / len * EVA.THRUST * dt;
      m.vy += push.y / len * EVA.THRUST * dt;
    }
    const k = Math.max(0, 1 - EVA.DRAG * dt);
    m.vx *= k; m.vy *= k;
    const sp = Math.hypot(m.vx, m.vy);
    if (sp > EVA.MAX_SPEED) { m.vx *= EVA.MAX_SPEED / sp; m.vy *= EVA.MAX_SPEED / sp; }
    m.x += m.vx * dt; m.y += m.vy * dt;
    let hit = null, impact = 0;
    for (const d of debris) {
      const dx = m.x - d.x, dy = m.y - d.y, dist = Math.hypot(dx, dy), R = d.r + 6;
      if (dist >= R || dist === 0) continue;
      const nx = dx / dist, ny = dy / dist;
      m.x = d.x + nx * R; m.y = d.y + ny * R;            // out of the plate
      const vn = m.vx * nx + m.vy * ny;
      if (vn < 0) {                                       // bounce off what he flew into
        impact = Math.max(impact, -vn);
        m.vx -= (1 + EVA.BOUNCE) * vn * nx; m.vy -= (1 + EVA.BOUNCE) * vn * ny;
        m.vx *= EVA.BOUNCE + 0.3; m.vy *= EVA.BOUNCE + 0.3;
      }
      hit = d;
    }
    if (bounds) {
      if (m.x < bounds.x) { m.x = bounds.x; m.vx = Math.abs(m.vx) * EVA.BOUNCE; }
      if (m.x > bounds.x + bounds.w) { m.x = bounds.x + bounds.w; m.vx = -Math.abs(m.vx) * EVA.BOUNCE; }
      if (m.y < bounds.y) { m.y = bounds.y; m.vy = Math.abs(m.vy) * EVA.BOUNCE; }
      if (m.y > bounds.y + bounds.h) { m.y = bounds.y + bounds.h; m.vy = -Math.abs(m.vy) * EVA.BOUNCE; }
    }
    return { thrusting, hit, impact };
  }

  /**
   * THE PLATES CUT (update189, jj: "szczątki jak dotykają załoganta, to
   * ranią, zabierają HP"). How much a strike at `impact` px/s takes off
   * him: nothing for a brush, more the harder he flew into it.
   */
  function hurt(impact) {
    if (!(impact >= EVA.HURT_SPEED)) return 0;
    return EVA.HURT_BASE + impact * EVA.HURT_PER_SPEED;
  }

  function speed(m) { return Math.hypot(m.vx ?? 0, m.vy ?? 0); }

  /**
   * THE AUTOPILOT GOES ROUND (update187). Where to steer for a target: the
   * target itself, or — when a plate stands across the straight line — a
   * point beside that plate, on the side he is already on.
   */
  function steerTo(m, tx, ty, debris = []) {
    const dx = tx - m.x, dy = ty - m.y, L = Math.hypot(dx, dy);
    if (L < 1) return { x: tx, y: ty };
    const ux = dx / L, uy = dy / L;
    let block = null, bestT = Infinity;
    for (const d of debris) {
      const t = (d.x - m.x) * ux + (d.y - m.y) * uy;     // along the line
      if (t <= 0 || t >= L) continue;
      const px = m.x + ux * t, py = m.y + uy * t;
      if (Math.hypot(d.x - px, d.y - py) < d.r + 14 && t < bestT) { block = { d, px, py }; bestT = t; }
    }
    if (!block) return { x: tx, y: ty };
    const { d, px, py } = block;
    let nx = px - d.x, ny = py - d.y, n = Math.hypot(nx, ny);
    if (n < 0.5) { nx = -uy; ny = ux; n = 1; }             // dead centre: pick a side
    return { x: d.x + nx / n * (d.r + 24), y: d.y + ny / n * (d.r + 24) };
  }

  /* ── THE PLATES ───────────────────────────────────────────── */
  function _rnd(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

  /**
   * Torn plates over the area the crates drift in, never on a crate (or a
   * body) and never on top of each other. `keep` — the things they must
   * leave room round; `box` — where they may go.
   */
  function makeDebris(n, box, keep = [], seed = Math.floor(Math.random() * 1e9)) {
    const r = _rnd(seed), out = [];
    for (let i = 0; i < n * 12 && out.length < n; i++) {
      const R = EVA.DEBRIS_R[0] + r() * (EVA.DEBRIS_R[1] - EVA.DEBRIS_R[0]);
      const p = { x: box.x + R + r() * Math.max(1, box.w - 2 * R), y: box.y + R + r() * Math.max(1, box.h - 2 * R) };
      if (keep.some(k => Math.hypot(k.x - p.x, k.y - p.y) < R + 34)) continue;
      if (out.some(o => Math.hypot(o.x - p.x, o.y - p.y) < R + o.r + 22)) continue;
      const pts = [], m = 6 + Math.floor(r() * 4);
      for (let k = 0; k < m; k++) {
        const a = (k / m) * Math.PI * 2 + r() * 0.4;
        const rr = R * (0.65 + r() * 0.45);
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      out.push({ id: `db${out.length}`, x: p.x, y: p.y, r: R, rot: r() * 6.28, spin: (r() - 0.5) * 0.3, pts,
                 tint: ['#3a414e', '#454c5a', '#323844'][Math.floor(r() * 3)], seam: r() });
    }
    return out;
  }

  /** A torn hull plate: dark metal, a lit edge, rivets, a scorched seam. */
  function drawDebris(ctx, d, t = 0) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot + d.spin * t);
    ctx.beginPath();
    d.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = d.tint; ctx.fill();
    ctx.strokeStyle = '#7a8496'; ctx.lineWidth = 1.5; ctx.stroke();
    // a scorched seam and a row of rivets
    ctx.strokeStyle = 'rgba(20,12,8,0.7)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-d.r * 0.6, -d.r * 0.2 + d.seam * 6); ctx.lineTo(d.r * 0.55, d.r * 0.15); ctx.stroke();
    ctx.fillStyle = '#9aa4b6';
    for (let i = -2; i <= 2; i++) ctx.fillRect(i * d.r * 0.22 - 1, -d.r * 0.45, 2, 2);
    // a glowing torn edge
    ctx.strokeStyle = 'rgba(255,140,60,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); const [a, b] = d.pts[0], [c, e] = d.pts[1]; ctx.moveTo(a, b); ctx.lineTo(c, e); ctx.stroke();
    ctx.restore();
  }

  /** The jet flame behind a man thrusting: opposite to where he pushes. */
  function drawJet(ctx, m, push) {
    const len = Math.hypot(push.x, push.y);
    if (!len) return;
    const ux = -push.x / len, uy = -push.y / len, x = m.x + ux * 6, y = m.y - 10 + uy * 6;
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.4, 'rgba(120,200,255,0.6)'); g.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x - uy * 4, y + ux * 4); ctx.lineTo(x + ux * 16, y + uy * 16); ctx.lineTo(x + uy * 4, y - ux * 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  return { keyThrust, fly, hurt, speed, steerTo, makeDebris, drawDebris, drawJet };
})();

if (typeof window !== 'undefined') { window.Eva = Eva; window.EVA = EVA; }
