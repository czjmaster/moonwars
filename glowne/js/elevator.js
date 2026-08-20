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

  /**
   * Let a crew member go, wherever they are in the ride.
   *
   * THE BUG THIS FIXES: launch a boarding party while someone is inside
   * the cabin and they leave the ship still flagged as a passenger. When
   * they came home, `_ridingShaft` was still set, so they stood at the
   * shaft waiting for a cabin they were not in — and because the shaft
   * still listed them as its passenger, NOBODY else could call it either.
   */
  release(crew) {
    if (!crew) return false;
    let freed = false;
    if (this.passenger === crew) { this.passenger = null; freed = true; }
    if (crew._ridingShaft === this) { crew._ridingShaft = null; freed = true; }
    return freed;
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
    const colTop = this.topY - 50, colH = this.height + 77;

    // ── Shaft: a lit trunk, not a flat box ──
    // Doors moved to a shared line a few updates ago and left the old
    // slab-and-two-rails shaft looking pasted on. This reads as a
    // machined corridor: recessed centre, bright guide rails, ladder
    // rungs up the back.
    const g = ctx.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
    g.addColorStop(0,    '#0c1424');
    g.addColorStop(0.5,  '#141f36');
    g.addColorStop(1,    '#0c1424');
    ctx.fillStyle = g;
    ctx.fillRect(x - tw / 2, colTop, tw, colH);

    // Rungs.
    ctx.strokeStyle = 'rgba(60,90,130,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let ry = colTop + 8; ry < colTop + colH - 6; ry += 11) {
      ctx.moveTo(x - tw / 2 + 8, ry);
      ctx.lineTo(x + tw / 2 - 8, ry);
    }
    ctx.stroke();

    // Guide rails.
    ctx.fillStyle = this.damaged ? '#5a2430' : '#2b4463';
    ctx.fillRect(x - tw / 2 + 3, colTop + 3, 2.5, colH - 6);
    ctx.fillRect(x + tw / 2 - 5.5, colTop + 3, 2.5, colH - 6);

    // Outer casing.
    ctx.strokeStyle = this.damaged ? '#ff2d44' : '#24365a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - tw / 2, colTop, tw, colH);

    // ── Floor stops: a landing plate with a lamp ──
    this.floorYs.forEach(fy => {
      ctx.fillStyle = this.damaged ? 'rgba(90,30,40,0.55)' : 'rgba(20,45,70,0.55)';
      ctx.fillRect(x - tw / 2 + 2, fy - 17, tw - 4, 34);
      ctx.strokeStyle = this.damaged ? '#ff2d44' : '#2a5f8a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - tw / 2 + 2, fy - 17, tw - 4, 34);
      // Door lip, top and bottom of the landing.
      ctx.fillStyle = this.damaged ? '#6a2a35' : '#31597f';
      ctx.fillRect(x - tw / 2 + 2, fy - 18, tw - 4, 2);
      ctx.fillRect(x - tw / 2 + 2, fy + 16, tw - 4, 2);
      // Call lamp — green when the cabin is sitting here.
      const here = !this._moving && Math.abs(this._cabinY - fy) < 10;
      ctx.fillStyle = this.damaged ? '#5a1a24' : here ? '#1aff8c' : '#1d3450';
      ctx.beginPath(); ctx.arc(x, fy - 22, 2.2, 0, Math.PI * 2); ctx.fill();
    });

    // ── Cabin ──
    if (!this.damaged) {
      const cs = tw - 6;
      const cy = this._cabinY;

      // Hoist cable above the cabin.
      ctx.strokeStyle = 'rgba(120,160,200,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, colTop + 2); ctx.lineTo(x, cy - cs / 2);
      ctx.stroke();

      const accent = this._moving ? '#ffd700' : '#4db8ff';
      ctx.fillStyle = '#16293f';
      ctx.beginPath(); ctx.roundRect(x - cs / 2, cy - cs / 2, cs, cs, 2); ctx.fill();

      // Lit interior.
      ctx.fillStyle = this._moving ? 'rgba(255,215,0,0.20)' : 'rgba(77,184,255,0.20)';
      ctx.fillRect(x - cs / 2 + 3, cy - cs / 2 + 3, cs - 6, cs - 6);

      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - cs / 2, cy - cs / 2, cs, cs, 2); ctx.stroke();

      // Cabin door seam down the middle, so it reads as a car.
      ctx.strokeStyle = 'rgba(200,232,255,0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, cy - cs / 2 + 3); ctx.lineTo(x, cy + cs / 2 - 3);
      ctx.stroke();

      if (this._moving) {
        ctx.fillStyle = '#ffd700';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this._targetY < this._cabinY ? '▲' : '▼', x, cy + 4);
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

  /** Take a crew member out of every cabin — used when they leave the ship. */
  release(crew) {
    let freed = false;
    this._shafts.forEach(s => { if (s.release(crew)) freed = true; });
    if (crew) crew._elevatorArrived = false;
    return freed;
  }

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
