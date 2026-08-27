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
  // HAND-TO-HAND ONLY. Not gunnery, not defence — see meleeDamage().
  combat:     { label: 'Combat',     color: '#ff4444', xpPerLevel: [50,150] },
};

const MAX_SKILL_LEVEL = 3;
const MAX_MASTERED    = 3;

/* Melee constants. Kept here rather than inline so the room brawl and
   an ordered duel cannot drift apart again — they used to hit for
   7+lvl*3 and 10*(1+lvl*0.3) respectively, and only one of them taught
   the man anything. */
const MELEE_BASE_DAMAGE  = 7;
const MELEE_XP_PER_SWING = 10;

/* Moon rats. Feeble in a fight — three swings and it is over — because
   the threat they pose is to the ship, not to the crew. */
const RAT_HP = 18;

// ── Names pool ────────────────────────────────────────────

const CREW_NAMES = [
  'Orion','Vega','Lyra','Atlas','Nova','Rex','Juno','Titan',
  'Zara','Cass','Drake','Mira','Pyx','Sol','Echo','Rigel',
  'Cora','Dax','Iris','Mars','Nyx','Pax','Quinn','Rho',
  'Sable','Talon','Uma','Vox','Wren','Xeno','Yuki','Zeb',
];

// ── Corporations (nations) ─────────────────────────────────
// How readily a bite takes hold, and how long the host has left.
const SPIDER_INFECT_CHANCE  = 0.35;
// Three fights was barely long enough to reach a science post — the
// infection read as an instant death sentence rather than a clock you
// could beat. Six gives the player a run at curing it.
const VIRUS_FIGHTS_TO_DEATH = 6;
const EGG_FIGHTS_TO_HATCH   = 3;

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
  // Not a corporation. Whatever is nesting in the derelicts out here.
  spider: {
    label: 'Void Spider', color: '#9fff7a',
    xpBonus: { combat: 4 },
    spider: true,
  },
  /* MOON RATS (update39). Not a boarding party — a stowaway problem.
     They come aboard out of a heavily loaded hold, and a hold that
     smells of rations is the one they pick. Individually feeble; the
     damage they do is to your MODULES, by chewing through a loom at
     the worst possible moment. */
  rat: {
    label: 'Moon Rat', color: '#b3a189',
    vermin: true,
  },
};
// Spiders and vermin are NOT hireable — keep them out of the roll.
const CORP_KEYS = Object.keys(CORP_DEFS)
  .filter(k => !CORP_DEFS[k].spider && !CORP_DEFS[k].vermin);

/**
 * Corporation colour for a live CrewMember OR for serialised crew data.
 *
 * serialise() does not write `color`, so anything reading the barracks
 * straight out of the save (the base CREW tab) used to fall back to
 * blue — a Terra veteran with a Pegasus-coloured swatch.
 */
