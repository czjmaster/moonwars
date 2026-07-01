/* ============================================================
   MOON WARS — boss.js
   The Mothership — multi-phase final boss.
   Sector 8 encounter. Each phase unlocks new weapons/abilities.
   ============================================================ */

'use strict';

const BOSS_PHASES = [
  {
    phase: 1,
    label: 'Mothership — Phase I',
    hullMax: 24,
    weapons: ['laser_burst', 'missile_basic'],
    crew: 4,
    difficulty: 'hard',
    music: 'boss',
    taunt: 'You dare approach the Mothership?',
  },
  {
    phase: 2,
    label: 'Mothership — Phase II',
    hullMax: 28,
    weapons: ['laser_heavy', 'ion_basic', 'missile_basic'],
    crew: 5,
    difficulty: 'boss',
    music: 'boss',
    taunt: 'Your resistance is futile.',
  },
  {
    phase: 3,
    label: 'Mothership — Phase III',
    hullMax: 32,
    weapons: ['laser_heavy', 'laser_burst', 'ion_basic', 'cannon_basic'],
    crew: 6,
    difficulty: 'boss',
    music: 'boss',
    taunt: 'NOW YOU SEE MY TRUE POWER.',
  },
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

    // Boss uses a specialised layout built on the fly
    this._ship = new Ship('enemy_frigate', false, wx, wy);
    this._ship.label   = def.label;
    this._ship.hull    = def.hullMax;
    this._ship.hullMax = def.hullMax;

    // Install phase weapons
    this._ship.weapons = [];
    def.weapons.forEach((wk, i) => {
      if (i < this._ship.weaponSlots) this._ship.installWeapon(wk, i);
    });

    // Add crew
    const crew = makeEnemyCrew(def.crew);
    crew.forEach(c => this._ship.addCrew(c));

    // Extra reactor for boss
    this._ship.reactor.level = 12;
    this._ship._allocateDefaultPower?.();
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

  get scrapReward() {
    // Boss gives generous scrap
    return 150 + this._phase * 50;
  }
}

// Singleton
const BossManager = new BossBattle();
