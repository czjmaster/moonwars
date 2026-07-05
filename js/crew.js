/* ============================================================
   MOON WARS — crew.js
   Crew member system.
   Skills, XP, pathfinding, task assignment, combat.
   Mirrors FTL crew mechanics: independent skill levelling,
   3 mastered skills max per crew member, star rating display.
   ============================================================ */

'use strict';

// ── Skill definitions ─────────────────────────────────────

const SKILL_DEFS = {
  piloting:   { label: 'Piloting',   color: '#ffd700', xpPerLevel: [50,150] },
  weapons:    { label: 'Weapons',    color: '#ff7c20', xpPerLevel: [50,150] },
  engines:    { label: 'Engines',    color: '#1aff8c', xpPerLevel: [50,150] },
  repair:     { label: 'Repair',     color: '#4db8ff', xpPerLevel: [50,150] },
  firefight:  { label: 'Firefight',  color: '#ff2d44', xpPerLevel: [50,150] },
  breach:     { label: 'Breach Rep', color: '#cc44ff', xpPerLevel: [50,150] },
  shields:    { label: 'Shields',    color: '#1a8cff', xpPerLevel: [50,150] },
  combat:     { label: 'Combat',     color: '#ff4444', xpPerLevel: [50,150] },
};

const MAX_SKILL_LEVEL = 3;
const MAX_MASTERED    = 3;

// ── Names pool ────────────────────────────────────────────

const CREW_NAMES = [
  'Orion','Vega','Lyra','Atlas','Nova','Rex','Juno','Titan',
  'Zara','Cass','Drake','Mira','Pyx','Sol','Echo','Rigel',
  'Cora','Dax','Iris','Mars','Nyx','Pax','Quinn','Rho',
  'Sable','Talon','Uma','Vox','Wren','Xeno','Yuki','Zeb',
];

// ── Corporations (nations) ─────────────────────────────────
const CORP_DEFS = {
  aquarius: {
    label: 'Aquarius', color: '#4db8ff',
    xpBonus: { shields: 2, repair: 2 },
  },
  pegasus: {
    label: 'Pegasus', color: '#9fdcff',
    xpBonus: { piloting: 2 },
  },
  terra: {
    label: 'Terra', color: '#ff9a40',
    xpBonus: { engines: 2 },
    cyborg: true,
  },
  phoenix: {
    label: 'Phoenix', color: '#ff5544',
    xpBonus: { weapons: 2, combat: 2, firefight: 2 },
  },
};
const CORP_KEYS = Object.keys(CORP_DEFS);

// ── Task states ───────────────────────────────────────────

const TASK = {
  IDLE:    'idle',
  MOVE:    'move',
  REPAIR:  'repair',
  FIRE:    'fire',   // firefighting
  BREACH:  'breach',
  FIGHT:   'fight',
  OPERATE: 'operate',
  FLEE:    'flee',
  DIE:     'die',
};

// ── Crew class ────────────────────────────────────────────

