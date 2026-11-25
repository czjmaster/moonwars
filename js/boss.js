/* ============================================================
   MOON WARS — boss.js
   Apophis — multi-phase final boss.
   Sector 8 encounter. Each phase unlocks new weapons/abilities.
   ============================================================ */

'use strict';

const BOSS_PHASES = [
  {
    phase: 1,
    label: 'Apophis',
    hullMax: 40,
    weapons: ['laser_heavy', 'laser_burst', 'missile_basic'],   // 3 guns, 3 modules
    crew: 6,
    difficulty: 'boss',
    music: 'boss',
    taunt: 'You dare approach Apophis?',
  },
  // Sector-2/3 bosses with their own gimmicks come later —
  // this station is a SINGLE continuous fight.
];

/** Which boss ends a contract. `station` is the long haul; `elite` is
 *  the short Border Patrol contract — a beefed-up gunship rather than a
 *  whole station, so a 2-sector run has a real but fair finale. */
const BOSS_VARIANTS = {
  station: {
    layout: 'boss_station',
    phases: BOSS_PHASES,
    reward: 150,
  },
  /* THE SECTOR-2 BOSS: AN EASY CARRIER (update258, jj 22.11: „boss sektora 2 — lotniskowiec, łatwy: 1 działko,
     1 myśliwiec, kapitan; załoga z bronią od metalu do helu (rzadko)" + 25.11: z robotem). Terra's GEB with one
     gun, one fighter in her bay, a captain in the chair, a BASTION repair robot below — and her people only now and
     then armed, at ordinary rarity: not the best of the sector like Apophis's. Border Patrol and No Questions Asked
     end at her. (`elite`, the old warlord's gunship, stays for a run saved before 258.) */
  carrier: {
    layout: 'enemy_geb',
    reward: 90,
    phases: [{
      phase: 1,
      label: 'Rakh’s Carrier',
      hullMax: 22,
      weapons: ['laser_basic'],
      crew: 4,
      armChance: 0.35,                 // „rzadko": about one hand in three carries a weapon
      plainRarity: true,               // metal … helium as anyone rolls it, no boss step up
      robots: [['terra', 'repair']],
      difficulty: 'boss',
      music: 'boss',
      taunt: 'My fighter will find you first, hauler.',
    }],
  },
  elite: {
    layout: 'enemy_gunship',
    reward: 90,
    phases: [{
      phase: 1,
      label: 'Warlord Rakh',
      hullMax: 26,
      weapons: ['laser_burst', 'laser_heavy'],
      crew: 4,
      difficulty: 'boss',
      music: 'boss',
      taunt: 'You are a long way from home, hauler.',
    }],
  },
};

class BossBattle {
  constructor() {
    this._phase     = 0;
    this._ship      = null;
    this._active    = false;
    this._phaseComplete = false;
    this._variant   = 'station';   // which contract's boss (see BOSS_VARIANTS)
  }

  get variantDef() { return BOSS_VARIANTS[this._variant] || BOSS_VARIANTS.station; }
  get phases()     { return this.variantDef.phases; }

  get isActive() { return this._active; }
  get phase()    { return this._phase; }
  get ship()     { return this._ship; }

  start(phase = 0, worldX = 700, worldY = 50, variant = null) {
    if (variant && BOSS_VARIANTS[variant]) this._variant = variant;
    this._phase   = Utils.clamp(phase, 0, this.phases.length - 1);
    this._active  = true;
    this._phaseComplete = false;
    this._buildPhaseShip(worldX, worldY);
    Audio.playMusic('boss');
    Audio.sfx.bossWarning();
    return this._ship;
  }

