/* ============================================================
   MOON WARS — basescreen.js
   The HOME BASE screen (canvas, same visual language as the HUD).

   Pure presentation + input over the Base model. It owns only the
   transient stuff a screen needs — which tab is open, what the
   player has picked for the next launch. Everything durable lives
   in base.js / Save.

   game.js drives it:
       BaseScreen.open()               → entering the base
       BaseScreen.update(dt)           → returns 'launch' | null
       BaseScreen.draw(ctx)
       BaseScreen.consumeLaunch()      → the loadout to fly with
   ============================================================ */

'use strict';

const BaseScreen = (() => {

  // The warehouse SHELF used to be a tab of its own. It is a supply line
  // like He2 and missiles, so it lives on the SUPPLY tab with them — one
  // place for everything the base is holding for you.

  /* ── FIVE TABS, NOT NINE (update115) ─────────────────────────────
   * jj: "za dużo zakładek, wszystko rozrzucone". The nine screens stay —
   * they are what they are — but the bar shows five GROUPS, and a group
   * with more than one screen shows its few sub-tabs at the right of the
   * same row. The flight itself is picked in the LOADOUT, so CREW and
   * MESS are where you manage people, not where you choose who flies.
   * Internal names do not change: every screen, save and test that says
   * 'MESS' still means the mess. Each group remembers its last sub-tab.
   */
  const TAB_GROUPS = [
    { key: 'SHIP',    tabs: [['HANGAR', 'HANGAR'], ['ARMOURY', 'ARMOURY']] },
    { key: 'CREW',    tabs: [['CREW', 'BARRACKS'], ['MESS', 'MESS']] },
    { key: 'STORES',  tabs: [['SUPPLY', 'SUPPLY'], ['DISPATCH', 'DISPATCH']] },
    { key: 'ARCHIVE', tabs: [['MEMORIAL', 'MEMORIAL'], ['WANTED', 'WANTED'], ['GATE', 'GATE']] },
  ];
  const _groupOf = (tab) => TAB_GROUPS.find(g => g.tabs.some(t => t[0] === tab)) || TAB_GROUPS[0];
  let _groupLast = {};

  /* ── THE MOON GATE (update56) ─────────────────────────────
   *
   * A place, not a mechanic. The Gate is what opens the other moons in
   * the full version; in the demo it is visible, explained and LOCKED.
   *
   * Deliberately NO BUILD BUTTON. A button that refuses is worse than
   * no button — same rule that deleted the unreachable branch in
   * update53. What the screen does have is a real parts list, counted
   * off the real warehouse, so the player can see the thing filling up
   * as he plays even though he cannot finish it yet.
   *
   * The parts are ORDINARY CARGO, by tag: one shelf, the same one
   * everything else uses. No second inventory for Gate components.
   */
  const GATE_PARTS = [
    { tag: 'he3',  label: 'He-3 Ore',        need: 40,
      from: 'Mined out of wrecks and sold at ports.' },
    { tag: 'rad',  label: 'Unstable Core',   need: 2,
      from: 'The hot salvage nobody else wants to carry.' },
    { tag: null, key: 'module_crate', label: 'Module Crate', need: 4,
      from: 'Whole ship systems, boxed.' },
    { tag: null, key: 'plating',      label: 'Hull Plating', need: 12,
      from: 'Cut-to-size armour sheet.' },
    { tag: null, key: 'drone_core',   label: 'Drone Core',   need: 3,
      from: 'An intact combat drone brain.' },
  ];

  /** How many of a Gate part are on the shelf right now. Counted off
   *  the warehouse grid — never stored, so it cannot go stale. */
  function _gateHave(part) {
    const g = Base.warehouseGrid?.();
    if (!g) return 0;
    if (part.tag) return g.countOfTag ? g.countOfTag(part.tag) : 0;
    return (g.items ?? []).reduce(
      (n, it) => n + (it.def === CARGO_ITEMS[part.key] && !it.damaged
        ? (it.isStack ? it.qty : 1) : 0), 0);
  }

  let _tab       = 'HANGAR';
  /* THE TOWN (update149) — jj: "Base powinno wyglądać coś na wzór zamku
     w Heroes". The base opens on the town; a building (or its number
     key) opens the screen behind its door; ◀ TOWN or ESCAPE walks back
     out. `_tab` is still the screen that door leads to. */
  let _town      = true;
  let _shipIdx   = 0;
  let _picked    = new Set();     // crew ids coming along
  let _fuel      = 0;             // legacy loose He2 — cells are the fuel now
  let _missiles  = 0;             // legacy loose rounds — crates are the real ammo now
  let _hold      = null;          // CargoGrid packed for the launch
  let _store     = null;          // CargoGrid of what the base can hand over
  let _mission   = 'patrol';
  let _zones     = [];            // {x,y,w,h,act,arg}
  let _launch    = null;          // filled when the player commits
  let _flash     = '';            // last message
  let _flashT    = 0;
  let _blink     = 0;             // drives the plague glyph's pulse
  /* THE YARD SHOWS HER CLOSED (update118, jj: "jak w FTL"). Every card
     and the big hull in the hangar carry their roof; the pointer on a
     card, or on the hull, takes it off in ROOF_FADE seconds, and
     INTERIOR [I] keeps the big one open. One alpha per picture,
     eased toward where it should be. */
  const ROOF_FADE = 0.3;
  const _roofs = new Map();       // picture id → 0 (open) .. 1 (closed)
  let _roofStep = 0;              // the last frame's dt, spent by the draw
  let _interior = false;          // INTERIOR [I]: the hangar hull held open
  let _hangarStage = null;        // where the big hull is, as last drawn
  function _roofEase(id, target) {
    const was = _roofs.has(id) ? _roofs.get(id) : 1;
    const k = ROOF_FADE > 0 ? _roofStep / ROOF_FADE : 1;
    const v = target > was ? Math.min(target, was + k) : Math.max(target, was - k);
    _roofs.set(id, v);
    return v;
  }
  // Hangar lists scroll instead of growing: the shipyard shows three
  // hulls, your berths show one, and everything below them keeps its
  // room no matter how many hulls exist.
  let _yardScroll  = 0;
  let _berthScroll = 0;
  /* The barracks grows: 5 bunks, +2 per upgrade. Three rows of cards
     is all the panel holds, so from the tenth bunk on the cards ran off
     the bottom of the panel and the HIRE RECRUIT button was drawn ON
     TOP of the last one. Same treatment as the hangar lists. */
  let _crewScroll  = 0;
  /* Which commander's file is open over the base, and how far down the
     promotion queue has been scrolled (update52a). */
  let _dossierId   = null;
  let _promoScroll = 0;
  /* The pending SELL, waiting for a yes (update54). Holds the action it
     will run and nothing else — the confirmation does not carry a copy
     of the price or the name, it re-reads them when it fires, so the
     dialog cannot sell one thing while saying another. */
  let _confirm     = null;
  /* THE RENAME FIELD (update54): who is being renamed and what has been
     typed so far. `from` is only used to put the old name back on the
     screen — the record is never touched until the player presses OK,
     so ESCAPE really does leave everything as it was. */
  let _rename      = null;
  /* The rack could hold more guns than the panel showed, and the extras
     were unreachable: no FIT, no SELL, just a line reading "…and 2 more
     on the rack". Guns you cannot reach are guns you cannot sell. */
  let _rackScroll  = 0;
  /* Which commander flies the next contract, or null. Only an id: the
     record itself lives in Base.commanders(), and keeping a second copy
     of him here is exactly the pattern that produced the duplicate-item
     bugs this project spent three updates deleting. */
  let _commanderId   = null;
  /* Which animal flies, or null. Only an id — the record lives in
     Base.pets(), same rule as the commander. */
  let _petId       = null;
  let _cpuId       = null;   // commander whose CPU board was just opened
  /* THE LOADOUT AND THE DESTINATION (update113) are screens over the base.
     They borrow every pick the tabs already keep (_mission, _shipIdx,
     _picked, _commanderId, _petId, _hold), so there is no second copy of a
     launch to drift. */
  let _screen      = null;        // null | 'loadout' | 'dest'
  let _hand        = null;        // what the cursor is carrying in the loadout
  let _press       = null;        // where the button went down (for a held drag)
  let _sel         = null;        // the crate last touched (outlined)
  let _filter      = 'ALL';       // the shelf filter
  let _shelfView   = { x: 0, y: 0 };
  let _barrScroll  = 0, _deckScroll = 0;
  let _posts       = {};          // crewId → roomId: where the player posted him
  let _loClock     = 0, _lastPick = -9;
  let _destMoon    = 'luna';
  let _orreryDate  = null;        // null = now; a test pins a date
  const RACK_VIS   = 3;              // taller rows, so fewer fit
  /* Promotion candidates visible at once. The panel is 386px tall and
     a candidate card is 84 — three fit under the heading with the
     scrollbar, and the fourth would be drawn off the panel, which is a
     candidate the player cannot reach. */
  const PROMO_ROWS = 3;

  function open() {
    const b = Base.get();
    _tab = 'HANGAR'; _groupLast = {}; _yardPick = null;
    _town = true;               // every visit starts in the street, not behind a door
    /* THE HULL YOU CAME HOME IN IS STILL SELECTED (update54).
       She docks at the END of the hangar list (checkoutShip splices her
       out, storeShip pushes her back), so the LAST entry carrying the
       remembered key is the one that just landed — not the first, which
       would pick a sister hull that never left the base. */
    _shipIdx = 0;
    {
      const want = b.lastShipKey;
      if (want) {
        for (let i = b.ships.length - 1; i >= 0; i--) {
          if (b.ships[i]?.key === want) { _shipIdx = i; break; }
        }
      }
    }
    _confirm = null;      // no question survives leaving the base
    _screen = null; _hand = null; _press = null; _sel = null; _posts = {};
    _barrScroll = 0; _deckScroll = 0; _shelfView = { x: 0, y: 0 };
    _rename  = null;
    _picked = new Set();
    /* THE FIRST CONTRACT IS THE ONE LIT (update104). jj: the card picked
       when you walk into the base was the second one — `lastMission`
       starts every save on Border Patrol, so a fresh run opened on the
       harder job. The first card in the row (the Courier Run, one sector,
       no boss) is the default now, every time; the player picks another
       with one click. */
    _mission = (Base.missions().find(m =>
      typeof missionRefusal !== 'function' || !missionRefusal(m)) || {}).id || 'courier';
    // Sensible default load: fill up on what we have, within reason
    _fuel     = 0;  // He2 rides in cells in the hold now, not as a number
    _missiles = 0;                 // missiles ride in racks now, not as a number
    _hold = null;                  // _buildHold restores whatever was packed
    _buildHold();
    /* A commander who died last run must not still be selected. Re-read
       the mess and keep the pick only if he is really there and home. */
    const home = (Base.commanders?.() ?? []).filter(c => !c.away);
    if (!home.some(c => c.id === _commanderId)) _commanderId = null;
    if (!_commanderId && home.length === 1) _commanderId = home[0].id;
    // An animal that did not come home must not still be selected.
    const kept = Base.pets?.() ?? [];
    if (!kept.some(a => a.id === _petId)) _petId = null;
    /* THE ROSTER THE PLAYER CHOSE LAST TIME (update54), narrowed to
       whoever actually came home — the dead and the still-away are
       simply not there to tick. Only a base that has never launched
       falls back to "the first four in the barracks", and that is the
       one moment when there is nothing better to offer. Picking for the
       player on every visit is what made the list look like it was
       ticking and unticking by itself. */
    const homeCrew = Base.crew();
    const remembered = (b.lastCrew ?? []).filter(id => homeCrew.some(c => c.id === id));
    if (remembered.length) remembered.forEach(id => _picked.add(id));
    else if (!b.lastCrew) homeCrew.slice(0, 4).forEach(c => _picked.add(c.id));
    _launch = null;
  }

  function consumeLaunch() { const l = _launch; _launch = null; return l; }

  /** Which commander's board the player just asked for. */
  function consumeCpu() { const id = _cpuId; _cpuId = null; return id; }
  /* The promotion screen lives in game.js beside the other full-screen
     panels, so the base asks for it the same way it asks for the CPU
     board: park the id, raise the action, let game.js pick it up. */
  let _levelUpId = null;
  function consumeLevelUp() { const id = _levelUpId; _levelUpId = null; return id; }

  /**
   * Hold sized for the SELECTED hull, keeping whatever still fits.
   *
   * The packed hold is PERSISTED (Base.packedHold). Items dragged out of
   * the warehouse have physically left it, so if the hold only lived in
   * this module they would evaporate the moment the player closed the
   * game — one store means one place for every item, always.
   */
  function _buildHold() {
    if (typeof CargoGrid === 'undefined') { _hold = null; _store = null; return; }
    const b = Base.get();
    const entry = b.ships[_shipIdx];
    const key   = entry?.key ?? 'scout';
    const layout = (typeof SHIP_LAYOUTS !== 'undefined' && SHIP_LAYOUTS[key]) || null;
    // ONE source for the hold's width: the hull's own layout (update46).
    const cols = layout?.cargoCols ?? 5;
    const rows = layout?.cargoRows ?? 4;

    const carried = _hold ? [..._hold.items] : (Base.packedHold?.()?.items ?? []);

    /* SWITCHING HULLS COULD DELETE CARGO (fixed in update48).
       The old version placed straight into the new grids:
           if (_hold.autoPlace(it)) return;
           if (_store?.autoPlace(it)) spilled++;
       — and when BOTH were full the third line simply did not exist.
       The crate was in no grid at all after that, which is deletion
       with extra steps. Build the new pair as CANDIDATES first; if
       even one crate has nowhere to go, nothing is committed and the
       hull stays as it was. */
    const nextHold  = new CargoGrid(cols, rows);
    const nextStore = Base.storeGrid();
    let spilled = 0, stranded = 0;
    carried.forEach(it => {
      if (nextHold.autoPlace(it)) return;
      if (nextStore?.autoPlace(it)) { spilled++; return; }
      stranded++;
    });
    if (stranded) {
      _say(`${stranded} crate(s) fit neither this hull nor the shelf — `
         + 'unload or sell something first.', false);
      return false;
    }
    _hold  = nextHold;
    _store = nextStore;
    _commitPack();
    if (spilled) _say(`${spilled} crate(s) would not fit this hull — back on the shelf.`, false);
    return true;
  }

  /** Write BOTH halves of the one store back to the save. */
  function _commitPack() {
    if (_store) Base.commitWarehouse?.(_store);
    Base.commitPackedHold?.(_hold);
  }

  /** The base changed under us (a purchase, a gun fitted, a hull sold) —
   *  re-read the shelf. Nothing has to be reconciled with the packed hold
   *  any more: an item is on the shelf or in the hold, never both. */
  function _syncStore() {
    if (typeof CargoGrid === 'undefined') return;
    _store = Base.storeGrid();
  }

  /** What the packed hold is worth to the run, in plain numbers. */
  function _holdSummary() {
    const sum = { fuel: 0, missiles: 0, guns: 0, cells: 0, cap: 0 };
    if (!_hold) return sum;
    sum.cells = _hold.usedCells(); sum.cap = _hold.capacity;
    _hold.items.forEach(it => {
      // A STACK carries its count in `qty`; only the legacy parcels have
      // `def.amount`. Reading `amount` on a modern rack or cell gives
      // undefined, so both of these figures used to read NaN on the card.
      const units = it.isStack ? it.qty : (it.def.amount ?? 0);
      if (it.def.kind === 'fuel') sum.fuel += units;
      else if (it.def.kind === 'missiles') sum.missiles += units;
      else if (it.def.kind === 'weapon') sum.guns++;
    });
    return sum;
  }

  /**
   * THE ONE LIVE SHELF (update79).
   *
   * `Base.storeGrid()` deserialises a BRAND NEW grid of brand new
   * items every time it is called — it is a reader, not an accessor.
   * So every screen that called it while the base was open was editing
   * its own private twin of the same shelf, and whichever twin was
   * written back last won.
   *
   * That is where the duplicated CPU chips came from. The player put a
   * chip on the commander's board; the board screen wrote its twin of
   * the shelf back to the save correctly, minus the chip — and then
   * this screen, still holding the twin it had cached BEFORE the board
   * was opened, wrote its own copy back at the next LAUNCH or
   * WAREHOUSE close and put the chip back on the shelf. Two on the
   * board, one on the shelf, and the player could keep going.
   *
   * One object now. Anything opened from the base borrows this shelf
   * rather than reading its own, so there is no second copy to go
   * stale. It is the same rule as everywhere else in this codebase:
   * two copies of one thing will always drift apart.
   */
  function liveShelf() {
    if (!_store) _store = Base.storeGrid();
    return _store;
  }

  /** game.js hands these to LootScreen and gives them back on close. */
  function packGrids() {
    if (!_hold) _buildHold();
    return { store: liveShelf(), hold: _hold };
  }

  /** game.js calls this when the packing screen closes. */
  function commitPack() { _commitPack(); }

  function _say(msg, good = true) {
    _flash = msg; _flashT = 3.2;
    if (typeof UI !== 'undefined') UI.notify?.(msg, good ? 'good' : 'warn');
  }

  // ── Input ───────────────────────────────────────────────

  /** Clamp both hangar lists to what actually exists. Called after any
   *  change to either list AND before every draw, so a sold hull can
   *  never leave the berth list scrolled past its own end. */
  function _clampScroll() {
    const b = Base.get();
    /* the hangar's two rows of tiles (update154): how many show is the layout's call */
    const H = hangarRects();
    _yardScroll  = Utils.clamp(_yardScroll,  0, Math.max(0, H.sale.length - H.yardVis));
    _berthScroll = Utils.clamp(_berthScroll, 0, Math.max(0, H.berthsAll - H.berthVis));
    /* the barracks scroll by rows of pod modules (update155) */
    _crewScroll = Utils.clamp(_crewScroll, 0, barracksRects().scrollMax);
    /* The promotion queue is NOT clamped here. It is clamped where it
       is drawn, and the drawn value is written back — one clamp, in
       the one place that knows how long the queue is this frame. Two
       clamps for one number is the drift this project keeps paying
       for. */
    _rackScroll = Utils.clamp(_rackScroll, 0,
                              Math.max(0, (Base.armoury?.() ?? []).length - RACK_VIS));
  }

  function update(dt) {
    if (_flashT > 0) _flashT -= dt;
    _blink += dt;
    _liftUpdate(dt);                     // the warehouse forklift (update159)
    _roofStep = dt;

    // The wheel scrolls whichever hangar list the pointer is over. It is
    // read BEFORE the click zones so a scroll never also counts as a
    // click on the card underneath.
    const wheel = Input.mouse.scrollDelta || 0;
    /* The briefing owns the wheel and the keys while it is open
       (update111): ENTER starts the contract, ESCAPE goes back. Nothing
       under a modal answers them — the dossier, the rename field and the
       question all sit ON TOP of the briefing and keep their own keys. */
    const modal = !!(_rename || _confirm || _dossierId);
    if (_screen && !modal) {
      return _screen === 'loadout' ? _loUpdate(dt) : _destUpdate(dt);
    } else if (!_screen && !modal && (Input.isPressed('Enter') || Input.isPressed('NumpadEnter'))) {
      return _act('loadout');
    }
    if (!_screen && !modal) {
      /* the number on a building's label is the key that opens it — from
         the town, and from inside any building (update152) */
      const door = (typeof TownView !== 'undefined' ? TownView.BUILDINGS : [])
        .find(bd => Input.isPressed(`Digit${bd.n}`) || Input.isPressed(`Numpad${bd.n}`));   // 6 is DISPATCH again (update161)
      if (door) return _act('building', door.tab);
    }
    if (!_screen && !modal && !_town && _tab === 'HANGAR' && _yardPick && Input.isPressed('Escape')) {
      _yardPick = null; return null;      // a hull for sale on view: ESC puts your own back (update154)
    }
    if (!_screen && !modal && !_town && Input.isPressed('Escape')) {
      return _act('town');      // ESCAPE behind a door: back out into the town
    }
    if (!_screen && !modal && !_town && _tab === 'HANGAR' && Input.isPressed('KeyI')) return _act('interior');
    const tabWheel = _town ? 0 : wheel;      // no list scrolls behind the town
    if (tabWheel && _tab === 'CREW') {
      _crewScroll += wheel > 0 ? 1 : -1;
      _clampScroll();
      return null;
    }
    if (tabWheel && _tab === 'ARMOURY') {
      _crateRow += wheel > 0 ? 1 : -1;       // a shelf at a time (update157); armouryRects() clamps it
      armouryRects();
      return null;
    }
    if (tabWheel && _tab === 'HANGAR') {
      const step = wheel > 0 ? 1 : -1;
      const mx = Input.mouse.x, my = Input.mouse.y, H = hangarRects(), S = H.strip;
      if (Utils.pointInRect(mx, my, S.x, S.y, S.w, S.h)) {
        if (mx >= H.divX) _yardScroll += step; else _berthScroll += step;
        _clampScroll();
        return null;
      }
    }

    /* THE FIELD HAS THE KEYBOARD WHILE IT IS OPEN (update54). Typed
       characters are drained here and nowhere else, so no other screen
       has to know the rename box exists. */
    if (_rename) {
      (Input.typedChars ? Input.typedChars() : []).forEach(ch => {
        if (ch >= ' ' && _rename.buffer.length < 14) _rename.buffer += ch;
      });
      if (Input.isPressed('Backspace')) _rename.buffer = _rename.buffer.slice(0, -1);
      if (Input.isPressed('Escape'))    { _rename = null; return null; }
      if (Input.isPressed('Enter') || Input.isPressed('NumpadEnter')) return _act('renameOk');
    }

    if (!Input.mouse.leftPressed) return null;
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (const z of _zones) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      Audio.sfx.uiClick?.();
      return _act(z.act, z.arg);
    }
    return null;
  }

  function _act(act, arg) {
    const b = Base.get();
    switch (act) {
      case 'tab':      _tab = arg; _town = false; _groupLast[_groupOf(arg).key] = arg; break;
      /* A DOOR IN THE TOWN (update149): the building's screen, for now
         the same screen its tab always was. */
      case 'building': {
        if (!TAB_GROUPS.some(q => q.tabs.some(t => t[0] === arg))) break;
        _tab = arg; _town = false; _groupLast[_groupOf(arg).key] = arg;
        break;
      }
      case 'town':     _town = true; break;
      /* The berth click is REFUSED when the packed hold cannot follow
         the player to the new hull — otherwise the crates that fit
         nowhere would be dropped on the floor. */
      case 'ship': {
        const was = _shipIdx;
        _yardPick = null;              // your own ship back in the cradle (update154)
        _shipIdx = arg;
        if (_buildHold() === false) _shipIdx = was;
        // Posts name rooms of a hull; another hull has other rooms.
        if (_shipIdx !== was) _posts = {};
        break;
      }
      // ONE STORE, ONE SCREEN. "Open the warehouse" and "pack the hold"
      // were two ways of looking at the same shelf; they are one button
      // now, because there is one shelf.
      case 'pack':
      case 'warehouse': packGrids(); return 'pack';
      case 'promote': {
        const r = Base.promote(arg);
        _say(r.message, r.ok);
        // A fresh commander is the one you meant to fly.
        if (r.ok && !_commanderId) _commanderId = r.commander.id;
        /* He arrives owing one pick per level, so the promotion screen
           opens straight away — a level 12 commander is twelve
           decisions, and hiding them behind a button nobody presses
           would leave the bonus unspent for the whole first contract. */
        if (r.ok) { _levelUpId = r.commander.id; return 'levelUp'; }
        break;
      }
      case 'levelUp':     _levelUpId = arg; return 'levelUp';
      case 'dossier':     _dossierId = arg; break;
      case 'dossierClose':_dossierId = null; break;
      case 'attrPoint': {
        const cap = Base.commanderById?.(arg?.id);
        if (cap && Commander.spendPoint(cap, arg.attr)) Base.saveCommander?.(cap);
        break;
      }
      case 'noop':        break;
      case 'scrollPromo': _promoScroll += arg; _clampScroll(); break;
      case 'pickCommander': _commanderId = (_commanderId === arg) ? null : arg; break;
      // ── THE LOADOUT AND THE DESTINATION (update113) ──
      case 'briefing':                                   // (the 111 name for it)
      case 'loadout':     _screen = 'loadout'; _hand = null; if (!_hold) _buildHold(); break;
      case 'loClose':     _loReturn(); _screen = null; break;
      case 'toDest': {
        if (!_loReturn()) { _say('Put what you are carrying down first.', false); break; }
        _screen = 'dest';
        // A contract this commander cannot take is not left lit.
        const m = Base.missions().find(x => x.id === _mission);
        if (!m || (typeof missionRefusal === 'function' && missionRefusal(m))) {
          _mission = (Base.missions().find(x => typeof missionRefusal !== 'function' || !missionRefusal(x)) || {}).id || _mission;
        }
        break;
      }
      case 'toLoadout':   _screen = 'loadout'; break;
      case 'destMoon': {
        const open = (typeof Save !== 'undefined' && Save.regionUnlocked) ? Save.regionUnlocked(arg) : arg === 'luna';
        _destMoon = arg;       // a locked moon can be looked at; its panel says why it is shut
        void open;
        break;
      }
      case 'destGate':    _screen = null; _tab = 'GATE'; _town = false; break;
      case 'loFilter':    _filter = arg; break;
      case 'scrollShelf': _shelfView.x += arg.dx; _shelfView.y += arg.dy; _shelfWin(); break;
      case 'pickPet':     _petId     = (_petId === arg) ? null : arg; break;
      /* The board is a screen of its own — hand the id up to
         game.js exactly the way PACK HOLD is handed up. */
      case 'cpu':         _cpuId = arg; return 'cpu';
      case 'adoptCat': {
        const r = Base.adoptCat();
        _say(r.message, r.ok);
        // The cat you just paid for is the one you meant to take.
        if (r.ok && !_petId) _petId = r.pet.id;
        break;
      }
      case 'buyShip':  {
        const r = Base.buyShip(arg); _say(r.message, r.ok);
        /* the hull you just bought is the one in the cradle, in her new berth (update154) */
        if (r.ok) { _yardPick = null; const i = b.ships.length - 1; _act('ship', i); _berthScroll = Math.max(0, i - 2); }
        _clampScroll(); _syncStore(); break;
      }
      /* A HULL FOR SALE, LOOKED AT IN THE CRADLE (update154); again = back to yours. */
      case 'yardView': _yardPick = (_yardPick === arg) ? null : arg; break;
      /* A BUILDING'S UPGRADE, BOUGHT IN THAT BUILDING (update154, jj: "upgrade budynków
         powinien być możliwy jak jesteśmy w danym budynku … coś w stylu potwierdzenia") */
      case 'upgradeAsk': {
        const o = upgradeOffer(arg);
        if (!o) break;
        if (Base.cc() < o.cost) { _say(`Need ${o.cost} CC.`, false); break; }
        _confirm = { act: 'upgrade', arg, yes: 'BUILD', yesCol: '#1aff8c',
                     text: `${o.label} for ${o.cost} CC?`, detail: `${o.now}  →  ${o.next}` };
        break;
      }
      case 'mission':  _mission = arg; break;
      case 'scrollYard':  _yardScroll  += arg; _clampScroll(); break;
      case 'scrollBerth': _berthScroll += arg; _clampScroll(); break;
      case 'scrollCrew':  _crewScroll  += arg; _clampScroll(); break;
      case 'scrollRack':  _rackScroll  += arg; _clampScroll(); break;
      // The WELD button in the hangar pushed this action and NOTHING
      // listened for it — the quote was drawn, the button lit up, and
      // clicking it played a click and did nothing at all.
      case 'repairHull': { const r = Base.repairHull(_shipIdx); _say(r.message, r.ok); break; }
      case 'interior':   _interior = !_interior; break;

      case 'crew': {
        if (_picked.has(arg)) _picked.delete(arg);
        else _picked.add(arg);
        break;
      }
      /* A POD (update155): a click opens his file; a second click on the same
         pod inside the double-click window takes him along / leaves him home. */
      /* A CRATE (update157): a click puts its gun on the card; a second click on the
         same crate inside the double-click window fits it to the first free mount. */
      case 'crate': {
        const dbl = _crateClick.i === arg && _blink - _crateClick.t <= 0.35;
        _crateSel = arg;
        _crateClick = dbl ? { i: -1, t: -9 } : { i: arg, t: _blink };
        if (dbl) return _act('fit', arg);
        break;
      }
      case 'scrollCrates': _crateRow += arg; armouryRects(); break;
      case 'bunk': {
        const dbl = _bunkClick.id === arg && _blink - _bunkClick.t <= 0.35;
        _bunkSel = arg;
        _bunkClick = dbl ? { id: null, t: -9 } : { id: arg, t: _blink };
        if (dbl) return _act('crew', arg);
        break;
      }
      case 'hire': { const r = Base.hireRecruit(); _say(r.message, r.ok);
        // Show the last page, where the new hand just landed.
        if (r.ok) { _crewScroll = 9999; _bunkSel = b.barracks[b.barracks.length - 1]?.id ?? _bunkSel; }   // his pod, his file
        _clampScroll(); _syncStore(); break; }
      /* SELLING ASKS FIRST (update54). The button no longer sells; it
         raises the question and the answer sells. `doSellShip` /
         `doSellGun` are the old bodies, reachable only through
         `confirmYes`, so there is exactly one path to a sale. */
      case 'sellShip': {
        const e = b.ships[arg];
        const def = e ? SHIP_CATALOG[e.key] : null;
        const paid = Math.round((def?.cost ?? 0) * (typeof SHIP_RESALE !== 'undefined' ? SHIP_RESALE : 0.3));
        _confirm = { act: 'doSellShip', arg,
                     text: `Sell the ${def?.label ?? 'ship'} for ${paid} CC?`,
                     detail: 'Her guns go back on the rack. The hull does not come back.' };
        break;
      }
      case 'doSellShip': { const r = Base.sellShip(arg); _say(r.message, r.ok); if (r.ok) { _shipIdx = 0; _berthScroll = 0; } _clampScroll(); _buildHold(); _syncStore(); break; }
      case 'confirmNo':  _confirm = null; break;
      /* RENAME (update54). Opening copies the current name into a
         buffer; nothing is written until OK, and Base.renameCrew is the
         one place that decides whether the new name is allowed. */
      case 'rename': {
        const rec = [...(b.barracks ?? []), ...(b.pets ?? []), ...(b.commanders ?? [])]
          .find(r => r && r.id === arg);
        if (rec) _rename = { id: arg, from: rec.name, buffer: rec.name ?? '' };
        break;
      }
      case 'renameCancel': _rename = null; break;
      case 'renameOk': {
        if (!_rename) break;
        const r = Base.renameCrew(_rename.id, _rename.buffer);
        _say(r.message, r.ok);
        if (r.ok) _rename = null;      // a refused name keeps the field open
        break;
      }
      case 'confirmYes': {
        const c = _confirm;
        _confirm = null;
        if (c) return _act(c.act, c.arg);
        break;
      }
      case 'fit':      { const r = Base.installWeapon(_shipIdx, arg);  _say(r.message, r.ok); _clampScroll(); _syncStore(); break; }
      case 'unfit':    { const r = Base.uninstallWeapon(_shipIdx, arg); _say(r.message, r.ok); _syncStore(); break; }
      case 'sellGun': {
        const key = (Base.armoury?.() ?? [])[arg];
        const def = key ? (typeof getWeaponDef === 'function' ? getWeaponDef(key) : null) : null;
        const paid = key ? Base.weaponValue(key) : 0;
        _confirm = { act: 'doSellGun', arg,
                     text: `Sell the ${def?.label ?? 'gun'} for ${paid} CC?`,
                     detail: 'It leaves the rack for good.' };
        break;
      }
      case 'doSellGun':  { const r = Base.sellWeapon(arg); _say(r.message, r.ok); _clampScroll(); _syncStore(); break; }

      case 'load': {
        /* THE TANK IS GONE (update39). He2 and warheads are both cargo:
           you pack cells and racks onto the hold, and the drive and the
           launchers feed straight out of them. Nothing here loads a
           number any more — the action is kept so an old zone or save
           cannot throw. */
        break;
      }
      /* BUYING (update159): onto the rack — the forklift is told what came and where it went */
      case 'buy': {
        const g0 = Base.warehouseGrid(), before = new Map((g0?.items ?? []).map(it => [`${it.defKey}@${_placeOf(it)}`, it.isStack ? it.qty : 1]));
        const r = Base.buySupply(arg[0], arg[1]); _say(r.message, r.ok); _syncStore();
        if (r.ok) _deliver(before, Base.warehouseGrid());
        break;
      }
      /* THE HUNT (update160): a poster's file; HUNT HIM asks, then takes the
         bounty and opens the loadout on his contract; a hunt can be given up. */
      case 'poster':  _posterSel = arg; break;
      case 'huntAsk': {
        const w = Save.wantedById?.(arg);
        if (!w) break;
        const job = MISSIONS[w.mission]?.label ?? 'his contract';
        _confirm = { act: 'hunt', arg, yes: 'HUNT HIM', yesCol: '#ff9a4d',
                     text: `Take the bounty on ${w.name}?`,
                     detail: `${w.bounty} CC alive · you fly the ${job}  ·  ${(Save.hunts?.() ?? []).length + 1} of ${Save.HUNT_MAX} hunts` };
        break;
      }
      case 'hunt': {
        if (!Save.huntWanted?.(arg)) { _say(`${Save.HUNT_MAX} hunts already — give one up first.`, false); break; }
        const w = Save.wantedById(arg);
        _say(`You hunt ${w.name}. He flies the ${MISSIONS[w.mission]?.label ?? 'contract'}.`, true);
        return _act('flyHunt', arg);
      }
      case 'flyHunt': {
        const w = Save.wantedById?.(arg);
        if (w && MISSIONS[w.mission]) _mission = w.mission;
        return _act('loadout');
      }
      case 'dropAsk': {
        const w = Save.wantedById?.(arg);
        if (!w) break;
        _confirm = { act: 'dropHunt', arg, yes: 'GIVE UP', yesCol: '#ff7c20',
                     text: `Give up the hunt for ${w.name}?`, detail: 'His poster stays on the board — you can take him on again.' };
        break;
      }
      case 'dropHunt': { const w = Save.wantedById?.(arg); if (Save.dropHunt?.(arg)) _say(`You stop hunting ${w?.name ?? 'him'}.`, true); break; }
      /* DISPATCH (update161) */
      case 'jobPick': _jobSel = arg; break;
      case 'jobTake': { const r = Base.takeJob(arg); _say(r.message, r.ok); const i = (Base.jobs?.() ?? []).findIndex(j => j.id === arg); if (i >= 0) _jobSel = i; break; }
      case 'jobDrop': { const r = Base.dropJob(arg); _say(r.message, r.ok); break; }
      case 'shelfPick':  _shelfSel = _shelfSel === arg ? null : arg; break;
      case 'rackScroll': _rackBay += arg; supplyRects(); break;
      case 'upgrade': { const r = Base.buyUpgrade(arg); _say(r.message, r.ok); _syncStore(); break; }

      /* LAUNCHING OVER A LIVE CONTRACT IS A WRITE-OFF (update57).
         The hull out there, everyone aboard her and everything in her
         hold are gone the moment a new one leaves — the base has no way
         to recall a ship. It is the second irreversible act in this
         screen, so it asks, exactly like SELL does. */
      case 'launch': {
        if (typeof Save !== 'undefined' && Save.hasShipInFlight && Save.hasShipInFlight()) {
          _confirm = { act: 'doLaunch',
                       text: 'A contract is still out there. Launch anyway?',
                       detail: 'That ship, her crew and her whole hold are written off. '
                             + 'CONTINUE brings you back to her instead.' };
          break;
        }
        return _act('doLaunch');
      }
      /* Back to the contract still in the air. game.js owns the run, so
         the base does what it does for every other screen change: names
         the action and lets game.js pick it up (update57). */
      case 'continue': return 'continue';
      case 'doLaunch': {
        _commitPack();
        const res = Base.launch({
          shipIndex: _shipIdx,
          crewIds: [..._picked],
          commanderId: _commanderId,
          petId: _petId,
          posts: _posts,
          fuel: _fuel, missiles: _missiles,
          mission: _mission,
          hold: _hold,
          store: _store,          // the live shelf, not a re-read of the save
        });
        if (!res.ok) { _say(res.message, false); break; }
        _launch = res;
        return 'launch';
      }
      default: break;
    }
    return null;
  }

  // ── Draw helpers ────────────────────────────────────────

  function _btn(ctx, x, y, w, h, label, opts = {}) {
    const { col = '#4db8ff', act = null, arg = null, on = false,
            enabled = true, sub = null, font = '12px Share Tech Mono, monospace' } = opts;
    // save/restore: this helper centres text, and leaking that setting
    // put the NEXT label (the second shipyard card) half a width to the
    // left, straight on top of its neighbour.
    ctx.save();
    const hot = Utils.pointInRect(Input.mouse.x, Input.mouse.y, x, y, w, h);
    ctx.fillStyle = on ? 'rgba(26,140,255,0.22)'
                  : hot && enabled ? 'rgba(26,140,255,0.12)' : 'rgba(13,17,32,0.9)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
    ctx.strokeStyle = enabled ? (on ? '#4db8ff' : col) : '#2a3346';
    ctx.lineWidth = on ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.stroke();
    ctx.fillStyle = enabled ? (on ? '#c8e8ff' : col) : '#3d4a63';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + (sub ? -2 : 4));
    if (sub) {
      ctx.fillStyle = enabled ? '#7a90a8' : '#3d4a63';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 12);
    }
    ctx.restore();
    // One chirp when the pointer arrives, not sixty a second.
    if (hot && enabled) Audio.hoverCue?.(`b:${act}:${arg}:${x},${y}`);
    if (act && enabled) _zones.push({ x, y, w, h, act, arg });
  }

  function _panel(ctx, x, y, w, h, title, alpha = 0.92) {
    ctx.fillStyle = `rgba(10,14,26,${alpha})`;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.stroke();
    if (title) {
      ctx.fillStyle = '#4db8ff';
      ctx.font = '12px Orbitron, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(title, x + 12, y + 20);
    }
  }

  function _bar(ctx, x, y, w, val, max, col) {
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * Utils.clamp(max ? val / max : 0, 0, 1), 8);
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, 8);
  }

  /**
   * A vertical scrollbar for a list that shows `visible` of `total` rows
   * starting at `first`. Arrows top and bottom, a thumb sized to the
   * fraction on screen. Draws nothing at all when everything fits, so a
   * short list never grows furniture it does not need.
   */
  function _scrollBar(ctx, x, y, h, first, visible, total, act) {
    if (total <= visible) return;
    const AW = 14;                       // arrow button height
    const upOn = first > 0, dnOn = first + visible < total;

    const arrow = (ay, glyph, on, delta) => {
      ctx.fillStyle = on ? 'rgba(26,140,255,0.16)' : 'rgba(13,17,32,0.85)';
      ctx.beginPath(); ctx.roundRect(x, ay, 12, AW, 3); ctx.fill();
      ctx.strokeStyle = on ? '#4db8ff' : '#2a3346'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, ay, 12, AW, 3); ctx.stroke();
      ctx.fillStyle = on ? '#9fdcff' : '#3d4a63';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(glyph, x + 6, ay + AW / 2 + 3);
      ctx.textAlign = 'left';
      if (on) _zones.push({ x, y: ay, w: 12, h: AW, act, arg: delta });
    };

    arrow(y, '▲', upOn, -1);
    arrow(y + h - AW, '▼', dnOn, 1);

    const trackY = y + AW + 3, trackH = h - AW * 2 - 6;
    ctx.fillStyle = 'rgba(6,9,16,0.9)';
    ctx.fillRect(x + 3, trackY, 6, trackH);
    const thumbH = Math.max(14, Math.round(trackH * visible / total));
    const span   = Math.max(1, total - visible);
    const thumbY = trackY + Math.round((trackH - thumbH) * (first / span));
    ctx.fillStyle = '#4db8ff';
    ctx.globalAlpha = 0.65;
    ctx.fillRect(x + 3, thumbY, 6, thumbH);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#5f7893';
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(x + 6, y + h + 12);
    ctx.fillText(`${first + 1}-${Math.min(total, first + visible)}/${total}`, 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // ── Draw ────────────────────────────────────────────────

  function draw(ctx) {
    _zones = [];
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    const b = Base.get();

    /* THE TOWN (update149) is the whole screen: the painting, its
       labels, and the bar with the next contract. Behind a door it is
       the screen as it always was, with ◀ TOWN in the title row; THE
       HILL is a place of its own, painted full screen under the tabs. */
    const inTown = _town && !_screen && typeof TownView !== 'undefined';
    const onHill = !_town && !_screen && _tab === 'MEMORIAL';
    if (inTown) {
      _drawTown(ctx, W, H, b);
    } else if (_screen) {
      /* Under the briefing (update138) nothing of the base is drawn: it
         covers the whole screen, and the hangar under it was building a
         second picture of the same ship every frame. */
      Renderer.drawBackground(0);
    } else {
      /* INSIDE A BUILDING (update152, jj: "klikamy w hangar, to idziemy do
         hangaru, i exit — do wszystkich"). No tab bar: the town is the way
         between buildings (and 1-9 from any of them). The room is painted
         behind, its name and its keeper's line on it; ◀ TOWN and LOADOUT
         at the foot. THE HILL is its own picture, as before. */
      if (onHill) _drawHillBack(ctx, W, H);
      else if (typeof TownView !== 'undefined') TownView.drawRoom(ctx, _tab);
      else { Renderer.drawBackground(0); ctx.fillStyle = 'rgba(7,8,15,0.82)'; ctx.fillRect(0, 0, W, H); }
      _drawRoomHeader(ctx, W, H);
      const { x: px, y: py, w: pw, h: ph } = ROOM_RECT;
      if (!onHill) _panel(ctx, px, py, pw, ph, null, 0.78);
      if (_tab === 'HANGAR')   _drawHangar(ctx, px, py, pw, ph, b);
      if (_tab === 'ARMOURY')  _drawArmoury(ctx, px, py, pw, ph, b);
      if (_tab === 'CREW')     _drawCrew(ctx, px, py, pw, ph, b);
      if (_tab === 'MESS')     _drawMess(ctx, px, py, pw, ph, b);
      if (_tab === 'SUPPLY')   _drawSupply(ctx, px, py, pw, ph, b);
      if (_tab === 'MEMORIAL') _drawMemorial(ctx, W, H);
      if (_tab === 'WANTED')   _drawWanted(ctx, px, py, pw, ph);
      if (_tab === 'GATE')     _drawGate(ctx, px, py, pw, ph);
      if (_tab === 'DISPATCH') _drawDispatch(ctx);
      _drawRoomBar(ctx, W, H, b, onHill);
    }

    if (_flashT > 0 && _flash) {
      ctx.globalAlpha = Utils.clamp(_flashT, 0, 1);
      ctx.fillStyle = '#ffd700';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(_flash, W / 2, 128);
      ctx.globalAlpha = 1;
    }

    /* ── THE PRE-FLIGHT BRIEFING (update111) ──
       Over the tabs, under the dossier / rename / question — those can be
       raised FROM it (the launch-over-a-live-contract question is). It
       clears the zones first, so nothing behind it can be pressed. */
    if (_screen) {
      _zones = [];
      if (_screen === 'loadout') _drawLoadout(ctx, W, H, b);
      else _drawDest(ctx, W, H, b);
      if (_flashT > 0 && _flash) {
        ctx.globalAlpha = Utils.clamp(_flashT, 0, 1);
        ctx.fillStyle = '#ffd700'; ctx.font = '12px Share Tech Mono, monospace'; ctx.textAlign = 'center';
        ctx.fillText(_flash, W / 2, _screen === 'loadout' ? 640 : 700);
        ctx.globalAlpha = 1; ctx.textAlign = 'left';
      }
    }

    /* ── THE COMMANDER'S FILE, OVER EVERYTHING (update52a) ──
       Drawn LAST and it CLEARS the zone list first, so nothing behind
       it can be clicked through the panel. A modal that leaves the
       buttons under it live is worse than no modal: the player presses
       LAUNCH aiming at a line of text. */
    const dossier = _dossierId ? Base.commanderById?.(_dossierId) : null;
    if (dossier) {
      _zones = [];
      const r = Renderer.drawCommanderDossier(ctx, dossier);
      _zones.push({ ...r.close, act: 'dossierClose' });
      // RENAME from the file itself (update54) — before the swallow-all
      // panel zone below, or the panel would eat the press.
      if (r.rename) _zones.push({ ...r.rename, act: 'rename', arg: _dossierId });
      // Attribute points from the file (update98), same door as the screen.
      (r.attrPlus || []).forEach(z => _zones.push({ ...z, act: 'attrPoint', arg: { id: _dossierId, attr: z.attr } }));
      /* Anywhere else on the panel swallows the click; anywhere OUTSIDE
         it closes, which is what every player tries first. */
      _zones.push({ ...r.panel, act: 'noop' });
      _zones.push({ x: 0, y: 0, w: W, h: H, act: 'dossierClose' });
    } else if (_dossierId) {
      _dossierId = null;      // he was lost or promoted away while open
    }

    /* ── THE RENAME FIELD (update54) ───────────────────────────
       Same modal contract as the two below: drawn last, clears the
       zones, only its own buttons are live. The player types over the
       name he clicked; ENTER accepts, ESCAPE walks away. A refused
       name (already taken, or empty) leaves the box open with the
       reason on the flash line, because closing it would throw away
       what he typed. */
    if (_rename) {
      _zones = [];
      const r = _renameRects(W, H);
      ctx.fillStyle = 'rgba(3,5,10,0.72)';
      ctx.fillRect(0, 0, W, H);
      _panel(ctx, r.panel.x, r.panel.y, r.panel.w, r.panel.h, null);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#4db8ff';
      ctx.font = '14px Orbitron, monospace';
      ctx.fillText('RENAME', r.panel.x + r.panel.w / 2, r.panel.y + 30);
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`was ${_rename.from ?? ''}`, r.panel.x + r.panel.w / 2, r.panel.y + 48);

      // The field itself
      ctx.fillStyle = 'rgba(6,10,20,0.95)';
      ctx.fillRect(r.field.x, r.field.y, r.field.w, r.field.h);
      ctx.strokeStyle = '#4db8ff'; ctx.lineWidth = 1;
      ctx.strokeRect(r.field.x + 0.5, r.field.y + 0.5, r.field.w - 1, r.field.h - 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#c8e8ff';
      ctx.font = '15px Share Tech Mono, monospace';
      const caret = (Math.floor(_blink * 2) % 2) ? '_' : ' ';
      ctx.fillText(`${_rename.buffer}${caret}`, r.field.x + 10, r.field.y + 24);

      _btn(ctx, r.ok.x, r.ok.y, r.ok.w, r.ok.h, 'OK', { act: 'renameOk' });
      _btn(ctx, r.cancel.x, r.cancel.y, r.cancel.w, r.cancel.h, 'CANCEL',
           { act: 'renameCancel', col: '#7a90a8' });
      _zones.push({ ...r.panel, act: 'noop' });
      _zones.push({ x: 0, y: 0, w: W, h: H, act: 'renameCancel' });
      return;      // nothing under a text field is clickable
    }

    /* ── ARE YOU SURE? (update54) ──────────────────────────────
       SELL used to be one click from gone: a gun or a whole hull left
       the base on a misclick and the only trace was a line of green
       text saying how much you got for it. Selling is the one action
       in this screen with no undo, so it is the one that asks.
       Same modal contract as the dossier above: drawn last, clears the
       zones, and the only live buttons are its own. */
    if (_confirm) {
      _zones = [];
      const r = _confirmRects(W, H);
      ctx.fillStyle = 'rgba(3,5,10,0.72)';
      ctx.fillRect(0, 0, W, H);
      _panel(ctx, r.panel.x, r.panel.y, r.panel.w, r.panel.h, null);
      ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(r.panel.x, r.panel.y, r.panel.w, r.panel.h, 6);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb020';
      ctx.font = '15px Orbitron, monospace';
      ctx.fillText('ARE YOU SURE?', r.panel.x + r.panel.w / 2, r.panel.y + 34);
      ctx.fillStyle = '#c8d8f0';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText(_confirm.text, r.panel.x + r.panel.w / 2, r.panel.y + 62);
      if (_confirm.detail) {
        ctx.fillStyle = '#7a90a8';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(_confirm.detail, r.panel.x + r.panel.w / 2, r.panel.y + 82);
      }

      _btn(ctx, r.yes.x, r.yes.y, r.yes.w, r.yes.h, _confirm.yes ?? 'SELL',
           { act: 'confirmYes', col: _confirm.yesCol ?? '#ffb020' });
      _btn(ctx, r.no.x, r.no.y, r.no.w, r.no.h, 'CANCEL',
           { act: 'confirmNo', col: '#7a90a8' });
      // Anywhere else on the panel swallows the click; outside it cancels.
      _zones.push({ ...r.panel, act: 'noop' });
      _zones.push({ x: 0, y: 0, w: W, h: H, act: 'confirmNo' });
    }
  }

  /* ONE SOURCE FOR THE CONFIRM GEOMETRY — the drawing and the hit test
     read the same rectangles, so a button cannot move on screen without
     its click coming along (the rule `Renderer.orderRects()` set in
     update53). Exported for the tests through `confirmRects`. */
  function _renameRects(W = Renderer.getWidth(), H = Renderer.getHeight()) {
    const w = 380, h = 170;
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
    const bw = 130, bh = 32, gap = 20;
    return {
      panel:  { x, y, w, h },
      field:  { x: x + 30, y: y + 62, w: w - 60, h: 34 },
      ok:     { x: x + w / 2 - bw - gap / 2, y: y + h - bh - 18, w: bw, h: bh },
      cancel: { x: x + w / 2 + gap / 2,      y: y + h - bh - 18, w: bw, h: bh },
    };
  }

  function _confirmRects(W = Renderer.getWidth(), H = Renderer.getHeight()) {
    const w = 420, h = 150;
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
    const bw = 150, bh = 34, gap = 20;
    const by = y + h - bh - 18;
    return {
      panel: { x, y, w, h },
      yes:   { x: x + w / 2 - bw - gap / 2, y: by, w: bw, h: bh },
      no:    { x: x + w / 2 + gap / 2,      y: by, w: bw, h: bh },
    };
  }

  /**
   * THE MOON GATE SCREEN (update56).
   *
   * Schematic on the left, parts list on the right, one line at the
   * bottom saying plainly that it cannot be built in this version.
   * Everything is drawn in greys: it is not a thing you can act on, and
   * it must not look like one.
   */
  /* ── WANTED: THE MARSHAL'S OFFICE (update160) ───────────────────────
   *
   * A READ of `Save.wanted()` every frame, as since update64 — no copy kept
   * here. jj (22.10) on the mock-up: the board between two holding cells,
   * the posters pinned 2 × 2, a click puts a man's file on the right; HUNT
   * HIM "to jest potwierdzenie, że bierzesz kontrakt na niego" — a question,
   * then the hunt (`Save.huntWanted`, at most `Save.HUNT_MAX`) and the
   * loadout with his contract picked; a hunt can be given up again. The
   * cells are decoration, unless the last run handed somebody over: then he
   * paces in there until the next contract leaves (`Base.holding()`). Faces
   * bare, a mugshot (jj: "jak bardziej logicznie i realnie"). `wantedRects()`
   * is the one geometry; the poster is `Renderer.drawWantedPoster`, the
   * same one a hunt's chip shows in flight.
   */
  let _posterSel = 0;
  function wantedRects() {
    const area = { x: 16, y: 62, w: 870, h: 530 }, card = { x: 894, y: 62, w: 370, h: 530 };
    const PW = Renderer.POSTER?.W ?? 250, PH = Renderer.POSTER?.H ?? 172;
    const board = { x: area.x + 146, y: area.y + 40, w: area.w - 292, h: 418 };
    const posters = [0, 1, 2, 3].map(i => ({ i, x: board.x + 24 + (i % 2) * (PW + 24), y: board.y + 40 + Math.floor(i / 2) * (PH + 18),
                                             w: PW, h: PH }));
    posters.forEach((q, i) => { q.x += [-3, 4, 2, -2][i]; q.y += [2, -3, 1, 3][i]; });   // pinned by hand, not on a grid
    return { area, card, board, posters,
             cells: [{ x: area.x + 12, y: area.y + 60, w: 118, h: area.h - 110 }, { x: area.x + area.w - 130, y: area.y + 60, w: 118, h: area.h - 110 }],
             face: { x: card.x + 14, y: card.y + 36, w: 120, h: 120 },
             how:  [{ x: card.x + 14, y: card.y + 262, w: 166, h: 120 }, { x: card.x + 190, y: card.y + 262, w: 166, h: 120 }],
             hunt: { x: card.x + 14, y: card.y + 448, w: card.w - 28, h: 66 },
             fly:  { x: card.x + 14, y: card.y + 448, w: card.w - 28, h: 40 },
             drop: { x: card.x + 14, y: card.y + 494, w: card.w - 28, h: 22 } };
  }

  function _drawWanted(ctx, px, py, pw, ph) {
    const R = wantedRects(), A = R.area, C = R.card, B = R.board;
    const list = (typeof Save !== 'undefined' && Save.wanted) ? Save.wanted() : [];
    const F = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const T = (s, x, y, col, size, al = 'left', bold = false, font = 'Share Tech Mono') => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
    if (_posterSel >= list.length) _posterSel = Math.max(0, list.length - 1);

    // ── the wall, and the two holding cells ──
    F(A.x, A.y, A.w, A.h, '#0d0b0a');
    for (let x = A.x; x < A.x + A.w; x += 60) F(x, A.y, 1, A.h, 'rgba(255,124,32,0.05)');
    const held = Base.holding?.() ?? [];
    R.cells.forEach((c, ci) => {
      F(c.x, c.y, c.w, c.h, '#06070a'); F(c.x, c.y, c.w, 6, '#3a2e26');
      // whoever was handed over last time, pacing behind the bars
      held.filter((_, k) => k % 2 === ci).forEach((p, k) => {
        const t = _blink * 0.5 + ci * 1.7 + k * 2.3, sway = Math.sin(t) * (c.w / 2 - 34);
        const fx = c.x + c.w / 2 - 18 + sway, fy = c.y + c.h - 120 - k * 8;
        const face = (typeof CrewArt !== 'undefined') ? CrewArt.portraitCanvas({ name: p.name, race: p.race }, { bare: true }) : null;
        F(fx - 2, fy + 40, 40, 58, '#c8742a'); F(fx - 2, fy + 40, 40, 4, '#e09040');          // the orange jumpsuit
        F(fx + 4, fy + 98, 11, 16, '#5a3a1a'); F(fx + 21, fy + 98, 11, 16, '#5a3a1a');
        if (face) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(face, fx - 4, fy - 4, 44, 44); ctx.restore(); }
        T(_clip(ctx, p.name, c.w - 12), c.x + c.w / 2, c.y + c.h + 14 + k * 12, '#c8a070', 9, 'center');
      });
      for (let bx = c.x + 8; bx < c.x + c.w - 4; bx += 14) { F(bx, c.y + 6, 4, c.h - 6, '#4a4038'); F(bx, c.y + 6, 1, c.h - 6, '#7a6a58'); }
      F(c.x, c.y + 140, c.w, 5, '#3a2e26');
      const lit = held.some((_, k) => k % 2 === ci);
      F(c.x + c.w / 2 - 10, c.y + 10, 20, 8, lit ? '#ff2d44' : '#5a1a20');
      if (lit) { ctx.fillStyle = `rgba(255,45,68,${0.12 + 0.06 * Math.sin(_blink * 3)})`; ctx.beginPath(); ctx.arc(c.x + c.w / 2, c.y + 14, 26, 0, Math.PI * 2); ctx.fill(); }
      if (!held.some((_, k) => k % 2 === ci)) T('HOLDING', c.x + c.w / 2, c.y + c.h + 16, '#5a4a38', 10, 'center', true);
    });
    T(held.length ? `handed over last time — the yard takes them when the next contract leaves` : 'empty — prisoners are handed over at the dock',
      A.x + A.w / 2, A.y + A.h - 14, '#5a4a38', 9, 'center');

    // ── the board ──
    F(B.x - 8, B.y - 8, B.w + 16, B.h + 16, '#2a2420');
    F(B.x, B.y, B.w, B.h, '#5a4028');
    for (let i = 0; i < 700; i++) {
      const r = Math.abs((Math.sin(i * 91.7) * 43758.5) % 1), q = Math.abs((Math.sin(i * 12.9 + 4) * 9133.1) % 1);
      F(B.x + r * (B.w - 2), B.y + q * (B.h - 2), 2, 2, i % 2 ? '#6a4c30' : '#4a3420');
    }
    F(B.x - 20, B.y - 30, B.w + 40, 8, '#3a4458');
    ctx.fillStyle = 'rgba(255,200,140,0.07)'; ctx.fillRect(B.x, B.y - 22, B.w, B.h + 22);
    T('BY ORDER OF THE YARD · BRING THEM IN', B.x + B.w / 2, B.y + 22, '#e8d0a0', 12, 'center', true, 'Orbitron');
    R.posters.forEach(s => {
      const w = list[s.i];
      if (!w) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = '#8a6a48'; ctx.lineWidth = 1; ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1); ctx.setLineDash([]);
        T('a name goes up after a contract', s.x + s.w / 2, s.y + s.h / 2, '#9a7a58', 10, 'center');
        return;
      }
      Renderer.drawWantedPoster?.(ctx, w, s.x, s.y, { w: s.w, h: s.h });
      if (s.i === _posterSel) { ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 3; ctx.strokeRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6); }
      _zones.push({ x: s.x, y: s.y, w: s.w, h: s.h, act: 'poster', arg: s.i });
    });
    const hs = Save.hunts?.() ?? [];
    T(`${list.length} of ${Save.WANTED_MAX} posters · hunting ${hs.length} of ${Save.HUNT_MAX} · click a poster: his file`,
      B.x + B.w / 2, B.y + B.h + 30, '#9a8a70', 10, 'center');
    ctx.textAlign = 'left';

    // ── HIS FILE ──
    F(C.x, C.y, C.w, C.h, 'rgba(8,12,22,0.95)'); F(C.x, C.y, 3, C.h, '#ff7c20');
    ctx.strokeStyle = '#ff7c2066'; ctx.lineWidth = 1; ctx.strokeRect(C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1);
    const w = list[_posterSel];
    if (!w) {
      T('THE BOARD IS EMPTY', C.x + 16, C.y + 24, '#ff9a4d', 12, 'left', false, 'Orbitron');
      ctx.font = '11px Share Tech Mono, monospace'; ctx.fillStyle = '#7a90a8';
      _wrap(ctx, 'Finish a contract and the yard will find somebody.', C.x + 16, C.y + 52, C.w - 32, 14, 3);
      return;
    }
    const hunted = !!Save.isHunted?.(w.id), job = (typeof MISSIONS !== 'undefined' && MISSIONS[w.mission]?.label) || 'any contract';
    T(hunted ? 'HIS FILE · YOU HUNT HIM' : 'HIS FILE', C.x + 16, C.y + 24, '#ff9a4d', 12, 'left', false, 'Orbitron');
    const Fc = R.face;
    F(Fc.x, Fc.y, Fc.w, Fc.h, '#9a8a70');
    const face = (typeof CrewArt !== 'undefined') ? CrewArt.portraitCanvas({ name: w.name, race: w.race }, { bare: true }) : null;
    if (face) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(face, Fc.x + 2, Fc.y + 2, Fc.w - 4, Fc.h - 4); ctx.restore(); }
    if (hunted && typeof MapNode !== 'undefined') MapNode.drawCrosshair(ctx, Fc.x + Fc.w / 2, Fc.y + Fc.h / 2, Fc.w / 2 - 8, 'rgba(255,124,32,0.9)');
    T(_clip(ctx, w.name, 200), C.x + 146, C.y + 54, '#f0e2c0', 16, 'left', true);
    T(`${(typeof CORP_DEFS !== 'undefined' && CORP_DEFS[w.race]?.label) || w.race}`, C.x + 146, C.y + 72, '#9a8a70', 11);
    T(`level ${w.level}${w.escapes ? ` · escaped ${w.escapes}×` : ''}`, C.x + 146, C.y + 88, '#9a8a70', 11);
    T(`${w.bounty} CC alive`, C.x + 146, C.y + 116, '#1aff8c', 16, 'left', true);
    T(`${Math.round(w.bounty / 2)} CC for the body`, C.x + 146, C.y + 134, '#7a90a8', 11);
    T('WHERE', C.x + 16, C.y + 184, '#5f7893', 11);
    T(_clip(ctx, `on the ${job} contract`, C.w - 32), C.x + 16, C.y + 202, '#4db8ff', 12, 'left', true);
    const reg = Save.REGIONS?.[w.region]?.label;
    T(w.state === 'sighted' ? `last seen: ${reg ?? '?'}${w.sector ? ', sector ' + w.sector : ''}` : 'nobody has met him yet',
      C.x + 16, C.y + 220, w.state === 'sighted' ? '#ffd700' : '#7a90a8', 11);
    // how: alive in a cold slab, or a body in a bag — the things themselves
    T('HOW TO BRING HIM IN', C.x + 16, C.y + 252, '#5f7893', 11);
    R.how.forEach(h => F(h.x, h.y, h.w, h.h, 'rgba(18,22,36,0.95)'));
    const slab = typeof moduleArt === 'function' ? moduleArt('carbonite') : null;
    if (slab) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(slab, R.how[0].x + 8, R.how[0].y + 10, 150, 75); ctx.restore(); }
    T('ALIVE · ×1', R.how[0].x + 8, R.how[0].y + 100, '#1aff8c', 11, 'left', true);
    T('a carbonite bay on the hull', R.how[0].x + 8, R.how[0].y + 114, '#7a90a8', 9);
    if (typeof LootScreen !== 'undefined' && typeof CargoItem !== 'undefined') {
      const bag = new CargoItem('body_bag'), P = LootScreen.CELL + 4;
      LootScreen.drawCargoItem(ctx, bag, R.how[1].x + Math.round((R.how[1].w - (bag.w * P - 4)) / 2), R.how[1].y + 30, 1, false, false);
    }
    T('BODY · ×½', R.how[1].x + 8, R.how[1].y + 100, '#c8b090', 11, 'left', true);
    T(`${CARGO_ITEMS?.body_bag ? CARGO_ITEMS.body_bag.w * CARGO_ITEMS.body_bag.h : 2} places in the hold, home`, R.how[1].x + 8, R.how[1].y + 114, '#7a90a8', 9);
    // the hunt
    if (hunted) {
      _btn(ctx, R.fly.x, R.fly.y, R.fly.w, R.fly.h, `FLY THE ${job.toUpperCase()}  ▶`,
           { act: 'flyHunt', arg: w.id, col: '#ff9a4d', font: '13px Orbitron, monospace' });
      _btn(ctx, R.drop.x, R.drop.y, R.drop.w, R.drop.h, 'GIVE UP THE HUNT', { act: 'dropAsk', arg: w.id, col: '#7a90a8', font: '10px Share Tech Mono, monospace' });
    } else {
      const full = hs.length >= (Save.HUNT_MAX ?? 2);
      _btn(ctx, R.hunt.x, R.hunt.y, R.hunt.w, R.hunt.h, full ? `${Save.HUNT_MAX} HUNTS ALREADY` : `HUNT HIM — ${job.toUpperCase()}  ▶`,
           { act: full ? null : 'huntAsk', arg: w.id, enabled: !full, col: '#ff9a4d', font: '14px Orbitron, monospace',
             sub: full ? 'give one of them up first' : 'take the bounty: his contract, then the loadout' });
    }
  }

  /* ── THE MOON GATE: A RING THAT WANTS TO WAKE (update158) ────────────
   *
   * jj (21.10): "menu gate okno do ulepszenia — lepsza grafika, fajne efekty"
   * → "dodaj ikony w ringu: znaki zodiaku i oryginalne znaki planet". The ring
   * is 24 segments, each with a sign — the twelve of the zodiac and the old
   * signs of the planets (and the Sun, the Moon, a comet), taking turns. As many
   * segments light as the shelf holds of the parts (the same `done` as the
   * list); inside it a swirl of stars and arcs of energy turn, and sparks jump
   * the gap where the ring is unfinished. On the right a socket for each part
   * that fills as the shelf does; the destinations between; and the one line,
   * no button: construction is not in this version. `gateRects()` is the one
   * geometry. Still no BUILD (update56).
   */
  const GATE_SIGNS = (() => {
    const zod = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
    const pln = ['☿', '♀', '♁', '♂', '♃', '♄', '♅', '♆', '♇', '☉', '☽', '☄'];
    const VS = '\uFE0E';                 // text presentation, not an emoji
    return Array.from({ length: 24 }, (_, i) => (i % 2 ? pln[(i - 1) / 2] : zod[i / 2]) + VS);
  })();

  function gateRects() {
    const area = { x: 16, y: 62, w: 1248, h: 530 };
    return {
      area, ring: { cx: area.x + 300, cy: area.y + 280, r: 186, seg: 24 },
      dest: { x: area.x + 548, y: area.y + 90, w: 230, h: 300 },
      parts: GATE_PARTS.map((p, i) => ({ part: p, x: area.x + 808, y: area.y + 84 + i * 72, w: 424, h: 64 })),
      note: { x: area.x + 808, y: area.y + 452, w: 424, h: 36 },
    };
  }

  function _drawGate(ctx, px, py, pw, ph) {
    const G = gateRects(), A = G.area, t = _blink;
    const { cx, cy, r: RR, seg: SEG } = G.ring;
    const T = (s, x, y, col, size, al = 'left', bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Share Tech Mono, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
    ctx.fillStyle = 'rgba(4,4,12,0.72)'; ctx.fillRect(A.x, A.y, A.w, A.h);
    ctx.strokeStyle = '#2a1a40'; ctx.lineWidth = 1; ctx.strokeRect(A.x + 0.5, A.y + 0.5, A.w - 1, A.h - 1);
    ctx.textAlign = 'left'; ctx.fillStyle = '#c06bff'; ctx.font = '18px Orbitron, monospace';
    ctx.fillText('MOON GATE', A.x + 24, A.y + 34);
    T('A ring wide enough to throw a hull at another moon. Every part you bring home wakes a little more of it.', A.x + 24, A.y + 54, '#9a88b8', 11);

    /* The lit share is the FRACTION of the whole job on the shelf — the same numbers as
       the sockets on the right, drawn round. It moves as you play. */
    const done = GATE_PARTS.reduce((a, p) => a + Math.min(1, _gateHave(p) / p.need), 0) / GATE_PARTS.length;
    const lit = Math.round(done * SEG);

    // inside: the stars through it, swirling; arcs of energy turning
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, RR - 16, 0, Math.PI * 2); ctx.clip();
    const g = ctx.createRadialGradient ? ctx.createRadialGradient(cx, cy, 10, cx, cy, RR) : null;
    if (g) { g.addColorStop(0, `rgba(120,60,200,${(0.18 + 0.3 * done).toFixed(2)})`); g.addColorStop(0.6, 'rgba(40,10,80,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
    ctx.fillStyle = g || 'rgba(40,10,80,0.3)'; ctx.fillRect(cx - RR, cy - RR, RR * 2, RR * 2);
    for (let i = 0; i < 160; i++) {
      const a = i * 2.399 + t * (0.15 + (i % 7) * 0.02), d = ((i * 37) % 170) + 6;
      ctx.fillStyle = i % 9 === 0 ? '#ffffff' : i % 3 ? '#a080ff' : '#5a40a0';
      ctx.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.96), 2, 2);
    }
    for (let k = 0; k < 4; k++) {
      ctx.strokeStyle = `rgba(192,107,255,${(0.18 + 0.1 * Math.sin(t * 2 + k)).toFixed(2)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 40 + k * 34, t * (0.6 + k * 0.2) + k, t * (0.6 + k * 0.2) + k + 2.2); ctx.stroke();
    }
    ctx.restore();

    // the ring: its segments, the lit ones glowing, a sign on each
    for (let s = 0; s < SEG; s++) {
      const a0 = s / SEG * Math.PI * 2 - Math.PI / 2, a1 = a0 + Math.PI * 2 / SEG - 0.03, on = s < lit;
      ctx.strokeStyle = on ? '#7a4ab8' : '#2a2438'; ctx.lineWidth = 26;
      ctx.beginPath(); ctx.arc(cx, cy, RR, a0, a1); ctx.stroke();
      ctx.strokeStyle = on ? `rgba(220,170,255,${(0.5 + 0.4 * Math.sin(t * 3 + s)).toFixed(2)})` : '#3a3450'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, RR + 12, a0, a1); ctx.stroke();
      const am = (a0 + a1) / 2;
      // upright, where the segment is — a sign you can read
      ctx.font = '15px "Segoe UI Symbol", "DejaVu Sans", "Noto Sans Symbols", serif'; ctx.textAlign = 'center';
      ctx.fillStyle = on ? `rgba(245,225,255,${(0.75 + 0.25 * Math.sin(t * 2 + s)).toFixed(2)})` : '#5a4c78';
      ctx.fillText(GATE_SIGNS[s], Math.round(cx + Math.cos(am) * RR), Math.round(cy + Math.sin(am) * RR + 5));
    }
    // sparks jumping the gap where the ring is unfinished
    if (lit < SEG) for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + Math.PI * 2 * (lit / SEG) + 0.05, ph = (t * 5 + k * 1.7) % 1;
      if (ph >= 0.4) continue;
      ctx.strokeStyle = 'rgba(230,200,255,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath();
      let x = cx + Math.cos(a) * (RR - 14), y = cy + Math.sin(a) * (RR - 14); ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += Math.cos(a + 1.6) * 6 + Math.sin(t * 40 + j * 3 + k) * 6; y += Math.sin(a + 1.6) * 6 + Math.cos(t * 37 + j) * 6; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // the cradle under it, the share in the middle
    ctx.fillStyle = '#2a2438'; ctx.fillRect(cx - 120, cy + RR + 16, 240, 12); ctx.fillStyle = '#1a1628'; ctx.fillRect(cx - 140, cy + RR + 28, 280, 6);
    ctx.textAlign = 'center'; ctx.fillStyle = '#e0c8ff'; ctx.font = '22px Orbitron, monospace';
    ctx.fillText(`${Math.round(done * 100)}%`, cx, cy + 8);
    T('ASSEMBLED', cx, cy + 26, '#9a88b8', 9, 'center');

    /* ── WHERE IT LEADS (update58) — read off Save's region table ── */
    {
      const D = G.dest, R = (typeof Save !== 'undefined' && Save.regions) ? Save.regions() : {};
      ctx.textAlign = 'left'; ctx.fillStyle = '#c06bff'; ctx.font = '11px Orbitron, monospace';
      ctx.fillText('DESTINATIONS', D.x, D.y);
      Object.values(R).forEach((reg, i) => {
        const open = (typeof Save !== 'undefined' && Save.regionUnlocked) ? Save.regionUnlocked(reg.key) : !!reg.home;
        const yy = D.y + 22 + i * 20;
        T(open ? '●' : '○', D.x, yy, open ? '#1aff8c' : '#4a4060', 11);
        T(reg.label, D.x + 16, yy, open ? '#e0d0ff' : '#6a5a88', 11, 'left', open);
        T(open ? 'open' : `locked · ${reg.body}`, D.x + 104, yy, open ? '#7ad8a0' : '#4a4060', 9);
      });
    }

    /* ── THE SOCKETS: one per part, filling as the shelf does ── */
    ctx.textAlign = 'left'; ctx.fillStyle = '#c06bff'; ctx.font = '11px Orbitron, monospace';
    ctx.fillText('COMPONENTS — from the warehouse shelf', G.parts[0].x, G.parts[0].y - 12);
    G.parts.forEach((P, i) => {
      const part = P.part, have = _gateHave(part), full = have >= part.need, f = Math.min(1, have / part.need);
      ctx.fillStyle = full ? 'rgba(80,40,120,0.5)' : 'rgba(20,14,32,0.85)'; ctx.fillRect(P.x, P.y, P.w, P.h);
      ctx.strokeStyle = full ? '#c06bff' : '#3a2a58'; ctx.lineWidth = 1; ctx.strokeRect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1);
      ctx.save(); ctx.translate(P.x + 32, P.y + 32);
      ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); } ctx.closePath();
      ctx.fillStyle = '#120c1e'; ctx.fill(); ctx.strokeStyle = full ? '#e0b8ff' : '#5a4680'; ctx.lineWidth = 2; ctx.stroke();
      ctx.clip(); ctx.fillStyle = `rgba(192,107,255,${(0.5 + 0.3 * Math.sin(t * 3 + i)).toFixed(2)})`; ctx.fillRect(-20, 20 - 40 * f, 40, 40 * f);
      ctx.restore();
      T(part.label, P.x + 66, P.y + 22, full ? '#f0d8ff' : '#c8b8e0', 12, 'left', true);
      T(`${have}/${part.need}`, P.x + P.w - 14, P.y + 22, full ? '#1aff8c' : '#9a88b8', 12, 'right', true);
      ctx.fillStyle = '#1a1028'; ctx.fillRect(P.x + 66, P.y + 32, P.w - 82, 6);
      ctx.fillStyle = full ? '#1aff8c' : '#c06bff'; ctx.fillRect(P.x + 66, P.y + 32, Math.round((P.w - 82) * f), 6);
      T(part.from, P.x + 66, P.y + 54, '#6a5a88', 9);
    });

    /* THE ONE LINE THAT MATTERS, and no button under it. */
    const N = G.note;
    ctx.fillStyle = 'rgba(40,20,60,0.8)'; ctx.fillRect(N.x, N.y, N.w, N.h);
    ctx.strokeStyle = '#5a3a80'; ctx.strokeRect(N.x + 0.5, N.y + 0.5, N.w - 1, N.h - 1);
    ctx.textAlign = 'center'; ctx.fillStyle = '#c06bff'; ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('Construction is not available in this version — keep the parts.',
                 N.x + N.w / 2, N.y + 22);
    ctx.textAlign = 'left';
  }

  /** Module level per ROOM for a hangar entry (veteran hulls keep them). */
  function _entryRooms(entry) {
    const L = SHIP_LAYOUTS[entry.key];
    if (!L) return [];
    const rooms = L.rooms.map(r => ({ id: r.id, type: r.type }));
    (entry.data?.extraModules ?? []).forEach(e => {
      const type   = typeof e === 'string' ? e : e.type;
      const roomId = typeof e === 'string' ? null : e.roomId;
      const target = roomId
        ? rooms.find(r => r.id === roomId)
        : rooms.find(r => r.type === 'empty');
      if (target) target.type = type;
    });
    return rooms;
  }

  /**
   * The weapon stat chips, on canvas.
   *
   * The same LABEL · icon · number the station shop draws in the DOM —
   * same list (weaponStatChips), same pictograms (Renderer.drawStatIcon),
   * so a gun reads identically whether you are buying it at a port or
   * looking at it on your own rack. Wraps within `w`; returns the height
   * used so callers can lay out underneath it.
   */
  // ── Tab: ARMOURY ────────────────────────────────────────
  //  Left: the mounts on the selected hull. Right: the rack.

  // ── Tab: HANGAR ─────────────────────────────────────────

  // The selected hull is BUILT, not sketched: a real Ship object with
  // the crew you picked standing in it, drawn at full size. Rebuilt only
  // when the selection actually changes.
  let _preview = null, _previewKey = '';
  const _previews = new Map();       // update138: one picture per place it is shown


  function _layoutBounds(key) {
    const L = SHIP_LAYOUTS[key];
    if (!L) return { x: 0, y: 0, w: 300, h: 200 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    L.rooms.forEach(r => {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }


  function _previewShip(cx, cy) {
    const b = Base.get();
    const entry = b.ships[_shipIdx];
    if (!entry) { _preview = null; _previewKey = ''; return null; }

    /* ── THE CACHE HAS TO KNOW THE HULL, NOT JUST THE BERTH (update68)
     *
     * THIS WAS THE GHOST FROM update58. The player reported that a
     * module bought in flight was not on his ship when he docked — and
     * that it appeared after the NEXT run. It was hunted through five
     * packages and never reproduced, because every hunt started with a
     * COLD cache: build the ship, draw it once, and of course the
     * module is there.
     *
     * The bug needs a WARM one. This key was berth index, hull key,
     * chosen crew and position — everything except WHAT THE HULL IS.
     * So: draw the hangar before launching, fly, buy a medbay, come
     * home to the same berth with the same crew, and the key is
     * character-for-character the one already in `_preview`. The
     * screen hands back the ship as it was BEFORE the run. It fixes
     * itself next time because by then the crew or the berth has
     * changed and the key finally differs.
     *
     * `_entryShipCache` above got this right — it is keyed on the
     * serialised data. Two caches for one thing, one of them
     * content-addressed and one not: the oldest disease in this
     * project, and it cost five packages of hunting.
     */
    const sig = entry.data ? JSON.stringify(entry.data) : 'fresh';
    const key = `${_shipIdx}|${entry.key}|${sig}|${[..._picked].sort().join(',')}|${JSON.stringify(_posts)}|${cx}|${cy}`;
    if (_previewKey === key && _preview) return _preview;
    /* ONE PICTURE PER PLACE (update138). The hangar and the loadout show
       the same ship at two different centres, and the key has the centre
       in it — so with both on screen the one cached picture was thrown
       away and rebuilt TWICE A FRAME, every gun arming each time: the
       charge chirp a hundred times a second. Each place keeps its own. */
    const kept = _previews.get(`${cx}|${cy}`);
    if (kept && kept.key === key) { _preview = kept.ship; _previewKey = key; return _preview; }

    try {
      const bnd = _layoutBounds(entry.key);
      const wx = Math.round(cx - bnd.w / 2 - bnd.x);
      const wy = Math.round(cy - bnd.h / 2 - bnd.y);
      const sh = entry.data
        ? Ship.deserialise(entry.data, true, wx, wy)
        : new Ship(entry.key, true, wx, wy);
      sh._allocateDefaultPower?.();
      sh.isPreview = true;                  // a picture: no clocks, no notices (update89)

      const picked = Base.crew().filter(c => _picked.has(c.id));
      picked.forEach(cd => { try { sh.addCrew(CrewMember.deserialise(cd)); } catch (e) {} });
      sh.assignStations?.();
      sh.applyPosts?.(_posts);          // the posts chosen in the loadout (update113)
      // Let them walk to their posts so the picture is the ship you are
      // actually launching, not everybody stacked in the airlock.
      // Nothing a picture does is news: its notices go nowhere.
      const realNotify = UI.notify;
      UI.notify = () => {};
      /* …UNTIL THEY GET THERE (update127b, jj: "przy załadowaniu załogantów
         przed startem, dwuklik — raz są normalnie, raz przeskakują do
         windy"). It was three seconds flat, and a man posted a deck away
         was still in the lift when the picture was taken. Now it runs
         until nobody is walking or riding, capped at 40 s of ship time. */
      const settled = () => sh.crew.every(c => !c || c.isPet || c.dead ||
        (!c._waypoints?.length && !c._ridingShaft && c.task !== TASK.MOVE));
      try {
        // a picture is not heard (update138): see Audio.hush
        const run = () => {
          for (let i = 0; i < 400; i++) {
            sh.update(0.1);
            if (i >= 10 && settled()) break;
          }
        };
        if (Audio.hush) Audio.hush(run); else run();
      }
      finally { UI.notify = realNotify; }

      _preview = sh; _previewKey = key;
      if (_previews.size > 6) _previews.clear();
      _previews.set(`${cx}|${cy}`, { key, ship: sh });
    } catch (e) {
      console.warn('[BaseScreen] preview failed:', e);
      _preview = null; _previewKey = key;
    }
    return _preview;
  }

  /** Shorten a string with an ellipsis so it fits `maxW` pixels. */

  /**
   * Materialise a hangar entry into a REAL Ship, cached.
   *
   * The old version read levels out of the raw save by walking rooms and
   * indexing the systems array in parallel — the two orders do not match
   * on hulls with several rooms of one type, so three weapon bays all
   * showed the LAYOUT's weapons level. Building the ship is the only way
   * to be sure the readout matches what you will actually fly.
   */
  const _entryShipCache = new Map();
  function _entryShip(entry) {
    if (!entry) return null;
    const sig = entry.key + '|' + (entry.data ? JSON.stringify(entry.data) : 'fresh');
    if (_entryShipCache.has(sig)) return _entryShipCache.get(sig);
    let sh = null;
    try {
      sh = entry.data ? Ship.deserialise(entry.data, true, 0, 0)
                      : new Ship(entry.key, true, 0, 0);
    } catch (e) { sh = null; }
    if (_entryShipCache.size > 12) _entryShipCache.clear();
    _entryShipCache.set(sig, sh);
    return sh;
  }

  function _entryLevels(entry) {
    const sh = _entryShip(entry);
    if (!sh) return [];
    return sh.systems.map(sy => ({
      id: sy.roomId, type: sy.type, level: sy.level,
      maxLevel: (SYSTEM_DEFS[sy.type]?.maxLevel ?? 8),
      damaged: sy.damagedLevels,
    }));
  }

  /** Total reactor output of a hangar entry. */
  function _entryReactor(entry) {
    const sh = _entryShip(entry);
    return sh?.reactor?.level ?? 0;
  }

  /** Shorten a string with an ellipsis so it fits `maxW` pixels. */
  function _clip(ctx, text, maxW) {
    let t = String(text ?? '');
    if (!t) return t;
    if ((ctx.measureText?.(t)?.width ?? 0) <= maxW) return t;
    while (t.length > 1 && (ctx.measureText?.(t + '…')?.width ?? 0) > maxW) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }


  const MOD_LABEL = {
    engines: 'Engines', weapons: 'Weapons', shields: 'Shields',
    piloting: 'Cockpit', oxygen: 'Life sup.', medbay: 'Medbay',
    reactor: 'Reactor', cloaking: 'Cloak', autorepair: 'Autorepair',
    artillery: 'Artillery',
  };

  /* ── THE HANGAR (update154, jj: "wygląda ciekawie" — the mockup of 21.10) ──
   *
   *   CRADLE  (left, top)  the hull in her bay at 1:1, the jet bridge to her
   *                        door, every module tagged with its name and level
   *   CARD    (right)      your hull: weld, the hull in numbers, her modules
   *                        with the game's own icons, where the rest of her is
   *                        looked after, SELL — or a hull for sale: compared
   *                        with yours, what she comes with, BUY
   *   STRIP   (left, foot) BERTHS: every berth, an empty cradle, and the next
   *                        one behind a lock (bought here, with a question);
   *                        SHIPYARD: the hulls you do not have, at their price
   *
   * A hull for sale is LOOKED AT in the cradle (`_yardPick`) — it is not yours
   * until BUY; ESC or a berth puts your own ship back. One geometry,
   * `hangarRects()`, for the drawing, the clicks and the tests.
   */
  const HANGAR = {
    stage: { x: 16,  y: 62,  w: 868, h: 360 },
    card:  { x: 894, y: 62,  w: 370, h: 530 },
    strip: { x: 16,  y: 432, w: 868, h: 160 },
    BAND: 34,                 // the stage's title band — the INTERIOR switch lives in it
    TILE_W: 104, TILE_H: 124, GAP: 8, ARROW: 16,
  };
  let _yardPick = null;       // the key of a hull for sale being looked at

  /** Every rectangle of the hangar: the drawing, the clicks and the tests read it. */
  function hangarRects() {
    const b = Base.get(), S = HANGAR.strip, T = HANGAR.TILE_W, G = HANGAR.GAP;
    const slots = Base.shipSlots(), berthsAll = slots + 1;           // + the locked one
    const sale = (Base.catalog?.() ?? []).filter(d => !b.ships.some(s => s.key === d.key));
    const inner = S.w - 20 - 24;                                     // margins and the divider
    const perArrow = HANGAR.ARROW + 4;
    let bVis = Math.min(berthsAll, 4), yVis = Math.max(1, Math.floor((inner - bVis * (T + G) - 2 * perArrow) / (T + G)));
    yVis = Math.min(yVis, Math.max(1, sale.length));
    const berthX = S.x + 10, divX = berthX + bVis * (T + G) + (berthsAll > bVis ? perArrow : 0) + 4;
    const yardX = divX + 12;
    const tileY = S.y + 28;
    const berthTiles = [];
    for (let vi = 0; vi < bVis; vi++) {
      const i = _berthScroll + vi;
      if (i >= berthsAll) break;
      berthTiles.push({ x: berthX + vi * (T + G), y: tileY, w: T, h: HANGAR.TILE_H, i,
        kind: i < b.ships.length ? 'ship' : i < slots ? 'empty' : 'lock' });
    }
    const yardTiles = sale.slice(_yardScroll, _yardScroll + yVis).map((d, vi) => ({
      x: yardX + vi * (T + G), y: tileY, w: T, h: HANGAR.TILE_H, key: d.key, def: d }));
    const arrows = [];
    if (berthsAll > bVis) arrows.push({ x: berthX + bVis * (T + G), y: tileY + 34, w: HANGAR.ARROW, h: 56, act: 'scrollBerth', arg: _berthScroll + bVis >= berthsAll ? -1 : 1 });
    if (sale.length > yVis) arrows.push({ x: S.x + S.w - 10 - HANGAR.ARROW, y: tileY + 34, w: HANGAR.ARROW, h: 56, act: 'scrollYard', arg: _yardScroll + yVis >= sale.length ? -1 : 1 });
    const C = HANGAR.card, St = HANGAR.stage;
    return {
      stage: { ...St }, card: { ...C }, strip: { ...S }, band: { x: St.x, y: St.y, w: St.w, h: HANGAR.BAND },
      interior: { x: St.x + St.w - 130, y: St.y + 7, w: 118, h: 21 },
      dock: { x: St.x + 1, y: St.y + 1, w: St.w - 2, h: St.h - 2 },
      berthTiles, yardTiles, arrows, divX, yardX, sale, berthVis: bVis, yardVis: yVis, berthsAll,
      weld:  { x: C.x + 18, y: C.y + 106, w: C.w - 36, h: 30 },
      links: [['GUNS', 'ARMOURY', 2], ['CREW', 'CREW', 3], ['HOLD', 'SUPPLY', 5]].map(([what, tab, n], i) => ({
        x: C.x + 18 + i * Math.floor((C.w - 36) / 3), y: C.y + C.h - 86, w: Math.floor((C.w - 36) / 3) - 6, h: 32, what, tab, n })),
      sell:  { x: C.x + 18, y: C.y + C.h - 46, w: C.w - 36, h: 30 },
      buy:   { x: C.x + 18, y: C.y + C.h - 80, w: C.w - 36, h: 50 },
    };
  }

  /** A hull for sale, built for looking at — cached by where she stands. */
  const _yardShips = new Map();
  function _yardShip(key, cx, cy) {
    const id = `${key}|${cx}|${cy}`;
    if (_yardShips.has(id)) return _yardShips.get(id);
    let sh = null;
    try {
      const bnd = _layoutBounds(key);
      sh = new Ship(key, true, Math.round(cx - bnd.w / 2 - bnd.x), Math.round(cy - bnd.h / 2 - bnd.y));
      sh._allocateDefaultPower?.();
      sh.isPreview = true;
    } catch (e) { sh = null; }
    if (_yardShips.size > 8) _yardShips.clear();
    _yardShips.set(id, sh);
    return sh;
  }

  /** The hull in numbers — the same rows for yours and for one for sale. */
  function hullFacts(sh, key) {
    const L = SHIP_LAYOUTS[key];
    return {
      hull: sh.hullMax, reactor: sh.reactor?.level ?? 0, decks: L?.floors ?? 1, bays: sh.rooms.length,
      empty: sh.rooms.filter(r => r.type === 'empty').length, mounts: sh.weaponRooms?.length ?? 0,
      hold: sh.cargo ? sh.cargo.cols * sh.cargo.rows : 0, holdTxt: sh.cargo ? `${sh.cargo.cols}×${sh.cargo.rows}` : '—',
    };
  }
  const HULL_ROWS = [['HULL', 'hull'], ['REACTOR', 'reactor'], ['DECKS', 'decks'], ['BAYS', 'bays'],
                     ['EMPTY BAYS', 'empty'], ['GUN MOUNTS', 'mounts'], ['HOLD', 'hold', 'holdTxt']];
  const MOD_COL = { engines: '#1aff8c', weapons: '#ff7c20', shields: '#4db8ff', piloting: '#ffd700', oxygen: '#8fd4ff',
                    medbay: '#ff6f9c', reactor: '#ffb020', cloaking: '#cc44ff', autorepair: '#7dff9a', carbonite: '#9fe4ff',
                    artillery: '#ff5566' };
  const MOD_NAME = { engines: 'ENGINES', weapons: 'WEAPONS', shields: 'SHIELDS', piloting: 'COCKPIT', oxygen: 'O₂',
                     medbay: 'MEDBAY', reactor: 'REACTOR', cloaking: 'CLOAK', autorepair: 'REPAIR', carbonite: 'CARBONITE',
                     artillery: 'ARTILLERY' };
  /** Her modules as the game shows them: its icon, its name, its level. */
  function hullModules(sh) {
    return sh.rooms.filter(r => r.type !== 'empty').map(r => ({
      id: r.id, type: r.type,
      level: r.type === 'reactor' ? (sh.reactor?.level ?? 0) : (r.system?.level ?? 0),
      max: r.type === 'reactor' ? (sh.reactor?.maxLevel ?? 1) : (r.system?.maxLevel ?? SYSTEM_DEFS[r.type]?.maxLevel ?? 1),
    }));
  }

  function _drawHangar(ctx, px, py, pw, ph, b) {
    _clampScroll();
    const R = hangarRects();
    const T = (s, x, y, col, size, al = 'left', bold = false) => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px Share Tech Mono, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
    const box = (r, fill, line, lw = 1) => { ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h);
      if (line) { ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); } };
    if (_yardPick && !R.sale.some(d => d.key === _yardPick)) _yardPick = null;   // bought, or never for sale

    // ── THE CRADLE ──
    const S = R.stage, entry = b.ships[_shipIdx];
    const key = _yardPick ?? entry?.key ?? null;
    const cx0 = S.x + S.w / 2;
    const cy = S.y + HANGAR.BAND + 46 + (S.h - HANGAR.BAND - 46) / 2 - 6;     // the guns stand ~46 px over her
    const shipCx = key && typeof DockArt !== 'undefined' ? cx0 + DockArt.shiftFor(key, R.dock, cx0) : cx0;
    const sh = !key ? null : _yardPick ? _yardShip(_yardPick, shipCx, cy) : _previewShip(shipCx, cy);
    ctx.save();
    ctx.beginPath(); ctx.rect(S.x, S.y, S.w, S.h); ctx.clip();
    if (typeof DockArt !== 'undefined') DockArt.draw(ctx, R.dock, sh);
    _hangarStage = { x: S.x, y: S.y + HANGAR.BAND, w: S.w, h: S.h - HANGAR.BAND };
    if (sh) {
      const onStage = Utils.pointInRect(Input.mouse.x, Input.mouse.y, _hangarStage.x, _hangarStage.y, _hangarStage.w, _hangarStage.h);
      sh.roofAlpha = _roofEase(_yardPick ? 'hangar:yard' : 'hangar', (onStage || _interior) ? 0 : 1);
      try { sh.draw(ctx); } catch (e) { /* a preview must never kill the screen */ }
      /* the jet bridge's bellows over her airlock (update153) */
      if (typeof DockArt !== 'undefined') DockArt.drawOver?.(ctx, R.dock, sh);
      // every module tagged, the way THE PLANS does it
      if (sh.roofAlpha < 0.5) sh.rooms.forEach(room => {
        if (room.type === 'empty') {
          ctx.setLineDash([4, 4]); ctx.strokeStyle = '#7a90a8'; ctx.lineWidth = 1;
          ctx.strokeRect(room.x + 2.5, room.y + 2.5, room.w - 5, room.h - 5); ctx.setLineDash([]);
          T('EMPTY BAY', room.x + room.w / 2, room.y + room.h / 2 + 4, '#7a90a8', 9, 'center', true);
          return;
        }
        const col = MOD_COL[room.type] ?? '#4db8ff', th = 16;
        const lv = room.type === 'reactor' ? sh.reactor?.level : room.system?.level;
        ctx.fillStyle = 'rgba(4,6,12,0.82)'; ctx.fillRect(room.x + 3, room.y + room.h - th - 3, room.w - 6, th);
        ctx.fillStyle = col; ctx.fillRect(room.x + 3, room.y + room.h - th - 3, 2, th);
        T(`${MOD_NAME[room.type] ?? room.type.toUpperCase()}${lv ? ' ' + lv : ''}`, room.x + 8, room.y + room.h - 8, col, 9, 'left', true);
      });
    } else {
      T('No hull in the hangar — buy one from the SHIPYARD below.', cx0, S.y + S.h / 2, '#ff5566', 13, 'center');
    }
    // the title band: her name, her yard; the INTERIOR switch at its end, clear of the picture
    box(R.band, 'rgba(5,8,14,0.86)', null);
    ctx.fillStyle = '#1e2d4a'; ctx.fillRect(R.band.x, R.band.y + R.band.h - 1, R.band.w, 1);
    if (key) {
      const def = SHIP_CATALOG[key] || { label: key };
      ctx.font = '15px Orbitron, monospace'; ctx.fillStyle = _yardPick ? '#ffd700' : '#c8e8ff'; ctx.textAlign = 'left';
      ctx.fillText(def.label.toUpperCase(), S.x + 14, S.y + 23);
      const nameW = ctx.measureText(def.label.toUpperCase()).width;
      const yard = typeof hullBuilder === 'function' ? hullBuilder(key) : null;
      if (yard) T(BUILDER_TRAITS[yard]?.blurb ?? '', S.x + 30 + nameW, S.y + 22, CORP_DEFS[yard]?.color ?? '#7a90a8', 10);
      if (!_yardPick && entry) {
        const crew = sh?.crew?.length ?? 0;
        T(crew ? `${crew} crew aboard` : 'no crew picked — green hands sign on', R.interior.x - 14, S.y + 22, crew ? '#1aff8c' : '#ffb020', 10, 'right');
      }
    }
    _btn(ctx, R.interior.x, R.interior.y, R.interior.w, R.interior.h, _interior ? 'EXTERIOR  [I]' : 'INTERIOR  [I]',
         { act: 'interior', on: _interior, font: '10px Share Tech Mono, monospace' });
    if (_yardPick) {
      // a showroom ticket on the cradle
      const p = 0.5 + 0.5 * Math.sin(_blink * 3), t = { x: S.x + 14, y: S.y + HANGAR.BAND + 10, w: 214, h: 40 };
      box(t, 'rgba(40,30,0,0.9)', '#ffd700', 2);
      for (let i = 0; i < t.w; i += 14) { ctx.fillStyle = (i / 14) % 2 ? '#ffd700' : '#141414'; ctx.fillRect(t.x + i, t.y, Math.min(14, t.w - i), 5); }
      T('FOR SALE — ON VIEW', t.x + t.w / 2, t.y + 24, '#ffd700', 13, 'center', true);
      T('not yours yet · ESC: back to your ship', t.x + t.w / 2, t.y + 35, `rgba(255,215,0,${0.55 + 0.4 * p})`, 9, 'center');
    } else if (entry) {
      const t = { x: S.x + 14, y: S.y + HANGAR.BAND + 10, w: 200, h: 22 };
      box(t, 'rgba(10,30,20,0.88)', '#1aff8c');
      T('● FLIES THE NEXT CONTRACT', t.x + t.w / 2, t.y + 15, '#1aff8c', 10, 'center', true);
    }
    ctx.restore();
    ctx.strokeStyle = _yardPick ? '#ffd70066' : '#1e2d4a'; ctx.lineWidth = 1;
    ctx.strokeRect(S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1);

    // ── THE CARD ──
    if (_yardPick && sh) _drawHangarSale(ctx, R, sh, _yardPick, entry, T, box);
    else if (entry && sh) _drawHangarOwn(ctx, R, sh, entry, T, box);
    else box(R.card, 'rgba(8,12,22,0.92)', '#1e2d4a');

    // ── THE STRIP: BERTHS | SHIPYARD ──
    _drawHangarStrip(ctx, R, b, T, box);
  }

  /** The card for a hull of yours. */
  function _drawHangarOwn(ctx, R, sh, entry, T, box) {
    const C = R.card, f = hullFacts(sh, entry.key);
    const yard = typeof hullBuilder === 'function' ? hullBuilder(entry.key) : null, ycol = CORP_DEFS[yard]?.color ?? '#4db8ff';
    box(C, 'rgba(8,12,22,0.93)', ycol + '88'); ctx.fillStyle = ycol; ctx.fillRect(C.x, C.y, 3, C.h);
    ctx.font = '18px Orbitron, monospace'; ctx.fillStyle = '#e8f4ff'; ctx.textAlign = 'left';
    ctx.fillText((SHIP_CATALOG[entry.key]?.label ?? entry.key).toUpperCase(), C.x + 18, C.y + 32);
    T(`BERTH ${_shipIdx + 1}`, C.x + C.w - 18, C.y + 30, '#7a90a8', 11, 'right', true);
    T(entry.data ? 'veteran hull — upgrades kept' : 'factory fresh', C.x + 18, C.y + 50, entry.data ? '#1aff8c' : '#7a90a8', 10);
    // the hull, in plates, and the weld
    const q = Base.hullRepairQuote?.(_shipIdx), hp = q ? q.hull : f.hull, max = q ? q.hullMax : f.hull;
    T('HULL', C.x + 18, C.y + 80, '#7a90a8', 10, 'left', true);
    T(`${hp} / ${max}`, C.x + C.w - 18, C.y + 80, hp < max ? '#ff5566' : '#1aff8c', 12, 'right', true);
    const pw = (C.w - 36 - (max - 1) * 2) / Math.max(1, max);
    for (let i = 0; i < max; i++) { ctx.fillStyle = i < hp ? '#1aff8c' : 'rgba(255,85,102,0.4)'; ctx.fillRect(C.x + 18 + i * (pw + 2), C.y + 88, Math.max(1, pw), 10); }
    if (q) {
      const can = Base.cc() >= q.cost, W = R.weld;
      _btn(ctx, W.x, W.y, W.w, W.h, can ? `WELD THE HULL  ▶  ${q.cost} CC` : `WELD — NEED ${q.cost} CC`,
           { act: can ? 'repairHull' : null, enabled: can, col: '#1aff8c', font: '13px Share Tech Mono, monospace' });
    } else T('hull sound — nothing to weld', C.x + 18, C.y + 124, '#4a8060', 10);
    // the hull in numbers
    let y = C.y + 166;
    T('THE HULL', C.x + 18, y - 10, '#4db8ff', 10, 'left', true);
    HULL_ROWS.forEach(([label, k, txt], i) => {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)'; ctx.fillRect(C.x + 18, y, C.w - 36, 20);
      T(label, C.x + 28, y + 14, '#9fb4d0', 10, 'left', true);
      T(String(txt ? f[txt] : f[k]), C.x + C.w - 28, y + 14, '#e8f4ff', 12, 'right', true);
      y += 20;
    });
    // her modules, with the icons the ship itself uses
    y += 22;
    T('MODULES', C.x + 18, y, '#4db8ff', 10, 'left', true);
    T('levels go up at a port DRYDOCK', C.x + C.w - 18, y, '#5f7893', 9, 'right');
    _hangarModules(ctx, hullModules(sh), C.x + 18, y + 8, C.w - 36, 2, true, T);
    // where the rest of her is looked after (jj: "dobrze, aby gracz mógł łatwo poruszać się po bazie")
    R.links.forEach(L => _btn(ctx, L.x, L.y, L.w, L.h, `${_building(L.tab)?.name ?? L.tab} [${L.n}] ▶`,
      { act: 'building', arg: L.tab, col: '#4db8ff', font: '10px Share Tech Mono, monospace', sub: L.what }));
    const canSell = Base.get().ships.length > 1, resale = Math.round((SHIP_CATALOG[entry.key]?.cost ?? 0) * (typeof SHIP_RESALE !== 'undefined' ? SHIP_RESALE : 0.3));
    _btn(ctx, R.sell.x, R.sell.y, R.sell.w, R.sell.h, canSell ? `SELL THIS HULL — ${resale} CC` : 'LAST HULL — CANNOT BE SOLD',
         { act: canSell ? 'sellShip' : null, arg: _shipIdx, enabled: canSell, col: '#ffb020', font: '11px Share Tech Mono, monospace' });
  }

  /** Her modules in rows: the ship's own icon, the name, the level in pips. */
  function _hangarModules(ctx, mods, x, y, w, cols, pips, T) {
    const cw = w / cols;
    mods.forEach((m, i) => {
      const col = MOD_COL[m.type] ?? '#4db8ff', mx = x + (i % cols) * cw, my = y + Math.floor(i / cols) * 24;
      try { Renderer.drawSystemIcon(ctx, m.type, mx + 8, my + 11, 14, col); } catch (e) { /* a picture only */ }
      T(MOD_NAME[m.type] ?? m.type.toUpperCase(), mx + 20, my + 10, col, 9, 'left', true);
      if (pips) for (let p = 0; p < m.max; p++) { ctx.fillStyle = p < m.level ? col : 'rgba(255,255,255,0.08)'; ctx.fillRect(mx + 20 + p * 7, my + 14, 5, 4); }
    });
  }

  /** The card for a hull for sale: compared with the one you fly. */
  function _drawHangarSale(ctx, R, sh, key, entry, T, box) {
    const C = R.card, d = SHIP_CATALOG[key];
    const yard = typeof hullBuilder === 'function' ? hullBuilder(key) : null, ycol = CORP_DEFS[yard]?.color ?? '#ffd700';
    const mine = entry ? _entryShip(entry) : null, A = mine ? hullFacts(mine, entry.key) : null, B = hullFacts(sh, key);
    box(C, 'rgba(8,12,22,0.93)', '#ffd70088'); ctx.fillStyle = '#ffd700'; ctx.fillRect(C.x, C.y, 3, C.h);
    T('FOR SALE', C.x + 18, C.y + 22, '#ffd700', 10, 'left', true);
    ctx.font = '18px Orbitron, monospace'; ctx.fillStyle = '#e8f4ff'; ctx.textAlign = 'left';
    ctx.fillText(d.label.toUpperCase(), C.x + 18, C.y + 46);
    if (yard) T(`${(CORP_DEFS[yard]?.label ?? yard).toUpperCase()} YARD`, C.x + C.w - 18, C.y + 44, ycol, 10, 'right', true);
    ctx.font = '10px Share Tech Mono, monospace'; ctx.fillStyle = '#c8d8f0';
    _wrap(ctx, d.blurb ?? '', C.x + 18, C.y + 68, C.w - 36, 14, 2);
    if (yard) T(BUILDER_TRAITS[yard]?.blurb ?? '', C.x + 18, C.y + 102, ycol, 10);
    let y = C.y + 132;
    T(entry ? (SHIP_CATALOG[entry.key]?.label ?? 'YOURS').toUpperCase() : '—', C.x + 220, y, '#5f7893', 9, 'center', true);
    T(d.label.toUpperCase(), C.x + 310, y, '#ffd700', 9, 'center', true);
    y += 8;
    HULL_ROWS.forEach(([label, k, txt], i) => {
      const va = A ? A[k] : null, vb = B[k];
      const up = A && vb > va, dn = A && vb < va;
      const col = k === 'empty' ? (vb > 0 ? '#ffd700' : '#9fb4d0') : up ? '#1aff8c' : dn ? '#ff5566' : '#9fb4d0';
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)'; ctx.fillRect(C.x + 18, y, C.w - 36, 22);
      T(label, C.x + 28, y + 15, '#9fb4d0', 10, 'left', true);
      T(A ? String(txt ? A[txt] : va) : '—', C.x + 220, y + 15, '#c8d8f0', 12, 'center', true);
      T('→', C.x + 265, y + 15, col, 12, 'center', true);
      T(String(txt ? B[txt] : vb), C.x + 310, y + 15, col, 12, 'center', true);
      if (k !== 'empty' && (up || dn)) T(up ? '▲' : '▼', C.x + C.w - 24, y + 15, col, 9, 'right');
      y += 22;
    });
    y += 18;
    T('COMES WITH', C.x + 18, y, '#4db8ff', 10, 'left', true);
    _hangarModules(ctx, hullModules(sh), C.x + 18, y + 6, C.w - 36, 3, false, T);
    const free = Base.get().ships.length < Base.shipSlots(), cc = Base.cc(), can = free && cc >= d.cost;
    _btn(ctx, R.buy.x, R.buy.y, R.buy.w, R.buy.h, !free ? 'NO FREE BERTH' : can ? `BUY  ▶  ${d.cost} CC` : `NEED ${d.cost - cc} MORE CC`,
         { act: can ? 'buyShip' : null, arg: key, enabled: can, col: '#1aff8c', font: '16px Share Tech Mono, monospace',
           sub: !free ? 'a berth first — the lock in BERTHS below' : can ? `${cc} CC → ${cc - d.cost} CC · into berth ${Base.get().ships.length + 1}` : `${d.cost} CC` });
    T('ESC — back to your own ship', C.x + C.w / 2, C.y + C.h - 12, '#5f7893', 9, 'center');
  }

  /** BERTHS and the SHIPYARD, along the foot. */
  function _drawHangarStrip(ctx, R, b, T, box) {
    const S = R.strip, slots = Base.shipSlots(), cc = Base.cc();
    box(S, 'rgba(8,12,22,0.9)', '#1e2d4a');
    ctx.font = '11px Orbitron, monospace'; ctx.fillStyle = '#4db8ff'; ctx.textAlign = 'left';
    ctx.fillText(`BERTHS  ${b.ships.length}/${slots}`, S.x + 12, S.y + 19);
    const hot = r => Utils.pointInRect(Input.mouse.x, Input.mouse.y, r.x, r.y, r.w, r.h);
    const tileBox = (r, sel, line) => box(r, sel ? 'rgba(255,215,0,0.10)' : hot(r) ? 'rgba(20,32,52,0.98)' : 'rgba(14,20,34,0.96)', sel ? '#ffd700' : line, sel ? 2 : 1);
    R.berthTiles.forEach(t => {
      if (t.kind === 'ship') {
        const e = b.ships[t.i], sel = !_yardPick && t.i === _shipIdx;
        tileBox(t, sel, '#2a3a52');
        T(`BERTH ${t.i + 1}${t.i === _shipIdx ? ' · FLIES' : ''}`, t.x + 7, t.y + 14, t.i === _shipIdx ? '#1aff8c' : '#5f7893', 9, 'left', true);
        ctx.fillStyle = '#05070d'; ctx.fillRect(t.x + 5, t.y + 20, t.w - 10, 56);
        // closed in the berth, open under the pointer (update118)
        Renderer.drawShipThumb(ctx, e.key, t.x + 8, t.y + 23, t.w - 16, 50,
                               { rooms: _entryRooms(e), levels: _entryLevels(e), roof: _roofEase(`row:${e.key}:${t.x},${t.y}`, hot(t) ? 0 : 1) });
        T(_clip(ctx, SHIP_CATALOG[e.key]?.label ?? e.key, t.w - 14), t.x + 7, t.y + 92, '#c8e8ff', 12, 'left', true);
        const q = Base.hullRepairQuote?.(t.i), sh = _entryShip(e);
        T(q ? `hull ${q.hull}/${q.hullMax} · weld` : `hull ${sh?.hullMax ?? '?'} · sound`, t.x + 7, t.y + 108, q ? '#ff5566' : '#7a90a8', 9);
        _zones.push({ ...t, act: 'ship', arg: t.i });
      } else if (t.kind === 'empty') {
        tileBox(t, false, '#2a3a52');
        T(`BERTH ${t.i + 1}`, t.x + 7, t.y + 14, '#5f7893', 9, 'left', true);
        ctx.setLineDash([5, 4]); ctx.strokeStyle = '#3d4a63'; ctx.strokeRect(t.x + 10.5, t.y + 24.5, t.w - 21, 50); ctx.setLineDash([]);
        T('EMPTY CRADLE', t.x + t.w / 2, t.y + 53, '#5f7893', 10, 'center', true);
        T('buy a hull →', t.x + t.w / 2, t.y + 100, '#4a6080', 10, 'center');
      } else {
        const cost = Base.upgradeCost('slot'), can = cc >= cost;
        tileBox(t, false, can ? '#ffb02088' : '#1a2233');
        T('NO BERTH YET', t.x + 7, t.y + 14, '#7a6a40', 9, 'left', true);
        ctx.fillStyle = 'rgba(255,176,32,0.08)'; ctx.fillRect(t.x + 10, t.y + 24, t.w - 20, 50);
        // a padlock, drawn
        const lx = t.x + t.w / 2, ly = t.y + 52;
        ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(lx, ly - 6, 6, Math.PI, 0); ctx.stroke();
        ctx.fillStyle = '#ffb020'; ctx.fillRect(lx - 9, ly - 6, 18, 14); ctx.fillStyle = '#3a2a08'; ctx.fillRect(lx - 1, ly - 2, 2, 6);
        T('+1 BERTH', t.x + t.w / 2, t.y + 94, can ? '#ffb020' : '#6a6a7a', 10, 'center', true);
        T(can ? `${cost} CC — click` : `${cost} CC`, t.x + t.w / 2, t.y + 109, can ? '#9a8a50' : '#4a4a5a', 9, 'center');
        if (can) _zones.push({ ...t, act: 'upgradeAsk', arg: 'slot' });
      }
    });
    ctx.fillStyle = '#1e2d4a'; ctx.fillRect(R.divX, S.y + 10, 1, S.h - 20);
    ctx.font = '11px Orbitron, monospace'; ctx.fillStyle = '#1aff8c'; ctx.textAlign = 'left';
    ctx.fillText('SHIPYARD — FOR SALE', R.yardX, S.y + 19);
    T(R.sale.length ? `${R.sale.length} hull${R.sale.length === 1 ? '' : 's'} · click one to look her over` : 'you own every hull the yard builds', S.x + S.w - 12, S.y + 19, '#5f7893', 9, 'right');
    R.yardTiles.forEach(t => {
      const sel = _yardPick === t.key, can = cc >= t.def.cost, yard = typeof hullBuilder === 'function' ? hullBuilder(t.key) : null;
      tileBox(t, sel, '#2a3a52');
      T((CORP_DEFS[yard]?.label ?? '').toUpperCase(), t.x + 7, t.y + 14, CORP_DEFS[yard]?.color ?? '#7a90a8', 9, 'left', true);
      ctx.fillStyle = '#05070d'; ctx.fillRect(t.x + 5, t.y + 20, t.w - 10, 56);
      Renderer.drawShipThumb(ctx, t.key, t.x + 8, t.y + 23, t.w - 16, 50, { roof: _roofEase(`row:${t.key}:${t.x},${t.y}`, hot(t) ? 0 : 1) });
      T(_clip(ctx, t.def.label, t.w - 14), t.x + 7, t.y + 92, '#c8e8ff', 12, 'left', true);
      const br = { x: t.x + 5, y: t.y + t.h - 26, w: t.w - 10, h: 21 };
      box(br, can ? 'rgba(26,255,140,0.08)' : 'rgba(10,10,16,0.8)', can ? '#1aff8c' : '#3a3a4a');
      T(can ? `${t.def.cost} CC` : `${t.def.cost} CC — short`, br.x + br.w / 2, br.y + 14, can ? '#1aff8c' : '#6a6a7a', 10, 'center', true);
      _zones.push({ ...t, act: 'yardView', arg: t.key });
    });
    R.arrows.forEach(a => {
      box(a, hot(a) ? 'rgba(30,50,80,0.95)' : 'rgba(20,30,50,0.9)', '#2a4a6a');
      T(a.arg > 0 ? '▶' : '◀', a.x + a.w / 2, a.y + a.h / 2 + 4, '#4db8ff', 11, 'center');
      _zones.push({ ...a });
    });
  }

  // ── Tab: ARMOURY ────────────────────────────────────────
  //  Left: the mounts on the selected hull. Right: the rack.
  /* ── THE ARMOURY: EVERY GUN IN ITS OWN CRATE (update157) ─────────────
   *
   * jj (21.10): "armory podobny schemat — skrzynie, a w skrzyniach broń".
   * Three shelves of crates, five to a shelf; each spare gun in an open crate,
   * its stencil on the side (name, damage, power, charge). Click a crate: the
   * gun on the right — the one weapon card, FIT TO MOUNT, SELL. Double-click a
   * crate: onto the first free mount. Under the gun, the selected hull's
   * mounts, each with the gun it carries and UNFIT. `armouryRects()` is the one
   * geometry. The shelf scrolls a shelf at a time (`_crateRow`).
   */
  const CRATE = { W: 156, H: 150, GAP: 12, PER: 5, ROWS: 3, PITCH: 160 };
  let _crateSel = 0, _crateRow = 0, _crateClick = { i: -1, t: -9 };

  function armouryRects() {
    const rack = Base.armoury?.() ?? [];
    const area = { x: 16, y: 62, w: 870, h: 530 }, card = { x: 894, y: 62, w: 370, h: 530 };
    const rows = Math.max(1, Math.ceil((rack.length + 1) / CRATE.PER));          // + the empty crate waiting
    _crateRow = Utils.clamp(_crateRow, 0, Math.max(0, rows - CRATE.ROWS));
    const crates = [];
    for (let v = 0; v < CRATE.PER * CRATE.ROWS; v++) {
      const i = _crateRow * CRATE.PER + v;
      if (i > rack.length) break;
      crates.push({ i, x: area.x + 20 + (v % CRATE.PER) * (CRATE.W + CRATE.GAP), y: area.y + 40 + Math.floor(v / CRATE.PER) * CRATE.PITCH,
                    w: CRATE.W, h: CRATE.H - 16, key: rack[i] ?? null });
    }
    const slots = Base.shipSlotCount?.(_shipIdx) ?? 0;
    const mounts = Array.from({ length: slots }, (_, s) => ({ slot: s, x: card.x + 14, y: card.y + 318 + s * 58, w: card.w - 28, h: 52 }));
    return { area, card, crates, rows, visRows: CRATE.ROWS, mounts,
             gun:  { x: card.x + 14, y: card.y + 40, w: card.w - 28, h: 84 },
             fit:  { x: card.x + 14, y: card.y + 134, w: card.w - 28, h: 38 },
             sell: { x: card.x + 14, y: card.y + 180, w: card.w - 28, h: 28 },
             up:   { x: area.x + area.w - 30, y: area.y + 40, w: 18, h: 60 },
             down: { x: area.x + area.w - 30, y: area.y + area.h - 70, w: 18, h: 60 } };
  }

  function _drawArmoury(ctx, px, py, pw, ph, b) {
    const R = armouryRects(), rack = Base.armoury?.() ?? [];
    const T = (s, x, y, col, size, al = 'left', bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Share Tech Mono, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
    const F = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    if (_crateSel >= rack.length) _crateSel = Math.max(0, rack.length - 1);
    const A = R.area;
    ctx.fillStyle = 'rgba(8,12,22,0.55)'; ctx.fillRect(A.x, A.y, A.w, A.h);
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1; ctx.strokeRect(A.x + 0.5, A.y + 0.5, A.w - 1, A.h - 1);
    ctx.font = '12px Orbitron, monospace'; ctx.fillStyle = '#ff5566'; ctx.textAlign = 'left';
    ctx.fillText(`THE RACK  ${rack.length} crate${rack.length === 1 ? '' : 's'}`, A.x + 14, A.y + 22);
    T('click a crate: its gun on the right · double-click: onto the first free mount', A.x + A.w - 40, A.y + 22, '#5f7893', 10, 'right');
    // the shelves
    for (let s = 0; s < CRATE.ROWS; s++) {
      const sy = A.y + 40 + s * CRATE.PITCH + CRATE.H - 8;
      F(A.x + 10, sy, A.w - 50, 8, '#3a4458'); F(A.x + 10, sy, A.w - 50, 2, '#6a7690');
      for (let k = A.x + 30; k < A.x + A.w - 50; k += 170) F(k, sy + 8, 6, 12, '#2a3242');
    }
    R.crates.forEach(c => {
      const { x, y, w } = c, hot = Utils.pointInRect(Input.mouse.x, Input.mouse.y, x, y, w, c.h);
      if (!c.key) {
        ctx.setLineDash([5, 4]); ctx.strokeStyle = '#3a4a63'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 30.5, w - 1, c.h - 31); ctx.setLineDash([]);
        T('guns you bring home', x + w / 2, y + 76, '#4a6080', 10, 'center');
        T('land here', x + w / 2, y + 90, '#4a6080', 10, 'center');
        return;
      }
      const def = getWeaponDef(c.key), sel = c.i === _crateSel;
      // the lid propped open behind, the dark inside, the gun in it, the body with its slats
      F(x + 6, y + 18, w - 12, 26, '#4a3a28'); F(x + 6, y + 18, w - 12, 3, '#6a5238');
      F(x + 4, y + 40, w - 8, 10, '#14100a');
      ctx.save(); ctx.beginPath(); ctx.rect(x + 4, y + 10, w - 8, 40); ctx.clip();
      Renderer.drawWeaponIcon?.(ctx, c.key, x + 14, y + 16, w - 28, 30, {});
      ctx.restore();
      F(x, y + 44, w, c.h - 44, hot ? '#6a5438' : '#5a4630');
      for (let k = 0; k < 4; k++) F(x, y + 54 + k * 20, w, 2, '#3e2e1e');
      F(x, y + 44, 6, c.h - 44, '#3e2e1e'); F(x + w - 6, y + 44, 6, c.h - 44, '#3e2e1e');
      F(x + 10, y + 64, w - 20, 34, 'rgba(10,8,4,0.55)');
      T(_clip(ctx, (def?.label ?? c.key).toUpperCase(), w - 24), x + w / 2, y + 78, '#ffcf8a', 11, 'center', true);
      T(`DMG ${def?.damage ?? '?'} · ⚡${def?.powerCost ?? '?'} · ${def?.chargeTime ?? '?'}s`, x + w / 2, y + 92, '#c8b090', 9, 'center');
      if (sel) { ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(x - 3, y + 6, w + 6, c.h - 4); }
      _zones.push({ x, y, w, h: c.h, act: 'crate', arg: c.i });
    });
    if (R.rows > R.visRows) {
      _btn(ctx, R.up.x, R.up.y, R.up.w, R.up.h, '▲', { act: _crateRow > 0 ? 'scrollCrates' : null, arg: -1, enabled: _crateRow > 0 });
      _btn(ctx, R.down.x, R.down.y, R.down.w, R.down.h, '▼', { act: _crateRow < R.rows - R.visRows ? 'scrollCrates' : null, arg: 1, enabled: _crateRow < R.rows - R.visRows });
      T(`shelf ${_crateRow + 1}-${Math.min(R.rows, _crateRow + R.visRows)} of ${R.rows}`, R.down.x + R.down.w, R.down.y + R.down.h + 14, '#4a6080', 9, 'right');
    }

    // ── THE GUN, AND HER MOUNTS ──
    const C = R.card, key = rack[_crateSel];
    ctx.fillStyle = 'rgba(8,12,22,0.93)'; ctx.fillRect(C.x, C.y, C.w, C.h);
    ctx.strokeStyle = '#ff556688'; ctx.lineWidth = 1; ctx.strokeRect(C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1);
    F(C.x, C.y, 3, C.h, '#ff5566');
    ctx.font = '12px Orbitron, monospace'; ctx.fillStyle = '#ff8a95'; ctx.textAlign = 'left';
    ctx.fillText(key ? 'FROM THE RACK' : 'THE RACK IS EMPTY', C.x + 16, C.y + 26);
    const entry = b.ships[_shipIdx], fitted = entry ? Base.shipWeapons(_shipIdx) : [];
    const free = R.mounts.filter(m => !fitted.some(f => f.slot === m.slot));
    if (key) {
      /* THE ONE WEAPON CARD (update112): icon, name, type and the stat chips */
      Renderer.drawWeaponCard(ctx, key, R.gun.x, R.gun.y, 'M', { w: R.gun.w, h: R.gun.h, corner: 'ON THE RACK', chipRows: 3 });
      const can = !!entry && free.length > 0;
      _btn(ctx, R.fit.x, R.fit.y, R.fit.w, R.fit.h, can ? `FIT TO MOUNT ${free[0].slot + 1}  ▶` : !entry ? 'NO HULL IN THE HANGAR' : 'NO FREE MOUNT',
           { act: can ? 'fit' : null, arg: _crateSel, enabled: can, col: '#1aff8c', font: '13px Share Tech Mono, monospace',
             sub: can ? 'or double-click the crate' : 'take a gun off a mount first' });
      _btn(ctx, R.sell.x, R.sell.y, R.sell.w, R.sell.h, `SELL — ${Base.weaponValue(key)} CC`,
           { act: 'sellGun', arg: _crateSel, col: '#ffb020', font: '11px Share Tech Mono, monospace' });
    } else {
      ctx.fillStyle = '#7a90a8'; ctx.font = '11px Share Tech Mono, monospace';
      _wrap(ctx, 'Guns you bring home in the hold end up here, each in its own crate.', C.x + 16, C.y + 52, C.w - 32, 14, 3);
    }
    ctx.font = '11px Orbitron, monospace'; ctx.fillStyle = '#ff8a95'; ctx.textAlign = 'left';
    ctx.fillText(`MOUNTS — ${entry ? (SHIP_CATALOG[entry.key]?.label ?? entry.key).toUpperCase() : 'NO HULL'}`, C.x + 16, C.y + 306);
    if (entry && !R.mounts.length) T('This hull has no weapon bay. Buy one at a station.', C.x + 16, C.y + 330, '#ff5566', 11);
    R.mounts.forEach(m => {
      const f = fitted.find(g => g.slot === m.slot);
      if (f) {
        ctx.fillStyle = 'rgba(20,14,18,0.92)'; ctx.fillRect(m.x, m.y, m.w, m.h);
        ctx.strokeStyle = '#ff5566aa'; ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1);
        Renderer.drawWeaponIcon?.(ctx, f.defKey, m.x + 10, m.y + 12, 88, 28, {});
        T(`${m.slot + 1} · ${_clip(ctx, getWeaponDef(f.defKey)?.label ?? f.defKey, 130)}`, m.x + 108, m.y + 22, '#e2ecf8', 11, 'left', true);
        T('into a crate on the rack', m.x + 108, m.y + 38, '#7a90a8', 9);
        _btn(ctx, m.x + m.w - 76, m.y + 12, 66, 28, 'UNFIT', { act: 'unfit', arg: m.slot, col: '#ff7c20', font: '10px Share Tech Mono, monospace' });
      } else {
        ctx.setLineDash([5, 4]); ctx.strokeStyle = '#3a3346'; ctx.lineWidth = 1; ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1); ctx.setLineDash([]);
        T(`MOUNT ${m.slot + 1} — empty`, m.x + 12, m.y + 30, '#5a6478', 11, 'left', true);
      }
    });
  }

  // ── Tab: CREW ───────────────────────────────────────────

  /** "Sergeant · 6" — what a barracks card says about a man's standing. */
  function _rankLine(c) {
    if (typeof rankLevelOf === 'undefined') return '';
    const lvl = rankLevelOf(c);
    return `${rankName(lvl)} · ${lvl}`;
  }

  /** Barracks crew keep the plague between contracts — it has to be
   *  visible BEFORE you pick them, not after they are aboard. */
  function _crewPlague(c) {
    /* THE SAME TWO COLOURS THE SHIP USES (update69). This screen had
       its own pair written out by hand, so a man carrying the spider
       virus was GREEN in the barracks and RED aboard — the one place
       you choose whether to take him showed him as the harmless
       illness. `Renderer.DISEASE_COL` is the register; nothing else
       decides what a sickness looks like. */
    const COL = (typeof Renderer !== 'undefined' && Renderer.DISEASE_COL) || {};
    if (c?.virus)    return { glyph: '☣', col: COL.virus  ?? '#d9463c', tip: 'VIRUS' };
    if (c?.infected) return { glyph: '☣', col: COL.plague ?? '#3fd96b', tip: 'INFECTED' };
    return null;
  }

  /**
   * Barracks crew keep their WOUNDS between contracts too, and until
   * update39 the base was the one place you could not see them: you
   * picked a veteran, launched, and found out in the first boarding
   * action that he was on 20 hp. The record is a plain save object, so
   * read the numbers defensively — older saves have no hp at all.
   */
  function _crewHp(c) {
    const max = Math.max(1, Math.round(c?.maxHp ?? 100));
    const hp  = Math.max(0, Math.round(c?.hp ?? max));
    const pct = Utils.clamp(hp / max, 0, 1);
    return {
      hp, max, pct,
      col: pct > 0.6 ? '#1aff8c' : pct > 0.3 ? '#ffb020' : '#ff2d44',
    };
  }

  /* ── THE BARRACKS: SLEEPING PODS (update155) ─────────────────────────
   *
   * jj (21.10): "łóżka … modułowo, załoganci sobie leżą w nich, ilość łóżek
   * odzwierciedla faktyczną ilość miejsc" → "łóżka pionowe takie, jak mają na
   * stacjach orbitalnych … twarze załogantów bez hełmów". In a sixth of a g and
   * the reactors' pull a man sleeps standing in his bag, like the crew quarters
   * of a station. One pod per bunk (`barracksCap`), two pods to a module; the
   * next two (the sergeant's upgrade) dashed, with their price. A man in his
   * pod: his face bare and asleep, his bag in his house's colour; under it his
   * name, his health, his skills. Click: his file on the right. Double-click:
   * he flies / he stays. `barracksRects()` is the one geometry.
   */
  const POD = { W: 92, H: 168, PLATE: 52, GAP: 8, MGAP: 16, PER_ROW: 4, ROWS: 2 };
  let _bunkSel = null, _bunkClick = { id: null, t: -9 };

  function barracksRects() {
    const b = Base.get(), cap = Base.barracksCap(), crew = b.barracks ?? [];
    const area = { x: 16, y: 62, w: 870, h: 530 }, card = { x: 894, y: 62, w: 370, h: 530 };
    const total = cap + 2;                                       // the pods, and the next two (ghosts)
    const modW = 2 * POD.W + POD.GAP, rowH = POD.H + POD.PLATE + 22;
    const firstMod = _crewScroll * POD.PER_ROW;
    const pods = [];
    for (let i = firstMod * 2; i < Math.min(total, (firstMod + POD.PER_ROW * POD.ROWS) * 2); i++) {
      const m = Math.floor(i / 2) - firstMod, k = i % 2;
      const x = area.x + 20 + (m % POD.PER_ROW) * (modW + POD.MGAP) + k * (POD.W + POD.GAP);
      const y = area.y + 46 + Math.floor(m / POD.PER_ROW) * rowH;
      pods.push({ i, x, y, w: POD.W, h: POD.H + POD.PLATE, module: Math.floor(i / 2),
                  kind: i < crew.length ? 'man' : i < cap ? 'free' : 'ghost', id: crew[i]?.id ?? null });
    }
    const modules = [...new Set(pods.map(p => p.module))].map(mi => {
      const ps = pods.filter(p => p.module === mi);
      return { module: mi, built: ps.some(p => p.kind !== 'ghost'), x: ps[0].x - 6, y: ps[0].y - 6, w: modW + 12, h: POD.H + POD.PLATE + 12 };
    });
    const rows = Math.ceil(Math.ceil(total / 2) / POD.PER_ROW);
    return { area, card, pods, modules, rows, visRows: POD.ROWS, scrollMax: Math.max(0, rows - POD.ROWS),
             take: { x: card.x + 18, y: card.y + 228, w: card.w - 36, h: 40 },
             rename: { x: card.x + 18, y: card.y + 278, w: card.w - 36, h: 28 },
             hire: { x: card.x + 18, y: card.y + card.h - 56, w: card.w - 36, h: 40 } };
  }

  function _drawCrew(ctx, px, py, pw, ph, b) {
    _clampScroll();
    const R = barracksRects(), crew = b.barracks ?? [], cap = Base.barracksCap();
    const T = (s, x, y, col, size, al = 'left', bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Share Tech Mono, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
    const P = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    if (!crew.some(c => c.id === _bunkSel)) _bunkSel = crew[0]?.id ?? null;
    const A = R.area;
    ctx.fillStyle = 'rgba(8,12,22,0.55)'; ctx.fillRect(A.x, A.y, A.w, A.h);
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1; ctx.strokeRect(A.x + 0.5, A.y + 0.5, A.w - 1, A.h - 1);
    ctx.font = '12px Orbitron, monospace'; ctx.fillStyle = '#9fe4ff'; ctx.textAlign = 'left';
    ctx.fillText(`SLEEPING PODS  ${crew.length}/${cap}`, A.x + 14, A.y + 22);
    T('click a pod: his file · double-click: he flies / he stays', A.x + A.w - 14, A.y + 22, '#5f7893', 10, 'right');
    if (!crew.length) T('Nobody in the pods — you will launch with fresh recruits.', A.x + 14, A.y + 40, '#ffd700', 11);
    const t = _blink;
    // the modules' steel surrounds, the next one dashed with its price
    R.modules.forEach(M => {
      if (M.built) {
        ctx.strokeStyle = '#3a4458'; ctx.lineWidth = 2; ctx.strokeRect(M.x + 1, M.y + 1, M.w - 2, M.h - 2);
        T(`MODULE ${M.module + 1}`, M.x + 4, M.y - 4, '#4a5a74', 8, 'left', true);
      }
    });
    const ghosts = R.pods.filter(p => p.kind === 'ghost');
    if (ghosts.length) {
      const g0 = ghosts[0];
      ghosts.forEach(g => { ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ffb02088'; ctx.lineWidth = 1; ctx.strokeRect(g.x + 0.5, g.y + 0.5, g.w - 1, g.h - 1); ctx.setLineDash([]); });
      // one label for the two the next upgrade builds — even when they straddle two modules
      const o = upgradeOffer('barracks');
      T('+2 PODS', g0.x + g0.w / 2, g0.y + 80, '#ffb020', 11, 'center', true);
      T(o ? `${o.cost} CC` : '', g0.x + g0.w / 2, g0.y + 95, '#7a6a40', 9, 'center');
      T('the sergeant', g0.x + g0.w / 2, g0.y + 108, '#7a6a40', 9, 'center');
    }
    R.pods.forEach(p => {
      if (p.kind === 'ghost') return;
      const rec = p.kind === 'man' ? crew[p.i] : null, x = p.x, y = p.y, w = p.w, h = POD.H;
      const sel = rec && rec.id === _bunkSel, hot = Utils.pointInRect(Input.mouse.x, Input.mouse.y, x, y, w, p.h);
      // the niche: back wall, lining, the reading lamp
      P(x, y, w, h, '#141b28'); P(x + 3, y + 3, w - 6, h - 6, hot ? '#222c3e' : '#1d2636');
      P(x + w / 2 - 10, y + 6, 20, 3, rec ? '#ffd890' : '#4a4030');
      if (rec && ctx.createLinearGradient) { const gl = ctx.createLinearGradient(0, y + 8, 0, y + 60); gl.addColorStop(0, 'rgba(255,216,144,0.18)'); gl.addColorStop(1, 'rgba(255,216,144,0)'); ctx.fillStyle = gl; ctx.fillRect(x + 4, y + 8, w - 8, 52); }
      for (let k = y + 20; k < y + h - 10; k += 18) P(x + 4, k, w - 8, 1, '#262f42');
      if (rec) {
        const col = (typeof crewColor === 'function') ? crewColor(rec) : '#4db8ff';
        // the bag, hung on its straps, zipped to the chin
        ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x + 12, y + 54, w - 24, h - 66, 14); ctx.fill();
        P(x + 12, y + 58, 6, h - 74, 'rgba(255,255,255,0.18)'); P(x + w / 2, y + 60, 1, h - 82, 'rgba(0,0,0,0.35)');
        P(x + 10, y + 80, w - 20, 3, '#2a3242'); P(x + 10, y + h - 40, w - 20, 3, '#2a3242');
        // his face — bare, asleep
        const face = (typeof CrewArt !== 'undefined') ? CrewArt.portraitCanvas(rec, { bare: true, asleep: true }) : null;
        if (face) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(face, x + w / 2 - 30, y + 8, 60, 60); ctx.restore(); }
        if (rec.virus) T('☣', x + 8, y + 24, '#7dff4a', 14, 'left', true);
        const zp = (t * 0.6 + String(rec.name).length * 0.37) % 1;
        T('z', x + w - 18 + zp * 8, y + 22 - zp * 14, `rgba(200,220,255,${(0.9 - zp * 0.9).toFixed(2)})`, Math.round(10 + zp * 5), 'left', true);
      } else {
        ctx.fillStyle = '#3a4458'; ctx.beginPath(); ctx.roundRect(x + 16, y + 40, w - 32, h - 56, 12); ctx.fill();
        P(x + w / 2, y + 46, 1, h - 70, '#2a3242');
      }
      // the plate under the pod
      P(x, y + h, w, POD.PLATE, 'rgba(8,12,20,0.9)');
      if (rec) {
        const on = _picked.has(rec.id), hp = _crewHp(rec);
        T(_clip(ctx, rec.name, w - 22), x + 5, y + h + 15, on ? '#1aff8c' : '#e2ecf8', 11, 'left', true);
        if (on) T('✓', x + w - 5, y + h + 15, '#1aff8c', 11, 'right', true);
        P(x + 5, y + h + 21, w - 10, 3, '#1a2030');
        P(x + 5, y + h + 21, (w - 10) * Utils.clamp(hp.pct, 0, 1), 3, hp.pct > 0.6 ? '#1aff8c' : hp.pct > 0.3 ? '#ffb020' : '#ff5566');
        Renderer.drawSkillStrip?.(ctx, rec, x + 5, y + h + 30, w - 10);
        _zones.push({ x, y, w, h: p.h, act: 'bunk', arg: rec.id });
      } else T('free pod', x + 5, y + h + 15, '#5f7893', 10);
      if (sel) { ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(x - 3, y - 3, w + 6, p.h + 6); }
    });
    if (R.scrollMax > 0) _scrollBar(ctx, A.x + A.w - 18, A.y + 40, A.h - 60, _crewScroll, R.visRows, R.rows, 'scrollCrew');

    // ── HIS FILE ──
    const C = R.card, rec = crew.find(c => c.id === _bunkSel);
    ctx.fillStyle = 'rgba(8,12,22,0.93)'; ctx.fillRect(C.x, C.y, C.w, C.h);
    ctx.strokeStyle = '#9fe4ff88'; ctx.lineWidth = 1; ctx.strokeRect(C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1);
    P(C.x, C.y, 3, C.h, '#9fe4ff');
    if (rec) {
      const on = _picked.has(rec.id);
      Renderer.drawCrewCard(ctx, rec, C.x + 14, C.y + 14, 'M', { w: C.w - 28, h: 64, on });
      T('SKILLS', C.x + 18, C.y + 102, '#4db8ff', 10, 'left', true);
      Object.keys(SKILL_DEFS).forEach((k, i) => {
        const lv = rec.skills?.[k]?.level ?? 0, col = SKILL_DEFS[k].color, x = C.x + 18 + (i % 2) * 170, y = C.y + 112 + Math.floor(i / 2) * 22;
        T(SKILL_DEFS[k].label, x, y + 9, lv ? col : '#4a5a74', 10);
        for (let l = 0; l < (typeof MAX_SKILL_LEVEL !== 'undefined' ? MAX_SKILL_LEVEL : 3); l++) P(x + 96 + l * 14, y, 11, 10, l < lv ? col : 'rgba(74,96,128,0.3)');
      });
      _btn(ctx, R.take.x, R.take.y, R.take.w, R.take.h, on ? '✓ FLIES THE NEXT CONTRACT' : 'TAKE HIM ALONG',
           { act: 'crew', arg: rec.id, col: '#1aff8c', on, font: '12px Share Tech Mono, monospace',
             sub: on ? 'click: he stays home' : (_crewHp(rec).pct > 0.3 ? 'onto the deck in the loadout' : 'he is hurt — but he will go') });
      _btn(ctx, R.rename.x, R.rename.y, R.rename.w, R.rename.h, 'RENAME', { act: 'rename', arg: rec.id, col: '#4db8ff', font: '11px Share Tech Mono, monospace' });
    } else T('Nobody to show.', C.x + 18, C.y + 40, '#7a90a8', 11);
    const fee = Base.recruitPrice(), room = crew.length < cap, canHire = room && Base.cc() >= fee;
    _btn(ctx, R.hire.x, R.hire.y, R.hire.w, R.hire.h, `HIRE A RECRUIT — ${fee} CC`,
         { act: canHire ? 'hire' : null, enabled: canHire, col: '#1aff8c', font: '12px Share Tech Mono, monospace',
           sub: !room ? 'no free pod — the sergeant builds more' : 'a green hand for a free pod' });
  }


  // ── Tab: MESS (update43) ────────────────────────────────

  /**
   * THE COMMANDER'S MESS.
   *
   * Left: the berths and who sits in them. Right: everyone in the
   * barracks who has mastered a skill and could take the chair.
   *
   * Promotion is deliberately loud. The man does not come back — he
   * leaves the bunk for good and his mastered skills leave with him —
   * so the card says exactly what the base is losing before the button
   * is pressed. A cost you only discover afterwards is a trap.
   */
  /* ── THE MESS: THE COMMANDERS' OFFICE AND THE PEN (update156) ────────
   *
   * jj (21.10): "kapitan powinien być za biurkiem, nie stać na biurku; biurko
   * bardziej futurystyczne, tak aby wyglądało na office na księżycu — duże okno
   * z tyłu i ruch gwiazd, czasem spadnie kometa, mała przeleci mikro"; the pen:
   * "coś dla kota". One desk for each chair (`messCap`), the commander seated
   * behind it (the desk hides him from the waist down), the window the whole
   * back wall — the stars drift, the ruined Earth hangs there, a comet now and
   * then, a micrometeor in between. Under it the pen: a basket, a bowl and a
   * post for each place (`petCap`), the cat in the basket. The candidates for
   * the chair on the right. `messRects()` is the one geometry.
   */
  function messRects() {
    const cap = Base.messCap?.() ?? 1, pens = Base.petCap?.() ?? 2;
    const office = { x: 16, y: 62, w: 870, h: 320 }, pen = { x: 16, y: 390, w: 870, h: 202 };
    const card = { x: 894, y: 62, w: 370, h: 530 };
    const window_ = { x: office.x + 8, y: office.y + 30, w: office.w - 16, h: 150 };
    const n = cap + 1, DW = Math.min(200, Math.floor((office.w - 30 - (n - 1) * 14) / n));
    const desks = Array.from({ length: n }, (_, i) => ({ i, x: office.x + 16 + i * (DW + 14), y: office.y + 96, w: DW, h: 214, ghost: i >= cap }));
    const m = pens + 1, BW = Math.min(150, Math.floor((pen.w - 250 - (m - 1) * 12) / m));
    const baskets = Array.from({ length: m }, (_, i) => ({ i, x: pen.x + 16 + i * (BW + 12), y: pen.y + 34, w: BW, h: 156, ghost: i >= pens }));
    return { office, pen, card, window: window_, desks, baskets,
             adopt: { x: pen.x + pen.w - 214, y: pen.y + pen.h - 48, w: 200, h: 36 } };
  }

  /** The window onto the sky over the moon: drifting stars, the ruined Earth, a comet now and then. */
  function _messWindow(ctx, W, t) {
    ctx.save(); ctx.beginPath(); ctx.rect(W.x, W.y, W.w, W.h); ctx.clip();
    const sky = ctx.createLinearGradient ? ctx.createLinearGradient(0, W.y, 0, W.y + W.h) : null;
    if (sky) { sky.addColorStop(0, '#02030a'); sky.addColorStop(1, '#0b1028'); }
    ctx.fillStyle = sky || '#05070f'; ctx.fillRect(W.x, W.y, W.w, W.h);
    for (let i = 0; i < 220; i++) {
      const sp = 4 + (i % 3) * 5, x = W.x + ((i * 137.7 - t * sp) % W.w + W.w) % W.w, y = W.y + (i * 59.3) % (W.h - 26);
      ctx.fillStyle = i % 5 === 0 ? '#ffffff' : i % 2 ? '#8a9ac8' : '#46507a';
      ctx.fillRect(Math.round(x), Math.round(y), i % 11 === 0 ? 2 : 1, i % 11 === 0 ? 2 : 1);
    }
    if (typeof TownView !== 'undefined' && TownView.ruinedEarth) {          // the one Earth (update153)
      let sd = 77; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      TownView.ruinedEarth(ctx, W.x + 120, W.y + 50, 30, rnd);
    }
    const cp = (t % 8) / 8;                                                 // a comet every eight seconds
    if (cp < 0.35) {
      const k = cp / 0.35, cx = W.x + W.w * (1.1 - k * 1.3), cy = W.y + 18 + k * 64;
      const tail = ctx.createLinearGradient ? ctx.createLinearGradient(cx, cy, cx + 120, cy - 40) : null;
      if (tail) { tail.addColorStop(0, 'rgba(200,235,255,0.9)'); tail.addColorStop(1, 'rgba(120,180,255,0)'); }
      ctx.strokeStyle = tail || 'rgba(200,235,255,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 120, cy - 40); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }
    const mp = ((t + 3.3) % 3) / 3;                                          // a micrometeor in between
    if (mp < 0.12) {
      const k = mp / 0.12, x = W.x + 300 + k * 160, y = W.y + 10 + k * 60;
      ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 14, y - 5); ctx.stroke();
    }
    ctx.fillStyle = '#4b4d57'; ctx.beginPath(); ctx.moveTo(W.x, W.y + W.h);          // the moon at the foot of the glass
    for (let x = 0; x <= W.w; x += 8) ctx.lineTo(W.x + x, W.y + W.h - 20 + Math.sin(x * 0.02) * 5 + Math.sin(x * 0.07) * 2);
    ctx.lineTo(W.x + W.w, W.y + W.h); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#5a6478'; ctx.lineWidth = 3; ctx.strokeRect(W.x + 1.5, W.y + 1.5, W.w - 3, W.h - 3);
    for (let x = W.x + 170; x < W.x + W.w - 20; x += 170) { ctx.fillStyle = '#3a4252'; ctx.fillRect(x - 3, W.y, 6, W.h); ctx.fillStyle = '#6a7690'; ctx.fillRect(x - 1, W.y, 1, W.h); }
    ctx.fillStyle = '#2a3242'; ctx.fillRect(W.x, W.y + W.h, W.w, 6);
  }

  function _drawMess(ctx, px, py, pw, ph, b) {
    const R = messRects(), t = _blink;
    const cap = Base.messCap?.() ?? 1, crews = Base.commanders?.() ?? [], pets = Base.pets?.() ?? [], pens = Base.petCap?.() ?? 2;
    const T = (s, x, y, col, size, al = 'left', bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Share Tech Mono, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
    const F = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const dashed = (r, col) => { ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); ctx.setLineDash([]); };
    const area = (r) => { ctx.fillStyle = 'rgba(8,12,22,0.6)'; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); };

    // ── THE OFFICE ──
    area(R.office);
    _messWindow(ctx, R.window, t);
    ctx.font = '12px Orbitron, monospace'; ctx.fillStyle = '#ffb050'; ctx.textAlign = 'left';
    ctx.fillText(`THE COMMANDERS' OFFICE  ${crews.length}/${cap}`, R.office.x + 14, R.office.y + 20);
    T('one flies a contract; lost with the ship · click a commander: his file', R.office.x + R.office.w - 14, R.office.y + 20, '#5f7893', 10, 'right');
    R.desks.forEach(D => {
      const { x, y, w } = D, c = crews[D.i];
      if (D.ghost) {
        dashed({ x, y: y + 60, w, h: 140 }, '#ffb02088');
        const o = upgradeOffer('mess');
        T('+1 DESK', x + w / 2, y + 122, '#ffb020', 11, 'center', true);
        T(o ? `${o.cost} CC — the cook` : '', x + w / 2, y + 138, '#7a6a40', 9, 'center');
        return;
      }
      // the chair's high back, then him, seated — the desk will hide his legs
      ctx.fillStyle = '#20283a'; ctx.beginPath(); ctx.roundRect(x + w / 2 - 34, y + 24, 68, 90, 12); ctx.fill();
      F(x + w / 2 - 28, y + 30, 56, 2, '#3a4660');
      if (c && !c.away && typeof CrewArt !== 'undefined') {
        const col = (typeof crewColor === 'function') ? crewColor(c) : '#ffd060';
        const fr = CrewArt.frames(CrewArt.seedOf(c), c.race ?? null, col, 'idle'), img = fr[Math.floor(t * 2) % Math.max(1, fr.length)];
        if (img) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, x + w / 2 - 36, y + 12, img.width * 3, img.height * 3); ctx.restore(); }
      }
      // the holo-screen, floating over the desk
      const hg = ctx.createLinearGradient ? ctx.createLinearGradient(0, y - 4, 0, y + 44) : null;
      if (hg) { hg.addColorStop(0, 'rgba(77,216,255,0.28)'); hg.addColorStop(1, 'rgba(77,216,255,0.06)'); }
      ctx.fillStyle = hg || 'rgba(77,216,255,0.15)';
      ctx.beginPath(); ctx.moveTo(x + 20, y + 2); ctx.lineTo(x + 70, y - 6); ctx.lineTo(x + 70, y + 40); ctx.lineTo(x + 20, y + 46); ctx.fill();
      for (let k = 0; k < 4; k++) F(x + 26, y + 8 + k * 9, 20 + ((k * 13 + D.i * 7) % 20), 2, 'rgba(160,240,255,0.6)');
      // the desk: a white shell, the glow along its lip, a dark slit of a panel, a mug
      ctx.fillStyle = '#d8dee8'; ctx.beginPath(); ctx.moveTo(x, y + 96); ctx.quadraticCurveTo(x + w / 2, y + 80, x + w, y + 96);
      ctx.lineTo(x + w - 14, y + 150); ctx.lineTo(x + 14, y + 150); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(77,216,255,${(0.7 + 0.25 * Math.sin(t * 2 + D.i)).toFixed(2)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y + 96); ctx.quadraticCurveTo(x + w / 2, y + 80, x + w, y + 96); ctx.stroke();
      F(x + 22, y + 150, w - 44, 4, '#8a94a8');
      F(x + w - 52, y + 86, 9, 8, '#e8e8f0');
      if (!c) {
        T('empty chair', x + w / 2, y + 66, '#5f7893', 11, 'center');
        T('promote a veteran →', x + w / 2, y + 172, '#4a6080', 9, 'center');
        return;
      }
      // his plate under the desk: name, rank, the XP to his next level
      T(_clip(ctx, `★ ${c.name}`, w - 8), x + w / 2, y + 170, '#ffe9a8', 12, 'center', true);
      const lvl = c.level ?? 1;
      T(c.away ? 'ON CONTRACT — the chair waits' : `CMDR ${lvl} · ${typeof rankName === 'function' ? rankName(lvl) : ''}`, x + w / 2, y + 184, c.away ? '#ff7c20' : '#9fb4d0', 9, 'center');
      if (typeof Commander !== 'undefined' && Commander.xpToNext) {
        const need = Commander.xpToNext(c) || 1, maxL = Commander.MAX_LEVEL ?? 24;
        const frac = lvl >= maxL ? 1 : Utils.clamp((c.xp || 0) / need, 0, 1);
        F(x + 20, y + 190, w - 40, 3, '#1a1405'); F(x + 20, y + 190, (w - 40) * frac, 3, '#ffd060');
      }
      if (!c.away) {
        const picked = _commanderId === c.id;
        _btn(ctx, x + 24, y + 108, w - 48, 22, picked ? '✓ FLYING' : 'FLY HIM', { act: 'pickCommander', arg: c.id, on: picked, col: '#1aff8c' });
        const owed = (typeof Commander !== 'undefined') ? Commander.pointsOwed(c) : 0;
        _btn(ctx, x + 24, y + 196, w - 48, 18, owed > 0 ? `LEVEL UP (${owed})` : 'TABLETS',
             { act: owed > 0 ? 'levelUp' : 'cpu', arg: c.id, col: owed > 0 ? '#ffd700' : '#b8c4d4', font: '10px Share Tech Mono, monospace' });
      }
      _zones.push({ x, y: y - 6, w, h: 200, act: 'dossier', arg: c.id });      // last: the buttons win
    });

    // ── THE PEN ──
    area(R.pen);
    ctx.font = '12px Orbitron, monospace'; ctx.fillStyle = '#ffb050'; ctx.textAlign = 'left';
    ctx.fillText(`THE PEN  ${pets.length}/${pens}`, R.pen.x + 14, R.pen.y + 20);
    T('one animal per hull · it hunts vermin and sits with the wounded · click: it flies', R.pen.x + R.pen.w - 14, R.pen.y + 20, '#5f7893', 10, 'right');
    R.baskets.forEach(B => {
      const { x, y, w } = B, p = pets[B.i];
      if (B.ghost) {
        dashed({ x, y, w, h: 150 }, '#ffb02088');
        const o = upgradeOffer('pets');
        T('+1 PEN', x + w / 2, y + 70, '#ffb020', 11, 'center', true);
        T(o ? `${o.cost} CC — the cook` : '', x + w / 2, y + 86, '#7a6a40', 9, 'center');
        return;
      }
      const cx = x + w * 0.42;
      // the scratching post, the bowl, the basket and its cushion
      F(x + w - 24, y + 14, 8, 84, '#c8a878'); for (let k = 0; k < 84; k += 6) F(x + w - 24, y + 14 + k, 8, 2, '#a88858');
      F(x + w - 30, y + 98, 22, 4, '#6a7690');
      F(x + w - 52, y + 98, 16, 6, '#4db8ff'); F(x + w - 50, y + 96, 12, 3, p ? '#c89060' : '#2a3242');
      ctx.fillStyle = '#7a5a3a'; ctx.beginPath(); ctx.ellipse(cx, y + 92, Math.min(46, w * 0.32), 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a03a3a'; ctx.beginPath(); ctx.ellipse(cx, y + 88, Math.min(38, w * 0.26), 11, 0, 0, Math.PI * 2); ctx.fill();
      for (let k = -40; k <= 40; k += 8) if (Math.abs(k) < w * 0.3) F(cx + k, y + 96, 2, 6, '#5a3e26');
      if (p) {
        const picked = _petId === p.id;
        try { const a = Animation.catAnim('idle', p.color ?? '#3a3a42'); a.update?.(t % 2); a.draw(ctx, cx, y + 72, 84, 84); } catch (e) { /* a picture only */ }
        T(_clip(ctx, p.name ?? 'cat', w - 8), x + w / 2, y + 122, picked ? '#1aff8c' : '#e2ecf8', 11, 'center', true);
        // A HUNGRY ANIMAL HAS TO BE VISIBLE BEFORE YOU FLY IT (update47)
        const hun = Utils.clamp((p.hunger ?? 100) / 100, 0, 1);
        F(x + 12, y + 128, w - 24, 4, '#0a1018');
        F(x + 12, y + 128, (w - 24) * hun, 4, hun > 0.4 ? '#1aff8c' : hun > 0.12 ? '#ffb020' : '#ff2d44');
        T(picked ? '✓ FLYING' : 'stays home', x + w / 2, y + 146, picked ? '#1aff8c' : '#7a90a8', 9, 'center');
        if (picked) { ctx.strokeStyle = '#1aff8c'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, 152); }
        _zones.push({ x, y, w, h: 154, act: 'pickPet', arg: p.id });
      } else T('empty basket', x + w / 2, y + 122, '#5f7893', 10, 'center');
    });
    const catPrice = Base.PRICE?.cat ?? 60, canCat = pets.length < pens && Base.cc() >= catPrice;
    _btn(ctx, R.adopt.x, R.adopt.y, R.adopt.w, R.adopt.h, `ADOPT A CAT — ${catPrice} CC`,
         { act: canCat ? 'adoptCat' : null, enabled: canCat, col: '#ffc861', sub: pets.length >= pens ? 'every basket taken' : 'the station keeps cats' });

    // ── READY FOR THE CHAIR ──
    const C = R.card;
    ctx.fillStyle = 'rgba(8,12,22,0.93)'; ctx.fillRect(C.x, C.y, C.w, C.h);
    ctx.strokeStyle = '#ffb05088'; ctx.lineWidth = 1; ctx.strokeRect(C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1);
    F(C.x, C.y, 3, C.h, '#ffb050');
    ctx.font = '12px Orbitron, monospace'; ctx.fillStyle = '#ffb050'; ctx.textAlign = 'left';
    ctx.fillText('READY FOR THE CHAIR', C.x + 16, C.y + 24);
    const pool = Base.promotable?.() ?? [];
    ctx.fillStyle = '#7a90a8'; ctx.font = '10px Share Tech Mono, monospace';
    _wrap(ctx, pool.length ? 'He leaves the barracks for good. His RANK is what he brings: the commander starts at that level, with that many Destiny Tablet cells open.'
                           : 'The barracks are empty.', C.x + 16, C.y + 42, C.w - 32, 12, 3);
    const RH = 128, top = C.y + 84;
    _promoScroll = Utils.clamp(_promoScroll, 0, Math.max(0, pool.length - PROMO_ROWS));
    const first = _promoScroll;
    pool.slice(first, first + PROMO_ROWS).forEach((c, i) => {
      const y = top + i * RH, x = C.x + 12, w = C.w - 24;
      Renderer.drawCrewCard(ctx, c, x, y, 'M', { w, h: 64, skillStrip: true });
      const mastered = (typeof Commander !== 'undefined') ? Commander.masteredOf(c) : [];
      ctx.font = '9px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = mastered.length ? '#4dd8c0' : '#ff7c20';
      ctx.fillText(_clip(ctx, mastered.length ? `specialisations (3/3): ${mastered.map(k => SKILL_DEFS[k]?.label ?? k).join(', ')}` : 'specialisations: none — a skill counts only at 3/3', w), x, y + 76);
      const lvl = (typeof rankLevelOf !== 'undefined') ? Math.max(1, rankLevelOf(c)) : 1;
      ctx.fillStyle = '#7a90a8';
      ctx.fillText(_clip(ctx, `commander level ${lvl} · ${lvl}/25 tablet cells · ${lvl} level-up picks`, w), x, y + 88);
      const price = (typeof Commander !== 'undefined' && Commander.priceFor) ? Commander.priceFor(c) : (Base.PRICE?.promotion ?? 80);
      const room = crews.length < cap, can = room && Base.cc() >= price;
      _btn(ctx, x, y + 94, w, 24, room ? `PROMOTE — ${price} CC` : 'NO CHAIR — the cook builds one',
           { act: can ? 'promote' : null, arg: c.id, enabled: can, col: '#ffd700' });
    });
    if (pool.length > PROMO_ROWS) {
      const span = Math.max(1, pool.length - PROMO_ROWS), by = top + PROMO_ROWS * RH;
      _btn(ctx, C.x + 12, by, 84, 20, '▲ EARLIER', { act: first > 0 ? 'scrollPromo' : null, arg: -1, enabled: first > 0, col: '#b8c4d4' });
      _btn(ctx, C.x + 104, by, 84, 20, 'LATER ▼', { act: first < span ? 'scrollPromo' : null, arg: 1, enabled: first < span, col: '#b8c4d4' });
      T(`${first + 1}–${Math.min(pool.length, first + PROMO_ROWS)} of ${pool.length}`, C.x + 196, by + 14, '#4a6080', 10);
    }
  }

  // ── Tab: SUPPLY ─────────────────────────────────────────
  /* ── THE WAREHOUSE: A RACK AT THE HOLD'S SIZE (update159) ─────────────
   *
   * jj (22.10), on a first mock-up with big painted containers: "za duże —
   * wielkość itemów musi być zachowana, tu byłyby większe niż w magazynie
   * statku; musimy mieć standard; wszędzie ikony rzeczy, przy kupowaniu też —
   * ludzie to wzrokowcy". So the shelf is drawn at the game's ONE cargo size
   * (`LootScreen.CELL` + the 4-px gap) by the ONE cargo painter
   * (`LootScreen.drawCargoItem`): a He2 tank here is the He2 tank in a hold.
   * The rack's frame lives in the gaps — orange beams under the levels, blue
   * uprights every two bays — so it adds nothing to the size of a thing.
   *
   * Left: the hall, the rack on its floor, the next bay dashed with its price
   * (the quartermaster's upgrade, asked first), the DELIVERIES door. Right:
   * the counter — the thing you clicked, the four lines you can buy (each
   * with its own container at its real size), PACK THE HOLD.
   *
   * What you buy goes onto the rack, never into a hold (jj: "nie powinno się
   * ładować do ładowni statku jak kupujemy"); moving things stays on the
   * packing screen. And the forklift brings it (jj: "animacja z
   * podjeżdżaniem fajny pomysł"): the purchase is booked at once, the picture
   * follows — a run per container, out of the door, up to its place, back.
   * `supplyRects()` is the one geometry.
   */
  const SHELF_GAP = 4;                                    // LootScreen's gap: the rack's beams sit in it
  const SUPPLY_KEYS = { fuel: 'he2_med', missiles: 'missile_rack', scan: 'survey_probe', food: 'ration_pack' };
  const SUPPLY_LINES = [['fuel', 'He2'], ['missiles', 'MISSILES'], ['scan', 'SURVEY PROBE'], ['food', 'RATIONS']];
  const LIFT = { RUN: 2.6, MAX: 6 };                      // one run, and how many wait their turn
  let _shelfSel = null, _rackBay = 0, _lift = [];         // the picked place 'x,y'; the first bay in view; the runs
  /* A place, not an id: the shelf is read back from the save every time
     (`Base.warehouseGrid()`), and every read deals out new ids. */
  const _placeOf = (it) => `${it.x},${it.y}`;

  function supplyRects() {
    const g = Base.warehouseGrid();
    const CELL = (typeof LootScreen !== 'undefined' && LootScreen.CELL) || 36, P = CELL + SHELF_GAP;
    const area = { x: 16, y: 62, w: 870, h: 530 }, card = { x: 894, y: 62, w: 370, h: 530 };
    const floor = area.y + area.h - 46;
    const door = { x: area.x + area.w - 170, y: floor - 150, w: 150, h: 150 };
    const cols = g?.cols ?? 0, rows = g?.rows ?? 0;
    const x0 = area.x + 70;
    const fit = Math.max(1, Math.floor((door.x - 30 - x0 - (CELL + 10)) / P));   // bays that stand clear of the door
    const vis = Math.min(cols, fit);
    _rackBay = Utils.clamp(_rackBay, 0, Math.max(0, cols - vis));
    const rack = { x: x0, y: floor - (rows * P - SHELF_GAP) - 10, cols, rows, vis, first: _rackBay, cell: CELL, pitch: P,
                   w: vis * P - SHELF_GAP, h: rows * P - SHELF_GAP };
    const ghost = { x: rack.x + vis * P + 6, y: rack.y, w: CELL + 1, h: rack.h };
    const lines = SUPPLY_LINES.map(([kind, label], i) => {
      const x = card.x + 14 + (i % 2) * 175, y = card.y + 178 + Math.floor(i / 2) * 132;
      return { kind, label, x, y, w: 167, h: 124,
               one: { x: x + 8, y: y + 104, w: 72, h: 16 }, five: { x: x + 86, y: y + 104, w: 72, h: 16 } };
    });
    return { area, card, floor, door, rack, ghost, lines,
             thing: { x: card.x + 14, y: card.y + 36, w: 96, h: 96 },
             pack:  { x: card.x + 14, y: card.y + 448, w: card.w - 28, h: 66 },
             left:  { x: rack.x - 52, y: floor + 8, w: 22, h: 22 },
             right: { x: rack.x + rack.w + 30, y: floor + 8, w: 22, h: 22 } };
  }

  /** Where a place on the rack is on screen (null off the bays in view). */
  function _rackXY(R, cx, cy) {
    const v = cx - R.rack.first;
    return { x: R.rack.x + v * R.rack.pitch, y: R.rack.y + cy * R.rack.pitch, on: v >= 0 && v < R.rack.vis };
  }

  /** A purchase is booked; the forklift is told what came and where it went. */
  function _deliver(before, g) {
    if (!g) return;
    g.items.forEach(it => {
      const was = before.get(`${it.defKey}@${_placeOf(it)}`);
      if (was !== undefined && was >= (it.isStack ? it.qty : 1)) return;      // nothing new in this one
      if (_lift.length >= LIFT.MAX) return;                                    // the rest just arrive
      _lift.push({ id: _placeOf(it), fresh: was === undefined, key: it.defKey, meta: it.meta ?? null,
                   qty: it.isStack ? it.qty - (was ?? 0) : 1, x: it.x, y: it.y, rot: it.rot ?? 0, t: 0 });
    });
  }
  /** Items still on the forks are not on the rack yet. */
  const _onForks = (id) => _lift.some((l, i) => l.fresh && l.id === id && (i > 0 || l.t < 0.72));
  function _liftUpdate(dt) {
    if (!_lift.length) return;
    _lift[0].t += dt / LIFT.RUN;
    if (_lift[0].t >= 1) _lift.shift();
  }

  function _drawSupply(ctx, px, py, pw, ph, b) {
    const R = supplyRects(), A = R.area, C = R.card, K = R.rack;
    const g = Base.warehouseGrid();
    const F = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const T = (s, x, y, col, size, al = 'left', bold = false, font = 'Share Tech Mono') => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
    if (!g || typeof LootScreen === 'undefined') { T('cargo system not loaded', A.x + 16, A.y + 30, '#7a90a8', 11); return; }
    const CELL = K.cell, P = K.pitch;

    // ── the hall: corrugated wall, lamps, the bay's number painted on ──
    F(A.x, A.y, A.w, A.h, 'rgba(7,9,15,0.92)');
    for (let x = A.x; x < A.x + A.w; x += 14) F(x, A.y, 7, A.h, 'rgba(255,215,128,0.025)');
    for (let k = 0; k < 4; k++) {
      const lx = A.x + 120 + k * 200;
      F(lx - 30, A.y + 40, 60, 5, '#3a4458');
      ctx.fillStyle = 'rgba(255,215,128,0.07)';
      ctx.beginPath(); ctx.moveTo(lx - 30, A.y + 45); ctx.lineTo(lx + 30, A.y + 45); ctx.lineTo(lx + 90, R.floor); ctx.lineTo(lx - 90, R.floor); ctx.fill();
    }
    T('SUPPLY · BAY 5', A.x + 40, A.y + 120, 'rgba(255,215,128,0.10)', 46, 'left', true, 'Orbitron');
    const used = g.usedCells(), cap = g.capacity, worth = g.items.reduce((n, it) => n + it.value('general'), 0);
    T('THE SHELF', A.x + 14, A.y + 22, '#ffd780', 13, 'left', false, 'Orbitron');
    T(`${used} / ${cap} places · ~${worth} CC at a broker`, A.x + 130, A.y + 21, used >= cap ? '#ffd700' : '#a8b8cc', 11);
    T('click a thing: it goes on the counter', A.x + A.w - 14, A.y + 21, '#5f7893', 10, 'right');

    // ── the rack: uprights every two bays, a beam under every level, both in the gaps ──
    for (let v = 0; v <= K.vis; v += 2) {
      const edge = v === 0 || v >= K.vis, x = K.x + Math.min(v, K.vis) * P - SHELF_GAP - (v === 0 ? 4 : 0);
      F(x, K.y - 20, edge ? 8 : SHELF_GAP, R.floor - K.y + 20, '#2f4f7a'); F(x, K.y - 20, 1, R.floor - K.y + 20, '#4a73a8');
    }
    if (K.vis % 2) { const x = K.x + K.vis * P - SHELF_GAP; F(x, K.y - 20, 8, R.floor - K.y + 20, '#2f4f7a'); }
    for (let cy = 0; cy <= K.rows; cy++) {
      const y = K.y + cy * P - SHELF_GAP;
      F(K.x - 8, y, K.w + 16, SHELF_GAP, '#d8842a'); F(K.x - 8, y, K.w + 16, 1, '#ffb050');
    }
    for (let cy = 0; cy < K.rows; cy++) {
      for (let v = 0; v < K.vis; v++) F(K.x + v * P, K.y + cy * P, CELL, CELL, 'rgba(18,22,36,0.95)');
      T(String.fromCharCode(65 + cy), K.x - 20, K.y + cy * P + 23, '#4a6080', 10, 'center', true);
    }
    for (let v = 0; v < K.vis; v++) T(`${K.first + v + 1}`, K.x + v * P + CELL / 2, K.y - 26, '#4a6080', 9, 'center');

    // the next bay: dashed, its price; the quartermaster asks before he builds it
    const G = R.ghost, offer = upgradeOffer('warehouse');
    if (offer && K.first + K.vis >= K.cols) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = offer.can ? '#8a7448' : '#4a4232'; ctx.lineWidth = 1;
      ctx.strokeRect(G.x + 0.5, G.y + 0.5, G.w - 1, G.h - 1); ctx.setLineDash([]);
      ctx.save(); ctx.translate(G.x + G.w / 2 + 4, G.y + G.h / 2); ctx.rotate(-Math.PI / 2);
      T(`+1 BAY · ${offer.cost} CC`, 0, 0, offer.can ? '#ffd780' : '#6a5a38', 11, 'center', true); ctx.restore();
      if (offer.can) _zones.push({ x: G.x, y: G.y, w: G.w, h: G.h, act: 'upgradeAsk', arg: 'warehouse' });   // poor: nothing to press
    }

    // the goods — drawn exactly as they are drawn in a ship's hold
    if (!g.items.some(it => _placeOf(it) === _shelfSel)) _shelfSel = null;
    g.items.forEach(it => {
      if (_onForks(_placeOf(it))) return;
      const p = _rackXY(R, it.x, it.y);
      const w = (it.mask?.[0]?.length ?? it.w) * P - SHELF_GAP, h = (it.mask?.length ?? it.h) * P - SHELF_GAP;
      if (p.x + w <= K.x || p.x >= K.x + K.w + 1) return;           // a bay out of view
      ctx.save(); ctx.beginPath(); ctx.rect(K.x - 1, K.y - 1, K.w + 2, K.h + 2); ctx.clip();
      LootScreen.drawCargoItem(ctx, it, p.x, p.y, 1, false, _placeOf(it) === _shelfSel);
      ctx.restore();
      const zx = Math.max(p.x, K.x), zw = Math.min(p.x + w, K.x + K.w) - zx;
      _zones.push({ x: zx, y: p.y, w: zw, h, act: 'shelfPick', arg: _placeOf(it) });
    });
    if (K.cols > K.vis) {
      _btn(ctx, R.left.x, R.left.y, R.left.w, R.left.h, '◀', { act: K.first > 0 ? 'rackScroll' : null, arg: -1, enabled: K.first > 0 });
      _btn(ctx, R.right.x, R.right.y, R.right.w, R.right.h, '▶', { act: K.first + K.vis < K.cols ? 'rackScroll' : null, arg: 1, enabled: K.first + K.vis < K.cols });
      T(`bays ${K.first + 1}-${K.first + K.vis} of ${K.cols}`, R.left.x + R.left.w + 8, R.left.y + 15, '#4a6080', 9);
    }

    // ── the floor, the DELIVERIES door, the forklift ──
    F(A.x, R.floor, A.w, A.y + A.h - R.floor, '#141820');
    for (let x = A.x; x < A.x + A.w; x += 24) {
      ctx.fillStyle = (x / 24) % 2 ? '#ffd700' : '#141820';
      ctx.beginPath(); ctx.moveTo(x, R.floor); ctx.lineTo(x + 12, R.floor); ctx.lineTo(x + 6, R.floor + 5); ctx.lineTo(x - 6, R.floor + 5); ctx.fill();
    }
    const D = R.door;
    F(D.x - 6, D.y - 6, D.w + 12, D.h + 6, '#2a3242');
    for (let y = D.y; y < D.y + D.h * 0.35; y += 10) F(D.x, y, D.w, 8, '#4a5468');
    F(D.x, D.y + D.h * 0.35, D.w, D.h * 0.65, '#0a0d14');
    T('DELIVERIES', D.x + D.w / 2, D.y - 12, '#ffd780', 10, 'center', true);
    _drawForklift(ctx, R, F);
    T(_lift.length ? `delivering — ${_lift.length} run${_lift.length > 1 ? 's' : ''} to go` : 'what you buy comes in at the door and goes up onto the rack',
      A.x + 14, A.y + A.h - 12, _lift.length ? '#ffd780' : '#4a6080', 10);

    // ── THE COUNTER ──
    F(C.x, C.y, C.w, C.h, 'rgba(8,12,22,0.95)'); F(C.x, C.y, 3, C.h, '#ffd780');
    ctx.strokeStyle = '#ffd78066'; ctx.lineWidth = 1; ctx.strokeRect(C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1);
    T('ON THE COUNTER', C.x + 16, C.y + 24, '#ffd780', 12, 'left', false, 'Orbitron');
    const sel = g.items.find(it => _placeOf(it) === _shelfSel);
    const S = R.thing;
    F(S.x, S.y, S.w, S.h, 'rgba(18,22,36,0.95)');
    if (sel) {
      const iw = (sel.mask?.[0]?.length ?? sel.w) * P - SHELF_GAP, ih = (sel.mask?.length ?? sel.h) * P - SHELF_GAP;
      const sc = Math.min(1, (S.w - 8) / iw, (S.h - 8) / ih);       // a gun crate 3x3 just fits; nothing is drawn bigger
      ctx.save(); ctx.translate(S.x + S.w / 2, S.y + S.h / 2); ctx.scale(sc, sc);
      LootScreen.drawCargoItem(ctx, sel, -iw / 2, -ih / 2, 1, false, false);
      ctx.restore();
      const name = sel.meta && typeof getWeaponDef !== 'undefined' && getWeaponDef(sel.meta) ? getWeaponDef(sel.meta).label : sel.label;
      T(_clip(ctx, `${name}${sel.damaged ? ' (spoiled)' : ''}`, 230), C.x + 122, C.y + 52, '#f0e2c0', 14, 'left', true);
      T(`${sel.w}×${sel.h} places · bay ${sel.x + 1}, level ${String.fromCharCode(65 + sel.y)}`, C.x + 122, C.y + 70, '#7a90a8', 10);
      if (sel.isStack) T(`${sel.qty} of ${sel.stackMax} in this one`, C.x + 122, C.y + 86, '#ffd780', 11);
      T(`~${sel.value('general')} CC at a station broker`, C.x + 122, C.y + 102, '#1aff8c', 10);
      ctx.font = '10px Share Tech Mono, monospace'; ctx.fillStyle = '#a8b8cc';
      _wrap(ctx, sel.def.desc || '', C.x + 122, C.y + 120, 232, 13, 3);
    } else {
      ctx.font = '11px Share Tech Mono, monospace'; ctx.fillStyle = '#7a90a8'; ctx.textAlign = 'left';
      _wrap(ctx, g.items.length ? 'Click anything on the rack to look at it here.' : 'The rack is empty. Buy below, or bring something home in the hold.',
            C.x + 122, C.y + 56, 232, 14, 4);
    }

    // buy onto the shelf — every line shows its own container, at its real size
    T('BUY ONTO THE SHELF', C.x + 16, C.y + 168, '#5f7893', 11);
    T(`${cap - used} free places`, C.x + C.w - 16, C.y + 168, used >= cap ? '#ffd700' : '#4a6080', 10, 'right');
    const stock = Base.supply();
    R.lines.forEach(L => {
      F(L.x, L.y, L.w, L.h, 'rgba(18,22,36,0.95)');
      const it = new CargoItem(SUPPLY_KEYS[L.kind]); it.qty = it.stackMax;
      const iw = it.w * P - SHELF_GAP, ih = it.h * P - SHELF_GAP;
      LootScreen.drawCargoItem(ctx, it, L.x + Math.round((L.w - iw) / 2), L.y + 8 + Math.round((76 - ih) / 2), 1, false, false);
      const price = Base.unitPrice(L.kind);
      T(`${L.label} — ${price} CC`, L.x + 8, L.y + 98, it.def.col, 11, 'left', true);
      T(`${stock[L.kind]} here`, L.x + L.w - 8, L.y + 14, '#7a90a8', 9, 'right');
      const room = used < cap;
      [[L.one, 1], [L.five, 5]].forEach(([r, n]) => {
        const can = room && Base.cc() >= price * n;
        _btn(ctx, r.x, r.y, r.w, r.h, `×${n}`, { act: can ? 'buy' : null, arg: [L.kind, n], enabled: can, col: '#1aff8c', font: '10px Share Tech Mono, monospace' });
      });
    });

    // the one way into the packing screen
    const p = _holdSummary(), shipDef = b.ships[_shipIdx] ? SHIP_CATALOG[b.ships[_shipIdx].key] : null;
    _btn(ctx, R.pack.x, R.pack.y, R.pack.w, R.pack.h, 'PACK THE HOLD  ▶',
         { act: 'warehouse', col: '#ffd780', font: '15px Orbitron, monospace',
           sub: `He2 PACKED: ${p.fuel} · missiles ${p.missiles} · hold ${p.cells}/${p.cap}${shipDef ? ' — the ' + shipDef.label : ''}` });
  }

  /** The forklift: out of the door with the load, up to its place, down, back. */
  function _drawForklift(ctx, R, F) {
    const run = _lift[0], P = R.rack.pitch, CELL = R.rack.cell, D = R.door, FL = R.floor;
    let item = null, fx = D.x + 30, forkY = FL - 14;
    if (run) {
      item = new CargoItem(run.key, run.meta); item.qty = Math.max(1, run.qty); item.rot = run.rot;
      const dest = _rackXY(R, run.x, run.y), tx = Utils.clamp(dest.x, R.rack.x, R.rack.x + R.rack.w - CELL) + 2;
      const ih = (item.mask?.length ?? item.def.h) * P - SHELF_GAP;
      const up = dest.y + ih;                                          // the forks under the place
      const t = run.t;
      if (t < 0.4)       { fx = D.x + 30 + (tx - D.x - 30) * (t / 0.4); }
      else if (t < 0.7)  { fx = tx; forkY = FL - 14 - (FL - 14 - up) * ((t - 0.4) / 0.3); }
      else if (t < 0.78) { fx = tx; forkY = up; item = t < 0.72 ? item : null; }
      else               { fx = tx + (D.x + 30 - tx) * ((t - 0.78) / 0.22); item = null; }
      if (t >= 0.7 && t < 0.78 && !item) forkY = up - 6 * ((t - 0.72) / 0.06);   // down off the beam
      if (t >= 0.4 && t < 0.78) {                                      // where it is going
        ctx.setLineDash([3, 3]); ctx.strokeStyle = '#1aff8c'; ctx.lineWidth = 1.2;
        const iw = (new CargoItem(run.key).mask?.[0]?.length ?? 1) * P - SHELF_GAP;
        ctx.strokeRect(dest.x - 1.5, dest.y - 1.5, iw + 3, ih + 3); ctx.setLineDash([]);
      }
    }
    const mx = fx + CELL + 4, bx = mx + 8;
    const ih = item ? (item.mask?.length ?? 1) * P - SHELF_GAP : 0;
    const top = Math.min(forkY - ih - 6, FL - 110);
    F(mx, top, 6, FL - top - 4, '#3a3a3a'); F(mx + 1, top, 1, FL - top - 4, '#6a6a6a');          // the mast
    F(fx - 2, forkY, CELL + 8, 3, '#8a8a8a');                                                     // the forks
    if (item) LootScreen.drawCargoItem(ctx, item, fx, forkY - ih + SHELF_GAP - 4, 1, true, false);
    F(bx, FL - 40, 66, 26, '#d8a020'); F(bx, FL - 40, 66, 3, '#ffd060');
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 2; ctx.strokeRect(bx + 34, FL - 66, 26, 26);
    F(bx + 35, FL - 65, 24, 24, 'rgba(120,180,220,0.2)');
    ctx.fillStyle = '#111'; [bx + 12, bx + 54].forEach(wx => { ctx.beginPath(); ctx.arc(wx, FL - 10, 8, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = run && Math.floor(_blink * 4) % 2 ? '#ffd040' : '#7a5a10';                    // the beacon turns while it works
    ctx.beginPath(); ctx.arc(bx + 47, FL - 70, 3, 0, Math.PI * 2); ctx.fill();
  }

  // ── Tab: MEMORIAL ───────────────────────────────────────
  /* A hill on the moon, and a cross for everyone who did not come back.
     Cannon Fodder had it right: a list of the dead is an inventory, but
     a hillside that visibly fills up over a campaign is a memorial.
     Hover a cross to read who is under it. */

  let _graveZones = [];      // {x,y,w,h,g} — rebuilt every draw, for hover

  /* THE HILL ON THE SKARP (update149) — jj sent a picture of a cemetery
     on an escarpment, then: "nowy wygląd wzgórza, ale stary system
     nagrobków, plus latarnia". The painting is TownView's: terraces of
     the colony's old stones going up the hill, dark; our plot on the
     lower terraces, cleared and kerbed; the monument at the cliff edge.
     The markers on our plot are the ones this screen always drew —
     cross, headstone, pillar, monument, the cat's paw, the enemy's
     stake — each with a lantern lit beside it. The plot grows a terrace
     at a time as the dead come home. */
  const GRAVE_SCALE = 1.45;
  const _buriedGraves = () => ((typeof Save !== 'undefined' && Save.getGraveyard)
    ? Save.getGraveyard() : []).filter(g => g && g.buried);

  /** The hill itself, under the title and the tabs. */
  function _drawHillBack(ctx, W, H) {
    if (typeof TownView !== 'undefined') TownView.drawHill(ctx, _buriedGraves().length);
    // the title and the tabs sit on a dark band over the sky
    const fade = ctx.createLinearGradient(0, 50, 0, 120);
    fade.addColorStop(0, 'rgba(4,6,12,0.70)'); fade.addColorStop(1, 'rgba(4,6,12,0)');
    ctx.fillStyle = fade; ctx.fillRect(0, 50, W, 70);
  }

  function _drawMemorial(ctx, W, H) {
    _graveZones = [];
    /* ── A CROSS MEANS A GRAVE, AND A GRAVE NEEDS A BODY (update74)
     *
     * The hill used to plant one for EVERY name in the graveyard,
     * including the men nobody carried home — so the same crewman got
     * a headstone here AND a line in NOT RECOVERED two feet to the
     * right, which is the game contradicting itself on one screen.
     *
     * `buried` is written by `Save.markBuried` at the dock, when a
     * body bag actually comes off the ship. The two panels are
     * complementary now: crosses for the ones who came back, a list
     * for the ones who did not, and every name appears exactly once.
     */
    const graves = _buriedGraves();

    // ── our plot: a marker and a lantern for each, back rows first ──
    const slots = (typeof TownView !== 'undefined')
      ? TownView.hillSlots(graves.length)
      : graves.map((g, i) => ({ x: 120 + (i % 24) * 42, y: 690 - Math.floor(i / 24) * 48 }));
    const S = GRAVE_SCALE;
    const placed = slots.map((p, i) => ({ p, g: graves[i] }))
      .sort((a, b2) => a.p.y - b2.p.y);
    placed.forEach(({ p, g }) => {
      const z = { x: Math.round(p.x - 10 * S), y: Math.round(p.y - 27 * S), w: Math.round(20 * S), h: Math.round(31 * S), g };
      const hot = Utils.pointInRect(Input.mouse.x, Input.mouse.y, z.x, z.y, z.w, z.h);
      if (typeof TownView !== 'undefined') TownView.lantern(ctx, p.x, p.y, _blink, hot);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(S, S);
      _drawGrave(ctx, 0, 0, hot, g);
      ctx.restore();
      _graveZones.push(z);
    });

    // ── heading ──
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffb84a';
    ctx.font = '13px Orbitron, monospace';
    ctx.fillText('THE HILL', 40, 158);
    ctx.fillStyle = '#9a8a70';
    ctx.font = '11px Share Tech Mono, monospace';
    /* And the heading counts what is actually on the hill. It said
       "never came home" while drawing a stone for everybody, which was
       the same contradiction written out in words. */
    /* Ours and theirs counted apart (update93a): an NN stake is not one
       of the men this line is about. */
    const ours = graves.filter(g => !g.enemy).length, nn = graves.length - ours;
    ctx.fillText(graves.length
      ? `${ours} brought home and buried${nn ? ` · ${nn} of theirs, no name` : ''}. Hover a marker to read the name.`
      : 'Nobody is buried here yet. Keep it that way.', 40, 176);
    if (graves.length > slots.length) {
      ctx.fillStyle = '#5f7893';
      ctx.fillText(`(${graves.length - slots.length} more lie further up the hill)`, 40, 192);
    }

    /* ── WHO NEVER CAME BACK (update68) ──────────────────────
     *
     * A stone on the hill says a man died. It does NOT say whether
     * anybody carried him home — and a commander lost with his ship
     * had no stone at all until this package, so a player could lose
     * four of them across a campaign with nothing anywhere to show it.
     *
     * The player asked for a list, and this is it: read straight off
     * the graveyard by the one field a burial writes. Not a second
     * register of the dead — the same list, filtered. On the hill
     * (update149) it hangs on the cliff, bottom right.
     */
    {
      const lost = (typeof Save !== 'undefined' && Save.notRecovered)
        ? Save.notRecovered() : [];
      const LW = 220;
      const x = W - LW - 40;
      const rowH = 15;
      const rows = Math.min(lost.length, 14);
      const boxH = 44 + Math.max(1, rows + (lost.length > rows ? 1 : 0)) * rowH;
      const y0 = H - 24 - boxH + 34;
      ctx.fillStyle = 'rgba(6,8,14,0.86)';
      ctx.fillRect(x - 12, y0 - 34, LW + 24, boxH);
      ctx.strokeStyle = 'rgba(138,122,82,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(x - 11.5, y0 - 33.5, LW + 23, boxH - 1);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#8a7a52';
      ctx.font = '11px Orbitron, monospace';
      ctx.fillText('NOT RECOVERED', x, y0 - 14);

      if (!lost.length) {
        ctx.fillStyle = '#5a6478';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText('Everybody came home.', x, y0 + 4);
      } else {
        lost.slice(0, rows).forEach((g, i) => {
          const y = y0 + 4 + i * rowH;
          /* A cat, a commander and a hand read differently — losing an
             animal is not losing your commander, and a list that made
             them look the same would be worse than no list. */
          const mark = g.commander ? '★' : g.pet ? '✦' : '·';
          ctx.fillStyle = g.commander ? '#ffd700' : g.pet ? '#c8a06a' : '#7a90a8';
          ctx.font = '10px Share Tech Mono, monospace';
          ctx.fillText(mark, x, y);
          ctx.fillStyle = g.commander ? '#e8d9a8' : '#98a0b8';
          ctx.fillText(_clip(ctx, g.name || 'Unknown', LW - 74), x + 12, y);
          ctx.textAlign = 'right';
          ctx.fillStyle = '#5a5f6e';
          ctx.fillText(g.sector ? `sec ${g.sector}` : '—', x + LW, y);
          ctx.textAlign = 'left';
        });
        if (lost.length > rows) {
          ctx.fillStyle = '#5a6478';
          ctx.font = '9px Share Tech Mono, monospace';
          ctx.fillText(`…and ${lost.length - rows} more`, x, y0 + 4 + rows * rowH);
        }
      }
    }

    // ── the hovered stone's story ──
    const hovered = _graveZones.find(z =>
      Utils.pointInRect(Input.mouse.x, Input.mouse.y, z.x, z.y, z.w, z.h));
    if (hovered) _drawGraveCard(ctx, hovered, 0, 56, W, H - 56);
  }

  /**
   * How much of a soldier was this?
   *
   * Kills weigh most, then victories he was aboard for, then simply
   * having been there. It decides which marker goes over him — a hill
   * where every cross is identical says nothing about who is under it.
   */
  function _heroScore(g) {
    const mastered = Object.values(g.skills || {})
      .filter(v => (v?.level ?? 0) >= ((typeof MAX_SKILL_LEVEL !== 'undefined') ? MAX_SKILL_LEVEL : 3)).length;
    return (g.kills ?? 0) * 3 + (g.wins ?? 0) * 2 + (g.battles ?? 0)
         + (g.escapes ?? 0) + mastered * 2;
  }

  const GRAVE_TIERS = [
    { min: 0,  key: 'cross',   label: 'hand'    },
    { min: 4,  key: 'slab',    label: 'rating'  },
    { min: 10, key: 'obelisk', label: 'veteran' },
    { min: 20, key: 'monument',label: 'hero'    },
  ];
  /* THE CAT GETS ITS OWN LADDER (update45).
     A cat has no battles won, no skills mastered and no ship actions,
     so the crew's hero score puts every animal that ever flew under
     the lowest marker in the yard — a rookie's cross for a cat that
     cleared four hulls of vermin. It is measured on the only thing it
     ever did: what it caught. */
  const CAT_GRAVE_TIERS = [
    { min: 0,  key: 'paw',    label: "ship's cat" },
    { min: 3,  key: 'ratter', label: 'ratter'     },
    { min: 8,  key: 'hunter', label: 'hunter'     },
    { min: 16, key: 'legend', label: 'legend'     },
  ];
  function _isCatGrave(g) { return !!CORP_DEFS[g?.race]?.pet; }

  function _graveTier(g) {
    if (_isCatGrave(g)) {
      const k = g.kills ?? 0;
      let t = CAT_GRAVE_TIERS[0];
      CAT_GRAVE_TIERS.forEach(x => { if (k >= x.min) t = x; });
      return t;
    }
    const sc = _heroScore(g);
    let t = GRAVE_TIERS[0];
    GRAVE_TIERS.forEach(x => { if (sc >= x.min) t = x; });
    return t;
  }

  /** A cat's marker: a paw cut into the stone, bigger the more it
   *  caught. Nothing like the crosses and obelisks around it — you
   *  should be able to find it on the hill at a glance. */
  function _drawCatGrave(ctx, x, y, hot, g, tier) {
    const scale = { paw: 0.8, ratter: 1.0, hunter: 1.2, legend: 1.45 }[tier.key] ?? 1;
    ctx.save();
    ctx.fillStyle = hot ? 'rgba(200,216,240,0.30)' : 'rgba(10,14,22,0.55)';
    ctx.beginPath(); ctx.ellipse(x, y + 1, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();

    const col = hot ? '#ffd700' : (crewColor ? crewColor(g) : '#c8d8f0');
    // A low rounded stone…
    ctx.fillStyle = '#20283a';
    ctx.beginPath();
    ctx.roundRect(x - 7 * scale, y - 13 * scale, 14 * scale, 13 * scale, 5 * scale);
    ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 7 * scale, y - 13 * scale, 14 * scale, 13 * scale, 5 * scale);
    ctx.stroke();

    // …with a paw print on it: pad and four toes.
    ctx.fillStyle = col;
    const py2 = y - 5 * scale;
    ctx.beginPath(); ctx.ellipse(x, py2, 2.6 * scale, 2.1 * scale, 0, 0, Math.PI * 2); ctx.fill();
    [[-3.1, -3.6], [-1.1, -5.0], [1.1, -5.0], [3.1, -3.6]].forEach(([tx, ty]) => {
      ctx.beginPath();
      ctx.ellipse(x + tx * scale, py2 + ty * scale, 1.1 * scale, 1.35 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  /** One marker. Four kinds, by service record; lit when hovered. */
  /* ── AN ENEMY'S GRAVE (update93a) ─────────────────────────
   * The player: "grafika musi się różnić tak, żeby było widać, że to
   * ciało wroga". Nothing like our stones — a bare stake with a board
   * nailed across it, in the enemy's red, and NN burnt into the board.
   * No corporation dot: nobody knew whose he was. */
  const ENEMY_GRAVE_COL = '#ff4444';
  function _drawEnemyGrave(ctx, x, y, hot) {
    ctx.save();
    ctx.fillStyle = hot ? 'rgba(255,68,68,0.28)' : 'rgba(10,14,22,0.55)';
    ctx.beginPath(); ctx.ellipse(x, y + 1, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
    // the stake, leaning a little
    ctx.strokeStyle = hot ? '#ffd700' : '#7a3a3a';
    ctx.lineWidth = hot ? 2.2 : 1.8;
    ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x - 1, y - 18); ctx.stroke();
    // the board across it, crooked
    ctx.save();
    ctx.translate(x - 1, y - 14);
    ctx.rotate(-0.12);
    ctx.fillStyle = '#2a1416';
    ctx.fillRect(-8, -5, 16, 9);
    ctx.strokeStyle = hot ? '#ffd700' : ENEMY_GRAVE_COL;
    ctx.lineWidth = 1;
    ctx.strokeRect(-8, -5, 16, 9);
    ctx.fillStyle = hot ? '#ffd700' : ENEMY_GRAVE_COL;
    ctx.font = '7px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NN', 0, 2.5);
    ctx.restore();
    ctx.restore();
  }

  function _drawGrave(ctx, x, y, hot, g) {
    if (g && g.enemy) { _drawEnemyGrave(ctx, x, y, hot); return; }
    const tier = _graveTier(g);
    if (_isCatGrave(g)) { _drawCatGrave(ctx, x, y, hot, g, tier); return; }
    ctx.save();
    // mound
    ctx.fillStyle = hot ? 'rgba(200,216,240,0.30)' : 'rgba(10,14,22,0.55)';
    ctx.beginPath(); ctx.ellipse(x, y + 1, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();

    const corp = hot ? '#ffd700' : (crewColor ? crewColor(g) : '#c8d8f0');
    const stone = hot ? '#ffd700' : 'rgba(200,216,240,0.75)';
    ctx.strokeStyle = stone;
    ctx.fillStyle   = hot ? 'rgba(255,215,0,0.18)' : 'rgba(200,216,240,0.14)';
    ctx.lineWidth   = hot ? 2.2 : 1.6;

    if (tier.key === 'cross') {
      // A green hand: two sticks lashed together.
      ctx.beginPath();
      ctx.moveTo(x, y);          ctx.lineTo(x, y - 17);
      ctx.moveTo(x - 5, y - 11); ctx.lineTo(x + 5, y - 11);
      ctx.stroke();
      ctx.fillStyle = corp;
      ctx.beginPath(); ctx.arc(x, y - 11, hot ? 2.4 : 1.7, 0, Math.PI * 2); ctx.fill();

    } else if (tier.key === 'slab') {
      // A proper headstone: round-topped slab with a carved cross.
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x - 6, y - 12);
      ctx.arc(x, y - 12, 6, Math.PI, 0);
      ctx.lineTo(x + 6, y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = corp; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);      ctx.lineTo(x, y - 15);
      ctx.moveTo(x - 3, y - 12); ctx.lineTo(x + 3, y - 12);
      ctx.stroke();

    } else if (tier.key === 'obelisk') {
      // A veteran gets a pillar and a plinth.
      ctx.beginPath();
      ctx.moveTo(x - 4.5, y - 2); ctx.lineTo(x - 3, y - 20);
      ctx.lineTo(x, y - 25);      ctx.lineTo(x + 3, y - 20);
      ctx.lineTo(x + 4.5, y - 2); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = stone;
      ctx.fillRect(x - 7, y - 3, 14, 3);
      ctx.fillStyle = corp;
      ctx.beginPath(); ctx.arc(x, y - 15, hot ? 2.4 : 1.8, 0, Math.PI * 2); ctx.fill();

    } else {
      // A hero: a winged stone with a star and a laurel at its foot.
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 2); ctx.lineTo(x - 5, y - 18);
      ctx.lineTo(x, y - 26);    ctx.lineTo(x + 5, y - 18);
      ctx.lineTo(x + 5, y - 2); ctx.closePath();
      ctx.fill(); ctx.stroke();
      // A laurel around the stone, not wings — at this size wings read
      // as little arms and the marker looked like a toy robot.
      ctx.lineWidth = hot ? 1.8 : 1.3;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 2);  ctx.quadraticCurveTo(x - 12, y - 16, x - 3, y - 25);
      ctx.moveTo(x + 9, y - 2);  ctx.quadraticCurveTo(x + 12, y - 16, x + 3, y - 25);
      ctx.stroke();
      ctx.lineWidth = hot ? 2.2 : 1.6;
      ctx.fillStyle = stone;
      ctx.fillRect(x - 8, y - 3, 16, 3);
      // the star
      ctx.fillStyle = hot ? '#ffd700' : '#ffd700';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('★', x, y - 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = corp;
      ctx.beginPath(); ctx.arc(x, y - 21, hot ? 2.2 : 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** The epitaph card for the marker under the pointer. */
  function _drawGraveCard(ctx, z, px, py, pw, ph) {
    const g = z.g;
    /* AN ENEMY'S CARD (update93a): no name, no record — only what is
       known, which is where and that somebody bothered. */
    if (g && g.enemy) {
      const W = 220, H = 70;
      const x = Utils.clamp(z.x + 20, px + 8, px + pw - W - 8);
      const y = Utils.clamp(z.y - H - 8, py + 8, py + ph - H - 8);
      ctx.fillStyle = 'rgba(18,7,9,0.96)';
      ctx.beginPath(); ctx.roundRect(x, y, W, H, 5); ctx.fill();
      ctx.strokeStyle = ENEMY_GRAVE_COL; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, W, H, 5); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = ENEMY_GRAVE_COL;
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.fillText('NN — ENEMY', x + 12, y + 22);
      ctx.fillStyle = '#c8a0a0';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText('buried without a name', x + 12, y + 40);
      ctx.fillStyle = '#7a6a6a';
      ctx.fillText(g.sector ? `sector ${g.sector}` : 'off the charts', x + 12, y + 56);
      return;
    }
    const W = 258, H = 158;
    let x = Utils.clamp(z.x + 20, px + 8, px + pw - W - 8);
    let y = Utils.clamp(z.y - H - 8, py + 8, py + ph - H - 8);
    const tier = _graveTier(g);

    ctx.fillStyle = 'rgba(7,10,18,0.96)';
    ctx.beginPath(); ctx.roundRect(x, y, W, H, 5); ctx.fill();
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, W, H, 5); ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd700';
    ctx.font = '13px Share Tech Mono, monospace';
    ctx.fillText(_clip(ctx, g.name || 'Unknown', W - 80), x + 12, y + 22);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7a90a8';
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillText(tier.label, x + W - 12, y + 22);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    const corp = (typeof CORP_DEFS !== 'undefined' && CORP_DEFS[g.race]?.label) || g.race || '—';
    ctx.fillText(corp, x + 12, y + 38);

    ctx.fillStyle = '#ff8a95';
    ctx.fillText(_clip(ctx, `killed by ${g.killer || 'unknown'}`, W - 24), x + 12, y + 54);
    ctx.fillStyle = '#5f7893';
    const where = g.sector ? `sector ${g.sector}` : 'off the charts';
    ctx.fillText(g.mission ? `${where} · ${g.mission}` : where, x + 12, y + 68);

    /* HE CAME HOME — and since update74 there is no other kind of man
       on this hill, so this no longer asks.
       
       update65 wrote it as `g.buried ? 'brought home and buried' : 'no
       body recovered'`, which was right while the hill planted a stone
       for everybody. update74 made the cross mean a grave, and a grave
       needs a body — so the second half of that conditional became
       unreachable the moment the filter went in. A branch that cannot
       be taken, with a confident comment over it, is worse than no
       branch: the breaking run found it by reverting the line and
       watching nothing fail.
       
       The men nobody carried back have their own panel, up and to the
       right, and they are named there exactly once. */
    ctx.fillStyle = '#4dd8c0';
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillText('brought home and buried', x + 12, y + 80);
    ctx.font = '10px Share Tech Mono, monospace';

    // ── the service record ──
    ctx.strokeStyle = 'rgba(255,215,0,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 76); ctx.lineTo(x + W - 12, y + 76); ctx.stroke();
    const rec = [
      ['actions', g.battles ?? 0, '#c8d8f0'],
      ['won',     g.wins    ?? 0, '#1aff8c'],
      ['fled',    g.escapes ?? 0, '#ffb020'],
      ['kills',   g.kills   ?? 0, '#ff5566'],
    ];
    rec.forEach(([k, v, col], i2) => {
      const cx2 = x + 12 + (i2 % 2) * ((W - 24) / 2);
      const cy2 = y + 92 + Math.floor(i2 / 2) * 15;
      ctx.fillStyle = '#5f7893';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(k, cx2, cy2);
      ctx.fillStyle = col;
      ctx.textAlign = 'right';
      ctx.fillText(String(v), cx2 + (W - 24) / 2 - 12, cy2);
      ctx.textAlign = 'left';
    });

    // What they were good at — the reason losing them stung.
    const sk = Object.entries(g.skills || {})
      .filter(([, v]) => (v?.level ?? 0) > 0)
      .sort((a, b2) => (b2[1].level ?? 0) - (a[1].level ?? 0))
      .slice(0, 4);
    if (sk.length) {
      let sx = x + 12;
      sk.forEach(([key, v]) => {
        const def = (typeof SKILL_DEFS !== 'undefined' && SKILL_DEFS[key]) || { label: key, color: '#9fb4cc' };
        ctx.fillStyle = def.color;
        ctx.font = '9px Share Tech Mono, monospace';
        ctx.fillText(`${Renderer.skillShort ? Renderer.skillShort(key) : def.label.slice(0, 5)} ${v.level}`, sx, y + 132);
        sx += 58;
      });
    } else {
      ctx.fillStyle = '#4a6080';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText('green hand — never got the chance', x + 12, y + 132);
    }

    ctx.fillStyle = '#3d4a63';
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillText('R.I.P.', x + 12, y + 148);
  }

  /** A drawn pictogram for each permanent upgrade. */
  function _upgradeIcon(ctx, kind, x, y, size, col) {
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
    const s = size;
    if (kind === 'warehouse') {
      // Stacked crates.
      ctx.strokeRect(x + 1, y + s * 0.45, s * 0.45, s * 0.5);
      ctx.strokeRect(x + s * 0.52, y + s * 0.45, s * 0.45, s * 0.5);
      ctx.strokeRect(x + s * 0.26, y + 1, s * 0.45, s * 0.4);
    } else if (kind === 'mess') {
      // A commander's cap: peak and crown.
      ctx.beginPath();
      ctx.arc(x + s * 0.5, y + s * 0.52, s * 0.3, Math.PI, 0);
      ctx.stroke();
      ctx.strokeRect(x + s * 0.14, y + s * 0.52, s * 0.72, s * 0.16);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.06, y + s * 0.68);
      ctx.lineTo(x + s * 0.94, y + s * 0.68);
      ctx.stroke();
    } else if (kind === 'pets') {
      // A pen with a pair of ears looking over the rail.
      ctx.strokeRect(x + 1, y + s * 0.5, s - 2, s * 0.45);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.3, y + s * 0.5); ctx.lineTo(x + s * 0.38, y + s * 0.26);
      ctx.lineTo(x + s * 0.5, y + s * 0.5);
      ctx.moveTo(x + s * 0.5, y + s * 0.5); ctx.lineTo(x + s * 0.62, y + s * 0.26);
      ctx.lineTo(x + s * 0.7, y + s * 0.5);
      ctx.stroke();
    } else if (kind === 'barracks') {
      // A bunk with a figure.
      ctx.strokeRect(x + 1, y + s * 0.55, s - 2, s * 0.4);
      ctx.beginPath(); ctx.arc(x + s * 0.28, y + s * 0.3, s * 0.14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.28, y + s * 0.44);
      ctx.lineTo(x + s * 0.28, y + s * 0.55);
      ctx.stroke();
    } else if (kind === 'slot') {
      // A hangar arch with a hull inside.
      ctx.beginPath();
      ctx.moveTo(x + 1, y + s - 1);
      ctx.lineTo(x + 1, y + s * 0.35);
      ctx.quadraticCurveTo(x + s / 2, y - s * 0.1, x + s - 1, y + s * 0.35);
      ctx.lineTo(x + s - 1, y + s - 1);
      ctx.stroke();
      ctx.fillRect(x + s * 0.28, y + s * 0.6, s * 0.44, s * 0.22);
    } else {
      // Cargo retrofit: a grid gaining a column.
      for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) {
          ctx.strokeRect(x + 1 + c * s * 0.26, y + 1 + r * s * 0.26, s * 0.22, s * 0.22);
        }
      }
      ctx.globalAlpha = 0.55;
      for (let r = 0; r < 3; r++) {
        ctx.strokeRect(x + 1 + 3 * s * 0.26, y + 1 + r * s * 0.26, s * 0.22, s * 0.22);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ── DISPATCH: THE JOBS OFFICE (update161) ──────────────────────────
   *
   * The old workshop (closed in 154 "for later"). jj (22.10) on the mock-up:
   * the offers on a board, the loading bay under it with what goes aboard at
   * launch, the job's sheet on the right; jobs replace the side objectives. A
   * click on a sheet picks it; TAKE / DROP on the sheet or the card. The model
   * is Base's (`jobs`, `takeJob`, `dropJob`); `dispatchRects()` is the one
   * geometry. Every crate is drawn at the hold's one size.
   */
  let _jobSel = 0;
  function dispatchRects() {
    const area = { x: 16, y: 62, w: 870, h: 530 }, card = { x: 894, y: 62, w: 370, h: 530 };
    const n = Math.max(1, Base.JOB_OFFERS ?? 3);
    const cw = Math.floor((area.w - 32 - (n - 1) * 14) / n);
    const cards = Array.from({ length: n }, (_, i) => {
      const x = area.x + 16 + i * (cw + 14), y = area.y + 40;
      return { i, x, y, w: cw, h: 270, btn: { x: x + 12, y: y + 270 - 36, w: cw - 24, h: 26 } };
    });
    return { area, card, cards, bay: { x: area.x + 16, y: area.y + 330, w: area.w - 32, h: 186 },
             act: { x: card.x + 14, y: card.y + 448, w: card.w - 28, h: 66 } };
  }
  /** Where its crates would go: the hold of the hull picked in the hangar. */
  function _jobHoldRoom() {
    if (!_hold) _buildHold();
    return _hold ? _hold.capacity - _hold.usedCells() : 0;
  }

  /** A passenger's face: bare, as he boards — not a man in a suit (update162). */
  function _vipFace(ctx, j, x, y, size) {
    const f = (typeof CrewArt !== 'undefined') ? CrewArt.portraitCanvas({ name: j.client, race: j.race ?? 'terra' }, { bare: true }) : null;
    if (!f) return;
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(f, x, y, size, size); ctx.restore();
  }

  /** A transport's men, bare faces on the orange of the jumpsuit, side by side (update163). */
  function _convictFaces(ctx, j, x, y, size) {
    const men = j.convicts ?? [], n = Math.max(1, men.length), s = n > 1 ? Math.floor(size * 0.62) : size;
    men.forEach((m, k) => {
      const fx = x + (n > 1 ? k * (size - s) : 0), fy = y + (n > 1 ? k * (size - s) : 0);
      ctx.fillStyle = '#7a3a10'; ctx.fillRect(fx, fy, s, s);
      const f = (typeof CrewArt !== 'undefined') ? CrewArt.portraitCanvas({ name: m.name, race: m.race ?? 'terra' }, { bare: true }) : null;
      if (f) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(f, fx, fy, s, s); ctx.restore(); }
      ctx.fillStyle = 'rgba(224,112,32,0.85)'; ctx.fillRect(fx, fy + s - Math.round(s * 0.18), s, Math.round(s * 0.18));
      ctx.strokeStyle = '#c9a6ff'; ctx.lineWidth = 1; ctx.strokeRect(fx + 0.5, fy + 0.5, s - 1, s - 1);
    });
  }
  /** Slabs the convicts on the board need, on the hull picked in the hangar. */
  function _jobSlabs() { return Base.slabsOf?.(Base.get().ships[_shipIdx]) ?? 0; }

  function _drawDispatch(ctx) {
    const R = dispatchRects(), A = R.area, C = R.card, COL = '#7ad0ff';
    const jobs = Base.jobs?.() ?? [];
    const F = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const T = (s, x, y, col, size, al = 'left', bold = false, font = 'Share Tech Mono') => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}, monospace`; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(s, x, y); };
    const P = (typeof LootScreen !== 'undefined' ? LootScreen.CELL : 36) + 4;
    const crate = (x, y, j) => { const it = new CargoItem('sealed_crate', { jobId: j?.id ?? null }); LootScreen.drawCargoItem(ctx, it, x, y, 1, false, false); return it; };
    if (_jobSel >= jobs.length) _jobSel = Math.max(0, jobs.length - 1);
    const taken = jobs.filter(j => j.taken), max = Base.JOB_MAX ?? 3;
    const missions = Base.missions?.() ?? [];
    const entry = Base.get().ships[_shipIdx], hull = entry ? (SHIP_CATALOG[entry.key]?.label ?? entry.key) : null;

    // ── the office wall and the board ──
    F(A.x, A.y, A.w, A.h, '#0a0e16');
    for (let x = A.x; x < A.x + A.w; x += 48) F(x, A.y, 1, A.h, 'rgba(122,208,255,0.05)');
    T('DISPATCH · CONTRACTS OUT OF LUNA', A.x + 16, A.y + 24, COL, 13, 'left', false, 'Orbitron');
    T(`${jobs.length} offers · new ones after every contract · take up to ${max} for your next run`, A.x + A.w - 16, A.y + 23, '#5f7893', 10, 'right');
    R.cards.forEach(c => {
      const j = jobs[c.i];
      if (!j) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = '#2a3a5a'; ctx.lineWidth = 1; ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1); ctx.setLineDash([]);
        T('new offers after your next contract', c.x + c.w / 2, c.y + c.h / 2, '#4a6080', 10, 'center');
        return;
      }
      const sel = c.i === _jobSel;
      F(c.x + 3, c.y + 4, c.w, c.h, 'rgba(0,0,0,0.4)');
      F(c.x, c.y, c.w, c.h, j.taken ? '#16261c' : '#121826');
      ctx.strokeStyle = sel ? '#ffd700' : j.taken ? '#1aff8c' : '#2a3a5a'; ctx.lineWidth = sel ? 2 : 1; ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
      F(c.x + c.w / 2 - 22, c.y - 6, 44, 12, '#5a6478');                       // the clip
      const vip = j.kind === 'vip', con = j.kind === 'convict', kc = vip ? '#4db8ff' : con ? '#c9a6ff' : '#ffd780';
      F(c.x, c.y, c.w, 26, vip ? 'rgba(77,184,255,0.12)' : con ? 'rgba(201,166,255,0.12)' : 'rgba(255,215,128,0.12)');
      T(vip ? 'PASSENGER' : con ? 'PRISONERS' : 'SEALED CARGO', c.x + 12, c.y + 18, kc, 12, 'left', true);
      if (j.taken) T('✓ TAKEN', c.x + c.w - 12, c.y + 18, '#1aff8c', 11, 'right', true);
      F(c.x + 12, c.y + 36, 96, 96, 'rgba(8,12,22,0.95)');
      if (vip) _vipFace(ctx, j, c.x + 14, c.y + 38, 92);
      else if (con) _convictFaces(ctx, j, c.x + 14, c.y + 38, 92);
      else {
        crate(c.x + 12 + Math.round((96 - (2 * P - 4)) / 2), c.y + 36 + Math.round((96 - (P - 4)) / 2), j);
        T(`×${j.crates}`, c.x + 104, c.y + 128, '#ffd780', 12, 'right', true);
      }
      T(_clip(ctx, j.client, c.w - 130), c.x + 118, c.y + 52, '#e8f4ff', 11, 'left', true);
      T('deliver to', c.x + 118, c.y + 72, '#5f7893', 10);
      const where = Base.jobWhere(j).split(', ');
      T(where[0], c.x + 118, c.y + 86, '#e8f4ff', 11);
      T(`in ${where[1]}`, c.x + 118, c.y + 100, '#e8f4ff', 11);
      T(`${j.pay} CC`, c.x + 118, c.y + 126, '#1aff8c', 17, 'left', true);
      T(`fine ${j.fine} CC if it fails`, c.x + 12, c.y + 152, '#ff7c20', 10);
      const nc = j.convicts?.length ?? 0;
      T(vip ? 'a seat on the bridge' : con ? `${nc} convict${nc > 1 ? 's' : ''} · ${nc} carbonite slab${nc > 1 ? 's' : ''}`
            : `${j.crates} sealed crate${j.crates > 1 ? 's' : ''} · ${j.crates * 2} cells of the hold`,
        c.x + 12, c.y + 172, '#a8b8cc', 10);
      if (vip) T('eats with the crew · has HP', c.x + 12, c.y + 186, '#a8b8cc', 10);
      if (con) T('frozen · no power and they work the door', c.x + 12, c.y + 186, '#a8b8cc', 10);
      T(`needs a run of ${j.sector}+ sector${j.sector > 1 ? 's' : ''}`, c.x + 12, c.y + (vip || con ? 206 : 192), '#7a90a8', 10);
      _zones.push({ x: c.x, y: c.y, w: c.w, h: c.h - 44, act: 'jobPick', arg: c.i });
      const full = !j.taken && taken.length >= max;
      _btn(ctx, c.btn.x, c.btn.y, c.btn.w, c.btn.h, j.taken ? 'DROP IT' : full ? `${max} JOBS ALREADY` : 'TAKE THE JOB',
           { act: full ? null : j.taken ? 'jobDrop' : 'jobTake', arg: j.id, enabled: !full, col: j.taken ? '#7a90a8' : '#1aff8c', font: '11px Share Tech Mono, monospace' });
    });

    // ── the loading bay: what goes aboard at launch ──
    const L = R.bay;
    F(L.x, L.y, L.w, L.h, '#10141c'); F(L.x, L.y, L.w, 3, '#ffd700');
    for (let x = L.x; x < L.x + L.w; x += 24) { ctx.fillStyle = (x / 24) % 2 ? '#ffd700' : '#10141c'; ctx.beginPath(); ctx.moveTo(x, L.y + 3); ctx.lineTo(x + 12, L.y + 3); ctx.lineTo(x + 6, L.y + 9); ctx.lineTo(x - 6, L.y + 9); ctx.fill(); }
    T('LOADING BAY — GOES ABOARD AT LAUNCH', L.x + 12, L.y + 30, '#ffd780', 11, 'left', true);
    const cells = taken.reduce((n, j) => n + j.crates * 2, 0);
    T(`${taken.length} of ${max} jobs · ${cells} hold cells`, L.x + L.w - 12, L.y + 30, '#7a90a8', 10, 'right');
    if (!taken.length) T('Nothing yet — take a job on the board above.', L.x + 12, L.y + 70, '#4a6080', 11);
    let bx = L.x + 16;
    taken.forEach(j => {
      const w = Math.max(j.crates * (2 * P + 4), j.kind === 'vip' ? 200 : 240);
      if (j.kind === 'vip') {                                       // he waits at the gangway, bag in hand
        F(bx + 6, L.y + 86, 40, 26, '#3a5a8a'); F(bx + 6, L.y + 86, 40, 3, '#5a8aba');
        _vipFace(ctx, j, bx, L.y + 42, 52);
        F(bx + 52, L.y + 96, 18, 14, '#5a4630'); F(bx + 57, L.y + 92, 8, 4, '#3e2e1e');
      }
      if (j.kind === 'convict') {                                   // in irons at the gangway, a guard's slab each (update163)
        (j.convicts ?? []).forEach((m, k) => {
          const sx = bx + k * 58;
          F(sx, L.y + 40, 50, 66, '#5a6478'); F(sx + 4, L.y + 44, 42, 58, 'rgba(127,212,255,0.25)');
          const f = (typeof CrewArt !== 'undefined') ? CrewArt.portraitCanvas({ name: m.name, race: m.race ?? 'terra' }, { bare: true, asleep: true }) : null;
          if (f) { ctx.save(); ctx.globalAlpha = 0.7; ctx.imageSmoothingEnabled = false; ctx.drawImage(f, sx + 5, L.y + 48, 40, 40); ctx.restore(); }
          F(sx + 5, L.y + 88, 40, 10, 'rgba(224,112,32,0.6)'); F(sx + 23, L.y + 100, 4, 2, '#9fe8ff');
        });
      }
      for (let k = 0; k < j.crates; k++) crate(bx + k * (2 * P + 4), L.y + 56, j);
      T(_clip(ctx, j.client, w), bx, L.y + 116, '#c8d8f0', 10, 'left', true);
      T(_clip(ctx, `→ ${Base.jobWhere(j)}`, w), bx, L.y + 130, '#a8b8cc', 10);
      bx += w + 20;
    });

    // ── THE SHEET ──
    F(C.x, C.y, C.w, C.h, 'rgba(8,12,22,0.95)'); F(C.x, C.y, 3, C.h, COL);
    ctx.strokeStyle = COL + '66'; ctx.lineWidth = 1; ctx.strokeRect(C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1);
    const j = jobs[_jobSel];
    T('THE JOB', C.x + 16, C.y + 24, COL, 12, 'left', false, 'Orbitron');
    if (!j) { T('No offers on the board.', C.x + 16, C.y + 50, '#7a90a8', 11); return; }
    const vip = j.kind === 'vip', con = j.kind === 'convict', nc = j.convicts?.length ?? 0;
    T(_clip(ctx, `${vip ? 'PASSENGER' : con ? 'PRISONERS' : 'SEALED CARGO'} · ${j.client}`, C.w - 32), C.x + 16, C.y + 50, '#e8f4ff', 13, 'left', true);
    ctx.font = '11px Share Tech Mono, monospace'; ctx.fillStyle = '#a8b8cc'; ctx.textAlign = 'left';
    _wrap(ctx, vip ? `Rides on the bridge — no post, no orders. Feed him with the crew, keep the air in and the boarders off: a dead passenger is the dearest failed job.`
             : con ? `${(j.convicts ?? []).map(m => m.name).join(' and ')}, frozen in your carbonite bay. Keep it powered — a slab gone cold is a cell door he starts working, and a man out of the airlock is on the WANTED board.`
                   : `${j.crates} crate${j.crates > 1 ? 's' : ''} under seal. Do not open them, do not sell them — the seals are checked at the door, and a crate left behind is a failed job.`,
          C.x + 16, C.y + 72, C.w - 32, 14, 4);
    [['deliver to', Base.jobWhere(j), '#e8f4ff'], ['pays', `${j.pay} CC on delivery`, '#1aff8c'],
     ['if it fails', `fine ${j.fine} CC · karma ${Base.jobKarma ? Base.jobKarma(j) : vip ? Base.VIP_KARMA : Base.JOB_KARMA}`, '#ff7c20'],
     ['fails when', vip ? 'he dies, or he comes home with you' : con ? 'one gets away, or they come home' : 'a crate is lost, or it comes home', '#a8b8cc']]
      .forEach(([k, v, c], i) => { T(k, C.x + 16, C.y + 146 + i * 22, '#5f7893', 10); T(_clip(ctx, v, C.w - 126), C.x + 110, C.y + 146 + i * 22, c, 11); });
    T('WILL IT FIT', C.x + 16, C.y + 252, '#5f7893', 11);
    const room = _jobHoldRoom(), need = j.crates * 2, food = _hold?.countOf?.('food') ?? 0;
    const reach = missions.filter(m => (m.sectors ?? 1) >= j.sector).map(m => m.label);
    const short = missions.filter(m => (m.sectors ?? 1) < j.sector).map(m => m.label);
    const slabs = _jobSlabs(), slabNeed = jobs.filter(x => x.taken && x.id !== j.id).reduce((n, x) => n + (Base.convictsOf?.(x) ?? 0), 0) + nc;
    const fit = [vip ? [!!hull, hull ? `a seat on the ${hull}'s bridge` : 'no hull in the hangar']
               : con ? [!!hull && slabs >= slabNeed, !hull ? 'no hull in the hangar' : slabs ? `the ${hull}'s carbonite bay: ${slabs} slab${slabs > 1 ? 's' : ''}, ${slabNeed} needed` : `the ${hull} has no carbonite bay — fit one at a drydock`]
                     : [room >= need, hull ? `the ${hull}'s hold: ${room} cells free, ${need} needed` : 'no hull in the hangar'],
                 ...(vip ? [[food > 0 ? true : null, food > 0 ? `${food} rations packed — he eats with the crew` : 'no rations packed yet — he eats with the crew']] : []),
                 [reach.length > 0, !reach.length ? 'no contract reaches it' : !short.length ? `every contract reaches sector ${j.sector}`
                   : short.length <= reach.length ? _clip(ctx, `every contract but the ${short.join(' and the ')} reaches sector ${j.sector}`, C.w - 52)
                   : _clip(ctx, `only the ${reach.join(' and the ')} reach${reach.length === 1 ? 'es' : ''} sector ${j.sector}`, C.w - 52)],
                 ...(short.length ? [[null, _clip(ctx, `${short.join(', ')}: too short — it waits for a longer run`, C.w - 52)]] : [])];
    fit.forEach(([okk, s], i) => {
      T(okk === true ? '✓' : okk === false ? '✗' : '!', C.x + 18, C.y + 274 + i * 18, okk === true ? '#1aff8c' : okk === false ? '#ff5566' : '#ffb020', 11, 'left', true);
      T(s, C.x + 34, C.y + 274 + i * 18, '#c8d8f0', 10);
    });
    T('ON YOUR NEXT RUN', C.x + 16, C.y + 352, '#5f7893', 11);
    T(`${taken.length} of ${max} jobs taken`, C.x + 16, C.y + 372, '#e8f4ff', 12);
    const hs = Save.hunts?.() ?? [];
    if (hs.length) T(`+ ${hs.length} hunt${hs.length > 1 ? 's' : ''} (WANTED)`, C.x + 16, C.y + 390, '#ff9a4d', 11);
    const full = !j.taken && taken.length >= max;
    _btn(ctx, R.act.x, R.act.y, R.act.w, R.act.h, j.taken ? 'DROP THIS JOB' : full ? `${max} JOBS ALREADY` : 'TAKE THIS JOB',
         { act: full ? null : j.taken ? 'jobDrop' : 'jobTake', arg: j.id, enabled: !full, col: j.taken ? '#c8d8f0' : '#1aff8c',
           font: '14px Orbitron, monospace', sub: j.taken ? 'no fine before you launch' : full ? 'drop one first' : con ? 'into your slabs at launch' : vip ? 'he boards at launch' : 'its crates go aboard at launch' });
  }


  /** Wrap `text` and RETURN the y of the last line drawn, so callers can
   *  lay out underneath it instead of guessing and overlapping. */
  /**
   * The bottom bar: pick a contract, then GO.
   *
   * The manifest and a THIRD "PACK HOLD" button used to live here too,
   * which meant SUPPLY showed three buttons that all opened the same
   * screen. The manifest moved into the THIS LAUNCH card where it
   * belongs (next to the hold it describes); this bar is the contract
   * choice and the button that commits it.
   */
  /* ══ THE LOADOUT (update113) ══════════════════════════════════════════
   *
   * jj, 11.10: "na wzór Diablo czy Arc Raiders — na środku statek, z lewej
   * magazyn, z prawej magazyn statku, wszystko można przerzucić; broń też
   * pokazana, żeby można ją dodać". It replaces the briefing of update111
   * (the small hold and its +/− buttons went with it).
   *
   *   LEFT    the base warehouse (filters, scrolls as it grows) and the
   *           armoury rack — the gun crates on that same shelf, as cards
   *   CENTRE  the mounts, the hull at 1:1 with the crew at their posts,
   *           ON BOARD: commander, animal, crew
   *   RIGHT   the ship's hold, and who stays home (barracks and mess)
   *
   * EVERYTHING MOVES THE SAME WAY: click to take it into the hand, click
   * where it goes — or hold the button and drag. Double-click sends it to
   * the other side. Right-click or ESC puts it back. A crewman dropped on a
   * room of the ship is POSTED there (jj: "tak, dobry pomysł").
   *
   * Nothing here owns a second copy of anything: the shelf is liveShelf(),
   * the hold is _hold, the guns are Base's, the people are _picked /
   * _commanderId / _petId — the same variables the tabs set.
   */
  const LO_P = () => (LootScreen.CELL + LootScreen.GAP);

  /** ONE source for the loadout geometry: the drawing, the hit tests and the tests read it. */
  function _loRects(W = Renderer.getWidth(), H = Renderer.getHeight()) {
    const b = Base.get();
    const P = LO_P();
    const store = liveShelf();
    const svc = Math.min(store?.cols ?? 8, 8), svr = Math.min(store?.rows ?? 6, 6);
    const hvc = Math.min(_hold?.cols ?? 5, 8), hvr = Math.min(_hold?.rows ?? 3, 5);
    const slots = Base.shipSlotCount?.(_shipIdx) ?? 0;
    const mW = 496 - 24, mGap = 8;
    const slotW = slots ? Math.floor((mW - mGap * (slots - 1)) / slots) : mW;
    return {
      shelfPanel: { x: 16, y: 50, w: 360, h: 342 },
      filters:    { x: 28, y: 82, w: 44, h: 18, gap: 4 },
      shelf:      { x: 30, y: 110, vc: svc, vr: svr, w: svc * P - LootScreen.GAP, h: svr * P - LootScreen.GAP },
      rackPanel:  { x: 16, y: 400, w: 360, h: 242 },
      rack:       { x: 28, y: 432, w: 324, h: 64, pitch: 68, vis: 3 },
      holdPanel:  { x: 904, y: 50, w: 360, h: 262 },
      hold:       { x: 936, y: 84, vc: hvc, vr: hvr, w: hvc * P - LootScreen.GAP, h: hvr * P - LootScreen.GAP },
      barrPanel:  { x: 904, y: 320, w: 360, h: 322 },
      barr:       { x: 916, y: 352, w: 324, h: 60, pitch: 64, vis: 4 },
      mountPanel: { x: 392, y: 50, w: 496, h: 76 },
      mounts: Array.from({ length: slots }, (_, i) => ({ x: 404 + i * (slotW + mGap), y: 78, w: slotW, h: 38, slot: i })),
      stage:      { x: 392, y: 134, w: 496, h: 330 },
      deckPanel:  { x: 392, y: 472, w: 496, h: 170 },
      cmdSlot:    { x: 404, y: 504, w: 300, h: 60 },
      petSlot:    { x: 712, y: 504, w: 164, h: 60 },
      crewArea:   { x: 404, y: 570, w: 472, h: 68 },
      footer:     { x: 0, y: 650, w: W, h: H - 650 },
      checks:     { x: 24, y: 662, w: 700, h: 46 },
      back:       { x: 760, y: 662, w: 150, h: 46 },
      start:      { x: 922, y: 662, w: 342, h: 46 },
      _b: b,
    };
  }

  /* ── what the hold carries, in plain numbers (the bar under the tabs reads it too) ── */
  function _holdCounts() {
    const c = { fuel: 0, missiles: 0, heal: 0, food: 0, used: 0, cap: 0 };
    if (!_hold) return c;
    c.used = _hold.usedCells(); c.cap = _hold.capacity;
    ['fuel', 'missiles', 'heal', 'food'].forEach(k => { c[k] = _hold.countOf(k); });
    return c;
  }

  /** The launch as it stands, in words — the bar under the tabs reads this. */
  function _briefSummary() {
    const b = Base.get();
    const m = Base.missions().find(x => x.id === _mission) || null;
    const entry = b.ships[_shipIdx];
    const cap = _commanderId ? Base.commanderById?.(_commanderId) : null;
    const crew = Base.crew().filter(c => _picked.has(c.id)).length;
    const h = _holdCounts();
    return {
      mission: m, missionClosed: !!(m && typeof missionRefusal === 'function' && missionRefusal(m)),
      ship: entry ? (SHIP_CATALOG[entry.key]?.label ?? entry.key) : null,
      commander: cap ? `${cap.name} · L${cap.level}` : null,
      crew, used: h.used, cap: h.cap, fuel: h.fuel, missiles: h.missiles, heal: h.heal, food: h.food,
    };
  }

  /**
   * THE CHECKLIST — worst first. 'bad' = it will hurt (or cannot start),
   * 'warn' = think about it, 'ok' = said so you know it was looked at.
   * Nothing here BLOCKS except what Base.launch itself refuses. The
   * contract is chosen on the next screen, so it is not checked here.
   */
  function _briefingChecks() {
    const b = Base.get();
    const out = [];
    const S = _briefSummary();
    if (!b.ships[_shipIdx]) out.push({ level: 'bad', text: 'No ship in the hangar.' });
    if (typeof Save !== 'undefined' && Save.hasShipInFlight?.())
      out.push({ level: 'bad', text: 'A contract is still out there — starting writes it off.' });
    if (!S.fuel) out.push({ level: 'bad', text: 'No He2 in the hold — the ship cannot jump.' });
    else if (S.fuel < 3) out.push({ level: 'warn', text: `Only ${S.fuel} He2 packed — you may strand.` });
    const picked = Base.crew().filter(c => _picked.has(c.id));
    const hurt = picked.filter(c => _crewHp(c).pct <= 0.3).length;
    if (hurt) out.push({ level: 'warn', text: `${hurt} wounded crew coming along.` });
    const sick = picked.filter(c => _crewPlague(c)).length;
    if (sick) out.push({ level: 'warn', text: `${sick} infected crew coming along.` });
    if (!S.heal && (liveShelf()?.countOf('heal') ?? 0) > 0)
      out.push({ level: 'warn', text: 'Medkits on the shelf, none packed.' });
    if (!S.food) out.push({ level: 'warn', text: 'No rations packed.' });
    if (!picked.length) out.push({ level: 'warn', text: 'Nobody aboard — green recruits sign on.' });
    /* THE JOBS FROM DISPATCH (update161): the ones this run reaches go aboard,
       their sealed crates need the room; the rest wait at the board. */
    {
      const taken = (Base.jobs?.() ?? []).filter(j => j.taken), reach = MISSIONS[_mission]?.sectors ?? 1;
      const going = taken.filter(j => j.sector <= reach), wait = taken.length - going.length;
      const need = going.reduce((n, j) => n + j.crates * 2, 0), free = _hold ? _hold.capacity - _hold.usedCells() : 0;
      if (going.length && free < need) out.push({ level: 'bad', text: `No room for the sealed crates — ${need} cells needed, ${free} free.` });
      else if (going.length) out.push({ level: 'ok', text: `${going.length} job${going.length > 1 ? 's' : ''} aboard${need ? ` — ${need} cells kept for the crates` : ''}.` });
      const men = going.reduce((n, j) => n + (Base.convictsOf?.(j) ?? 0), 0), slabs = _jobSlabs();
      if (men && slabs < men) out.push({ level: 'bad', text: `${men} convict${men > 1 ? 's' : ''} to carry, ${slabs} carbonite slab${slabs === 1 ? '' : 's'} on this hull.` });
      else if (men) out.push({ level: 'warn', text: `${men} convict${men > 1 ? 's' : ''} in the slabs — keep the carbonite bay powered.` });
      const vips = going.filter(j => j.kind === 'vip');
      if (vips.length && !S.food) out.push({ level: 'warn', text: `${vips[0].client} eats with the crew — no rations packed.` });
      if (wait) out.push({ level: 'warn', text: `${wait} job${wait > 1 ? 's wait' : ' waits'} at DISPATCH — ${MISSIONS[_mission]?.label ?? 'this run'} does not reach ${wait > 1 ? 'their' : 'its'} sector.` });
    }
    if (!S.commander) out.push({ level: 'ok', text: 'No commander — the contract flies without one.' });
    if (S.fuel >= 3) out.push({ level: 'ok', text: `He2 ${S.fuel} packed.` });
    if (!out.length) out.push({ level: 'ok', text: 'Ready. Everything checks out.' });
    const rank = { bad: 0, warn: 1, ok: 2 };
    return out.sort((a, c) => rank[a.level] - rank[c.level]);
  }

  /* ── filters on the shelf: they grey out, they never move anything ── */
  const LO_FILTERS = ['ALL', 'FUEL', 'AMMO', 'FOOD', 'MED', 'GUNS', 'LOOT'];
  function _filterHides(it) {
    const k = it.def.kind;
    switch (_filter) {
      case 'FUEL': return k !== 'fuel';
      case 'AMMO': return k !== 'missiles' && k !== 'torpedo' && k !== 'torpedoes';
      case 'FOOD': return k !== 'food';
      case 'MED':  return k !== 'heal' && k !== 'cure';   // the serum is medicine too (update133)
      case 'GUNS': return k !== 'weapon';
      case 'LOOT': return ['fuel', 'missiles', 'torpedo', 'torpedoes', 'food', 'heal', 'cure', 'weapon'].includes(k);
      default:     return false;
    }
  }

  /** The window onto the shelf, clamped to what exists. */
  function _shelfWin(R = _loRects()) {
    const g = liveShelf();
    _shelfView.x = Utils.clamp(_shelfView.x, 0, Math.max(0, (g?.cols ?? 0) - R.shelf.vc));
    _shelfView.y = Utils.clamp(_shelfView.y, 0, Math.max(0, (g?.rows ?? 0) - R.shelf.vr));
    return { sx: _shelfView.x, sy: _shelfView.y, vc: R.shelf.vc, vr: R.shelf.vr };
  }
  function _holdWin(R = _loRects()) { return { sx: 0, sy: 0, vc: R.hold.vc, vr: R.hold.vr }; }

  /** The grid cell under a point — { which, grid, cx, cy } or null. */
  function _loCellAt(mx, my, R = _loRects()) {
    const P = LO_P();
    const tries = [['shelf', liveShelf(), R.shelf, _shelfWin(R)], ['hold', _hold, R.hold, _holdWin(R)]];
    for (const [which, g, r, v] of tries) {
      if (!g || !Utils.pointInRect(mx, my, r.x, r.y, r.w, r.h)) continue;
      const cx = Math.floor((mx - r.x) / P) + v.sx, cy = Math.floor((my - r.y) / P) + v.sy;
      if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) continue;
      return { which, grid: g, cx, cy };
    }
    return null;
  }

  /** The preview ship's room under a point (the hull drawn in the stage). */
  function _loRoomAt(mx, my) {
    const R = _loRects();
    if (!Utils.pointInRect(mx, my, R.stage.x, R.stage.y, R.stage.w, R.stage.h)) return null;
    const sh = _preview;
    if (!sh) return null;
    return sh.rooms.find(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) || null;
  }

  /* ── THE ROOF OF THE SHIP IN THE PICTURE (update128) ─────────────────
   * jj: "co do broni zrób podobnie — można dwa razy kliknąć lub przenieść
   * broń na slot na statku, na dachu". The guns are drawn on the hull's
   * roof; that roof is a place to drop one too. On a fitted gun: that
   * mount. Anywhere else along the roof: the first free mount.
   * Returns { slot } (slot null = first free), or null off the roof. */
  function _loRoofAt(mx, my) {
    const R = _loRects();
    if (!Utils.pointInRect(mx, my, R.stage.x, R.stage.y, R.stage.w, R.stage.h)) return null;
    const sh = _preview;
    if (!sh) return null;
    const m = (sh.weaponMounts?.() ?? []).find(q => Utils.pointInRect(mx, my, q.x - 2, q.y - 10, q.w + 4, q.h + 14));
    if (m) return { slot: m.weapon.slot ?? sh.weapons.indexOf(m.weapon), rect: m };
    const r = _loRoofBand(sh);
    return r && Utils.pointInRect(mx, my, r.x, r.y, r.w, r.h) ? { slot: null, rect: null } : null;
  }

  /** The strip over the hull where its guns stand. */
  function _loRoofBand(sh) {
    if (!sh?.roomBounds) return null;
    const b = sh.roomBounds();
    const M = (typeof HULL_GRID !== 'undefined') ? HULL_GRID.MARGIN : 10;
    return { x: b.x, y: b.y - M - 30, w: b.w, h: 30 + 2 * M };
  }

  /* ── THE HAND ─────────────────────────────────────────────────────── */

  function _loDrop(mx, my) {
    const h = _hand;
    if (!h) return false;
    const R = _loRects();
    const P = LO_P();
    if (h.kind === 'cargo') {
      const it = h.item;
      // On a container of its own kind: pour it in.
      const c = _loCellAt(mx, my, R);
      if (c) {
        const target = c.grid.at(c.cx, c.cy);
        if (target && CargoGrid.canMerge(it, target)) {
          CargoGrid.merge(it, target);
          if (it.qty <= 0) { _hand = null; _sel = target; }
          _commitPack();
          return true;
        }
      }
      for (const [g, r, v] of [[liveShelf(), R.shelf, _shelfWin(R)], [_hold, R.hold, _holdWin(R)]]) {
        if (!g || !Utils.pointInRect(mx, my, r.x - LootScreen.CELL, r.y - LootScreen.CELL,
                                     r.w + LootScreen.CELL * 2, r.h + LootScreen.CELL * 2)) continue;
        const gx = Math.round((mx - LootScreen.CELL / 2 - r.x) / P) + v.sx;
        const gy = Math.round((my - LootScreen.CELL / 2 - r.y) / P) + v.sy;
        if (!g.fits(it, gx, gy)) continue;
        g.place(it, gx, gy);
        _hand = null; _sel = it;
        _commitPack();
        return true;
      }
      _say('It will not go there — right-click puts it back.', false);
      return false;
    }
    if (h.kind === 'gun') {
      let m = R.mounts.find(z => Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h));
      // the roof of the ship in the picture (update128)
      const roof = !m ? _loRoofAt(mx, my) : null;
      if (roof) {
        if (roof.slot != null) m = { slot: roof.slot };
        else {
          const free = R.mounts.find(z => !Base.shipWeapons(_shipIdx).some(f => f.slot === z.slot));
          if (free) m = { slot: free.slot };
          else if (h.from === 'rack') { _say('Every mount on her is taken — drop it on a gun to swap.', false); _hand = null; return false; }
        }
      }
      if (h.from === 'rack' && m) {
        // A gun already on that mount comes off first — onto the shelf.
        const fitted = Base.shipWeapons(_shipIdx).find(f => f.slot === m.slot);
        const key = Base.armoury()[h.index];
        if (fitted) {
          const off = Base.uninstallWeapon(_shipIdx, m.slot);
          if (!off.ok) { _say(off.message, false); _hand = null; return false; }
        }
        // the index may have moved when the old gun went onto the shelf
        const idx = Base.armoury().indexOf(key);
        const r = Base.installWeapon(_shipIdx, idx >= 0 ? idx : h.index, m.slot);
        _say(r.message, r.ok);
        _hand = null; _syncStore(); _buildHold();
        return r.ok;
      }
      if (h.from === 'mount' && Utils.pointInRect(mx, my, R.rackPanel.x, R.rackPanel.y, R.rackPanel.w, R.rackPanel.h)) {
        const r = Base.uninstallWeapon(_shipIdx, h.slot);
        _say(r.message, r.ok);
        _hand = null; _syncStore(); _buildHold();
        return r.ok;
      }
      if (h.from === 'mount' && m && m.slot !== h.slot) {
        // mount to mount: off onto the shelf, then onto the chosen mount
        const key = Base.shipWeapons(_shipIdx).find(f => f.slot === h.slot)?.defKey;
        const occupied = Base.shipWeapons(_shipIdx).some(f => f.slot === m.slot);
        if (key && !occupied) {
          const off = Base.uninstallWeapon(_shipIdx, h.slot);
          if (off.ok) {
            const r = Base.installWeapon(_shipIdx, Base.armoury().indexOf(key), m.slot);
            _say(r.message, r.ok);
          } else _say(off.message, false);
        }
        _hand = null; _syncStore(); _buildHold();
        return true;
      }
      _hand = null;
      return false;
    }
    if (h.kind === 'crew') {
      const room = _loRoomAt(mx, my);
      if (room) {
        _picked.add(h.id);
        _posts[h.id] = room.id;
        _hand = null;
        return true;
      }
      if (Utils.pointInRect(mx, my, R.deckPanel.x, R.deckPanel.y, R.deckPanel.w, R.deckPanel.h)) {
        _picked.add(h.id); _hand = null; return true;
      }
      if (Utils.pointInRect(mx, my, R.barrPanel.x, R.barrPanel.y, R.barrPanel.w, R.barrPanel.h)) {
        _picked.delete(h.id); delete _posts[h.id]; _hand = null; return true;
      }
      _hand = null;
      return false;
    }
    return false;
  }

  /** Whatever is in the hand goes back where it came from. Never dropped. */
  function _loReturn() {
    const h = _hand;
    if (!h) return true;
    if (h.kind === 'cargo') {
      const it = h.item;
      it.rot = h.homeRot;
      if (!(h.from.place(it, h.homeX, h.homeY) || h.from.autoPlace(it))) {
        const other = h.from === _hold ? liveShelf() : _hold;
        if (!other?.autoPlace(it)) return false;      // stays in the hand
      }
      _commitPack();
    }
    _hand = null;
    return true;
  }

  /** The crate in the hand goes straight to the other grid (double-click). */
  function _loQuickMove() {
    const h = _hand;
    if (!h || h.kind !== 'cargo') return false;
    const it = h.item, to = h.from === _hold ? liveShelf() : _hold;
    for (const target of to.items) {
      if (!CargoGrid.canMerge(it, target)) continue;
      CargoGrid.merge(it, target);
      if (it.qty <= 0) { _hand = null; _commitPack(); return true; }
    }
    if (to.autoPlace(it)) { _hand = null; _sel = it; _commitPack(); return true; }
    _loReturn();
    _say(to === _hold ? 'The hold is full.' : 'No room on the shelf.', false);
    return false;
  }

  /** Take what is under the cursor into the hand. */
  function _loPick(mx, my) {
    const R = _loRects();
    const c = _loCellAt(mx, my, R);
    if (c) {
      const it = c.grid.at(c.cx, c.cy);
      if (!it) return false;
      c.grid.remove(it);
      _hand = { kind: 'cargo', item: it, from: c.grid, homeX: it.x, homeY: it.y, homeRot: it.rot };
      _sel = it;
      return true;
    }
    for (const z of R.mounts) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      const f = Base.shipWeapons(_shipIdx).find(g => g.slot === z.slot);
      if (!f) return false;
      _hand = { kind: 'gun', from: 'mount', slot: z.slot, key: f.defKey };
      return true;
    }
    // …or a gun off the roof of the ship in the picture (update128)
    {
      const roof = _loRoofAt(mx, my);
      const f = roof?.slot != null ? Base.shipWeapons(_shipIdx).find(g => g.slot === roof.slot) : null;
      if (f) { _hand = { kind: 'gun', from: 'mount', slot: roof.slot, key: f.defKey }; return true; }
    }
    const rack = Base.armoury();
    for (let vi = 0; vi < R.rack.vis; vi++) {
      const i = _rackScroll + vi;
      if (i >= rack.length) break;
      const ry = R.rack.y + vi * R.rack.pitch;
      if (Utils.pointInRect(mx, my, R.rack.x, ry, R.rack.w, R.rack.h)) {
        _hand = { kind: 'gun', from: 'rack', index: i, key: rack[i] };
        return true;
      }
    }
    // a man staying home, or a man on deck
    for (const z of _loBarrZones(R)) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      if (z.cmd) { _commanderId = z.id; return 'seat'; }       // a commander is seated by a click
      _hand = { kind: 'crew', from: 'barracks', id: z.id };
      return true;
    }
    for (const z of _loDeckZones(R)) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      _hand = { kind: 'crew', from: 'deck', id: z.id };
      return true;
    }
    return false;
  }

  /** Who stays home, in list order: hands first, then commanders not seated. */
  function _loHomeList() {
    const hands = Base.crew().filter(c => !_picked.has(c.id));
    const caps = (Base.commanders?.() ?? []).filter(c => !c.away && c.id !== _commanderId);
    return [...hands.map(c => ({ rec: c, cmd: false })), ...caps.map(c => ({ rec: c, cmd: true }))];
  }
  function _loBarrZones(R = _loRects()) {
    const list = _loHomeList();
    _barrScroll = Utils.clamp(_barrScroll, 0, Math.max(0, list.length - R.barr.vis));
    return list.slice(_barrScroll, _barrScroll + R.barr.vis).map((e, i) => ({
      x: R.barr.x, y: R.barr.y + i * R.barr.pitch, w: R.barr.w, h: R.barr.h, id: e.rec.id, cmd: e.cmd, rec: e.rec,
    }));
  }
  function _loDeckZones(R = _loRects()) {
    const aboard = Base.crew().filter(c => _picked.has(c.id));
    const cols = aboard.length > 4 ? 3 : 2;
    const gap = 6, w = Math.floor((R.crewArea.w - gap * (cols - 1)) / cols), h = 32;
    const vis = cols * 2;
    _deckScroll = Utils.clamp(_deckScroll, 0, Math.max(0, Math.ceil((aboard.length - vis) / cols)));
    return aboard.slice(_deckScroll * cols, _deckScroll * cols + vis).map((c, i) => ({
      x: R.crewArea.x + (i % cols) * (w + gap), y: R.crewArea.y + Math.floor(i / cols) * (h + 2),
      w, h, id: c.id, rec: c,
    }));
  }

  /** Mouse and keys while the loadout is open. Returns an action or null. */
  function _loUpdate(dt) {
    _loClock += dt;
    const mx = Input.mouse.x, my = Input.mouse.y;
    const R = _loRects();

    if (Input.isPressed('KeyR') && _hand?.kind === 'cargo') {
      const it = _hand.item; it.rot = (it.rot + 1) % 4;
    }
    if ((Input.mouse.rightPressed || Input.isPressed('Escape')) && _hand) { _loReturn(); return null; }
    if (Input.isPressed('Escape')) { _screen = null; return null; }
    if (Input.isPressed('Enter') || Input.isPressed('NumpadEnter')) { if (!_hand) return _act('toDest'); }

    const wheel = Input.mouse.scrollDelta || 0;
    if (wheel) {
      const step = wheel > 0 ? 1 : -1;
      if (Utils.pointInRect(mx, my, R.shelfPanel.x, R.shelfPanel.y, R.shelfPanel.w, R.shelfPanel.h)) {
        const g = liveShelf();
        if (g && g.rows > R.shelf.vr) _shelfView.y += step; else _shelfView.x += step;
        _shelfWin(R);
      } else if (Utils.pointInRect(mx, my, R.rackPanel.x, R.rackPanel.y, R.rackPanel.w, R.rackPanel.h)) {
        _rackScroll = Utils.clamp(_rackScroll + step, 0, Math.max(0, Base.armoury().length - R.rack.vis));
      } else if (Utils.pointInRect(mx, my, R.barrPanel.x, R.barrPanel.y, R.barrPanel.w, R.barrPanel.h)) {
        _barrScroll += step; _loBarrZones(R);
      } else if (Utils.pointInRect(mx, my, R.deckPanel.x, R.deckPanel.y, R.deckPanel.w, R.deckPanel.h)) {
        _deckScroll += step; _loDeckZones(R);
      }
      return null;
    }

    /* A HELD DRAG: the button went down on something and came up somewhere
       else, more than a few pixels away — that is a drop. A plain click
       (down and up on the spot) leaves the thing in the hand. */
    if (Input.mouse.leftReleased && _hand && _press &&
        Math.hypot(mx - _press.x, my - _press.y) > 8) {
      _press = null;
      _loDrop(mx, my);
      return null;
    }
    if (Input.mouse.leftReleased) _press = null;
    if (!Input.mouse.leftPressed) return null;

    // Buttons and other zones win over the grids.
    for (const z of _zones) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      if (_hand && !['scrollShelf', 'loFilter'].includes(z.act)) break;     // a hand drops, it does not press
      Audio.sfx.uiClick?.();
      return _act(z.act, z.arg);
    }
    if (_hand) {
      // Double-click on the spot it came from sends a crate across.
      if (_hand.kind === 'cargo' && _loClock - _lastPick <= 0.35) {
        const c = _loCellAt(mx, my, R);
        if (c && c.grid === _hand.from &&
            c.cx >= _hand.homeX && c.cx < _hand.homeX + _hand.item.w &&
            c.cy >= _hand.homeY && c.cy < _hand.homeY + _hand.item.h) { _loQuickMove(); return null; }
      }
      if (_hand.kind === 'gun' && _hand.from === 'rack' && _loClock - _lastPick <= 0.35) {
        // double-click on a rack card: onto the first free mount
        const r = Base.installWeapon(_shipIdx, _hand.index);
        _say(r.message, r.ok); _hand = null; _syncStore(); _buildHold();
        return null;
      }
      /* …AND THE OTHER WAY (update154, jj: "x2 klik i odinstalujemy jak klikniemy na broń
         na statku albo powyżej w Loadout menu"): double-click on a fitted gun — on her
         roof or on its mount card — takes it off, back onto the shelf. */
      if (_hand.kind === 'gun' && _hand.from === 'mount' && _loClock - _lastPick <= 0.35) {
        const r = Base.uninstallWeapon(_shipIdx, _hand.slot);
        _say(r.message, r.ok); _hand = null; _syncStore(); _buildHold();
        return null;
      }
      if (_hand.kind === 'crew' && _loClock - _lastPick <= 0.35) {
        // double-click on a man: aboard / home
        if (_hand.from === 'barracks') _picked.add(_hand.id);
        else { _picked.delete(_hand.id); delete _posts[_hand.id]; }
        _hand = null;
        return null;
      }
      _loDrop(mx, my);
      return null;
    }
    // Commander slot and animal slot are clicks, not carries.
    if (Utils.pointInRect(mx, my, R.cmdSlot.x, R.cmdSlot.y, R.cmdSlot.w, R.cmdSlot.h)) {
      if (_commanderId) _commanderId = null;
      return null;
    }
    if (Utils.pointInRect(mx, my, R.petSlot.x, R.petSlot.y, R.petSlot.w, R.petSlot.h)) {
      const pets = Base.pets?.() ?? [];
      const i = pets.findIndex(p => p.id === _petId);
      _petId = i + 1 < pets.length ? pets[i + 1].id : null;
      return null;
    }
    const got = _loPick(mx, my);
    if (got === true) { _lastPick = _loClock; _press = { x: mx, y: my }; Audio.sfx.uiClick?.(); }
    return null;
  }

  /* ── drawing ──────────────────────────────────────────────────────── */

  function _loPanel(ctx, r, title, note, accent = '#4db8ff') {
    ctx.save();
    ctx.fillStyle = 'rgba(10,14,26,0.94)';
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 6); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 6); ctx.stroke();
    const g = ctx.createLinearGradient ? ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y) : null;
    if (g) { g.addColorStop(0, accent + '30'); g.addColorStop(1, accent + '00'); }
    ctx.fillStyle = g || 'rgba(77,184,255,0.1)';
    ctx.beginPath(); ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, 24, [6, 6, 0, 0]); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(r.x + 1, r.y + 6, 2, 14);
    ctx.textAlign = 'left';
    ctx.fillStyle = accent; ctx.font = '11px Orbitron, monospace';
    ctx.fillText(title, r.x + 12, r.y + 17);
    if (note) {
      const tw = ctx.measureText ? ctx.measureText(title).width : 80;
      ctx.fillStyle = '#5f7893'; ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(_clip(ctx, note, r.w - tw - 34), r.x + 22 + tw, r.y + 17);
    }
    ctx.restore();
  }

  function _drawLoadout(ctx, W, H, b) {
    const R = _loRects(W, H);
    // A screen of its own: nothing of the base shows through it.
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
    Renderer.drawBackground(0);
    ctx.fillStyle = 'rgba(5,7,13,0.80)'; ctx.fillRect(0, 0, W, H);

    // ── header ──
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e2ecf8'; ctx.font = '20px Orbitron, monospace';
    ctx.fillText('LOADOUT', 24, 31);
    ctx.fillStyle = '#5f7893'; ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillText('drag anything: shelf ⇄ hold · rack ⇄ mounts · barracks ⇄ deck · a man onto a room posts him', 24, 44);
    const entry = b.ships[_shipIdx];
    const def = entry ? (SHIP_CATALOG[entry.key] || { label: entry.key }) : null;
    if (b.ships.length > 1) {
      const n = b.ships.length;
      _btn(ctx, 522, 12, 26, 26, '◄', { act: 'ship', arg: (_shipIdx - 1 + n) % n });
      _btn(ctx, 732, 12, 26, 26, '►', { act: 'ship', arg: (_shipIdx + 1) % n });
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c8e8ff'; ctx.font = '14px Orbitron, monospace';
    ctx.fillText(def ? String(def.label).toUpperCase() : 'NO SHIP', 640, 26);
    if (entry) {
      const sh = _entryShip(entry);
      ctx.fillStyle = '#5f7893'; ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(`berth ${_shipIdx + 1}/${b.ships.length} · hull ${Math.round(sh?.hull ?? 0)}/${Math.round(sh?.hullMax ?? 0)}`, 640, 39);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1aff8c'; ctx.font = '16px Share Tech Mono, monospace';
    ctx.fillText(`${Base.cc()} CC`, W - 24, 30);
    ctx.textAlign = 'left';

    _loShelf(ctx, R);
    _loRack(ctx, R);
    _loHold(ctx, R);
    _loBarracks(ctx, R);
    _loMounts(ctx, R);
    _loStage(ctx, R, entry);
    _loDeck(ctx, R);
    _loFooter(ctx, R, b);
    _loHandDraw(ctx, R);
  }

  function _loShelf(ctx, R) {
    const g = liveShelf();
    _loPanel(ctx, R.shelfPanel, 'BASE WAREHOUSE', g ? `${g.usedCells()}/${g.capacity} cells` : '', '#ffd780');
    const F = R.filters;
    LO_FILTERS.forEach((f, i) => {
      _btn(ctx, F.x + i * (F.w + F.gap), F.y, F.w, F.h, f,
           { act: 'loFilter', arg: f, on: _filter === f, col: _filter === f ? '#ffd780' : '#4a6080',
             font: '9px Share Tech Mono, monospace' });
    });
    if (!g) return;
    const v = _shelfWin(R);
    LootScreen.drawCargoGrid(ctx, g, R.shelf.x, R.shelf.y, v,
      { sel: _sel, dim: _filter === 'ALL' ? null : _filterHides });
    // scroll arrows for a shelf bigger than its window
    if (g.cols > v.vc) {
      const y = R.shelf.y + R.shelf.h + 4;
      _btn(ctx, R.shelf.x, y, 18, 12, '◄', { act: v.sx > 0 ? 'scrollShelf' : null, arg: { dx: -1, dy: 0 }, enabled: v.sx > 0, font: '8px Share Tech Mono, monospace' });
      _btn(ctx, R.shelf.x + R.shelf.w - 18, y, 18, 12, '►', { act: v.sx + v.vc < g.cols ? 'scrollShelf' : null, arg: { dx: 1, dy: 0 }, enabled: v.sx + v.vc < g.cols, font: '8px Share Tech Mono, monospace' });
      const tw = R.shelf.w - 44, tx = R.shelf.x + 22;
      ctx.fillStyle = 'rgba(6,9,16,0.9)'; ctx.fillRect(tx, y + 3, tw, 6);
      const ww = Math.max(12, tw * v.vc / g.cols);
      ctx.fillStyle = 'rgba(255,215,128,0.6)';
      ctx.fillRect(tx + (tw - ww) * (v.sx / Math.max(1, g.cols - v.vc)), y + 3, ww, 6);
    }
    if (g.rows > v.vr) {
      const x = R.shelf.x + R.shelf.w + 4;
      _btn(ctx, x, R.shelf.y, 12, 16, '▲', { act: 'scrollShelf', arg: { dx: 0, dy: -1 }, enabled: v.sy > 0, font: '8px Share Tech Mono, monospace' });
      _btn(ctx, x, R.shelf.y + R.shelf.h - 16, 12, 16, '▼', { act: 'scrollShelf', arg: { dx: 0, dy: 1 }, enabled: v.sy + v.vr < g.rows, font: '8px Share Tech Mono, monospace' });
    }
    ctx.fillStyle = '#4a6080'; ctx.font = '9px Share Tech Mono, monospace'; ctx.textAlign = 'left';
    ctx.fillText('click: take · click: put · double-click: across · R: rotate', R.shelf.x, R.shelfPanel.y + R.shelfPanel.h - 8);
  }

  function _loRack(ctx, R) {
    const rack = Base.armoury();
    _loPanel(ctx, R.rackPanel, 'ARMOURY RACK', `${rack.length} gun${rack.length === 1 ? '' : 's'} on the shelf · drag onto a mount`, '#ff8a95');
    _rackScroll = Utils.clamp(_rackScroll, 0, Math.max(0, rack.length - R.rack.vis));
    if (!rack.length) {
      ctx.fillStyle = '#4a6080'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText('No spare guns. Guns you bring home land here.', R.rack.x, R.rack.y + 24);
    }
    rack.slice(_rackScroll, _rackScroll + R.rack.vis).forEach((key, vi) => {
      const i = _rackScroll + vi;
      const inHand = _hand?.kind === 'gun' && _hand.from === 'rack' && _hand.index === i;
      ctx.save(); if (inHand) ctx.globalAlpha = 0.35;
      Renderer.drawWeaponCard(ctx, key, R.rack.x, R.rack.y + vi * R.rack.pitch, 'M',
        { w: R.rack.w, h: R.rack.h, corner: 'ON THE RACK' });
      ctx.restore();
    });
    if (rack.length > R.rack.vis) {
      ctx.fillStyle = '#5f7893'; ctx.font = '9px Share Tech Mono, monospace'; ctx.textAlign = 'right';
      ctx.fillText(`${_rackScroll + 1}–${Math.min(rack.length, _rackScroll + R.rack.vis)} of ${rack.length} · wheel`,
                   R.rackPanel.x + R.rackPanel.w - 12, R.rackPanel.y + 17);
      ctx.textAlign = 'left';
    }
  }

  function _loHold(ctx, R) {
    if (!_hold) _buildHold();
    const hc = _holdCounts();
    _loPanel(ctx, R.holdPanel, 'SHIP HOLD', `${hc.used}/${hc.cap} cells`, '#1aff8c');
    if (!_hold) return;
    LootScreen.drawCargoGrid(ctx, _hold, R.hold.x, R.hold.y, _holdWin(R), { sel: _sel });
    const row = R.holdPanel.y + R.holdPanel.h - 14;
    [['He2', 'fuel', '#ff6b7a'], ['MSL', 'missiles', '#ffb347'], ['MED', 'heal', '#3aff6a'], ['FOOD', 'food', '#8fa8c0']]
      .forEach(([label, k, col], i) => {
        const x = R.holdPanel.x + 18 + i * 86;
        const n = hc[k];
        ctx.textAlign = 'left';
        ctx.fillStyle = n ? col : (k === 'fuel' ? '#ff5566' : '#5f7893');
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(label, x, row);
        ctx.fillStyle = n ? '#e2ecf8' : (k === 'fuel' ? '#ff5566' : '#5f7893');
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.fillText(String(n), x + 36, row);
      });
  }

  function _loBarracks(ctx, R) {
    const list = _loHomeList();
    _loPanel(ctx, R.barrPanel, 'STAYING HOME',
      `${list.filter(e => !e.cmd).length} in the barracks · drag onto the deck or a room`, '#4db8ff');
    if (!list.length) {
      ctx.fillStyle = '#4a6080'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText('Everyone is aboard.', R.barr.x, R.barr.y + 24);
    }
    _loBarrZones(R).forEach(z => {
      const inHand = _hand?.kind === 'crew' && _hand.id === z.id;
      ctx.save(); if (inHand) ctx.globalAlpha = 0.35;
      Renderer.drawCrewCard(ctx, z.rec, z.x, z.y, 'M',
        { w: z.w, h: z.h, commander: z.cmd, hint: z.cmd ? 'click: in the chair' : null, skillStrip: true });
      ctx.restore();
    });
    if (list.length > R.barr.vis) {
      ctx.fillStyle = '#5f7893'; ctx.font = '9px Share Tech Mono, monospace'; ctx.textAlign = 'right';
      ctx.fillText(`${_barrScroll + 1}–${Math.min(list.length, _barrScroll + R.barr.vis)} of ${list.length} · wheel`,
                   R.barrPanel.x + R.barrPanel.w - 12, R.barrPanel.y + R.barrPanel.h - 6);
      ctx.textAlign = 'left';
    }
  }

  function _loMounts(ctx, R) {
    const fitted = Base.shipWeapons(_shipIdx);
    _loPanel(ctx, R.mountPanel, 'MOUNTS', `${fitted.length} of ${R.mounts.length} fitted · double-click a gun: off`, '#ff8a95');
    if (!R.mounts.length) {
      ctx.fillStyle = '#ff5566'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText('This hull has no weapon bay.', 404, 102);
    }
    const carrying = _hand?.kind === 'gun';
    R.mounts.forEach(z => {
      const f = fitted.find(g => g.slot === z.slot);
      const inHand = _hand?.kind === 'gun' && _hand.from === 'mount' && _hand.slot === z.slot;
      if (f && !inHand) {
        Renderer.drawWeaponCard(ctx, f.defKey, z.x, z.y, 'S', { w: z.w, h: z.h, on: true, prefix: `${z.slot + 1}· ` });
        if (carrying) {   // dropping here swaps
          ctx.save(); ctx.strokeStyle = '#ffb347'; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.roundRect(z.x - 1.5, z.y - 1.5, z.w + 3, z.h + 3, 6); ctx.stroke(); ctx.restore();
        }
      } else {
        ctx.save();
        ctx.fillStyle = carrying ? 'rgba(255,179,71,0.08)' : 'rgba(13,17,32,0.6)';
        ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 5); ctx.fill();
        ctx.setLineDash([5, 4]); ctx.strokeStyle = carrying ? '#ffb347' : '#2a3346'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.roundRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1, 5); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = carrying ? '#ffb347' : '#4a6080'; ctx.font = '10px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(_clip(ctx, `MOUNT ${z.slot + 1} — drop a gun here`, z.w - 10), z.x + z.w / 2, z.y + z.h / 2 + 4);
        ctx.textAlign = 'left';
      }
    });
  }

  function _loStage(ctx, R, entry) {
    const S = R.stage;
    ctx.save();
    ctx.fillStyle = 'rgba(4,7,14,0.6)';
    ctx.beginPath(); ctx.roundRect(S.x, S.y, S.w, S.h, 6); ctx.fill();
    ctx.strokeStyle = '#1e2d4a';
    ctx.beginPath(); ctx.roundRect(S.x + 0.5, S.y + 0.5, S.w - 1, S.h - 1, 6); ctx.stroke();
    ctx.restore();
    if (!entry) {
      ctx.fillStyle = '#ff5566'; ctx.font = '13px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText('No ship in the hangar — buy one in HANGAR.', S.x + S.w / 2, S.y + S.h / 2);
      ctx.textAlign = 'left';
      return;
    }
    const loKey = Base.get().ships[_shipIdx]?.key;
    const loCx = S.x + S.w / 2 + (typeof DockArt !== 'undefined' && loKey
      ? DockArt.shiftFor(loKey, { x: S.x + 2, y: S.y + 2, w: S.w - 4, h: S.h - 4 }, S.x + S.w / 2) : 0);
    const sh = _previewShip(loCx, S.y + S.h / 2 + 14);
    if (sh) {
      // moored in the bay (update148)
      if (typeof DockArt !== 'undefined') DockArt.draw(ctx, { x: S.x + 2, y: S.y + 2, w: S.w - 4, h: S.h - 4 }, sh);
      ctx.save();
      ctx.beginPath(); ctx.rect(S.x + 2, S.y + 2, S.w - 4, S.h - 4); ctx.clip();
      sh.roofAlpha = 0;              // men are posted to rooms here: always the cutaway (update118)
      try { sh.draw(ctx); } catch (e) { /* a picture never kills the screen */ }
      /* the jet bridge's bellows over her airlock (update153) */
      if (typeof DockArt !== 'undefined') DockArt.drawOver?.(ctx, { x: S.x + 2, y: S.y + 2, w: S.w - 4, h: S.h - 4 }, sh);
      // A gun in the hand lights the roof, and the mount under the cursor (update128).
      if (_hand?.kind === 'gun') {
        const band = _loRoofBand(sh);
        const roof = _loRoofAt(Input.mouse.x, Input.mouse.y);
        if (band) {
          ctx.fillStyle = roof ? 'rgba(255,138,149,0.16)' : 'rgba(255,138,149,0.07)';
          ctx.fillRect(band.x, band.y, band.w, band.h);
          ctx.strokeStyle = 'rgba(255,138,149,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
          ctx.strokeRect(band.x + 0.5, band.y + 0.5, band.w - 1, band.h - 1);
          ctx.setLineDash([]);
        }
        if (roof?.rect) {
          ctx.strokeStyle = '#ff8a95'; ctx.lineWidth = 2;
          ctx.strokeRect(roof.rect.x - 2, roof.rect.y - 2, roof.rect.w + 4, roof.rect.h + 4);
        }
      }
      // A man in the hand lights the room under the cursor: that is his post.
      if (_hand?.kind === 'crew') {
        const room = _loRoomAt(Input.mouse.x, Input.mouse.y);
        if (room) {
          ctx.strokeStyle = '#1aff8c'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
          ctx.strokeRect(room.x + 1, room.y + 1, room.w - 2, room.h - 2);
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }
    ctx.fillStyle = '#4a6080'; ctx.font = '9px Share Tech Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText('drop a man on a room to post him there · a gun on her roof to fit it', S.x + S.w / 2, S.y + S.h - 8);
    ctx.textAlign = 'left';
  }

  /** The word for where a man stands: his posted room, or where the ship put him. */
  function _loPostWord(id) {
    const sh = _preview;
    const man = sh?.crew.find(c => c.id === id);
    const room = man ? sh.getRoomById(man.homeRoomId ?? man.roomId) : null;
    const sys = room ? sh.systems.find(s => s.roomId === room.id) : null;
    const word = sys ? (MOD_LABEL[sys.type] || sys.type).toUpperCase() : room ? 'DECK' : '';
    return (_posts[id] != null ? '◆ ' : '') + word;
  }

  function _loDeck(ctx, R) {
    const aboard = Base.crew().filter(c => _picked.has(c.id));
    _loPanel(ctx, R.deckPanel, 'ON BOARD', `${aboard.length} crew · commander · animal · ◆ = posted by you`, '#1aff8c');
    // commander
    const cap = _commanderId ? Base.commanderById?.(_commanderId) : null;
    const C = R.cmdSlot;
    if (cap) {
      Renderer.drawCrewCard(ctx, cap, C.x, C.y, 'M', { w: C.w, h: C.h, commander: true, hint: 'click: back to the mess', skillStrip: true });
    } else {
      ctx.save();
      ctx.fillStyle = 'rgba(40,32,10,0.35)'; ctx.beginPath(); ctx.roundRect(C.x, C.y, C.w, C.h, 5); ctx.fill();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,208,96,0.5)';
      ctx.beginPath(); ctx.roundRect(C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1, 5); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#a08a5a'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      const any = (Base.commanders?.() ?? []).some(c => !c.away);
      ctx.fillText(any ? 'NO COMMANDER — click one under STAYING HOME' : 'NO COMMANDER — promote one in MESS',
                   C.x + C.w / 2, C.y + C.h / 2 + 4);
      ctx.textAlign = 'left';
    }
    // animal
    const Pt = R.petSlot;
    const pet = _petId ? (Base.pets?.() ?? []).find(p => p.id === _petId) : null;
    ctx.save();
    ctx.fillStyle = pet ? 'rgba(40,30,10,0.6)' : 'rgba(13,17,32,0.5)';
    ctx.beginPath(); ctx.roundRect(Pt.x, Pt.y, Pt.w, Pt.h, 5); ctx.fill();
    if (!pet) ctx.setLineDash([5, 4]);
    ctx.strokeStyle = pet ? '#ffc861' : '#3a3320';
    ctx.beginPath(); ctx.roundRect(Pt.x + 0.5, Pt.y + 0.5, Pt.w - 1, Pt.h - 1, 5); ctx.stroke();
    ctx.restore();
    if (pet) {
      Renderer.drawCrewPortrait(ctx, pet, Pt.x + 4, Pt.y + 4, 48, '#ffc861');
      ctx.fillStyle = '#ffe0a0'; ctx.font = '13px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText(_clip(ctx, pet.name, Pt.w - 64), Pt.x + 60, Pt.y + 22);
      ctx.fillStyle = '#a08a5a'; ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText('SHIP’S CAT · click: next', Pt.x + 60, Pt.y + 36);
      const hun = Utils.clamp((pet.hunger ?? 100) / 100, 0, 1);
      ctx.fillStyle = '#1a1405'; ctx.fillRect(Pt.x + 60, Pt.y + 44, 90, 4);
      ctx.fillStyle = hun > 0.4 ? '#1aff8c' : hun > 0.12 ? '#ffb020' : '#ff2d44';
      ctx.fillRect(Pt.x + 60, Pt.y + 44, 90 * hun, 4);
    } else {
      ctx.fillStyle = '#5a5030'; ctx.font = '10px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText((Base.pets?.() ?? []).length ? 'no animal · click' : 'no animal', Pt.x + Pt.w / 2, Pt.y + Pt.h / 2 + 4);
      ctx.textAlign = 'left';
    }
    // crew
    if (!aboard.length) {
      ctx.fillStyle = '#ffb020'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText('Nobody aboard — drag hands in from STAYING HOME, or green recruits sign on.', R.crewArea.x, R.crewArea.y + 20);
    }
    _loDeckZones(R).forEach(z => {
      const inHand = _hand?.kind === 'crew' && _hand.id === z.id;
      ctx.save(); if (inHand) ctx.globalAlpha = 0.35;
      Renderer.drawCrewCard(ctx, z.rec, z.x, z.y, 'S', { w: z.w, h: z.h, on: true, task: _loPostWord(z.id), skillStrip: true });
      ctx.restore();
    });
  }

  function _loFooter(ctx, R, b) {
    ctx.fillStyle = 'rgba(8,11,20,0.95)'; ctx.fillRect(R.footer.x, R.footer.y, R.footer.w, R.footer.h);
    ctx.strokeStyle = '#1e2d4a'; ctx.beginPath(); ctx.moveTo(0, R.footer.y + 0.5); ctx.lineTo(R.footer.w, R.footer.y + 0.5); ctx.stroke();
    const checks = _briefingChecks();
    const COL = { bad: '#ff5566', warn: '#ffd700', ok: '#1aff8c' };
    const MARK = { bad: '✖', warn: '!', ok: '✓' };
    const colW = Math.floor(R.checks.w / 2);
    ctx.textAlign = 'left'; ctx.font = '11px Share Tech Mono, monospace';
    checks.slice(0, 4).forEach((c, i) => {
      const x = R.checks.x + Math.floor(i / 2) * colW, y = R.checks.y + 14 + (i % 2) * 18;
      ctx.fillStyle = COL[c.level]; ctx.fillText(MARK[c.level], x, y);
      ctx.fillStyle = c.level === 'ok' ? '#9fb4cc' : COL[c.level];
      ctx.fillText(_clip(ctx, c.text, colW - 22), x + 14, y);
    });
    _btn(ctx, R.back.x, R.back.y, R.back.w, R.back.h, 'BACK',
         { act: 'loClose', col: '#7a90a8', font: '14px Orbitron, monospace', sub: '[ESC]' });
    const ready = !!b.ships[_shipIdx];
    const worst = checks.find(c => c.level === 'bad');
    _btn(ctx, R.start.x, R.start.y, R.start.w, R.start.h, 'START CONTRACT  ▶',
         { act: ready ? 'toDest' : null, enabled: ready, col: worst ? '#ffb020' : '#1aff8c',
           font: '16px Orbitron, monospace', sub: 'choose a moon and a contract  [ENTER]' });
  }

  /** What the cursor carries, drawn last, over everything. */
  function _loHandDraw(ctx, R) {
    const h = _hand;
    if (!h) return;
    const mx = Input.mouse.x, my = Input.mouse.y;
    ctx.save();
    ctx.globalAlpha = 0.92;
    if (h.kind === 'cargo') {
      const C = LootScreen.CELL;
      LootScreen.drawCargoItem(ctx, h.item, mx - C / 2, my - C / 2, 0.85, true, true);
    } else if (h.kind === 'gun') {
      Renderer.drawWeaponCard(ctx, h.key, mx - 30, my - 14, 'S', { w: 200, on: true });
    } else if (h.kind === 'crew') {
      const rec = Base.crew().find(c => c.id === h.id);
      if (rec) Renderer.drawCrewCard(ctx, rec, mx - 30, my - 14, 'S', { w: 200, on: true });
    }
    ctx.restore();
  }

  /* ══ DESTINATION (update113) — choose a moon, then a contract ═══════════
   * jj: "START CONTRACT przenosi na mapę wyboru księżyców — wszystkie są
   * zablokowane, ale jest księżyc; gracz daje na niego i ma wyświetlone
   * aktywne kontrakty, wybiera i leci". And: "cały układ wygląda super".
   * The whole system, the Sun off the left edge; only Luna is open in this
   * version, the rest wear a padlock and MOON GATE.
   */
  /* ══ THE ORRERY (update114) ══════════════════════════════════════════
   * jj: "dodać resztę planet układu, łącznie z Plutonem, księżyc na Marsie,
   * i żeby odzwierciedlało ułożenie planet i księżyców w realnym czasie".
   *
   * The planets stand where they really are today: heliocentric ecliptic
   * longitude from the J2000 mean elements (JPL, Standish) through Kepler's
   * equation — good to about a degree, which is far finer than a pixel at
   * this scale. Inclination is ignored (the view is from above the
   * ecliptic). DISTANCES ARE NOT TO SCALE: Pluto is a hundred times further
   * out than Mercury, so the radius is logarithmic; the ANGLES are real.
   *
   * Moons: Luna and the Galilean moons from their real mean longitudes and
   * rates; the rest go round at their real periods from an assumed phase
   * (`real: false`) — their motion is right, their exact place is not.
   */
  const J2000 = Date.UTC(2000, 0, 1, 12);
  const ORRERY_PLANETS = [
    //  key        label      a(AU)    e          L0 (deg)       L rate (deg/century)  ϖ (deg)       size  colours
    { key: 'mercury', label: 'MERCURY', a: 0.38710, e: 0.20563593, L0: 252.25032350, Ld: 149472.67411175, w: 77.45779628,  size: 4,  c1: '#c9b8a6', c2: '#5e5045' },
    { key: 'venus',   label: 'VENUS',   a: 0.72333, e: 0.00677672, L0: 181.97909950, Ld: 58517.81538729,  w: 131.60246718, size: 7,  c1: '#f3e1b0', c2: '#9a7a3e' },
    { key: 'earth',   label: 'EARTH',   a: 1.00000, e: 0.01671123, L0: 100.46457166, Ld: 35999.37244981,  w: 102.93768193, size: 9,  c1: '#a89880', c2: '#2a221c',
      /* the Earth after the fall (update153): ash and scorched land, not blue and green */
      bands: [[-0.2, 0.18, 'rgba(60,44,32,0.6)'], [0.25, 0.14, 'rgba(170,150,120,0.45)']] },
    { key: 'mars',    label: 'MARS',    a: 1.52371, e: 0.09339410, L0: -4.55343205,  Ld: 19140.30268499,  w: -23.94362959, size: 6,  c1: '#e8916a', c2: '#7a2e18' },
    { key: 'jupiter', label: 'JUPITER', a: 5.20289, e: 0.04838624, L0: 34.39644051,  Ld: 3034.74612775,   w: 14.72847983,  size: 18, c1: '#f0d0a8', c2: '#7a4a28',
      bands: [[-0.5, 0.12, 'rgba(160,90,50,0.5)'], [-0.15, 0.14, 'rgba(200,140,90,0.45)'], [0.2, 0.1, 'rgba(150,80,40,0.5)'], [0.42, 0.08, 'rgba(190,120,70,0.4)']] },
    { key: 'saturn',  label: 'SATURN',  a: 9.53668, e: 0.05386179, L0: 49.95424423,  Ld: 1222.49362201,   w: 92.59887831,  size: 14, c1: '#f2e2b0', c2: '#8a6a30', ring: 'rgba(230,210,160,0.55)',
      bands: [[-0.3, 0.12, 'rgba(180,140,80,0.4)'], [0.1, 0.1, 'rgba(170,130,70,0.4)']] },
    { key: 'uranus',  label: 'URANUS',  a: 19.18916, e: 0.04725744, L0: 313.23810451, Ld: 428.48202785,    w: 170.95427630, size: 10, c1: '#c8f2f2', c2: '#3c8a9a' },
    { key: 'neptune', label: 'NEPTUNE', a: 30.06992, e: 0.00859048, L0: -55.12002969, Ld: 218.45945325,    w: 44.96476227,  size: 10, c1: '#8fb8ff', c2: '#1a2c80' },
    { key: 'pluto',   label: 'PLUTO',   a: 39.48211, e: 0.24882730, L0: 238.92903833, Ld: 145.20780515,    w: 224.06891629, size: 3,  c1: '#d8c8b0', c2: '#6a5a48' },
  ];
  const ORRERY_MOONS = [
    //  key         planet     display radius  L0 (deg)   rate (deg/day)  real epoch?  size
    { key: 'luna',      planet: 'earth',   rd: 21, L0: 218.316,   rate: 13.176396,    real: true,  size: 5 },
    { key: 'phobos',    planet: 'mars',    rd: 11, L0: 30,        rate: 1128.8444,    real: false, size: 3 },
    { key: 'deimos',    planet: 'mars',    rd: 18, L0: 210,       rate: 285.1618,     real: false, size: 3 },
    { key: 'io',        planet: 'jupiter', rd: 30, L0: 106.07719, rate: 203.48895579, real: true,  size: 3 },
    { key: 'europa',    planet: 'jupiter', rd: 38, L0: 175.73161, rate: 101.37472473, real: true,  size: 3 },
    { key: 'ganymede',  planet: 'jupiter', rd: 46, L0: 120.55883, rate: 50.31760920,  real: true,  size: 4 },
    { key: 'enceladus', planet: 'saturn',  rd: 32, L0: 80,        rate: 262.7318,     real: false, size: 3 },
    { key: 'titan',     planet: 'saturn',  rd: 40, L0: 300,       rate: 22.5770,      real: false, size: 4 },
    { key: 'triton',    planet: 'neptune', rd: 19, L0: 150,       rate: -61.2573,     real: false, size: 3 },   // retrograde
  ];
  const ORRERY_VIEW = { cx: 400, cy: 392, tilt: 0.72, rMin: 50, rMax: 380 };

  /** Heliocentric longitude (deg) and distance (AU) of a planet at `ms`. */
  function _planetAt(p, ms) {
    const T = (ms - J2000) / (36525 * 86400000);              // Julian centuries since J2000
    const deg = Math.PI / 180;
    const L = p.L0 + p.Ld * T;
    let M = ((L - p.w) % 360 + 360) % 360 * deg;
    let E = M;
    for (let i = 0; i < 8; i++) E = M + p.e * Math.sin(E);    // Kepler, by iteration
    const nu = 2 * Math.atan2(Math.sqrt(1 + p.e) * Math.sin(E / 2), Math.sqrt(1 - p.e) * Math.cos(E / 2));
    const lon = ((nu / deg + p.w) % 360 + 360) % 360;
    const r = p.a * (1 - p.e * Math.cos(E));
    return { lon, r, x: r * Math.cos(lon * deg), y: r * Math.sin(lon * deg) };
  }

  /** Where everything is at `date` — angles and screen positions, one source. */
  function orreryLayout(date = new Date()) {
    const ms = +date;
    const V = ORRERY_VIEW, deg = Math.PI / 180;
    const span = Math.log(ORRERY_PLANETS[ORRERY_PLANETS.length - 1].a / ORRERY_PLANETS[0].a);
    const rd = (a) => V.rMin + (V.rMax - V.rMin) * Math.log(a / ORRERY_PLANETS[0].a) / span;
    const planets = {};
    ORRERY_PLANETS.forEach(p => {
      const at = _planetAt(p, ms);
      const R = rd(p.a);
      planets[p.key] = { ...p, ...at, R,
        sx: V.cx + R * Math.cos(at.lon * deg), sy: V.cy - R * Math.sin(at.lon * deg) * V.tilt };
    });
    const days = (ms - J2000) / 86400000;
    const moons = {};
    ORRERY_MOONS.forEach(m => {
      const host = planets[m.planet];
      const ang = ((m.L0 + m.rate * days) % 360 + 360) % 360;
      moons[m.key] = { ...m, ang,
        sx: host.sx + m.rd * Math.cos(ang * deg), sy: host.sy - m.rd * Math.sin(ang * deg) * V.tilt };
    });
    return { date: new Date(ms), planets, moons };
  }

  /** How far a body is from Earth at `date`, in words ("1.52 AU", "384 400 km"). */
  function orreryDistance(key, date = new Date()) {
    const L = orreryLayout(date);
    if (key === 'luna') return '384 400 km';
    const m = L.moons[key];
    const p = L.planets[m ? m.planet : key];
    if (!p) return '';
    const e = L.planets.earth;
    const au = Math.hypot(p.x - e.x, p.y - e.y);
    const lightMin = au * 8.317;
    return `${au.toFixed(2)} AU · ${lightMin < 60 ? Math.round(lightMin) + ' light-min' : (lightMin / 60).toFixed(1) + ' light-h'}`;
  }

  /** The date the map shows: now, unless a test pinned it. */
  function _orreryNow() { return _orreryDate ? new Date(_orreryDate) : new Date(); }

  function _destRects(W = Renderer.getWidth(), H = Renderer.getHeight()) {
    const list = Base.missions();
    return {
      panel: { x: 820, y: 16, w: 444, h: 690 },
      cards: list.map((m, i) => ({ x: 832, y: 94 + i * 78, w: 420, h: 72, id: m.id })),
      /* who flies, with what each of them can do (update154) — between the cards and FLYING WITH */
      crew:   { x: 832, y: 94 + list.length * 78 + 8, w: 420, h: Math.max(0, (642 - 54 - 12) - (94 + list.length * 78 + 8)) },
      back:   { x: 832, y: 642, w: 140, h: 52 },
      launch: { x: 984, y: 642, w: 268, h: 52 },
      gate:   { x: 24, y: 664, w: 260, h: 40 },
      // Where each moon is TODAY (the orrery) — a small square round it to click.
      moons:  Object.values(orreryLayout(_orreryNow()).moons)
                .map(m => ({ x: m.sx - 9, y: m.sy - 9, w: 18, h: 18, key: m.key })),
    };
  }

  function _destPlanet(ctx, x, y, r, c1, c2, opts = {}) {
    ctx.save();
    const g = ctx.createRadialGradient ? ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r) : null;
    if (g) { g.addColorStop(0, c1); g.addColorStop(1, c2); }
    ctx.fillStyle = g || c1; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (opts.bands) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      opts.bands.forEach(([dy, h, col]) => { ctx.fillStyle = col; ctx.fillRect(x - r, y + dy * r, r * 2, h * r); });
    }
    ctx.restore();
    if (opts.ring) {
      ctx.save(); ctx.strokeStyle = opts.ring; ctx.lineWidth = r * 0.12;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.9, r * 0.5, -0.25, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.save();
    const s = ctx.createRadialGradient ? ctx.createRadialGradient(x + r * 0.6, y + r * 0.5, r * 0.2, x + r * 0.2, y + r * 0.2, r * 1.3) : null;
    if (s) { s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = s;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function _destLock(ctx, x, y, col) {
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y - 3, 3.5, Math.PI, 0); ctx.stroke();
    ctx.fillRect(x - 5, y - 3, 10, 7); ctx.restore();
  }

  function _drawDest(ctx, W, H, b) {
    const R = _destRects(W, H);
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
    Renderer.drawBackground(0);
    ctx.fillStyle = 'rgba(2,4,9,0.78)'; ctx.fillRect(0, 0, W, H);
    // ── THE SOLAR SYSTEM, AS IT STANDS TODAY (update114) ──
    const now = _orreryNow();
    const O = orreryLayout(now);
    const V = ORRERY_VIEW;
    // the Sun at the centre
    ctx.save();
    const sg = ctx.createRadialGradient ? ctx.createRadialGradient(V.cx, V.cy, 2, V.cx, V.cy, 44) : null;
    if (sg) { sg.addColorStop(0, 'rgba(255,240,190,1)'); sg.addColorStop(0.22, 'rgba(255,190,80,0.8)'); sg.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(V.cx, V.cy, 44, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#fff3c8'; ctx.beginPath(); ctx.arc(V.cx, V.cy, 9, 0, Math.PI * 2); ctx.fill();
    // the orbits — ellipses only because the view is tilted, not to scale
    ctx.lineWidth = 1;
    Object.values(O.planets).forEach(p => {
      ctx.strokeStyle = p.key === 'earth' ? 'rgba(77,184,255,0.30)' : 'rgba(77,184,255,0.11)';
      ctx.beginPath(); ctx.ellipse(V.cx, V.cy, p.R, p.R * V.tilt, 0, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e2ecf8'; ctx.font = '18px Orbitron, monospace';
    ctx.fillText('CHOOSE A DESTINATION', 24, 34);
    ctx.fillStyle = '#5f7893'; ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('The Moon Gate opens the outer moons. For now only Luna takes contracts.', 24, 52);
    {
      const d = O.date;
      const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      ctx.fillStyle = '#4db8ff'; ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`TODAY · ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} — the planets where they really are`, 24, 70);
      ctx.fillStyle = '#3d4a63';
      ctx.fillText('angles are real · distances squeezed (Pluto is 100× further than Mercury)', 24, 84);
    }

    /* LABELS NEVER LAND ON EACH OTHER. The planets move every day, so no
       fixed offset can be trusted: each label tries a few spots and takes
       the first that is clear of every label already placed. */
    const placed = [];
    /* `flip` is how far to jump to put a left-aligned label on the OTHER
       side of its dot — tried before moving further away up or down. */
    const label = (text, x, y, font, col, align = 'center', flip = 0, icon = null) => {
      ctx.font = font;
      const w = (ctx.measureText?.(text)?.width ?? text.length * 6);
      const h = 11, iw = icon ? 10 : 0;
      // Near first: under/beside the dot, then the other side, then further up and down.
      const alts = align === 'center' ? [0, w / 2 + 14, -(w / 2 + 14)] : [0, -(w + iw + (flip || 0))];
      const tries = [];
      [0, 12, -12, 24, -24, 36, -36, 48, -48].forEach(dy => alts.forEach(dx => tries.push([dx, dy, false])));
      /* THE LAST RESORT: a clear spot further out on a ring round the dot,
         tied to it by a hair-line — a label is never simply left off. */
      for (const dist of [70, 95, 120]) for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8;
        tries.push([Math.cos(a) * dist, Math.sin(a) * dist * 0.7, true]);
      }
      for (const [dx, dy, lead] of tries) {
        const x0 = (align === 'center' ? x - w / 2 : x) + dx;
        const r = { x: x0 - 2 - iw, y: y + dy - h, w: w + 4 + iw, h: h + 3 };
        if (placed.some(q => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) continue;
        if (r.x < 4 || r.x + r.w > 800 || r.y < 92 || r.y + r.h > 712) continue;   // stays on the map
        placed.push(r);
        if (lead) {
          ctx.strokeStyle = 'rgba(122,144,168,0.45)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x - (align === 'center' ? 0 : 6), y - 4);
          ctx.lineTo(x0 + (dx > 0 ? -iw - 2 : w + 2), y + dy - 4); ctx.stroke();
        }
        if (icon) icon(x0 - iw + 3, y + dy - 3);
        ctx.font = font; ctx.fillStyle = col; ctx.textAlign = align;
        ctx.fillText(text, x + dx, y + dy);
        ctx.textAlign = 'left';
        return;
      }
    };

    // Every disc (and the Sun) is ground no label may stand on.
    placed.push({ x: V.cx - 12, y: V.cy - 12, w: 24, h: 24 });
    Object.values(O.planets).forEach(p => {
      const rr = p.ring ? p.size * 1.9 : p.size;
      placed.push({ x: p.sx - rr - 1, y: p.sy - p.size - 1, w: rr * 2 + 2, h: p.size * 2 + 2 });
    });
    Object.values(O.planets).forEach(p => {
      _destPlanet(ctx, p.sx, p.sy, p.size, p.c1, p.c2, { bands: p.bands, ring: p.ring });
      label(p.label, p.sx, p.sy + p.size + 14, '9px Orbitron, monospace', p.key === 'earth' ? '#7a90a8' : '#4f6480');
    });

    const regions = (typeof Save !== 'undefined' && Save.regions) ? Save.regions() : {};
    Object.values(O.moons).forEach(m => {
      const reg = regions[m.key] || { label: m.key.toUpperCase() };
      const open = (typeof Save !== 'undefined' && Save.regionUnlocked) ? Save.regionUnlocked(m.key) : m.key === 'luna';
      const host = O.planets[m.planet];
      // its orbit round the planet
      ctx.strokeStyle = open ? 'rgba(77,184,255,0.35)' : 'rgba(120,130,150,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(host.sx, host.sy, m.rd, m.rd * V.tilt, 0, 0, Math.PI * 2); ctx.stroke();
      if (_destMoon === m.key) {
        ctx.save();
        const g = ctx.createRadialGradient ? ctx.createRadialGradient(m.sx, m.sy, m.size, m.sx, m.sy, m.size * 4) : null;
        if (g) { g.addColorStop(0, 'rgba(77,184,255,0.5)'); g.addColorStop(1, 'rgba(77,184,255,0)'); ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(m.sx, m.sy, m.size * 4, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = '#4db8ff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(m.sx, m.sy, m.size + 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
      }
      _destPlanet(ctx, m.sx, m.sy, m.size, open ? '#f0f2f6' : '#8a93a6', open ? '#7a8496' : '#2c3344');
      const lx = m.sx + m.size + 5, ly = m.sy + 4;
      if (open) label(reg.label, lx, ly, '11px Orbitron, monospace', '#e2ecf8', 'left', m.size * 2 + 10);
      else label(reg.label, lx + 10, ly, '8px Share Tech Mono, monospace', '#5a6478', 'left', m.size * 2 + 10,
                 (ix, iy) => _destLock(ctx, ix, iy, '#7a8aa0'));
      const z = R.moons.find(q => q.key === m.key);
      _zones.push({ ...z, act: 'destMoon', arg: m.key });
    });
    ctx.textAlign = 'left';

    // the Gate's progress, bottom left
    {
      const parts = GATE_PARTS.filter(p => _gateHave(p) >= p.need).length;
      _btn(ctx, R.gate.x, R.gate.y, R.gate.w, R.gate.h, `MOON GATE  ·  ${parts} / ${GATE_PARTS.length} parts`,
           { act: 'destGate', col: '#7a8aa0', sub: 'build it to open the outer moons' });
    }

    // ── the selected moon's contracts ──
    const reg = regions[_destMoon] || { label: 'LUNA', blurb: '' };
    const P = R.panel;
    _loPanel(ctx, P, reg.label, `${reg.body ? reg.body + '’s moon' : ''}${reg.home ? ' · home region' : ''}`
      + ` · ${orreryDistance(_destMoon, now)} from Earth today`, '#4db8ff');
    ctx.fillStyle = '#9fb4cc'; ctx.font = '10px Share Tech Mono, monospace'; ctx.textAlign = 'left';
    _wrap(ctx, reg.blurb || '', P.x + 14, P.y + 42, P.w - 28, 12, 2);
    ctx.fillStyle = '#5f7893'; ctx.font = '9px Share Tech Mono, monospace';
    // The jobs have an address (update58) — the line the base bar used to carry.
    ctx.fillText(`${reg.label} · CONTRACTS — more moons open with the Moon Gate`, P.x + 14, P.y + 68);

    const open = (typeof Save !== 'undefined' && Save.regionUnlocked) ? Save.regionUnlocked(_destMoon) : _destMoon === 'luna';
    if (!open) {
      _destLock(ctx, P.x + P.w / 2, P.y + 140, '#ff8a95');
      ctx.fillStyle = '#ff8a95'; ctx.font = '12px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText('Locked — the Moon Gate opens it.', P.x + P.w / 2, P.y + 170);
      ctx.textAlign = 'left';
    } else {
      Base.missions().forEach((m, i) => {
        const c = R.cards[i];
        const closed = (typeof missionRefusal === 'function') ? missionRefusal(m) : null;
        const on = _mission === m.id && !closed;
        ctx.save();
        ctx.fillStyle = on ? 'rgba(26,140,255,0.16)' : closed ? 'rgba(10,12,20,0.9)' : 'rgba(13,18,32,0.95)';
        ctx.beginPath(); ctx.roundRect(c.x, c.y, c.w, c.h, 5); ctx.fill();
        ctx.strokeStyle = on ? '#4db8ff' : closed ? '#2a2230' : '#22324f'; ctx.lineWidth = on ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1, 5); ctx.stroke();
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.fillStyle = closed ? '#5a6478' : on ? '#e2ecf8' : '#9fb4cc'; ctx.font = '13px Share Tech Mono, monospace';
        ctx.fillText(_clip(ctx, m.label, c.w - 90), c.x + 14, c.y + 20);
        if (closed) {
          _destLock(ctx, c.x + c.w - 16, c.y + 16, '#ff8a95');
          ctx.fillStyle = '#ff8a95'; ctx.font = '10px Share Tech Mono, monospace';
          _wrap(ctx, closed, c.x + 14, c.y + 38, c.w - 28, 13, 3);
        } else {
          ctx.textAlign = 'right'; ctx.font = '9px Share Tech Mono, monospace';
          ctx.fillStyle = m.boss ? '#ff5566' : '#1aff8c';
          ctx.fillText(m.boss ? 'BOSS' : 'NO BOSS', c.x + c.w - 12, c.y + 20);
          ctx.textAlign = 'left';
          ctx.fillStyle = '#7a90a8'; ctx.font = '10px Share Tech Mono, monospace';
          _wrap(ctx, m.blurb, c.x + 14, c.y + 36, c.w - 28, 13, 2);
          // risk: sectors, and one more square for a boss
          ctx.fillStyle = '#5f7893'; ctx.font = '9px Share Tech Mono, monospace';
          ctx.fillText('RISK', c.x + 230, c.y + c.h - 9);
          const risk = Math.min(5, m.sectors + (m.boss ? 1 : 0));
          for (let k = 0; k < 5; k++) {
            ctx.fillStyle = k < risk ? '#ff7c20' : 'rgba(74,96,128,0.3)';
            ctx.fillRect(c.x + 258 + k * 10, c.y + c.h - 16, 8, 7);
          }
          ctx.fillStyle = '#ffd700'; ctx.font = '9px Share Tech Mono, monospace';
          ctx.fillText(`${m.sectors} sector${m.sectors > 1 ? 's' : ''}   ·   bonus ${m.ccBonus} CC`, c.x + 14, c.y + c.h - 9);
          _zones.push({ x: c.x, y: c.y, w: c.w, h: c.h, act: 'mission', arg: m.id });
        }
      });
    }

    // WHO FLIES, AND WHAT EACH CAN DO (update154, jj: "tak samo w liście info na mapie
    // kontraktów"): the commander first, then the hands — a name and his skills.
    {
      const C = R.crew, cap = _commanderId ? Base.commanderById?.(_commanderId) : null;
      const hands = Base.crew().filter(c => _picked.has(c.id));
      const people = [...(cap ? [{ rec: cap, cmd: true }] : []), ...hands.map(rec => ({ rec, cmd: false }))];
      const rows = Math.floor((C.h - 16) / 17), cols = 2, cw = Math.floor(C.w / cols);
      if (C.h >= 34) {
        ctx.fillStyle = '#5f7893'; ctx.font = '9px Orbitron, monospace'; ctx.textAlign = 'left';
        ctx.fillText('ABOARD — WHAT THEY CAN DO', C.x + 2, C.y + 8);
        if (!people.length) { ctx.fillStyle = '#ffb020'; ctx.font = '10px Share Tech Mono, monospace'; ctx.fillText('nobody picked — green hands sign on', C.x + 2, C.y + 26); }
        const shown = people.slice(0, rows * cols);
        shown.forEach((p, i) => {
          const x = C.x + 2 + Math.floor(i / rows) * cw, y = C.y + 16 + (i % rows) * 17;
          ctx.fillStyle = p.cmd ? '#ffe9a8' : '#c8d8f0'; ctx.font = '10px Share Tech Mono, monospace'; ctx.textAlign = 'left';
          ctx.fillText(_clip(ctx, (p.cmd ? '★ ' : '') + (p.rec.name ?? '?'), 78), x, y + 9);
          let got = Renderer.drawSkillStrip?.(ctx, p.rec, x + 84, y + 1, cw - 92) ?? 0;
          if (!got && p.cmd) got = Renderer.drawSpecialties?.(ctx, p.rec, x + 84, y, 10, 3) ?? 0;   // a commander's masteries
          if (!got) { ctx.fillStyle = '#4a6080'; ctx.font = '9px Share Tech Mono, monospace'; ctx.fillText('no skills yet', x + 84, y + 9); }
        });
        if (people.length > shown.length) {
          ctx.fillStyle = '#5f7893'; ctx.font = '9px Share Tech Mono, monospace'; ctx.textAlign = 'right';
          ctx.fillText(`+${people.length - shown.length} more`, C.x + C.w, C.y + 8); ctx.textAlign = 'left';
        }
      }
    }

    // flying with
    const S = _briefSummary();
    const y0 = R.back.y - 54;
    ctx.strokeStyle = '#1e2d4a'; ctx.beginPath(); ctx.moveTo(P.x + 12, y0 - 6); ctx.lineTo(P.x + P.w - 12, y0 - 6); ctx.stroke();
    ctx.fillStyle = '#5f7893'; ctx.font = '9px Orbitron, monospace'; ctx.textAlign = 'left';
    ctx.fillText('FLYING WITH', P.x + 14, y0 + 8);
    ctx.fillStyle = '#c8e8ff'; ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText(_clip(ctx, `${(S.ship || 'no ship').toUpperCase()}  ·  ${S.crew} crew  ·  ${S.commander ? 'commander ' + S.commander : 'no commander'}`, P.w - 28), P.x + 14, y0 + 24);
    ctx.fillStyle = '#9fb4cc'; ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`hold ${S.used}/${S.cap}  ·  He2 ${S.fuel}  ·  missiles ${S.missiles}  ·  rations ${S.food}`, P.x + 14, y0 + 39);

    const mission = Base.missions().find(m => m.id === _mission);
    const can = open && !!b.ships[_shipIdx] && mission && !S.missionClosed;
    _btn(ctx, R.back.x, R.back.y, R.back.w, R.back.h, 'BACK',
         { act: 'toLoadout', col: '#7a90a8', font: '13px Orbitron, monospace', sub: 'to the loadout' });
    const flying = (typeof Save !== 'undefined' && Save.hasShipInFlight && Save.hasShipInFlight());
    _btn(ctx, R.launch.x, R.launch.y, R.launch.w, R.launch.h, 'LAUNCH  ▶',
         { act: can ? 'launch' : null, enabled: can, col: flying ? '#ffb020' : '#1aff8c',
           font: '18px Orbitron, monospace',
           sub: can ? `${mission.label} · ${reg.label}  [ENTER]` : 'pick an open contract' });
  }

  function _destUpdate(dt) {
    if (Input.isPressed('Escape')) { _screen = 'loadout'; return null; }
    if (Input.isPressed('Enter') || Input.isPressed('NumpadEnter')) return _act('launch');
    if (!Input.mouse.leftPressed) return null;
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (const z of _zones) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      Audio.sfx.uiClick?.();
      return _act(z.act, z.arg);
    }
    return null;
  }

  /* ── INSIDE A BUILDING (update152) ─────────────────────────
   * The screen's panel over the room (ROOM_RECT), the building's name in
   * its town colour at the top, and at the foot who keeps the place, the
   * next contract, LOADOUT and ◀ TOWN. One frame for every building. */
  const ROOM_RECT = { x: 16, y: 62, w: 1248, h: 530 };
  const ROOM_BAR = {
    keeper:  { x: 16,   y: 604, w: 600, h: 104 },
    brief:   { x: 628,  y: 604, w: 380, h: 104 },
    loadout: { x: 1020, y: 604, w: 244, h: 58 },
    town:    { x: 1020, y: 668, w: 244, h: 40 },
  };
  const _building = (tab) => (typeof TownView !== 'undefined' ? TownView.BUILDINGS.find(q => q.tab === tab) : null);

  /* ── EACH BUILDING IS BUILT UP FROM INSIDE (update154) ──────
   * jj: "upgrade budynków powinien być możliwy jak jesteśmy w danym budynku,
   * workshop jest niepotrzebny". The keeper offers it, one button a kind,
   * and the answer is a question first (jj: "coś w stylu potwierdzenia").
   * The prices and the levels are Base's (`upgradeCost` / `buyUpgrade`). */
  const ROOM_UPGRADES = { HANGAR: ['slot'], CREW: ['barracks'], MESS: ['mess', 'pets'], SUPPLY: ['warehouse'] };
  function upgradeOffer(kind) {
    const cost = Base.upgradeCost?.(kind);
    if (cost == null) return null;
    const O = {
      slot:      { label: '+1 HANGAR BERTH', now: `${Base.shipSlots()} berths`, next: `${Base.shipSlots() + 1} berths` },
      barracks:  { label: '+2 BUNKS',        now: `${Base.barracksCap()} bunks`, next: `${Base.barracksCap() + 2} bunks` },
      mess:      { label: '+1 COMMANDER CHAIR', now: `${Base.messCap?.() ?? 1} chairs`, next: `${(Base.messCap?.() ?? 1) + 1} chairs` },
      pets:      { label: '+1 ANIMAL PEN',   now: `${Base.petCap?.() ?? 2} pens`, next: `${(Base.petCap?.() ?? 2) + 1} pens` },
      warehouse: { label: 'BIGGER SHELF',    now: `${Base.warehouseCap()}/line · ${Base.stashCols()}×${Base.stashRows()}`,
                                             next: `${Base.warehouseCap() + 10}/line · ${Base.stashCols() + 1}×${Base.stashRows()}` },
    }[kind];
    return O ? { kind, cost, can: Base.cc() >= cost, ...O } : null;
  }
  /** Where a room's upgrade buttons stand: in the keeper's box, under his line. */
  function roomUpgradeRects(tab = _tab) {
    const K = ROOM_BAR.keeper, kinds = ROOM_UPGRADES[tab] ?? [];
    const w = Math.floor((K.w - 126 - (kinds.length - 1) * 8) / Math.max(1, kinds.length));
    return kinds.map((kind, i) => ({ kind, x: K.x + 114 + i * (w + 8), y: K.y + 70, w, h: 28 }));
  }

  function _drawRoomHeader(ctx, W, H) {
    const bd = _building(_tab), col = bd?.col ?? '#4db8ff';
    ctx.fillStyle = 'rgba(5,8,14,0.62)'; ctx.fillRect(0, 0, W, 50);
    ctx.fillStyle = col; ctx.fillRect(0, 49, W, 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = col; ctx.font = '22px Orbitron, monospace';
    ctx.fillText(bd?.name ?? _tab, 24, 30);
    ctx.fillStyle = '#7a90a8'; ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText(`HOME BASE — ${bd?.blurb ?? ''}`, 24, 44);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5f7893'; ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('1-9 another building  ·  ESC the town', W - 150, 30);
    ctx.fillStyle = '#1aff8c'; ctx.font = '19px Share Tech Mono, monospace';
    ctx.fillText(`${Base.cc()} CC`, W - 24, 32);
    ctx.textAlign = 'left';
  }

  /** The foot of a room: the keeper and his line, the next contract, LOADOUT, ◀ TOWN. */
  function _drawRoomBar(ctx, W, H, b, onHill = false) {
    const K = ROOM_BAR.keeper, bd = _building(_tab), col = bd?.col ?? '#4db8ff';
    if (!onHill) {
      const kp = (typeof TownView !== 'undefined') ? TownView.keeper(_tab) : null;
      ctx.fillStyle = 'rgba(8,12,20,0.9)'; ctx.fillRect(K.x, K.y, K.w, K.h);
      ctx.strokeStyle = col + '66'; ctx.lineWidth = 1; ctx.strokeRect(K.x + 0.5, K.y + 0.5, K.w - 1, K.h - 1);
      ctx.fillStyle = col; ctx.fillRect(K.x, K.y, 3, K.h);
      if (kp) {
        const pc = (typeof CrewArt !== 'undefined' && CrewArt.portraitCanvas) ? CrewArt.portraitCanvas(kp) : null;
        if (pc) { ctx.save(); ctx.fillStyle = '#1a2436'; ctx.fillRect(K.x + 12, K.y + 8, 88, 88); ctx.imageSmoothingEnabled = false; ctx.drawImage(pc, K.x + 12, K.y + 8, 88, 88); ctx.restore(); }
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e8f4ff'; ctx.font = '13px Share Tech Mono, monospace';
        ctx.fillText(`"${kp.name}"`, K.x + 114, K.y + 26);
        ctx.fillStyle = col; ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(kp.role.toUpperCase(), K.x + 114 + ctx.measureText(`"${kp.name}"  `).width * 1.25, K.y + 26);
        ctx.fillStyle = '#c8d8f0'; ctx.font = '12px Share Tech Mono, monospace';
        const ups = roomUpgradeRects();
        _wrap(ctx, kp.line, K.x + 114, K.y + 52, K.w - 130, 17, ups.length ? 1 : 3);
        ups.forEach(u => {
          const o = upgradeOffer(u.kind);
          if (!o) return;
          _btn(ctx, u.x, u.y, u.w, u.h, o.can ? `▲ ${o.label} — ${o.cost} CC` : `▲ ${o.label} — need ${o.cost} CC`,
               { act: 'upgradeAsk', arg: u.kind, enabled: o.can, col: '#ffb020', font: '10px Share Tech Mono, monospace' });
        });
      }
      // the next contract, in short
      const B = ROOM_BAR.brief, S = _briefSummary();
      const flying = (typeof Save !== 'undefined' && Save.hasShipInFlight && Save.hasShipInFlight());
      ctx.fillStyle = 'rgba(8,12,20,0.9)'; ctx.fillRect(B.x, B.y, B.w, B.h);
      ctx.strokeStyle = '#1e2d4a'; ctx.strokeRect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4db8ff'; ctx.font = '11px Orbitron, monospace';
      ctx.fillText('NEXT CONTRACT', B.x + 12, B.y + 20);
      ctx.fillStyle = S.missionClosed ? '#ff8a95' : '#c8e8ff'; ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText(_clip(ctx, S.mission ? `${S.mission.label} · ${S.mission.sectors} sector${S.mission.sectors > 1 ? 's' : ''} · ${S.mission.boss ? 'BOSS' : 'NO BOSS'}` : '—', B.w - 24), B.x + 12, B.y + 40);
      ctx.fillStyle = S.ship ? '#9fb4d0' : '#ff5566'; ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(_clip(ctx, `${S.ship || 'no ship'} · ${S.commander ? 'cmdr ' + S.commander : 'no commander'} · ${S.crew ? S.crew + ' crew' : 'green hands'}`, B.w - 24), B.x + 12, B.y + 58);
      ctx.fillStyle = S.fuel ? '#9fb4d0' : '#ff5566';
      ctx.fillText(_clip(ctx, `hold ${S.used}/${S.cap} · He2 ${S.fuel} · missiles ${S.missiles} · medkits ${S.heal}`, flying ? B.w - 150 : B.w - 24), B.x + 12, B.y + 76);
      if (flying) _btn(ctx, B.x + B.w - 134, B.y + 66, 122, 30, 'CONTINUE', { act: 'continue', col: '#1aff8c', font: '12px Orbitron, monospace' });
      const L = ROOM_BAR.loadout, ready = !!b.ships[_shipIdx];
      const worst = _briefingChecks().find(c => c.level === 'bad');
      _btn(ctx, L.x, L.y, L.w, L.h, 'LOADOUT  ▶',
           { act: 'loadout', col: flying ? '#ffb020' : worst ? '#ffd700' : '#1aff8c', font: '16px Orbitron, monospace',
             sub: !ready ? 'no ship in the hangar' : flying ? 'a contract is still out there' : 'ship · crew · hold · guns  [ENTER]' });
    }
    const T2 = ROOM_BAR.town;
    _btn(ctx, T2.x, T2.y, T2.w, T2.h, '◀ TOWN  [ESC]', { act: 'town', col: '#9fb4d0', font: '13px Share Tech Mono, monospace' });
  }

  /* ── THE TOWN (update149) ─────────────────────────────────
   * The painting and its labels come from TownView; what is said under
   * a hovered building comes from here, read off the base every frame
   * — the same records the screen behind the door reads. */
  function _townInfo(b) {
    const say = (fn) => { try { return fn(); } catch (e) { return ''; } };
    const pl = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
    const graves = say(() => Save.getGraveyard().filter(g => g && g.buried && !g.enemy).length) || 0;
    const lost = say(() => Save.notRecovered().length) || 0;
    const gate = say(() => GATE_PARTS.filter(pt => _gateHave(pt) >= pt.need).length);
    const hull = b.ships[_shipIdx];
    return {
      hangar:   { status: say(() => `${b.ships.length}/${Base.shipSlots()} berths · ${hull ? (SHIP_CATALOG[hull.key]?.label || hull.key) : 'no ship'}`) },
      armoury:  { status: say(() => `${pl(Base.armoury().length, 'gun')} on the rack`) },
      barracks: { status: say(() => `${b.barracks.length}/${Base.barracksCap()} bunks taken`) },
      mess:     { status: say(() => `${pl((b.commanders ?? []).length, 'commander')} · ${Base.promotable().length} ready for promotion`) },
      supply:   { status: say(() => `${pl(Base.warehouseGrid().items.length, 'stack')} on the shelf`) },
      works:    { status: say(() => { const js = Base.jobs?.() ?? []; return `${pl(js.length, 'offer')} · ${js.filter(j => j.taken).length} taken`; }) },
      wanted:   { status: say(() => `${pl((Save.wanted?.() ?? []).length, 'poster')} on the board`) },
      gate:     { status: say(() => `${gate}/${GATE_PARTS.length} kinds of parts in store · locked in this version`) },
      hill:     { status: `${graves} buried · ${lost} not recovered` },
    };
  }

  function _drawTown(ctx, W, H, b) {
    const r = TownView.draw(ctx, { T: _blink, mx: Input.mouse.x, my: Input.mouse.y, info: _townInfo(b) });
    // the title over the sky
    ctx.fillStyle = 'rgba(4,6,12,.72)';
    ctx.fillRect(0, 0, W, 52);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '22px Orbitron, monospace';
    ctx.fillText('HOME BASE', 26, 35);
    ctx.fillStyle = '#7a90a8';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('Everything you fly out with can be lost. Everything you bring back is kept.', 210, 33);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5f7893';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('click a place  ·  keys 1-9', W - 150, 33);
    ctx.fillStyle = '#1aff8c';
    ctx.font = '19px Share Tech Mono, monospace';
    ctx.fillText(`${Base.cc()} CC`, W - 26, 35);
    ctx.textAlign = 'left';
    if (r.hot) Audio.hoverCue?.(`town:${r.hot}`);
    _drawTownBar(ctx, W, H, b);
    // after the bar's buttons, so a button over a roof is the button
    r.zones.forEach(z => _zones.push({ x: z.x, y: z.y, w: z.w, h: z.h, act: 'building', arg: z.tab }));
  }

  /** The next contract, one strip under the town; LOADOUT and CONTINUE. */
  function _drawTownBar(ctx, W, H, b) {
    const y = 620, h = 88;
    ctx.fillStyle = 'rgba(8,12,20,0.9)';
    ctx.fillRect(20, y, W - 40, h);
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
    ctx.strokeRect(20.5, y + 0.5, W - 41, h - 1);
    const S = _briefSummary();
    const flying = (typeof Save !== 'undefined' && Save.hasShipInFlight && Save.hasShipInFlight());
    const textW = W - 40 - 250 - (flying ? 200 : 0) - 40;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.fillText('NEXT CONTRACT', 40, y + 24);
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.fillStyle = S.missionClosed ? '#ff8a95' : '#c8e8ff';
    ctx.fillText(_clip(ctx, S.mission
      ? `${S.mission.label}  ·  ${S.mission.sectors} sector${S.mission.sectors > 1 ? 's' : ''}  ·  ${S.mission.boss ? 'BOSS' : 'NO BOSS'}`
      : '—', textW), 40, y + 46);
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillStyle = S.ship ? '#9fb4d0' : '#ff5566';
    const crewLine = [
      S.ship || 'no ship in the hangar',
      S.commander ? `commander ${S.commander}` : 'no commander',
      S.crew ? `${S.crew} crew` : 'green hands',
      `He2 ${S.fuel}`, `missiles ${S.missiles}`, `medkits ${S.heal}`,
    ].join('  ·  ');
    ctx.fillText(_clip(ctx, crewLine, textW), 40, y + 66);

    const ready = !!b.ships[_shipIdx];
    const worst = _briefingChecks().find(c => c.level === 'bad');
    _btn(ctx, W - 40 - 230, y + 10, 230, h - 20, 'LOADOUT  ▶',
         { act: 'loadout', col: flying ? '#ffb020' : worst ? '#ffd700' : '#1aff8c',
           font: '18px Orbitron, monospace',
           sub: !ready ? 'no ship in the hangar'
              : flying ? 'a contract is still out there'
              : 'ship · crew · hold · guns  [ENTER]' });
    if (flying) {
      _btn(ctx, W - 40 - 230 - 200, y + 16, 186, h - 32, 'CONTINUE',
           { act: 'continue', col: '#1aff8c', font: '14px Orbitron, monospace', sub: 'back to the contract' });
    }
  }

  /* THE BAR UNDER THE TABS (update111) went with the tab bar in update152:
     its summary and its LOADOUT are at the foot of every room
     (`_drawRoomBar`) and under the town (`_drawTownBar`). */

  /* `maxLines` stops a long blurb walking out of its card and onto
     whatever is printed below it (update71). The measuring test in
     section 232 caught exactly that the day a fourth and fifth
     contract made the cards narrower. The last line it can fit is
     clipped with an ellipsis rather than dropped, so the player can
     see that there was more. */
  function _wrap(ctx, text, x, y, maxW, lh, maxLines = 99) {
    const words = String(text).split(' ');
    let line = '', ly = y, used = 1;
    ctx.textAlign = 'left';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if ((ctx.measureText?.(test)?.width ?? 0) > maxW && line) {
        if (used >= maxLines) { line = _clip(ctx, line + ' ' + w, maxW); break; }
        ctx.fillText(line, x, ly); ly += lh; line = w; used++;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, ly);
    return ly;
  }

  return {
    open, update, draw, consumeLaunch, consumeCpu, consumeLevelUp, packGrids, commitPack,
    liveShelf,
    // exposed for tests
    _levels: _entryLevels,
    // exposed for tests
    _state: () => ({ tab: _tab, town: _town, shipIdx: _shipIdx, picked: [..._picked],
                     commanderId: _commanderId, petId: _petId,
                     fuel: _fuel, missiles: _missiles, mission: _mission,
                     hold: _hold, store: _store, packed: _holdSummary(),
                     yardScroll: _yardScroll, berthScroll: _berthScroll,
                     yardVis: hangarRects().yardVis, berthVis: hangarRects().berthVis, yardPick: _yardPick,
                     promoScroll: _promoScroll, dossierId: _dossierId,
                     crewScroll: _crewScroll, rackScroll: _rackScroll, crateRow: _crateRow, crateSel: _crateSel,
                     confirm: _confirm ? { ..._confirm } : null,
                     loadout: _screen === 'loadout', dest: _screen === 'dest', screen: _screen,
                     hand: _hand ? { kind: _hand.kind, from: _hand.from ?? null, id: _hand.id ?? null,
                                     key: _hand.key ?? null, item: _hand.item ?? null } : null,
                     interior: _interior, roofs: Object.fromEntries(_roofs),
                     hangarStage: _hangarStage ? { ..._hangarStage } : null,
                     posts: { ..._posts }, filter: _filter, shelfView: { ..._shelfView }, destMoon: _destMoon,
                     rename: _rename ? { ..._rename } : null }),
    _set: (o) => {
      if (o.tab !== undefined) { _tab = o.tab; _town = false; _groupLast[_groupOf(o.tab).key] = o.tab; }
      if (o.town !== undefined) _town = !!o.town;
      if (o.confirm !== undefined) _confirm = o.confirm;
      if (o.screen !== undefined) _screen = o.screen;
      if (o.orreryDate !== undefined) _orreryDate = o.orreryDate;
      if (o.posts !== undefined) _posts = { ...o.posts };
      if (o.interior !== undefined) _interior = !!o.interior;
      if (o.roofStep !== undefined) _roofStep = o.roofStep;
      if (o.roofs !== undefined) { _roofs.clear(); Object.entries(o.roofs).forEach(([k, v]) => _roofs.set(k, v)); }
      if (o.rename !== undefined) _rename = o.rename;
      if (o.shipIdx !== undefined) { _shipIdx = o.shipIdx; _buildHold(); }
      if (o.picked !== undefined) _picked = new Set(o.picked);
      if (o.commanderId !== undefined) _commanderId = o.commanderId;
      if (o.petId !== undefined) _petId = o.petId;
      if (o.blink !== undefined) _blink = o.blink;          // the animations' clock (update156: the comet)
      if (o.fuel !== undefined) _fuel = o.fuel;
      if (o.missiles !== undefined) _missiles = o.missiles;
      if (o.mission !== undefined) _mission = o.mission;
      if (o.posterSel !== undefined) _posterSel = o.posterSel;
      if (o.yardScroll !== undefined)  { _yardScroll  = o.yardScroll;  _clampScroll(); }
      if (o.berthScroll !== undefined) { _berthScroll = o.berthScroll; _clampScroll(); }
    },
    _clampScroll,
    _act,
    /** The five groups and their screens (update115). */
    TAB_GROUPS, groupOf: (t) => _groupOf(t).key,
    briefingChecks: () => _briefingChecks(),
    briefSummary: () => _briefSummary(),
    loadoutRects: (W, H) => _loRects(W, H),
    /** The roof strip of the ship in the loadout picture, and the ship (update128). */
    loadoutRoof: () => (_preview ? { band: _loRoofBand(_preview), ship: _preview } : null),
    destRects: (W, H) => _destRects(W, H),
    /** The barracks' pods (update155) and whose file is open. */
    barracksRects, bunkSel: () => _bunkSel,
    /** The commanders' office and the pen (update156). */
    messRects,
    /** The armoury's crates and the gun on its card (update157). */
    armouryRects, crateSel: () => _crateSel,
    /** The Moon Gate: its ring, its signs, its sockets (update158). */
    gateRects, GATE_SIGNS,
    /** The hangar (update154): its geometry, the hull in numbers, her modules, the hull on view. */
    hangarRects, hullFacts, hullModules, yardPick: () => _yardPick,
    /** A building's upgrade, offered inside it (update154). */
    ROOM_UPGRADES, upgradeOffer, roomUpgradeRects,
    wantedRects, posterSel: () => _posterSel,
    dispatchRects, jobSel: () => _jobSel,
    briefingChecks: () => _briefingChecks(),
    supplyRects, SUPPLY_KEYS, liftRuns: () => _lift.map(l => ({ ...l })), shelfSel: () => _shelfSel, LIFT,
    /** The real-time solar system the destination draws (update114). */
    orreryLayout, orreryDistance, ORRERY_PLANETS, ORRERY_MOONS,
    /** The hull drawn in the loadout's stage (rooms in screen coordinates). */
    loadoutShip: () => _preview,
    /* The Gate's parts table and the live count off the shelf — the
       screen and the tests read the same two things (update56). */
    GATE_PARTS,
    gateHave: _gateHave,
    /* ONE SOURCE for the confirm dialog geometry — drawing and hit test
       read this, so the tests can press the very rectangle the player
       sees (the rule from update53). */
    confirmRects: _confirmRects,
    renameRects: _renameRects,
    /* The click zones the last draw() produced, so a test can assert
       what a button will actually DO — not just that _act does the
       right thing when handed the right argument. A scrolled list that
       hands back a VISIBLE index is invisible to a test that calls
       _act directly, and that is exactly the bug this catches. */
    _zonesFor: (act) => _zones.filter(z => z.act === act)
                              .map(z => ({ x: z.x, y: z.y, w: z.w, h: z.h, arg: z.arg })),
    _graves: () => _graveZones.map(z => ({ x: z.x, y: z.y, w: z.w, h: z.h,
                                          name: z.g.name, tier: _graveTier(z.g).key,
                                          score: _heroScore(z.g) })),
  };
})();

if (typeof window !== 'undefined') window.BaseScreen = BaseScreen;