class CrewMember {
  constructor(cfg = {}) {
    this.id       = Utils.uid();
    this.name     = cfg.name  || Utils.pick(CREW_NAMES);
    this.isPlayer = cfg.isPlayer ?? true;

    // Corporation (nation): player crew belong to one of 4
    this.race     = cfg.race || (this.isPlayer ? Utils.pick(CORP_KEYS) : 'hostile');
    const corp    = CORP_DEFS[this.race];
    this.color    = corp ? corp.color : '#ff2d44';
    this.cyborg   = corp ? !!corp.cyborg : false;
    this.corpLabel= corp ? corp.label : 'Hostile';

    // Home station — room to return to after tasks
    this.homeRoomId = cfg.homeRoomId ?? null;

    // World position (pixels)
    this.x = cfg.x ?? 0;
    this.y = cfg.y ?? 0;

    // Target position for movement
    this.targetX = this.x;
    this.targetY = this.y;

    // Room the crew is currently in
    this.roomId = cfg.roomId ?? null;

    // Health
    this.hp    = cfg.hp    ?? 100;
    this.maxHp = cfg.maxHp ?? 100;

    // Skills: { skillName: { level, xp } }
    this.skills = {};
    for (const key of Object.keys(SKILL_DEFS)) {
      this.skills[key] = {
        level: cfg.skills?.[key]?.level ?? 0,
        xp:    cfg.skills?.[key]?.xp    ?? 0,
      };
    }

    // Task state
    this.task    = TASK.IDLE;
    this.taskTarget = null;  // room, fire, enemy ref

    // Waypoint queue for floor-aware movement
    this._waypoints = [];

    // Animation
    this.anim    = Animation.crewIdle(!this.isPlayer);
    this._facing = 1;   // 1=right, -1=left

    // Combat
    this.attackTimer = new Utils.Interval(2.0);
    this.killedBy    = null;

    // Death
    this.dying   = false;
    this.dead    = false;
  }

  // ── Skill helpers ────────────────────────────────────────

  getSkillLevel(skill) { return this.skills[skill]?.level ?? 0; }

  addXP(skill, amount) {
    if (!this.skills[skill]) return false;
    // Corporation specialisation: 2x XP in signature skills
    const corp = CORP_DEFS[this.race];
    if (corp && corp.xpBonus && corp.xpBonus[skill]) amount *= corp.xpBonus[skill];
    const sk  = this.skills[skill];
    if (sk.level >= MAX_SKILL_LEVEL) return false;

    // Only allow mastery if below cap
    const mastered = this._countMastered();
    if (sk.level === MAX_SKILL_LEVEL - 1 && mastered >= MAX_MASTERED) return false;

    sk.xp += amount;
    const threshold = SKILL_DEFS[skill].xpPerLevel[sk.level] ?? 200;
    if (sk.xp >= threshold) {
      sk.xp  -= threshold;
      sk.level++;
      Audio.sfx.levelUp();
      return true;  // levelled up
    }
    return false;
  }

  _countMastered() {
    return Object.values(this.skills).filter(s => s.level >= MAX_SKILL_LEVEL).length;
  }

  /** Silver star = 1 mastered, gold star = 3 mastered */
  getStarRating() {
    const m = this._countMastered();
    if (m >= MAX_MASTERED) return 'gold';
    if (m >= 1)            return 'silver';
    return 'none';
  }

  // ── Bonus multipliers ────────────────────────────────────

  repairSpeed()    { return 1 + this.getSkillLevel('repair')   * 0.5; }
  firefightSpeed() { return 1 + this.getSkillLevel('firefight')* 0.5; }
  breachSpeed()    { return 1 + this.getSkillLevel('breach')   * 0.5; }
  combatDamage()   { return 1 + this.getSkillLevel('combat')   * 0.3; }
  weaponChargeBonus() { return this.getSkillLevel('weapons')   * 0.1; }  // 10% faster per level
  shieldBonus()    { return this.getSkillLevel('shields')      * 0.15; }
  engineBonus()    { return this.getSkillLevel('engines')      * 0.05; }
  pilotBonus()     { return this.getSkillLevel('piloting')     * 0.05; }

  // ── Movement ─────────────────────────────────────────────

  /**
   * Direct move (same floor only) — used internally.
   */
  _setAnim(state) {
    if (this._animState === state) return;   // avoid churning instances
    this._animState = state;
    switch (state) {
      case 'walk':
        this.anim = this.isPlayer
          ? Animation.crewByColor('walk', this.color)
          : Animation.crewWalk(true);
        break;
      case 'idle':
        this.anim = this.isPlayer
          ? Animation.crewByColor('idle', this.color)
          : Animation.crewIdle(true);
        break;
      case 'repair': this.anim = Animation.crewRepair(); break;
      case 'fight':  this.anim = Animation.crewFight();  break;
      case 'die':    this.anim = Animation.crewDie();    break;
    }
  }

