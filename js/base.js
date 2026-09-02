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
     • cargo   — anything else in the hold (medkits, relics, spare
                 crates...) goes onto the warehouse SHELF (a real
                 CargoGrid — see stashGrid()) instead of being sold
                 outright; only the overflow is liquidated.
     • CC      — banked (this is the same pot as Save's scrapBank).

   Everything here is pure state + rules; the base SCREEN lives in
   basescreen.js so this file stays testable without a canvas.
   ============================================================ */

'use strict';

/** Hulls that can sit in the hangar. `cost: 0` = you start with it. */
const SHIP_CATALOG = {
  scout: {
    key: 'scout', cost: 0,
    label: 'Bastet',
    blurb: 'Free refit of a raider hull. Two decks, no medbay, small reactor.',
  },
  hauler: {
    key: 'hauler', cost: 240,
    label: 'Hapi',
    blurb: 'Bastet\'s bigger sister: eight bays, three of them empty, 8-power reactor.',
  },
  frigate: {
    key: 'frigate', cost: 320,
    label: 'Horus',
    blurb: 'Three decks, medbay, 8-power reactor and room for three guns.',
  },
};

/** What the yard pays for a hull you no longer want. */
const SHIP_RESALE = 0.30;

/** Contracts. A run picks one; it decides length and final boss. */
const MISSIONS = {
  // A first job. One sector, no boss, and the map is graded a notch
  // gentler than Border Patrol — somewhere to learn the ship without
  // a warlord's escort waiting at the end of it.
  courier: {
    id: 'courier',
    label: 'Courier Run',
    sectors: 1,
    boss: null,
    difficulty: 'easy',
    ccBonus: 30,
    blurb: 'One sector, no boss. Deliver, keep your head down, come home.',
  },
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
    label: 'Strike on Apophis',
    sectors: 3,
    boss: 'station',
    ccBonus: 150,
    blurb: 'Three sectors ending at Apophis herself. The long contract.',
  },
};

