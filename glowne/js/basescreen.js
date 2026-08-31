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
  const TABS = ['HANGAR', 'ARMOURY', 'CREW', 'MESS', 'SUPPLY', 'UPGRADES', 'MEMORIAL'];

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
  /* The rack could hold more guns than the panel showed, and the extras
     were unreachable: no FIT, no SELL, just a line reading "…and 2 more
     on the rack". Guns you cannot reach are guns you cannot sell. */
  let _rackScroll  = 0;
  /* Which captain flies the next contract, or null. Only an id: the
     record itself lives in Base.captains(), and keeping a second copy
     of him here is exactly the pattern that produced the duplicate-item
     bugs this project spent three updates deleting. */
  let _captainId   = null;
  /* Which animal flies, or null. Only an id — the record lives in
     Base.pets(), same rule as the captain. */
  let _petId       = null;
  let _cpuId       = null;   // captain whose CPU board was just opened
  const RACK_VIS   = 3;              // taller rows, so fewer fit
  const CREW_COLS  = 3;
  const CREW_ROWS  = 3;              // visible rows of bunk cards
  const CREW_VIS   = CREW_COLS * CREW_ROWS;
  const YARD_VIS   = 3;
  const BERTH_VIS  = 1;
  let _scrollRects = { yard: null, berth: null };   // set by _drawHangar

  function open() {
    const b = Base.get();
    _tab = 'HANGAR';
    _shipIdx = 0;
    _picked = new Set();
    _mission = b.lastMission || 'patrol';
    // Sensible default load: fill up on what we have, within reason
    _fuel     = 0;  // He2 rides in cells in the hold now, not as a number
    _missiles = 0;                 // missiles ride in racks now, not as a number
    _hold = null;                  // _buildHold restores whatever was packed
    _buildHold();
    /* A captain who died last run must not still be selected. Re-read
       the mess and keep the pick only if he is really there and home. */
    const home = (Base.captains?.() ?? []).filter(c => !c.away);
    if (!home.some(c => c.id === _captainId)) _captainId = null;
    if (!_captainId && home.length === 1) _captainId = home[0].id;
    // An animal that did not come home must not still be selected.
    const kept = Base.pets?.() ?? [];
    if (!kept.some(a => a.id === _petId)) _petId = null;
    // Pre-pick as many veterans as the ship will sensibly carry
    Base.crew().slice(0, 4).forEach(c => _picked.add(c.id));
    _launch = null;
  }

  function consumeLaunch() { const l = _launch; _launch = null; return l; }

  /** Which captain's board the player just asked for. */
  function consumeCpu() { const id = _cpuId; _cpuId = null; return id; }

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

  /** game.js hands these to LootScreen and gives them back on close. */
  function packGrids() {
    if (!_hold) _buildHold();
    if (!_store) _store = Base.storeGrid();
    return { store: _store, hold: _hold };
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
    _rackScroll = Utils.clamp(_rackScroll, 0,
                              Math.max(0, (Base.armoury?.() ?? []).length - RACK_VIS));
  }

  function update(dt) {
    if (_flashT > 0) _flashT -= dt;
    _blink += dt;

    // The wheel scrolls whichever hangar list the pointer is over. It is
    // read BEFORE the click zones so a scroll never also counts as a
    // click on the card underneath.
    const wheel = Input.mouse.scrollDelta || 0;
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
      case 'tab':      _tab = arg; break;
      /* The berth click is REFUSED when the packed hold cannot follow
         the player to the new hull — otherwise the crates that fit
         nowhere would be dropped on the floor. */
      case 'ship': {
        const was = _shipIdx;
        _shipIdx = arg;
        if (_buildHold() === false) _shipIdx = was;
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
        // A fresh captain is the one you meant to fly.
        if (r.ok && !_captainId) _captainId = r.captain.id;
        break;
      }
      case 'pickCaptain': _captainId = (_captainId === arg) ? null : arg; break;
      case 'pickPet':     _petId     = (_petId === arg) ? null : arg; break;
      /* The board is a screen of its own — hand the id up to
         game.js exactly the way PACK HOLD is handed up. */
      case 'cpu':         _cpuId = arg; return 'cpu';
      case 'devCaptain': {
        const r = Base.devCaptain?.({ level: 8, karma: 50 });
        const c = Base.devChips?.();
        _say(`${r?.message ?? ''} ${c?.message ?? ''}`.trim(), !!r?.ok);
        if (r?.ok && !_captainId) _captainId = r.captain.id;
        _syncStore();
        break;
      }
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

      case 'crew': {
        if (_picked.has(arg)) _picked.delete(arg);
        else _picked.add(arg);
        break;
      }
      case 'hire': { const r = Base.hireRecruit(); _say(r.message, r.ok);
        // Show the last page, where the new hand just landed.
        if (r.ok) _crewScroll = 9999;
        _clampScroll(); _syncStore(); break; }
      case 'sellShip': { const r = Base.sellShip(arg); _say(r.message, r.ok); if (r.ok) { _shipIdx = 0; _berthScroll = 0; } _clampScroll(); _buildHold(); _syncStore(); break; }
      case 'fit':      { const r = Base.installWeapon(_shipIdx, arg);  _say(r.message, r.ok); _clampScroll(); _syncStore(); break; }
      case 'unfit':    { const r = Base.uninstallWeapon(_shipIdx, arg); _say(r.message, r.ok); _syncStore(); break; }
      case 'sellGun':  { const r = Base.sellWeapon(arg); _say(r.message, r.ok); _clampScroll(); _syncStore(); break; }

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

      case 'launch': {
        _commitPack();
        const res = Base.launch({
          shipIndex: _shipIdx,
          crewIds: [..._picked],
          captainId: _captainId,
          petId: _petId,
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

    // Tabs
    TABS.forEach((t, i) => {
      _btn(ctx, 40 + i * 116, 92, 108, 30, t, { on: _tab === t, act: 'tab', arg: t });
    });

    const px = 40, py = 138, pw = W - 80, ph = 386;
    _panel(ctx, px, py, pw, ph, null);

    if (_tab === 'HANGAR')   _drawHangar(ctx, px, py, pw, ph, b);
    if (_tab === 'ARMOURY')  _drawArmoury(ctx, px, py, pw, ph, b);
    if (_tab === 'CREW')     _drawCrew(ctx, px, py, pw, ph, b);
    if (_tab === 'MESS')     _drawMess(ctx, px, py, pw, ph, b);
    if (_tab === 'SUPPLY')   _drawSupply(ctx, px, py, pw, ph, b);
    if (_tab === 'UPGRADES') _drawUpgrades(ctx, px, py, pw, ph, b);
    if (_tab === 'MEMORIAL') _drawMemorial(ctx, px, py, pw, ph);

    _drawLaunchBar(ctx, W, H, b);

    if (_flashT > 0 && _flash) {
      ctx.globalAlpha = Utils.clamp(_flashT, 0, 1);
      ctx.fillStyle = '#ffd700';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(_flash, W / 2, 128);
      ctx.globalAlpha = 1;
    }
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
  function _statChips(ctx, x, y, w, def) {
    const chips = (typeof weaponStatChips === 'function') ? weaponStatChips(def) : [];
    if (!chips.length) return 0;
    const H = 14, PAD = 5, ICON = 9, GAP = 4, ROWGAP = 3;
    let cx = x, cy = y, used = H;

    chips.forEach(ch => {
      ctx.font = '8px Share Tech Mono, monospace';
      const lw = ctx.measureText?.(ch.label)?.width ?? 20;
      ctx.font = '9px Share Tech Mono, monospace';
      const vw = ctx.measureText?.(ch.value)?.width ?? 10;
      const cw = PAD + lw + GAP + ICON + GAP + vw + PAD;

      if (cx > x && cx + cw > x + w) {            // wrap
        cx = x; cy += H + ROWGAP; used += H + ROWGAP;
      }

      ctx.fillStyle = ch.col + '14';
      ctx.beginPath(); ctx.roundRect(cx, cy, cw, H, 3); ctx.fill();
      ctx.strokeStyle = ch.col + '55'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(cx + 0.5, cy + 0.5, cw - 1, H - 1, 3); ctx.stroke();

      ctx.textAlign = 'left';
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = ch.col;
      ctx.font = '8px Share Tech Mono, monospace';
      ctx.fillText(ch.label, cx + PAD, cy + H - 4);
      ctx.globalAlpha = 1;

      Renderer.drawStatIcon?.(ctx, ch.icon, cx + PAD + lw + GAP, cy + (H - ICON) / 2,
                              ICON, ch.col);

      ctx.fillStyle = ch.col;
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(ch.value, cx + PAD + lw + GAP + ICON + GAP, cy + H - 4);

      cx += cw + GAP;
    });
    return used;
  }

  // ── Tab: ARMOURY ────────────────────────────────────────
  //  Left: the mounts on the selected hull. Right: the rack.

  // ── Tab: HANGAR ─────────────────────────────────────────

  // The selected hull is BUILT, not sketched: a real Ship object with
  // the crew you picked standing in it, drawn at full size. Rebuilt only
  // when the selection actually changes.
  let _preview = null, _previewKey = '';


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

    const key = `${_shipIdx}|${entry.key}|${[..._picked].sort().join(',')}|${cx}|${cy}`;
    if (_previewKey === key && _preview) return _preview;

    try {
      const bnd = _layoutBounds(entry.key);
      const wx = Math.round(cx - bnd.w / 2 - bnd.x);
      const wy = Math.round(cy - bnd.h / 2 - bnd.y);
      const sh = entry.data
        ? Ship.deserialise(entry.data, true, wx, wy)
        : new Ship(entry.key, true, wx, wy);
      sh._allocateDefaultPower?.();

      const picked = Base.crew().filter(c => _picked.has(c.id));
      picked.forEach(cd => { try { sh.addCrew(CrewMember.deserialise(cd)); } catch (e) {} });
      sh.assignStations?.();
      // Let them walk to their posts so the picture is the ship you are
      // actually launching, not everybody stacked in the airlock.
      for (let i = 0; i < 60; i++) sh.update(0.05);

      _preview = sh; _previewKey = key;
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
    if (key) Renderer.drawShipThumb(ctx, key, x + w - tw - 10, y + 10, tw, th,
                                    { rooms: opts.rooms, levels: opts.levels });

    ctx.textAlign = 'left';
    ctx.fillStyle = on ? '#c8e8ff' : '#9fb4cc';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.fillText(label, x + 12, y + 20);
    // Text stops where the thumbnail starts — a blurb that ran under the
    // picture looked like two overlapping sentences.
    const textW = (key ? w - tw - 10 : w) - 24;
    ctx.font = '10px Share Tech Mono, monospace';
    lines.forEach((ln, i) => {
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
        lines: [{ text: def.blurb || '' }],
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
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(px + 16, y, 500, ROW_H, 5); ctx.fill();
      ctx.strokeStyle = def ? '#ffb020' : '#2a3346'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(px + 16, y, 500, ROW_H, 5); ctx.stroke();

      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`MOUNT ${i + 1}`, px + 28, y + 18);

      if (def) {
        // The gun itself, in its own colour — you should be able to tell
        // a flak drum from an ion coil without reading a word.
        const col = Renderer.weaponStyleColor?.(gun.defKey, def.type) || '#ffd780';
        Renderer.drawWeaponIcon?.(ctx, gun.defKey, px + 88, y + 10, 52, 20,
                                  { dir: 1, powered: true, type: def.type });
        ctx.fillStyle = col;
        ctx.font = '13px Share Tech Mono, monospace';
        ctx.fillText(def.label, px + 148, y + 22);
        // 252 wide, the same as the rack, so a gun's chips wrap the same
        // way on both sides of the screen.
        _statChips(ctx, px + 148, y + 30, 252, def);
        _btn(ctx, px + 406, y + 27, 100, 30, 'UNFIT', { act: 'unfit', arg: i, col: '#ff7c20' });
      } else {
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
      const def = getWeaponDef(key) || { label: key, cost: 0 };
      const y = py + 40 + vi * PITCH;
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(px + 560, y, 560, ROW_H, 5); ctx.fill();
      ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(px + 560, y, 560, ROW_H, 5); ctx.stroke();

      const rcol = Renderer.weaponStyleColor?.(key, def.type) || '#c8d8f0';
      Renderer.drawWeaponIcon?.(ctx, key, px + 572, y + 10, 52, 20,
                                { dir: 1, powered: true, type: def.type });
      ctx.fillStyle = rcol;
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(def.label, px + 636, y + 22);
      _statChips(ctx, px + 636, y + 30, 252, def);

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

  /**
   * The same star the combat HUD shows, computed from a SERIALISED crew
   * record. Barracks crew are plain save objects, not CrewMember
   * instances, so `getStarRating()` is not available here — that is why
   * the barracks used to be the one place a veteran looked ordinary.
   */
  function _crewStar(c) {
    const sk = c?.skills || {};
    const maxLvl  = (typeof MAX_SKILL_LEVEL !== 'undefined') ? MAX_SKILL_LEVEL : 3;
    const needAll = (typeof MAX_MASTERED    !== 'undefined') ? MAX_MASTERED    : 3;
    const m = Object.values(sk).filter(s => (s?.level ?? 0) >= maxLvl).length;
    if (m >= needAll) return { col: '#ffd700', label: 'gold', n: m };
    if (m >= 1)       return { col: '#c8d8f0', label: 'silver', n: m };
    return null;
  }

  /** Barracks crew keep the plague between contracts — it has to be
   *  visible BEFORE you pick them, not after they are aboard. */
  function _crewPlague(c) {
    if (c?.virus)    return { glyph: '☣', col: '#9fff7a', tip: 'VIRUS' };
    if (c?.infected) return { glyph: '☣', col: '#ff7c20', tip: 'INFECTED' };
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
      ctx.fillStyle = on ? 'rgba(26,255,140,0.14)' : 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, y, 364, 66, 5); ctx.fill();
      ctx.strokeStyle = on ? '#1aff8c' : '#1e2d4a'; ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(x, y, 364, 66, 5); ctx.stroke();

      // Serialised crew carry no `color` — read it off the corporation.
      ctx.fillStyle = crewColor(c);
      ctx.fillRect(x + 10, y + 12, 22, 22);
      ctx.fillStyle = '#c8d8f0';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      const nm = c.name || 'Crew';
      ctx.fillText(nm, x + 42, y + 22);

      // ── the two markers the barracks was missing ──
      // A star for mastery, exactly as the in-flight roster draws it…
      let markX = x + 46 + (ctx.measureText?.(nm)?.width ?? 40);
      const star = _crewStar(c);
      if (star) {
        ctx.fillStyle = star.col;
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.fillText('★', markX, y + 22);
        markX += 14;
      }
      // …and a blinking plague glyph, so you cannot pick an infected
      // veteran by accident and find out about it in the next fight.
      const plague = _crewPlague(c);
      if (plague) {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(_blink * 6);
        ctx.fillStyle = plague.col;
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.fillText(plague.glyph, markX, y + 22);
        ctx.font = '8px Share Tech Mono, monospace';
        ctx.fillText(plague.tip, markX + 12, y + 22);
        ctx.restore();
      }

      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      const corp = (CORP_DEFS[c.race] || {}).label || c.race || '—';
      ctx.fillText(_clip(ctx, corp + (star ? `  ·  ${star.n}★ mastered` : ''), 146),
                   x + 42, y + 36);

      /* ── CONDITION ─────────────────────────────────────────
         A bar and the raw numbers, on their own row between the
         corporation and the pick line. Same colour ramp as the hangar
         hull strip, so "green is fit, red is a liability" reads the
         same everywhere. Nothing heals in the barracks — a man comes
         home as he left the fight — which is exactly why this has to
         be on the card you choose from. */
      {
        const h = _crewHp(c);
        ctx.fillStyle = '#5f7893';
        ctx.font = '9px Share Tech Mono, monospace';
        ctx.fillText('HP', x + 42, y + 50);
        const bx = x + 60, bw = 68, by = y + 43;
        ctx.fillStyle = '#0a1018';
        ctx.fillRect(bx, by, bw, 7);
        ctx.fillStyle = h.col;
        ctx.fillRect(bx, by, Math.round(bw * h.pct), 7);
        ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw, 7);
        ctx.fillStyle = h.col;
        ctx.font = '9px Share Tech Mono, monospace';
        ctx.fillText(`${h.hp}/${h.max}`, bx + bw + 6, y + 50);
        // A wounded man is worth flagging, not just colouring.
        if (h.pct <= 0.3) {
          ctx.fillStyle = '#ff2d44';
          ctx.fillText('WOUNDED', x + 42, y + 62);
        }
      }

      ctx.fillStyle = on ? '#1aff8c' : '#4a6080';
      ctx.font = '10px Share Tech Mono, monospace';
      if (_crewHp(c).pct > 0.3) ctx.fillText(on ? '✓ COMING ALONG' : 'click to bring', x + 42, y + 62);
      else { ctx.fillStyle = on ? '#1aff8c' : '#4a6080';
             ctx.fillText(on ? '✓ COMING' : 'click', x + 108, y + 62); }

      // EVERY skill, right on the card — no hovering, no guessing which
      // veteran is the gunner and which one just cleans the reactor.
      // Pushed RIGHT and tightened, because the name line now has to fit
      // a star and a plague marker beside the name: at x+150 the words
      // "3 skills mastered" printed straight through the Weapons pips.
      const sk = c.skills || {};
      let sx = x + 190;
      Object.entries(SKILL_DEFS).forEach(([key, def], si) => {
        const lvl = sk[key]?.level ?? 0;
        const row = si % 3, col = Math.floor(si / 3);
        const bx = sx + col * 56, by = y + 12 + row * 16;
        ctx.fillStyle = lvl > 0 ? def.color : '#39445c';
        ctx.font = '9px Share Tech Mono, monospace';
        ctx.fillText(def.label.slice(0, 5), bx, by + 8);
        for (let l = 0; l < MAX_SKILL_LEVEL; l++) {
          ctx.fillStyle = l < lvl ? def.color : '#1a2030';
          ctx.fillRect(bx + 34 + l * 7, by + 1, 5, 7);
        }
      });
      _zones.push({ x, y, w: 364, h: 66, act: 'crew', arg: c.id });
    });

    // Scroll rail down the right-hand edge of the card area.
    _scrollBar(ctx, px + pw - 26, py + 46, CREW_ROWS * 76 - 14,
               _crewScroll, CREW_ROWS, Math.ceil(b.barracks.length / CREW_COLS),
               'scrollCrew');

    const canHire = b.barracks.length < Base.barracksCap() && Base.cc() >= Base.PRICE.recruit;
    _btn(ctx, px + 16, py + ph - 44, 220, 30,
         `HIRE RECRUIT — ${Base.PRICE.recruit} CC`,
         { act: canHire ? 'hire' : null, enabled: canHire, col: '#1aff8c',
           sub: b.barracks.length >= Base.barracksCap() ? 'barracks full' : null });
  }


  // ── Tab: MESS (update43) ────────────────────────────────

  /**
   * THE CAPTAIN'S MESS.
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
    const crews  = Base.captains?.() ?? [];
    const ROMAN  = ['—', 'I', 'II', 'III', 'IV'];
    const petN   = Base.petCap?.() ?? 2;

    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`THE MESS ${ROMAN[Utils.clamp(Base.messLevel?.() ?? 1, 0, 4)]}`
               + `  —  ${crews.length}/${cap} berths`, px + 20, py + 26);

    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('A captain flies one contract at a time. He is lost with the ship. '
               + 'More berths: UPGRADES.', px + 20, py + 44);

    // ── Berths ──
    /* THE PANEL IS 386 PIXELS TALL AND THAT IS THE WHOLE BUDGET.
       Four berths plus the animal pens have to fit, so a captain card
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
      _captainCard(ctx, x, y, CW, CH, c);
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
      ctx.fillText(animals.length
        ? 'One animal per hull. It hunts vermin and sits with the wounded.'
        : 'no animals yet', tx, penY + 40);

      /* ── ADOPT A CAT (update47) ──
         Until now the only cat in the game came off a stowaway roll on
         the map, which meant you could fly six contracts and never see
         one — impossible to plan around, and worse, impossible to
         test. The station keeps cats; buying one is a button, and it
         fills a PEN, never a bunk. */
      /* ── TEST BENCH (update49a) ──
         The CPU board needs a captain, and a captain is eight fights
         of work away. This is the door marked TEST — see
         Base.devCaptain: the real promotion rule is untouched. */
      _btn(ctx, tx + 176, penY + 14, 190, 22, 'TEST: KAPITAN + CHIPY',
           { act: 'devCaptain', col: '#ff8adf' });

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
    ctx.fillText(pool.length
      ? `${Base.PRICE?.promotion ?? 100} CC. He leaves the barracks for good — his mastered skills go with him.`
      : 'Nobody has mastered a skill yet. Fly them until somebody does.',
      rx, py + 44);


    const RH = 72;
    pool.slice(0, 5).forEach((c, i) => {
      const y = py + 74 + i * (RH + 8);
      if (y + RH > py + ph - 10) return;
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(rx, y, rw, RH, 5); ctx.fill();
      ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(rx, y, rw, RH, 5); ctx.stroke();

      ctx.fillStyle = crewColor(c);
      ctx.fillRect(rx + 10, y + 10, 26, 26);
      ctx.fillStyle = '#c8d8f0';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(_clip(ctx, c.name || '—', 130), rx + 46, y + 24);

      const corp = (CORP_DEFS[c.race] || {}).label || c.race || '—';
      const star = _crewStar(c);
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(corp + (star ? `  ·  ${star.n}★` : ''), rx + 46, y + 40);

      /* WHAT THE BASE LOSES. These are the mastered skills walking out
         of the barracks — the whole reason this decision is hard. */
      const gone = (typeof Captain !== 'undefined' ? Captain.masteredOf(c) : [])
        .map(k => (SKILL_DEFS[k]?.label ?? k)).join(', ');
      ctx.fillStyle = '#ff7c20';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(_clip(ctx, 'you lose: ' + (gone || '—'), rw - 190), rx + 46, y + 56);

      const price = Base.PRICE?.promotion ?? 100;
      const room  = crews.length < cap;
      const can   = room && Base.cc() >= price;
      _btn(ctx, rx + rw - 150, y + 20, 138, 32,
           room ? `PROMOTE — ${price} CC` : 'NO BERTH',
           { act: can ? 'promote' : null, arg: c.id, enabled: can, col: '#ffd700' });
    });
    if (pool.length > 5) {
      ctx.fillStyle = '#4a6080';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`…and ${pool.length - 5} more in the barracks`, rx, py + 74 + 5 * (RH + 8) + 14);
    }
  }

  /** One captain, one dense line: who he is, how far he has come,
   *  and what his own corporation gets out of him. */
  function _captainCard(ctx, x, y, w, h, c) {
    const picked = _captainId === c.id;
    ctx.fillStyle = picked ? 'rgba(26,140,255,0.18)' : 'rgba(13,17,32,0.92)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill();
    ctx.strokeStyle = picked ? '#4db8ff' : '#1e2d4a';
    ctx.lineWidth = picked ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.stroke();

    ctx.fillStyle = crewColor(c);
    ctx.fillRect(x + 8, y + 8, 26, 26);
    ctx.fillStyle = '#c8d8f0';
    ctx.fillRect(x + 11, y + 11, 20, 10);        // helmet

    ctx.fillStyle = '#c8d8f0';
    ctx.font = '13px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(_clip(ctx, c.name || '—', w - 160), x + 42, y + 20);

    const corp   = (CORP_DEFS[c.race] || {}).label || c.race || '—';
    const maxLvl = (typeof Captain !== 'undefined' ? Captain.MAX_LEVEL : 8);
    const need   = (typeof Captain !== 'undefined' ? Captain.xpToNext(c) : 0);
    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`${corp}  ·  LEVEL ${c.level}`, x + 42, y + 34);

    // Progress toward the next promotion
    _bar(ctx, x + 42, y + 39, 120,
         c.level >= maxLvl ? 1 : (c.xp || 0),
         c.level >= maxLvl ? 1 : (need || 1), '#1a8cff');
    ctx.fillStyle = '#5f7893';
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillText(c.level >= maxLvl ? 'MAX' : `${Math.round(c.xp)}/${need}`, x + 168, y + 47);

    /* WHAT HE IS WORTH, and to WHOM. The "own corporation only" half is
       not a footnote — a captain paired with the wrong crew pays out
       nothing at all, and the card has to say so where it is read. */
    const lines = (typeof Captain !== 'undefined' ? Captain.bonusLines(c) : []);
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillStyle = '#1aff8c';
    ctx.fillText(lines.map(l => `${l[0]} ${l[1]}`).join('   ') || '—', x + 8, y + 56);
    ctx.fillStyle = '#4a6080';
    ctx.textAlign = 'right';
    ctx.fillText(`${corp} crew only`, x + w - 10, y + 56);
    ctx.textAlign = 'left';

    if (c.away) {
      ctx.fillStyle = '#ff7c20';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('ON CONTRACT', x + w - 10, y + 22);
      ctx.textAlign = 'left';
      return;
    }
    _btn(ctx, x + w - 98, y + 8, 88, 22,
         picked ? '✓ FLYING' : 'FLY HIM',
         { act: 'pickCaptain', arg: c.id, on: picked, col: '#1aff8c' });

    /* ── HIS CPU BOARD (update49) ──
       Karma is drawn as what it actually does: how many columns of
       each side he has. The board itself opens on its own screen —
       it is a real grid you move real chips on, so it belongs beside
       the shelf, not squeezed into a 62-pixel card. */
    if (typeof Chips !== 'undefined') {
      const wall = Chips.wallColumn(c.karma ?? 50);
      const good = wall - 1, evil = Chips.COLS - wall;
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillStyle = '#4dd8c0';
      ctx.textAlign = 'right';
      ctx.fillText(`karma ${Math.round(c.karma ?? 50)} · ${good} dobra / ${evil} zła`
                 + ` · ${Chips.rowsFor(c.level)} rz.`, x + w - 104, y + 47);
      ctx.textAlign = 'left';
      _btn(ctx, x + w - 98, y + 34, 88, 20, 'PLANSZA CPU',
           { act: 'cpu', arg: c.id, col: '#b8c4d4' });
    }
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

    [['fuel', 'He2', '#ff6b7a'], ['missiles', 'MISSILES', '#ffb347'],
     ['scan', 'SURVEY PROBE', '#4dffd0'],
     ['food', 'RATIONS', '#8fa8c0']].forEach(([kind, label, col]) => {
      const price = Base.unitPrice(kind);
      // The pictogram went missing when SUPPLY was rebuilt around one
      // shelf: the rewrite kept the fuel tank and dropped the warhead
      // rack, so the missile line was the only stock line with no icon.
      _supplyIcon(ctx, kind, x + pad + 1, ly - 8, 12, 10);
      ctx.fillStyle = col;
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText(`${label} — ${price} CC each`, x + pad + 20, ly);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#c8d8f0';
      ctx.fillText(`${stock[kind]} held`, x + cardW - pad, ly);
      ctx.textAlign = 'left';
      const can1 = Base.cc() >= price && room > 0;
      const can5 = Base.cc() >= price * 5 && room > 0;
      _btn(ctx, x + pad, ly + 10, Math.floor((inner - 8) / 2), 26, 'BUY ×1',
           { act: can1 ? 'buy' : null, arg: [kind, 1], enabled: can1, col: '#1aff8c' });
      _btn(ctx, x + pad + Math.floor((inner - 8) / 2) + 8, ly + 10,
           Math.floor((inner - 8) / 2), 26, 'BUY ×5',
           { act: can5 ? 'buy' : null, arg: [kind, 5], enabled: can5, col: '#1aff8c' });
      ly += 42;
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
    const graves = (typeof Save !== 'undefined' && Save.getGraveyard)
      ? Save.getGraveyard() : [];

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
    ctx.fillText(graves.length
      ? `${graves.length} crew never came home. Hover a marker to read the name.`
      : 'Nobody is buried here yet. Keep it that way.', px + 16, py + 44);

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
  function _drawGrave(ctx, x, y, hot, g) {
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
        ctx.fillText(`${def.label.slice(0, 5)} ${v.level}`, sx, y + 132);
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
      // A captain's cap: peak and crown.
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
        now: `${Base.messCap?.() ?? 1} captain berths`,
        next: `${(Base.messCap?.() ?? 1) + 1} captain berths`,
        blurb: 'Another chair for a captain. Only one flies a contract, '
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
  function _drawLaunchBar(ctx, W, H, b) {
    const y = 542;
    _panel(ctx, 40, y, W - 80, 148, null);

    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CONTRACT', 56, y + 22);

    const list = Base.missions();
    const GAP = 12;
    const CARDW = Math.min(300, Math.floor((W - 60 - 190 - 20 - 56 - GAP * (list.length - 1)) / list.length));
    list.forEach((m, i) => {
      const x = 56 + i * (CARDW + GAP), my = y + 32;
      const on = _mission === m.id;
      ctx.fillStyle = on ? 'rgba(26,140,255,0.18)' : 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, my, CARDW, 88, 5); ctx.fill();
      ctx.strokeStyle = on ? '#4db8ff' : '#1e2d4a'; ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(x, my, CARDW, 88, 5); ctx.stroke();

      ctx.fillStyle = on ? '#c8e8ff' : '#9fb4cc';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(_clip(ctx, m.label, CARDW - 76), x + 12, my + 20);

      // A contract with no boss says so — it is the whole reason to
      // take the short one.
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = m.boss ? '#ff5566' : '#1aff8c';
      ctx.fillText(m.boss ? 'BOSS' : 'NO BOSS', x + CARDW - 12, my + 20);
      ctx.textAlign = 'left';

      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      _wrap(ctx, m.blurb, x + 12, my + 38, CARDW - 24, 13);
      ctx.fillStyle = '#ffd700';
      ctx.fillText(`${m.sectors} sector${m.sectors > 1 ? 's' : ''}   ·   bonus ${m.ccBonus} CC`,
                   x + 12, my + 76);
      _zones.push({ x, y: my, w: CARDW, h: 88, act: 'mission', arg: m.id });
    });

    const ready = !!b.ships[_shipIdx];
    // "Low He2" now means what is PACKED, not what a phantom tank held.
    const warn  = _holdSummary().fuel < 3;
    // Anchored to the panel's right edge so it can never sit on a card
    _btn(ctx, W - 60 - 190, y + 40, 190, 56, 'LAUNCH',
         { act: ready ? 'launch' : null, enabled: ready,
           col: warn ? '#ffd700' : '#1aff8c',
           font: '18px Orbitron, monospace',
           sub: !ready ? 'no ship in the hangar'
              : warn   ? 'low He2 — you may strand' : 'contract begins' });
  }

  function _wrap(ctx, text, x, y, maxW, lh) {
    const words = String(text).split(' ');
    let line = '', ly = y;
    ctx.textAlign = 'left';
    words.forEach(w => {
      const test = line ? line + ' ' + w : w;
      if ((ctx.measureText?.(test)?.width ?? 0) > maxW && line) {
        ctx.fillText(line, x, ly); ly += lh; line = w;
      } else line = test;
    });
    if (line) ctx.fillText(line, x, ly);
    return ly;
  }

  return {
    open, update, draw, consumeLaunch, consumeCpu, packGrids, commitPack,
    // exposed for tests
    _levels: _entryLevels,
    // exposed for tests
    _state: () => ({ tab: _tab, shipIdx: _shipIdx, picked: [..._picked],
                     captainId: _captainId, petId: _petId,
                     fuel: _fuel, missiles: _missiles, mission: _mission,
                     hold: _hold, store: _store, packed: _holdSummary(),
                     yardScroll: _yardScroll, berthScroll: _berthScroll,
                     yardVis: YARD_VIS, berthVis: BERTH_VIS }),
    _set: (o) => {
      if (o.tab !== undefined) _tab = o.tab;
      if (o.shipIdx !== undefined) { _shipIdx = o.shipIdx; _buildHold(); }
      if (o.picked !== undefined) _picked = new Set(o.picked);
      if (o.captainId !== undefined) _captainId = o.captainId;
      if (o.petId !== undefined) _petId = o.petId;
      if (o.fuel !== undefined) _fuel = o.fuel;
      if (o.missiles !== undefined) _missiles = o.missiles;
      if (o.mission !== undefined) _mission = o.mission;
      if (o.yardScroll !== undefined)  { _yardScroll  = o.yardScroll;  _clampScroll(); }
      if (o.berthScroll !== undefined) { _berthScroll = o.berthScroll; _clampScroll(); }
    },
    _clampScroll,
    _act,
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
