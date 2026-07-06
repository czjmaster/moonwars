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

    // Passenger transport — the cabin owns the ride
    this.passenger   = null;
  }

  /** Crew boards the cabin; shaft drives them to dstFloor and releases. */
  board(crew, dstFloor) {
    if (this.damaged || this.passenger) return false;
    this.passenger = crew;
    crew._ridingShaft = this;
    this.moveCabinTo(dstFloor);
    return true;
  }

  // Shaft width matches the 28px gap between room columns exactly —
  // shaft walls are flush with room walls, no overlap.
  get width() { return 28; }

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

    // Carry the passenger with the cabin
    if (this.passenger) {
      this.passenger.x = this.x;
      this.passenger.y = this._cabinY;
      if (!this._moving) {
        // Arrived — release
        const c = this.passenger;
        this.passenger = null;
        c._ridingShaft = null;
        c._elevatorArrived = true;
      }
    }
  }

  draw(ctx) {
    const x = this.x, tw = this.width;

    // Shaft column (square module corridor).
    // Stops sit on floor walk lines: extend up to the ceiling of the
    // top floor (~50px above) and down to the bottom floor (~27px below).
    const colTop = this.topY - 50, colH = this.height + 77;
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(x - tw/2, colTop, tw, colH);
    ctx.strokeStyle = '#1e2d4a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - tw/2, colTop, tw, colH);

    // Rails
    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(x - tw/2 + 4, colTop + 4, 3, colH - 8);
    ctx.fillRect(x + tw/2 - 7, colTop + 4, 3, colH - 8);

    // Floor stops — square markers
    this.floorYs.forEach(fy => {
      ctx.fillStyle = this.damaged ? '#4a1a1a' : '#12253a';
      ctx.fillRect(x - tw/2 + 2, fy - 20, tw - 4, 40);
      ctx.strokeStyle = this.damaged ? '#ff2d44' : '#1a4a6a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - tw/2 + 2, fy - 20, tw - 4, 40);
    });

    // Cabin — square, animated position
    if (!this.damaged) {
      const cs = tw - 8;   // square side
      ctx.fillStyle = '#1a3a5a';
      ctx.fillRect(x - cs/2, this._cabinY - cs/2, cs, cs);
      ctx.strokeStyle = this._moving ? '#ffd700' : '#4db8ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - cs/2, this._cabinY - cs/2, cs, cs);

      // Interior light
      ctx.fillStyle = this._moving ? 'rgba(255,215,0,0.25)' : 'rgba(77,184,255,0.25)';
      ctx.fillRect(x - cs/2 + 4, this._cabinY - cs/2 + 4, cs - 8, cs - 8);

      // Direction arrow while moving
      if (this._moving) {
        ctx.fillStyle = '#ffd700';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this._targetY < this._cabinY ? '▲' : '▼', x, this._cabinY + 4);
      }
    } else {
      ctx.strokeStyle = '#ff2d44';
      ctx.lineWidth = 2;
      const my = this.topY + this.height / 2;
      ctx.beginPath();
      ctx.moveTo(x - 8, my - 8); ctx.lineTo(x + 8, my + 8);
      ctx.moveTo(x + 8, my - 8); ctx.lineTo(x - 8, my + 8);
      ctx.stroke();
    }
  }

  /** Is the cabin currently stopped at this Y? */
  cabinAt(y, tol = 10) {
    return !this._moving && Math.abs(this._cabinY - y) < tol;
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

      // Cost = walk distance + how far the cabin must travel to reach us (wait time)
      const walkCost = Math.abs(crewX - shaft.x) + Math.abs(crewY - shaft.floorY(srcFloor));
      const waitCost = Math.abs(shaft._cabinY - shaft.floorY(srcFloor)) * 1.3;
      const cost = walkCost + waitCost;
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
