/* ============================================================
   MOON WARS — combatground.js  (update170)
   The moon under every fight.

   jj, 25.10 (mk_ground_bunker, mk_ground_bunker2 — "dobry kierunek"):
     the fight should happen OVER the moon, not in empty space; a bunker
     "niżej … żeby statek atakował z góry", "bardziej zintegrowany" —
     dug in, regolith banked against it, dust on its lower hull, shell
     craters round it, a mast; the log can be folded [L] to see it.
     And the fight "w ruchu", for now only to the eye: when both hulls
     fly, the ground slides past beneath them.

   What it paints, ONCE per sector (cached like the map's terrain):
     a far ridge line and a near one, the plain of regolith with grain,
     craters in perspective lit from the upper left, rocks, a cool haze
     on the horizon — in the sector's tint (`MapTerrain.TINTS`). The
     strip is twice the screen wide and wraps, so it can scroll.

   Per hull, every frame:
     · flying  — a soft shadow on the plain below her;
     · grounded — behind her (`under`): the craters round her, a long
       shadow, the berm of regolith banked against her sides with blast
       blocks on it, a sensor mast; in front (`over`) only a low lip of
       rubble along her foot, below the lowest floor. Nothing of the
       ground is ever drawn over a room (jj: it looked like dust inside).
       A mech on tracks gets the craters and the shadow, no berm — it
       drives, it is not dug in.

   Only the eye: nothing here touches a rule, a hit test or a number.
   ============================================================ */

'use strict';