function crewColor(c) {
  if (!c) return '#4db8ff';
  const corp = CORP_DEFS[c.race];
  if (corp) return corp.color;
  if (c.color) return c.color;
  return c.isPlayer === false ? '#ff4444' : '#4db8ff';
}

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
  /** Hostile suits. One constant so no animation state can drift off it. */
  static get ENEMY_COLOR() { return '#ff2d44'; }

  constructor(cfg = {}) {
    // The id has to SURVIVE serialisation: the barracks picker, the
    // memorial and the rescue bookkeeping all match on it, and minting a
    // fresh one on every load quietly broke every one of them.
    this.id       = cfg.id || Utils.uid();

    /* SERVICE RECORD. What the memorial reads off the headstone: how
       many ship actions this crewman was aboard for, how many were won,
       how many were run from, and how many of the enemy he personally
       accounted for — with a boarding axe or with the gun he was
       manning when it fired. */
    this.battles  = cfg.battles  ?? 0;
    this.wins     = cfg.wins     ?? 0;
    this.escapes  = cfg.escapes  ?? 0;
    this.kills    = cfg.kills    ?? 0;
    this.name     = cfg.name  || Utils.pick(CREW_NAMES);
    this.isPlayer = cfg.isPlayer ?? true;

    // Corporation (nation): player crew belong to one of 4
    this.race     = cfg.race || (this.isPlayer ? Utils.pick(CORP_KEYS) : 'hostile');
    const corp    = CORP_DEFS[this.race];
    this.isSpider = !!corp?.spider;
    this.isVermin = !!corp?.vermin;

    // ── Void-spider virus ──
    // Deliberately NOT `infected` — that flag is the older corpse
    // plague, which the ordinary clinic already cures. This one only a
    // research post can touch, and it ends with an egg case.
    this.virus       = !!cfg.virus;
    this.virusFights = cfg.virusFights ?? 0;
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
    // Go through _setAnim so SPIDERS get their own sprite from frame one.
    // Assigning crewIdle() straight here left _animState undefined, so a
    // spider that never changed state kept the human enemy sprite — you
    // boarded a wreck and found people in it.
    this.anim = null;
    this._setAnim('idle');
    if (!this.anim) this.anim = Animation.crewIdle(!this.isPlayer);

    // ── Dormant nest ──
    // A spider in an egg sac does nothing until something warm walks in.
    this.dormant = !!cfg.dormant;
    this.hatchT  = cfg.hatchT ?? 0;
    this._facing = 1;   // 1=right, -1=left

    // Combat
    this.attackTimer = new Utils.Interval(2.0);
    this.killedBy    = null;

    // Death & condition states
    this.dying   = false;
    this.dead    = false;
    this._dieT   = 0;
    // 'ok' | 'injured' (downed, can be carried to medbay) | 'dead'
    this.state    = cfg.state ?? 'ok';
    this.infected = cfg.infected ?? false;   // corpse plague
    this.decaying = cfg.decaying ?? false;   // dead + a battle passed
    this._deadCombats = 0;
    this.ejected  = false;    // thrown/walked out the airlock
    this.carriedBy = null;    // crew member carrying this body
    this.carrying  = null;    // body this crew member carries
    this._infT     = 0;       // infected-behaviour timer
    if (this.state === 'dead') this.dead = true;
  }

  /** Downed: lying on the floor, can be picked up and carried */
  get down()  { return this.dead || this.state === 'injured'; }
  /** Fully able: can move, man systems, repair, fight */
  get alive() { return !this.dead && !this.dying && this.state !== 'injured'; }

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
  /* MELEE ONLY (update38).
   *
   * `combat` is a hand-to-hand skill and nothing else: it does not
   * touch gun damage, charge time, accuracy, evasion or boarding
   * defence — those belong to `weapons`, `piloting` and `engines`.
   * Both melee paths (the room brawl and an ordered duel) now go
   * through this one number, so a duel and a brawl hit for the same. */
  meleeDamage()    { return MELEE_BASE_DAMAGE + this.getSkillLevel('combat') * 3; }
  /** XP for one swing. The ONLY way combat XP is ever earned. */
  creditMeleeSwing() { this.addXP('combat', MELEE_XP_PER_SWING); }
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

    // Spiders have their own sprite set — they are not people in suits.
    if (this.isSpider) {
      const mode = state === 'fight' ? 'fight'
                 : state === 'walk'  ? 'walk' : 'idle';
      this.anim = Animation.spiderAnim(mode, this.color);
      return;
    }
    // Nor are rats. Low, long, and nothing like a crewman in a helmet.
    if (this.isVermin) {
      const mode = state === 'fight' ? 'fight'
                 : state === 'walk'  ? 'walk' : 'idle';
      this.anim = Animation.ratAnim(mode, this.color);
      return;
    }

    /* ONE colour, every state (update38).
     *
     * The enemy used to fall through to the uncoloured factory frames —
     * Animation.crewRepair/crewFight/crewDie — and those are generated
     * in the PLAYER's blue. So a hostile who walked over to patch a
     * module turned blue mid-fight and read as one of yours; the same
     * happened when he swung, and when he died. Everyone now goes
     * through the colour-keyed cache with his own suit colour, and the
     * enemy's suit is always hostile red. */
    this.anim = Animation.crewByColor(state, this.suitColor());
  }

  /** The colour this man's suit is drawn in, whatever he is doing.
   *  Enemies are red — never their corporation's colour, never blue. */
  suitColor() {
    return this.isPlayer ? (this.color || '#4db8ff') : CrewMember.ENEMY_COLOR;
  }

  /**
   * Not a person: a spider or a rat.
   *
   * Everything alive aboard a hull lives in one `ship.crew` array, so
   * every question of the form "who can man this / carry that / put out
   * that fire" has to exclude the animals. It used to test `isSpider`
   * in five separate places, which is exactly one place too many the
   * day a second animal turned up.
   */
  get isBeast() { return !!(this.isSpider || this.isVermin); }

  moveTo(x, y) {
    this._waypoints = [{ x, y }];
    this.task = TASK.MOVE;
    this._setAnim('walk');
  }

  /**
   * Where this man will END UP: the last waypoint if he is walking,
   * otherwise where he stands right now.
   *
   * Slot arbitration MUST use this. It used to compare against live
   * positions only, so two crew ordered into an empty cockpit both saw
   * the console as free, both walked to it, and both stood on the same
   * pixel for the rest of the run — neither would move again, because
   * from then on each of them WAS on slot 0 and the settle rule only
   * lets a man move UP to a lower-numbered slot. A man merely en route
   * to the console already owns the console.
   */
  destPoint() {
    const wp = this._waypoints?.[this._waypoints.length - 1];
    return wp ? { x: wp.x, y: wp.y } : { x: this.x, y: this.y };
  }

  /**
   * Floor-aware movement. Crew walk horizontally within a floor;
   * changing floors requires routing through an elevator shaft.
   * @param {Ship} ship
   * @param {number} tx - target world x
   * @param {number} ty - target world y
   */
  moveToOnShip(ship, tx, ty) {
    /* ── RE-ORDERED MID-RIDE ──────────────────────────────────
       A crewman inside a moving cabin has a Y that belongs to no deck,
       so floorAtY() returned -1 and the "same floor, just walk" branch
       below happily plotted a straight line — which is why he appeared
       to fly diagonally out of the shaft the moment the cabin let go,
       leaving the lift behind on the wrong deck.

       He is in a lift. The lift is how he gets there. If the shaft he is
       riding also serves the deck he has just been ordered to, send the
       cabin there instead and let the ride finish; it puts him down on
       the right floor and the walk continues from a position that
       actually exists. */
    if (this._ridingShaft) {
      const shaft = this._ridingShaft;
      const dstF  = ship.floorAtY(ty);
      const stop  = dstF !== -1
        ? shaft.floorYs.findIndex(fy => ship.floorAtY(fy) === dstF)
        : -1;
      if (stop !== -1) {
        shaft.moveCabinTo(stop);              // turn the lift around
        const walkY = ship.floorWalkY(dstF, ty);
        this._waypoints = [
          { x: shaft.x, y: walkY, elevator: shaft,
            srcY: shaft.floorYs[stop], dstY: shaft.floorYs[stop],
            srcFloor: stop, dstFloor: stop, phase: 'ride' },
          { x: tx, y: walkY },
        ];
        this.task = TASK.MOVE;
        this._setAnim('walk');
        return true;
      }
      // This shaft cannot reach it — finish the ride, then re-plan from
      // wherever we end up rather than plotting a route from mid-air.
      this._rerouteAfterRide = { tx, ty };
      return true;
    }

    const curFloor = ship.floorAtY(this.y);
    const dstFloor = ship.floorAtY(ty);

    /* PEOPLE WALK ON THE FLOOR.
     *
     * The console spot sits OPERATOR_LIFT pixels above the deck's walk
     * line, and the previous version put that lifted Y straight into the
     * travel waypoint. A man leaving his console for another module
     * therefore set off at console height and stayed there, gliding
     * above the deck through every room he crossed.
     *
     * The route is built in three parts instead:
     *     step DOWN off the console, if he is on one
     *     walk the deck at walk height
     *     step UP to the console at the far end, if that is where he is
     *       going and the spot is free
     * Each is its own waypoint, so what you see is a man stepping down,
     * walking, and stepping up — which is what the player asked for. */
    const curWalk = ship.floorWalkY(curFloor !== -1 ? curFloor : dstFloor, this.y);
    const dstWalk = ship.floorWalkY(dstFloor !== -1 ? dstFloor : curFloor, ty);
    const liftAtEnd = Utils.clamp(dstWalk - ty, 0, (Ship.OPERATOR_LIFT ?? 0) + 1);

    const wps = [];
    // Standing above the deck right now? Come down first, where you are.
    if (curWalk - this.y > 1) wps.push({ x: this.x, y: curWalk });

    if (curFloor === dstFloor || curFloor === -1 || dstFloor === -1) {
      wps.push({ x: tx, y: dstWalk });
    } else {
      const route = ship.elevators.findPath(this.x, this.y, ty);
      if (!route) {
        // No usable elevator — cooldown stops per-frame retry spam
        this._pathRetryCd = 1.0;
        return false;
      }
      wps.push(
        { x: route.entryX, y: curWalk },                              // walk to shaft
        { x: route.entryX, y: dstWalk,                                // ride shaft
          elevator: route.shaft,
          srcY: route.entryY, dstY: route.exitY,
          srcFloor: route.srcFloor, dstFloor: route.dstFloor,
          phase: 'call' },
        { x: tx, y: dstWalk },                                        // walk to target
      );
    }
    // …and only NOW step up to the console.
    if (liftAtEnd > 1) wps.push({ x: tx, y: dstWalk - liftAtEnd });

    this._waypoints = wps;
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
    // The dead take no actions (bodies are handled by the ship's
    // body pipeline). 'dying' is NOT guarded here — the dying branch
    // below must run so the death timer can finish.
    if (this.dead) return;

    if (this._pathRetryCd > 0) this._pathRetryCd -= dt;
    this.anim.update(dt);

    // Still in the sac: no moving, no fighting, no tasks. The ship
    // decides when it splits open.
    if (this.dormant) return;

    /* STUNNED — an ion bolt landed in this room. No walking, no repairs,
       no fighting until it wears off. It is a real interval rather than
       a flag so that a burst genuinely holds people down longer, and so
       the pip above their head can count it out. */
    if (this._stunT > 0) {
      this._stunT = Math.max(0, this._stunT - dt);
      this._setAnim('idle');
      return;
    }

    if (this.dying) {
      // Fixed-length death (the old anim.done never fired → crew
      // looked alive forever and kept working). 1.2s, then a corpse.
      this._dieT += dt;
      if (this._dieT >= 1.2 || this.anim.done) {
        this.dead  = true;
        this.state = 'dead';
        this.carriedBy = null;
      }
      return;
    }

    // Downed (injured) crew lie where they fell — carried or not,
    // they take no actions until healed in the medbay.
    if (this.state === 'injured') return;

    // Corpse plague: infected crew act erratically — they abandon
    // their post for empty rooms, and sometimes walk straight out of
    // an airlock…
    if (this.infected && ship) {
      this._infT += dt;
      if (this._infT >= 6) {
        this._infT = 0;
        const roll = Math.random();
        if (roll < 0.15) {
          // head for the nearest airlock — and step outside
          const air = ship.doors.filter(d => d.isAirlock)
            .sort((a, b) => Utils.dist(this.x, this.y, a.x, a.y) -
                            Utils.dist(this.x, this.y, b.x, b.y))[0];
          if (air) { this._suicideDoor = air; this.moveToOnShip(ship, air.x, air.y); }
        } else if (roll < 0.75) {
          const empt = ship.rooms.filter(r => r.type === 'empty' && r.id !== this.roomId);
          const target = empt.length ? Utils.pick(empt) : Utils.pick(ship.rooms);
          this.homeRoomId = target.id;
          this.moveToOnShip(ship, target.cx, target.cy);
        }
      }
      if (this._suicideDoor &&
          Utils.dist(this.x, this.y, this._suicideDoor.x, this._suicideDoor.y) < 16) {
        this.ejected = true;   // ship.update removes them
        return;
      }
    }

    // ── ROOM COMBAT: enemies sharing a room fight it out ──
    /* BOTH FIGHTERS MUST ACTUALLY BE IN THE ROOM (update42).
       `roomId` is stale while a man stands in the elevator trunk or on a
       door line, so this used to start brawls through walls: two people
       swinging at each other from either side of a bulkhead, the fight
       cancelling the loser's lift ride, and the corpse dropping in the
       shaft. `inRoom` is set every frame by Ship.update from the actual
       room rectangles — no rectangle, no fight. */
    if (ship && this.inRoom !== false) {
      const foes = ship.crew.filter(k =>
        k.alive && k.inRoom !== false &&
        k.roomId === this.roomId && k.isPlayer !== this.isPlayer);
      if (foes.length) {
        this._waypoints = [];
        this._hacking = false;
        this._stepInsideRoom(ship);
        // It LOOKS like a fight now. The melee branch used to leave the
        // walk/idle animation and whatever task the man was on, so a
        // boarding action played out as two people standing still.
        this._setAnim('fight');
        this._facing = (foes[0].x >= this.x) ? 1 : -1;
        if (this.attackTimer.tick(dt)) {
          const target = foes[0];
          this.strike(target, this.meleeDamage());
          Particles.laserHit?.(target.x, target.y - 10);
          this.creditMeleeSwing();
        }
        return;
      }
      // ── BOARDER AI: aboard the OTHER side's ship, no defenders in
      //    sight → sabotage this module, then push to the next target
      if (this.isPlayer !== ship.isPlayer) {
        const room = ship.getRoomById(this.roomId);
        /* NOTHING TO SABOTAGE ON A WRECK.
           A derelict is already shot to pieces, and the one system left
           running is the life support keeping the boarding party alive —
           so the old behaviour had your own people methodically
           destroying the air supply they were standing in. On a wreck
           they hunt nests and loot; they do not wreck it further. */
        if (ship.isDerelict) {
          this._updateMovement(dt, ship);
          return;
        }
        if (room?.system && room.system.damagedLevels < room.system.level) {
          this._sabT = (this._sabT ?? 0) + dt;
          if (this._sabT >= 5) {
            this._sabT = 0;
            room.system.damageLevel(1);
            Particles.repairSparks?.(this.x, this.y - 8);
          }
        } else if (!this._waypoints.length && !this._ordered) {
          const prio = ['weapons', 'shields', 'piloting', 'engines', 'oxygen'];
          const target = prio.map(t => ship.rooms.find(r =>
              r.type === t && r.system && r.system.damagedLevels < r.system.level))
            .find(r => r);
          if (target) this.moveToOnShip(ship, target.cx, target.cy);
        }
        this._updateMovement(dt, ship);
        return;   // no normal duties on a hostile ship
      }
    }

    this._updateMovement(dt, ship);
    this._updateTask(dt, ship);
    this._regenHp(dt);
  }

  /** Melee happens INSIDE a module (update42).
   *  A boarder pinned on the door plane used to fight — and die — right
   *  in the doorway, so brawls and corpses ended up straddling the wall
   *  between two rooms. Pull whoever starts swinging clear of the edge
   *  before the first blow lands. */
  static get MELEE_INSET() { return 18; }

  _stepInsideRoom(ship) {
    const room = ship?.getRoomById?.(this.roomId);
    if (!room) return;
    const pad = CrewMember.MELEE_INSET;
    if (room.w <= pad * 2) return;
    this.x = Utils.clamp(this.x, room.x + pad, room.x + room.w - pad);
  }

  /** Door directly in the walking path.
   *  `includeOpen` matters for INTRUDERS: a boarder has to crack every
   *  door he crosses, even one the defenders left standing open, so for
   *  him an open door is still a door. */
  _doorBlocking(ship, dirX, includeOpen = false) {
    if (!ship?.doors) return null;
    return ship.doors.find(d =>
      (includeOpen || !d.open) &&
      Math.abs(d.y - this.y) < 30 &&
      Math.sign(d.x - this.x) === Math.sign(dirX) &&
      Math.abs(d.x - this.x) < 16) ?? null;
  }

  /** Am I an intruder on this hull? */
  _isIntruderOn(ship) { return !!ship && this.isPlayer !== ship.isPlayer; }

  _updateMovement(dt, ship = null) {
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
        // An order that arrived mid-ride and could not be served by this
        // shaft was parked until we were standing on a real deck again.
        if (this._rerouteAfterRide) {
          const r = this._rerouteAfterRide;
          this._rerouteAfterRide = null;
          this.moveToOnShip(ship, r.tx, r.ty);
        }
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
    // Door ahead? INTERIOR doors slide open for us (short delay);
    // AIRLOCKS to space are impassable unless breached — a normal
    // crew member simply can't walk out into vacuum, so we abort the
    // waypoint rather than freeze against it.
    {
      const dirX = wp.x - this.x;
      if (Math.abs(dirX) > 2) {
        const intruder = this._isIntruderOn(ship);
        const door = this._doorBlocking(ship, dirX, intruder);
        if (door) {
          if (door.isAirlock) {
            // No walking into space; drop this move order.
            this._waypoints.length = 0;
            if (this.task === TASK.MOVE) { this.task = TASK.IDLE; }
            this._setAnim('idle');
            this._hacking = false;
            return;
          }
          if (intruder) {
            /* BOARDERS HACK, THEY DO NOT SMASH.
               Doors used to be blind to whose ship they were on, so an
               enemy boarder walked through the player's LOCKED doors as
               easily as the player's own crew — latching a door bought
               about one second of delay and nothing else. A hostile has
               to stand and crack each lock now (once per fight, per
               side), which is what makes door control a real tactic. */
            const side = this.isPlayer ? 'player' : 'enemy';
            if (!door.hackBy(side, dt)) {
              this._hacking = true;
              this._setAnim('repair');
              return;
            }
            this._hacking = false;
            if (!door.open) { this._setAnim('idle'); return; }
          } else {
            const canPass = door.requestPassage(dt);
            if (!canPass) { this._setAnim('idle'); return; }
          }
          // door is open — fall through and keep walking this frame
        } else {
          this._hacking = false;
        }
      }
    }

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
          // Pass raw dt — the crew skill multiplier is applied once,
          // inside system.repair (it used to be counted twice).
          room.repair(dt, this);
          // Repair sparks feedback
          if (Math.random() < 0.15) Particles.repairSparks(this.x + Utils.randFloat(-8,8), this.y - 10);
        } else if (!this._waypoints.length && !(this._pathRetryCd > 0)) {
          // Walk to a FREE standing spot, not the dead centre of the
          // room — send two men to fix the same engine and they used to
          // arrive on the same pixel and stay there afterwards.
          this.moveToOnShip(ship, ...ship.stationSpot(room, null, this));
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
          this._stepInsideRoom(ship);
          if (this.attackTimer.tick(dt)) {
            // Same swing, and the same lesson, as the room brawl.
            this.strike(enemy, this.meleeDamage());
            this.creditMeleeSwing();
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
        // Animals keep to their room. They do not fight fires, seal
        // breaches or repair anything — spiders wait, rats chew.
        if (this.isBeast) break;

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

        // Nothing wrong here — return to assigned station (FTL behaviour).
        // stationSpot() picks the next FREE slot in that room, so drifting
        // back to your post no longer means standing inside a colleague.
        if (this.homeRoomId && this.roomId !== this.homeRoomId &&
            !this._waypoints.length && !(this._pathRetryCd > 0)) {
          const home = ship.getRoomById(this.homeRoomId);
          if (home) this.moveToOnShip(ship, ...ship.stationSpot(home, null, this));
          break;
        }

        /* SETTLE onto the right spot in my own module.
         *
         * Standing spots are handed out from whoever happened to be in
         * the room at the moment the order was given — and rooms empty
         * out afterwards. A crewman placed on the LEFT flank because a
         * colleague was passing through would then flank an empty
         * console for the rest of the run, which is exactly the "he
         * stands off to the side" the player kept seeing.
         *
         * Ranking by id (rather than by who notices first) keeps this
         * from oscillating: everyone in the room agrees on the order,
         * so slot 0 — the console — goes to one man and stays his. */
        if (!this._waypoints.length && this.homeRoomId === room.id) {
          /* POSSESSION IS THE RULE. Whoever is standing on a slot keeps
             it; you may only move UP to a slot nobody is on.

             The first version ranked everyone in the room by id, so a
             newcomer with a lower id evicted the man already at the
             console, and somebody merely crossing the room could shove
             him aside for a moment. The operator owns his spot until he
             leaves it of his own accord. */
          /* WALKING COUNTS AS HOLDING (update38).
             This used to compare against live positions only. Order two
             men into an empty cockpit and both saw the console free
             while the other was still walking, so both went for it and
             both ended up on the same pixel — and once there, neither
             would ever move again, because the rule only lets you step
             UP to a lower slot and slot 0 is as low as it goes. A man
             en route to a spot owns that spot: Ship.takenStationSlots
             asks destPoint(), not x/y. */
          const slots = [0, 1, 2].map(i => ship.stationSlot(room, i));
          const mine  = ship.slotIndexAt(this.x, this.y, room, 5);
          const taken = ship.takenStationSlots(room, [this]);

          let want = -1;
          for (let i = 0; i < (mine === -1 ? 3 : mine); i++) {
            if (!taken.has(i)) { want = i; break; }
          }
          /* STACKED ON. If another RESIDENT of this room is standing on
             my spot too — two men on one slot, from an older save or a
             body dropped on the console — one of us steps aside rather
             than both pretending the room is fine.
             Residents only: a man crossing the room is in the way, but
             he does not own the console and must never evict anybody. */
          if (want === -1 && mine !== -1 &&
              ship.takenStationSlots(room, [this], true).has(mine)) {
            for (let i = 0; i < 3; i++) if (!taken.has(i)) { want = i; break; }
          }
          if (want !== -1) {
            this.moveToOnShip(ship, slots[want][0], slots[want][1]);
            break;
          }
        }

        /* Parked in a module that HAS a station: work it.
         *
         * The operator spot sits a few pixels above the walk line (see
         * Ship.stationSlot), so "am I at the console" is simply "am I
         * standing above the walk line". Anyone flanking him keeps the
         * ordinary idle bob, which is what makes the console man read
         * as the one actually running the module. `_setAnim` ignores a
         * repeat of the state it is already in, so this is free. */
        if (!this._waypoints.length && room.system) {
          const walkY = ship.floorWalkY(room.floor, room.cy);
          const atConsole = (walkY - this.y) > (Ship.OPERATOR_LIFT ?? 8) * 0.5;
          this._setAnim(atConsole ? 'operate' : 'idle');
        }
        break;
      }
    }
  }

  _regenHp(dt) {
    // NO natural regen anywhere — crew heal ONLY inside a medbay
    // that is undamaged and powered (handled by the medbay system).
  }

  // ── Damage / death ───────────────────────────────────────

  /**
   * Hit someone in melee. Everything goes through here so a spider's
   * bite has ONE place to infect from, whichever of the two melee
   * paths (room brawl / FIGHT order) happened to swing.
   */
  /** Split the sac open. Returns true the first time. */
  hatch() {
    if (!this.dormant) return false;
    this.dormant = false;
    this._animState = null;
    this._setAnim('idle');
    Particles.burst?.(this.x, this.y, '#9fff7a', 14);
    Audio.sfx.bossWarning?.();
    return true;
  }

  /** One more notch. Called for melee kills and for gunnery kills. */
  creditKill(victim) {
    if (!victim || victim.isPlayer === this.isPlayer) return false;
    this.kills = (this.kills ?? 0) + 1;
    return true;
  }

  strike(target, dmg) {
    if (!target || target.dead) return;
    const wasAlive = target.alive;
    target.takeDamage(dmg, 'crew');
    // The victim only ever recorded the STRING 'crew' as its killer —
    // nobody was ever credited with a kill. Now the man who swung is.
    if (wasAlive && !target.alive) this.creditKill(target);
    if (this.isSpider && target.isPlayer && !target.virus && !target.dead
        && Math.random() < SPIDER_INFECT_CHANCE) {
      target.virus = true;
      target.virusFights = 0;
      Particles.floatText?.(target.x, target.y - 18, 'BITTEN', '#9fff7a', 13);
      if (typeof UI !== 'undefined') {
        UI.notify?.(`${target.name} was bitten — something got into the wound.`, 'alert');
      }
    }
  }

  /** True once the virus has run its course. */
  get virusFatal() {
    return this.virus && this.virusFights >= VIRUS_FIGHTS_TO_DEATH;
  }

  /** Only a research post's quarantine ward can do this. */
  /** Knocked senseless for `seconds`. Stacks. */
  stun(seconds = 1) {
    if (this.dead) return false;
    this._stunT = (this._stunT ?? 0) + Math.max(0, seconds);
    this._waypoints = [];
    return true;
  }

  get stunned() { return (this._stunT ?? 0) > 0; }

  cureVirus() {
    const was = this.virus;
    this.virus = false; this.virusFights = 0;
    return was;
  }

  /**
   * Straight to dead — no 35% "goes down wounded" roll, no death
   * animation to wait out. The virus is not a wound somebody can drag
   * you to the medbay from; when it finishes, he is gone.
   */
  killOutright(source = 'unknown') {
    if (this.dead) return false;
    this.hp = 0;
    /* 'dead', NOT 'ok' (update40).
     *
     * serialise() writes `state` but not `dead`/`dying`, and the
     * constructor's only resurrection rule is `if (state === 'dead')
     * this.dead = true`. Writing 'ok' here meant a man killed by the
     * virus was saved as a LIVING crew member on 0 hp: reload, and he
     * was back at a console, uncounted by the game-over check, with his
     * headstone already on the hill. */
    this.state = 'dead';
    this.dying = false;
    this.dead  = true;
    this.killedBy = source;
    this._waypoints = [];
    this.task = TASK.IDLE;
    this._setAnim('die');
    Particles.crewDie?.(this.x, this.y);
    Audio.sfx.crewDie?.();
    if (this.isPlayer && !this._graved) { Save.addToGraveyard(this); this._graved = true; }
    return true;
  }

  takeDamage(amount, source = 'unknown') {
    if (this.dying || this.dead) return;
    // A downed crew member taking MORE damage dies outright
    if (this.state === 'injured') {
      this.hp = 0; this.dying = true; this._dieT = 0;
      this.killedBy = source; this._setAnim('die');
      if (this.isPlayer && !this._graved) { Save.addToGraveyard(this); this._graved = true; }
      return;
    }
    this.hp -= amount;
    if (this.hp <= 0) {
      // 35%: the crew member goes DOWN wounded instead of dying —
      // another crew member can carry them to the medbay.
      // Suffocation included: it leaves a body (or a casualty) too.
      // NOT vermin: nobody stretchers a rat to the med bay.
      if (!this.isBeast && Math.random() < 0.35) {
        this.hp    = 1;
        this.state = 'injured';
        this._waypoints = [];
        this.task  = TASK.IDLE;
        // Fresh clock: Ship.BLEEDOUT_SECONDS to get help, or he is gone.
        this._bleedT = 0;
        if (this.isPlayer && typeof UI !== 'undefined') {
          const secs = (typeof Ship !== 'undefined' ? Ship.BLEEDOUT_SECONDS : 40);
          UI.notify(`${this.name} is DOWN — get someone to them within ${secs}s!`, 'warn');
        }
        return;
      }
      this.hp       = 0;
      this.dying    = true;
      this._dieT    = 0;
      this.killedBy = source;
      this._setAnim('die');
      Particles.crewDie(this.x, this.y);
      Audio.sfx.crewDie();

      // Add to persistent graveyard (once — killOutright may also run)
      if (this.isPlayer && !this._graved) { Save.addToGraveyard(this); this._graved = true; }
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  // ── Draw ─────────────────────────────────────────────────

  draw(ctx) {
    // An unhatched nest is an EGG SAC, not a spider — and one nobody
    // has walked in on yet is not drawn at all.
    if (this.dormant && this.revealed === false) return;
    if (this.dormant && !this.dead) {
      Animation.drawEggSac?.(ctx, this.x, this.y, this._eggT = (this._eggT ?? 0) + 0.05);
      return;
    }

    // Downed & dead crew stay VISIBLE — lying sideways, tinted so
    // there's no mistaking them for the living.
    if (this.down) {
      ctx.save();
      ctx.translate(this.x, this.y + 8);
      ctx.rotate(-Math.PI / 2);
      ctx.globalAlpha = this.dead ? 0.75 : 0.9;
      this.anim.draw(ctx, 0, 0, 30, 30);
      ctx.rotate(Math.PI / 2);
      // tint overlay
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = 1;
      ctx.restore();
      // colour wash + glyph
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = this.decaying ? '#3aff6a' : this.dead ? '#556' : '#ffd700';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + 6, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.decaying ? '#3aff6a' : this.dead ? '#98a0b8' : '#ffd700';
      ctx.fillText(this.decaying ? '☣' : this.dead ? '☠' : '✚', this.x, this.y - 12);

      /* WHO IS THAT ON THE FLOOR? (update40)
         Bodies used to be deleted the frame they died, so nobody ever
         had to identify one. Now that they lie where they fell — and
         that a rotting one infects the room — the player has to be able
         to tell a casualty he can still save from a corpse he needs to
         get to an airlock, and which of his people it is. */
      if (this.isPlayer) {
        const tag = this.decaying ? 'DECAYING' : this.dead ? 'DEAD' : 'DOWN';
        const col = this.decaying ? '#3aff6a' : this.dead ? '#98a0b8' : '#ffd700';
        ctx.font = '9px Share Tech Mono, monospace';
        const label = `${this.name} · ${tag}`;
        const lw = ctx.measureText(label).width + 6;
        ctx.fillStyle = 'rgba(7,8,15,0.8)';
        ctx.fillRect(this.x - lw / 2, this.y - 34, lw, 11);
        ctx.fillStyle = col;
        ctx.fillText(label, this.x, this.y - 26);
      }
      if (this.decaying && Math.random() < 0.04) {
        Particles.emit?.({ x: this.x + Utils.randFloat(-8, 8), y: this.y,
          vx: 0, vy: -12, ay: 0, color: '#3aff6a', size: 2, sizeEnd: 0,
          life: 1.2, alpha: 0.5, alphaEnd: 0 });
      }
      return;
    }

    ctx.save();

    if (this._facing === -1) {
      ctx.scale(-1, 1);
      ctx.translate(-this.x * 2, 0);
    }

    this.anim.draw(ctx, this.x, this.y, 32, 32);

    ctx.restore();

    /* ── The stack above his head ──────────────────────────
       This used to be three things fighting over the same twelve
       pixels: the plague glyph at y-26, the virus ring at y-26, and
       an OPAQUE name plate from y-32 to y-21 drawn last, on top of
       both. The blinking infection marker was simply painted over
       every frame — you could not see it at all.

       One stack now, bottom to top, nothing overlapping:
           y-19 … y-16   health bar
           y-31 … y-20   name plate
           y-44 … y-32   plague marker
       The name moved DOWN a couple of pixels and the marker sits
       clear above it.                                            */
    const NAME_TOP = this.y - 31, NAME_H = 11;
    const MARK_Y   = this.y - 38;          // centre of the plague marker

    /* Health bar, closest to the helmet.
       ALWAYS drawn (update38). It used to appear only once a man was
       hurt, so a boarding party read as "some of them have no HP bar" —
       the missing bar was the healthy one. A row of full green bars is
       also how you tell at a glance which of three men in a bay is the
       one bleeding. */
    {
      const bw = 24, bh = 3;
      const bx = this.x - bw/2;
      const by = this.y - 19;
      const frac = Utils.clamp((this.hp ?? 0) / (this.maxHp || 1), 0, 1);
      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = frac > 0.5 ? '#1aff8c' : '#ff2d44';
      ctx.fillRect(bx, by, bw * frac, bh);
    }

    // Name label — always visible, corporation-colored, dark backing.
    // Drawn BEFORE the markers now, so it can never cover them.
    ctx.save();
    ctx.font = '9px Share Tech Mono, monospace';
    const nw = ctx.measureText(this.name).width + 6;
    ctx.fillStyle = 'rgba(7,8,15,0.75)';
    ctx.fillRect(this.x - nw/2, NAME_TOP, nw, NAME_H);
    ctx.fillStyle = this.isPlayer ? this.color : '#ff4444';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, this.x, NAME_TOP + 9);
    ctx.restore();

    // Stunned: little sparks orbiting the helmet, so you can see WHY
    // the man in the weapons bay has stopped doing anything.
    if (this._stunT > 0) {
      const t = (this._stunT * 6) % (Math.PI * 2);
      ctx.save();
      ctx.strokeStyle = '#8fd4ff';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = t + i * (Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.arc(this.x + Math.cos(a) * 9, this.y - 16 + Math.sin(a) * 4, 1.3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Corpse plague — a carrier who has been in a body bag.
    if (this.infected) {
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#3aff6a';
      ctx.fillText('☣', this.x, MARK_Y + 4);
    }

    // Live virus. The COUNTDOWN lives on the crew roster; here we keep a
    // pulsing ring and a glyph so you can spot the carrier at a glance.
    if (this.virus && !this.dead) {
      const pulse = 0.55 + 0.45 * Math.sin((this._infT = (this._infT ?? 0) + 0.12));
      ctx.save();
      ctx.strokeStyle = `rgba(159,255,122,${pulse.toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(this.x, MARK_Y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(159,255,122,${pulse.toFixed(2)})`;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('☣', this.x, MARK_Y + 3);
      ctx.restore();
    }
  }

  // ── Serialise / deserialise ───────────────────────────────

  serialise() {
    return {
      id: this.id, name: this.name, race: this.race, isPlayer: this.isPlayer,
      virus: this.virus, virusFights: this.virusFights,
      battles: this.battles, wins: this.wins,
      escapes: this.escapes, kills: this.kills,
      homeRoomId: this.homeRoomId,
      state: this.state, infected: this.infected, decaying: this.decaying,
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

/**
 * Void spiders: fast, fragile, and their bite carries the virus.
 * They are ordinary hostile crew as far as every other system is
 * concerned, which is why they can be fought room by room.
 */
function makeSpiders(size = 3, tough = 1) {
  const out = [];
  for (let i = 0; i < size; i++) {
    const c = new CrewMember({
      isPlayer: false,
      race: 'spider',
      name: `Spider ${String.fromCharCode(65 + (i % 26))}`,
      maxHp: 45 + tough * 10,
      skills: { combat: { level: 1 + tough, xp: 0 } },
    });
    c.hp = c.maxHp;
    out.push(c);
  }
  return out;
}

/**
 * MOON RATS — a stowaway problem, not a boarding party.
 *
 * They are ordinary hostile crew as far as every other system is
 * concerned (that is what lets your people fight them room by room
 * with machinery that already works), but they are feeble, they never
 * man anything, and the real damage is what they chew: see
 * Ship.verminTick.
 */
function makeRats(size = 1) {
  const out = [];
  for (let i = 0; i < size; i++) {
    const c = new CrewMember({
      isPlayer: false,
      race: 'rat',
      name: `Rat ${String.fromCharCode(65 + (i % 26))}`,
      maxHp: RAT_HP,
    });
    c.hp = c.maxHp;
    out.push(c);
  }
  return out;
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

if (typeof window !== 'undefined') window.crewColor = crewColor;