const Base = (() => {

  // ── Tunables ────────────────────────────────────────────
  const START_WAREHOUSE_CAP = 20;   // per resource (He2 AND missiles)
  const START_BARRACKS_CAP  = 5;
  const START_SHIP_SLOTS    = 2;

  const WAREHOUSE_STEP = 10;        // +units per upgrade (legacy, see below)
  const BARRACKS_STEP  = 2;         // +bunks per upgrade

  /* ── ONE WAREHOUSE ────────────────────────────────────────
     There used to be THREE stores in the base and the player could see
     the seams: two integer counters (`warehouse.fuel`, `warehouse.missiles`),
     a flat array of spare guns (`armoury`), and a CargoGrid for everything
     else (`stash`). Same shelf in fiction, three different sets of rules
     in code — and every one of them needed its own reconciliation with a
     packed hold, which is where the duplication bugs kept coming from.

     Now there is ONE grid. He2 rides in canisters, warheads in racks,
     spare guns in crates, and medkits are just medkits — all of them real
     items on real cells, in the same store the ship packs out of. An item
     is in exactly ONE place at any moment: on the shelf, or in the hold.
     That invariant is what makes duplication impossible rather than
     merely unlikely. */
  const WAREHOUSE_COLS = 8;         // at level 0
  const WAREHOUSE_ROWS = 6;
  const PRICE = {
    fuel: 8,                        // CC per He2
    missile: 5,                     // CC per missile
    scan: 35,                       // CC per Survey Probe (55 → 35, update42)
    /* CC per MEAL (update47). Deliberately cheap: rations are not a
       resource to manage, they are the thing you forget to buy once
       and never forget again. */
    food: 3,
    /* CC for a cat out of the station's pens (update47). It used to be
       that the ONLY way to get one was to roll the stowaway event on
       the map, which made the animal impossible to plan around and a
       nuisance to test. The map cat is still free — this one you pay
       for, and it is dearer than a hand because it keeps working when
       the hand is bleeding on the floor. */
    cat: 60,
    recruit: 45,                    // CC for a fresh hand
    /* THE PROMOTION PRICE IS A CURVE, NOT A NUMBER (update52) —
       80 * 1.20^rank, see commanderPrice() in commander.js. What is
       left here is the FLOOR (a Recruit), so an old call site that
       reads PRICE.promotion still gets a truthful minimum rather than
       a lie. Ask Commander.priceFor(rec) for what a man actually costs. */
    promotion: 80,                  // CC — a Recruit; a Master Lord is ~6360
    warehouse: (lvl) => 120 + lvl * 90,
    /* THE COMMANDER'S MESS (update43). Level 0 means it has not been
       built; each level is one more berth for a commander. Flat figures,
       not a formula, because there are only four of them and the
       player is meant to read the whole ladder off one card. */
    mess:      [250, 400, 600],     // levels II, III, IV — I is free
    pets:      (lvl) => 200 + lvl * 200,
    barracks:  (lvl) => 150 + lvl * 120,
    slot:      (lvl) => 400 + lvl * 300,
  };

  function _default() {
    return {
      // LEGACY, kept only so an old save can be migrated on load. Nothing
      // reads these any more — see _migrateStores().
      warehouse: { fuel: 0, missiles: 0 },
      armoury: [],
      stash: null,

      warehouseLvl: 0,
      barracks: [],           // serialised CrewMember data
      barracksLvl: 0,
      ships: [{ key: 'scout', data: null }],   // data null = factory fresh
      slotsLvl: 0,
      lastMission: 'patrol',
      // THE MESS (update43). lvl 0 = not built yet. `commanders` holds
      // serialised commander records — see commander.js. A commander out on a
      // contract STAYS in this list, flagged `away`, because the berth
      // is his whether he is home or not.
      // The mess is a BUILDING like the barracks and the hangar: it is
      // simply there, at level 1, with one berth (update44). It used to
      // start unbuilt with its own BUILD button on its own tab, which
      // made it the only structure in the base that worked differently
      // from every other structure in the base.
      messLvl: 1,
      commanders: [],
      petsLvl: 0,             // extra pens beyond the two you start with
      pets: [],               // serialised animals — filled in update45
      // THE warehouse: one serialised CargoGrid holding everything.
      store: null,            // filled by _migrateStores() on first read
      // What the player has already packed for the next launch. Persisted
      // so that packing the hold and then closing the game cannot make
      // those items evaporate — they left the shelf, they must be SOMEWHERE.
      packedHold: null,
    };
  }

  /** A brand-new base is not empty — you start with fuel, warheads and
   *  something to eat. The rations are there so a first-time player
   *  meets the hunger meter with the answer already on his shelf,
   *  rather than watching his gunner starve while he works out where
   *  food comes from. */
  function _seedStore(g) {
    if (!g) return g;
    g.addStack('he2_med', 8);
    g.addStack('missile_rack', 4);
    g.addStack('ration_pack', 10);
    return g;
  }

  /**
   * Fold the three old stores into the one grid, once, in place.
   *
   * Runs on every read but does real work only while `store` is null, so
   * an old save is converted exactly once and a new one is just seeded.
   */
  function _migrateStores(b) {
    if (b.store || typeof CargoGrid === 'undefined') return;
    const g = new CargoGrid(WAREHOUSE_COLS + (b.warehouseLvl ?? 0), WAREHOUSE_ROWS);

    // Anything the old shelf was holding comes across first — it is the
    // only one of the three that had a shape, so it deserves its cells.
    if (b.stash && Array.isArray(b.stash.items) && b.stash.items.length) {
      CargoGrid.deserialise(b.stash).items.forEach(it => g.autoPlace(it));
    }
    const hadOld = !!(b.warehouse?.fuel || b.warehouse?.missiles || (b.armoury ?? []).length
                      || (b.stash && (b.stash.items ?? []).length));
    g.addStack('he2_med', b.warehouse?.fuel ?? 0);
    g.addStack('missile_rack', b.warehouse?.missiles ?? 0);
    (b.armoury ?? []).forEach(k => {
      const crate = (typeof cargoCrateForWeapon === 'function')
        ? cargoCrateForWeapon(k) : 'gun_crate';
      g.add(crate, k);
    });
    if (!hadOld) _seedStore(g);

    b.store = g.serialise();
    b.warehouse = { fuel: 0, missiles: 0 };
    b.armoury = [];
    b.stash = null;
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
    _migrateStores(d.base);
    /* THE CHAIR HAS A NEW NAME (update52). "Captain" is now a RANK a
       crewman can hold, so the man who commands the ship is the SHIP
       COMMANDER and the field is `commanders`. Move an older save's
       list across once and delete the old key — leaving both would be
       two registers for one mess, which is the bug this project keeps
       having. */
    if (Array.isArray(d.base.captains)) {
      if (!(d.base.commanders ?? []).length) d.base.commanders = d.base.captains;
      delete d.base.captains;
      Save.save();
    }
    /* An update43 save has messLvl 0 because the mess had to be bought.
       It is a free building now, so nobody should have to pay 150 CC
       for something the next new game gets for nothing. */
    if (!(d.base.messLvl >= 1)) d.base.messLvl = 1;
    /* GIVE BACK WHAT WAS PAID FOR A DELETED UPGRADE (update46).
       CARGO RETROFIT cost 100 + lvl*110; a save that bought it gets the
       CC back ONCE and the field is cleared, so this can never run
       twice. Nobody should be out of pocket for something we removed. */
    if (d.base.holdLvl > 0) {
      let back = 0;
      for (let i = 0; i < d.base.holdLvl; i++) back += 100 + i * 110;
      d.base.holdRefunded = back;
      delete d.base.holdLvl;
      Save.addScrapBank(back);
      Save.save();
    }
    return d.base;
  }

  function _commit() { Save.save(); }

  // ── Capacities ──────────────────────────────────────────
  /** Cells on the shelf — the only capacity that means anything now. */
  function warehouseCap() { return storeCols() * storeRows(); }
  function storeCols()    { return WAREHOUSE_COLS + (get().warehouseLvl ?? 0); }
  function storeRows()    { return WAREHOUSE_ROWS; }
  /* CARGO RETROFIT DELETED (update46).
     The player: "statek ma swoje cargo i tak powinno pozostać".
     He is right, and the deletion also closes a real trap: the hold's
     width was computed in TWO places with DIFFERENT formulas —
     basescreen.js added the retrofit, Ship's constructor did not — so a
     hull built anywhere but the packing screen quietly had one column
     less. Same disease as the reactor price and the weapon charge time,
     same cure as HANDOFF prescribes: delete a register, do not
     reconcile two. A hull's hold is now whatever its LAYOUT says,
     everywhere, full stop. */
  function barracksCap()  { return START_BARRACKS_CAP  + get().barracksLvl  * BARRACKS_STEP; }
  function shipSlots()    { return START_SHIP_SLOTS    + get().slotsLvl; }
  // Old names for the same thing, so nothing that reads them breaks.
  function stashCols()    { return storeCols(); }
  function stashRows()    { return storeRows(); }

  // ── The commander's mess (update43) ────────────────────────

  /** Berths for commanders. 0 until the mess is built. */
  function messCap()   { return get().messLvl ?? 0; }
  function messLevel() { return get().messLvl ?? 0; }
  /** Cost of the NEXT berth, or Infinity when the mess is at IV.
   *  Level I is free — the ladder starts at the SECOND berth. */
  function messCost() {
    const lvl = messLevel();
    return lvl >= 1 + PRICE.mess.length ? Infinity : PRICE.mess[lvl - 1];
  }

  /* ── QUARTERS FOR ANIMALS (update44) ──────────────────────
     Two pens from the start, deliberately NOT bunks: a cat that had to
     compete with a fifth gunner for a bunk would never be taken, and
     the whole point of the animal is that bringing one is a real
     choice rather than an obvious no. */
  function petCap()   { return PETS_START + (get().petsLvl ?? 0); }
  function petLevel() { return get().petsLvl ?? 0; }
  function pets()     { return [...(get().pets ?? [])]; }
  function petById(id) { return (get().pets ?? []).find(p => p.id === id) || null; }

  /** Put an animal in a pen. Refused when they are all full — the cap
   *  is the whole point of the pens. */
  function addPet(data) {
    const b = get();
    b.pets = b.pets ?? [];
    if (b.pets.length >= petCap()) return false;
    b.pets.push(data);
    _commit();
    return true;
  }

  /** It did not come home. */
  function losePet(id) {
    const b = get();
    const before = (b.pets ?? []).length;
    b.pets = (b.pets ?? []).filter(p => p.id !== id);
    _commit();
    return b.pets.length < before;
  }

  /** Write a returning animal's state back — a cat that came home
   *  starving must still be starving tomorrow. */
  function savePet(data) {
    if (!data?.id) return false;
    const b = get();
    const i = (b.pets ?? []).findIndex(p => p.id === data.id);
    if (i < 0) return addPet(data);
    b.pets[i] = data;
    _commit();
    return true;
  }
  function commanders() { return [...(get().commanders ?? [])]; }
  function commanderById(id) { return (get().commanders ?? []).find(c => c.id === id) || null; }

  /** Kept for older call sites; the mess is bought through the one
   *  upgrade ladder now, exactly like the barracks. */
  function buyMess() { return buyUpgrade('mess'); }

  /**
   * PROMOTE A CREWMAN. He leaves the barracks and does not come back.
   *
   * No copy is made anywhere: the barracks record is spliced out and
   * the commander record is built from it. Two registries for one person
   * is the oldest bug in this project and it is not being reinvented
   * for the sake of an "undo" nobody asked for.
   */
  function promote(crewId) {
    const b = get();
    if (typeof Commander === 'undefined') return { ok: false, message: 'Commanders unavailable.' };
    if (messLevel() <= 0) return { ok: false, message: 'Build the mess first.' };
    if ((b.commanders ?? []).length >= messCap())
      return { ok: false, message: 'No free berth in the mess.' };
    const rec = (b.barracks ?? []).find(c => c.id === crewId);
    if (!rec) return { ok: false, message: 'Nobody by that name in the barracks.' };
    if (!Commander.eligible(rec))
      return { ok: false, message: 'This one cannot take the chair.' };

    /* HIS RANK SETS BOTH THE PRICE AND THE LEVEL HE ARRIVES AT.
       One number — rankLevelOf(rec) — decides both, and
       Commander.fromCrew reads the very same one, so the man charged
       for twelve levels is always the man who gets twelve. */
    const price = Commander.priceFor(rec);
    if (cc() < price) return { ok: false, message: `Need ${price} CC.` };

    spend(price);
    const cap = Commander.fromCrew(rec);
    b.barracks = b.barracks.filter(c => c.id !== crewId);   // out of the bunk, for good
    (b.commanders = b.commanders ?? []).push(cap);
    _commit();
    return { ok: true, commander: cap,
             message: `${cap.name} takes the chair. The barracks is one hand lighter.` };
  }

  /** Everyone in the barracks who could take the chair today. */
  function promotable() {
    if (typeof Commander === 'undefined') return [];
    return (get().barracks ?? []).filter(c => Commander.eligible(c));
  }

  /** Write a flying commander's progress back into the mess. */
  function saveCommander(cap) {
    if (!cap) return false;
    const b = get();
    const i = (b.commanders ?? []).findIndex(c => c.id === cap.id);
    if (i < 0) return false;
    b.commanders[i] = cap;
    _commit();
    return true;
  }

  /** He did not come home. The berth is freed; the base is untouched. */
  function loseCommander(id) {
    const b = get();
    const before = (b.commanders ?? []).length;
    b.commanders = (b.commanders ?? []).filter(c => c.id !== id);
    _commit();
    return b.commanders.length < before;
  }

  // ── Money (shares Save's bank so there is ONE pot of CC) ──
  function cc()          { return Save.getScrapBank(); }
  function earn(amount)  { Save.addScrapBank(Math.max(0, Math.round(amount))); }
  function spend(amount) { return Save.spendScrapBank(Math.max(0, Math.round(amount))); }

  // ── THE warehouse ───────────────────────────────────────

  /** The live shelf. Mutate it, then hand it to commitWarehouse(). */
  function warehouseGrid() {
    if (typeof CargoGrid === 'undefined') return null;
    const b = get();
    const g = CargoGrid.deserialise(b.store ?? { cols: storeCols(), rows: storeRows(), items: [] });
    // The WAREHOUSE upgrade widens the shelf; never shrink it under
    // whatever is already sitting there.
    if (g.cols < storeCols()) g.cols = storeCols();
    if (g.rows < storeRows()) g.rows = storeRows();
    return g;
  }

  function commitWarehouse(grid) {
    if (!grid) return;
    get().store = grid.serialise();
    _commit();
  }

  // The shelf used to be three separate things; these are the old names.
  const stashGrid   = warehouseGrid;
  const commitStash = commitWarehouse;

  /** How many He2 / warheads are actually ON the shelf right now. */
  function supply() {
    const g = warehouseGrid();
    if (!g) return { fuel: 0, missiles: 0, scan: 0, food: 0 };
    return { fuel: g.countOf('fuel'), missiles: g.countOf('missiles'),
             scan: g.countOf('scan'), food: g.countOf('food') };
  }

  /** Which container a loose unit of `kind` is stored in. */
  const STOCK_KEY = { fuel: 'he2_med', missiles: 'missile_rack',
                      scan: 'survey_probe', food: 'ration_pack' };

  /** Put units on the shelf as real containers. Returns how many FIT. */
  function store(kind, qty) {
    const g = warehouseGrid();
    if (!g || qty <= 0) return 0;
    const key = STOCK_KEY[kind];
    if (!key) return 0;
    const before = g.countOf(kind);
    g.addStack(key, Math.floor(qty));
    const put = g.countOf(kind) - before;
    if (put > 0) commitWarehouse(g);
    return put;
  }

  function take(kind, qty) {
    const g = warehouseGrid();
    if (!g || qty <= 0) return 0;
    const got = g.takeStack(kind, Math.floor(qty));
    if (got > 0) commitWarehouse(g);
    return got;
  }

  function unitPrice(kind) {
    return kind === 'fuel' ? PRICE.fuel
         : kind === 'scan' ? PRICE.scan
         : kind === 'food' ? PRICE.food
         : PRICE.missile;
  }

  /** Base shop: buy supply straight onto the shelf. */
  function buySupply(kind, qty = 1) {
    if (!STOCK_KEY[kind]) return { ok: false, message: 'No such stock.' };
    const g = warehouseGrid();
    if (!g) return { ok: false, message: 'Cargo system not loaded.' };
    if (g.usedCells() >= g.capacity) {
      return { ok: false, message: 'Warehouse full — upgrade it first.' };
    }
    const want = Math.max(1, Math.floor(qty));
    const cost = want * unitPrice(kind);
    if (cc() < cost) return { ok: false, message: `Need ${cost} CC.` };
    // Buy what actually fits, and only charge for that.
    const before = g.countOf(kind);
    g.addStack(STOCK_KEY[kind], want);
    const put = g.countOf(kind) - before;
    if (put <= 0) return { ok: false, message: 'No room on the shelf.' };
    spend(put * unitPrice(kind));
    commitWarehouse(g);
    const noun = kind === 'fuel' ? 'He2' : kind === 'scan' ? 'survey probe(s)'
               : kind === 'food' ? 'meals' : 'missiles';
    return { ok: true, message: `Bought ${put} ${noun} for ${put * unitPrice(kind)} CC.` };
  }

  /** The hold the player has packed for the next launch, or null. */
  function packedHold() {
    if (typeof CargoGrid === 'undefined') return null;
    const raw = get().packedHold;
    return raw ? CargoGrid.deserialise(raw) : null;
  }

  function commitPackedHold(grid) {
    get().packedHold = grid ? grid.serialise() : null;
    _commit();
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

  /**
   * Take a cat out of the station's pens (update47).
   *
   * The same door as hireRecruit, and deliberately the same shape:
   * pay, check the cap, put the record in its own list. It goes into
   * a PEN, never a bunk — a cat is not crew, and the one thing this
   * must not do is what update45's docking bug did, which was let an
   * animal into the barracks where the game would offer it a console.
   */
  function adoptCat(kind = null) {
    const b = get();
    b.pets = b.pets ?? [];
    if (b.pets.length >= petCap()) {
      return { ok: false, message: 'No free pen — build another.' };
    }
    if (cc() < PRICE.cat) return { ok: false, message: `Need ${PRICE.cat} CC.` };
    if (typeof makeCat !== 'function') return { ok: false, message: 'No cats today.' };
    spend(PRICE.cat);
    const cat = makeCat(kind || Utils.pick(['black', 'ginger']));
    b.pets.push(cat.serialise());
    _commit();
    return { ok: true, message: `${cat.name} moved into the pens.`, pet: cat };
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

  /** Every gun crate on the shelf, in shelf order. The rack IS the
   *  warehouse now — a spare gun is a crate like any other crate. */
  function _gunCrates(grid) {
    return (grid?.items ?? []).filter(it => it.def.kind === 'weapon' && it.meta);
  }

  function armoury() {
    return _gunCrates(warehouseGrid()).map(it => it.meta);
  }

  function storeWeapon(defKey) {
    if (!defKey || !getWeaponDef(defKey)) return false;
    const g = warehouseGrid();
    if (!g) return false;
    const crate = (typeof cargoCrateForWeapon === 'function')
      ? cargoCrateForWeapon(defKey) : 'gun_crate';
    if (!g.add(crate, defKey)) return false;      // shelf full
    commitWarehouse(g);
    return true;
  }

  function weaponValue(defKey) {
    const def = getWeaponDef(defKey);
    return Math.max(5, Math.round((def?.cost ?? 20) * 0.5));
  }

  function sellWeapon(index) {
    const g = warehouseGrid();
    const crates = _gunCrates(g);
    if (index < 0 || index >= crates.length) return { ok: false, message: 'No such gun.' };
    const it = crates[index];
    const key = it.meta;
    g.remove(it);
    const paid = weaponValue(key);
    earn(paid);
    commitWarehouse(g);
    return { ok: true, message: `Sold ${getWeaponDef(key)?.label ?? key} for ${paid} CC.` };
  }

  /** Fit a spare gun to a hull sitting in the hangar. A factory-fresh
   *  entry gets built once so the change has somewhere to live. */
  function installWeapon(shipIndex, armouryIndex) {
    const b = get();
    const entry = b.ships[shipIndex];
    if (!entry) return { ok: false, message: 'Pick a ship first.' };
    const g = warehouseGrid();
    const crate = _gunCrates(g)[armouryIndex];
    if (!crate) return { ok: false, message: 'No such gun.' };
    const key = crate.meta;

    const ship = _materialise(entry);

    let slot = -1;
    for (let i = 0; i < ship.weaponSlots; i++) if (!ship.weapons[i]) { slot = i; break; }
    if (slot === -1) {
      return { ok: false, message: 'No free weapon mount — the hull needs another weapons bay.' };
    }
    if (!ship.installWeapon(key, slot)) {
      return { ok: false, message: 'That gun will not fit this hull.' };
    }
    // The crate LEAVES the shelf. It cannot also be in a packed hold —
    // it was never in two places to begin with, which is the whole point
    // of there being one store.
    g.remove(crate);
    commitWarehouse(g);
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
    // uninstall drops it into the ship's cargo — move that onto the shelf
    const stowed = [...(ship.weaponCargo ?? [])];
    ship.weaponCargo = [];
    const kept = stowed.filter(k => storeWeapon(k));
    entry.data = ship.serialise();
    _commit();
    if (kept.length < stowed.length) {
      return { ok: false, message: 'No room on the shelf for that gun — clear some space first.' };
    }
    return { ok: true, message: `${w.label ?? 'Gun'} stowed in the warehouse.` };
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
    let lost = 0;
    sold.weapons.filter(Boolean).forEach(w => { if (!storeWeapon(w.defKey)) lost++; });
    (sold.weaponCargo ?? []).forEach(k => { if (!storeWeapon(k)) lost++; });
    b.ships.splice(index, 1);
    earn(paid);
    _commit();
    return { ok: true, message: `${def?.label ?? 'Hull'} sold for ${paid} CC`
                              + (lost ? ` — ${lost} gun(s) scrapped, no shelf room` : ' (guns kept)') + '.' };
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
    if (kind === 'mess')      return messCost();
    if (kind === 'pets')      return PRICE.pets(b.petsLvl ?? 0);
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
    if (kind === 'mess')       b.messLvl = (b.messLvl ?? 1) + 1;
    if (kind === 'pets')       b.petsLvl = (b.petsLvl ?? 0) + 1;
    _commit();
    const now = kind === 'warehouse' ? `${warehouseCap()} units · ${stashCols()}×${stashRows()} shelf`
              : kind === 'barracks'  ? `${barracksCap()} bunks`
              : kind === 'mess'      ? `${messCap()} commander berths`
              : kind === 'pets'      ? `${petCap()} pens for animals`
              : `${shipSlots()} berths`;
    return { ok: true, message: `Upgraded — now ${now}.` };
  }

  // ── Launch / return ─────────────────────────────────────

  /** Validate and pay for a loadout. On success the ship and the
   *  chosen crew LEAVE the base and the supplies are drawn from the
   *  warehouse. Returns everything the run needs to build itself. */
  /**
   * What the ship can be packed FROM.
   *
   * This used to BUILD a throwaway grid out of the fuel/missile counters
   * and the gun array every time it was called, which meant the packing
   * screen was editing a copy and the base had to reconcile the two
   * afterwards (holdCost/pruneHold, and the duplication bugs that came
   * with them). It is simply the shelf now: drag an item out and it is
   * out, because there is only one of it.
   *
   * `reserveFuel` is what the tank stepper has claimed. The canisters
   * stay on the shelf until LAUNCH actually draws them, so this only
   * needs to be honest about what is spoken for.
   */
  function storeGrid() { return warehouseGrid(); }

  /** What a packed hold is worth to the run, in plain units. */
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
   * NOTHING TO PRUNE ANY MORE — kept as a no-op so old call sites and
   * tests keep working.
   *
   * The bug this used to paper over: pack a spare gun into the hold, walk
   * to the ARMOURY tab and fit that same gun to the hull, and you flew
   * with the gun twice — because the armoury array and the packed hold
   * were two independent records of one object. With a single store the
   * crate is either on the shelf or in the hold, so there is no second
   * record to fall out of step.
   */
  function pruneHold() { return []; }

  /* ── Yard repairs ──────────────────────────────────────
     A hull that came home holed used to stay holed until you found a
     station mid-run. The base is a shipyard; it can weld. */

  const HULL_REPAIR_PRICE = 4;         // CC per hull point, dearer than a port
  const PETS_START = 2;                // pens for animals, from day one

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

  function launch({ shipIndex = 0, crewIds = [], commanderId = null, petId = null,
                    fuel = 0, missiles = 0,
                    mission = 'patrol', weapons = [], hold = null,
                    store: liveStore = null } = {}) {
    const b = get();
    const entry = b.ships[shipIndex];
    if (!entry) return { ok: false, message: 'Pick a ship first.' };
    if (!MISSIONS[mission]) return { ok: false, message: 'Pick a contract first.' };

    /* THE HOLD IS ALREADY PACKED — those items physically left the shelf
       when the player dragged them across, so there is nothing to deduct
       for them here.

       AND THERE IS NO TANK LEFT TO FILL (update39). He2 used to be the
       last thing that left the shelf as loose UNITS and arrived as a
       counter — which is precisely why a ship could jump with an empty
       hold. Cells are cargo now, exactly like warheads: if the player
       wants fuel, he packs it. The `fuel` argument is ignored and kept
       only so old call sites and saves do not throw. */
    /* Take the CALLER'S shelf if it has one. BaseScreen holds the live
       grid the player has been dragging out of; re-reading it from the
       save here would resurrect everything they just packed, because the
       save still has it. The one store only stays one store if everybody
       works on the same copy of it. */
    const g = liveStore ?? warehouseGrid();

    // Spare guns the player marked to bring along leave the shelf too.
    const carried = [];
    if (g) {
      const crates = _gunCrates(g);
      [...weapons].sort((a, b2) => b2 - a).forEach(i => {
        const crate = crates[i];
        if (crate) { g.remove(crate); carried.push(crate.meta); }
      });
    }
    if (g) commitWarehouse(g);

    // Pull the crew first so a bad id can't half-commit the launch
    const roster = [];
    crewIds.forEach(id => {
      const c = b.barracks.find(x => x.id === id);
      if (c) roster.push(c);
    });
    roster.forEach(c => removeCrew(c.id));

    /* THE COMMANDER IS OPTIONAL (update43) — a contract flies fine
       without one. An id that does not name a commander who is HOME is
       simply dropped: better to launch captainless than to sail with a
       ghost, or with somebody already out on another hull. */
    const flying = commanderId ? (get().commanders ?? []).find(c => c.id === commanderId && !c.away) : null;

    /* ONE ANIMAL PER HULL (update45), whatever the pens hold. A second
       cat would just halve the work of the first, and the decision the
       pen is meant to create is "do I take one at all". */
    let pet = null;
    if (petId) {
      const rec = (b.pets ?? []).find(p => p.id === petId);
      if (rec) { pet = rec; b.pets = b.pets.filter(p => p.id !== petId); }
    }

    const packedGuns = holdCost(hold).guns;
    const ship = checkoutShip(shipIndex);
    b.lastMission = mission;
    b.packedHold = null;             // it is aboard now, not waiting
    _commit();

    return {
      ok: true,
      ship,
      crew: roster,
      commanderId: flying ? flying.id : null,
      pet,
      // Both ride in containers in `hold` now — see above.
      fuel: 0,
      missiles: Math.floor(missiles),
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

    // He2 left in the TANK comes home as canisters; warheads as racks.
    // Whatever the shelf cannot hold is lost, and the UI says so.
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
    warehouseGrid, commitWarehouse, storeCols, storeRows,
    packedHold, commitPackedHold,
    stashCols, stashRows, stashGrid, commitStash,
    crew, addCrew, removeCrew, hireRecruit, adoptCat,
    ships, buyShip, checkoutShip, storeShip, sellShip,
    armoury, storeWeapon, sellWeapon, weaponValue,
    installWeapon, uninstallWeapon, shipWeapons, shipSlotCount,
    upgradeCost, buyUpgrade,
    messCap, messLevel, messCost, buyMess,
    petCap, petLevel, pets, petById, addPet, losePet, savePet,
    commanders, commanderById, promote, promotable, saveCommander, loseCommander,
    launch, returnFromRun, loseRun,
    storeGrid, holdCost, pruneHold,
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
