/* ============================================================
   MOON WARS — station.js
   Station shop: random stock, limited supply,
   all shop categories with buy logic.
   ============================================================ */

'use strict';

// ── Station types ─────────────────────────────────────────

const STATION_TYPES = ['general','military','science','outpost'];

// ── Shop item templates ───────────────────────────────────

const REPAIR_PRICES   = { hull: 3, system: 40 };    // per hp / per system
const FUEL_PRICE      = 3;
const MISSILE_PRICE   = 6;
const CREW_PRICE      = 60;
/**
 * Upgrades get EXPONENTIALLY dearer. A linear price made maxing the
 * reactor a formality; now the last few pips are a real campaign goal.
 *
 *   reactor lvl  4 →  ~34 CC      lvl 10 → ~132 CC     lvl 15 → ~380 CC
 *
 * GROWTH is the per-level multiplier; the linear term keeps early
 * upgrades affordable so the curve only bites at the top.
 */
const UPGRADE_GROWTH  = 1.22;
const REACTOR_PRICE   = (level) =>
  Math.round((10 + level * 4) * Math.pow(UPGRADE_GROWTH, Math.max(0, level - 3)));

// Module upgrades (system upgrades available in shop)
const MODULE_DEFS = {
  shields_up:  { label:'Shield Booster',  system:'shields',  cost:80,  desc:'Upgrade shields +1 bar.' },
  weapons_up:  { label:'Weapon Rack +1',  system:'weapons',  cost:75,  desc:'Adds weapon power capacity.' },
  engines_up:  { label:'Engine Boost',    system:'engines',  cost:70,  desc:'Increases evasion chance.' },
  oxygen_up:   { label:'O₂ Recycler',     system:'oxygen',   cost:60,  desc:'Faster oxygen replenishment.' },
  medbay_up:   { label:'Med Upgrade',     system:'medbay',   cost:55,  desc:'Faster crew healing.' },
};

// Crew name pool for recruits
const RECRUIT_NAMES = [
  'Pax','Rho','Sable','Talon','Uma','Vox','Wren',
  'Xeno','Yuki','Zeb','Frost','Blaze','Storm','Arc',
];

// ── Station class ─────────────────────────────────────────

class Station {
  /**
   * @param {number} sector - current sector (affects prices and stock)
   * @param {number} seed   - RNG seed for stock
   */
  constructor(sector = 1, seed = 0) {
    this.sector  = sector;
    this.seed    = seed;
    this.type    = Utils.pick(STATION_TYPES);
    this.name    = this._genName();
    this._rng    = this._makeRng(seed);

    // Stock (limited quantities)
    this.stock = this._generateStock();
  }

  _makeRng(seed) {
    let s = seed + 1;
    return () => { s ^= s<<13; s ^= s>>17; s ^= s<<5; return (s>>>0)/0xFFFFFFFF; };
  }

  _rngInt(a,b) { return Math.floor(this._rng()*(b-a))+a; }

  _genName() {
    const prefixes = ['Alpha','Beta','Delta','Echo','Foxtrot','Gamma','Kappa','Nova','Sigma','Theta'];
    const suffixes = ['Station','Post','Depot','Hub','Outpost','Base','Beacon'];
    return `${Utils.pick(prefixes)}-${Utils.pick(suffixes)}`;
  }