  _buildPhaseShip(wx, wy) {
    const def   = this.phases[this._phase];

    // Hull depends on the contract: Apophis is a vertical
    // STATION (6 floors, central lift, three weapon modules); the
    // Border Patrol boss is a heavy gunship.
    this._ship = new Ship(this.variantDef.layout, false, wx, wy);
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

    // The boss is deep in the run by definition — his people are the
    // best the sector produces (update55).
    const sector = (typeof Save !== 'undefined' ? (Save.getRun()?.sector ?? 5) : 5);
    const crew = makeEnemyCrew(def.crew, this._ship.layoutKey, sector,
                               { boss: true });             // his people are armed (update174)
    /* …ONLY NOW AND THEN, on an easy boss (update258): a weapon for about one in three, at ordinary rarity */
    if (def.armChance != null && typeof CrewArms !== 'undefined') {
      crew.forEach(c => {
        const armed = Math.random() < def.armChance;
        c.sidearm = armed ? CrewArms.rollEnemy(sector, true) : null;
        c.sidearmRarity = armed ? (CrewArms.rollEnemyRarity?.(!def.plainRarity) ?? null) : null;
      });
    }
    /* …AND HER ROBOTS (update258) */
    if (def.robots && typeof Robots !== 'undefined') {
      def.robots.forEach(([race, kind]) => crew.push(Robots.make(race, kind, { isPlayer: false })));
    }
    crew.forEach(c => this._ship.addCrew(c));
    this._ship.assignStations();
    /* AND A MEDICINE CHEST (update93a): his medics play by the same rules
       as everybody's, and rules without supplies are no rules. Four boxes
       of five. */
    if (this._ship.cargo) for (let i = 0; i < 4; i++) this._ship.cargo.add('medkit');

    // Big reactor covering everything, then allocate
    // Reactor sized to the phase's real power need (same rule as
    // regular enemies), capped by the hull limit.
    const need = this._ship.systems
      .filter(s => s.type !== 'reactor')
      .reduce((a, s) => a + s.maxPower, 0);
    this._ship.reactor.level = Math.min(need, this._ship.reactor.maxLevel);
    this._ship._allocateDefaultPower();
    // A boss runs three pips of air at least, powered on top (update87).
    this._ship.sizeAirForCrew(crew.length, { boss: true });
    this._ship.prechargeShields();   // shields UP the moment battle starts
    this._ship.snapToStations?.();   // …and every man at his post (update97)
    this._seatCommander();
  }

  /* ── THE BOSS ALWAYS HAS A COMMANDER (update93a) ─────────────
   * `_startCombat` promised it ("the boss always has one") — but the
   * boss is never started through `_startCombat`, so Apophis flew with
   * nobody in the chair. Seated with every phase hull: the SAME man
   * across phases (`captain`), a fresh one only after `reset`. */
  _seatCommander() {
    if (typeof Commander === 'undefined' || !Commander.rollEnemy || !this._ship) return null;
    const sec = (typeof Save !== 'undefined' ? (Save.getRun()?.sector ?? 1) : 1);
    if (!this.captain) this.captain = Commander.rollEnemy(sec, { level: 6 + sec, chips: 2 });
    Commander.setEnemy(this.captain);
    this._ship.commander = this.captain;
    Commander.reseatMaxHp?.(this._ship.crew);
    return this.captain;
  }

  /**
   * Call each tick — checks if boss phase ended.
   * @returns {string|null} 'next_phase' | 'defeated' | null
   */
  update(dt) {
    if (!this._active || !this._ship) return null;

    if (this._ship.hull <= 0 && !this._phaseComplete) {
      this._phaseComplete = true;

      if (this._phase < this.phases.length - 1) {
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
    return this.phases[this._phase] || this.phases[0];
  }

  get totalPhases() { return this.phases.length; }

  /** Forget all progress — called on a new run */
  reset(variant = 'station') {
    this._phase = 0;
    this._ship  = null;
    this._active = false;
    this._phaseComplete = false;
    this.captain = null;     // a fresh boss gets a fresh commander (update93a)
    if (BOSS_VARIANTS[variant]) this._variant = variant;
  }

  get scrapReward() {
    return this.variantDef.reward + this._phase * 50;
  }
}

// Singleton
const BossManager = new BossBattle();