  moveTo(x, y) {
    this._waypoints = [{ x, y }];
    this.task = TASK.MOVE;
    this._setAnim('walk');
  }

  /**
   * Floor-aware movement. Crew walk horizontally within a floor;
   * changing floors requires routing through an elevator shaft.
   * @param {Ship} ship
   * @param {number} tx - target world x
   * @param {number} ty - target world y
   */
  moveToOnShip(ship, tx, ty) {
    const curFloor = ship.floorAtY(this.y);
    const dstFloor = ship.floorAtY(ty);

    if (curFloor === dstFloor || curFloor === -1 || dstFloor === -1) {
      // Same floor — straight horizontal walk
      this._waypoints = [{ x: tx, y: ship.floorWalkY(dstFloor !== -1 ? dstFloor : curFloor, ty) }];
    } else {
      // Need elevator
      const route = ship.elevators.findPath(this.x, this.y, ty);
      if (!route) {
        // No usable elevator — cooldown stops per-frame retry spam
        this._pathRetryCd = 1.0;
        return false;
      }
      const walkY1 = ship.floorWalkY(curFloor, this.y);
      const walkY2 = ship.floorWalkY(dstFloor, ty);
      this._waypoints = [
        { x: route.entryX, y: walkY1 },                              // walk to shaft
        { x: route.entryX, y: walkY2,                                 // ride shaft
          elevator: route.shaft,
          srcY: route.entryY, dstY: route.exitY,
          srcFloor: route.srcFloor, dstFloor: route.dstFloor,
          phase: 'call' },
        { x: tx, y: walkY2 },                                         // walk to target
      ];
    }
    this.task = TASK.MOVE;
    this._setAnim('walk');
    return true;
  }

  assignTask(task, target = null) {
    this.task       = task;
    this.taskTarget = target;

    switch (task) {
      case TASK.REPAIR:  this._setAnim('repair'); break;
      case TASK.FIGHT:   this._setAnim('fight');  break;
      case TASK.FIRE:
      case TASK.BREACH:  this._setAnim('repair'); break;
      case TASK.IDLE:    this._setAnim('idle');   break;
      default: break;
    }
  }

  // ── Update ───────────────────────────────────────────────

  update(dt, ship) {
    if (this.dead) return;

    if (this._pathRetryCd > 0) this._pathRetryCd -= dt;
    this.anim.update(dt);

    if (this.dying) {
      if (this.anim.done) this.dead = true;
      return;
    }

    this._updateMovement(dt);
    this._updateTask(dt, ship);
    this._regenHp(dt);
  }

  _updateMovement(dt) {
    if (!this._waypoints.length) {
      if (this.task === TASK.MOVE) {
        this.task = TASK.IDLE;
        this._setAnim('idle');
      }
      return;
    }

    const wp = this._waypoints[0];

    // ── Elevator waypoint: call cabin → board → shaft carries us ──
    if (wp.elevator) {
      const shaft = wp.elevator;

      if (!shaft.isUsable()) {
        this._waypoints.length = 0;
        this.task = TASK.IDLE;
        this._setAnim('idle');
        return;
      }

      // Currently riding — shaft drives our position; wait for release
      if (this._ridingShaft) return;

      if (this._elevatorArrived) {
        // Shaft released us at destination floor
        this._elevatorArrived = false;
        this.y = wp.y;
        this._waypoints.shift();
        return;
      }

      // Waiting at the shaft: summon cabin, board when it arrives
      if (shaft.cabinAt(wp.srcY, 14)) {
        shaft.board(this, wp.dstFloor);
      } else if (!shaft._moving && !shaft.passenger) {
        shaft.moveCabinTo(wp.srcFloor);
      }
      // If another crew member occupies the cabin we simply keep waiting.
      return;
    }

    // ── Regular walk waypoint ─────────────────────────────────
    const dx = wp.x - this.x;
    const dy = wp.y - this.y;
    const d  = Math.sqrt(dx*dx + dy*dy);
    const SPEED = 60 + this.getSkillLevel('engines') * 10;

    if (d > 2) {
      const step = Math.min(SPEED * dt, d);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      if (Math.abs(dx) > 1) this._facing = dx > 0 ? 1 : -1;
    } else {
      this.x = wp.x;
      this.y = wp.y;
      this._waypoints.shift();
      if (!this._waypoints.length && this.task === TASK.MOVE) {
        this.task = TASK.IDLE;
        this._setAnim('idle');
      }
    }
  }