  _generateStock() {
    const s  = this.sector;
    const r  = this._rng.bind(this);
    const ri = this._rngInt.bind(this);

    const stock = {
      // Hull repair
      hullRepair: ri(5, 15 + s * 3),   // hp available to buy

      // Fuel
      fuel: ri(1, 4 + s),

      // Missiles
      missiles: ri(0, 6 + s),

      // Weapons (1–2 random)
      weapons: [],

      // Modules
      modules: [],

      // Crew recruits (0–2)
      crew: [],

      // Upgrades are ALWAYS available at stations
      reactorUpgrade: true,

      // Brand-new MODULES — random whether a given one is in stock.
      // SHIELDS are here because the starter hull ships without them:
      // getting a shield bay is the first big purchase of a run, so it
      // has to be findable (60% — often, not always).
      newModules: [
        ...(r() < 0.60 ? [{ type: 'shields',    cost: 90 + this.sector * 15, sold: false }] : []),
        ...(r() < 0.35 ? [{ type: 'medbay',     cost: 70 + this.sector * 10, sold: false }] : []),
        ...(r() < 0.5  ? [{ type: 'cloaking',   cost: 85 + this.sector * 10, sold: false }] : []),
        ...(r() < 0.5  ? [{ type: 'autorepair', cost: 75 + this.sector * 10, sold: false }] : []),
      ],
    };

    // Weapons
    const wCount = ri(1, 3);
    const wPool  = Object.entries(WEAPON_DEFS)
      .filter(([,d]) => d.cost > 0 && d.cost <= 50 + s*15);
    for (let i = 0; i < wCount && wPool.length; i++) {
      const idx = ri(0, wPool.length);
      const [key, def] = wPool.splice(idx, 1)[0];
      stock.weapons.push({ key, def, sold: false });
    }

    // Modules
    const mEntries = Object.entries(MODULE_DEFS);
    const mCount   = ri(1, 3);
    Utils.shuffle(mEntries).slice(0, mCount).forEach(([key, def]) => {
      stock.modules.push({ key, def: {...def}, sold: false });
    });

    // Crew
    const cCount = ri(0, 3);
    for (let i = 0; i < cCount; i++) {
      const name  = Utils.pick(RECRUIT_NAMES);
      const skill = Utils.pick(Object.keys(SKILL_DEFS));
      stock.crew.push({
        name,
        skill,
        cost: CREW_PRICE,
        sold: false,
        member: new CrewMember({
          name,
          skills: { [skill]: { level: 1, xp: 0 } },
        }),
      });
    }

    return stock;
  }

  // ── Buy actions ──────────────────────────────────────────

  /**
   * Buy hull repair.
   * @param {number}  hp     - amount of HP to repair
   * @param {Ship}    ship
   * @returns {{ ok, cost, message }}
   */
  buyHullRepair(hp, ship) {
    const available = Math.min(hp, this.stock.hullRepair);
    if (available <= 0) return { ok: false, message: 'No hull repair available.' };

    const cost = available * REPAIR_PRICES.hull;
    const run  = Save.getRun();
    if (!run || run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };

    ship.hull = Math.min(ship.hullMax, ship.hull + available);
    this.stock.hullRepair -= available;
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.repair();
    return { ok: true, cost, message: `Hull repaired +${available} HP.` };
  }

  /**
   * He2 is physical now (update39): it goes into CELLS in the hold, and
   * the hold can be full. Same shape as buyMissiles, including the
   * dry-run probe so the player is only ever charged for what fits.
   * `ship` is optional so old call sites still work.
   */
  buyFuel(amount, run, ship = null) {
    let avail = Math.min(amount, this.stock.fuel);
    if (avail <= 0) return { ok: false, message: 'No He2 available.' };

    const hold = ship?.cargo;
    // Medium tanks first, then bottles for the gaps, then drums.
    const KEYS = ['he2_med', 'he2_small', 'he2_large'];
    const pour = (grid, n) => {
      let left = n;
      for (const k of KEYS) { if (left <= 0) break; left = grid.addStack(k, left); }
      return left;
    };
    if (hold) {
      const probe = CargoGrid.deserialise(hold.serialise());
      avail -= pour(probe, avail);
      if (avail <= 0) return { ok: false, message: 'No room in the hold for He2.' };
    }

    const cost = avail * FUEL_PRICE;
    if (run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };

    this.stock.fuel -= avail;
    if (hold) {
      pour(hold, avail);
      Save.updateRun({ scrap: run.scrap - cost, fuel: hold.countOf('fuel') });
    } else {
      Save.updateRun({ scrap: run.scrap - cost, fuel: run.fuel + avail });
    }
    Audio.sfx.scrapCollect();
    return { ok: true, cost, message: `Loaded ${avail} He2 into the hold.` };
  }

  /**
   * Missiles are physical now: they go into racks in the hold, and the
   * hold can be full. `ship` is optional so old call sites still work.
   */
  buyMissiles(amount, run, ship = null) {
    let avail = Math.min(amount, this.stock.missiles);
    if (avail <= 0) return { ok: false, message: 'No missiles available.' };

    const hold = ship?.cargo;
    if (hold) {
      // Only charge for what actually fits — dry-run the load first.
      const probe = CargoGrid.deserialise(hold.serialise());
      const spill = probe.addStack('missile_rack', avail);
      avail -= spill;
      if (avail <= 0) return { ok: false, message: 'No room in the hold for missiles.' };
    }

    const cost = avail * MISSILE_PRICE;
    if (run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };

    this.stock.missiles -= avail;
    if (hold) {
      hold.addStack('missile_rack', avail);
      Save.updateRun({ scrap: run.scrap - cost, missiles: hold.countOf('missiles') });
    } else {
      Save.updateRun({ scrap: run.scrap - cost, missiles: run.missiles + avail });
    }
    Audio.sfx.scrapCollect();
    return { ok: true, cost, message: `Loaded ${avail} missiles into the racks.` };
  }

