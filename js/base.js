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
  frigate: {
    key: 'frigate', cost: 320,
    label: 'Kestrel Mk II',
    blurb: 'Three decks, medbay, 8-power reactor and room for three guns.',
  },
};

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
  };

  function _default() {
    return {
      warehouse: { fuel: 8, missiles: 4 },
      warehouseLvl: 0,
      barracks: [],           // serialised CrewMember data
      barracksLvl: 0,
      ships: [{ key: 'scout', data: null }],   // data null = factory fresh
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
    _commit();
    const now = kind === 'warehouse' ? `${warehouseCap()} units`
              : kind === 'barracks'  ? `${barracksCap()} bunks`
              : `${shipSlots()} berths`;
    return { ok: true, message: `Upgraded — now ${now}.` };
  }

  // ── Launch / return ─────────────────────────────────────

  /** Validate and pay for a loadout. On success the ship and the
   *  chosen crew LEAVE the base and the supplies are drawn from the
   *  warehouse. Returns everything the run needs to build itself. */
  function launch({ shipIndex = 0, crewIds = [], fuel = 0, missiles = 0, mission = 'patrol' } = {}) {
    const b = get();
    const entry = b.ships[shipIndex];
    if (!entry) return { ok: false, message: 'Pick a ship first.' };
    if (!MISSIONS[mission]) return { ok: false, message: 'Pick a contract first.' };

    const takenFuel = Math.min(Math.floor(fuel), b.warehouse.fuel);
    const takenMsl  = Math.min(Math.floor(missiles), b.warehouse.missiles);

    // Pull the crew first so a bad id can't half-commit the launch
    const roster = [];
    crewIds.forEach(id => {
      const c = b.barracks.find(x => x.id === id);
      if (c) roster.push(c);
    });
    roster.forEach(c => removeCrew(c.id));

    b.warehouse.fuel     -= takenFuel;
    b.warehouse.missiles -= takenMsl;
    const ship = checkoutShip(shipIndex);
    b.lastMission = mission;
    _commit();

    return {
      ok: true,
      ship,
      crew: roster,
      fuel: takenFuel,
      missiles: takenMsl,
      mission: MISSIONS[mission],
    };
  }

  /** Contract complete and docked. Everything aboard is banked, up
   *  to capacity; overflow is reported so the UI can say so. */
  function returnFromRun({ shipEntry = null, crew: crewData = [], fuel = 0, missiles = 0, cc: ccEarned = 0 } = {}) {
    const report = { fuelStored: 0, fuelLost: 0, mslStored: 0, mslLost: 0,
                     crewStored: 0, crewTurnedAway: 0, shipStored: false, cc: 0 };

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
    ships, buyShip, checkoutShip, storeShip,
    upgradeCost, buyUpgrade,
    launch, returnFromRun, loseRun,
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