  _updateTask(dt, ship) {
    if (!ship) return;

    switch (this.task) {
      case TASK.REPAIR: {
        const room = ship.getRoomById(this.taskTarget);
        if (!room) { this.assignTask(TASK.IDLE); break; }
        // Done repairing?
        if (!room.system || room.system.damagedLevels <= 0) {
          this.assignTask(TASK.IDLE);
          break;
        }
        const dist = Utils.dist(this.x, this.y, room.cx, room.cy);
        if (dist < 34) {
          room.repair(dt * this.repairSpeed(), this);
          // Repair sparks feedback
          if (Math.random() < 0.15) Particles.repairSparks(this.x + Utils.randFloat(-8,8), this.y - 10);
        } else if (!this._waypoints.length && !(this._pathRetryCd > 0)) {
          this.moveToOnShip(ship, room.cx, room.cy);
          this.task = TASK.REPAIR;
        }
        break;
      }

      case TASK.FIRE: {
        const fire = this.taskTarget;
        if (!fire || fire.out) { this.assignTask(TASK.IDLE); break; }
        const fdist = Utils.dist(this.x, this.y, fire.x, fire.y);
        if (fdist < 34) {
          fire.suppress(dt * this.firefightSpeed());
          this.addXP('firefight', dt * 2.5);
        } else if (!this._waypoints.length && !(this._pathRetryCd > 0)) {
          this.moveToOnShip(ship, fire.x, fire.y);
          this.task = TASK.FIRE;
        }
        break;
      }

      case TASK.BREACH: {
        const breach = this.taskTarget;
        if (!breach || breach.sealed) { this.assignTask(TASK.IDLE); break; }
        const bdist = Utils.dist(this.x, this.y, breach.x, breach.y);
        if (bdist < 30) {
          breach.repair(dt * this.breachSpeed(), this);
        } else if (!this._waypoints.length && !(this._pathRetryCd > 0)) {
          this.moveToOnShip(ship, breach.x, breach.y);
          this.task = TASK.BREACH;
        }
        break;
      }

      case TASK.FIGHT: {
        const enemy = this.taskTarget;
        if (!enemy || enemy.dead) { this.assignTask(TASK.IDLE); break; }
        const cdist = Utils.dist(this.x, this.y, enemy.x, enemy.y);
        if (cdist < 24) {
          if (this.attackTimer.tick(dt)) {
            const dmg = 10 * this.combatDamage();
            enemy.takeDamage(dmg, 'crew');
            Audio.sfx.repair();
          }
        } else if (!this._waypoints.length && !(this._pathRetryCd > 0)) {
          this.moveToOnShip(ship, enemy.x, enemy.y);
          this.task = TASK.FIGHT;
        }
        break;
      }

      case TASK.OPERATE: {
        // Standing at system — handled by system itself
        break;
      }

      case TASK.IDLE: {
        // FTL behaviour: idle crew automatically handle problems in their room
        // Priority: fire > breach > repair damaged system
        const room = ship.getRoomById(this.roomId);
        if (!room) break;

        const fire = ship.fires.getFiresInRoom(room.id)[0];
        if (fire) { this.assignTask(TASK.FIRE, fire); break; }

        const breach = ship.breaches.getBreachesInRoom(room.id)[0];
        if (breach) { this.assignTask(TASK.BREACH, breach); break; }

        if (room.system && room.system.damagedLevels > 0) {
          this.assignTask(TASK.REPAIR, room.id);
          break;
        }

        // Nothing wrong here — return to assigned station (FTL behaviour)
        if (this.homeRoomId && this.roomId !== this.homeRoomId &&
            !this._waypoints.length && !(this._pathRetryCd > 0)) {
          const home = ship.getRoomById(this.homeRoomId);
          if (home) this.moveToOnShip(ship, home.cx, home.cy);
        }
        break;
      }
    }
  }