  buyWeapon(idx, ship, run) {
    const item = this.stock.weapons[idx];
    if (!item || item.sold) return { ok: false, message: 'Item not available.' };

    const cost = item.def.cost;
    if (run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };

    item.sold = true;
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.powerUp();

    // ONE gun per weapon MODULE: install into the first free module,
    // otherwise it goes to the cargo hold (swap guns below).
    let slot = -1;
    for (let i = 0; i < ship.weaponRooms.length; i++) {
      if (!ship.weapons[i]) { slot = i; break; }
    }
    if (slot !== -1 && ship.installWeapon(item.key, slot)) {
      return { ok: true, cost, message: `${item.def.label} installed in module ${slot + 1}.` };
    }
    ship.weaponCargo.push(item.key);
    return { ok: true, cost, message: `${item.def.label} stored in cargo (all modules occupied).` };
  }

  /** Move a mounted gun into the cargo hold — free, station only. */
  /**
   * A gun taken off the hull has to go SOMEWHERE physical — into a crate
   * in the hold. If there is no room for the crate, the gun stays bolted
   * on: no invisible rack to park it on any more.
   */
  uninstallWeapon(ship, slot) {
    const peek = ship.weapons[slot];
    if (!peek) return { ok: false, message: 'Module is empty.' };
    if (ship.cargo) {
      const crateKey = (typeof cargoCrateForWeapon === 'function')
        ? cargoCrateForWeapon(peek.defKey) : 'gun_crate';
      const probe = new CargoItem(crateKey);
      let room = false;
      for (let y = 0; y <= ship.cargo.rows - 1 && !room; y++)
        for (let x = 0; x <= ship.cargo.cols - 1 && !room; x++)
          if (ship.cargo.fits(probe, x, y)) room = true;
      if (!room) {
        return { ok: false,
          message: `No room in the hold for a ${probe.w}x${probe.h} crate — `
                 + 'make space first.' };
      }
    }
    const key = ship.uninstallWeapon(slot);
    if (!key) return { ok: false, message: 'Module is empty.' };
    // ship.uninstallWeapon() pushes onto the legacy rack — move it into
    // a real crate and take it back off the rack.
    const i = ship.weaponCargo.lastIndexOf(key);
    if (i >= 0) ship.weaponCargo.splice(i, 1);
    const crate = ship.boxWeapon(key);
    if (!crate) { ship.weaponCargo.push(key); }
    Audio.sfx.uiClick();
    return { ok: true,
      message: `${WEAPON_DEFS[key]?.label ?? key} boxed and stowed in the hold.` };
  }

  /** Mount a cargo gun into a specific EMPTY weapon module. */
  installFromCargo(ship, cargoIdx, slot) {
    const key = ship.weaponCargo[cargoIdx];
    if (!key) return { ok: false, message: 'Nothing there.' };
    if (ship.weapons[slot]) return { ok: false, message: `Module ${slot + 1} is occupied.` };
    if (!ship.installWeapon(key, slot)) return { ok: false, message: 'Install failed.' };
    ship.weaponCargo.splice(cargoIdx, 1);
    Audio.sfx.powerUp();
    return { ok: true, message: `${WEAPON_DEFS[key]?.label ?? key} installed in module ${slot + 1}.` };
  }

  /** Sell a cargo gun for half its list price. */
  sellCargoWeapon(ship, run, cargoIdx) {
    const key = ship.weaponCargo[cargoIdx];
    if (!key) return { ok: false, message: 'Nothing there.' };
    const price = Math.floor((WEAPON_DEFS[key]?.cost ?? 20) * 0.5);
    ship.weaponCargo.splice(cargoIdx, 1);
    Save.updateRun({ scrap: run.scrap + price });
    Audio.sfx.scrapPickup?.();
    return { ok: true, message: `Sold for ${price} CC.` };
  }

