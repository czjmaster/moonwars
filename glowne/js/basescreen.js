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

  const TABS = ['HANGAR', 'ARMOURY', 'CREW', 'SUPPLY', 'UPGRADES'];

  let _tab       = 'HANGAR';
  let _shipIdx   = 0;
  let _picked    = new Set();     // crew ids coming along
  let _fuel      = 0;             // He2 loaded onto the ship
  let _missiles  = 0;
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
    _missiles = Math.min(b.warehouse.missiles, 8);
    // Pre-pick as many veterans as the ship will sensibly carry
    Base.crew().slice(0, 4).forEach(c => _picked.add(c.id));
    _launch = null;
  }

  function consumeLaunch() { const l = _launch; _launch = null; return l; }

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
      case 'ship':     _shipIdx = arg; break;
      case 'buyShip':  { const r = Base.buyShip(arg); _say(r.message, r.ok); break; }
      case 'mission':  _mission = arg; break;

      case 'crew': {
        if (_picked.has(arg)) _picked.delete(arg);
        else _picked.add(arg);
        break;
      }
      case 'hire': { const r = Base.hireRecruit(); _say(r.message, r.ok); break; }
      case 'sellShip': { const r = Base.sellShip(arg); _say(r.message, r.ok); if (r.ok) _shipIdx = 0; break; }
      case 'fit':      { const r = Base.installWeapon(_shipIdx, arg);  _say(r.message, r.ok); break; }
      case 'unfit':    { const r = Base.uninstallWeapon(_shipIdx, arg); _say(r.message, r.ok); break; }
      case 'sellGun':  { const r = Base.sellWeapon(arg); _say(r.message, r.ok); break; }

      case 'load': {
        // arg = ['fuel'|'missiles', delta]
        const [kind, delta] = arg;
        const stock = b.warehouse[kind];
        if (kind === 'fuel') _fuel = Utils.clamp(_fuel + delta, 0, stock);
        else                 _missiles = Utils.clamp(_missiles + delta, 0, stock);
        break;
      }
      case 'buy': { const r = Base.buySupply(arg[0], arg[1]); _say(r.message, r.ok); break; }
      case 'upgrade': { const r = Base.buyUpgrade(arg); _say(r.message, r.ok); break; }

      case 'launch': {
        const res = Base.launch({
          shipIndex: _shipIdx,
          crewIds: [..._picked],
          fuel: _fuel, missiles: _missiles,
          mission: _mission,
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

  // ── Tab: HANGAR ─────────────────────────────────────────
  function _drawHangar(ctx, px, py, pw, ph, b) {
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`HANGAR — ${b.ships.length}/${Base.shipSlots()} berths`, px + 16, py + 24);

    if (!b.ships.length) {
      ctx.fillStyle = '#ff5566';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.fillText('Hangar empty — you lost your last hull. Buy another below.', px + 16, py + 56);
    }

    b.ships.forEach((entry, i) => {
      const def = SHIP_CATALOG[entry.key] || { label: entry.key, blurb: '' };
      const CW = 330;
      const x = px + 16 + i * (CW + 14), y = py + 40;
      const on = i === _shipIdx;
      ctx.fillStyle = on ? 'rgba(26,140,255,0.16)' : 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, y, CW, 128, 5); ctx.fill();
      ctx.strokeStyle = on ? '#4db8ff' : '#1e2d4a'; ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(x, y, CW, 128, 5); ctx.stroke();

      ctx.fillStyle = on ? '#c8e8ff' : '#9fb4cc';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(def.label, x + 12, y + 22);

      // A picture of the actual hull beats three lines of numbers —
      // you can SEE the free bays and where the guns sit.
      Renderer.drawShipThumb(ctx, entry.key, x + 168, y + 30, 150, 62,
        { rooms: _entryRooms(entry) });

      const L = SHIP_LAYOUTS[entry.key];
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      if (L) {
        ctx.fillText(`Hull ${L.hullMax}  ·  Decks ${L.floors}`, x + 12, y + 42);
        ctx.fillText(`Reactor ${L.reactorLevel}  ·  Bays ${L.rooms.length}`, x + 12, y + 58);
        const free = _entryRooms(entry).filter(r => r.type === 'empty').length;
        ctx.fillStyle = free ? '#ffd700' : '#4a6080';
        ctx.fillText(free ? `${free} empty bay${free > 1 ? 's' : ''}` : 'no free bay', x + 12, y + 74);
      }
      if (entry.data) {
        ctx.fillStyle = '#1aff8c';
        ctx.fillText('veteran hull — upgrades kept', x + 12, y + 90);
      } else {
        ctx.fillStyle = '#4a6080';
        ctx.fillText('factory fresh', x + 12, y + 90);
      }
      _btn(ctx, x + 12, y + 96, 100, 24, on ? 'SELECTED' : 'SELECT',
           { act: 'ship', arg: i, on });
      // The yard buys hulls back at 30% — never your last one.
      const resale = Math.round((SHIP_CATALOG[entry.key]?.cost ?? 0) * 0.30);
      const canSell = b.ships.length > 1;
      _btn(ctx, x + 120, y + 96, 104, 24, `SELL ${resale}`,
           { act: canSell ? 'sellShip' : null, arg: i, enabled: canSell, col: '#ffb020',
             sub: canSell ? null : 'last hull' });
    });

    // Shipyard
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SHIPYARD', px + 16, py + 196);
    Base.catalog().forEach((def, i) => {
      const CW = 330;
      const x = px + 16 + i * (CW + 14), y = py + 210;
      const owned = b.ships.some(s2 => s2.key === def.key);
      const room  = b.ships.length < Base.shipSlots();
      const canBuy = Base.cc() >= def.cost && room;
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, y, CW, 128, 5); ctx.fill();
      ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, CW, 128, 5); ctx.stroke();
      ctx.fillStyle = '#9fb4cc';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(def.label, x + 12, y + 22);

      Renderer.drawShipThumb(ctx, def.key, x + 168, y + 28, 150, 56);

      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      _wrap(ctx, def.blurb, x + 12, y + 40, 150, 13);
      _btn(ctx, x + 12, y + 92, 160, 28,
           def.cost === 0 ? 'STANDARD ISSUE' : `BUY — ${def.cost} CC`,
           { act: canBuy ? 'buyShip' : null, arg: def.key,
             enabled: canBuy,
             col: canBuy ? '#1aff8c' : '#4a6080',
             sub: !room ? 'no free berth' : (owned ? 'you own one' : null) });
    });
  }

  /** Room list for a hangar entry — a bought/upgraded hull may have
   *  converted empty bays into modules, so the thumbnail must show the
   *  ship as it IS, not as it left the factory. */
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
        ctx.fillStyle = '#ffd780';
        ctx.font = '13px Share Tech Mono, monospace';
        ctx.fillText(def.label, px + 100, y + 20);
        ctx.fillStyle = '#7a90a8';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(`${def.damage} dmg · ${def.chargeTime}s · ⚡${def.powerCost}` +
                     `${def.missileUse ? ' · uses missiles' : ''}`, px + 100, y + 38);
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

      ctx.fillStyle = '#c8d8f0';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(def.label, px + 574, y + 20);
      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(`${def.damage} dmg · ${def.chargeTime}s · ⚡${def.powerCost}` +
                   `${def.missileUse ? ' · uses missiles' : ''}`, px + 574, y + 38);

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

      ctx.fillStyle = c.color || '#4db8ff';
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
  function _drawSupply(ctx, px, py, pw, ph, b) {
    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`WAREHOUSE — cap ${Base.warehouseCap()} per line`, px + 16, py + 24);

    const rows = [
      { kind: 'fuel',     label: 'He2',      col: '#ff5566', loaded: () => _fuel },
      { kind: 'missiles', label: 'MISSILES', col: '#ff7c20', loaded: () => _missiles },
    ];

    rows.forEach((r, i) => {
      const y = py + 52 + i * 116;
      ctx.fillStyle = r.col;
      ctx.font = '14px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(r.label, px + 16, y + 14);

      const stock = b.warehouse[r.kind];
      ctx.fillStyle = '#c8d8f0';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText(`in store: ${stock} / ${Base.warehouseCap()}`, px + 130, y + 14);
      _bar(ctx, px + 130, y + 22, 260, stock, Base.warehouseCap(), r.col);

      // Loadout stepper
      ctx.fillStyle = '#7a90a8';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText('load onto ship:', px + 430, y + 14);
      _btn(ctx, px + 540, y - 2, 30, 24, '−', { act: 'load', arg: [r.kind, -1], col: '#ff7c20' });
      ctx.fillStyle = '#c8e8ff';
      ctx.font = '15px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(r.loaded()), px + 588, y + 15);
      _btn(ctx, px + 606, y - 2, 30, 24, '+', { act: 'load', arg: [r.kind, 1], col: '#1aff8c' });
      _btn(ctx, px + 646, y - 2, 56, 24, 'MAX', { act: 'load', arg: [r.kind, 999], col: '#4db8ff' });

      // Shop
      const price = Base.unitPrice(r.kind);
      const room  = Base.warehouseCap() - stock;
      const can1  = Base.cc() >= price && room >= 1;
      const can5  = Base.cc() >= price * 5 && room >= 1;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7a90a8';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText(`base shop — ${price} CC each`, px + 16, y + 56);
      _btn(ctx, px + 16, y + 64, 96, 26, 'BUY ×1',
           { act: can1 ? 'buy' : null, arg: [r.kind, 1], enabled: can1, col: '#1aff8c' });
      _btn(ctx, px + 120, y + 64, 96, 26, 'BUY ×5',
           { act: can5 ? 'buy' : null, arg: [r.kind, 5], enabled: can5, col: '#1aff8c' });
      if (room <= 0) {
        ctx.fillStyle = '#ffd700';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText('warehouse full', px + 226, y + 82);
      }
    });

    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('Anything still in the hold when you dock comes back here — as long as there is room for it.',
                 px + 16, py + ph - 18);
  }

  // ── Tab: UPGRADES ───────────────────────────────────────
  function _drawUpgrades(ctx, px, py, pw, ph, b) {
    const items = [
      { kind: 'warehouse', title: 'WAREHOUSE',
        now: `${Base.warehouseCap()} units per line`,
        next: `${Base.warehouseCap() + 10} units per line`,
        blurb: 'More He2 and missiles kept between contracts.' },
      { kind: 'barracks', title: 'BARRACKS',
        now: `${Base.barracksCap()} bunks`,
        next: `${Base.barracksCap() + 2} bunks`,
        blurb: 'Keep more veterans on the payroll instead of turning them away.' },
      { kind: 'slot', title: 'HANGAR BERTH',
        now: `${Base.shipSlots()} berths`,
        next: `${Base.shipSlots() + 1} berths`,
        blurb: 'Room for another hull, so losing one is not the end.' },
    ];

    items.forEach((it, i) => {
      const x = px + 16 + i * 396, y = py + 40;
      ctx.fillStyle = 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(x, y, 380, 190, 5); ctx.fill();
      ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, 380, 190, 5); ctx.stroke();

      ctx.fillStyle = '#4db8ff';
      ctx.font = '14px Orbitron, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(it.title, x + 14, y + 26);

      ctx.fillStyle = '#7a90a8';
      ctx.font = '10px Share Tech Mono, monospace';
      _wrap(ctx, it.blurb, x + 14, y + 48, 352, 13);

      ctx.fillStyle = '#c8d8f0';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText(`now:  ${it.now}`, x + 14, y + 96);
      ctx.fillStyle = '#1aff8c';
      ctx.fillText(`next: ${it.next}`, x + 14, y + 116);

      const cost = Base.upgradeCost(it.kind);
      const can  = Base.cc() >= cost;
      _btn(ctx, x + 14, y + 140, 200, 30, `UPGRADE — ${cost} CC`,
           { act: can ? 'upgrade' : null, arg: it.kind, enabled: can, col: '#1aff8c' });
    });

    ctx.fillStyle = '#7a90a8';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('CC comes home from contracts — half of what you finish a run holding, plus the contract bonus.',
                 px + 16, py + ph - 18);
  }

  // ── Launch bar (contract + go) ──────────────────────────
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
    ctx.fillText(`He2:   ${_fuel}`, mx, y + 76);
    ctx.fillStyle = '#ff7c20';
    ctx.fillText(`msl:   ${_missiles}`, mx, y + 94);

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
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, ly); ly += lh; line = w;
      } else line = test;
    });
    if (line) ctx.fillText(line, x, ly);
  }

  return {
    open, update, draw, consumeLaunch,
    // exposed for tests
    _state: () => ({ tab: _tab, shipIdx: _shipIdx, picked: [..._picked],
                     fuel: _fuel, missiles: _missiles, mission: _mission }),
    _set: (o) => {
      if (o.tab !== undefined) _tab = o.tab;
      if (o.shipIdx !== undefined) _shipIdx = o.shipIdx;
      if (o.picked !== undefined) _picked = new Set(o.picked);
      if (o.fuel !== undefined) _fuel = o.fuel;
      if (o.missiles !== undefined) _missiles = o.missiles;
      if (o.mission !== undefined) _mission = o.mission;
    },
    _act,
  };
})();

if (typeof window !== 'undefined') window.BaseScreen = BaseScreen;
