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
    { key: 'STORES',  tabs: [['SUPPLY', 'SUPPLY']] },
    { key: 'BASE',    tabs: [['UPGRADES', 'UPGRADES']] },
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
  const CREW_COLS  = 3;
  const CREW_ROWS  = 3;              // visible rows of bunk cards
  const CREW_VIS   = CREW_COLS * CREW_ROWS;
  /* Promotion candidates visible at once. The panel is 386px tall and
     a candidate card is 84 — three fit under the heading with the
     scrollbar, and the fourth would be drawn off the panel, which is a
     candidate the player cannot reach. */
  const PROMO_ROWS = 3;
  const YARD_VIS   = 3;
  const BERTH_VIS  = 1;
  let _scrollRects = { yard: null, berth: null };   // set by _drawHangar

  function open() {
    const b = Base.get();
    _tab = 'HANGAR'; _groupLast = {};
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
    const yardMax  = Math.max(0, (Base.catalog?.() ?? []).length - YARD_VIS);
    const berthMax = Math.max(0, b.ships.length - BERTH_VIS);
    _yardScroll  = Utils.clamp(_yardScroll,  0, yardMax);
    _berthScroll = Utils.clamp(_berthScroll, 0, berthMax);
    const crewRows = Math.ceil((b.barracks?.length ?? 0) / CREW_COLS);
    _crewScroll = Utils.clamp(_crewScroll, 0, Math.max(0, crewRows - CREW_ROWS));
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
    if (!_screen && !modal && _tab === 'HANGAR' && Input.isPressed('KeyI')) return _act('interior');
    if (wheel && _tab === 'CREW') {
      _crewScroll += wheel > 0 ? 1 : -1;
      _clampScroll();
      return null;
    }
    if (wheel && _tab === 'ARMOURY') {
      _rackScroll += wheel > 0 ? 1 : -1;
      _clampScroll();
      return null;
    }
    if (wheel && _tab === 'HANGAR') {
      const step = wheel > 0 ? 1 : -1;
      const mx = Input.mouse.x, my = Input.mouse.y;
      for (const [name, r] of Object.entries(_scrollRects)) {
        if (!r || !Utils.pointInRect(mx, my, r.x, r.y, r.w, r.h)) continue;
        if (name === 'yard') _yardScroll += step; else _berthScroll += step;
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
      case 'tab':      _tab = arg; _groupLast[_groupOf(arg).key] = arg; break;
      case 'tabGroup': {
        const g = TAB_GROUPS.find(q => q.key === arg);
        if (g) _tab = _groupLast[g.key] || g.tabs[0][0];
        break;
      }
      /* The berth click is REFUSED when the packed hold cannot follow
         the player to the new hull — otherwise the crates that fit
         nowhere would be dropped on the floor. */
      case 'ship': {
        const was = _shipIdx;
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
      case 'destGate':    _screen = null; _tab = 'GATE'; break;
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
      case 'buyShip':  { const r = Base.buyShip(arg); _say(r.message, r.ok); _clampScroll(); _syncStore(); break; }
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
      case 'hire': { const r = Base.hireRecruit(); _say(r.message, r.ok);
        // Show the last page, where the new hand just landed.
        if (r.ok) _crewScroll = 9999;
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
      case 'buy': { const r = Base.buySupply(arg[0], arg[1]); _say(r.message, r.ok); _syncStore(); break; }
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

  function _panel(ctx, x, y, w, h, title) {
    ctx.fillStyle = 'rgba(10,14,26,0.92)';
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

    Renderer.drawBackground(0);
    ctx.fillStyle = 'rgba(7,8,15,0.82)';
    ctx.fillRect(0, 0, W, H);

    // Title + bank
    ctx.fillStyle = '#4db8ff';
    ctx.font = '26px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('HOME BASE', 40, 52);
    ctx.fillStyle = '#7a90a8';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('Everything you fly out with can be lost. Everything you bring back is kept.', 40, 72);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#1aff8c';
    ctx.font = '20px Share Tech Mono, monospace';
    ctx.fillText(`${Base.cc()} CC`, W - 40, 52);

    // Tabs: five groups on the left, the open group's screens on the right.
    const grp = _groupOf(_tab);
    TAB_GROUPS.forEach((g, i) => {
      _btn(ctx, 40 + i * 158, 92, 150, 30, g.key,
           { on: g === grp, act: 'tabGroup', arg: g.key, font: '13px Orbitron, monospace' });
    });
    if (grp.tabs.length > 1) {
      const SW = 116, SG = 6;
      const x0 = W - 40 - grp.tabs.length * (SW + SG) + SG;
      grp.tabs.forEach(([t, label], i) => {
        const x = x0 + i * (SW + SG), on = _tab === t;
        _btn(ctx, x, 95, SW, 24, label, { on, act: 'tab', arg: t, col: on ? '#4db8ff' : '#7a90a8',
             font: '11px Share Tech Mono, monospace' });
      });
      // a hair-line from the end of the group row to the sub-tabs (never through a button)
      const gx = 40 + (TAB_GROUPS.length - 1) * 158 + 150;
      ctx.strokeStyle = 'rgba(77,184,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx + 4, 107.5); ctx.lineTo(x0 - 8, 107.5); ctx.stroke();
    }

    const px = 40, py = 138, pw = W - 80, ph = 386;
    _panel(ctx, px, py, pw, ph, null);

    /* Under the briefing (update138) the tabs are not drawn at all: it
       covers the whole screen, and the hangar under it was building a
       second picture of the same ship every frame. */
    if (!_screen) {
      if (_tab === 'HANGAR')   _drawHangar(ctx, px, py, pw, ph, b);
      if (_tab === 'ARMOURY')  _drawArmoury(ctx, px, py, pw, ph, b);
      if (_tab === 'CREW')     _drawCrew(ctx, px, py, pw, ph, b);
      if (_tab === 'MESS')     _drawMess(ctx, px, py, pw, ph, b);
      if (_tab === 'SUPPLY')   _drawSupply(ctx, px, py, pw, ph, b);
      if (_tab === 'UPGRADES') _drawUpgrades(ctx, px, py, pw, ph, b);
      if (_tab === 'MEMORIAL') _drawMemorial(ctx, px, py, pw, ph);
      if (_tab === 'WANTED')   _drawWanted(ctx, px, py, pw, ph);
      if (_tab === 'GATE')     _drawGate(ctx, px, py, pw, ph);
    }

    _drawLaunchBar(ctx, W, H, b);

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

      _btn(ctx, r.yes.x, r.yes.y, r.yes.w, r.yes.h, 'SELL',
           { act: 'confirmYes', col: '#ffb020' });
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
  /* ── THE WANTED BOARD (update64) ──────────────────────────
   *
   * A READ of `Save.wanted()`, every frame, and nothing else. No copy
   * kept here, no list rebuilt on tab change — this screen cannot
   * disagree with the fight, because it is looking at the same record
   * the fight stamps.
   *
   * DELIBERATELY NO BUTTONS. There is nothing to press: a poster is
   * closed by flying out and bringing the man back, not by clicking
   * on him. Same rule as the Gate above.
   */
  let _wantedCache = null;   // never set: see the note above
  function _drawWanted(ctx, px, py, pw, ph) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7a90a8';
    ctx.font = '13px Orbitron, monospace';
    ctx.fillText('WANTED', px + 16, py + 26);
    ctx.fillStyle = '#4a6080';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('The yard pays for these names. Alive is worth double a body — '
               + 'and a body has to come home in the hold.', px + 16, py + 44);

    const list = (typeof Save !== 'undefined' && Save.wanted) ? Save.wanted() : [];
    if (!list.length) {
      ctx.fillStyle = '#3d4a63';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText('The board is empty. Finish a contract and the yard will find somebody.',
                   px + 16, py + 90);
      return;
    }

    /* POSTERS (update141). It was a list of grey rows; the men have faces
       since 124 — the same face hails you (136) and hangs on his map node
       (139). Up to WANTED_MAX side by side: the face, the name under his
       house's sign, where to meet him, where he was seen, and the price. */
    const N = Math.max(1, Math.min(list.length, Save.WANTED_MAX ?? 4));
    const GAPW = 16, cw = Math.floor((pw - 32 - GAPW * (Math.max(N, 4) - 1)) / Math.max(N, 4));
    const top = py + 60, chH = ph - 60 - 30;
    list.slice(0, N).forEach((w, i) => {
      const x = px + 16 + i * (cw + GAPW), y = top;
      const corp = (typeof CORP_DEFS !== 'undefined' && CORP_DEFS[w.race]) || {};
      const sighted = w.state === 'sighted';
      // the paper
      ctx.fillStyle = '#16120c';
      ctx.fillRect(x, y, cw, chH);
      ctx.strokeStyle = sighted ? '#ffd700' : '#6a4a2a'; ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, chH - 1);
      ctx.fillStyle = 'rgba(255,154,77,0.06)'; ctx.fillRect(x + 4, y + 4, cw - 8, chH - 8);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff9a4d'; ctx.font = '16px Orbitron, monospace';
      ctx.fillText('WANTED', x + cw / 2, y + 26);
      // the face
      const S = 96, fx = x + cw / 2 - S / 2, fy = y + 38;
      ctx.fillStyle = '#05070d'; ctx.fillRect(fx - 3, fy - 3, S + 6, S + 6);
      ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 1; ctx.strokeRect(fx - 2.5, fy - 2.5, S + 5, S + 5);
      if (typeof CrewArt !== 'undefined') {
        ctx.save(); ctx.imageSmoothingEnabled = false;
        CrewArt.portrait(ctx, fx, fy, '#a83a44', CrewArt.faceOf(CrewArt.seedOf({ name: w.name, race: w.race }), w.race ?? null), S);
        ctx.restore();
      }
      // the name, under his house's sign
      ctx.font = '13px Orbitron, monospace';
      const nm = _clip(ctx, w.name, cw - 36);
      const nw = ctx.measureText(nm).width;
      const gx = x + cw / 2 - (nw + 18) / 2;
      if (Renderer.drawCorpGlyph) Renderer.drawCorpGlyph(ctx, { race: w.race, name: w.name }, gx, fy + S + 10, 14);
      ctx.fillStyle = '#e8d8c0'; ctx.textAlign = 'left';
      ctx.fillText(nm, gx + 18, fy + S + 22);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9a8a70'; ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`${corp.label || w.race} · level ${w.level}`, x + cw / 2, fy + S + 38);
      /* WHICH CONTRACT TO TAKE TO MEET HIM (update70) — read from
         MISSIONS, the same word the launch bar says. */
      const job = (typeof MISSIONS !== 'undefined' && MISSIONS[w.mission]?.label) || 'any contract';
      ctx.fillStyle = '#4db8ff';
      ctx.fillText(_clip(ctx, `on ${job}`, cw - 16), x + cw / 2, fy + S + 52);
      /* WHERE HE WAS SEEN, or that nobody has met him yet. */
      const reg = (typeof Save !== 'undefined' && Save.REGIONS?.[w.region]?.label) || null;
      const where = reg ? (w.sector ? `${reg}, sector ${w.sector}` : reg) : null;
      ctx.fillStyle = sighted ? '#ffd700' : '#5a5040';
      ctx.fillText(_clip(ctx, sighted ? (where ? `last seen: ${where}` : 'sighted') : 'no sighting yet', cw - 16), x + cw / 2, fy + S + 66);
      // THE TWO PRICES, from ONE figure — the body is half, computed here.
      ctx.fillStyle = 'rgba(26,255,140,0.08)'; ctx.fillRect(x + 10, y + chH - 46, cw - 20, 36);
      ctx.fillStyle = '#1aff8c'; ctx.font = '15px Share Tech Mono, monospace';
      ctx.fillText(`${w.bounty} CC alive`, x + cw / 2, y + chH - 26);
      ctx.fillStyle = '#7a90a8'; ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`${Math.round(w.bounty / 2)} CC for the body`, x + cw / 2, y + chH - 13);
      ctx.textAlign = 'left';
    });
    // an empty peg for every poster still to go up
    for (let i = N; i < (Save.WANTED_MAX ?? 4); i++) {
      const x = px + 16 + i * (cw + GAPW);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#2a2418'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 0.5, cw - 1, chH - 1); ctx.setLineDash([]);
      ctx.fillStyle = '#3a3428'; ctx.font = '10px Share Tech Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText('a name goes up after a contract', x + cw / 2, top + chH / 2);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#3d4a63';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`${list.length} of ${Save.WANTED_MAX} posters — a new name goes up `
               + 'after every contract.', px + 16, py + ph - 14);
  }

  function _drawGate(ctx, px, py, pw, ph) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7a90a8';
    ctx.font = '13px Orbitron, monospace';
    ctx.fillText('MOON GATE', px + 16, py + 26);
    ctx.fillStyle = '#4a6080';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('A ring wide enough to throw a hull at another moon.',
                 px + 16, py + 44);

    // ── the schematic: an unfinished ring, drawn dark ──
    const cx = px + 150, cy = py + 190, R = 96;
    ctx.strokeStyle = '#2a3346';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    /* The lit arc is the FRACTION of the whole job that is on the shelf
       — the same numbers as the list on the right, drawn round. It is
       the one part of this screen that moves as you play. */
    const done = GATE_PARTS.reduce((a, p) =>
      a + Math.min(1, _gateHave(p) / p.need), 0) / GATE_PARTS.length;
    ctx.strokeStyle = '#5f7893';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * done);
    ctx.stroke();
    ctx.strokeStyle = '#1e2d4a';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R - 18, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5f7893';
    ctx.font = '20px Orbitron, monospace';
    ctx.fillText(`${Math.round(done * 100)}%`, cx, cy + 7);
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillStyle = '#3d4a63';
    ctx.fillText('ASSEMBLED', cx, cy + 24);
    ctx.textAlign = 'left';

    // ── the parts list ──
    const lx = px + 300;
    ctx.fillStyle = '#5f7893';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('COMPONENTS — from the warehouse shelf', lx, py + 74);

    GATE_PARTS.forEach((part, i) => {
      const y = py + 100 + i * 40;
      const have = _gateHave(part);
      const full = have >= part.need;
      ctx.fillStyle = full ? '#5f7893' : '#4a6080';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText(part.label, lx, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = full ? '#8a8d93' : '#3d4a63';
      ctx.fillText(`${have}/${part.need}`, lx + 300, y);
      ctx.textAlign = 'left';
      // progress rail
      ctx.fillStyle = '#141a28';
      ctx.fillRect(lx, y + 6, 300, 5);
      ctx.fillStyle = '#3d4a63';
      ctx.fillRect(lx, y + 6, Math.round(300 * Math.min(1, have / part.need)), 5);
      ctx.fillStyle = '#39445c';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(part.from, lx, y + 24);
    });

    /* ── WHERE IT LEADS (update58) ─────────────────────────
       A locked door with nothing behind it is a blank wall, not a
       promise. The moons the Gate opens are named here, greyed, with
       the one we can already reach marked as open. Read off Save's
       region table and Save's unlocked list — the screen invents
       nothing, so the day the Gate really opens one, this follows
       without being touched. */
    {
      const R  = (typeof Save !== 'undefined' && Save.regions) ? Save.regions() : {};
      /* ON THE RIGHT, one column (update114): with the Martian moons the
         list is nine long — under the ring it ran into the ring and, in two
         columns, into the parts list. The right half of the panel was empty. */
      const dx = px + 700, dy0 = py + 74;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5f7893';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText('DESTINATIONS', dx, dy0);

      Object.values(R).forEach((reg, i) => {
        const open = (typeof Save !== 'undefined' && Save.regionUnlocked)
          ? Save.regionUnlocked(reg.key) : !!reg.home;
        const xx = dx, yy = dy0 + 20 + i * 18;
        ctx.fillStyle = open ? '#8a8d93' : '#39445c';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(open ? '●' : '○', xx, yy);
        ctx.fillText(reg.label, xx + 14, yy);
        ctx.fillStyle = open ? '#5f7893' : '#2f3950';
        ctx.fillText(open ? 'open' : `locked · ${reg.body}`, xx + 100, yy);
      });
    }

    /* THE ONE LINE THAT MATTERS, and no button under it. */
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7a90a8';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('Construction is not available in this version — keep the parts.',
                 px + pw / 2, py + ph - 20);
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


  function _shipRow(ctx, x, y, w, h, opts) {
    const { label, on = false, lines = [], act, arg, btnLabel, btnCol = '#4db8ff',
            btnAct, btnArg, btnEnabled = true, btnSub = null, key, badge = null,
            bigThumb = false } = opts;
    ctx.fillStyle = on ? 'rgba(26,140,255,0.16)' : 'rgba(13,17,32,0.9)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill();
    ctx.strokeStyle = on ? '#4db8ff' : '#1e2d4a'; ctx.lineWidth = on ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.stroke();

    const tw = bigThumb ? 104 : 82, th = bigThumb ? 50 : 34;
    // Closed in the yard; the pointer on the card opens her (update118).
    const over = Utils.pointInRect(Input.mouse.x, Input.mouse.y, x, y, w, h);
    const roof = key ? _roofEase(`row:${key}:${x},${y}`, over ? 0 : 1) : 0;
    if (key) Renderer.drawShipThumb(ctx, key, x + w - tw - 10, y + 10, tw, th,
                                    { rooms: opts.rooms, levels: opts.levels, roof });
    /* WHOSE YARD (update117): the builder under the picture, in the
       corporation's colour — the same colour the plate is painted in. */
    const yard = key && typeof hullBuilder === 'function' ? hullBuilder(key) : null;
    if (yard) {
      ctx.textAlign = 'left';
      ctx.fillStyle = CORP_DEFS[yard]?.color ?? '#7a90a8';
      ctx.font = '8px Share Tech Mono, monospace';
      ctx.fillText(CORP_DEFS[yard].label.toUpperCase(), x + w - tw - 10, y + 10 + th + 9);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = on ? '#c8e8ff' : '#9fb4cc';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.fillText(label, x + 12, y + 20);
    // Text stops where the thumbnail starts — a blurb that ran under the
    // picture looked like two overlapping sentences.
    const textW = (key ? w - tw - 10 : w) - 24;
    ctx.font = '10px Share Tech Mono, monospace';
    /* A BLURB OVER TWO LINES (update141): one line cut the yard's words at
       twenty letters — "Free refit of a r…". A single `wrap` line gets two
       short lines in 9 px, the second clipped, both clear of the button. */
    if (opts.wrap && lines.length === 1) {
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillStyle = lines[0].col || '#7a90a8';
      const words = String(lines[0].text).split(' ');
      let a = '';
      while (words.length && ctx.measureText((a ? a + ' ' : '') + words[0]).width <= textW) a = (a ? a + ' ' : '') + words.shift();
      ctx.fillText(a, x + 12, y + 33);
      if (words.length) ctx.fillText(_clip(ctx, words.join(' '), textW), x + 12, y + 44);
    } else lines.forEach((ln, i) => {
      ctx.fillStyle = ln.col || '#7a90a8';
      ctx.fillText(_clip(ctx, ln.text, textW), x + 12, y + 36 + i * 13);
    });

    if (badge) {
      ctx.textAlign = 'right';
      ctx.fillStyle = on ? '#4db8ff' : '#3d4a63';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(badge, x + w - 12, y + h - 14);
      ctx.textAlign = 'left';
    }
    if (btnLabel) {
      _btn(ctx, x + 12, y + h - 32, 108, 24, btnLabel,
           { act: btnEnabled ? btnAct : null, arg: btnArg, enabled: btnEnabled,
             col: btnCol, sub: btnSub });
    }
    if (act) _zones.push({ x, y, w, h: h - 34, act, arg });
  }

  const MOD_LABEL = {
    engines: 'Engines', weapons: 'Weapons', shields: 'Shields',
    piloting: 'Cockpit', oxygen: 'Life sup.', medbay: 'Medbay',
    reactor: 'Reactor', cloaking: 'Cloak', autorepair: 'Autorepair',
    artillery: 'Artillery',
  };

  const MOD_COL = {
    engines:'#1aff8c', weapons:'#ff5566', shields:'#4db8ff', piloting:'#9fdcff',
    oxygen:'#4dd8ff',  medbay:'#3aff6a',  reactor:'#ffb020', cloaking:'#cc44ff',
    autorepair:'#ffd700', artillery:'#ff7c20',
  };

  /**
   * ONE module readout.
   *
   *      ⚙  ▪▪▪▪▪        ← pips sit ON TOP of the name
   *         Engines
   *
   * The glyph is drawn as tall as the pips and the name TOGETHER, so the
   * icon reads as the block's anchor rather than a stray character.
   * `pipCap` is how many pips fit before it starts counting in text —
   * the reactor gets its own wide line precisely because it needs more.
   *
   * Returns the height of the block.
   */
  function _moduleCell(ctx, x, y, w, m, pipCap = 8) {
    const col = MOD_COL[m.type] || '#7a90a8';
    const ICON = 20;                     // pips (7) + gap (3) + name (10)
    const tx = x + ICON + 4, tw = w - ICON - 6;

    // The glyph, vertically centred on the whole block.
    ctx.textAlign = 'left';
    ctx.fillStyle = col;
    ctx.font = `${ICON - 2}px Share Tech Mono, monospace`;
    ctx.fillText(Renderer.systemGlyph(m.type), x, y + ICON - 3);

    // Pips FIRST, on the top line: one per power slot, red where the
    // module is shot out.
    const shown = Math.min(m.level, pipCap);
    for (let l = 0; l < shown; l++) {
      ctx.fillStyle = l < (m.level - (m.damaged ?? 0)) ? col : '#ff2d44';
      ctx.fillRect(tx + l * 5, y, 4, 7);
    }
    if (m.level > shown) {
      ctx.fillStyle = col;
      ctx.font = '8px Share Tech Mono, monospace';
      ctx.fillText(`+${m.level - shown}`, tx + shown * 5 + 2, y + 7);
    }

    // Name UNDER the pips, clipped to its own column so two neighbours
    // can never print over each other.
    ctx.fillStyle = '#9fb4cc';
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillText(_clip(ctx, MOD_LABEL[m.type] || m.type, tw), tx, y + ICON - 2);
    return ICON;
  }

  /**
   * The module readout under the berth card: three per line, and the
   * REACTOR always alone on a line of its own at the end — it carries
   * the highest level and the longest pip run, so sharing a line with
   * anything else guaranteed a collision.
   */
  /**
   * HULL, in the same square-per-point grammar the modules use.
   *
   * "Hull 22" as a number told you what the hull COULD be; it never told
   * you what this particular veteran hull actually has left after the
   * last contract. Squares do, at a glance, next to everything else that
   * is drawn as squares.
   */
  function _hullStrip(ctx, x, y, w, entry) {
    const sh = _entryShip(entry);
    if (!sh) return y;
    const hull = Math.max(0, Math.round(sh.hull));
    const max  = Math.max(1, Math.round(sh.hullMax));
    const pct  = hull / max;
    const col  = pct > 0.6 ? '#1aff8c' : pct > 0.3 ? '#ffb020' : '#ff2d44';

    ctx.textAlign = 'left';
    ctx.fillStyle = '#5f7893';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('HULL', x, y);
    ctx.fillStyle = col;
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${hull} / ${max}`, x + w, y);
    ctx.textAlign = 'left';

    // One square per hull point where they fit; otherwise one square per
    // N points, so a 40-hull freighter still reads as one row.
    const PW = 5, GAP = 1;
    const maxPips = Math.max(8, Math.floor(w / (PW + GAP)));
    const per = Math.max(1, Math.ceil(max / maxPips));
    const pips = Math.ceil(max / per);
    const lit  = Math.ceil(hull / per);
    for (let i = 0; i < pips; i++) {
      const bx = x + i * (PW + GAP);
      if (i < lit) {
        ctx.fillStyle = col;
        ctx.fillRect(bx, y + 6, PW, 8);
      } else {
        ctx.fillStyle = 'rgba(255,45,68,0.18)';
        ctx.fillRect(bx, y + 6, PW, 8);
        ctx.strokeStyle = 'rgba(255,45,68,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, y + 6.5, PW - 1, 7);
      }
    }
    if (per > 1) {
      ctx.fillStyle = '#4a6080';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(`${per} hull per square`, x + pips * (PW + GAP) + 6, y + 14);
    }
    return y + 28;
  }

  function _moduleStrip(ctx, x, y, w, entry) {
    const all  = _entryLevels(entry);
    const mods = all.filter(m => m.type !== 'reactor');
    const empties = _entryRooms(entry).filter(r => r.type === 'empty').length;

    // HULL first — it is the one number that decides whether this hull
    // survives the next contract.
    y = _hullStrip(ctx, x, y, w, entry);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#5f7893';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('MODULES', x, y);

    const perRow = 3, cw = Math.floor(w / perRow), PITCH = 28;
    mods.forEach((m, i) => {
      _moduleCell(ctx, x + (i % perRow) * cw, y + 12 + Math.floor(i / perRow) * PITCH,
                  cw - 4, m, 8);
    });

    const rows = Math.ceil(mods.length / perRow);
    let by = y + 12 + rows * PITCH;

    // ── the reactor, in its own paragraph ──
    ctx.strokeStyle = 'rgba(255,176,32,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + w, by); ctx.stroke();
    by += 8;
    const reactor = _entryReactor(entry);
    _moduleCell(ctx, x, by, w, { type: 'reactor', level: reactor, damaged: 0 }, 20);
    by += 32;                       // clear of the reactor's own NAME line

    const draw = mods.reduce((n, m) => n + m.level, 0);
    ctx.fillStyle = '#ffb020';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`${reactor} power  ·  ${draw} slots to fill`, x, by);
    by += 14;
    ctx.fillStyle = empties ? '#ffd700' : '#4a6080';
    ctx.fillText(empties ? `${empties} empty bay${empties > 1 ? 's' : ''} — room to fit more`
                         : 'every bay is fitted', x, by);
    return by + 6;
  }

  function _drawHangar(ctx, px, py, pw, ph, b) {
    // Shipyard on the LEFT (what you could buy), your berths on the
    // RIGHT (what you own), and the selected hull drawn full size in
    // the middle so it is obvious what you are about to fly.
    const COL = 268;
    const CARD = COL - 16;              // the scrollbar lives in the last 16px
    const yardX  = px + 16;
    const berthX = px + pw - COL - 16;
    const PITCH  = 90;                  // 84-tall card + 6 of air

    _clampScroll();
    const catalog = Base.catalog();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.fillText('SHIPYARD', yardX, py + 22);
    ctx.fillText(`YOUR HANGAR — ${b.ships.length}/${Base.shipSlots()} berths`,
                 berthX, py + 22);

    // ── LEFT: for sale — three at a time, scroll for the rest ──
    const yardTop = py + 32, yardH = YARD_VIS * PITCH - 6;
    _scrollRects.yard = { x: yardX, y: yardTop, w: COL, h: yardH };
    catalog.slice(_yardScroll, _yardScroll + YARD_VIS).forEach((def, vi) => {
      const owned = b.ships.some(s2 => s2.key === def.key);
      const room  = b.ships.length < Base.shipSlots();
      const can   = !owned && room && Base.cc() >= def.cost;
      _shipRow(ctx, yardX, yardTop + vi * PITCH, CARD, 84, {
        label: def.label, key: def.key,
        rooms: SHIP_LAYOUTS[def.key]?.rooms.map(r => ({ id: r.id, type: r.type })),
        levels: _entryLevels({ key: def.key, data: null }),
        lines: [{ text: def.blurb || '' }], wrap: true,
        btnLabel: owned ? 'OWNED' : (def.cost ? `BUY — ${def.cost} CC` : 'STANDARD'),
        btnAct: 'buyShip', btnArg: def.key, btnEnabled: can, btnCol: '#1aff8c',
        btnSub: owned ? 'you own one' : (!room ? 'no berth' : null),
        bigThumb: true,
      });
    });
    _scrollBar(ctx, yardX + CARD + 4, yardTop, yardH,
               _yardScroll, YARD_VIS, catalog.length, 'scrollYard');

    // ── RIGHT: what you own — ONE berth on screen, so the module
    //    readout underneath always has the room it needs ──
    const berthTop = py + 32, berthH = BERTH_VIS * PITCH - 6;
    _scrollRects.berth = { x: berthX, y: berthTop, w: COL, h: berthH };
    if (!b.ships.length) {
      ctx.fillStyle = '#ff5566';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText('Hangar empty — buy a hull on the left.', berthX, py + 50);
    }
    b.ships.slice(_berthScroll, _berthScroll + BERTH_VIS).forEach((entry, vi) => {
      const i = _berthScroll + vi;
      const def = SHIP_CATALOG[entry.key] || { label: entry.key };
      const L   = SHIP_LAYOUTS[entry.key];
      const resale = Math.round((SHIP_CATALOG[entry.key]?.cost ?? 0) * 0.30);
      const canSell = b.ships.length > 1;
      _shipRow(ctx, berthX, berthTop + vi * PITCH, CARD, 84, {
        label: def.label, on: i === _shipIdx, key: entry.key,
        rooms: _entryRooms(entry), levels: _entryLevels(entry),
        lines: [
          { text: L ? `Hull ${L.hullMax} · ${L.floors} decks · ${L.rooms.length} bays` : '' },
          { text: entry.data ? 'veteran hull — upgrades kept' : 'factory fresh',
            col: entry.data ? '#1aff8c' : '#4a6080' },
        ],
        act: 'ship', arg: i,
        badge: i === _shipIdx ? 'SELECTED' : 'click to select',
        btnLabel: canSell ? `SELL ${resale}` : 'LAST HULL',
        btnAct: 'sellShip', btnArg: i, btnEnabled: canSell, btnCol: '#ffb020',
        bigThumb: true,
      });
    });
    _scrollBar(ctx, berthX + CARD + 4, berthTop, berthH,
               _berthScroll, BERTH_VIS, b.ships.length, 'scrollBerth');

    // Module readout for the SELECTED hull, under the berth list.
    if (b.ships[_shipIdx]) {
      _moduleStrip(ctx, berthX, berthTop + berthH + 22, CARD, b.ships[_shipIdx]);
    }

    // ── MIDDLE: the actual ship, at 1:1 ──
    // Everything below the hull has a RESERVED band; the hull is scaled
    // into what is left. The three-deck Horus used to run over the
    // module strip and the crew line both.
    const stageX = yardX + COL + 24;
    const stageW = berthX - stageX - 24;
    const cx = stageX + stageW / 2;

    // The module strip moved OUT of the middle and under the berth list
    // on the right — it is per-ship information and belongs with the
    // ship card. That frees the whole panel height for the hull, so
    // nothing has to be shrunk to fit any more.
    const TOP_Y   = py + 52;            // below the name + stat line
    const BOT_Y   = py + ph - 30;       // above the crew / repair row
    const availH  = BOT_Y - TOP_Y;
    // The guns hang ~46px above the plating, so the hull is centred a
    // little LOW — otherwise the barrels climb over the stat line.
    const cy      = TOP_Y + availH / 2 + 20;

    const sh = _previewShip(cx, cy);
    if (!sh) {
      ctx.fillStyle = '#3d4a63';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No hull selected.', cx, cy);
      return;
    }
    /* SHE IS MOORED AT HOME (update148, jj: "jakby statek był zadokowany do
       stacji na księżycu"): the bay on the moon behind her, the cradle, the
       gantry and the tube worked out from her own hull. */
    if (typeof DockArt !== 'undefined') DockArt.draw(ctx, { x: stageX, y: py + 2, w: stageW, h: ph - 4 }, sh);

    const entry = b.ships[_shipIdx];
    const def   = SHIP_CATALOG[entry.key] || { label: entry.key };
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c8e8ff';
    ctx.font = '15px Orbitron, monospace';
    ctx.fillText(def.label, cx, py + 22);
    ctx.fillStyle = '#5f7893';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`Hull ${sh.hullMax}  ·  Reactor ${sh.reactor?.level ?? '—'}  ·  `
               + `Hold ${sh.cargo ? sh.cargo.cols + 'x' + sh.cargo.rows : '—'}`,
                 cx, py + 38);
    const yard = typeof hullBuilder === 'function' ? hullBuilder(entry.key) : null;
    if (yard) {
      ctx.fillStyle = CORP_DEFS[yard]?.color ?? '#5f7893';
      ctx.fillText(BUILDER_TRAITS[yard].blurb, cx, py + 51);
    }

    /* CLOSED UNTIL YOU LOOK INSIDE (update118): the pointer anywhere on
       the stage, or INTERIOR [I], takes the roof off. */
    _hangarStage = { x: stageX, y: TOP_Y, w: stageW, h: availH };
    const onStage = Utils.pointInRect(Input.mouse.x, Input.mouse.y, stageX, TOP_Y, stageW, availH);
    sh.roofAlpha = _roofEase('hangar', (onStage || _interior) ? 0 : 1);
    _btn(ctx, stageX, py + 8, 118, 22, _interior ? 'EXTERIOR  [I]' : 'INTERIOR  [I]',
         { act: 'interior', on: _interior, font: '10px Share Tech Mono, monospace' });

    // ALWAYS 1:1. What you see here is the hull at the size it flies at.
    try { sh.draw(ctx); } catch (e) { /* a preview must never kill the screen */ }

    const aboard = sh.crew.length;
    const rowY = py + ph - 20;
    ctx.textAlign = 'left';
    ctx.fillStyle = aboard ? '#1aff8c' : '#ffb020';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(aboard ? `${aboard} crew aboard` : 'no crew picked — green hands sign on',
                 stageX, rowY);

    // Yard repairs sit at the RIGHT of the same row, never on the text.
    const q = Base.hullRepairQuote?.(_shipIdx);
    if (q) {
      const can = Base.cc() >= Base.HULL_REPAIR_PRICE;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ff5566';
      ctx.fillText(`HULL ${q.hull}/${q.hullMax}`, stageX + stageW - 150, rowY);
      _btn(ctx, stageX + stageW - 140, rowY - 16, 140, 22,
           can ? `WELD — ${q.cost} CC` : `needs ${q.cost} CC`,
           { act: can ? 'repairHull' : null, enabled: can, col: '#1aff8c' });
    } else {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1aff8c';
      ctx.fillText('hull sound', stageX + stageW, rowY);
    }
  }

  // ── Tab: ARMOURY ────────────────────────────────────────
  //  Left: the mounts on the selected hull. Right: the rack.
  function _drawArmoury(ctx, px, py, pw, ph, b) {
    const entry   = b.ships[_shipIdx];
    const shipDef = entry ? SHIP_CATALOG[entry.key] : null;

    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`MOUNTS — ${shipDef ? shipDef.label : 'no ship selected'}`, px + 16, py + 24);
    ctx.fillText('ARMOURY RACK', px + 560, py + 24);

    if (!entry) {
      ctx.fillStyle = '#ff5566';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.fillText('Buy a hull in the HANGAR first.', px + 16, py + 56);
      return;
    }

    // ── mounts ──
    const fitted = Base.shipWeapons(_shipIdx);
    const slots  = Base.shipSlotCount(_shipIdx);
    // Taller rows than before: the stat chips need two lines of their
    // own, and cramming them beside the name is what produced the old
    // "3 dmg · 10s · ⚡2" mush.
    const ROW_H = 84, PITCH = 92;
    for (let i = 0; i < slots; i++) {
      const y   = py + 40 + i * PITCH;
      const gun = fitted.find(f => f.slot === i);
      const def = gun ? getWeaponDef(gun.defKey) : null;
      if (def) {
        /* THE ONE WEAPON CARD (update112) — icon, name, type and the stat
           chips, the same card the rack, the loadout and the offer use. */
        Renderer.drawWeaponCard(ctx, gun.defKey, px + 16, y, 'M',
          { w: 500, h: ROW_H, on: true, corner: `MOUNT ${i + 1}`, reserve: 112, chipRows: 3 });
        _btn(ctx, px + 406, y + 27, 100, 30, 'UNFIT', { act: 'unfit', arg: i, col: '#ff7c20' });
      } else {
        ctx.save();
        ctx.fillStyle = 'rgba(13,17,32,0.6)';
        ctx.beginPath(); ctx.roundRect(px + 16, y, 500, ROW_H, 5); ctx.fill();
        ctx.setLineDash([5, 4]); ctx.strokeStyle = '#2a3346'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(px + 16.5, y + 0.5, 499, ROW_H - 1, 5); ctx.stroke();
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#7a90a8';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(`MOUNT ${i + 1}`, px + 28, y + 18);
        ctx.fillStyle = '#4a6080';
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.fillText('empty — fit a gun from the rack', px + 100, y + 38);
      }
    }
    if (slots === 0) {
      ctx.fillStyle = '#ff5566';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText('This hull has no weapon bay. Buy one at a station.', px + 16, py + 56);
    }

    // ── rack ──
    const rack = Base.armoury();
    if (!rack.length) {
      ctx.fillStyle = '#7a90a8';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText('Rack empty. Guns you bring home in the hold end up here.', px + 560, py + 56);
    }
    _clampScroll();
    const rackFirst = _rackScroll;
    rack.slice(rackFirst, rackFirst + RACK_VIS).forEach((key, vi) => {
      // ABSOLUTE index — Base.installWeapon/sellWeapon index the rack
      // itself, so a scrolled view must not hand them a visible index.
      const i = rackFirst + vi;
      const y = py + 40 + vi * PITCH;
      // The same card as a fitted gun, with FIT and SELL in its reserved column.
      Renderer.drawWeaponCard(ctx, key, px + 560, y, 'M',
        { w: 560, h: ROW_H, corner: 'ON THE RACK', reserve: 228, chipRows: 3 });

      _btn(ctx, px + 900, y + 27, 100, 30, 'FIT',
           { act: 'fit', arg: i, col: '#1aff8c' });
      _btn(ctx, px + 1008, y + 27, 100, 30, `SELL ${Base.weaponValue(key)}`,
           { act: 'sellGun', arg: i, col: '#ffb020' });
    });
    // A rail instead of the old dead-end "…and 2 more on the rack".
    _scrollBar(ctx, px + 1126, py + 44, RACK_VIS * PITCH - 20,
               _rackScroll, RACK_VIS, rack.length, 'scrollRack');
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

  function _drawCrew(ctx, px, py, pw, ph, b) {
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`BARRACKS — ${b.barracks.length}/${Base.barracksCap()} bunks`, px + 16, py + 24);
    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('Click to take them along. Anyone you fly out with can die out there.', px + 220, py + 24);

    if (!b.barracks.length) {
      ctx.fillStyle = '#ffd700';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.fillText('No veterans in the barracks — you will launch with fresh recruits.', px + 16, py + 60);
    }

    _clampScroll();
    const firstCard = _crewScroll * CREW_COLS;
    b.barracks.slice(firstCard, firstCard + CREW_VIS).forEach((c, vi) => {
      const i   = firstCard + vi;
      const col = vi % CREW_COLS, row = Math.floor(vi / CREW_COLS);
      const x = px + 16 + col * 380, y = py + 44 + row * 76;
      const on = _picked.has(c.id);
      /* THE ONE CREW CARD (update112) — the same portrait, name, rank,
         specialisations, HP and status every screen draws, with the
         barracks' skill boxes on the right and the pick line under. */
      const fit = _crewHp(c).pct > 0.3;
      Renderer.drawCrewCard(ctx, c, x, y, 'M', {
        w: 364, h: 66, on, skills: true,
        footer: fit ? (on ? '✓ COMING ALONG' : 'click to bring') : (on ? '✓ COMING' : 'click'),
        footerCol: on ? '#1aff8c' : '#4a6080',
      });
      /* THE WHOLE CARD PICKS HIM; the small button RENAMES him
         (update54). The button goes into the zone list FIRST and the
         card after it, because the hit test returns the first zone it
         lands in — the other order would tick a man for the flight
         every time the player went to correct his name.
         MOVED in update55, twice. At x+300,y+40 it sat on the skill
         pips. The card turns out to have no free corner at all: the
         skills run in THREE columns 56 apart from x+190, reaching
         x+357 on a card 364 wide, and the left half is name, HP and the
         pick line. The one gap is the BOTTOM RIGHT, under the last
         column of pips (which stop at y+52) and right of the first
         (which stop at x+299).
         Section 189 reads the button's rectangle, the pips AND every
         line of text out of the same draw and fails if any of them come
         within four pixels — a border sitting one pixel off a row of
         pips reads as being on top of it, and the first version of that
         assertion passed on exactly that layout. */
      _btn(ctx, x + 306, y + 56, 50, 10, 'RENAME',
           { act: 'rename', arg: c.id, col: '#7a90a8',
             font: '8px Share Tech Mono, monospace' });
      _zones.push({ x, y, w: 364, h: 66, act: 'crew', arg: c.id });
    });

    /* THE FREE BUNKS (update141): every bunk the barracks has and nobody
       sleeps in, as a dashed place on the wall — the screen says how many
       more you can keep before it says "full". */
    {
      const shown = Math.min(CREW_VIS, Math.max(0, b.barracks.length - firstCard));
      const free = Math.max(0, Base.barracksCap() - b.barracks.length);
      for (let k = 0; k < free && shown + k < CREW_VIS; k++) {
        const vi = shown + k;
        const x = px + 16 + (vi % CREW_COLS) * 380, y = py + 44 + Math.floor(vi / CREW_COLS) * 76;
        ctx.setLineDash([4, 4]); ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, 363, 65); ctx.setLineDash([]);
        _upgradeIcon(ctx, 'barracks', x + 14, y + 19, 28, '#22324f');
        ctx.fillStyle = '#3d4a63'; ctx.font = '11px Share Tech Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillText('free bunk', x + 56, y + 32);
        ctx.fillStyle = '#2a3a58'; ctx.font = '9px Share Tech Mono, monospace';
        ctx.fillText('hire a recruit, or bring a survivor home', x + 56, y + 46);
      }
    }

    // Scroll rail down the right-hand edge of the card area.
    _scrollBar(ctx, px + pw - 26, py + 46, CREW_ROWS * 76 - 14,
               _crewScroll, CREW_ROWS, Math.ceil(b.barracks.length / CREW_COLS),
               'scrollCrew');

    const fee     = Base.recruitPrice();
    const canHire = b.barracks.length < Base.barracksCap() && Base.cc() >= fee;
    _btn(ctx, px + 16, py + ph - 44, 220, 30,
         `HIRE RECRUIT — ${fee} CC`,
         { act: canHire ? 'hire' : null, enabled: canHire, col: '#1aff8c',
           sub: b.barracks.length >= Base.barracksCap() ? 'barracks full' : null });
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
  function _drawMess(ctx, px, py, pw, ph, b) {
    const cap    = Base.messCap?.() ?? 1;
    const crews  = Base.commanders?.() ?? [];
    const ROMAN  = ['—', 'I', 'II', 'III', 'IV'];
    const petN   = Base.petCap?.() ?? 2;

    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`THE MESS ${ROMAN[Utils.clamp(Base.messLevel?.() ?? 1, 0, 4)]}`
               + `  —  ${crews.length}/${cap} berths`, px + 20, py + 26);

    /* THE LEFT COLUMN IS 350 PIXELS WIDE AND THIS LINE IS NOT.
       It used to run 540px from px+20 and straight through READY FOR
       THE CHAIR at px+370 — the collision JJ was looking at. Two short
       lines inside the column instead of one long one across it. */
    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('One contract at a time. Lost with the ship.', px + 20, py + 42);
    ctx.fillStyle = '#4a6080';
    ctx.fillText('More berths: UPGRADES.', px + 20, py + 54);

    // ── Berths ──
    /* THE PANEL IS 386 PIXELS TALL AND THAT IS THE WHOLE BUDGET.
       Four berths plus the animal pens have to fit, so a commander card
       gets 62 of them and reads as one dense line rather than a block.
       A fourth berth drawn past the panel is a berth the player paid
       600 CC for and cannot see. */
    const CW = 340, CH = 62, GAP = 6;
    const berthTop = py + 58;
    for (let i = 0; i < Math.max(cap, 1); i++) {
      const x = px + 20, y = berthTop + i * (CH + GAP);
      const c = crews[i];
      if (!c) {
        ctx.fillStyle = 'rgba(13,17,32,0.6)';
        ctx.beginPath(); ctx.roundRect(x, y, CW, CH, 5); ctx.fill();
        ctx.strokeStyle = '#243352'; ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.roundRect(x, y, CW, CH, 5); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#4a6080';
        ctx.font = '11px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('empty berth', x + CW / 2, y + CH / 2 + 4);
        ctx.textAlign = 'left';
        continue;
      }
      _commanderCard(ctx, x, y, CW, CH, c);
    }

    /* ── THE ANIMAL PENS ──
       Empty until update45 brings the cats, but the room is real and
       paid for, so the player can see what he owns. */
    const penY = berthTop + Math.max(cap, 1) * (CH + GAP) + 6;
    if (penY + 54 < py + ph) {
      ctx.fillStyle = '#4db8ff';
      ctx.font = '11px Orbitron, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`ANIMAL PENS — ${(Base.pets?.() ?? []).length}/${petN}`, px + 20, penY + 12);

      const PW = 44, PGAP = 8;
      const animals = Base.pets?.() ?? [];
      for (let i = 0; i < petN; i++) {
        const x = px + 20 + i * (PW + PGAP), y = penY + 20;
        const a = animals[i];
        ctx.fillStyle = a ? 'rgba(26,140,255,0.14)' : 'rgba(13,17,32,0.6)';
        ctx.beginPath(); ctx.roundRect(x, y, PW, PW, 5); ctx.fill();
        ctx.strokeStyle = '#243352'; ctx.lineWidth = 1;
        if (!a) ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.roundRect(x, y, PW, PW, 5); ctx.stroke();
        ctx.setLineDash([]);
        if (a) {
          const picked = _petId === a.id;
          ctx.strokeStyle = picked ? '#1aff8c' : '#243352';
          ctx.lineWidth = picked ? 2 : 1;
          ctx.beginPath(); ctx.roundRect(x, y, PW, PW, 5); ctx.stroke();
          /* A HUNGRY ANIMAL HAS TO BE VISIBLE BEFORE YOU FLY IT.
             Hunger comes home with the cat and keeps draining out
             there, so the pen is the only place the player can act on
             it — exactly the reason crew HP was put on the bunk cards
             in update39. */
          const hun = Utils.clamp((a.hunger ?? 100) / 100, 0, 1);
          ctx.fillStyle = '#0a1018';
          ctx.fillRect(x + 4, y + PW - 9, PW - 8, 4);
          ctx.fillStyle = hun > 0.4 ? '#1aff8c' : hun > 0.12 ? '#ffb020' : '#ff2d44';
          ctx.fillRect(x + 4, y + PW - 9, (PW - 8) * hun, 4);
          _zones.push({ x, y, w: PW, h: PW, act: 'pickPet', arg: a.id });
        }
        ctx.fillStyle = a ? (_petId === a.id ? '#1aff8c' : '#c8d8f0') : '#3d4a63';
        ctx.font = '9px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(a ? String(a.name).slice(0, 6) : 'empty', x + PW / 2, y + PW / 2 - 2);
        if (a) ctx.fillText(_petId === a.id ? '✓ FLYING' : 'click', x + PW / 2, y + PW / 2 + 10);
        ctx.textAlign = 'left';
      }
      const tx = px + 20 + petN * (PW + PGAP) + 8;
      ctx.fillStyle = '#4a6080';
      ctx.font = '9px Share Tech Mono, monospace';
      // Wrapped to the left column, under the ADOPT button (update115) —
      // one long line ran under the button and out into the next column.
      _wrap(ctx, animals.length
        ? 'One animal per hull. It hunts vermin and sits with the wounded.'
        : 'no animals yet', tx, penY + 48, px + 360 - tx, 11, 2);

      /* ── ADOPT A CAT (update47) ──
         Until now the only cat in the game came off a stowaway roll on
         the map, which meant you could fly six contracts and never see
         one — impossible to plan around, and worse, impossible to
         test. The station keeps cats; buying one is a button, and it
         fills a PEN, never a bunk. */
      const catPrice = Base.PRICE?.cat ?? 60;
      const canCat = animals.length < petN && Base.cc() >= catPrice;
      _btn(ctx, tx, penY + 14, 168, 22, `ADOPT A CAT — ${catPrice} CC`,
           { act: canCat ? 'adoptCat' : null, enabled: canCat, col: '#ffc861' });
    }

    // ── Candidates ──
    const rx = px + 370, rw = pw - 390;
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.fillText('READY FOR THE CHAIR', rx, py + 26);

    const pool = Base.promotable?.() ?? [];
    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    /* update51: ANYONE can take the chair. What his stars decide is
       the price and the permanent ceiling of his CPU board, so the
       heading says that instead of the old "come back when somebody
       has mastered something". */
    /* WRAPPED to its column (update111). One line of 140 characters ran
       from rx straight off the panel's right edge — the measuring test
       caught it the first time it drew the mess with a candidate in it. */
    _wrap(ctx, pool.length
      ? 'He leaves the barracks for good. His RANK is what he brings: '
        + 'the commander starts at that level, with that many Destiny Tablet cells open.'
      : 'The barracks are empty.',
      rx, py + 42, rw, 12, 2);


    /* ── THE QUEUE SCROLLS (update52a) ──
       It used to draw the first five and print "…and N more in the
       barracks", which is a list you cannot reach the bottom of. A
       barracks of twelve had seven men the player could see the count
       of and never promote. */
    const RH = 84, RGAP = 8;
    const top = py + 74;
    /* THE ONE CLAMP. Written back, so the state and the picture are
       the same number and a queue that shrank under the player cannot
       leave him scrolled past its end. */
    _promoScroll = Utils.clamp(_promoScroll, 0, Math.max(0, pool.length - PROMO_ROWS));
    const first = _promoScroll;
    pool.slice(first, first + PROMO_ROWS).forEach((c, i) => {
      const y = top + i * (RH + RGAP);
      /* THE BUTTON COLUMN IS RESERVED, exactly as on a berth card —
         every run of text is clipped against it, so nothing can slide
         under PROMOTE. */
      const BW = 138, BX = rx + rw - BW - 12;
      /* THE ONE CREW CARD (update112): portrait, name, rank, HP, status and
         his skill boxes — what the barracks shows of the same man. */
      const card = Renderer.drawCrewCard(ctx, c, rx, y, 'M', { w: rw, h: RH, skills: true, reserve: BW + 12 });
      const tx = card.textX;
      const tw = BX - 160 - tx;

      /* ── WHAT COUNTS AS A SPECIALISATION, SAID OUT LOUD ──
         A skill counts ONLY when it is fully mastered, 3 of 3. JJ read
         "3 bonus picks" on this card as three specialisations, which
         is exactly the kind of thing a card has to answer for itself
         rather than leave to be inferred from a level number. */
      const mastered = (typeof Commander !== 'undefined')
        ? Commander.masteredOf(c) : [];
      ctx.textAlign = 'left';
      ctx.font = '9px Share Tech Mono, monospace';
      if (mastered.length) {
        ctx.fillStyle = '#4dd8c0';
        ctx.fillText(_clip(ctx, `specialisations (3/3): `
          + mastered.map(k => SKILL_DEFS[k]?.label ?? k).join(', '), tw), tx, y + 62);
      } else {
        ctx.fillStyle = '#ff7c20';
        ctx.fillText(_clip(ctx, 'specialisations: none — a skill counts only at 3/3', tw), tx, y + 62);
      }

      /* WHAT HE ARRIVES AS. The rank IS the commander level and the
         cell count, so all three are one line and cannot disagree. */
      const lvl = (typeof rankLevelOf !== 'undefined') ? rankLevelOf(c) : 0;
      ctx.fillStyle = '#7a90a8';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(_clip(ctx, `commander level ${Math.max(1, lvl)} · `
        + `${Math.max(1, lvl)}/25 tablet cells · ${Math.max(1, lvl)} level-up picks`, tw),
        tx, y + 76);

      const price = (typeof Commander !== 'undefined' && Commander.priceFor)
        ? Commander.priceFor(c) : (Base.PRICE?.promotion ?? 80);
      const room  = crews.length < cap;
      const can   = room && Base.cc() >= price;
      _btn(ctx, BX, y + 26, BW, 32,
           room ? `PROMOTE — ${price} CC` : 'NO BERTH',
           { act: can ? 'promote' : null, arg: c.id, enabled: can, col: '#ffd700' });
    });

    if (pool.length > PROMO_ROWS) {
      const listH = PROMO_ROWS * (RH + RGAP) - RGAP;
      const sx = rx + rw + 4, sw = 8;
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.fillRect(sx, top, sw, listH);
      ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, top + 0.5, sw - 1, listH - 1);
      const span = Math.max(1, pool.length - PROMO_ROWS);
      const thumbH = Math.max(18, listH * PROMO_ROWS / pool.length);
      const ty = top + (listH - thumbH) * (first / span);
      ctx.fillStyle = '#4db8ff';
      ctx.fillRect(sx + 1, ty, sw - 2, thumbH);

      _btn(ctx, rx, top + listH + 6, 84, 20, '▲ EARLIER',
           { act: first > 0 ? 'scrollPromo' : null, arg: -1, enabled: first > 0,
             col: '#b8c4d4' });
      _btn(ctx, rx + 92, top + listH + 6, 84, 20, 'LATER ▼',
           { act: first < span ? 'scrollPromo' : null, arg: 1, enabled: first < span,
             col: '#b8c4d4' });
      ctx.fillStyle = '#4a6080';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${first + 1}–${Math.min(pool.length, first + PROMO_ROWS)} of ${pool.length}`,
                   rx + 184, top + listH + 20);
    }
  }

  /**
   * ONE COMMANDER, ONE READABLE CARD (rebuilt in update52a).
   *
   * The old card tried to hold his name, corporation, rank, level, XP
   * bar, XP figure, bonus lines, "own corporation only", karma, the
   * wall split and the cell count in 62 pixels — and the karma line
   * ran straight through the XP figure, which is the mess JJ was
   * looking at. Nothing was removed from the game to fix it: the
   * detail moved to the DOSSIER, one click away, where there is room
   * for all of it and for the CPU board besides.
   *
   * What stays here is what you scan a berth for: who, what rank, how
   * far to the next promotion, and the one or two buttons.
   */
  function _commanderCard(ctx, x, y, w, h, c) {
    const picked = _commanderId === c.id;
    /* THE BUTTON COLUMN IS RESERVED — the card's text is clipped against
       it, so a long name or rank cannot slide under FLY HIM. */
    const BTN_W = 92, BTN_X = x + w - BTN_W - 10;
    // Unspent attribute points are the one thing a berth can need from the
    // player — LEVEL UP (n) in the button column says it.
    const owed = (typeof Commander !== 'undefined') ? Commander.pointsOwed(c) : 0;
    /* THE ONE CREW CARD (update112), in gold — the same portrait, name,
       rank and HP the barracks and the roster draw; the XP runs along the
       card's foot, the figures are in his file. */
    Renderer.drawCrewCard(ctx, c, x, y, 'M', {
      w, h, commander: true, reserve: BTN_W + 10, hint: 'click for file',
    });

    /* THE WHOLE CARD IS THE DOSSIER BUTTON — but it is pushed LAST,
       after every real button on it. `_zones` is walked front to back
       and the first hit wins, so a card-sized zone pushed early would
       swallow every press on FLY HIM and LEVEL UP. */
    const dossierZone = { x, y, w, h, act: 'dossier', arg: c.id };

    if (c.away) {
      ctx.fillStyle = '#ff7c20';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('ON CONTRACT', x + w - 10, y + 22);
      ctx.textAlign = 'left';
      _zones.push(dossierZone);
      return;
    }
    _btn(ctx, BTN_X, y + 8, BTN_W, 22,
         picked ? '✓ FLYING' : 'FLY HIM',
         { act: 'pickCommander', arg: c.id, on: picked, col: '#1aff8c' });

    /* UNSPENT LEVELS ARE NOT A FOOTNOTE. If he is owed picks the card
       offers THEM instead of the board — a bonus the player has not
       chosen is a bonus the crew are not getting, and it must not be
       possible to miss. */
    if (owed > 0) {
      _btn(ctx, BTN_X, y + 34, BTN_W, 20, `LEVEL UP (${owed})`,
           { act: 'levelUp', arg: c.id, col: '#ffd700' });
    } else {
      // update104 (jj): no "CPU" anywhere — it is his DESTINY TABLETS.
      // (the full name is on the screen it opens — the button is 92 px)
      _btn(ctx, BTN_X, y + 34, BTN_W, 20, 'TABLETS',
           { act: 'cpu', arg: c.id, col: '#b8c4d4' });
    }
    _zones.push(dossierZone);
  }

  // ── Tab: SUPPLY ─────────────────────────────────────────

  /** Pictogram for a supply line — a real tank / a real rack. */
  function _supplyIcon(ctx, kind, x, y, w, h) {
    ctx.save();
    if (kind === 'fuel') {
      ctx.fillStyle = 'rgba(255,90,110,0.18)';
      ctx.beginPath(); ctx.roundRect(x + w * 0.22, y, w * 0.56, h, w * 0.2); ctx.fill();
      ctx.strokeStyle = '#ff6b7a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x + w * 0.22, y, w * 0.56, h, w * 0.2); ctx.stroke();
      ctx.fillStyle = '#ff8a95';
      ctx.fillRect(x + w * 0.36, y - 4, w * 0.28, 5);           // collar
      ctx.fillStyle = 'rgba(255,140,150,0.7)';
      ctx.fillRect(x + w * 0.30, y + h * 0.55, w * 0.40, h * 0.32);
    } else if (kind === 'food') {
      // Ration pack: a sealed brick with a tear strip.
      ctx.fillStyle = 'rgba(143,168,192,0.22)';
      ctx.fillRect(x + w * 0.12, y, w * 0.76, h);
      ctx.strokeStyle = '#8fa8c0'; ctx.lineWidth = 1.3;
      ctx.strokeRect(x + w * 0.12, y, w * 0.76, h);
      ctx.strokeStyle = 'rgba(200,216,240,0.8)';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.12, y + h * 0.3);
      ctx.lineTo(x + w * 0.88, y + h * 0.3);
      ctx.stroke();
    } else if (kind === 'scan') {
      // Survey probe: a dish on a stem, throwing two arcs.
      ctx.strokeStyle = '#4dffd0'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h); ctx.lineTo(x + w * 0.5, y + h * 0.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h * 0.45, w * 0.34, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = 'rgba(77,255,208,0.25)';
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h * 0.45, w * 0.34, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(77,255,208,0.7)';
      ctx.beginPath(); ctx.arc(x + w * 0.5, y + h * 0.42, w * 0.55, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    } else {
      // Missile rack: three warheads in a frame.
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + h * 0.15, w - 2, h * 0.7);
      ctx.fillStyle = '#ffb347';
      for (let i = 0; i < 3; i++) {
        const my = y + h * 0.28 + i * h * 0.2;
        ctx.beginPath();
        ctx.moveTo(x + 4, my);
        ctx.lineTo(x + w - 8, my);
        ctx.lineTo(x + w - 4, my + 2.5);
        ctx.lineTo(x + w - 8, my + 5);
        ctx.lineTo(x + 4, my + 5);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  function _drawSupply(ctx, px, py, pw, ph, b) {
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('WAREHOUSE', px + 16, py + 22);
    ctx.fillStyle = '#5f7893';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('One shelf for everything the base is holding: fuel, warheads, guns and salvage.',
                 px + 128, py + 22);

    /* THREE panels, and only ONE of them is a store.
       The old layout had a card for He2, a card for missiles and a card
       for salvage, which looked like — and was — three separate stores.
       Now the left panel IS the warehouse and shows every kind of thing
       on it; the middle is the shop and the tank, which only ever move
       units on and off that one shelf. */
    const GAP = 14;
    const unit = Math.floor((pw - 32 - GAP * 3) / 4);
    const wideW = unit * 2 + GAP;
    const cardH = ph - 70;
    const top = py + 34;

    _warehouseCard(ctx, px + 16, top, wideW, cardH);
    _shopCard(ctx, px + 16 + wideW + GAP, top, unit, cardH, b);

    // ── the manifest: what is actually going with you ──
    {
      const x = px + 16 + wideW + GAP + unit + GAP;
      const cardW = unit;
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.fill();
      ctx.strokeStyle = '#1e3a5c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.stroke();

      const pad = 16;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4db8ff';
      ctx.font = '14px Orbitron, monospace';
      ctx.fillText('THIS LAUNCH', x + pad, top + 30);

      // The manifest that used to sit on the launch bar lives here now:
      // what you are flying, who is aboard, and what is in the hold —
      // all in the one card that describes the launch.
      const p = _holdSummary();
      const shipDef = b.ships[_shipIdx] ? SHIP_CATALOG[b.ships[_shipIdx].key] : null;
      const msn = Base.missions().find(m => m.id === _mission);
      const rows = [
        { k: 'contract', v: msn ? _clip(ctx, msn.label, 120) : '—', col: '#c8e8ff' },
        { k: 'ship',     v: shipDef ? _clip(ctx, shipDef.label, 120) : '— none —',
          col: shipDef ? '#9fdcff' : '#ff5566' },
        { k: 'crew',     v: _picked.size ? `${_picked.size} veteran(s)` : 'recruits',
          col: _picked.size ? '#1aff8c' : '#ffb020' },
        { k: 'He2 in the hold',  v: p.fuel ? `${p.fuel}` : 'NONE — cannot jump',
          col: p.fuel ? '#ff8a95' : '#ff2d44' },
        { k: 'missiles packed',  v: `${p.missiles}`, col: '#ffb347' },
        { k: 'spare guns',       v: `${p.guns}`, col: '#ffd780' },
        { k: 'hold used',        v: `${p.cells}/${p.cap} cells`, col: '#4db8ff' },
      ];
      rows.forEach((row, ri) => {
        const ry2 = top + 56 + ri * 22;
        ctx.fillStyle = '#5f7893';
        ctx.font = '11px Share Tech Mono, monospace';
        ctx.fillText(row.k, x + pad, ry2);
        ctx.textAlign = 'right';
        ctx.fillStyle = row.col;
        ctx.fillText(row.v, x + cardW - pad, ry2);
        ctx.textAlign = 'left';
      });

      /* THE SECOND PACK HOLD BUTTON USED TO BE HERE.
         The warehouse panel on the left of this same tab already opens
         the packing screen, and two buttons leading to one screen is
         just a question about which one is the real one. THIS LAUNCH is
         a readout now — it says what you are taking, and you change it
         on the shelf. */
      ctx.fillStyle = '#4a6080';
      ctx.font = '10px Share Tech Mono, monospace';
      _wrap(ctx, 'Load the hold from THE SHELF on the left. Anything still in it '
                + 'when you dock comes back on the shelf — if there is room.',
            x + pad, top + 236, cardW - pad * 2, 13);
    }
  }

  /** The shop and the jump tank — the two things that move units on and
   *  off the shelf without the player dragging a crate. */
  function _shopCard(ctx, x, top, cardW, cardH, b) {
    ctx.fillStyle = 'rgba(13,17,32,0.9)';
    ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.stroke();

    const pad = 16, inner = cardW - pad * 2;
    const stock = Base.supply();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '14px Orbitron, monospace';
    ctx.fillText('BASE SHOP', x + pad, top + 30);

    /* ── WHAT YOU ARE FLYING WITH ──────────────────────────
       There used to be a "He2 IN THE TANK" stepper here, with − / + /
       MAX buttons, and it was the last place in the game where a cargo
       item turned into an invisible number on the way out of the door.
       He2 is cells now, exactly like warheads are racks: PACK THE HOLD
       is where fuel comes from, and this is a readout of the result. */
    const packed = _holdSummary();
    _supplyIcon(ctx, 'fuel', x + pad, top + 48, 20, 26);
    ctx.fillStyle = packed.fuel ? '#ff6b7a' : '#ff2d44';
    ctx.font = '13px Share Tech Mono, monospace';
    ctx.fillText(`He2 PACKED: ${packed.fuel}`, x + pad + 30, top + 62);
    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`${stock.fuel} still on the shelf`, x + pad + 30, top + 76);
    ctx.fillStyle = packed.fuel ? '#4a6080' : '#ffd700';
    // Short enough to stay inside this card — it used to run out over
    // the THIS LAUNCH panel next door.
    ctx.fillText(packed.fuel
      ? 'One cell per jump, from the hold.'
      : 'NO He2 — pack cells to jump.',
      x + pad, top + 96);

    // ── the shop ──
    const g = (typeof CargoGrid !== 'undefined' && Base.warehouseGrid) ? Base.warehouseGrid() : null;
    const room = g ? g.capacity - g.usedCells() : 0;
    /* FOUR STOCK LINES NOW, NOT THREE (update47). Rations joined the
       shelf, and the old geometry — heading at +132, lines every 50 —
       put the fourth line's buttons 36 pixels below the bottom of the
       card. Everything above moved up and the pitch came in. */
    let ly = top + 112;
    ctx.fillStyle = '#5f7893';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('BUY ONTO THE SHELF', x + pad, ly);
    ctx.fillStyle = room ? '#4a6080' : '#ffd700';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(room ? `${room} free cells on the shelf` : 'shelf full — upgrade it',
                 x + pad, ly + 14);
    ly += 34;                    // clear of the first stock line's icon

    /* ONE ROW PER LINE (update141). The buttons used to sit under their
       label and end six pixels below the NEXT label's top — MISSILES,
       SURVEY PROBE and RATIONS were drawn under the BUY buttons of the
       line above. Now each line is one row: what and what it costs on the
       left, what the shelf holds under it, ×1 and ×5 on the right. */
    const BW = 42, BH = 24, GAP = 6, PITCH = 40;
    [['fuel', 'He2', '#ff6b7a'], ['missiles', 'MISSILES', '#ffb347'],
     ['scan', 'SURVEY PROBE', '#4dffd0'],
     ['food', 'RATIONS', '#8fa8c0']].forEach(([kind, label, col]) => {
      const price = Base.unitPrice(kind);
      _supplyIcon(ctx, kind, x + pad + 1, ly - 8, 12, 10);
      ctx.fillStyle = col;
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(_clip(ctx, `${label} — ${price} CC`, inner - 2 * BW - GAP - 26), x + pad + 20, ly);
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`${stock[kind]} on the shelf`, x + pad + 20, ly + 13);
      const can1 = Base.cc() >= price && room > 0;
      const can5 = Base.cc() >= price * 5 && room > 0;
      const bx5 = x + cardW - pad - BW, bx1 = bx5 - GAP - BW, by = ly - 12;
      _btn(ctx, bx1, by, BW, BH, '×1',
           { act: can1 ? 'buy' : null, arg: [kind, 1], enabled: can1, col: '#1aff8c' });
      _btn(ctx, bx5, by, BW, BH, '×5',
           { act: can5 ? 'buy' : null, arg: [kind, 5], enabled: can5, col: '#1aff8c' });
      ly += PITCH;
    });
  }

  /** A pictogram for the warehouse — a shelf with crates on it. */
  function _shelfIcon(ctx, x, y, w, h) {
    ctx.save();
    ctx.strokeStyle = '#ffd780'; ctx.lineWidth = 1.5;
    ctx.beginPath();                                   // two shelf boards
    ctx.moveTo(x, y + h * 0.52); ctx.lineTo(x + w, y + h * 0.52);
    ctx.moveTo(x, y + h);        ctx.lineTo(x + w, y + h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,215,128,0.55)';
    ctx.fillRect(x + 2,         y + h * 0.20, w * 0.36, h * 0.30);   // top crate
    ctx.fillRect(x + w * 0.52,  y + h * 0.28, w * 0.36, h * 0.22);
    ctx.fillRect(x + 2,         y + h * 0.70, w * 0.30, h * 0.28);   // bottom crates
    ctx.fillRect(x + w * 0.40,  y + h * 0.66, w * 0.42, h * 0.32);
    ctx.restore();
  }

  /** Colour a shelf line by what kind of thing it is, so fuel, warheads
   *  and guns still read as different things inside one store. */
  function _kindCol(it) {
    if (it.damaged) return '#9aa4b2';
    const k = it.def.kind;
    if (k === 'fuel')     return '#ff6b7a';
    if (k === 'missiles') return '#ffb347';
    if (k === 'weapon')   return '#ffd780';
    if (k === 'heal')     return '#3aff6a';
    return it.def.col || '#c8d8f0';
  }

  /**
   * THE warehouse, as a panel.
   *
   * It reads the grid and never mutates it — the drag-and-drop screen
   * (LootScreen, opened by the button) is the only thing that moves
   * anything, and it commits on close.
   */
  function _warehouseCard(ctx, x, top, cardW, cardH) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(13,17,32,0.9)';
    ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.stroke();

    const pad = 16, inner = cardW - pad * 2;
    const grid = (typeof CargoGrid !== 'undefined' && Base.warehouseGrid) ? Base.warehouseGrid() : null;
    if (!grid) {
      ctx.fillStyle = '#ffd780';
      ctx.font = '15px Orbitron, monospace';
      ctx.fillText('WAREHOUSE', x + pad, top + 32);
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText('cargo system not loaded', x + pad, top + 54);
      return;
    }

    _shelfIcon(ctx, x + pad, top + 14, 26, 30);
    ctx.fillStyle = '#ffd780';
    ctx.font = '15px Orbitron, monospace';
    ctx.fillText('THE SHELF', x + pad + 40, top + 32);

    const used = grid.usedCells(), cap = grid.capacity;
    const full = used >= cap;
    ctx.fillStyle = full ? '#ffd700' : '#c8d8f0';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.fillText(`${used} / ${cap} cells used  ·  ${grid.cols}×${grid.rows}`, x + pad + 40, top + 50);
    _bar(ctx, x + pad, top + 62, inner, used, cap, '#ffd780');

    const worth = grid.items.reduce((n, it) => n + it.value('general'), 0);
    ctx.fillStyle = '#1aff8c';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText(`~${worth} CC if you sold the lot`, x + pad, top + 92);

    // The list, grouped so ten medkits read as one line rather than ten.
    const listTop = top + 116;
    const listBot = top + cardH - 54;
    if (!grid.items.length) {
      ctx.fillStyle = '#3d4a63';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText('Empty — nothing on the shelf yet.', x + pad, listTop + 4);
    } else {
      const rows = [];
      const seen = new Map();
      grid.items.forEach(it => {
        const key = it.defKey + (it.meta ? ':' + it.meta : '') + (it.damaged ? ':dmg' : '');
        if (!seen.has(key)) { seen.set(key, rows.length); rows.push({ it, n: 0, qty: 0, cc: 0 }); }
        const r = rows[seen.get(key)];
        r.n++; r.qty += it.isStack ? it.qty : 1; r.cc += it.value('general');
      });
      // Fuel, warheads and guns first — they are what a launch needs.
      const ORDER = { fuel: 0, missiles: 1, weapon: 2 };
      rows.sort((a, b2) => (ORDER[a.it.def.kind] ?? 9) - (ORDER[b2.it.def.kind] ?? 9));

      const perCol = Math.max(1, Math.floor((listBot - listTop) / 16));
      const cols = Math.min(2, Math.ceil(rows.length / perCol));
      const colW = Math.floor(inner / Math.max(1, cols));
      const maxRows = perCol * Math.max(1, cols);

      rows.slice(0, maxRows).forEach((r, i) => {
        const cx2 = x + pad + Math.floor(i / perCol) * colW;
        const ry = listTop + (i % perCol) * 16;
        ctx.fillStyle = _kindCol(r.it);
        ctx.font = '11px Share Tech Mono, monospace';
        const name = r.it.meta && getWeaponDef?.(r.it.meta)
          ? getWeaponDef(r.it.meta).label
          : r.it.label;
        ctx.textAlign = 'left';
        ctx.fillText(_clip(ctx, `${name}${r.it.damaged ? ' (spoiled)' : ''}`, colW - 46), cx2, ry);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#5f7893';
        ctx.fillText(r.it.isStack ? `${r.qty}` : `×${r.n}`, cx2 + colW - 10, ry);
        ctx.textAlign = 'left';
      });
      if (rows.length > maxRows) {
        ctx.fillStyle = '#5f7893';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(`…and ${rows.length - maxRows} more kind${rows.length - maxRows > 1 ? 's' : ''}`,
                     x + pad, listBot + 8);
      }
    }

    _btn(ctx, x + pad, top + cardH - 42, inner, 30, '▣ OPEN WAREHOUSE  ·  PACK THE HOLD',
         { act: 'warehouse', col: '#ffd780' });
  }

  // ── Tab: MEMORIAL ───────────────────────────────────────
  /* A hill on the moon, and a cross for everyone who did not come back.
     Cannon Fodder had it right: a list of the dead is an inventory, but
     a hillside that visibly fills up over a campaign is a memorial.
     Hover a cross to read who is under it. */

  // Fixed craters, so the moon does not reshuffle itself every frame.
  const CRATERS = [
    [0.08, 0.28, 26], [0.21, 0.55, 15], [0.34, 0.18, 19], [0.47, 0.62, 12],
    [0.58, 0.30, 23], [0.69, 0.52, 17], [0.80, 0.22, 14], [0.90, 0.48, 21],
    [0.14, 0.78, 11], [0.63, 0.80, 13], [0.42, 0.86, 16], [0.86, 0.74, 10],
  ];

  let _graveZones = [];      // {x,y,w,h,g} — rebuilt every draw, for hover

  function _drawMemorial(ctx, px, py, pw, ph) {
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
    const all = (typeof Save !== 'undefined' && Save.getGraveyard)
      ? Save.getGraveyard() : [];
    const graves = all.filter(g => g && g.buried);

    // ── sky ──
    ctx.save();
    ctx.beginPath(); ctx.rect(px + 1, py + 1, pw - 2, ph - 2); ctx.clip();

    const sky = ctx.createLinearGradient(0, py, 0, py + ph);
    sky.addColorStop(0, '#05070f');
    sky.addColorStop(1, '#0b1220');
    ctx.fillStyle = sky;
    ctx.fillRect(px, py, pw, ph);

    // Stars — deterministic, so they do not twinkle into new positions.
    ctx.fillStyle = 'rgba(200,216,240,0.55)';
    for (let i = 0; i < 90; i++) {
      const sx = px + ((i * 8677) % 1000) / 1000 * pw;
      const sy = py + ((i * 2903) % 1000) / 1000 * ph * 0.55;
      const r  = (i % 7 === 0) ? 1.4 : 0.8;
      ctx.fillRect(sx, sy, r, r);
    }
    // Home, hanging over the graves.
    ctx.fillStyle = 'rgba(60,90,140,0.30)';
    ctx.beginPath(); ctx.arc(px + pw * 0.84, py + 62, 34, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,170,230,0.35)'; ctx.lineWidth = 1;
    ctx.stroke();

    // ── the hill ──
    const baseY = py + ph + 10;
    const crest = py + ph * 0.42;
    const cxm   = px + pw * 0.5;
    const halfW = pw * 0.66;
    const horizon = (x) => {
      const t = Utils.clamp((x - cxm) / halfW, -1, 1);
      return baseY - (baseY - crest) * (1 - t * t);
    };

    ctx.beginPath();
    ctx.moveTo(px, py + ph);
    for (let x = px; x <= px + pw; x += 4) ctx.lineTo(x, horizon(x));
    ctx.lineTo(px + pw, py + ph);
    ctx.closePath();
    const ground = ctx.createLinearGradient(0, crest, 0, py + ph);
    ground.addColorStop(0, '#3a4152');
    ground.addColorStop(1, '#161b26');
    ctx.fillStyle = ground;
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,216,240,0.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = px; x <= px + pw; x += 4) {
      if (x === px) ctx.moveTo(x, horizon(x)); else ctx.lineTo(x, horizon(x));
    }
    ctx.stroke();

    // Craters, sunk into the slope.
    CRATERS.forEach(([fx, fy, r]) => {
      const cx2 = px + fx * pw;
      const top = horizon(cx2);
      const cy2 = top + (py + ph - top) * fy;
      if (cy2 > py + ph - 4) return;
      ctx.fillStyle = 'rgba(10,14,22,0.55)';
      ctx.beginPath(); ctx.ellipse(cx2, cy2, r, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,216,240,0.16)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx2, cy2 - 1, r, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    });

    // ── the crosses ──
    const COLW = 34, ROWH = 30;
    const perRow = Math.max(1, Math.floor((pw - 80) / COLW));
    const rows = Math.max(1, Math.ceil(graves.length / perRow));
    graves.forEach((g, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, graves.length - row * perRow);
      const spanW = inRow * COLW;
      const gx = Math.round(cxm - spanW / 2 + col * COLW + COLW / 2);
      const gy = Math.round(horizon(gx) + 24 + (rows - 1 - row) * ROWH);
      if (gy > py + ph - 6) return;
      const hot = Utils.pointInRect(Input.mouse.x, Input.mouse.y, gx - 10, gy - 27, 20, 31);
      _drawGrave(ctx, gx, gy, hot, g);
      _graveZones.push({ x: gx - 10, y: gy - 27, w: 20, h: 31, g });
    });

    ctx.restore();

    // ── heading ──
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c8d8f0';
    ctx.font = '13px Orbitron, monospace';
    ctx.fillText('THE HILL', px + 16, py + 26);
    ctx.fillStyle = '#7a90a8';
    ctx.font = '11px Share Tech Mono, monospace';
    /* And the heading counts what is actually on the hill. It said
       "never came home" while drawing a stone for everybody, which was
       the same contradiction written out in words. */
    /* Ours and theirs counted apart (update93a): an NN stake is not one
       of the men this line is about. */
    const ours = graves.filter(g => !g.enemy).length, nn = graves.length - ours;
    ctx.fillText(graves.length
      ? `${ours} brought home and buried${nn ? ` · ${nn} of theirs, no name` : ''}. Hover a marker to read the name.`
      : 'Nobody is buried here yet. Keep it that way.', px + 16, py + 44);

    /* ── WHO NEVER CAME BACK (update68) ──────────────────────
     *
     * A stone on the hill says a man died. It does NOT say whether
     * anybody carried him home — and a commander lost with his ship
     * had no stone at all until this package, so a player could lose
     * four of them across a campaign with nothing anywhere to show it.
     *
     * The player asked for a list, and this is it: read straight off
     * the graveyard by the one field a burial writes. Not a second
     * register of the dead — the same list, filtered.
     */
    {
      const lost = (typeof Save !== 'undefined' && Save.notRecovered)
        ? Save.notRecovered() : [];
      const W = 210;
      const x = px + pw - W - 12;
      const y0 = py + 60;
      const rowH = 15;
      const rows = Math.min(lost.length, Math.floor((ph - 90) / rowH));

      ctx.textAlign = 'left';
      ctx.fillStyle = '#8a7a52';
      ctx.font = '11px Orbitron, monospace';
      ctx.fillText('NOT RECOVERED', x, y0 - 14);

      if (!lost.length) {
        ctx.fillStyle = '#3d4a63';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText('Everybody came home.', x, y0 + 4);
      } else {
        lost.slice(0, rows).forEach((g, i) => {
          const y = y0 + i * rowH;
          /* A cat, a commander and a hand read differently — losing an
             animal is not losing your commander, and a list that made
             them look the same would be worse than no list. */
          const mark = g.commander ? '★' : g.pet ? '\u2726' : '·';
          ctx.fillStyle = g.commander ? '#ffd700' : g.pet ? '#c8a06a' : '#7a90a8';
          ctx.font = '10px Share Tech Mono, monospace';
          ctx.fillText(mark, x, y);
          ctx.fillStyle = g.commander ? '#e8d9a8' : '#98a0b8';
          ctx.fillText(_clip(ctx, g.name || 'Unknown', W - 74), x + 12, y);
          ctx.textAlign = 'right';
          ctx.fillStyle = '#5a5f6e';
          ctx.fillText(g.sector ? `sec ${g.sector}` : '—', x + W, y);
          ctx.textAlign = 'left';
        });
        if (lost.length > rows) {
          ctx.fillStyle = '#3d4a63';
          ctx.font = '9px Share Tech Mono, monospace';
          ctx.fillText(`…and ${lost.length - rows} more`, x, y0 + rows * rowH);
        }
      }
    }

    // ── the hovered stone's story ──
    const hovered = _graveZones.find(z =>
      Utils.pointInRect(Input.mouse.x, Input.mouse.y, z.x, z.y, z.w, z.h));
    if (hovered) _drawGraveCard(ctx, hovered, px, py, pw, ph);
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

  // ── Tab: UPGRADES ───────────────────────────────────────
  /** How many of a thing the base has now, and how many an upgrade adds. */
  function _upgradeCounts(kind) {
    if (kind === 'barracks') return { now: Base.barracksCap(), add: 2 };
    if (kind === 'slot')     return { now: Base.shipSlots(), add: 1 };
    if (kind === 'mess')     return { now: Base.messCap?.() ?? 1, add: 1 };
    if (kind === 'pets')     return { now: Base.petCap?.() ?? 2, add: 1 };
    return null;
  }
  function _upgradeViz(ctx, kind, x, y, w, h, can) {
    if (h < 24) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    const pulse = 0.45 + 0.35 * Math.sin(t * 3);
    ctx.save();
    if (kind === 'warehouse') {
      const cols = Base.stashCols(), rows = Base.stashRows();
      const cell = Math.max(5, Math.min(14, Math.floor(Math.min((w - 4) / (cols + 1), (h - 4) / rows))));
      const gw = (cols + 1) * cell, ox = x + Math.floor((w - gw) / 2), oy = y + Math.floor((h - rows * cell) / 2);
      for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) {
        const cx = ox + c * cell, cy = oy + r * cell;
        if (c < cols) { ctx.fillStyle = 'rgba(255,215,128,0.22)'; ctx.fillRect(cx + 1, cy + 1, cell - 2, cell - 2); }
        else { ctx.globalAlpha = can ? pulse : 0.3; ctx.strokeStyle = '#1aff8c'; ctx.setLineDash([2, 2]);
               ctx.strokeRect(cx + 1.5, cy + 1.5, cell - 3, cell - 3); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      }
      ctx.restore();
      return;
    }
    const n = _upgradeCounts(kind);
    if (!n) { ctx.restore(); return; }
    const total = n.now + n.add;
    const S = Math.max(12, Math.min(26, Math.floor(Math.sqrt((w * h) / Math.max(1, total)) - 6)));
    const perRow = Math.max(1, Math.floor(w / (S + 6)));
    for (let i = 0; i < total; i++) {
      const cx = x + (i % perRow) * (S + 6), cy = y + Math.floor(i / perRow) * (S + 6);
      if (cy + S > y + h) break;
      const ghost = i >= n.now;
      if (ghost) {
        ctx.globalAlpha = can ? pulse : 0.3;
        ctx.strokeStyle = '#1aff8c'; ctx.setLineDash([2, 2]);
        ctx.strokeRect(cx + 0.5, cy + 0.5, S, S); ctx.setLineDash([]);
        _upgradeIcon(ctx, kind, cx + 2, cy + 2, S - 4, '#1aff8c');
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'rgba(77,184,255,0.08)'; ctx.fillRect(cx, cy, S + 1, S + 1);
        _upgradeIcon(ctx, kind, cx + 2, cy + 2, S - 4, '#4db8ff');
      }
    }
    ctx.restore();
  }

  function _drawUpgrades(ctx, px, py, pw, ph, b) {
    const items = [
      { kind: 'warehouse', title: 'WAREHOUSE',
        now: `${Base.warehouseCap()} units/line · ${Base.stashCols()}×${Base.stashRows()} shelf`,
        next: `${Base.warehouseCap() + 10} units/line · ${Base.stashCols() + 1}×${Base.stashRows()} shelf`,
        blurb: 'More He2 and missiles kept between contracts, and a bigger '
             + 'shelf for salvage instead of it being sold outright.' },
      { kind: 'barracks', title: 'BARRACKS',
        now: `${Base.barracksCap()} bunks`,
        next: `${Base.barracksCap() + 2} bunks`,
        blurb: 'Keep more veterans instead of turning them away.' },
      { kind: 'slot', title: 'HANGAR BERTH',
        now: `${Base.shipSlots()} berths`,
        next: `${Base.shipSlots() + 1} berths`,
        blurb: 'Room for another hull, so losing one is not the end.' },
      /* THE MESS BELONGS HERE (update44), with every other structure.
         It used to carry its own BUILD button on its own tab, which made
         it the one building in the base that behaved differently from
         all the others — and the player had to hunt for it. */
      { kind: 'mess', title: 'THE MESS',
        now: `${Base.messCap?.() ?? 1} commander berths`,
        next: `${(Base.messCap?.() ?? 1) + 1} commander berths`,
        blurb: 'Another chair for a commander. Only one flies a contract, '
             + 'but a spare is a spare.' },
      { kind: 'pets', title: 'ANIMAL PENS',
        now: `${Base.petCap?.() ?? 2} pens`,
        next: `${(Base.petCap?.() ?? 2) + 1} pens`,
        blurb: 'Quarters for the animals. They are NOT bunks — a cat '
             + 'never has to outbid a gunner for a bed.' },
    ];

    // FOUR columns across ONE row. The old two-row layout ran the cards
    // off the bottom of the panel and printed the blurb over the price.
    const GAP = 14;
    const cardW = Math.floor((pw - 32 - GAP * (items.length - 1)) / items.length);
    const cardH = ph - 60;
    const top   = py + 34;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.fillText('PERMANENT UPGRADES — bought once, kept for every contract',
                 px + 16, py + 24);

    items.forEach((it, i) => {
      const x = px + 16 + i * (cardW + GAP);
      const y = top;
      const cost = Base.upgradeCost(it.kind);
      const can  = Base.cc() >= cost;

      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, y, cardW, cardH, 5); ctx.fill();
      ctx.strokeStyle = can ? '#1e3a5c' : '#1e2d4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, cardW, cardH, 5); ctx.stroke();

      const pad = 14, inner = cardW - pad * 2;
      ctx.textAlign = 'left';
      const icol = can ? '#4db8ff' : '#3d4a63';
      _upgradeIcon(ctx, it.kind, x + pad, y + 12, 24, icol);
      ctx.fillStyle = '#4db8ff';
      ctx.font = '13px Orbitron, monospace';
      ctx.fillText(it.title, x + pad + 34, y + 30);

      // The blurb is wrapped and we REMEMBER where it ended, so the rows
      // below it can never be printed on top of it.
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      const afterBlurb = _wrap(ctx, it.blurb, x + pad, y + 56, inner, 14);

      let ly = Math.max(afterBlurb + 16, y + 104);
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillStyle = '#5f7893'; ctx.fillText('now', x + pad, ly);
      ctx.fillStyle = '#c8d8f0'; ctx.fillText(it.now, x + pad + 34, ly);
      ly += 18;
      ctx.fillStyle = '#5f7893'; ctx.fillText('next', x + pad, ly);
      ctx.fillStyle = '#1aff8c'; ctx.fillText(it.next, x + pad + 34, ly);

      /* WHAT YOU HAVE, AND WHAT IS NEXT (update141): the empty middle of
         the card shows it — one icon per bunk, berth, chair or pen you
         own, and the next one dashed and pulsing; the warehouse as its
         shelf, with the column an upgrade adds. */
      _upgradeViz(ctx, it.kind, x + pad, ly + 16, inner, (y + cardH - 52) - (ly + 16), can);

      // Button pinned to the BOTTOM of the card — it never collides with
      // however much text ends up above it.
      _btn(ctx, x + pad, y + cardH - 44, inner, 30,
           can ? `UPGRADE — ${cost} CC` : `${cost} CC`,
           { act: can ? 'upgrade' : null, arg: it.kind, enabled: can,
             col: '#1aff8c' });
    });

    ctx.fillStyle = '#4a6080';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CC comes home from contracts — half of what you finish a run holding, '
               + 'plus the contract bonus.', px + 16, py + ph - 10);
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
        { w: z.w, h: z.h, commander: z.cmd, hint: z.cmd ? 'click: in the chair' : null });
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
    _loPanel(ctx, R.mountPanel, 'MOUNTS', `${fitted.length} of ${R.mounts.length} fitted`, '#ff8a95');
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
    const sh = _previewShip(S.x + S.w / 2, S.y + S.h / 2 + 14);
    if (sh) {
      // moored in the bay (update148)
      if (typeof DockArt !== 'undefined') DockArt.draw(ctx, { x: S.x + 2, y: S.y + 2, w: S.w - 4, h: S.h - 4 }, sh);
      ctx.save();
      ctx.beginPath(); ctx.rect(S.x + 2, S.y + 2, S.w - 4, S.h - 4); ctx.clip();
      sh.roofAlpha = 0;              // men are posted to rooms here: always the cutaway (update118)
      try { sh.draw(ctx); } catch (e) { /* a picture never kills the screen */ }
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
      Renderer.drawCrewCard(ctx, cap, C.x, C.y, 'M', { w: C.w, h: C.h, commander: true, hint: 'click: back to the mess' });
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
      Renderer.drawCrewCard(ctx, z.rec, z.x, z.y, 'S', { w: z.w, h: z.h, on: true, task: _loPostWord(z.id) });
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
    { key: 'earth',   label: 'EARTH',   a: 1.00000, e: 0.01671123, L0: 100.46457166, Ld: 35999.37244981,  w: 102.93768193, size: 9,  c1: '#7ec8ff', c2: '#123a6b',
      bands: [[-0.2, 0.18, 'rgba(60,170,90,0.55)'], [0.25, 0.14, 'rgba(60,170,90,0.45)']] },
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

  /**
   * THE BAR UNDER THE TABS (update111, jj: "zanim polecimy na kontrakt
   * w jednym miejscu, w jednym oknie"). It used to hold the contract
   * cards and LAUNCH, with the crew, the commander and the hold each on
   * a different tab — five places to visit before a flight and nothing
   * saying which. It is a SUMMARY now: what would fly if you went, and
   * one button into the PRE-FLIGHT BRIEFING, where all of it is chosen
   * in one window and the contract actually starts.
   */
  function _drawLaunchBar(ctx, W, H, b) {
    const y = 542;
    _panel(ctx, 40, y, W - 80, 148, null);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.fillText('NEXT CONTRACT', 56, y + 24);

    const S = _briefSummary();
    const rows = [
      ['contract', S.mission ? `${S.mission.label}  ·  ${S.mission.sectors} sector${S.mission.sectors > 1 ? 's' : ''}  ·  ${S.mission.boss ? 'BOSS' : 'NO BOSS'}` : '—', S.missionClosed ? '#ff8a95' : '#c8e8ff'],
      ['ship',      S.ship || 'no ship in the hangar', S.ship ? '#c8e8ff' : '#ff5566'],
      ['commander', S.commander || 'none — flying without one', S.commander ? '#c8e8ff' : '#7a90a8'],
      ['crew',      S.crew ? `${S.crew} picked` : 'nobody picked — green hands sign on', S.crew ? '#c8e8ff' : '#ffb020'],
      ['hold',      `${S.used}/${S.cap} cells  ·  He2 ${S.fuel}  ·  missiles ${S.missiles}  ·  medkits ${S.heal}`, S.fuel ? '#c8e8ff' : '#ff5566'],
    ];
    rows.forEach(([k, v, col], i) => {
      const ry = y + 46 + i * 19;
      ctx.fillStyle = '#5f7893';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(k.toUpperCase(), 56, ry);
      ctx.fillStyle = col;
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText(_clip(ctx, v, W - 60 - 230 - 170), 150, ry);
    });

    const ready = !!b.ships[_shipIdx];
    const flying = (typeof Save !== 'undefined' && Save.hasShipInFlight
                    && Save.hasShipInFlight());
    const worst = _briefingChecks().find(c => c.level === 'bad');
    _btn(ctx, W - 60 - 220, y + 50, 220, 64, 'LOADOUT  ▶',
         { act: 'loadout', col: flying ? '#ffb020' : worst ? '#ffd700' : '#1aff8c',
           font: '18px Orbitron, monospace',
           sub: !ready  ? 'no ship in the hangar'
              : flying  ? 'a contract is still out there'
              : 'ship · crew · hold · guns  [ENTER]' });
    if (flying) {
      _btn(ctx, W - 60 - 220, y + 10, 220, 34, 'CONTINUE',
           { act: 'continue', col: '#1aff8c',
             font: '14px Orbitron, monospace',
             sub: 'back to the contract' });
    }
  }

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
    _state: () => ({ tab: _tab, shipIdx: _shipIdx, picked: [..._picked],
                     commanderId: _commanderId, petId: _petId,
                     fuel: _fuel, missiles: _missiles, mission: _mission,
                     hold: _hold, store: _store, packed: _holdSummary(),
                     yardScroll: _yardScroll, berthScroll: _berthScroll,
                     yardVis: YARD_VIS, berthVis: BERTH_VIS,
                     promoScroll: _promoScroll, dossierId: _dossierId,
                     confirm: _confirm ? { ..._confirm } : null,
                     loadout: _screen === 'loadout', dest: _screen === 'dest', screen: _screen,
                     hand: _hand ? { kind: _hand.kind, from: _hand.from ?? null, id: _hand.id ?? null,
                                     key: _hand.key ?? null, item: _hand.item ?? null } : null,
                     interior: _interior, roofs: Object.fromEntries(_roofs),
                     hangarStage: _hangarStage ? { ..._hangarStage } : null,
                     posts: { ..._posts }, filter: _filter, shelfView: { ..._shelfView }, destMoon: _destMoon,
                     rename: _rename ? { ..._rename } : null }),
    _set: (o) => {
      if (o.tab !== undefined) { _tab = o.tab; _groupLast[_groupOf(o.tab).key] = o.tab; }
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
      if (o.fuel !== undefined) _fuel = o.fuel;
      if (o.missiles !== undefined) _missiles = o.missiles;
      if (o.mission !== undefined) _mission = o.mission;
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
