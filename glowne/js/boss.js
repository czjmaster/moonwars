/* ============================================================
   MOON WARS — boss.js
   The Mothership — multi-phase final boss.
   Sector 8 encounter. Each phase unlocks new weapons/abilities.
   ============================================================ */

'use strict';

const BOSS_PHASES = [
  {
    phase: 1,
    label: 'The Mothership',
    hullMax: 40,
    weapons: ['laser_heavy', 'laser_burst', 'missile_basic'],   // 3 guns, 3 modules
    crew: 6,
    difficulty: 'boss',
    music: 'boss',
    taunt: 'You dare approach the Mothership?',
  },
  // Sector-2/3 bosses with their own gimmicks come later —
  // this station is a SINGLE continuous fight.
];

class BossBattle {
  constructor() {
    this._phase     = 0;
    this._ship      = null;
    this._active    = false;
    this._phaseComplete = false;
  }

  get isActive() { return this._active; }
  get phase()    { return this._phase; }
  get ship()     { return this._ship; }

  start(phase = 0, worldX = 700, worldY = 50) {
    this._phase   = Utils.clamp(phase, 0, BOSS_PHASES.length - 1);
    this._active  = true;
    this._phaseComplete = false;
    this._buildPhaseShip(worldX, worldY);
    Audio.playMusic('boss');
    Audio.sfx.bossWarning();
    return this._ship;
  }

  _buildPhaseShip(wx, wy) {
    const def   = BOSS_PHASES[this._phase];

    // The Mothership is a vertical STATION hull: central elevator,
    // modules flanking it, 6 floors, THREE separate weapon modules.
    this._ship = new Ship('boss_station', false, wx, wy);
    this._ship.label   = def.label;
    this._ship.hull    = def.hullMax;
    this._ship.hullMax = def.hullMax;

    // One gun per weapon MODULE — same rules as everyone else:
    // module level = gun's power cost, and it needs an OPERATOR.
    this._ship.weapons = [];
    def.weapons.forEach((wk, i) => this._ship.installWeapon(wk, i));
    this._ship.weapons.forEach((w, i) => {
      if (!w) return;
      const sys = this._ship.weaponSystemFor(i);
      if (sys) { sys.level = w.powerCost; sys.desiredPower = sys.level; }
    });

    const crew = makeEnemyCrew(def.crew);
    crew.forEach(c => this._ship.addCrew(c));
    this._ship.assignStations();

    // Big reactor covering everything, then allocate
    // Reactor sized to the phase's real power need (same rule as
    // regular enemies), capped by the hull limit.
    const need = this._ship.systems
      .filter(s => s.type !== 'reactor')
      .reduce((a, s) => a + s.maxPower, 0);
    this._ship.reactor.level = Math.min(need, this._ship.reactor.maxLevel);
    this._ship._allocateDefaultPower();
    this._ship.prechargeShields();   // shields UP the moment battle starts
  }

  /**
   * Call each tick — checks if boss phase ended.
   * @returns {string|null} 'next_phase' | 'defeated' | null
   */
  update(dt) {
    if (!this._active || !this._ship) return null;

    if (this._ship.hull <= 0 && !this._phaseComplete) {
      this._phaseComplete = true;

      if (this._phase < BOSS_PHASES.length - 1) {
        return 'next_phase';
      } else {
        this._active = false;
        return 'defeated';
      }
    }
    return null;
  }

  /** Advance to next boss phase */
  nextPhase(worldX, worldY) {
    this._phase++;
    this._phaseComplete = false;

    Particles.explosion(
      this._ship.worldX + this._ship.spriteW / 2,
      this._ship.worldY + this._ship.spriteH / 2,
      2
    );

    this._buildPhaseShip(worldX, worldY);
    Audio.sfx.bossWarning();
    return this._ship;
  }

  get currentPhaseDef() {
    return BOSS_PHASES[this._phase] || BOSS_PHASES[0];
  }

  get totalPhases() { return BOSS_PHASES.length; }

  /** Forget all progress — called on a new run */
  reset() {
    this._phase = 0;
    this._ship  = null;
    this._active = false;
    this._phaseComplete = false;
  }

  get scrapReward() {
    // Boss gives generous scrap
    return 150 + this._phase * 50;
  }
}

// Singleton
const BossManager = new BossBattle();
