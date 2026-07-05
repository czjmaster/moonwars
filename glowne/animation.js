/* ============================================================
   MOON WARS — animation.js
   Sprite animation state machine.
   Manages frame-by-frame animations for crew, weapons,
   shields, fire, and other animated game objects.
   ============================================================ */

'use strict';

const Animation = (() => {

  // ── Animation clip definitions ────────────────────────────
  // Each clip: { frames: [{x,y,w,h}], fps, loop }
  // Coordinates reference the sprite sheet canvas.

  const CLIPS = {};

  /**
   * Define an animation clip from a sprite sheet.
   * @param {string}   name   - Unique clip name
   * @param {number}   sheetW - Width of one frame
   * @param {number}   sheetH - Height of one frame
   * @param {number}   count  - Number of frames
   * @param {number}   row    - Row in sprite sheet (0-indexed)
   * @param {number}   fps    - Frames per second
   * @param {boolean}  loop   - Does it loop?
   */
  function defineClip(name, sheetW, sheetH, count, row, fps, loop = true) {
    const frames = [];
    for (let i = 0; i < count; i++) {
      frames.push({ x: i * sheetW, y: row * sheetH, w: sheetW, h: sheetH });
    }
    CLIPS[name] = { frames, fps, loop };
  }

  // Since we use procedurally generated sprites (not sprite sheet files),
  // we simulate animations via canvas-drawn frames generated at init time.

  const _generatedAnims = new Map();

  /**
   * Generate a synthetic animation as an array of canvas frames.
   * Used for crew states, effects, etc.
   */
  function _makeFrames(count, drawFn) {
    const frames = [];
    for (let i = 0; i < count; i++) {
      const c   = document.createElement('canvas');
      c.width   = 64;
      c.height  = 64;
      const ctx = c.getContext('2d');
      drawFn(ctx, i / (count - 1 || 1), i);
      frames.push(c);
    }
    return frames;
  }

  /** Crew idle animation: gentle bob */
  function _genCrewIdle(baseColor) {
    return _makeFrames(8, (ctx, t, i) => {
      const bob = Math.sin(t * Math.PI * 2) * 2;
      ctx.save();
      ctx.translate(32, 32 + bob);

      // Body
      ctx.fillStyle = baseColor;
      ctx.fillRect(-8, -12, 16, 20);

      // Head
      ctx.fillStyle = '#c8d8f0';
      ctx.fillRect(-7, -24, 14, 14);

      // Visor
      ctx.fillStyle = '#ff7c20';
      ctx.fillRect(-5, -22, 10, 5);

      // Outline
      ctx.strokeStyle = '#07080f';
      ctx.lineWidth = 1;
      ctx.strokeRect(-8, -24, 16, 34);

      ctx.restore();
    });
  }

  /** Crew walk animation: leg swing */
  function _genCrewWalk(baseColor) {
    return _makeFrames(6, (ctx, t, i) => {
      const legSwing = Math.sin(t * Math.PI * 2) * 6;
      ctx.save();
      ctx.translate(32, 32);

      // Legs
      ctx.fillStyle = '#1a2a3a';
      ctx.fillRect(-8, 8, 6, 12 + legSwing * 0.3);
      ctx.fillRect( 2, 8, 6, 12 - legSwing * 0.3);

      // Body
      ctx.fillStyle = baseColor;
      ctx.fillRect(-8, -12, 16, 22);

      // Head (slight bob)
      const bob = Math.abs(Math.sin(t * Math.PI * 2)) * -1;
      ctx.fillStyle = '#c8d8f0';
      ctx.fillRect(-7, -24 + bob, 14, 14);
      ctx.fillStyle = '#ff7c20';
      ctx.fillRect(-5, -22 + bob, 10, 5);

      ctx.strokeStyle = '#07080f';
      ctx.lineWidth = 1;
      ctx.strokeRect(-8, -24 + bob, 16, 36);

      ctx.restore();
    });
  }

  /** Crew repair animation: wrench motion */
  function _genCrewRepair(baseColor) {
    return _makeFrames(6, (ctx, t, i) => {
      const armAngle = Math.sin(t * Math.PI * 2) * 0.4;
      ctx.save();
      ctx.translate(32, 32);

      // Body
      ctx.fillStyle = baseColor;
      ctx.fillRect(-8, -12, 16, 22);

      // Arm with tool
      ctx.save();
      ctx.translate(8, -4);
      ctx.rotate(armAngle);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(0, -2, 14, 4);
      ctx.fillRect(10, -5, 4, 10);
      ctx.restore();

      // Head
      ctx.fillStyle = '#c8d8f0';
      ctx.fillRect(-7, -24, 14, 14);
      ctx.fillStyle = '#1aff8c';  // different visor for repair
      ctx.fillRect(-5, -22, 10, 5);

      ctx.restore();
    });
  }

  /** Crew fight animation */
  function _genCrewFight(baseColor) {
    return _makeFrames(4, (ctx, t, i) => {
      const punch = i % 2 === 0 ? 8 : 0;
      ctx.save();
      ctx.translate(32, 32);

      ctx.fillStyle = baseColor;
      ctx.fillRect(-8, -12, 16, 22);

      // Punching arm
      ctx.fillStyle = '#c8d8f0';
      ctx.fillRect(8, -8, 10 + punch, 6);

      ctx.fillStyle = '#c8d8f0';
      ctx.fillRect(-7, -24, 14, 14);
      ctx.fillStyle = '#ff2d44';
      ctx.fillRect(-5, -22, 10, 5);

      ctx.restore();
    });
  }

  /** Crew die animation */
  function _genCrewDie(baseColor) {
    return _makeFrames(8, (ctx, t, i) => {
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(t * Math.PI * 0.5);
      ctx.globalAlpha = 1 - t * 0.8;

      ctx.fillStyle = baseColor;
      ctx.fillRect(-8, -12, 16, 22);
      ctx.fillStyle = '#c8d8f0';
      ctx.fillRect(-7, -24, 14, 14);

      ctx.restore();
    });
  }

  /** Weapon charge glow */
  function _genWeaponCharge() {
    return _makeFrames(8, (ctx, t, i) => {
      const r = 4 + t * 20;
      const alpha = 0.2 + t * 0.6;
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, r);
      grad.addColorStop(0, `rgba(255,200,50,${alpha})`);
      grad.addColorStop(0.5, `rgba(255,100,20,${alpha * 0.5})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);

      if (t > 0.7) {
        ctx.strokeStyle = `rgba(255,220,100,${(t-0.7)/0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(32, 32, r * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  /** Shield recharge pulse */
  function _genShieldPulse() {
    return _makeFrames(10, (ctx, t, i) => {
      const r = t * 80;
      const alpha = (1 - t) * 0.6;
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, r);
      grad.addColorStop(0, `rgba(77,184,255,0)`);
      grad.addColorStop(0.7, `rgba(77,184,255,${alpha})`);
      grad.addColorStop(1, 'rgba(77,184,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    });
  }

  /** Explosion animation */
  function _genExplosion() {
    return _makeFrames(10, (ctx, t, i) => {
      const r   = t * 50;
      const alpha = Math.max(0, 1 - t * 1.2);

      // Orange fireball
      const g1 = ctx.createRadialGradient(32,32,0,32,32,r);
      g1.addColorStop(0,   `rgba(255,255,200,${alpha})`);
      g1.addColorStop(0.3, `rgba(255,150,20,${alpha})`);
      g1.addColorStop(0.7, `rgba(200,50,10,${alpha * 0.7})`);
      g1.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, 64, 64);

      // Smoke ring
      if (t > 0.3) {
        const sr    = (t - 0.3) * 80;
        const salpha = Math.max(0, (1 - (t - 0.3) * 2) * 0.5);
        ctx.strokeStyle = `rgba(80,80,100,${salpha})`;
        ctx.lineWidth   = 6;
        ctx.beginPath();
        ctx.arc(32, 32, sr, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  /** Fire tile animation */
  function _genFireAnim() {
    return _makeFrames(8, (ctx, t, i) => {
      const flicker = Math.sin(t * Math.PI * 4) * 0.3 + 0.7;

      const colors = ['#ff7c20', '#ff4400', '#ffd700', '#ff2200'];
      const col    = colors[i % colors.length];

      const g = ctx.createRadialGradient(32, 40, 2, 32, 32, 28 * flicker);
      g.addColorStop(0, col);
      g.addColorStop(0.5, '#ff6600');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);

      // Flame tongues
      ctx.fillStyle = `rgba(255,200,50,${flicker * 0.8})`;
      for (let j = 0; j < 3; j++) {
        const tx = 20 + j * 12 + Math.sin(t * Math.PI * 2 + j) * 5;
        const th = 20 + Math.sin(t * Math.PI * 2 + j * 1.5) * 8;
        ctx.beginPath();
        ctx.moveTo(tx, 50);
        ctx.lineTo(tx - 6, 50 - th);
        ctx.lineTo(tx + 6, 50 - th);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  // ── AnimationInstance ─────────────────────────────────────

  class AnimationInstance {
    constructor(frames, fps, loop) {
      this.frames  = frames;
      this.fps     = fps;
      this.loop    = loop;
      this.frame   = 0;
      this.elapsed = 0;
      this.done    = false;
    }

    update(dt) {
      if (this.done) return;
      this.elapsed += dt;
      const frameDur = 1 / this.fps;
      while (this.elapsed >= frameDur) {
        this.elapsed -= frameDur;
        this.frame++;
        if (this.frame >= this.frames.length) {
          if (this.loop) {
            this.frame = 0;
          } else {
            this.frame = this.frames.length - 1;
            this.done  = true;
          }
        }
      }
    }

    draw(ctx, x, y, w, h) {
      const f = this.frames[this.frame];
      if (!f) return;
      if (f instanceof HTMLCanvasElement || f instanceof ImageBitmap) {
        ctx.drawImage(f, x - w/2, y - h/2, w, h);
      }
    }

    reset() {
      this.frame   = 0;
      this.elapsed = 0;
      this.done    = false;
    }
  }

  // ── Factory functions ─────────────────────────────────────

  let _crewIdleFrames    = null;
  let _crewWalkFrames    = null;
  let _crewRepairFrames  = null;
  let _crewFightFrames   = null;
  let _crewDieFrames     = null;
  let _crewEnIdleFrames  = null;
  let _crewEnWalkFrames  = null;   // CACHED — regenerating per call leaked GPU memory
  let _weaponChargeFrames= null;
  let _shieldPulseFrames = null;
  let _explosionFrames   = null;
  let _fireAnimFrames    = null;

  function init() {
    _crewIdleFrames    = _genCrewIdle('#4db8ff');
    _crewWalkFrames    = _genCrewWalk('#4db8ff');
    _crewRepairFrames  = _genCrewRepair('#4db8ff');
    _crewFightFrames   = _genCrewFight('#4db8ff');
    _crewDieFrames     = _genCrewDie('#4db8ff');
    _crewEnIdleFrames  = _genCrewIdle('#ff2d44');
    _crewEnWalkFrames  = _genCrewWalk('#ff2d44');
    _weaponChargeFrames= _genWeaponCharge();
    _shieldPulseFrames = _genShieldPulse();
    _explosionFrames   = _genExplosion();
    _fireAnimFrames    = _genFireAnim();
  }

  function crewIdle(isEnemy = false) {
    const frames = isEnemy ? _crewEnIdleFrames : _crewIdleFrames;
    return new AnimationInstance(frames || [], 6, true);
  }

  function crewWalk(isEnemy = false) {
    const frames = isEnemy ? _crewEnWalkFrames : _crewWalkFrames;
    return new AnimationInstance(frames || [], 8, true);
  }

  // ── Color-keyed cache for corporation crew colors ──────────
  const _colorCache = new Map();   // 'idle_#hex' → frames

  function crewByColor(state, color) {
    const key = state + '_' + color;
    if (!_colorCache.has(key)) {
      let frames;
      switch (state) {
        case 'walk': frames = _genCrewWalk(color); break;
        case 'idle': default: frames = _genCrewIdle(color); break;
      }
      _colorCache.set(key, frames);
    }
    const fps  = state === 'walk' ? 8 : 6;
    return new AnimationInstance(_colorCache.get(key), fps, true);
  }

  function crewRepair() {
    return new AnimationInstance(_crewRepairFrames || [], 6, true);
  }

  function crewFight() {
    return new AnimationInstance(_crewFightFrames || [], 8, true);
  }

  function crewDie() {
    return new AnimationInstance(_crewDieFrames || [], 10, false);
  }

  function weaponCharge() {
    return new AnimationInstance(_weaponChargeFrames || [], 8, false);
  }

  function shieldPulse() {
    return new AnimationInstance(_shieldPulseFrames || [], 10, false);
  }

  function explosion() {
    return new AnimationInstance(_explosionFrames || [], 12, false);
  }

  function fire() {
    return new AnimationInstance(_fireAnimFrames || [], 10, true);
  }

  // ── Tween helper ─────────────────────────────────────────

  class Tween {
    constructor(obj, props, duration, easing = 'linear', onDone = null) {
      this.obj      = obj;
      this.start    = {};
      this.end      = {};
      this.duration = duration;
      this.elapsed  = 0;
      this.easing   = easing;
      this.onDone   = onDone;
      this.done     = false;

      for (const k in props) {
        this.start[k] = obj[k];
        this.end[k]   = props[k];
      }
    }

    update(dt) {
      if (this.done) return;
      this.elapsed = Math.min(this.elapsed + dt, this.duration);
      const t = this._ease(this.elapsed / this.duration);
      for (const k in this.end) {
        this.obj[k] = Utils.lerp(this.start[k], this.end[k], t);
      }
      if (this.elapsed >= this.duration) {
        this.done = true;
        if (this.onDone) this.onDone();
      }
    }

    _ease(t) {
      switch (this.easing) {
        case 'easeIn':    return t * t;
        case 'easeOut':   return 1 - (1-t)*(1-t);
        case 'easeInOut': return t < 0.5 ? 2*t*t : 1 - 2*(1-t)*(1-t);
        case 'bounce':
          if (t < 0.364) return 7.5625 * t * t;
          if (t < 0.727) { t -= 0.545; return 7.5625*t*t + 0.75; }
          if (t < 0.909) { t -= 0.818; return 7.5625*t*t + 0.9375; }
          t -= 0.955; return 7.5625*t*t + 0.984375;
        default: return t;
      }
    }
  }

  // ── Public API ───────────────────────────────────────────

  return {
    init,
    crewIdle, crewWalk, crewRepair, crewFight, crewDie, crewByColor,
    weaponCharge, shieldPulse, explosion, fire,
    AnimationInstance,
    Tween,
  };

})();
