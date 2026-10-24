/* ============================================================
   MOON WARS — mapterrain.js  (update167)
   The sector map as a chart of the moon's surface.

   jj, 24.10 (mk_moon, mk_moon2 — "fajnie, spoko, podoba mi się"):
     "mapa sektora … teraz słabo wygląda, przydałoby się coś à la mapa
     księżyca, jakieś kratery"; "natłok ikonek … większa mapa albo
     fajniej poukładać"; "szarość się gryzie z mocno kolorowymi ikonami";
     yes to what is out there leaving a mark on the ground (a nebula's
     haze, an asteroid field's rubble) and to the ground's colour
     changing sector by sector.

   What it paints, ONCE per map (its seed, its sector, the panel size):
     regolith with grain, dark maria, a rille, craters lit from the upper
     left (a young one with rays), the marks of the nodes, a faint survey
     grid — in the sector's own tint. Then, every time what is known
     changes, the fog: the surface dark but where the sensors reach.
   A cool wash goes over the rock when it is drawn, so the markers'
   colours sit on it instead of fighting it.

   Deterministic: the same map paints the same ground every time.
   ============================================================ */

'use strict';

const MapTerrain = (() => {
  /** The ground's colour, sector by sector: grey, warmer, dark basalt. */
  const TINTS = {
    1: { a: '#45474d', b: '#36383d', mare: '20,22,30' },
    2: { a: '#4d4842', b: '#3b3732', mare: '30,24,20' },
    3: { a: '#3f3a3c', b: '#2c2729', mare: '34,16,18' },
  };
  /** Where on the moon each sector is — the chart's own caption. */
  const PLACES = {
    1: 'MARE NUBIUM · 12°S 17°W',
    2: 'OCEANUS PROCELLARUM · 18°N 57°W',
    3: 'MARE FRIGORIS · 56°N 1°E',
  };
  const tintOf = (sector) => TINTS[Math.min(3, Math.max(1, sector | 0))];
  const placeOf = (sector) => PLACES[Math.min(3, Math.max(1, sector | 0))];

  function _canvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c.getContext ? c : null;
  }

  let _ground = null, _groundKey = '';
  /**
   * The painted ground for this map, `P.w × P.h`; `at(node)` gives a node's
   * place on it (panel-relative). Kept until the map or the panel changes.
   */
  function ground(map, P, at) {
    const key = `${map.seed}|${map.sector}|${P.w}x${P.h}`;
    if (_ground && _groundKey === key) return _ground;
    const c = _canvas(P.w, P.h);
    const g = c?.getContext('2d');
    if (!g) return null;
    const T = tintOf(map.sector);
    let s = (map.seed >>> 0) || 1;
    const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const grd = g.createLinearGradient?.(0, 0, P.w, P.h);
    if (grd) { grd.addColorStop(0, T.a); grd.addColorStop(1, T.b); g.fillStyle = grd; } else g.fillStyle = T.a;
    g.fillRect(0, 0, P.w, P.h);
    // grain
    if (g.getImageData) {
      const img = g.getImageData(0, 0, P.w, P.h), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      g.putImageData(img, 0, 0);
    }
    // maria: wide dark plains
    for (let k = 0; k < 4; k++) {
      const x = r() * P.w, y = r() * P.h, rad = 100 + r() * 150, rot = r() * 3;
      const mg = g.createRadialGradient?.(x, y, 0, x, y, rad);
      if (!mg) continue;
      mg.addColorStop(0, `rgba(${T.mare},0.55)`); mg.addColorStop(1, `rgba(${T.mare},0)`);
      g.fillStyle = mg; g.beginPath(); g.ellipse(x, y, rad * 1.4, rad, rot, 0, Math.PI * 2); g.fill();
    }
    // a rille: a sinuous crack
    g.strokeStyle = 'rgba(15,15,18,0.5)'; g.lineWidth = 2; g.beginPath();
    let rx = r() * P.w * 0.3, ry = P.h * (0.2 + r() * 0.6); g.moveTo(rx, ry);
    for (let k = 0; k < 44; k++) { rx += 15; ry += Math.sin(k * 0.5 + r()) * 6; g.lineTo(rx, ry); }
    g.stroke();
    // craters: a shadow, a dark floor, a rim lit from the upper left; a young one throws rays
    const crater = (x, y, rad, young) => {
      if (young) {
        g.strokeStyle = 'rgba(200,200,205,0.08)'; g.lineWidth = 2;
        for (let k = 0; k < 14; k++) {
          const a = r() * Math.PI * 2, L = rad * (3 + r() * 5);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
        }
      }
      g.fillStyle = 'rgba(16,16,20,0.45)'; g.beginPath(); g.ellipse(x + rad * 0.12, y + rad * 0.12, rad, rad * 0.9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(38,38,42,0.8)'; g.beginPath(); g.ellipse(x, y, rad * 0.86, rad * 0.78, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(160,160,166,0.4)'; g.lineWidth = Math.max(1, rad * 0.1);
      g.beginPath(); g.ellipse(x, y, rad, rad * 0.9, 0, Math.PI * 0.9, Math.PI * 1.75); g.stroke();
    };
    for (let k = 0; k < 3; k++) crater(r() * P.w, r() * P.h, 30 + r() * 26, k === 0);
    for (let k = 0; k < 16; k++) crater(r() * P.w, r() * P.h, 8 + r() * 14, false);
    for (let k = 0; k < 110; k++) crater(r() * P.w, r() * P.h, 1.5 + r() * 3.5, false);
    // what is out there leaves a mark on the ground (jj: yes)
    map.nodes.forEach(n => {
      const p = at(n);
      if (n.type === 'nebula') {
        const hg = g.createRadialGradient?.(p.x, p.y, 0, p.x, p.y, 70);
        if (hg) { hg.addColorStop(0, 'rgba(150,80,210,0.30)'); hg.addColorStop(1, 'rgba(150,80,210,0)'); g.fillStyle = hg; g.fillRect(p.x - 70, p.y - 70, 140, 140); }
      }
      if (n.type === 'asteroids') {
        for (let k = 0; k < 26; k++) {
          const a = r() * Math.PI * 2, d2 = 14 + r() * 40;
          g.fillStyle = k % 3 ? 'rgba(120,96,70,0.55)' : 'rgba(170,140,100,0.5)';
          g.fillRect(p.x + Math.cos(a) * d2, p.y + Math.sin(a) * d2 * 0.7, 2 + r() * 3, 2 + r() * 2);
        }
      }
    });
    // the survey grid, faint
    g.strokeStyle = 'rgba(160,200,255,0.05)'; g.lineWidth = 1;
    for (let x = 0; x < P.w; x += 50) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, P.h); g.stroke(); }
    for (let y = 0; y < P.h; y += 50) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(P.w, y + 0.5); g.stroke(); }
    _ground = c; _groundKey = key;
    return c;
  }

  let _fog = null, _fogKey = '';
  /** The dark over the ground but where the sensors reach; null on a surveyed map. */
  function fog(map, P, at, vis) {
    if (map.revealed) return null;
    const key = `${map.seed}|${map.sector}|` + map.nodes.map(n => (vis.get(n.id) ?? 'd')[0]).join('');
    if (_fog && _fogKey === key) return _fog;
    const c = _canvas(P.w, P.h), g = c?.getContext('2d');
    if (!g) return null;
    g.fillStyle = 'rgba(6,8,14,0.8)'; g.fillRect(0, 0, P.w, P.h);
    g.globalCompositeOperation = 'destination-out';
    map.nodes.forEach(n => {
      const v = vis.get(n.id);
      if (v === 'dark' || !v) return;
      const p = at(n), rad = v === 'known' ? 110 : 70;
      const rg = g.createRadialGradient?.(p.x, p.y, 0, p.x, p.y, rad);
      if (!rg) return;
      rg.addColorStop(0, `rgba(0,0,0,${v === 'known' ? 1 : 0.6})`); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
    });
    g.globalCompositeOperation = 'source-over';
    _fog = c; _fogKey = key;
    return c;
  }

  /** The cool wash over the rock — so the markers do not fight the grey. */
  const WASH = 'rgba(10,16,30,0.28)';

  return { TINTS, PLACES, tintOf, placeOf, ground, fog, WASH,
           _keys: () => ({ ground: _groundKey, fog: _fogKey }) };
})();

if (typeof window !== 'undefined') window.MapTerrain = MapTerrain;
