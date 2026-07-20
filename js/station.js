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
const REACTOR_PRICE   = (level) => 10 + level * 8;   // +1 power per level

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

      // Brand-new MODULES — random whether a given one is in stock
      newModules: [
        ...(r() < 0.5 ? [{ type: 'cloaking',   cost: 85 + this.sector * 10, sold: false }] : []),
        ...(r() < 0.5 ? [{ type: 'autorepair', cost: 75 + this.sector * 10, sold: false }] : []),
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
    if (!run || run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };

    ship.hull = Math.min(ship.hullMax, ship.hull + available);
    this.stock.hullRepair -= available;
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.repair();
    return { ok: true, cost, message: `Hull repaired +${available} HP.` };
  }

  buyFuel(amount, run) {
    const avail = Math.min(amount, this.stock.fuel);
    if (avail <= 0) return { ok: false, message: 'No fuel available.' };

    const cost = avail * FUEL_PRICE;
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };

    this.stock.fuel -= avail;
    Save.updateRun({ scrap: run.scrap - cost, fuel: run.fuel + avail });
    Audio.sfx.scrapCollect();
    return { ok: true, cost, message: `Purchased ${avail} fuel.` };
  }

  buyMissiles(amount, run) {
    const avail = Math.min(amount, this.stock.missiles);
    if (avail <= 0) return { ok: false, message: 'No missiles available.' };

    const cost = avail * MISSILE_PRICE;
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };

    this.stock.missiles -= avail;
    Save.updateRun({ scrap: run.scrap - cost, missiles: run.missiles + avail });
    Audio.sfx.scrapCollect();
    return { ok: true, cost, message: `Purchased ${avail} missiles.` };
  }

  buyWeapon(idx, ship, run) {
    const item = this.stock.weapons[idx];
    if (!item || item.sold) return { ok: false, message: 'Item not available.' };

    const cost = item.def.cost;
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };

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
  uninstallWeapon(ship, slot) {
    const key = ship.uninstallWeapon(slot);
    if (!key) return { ok: false, message: 'Module is empty.' };
    Audio.sfx.uiClick();
    return { ok: true, message: `${WEAPON_DEFS[key]?.label ?? key} moved to cargo.` };
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
    return { ok: true, message: `Sold for ⬡${price} scrap.` };
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
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };
    sys.level += step;
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    const shown = sys.type === 'shields' ? `${sys.level / 2}/3` : `${sys.level}`;
    return { ok: true, cost, message: `${sys.label} upgraded to level ${shown}.` };
  }

  systemUpgradeCost(sys) {
    if (sys.type === 'shields') {
      // Per shield MODULE level: lvl1→2: 90, lvl2→3: 140
      return 40 + (sys.level / 2) * 50 + this.sector * 5;
    }
    return (sys.level + 1) * 22 + this.sector * 5;
  }

  /** Buy a brand-new module from stock — converts an empty room. */
  buyNewModule(idx, ship, run) {
    const item = this.stock.newModules[idx];
    if (!item || item.sold) return { ok: false, message: 'Item not available.' };
    if (ship.getSystem(item.type))
      return { ok: false, message: 'Already installed on this hull.' };
    if (!ship.rooms.some(r => r.type === 'empty'))
      return { ok: false, message: 'No empty room to convert.' };
    if (run.scrap < item.cost) return { ok: false, message: 'Insufficient scrap.' };
    if (!ship.addModule(item.type)) return { ok: false, message: 'Install failed.' };
    item.sold = true;
    Save.updateRun({ scrap: run.scrap - item.cost });
    Audio.sfx.levelUp();
    return { ok: true, cost: item.cost,
      message: `${SYSTEM_DEFS[item.type].label} installed — give it power!` };
  }

  /** Orbital med-clinic: heals everyone to full, gets the wounded
   *  back on their feet and CURES the corpse plague. ⬡12 a patient.
   *  (The dead stay dead — eject the bodies.) */
  healCrew(ship, run) {
    const patients = ship.crew.filter(c =>
      !c.dead && (c.hp < c.maxHp || c.state === 'injured' || c.infected));
    if (!patients.length) return { ok: false, message: 'Nobody needs treatment.' };
    const cost = patients.length * 12;
    if (run.scrap < cost) return { ok: false, message: `Need ⬡${cost} for ${patients.length} patient(s).` };
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

  /** Room-targeted variants — the player clicks the destination room
   *  on the station's ship diagram. */
  buyNewModuleAt(idx, ship, run, roomId) {
    const item = this.stock.newModules[idx];
    if (!item || item.sold) return { ok: false, message: 'Item not available.' };
    if (ship.getSystem(item.type))
      return { ok: false, message: 'Already installed on this hull.' };
    if (run.scrap < item.cost) return { ok: false, message: 'Insufficient scrap.' };
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
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };
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
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };
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
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };

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
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };

    item.sold = true;
    ship.addCrew(item.member);
    Save.updateRun({ scrap: run.scrap - cost });
    Audio.sfx.levelUp();
    return { ok: true, cost, message: `${item.name} joined the crew.` };
  }

  buyReactorUpgrade(ship, run) {
    if (!this.stock.reactorUpgrade) return { ok: false, message: 'No reactor upgrade available.' };

    const cost = REACTOR_PRICE(ship.reactor.level);
    if (run.scrap < cost) return { ok: false, message: 'Insufficient scrap.' };
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
