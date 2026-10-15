/* ============================================================
   MOON WARS — palette.js  (update137)
   REGOLITH: a grey moon with four colours that mean something.

   Brief §2.3, jj 15.10: "z tymi kolorami to dobry pomysł". The game
   draws in a dozen colours, most of which say nothing — blue frames
   everywhere, a violet nebula, a gold station, an orange enemy. In the
   regolith palette the base is grey and only FOUR colours are left,
   each with one job:

     amber  #E0A230   watch out — running low, about to go
     red    #D9463C   loss, danger, death
     green  #3FA86B   good, ready, fed
     pale   #8FB6D1   interaction — selected, clickable, active

   HOW, FOR THE TRIAL. Nothing in the 40 000 lines that draw the game
   has to change: the screen's context is given a filter on the way in
   (`install`), and every colour the game sets is translated once and
   cached (`remap`):
     · grey, dark or near-white  → grey of the same brightness, a touch
                                    cool, like the brief's regolith
     · blue / cyan               → pale (interaction)
     · green / teal              → green
     · orange / yellow / gold    → amber
     · red / pink                → red
     · violet                    → grey (it means nothing)
   A colour is never made BRIGHTER than it was, only matched to its
   target or dimmed in proportion — so a faint line stays faint and a
   headline stays a headline.

   Only the screen's own context is filtered. Faces, suits and the hull
   art are painted on their own canvases and keep their colours; the
   station shop is HTML. That is the honest size of a trial: the judge
   is the screen, and the next step (if jj keeps it) is giving each
   element its colour by MEANING, not by hue.

   CLASSIC is the default and is the game exactly as it was.
   ============================================================ */

'use strict';

