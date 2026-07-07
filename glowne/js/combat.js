/* ============================================================
   MOON WARS — combat.js
   Battle state machine.
   Manages the combat loop between player and enemy ship:
   enemy AI targeting, auto-fire, boarding, retreat logic.
   ============================================================ */

'use strict';

// ── Combat state ──────────────────────────────────────────

const COMBAT_STATE = {
  IDLE:      'idle',       // no combat
  ENTERING:  'entering',   // ships flying in
  ACTIVE:    'active',     // combat ongoing
  VICTORY:   'victory',    // player won
  DEFEAT:    'defeat',     // player lost
  RETREATING:'retreating', // player is retreating
  FLED:      'fled',       // escaped
};

// ── Enemy AI difficulty levels ────────────────────────────

const AI_DEFS = {
  easy:   { fireDelay: 1.5, targetRandom: 0.6, retreatHull: 0 },
  normal: { fireDelay: 1.0, targetRandom: 0.3, retreatHull: 0 },
  hard:   { fireDelay: 0.7, targetRandom: 0.1, retreatHull: 0 },
  boss:   { fireDelay: 0.5, targetRandom: 0.0, retreatHull: 0 },
};

class Combat {
  constructor() {
    this.state        = COMBAT_STATE.IDLE;
    this.playerShip   = null;
    this.enemyShip    = null;

    // All in-flight projectiles across both ships
    this._projectiles = [];

    // Enemy AI
    this._ai           = AI_DEFS.normal;
    this._aiFireTimers = [];    // one per enemy weapon
    this._aiTargetRoom = null;  // which player room AI is aiming at

    // Retreat
    this._retreatTimer = 0;
    this._retreatCost  = 0;   // fuel cost

    // Enter animation
    this._enterTimer   = 0;
    this._enterDone    = false;

    // Outcome
    this.scrapReward   = 0;
    this.weaponDrop    = null;

    // Timers
    this._stateTimer   = 0;
  }

  // ── Start / stop ─────────────────────────────────────────

  begin(playerShip, enemyShip, difficulty = 'normal') {
    this.state       = COMBAT_STATE.ENTERING;
    this.playerShip  = playerShip;
    this.enemyShip   = enemyShip;
    this._ai         = AI_DEFS[difficulty] || AI_DEFS.normal;
    this._projectiles = [];
    this._enterTimer  = 0;
    this._stateTimer  = 0;

    // Initialise AI fire timers
    this._aiFireTimers = enemyShip.weapons.map(() => 0);

    // Surrender machinery
    this._surrenderRolled = false;
    this.surrenderOffer   = false;

    // Random scrap reward
    const sector = Save.getRun()?.sector ?? 1;
    this.scrapReward = Utils.randInt(10 + sector * 5, 30 + sector * 10);
    this.weaponDrop  = Math.random() < 0.25 ? randomWeaponDrop(sector) : null;

    Audio.playMusic('combat');
  }

  end() {
    this._projectiles = [];
    this.state        = COMBAT_STATE.IDLE;
    this.playerShip   = null;
    this.enemyShip    = null;
    Audio.stopMusic(1.5);
  }

  initiateRetreat(fuelCost = 1) {
    if (this.state !== COMBAT_STATE.ACTIVE) return false;
    this.state         = COMBAT_STATE.RETREATING;
    this._retreatTimer = 0;
    this._retreatCost  = fuelCost;
    return true;
  }

  // ── Update ───────────────────────────────────────────────

  update(dt) {
    if (this.state === COMBAT_STATE.IDLE) return;

    this._stateTimer += dt;

    switch (this.state) {
      case COMBAT_STATE.ENTERING:   this._updateEntering(dt);   break;
      case COMBAT_STATE.ACTIVE:     this._updateActive(dt);     break;
      case COMBAT_STATE.RETREATING: this._updateRetreating(dt); break;
      case COMBAT_STATE.VICTORY:
      case COMBAT_STATE.DEFEAT:     /* handled by Game */        break;
    }

    // Always update projectiles
    this._updateProjectiles(dt);
  }

  _updateEntering(dt) {
    this._enterTimer += dt;
    if (this._enterTimer >= 1.5) {
      this.state = COMBAT_STATE.ACTIVE;
    }
  }