  /** Upgrade any ship system by INDEX — always available, price grows
   *  with current level. Shields upgrade a whole MODULE level at a
   *  time (+2 pips = +1 layer), capped at level 3. */
  upgradeSystemAt(ship, run, sysIndex) {
    const sys = ship.systems[sysIndex];
    if (!sys || sys.type === 'reactor')
      return { ok: false, message: 'Use the Reactor tab for that.' };
    const step = sys.type === 'shields' ? 2 : 1;
    const max  = sys.def?.maxLevel ?? 8;
    if (sys.level + step > max)
      return { ok: false, message: `${sys.label} already at max level.` };
    const cost = this.systemUpgradeCost(sys);
    if (run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };
    sys.level += step;
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    const shown = sys.type === 'shields' ? `${sys.level / 2}/3` : `${sys.level}`;
    return { ok: true, cost, message: `${sys.label} upgraded to level ${shown}.` };
  }

  /**
   * Module upgrades climb exponentially too — the same reasoning as the
   * reactor. `step` for shields is a whole 2-pip layer, so its curve is
   * driven by LAYER number, not pip number.
   */
  systemUpgradeCost(sys) {
    if (sys.type === 'shields') {
      const layer = sys.level / 2;                 // layers already fitted
      return Math.round((40 + layer * 45) * Math.pow(UPGRADE_GROWTH, layer))
           + this.sector * 5;
    }
    const lvl = sys.level;
    return Math.round((18 + lvl * 10) * Math.pow(UPGRADE_GROWTH, Math.max(0, lvl - 1)))
         + this.sector * 5;
  }

  /** Buy a brand-new module from stock — converts an empty room. */
  buyNewModule(idx, ship, run) {
    const item = this.stock.newModules[idx];
    if (!item || item.sold) return { ok: false, message: 'Item not available.' };
    if (ship.getSystem(item.type))
      return { ok: false, message: 'Already installed on this hull.' };
    if (!ship.rooms.some(r => r.type === 'empty'))
      return { ok: false, message: 'No empty room to convert.' };
    if (run.scrap < item.cost) return { ok: false, message: 'Insufficient CC.' };
    if (!ship.addModule(item.type)) return { ok: false, message: 'Install failed.' };
    item.sold = true;
    Save.updateRun({ scrap: run.scrap - item.cost });
    Audio.sfx.levelUp();
    return { ok: true, cost: item.cost,
      message: `${SYSTEM_DEFS[item.type].label} installed — give it power!` };
  }

  /** Orbital med-clinic: heals everyone to full, gets the wounded back
   *  on their feet and cures the CORPSE PLAGUE. 12 CC a patient.
   *  It does NOT touch the void-spider virus — that needs a research
   *  post's quarantine ward. (The dead stay dead — eject the bodies.) */
  healCrew(ship, run) {
    const patients = ship.crew.filter(c =>
      !c.dead && (c.hp < c.maxHp || c.state === 'injured' || c.infected));
    if (!patients.length) return { ok: false, message: 'Nobody needs treatment.' };
    const cost = patients.length * 12;
    if (run.scrap < cost) return { ok: false, message: `Need ${cost} CC for ${patients.length} patient(s).` };
    patients.forEach(c => {
      c.hp = c.maxHp;
      c.state = 'ok';
      c.infected = false;
    });
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    return { ok: true, cost,
      message: `${patients.length} crew treated — healed and plague-free.` };
  }

  /**
   * QUARANTINE WARD — research posts only.
   *
   * The ordinary clinic cannot touch the void-spider virus; letting it
   * would make the whole mechanic a 12 CC inconvenience. A `science`
   * port can, and charges for it.
   */
  quarantineCost(ship) {
    const n = ship.crew.filter(c => !c.dead && c.virus).length;
    return n * 45;
  }

  cureVirus(ship, run) {
    if (this.type !== 'science') {
      return { ok: false,
        message: 'No quarantine ward here — only a research post can treat it.' };
    }
    const patients = ship.crew.filter(c => !c.dead && c.virus);
    if (!patients.length) return { ok: false, message: 'Nobody is carrying it.' };
    const cost = this.quarantineCost(ship);
    if (run.scrap < cost) {
      return { ok: false, message: `Need ${cost} CC to treat ${patients.length}.` };
    }
    patients.forEach(c => c.cureVirus());
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    return { ok: true, cost,
      message: `${patients.length} crew scrubbed clean — the virus is out of them.` };
  }

