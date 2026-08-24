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

  /**
   * VOID SPIDER — deliberately nothing like a crewman.
   * Low, wide, eight legs, a hunched carapace and eye-shine. It reads as
   * "not people" at a glance, which is the whole point: they used to be
   * drawn with the enemy-crew sprite and looked like boarders.
   */
  function _genSpider(baseColor, mode = 'idle') {
    const legN = 4;                       // per side
    return _makeFrames(mode === 'idle' ? 6 : 6, (ctx, t) => {
      const step = Math.sin(t * Math.PI * 2);
      const rear = mode === 'fight' ? 1 : 0;
      ctx.save();
      ctx.translate(32, 36 + (mode === 'idle' ? step * 0.8 : 0));
      if (rear) ctx.rotate(-0.12 * step);

      // Legs — each pair out of phase, so it scuttles.
      ctx.strokeStyle = '#0e1a10';
      ctx.lineWidth = 2.5;
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < legN; i++) {
          const ph  = (i / legN) * Math.PI * 2;
          const sw  = (mode === 'idle' ? 1 : 3) * Math.sin(t * Math.PI * 2 + ph);
          const y0  = -2 + i * 3;
          const kx  = side * (9 + i * 1.5);
          const ky  = y0 - 4 + sw * 0.6;
          const fx  = side * (15 + i * 2.5);
          const fy  = 8 + sw;
          ctx.beginPath();
          ctx.moveTo(side * 4, y0);
          ctx.lineTo(kx, ky);
          ctx.lineTo(fx, fy);
          ctx.stroke();
        }
      }

      // Abdomen then carapace — low and wide, never upright.
      ctx.fillStyle = '#132018';
      ctx.beginPath(); ctx.ellipse(0, 2, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = baseColor;
      ctx.beginPath(); ctx.ellipse(0, -3, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#07080f';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, -3, 8, 6, 0, 0, Math.PI * 2); ctx.stroke();

      // Eye-shine — brighter mid-lunge.
      const glow = mode === 'fight' ? 1 : 0.55 + 0.45 * Math.abs(step);
      ctx.fillStyle = `rgba(255,240,150,${glow.toFixed(2)})`;
      ctx.fillRect(-4, -6, 2, 2);
      ctx.fillRect(-1, -7, 2, 2);
      ctx.fillRect(2, -6, 2, 2);

      // Fangs, out when it strikes.
      if (mode === 'fight') {
        ctx.strokeStyle = '#e8ffd0'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-3, 1); ctx.lineTo(-5, 6);
        ctx.moveTo(3, 1);  ctx.lineTo(5, 6);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  /**
   * MOON RAT — long, low, and going somewhere.
   *
   * Read against a spider it has to be instantly different: a spider is
   * a wide hunched disc that sits still, a rat is a horizontal body
   * with a snout at one end and a tail at the other, and it is always
   * mid-scurry. Four short legs, not eight long ones.
   */
  function _genRat(baseColor, mode = 'idle') {
    return _makeFrames(6, (ctx, t) => {
      const step = Math.sin(t * Math.PI * 2);
      ctx.save();
      ctx.translate(32, 40 + (mode === 'idle' ? step * 0.5 : 0));
      if (mode === 'fight') ctx.rotate(-0.16 * step);

      // Tail — a thin whip that lags behind the body.
      ctx.strokeStyle = '#6a5c4b';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.quadraticCurveTo(17 + step * 2, -3 + step * 2, 22 + step * 3, 3 - step * 3);
      ctx.stroke();

      // Legs: four stubby ones, front pair out of phase with the back.
      ctx.strokeStyle = '#0f0d0a';
      ctx.lineWidth = 2;
      [[-6, 0], [-2, Math.PI], [3, Math.PI / 2], [7, -Math.PI / 2]].forEach(([lx, ph]) => {
        const sw = (mode === 'idle' ? 1.2 : 3.2) * Math.sin(t * Math.PI * 2 + ph);
        ctx.beginPath();
        ctx.moveTo(lx, 2);
        ctx.lineTo(lx + sw * 0.6, 8);
        ctx.stroke();
      });

      // Body — a long ellipse lying down, never upright.
      ctx.fillStyle = baseColor;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#07080f'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, Math.PI * 2); ctx.stroke();

      // Head and snout, pointing the way it is going.
      ctx.fillStyle = baseColor;
      ctx.beginPath(); ctx.ellipse(-11, -1, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#07080f';
      ctx.beginPath(); ctx.ellipse(-11, -1, 5, 4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#4a3f34';
      ctx.beginPath(); ctx.moveTo(-15, -1); ctx.lineTo(-19, 1); ctx.lineTo(-15, 2);
      ctx.closePath(); ctx.fill();

      // Ear — one round disc, the silhouette detail that says "rodent".
      ctx.fillStyle = '#8d7b66';
      ctx.beginPath(); ctx.arc(-9, -5, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#07080f'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(-9, -5, 3, 0, Math.PI * 2); ctx.stroke();

      // Eye, and teeth when it turns on you.
      ctx.fillStyle = mode === 'fight' ? '#ffdf6a' : '#2a2016';
      ctx.fillRect(-13, -2, 2, 2);
      if (mode === 'fight') {
        ctx.strokeStyle = '#fff4d0'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-17, 1); ctx.lineTo(-16, 4);
        ctx.moveTo(-15, 1); ctx.lineTo(-14, 4);
        ctx.stroke();
      }
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

  /**
   * Crew OPERATING a console.
   *
   * Seen from behind and slightly hunched — the visor is hidden because
   * he is facing his station, not you. Both hands work the board out of
   * phase, so a manned module reads as busy at a glance instead of the
   * man just standing there with his idle bob like everybody else.
   */
  function _genCrewOperate(baseColor) {
    return _makeFrames(8, (ctx, t) => {
      const ph = t * Math.PI * 2;
      const lean = Math.sin(ph) * 0.6;          // small forward sway
      ctx.save();
      ctx.translate(32, 32 + lean);

      // The console he is working at, low and in front of him. Bright
      // enough to read against a dark deck — the first version was
      // almost the same colour as the floor and simply vanished.
      ctx.fillStyle = '#1e3a5c';
      ctx.fillRect(-12, 3, 24, 9);
      ctx.fillStyle = `rgba(77,184,255,${(0.45 + 0.45 * Math.abs(Math.sin(ph * 1.7))).toFixed(2)})`;
      ctx.fillRect(-10, 5, 20, 4);
      ctx.strokeStyle = '#07080f';
      ctx.lineWidth = 1;
      ctx.strokeRect(-12, 3, 24, 9);

      // Body.
      ctx.fillStyle = baseColor;
      ctx.fillRect(-8, -12, 16, 16);

      // Head — BACK of the helmet: no visor, just a seam and the collar.
      ctx.fillStyle = '#c8d8f0';
      ctx.fillRect(-7, -24, 14, 14);
      ctx.fillStyle = '#9fb4cc';
      ctx.fillRect(-7, -13, 14, 3);
      ctx.strokeStyle = '#9fb4cc';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(0, -12); ctx.stroke();

      ctx.strokeStyle = '#07080f';
      ctx.lineWidth = 1;
      ctx.strokeRect(-8, -24, 16, 30);

      // ARMS LAST, so they are visible ON the board rather than buried
      // behind the torso. Left and right out of phase: he is working,
      // not saluting.
      const arm = (ax, phase) => {
        const drop = 1.6 * Math.sin(ph + phase);
        ctx.fillStyle = baseColor;
        ctx.fillRect(ax, -9, 5, 9 + drop);          // sleeve
        ctx.fillStyle = '#c8d8f0';
        ctx.fillRect(ax - 1, 0 + drop, 7, 5);       // glove on the keys
        ctx.strokeStyle = '#07080f';
        ctx.strokeRect(ax - 1, 0 + drop, 7, 5);
      };
      arm(-11, 0);
      arm(6, Math.PI);

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
      // FREEZE GUARD: a zero/NaN fps or a corrupted elapsed would spin
      // this loop forever and hang the whole game. Bail out + bound it.
      if (!(frameDur > 0) || !isFinite(this.elapsed)) { this.elapsed = 0; return; }
      let _guard = 0;
      while (this.elapsed >= frameDur && _guard++ < 240) {
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

  // EVERY state is colour-keyed. Only walk/idle used to be, so a
  // crewman turned generic blue the moment he started repairing —
  // his corporation colour vanished exactly when you were watching him.
  function crewByColor(state, color) {
    const key = state + '_' + color;
    if (!_colorCache.has(key)) {
      let frames;
      switch (state) {
        case 'walk':   frames = _genCrewWalk(color);   break;
        case 'repair':  frames = _genCrewRepair(color);  break;
        case 'operate': frames = _genCrewOperate(color); break;
        case 'fight':   frames = _genCrewFight(color);   break;
        case 'die':     frames = _genCrewDie(color);     break;
        case 'idle': default: frames = _genCrewIdle(color); break;
      }
      _colorCache.set(key, frames);
    }
    const fps  = state === 'walk' ? 8 : state === 'fight' ? 8 : state === 'die' ? 10
               : state === 'operate' ? 5 : 6;
    const loop = state !== 'die';
    return new AnimationInstance(_colorCache.get(key), fps, loop);
  }

  /**
   * Egg sac — drawn straight to the ctx (no frame cache): a slumped,
   * translucent pouch with a dark shape curled inside that twitches.
   */
  function drawEggSac(ctx, x, y, t = 0) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.save();
    ctx.translate(x, y + 2);

    // Webbing anchoring it to the deck.
    ctx.strokeStyle = 'rgba(159,255,122,0.25)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 4, 6);
      ctx.lineTo(i * 9, 13);
      ctx.stroke();
    }

    // Sac.
    ctx.fillStyle = `rgba(120,190,95,${(0.30 + 0.12 * pulse).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(0, -1, 9 + pulse, 12 + pulse * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9fff7a';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // The thing inside.
    ctx.fillStyle = 'rgba(12,26,14,0.85)';
    ctx.beginPath();
    ctx.ellipse(pulse - 0.5, 1, 4.5, 6, 0.3 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Highlight.
    ctx.fillStyle = `rgba(220,255,200,${(0.20 + 0.2 * pulse).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(-3, -5, 2.5, 4, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const _spiderCache = new Map();
  function spiderAnim(state = 'idle', color = '#7fd86a') {
    const key = state + '_' + color;
    if (!_spiderCache.has(key)) _spiderCache.set(key, _genSpider(color, state));
    return new AnimationInstance(_spiderCache.get(key),
                                 state === 'fight' ? 9 : state === 'walk' ? 10 : 5, true);
  }

  const _ratCache = new Map();
  function ratAnim(state = 'idle', color = '#b3a189') {
    const key = state + '_' + color;
    if (!_ratCache.has(key)) _ratCache.set(key, _genRat(color, state));
    return new AnimationInstance(_ratCache.get(key),
                                 state === 'fight' ? 10 : state === 'walk' ? 12 : 6, true);
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
    crewIdle, crewWalk, crewRepair, crewFight, crewDie, crewByColor, ratAnim,
    spiderAnim, drawEggSac,
    weaponCharge, shieldPulse, explosion, fire,
    AnimationInstance,
    Tween,
  };

})();
