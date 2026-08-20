/* ============================================================
   MOON WARS — base.js
   HOME BASE: the meta-layer that survives between runs.

   A run is now a CONTRACT flown out of the base. What you bring
   home is banked; what you lose is gone for good:
     • ships   — the hull you fly is CHECKED OUT of the hangar. It
                 only comes back if you finish the contract and
                 return. Lose it and the hangar slot is empty.
     • crew    — same rule, per crew member.
     • supply  — leftover He2 / missiles go into the warehouse,
                 up to its capacity.
     • CC      — banked (this is the same pot as Save's scrapBank).

   Everything here is pure state + rules; the base SCREEN lives in
   basescreen.js so this file stays testable without a canvas.
   ============================================================ */

'use strict';

/** Hulls that can sit in the hangar. `cost: 0` = you start with it. */
const SHIP_CATALOG = {
  scout: {
    key: 'scout', cost: 0,
    label: 'Tugboat "Halcyon"',
    blurb: 'Free refit of a raider hull. Two decks, no medbay, small reactor.',
  },
  hauler: {
    key: 'hauler', cost: 240,
    label: 'Freighter "Mule"',
    blurb: 'The Halcyon\'s bigger sister: eight bays, three of them empty, 8-power reactor.',
  },
  frigate: {
    key: 'frigate', cost: 320,
    label: 'Kestrel Mk II',
    blurb: 'Three decks, medbay, 8-power reactor and room for three guns.',
  },
};

/** What the yard pays for a hull you no longer want. */
const SHIP_RESALE = 0.30;

/** Contracts. A run picks one; it decides length and final boss. */
const MISSIONS = {
  patrol: {
    id: 'patrol',
    label: 'Border Patrol',
    sectors: 2,
    boss: 'elite',
    ccBonus: 60,
    blurb: 'Two sectors, then break a warlord’s escort. Short and survivable.',
  },
  mothership: {
    id: 'mothership',
    label: 'Mothership Assault',
    sectors: 3,
    boss: 'station',
    ccBonus: 150,
    blurb: 'Three sectors ending at the Mothership itself. The long contract.',
  },
};

