'use strict';

/* ══ THE REPAIR BAY'S DRONES (update229) ═══════════════════════════════
 *
 * jj 10.11: „moduł naprawczy zmienimy — na każdy 1 lev będzie 1 dron naprawczy;
 * jak coś zepsute, to dron automatycznie leci do modułu, aby go naprawiać;
 * 1 dron jest słabszy niż załogant normalny, dopiero 2 drony dają podobną
 * skuteczność, czyli lev 2 modułu — i trzeba mieć energię oczywiście, i moduł
 * musi działać tak jak mamy; max 8 lev tego modułu".
 *
 * Before this the bay was a number: `effectivePower × 0.5` of a crewman, poured
 * into EVERY damaged module at once, from nowhere, with nothing on screen. One
 * powered level mended the whole ship. Now the bay BUILDS drones — one per level,
 * up to eight — and each drone is a thing in the ship that flies to one broken
 * module and works on it. Half a crewman each, so two of them are a hand; eight
 * of them are four hands, but spread over up to eight different modules, and
 * never more than one drone's worth of speed on any one of them.
 *
 * What makes a drone FLY, in order:
 *   built   — the bay's LEVEL. A level-3 bay owns three drones, broken or not.
 *   working — a damaged level grounds its drone (`workingLevels`).
 *   powered — and so does a missing unit of power (`effectivePower`, so a Terra
 *             cyborg's +1 launches one just as the reactor would).
 * A grounded drone is not deleted: it sits in its cradle in the bay, dark, and
 * the player can see how many of them are not flying and why.
 *
 * They are NOT saved. A drone is where it happens to be hovering this second;
 * a reload puts the bay's drones back in their cradles, which is where they
 * would be a moment later anyway.
 */

const DRONE_TUNING = {
  MAX: 8,              // the bay's maxLevel — one drone a level
  SPEED: 42,           // px/s in flight
  ARRIVE: 2.5,         // px: close enough to start work
  HOVER: 11,           // px above the compartment's deck line
  SIZE: 3.4,           // body radius
  SPACING: 5.5,        // px between drones docked in their cradles
  /* A drone mends like HALF a crewman (jj: two of them ≈ one hand). The old
     `Ship.AUTOREPAIR_RATE` held this same 0.5 for the whole bay; it is a
     drone's rate now, and the bay's output is however many are flying. */
  RATE: 0.5,
  /* …and it puts out a fire at the same half-a-hand (update230, jj: „tak" —
     a drone fights fires too). It hovers this far over the flame. */
  FIRE_HOVER: 7,
};

class RepairDrone {
  constructor(cfg = {}) {
    this.id      = cfg.id || `drone${(typeof Utils !== 'undefined' ? Utils.uid() : Math.random().toString(36).slice(2))}`;
    this.index   = cfg.index ?? 0;       // which cradle in the bay is its own
    this.x       = cfg.x ?? 0;
    this.y       = cfg.y ?? 0;
    this.roomId  = null;                 // the compartment it is working in, or null
    this.flying  = false;
    this.working = false;
    this.onFire  = false;                // true while it is putting a fire out (update230)
    this._phase  = (this.index * 0.7) % (Math.PI * 2);   // its own bob, so eight do not pulse as one
    this._spin   = Math.random() * Math.PI;
    this._placed = false;                // has it ever been put somewhere?
  }

  /** Where this drone's cradle is: its own place along the back of the bay. */
  dockPoint(bayRoom, count) {
    const n = Math.max(1, count);
    const span = (n - 1) * DRONE_TUNING.SPACING;
    const x0 = bayRoom.cx - span / 2;
    return { x: x0 + this.index * DRONE_TUNING.SPACING,
             y: bayRoom.floorTop + bayRoom.floorH - DRONE_TUNING.HOVER - 6 };
  }

  /** Where it hovers while it works on a module. */
  static workPoint(room) {
    return { x: room.cx, y: room.floorTop + room.floorH - DRONE_TUNING.HOVER };
  }
  /** …and over a fire (update230): right above the flame, not in it. */
  static firePoint(fire) {
    return { x: fire.x, y: fire.y - DRONE_TUNING.FIRE_HOVER };
  }

  /** Fly towards (tx, ty); true once it is there. */
  moveTo(tx, ty, dt) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= DRONE_TUNING.ARRIVE) { this.x = tx; this.y = ty; return true; }
    const step = Math.min(d, DRONE_TUNING.SPEED * dt);
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    return false;
  }

  draw(ctx, ship) {
    const now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    const bob = Math.sin(now * 3.4 + this._phase) * (this.flying ? 0.9 : 0.35);
    const x = this.x, y = this.y + bob;
    const R = DRONE_TUNING.SIZE;
    const live = this.flying;
    /* THE BEAM FIRST, UNDER THE BODY: a thin cone of light onto the module it is
       mending, so the player can see which one is being worked on. */
    if (this.working) {
      const room = ship?.getRoomById?.(this.roomId);
      if (room) {
        const fy = this.onFire ? this.y + DRONE_TUNING.FIRE_HOVER : room.floorTop + room.floorH - 1;
        ctx.fillStyle = this.onFire ? 'rgba(160,220,255,0.3)' : 'rgba(125,255,154,0.16)';
        ctx.beginPath();
        ctx.moveTo(x - 1.2, y + 1);
        ctx.lineTo(x + 1.2, y + 1);
        ctx.lineTo(x + 4.5, fy);
        ctx.lineTo(x - 4.5, fy);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Rotor bar, body, eye.
    ctx.strokeStyle = live ? '#9fb4c8' : '#4a5668';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x - R * 1.5, y - R * 0.5); ctx.lineTo(x + R * 1.5, y - R * 0.5); ctx.stroke();
    if (live) {
      const w = R * (0.9 + 0.45 * Math.sin(now * 26 + this._spin));
      ctx.strokeStyle = 'rgba(190,230,255,0.55)';
      ctx.beginPath(); ctx.moveTo(x - R * 1.5 - w / 2, y - R * 0.9); ctx.lineTo(x - R * 1.5 + w / 2, y - R * 0.9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + R * 1.5 - w / 2, y - R * 0.9); ctx.lineTo(x + R * 1.5 + w / 2, y - R * 0.9); ctx.stroke();
    }
    ctx.fillStyle = live ? '#7dff9a' : '#2b3442';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = live ? '#07140c' : '#1a2230';
    ctx.beginPath(); ctx.arc(x, y, R * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.working ? (this.onFire ? '#8fe4ff' : '#ffd700') : live ? '#7dff9a' : '#3d4a5c';
    ctx.beginPath(); ctx.arc(x + R * 0.2, y, R * 0.3, 0, Math.PI * 2); ctx.fill();
  }
}
