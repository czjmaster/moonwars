/* ============================================================
   MOON WARS — elevator.js
   Multi-floor ship elevator system.
   Crew use elevators to move between floors.
   Elevators can be damaged and repaired.
   ============================================================ */

'use strict';

class ElevatorShaft {
  /**
   * @param {string}   id       - unique shaft id
   * @param {number}   x        - world x position
   * @param {number[]} floorYs  - world Y for each floor [bottom, top, ...]
   */
  constructor(id, x, floorYs) {
    this.id       = id;
    this.x        = x;
    this.floorYs  = floorYs;             // one per floor
    this.topY     = Math.min(...floorYs);
    this.bottomY  = Math.max(...floorYs);
    this.height   = this.bottomY - this.topY;

    // State
    this.damaged     = false;
    this.hp          = 50;
    this.maxHp       = 50;
    this._cabinY     = floorYs[0];       // visual cabin position
    this._cabinFloor = 0;
    this._moving     = false;
    this._targetY    = this._cabinY;
  }

  get width() { return 20; }

  /** True if elevator stops at this world Y */
  hasFloorAt(y, tolerance = 24) {
    return this.floorYs.some(fy => Math.abs(fy - y) < tolerance);
  }

  /** Closest floor index to given Y */
  closestFloor(y) {
    let best = 0, bestDist = Infinity;
    this.floorYs.forEach((fy, i) => {
      const d = Math.abs(fy - y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  floorY(index) { return this.floorYs[index] ?? this.floorYs[0]; }

  repair(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    if (this.hp >= this.maxHp) this.damaged = false;
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.damaged = true;
  }

  isUsable() { return !this.damaged; }

  update(dt) {
    if (this._moving) {
      const dy   = this._targetY - this._cabinY;
      const speed = 80; // px/sec
      if (Math.abs(dy) < 2) {
        this._cabinY = this._targetY;
        this._moving = false;
      } else {
        this._cabinY += Math.sign(dy) * Math.min(speed * dt, Math.abs(dy));
      }
    }
  }

  draw(ctx) {
    const x = this.x, tw = this.width;

    // Shaft background
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(x - tw/2, this.topY, tw, this.height);

    // Rails
    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(x - tw/2 + 2, this.topY, 3, this.height);
    ctx.fillRect(x + tw/2 - 5, this.topY, 3, this.height);

    // Rungs
    ctx.fillStyle = '#2a3a4a';
    for (let ry = this.topY + 8; ry < this.bottomY; ry += 12) {
      ctx.fillRect(x - tw/2 + 5, ry, tw - 10, 2);
    }

    // Floor markers
    this.floorYs.forEach(fy => {
      ctx.fillStyle = this.damaged ? '#4a1a1a' : '#1a4a6a';
      ctx.fillRect(x - tw/2 - 4, fy - 3, tw + 8, 6);
      ctx.fillStyle = this.damaged ? '#ff2d44' : '#4db8ff';
      ctx.fillRect(x - tw/2 - 3, fy - 2, tw + 6, 4);
    });

    // Cabin
    if (!this.damaged) {
      ctx.fillStyle = '#1a3a5a';
      ctx.fillRect(x - tw/2 + 1, this._cabinY - 12, tw - 2, 24);
      ctx.strokeStyle = '#4db8ff';
      ctx.lineWidth   = 1;
      ctx.strokeRect(x - tw/2 + 1, this._cabinY - 12, tw - 2, 24);

      // Cabin light
      ctx.fillStyle = 'rgba(77,184,255,0.3)';
      ctx.fillRect(x - tw/2 + 3, this._cabinY - 4, tw - 6, 8);
    } else {
      // Damaged X
      ctx.strokeStyle = '#ff2d44';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(x - 6, this.topY + this.height/2 - 8);
      ctx.lineTo(x + 6, this.topY + this.height/2 + 8);
      ctx.moveTo(x + 6, this.topY + this.height/2 - 8);
      ctx.lineTo(x - 6, this.topY + this.height/2 + 8);
      ctx.stroke();
    }
  }

  // ── Crew interface ────────────────────────────────────────

  /**
   * Returns the Y destination crew should path to
   * when travelling to a given target floor index.
   */
  getEntryY() {
    return this._cabinY;
  }

  moveCabinTo(floorIndex) {
    if (this.damaged) return false;
    const targetY = this.floorYs[floorIndex];
    if (targetY === undefined) return false;
    this._targetY    = targetY;
    this._cabinFloor = floorIndex;
    this._moving     = true;
    return true;
  }
}

// ── Elevator manager ──────────────────────────────────────

class ElevatorManager {
  constructor() {
    this._shafts = [];
  }

  addShaft(id, x, floorYs) {
    const shaft = new ElevatorShaft(id, x, floorYs);
    this._shafts.push(shaft);
    return shaft;
  }

  getShaft(id) { return this._shafts.find(s => s.id === id) || null; }

  get shafts() { return this._shafts; }

  /**
   * Find the best shaft for a crew member to use to reach a target Y.
   * Returns { shaft, entryX, entryY, exitY, floor } or null.
   */
  findPath(crewX, crewY, targetY) {
    let best = null, bestCost = Infinity;

    this._shafts.forEach(shaft => {
      if (!shaft.isUsable()) return;
      // Check if shaft serves both source floor and target floor
      const srcFloor = shaft.closestFloor(crewY);
      const dstFloor = shaft.closestFloor(targetY);
      if (srcFloor === dstFloor) return;

      const cost = Math.abs(crewX - shaft.x) + Math.abs(crewY - shaft.floorY(srcFloor));
      if (cost < bestCost) {
        bestCost = cost;
        best = {
          shaft,
          entryX: shaft.x,
          entryY: shaft.floorY(srcFloor),
          exitY:  shaft.floorY(dstFloor),
          srcFloor, dstFloor,
        };
      }
    });

    return best;
  }

  update(dt) {
    this._shafts.forEach(s => s.update(dt));
  }

  draw(ctx) {
    this._shafts.forEach(s => s.draw(ctx));
  }
}