  _regenHp(dt) {
    // Medbay regen is handled by the system, not here
    if (this.hp < this.maxHp && this.task === TASK.IDLE) {
      // Slow natural regen
      this.hp = Math.min(this.maxHp, this.hp + 2 * dt);
    }
  }

  // ── Damage / death ───────────────────────────────────────

  takeDamage(amount, source = 'unknown') {
    if (this.dying || this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp       = 0;
      this.dying    = true;
      this.killedBy = source;
      this._setAnim('die');
      Particles.crewDie(this.x, this.y);
      Audio.sfx.crewDie();

      // Add to persistent graveyard
      if (this.isPlayer) Save.addToGraveyard(this);
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  // ── Draw ─────────────────────────────────────────────────

  draw(ctx) {
    if (this.dead) return;

    ctx.save();

    if (this._facing === -1) {
      ctx.scale(-1, 1);
      ctx.translate(-this.x * 2, 0);
    }

    this.anim.draw(ctx, this.x, this.y, 32, 32);

    ctx.restore();

    // Health bar above crew
    if (this.hp < this.maxHp) {
      const bw = 24, bh = 3;
      const bx = this.x - bw/2;
      const by = this.y - 20;
      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.hp / this.maxHp > 0.5 ? '#1aff8c' : '#ff2d44';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }

    // Name label — always visible, corporation-colored, dark backing
    ctx.save();
    ctx.font = '9px Share Tech Mono, monospace';
    const nw = ctx.measureText(this.name).width + 6;
    ctx.fillStyle = 'rgba(7,8,15,0.75)';
    ctx.fillRect(this.x - nw/2, this.y - 32, nw, 11);
    ctx.fillStyle = this.isPlayer ? this.color : '#ff4444';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, this.x, this.y - 23);
    ctx.restore();
  }

  // ── Serialise / deserialise ───────────────────────────────

  serialise() {
    return {
      id: this.id, name: this.name, race: this.race, isPlayer: this.isPlayer,
      x: this.x, y: this.y, roomId: this.roomId,
      hp: this.hp, maxHp: this.maxHp,
      skills: Utils.deepClone(this.skills),
    };
  }

  static deserialise(data) {
    return new CrewMember(data);
  }
}

// ── Crew roster helper ────────────────────────────────────

/** Build a starting crew of 3 */
function makeStartingCrew() {
  const names = Utils.shuffle([...CREW_NAMES]).slice(0, 3);
  return [
    new CrewMember({ name: names[0], skills: { piloting: {level:1,xp:0}, engines:{level:1,xp:0} } }),
    new CrewMember({ name: names[1], skills: { weapons:  {level:1,xp:0}, combat: {level:0,xp:0} } }),
    new CrewMember({ name: names[2], skills: { repair:   {level:1,xp:0}, firefight:{level:0,xp:0} } }),
  ];
}

/** Build a random enemy crew of given size */
function makeEnemyCrew(size = 3) {
  const result = [];
  for (let i = 0; i < size; i++) {
    const c = new CrewMember({
      isPlayer: false,
      name: Utils.pick(CREW_NAMES),
    });
    // Give random base skills
    const skills = Utils.shuffle(Object.keys(SKILL_DEFS)).slice(0, 2);
    skills.forEach(sk => { c.skills[sk].level = 1; });
    result.push(c);
  }
  return result;
}
