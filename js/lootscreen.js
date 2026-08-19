/* ============================================================
   MOON WARS — lootscreen.js
   Two holds side by side and a cursor: the salvage screen.

   Used two ways:
     LootScreen.openLoot(wreckGrid, holdGrid, opts)  — boarding a wreck,
         left grid is the derelict's hold, and a clock is running.
     LootScreen.openHold(holdGrid, opts)             — just looking at
         your own cargo between jumps. No clock, no left grid.

   game.js drives it exactly like BaseScreen:
       LootScreen.update(dt)  → 'done' | null
       LootScreen.draw(ctx)
   ============================================================ */

'use strict';

const LootScreen = (() => {

  const CELL_MAX   = 42;
  const GAP        = 5;
  const GRID_TOP   = 208;
  const GRID_BOT   = 452;   // the detail panel starts at 470

  /** Cell size that makes the TALLEST grid on screen fit above the panel.
   *  A base store of 8x6 used to run straight under the detail panel. */
  function _cell() {
    const rows = Math.max(_hold?.rows ?? 1, _wreck?.rows ?? 1, 1);
    return Utils.clamp(
      Math.floor((GRID_BOT - GRID_TOP + GAP) / rows) - GAP, 22, CELL_MAX);
  }

  let _wreck   = null;      // CargoGrid | null
  let _hold    = null;      // CargoGrid
  let _opts    = {};
  let _drag    = null;      // { item, from, ox, oy, homeX, homeY }
  let _sel     = null;      // hovered/selected item for the detail panel
  let _timer   = 0;         // seconds left (loot mode)
  let _timed   = false;
  let _zones   = [];
  let _flash   = '';
  let _flashT  = 0;
  let _done    = false;
  let _log     = [];        // recent one-liners

  /* ── Open / close ─────────────────────────────────────── */

  function openLoot(wreckGrid, holdGrid, opts = {}) {
    _wreck = wreckGrid; _hold = holdGrid; _opts = opts;
    _timed = opts.seconds != null;
    _timer = opts.seconds ?? 0;
    _drag = null; _sel = null; _done = false; _log = [];
    _flash = opts.intro || ''; _flashT = _flash ? 4 : 0;
  }

  function openHold(holdGrid, opts = {}) {
    _wreck = null; _hold = holdGrid; _opts = opts;
    _timed = false; _timer = 0;
    _drag = null; _sel = null; _done = false; _log = [];
    _flash = ''; _flashT = 0;
  }

  function isOpen() { return !!_hold && !_done; }

  function _say(msg, good = true) {
    _flash = msg; _flashT = 3;
    _log.unshift(msg);
    if (_log.length > 4) _log.pop();
    if (typeof UI !== 'undefined') UI.notify?.(msg, good ? 'good' : 'warn');
  }

  /* ── Geometry ─────────────────────────────────────────── */

  const SPAN = 150;   // clear space between the two holds

  function _gridRect(which) {
    const CELL = _cell();
    const g = which === 'wreck' ? _wreck : _hold;
    if (!g) return null;
    const w = g.cols * (CELL + GAP) - GAP;
    const h = g.rows * (CELL + GAP) - GAP;
    // Hold alone → centred. Both → the PAIR is centred, so two small
    // grids sit next to each other instead of hugging opposite walls.
    let x;
    if (!_wreck) {
      x = (1280 - w) / 2;
    } else {
      const wW = _wreck.cols * (CELL + GAP) - GAP;
      const hW = _hold.cols  * (CELL + GAP) - GAP;
      const left = (1280 - (wW + SPAN + hW)) / 2;
      x = which === 'wreck' ? left : left + wW + SPAN;
    }
    // Taller grids grow downward from a fixed top, but stay clear of the
    // detail panel at y=470.
    const y = GRID_TOP;
    return { x, y, w, h, grid: g };
  }

  /** Grid cell under a point, or null. */
  function _cellAt(which, mx, my) {
    const CELL = _cell();
    const r = _gridRect(which);
    if (!r) return null;
    if (!Utils.pointInRect(mx, my, r.x, r.y, r.w, r.h)) return null;
    const cx = Math.floor((mx - r.x) / (CELL + GAP));
    const cy = Math.floor((my - r.y) / (CELL + GAP));
    if (cx < 0 || cy < 0 || cx >= r.grid.cols || cy >= r.grid.rows) return null;
    return { cx, cy, grid: r.grid, which };
  }

  /* ── Update ───────────────────────────────────────────── */

  function update(dt) {
    if (!_hold) return null;
    const CELL = _cell();
    if (_flashT > 0) _flashT -= dt;

    if (_timed && !_done) {
      _timer -= dt;
      if (_timer <= 0) {
        _timer = 0;
        _say('Out of time — casting off!', false);
        return _finish();
      }
    }

    const mx = Input.mouse.x, my = Input.mouse.y;

    // Rotate the carried item (or the hovered one) with R.
    if (Input.isPressed?.('KeyR')) _rotate();

    // ── pick up ──
    if (Input.mouse.leftPressed && !_drag) {
      // Buttons win over the grid.
      for (const z of _zones) {
        if (Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) {
          Audio.sfx.uiClick?.();
          const r = _act(z.act, z.arg);
          return r;
        }
      }
      for (const which of ['wreck', 'hold']) {
        const c = _cellAt(which, mx, my);
        if (!c) continue;
        const it = c.grid.at(c.cx, c.cy);
        if (!it) continue;
        c.grid.remove(it);
        _drag = { item: it, from: c.grid,
                  homeX: it.x, homeY: it.y, homeRot: it.rot,
                  ox: mx, oy: my };
        _sel = it;
        Audio.sfx.uiClick?.();
        break;
      }
    }

    // ── drop ──
    if (_drag && !Input.mouse.leftDown) {
      const it = _drag.item;
      let placed = false;
      for (const which of ['wreck', 'hold']) {
        const r = _gridRect(which);
        if (!r) continue;
        // Snap by the item's TOP-LEFT, taken from where the cursor is,
        // so a big crate does not jump under the mouse when you let go.
        const gx = Math.round((mx - CELL / 2 - r.x) / (CELL + GAP));
        const gy = Math.round((my - CELL / 2 - r.y) / (CELL + GAP));
        if (!Utils.pointInRect(mx, my, r.x - CELL, r.y - CELL,
                               r.w + CELL * 2, r.h + CELL * 2)) continue;
        if (r.grid.fits(it, gx, gy)) { r.grid.place(it, gx, gy); placed = true; break; }
      }
      if (!placed) {
        // Home again, exactly where it was.
        it.rot = _drag.homeRot;
        if (!_drag.from.place(it, _drag.homeX, _drag.homeY)) _drag.from.autoPlace(it);
      }
      _drag = null;
    }

    if (!_drag) {
      _sel = null;
      for (const which of ['wreck', 'hold']) {
        const c = _cellAt(which, mx, my);
        if (c) { const it = c.grid.at(c.cx, c.cy); if (it) _sel = it; }
      }
    }

    return null;
  }

  function _rotate() {
    const it = _drag?.item || _sel;
    if (!it) return;
    const owner = _drag ? null
      : (_hold.items.includes(it) ? _hold : (_wreck?.items.includes(it) ? _wreck : null));
    const old = it.rot;
    it.rot = (it.rot + 1) % 4;
    if (owner) {
      // In place: only allow it if the rotated shape still fits there.
      if (!owner.fits(it, it.x, it.y, it)) { it.rot = old; _say('No room to turn it', false); return; }
    }
    Audio.sfx.uiClick?.();
  }

  function _act(act, arg) {
    switch (act) {
      case 'rotate':  _rotate(); return null;
      case 'takeAll': {
        if (!_wreck) return null;
        let n = 0;
        for (const it of [..._wreck.items]) {
          _wreck.remove(it);
          if (_hold.autoPlace(it)) n++;
          else { _wreck.autoPlace(it); }   // no room — put it back
        }
        _say(n ? `Hauled ${n} crate${n > 1 ? 's' : ''} aboard` : 'Hold is full', !!n);
        return null;
      }
      case 'unpack':  return _unpack(arg);
      case 'dump': {
        const it = arg;
        if (_hold.remove(it) || _wreck?.remove(it)) _say(`Jettisoned ${it.label}`, false);
        _sel = null;
        return null;
      }
      case 'done':    return _finish();
      default:        return null;
    }
  }

  function _unpack(it) {
    if (!it || !_hold.items.includes(it)) return null;
    if (it.damaged) { _say('Too damaged to unpack — sell it as scrap', false); return null; }
    const res = _opts.onUnpack?.(it);
    if (!res) return null;
    if (res.ok) { _hold.remove(it); _sel = null; }
    _say(res.message, res.ok);
    return null;
  }

  function _finish() {
    _done = true;
    _opts.onClose?.({ hold: _hold, wreck: _wreck });
    return 'done';
  }

  /* ── Draw ─────────────────────────────────────────────── */

  function draw(ctx) {
    if (!_hold) return;
    const CELL = _cell();
    _zones = [];
    Renderer.drawBackground?.(0);

    ctx.save();
    ctx.fillStyle = 'rgba(5,7,14,0.82)';
    ctx.fillRect(0, 0, 1280, 720);

    // ── header ──
    ctx.textAlign = 'center';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '26px Orbitron, monospace';
    ctx.fillText(_opts.title || 'CARGO HOLD', 640, 62);
    ctx.fillStyle = '#5f7893';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.fillText(_opts.subtitle || 'drag to move · R to rotate', 640, 84);

    if (_timed) _drawTimer(ctx);

    // ── grids ──
    if (_wreck) _drawGrid(ctx, 'wreck', _opts.leftLabel || 'DERELICT HOLD', '#ff9a6b');
    _drawGrid(ctx, 'hold', 'YOUR HOLD', '#4db8ff');

    // ── carried item follows the cursor ──
    if (_drag) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      _drawItem(ctx, _drag.item, mx - CELL / 2, my - CELL / 2, 0.85, true);
    }

    _drawDetail(ctx);
    _drawButtons(ctx);
    ctx.restore();
  }

  function _drawTimer(ctx) {
    const frac = Utils.clamp(_timer / (_opts.seconds || 1), 0, 1);
    const w = 420, x = 640 - w / 2, y = 104;
    ctx.fillStyle = '#0a1018';
    ctx.beginPath(); ctx.roundRect(x, y, w, 12, 6); ctx.fill();
    const col = frac > 0.4 ? '#1aff8c' : frac > 0.18 ? '#ffb020' : '#ff5566';
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.roundRect(x, y, w * frac, 12, 6); ctx.fill();
    ctx.fillStyle = col;
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${_opts.timerLabel || 'PATROL ETA'}  ${_timer.toFixed(0)}s`, 640, y + 28);
  }

  function _drawGrid(ctx, which, label, accent) {
    const CELL = _cell();
    const r = _gridRect(which);
    if (!r) return;
    const g = r.grid;

    ctx.textAlign = 'left';
    ctx.fillStyle = accent;
    ctx.font = '13px Orbitron, monospace';
    ctx.fillText(label, r.x, r.y - 26);
    // Cells used AND what the pile is worth — the two numbers you weigh
    // against each other when deciding what to leave behind.
    const port  = _opts.portType || 'general';
    const worth = g.items.reduce((n, it) => n + it.value(port), 0);
    ctx.fillStyle = '#5f7893';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText(`${g.usedCells()}/${g.capacity} cells`, r.x, r.y - 10);
    if (worth > 0) {
      ctx.fillStyle = '#1aff8c';
      ctx.textAlign = 'right';
      ctx.fillText(`~${worth} CC`, r.x + r.w, r.y - 10);
      ctx.textAlign = 'left';
    }

    // Where would the carried item land?
    let ghost = null;
    if (_drag) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      const gx = Math.round((mx - CELL / 2 - r.x) / (CELL + GAP));
      const gy = Math.round((my - CELL / 2 - r.y) / (CELL + GAP));
      if (Utils.pointInRect(mx, my, r.x - CELL, r.y - CELL,
                            r.w + CELL * 2, r.h + CELL * 2)) {
        ghost = { gx, gy, ok: g.fits(_drag.item, gx, gy) };
      }
    }

    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        const px = r.x + x * (CELL + GAP), py = r.y + y * (CELL + GAP);
        ctx.fillStyle = 'rgba(13,17,32,0.85)';
        ctx.beginPath(); ctx.roundRect(px, py, CELL, CELL, 3); ctx.fill();
        ctx.strokeStyle = '#1c2740'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(px, py, CELL, CELL, 3); ctx.stroke();
      }
    }

    if (ghost) {
      const m = _drag.item.mask;
      for (let y = 0; y < m.length; y++) {
        for (let x = 0; x < m[y].length; x++) {
          if (!m[y][x]) continue;
          const cx = ghost.gx + x, cy = ghost.gy + y;
          if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) continue;
          const px = r.x + cx * (CELL + GAP), py = r.y + cy * (CELL + GAP);
          ctx.fillStyle = ghost.ok ? 'rgba(26,255,140,0.18)' : 'rgba(255,85,102,0.20)';
          ctx.beginPath(); ctx.roundRect(px, py, CELL, CELL, 3); ctx.fill();
        }
      }
    }

    for (const it of g.items) {
      _drawItem(ctx, it, r.x + it.x * (CELL + GAP), r.y + it.y * (CELL + GAP),
                1, false, it === _sel);
    }

    // A live core deserves a warning right on the hold.
    if (g.hasLiveHazard()) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ff5566';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText('⚠ UNCOOLED CORE — will spoil what it touches on the next jump',
                   r.x, r.y + r.h + 18);
    }
  }

  function _drawItem(ctx, it, px, py, alpha = 1, floating = false, selected = false) {
    const CELL = _cell();
    const m = it.mask;
    ctx.save();
    ctx.globalAlpha = alpha;
    const col = it.damaged ? '#6b7280' : (it.def.col || '#4db8ff');
    const on = (x, y) => !!(m[y] && m[y][x]);

    // ONE silhouette, not a pile of tiles: cells of the same crate are
    // bridged across the grid gap and only the OUTER edge is stroked.
    // Two same-coloured crates side by side used to read as one blob.
    ctx.fillStyle = Utils.rgba(col, floating ? 0.55 : 0.30);
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!on(x, y)) continue;
        const cx = px + x * (CELL + GAP), cy = py + y * (CELL + GAP);
        const w = CELL + (on(x + 1, y) ? GAP : 0);
        const h = CELL + (on(x, y + 1) ? GAP : 0);
        ctx.fillRect(cx, cy, w, h);
      }
    }

    ctx.strokeStyle = selected ? '#ffffff' : col;
    ctx.lineWidth = selected ? 2 : 1.4;
    ctx.beginPath();
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!on(x, y)) continue;
        const cx = px + x * (CELL + GAP), cy = py + y * (CELL + GAP);
        const r = cx + CELL, b = cy + CELL;
        if (!on(x, y - 1)) { ctx.moveTo(cx, cy); ctx.lineTo(r, cy); }
        if (!on(x, y + 1)) { ctx.moveTo(cx, b);  ctx.lineTo(r, b); }
        if (!on(x - 1, y)) { ctx.moveTo(cx, cy); ctx.lineTo(cx, b); }
        if (!on(x + 1, y)) { ctx.moveTo(r, cy);  ctx.lineTo(r, b); }
      }
    }
    ctx.stroke();
    // One label, centred on the item's whole footprint — a 2x3 crate
    // reads as one object that way, not as six tiles that share a word.
    const w = m[0].length * (CELL + GAP) - GAP;
    const h = m.length * (CELL + GAP) - GAP;
    const lbl = it.def.short || '?';
    const ly = py + h / 2 + (it.damaged ? -2 : 4);
    // A dark plate under the text, so a label never fights the grid
    // lines it happens to sit on.
    ctx.font = `${CELL < 34 ? 10 : 12}px Share Tech Mono, monospace`;
    ctx.textAlign = 'center';
    const tw = Math.max(26, (ctx.measureText?.(lbl)?.width ?? 24) + 8);
    ctx.fillStyle = 'rgba(6,9,16,0.72)';
    ctx.beginPath(); ctx.roundRect(px + w / 2 - tw / 2, ly - 11, tw, 15, 3); ctx.fill();
    ctx.fillStyle = it.damaged ? '#9aa4b2' : col;
    ctx.fillText(lbl, px + w / 2, ly);
    if (it.damaged) {
      ctx.fillStyle = '#ff5566';
      ctx.font = '8px Share Tech Mono, monospace';
      ctx.fillText('SPOILED', px + w / 2, py + h / 2 + 10);
    }
    ctx.restore();
  }

  function _drawDetail(ctx) {
    const x = 120, y = 470, w = 1040, h = 92;
    ctx.fillStyle = 'rgba(10,14,26,0.92)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.stroke();

    ctx.textAlign = 'left';
    const it = _drag?.item || _sel;
    if (!it) {
      ctx.fillStyle = '#3d4a63';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText('Hover a crate to read it. Drag to move it between holds. '
                 + 'R turns it. Big things do not fit everywhere.', x + 16, y + 34);
      if (_flashT > 0 && _flash) {
        ctx.fillStyle = '#4db8ff';
        ctx.fillText(_flash, x + 16, y + 60);
      }
      return;
    }

    ctx.fillStyle = it.def.col || '#4db8ff';
    ctx.font = '15px Orbitron, monospace';
    ctx.fillText(it.label + (it.damaged ? '  (spoiled)' : ''), x + 16, y + 28);

    ctx.fillStyle = '#7a90a8';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText(it.def.desc || '', x + 16, y + 50);

    const port = _opts.portType || 'general';
    const bits = [`${it.w}×${it.h}`, `worth ~${it.value(port)} CC`];
    if (it.def.contraband) bits.push('CONTRABAND — fleet yards seize it');
    if (it.def.tag === 'rad') bits.push('RADIOACTIVE');
    ctx.fillStyle = '#5f7893';
    ctx.fillText(bits.join('   ·   '), x + 16, y + 70);

    if (_flashT > 0 && _flash) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#4db8ff';
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.fillText(_flash, x + w - 16, y + 70);
      ctx.textAlign = 'left';
    }
  }

  function _btn(ctx, x, y, w, h, label, opts = {}) {
    const { col = '#4db8ff', act = null, arg = null, enabled = true } = opts;
    ctx.save();
    const hot = enabled && Utils.pointInRect(Input.mouse.x, Input.mouse.y, x, y, w, h);
    ctx.fillStyle = hot ? 'rgba(26,140,255,0.16)' : 'rgba(13,17,32,0.9)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
    ctx.strokeStyle = enabled ? col : '#2a3346';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.stroke();
    ctx.fillStyle = enabled ? col : '#3d4a63';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 4);
    ctx.restore();
    if (act && enabled) _zones.push({ x, y, w, h, act, arg });
  }

  function _drawButtons(ctx) {
    const y = 588;
    let x = 120;
    const sel = _drag?.item || _sel;

    _btn(ctx, x, y, 110, 34, 'ROTATE  R', { act: 'rotate', enabled: !!sel }); x += 122;

    if (_wreck) {
      _btn(ctx, x, y, 120, 34, _opts.takeAllLabel || 'TAKE ALL',
           { act: 'takeAll', col: '#1aff8c' });
      x += 132;
    }

    const canUnpack = sel && _hold.items.includes(sel) && !sel.damaged
                    && ['fuel', 'missiles', 'heal', 'weapon'].includes(sel.def.kind);
    _btn(ctx, x, y, 130, 34, 'UNPACK',
         { act: 'unpack', arg: sel, col: '#ffd780', enabled: !!canUnpack }); x += 142;

    _btn(ctx, x, y, 130, 34, 'JETTISON',
         { act: 'dump', arg: sel, col: '#ff5566', enabled: !!sel });

    _btn(ctx, 1040, y, 120, 34, _opts.doneLabel || 'DONE',
         { act: 'done', col: '#1aff8c' });
  }

  return { openLoot, openHold, isOpen, update, draw,
           // exposed for tests
           _cellAt, _gridRect };
})();

if (typeof window !== 'undefined') window.LootScreen = LootScreen;