  /** Room-targeted variants — the player clicks the destination room
   *  on the station's ship diagram. */
  buyNewModuleAt(idx, ship, run, roomId) {
    const item = this.stock.newModules[idx];
    if (!item || item.sold) return { ok: false, message: 'Item not available.' };
    if (ship.getSystem(item.type))
      return { ok: false, message: 'Already installed on this hull.' };
    if (run.scrap < item.cost) return { ok: false, message: 'Insufficient CC.' };
    if (!ship.addModuleAt(item.type, roomId))
      return { ok: false, message: 'That compartment cannot take it.' };
    item.sold = true;
    Save.updateRun({ scrap: run.scrap - item.cost });
    Audio.sfx.levelUp();
    return { ok: true, cost: item.cost,
      message: `${SYSTEM_DEFS[item.type].label} installed — give it power!` };
  }

  buyWeaponModuleAt(ship, run, roomId) {
    if (ship.weaponRooms.length >= 3)
      return { ok: false, message: 'Hull supports at most 3 weapon modules.' };
    const cost = this.weaponModuleCost(ship);
    if (run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };
    if (!ship.addModuleAt('weapons', roomId))
      return { ok: false, message: 'That compartment cannot take it.' };
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    return { ok: true, cost,
      message: `Weapon module ${ship.weaponRooms.length} installed — fit a gun into it.` };
  }

  /** Convert an empty room into a NEW weapon module (2nd: 60, 3rd: 120). */
  weaponModuleCost(ship) { return 60 * ship.weaponRooms.length; }

  buyWeaponModule(ship, run) {
    if (ship.weaponRooms.length >= 3)
      return { ok: false, message: 'Hull supports at most 3 weapon modules.' };
    if (!ship.rooms.some(r => r.type === 'empty'))
      return { ok: false, message: 'No empty room to convert.' };
    const cost = this.weaponModuleCost(ship);
    if (run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };
    if (!ship.addWeaponModule()) return { ok: false, message: 'Conversion failed.' };
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    return { ok: true, cost,
      message: `Weapon module ${ship.weaponRooms.length} installed — fit a gun into it.` };
  }

  buyModule(idx, ship, run) {
    const item = this.stock.modules[idx];
    if (!item || item.sold) return { ok: false, message: 'Item not available.' };

    const cost = item.def.cost;
    if (run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };

    const sys = ship.getSystem(item.def.system);
    if (!sys) return { ok: false, message: 'System not installed.' };
    if (!sys.upgrade()) return { ok: false, message: 'System already at max level.' };

    item.sold = true;
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    return { ok: true, cost, message: `${item.def.label} installed.` };
  }

  buyCrew(idx, ship, run) {
    const item = this.stock.crew[idx];
    if (!item || item.sold) return { ok: false, message: 'No crew available.' };
    if (ship.crew.length >= 8) return { ok: false, message: 'Crew quarters full.' };

    const cost = item.cost;
    if (run.scrap < cost) return { ok: false, message: 'Insufficient CC.' };

    item.sold = true;
    ship.addCrew(item.member);
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    return { ok: true, cost, message: `${item.name} joined the crew.` };
  }

  buyReactorUpgrade(ship, run) {
    if (!this.stock.reactorUpgrade) return { ok: false, message: 'No reactor upgrade available.' };

    const cost = REACTOR_PRICE(ship.reactor.level);
    // Max BEFORE money: a maxed reactor with a light purse used to be
    // reported as "Insufficient CC.", which is the wrong reason and sends
    // the player off to earn CC they can never spend.
    if (ship.reactor.level >= ship.reactor.maxLevel) {
      return { ok: false, message: 'Reactor at maximum.' };
    }
    if (run.scrap < cost) return { ok: false, message: `Insufficient CC — needs ${cost}.` };
    if (!ship.reactor.upgrade()) return { ok: false, message: 'Reactor at maximum.' };
    // Upgrades are always available — no one-per-station limit
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.powerUp();
    return { ok: true, cost, message: `Reactor upgraded to level ${ship.reactor.level}.` };
  }

  // ── Price helpers ────────────────────────────────────────

  hullRepairCost(hp = 1)  { return hp * REPAIR_PRICES.hull; }
  fuelCost(amt = 1)       { return amt * FUEL_PRICE; }
  missileCost(amt = 1)    { return amt * MISSILE_PRICE; }
  reactorCost(ship)       { return REACTOR_PRICE(ship.reactor.level); }
}
