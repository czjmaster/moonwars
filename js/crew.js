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

const CREW_RACES = ['human', 'robot', 'alien'];

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
    this.race     = cfg.race  || 'human';
    this.isPlayer = cfg.isPlayer ?? true;

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

    // Path: array of {x,y} waypoints
    this._path   = [];
    this._pathTimer = new Utils.Interval(0.12);

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

  moveTo(x, y) {
    this.targetX = x;
    this.targetY = y;
    this.task    = TASK.MOVE;
    this.anim    = Animation.crewWalk(!this.isPlayer);
  }

  assignTask(task, target = null) {
    this.task       = task;
    this.taskTarget = target;

    switch (task) {
      case TASK.REPAIR:  this.anim = Animation.crewRepair(); break;
      case TASK.FIGHT:   this.anim = Animation.crewFight();  break;
      case TASK.FIRE:
      case TASK.BREACH:  this.anim = Animation.crewRepair(); break;
      case TASK.IDLE:    this.anim = Animation.crewIdle(!this.isPlayer); break;
      default: break;
    }
  }

  // ── Update ───────────────────────────────────────────────

  update(dt, ship) {
    if (this.dead) return;

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
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const d  = Math.sqrt(dx*dx + dy*dy);
    const SPEED = 60 + this.getSkillLevel('engines') * 10;

    if (d > 2) {
      const step = Math.min(SPEED * dt, d);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      this._facing = dx > 0 ? 1 : -1;

      if (this.task !== TASK.DIE && this.task !== TASK.FIGHT && this.task !== TASK.REPAIR) {
        if (!(this.anim instanceof Animation.AnimationInstance &&
              this.anim.frames === Animation.crewWalk(!this.isPlayer).frames)) {
          this.anim = Animation.crewWalk(!this.isPlayer);
        }
      }
    } else if (this.task === TASK.MOVE) {
      this.task = TASK.IDLE;
      this.anim = Animation.crewIdle(!this.isPlayer);
    }
  }

  _updateTask(dt, ship) {
    if (!ship) return;

    switch (this.task) {
      case TASK.REPAIR: {
        const room = ship.getRoomById(this.taskTarget);
        if (!room) { this.assignTask(TASK.IDLE); break; }
        const dist = Utils.dist(this.x, this.y, room.cx, room.cy);
        if (dist < 20) {
          room.repair(dt * this.repairSpeed(), this);
        } else {
          this.moveTo(room.cx, room.cy);
        }
        break;
      }

      case TASK.FIRE: {
        const fire = this.taskTarget;
        if (!fire || fire.out) { this.assignTask(TASK.IDLE); break; }
        const fdist = Utils.dist(this.x, this.y, fire.x, fire.y);
        if (fdist < 24) {
          fire.suppress(dt * this.firefightSpeed());
        } else {
          this.moveTo(fire.x, fire.y);
        }
        break;
      }

      case TASK.BREACH: {
        const breach = this.taskTarget;
        if (!breach || breach.sealed) { this.assignTask(TASK.IDLE); break; }
        const bdist = Utils.dist(this.x, this.y, breach.x, breach.y);
        if (bdist < 20) {
          breach.repair(dt * this.breachSpeed(), this);
        } else {
          this.moveTo(breach.x, breach.y);
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
        } else {
          this.moveTo(enemy.x, enemy.y);
        }
        break;
      }

      case TASK.OPERATE: {
        // Standing at system — handled by system itself
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
      this.anim     = Animation.crewDie();
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

    // Name label (shown when selected or hovered)
    if (this._showLabel) {
      ctx.fillStyle = this.isPlayer ? '#4db8ff' : '#ff4444';
      ctx.font      = '8px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.name, this.x, this.y + 22);
    }
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
