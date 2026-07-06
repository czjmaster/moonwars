/* ============================================================
   MOON WARS — particles.js
   Pooled particle system.
   Supports: sparks, smoke, fire, shield hits, explosions,
             laser impacts, repair, scrap collection.
   ============================================================ */

'use strict';

const Particles = (() => {

  // ── Particle pool ────────────────────────────────────────

  const POOL_SIZE = 600;
  const pool = [];
  let   _active = 0;

  class Particle {
    constructor() { this.alive = false; }

    reset(cfg) {
      this.alive    = true;
      this.x        = cfg.x;
      this.y        = cfg.y;
      this.vx       = cfg.vx       ?? 0;
      this.vy       = cfg.vy       ?? 0;
      this.ax       = cfg.ax       ?? 0;       // acceleration
      this.ay       = cfg.ay       ?? 0.04;    // gravity default
      this.life     = cfg.life     ?? 1.0;     // seconds
      this.lifeMax  = this.life;
      this.size     = cfg.size     ?? 4;
      this.sizeEnd  = cfg.sizeEnd  ?? 0;
      this.color    = cfg.color    ?? '#ff7c20';
      this.colorEnd = cfg.colorEnd ?? null;
      this.alpha    = cfg.alpha    ?? 1;
      this.alphaEnd = cfg.alphaEnd ?? 0;
      this.rotation = cfg.rotation ?? 0;
      this.rotSpeed = cfg.rotSpeed ?? 0;
      this.type     = cfg.type     ?? 'circle'; // circle | spark | smoke
      this.layer    = cfg.layer    ?? 0;        // 0=below ship, 1=above
    }
  }

  function _alloc() {
    // Try to reuse a dead particle
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].alive) return pool[i];
    }
    // Grow pool if under cap
    if (pool.length < POOL_SIZE) {
      const p = new Particle();
      pool.push(p);
      return p;
    }
    // Overwrite oldest
    return pool[_active % pool.length];
  }

  // ── Emitter API ───────────────────────────────────────────

  function emit(cfg) {
    const p = _alloc();
    p.reset(cfg);
    _active++;
    return p;
  }

  function burst(count, baseCfg, spread = {}) {
    for (let i = 0; i < count; i++) {
      const angle = Utils.randFloat(0, Math.PI * 2);
      const speed = Utils.randFloat(spread.speedMin ?? 20, spread.speedMax ?? 80);
      emit({
        ...baseCfg,
        vx: Math.cos(angle) * speed + (baseCfg.vx ?? 0),
        vy: Math.sin(angle) * speed + (baseCfg.vy ?? 0),
        life:  Utils.randFloat(baseCfg.life * 0.6, baseCfg.life * 1.4),
        size:  Utils.randFloat(baseCfg.size * 0.5, baseCfg.size * 1.5),
      });
    }
  }

  // ── Named effect helpers ──────────────────────────────────

  function explosion(x, y, scale = 1) {
    // Fire core
    burst(12, {
      x, y, color: '#ff7c20', colorEnd: '#ff2d00',
      size: 8 * scale, sizeEnd: 0, life: 0.5, ay: -20,
    }, { speedMin: 40 * scale, speedMax: 120 * scale });

    // Sparks
    burst(20, {
      x, y, color: '#ffd700', colorEnd: '#ff4400',
      size: 3 * scale, sizeEnd: 0, life: 0.8, ay: 30,
    }, { speedMin: 60 * scale, speedMax: 180 * scale });

    // Smoke
    burst(8, {
      x, y, color: '#445566', colorEnd: '#222233',
      size: 12 * scale, sizeEnd: 20 * scale, life: 1.2,
      alpha: 0.6, alphaEnd: 0, ay: -15, type: 'smoke',
    }, { speedMin: 10, speedMax: 40 });
  }

  function shieldHit(x, y) {
    burst(10, {
      x, y, color: '#4db8ff', colorEnd: '#1a8cff',
      size: 5, sizeEnd: 0, life: 0.3, ay: 0,
    }, { speedMin: 30, speedMax: 90 });
    burst(6, {
      x, y, color: '#ffffff', colorEnd: '#4db8ff',
      size: 2, sizeEnd: 0, life: 0.2, ay: 0,
    }, { speedMin: 60, speedMax: 120 });
  }

  function fireParticles(x, y) {
    emit({
      x: x + Utils.randFloat(-8, 8),
      y: y + Utils.randFloat(-4, 4),
      vx: Utils.randFloat(-8, 8),
      vy: Utils.randFloat(-40, -80),
      ay: 0,
      color: Utils.pick(['#ff7c20', '#ff4400', '#ffd700']),
      colorEnd: '#ff000000',
      size: Utils.randFloat(6, 14), sizeEnd: 0,
      life: Utils.randFloat(0.4, 0.8),
      alpha: 0.9, alphaEnd: 0,
      type: 'smoke', layer: 1,
    });
    // Spark
    if (Math.random() < 0.3) {
      emit({
        x, y, vx: Utils.randFloat(-30, 30), vy: Utils.randFloat(-60, -20),
        ay: 40, color: '#ffd700', size: 2, sizeEnd: 0,
        life: 0.3, layer: 1,
      });
    }
  }

  function smokeTrail(x, y) {
    emit({
      x: x + Utils.randFloat(-6, 6), y,
      vx: Utils.randFloat(-4, 4), vy: Utils.randFloat(-15, -5),
      ay: 0, color: '#334455', colorEnd: '#111122',
      size: Utils.randFloat(4, 10), sizeEnd: 16,
      life: 0.9, alpha: 0.4, alphaEnd: 0, type: 'smoke',
    });
  }

  function repairSparks(x, y) {
    burst(4, {
      x, y, color: '#1aff8c', colorEnd: '#00cc66',
      size: 3, sizeEnd: 0, life: 0.4, ay: -20,
    }, { speedMin: 20, speedMax: 60 });
  }

  function scrapCollect(x, y) {
    burst(6, {
      x, y, color: '#ffd700', colorEnd: '#ff9900',
      size: 4, sizeEnd: 0, life: 0.5, ay: -30,
    }, { speedMin: 20, speedMax: 50 });
  }

  function laserHit(x, y) {
    burst(8, {
      x, y, color: '#ffffff', colorEnd: '#4db8ff',
      size: 4, sizeEnd: 0, life: 0.2, ay: 0,
    }, { speedMin: 40, speedMax: 100 });
  }

  function crewDie(x, y) {
    burst(8, {
      x, y, color: '#ff2d44', colorEnd: '#660010',
      size: 3, sizeEnd: 0, life: 0.6, ay: 30,
    }, { speedMin: 20, speedMax: 60 });
  }

  // ── Update / draw ────────────────────────────────────────

  function update(dt) {
    _updateTexts(dt);
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.alive) continue;

      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }

      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.rotation += p.rotSpeed * dt;
    }
  }

  function draw(ctx, layer = 0) {
    if (layer === 1) _drawTexts(ctx);
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.alive || p.layer !== layer) continue;

      const t      = 1 - p.life / p.lifeMax;
      const size   = Utils.lerp(p.size, p.sizeEnd, t);
      const alpha  = Utils.lerp(p.alpha, p.alphaEnd, t);
      const color  = p.colorEnd ? _lerpColor(p.color, p.colorEnd, t) : p.color;

      if (size <= 0 || alpha <= 0) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      if (p.rotation) ctx.rotate(p.rotation);

      if (p.type === 'smoke') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'spark') {
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-p.vx * 0.02, -p.vy * 0.02);
        ctx.stroke();
      } else {
        // Default: filled circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // ── Colour lerp ──────────────────────────────────────────

  function _lerpColor(a, b, t) {
    // Handle rgba strings that end in 0000 (fade-to-transparent hack)
    const ac = _parseColor(a);
    const bc = _parseColor(b);
    const r  = Math.round(Utils.lerp(ac.r, bc.r, t));
    const g  = Math.round(Utils.lerp(ac.g, bc.g, t));
    const bv = Math.round(Utils.lerp(ac.b, bc.b, t));
    const al = Utils.lerp(ac.a, bc.a, t);
    return `rgba(${r},${g},${bv},${al})`;
  }

  const _colorCache = new Map();

  function _parseColor(s) {
    if (_colorCache.has(s)) return _colorCache.get(s);

    let r = 0, g = 0, b = 0, a = 1;

    if (s.startsWith('#')) {
      const hex = s.replace('#', '');
      if (hex.length === 8) {
        // RRGGBBAA
        r = parseInt(hex.slice(0,2),16);
        g = parseInt(hex.slice(2,4),16);
        b = parseInt(hex.slice(4,6),16);
        a = parseInt(hex.slice(6,8),16) / 255;
      } else {
        // RRGGBB
        r = parseInt(hex.slice(0,2),16);
        g = parseInt(hex.slice(2,4),16);
        b = parseInt(hex.slice(4,6),16);
      }
    } else if (s.startsWith('rgba')) {
      const m = s.match(/[\d.]+/g);
      if (m) { r = +m[0]; g = +m[1]; b = +m[2]; a = +m[3]; }
    }

    const result = { r, g, b, a };
    _colorCache.set(s, result);
    return result;
  }

  function clear() {
    for (let i = 0; i < pool.length; i++) pool[i].alive = false;
    _texts.length = 0;
  }

  // ── Floating combat text (damage numbers, MISS, power loss) ──

  const _texts = [];

  function floatText(x, y, text, color = '#ffffff', size = 13) {
    if (_texts.length > 40) _texts.shift();
    _texts.push({
      x: x + (Math.random() * 12 - 6), y,
      text, color, size,
      life: 1.15, lifeMax: 1.15,
    });
  }

  function _updateTexts(dt) {
    for (let i = _texts.length - 1; i >= 0; i--) {
      const t = _texts[i];
      t.y    -= 26 * dt;          // drift upward
      t.life -= dt;
      if (t.life <= 0) _texts.splice(i, 1);
    }
  }

  function _drawTexts(ctx) {
    if (!_texts.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    _texts.forEach(t => {
      const a = Math.min(1, t.life / (t.lifeMax * 0.6));
      ctx.globalAlpha = a;
      ctx.font = `bold ${t.size}px Share Tech Mono, monospace`;
      ctx.fillStyle = '#07080f';
      ctx.fillText(t.text, t.x + 1, t.y + 1);   // shadow
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    });
    ctx.restore();
  }

  // ── Public API ───────────────────────────────────────────

  return {
    emit, burst,
    explosion, shieldHit, fireParticles, smokeTrail,
    repairSparks, scrapCollect, laserHit, crewDie,
    floatText,
    update, draw, clear,
  };

})();
