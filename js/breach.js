/* ============================================================
   MOON WARS — breach.js
   Hull breach simulation.
   Breaches drain O2, can be sealed by crew.
   Missile hits and high-damage weapons cause breaches.
   ============================================================ */

'use strict';

let _nextBreachId = 1;

class HullBreach {
  /**
   * @param {string} roomId
   * @param {number} x      - world x on hull wall
   * @param {number} y      - world y
   */
  constructor(roomId, x, y) {
    this.id      = _nextBreachId++;
    this.roomId  = roomId;
    this.x       = x;
    this.y       = y;
    this.sealed  = false;
    this.progress = 0;     // seal progress 0–1

    // Spark particles emitted continuously
    this._sparkTimer = new Utils.Interval(0.15);
  }

  /**
   * Crew repairs this breach.
   * @param {number} dt
   * @param {CrewMember} crew
   */
  repair(dt, crew) {
    this.progress += dt * 0.2 * (crew ? crew.breachSpeed() : 1);
    if (crew) crew.addXP('breach', dt * 0.4);
    Particles.repairSparks(this.x, this.y);

    if (this.progress >= 1) {
      this.sealed = true;
      Audio.sfx.repair();
    }
  }

  update(dt) {
    if (this.sealed) return;

    if (this._sparkTimer.tick(dt)) {
      // Vacuum suck particles — outward
      for (let i = 0; i < 2; i++) {
        const angle = Utils.randFloat(0, Math.PI * 2);
        Particles.emit({
          x: this.x, y: this.y,
          vx: Math.cos(angle) * Utils.randFloat(20, 60),
          vy: Math.sin(angle) * Utils.randFloat(20, 60),
          ay: 0, color: '#c8d8f0',
          size: Utils.randFloat(1, 3), sizeEnd: 0,
          life: Utils.randFloat(0.3, 0.6), alpha: 0.6, alphaEnd: 0,
        });
      }
    }
  }

  draw(ctx) {
    if (this.sealed) return;

    // Breach glow
    const r = 10;
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
    g.addColorStop(0, 'rgba(180,210,255,0.6)');
    g.addColorStop(0.5, 'rgba(100,160,220,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(this.x - r, this.y - r, r*2, r*2);

    // Dark hole
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Repair progress arc
    if (this.progress > 0) {
      ctx.strokeStyle = '#1aff8c';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 8, -Math.PI/2, -Math.PI/2 + this.progress * Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ── Breach manager ────────────────────────────────────────

class BreachManager {
  constructor() {
    this._breaches = [];
  }

  get breaches() { return this._breaches; }

  /** Open a new breach in a room */
  open(roomId, x, y) {
    const b = new HullBreach(roomId, x, y);
    this._breaches.push(b);
    Audio.sfx.hullBreach();
    Camera.shake(10, 0.3);
    return b;
  }

  update(dt) {
    this._breaches.forEach(b => b.update(dt));
    // Remove fully sealed breaches
    this._breaches = this._breaches.filter(b => !b.sealed);
  }

  getBreachesInRoom(roomId) {
    return this._breaches.filter(b => !b.sealed && b.roomId === roomId);
  }

  countBreachesInRoom(roomId) {
    return this.getBreachesInRoom(roomId).length;
  }

  hasBreachInRoom(roomId) {
    return this._breaches.some(b => !b.sealed && b.roomId === roomId);
  }

  draw(ctx) {
    this._breaches.forEach(b => b.draw(ctx));
  }

  clear() { this._breaches = []; }
}