const CombatGround = (() => {
  const W = 1280, H = 720;
  /** Where the plain meets the sky. */
  const HORIZON = 400;
  /** How much lower a hull that stands on the ground is placed than one
   *  that flies, so the player's ship attacks it from above. */
  const DROP = 196;
  /** The strip is this wide and wraps (two screens). */
  const TW = W * 2;
  /** Pixels per second the plain slides by while both hulls fly; the far
   *  ridges go slower — parallax, so it reads as distance. */
  const SPEED_NEAR = 16, SPEED_FAR = 3;

  function rnd(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function _canvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c.getContext ? c : null;
  }
  const _tint = (sector) => (typeof MapTerrain !== 'undefined' && MapTerrain.tintOf)
    ? MapTerrain.tintOf(sector) : { a: '#45474d', b: '#36383d', mare: '20,22,30' };
  /** '#rrggbb' → [r,g,b], darkened/lightened by `k` (−1…1). */
  function _rgb(hex, k = 0) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
    return [f(n >> 16), f((n >> 8) & 255), f(n & 255)];
  }
  const _css = (a, al = 1) => `rgba(${a[0]},${a[1]},${a[2]},${al})`;
  /** A ridge profile that wraps: whole periods over the strip's width. */
  const _ridge = (x, a, b, c, ph) => Math.abs(Math.sin((x / TW) * Math.PI * 2 * a + ph)) * c
    + Math.sin((x / TW) * Math.PI * 2 * b + ph * 2) * c * 0.25;

  let _far = null, _near = null, _key = '';
  const TOP = 40;
  /** The lip starts this far below the lowest floor: room enough that no
   *  room is ever under it. */
  const LIP_GAP = 4;                       // headroom above the horizon in the strips

  function _paint(sector) {
    const key = String(sector);
    if (_near && _key === key) return true;
    const T = _tint(sector);
    const base = _rgb(T.a), dark = _rgb(T.b);
    // the far ridges: their own strip, so they can move slower
    const f = _canvas(TW, TOP + 4), fg = f?.getContext('2d');
    const n = _canvas(TW, H - HORIZON + TOP), ng = n?.getContext('2d');
    if (!fg || !ng) return false;
    fg.fillStyle = _css(_rgb(T.b, -0.35)); fg.beginPath(); fg.moveTo(0, TOP + 4);
    for (let x = 0; x <= TW; x += 16) fg.lineTo(x, TOP - 6 - _ridge(x, 5, 23, 28, 0.4));
    fg.lineTo(TW, TOP + 4); fg.closePath(); fg.fill();
    // the near ridge and the plain
    const r = rnd(777 + sector * 31), gh = n.height;
    ng.fillStyle = _css(_rgb(T.b, -0.15)); ng.beginPath(); ng.moveTo(0, TOP);
    for (let x = 0; x <= TW; x += 16) ng.lineTo(x, TOP - 3 - _ridge(x, 11, 37, 12, 2.0));
    ng.lineTo(TW, TOP + 2); ng.lineTo(0, TOP + 2); ng.closePath(); ng.fill();
    const grd = ng.createLinearGradient(0, TOP, 0, gh);
    grd.addColorStop(0, _css(base)); grd.addColorStop(0.25, _css(dark)); grd.addColorStop(1, _css(_rgb(T.b, -0.7)));
    ng.fillStyle = grd; ng.fillRect(0, TOP, TW, gh - TOP);
    // grain
    if (ng.getImageData) {
      const img = ng.getImageData(0, TOP, TW, gh - TOP), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = (r() - 0.5) * 12; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
      ng.putImageData(img, 0, TOP);
    }
    // a thing drawn near an edge is drawn again one strip over, so it wraps
    const twice = (x, draw) => { draw(x); if (x < 80) draw(x + TW); if (x > TW - 80) draw(x - TW); };
    // craters in perspective: small and flat far off, big and rounder close by
    for (let k = 0; k < 110; k++) {
      const t = r() ** 1.5, y = TOP + 6 + t * (gh - TOP - 10), x0 = r() * TW;
      const rad = (6 + r() * 24) * (0.35 + t * 1.7), fl = 0.16 + t * 0.2;
      twice(x0, x => {
        ng.fillStyle = 'rgba(10,10,14,0.45)'; ng.beginPath(); ng.ellipse(x, y, rad, rad * fl, 0, 0, Math.PI * 2); ng.fill();
        ng.strokeStyle = 'rgba(190,190,200,0.16)'; ng.lineWidth = 1 + t;
        ng.beginPath(); ng.ellipse(x, y, rad, rad * fl, 0, 0.1, Math.PI - 0.1); ng.stroke();
      });
    }
    // rocks, lit on top, shadow beneath
    for (let k = 0; k < 220; k++) {
      const t = r() ** 1.3, y = TOP + 4 + t * (gh - TOP - 6), x0 = r() * TW, w = (1 + r() * 3) * (0.5 + t * 2);
      twice(x0, x => {
        ng.fillStyle = 'rgba(150,150,158,0.22)'; ng.fillRect(x, y - w * 0.5, w, w * 0.5);
        ng.fillStyle = 'rgba(8,8,10,0.4)'; ng.fillRect(x, y, w, w * 0.25);
      });
    }
    _far = f; _near = n; _key = key;
    return true;
  }

  /** Whether the ground slides: only while both hulls are in the air. */
  function moving(player, enemy) {
    return !!enemy && !enemy.destroyed && !enemy.layout?.grounded && !enemy.isDerelict && !!player;
  }

  /**
   * The plain under the fight. `t` is seconds (any clock that runs);
   * `scroll` false keeps it still (a bunker does not move, nor we past it).
   */
  function draw(ctx, sector, t, scroll) {
    if (!ctx || !_paint(sector | 0 || 1)) return;
    const off = (sp) => scroll ? ((t * sp) % TW + TW) % TW : 0;
    const strip = (img, y, sp) => { const o = off(sp); ctx.drawImage(img, -o, y); ctx.drawImage(img, TW - o, y); };
    strip(_far, HORIZON - TOP - 14, SPEED_FAR);
    strip(_near, HORIZON - TOP, SPEED_NEAR);
    // a cool haze on the horizon, then the plain pushed back so the hulls sit on it
    const hz = ctx.createLinearGradient(0, HORIZON - 30, 0, HORIZON + 30);
    hz.addColorStop(0, 'rgba(120,150,200,0)'); hz.addColorStop(0.5, 'rgba(120,150,200,0.10)'); hz.addColorStop(1, 'rgba(120,150,200,0)');
    ctx.fillStyle = hz; ctx.fillRect(0, HORIZON - 30, W, 60);
    ctx.fillStyle = 'rgba(8,12,22,0.35)'; ctx.fillRect(0, HORIZON, W, H - HORIZON);
  }

  /** Before a hull is drawn: its shadow, and the ground round a grounded one.
   *  Everything of the ground goes BEHIND the hull (jj, 25.10: "regolit
   *  nie powinien zasłaniać modułów, bo to wygląda, jakby w środku był
   *  pył") — the hull is drawn over it, the rooms stay clean. */
  function under(ctx, ship, now = 0) {
    if (!ctx || !ship || ship.destroyed || typeof ship.roomBounds !== 'function') return;
    const b = ship.roomBounds(), cx = b.x + b.w / 2, fy = b.y + b.h;
    if (!ship.layout?.grounded) {
      // a soft shadow on the plain, a little to the right (the light is upper left)
      const sy = Math.max(HORIZON + 40, Math.min(H - 40, fy + 80));
      const g = ctx.createRadialGradient(cx + 30, sy, 0, cx + 30, sy, b.w * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx + 30, sy, b.w * 0.55, 18, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const r = rnd(91);
    // shell craters round it: the ground has been fought over
    for (let k = 0; k < 7; k++) {
      const x = b.x - 120 + r() * (b.w + 240), y = fy + 4 + r() * 22, rad = 12 + r() * 22;
      ctx.fillStyle = 'rgba(8,8,12,0.55)'; ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,200,210,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.32, 0, 0.1, Math.PI - 0.1); ctx.stroke();
    }
    // its shadow, long to the right
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(b.x + b.w + 40, fy + 14, 110, 10, 0, 0, Math.PI * 2); ctx.fill();
    if (ship.layout.tracks) return;          // a mech drives; it is not dug in
    // the berm of regolith banked against its sides — behind the hull,
    // so what shows is the slope running out on either side of it
    const bg = ctx.createLinearGradient(0, fy - 40, 0, fy + 18);
    bg.addColorStop(0, '#33353b'); bg.addColorStop(1, '#1d1e22');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(b.x - 80, fy + 18);
    for (let x = b.x - 80; x <= b.x + b.w + 80; x += 12) {
      const edge = x < b.x ? (b.x - x) / 80 : x > b.x + b.w ? (x - b.x - b.w) / 80 : 0;
      ctx.lineTo(x, fy - 40 + edge * 54 + Math.sin(x * 0.3) * 2 + r() * 3);
    }
    ctx.lineTo(b.x + b.w + 80, fy + 18); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(210,210,220,0.25)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let x = b.x - 80; x <= b.x; x += 12) ctx.lineTo(x, fy - 40 + ((b.x - x) / 80) * 54);
    ctx.stroke();
    // blast blocks on the slopes, left and right of it
    for (let k = 0; k < 8; k++) {
      const left = k % 2 === 0, w = 8 + r() * 14, t = r();
      const x = left ? b.x - 76 + t * 60 : b.x + b.w + 6 + t * 60;
      const y = fy - 6 + (left ? (1 - t) : t) * 10 + r() * 6;
      ctx.fillStyle = k % 3 ? '#3c3f46' : '#4a4d55'; ctx.fillRect(x, y, w, w * 0.45);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + w * 0.45, w, 2);
    }
    // a sensor mast in the rocks, its lamp blinking
    ctx.strokeStyle = '#8a8f99'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x - 46, fy + 2); ctx.lineTo(b.x - 46, fy - 52); ctx.stroke();
    ctx.fillStyle = ((now / 500) | 0) % 2 ? '#ff4030' : '#601810'; ctx.fillRect(b.x - 48, fy - 56, 4, 4);
  }

  /** After a grounded hull is drawn: only a low lip of regolith along its
   *  foot, BELOW the rooms — it may cover the rim of the plate, never a
   *  room (the floor of the lowest deck is `fy`). */
  function over(ctx, ship) {
    if (!ctx || !ship || ship.destroyed || !ship.layout?.grounded || typeof ship.roomBounds !== 'function') return;
    if (ship.layout.tracks) return;          // a mech's treads are under its foot: no rubble on them
    const b = ship.roomBounds(), fy = b.y + b.h, r = rnd(5), top = fy + LIP_GAP;
    ctx.fillStyle = '#26282d'; ctx.beginPath(); ctx.moveTo(b.x - 20, top + 16);
    for (let x = b.x - 20; x <= b.x + b.w + 20; x += 10) ctx.lineTo(x, top + 2 + Math.sin(x * 0.27) * 2 + r() * 3);
    ctx.lineTo(b.x + b.w + 20, top + 16); ctx.closePath(); ctx.fill();
    for (let k = 0; k < 10; k++) {
      const x = b.x - 10 + r() * (b.w + 20), w = 3 + r() * 7;
      ctx.fillStyle = 'rgba(150,150,158,0.30)'; ctx.fillRect(x, top + 4 + r() * 6, w, w * 0.45);
    }
  }

  return { HORIZON, DROP, LIP_GAP, draw, under, over, moving, _key: () => _key };
})();

if (typeof window !== 'undefined') window.CombatGround = CombatGround;