const Palette = (() => {
  const BASE = {
    screen: '#0B0B0C', panel: '#17181A', raised: '#232427', line: '#3A3C41',
    dim: '#8A8D93', text: '#D7D9DD', bright: '#F2F3F5',
  };
  const STATE = { amber: '#E0A230', red: '#D9463C', green: '#3FA86B', pale: '#8FB6D1' };
  const MODES = ['classic', 'regolith'];

  let _mode = 'classic';
  let _bypass = 0;
  const _cache = new Map();

  function mode() { return _mode; }
  function set(m) { _mode = MODES.includes(m) ? m : 'classic'; return _mode; }
  function on() { return _mode === 'regolith'; }

  // ── colour arithmetic ────────────────────────────────────
  function parse(c) {
    if (typeof c !== 'string') return null;
    const s = c.trim().toLowerCase();
    let m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
    if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16),
                    b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
    m = s.match(/^#([0-9a-f]{3})$/);
    if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16),
                    b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
    m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    return null;
  }
  const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  function hsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return { h, s, l };
  }
  function out(c, a) {
    const k = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return a >= 1 ? '#' + [c.r, c.g, c.b].map(v => k(v).toString(16).padStart(2, '0')).join('')
                  : `rgba(${k(c.r)},${k(c.g)},${k(c.b)},${+a.toFixed(3)})`;
  }
  /** Regolith grey with this brightness: a hair cool, like the brief's. */
  function grey(y) { return { r: Math.max(0, y - 2), g: y, b: Math.min(255, y + 5) }; }

  /** Which job a colour is doing, read off its hue: 'grey' or a STATE key. */
  function classify(c) {
    const { h, s, l } = hsl(c);
    const chroma = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    if (chroma < 28 || s < 0.3 || l < 0.25 || l > 0.8) return 'grey';
    if (h >= 250 && h < 320) return 'grey';                 // violet: means nothing
    if (h >= 320 || h < 15) return 'red';
    if (h < 70) return 'amber';
    if (h < 172) return 'green';
    return 'pale';                                          // cyan and blue
  }

  /** The regolith version of one CSS colour (anything it cannot read is
   *  passed through — gradients, patterns, 'transparent'). */
  function remap(css) {
    if (_mode !== 'regolith' || _bypass > 0 || typeof css !== 'string') return css;
    if (_cache.has(css)) return _cache.get(css);
    const c = parse(css);
    let res = css;
    if (c) {
      const job = classify(c);
      if (job === 'grey') res = out(grey(lum(c)), c.a);
      else {
        const t = parse(STATE[job]);
        const k = Math.min(1, lum(c) / lum(t));             // never brighter than it was
        res = out({ r: t.r * k, g: t.g * k, b: t.b * k }, c.a);
      }
    }
    if (_cache.size > 4000) _cache.clear();
    _cache.set(css, res);
    return res;
  }

  /** Paint `fn` with the filter off: a face painted straight onto the
   *  screen keeps its skin, its eyes and its suit. */
  function raw(fn) {
    _bypass++;
    try { return fn(); } finally { _bypass--; }
  }

  /* ── PICTURES FROM FILES ──────────────────────────────────
     The hulls, roofs and module bays are PNGs, and paint carries no
     state: in regolith they are grey. Made once per picture and kept;
     if the page cannot read the pixels back (opened from disk, the
     canvas would be tainted) the screen's own grayscale filter does it
     instead. Canvases the game paints itself — faces, crew, guns — are
     not files and keep their colours. */
  const _greyArt = new WeakMap();
  const _installed = new WeakSet();
  const isFileImage = (img) => typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement;
  function greyCopy(img) {
    if (_greyArt.has(img)) return _greyArt.get(img);
    let res = null;
    try {
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (w > 0 && h > 0 && typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h);
        if (d && d.data && d.data.length >= w * h * 4) {
          const p = d.data;
          for (let i = 0; i < p.length; i += 4) {
            const y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
            const t = grey(y);
            p[i] = t.r; p[i + 1] = t.g; p[i + 2] = t.b;
          }
          g.putImageData(d, 0, 0);
          res = c;
        }
      }
    } catch (e) { res = 'filter'; }                         // tainted: let the screen do it
    _greyArt.set(img, res);
    return res;
  }

  /**
   * Put the filter on a 2D context: its three colour properties and the
   * stops of the gradients it makes. Idempotent; in CLASSIC it passes
   * every colour through untouched.
   */
  function install(ctx) {
    if (!ctx || _installed.has(ctx)) return ctx;
    const proto = Object.getPrototypeOf(ctx);
    ['fillStyle', 'strokeStyle', 'shadowColor'].forEach(p => {
      const d = proto && Object.getOwnPropertyDescriptor(proto, p);
      if (d && d.set && d.get) {
        Object.defineProperty(ctx, p, {
          configurable: true,
          get() { return d.get.call(this); },
          set(v) { d.set.call(this, remap(v)); },
        });
      } else {                                              // a test double: a plain slot
        let val = ctx[p];
        Object.defineProperty(ctx, p, {
          configurable: true,
          get() { return val; },
          set(v) { val = remap(v); },
        });
      }
    });
    ['createLinearGradient', 'createRadialGradient'].forEach(fn => {
      const real = ctx[fn];
      if (typeof real !== 'function') return;
      ctx[fn] = function (...args) {
        const g = real.apply(this, args);
        if (g && typeof g.addColorStop === 'function') {
          const add = g.addColorStop.bind(g);
          g.addColorStop = (o, col) => add(o, remap(col));
        }
        return g;
      };
    });
    const realDraw = ctx.drawImage;
    if (typeof realDraw === 'function') {
      ctx.drawImage = function (img, ...rest) {
        if (_mode === 'regolith' && _bypass === 0 && isFileImage(img) && img.complete !== false) {
          const g = greyCopy(img);
          if (g === 'filter') {
            const was = this.filter;
            this.filter = 'grayscale(1)';
            try { return realDraw.call(this, img, ...rest); } finally { this.filter = was; }
          }
          if (g) {
            // the copy is the picture's own size, so source rectangles still line up
            return realDraw.call(this, g, ...rest);
          }
        }
        return realDraw.call(this, img, ...rest);
      };
    }
    _installed.add(ctx);
    return ctx;
  }

  return { BASE, STATE, MODES, mode, set, on, parse, classify, remap, raw, install, greyCopy,
           installed: (ctx) => _installed.has(ctx),
           _cacheSize: () => _cache.size };
})();

if (typeof window !== 'undefined') window.Palette = Palette;