const Base = (() => {

  // ── Tunables ────────────────────────────────────────────
  const START_WAREHOUSE_CAP = 20;   // per resource (He2 AND missiles)
  const START_BARRACKS_CAP  = 5;
  const START_SHIP_SLOTS    = 2;

  const WAREHOUSE_STEP = 10;        // +units per upgrade
  const BARRACKS_STEP  = 2;         // +bunks per upgrade
  const PRICE = {
    fuel: 8,                        // CC per He2
    missile: 5,                     // CC per missile
    recruit: 45,                    // CC for a fresh hand
    warehouse: (lvl) => 120 + lvl * 90,
    barracks:  (lvl) => 150 + lvl * 120,
    slot:      (lvl) => 400 + lvl * 300,
    hold:      (lvl) => 100 + lvl * 110,
  };

  function _default() {
    return {
      warehouse: { fuel: 8, missiles: 4 },
      warehouseLvl: 0,
      barracks: [],           // serialised CrewMember data
      barracksLvl: 0,
      ships: [{ key: 'scout', data: null }],   // data null = factory fresh
      armoury: [],            // spare guns (defKeys) waiting for a hull
      slotsLvl: 0,
      lastMission: 'patrol',
    };
  }

  /** The base lives inside the normal save blob. */
  function get() {
    const d = Save.getRaw ? Save.getRaw() : null;
    if (!d) return _default();
    if (!d.base) { d.base = _default(); Save.save(); }
    // Forward-compat: fill in anything a newer version added
    const def = _default();
    Object.keys(def).forEach(k => {
      if (d.base[k] === undefined) d.base[k] = def[k];
    });
    return d.base;
  }

  function _commit() { Save.save(); }

  // ── Capacities ──────────────────────────────────────────
  function warehouseCap() { return START_WAREHOUSE_CAP + get().warehouseLvl * WAREHOUSE_STEP; }
  /** Extra hold COLUMNS every hull gets, bought once, applies to all. */
  function holdBonus() { return get().holdLvl ?? 0; }
  function barracksCap()  { return START_BARRACKS_CAP  + get().barracksLvl  * BARRACKS_STEP; }
  function shipSlots()    { return START_SHIP_SLOTS    + get().slotsLvl; }

  // ── Money (shares Save's bank so there is ONE pot of CC) ──
  function cc()          { return Save.getScrapBank(); }
  function earn(amount)  { Save.addScrapBank(Math.max(0, Math.round(amount))); }
  function spend(amount) { return Save.spendScrapBank(Math.max(0, Math.round(amount))); }

  // ── Warehouse ───────────────────────────────────────────
  function supply()  { return { ...get().warehouse }; }

  /** Put units in, capped. Returns how many actually FIT (the rest
   *  is lost — the UI tells the player when that happens). */
  function store(kind, qty) {
    const b = get();
    if (qty <= 0 || !(kind in b.warehouse)) return 0;
    const room = Math.max(0, warehouseCap() - b.warehouse[kind]);
    const put  = Math.min(room, Math.floor(qty));
    b.warehouse[kind] += put;
    _commit();
    return put;
  }

  function take(kind, qty) {
    const b = get();
    if (qty <= 0 || !(kind in b.warehouse)) return 0;
    const got = Math.min(b.warehouse[kind], Math.floor(qty));
    b.warehouse[kind] -= got;
    _commit();
    return got;
  }

  function unitPrice(kind) { return kind === 'fuel' ? PRICE.fuel : PRICE.missile; }

  /** Base shop: buy supply straight into the warehouse. */
  function buySupply(kind, qty = 1) {
    const b = get();
    if (!(kind in b.warehouse)) return { ok: false, message: 'No such stock.' };
    const room = warehouseCap() - b.warehouse[kind];
    if (room <= 0) return { ok: false, message: 'Warehouse full — upgrade it first.' };
    const want = Math.min(Math.floor(qty), room);
    const cost = want * unitPrice(kind);
    if (cc() < cost) return { ok: false, message: `Need ${cost} CC.` };
    spend(cost);
    b.warehouse[kind] += want;
    _commit();
    return { ok: true, message: `Bought ${want} ${kind === 'fuel' ? 'He2' : 'missiles'} for ${cost} CC.` };
  }

  // ── Barracks ────────────────────────────────────────────
  function crew() { return [...get().barracks]; }

  /** Returns true if the bunk was found. Crew above capacity are
   *  turned away — that is what the cap MEANS. */
  function addCrew(data) {
    const b = get();
    if (b.barracks.length >= barracksCap()) return false;
    b.barracks.push(data);
    _commit();
    return true;
  }

  function removeCrew(id) {
    const b = get();
    const i = b.barracks.findIndex(c => c.id === id);
    if (i === -1) return null;
    const [out] = b.barracks.splice(i, 1);
    _commit();
    return out;
  }

  function hireRecruit() {
    const b = get();
    if (b.barracks.length >= barracksCap()) {
      return { ok: false, message: 'Barracks full — build more bunks.' };
    }
    if (cc() < PRICE.recruit) return { ok: false, message: `Need ${PRICE.recruit} CC.` };
    spend(PRICE.recruit);
    const c = new CrewMember({});
    b.barracks.push(c.serialise());
    _commit();
    return { ok: true, message: `${c.name} signed on.`, crew: c };
  }

  // ── Hangar ──────────────────────────────────────────────
  function ships() { return [...get().ships]; }

  function buyShip(key) {
    const b   = get();
    const def = SHIP_CATALOG[key];
    if (!def) return { ok: false, message: 'Unknown hull.' };
    if (b.ships.length >= shipSlots()) {
      return { ok: false, message: 'No free berth — buy another slot.' };
    }
    if (cc() < def.cost) return { ok: false, message: `Need ${def.cost} CC.` };
    spend(def.cost);
    b.ships.push({ key, data: null });
    _commit();
    return { ok: true, message: `${def.label} delivered to the hangar.` };
  }

  // ── Armoury (spare guns) ────────────────────────────────
  //  Installed guns travel WITH their hull (they live in the ship's
  //  own save data). Only SPARES — anything that came home in cargo —
  //  end up here, where they can be fitted to any hull or sold.

  function armoury() { return [...(get().armoury ?? [])]; }

  function storeWeapon(defKey) {
    if (!defKey || !getWeaponDef(defKey)) return false;
    get().armoury.push(defKey);
    _commit();
    return true;
  }

  function weaponValue(defKey) {
    const def = getWeaponDef(defKey);
    return Math.max(5, Math.round((def?.cost ?? 20) * 0.5));
  }

  function sellWeapon(index) {
    const b = get();
    if (index < 0 || index >= b.armoury.length) return { ok: false, message: 'No such gun.' };
    const [key] = b.armoury.splice(index, 1);
    const paid = weaponValue(key);
    earn(paid);
    _commit();
    return { ok: true, message: `Sold ${getWeaponDef(key)?.label ?? key} for ${paid} CC.` };
  }

  /** Fit a spare gun to a hull sitting in the hangar. A factory-fresh
   *  entry gets built once so the change has somewhere to live. */
  function installWeapon(shipIndex, armouryIndex) {
    const b = get();
    const entry = b.ships[shipIndex];
    if (!entry) return { ok: false, message: 'Pick a ship first.' };
    const key = b.armoury[armouryIndex];
    if (!key) return { ok: false, message: 'No such gun.' };

    const ship = _materialise(entry);

    let slot = -1;
    for (let i = 0; i < ship.weaponSlots; i++) if (!ship.weapons[i]) { slot = i; break; }
    if (slot === -1) {
      return { ok: false, message: 'No free weapon mount — the hull needs another weapons bay.' };
    }
    if (!ship.installWeapon(key, slot)) {
      return { ok: false, message: 'That gun will not fit this hull.' };
    }
    b.armoury.splice(armouryIndex, 1);
    entry.data = ship.serialise();
    _commit();
    return { ok: true, message: `${getWeaponDef(key)?.label ?? key} fitted.` };
  }

  /** Build a real Ship from a hangar entry. A factory-fresh entry has
   *  no saved data yet — it still has its FACTORY guns, so it must be
   *  built from the layout rather than treated as empty (that bug made
   *  the starting laser impossible to swap out). */
  function _materialise(entry) {
    return entry.data
      ? Ship.deserialise(entry.data, true, 0, 0)
      : new Ship(entry.key, true, 0, 0);
  }

  /** Pull a gun off a hangar hull and put it back in the armoury. */
  function uninstallWeapon(shipIndex, slot) {
    const b = get();
    const entry = b.ships[shipIndex];
    if (!entry) return { ok: false, message: 'No such ship.' };
    const ship = _materialise(entry);
    const w = ship.weapons[slot];
    if (!w) return { ok: false, message: 'That mount is empty.' };
    ship.uninstallWeapon(slot);
    // uninstall drops it into the ship's cargo — move that to the base
    (ship.weaponCargo ?? []).forEach(k => b.armoury.push(k));
    ship.weaponCargo = [];
    entry.data = ship.serialise();
    _commit();
    return { ok: true, message: `${w.label ?? 'Gun'} stowed in the armoury.` };
  }

  /** Guns currently bolted to a hangar hull (for the UI). */
  function shipWeapons(shipIndex) {
    const entry = get().ships[shipIndex];
    if (!entry) return [];
    if (!entry.data) {
      const L = SHIP_LAYOUTS[entry.key];
      return (L?.startWeapons ?? []).map((k, i) => ({ slot: i, defKey: k }));
    }
    return (entry.data.weapons ?? []).filter(Boolean).map(w => ({ slot: w.slot, defKey: w.defKey }));
  }

  function shipSlotCount(shipIndex) {
    const entry = get().ships[shipIndex];
    if (!entry) return 0;
    if (entry.data) {
      // extraModules can add weapon bays after the fact
      const extra = (entry.data.extraModules ?? [])
        .filter(e => (typeof e === 'string' ? e : e.type) === 'weapons').length;
      return (SHIP_LAYOUTS[entry.key]?.weaponSlots ?? 1) + extra;
    }
    return SHIP_LAYOUTS[entry.key]?.weaponSlots ?? 1;
  }

  /** Sell a hull you no longer want — the yard pays 30% of list. */
  function sellShip(index) {
    const b = get();
    const entry = b.ships[index];
    if (!entry) return { ok: false, message: 'No such ship.' };
    if (b.ships.length <= 1) {
      return { ok: false, message: 'That is your last hull — you would have nothing to fly.' };
    }
    const def  = SHIP_CATALOG[entry.key];
    const paid = Math.round((def?.cost ?? 0) * SHIP_RESALE);
    // Anything bolted to her goes back on the rack rather than vanishing.
    // Materialise first: a factory-fresh entry has no saved data but DOES
    // have its factory guns, and reading entry.data directly quietly
    // threw those away.
    const sold = _materialise(entry);
    sold.weapons.filter(Boolean).forEach(w => b.armoury.push(w.defKey));
    (sold.weaponCargo ?? []).forEach(k => b.armoury.push(k));
    b.ships.splice(index, 1);
    earn(paid);
    _commit();
    return { ok: true, message: `${def?.label ?? 'Hull'} sold for ${paid} CC (guns kept).` };
  }

  /** Take a hull OUT of the hangar for a contract. It is gone from
   *  the base until it comes home — which is exactly why losing it
   *  costs you the ship. */
  function checkoutShip(index) {
    const b = get();
    if (index < 0 || index >= b.ships.length) return null;
    const [entry] = b.ships.splice(index, 1);
    _commit();
    return entry;
  }

  function storeShip(entry) {
    const b = get();
    if (!entry) return false;
    if (b.ships.length >= shipSlots()) return false;
    b.ships.push(entry);
    _commit();
    return true;
  }

  // ── Upgrades ────────────────────────────────────────────
  function upgradeCost(kind) {
    const b = get();
    if (kind === 'warehouse') return PRICE.warehouse(b.warehouseLvl);
    if (kind === 'barracks')  return PRICE.barracks(b.barracksLvl);
    if (kind === 'slot')      return PRICE.slot(b.slotsLvl);
    if (kind === 'hold')      return PRICE.hold(b.holdLvl ?? 0);
    return Infinity;
  }

  function buyUpgrade(kind) {
    const b = get();
    const cost = upgradeCost(kind);
    if (!isFinite(cost)) return { ok: false, message: 'Unknown upgrade.' };
    if (cc() < cost) return { ok: false, message: `Need ${cost} CC.` };
    spend(cost);
    if (kind === 'warehouse') b.warehouseLvl++;
    if (kind === 'barracks')  b.barracksLvl++;
    if (kind === 'slot')      b.slotsLvl++;
    if (kind === 'hold')       b.holdLvl = (b.holdLvl ?? 0) + 1;
    _commit();
    const now = kind === 'warehouse' ? `${warehouseCap()} units`
              : kind === 'barracks'  ? `${barracksCap()} bunks`
              : kind === 'hold'      ? `+${holdBonus()} hold columns on every hull`
              : `${shipSlots()} berths`;
    return { ok: true, message: `Upgraded — now ${now}.` };
  }

  // ── Launch / return ─────────────────────────────────────

  /** Validate and pay for a loadout. On success the ship and the
   *  chosen crew LEAVE the base and the supplies are drawn from the
   *  warehouse. Returns everything the run needs to build itself. */
  /**
   * Everything in the base that can physically be loaded onto a ship,
   * laid out as a grid you can drag from. He2 travels in 3-unit
   * canisters, missiles in 4-round crates, spare guns in boxes sized by
   * how good the gun is.
   *
   * `reserveFuel` is what the tank stepper has already claimed, so the
   * same He2 cannot be both in the tank and in a canister.
   */
  function storeGrid(reserveFuel = 0) {
    if (typeof CargoGrid === 'undefined') return null;
    const b = get();
    const g = new CargoGrid(8, 6);

    // He2 goes into the biggest tank that makes sense, missiles into
    // racks of 10 — the same containers you find on a wreck.
    let spareFuel = Math.max(0, b.warehouse.fuel - Math.floor(reserveFuel));
    while (spareFuel > 0) {
      const key = spareFuel > 15 ? 'he2_large' : spareFuel > 5 ? 'he2_med' : 'he2_small';
      const cap = CARGO_ITEMS[key].stackMax;
      const put = Math.min(cap, spareFuel);
      if (!g.add(key, null, put)) break;
      spareFuel -= put;
    }
    g.addStack('missile_rack', b.warehouse.missiles);
    (b.armoury ?? []).forEach(k => {
      const crate = (typeof cargoCrateForWeapon === 'function')
        ? cargoCrateForWeapon(k) : 'gun_crate';
      g.add(crate, k);
    });
    return g;
  }

  /** What a packed hold costs the base, without committing anything. */
  function holdCost(hold) {
    const cost = { fuel: 0, missiles: 0, guns: [] };
    (hold?.items ?? []).forEach(it => {
      const units = it.isStack ? it.qty : (it.def.amount ?? 0);
      if (it.def.kind === 'fuel')          cost.fuel     += units;
      else if (it.def.kind === 'missiles') cost.missiles += units;
      else if (it.def.kind === 'weapon' && it.meta) cost.guns.push(it.meta);
    });
    return cost;
  }

  /**
   * Drop anything from a packed hold that the base can no longer back.
   *
   * THE BUG THIS FIXES: pack a spare gun into the hold, then walk over to
   * the ARMOURY tab and fit that same gun to the hull. The armoury copy
   * is gone, but the crate was still sitting in the hold — and it flew
   * with you, so you ended up with the gun twice.
   *
   * Returns plain-language descriptions of what was taken back out.
   */
  function pruneHold(hold, reserveFuel = 0) {
    if (!hold) return [];
    const b = get();
    const dropped = [];

    const pool = [...(b.armoury ?? [])];
    for (const it of [...hold.items]) {
      if (it.def.kind !== 'weapon' || !it.meta) continue;
      const i = pool.indexOf(it.meta);
      if (i >= 0) pool.splice(i, 1);
      else { hold.remove(it); dropped.push(it.label); }
    }

    const shelfFuel = Math.max(0, b.warehouse.fuel - Math.floor(reserveFuel));
    const overF = hold.countOf('fuel') - shelfFuel;
    if (overF > 0) { hold.takeStack('fuel', overF); dropped.push(`${overF} He2`); }

    const overM = hold.countOf('missiles') - b.warehouse.missiles;
    if (overM > 0) { hold.takeStack('missiles', overM); dropped.push(`${overM} missiles`); }

    return dropped;
  }

  /* ── Yard repairs ──────────────────────────────────────
     A hull that came home holed used to stay holed until you found a
     station mid-run. The base is a shipyard; it can weld. */

  const HULL_REPAIR_PRICE = 4;         // CC per hull point, dearer than a port

  /** {hp, cost} for a hangar entry, or null if it needs nothing. */
  function hullRepairQuote(shipIndex = 0) {
    const b = get();
    const entry = b.ships[shipIndex];
    if (!entry) return null;
    let sh;
    try {
      sh = entry.data ? Ship.deserialise(entry.data, true, 0, 0)
                      : new Ship(entry.key, true, 0, 0);
    } catch (e) { return null; }
    const missing = Math.max(0, sh.hullMax - sh.hull);
    if (missing <= 0) return null;
    return { hp: missing, cost: missing * HULL_REPAIR_PRICE,
             hull: sh.hull, hullMax: sh.hullMax };
  }

  /** Weld a hangar hull back to full, or as far as the CC stretches. */
  function repairHull(shipIndex = 0, hpWanted = Infinity) {
    const b = get();
    const entry = b.ships[shipIndex];
    if (!entry) return { ok: false, message: 'No hull in that berth.' };
    const q = hullRepairQuote(shipIndex);
    if (!q) return { ok: false, message: 'That hull is already sound.' };

    const affordable = Math.floor(cc() / HULL_REPAIR_PRICE);
    const hp = Math.min(q.hp, Math.floor(hpWanted), affordable);
    if (hp <= 0) return { ok: false, message: `Need ${HULL_REPAIR_PRICE} CC per hull point.` };

    const cost = hp * HULL_REPAIR_PRICE;
    spend(cost);
    // A factory-fresh entry has no saved data — materialise it so the
    // repair has somewhere to live.
    if (!entry.data) {
      const sh = new Ship(entry.key, true, 0, 0);
      entry.data = sh.serialise();
    }
    entry.data.hull = Math.min(q.hullMax, (entry.data.hull ?? q.hull) + hp);
    _commit();
    return { ok: true, cost, hp,
      message: `Welded ${hp} hull for ${cost} CC — now ${entry.data.hull}/${q.hullMax}.` };
  }

  function launch({ shipIndex = 0, crewIds = [], fuel = 0, missiles = 0,
                    mission = 'patrol', weapons = [], hold = null } = {}) {
    const b = get();
    const entry = b.ships[shipIndex];
    if (!entry) return { ok: false, message: 'Pick a ship first.' };
    if (!MISSIONS[mission]) return { ok: false, message: 'Pick a contract first.' };

    const takenFuel = Math.min(Math.floor(fuel), b.warehouse.fuel);
    const takenMsl  = Math.min(Math.floor(missiles), b.warehouse.missiles);

    // The packed hold draws from the SAME warehouse as the tank stepper,
    // so it takes what is left after the tank is filled. Anything the
    // base cannot actually cover is dropped from the hold rather than
    // conjured out of nothing.
    const packed = holdCost(hold);
    const holdFuel = Math.min(packed.fuel, b.warehouse.fuel - takenFuel);
    const holdMsl  = Math.min(packed.missiles, b.warehouse.missiles - takenMsl);
    const shortFuel = packed.fuel > holdFuel;
    const shortMsl  = packed.missiles > holdMsl;
    if (hold && (shortFuel || shortMsl)) {
      // Drop crates from the back until the bill fits the shelves.
      let overF = packed.fuel - holdFuel, overM = packed.missiles - holdMsl;
      if (overF > 0) overF -= hold.takeStack('fuel', overF);
      if (overM > 0) overM -= hold.takeStack('missiles', overM);
    }

    // Pull the crew first so a bad id can't half-commit the launch
    const roster = [];
    crewIds.forEach(id => {
      const c = b.barracks.find(x => x.id === id);
      if (c) roster.push(c);
    });
    roster.forEach(c => removeCrew(c.id));

    // Spare guns the player marked to bring along leave the rack too
    const carried = [];
    [...weapons].sort((a, b2) => b2 - a).forEach(i => {
      if (i >= 0 && i < b.armoury.length) carried.push(b.armoury.splice(i, 1)[0]);
    });

    // Guns packed into the hold leave the armoury for real.
    const packedGuns = [];
    holdCost(hold).guns.forEach(k => {
      const i = b.armoury.indexOf(k);
      if (i >= 0) { b.armoury.splice(i, 1); packedGuns.push(k); }
    });

    const finalCost = holdCost(hold);
    b.warehouse.fuel     -= takenFuel + Math.min(finalCost.fuel, b.warehouse.fuel - takenFuel);
    b.warehouse.missiles -= takenMsl  + Math.min(finalCost.missiles, b.warehouse.missiles - takenMsl);
    b.warehouse.fuel     = Math.max(0, b.warehouse.fuel);
    b.warehouse.missiles = Math.max(0, b.warehouse.missiles);
    const ship = checkoutShip(shipIndex);
    b.lastMission = mission;
    _commit();

    return {
      ok: true,
      ship,
      crew: roster,
      fuel: takenFuel,
      missiles: takenMsl,
      spareGuns: carried,
      hold: hold ? hold.serialise() : null,
      packedGuns,
      mission: MISSIONS[mission],
    };
  }

  /** Contract complete and docked. Everything aboard is banked, up
   *  to capacity; overflow is reported so the UI can say so. */
  function returnFromRun({ shipEntry = null, crew: crewData = [], fuel = 0, missiles = 0, cc: ccEarned = 0 } = {}) {
    const report = { fuelStored: 0, fuelLost: 0, mslStored: 0, mslLost: 0,
                     crewStored: 0, crewTurnedAway: 0, shipStored: false, cc: 0,
                     gunsStored: 0 };

    // Spare guns riding in the hold go on the armoury rack. Guns that
    // are BOLTED ON stay with the hull (they live in its save data), so
    // nothing is ever counted twice.
    if (shipEntry && shipEntry.data && Array.isArray(shipEntry.data.weaponCargo)) {
      shipEntry.data.weaponCargo.forEach(k => { if (storeWeapon(k)) report.gunsStored++; });
      shipEntry.data.weaponCargo = [];
    }

    if (ccEarned > 0) { earn(ccEarned); report.cc = Math.round(ccEarned); }

    report.fuelStored = store('fuel', fuel);
    report.fuelLost   = Math.max(0, Math.floor(fuel) - report.fuelStored);
    report.mslStored  = store('missiles', missiles);
    report.mslLost    = Math.max(0, Math.floor(missiles) - report.mslStored);

    crewData.forEach(c => {
      if (addCrew(c)) report.crewStored++;
      else report.crewTurnedAway++;
    });

    if (shipEntry) report.shipStored = storeShip(shipEntry);
    return report;
  }

  /** A run ended badly (or was abandoned). The checked-out hull and
   *  everyone aboard simply never come back — nothing to do but say
   *  so. Kept as a named call so the intent is obvious at the call site. */
  function loseRun() { /* the hangar/barracks were emptied at launch */ }

  function missions() { return Object.values(MISSIONS); }
  function catalog()  { return Object.values(SHIP_CATALOG); }

  return {
    get, cc, earn, spend,
    warehouseCap, barracksCap, shipSlots,
    supply, store, take, buySupply, unitPrice,
    crew, addCrew, removeCrew, hireRecruit,
    ships, buyShip, checkoutShip, storeShip, sellShip,
    armoury, storeWeapon, sellWeapon, weaponValue,
    installWeapon, uninstallWeapon, shipWeapons, shipSlotCount,
    upgradeCost, buyUpgrade,
    launch, returnFromRun, loseRun,
    storeGrid, holdCost, holdBonus, pruneHold,
    hullRepairQuote, repairHull, HULL_REPAIR_PRICE,
    missions, catalog,
    PRICE,
  };
})();

// Classic scripts keep top-level `const` in the script's lexical scope,
// NOT on window — so a loader cannot tell whether this file ran. Publish
// explicitly so game.js can detect a stale index.html and self-heal.
if (typeof window !== 'undefined') {
  window.Base = Base;
  window.SHIP_CATALOG = SHIP_CATALOG;
  window.MISSIONS = MISSIONS;
}