  _updateActive(dt) {
    if (!this.playerShip || !this.enemyShip) return;

    // Check win/lose — hull gone OR the entire crew is dead
    const crewAlive = this.playerShip.crew.some(c => !c.dead && !c.dying);
    if (this.playerShip.hull <= 0 || this.playerShip.destroyed || !crewAlive) {
      this.state = COMBAT_STATE.DEFEAT;
      Audio.playMusic('explore');
      return;
    }
    if (this.enemyShip.hull <= 0 || this.enemyShip.destroyed) {
      this._onVictory();
      return;
    }

    // Badly hurt enemies may offer surrender — once, never the boss
    if (!this._surrenderRolled &&
        this.enemyShip.hull <= this.enemyShip.hullMax * 0.3) {
      this._surrenderRolled = true;
      if (this._ai !== AI_DEFS.boss && Math.random() < 0.4) {
        this.surrenderOffer = true;
      }
    }

    // Enemy AI
    this._updateAI(dt);
  }

  _updateRetreating(dt) {
    this._retreatTimer += dt;
    if (this._retreatTimer >= 3.0) {
      // Spend fuel, escape
      const run = Save.getRun();
      if (run) {
        const newFuel = Math.max(0, run.fuel - this._retreatCost);
        Save.updateRun({ fuel: newFuel });
      }
      this.state = COMBAT_STATE.FLED;
    }
  }

  _onVictory() {
    this.state = COMBAT_STATE.VICTORY;

    // Award scrap to run
    const run = Save.getRun();
    if (run) {
      Save.updateRun({ scrap: run.scrap + this.scrapReward });
    }

    // Crew XP for surviving combat
    this.playerShip.crew.forEach(c => {
      c.addXP('combat', 15);
    });

    Particles.explosion(
      this.enemyShip.worldX + this.enemyShip.spriteW / 2,
      this.enemyShip.worldY + this.enemyShip.spriteH / 2,
      2.0
    );
    Audio.sfx.explosion();
    Camera.shake(16, 0.6);
    Audio.playMusic('explore');
  }

  // ── Enemy AI ──────────────────────────────────────────────

  _updateAI(dt) {
    const enemy  = this.enemyShip;
    const player = this.playerShip;

    // Pick target room (change occasionally)
    if (!this._aiTargetRoom || Math.random() < 0.005) {
      if (Math.random() < this._ai.targetRandom) {
        this._aiTargetRoom = Utils.pick(player.rooms);
      } else {
        // Prefer shields, then a RANDOM weapon module, then the reactor
        const wRooms = player.rooms.filter(r => r.type === 'weapons');
        this._aiTargetRoom =
          player.rooms.find(r => r.type === 'shields' && r.system) ||
          (wRooms.length ? Utils.pick(wRooms) : null) ||
          player.rooms.find(r => r.type === 'reactor') ||
          Utils.pick(player.rooms);
      }
    }

    // Fire each armed enemy weapon
    enemy.weapons.forEach((w, i) => {
      if (!w || !w.armed) return;

      this._aiFireTimers[i] = (this._aiFireTimers[i] ?? 0) + dt;
      if (this._aiFireTimers[i] < this._ai.fireDelay) return;
      this._aiFireTimers[i] = 0;

      const eb = enemy.roomBounds ? enemy.roomBounds() : { x: enemy.worldX, y: enemy.worldY, w: 300, h: 200 };
      const fromX = eb.x - 10;
      const fromY = eb.y + eb.h / 2;
      const toX   = this._aiTargetRoom.cx;
      const toY   = this._aiTargetRoom.cy;

      const projs = w.fire(fromX, fromY, toX, toY, false);
      this._projectiles.push(...projs);
    });

    // Enemy crew AI — dispatch exactly ONE crew member per problem,
    // picking the closest (repair skill breaks ties).
    // SMART PILOT RULE: the crew member seated in the cockpit is only
    // ever pulled away if there is NOBODY else available — losing the
    // pilot means losing evasion. (Cockpit damage is fixed in place by
    // the pilot himself via idle auto-repair.)
    const pilotRoomId = enemy.getSystem('piloting')?.roomId ?? null;
    const pickBest = (x, y, skill) => {
      let idle = enemy.crew.filter(c => c.task === TASK.IDLE && !c.dead && !c.dying);
      if (!idle.length) return null;
      const nonPilots = idle.filter(c => c.roomId !== pilotRoomId);
      if (nonPilots.length) idle = nonPilots;   // keep the pilot seated
      idle.sort((a, b) => {
        const da = Utils.dist(a.x, a.y, x, y);
        const db = Utils.dist(b.x, b.y, x, y);
        if (Math.abs(da - db) > 40) return da - db;          // clearly closer wins
        return b.getSkillLevel(skill) - a.getSkillLevel(skill); // tie → better skill
      });
      return idle[0];
    };

    enemy.systems.forEach(sys => {
      if (sys.damagedLevels <= 0) return;
      // Someone already on it? Skip.
      const busy = enemy.crew.some(c =>
        c.task === TASK.REPAIR && c.taskTarget === sys.roomId);
      if (busy) return;
      // Someone already standing in that room? They'll auto-repair it
      // (this keeps the pilot fixing his own cockpit without backup).
      const inRoom = enemy.crew.some(c =>
        !c.dead && !c.dying && c.roomId === sys.roomId);
      if (inRoom) return;
      const best = pickBest(sys.cx, sys.cy, 'repair');
      if (best) {
        best.moveToOnShip(enemy, sys.cx, sys.cy);
        best.assignTask(TASK.REPAIR, sys.roomId);
      }
    });

    enemy.fires.fires.forEach(fire => {
      if (fire.out) return;
      const busy = enemy.crew.some(c =>
        c.task === TASK.FIRE && c.taskTarget === fire);
      if (busy) return;
      const best = pickBest(fire.x, fire.y, 'firefight');
      if (best) {
        best.moveToOnShip(enemy, fire.x, fire.y);
        best.assignTask(TASK.FIRE, fire);
      }
    });
  }

