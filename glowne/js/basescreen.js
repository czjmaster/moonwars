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

  const TABS = ['HANGAR', 'ARMOURY', 'CREW', 'SUPPLY', 'WAREHOUSE', 'UPGRADES'];

  let _tab       = 'HANGAR';
  let _shipIdx   = 0;
  let _picked    = new Set();     // crew ids coming along
  let _fuel      = 0;             // He2 in the TANK (jump fuel, not cargo)
  let _missiles  = 0;             // legacy loose rounds — crates are the real ammo now
  let _hold      = null;          // CargoGrid packed for the launch
  let _store     = null;          // CargoGrid of what the base can hand over
  let _mission   = 'patrol';
  let _zones     = [];            // {x,y,w,h,act,arg}
  let _launch    = null;          // filled when the player commits
  let _flash     = '';            // last message
  let _flashT    = 0;

  function open() {
    const b = Base.get();
    _tab = 'HANGAR';
    _shipIdx = 0;
    _picked = new Set();
    _mission = b.lastMission || 'patrol';
    // Sensible default load: fill up on what we have, within reason
    _fuel     = Math.min(b.warehouse.fuel, 10);
    _missiles = 0;                 // missiles ride in crates now, not as a number
    _buildHold();
    // Pre-pick as many veterans as the ship will sensibly carry
    Base.crew().slice(0, 4).forEach(c => _picked.add(c.id));
    _launch = null;
  }

  function consumeLaunch() { const l = _launch; _launch = null; return l; }

  /** Hold sized for the SELECTED hull, keeping whatever still fits. */
  function _buildHold() {
    if (typeof CargoGrid === 'undefined') { _hold = null; _store = null; return; }
    const b = Base.get();
    const entry = b.ships[_shipIdx];
    const key   = entry?.key ?? 'scout';
    const layout = (typeof SHIP_LAYOUTS !== 'undefined' && SHIP_LAYOUTS[key]) || null;
    const cols = (layout?.cargoCols ?? 5) + (Base.holdBonus?.() ?? 0);
    const rows = layout?.cargoRows ?? 4;

    const carried = _hold ? [..._hold.items] : [];
    _hold = new CargoGrid(cols, rows);
    _store = Base.storeGrid(_fuel);
    // A smaller hull may not take everything — the overflow goes back on
    // the shelf rather than silently vanishing.
    carried.forEach(it => { if (!_hold.autoPlace(it)) _store?.autoPlace(it); });
  }

  /**
   * The base changed under us — rebuild the shelf and take back anything
   * in the packed hold the base can no longer cover. Called after EVERY
   * action that touches the armoury or the warehouse.
   */
  function _syncStore() {
    if (typeof CargoGrid === 'undefined') return;
    const dropped = Base.pruneHold?.(_hold, _fuel) ?? [];
    _store = Base.storeGrid(_fuel);
    if (dropped.length) _say(`Taken back out of the hold: ${dropped.join(', ')}`, false);
  }

  /** What the packed hold is worth to the run, in plain numbers. */
  function _holdSummary() {
    const sum = { fuel: 0, missiles: 0, guns: 0, cells: 0, cap: 0 };
    if (!_hold) return sum;
    sum.cells = _hold.usedCells(); sum.cap = _hold.capacity;
    _hold.items.forEach(it => {
      if (it.def.kind === 'fuel') sum.fuel += it.def.amount;
      else if (it.def.kind === 'missiles') sum.missiles += it.def.amount;
      else if (it.def.kind === 'weapon') sum.guns++;
    });
    return sum;
  }

  /** game.js hands these to LootScreen and gives them back on close. */
  function packGrids() {
    if (!_hold) _buildHold();
    if (!_store) _store = Base.storeGrid(_fuel);
    return { store: _store, hold: _hold };
  }

  function _say(msg, good = true) {
    _flash = msg; _flashT = 3.2;
    if (typeof UI !== 'undefined') UI.notify?.(msg, good ? 'good' : 'warn');
  }

  // ── Input ───────────────────────────────────────────────

  function update(dt) {
    if (_flashT > 0) _flashT -= dt;
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
      case 'ship':     _shipIdx = arg; _buildHold(); break;
      case 'pack':     packGrids(); return 'pack';
      case 'warehouse': return 'warehouse';
      case 'buyShip':  { const r = Base.buyShip(arg); _say(r.message, r.ok); _syncStore(); break; }
      case 'mission':  _mission = arg; break;

      case 'crew': {
        if (_picked.has(arg)) _picked.delete(arg);
        else _picked.add(arg);
        break;
      }
      case 'hire': { const r = Base.hireRecruit(); _say(r.message, r.ok); _syncStore(); break; }
      case 'sellShip': { const r = Base.sellShip(arg); _say(r.message, r.ok); if (r.ok) _shipIdx = 0; _buildHold(); _syncStore(); break; }
      case 'fit':      { const r = Base.installWeapon(_shipIdx, arg);  _say(r.message, r.ok); _syncStore(); break; }
      case 'unfit':    { const r = Base.uninstallWeapon(_shipIdx, arg); _say(r.message, r.ok); _syncStore(); break; }
      case 'sellGun':  { const r = Base.sellWeapon(arg); _say(r.message, r.ok); _syncStore(); break; }

      case 'load': {
        // arg = ['fuel'|'missiles', delta]
        const [kind, delta] = arg;
        const stock = b.warehouse[kind];
        if (kind === 'fuel') {
          _fuel = Utils.clamp(_fuel + delta, 0, stock);
          _syncStore();                     // tanks compete with the tank
        } else {
          _missiles = Utils.clamp(_missiles + delta, 0, stock);
        }
        break;
      }
      case 'buy': { const r = Base.buySupply(arg[0], arg[1]); _say(r.message, r.ok); _syncStore(); break; }
      case 'upgrade': { const r = Base.buyUpgrade(arg); _say(r.message, r.ok); if (r.ok && arg === 'hold') _buildHold(); _syncStore(); break; }

      case 'launch': {
        Base.pruneHold?.(_hold, _fuel);
        const res = Base.launch({
          shipIndex: _shipIdx,
          crewIds: [..._picked],
          fuel: _fuel, missiles: _missiles,
          mission: _mission,
          hold: _hold,
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
      _btn(ctx, 40 + i * 132, 92, 124, 30, t, { on: _tab === t, act: 'tab', arg: t });
    });

    const px = 40, py = 138, pw = W - 80, ph = 386;
    _panel(ctx, px, py, pw, ph, null);

    if (_tab === 'HANGAR')   _drawHangar(ctx, px, py, pw, ph, b);
    if (_tab === 'ARMOURY')  _drawArmoury(ctx, px, py, pw, ph, b);
    if (_tab === 'CREW')     _drawCrew(ctx, px, py, pw, ph, b);
    if (_tab === 'SUPPLY')   _drawSupply(ctx, px, py, pw, ph, b);
    if (_tab === 'WAREHOUSE') _drawWarehouse(ctx, px, py, pw, ph, b);
    if (_tab === 'UPGRADES') _drawUpgrades(ctx, px, py, pw, ph, b);

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

  /** One empty box per second of charge time, in the gun's colour —
   *  the same grammar the combat HUD uses, so the number means
   *  something the moment you see it in the shop. */
  function _chargeStrip(ctx, x, y, def, col) {
    const secs = Math.max(1, Math.round(def.chargeTime ?? 1));
    const bw = 5, gap = 2;
    for (let i = 0; i < secs; i++) {
      const bx = x + i * (bw + gap);
      ctx.fillStyle = 'rgba(6,9,16,0.9)';
      ctx.fillRect(bx, y, bw, 6);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, y + 0.5, bw - 1, 5);
      ctx.globalAlpha = 1;
    }
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

  /** A compact module readout: icon, name, level pips. */

  /** A compact module readout: icon, name, level pips. */
  function _moduleStrip(ctx, x, y, w, entry) {
    const mods = _entryLevels(entry);
    const empties = _entryRooms(entry).filter(r => r.type === 'empty').length;
    const COL = {
      engines:'#1aff8c', weapons:'#ff5566', shields:'#4db8ff', piloting:'#9fdcff',
      oxygen:'#4dd8ff',  medbay:'#3aff6a',  reactor:'#ffb020', cloaking:'#cc44ff',
      autorepair:'#ffd700', artillery:'#ff7c20',
    };
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5f7893';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('MODULES', x, y);

    const perRow = 3, cw = Math.floor(w / perRow);
    mods.forEach((m, i) => {
      const mx = x + (i % perRow) * cw;
      const my = y + 16 + Math.floor(i / perRow) * 22;
      const col = COL[m.type] || '#7a90a8';
      ctx.fillStyle = col;
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.fillText(Renderer.systemGlyph(m.type), mx, my + 2);
      ctx.fillStyle = '#9fb4cc';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(MOD_LABEL[m.type] || m.type, mx + 18, my + 2);
      // ONE PIP PER POWER SLOT — the same count the power bar shows.
      const shown = Math.min(m.level, 8);
      for (let l = 0; l < shown; l++) {
        ctx.fillStyle = l < (m.level - (m.damaged ?? 0)) ? col : '#ff2d44';
        ctx.fillRect(mx + 80 + l * 6, my - 6, 4, 7);
      }
      if (m.level > shown) {
        ctx.fillStyle = col;
        ctx.font = '9px Share Tech Mono, monospace';
        ctx.fillText(`+${m.level - shown}`, mx + 80 + shown * 6 + 2, my + 1);
      }
    });

    const rows = Math.ceil(mods.length / perRow);
    const by = y + 16 + rows * 22;
    const reactor = _entryReactor(entry);
    const draw = mods.reduce((n, m) => n + (m.type === 'reactor' ? 0 : m.level), 0);
    ctx.fillStyle = '#ffb020';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`reactor ${reactor} power  ·  ${draw} slots to fill`, x, by);
    ctx.fillStyle = empties ? '#ffd700' : '#4a6080';
    ctx.fillText(empties ? `${empties} empty bay${empties > 1 ? 's' : ''} — room to fit more`
                         : 'every bay is fitted', x, by + 14);
    return by + 20;
  }

  function _drawHangar(ctx, px, py, pw, ph, b) {
    // Shipyard on the LEFT (what you could buy), your berths on the
    // RIGHT (what you own), and the selected hull drawn full size in
    // the middle so it is obvious what you are about to fly.
    const COL = 268;
    const yardX  = px + 16;
    const berthX = px + pw - COL - 16;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.fillText('SHIPYARD', yardX, py + 22);
    ctx.fillText(`YOUR HANGAR — ${b.ships.length}/${Base.shipSlots()} berths`,
                 berthX, py + 22);

    // ── LEFT: for sale ──
    let ly = py + 32;
    Base.catalog().forEach((def) => {
      const owned = b.ships.some(s2 => s2.key === def.key);
      const room  = b.ships.length < Base.shipSlots();
      const can   = !owned && room && Base.cc() >= def.cost;
      _shipRow(ctx, yardX, ly, COL, 84, {
        label: def.label, key: def.key,
        rooms: SHIP_LAYOUTS[def.key]?.rooms.map(r => ({ id: r.id, type: r.type })),
        levels: _entryLevels({ key: def.key, data: null }),
        lines: [{ text: def.blurb || '' }],
        btnLabel: owned ? 'OWNED' : (def.cost ? `BUY — ${def.cost} CC` : 'STANDARD'),
        btnAct: 'buyShip', btnArg: def.key, btnEnabled: can, btnCol: '#1aff8c',
        btnSub: owned ? 'you own one' : (!room ? 'no berth' : null),
        bigThumb: true,
      });
      ly += 90;
    });

    // ── RIGHT: what you own ──
    let ry = py + 32;
    if (!b.ships.length) {
      ctx.fillStyle = '#ff5566';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText('Hangar empty — buy a hull on the left.', berthX, py + 50);
    }
    b.ships.forEach((entry, i) => {
      const def = SHIP_CATALOG[entry.key] || { label: entry.key };
      const L   = SHIP_LAYOUTS[entry.key];
      const resale = Math.round((SHIP_CATALOG[entry.key]?.cost ?? 0) * 0.30);
      const canSell = b.ships.length > 1;
      _shipRow(ctx, berthX, ry, COL, 84, {
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
      ry += 90;
    });

    // Module readout for the SELECTED hull, under its berth card.
    if (b.ships[_shipIdx]) {
      _moduleStrip(ctx, berthX, Math.max(ry + 8, py + 200), COL, b.ships[_shipIdx]);
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
    for (let i = 0; i < slots; i++) {
      const y   = py + 40 + i * 62;
      const gun = fitted.find(f => f.slot === i);
      const def = gun ? getWeaponDef(gun.defKey) : null;
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(px + 16, y, 500, 54, 5); ctx.fill();
      ctx.strokeStyle = def ? '#ffb020' : '#2a3346'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(px + 16, y, 500, 54, 5); ctx.stroke();

      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`MOUNT ${i + 1}`, px + 28, y + 18);

      if (def) {
        // The gun itself, in its own colour — you should be able to tell
        // a flak drum from an ion coil without reading a word.
        const col = Renderer.weaponStyleColor?.(gun.defKey, def.type) || '#ffd780';
        Renderer.drawWeaponIcon?.(ctx, gun.defKey, px + 96, y + 8, 52, 20,
                                  { dir: 1, powered: true, type: def.type });
        ctx.fillStyle = col;
        ctx.font = '13px Share Tech Mono, monospace';
        ctx.fillText(def.label, px + 160, y + 20);
        ctx.fillStyle = '#7a90a8';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(`${def.damage} dmg · ${def.chargeTime}s · ⚡${def.powerCost}` +
                     `${def.missileUse ? ' · uses missiles' : ''}`, px + 160, y + 38);
        _chargeStrip(ctx, px + 160, y + 44, def, col);
        _btn(ctx, px + 400, y + 12, 100, 30, 'UNFIT', { act: 'unfit', arg: i, col: '#ff7c20' });
      } else {
        ctx.fillStyle = '#4a6080';
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.fillText('empty — fit a gun from the rack', px + 100, y + 30);
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
    rack.slice(0, 5).forEach((key, i) => {
      const def = getWeaponDef(key) || { label: key, cost: 0 };
      const y = py + 40 + i * 62;
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(px + 560, y, 560, 54, 5); ctx.fill();
      ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(px + 560, y, 560, 54, 5); ctx.stroke();

      const rcol = Renderer.weaponStyleColor?.(key, def.type) || '#c8d8f0';
      Renderer.drawWeaponIcon?.(ctx, key, px + 572, y + 8, 52, 20,
                                { dir: 1, powered: true, type: def.type });
      ctx.fillStyle = rcol;
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(def.label, px + 636, y + 20);
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`${def.damage} dmg · ${def.chargeTime}s · ⚡${def.powerCost}` +
                   `${def.missileUse ? ' · uses missiles' : ''}`, px + 636, y + 38);
      _chargeStrip(ctx, px + 636, y + 44, def, rcol);

      _btn(ctx, px + 900, y + 12, 100, 30, 'FIT',
           { act: 'fit', arg: i, col: '#1aff8c' });
      _btn(ctx, px + 1008, y + 12, 100, 30, `SELL ${Base.weaponValue(key)}`,
           { act: 'sellGun', arg: i, col: '#ffb020' });
    });
    if (rack.length > 5) {
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`…and ${rack.length - 5} more on the rack`, px + 560, py + ph - 18);
    }
  }

  // ── Tab: CREW ───────────────────────────────────────────
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

    b.barracks.forEach((c, i) => {
      const col = i % 3, row = Math.floor(i / 3);
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
      ctx.fillText(c.name || 'Crew', x + 42, y + 22);
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      const corp = (CORP_DEFS[c.race] || {}).label || c.race || '—';
      ctx.fillText(corp, x + 42, y + 38);
      ctx.fillStyle = on ? '#1aff8c' : '#4a6080';
      ctx.fillText(on ? '✓ COMING ALONG' : 'click to bring', x + 42, y + 54);

      // EVERY skill, right on the card — no hovering, no guessing which
      // veteran is the gunner and which one just cleans the reactor.
      const sk = c.skills || {};
      let sx = x + 150;
      Object.entries(SKILL_DEFS).forEach(([key, def], si) => {
        const lvl = sk[key]?.level ?? 0;
        const row = si % 3, col = Math.floor(si / 3);
        const bx = sx + col * 58, by = y + 12 + row * 16;
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

    const canHire = b.barracks.length < Base.barracksCap() && Base.cc() >= Base.PRICE.recruit;
    _btn(ctx, px + 16, py + ph - 44, 220, 30,
         `HIRE RECRUIT — ${Base.PRICE.recruit} CC`,
         { act: canHire ? 'hire' : null, enabled: canHire, col: '#1aff8c',
           sub: b.barracks.length >= Base.barracksCap() ? 'barracks full' : null });
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
    const cap = Base.warehouseCap();
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`WAREHOUSE — ${cap} units per line`, px + 16, py + 22);

    const GAP = 16;
    const cardW = Math.floor((pw - 32 - GAP * 2) / 3);
    const cardH = ph - 70;
    const top = py + 34;

    const lines = [
      { kind: 'fuel', label: 'He2', col: '#ff6b7a',
        blurb: 'Jump fuel. One unit per jump. What you put IN THE TANK '
             + 'is loose; anything else rides in tanks in the hold.' },
      { kind: 'missiles', label: 'MISSILES', col: '#ffb347',
        blurb: 'Warheads. They travel ONLY in racks in the hold — '
             + 'load them with PACK HOLD on the contract bar.' },
    ];

    lines.forEach((r, i) => {
      const x = px + 16 + i * (cardW + GAP);
      const stock = b.warehouse[r.kind];
      const full  = stock >= cap;

      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.fill();
      ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.stroke();

      const pad = 16;
      _supplyIcon(ctx, r.kind, x + pad, top + 18, 26, 34);

      ctx.textAlign = 'left';
      ctx.fillStyle = r.col;
      ctx.font = '15px Orbitron, monospace';
      ctx.fillText(r.label, x + pad + 40, top + 32);

      ctx.fillStyle = full ? '#ffd700' : '#c8d8f0';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText(`${stock} / ${cap} in store`, x + pad + 40, top + 50);
      _bar(ctx, x + pad, top + 62, cardW - pad * 2, stock, cap, r.col);

      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      const afterBlurb = _wrap(ctx, r.blurb, x + pad, top + 86, cardW - pad * 2, 13);

      let ly = afterBlurb + 22;

      // Tank stepper — He2 only. Missiles are cargo, full stop.
      if (r.kind === 'fuel') {
        ctx.fillStyle = '#5f7893';
        ctx.font = '11px Share Tech Mono, monospace';
        ctx.fillText('into the tank', x + pad, ly);
        _btn(ctx, x + pad, ly + 8, 30, 26, '−', { act: 'load', arg: ['fuel', -1], col: '#ff7c20' });
        ctx.fillStyle = '#c8e8ff';
        ctx.font = '16px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(_fuel), x + pad + 52, ly + 26);
        ctx.textAlign = 'left';
        _btn(ctx, x + pad + 70, ly + 8, 30, 26, '+', { act: 'load', arg: ['fuel', 1], col: '#1aff8c' });
        _btn(ctx, x + pad + 106, ly + 8, 52, 26, 'MAX', { act: 'load', arg: ['fuel', 999], col: '#4db8ff' });
        ly += 46;
      }

      // Shop
      const price = Base.unitPrice(r.kind);
      const room  = cap - stock;
      const can1  = Base.cc() >= price && room >= 1;
      const can5  = Base.cc() >= price * 5 && room >= 1;
      ctx.fillStyle = '#5f7893';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText(`base shop — ${price} CC each`, x + pad, ly + 12);
      _btn(ctx, x + pad, ly + 20, 92, 28, 'BUY ×1',
           { act: can1 ? 'buy' : null, arg: [r.kind, 1], enabled: can1, col: '#1aff8c' });
      _btn(ctx, x + pad + 100, ly + 20, 92, 28, 'BUY ×5',
           { act: can5 ? 'buy' : null, arg: [r.kind, 5], enabled: can5, col: '#1aff8c' });
      if (full) {
        ctx.fillStyle = '#ffd700';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText('warehouse full — upgrade it in UPGRADES', x + pad, ly + 62);
      }
    });

    // ── third card: what is actually going with you ──
    {
      const x = px + 16 + 2 * (cardW + GAP);
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.fill();
      ctx.strokeStyle = '#1e3a5c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, top, cardW, cardH, 5); ctx.stroke();

      const pad = 16;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4db8ff';
      ctx.font = '14px Orbitron, monospace';
      ctx.fillText('THIS LAUNCH', x + pad, top + 30);

      const p = _holdSummary();
      const rows = [
        { k: 'He2 in the tank', v: `${_fuel}`, col: '#ff6b7a' },
        { k: 'He2 in the hold',  v: `${p.fuel}`, col: '#ff8a95' },
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

      _btn(ctx, x + pad, top + 178, cardW - pad * 2, 30, '▣ PACK HOLD',
           { act: 'pack', col: '#ffd780' });

      ctx.fillStyle = '#4a6080';
      ctx.font = '10px Share Tech Mono, monospace';
      _wrap(ctx, 'Anything still in the hold when you dock comes back here — '
                + 'as long as there is room for it.', x + pad, top + 226,
            cardW - pad * 2, 13);
    }
  }

  /** WAREHOUSE tab: what is on the shelf, grouped by kind, plus the
   *  button that opens the real drag-and-drop grid (LootScreen). This
   *  panel itself only reads the grid — nothing here mutates it. */
  function _drawWarehouse(ctx, px, py, pw, ph, b) {
    ctx.textAlign = 'left';
    const grid = (typeof CargoGrid !== 'undefined' && Base.stashGrid) ? Base.stashGrid() : null;
    if (!grid) {
      ctx.fillStyle = '#4db8ff';
      ctx.font = '12px Orbitron, monospace';
      ctx.fillText('WAREHOUSE — cargo system not loaded', px + 16, py + 22);
      return;
    }

    const used = grid.usedCells(), cap = grid.capacity;
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.fillText(`WAREHOUSE SHELF — ${used}/${cap} cells`, px + 16, py + 22);

    const worth = grid.items.reduce((n, it) => n + it.value('general'), 0);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1aff8c';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText(`~${worth} CC on the shelf`, px + pw - 16, py + 22);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#5f7893';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('Salvage that came home instead of being sold outright — a full '
               + 'shelf means the next haul gets liquidated on the spot.', px + 16, py + 40);

    const top = py + 58;
    if (!grid.items.length) {
      ctx.fillStyle = '#3d4a63';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText('Empty — nothing on the shelf yet.', px + 16, top + 20);
    } else {
      // Group by item + damage state so ten medkits read as one line.
      const rows = [];
      const seen = new Map();
      grid.items.forEach(it => {
        const key = it.defKey + (it.damaged ? ':dmg' : '');
        if (!seen.has(key)) { seen.set(key, rows.length); rows.push({ it, n: 0, qty: 0, cc: 0 }); }
        const r = rows[seen.get(key)];
        r.n++; r.qty += it.isStack ? it.qty : 1; r.cc += it.value('general');
      });
      const maxRows = Math.max(1, Math.min(rows.length, Math.floor((ph - 130) / 20)));
      rows.slice(0, maxRows).forEach((r, i) => {
        const ry = top + i * 20;
        ctx.fillStyle = r.it.damaged ? '#9aa4b2' : (r.it.def.col || '#c8d8f0');
        ctx.font = '12px Share Tech Mono, monospace';
        const qtyTxt = r.it.isStack ? `${r.qty}` : `×${r.n}`;
        ctx.fillText(`${r.it.label}${r.it.damaged ? ' (spoiled)' : ''} — ${qtyTxt}`, px + 16, ry);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#1aff8c';
        ctx.fillText(`~${r.cc} CC`, px + pw - 16, ry);
        ctx.textAlign = 'left';
      });
      if (rows.length > maxRows) {
        ctx.fillStyle = '#5f7893';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(`…and ${rows.length - maxRows} more kind${rows.length - maxRows > 1 ? 's' : ''}`,
                     px + 16, top + maxRows * 20 + 4);
      }
    }

    _btn(ctx, px + 16, py + ph - 46, 220, 32, '▣ OPEN WAREHOUSE',
         { act: 'warehouse', col: '#ffd780' });
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
      { kind: 'hold', title: 'CARGO RETROFIT',
        now: `+${Base.holdBonus?.() ?? 0} hold columns`,
        next: `+${(Base.holdBonus?.() ?? 0) + 1} hold columns`,
        blurb: 'New racking in every hull you own — one more column of '
             + 'hold space, permanently.' },
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
  function _drawLaunchBar(ctx, W, H, b) {
    const y = 542;
    _panel(ctx, 40, y, W - 80, 148, null);

    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CONTRACT', 56, y + 22);

    Base.missions().forEach((m, i) => {
      const x = 56 + i * 330, my = y + 32;
      const on = _mission === m.id;
      ctx.fillStyle = on ? 'rgba(26,140,255,0.18)' : 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, my, 314, 88, 5); ctx.fill();
      ctx.strokeStyle = on ? '#4db8ff' : '#1e2d4a'; ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(x, my, 314, 88, 5); ctx.stroke();

      ctx.fillStyle = on ? '#c8e8ff' : '#9fb4cc';
      ctx.font = '14px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(m.label, x + 12, my + 22);
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      _wrap(ctx, m.blurb, x + 12, my + 40, 290, 13);
      ctx.fillStyle = '#ffd700';
      ctx.fillText(`${m.sectors} sectors   ·   bonus ${m.ccBonus} CC`, x + 12, my + 76);
      _zones.push({ x, y: my, w: 314, h: 88, act: 'mission', arg: m.id });
    });

    // Manifest + GO
    const mx = 56 + 2 * 330;
    ctx.fillStyle = '#7a90a8';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    const shipDef = b.ships[_shipIdx] ? SHIP_CATALOG[b.ships[_shipIdx].key] : null;
    ctx.fillText(`ship:  ${shipDef ? shipDef.label : '— none —'}`, mx, y + 40);
    ctx.fillText(`crew:  ${_picked.size ? _picked.size + ' veteran(s)' : 'recruits'}`, mx, y + 58);
    ctx.fillStyle = '#ff5566';
    ctx.fillText(`He2:   ${_fuel} in the tank`, mx, y + 76);

    // The hold manifest: what you packed, and how full it is.
    const p = _holdSummary();
    ctx.fillStyle = p.cells ? '#1aff8c' : '#4a6080';
    const bits = [];
    if (p.missiles) bits.push(`${p.missiles} msl`);
    if (p.fuel)     bits.push(`+${p.fuel} He2`);
    if (p.guns)     bits.push(`${p.guns} gun${p.guns > 1 ? 's' : ''}`);
    ctx.fillText(`hold:  ${bits.length ? bits.join(', ') : 'empty'}`, mx, y + 94);
    ctx.fillStyle = '#5f7893';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`       ${p.cells}/${p.cap} cells`, mx, y + 110);
    ctx.font = '11px Share Tech Mono, monospace';

    _btn(ctx, mx, y + 118, 150, 28, '▣ PACK HOLD',
         { act: 'pack', col: '#ffd780' });

    const ready = !!b.ships[_shipIdx];
    const warn  = _fuel < 3;
    // Anchored to the panel's right edge so it can never sit on the manifest
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
    open, update, draw, consumeLaunch, packGrids,
    // exposed for tests
    _levels: _entryLevels,
    // exposed for tests
    _state: () => ({ tab: _tab, shipIdx: _shipIdx, picked: [..._picked],
                     fuel: _fuel, missiles: _missiles, mission: _mission,
                     hold: _hold, store: _store, packed: _holdSummary() }),
    _set: (o) => {
      if (o.tab !== undefined) _tab = o.tab;
      if (o.shipIdx !== undefined) { _shipIdx = o.shipIdx; _buildHold(); }
      if (o.picked !== undefined) _picked = new Set(o.picked);
      if (o.fuel !== undefined) _fuel = o.fuel;
      if (o.missiles !== undefined) _missiles = o.missiles;
      if (o.mission !== undefined) _mission = o.mission;
    },
    _act,
  };
})();

if (typeof window !== 'undefined') window.BaseScreen = BaseScreen;