  // ── Projectile management ─────────────────────────────────

  /**
   * Player fires a weapon at the enemy.
   * @param {Weapon} weapon
   */
  /**
   * @param {Weapon} weapon
   * @param {Room|null} targetRoom - specific enemy room, or null = random
   */
  playerFire(weapon, targetRoom = null) {
    if (!weapon || !weapon.armed) return;
    if (this.state !== COMBAT_STATE.ACTIVE) return;

    // Check missile ammo
    if (weapon.def.missileUse > 0) {
      const run = Save.getRun();
      if (!run || run.missiles < weapon.def.missileUse) return;
      Save.updateRun({ missiles: run.missiles - weapon.def.missileUse });
    }

    const enemy  = this.enemyShip;
    const target = targetRoom || Utils.pick(enemy.rooms);

    const pb = this.playerShip.roomBounds ? this.playerShip.roomBounds() : { x: this.playerShip.worldX, y: this.playerShip.worldY, w: 300, h: 200 };
    const fromX = pb.x + pb.w + 10;
    const fromY = pb.y + pb.h / 2;

    const projs  = weapon.fire(fromX, fromY, target.cx, target.cy, true);
    this._projectiles.push(...projs);

    // FTL XP: crew manning THIS gun's module learn from each shot
    const wRoom = this.playerShip.weaponRooms[weapon.slot];
    if (wRoom) {
      this.playerShip.crewInRoom(wRoom.id).forEach(c => c.addXP('weapons', 8));
    }
  }

  _updateProjectiles(dt) {
    this._projectiles.forEach(p => p.update(dt));

    // Handle hits
    this._projectiles.forEach(p => {
      if (!p.hit || p._resolved) return;
      p._resolved = true;

      const targetShip = p.fromPlayer ? this.enemyShip : this.playerShip;
      if (!targetShip) return;

      const result = targetShip.receiveHit(p);

      if (!result.dodged) {
        Particles.laserHit(p.x, p.y);
      }
    });

    // Remove spent projectiles
    this._projectiles = this._projectiles.filter(p => !p.done);
  }

  // ── Draw ─────────────────────────────────────────────────

  draw(ctx) {
    if (this.state === COMBAT_STATE.IDLE) return;
    this._projectiles.forEach(p => p.draw(ctx));
  }

  drawBeams(ctx) {
    this._projectiles.forEach(p => {
      if (p.type === 'beam') {
        const ship = p.fromPlayer ? this.enemyShip : this.playerShip;
        if (ship) p.drawBeam(ctx, ship.worldX, ship.worldY + ship.spriteH/2, ship.spriteW);
      }
    });
  }

  // ── Getters ──────────────────────────────────────────────

  isActive()   { return this.state === COMBAT_STATE.ACTIVE; }
  isVictory()  { return this.state === COMBAT_STATE.VICTORY; }
  isDefeat()   { return this.state === COMBAT_STATE.DEFEAT; }
  isFled()     { return this.state === COMBAT_STATE.FLED; }
  inProgress() {
    return this.state === COMBAT_STATE.ACTIVE ||
           this.state === COMBAT_STATE.ENTERING ||
           this.state === COMBAT_STATE.RETREATING;
  }
}

// Singleton
const CombatManager = new Combat();
